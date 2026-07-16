/**
 * communityGallery.js
 *
 * Community aircraft-photo gallery, presented as a self-contained modal so it
 * can be launched from anywhere in the tracker (toolbar button, or the "Browse
 * the community gallery" link inside the submission modal) without navigating
 * away. Also powers the standalone submit-aircraft.html / gallery entry points.
 *
 * It lists every available community plane image from the same backend the
 * tracker already reads (/api/aircraft), lets the user set their contributor
 * name, and — when that name matches uploads in the gallery — highlights and
 * can filter to just "their work". The name is shared with the submission
 * modal via localStorage, so setting it here also credits future submissions.
 *
 * Public API:
 *   window.InflightAircraftGallery.open()   -> show the modal
 *   window.InflightAircraftGallery.close()  -> hide the modal
 */
(function () {
    'use strict';

    const BACKEND = 'https://site--indgo-backend--6dmjph8ltlhv.code.run';
    const ENDPOINT = BACKEND + '/api/aircraft';
    const FALLBACK_IMG = '/CommunityPlanes/default.png';

    // Shared with submitAircraft.js so a name set in either place sticks.
    const NAME_KEY = 'inflight_contributor_name';
    const savedName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch (_) { return ''; } };
    const saveName = (n) => { try { n ? localStorage.setItem(NAME_KEY, n) : localStorage.removeItem(NAME_KEY); } catch (_) {} };

    const norm = (s) => String(s || '').trim().toLowerCase();

    let overlayEl = null, gridEl = null, searchEl = null, nameEl = null,
        mineToggleEl = null, statsEl = null;
    let photos = [];          // flattened list of every image
    let loaded = false;       // data fetched at least once
    let loading = false;
    let mineOnly = false;     // "show only my uploads" filter state

    // ---------------------------------------------------------------------
    // Styles
    // ---------------------------------------------------------------------
    let stylesInjected = false;
    function injectStyles() {
        if (stylesInjected || typeof document === 'undefined') return;
        stylesInjected = true;
        const style = document.createElement('style');
        style.id = 'inflight-acgal-styles';
        style.textContent = `
        :root {
            --acc-a: #f59e0b;
            --acc-b: #f97316;
            --acc-soft: rgba(245, 158, 11, 0.08);
        }
        .acgal-overlay {
            position: fixed; inset: 0; z-index: 20000;
            display: flex; align-items: center; justify-content: center;
            padding: max(env(safe-area-inset-top, 0px), 16px) 16px
                     max(env(safe-area-inset-bottom, 0px), 16px);
            background: rgba(6, 8, 20, 0.62);
            backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
            opacity: 0; visibility: hidden;
            transition: opacity .22s ease, visibility .22s ease;
        }
        .acgal-overlay.visible { opacity: 1; visibility: visible; }

        .acgal-card {
            width: 100%; max-width: 880px; height: calc(100vh - 32px);
            max-height: 760px; display: flex; flex-direction: column;
            background: rgba(18, 20, 38, 0.94);
            border: 1px solid rgba(255,255,255,0.10);
            border-radius: 18px; box-shadow: 0 24px 60px rgba(0,0,0,0.55);
            color: #e6e9ff; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
            transform: translateY(14px) scale(.98); transition: transform .22s ease;
            overflow: hidden;
        }
        .acgal-overlay.visible .acgal-card { transform: translateY(0) scale(1); }

        .acgal-head {
            display: flex; align-items: flex-start; gap: 12px;
            padding: 18px 22px 14px; border-bottom: 1px solid rgba(255,255,255,0.07);
        }
        .acgal-head-icon {
            flex: 0 0 auto; width: 40px; height: 40px; border-radius: 12px;
            display: grid; place-items: center; font-size: 1.05rem; color: #fff;
            background: linear-gradient(135deg, var(--acc-a), var(--acc-b));
        }
        .acgal-head-text { flex: 1 1 auto; min-width: 0; }
        .acgal-head-text h3 { margin: 0; font-size: 1.12rem; font-weight: 700; letter-spacing: -.01em; }
        .acgal-head-text p { margin: 3px 0 0; font-size: .82rem; color: #9aa2c9; }
        .acgal-close {
            flex: 0 0 auto; width: 32px; height: 32px; border-radius: 50%;
            border: 1px solid rgba(255,255,255,0.10); background: rgba(255,255,255,0.05);
            color: #c5cae9; font-size: 1rem; cursor: pointer; line-height: 1;
            display: grid; place-items: center; transition: background .15s ease, color .15s ease;
        }
        .acgal-close:hover { background: rgba(255,255,255,0.14); color: #fff; }

        /* Controls */
        .acgal-controls {
            display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
            padding: 14px 22px; border-bottom: 1px solid rgba(255,255,255,0.07);
        }
        .acgal-input {
            box-sizing: border-box; background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.12); border-radius: 10px;
            color: #fff; padding: 9px 12px; font-size: .9rem;
            transition: border-color .15s ease, background .15s ease;
        }
        .acgal-input::placeholder { color: #6b73a0; }
        .acgal-input:focus { outline: none; border-color: var(--acc-a); background: var(--acc-soft); }
        .acgal-search { flex: 1 1 200px; min-width: 140px; }
        .acgal-name { flex: 1 1 200px; min-width: 140px; }
        .acgal-mine {
            flex: 0 0 auto; display: inline-flex; align-items: center; gap: 7px;
            padding: 9px 14px; border-radius: 10px; cursor: pointer;
            font-size: .85rem; font-weight: 600; color: #c5cae9;
            border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04);
            transition: all .15s ease; user-select: none; white-space: nowrap;
        }
        .acgal-mine[hidden] { display: none; }
        .acgal-mine.active {
            color: #fff; border-color: transparent;
            background: linear-gradient(135deg, var(--acc-a), var(--acc-b));
        }
        .acgal-mine .cnt { opacity: .8; font-weight: 700; }

        .acgal-stats { padding: 8px 22px 0; font-size: .78rem; color: #9aa2c9; }

        /* Grid */
        .acgal-grid {
            flex: 1 1 auto; overflow-y: auto; padding: 14px 22px 22px;
            display: grid; gap: 12px;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            align-content: start;
        }
        .acgal-tile {
            position: relative; border-radius: 14px; overflow: hidden;
            border: 1px solid rgba(255,255,255,0.10); background: #0c0e1f;
            aspect-ratio: 16 / 11; display: flex; flex-direction: column;
        }
        .acgal-tile.mine { border-color: var(--acc-a); box-shadow: 0 0 0 1px var(--acc-a); }
        .acgal-tile-imgwrap { position: relative; flex: 1 1 auto; overflow: hidden; background: #05060f; }
        .acgal-tile img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .3s ease; }
        .acgal-tile:hover img { transform: scale(1.05); }
        .acgal-you {
            position: absolute; top: 8px; left: 8px; z-index: 2;
            font-size: .66rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase;
            color: #1a1200; padding: 3px 8px; border-radius: 999px;
            background: linear-gradient(135deg, var(--acc-a), var(--acc-b));
        }
        .acgal-meta {
            padding: 8px 10px; background: rgba(10, 12, 26, 0.9);
            border-top: 1px solid rgba(255,255,255,0.06);
        }
        .acgal-meta .t { font-size: .84rem; font-weight: 700; color: #fff; line-height: 1.2;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .acgal-meta .l { font-size: .74rem; color: #9aa2c9; margin-top: 2px;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .acgal-meta .c { font-size: .68rem; color: #6b73a0; margin-top: 4px;
            display: flex; align-items: center; gap: 4px; }
        .acgal-meta .c i { color: var(--acc-a); }

        .acgal-empty, .acgal-loading, .acgal-error {
            grid-column: 1 / -1; text-align: center; padding: 48px 16px; color: #9aa2c9;
        }
        .acgal-error { color: #ff6b81; }
        .acgal-spinner {
            width: 30px; height: 30px; margin: 0 auto 14px; border-radius: 50%;
            border: 3px solid rgba(255,255,255,0.15); border-top-color: var(--acc-a);
            animation: acgal-spin .8s linear infinite;
        }
        @keyframes acgal-spin { to { transform: rotate(360deg); } }
        .acgal-skel {
            border-radius: 14px; aspect-ratio: 16 / 11;
            background: linear-gradient(100deg, rgba(255,255,255,0.03) 30%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 70%);
            background-size: 200% 100%; animation: acgal-shimmer 1.2s ease-in-out infinite;
        }
        @keyframes acgal-shimmer { to { background-position: -200% 0; } }

        /* Footer */
        .acgal-foot {
            padding: 12px 22px; border-top: 1px solid rgba(255,255,255,0.07);
            display: flex; justify-content: space-between; align-items: center; gap: 12px;
        }
        .acgal-foot .hint { font-size: .78rem; color: #6b73a0; }
        .acgal-submit {
            border: none; cursor: pointer; color: #fff; white-space: nowrap;
            padding: 10px 18px; border-radius: 11px; font-size: .9rem; font-weight: 700;
            background: linear-gradient(135deg, var(--acc-a), var(--acc-b));
            transition: filter .15s ease; display: inline-flex; align-items: center; gap: 7px;
        }
        .acgal-submit:hover { filter: brightness(1.08); }

        @media (max-width: 520px) {
            .acgal-head, .acgal-controls, .acgal-grid, .acgal-foot, .acgal-stats { padding-left: 16px; padding-right: 16px; }
            .acgal-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
            .acgal-foot .hint { display: none; }
        }`;
        document.head.appendChild(style);
    }

    // ---------------------------------------------------------------------
    // Markup
    // ---------------------------------------------------------------------
    function buildModal() {
        if (overlayEl) return;
        injectStyles();

        overlayEl = document.createElement('div');
        overlayEl.className = 'acgal-overlay';
        overlayEl.setAttribute('role', 'dialog');
        overlayEl.setAttribute('aria-modal', 'true');
        overlayEl.setAttribute('aria-label', 'Community aircraft gallery');
        overlayEl.innerHTML = `
        <div class="acgal-card">
            <div class="acgal-head">
                <div class="acgal-head-icon"><i class="fa-solid fa-images"></i></div>
                <div class="acgal-head-text">
                    <h3>Community aircraft gallery</h3>
                    <p>Every livery the community has contributed so far.</p>
                </div>
                <button type="button" class="acgal-close" aria-label="Close">&times;</button>
            </div>

            <div class="acgal-controls">
                <input class="acgal-input acgal-search" type="search" placeholder="Search type or livery…" aria-label="Search">
                <input class="acgal-input acgal-name" type="text" placeholder="Your contributor name" aria-label="Your contributor name">
                <button type="button" class="acgal-mine" hidden>
                    <i class="fa-solid fa-user-check"></i> My uploads <span class="cnt"></span>
                </button>
            </div>

            <div class="acgal-stats"></div>

            <div class="acgal-grid" aria-live="polite"></div>

            <div class="acgal-foot">
                <span class="hint">Missing a livery? Add yours — staff review every submission.</span>
                <button type="button" class="acgal-submit">
                    <i class="fa-solid fa-camera"></i> Submit a photo
                </button>
            </div>
        </div>`;

        document.body.appendChild(overlayEl);

        gridEl = overlayEl.querySelector('.acgal-grid');
        searchEl = overlayEl.querySelector('.acgal-search');
        nameEl = overlayEl.querySelector('.acgal-name');
        mineToggleEl = overlayEl.querySelector('.acgal-mine');
        statsEl = overlayEl.querySelector('.acgal-stats');

        overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) close(); });
        overlayEl.querySelector('.acgal-close').addEventListener('click', close);
        searchEl.addEventListener('input', render);

        // Contributor name: persist + re-evaluate "mine" highlighting.
        nameEl.value = savedName();
        nameEl.addEventListener('input', () => {
            saveName(nameEl.value.trim());
            if (!nameEl.value.trim()) mineOnly = false;
            render();
        });

        mineToggleEl.addEventListener('click', () => {
            if (!nameEl.value.trim()) { nameEl.focus(); return; }
            mineOnly = !mineOnly;
            render();
        });

        overlayEl.querySelector('.acgal-submit').addEventListener('click', () => {
            if (window.InflightAircraftSubmit && window.InflightAircraftSubmit.open) {
                close();
                window.InflightAircraftSubmit.open();
            } else {
                window.location.href = 'submit-aircraft.html';
            }
        });
    }

    // ---------------------------------------------------------------------
    // Data
    // ---------------------------------------------------------------------
    async function load(force) {
        if (loading || (loaded && !force)) return;
        loading = true;
        renderLoading();
        try {
            const res = await fetch(ENDPOINT);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            photos = flatten(Array.isArray(data) ? data : []);
            loaded = true;
            render();
        } catch (err) {
            renderError();
        } finally {
            loading = false;
        }
    }

    // Turn backend fleet entries into one card per image. An entry may carry a
    // single imageUrl or an imageUrls[] with a parallel imageContributors[].
    function flatten(entries) {
        const out = [];
        entries.forEach((e) => {
            const urls = (Array.isArray(e.imageUrls) && e.imageUrls.length)
                ? e.imageUrls.filter(Boolean)
                : (e.imageUrl ? [e.imageUrl] : []);
            if (!urls.length) return;
            const contributors = Array.isArray(e.imageContributors) ? e.imageContributors : [];
            urls.forEach((url, i) => {
                const contributor = (contributors[i] && contributors[i].name)
                    || e.contributorName || 'IF Community';
                out.push({
                    type: e.aircraftType || 'Unknown type',
                    livery: e.liveryName || 'Unknown livery',
                    tail: e.tailNumber || '',
                    url,
                    contributor
                });
            });
        });
        return out;
    }

    // ---------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------
    function renderLoading() {
        if (!gridEl) return;
        gridEl.innerHTML = Array(8).fill('<div class="acgal-skel"></div>').join('');
        if (statsEl) statsEl.textContent = '';
    }

    function renderError() {
        if (!gridEl) return;
        gridEl.innerHTML = `<div class="acgal-error">
            <div class="acgal-spinner" style="border-top-color:#ff6b81"></div>
            Couldn't load the gallery. Please try again in a moment.
        </div>`;
    }

    function render() {
        if (!gridEl) return;

        const me = norm(nameEl && nameEl.value);
        const mineCount = me ? photos.filter(p => norm(p.contributor) === me).length : 0;

        // "My uploads" toggle only makes sense once a name is set.
        if (mineToggleEl) {
            mineToggleEl.hidden = !me;
            mineToggleEl.classList.toggle('active', mineOnly && !!me);
            mineToggleEl.querySelector('.cnt').textContent = me ? `(${mineCount})` : '';
        }

        const term = norm(searchEl && searchEl.value);
        let list = photos;
        if (mineOnly && me) list = list.filter(p => norm(p.contributor) === me);
        if (term) list = list.filter(p =>
            norm(p.type).includes(term) || norm(p.livery).includes(term) || norm(p.contributor).includes(term));

        if (statsEl) {
            let s = `${list.length} image${list.length === 1 ? '' : 's'}`;
            if (me && mineCount && !mineOnly) s += ` · ${mineCount} of them yours`;
            statsEl.textContent = s;
        }

        if (!list.length) {
            gridEl.innerHTML = `<div class="acgal-empty">${
                mineOnly ? 'No uploads found under that contributor name yet.'
                         : 'No images match your search.'
            }</div>`;
            return;
        }

        gridEl.innerHTML = list.map((p) => {
            const isMine = me && norm(p.contributor) === me;
            return `
            <div class="acgal-tile${isMine ? ' mine' : ''}">
                <div class="acgal-tile-imgwrap">
                    ${isMine ? '<span class="acgal-you">You</span>' : ''}
                    <img loading="lazy" alt="${esc(p.type)} — ${esc(p.livery)}"
                         src="${esc(p.url)}"
                         onerror="this.onerror=null;this.src='${FALLBACK_IMG}'">
                </div>
                <div class="acgal-meta">
                    <div class="t">${esc(p.type)}</div>
                    <div class="l">${esc(p.livery)}${p.tail ? ' · ' + esc(p.tail) : ''}</div>
                    <div class="c"><i class="fa-solid fa-user"></i>${esc(p.contributor)}</div>
                </div>
            </div>`;
        }).join('');
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // ---------------------------------------------------------------------
    // Open / close
    // ---------------------------------------------------------------------
    function open() {
        buildModal();
        // Pick up a name set elsewhere (e.g. the submission modal) since we opened.
        if (nameEl && !nameEl.value) nameEl.value = savedName();
        requestAnimationFrame(() => overlayEl.classList.add('visible'));
        load();
    }

    function close() {
        if (overlayEl) overlayEl.classList.remove('visible');
    }

    // ---------------------------------------------------------------------
    // Toolbar launcher + wiring
    // ---------------------------------------------------------------------
    function wireToolbarButton() {
        const btn = document.getElementById('toolbar-gallery-btn');
        if (btn && !btn.dataset.acgalWired) {
            btn.dataset.acgalWired = 'true';
            btn.addEventListener('click', open);
        }
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', wireToolbarButton);
        } else {
            wireToolbarButton();
        }
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlayEl && overlayEl.classList.contains('visible')) close();
        });
    }

    window.InflightAircraftGallery = { open, close };
})();
