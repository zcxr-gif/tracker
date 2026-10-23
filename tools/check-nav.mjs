#!/usr/bin/env node
/**
 * check-nav.mjs: checks hand-built procedure files before they go in.
 *
 *     node tools/check-nav.mjs                   # every file in nav/custom/
 *     node tools/check-nav.mjs nav/custom/EGLL.json
 *
 * Errors are what would break or be ignored in the game; warnings are worth
 * a second look. Exits 1 if any file has an error. docs/NAV-AUTHORING.md
 * describes the format.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, airportWorld } from './nav-common.mjs';

const SCOPE_NM = 40;                                   // as approachGame.js
const DESCRIPTORS = new Set(['', '+', '-', 'B', '@']);
const TERMINATORS = new Set(['IF', 'TF', 'CF', 'DF', 'RF', 'AF', 'HF', 'HA', 'HM', 'FA', 'FC', 'FD', 'FM', 'CA', 'CD', 'CI', 'CR', 'VA', 'VD', 'VI', 'VM', 'VR', 'PI']);
const ROLES = new Set(['', 'A', 'I', 'F', 'M']);
const TYPES = new Set(['ILS', 'LOC', 'RNAV', 'RNAV_RNP']);

function check(file) {
    const errors = [], warnings = [];
    const err = m => errors.push(m), warn = m => warnings.push(m);
    let nav;
    try { nav = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { errors: [`not valid JSON: ${e.message}`], warnings }; }
    const icao = path.basename(file, '.json').toUpperCase();
    if (nav.icao !== icao) err(`"icao" is ${JSON.stringify(nav.icao)} but the file is named ${icao}.json`);
    const world = airportWorld(icao);
    if (!world) return { errors: [...errors, `${icao} isn't a playable airport in the game (no usable hard runway of 4,500 ft or more)`], warnings };
    const rwys = new Set(world.ends.map(e => e.id));
    const fix = nav.fix || {};
    if (typeof fix !== 'object' || Array.isArray(fix)) err('"fix" must be an object: { "NAME": [lat, lon, "F"|"V"|"N"] }');

    // Fixes: sane coordinates, near the field.
    const xy = {};
    for (const [id, f] of Object.entries(fix)) {
        if (!Array.isArray(f) || f.length < 2 || !Number.isFinite(f[0]) || !Number.isFinite(f[1]) || Math.abs(f[0]) > 90 || Math.abs(f[1]) > 180) { err(`fix ${id}: needs [lat, lon, kind] in decimal degrees`); continue; }
        if (f[2] != null && !['F', 'V', 'N'].includes(f[2])) warn(`fix ${id}: kind "${f[2]}" isn't F (fix), V (VOR/DME) or N (NDB)`);
        const p = world.proj(f[0], f[1]), d = Math.hypot(p.x, p.y);
        xy[id] = { ...p, d };
        if (d > 150) err(`fix ${id} is ${Math.round(d)} NM from ${icao}: lat/lon swapped or a typo?`);
        else if (d > 80) warn(`fix ${id} is ${Math.round(d)} NM out; the game's scope is ${SCOPE_NM} NM`);
    }
    // Runway threshold fixes ("RW27L") come from the runway data when the file doesn't define them.
    for (const e of world.ends) if (!xy['RW' + e.id]) xy['RW' + e.id] = { ...e.thr, d: Math.hypot(e.thr.x, e.thr.y) };

    const legCheck = (where, l) => {
        if (!Array.isArray(l) || l.length !== 6) { err(`${where}: a leg is [fix, altitude, descriptor, speed, path terminator, role]`); return; }
        const [id, alt, desc, spd, pt, role] = l;
        if (id != null && !xy[id]) err(`${where}: fix ${id} isn't in "fix" (and isn't a runway threshold)`);
        if (alt != null && (!Number.isFinite(alt) || alt < -1500 || alt > 60000)) err(`${where}: altitude ${alt} should be feet, or null`);
        if (!DESCRIPTORS.has(desc)) err(`${where}: altitude descriptor "${desc}" (use "", "+", "-" or "B")`);
        if (spd != null && (!Number.isFinite(spd) || spd < 60 || spd > 350)) err(`${where}: speed ${spd} should be knots, or null`);
        if (!TERMINATORS.has(pt)) err(`${where}: path terminator "${pt}" isn't an ARINC 424 leg type (IF, TF, CF, DF, VA, …)`);
        if (!ROLES.has(role)) err(`${where}: role "${role}" (use "", "A" IAF, "I" IF, "F" FAF or "M" MAP)`);
        if (alt != null && world.elev != null && alt < world.elev + 500 && role !== 'M' && pt !== 'VA') warn(`${where}: ${alt} ft is within 500 ft of the field (${world.elev} ft)`);
    };
    const procCheck = (kind, list) => {
        if (!Array.isArray(list)) { err(`"${kind}" must be a list`); return; }
        const ids = new Set();
        for (const p of list) {
            const name = `${kind.toUpperCase()} ${p?.id ?? '?'}`;
            if (!p || typeof p.id !== 'string' || !p.id) { err(`${kind}: every procedure needs an "id"`); continue; }
            if (ids.has(p.id + (p.rwy || ''))) warn(`${name} appears twice`);
            ids.add(p.id + (p.rwy || ''));
            if (!Array.isArray(p.routes) || !p.routes.length) { err(`${name}: needs "routes": [{ "t": "", "legs": [...] }]`); continue; }
            for (const r of p.routes) {
                if (typeof r.t !== 'string' || !Array.isArray(r.legs) || !r.legs.length) { err(`${name}: each route needs "t" (transition name, "" for the common route) and "legs"`); continue; }
                if (/^RW/.test(r.t)) {
                    const id = r.t.slice(2), both = /B$/.test(id) && [...rwys].some(x => x.replace(/[LRC]$/, '') === id.slice(0, -1));
                    if (!rwys.has(id) && !both) err(`${name}: runway transition ${r.t} names no runway at ${icao} (${[...rwys].join(' ')})`);
                }
                r.legs.forEach((l, i) => legCheck(`${name}${r.t ? ' ' + r.t : ''} leg ${i + 1}`, l));
            }
            if (kind === 'iap') {
                if (!TYPES.has(p.type)) err(`${name}: "type" is ILS, LOC, RNAV or RNAV_RNP`);
                if (!rwys.has(p.rwy)) err(`${name}: "rwy" ${JSON.stringify(p.rwy)} isn't a runway end at ${icao} (${[...rwys].join(' ')})`);
                if (!p.name) warn(`${name}: no "name" (e.g. "ILS RWY 27L")`);
                const main = p.routes.find(r => !r.t)?.legs || [];
                if (!main.length) err(`${name}: needs a common route (t: "") down the final`);
                if (!main.some(l => l[5] === 'F')) err(`${name}: no final approach fix (role "F") on the common route`);
                if (!main.some(l => l[4] === 'IF' && l[0])) warn(`${name}: no IF leg on the common route; the game uses it as the runway's approach fix`);
                if (!main.some(l => l[5] === 'M')) warn(`${name}: no missed approach point (role "M"), usually the runway threshold`);
            }
        }
    };
    // What the game does with each section (approachGame.js realFixes): it needs real routing from two directions each way.
    const paths = (p, isStar) => {
        const common = p.routes.filter(r => !r.t).flatMap(r => r.legs);
        const en = p.routes.filter(r => r.t && !/^RW/.test(r.t));
        return isStar ? (en.length ? en.map(r => [...r.legs, ...common]) : [common]) : (en.length ? en.map(r => [...common, ...r.legs]) : [common]);
    };
    if ('star' in nav) {
        procCheck('star', nav.star);
        const entries = new Set();
        for (const p of nav.star || []) for (const legs of paths(p, true)) {
            const k = legs.find(l => l[0] && xy[l[0]] && xy[l[0]].d <= SCOPE_NM - 3);
            if (!k) warn(`STAR ${p.id}: never comes inside ${SCOPE_NM - 3} NM, so the game can't use it`);
            else if (xy[k[0]].d < 14) warn(`STAR ${p.id}: enters the scope at ${k[0]}, only ${xy[k[0]].d.toFixed(0)} NM out; the game needs 14 NM or more`);
            else entries.add(k[0]);
        }
        if (entries.size < 2) err(`STARs give ${entries.size} usable entry fix(es); the game needs 2 or more, or it drops all of this file's routing for invented fixes`);
    }
    if ('sid' in nav) {
        procCheck('sid', nav.sid);
        const exits = new Set();
        for (const p of nav.sid || []) {
            if (!p.routes?.some(r => /^RW/.test(r.t))) warn(`SID ${p.id}: no runway transition (RW27L…), so every runway may fly it`);
            for (const legs of paths(p, false)) { const last = legs.filter(l => l[0] && xy[l[0]]).pop(); if (last) exits.add(last[0]); }
        }
        if (exits.size < 2) err(`SIDs end at ${exits.size} exit(s); the game needs 2 or more, or it drops all of this file's routing for invented fixes`);
    }
    if ('iap' in nav) {
        procCheck('iap', nav.iap);
        for (const e of world.ends) if (!(nav.iap || []).some(a => a.rwy === e.id)) warn(`runway ${e.id} has no approach: it can only be given a visual`);
    }
    if (!['star', 'sid', 'iap'].some(k => k in nav)) err('no "star", "sid" or "iap": nothing to use');
    if (!nav.source) warn('no "source": the map layers say who built it ("InFlight team" by default)');
    return { errors, warnings };
}

const files = process.argv.slice(2).length ? process.argv.slice(2)
    : fs.existsSync(path.join(ROOT, 'nav', 'custom')) ? fs.readdirSync(path.join(ROOT, 'nav', 'custom')).filter(f => /^[A-Z0-9]{3,4}\.json$/.test(f)).map(f => path.join(ROOT, 'nav', 'custom', f)) : [];
if (!files.length) { console.log('No files in nav/custom/ yet. Start one with: node tools/gen-nav.mjs <ICAO> > nav/custom/<ICAO>.json'); process.exit(0); }
let bad = 0;
for (const f of files) {
    const { errors, warnings } = check(f);
    console.log(`${errors.length ? '✗' : '✓'} ${path.relative(ROOT, f)}${errors.length || warnings.length ? `: ${errors.length} error(s), ${warnings.length} warning(s)` : ''}`);
    for (const m of errors) console.log(`    error   ${m}`);
    for (const m of warnings) console.log(`    warning ${m}`);
    if (errors.length) bad++;
}
process.exit(bad ? 1 : 0);
