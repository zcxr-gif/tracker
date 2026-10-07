// ─── In-page Stripe checkout ──────────────────────────────────────────────
//
// Payment used to be a full-page trip to Stripe's hosted checkout: the app was
// torn down, the pilot came back on `?payment=success`, and every dropped
// redirect turned into a charge with no entitlement (which is what
// ProAccess's pending-claim machinery exists to clean up after). This mounts
// Stripe's *embedded* checkout in a modal over the app instead — the page never
// unloads, so completion is handled in place and the app is still standing
// behind the modal when it closes.
//
// The hosted flow is still here as the fallback, and it is not a rare path:
//   • Stripe.js blocked or slow to load (ad blockers do this)
//   • an edge function older than this file, which returns only a hosted `url`
//   • the iOS shell, where the native app owns payment entirely
// In each case open() redirects exactly as the old code did and resolves
// 'redirected', so callers keep one code path.
//
// Callers get one of four outcomes and never have to know which flow ran:
//   complete   — paid in the modal; `sessionId` is ready to finalise
//   dismissed  — closed without paying; nothing was charged
//   redirected — the browser is leaving for hosted checkout; do nothing
//   error      — the session could not be created; `error` explains
//
// Before any session exists the modal asks which plan — monthly ($1.99, or the
// Halloween $0.99 first month) or yearly ($19.99, or the Halloween $16.99 first
// year) — and sends it as `plan`.
// A caller that already knows passes payload.plan and the picker is skipped.
//
// A payment method that must leave the page (bank redirects) is not an
// exception the caller handles: Stripe sends it to the session's return_url,
// which is the same `?payment=success` URL as before, and
// AuthUI.checkPaymentStatus() finishes it on the next load.

export const STRIPE_PUBLISHABLE_KEY = 'pk_live_51TRhge6y7GsJq8x0sd1UDluQGEmHK1i32pEubTnbDMji6PvqKINhgK1CNkDj3drjUcHcu5fpfGw5MK24363yDmGL00OInUnl1t';

const STRIPE_JS_URL = 'https://js.stripe.com/v3/';
const STRIPE_JS_TIMEOUT_MS = 9000;

let stripeJsPromise = null;

/** Load Stripe.js once. Resolves null (never rejects) when it can't be had. */
function loadStripeJs() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.resolve(null);
    if (window.Stripe) return Promise.resolve(window.Stripe);
    if (stripeJsPromise) return stripeJsPromise;

    stripeJsPromise = new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            // A failed load must not be cached as "loaded" — let the next
            // attempt try again (the blocker may be a flaky network).
            if (!value) stripeJsPromise = null;
            resolve(value);
        };

        const existing = document.querySelector(`script[src^="${STRIPE_JS_URL}"]`);
        const script = existing || document.createElement('script');
        script.addEventListener('load', () => finish(window.Stripe || null));
        script.addEventListener('error', () => finish(null));

        if (!existing) {
            script.src = STRIPE_JS_URL;
            script.async = true;
            document.head.appendChild(script);
        }

        setTimeout(() => finish(window.Stripe || null), STRIPE_JS_TIMEOUT_MS);
    });

    return stripeJsPromise;
}

function isIOSNative() {
    return typeof window !== 'undefined' && typeof window.isIOSNative === 'function' && window.isIOSNative();
}

export const StripeCheckoutModal = {
    _open: false,
    _checkout: null,
    _cleanup: null,

    /** True when the in-page flow is even worth attempting on this device. */
    isSupported() {
        return typeof window !== 'undefined' && typeof document !== 'undefined' && !isIOSNative();
    },

    /** Fetch Stripe.js ahead of time so the modal opens without a stall. */
    preload() {
        if (!this.isSupported()) return;
        loadStripeJs();
    },

    /**
     * Run a checkout in a modal over the page.
     *
     * @param {object}   opts
     * @param {object}   opts.supabase   client used to create the session
     * @param {object}   opts.payload    body for `create-stripe-checkout` — the
     *                                   same one the hosted flow sends, with
     *                                   `success_url` doubling as the return URL
     * @param {string}  [opts.heading]
     * @param {string}  [opts.subheading]
     * @returns {Promise<{status: 'complete'|'dismissed'|'redirected'|'error', sessionId?: string, error?: string}>}
     */
    async open(opts = {}) {
        const { supabase, heading, subheading } = opts;
        let payload = opts.payload;

        if (!supabase || !payload) {
            return { status: 'error', error: 'Checkout is not configured.' };
        }
        // A second modal over the first would leave two live Stripe iframes
        // fighting over the same session.
        if (this._open) return { status: 'dismissed' };

        // The iOS shell never mounts an in-page checkout; hand straight back to
        // whatever the caller did before.
        if (!this.isSupported()) {
            return this._hostedFallback(supabase, payload);
        }

        this._open = true;
        this._injectStyles();
        const ui = this._renderShell(heading, subheading);

        let settle;
        const done = new Promise((resolve) => { settle = resolve; });
        let finished = false;

        const close = (result) => {
            if (finished) return;
            finished = true;
            this._destroy();
            settle(result);
        };

        this._cleanup = () => close({ status: 'dismissed' });
        ui.closeBtn.addEventListener('click', () => close({ status: 'dismissed' }));
        ui.escHandler = (e) => { if (e.key === 'Escape') close({ status: 'dismissed' }); };
        document.addEventListener('keydown', ui.escHandler);
        this._ui = ui;

        // Monthly or yearly, before a session is made for either. Stripe.js
        // loads in the background while the pilot decides.
        if (!payload.plan) {
            loadStripeJs();
            // Raced against `done`: closing at the picker settles the modal, and
            // open() must return then rather than wait on a choice never made.
            const plan = await Promise.race([this._choosePlan(ui), done.then(() => null)]);
            if (finished) return done;
            payload = Object.assign({}, payload, { plan });
            const sale = !!(window.InflightSale && window.InflightSale.active());
            ui.sub.textContent = plan === 'yearly'
                ? (sale ? 'New subscribers: $16.99 your first year, then $19.99/yr · cancel anytime' : '$19.99/yr · cancel anytime')
                : (window.InflightSale ? window.InflightSale.checkoutLine() : '$1.99/mo · cancel anytime');
        }

        try {
            // Establish that the in-page flow can actually run *before* creating
            // an embedded session — a session created for a checkout that can't
            // mount is a dead session and a second one has to be made anyway.
            const StripeCtor = await loadStripeJs();
            if (finished) return done;

            if (!StripeCtor) {
                this._destroy();
                finished = true;
                settle(await this._hostedFallback(supabase, payload));
                return done;
            }

            const { data, error } = await supabase.functions.invoke('create-stripe-checkout', {
                body: Object.assign({}, payload, {
                    ui_mode: 'embedded',
                    // Only used by payment methods that must leave the page;
                    // everything else completes inside the modal.
                    return_url: payload.success_url,
                }),
            });
            if (finished) return done;

            if (error || data?.error) {
                throw new Error(data?.error || error?.message || 'Could not start checkout.');
            }

            // An edge function older than this file ignores `ui_mode` and hands
            // back a hosted URL. Take it rather than failing the purchase.
            if (!data?.client_secret) {
                if (data?.url) {
                    this._destroy();
                    finished = true;
                    window.location.href = data.url;
                    settle({ status: 'redirected' });
                    return done;
                }
                throw new Error('Could not start checkout.');
            }

            const stripe = StripeCtor(STRIPE_PUBLISHABLE_KEY);
            const sessionId = data.session_id || String(data.client_secret).split('_secret_')[0];

            const checkout = await stripe.initEmbeddedCheckout({
                clientSecret: data.client_secret,
                onComplete: () => close({ status: 'complete', sessionId }),
            });
            if (finished) {
                // Dismissed while Stripe was initialising.
                try { checkout.destroy(); } catch (_) { /* already gone */ }
                return done;
            }

            this._checkout = checkout;
            checkout.mount(ui.mount);
            ui.spinner.style.display = 'none';
            ui.mount.style.display = 'block';
        } catch (err) {
            if (!finished) {
                this._destroy();
                finished = true;
                settle({ status: 'error', error: err.message || 'Could not start checkout.' });
            }
        }

        return done;
    },

    /**
     * Show the monthly / yearly cards and resolve with the plan once the pilot
     * presses Continue. Never resolves if the modal is closed first — open()
     * checks `finished` after awaiting it.
     */
    _choosePlan(ui) {
        const sale = !!(window.InflightSale && window.InflightSale.active());
        ui.sub.textContent = 'Pick a plan · cancel anytime';
        ui.spinner.style.display = 'none';
        ui.plans.hidden = false;
        ui.plans.innerHTML = `
            <div class="ifp-plan-grid" role="radiogroup" aria-label="Plan">
                <button type="button" class="ifp-plan is-selected" id="ifp-plan-monthly" data-plan="monthly" role="radio" aria-checked="true">
                    ${sale ? '<span class="ifp-plan-tag ifp-plan-tag-sale">\uD83C\uDF83 Halloween sale</span>' : ''}
                    <span class="ifp-plan-name">Monthly</span>
                    <span class="ifp-plan-price">${sale ? '<b>$0.99</b> <s>$1.99</s>' : '<b>$1.99</b><span>/mo</span>'}</span>
                    <span class="ifp-plan-note">${sale ? 'First month, then $1.99/mo. New subscribers only.' : 'Billed monthly.'}</span>
                </button>
                <button type="button" class="ifp-plan" id="ifp-plan-yearly" data-plan="yearly" role="radio" aria-checked="false">
                    <span class="ifp-plan-tag${sale ? ' ifp-plan-tag-sale' : ''}">${sale ? '15% off \u00B7 Great value' : 'Best value'}</span>
                    <span class="ifp-plan-name">Yearly</span>
                    <span class="ifp-plan-price">${sale ? '<b>$16.99</b> <s>$19.99</s>' : '<b>$19.99</b><span>/yr</span>'}</span>
                    <span class="ifp-plan-note">${sale ? 'Your first year, then $19.99/yr. Just $1.42/mo. New subscribers only.' : '$1.67/mo, billed yearly. Save 16%.'}</span>
                </button>
            </div>
            <button type="button" class="ifp-plan-continue" id="ifp-plan-continue">Continue</button>
        `;
        let plan = 'monthly';
        const cards = { monthly: ui.plans.querySelector('#ifp-plan-monthly'), yearly: ui.plans.querySelector('#ifp-plan-yearly') };
        Object.keys(cards).forEach((key) => cards[key].addEventListener('click', () => {
            plan = key;
            Object.keys(cards).forEach((k) => {
                if (k === key) cards[k].classList.add('is-selected'); else cards[k].classList.remove('is-selected');
                cards[k].setAttribute('aria-checked', k === key ? 'true' : 'false');
            });
        }));
        return new Promise((resolve) => {
            ui.plans.querySelector('#ifp-plan-continue').addEventListener('click', () => {
                ui.plans.hidden = true;
                ui.spinner.style.display = '';
                resolve(plan);
            });
        });
    },

    /** Close from outside — used when a caller tears its own UI down. */
    dismiss() {
        if (this._cleanup) this._cleanup();
    },

    /**
     * The pre-modal behaviour: create a hosted session and navigate to it.
     * Resolves 'redirected' on success so callers leave the page alone.
     */
    async _hostedFallback(supabase, payload) {
        try {
            const { data, error } = await supabase.functions.invoke('create-stripe-checkout', { body: payload });
            if (error || !data?.url) {
                throw new Error(data?.error || error?.message || 'Could not start checkout.');
            }
            window.location.href = data.url;
            return { status: 'redirected' };
        } catch (err) {
            return { status: 'error', error: err.message || 'Could not start checkout.' };
        }
    },

    _destroy() {
        if (this._checkout) {
            try { this._checkout.destroy(); } catch (_) { /* already unmounted */ }
            this._checkout = null;
        }
        if (this._ui?.escHandler) document.removeEventListener('keydown', this._ui.escHandler);
        const overlay = document.getElementById('ifp-checkout-overlay');
        if (overlay) {
            overlay.classList.remove('ifp-checkout-open');
            setTimeout(() => overlay.remove(), 220);
        }
        this._ui = null;
        this._cleanup = null;
        this._open = false;
    },

    _renderShell(heading, subheading) {
        document.getElementById('ifp-checkout-overlay')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'ifp-checkout-overlay';
        overlay.className = 'ifp-checkout-layer';
        overlay.innerHTML = `
            <div class="ifp-checkout-card" role="dialog" aria-modal="true" aria-label="Secure checkout">
                <div class="ifp-checkout-head">
                    <div>
                        <h3 class="ifp-checkout-title">${heading || 'Subscribe to InFlight Pro'}</h3>
                        <p class="ifp-checkout-sub" id="ifp-checkout-sub">${subheading || (window.InflightSale ? window.InflightSale.checkoutLine() : '$1.99/mo · cancel anytime')}</p>
                    </div>
                    <button class="ifp-checkout-close" id="ifp-checkout-close" aria-label="Close checkout">&times;</button>
                </div>
                <div class="ifp-checkout-body">
                    <div class="ifp-plans" id="ifp-checkout-plans" hidden></div>
                    <div class="ifp-checkout-spinner" id="ifp-checkout-spinner">
                        <i class="fa-solid fa-circle-notch fa-spin"></i>
                        <p>Opening secure checkout…</p>
                    </div>
                    <div id="ifp-checkout-mount" style="display:none;"></div>
                </div>
                <p class="ifp-checkout-foot">
                    <i class="fa-solid fa-lock"></i> Payments are processed securely by Stripe. We never see your card details.
                </p>
            </div>
        `;
        document.body.appendChild(overlay);
        // Next frame, so the opening transition actually runs.
        requestAnimationFrame(() => overlay.classList.add('ifp-checkout-open'));

        return {
            overlay,
            closeBtn: overlay.querySelector('#ifp-checkout-close'),
            sub: overlay.querySelector('#ifp-checkout-sub'),
            plans: overlay.querySelector('#ifp-checkout-plans'),
            spinner: overlay.querySelector('#ifp-checkout-spinner'),
            mount: overlay.querySelector('#ifp-checkout-mount'),
            escHandler: null,
        };
    },

    _injectStyles() {
        if (document.getElementById('ifp-checkout-styles')) return;
        const style = document.createElement('style');
        style.id = 'ifp-checkout-styles';
        style.textContent = `
            .ifp-checkout-layer {
                position: fixed;
                inset: 0;
                z-index: 100000;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
                box-sizing: border-box;
                background: rgba(15, 23, 42, 0.78);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                opacity: 0;
                transition: opacity .25s ease;
                overflow-y: auto;
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            }
            .ifp-checkout-layer.ifp-checkout-open { opacity: 1; }
            .ifp-checkout-card {
                background: #ffffff;
                color: #0f172a;
                width: 520px;
                max-width: 100%;
                max-height: calc(100vh - 40px);
                display: flex;
                flex-direction: column;
                border-radius: 18px;
                box-shadow: 0 30px 70px rgba(2, 6, 23, .45);
                transform: translateY(14px) scale(.985);
                transition: transform .28s cubic-bezier(.16,1,.3,1);
                overflow: hidden;
            }
            .ifp-checkout-open .ifp-checkout-card { transform: none; }
            .ifp-checkout-head {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: 12px;
                padding: 18px 20px 14px;
                border-bottom: 1px solid #e2e8f0;
            }
            .ifp-checkout-title { margin: 0; font-size: 1.05rem; font-weight: 700; }
            .ifp-checkout-sub { margin: 4px 0 0; font-size: .82rem; color: #64748b; }
            .ifp-checkout-close {
                background: #f1f5f9;
                border: none;
                border-radius: 10px;
                width: 32px;
                height: 32px;
                font-size: 1.35rem;
                line-height: 1;
                color: #475569;
                cursor: pointer;
                flex: 0 0 auto;
            }
            .ifp-checkout-close:hover { background: #e2e8f0; color: #0f172a; }
            .ifp-checkout-body {
                padding: 8px 12px 4px;
                overflow-y: auto;
                -webkit-overflow-scrolling: touch;
                flex: 1 1 auto;
                min-height: 220px;
            }
            .ifp-checkout-spinner {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 10px;
                min-height: 220px;
                color: #64748b;
                font-size: .9rem;
            }
            .ifp-checkout-spinner i { font-size: 1.6rem; color: #2563eb; }
            .ifp-checkout-spinner p { margin: 0; }
            .ifp-checkout-foot {
                margin: 0;
                padding: 12px 20px 16px;
                border-top: 1px solid #e2e8f0;
                font-size: .74rem;
                color: #64748b;
                text-align: center;
            }
            .ifp-plans { padding: 12px 8px 14px; }
            .ifp-plan-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
            .ifp-plan {
                position: relative;
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                gap: 4px;
                padding: 16px 14px 14px;
                text-align: left;
                font: inherit;
                color: inherit;
                background: #fff;
                border: 1.5px solid #e2e8f0;
                border-radius: 14px;
                cursor: pointer;
                transition: border-color .15s ease, box-shadow .15s ease;
            }
            .ifp-plan:hover { border-color: #cbd5e1; }
            .ifp-plan.is-selected { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37, 99, 235, .14); }
            .ifp-plan-tag {
                position: absolute;
                top: -9px;
                right: 10px;
                padding: 2px 8px;
                border-radius: 999px;
                background: #2563eb;
                color: #fff;
                font-size: .66rem;
                font-weight: 700;
                letter-spacing: .02em;
            }
            .ifp-plan-tag-sale { background: #ea580c; }
            .ifp-plan-name { font-size: .8rem; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: .06em; }
            .ifp-plan-price { display: flex; align-items: baseline; gap: 6px; }
            .ifp-plan-price b { font-size: 1.6rem; font-weight: 800; color: #0f172a; letter-spacing: -.02em; }
            .ifp-plan-price span { font-size: .85rem; color: #64748b; margin-left: -4px; }
            .ifp-plan-price s { font-size: .9rem; color: #94a3b8; }
            .ifp-plan-note { font-size: .76rem; line-height: 1.35; color: #64748b; }
            .ifp-plan-continue {
                display: block;
                width: 100%;
                margin-top: 14px;
                padding: 12px 16px;
                border: none;
                border-radius: 12px;
                background: #2563eb;
                color: #fff;
                font: inherit;
                font-size: .95rem;
                font-weight: 700;
                cursor: pointer;
            }
            .ifp-plan-continue:hover { background: #1d4ed8; }
            @media (max-width: 380px) { .ifp-plan-grid { grid-template-columns: 1fr; } }
            @media (max-width: 560px) {
                .ifp-checkout-layer { padding: 0; align-items: stretch; }
                .ifp-checkout-card { width: 100%; max-height: 100vh; border-radius: 0; }
            }
        `;
        document.head.appendChild(style);
    },
};

if (typeof window !== 'undefined') window.StripeCheckoutModal = StripeCheckoutModal;
