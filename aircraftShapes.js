// aircraftShapes.js — real aircraft artwork for the map, from the vendored
// top-view shape set.
//
// Where the artwork comes from
// ----------------------------
// vendor/aircraft-shapes/ is a verbatim copy of
// https://github.com/RexKramer1/AircraftShapesSVG — 182 top-view planforms
// named by ICAO type designator, drawn by RexKramer1 and amnesica for ADS-B
// viewers (the same lineage as tar1090 and dump1090). It is **GPL-3.0**, stated
// in the repo and again inside every file's own `<dc:rights>` metadata, and the
// full licence travels with the artwork in vendor/aircraft-shapes/LICENSE. See
// docs/AIRCRAFT-ICONS.md for the survey that landed here and what the licence
// obliges.
//
// Why not markers.png
// -------------------
// The sheet is 1024×512 for about sixty aircraft, which puts a B737 at 32×32
// physical pixels while registering it as 128 logical pixels wide. On a 3×
// phone every aircraft is a ~2× upscale of a small bitmap. These are vectors,
// rasterised at load into a canvas sized for the actual device, so there is no
// fixed resolution to run out of — and the planforms are drawn by someone who
// draws aircraft, which is the part that cannot be substituted with geometry.
//
// Only sixteen files are ever fetched
// -----------------------------------
// `_resolveAircraftCategory()` in flight.js can only ever return sixteen
// category keys, so only those sixteen shapes are loaded. Everything else the
// sprite sheet carries — the airport markers especially — still comes from
// markers.png, which is why the classic loader runs after this one and fills in
// whatever is not already registered.

/* =========================
 * Category → ICAO shape file
 * =========================
 * The left-hand side is what flight.js produces; the right is a filename in
 * vendor/aircraft-shapes. Where the set has no exact match the nearest airframe
 * of the same class is used, which is the same substitution the category
 * buckets were already making one level up.
 */
const SHAPE_FILE = {
    A320: 'A320',
    A330: 'A333',
    A350: 'A359',
    A380: 'A388',
    B737: 'B738',
    B747: 'B744',
    B757: 'B752',
    B777: 'B77W',
    B787: 'B789',
    C130: 'C130',
    C17: 'C17',
    DASH8: 'DH8D',
    E190: 'E195',        // no E190 in the set; the -195 is the same planform, stretched
    EUROCOPTER: 'EC35',
    F16: 'F16',
    SINGLEPROP: 'C172'
};

const SHAPES_DIR = './vendor/aircraft-shapes/';

/* =========================
 * Sizing
 * =========================
 * The shapes are drawn to a consistent real-world scale across the set — every
 * file is an 80-unit viewBox and an A388 genuinely occupies seven times the
 * span of a C172. That is correct, and taken literally it is unusable: at an
 * icon size where the A380 reads, the Cessna is three pixels.
 *
 * So the true span is compressed rather than discarded. A power curve keeps the
 * ordering and the sense that widebodies are bigger, while pulling the extremes
 * in to about two-to-one — enough to be informative, not enough to make half
 * the fleet invisible.
 */
const REFERENCE_SPAN = 41;      // the B738's span in viewBox units — the "1.0" aircraft
const SIZE_EXPONENT = 0.38;     // 0 = all one size, 1 = true relative scale
const MIN_SCALE = 0.60;
const MAX_SCALE = 1.25;

// How much of the icon box a scale-1.0 aircraft fills. Symbol quads rotate as a
// whole in Mapbox rather than the texture rotating inside a fixed quad, so
// there is no diagonal clipping to leave room for; this is chosen to land the
// on-screen size where markers.png already had it, so switching sets does not
// change how big the traffic looks.
const BASE_FILL = 0.80;

// Registered at the same logical size as the classic sheet, so `icon-size` and
// every setting built on it keep their meaning across sets.
const LOGICAL_SIZE = 128;

function scaleForSpan(span) {
    const raw = Math.pow(span / REFERENCE_SPAN, SIZE_EXPONENT);
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, raw));
}

/* =========================
 * Loading
 * ========================= */

const sourceCache = new Map();   // file -> prepared { svg, box }

// Strip the editor furniture and repaint every path as a solid silhouette.
//
// The shapes are authored for a light background: the planform is a path with
// `fill:none; stroke:#000`, plus a separate white "Accent" layer. Drawn as-is
// on a dark map that is an invisible outline. Filling every path instead gives
// the solid shape a map icon wants — and the one the SDF tinting path needs,
// since it reads alpha and throws colour away.
function prepare(text) {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svg = doc.documentElement;
    if (!svg || svg.nodeName === 'parsererror') return null;

    const drop = /^(metadata|namedview|defs|title|desc)$/i;
    for (const node of Array.from(svg.childNodes)) {
        if (node.nodeType === 1 && drop.test(node.nodeName.replace(/^.*:/, ''))) {
            svg.removeChild(node);
        }
    }
    for (const el of Array.from(svg.querySelectorAll('*'))) {
        el.removeAttribute('style');
        el.removeAttribute('fill');
        el.removeAttribute('stroke');
        el.removeAttribute('stroke-width');
        el.removeAttribute('stroke-opacity');
        el.removeAttribute('fill-opacity');
    }
    return svg;
}

// The tight bounds of the drawn shape, in viewBox units.
//
// Measured rather than tabulated: the shapes are centred differently in every
// file, and a baked table is one more thing that can quietly disagree with the
// artwork it describes. Sixteen measurements at load cost a few milliseconds.
function measure(svg) {
    const probe = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    probe.setAttribute('style', 'position:absolute;left:-9999px;top:-9999px;width:200px;height:200px');
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    for (const node of Array.from(svg.childNodes)) {
        if (node.nodeType === 1) group.appendChild(document.importNode(node, true));
    }
    probe.appendChild(group);
    document.body.appendChild(probe);
    let box = null;
    try {
        const b = group.getBBox();
        if (b && b.width > 0 && b.height > 0) box = { x: b.x, y: b.y, w: b.width, h: b.height };
    } catch (_) { /* nothing measurable */ }
    probe.remove();
    return box;
}

async function loadShape(file) {
    if (sourceCache.has(file)) return sourceCache.get(file);

    const res = await fetch(`${SHAPES_DIR}${encodeURIComponent(file)}.svg`);
    if (!res.ok) throw new Error(`shape ${file}: HTTP ${res.status}`);
    const svg = prepare(await res.text());
    if (!svg) throw new Error(`shape ${file}: unparseable`);

    const box = measure(svg);
    if (!box) throw new Error(`shape ${file}: nothing to draw`);

    const prepared = { inner: svg.innerHTML, box };
    sourceCache.set(file, prepared);
    return prepared;
}

// Build a standalone SVG cropped to the shape's own bounds, so the browser does
// the centring and scaling for us when it draws into the canvas.
function svgFor({ inner, box }, fill, rim) {
    const pad = Math.max(box.w, box.h) * 0.04;
    const vb = `${box.x - pad} ${box.y - pad} ${box.w + pad * 2} ${box.h + pad * 2}`;
    // paint-order puts the stroke behind the fill, so the rim sits outside the
    // silhouette rather than eating into it.
    const style = rim
        ? `fill:${fill};stroke:rgba(8,12,20,0.6);stroke-width:${Math.max(box.w, box.h) * 0.03};` +
          'paint-order:stroke fill;stroke-linejoin:round'
        : `fill:${fill};stroke:none`;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb + '">' +
           `<g style="${style}">${inner}</g></svg>`;
}

function rasterise(prepared, devicePx, rim) {
    return new Promise((resolve, reject) => {
        const markup = svgFor(prepared, '#ffffff', rim);
        const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
        const img = new Image();
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = devicePx;
                canvas.height = devicePx;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });

                // Scale by the aircraft's real span, then centre. The shape is
                // already cropped to its own bounds, so this is the only place
                // size is decided.
                const span = Math.max(prepared.box.w, prepared.box.h);
                const extent = Math.min(1, scaleForSpan(span) * BASE_FILL) * devicePx;
                const w = extent * (prepared.box.w >= prepared.box.h ? 1 : prepared.box.w / prepared.box.h);
                const h = extent * (prepared.box.h >= prepared.box.w ? 1 : prepared.box.h / prepared.box.w);
                ctx.drawImage(img, (devicePx - w) / 2, (devicePx - h) / 2, w, h);

                resolve(ctx.getImageData(0, 0, devicePx, devicePx));
            } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('svg render failed')); };
        img.src = url;
    });
}

/**
 * Register the vendored aircraft shapes on a map.
 *
 * Only the categories flight.js can actually produce are registered; the caller
 * runs the classic sheet loader afterwards, which fills in the airport markers
 * and anything else under its own `hasImage` guard.
 *
 * @param {object}   map
 * @param {object}   opts
 * @param {function} opts.toSdf       flight.js's buildSdfImageData, so the
 *                                    sharp/legacy edge setting keeps working
 * @param {boolean}  opts.sharp
 * @param {function} opts.yieldFrame  awaited between icons to keep the main
 *                                    thread responsive
 * @returns {Promise<string[]>} the category keys successfully registered
 */
export async function registerAircraftShapeIcons(map, opts = {}) {
    const { toSdf, sharp = true, yieldFrame } = opts;

    // Rasterise for the screen this is running on, capped: past 3× the extra
    // pixels are invisible and the texture memory is not.
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    const devicePx = Math.round(LOGICAL_SIZE * dpr);

    const done = [];
    let since = performance.now();

    for (const [category, file] of Object.entries(SHAPE_FILE)) {
        try {
            const prepared = await loadShape(file);

            if (!map.hasImage(`icon-${category}`)) {
                const mask = await rasterise(prepared, devicePx, false);
                const data = (sharp && typeof toSdf === 'function') ? toSdf(mask) : mask;
                map.addImage(`icon-${category}`, data, { pixelRatio: dpr, sdf: true });
            }
            // The hover/selected layer draws `icon-<KEY>_S`. Same planform; it
            // is the tint that marks it selected, so one shape serves both.
            if (!map.hasImage(`icon-${category}_S`)) {
                const mask = await rasterise(prepared, devicePx, false);
                const data = (sharp && typeof toSdf === 'function') ? toSdf(mask) : mask;
                map.addImage(`icon-${category}_S`, data, { pixelRatio: dpr, sdf: true });
            }
            if (!map.hasImage(`icon-${category}-nat`)) {
                map.addImage(`icon-${category}-nat`, await rasterise(prepared, devicePx, true), {
                    pixelRatio: dpr, sdf: false
                });
            }
            done.push(category);
        } catch (e) {
            // One bad shape must not cost the whole set — the classic sheet
            // fills this category in afterwards.
            console.warn(`[icons] shape "${file}" unavailable, falling back to the sheet:`, e.message);
        }

        if (typeof yieldFrame === 'function' && performance.now() - since > 12) {
            await yieldFrame();
            since = performance.now();
        }
    }

    return done;
}

// Exercised by tools/test-aircraft-shapes.js, which checks the mapping against
// what flight.js can produce and against the files actually vendored — the two
// ways this breaks without anyone noticing until somebody flies the type.
export const _internals = {
    SHAPE_FILE, SHAPES_DIR, LOGICAL_SIZE,
    REFERENCE_SPAN, SIZE_EXPONENT, MIN_SCALE, MAX_SCALE, BASE_FILL,
    scaleForSpan
};
