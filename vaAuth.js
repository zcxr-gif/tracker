// Premium auth modal for VA partnership + staff console.
// Distinct from the main tracker AuthUI (which is wired to Pro/Stripe and
// auto-redirects into the tracker on sign-in).

import { supabase } from './vaService.js';

let injected = false;

function injectStyles() {
    if (injected) return;
    injected = true;
    const style = document.createElement('style');
    style.textContent = `
        #va-auth-overlay {
            position: fixed; inset: 0; z-index: 9999;
            background: radial-gradient(ellipse at top, rgba(56, 189, 248, 0.08), transparent 60%),
                        rgba(2, 6, 23, 0.78);
            backdrop-filter: blur(14px) saturate(140%);
            -webkit-backdrop-filter: blur(14px) saturate(140%);
            display: none; align-items: center; justify-content: center;
            opacity: 0; transition: opacity 220ms ease;
            padding: 20px;
            font-family: Inter, system-ui, -apple-system, sans-serif;
        }
        #va-auth-overlay.open { display: flex; opacity: 1; }

        #va-auth-card {
            position: relative;
            width: 100%; max-width: 440px;
            background:
                radial-gradient(120% 60% at 50% -10%, rgba(56,189,248,0.10), transparent 60%),
                linear-gradient(180deg, #0b1426 0%, #070b18 100%);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 22px;
            padding: 36px 32px 28px;
            box-shadow:
                0 40px 100px -20px rgba(0,0,0,0.7),
                0 0 0 1px rgba(255,255,255,0.02) inset,
                0 1px 0 rgba(255,255,255,0.05) inset;
            transform: translateY(8px) scale(0.985);
            opacity: 0;
            transition: transform 260ms cubic-bezier(0.16, 1, 0.3, 1), opacity 220ms ease;
            overflow: hidden;
        }
        #va-auth-overlay.open #va-auth-card {
            transform: translateY(0) scale(1);
            opacity: 1;
        }

        /* Subtle aurora at the top of the card */
        #va-auth-card::before {
            content: "";
            position: absolute;
            top: -120px; left: 50%;
            width: 360px; height: 240px;
            transform: translateX(-50%);
            background: radial-gradient(closest-side, rgba(99,102,241,0.35), transparent 70%);
            filter: blur(40px);
            pointer-events: none;
            opacity: 0.7;
        }
        #va-auth-card::after {
            content: "";
            position: absolute;
            inset: 0;
            border-radius: 22px;
            padding: 1px;
            background: linear-gradient(140deg, rgba(255,255,255,0.10), rgba(255,255,255,0) 40%, rgba(56,189,248,0.10) 100%);
            -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
            -webkit-mask-composite: xor; mask-composite: exclude;
            pointer-events: none;
        }

        .va-auth-brand {
            position: relative;
            display: flex; align-items: center; gap: 10px;
            margin-bottom: 18px;
        }
        .va-auth-brand-logo {
            width: 32px; height: 32px; border-radius: 9px;
            background: linear-gradient(135deg, #6366f1, #38bdf8);
            display: flex; align-items: center; justify-content: center;
            box-shadow: 0 6px 18px -6px rgba(99,102,241,0.6);
            color: white; font-weight: 800; font-size: 0.85rem;
            letter-spacing: -0.02em;
        }
        .va-auth-brand-name {
            font-weight: 800; color: #f8fafc; letter-spacing: -0.01em;
            font-size: 1rem;
        }
        .va-auth-brand-tag {
            margin-left: auto;
            font-size: 0.65rem; font-weight: 700; letter-spacing: 0.18em;
            color: #64748b; text-transform: uppercase;
            padding: 4px 9px; border-radius: 999px;
            background: rgba(148,163,184,0.08);
            border: 1px solid rgba(148,163,184,0.12);
        }

        #va-auth-card h2 {
            position: relative;
            margin: 0 0 6px;
            font-size: 1.55rem; font-weight: 800; color: #f8fafc;
            letter-spacing: -0.02em; line-height: 1.15;
        }
        #va-auth-card .va-auth-sub {
            position: relative;
            margin: 0 0 22px; color: #94a3b8;
            font-size: 0.92rem; line-height: 1.45;
        }

        .va-auth-tabs {
            position: relative;
            display: flex; gap: 4px;
            background: rgba(15,23,42,0.65);
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 11px; padding: 4px;
            margin-bottom: 20px;
        }
        .va-auth-tab {
            flex: 1; background: transparent; border: 0; color: #94a3b8;
            font-weight: 600; font-size: 0.88rem; padding: 9px 0;
            border-radius: 8px; cursor: pointer;
            transition: all 160ms ease;
            font-family: inherit;
        }
        .va-auth-tab:hover { color: #cbd5e1; }
        .va-auth-tab.active {
            background: linear-gradient(180deg, rgba(56,189,248,0.18), rgba(56,189,248,0.10));
            color: #f8fafc;
            box-shadow: 0 1px 0 rgba(255,255,255,0.07) inset, 0 6px 18px -10px rgba(56,189,248,0.6);
        }

        #va-auth-form {
            position: relative;
            display: flex; flex-direction: column; gap: 14px;
        }
        .va-auth-field { display: flex; flex-direction: column; gap: 7px; }
        .va-auth-field label {
            font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em;
            color: #94a3b8; text-transform: uppercase;
            display: flex; align-items: center; gap: 6px;
        }
        .va-auth-field label i { color: #475569; font-size: 0.75rem; }

        .va-auth-input-wrap {
            position: relative;
            display: flex; align-items: center;
        }
        .va-auth-field input {
            width: 100%;
            background: rgba(15,23,42,0.75);
            border: 1px solid rgba(255,255,255,0.08);
            color: #f8fafc;
            border-radius: 10px;
            padding: 12px 14px;
            font-size: 0.95rem; font-family: inherit;
            outline: none;
            transition: border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
        }
        .va-auth-field input::placeholder { color: #475569; }
        .va-auth-field input:hover { border-color: rgba(255,255,255,0.14); }
        .va-auth-field input:focus {
            border-color: rgba(56,189,248,0.55);
            background: rgba(15,23,42,0.95);
            box-shadow: 0 0 0 4px rgba(56,189,248,0.10);
        }

        .va-auth-pw-toggle {
            position: absolute; right: 10px;
            background: transparent; border: 0;
            color: #64748b; cursor: pointer;
            padding: 6px; border-radius: 6px;
            font-size: 0.85rem;
            transition: color 120ms;
        }
        .va-auth-pw-toggle:hover { color: #cbd5e1; }

        #va-auth-submit {
            margin-top: 8px;
            padding: 12px 16px;
            border-radius: 11px;
            background: linear-gradient(180deg, #ffffff 0%, #e2e8f0 100%);
            color: #020617;
            font-weight: 700; font-size: 0.95rem;
            border: 0; cursor: pointer;
            font-family: inherit;
            transition: transform 120ms ease, box-shadow 160ms ease, filter 120ms ease;
            box-shadow: 0 12px 30px -10px rgba(255,255,255,0.25), 0 1px 0 rgba(255,255,255,0.5) inset;
            display: flex; align-items: center; justify-content: center; gap: 8px;
        }
        #va-auth-submit:hover:not(:disabled) {
            transform: translateY(-1px);
            filter: brightness(1.03);
        }
        #va-auth-submit:active:not(:disabled) { transform: translateY(0); }
        #va-auth-submit:disabled { opacity: 0.55; cursor: not-allowed; }
        #va-auth-submit .va-auth-spinner {
            width: 14px; height: 14px;
            border: 2px solid rgba(2,6,23,0.25);
            border-top-color: #020617;
            border-radius: 50%;
            animation: va-auth-spin 0.7s linear infinite;
        }
        @keyframes va-auth-spin { to { transform: rotate(360deg); } }

        #va-auth-msg {
            font-size: 0.85rem; min-height: 1.1em;
            padding: 0 2px;
            display: flex; align-items: center; gap: 6px;
        }
        .va-auth-msg-err { color: #fca5a5; }
        .va-auth-msg-ok { color: #86efac; }

        #va-auth-close {
            position: absolute; top: 14px; right: 14px;
            background: rgba(148,163,184,0.06);
            border: 1px solid rgba(255,255,255,0.06);
            color: #94a3b8;
            width: 30px; height: 30px;
            display: flex; align-items: center; justify-content: center;
            border-radius: 8px;
            cursor: pointer; padding: 0;
            font-size: 1rem;
            transition: all 140ms ease;
            z-index: 2;
        }
        #va-auth-close:hover {
            color: #f8fafc;
            background: rgba(148,163,184,0.14);
            border-color: rgba(255,255,255,0.12);
        }

        .va-auth-footer {
            margin-top: 16px; font-size: 0.8rem; color: #64748b; text-align: center;
            position: relative;
        }
        .va-auth-footer a {
            color: #94a3b8; text-decoration: none;
            font-weight: 500; transition: color 120ms;
        }
        .va-auth-footer a:hover { color: #38bdf8; }

        .va-auth-divider {
            position: relative;
            margin: 18px 0 4px;
            text-align: center;
            font-size: 0.7rem; font-weight: 600; letter-spacing: 0.15em;
            color: #475569; text-transform: uppercase;
        }
        .va-auth-divider::before, .va-auth-divider::after {
            content: "";
            position: absolute; top: 50%;
            width: calc(50% - 30px); height: 1px;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent);
        }
        .va-auth-divider::before { left: 0; }
        .va-auth-divider::after { right: 0; }

        .va-auth-fineprint {
            position: relative;
            margin-top: 14px;
            font-size: 0.72rem;
            color: #475569;
            text-align: center;
            line-height: 1.5;
        }
        .va-auth-fineprint a {
            color: #64748b; text-decoration: underline;
            text-decoration-color: rgba(100,116,139,0.3);
            text-underline-offset: 2px;
        }
        .va-auth-fineprint a:hover { color: #94a3b8; }

        @media (max-width: 460px) {
            #va-auth-card { padding: 28px 22px 22px; border-radius: 18px; }
            #va-auth-card h2 { font-size: 1.35rem; }
        }
    `;
    document.head.appendChild(style);
}

function render(mode) {
    const overlay = document.getElementById('va-auth-overlay');
    const isSignUp = mode === 'signup';
    overlay.innerHTML = `
        <div id="va-auth-card">
            <button id="va-auth-close" aria-label="Close">
                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>

            <div class="va-auth-brand">
                <div class="va-auth-brand-logo">IF</div>
                <span class="va-auth-brand-name">InFlight</span>
                <span class="va-auth-brand-tag">Partnership</span>
            </div>

            <h2>${isSignUp ? 'Create your account' : 'Welcome back'}</h2>
            <p class="va-auth-sub">${isSignUp
                ? 'Free account — no card required. Used to apply for the VA partnership program and manage your roster.'
                : 'Sign in to manage your virtual airline, submit events, or access the staff console.'}</p>

            <div class="va-auth-tabs" role="tablist">
                <button class="va-auth-tab ${!isSignUp ? 'active' : ''}" data-mode="signin" role="tab">Sign in</button>
                <button class="va-auth-tab ${isSignUp ? 'active' : ''}" data-mode="signup" role="tab">Sign up</button>
            </div>

            <form id="va-auth-form" autocomplete="on" novalidate>
                ${isSignUp ? `
                    <div class="va-auth-field">
                        <label><i class="fa-solid fa-at"></i> IFC handle</label>
                        <div class="va-auth-input-wrap">
                            <input name="if_username" type="text" required autocomplete="username" placeholder="CaptainSmith">
                        </div>
                    </div>` : ''}
                <div class="va-auth-field">
                    <label><i class="fa-solid fa-envelope"></i> Email</label>
                    <div class="va-auth-input-wrap">
                        <input name="email" type="email" required autocomplete="email" placeholder="you@example.com">
                    </div>
                </div>
                <div class="va-auth-field">
                    <label><i class="fa-solid fa-lock"></i> Password</label>
                    <div class="va-auth-input-wrap">
                        <input name="password" type="password" required minlength="6"
                               autocomplete="${isSignUp ? 'new-password' : 'current-password'}"
                               placeholder="${isSignUp ? 'At least 6 characters' : 'Your password'}">
                        <button type="button" class="va-auth-pw-toggle" aria-label="Show password" data-pw-toggle>
                            <i class="fa-solid fa-eye"></i>
                        </button>
                    </div>
                </div>
                <button id="va-auth-submit" type="submit">
                    <span class="va-auth-label">${isSignUp ? 'Create account' : 'Sign in'}</span>
                    <i class="fa-solid fa-arrow-right" style="font-size:0.8rem;"></i>
                </button>
                <div id="va-auth-msg"></div>
            </form>

            ${!isSignUp ? `
                <div class="va-auth-footer">
                    <a href="#" id="va-auth-forgot">Forgot your password?</a>
                </div>
            ` : `
                <div class="va-auth-fineprint">
                    By creating an account you agree to our
                    <a href="terms.html" target="_blank" rel="noopener">Terms</a> and
                    <a href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.
                </div>
            `}
        </div>
    `;

    overlay.querySelector('#va-auth-close').addEventListener('click', closeAuthModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeAuthModal(); });
    overlay.querySelectorAll('.va-auth-tab').forEach(b => {
        b.addEventListener('click', () => render(b.dataset.mode));
    });
    overlay.querySelector('#va-auth-form').addEventListener('submit', (e) => handleSubmit(e, isSignUp));

    const forgot = overlay.querySelector('#va-auth-forgot');
    if (forgot) forgot.addEventListener('click', (e) => { e.preventDefault(); handleForgot(); });

    const pwToggle = overlay.querySelector('[data-pw-toggle]');
    if (pwToggle) {
        pwToggle.addEventListener('click', () => {
            const input = pwToggle.closest('.va-auth-input-wrap').querySelector('input');
            const showing = input.type === 'text';
            input.type = showing ? 'password' : 'text';
            pwToggle.innerHTML = showing
                ? '<i class="fa-solid fa-eye"></i>'
                : '<i class="fa-solid fa-eye-slash"></i>';
            pwToggle.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
        });
    }

    // Autofocus first empty input
    setTimeout(() => {
        const inputs = overlay.querySelectorAll('input');
        for (const input of inputs) {
            if (!input.value) { input.focus(); break; }
        }
    }, 60);
}

async function handleSubmit(e, isSignUp) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const msg = form.querySelector('#va-auth-msg');
    const btn = form.querySelector('#va-auth-submit');
    const label = btn.querySelector('.va-auth-label');
    const arrow = btn.querySelector('i');
    const originalLabel = label.textContent;

    btn.disabled = true;
    msg.className = '';
    msg.textContent = '';
    label.textContent = isSignUp ? 'Creating account…' : 'Signing in…';
    if (arrow) arrow.style.display = 'none';
    const spinner = document.createElement('span');
    spinner.className = 'va-auth-spinner';
    btn.appendChild(spinner);

    try {
        if (isSignUp) {
            const { error } = await supabase.auth.signUp({
                email: data.email,
                password: data.password,
                options: {
                    data: { if_username: data.if_username }
                }
            });
            if (error) throw error;
            const { data: sess } = await supabase.auth.getSession();
            if (sess?.session) {
                closeAuthModal();
            } else {
                msg.className = 'va-auth-msg-ok';
                msg.innerHTML = '<i class="fa-solid fa-circle-check"></i> Check your email to confirm your account, then sign in.';
            }
        } else {
            const { error } = await supabase.auth.signInWithPassword({
                email: data.email,
                password: data.password
            });
            if (error) throw error;
            closeAuthModal();
        }
    } catch (err) {
        msg.className = 'va-auth-msg-err';
        msg.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${err.message || 'Something went wrong.'}`;
    } finally {
        btn.disabled = false;
        label.textContent = originalLabel;
        if (arrow) arrow.style.display = '';
        spinner.remove();
    }
}

async function handleForgot() {
    const overlay = document.getElementById('va-auth-overlay');
    const emailInput = overlay.querySelector('input[name="email"]');
    const msg = overlay.querySelector('#va-auth-msg');
    const email = (emailInput?.value || '').trim();
    if (!email) {
        msg.className = 'va-auth-msg-err';
        msg.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Enter your email above first.';
        emailInput?.focus();
        return;
    }
    msg.className = '';
    msg.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Sending reset link…';
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/va-apply.html'
    });
    if (error) {
        msg.className = 'va-auth-msg-err';
        msg.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${error.message || 'Could not send reset email.'}`;
    } else {
        msg.className = 'va-auth-msg-ok';
        msg.innerHTML = '<i class="fa-solid fa-circle-check"></i> Reset email sent. Check your inbox.';
    }
}

export function openAuthModal(mode = 'signin') {
    injectStyles();
    let overlay = document.getElementById('va-auth-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'va-auth-overlay';
        document.body.appendChild(overlay);
    }
    render(mode);
    requestAnimationFrame(() => overlay.classList.add('open'));
    document.addEventListener('keydown', escListener);
    document.body.style.overflow = 'hidden';
}

export function closeAuthModal() {
    const overlay = document.getElementById('va-auth-overlay');
    if (overlay) overlay.classList.remove('open');
    document.removeEventListener('keydown', escListener);
    document.body.style.overflow = '';
}

function escListener(e) {
    if (e.key === 'Escape') closeAuthModal();
}
