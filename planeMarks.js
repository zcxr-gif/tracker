// planeMarks.js — the aircraft marks from the iOS app, drawn on the web map.
//
// Where the artwork comes from
// ----------------------------
// These are the same drawings the Inflight iOS app puts on its map, carried
// over verbatim as path data by `tools/gen-plane-marks.js` and committed as
// `planeMarks.data.js`. The shapes themselves are Virtual Radar Server's
// markers (BSD 3-Clause) and the community pack written to extend them (CC0
// 1.0); both notices travel in the generated file's header, and the site's
// Terms carry them too.
//
// Why they are the default
// ------------------------
// Three reasons, in the order they matter.
//
// One: the phone and the website should not draw the same aeroplane as two
// different shapes. They are one product and the map is the thing people look
// at hardest in both.
//
// Two: this set says what markers.png could not and what the planform set says
// only by accident — engine count, jets against props, and a size that tracks
// the real aircraft. A 747 has four engines under its wings in the drawing; an
// A380 is a different, bigger drawing again. At fifteen pixels that is most of
// what an icon can usefully tell you.
//
// Three, and it is not the reason but it is a relief: BSD and CC0 are
// attribution licences. The planform set that was the default is GPL-3.0, and
// whether its copyleft reaches an app that bundles it was flagged as open when
// it was adopted (docs/AIRCRAFT-ICONS.md). It is still an option, and it is no
// longer the thing every visitor loads.
//
// How it layers
// -------------
// Registers under the same `icon-<KEY>` / `icon-<KEY>_S` / `icon-<KEY>-nat` ids
// as everything else and runs BEFORE the sheet loader, whose `hasImage()`
// guards then leave these alone and fill in the rest — the airport markers
// above all, which no aircraft set has. So a failure anywhere in here costs a
// category, not the map.

import { MARK_ART, MARK_FLEET } from './planeMarks.data.js';

/* =========================
 * Sizing
 * =========================
 * Each drawing is normalised to its own bounding box and then scaled by its
 * fleet entry, which is exactly what the app does — so relative size is the one
 * number in the table rather than anything measured off the artwork. The scales
 * follow the real aircraft, pulled in toward the middle so a Cessna is still
 * visible on a map where an A380 reads.
 */

// How much of the icon box a scale-1.0 aircraft fills. Symbol quads rotate as a
// whole in Mapbox rather than the texture rotating inside a fixed quad, so there
// is no diagonal clipping to leave room for; this is the value the planform set
// uses, chosen to land the on-screen size where markers.png already had it, so
// switching sets does not change how big the traffic looks.
const BASE_FILL = 0.80;

// The dark halo on the untinted variant, as a fraction of the drawing's longest
// side.
//
// Taken from the app rather than picked: it strokes each mark 0.9pt wide and
// then fills over it, on a drawing 18pt across, so the halo showing outside the
// silhouette is 0.9pt — a stroke straddles its path, so the width set is twice
// that. 1.8/18 is the 0.10 below. It is a fatter outline than it sounds and it
// is the point of the thing: it is what holds a light aircraft together against
// a satellite tile.
//
// `paint-order` puts the stroke behind the fill so the halo sits outside the
// shape rather than eating into it — the same trick, arrived at the same way, as
// drawing the mark twice.
const RIM_WIDTH = 0.10;
const RIM_COLOUR = 'rgb(18, 20, 28)';

// Transparent margin around the drawing, as a fraction of its longest side.
// Wide enough for the halo to have somewhere to go — half of RIM_WIDTH, plus a
// hair — and applied to every variant so the tinted and untinted layers agree on
// how big an aeroplane is.
const PAD = 0.06;

// Registered at the same logical size as the classic sheet, so `icon-size` and
// every setting built on it keep their meaning across sets.
const LOGICAL_SIZE = 128;

/* =========================
 * How many real pixels each icon gets
 * =========================
 * Not the same question as the logical size, and conflating the two crashed the
 * app once already — see docs/AIRCRAFT-ICONS.md. Mapbox packs every registered
 * icon into one atlas texture, and an atlas that outgrows the device's maximum
 * texture size does not degrade, it fails.
 *
 * What matters is the size an icon is ever actually drawn at. `icon-size`
 * defaults to 0.15, so a 128-logical icon lands at ~19 logical pixels, or ~58
 * device pixels on a 3× screen. 160 source pixels covers that with room to
 * spare and keeps the whole set to about 6 MB.
 */
const MIN_SOURCE_PX = 64;
const MAX_SOURCE_PX = 160;

// Total decoded bytes the set may occupy. A backstop: if the table ever grows,
// this is what stops it quietly walking back into that crash.
const ATLAS_BUDGET_BYTES = 8 * 1024 * 1024;

function sourcePixelsFor(dpr) {
    return Math.round(Math.min(MAX_SOURCE_PX, Math.max(MIN_SOURCE_PX, 96 * dpr)));
}

/* =========================
 * Measuring
 * ========================= */

const boxCache = new Map();   // artwork name -> { x, y, w, h }

// The tight bounds of a drawing, in its own units.
//
// Measured rather than tabulated for the same reason the planform set measures
// its files: every drawing sits differently in its own coordinate space, and a
// baked table is one more thing that can quietly disagree with the artwork it
// describes. Ten measurements at load cost a few milliseconds, once.
function measure(name, parts) {
    if (boxCache.has(name)) return boxCache.get(name);

    const NS = 'http://www.w3.org/2000/svg';
    const probe = document.createElementNS(NS, 'svg');
    probe.setAttribute('style', 'position:absolute;left:-9999px;top:-9999px;width:200px;height:200px');
    const group = document.createElementNS(NS, 'g');

    for (const part of parts) {
        const node = document.createElementNS(NS, 'path');
        node.setAttribute('d', part.d);
        group.appendChild(node);
    }
    probe.appendChild(group);
    document.body.appendChild(probe);

    let box = null;
    try {
        const b = group.getBBox();
        if (b && b.width > 0 && b.height > 0) box = { x: b.x, y: b.y, w: b.width, h: b.height };
    } catch (_) { /* nothing measurable */ }
    probe.remove();

    if (box) boxCache.set(name, box);
    return box;
}

/* =========================
 * Drawing
 * ========================= */

// A standalone SVG cropped to the drawing's own bounds, so the browser does the
// centring and the scaling when it paints it into the canvas.
//
// The fill rule is per path: several of these carry their own cut-outs — cabin
// windows, rotor discs — which close up under the non-zero rule, which is why
// the generated data records which rule each part was drawn under.
function svgFor(parts, box, rim) {
    const extent = Math.max(box.w, box.h);
    const pad = extent * PAD;
    const vb = `${box.x - pad} ${box.y - pad} ${box.w + pad * 2} ${box.h + pad * 2}`;

    const style = rim
        ? `fill:#ffffff;stroke:${RIM_COLOUR};stroke-width:${extent * RIM_WIDTH};` +
          'paint-order:stroke fill;stroke-linejoin:round;stroke-linecap:round'
        : 'fill:#ffffff;stroke:none';

    const paths = parts.map(part =>
        `<path d="${part.d}" fill-rule="${part.evenOdd === false ? 'nonzero' : 'evenodd'}"/>`
    ).join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"><g style="${style}">${paths}</g></svg>`;
}

// `pad` leaves a transparent margin so the SDF conversion, which grows the image
// by its spread radius on every side, does not change how big the aircraft ends
// up relative to the icon box. Every variant is rendered into the same final
// dimensions, so the tinted and natural layers agree on size.
function rasterise(parts, box, scale, devicePx, rim, pad = 0) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(new Blob([svgFor(parts, box, rim)], { type: 'image/svg+xml' }));
        const img = new Image();

        img.onload = () => {
            try {
                const side = devicePx + pad * 2;
                const canvas = document.createElement('canvas');
                canvas.width = side;
                canvas.height = side;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });

                // The drawing is already cropped to its own bounds, so its size
                // is decided here and nowhere else: the fleet entry's scale,
                // against the box every icon is registered at.
                const extent = Math.min(1, scale * BASE_FILL) * devicePx;
                const w = box.w >= box.h ? extent : extent * (box.w / box.h);
                const h = box.h >= box.w ? extent : extent * (box.h / box.w);
                ctx.drawImage(img, (side - w) / 2, (side - h) / 2, w, h);

                resolve(ctx.getImageData(0, 0, side, side));
            } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('svg render failed')); };
        img.src = url;
    });
}

/**
 * Register the aircraft marks on a map.
 *
 * Only the categories flight.js can actually produce are registered — that is
 * what `planeMarks.data.js` carries — and the caller runs the classic sheet
 * loader afterwards, which fills in the airport markers and anything else under
 * its own `hasImage` guard.
 *
 * @param {object}   map
 * @param {object}   opts
 * @param {function} opts.toSdf       flight.js's buildSdfImageData, so the
 *                                    sharp/legacy edge setting keeps working
 * @param {boolean}  opts.sharp
 * @param {function} opts.yieldFrame  awaited between icons to keep the main
 *                                    thread responsive
 * @param {number}   opts.sdfPadding  the spread buildSdfImageData adds on every
 *                                    side
 * @returns {Promise<string[]>} the category keys successfully registered
 */
export async function registerPlaneMarkIcons(map, opts = {}) {
    const { toSdf, sharp = true, yieldFrame, sdfPadding = 0 } = opts;

    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    const devicePx = sourcePixelsFor(dpr);
    const useSdf = sharp && typeof toSdf === 'function';
    const pad = useSdf ? sdfPadding : 0;
    const side = devicePx + pad * 2;
    const pixelRatio = side / LOGICAL_SIZE;

    const done = [];
    let bytes = 0;
    let since = performance.now();

    for (const [category, entry] of Object.entries(MARK_FLEET)) {
        // The backstop. Registering past this cannot help: the atlas is one
        // texture, and one that outgrows the device does not degrade.
        if (bytes >= ATLAS_BUDGET_BYTES) {
            console.warn('[icons] mark set hit its texture budget; the sheet covers the rest.');
            break;
        }

        try {
            const parts = MARK_ART[entry.art];
            if (!parts) throw new Error(`no drawing named "${entry.art}"`);

            const box = measure(entry.art, parts);
            if (!box) throw new Error(`"${entry.art}" measured as nothing`);

            const silhouette = async () => {
                const mask = await rasterise(parts, box, entry.scale, devicePx, false, useSdf ? 0 : pad);
                return useSdf ? toSdf(mask) : mask;
            };

            if (!map.hasImage(`icon-${category}`)) {
                const data = await silhouette();
                map.addImage(`icon-${category}`, data, { pixelRatio, sdf: true });
                bytes += data.width * data.height * 4;
            }
            // The hover/selected layer draws `icon-<KEY>_S`. Same drawing; it is
            // the tint that marks it selected, so one shape serves both.
            if (!map.hasImage(`icon-${category}_S`)) {
                const data = await silhouette();
                map.addImage(`icon-${category}_S`, data, { pixelRatio, sdf: true });
                bytes += data.width * data.height * 4;
            }
            if (!map.hasImage(`icon-${category}-nat`)) {
                const data = await rasterise(parts, box, entry.scale, devicePx, true, pad);
                map.addImage(`icon-${category}-nat`, data, { pixelRatio, sdf: false });
                bytes += data.width * data.height * 4;
            }
            done.push(category);
        } catch (e) {
            // One bad drawing must not cost the whole set — the classic sheet
            // fills this category in afterwards.
            console.warn(`[icons] mark "${entry.art}" unavailable, falling back to the sheet:`, e.message);
        }

        if (typeof yieldFrame === 'function' && performance.now() - since > 12) {
            await yieldFrame();
            since = performance.now();
        }
    }

    return done;
}

// Exercised by tools/test-plane-marks.js, which checks the table against what
// flight.js can produce and against the artwork actually generated — the two
// ways this breaks without anyone noticing until somebody flies the type.
export const _internals = {
    MARK_ART, MARK_FLEET, LOGICAL_SIZE,
    BASE_FILL, RIM_WIDTH, PAD,
    MIN_SOURCE_PX, MAX_SOURCE_PX, ATLAS_BUDGET_BYTES,
    sourcePixelsFor, svgFor
};
