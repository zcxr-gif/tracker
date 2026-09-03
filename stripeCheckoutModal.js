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
        const { supabase, payload, heading, subheading } = opts;

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
                        <p class="ifp-checkout-sub">${subheading || '$1.99/mo · cancel anytime'}</p>
                    </div>
                    <button class="ifp-checkout-close" id="ifp-checkout-close" aria-label="Close checkout">&times;</button>
                </div>
                <div class="ifp-checkout-body">
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
            @media (max-width: 560px) {
                .ifp-checkout-layer { padding: 0; align-items: stretch; }
                .ifp-checkout-card { width: 100%; max-height: 100vh; border-radius: 0; }
            }
        `;
        document.head.appendChild(style);
    },
};

if (typeof window !== 'undefined') window.StripeCheckoutModal = StripeCheckoutModal;
