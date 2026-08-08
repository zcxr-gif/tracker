// test-aircraft-shapes.js — the vendored aircraft planform set.
//
// The artwork has to be looked at; a test cannot do that. What it can do is
// stop the three ways this breaks without anybody noticing.
//
// A category with no shape file. `_resolveAircraftCategory()` in flight.js
// returns one of a closed set of keys. If one of them maps to a filename that
// is not in vendor/aircraft-shapes, that aircraft silently falls back to the
// sprite sheet — and only for pilots who happen to fly that type, which is the
// slowest possible way to find out.
//
// A missing licence. The artwork is GPL-3.0 and is redistributed on the
// strength of the licence text travelling with it. A vendor directory that has
// lost its LICENSE is a compliance problem, not a cosmetic one, so it is
// asserted like any other requirement.
//
// A sizing curve that has stopped being sane. The shapes are drawn to true
// relative scale — an A388 really is seven times a C172 — and are compressed
// before use. Compress too little and half the fleet is invisible; too much and
// every aircraft is the same blob.
//
// Run:  node tools/test-aircraft-shapes.js
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const VENDOR = path.join(ROOT, 'vendor', 'aircraft-shapes');

let pass = 0; let fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log(`  ✓ ${name}`); pass++; }
    else { console.error(`  ✗ ${name}${extra ? `\n      ${extra}` : ''}`); fail++; }
};

// Read the category list out of flight.js rather than restating it, so a new
// aircraft type added there shows up here as a failure instead of as a gap.
function categoriesFromFlightJs() {
    const src = fs.readFileSync(path.join(ROOT, 'flight.js'), 'utf8');
    const start = src.indexOf('function _resolveAircraftCategory');
    if (start < 0) return null;
    const body = src.slice(start, src.indexOf('\n}', start));
    const found = new Set();
    for (const m of body.matchAll(/return\s+'([A-Z0-9_-]+)'/g)) found.add(m[1]);
    const generic = /const GENERIC_AIRCRAFT_CATEGORY\s*=\s*'([A-Z0-9_-]+)'/.exec(src);
    if (generic) found.add(generic[1]);
    return [...found];
}

(async () => {
    console.log('\nAircraft planform set\n');

    global.window = { devicePixelRatio: 2 };
    const mod = await import(pathToFileURL(path.join(ROOT, 'aircraftShapes.js')).href);
    const {
        SHAPE_FILE, LOGICAL_SIZE, scaleForSpan,
        MIN_SCALE, MAX_SCALE, BASE_FILL
    } = mod._internals;

    /* ---- the artwork is actually here ---- */
    ok('the vendored shape directory exists',
        fs.existsSync(VENDOR), `expected ${VENDOR}`);

    const svgs = fs.existsSync(VENDOR)
        ? fs.readdirSync(VENDOR).filter(f => f.endsWith('.svg')).map(f => f.replace(/\.svg$/, ''))
        : [];
    ok('the full published set is vendored, not just the files in use',
        svgs.length > 150, `found ${svgs.length} SVGs`);

    /* ---- licence obligations ---- */
    const licence = path.join(VENDOR, 'LICENSE');
    ok('the GPL-3.0 licence text travels with the artwork',
        fs.existsSync(licence)
        && /GNU GENERAL PUBLIC LICENSE/i.test(fs.readFileSync(licence, 'utf8'))
        && /Version 3/i.test(fs.readFileSync(licence, 'utf8')),
        'vendor/aircraft-shapes/LICENSE is missing or is not the GPL-3.0');

    ok('the vendor directory says whose work this is',
        fs.existsSync(path.join(VENDOR, 'README.md'))
        && /RexKramer1/.test(fs.readFileSync(path.join(VENDOR, 'README.md'), 'utf8')));

    const terms = fs.readFileSync(path.join(ROOT, 'terms.html'), 'utf8');
    ok('the Terms of Service carry the attribution',
        /AircraftShapesSVG/.test(terms) && /GNU General Public License/.test(terms)
        && /RexKramer1/.test(terms),
        'the ToS attribution is the one the licence and the product decision both rely on');

    /* ---- coverage ---- */
    const categories = categoriesFromFlightJs();
    ok('the category list can still be read out of flight.js',
        Array.isArray(categories) && categories.length > 5,
        '_resolveAircraftCategory changed shape — this test is now blind');

    if (categories) {
        const unmapped = categories.filter(c => !SHAPE_FILE[c]);
        ok('every category flight.js can produce has a shape mapped',
            unmapped.length === 0, `no shape for: ${unmapped.join(', ')}`);

        const dangling = categories
            .filter(c => SHAPE_FILE[c])
            .filter(c => !svgs.includes(SHAPE_FILE[c]));
        ok('every mapped shape file is actually present',
            dangling.length === 0,
            dangling.map(c => `${c} -> ${SHAPE_FILE[c]}.svg`).join(', '));
    }

    const missingFiles = Object.entries(SHAPE_FILE).filter(([, f]) => !svgs.includes(f));
    ok('the whole mapping table points at files that exist',
        missingFiles.length === 0,
        missingFiles.map(([k, f]) => `${k} -> ${f}`).join(', '));

    /* ---- sizing ---- */
    // Spans measured from the artwork itself, in the 80-unit viewBox the set
    // is drawn in. These are the real numbers, not invented ones.
    const SPAN = { A388: 79.4, B744: 71.0, B77W: 70.4, B738: 41.1, DH8D: 34.2, C172: 11.1, EC35: 12.0, F16: 16.2 };

    ok('the reference aircraft comes out at unity',
        Math.abs(scaleForSpan(SPAN.B738) - 1) < 0.02,
        `a B738 scaled to ${scaleForSpan(SPAN.B738).toFixed(3)}`);

    ok('a widebody is drawn bigger than a narrowbody, which is bigger than a light single',
        scaleForSpan(SPAN.A388) > scaleForSpan(SPAN.B738)
        && scaleForSpan(SPAN.B738) > scaleForSpan(SPAN.C172));

    // The point of compressing: true scale is 7:1, which makes the Cessna
    // three pixels when the A380 reads. Around 2:1 keeps the cue and keeps
    // everything visible.
    const ratio = scaleForSpan(SPAN.A388) / scaleForSpan(SPAN.C172);
    ok('the size range is compressed to something usable, not the true 7:1',
        ratio > 1.6 && ratio < 3.0, `A380:C172 renders at ${ratio.toFixed(2)}:1`);

    ok('every scale stays inside its bounds',
        Object.values(SPAN).every(s => scaleForSpan(s) >= MIN_SCALE - 1e-9
                                    && scaleForSpan(s) <= MAX_SCALE + 1e-9));

    ok('nothing is drawn larger than the icon box',
        Object.values(SPAN).every(s => scaleForSpan(s) * BASE_FILL <= 1),
        'an aircraft scaled past the box gets clipped at the sprite edge');

    ok('the smallest aircraft is still worth drawing',
        scaleForSpan(SPAN.C172) * BASE_FILL > 0.35,
        'a light single would be a smudge at map sizes');

    /* ---- registration contract ---- */
    ok('shapes register at the same logical size as the sprite sheet',
        LOGICAL_SIZE === 128,
        'flight.js registers markers.png tiles against 128; the two must agree '
        + 'or icon-size means something different per set');

    /* ---- the sheet still has to cover what the shapes do not ---- */
    const flightSrc = fs.readFileSync(path.join(ROOT, 'flight.js'), 'utf8');
    ok('the shape loader runs before the sheet rather than instead of it',
        !/registerAircraftShapeIcons[\s\S]{0,400}?\n\s*return;/.test(flightSrc),
        'the sheet must still run afterwards — it supplies the airport markers, '
        + 'which no aircraft set has');

    console.log(`\n${pass} passing${fail ? `, ${fail} failing` : ''}\n`);
    process.exit(fail === 0 ? 0 : 1);
})();
