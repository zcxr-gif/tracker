#!/usr/bin/env node
/**
 * build-nav.mjs
 *
 * Builds the real waypoints and instrument procedures the Approach game
 * (/approach) uses at US airports, one small file per airport:
 *
 *     node tools/build-nav.mjs            # fetches the current data from npm
 *     node tools/build-nav.mjs <dir>      # or reads already-unpacked packages
 *
 * Source: the @squawk data packages on npm (MIT), which are FAA data:
 *   - @squawk/procedure-data  SIDs, STARs and instrument approaches (FAA CIFP)
 *   - @squawk/fix-data        waypoints and reporting points (FAA NASR)
 *   - @squawk/navaid-data     VORs, NDBs and the like (FAA NASR)
 * Re-run it every 28 days (the AIRAC cycle) to stay current.
 *
 * Output: nav/<ICAO>.json for every airport with a SID, a STAR or an ILS/LOC/
 * RNAV approach, plus nav/index.json listing them with the cycle date. Each
 * file holds:
 *   fix:  { ID: [lat, lon, kind] }  every fix the procedures use, plus all
 *         waypoints and navaids within 45 NM (kind F fix, V VOR-ish, N NDB)
 *   star, sid: [{ id, routes: [{ t: transition name or "", legs }] }]
 *   iap:  [{ id, name, rwy, type, routes: [{ t, legs }] }]
 * where a leg is [fix or null, altitude ft or null, altitude descriptor
 * ("+" at or above, "-" at or below, "B" between, "" at, ...), speed kt or
 * null, path terminator, role ("A" IAF, "I" IF, "F" FAF, "M" MAP, "")].
 * Coordinates are rounded to 4 decimals (~11 m).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'nav');
const RADIUS_NM = 45;
const PACKAGES = { procedures: 'procedure-data', fixes: 'fix-data', navaids: 'navaid-data' };

/** The gzipped data file inside an npm tarball (a .tgz is gzip + plain ustar). */
function fromTarball(tgz, name) {
    const tar = zlib.gunzipSync(tgz);
    for (let at = 0; at + 512 <= tar.length;) {
        const file = tar.subarray(at, at + 100).toString().replace(/\0.*$/s, '');
        if (!file) break;
        const size = parseInt(tar.subarray(at + 124, at + 136).toString().replace(/\0.*$/s, '').trim() || '0', 8);
        if (file.endsWith(`data/${name}.json.gz`)) return tar.subarray(at + 512, at + 512 + size);
        at += 512 + Math.ceil(size / 512) * 512;
    }
    throw new Error(`no data/${name}.json.gz in the package`);
}

async function load(key) {
    const pkg = PACKAGES[key];
    const local = process.argv[2] && path.join(process.argv[2], pkg, 'package', 'data', `${key}.json.gz`);
    let gz;
    if (local && fs.existsSync(local)) gz = fs.readFileSync(local);
    else {
        const meta = await (await fetch(`https://registry.npmjs.org/@squawk%2f${pkg}`)).json();
        const v = meta['dist-tags'].latest;
        console.log(`@squawk/${pkg}@${v}`);
        gz = fromTarball(Buffer.from(await (await fetch(meta.versions[v].dist.tarball)).arrayBuffer()), key);
    }
    return JSON.parse(zlib.gunzipSync(gz));
}

const r4 = n => Math.round(n * 1e4) / 1e4;
const nm = (a, b) => {
    const R = 3440.065, toR = Math.PI / 180;
    const dLat = (b[0] - a[0]) * toR, dLon = (b[1] - a[1]) * toR;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
};
const navKind = t => (/NDB/.test(t) ? 'N' : 'V');

function leg(l, fixes) {
    const id = l.fixIdentifier || null;
    if (id && l.lat != null && !fixes[id]) fixes[id] = [r4(l.lat), r4(l.lon), l.category === 'NAVAID' ? 'V' : 'F'];
    const a = l.altitudeConstraint || {}, s = l.speedConstraint || {};
    const role = l.isInitialApproachFix ? 'A' : l.isIntermediateFix ? 'I' : l.isFinalApproachFix ? 'F' : l.isMissedApproachPoint ? 'M' : '';
    return [id, a.primaryFt ?? null, a.descriptor || '', s.speedKt ?? null, l.pathTerminator, role];
}

function routes(rec, fixes) {
    const out = [];
    for (const r of rec.commonRoutes || []) out.push({ t: '', legs: r.legs.map(l => leg(l, fixes)) });
    for (const r of rec.transitions || []) out.push({ t: r.name || '', legs: r.legs.map(l => leg(l, fixes)) });
    return out;
}

const [procs, fixData, navData] = [await load('procedures'), await load('fixes'), await load('navaids')];
const cycle = procs.meta.cifpCycleDate;
const airports = JSON.parse(fs.readFileSync(path.join(ROOT, 'airports-core.json'), 'utf8'));

// Procedures by airport (K-prefixed ICAO where the FAA uses a 3-letter id).
const byApt = new Map();
for (const rec of procs.records) {
    if (rec.type === 'IAP' && !/^(ILS|LOC|RNAV|GPS)/.test(rec.approachType || '')) continue;
    for (const a of rec.airports || []) {
        const icao = airports[a] ? a : airports['K' + a] ? 'K' + a : null;
        if (!icao) continue;
        if (!byApt.has(icao)) byApt.set(icao, []);
        byApt.get(icao).push(rec);
    }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const index = {};
let bytes = 0;
for (const [icao, recs] of byApt) {
    if (!recs.some(r => r.type !== 'IAP' || /^(ILS|LOC)/.test(r.approachType || ''))) continue;   // only fields with a SID, STAR or ILS
    const apt = [airports[icao].lat, airports[icao].lon];
    const fix = {};
    const out = { icao, cycle, fix, star: [], sid: [], iap: [] };
    for (const r of recs) {
        if (r.type === 'IAP') out.iap.push({ id: r.identifier, name: r.name, rwy: r.runway || '', type: r.approachType, routes: routes(r, fix) });
        else out[r.type.toLowerCase()].push({ id: r.identifier, routes: routes(r, fix) });
    }
    for (const f of fixData.records) if (!fix[f.identifier] && Math.abs(f.lat - apt[0]) < 1 && nm(apt, [f.lat, f.lon]) <= RADIUS_NM) fix[f.identifier] = [r4(f.lat), r4(f.lon), 'F'];
    for (const n of navData.records) if (!fix[n.identifier] && Math.abs(n.lat - apt[0]) < 1 && nm(apt, [n.lat, n.lon]) <= RADIUS_NM) fix[n.identifier] = [r4(n.lat), r4(n.lon), navKind(n.type)];
    const txt = JSON.stringify(out);
    fs.writeFileSync(path.join(OUT, `${icao}.json`), txt);
    bytes += txt.length;
    index[icao] = [out.sid.length, out.star.length, out.iap.length];
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ cycle, airports: index }));
console.log(`${Object.keys(index).length} airports, ${(bytes / 1e6).toFixed(1)} MB, cycle ${cycle}`);
