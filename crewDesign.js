/* ============================================================================
   crewDesign.js — the airline's own look, in its own crew centre.

   WHAT IT DOES

     • APPLIES what the airline has set (arrives with the branding record):
         the custom CSS from its theme file, scoped to html[data-crew-css];
         a faint page backdrop; its hero picture in place of the banner;
         a cover picture on each section tile.
     • SHOWS its artwork: a rotating showcase on the dashboard and the pilot
       home — liveries, posters, wallpapers — with a full-screen gallery and
       the artist's name on every picture.
     • EDITS all of it (staff with settings.branding): the Design studio.
         Artwork     upload (or link) pictures, name, credit, feature, order
         Placement   hero, backdrop, showcase, and a cover per section
         Theme       colours for light and dark, fonts, radius, gradient,
                     custom CSS; download the theme file, upload one back
         Interface   essential, aurora or airline — for the whole crew

   The colours and fonts themselves are CrewBrand's job (crewBrand.js reads
   `theme` off the same record); this file adds what CrewBrand never had —
   pictures, and the designer's own CSS — and the screen to edit both.

   THE CSS IS CLEANED ON THE SERVER, not here: the backend's crewDesign.js
   tokenizes it, drops anything that is not a style and scopes every rule.
   What arrives here is written with textContent into one <style>, which can
   not be closed from inside.

   Loaded as a classic script. Requires crewPanels.js for the studio; the
   apply/showcase half works without it.
   ========================================================================== */

(function (global) {
    'use strict';

    const P = global.CrewPanels || null;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const https = (u) => /^https:\/\/[^\s"'<>()\\]+$/i.test(String(u || ''));
    const icons = () => { try { if (global.lucide) global.lucide.createIcons(); } catch (_) {} };

    const STATE = { branding: null, timers: new Map(), lightbox: null };

    // Every section a cover can go on, in the words the tiles use. Unknown
    // keys still work (the server accepts any short word); this is the list
    // the studio offers.
    const SECTIONS = [
        ['roster', 'Roster'], ['routes', 'Routes'], ['fleet', 'Fleet'], ['schedule', 'Schedules / Book a flight'],
        ['events', 'Events'], ['pireps', 'Flights'], ['file', 'File a PIREP'], ['logbook', 'My logbook'],
        ['goals', 'Tours & challenges'], ['codeshare', 'Codeshares'], ['network', 'Route network'],
        ['awards', 'Awards'], ['training', 'Training'], ['standings', 'Standings'], ['shop', 'Shop'],
        ['documents', 'Documents'], ['notices', 'Announcements'], ['inbox', 'Messages'], ['links', 'Quick links'],
        ['insights', 'Statistics'], ['ifLive', 'Infinite Flight'], ['suggest', 'What to fly'],
        ['staffjobs', 'Join the team'], ['quizzes', 'Quizzes'], ['recruit', 'Recruitment'],
        ['leave', 'Crew health / Going away'], ['website', 'Website'], ['embeds', 'Embeds'],
        ['partnership', 'Partnership'], ['design', 'Design studio'], ['settings', 'Settings'],
    ];
    const KINDS = { livery: 'Livery', poster: 'Poster', wallpaper: 'Wallpaper', banner: 'Banner', photo: 'Photo', logo: 'Logo', other: 'Artwork' };

    /* =====================================================================
     * STYLES — shared by the showcase, the covers, the lightbox and studio.
     * =================================================================== */
    function styles() {
        if (document.getElementById('crew-design-styles')) return;
        const s = document.createElement('style');
        s.id = 'crew-design-styles';
        s.textContent = `
        #crewBackdrop{ position:fixed; inset:0; z-index:-1; pointer-events:none; background-size:cover; background-position:center; }
        .tile.has-cover{ overflow:hidden; position:relative; }
        .tile .tile-cover{ display:block; margin:-1.25rem -1.25rem .15rem; height:5.5rem; overflow:hidden; background:var(--surface-2, #eee); }
        .tile .tile-cover img{ width:100%; height:100%; object-fit:cover; display:block; transition:transform .5s; }
        .tile.has-cover:hover .tile-cover img{ transform:scale(1.04); }
        .r-tools.is-rail .tile-cover{ display:none; }
        .r-tools.is-side .tile-cover{ margin:-.8rem -.8rem .1rem; height:4.2rem; }

        .sc{ position:relative; border-radius:var(--radius, 1rem); overflow:hidden; background:#0b0b0c; color:#fff; isolation:isolate; }
        .sc-stage{ position:relative; aspect-ratio:16/6; max-height:360px; width:100%; }
        .crew-col .sc-stage{ max-height:320px; }
        .sc-slide{ position:absolute; inset:0; opacity:0; transition:opacity .7s ease; }
        .sc-slide.on{ opacity:1; }
        .sc-slide img{ width:100%; height:100%; object-fit:cover; display:block; }
        .sc-slide .sc-blur{ position:absolute; inset:-20px; background-size:cover; background-position:center; filter:blur(24px) brightness(.55); transform:scale(1.1); }
        .sc-slide.contain img{ object-fit:contain; position:relative; }
        .sc-cap{ position:absolute; z-index:2; left:0; right:0; bottom:0; padding:1.1rem 1.2rem 1rem;
            background:linear-gradient(to top, rgb(0 0 0 / .72), rgb(0 0 0 / 0)); display:flex; align-items:flex-end; gap:1rem; }
        .sc-cap .sc-t{ font-weight:800; letter-spacing:-.02em; font-size:1.05rem; line-height:1.2; }
        .sc-cap .sc-c{ font-size:.75rem; opacity:.85; margin-top:.2rem; }
        .sc-cap .sc-c a{ color:inherit; text-decoration:underline; }
        .sc-kind{ font-size:.62rem; font-weight:800; letter-spacing:.14em; text-transform:uppercase; padding:.2rem .5rem;
            border-radius:999px; background:rgb(255 255 255 / .18); backdrop-filter:blur(6px); }
        .sc-head{ position:absolute; top:.8rem; left:1rem; right:1rem; display:flex; justify-content:space-between; align-items:center; z-index:2; }
        .sc-label{ font-size:.66rem; font-weight:800; letter-spacing:.16em; text-transform:uppercase; opacity:.85; }
        .sc-nav{ display:flex; gap:.35rem; }
        .sc-btn{ width:2.1rem; height:2.1rem; border-radius:999px; border:0; background:rgb(255 255 255 / .16); color:#fff;
            display:grid; place-items:center; cursor:pointer; backdrop-filter:blur(6px); font-size:1rem; }
        .sc-btn:hover{ background:rgb(255 255 255 / .3); }
        .sc-dots{ display:flex; gap:.3rem; margin-left:auto; }
        .sc-dot{ width:.45rem; height:.45rem; border-radius:999px; background:rgb(255 255 255 / .4); border:0; padding:0; cursor:pointer; }
        .sc-dot.on{ background:#fff; width:1.2rem; }
        .sc-open{ position:absolute; inset:0; z-index:1; cursor:zoom-in; background:transparent; border:0; }

        .lb{ position:fixed; inset:0; z-index:130; background:rgb(6 6 8 / .94); display:flex; flex-direction:column; color:#fff; }
        .lb-top{ display:flex; justify-content:space-between; align-items:center; padding:.9rem 1rem; gap:1rem; }
        .lb-main{ flex:1; min-height:0; display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:.5rem; padding:0 .5rem; }
        .lb-main img{ max-width:100%; max-height:100%; object-fit:contain; margin:auto; display:block; border-radius:.5rem; }
        .lb-strip{ display:flex; gap:.4rem; overflow-x:auto; padding:.8rem 1rem 1rem; }
        .lb-strip button{ flex:none; width:5.5rem; height:3.4rem; border-radius:.4rem; overflow:hidden; border:2px solid transparent; padding:0; cursor:pointer; opacity:.6; background:#222; }
        .lb-strip button.on{ border-color:#fff; opacity:1; }
        .lb-strip img{ width:100%; height:100%; object-fit:cover; }

        .ds-grid{ display:grid; gap:.7rem; grid-template-columns:repeat(auto-fill, minmax(13rem, 1fr)); }
        .ds-art{ border:1px solid var(--line,#e5e5e5); border-radius:.8rem; overflow:hidden; background:var(--surface,#fff); display:flex; flex-direction:column; }
        .ds-art .ds-img{ aspect-ratio:16/10; background:#111; position:relative; }
        .ds-art .ds-img img{ width:100%; height:100%; object-fit:cover; }
        .ds-art .ds-body{ padding:.55rem; display:grid; gap:.35rem; }
        .ds-art .ds-row{ display:flex; gap:.3rem; flex-wrap:wrap; }
        .ds-badge{ position:absolute; top:.4rem; left:.4rem; font-size:.6rem; font-weight:800; letter-spacing:.1em; text-transform:uppercase;
            background:rgb(0 0 0 / .6); color:#fff; padding:.15rem .4rem; border-radius:.3rem; }
        .ds-drop{ border:2px dashed var(--line,#ddd); border-radius:.9rem; padding:1.3rem; text-align:center; cursor:pointer; }
        .ds-drop.over{ border-color:var(--accent,#1C1A16); background:color-mix(in srgb, var(--accent,#1C1A16) 6%, transparent); }
        .ds-pick{ display:grid; gap:.4rem; grid-template-columns:repeat(auto-fill, minmax(6.5rem,1fr)); }
        .ds-pick button{ aspect-ratio:16/10; border-radius:.5rem; overflow:hidden; border:2px solid transparent; padding:0; cursor:pointer; background:var(--surface-2,#eee); position:relative; }
        .ds-pick button.on{ border-color:var(--accent,#1C1A16); box-shadow:0 0 0 2px var(--accent,#1C1A16); }
        .ds-pick button img{ width:100%; height:100%; object-fit:cover; }
        .ds-pick .ds-none{ font-size:.72rem; font-weight:700; color:var(--muted,#736E64); }
        .ds-sec{ display:grid; grid-template-columns:9rem 1fr; gap:.6rem; align-items:center; padding:.45rem 0; border-top:1px solid var(--line,#eee); }
        .ds-sec select{ max-width:100%; }
        .ds-sec .ds-thumb{ width:100%; aspect-ratio:16/6; border-radius:.4rem; object-fit:cover; background:var(--surface-2,#eee); }
        .ds-swatches{ display:grid; gap:.5rem; grid-template-columns:repeat(auto-fill, minmax(9.5rem, 1fr)); }
        .ds-sw{ display:flex; align-items:center; gap:.45rem; font-size:.78rem; }
        .ds-sw input[type=color]{ width:2rem; height:2rem; border:1px solid var(--line,#ddd); border-radius:.4rem; padding:0; background:none; cursor:pointer; }
        .ds-sw input[type=text]{ width:5.4rem; }
        .ds-css{ font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:.78rem; min-height:14rem; white-space:pre; }
        .ds-ui{ display:grid; gap:.7rem; grid-template-columns:repeat(auto-fill, minmax(14rem, 1fr)); }
        .ds-ui button{ text-align:left; border:1px solid var(--line,#e5e5e5); border-radius:.9rem; padding:.9rem; background:var(--surface,#fff); cursor:pointer; color:inherit; font:inherit; }
        .ds-ui button[aria-pressed="true"]{ border-color:var(--accent,#1C1A16); box-shadow:0 0 0 2px var(--accent,#1C1A16); }
        .ds-ui .ds-mini{ height:5.5rem; border-radius:.55rem; margin-bottom:.6rem; overflow:hidden; position:relative; }
        `;
        document.head.appendChild(s);
    }

    /* =====================================================================
     * APPLY
     * =================================================================== */

    /** The record with the airline's hero picture in the banner's place. */
    function effective(b) {
        if (!b || typeof b !== 'object') return b;
        const art = b.art || {};
        return https(art.hero) ? { ...b, banner: art.hero } : b;
    }

    function apply(b) {
        styles();
        STATE.branding = b || null;
        const root = document.documentElement;
        const theme = (b && b.theme) || null;
        // The designer's CSS: one <style>, text only, replaced wholesale.
        let css = document.getElementById('crew-design-css');
        const text = theme && typeof theme.css === 'string' ? theme.css : '';
        if (text) {
            if (!css) { css = document.createElement('style'); css.id = 'crew-design-css'; document.head.appendChild(css); }
            css.textContent = text;
            root.setAttribute('data-crew-css', '');
        } else {
            if (css) css.remove();
            root.removeAttribute('data-crew-css');
        }
        // The backdrop — behind everything, faint, and only if there is one.
        const art = (b && b.art) || {};
        let bd = document.getElementById('crewBackdrop');
        if (https(art.backdrop)) {
            if (!bd) { bd = document.createElement('div'); bd.id = 'crewBackdrop'; bd.setAttribute('aria-hidden', 'true'); document.body.prepend(bd); }
            bd.style.backgroundImage = `url("${art.backdrop}")`;
            bd.style.opacity = String(Number.isFinite(+art.backdropOpacity) ? +art.backdropOpacity : 0.12);
        } else if (bd) bd.remove();
        root.setAttribute('data-crew-art', (b && Array.isArray(b.artwork) && b.artwork.length) ? 'on' : 'off');
        paintTiles();
    }

    /** A cover on every tile the airline gave one. Safe to call repeatedly. */
    function paintTiles(scope) {
        const sections = (STATE.branding && STATE.branding.art && STATE.branding.art.sections) || {};
        (scope || document).querySelectorAll('.tile[data-action]').forEach((tile) => {
            const url = sections[tile.getAttribute('data-action')];
            let cover = tile.querySelector(':scope > .tile-cover');
            if (!https(url)) { if (cover) cover.remove(); tile.classList.remove('has-cover'); return; }
            if (!cover) { cover = document.createElement('span'); cover.className = 'tile-cover'; tile.prepend(cover); }
            if (!cover.firstChild || cover.firstChild.getAttribute('src') !== url) cover.innerHTML = `<img src="${esc(url)}" alt="" loading="lazy">`;
            tile.classList.add('has-cover');
        });
    }

    /* =====================================================================
     * SHOWCASE
     * =================================================================== */

    const featured = (b) => ((b && b.artwork) || []).filter((a) => a && a.featured !== false && https(a.url));

    function creditHtml(a) {
        if (!a.credit) return '';
        return a.creditUrl && https(a.creditUrl)
            ? `By <a href="${esc(a.creditUrl)}" target="_blank" rel="noopener">${esc(a.credit)}</a>`
            : `By ${esc(a.credit)}`;
    }

    function showcase(host, b) {
        if (!host) return;
        styles();
        b = b || STATE.branding;
        const art = (b && b.art) || {};
        const show = art.showcase || {};
        const list = featured(b);
        clearInterval(STATE.timers.get(host));
        if (show.enabled === false || !list.length) {
            host.innerHTML = '';
            host.classList.add('hidden', 'cp-hidden');
            return;
        }
        host.classList.remove('hidden', 'cp-hidden');
        let i = 0;
        const label = show.title || `${(b && b.name) || 'Our'} gallery`;
        host.innerHTML = `<div class="sc" role="region" aria-roledescription="carousel" aria-label="${esc(label)}">
            <div class="sc-stage">${list.map((a, n) => {
                // A portrait poster or a logo is shown whole on a blurred copy
                // of itself; a landscape wallpaper fills the frame.
                const tall = a.width && a.height && a.width / a.height < 1.5;
                return `<div class="sc-slide ${n === 0 ? 'on' : ''} ${tall ? 'contain' : ''}" aria-hidden="${n !== 0}">
                    ${tall ? `<div class="sc-blur" style="background-image:url('${esc(a.url)}')"></div>` : ''}
                    <img src="${esc(a.url)}" alt="${esc(a.title || KINDS[a.kind] || 'Artwork')}" loading="${n === 0 ? 'eager' : 'lazy'}"></div>`;
            }).join('')}
                <button type="button" class="sc-open" aria-label="Open the gallery"></button>
            </div>
            <div class="sc-head"><span class="sc-label">${esc(label)}</span>
                ${list.length > 1 ? `<span class="sc-nav"><button type="button" class="sc-btn" data-sc="-1" aria-label="Previous">‹</button><button type="button" class="sc-btn" data-sc="1" aria-label="Next">›</button></span>` : ''}</div>
            <div class="sc-cap"><div style="min-width:0"><div class="sc-t"></div><div class="sc-c"></div></div>
                ${list.length > 1 ? `<div class="sc-dots">${list.map((_, n) => `<button type="button" class="sc-dot ${n === 0 ? 'on' : ''}" data-sc-go="${n}" aria-label="Picture ${n + 1}"></button>`).join('')}</div>` : ''}</div>
        </div>`;
        const slides = host.querySelectorAll('.sc-slide');
        const dots = host.querySelectorAll('.sc-dot');
        const caption = () => {
            const a = list[i];
            host.querySelector('.sc-t').innerHTML = `${a.kind && a.kind !== 'other' ? `<span class="sc-kind">${esc(KINDS[a.kind] || a.kind)}</span> ` : ''}${esc(a.title || '')}`;
            host.querySelector('.sc-c').innerHTML = creditHtml(a);
        };
        const go = (n) => {
            i = (n + list.length) % list.length;
            slides.forEach((s, k) => { s.classList.toggle('on', k === i); s.setAttribute('aria-hidden', String(k !== i)); });
            dots.forEach((d, k) => d.classList.toggle('on', k === i));
            caption();
        };
        caption();
        host.querySelector('.sc').addEventListener('click', (ev) => {
            const step = ev.target.closest('[data-sc]');
            if (step) { go(i + Number(step.getAttribute('data-sc'))); restart(); return; }
            const dot = ev.target.closest('[data-sc-go]');
            if (dot) { go(Number(dot.getAttribute('data-sc-go'))); restart(); return; }
            if (ev.target.closest('.sc-open')) lightbox(list, i);
        });
        const interval = Number.isFinite(+show.interval) ? +show.interval : 7;
        const reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
        function restart() {
            clearInterval(STATE.timers.get(host));
            if (list.length > 1 && interval > 0 && !reduce) STATE.timers.set(host, setInterval(() => { if (!document.hidden) go(i + 1); }, interval * 1000));
        }
        restart();
    }

    function lightbox(list, start) {
        styles();
        if (STATE.lightbox) STATE.lightbox.remove();
        let i = start || 0;
        const el = document.createElement('div');
        el.className = 'lb cp-dialog';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        el.innerHTML = `<div class="lb-top"><div><div class="lb-t" style="font-weight:800"></div><div class="lb-c" style="font-size:.8rem;opacity:.8"></div></div>
            <div style="display:flex;gap:.4rem"><a class="sc-btn lb-dl" target="_blank" rel="noopener" aria-label="Open full size" title="Open full size">⤢</a><button type="button" class="sc-btn" data-lb-close aria-label="Close">✕</button></div></div>
            <div class="lb-main"><button type="button" class="sc-btn" data-lb="-1" aria-label="Previous">‹</button><img alt=""><button type="button" class="sc-btn" data-lb="1" aria-label="Next">›</button></div>
            <div class="lb-strip">${list.map((a, n) => `<button type="button" data-lb-go="${n}" aria-label="${esc(a.title || `Picture ${n + 1}`)}"><img src="${esc(a.url)}" alt="" loading="lazy"></button>`).join('')}</div>`;
        const img = el.querySelector('.lb-main img');
        const show = (n) => {
            i = (n + list.length) % list.length;
            const a = list[i];
            img.src = a.url; img.alt = a.title || '';
            el.querySelector('.lb-t').textContent = [KINDS[a.kind] && a.kind !== 'other' ? KINDS[a.kind] : '', a.title].filter(Boolean).join(' · ');
            el.querySelector('.lb-c').innerHTML = creditHtml(a);
            el.querySelector('.lb-dl').href = a.url;
            el.querySelectorAll('[data-lb-go]').forEach((b, k) => b.classList.toggle('on', k === i));
        };
        const close = () => { el.remove(); STATE.lightbox = null; document.removeEventListener('keydown', key); if (P) P.unlockScroll(); };
        const key = (ev) => { if (ev.key === 'Escape') close(); if (ev.key === 'ArrowRight') show(i + 1); if (ev.key === 'ArrowLeft') show(i - 1); };
        el.addEventListener('click', (ev) => {
            if (ev.target.closest('[data-lb-close]') || ev.target === el.querySelector('.lb-main')) { close(); return; }
            const s = ev.target.closest('[data-lb]'); if (s) { show(i + Number(s.getAttribute('data-lb'))); return; }
            const g = ev.target.closest('[data-lb-go]'); if (g) show(Number(g.getAttribute('data-lb-go')));
        });
        document.addEventListener('keydown', key);
        document.body.appendChild(el);
        if (P) P.lockScroll();
        STATE.lightbox = el;
        show(i);
        const closeBtn = el.querySelector('[data-lb-close]'); if (closeBtn) closeBtn.focus();
    }

    /* =====================================================================
     * THE DESIGN STUDIO
     * =================================================================== */

    const D = { api: null, conn: null, panel: null, tab: 'artwork', data: null, error: null, onChange: null, dirtyTheme: null };

    const TOKENS = [
        ['accent', 'Accent'], ['bg', 'Page'], ['surface', 'Cards'], ['ink', 'Text'], ['muted', 'Secondary text'],
        ['line', 'Lines'], ['surface2', 'Raised'], ['lineSoft', 'Soft lines'], ['faint', 'Faint text'], ['accentInk', 'Text on accent'],
    ];

    async function raw(path, { method = 'GET', body = null, form = null } = {}) {
        const c = D.conn || {};
        const t = typeof c.token === 'function' ? c.token() : String(c.token || '');
        const res = await fetch(`${String(c.backend || '').replace(/\/+$/, '')}/api/crew/${encodeURIComponent(String(c.slug || '').toLowerCase())}${path}`, {
            method,
            headers: { ...(t ? { Authorization: 'Bearer ' + t } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: form || (body ? JSON.stringify(body) : undefined),
        });
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            const err = new Error(d.error || 'That didn’t work.'); err.status = res.status; throw err;
        }
        return res;
    }

    async function load() {
        D.error = null;
        try { D.data = await D.api('/design'); } catch (err) { D.error = err; }
        D.dirtyTheme = D.data ? JSON.parse(JSON.stringify(D.data.theme || {})) : null;
        draw();
    }

    /** Push what just saved into the live page, so the reader sees it at once. */
    function changed() {
        if (!D.data) return;
        const b = { ...(STATE.branding || {}), theme: D.data.theme, art: D.data.art, artwork: D.data.artwork, ui: D.data.ui };
        if (global.CrewBrand) global.CrewBrand.apply(b);
        apply(b);
        if (D.onChange) D.onChange(b);
    }

    function draw() {
        if (!D.panel) return;
        const body = D.panel.body;
        const render = () => {
            body.innerHTML = D.error
                ? (D.error.status === 404 ? P.notBuiltHtml('The design studio') : `<div class="cp-empty">${esc(D.error.message)}</div>`)
                : !D.data ? '<p class="cp-note" style="text-align:center;padding:2rem 0">Loading…</p>'
                    : `${tabsHtml()}${D.tab === 'artwork' ? artworkHtml() : D.tab === 'placement' ? placementHtml() : D.tab === 'theme' ? themeHtml() : uiHtml()}`;
            icons();
        };
        if (P && P.keepPlace) P.keepPlace(body, render, D.tab); else render();
    }

    function tabsHtml() {
        const t = (id, label) => `<button type="button" class="cs-tab gl-tab" data-ds-tab="${id}" aria-selected="${D.tab === id}" style="flex:1;border:0;padding:.5rem;border-radius:.5rem;font-weight:700;font-size:.84rem;cursor:pointer;${D.tab === id ? 'background:var(--accent,#1C1A16);color:#fff' : 'background:transparent;color:var(--muted,#736E64)'}">${label}</button>`;
        return `<div style="display:flex;gap:.25rem;padding:.25rem;border:1px solid var(--line,#e5e5e5);border-radius:.7rem">
            ${t('artwork', `Artwork${D.data.artwork.length ? ` · ${D.data.artwork.length}` : ''}`)}${t('placement', 'Placement')}${t('theme', 'Theme')}${t('ui', 'Interface')}</div>`;
    }

    function artworkHtml() {
        const list = D.data.artwork;
        const full = list.length >= (D.data.limits ? D.data.limits.artwork : 60);
        return `<div class="ds-drop" data-ds-drop tabindex="0" role="button" aria-label="Upload artwork">
                <div style="font-weight:800">Drop your liveries, posters and wallpapers here</div>
                <div class="cp-note" style="margin-top:.25rem">or click to pick files — JPG, PNG, WebP or GIF. Several at once is fine.</div>
                <input type="file" accept="image/*" multiple data-ds-file hidden>
            </div>
            <div style="display:flex;gap:.4rem"><input class="cp-input" data-ds-link placeholder="…or paste an https link to a picture hosted elsewhere"><button type="button" class="cp-btn" data-ds-link-add ${full ? 'disabled' : ''}>Add</button></div>
            <p class="cp-note">${list.length} of ${D.data.limits ? D.data.limits.artwork : 60}. Pictures marked <b>In showcase</b> rotate on the dashboard and every pilot’s home. The artist’s name goes on every one.</p>
            ${list.length ? `<div class="ds-grid">${list.map((a, n) => `<div class="ds-art" data-ds-id="${esc(a.id)}">
                <div class="ds-img"><img src="${esc(a.url)}" alt="" loading="lazy">${a.featured !== false ? '<span class="ds-badge">In showcase</span>' : ''}</div>
                <div class="ds-body">
                    <input class="cp-input" data-ds-f="title" maxlength="80" placeholder="Title" value="${esc(a.title)}">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.3rem">
                        <select class="cp-select" data-ds-f="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${a.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
                        <input class="cp-input" data-ds-f="credit" maxlength="80" placeholder="Artist" value="${esc(a.credit)}">
                    </div>
                    <input class="cp-input" data-ds-f="creditUrl" placeholder="Artist’s link (optional)" value="${esc(a.creditUrl)}">
                    <div class="ds-row">
                        <button type="button" class="cp-btn cp-btn-sm" data-ds-feature>${a.featured !== false ? 'Remove from showcase' : 'Add to showcase'}</button>
                        <button type="button" class="cp-btn cp-btn-sm" data-ds-hero title="Behind the dashboard card and the pilot hero">${D.data.art.hero === a.url ? '✓ Hero' : 'Use as hero'}</button>
                        <button type="button" class="cp-btn cp-btn-sm" data-ds-move="-1" ${n === 0 ? 'disabled' : ''} aria-label="Move earlier">←</button>
                        <button type="button" class="cp-btn cp-btn-sm" data-ds-move="1" ${n === list.length - 1 ? 'disabled' : ''} aria-label="Move later">→</button>
                        <button type="button" class="cp-btn cp-btn-sm cp-btn-bad" data-ds-del aria-label="Remove">✕</button>
                    </div>
                </div></div>`).join('')}</div>`
            : '<div class="cp-empty">No artwork yet. The first picture you upload becomes your showcase.</div>'}`;
    }

    function pickerHtml(field, current) {
        return `<div class="ds-pick" data-ds-pick="${esc(field)}">
            <button type="button" class="${!current ? 'on' : ''}" data-ds-val=""><span class="ds-none">None</span></button>
            ${D.data.artwork.map((a) => `<button type="button" class="${current === a.url ? 'on' : ''}" data-ds-val="${esc(a.url)}" title="${esc(a.title || '')}"><img src="${esc(a.url)}" alt="" loading="lazy"></button>`).join('')}
        </div>`;
    }

    function placementHtml() {
        const art = D.data.art;
        const sc = art.showcase || {};
        if (!D.data.artwork.length) return '<div class="cp-empty">Upload some artwork first — then choose where each picture goes.</div>';
        const options = (cur) => `<option value="">No cover</option>${D.data.artwork.map((a) => `<option value="${esc(a.url)}" ${cur === a.url ? 'selected' : ''}>${esc(a.title || KINDS[a.kind] || 'Picture')}</option>`).join('')}`;
        return `<div class="cp-card" style="display:grid;gap:.6rem"><div class="cp-card-title">Hero</div>
                <p class="cp-note">Behind the airline card on the dashboard and across the top of every pilot’s home. Replaces the directory banner on these pages only.</p>
                ${pickerHtml('hero', art.hero)}</div>
            <div class="cp-card" style="display:grid;gap:.6rem"><div class="cp-card-title">Page backdrop</div>
                <p class="cp-note">A faint picture behind the whole crew centre. Subtle is better — a pattern, a tail fin, a sky.</p>
                ${pickerHtml('backdrop', art.backdrop)}
                <label class="cp-label">Strength <input type="range" min="0.04" max="0.5" step="0.02" value="${esc(art.backdropOpacity)}" data-ds-art="backdropOpacity" style="width:100%"></label></div>
            <div class="cp-card" style="display:grid;gap:.6rem"><div class="cp-card-title">Showcase</div>
                <label style="display:flex;gap:.5rem;align-items:center;font-size:.85rem"><input type="checkbox" data-ds-art="showcase.enabled" ${sc.enabled !== false ? 'checked' : ''}> Show the rotating showcase on the dashboard and the pilot home</label>
                <div class="cp-grid2"><div><label class="cp-label">Heading</label><input class="cp-input" data-ds-art="showcase.title" maxlength="60" value="${esc(sc.title || '')}" placeholder="${esc(((STATE.branding && STATE.branding.name) || 'Our') + ' gallery')}"></div>
                <div><label class="cp-label">Seconds per picture (0 = hold)</label><input class="cp-input" type="number" min="0" max="60" data-ds-art="showcase.interval" value="${esc(sc.interval != null ? sc.interval : 7)}"></div></div></div>
            <div class="cp-card"><div class="cp-card-title">Section covers</div>
                <p class="cp-note" style="margin:.3rem 0 .4rem">A picture on each tile — the fleet on Fleet, a gate on Schedules, a tour poster on Tours. Leave any as none.</p>
                ${SECTIONS.map(([k, label]) => `<div class="ds-sec"><div><div style="font-weight:700;font-size:.84rem">${esc(label)}</div>${art.sections[k] ? `<img class="ds-thumb" src="${esc(art.sections[k])}" alt="">` : ''}</div>
                    <select class="cp-select" data-ds-section="${esc(k)}">${options(art.sections[k])}</select></div>`).join('')}</div>
            <button type="button" class="cp-btn cp-btn-primary" data-ds-save-art style="justify-content:center">Save placement</button>`;
    }

    function themeHtml() {
        const t = D.dirtyTheme || {};
        const sw = (mode) => TOKENS.map(([k, label]) => {
            const v = (t[mode] && t[mode][k]) || '';
            return `<label class="ds-sw"><input type="color" value="${esc(v || (mode === 'dark' ? '#1c1a16' : '#ffffff'))}" data-ds-color="${mode}.${k}" ${v ? '' : 'data-unset'}>
                <span style="min-width:0"><span style="display:block;font-weight:700">${esc(label)}</span>
                <input class="cp-input" data-ds-hex="${mode}.${k}" value="${esc(v)}" placeholder="default" maxlength="7" style="padding:.2rem .35rem;font-size:.72rem"></span></label>`;
        }).join('');
        return `<div class="cp-card" style="display:grid;gap:.6rem">
                <div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:center"><div class="cp-card-title" style="margin-right:auto">Theme file</div>
                    <button type="button" class="cp-btn cp-btn-sm" data-ds-export>Download theme</button>
                    <button type="button" class="cp-btn cp-btn-sm" data-ds-import>Upload theme…</button>
                    <input type="file" accept=".json,.crewtheme,application/json,.css,text/css" data-ds-import-file hidden></div>
                <p class="cp-note">Your designer can work on the whole look as one file — colours, fonts and CSS — and upload it back. A plain <code>.css</code> file goes straight into the custom CSS below.</p></div>
            <div class="cp-card" style="display:grid;gap:.6rem"><div class="cp-card-title">Light</div><div class="ds-swatches">${sw('light')}</div></div>
            <div class="cp-card" style="display:grid;gap:.6rem"><div class="cp-card-title">Dark</div><div class="ds-swatches">${sw('dark')}</div></div>
            <div class="cp-card" style="display:grid;gap:.6rem">
                <div class="cp-grid2">
                    <div><label class="cp-label">Body font (Google Fonts name)</label><input class="cp-input" data-ds-t="font" value="${esc(t.font || '')}" placeholder="Inter"></div>
                    <div><label class="cp-label">Heading font</label><input class="cp-input" data-ds-t="displayFont" value="${esc(t.displayFont || '')}" placeholder="Same as body"></div>
                </div>
                <div class="cp-grid2">
                    <div><label class="cp-label">Corner radius (px)</label><input class="cp-input" type="number" min="0" max="32" data-ds-t="radius" value="${t.radius != null ? esc(t.radius) : ''}" placeholder="default"></div>
                    <div><label class="cp-label">Opens in</label><select class="cp-select" data-ds-t="mode"><option value="auto" ${!t.mode || t.mode === 'auto' ? 'selected' : ''}>The reader’s choice</option><option value="light" ${t.mode === 'light' ? 'selected' : ''}>Light</option><option value="dark" ${t.mode === 'dark' ? 'selected' : ''}>Dark</option></select></div>
                </div>
                <div><label class="cp-label">Accent gradient (CSS colour stops)</label><input class="cp-input" data-ds-t="gradient" value="${esc(t.gradient || '')}" placeholder="135deg, #c8102e, #7a0019"></div>
            </div>
            <div class="cp-card" style="display:grid;gap:.5rem"><div class="cp-card-title">Custom CSS</div>
                <p class="cp-note">For your designer. Every rule is scoped to your crew centre; <code>@import</code>, non-https pictures and scripts are removed when you save, and you are told what was.</p>
                <textarea class="cp-textarea ds-css" data-ds-t="css" spellcheck="false" placeholder=".tile{ border-radius:18px }&#10;#hero h1{ letter-spacing:.02em }">${esc(t.css || '')}</textarea>
                <div data-ds-dropped></div></div>
            <div style="display:flex;gap:.4rem"><button type="button" class="cp-btn cp-btn-primary" data-ds-save-theme style="flex:1;justify-content:center">Save theme</button>
                <button type="button" class="cp-btn" data-ds-reset-theme>Reset to default</button></div>`;
    }

    function uiHtml() {
        const cur = D.data.ui || 'essential';
        const mini = {
            essential: '<div class="ds-mini" style="background:#f5f1ea;border:1px solid #e6e0d4"><div style="position:absolute;left:10px;top:10px;right:10px;height:18px;background:#fff;border:1px solid #e6e0d4;border-radius:6px"></div><div style="position:absolute;left:10px;top:36px;width:45%;bottom:10px;background:#fff;border:1px solid #e6e0d4;border-radius:6px"></div><div style="position:absolute;right:10px;top:36px;width:40%;bottom:10px;background:#fff;border:1px solid #e6e0d4;border-radius:6px"></div></div>',
            aurora: '<div class="ds-mini" style="background:radial-gradient(120% 90% at 20% 0%, #4f46e5, #0b0b12 70%)"><div style="position:absolute;left:10px;top:10px;right:10px;height:18px;background:rgb(255 255 255 / .12);border-radius:8px"></div><div style="position:absolute;left:10px;top:36px;right:10px;bottom:10px;background:rgb(255 255 255 / .08);border-radius:10px;backdrop-filter:blur(4px)"></div></div>',
            airline: '<div class="ds-mini" style="background:linear-gradient(135deg, var(--accent,#c8102e), #0b1a33)"><div style="position:absolute;left:10px;top:10px;width:55%;height:44px;background:#fff;border-radius:8px;box-shadow:0 4px 10px rgb(0 0 0 / .3)"><div style="position:absolute;right:28%;top:0;bottom:0;border-left:2px dashed #ccc"></div></div><div style="position:absolute;left:10px;right:10px;bottom:10px;height:22px;background:#111;border-radius:4px;font:700 10px/22px monospace;color:#fbbf24;padding-left:6px;letter-spacing:.12em">DEP 14:05 LHR</div></div>',
        };
        const card = (k, name, desc) => `<button type="button" data-ds-ui="${k}" aria-pressed="${cur === k}">${mini[k]}<div style="font-weight:800">${name}</div><div class="cp-note">${desc}</div></button>`;
        return `<p class="cp-note">What every pilot sees on their first visit. They can still switch for themselves from the top bar.</p>
            <div class="ds-ui">
                ${card('essential', 'Essential', 'Calm and papery. The original.')}
                ${card('aurora', 'Aurora', 'Dark glass over an ambient sky.')}
                ${card('airline', 'Airline', 'Your colours on everything: boarding passes, a departures board, a crew ID card.')}
            </div>`;
    }

    /* ---- studio events ---- */

    async function uploadFiles(files) {
        const list = [...(files || [])].filter((f) => /^image\//.test(f.type));
        if (!list.length) return;
        let done = 0;
        for (const f of list) {
            const form = new FormData();
            form.append('image', f);
            form.append('title', f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 80));
            form.append('kind', /livery/i.test(f.name) ? 'livery' : /poster/i.test(f.name) ? 'poster' : /wall/i.test(f.name) ? 'wallpaper' : 'other');
            try {
                P.toast(`Uploading ${done + 1} of ${list.length}…`);
                await raw('/artwork', { method: 'POST', form });
                done++;
            } catch (err) { P.toast(`${f.name}: ${err.message}`, 'bad'); }
        }
        if (done) P.toast(`${done} picture${done === 1 ? '' : 's'} added.`, 'ok');
        await load();
        changed();
    }

    function readThemeForm() {
        const body = D.panel.body;
        const t = D.dirtyTheme || (D.dirtyTheme = {});
        body.querySelectorAll('[data-ds-hex]').forEach((el) => {
            const [mode, k] = el.getAttribute('data-ds-hex').split('.');
            t[mode] = t[mode] || {};
            const v = el.value.trim();
            if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) t[mode][k] = v; else delete t[mode][k];
        });
        body.querySelectorAll('[data-ds-t]').forEach((el) => {
            const k = el.getAttribute('data-ds-t');
            t[k] = k === 'radius' ? (el.value === '' ? null : Number(el.value)) : el.value;
        });
        return t;
    }

    function readArtForm() {
        const body = D.panel.body;
        const art = JSON.parse(JSON.stringify(D.data.art || {}));
        art.showcase = art.showcase || {};
        body.querySelectorAll('[data-ds-art]').forEach((el) => {
            const k = el.getAttribute('data-ds-art');
            const v = el.type === 'checkbox' ? el.checked : el.type === 'number' || el.type === 'range' ? Number(el.value) : el.value;
            if (k.startsWith('showcase.')) art.showcase[k.slice(9)] = v; else art[k] = v;
        });
        art.sections = {};
        body.querySelectorAll('[data-ds-section]').forEach((el) => { if (el.value) art.sections[el.getAttribute('data-ds-section')] = el.value; });
        return art;
    }

    async function saveArt(art, btn) {
        const done = btn ? P.busy(btn, 'Saving…') : () => {};
        try { D.data = { ...D.data, ...(await D.api('/design', { method: 'PUT', body: { art } })) }; P.toast('Saved.', 'ok'); changed(); draw(); } catch (err) { P.toast(err.message, 'bad'); } finally { done(); }
    }

    async function onClick(ev) {
        const t = ev.target.closest('button, [data-ds-drop]');
        if (!t) return;
        const card = t.closest('[data-ds-id]');
        const id = card && card.getAttribute('data-ds-id');
        const a = id ? D.data.artwork.find((x) => x.id === id) : null;
        if (t.hasAttribute('data-ds-tab')) { D.tab = t.getAttribute('data-ds-tab'); draw(); return; }
        if (t.hasAttribute('data-ds-drop')) { D.panel.body.querySelector('[data-ds-file]').click(); return; }
        if (t.hasAttribute('data-ds-link-add')) {
            const inp = D.panel.body.querySelector('[data-ds-link]');
            const url = inp.value.trim();
            if (!https(url)) { P.toast('Paste an https link to a picture.', 'bad'); return; }
            try { await D.api('/artwork/link', { method: 'POST', body: { url } }); inp.value = ''; await load(); changed(); } catch (err) { P.toast(err.message, 'bad'); }
            return;
        }
        if (a && t.hasAttribute('data-ds-feature')) {
            try { await D.api(`/artwork/${encodeURIComponent(a.id)}`, { method: 'PATCH', body: { featured: a.featured === false } }); await load(); changed(); } catch (err) { P.toast(err.message, 'bad'); }
            return;
        }
        if (a && t.hasAttribute('data-ds-hero')) { await saveArt({ ...D.data.art, hero: D.data.art.hero === a.url ? '' : a.url }, t); return; }
        if (a && t.hasAttribute('data-ds-move')) {
            const ids = D.data.artwork.map((x) => x.id);
            const i = ids.indexOf(a.id); const j = i + Number(t.getAttribute('data-ds-move'));
            if (j < 0 || j >= ids.length) return;
            [ids[i], ids[j]] = [ids[j], ids[i]];
            try { await D.api('/artwork/order', { method: 'PUT', body: { ids } }); await load(); changed(); } catch (err) { P.toast(err.message, 'bad'); }
            return;
        }
        if (a && t.hasAttribute('data-ds-del')) {
            if (!await P.ask({ title: `Remove “${a.title || 'this picture'}”?`, body: 'It comes out of the showcase and off anywhere it is used as a hero, backdrop or cover.', confirm: 'Remove', danger: true })) return;
            try { await D.api(`/artwork/${encodeURIComponent(a.id)}`, { method: 'DELETE' }); await load(); changed(); } catch (err) { P.toast(err.message, 'bad'); }
            return;
        }
        const pick = t.closest('[data-ds-pick]');
        if (pick && t.hasAttribute('data-ds-val')) {
            const art = readArtForm();
            art[pick.getAttribute('data-ds-pick')] = t.getAttribute('data-ds-val');
            await saveArt(art);
            return;
        }
        if (t.hasAttribute('data-ds-save-art')) { await saveArt(readArtForm(), t); return; }
        if (t.hasAttribute('data-ds-save-theme') || t.hasAttribute('data-ds-reset-theme')) {
            const reset = t.hasAttribute('data-ds-reset-theme');
            if (reset && !await P.ask({ title: 'Reset the theme?', body: 'Colours, fonts and custom CSS go back to the crew centre’s own. Your artwork is not touched.', confirm: 'Reset' })) return;
            const theme = reset ? {} : readThemeForm();
            const done = P.busy(t, 'Saving…');
            try {
                const got = await D.api('/design', { method: 'PUT', body: { theme } });
                D.data = { ...D.data, ...got };
                D.dirtyTheme = JSON.parse(JSON.stringify(got.theme || {}));
                changed(); draw();
                const dropped = got.dropped || [];
                P.toast(dropped.length ? `Saved — ${dropped.length} thing${dropped.length === 1 ? '' : 's'} removed from the CSS.` : 'Theme saved.', dropped.length ? undefined : 'ok');
                const host = D.panel.body.querySelector('[data-ds-dropped]');
                if (host && dropped.length) host.innerHTML = `<div class="cp-note cp-note-warn">Removed: ${dropped.map(esc).join(' · ')}</div>`;
            } catch (err) { P.toast(err.message, 'bad'); } finally { done(); }
            return;
        }
        if (t.hasAttribute('data-ds-export')) {
            const done = P.busy(t, 'Preparing…');
            try {
                const res = await raw('/design/export');
                const blob = await res.blob();
                const m = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/);
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a'); link.href = url; link.download = (m && m[1]) || 'crew.crewtheme.json';
                document.body.appendChild(link); link.click(); link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 2000);
            } catch (err) { P.toast(err.message, 'bad'); } finally { done(); }
            return;
        }
        if (t.hasAttribute('data-ds-import')) { D.panel.body.querySelector('[data-ds-import-file]').click(); return; }
        if (t.hasAttribute('data-ds-ui')) {
            const ui = t.getAttribute('data-ds-ui');
            try {
                D.data = { ...D.data, ...(await D.api('/design', { method: 'PUT', body: { ui } })) };
                if (global.CrewSkin && global.CrewSkin.set) global.CrewSkin.set(ui, { persist: true });
                P.toast(`${ui[0].toUpperCase() + ui.slice(1)} is now your crew’s interface.`, 'ok');
                changed(); draw();
            } catch (err) { P.toast(err.message, 'bad'); }
        }
    }

    async function onChange(ev) {
        const el = ev.target;
        if (el.hasAttribute('data-ds-file')) { await uploadFiles(el.files); el.value = ''; return; }
        if (el.hasAttribute('data-ds-import-file')) {
            const f = el.files && el.files[0]; el.value = '';
            if (!f) return;
            const text = await f.text();
            if (/\.css$/i.test(f.name) || f.type === 'text/css') {
                readThemeForm();
                D.dirtyTheme.css = text;
                draw();
                P.toast('CSS loaded into the editor — press Save theme to apply it.');
                return;
            }
            try {
                const dry = await D.api('/design/import', { method: 'POST', body: { file: text, dryRun: true } });
                const bits = [
                    Object.keys((dry.theme && dry.theme.light) || {}).length ? 'light colours' : '',
                    Object.keys((dry.theme && dry.theme.dark) || {}).length ? 'dark colours' : '',
                    dry.theme && dry.theme.font ? `the ${dry.theme.font} font` : '',
                    dry.theme && dry.theme.css ? 'custom CSS' : '',
                    dry.art ? 'picture placement' : '',
                    dry.ui ? `the ${dry.ui} interface` : '',
                ].filter(Boolean);
                if (!await P.ask({
                    title: `Apply “${f.name}”?`,
                    body: `It sets ${bits.join(', ') || 'nothing we recognise'}.${(dry.dropped || []).length ? ` ${dry.dropped.length} unsafe CSS item${dry.dropped.length === 1 ? ' was' : 's were'} left out.` : ''} Your artwork library is not changed.`,
                    confirm: 'Apply theme',
                })) return;
                const got = await D.api('/design/import', { method: 'POST', body: { file: text } });
                D.data = { ...D.data, ...got };
                D.dirtyTheme = JSON.parse(JSON.stringify(got.theme || {}));
                if (got.ui && global.CrewSkin && global.CrewSkin.set) global.CrewSkin.set(got.ui, { persist: true });
                changed(); draw();
                P.toast('Theme applied.', 'ok');
            } catch (err) { P.toast(err.message, 'bad'); }
            return;
        }
        if (el.hasAttribute('data-ds-color')) {
            const hex = D.panel.body.querySelector(`[data-ds-hex="${el.getAttribute('data-ds-color')}"]`);
            if (hex) hex.value = el.value;
            return;
        }
        if (el.hasAttribute('data-ds-f')) {
            const card = el.closest('[data-ds-id]');
            if (!card) return;
            try { await D.api(`/artwork/${encodeURIComponent(card.getAttribute('data-ds-id'))}`, { method: 'PATCH', body: { [el.getAttribute('data-ds-f')]: el.value } }); const d = await D.api('/design'); D.data.artwork = d.artwork; changed(); } catch (err) { P.toast(err.message, 'bad'); }
        }
    }

    function openStudio({ api, backend, slug, token, tab, onChange: cb } = {}) {
        if (!P || typeof api !== 'function') { console.warn('crewDesign: the studio needs crewPanels.js and an api'); return; }
        styles();
        D.api = api; D.conn = { backend, slug, token }; D.onChange = cb || null;
        if (tab) D.tab = tab;
        if (!D.panel) {
            D.panel = P.sheet({ id: 'crewDesignStudio', title: 'Design studio', icon: 'palette', wide: true });
            const body = D.panel.body;
            body.addEventListener('click', (ev) => { onClick(ev).catch((err) => P.toast(err.message || 'That didn’t work.', 'bad')); });
            body.addEventListener('change', (ev) => { onChange(ev).catch((err) => P.toast(err.message || 'That didn’t work.', 'bad')); });
            body.addEventListener('dragover', (ev) => { const z = ev.target.closest('[data-ds-drop]'); if (z) { ev.preventDefault(); z.classList.add('over'); } });
            body.addEventListener('dragleave', (ev) => { const z = ev.target.closest('[data-ds-drop]'); if (z) z.classList.remove('over'); });
            body.addEventListener('drop', (ev) => { const z = ev.target.closest('[data-ds-drop]'); if (!z) return; ev.preventDefault(); z.classList.remove('over'); uploadFiles(ev.dataTransfer && ev.dataTransfer.files); });
        }
        D.panel.open();
        D.data = null; draw();
        load();
    }

    global.CrewDesign = {
        apply, effective, paintTiles, showcase, lightbox, openStudio,
        closeStudio: () => D.panel && D.panel.close(),
        SECTIONS, KINDS,
    };
})(window);
