#!/usr/bin/env node
/**
 * build-data.js
 *
 * Regenerates the runtime data files the app fetches, from the two bundled
 * reference databases. Run it whenever airports.json or runways.json is
 * refreshed from upstream:
 *
 *     node tools/build-data.js
 *
 * Both databases are split the same way, for the same reason: the app only
 * ever resolves them by a real ICAO location indicator taken from live flight
 * data, ATC, or a user selection. Entries keyed by anything else — US local
 * identifiers (US-8626), numeric-prefixed strips (00A, 1B2), heliports and
 * seaplane bases — are reachable only by picking one out of global search, so
 * they are pushed into a supplementary tier that loads separately.
 *
 *   airports.json  11.6 MB  ->  airports-core.json   + airports-extra.json
 *   runways.json   24.8 MB  ->  runways-core.json    + runways-extra.json
 *
 * The core tiers are what every functional lookup resolves against; the
 * supplementary tiers exist so nothing is lost when a user does reach for an
 * obscure field. The originals stay in the repo as the regeneration source and
 * as a runtime fallback, so a deploy missing the generated files degrades to
 * the old behaviour instead of breaking.
 *
 * Runways get two further treatments:
 *   - they ship pre-indexed by airport, which is the shape the app built at
 *     runtime anyway, so the indexing pass over 47,161 records disappears and
 *     the ident stops being repeated on every record;
 *   - null fields are omitted. Ten of the twenty fields are null on 65-94% of
 *     records, and every consumer tests with `!= null` or truthiness, for
 *     which a missing key behaves identically.
 *
 * Coordinates are rounded to 5 decimal places (~1 m); the sources carry up to
 * 7 (~1 cm), far beyond anything that reads them — the finest use is a
 * great-circle distance quoted in kilometres. Runway headings are left at full
 * precision: rounding them saved nothing measurable and they feed wind-
 * component maths, so there is no reason to touch them.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');

const COORD_DECIMALS = 5;

// A "core" key is a real ICAO location indicator. This must stay in sync with
// the filters the boot path applies (findNearestAirports and the major-airport
// layer both accept exactly [A-Z]{4}); widening it is safe, narrowing it is not.
const isCoreKey = (key) => /^[A-Z]{4}$/.test(key);

// Runway fields the app never reads. `airport_ident` goes too: it becomes the
// index key, so repeating it inside every record is pure weight.
const RUNWAY_DROP_FIELDS = new Set([
    'id',
    'airport_ref',
    'airport_ident',
    'le_displaced_threshold_ft',
    'he_displaced_threshold_ft',
]);

const round = (n, decimals) => {
    if (typeof n !== 'number' || !isFinite(n)) return n;
    const f = 10 ** decimals;
    return Math.round(n * f) / f;
};

function readJson(name) {
    const p = path.join(ROOT, name);
    if (!fs.existsSync(p)) {
        console.error(`Source not found: ${p}`);
        process.exit(1);
    }
    const raw = fs.readFileSync(p, 'utf8');
    return { raw, data: JSON.parse(raw) };
}

const mb = (s) => (s.length / 1048576).toFixed(2) + ' MB';
const kbGz = (s) => (zlib.gzipSync(s, { level: 9 }).length / 1024).toFixed(0) + ' KB';

function write(name, json, entries, note) {
    fs.writeFileSync(path.join(ROOT, name), json);
    console.log(`  -> ${name.padEnd(21)} ${String(entries.toLocaleString()).padStart(7)} ${note.padEnd(9)} ${mb(json).padStart(9)}  ${kbGz(json).padStart(8)} gzipped`);
}

// ── Airports ────────────────────────────────────────────────────────────────

function buildAirports() {
    const { raw, data } = readJson('airports.json');
    console.log(`airports.json          ${String(Object.keys(data).length.toLocaleString()).padStart(7)} fields    ${mb(raw).padStart(9)}  ${kbGz(raw).padStart(8)} gzipped`);

    const core = {};
    const extra = {};
    for (const key of Object.keys(data)) {
        const a = data[key];
        if (!a) continue;
        const entry = {
            name: a.name,
            lat: round(a.lat, COORD_DECIMALS),
            lon: round(a.lon, COORD_DECIMALS),
            country: a.country,
        };
        // iata is present on only ~9,000 records; keep it sparse.
        if (a.iata) entry.iata = a.iata;
        (isCoreKey(key) ? core : extra)[key] = entry;
    }

    const total = Object.keys(core).length + Object.keys(extra).length;
    assert(total === Object.keys(data).length, 'airport entry count changed across the split');
    assert(!Object.keys(extra).some(isCoreKey), 'core-shaped airport keys landed in the extra tier');

    write('airports-core.json', JSON.stringify(core), Object.keys(core).length, 'fields');
    write('airports-extra.json', JSON.stringify(extra), Object.keys(extra).length, 'fields');
}

// ── Runways ─────────────────────────────────────────────────────────────────

function compactRunway(r) {
    const out = {};
    for (const field of Object.keys(r)) {
        if (RUNWAY_DROP_FIELDS.has(field)) continue;
        const v = r[field];
        if (v === null || v === undefined) continue; // consumers treat missing as null
        if (field.endsWith('_latitude_deg') || field.endsWith('_longitude_deg')) {
            out[field] = round(v, COORD_DECIMALS);
        } else {
            // Headings are deliberately left alone: the source carries two
            // decimals, rounding them saved nothing measurable, and they feed
            // wind-component and alignment maths.
            out[field] = v;
        }
    }
    return out;
}

function buildRunways() {
    const { raw, data } = readJson('runways.json');
    const records = Array.isArray(data) ? data : Object.values(data).flat();
    console.log(`runways.json           ${String(records.length.toLocaleString()).padStart(7)} runways   ${mb(raw).padStart(9)}  ${kbGz(raw).padStart(8)} gzipped`);

    // Ship pre-indexed by airport — the shape the app used to build at runtime.
    const core = {};
    const extra = {};
    let kept = 0;
    for (const r of records) {
        const key = r.airport_ident;
        if (!key) continue;
        const bucket = isCoreKey(key) ? core : extra;
        (bucket[key] || (bucket[key] = [])).push(compactRunway(r));
        kept++;
    }

    assert(kept === records.filter(r => r.airport_ident).length, 'runway count changed across the split');
    assert(!Object.keys(extra).some(isCoreKey), 'core-shaped runway keys landed in the extra tier');

    write('runways-core.json', JSON.stringify(core), Object.keys(core).length, 'airports');
    write('runways-extra.json', JSON.stringify(extra), Object.keys(extra).length, 'airports');
}

// ── FIR boundaries ──────────────────────────────────────────────────────────

// Boundary coordinates ship with up to 16 decimal places — sub-atomic
// precision on polygons that span hundreds of kilometres and are drawn as
// 0.8px lines. Six is already ~6 cm; four is ~5.6 m, which is far finer than
// any pixel these ever occupy at map scale.
const BOUNDARY_DECIMALS = 4;

function buildBoundaries() {
    const name = 'Boundaries.geojson';
    if (!fs.existsSync(path.join(ROOT, name))) return; // optional input
    const { raw, data } = readJson(name);

    let points = 0;
    const roundRing = (a) => {
        if (typeof a[0] === 'number') {
            points++;
            return [round(a[0], BOUNDARY_DECIMALS), round(a[1], BOUNDARY_DECIMALS)];
        }
        return a.map(roundRing);
    };

    const out = {
        type: data.type,
        features: data.features.map(f => ({
            type: f.type,
            properties: f.properties,
            geometry: { type: f.geometry.type, coordinates: roundRing(f.geometry.coordinates) },
        })),
    };

    const json = JSON.stringify(out);
    console.log(`${name}     ${String(data.features.length.toLocaleString()).padStart(7)} sectors   ${mb(raw).padStart(9)}  ${kbGz(raw).padStart(8)} gzipped`);

    assert(out.features.length === data.features.length, 'boundary feature count changed');
    fs.writeFileSync(path.join(ROOT, name), json);
    console.log(`  -> ${name.padEnd(21)} ${String(points.toLocaleString()).padStart(7)} points    ${mb(json).padStart(9)}  ${kbGz(json).padStart(8)} gzipped   (in place)`);
}

function assert(condition, message) {
    if (!condition) {
        console.error(`\nERROR: ${message}`);
        process.exit(1);
    }
}

buildAirports();
console.log('');
buildRunways();

console.log("");
buildBoundaries();
