// test-flight-load-order.js
//
// flight.js is one long script evaluated top-to-bottom, and code near the top
// (the settings panel, wired during init) legitimately reaches for things
// declared thousands of lines below it. Function declarations hoist, so that is
// fine. `const` and `let` do NOT — they sit in a temporal dead zone until their
// line runs, and touching one from above throws ReferenceError.
//
// That is not a cosmetic failure. It happens inside the init chain, so the
// throw stops everything after it and THE MAP NEVER LOADS. It shipped exactly
// once, in the VA-event picker, and it looked like "the map is broken" rather
// than anything to do with events.
//
// This checks that the identifiers the early code reaches for are hoisted
// (function or var), so the same mistake cannot come back silently.
//
// Run:  node tools/test-flight-load-order.js
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'flight.js'), 'utf8');
const LINES = SRC.split('\n');

let pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log(`  ✓ ${name}`); pass++; }
    else { console.log(`  ✗ ${name}${extra ? `\n      ${extra}` : ''}`); process.exitCode = 1; }
};

/** First line where a top-level binding is declared, by kind. */
function declarationOf(name) {
    const pats = [
        { kind: 'function', re: new RegExp(`^\\s*(async\\s+)?function\\s+${name}\\s*\\(`) },
        { kind: 'var', re: new RegExp(`^\\s*var\\s+${name}\\b`) },
        { kind: 'let', re: new RegExp(`^\\s*let\\s+${name}\\b`) },
        { kind: 'const', re: new RegExp(`^\\s*const\\s+${name}\\b`) },
    ];
    for (let i = 0; i < LINES.length; i++) {
        for (const p of pats) if (p.re.test(LINES[i])) return { kind: p.kind, line: i + 1 };
    }
    return null;
}

/** Every line number where `name` is referenced (crudely, as a whole word). */
function usesOf(name) {
    const re = new RegExp(`\\b${name}\\b`);
    const out = [];
    for (let i = 0; i < LINES.length; i++) if (re.test(LINES[i])) out.push(i + 1);
    return out;
}

console.log('\nIdentifiers the early init code reaches for must be hoisted');

// The VA-event machinery, which the settings panel touches during init.
const WATCHED = [
    'vaEventCache',
    'vaEventVaFilterSet',
    'getVaEventVaFilter',
    'setVaEventVaFilter',
    'vaEventPassesFilter',
    'renderVaEventVaPicker',
    'renderVaEventMarkers',
    'fetchUpcomingVaEvents',
    'openVaEventWindow',
];

for (const name of WATCHED) {
    const decl = declarationOf(name);
    if (!decl) { ok(`${name} is declared`, false, 'not found'); continue; }

    const uses = usesOf(name).filter((l) => l < decl.line);
    if (!uses.length) {
        ok(`${name} — declared before every use`, true);
        continue;
    }
    // Used above its declaration: only safe if hoisted.
    const hoisted = decl.kind === 'function' || decl.kind === 'var';
    ok(
        `${name} — used at line ${uses[0]}, declared line ${decl.line} as ${decl.kind}, so it must hoist`,
        hoisted,
        hoisted ? '' : `${decl.kind} is in its temporal dead zone at line ${uses[0]} — this throws and stops the map loading`
    );
}

console.log('\nThe settings-panel call site is defended');

const panel = SRC.slice(SRC.indexOf("const vaEventPickerHost"), SRC.indexOf("const vaEventToggle"));
ok('the picker is painted off the evaluation path', /Promise\.resolve\(\)\.then/.test(panel), panel.slice(0, 200));
ok('…and cannot throw into the init chain', /\.catch\(/.test(panel));
ok('…and still checks the function exists', /typeof renderVaEventVaPicker !== 'function'/.test(panel));

console.log(`\n${process.exitCode ? 'FAILURES above. ' : ''}${pass} checks passed.`);
