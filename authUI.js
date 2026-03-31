export const AuthUI = {
    _isOpen: false,
    _mode: 'signin',
    _supabase: null,
    _tempSignUpData: null,

    init(supabaseClient) {
        this._supabase = supabaseClient;
    },

    async open(mode = 'signin') {
        if (!this._supabase) {
            console.error("AuthUI: Supabase client not initialized. Call AuthUI.init(supabase) first.");
            return;
        }

        const { data } = await this._supabase.auth.getSession();
        
        if (data?.session?.user) {
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

        let html = `
            <button class="auth-close-btn" id="close-auth-ui" aria-label="Close">&times;</button>
            <div class="auth-header-section">
                <img src="Images/inflight.png" alt="InFlight Logo" class="auth-brand-logo" onerror="this.style.display='none'">
        `;

        if (!isPayment) {
            html += `
                <div class="auth-toggle-container">
                    <div class="auth-toggle-pill">
                        <button class="auth-toggle-btn ${isSignIn ? 'active' : ''}" data-mode="signin">Sign In</button>
                        <button class="auth-toggle-btn ${isSignUp ? 'active' : ''}" data-mode="signup">Sign Up</button>
                    </div>
                </div>
            `;
        } else {
            html += `
                <div class="auth-payment-header">
                    <h3 style="margin: 0; color: #0f172a; font-size: 1.2rem;">Complete Setup</h3>
                    <p style="margin: 4px 0 0; color: #64748b; font-size: 0.85rem;">Monthly payment of $1 for full access</p>
                </div>
            `;
        }

        html += `</div><div class="auth-form-body">`;

        if (isPayment) {
            html += `
                <div id="paypal-button-container" style="min-height: 200px; margin-bottom: 20px;"></div>
                <div id="auth-error-message" class="auth-error" style="display: none;"></div>
                <div id="auth-loading-message" style="display: none; text-align: center; color: #64748b; margin-bottom: 20px;">
                    <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 1.5rem; margin-bottom: 10px;"></i>
                    <p style="margin: 0; font-size: 0.9rem; font-weight: 600;">Processing your account...</p>
                </div>
                <button class="auth-back-btn" id="auth-back-to-signup">Back</button>
            `;
        } else {
            let formFields = '';
            
            if (isSignUp) {
                formFields += `
                    <div class="auth-input-group">
                        <label>Full Name</label>
                        <div class="auth-field-wrapper">
                            <i class="fa-solid fa-user auth-field-icon"></i>
                            <input type="text" id="auth-name" placeholder="John Doe" class="auth-input" required>
                        </div>
                    </div>
                `;
            }

            formFields += `
                <div class="auth-input-group">
                    <label>Email Address</label>
                    <div class="auth-field-wrapper">
                        <i class="fa-solid fa-envelope auth-field-icon"></i>
                        <input type="email" id="auth-email" placeholder="pilot@example.com" class="auth-input" required>
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

            let optionsHtml = '';
            if (isSignIn) {
                optionsHtml = `
                    <div class="auth-options">
                        <label class="auth-checkbox">
                            <input type="checkbox" id="auth-remember" checked>
                            <span>Remember me</span>
                        </label>
                        <a href="#" class="auth-forgot-link" id="auth-forgot-password">Forgot password?</a>
                    </div>
                `;
            } else {
                optionsHtml = `
                    <div class="auth-options">
                        <label class="auth-checkbox">
                            <input type="checkbox" id="auth-terms" required>
                            <span>I agree to the <a href="terms.html" target="_blank" class="auth-terms-link">Terms of Use</a> & <a href="privacy.html" target="_blank" class="auth-terms-link">Privacy Policy</a></span>
                        </label>
                    </div>
                `;
            }

            const submitText = isSignIn ? "Sign In" : "Continue to Payment";

            html += `
                ${formFields}
                ${optionsHtml}
                
                <div id="auth-error-message" class="auth-error" style="display: none;"></div>

                <button class="auth-submit-btn" id="auth-submit-btn">${submitText}</button>
            `;
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
        if (errorDiv) {
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
        }
    },

    hideError() {
        const errorDiv = document.getElementById('auth-error-message');
        if (errorDiv) {
            errorDiv.style.display = 'none';
        }
    },

    setLoading(buttonId, isLoading, originalText) {
        const btn = document.getElementById(buttonId);
        if (!btn) return;
        
        if (isLoading) {
            btn.disabled = true;
            btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Processing...`;
            btn.style.opacity = '0.7';
        } else {
            btn.disabled = false;
            btn.innerHTML = originalText;
            btn.style.opacity = '1';
        }
    },

    async loadPayPalAndRender() {
        if (!window.paypal) {
            const script = document.createElement('script');
            // Added &enable-funding=applepay to explicitly render the Apple Pay button
            script.src = "https://www.paypal.com/sdk/js?client-id=AdTwNEAJlyx8dQ-NiJJdnCFL9cC8HuJ78Xe-ve9hqv0YxysE6eSbkHc2NuCSKoNd3DmLE-qxp9v2iRVM&currency=USD&vault=true&intent=subscription&enable-funding=applepay";
            script.async = true;
            document.body.appendChild(script);

            await new Promise((resolve, reject) => {
                script.onload = resolve;
                script.onerror = reject;
            });
        }

        const container = document.getElementById('paypal-button-container');
        if (container) container.innerHTML = ''; 

        window.paypal.Buttons({
            createSubscription: function(data, actions) {
                return actions.subscription.create({
                    'plan_id': 'P-7R42707536163664TNGWLCDA' 
                });
            },
            onApprove: async (paymentData, actions) => {
                this.hideError();
                
                const loadingDiv = document.getElementById('auth-loading-message');
                const btnContainer = document.getElementById('paypal-button-container');
                const backBtn = document.getElementById('auth-back-to-signup');

                if (loadingDiv) loadingDiv.style.display = 'block';
                if (btnContainer) btnContainer.style.display = 'none';
                if (backBtn) backBtn.style.display = 'none';

                try {
                    const payload = {
                        email: this._tempSignUpData.email,
                        password: this._tempSignUpData.password,
                        name: this._tempSignUpData.name,
                        subscriptionID: paymentData.subscriptionID
                    };

                    const { data: result, error: functionError } = await this._supabase.functions.invoke('process-payment', {
                        body: payload
                    });

                    if (functionError) {
                        throw new Error(result?.error || functionError.message || "Payment verification failed.");
                    }

                    const { error: loginError } = await this._supabase.auth.signInWithPassword({
                        email: this._tempSignUpData.email,
                        password: this._tempSignUpData.password,
                    });

                    if (loginError) {
                        throw new Error("Account created, but automatic login failed: " + loginError.message);
                    }

                    const overlay = document.getElementById('auth-modal-overlay');
                    if (overlay) overlay.classList.remove('open');
                    this._isOpen = false;
                    this._tempSignUpData = null;
                    
                    this.open(); 

                } catch (err) {
                    if (loadingDiv) loadingDiv.style.display = 'none';
                    if (btnContainer) btnContainer.style.display = 'block';
                    if (backBtn) backBtn.style.display = 'block';
                    this.showError(err.message);
                }
            },
            onError: (err) => {
                this.showError("PayPal encountered an error. Please try again or use a different payment method.");
            }
        }).render('#paypal-button-container');
    },

    attachGlobalListeners() {
        document.getElementById('auth-modal-overlay')?.addEventListener('click', (e) => {
            if (e.target.id === 'auth-modal-overlay') this.close();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this._isOpen) {
                this.close();
            }
        });
    },

    attachContentListeners() {
        document.getElementById('close-auth-ui')?.addEventListener('click', () => this.close());

        const toggleBtns = document.querySelectorAll('.auth-toggle-btn');
        toggleBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchMode(e.target.dataset.mode);
            });
        });

        document.getElementById('auth-submit-btn')?.addEventListener('click', async () => {
            this.hideError();
            const email = document.getElementById('auth-email')?.value;
            const password = document.getElementById('auth-password')?.value;
            const name = document.getElementById('auth-name')?.value || '';
            
            if (!email || !password) {
                this.showError("Please enter both email and password.");
                return;
            }

            if (this._mode === 'signup') {
                const termsCheckbox = document.getElementById('auth-terms');
                if (termsCheckbox && !termsCheckbox.checked) {
                    this.showError("Please agree to the Terms of Use and Privacy Policy.");
                    return; 
                }
                
                this._tempSignUpData = { email, password, name };
                this.switchMode('payment');
                
            } else if (this._mode === 'signin') {
                this.setLoading('auth-submit-btn', true, 'Sign In');
                
                const { data, error } = await this._supabase.auth.signInWithPassword({
                    email: email,
                    password: password,
                });

                this.setLoading('auth-submit-btn', false, 'Sign In');

                if (error) {
                    this.showError(error.message);
                } else {
                    this.close();
                    this.open();
                }
            }
        });

        document.getElementById('auth-back-to-signup')?.addEventListener('click', () => {
            this.switchMode('signup');
        });

        document.getElementById('auth-forgot-password')?.addEventListener('click', async (e) => {
            e.preventDefault();
            const email = document.getElementById('auth-email')?.value;
            if (!email) {
                this.showError("Please enter your email address first.");
                return;
            }
            const { data, error } = await this._supabase.auth.resetPasswordForEmail(email);
            if (error) {
                this.showError(error.message);
            } else {
                alert("Password reset instructions sent to your email.");
            }
        });
    },

    injectStyles() {
        if (document.getElementById('auth-ui-styles')) return;
        
        const css = `
            .auth-wrapper-layer {
                position: fixed;
                inset: 0;
                background: rgba(15, 23, 42, 0.65);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0;
                visibility: hidden;
                transition: all 0.3s ease-in-out;
                z-index: 9999;
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                padding: 20px;
                box-sizing: border-box;
                overflow-y: auto; 
            }
            
            .auth-wrapper-layer.open {
                opacity: 1;
                visibility: visible;
            }

            .auth-modal-card {
                background: #ffffff;
                width: 400px; 
                max-width: 100%;
                border: 1px solid #e2e8f0;
                border-radius: 16px;
                position: relative;
                box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
                transform: scale(0.98) translateY(10px);
                transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                margin: auto; 
            }

            .auth-wrapper-layer.open .auth-modal-card {
                transform: scale(1) translateY(0);
            }

            .auth-close-btn {
                position: absolute;
                top: 12px;
                right: 12px;
                background: transparent;
                border: none;
                color: #94a3b8;
                width: 32px;
                height: 32px;
                border-radius: 8px;
                font-size: 1.4rem;
                cursor: pointer;
                transition: all 0.2s;
                display: grid;
                place-items: center;
                line-height: 1;
                z-index: 10;
            }

            .auth-close-btn:hover {
                background: #f1f5f9;
                color: #334155;
            }

            .auth-header-section {
                padding: 24px 24px 16px;
                text-align: center;
            }

            .auth-brand-logo {
                height: 36px;
                width: auto;
                margin: 0 auto 16px;
                display: block;
                object-fit: contain;
            }

            .auth-toggle-container {
                display: flex;
                justify-content: center;
                width: 100%;
            }

            .auth-toggle-pill {
                display: flex;
                background: #f1f5f9;
                border-radius: 999px;
                padding: 4px;
                width: 100%;
            }

            .auth-toggle-btn {
                flex: 1;
                padding: 8px 16px;
                border: none;
                background: transparent;
                border-radius: 999px;
                font-size: 0.9rem;
                font-weight: 600;
                color: #64748b;
                cursor: pointer;
                transition: all 0.2s ease;
                font-family: inherit;
            }

            .auth-toggle-btn:hover:not(.active) {
                color: #334155;
            }

            .auth-toggle-btn.active {
                background: #ffffff;
                color: #0f172a;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);
            }

            .auth-form-body {
                padding: 0 24px 24px;
            }

            .auth-input-group {
                margin-bottom: 12px;
            }

            .auth-input-group label {
                display: block;
                color: #334155;
                font-size: 0.85rem;
                font-weight: 600;
                margin-bottom: 6px;
            }

            .auth-field-wrapper {
                position: relative;
            }

            .auth-field-icon {
                position: absolute;
                left: 14px;
                top: 50%;
                transform: translateY(-50%);
                color: #94a3b8;
                font-size: 0.9rem;
            }

            .auth-input {
                width: 100%;
                background: #ffffff;
                border: 1px solid #cbd5e1;
                border-radius: 8px;
                padding: 10px 14px 10px 38px;
                color: #0f172a;
                font-family: inherit;
                font-size: 0.9rem;
                transition: all 0.2s;
                outline: none;
                box-sizing: border-box;
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
            }

            .auth-input:hover {
                border-color: #94a3b8;
            }

            .auth-input:focus {
                border-color: #2563eb;
                box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
            }

            .auth-input::placeholder {
                color: #94a3b8;
            }

            .auth-options {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 20px;
                font-size: 0.85rem;
            }

            .auth-checkbox {
                display: flex;
                align-items: center;
                gap: 8px;
                color: #475569;
                cursor: pointer;
                font-weight: 500;
            }
            
            .auth-checkbox input {
                accent-color: #2563eb;
                width: 14px;
                height: 14px;
                cursor: pointer;
            }

            .auth-forgot-link, .auth-terms-link {
                color: #2563eb;
                text-decoration: none;
                font-weight: 600;
                transition: color 0.2s;
            }

            .auth-forgot-link:hover, .auth-terms-link:hover {
                color: #1d4ed8;
            }
            
            .auth-terms-link:hover {
                text-decoration: underline;
            }

            .auth-error {
                background: #fef2f2;
                color: #dc2626;
                border: 1px solid #fecaca;
                padding: 10px;
                border-radius: 6px;
                font-size: 0.85rem;
                margin-bottom: 16px;
                text-align: center;
            }

            .auth-submit-btn {
                width: 100%;
                background: #2563eb;
                color: #ffffff;
                border: none;
                border-radius: 8px;
                padding: 12px;
                font-size: 0.95rem;
                font-weight: 600;
                cursor: pointer;
                transition: background-color 0.2s, box-shadow 0.2s;
                margin-bottom: 4px;
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
            }

            .auth-submit-btn:hover:not(:disabled) {
                background: #1d4ed8;
                box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2), 0 2px 4px -1px rgba(37, 99, 235, 0.1);
            }

            .auth-submit-btn:disabled {
                cursor: not-allowed;
            }

            .auth-back-btn {
                width: 100%;
                background: transparent;
                color: #64748b;
                border: 1px solid transparent;
                border-radius: 8px;
                padding: 10px;
                font-size: 0.9rem;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
                margin-top: 8px;
            }

            .auth-back-btn:hover {
                background: #f1f5f9;
                color: #334155;
            }
            
            @media (max-width: 480px) {
                .auth-header-section { padding: 20px 20px 16px; }
                .auth-form-body { padding: 0 20px 20px; }
            }
        `;
        
        const style = document.createElement('style');
        style.id = 'auth-ui-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }
};