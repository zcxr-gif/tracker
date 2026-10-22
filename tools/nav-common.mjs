/**
 * nav-common.mjs: what the nav tools share with the Approach game. An
 * airport's runway ends as the game builds them (same filter, same flat
 * projection), from airports-core.json and runways-core.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const D2R = Math.PI / 180;
const MIN_LANDING_RWY_FT = 4500;                 // as approachGame.js
const norm = h => ((h % 360) + 360) % 360;
const brg = (dx, dy) => norm(Math.atan2(dx, dy) / D2R);

let data = null;
const load = () => data || (data = {
    airports: JSON.parse(fs.readFileSync(path.join(ROOT, 'airports-core.json'), 'utf8')),
    runways: JSON.parse(fs.readFileSync(path.join(ROOT, 'runways-core.json'), 'utf8')),
});

const usable = r => !r.closed && r.le_latitude_deg != null && r.le_longitude_deg != null && r.he_latitude_deg != null && r.he_longitude_deg != null
    && (r.length_ft || 0) >= MIN_LANDING_RWY_FT && !/grass|turf|water|dirt|gravel|sand|coral|soil/i.test(r.surface || '');

/** The game's view of an airport: { icao, lat, lon, elev, ends, proj }, or null when it isn't playable. */
export function airportWorld(icao) {
    const { airports, runways } = load();
    const ap = airports[icao], rws = (runways[icao] || []).filter(usable);
    if (!ap || !rws.length) return null;
    const cosLat = Math.cos(ap.lat * D2R);
    const proj = (lat, lon) => ({ x: (lon - ap.lon) * 60 * cosLat, y: (lat - ap.lat) * 60 });
    const ends = [], elevs = [];
    rws.forEach((r, i) => {
        const a = proj(r.le_latitude_deg, r.le_longitude_deg), b = proj(r.he_latitude_deg, r.he_longitude_deg), len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 0.5) return;
        if (r.le_elevation_ft != null) elevs.push(r.le_elevation_ft);
        if (r.he_elevation_ft != null) elevs.push(r.he_elevation_ft);
        ends.push({ id: String(r.le_ident), thr: a, far: b, course: brg(b.x - a.x, b.y - a.y), len, phys: i });
        ends.push({ id: String(r.he_ident), thr: b, far: a, course: brg(a.x - b.x, a.y - b.y), len, phys: i });
    });
    const elev = elevs.length ? Math.round(elevs.reduce((s, v) => s + v, 0) / elevs.length) : 0;
    return { icao, lat: ap.lat, lon: ap.lon, elev, ends, proj };
}

export const navaids = () => {
    const f = path.join(ROOT, 'nav', 'navaids.json');
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).navaids : [];
};
