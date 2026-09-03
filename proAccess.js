/**
 * proAccess.js — provisioning and recovery for the Pro entitlement.
 *
 * The money side of the upgrade works: Stripe takes the payment. What has been
 * failing is the step after it — `profiles.is_pro` never turning true — so the
 * pilot is charged and comes back to a locked app.
 *
 * The grant itself is deliberately server-side. `process-stripe-payment` (and
 * `restore-pro-access`) verify the checkout or subscription against Stripe with
 * the service-role key before stamping the entitlement. Nothing in this file
 * ever writes `is_pro`, and nothing should: a client that can grant itself Pro
 * is a client that will.
 *
 * What this module does instead is make the surrounding plumbing reliable:
 *
 *   • ensureProfileRow() — guarantees the pilot has a `profiles` row *before*
 *     they are sent to Stripe. Nothing else in the app has ever created one:
 *     free sign-up (netlify/functions/signup-free.js) creates the auth user and
 *     stops, and every other reference is a SELECT or an UPDATE. An
 *     `UPDATE profiles SET is_pro = true WHERE id = …` against an account that
 *     has no row updates nothing, reports success, and leaves the pilot on the
 *     free tier — which matches the symptom exactly.
 *
 *   • resolveAfterCheckout() — after the payment is processed, confirms the
 *     entitlement actually landed, and if it didn't, falls back to
 *     `restore-pro-access` (the same server-side re-check behind the manual
 *     "Refresh from Stripe" button) instead of showing a hopeful message and
 *     giving up. It reports *why* it failed, so a silent no-op stops being
 *     silent.
 *
 *   • A pending-activation marker, retried on later app loads. A dropped
 *     redirect, a closed tab or a browser that never came back from Stripe no
 *     longer strands a paying pilot: the next launch notices the unresolved
 *     checkout and re-claims it.
 *
 * Exposes the ProAccess object (ES module) and mirrors it on
 * window.InflightProAccess for non-module callers.
 */

const PENDING_KEY = 'inflight_pro_pending_activation';
const MAX_RETRIES = 6;                       // across app loads, then give up quietly
const RETRY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;  // a fortnight is long past a support ticket

function readJson(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
}
function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* private mode */ }
}
function drop(key) {
    try { localStorage.removeItem(key); } catch (_) { /* private mode */ }
}

export const ProAccess = {
    PENDING_KEY,

    /**
     * Make sure the signed-in pilot has a row in `profiles`.
     *
     * This is the row the server-side grant updates. Creating it is safe from
     * the client because the row carries no entitlement — only the id — and
     * `is_pro` is never part of the payload, so row-level security can (and
     * should) keep `is_pro` server-write-only while still allowing this.
     *
     * Best-effort throughout: if the table's policies forbid the insert, or a
     * column we don't know about is required, we log it once and carry on. The
     * upgrade still proceeds, and resolveAfterCheckout() will report the
     * missing row explicitly if the grant then fails.
     *
     * @returns {Promise<{ok: boolean, existed: boolean, error: string|null}>}
     */
    async ensureProfileRow(supabase, user) {
        if (!supabase || !user?.id) return { ok: false, existed: false, error: 'no-session' };
        try {
            // maybeSingle(), not single(): "no row" is the case we're here to
            // detect, and single() reports it as a query error.
            const { data, error } = await supabase
                .from('profiles')
                .select('id')
                .eq('id', user.id)
                .maybeSingle();

            if (!error && data) return { ok: true, existed: true, error: null };

            const { error: insertError } = await supabase
                .from('profiles')
                .insert({ id: user.id });

            if (insertError) {
                // 23505 = someone (a trigger, a concurrent tab) beat us to it,
                // which is a success for our purposes.
                if (insertError.code === '23505') return { ok: true, existed: true, error: null };
                console.warn('[ProAccess] Could not create the profiles row:', insertError.message);
                return { ok: false, existed: false, error: insertError.message };
            }
            console.info('[ProAccess] Created the missing profiles row for this account.');
            return { ok: true, existed: false, error: null };
        } catch (err) {
            console.warn('[ProAccess] ensureProfileRow failed:', err.message);
            return { ok: false, existed: false, error: err.message };
        }
    },

    /**
     * Read the entitlement state, distinguishing "no row at all" from "row
     * exists but isn't stamped". Those are different bugs with different fixes,
     * and collapsing them is why this failure has been so hard to see.
     *
     * @returns {Promise<{hasRow: boolean, isPro: boolean, error: string|null}>}
     */
    async readProfileState(supabase, userId) {
        if (!supabase || !userId) return { hasRow: false, isPro: false, error: 'no-session' };
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('is_pro')
                .eq('id', userId)
                .maybeSingle();
            if (error) return { hasRow: false, isPro: false, error: error.message };
            return { hasRow: !!data, isPro: data?.is_pro === true, error: null };
        } catch (err) {
            return { hasRow: false, isPro: false, error: err.message };
        }
    },

    /**
     * Ask the server to re-check Stripe and grant if there's a live
     * subscription. This is the authoritative recovery path — it never trusts
     * the client, and it no-ops when Stripe has nothing on the account.
     */
    async claimFromStripe(supabase) {
        try {
            const { data, error } = await supabase.functions.invoke('restore-pro-access');
            if (error) return { restored: false, error: error.message || 'restore-pro-access failed' };
            if (data?.error) return { restored: false, error: data.error };
            return { restored: !!data?.restored, error: null };
        } catch (err) {
            return { restored: false, error: err.message };
        }
    },

    // ── Pending-activation marker ─────────────────────────────────────────
    /** Record that money has changed hands but the entitlement hasn't landed. */
    markPending(info) {
        const existing = readJson(PENDING_KEY) || {};
        writeJson(PENDING_KEY, {
            email: info?.email || existing.email || null,
            userId: info?.userId || existing.userId || null,
            sessionId: info?.sessionId || existing.sessionId || null,
            startedAt: existing.startedAt || Date.now(),
            attempts: existing.attempts || 0
        });
    },
    readPending() { return readJson(PENDING_KEY); },
    clearPending() { drop(PENDING_KEY); },

    /**
     * On a later app load, finish an upgrade that never provisioned.
     *
     * Covers the cases the success-URL handler cannot: the pilot closed the tab
     * on Stripe's receipt page, the redirect was eaten, or the grant genuinely
     * failed server-side and nobody noticed. Bounded by attempt count and age
     * so a permanently-unresolvable marker doesn't call the function forever.
     *
     * @returns {Promise<{resolved: boolean, reason: string}>}
     */
    async retryPending(supabase) {
        const pending = this.readPending();
        if (!pending) return { resolved: false, reason: 'nothing-pending' };

        if (Date.now() - (pending.startedAt || 0) > RETRY_WINDOW_MS
            || (pending.attempts || 0) >= MAX_RETRIES) {
            this.clearPending();
            return { resolved: false, reason: 'gave-up' };
        }

        let user = null;
        try {
            const { data } = await supabase.auth.getSession();
            user = data?.session?.user || null;
        } catch (_) { /* treated as signed out */ }
        // Not signed in yet — leave the marker for the next load rather than
        // burning an attempt on a request that can't be authorised.
        if (!user) return { resolved: false, reason: 'signed-out' };

        const state = await this.readProfileState(supabase, user.id);
        if (state.isPro) { this.clearPending(); return { resolved: true, reason: 'already-pro' }; }

        writeJson(PENDING_KEY, Object.assign({}, pending, { attempts: (pending.attempts || 0) + 1 }));

        await this.ensureProfileRow(supabase, user);
        const claim = await this.claimFromStripe(supabase);
        if (!claim.restored) {
            return { resolved: false, reason: claim.error ? 'error:' + claim.error : 'no-subscription' };
        }

        this.clearPending();
        try { await supabase.auth.refreshSession(); } catch (_) { /* keep the session we have */ }
        try {
            if (typeof window !== 'undefined' && typeof window.refreshProStatus === 'function') {
                await window.refreshProStatus();
            }
        } catch (_) { /* the next load picks it up */ }
        console.info('[ProAccess] Recovered a Pro upgrade that never provisioned at checkout.');
        return { resolved: true, reason: 'restored' };
    },

    /**
     * Verify a finished checkout and settle the entitlement, in one call.
     *
     * The in-page payment modal never visits the success URL — it holds the
     * session id from the moment the session is created — so it has to do here
     * what `AuthUI.checkPaymentStatus()` does on the way back from the hosted
     * page: run `process-stripe-payment` (the only thing that grants Pro), then
     * confirm the stamp actually landed.
     *
     * @returns {Promise<{isPro: boolean, reason: string, hadRow: boolean, processed: boolean, error: string|null}>}
     */
    async finalizeCheckout(supabase, sessionId) {
        if (!supabase || !sessionId) {
            return { isPro: false, reason: 'no-session-id', hadRow: false, processed: false, error: 'Missing checkout session id.' };
        }

        let processed = false;
        let processError = null;
        try {
            const { data, error } = await supabase.functions.invoke('process-stripe-payment', {
                body: { sessionId }
            });
            if (error || data?.error) {
                processError = data?.error || error?.message || 'Could not verify the payment.';
            } else {
                processed = true;
            }
        } catch (err) {
            processError = err.message || 'Could not verify the payment.';
        }

        // Even a failed verification is worth resolving: the webhook may have
        // granted already, and resolveAfterCheckout() falls back to asking
        // Stripe directly rather than trusting either side's optimism.
        const result = await this.resolveAfterCheckout(supabase);

        if (result.isPro) {
            this.clearPending();
        } else {
            // Leave the claim on file so the next app load retries it.
            console.error('[ProAccess] Checkout finalised without an entitlement:', result.reason);
        }

        // Repaint the gated surfaces from the authoritative flag. The page was
        // never reloaded — without this the pilot stays behind the same locks
        // they just paid to remove.
        try {
            if (typeof window !== 'undefined' && typeof window.refreshProStatus === 'function') {
                const resolved = await window.refreshProStatus();
                if (resolved === true) result.isPro = true;
            }
        } catch (_) { /* the next load picks it up */ }

        return Object.assign({ processed, error: processError }, result);
    },

    /**
     * Confirm (or rescue) the entitlement right after a checkout returns.
     *
     * `process-stripe-payment` has already run by this point. We poll for the
     * stamp, and if it doesn't appear we don't just hope — we make sure the row
     * exists, then ask the server to re-check Stripe directly.
     *
     * @returns {Promise<{isPro: boolean, reason: string, hadRow: boolean}>}
     *   `reason` is diagnostic, and worth reading in a bug report:
     *     granted          — the payment processor stamped it, as designed
     *     restored         — the stamp never landed; the Stripe re-check fixed it
     *     missing-row      — the account had no `profiles` row for the grant to
     *                        update, and the re-check couldn't fix it either
     *     no-subscription  — Stripe has no active subscription on this account
     *     signed-out       — no session to attach the entitlement to
     */
    async resolveAfterCheckout(supabase) {
        try { await supabase.auth.refreshSession(); } catch (_) { /* keep the existing session */ }

        let user = null;
        try {
            const { data } = await supabase.auth.getSession();
            user = data?.session?.user || null;
        } catch (_) { /* treated as signed out */ }
        if (!user) return { isPro: false, reason: 'signed-out', hadRow: false };

        // The grant is asynchronous on the server, so give it a moment before
        // deciding it failed.
        let state = { hasRow: false, isPro: false, error: null };
        for (const wait of [0, 800, 1600, 2500]) {
            if (wait) await new Promise(r => setTimeout(r, wait));
            state = await this.readProfileState(supabase, user.id);
            if (state.isPro) return { isPro: true, reason: 'granted', hadRow: true };
        }

        // Not stamped. The most likely reason is that there was no row to stamp
        // — so create one and ask the server to try again against Stripe.
        console.warn('[ProAccess] Checkout completed but is_pro was not set'
            + (state.hasRow ? ' (the profiles row exists but was not stamped).'
                            : ' — this account has NO profiles row, so a server-side'
                              + ' UPDATE would have matched zero rows.'));

        const hadRow = state.hasRow;
        await this.ensureProfileRow(supabase, user);
        const claim = await this.claimFromStripe(supabase);

        if (claim.restored) {
            try { await supabase.auth.refreshSession(); } catch (_) { /* keep the session */ }
            const after = await this.readProfileState(supabase, user.id);
            if (after.isPro) return { isPro: true, reason: 'restored', hadRow };
        }

        return {
            isPro: false,
            hadRow,
            reason: claim.error ? 'error:' + claim.error
                : (!hadRow ? 'missing-row' : 'no-subscription')
        };
    }
};

if (typeof window !== 'undefined') window.InflightProAccess = ProAccess;
