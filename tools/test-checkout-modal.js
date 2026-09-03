// test-checkout-modal.js — paying without leaving the app.
//
// Checkout used to be a full-page trip to Stripe. It is now a modal over the
// running app, and the risk moved with it: the page no longer reloads, so
// nothing is re-read from the URL and nothing re-runs on the way back. Every
// outcome has to be settled in place, by code, exactly once.
//
// What is pinned down here is the part that costs money when it is wrong:
//
//   • an embedded session is asked for correctly (ui_mode + return_url, and
//     the success URL preserved for the payment methods that must redirect);
//   • a completed payment resolves with the session id the finaliser needs —
//     without it a pilot is charged and never provisioned;
//   • a closed modal resolves 'dismissed' and nothing else, so a cancelled
//     checkout never looks like a paid one;
//   • the fallbacks still redirect — Stripe.js blocked, or an edge function too
//     old to know what `ui_mode` means — because a purchase that cannot mount
//     must still be completable;
//   • ProAccess.finalizeCheckout() verifies with the server BEFORE reporting
//     an entitlement, and reports failure honestly when the grant never lands.
//
// Node builtins only.
//
// Run:  node tools/test-checkout-modal.js
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');

let pass = 0; let fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log(`  ✓ ${name}`); pass++; }
    else { console.error(`  ✗ ${name}${extra ? `\n      ${extra}` : ''}`); fail++; }
};

// --- a DOM just big enough for a modal -----------------------------------
// Only what stripeCheckoutModal.js actually touches. Elements declared in an
// innerHTML string are discovered by their id, which is how the module finds
// its own close button, spinner and mount point.
class El {
    constructor(tag = 'div') {
        this.tagName = tag;
        this.children = [];
        this.style = {};
        this.attributes = {};
        this.textContent = '';
        this._listeners = {};
        this._ids = new Map();
        this.classList = {
            _set: new Set(),
            add: (c) => this.classList._set.add(c),
            remove: (c) => this.classList._set.delete(c),
            contains: (c) => this.classList._set.has(c),
        };
    }
    set innerHTML(html) {
        this._innerHTML = html;
        this._ids = new Map();
        for (const m of String(html).matchAll(/id="([^"]+)"/g)) {
            const child = new El('div');
            child.id = m[1];
            this._ids.set(m[1], child);
            registry.set(m[1], child);
        }
    }
    get innerHTML() { return this._innerHTML || ''; }
    appendChild(child) { this.children.push(child); return child; }
    remove() {
        this.removed = true;
        if (this.id) registry.delete(this.id);
        this._ids.forEach((_, k) => registry.delete(k));
    }
    setAttribute(k, v) { this.attributes[k] = v; }
    querySelector(sel) {
        if (sel.startsWith('#')) return this._ids.get(sel.slice(1)) || null;
        return null;
    }
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    removeEventListener(type, fn) {
        this._listeners[type] = (this._listeners[type] || []).filter(f => f !== fn);
    }
    dispatch(type, event = {}) { (this._listeners[type] || []).forEach(fn => fn(event)); }
}

const registry = new Map();
const docListeners = {};

global.El = El;
global.document = {
    head: new El('head'),
    body: new El('body'),
    createElement: (tag) => new El(tag),
    getElementById: (id) => registry.get(id) || null,
    querySelector: () => null,
    addEventListener: (type, fn) => { (docListeners[type] ||= []).push(fn); },
    removeEventListener: (type, fn) => {
        docListeners[type] = (docListeners[type] || []).filter(f => f !== fn);
    },
};
global.window = { location: { origin: 'https://inflight.info', href: 'https://inflight.info/' } };
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
global.localStorage = (() => {
    const store = new Map();
    return {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
    };
})();

// document.body.appendChild has to register the overlay by id, the way a real
// DOM would once the node is in the tree.
const realAppend = global.document.body.appendChild.bind(global.document.body);
global.document.body.appendChild = (child) => {
    if (child.id) registry.set(child.id, child);
    return realAppend(child);
};

const tick = () => new Promise(r => setTimeout(r, 0));

/** A Supabase double whose `functions.invoke` is scripted per call. */
function fakeSupabase(handler) {
    const calls = [];
    return {
        calls,
        functions: {
            invoke: async (name, opts) => {
                calls.push({ name, body: opts?.body });
                return handler(name, opts?.body, calls.length);
            },
        },
    };
}

(async () => {
    const { StripeCheckoutModal } = await import(pathToFileURL(path.join(ROOT, 'stripeCheckoutModal.js')).href);
    const { ProAccess } = await import(pathToFileURL(path.join(ROOT, 'proAccess.js')).href);

    const payload = {
        email: 'pilot@example.com',
        user_id: 'user-1',
        success_url: 'https://inflight.info?payment=success&session_id={CHECKOUT_SESSION_ID}',
        cancel_url: 'https://inflight.info?payment=cancel',
        is_renew: true,
    };

    // ── An embedded session, completed in the modal ──────────────────────
    console.log('\nthe in-page checkout');
    {
        let completeNow = null;
        global.window.Stripe = () => ({
            initEmbeddedCheckout: async ({ clientSecret, onComplete }) => {
                completeNow = onComplete;
                return { mount() { this.mounted = true; }, destroy() { this.destroyed = true; }, clientSecret };
            },
        });

        const supabase = fakeSupabase(() => ({
            data: { client_secret: 'cs_test_123_secret_abc', session_id: 'cs_test_123', ui_mode: 'embedded' },
            error: null,
        }));

        const opened = StripeCheckoutModal.open({ supabase, payload });
        // Let the loader and the session creation settle before completing.
        for (let i = 0; i < 6 && !completeNow; i++) await tick();

        const sent = supabase.calls[0]?.body || {};
        ok('asks for an embedded session', sent.ui_mode === 'embedded');
        ok('sends the success URL as the return URL, for redirect-based methods',
            sent.return_url === payload.success_url);
        ok('keeps the rest of the payload intact',
            sent.email === payload.email && sent.user_id === 'user-1' && sent.is_renew === true);
        ok('mounts rather than navigating', global.window.location.href === 'https://inflight.info/');

        completeNow();
        const result = await opened;
        ok('a completed payment resolves complete', result.status === 'complete', JSON.stringify(result));
        ok('…carrying the session id the finaliser needs', result.sessionId === 'cs_test_123');
        const overlay = document.getElementById('ifp-checkout-overlay');
        ok('the modal starts closing the moment it completes',
            overlay !== null && overlay.classList.contains('ifp-checkout-open') === false);
        await new Promise(r => setTimeout(r, 300));   // past the close transition
        ok('…and is gone from the page once it has', overlay.removed === true);
    }

    // ── Closed without paying ────────────────────────────────────────────
    {
        global.window.Stripe = () => ({
            initEmbeddedCheckout: async () => ({ mount() {}, destroy() {} }),
        });
        const supabase = fakeSupabase(() => ({
            data: { client_secret: 'cs_live_9_secret_z', session_id: 'cs_live_9' }, error: null,
        }));

        const opened = StripeCheckoutModal.open({ supabase, payload });
        for (let i = 0; i < 6; i++) await tick();

        document.getElementById('ifp-checkout-close').dispatch('click');
        const result = await opened;
        ok('closing resolves dismissed, never complete', result.status === 'dismissed');
        ok('…and hands back no session id, so nothing can be finalised',
            result.sessionId === undefined);
    }

    // ── The fallbacks still buy the subscription ─────────────────────────
    console.log('\nthe fallbacks');
    {
        // An edge function that predates embedded checkout answers with a URL.
        global.window.Stripe = () => ({ initEmbeddedCheckout: async () => ({ mount() {}, destroy() {} }) });
        global.window.location.href = 'https://inflight.info/';
        const supabase = fakeSupabase(() => ({ data: { url: 'https://checkout.stripe.com/c/old' }, error: null }));

        const result = await StripeCheckoutModal.open({ supabase, payload });
        ok('an old edge function still gets the pilot to checkout', result.status === 'redirected');
        ok('…by navigating to the hosted page', global.window.location.href === 'https://checkout.stripe.com/c/old');
    }
    {
        // Stripe.js blocked: no embedded session is even requested.
        delete global.window.Stripe;
        global.window.location.href = 'https://inflight.info/';
        const supabase = fakeSupabase(() => ({ data: { url: 'https://checkout.stripe.com/c/hosted' }, error: null }));

        const result = await StripeCheckoutModal.open({ supabase, payload });
        ok('a blocked Stripe.js falls back to the hosted page', result.status === 'redirected');
        ok('…and asks for a hosted session, not an embedded one',
            supabase.calls.length === 1 && supabase.calls[0].body.ui_mode === undefined);
    }
    {
        global.window.Stripe = () => ({ initEmbeddedCheckout: async () => ({ mount() {}, destroy() {} }) });
        global.window.location.href = 'https://inflight.info/';
        const supabase = fakeSupabase(() => ({ data: { error: 'Upgrade is missing the account id.' }, error: null }));

        const result = await StripeCheckoutModal.open({ supabase, payload });
        ok('a refused session is an error, not a silent dismissal', result.status === 'error');
        ok('…and says why', /account id/.test(result.error || ''));
    }

    // ── Settling the payment in place ────────────────────────────────────
    console.log('\nfinalising without a page load');
    {
        const supabaseFor = (opts) => {
            const invoked = [];
            return {
                invoked,
                auth: {
                    refreshSession: async () => ({}),
                    getSession: async () => ({ data: { session: { user: { id: 'user-1', email: 'p@x.io' } } } }),
                },
                from: () => ({
                    select: () => ({
                        eq: () => ({ maybeSingle: async () => ({ data: { is_pro: opts.isPro }, error: null }) }),
                    }),
                    insert: async () => ({ error: null }),
                }),
                functions: {
                    invoke: async (name, o) => {
                        invoked.push({ name, body: o?.body });
                        if (name === 'process-stripe-payment') return opts.processResult;
                        if (name === 'restore-pro-access') return { data: { restored: false }, error: null };
                        return { data: {}, error: null };
                    },
                },
            };
        };

        const granted = supabaseFor({ isPro: true, processResult: { data: { success: true }, error: null } });
        const good = await ProAccess.finalizeCheckout(granted, 'cs_test_123');
        ok('verifies the session with the server before claiming anything',
            granted.invoked[0]?.name === 'process-stripe-payment' && granted.invoked[0]?.body?.sessionId === 'cs_test_123');
        ok('a granted entitlement reads as Pro', good.isPro === true && good.reason === 'granted');

        const ungranted = supabaseFor({ isPro: false, processResult: { data: { error: 'card declined' }, error: null } });
        const bad = await ProAccess.finalizeCheckout(ungranted, 'cs_test_456');
        ok('a failed verification never reports Pro', bad.isPro === false);
        ok('…and still asks Stripe directly rather than giving up',
            ungranted.invoked.some(c => c.name === 'restore-pro-access'));
        ok('…keeping the reason for the pilot to quote', typeof bad.reason === 'string' && bad.reason.length > 0);

        const noSession = await ProAccess.finalizeCheckout(granted, null);
        ok('no session id is refused outright, not guessed at', noSession.isPro === false && noSession.reason === 'no-session-id');
    }

    console.log(`\n${pass} passing${fail ? `, ${fail} failing` : ''}`);
    process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
