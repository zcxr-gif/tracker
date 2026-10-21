/**
 * approachTiles.js — the airport surface from the live map's own sources.
 *
 * The live map draws taxiways and runways from its base map's vector tiles
 * (the `aeroway` layer of Mapbox Streets, or of OpenMapTiles on the free
 * OpenFreeMap engine), and gates from our backend (/api/gates/{ICAO}, see
 * fetchAirportGates in flight.js). This module reads exactly those:
 *
 *   - fetches the vector tiles covering the field at z14 and decodes their
 *     `aeroway` layer (a small Mapbox Vector Tile / protobuf reader — no
 *     library);
 *   - fetches the field's gates from the backend;
 *   - returns them as GeoJSON features shaped like airportLayout.js's, so
 *     approachGround.js builds the taxi network the same way whatever the
 *     source.
 *
 * Tiles cut lines at their edges and simplify them, so the pieces don't share
 * exact points the way OSM ways do; approachGround.js joins them back up.
 */

const BACKEND = 'https://site--indgo-backend--6dmjph8ltlhv.code.run';
const ZOOM = 14;

/* ---------------- protobuf + Mapbox Vector Tile reader ---------------- */

function reader(buf) {
    let pos = 0;
    const varint = () => {
        let res = 0, shift = 0, b;
        do { b = buf[pos++]; res += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80);
        return res;
    };
    return {
        get pos() { return pos; },
        eof: () => pos >= buf.length,
        varint,
        tag() { const t = varint(); return [t >>> 3, t & 7]; },
        bytes() { const len = varint(); const b = buf.subarray(pos, pos + len); pos += len; return b; },
        skip(wire) {
            if (wire === 0) varint();
            else if (wire === 1) pos += 8;
            else if (wire === 2) pos += varint();
            else if (wire === 5) pos += 4;
            else throw new Error('bad wire type ' + wire);
        },
        packed() { const end = varint() + pos, out = []; while (pos < end) out.push(varint()); return out; },
        f32() { const v = new DataView(buf.buffer, buf.byteOffset + pos, 4).getFloat32(0, true); pos += 4; return v; },
        f64() { const v = new DataView(buf.buffer, buf.byteOffset + pos, 8).getFloat64(0, true); pos += 8; return v; },
    };
}
const utf8 = new TextDecoder();
const zigzag = n => (n >>> 1) ^ -(n & 1);

function readValue(buf) {
    const r = reader(buf);
    let v = null;
    while (!r.eof()) {
        const [f, w] = r.tag();
        if (f === 1) v = utf8.decode(r.bytes());
        else if (f === 2) v = r.f32();
        else if (f === 3) v = r.f64();
        else if (f === 4 || f === 5) v = r.varint();
        else if (f === 6) v = zigzag(r.varint());
        else if (f === 7) v = !!r.varint();
        else r.skip(w);
    }
    return v;
}

function readFeature(buf) {
    const r = reader(buf);
    const ft = { tags: [], type: 0, geom: [] };
    while (!r.eof()) {
        const [f, w] = r.tag();
        if (f === 2) ft.tags = r.packed();
        else if (f === 3) ft.type = r.varint();
        else if (f === 4) ft.geom = r.packed();
        else r.skip(w);
    }
    return ft;
}

/** One layer of a decoded tile: { extent, features: [{ type, props, rings: [[[x, y]...]...] }] }. */
export function decodeLayer(buf, name) {
    const r = reader(buf);
    while (!r.eof()) {
        const [f, w] = r.tag();
        if (f !== 3 || w !== 2) { r.skip(w); continue; }
        const lr = reader(r.bytes());
        let lname = '', extent = 4096;
        const keys = [], values = [], raw = [];
        while (!lr.eof()) {
            const [lf, lw] = lr.tag();
            if (lf === 1) lname = utf8.decode(lr.bytes());
            else if (lf === 2) raw.push(lr.bytes());
            else if (lf === 3) keys.push(utf8.decode(lr.bytes()));
            else if (lf === 4) values.push(readValue(lr.bytes()));
            else if (lf === 5) extent = lr.varint();
            else lr.skip(lw);
        }
        if (lname !== name) continue;
        const features = raw.map(b => {
            const ft = readFeature(b), props = {};
            for (let i = 0; i + 1 < ft.tags.length; i += 2) props[keys[ft.tags[i]]] = values[ft.tags[i + 1]];
            // Geometry commands: MoveTo 1, LineTo 2, ClosePath 7, with zigzag deltas.
            const rings = [];
            let x = 0, y = 0, ring = null;
            for (let i = 0; i < ft.geom.length;) {
                const cmd = ft.geom[i] & 7, count = ft.geom[i] >>> 3;
                i++;
                if (cmd === 7) { if (ring && ring.length) ring.push(ring[0]); continue; }
                for (let k = 0; k < count; k++) {
                    x += zigzag(ft.geom[i++]); y += zigzag(ft.geom[i++]);
                    if (cmd === 1) { ring = []; rings.push(ring); }
                    ring.push([x, y]);
                }
            }
            return { type: ft.type, props, rings };
        });
        return { extent, features };
    }
    return null;
}

/* ---------------- tiles ---------------- */

const tileX = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const tileY = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };
const lonOf = (x, z) => x / 2 ** z * 360 - 180;
const latOf = (y, z) => { const n = Math.PI * (1 - 2 * y / 2 ** z); return Math.atan(Math.sinh(n)) * 180 / Math.PI; };

async function fetchTile(url) {
    const r = await fetch(url);
    if (r.status === 204 || r.status === 404) return null;              // empty tile
    if (!r.ok) throw new Error(`tile ${r.status}`);
    let buf = new Uint8Array(await r.arrayBuffer());
    // Some servers hand back gzip without saying so.
    if (buf[0] === 0x1f && buf[1] === 0x8b && typeof DecompressionStream !== 'undefined') {
        buf = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    }
    return buf;
}

/**
 * Taxiways (and aprons) in a lat/lon box from one tile source, as GeoJSON
 * features with properties { aeroway, ref }. `kindOf` reads a feature's kind
 * from its properties (Mapbox: `type`; OpenMapTiles: `class`).
 */
async function aerowayFromTiles(template, box, kindOf) {
    const x0 = tileX(box.w, ZOOM), x1 = tileX(box.e, ZOOM), y0 = tileY(box.n, ZOOM), y1 = tileY(box.s, ZOOM);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64) throw new Error('airport too big for tiles');
    const jobs = [];
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        const url = template.replace('{z}', ZOOM).replace('{x}', tx).replace('{y}', ty);
        jobs.push(fetchTile(url).then(buf => ({ tx, ty, buf })));
    }
    const tiles = await Promise.all(jobs);
    const features = [];
    for (const { tx, ty, buf } of tiles) {
        if (!buf) continue;
        const layer = decodeLayer(buf, 'aeroway');
        if (!layer) continue;
        const E = layer.extent;
        const toLonLat = ([px, py]) => [lonOf(tx + px / E, ZOOM), latOf(ty + py / E, ZOOM)];
        for (const f of layer.features) {
            const kind = kindOf(f.props);
            if (f.type === 2 && (kind === 'taxiway' || kind === 'taxilane')) {
                for (const ring of f.rings) {
                    if (ring.length < 2) continue;
                    features.push({ type: 'Feature', properties: { aeroway: kind, ref: f.props.ref || f.props.name || '' }, geometry: { type: 'LineString', coordinates: ring.map(toLonLat) } });
                }
            } else if (f.type === 3 && kind === 'apron') {
                for (const ring of f.rings) if (ring.length > 3) features.push({ type: 'Feature', properties: { aeroway: 'apron' }, geometry: { type: 'Polygon', coordinates: [ring.map(toLonLat)] } });
            } else if (f.type === 1 && (kind === 'gate' || kind === 'parking_position')) {
                for (const ring of f.rings) for (const p of ring) features.push({ type: 'Feature', properties: { aeroway: kind, ref: f.props.ref || f.props.name || '' }, geometry: { type: 'Point', coordinates: toLonLat(p) } });
            }
        }
    }
    if (!features.some(f => f.properties.aeroway === 'taxiway' || f.properties.aeroway === 'taxilane')) throw new Error('no taxiways in the tiles');
    return features;
}

/** The live map's Mapbox token, from the same config function flight.js reads. Null on the free engine. */
async function mapboxToken() {
    const r = await fetch('/.netlify/functions/config');
    if (!r.ok) throw new Error(`config ${r.status}`);
    const c = await r.json();
    if (c.useFreeMap || !c.mapboxToken) throw new Error('the live map is on the free engine');
    return c.mapboxToken;
}

export async function aerowayFromMapbox(box) {
    const token = await mapboxToken();
    return aerowayFromTiles(`https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/{z}/{x}/{y}.vector.pbf?access_token=${encodeURIComponent(token)}`,
        box, p => p.type);
}

export async function aerowayFromOpenFreeMap(box) {
    // The tile URL carries a build date, so ask the TileJSON for the current one.
    const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json();
    const template = tj.tiles && tj.tiles[0];
    if (!template) throw new Error('no OpenFreeMap tile URL');
    return aerowayFromTiles(template, box, p => p.class);
}

/** The field's gates from our backend, as GeoJSON points (the shapes fetchAirportGates in flight.js handles). */
export async function gatesFromBackend(icao) {
    const r = await fetch(`${BACKEND}/api/gates/${encodeURIComponent(icao)}`);
    if (!r.ok) throw new Error(`gates ${r.status}`);
    const data = await r.json();
    const list = Array.isArray(data) ? data : data.gates || data.data || [];
    const out = [];
    for (const g of list) {
        const lat = g.latitude ?? g.lat ?? g.location?.lat ?? g.location?.latitude ?? (Array.isArray(g.location?.coordinates) ? g.location.coordinates[1] : undefined);
        const lon = g.longitude ?? g.lon ?? g.location?.lon ?? g.location?.longitude ?? (Array.isArray(g.location?.coordinates) ? g.location.coordinates[0] : undefined);
        if (lat == null || lon == null) continue;
        out.push({ type: 'Feature', properties: { aeroway: 'gate', ref: String(g.name || g.ident || g.gateName || g.ref || g.id || '').replace(/^(gate|stand)\s+/i, '') }, geometry: { type: 'Point', coordinates: [Number(lon), Number(lat)] } });
    }
    if (!out.length) throw new Error('no gates listed');
    return out;
}

export const _internals = { tileX, tileY, lonOf, latOf };
