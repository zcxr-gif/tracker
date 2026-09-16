#!/usr/bin/env node
/*
 * add-aircraft-3d.js — paste the embed, get the aeroplane.
 *
 * WHY THIS EXISTS
 *
 * Sketchfab's share button gives you a block of HTML. Everything the crew
 * center needs is already in it — the model id, what the model is of, and who
 * made it — so the one thing nobody should have to do is read it back out and
 * retype it as a registry key. That is the step that gets done wrong ("787-9"
 * vs "Boeing 787-9" vs "B789") and the step that stops people adding models at
 * all.
 *
 * So: paste the block, and this writes the line into crewAircraft3D.js under
 * the right author, then tells you which aircraft it will answer to so you can
 * see it landed where you meant it to.
 *
 *   node tools/add-aircraft-3d.js < embed.txt
 *   pbpaste | node tools/add-aircraft-3d.js
 *   node tools/add-aircraft-3d.js 'https://sketchfab.com/3d-models/…' --at outpiston
 *
 *   --dry            print what it would add, change nothing
 *   --title "…"      override the name taken from the URL slug
 *   --also "A,B"     extra names the model should answer to
 *   --by "…" --at h  the author, when the paste was only a URL
 *
 * The matching itself is not reimplemented here: this loads crewAircraft3D.js
 * and asks it, so what the tool reports is what the crew center will do.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'crewAircraft3D.js');

/* ---- arguments -------------------------------------------------------- */
const argv = process.argv.slice(2);
const flag = (name) => {
    const i = argv.indexOf('--' + name);
    if (i === -1) return null;
    const v = argv[i + 1];
    argv.splice(i, v === undefined || v.startsWith('--') ? 1 : 2);
    return v === undefined || v.startsWith('--') ? '' : v;
};
const DRY = argv.includes('--dry');
const TITLE = flag('title');
const ALSO = (flag('also') || '').split(',').map((s) => s.trim()).filter(Boolean);
const BY = flag('by');
const AT = flag('at');
const inline = argv.filter((a) => !a.startsWith('--')).join(' ');

/* ---- the module, loaded rather than reimplemented ---------------------- */
function loadModule(source) {
    const ctx = {
        console: { warn() {}, log() {} },
        document: { addEventListener() {}, documentElement: { classList: { contains: () => false } } },
        encodeURIComponent, JSON, String, Number, Object, Array, RegExp, Math,
    };
    ctx.window = ctx;
    ctx.window.CrewPanels = { esc: (s) => String(s), icons() {}, style() {}, sheet() { return {}; } };
    vm.createContext(ctx);
    vm.runInContext(source, ctx);
    return ctx.window.CrewAircraft3D;
}

function read() {
    if (inline) return Promise.resolve(inline);
    if (process.stdin.isTTY) return Promise.resolve('');
    return new Promise((resolve) => {
        let buf = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (d) => { buf += d; });
        process.stdin.on('end', () => resolve(buf));
    });
}

function die(msg) { console.error('\n  ' + msg + '\n'); process.exit(1); }

read().then((text) => {
    if (!text.trim()) {
        die('Nothing to read. Paste the Sketchfab embed code on stdin, or pass the model URL.');
    }
    const source = fs.readFileSync(FILE, 'utf8');
    const A = loadModule(source);
    const m = A.parseEmbed(text);
    if (!m) die('No Sketchfab model id in that. The id is the 32-character hex string in the URL.');

    const title = TITLE || m.title || '';
    const by = BY || m.by || '';
    const at = AT || m.at || '';
    if (!title) die('No name for this model. The URL slug had none — pass --title "Boeing 787-9".');
    if (!at) die('No author. The paste carried no profile link — pass --by "NAME" --at handle.');

    if (source.includes(m.uid)) {
        console.log(`\n  Already in the library: ${title} (${m.uid}).\n`);
        process.exit(0);
    }

    const url = m.slug
        ? `https://sketchfab.com/3d-models/${m.slug}-${m.uid}`
        : `https://sketchfab.com/models/${m.uid}`;
    const needsObject = (TITLE && m.slug && TITLE !== m.title) || ALSO.length;
    const line = needsObject
        ? `{ url: '${url}', title: '${title.replace(/'/g, "\\'")}'`
            + (ALSO.length ? `, also: [${ALSO.map((s) => `'${s.replace(/'/g, "\\'")}'`).join(', ')}]` : '')
            + ' },'
        : `'${url}',`;

    /* ---- where it goes ------------------------------------------------- */
    // Anchored to a whole line, because both markers are also NAMED in the
    // file's own documentation a hundred lines above the library — an
    // unanchored match writes the new model into a comment.
    const anchor = (name) => new RegExp(`^([ \\t]*)// ac3d:${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*$`, 'm');
    let next;
    if (anchor(at).test(source)) {
        next = source.replace(anchor(at), (_all, indent) => `${indent}${line}\n${indent}// ac3d:${at}`);
    } else {
        const block = `        {\n`
            + `            by: '${(by || at).replace(/'/g, "\\'")}', at: '${at}', models: [\n`
            + `                ${line}\n`
            + `                // ac3d:${at}\n`
            + `            ],\n`
            + `        },\n`;
        if (!anchor('authors').test(source)) die('crewAircraft3D.js has lost its ac3d:authors marker.');
        next = source.replace(anchor('authors'), (_all, indent) => `${block}${indent}// ac3d:authors`);
    }
    if (next === source) die('Could not find where to put it — the library markers have moved.');

    /* ---- what it will answer to ---------------------------------------- */
    const after = loadModule(next);
    const added = after.all().find((x) => x.uid === m.uid);
    const TRY = [title, title.replace(/[\s-]+\d+[a-z]*$/i, ''), ...ALSO]
        .map((s) => s.trim())
        .filter((s, i, all) => s && all.indexOf(s) === i);
    const answers = [];
    for (const name of TRY) {
        const hit = after.forType(name);
        if (hit && hit.model.uid === m.uid) answers.push(`${name} → ${hit.exact ? 'exact' : 'closest match'}`);
    }
    // Anything already in the library that this one now takes over, or loses to.
    const clashes = after.all()
        .filter((x) => x.uid !== m.uid && added
            && x.keys.some((k) => added.keys.some((k2) => k2.key === k.key)))
        .map((x) => x.title);

    console.log(`\n  ${title}`);
    console.log(`  by ${by || at} (sketchfab.com/${at})`);
    console.log(`  ${url}`);
    console.log(`\n  Answers to:`);
    answers.forEach((a) => console.log(`    ${a}`));
    if (!answers.length) console.log('    nothing — check the title, this model will never be shown');
    if (clashes.length) console.log(`\n  Same aircraft as: ${clashes.join(', ')} (the first one written wins)`);

    if (DRY) { console.log(`\n  --dry: nothing written.\n`); process.exit(0); }
    fs.writeFileSync(FILE, next);
    console.log(`\n  Written to crewAircraft3D.js\n`);
});
