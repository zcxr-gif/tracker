/**
 * playbackFarewell.js — the letter about Global Playback.
 *
 * Global Playback (the rewind that took the whole map back to a moment) has
 * been withdrawn from the tracker. Taking a feature away without saying why is
 * how a tool loses the people who trusted it, so this is the saying-why: a
 * short letter, shown once per browser, dismissible, and never shown again.
 *
 * Website only. The iOS app never carried Global Playback, so it has nothing to
 * apologise for and nothing to explain.
 *
 * Two ways in:
 *   • Once, automatically, a beat after boot (localStorage
 *     'inflight_playback_farewell_seen' remembers that it has been read).
 *   • window.InflightPlaybackFarewell.open() — which is what flight.js calls
 *     when an `openGlobalPlayback` event still arrives from a cached copy of
 *     the old chrome, so a stale Playback button explains itself rather than
 *     doing nothing at all.
 *
 * Loaded as a plain (non-module) script alongside changelog.js.
 */
(function () {
    'use strict';

    const SEEN_KEY = 'inflight_playback_farewell_seen';

    // Bumped only if the letter is ever rewritten enough to be worth showing
    // again. Stored rather than a bare "true" so that remains possible.
    const LETTER_ID = '2026.08.25';

    const PARAGRAPHS = [
        'Global Playback — the rewind that took the whole map back to a moment and flew it again — has been removed from the tracker.',
        'It was the most ambitious thing on here. Keeping a fortnight of every aircraft on every server ready to play back turned out to cost more than this project can carry, and a version of it that only half worked would have been worse than none.',
        'We are sorry. It was offered, it was used, and it has been taken away — there is no version of that we feel good about, and we are not going to write it up as a tidy-up.',
        'The other two replays are untouched. A single flight still replays from its own window, and a controller’s session still replays from theirs.',
        'If Global Playback comes back, it will be because we can run it properly.'
    ];

    // ---------------------------------------------------------------------
    // Styles
    // ---------------------------------------------------------------------

    function injectStyles() {
        if (document.getElementById('inflight-pbf-styles')) return;
        const style = document.createElement('style');
        style.id = 'inflight-pbf-styles';
        style.textContent = `
            .pbf-overlay {
                /* Same layer the changelog popup uses — above the desktop
                   Global Settings modal and the mobile settings sheet. */
                position: fixed; inset: 0; z-index: 100000;
                display: flex; align-items: center; justify-content: center;
                background: rgba(8, 10, 16, 0.66); backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                opacity: 0; pointer-events: none; transition: opacity .22s ease;
                padding: 18px; box-sizing: border-box;
            }
            .pbf-overlay.visible { opacity: 1; pointer-events: auto; }
            .pbf-card {
                width: min(460px, 100%); max-height: min(82dvh, 680px);
                display: flex; flex-direction: column; overflow: hidden;
                background: #121214; border: 1px solid rgba(255,255,255,0.1);
                border-radius: 18px; box-shadow: 0 24px 70px rgba(0,0,0,0.6);
                transform: translateY(14px) scale(0.98);
                transition: transform .28s cubic-bezier(0.16,1,0.3,1);
            }
            .pbf-overlay.visible .pbf-card { transform: translateY(0) scale(1); }
            .pbf-head {
                position: relative; flex: 0 0 auto; padding: 20px 20px 14px;
                border-bottom: 1px solid rgba(255,255,255,0.07);
            }
            .pbf-eyebrow {
                display: inline-flex; align-items: center; gap: 7px;
                font-size: 0.62rem; font-weight: 800; letter-spacing: .1em;
                text-transform: uppercase; color: #94a3b8; margin-bottom: 7px;
            }
            .pbf-head h2 {
                margin: 0; color: #fff; font-size: 1.22rem; font-weight: 800;
                letter-spacing: -0.3px; line-height: 1.2; padding-right: 34px;
            }
            .pbf-close {
                position: absolute; top: 14px; right: 14px;
                width: 30px; height: 30px; border-radius: 50%;
                display: flex; align-items: center; justify-content: center;
                background: rgba(255,255,255,0.06);
                border: 1px solid rgba(255,255,255,0.09);
                color: #cbd5e1; cursor: pointer; font-size: 0.85rem;
            }
            .pbf-close:hover { background: rgba(255,255,255,0.12); color: #fff; }
            .pbf-body {
                flex: 1 1 auto; overflow-y: auto; padding: 16px 20px 4px;
            }
            .pbf-body p {
                margin: 0 0 13px; color: #cbd5e1;
                font-size: 0.86rem; line-height: 1.62;
            }
            .pbf-sign {
                margin: 2px 0 18px; color: #94a3b8;
                font-size: 0.82rem; font-weight: 700; letter-spacing: .01em;
            }
            .pbf-foot {
                flex: 0 0 auto; padding: 14px 20px 18px;
                border-top: 1px solid rgba(255,255,255,0.07);
            }
            .pbf-cta {
                width: 100%; padding: 11px 14px; border-radius: 11px;
                border: 1px solid rgba(255,255,255,0.12);
                background: rgba(255,255,255,0.07); color: #fff;
                font-size: 0.86rem; font-weight: 700; cursor: pointer;
            }
            .pbf-cta:hover { background: rgba(255,255,255,0.13); }
        `;
        document.head.appendChild(style);
    }

    // ---------------------------------------------------------------------
    // The letter
    // ---------------------------------------------------------------------

    let overlayEl = null;

    function close() {
        if (!overlayEl) return;
        overlayEl.classList.remove('visible');
        const el = overlayEl;
        overlayEl = null;
        setTimeout(() => { try { el.remove(); } catch (_) {} }, 260);
    }

    function open() {
        injectStyles();
        if (overlayEl) close();

        overlayEl = document.createElement('div');
        overlayEl.className = 'pbf-overlay';
        overlayEl.innerHTML = `
            <div class="pbf-card" role="dialog" aria-modal="true" aria-label="A letter about Global Playback">
                <div class="pbf-head">
                    <span class="pbf-eyebrow"><i class="fa-solid fa-envelope-open-text"></i> A letter</span>
                    <h2>About Global Playback</h2>
                    <button class="pbf-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="pbf-body custom-scroll">
                    ${PARAGRAPHS.map((t) => `<p>${t}</p>`).join('')}
                    <p class="pbf-sign">&mdash; The Inflight team</p>
                </div>
                <div class="pbf-foot">
                    <button class="pbf-cta">Understood</button>
                </div>
            </div>`;

        overlayEl.addEventListener('click', (e) => {
            if (e.target === overlayEl || e.target.closest('.pbf-close') || e.target.closest('.pbf-cta')) close();
        });
        document.body.appendChild(overlayEl);
        // Next frame so the entrance transition runs.
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (overlayEl) overlayEl.classList.add('visible');
        }));
    }

    // ---------------------------------------------------------------------
    // One-time showing
    // ---------------------------------------------------------------------

    function maybeShowOnBoot() {
        // A share link opens straight onto a flight window; don't stack a
        // letter on top of it. They'll read it on their next normal visit.
        try {
            const p = new URLSearchParams(window.location.search || '');
            if (p.get('flight') || p.get('replay') ||
                sessionStorage.getItem('inflight_share_payload') ||
                sessionStorage.getItem('inflight_replay_payload')) return;
        } catch (_) { /* non-fatal */ }

        // Storage unreadable (private mode) means we can't remember showing
        // this, and a letter that reappears on every load is a nag.
        let seen;
        try { seen = localStorage.getItem(SEEN_KEY); } catch (_) { return; }
        if (seen === LETTER_ID) return;

        const started = Date.now();
        const timer = setInterval(() => {
            const splashGone = !document.getElementById('inflight-pro-loader-overlay');
            const loaded = document.readyState === 'complete';
            if (splashGone && loaded) {
                clearInterval(timer);
                waitForFirstRunGate().then(() => {
                    // Release notes are due this boot: two letters on the same
                    // layer, one behind the other, is not a way to be read. This
                    // one waits for the next visit — and is NOT marked seen, so
                    // the next visit really does show it.
                    if (changelogPopupDue()) return;
                    setTimeout(() => {
                        // Marked read the moment it shows, so a tab closed mid-read
                        // doesn't bring it back tomorrow.
                        try { localStorage.setItem(SEEN_KEY, LETTER_ID); } catch (_) {}
                        open();
                    }, 900);
                });
            } else if (Date.now() - started > 30000) {
                clearInterval(timer); // splash never cleared — skip this session
            }
        }, 400);
    }

    /**
     * Is the changelog about to show its own popup on this boot?
     *
     * It shows once per release, gated on the same first-run promise this
     * letter waits for, so the two would otherwise land within a second of each
     * other. Read from the changelog's own key rather than from the DOM: at the
     * moment this is asked neither popup has mounted yet, so there is nothing
     * to see. Unknown (no changelog loaded, storage unreadable) counts as "not
     * due" — the letter is the thing being deferred, and deferring it forever
     * on a storage error would be worse than an overlap that cannot happen.
     */
    function changelogPopupDue() {
        const latest = window.InflightChangelog && window.InflightChangelog.latestVersion;
        if (!latest) return false;
        try { return localStorage.getItem('inflight_changelog_seen') !== latest; } catch (_) { return false; }
    }

    /**
     * Wait out the first-run gate — the legal modal and the window picker. A
     * brand-new pilot would otherwise get both of those and this letter stacked
     * on top of each other. Fails open: a boot hiccup can delay the letter,
     * never permanently eat it.
     */
    async function waitForFirstRunGate() {
        const t0 = Date.now();
        while (!window.__inflightFirstRunPromise && Date.now() - t0 < 20000) {
            await new Promise((r) => setTimeout(r, 200));
        }
        try {
            if (window.__inflightFirstRunPromise) {
                await Promise.race([
                    window.__inflightFirstRunPromise,
                    new Promise((r) => setTimeout(r, 10 * 60 * 1000))
                ]);
            }
        } catch (_) { /* never block the letter on gate errors */ }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', maybeShowOnBoot, { once: true });
    } else {
        maybeShowOnBoot();
    }

    // ---------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------

    window.InflightPlaybackFarewell = { open, close };
})();
