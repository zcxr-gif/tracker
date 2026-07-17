/**
 * communityHub.js
 *
 * One place for community aircraft photos: browse the gallery and submit your
 * own, in a single bottom sheet that matches the app's mobile Settings UI
 * (zinc sheet, #38bdf8 sky accent, segmented tab bar, section headers) and
 * showcases images the way the "Card" flight-info window does (rounded photo
 * tiles with a fading caption + credit pill).
 *
 * Tabs:
 *   • Gallery — every community image, searchable; set your contributor name
 *     to highlight and filter to your own uploads.
 *   • Submit  — upload up to 3 photos for staff review.
 *
 * Public API:
 *   window.InflightCommunity.open('gallery' | 'submit')
 *   window.InflightCommunity.close()
 *   window.InflightCommunity.invite()          // force-show the invite toast
 * Back-compat aliases (kept so existing links keep working):
 *   window.InflightAircraftSubmit.open()  -> hub on the Submit tab
 *   window.InflightAircraftGallery.open() -> hub on the Gallery tab
 */
(function () {
    'use strict';

    const BACKEND = 'https://site--indgo-backend--6dmjph8ltlhv.code.run';
    const SUBMIT_ENDPOINT = BACKEND + '/api/community/aircraft/submit';
    const LIST_ENDPOINT = BACKEND + '/api/aircraft';
    const MAX_IMAGES = 3;
    const FALLBACK_IMG = '/CommunityPlanes/default.png';

    const NAME_KEY = 'inflight_contributor_name';
    const INVITE_KEY = 'inflight_submit_invite_seen';

    const savedName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch (_) { return ''; } };
    const saveName = (n) => { try { n ? localStorage.setItem(NAME_KEY, n) : localStorage.removeItem(NAME_KEY); } catch (_) {} };
    const inviteSeen = () => { try { return localStorage.getItem(INVITE_KEY) === '1'; } catch (_) { return true; } };
    const markInviteSeen = () => { try { localStorage.setItem(INVITE_KEY, '1'); } catch (_) {} };

    const norm = (s) => String(s || '').trim().toLowerCase();
    const esc = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    let overlayEl = null, els = {};
    let currentTab = 'gallery';
    let photos = [], loaded = false, loading = false, mineOnly = false;

    // ---------------------------------------------------------------------
    // Styles — modelled on MobileSettingsUI's bottom sheet + the Card window.
    // ---------------------------------------------------------------------
    let stylesInjected = false;
    function injectStyles() {
        if (stylesInjected || typeof document === 'undefined') return;
        stylesInjected = true;
        const style = document.createElement('style');
        style.id = 'inflight-ach-styles';
        style.textContent = `
        :root {
            --ach-sky: #38bdf8;
            --ach-sky-soft: rgba(56,189,248,0.12);
            --ach-sky-ring: rgba(56,189,248,0.35);
            --ach-ink: #04141d;
            --ach-sheet: #0a0a0b;
            --ach-elev: #18181b;
            --ach-row: rgba(255,255,255,0.03);
            --ach-line: rgba(255,255,255,0.10);
            --ach-line2: rgba(255,255,255,0.07);
            --ach-t1: #ffffff;
            --ach-t2: #a1a1aa;
            --ach-t3: #71717a;
        }
        .ach-overlay {
            position: fixed; inset: 0; z-index: 20000;
            display: flex; align-items: flex-end; justify-content: center;
            background: rgba(0,0,0,0.7);
            backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
            opacity: 0; visibility: hidden; transition: opacity .3s ease, visibility .3s ease;
        }
        .ach-overlay.visible { opacity: 1; visibility: visible; }

        .ach-sheet {
            position: relative; width: 100%; height: 88vh; height: 88dvh;
            display: flex; flex-direction: column;
            background: var(--ach-sheet);
            border-top: 1px solid var(--ach-line);
            border-radius: 24px 24px 0 0;
            color: var(--ach-t1);
            font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
            padding-bottom: env(safe-area-inset-bottom);
            transform: translateY(100%);
            transition: transform .4s cubic-bezier(.16,1,.3,1);
            overflow: hidden;
        }
        .ach-overlay.visible .ach-sheet { transform: none; }
        @media (min-width: 769px) {
            .ach-overlay { align-items: center; padding: 20px; }
            .ach-sheet {
                width: 100%; max-width: 780px; height: 80vh; max-height: 840px;
                border: 1px solid var(--ach-line); border-radius: 22px;
                transform: translateY(22px) scale(.985); opacity: .5;
                transition: transform .28s cubic-bezier(.16,.84,.44,1), opacity .28s ease;
            }
            .ach-overlay.visible .ach-sheet { transform: none; opacity: 1; }
        }

        .ach-handle { width: 40px; height: 5px; background: rgba(255,255,255,0.2); border-radius: 10px; margin: 12px auto 4px; flex: 0 0 auto; }
        @media (min-width: 769px) { .ach-handle { display: none; } }
        .ach-close {
            position: absolute; top: 14px; right: 14px; z-index: 5;
            width: 30px; height: 30px; border-radius: 50%; padding: 0; border: none;
            display: grid; place-items: center; cursor: pointer;
            background: rgba(120,120,128,0.32); color: rgba(235,235,245,0.65); font-size: 14px;
            transition: transform .15s ease, background .15s ease;
        }
        .ach-close:active { transform: scale(.92); }
        .ach-close:hover { background: rgba(120,120,128,0.5); color: #fff; }

        .ach-title {
            padding: 6px 20px 12px; font-size: 1.35rem; font-weight: 800; letter-spacing: -0.02em;
            display: flex; align-items: center; gap: 12px; flex: 0 0 auto;
        }
        @media (min-width: 769px) { .ach-title { padding-top: 18px; } }
        .ach-title i { color: var(--ach-sky); }

        /* Segmented tab bar */
        .ach-tabbar {
            display: flex; gap: 4px; margin: 0 16px 8px; padding: 4px; flex: 0 0 auto;
            background: rgba(255,255,255,0.05); border-radius: 14px;
        }
        .ach-tab {
            flex: 1; display: flex; align-items: center; justify-content: center; gap: 7px;
            background: transparent; border: none; color: var(--ach-t3);
            padding: 10px 6px; border-radius: 10px; font-size: 0.82rem; font-weight: 700;
            cursor: pointer; font-family: inherit; -webkit-tap-highlight-color: transparent; transition: .2s;
        }
        .ach-tab i { font-size: .92rem; }
        .ach-tab.active { background: var(--ach-elev); color: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.4); }
        .ach-tab.active i { color: var(--ach-sky); }

        .ach-scroll { flex: 1 1 auto; overflow-y: auto; -webkit-overflow-scrolling: touch; }
        .ach-scroll::-webkit-scrollbar { width: 8px; }
        .ach-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 8px; }
        .ach-panel { display: none; animation: achFade .25s ease; }
        .ach-panel.active { display: block; }
        @keyframes achFade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

        .ach-sec { padding: 14px 20px 8px; font-size: 0.7rem; font-weight: 900; color: var(--ach-t3); text-transform: uppercase; letter-spacing: 1px; }

        /* Inputs / pills (settings language) */
        .ach-input {
            width: 100%; box-sizing: border-box; padding: 11px 13px; border-radius: 12px;
            background: rgba(255,255,255,0.05); border: 1px solid var(--ach-line);
            color: #fff; font: inherit; font-size: 0.9rem; transition: border-color .15s ease, background .15s ease;
        }
        .ach-input::placeholder { color: var(--ach-t3); }
        .ach-input:focus { outline: none; border-color: var(--ach-sky); background: var(--ach-sky-soft); }

        /* ---- Gallery ---- */
        .ach-gal-controls { display: flex; flex-wrap: wrap; gap: 8px; padding: 4px 16px 6px; }
        .ach-gal-controls .ach-input { flex: 1 1 180px; min-width: 130px; }
        .ach-mine {
            flex: 0 0 auto; display: inline-flex; align-items: center; gap: 7px; white-space: nowrap;
            padding: 11px 14px; border-radius: 12px; cursor: pointer; font: inherit; font-size: 0.82rem; font-weight: 700;
            background: rgba(255,255,255,0.05); border: 1px solid var(--ach-line); color: var(--ach-t2);
            transition: .15s; -webkit-tap-highlight-color: transparent;
        }
        .ach-mine[hidden] { display: none; }
        .ach-mine.active { background: var(--ach-sky); border-color: var(--ach-sky); color: var(--ach-ink); }
        .ach-mine:active { transform: scale(.96); }

        .ach-stats { padding: 2px 20px 4px; font-size: 0.76rem; color: var(--ach-t3); }

        .ach-grid {
            display: grid; gap: 12px; padding: 8px 16px 24px;
            grid-template-columns: repeat(auto-fill, minmax(158px, 1fr));
        }
        .ach-tile {
            position: relative; aspect-ratio: 4 / 3; border-radius: 16px; overflow: hidden;
            background: var(--ach-elev); border: 1px solid var(--ach-line2); cursor: default;
        }
        .ach-tile.mine { border-color: var(--ach-sky); box-shadow: 0 0 0 1.5px var(--ach-sky-ring); }
        .ach-tile-img {
            position: absolute; inset: 0; width: 100%; height: 100%;
            object-fit: cover; display: block; background: #101014;
            transition: transform .5s ease;
        }
        .ach-tile:hover .ach-tile-img { transform: scale(1.05); }
        .ach-sentinel { grid-column: 1 / -1; height: 1px; }
        .ach-tile-fade {
            position: absolute; inset: 0; pointer-events: none;
            background: linear-gradient(to bottom, rgba(10,10,11,0) 42%, rgba(10,10,11,0.4) 66%, rgba(10,10,11,0.9) 100%);
        }
        .ach-tile-cap { position: absolute; left: 11px; right: 11px; bottom: 9px; z-index: 2; }
        .ach-tile-cap .t { font-size: 0.9rem; font-weight: 800; color: #fff; line-height: 1.15; letter-spacing: -0.01em;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 1px 4px rgba(0,0,0,.6); }
        .ach-tile-cap .s { font-size: 0.74rem; font-weight: 600; color: #d4d4d8; margin-top: 1px;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 1px 4px rgba(0,0,0,.6); }
        .ach-credit {
            position: absolute; right: 8px; top: 8px; z-index: 3; max-width: 74%;
            font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: .3px;
            color: rgba(255,255,255,0.85); background: rgba(0,0,0,0.5);
            padding: 3px 8px; border-radius: 99px; border: 1px solid rgba(255,255,255,0.1);
            -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px);
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .ach-you {
            position: absolute; left: 8px; top: 8px; z-index: 3;
            font-size: 9px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase;
            color: var(--ach-ink); background: var(--ach-sky);
            padding: 3px 8px; border-radius: 99px;
        }
        .ach-empty, .ach-error { grid-column: 1 / -1; text-align: center; padding: 48px 16px; color: var(--ach-t3); font-size: .88rem; }
        .ach-error { color: #f87171; }
        .ach-skel {
            aspect-ratio: 4 / 3; border-radius: 16px;
            background: linear-gradient(100deg, rgba(255,255,255,0.03) 30%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 70%);
            background-size: 200% 100%; animation: achShimmer 1.2s ease-in-out infinite;
        }
        @keyframes achShimmer { to { background-position: -200% 0; } }

        /* ---- Submit ---- */
        .ach-form { padding: 0 20px 24px; }
        .ach-drop {
            position: relative; display: flex; flex-direction: column; align-items: center; text-align: center;
            cursor: pointer; border: 1.5px dashed rgba(255,255,255,0.18); border-radius: 14px;
            padding: 26px 16px; background: var(--ach-row); transition: border-color .18s ease, background .18s ease;
        }
        .ach-drop:hover, .ach-drop.dragover { border-color: var(--ach-sky); background: var(--ach-sky-soft); }
        .ach-drop input[type="file"] { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }
        .ach-drop-icon {
            width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center; margin-bottom: 10px;
            font-size: 1.25rem; color: var(--ach-sky); background: var(--ach-sky-soft); border: 1px solid var(--ach-sky-ring);
            transition: transform .18s ease;
        }
        .ach-drop:hover .ach-drop-icon, .ach-drop.dragover .ach-drop-icon { transform: translateY(-2px); }
        .ach-drop-title { font-size: .92rem; font-weight: 700; color: var(--ach-t1); }
        .ach-drop-title b { color: var(--ach-sky); }
        .ach-drop-sub { margin-top: 3px; font-size: .76rem; color: var(--ach-t2); }

        .ach-previews { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
        .ach-previews:empty { display: none; }
        .ach-thumb { position: relative; width: 76px; height: 76px; border-radius: 12px; overflow: hidden;
            border: 1px solid var(--ach-line); background: #0c0c0e; }
        .ach-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .ach-thumb button {
            position: absolute; top: 4px; right: 4px; width: 20px; height: 20px; border-radius: 50%; border: none;
            background: rgba(0,0,0,0.7); color: #fff; font-size: .78rem; line-height: 1; cursor: pointer;
            display: grid; place-items: center; transition: background .15s ease;
        }
        .ach-thumb button:hover { background: #f87171; }

        .ach-field { margin-top: 14px; }
        .ach-field-label { display: flex; align-items: center; gap: 6px; margin-bottom: 7px;
            font-size: 0.72rem; font-weight: 800; color: var(--ach-t3); text-transform: uppercase; letter-spacing: .6px; }
        .ach-field-label .req { color: var(--ach-sky); }
        .ach-field-label .opt { color: var(--ach-t3); font-weight: 500; letter-spacing: 0; text-transform: none; font-size: .72rem; }

        .ach-submit {
            width: 100%; margin-top: 20px; border: none; cursor: pointer; font: inherit;
            padding: 14px 16px; border-radius: 13px; font-size: 0.96rem; font-weight: 800;
            color: var(--ach-ink); background: var(--ach-sky);
            box-shadow: 0 6px 18px rgba(56,189,248,0.25);
            display: flex; align-items: center; justify-content: center; gap: 8px;
            transition: transform .15s ease, filter .15s ease;
        }
        .ach-submit:hover { filter: brightness(1.06); }
        .ach-submit:active { transform: scale(.99); }
        .ach-submit:disabled { opacity: .55; cursor: not-allowed; box-shadow: none; }
        .ach-status { margin-top: 12px; text-align: center; font-size: .84rem; min-height: 1.1em; color: var(--ach-t2); line-height: 1.4; }
        .ach-status.ok { color: #34d399; }
        .ach-status.err { color: #f87171; }
        .ach-note { margin-top: 10px; text-align: center; font-size: .76rem; color: var(--ach-t3); }

        /* ---- Invite toast ---- */
        .ach-toast {
            position: fixed; z-index: 19000;
            left: max(env(safe-area-inset-left,0px),16px); bottom: max(env(safe-area-inset-bottom,0px),16px);
            width: 340px; max-width: calc(100vw - 32px); overflow: hidden;
            background: var(--ach-elev); border: 1px solid var(--ach-line); border-radius: 18px;
            box-shadow: 0 20px 50px rgba(0,0,0,0.55);
            color: var(--ach-t1); font-family: 'Inter', system-ui, -apple-system, sans-serif;
            transform: translateY(24px) scale(.96); opacity: 0;
            transition: transform .4s cubic-bezier(.16,1,.3,1), opacity .4s ease;
        }
        .ach-toast.visible { transform: none; opacity: 1; }
        .ach-toast::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: var(--ach-sky); }
        .ach-toast-inner { display: flex; gap: 13px; padding: 17px 16px 16px; }
        .ach-toast-icon { flex: 0 0 auto; width: 42px; height: 42px; border-radius: 13px; display: grid; place-items: center;
            font-size: 1.1rem; color: var(--ach-sky); background: var(--ach-sky-soft); border: 1px solid var(--ach-sky-ring); }
        .ach-toast-body { flex: 1 1 auto; min-width: 0; padding-right: 12px; }
        .ach-toast-body strong { display: block; font-size: .95rem; font-weight: 800; color: #fff; }
        .ach-toast-body p { margin: 4px 0 0; font-size: .8rem; color: var(--ach-t2); line-height: 1.4; }
        .ach-toast-actions { display: flex; gap: 8px; margin-top: 12px; }
        .ach-toast-cta { border: none; cursor: pointer; font: inherit; color: var(--ach-ink); background: var(--ach-sky);
            padding: 8px 15px; border-radius: 10px; font-size: .82rem; font-weight: 800; transition: filter .15s ease; }
        .ach-toast-cta:hover { filter: brightness(1.06); }
        .ach-toast-later { border: 1px solid var(--ach-line); background: rgba(255,255,255,0.04); color: var(--ach-t2);
            cursor: pointer; font: inherit; padding: 8px 13px; border-radius: 10px; font-size: .82rem; font-weight: 700; transition: .15s; }
        .ach-toast-later:hover { background: rgba(255,255,255,0.1); color: #fff; }
        .ach-toast-x { position: absolute; top: 10px; right: 11px; width: 22px; height: 22px; border-radius: 50%; border: none;
            background: transparent; color: var(--ach-t3); font-size: 1.05rem; line-height: 1; cursor: pointer;
            display: grid; place-items: center; transition: .15s; }
        .ach-toast-x:hover { color: #fff; background: rgba(255,255,255,0.08); }

        /* Clear the mobile bottom tab bar so the toast isn't hidden behind it. */
        @media (max-width: 768px) {
            .ach-toast {
                left: 12px; right: 12px; width: auto;
                bottom: calc(env(safe-area-inset-bottom, 0px) + 74px);
            }
        }`;
        document.head.appendChild(style);
    }

    // ---------------------------------------------------------------------
    // Build the sheet
    // ---------------------------------------------------------------------
    function buildSheet() {
        if (overlayEl) return;
        injectStyles();

        overlayEl = document.createElement('div');
        overlayEl.className = 'ach-overlay';
        overlayEl.setAttribute('role', 'dialog');
        overlayEl.setAttribute('aria-modal', 'true');
        overlayEl.setAttribute('aria-label', 'Community aircraft');
        overlayEl.innerHTML = `
        <div class="ach-sheet">
            <div class="ach-handle"></div>
            <button type="button" class="ach-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
            <div class="ach-title"><i class="fa-solid fa-plane-up"></i> Community Aircraft</div>

            <div class="ach-tabbar">
                <button type="button" class="ach-tab" data-tab="gallery"><i class="fa-solid fa-images"></i><span>Gallery</span></button>
                <button type="button" class="ach-tab" data-tab="submit"><i class="fa-solid fa-camera"></i><span>Submit</span></button>
            </div>

            <div class="ach-scroll">
                <!-- Gallery -->
                <div class="ach-panel" data-panel="gallery">
                    <div class="ach-gal-controls">
                        <input class="ach-input ach-search" type="search" placeholder="Search type or livery…" aria-label="Search">
                        <input class="ach-input ach-name" type="text" placeholder="Your contributor name" aria-label="Your contributor name">
                        <button type="button" class="ach-mine" hidden><i class="fa-solid fa-user-check"></i> My uploads <span class="cnt"></span></button>
                    </div>
                    <div class="ach-stats"></div>
                    <div class="ach-grid" aria-live="polite"></div>
                </div>

                <!-- Submit -->
                <div class="ach-panel" data-panel="submit">
                    <form class="ach-form" id="achForm" enctype="multipart/form-data" novalidate>
                        <div class="ach-sec" style="padding-left:0;">Photos</div>
                        <label class="ach-drop" id="achDrop">
                            <input type="file" name="images" accept="image/*" multiple required>
                            <div class="ach-drop-icon"><i class="fa-solid fa-cloud-arrow-up"></i></div>
                            <div class="ach-drop-title">Drop photos here or <b>browse</b></div>
                            <div class="ach-drop-sub">Up to ${MAX_IMAGES} images &middot; JPG, PNG or WEBP</div>
                        </label>
                        <div class="ach-previews" id="achPreviews"></div>

                        <div class="ach-field">
                            <label class="ach-field-label">Aircraft type <span class="req">*</span></label>
                            <input class="ach-input" type="text" name="aircraftType" placeholder="e.g. A320neo" required>
                        </div>
                        <div class="ach-field">
                            <label class="ach-field-label">Livery <span class="req">*</span></label>
                            <input class="ach-input" type="text" name="liveryName" placeholder="e.g. IndiGo" required>
                        </div>
                        <div class="ach-field">
                            <label class="ach-field-label">Tail number <span class="opt">optional</span></label>
                            <input class="ach-input" type="text" name="tailNumber" placeholder="e.g. VT-IZA">
                        </div>
                        <div class="ach-field">
                            <label class="ach-field-label">Your name / credit <span class="opt">optional</span></label>
                            <input class="ach-input" type="text" name="collaboratorName" placeholder="Shown as the contributor">
                        </div>
                        <input type="hidden" name="collaboratorId" value="">

                        <button type="submit" class="ach-submit"><i class="fa-solid fa-paper-plane"></i> Submit for review</button>
                        <p class="ach-status" id="achStatus" role="status" aria-live="polite"></p>
                        <p class="ach-note">Staff review every submission on Discord before it goes live.</p>
                    </form>
                </div>
            </div>
        </div>`;

        document.body.appendChild(overlayEl);

        els = {
            sheet: overlayEl.querySelector('.ach-sheet'),
            tabs: overlayEl.querySelectorAll('.ach-tab'),
            panels: overlayEl.querySelectorAll('.ach-panel'),
            search: overlayEl.querySelector('.ach-search'),
            name: overlayEl.querySelector('.ach-name'),
            mine: overlayEl.querySelector('.ach-mine'),
            stats: overlayEl.querySelector('.ach-stats'),
            grid: overlayEl.querySelector('.ach-grid'),
            scroll: overlayEl.querySelector('.ach-scroll'),
            form: overlayEl.querySelector('#achForm'),
            drop: overlayEl.querySelector('#achDrop'),
            file: overlayEl.querySelector('input[name="images"]'),
            previews: overlayEl.querySelector('#achPreviews'),
            submit: overlayEl.querySelector('.ach-submit'),
            status: overlayEl.querySelector('#achStatus')
        };

        // Dismiss
        overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) close(); });
        overlayEl.querySelector('.ach-close').addEventListener('click', close);

        // Tabs
        els.tabs.forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));

        // Gallery controls
        els.search.addEventListener('input', renderGallery);
        els.name.value = savedName();
        els.name.addEventListener('input', () => {
            saveName(els.name.value.trim());
            if (!els.name.value.trim()) mineOnly = false;
            renderGallery();
        });
        els.mine.addEventListener('click', () => {
            if (!els.name.value.trim()) { els.name.focus(); return; }
            mineOnly = !mineOnly; renderGallery();
        });

        // Submit interactions
        ['dragenter', 'dragover'].forEach(ev => els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.add('dragover'); }));
        ['dragleave', 'drop'].forEach(ev => els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.remove('dragover'); }));
        els.file.addEventListener('change', renderPreviews);
        els.form.addEventListener('submit', onSubmit);
    }

    function setTab(tab) {
        currentTab = tab;
        els.tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
        els.panels.forEach(p => p.classList.toggle('active', p.dataset.panel === tab));
        if (tab === 'gallery') load();
        if (tab === 'submit') prefillCredit();
    }

    // ---------------------------------------------------------------------
    // Gallery data + render
    // ---------------------------------------------------------------------
    async function load(force) {
        if (loading || (loaded && !force)) return;
        loading = true;
        renderSkeleton();
        try {
            const res = await fetch(LIST_ENDPOINT);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            photos = flatten(Array.isArray(data) ? data : []);
            loaded = true;
            renderGallery();
        } catch (_) {
            if (els.grid) els.grid.innerHTML = `<div class="ach-error">Couldn't load the gallery. Please try again in a moment.</div>`;
        } finally {
            loading = false;
        }
    }

    function flatten(entries) {
        const out = [];
        entries.forEach((e) => {
            const urls = (Array.isArray(e.imageUrls) && e.imageUrls.length)
                ? e.imageUrls.filter(Boolean)
                : (e.imageUrl ? [e.imageUrl] : []);
            if (!urls.length) return;
            const contributors = Array.isArray(e.imageContributors) ? e.imageContributors : [];
            urls.forEach((url, i) => {
                out.push({
                    type: e.aircraftType || 'Unknown type',
                    livery: e.liveryName || 'Unknown livery',
                    tail: e.tailNumber || '',
                    url,
                    contributor: (contributors[i] && contributors[i].name) || e.contributorName || 'IF Community'
                });
            });
        });
        return out;
    }

    function renderSkeleton() {
        if (els.grid) els.grid.innerHTML = Array(9).fill('<div class="ach-skel"></div>').join('');
        if (els.stats) els.stats.textContent = '';
    }

    // Incremental rendering: build tiles in small batches and let native lazy
    // loading fetch/decode images only as they scroll into view. This keeps the
    // main thread free so opening the gallery doesn't spike, however many
    // images the backend returns.
    const BATCH = 24;
    let renderList = [], renderCursor = 0, tileObserver = null, sentinelEl = null;

    function tileHTML(p, me) {
        const isMine = me && norm(p.contributor) === me;
        const credit = p.contributor && p.contributor !== 'IF Community'
            ? `<span class="ach-credit">© ${esc(p.contributor)}</span>` : '';
        return `
            <div class="ach-tile${isMine ? ' mine' : ''}">
                <img class="ach-tile-img" loading="lazy" decoding="async" alt="${esc(p.type)} — ${esc(p.livery)}"
                     src="${esc(p.url)}" onerror="this.onerror=null;this.src='${FALLBACK_IMG}'">
                <div class="ach-tile-fade"></div>
                ${isMine ? '<span class="ach-you">You</span>' : ''}
                ${credit}
                <div class="ach-tile-cap">
                    <div class="t">${esc(p.type)}</div>
                    <div class="s">${esc(p.livery)}${p.tail ? ' · ' + esc(p.tail) : ''}</div>
                </div>
            </div>`;
    }

    function appendBatch() {
        if (!els.grid) return;
        const end = Math.min(renderCursor + BATCH, renderList.length);
        if (renderCursor < end) {
            const me = norm(els.name && els.name.value);
            let html = '';
            for (; renderCursor < end; renderCursor++) html += tileHTML(renderList[renderCursor], me);
            if (sentinelEl) els.grid.insertBefore(rangeFromHTML(html), sentinelEl);
            else els.grid.insertAdjacentHTML('beforeend', html);
        }
        // Done — retire the sentinel/observer.
        if (renderCursor >= renderList.length && tileObserver) {
            tileObserver.disconnect(); tileObserver = null;
            if (sentinelEl) { sentinelEl.remove(); sentinelEl = null; }
        }
    }

    // Parse an HTML string into a fragment we can insert before the sentinel.
    function rangeFromHTML(html) {
        const tpl = document.createElement('template');
        tpl.innerHTML = html;
        return tpl.content;
    }

    function renderGallery() {
        if (!els.grid) return;
        const me = norm(els.name && els.name.value);
        const mineCount = me ? photos.filter(p => norm(p.contributor) === me).length : 0;

        if (els.mine) {
            els.mine.hidden = !me;
            els.mine.classList.toggle('active', mineOnly && !!me);
            els.mine.querySelector('.cnt').textContent = me ? `(${mineCount})` : '';
        }

        const term = norm(els.search && els.search.value);
        let list = photos;
        if (mineOnly && me) list = list.filter(p => norm(p.contributor) === me);
        if (term) list = list.filter(p => norm(p.type).includes(term) || norm(p.livery).includes(term) || norm(p.contributor).includes(term));

        if (els.stats) {
            let s = `${list.length} image${list.length === 1 ? '' : 's'}`;
            if (me && mineCount && !mineOnly) s += ` · ${mineCount} yours`;
            els.stats.textContent = loaded ? s : '';
        }

        // Reset any in-progress incremental render.
        if (tileObserver) { tileObserver.disconnect(); tileObserver = null; }
        sentinelEl = null;
        els.grid.innerHTML = '';

        if (!list.length) {
            els.grid.innerHTML = `<div class="ach-empty">${mineOnly ? 'No uploads under that contributor name yet.' : 'No images match your search.'}</div>`;
            return;
        }

        renderList = list;
        renderCursor = 0;

        // First batch now; the rest stream in as the sentinel nears the viewport.
        if (list.length > BATCH && 'IntersectionObserver' in window && els.scroll) {
            sentinelEl = document.createElement('div');
            sentinelEl.className = 'ach-sentinel';
            els.grid.appendChild(sentinelEl);
            appendBatch();
            tileObserver = new IntersectionObserver((entries) => {
                if (entries.some(e => e.isIntersecting)) appendBatch();
            }, { root: els.scroll, rootMargin: '600px 0px' });
            tileObserver.observe(sentinelEl);
        } else {
            renderCursor = renderList.length;
            els.grid.insertAdjacentHTML('beforeend', list.map(p => tileHTML(p, me)).join(''));
        }
    }

    // ---------------------------------------------------------------------
    // Submit
    // ---------------------------------------------------------------------
    const say = (msg, kind) => { if (els.status) { els.status.textContent = msg || ''; els.status.className = 'ach-status' + (kind ? ' ' + kind : ''); } };

    function prefillCredit() {
        const input = els.form && els.form.querySelector('input[name="collaboratorName"]');
        const known = savedName() || (window.InflightUser && (window.InflightUser.displayName || window.InflightUser.username)) || '';
        if (input && !input.value && known) input.value = known;
    }

    function renderPreviews() {
        if (!els.previews) return;
        els.previews.innerHTML = '';
        const files = Array.from(els.file.files || []);
        say(files.length > MAX_IMAGES ? 'Max ' + MAX_IMAGES + ' photos — extra files will be ignored.' : '', files.length > MAX_IMAGES ? 'err' : '');
        files.slice(0, MAX_IMAGES).forEach((file, idx) => {
            if (!file.type || !file.type.startsWith('image/')) return;
            const thumb = document.createElement('div');
            thumb.className = 'ach-thumb';
            const img = document.createElement('img');
            const url = URL.createObjectURL(file);
            img.src = url; img.alt = file.name; img.onload = () => URL.revokeObjectURL(url);
            const rm = document.createElement('button');
            rm.type = 'button'; rm.innerHTML = '&times;'; rm.title = 'Remove';
            rm.addEventListener('click', () => removeFileAt(idx));
            thumb.appendChild(img); thumb.appendChild(rm);
            els.previews.appendChild(thumb);
        });
    }

    function removeFileAt(idx) {
        const dt = new DataTransfer();
        Array.from(els.file.files || []).forEach((f, i) => { if (i !== idx) dt.items.add(f); });
        els.file.files = dt.files;
        renderPreviews();
    }

    async function onSubmit(e) {
        e.preventDefault();
        const files = els.file.files;
        if (!files || !files.length) return say('Please choose at least one photo.', 'err');
        if (files.length > MAX_IMAGES) return say('Max ' + MAX_IMAGES + ' photos per submission.', 'err');

        const linkedId = (window.InflightUser && window.InflightUser.discordId) || '';
        const hiddenId = els.form.querySelector('input[name="collaboratorId"]');
        if (hiddenId && !hiddenId.value && linkedId) hiddenId.value = linkedId;

        const creditInput = els.form.querySelector('input[name="collaboratorName"]');
        if (creditInput && creditInput.value.trim()) { saveName(creditInput.value.trim()); if (els.name) els.name.value = creditInput.value.trim(); }

        const fd = new FormData(els.form);
        fd.set('sourceSite', location.hostname);

        els.submit.disabled = true;
        say('Uploading…');
        try {
            const res = await fetch(SUBMIT_ENDPOINT, { method: 'POST', body: fd });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                say('✅ Submitted! Staff will review it on Discord shortly.', 'ok');
                els.form.reset();
                if (els.previews) els.previews.innerHTML = '';
            } else if (res.status === 403) {
                say('This site isn’t allowed to submit (origin check).', 'err');
            } else if (res.status === 503) {
                say('Review service is waking up — please try again in a moment.', 'err');
            } else {
                say('❌ ' + (data.message || ('Error ' + res.status)), 'err');
            }
        } catch (_) {
            say('Network error — please try again.', 'err');
        } finally {
            els.submit.disabled = false;
        }
    }

    // ---------------------------------------------------------------------
    // Open / close
    // ---------------------------------------------------------------------
    function open(tab) {
        buildSheet();
        if (els.name && !els.name.value) els.name.value = savedName();
        setTab(tab === 'submit' ? 'submit' : 'gallery');
        requestAnimationFrame(() => overlayEl.classList.add('visible'));
    }
    function close() { if (overlayEl) overlayEl.classList.remove('visible'); }

    // ---------------------------------------------------------------------
    // One-time invite toast
    // ---------------------------------------------------------------------
    const INVITES = [
        { h: 'Got great plane shots?', p: 'Add your Infinite Flight liveries to the community gallery — takes a few seconds.' },
        { h: 'Fly with a camera?', p: 'Share your best aircraft photos and get credited across the tracker.' },
        { h: 'Missing your favourite livery?', p: 'Submit your own plane images — staff review every one on Discord.' }
    ];
    let toastEl = null, toastTimer = null;

    function dismissInvite() {
        if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
        if (!toastEl) return;
        toastEl.classList.remove('visible');
        const el = toastEl; toastEl = null;
        setTimeout(() => el.remove(), 400);
    }

    function showInvite(opts) {
        if (typeof document === 'undefined') return;
        const force = !!(opts && opts.force);
        if (toastEl) { if (!force) return; dismissInvite(); }
        if (!force) markInviteSeen();
        injectStyles();

        const pick = INVITES[Math.floor(Math.random() * INVITES.length)];
        toastEl = document.createElement('div');
        toastEl.className = 'ach-toast';
        toastEl.setAttribute('role', 'dialog');
        toastEl.setAttribute('aria-label', 'Submit your plane photos');
        toastEl.innerHTML = `
            <button type="button" class="ach-toast-x" aria-label="Dismiss">&times;</button>
            <div class="ach-toast-inner">
                <div class="ach-toast-icon"><i class="fa-solid fa-camera-retro"></i></div>
                <div class="ach-toast-body">
                    <strong>${pick.h}</strong>
                    <p>${pick.p}</p>
                    <div class="ach-toast-actions">
                        <button type="button" class="ach-toast-cta">Submit a photo</button>
                        <button type="button" class="ach-toast-later">Not now</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(toastEl);
        toastEl.querySelector('.ach-toast-x').addEventListener('click', dismissInvite);
        toastEl.querySelector('.ach-toast-later').addEventListener('click', dismissInvite);
        toastEl.querySelector('.ach-toast-cta').addEventListener('click', () => { dismissInvite(); open('submit'); });
        requestAnimationFrame(() => toastEl.classList.add('visible'));
        toastTimer = setTimeout(dismissInvite, 18000);
    }

    function maybeScheduleInvite() {
        if (window !== window.parent) return;
        if (inviteSeen()) return;
        if (savedName()) { markInviteSeen(); return; }
        if (!document.getElementById('toolbar-submit-photo-btn')) return;
        const override = Number(window.INFLIGHT_INVITE_DELAY_MS);
        const delay = Number.isFinite(override) ? override : 18000 + Math.random() * 32000;
        setTimeout(() => {
            if (inviteSeen()) return;
            if (overlayEl && overlayEl.classList.contains('visible')) return;
            showInvite();
        }, delay);
    }

    // ---------------------------------------------------------------------
    // Wiring
    // ---------------------------------------------------------------------
    function wireToolbar() {
        const gal = document.getElementById('toolbar-gallery-btn');
        if (gal && !gal.dataset.achWired) { gal.dataset.achWired = '1'; gal.addEventListener('click', () => open('gallery')); }
        const sub = document.getElementById('toolbar-submit-photo-btn');
        if (sub && !sub.dataset.achWired) { sub.dataset.achWired = '1'; sub.addEventListener('click', () => open('submit')); }
    }

    if (typeof document !== 'undefined') {
        const init = () => { wireToolbar(); maybeScheduleInvite(); };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
        else init();
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlayEl && overlayEl.classList.contains('visible')) close();
        });
    }

    window.InflightCommunity = { open, close, invite: () => showInvite({ force: true }), dismissInvite };
    // Back-compat with the earlier split modules.
    window.InflightAircraftSubmit = { open: () => open('submit'), close, invite: () => showInvite({ force: true }), dismissInvite };
    window.InflightAircraftGallery = { open: () => open('gallery'), close };
})();
