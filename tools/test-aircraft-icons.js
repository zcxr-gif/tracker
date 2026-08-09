// test-aircraft-icons.js — the vector aircraft icon set.
//
// The icons themselves have to be looked at; that is not something a test can
// do. What a test can do is stop the two ways this breaks silently.
//
// A category with no shape. getAircraftCategory() in flight.js returns one of a
// closed set of keys, and markers.png has a tile for every one of them. The
// vector set has to cover the same ground — a key that falls through to nothing
// is an aircraft that vanishes from the map, and it would only show up when
// somebody happened to fly that type.
//
// A shape that draws outside its box. Every measurement is a fraction of the
// icon square, and a span or a length over 1 means the aircraft is clipped at
// the sprite edge — which looks like a chopped-off wing at exactly one zoom
// and is easy to miss while authoring.
//
// Run:  node tools/test-aircraft-icons.js
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

// Every category getAircraftCategory() can return, read out of flight.js rather
// than copied — a new type added there has to be added here too, and this is
// what makes that show up.
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

// The sprite keys the classic sheet ships, which the vector set has to be able
// to answer for so switching between them cannot change what is drawable.
function classicSpriteKeys() {
    const src = fs.readFileSync(path.join(ROOT, 'embed-sprites.js'), 'utf8');
    const json = src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1);
    return Object.keys(JSON.parse(json));
}

(async () => {
    console.log('\nVector aircraft icons\n');

    global.window = { devicePixelRatio: 2 };
    const mod = await import(pathToFileURL(path.join(ROOT, 'aircraftIcons.js')).href);
    const { SHAPES, ALIASES, shapeFor, LOGICAL_SIZE } = mod._internals;

    /* ---- coverage ---- */
    const categories = categoriesFromFlightJs();
    ok('the category list can still be read out of flight.js',
        Array.isArray(categories) && categories.length > 5,
        'the shape of _resolveAircraftCategory changed — this test is now blind');

    if (categories) {
        const missing = categories.filter(c => !SHAPES[c] && !ALIASES[c]);
        ok('every category flight.js can produce has a shape or an alias',
            missing.length === 0,
            `no shape for: ${missing.join(', ')}`);
    }

    const classic = classicSpriteKeys().filter(k => !k.endsWith('_S'))
        .filter(k => !/^AIRPORT_|^TRIANGLE$|^VEHICLE$/.test(k));
    const unmapped = classic.filter(k => !SHAPES[k] && !ALIASES[k]);
    ok('every aircraft in the classic sheet maps to a vector shape',
        unmapped.length === 0,
        `unmapped: ${unmapped.join(', ')}`);

    ok('an unknown type still resolves to a real aircraft rather than nothing',
        shapeFor('SOMETHING-NOBODY-HAS-FLOWN') === SHAPES.B737);

    /* ---- geometry ---- */
    const names = Object.keys(SHAPES);

    ok('every shape fits inside its icon box',
        names.every(n => SHAPES[n].length <= 1 && SHAPES[n].span <= 1),
        names.filter(n => SHAPES[n].length > 1 || SHAPES[n].span > 1).join(', '));

    ok('every shape has a fuselage, a span and a length worth drawing',
        names.every(n => {
            const s = SHAPES[n];
            return s.length > 0.3 && s.span > 0.05 && s.body > 0.02;
        }));

    ok('wings are attached somewhere along the fuselage, not off the end',
        names.every(n => SHAPES[n].wingRoot > 0.2 && SHAPES[n].wingRoot < 0.9));

    ok('wing sweep never runs past the tail',
        names.every(n => SHAPES[n].sweep >= 0 && SHAPES[n].sweep < 0.6));

    const fixedWing = names.filter(n => !SHAPES[n].noWing);
    ok('the tailplane is smaller than the main wing on every fixed-wing aircraft',
        fixedWing.every(n => SHAPES[n].tailSpan < SHAPES[n].span),
        fixedWing.filter(n => SHAPES[n].tailSpan >= SHAPES[n].span).join(', '));

    ok('a helicopter draws a rotor and a boom, not wings',
        SHAPES.EUROCOPTER.noWing === true && SHAPES.EUROCOPTER.rotor === true);

    // Engines are placed as a fraction of the half-span, and each extra one
    // steps 0.24 further out (see traceAircraft) — so a four-engine aircraft
    // must start far enough inboard that the outboard pair is still on the wing.
    ok('every engine sits on the wing rather than beyond the tip',
        names.every(n => {
            const s = SHAPES[n];
            if (!s.engines) return true;
            return s.enginePos > 0.15 && (s.enginePos + (s.engines - 1) * 0.24) < 0.92;
        }),
        names.filter(n => SHAPES[n].engines
            && (SHAPES[n].enginePos + (SHAPES[n].engines - 1) * 0.24) >= 0.92).join(', '));

    ok('propellers sit on the wing too',
        names.every(n => {
            const s = SHAPES[n];
            if (!s.prop) return true;
            return s.propPos > 0.15 && (s.propPos + (s.prop - 1) * 0.30) < 0.92;
        }));

    /* ---- proportions that should read at a glance ---- */
    ok('an A380 is bigger than a 737 in both directions',
        SHAPES.A380.span > SHAPES.B737.span && SHAPES.A380.length > SHAPES.B737.length);

    ok('a fighter is stubbier and more swept than an airliner',
        SHAPES.F16.span < SHAPES.B737.span && SHAPES.F16.sweep > SHAPES.B737.sweep);

    ok('a turboprop has propellers and no jet nacelles',
        SHAPES.DASH8.prop > 0 && !SHAPES.DASH8.engines);

    ok('the four-engine types have two nacelles a side',
        SHAPES.A380.engines === 2 && SHAPES.B747.engines === 2);

    ok('the twins have one a side',
        SHAPES.B737.engines === 1 && SHAPES.A350.engines === 1 && SHAPES.B777.engines === 1);

    /* ---- registration contract ---- */
    ok('icons are registered at the same logical size as the classic sheet',
        LOGICAL_SIZE === 128,
        'flight.js registers markers.png tiles against 128; the two must agree '
        + 'or icon-size means something different per set');

    console.log(`\n${pass} passing${fail ? `, ${fail} failing` : ''}\n`);
    process.exit(fail === 0 ? 0 : 1);
})();
