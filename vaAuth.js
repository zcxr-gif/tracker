// Premium auth modal for VA partnership + staff console.
// Distinct from the main tracker AuthUI (which is wired to Pro/Stripe and
// auto-redirects into the tracker on sign-in).
//
// Visual language matches va-ui.css. The modal also injects a minimal,
// self-contained stylesheet so it works on any page that loads this module.

import { supabase } from './vaService.js';

let injected = false;

function injectStyles() {
    if (injected) return;
    injected = true;
    const style = document.createElement('style');
    style.textContent = `
        #va-auth-overlay {
            position: fixed; inset: 0; z-index: 99999;
            background: rgba(4, 4, 6, 0.78);
            -webkit-backdrop-filter: blur(18px);
            backdrop-filter: blur(18px);
            display: none;
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
            opacity: 0;
            transition: opacity 220ms ease;
            padding: max(20px, env(safe-area-inset-top, 0px)) 18px max(20px, env(safe-area-inset-bottom, 0px));
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
            -webkit-font-smoothing: antialiased;
        }
        #va-auth-overlay.va-open {
            display: flex;
            align-items: center;
            justify-content: center;
        }
        #va-auth-overlay.va-visible { opacity: 1; }

        #va-auth-card {
            position: relative;
            width: 100%;
            max-width: 440px;
            margin: auto;
            background: linear-gradient(180deg, #1a1a1d 0%, #101013 100%);
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 24px;
            padding: 34px 30px 28px;
            box-shadow:
                0 40px 100px -20px rgba(0,0,0,0.75),
                0 0 0 1px rgba(255,255,255,0.02) inset;
            transform: translateY(14px) scale(0.97);
            opacity: 0;
            transition: transform 280ms cubic-bezier(0.16, 1, 0.3, 1), opacity 220ms ease;
            overflow: hidden;
            flex: 0 0 auto;
        }
        #va-auth-overlay.va-visible #va-auth-card {
            transform: translateY(0) scale(1);
            opacity: 1;
        }

        #va-auth-card::before {
            content: "";
            position: absolute;
            top: -110px; left: 50%;
            width: 340px; height: 230px;
            transform: translateX(-50%);
            background: radial-gradient(closest-side, rgba(59,130,246,0.32), transparent 70%);
            filter: blur(40px);
            pointer-events: none;
        }
        #va-auth-card::after {
            content: "";
            position: absolute;
            inset: 0;
            border-radius: 24px;
            padding: 1px;
            background: linear-gradient(140deg, rgba(255,255,255,0.12), rgba(255,255,255,0) 45%, rgba(96,165,250,0.10) 100%);
            -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
            -webkit-mask-composite: xor; mask-composite: exclude;
            pointer-events: none;
        }

        .va-auth-brand {
            position: relative;
            display: flex; align-items: center; gap: 11px;
            margin-bottom: 22px;
        }
        .va-auth-brand-logo {
            width: 36px; height: 36px;
            border-radius: 10px;
            object-fit: cover;
            box-shadow: 0 8px 22px -8px rgba(59,130,246,0.55);
        }
        .va-auth-brand-name {
            font-weight: 800; color: #ffffff;
            letter-spacing: -0.02em;
            font-size: 1rem;
        }
        .va-auth-brand-tag {
            margin-left: auto;
            font-size: 0.66rem; font-weight: 700; letter-spacing: 0.18em;
            color: #a1a1aa; text-transform: uppercase;
            padding: 4px 10px; border-radius: 999px;
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.08);
        }

        #va-auth-card h2 {
            position: relative;
            margin: 0 0 6px;
            font-size: 1.55rem; font-weight: 800; color: #ffffff;
            letter-spacing: -0.025em; line-height: 1.15;
        }
        #va-auth-card .va-auth-sub {
            position: relative;
            margin: 0 0 22px; color: #a1a1aa;
            font-size: 0.92rem; line-height: 1.5;
        }

        .va-auth-tabs {
            position: relative;
            display: flex; gap: 2px;
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.07);
            border-radius: 12px; padding: 4px;
            margin-bottom: 20px;
        }
        .va-auth-tab {
            flex: 1; background: transparent; border: 0; color: #a1a1aa;
            font-weight: 600; font-size: 0.88rem; padding: 9px 0;
            border-radius: 9px; cursor: pointer;
            transition: color 140ms ease, background 140ms ease, box-shadow 140ms ease;
            font-family: inherit;
        }
        .va-auth-tab:hover { color: #ffffff; }
        .va-auth-tab.active {
            background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03));
            color: #ffffff;
            box-shadow: 0 1px 0 rgba(255,255,255,0.08) inset, 0 4px 12px -6px rgba(0,0,0,0.4);
        }

        #va-auth-form {
            position: relative;
            display: flex; flex-direction: column; gap: 14px;
        }
        .va-auth-field { display: flex; flex-direction: column; gap: 7px; }
        .va-auth-field label {
            font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em;
            color: #a1a1aa; text-transform: uppercase;
            display: flex; align-items: center; gap: 6px;
        }
        .va-auth-field label i { color: #71717a; font-size: 0.78rem; }

        .va-auth-input-wrap { position: relative; display: flex; align-items: center; }
        .va-auth-field input {
            width: 100%;
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.10);
            color: #ffffff;
            border-radius: 11px;
            padding: 12px 14px;
            font-size: 0.95rem; font-family: inherit;
            outline: none;
            transition: border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
        }
        .va-auth-field input::placeholder { color: #71717a; }
        .va-auth-field input:hover { border-color: rgba(255,255,255,0.18); }
        .va-auth-field input:focus {
            border-color: rgba(96,165,250,0.65);
            background: rgba(255,255,255,0.05);
            box-shadow: 0 0 0 4px rgba(96,165,250,0.18);
        }

        .va-auth-pw-toggle {
            position: absolute; right: 8px;
            background: transparent; border: 0;
            color: #71717a; cursor: pointer;
            padding: 6px 8px; border-radius: 7px;
            font-size: 0.85rem;
            transition: color 120ms, background 120ms;
        }
        .va-auth-pw-toggle:hover { color: #e4e4e7; background: rgba(255,255,255,0.04); }

        #va-auth-submit {
            margin-top: 6px;
            padding: 12px 16px;
            border-radius: 12px;
            background: #ffffff;
            color: #0a0a0a;
            font-weight: 700; font-size: 0.95rem;
            border: 0; cursor: pointer;
            font-family: inherit;
            transition: transform 120ms ease, box-shadow 160ms ease, background 160ms ease;
            box-shadow: 0 10px 30px -10px rgba(255,255,255,0.30);
            display: flex; align-items: center; justify-content: center; gap: 8px;
            min-height: 44px;
        }
        #va-auth-submit:hover:not(:disabled) {
            transform: translateY(-1px);
            background: #f4f4f5;
            box-shadow: 0 14px 34px -10px rgba(255,255,255,0.35);
        }
        #va-auth-submit:active:not(:disabled) { transform: translateY(0); }
        #va-auth-submit:disabled { opacity: 0.55; cursor: not-allowed; }
        #va-auth-submit .va-auth-spinner {
            width: 14px; height: 14px;
            border: 2px solid rgba(10,10,10,0.20);
            border-top-color: #0a0a0a;
            border-radius: 50%;
            animation: va-auth-spin 0.7s linear infinite;
        }
        @keyframes va-auth-spin { to { transform: rotate(360deg); } }

        #va-auth-msg {
            font-size: 0.85rem; min-height: 1.2em;
            padding: 0 2px;
            display: flex; align-items: center; gap: 6px;
            line-height: 1.4;
        }
        .va-auth-msg-err { color: #f87171; }
        .va-auth-msg-ok  { color: #4ade80; }

        #va-auth-close {
            position: absolute; top: 14px; right: 14px;
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.08);
            color: #a1a1aa;
            width: 32px; height: 32px;
            display: flex; align-items: center; justify-content: center;
            border-radius: 9px;
            cursor: pointer; padding: 0;
            font-size: 0.95rem;
            transition: all 140ms ease;
            z-index: 2;
        }
        #va-auth-close:hover {
            color: #ffffff;
            background: rgba(255,255,255,0.10);
            border-color: rgba(255,255,255,0.18);
        }

        .va-auth-footer {
            margin-top: 16px; font-size: 0.84rem; color: #a1a1aa; text-align: center;
            position: relative;
        }
        .va-auth-footer a {
            color: #60a5fa; text-decoration: none;
            font-weight: 500; transition: color 120ms;
        }
        .va-auth-footer a:hover { color: #93c5fd; text-decoration: underline; }

        .va-auth-fineprint {
            position: relative;
            margin-top: 16px;
            font-size: 0.74rem;
            color: #71717a;
            text-align: center;
            line-height: 1.55;
        }
        .va-auth-fineprint a {
            color: #a1a1aa; text-decoration: underline;
            text-decoration-color: rgba(161,161,170,0.35);
            text-underline-offset: 2px;
        }
        .va-auth-fineprint a:hover { color: #ffffff; }

        @media (max-width: 460px) {
            #va-auth-card {
                padding: 28px 20px 22px;
                border-radius: 20px;
            }
            #va-auth-card h2 { font-size: 1.3rem; }
            #va-auth-card .va-auth-sub { font-size: 0.88rem; margin-bottom: 18px; }
            .va-auth-brand { margin-bottom: 18px; }
            .va-auth-field input { padding: 12px 12px; font-size: 16px; }
            #va-auth-submit { padding: 13px 16px; font-size: 1rem; }
            #va-auth-close { top: 10px; right: 10px; }
        }
        @media (max-height: 720px) {
            #va-auth-card { padding: 24px 24px 20px; }
            .va-auth-brand { margin-bottom: 14px; }
            #va-auth-card h2 { font-size: 1.3rem; }
            #va-auth-card .va-auth-sub { margin-bottom: 14px; }
            .va-auth-tabs { margin-bottom: 14px; }
            #va-auth-form { gap: 11px; }
        }

        @media (prefers-reduced-motion: reduce) {
            #va-auth-overlay,
            #va-auth-card,
            #va-auth-submit,
            .va-auth-tab,
            .va-auth-field input { transition: none; }
            #va-auth-submit .va-auth-spinner { animation: none; }
        }
    `;
    document.head.appendChild(style);
}

function render(mode) {
    const overlay = document.getElementById('va-auth-overlay');
    const isSignUp = mode === 'signup';
    overlay.innerHTML = `
        <div id="va-auth-card" role="dialog" aria-modal="true" aria-labelledby="va-auth-title">
            <button id="va-auth-close" type="button" aria-label="Close">
                <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>

            <div class="va-auth-brand">
                <img class="va-auth-brand-logo" src="Images/inflight.png" alt="">
                <span class="va-auth-brand-name">InFlight</span>
                <span class="va-auth-brand-tag">Partnership</span>
            </div>

            <h2 id="va-auth-title">${isSignUp ? 'Create your account' : 'Welcome back'}</h2>
            <p class="va-auth-sub">${isSignUp
                ? 'Free account — no card required. Used to apply for the VA partnership program and manage your roster.'
                : 'Sign in to manage your virtual airline, submit events, or access the staff console.'}</p>

            <div class="va-auth-tabs" role="tablist">
                <button type="button" class="va-auth-tab ${!isSignUp ? 'active' : ''}" data-mode="signin" role="tab" aria-selected="${!isSignUp}">Sign in</button>
                <button type="button" class="va-auth-tab ${isSignUp ? 'active' : ''}" data-mode="signup" role="tab" aria-selected="${isSignUp}">Sign up</button>
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
                        <input name="email" type="email" required autocomplete="email" placeholder="you@example.com" inputmode="email">
                    </div>
                </div>
                <div class="va-auth-field">
                    <label><i class="fa-solid fa-lock"></i> Password</label>
                    <div class="va-auth-input-wrap">
                        <input name="password" type="password" required minlength="6"
                               autocomplete="${isSignUp ? 'new-password' : 'current-password'}"
                               placeholder="${isSignUp ? 'At least 6 characters' : 'Your password'}">
                        <button type="button" class="va-auth-pw-toggle" aria-label="Show password" data-pw-toggle>
                            <i class="fa-solid fa-eye" aria-hidden="true"></i>
                        </button>
                    </div>
                </div>
                <button id="va-auth-submit" type="submit">
                    <span class="va-auth-label">${isSignUp ? 'Create account' : 'Sign in'}</span>
                    <i class="fa-solid fa-arrow-right" style="font-size:0.8rem;" aria-hidden="true"></i>
                </button>
                <div id="va-auth-msg" role="status" aria-live="polite"></div>
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
        b.addEventListener('click', () => {
            render(b.dataset.mode);
            overlay.classList.add('va-visible');
        });
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
                ? '<i class="fa-solid fa-eye" aria-hidden="true"></i>'
                : '<i class="fa-solid fa-eye-slash" aria-hidden="true"></i>';
            pwToggle.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
        });
    }

    // Autofocus first empty input (skip on mobile to avoid keyboard jump)
    const isTouch = window.matchMedia('(hover: none)').matches;
    if (!isTouch) {
        setTimeout(() => {
            const inputs = overlay.querySelectorAll('input');
            for (const input of inputs) {
                if (!input.value) { input.focus(); break; }
            }
        }, 60);
    }
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
                options: { data: { if_username: data.if_username } }
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

    overlay.classList.add('va-open');
    // Force layout so the transition actually runs.
    // eslint-disable-next-line no-unused-expressions
    overlay.offsetHeight;
    requestAnimationFrame(() => {
        requestAnimationFrame(() => overlay.classList.add('va-visible'));
    });

    document.addEventListener('keydown', escListener);
    document.body.style.overflow = 'hidden';
}

export function closeAuthModal() {
    const overlay = document.getElementById('va-auth-overlay');
    if (!overlay) return;
    overlay.classList.remove('va-visible');
    document.removeEventListener('keydown', escListener);
    document.body.style.overflow = '';
    setTimeout(() => {
        if (!overlay.classList.contains('va-visible')) {
            overlay.classList.remove('va-open');
        }
    }, 240);
}

function escListener(e) {
    if (e.key === 'Escape') closeAuthModal();
}
