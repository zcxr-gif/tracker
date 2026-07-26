#!/usr/bin/env node
/**
 * build-airport-data.js
 *
 * Splits the monolithic airports.json (~11.6 MB, 82,659 entries) into the two
 * files the app actually loads:
 *
 *   airports-core.json   4-letter ICAO fields only (~19,000). Everything the
 *                        app needs to function: map markers, coordinate
 *                        lookups for live flights, nearest-METAR-station
 *                        search, country flags, the major-airport layer.
 *                        Boot waits on this one.
 *
 *   airports-extra.json  Everything else (~63,700) — US local identifiers
 *                        (US-8626), numeric-prefixed strips (00A, 1B2),
 *                        heliports and seaplane bases. Nothing looks these up
 *                        by key; they exist so global search can find them.
 *                        Fetched in the background after first paint and
 *                        merged into the same object.
 *
 * Every consumer indexes airportsData[icao] with a real ICAO code taken from
 * live flight data, ATC, or a user selection, so the split is invisible to
 * them. The one code path that iterates the whole DB is the search index,
 * which rebuilds itself when the extra tier lands.
 *
 * Coordinates are rounded to 5 decimal places (~1 m). The source carries up to
 * 7 (~1 cm), which is far beyond anything here — the finest use is a
 * great-circle distance quoted in kilometres.
 *
 * Usage:  node tools/build-airport-data.js
 *
 * Re-run this whenever airports.json is updated; airports.json stays the
 * source of truth and doubles as a runtime fallback if the split files are
 * ever missing.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'airports.json');
const CORE_OUT = path.join(ROOT, 'airports-core.json');
const EXTRA_OUT = path.join(ROOT, 'airports-extra.json');

const COORD_DECIMALS = 5;

// A "core" airport is one addressable by a real ICAO location indicator. This
// must stay in sync with the filters the boot path applies (findNearestAirports
// and the major-airport layer both accept exactly [A-Z]{4}); widening it is
// safe, narrowing it is not.
const isCoreKey = (key) => /^[A-Z]{4}$/.test(key);

function roundCoord(n) {
    if (typeof n !== 'number' || !isFinite(n)) return n;
    const f = 10 ** COORD_DECIMALS;
    return Math.round(n * f) / f;
}

function compact(entry) {
    const out = {
        name: entry.name,
        lat: roundCoord(entry.lat),
        lon: roundCoord(entry.lon),
        country: entry.country,
    };
    // iata is present on only ~9,000 records; keep it sparse.
    if (entry.iata) out.iata = entry.iata;
    return out;
}

function main() {
    if (!fs.existsSync(SOURCE)) {
        console.error(`Source not found: ${SOURCE}`);
        process.exit(1);
    }

    const raw = fs.readFileSync(SOURCE, 'utf8');
    const all = JSON.parse(raw);

    const core = {};
    const extra = {};
    for (const key of Object.keys(all)) {
        const entry = all[key];
        if (!entry) continue;
        (isCoreKey(key) ? core : extra)[key] = compact(entry);
    }

    const coreJson = JSON.stringify(core);
    const extraJson = JSON.stringify(extra);

    fs.writeFileSync(CORE_OUT, coreJson);
    fs.writeFileSync(EXTRA_OUT, extraJson);

    const mb = (s) => (s.length / 1048576).toFixed(2) + ' MB';
    const gz = (s) => (zlib.gzipSync(s, { level: 9 }).length / 1024).toFixed(0) + ' KB';
    const n = (o) => Object.keys(o).length.toLocaleString();

    console.log(`source  airports.json        ${n(all).padStart(7)} entries  ${mb(raw).padStart(9)}  ${gz(raw).padStart(8)} gzipped`);
    console.log(`  ->    airports-core.json   ${n(core).padStart(7)} entries  ${mb(coreJson).padStart(9)}  ${gz(coreJson).padStart(8)} gzipped   (blocking)`);
    console.log(`  ->    airports-extra.json  ${n(extra).padStart(7)} entries  ${mb(extraJson).padStart(9)}  ${gz(extraJson).padStart(8)} gzipped   (lazy)`);

    // Guard the invariant the app depends on: nothing in the lazy tier may be
    // reachable by a key-based lookup on the boot path.
    const leaked = Object.keys(extra).filter(isCoreKey);
    if (leaked.length) {
        console.error(`\nERROR: ${leaked.length} core-shaped keys landed in the extra tier.`);
        process.exit(1);
    }

    // Guard against silent data loss in the split itself.
    if (Object.keys(core).length + Object.keys(extra).length !== Object.keys(all).length) {
        console.error('\nERROR: entry count changed across the split.');
        process.exit(1);
    }
}

main();
