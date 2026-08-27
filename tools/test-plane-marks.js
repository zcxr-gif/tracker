// test-plane-marks.js — the aircraft mark set carried over from the iOS app.
//
// The artwork has to be looked at; a test cannot do that. What it can do is
// stop the ways this breaks silently, and they are the same ways the planform
// set breaks plus one of its own.
//
// A category with no mark. `_resolveAircraftCategory()` in flight.js returns
// one of a closed set of keys, and `planeMarks.data.js` is generated against
// that set. Widen the resolver without re-running the generator and the new
// type quietly falls back to the sprite sheet — for the pilots who fly that
// type and nobody else, which is the slowest possible way to find out.
//
// A drawing that is not there. The fleet table names artwork by key; a
// regeneration that dropped a shape leaves the table pointing at nothing.
//
// A missing notice. The Virtual Radar Server markers are BSD 3-Clause, which
// requires the copyright notice and the disclaimer to travel with a binary
// distribution — and a rasterised icon on a web map is exactly that. The
// generated file's header and the public Terms both carry it, and neither is
// something a refactor may quietly drop.
//
// A texture budget walked back into. Mapbox packs every registered icon into
// ONE atlas; the arithmetic that crashed the app once is checked here the way
// the loader computes it.
//
// Run:  node tools/test-plane-marks.js
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');

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
    console.log('\nAircraft mark set\n');

    global.window = { devicePixelRatio: 2 };
    const mod = await import(pathToFileURL(path.join(ROOT, 'planeMarks.js')).href);
    const {
        MARK_ART, MARK_FLEET, LOGICAL_SIZE,
        BASE_FILL, RIM_WIDTH, PAD,
        MIN_SOURCE_PX, MAX_SOURCE_PX, ATLAS_BUDGET_BYTES,
        sourcePixelsFor, svgFor
    } = mod._internals;

    /* ---- the artwork is actually here ---- */
    ok('the generated data file is present',
        fs.existsSync(path.join(ROOT, 'planeMarks.data.js')));

    ok('there are drawings and a fleet table',
        Object.keys(MARK_ART).length > 5 && Object.keys(MARK_FLEET).length > 5,
        `${Object.keys(MARK_ART).length} drawings, ${Object.keys(MARK_FLEET).length} keys`);

    const malformed = Object.entries(MARK_ART).filter(([, parts]) =>
        !Array.isArray(parts) || !parts.length
        || parts.some(p => typeof p.d !== 'string' || !/^\s*M/i.test(p.d)));
    ok('every drawing is a non-empty list of path data',
        malformed.length === 0, malformed.map(([k]) => k).join(', '));

    /* ---- licence obligations ---- */
    const generated = fs.readFileSync(path.join(ROOT, 'planeMarks.data.js'), 'utf8');
    ok('the BSD notice and disclaimer travel with the artwork',
        /Andrew Whewell/.test(generated)
        && /Redistributions in binary form/.test(generated)
        && /THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS/.test(generated),
        'planeMarks.data.js must carry the Virtual Radar Server notice in full');

    ok('the CC0 half of the set is credited too',
        /VRSCustomMarkers/.test(generated) && /CC0/.test(generated));

    const terms = fs.readFileSync(path.join(ROOT, 'terms.html'), 'utf8');
    ok('the Terms of Service carry the attribution',
        /Virtual Radar Server/.test(terms) && /BSD/.test(terms)
        && /VRSCustomMarkers/.test(terms),
        'the BSD licence requires the notice to reach whoever receives the icons');

    /* ---- coverage ---- */
    const categories = categoriesFromFlightJs();
    ok('the category list can still be read out of flight.js',
        Array.isArray(categories) && categories.length > 5,
        '_resolveAircraftCategory changed shape — this test is now blind');

    if (categories) {
        const unmapped = categories.filter(c => !MARK_FLEET[c]);
        ok('every category flight.js can produce has a mark',
            unmapped.length === 0,
            `no mark for: ${unmapped.join(', ')} — re-run tools/gen-plane-marks.js`);
    }

    const dangling = Object.entries(MARK_FLEET).filter(([, e]) => !MARK_ART[e.art]);
    ok('every fleet entry names a drawing that exists',
        dangling.length === 0,
        dangling.map(([k, e]) => `${k} -> ${e.art}`).join(', '));

    const orphaned = Object.keys(MARK_ART)
        .filter(art => !Object.values(MARK_FLEET).some(e => e.art === art));
    ok('no drawing is shipped that nothing draws',
        orphaned.length === 0,
        `${orphaned.join(', ')} — bytes every visitor downloads for nothing`);

    /* ---- sizing ---- */
    const scales = Object.values(MARK_FLEET).map(e => e.scale);

    ok('the reference airliner comes out at unity',
        Math.abs(MARK_FLEET.B737.scale - 1) < 0.001,
        `a B737 is scaled ${MARK_FLEET.B737.scale}`);

    ok('a widebody is drawn bigger than a narrowbody, which is bigger than a light single',
        MARK_FLEET.A380.scale > MARK_FLEET.B737.scale
        && MARK_FLEET.B737.scale > MARK_FLEET.SINGLEPROP.scale);

    // The app compresses true wingspans toward the middle for the same reason
    // the planform set does: at an icon size where the A380 reads, a truly
    // scaled Cessna is three pixels.
    const ratio = MARK_FLEET.A380.scale / MARK_FLEET.SINGLEPROP.scale;
    ok('the size range is compressed to something usable, not the true 7:1',
        ratio > 1.3 && ratio < 3.0, `A380:C172 renders at ${ratio.toFixed(2)}:1`);

    ok('nothing is drawn larger than the icon box',
        scales.every(s => s * BASE_FILL <= 1),
        'an aircraft scaled past the box gets clipped at the sprite edge');

    ok('the smallest aircraft is still worth drawing',
        Math.min(...scales) * BASE_FILL > 0.35,
        'a light single would be a smudge at map sizes');

    ok('the halo has room to draw inside the padding',
        PAD >= RIM_WIDTH / 2,
        `a ${RIM_WIDTH} stroke straddles its path, so ${RIM_WIDTH / 2} of it sits `
        + `outside the silhouette and needs ${RIM_WIDTH / 2} of margin; PAD is ${PAD}`);

    /* ---- what the loader emits ---- */
    const sample = svgFor(MARK_ART[MARK_FLEET.B737.art], { x: 0, y: 0, w: 40, h: 40 }, true);
    ok('the untinted variant paints its halo behind the fill',
        /paint-order:stroke fill/.test(sample) && /stroke:rgb\(/.test(sample),
        'without paint-order the outline eats into the silhouette instead of ringing it');

    ok('the fill rule each drawing was authored under survives into the markup',
        /fill-rule="(evenodd|nonzero)"/.test(sample),
        'the cut-outs — cabin windows, rotor discs — close up under the wrong rule');

    /* ---- texture budget ---- */
    // Mapbox packs every registered icon into ONE atlas texture. Rasterising
    // too large does not degrade, it fails, and takes the tab with it — see
    // docs/AIRCRAFT-ICONS.md. Computed here the way the loader computes it.
    const SDF_PAD = (() => {
        const m = /const SDF_RADIUS\s*=\s*(\d+)/.exec(fs.readFileSync(path.join(ROOT, 'flight.js'), 'utf8'));
        return m ? Number(m[1]) : 8;
    })();
    const IMAGES = Object.keys(MARK_FLEET).length * 3;   // silhouette, selected, natural

    // The conservative floor across GPUs still in use. Staying well under it
    // leaves room for the sprite sheet, which shares the same atlas.
    const SAFE_ATLAS_PX = 2048;

    for (const dpr of [1, 2, 3]) {
        const side = sourcePixelsFor(dpr) + SDF_PAD * 2;
        const bytes = IMAGES * side * side * 4;
        const atlasPx = Math.ceil(Math.sqrt(IMAGES * side * side));

        ok(`at ${dpr}x the atlas stays well inside what a GPU will hold`,
            atlasPx < SAFE_ATLAS_PX * 0.75,
            `${IMAGES} icons at ${side}px need a ~${atlasPx}px atlas (limit ${SAFE_ATLAS_PX})`);

        ok(`at ${dpr}x the set fits its declared texture budget`,
            bytes <= ATLAS_BUDGET_BYTES,
            `${(bytes / 1048576).toFixed(1)} MB against a ${(ATLAS_BUDGET_BYTES / 1048576).toFixed(0)} MB budget`);
    }

    ok('the raster is still comfortably sharper than the map draws',
        sourcePixelsFor(3) > 128 * 0.15 * 3 * 1.5,
        `${sourcePixelsFor(3)}px source against ~${Math.round(128 * 0.15 * 3)}px drawn at 3x`);

    ok('every variant is registered at one size, so the layers agree on scale',
        MAX_SOURCE_PX >= MIN_SOURCE_PX && sourcePixelsFor(2) === sourcePixelsFor(3),
        'the SDF pad is added to all variants; a mismatch makes tinted and '
        + 'natural aircraft draw at different sizes');

    /* ---- registration contract ---- */
    ok('marks register at the same logical size as the sprite sheet',
        LOGICAL_SIZE === 128,
        'flight.js registers markers.png tiles against 128; the two must agree '
        + 'or icon-size means something different per set');

    const flightSrc = fs.readFileSync(path.join(ROOT, 'flight.js'), 'utf8');
    ok('the mark set is the default',
        /function getIconSet\(\)[\s\S]{0,200}?\|\|\s*'marks'/.test(flightSrc));

    ok('the mark loader runs before the sheet rather than instead of it',
        !/registerPlaneMarkIcons[\s\S]{0,400}?\n\s*return;/.test(flightSrc),
        'the sheet must still run afterwards — it supplies the airport markers, '
        + 'which no aircraft set has');

    console.log(`\n${pass} passing${fail ? `, ${fail} failing` : ''}\n`);
    process.exit(fail === 0 ? 0 : 1);
})();
