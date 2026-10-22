#!/usr/bin/env node
/**
 * build-navaids.mjs
 *
 * Builds nav/navaids.json: every VOR, NDB and DME in the world, for the
 * Approach game's generated procedures at airports without published data
 * (approachNavGen.js anchors STARs and SIDs on them).
 *
 *     node tools/build-navaids.mjs            # fetches OurAirports' navaids.csv
 *     node tools/build-navaids.mjs <file.csv> # or reads a downloaded copy
 *
 * Source: OurAirports (https://github.com/davidmegginson/ourairports-data),
 * public domain. Output: { built, navaids: [[ident, lat, lon, kind], …] },
 * kind V (VOR, VOR-DME, VORTAC, TACAN, DME) or N (NDB, NDB-DME), coordinates
 * to 4 decimals (~11 m).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/navaids.csv';

/** One CSV line into fields (quoted fields may hold commas). */
function fields(line) {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
        else if (c === '"') q = true;
        else if (c === ',') { out.push(cur); cur = ''; }
        else cur += c;
    }
    out.push(cur);
    return out;
}

const csv = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : await (await fetch(URL)).text();
const lines = csv.split(/\r?\n/).filter(Boolean);
const head = fields(lines[0]), col = name => head.indexOf(name);
const [ID, TYPE, LAT, LON] = ['ident', 'type', 'latitude_deg', 'longitude_deg'].map(col);
const r4 = n => Math.round(n * 1e4) / 1e4;
const navaids = [];
for (const line of lines.slice(1)) {
    const f = fields(line), lat = Number(f[LAT]), lon = Number(f[LON]), id = (f[ID] || '').trim().toUpperCase();
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    navaids.push([id, r4(lat), r4(lon), /NDB/.test(f[TYPE]) ? 'N' : 'V']);
}
fs.mkdirSync(path.join(ROOT, 'nav'), { recursive: true });
const txt = JSON.stringify({ built: new Date().toISOString().slice(0, 10), navaids });
fs.writeFileSync(path.join(ROOT, 'nav', 'navaids.json'), txt);
console.log(`${navaids.length} navaids, ${(txt.length / 1e3).toFixed(0)} kB`);
