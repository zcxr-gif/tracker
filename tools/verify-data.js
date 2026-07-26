#!/usr/bin/env node
/**
 * verify-data.js
 *
 * Checks that the generated runtime data files are correct and current:
 *
 *     node tools/verify-data.js
 *
 * Exits non-zero if any check fails, so it can gate CI. Run it after
 * tools/build-data.js, and in CI on every change.
 *
 * It answers three questions the build script itself cannot:
 *
 *  1. Are the committed files what the current sources and the current build
 *     script actually produce? The generated tiers are committed artefacts, so
 *     they go stale silently — refresh airports.json from upstream, forget to
 *     re-run the build, and the app ships a database that disagrees with the
 *     file it was generated from. Nothing in the repo noticed. This
 *     re-derives every tier in memory and compares digests.
 *
 *  2. Do the files hold what consumers assume? The app reads these with very
 *     little defensive code — coordinates go straight into distance maths and
 *     size classes straight into map filters — so the assumptions are worth
 *     stating in one place and enforcing.
 *
 *  3. Is the size classification still sane? A refactor of the surface parsing
 *     or the thresholds can't fail loudly: it just quietly reclassifies
 *     thousands of airports and degrades the map. The golden set and the
 *     distribution bands below are the tripwire.
 *
 * The transforms come from build-data.js rather than being reimplemented here.
 * A verifier holding its own copy of the rules would drift from the generator
 * and start certifying the wrong thing.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
    ROOT,
    COORD_DECIMALS,
    SIZE_MAJOR, SIZE_LARGE, SIZE_MEDIUM, SIZE_SMALL, SIZE_MINIMAL,
    isCoreKey,
    readJson,
    summarizeRunways,
    computeAirportTiers,
    computeRunwayTiers,
    loadRunwayRecords,
} = require('./build-data.js');

// ── Check harness ───────────────────────────────────────────────────────────

let failures = 0;
let passes = 0;

/**
 * @param {string} name
 * @param {() => (true | string)} fn  Returns true, or a message describing the
 *   failure. Throwing is also treated as a failure, so a check can just index
 *   into data it expects to exist.
 */
function check(name, fn) {
    let result;
    try {
        result = fn();
    } catch (e) {
        result = `threw: ${e && e.message ? e.message : e}`;
    }
    if (result === true) {
        passes++;
        console.log(`  ok    ${name}`);
    } else {
        failures++;
        console.log(`  FAIL  ${name}\n          ${result}`);
    }
}

function section(title) {
    console.log(`\n${title}`);
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const readRaw = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

// Number of decimal places in a value as written. Reads the serialized form
// because that is what ships and what the precision claim is about.
function decimals(n) {
    const s = String(n);
    const dot = s.indexOf('.');
    if (dot < 0 || s.includes('e') || s.includes('E')) return 0;
    return s.length - dot - 1;
}

// ── 1. Freshness ────────────────────────────────────────────────────────────

// Regenerating is deterministic: key order follows the source files' own
// ordering and every numeric transform is a pure rounding, so a byte-for-byte
// match is the right test and any difference is a real one.
function verifyFreshness() {
    section('Generated files match the sources');

    const runways = loadRunwayRecords();
    const airports = readJson('airports.json');

    const expectedRunways = computeRunwayTiers(runways.records);
    const expectedAirports = computeAirportTiers(
        airports.data, summarizeRunways(runways.records));

    const pairs = [
        ['airports-core.json', expectedAirports.core],
        ['airports-extra.json', expectedAirports.extra],
        ['runways-core.json', expectedRunways.core],
        ['runways-extra.json', expectedRunways.extra],
    ];

    for (const [name, expected] of pairs) {
        check(`${name} is current`, () => {
            const onDisk = readRaw(name);
            const rebuilt = JSON.stringify(expected);
            if (sha(onDisk) === sha(rebuilt)) return true;
            // Say something more useful than "digests differ" — the usual cause
            // is a source refresh without a rebuild, which shows up as a count
            // change.
            const a = Object.keys(JSON.parse(onDisk)).length;
            const b = Object.keys(expected).length;
            const detail = a === b
                ? `same key count (${a.toLocaleString()}) but different content`
                : `on disk has ${a.toLocaleString()} keys, sources produce ${b.toLocaleString()}`;
            return `stale — ${detail}. Run: node tools/build-data.js`;
        });
    }

    // Boundaries.geojson is rewritten in place, so the check is idempotency:
    // rounding already-rounded coordinates must be a no-op. If it isn't, the
    // committed file was not produced by the current build script.
    check('Boundaries.geojson is rounded in place', () => {
        const { data } = readJson('Boundaries.geojson');
        let over = 0;
        const walk = (a) => {
            if (typeof a[0] === 'number') {
                if (decimals(a[0]) > 4 || decimals(a[1]) > 4) over++;
                return;
            }
            a.forEach(walk);
        };
        for (const f of data.features) walk(f.geometry.coordinates);
        return over === 0
            ? true
            : `${plural(over, 'coordinate')} carry more than 4 decimals. Run: node tools/build-data.js`;
    });
}

// ── 2. Tier invariants ──────────────────────────────────────────────────────

function verifyAirportTiers() {
    section('Airport tiers');

    const core = JSON.parse(readRaw('airports-core.json'));
    const extra = JSON.parse(readRaw('airports-extra.json'));

    check('every core key is an ICAO location indicator', () => {
        const bad = Object.keys(core).filter(k => !isCoreKey(k));
        return bad.length === 0 ? true
            : `${plural(bad.length, 'key')} are not [A-Z]{4}: ${bad.slice(0, 5).join(', ')}`;
    });

    check('no ICAO-shaped key hides in the supplementary tier', () => {
        const bad = Object.keys(extra).filter(isCoreKey);
        return bad.length === 0 ? true
            : `${plural(bad.length, 'key')} belong in the core tier: ${bad.slice(0, 5).join(', ')}`;
    });

    check('the tiers are disjoint', () => {
        const overlap = Object.keys(core).filter(k => k in extra);
        return overlap.length === 0 ? true
            : `${plural(overlap.length, 'key')} appear in both: ${overlap.slice(0, 5).join(', ')}`;
    });

    // Coordinates feed great-circle distance and Mapbox directly; a null or an
    // out-of-range value is a crash or a marker at the wrong end of the earth.
    check('coordinates are present, in range, and not over-precise', () => {
        const problems = [];
        let count = 0;
        for (const tier of [core, extra]) {
            for (const key of Object.keys(tier)) {
                const a = tier[key];
                let problem = null;
                if (typeof a.lat !== 'number' || typeof a.lon !== 'number' ||
                    !isFinite(a.lat) || !isFinite(a.lon)) {
                    problem = `${key} has non-numeric coordinates`;
                } else if (Math.abs(a.lat) > 90 || Math.abs(a.lon) > 180) {
                    problem = `${key} is outside the world (${a.lat}, ${a.lon})`;
                } else if (decimals(a.lat) > COORD_DECIMALS || decimals(a.lon) > COORD_DECIMALS) {
                    problem = `${key} carries more than ${COORD_DECIMALS} decimals`;
                }
                if (!problem) continue;
                count++;
                if (problems.length < 5) problems.push(problem);
            }
        }
        return count === 0 ? true
            : `${plural(count, 'entry')}: ${problems.join('; ')}`;
    });

    check('every airport has a name', () => {
        const bad = [];
        let count = 0;
        for (const tier of [core, extra]) {
            for (const key of Object.keys(tier)) {
                const name = tier[key].name;
                if (typeof name === 'string' && name.trim()) continue;
                count++;
                if (bad.length < 5) bad.push(key);
            }
        }
        return count === 0 ? true
            : `${plural(count, 'entry')} have no usable name: ${bad.join(', ')}`;
    });

    // The class is written only when non-minimal, so 0 must never appear on
    // disk: consumers read a missing `s` as minimal and writing it would be
    // ~30 KB restating the default.
    check(`size class is an integer ${SIZE_SMALL}-${SIZE_MAJOR} when present`, () => {
        const bad = [];
        let count = 0;
        for (const tier of [core, extra]) {
            for (const key of Object.keys(tier)) {
                const s = tier[key].s;
                if (s === undefined) continue;
                if (Number.isInteger(s) && s >= SIZE_SMALL && s <= SIZE_MAJOR) continue;
                count++;
                if (bad.length < 5) bad.push(`${key}=${JSON.stringify(s)}`);
            }
        }
        return count === 0 ? true
            : `${plural(count, 'entry')} out of range: ${bad.join(', ')}`;
    });
}

// See the identifier check below — upstream carries a small number of runways
// with no end identifier at all.
const MAX_UNIDENTIFIED_RUNWAYS = 400;

function verifyRunwayTiers() {
    section('Runway tiers');

    const core = JSON.parse(readRaw('runways-core.json'));
    const extra = JSON.parse(readRaw('runways-extra.json'));

    check('every key maps to a non-empty runway list', () => {
        const bad = [];
        let count = 0;
        for (const tier of [core, extra]) {
            for (const key of Object.keys(tier)) {
                if (Array.isArray(tier[key]) && tier[key].length > 0) continue;
                count++;
                if (bad.length < 5) bad.push(key);
            }
        }
        return count === 0 ? true
            : `${plural(count, 'key')} hold no runways: ${bad.join(', ')}`;
    });

    check('no core-shaped key in the supplementary runway tier', () => {
        const bad = Object.keys(extra).filter(isCoreKey);
        return bad.length === 0 ? true
            : `${plural(bad.length, 'key')} belong in the core tier: ${bad.slice(0, 5).join(', ')}`;
    });

    // These are dropped by design — airport_ident because it becomes the index
    // key, the rest because nothing reads them. A leak means dead weight on
    // every request for the file.
    check('dropped fields stay dropped', () => {
        const dropped = ['id', 'airport_ref', 'airport_ident',
            'le_displaced_threshold_ft', 'he_displaced_threshold_ft'];
        const seen = new Set();
        for (const tier of [core, extra]) {
            for (const key of Object.keys(tier)) {
                for (const r of tier[key]) {
                    for (const f of dropped) if (f in r) seen.add(f);
                }
            }
        }
        return seen.size === 0 ? true : `present again: ${[...seen].join(', ')}`;
    });

    check('null fields are omitted rather than written', () => {
        let nulls = 0;
        for (const tier of [core, extra]) {
            for (const key of Object.keys(tier)) {
                for (const r of tier[key]) {
                    for (const f of Object.keys(r)) if (r[f] === null) nulls++;
                }
            }
        }
        return nulls === 0 ? true : `${plural(nulls, 'null value')} written out`;
    });

    // Runway end identifiers drive takeoff/landing detection and the alignment
    // maths, so a runway without one is unusable. 232 source records genuinely
    // have neither, and they are almost all sub-100 ft surfaces — helipads
    // recorded as runways — so this is upstream data, not something the split
    // introduced. Tracked with a ceiling: a jump would mean the field stopped
    // being carried through, which would silently disable phase detection.
    check(`at most ${MAX_UNIDENTIFIED_RUNWAYS} runways lack both end identifiers`, () => {
        let count = 0;
        const sample = [];
        for (const tier of [core, extra]) {
            for (const key of Object.keys(tier)) {
                for (const r of tier[key]) {
                    if (r.le_ident || r.he_ident) continue;
                    count++;
                    if (sample.length < 5) sample.push(key);
                }
            }
        }
        if (count <= MAX_UNIDENTIFIED_RUNWAYS) {
            console.log(`        ${plural(count, 'unidentified runway')} (upstream; mostly helipads)`);
            return true;
        }
        return `${plural(count, 'runway')} have no usable identifier, e.g. ${sample.join(', ')}`;
    });
}

// ── 3. Size classification ──────────────────────────────────────────────────

// Airports whose class is not a judgement call. Every one is a major
// international airport with a long paved runway and scheduled service, so any
// change that drops one below major has broken the surface parsing, the
// thresholds, or the join between the two source databases. Deliberately spread
// across regions so a region-specific data problem can't hide.
const GOLDEN_MAJOR = [
    'EGLL', 'EGKK', 'LFPG', 'EDDF', 'EHAM', 'LEMD', 'LIRF', 'LTFM', 'UUEE',
    'KJFK', 'KLAX', 'KATL', 'KORD', 'KDFW', 'KSFO', 'CYYZ', 'MMMX',
    'RJTT', 'RJAA', 'RKSI', 'ZBAA', 'ZSPD', 'VHHH', 'WSSS', 'WMKK', 'VTBS',
    'OMDB', 'OTHH', 'VIDP', 'VABB', 'FAOR', 'HECA', 'DNMM',
    'YSSY', 'YMML', 'NZAA', 'SBGR', 'SAEZ', 'SCEL', 'SKBO',
];

// Airports that must never be labelled on the map: no open runway, so the
// zoom filter should drop them at every zoom.
const GOLDEN_MINIMAL = [
    'RJTI', // Tokyo Heliport
];

function verifySizeClasses() {
    section('Airport size classes');

    const core = JSON.parse(readRaw('airports-core.json'));
    const sizeOf = (icao) => (core[icao] ? (core[icao].s || SIZE_MINIMAL) : null);

    check(`${GOLDEN_MAJOR.length} known hubs classify as major`, () => {
        const missing = GOLDEN_MAJOR.filter(i => sizeOf(i) === null);
        if (missing.length) return `not in the core tier: ${missing.join(', ')}`;
        const wrong = GOLDEN_MAJOR
            .filter(i => sizeOf(i) !== SIZE_MAJOR)
            .map(i => `${i}=${sizeOf(i)}`);
        return wrong.length === 0 ? true
            : `expected ${SIZE_MAJOR}, got ${wrong.join(', ')}`;
    });

    check('runway-less fields stay minimal', () => {
        const wrong = GOLDEN_MINIMAL
            .filter(i => sizeOf(i) !== null && sizeOf(i) !== SIZE_MINIMAL)
            .map(i => `${i}=${sizeOf(i)}`);
        return wrong.length === 0 ? true
            : `expected ${SIZE_MINIMAL}, got ${wrong.join(', ')}`;
    });

    // Bands, not exact counts: the sources get refreshed and the numbers should
    // be free to drift. They are wide enough that ordinary upstream churn never
    // trips them, and narrow enough to catch a systemic break — if surface
    // parsing stopped recognising "ASPH-G", the major count would collapse.
    const BANDS = {
        [SIZE_MAJOR]: [1500, 3200],
        [SIZE_LARGE]: [1000, 3000],
        [SIZE_MEDIUM]: [2000, 5000],
    };
    const histogram = [0, 0, 0, 0, 0];
    for (const key of Object.keys(core)) histogram[core[key].s || SIZE_MINIMAL]++;

    for (const tier of Object.keys(BANDS)) {
        const [lo, hi] = BANDS[tier];
        check(`core tier-${tier} count within ${lo.toLocaleString()}-${hi.toLocaleString()}`, () => {
            const n = histogram[tier];
            return n >= lo && n <= hi ? true
                : `${n.toLocaleString()} airports — outside the expected band, which means the ` +
                  `classification rules changed behaviour. Confirm intended, then update the band.`;
        });
    }

    console.log(`        core distribution: ${histogram.map((n, i) => `${i}:${n.toLocaleString()}`).join('  ')}`);
}

// ── 4. Cross-source agreement ───────────────────────────────────────────────

// The two source databases are independent — airports.json and runways.json
// come from different upstreams — so they disagree about which fields exist.
// Runway records for an airport absent from the airport database are inert:
// nothing can look them up, because every lookup starts from an airport. They
// are tracked rather than fixed, with a ceiling, because a sudden jump would
// mean the join broke (an identifier format change upstream, say) rather than
// the usual handful of stragglers.
const MAX_ORPHANED_RUNWAY_KEYS = 500;

function verifyCrossSource() {
    section('Cross-source agreement');

    const airports = {
        ...JSON.parse(readRaw('airports-core.json')),
        ...JSON.parse(readRaw('airports-extra.json')),
    };
    const runwayKeys = [
        ...Object.keys(JSON.parse(readRaw('runways-core.json'))),
        ...Object.keys(JSON.parse(readRaw('runways-extra.json'))),
    ];

    check(`at most ${MAX_ORPHANED_RUNWAY_KEYS} runway keys lack an airport record`, () => {
        const orphans = runwayKeys.filter(k => !(k in airports));
        if (orphans.length <= MAX_ORPHANED_RUNWAY_KEYS) {
            console.log(`        ${plural(orphans.length, 'orphaned runway key')} (inert; nothing can look them up)`);
            return true;
        }
        return `${plural(orphans.length, 'orphaned key')} — the join between the two ` +
            `source databases has likely broken: ${orphans.slice(0, 5).join(', ')}`;
    });
}

// ── Run ─────────────────────────────────────────────────────────────────────

verifyFreshness();
verifyAirportTiers();
verifyRunwayTiers();
verifySizeClasses();
verifyCrossSource();

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
