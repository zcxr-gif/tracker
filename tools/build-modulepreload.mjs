#!/usr/bin/env node
// build-modulepreload.mjs — the app's module graph, preloaded from index.html.
//
// A browser only learns what flight.js imports once flight.js has arrived and
// been parsed, and what those import once they have: three or four round
// trips one after another before the app can start. Listing every module up
// front as <link rel="modulepreload"> lets all of them download at once.
//
// The list is generated, between the modulepreload markers in index.html:
//
//     node tools/build-modulepreload.mjs          rewrite the list
//     node tools/build-modulepreload.mjs --check  fail if it is out of date
//
// Run it after adding or removing an import. A module missing from the list
// is still loaded, just a round trip later; one listed that is no longer
// imported is a wasted download.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = path.join(ROOT, 'index.html');
const START = '<!-- modulepreload:start -->';
const END = '<!-- modulepreload:end -->';

// Loaded on every boot through a dynamic import (the default aircraft icon
// set), so worth fetching up front as well.
const ALSO = ['planeMarks.js'];

const html = fs.readFileSync(INDEX, 'utf8');
const roots = [...html.matchAll(/<script\b[^>]*type=["']module["'][^>]*src=["']([^"']+)["'][^>]*>|<script\b[^>]*src=["']([^"']+)["'][^>]*type=["']module["'][^>]*>/g)]
    .map((m) => m[1] || m[2])
    .filter((src) => !/^[a-z]+:\/\//i.test(src));

// Static imports and re-exports of local files; comments are ignored.
function importsOf(file) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
    const out = [];
    const re = /^\s*(?:import|export)\s+(?:[^'";]*?\sfrom\s+)?['"](\.\.?\/[^'"]+)['"]/gm;
    for (const m of src.matchAll(re)) {
        out.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1])));
    }
    return out;
}

const order = [];
const seen = new Set();
const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    order.push(file);
    for (const dep of importsOf(file)) visit(dep);
};
for (const root of [...roots, ...ALSO]) visit(root.replace(/^\.\//, ''));

const block = [
    START,
    ...order.map((f) => `    <link rel="modulepreload" href="${f}">`),
    `    ${END}`
].join('\n');

const at = html.indexOf(START);
const to = html.indexOf(END);
if (at < 0 || to < at) {
    console.error(`index.html has no ${START} … ${END} block`);
    process.exit(1);
}
const next = html.slice(0, at) + block + html.slice(to + END.length);

if (process.argv.includes('--check')) {
    if (next !== html) {
        console.error('index.html modulepreload list is out of date: run node tools/build-modulepreload.mjs');
        process.exit(1);
    }
    console.log(`modulepreload list up to date (${order.length} modules)`);
} else {
    fs.writeFileSync(INDEX, next);
    console.log(`wrote ${order.length} modulepreload links`);
}
