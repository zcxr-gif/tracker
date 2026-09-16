/* =============================================================================
 * crewTileMap.js — the crew centre's route map, on a real slippy basemap.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT THE ONLY MAP
 * ----------------------------------------------
 * crewNetMap.js draws the network itself: a projected coastline, great circles
 * and dots, no library and no network. It exists because the map BEFORE it —
 * MapLibre from a CDN over OpenFreeMap vector tiles — had two third-party hosts
 * in front of it and every way either could fail ended as a black rectangle.
 * That history is the reason this file is written the way it is, and it is
 * worth reading crewNetMap.js's header before changing anything here.
 *
 * What the drawn map cannot do is be a map. It has no cities, no coast detail
 * below about a hundred kilometres, and its zoom is a scaled picture rather
 * than more information. Past a certain zoom there is simply nothing more to
 * see, which is the "buggy zoom" complaint: the control worked, the map had
 * nothing left to give.
 *
 * So there are now two, and the drawn one is the floor rather than the ceiling:
 *
 *   TILES (this file) — Leaflet over Carto's raster basemap. The default.
 *   DRAWN (crewNetMap.js) — the second option, and the automatic fallback.
 *
 * THE THREE OLD FAILURES, AND WHAT IS DIFFERENT NOW
 * ------------------------------------------------
 *   1. THE ENGINE CAME FROM A CDN. It does not any more: Leaflet is vendored in
 *      this repository and loaded from our own origin, so a blocked CDN, an
 *      office proxy and an ad-blocker's host list can no longer decide whether
 *      there is a map. Its stylesheet is inline below for the same reason — a
 *      stylesheet from unpkg is a CDN dependency wearing a different hat, and
 *      without it Leaflet's panes spill out over the page.
 *
 *   2. IT NEEDED WEBGL. It does not any more: these are raster tiles drawn into
 *      ordinary <img> elements, so a phone that will not give up a WebGL
 *      context still gets a map.
 *
 *   3. NOTHING WATCHED FOR "SUCCEEDED BUT EMPTY". The worst old failure was the
 *      one that reported success — the engine loaded, the layers went in, and
 *      not a tile followed. So the only success signal this file trusts is a
 *      TILE ARRIVING. Until one does, a deadline is running; when it expires,
 *      or when enough tiles error, `onUnavailable` fires and the caller puts
 *      the drawn map back. A basemap that never painted is a failure however
 *      cheerfully the library reported otherwise.
 *
 * WHAT IS SHARED WITH THE DRAWN MAP
 * ---------------------------------
 * The great-circle maths. `CrewNetMap.greatCircle` is the one implementation of
 * "where does this aeroplane actually go", and both maps draw the same curve
 * from it — a sector that bends over the pole has to bend the same way on
 * whichever map the reader is looking at. This file therefore requires
 * crewNetMap.js, which is not a burden: it is also the fallback, so a page that
 * cannot load it has no map to fall back to either.
 * ========================================================================== */
(function () {
    'use strict';

    /* Our own origin. See failure (1) above — this is the whole point. */
    var LEAFLET_SRC = '/leaflet.js';

    /* How long a basemap gets to put ONE tile on the screen before we call it
       unavailable and hand over to the drawn map. Long enough for a slow phone
       on a bad connection, short enough that nobody sits looking at an empty
       rectangle wondering whether it is still trying. */
    var TILE_DEADLINE = 7000;
    /* Tiles fail individually all the time — one 404 at the edge of the world
       is not an outage. A basemap that cannot serve this many in a row is. */
    var TILE_ERROR_LIMIT = 8;

    /* Carto's raster basemaps. Positron and Dark Matter are near-greyscale,
       which is what a route map wants: the arcs are the subject and the basemap
       is meant to be underneath them, not competing. Chosen over OpenStreetMap's
       own tiles because OSM's tile policy asks heavy consumers to go elsewhere,
       and this screen is heavy. */
    var TILES = {
        light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    };
    var SUBDOMAINS = 'abcd';
    var MAX_ZOOM = 19;
    var ATTRIB = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
        + ' &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>';

    /* Never fit tighter than this. A VA with one aerodrome on it has no extent
       to fit, and fitting it exactly puts the reader on a runway with no idea
       what country they are in. */
    var FIT_MAX_ZOOM = 9;

    /* ---------------------------------------------------------------------
     * LEAFLET'S STYLESHEET, INLINE
     *
     * The layout half of leaflet.css — panes, tiles, the zoom animation, the
     * controls and the tooltips. Without it every pane is statically positioned
     * and the tile grid unrolls down the page as a column of images.
     *
     * `touch-action:none` on the container is the line that makes zoom work
     * with a finger. Without it the browser claims the pinch for its own page
     * zoom and Leaflet never sees the gesture, which is exactly how the drawn
     * map's zoom came to be "broken" on a phone.
     * ------------------------------------------------------------------- */
    var LEAFLET_CSS = [
        '.leaflet-pane,.leaflet-tile,.leaflet-marker-icon,.leaflet-marker-shadow,.leaflet-tile-container,',
        '.leaflet-pane>svg,.leaflet-pane>canvas,.leaflet-zoom-box,.leaflet-image-layer,.leaflet-layer{',
        'position:absolute;left:0;top:0;}',
        '.leaflet-container{overflow:hidden;position:relative;touch-action:none;',
        '-webkit-tap-highlight-color:transparent;background:transparent;font:inherit;}',
        '.leaflet-tile,.leaflet-marker-icon,.leaflet-marker-shadow{-webkit-user-select:none;user-select:none;',
        '-webkit-user-drag:none;}',
        '.leaflet-tile{filter:inherit;visibility:hidden;}',
        '.leaflet-tile-loaded{visibility:inherit;}',
        '.leaflet-zoom-box{width:0;height:0;box-sizing:border-box;z-index:800;}',
        '.leaflet-overlay-pane svg{-moz-user-select:none;}',
        '.leaflet-tile-pane{z-index:200;}.leaflet-overlay-pane{z-index:400;}',
        '.leaflet-shadow-pane{z-index:500;}.leaflet-marker-pane{z-index:600;}',
        '.leaflet-tooltip-pane{z-index:650;}.leaflet-popup-pane{z-index:700;}',
        '.leaflet-map-pane canvas{z-index:100;}.leaflet-map-pane svg{z-index:200;}',
        '.leaflet-control{position:relative;z-index:800;pointer-events:auto;float:left;clear:both;}',
        '.leaflet-control-container{position:relative;z-index:800;}',
        '.leaflet-top,.leaflet-bottom{position:absolute;z-index:800;pointer-events:none;}',
        '.leaflet-top{top:0;}.leaflet-right{right:0;}.leaflet-bottom{bottom:0;}.leaflet-left{left:0;}',
        '.leaflet-right .leaflet-control{float:right;margin-right:10px;}',
        '.leaflet-left .leaflet-control{margin-left:10px;}',
        '.leaflet-top .leaflet-control{margin-top:10px;}',
        '.leaflet-bottom .leaflet-control{margin-bottom:10px;}',
        /* The zoom animation. Without the transition a zoom is a jump-cut and
           the tiles for the new level arrive over a blank pane. */
        '.leaflet-fade-anim .leaflet-tile{will-change:opacity;}',
        '.leaflet-fade-anim .leaflet-popup{opacity:0;transition:opacity .2s linear;}',
        '.leaflet-fade-anim .leaflet-map-pane .leaflet-popup{opacity:1;}',
        '.leaflet-zoom-animated{transform-origin:0 0;}',
        '.leaflet-zoom-anim .leaflet-zoom-animated{will-change:transform;',
        'transition:transform .25s cubic-bezier(0,0,.25,1);}',
        '.leaflet-zoom-anim .leaflet-tile,.leaflet-pan-anim .leaflet-tile{transition:none;}',
        '.leaflet-zoom-anim .leaflet-zoom-hide{visibility:hidden;}',
        /* Interaction. `.leaflet-grab` is the open hand over the basemap; the
           arcs and dots override it with a pointer of their own. */
        '.leaflet-interactive{cursor:pointer;}',
        '.leaflet-grab{cursor:grab;}',
        '.leaflet-dragging .leaflet-grab,.leaflet-dragging .leaflet-interactive{cursor:grabbing;}',
        '.leaflet-marker-icon,.leaflet-marker-shadow,.leaflet-image-layer,',
        '.leaflet-pane>svg path,.leaflet-tile-container{pointer-events:none;}',
        '.leaflet-pane>svg path.leaflet-interactive{pointer-events:visiblePainted;pointer-events:auto;}',
        '.leaflet-container a{-webkit-tap-highlight-color:rgba(51,181,229,.4);}'
    ].join('');

    /* Our own skin over it: the zoom buttons, the attribution and the airport
       labels, all in the host page's own surface/ink tokens so the map does not
       arrive wearing somebody else's design system. */
    var SKIN = [
        '.ctm-host{position:absolute;inset:0;}',
        '.ctm-host .leaflet-bar{border:1px solid var(--ctm-line);border-radius:.45rem;overflow:hidden;',
        'box-shadow:0 1px 3px rgba(0,0,0,.12);}',
        '.ctm-host .leaflet-bar a{display:block;width:2rem;height:2rem;line-height:2rem;text-align:center;',
        'background:var(--ctm-surface);color:var(--ctm-ink);text-decoration:none;font-weight:600;font-size:1.05rem;}',
        '.ctm-host .leaflet-bar a+a{border-top:1px solid var(--ctm-line);}',
        '.ctm-host .leaflet-bar a:hover{background:var(--ctm-hover);}',
        '.ctm-host .leaflet-bar a.leaflet-disabled{opacity:.4;cursor:default;}',
        '.ctm-host .leaflet-control-attribution{background:var(--ctm-surface);color:var(--ctm-muted);',
        'font-size:10px;line-height:1.4;padding:1px 6px;border-radius:.3rem 0 0 0;}',
        '.ctm-host .leaflet-control-attribution a{color:var(--ctm-muted);text-decoration:underline;}',
        /* The airport code beside its dot. `permanent` tooltips are Leaflet's
           only placed label, and they collide rather than dodging — so only
           hubs carry one on a small screen. */
        '.ctm-host .ctm-label{background:transparent;border:0;box-shadow:none;padding:0;margin:0;',
        'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;font-weight:600;',
        'color:var(--ctm-ink);paint-order:stroke;text-shadow:0 0 3px var(--ctm-halo),0 0 3px var(--ctm-halo),',
        '0 0 3px var(--ctm-halo);white-space:nowrap;pointer-events:none;}',
        '.ctm-host .ctm-label.is-hub{color:var(--ctm-accent);font-size:12px;}',
        '.ctm-host .ctm-label:before{display:none;}'
    ].join('');

    var cssInjected = false;
    function injectCss() {
        if (cssInjected) return;
        cssInjected = true;
        var el = document.createElement('style');
        el.setAttribute('data-crew-tile-map', '');
        el.textContent = LEAFLET_CSS + SKIN;
        document.head.appendChild(el);
    }

    /* ---------------------------------------------------------------------
     * Loading Leaflet. Single-flight: a filter change while it is still in the
     * air must not start a second copy, and a failure is remembered so a map
     * that cannot exist is not retried on every redraw.
     * ------------------------------------------------------------------- */
    var leafletPromise = null;
    function ensureLeaflet() {
        if (window.L && window.L.map) return Promise.resolve(window.L);
        if (leafletPromise) return leafletPromise;
        leafletPromise = new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = LEAFLET_SRC;
            s.async = true;
            s.onload = function () {
                if (window.L && window.L.map) resolve(window.L);
                else reject(new Error('leaflet loaded but is not usable'));
            };
            s.onerror = function () { reject(new Error('leaflet could not be loaded')); };
            document.head.appendChild(s);
        });
        // A rejected promise that stays cached would make every later attempt
        // fail instantly, including one after the reader fixed their network.
        leafletPromise.catch(function () { leafletPromise = null; });
        return leafletPromise;
    }

    /* Everything we hang off a host element, kept out of the DOM so a redraw
       can find the live map rather than rebuilding it. Rebuilding is what makes
       a filter change flash. */
    var STATE = new WeakMap();

    /* ---------------------------------------------------------------------
     * ANTIMERIDIAN, THE EASY WAY
     *
     * The drawn map has to CUT an arc that crosses 180°, because its projection
     * runs out of canvas there. Leaflet does not: longitude past 180 simply
     * continues into the next copy of the world, so unwrapping the sequence —
     * keeping each step within half a turn of the last — gives one unbroken
     * polyline across the seam, and the bounds that come off it are honest
     * about a network that spans the Pacific.
     * ------------------------------------------------------------------- */
    function unwrap(points) {
        var out = [], prev = null, off = 0;
        for (var i = 0; i < points.length; i++) {
            var lon = points[i][1];
            if (prev !== null) {
                var d = lon + off - prev;
                if (d > 180) off -= 360;
                else if (d < -180) off += 360;
            }
            var l = lon + off;
            out.push([points[i][0], l]);
            prev = l;
        }
        return out;
    }

    /* The same curve the drawn map draws — see the header. 64 steps is what the
       drawn map samples an arc at, and matching it keeps the two honest. */
    function arcPoints(a, b) {
        var gc = window.CrewNetMap && window.CrewNetMap.greatCircle;
        if (!gc) return null;
        return unwrap(gc(a, b, 64));
    }

    function themeVars(host, opts) {
        var dark = !!opts.dark;
        var set = function (k, v) { host.style.setProperty(k, v); };
        set('--ctm-accent', opts.accent || '#3b82f6');
        set('--ctm-ink', dark ? '#F3EFE7' : '#1C1A16');
        set('--ctm-surface', dark ? '#1A1815' : '#FFFFFF');
        set('--ctm-line', dark ? '#2E2A24' : '#DAD5CB');
        set('--ctm-muted', dark ? '#8A8477' : '#6E685D');
        set('--ctm-hover', dark ? '#221F1B' : '#F4F1EA');
        set('--ctm-halo', dark ? '#14120F' : '#FFFFFF');
    }

    /* ---------------------------------------------------------------------
     * DRAW
     *
     * Same signature as CrewNetMap.draw so the caller can hold one variable and
     * point it at either. Returns the number of sectors SYNCHRONOUSLY — the
     * caller needs it now, to decide between "no routes" and "no routes match"
     * — while the map itself arrives when Leaflet and the first tile do.
     *
     * `opts.onUnavailable(reason)` is how this file says "use the other map".
     * It fires for a Leaflet that will not load, a basemap that never paints,
     * and a crewNetMap.js that is not there to supply the maths.
     * ------------------------------------------------------------------- */
    function draw(host, opts) {
        opts = opts || {};
        var legs = (opts.routes || []).filter(function (r) {
            return r && Array.isArray(r.o) && Array.isArray(r.d);
        });
        var st = STATE.get(host);
        if (!legs.length) {
            if (st && st.map) clearOverlays(st);
            return 0;
        }
        if (!window.CrewNetMap || !window.CrewNetMap.greatCircle) {
            report(opts, 'the drawing library is not loaded');
            return legs.length;
        }
        injectCss();
        themeVars(host, opts);

        // Remember the latest intent. Leaflet may still be loading, and by the
        // time it lands the reader may have changed the filter twice; what gets
        // drawn is the last thing they asked for, not the first.
        var want = { legs: legs, opts: opts, keepView: !!opts.keepView };
        if (st) st.want = want;

        ensureLeaflet().then(function (L) {
            var s = STATE.get(host);
            if (!s) { s = build(L, host, opts); STATE.set(host, s); }
            var w = s.want || want;
            s.want = null;
            themeVars(host, w.opts);
            setTheme(L, s, w.opts);
            render(L, host, s, w.legs, w.opts, w.keepView);
        }).catch(function (err) {
            report(opts, (err && err.message) || 'the map could not be loaded');
        });
        return legs.length;
    }

    function report(opts, reason) {
        if (typeof opts.onUnavailable === 'function') opts.onUnavailable(reason);
    }

    /* ---------------------------------------------------------------------
     * The map itself, made once per host.
     * ------------------------------------------------------------------- */
    function build(L, host, opts) {
        var el = document.createElement('div');
        el.className = 'ctm-host';
        host.innerHTML = '';
        host.appendChild(el);

        var map = L.map(el, {
            zoomControl: false,
            attributionControl: true,
            // Everything a finger expects. `touchZoom` is the pinch, and it
            // works because the container gives up its touch-action above.
            touchZoom: true,
            doubleClickZoom: true,
            scrollWheelZoom: true,
            dragging: true,
            inertia: true,
            worldCopyJump: true,
            // A route map has no business below the whole world.
            minZoom: 1,
            maxZoom: MAX_ZOOM,
            zoomSnap: 0.25,
            zoomDelta: 0.5,
            preferCanvas: false
        });
        // Bottom-right: the top of this overlay is the title bar and the
        // top-left is the filter row.
        L.control.zoom({ position: 'bottomright' }).addTo(map);
        map.attributionControl.setPrefix('');

        var s = {
            el: el, map: map, tiles: null, theme: null,
            arcs: L.layerGroup().addTo(map),
            dots: L.layerGroup().addTo(map),
            byRoute: {}, byAirport: {},
            painted: false, errors: 0, deadline: null, gaveUp: false,
            want: null, opts: opts
        };

        map.on('click', function () {
            if (typeof s.opts.onBackground === 'function') s.opts.onBackground();
        });
        // Leaflet's own resize handling needs telling when the overlay opens,
        // which the caller does through invalidate().
        return s;
    }

    /* The basemap, swapped when the page's theme does. A tile layer is cheap to
       replace and impossible to recolour, so dark mode is a different layer. */
    function setTheme(L, s, opts) {
        var theme = opts.dark ? 'dark' : 'light';
        if (s.theme === theme && s.tiles) return;
        s.theme = theme;
        if (s.tiles) { s.map.removeLayer(s.tiles); s.tiles = null; }
        var layer = L.tileLayer(TILES[theme], {
            subdomains: SUBDOMAINS,
            maxZoom: MAX_ZOOM,
            // Past Carto's own levels, keep scaling the last real tile rather
            // than showing holes.
            maxNativeZoom: 18,
            detectRetina: true,
            crossOrigin: true,
            attribution: ATTRIB,
            keepBuffer: 2
        });

        /* THE ONLY SUCCESS SIGNAL WE TRUST — see failure (3) in the header. */
        layer.on('tileload', function () {
            s.painted = true;
            s.errors = 0;
            if (s.deadline) { clearTimeout(s.deadline); s.deadline = null; }
        });
        layer.on('tileerror', function () {
            if (s.painted || s.gaveUp) return;
            if (++s.errors >= TILE_ERROR_LIMIT) giveUp(s, 'the basemap could not be reached');
        });
        if (!s.painted) {
            if (s.deadline) clearTimeout(s.deadline);
            s.deadline = setTimeout(function () {
                s.deadline = null;
                if (!s.painted) giveUp(s, 'the basemap did not load');
            }, TILE_DEADLINE);
        }
        layer.addTo(s.map);
        s.tiles = layer;
    }

    function giveUp(s, reason) {
        if (s.gaveUp) return;
        s.gaveUp = true;
        report(s.opts, reason);
    }

    function clearOverlays(s) {
        s.arcs.clearLayers();
        s.dots.clearLayers();
        s.byRoute = {};
        s.byAirport = {};
    }

    /* ---------------------------------------------------------------------
     * The network, onto the map.
     * ------------------------------------------------------------------- */
    function render(L, host, s, legs, opts, keepView) {
        s.opts = opts;
        clearOverlays(s);

        var accent = opts.accent || '#3b82f6';
        var muted = opts.dark ? '#8A8477' : '#6E685D';
        var halo = opts.dark ? '#14120F' : '#FFFFFF';
        var small = (host.clientWidth || 900) < 560;

        // One dot per field, never one per sector — the same rule the drawn map
        // follows, because two sectors into one aerodrome are one place.
        var touch = {}, pos = {};
        var all = [];

        legs.forEach(function (r) {
            var pts = arcPoints(r.o, r.d);
            if (!pts) return;
            all = all.concat(pts);
            touch[r.origin] = (touch[r.origin] || 0) + 1; pos[r.origin] = r.o;
            touch[r.destination] = (touch[r.destination] || 0) + 1; pos[r.destination] = r.d;

            var codeshare = !!r.codeshare, draft = r.active === false;
            // Classed like the drawn map's arcs (cnm-arc / cnm-hit), so either
            // map can be reasoned about — and tested — by the same vocabulary.
            var style = {
                className: 'ctm-arc' + (codeshare ? ' is-share' : '') + (draft ? ' is-draft' : ''),
                color: codeshare || draft ? muted : accent,
                weight: 2.5,
                opacity: draft ? 0.35 : (codeshare ? 0.55 : 0.75),
                dashArray: codeshare ? '7 6' : null,
                lineCap: 'round',
                interactive: false
            };
            var line = L.polyline(pts, style).addTo(s.arcs);

            /* THE SAME TRICK THE DRAWN MAP USES. A 2.5px line is a fine thing
               to look at and a miserable thing to hit with a finger, so every
               sector is drawn twice — once visibly, once as a fat transparent
               stroke that catches the pointer. */
            var hit = L.polyline(pts, {
                className: 'ctm-hit', color: '#000', weight: 16, opacity: 0,
                lineCap: 'round', interactive: true
            }).addTo(s.arcs);

            var id = String(r.id);
            // `base` is remembered rather than re-derived when focus clears. A
            // draft sector and a codeshare are dimmed by different amounts and
            // only one of them is dashed, so reading the opacity back off the
            // dash pattern restored the wrong one.
            s.byRoute[id] = { line: line, hit: hit, o: r.origin, d: r.destination, base: style.opacity };
            hit.on('click', function (e) {
                L.DomEvent.stop(e);
                if (typeof s.opts.onRoute === 'function') s.opts.onRoute(id);
            });
            hit.on('mouseover', function (e) {
                if (typeof s.opts.onHover === 'function') s.opts.onHover({ route: id, airport: '' }, e.originalEvent);
            });
            hit.on('mouseout', function (e) {
                if (typeof s.opts.onHover === 'function') s.opts.onHover(null, e.originalEvent);
            });
        });

        var places = Object.keys(touch);
        var busiest = places.slice().sort(function (a, b) { return touch[b] - touch[a]; });
        var hubs = {};
        busiest.slice(0, Math.min(6, Math.max(1, Math.round(places.length / 4))))
            .forEach(function (i) { hubs[i] = 1; });

        places.forEach(function (icao) {
            var isHub = !!hubs[icao];
            var n = touch[icao];
            var dot = L.circleMarker([pos[icao][0], pos[icao][1]], {
                className: 'ctm-dot' + (isHub ? ' is-hub' : ''),
                radius: isHub ? 6 : 4,
                color: halo,
                weight: isHub ? 2.5 : 1.5,
                fillColor: accent,
                fillOpacity: 1,
                interactive: true
            }).addTo(s.dots);
            dot.bindTooltip(icao, {
                permanent: true, direction: 'top', offset: [0, -4],
                className: 'ctm-label' + (isHub ? ' is-hub' : ''), opacity: 1
            });
            // A phone cannot hold every name without them piling up, so only
            // the bases keep theirs — the same call the drawn map makes.
            if (small && !isHub) dot.unbindTooltip();

            s.byAirport[icao] = dot;
            dot.on('click', function (e) {
                L.DomEvent.stop(e);
                if (typeof s.opts.onAirport === 'function') s.opts.onAirport(icao);
            });
            dot.on('mouseover', function (e) {
                if (typeof s.opts.onHover === 'function') s.opts.onHover({ airport: icao, route: '' }, e.originalEvent);
            });
            dot.on('mouseout', function (e) {
                if (typeof s.opts.onHover === 'function') s.opts.onHover(null, e.originalEvent);
            });
            // The same sentence the drawn map puts in its <title>, for a screen
            // reader and for a long press.
            var path = dot.getElement && dot.getElement();
            if (path) path.setAttribute('aria-label', icao + ' — ' + n + (n === 1 ? ' sector' : ' sectors'));
        });

        s.bounds = all.length ? L.latLngBounds(all) : null;
        if (!keepView || !s.hasView) fit(host);

        // A redraw is new layers, and the focus lived on the old ones. Anything
        // asked for while Leaflet was still loading lands here too.
        if (PENDING.has(host)) { s.focusSpec = PENDING.get(host); PENDING.delete(host); }
        if (s.focusSpec) applyFocus(host, s);
    }

    /* Fit the network, not the world. This is the other half of the "it is too
       far away on a phone" complaint: the drawn map had to inflate its crop to
       the shape of the screen, which shrank the network into a band across the
       middle. Leaflet fits a box to a viewport properly, and the padding is
       per-edge so the title bar and the filter row do not sit on top of the
       airline's own bases. */
    function fit(host) {
        var s = STATE.get(host);
        if (!s || !s.map || !s.bounds || !s.bounds.isValid()) return;
        var small = (host.clientWidth || 900) < 560;
        s.map.fitBounds(s.bounds, {
            // top: the title bar and the filters. bottom: the legend and the
            // attribution. right: the detail rail when it is open.
            paddingTopLeft: [small ? 28 : 56, small ? 96 : 128],
            paddingBottomRight: [small ? 28 : 56, small ? 56 : 72],
            maxZoom: FIT_MAX_ZOOM,
            animate: false
        });
        s.hasView = true;
    }

    /* ---------------------------------------------------------------------
     * FOCUS — one sector, or one field and everything touching it, with the
     * rest dimmed. Same contract as CrewNetMap.focus; done by restyling the
     * layers rather than redrawing, because the drawing is the expensive half
     * and none of it changes.
     * ------------------------------------------------------------------- */
    function focus(host, spec) {
        var s = STATE.get(host);
        // The map may not exist yet — Leaflet is still in the air on a first
        // open. Remembering the spec on the host means a focus asked for before
        // the layers existed is applied to them when they do, rather than
        // silently doing nothing.
        if (!s) { PENDING.set(host, spec || null); return; }
        s.focusSpec = spec || null;
        applyFocus(host, s);
    }
    var PENDING = new WeakMap();

    function applyFocus(host, s) {
        var spec = s.focusSpec;
        if (!s || !s.map) return;
        var route = spec && spec.route != null ? String(spec.route) : '';
        var apt = spec && spec.airport ? String(spec.airport) : '';
        var on = !route && !apt ? null : {};

        Object.keys(s.byRoute).forEach(function (id) {
            var r = s.byRoute[id];
            var lit = !on ? true
                : (route ? id === route : (r.o === apt || r.d === apt));
            if (on && lit) { on[r.o] = 1; on[r.d] = 1; }
            r.line.setStyle({ opacity: !on ? r.base : (lit ? 0.95 : 0.1) });
            if (!on || lit) r.line.bringToFront();
        });
        if (on && apt) on[apt] = 1;
        Object.keys(s.byAirport).forEach(function (icao) {
            var dot = s.byAirport[icao];
            var lit = !on || on[icao];
            dot.setStyle({ opacity: lit ? 1 : 0.28, fillOpacity: lit ? 1 : 0.28 });
            var tip = dot.getTooltip();
            if (tip && tip.getElement()) tip.getElement().style.opacity = lit ? '1' : '0.28';
        });
    }
    /* Leaflet measures its container on creation. This overlay is `hidden`
       until it is opened, so the map is built against a zero-sized box and
       comes up grey until something tells it to look again. */
    function invalidate(host) {
        var s = STATE.get(host);
        if (!s || !s.map) return;
        s.map.invalidateSize({ animate: false });
        if (!s.hasView) fit(host);
    }

    function destroy(host) {
        var s = STATE.get(host);
        if (!s) return;
        if (s.deadline) clearTimeout(s.deadline);
        if (s.map) s.map.remove();
        STATE.delete(host);
        host.innerHTML = '';
    }

    function isLive(host) {
        var s = STATE.get(host);
        return !!(s && s.map && !s.gaveUp);
    }

    window.CrewTileMap = {
        draw: draw,
        focus: focus,
        fit: fit,
        invalidate: invalidate,
        destroy: destroy,
        isLive: isLive
    };
})();
