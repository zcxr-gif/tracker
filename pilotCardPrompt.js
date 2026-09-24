/**
 * pilotCardPrompt.js
 *
 * Gives a signed-in pilot who has no picture yet the chance to set up their
 * card, instead of leaving it to be found in Settings:
 *
 *   - a popup, shown once per account, after the map is up and nothing else
 *     (first-run, changelog, sign-in) is on screen;
 *   - a dot on the nav's account pill until they have a picture. While the dot
 *     shows, the pill opens this popup rather than the account screen (the
 *     popup links through to the account).
 *
 * The popup hosts the Settings "Picture & banner" editor (pilotCardEditor.js)
 * as it is — picture and the painted banner colours for everyone, a photo
 * banner on Inflight Pro — so the two can never offer different things.
 */

import { PilotCardEditor } from './pilotCardEditor.js';

const SEEN_PREFIX = 'inflight_card_prompt_seen:';
const FIRST_DELAY_MS = 4000;    // after the map is ready
const RETRY_MS = 4000;          // while something else is on screen
const GIVE_UP_MS = 120000;      // try again next visit instead
const PILLS = '#open-auth-btn, #ios-profile-btn';   // desktop nav pill, phone profile orb
const BLOCKERS = '#fre-overlay, #fre-window-demo, .cl-overlay, #auth-modal-overlay.open, .iadj-overlay';

function wasSeen(userId) {
    try { return localStorage.getItem(SEEN_PREFIX + userId) === '1'; } catch (_) { return false; }
}
function markSeen(userId) {
    try { localStorage.setItem(SEEN_PREFIX + userId, '1'); } catch (_) { /* private mode */ }
}
function isPro() {
    try { return typeof window.isInflightPro === 'function' && !!window.isInflightPro(); } catch (_) { return false; }
}

export const PilotCardPrompt = {
    _supabase: null,
    _user: null,
    _needs: false,
    _root: null,
    _autoTimer: null,
    _autoSince: 0,
    _checkRun: 0,

    init(supabase) {
        if (this._supabase || !supabase) return;
        this._supabase = supabase;
        this._injectStyles();

        // Deferred: supabase-js deadlocks if its own calls are awaited inside
        // the auth callback.
        supabase.auth.onAuthStateChange(() => { setTimeout(() => this._check(), 0); });
        window.addEventListener('inflight:pilot-profile-changed', () => this._check());
        window.addEventListener('proStatusChanged', () => { if (this._root) this._mountEditor(); });

        // Capture on the document runs before the pills' own handlers. The
        // phone's orb opens on pointerup (ahead of click), so both are taken;
        // the click that follows a pointerup only needs swallowing.
        const intercept = (e) => {
            if (!this._needs || !e.target.closest || !e.target.closest(PILLS)) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            this.open();
        };
        document.addEventListener('pointerup', intercept, true);
        document.addEventListener('click', intercept, true);

        this._check();
    },

    async _check() {
        const run = ++this._checkRun;
        let user = null;
        try {
            const { data: { session } = {} } = await this._supabase.auth.getSession();
            user = session?.user || null;
        } catch (_) { return; }
        if (run !== this._checkRun) return;
        this._user = user;

        if (!user) {
            this._setNeeds(false);
            this._cancelAuto();
            if (this._root) this.close();
            return;
        }

        // Only the picture decides it. A failed read says nothing either way,
        // so it changes nothing — never a popup on a network blip.
        const { data, error } = await this._supabase
            .from('pilot_profiles').select('avatar_path').eq('user_id', user.id).limit(1).maybeSingle();
        if (run !== this._checkRun || error) return;

        const needs = !data || !data.avatar_path;
        this._setNeeds(needs);
        if (needs && !wasSeen(user.id)) this._scheduleAuto();
        else this._cancelAuto();
    },

    _setNeeds(needs) {
        this._needs = !!needs;
        // LandingUI re-applies this whenever it rebuilds the pill.
        window.__inflightNeedsPicture = this._needs;
        document.querySelectorAll(PILLS).forEach(btn => btn.classList.toggle('pcp-needs-picture', this._needs));
    },

    _scheduleAuto() {
        if (this._autoTimer || this._root) return;
        this._autoSince = Date.now();
        const attempt = () => {
            this._autoTimer = null;
            const user = this._user;
            if (!user || !this._needs || wasSeen(user.id) || this._root) return;
            const ready = window.__inflightBoot && window.__inflightBoot.state === 'map-ready';
            if (!ready || document.hidden || document.querySelector(BLOCKERS)) {
                if (Date.now() - this._autoSince < GIVE_UP_MS) this._autoTimer = setTimeout(attempt, RETRY_MS);
                return;
            }
            this.open();
        };
        this._autoTimer = setTimeout(attempt, FIRST_DELAY_MS);
    },

    _cancelAuto() {
        clearTimeout(this._autoTimer);
        this._autoTimer = null;
    },

    open() {
        const user = this._user;
        if (!user || this._root) return;
        this._cancelAuto();
        markSeen(user.id);

        const root = document.createElement('div');
        root.className = 'pcp-overlay';
        root.innerHTML = `
            <div class="pcp-sheet" role="dialog" aria-modal="true" aria-labelledby="pcp-title" tabindex="-1">
                <div class="pcp-grab" aria-hidden="true"></div>
                <button type="button" class="pcp-x" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
                <h2 class="pcp-title" id="pcp-title">Make your pilot card yours</h2>
                <p class="pcp-sub">Add a picture and pick a banner colour. It's what other pilots see when they open your aircraft on the map.
                    ${isPro() ? 'As a Pro member you can also use your own photo as the banner.' : 'With Inflight Pro you can use your own photo as the banner.'}</p>
                <div class="pcp-editor"></div>
                <div class="pcp-foot">
                    <button type="button" class="pcp-link" data-act="account">Account settings</button>
                    <span class="pcp-spacer"></span>
                    <button type="button" class="pcp-btn" data-act="later">Maybe later</button>
                    <button type="button" class="pcp-btn pcp-primary" data-act="done">Done</button>
                </div>
            </div>`;
        document.body.appendChild(root);
        this._root = root;
        this._mountEditor();

        const close = () => this.close();
        root.querySelector('.pcp-x').addEventListener('click', close);
        root.querySelector('[data-act="later"]').addEventListener('click', close);
        root.querySelector('[data-act="done"]').addEventListener('click', close);
        root.querySelector('[data-act="account"]').addEventListener('click', () => {
            this.close();
            try { window.AuthUI && window.AuthUI.open(); } catch (_) { /* nav keeps working */ }
        });
        root.addEventListener('click', (e) => { if (e.target === root) close(); });
        this._onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.iadj-overlay')) close(); };
        document.addEventListener('keydown', this._onKey);

        requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('is-open')));
        root.querySelector('.pcp-sheet').focus({ preventScroll: true });
    },

    _mountEditor() {
        const host = this._root && this._root.querySelector('.pcp-editor');
        if (!host) return;
        PilotCardEditor.mount(host, { supabase: this._supabase, isPro: isPro(), user: this._user, variant: 'prompt' });
    },

    close() {
        const root = this._root;
        if (!root) return;
        this._root = null;
        document.removeEventListener('keydown', this._onKey);
        root.classList.remove('is-open');
        setTimeout(() => root.remove(), 320);
    },

    _injectStyles() {
        if (document.getElementById('pcp-styles')) return;
        const style = document.createElement('style');
        style.id = 'pcp-styles';
        style.textContent = `
            /* Phone profile orb (its ::after is the enlarged tap target). */
            .ios-profile-btn.pcp-needs-picture::before {
                content: ''; position: absolute; top: 0; right: 0;
                width: 10px; height: 10px; border-radius: 50%;
                background: #ff453a; box-shadow: 0 0 0 2px rgba(28, 28, 30, .9);
                pointer-events: none;
            }
            /* Dot on the nav's account pill while there is no picture. */
            #open-auth-btn.pcp-needs-picture { position: relative; }
            #open-auth-btn.pcp-needs-picture::after {
                content: ''; position: absolute; top: 3px; left: 22px;
                width: 9px; height: 9px; border-radius: 50%;
                background: #ff453a; box-shadow: 0 0 0 2px #1c1c1e;
                pointer-events: none;
            }

            .pcp-overlay {
                position: fixed; inset: 0; z-index: 20000;
                display: grid; place-items: center; padding: 16px;
                background: rgba(0, 0, 0, 0); transition: background .28s ease;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
            }
            .pcp-overlay.is-open { background: rgba(0, 0, 0, .55); }
            .pcp-sheet {
                position: relative; width: min(480px, 100%); max-height: calc(100vh - 32px); overflow-y: auto;
                background: #1c1c1e; color: #f2f2f7; border-radius: 18px; padding: 22px 20px 16px;
                border: 1px solid rgba(255, 255, 255, .08); box-shadow: 0 24px 70px rgba(0, 0, 0, .55);
                opacity: 0; transform: translate3d(0, 12px, 0) scale(.98);
                transition: opacity .28s ease, transform .42s cubic-bezier(.32, .72, 0, 1);
            }
            .pcp-overlay.is-open .pcp-sheet { opacity: 1; transform: none; }
            .pcp-sheet:focus { outline: none; }
            .pcp-grab { display: none; }
            .pcp-x {
                position: absolute; top: 12px; right: 12px; width: 32px; height: 32px; border-radius: 50%;
                border: 0; background: rgba(255, 255, 255, .08); color: #aeaeb2; cursor: pointer; font-size: 15px;
            }
            .pcp-x:hover { background: rgba(255, 255, 255, .14); color: #fff; }
            .pcp-title { margin: 0 40px 6px 0; font-size: 1.15rem; font-weight: 700; letter-spacing: -.01em; }
            .pcp-sub { margin: 0 0 16px; font-size: .86rem; line-height: 1.45; color: rgba(235, 235, 245, .62); }
            .pcp-editor .pce-preview { margin-top: 2px; }
            .pcp-foot {
                display: flex; align-items: center; gap: 8px; margin-top: 14px; padding-top: 14px;
                border-top: 1px solid rgba(255, 255, 255, .08);
            }
            .pcp-spacer { flex: 1; }
            .pcp-link {
                border: 0; background: none; padding: 0; color: rgba(235, 235, 245, .6);
                font: inherit; font-size: .84rem; cursor: pointer; text-decoration: underline; text-underline-offset: 3px;
            }
            .pcp-link:hover { color: #fff; }
            .pcp-btn {
                height: 38px; padding: 0 16px; border-radius: 10px; cursor: pointer;
                font: inherit; font-size: .88rem; font-weight: 600; color: #f2f2f7;
                background: rgba(255, 255, 255, .08); border: 1px solid rgba(255, 255, 255, .12);
            }
            .pcp-btn:hover { filter: brightness(1.15); }
            .pcp-primary { background: #f2f2f7; color: #1c1c1e; border-color: #f2f2f7; }

            /* Phones: a bottom sheet. */
            @media (max-width: 768px) {
                .pcp-overlay { place-items: end stretch; padding: 0; }
                .pcp-sheet {
                    width: 100%; max-height: 88vh; border-radius: 18px 18px 0 0; border-bottom: 0;
                    padding: 10px 16px calc(14px + env(safe-area-inset-bottom));
                    opacity: 1; transform: translate3d(0, 100%, 0);
                    transition: transform .5s cubic-bezier(.32, .72, 0, 1);
                }
                .pcp-grab { display: block; width: 36px; height: 5px; border-radius: 3px; background: rgba(255, 255, 255, .22); margin: 0 auto 14px; }
                .pcp-x { top: 16px; }
            }
            @media (prefers-reduced-motion: reduce) {
                .pcp-overlay, .pcp-sheet { transition: none; }
            }
        `;
        document.head.appendChild(style);
    },
};
