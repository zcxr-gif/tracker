/*
 * test-aircraft-3d.js — the right aeroplane, or none, and always the credit.
 *
 * WHY THIS TEST EXISTS
 *
 * crewAircraft3D.js makes two promises that are easy to break by accident and
 * expensive to break in public.
 *
 *   1. IT SHOWS THE RIGHT AEROPLANE, OR SAYS SO. A 787-9 model against a
 *      787-10 is useful; a 787-9 model presented AS a 787-10 is the crew center
 *      inventing data, which is the one thing the rest of these modules were
 *      rewritten to stop doing. So every match carries whether it is exact, and
 *      a match that is merely close must never come back as exact.
 *
 *   2. A MODEL WE SHOW IS A MODEL WE CREDIT. These are somebody else's work,
 *      embedded on every crew center that has the type in its fleet. The
 *      author's name and a link to them must reach the page every single time
 *      the viewer opens — the same rule test-aircraft-credit.js enforces for
 *      photographs.
 *
 * And one thing that is not a promise so much as the reason anybody will keep
 * the library up to date: pasting Sketchfab's embed code must be enough. If
 * parseEmbed stops reading the title, the id or the author out of that block,
 * adding a model goes back to being a typing job.
 *
 * Node builtins only — no browser, no network, no install.
 *
 * Run:  node tools/test-aircraft-3d.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${extra !== undefined ? `\n         ${extra}` : ''}`); }
};
const section = (t) => console.log(`\n${t}`);

/* ---- the module, with only as much host as it touches ------------------ */
function load(library) {
    let source = fs.readFileSync(path.join(ROOT, 'crewAircraft3D.js'), 'utf8');
    if (library) {
        // Swap the shipped library for the test's own, so these assertions are
        // about the MATCHING and not about which models we happen to carry
        // today. The shipped one is checked separately, below.
        const start = source.indexOf('const LIBRARY = [');
        const end = source.indexOf('\n    ];', start);
        if (start === -1 || end === -1) throw new Error('LIBRARY block not found');
        source = source.slice(0, start) + 'const LIBRARY = ' + JSON.stringify(library) + ';'
            + source.slice(end + '\n    ];'.length);
    }
    const styles = [];
    const sheets = [];
    const listeners = [];
    const ctx = {
        console: { warn() {}, error() {} },
        encodeURIComponent, JSON, String, Number, Object, Array, RegExp, Math,
        document: {
            addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
            documentElement: { classList: { contains: () => false } },
        },
    };
    ctx.window = ctx;
    ctx.window.CrewPanels = {
        esc: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
        icons() {},
        style: (id, css) => { styles.push(id); return true; },
        sheet(opts) {
            const panel = {
                opts,
                title: opts.title,
                body: { innerHTML: '' },
                el: { classList: { contains: () => false } },
                open() { panel.opened = true; },
                close() { panel.opened = false; },
                isOpen: () => !!panel.opened,
                setTitle(t) { panel.title = t; },
            };
            sheets.push(panel);
            return panel;
        },
    };
    vm.createContext(ctx);
    vm.runInContext(source, ctx);
    return { A: ctx.window.CrewAircraft3D, styles, sheets, listeners };
}

/* The embed Sketchfab hands you, unedited. */
const EMBED = '<div class="sketchfab-embed-wrapper"> <iframe title="Boeing 787-9" frameborder="0"'
    + ' allowfullscreen mozallowfullscreen="true" webkitallowfullscreen="true"'
    + ' allow="autoplay; fullscreen; xr-spatial-tracking" xr-spatial-tracking'
    + ' execution-while-out-of-viewport execution-while-not-rendered web-share'
    + ' src="https://sketchfab.com/models/95967154ac554bd88b5620613a7c85b3/embed"> </iframe>'
    + ' <p style="font-size: 13px; font-weight: normal; margin: 5px; color: #4A4A4A;">'
    + ' <a href="https://sketchfab.com/3d-models/boeing-787-9-95967154ac554bd88b5620613a7c85b3"'
    + ' target="_blank" rel="nofollow" style="font-weight: bold; color: #1CAAD9;"> Boeing 787-9 </a>'
    + ' by <a href="https://sketchfab.com/outpiston" target="_blank" rel="nofollow"'
    + ' style="font-weight: bold; color: #1CAAD9;"> OUTPISTON </a> on'
    + ' <a href="https://sketchfab.com" target="_blank" rel="nofollow"'
    + ' style="font-weight: bold; color: #1CAAD9;">Sketchfab</a></p></div>';

const LIB = [{
    by: 'OUTPISTON', at: 'outpiston', models: [
        'https://sketchfab.com/3d-models/boeing-787-9-95967154ac554bd88b5620613a7c85b3',
        'https://sketchfab.com/3d-models/airbus-a320-200-11111111111111111111111111111111',
        'https://sketchfab.com/3d-models/cessna-172-22222222222222222222222222222222',
    ],
}];

/* =======================================================================
 * 1. Pasting the embed is enough
 * ==================================================================== */
section('Reading what Sketchfab gives you');
{
    const { A } = load(LIB);
    const m = A.parseEmbed(EMBED);
    ok('the model id comes out of the whole embed block',
        m && m.uid === '95967154ac554bd88b5620613a7c85b3', m && m.uid);
    ok('the aircraft comes out with it — nobody types it', m && m.title === 'Boeing 787-9', m && m.title);
    ok('the author is read, name and handle',
        m && m.by === 'OUTPISTON' && m.at === 'outpiston', m && `${m.by}/${m.at}`);
    ok('Sketchfab itself is not mistaken for the author', m && m.at !== '3d-models');

    const bare = A.parseEmbed('https://sketchfab.com/3d-models/boeing-787-9-95967154ac554bd88b5620613a7c85b3');
    ok('a bare model URL works too', bare && bare.title === 'Boeing 787-9' && bare.slug === 'boeing-787-9');
    ok('something with no model id in it is refused, not guessed',
        A.parseEmbed('https://sketchfab.com/outpiston') === null);
    ok('and so is nothing at all', A.parseEmbed('') === null && A.parseEmbed(null) === null);

    ok('a slug becomes a name a human would write: boeing-787-9 -> Boeing 787-9',
        A.titleFromSlug('boeing-787-9') === 'Boeing 787-9', A.titleFromSlug('boeing-787-9'));
    ok('…and airbus-a350-900 -> Airbus A350-900',
        A.titleFromSlug('airbus-a350-900') === 'Airbus A350-900', A.titleFromSlug('airbus-a350-900'));
    ok('…and boeing-737-max-8 -> Boeing 737 MAX 8',
        A.titleFromSlug('boeing-737-max-8') === 'Boeing 737 MAX 8', A.titleFromSlug('boeing-737-max-8'));
}

/* =======================================================================
 * 2. Family and variant
 * ==================================================================== */
section('What a type name says');
{
    const { A } = load(LIB);
    const key = (n) => { const d = A.designator(n); return d ? d.key : null; };
    const cases = [
        ['Boeing 787-9', 'b787-9'],
        ['Boeing 787-10 Dreamliner', 'b787-10'],
        ['Boeing 737-800', 'b737-800'],
        ['Boeing 737 MAX 8', 'b737-max8'],
        ['Boeing 777-300ER', 'b777-300er'],
        ['Boeing 747-8', 'b747-8'],
        ['Airbus A320-200', 'a320-200'],
        ['Airbus A350-1000', 'a350-1000'],
        ['A321neo', 'a321-neo'],
        ['CRJ-900', 'crj900'],
        ['Embraer E175', 'e175'],
        ['McDonnell Douglas MD-11', 'md11'],
        ['Dash 8 Q400', 'q400'],
    ];
    for (const [name, want] of cases) ok(`${name} -> ${want}`, key(name) === want, key(name));

    ok('a MAX is not an -800: the two keys differ', key('Boeing 737 MAX 8') !== key('Boeing 737-800'));
    ok('ICAO codes are the same aeroplane as their long name',
        key('B789') === key('Boeing 787-9') && key('A359') === key('Airbus A350-900'),
        `${key('B789')} / ${key('A359')}`);
    ok('a code inside a sentence is still read as one type',
        key('B738 heavy') === 'b737-800', key('B738 heavy'));
    ok('a name with no designator in it says so', A.designator('Cessna 172 Skyhawk') === null);
    ok('and so does an empty one', A.designator('') === null && A.designator(null) === null);
}

/* =======================================================================
 * 3. The right aeroplane, or an honest "closest"
 * ==================================================================== */
section('Matching a type to a model');
{
    const { A } = load(LIB);
    const hit = (n) => A.forType(n);

    const exact = hit('Boeing 787-9');
    ok('the exact variant is exact', exact && exact.exact === true && exact.model.title === 'Boeing 787-9');

    const close = hit('Boeing 787-10 Dreamliner');
    ok('a different variant of the same family is offered', !!close);
    ok('…but NEVER as exact', close && close.exact === false);
    ok('…and it is labelled with what it actually is',
        close && close.model.title === 'Boeing 787-9', close && close.model.title);

    ok('the API\'s own long name matches', (hit('Airbus A320-200') || {}).exact === true);
    ok('what staff typed into a schedule matches: "B789"', (hit('B789') || {}).exact === true);
    ok('a type with no designator matches on its words',
        (hit('Cessna 172 Skyhawk') || {}).model && hit('Cessna 172 Skyhawk').model.title === 'Cessna 172');
    ok('a type we have nothing for gets nothing', hit('Boeing 747-400') === null);
    ok('a different manufacturer never matches', hit('Airbus A380-800') === null);
    ok('the 787 model does not answer for the A320', hit('Airbus A320-200').model.uid !== exact.model.uid);
    ok('nonsense gets nothing, not the first thing in the list',
        hit('') === null && hit(null) === null && hit('    ') === null);

    ok('an aircraft object is read the way the fleet board holds one',
        (A.forAircraft({ registration: 'G-ABCD', type: { name: 'Boeing 787-9' } }) || {}).exact === true);
    ok('…and the way the schedule holds one', (A.forAircraft({ type: 'B789' }) || {}).exact === true);
    ok('an aircraft with no type at all is not a match', A.forAircraft({}) === null);
}

/* =======================================================================
 * 4. Markup that cannot make a row worse
 * ==================================================================== */
section('What gets painted');
{
    const { A } = load(LIB);
    const IMG = '<img class="cai" src="data:image/svg+xml,x" alt="G-ABCD, Boeing 787-9">';

    const badged = A.thumb(IMG, { type: { name: 'Boeing 787-9' } });
    ok('a type we have a model of gains a badge', /ac3d-badge/.test(badged) && badged.includes(IMG));
    ok('…which carries the model id to open', /data-ac3d="95967154ac554bd88b5620613a7c85b3"/.test(badged));
    ok('…and says what it is, for a screen reader', /aria-label="[^"]+"/.test(badged));

    const plain = A.thumb(IMG, { type: { name: 'Boeing 747-400' } });
    ok('a type we have nothing for is returned EXACTLY as it came in', plain === IMG);
    ok('no picture in, no markup out', A.thumb('', { type: { name: 'Boeing 787-9' } }) === '');

    const closest = A.thumb(IMG, { type: { name: 'Boeing 787-10' } });
    ok('the closest-match badge is honest in its label', /closest model we have/.test(closest));
    ok('…and carries that into the markup, so the viewer can say it too',
        /data-ac3d-approx="1"/.test(closest));
    ok('an exact match is not marked approximate',
        !/data-ac3d-approx/.test(A.thumb(IMG, { type: { name: 'Boeing 787-9' } })));

    ok('the inline pill is offered for a schedule leg',
        /ac3d-link/.test(A.button({ type: 'Boeing 787-9' }, { inline: true })));
    ok('…and is empty for a leg we have no model of',
        A.button({ type: 'Boeing 747-400' }, { inline: true }) === '');
    ok('the full button is a crewPanels button',
        /cp-btn/.test(A.button({ type: 'Boeing 787-9' })));

    let threw = null;
    try {
        A.thumb(IMG, null); A.thumb(null, null); A.button(undefined);
        A.forType({ nonsense: true }); A.thumb(IMG, { type: { name: 12345 } });
    } catch (err) { threw = err; }
    ok('nothing here throws — it runs inside somebody else\'s render', threw === null, threw && threw.message);
}

/* =======================================================================
 * 5. A model we show is a model we credit
 * ==================================================================== */
section('The viewer');
{
    const { A, sheets } = load(LIB);
    A.open('95967154ac554bd88b5620613a7c85b3');
    const panel = sheets[0];
    ok('the viewer opens', panel && panel.opened === true);
    ok('titled with the model', panel && panel.title === 'Boeing 787-9', panel && panel.title);

    const html = panel ? panel.body.innerHTML : '';
    ok('the embed is the model that was asked for',
        html.includes('sketchfab.com/models/95967154ac554bd88b5620613a7c85b3/embed'));
    ok('THE AUTHOR IS NAMED', html.includes('OUTPISTON'));
    ok('THE AUTHOR IS LINKED', html.includes('https://sketchfab.com/outpiston'));
    ok('the model page is linked',
        html.includes('3d-models/boeing-787-9-95967154ac554bd88b5620613a7c85b3'));
    ok('Sketchfab is named as the source', html.includes('>Sketchfab<'));
    ok('every outbound link is rel="noopener nofollow"',
        (html.match(/<a /g) || []).length === (html.match(/rel="noopener nofollow"/g) || []).length,
        html);
    ok('the iframe is allowed to go fullscreen and to track a headset',
        /allowfullscreen/.test(html) && /xr-spatial-tracking/.test(html));

    ok('an exact match does not apologise for itself', !/closest model/.test(html));
    ok('a closest match says so IN THE PANEL, not only in a tooltip', (() => {
        const v = load(LIB);
        v.A.open('95967154ac554bd88b5620613a7c85b3', false);
        return /not this exact variant/.test(v.sheets[0].body.innerHTML);
    })());

    ok('a model id we do not have opens nothing', (() => {
        const before = sheets.length;
        A.open('ffffffffffffffffffffffffffffffff');
        return sheets.length === before && sheets[0].title === 'Boeing 787-9';
    })());

    ok('clicks are captured, not left to bubble into the row underneath', (() => {
        const { listeners } = load(LIB);
        const click = listeners.find((l) => l.type === 'click');
        return !!click && click.capture === true;
    })());
}

/* =======================================================================
 * 6. The library we actually ship
 * ==================================================================== */
section('The shipped library');
{
    const { A } = load(null);
    const all = A.all();
    ok('there is at least one model in it', all.length > 0);
    ok('every model has an id, a title and an author',
        all.every((m) => /^[0-9a-f]{32}$/.test(m.uid) && m.title && m.by && m.at),
        JSON.stringify(all.map((m) => [m.uid, m.title, m.by, m.at])));
    ok('no model is in there twice',
        new Set(all.map((m) => m.uid)).size === all.length);
    ok('every model answers to its own name',
        all.every((m) => { const h = A.forType(m.title); return h && h.model.uid === m.uid; }),
        all.filter((m) => { const h = A.forType(m.title); return !h || h.model.uid !== m.uid; })
            .map((m) => m.title).join(', '));

    const source = fs.readFileSync(path.join(ROOT, 'crewAircraft3D.js'), 'utf8');
    ok('the marker tools/add-aircraft-3d.js writes to is still there',
        /^[ \t]*\/\/ ac3d:authors[ \t]*$/m.test(source));
    ok('nothing is loaded until somebody asks — no iframe at rest',
        !/<iframe/.test(source.split('function open(')[0]));
}

console.log(`\n${fail ? 'FAILED' : 'PASSED'} — ${pass} ok, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
