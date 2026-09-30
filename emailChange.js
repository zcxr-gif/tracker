/**
 * emailChange.js
 *
 * Changing the account's email, from the account screen (profileUI.js on
 * desktop, MobileDashboardUI.js on phones). The address does NOT change until
 * it is confirmed:
 *
 *   1. The pilot types the new address and, for a password account, their
 *      current password — so a borrowed, signed-in device can't move the
 *      account to someone else's inbox.
 *   2. supabase.auth.updateUser({ email }) sends a confirmation link to the
 *      new address (and, with Supabase's "Secure email change" on, one to the
 *      current address as well). Until those are opened the account keeps the
 *      old address; Supabase holds the new one as user.new_email.
 *   3. The link lands on email-confirmed.html — a small page with no map and
 *      no loading screen — which tells this tab (BroadcastChannel, plus a
 *      localStorage ping for browsers without it). This tab also re-checks
 *      whenever it comes back into view, so going back and forth between the
 *      inbox and Inflight never needs a reload.
 *
 *   EmailChange.mount(host, { supabase, user, variant: 'desktop' | 'mobile', onChanged(user) })
 */

const CHANNEL = 'inflight-account';
const PING_KEY = 'inflight_email_confirmed_ping';
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Password accounts re-enter their password; an account that only ever
// signed in some other way has none to enter.
function hasPassword(user) {
    const ids = user && Array.isArray(user.identities) ? user.identities : null;
    if (ids && ids.length) return ids.some(i => i.provider === 'email');
    return (user?.app_metadata?.provider || 'email') === 'email';
}

export const EmailChange = {
    _instances: new Set(),
    _listening: false,

    mount(host, { supabase, user, variant = 'desktop', onChanged = null } = {}) {
        if (!host || !supabase || !user) return;
        this._injectStyles();
        this._listen(supabase);
        const inst = { host, supabase, user, variant, onChanged, mode: user.new_email ? 'pending' : 'view', msg: '' };
        host._ec = inst;
        this._instances.add(inst);
        this._render(inst);
        // The pending address is only on a fresh read of the user.
        this._refresh(inst, { quiet: true });
    },

    _render(inst) {
        const { host, user, variant, mode } = inst;
        if (!host.isConnected && inst._rendered) { this._instances.delete(inst); return; }
        inst._rendered = true;
        const email = user.email || '';
        const pending = user.new_email || inst.sentTo || '';
        const pw = hasPassword(user);
        const row = `
            <div class="ec-row">
                ${variant === 'mobile' ? '<span class="ec-label">Email</span>' : ''}
                <span class="ec-current" title="${esc(email)}">${esc(email) || '—'}</span>
                ${mode === 'view' ? '<button type="button" class="ec-link" data-ec="edit">Change</button>' : ''}
            </div>`;
        let body = '';
        if (mode === 'edit') {
            body = `
                <form class="ec-form" novalidate>
                    <label class="ec-field"><span>New email</span>
                        <input type="email" name="email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" required placeholder="you@example.com"></label>
                    ${pw ? `<label class="ec-field"><span>Current password <small>to confirm it’s you</small></span>
                        <input type="password" name="password" autocomplete="current-password" required></label>` : ''}
                    <p class="ec-help">We’ll email a link to the new address. Your email stays <b>${esc(email)}</b> until you open it.</p>
                    <div class="ec-actions">
                        <button type="button" class="ec-btn ec-quiet" data-ec="cancel">Cancel</button>
                        <button type="submit" class="ec-btn ec-primary">Send confirmation</button>
                    </div>
                </form>`;
        } else if (mode === 'pending') {
            body = `
                <div class="ec-pending" role="status">
                    <i class="fa-solid fa-envelope-circle-check" aria-hidden="true"></i>
                    <div>
                        <b>Check ${esc(pending) || 'your new inbox'}</b>
                        <span>Open the link we sent to confirm your new address. If a link also arrives at ${esc(email)}, open that one too. Until then you sign in with ${esc(email)}. This page updates by itself once it’s done.</span>
                        <div class="ec-actions ec-actions-left">
                            <button type="button" class="ec-btn" data-ec="resend">Resend link</button>
                            <button type="button" class="ec-btn ec-quiet" data-ec="edit">Use a different address</button>
                        </div>
                    </div>
                </div>`;
        }
        host.innerHTML = `<div class="ec ec-${variant}">${row}${body}<p class="ec-msg${inst.msgError ? ' is-error' : ''}" role="status">${esc(inst.msg || '')}</p></div>`;
        this._wire(inst);
    },

    _wire(inst) {
        const { host } = inst;
        host.querySelectorAll('[data-ec]').forEach(b => b.addEventListener('click', () => {
            const act = b.dataset.ec;
            if (act === 'edit') { inst.mode = 'edit'; this._say(inst, ''); this._render(inst); host.querySelector('input[name="email"]')?.focus(); }
            else if (act === 'cancel') { inst.mode = inst.user.new_email ? 'pending' : 'view'; this._say(inst, ''); this._render(inst); }
            else if (act === 'resend') this._resend(inst, b);
        }));
        host.querySelector('.ec-form')?.addEventListener('submit', (e) => { e.preventDefault(); this._send(inst, e.target); });
    },

    _say(inst, msg, isError = false) {
        inst.msg = msg;
        inst.msgError = !!isError;
        const el = inst.host.querySelector('.ec-msg');
        if (el) { el.textContent = msg; el.classList.toggle('is-error', !!isError); }
    },

    async _send(inst, form) {
        const { supabase, user } = inst;
        const next = String(form.email.value || '').trim().toLowerCase();
        const password = form.password ? form.password.value : null;
        if (!EMAIL_SHAPE.test(next)) { this._say(inst, 'That doesn’t look like an email address.', true); return; }
        if (next === String(user.email || '').toLowerCase()) { this._say(inst, 'That’s already your email.', true); return; }
        if (form.password && !password) { this._say(inst, 'Enter your current password to confirm it’s you.', true); return; }
        const btn = form.querySelector('.ec-primary');
        btn.disabled = true;
        btn.textContent = 'Sending…';
        try {
            if (form.password) {
                const { error } = await supabase.auth.signInWithPassword({ email: user.email, password });
                if (error) throw new Error('That password isn’t right.');
            }
            const { data, error } = await supabase.auth.updateUser(
                { email: next },
                { emailRedirectTo: `${window.location.origin}/email-confirmed.html` },
            );
            if (error) throw error;
            if (data && data.user) inst.user = data.user;
            inst.sentTo = next;
            inst.mode = 'pending';
            inst.msg = '';
            this._render(inst);
        } catch (err) {
            btn.disabled = false;
            btn.textContent = 'Send confirmation';
            const m = String(err.message || '');
            this._say(inst, /already.*(registered|exists)|in use/i.test(m)
                ? 'That address is already used by another account.'
                : /rate|too many|seconds/i.test(m) ? 'Too many tries — wait a minute and try again.'
                    : (m || 'Couldn’t send that — try again.'), true);
        }
    },

    async _resend(inst, btn) {
        const to = inst.user.new_email || inst.sentTo;
        if (!to) return;
        btn.disabled = true;
        try {
            const { error } = await inst.supabase.auth.resend({
                type: 'email_change', email: to,
                options: { emailRedirectTo: `${window.location.origin}/email-confirmed.html` },
            });
            if (error) throw error;
            this._say(inst, `Sent again to ${to}.`);
        } catch (err) {
            this._say(inst, /rate|too many|seconds/i.test(err.message || '') ? 'Just sent — give it a minute before asking again.' : (err.message || 'Couldn’t resend — try again.'), true);
        } finally {
            setTimeout(() => { btn.disabled = false; }, 30000);
        }
    },

    // Re-read the user: picks up a pending address, and notices a finished
    // change (email differs, nothing pending).
    async _refresh(inst, { quiet = false } = {}) {
        let fresh = null;
        try {
            await inst.supabase.auth.refreshSession().catch(() => {});
            const { data } = await inst.supabase.auth.getUser();
            fresh = data && data.user;
        } catch (_) { return; }
        if (!fresh) return;
        const before = inst.user.email;
        inst.user = fresh;
        if (fresh.email !== before && !fresh.new_email) {
            inst.mode = 'view';
            inst.sentTo = null;
            inst.msg = `Done — your email is now ${fresh.email}.`;
            inst.msgError = false;
            if (typeof inst.onChanged === 'function') inst.onChanged(fresh);
            try { window.showNotification && window.showNotification(`Your email is now ${fresh.email}.`, 'success'); } catch (_) { /* no toast host */ }
        } else if (fresh.new_email && inst.mode !== 'edit') {
            inst.mode = 'pending';
        } else if (!fresh.new_email && inst.mode === 'pending' && !inst.sentTo) {
            inst.mode = 'view';
        }
        if (!(quiet && inst.mode === 'edit')) this._render(inst);
    },

    _refreshAll() {
        this._instances.forEach(inst => {
            if (!inst.host.isConnected) { this._instances.delete(inst); return; }
            if (inst.mode === 'pending' || inst.user.new_email) this._refresh(inst);
        });
    },

    _listen() {
        if (this._listening) return;
        this._listening = true;
        try {
            const bc = new BroadcastChannel(CHANNEL);
            bc.addEventListener('message', (e) => { if (e.data && e.data.type === 'email-confirmed') this._refreshAll(); });
        } catch (_) { /* older browser: the storage ping and focus cover it */ }
        window.addEventListener('storage', (e) => { if (e.key === PING_KEY) this._refreshAll(); });
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this._refreshAll(); });
        window.addEventListener('focus', () => this._refreshAll());
    },

    _injectStyles() {
        if (document.getElementById('ec-styles')) return;
        const st = document.createElement('style');
        st.id = 'ec-styles';
        st.textContent = `
            .ec {
                --ec-text: var(--pui-text-primary, var(--mdui-text, #e4e4e7));
                --ec-muted: var(--pui-text-secondary, var(--mdui-muted, #a1a1aa));
                --ec-line: var(--pui-border, var(--mdui-border-light, rgba(255,255,255,.12)));
                --ec-field: var(--pui-bg-surface, var(--mdui-input, rgba(255,255,255,.06)));
                --ec-accent: var(--pui-accent, var(--mdui-accent, #38bdf8));
                --ec-accent-soft: var(--pui-accent-soft, var(--mdui-accent-soft, rgba(56,189,248,.12)));
                color: var(--ec-text);
            }
            /* The phone's row is a form line; the block takes its whole width. */
            .mdui-email-line { display: block !important; }
            .ec-row { display: flex; align-items: center; gap: 12px; min-height: 42px; }
            .ec-desktop .ec-row { padding: 0 12px; border: 1px solid var(--ec-line); border-radius: 10px; background: var(--ec-field); }
            .ec-label { flex: 0 0 auto; font-weight: 500; }
            .ec-current { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ec-muted); }
            .ec-mobile .ec-current { text-align: right; }
            .ec-link { flex: 0 0 auto; border: 0; background: none; padding: 6px 2px; cursor: pointer; font: inherit; font-weight: 600; color: var(--ec-accent); }
            .ec-form, .ec-pending { margin-top: 10px; padding: 14px; border-radius: 12px; border: 1px solid var(--ec-line); background: var(--ec-field); }
            .ec-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; font-size: .85rem; font-weight: 600; }
            .ec-field small { font-weight: 400; color: var(--ec-muted); margin-left: 4px; }
            .ec-field input {
                width: 100%; box-sizing: border-box; height: 40px; padding: 0 12px; border-radius: 9px;
                border: 1px solid var(--ec-line); background: transparent; color: var(--ec-text); font: inherit; font-size: .95rem;
            }
            .ec-field input:focus { outline: none; border-color: var(--ec-accent); box-shadow: 0 0 0 3px var(--ec-accent-soft); }
            .ec-help { margin: 0 0 12px; font-size: .8rem; line-height: 1.45; color: var(--ec-muted); }
            .ec-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
            .ec-actions-left { justify-content: flex-start; margin-top: 10px; }
            .ec-btn {
                height: 36px; padding: 0 14px; border-radius: 9px; cursor: pointer; font: inherit; font-size: .85rem; font-weight: 600;
                border: 1px solid var(--ec-line); background: transparent; color: var(--ec-text);
            }
            .ec-btn:disabled { opacity: .55; cursor: default; }
            .ec-quiet { border-color: transparent; color: var(--ec-muted); }
            .ec-primary { background: var(--ec-accent); border-color: var(--ec-accent); color: #fff; }
            .ec-pending { display: flex; gap: 12px; align-items: flex-start; }
            .ec-pending > i { color: var(--ec-accent); font-size: 1.2rem; margin-top: 2px; }
            .ec-pending b { display: block; margin-bottom: 4px; }
            .ec-pending span { display: block; font-size: .83rem; line-height: 1.5; color: var(--ec-muted); }
            .ec-msg { margin: 8px 0 0; min-height: 0; font-size: .82rem; color: var(--ec-muted); }
            .ec-msg:empty { display: none; }
            .ec-msg.is-error { color: #ef4444; }
        `;
        document.head.appendChild(st);
    },
};
