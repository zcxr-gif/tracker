#!/usr/bin/env node
/**
 * build-freqs.mjs
 *
 * The radio frequencies the Approach game (/approach) shows on its
 * frequency list, Infinite Flight style ("Kennedy Tower (119.10)"):
 *
 *     node tools/build-freqs.mjs              # fetches the current list
 *     node tools/build-freqs.mjs <file.csv>   # or reads a downloaded one
 *
 * Source: OurAirports airport-frequencies.csv (public domain),
 * https://github.com/davidmegginson/ourairports-data
 *
 * Output: approach-freqs.json, { ICAO: { GND, TWR, APP, DEP, ATIS: [MHz, name] } }
 * for the airports in airports-core.json; the name is the facility's own
 * ("Kennedy Tower", "New York Approach") where the list gives one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airport-frequencies.csv';

const csv = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : await (await fetch(URL)).text();
const airports = JSON.parse(fs.readFileSync(path.join(ROOT, 'airports-core.json'), 'utf8'));

/** One CSV line into fields (quoted fields may hold commas). */
const fields = line => [...line.matchAll(/("([^"]*)"|[^,]*)(,|$)/g)].map(m => m[2] ?? m[1]).slice(0, 6);
const KIND = { GND: 'GND', TWR: 'TWR', APP: 'APP', DEP: 'DEP', ATIS: 'ATIS', 'D-ATIS': 'ATIS' };
const WORD = { TWR: 'Tower', GND: 'Ground', APP: 'Approach', DEP: 'Departure', ATIS: 'ATIS' };
const title = s => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

/** "NEW YORK APP (ROBER)" -> "New York Approach"; "GND" alone -> null (use the airport's). */
function facility(desc, kind) {
    const base = desc.replace(/\(.*?\)/g, '').replace(/\b(TWR|TOWER|GND|GROUND|APP|APPROACH|DEP|DEPARTURE|ATIS|CTL|CONTROL|ALT|PRI|PRIMARY|SECONDARY|SEC|ARR|ARRIVAL|D-ATIS|RADAR|FINAL)\b/gi, '').replace(/[^A-Za-z .'-]/g, ' ').replace(/\s+/g, ' ').trim();
    // Sector words after the name go: "NORCAL NW-EAST" is Norcal.
    const words = base.split(' ').filter((w, i) => !i || !/^(N|S|E|W|NE|NW|SE|SW|EAST|WEST|NORTH|SOUTH)(-(N|S|E|W|EAST|WEST|NORTH|SOUTH))?$/i.test(w));
    // The list's descriptions are free text: only a plain one- or two-word facility name is used.
    const name = words.join(' ');
    return name.length > 2 && words.length <= 2 && /^[A-Za-z ']+$/.test(name) && !/\b(FREQ|CONTACT|ONLY|RUNWAY|RWY|APRON|INITIAL|DELIVERY|CLNC|INFO|RADIO|UNICOM)\b/i.test(name) ? `${title(name)} ${WORD[kind]}` : null;
}

const out = {};
for (const line of csv.split('\n').slice(1)) {
    const [, , icao, type, desc = '', mhz] = fields(line);
    const kind = KIND[(type || '').toUpperCase()];
    if (!kind || !airports[icao] || !(mhz >= 108 && mhz < 137)) continue;      // VHF airband only
    const a = out[icao] || (out[icao] = {});
    const alt = /\bALT\b|SECONDARY|\bSEC\b/i.test(desc);
    if (a[kind] && (alt || !a[kind].alt)) continue;                   // the primary frequency, not an alternate
    a[kind] = { mhz: Number(mhz), name: kind === 'ATIS' ? null : facility(desc, kind), alt };
}
const slim = {};
for (const [icao, a] of Object.entries(out)) slim[icao] = Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v.name ? [v.mhz, v.name] : [v.mhz]]));
fs.writeFileSync(path.join(ROOT, 'approach-freqs.json'), JSON.stringify(slim));
console.log(`${Object.keys(slim).length} airports, ${(fs.statSync(path.join(ROOT, 'approach-freqs.json')).size / 1e3).toFixed(0)} kB`);
