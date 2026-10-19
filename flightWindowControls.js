/**
 * flightWindowControls.js
 * -------------------------------------------------------------------
 * The map controls for the open flight, standing outside its window — the
 * iOS app's corner column (ContentView.mapControls), on the website.
 *
 * One grouped piece of glass rather than loose buttons, so it reads as the
 * window's chrome:
 *   - a compass, only while the map is turned: back to north up;
 *   - the whole flight: both ends of the route, everything flown so far and
 *     the aeroplane, framed in the part of the map the window is not
 *     covering;
 *   - follow: the map on the aeroplane, and kept there until pressed again
 *     or the map is dragged away;
 *   - the flown path: on or off, and framed the moment it goes on;
 *   - chase (with the 3D aircraft on): behind the tail, the map turning as
 *     the aeroplane turns;
 *   - a chevron that folds the middle of the column away.
 * And under it, on a button of its own, 3D/2D for the 3D aircraft.
 *
 * Where it stands is read from the window on every frame, so it follows it
 * exactly however the window moves:
 *   - phone, where the window is a sheet on the bottom edge: on the sheet's
 *     top right-hand corner, riding it down while it is pulled, and faded
 *     as it opens towards the full window (gone by about two thirds of the
 *     way). When an upright column would not fit above a tall peek, it lies
 *     on its side along the sheet's top instead;
 *   - desktop: beside the window, on the side facing the map, level with its
 *     top.
 *
 * Public API:
 *   init(map, host)  host: {
 *     container        element the column is placed in (the map's)
 *     windowEl()       the flight window element
 *     selected()       the open flight's id, or null
 *     aircraft(id)     [lon, lat, heading] where it is drawn now, or null
 *     route(id)        [[lon, lat], …] filed plan, or []
 *     trail(id)        [[lon, lat], …] flown so far, or []
 *     flownPathLayer(id)  the 2D flown-path layer id
 *     flownPath: { isOn(), set(on) }
 *     models:    { available(), isOn(), set(on) }
 *     isMobile()
 *   }
 * ===================================================================
 */

export const FlightWindowControls = (() => {
    const COLLAPSED_KEY = 'flightWindowControlsCollapsed';
    const WIDTH = 44;
    const ROW = 42;
    const GAP = 10;
    // Room kept between a phone column and the top of the screen.
    const TOP_ROOM = 70;
    // How far off the middle of the free map the aeroplane may drift before
    // a follow brings the map back to it.
    const FOLLOW_SLACK_PX = 36;

    let map = null;
    let host = null;
    let root = null;
    let column = null;
    let rows = {};
    let modelsBtn = null;
    let frame = null;

    let following = false;
    let chasing = false;
    let followFlight = null;
    let collapsed = false;
    let lastKey = '';

    try { collapsed = localStorage.getItem(COLLAPSED_KEY) === '1'; } catch (_) {}

    // --- Glyphs ----------------------------------------------------------

    const COMPASS_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path d="M12 1.5 16.6 12H7.4Z" fill="#ef4444"/>
        <path d="M12 22.5 7.4 12h9.2Z" fill="currentColor" opacity=".85"/></svg>`;
    // A curved path between two points, as iOS draws it.
    const PATH_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none"
        stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <circle cx="5" cy="5" r="2.4" fill="currentColor" stroke="none"/>
        <circle cx="19" cy="19" r="2.4" fill="currentColor" stroke="none"/>
        <path d="M6.5 7.5c2 5 9-2 11 4.5" stroke-dasharray="0.1 3.2"/>
        <path d="M7 6c5 0 9 3 10.5 10.5"/></svg>`;

    // --- Building --------------------------------------------------------

    function injectStyles() {
        if (document.getElementById('fw-controls-styles')) return;
        const style = document.createElement('style');
        style.id = 'fw-controls-styles';
        style.textContent = `
            .fw-controls {
                position: absolute; z-index: 2099; display: flex; gap: 8px;
                align-items: center; pointer-events: none; opacity: 0;
                transition: opacity .22s ease;
            }
            .fw-controls.vertical { flex-direction: column; }
            .fw-controls.horizontal { flex-direction: row-reverse; }
            .fw-controls.shown { pointer-events: auto; }
            .fw-controls.faded { pointer-events: none; }
            .fw-controls .fw-glass {
                background: linear-gradient(135deg, var(--iw-bg-start, rgba(30,34,42,.72)), var(--iw-bg-end, rgba(18,20,26,.72)));
                backdrop-filter: blur(24px) saturate(160%);
                -webkit-backdrop-filter: blur(24px) saturate(160%);
                border: 1px solid var(--border-glass, rgba(255,255,255,.12));
                box-shadow: 0 8px 24px rgba(0,0,0,.35);
            }
            .fw-controls .fw-stack {
                display: flex; flex-direction: column; align-items: center;
                width: ${WIDTH}px; padding: 4px 0; border-radius: ${WIDTH / 2}px;
            }
            .fw-controls.horizontal .fw-stack {
                flex-direction: row-reverse; width: auto; height: ${WIDTH}px; padding: 0 4px;
            }
            .fw-controls button {
                appearance: none; border: 0; background: transparent; cursor: pointer;
                color: var(--text-primary, #fff); display: flex; align-items: center;
                justify-content: center; padding: 0; font: inherit;
            }
            .fw-controls .fw-row {
                width: ${WIDTH}px; height: ${ROW}px; position: relative;
                font-size: 16px;
            }
            .fw-controls .fw-row::before {
                content: ''; position: absolute; inset: 5px 6px; border-radius: 10px;
                background: transparent; transition: background .18s ease;
            }
            .fw-controls .fw-row > * { position: relative; }
            .fw-controls .fw-row:hover::before { background: rgba(255,255,255,.08); }
            /* On is a wash of colour, not a block of it. */
            .fw-controls .fw-row.on::before { background: rgba(56,189,248,.24); }
            .fw-controls .fw-row.on { color: #7dd3fc; }
            .fw-controls .fw-collapse { width: ${WIDTH}px; height: 22px; font-size: 11px; opacity: .7; }
            .fw-controls.horizontal .fw-collapse { width: 22px; height: ${WIDTH}px; }
            .fw-controls .fw-collapse:hover { opacity: 1; }
            .fw-controls .fw-models {
                width: ${WIDTH}px; height: ${WIDTH}px; border-radius: 50%;
                font: 800 14px/1 ui-rounded, system-ui, sans-serif; letter-spacing: .02em;
            }
            .fw-controls .fw-models.on { color: #7dd3fc; }
            .fw-controls [hidden] { display: none !important; }
            .fw-controls .fw-compass svg { transition: transform .12s linear; }
        `;
        document.head.appendChild(style);
    }

    function build() {
        injectStyles();
        root = document.createElement('div');
        root.className = 'fw-controls vertical';
        root.setAttribute('role', 'toolbar');
        root.setAttribute('aria-label', 'Map controls for this flight');

        column = document.createElement('div');
        column.className = 'fw-stack fw-glass';

        const row = (key, html, title, onClick) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `fw-row fw-${key}`;
            b.innerHTML = html;
            b.title = title;
            b.setAttribute('aria-label', title);
            b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); haptic(); });
            column.appendChild(b);
            rows[key] = b;
            return b;
        };

        row('compass', COMPASS_SVG, 'North up', northUp);
        row('frame', '<i class="fa-solid fa-expand"></i>', 'Show the whole flight', showWholeFlight);
        row('follow', '<i class="fa-solid fa-location-arrow"></i>', 'Centre on this aircraft and follow it', toggleFollow);
        row('path', PATH_SVG, 'Hide the flown path', toggleFlownPath);
        row('chase', '<i class="fa-solid fa-video"></i>', 'Chase this aircraft from behind', toggleChase);

        const collapse = document.createElement('button');
        collapse.type = 'button';
        collapse.className = 'fw-collapse';
        collapse.addEventListener('click', (e) => {
            e.stopPropagation();
            collapsed = !collapsed;
            try { localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0'); } catch (_) {}
            lastKey = '';
            haptic();
        });
        column.appendChild(collapse);
        rows.collapse = collapse;

        modelsBtn = document.createElement('button');
        modelsBtn.type = 'button';
        modelsBtn.className = 'fw-models fw-glass';
        modelsBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleModels(); haptic(); });

        root.appendChild(column);
        root.appendChild(modelsBtn);
        // Taps on the column are the column's, never the map's.
        for (const type of ['mousedown', 'touchstart', 'dblclick', 'wheel']) {
            root.addEventListener(type, (e) => e.stopPropagation(), { passive: true });
        }
        host.container.appendChild(root);
    }

    function haptic() {
        try { window.InflightHaptics?.select?.(); } catch (_) { /* optional */ }
    }

    // --- Where the map can be seen ---------------------------------------

    // The part of the map the window does not cover, as camera padding, so a
    // framed flight or a followed aeroplane lands in the middle of the gap
    // rather than in the middle of the screen, behind the window.
    function freePadding(extra = 0) {
        const pad = { top: 60 + extra, bottom: 40 + extra, left: 40 + extra, right: 40 + extra };
        const win = host.windowEl();
        if (!win || !isWindowUp(win)) return pad;
        const r = win.getBoundingClientRect();
        const m = map.getContainer().getBoundingClientRect();
        if (host.isMobile()) {
            pad.bottom = Math.max(pad.bottom, m.bottom - r.top + 20 + extra);
        } else if (r.left + r.width / 2 > m.left + m.width / 2) {
            pad.right = Math.max(pad.right, m.right - r.left + WIDTH + 2 * GAP + extra);
        } else {
            pad.left = Math.max(pad.left, r.right - m.left + WIDTH + 2 * GAP + extra);
        }
        // Never more padding than map.
        const maxV = m.height * 0.7, maxH = m.width * 0.7;
        if (pad.top + pad.bottom > maxV) pad.bottom = Math.max(0, maxV - pad.top);
        if (pad.left + pad.right > maxH) {
            if (pad.right > pad.left) pad.right = Math.max(0, maxH - pad.left);
            else pad.left = Math.max(0, maxH - pad.right);
        }
        return pad;
    }

    function isWindowUp(win) {
        if (!win || !win.classList.contains('visible')) return false;
        const r = win.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    }

    // --- Actions -----------------------------------------------------------

    function northUp() {
        // Facing north and riding behind the tail cannot both hold.
        chasing = false;
        map.easeTo({ bearing: 0, duration: 500 });
    }

    function frameCoordinates(points, maxZoom) {
        const pts = points.filter((p) => p && isFinite(p[0]) && isFinite(p[1]));
        if (!pts.length) return;
        // Framing pulls the camera away from the aeroplane: following stands
        // down.
        following = false;
        chasing = false;
        if (pts.length === 1) {
            map.easeTo({ center: pts[0], zoom: Math.max(map.getZoom(), 8), padding: freePadding(), duration: 900 });
            return;
        }
        // Unwrapped across the antimeridian, so a Pacific crossing frames the
        // ocean it crosses rather than the whole world the other way round.
        let ref = pts[0][0];
        let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
        for (const [lon0, lat] of pts) {
            let lon = lon0;
            while (lon - ref > 180) lon -= 360;
            while (lon - ref < -180) lon += 360;
            ref = lon;
            minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
            minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
        }
        try {
            map.fitBounds([[minLon, minLat], [maxLon, maxLat]], {
                padding: freePadding(24), maxZoom, duration: 1000, bearing: map.getBearing(), pitch: map.getPitch()
            });
        } catch (_) { /* padding larger than the map on a tiny screen */ }
    }

    function showWholeFlight() {
        const id = host.selected();
        if (id == null) return;
        const plane = host.aircraft(id);
        frameCoordinates([...host.route(id), ...host.trail(id), plane && [plane[0], plane[1]]], 12);
    }

    function toggleFollow() {
        following = !following;
        if (!following) chasing = false;
        followFlight = host.selected();
        // Either way round the map goes to the aeroplane now: follow on its own
        // only acts once the aeroplane drifts off the middle, which from a map
        // pointed elsewhere would look like the button had done nothing.
        recentre(true);
    }

    function toggleFlownPath() {
        const on = !host.flownPath.isOn();
        host.flownPath.set(on);
        lastKey = '';
        if (!on) return;
        const id = host.selected();
        if (id == null) return;
        const plane = host.aircraft(id);
        frameCoordinates([...host.trail(id), plane && [plane[0], plane[1]]], 13);
    }

    function toggleChase() {
        chasing = !chasing;
        if (chasing) {
            following = true;
            followFlight = host.selected();
            if (map.getPitch() < 50) map.easeTo({ pitch: 62, duration: 600 });
        }
        recentre(true);
        lastKey = '';
    }

    function toggleModels() {
        const on = !host.models.isOn();
        host.models.set(on);
        // 3D leans the map over to stand the aeroplanes up; 2D lays it back
        // down flat.
        if (on && map.getPitch() < 40) map.easeTo({ pitch: 55, duration: 700 });
        if (!on) {
            chasing = false;
            if (map.getPitch() > 0) map.easeTo({ pitch: 0, duration: 700 });
        }
        lastKey = '';
    }

    function recentre(force) {
        const id = host.selected();
        if (!following || id == null) return;
        const plane = host.aircraft(id);
        if (!plane) return;
        const padding = freePadding();
        if (!force) {
            if (map.isMoving()) return;
            const p = map.project([plane[0], plane[1]]);
            const c = map.getContainer();
            const cx = padding.left + (c.clientWidth - padding.left - padding.right) / 2;
            const cy = padding.top + (c.clientHeight - padding.top - padding.bottom) / 2;
            const drift = Math.hypot(p.x - cx, p.y - cy);
            const turn = chasing ? Math.abs(((plane[2] - map.getBearing() + 540) % 360) - 180) : 0;
            if (drift < FOLLOW_SLACK_PX && turn < 4) return;
        }
        const opts = { center: [plane[0], plane[1]], padding, duration: force ? 800 : 700, essential: true };
        if (chasing) opts.bearing = plane[2];
        map.easeTo(opts);
    }

    // --- Every frame -------------------------------------------------------

    function tick() {
        frame = requestAnimationFrame(tick);
        const win = host.windowEl();
        const id = host.selected();
        const up = id != null && isWindowUp(win);
        if (!up) {
            root.classList.remove('shown');
            root.style.opacity = '0';
            if (following && id == null) { following = false; chasing = false; }
            return;
        }
        if (followFlight !== null && id !== followFlight) {
            // Another aeroplane opened: the follow was for the last one.
            following = false; chasing = false; followFlight = null;
        }

        const modelsOn = !!host.models.isOn();
        if (!modelsOn && chasing) chasing = false;
        const bearing = map.getBearing();
        const turned = Math.abs(bearing) > 0.5;
        const pathOn = !!host.flownPath.isOn();
        const mobile = host.isMobile();

        // Placement, from the window as it is drawn this frame.
        const r = win.getBoundingClientRect();
        const c = host.container.getBoundingClientRect();
        const rowsShown = 1 + (turned ? 1 : 0) + (collapsed ? 0 : (modelsOn ? 4 : 3));
        const columnHeight = rowsShown * ROW + 8 + (host.models.available() ? WIDTH + 8 : 0);
        let left, top, opacity = 1, vertical = true;
        if (mobile) {
            // Lying on its side along the top of a peek too tall for it.
            vertical = r.top - c.top - columnHeight - GAP >= TOP_ROOM;
            const ownHeight = vertical ? columnHeight : WIDTH;
            const ownWidth = vertical ? WIDTH : root.offsetWidth || WIDTH;
            left = c.width - 12 - ownWidth;
            top = r.top - c.top - GAP - ownHeight;
            // Faded over the first part of the opening, so nothing is left
            // hanging half there over a window that has nearly arrived.
            const peekTop = window.innerHeight - (window.MobileUIHandler?.getPeekHeight?.() || 320);
            const fullTop = window.innerHeight - r.height;
            const span = Math.max(peekTop - fullTop, 1);
            const openness = Math.min(Math.max((peekTop - r.top) / span, 0), 1);
            opacity = Math.max(0, 1 - openness * 1.6);
            if (top < 8) opacity = 0;
        } else {
            const onRight = r.left + r.width / 2 > c.left + c.width / 2;
            left = onRight ? r.left - c.left - GAP - WIDTH : r.right - c.left + GAP;
            top = r.top - c.top;
            if (left < 4 || left + WIDTH > c.width - 4) opacity = 0;
        }

        const key = [turned, collapsed, modelsOn, pathOn, following, chasing, vertical].join('|');
        if (key !== lastKey) {
            lastKey = key;
            root.classList.toggle('vertical', vertical);
            root.classList.toggle('horizontal', !vertical);
            rows.compass.hidden = !turned;
            for (const k of ['frame', 'follow', 'path']) rows[k].hidden = collapsed;
            rows.chase.hidden = collapsed || !modelsOn;
            rows.follow.classList.toggle('on', following);
            rows.follow.title = following ? 'Stop following this aircraft' : 'Centre on this aircraft and follow it';
            rows.path.classList.toggle('on', pathOn);
            rows.path.title = pathOn ? 'Hide the flown path' : 'Show the flown path';
            rows.chase.classList.toggle('on', chasing);
            rows.chase.title = chasing ? 'Stop chasing this aircraft' : 'Chase this aircraft from behind';
            for (const k of ['follow', 'path', 'chase']) rows[k].setAttribute('aria-label', rows[k].title);
            rows.collapse.innerHTML = vertical
                ? `<i class="fa-solid fa-chevron-${collapsed ? 'up' : 'down'}"></i>`
                : `<i class="fa-solid fa-chevron-${collapsed ? 'left' : 'right'}"></i>`;
            rows.collapse.title = collapsed ? 'Show map controls' : 'Hide map controls';
            rows.collapse.setAttribute('aria-label', rows.collapse.title);
            modelsBtn.hidden = !host.models.available();
            modelsBtn.textContent = modelsOn ? '2D' : '3D';
            modelsBtn.classList.toggle('on', modelsOn);
            modelsBtn.title = modelsOn ? 'Back to flat aircraft' : 'Show the aircraft in 3D';
            modelsBtn.setAttribute('aria-label', modelsBtn.title);
        }
        if (turned) {
            const svg = rows.compass.firstElementChild;
            if (svg) svg.style.transform = `rotate(${-bearing}deg)`;
        }

        root.style.left = `${Math.round(left)}px`;
        root.style.top = `${Math.round(top)}px`;
        root.style.opacity = String(opacity);
        root.classList.add('shown');
        root.classList.toggle('faded', opacity < 0.5);

        // The open flight's flown path, as the switch says, whenever its
        // layer is (re)built.
        const layer = host.flownPathLayer(id);
        if (layer && map.getLayer(layer)) {
            const want = pathOn ? 'visible' : 'none';
            if (map.getLayoutProperty(layer, 'visibility') !== want) map.setLayoutProperty(layer, 'visibility', want);
        }

        recentre(false);
    }

    // --- Public ------------------------------------------------------------

    function init(m, h) {
        if (map) return;
        map = m;
        host = h;
        build();
        // Dragging the map away is letting go of the aeroplane.
        map.on('dragstart', () => {
            if (following) { following = false; chasing = false; lastKey = ''; }
        });
        frame = requestAnimationFrame(tick);
    }

    function isFollowing() { return following; }

    return { init, isFollowing };
})();
