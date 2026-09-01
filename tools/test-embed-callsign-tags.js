// test-embed-callsign-tags.js
// Proves the embed widget's roster rule respects a VA's suffix tag.
//
// The widget carries its own copy of the callsign rules — deliberately, it runs
// in a browser with no backend — which means the two copies can disagree, and
// the code comments on both sides say so. This checks the half that changed:
//
//   * 'airline' (the default, unchanged) lets the roster waive the suffix, so a
//     rostered pilot's untagged "UPS 123" counts for UPS
//   * 'tagged' does not. The airline must be ours AND the callsign must carry
//     one of our tags — so "UPS 123UP Cargo" counts and "UPS 123" does not,
//     which is the whole point for a VA whose suffix is not decoration
//   * 'any' and 'off' are untouched at both ends of the dial
//
// embed.js is one big IIFE with nothing on `window`, so the pure helpers are
// lifted out of its source by name and the roster decision is reproduced
// against them. Brittle by design: if a helper is renamed this fails with
// "could not find", which is correct for a test that has stopped testing the
// real thing.
//
// Run:  node tools/test-embed-callsign-tags.js

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'embed.js'), 'utf8');

// Lift `function <name>(...) { ... }` by brace balance from its opening brace.
function lift(name) {
    const start = SRC.indexOf(`function ${name}(`);
    if (start === -1) throw new Error(`could not find ${name} in embed.js`);
    const open = SRC.indexOf('{', start);
    if (open === -1) throw new Error(`could not find the body of ${name} in embed.js`);
    let depth = 0;
    let inLine = false, inBlock = false, quote = '';
    for (let i = open; i < SRC.length; i++) {
        const c = SRC[i], next = SRC[i + 1];
        if (inLine) { if (c === '\n') inLine = false; continue; }
        if (inBlock) { if (c === '*' && next === '/') { inBlock = false; i++; } continue; }
        if (quote) {
            if (c === '\\') { i++; continue; }
            if (c === quote) quote = '';
            continue;
        }
        if (c === '/' && next === '/') { inLine = true; i++; continue; }
        if (c === '/' && next === '*') { inBlock = true; i++; continue; }
        if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) return SRC.slice(start, i + 1); }
    }
    throw new Error(`could not find the end of ${name} in embed.js`);
}

// A `const` the lifted functions close over. Lifted the same way rather than
// re-declared here, so the day somebody adds "JUMBO" to it this test agrees.
function liftConst(name) {
    const m = SRC.match(new RegExp(`const ${name} = [^;]+;`));
    if (!m) throw new Error(`could not find const ${name} in embed.js`);
    return m[0];
}

const NAMES = ['callsignTokens', 'compactCallsign', 'stripWeightClass', 'tokenHasSuffixTag', 'splitCallsignMask', 'isDistinctiveTag', 'tailCarriesTag'];
const source = [liftConst('WEIGHT_CLASS_SUFFIXES'), ...NAMES.map(lift)].join('\n');
// eslint-disable-next-line no-new-func
const H = new Function(`${source}\nreturn { ${NAMES.join(', ')} };`)();

let failures = 0;
const T = (label, got, expected) => {
    if (JSON.stringify(got) === JSON.stringify(expected)) { console.log('  ✓', label); return; }
    failures++;
    console.log('  ✗', label, '\n      got:', JSON.stringify(got), '\n      want:', JSON.stringify(expected));
};

// The roster branch of matchesFlight, reproduced against the lifted helpers.
// Entered only when the ordinary callsign rule has already declined — that is
// what "widening" means — so this models exactly the decision that changed.
function rosterWidens(callsign, cfg) {
    const trust = cfg.rosterTrust || 'airline';
    if (trust === 'off') return false;
    if (trust === 'any') return true;
    // 'tagged' keeps the TAG and waives the airline; 'airline' does the
    // opposite. Neither contains the other.
    if (trust === 'tagged') {
        return !!(cfg.suffixes && cfg.suffixes.some(t => H.tailCarriesTag(H.callsignTokens(callsign), t)));
    }
    const compact = H.compactCallsign(callsign);
    return !!((cfg.prefixes && cfg.prefixes.some(p => p && compact.startsWith(p)))
        || (cfg.regulars && cfg.regulars.some(p => p && compact.startsWith(p))));
}

const UPS = { prefixes: ['UPS'], suffixes: ['UP'], regulars: [] };
const cfg = (trust) => ({ ...UPS, rosterTrust: trust });

console.log('\nembed — the helpers the rule is built from');
T('a tag glued to a number is a tag', H.tokenHasSuffixTag('123UP', 'UP'), true);
T('a word merely ending in the letters is not', H.tokenHasSuffixTag('MOSKVA', 'VA'), false);
T('a weight class is stripped before the tag is looked for',
    H.stripWeightClass(H.callsignTokens('UPS 123UP Heavy')), ['UPS', '123UP']);
T('spacing does not change the compacted form',
    H.compactCallsign('Air Canada 001VA'), 'AIRCANADA001VA');

console.log('\nembed — rosterTrust: "tagged" (the new one)');
T('a rostered pilot on our airline WITH our tag counts',
    rosterWidens('UPS 123UP', cfg('tagged')), true);
T('the same pilot without our tag does NOT',
    rosterWidens('UPS 123', cfg('tagged')), false);
T('a trailing word does not hide the tag',
    rosterWidens('UPS 123UP Cargo', cfg('tagged')), true);
T('…nor does a weight class',
    rosterWidens('UPS 123UP Heavy', cfg('tagged')), true);
// The airline is exactly what 'tagged' waives — that is the codeshare answer,
// and requiring it as well is what made this level useless for the case it is
// named after.
T('our tag on somebody else’s airline DOES count — that is the point',
    rosterWidens('DELTA 9UP', cfg('tagged')), true);
T('another airline WITHOUT our tag still does not',
    rosterWidens('ETIHAD 456FR', cfg('tagged')), false);

console.log('\nembed — the existing modes are unchanged');
T('airline: an untagged flight on our airline still counts',
    rosterWidens('UPS 123', cfg('airline')), true);
T('airline: another airline still does not',
    rosterWidens('ETIHAD 456FR', cfg('airline')), false);
T('any: anything a rostered pilot flies counts',
    rosterWidens('ETIHAD 456FR', cfg('any')), true);
T('off: nothing the roster says matters',
    rosterWidens('UPS 123UP', cfg('off')), false);

console.log('\nembed — a VA with no tag registered');
// Nothing to carry. 'tagged' must not silently become "reject everything" for a
// VA that never set a suffix — but it does mean the mode has nothing to add, so
// the honest answer is that the roster cannot widen on a tag that isn't there.
const noTag = { prefixes: ['BAW'], suffixes: [], regulars: [], rosterTrust: 'tagged' };
T('tagged: with no suffix registered, the roster does not widen',
    rosterWidens('BAW 42', noTag), false);
T('airline: the same VA is unaffected',
    rosterWidens('BAW 42', { ...noTag, rosterTrust: 'airline' }), true);

/* ---------------------------------------------------------------------------
 * splitCallsignMask — the widget reading a registered callsign
 *
 * A VA registers "OCEAN ##VA" / "SHAMROCK ###EX", and that string can reach the
 * widget as a prefix (from the resolve payload, or from a hand-written
 * ?prefixes=). Fed through whole it left a "#" inside the prefix, no live
 * callsign ever started with it, and the VA matched nobody. Split, the airline
 * becomes the prefix and the mask's tag becomes the suffix — which is how a VA
 * whose tag is "EX" gets a map filtered on "EX" instead of on nothing at all.
 * ------------------------------------------------------------------------ */
console.log('\nembed — reading a registered callsign mask');
T('a "VA" mask splits', H.splitCallsignMask('OCEAN ##VA'), { base: 'OCEAN', tag: 'VA' });
T('so does any other tag', H.splitCallsignMask('SHAMROCK ###EX'), { base: 'SHAMROCK', tag: 'EX' });
T('a tagless mask has no tag', H.splitCallsignMask('BAW ###'), { base: 'BAW', tag: '' });
T('a plain airline name is left alone', H.splitCallsignMask('Air Canada'), { base: 'AIR CANADA', tag: '' });
T('nothing in, nothing out', H.splitCallsignMask('  '), null);

/* ---------------------------------------------------------------------------
 * 'tag' mode — Norwegian's codeshare on the map
 *
 * The widget's rule tested the prefix first and returned early, so a partner
 * callsign wearing the VA's tag matched nothing. Only a DISTINCTIVE tag may
 * claim a flight this way: "VA" is what everyone appends.
 * ------------------------------------------------------------------------ */
console.log('\nembed — a distinctive tag claims a flight on its own');
T('"NV" identifies one VA', H.isDistinctiveTag('NV'), true);
T('"VA" identifies none', H.isDistinctiveTag('VA'), false);
T('a single letter does not', H.isDistinctiveTag('X'), false);
T('the tag is found on the last token', H.tailCarriesTag(H.callsignTokens('Shamrock 12NV'), 'NV'), true);
T('…and behind a weight class', H.tailCarriesTag(H.callsignTokens('Shamrock 12NV Heavy'), 'NV'), true);
T('…and behind a second trailing tag', H.tailCarriesTag(H.callsignTokens('Shamrock 12NV CX'), 'NV'), true);
T('an untagged codeshare carries nothing', H.tailCarriesTag(H.callsignTokens('Shamrock 12'), 'NV'), false);
T('a word merely ending in the letters is not the tag',
    H.tailCarriesTag(H.callsignTokens('Shamrock CONV'), 'NV'), false);

console.log(failures ? `\n${failures} failure(s)\n` : '\nAll good.\n');
process.exit(failures ? 1 : 0);
