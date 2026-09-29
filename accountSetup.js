/**
 * accountSetup.js
 *
 * The setup a new account walks through once, straight after signing up —
 * the same sheet on desktop and on phones. Every step is optional: each has
 * Skip, and "Skip setup" leaves at any point. What it covers:
 *
 *   1. Welcome     name shown on the card, Infinite Flight username, and the
 *                  account screen's light/dark theme
 *   2. Pilot card  handle, picture and banner (pilotCardEditor.js, as the
 *                  Settings editor and the card prompt use it)
 *   3. Your window how the flight windows YOU open look: style, colour, a
 *                  background image framed with the adjuster (flight.js's
 *                  shared panel, window.buildWindowLookPanel). This device only.
 *   4. Seen by others  the look of YOUR flight's window for everyone who opens
 *                  it: a painted theme for everyone; colour and photo on Pro
 *                  (pilotCardEditor.js, only: 'window')
 *
 * Finishing — or skipping — stamps user_metadata.onboarding_complete, so it
 * runs once per account; everything it sets can be changed later in Settings
 * and the account screen.
 *
 *   AccountSetup.open({ supabase, user, onDone(updatedUser) })
 */

import { PilotCardEditor } from './pilotCardEditor.js';

const CARD_PROMPT_SEEN = 'inflight_card_prompt_seen:';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function isPro(user) {
    try {
        if (typeof window.isInflightPro === 'function') return !!window.isInflightPro();
    } catch (_) { /* fall through */ }
    return !!(user && user.isPro);
}

const STEPS = [
    {
        key: 'welcome',
        icon: 'fa-plane-departure',
        title: 'Welcome aboard',
        sub: 'A few optional touches to make Inflight yours. Skip anything — it all lives in Settings later.',
    },
    {
        key: 'card',
        icon: 'fa-id-badge',
        title: 'Your pilot card',
        sub: 'Pick a handle, add a picture and choose a banner. It’s what other pilots see when they open your aircraft on the map.',
    },
    {
        key: 'window',
        icon: 'fa-window-maximize',
        title: 'Your flight window',
        sub: 'How the flight windows you open look. Pick a style, a colour and a background — even your own image, framed however you like.',
    },
    {
        key: 'others',
        icon: 'fa-eye',
        title: 'Your flight, seen by others',
        sub: 'Style the window everyone else sees when they open your flight. A painted theme is free; your own colour and photo are part of Inflight Pro.',
    },
];

export const AccountSetup = {
    _root: null,
    _step: 0,
    _opts: null,
    _user: null,

    open({ supabase, user, onDone } = {}) {
        if (this._root || !supabase || !user) return false;
        this._opts = { supabase, onDone };
        this._user = user;
        this._step = 0;
        this._injectStyles();
        // The card prompt would offer the same thing on top of this.
        try { localStorage.setItem(CARD_PROMPT_SEEN + user.id, '1'); } catch (_) { /* private mode */ }

        const root = document.createElement('div');
        root.className = 'acs-overlay';
        root.innerHTML = `
            <div class="acs-sheet" role="dialog" aria-modal="true" aria-labelledby="acs-title" tabindex="-1">
                <div class="acs-grab" aria-hidden="true"></div>
                <header class="acs-head">
                    <div class="acs-progress" aria-hidden="true">${STEPS.map(() => '<span></span>').join('')}</div>
                    <button type="button" class="acs-skip-all" data-act="skip-all">Skip setup</button>
                </header>
                <div class="acs-hero">
                    <span class="acs-icon"><i class="fa-solid"></i></span>
                    <div>
                        <p class="acs-count"></p>
                        <h2 class="acs-title" id="acs-title"></h2>
                    </div>
                </div>
                <p class="acs-sub"></p>
                <div class="acs-body"></div>
                <footer class="acs-foot">
                    <button type="button" class="acs-btn acs-quiet" data-act="back">Back</button>
                    <span class="acs-spacer"></span>
                    <button type="button" class="acs-btn acs-quiet" data-act="skip">Skip</button>
                    <button type="button" class="acs-btn acs-primary" data-act="next">Next</button>
                </footer>
            </div>`;
        document.body.appendChild(root);
        this._root = root;

        root.addEventListener('click', (e) => {
            const act = e.target.closest('[data-act]')?.dataset.act;
            if (act === 'next') this._next(true);
            else if (act === 'skip') this._next(false);
            else if (act === 'back') this._go(this._step - 1);
            else if (act === 'skip-all') this._finish();
        });
        this._onPro = () => { if (this._root && (STEPS[this._step].key === 'card' || STEPS[this._step].key === 'others')) this._renderStep(); };
        window.addEventListener('proStatusChanged', this._onPro);

        this._renderStep();
        requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('is-open')));
        root.querySelector('.acs-sheet').focus({ preventScroll: true });
        return true;
    },

    isOpen() { return !!this._root; },

    _go(i) {
        if (i < 0 || i >= STEPS.length) return;
        this._step = i;
        this._renderStep();
        this._root.querySelector('.acs-sheet').scrollTop = 0;
    },

    async _next(save) {
        const step = STEPS[this._step];
        if (save && step.key === 'welcome') {
            const ok = await this._saveWelcome();
            if (!ok) return;
        }
        if (this._step === STEPS.length - 1) { this._finish(); return; }
        this._go(this._step + 1);
    },

    _renderStep() {
        const root = this._root;
        const step = STEPS[this._step];
        const last = this._step === STEPS.length - 1;
        root.dataset.step = step.key;
        root.querySelectorAll('.acs-progress span').forEach((s, i) => {
            s.classList.toggle('is-done', i < this._step);
            s.classList.toggle('is-on', i === this._step);
        });
        root.querySelector('.acs-icon i').className = `fa-solid ${step.icon}`;
        root.querySelector('.acs-count').textContent = `Step ${this._step + 1} of ${STEPS.length}`;
        root.querySelector('.acs-title').textContent = step.title;
        root.querySelector('.acs-sub').textContent = step.sub;
        root.querySelector('[data-act="back"]').style.visibility = this._step === 0 ? 'hidden' : '';
        root.querySelector('[data-act="next"]').textContent = last ? 'Finish' : 'Next';
        root.querySelector('[data-act="skip"]').hidden = last;

        const body = root.querySelector('.acs-body');
        const { supabase } = this._opts;
        const user = this._user;
        if (step.key === 'welcome') {
            const meta = user.user_metadata || {};
            const theme = meta.theme === 'dark' ? 'dark' : (meta.theme === 'light' ? 'light' : 'dark');
            body.innerHTML = `
                <label class="acs-field">
                    <span>Your name <small>shown on your pilot card</small></span>
                    <input type="text" id="acs-name" maxlength="32" autocomplete="name" value="${esc(meta.full_name || meta.name || '')}" placeholder="Captain Jane Doe">
                </label>
                <label class="acs-field">
                    <span>Infinite Flight username <small>finds your live flights and stats</small></span>
                    <div class="acs-input-icon"><i class="fa-solid fa-plane"></i>
                        <input type="text" id="acs-if" maxlength="40" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(meta.if_username || '')}" placeholder="Your community username"></div>
                </label>
                <div class="acs-field">
                    <span>Account screen theme</span>
                    <div class="acs-seg" role="radiogroup">
                        <label><input type="radio" name="acs-theme" value="light" ${theme === 'light' ? 'checked' : ''}><i class="fa-solid fa-sun"></i> Light</label>
                        <label><input type="radio" name="acs-theme" value="dark" ${theme === 'dark' ? 'checked' : ''}><i class="fa-solid fa-moon"></i> Dark</label>
                    </div>
                </div>
                <p class="acs-msg" id="acs-msg" role="status"></p>`;
            return;
        }
        if (step.key === 'card') {
            body.innerHTML = '<div class="acs-editor"></div>';
            PilotCardEditor.mount(body.firstElementChild, { supabase, isPro: isPro(user), user, variant: 'prompt' });
            return;
        }
        if (step.key === 'window') {
            if (typeof window.buildWindowLookPanel !== 'function') {
                body.innerHTML = '<p class="acs-note">Open Settings › Flight window to choose your window style and background.</p>';
                return;
            }
            body.innerHTML = `<div class="acs-look">${window.buildWindowLookPanel('acs')}</div>
                <p class="acs-note"><i class="fa-solid fa-lock"></i> Your background image stays on this device — only you see it.</p>`;
            window.wireWindowLookPanel(body);
            return;
        }
        if (step.key === 'others') {
            body.innerHTML = '<div class="acs-editor"></div>';
            PilotCardEditor.mount(body.firstElementChild, { supabase, isPro: isPro(user), user, variant: 'prompt', only: 'window' });
        }
    },

    // Name, IF username and theme go on the account now, so the pilot card
    // on the next step can suggest a handle from them and link the username.
    async _saveWelcome() {
        const root = this._root;
        const name = (root.querySelector('#acs-name')?.value || '').trim().slice(0, 32);
        const ifName = (root.querySelector('#acs-if')?.value || '').trim();
        const theme = root.querySelector('input[name="acs-theme"]:checked')?.value || 'dark';
        const meta = this._user.user_metadata || {};
        const data = {};
        if (name && name !== (meta.full_name || '')) { data.full_name = name; data.name = name; }
        if (ifName !== (meta.if_username || '')) data.if_username = ifName;
        if (theme !== meta.theme) data.theme = theme;
        if (!Object.keys(data).length) return true;
        const btn = root.querySelector('[data-act="next"]');
        btn.disabled = true;
        try {
            const { data: res, error } = await this._opts.supabase.auth.updateUser({ data });
            if (error) throw error;
            if (res && res.user) this._user = Object.assign(res.user, { isPro: this._user.isPro });
            try { localStorage.setItem('pui-theme', theme); } catch (_) { /* private mode */ }
            return true;
        } catch (err) {
            const msg = root.querySelector('#acs-msg');
            if (msg) msg.textContent = 'Couldn’t save that — ' + (err.message || 'try again') + '. You can also skip this step.';
            return false;
        } finally {
            btn.disabled = false;
        }
    },

    async _finish() {
        const root = this._root;
        if (!root) return;
        const btns = root.querySelectorAll('.acs-foot button, .acs-skip-all');
        btns.forEach(b => { b.disabled = true; });
        let user = this._user;
        try {
            const { data, error } = await this._opts.supabase.auth.updateUser({ data: { onboarding_complete: true } });
            if (!error && data && data.user) user = Object.assign(data.user, { isPro: this._user.isPro });
        } catch (_) { /* the account screen still opens; setup shows again next time */ }
        this._close();
        if (typeof this._opts.onDone === 'function') this._opts.onDone(user);
    },

    _close() {
        const root = this._root;
        if (!root) return;
        this._root = null;
        window.removeEventListener('proStatusChanged', this._onPro);
        root.classList.remove('is-open');
        setTimeout(() => root.remove(), 320);
    },

    _injectStyles() {
        if (document.getElementById('acs-styles')) return;
        const st = document.createElement('style');
        st.id = 'acs-styles';
        st.textContent = `
            .acs-overlay {
                position: fixed; inset: 0; z-index: 20500; display: grid; place-items: center; padding: 16px;
                background: rgba(0,0,0,0); transition: background .28s ease;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
            }
            .acs-overlay.is-open { background: rgba(0,0,0,.6); -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); }
            .acs-sheet {
                position: relative; box-sizing: border-box; width: min(680px, 100%); min-width: 0;
                max-height: calc(100vh - 32px); overflow-y: auto; overflow-x: hidden;
                display: flex; flex-direction: column;
                background: #1c1c1e; color: #f2f2f7; border-radius: 20px; padding: 18px 22px 0;
                border: 1px solid rgba(255,255,255,.08); box-shadow: 0 24px 70px rgba(0,0,0,.55);
                opacity: 0; transform: translate3d(0, 12px, 0) scale(.98);
                transition: opacity .28s ease, transform .42s cubic-bezier(.32,.72,0,1);
                --pui-text-muted: rgba(235,235,245,.6); --pui-border: rgba(255,255,255,.1);
            }
            .acs-overlay.is-open .acs-sheet { opacity: 1; transform: none; }
            .acs-sheet:focus { outline: none; }
            .acs-grab { display: none; }
            .acs-head { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
            .acs-progress { flex: 1; display: flex; gap: 6px; }
            .acs-progress span { flex: 1; height: 4px; border-radius: 2px; background: rgba(255,255,255,.12); transition: background .3s ease; }
            .acs-progress span.is-done { background: rgba(56,189,248,.55); }
            .acs-progress span.is-on { background: #38bdf8; }
            .acs-skip-all {
                border: 0; background: none; padding: 4px 2px; cursor: pointer; font: inherit; font-size: .82rem;
                color: rgba(235,235,245,.6); text-decoration: underline; text-underline-offset: 3px;
            }
            .acs-skip-all:hover { color: #fff; }
            .acs-hero { display: flex; align-items: center; gap: 14px; }
            .acs-icon {
                flex: 0 0 auto; width: 44px; height: 44px; border-radius: 13px; display: grid; place-items: center;
                background: linear-gradient(135deg, rgba(56,189,248,.22), rgba(56,189,248,.06));
                color: #7dd3fc; font-size: 18px; box-shadow: inset 0 0 0 1px rgba(56,189,248,.3);
            }
            .acs-count { margin: 0 0 2px; font-size: .72rem; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: rgba(235,235,245,.5); }
            .acs-title { margin: 0; font-size: 1.3rem; font-weight: 700; letter-spacing: -.015em; }
            .acs-sub { margin: 10px 0 18px; font-size: .9rem; line-height: 1.5; color: rgba(235,235,245,.66); }
            .acs-body { flex: 1; min-width: 0; min-height: 120px; }
            .acs-field { display: flex; flex-direction: column; gap: 7px; margin-bottom: 16px; font-size: .86rem; font-weight: 600; }
            .acs-field small { font-weight: 400; color: rgba(235,235,245,.5); margin-left: 6px; }
            .acs-field input[type="text"] {
                width: 100%; box-sizing: border-box; height: 44px; padding: 0 12px; border-radius: 11px;
                background: #111113; color: #f2f2f7; border: 1px solid rgba(255,255,255,.12); font: inherit; font-size: .95rem; font-weight: 400;
            }
            .acs-field input[type="text"]:focus { outline: none; border-color: #38bdf8; box-shadow: 0 0 0 3px rgba(56,189,248,.18); }
            .acs-input-icon { position: relative; }
            .acs-input-icon > i { position: absolute; left: 13px; top: 50%; transform: translateY(-50%); color: rgba(235,235,245,.45); font-size: .8rem; }
            .acs-input-icon input[type="text"] { padding-left: 36px; }
            .acs-seg { display: flex; gap: 6px; padding: 4px; border-radius: 12px; background: #111113; border: 1px solid rgba(255,255,255,.08); }
            .acs-seg label {
                flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 38px; border-radius: 9px;
                cursor: pointer; font-weight: 600; color: rgba(235,235,245,.7);
            }
            .acs-seg input { position: absolute; opacity: 0; pointer-events: none; }
            .acs-seg label:has(input:checked) { background: #2c2c2e; color: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.4); }
            .acs-msg { min-height: 1.2em; margin: 0; font-size: .82rem; color: #fca5a5; }
            .acs-note { display: flex; align-items: center; gap: 8px; margin: 12px 0 0; font-size: .8rem; color: rgba(235,235,245,.55); }
            .acs-note i { font-size: .72rem; }
            .acs-look { padding: 14px; border-radius: 16px; background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.06); }
            .acs-editor .pce-preview { margin-top: 2px; }
            .acs-foot {
                position: sticky; bottom: 0; display: flex; align-items: center; gap: 8px;
                margin: 20px -22px 0; padding: 14px 22px calc(16px + env(safe-area-inset-bottom));
                background: linear-gradient(rgba(28,28,30,.85), #1c1c1e 40%); border-top: 1px solid rgba(255,255,255,.08);
            }
            .acs-spacer { flex: 1; }
            .acs-btn {
                height: 40px; padding: 0 18px; border-radius: 11px; cursor: pointer;
                font: inherit; font-size: .9rem; font-weight: 600; color: #f2f2f7;
                background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12);
            }
            .acs-btn:hover { filter: brightness(1.15); }
            .acs-btn:disabled { opacity: .5; cursor: default; }
            .acs-btn[hidden] { display: none; }
            .acs-quiet { background: none; border-color: transparent; color: rgba(235,235,245,.7); padding: 0 12px; }
            .acs-primary { background: #f2f2f7; color: #1c1c1e; border-color: #f2f2f7; min-width: 96px; }

            @media (max-width: 768px) {
                .acs-overlay { place-items: end stretch; padding: 0; }
                .acs-sheet {
                    width: 100%; max-height: 94vh; border-radius: 20px 20px 0 0; border-bottom: 0; padding: 10px 16px 0;
                    opacity: 1; transform: translate3d(0, 100%, 0); transition: transform .5s cubic-bezier(.32,.72,0,1);
                }
                .acs-grab { display: block; width: 36px; height: 5px; border-radius: 3px; background: rgba(255,255,255,.22); margin: 0 auto 12px; }
                .acs-foot { margin: 16px -16px 0; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); }
                .acs-title { font-size: 1.15rem; }
                .acs-look { padding: 12px; margin: 0 -4px; }
            }
            @media (prefers-reduced-motion: reduce) { .acs-overlay, .acs-sheet { transition: none; } }
        `;
        document.head.appendChild(st);
    },
};

if (typeof window !== 'undefined') window.AccountSetup = AccountSetup;
