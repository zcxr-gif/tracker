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

/* =========================
 * How many real pixels each icon gets
 * =========================
 * This is not the same question as the logical size, and conflating the two
 * crashed the app.
 *
 * The first cut rasterised every icon at LOGICAL_SIZE × devicePixelRatio — 384
 * square on a 3× phone — on the reasoning that the sheet *declares* 128 logical
 * pixels so that must be the right target. It is not. Mapbox packs every
 * registered icon into a single atlas texture, and 48 images at 384² needs an
 * atlas about 2660 pixels square. Plenty of mobile GPUs cap texture size at
 * 2048. Add the 27 MB of RGBA it takes to get there and opening global
 * playback — which adds two more symbol layers over the same icons, forcing the
 * atlas to be built — took the tab with it.
 *
 * What matters is the size an icon is ever actually *drawn* at. `icon-size`
 * defaults to 0.15, so a 128-logical icon lands at ~19 logical pixels, or ~58
 * device pixels on a 3× screen. 160 source pixels covers that with room to
 * spare, stays sharp well past the default setting, and brings the whole set to
 * about 5 MB and a ~1100-pixel atlas — comparable to the sheet it replaces.
 */
const MIN_SOURCE_PX = 64;
const MAX_SOURCE_PX = 160;

// Total decoded bytes the set may occupy. A backstop: if the table above ever
// grows, this is what stops it quietly walking back into the crash.
const ATLAS_BUDGET_BYTES = 8 * 1024 * 1024;

function sourcePixelsFor(dpr) {
    return Math.round(Math.min(MAX_SOURCE_PX, Math.max(MIN_SOURCE_PX, 96 * dpr)));
}

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

// `pad` leaves a transparent margin so the SDF conversion, which grows the
// image by its spread radius on every side, does not change how big the
// aircraft ends up relative to the icon box. Both variants are rendered into
// the same final dimensions, so the tinted and natural layers agree on size.
function rasterise(prepared, devicePx, rim, pad = 0) {
    return new Promise((resolve, reject) => {
        const markup = svgFor(prepared, '#ffffff', rim);
        const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
        const img = new Image();
        img.onload = () => {
            try {
                const side = devicePx + pad * 2;
                const canvas = document.createElement('canvas');
                canvas.width = side;
                canvas.height = side;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });

                // Scale by the aircraft's real span, then centre. The shape is
                // already cropped to its own bounds, so this is the only place
                // size is decided.
                const span = Math.max(prepared.box.w, prepared.box.h);
                const extent = Math.min(1, scaleForSpan(span) * BASE_FILL) * devicePx;
                const w = extent * (prepared.box.w >= prepared.box.h ? 1 : prepared.box.w / prepared.box.h);
                const h = extent * (prepared.box.h >= prepared.box.w ? 1 : prepared.box.h / prepared.box.w);
                ctx.drawImage(img, (side - w) / 2, (side - h) / 2, w, h);

                resolve(ctx.getImageData(0, 0, side, side));
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
    const { toSdf, sharp = true, yieldFrame, sdfPadding = 0 } = opts;

    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    const devicePx = sourcePixelsFor(dpr);
    const useSdf = sharp && typeof toSdf === 'function';
    // The SDF conversion grows the image by its spread on every side. Padding
    // the plain rasters by the same amount keeps every variant the same size,
    // so one pixelRatio is right for all of them and the tinted and natural
    // layers draw aircraft at matching scale.
    const pad = useSdf ? sdfPadding : 0;
    const side = devicePx + pad * 2;
    const pixelRatio = side / LOGICAL_SIZE;

    const done = [];
    let bytes = 0;
    let since = performance.now();

    for (const [category, file] of Object.entries(SHAPE_FILE)) {
        // The backstop. Registering past this cannot help — Mapbox packs every
        // icon into one atlas texture, and an atlas that outgrows the device's
        // maximum texture size does not degrade, it fails.
        if (bytes >= ATLAS_BUDGET_BYTES) {
            console.warn('[icons] shape set hit its texture budget; the sheet covers the rest.');
            break;
        }

        try {
            const prepared = await loadShape(file);

            const silhouette = async () => {
                const mask = await rasterise(prepared, devicePx, false, useSdf ? 0 : pad);
                return useSdf ? toSdf(mask) : mask;
            };

            if (!map.hasImage(`icon-${category}`)) {
                const data = await silhouette();
                map.addImage(`icon-${category}`, data, { pixelRatio, sdf: true });
                bytes += data.width * data.height * 4;
            }
            // The hover/selected layer draws `icon-<KEY>_S`. Same planform; it
            // is the tint that marks it selected, so one shape serves both.
            if (!map.hasImage(`icon-${category}_S`)) {
                const data = await silhouette();
                map.addImage(`icon-${category}_S`, data, { pixelRatio, sdf: true });
                bytes += data.width * data.height * 4;
            }
            if (!map.hasImage(`icon-${category}-nat`)) {
                const data = await rasterise(prepared, devicePx, true, pad);
                map.addImage(`icon-${category}-nat`, data, { pixelRatio, sdf: false });
                bytes += data.width * data.height * 4;
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
    MIN_SOURCE_PX, MAX_SOURCE_PX, ATLAS_BUDGET_BYTES,
    scaleForSpan, sourcePixelsFor
};
