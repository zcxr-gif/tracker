/* ============================================================================
   crewAircraft3D.js — the aircraft itself, in 3D, in the airline's colours.

     CrewAircraft3D.match(name)               which aircraft this name draws
     CrewAircraft3D.attach(host, name, opts)  on a Console card, turning
     CrewAircraft3D.hero(host, name, opts)    in the Console's hero, flying
         opts.accent   the airline's colour, '#rrggbb' — the livery

   THE AIRCRAFT are built here, not downloaded: each type is a short list of
   its real dimensions (length, fuselage width, span, sweep, chords, where
   the engines hang, how big they are, which wingtip it has) and the code
   lofts smooth surfaces from them — a fuselage of revolution with its nose
   and upswept tail, wings and tail planes from an airfoil section, nacelles
   with their intake, fan and exhaust, pylons, flap-track fairings and the
   wing-body fairing. Built from numbers, every surface is clean, and the
   livery knows exactly where on the aeroplane each point is.

   MATCHING takes whatever the airline typed — an ICAO code ("B38M", "A20N"),
   a name ("Boeing 737-800", "Embraer 175", "A321neo") — and finds its
   family. Where there is no build of the type itself, a close relative of
   the same shape stands in (an A350 is drawn as an A330, an A220 as an E190)
   and `exact` is false. A type with nothing close — a turboprop, a bizjet —
   gets no aircraft.

   THE LIVERY is painted per pixel in the surface's own coordinates (metres
   along the fuselage, angle round it): a white crown, a belly in the
   airline's colour sweeping up to the tail under a darker cheatline, the
   cabin windows at the type's real pitch, door outlines, the flight-deck
   glass, the fin and nacelles in the colour, grey wings, bare-metal intake
   lips and exhausts. Every airline gets a livery; none has to upload one.

   TWO STAGES, at most: the card one and the hero one, each its own WebGL
   renderer (two contexts are fine; dozens are not). three.js is fetched the
   first time either is asked for. They stop drawing when off screen, and
   hold still for a reader who has asked for less motion.
   ========================================================================== */

(function (global) {
    'use strict';

    const THREE_URL = 'https://unpkg.com/three@0.126.0/build/three.min.js';
    const D2R = Math.PI / 180;

    /* ---------------------------------------------------------------------
     * The types, in metres and degrees.
     *
     *   L, D        length; fuselage width (H: height over width)
     *   nose, tail  how long the nose and the tail cone are, in widths
     *   hump        a raised crown to `to` (fraction of L), `h` × radius
     *   wing        x: leading edge at the centreline (fraction of L); span;
     *               kink: where the trailing edge breaks (fraction of the
     *               half-span), with the chord there (ck) and at the tip
     *               (ct); sweep and dihedral; t, tt: thickness at root and
     *               tip; tip: 'raked' | 'blended' (winglet: h, cant, sweep)
     *   stab, fin   likewise; fin.h is its height above the crown, `t`: a
     *               T-tail (the stabiliser on the fin's tip)
     *   eng         r, len: nacelle radius and length; at: where along the
     *               half-span (or `tail`: on the rear fuselage, `centre`:
     *               a third in the fin's root); chev: chevron nozzles
     *   pitch, win  cabin window spacing; window width and height
     *   doors       main doors (fractions of L); deck: an upper deck's
     *               windows run to this fraction
     *   ck          the flight deck's glass: 'std' or '787'
     * ------------------------------------------------------------------- */
    const TYPES = {
        b787: {
            label: 'Boeing 787', L: 62.8, D: 5.77, H: 1.03, nose: 1.6, tail: 2.9, ck: '787',
            wing: { x: 0.355, span: 60.1, kink: 0.33, ck: 7.4, ct: 1.6, sweep: 32, dih: 6.5, t: 0.15, tt: 0.1, tip: 'raked' },
            stab: { x: 0.835, span: 19.8, root: 6.2, ct: 1.7, sweep: 37, dih: 7 },
            fin: { x: 0.79, h: 9.0, root: 9.2, ct: 3.2, sweep: 42 },
            eng: { r: 1.8, len: 7.4, at: [0.33], chev: true },
            pitch: 0.61, win: [0.28, 0.46], doors: [0.12, 0.29, 0.61, 0.865],
        },
        b737: {
            label: 'Boeing 737', L: 39.5, D: 3.76, H: 1.07, nose: 1.75, tail: 2.7, ck: 'std',
            wing: { x: 0.36, span: 34.3, kink: 0.35, ck: 4.5, ct: 1.25, sweep: 25, dih: 6, t: 0.15, tt: 0.11, tip: 'blended', wl: { h: 2.4, cant: 72, sweep: 42 } },
            stab: { x: 0.83, span: 14.4, root: 3.9, ct: 1.1, sweep: 30, dih: 7 },
            fin: { x: 0.775, h: 6.2, root: 6.0, ct: 1.8, sweep: 36 },
            eng: { r: 1.04, len: 4.8, at: [0.285] },
            pitch: 0.508, win: [0.25, 0.36], doors: [0.1, 0.87],
        },
        a320: {
            label: 'Airbus A320', L: 37.57, D: 3.95, H: 1.05, nose: 1.45, tail: 2.6, ck: 'std',
            wing: { x: 0.355, span: 34.1, kink: 0.32, ck: 4.3, ct: 1.5, sweep: 25, dih: 5.1, t: 0.15, tt: 0.11, tip: 'blended', wl: { h: 2.4, cant: 82, sweep: 48, r: 0.9 } },
            stab: { x: 0.835, span: 12.45, root: 3.6, ct: 1.2, sweep: 29, dih: 6 },
            fin: { x: 0.785, h: 5.9, root: 5.8, ct: 2.1, sweep: 34 },
            eng: { r: 1.17, len: 4.9, at: [0.335] },
            pitch: 0.533, win: [0.26, 0.36], doors: [0.095, 0.86],
        },
        b772: {
            label: 'Boeing 777-200', L: 63.7, D: 6.2, nose: 1.5, tail: 2.7, ck: 'std',
            wing: { x: 0.355, span: 60.9, kink: 0.33, ck: 8.4, ct: 1.9, sweep: 31.6, dih: 6, t: 0.15, tt: 0.1, tip: 'raked' },
            stab: { x: 0.84, span: 21.5, root: 7.0, ct: 2.0, sweep: 35, dih: 7 },
            fin: { x: 0.8, h: 9.2, root: 9.4, ct: 3.0, sweep: 45 },
            eng: { r: 2.05, len: 7.3, at: [0.3] },
            pitch: 0.508, win: [0.26, 0.38], doors: [0.09, 0.3, 0.64, 0.875],
        },
        b773: {
            label: 'Boeing 777-300', L: 73.9, D: 6.2, nose: 1.5, tail: 2.7, ck: 'std',
            wing: { x: 0.37, span: 64.8, kink: 0.33, ck: 8.6, ct: 1.9, sweep: 31.6, dih: 6, t: 0.15, tt: 0.1, tip: 'raked' },
            stab: { x: 0.845, span: 21.5, root: 7.0, ct: 2.0, sweep: 35, dih: 7 },
            fin: { x: 0.81, h: 9.2, root: 9.4, ct: 3.0, sweep: 45 },
            eng: { r: 2.1, len: 7.4, at: [0.3] },
            pitch: 0.508, win: [0.26, 0.38], doors: [0.08, 0.27, 0.44, 0.66, 0.88],
        },
        b747: {
            label: 'Boeing 747', L: 70.6, D: 6.5, nose: 1.55, tail: 2.6, ck: 'std', hump: { to: 0.37, h: 0.42 }, deck: 0.35,
            wing: { x: 0.35, span: 61.0, kink: 0.3, ck: 10.0, ct: 4.0, sweep: 37.5, dih: 7, t: 0.14, tt: 0.09, tip: 'blended', wl: { h: 1.8, cant: 62, sweep: 55 } },
            stab: { x: 0.845, span: 22.2, root: 7.0, ct: 2.2, sweep: 37, dih: 7 },
            fin: { x: 0.795, h: 10.0, root: 11.0, ct: 3.5, sweep: 47 },
            eng: { r: 1.42, len: 6.0, at: [0.38, 0.66] },
            pitch: 0.508, win: [0.25, 0.36], doors: [0.09, 0.24, 0.43, 0.62, 0.85],
        },
        a330: {
            label: 'Airbus A330', L: 63.7, D: 5.64, nose: 1.45, tail: 2.6, ck: 'std',
            wing: { x: 0.37, span: 57.0, kink: 0.3, ck: 7.4, ct: 2.0, sweep: 30, dih: 5.5, t: 0.15, tt: 0.1, tip: 'blended', wl: { h: 2.7, cant: 84, sweep: 45, r: 0.6 } },
            stab: { x: 0.85, span: 19.4, root: 6.0, ct: 1.8, sweep: 32, dih: 6 },
            fin: { x: 0.8, h: 8.2, root: 8.0, ct: 2.8, sweep: 40 },
            eng: { r: 1.55, len: 6.4, at: [0.32] },
            pitch: 0.533, win: [0.26, 0.38], doors: [0.08, 0.26, 0.62, 0.87],
        },
        a380: {
            label: 'Airbus A380', L: 72.7, D: 7.14, H: 1.18, nose: 1.3, tail: 2.6, ck: 'std', deck: 0.86,
            wing: { x: 0.32, span: 77.0, kink: 0.32, ck: 11.0, ct: 4.0, sweep: 33.5, dih: 5.6, t: 0.14, tt: 0.09, tip: 'blended', wl: { h: 1.6, cant: 90, sweep: 50, r: 0.2 } },
            stab: { x: 0.84, span: 30.4, root: 9.0, ct: 3.0, sweep: 34, dih: 6 },
            fin: { x: 0.79, h: 11.0, root: 13.0, ct: 4.0, sweep: 42 },
            eng: { r: 1.65, len: 7.2, at: [0.32, 0.57] },
            pitch: 0.53, win: [0.26, 0.38], doors: [0.07, 0.23, 0.43, 0.65, 0.86],
        },
        crj7: {
            label: 'Bombardier CRJ700', L: 32.3, D: 2.69, nose: 1.9, tail: 3.6, ck: 'std',
            wing: { x: 0.45, span: 22.0, kink: 0.3, ck: 3.0, ct: 1.1, sweep: 26, dih: 4.5, t: 0.14, tt: 0.11, tip: 'blended', wl: { h: 1.0, cant: 75, sweep: 45 } },
            stab: { x: 0, span: 8.5, root: 2.5, ct: 1.2, sweep: 33, dih: -3 },
            fin: { x: 0.79, h: 4.2, root: 4.6, ct: 2.6, sweep: 42, t: true },
            eng: { r: 0.72, len: 3.8, tail: 0.69 },
            pitch: 0.508, win: [0.22, 0.3], doors: [0.11], winTo: 0.64,
        },
        crj9: {
            label: 'Bombardier CRJ900', L: 36.2, D: 2.69, nose: 1.9, tail: 3.6, ck: 'std',
            wing: { x: 0.455, span: 23.4, kink: 0.3, ck: 3.0, ct: 1.1, sweep: 26, dih: 4.5, t: 0.14, tt: 0.11, tip: 'blended', wl: { h: 1.0, cant: 75, sweep: 45 } },
            stab: { x: 0, span: 8.5, root: 2.5, ct: 1.2, sweep: 33, dih: -3 },
            fin: { x: 0.8, h: 4.2, root: 4.6, ct: 2.6, sweep: 42, t: true },
            eng: { r: 0.72, len: 3.8, tail: 0.7 },
            pitch: 0.508, win: [0.22, 0.3], doors: [0.1], winTo: 0.65,
        },
        e175: {
            label: 'Embraer 175', L: 31.7, D: 3.01, H: 1.1, nose: 1.5, tail: 2.5, ck: 'std',
            wing: { x: 0.37, span: 25.0, kink: 0.32, ck: 3.2, ct: 1.2, sweep: 23.5, dih: 5, t: 0.15, tt: 0.11, tip: 'blended', wl: { h: 1.4, cant: 70, sweep: 40 } },
            stab: { x: 0.83, span: 10.0, root: 2.7, ct: 1.0, sweep: 30, dih: 7 },
            fin: { x: 0.785, h: 5.0, root: 4.5, ct: 2.1, sweep: 38 },
            eng: { r: 0.84, len: 3.6, at: [0.3] },
            pitch: 0.53, win: [0.27, 0.37], doors: [0.11, 0.875],
        },
        e190: {
            label: 'Embraer 190', L: 36.2, D: 3.01, H: 1.1, nose: 1.5, tail: 2.5, ck: 'std',
            wing: { x: 0.37, span: 27.6, kink: 0.32, ck: 3.4, ct: 1.25, sweep: 23.5, dih: 5, t: 0.15, tt: 0.11, tip: 'blended', wl: { h: 1.5, cant: 70, sweep: 40 } },
            stab: { x: 0.835, span: 10.0, root: 2.9, ct: 1.0, sweep: 30, dih: 7 },
            fin: { x: 0.79, h: 5.2, root: 4.7, ct: 2.1, sweep: 38 },
            eng: { r: 0.95, len: 4.0, at: [0.3] },
            pitch: 0.53, win: [0.27, 0.37], doors: [0.1, 0.88],
        },
        md11: {
            label: 'McDonnell Douglas MD-11', L: 61.6, D: 6.02, nose: 1.45, tail: 2.4, ck: 'std',
            wing: { x: 0.37, span: 48.0, kink: 0.3, ck: 8.0, ct: 2.5, sweep: 35, dih: 5.5, t: 0.14, tt: 0.1, tip: 'blended', wl: { h: 2.5, cant: 80, sweep: 50 } },
            stab: { x: 0.86, span: 18.0, root: 6.5, ct: 2.2, sweep: 40, dih: 6 },
            fin: { x: 0.82, h: 7.4, root: 6.6, ct: 3.0, sweep: 45 },
            eng: { r: 1.42, len: 6.0, at: [0.33], centre: 0.79 },
            pitch: 0.508, win: [0.26, 0.38], doors: [0.08, 0.29, 0.62, 0.86],
        },
    };

    // Tried in order against the name with spaces and dashes taken out and
    // upper-cased ("Boeing 737-800" → "BOEING737800"). The first rule that
    // matches wins, so the specific ones come first.
    const RULES = [
        [/A38[0-9]|A380/, 'a380', true],
        [/B77W|B773|B77X|B778|B779|7773|777300|777X|7778|7779/, 'b773', true],
        [/B77[0-9L]|B772|777/, 'b772', true],
        [/B78[0-9X]|787/, 'b787', true],
        [/B74[0-9A-Z]|747/, 'b747', true],
        [/B73[0-9A-Z]|B3[789X]M|B37M|737/, 'b737', true],
        [/A3(18|19|20|21)|A(19|20|21)N|A3(18|19|20|21)NEO/, 'a320', true],
        [/A33[0-9]|A330/, 'a330', true],
        [/MD11|MD-11/, 'md11', true],
        [/CRJ(9|10|X)|CRJ900|CRJ1000/, 'crj9', true],
        [/CRJ(1|2|7)|CRJ700|CRJ200|CRJ100/, 'crj7', true],
        [/E(RJ)?17[05]|EMBRAER17[05]|E1?7[05]E2|E75L|E75S|E170|E175/, 'e175', true],
        [/E(RJ)?19[05]|EMBRAER19[05]|E29[05]|E190|E195|EJET/, 'e190', true],
        // Close relatives of the same shape, where there is no build of the type.
        [/A34[0-9]|A35[0-9K]|A350|A340/, 'a330', false],
        [/B76[0-9]|767|B75[0-9]|757/, 'b787', false],
        [/DC10|DC-10|MD10/, 'md11', false],
        [/A22[0-9]|BCS[13]|CS[13]00|A220/, 'e190', false],
        [/B71[0-9]|717|MD8[0-9]|MD90|DC9/, 'crj9', false],
        [/B70[0-9]|707|B72[0-9]|727/, 'b737', false],
    ];

    function match(name) {
        const s = String(name || '').toUpperCase().replace(/[\s\-_.·]+/g, '');
        if (!s) return null;
        for (const [re, id, exact] of RULES) {
            if (re.test(s)) return { id, exact, label: TYPES[id].label };
        }
        return null;
    }

    /* ---------------------------------------------------------------------
     * three.js, on demand. Resolves with THREE, or null if it could not be
     * had — the page simply goes without an aircraft.
     * ------------------------------------------------------------------- */
    let threeP = null;
    function script(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src; s.async = true;
            s.onload = resolve; s.onerror = reject;
            document.head.appendChild(s);
        });
    }
    function three() {
        if (threeP) return threeP;
        threeP = (async () => {
            try { if (!global.THREE) await script(THREE_URL); } catch (_) { /* offline, blocked */ }
            const T = global.THREE;
            if (!T || !T.WebGLRenderer) { threeP = null; return null; }
            return T;
        })();
        return threeP;
    }

    // The hero's heading: nose toward the viewer's left shoulder, three-
    // quarters on, so the contrails run away into the distance behind it.
    const HERO_YAW = 0.2;
    const still = () => global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isHex = (c) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c || '');
    const lerp = (a, b, t) => a + (b - a) * t;
    const clamp01 = (t) => Math.max(0, Math.min(1, t));
    const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

    /* ---------------------------------------------------------------------
     * Building. Every surface is a grid of points; each point carries the
     * part it belongs to (what colour it is) and two coordinates the livery
     * paints by.
     *
     *   part 0  fuselage and wing-body fairing  uv: metres from the nose,
     *                                            angle from the crown (0..π)
     *   part 1  wings, tail planes, fairings    uv: chord, span (0..1)
     *   part 2  fin                             uv: chord, height (0..1)
     *   part 3  nacelle                         uv: along (0..1), round
     *   part 4  intake, fan face, duct (dark)
     *   part 5  lip, spinner, core, plug (metal)
     *   part 6  pylon
     * ------------------------------------------------------------------- */
    function Builder() { return { pos: [], uv: [], part: [], idx: [] }; }
    function grid(M, rows, cols, wrap, part, f) {
        const base = M.pos.length / 3;
        for (let i = 0; i < rows; i++) {
            for (let j = 0; j < cols; j++) {
                const p = f(i, j);
                M.pos.push(p[0], p[1], p[2]); M.uv.push(p[3], p[4]); M.part.push(part);
            }
        }
        const cc = wrap ? cols : cols - 1;
        for (let i = 0; i < rows - 1; i++) {
            for (let j = 0; j < cc; j++) {
                const j2 = (j + 1) % cols;
                const a = base + i * cols + j, b = base + i * cols + j2, c = base + (i + 1) * cols + j, d = base + (i + 1) * cols + j2;
                M.idx.push(a, c, b, b, c, d);
            }
        }
    }

    // The fuselage: top and bottom lines and half-width at any x (metres
    // from the nose). A cross-section is two half-ellipses on a common
    // centre: the top one taller where a hump raises the crown.
    function fuselage(s) {
        const L = s.L, R = s.D / 2, H = R * (s.H || 1);
        const Ln = s.nose * s.D, Lt = s.tail * s.D, xt = L - Lt;
        const yEnd = 0.52 * H, rEnd = 0.09 * R;
        const hump = (x) => (s.hump ? s.hump.h * R * (1 - smooth(s.hump.to * L - 0.09 * L, s.hump.to * L, x)) : 0);
        return (x) => {
            let top = H + hump(x), base = H, bot = -H, w = R;
            if (x < Ln) {
                const t = clamp01(x / Ln);
                const tip = -0.28 * H;
                top = tip + (top - tip) * Math.sqrt(1 - Math.pow(1 - t, 1.9));
                base = tip + (base - tip) * Math.sqrt(1 - Math.pow(1 - t, 1.9));
                bot = tip + (bot - tip) * Math.sqrt(1 - Math.pow(1 - t, 2.6));
                w = R * Math.sqrt(1 - Math.pow(1 - t, 2.3));
            } else if (x > xt) {
                const t = clamp01((x - xt) / Lt);
                top = top - (top - (yEnd + rEnd)) * Math.pow(t, 1.8);
                base = base - (base - (yEnd + rEnd)) * Math.pow(t, 1.8);
                bot = -H + (yEnd - rEnd + H) * Math.pow(t, 1.1);
                w = R + (rEnd - R) * Math.pow(t, 1.35);
            }
            const c = (base + bot) / 2;
            return { c, up: top - c, dn: c - bot, w };
        };
    }

    function buildBody(M, s, sec) {
        const L = s.L, Ln = s.nose * s.D, Lt = s.tail * s.D;
        const xs = [];
        // Dense at the nose and the tail, where the shape changes.
        for (let i = 0; i <= 70; i++) xs.push(Ln * Math.pow(i / 70, 1.7));
        for (let i = 1; i < 60; i++) xs.push(Ln + (L - Lt - Ln) * i / 60);
        for (let i = 0; i <= 60; i++) xs.push(L - Lt + Lt * i / 60);
        xs[0] = 0.004;
        xs.push(L + 0.08);
        const N = 96;
        grid(M, xs.length, N, true, 0, (i, j) => {
            const x = xs[i], q = sec(Math.min(x, L));
            const k = i === xs.length - 1 ? 0.0 : 1;
            const ph = (j / N) * Math.PI * 2, cp = Math.cos(ph);
            const y = q.c + (cp > 0 ? q.up : q.dn) * cp * k;
            const z = q.w * Math.sin(ph) * k;
            return [x, y, z, x, ph <= Math.PI ? ph : 2 * Math.PI - ph];
        });
    }

    // Airfoil section, round the ring: trailing edge, over the top to the
    // leading edge, back underneath. Unit chord, unit thickness.
    const RING = (() => {
        const K = 56, out = [];
        const yt = (x) => 5 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x);
        for (let j = 0; j < K; j++) {
            const upper = j < K / 2;
            const b = Math.PI * (upper ? j : j - K / 2) / (K / 2);
            const x = upper ? 0.5 * (1 + Math.cos(b)) : 0.5 * (1 - Math.cos(b));
            out.push([x, (upper ? 1 : -1) * yt(x), 0.06 * x * (1 - x)]);
        }
        return out;
    })();

    // A lifting surface through its stations: each a leading-edge point,
    // chord, thickness and cant (0: flat; π/2: upright, like a fin).
    function loft(M, side, part, st) {
        grid(M, st.length, RING.length, true, part, (i, j) => {
            const S = st[i], a = RING[j];
            const off = (a[1] * S.t + a[2]) * S.c;
            return [S.x + a[0] * S.c, S.y + off * Math.cos(S.cant), side * (S.z - off * Math.sin(S.cant)), a[0], i / (st.length - 1)];
        });
    }

    // Wing (or stabiliser) stations from the root, inside the fuselage, to
    // the tip; then the tip itself — raked back, or turned up into a winglet.
    function wingStations(w, R, x0, y0) {
        const b = w.span / 2, z0 = 0.3 * R;
        const tanS = Math.tan(w.sweep * D2R), tanD = Math.tan(w.dih * D2R);
        const rake = w.tip === 'raked';
        const xLE = (z) => x0 + tanS * z + (rake && z > 0.86 * b ? Math.pow((z - 0.86 * b) / (0.14 * b), 2) * 0.5 * (w.ck + w.ct) : 0);
        const zk = w.kink ? w.kink * b : 0;
        const teK = zk ? x0 + tanS * zk + w.ck : 0;
        const teT = x0 + tanS * b + w.ct;
        const xTE = (z) => {
            if (!zk) return x0 + (w.root || 0) + (teT - x0 - (w.root || 0)) * (z / b);
            return z < zk ? teK + (zk - z) * 0.05 : teK + (teT - teK) * (z - zk) / (b - zk);
        };
        const yAt = (z) => y0 + tanD * Math.max(0, z - R * 0.8);
        const out = [];
        const n = 30;
        for (let i = 0; i <= n; i++) {
            const z = z0 + (b - z0) * Math.sin((i / n) * Math.PI / 2);
            const x = xLE(z);
            out.push({ x, y: yAt(z), z, c: Math.max(0.12, xTE(z) - x), t: lerp(w.t || 0.12, w.tt || 0.1, z / b), cant: Math.atan(tanD) });
        }
        const T = out[out.length - 1];
        if (w.tip === 'blended' && w.wl) {
            // Up and round into the winglet: a bend, then straight.
            const wl = w.wl, rb = (wl.r || 1.2) * T.c;
            const c0 = T.cant, c1 = wl.cant * D2R;
            const steps = 14, arc = rb * (c1 - c0), run = Math.max(0.2, wl.h - rb * (Math.sin(c1) - Math.sin(c0)));
            let p = { x: T.x, y: T.y, z: T.z };
            const total = arc + run;
            for (let i = 1; i <= steps; i++) {
                const d0 = total * (i - 1) / steps, d1 = total * i / steps, ds = d1 - d0;
                const cant = d1 < arc ? c0 + (c1 - c0) * (d1 / arc) : c1;
                p = { x: p.x + Math.tan(wl.sweep * D2R) * ds, y: p.y + Math.sin(cant) * ds, z: p.z + Math.cos(cant) * ds };
                const f = d1 / total;
                out.push({ x: p.x + T.c * 0.25 * f, y: p.y, z: p.z, c: T.c * lerp(0.95, 0.38, f), t: lerp(T.t, 0.08, f), cant });
            }
        }
        // Closed off: the last section shrinks to an edge.
        const E = out[out.length - 1];
        const along = E.cant > 0.6 ? { y: 0.02 * E.c, z: 0.004 } : { y: 0.004, z: 0.02 * E.c };
        out.push({ x: E.x + 0.04 * E.c, y: E.y + along.y, z: E.z + along.z, c: E.c * 0.9, t: E.t * 0.45, cant: E.cant });
        out.push({ x: E.x + 0.08 * E.c, y: E.y + along.y * 1.4, z: E.z + along.z * 1.4, c: E.c * 0.78, t: 0, cant: E.cant });
        return { st: out, xLE, xTE, yAt, b };
    }

    // A surface of revolution round an axis along x, from a profile of
    // [x, r] pairs; `edge(φ)` may push the last ring aft (chevrons).
    function revolve(M, part, cx, cy, cz, prof, len, edge) {
        const N = 64;
        grid(M, prof.length, N, true, part, (i, j) => {
            const ph = (j / N) * Math.PI * 2;
            const x = prof[i][0] + (edge && i === prof.length - 1 ? edge(ph) : 0);
            const r = prof[i][1];
            return [cx + x, cy + r * Math.cos(ph), cz + r * Math.sin(ph), x / len, ph];
        });
    }

    // A nacelle with its intake at (x, y, z): outer cowl, lip, intake and
    // fan, the core cowl and its plug behind.
    function nacelle(M, x, y, z, r, len, chev) {
        const P = (pts) => pts.map(([a, b]) => [a * len, b * r]);
        revolve(M, 4, x, y, z, P([[0.24, 0.8], [0.12, 0.83], [0.03, 0.855]]), len);
        revolve(M, 5, x, y, z, P([[0.03, 0.855], [0.0, 0.875], [-0.008, 0.9], [0.0, 0.93], [0.02, 0.96], [0.05, 0.98]]), len);
        revolve(M, 3, x, y, z, P([[0.05, 0.98], [0.12, 0.995], [0.3, 1.0], [0.5, 0.985], [0.66, 0.94], [0.76, 0.87]]), len,
            chev ? (ph) => 0.035 * len * (0.5 + 0.5 * Math.cos(ph * 14)) : null);
        revolve(M, 4, x, y, z, P([[0.76, 0.87], [0.74, 0.8], [0.66, 0.74]]), len);
        revolve(M, 4, x, y, z, P([[0.24, 0.8], [0.24, 0.5], [0.24, 0.19]]), len);
        revolve(M, 5, x, y, z, P([[0.24, 0.19], [0.2, 0.15], [0.15, 0.08], [0.11, 0.0]]), len);
        revolve(M, 5, x, y, z, P([[0.62, 0.66], [0.74, 0.64], [0.9, 0.56], [1.02, 0.47], [1.08, 0.44]]), len);
        revolve(M, 4, x, y, z, P([[1.08, 0.44], [1.07, 0.32]]), len);
        revolve(M, 5, x, y, z, P([[1.07, 0.32], [1.13, 0.27], [1.22, 0.14], [1.3, 0.0]]), len);
        return { x: x + 1.3 * len, y, z };
    }

    // A slim pod under a flap's hinge, along x.
    function pod(M, x, y, z, len, r) {
        const prof = [];
        for (let i = 0; i <= 10; i++) {
            const t = i / 10;
            prof.push([t * len, r * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 0.7) * (t > 0.87 ? (1 - t) / 0.13 : 1) + (i === 0 || i === 10 ? 0 : 0.001)]);
        }
        revolve(M, 1, x, y, z, prof, len);
    }

    function build(T, s) {
        const M = Builder();
        const L = s.L, R = s.D / 2, H = R * (s.H || 1);
        const sec = fuselage(s);
        const top = (x) => { const q = sec(x); return q.c + q.up; };
        buildBody(M, s, sec);
        const exhausts = [];

        // Wings, low on the fuselage.
        const w = s.wing;
        const wx = w.x * L, wy = -0.55 * H;
        const W = wingStations(w, R, wx, wy);
        [1, -1].forEach((side) => loft(M, side, 1, W.st));

        // Wing-body fairing: the long blister the wing root sits in. Painted
        // as fuselage.
        {
            const x0 = wx - 0.1 * W.xTE(R) + 0.1 * wx, x1 = W.xTE(R) + 0.35 * (W.xTE(R) - wx);
            const len = x1 - x0, rows = 40, N = 48;
            grid(M, rows, N, true, 0, (i, j) => {
                const t = i / (rows - 1), x = x0 + len * t;
                const prof = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.25 + 0.0)), 0.55) * (t > 0.8 ? Math.pow((1 - t) / 0.2, 0.7) : 1);
                const q = sec(x);
                const ph = (j / N) * Math.PI * 2;
                const cy = q.c - 0.45 * q.dn, ry = 0.6 * q.dn * prof + 0.001, rz = 0.92 * q.w * Math.max(prof, 0.02);
                const y = cy + ry * Math.cos(ph), z = rz * Math.sin(ph);
                return [x, y, z, x, Math.atan2(Math.abs(z), y - q.c)];
            });
        }

        // Flap-track fairings, three a side.
        [0.3, 0.52, 0.72].forEach((f) => {
            const z = R + (W.b - R) * f;
            const c = W.xTE(z) - W.xLE(z);
            [1, -1].forEach((side) => pod(M, W.xLE(z) + 0.55 * c, W.yAt(z) - 0.05 * c, side * z, 0.7 * c, 0.06 * c));
        });

        // Tail planes and fin.
        const F = s.fin;
        const fx = F.x * L, fTop = top(fx);
        const fst = [];
        const tanF = Math.tan(F.sweep * D2R);
        const fn = 18;
        for (let i = 0; i <= fn; i++) {
            const h = -0.35 * R + (F.h + 0.35 * R) * (i / fn);
            const y = fTop + h, f = clamp01(h / F.h);
            // A dorsal fillet runs the root forward into the crown.
            const dorsal = h < 0.3 * F.h ? Math.pow(1 - Math.max(0, h) / (0.3 * F.h), 2.2) * 0.45 * F.root : 0;
            const x = fx + tanF * Math.max(0, h) - dorsal;
            const c = lerp(F.root, F.ct, f) + dorsal;
            fst.push({ x, y, z: 0, c, t: 0.11, cant: Math.PI / 2 });
        }
        const FT = fst[fst.length - 1];
        fst.push({ x: FT.x + 0.04 * FT.c, y: FT.y + 0.03 * FT.c, z: 0, c: FT.c * 0.9, t: 0.05, cant: Math.PI / 2 });
        fst.push({ x: FT.x + 0.08 * FT.c, y: FT.y + 0.04 * FT.c, z: 0, c: FT.c * 0.8, t: 0, cant: Math.PI / 2 });
        loft(M, 1, 2, fst);

        const S = s.stab;
        let sx, sy;
        if (F.t) { sx = FT.x + 0.05 * FT.c; sy = FT.y - 0.04 * FT.c; }
        else { sx = S.x * L; const q = sec(sx + 0.5 * S.root); sy = q.c + 0.1 * q.up; }
        const SW = wingStations({ span: S.span, root: S.root, ct: S.ct, sweep: S.sweep, dih: S.dih, t: 0.11, tt: 0.09 }, F.t ? 0.05 : R * 0.6, sx, sy);
        [1, -1].forEach((side) => loft(M, side, 1, SW.st));

        // Engines.
        const E = s.eng;
        (E.at || []).forEach((f) => {
            const z = R + (W.b - R) * f;
            const lex = W.xLE(z), wyz = W.yAt(z);
            const c = W.xTE(z) - lex;
            const nx = lex - 0.5 * E.len, ny = wyz - 0.07 * c - E.r * 1.05;
            [1, -1].forEach((side) => {
                exhausts.push(nacelle(M, nx, ny, side * z, E.r, E.len, E.chev));
                // Pylon: up from the cowl into the wing's underside.
                const pst = [];
                for (let i = 0; i <= 6; i++) {
                    const t = i / 6;
                    const y = ny + E.r * 0.8 + (wyz + 0.02 * c - ny - E.r * 0.8) * t;
                    const x = nx + E.len * lerp(0.28, 0.32, t);
                    pst.push({ x, y, z: side * z * 0 + z, c: lerp(E.len * 0.95, c * 0.85, t), t: 0.11, cant: Math.PI / 2 });
                }
                const p0 = pst[0];
                pst.unshift({ x: p0.x + 0.05 * p0.c, y: p0.y - 0.15, z, c: p0.c * 0.9, t: 0, cant: Math.PI / 2 });
                loft(M, side, 6, pst);
            });
        });
        if (E.tail) {
            // On the rear fuselage, either side, on a short stub.
            const x = E.tail * L, q = sec(x + 0.5 * E.len);
            const ny = q.c + 0.3 * q.up, nz = q.w + E.r * 1.25;
            [1, -1].forEach((side) => {
                exhausts.push(nacelle(M, x, ny, side * nz, E.r, E.len, false));
                const pst = [];
                for (let i = 0; i <= 5; i++) {
                    const t = i / 5;
                    pst.push({ x: x + 0.3 * E.len, y: ny, z: lerp(q.w * 0.5, nz - E.r * 0.8, t), c: 0.5 * E.len, t: 0.12, cant: 0 });
                }
                loft(M, side, 6, pst);
            });
        }
        if (E.centre) {
            // The third engine, through the fin's root.
            const x = E.centre * L, ny = top(x + 0.5 * E.len) + E.r * 0.95;
            exhausts.push(nacelle(M, x, ny, 0, E.r, E.len, false));
        }

        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.Float32BufferAttribute(M.pos, 3));
        g.setAttribute('aUV', new T.Float32BufferAttribute(M.uv, 2));
        g.setAttribute('aPart', new T.Float32BufferAttribute(M.part, 1));
        g.setIndex(M.idx);
        g.computeVertexNormals();
        g.computeBoundingBox();
        const box = g.boundingBox, c = box.getCenter(new T.Vector3()), size = box.getSize(new T.Vector3());
        const k = 1 / Math.max(size.x, size.y, size.z);
        const mesh = new T.Mesh(g);
        mesh.position.copy(c).multiplyScalar(-k);
        mesh.scale.setScalar(k);
        const template = new T.Group();
        template.add(mesh);
        return {
            template,
            exhausts: exhausts.filter((e) => e.z >= 0).map((e) => ({ x: (e.x - c.x) * k, y: (e.y - c.y) * k, z: (e.z - c.z) * k })),
            spec: s,
        };
    }

    const built = new Map();
    function model(T, id) {
        if (!built.has(id)) built.set(id, build(T, TYPES[id]));
        return built.get(id);
    }

    /* ---------------------------------------------------------------------
     * The livery, painted per pixel in each part's own coordinates. Edges
     * are anti-aliased in screen space (fwidth), so they stay crisp at any
     * size.
     * ------------------------------------------------------------------- */
    const LIVERY_VERT_HEAD = `
        attribute float aPart;
        attribute vec2 aUV;
        varying float vPart;
        varying vec2 vUV;
    `;
    const LIVERY_VERT_BODY = `
        vPart = aPart;
        vUV = aUV;
    `;
    const LIVERY_FRAG_HEAD = `
        uniform vec3 uWhite, uWing, uPaint, uDark, uLite, uGlass, uMetal, uFan;
        uniform float uL, uR, uNose, uPitch, uWinW, uWinH, uWin0, uWin1, uDeck, uCk;
        uniform float uDoor[6];
        varying float vPart;
        varying vec2 vUV;
        float lvRough = 0.34;
        float lvMetal = 0.06;
        float lvAA(float d) { float w = fwidth(d) * 0.8 + 1e-5; return 1.0 - smoothstep(-w, w, d); }
        float lvBox(vec2 p, vec2 h, float r) { vec2 q = abs(p) - h + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
        // Inside a convex quad, corners in order; soft at the edges.
        float lvEdge(vec2 p, vec2 a, vec2 b) { vec2 e = b - a; float d = (e.x * (p.y - a.y) - e.y * (p.x - a.x)) / length(e); return d; }
        float lvQuad(vec2 p, vec2 a, vec2 b, vec2 c, vec2 d) {
            float e = max(max(lvEdge(p, a, b), lvEdge(p, b, c)), max(lvEdge(p, c, d), lvEdge(p, d, a)));
            return lvAA(e);
        }
        float lvPanes(vec2 p) {
            // p: (metres from the nose / nose length, angle from the crown)
            float g = 0.0;
            if (uCk > 0.5) {
                g = max(g, lvQuad(p, vec2(0.46, 0.05), vec2(0.28, 0.06), vec2(0.265, 1.0), vec2(0.45, 0.92)));
                g = max(g, lvQuad(p, vec2(0.66, 0.97), vec2(0.5, 0.95), vec2(0.505, 1.3), vec2(0.74, 1.28)));
            } else {
                g = max(g, lvQuad(p, vec2(0.45, 0.05), vec2(0.3, 0.06), vec2(0.285, 0.95), vec2(0.44, 0.88)));
                g = max(g, lvQuad(p, vec2(0.6, 0.9), vec2(0.47, 0.9), vec2(0.475, 1.27), vec2(0.6, 1.26)));
                g = max(g, lvQuad(p, vec2(0.72, 0.92), vec2(0.64, 0.92), vec2(0.645, 1.24), vec2(0.72, 1.23)));
            }
            return g;
        }
        vec3 lvBody() {
            float x = vUV.x, th = vUV.y, h = cos(th);
            float ah = fwidth(h) * 0.9 + 1e-5;
            float hc = -0.5 + 0.92 * smoothstep(0.1 * uL, 0.93 * uL, x);
            vec3 c = uWhite;
            float above = smoothstep(hc - ah, hc + ah, h);
            float line = above * (1.0 - smoothstep(hc + 0.07 - ah, hc + 0.07 + ah, h));
            c = mix(c, uDark, line);
            c = mix(c, uPaint, 1.0 - above);
            // Doors: thin seams, a little darker than what they cross.
            float thW = 1.36;
            float seam = 0.0;
            float nearDoor = 0.0;
            for (int i = 0; i < 6; i++) {
                float dx = uDoor[i];
                if (dx <= 0.0) continue;
                vec2 q = vec2(x - dx, (th - thW) * uR + 0.42);
                float d = lvBox(q, vec2(0.54, 0.96), 0.2);
                float w = fwidth(d) * 0.8 + 1e-5;
                seam = max(seam, 1.0 - smoothstep(0.022 - w, 0.022 + w, abs(d)));
                nearDoor = max(nearDoor, 1.0 - step(0.85, abs(x - dx)));
            }
            c = mix(c, c * 0.72, seam);
            // Cabin windows at the type's pitch.
            float k = floor((x - uWin0) / uPitch + 0.5);
            float cx = uWin0 + k * uPitch;
            float inRow = step(uWin0 - 0.01, cx) * step(cx, uWin1 + 0.01) * (1.0 - nearDoor);
            float win = lvAA(lvBox(vec2(x - cx, (th - thW) * uR), vec2(uWinW, uWinH) * 0.5, uWinW * 0.42)) * inRow;
            // The upper deck's row, on a 747 or an A380.
            float deck = lvAA(lvBox(vec2(x - cx, (th - 0.74) * uR), vec2(uWinW, uWinH) * 0.5, uWinW * 0.42))
                * step(uWin0 + 2.0, cx) * step(cx, uDeck);
            c = mix(c, uGlass, max(win, deck));
            // The flight deck.
            float ck = lvPanes(vec2(x / uNose, th));
            if (ck > 0.0) { c = mix(c, uGlass, ck); lvRough = mix(lvRough, 0.06, ck); }
            return c;
        }
        vec3 livery() {
            if (vPart < 0.5) return lvBody();
            if (vPart < 1.5) return uWing;
            if (vPart < 2.5) return mix(uPaint, uDark, smoothstep(0.1, 1.0, vUV.y) * 0.45);
            if (vPart < 3.5) return uLite;
            if (vPart < 4.5) { lvRough = 0.55; lvMetal = 0.4; return uFan; }
            if (vPart < 5.5) { lvRough = 0.28; lvMetal = 0.85; return uMetal; }
            return uWing;
        }
    `;

    function liveryMaterial(T, kind) {
        const mat = new T.MeshPhysicalMaterial({
            color: 0xffffff, roughness: 0.34, metalness: 0.06, side: T.DoubleSide,
            clearcoat: 0.65, clearcoatRoughness: 0.22, envMapIntensity: kind === 'hero' ? 0.85 : 0.7,
        });
        const u = {
            uWhite: { value: new T.Color() }, uWing: { value: new T.Color() }, uPaint: { value: new T.Color() },
            uDark: { value: new T.Color() }, uLite: { value: new T.Color() }, uGlass: { value: new T.Color() },
            uMetal: { value: new T.Color() }, uFan: { value: new T.Color() },
            uL: { value: 1 }, uR: { value: 1 }, uNose: { value: 1 }, uPitch: { value: 0.5 }, uWinW: { value: 0.25 }, uWinH: { value: 0.36 },
            uWin0: { value: 0 }, uWin1: { value: 0 }, uDeck: { value: 0 }, uCk: { value: 0 },
            uDoor: { value: [0, 0, 0, 0, 0, 0] },
        };
        mat.extensions = { derivatives: true };
        mat.onBeforeCompile = (sh) => {
            Object.assign(sh.uniforms, u);
            sh.vertexShader = LIVERY_VERT_HEAD + sh.vertexShader
                .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + LIVERY_VERT_BODY);
            sh.fragmentShader = LIVERY_FRAG_HEAD + sh.fragmentShader
                .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb = livery();')
                .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = lvRough;')
                .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = lvMetal;');
        };
        return { mat, u };
    }

    // Colours are written as the airline wrote them (sRGB) and converted: the
    // renderer works in linear light, and a navy taken as linear comes out slate.
    function setLivery(T, u, s, accent) {
        const lin = (c) => new T.Color(c).convertSRGBToLinear();
        const paintC = lin(isHex(accent) ? accent : '#E8553B');
        u.uWhite.value.copy(lin(0xf5f4f1));
        u.uWing.value.copy(lin(0xd5d8dd));
        u.uGlass.value.copy(lin(0x10151d));
        u.uMetal.value.copy(lin(0xb9bdc4));
        u.uFan.value.copy(lin(0x2a2e35));
        u.uPaint.value.copy(paintC);
        u.uDark.value.copy(paintC.clone().lerp(lin(0x000000), 0.4));
        u.uLite.value.copy(paintC.clone().lerp(lin(0xffffff), 0.06));
        const R = s.D / 2;
        u.uL.value = s.L; u.uR.value = R; u.uNose.value = s.nose * s.D;
        u.uPitch.value = s.pitch; u.uWinW.value = s.win[0]; u.uWinH.value = s.win[1];
        const doors = s.doors.map((d) => d * s.L);
        u.uWin0.value = doors[0] + 1.3;
        u.uWin1.value = (s.winTo ? s.winTo * s.L : (doors.length > 1 ? doors[doors.length - 1] - 1.2 : s.L * 0.82));
        u.uDeck.value = s.deck ? s.deck * s.L : 0;
        u.uCk.value = s.ck === '787' ? 1 : 0;
        u.uDoor.value = [0, 1, 2, 3, 4, 5].map((i) => doors[i] || 0);
    }

    // A soft sky for the paint to reflect: bright above, warm at the horizon,
    // dark below — what makes a white fuselage read as gloss, not plaster.
    function skyEnvironment(T, renderer) {
        try {
            const scene = new T.Scene();
            const geo = new T.SphereGeometry(10, 32, 16);
            const col = [];
            const top = new T.Color(0xcfdcf2), mid = new T.Color(0xffd7b0), low = new T.Color(0x1b1f27);
            const p = geo.getAttribute('position');
            for (let i = 0; i < p.count; i++) {
                const h = p.getY(i) / 10;
                const c = h > 0 ? mid.clone().lerp(top, Math.min(1, h * 1.6)) : mid.clone().lerp(low, Math.min(1, -h * 3));
                col.push(c.r, c.g, c.b);
            }
            geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));
            scene.add(new T.Mesh(geo, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide })));
            const pm = new T.PMREMGenerator(renderer);
            const env = pm.fromScene(scene, 0.03).texture;
            pm.dispose();
            return env;
        } catch (_) { return null; }
    }

    /* ---------------------------------------------------------------------
     * A stage: one renderer, one scene, one aircraft.
     * ------------------------------------------------------------------- */
    function Stage(T, kind) {
        let renderer;
        try {
            renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: kind === 'hero' ? 'default' : 'low-power' });
        } catch (_) { return null; }
        // The hero is the page's centrepiece: it gets a little more of a
        // high-density screen than the card does.
        renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, kind === 'hero' ? 2.5 : 2));
        renderer.outputEncoding = T.sRGBEncoding;
        // Filmic: white paint keeps its shape instead of blowing out.
        renderer.toneMapping = T.ACESFilmicToneMapping;
        renderer.toneMappingExposure = kind === 'hero' ? 1.05 : 1.1;
        const canvas = renderer.domElement;
        canvas.className = kind === 'hero' ? 'cc-hero3d' : 'cc-ac3d';
        canvas.setAttribute('aria-hidden', 'true');
        const scene = new T.Scene();
        scene.environment = skyEnvironment(T, renderer);
        scene.add(new T.HemisphereLight(0xffffff, 0x2a3140, kind === 'hero' ? 0.7 : 0.85));
        const key = new T.DirectionalLight(0xfff4e6, kind === 'hero' ? 1.5 : 1.25);
        key.position.set(-2, 3, 2.5);
        scene.add(key);
        const rim = new T.DirectionalLight(0xffffff, kind === 'hero' ? 0.9 : 0.45);
        rim.position.set(2.5, 1.2, -3);
        scene.add(rim);
        const camera = new T.PerspectiveCamera(kind === 'hero' ? 26 : 28, 1.6, 0.05, 30);
        // The hero looks up at it from a little below and ahead, close: the
        // angle of a photograph taken from the wing of a chase plane.
        if (kind === 'hero') { camera.position.set(-0.92, 0.0, 1.18); camera.lookAt(0.1, 0.035, 0); }
        else { camera.position.set(-1.25, 0.62, 1.55); camera.lookAt(0, -0.02, 0); }
        const rig = new T.Group();                     // turns (card) or flies (hero)
        scene.add(rig);
        const { mat: material, u: liveryU } = liveryMaterial(T, kind);
        const st = { T, kind, renderer, canvas, scene, camera, rig, material, liveryU, model: null, id: '', trails: null, frame: 0, last: 0, t: 0, drag: null, moved: false };
        if (kind === 'card') {
            rig.rotation.y = -0.5;
            // Drag to turn it. A drag is not a press: the card under it does
            // not move on to the next one when the reader lets go.
            canvas.addEventListener('pointerdown', (e) => { st.drag = { x: e.clientX, r: rig.rotation.y }; st.moved = false; });
            global.addEventListener('pointermove', (e) => {
                if (!st.drag) return;
                const dx = e.clientX - st.drag.x;
                if (Math.abs(dx) > 4) st.moved = true;
                rig.rotation.y = st.drag.r + dx * 0.012;
                draw(st);
            });
            global.addEventListener('pointerup', () => { st.drag = null; });
            canvas.addEventListener('click', (e) => { if (st.moved) { e.stopPropagation(); e.preventDefault(); st.moved = false; } }, true);
        }
        document.addEventListener('visibilitychange', () => loop(st));
        return st;
    }

    function size(st) {
        const c = st.canvas;
        const w = c.clientWidth, h = c.clientHeight;
        if (!w || !h) return false;
        if (c.width !== Math.round(w * st.renderer.getPixelRatio())) {
            st.renderer.setSize(w, h, false);
            st.camera.aspect = w / h;
            st.camera.updateProjectionMatrix();
        }
        return true;
    }
    const visible = (st) => st.canvas.isConnected && !document.hidden
        && document.documentElement.getAttribute('data-skin') === 'console';
    function draw(st) {
        if (!st.model || !size(st)) return;
        st.renderer.render(st.scene, st.camera);
    }

    // Contrails: thin trails from behind the engines, fading out.
    function trails(st, exhausts) {
        const T = st.T;
        if (st.trails) { st.rig.remove(st.trails); st.trails = null; }
        if (!exhausts.length) return;
        const cvs = document.createElement('canvas');
        cvs.width = 4; cvs.height = 256;
        const cx = cvs.getContext('2d');
        const grad = cx.createLinearGradient(0, 256, 0, 0);    // v=0 at the engine end
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(0.06, 'rgba(255,255,255,0.42)');
        grad.addColorStop(0.35, 'rgba(255,255,255,0.18)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        cx.fillStyle = grad; cx.fillRect(0, 0, 4, 256);
        const mat = new T.MeshBasicMaterial({ map: new T.CanvasTexture(cvs), transparent: true, depthWrite: false });
        const len = 2.2, rad = 0.0045;
        const g = new T.Group();
        // From the innermost engine either side (and a tail engine's).
        const inner = exhausts.reduce((a, e) => (e.z > 1e-4 && (!a || e.z < a.z) ? e : a), null);
        const from = inner ? [inner, { x: inner.x, y: inner.y, z: -inner.z }] : exhausts;
        from.forEach((e) => {
            const m = new T.Mesh(new T.CylinderGeometry(rad, rad * 2.4, len, 10, 1, true), mat);
            m.rotation.z = Math.PI / 2;                          // along the aeroplane, aft is +x
            m.position.set(e.x + 0.02 + len / 2, e.y, e.z);
            g.add(m);
        });
        st.trails = g;
        st.rig.add(g);
    }

    function loop(st) {
        cancelAnimationFrame(st.frame);
        if (!visible(st) || !st.model) return;
        st.frame = requestAnimationFrame((now) => {
            const dt = st.last ? Math.min(0.05, (now - st.last) / 1000) : 0;
            st.last = now;
            if (!still()) {
                st.t += dt;
                if (st.kind === 'card') { if (!st.drag) st.rig.rotation.y += dt * 0.32; }
                else {
                    // Cruising: a slow bank and settle, a breath of pitch, the
                    // nose wandering a few degrees — never a loop-the-loop.
                    const t = st.t;
                    st.rig.rotation.set(Math.sin(t * 0.45) * 0.06, HERO_YAW + Math.sin(t * 0.21) * 0.07, Math.sin(t * 0.33) * 0.025);
                    st.rig.position.y = Math.sin(t * 0.6) * 0.012;
                }
            }
            draw(st);
            loop(st);
        });
    }

    const stages = {};
    async function show(kind, host, name, opts) {
        const m = match(name);
        if (!host || !m) return false;
        const T = await three();
        if (!T || !host.isConnected) return false;
        const st = stages[kind] || (stages[kind] = Stage(T, kind));
        if (!st) return false;
        const accent = (opts && opts.accent) || '';
        if (st.id !== m.id || st.accent !== accent) {
            const ac = model(T, m.id);
            setLivery(T, st.liveryU, ac.spec, accent);
            if (st.model) st.rig.remove(st.model);
            const obj = ac.template.clone();
            obj.traverse((o) => { if (o.isMesh) o.material = st.material; });
            st.model = obj;
            st.id = m.id;
            st.accent = accent;
            st.rig.add(obj);
            if (kind === 'hero') { st.rig.rotation.set(0, HERO_YAW, 0); trails(st, ac.exhausts); }
        }
        st.canvas.title = m.exact ? m.label : m.label + ' (a close relative — no build of this type yet)';
        host.appendChild(st.canvas);
        st.last = 0;
        draw(st);
        loop(st);
        return true;
    }

    global.CrewAircraft3D = {
        match,
        attach: (host, name, opts) => show('card', host, name, opts),
        hero: (host, name, opts) => show('hero', host, name, opts),
        types: TYPES,
    };
})(window);
