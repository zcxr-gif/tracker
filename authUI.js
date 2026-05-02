// ─── Stripe configuration ─────────────────────────────────────────────────
// Replace with your Stripe publishable key. Use pk_test_... while testing.
const STRIPE_PUBLISHABLE_KEY = 'pk_test_51TRhge6y7GsJq8x03msaDldYeLpaQWEdZ26Pf32IwWcU1KGeSbu5MhhE5h1nWIcNtUMRzJOGgHuGy4cVJXY6fcFG00OoJDbppz';
// ──────────────────────────────────────────────────────────────────────────

export const AuthUI = {
    _isOpen: false,
    _mode: 'signin',
    _supabase: null,
    _tempSignUpData: null,

    init(supabaseClient) {
        this._supabase = supabaseClient;
        this.setupRecoveryListener();
    },

    setupRecoveryListener() {
        this._supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'PASSWORD_RECOVERY') {
                this.open('update_password');
            }
        });

        if (window.location.hash && window.location.hash.includes('type=recovery')) {
            window.history.replaceState(null, '', window.location.pathname);
            setTimeout(() => {
                this.open('update_password');
            }, 500);
        }
    },

    async open(mode = 'signin') {
        if (!this._supabase) {
            console.error("AuthUI: Supabase client not initialized.");
            return;
        }

        const { data } = await this._supabase.auth.getSession();
        
        if (data?.session?.user && mode !== 'update_password') {
            import('./profileUI.js').then(module => {
                if (!module.ProfileUI._supabase) {
                    module.ProfileUI.init(this._supabase);
                }
                module.ProfileUI.open(data.session.user);
            }).catch(err => console.error("Failed to load ProfileUI:", err));
            return; 
        }

        this._mode = mode;
        this._tempSignUpData = null; 
        
        if (!document.getElementById('auth-modal-overlay')) {
            this.renderContainer();
            this.injectStyles();
            this.attachGlobalListeners();
        }
        
        this.renderContent();
        
        setTimeout(() => {
            document.getElementById('auth-modal-overlay')?.classList.add('open');
            this._isOpen = true;
        }, 10);
    },

    close() {
        const overlay = document.getElementById('auth-modal-overlay');
        if (overlay) overlay.classList.remove('open');
        this._isOpen = false;
        this._tempSignUpData = null;
    },

    switchMode(mode) {
        if (this._mode === mode) return; 
        this._mode = mode;
        this.renderContent();
    },

    renderContainer() {
        const html = `
            <div id="auth-modal-overlay" class="auth-wrapper-layer">
                <div class="auth-modal-card" id="auth-modal-card"></div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);
    },

    renderContent() {
        const card = document.getElementById('auth-modal-card');
        if (!card) return;

        const isSignIn = this._mode === 'signin';
        const isSignUp = this._mode === 'signup';
        const isPayment = this._mode === 'payment';
        const isForgot = this._mode === 'forgot';
        const isUpdatePassword = this._mode === 'update_password';

        let html = `
            <div class="auth-premium-accent"></div>
            <button class="auth-close-btn" id="close-auth-ui" aria-label="Close">&times;</button>
            <div class="auth-header-section">
                <img src="Images/InflightPro.png" alt="InFlight Pro Logo" class="auth-brand-logo" onerror="this.style.display='none'">
        `;

        if (!isPayment && !isForgot && !isUpdatePassword) {
            html += `
                <div class="auth-toggle-container">
                    <div class="auth-toggle-pill">
                        <button class="auth-toggle-btn ${isSignIn ? 'active' : ''}" data-mode="signin">Sign In</button>
                        <button class="auth-toggle-btn ${isSignUp ? 'active' : ''}" data-mode="signup">Sign Up</button>
                    </div>
                </div>
            `;
        } else if (isPayment) {
            html += `
                <div class="auth-payment-header">
                    <h3 style="margin: 0; color: #0f172a; font-size: 1.25rem; font-weight: 700;">Complete Pro Setup</h3>
                    <p style="margin: 6px 0 0; color: #64748b; font-size: 0.9rem;">Secure monthly subscription of $1.99</p>
                </div>
            `;
        } else if (isForgot) {
            html += `
                <div class="auth-payment-header">
                    <h3 style="margin: 0; color: #0f172a; font-size: 1.25rem; font-weight: 700;">Reset Password</h3>
                </div>
            `;
        } else if (isUpdatePassword) {
            html += `
                <div class="auth-payment-header">
                    <h3 style="margin: 0; color: #0f172a; font-size: 1.25rem; font-weight: 700;">Set New Password</h3>
                </div>
            `;
        }

        html += `</div><div class="auth-form-body">`;

        if (isPayment) {
            html += `
                <div class="auth-payment-selection">
                    <div class="auth-premium-notice">
                        <i class="fa-solid fa-shield-halved auth-premium-icon"></i>
                        <div class="auth-premium-text">
                            Secure payment hosted by <strong>Stripe</strong>.
                        </div>
                    </div>

                    <button class="auth-submit-btn auth-submit-pro" id="stripe-checkout-btn">
                        <i class="fa-brands fa-apple" style="margin-right: 8px;"></i> Pay with Apple Pay or Card
                    </button>
                    
                    <div class="auth-payment-badges">
                        <span class="payment-badge"><i class="fa-brands fa-cc-visa"></i></span>
                        <span class="payment-badge"><i class="fa-brands fa-cc-mastercard"></i></span>
                        <span class="payment-badge"><i class="fa-brands fa-cc-amex"></i></span>
                        <span class="payment-badge"><i class="fa-brands fa-apple-pay"></i></span>
                    </div>

                    <div class="payment-or-divider"><span>OR PAY WITH PAYPAL</span></div>

                    <div id="paypal-button-container" style="min-height: 50px; margin-bottom: 8px;"></div>
                </div>

                <div id="auth-error-message" class="auth-error" style="display: none;"></div>
                <div id="auth-loading-message" style="display: none; text-align: center; color: #64748b; margin-bottom: 20px;">
                    <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 1.5rem; margin-bottom: 12px; color: #2563eb;"></i>
                    <p style="margin: 0; font-size: 0.95rem; font-weight: 600;">Redirecting to secure checkout...</p>
                </div>
                <button class="auth-back-btn" id="auth-back-to-signup">Back to Details</button>
            `;
        } else if (isForgot) {
            html += `
                <div class="auth-input-group" id="auth-forgot-input-group">
                    <label>Email Address</label>
                    <div class="auth-field-wrapper">
                        <i class="fa-solid fa-envelope auth-field-icon"></i>
                        <input type="email" id="auth-forgot-email" placeholder="pilot@example.com" class="auth-input" required>
                    </div>
                </div>
                <div id="auth-error-message" class="auth-error" style="display: none;"></div>
                <div id="auth-success-message" class="auth-success" style="display: none;">Reset link sent! Check your inbox.</div>
                <button class="auth-submit-btn" id="auth-submit-forgot-btn">Send Reset Link</button>
                <button class="auth-back-btn" id="auth-back-to-signin">Back to Sign In</button>
            `;
        } else if (isUpdatePassword) {
            html += `
                <div class="auth-input-group" id="auth-update-password-group">
                    <label>New Password</label>
                    <div class="auth-field-wrapper">
                        <i class="fa-solid fa-lock auth-field-icon"></i>
                        <input type="password" id="auth-new-password" placeholder="••••••••" class="auth-input" required>
                    </div>
                </div>
                <div class="auth-input-group" id="auth-update-confirm-group">
                    <label>Confirm Password</label>
                    <div class="auth-field-wrapper">
                        <i class="fa-solid fa-lock auth-field-icon"></i>
                        <input type="password" id="auth-confirm-password" placeholder="••••••••" class="auth-input" required>
                    </div>
                </div>
                <div id="auth-error-message" class="auth-error" style="display: none;"></div>
                <div id="auth-success-message" class="auth-success" style="display: none;"></div>
                <button class="auth-submit-btn" id="auth-submit-update-btn">Save New Password</button>
            `;
        } else {
            let formFields = '';
            if (isSignUp) {
                formFields += `
                    <div class="auth-premium-notice">
                        <i class="fa-solid fa-gem auth-premium-icon"></i>
                        <div class="auth-premium-text"><strong>InFlight Pro</strong> requires $1.99/mo.</div>
                    </div>
                    <div class="auth-input-group">
                        <label>Full Name</label>
                        <div class="auth-field-wrapper">
                            <i class="fa-solid fa-user auth-field-icon"></i>
                            <input type="text" id="auth-name" placeholder="John Doe" class="auth-input" required>
                        </div>
                    </div>
                `;
            }
            const storedEmail = localStorage.getItem('inflight_remembered_email') || '';
            formFields += `
                <div class="auth-input-group">
                    <label>Email Address</label>
                    <div class="auth-field-wrapper">
                        <i class="fa-solid fa-envelope auth-field-icon"></i>
                        <input type="email" id="auth-email" placeholder="pilot@example.com" class="auth-input" value="${storedEmail}" required>
                    </div>
                </div>
                <div class="auth-input-group">
                    <label>Password</label>
                    <div class="auth-field-wrapper">
                        <i class="fa-solid fa-lock auth-field-icon"></i>
                        <input type="password" id="auth-password" placeholder="••••••••" class="auth-input" required>
                    </div>
                </div>
            `;
            let optionsHtml = isSignIn ? `
                <div class="auth-options">
                    <label class="auth-checkbox"><input type="checkbox" id="auth-remember" checked><span>Remember me</span></label>
                    <a href="#" class="auth-forgot-link" id="auth-forgot-password">Forgot password?</a>
                </div>` : `
                <div class="auth-options">
                    <label class="auth-checkbox"><input type="checkbox" id="auth-terms" required><span>I agree to the <a href="#" class="auth-terms-link">Terms</a></span></label>
                </div>`;
            html += `${formFields}${optionsHtml}<div id="auth-error-message" class="auth-error" style="display: none;"></div><button class="auth-submit-btn ${isSignUp ? 'auth-submit-pro' : ''}" id="auth-submit-btn">${isSignIn ? 'Sign In' : 'Continue to Payment'}</button>`;
        }

        html += `</div>`;
        card.innerHTML = html;
        this.attachContentListeners(); 

        if (isPayment) {
            this.loadPayPalAndRender();
        }
    },

    showError(message) {
        const errorDiv = document.getElementById('auth-error-message');
        if (errorDiv) { errorDiv.textContent = message; errorDiv.style.display = 'block'; }
    },

    hideError() {
        const errorDiv = document.getElementById('auth-error-message');
        if (errorDiv) errorDiv.style.display = 'none';
    },

    showSuccess() {
        const successDiv = document.getElementById('auth-success-message');
        if (successDiv) successDiv.style.display = 'block';
    },

    setLoading(buttonId, isLoading, originalText) {
        const btn = document.getElementById(buttonId);
        if (!btn) return;
        btn.disabled = isLoading;
        btn.innerHTML = isLoading ? `<i class="fa-solid fa-circle-notch fa-spin"></i> Processing...` : originalText;
        btn.style.opacity = isLoading ? '0.7' : '1';
    },

    async startStripeCheckout() {
        if (!this._tempSignUpData) return;
        this.hideError();
        const loadingDiv = document.getElementById('auth-loading-message');
        const selectionDiv = document.querySelector('.auth-payment-selection');
        const backBtn = document.getElementById('auth-back-to-signup');

        if (loadingDiv) loadingDiv.style.display = 'block';
        if (selectionDiv) selectionDiv.style.display = 'none';
        if (backBtn) backBtn.style.display = 'none';

        try {
            const { data, error } = await this._supabase.functions.invoke('create-stripe-checkout', {
                body: {
                    email: this._tempSignUpData.email,
                    name: this._tempSignUpData.name,
                    success_url: window.location.origin + '/success',
                    cancel_url: window.location.origin
                }
            });

            if (error || !data?.url) throw new Error(data?.error || 'Checkout failed to initialize.');
            window.location.href = data.url; // Redirect to Stripe-hosted page
        } catch (err) {
            if (loadingDiv) loadingDiv.style.display = 'none';
            if (selectionDiv) selectionDiv.style.display = 'block';
            if (backBtn) backBtn.style.display = 'block';
            this.showError(err.message);
        }
    },

    async loadPayPalAndRender() {
        if (!window.paypal) {
            const script = document.createElement('script');
            script.src = "https://www.paypal.com/sdk/js?client-id=AdTwNEAJlyx8dQ-NiJJdnCFL9cC8HuJ78Xe-ve9hqv0YxysE6eSbkHc2NuCSKoNd3DmLE-qxp9v2iRVM&currency=USD&vault=true&intent=subscription";
            script.async = true;
            document.body.appendChild(script);
            await new Promise(r => script.onload = r);
        }
        window.paypal.Buttons({
            createSubscription: (data, actions) => actions.subscription.create({ 'plan_id': 'P-7R42707536163664TNGWLCDA' }),
            onApprove: async (paymentData) => {
                this.hideError();
                try {
                    const { error } = await this._supabase.functions.invoke('process-payment', {
                        body: { ...this._tempSignUpData, subscriptionID: paymentData.subscriptionID }
                    });
                    if (error) throw error;
                    await this._supabase.auth.signInWithPassword({ email: this._tempSignUpData.email, password: this._tempSignUpData.password });
                    this.close(); this.open();
                } catch (err) { this.showError(err.message); }
            }
        }).render('#paypal-button-container');
    },

    attachGlobalListeners() {
        const overlay = document.getElementById('auth-modal-overlay');
        let isClickInsideCard = false;

        // Prevent closing when clicking/dragging inside the card
        document.getElementById('auth-modal-card')?.addEventListener('mousedown', () => {
            isClickInsideCard = true;
        });

        overlay?.addEventListener('mousedown', (e) => {
            if (e.target === overlay) isClickInsideCard = false;
        });

        overlay?.addEventListener('mouseup', (e) => {
            if (e.target === overlay && !isClickInsideCard) {
                this.close();
            }
            isClickInsideCard = false;
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this._isOpen) this.close();
        });
    },

    attachContentListeners() {
        document.getElementById('close-auth-ui')?.addEventListener('click', () => this.close());
        document.querySelectorAll('.auth-toggle-btn').forEach(btn => btn.addEventListener('click', (e) => this.switchMode(e.target.dataset.mode)));

        document.getElementById('auth-submit-btn')?.addEventListener('click', async () => {
            this.hideError();
            const email = document.getElementById('auth-email')?.value;
            const password = document.getElementById('auth-password')?.value;
            const name = document.getElementById('auth-name')?.value || '';

            if (this._mode === 'signup') {
                this._tempSignUpData = { email, password, name };
                this.switchMode('payment');
            } else {
                this.setLoading('auth-submit-btn', true, 'Sign In');
                const { error } = await this._supabase.auth.signInWithPassword({ email, password });
                this.setLoading('auth-submit-btn', false, 'Sign In');
                if (error) this.showError(error.message); else { this.close(); this.open(); }
            }
        });

        document.getElementById('stripe-checkout-btn')?.addEventListener('click', () => this.startStripeCheckout());
        document.getElementById('auth-back-to-signup')?.addEventListener('click', () => this.switchMode('signup'));
    },

    injectStyles() {
        if (document.getElementById('auth-ui-styles')) return;
        const css = `
            .auth-wrapper-layer {
                position: fixed; inset: 0; background: rgba(15, 23, 42, 0.75); backdrop-filter: blur(12px);
                display: flex; align-items: center; justify-content: center; opacity: 0; visibility: hidden;
                transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1); z-index: 9999; padding: 20px;
            }
            .auth-wrapper-layer.open { opacity: 1; visibility: visible; }
            .auth-modal-card {
                background: #fff; width: 420px; max-width: 100%; border-radius: 20px; position: relative;
                box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25); transform: scale(0.95); transition: all 0.4s cubic-bezier(0.16,1,0.3,1);
            }
            .auth-wrapper-layer.open .auth-modal-card { transform: scale(1); }
            .auth-premium-accent { height: 4px; width: 100%; background: linear-gradient(90deg, #2563eb, #38bdf8, #2563eb); background-size: 200%; animation: shine 3s linear infinite; }
            @keyframes shine { to { background-position: 200% center; } }
            .auth-input {
                width: 100%; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
                padding: 12px 16px 12px 42px; font-size: 16px !important; /* Fix for iOS zoom */
                transition: all 0.2s; outline: none; box-sizing: border-box;
            }
            .auth-submit-btn { width: 100%; background: #0f172a; color: #fff; border: none; border-radius: 10px; padding: 14px; font-weight: 600; cursor: pointer; }
            .auth-submit-pro { background: #000; display: flex; align-items: center; justify-content: center; }
            .auth-submit-pro:hover { background: #262626; }
            .auth-payment-badges { display: flex; justify-content: center; gap: 12px; margin-top: 12px; opacity: 0.6; font-size: 1.4rem; color: #475569; }
            .payment-or-divider { display: flex; align-items: center; gap: 12px; color: #64748b; font-size: 0.7rem; font-weight: 700; margin: 20px 0 16px; }
            .payment-or-divider::before, .payment-or-divider::after { content: ''; flex: 1; height: 1px; background: #e2e8f0; }
            .auth-close-btn { position: absolute; top: 16px; right: 16px; background: none; border: none; font-size: 1.5rem; color: #64748b; cursor: pointer; }
            .auth-header-section { padding: 32px 28px 20px; text-align: center; }
            .auth-brand-logo { height: 42px; margin: 0 auto 20px; }
            .auth-form-body { padding: 0 28px 32px; }
        `;
        const style = document.createElement('style');
        style.id = 'auth-ui-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }
};