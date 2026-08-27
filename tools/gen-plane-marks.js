// gen-plane-marks.js — regenerate planeMarks.data.js from the iOS app's artwork.
//
// The aircraft marks on the map are the same drawings the iOS app uses, and the
// iOS app is where they are maintained: `PlaneArtwork.swift` is itself generated
// there from two upstream marker packs (see ios-native's tools/plane-artwork),
// `PlaneMarks.swift` holds the handful drawn by hand, and `PlaneSprites.swift`
// says which sprite key draws which shape and at what size.
//
// Rather than fork the artwork into this repo by hand — which is how two copies
// of the same drawing quietly stop being the same drawing — this reads those
// three files and writes `planeMarks.data.js`. The generated file is committed,
// so nothing about serving the site depends on having the iOS checkout.
//
// Run:
//     node tools/gen-plane-marks.js ../Inflight-IOS/ios-native
//
// The argument is the ios-native directory of the iOS repo; it also honours
// $INFLIGHT_IOS. Re-run it whenever the app's artwork changes, and commit the
// result.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IOS = path.resolve(process.argv[2] || process.env.INFLIGHT_IOS || '../Inflight-IOS/ios-native');
const MAP = path.join(IOS, 'InflightTracker', 'Map');

function read(file) {
    const full = path.join(MAP, file);
    if (!fs.existsSync(full)) {
        console.error(`Cannot find ${full}.\nPass the iOS repo's ios-native directory as the first argument.`);
        process.exit(1);
    }
    return fs.readFileSync(full, 'utf8');
}

/* =========================
 * PlaneArtwork.swift
 * =========================
 * The generated half: one entry per drawing, each a list of Part(path:) with an
 * optional `evenOdd: false` where the source drawing used the non-zero rule.
 */
function artworkFrom(swift) {
    const out = {};
    const entry = /^ {8}"([A-Za-z0-9_]+)": \[\n((?: {12}Part\(path: .*\n)+) {8}\],/gm;

    for (const [, key, block] of swift.matchAll(entry)) {
        const parts = [];
        for (const [, d, rule] of block.matchAll(/Part\(path: "([^"]+)"(?:, evenOdd: (true|false))?\)/g)) {
            parts.push({ d, evenOdd: rule !== 'false' });
        }
        if (parts.length) out[key] = parts;
    }
    return out;
}

/* =========================
 * PlaneMarks.swift
 * =========================
 * The hand-drawn half. Same path format, but written as Swift multi-line
 * strings with trailing backslashes for readability, so the whitespace has to
 * come back out.
 */
function marksFrom(swift) {
    const out = {};
    const entry = /"([A-Za-z0-9_]+)": \[\s*PlaneArtwork\.Part\(path: """\n([\s\S]*?)\n\s*"""\s*\),?\s*\],/g;

    for (const [, key, raw] of swift.matchAll(entry)) {
        const d = raw
            .replace(/\\\n/g, ' ')      // Swift's line continuation
            .replace(/\s+/g, ' ')
            .trim();
        if (d) out[key] = [{ d, evenOdd: true }];
    }
    return out;
}

/* =========================
 * PlaneSprites.swift
 * =========================
 * Sprite key → drawing, and the size that key draws at relative to the rest of
 * the fleet. Entries with a colour of their own are the airport pins: they are
 * not aircraft, this set does not claim them, and markers.png still draws them.
 */
function fleetFrom(swift) {
    const out = {};
    const entry = /^ {8}"([A-Z0-9_-]+)": \("([A-Za-z0-9]+)", ([0-9.]+), (nil|[^)]+)\),/gm;

    for (const [, key, art, scale, body] of swift.matchAll(entry)) {
        if (body.trim() !== 'nil') continue;
        out[key] = { art, scale: Number(scale) };
    }
    return out;
}

/* =========================
 * What the site can actually draw
 * =========================
 * `_resolveAircraftCategory()` in flight.js returns a closed set of keys, and
 * nothing else ever reaches `icon-<KEY>`. The app's own table is far larger — it
 * tells an Apache from a Chinook — but shipping the drawings for categories this
 * site cannot produce is bytes every visitor downloads to draw nothing, and the
 * ones it would draw are what fills the icon atlas.
 *
 * So the list is read out of flight.js rather than restated here. Widen the
 * resolver and re-run this; tools/test-plane-marks.js fails if the two drift.
 */
function categoriesFromFlightJs() {
    const src = fs.readFileSync(path.join(ROOT, 'flight.js'), 'utf8');
    const start = src.indexOf('function _resolveAircraftCategory');
    if (start < 0) {
        console.error('Cannot find _resolveAircraftCategory() in flight.js.');
        process.exit(1);
    }
    const body = src.slice(start, src.indexOf('\n}', start));
    const found = new Set();
    for (const [, key] of body.matchAll(/return\s+'([A-Z0-9_-]+)'/g)) found.add(key);
    const generic = /const GENERIC_AIRCRAFT_CATEGORY\s*=\s*'([A-Z0-9_-]+)'/.exec(src);
    if (generic) found.add(generic[1]);
    return found;
}

const artwork = { ...artworkFrom(read('PlaneArtwork.swift')), ...marksFrom(read('PlaneMarks.swift')) };
const everything = fleetFrom(read('PlaneSprites.swift'));
const categories = categoriesFromFlightJs();

const fleet = {};
for (const key of [...categories].sort()) {
    if (everything[key]) fleet[key] = everything[key];
}

const unknown = [...categories].filter(key => !everything[key]);
if (unknown.length) {
    console.error(
        `flight.js can produce categories the app has no mark for: ${unknown.join(', ')}.\n` +
        'Add them to PlaneSprites.fleet in the iOS repo, or markers.png will keep drawing them.'
    );
    process.exit(1);
}

// Only the drawings those keys ask for.
const used = new Set(Object.values(fleet).map(entry => entry.art));
for (const key of Object.keys(artwork)) {
    if (!used.has(key)) delete artwork[key];
}

const missing = [...used].filter(art => !artwork[art]);
if (missing.length) {
    console.error(`Fleet entries name artwork that is not in either Swift file: ${missing.join(', ')}`);
    process.exit(1);
}

const header = `// planeMarks.data.js — the aircraft marks, as path data.
//
// GENERATED — do not edit by hand. Run \`node tools/gen-plane-marks.js\` against
// an Inflight-IOS checkout; see that file for what it reads and why.
//
// These are the drawings the iOS app puts on its map, in their own coordinate
// spaces — planeMarks.js fits each one to the icon box, so the numbers here only
// ever matter relative to each other. Only the categories flight.js can produce
// are carried; the app's table is larger, and the rest would be bytes downloaded
// to draw nothing.
//
// Virtual Radar Server markers (the heavy/medium/light size-and-engine families,
// helicopter, balloon, glider, generic, A340, A380):
//
//     Copyright (C) 2010 onwards, Andrew Whewell. All rights reserved.
//
//     Redistribution and use in source and binary forms, with or without
//     modification, are permitted provided that the following conditions are
//     met:
//
//     * Redistributions of source code must retain the above copyright notice,
//       this list of conditions and the following disclaimer.
//     * Redistributions in binary form must reproduce the above copyright
//       notice, this list of conditions and the following disclaimer in the
//       documentation and/or other materials provided with the distribution.
//     * Neither the name of the author nor the names of the program's
//       contributors may be used to endorse or promote products derived from
//       this software without specific prior written permission.
//
//     THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS
//     IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
//     THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
//     PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHORS OF THE SOFTWARE BE
//     LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
//     CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
//     SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
//     INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
//     CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
//     ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
//     POSSIBILITY OF SUCH DAMAGE.
//
// The type-specific military, warbird, rotary and unmanned markers come from
// VRSCustomMarkers by rikgale and shish0r, released under CC0 1.0 Universal —
// no conditions attached. The rest is drawn for the app itself.

`;

const art = Object.entries(artwork).map(([key, parts]) => {
    const rendered = parts.map(p =>
        `        { d: '${p.d}'${p.evenOdd ? '' : ', evenOdd: false'} },`
    ).join('\n');
    return `    ${key}: [\n${rendered}\n    ],`;
}).join('\n');

const table = Object.entries(fleet).map(([key, entry]) =>
    `    '${key}': { art: '${entry.art}', scale: ${entry.scale.toFixed(2)} },`
).join('\n');

const body = `/* The drawings, keyed by artwork name. \`evenOdd\` is the source drawing's fill
 * rule; several carry their own cut-outs — cabin windows, rotor discs — which
 * close up under the non-zero rule. */
export const MARK_ART = {
${art}
};

/* Sprite key → drawing, and how big that key draws relative to the rest of the
 * fleet. The scales follow the real aircraft, roughly: an A380 against a Cessna
 * is about the ratio of their wingspans, pulled in toward the middle so the
 * small ones stay legible at the size these are drawn at. */
export const MARK_FLEET = {
${table}
};
`;

fs.writeFileSync(path.join(ROOT, 'planeMarks.data.js'), header + body);
console.log(
    `wrote planeMarks.data.js — ${Object.keys(artwork).length} drawings, ${Object.keys(fleet).length} sprite keys`
);
