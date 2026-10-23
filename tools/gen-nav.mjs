#!/usr/bin/env node
/**
 * gen-nav.mjs: a starting point for hand-building an airport's procedures.
 *
 *     node tools/gen-nav.mjs EGLL                  # prints the generated file
 *     node tools/gen-nav.mjs EGLL > nav/custom/EGLL.json
 *
 * Writes out exactly what the game generates for the airport (real navaids,
 * invented fixes, STARs, SIDs, ILS and RNAV approaches), in the nav file
 * format, so a team member can replace the invented parts with the
 * published ones. Check the result with tools/check-nav.mjs.
 */
import { airportWorld, navaids } from './nav-common.mjs';

// approachNavGen.js is the browser's ES module; Node notes the package isn't "type": "module". Harmless, so quiet.
process.removeAllListeners('warning');
const { generateNav } = await import('../approachNavGen.js');

const icao = (process.argv[2] || '').toUpperCase();
const world = icao && airportWorld(icao);
if (!world) { console.error(icao ? `${icao}: not a playable airport (no usable hard runway of 4,500 ft or more).` : 'Usage: node tools/gen-nav.mjs <ICAO>'); process.exit(1); }
const nav = generateNav(world, navaids());
delete nav.generated;
const out = { icao, source: 'InFlight team', cycle: '', note: 'Started from the generated procedures: replace them with the published ones.', ...nav, cycle: '' };
console.log(JSON.stringify(out, null, 1).replace(/\[\n\s+([^[\]{}]*?)\n\s+\]/g, (m, inner) => '[' + inner.replace(/\n\s+/g, ' ') + ']'));
