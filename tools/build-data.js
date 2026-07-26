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
 *
 * Airports additionally carry a derived size class (`s`, 0-4) computed from
 * runway geometry — see the size-class section below for what it means and why
 * it is built here rather than at runtime.
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

// ── Airport size classes ────────────────────────────────────────────────────
//
// Every airport gets a coarse size class 0-4 in the `s` field. It exists
// because the map draws ICAO labels for all ~13,700 filterable airports in one
// symbol layer with text-allow-overlap:false — so Mapbox resolves label
// collisions itself, and with nothing to rank by it kept whichever label the
// source happened to list first. At low zoom that meant a 700 m grass strip
// routinely winning over the international airport 20 km away. The class feeds
// a symbol-sort-key so the bigger field wins, and a zoom filter so the small
// ones don't compete at all until they're worth showing.
//
// It replaces a runtime pass that scored airports by testing their *name*
// against a substring blocklist (water/seaplane/heliport/strip/field/glider).
// That pass had to walk every key in chunks across animation frames to avoid
// janking the map, and being name-based it both missed unnamed strips and
// discarded real airports (anything called "... Field"). Runway geometry is
// the property actually being reasoned about, it is already in the source, and
// it does not change between deploys — so it belongs here.
//
//   4  major    hard runway >= 8000 ft and an IATA code   — intercontinental
//   3  large    hard runway >= 8000 ft, or >= 6000 ft with IATA
//   2  medium   hard runway >= 4000 ft
//   1  small    has at least one open runway of any kind
//   0  minimal  no open runway in the source (heliports, seaplane bases,
//               closed fields, and the ~5,300 core entries carrying no runway
//               record at all)
//
// Thresholds are in feet against the longest *open* runway. 8000 ft is about
// the practical floor for a loaded widebody, 6000 ft for a narrowbody, and
// 4000 ft separates fields built for turbine traffic from light-aircraft
// strips. The IATA condition breaks the tie between a long military runway and
// a commercial airport of the same length: scheduled passenger service is what
// makes a field worth naming at world zoom, and an IATA code is the only
// proxy for it in this data.
const SIZE_MAJOR = 4;
const SIZE_LARGE = 3;
const SIZE_MEDIUM = 2;
const SIZE_SMALL = 1;
const SIZE_MINIMAL = 0;

// Paved-surface materials. The source's `surface` field is free text with 564
// distinct values, and most carry a condition suffix — ASPH-G is asphalt in
// good condition, TURF-P is turf in poor condition — so the field is tokenised
// on separators and a runway counts as hard if any token names a hard
// material. That reads ASPH-G and ASPH/ CONC as paved and TURF-G as not, which
// is the intent. Mixed surfaces (ASPH-TURF, CONC-TURF) count as paved: they
// have a paved portion, and the class is deliberately coarse.
//
// Single-letter codes (C, G, S, B, L, N, X) are left soft on purpose. C is
// probably concrete and G probably grass, but they are unlabelled and total
// ~1,300 records; guessing wrong on an ambiguous code would silently promote
// strips into the tier that outranks real airports for a label slot.
const HARD_SURFACE_TOKENS = new Set([
    'ASP', 'ASPH', 'ASPHALT', 'ASPHALTE', 'BLACKTOP',
    'CON', 'CONC', 'CONCRETE', 'CEMENT',
    'PEM', 'PER', 'PAV', 'PAVED', 'PAVEMENT',
    'BIT', 'BITUMEN', 'BITUMINOUS',
    'TAR', 'TARMAC', 'MAC', 'MACADAM', 'COP', 'COMP', 'COMPOSITE',
]);

const SURFACE_SPLIT_RE = /[^A-Z0-9]+/;

const isHardSurface = (surface) => {
    if (surface == null) return false;
    for (const token of String(surface).toUpperCase().split(SURFACE_SPLIT_RE)) {
        if (token && HARD_SURFACE_TOKENS.has(token)) return true;
    }
    return false;
};

/**
 * Reduce an airport's runway records to just what the size class needs.
 * Closed runways are excluded: a decommissioned 10,000 ft runway does not make
 * the field a major airport today.
 */
function summarizeRunways(records) {
    const summary = new Map();
    for (const r of records) {
        const key = r.airport_ident;
        if (!key || r.closed === 1) continue;

        let s = summary.get(key);
        if (!s) summary.set(key, (s = { maxLen: 0, maxHardLen: 0, open: 0 }));
        s.open++;

        const len = typeof r.length_ft === 'number' && isFinite(r.length_ft) ? r.length_ft : 0;
        if (len > s.maxLen) s.maxLen = len;
        // Tracked separately so a long soft strip beside a short paved runway
        // can't be read as a long paved runway.
        if (len > s.maxHardLen && isHardSurface(r.surface)) s.maxHardLen = len;
    }
    return summary;
}

function classifySize(summary, hasIata) {
    if (!summary || !summary.open) return SIZE_MINIMAL;
    const hard = summary.maxHardLen;
    if (hard >= 8000) return hasIata ? SIZE_MAJOR : SIZE_LARGE;
    if (hard >= 6000 && hasIata) return SIZE_LARGE;
    if (hard >= 4000) return SIZE_MEDIUM;
    return SIZE_SMALL;
}

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

/**
 * Pure transform: source airport map + runway summary -> the two tiers.
 * Split out from buildAirports so tools/verify-data.js can re-derive the tiers
 * and compare them against what's committed without reimplementing any of this.
 */
function computeAirportTiers(data, runwaySummary) {
    const core = {};
    const extra = {};
    const sizeHistogram = [0, 0, 0, 0, 0];
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

        const size = classifySize(runwaySummary.get(key), !!a.iata);
        sizeHistogram[size]++;
        // Omitted when minimal: 0 is the value every consumer already falls
        // back to for an airport it can't find a class for, so writing it out
        // would be ~30 KB of `"s":0` restating the default. Consumers detect
        // whether classes are available at all from the tier they loaded, not
        // from the presence of this key on a given record.
        if (size !== SIZE_MINIMAL) entry.s = size;

        (isCoreKey(key) ? core : extra)[key] = entry;
    }
    return { core, extra, sizeHistogram };
}

function buildAirports(runwaySummary) {
    const { raw, data } = readJson('airports.json');
    console.log(`airports.json          ${String(Object.keys(data).length.toLocaleString()).padStart(7)} fields    ${mb(raw).padStart(9)}  ${kbGz(raw).padStart(8)} gzipped`);

    const { core, extra, sizeHistogram } = computeAirportTiers(data, runwaySummary);

    const total = Object.keys(core).length + Object.keys(extra).length;
    assert(total === Object.keys(data).length, 'airport entry count changed across the split');
    assert(!Object.keys(extra).some(isCoreKey), 'core-shaped airport keys landed in the extra tier');
    assert(sizeHistogram[SIZE_MAJOR] > 0, 'no airport classified major — runway summary likely empty');

    write('airports-core.json', JSON.stringify(core), Object.keys(core).length, 'fields');
    write('airports-extra.json', JSON.stringify(extra), Object.keys(extra).length, 'fields');
    console.log(`     size classes      ${String(sizeHistogram[4].toLocaleString()).padStart(7)} major     ${String(sizeHistogram[3].toLocaleString()).padStart(7)} large   ` +
        `${String(sizeHistogram[2].toLocaleString()).padStart(7)} medium  ${String(sizeHistogram[1].toLocaleString()).padStart(7)} small  ${String(sizeHistogram[0].toLocaleString()).padStart(7)} minimal`);
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

/**
 * Reads and normalises runways.json to a flat record array. Split out from
 * buildRunways because the airport size classes are derived from the same
 * records, and this is a 24.8 MB parse worth doing exactly once.
 */
function loadRunwayRecords() {
    const { raw, data } = readJson('runways.json');
    return { raw, records: Array.isArray(data) ? data : Object.values(data).flat() };
}

/**
 * Pure transform: flat runway records -> the two pre-indexed tiers.
 * Ships in the shape the app used to build at runtime. See computeAirportTiers
 * for why the compute step is separable.
 */
function computeRunwayTiers(records) {
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
    return { core, extra, kept };
}

function buildRunways({ raw, records }) {
    console.log(`runways.json           ${String(records.length.toLocaleString()).padStart(7)} runways   ${mb(raw).padStart(9)}  ${kbGz(raw).padStart(8)} gzipped`);

    const { core, extra, kept } = computeRunwayTiers(records);

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

function main() {
    // runways.json is the source for both the runway tiers and the airport size
    // classes, so it is parsed once here and handed to both stages.
    const runways = loadRunwayRecords();

    buildAirports(summarizeRunways(runways.records));
    console.log('');
    buildRunways(runways);

    console.log('');
    buildBoundaries();
}

if (require.main === module) main();

// Exported for tools/verify-data.js, which re-derives the generated files from
// the sources and compares. Sharing the transforms is the point: a verifier
// with its own copy of the rules would drift from the generator and start
// certifying the wrong thing.
module.exports = {
    ROOT,
    COORD_DECIMALS,
    SIZE_MAJOR, SIZE_LARGE, SIZE_MEDIUM, SIZE_SMALL, SIZE_MINIMAL,
    isCoreKey,
    isHardSurface,
    round,
    readJson,
    summarizeRunways,
    classifySize,
    computeAirportTiers,
    computeRunwayTiers,
    loadRunwayRecords,
};
