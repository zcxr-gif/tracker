// aircraftIcons.js — aircraft map icons drawn as vectors, at the screen's own
// resolution.
//
// Why this exists
// ---------------
// The icons have always come from markers.png, a 1024×512 sheet holding about
// sixty aircraft. That sheet is the problem, and the arithmetic says so
// plainly: a B737's tile in it is 32×32 physical pixels, and it is registered
// with Mapbox at a pixelRatio that declares it 128 logical pixels wide. Drawn
// at the default icon size on a 3× phone, roughly sixty device pixels are being
// asked of a thirty-two pixel source. Every aircraft on the map is a 2× upscale
// of a small bitmap, which is exactly the soft, slightly mushy look you get.
//
// No amount of rendering care fixes that, because the detail was never there.
// The only real fix is to stop shipping pixels and ship shapes instead: these
// icons are drawn as paths at load time, into a canvas sized for the device
// actually running the app. On a 3× screen they are rasterised at 3×, and they
// are sharp because nothing was ever resampled.
//
// It also means one plane is not one bitmap. An A380 is not a scaled-up 737 —
// it has a different wing sweep, a different taper, four engines in different
// places — and all of that is a handful of numbers per type rather than another
// tile someone has to draw.
//
// What a "good" top-down aircraft looks like
// ------------------------------------------
// Read at fifteen pixels on a busy map, an aircraft icon is doing one job:
// telling you which way it is pointing and roughly what size it is. So the
// silhouette is built to survive being small — a nose you can find, a wing
// sweep that reads as direction, and a tailplane that stops the shape being
// ambiguous end-to-end. Detail that disappears below twenty pixels is detail
// that costs memory for nothing, so there is none.
//
// Status: NOT the default
// -----------------------
// These are hand-authored shapes, and hand-authored is exactly their limit —
// they are sharp, but they are not as good as real artwork drawn by someone
// who draws aircraft. `mapFilters.iconSet` defaults to 'classic' (markers.png)
// for that reason; this set is the 'vector' option in Settings, kept because
// it is the only thing here with no fixed resolution.
//
// The real fix is a proper external set. The best one is
// github.com/RexKramer1/AircraftShapesSVG — 182 top-view planforms named by
// ICAO type, drawn for ADS-B viewers — but it is GPL-3.0, stated both in the
// repo and in each file's own metadata, which is a decision about the product
// rather than about the code. See docs/AIRCRAFT-ICONS.md.

/* =========================
 * Per-type geometry
 * =========================
 * Every measurement is a fraction of the icon box, with the aircraft nose-up
 * and centred — the same orientation markers.png uses, so `icon-rotate` keeps
 * meaning what it meant.
 *
 *   length      nose-to-tail, as a fraction of the box
 *   span        wingtip-to-wingtip
 *   sweep       how far back the wingtip sits from the wing root, 0 = straight
 *   wingRoot    where the wing meets the fuselage, 0 = nose, 1 = tail
 *   body        fuselage width
 *   tailSpan    horizontal stabiliser span
 *   engines     nacelles per side (0 for gliders, props and fighters)
 *   enginePos   fraction along the half-span where the inboard nacelle sits
 *   prop        propeller discs per side, drawn instead of nacelles
 *   winglets    upturned tips, which read as a small notch at the wingtip
 */
const SHAPES = {
    //            length span  sweep wingRoot body  tailSpan eng  engPos prop winglets
    A380:       { length: 0.94, span: 1.00, sweep: 0.30, wingRoot: 0.52, body: 0.150, tailSpan: 0.42, engines: 2, enginePos: 0.34, winglets: false },
    B747:       { length: 0.96, span: 0.92, sweep: 0.32, wingRoot: 0.54, body: 0.130, tailSpan: 0.40, engines: 2, enginePos: 0.34, winglets: false },
    B777:       { length: 0.94, span: 0.88, sweep: 0.30, wingRoot: 0.55, body: 0.120, tailSpan: 0.34, engines: 1, enginePos: 0.38, winglets: false },
    B787:       { length: 0.90, span: 0.86, sweep: 0.32, wingRoot: 0.55, body: 0.110, tailSpan: 0.32, engines: 1, enginePos: 0.38, winglets: true },
    A350:       { length: 0.92, span: 0.88, sweep: 0.32, wingRoot: 0.55, body: 0.112, tailSpan: 0.33, engines: 1, enginePos: 0.38, winglets: true },
    A330:       { length: 0.88, span: 0.84, sweep: 0.28, wingRoot: 0.55, body: 0.115, tailSpan: 0.32, engines: 1, enginePos: 0.38, winglets: false },
    B757:       { length: 0.86, span: 0.68, sweep: 0.26, wingRoot: 0.56, body: 0.098, tailSpan: 0.28, engines: 1, enginePos: 0.38, winglets: false },
    B767:       { length: 0.88, span: 0.78, sweep: 0.28, wingRoot: 0.55, body: 0.108, tailSpan: 0.30, engines: 1, enginePos: 0.38, winglets: false },
    B737:       { length: 0.80, span: 0.66, sweep: 0.24, wingRoot: 0.56, body: 0.095, tailSpan: 0.27, engines: 1, enginePos: 0.36, winglets: true },
    A320:       { length: 0.80, span: 0.68, sweep: 0.24, wingRoot: 0.56, body: 0.095, tailSpan: 0.27, engines: 1, enginePos: 0.36, winglets: true },
    E190:       { length: 0.74, span: 0.62, sweep: 0.24, wingRoot: 0.57, body: 0.084, tailSpan: 0.26, engines: 1, enginePos: 0.34, winglets: true },
    MD80:       { length: 0.82, span: 0.62, sweep: 0.26, wingRoot: 0.52, body: 0.090, tailSpan: 0.26, engines: 0, enginePos: 0.00, winglets: false, tailEngines: true },
    DASH8:      { length: 0.72, span: 0.72, sweep: 0.04, wingRoot: 0.44, body: 0.086, tailSpan: 0.28, engines: 0, enginePos: 0.00, prop: 1, propPos: 0.42, winglets: false },
    C130:       { length: 0.76, span: 0.86, sweep: 0.03, wingRoot: 0.42, body: 0.110, tailSpan: 0.34, engines: 0, enginePos: 0.00, prop: 2, propPos: 0.34, winglets: false },
    C17:        { length: 0.82, span: 0.84, sweep: 0.22, wingRoot: 0.48, body: 0.130, tailSpan: 0.34, engines: 2, enginePos: 0.32, winglets: true },
    SINGLEPROP: { length: 0.62, span: 0.66, sweep: 0.02, wingRoot: 0.40, body: 0.072, tailSpan: 0.26, engines: 0, enginePos: 0.00, prop: 0, nosePro: true, winglets: false },
    F16:        { length: 0.72, span: 0.44, sweep: 0.46, wingRoot: 0.60, body: 0.086, tailSpan: 0.24, engines: 0, enginePos: 0.00, winglets: false, delta: true },
    // A helicopter has no wing and no tailplane worth drawing at this size —
    // the rotor disc and the boom are the whole silhouette, so `noWing` skips
    // both rather than leaving stub wings nothing has.
    EUROCOPTER: { length: 0.46, span: 0.12, sweep: 0.00, wingRoot: 0.50, body: 0.185, tailSpan: 0.10, engines: 0, enginePos: 0.00, winglets: false, rotor: true, noWing: true }
};

// Everything getAircraftCategory() can return has to resolve to a shape, and a
// type with no entry of its own gets the closest airframe rather than a
// question mark — an unrecognised regional jet is far better served by the
// E190 outline than by nothing.
const ALIASES = {
    A300: 'A330', A310: 'A330', A318: 'A320', A319: 'A320', A321: 'A320',
    A337: 'A330', A340: 'B747', A400: 'C130', B52: 'B747', AT42: 'DASH8',
    AT72: 'DASH8', PA28: 'SINGLEPROP', PC12: 'SINGLEPROP', TWINPROP: 'DASH8',
    Q4: 'SINGLEPROP', RJ100: 'E190', FOKKER100: 'E190', PRIVATEJET: 'E190',
    GLIDER: 'SINGLEPROP', BALLOON: 'SINGLEPROP', DRONE: 'SINGLEPROP',
    F35: 'F16', EUFI: 'F16', HAWK: 'F16', T38: 'F16', TOR: 'F16', SPIT: 'SINGLEPROP',
    LANC: 'C130', E3CF: 'B747', KC35R: 'B747', R135: 'B747', U2: 'F16',
    H60: 'EUROCOPTER', H64: 'EUROCOPTER', CHINOOK: 'EUROCOPTER',
    LYNX: 'EUROCOPTER', PUMA: 'EUROCOPTER', EH10: 'EUROCOPTER',
    RC22: 'SINGLEPROP', 'RC-22': 'SINGLEPROP', RECEIVER: 'B747',
    VEHICLE: 'SINGLEPROP', TRIANGLE: 'F16', SANTA: 'SINGLEPROP'
};

function shapeFor(key) {
    return SHAPES[key] || SHAPES[ALIASES[key]] || SHAPES.B737;
}

/* =========================
 * Drawing
 * ========================= */

// Each part of the aircraft is traced and filled on its own.
//
// Filling the whole silhouette as one path is the obvious thing and it is
// wrong: the left and right wing are mirror images, so they wind in opposite
// directions, and the non-zero rule reads that overlap as a hole. It renders as
// a checkerboard of missing chunks across every wing root and nacelle — which
// is invisible in the geometry and unmistakable the moment you look at a
// rendering. Filling part by part makes overlaps union, which is what a
// silhouette wants.
function fillPart(ctx, trace) {
    ctx.beginPath();
    trace();
    ctx.fill('nonzero');
}

// Rounded-end capsule along a line, used for the fuselage and the nacelles.
function capsule(ctx, cx, y0, y1, halfWidth) {
    ctx.moveTo(cx - halfWidth, y0);
    ctx.lineTo(cx - halfWidth, y1);
    ctx.arc(cx, y1, halfWidth, Math.PI, 0, true);
    ctx.lineTo(cx + halfWidth, y0);
    ctx.arc(cx, y0, halfWidth, 0, Math.PI, true);
    ctx.closePath();
}

/**
 * Collect this aircraft's parts as a list of tracing functions.
 *
 * Returned rather than drawn so the same geometry can be filled part-by-part
 * (for a clean union) and stroked all at once (for the natural variant's rim),
 * without tracing it twice or keeping the two in sync by hand.
 */
function aircraftParts(ctx, s, size) {
    const cx = size / 2;
    const len = s.length * size;
    const noseY = (size - len) / 2;
    const tailY = noseY + len;
    const body = s.body * size / 2;
    const halfSpan = s.span * size / 2;
    const parts = [];

    // Fuselage. The nose is drawn a little finer than the tail so the shape has
    // a front at any size.
    parts.push(() => capsule(ctx, cx, noseY + body * 1.5, tailY - body, body));

    const rootY = noseY + s.wingRoot * len;
    const sweepY = s.sweep * len;

    if (!s.noWing) {
        // Main wing, one closed polygon per side. Chunkier than a scale drawing
        // on purpose: at fifteen pixels a scale wing is two pixels of grey and
        // the aircraft reads as a stick.
        const rootChord = len * (s.delta ? 0.42 : 0.24);
        const tipChord = len * (s.delta ? 0.10 : 0.075);
        for (const dir of [-1, 1]) {
            parts.push(() => {
                ctx.moveTo(cx, rootY - rootChord * 0.45);
                ctx.lineTo(cx + dir * halfSpan, rootY + sweepY);
                if (s.winglets) ctx.lineTo(cx + dir * halfSpan, rootY + sweepY + tipChord * 1.3);
                ctx.lineTo(cx + dir * halfSpan * 0.97, rootY + sweepY + tipChord);
                ctx.lineTo(cx, rootY + rootChord * 0.55);
                ctx.closePath();
            });
        }
    }

    // Horizontal stabiliser. A delta has none — the wing runs to the tail — and
    // neither does a helicopter.
    if (!s.delta && !s.noWing) {
        const tailRootY = tailY - len * 0.11;
        const tailHalf = s.tailSpan * size / 2;
        const tailSweep = len * 0.07;
        for (const dir of [-1, 1]) {
            parts.push(() => {
                ctx.moveTo(cx, tailRootY - len * 0.05);
                ctx.lineTo(cx + dir * tailHalf, tailRootY + tailSweep);
                ctx.lineTo(cx + dir * tailHalf * 0.95, tailRootY + tailSweep + len * 0.038);
                ctx.lineTo(cx, tailRootY + len * 0.06);
                ctx.closePath();
            });
        }
    }

    // Fighters get twin tail fins instead, which is what makes the planform
    // read as military rather than as a very small airliner.
    if (s.delta) {
        const finY = tailY - len * 0.20;
        for (const dir of [-1, 1]) {
            parts.push(() => {
                ctx.moveTo(cx + dir * body * 0.4, finY);
                ctx.lineTo(cx + dir * body * 2.4, finY + len * 0.10);
                ctx.lineTo(cx + dir * body * 2.0, finY + len * 0.20);
                ctx.lineTo(cx + dir * body * 0.4, finY + len * 0.16);
                ctx.closePath();
            });
        }
    }

    // Engines. Nacelles hang ahead of the wing, which from above puts them
    // forward of the leading edge — the detail that most says "airliner".
    const nacelleLen = len * 0.15;
    const nacelleWide = size * 0.032;
    for (let i = 0; i < (s.engines || 0); i++) {
        for (const dir of [-1, 1]) {
            const at = s.enginePos + i * 0.24;
            const ex = cx + dir * halfSpan * at;
            const ey = rootY + sweepY * at - nacelleLen * 0.45;
            parts.push(() => capsule(ctx, ex, ey + nacelleWide, ey + nacelleLen, nacelleWide));
        }
    }

    // Rear-fuselage engines (MD-80 and friends): short pods either side of the
    // tail rather than under the wing.
    if (s.tailEngines) {
        const ey = tailY - len * 0.34;
        for (const dir of [-1, 1]) {
            parts.push(() => capsule(ctx, cx + dir * body * 1.9, ey, ey + len * 0.17, size * 0.030));
        }
    }

    // Propellers as the disc they sweep, sitting on the leading edge — what you
    // see from above, and what marks a turboprop at a glance.
    if (s.prop) {
        const discR = size * 0.045;
        for (let i = 0; i < s.prop; i++) {
            for (const dir of [-1, 1]) {
                const at = s.propPos + i * 0.30;
                const ex = cx + dir * halfSpan * at;
                const ey = rootY + sweepY * at - len * 0.085;
                parts.push(() => { ctx.moveTo(ex + discR, ey); ctx.arc(ex, ey, discR, 0, Math.PI * 2); ctx.closePath(); });
            }
        }
    }
    if (s.nosePro) {
        const discR = size * 0.050;
        const ey = noseY + discR * 0.5;
        parts.push(() => { ctx.moveTo(cx + discR, ey); ctx.arc(cx, ey, discR, 0, Math.PI * 2); ctx.closePath(); });
    }

    // Helicopter: a cabin, a boom, a tail rotor, and two rotor blades. Blades
    // rather than a filled disc — a filled circle at this size is a blob, and a
    // blob has no heading.
    if (s.rotor) {
        // A boom long enough to be a boom, and a tail rotor at the end of it —
        // between them they give the shape a back, which two crossed blades on
        // a capsule do not.
        const boomY = noseY + len * 0.72;
        const boomEnd = tailY + len * 0.42;
        parts.push(() => capsule(ctx, cx, boomY, boomEnd, size * 0.026));
        parts.push(() => capsule(ctx, cx, boomEnd - size * 0.055, boomEnd + size * 0.025, size * 0.040));

        const rotorR = size * 0.34;
        const bladeW = size * 0.013;
        const hubY = noseY + len * 0.36;
        for (const angle of [Math.PI * 0.20, Math.PI * 0.80]) {
            const dx = Math.cos(angle) * rotorR, dy = Math.sin(angle) * rotorR;
            parts.push(() => {
                ctx.moveTo(cx - dx - bladeW, hubY - dy);
                ctx.lineTo(cx + dx - bladeW, hubY + dy);
                ctx.lineTo(cx + dx + bladeW, hubY + dy);
                ctx.lineTo(cx - dx + bladeW, hubY - dy);
                ctx.closePath();
            });
        }
    }

    return parts;
}

/**
 * Draw one aircraft filling a `size`×`size` box.
 *
 * `natural` adds a dark rim, which is what keeps a white aircraft legible over
 * pale terrain and satellite imagery. It is stroked under the fills so the rim
 * sits outside the silhouette rather than eating into it.
 */
function drawAircraft(ctx, s, size, natural) {
    const parts = aircraftParts(ctx, s, size);

    if (natural) {
        ctx.save();
        ctx.strokeStyle = 'rgba(8,12,20,0.6)';
        ctx.lineWidth = Math.max(1.2, size * 0.026);
        ctx.beginPath();
        for (const trace of parts) trace();
        ctx.stroke();
        ctx.restore();
    }

    for (const trace of parts) fillPart(ctx, trace);
}

/* =========================
 * Rasterisation
 * ========================= */

// Every icon is registered as this many logical pixels wide, matching what the
// classic sheet declares — so `icon-size`, and every setting built on it, mean
// the same thing whichever set is active.
const LOGICAL_SIZE = 128;

function renderIcon(key, devicePx, style) {
    const canvas = document.createElement('canvas');
    canvas.width = devicePx;
    canvas.height = devicePx;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const s = shapeFor(key);

    ctx.clearRect(0, 0, devicePx, devicePx);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Flat white either way: the SDF shader recolours the tintable variant, so
    // any colour there would be thrown away, and the natural variant is white
    // by design with only its rim darker.
    ctx.fillStyle = '#ffffff';
    drawAircraft(ctx, s, devicePx, style === 'natural');

    return ctx.getImageData(0, 0, devicePx, devicePx);
}

/**
 * Register the vector icon set on a map.
 *
 * @param {object}   map            the mapbox-gl map
 * @param {string[]} keys           sprite keys to build (the classic sheet's keys)
 * @param {object}   opts
 * @param {function} opts.toSdf     converts an alpha mask into a true distance
 *                                  field — flight.js's buildSdfImageData, passed
 *                                  in so the sharp/legacy setting keeps working
 * @param {boolean}  opts.sharp     whether to use it
 * @param {function} opts.yieldFrame optional: awaited between icons to keep the
 *                                  main thread responsive during a rebuild
 */
export async function registerVectorAircraftIcons(map, keys, opts = {}) {
    const { toSdf, sharp = true, yieldFrame } = opts;

    // Rasterise for the screen this is actually running on, capped: past 3×
    // the extra pixels are invisible and the memory is not — sixty icons at
    // 512² would be sixty megabytes of texture for nothing.
    const dpr = Math.min(3, Math.max(1, (window.devicePixelRatio || 1)));
    const devicePx = Math.round(LOGICAL_SIZE * dpr);

    let since = performance.now();
    for (const rawKey of keys) {
        // `_S` is the classic sheet's selected/hover variant. The shape is the
        // same; the hover layer tints it, so one silhouette serves both.
        const key = rawKey.replace(/_S$/, '');
        const isSelected = rawKey !== key;

        if (!map.hasImage(`icon-${rawKey}`)) {
            const mask = renderIcon(key, devicePx, 'sdf');
            const data = (sharp && typeof toSdf === 'function') ? toSdf(mask) : mask;
            map.addImage(`icon-${rawKey}`, data, { pixelRatio: dpr, sdf: true });
        }

        if (!isSelected && !map.hasImage(`icon-${rawKey}-nat`)) {
            map.addImage(`icon-${rawKey}-nat`, renderIcon(key, devicePx, 'natural'), {
                pixelRatio: dpr, sdf: false
            });
        }

        if (typeof yieldFrame === 'function' && performance.now() - since > 12) {
            await yieldFrame();
            since = performance.now();
        }
    }
}

// Exposed for tools/test-aircraft-icons.js, which checks the geometry without a
// canvas — that every category resolves to a shape, and that the shapes stay
// inside their box and keep their proportions sane.
export const _internals = { SHAPES, ALIASES, shapeFor, LOGICAL_SIZE };

// Exposed so the shapes can be rendered and looked at outside the map — see
// tools/aircraft-icon-preview.html, which draws the whole set beside the
// classic sheet at the sizes the map actually uses. This module's whole claim
// is that it looks better; that page is where the claim gets checked.
export const __draw = drawAircraft;
