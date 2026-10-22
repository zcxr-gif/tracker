/**
 * approachTerrain.js — real elevation for Approach (approachGame.js).
 *
 * Loads the keyless Terrarium elevation tiles (AWS Open Data — the same
 * source terrainMode.js and the 3D viewers use) for the square around an
 * airport, resamples them onto the game's flat nautical-mile grid, and
 * derives what the game needs from them:
 *
 *   - a map of land, water and height bands for the scope;
 *   - minimum vectoring altitudes (MVA) in rings and wedges, the way a
 *     TRACON's MVA chart sets them: 1,000 ft above the highest terrain within
 *     3 NM, 2,000 ft in rugged terrain, rounded up to the next 500 ft.
 *
 * Grid coordinates match the game's: x east, y north, in NM from the airport
 * reference point.
 */

const TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const ZOOM = 9;
const M_TO_FT = 3.28084;

function tileXY(lat, lon, z) {
    const n = 2 ** z;
    const r = lat * Math.PI / 180;
    return [(lon + 180) / 360 * n, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n];
}

function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('tile ' + url));
        img.src = url;
    });
}

/**
 * Elevation in feet on a square grid `half` NM either side of the airport,
 * one sample every `step` NM. Water (at or below sea level) is flagged.
 */
export async function loadDem(lat, lon, half = 44, step = 0.25) {
    const cosLat = Math.cos(lat * Math.PI / 180);
    const latOf = y => lat + y / 60;
    const lonOf = x => lon + x / (60 * cosLat);
    const [x0, y0] = tileXY(latOf(half), lonOf(-half), ZOOM);
    const [x1, y1] = tileXY(latOf(-half), lonOf(half), ZOOM);
    const tx0 = Math.floor(x0), ty0 = Math.floor(y0), tx1 = Math.floor(x1), ty1 = Math.floor(y1);
    const cols = tx1 - tx0 + 1, rows = ty1 - ty0 + 1;

    const mosaic = document.createElement('canvas');
    mosaic.width = cols * 256; mosaic.height = rows * 256;
    const mctx = mosaic.getContext('2d', { willReadFrequently: true });
    const jobs = [];
    for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
            const url = TILE_URL.replace('{z}', ZOOM).replace('{x}', tx).replace('{y}', ty);
            jobs.push(loadImage(url).then(img => mctx.drawImage(img, (tx - tx0) * 256, (ty - ty0) * 256)));
        }
    }
    await Promise.all(jobs);
    const px = mctx.getImageData(0, 0, mosaic.width, mosaic.height).data;

    const n = Math.round(half * 2 / step) + 1;
    const ft = new Float32Array(n * n);
    const water = new Uint8Array(n * n);
    for (let j = 0; j < n; j++) {
        const y = half - j * step;                       // row 0 is the north edge
        for (let i = 0; i < n; i++) {
            const x = -half + i * step;
            const [fx, fy] = tileXY(latOf(y), lonOf(x), ZOOM);
            const sx = Math.min(mosaic.width - 1, Math.max(0, Math.floor((fx - tx0) * 256)));
            const sy = Math.min(mosaic.height - 1, Math.max(0, Math.floor((fy - ty0) * 256)));
            const k = (sy * mosaic.width + sx) * 4;
            const m = px[k] * 256 + px[k + 1] + px[k + 2] / 256 - 32768;
            ft[j * n + i] = Math.max(0, m) * M_TO_FT;
            water[j * n + i] = m <= 0 ? 1 : 0;
        }
    }
    return { n, step, half, ft, water };
}

/** Terrain height in feet at a point, or 0 off the grid. */
export function terrainAt(dem, x, y) {
    const i = Math.round((x + dem.half) / dem.step), j = Math.round((dem.half - y) / dem.step);
    if (i < 0 || j < 0 || i >= dem.n || j >= dem.n) return 0;
    return dem.ft[j * dem.n + i];
}

// Flat height bands, measured from the field's elevation so high ground near
// the airport stands out whether the field is at sea level or a mile up.
const PALETTES = {
    // A light chart: blue water, pale land, soft olive bands for high ground.
    chart: {
        water: [170, 199, 218],
        bands: [[-Infinity, [238, 238, 206]], [500, [224, 227, 192]], [1500, [208, 214, 174]],
                [3000, [191, 199, 156]], [5000, [174, 182, 140]], [8000, [157, 166, 126]]],
        edge: 0.92,
    },
    // The dark radar: just enough land to read the coast and the hills.
    radar: {
        water: [5, 12, 20],
        bands: [[-Infinity, [11, 20, 19]], [500, [14, 25, 21]], [1500, [18, 31, 24]],
                [3000, [23, 37, 27]], [5000, [28, 43, 31]], [8000, [34, 49, 35]]],
        edge: 1.35,
    },
};

function bandIndex(bands, h) {
    let k = 0;
    for (let b = 0; b < bands.length; b++) if (h >= bands[b][0]) k = b;
    return k;
}

/** A grid lightly blurred, so band edges and the coast come out as smooth curves. */
function blur(src, n) {
    let a = Float32Array.from(src), b = new Float32Array(n * n);
    for (let pass = 0; pass < 2; pass++) {
        for (let j = 0; j < n; j++) {
            for (let i = 0; i < n; i++) {
                let sum = 0, cnt = 0;
                for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
                    const ii = i + di, jj = j + dj;
                    if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
                    sum += a[jj * n + ii]; cnt++;
                }
                b[j * n + i] = sum / cnt;
            }
        }
        [a, b] = [b, a];
    }
    return a;
}
function smoothed(dem) {
    if (!dem.smooth) dem.smooth = { h: blur(dem.ft, dem.n), w: blur(dem.water, dem.n) };
    return dem.smooth;
}

/**
 * Terrain as flat height bands with a thin line where each band starts, two
 * pixels per grid sample, interpolated between samples so the edges are
 * curves rather than steps.
 */
export function renderRelief(dem, style, fieldFt = 0) {
    const pal = PALETTES[style] || PALETTES.radar;
    const { n } = dem;
    const { h, w } = smoothed(dem);
    const S = 2, m = n * S;
    const cv = document.createElement('canvas');
    cv.width = m; cv.height = m;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(m, m);
    const band = new Int8Array(m * m);
    for (let y = 0; y < m; y++) {
        const fy = Math.min(n - 1.001, y / S), j = Math.floor(fy), ty = fy - j;
        for (let x = 0; x < m; x++) {
            const fx = Math.min(n - 1.001, x / S), i = Math.floor(fx), tx = fx - i;
            const k = j * n + i;
            const wet = (w[k] * (1 - tx) + w[k + 1] * tx) * (1 - ty) + (w[k + n] * (1 - tx) + w[k + n + 1] * tx) * ty > 0.5;
            if (wet) { band[y * m + x] = -1; continue; }
            const v = (h[k] * (1 - tx) + h[k + 1] * tx) * (1 - ty) + (h[k + n] * (1 - tx) + h[k + n + 1] * tx) * ty;
            band[y * m + x] = bandIndex(pal.bands, v - fieldFt);
        }
    }
    for (let y = 0; y < m; y++) {
        for (let x = 0; x < m; x++) {
            const k = y * m + x, b = band[k], o = k * 4;
            let rgb = b < 0 ? pal.water : pal.bands[b][1];
            // Outline the coast and each band's lower edge.
            const r = x + 1 < m ? band[k + 1] : b, d = y + 1 < m ? band[k + m] : b;
            if (r !== b || d !== b) rgb = rgb.map(c => Math.min(255, c * pal.edge));
            img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    return cv;
}

/*
 * The detail engine. renderRelief() above is one coarse picture of the whole
 * airspace — fine for the overview, soft when you zoom in. TerrainTiles works
 * like a map engine instead: for whatever part of the scope is on screen it
 * picks the elevation tile zoom that matches the screen's own resolution
 * (from ~400 m per pixel zoomed out to ~20 m zoomed in), fetches those
 * tiles, colors each one in the current style and caches it. The coarse
 * picture stays underneath while a tile is still loading.
 */
const MIN_Z = 9, MAX_Z = 13, MAX_LOADS = 6, MAX_TILES = 320;

function tileLon(x, z) { return x / 2 ** z * 360 - 180; }
function tileLat(y, z) { const k = Math.PI * (1 - 2 * y / 2 ** z); return Math.atan(Math.sinh(k)) * 180 / Math.PI; }

/** One 256 px tile colored in a style: flat height bands plus coast and band-edge lines. */
function colorTile(elev, style, fieldFt) {
    const pal = PALETTES[style] || PALETTES.radar;
    const N = 256;
    const band = new Int8Array(N * N);
    for (let k = 0; k < N * N; k++) band[k] = elev[k] <= 0 ? -1 : bandIndex(pal.bands, elev[k] - fieldFt);
    const cv = document.createElement('canvas');
    cv.width = N; cv.height = N;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(N, N);
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const k = y * N + x, b = band[k], o = k * 4;
            let rgb = b < 0 ? pal.water : pal.bands[b][1];
            const r = x + 1 < N ? band[k + 1] : b, d = y + 1 < N ? band[k + N] : b;
            if (r !== b || d !== b) rgb = rgb.map(c => Math.min(255, c * pal.edge));
            img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    return cv;
}

export class TerrainTiles {
    /** lat/lon of the airport reference point (the local plane's origin) and field elevation in feet. */
    constructor(lat, lon, fieldFt) {
        this.lat = lat; this.lon = lon; this.fieldFt = fieldFt;
        this.cosLat = Math.cos(lat * Math.PI / 180);
        this.tiles = new Map();          // "z/x/y" -> { state, elev, canvases, used }
        this.loading = 0;
        this.queue = [];
        this.scratch = document.createElement('canvas');
        this.scratch.width = this.scratch.height = 256;
        this.sctx = this.scratch.getContext('2d', { willReadFrequently: true });
    }

    /** Tile zoom whose pixels are at least as fine as the screen's at `pxPerNm` CSS pixels per NM. */
    zoomFor(pxPerNm, dpr) {
        const want = pxPerNm * Math.min(dpr || 1, 2);
        const z = Math.ceil(Math.log2(want * 360 * 60 * this.cosLat / 256));
        return Math.max(MIN_Z, Math.min(MAX_Z, z));
    }

    toLocal(lat, lon) { return [(lon - this.lon) * 60 * this.cosLat, (lat - this.lat) * 60]; }
    toLatLon(x, y) { return [this.lat + y / 60, this.lon + x / (60 * this.cosLat)]; }

    request(key, z, x, y) {
        if (this.tiles.has(key)) return;
        this.tiles.set(key, { state: 'queued', canvases: {}, used: 0 });
        this.queue.push({ key, z, x, y });
        this.pump();
    }

    pump() {
        while (this.loading < MAX_LOADS && this.queue.length) {
            const { key, z, x, y } = this.queue.pop();       // newest first: what's on screen now
            const t = this.tiles.get(key);
            if (!t) continue;
            t.state = 'loading';
            this.loading++;
            loadImage(TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y)).then(img => {
                this.sctx.drawImage(img, 0, 0);
                const px = this.sctx.getImageData(0, 0, 256, 256).data;
                const elev = new Float32Array(256 * 256);
                for (let k = 0; k < elev.length; k++) {
                    elev[k] = (px[k * 4] * 256 + px[k * 4 + 1] + px[k * 4 + 2] / 256 - 32768) * M_TO_FT;
                }
                t.elev = elev; t.state = 'ok';
            }).catch(() => { t.state = 'err'; }).finally(() => { this.loading--; this.pump(); });
        }
    }

    evict() {
        if (this.tiles.size <= MAX_TILES) return;
        const old = [...this.tiles.entries()].filter(([, t]) => t.state === 'ok' || t.state === 'err')
            .sort((a, b) => a[1].used - b[1].used);
        for (const [k] of old.slice(0, this.tiles.size - MAX_TILES)) this.tiles.delete(k);
    }

    /**
     * Draw the tiles covering world box [x0..x1] x [y0..y1] (NM) at the zoom
     * for `pxPerNm`. `toS` maps local NM to screen pixels.
     */
    draw(ctx, toS, pxPerNm, dpr, box, style, frame) {
        const z = this.zoomFor(pxPerNm, dpr);
        // Below the overview's own detail there's nothing to add.
        if (z <= MIN_Z && pxPerNm < 6) return;
        this.queue.length = 0;                               // only what is visible now
        const [latN, lonW] = this.toLatLon(box.x0, box.y1), [latS, lonE] = this.toLatLon(box.x1, box.y0);
        const [fx0, fy0] = tileXY(latN, lonW, z), [fx1, fy1] = tileXY(latS, lonE, z);
        for (let ty = Math.floor(fy0); ty <= Math.floor(fy1); ty++) {
            for (let tx = Math.floor(fx0); tx <= Math.floor(fx1); tx++) {
                const key = `${z}/${tx}/${ty}`;
                const t = this.tiles.get(key);
                if (!t) { this.request(key, z, tx, ty); continue; }
                if (t.state === 'queued') this.queue.push({ key, z, x: tx, y: ty });
                if (t.state !== 'ok') continue;
                t.used = frame;
                const cv = t.canvases[style] || (t.canvases[style] = colorTile(t.elev, style, this.fieldFt));
                const [ax, ay] = toS(...this.toLocal(tileLat(ty, z), tileLon(tx, z)));
                const [bx, by] = toS(...this.toLocal(tileLat(ty + 1, z), tileLon(tx + 1, z)));
                // Half a pixel of overlap hides the seams between tiles.
                ctx.drawImage(cv, ax - 0.5, ay - 0.5, bx - ax + 1, by - ay + 1);
            }
        }
        this.pump();
        this.evict();
    }
}

/*
 * Minimum vectoring altitudes, laid out the way TRACON MVA charts usually are:
 * rings every 5 NM split into 30° wedges, with one area around the field.
 * Each area gets 1,000 ft above the highest terrain within 3 NM of it
 * (2,000 ft where the ground is rugged), rounded up to the next 500 ft.
 */
const RING_NM = 5, WEDGE = 30;

function areaOf(mva, d, b) {
    const r = Math.min(mva.rings - 1, Math.floor(d / RING_NM));
    return r === 0 ? 0 : 1 + (r - 1) * mva.wedges + Math.floor(b / WEDGE) % mva.wedges;
}

export function buildMva(dem, floor, scopeNm = 40, ifatc = false) {
    const rings = Math.ceil(scopeNm / RING_NM), wedges = 360 / WEDGE;
    const mva = { rings, wedges, scopeNm, vals: new Int32Array(1 + (rings - 1) * wedges) };
    const hi = new Float32Array(mva.vals.length), lo = new Float32Array(mva.vals.length).fill(Infinity);
    const buffer = 3, stepNm = 0.5;
    // Every sample counts toward each area it lies within 3 NM of.
    for (let y = -scopeNm - buffer; y <= scopeNm + buffer; y += stepNm) {
        for (let x = -scopeNm - buffer; x <= scopeNm + buffer; x += stepNm) {
            const h = terrainAt(dem, x, y);
            const seen = new Set();
            for (const [ox, oy] of [[0, 0], [buffer, 0], [-buffer, 0], [0, buffer], [0, -buffer],
                                    [2.1, 2.1], [-2.1, 2.1], [2.1, -2.1], [-2.1, -2.1]]) {
                const px = x + ox, py = y + oy, d = Math.hypot(px, py);
                if (d > scopeNm) continue;
                const b = ((Math.atan2(px, py) * 180 / Math.PI) + 360) % 360;
                const a = areaOf(mva, d, b);
                if (seen.has(a)) continue;
                seen.add(a);
                if (h > hi[a]) hi[a] = h;
                if (h < lo[a]) lo[a] = h;
            }
        }
    }
    for (let a = 0; a < mva.vals.length; a++) {
        const clearance = hi[a] - lo[a] > 2000 ? 2000 : 1000;
        // IFATC 6.3.2: the highest terrain rounded up to the next 1,000 ft, then 1,000 ft more.
        mva.vals[a] = Math.max(floor, ifatc ? Math.ceil(hi[a] / 1000) * 1000 + 1000 : Math.ceil((hi[a] + clearance) / 500) * 500);
    }
    mva.labels = areaLabels(mva);
    return mva;
}

/** The MVA covering a point. */
export function mvaAt(mva, x, y) {
    const d = Math.hypot(x, y);
    if (d > mva.scopeNm) return 0;
    return mva.vals[areaOf(mva, d, ((Math.atan2(x, y) * 180 / Math.PI) + 360) % 360)];
}

/** Value of the area at ring r, wedge w (ring 0 is the one area round the field). */
export function mvaArea(mva, r, w) {
    if (r < 0 || r >= mva.rings) return -1;
    return mva.vals[r === 0 ? 0 : 1 + (r - 1) * mva.wedges + ((w % mva.wedges) + mva.wedges) % mva.wedges];
}

/** One label per run of touching areas with the same MVA, placed in its middle-most area. */
function areaLabels(mva) {
    const { rings, wedges } = mva;
    const centre = (r, w) => {
        if (r === 0) return [0, 0];
        const d = (r + 0.5) * RING_NM, b = (w + 0.5) * WEDGE * Math.PI / 180;
        return [Math.sin(b) * d, Math.cos(b) * d];
    };
    const key = (r, w) => r === 0 ? '0' : `${r}:${w}`;
    const seen = new Set(), labels = [];
    const cells = [[0, 0]];
    for (let r = 1; r < rings; r++) for (let w = 0; w < wedges; w++) cells.push([r, w]);
    for (const [r0, w0] of cells) {
        if (seen.has(key(r0, w0))) continue;
        const v = mvaArea(mva, r0, w0), members = [], stack = [[r0, w0]];
        seen.add(key(r0, w0));
        while (stack.length) {
            const [r, w] = stack.pop(); members.push([r, w]);
            const near = r === 0 ? Array.from({ length: wedges }, (_, k) => [1, k])
                : [[r, w + 1], [r, w - 1], [r + 1, w], r === 1 ? [0, 0] : [r - 1, w]];
            for (let [nr, nw] of near) {
                if (nr < 0 || nr >= rings) continue;
                nw = ((nw % wedges) + wedges) % wedges;
                if (seen.has(key(nr, nw)) || mvaArea(mva, nr, nw) !== v) continue;
                seen.add(key(nr, nw)); stack.push([nr, nw]);
            }
        }
        const pts = members.map(([r, w]) => centre(r, w));
        const mx = pts.reduce((t, p) => t + p[0], 0) / pts.length, my = pts.reduce((t, p) => t + p[1], 0) / pts.length;
        let best = pts[0], bd = Infinity;
        for (const p of pts) { const d = (p[0] - mx) ** 2 + (p[1] - my) ** 2; if (d < bd) { bd = d; best = p; } }
        labels.push({ x: best[0], y: best[1], v });
    }
    return labels;
}

export const MVA_RING_NM = RING_NM, MVA_WEDGE = WEDGE;
