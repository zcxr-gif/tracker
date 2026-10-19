/**
 * aircraftModels.js
 * -------------------------------------------------------------------
 * Which 3D model the map draws for each aeroplane, and getting it.
 *
 * The models are FlightGear's AI traffic — fgdata's AI/Aircraft
 * (https://gitlab.com/flightgear/fgdata/-/tree/next/AI/Aircraft): a
 * low-poly AC3D model per type, with a texture for each airline that flies
 * it. None of it is shipped with the site. A model, and a livery for it, is
 * fetched from GitLab the first time an aeroplane of that type and airline
 * is on screen, pinned to the commit fgAircraft.data.js was built from (so
 * nothing upstream can change what is drawn), kept in the browser's Cache
 * Storage, and read here — see ac3d.js. Every model is GPL v2; its authors
 * are in the data file and the credit is in Settings.
 *
 * Choosing one is two steps, as in the iOS app's AircraftModelCatalog: the
 * aeroplane is named by its ICAO type designator (Infinite Flight's names
 * — "Boeing 737-800", "Airbus A320neo" — are read into one), then the
 * collection is asked for that designator, and failing that for the nearest
 * thing it has: a 737 MAX becomes a 737-800, an A320neo an A320. Nothing
 * falls back to a different *kind* of aeroplane: a fighter, a helicopter or
 * a balloon keeps its flat icon rather than turning into an airliner.
 * ===================================================================
 */

import { parseAC3D } from './ac3d.js';
import { FG_COMMIT, FG_MODELS } from './fgAircraft.data.js';

const FILES_API = 'https://gitlab.com/api/v4/projects/flightgear%2Ffgdata/repository/files/';
const CACHE_NAME = 'fg-ai-aircraft-v1';
// Largest a livery is kept, on either side. The sources are 1024 or 2048
// square; on a map an airliner is rarely more than a few hundred pixels long.
const TEXTURE_MAX = 512;
const MAX_FETCHES = 4;

// --- Naming an aircraft ------------------------------------------------

const designatorCache = new Map();

/**
 * The ICAO type designator for an Infinite Flight aircraft name, or null
 * when there is no model that would be honest for it. Order matters: the
 * variant before the family it belongs to.
 */
export function designatorForName(name) {
    if (!name) return null;
    if (designatorCache.has(name)) return designatorCache.get(name);
    const flat = String(name).toUpperCase().replace(/[-\s]/g, '');
    const has = (...needles) => needles.some((n) => flat.includes(n));
    const resolve = () => {
        // Things there is no fair model for: keep the icon.
        if (has('F14', 'F16', 'F18', 'F22', 'F35', 'THUNDERBOLT', 'FAIRCHILD', 'SPITFIRE', 'P38', 'EUROFIGHTER',
            'TYPHOON', 'B2SPIRIT', 'HERCULES', 'C130', 'GLOBEMASTER', 'KC10', 'KC135', 'SENTRY', 'BALLOON',
            'BLIMP')) return null;

        if (has('A2201', 'A220100', 'CS100')) return 'BCS1';
        if (has('A220', 'CS300')) return 'BCS3';
        if (has('A318')) return 'A318';
        if (has('A319NEO')) return 'A19N';
        if (has('A319')) return 'A319';
        if (has('A320NEO')) return 'A20N';
        if (has('A320')) return 'A320';
        if (has('A321NEO')) return 'A21N';
        if (has('A321')) return 'A321';
        if (has('A330200')) return 'A332';
        if (has('A330900', 'A330NEO')) return 'A339';
        if (has('A330')) return 'A333';
        if (has('A340600')) return 'A346';
        if (has('A340')) return 'A343';
        if (has('A3501000')) return 'A35K';
        if (has('A350')) return 'A359';
        if (has('A380')) return 'A388';
        if (has('BELUGA')) return 'A3ST';
        if (has('A300')) return 'A306';

        if (has('717')) return 'B712';
        if (has('737MAX8', '7378MAX', '737MAX')) return 'B38M';
        if (has('737600')) return 'B736';
        if (has('737700')) return 'B737';
        if (has('737900')) return 'B739';
        if (has('737')) return 'B738';
        if (has('7478')) return 'B748';
        if (has('747200', '747100', '747SP')) return 'B742';
        if (has('747')) return 'B744';
        if (has('757300')) return 'B753';
        if (has('757')) return 'B752';
        if (has('767200')) return 'B762';
        if (has('767400')) return 'B764';
        if (has('767')) return 'B763';
        if (has('777F', '777200LR')) return 'B77L';
        if (has('7779', '777X')) return 'B779';
        if (has('777200')) return 'B772';
        if (has('777')) return 'B77W';
        if (has('7878')) return 'B788';
        if (has('78710')) return 'B78X';
        if (has('787')) return 'B789';
        if (has('727')) return 'B722';
        if (has('707')) return 'B703';

        if (has('CRJ1000')) return 'CRJX';
        if (has('CRJ900')) return 'CRJ9';
        if (has('CRJ700')) return 'CRJ7';
        if (has('CRJ')) return 'CRJ2';
        if (has('Q400', 'DASH8')) return 'DH8D';
        if (has('E195E2', 'E195E')) return 'E295';
        if (has('E190E2')) return 'E290';
        if (has('E175')) return 'E175';
        if (has('E170')) return 'E170';
        if (has('E195')) return 'E195';
        if (has('E190')) return 'E190';
        if (has('E145', 'ERJ145', 'ERJ')) return 'E145';
        if (has('ATR72')) return 'AT76';
        if (has('ATR42')) return 'AT45';
        if (has('BAE146', 'AVRO', 'RJ85', 'RJ100')) return 'B463';
        if (has('MD11')) return 'MD11';
        if (has('DC10')) return 'DC10';
        if (has('MD90')) return 'MD90';
        if (has('MD80', 'MD82', 'MD83', 'MD88')) return 'MD82';
        if (has('TU154')) return 'T154';
        if (has('TU134')) return 'T134';
        if (has('DC3', 'C47')) return 'DC3';
        if (has('DHC6', 'TWINOTTER')) return 'DHC6';
        if (has('DHC4', 'CARIBOU')) return 'DHC4';
        if (has('FOKKER100', 'F100')) return 'F100';
        if (has('FOKKER70', 'F70')) return 'F70';
        if (has('FOKKER50', 'F50')) return 'F50';

        if (has('CITATIONX')) return 'C750';
        if (has('CITATION', 'CJ4')) return 'C550';
        if (has('CHALLENGER')) return 'CL35';
        if (has('GLOBAL', 'GULFSTREAM')) return 'GLEX';
        if (has('HONDAJET')) return 'HDJT';
        if (has('SF50', 'VISIONJET')) return 'SF50';
        if (has('TBM')) return 'TBM9';
        if (has('PC12')) return 'PC12';
        if (has('PC21')) return 'PC21';
        if (has('C208', 'CARAVAN')) return 'C208';
        if (has('C182')) return 'C182';
        if (has('C172', 'CESSNA172')) return 'C172';
        if (has('SR22')) return 'SR22';
        if (has('SR20')) return 'SR20';
        if (has('XCUB', 'CUB', 'PA18')) return 'PA18';
        if (has('PA28', 'WARRIOR', 'ARCHER', 'CHEROKEE')) return 'P28A';
        if (has('PA32', 'SARATOGA')) return 'PA32';
        if (has('DR400', 'ROBIN')) return 'DR40';
        if (has('DA42', 'TWINSTAR')) return 'DA42';
        if (has('DA62')) return 'DA62';
        if (has('DA40')) return 'DA40';
        if (has('KINGAIR', 'BE20', 'B350')) return 'BE20';
        if (has('BARON', 'BE58')) return 'BE58';

        // An airliner the table has not met yet, rather than nothing: the
        // flat icon's own default is a 737 for the same reason.
        if (has('AIRBUS')) return 'A320';
        if (has('BOEING')) return 'B738';
        return null;
    };
    const out = resolve();
    if (designatorCache.size < 1024) designatorCache.set(name, out);
    return out;
}

// --- Nearest models ----------------------------------------------------

// For each designator, what to draw when the collection has no model of it
// — nearest first, and never a different kind of aircraft.
const NEAREST = (() => {
    const out = {};
    const family = (members, then = []) => {
        for (const m of members) out[m] = members.filter((x) => x !== m).concat(then);
    };
    const a320 = ['A320', 'A321', 'A319', 'A318', 'A20N', 'A21N', 'A19N'];
    const b737 = ['B738', 'B737', 'B739', 'B736', 'B38M', 'B39M', 'B37M', 'B734', 'B733', 'B735', 'B732'];
    family(a320, b737);
    family(['BCS3', 'BCS1', 'A221', 'A223'], ['E195', 'E190', 'A319', 'A320']);
    family(b737, a320);
    family(['B752', 'B753'], ['B738', 'A321']);
    family(['B763', 'B762', 'B764'], ['B788', 'A332', 'A333']);
    family(['B788', 'B789', 'B78X'], ['B763', 'A359', 'A332']);
    family(['B77W', 'B773', 'B772', 'B77L', 'B779', 'B778'], ['A346', 'A359', 'B744']);
    family(['B744', 'B748', 'B742', 'B741', 'B743', 'B74S'], ['A388', 'B77W']);
    family(['A333', 'A332', 'A339', 'A338'], ['A359', 'B788', 'B763']);
    family(['A343', 'A346', 'A342', 'A345'], ['A333', 'B77W']);
    family(['A359', 'A35K'], ['B789', 'A333']);
    family(['A388'], ['B748', 'B744']);
    family(['A3ST'], ['A306', 'A333']);
    family(['A306', 'A310', 'A30B'], ['A333', 'B763']);
    family(['MD11', 'DC10'], ['B77W', 'A333']);
    family(['B712', 'MD82', 'MD81', 'MD83', 'MD87', 'MD88', 'MD90', 'DC93'], ['F100', 'CRJ9', 'E190', 'A319']);
    family(['F100', 'F70'], ['B712', 'E190', 'CRJ9']);
    family(['T154', 'B722', 'B721'], ['B752', 'B738']);
    family(['T134'], ['B712', 'CRJ9']);
    family(['B703', 'B701'], ['B752', 'B738']);
    family(['B463', 'B462', 'B461', 'RJ1H', 'RJ85', 'RJ70'], ['E190', 'BCS1']);

    family(['E190', 'E170', 'E175', 'E75L', 'E75S', 'E195', 'E290', 'E295'], ['CRJ9', 'BCS1', 'A319']);
    family(['CRJ9', 'CRJ7', 'CRJ2', 'CRJX', 'CRJ1'], ['E170', 'E145']);
    family(['E145', 'E135', 'E45X'], ['CRJ2', 'CRJ7']);
    family(['AT76', 'AT75', 'AT72', 'AT73', 'AT45', 'AT43', 'AT44', 'AT46'], ['DH8D', 'DH8C', 'F50', 'SB20', 'SF34']);
    family(['DH8D', 'DH8C', 'DH8A', 'DH8B'], ['AT76', 'AT45', 'SF34']);
    family(['SF34', 'SB20', 'JS41', 'D328', 'D228', 'F50'], ['DH8C', 'AT45']);
    family(['DHC7', 'DHC6', 'DHC4', 'DC3', 'BN2P'], ['DH8C', 'AT45']);

    family(['C550', 'C560', 'C750', 'C56X', 'C680', 'C510', 'C525', 'C25A', 'C25B', 'HDJT', 'SF50', 'E55P', 'E50P',
        'LJ45', 'PC24', 'EA50', 'H25B'], ['CL35', 'CL60']);
    family(['CL35', 'CL30', 'CL60', 'G280', 'F900', 'FA7X', 'E35L'], ['GLEX', 'C550']);
    family(['GLEX', 'GL5T', 'GL7T', 'GLF5', 'GLF6'], ['CL60', 'C550']);

    family(['C172', 'C152', 'C177', 'C182', 'C82R', 'C208'], ['P28A', 'SR22', 'PA32']);
    family(['P28A', 'P28B', 'P28R', 'PA32', 'PA22', 'SR22', 'SR20', 'DA40', 'DR40', 'TBM9', 'PC12', 'PC21', 'ERCO'],
        ['C172', 'C182', 'C208']);
    family(['PA18', 'J3'], ['C172', 'P28A']);
    family(['DA42', 'DA62', 'PA34', 'BE58', 'C310', 'C421', 'C337', 'BE20', 'B350', 'B190', 'BE99'], ['C208', 'PC12']);
    return out;
})();

// Every model that serves a designator, the main one first (fgAircraft.data
// lists it first): a freighter or winglet variant is only reached for a
// livery the main one has not got.
const BY_DESIGNATOR = (() => {
    const out = new Map();
    for (const m of FG_MODELS) {
        for (const d of m.designators) {
            if (!out.has(d)) out.set(d, []);
            out.get(d).push(m);
        }
    }
    return out;
})();

const BY_ID = new Map(FG_MODELS.map((m) => [m.id, m]));

/**
 * What to draw for an aeroplane: `{ model, livery }`, where `livery` is the
 * airline's ICAO code when the model has its paint and '' for the plain
 * one — or null to keep the flat icon.
 */
export function chooseModel(designator, airlineIcao) {
    if (!designator) return null;
    const airline = airlineIcao ? String(airlineIcao).toUpperCase() : '';
    for (const d of [designator].concat(NEAREST[designator] || [])) {
        const models = BY_DESIGNATOR.get(d);
        if (!models) continue;
        if (airline) {
            const painted = models.find((m) => m.liveries[airline]);
            if (painted) return { model: painted, livery: airline };
        }
        return { model: models[0], livery: '' };
    }
    return null;
}

export function modelById(id) {
    return BY_ID.get(id) || null;
}

// --- Fetching ----------------------------------------------------------

export function fileUrl(model, rel) {
    const repoPath = `AI/Aircraft/${model.folder}/${rel}`;
    return `${FILES_API}${encodeURIComponent(repoPath)}/raw?ref=${FG_COMMIT}`;
}

let cachePromise = null;
function openCache() {
    if (!cachePromise) {
        cachePromise = (typeof caches !== 'undefined' ? caches.open(CACHE_NAME) : Promise.reject(new Error('no Cache Storage')))
            .catch(() => null);
    }
    return cachePromise;
}

// GitLab answers unauthenticated API calls up to a few hundred a minute per
// address, with no caching of its own: so a few at a time, and anything it
// turns away waits as long as it asks.
let active = 0;
let pausedUntil = 0;
const queue = [];

function pump() {
    while (active < MAX_FETCHES && queue.length) {
        const wait = pausedUntil - Date.now();
        if (wait > 0) { setTimeout(pump, wait); return; }
        const job = queue.shift();
        active++;
        job().finally(() => { active--; pump(); });
    }
}

function schedule(fn) {
    return new Promise((resolve, reject) => {
        queue.push(() => fn().then(resolve, reject));
        pump();
    });
}

/** A file from the pinned commit: Cache Storage first, then GitLab. */
export function fetchFile(url) {
    return schedule(async () => {
        const cache = await openCache();
        if (cache) {
            try {
                const hit = await cache.match(url);
                if (hit) return hit.arrayBuffer();
            } catch (_) { /* fall through to the network */ }
        }
        for (let attempt = 0; attempt < 3; attempt++) {
            const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
            if (res.status === 429) {
                const after = parseFloat(res.headers.get('retry-after')) || 20;
                pausedUntil = Date.now() + after * 1000;
                await new Promise((r) => setTimeout(r, after * 1000));
                continue;
            }
            if (!res.ok) throw new Error(`${res.status} for ${url}`);
            const body = await res.arrayBuffer();
            if (cache) {
                try { await cache.put(url, new Response(body.slice(0))); } catch (_) { /* full or private mode */ }
            }
            return body;
        }
        throw new Error(`GitLab kept refusing ${url}`);
    });
}

// --- Geometry ----------------------------------------------------------

/**
 * A model's geometry in the engine's frame — metres, right wing +X, roof
 * +Y, nose −Z — with its middle over the origin and its wheels on y = 0, so
 * an aeroplane's reported position is the middle of what is drawn and a
 * parked one sits on the ground. FlightGear's AC3D files have the nose
 * along −X, the roof +Y and the right wing −Z: (x, y, z) → (−z, y, x).
 *
 * Resolves `{ parts: [{ textureIndex, gear, position, normal, uv, color }],
 *             length }`.
 */
const geometryCache = new Map();
export function loadGeometry(model) {
    if (geometryCache.has(model.id)) return geometryCache.get(model.id);
    const p = fetchFile(fileUrl(model, model.file))
        .then((buf) => parseAC3D(new TextDecoder('latin1').decode(buf)))
        .then((ac) => {
            const cx = (ac.min[0] + ac.max[0]) / 2;
            const cz = (ac.min[2] + ac.max[2]) / 2;
            const floor = ac.min[1];
            const parts = ac.parts.map((part) => {
                const pos = part.position;
                const nor = part.normal;
                for (let i = 0; i < pos.length; i += 3) {
                    const x = pos[i] - cx, y = pos[i + 1] - floor, z = pos[i + 2] - cz;
                    pos[i] = -z; pos[i + 1] = y; pos[i + 2] = x;
                    const nx = nor[i], ny = nor[i + 1], nz = nor[i + 2];
                    nor[i] = -nz; nor[i + 1] = ny; nor[i + 2] = nx;
                }
                const name = String(part.texture || '').split(/[\\/]/).pop();
                return { ...part, textureIndex: name ? model.textures.indexOf(name) : -1 };
            });
            return { parts, length: ac.max[0] - ac.min[0] };
        });
    p.catch(() => geometryCache.delete(model.id));
    geometryCache.set(model.id, p);
    return p;
}

// --- Textures ----------------------------------------------------------

/** The repository path of texture `index` in a livery, or null for none. */
export function texturePath(model, livery, index) {
    const entry = livery ? model.liveries[livery] : null;
    if (entry) {
        const dir = Array.isArray(entry) ? entry[0] : entry;
        const mask = Array.isArray(entry) ? entry[1] : ~0;
        if (mask & (1 << index)) return `${dir}/${model.textures[index]}`;
    }
    return model.base[index] || null;
}

/**
 * A texture as a canvas no larger than TEXTURE_MAX, top row first (the way
 * three.js expects with flipY). PNG and JPEG are decoded by the browser;
 * the older models' SGI .rgb files by `decodeSGI`.
 */
const textureCache = new Map();
export function loadTexture(model, rel) {
    const key = `${model.folder}/${rel}`;
    if (textureCache.has(key)) return textureCache.get(key);
    const p = fetchFile(fileUrl(model, rel)).then(async (buf) => {
        let source;
        if (/\.(rgb|rgba|sgi|bw|int|inta)$/i.test(rel)) {
            const img = decodeSGI(new Uint8Array(buf));
            const c = document.createElement('canvas');
            c.width = img.width; c.height = img.height;
            c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
            source = c;
        } else {
            const type = /\.jpe?g$/i.test(rel) ? 'image/jpeg' : 'image/png';
            source = await createImageBitmap(new Blob([buf], { type }));
        }
        const scale = Math.min(1, TEXTURE_MAX / Math.max(source.width, source.height));
        const w = Math.max(1, Math.round(source.width * scale));
        const h = Math.max(1, Math.round(source.height * scale));
        const out = document.createElement('canvas');
        out.width = w; out.height = h;
        out.getContext('2d').drawImage(source, 0, 0, w, h);
        if (source.close) source.close();
        return out;
    });
    p.catch(() => textureCache.delete(key));
    textureCache.set(key, p);
    return p;
}

export function forgetTexture(model, rel) {
    textureCache.delete(`${model.folder}/${rel}`);
}

/**
 * SGI image (.rgb) to RGBA, top row first. Verbatim or RLE, one to four
 * 8-bit channels — what FlightGear's older textures are.
 */
export function decodeSGI(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint16(0) !== 474) throw new Error('Not an SGI image');
    const rle = bytes[2] === 1;
    const bpc = bytes[3];
    const width = view.getUint16(6);
    const height = view.getUint16(8);
    const channels = view.getUint16(10);
    if (bpc !== 1) throw new Error('16-bit SGI images are not supported');
    const data = new Uint8ClampedArray(width * height * 4);
    data.fill(255);
    const put = (row, channel, x, value) => {
        // SGI rows run bottom to top.
        const i = ((height - 1 - row) * width + x) * 4;
        if (channels >= 3) data[i + channel] = value;
        else if (channel === 0) data[i] = data[i + 1] = data[i + 2] = value;
        else data[i + 3] = value;
    };
    if (!rle) {
        let at = 512;
        for (let c = 0; c < channels; c++) {
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) put(y, c, x, bytes[at++]);
            }
        }
    } else {
        for (let c = 0; c < channels; c++) {
            for (let y = 0; y < height; y++) {
                let at = view.getUint32(512 + (c * height + y) * 4);
                let x = 0;
                while (x < width && at < bytes.length) {
                    const pixel = bytes[at++];
                    let count = pixel & 0x7f;
                    if (!count) break;
                    if (pixel & 0x80) {
                        while (count-- && x < width) put(y, c, x++, bytes[at++]);
                    } else {
                        const value = bytes[at++];
                        while (count-- && x < width) put(y, c, x++, value);
                    }
                }
            }
        }
    }
    return { width, height, data };
}

export const FG_CREDIT = 'The 3D aircraft are FlightGear\'s AI traffic models (fgdata, AI/Aircraft), '
    + 'by the authors named in each model, under the GNU GPL v2. '
    + 'https://gitlab.com/flightgear/fgdata/-/tree/next/AI/Aircraft';
