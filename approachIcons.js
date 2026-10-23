/**
 * approachIcons.js — aircraft icons for Approach, from the same top-view
 * artwork the live map draws (vendor/aircraft-shapes, see aircraftShapes.js
 * and docs/AIRCRAFT-ICONS.md for where it comes from and its GPL-3.0 licence).
 *
 * Each type's SVG is fetched once, stripped of its own colours, measured, and
 * rasterised per colour at a size good for the scope. drawIcon() puts one on
 * the canvas centred and rotated to the aircraft's heading.
 */

const DIR = '/vendor/aircraft-shapes/';
// Types the game flies that the set names differently.
const FILE = { E190: 'E195', E175: 'E170', B77L: 'B77W' };
const REFERENCE_SPAN = 41;            // a B738's span in the set's viewBox units
const METRES_PER_UNIT = 35.8 / REFERENCE_SPAN;
const RASTER = 96;                    // px per bitmap; drawn smaller on the scope

const shapes = new Map();             // type -> Promise<{ svg, box } | null>
const bitmaps = new Map();            // type|colour -> HTMLImageElement (loaded)

function loadShape(type) {
    const file = FILE[type] || type;
    if (!shapes.has(type)) {
        shapes.set(type, fetch(DIR + file + '.svg')
            .then(r => (r.ok ? r.text() : Promise.reject(new Error(r.status))))
            .then(text => {
                const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
                const svg = doc.documentElement;
                if (!svg || svg.nodeName === 'parsererror') return null;
                for (const node of Array.from(svg.childNodes)) {
                    if (node.nodeType === 1 && /^(metadata|namedview|defs|title|desc)$/i.test(node.nodeName.replace(/^.*:/, ''))) svg.removeChild(node);
                }
                for (const el of Array.from(svg.querySelectorAll('*'))) {
                    for (const a of ['style', 'fill', 'stroke', 'stroke-width', 'fill-opacity', 'stroke-opacity']) el.removeAttribute(a);
                }
                // Measure the drawn shape: every file centres it differently.
                const probe = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                probe.setAttribute('style', 'position:absolute;left:-9999px;top:-9999px;width:200px;height:200px');
                const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                for (const n of Array.from(svg.childNodes)) g.appendChild(n.cloneNode(true));
                probe.appendChild(g);
                document.body.appendChild(probe);
                const b = g.getBBox();
                probe.remove();
                if (!b.width || !b.height) return null;
                return { inner: Array.from(svg.childNodes).map(n => new XMLSerializer().serializeToString(n)).join(''), box: { x: b.x, y: b.y, w: b.width, h: b.height } };
            })
            .catch(() => null));
    }
    return shapes.get(type);
}

/** The icon for a type in a colour, or null until it has loaded. Starts the load. */
function bitmap(type, colour) {
    const key = type + '|' + colour;
    const have = bitmaps.get(key);
    if (have) return have.complete && have.naturalWidth ? have : null;
    const img = new Image();
    bitmaps.set(key, img);
    loadShape(type).then(s => {
        if (!s) return;
        const side = Math.max(s.box.w, s.box.h);
        const vb = `${s.box.x + s.box.w / 2 - side / 2} ${s.box.y + s.box.h / 2 - side / 2} ${side} ${side}`;
        img.src = 'data:image/svg+xml,' + encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${RASTER}" height="${RASTER}"><g fill="${colour}" stroke="rgba(0,0,0,0.35)" stroke-width="${side / 90}">${s.inner}</g></svg>`);
        img.dataset.span = s.box.w;
        img.dataset.side = side;
    });
    return null;
}

/**
 * Draw an aircraft icon centred at (x, y), nose along `hdg` (degrees true).
 * `pxPerNm` lets it grow to true size when zoomed right in on the field.
 * Returns false when the icon isn't loaded yet, so the caller can draw a target.
 */
export function drawIcon(ctx, type, colour, x, y, hdg, pxPerNm) {
    const img = bitmap(type, colour);
    if (!img) return false;
    const span = Number(img.dataset.span), side = Number(img.dataset.side);
    // Scope size: widebodies a bit bigger, regionals a bit smaller, never tiny.
    const scope = 24 * Math.max(0.65, Math.min(1.3, (span / REFERENCE_SPAN) ** 0.4));
    const real = side * METRES_PER_UNIT / 1852 * pxPerNm;
    const size = Math.max(scope, real);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(hdg * Math.PI / 180);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
    return true;
}
