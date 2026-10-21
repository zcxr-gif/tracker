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
 *     starts behind the tail and stays in the middle of the part of the map
 *     the window and these controls leave free; zooming (more finely than
 *     usual, and never so far that the camera passes it)
 *     zooms into it, a drag or a twist goes round it, and the camera turns
 *     with it so the view you chose holds as it turns;
 * And under it, on a button of its own, 3D/2D for the 3D aircraft.
 *
 * Above them, a second piece of glass with the window's own buttons — pin
 * (desktop), "this is my flight", path info, replay and the trip card —
 * moved off its photograph. Each one presses the window's real button, so
 * every flow behind them is the window's own. While the column is showing,
 * the window's copies are hidden (`fw-actions-out`); when it fades away over
 * a sheet opened all the way, they come back inside the window.
 *
 * Both pieces tuck away behind the window, and pull back out, by a tab on
 * the window's edge: tapped, it slides them in or out; dragged, they follow
 * the finger and settle whichever way they are nearer. They slide towards
 * the window and are cut off at its edge as they go, so they read as going
 * behind it — down behind the sheet on a phone, sideways behind the window
 * on desktop. Kept from one flight to the next while the page is open, but
 * never remembered past it: every visit starts with them out. On a phone,
 * pulling the sheet down brings them back out too.
 *
 * Where it stands is read from the window on every frame, so it follows it
 * exactly however the window moves:
 *   - phone, where the window is a sheet on the bottom edge: the map
 *     controls on the sheet's top right-hand corner and the window's buttons
 *     on its top left-hand one, both riding it down while it is pulled and
 *     faded as it opens towards the full window (gone by about two thirds of
 *     the way). Both always stand upright, never on their side;
 *   - desktop: beside the window, on the side facing the map, under the
 *     tab at its top — the window's buttons first, the map controls under
 *     them.
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
    // Set once the tab has shown, the one time, what it does.
    const HINTED_KEY = 'flightWindowControlsHinted';
    const WIDTH = 46;
    const ROW = 42;
    const GAP = 10;
    // After a zoom, a twist or an ease, the aeroplane has flown on from the
    // middle: the camera glides back on to it over this long, not in a jump.
    const SETTLE_MS = 600;
    // Locked on, the camera turns with the aeroplane through this much
    // smoothing (seconds), so a turn reported in steps is ridden as one.
    const CHASE_HEADING_TAU = 1.2;
    // The tab the controls are tucked and pulled by: lying along the top of
    // a phone's sheet, standing against the side of the window on desktop.
    const TAB_LONG = 56;
    const TAB_SHORT = 20;
    // How fast a tap slides them all the way in or out (time constant, s).
    const TUCK_TAU = 0.07;
    // The one reminder that they tuck away: how long the window has to have
    // been settled with them showing first, and how long it lasts (s).
    const HINT_DELAY_MS = 1500;
    const HINT_S = 1.4;

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
    // The aeroplane's heading as the locked-on camera turns with it.
    let chaseHeading = null;
    let chaseHeadingT = 0;
    // The gap between the camera and the aeroplane when the camera last let
    // go of it, being eased out: { lon, lat, t0 }. null while it is let go.
    let settle = null;
    // A one-finger (or mouse) drag going round the aeroplane.
    let orbit = null;
    // The map's own gestures as they were before the camera locked on.
    let savedHandlers = null;
    // The map's zooming as it was before following began: its deepest zoom
    // and how a pinch pivots. null while not following.
    let zoomLock = null;
    // Closest the camera comes to the aeroplane, as a share of how far the
    // map's centre is beyond it and in metres. Mapbox clips anything nearer
    // than 1/75 of the distance to the centre, but close up the 3D engine
    // draws the aeroplane with a near plane fifty times nearer of its own
    // (aircraftEngine.js), so the camera can come alongside: about 45 m from
    // the middle of the model, wherever it is.
    const CHASE_CLEARANCE_SHARE = 0.0015;
    const CHASE_CLEARANCE_MIN_M = 45;
    // Following, the wheel zooms on the aeroplane by its distance from the
    // camera: a notch of a mouse wheel (100 px) brings it about 30%
    // closer, at any range — in Mapbox's zoom, all the way from far off to
    // alongside a cruising airliner is under one level, so zoom steps are no
    // use there. A trackpad pinch arrives as ctrl-wheel in small steps.
    const WHEEL_LOG2_PER_PX = 1 / 200;
    const PINCH_LOG2_PER_PX = 1 / 60;
    // How quickly the camera closes on the distance the wheel asked for (s).
    const ZOOM_TAU = 0.12;
    // The distance (log2 metres) the wheel has asked for, while it is being
    // flown to; null once there.
    let zoomTarget = null;
    let zoomT = 0;
    // A pinch asks for its distance outright, under the fingers; the wheel's
    // is eased to.
    let zoomDirect = false;
    // The camera's distance from the aeroplane (log2 metres), held from frame
    // to frame while following, so a tilt or a climb does not swing the
    // zoom; null when it is to be read afresh from the map (after a move).
    let heldDist = null;
    // A two-finger pinch or twist while following, taken over from Mapbox:
    // { span, angle } of the fingers last seen. `ownTouches` while any finger
    // of it is still down.
    let pinch = null;
    let ownTouches = false;
    // Pointers down on the map. Every frame's jump would cancel Mapbox's
    // drag before it began, and a drag is how a follow is let go of: so
    // while one is down, the follow (without the lock-on) waits to see.
    const pressed = new Set();
    // A twist while following without the lock-on, still to be turned.
    let followTurn = 0;
    // Following, the tilt is held to this (iOS followTiltLimit): further
    // over, the map's centre runs off a hundred kilometres beyond an
    // aeroplane at cruise and the slightest move swings the view about.
    const FOLLOW_TILT_LIMIT = 75;
    // The open aeroplane's velocity as it is drawn, in degrees a second, for
    // aiming a glide at where it will be when the glide lands.
    let track = null;   // { id, lon, lat, t, vLon, vLat }
    let followFlight = null;
    // Whether the map's padding (and a chase's bearing) is ours to put back
    // when the camera lets go of the aeroplane: left behind, it held the
    // whole map off to one side after the flight window closed.
    let ownsPadding = false;
    let lastKey = '';
    // Tucked away behind the window, and how far out they are drawn (0 in,
    // 1 out) as they slide; `drag` while the tab is being pulled.
    let tucked = false;
    let shown01 = 1;
    let shownAt = 0;
    let drag = null;
    let tab = null;
    // Where the tab and the slide stood last frame, for a drag to read.
    let slide = { axis: 'y', out: -1, travel: 1, side: 'right' };

    // The reminder: shown once in this browser's life, never again after.
    let hinted = false;
    let hint = null;
    let hintReadySince = 0;

    // Tucked used to be remembered across visits; it no longer is.
    try { localStorage.removeItem('flightWindowControlsTucked'); } catch (_) {}
    try { hinted = localStorage.getItem(HINTED_KEY) === '1'; } catch (_) {}
    shown01 = tucked ? 0 : 1;

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
            /* The same glass as the map's other buttons (the weather and ATC
               bubbles, MobileLandingChromeUI), a little more solid so it
               holds up over a busy map: one hairline, one soft shadow, and
               the system blue for "on". */
            .fw-controls {
                position: absolute; z-index: 2099; display: flex; gap: 8px;
                align-items: center; pointer-events: none; opacity: 0;
                transition: opacity .22s ease;
                --fw-bg: rgba(30, 30, 32, 0.72);
                --fw-stroke: rgba(255, 255, 255, 0.14);
                --fw-text: #ffffff;
                --fw-hover: rgba(255, 255, 255, 0.08);
                --fw-accent: #0a84ff;
                --fw-on: rgba(10, 132, 255, 0.28);
                --fw-shadow: 0 4px 18px rgba(0, 0, 0, 0.25);
                font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', sans-serif;
            }
            .fw-controls[data-theme="light"] {
                --fw-bg: rgba(245, 245, 247, 0.86);
                --fw-stroke: rgba(0, 0, 0, 0.08);
                --fw-text: #000000;
                --fw-hover: rgba(0, 0, 0, 0.05);
                --fw-accent: #007aff;
                --fw-on: rgba(0, 122, 255, 0.16);
                --fw-shadow: 0 4px 18px rgba(0, 0, 0, 0.10);
            }
            .fw-controls.vertical { flex-direction: column; }
            .fw-controls .fw-main { display: flex; flex-direction: column; align-items: center; gap: 8px; }
            #aircraft-info-window.fw-actions-out .overview-actions { display: none !important; }
            .fw-controls.shown { pointer-events: auto; }
            .fw-controls.faded { pointer-events: none; }
            .fw-controls .fw-glass {
                background: var(--fw-bg);
                backdrop-filter: saturate(180%) blur(30px);
                -webkit-backdrop-filter: saturate(180%) blur(30px);
                border: 0.5px solid var(--fw-stroke);
                box-shadow: var(--fw-shadow);
            }
            .fw-controls .fw-stack {
                display: flex; flex-direction: column; align-items: center;
                width: ${WIDTH}px; padding: 4px 0; border-radius: ${WIDTH / 2}px;
            }
            .fw-controls button {
                appearance: none; border: 0; background: transparent; cursor: pointer;
                color: var(--fw-text); display: flex; align-items: center;
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
            .fw-controls .fw-row:hover::before { background: var(--fw-hover); }
            .fw-controls .fw-row:active { transform: scale(0.92); }
            /* On is a wash of colour, not a block of it. */
            .fw-controls .fw-row.on::before { background: var(--fw-on); }
            .fw-controls .fw-row.on { color: var(--fw-accent); }
            /* The tab they are tucked and pulled by, against the window. */
            .fw-tab {
                position: absolute; z-index: 2100; display: flex; align-items: center;
                justify-content: center; padding: 0; border: 0.5px solid var(--fw-stroke);
                background: var(--fw-bg); color: var(--fw-text); cursor: grab;
                backdrop-filter: saturate(180%) blur(30px);
                -webkit-backdrop-filter: saturate(180%) blur(30px);
                box-shadow: var(--fw-shadow); font-size: 11px; opacity: 0;
                pointer-events: none; touch-action: none; transition: opacity .22s ease;
                --fw-bg: rgba(30, 30, 32, 0.72);
                --fw-stroke: rgba(255, 255, 255, 0.14);
                --fw-text: #ffffff;
                --fw-shadow: 0 4px 18px rgba(0, 0, 0, 0.25);
            }
            .fw-tab[data-theme="light"] {
                --fw-bg: rgba(245, 245, 247, 0.86);
                --fw-stroke: rgba(0, 0, 0, 0.08);
                --fw-text: #000000;
                --fw-shadow: 0 4px 18px rgba(0, 0, 0, 0.10);
            }
            .fw-tab.shown { pointer-events: auto; }
            .fw-tab:active { cursor: grabbing; }
            .fw-tab.along { width: ${TAB_LONG}px; height: ${TAB_SHORT}px; border-radius: 10px 10px 0 0; border-bottom: 0; }
            .fw-tab.beside { width: ${TAB_SHORT}px; height: ${TAB_LONG}px; }
            .fw-tab.beside.on-left { border-radius: 10px 0 0 10px; border-right: 0; }
            .fw-tab.beside.on-right { border-radius: 0 10px 10px 0; border-left: 0; }
            .fw-tab i { transition: transform .2s ease; opacity: .8; }
            /* The one reminder: the tab pulses with the buttons' nudge. */
            .fw-tab.fw-hint { animation: fw-tab-hint ${HINT_S}s ease-in-out; }
            .fw-tab.fw-hint i { opacity: 1; }
            @keyframes fw-tab-hint {
                0%, 100% { transform: none; box-shadow: var(--fw-shadow); }
                25% { transform: scale(1.18); box-shadow: 0 0 0 4px rgba(10, 132, 255, 0.45), var(--fw-shadow); }
                50% { transform: none; }
                72% { transform: scale(1.08); box-shadow: 0 0 0 3px rgba(10, 132, 255, 0.3), var(--fw-shadow); }
            }
            .fw-tab:hover i { opacity: 1; }
            .fw-controls .fw-models {
                width: ${WIDTH}px; height: ${WIDTH}px; border-radius: 50%;
                font: 800 14px/1 ui-rounded, system-ui, sans-serif; letter-spacing: .02em;
            }
            .fw-controls .fw-models:active { transform: scale(0.92); }
            /* 3D on is the map's other "on" bubble: filled with the accent. */
            .fw-controls .fw-models.on { background: var(--fw-accent); border-color: transparent; color: #fff; }
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

        tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'fw-tab along';
        tab.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
        tab.addEventListener('pointerdown', onTabDown);
        tab.addEventListener('pointermove', onTabMove);
        tab.addEventListener('pointerup', onTabUp);
        tab.addEventListener('pointercancel', onTabUp);
        tab.addEventListener('animationend', () => tab.classList.remove('fw-hint'));
        tab.addEventListener('click', (e) => {
            e.stopPropagation();
            // From the keyboard (no pointer pressed it): tuck or pull out.
            if (e.detail === 0) { setTucked(!tucked); haptic(); }
        });

        // Taps on the column are the column's, never the map's.
        for (const el of [root, leftRoot, tab]) {
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
            // Above the sheet.
            pad.bottom = Math.max(pad.bottom, m.bottom - r.top + 16 + extra);
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
        setZoomLock(following);
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
        setZoomLock(true);
        setChasing(true);
        // Behind the tail, the aeroplane in the middle of the free map, and
        // close to it: just short of the nearest the camera may come. The
        // limit is set before the move, so the move is never cut short by it.
        chaseOffset = 0;
        const pitch = Math.min(Math.max(map.getPitch(), 62), FOLLOW_TILT_LIMIT);
        const limit = chaseZoomLimit(plane, pitch);
        map.setMaxZoom(Math.max(limit, map.getZoom()));
        ownsPadding = true;
        map.easeTo({
            center: aimAt(ahead(plane, 0.9), plane[2], pitch), bearing: plane[2], pitch,
            zoom: limit - 0.2, padding: freePadding(),
            duration: 900, essential: true
        });
    }

    // Locks the camera on, or lets it go: a one-finger drag goes round the
    // aeroplane instead of sliding the map away. (Zooming and twisting
    // pivot on it whenever it is followed: see setZoomLock.)
    function setChasing(on) {
        on = !!on;
        if (on === chasing) return;
        chasing = on;
        lastKey = '';
        orbit = null;
        settle = null;
        chaseHeading = null;
        if (on) {
            // Mapbox's own turning and tilting pivot on the map's centre,
            // which with an aeroplane in the air lies far beyond it: the
            // aeroplane swung off and snapped back. Locked on, every drag
            // (left or right button, one finger) goes round the aeroplane.
            savedHandlers = {
                dragPan: map.dragPan.isEnabled(),
                dragRotate: map.dragRotate.isEnabled(),
                touchPitch: map.touchPitch ? map.touchPitch.isEnabled() : false,
                doubleClickZoom: map.doubleClickZoom.isEnabled()
            };
            map.dragPan.disable();
            map.dragRotate.disable();
            if (map.touchPitch) map.touchPitch.disable();
            map.doubleClickZoom.disable();
            map.getCanvasContainer().addEventListener('pointerdown', onOrbitStart);
            map.getCanvasContainer().addEventListener('contextmenu', noMenu);
        } else if (savedHandlers) {
            const h = savedHandlers;
            savedHandlers = null;
            if (h.dragPan) map.dragPan.enable();
            if (h.dragRotate) map.dragRotate.enable();
            if (h.touchPitch && map.touchPitch) map.touchPitch.enable();
            if (h.doubleClickZoom) map.doubleClickZoom.enable();
            map.getCanvasContainer().removeEventListener('pointerdown', onOrbitStart);
            map.getCanvasContainer().removeEventListener('contextmenu', noMenu);
            window.removeEventListener('pointermove', onOrbitMove);
            window.removeEventListener('pointerup', onOrbitEnd);
            window.removeEventListener('pointercancel', onOrbitEnd);
        }
    }

    // --- Going round the aeroplane -----------------------------------------

    const activePointers = new Set();

    function noMenu(e) { if (chasing) e.preventDefault(); }

    function onOrbitStart(e) {
        if (!chasing || (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2)) return;
        activePointers.add(e.pointerId);
        // Two fingers are the pinch and twist, already pivoting on the
        // aeroplane.
        if (activePointers.size > 1) { orbit = null; return; }
        // The drag goes round the aeroplane at the distance the camera is
        // from it now, whatever the tilt does: leaning over at the same map
        // zoom would fly the camera kilometres in or out (or past it).
        const plane = host.aircraft(host.selected());
        const dist = plane ? (heldDist != null ? Math.pow(2, heldDist)
            : Math.max(distanceAtZoom(plane, map.getZoom()), closestDistance(plane))) : null;
        orbit = { id: e.pointerId, x: e.clientX, y: e.clientY, dist };
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
        const bearing = (chaseHeading === null ? plane[2] : chaseHeading) + chaseOffset;
        const pitch = Math.min(Math.max(map.getPitch() - dy * 0.3, 0), FOLLOW_TILT_LIMIT);
        const opts = { center: aimAt(plane, bearing, pitch), bearing, pitch, padding: freePadding() };
        // At the same distance from it: leaning the camera over must not
        // also fly it in or out. The deepest zoom moves with the tilt, so it
        // is set for the new tilt first, or it would clamp the zoom.
        const want = orbit.dist ? Math.max(orbit.dist, closestDistance(plane, pitch)) : null;
        const fit = () => {
            const cap = chaseZoomLimit(plane, pitch);
            if (Math.abs(map.getMaxZoom() - cap) > 1e-3) map.setMaxZoom(cap);
            return Math.min(zoomForDistance(plane, want, pitch), cap);
        };
        if (want) {
            opts.zoom = fit();
            heldDist = Math.log2(want);
        }
        map.jumpTo(opts);
        // Then aimed again from where the camera now really stands, as every
        // other frame is: the first aim, at a tilt the map was not yet at,
        // is along the line of sight only and off by the window's padding —
        // and the zoom put right from the distance measured there.
        for (let i = 0; i < 2; i++) {
            const step = { center: aimAt(plane, bearing, pitch) };
            if (want) step.zoom = fit();
            const c = map.getCenter();
            const moved = Math.abs(norm(step.center[0] - c.lng)) > 1e-9 || Math.abs(step.center[1] - c.lat) > 1e-9;
            if (!moved && (step.zoom == null || Math.abs(step.zoom - map.getZoom()) < 1e-5)) break;
            map.jumpTo(step);
        }
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
    // the free map: where the line from the camera through the aeroplane
    // meets the ground. Taken from where Mapbox's camera actually stands
    // relative to the centre, turned to `bearing`: with the window's padding
    // the camera does not look square at the middle of the free map, and up
    // close to the aeroplane the difference is tens of pixels. At another
    // tilt (a drag going round it), or with no camera to read, along the
    // line of sight by height × tan(tilt).
    function aimAt(plane, bearing, pitch) {
        const h = Math.max(Number(host.height ? host.height(host.selected()) : 0) || 0, 0);
        if (!h || pitch < 0.5) return [plane[0], plane[1]];
        const MC = window.mapboxgl && window.mapboxgl.MercatorCoordinate;
        if (MC && Math.abs(pitch - map.getPitch()) < 0.01) {
            try {
                const cam = cameraPosition();
                const c = MC.fromLngLat(map.getCenter(), (map.transform && map.transform._centerAltitude) || 0);
                const oz = cam ? cam.z - c.z : 0;
                if (cam && oz > 0) {
                    const turn = (bearing - map.getBearing()) * Math.PI / 180;
                    const ox0 = cam.x - c.x, oy0 = cam.y - c.y;
                    const ox = ox0 * Math.cos(turn) - oy0 * Math.sin(turn);
                    const oy = ox0 * Math.sin(turn) + oy0 * Math.cos(turn);
                    const p = MC.fromLngLat([plane[0], plane[1]], 0);
                    const t = h * p.meterInMercatorCoordinateUnits() / oz;
                    const ll = new MC(p.x - t * ox, p.y - t * oy, 0).toLngLat();
                    if (Number.isFinite(ll.lng) && Number.isFinite(ll.lat)) return [ll.lng, ll.lat];
                }
            } catch (_) { /* fall back to the flat estimate */ }
        }
        const d = h * Math.tan(Math.min(pitch, 85) * Math.PI / 180);
        const b = bearing * Math.PI / 180;
        const lat = plane[1] * Math.PI / 180;
        const dLat = (d * Math.cos(b)) / 111320;
        const dLon = (d * Math.sin(b)) / (111320 * Math.max(Math.cos(lat), 0.01));
        return [plane[0] + dLon, plane[1] + dLat];
    }

    // Where the open aeroplane will be drawn `seconds` from now, at the
    // velocity it is drawn moving at (iOS TrackerMapView.ahead): a glide
    // onto it lands on it, not where it was when the glide began.
    function ahead(plane, seconds) {
        if (!track || track.id !== host.selected()) return plane;
        return [plane[0] + track.vLon * seconds, plane[1] + track.vLat * seconds, plane[2]];
    }

    function noteTrack() {
        const id = host.selected();
        const plane = id != null ? host.aircraft(id) : null;
        if (!plane) { track = null; return; }
        const now = performance.now();
        if (!track || track.id !== id) {
            track = { id, lon: plane[0], lat: plane[1], t: now, vLon: 0, vLat: 0 };
            return;
        }
        const dt = (now - track.t) / 1000;
        if (dt < 0.03) return;
        const vLon = norm(plane[0] - track.lon) / dt, vLat = (plane[1] - track.lat) / dt;
        const k = dt > 1 ? 1 : 0.5;
        track.vLon += (vLon - track.vLon) * k;
        track.vLat += (vLat - track.vLat) * k;
        track.lon = plane[0]; track.lat = plane[1]; track.t = now;
    }

    function norm(deg) {
        return ((deg + 540) % 360) - 180;
    }

    // Where to put the map's centre this frame to hold `target` there: the
    // target itself, once any gap left by the last time the camera let go
    // (a zoom, a twist, an ease, all of which the aeroplane flies on
    // through) has been eased out.
    function settled(target) {
        const now = performance.now();
        if (!settle) {
            const c = map.getCenter();
            settle = { lon: norm(c.lng - target[0]), lat: c.lat - target[1], t0: now };
        }
        const u = Math.min(Math.max((now - settle.t0) / SETTLE_MS, 0), 1);
        const w = 1 - u * u * (3 - 2 * u);
        if (w <= 0) return target;
        return [target[0] + settle.lon * w, target[1] + settle.lat * w];
    }

    // The map on `target` with `padding` (and `bearing` and `zoom`, if
    // given), unless it is already there.
    function holdAt(target, padding, bearing, zoom) {
        const now = map.getPadding();
        const padMoved = ['top', 'bottom', 'left', 'right'].some((k) => Math.abs((now[k] || 0) - padding[k]) > 1);
        // Compared on the ground, to the millimetre, not in pixels: looking
        // down a tilted map at an aeroplane in the air the centre lies far
        // beyond it, near the horizon, where a step that moves the aeroplane
        // ten pixels moves the centre less than one.
        const c = map.getCenter();
        const moved = Math.abs(norm(target[0] - c.lng)) > 1e-8 || Math.abs(target[1] - c.lat) > 1e-8;
        const turned = bearing != null && Math.abs(norm(map.getBearing() - bearing)) >= 0.01;
        const zoomed = zoom != null && Math.abs(map.getZoom() - zoom) >= 1e-4;
        if (!padMoved && !turned && !zoomed && !moved) return;
        const opts = { center: target, padding };
        ownsPadding = true;
        if (bearing != null) opts.bearing = bearing;
        if (zoomed) opts.zoom = Math.min(zoom, map.getMaxZoom());
        map.jumpTo(opts);
    }

    // The aeroplane's heading smoothed for the locked-on camera to turn with.
    function smoothHeading(heading) {
        const now = performance.now();
        if (chaseHeading === null) {
            chaseHeading = heading;
        } else {
            const dt = Math.min(Math.max((now - chaseHeadingT) / 1000, 0), 0.25);
            const k = 1 - Math.exp(-dt / CHASE_HEADING_TAU);
            chaseHeading = (chaseHeading + norm(heading - chaseHeading) * k + 360) % 360;
        }
        chaseHeadingT = now;
        return chaseHeading;
    }

    // Mapbox's camera always looks at a point on the ground, and the
    // aeroplane is on the line of sight to it, `height / cos(tilt)` short of
    // it. Zoom in far enough and the camera passes the aeroplane, or comes
    // inside the distance Mapbox clips at, and the aeroplane is gone. So
    // while locked on, the deepest zoom is the one that leaves the camera a
    // safe distance short of it.
    function chaseZoomLimit(plane, atPitch = map.getPitch()) {
        const zoom = zoomForDistance(plane, closestDistance(plane, atPitch), atPitch);
        return Math.min(Math.max(zoom, 3), zoomLock ? zoomLock.maxZoom : 22);
    }

    // How far the map's centre lies beyond the aeroplane along the line of
    // sight, in metres: nothing for an aeroplane drawn on the ground.
    function beyondPlane(atPitch) {
        const h = Math.max(Number(host.height ? host.height(host.selected()) : 0) || 0, 0);
        const pitch = Math.min(atPitch, 85) * Math.PI / 180;
        return h / Math.max(Math.cos(pitch), 0.05);
    }

    // The nearest the camera may come to the aeroplane, in metres.
    function closestDistance(plane, atPitch = map.getPitch()) {
        return Math.max(beyondPlane(atPitch) * CHASE_CLEARANCE_SHARE, CHASE_CLEARANCE_MIN_M);
    }

    // Metres per pixel of Mapbox's camera distance at the aeroplane's
    // latitude, times 2^zoom.
    function cameraMetresAtZoom0(plane) {
        const tr = map.transform;
        const height = map.getContainer().clientHeight || 600;
        const cameraPx = (tr && tr.cameraToCenterDistance) || 0.5 / Math.tan(0.6435 / 2) * height;
        const lat = plane[1] * Math.PI / 180;
        return cameraPx * 40075016.686 * Math.max(Math.cos(lat), 0.01) / 512;
    }

    // Where the camera stands, in mercator units: Mapbox says; MapLibre
    // (the free map) is asked for the ground under it and how high above
    // the centre it is, in the same units its custom layers draw in. Null
    // where it cannot be read, or on Mapbox's globe, which is not flat.
    function cameraPosition() {
        if (typeof map.getFreeCameraOptions === 'function') {
            if (map.getProjection && map.getProjection().name === 'globe' && map.getZoom() < 6) return null;
            return map.getFreeCameraOptions().position || null;
        }
        const tr = map.transform;
        if (!tr || typeof tr.getCameraPoint !== 'function' || typeof tr.pointCoordinate !== 'function' || !tr.worldSize) return null;
        const ground = tr.pointCoordinate(tr.getCameraPoint());
        const z = Math.cos(map.getPitch() * Math.PI / 180) * tr.cameraToCenterDistance / tr.worldSize;
        return ground && Number.isFinite(ground.x) && Number.isFinite(z) ? { x: ground.x, y: ground.y, z } : null;
    }

    // How far the camera really is from the aeroplane, in metres, read
    // from where the map has put it; null where it cannot be read.
    function measuredDistance(plane) {
        const MC = window.mapboxgl && window.mapboxgl.MercatorCoordinate;
        if (!MC) return null;
        try {
            const cam = cameraPosition();
            if (!cam) return null;
            const h = Math.max(Number(host.height ? host.height(host.selected()) : 0) || 0, 0);
            const p = MC.fromLngLat([plane[0], plane[1]], h);
            const d = Math.hypot(cam.x - p.x, cam.y - p.y, cam.z - p.z) / p.meterInMercatorCoordinateUnits();
            return Number.isFinite(d) ? d : null;
        } catch (_) {
            return null;
        }
    }

    // How far the centre lies beyond the aeroplane, as the zoom sums count
    // it. At the map's own tilt it is measured: up close the camera's
    // distance is the small difference of two long ones (tens of
    // kilometres to the centre, less that to the aeroplane), and the
    // estimate's fraction of a percent is the whole of it — the camera
    // jumping in and out as the drag tilts it.
    function beyondAt(plane, atPitch) {
        if (Math.abs(atPitch - map.getPitch()) < 0.01) {
            const d = measuredDistance(plane);
            if (d != null) return cameraMetresAtZoom0(plane) / Math.pow(2, map.getZoom()) - d;
        }
        return beyondPlane(atPitch);
    }

    // The zoom that puts the camera `dist` metres from the aeroplane, and
    // the camera's distance from it at a zoom.
    function zoomForDistance(plane, dist, atPitch = map.getPitch()) {
        return Math.log2(cameraMetresAtZoom0(plane) / (dist + beyondAt(plane, atPitch)));
    }
    function distanceAtZoom(plane, zoom, atPitch = map.getPitch()) {
        return cameraMetresAtZoom0(plane) / Math.pow(2, zoom) - beyondAt(plane, atPitch);
    }

    // While following: Mapbox's deepest zoom held to the closest approach
    // with a 3D aeroplane (iOS limitFollowZoom), and back to the map's own
    // without. Lowering it under the current zoom moves the camera, which
    // would cut a move or a gesture short: that waits until it is over.
    function limitZoom(plane) {
        if (!zoomLock) return;
        const h = Number(host.height ? host.height(host.selected()) : 0) || 0;
        const limit = h > 0 ? chaseZoomLimit(plane) : zoomLock.maxZoom;
        const allowed = map.isMoving() && map.getZoom() > limit ? map.getZoom() : limit;
        if (Math.abs(map.getMaxZoom() - allowed) > 0.02) map.setMaxZoom(allowed);
    }

    // Following, a pinch pivots on the middle of the free map, where the
    // aeroplane is, rather than on the fingers (iOS gestures.focalPoint);
    // the wheel is taken over by onWheel. Put back as it was on letting go.
    function setZoomLock(on) {
        if (!!on === !!zoomLock) return;
        zoomTarget = null;
        zoomDirect = false;
        heldDist = null;
        pinch = null;
        followTurn = 0;
        if (on) {
            zoomLock = {
                maxZoom: map.getMaxZoom(),
                maxPitch: map.getMaxPitch(),
                touchZoomRotate: map.touchZoomRotate.isEnabled()
            };
            if (zoomLock.touchZoomRotate) map.touchZoomRotate.enable({ around: 'center' });
            map.setMaxPitch(Math.min(zoomLock.maxPitch, FOLLOW_TILT_LIMIT));
        } else {
            const z = zoomLock;
            zoomLock = null;
            if (z.touchZoomRotate) map.touchZoomRotate.enable();
            map.setMaxZoom(z.maxZoom);
            map.setMaxPitch(z.maxPitch);
        }
    }

    // The distance the camera is being held at, or is on its way to.
    function wantedDistance(plane) {
        if (zoomTarget != null) return zoomTarget;
        if (heldDist != null) return heldDist;
        return Math.log2(Math.max(distanceAtZoom(plane, map.getZoom()), closestDistance(plane)));
    }

    // How near and how far the camera may be asked to go (log2 metres).
    function distanceRange(plane) {
        const near = Math.log2(closestDistance(plane));
        const far = Math.log2(Math.max(distanceAtZoom(plane, Math.max(map.getMinZoom(), 2)), closestDistance(plane) * 2));
        return [near, far];
    }

    // --- A pinch while following -----------------------------------------
    //
    // Taken over from Mapbox, whose pinch zooms in its own zoom steps — and
    // close to an aeroplane in the air the whole way from far off to
    // alongside it is under one of those, so the slightest pinch flung the
    // camera in or out — and whose pinch stops the follow while it lasts.
    // Here spreading the fingers brings the camera closer by the share they
    // spread, and a twist turns it round the aeroplane, which stays held in
    // the middle all the while.

    function fingers(touches) {
        const a = touches[0], b = touches[1];
        return {
            span: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
            angle: Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX) * 180 / Math.PI
        };
    }

    function onTouchStart(e) {
        if (ownTouches) { e.preventDefault(); e.stopPropagation(); }
        if (!following || !zoomLock || host.selected() == null || e.touches.length < 2) return;
        ownTouches = true;
        orbit = null;
        pinch = fingers(e.touches);
        e.preventDefault();
        e.stopPropagation();
    }

    function onTouchMove(e) {
        if (!ownTouches) return;
        e.preventDefault();
        e.stopPropagation();
        if (!pinch || e.touches.length < 2) return;
        const plane = host.aircraft(host.selected());
        if (!plane) return;
        const now = fingers(e.touches);
        if (now.span > 0 && pinch.span > 0) {
            const [near, far] = distanceRange(plane);
            zoomTarget = Math.min(Math.max(wantedDistance(plane) + Math.log2(pinch.span / now.span), near), far);
            zoomDirect = true;
        }
        // The map turns with the fingers.
        const turn = norm(now.angle - pinch.angle);
        if (chasing) chaseOffset = norm(chaseOffset - turn);
        else followTurn -= turn;
        pinch = now;
    }

    // Let through, so Mapbox lets go of any touch it was holding.
    function onTouchEnd(e) {
        if (!ownTouches) return;
        if (e.touches.length < 2) pinch = null;
        if (e.touches.length === 0) ownTouches = false;
    }

    // The wheel, while following: the camera moves towards or away from the
    // aeroplane by a share of its distance, and the aeroplane stays in the
    // middle — Mapbox's own wheel zooms about the pointer, and in zoom
    // steps that are far too coarse close to an aeroplane in the air.
    function onWheel(e) {
        if (!following || !zoomLock || host.selected() == null) return;
        const plane = host.aircraft(host.selected());
        if (!plane) return;
        e.preventDefault();
        e.stopPropagation();
        const px = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1);
        const [near, far] = distanceRange(plane);
        zoomTarget = Math.min(Math.max(wantedDistance(plane) + px * (e.ctrlKey ? PINCH_LOG2_PER_PX : WHEEL_LOG2_PER_PX), near), far);
        zoomDirect = false;
    }

    // This frame's zoom: the camera held at its distance from the aeroplane,
    // on its way to the one the wheel or a pinch asked for, and never nearer
    // than the closest approach.
    function zoomStep(plane) {
        const now = performance.now();
        const dt = Math.min(Math.max((now - zoomT) / 1000, 0), 0.1);
        zoomT = now;
        const near = Math.log2(closestDistance(plane));
        if (heldDist == null) heldDist = Math.log2(Math.max(distanceAtZoom(plane, map.getZoom()), closestDistance(plane)));
        if (zoomTarget != null) {
            const gap = Math.max(zoomTarget, near) - heldDist;
            if (zoomDirect || Math.abs(gap) < 0.003) {
                heldDist += gap;
                zoomTarget = null;
                zoomDirect = false;
            } else {
                heldDist += gap * (1 - Math.exp(-dt / ZOOM_TAU));
            }
        }
        heldDist = Math.max(heldDist, near);
        return zoomForDistance(plane, Math.pow(2, heldDist));
    }

    // Every frame while the camera is locked on: the aeroplane back in the
    // middle and the camera turned with it — except while the map's own
    // gestures are under way (a pinch, a twist, a wheel easing out), which
    // a jump would cut short. Those pivot on the middle anyway; a twist is
    // read back as the new place round the aeroplane.
    function holdChase() {
        const plane = host.aircraft(host.selected());
        if (!plane) return;
        limitZoom(plane);
        const heading = smoothHeading(plane[2]);
        if (map.isMoving() || orbit) {
            settle = null;
            if (!orbit) { chaseOffset = norm(map.getBearing() - heading); heldDist = null; }
            return;
        }
        const want = heading + chaseOffset;
        // In the middle of the map the window leaves free, not of the screen.
        holdAt(settled(aimAt(plane, want, map.getPitch())), freePadding(), want, zoomStep(plane));
    }

    function toggleModels() {
        const on = !host.models.isOn();
        host.models.set(on);
        // 3D leans the map over to stand the aeroplanes up; 2D lays it back
        // down flat.
        if (on && map.getPitch() < 40) map.easeTo({ pitch: 55, duration: 700 });
        if (!on) {
            // Flat again: level, north up, and the whole map back in the
            // middle of the screen.
            setChasing(false);
            const opts = { pitch: 0, bearing: 0, duration: 700 };
            if (!following) { opts.padding = NO_PADDING; ownsPadding = false; }
            map.easeTo(opts);
        }
        lastKey = '';
    }

    // Following: the aeroplane held in the middle of the free map every
    // frame, gliding with it — except while the map's own gestures or an
    // ease are under way, which a jump would cut short; the gap they leave
    // is glided out after (see settled).
    function recentre(force) {
        const id = host.selected();
        if (!following || chasing || id == null) return;
        const plane = host.aircraft(id);
        if (!plane) return;
        const padding = freePadding();
        if (force) {
            settle = null;
            ownsPadding = true;
            map.easeTo({ center: aimAt(ahead(plane, 0.8), map.getBearing(), map.getPitch()), padding, duration: 800, essential: true });
            return;
        }
        limitZoom(plane);
        if (map.isMoving() || (pressed.size && !ownTouches)) { settle = null; heldDist = null; return; }
        const bearing = followTurn ? map.getBearing() + followTurn : undefined;
        followTurn = 0;
        const aim = aimAt(plane, bearing != null ? bearing : map.getBearing(), map.getPitch());
        holdAt(settled(aim), padding, bearing, zoomStep(plane));
    }

    // --- Every frame -------------------------------------------------------

    const NO_PADDING = { top: 0, bottom: 0, left: 0, right: 0 };

    // The camera has let go of the aeroplane: the map's padding put back, so
    // the map is centred on the screen again rather than on the gap the
    // window left.
    function releasePadding() {
        if (!ownsPadding || following || chasing || map.isMoving()) return;
        ownsPadding = false;
        const p = map.getPadding();
        if (['top', 'bottom', 'left', 'right'].some((k) => (p[k] || 0) !== 0)) {
            map.easeTo({ padding: NO_PADDING, duration: 500, essential: true });
        }
    }

    function tick() {
        frame = requestAnimationFrame(tick);
        releasePadding();
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
        setZoomLock(following && up);
        noteTrack();
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

        const flightRows = up ? (modelsOn ? 4 : 3) : 0;
        const rowsShown = (turned ? 1 : 0) + flightRows;
        const modelsShown = host.models.available();
        const mainHeight = (rowsShown ? rowsShown * ROW + 8 : 0) + (modelsShown ? WIDTH + (rowsShown ? 8 : 0) : 0);
        const actionsHeight = actionCount ? actionCount * ROW + 8 : 0;

        let layout = 'vertical', leftLayout = 'vertical';
        let left = 0, top = 0, opacity = 1;
        let aLeft = 0, aTop = 0;
        let shown = true;
        // Tucked behind the window: how far out they are drawn, and where
        // each is cut off (clip-path insets, in its own pixels).
        const out = up ? stepTuck() : 1;
        let clip = '', aClip = '';
        let tabLeft = 0, tabTop = 0, tabKind = 'along', tabIcon = 'down';

        if (up) {
            const r = win.getBoundingClientRect();
            if (mobile) {
                // Each always stands upright above the sheet, however many
                // buttons it has (3D adds two); never on its side.
                setLayout(root, 'vertical');
                setLayout(leftRoot, 'vertical');
                root.style.maxWidth = leftRoot.style.maxWidth = '';
                // Above the tab, which lies along the middle of the sheet's
                // top; down behind the sheet as they are tucked away.
                const edge = r.top - c.top;
                const h = root.offsetHeight || WIDTH, ah = leftRoot.offsetHeight || WIDTH;
                left = c.width - 12 - (root.offsetWidth || WIDTH);
                top = edge - GAP - TAB_SHORT - h;
                aLeft = 12;
                aTop = edge - GAP - TAB_SHORT - ah;
                slide = { axis: 'y', out: -1, travel: edge - Math.min(top, aTop), side: 'bottom' };
                top += (1 - out) * (edge - top);
                aTop += (1 - out) * (edge - aTop);
                clip = cutOff(0, 0, top + h - edge, 0);
                aClip = cutOff(0, 0, aTop + ah - edge, 0);
                tabLeft = c.width / 2 - TAB_LONG / 2;
                tabTop = edge - TAB_SHORT;
                tabIcon = tucked ? 'up' : 'down';
                // Faded over the first part of the opening, so nothing is left
                // hanging half there over a window that has nearly arrived.
                const peekTop = window.innerHeight - (window.MobileUIHandler?.getPeekHeight?.() || 320);
                const fullTop = window.innerHeight - r.height;
                const span = Math.max(peekTop - fullTop, 1);
                const openness = Math.min(Math.max((peekTop - r.top) / span, 0), 1);
                opacity = Math.max(0, 1 - openness * 1.6);
                if (edge - GAP - TAB_SHORT - Math.max(h, ah) < 8) opacity = 0;
                // Tucked stays tucked as the sheet moves between its stops:
                // only the tab brings them back out.
            } else {
                setLayout(root, 'vertical');
                setLayout(leftRoot, 'vertical');
                root.style.maxWidth = leftRoot.style.maxWidth = '';
                // The tab stands against the window's side at the top, just
                // below where its rounded corner ends, so it meets a straight
                // edge; the controls stand close beside the window under it,
                // and slide sideways behind it as they are tucked away.
                const onRight = r.left + r.width / 2 > c.left + c.width / 2;
                const edge = onRight ? r.left - c.left : r.right - c.left;
                const tabAt = r.top - c.top + cornerRadius(win, onRight);
                const outLeft = onRight ? edge - GAP - WIDTH : edge + GAP;
                if (outLeft < 4 || outLeft + WIDTH > c.width - 4) opacity = 0;
                const travel = onRight ? edge - outLeft : outLeft + WIDTH - edge;
                left = aLeft = outLeft + (onRight ? 1 : -1) * (1 - out) * travel;
                aTop = tabAt + TAB_LONG + 8;
                top = aTop + (actionCount ? (leftRoot.offsetHeight || actionsHeight) + 8 : 0);
                const cut = onRight ? Math.max(0, left + WIDTH - edge) : Math.max(0, edge - left);
                clip = aClip = onRight ? cutOff(0, cut, 0, 0) : cutOff(0, 0, 0, cut);
                slide = { axis: 'x', out: onRight ? -1 : 1, travel, side: onRight ? 'left' : 'right' };
                tabKind = onRight ? 'beside on-left' : 'beside on-right';
                tabLeft = onRight ? edge - TAB_SHORT : edge;
                tabTop = tabAt;
                tabIcon = (tucked ? onRight : !onRight) ? 'left' : 'right';
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

        // The map chrome's light or dark, so these sit with its buttons.
        const chrome = document.querySelector('.ios-chrome[data-theme]');
        const theme = chrome ? chrome.getAttribute('data-theme') : 'dark';
        if (root.getAttribute('data-theme') !== theme) {
            root.setAttribute('data-theme', theme);
            leftRoot.setAttribute('data-theme', theme);
            tab.setAttribute('data-theme', theme);
        }
        const key = [up, turned, tucked, modelsOn, pathOn, following, chasing, layout, leftLayout, actionSig].join('|');
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
            for (const k of ['frame', 'follow', 'path']) rows[k].hidden = !up;
            rows.chase.hidden = !up || !modelsOn;
            rows.follow.classList.toggle('on', following);
            rows.follow.title = following ? 'Stop following this aircraft' : 'Centre on this aircraft and follow it';
            rows.path.classList.toggle('on', pathOn);
            rows.path.title = pathOn ? 'Hide the flown path' : 'Show the flown path';
            rows.chase.classList.toggle('on', chasing);
            rows.chase.title = chasing ? 'Let go of this aircraft' : 'Lock the camera on this aircraft';
            for (const k of ['follow', 'path', 'chase']) rows[k].setAttribute('aria-label', rows[k].title);
            tab.title = tucked ? 'Show the flight controls' : 'Tuck the flight controls away';
            tab.setAttribute('aria-label', tab.title);
            tab.setAttribute('aria-expanded', tucked ? 'false' : 'true');
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

        place(root, left, top, shown ? opacity : 0, clip);
        place(leftRoot, aLeft, aTop, up && actionCount ? opacity : 0, aClip);
        // Not to be pressed while mostly tucked away.
        if (out < 0.5) { root.classList.add('faded'); leftRoot.classList.add('faded'); }
        if (tab.dataset.kind !== tabKind) {
            tab.classList.remove('along', 'beside', 'on-left', 'on-right');
            tab.classList.add(...tabKind.split(' '));
            tab.dataset.kind = tabKind;
        }
        const icon = tab.firstElementChild;
        if (icon && icon.className !== `fa-solid fa-chevron-${tabIcon}`) icon.className = `fa-solid fa-chevron-${tabIcon}`;
        tab.style.left = `${Math.round(tabLeft)}px`;
        tab.style.top = `${Math.round(tabTop)}px`;
        tab.style.opacity = String(up ? opacity : 0);
        tab.classList.toggle('shown', up && opacity >= 0.5);
        maybeHint(up && opacity >= 0.99 && Math.abs(out - (tucked ? 0 : 1)) < 0.01);
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

    // The radius of the window's top corner on the side facing the map, read
    // from its style now and then rather than on every frame.
    let radiusCache = { el: null, side: null, at: 0, px: 0 };
    function cornerRadius(win, onRight) {
        const now = performance.now();
        const c = radiusCache;
        if (c.el !== win || c.side !== onRight || now - c.at > 1000) {
            let px = 0;
            try {
                const cs = getComputedStyle(win);
                px = parseFloat(onRight ? cs.borderTopLeftRadius : cs.borderTopRightRadius) || 0;
            } catch (_) { /* no style to read */ }
            radiusCache = { el: win, side: onRight, at: now, px };
        }
        return radiusCache.px;
    }

    // A clip-path cutting off what has gone behind the window — none at all
    // when nothing has: any clip-path, even one that cuts nothing, stops the
    // glass inside from blurring the map behind it, and it turns see-through.
    function cutOff(t, r, b, l) {
        const px = (v) => Math.max(0, Math.round(v));
        return t > 0.5 || r > 0.5 || b > 0.5 || l > 0.5 ? `inset(${px(t)}px ${px(r)}px ${px(b)}px ${px(l)}px)` : '';
    }

    function place(el, left, top, opacity, clip = '') {
        el.style.left = `${Math.round(left)}px`;
        el.style.top = `${Math.round(top)}px`;
        if (el.style.clipPath !== clip) el.style.clipPath = clip;
        el.style.opacity = String(opacity);
        el.classList.toggle('shown', opacity > 0);
        el.classList.toggle('faded', opacity < 0.5);
    }

    // --- Tucked away behind the window ------------------------------------

    function setTucked(on) {
        tucked = !!on;
        lastKey = '';
    }

    // Pulled by the tab: they follow the finger along the way they slide.
    function onTabDown(e) {
        e.stopPropagation();
        hint = null;
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, from: shown01, moved: 0 };
        try { tab.setPointerCapture(e.pointerId); } catch (_) {}
    }

    function onTabMove(e) {
        if (!drag || e.pointerId !== drag.id) return;
        const d = slide.axis === 'y' ? e.clientY - drag.y : e.clientX - drag.x;
        drag.moved = Math.max(drag.moved, Math.abs(d));
        shown01 = Math.min(Math.max(drag.from + d * slide.out / Math.max(slide.travel, 1), 0), 1);
    }

    function onTabUp(e) {
        if (!drag || e.pointerId !== drag.id) return;
        // A tap tucks them or pulls them out; a drag lets go where it is,
        // and they settle whichever way they are nearer.
        const tap = drag.moved < 5;
        drag = null;
        setTucked(tap ? !tucked : shown01 < 0.5);
        haptic();
    }

    // The one reminder that the tab is there, once the window has been
    // settled with the controls showing for a moment: the buttons nudge
    // towards where the tab would put them and back, and the tab pulses.
    function maybeHint(ready) {
        if (hinted) return;
        if (!ready || drag) { hintReadySince = 0; return; }
        const now = performance.now();
        if (!hintReadySince) { hintReadySince = now; return; }
        if (now - hintReadySince < HINT_DELAY_MS) return;
        hinted = true;
        try { localStorage.setItem(HINTED_KEY, '1'); } catch (_) {}
        hint = { t0: now };
        tab.classList.remove('fw-hint');
        void tab.offsetWidth; // restart the animation
        tab.classList.add('fw-hint');
    }

    // How far out they are drawn this frame: following a drag, or sliding
    // towards where they were left (or nudging, the one time).
    function stepTuck() {
        const now = performance.now();
        const dt = shownAt ? Math.min((now - shownAt) / 1000, 0.1) : 0;
        shownAt = now;
        if (drag) return shown01;
        const want = tucked ? 0 : 1;
        if (hint) {
            // Twice towards the other way and back — towards the window if
            // they are out, out from it if they are tucked — then rest.
            const t = (now - hint.t0) / 1000;
            if (t < HINT_S) {
                const nudge = t < 0.7 ? 0.45 * Math.sin(Math.PI * t / 0.7)
                    : t > 0.85 && t < 1.35 ? 0.2 * Math.sin(Math.PI * (t - 0.85) / 0.5) : 0;
                shown01 = want + (want ? -nudge : nudge);
                return shown01;
            }
            hint = null;
        }
        shown01 += (want - shown01) * (1 - Math.exp(-dt / TUCK_TAU));
        if (Math.abs(want - shown01) < 0.002) shown01 = want;
        return shown01;
    }

    // --- Public ------------------------------------------------------------

    function init(m, h) {
        if (map) return;
        map = m;
        host = h;
        build();
        // Ahead of Mapbox's own wheel handler, which listens further in.
        const el = map.getCanvasContainer();
        el.addEventListener('wheel', onWheel, { capture: true, passive: false });
        el.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
        el.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
        el.addEventListener('touchend', onTouchEnd, { capture: true });
        el.addEventListener('touchcancel', onTouchEnd, { capture: true });
        el.addEventListener('pointerdown', (e) => pressed.add(e.pointerId), { capture: true });
        for (const type of ['pointerup', 'pointercancel']) {
            window.addEventListener(type, (e) => pressed.delete(e.pointerId), { capture: true });
        }
        // Dragging the map away is letting go of the aeroplane.
        map.on('dragstart', () => {
            if (following) { following = false; setChasing(false); lastKey = ''; }
        });
        frame = requestAnimationFrame(tick);
    }

    function isFollowing() { return following; }

    return { init, isFollowing };
})();
