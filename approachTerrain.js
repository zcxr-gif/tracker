/**
 * approachTerrain.js — real elevation for Approach (approachGame.js).
 *
 * Loads the keyless Terrarium elevation tiles (AWS Open Data — the same
 * source terrainMode.js and the 3D viewers use) for the square around an
 * airport, resamples them onto the game's flat nautical-mile grid, and
 * derives what the game needs from them:
 *
 *   - a relief picture of land, water and high ground for the scope;
 *   - minimum vectoring altitudes (MVA) by sector, the way a TRACON's MVA
 *     chart sets them: 1,000 ft above the highest terrain within 3 NM of the
 *     sector, 2,000 ft in rugged terrain, rounded up to the next 500 ft.
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

const PALETTES = {
    // Light chart: blue water, pale land, greener-then-browner with height.
    chart: {
        water: [169, 198, 217],
        bands: [[0, [236, 237, 204]], [600, [223, 228, 186]], [1500, [204, 212, 164]], [3000, [185, 192, 146]],
                [5000, [171, 168, 128]], [8000, [158, 146, 118]], [11000, [176, 166, 150]]],
        shade: 0.55,
    },
    // Dark radar: barely-there land so targets stay the brightest thing.
    radar: {
        water: [6, 14, 22],
        bands: [[0, [12, 22, 20]], [1500, [17, 28, 22]], [3000, [24, 33, 24]], [5000, [32, 36, 26]],
                [8000, [40, 38, 30]], [11000, [48, 46, 40]]],
        shade: 0.35,
    },
};

function bandColor(bands, h) {
    let c = bands[0][1];
    for (const [at, col] of bands) { if (h >= at) c = col; else break; }
    return c;
}

/** A canvas, one pixel per grid sample, of tinted and hill-shaded terrain. */
export function renderRelief(dem, style) {
    const pal = PALETTES[style] || PALETTES.radar;
    const { n, ft, water, step } = dem;
    const cv = document.createElement('canvas');
    cv.width = n; cv.height = n;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(n, n);
    const cellFt = step * 6076;
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const k = j * n + i, o = k * 4;
            let rgb;
            if (water[k]) rgb = pal.water;
            else {
                rgb = bandColor(pal.bands, ft[k]);
                // Light from the northwest; slopes facing it brighten, the far side darkens.
                const w = ft[j * n + Math.max(0, i - 1)], e = ft[j * n + Math.min(n - 1, i + 1)];
                const nn = ft[Math.max(0, j - 1) * n + i], s = ft[Math.min(n - 1, j + 1) * n + i];
                const dx = (e - w) / (2 * cellFt), dy = (s - nn) / (2 * cellFt);
                const lit = Math.max(-1, Math.min(1, (-dx - dy) * 6));
                const f = 1 + lit * pal.shade;
                rgb = rgb.map(v => Math.max(0, Math.min(255, v * f)));
            }
            img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    return cv;
}

/**
 * Minimum vectoring altitudes on a square sector grid. `floor` is the lowest
 * MVA the field allows (the game's flat minimum).
 */
export function buildMva(dem, floor, cellNm = 5, scopeNm = 40) {
    const cells = Math.ceil(scopeNm * 2 / cellNm);
    const vals = new Int32Array(cells * cells);
    const buffer = 3;                                     // NM around the sector
    const per = Math.round(1 / dem.step);
    for (let cj = 0; cj < cells; cj++) {
        for (let ci = 0; ci < cells; ci++) {
            const xMin = -scopeNm + ci * cellNm - buffer, xMax = xMin + cellNm + 2 * buffer;
            const yMax = scopeNm - cj * cellNm + buffer, yMin = yMax - cellNm - 2 * buffer;
            let hi = 0, lo = Infinity;
            for (let y = yMin; y <= yMax; y += dem.step * per / 2) {
                for (let x = xMin; x <= xMax; x += dem.step * per / 2) {
                    const h = terrainAt(dem, x, y);
                    if (h > hi) hi = h;
                    if (h < lo) lo = h;
                }
            }
            // Rugged sectors get the 2,000 ft mountainous clearance.
            const clearance = hi - lo > 2000 ? 2000 : 1000;
            // Up to the next 500 ft, so neighbouring cells merge into sectors the way a real chart's do.
            vals[cj * cells + ci] = Math.max(floor, Math.ceil((hi + clearance) / 500) * 500);
        }
    }
    return { cellNm, scopeNm, cells, vals, labels: sectorLabels(vals, cells, cellNm, scopeNm) };
}

/** One label per sector: each connected run of equal-MVA cells, labelled at the cell nearest its middle. */
function sectorLabels(vals, cells, cellNm, scopeNm) {
    const seen = new Uint8Array(cells * cells);
    const labels = [];
    for (let start = 0; start < cells * cells; start++) {
        if (seen[start]) continue;
        const v = vals[start], members = [], stack = [start];
        seen[start] = 1;
        while (stack.length) {
            const k = stack.pop(); members.push(k);
            const i = k % cells, j = (k / cells) | 0;
            for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const ni = i + di, nj = j + dj, nk = nj * cells + ni;
                if (ni < 0 || nj < 0 || ni >= cells || nj >= cells || seen[nk] || vals[nk] !== v) continue;
                seen[nk] = 1; stack.push(nk);
            }
        }
        const centre = k => [-scopeNm + (k % cells + 0.5) * cellNm, scopeNm - (((k / cells) | 0) + 0.5) * cellNm];
        const pts = members.map(centre);
        const mx = pts.reduce((t, p) => t + p[0], 0) / pts.length, my = pts.reduce((t, p) => t + p[1], 0) / pts.length;
        let best = pts[0], bd = Infinity;
        for (const p of pts) { const d = (p[0] - mx) ** 2 + (p[1] - my) ** 2; if (d < bd) { bd = d; best = p; } }
        if (Math.hypot(best[0], best[1]) < scopeNm) labels.push({ x: best[0], y: best[1], v });
    }
    return labels;
}

/** The MVA covering a point. */
export function mvaAt(mva, x, y) {
    const ci = Math.floor((x + mva.scopeNm) / mva.cellNm), cj = Math.floor((mva.scopeNm - y) / mva.cellNm);
    if (ci < 0 || cj < 0 || ci >= mva.cells || cj >= mva.cells) return 0;
    return mva.vals[cj * mva.cells + ci];
}
