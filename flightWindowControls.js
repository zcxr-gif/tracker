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
 *   - the camera (with the 3D aircraft on): locked on to the aeroplane. It
 *     starts behind the tail and stays in the middle of the screen; zooming
 *     zooms into it, a drag or a twist goes round it, and the camera turns
 *     with it so the view you chose holds as it turns;
 *   - a chevron that folds the middle of the column away.
 * And under it, on a button of its own, 3D/2D for the 3D aircraft.
 *
 * Above them, a second piece of glass with the window's own buttons — pin
 * (desktop), "this is my flight", path info, replay and the trip card —
 * moved off its photograph. Each one presses the window's real button, so
 * every flow behind them is the window's own. While the column is showing,
 * the window's copies are hidden (`fw-actions-out`); when it fades away over
 * a sheet opened all the way, they come back inside the window.
 *
 * Where it stands is read from the window on every frame, so it follows it
 * exactly however the window moves:
 *   - phone, where the window is a sheet on the bottom edge: the map
 *     controls on the sheet's top right-hand corner and the window's buttons
 *     on its top left-hand one, both riding it down while it is pulled and
 *     faded as it opens towards the full window (gone by about two thirds of
 *     the way). Each lies on its side along the sheet only when it is too
 *     tall to stand above the peek;
 *   - desktop: beside the window, on the side facing the map, level with its
 *     top — the window's buttons first, the map controls under them.
 *
 * With no flight open the corner keeps the map's own controls, as the iOS
 * app's does: the compass while the map is turned (or tilted, with the 3D
 * aircraft off) and 3D/2D — over the weather and ATC bubbles on a phone, in
 * the bottom right-hand corner on desktop.
 *
 * Public API:
 *   init(map, host)  host: {
 *     container        element the column is placed in (the map's)
 *     windowEl()       the flight window element
 *     selected()       the open flight's id, or null
 *     aircraft(id)     [lon, lat, heading] where it is drawn now, or null
 *     route(id)        [[lon, lat], …] filed plan, or []
 *     trail(id)        [[lon, lat], …] flown so far, or []
 *     height(id)       metres above the ground the aircraft is drawn at (0
 *                      for a flat icon)
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

    // The window's header buttons, in the order they stood there. `phone`
    // false: hidden on narrow screens, as the window hides it.
    const ACTIONS = [
        { key: 'pin', sel: '.aircraft-window-pin-btn', icon: 'fa-solid fa-thumbtack', title: 'Pin flight', phone: false },
        { key: 'trackme', sel: '.aircraft-window-trackme-btn', icon: 'fa-solid fa-bell', title: 'This is my flight' },
        { key: 'pathinfo', sel: '.aircraft-window-pathinfo-btn', icon: 'fa-solid fa-route', title: 'Path info' },
        { key: 'replay', sel: '.aircraft-window-replay-btn:not(.simple-proxy)', icon: 'fa-solid fa-circle-play', title: 'Replay flight' },
        { key: 'share', sel: '.aircraft-window-share-btn', icon: 'fa-solid fa-camera', title: 'Trip card' },
    ];

    let map = null;
    let host = null;
    let root = null;
    let column = null;
    let rows = {};
    let modelsBtn = null;
    let actions = null;
    let leftRoot = null;
    const actionRows = {};
    let frame = null;

    let following = false;
    let chasing = false;
    // The camera's bearing relative to the aeroplane's heading: 0 is behind
    // the tail. What a drag or a twist round the aeroplane changes.
    let chaseOffset = 0;
    // A one-finger (or mouse) drag going round the aeroplane.
    let orbit = null;
    // The map's own gestures as they were before the camera locked on.
    let savedHandlers = null;
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
            .fw-controls.horizontal.fw-left { flex-direction: row; }
            .fw-controls.horizontal.fw-left .fw-stack { flex-direction: row; }
            .fw-controls .fw-main { display: flex; flex-direction: column; align-items: center; gap: 8px; }
            .fw-controls.horizontal .fw-main { flex-direction: row-reverse; }
            /* On its side the groups run right to left and wrap upwards. */
            .fw-controls.horizontal { flex-direction: row-reverse; flex-wrap: wrap-reverse; justify-content: flex-start; }
            #aircraft-info-window.fw-actions-out .overview-actions { display: none !important; }
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
        row('chase', '<i class="fa-solid fa-video"></i>', 'Lock the camera on this aircraft', toggleChase);

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

        actions = document.createElement('div');
        actions.className = 'fw-stack fw-glass fw-actions';
        for (const a of ACTIONS) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `fw-row fw-act-${a.key}`;
            b.innerHTML = `<i class="${a.icon}"></i>`;
            b.title = a.title;
            b.setAttribute('aria-label', a.title);
            b.hidden = true;
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                const real = host.windowEl() && host.windowEl().querySelector(a.sel);
                if (real) real.click();
                lastKey = '';
            });
            actions.appendChild(b);
            actionRows[a.key] = b;
        }

        const main = document.createElement('div');
        main.className = 'fw-main';
        main.appendChild(column);
        main.appendChild(modelsBtn);
        root.appendChild(main);

        // The window's buttons stand on their own, at the other corner.
        leftRoot = document.createElement('div');
        leftRoot.className = 'fw-controls fw-left vertical';
        leftRoot.setAttribute('role', 'toolbar');
        leftRoot.setAttribute('aria-label', 'Flight actions');
        leftRoot.appendChild(actions);

        // Taps on the column are the column's, never the map's.
        for (const el of [root, leftRoot]) {
            for (const type of ['mousedown', 'touchstart', 'dblclick', 'wheel']) {
                el.addEventListener(type, (e) => e.stopPropagation(), { passive: true });
            }
            host.container.appendChild(el);
        }
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
        setChasing(false);
        // Level as well, unless the 3D aircraft are what the tilt is for.
        const opts = { bearing: 0, duration: 500, essential: true };
        if (!host.models.isOn()) opts.pitch = 0;
        map.easeTo(opts);
    }

    function frameCoordinates(points, maxZoom) {
        const pts = points.filter((p) => p && isFinite(p[0]) && isFinite(p[1]));
        if (!pts.length) return;
        // Framing pulls the camera away from the aeroplane: following stands
        // down.
        following = false;
        setChasing(false);
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
        if (!following) setChasing(false);
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
        if (chasing) { setChasing(false); return; }
        const plane = host.aircraft(host.selected());
        if (!plane) return;
        following = true;
        followFlight = host.selected();
        setChasing(true);
        // Behind the tail, the aeroplane in the middle of the screen.
        chaseOffset = 0;
        const pitch = Math.max(map.getPitch(), 62);
        map.easeTo({
            center: aimAt(plane, plane[2], pitch), bearing: plane[2], pitch,
            zoom: Math.max(map.getZoom(), 12), padding: { top: 0, bottom: 0, left: 0, right: 0 },
            duration: 900, essential: true
        });
    }

    // Locks the camera on, or lets it go: zooming and twisting pivot on the
    // middle of the screen, where the aeroplane is, and a one-finger drag
    // goes round it instead of sliding the map away.
    function setChasing(on) {
        on = !!on;
        if (on === chasing) return;
        chasing = on;
        lastKey = '';
        orbit = null;
        if (on) {
            savedHandlers = {
                dragPan: map.dragPan.isEnabled(),
                scrollZoom: map.scrollZoom.isEnabled(),
                touchZoomRotate: map.touchZoomRotate.isEnabled(),
                doubleClickZoom: map.doubleClickZoom.isEnabled()
            };
            map.dragPan.disable();
            if (savedHandlers.scrollZoom) map.scrollZoom.enable({ around: 'center' });
            if (savedHandlers.touchZoomRotate) map.touchZoomRotate.enable({ around: 'center' });
            map.doubleClickZoom.disable();
            map.getCanvasContainer().addEventListener('pointerdown', onOrbitStart);
        } else if (savedHandlers) {
            const h = savedHandlers;
            savedHandlers = null;
            if (h.dragPan) map.dragPan.enable();
            if (h.scrollZoom) map.scrollZoom.enable();
            if (h.touchZoomRotate) map.touchZoomRotate.enable();
            if (h.doubleClickZoom) map.doubleClickZoom.enable();
            map.getCanvasContainer().removeEventListener('pointerdown', onOrbitStart);
            window.removeEventListener('pointermove', onOrbitMove);
            window.removeEventListener('pointerup', onOrbitEnd);
            window.removeEventListener('pointercancel', onOrbitEnd);
        }
    }

    // --- Going round the aeroplane -----------------------------------------

    const activePointers = new Set();

    function onOrbitStart(e) {
        if (!chasing || (e.pointerType === 'mouse' && e.button !== 0)) return;
        activePointers.add(e.pointerId);
        // Two fingers are the map's own pinch and twist, already pivoting on
        // the aeroplane.
        if (activePointers.size > 1) { orbit = null; return; }
        orbit = { id: e.pointerId, x: e.clientX, y: e.clientY };
        window.addEventListener('pointermove', onOrbitMove);
        window.addEventListener('pointerup', onOrbitEnd);
        window.addEventListener('pointercancel', onOrbitEnd);
    }

    function onOrbitMove(e) {
        if (!orbit || e.pointerId !== orbit.id || activePointers.size > 1) return;
        const dx = e.clientX - orbit.x, dy = e.clientY - orbit.y;
        orbit.x = e.clientX; orbit.y = e.clientY;
        if (!dx && !dy) return;
        // Across turns the camera round the aeroplane; up and down leans it
        // between overhead and the horizon.
        const plane = host.aircraft(host.selected());
        if (!plane) return;
        chaseOffset = norm(chaseOffset - dx * 0.35);
        const bearing = plane[2] + chaseOffset;
        const pitch = Math.min(Math.max(map.getPitch() - dy * 0.3, 0), 85);
        map.jumpTo({ center: aimAt(plane, bearing, pitch), bearing, pitch });
    }

    function onOrbitEnd(e) {
        activePointers.delete(e.pointerId);
        if (orbit && e.pointerId === orbit.id) orbit = null;
        if (!activePointers.size) {
            window.removeEventListener('pointermove', onOrbitMove);
            window.removeEventListener('pointerup', onOrbitEnd);
            window.removeEventListener('pointercancel', onOrbitEnd);
        }
    }

    // The ground point to centre the map on so that the aircraft itself —
    // drawn at its height, not at the ground under it — is in the middle of
    // the screen: along the line of sight, beyond it by height × tan(tilt).
    function aimAt(plane, bearing, pitch) {
        const h = Math.max(Number(host.height ? host.height(host.selected()) : 0) || 0, 0);
        if (!h || pitch < 0.5) return [plane[0], plane[1]];
        const d = h * Math.tan(Math.min(pitch, 85) * Math.PI / 180);
        const b = bearing * Math.PI / 180;
        const lat = plane[1] * Math.PI / 180;
        const dLat = (d * Math.cos(b)) / 111320;
        const dLon = (d * Math.sin(b)) / (111320 * Math.max(Math.cos(lat), 0.01));
        return [plane[0] + dLon, plane[1] + dLat];
    }

    function norm(deg) {
        return ((deg + 540) % 360) - 180;
    }

    // Every frame while the camera is locked on: the aeroplane back in the
    // middle and the camera turned with it — except while the map's own
    // gestures are under way (a pinch, a twist, a wheel easing out), which
    // a jump would cut short. Those pivot on the middle anyway; a twist is
    // read back as the new place round the aeroplane.
    function holdChase() {
        const plane = host.aircraft(host.selected());
        if (!plane) return;
        if (map.isMoving() || orbit) {
            if (!orbit) chaseOffset = norm(map.getBearing() - plane[2]);
            return;
        }
        const want = plane[2] + chaseOffset;
        const target = aimAt(plane, want, map.getPitch());
        const p = map.project(target);
        const mid = map.project(map.getCenter());
        if (Math.hypot(p.x - mid.x, p.y - mid.y) < 0.25 && Math.abs(norm(map.getBearing() - want)) < 0.05) return;
        map.jumpTo({ center: target, bearing: want });
    }

    function toggleModels() {
        const on = !host.models.isOn();
        host.models.set(on);
        // 3D leans the map over to stand the aeroplanes up; 2D lays it back
        // down flat.
        if (on && map.getPitch() < 40) map.easeTo({ pitch: 55, duration: 700 });
        if (!on) {
            setChasing(false);
            if (map.getPitch() > 0) map.easeTo({ pitch: 0, duration: 700 });
        }
        lastKey = '';
    }

    function recentre(force) {
        const id = host.selected();
        if (!following || chasing || id == null) return;
        const plane = host.aircraft(id);
        if (!plane) return;
        const padding = freePadding();
        if (!force) {
            if (map.isMoving()) return;
            const p = map.project(aimAt(plane, map.getBearing(), map.getPitch()));
            const c = map.getContainer();
            const cx = padding.left + (c.clientWidth - padding.left - padding.right) / 2;
            const cy = padding.top + (c.clientHeight - padding.top - padding.bottom) / 2;
            const drift = Math.hypot(p.x - cx, p.y - cy);
            if (drift < FOLLOW_SLACK_PX) return;
        }
        map.easeTo({ center: aimAt(plane, map.getBearing(), map.getPitch()), padding, duration: force ? 800 : 700, essential: true });
    }

    // --- Every frame -------------------------------------------------------

    function tick() {
        frame = requestAnimationFrame(tick);
        const win = host.windowEl();
        const id = host.selected();
        const up = id != null && isWindowUp(win);
        if (!up && win) win.classList.remove('fw-actions-out');
        if (following && !up) { following = false; setChasing(false); }
        if (followFlight !== null && id !== followFlight) {
            // Another aeroplane opened: the follow was for the last one.
            following = false; setChasing(false); followFlight = null;
        }

        const modelsOn = !!host.models.isOn();
        if (!modelsOn && chasing) setChasing(false);
        const bearing = map.getBearing();
        // The compass: a turned map, or a tilted one that is not tilted for
        // the 3D aircraft.
        const turned = Math.abs(bearing) > 0.5 || (!modelsOn && map.getPitch() > 1);
        const pathOn = !!host.flownPath.isOn();
        const mobile = host.isMobile();
        const c = host.container.getBoundingClientRect();

        // The window's buttons this flight has, as the window draws them now.
        const narrow = window.matchMedia('(max-width: 768px)').matches;
        let actionSig = '';
        let actionCount = 0;
        if (up) {
            for (const a of ACTIONS) {
                const real = a.phone === false && narrow ? null : win.querySelector(a.sel);
                const icon = real && real.querySelector('i');
                if (real) actionCount++;
                actionSig += real ? `${a.key}:${icon ? icon.className : ''}:${real.classList.contains('on')}:${real.title};` : '';
            }
        }

        const flightRows = up && !collapsed ? (modelsOn ? 4 : 3) : 0;
        const rowsShown = (up ? 1 : 0) + (turned ? 1 : 0) + flightRows;
        const modelsShown = host.models.available();
        const mainHeight = (rowsShown ? rowsShown * ROW + 8 : 0) + (modelsShown ? WIDTH + (rowsShown ? 8 : 0) : 0);
        const actionsHeight = actionCount ? actionCount * ROW + 8 : 0;

        let layout = 'vertical', leftLayout = 'vertical';
        let left = 0, top = 0, opacity = 1;
        let aLeft = 0, aTop = 0;
        let shown = true;

        if (up) {
            const r = win.getBoundingClientRect();
            if (mobile) {
                // Each stands upright above the peek if it fits, and lies on
                // its side along the sheet's top only when it does not.
                const room = r.top - c.top - GAP - TOP_ROOM;
                layout = mainHeight <= room ? 'vertical' : 'horizontal';
                leftLayout = actionsHeight <= room ? 'vertical' : 'horizontal';
                setLayout(root, layout);
                setLayout(leftRoot, leftLayout);
                const half = `${Math.max(c.width / 2 - 18, WIDTH)}px`;
                root.style.maxWidth = layout === 'horizontal' ? half : '';
                leftRoot.style.maxWidth = leftLayout === 'horizontal' ? half : '';
                left = c.width - 12 - (root.offsetWidth || WIDTH);
                top = r.top - c.top - GAP - (root.offsetHeight || WIDTH);
                aLeft = 12;
                aTop = r.top - c.top - GAP - (leftRoot.offsetHeight || WIDTH);
                // Faded over the first part of the opening, so nothing is left
                // hanging half there over a window that has nearly arrived.
                const peekTop = window.innerHeight - (window.MobileUIHandler?.getPeekHeight?.() || 320);
                const fullTop = window.innerHeight - r.height;
                const span = Math.max(peekTop - fullTop, 1);
                const openness = Math.min(Math.max((peekTop - r.top) / span, 0), 1);
                opacity = Math.max(0, 1 - openness * 1.6);
                if (Math.min(top, aTop) < 8) opacity = 0;
            } else {
                setLayout(root, 'vertical');
                setLayout(leftRoot, 'vertical');
                root.style.maxWidth = leftRoot.style.maxWidth = '';
                const onRight = r.left + r.width / 2 > c.left + c.width / 2;
                left = aLeft = onRight ? r.left - c.left - GAP - WIDTH : r.right - c.left + GAP;
                aTop = r.top - c.top;
                top = aTop + (actionCount ? (leftRoot.offsetHeight || actionsHeight) + 8 : 0);
                if (left < 4 || left + WIDTH > c.width - 4) opacity = 0;
            }
        } else {
            // No flight open: the map's own controls stay in the corner.
            setLayout(root, 'vertical');
            root.style.maxWidth = '';
            const busy = mobile && host.container.classList.contains('mobile-window-open');
            shown = !busy && (turned || modelsShown);
            const ownHeight = root.offsetHeight || mainHeight;
            const bubbles = mobile ? document.getElementById('ios-map-bubbles') : null;
            const b = bubbles && bubbles.getBoundingClientRect();
            if (b && b.width > 0 && b.height > 0) {
                left = b.right - c.left - WIDTH - Math.max((b.width - WIDTH) / 2, 0);
                top = b.top - c.top - GAP - ownHeight;
            } else {
                left = c.width - 16 - WIDTH;
                top = c.height - (mobile ? 120 : 40) - ownHeight;
            }
        }

        const vertical = layout !== 'horizontal';
        const key = [up, turned, collapsed, modelsOn, pathOn, following, chasing, layout, leftLayout, actionSig].join('|');
        if (key !== lastKey) {
            lastKey = key;
            actions.hidden = !actionCount;
            for (const a of ACTIONS) {
                const row = actionRows[a.key];
                const real = up && !(a.phone === false && narrow) ? win.querySelector(a.sel) : null;
                row.hidden = !real;
                if (!real) continue;
                const icon = real.querySelector('i');
                if (icon) row.firstElementChild.className = icon.className;
                row.classList.toggle('on', real.classList.contains('on'));
                row.title = real.title || a.title;
                row.setAttribute('aria-label', row.title);
            }
            column.hidden = rowsShown === 0;
            rows.compass.hidden = !turned;
            for (const k of ['frame', 'follow', 'path']) rows[k].hidden = !up || collapsed;
            rows.chase.hidden = !up || collapsed || !modelsOn;
            rows.collapse.hidden = !up;
            rows.follow.classList.toggle('on', following);
            rows.follow.title = following ? 'Stop following this aircraft' : 'Centre on this aircraft and follow it';
            rows.path.classList.toggle('on', pathOn);
            rows.path.title = pathOn ? 'Hide the flown path' : 'Show the flown path';
            rows.chase.classList.toggle('on', chasing);
            rows.chase.title = chasing ? 'Let go of this aircraft' : 'Lock the camera on this aircraft';
            for (const k of ['follow', 'path', 'chase']) rows[k].setAttribute('aria-label', rows[k].title);
            rows.collapse.innerHTML = vertical
                ? `<i class="fa-solid fa-chevron-${collapsed ? 'up' : 'down'}"></i>`
                : `<i class="fa-solid fa-chevron-${collapsed ? 'left' : 'right'}"></i>`;
            rows.collapse.title = collapsed ? 'Show map controls' : 'Hide map controls';
            rows.collapse.setAttribute('aria-label', rows.collapse.title);
            modelsBtn.hidden = !modelsShown;
            modelsBtn.textContent = modelsOn ? '2D' : '3D';
            modelsBtn.classList.toggle('on', modelsOn);
            modelsBtn.title = modelsOn ? 'Back to flat aircraft' : 'Show the aircraft in 3D';
            modelsBtn.setAttribute('aria-label', modelsBtn.title);
        }
        if (turned) {
            const svg = rows.compass.firstElementChild;
            if (svg) svg.style.transform = `rotate(${-bearing}deg)`;
        }

        place(root, left, top, shown ? opacity : 0);
        place(leftRoot, aLeft, aTop, up && actionCount ? opacity : 0);
        // The window's own copies of the buttons, only while these are usable.
        if (up) win.classList.toggle('fw-actions-out', actionCount > 0 && opacity >= 0.5);
        if (!up) return;

        // The open flight's flown path, as the switch says, whenever its
        // layer is (re)built.
        const layer = host.flownPathLayer(id);
        if (layer && map.getLayer(layer)) {
            const want = pathOn ? 'visible' : 'none';
            if (map.getLayoutProperty(layer, 'visibility') !== want) map.setLayoutProperty(layer, 'visibility', want);
        }

        if (chasing) holdChase();
        else recentre(false);
    }

    function setLayout(el, layout) {
        if (el.classList.contains(layout)) return;
        el.classList.remove('vertical', 'horizontal');
        el.classList.add(layout);
        lastKey = '';
    }

    function place(el, left, top, opacity) {
        el.style.left = `${Math.round(left)}px`;
        el.style.top = `${Math.round(top)}px`;
        el.style.opacity = String(opacity);
        el.classList.toggle('shown', opacity > 0);
        el.classList.toggle('faded', opacity < 0.5);
    }

    // --- Public ------------------------------------------------------------

    function init(m, h) {
        if (map) return;
        map = m;
        host = h;
        build();
        // Dragging the map away is letting go of the aeroplane.
        map.on('dragstart', () => {
            if (following) { following = false; setChasing(false); lastKey = ''; }
        });
        frame = requestAnimationFrame(tick);
    }

    function isFollowing() { return following; }

    return { init, isFollowing };
})();
