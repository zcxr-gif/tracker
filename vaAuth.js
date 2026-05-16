// Lightweight auth modal for VA partnership pages.
// Avoids the main AuthUI which is wired to the Pro/Stripe flow and
// auto-redirects to the tracker on sign-in.

import { supabase } from './vaService.js';

let injected = false;

function injectStyles() {
    if (injected) return;
    injected = true;
    const style = document.createElement('style');
    style.textContent = `
        #va-auth-overlay {
            position: fixed; inset: 0; z-index: 80;
            background: rgba(2, 6, 23, 0.7); backdrop-filter: blur(8px);
            display: none; align-items: center; justify-content: center;
            opacity: 0; transition: opacity 160ms ease;
            padding: 20px;
        }
        #va-auth-overlay.open { display: flex; opacity: 1; }
        #va-auth-card {
            width: 100%; max-width: 420px;
            background: #0f172a; border: 1px solid rgba(255,255,255,0.1);
            border-radius: 16px; padding: 28px;
            box-shadow: 0 30px 80px -20px rgba(0,0,0,0.6);
            font-family: Inter, sans-serif;
        }
        #va-auth-card h2 { margin: 0 0 4px; font-size: 1.5rem; font-weight: 800; color: #f8fafc; }
        #va-auth-card .va-auth-sub { margin: 0 0 22px; color: #94a3b8; font-size: 0.9rem; }
        .va-auth-tabs {
            display: flex; gap: 4px; background: rgba(15,23,42,0.7);
            border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 4px;
            margin-bottom: 18px;
        }
        .va-auth-tab {
            flex: 1; background: transparent; border: 0; color: #94a3b8;
            font-weight: 600; font-size: 0.9rem; padding: 8px 0;
            border-radius: 7px; cursor: pointer; transition: all 120ms;
        }
        .va-auth-tab.active { background: rgba(56,189,248,0.15); color: #38bdf8; }
        #va-auth-form { display: flex; flex-direction: column; gap: 12px; }
        .va-auth-field { display: flex; flex-direction: column; gap: 6px; }
        .va-auth-field label {
            font-size: 0.72rem; font-weight: 700; letter-spacing: 0.05em;
            color: #94a3b8; text-transform: uppercase;
        }
        .va-auth-field input {
            background: rgba(15,23,42,0.7); border: 1px solid rgba(255,255,255,0.1);
            color: #f8fafc; border-radius: 9px; padding: 10px 12px; font-size: 0.95rem;
            outline: none; transition: border-color 120ms ease; font-family: inherit;
        }
        .va-auth-field input:focus { border-color: #38bdf8; }
        #va-auth-submit {
            margin-top: 6px; padding: 11px 16px; border-radius: 10px;
            background: #fbbf24; color: #020617; font-weight: 700; font-size: 0.95rem;
            border: 0; cursor: pointer; transition: filter 120ms;
        }
        #va-auth-submit:hover { filter: brightness(1.1); }
        #va-auth-submit:disabled { opacity: 0.6; cursor: not-allowed; }
        #va-auth-msg { font-size: 0.85rem; min-height: 1.1em; }
        .va-auth-msg-err { color: #fca5a5; }
        .va-auth-msg-ok { color: #86efac; }
        #va-auth-close {
            position: absolute; top: 14px; right: 14px;
            background: transparent; border: 0; color: #64748b;
            font-size: 1.4rem; cursor: pointer; padding: 4px 8px;
        }
        #va-auth-close:hover { color: #f8fafc; }
        .va-auth-footer {
            margin-top: 14px; font-size: 0.78rem; color: #64748b; text-align: center;
        }
        .va-auth-footer a { color: #38bdf8; text-decoration: none; }
        .va-auth-footer a:hover { text-decoration: underline; }
    `;
    document.head.appendChild(style);
}

function render(mode) {
    const overlay = document.getElementById('va-auth-overlay');
    const isSignUp = mode === 'signup';
    overlay.innerHTML = `
        <div id="va-auth-card" style="position: relative;">
            <button id="va-auth-close" aria-label="Close">&times;</button>
            <h2>${isSignUp ? 'Create your account' : 'Sign in'}</h2>
            <p class="va-auth-sub">${isSignUp ? 'Used to apply for the VA partnership program. Free, no card required.' : 'Welcome back.'}</p>
            <div class="va-auth-tabs">
                <button class="va-auth-tab ${!isSignUp ? 'active' : ''}" data-mode="signin">Sign in</button>
                <button class="va-auth-tab ${isSignUp ? 'active' : ''}" data-mode="signup">Sign up</button>
            </div>
            <form id="va-auth-form">
                ${isSignUp ? `
                    <div class="va-auth-field">
                        <label>IFC handle</label>
                        <input name="if_username" type="text" required autocomplete="username" placeholder="e.g. CaptainSmith">
                    </div>` : ''}
                <div class="va-auth-field">
                    <label>Email</label>
                    <input name="email" type="email" required autocomplete="email">
                </div>
                <div class="va-auth-field">
                    <label>Password</label>
                    <input name="password" type="password" required minlength="6" autocomplete="${isSignUp ? 'new-password' : 'current-password'}">
                </div>
                <button id="va-auth-submit" type="submit">${isSignUp ? 'Create account' : 'Sign in'}</button>
                <div id="va-auth-msg"></div>
            </form>
            ${!isSignUp ? `<div class="va-auth-footer"><a href="#" id="va-auth-forgot">Forgot password?</a></div>` : ''}
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
}

async function handleSubmit(e, isSignUp) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const msg = form.querySelector('#va-auth-msg');
    const btn = form.querySelector('#va-auth-submit');
    btn.disabled = true;
    msg.className = '';
    msg.textContent = '';
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
                msg.textContent = 'Check your email to confirm your account, then sign in.';
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
        msg.textContent = err.message || 'Something went wrong.';
    } finally {
        btn.disabled = false;
    }
}

async function handleForgot() {
    const overlay = document.getElementById('va-auth-overlay');
    const emailInput = overlay.querySelector('input[name="email"]');
    const msg = overlay.querySelector('#va-auth-msg');
    const email = (emailInput?.value || '').trim();
    if (!email) {
        msg.className = 'va-auth-msg-err';
        msg.textContent = 'Enter your email above first.';
        return;
    }
    msg.className = '';
    msg.textContent = 'Sending reset link…';
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/va-apply.html'
    });
    if (error) {
        msg.className = 'va-auth-msg-err';
        msg.textContent = error.message || 'Could not send reset email.';
    } else {
        msg.className = 'va-auth-msg-ok';
        msg.textContent = 'Reset email sent. Check your inbox.';
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
}

export function closeAuthModal() {
    const overlay = document.getElementById('va-auth-overlay');
    if (overlay) overlay.classList.remove('open');
    document.removeEventListener('keydown', escListener);
}

function escListener(e) {
    if (e.key === 'Escape') closeAuthModal();
}
