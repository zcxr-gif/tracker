// test-va-hub-map.js — the VA hub pins on the live map.
//
// The pins used to be one airport, one logo: the first partner in the roster
// won the field and everybody else hubbed there was not drawn. This exercises
// what replaced that —
//
//   * every VA hubbed at a field is on its pin
//   * several of them stand SIDE BY SIDE, one cell each, each its own link
//   * a field with somebody on frequency CYCLES instead, so the pin stays one
//     box wide next to the ATC tag already on that coordinate
//   * so does a field with more VAs than the row is allowed to be wide
//   * the cycle skips logos that failed to load, holds under the cursor, and
//     opens whichever VA is actually on screen
//   * ATC coming on or going off frequency re-dresses the pin in place
//
// The real functions are pulled out of flight.js and run against a small DOM
// shim, so these are behaviour checks rather than assertions about source text.
//
//   Run:  node tools/test-va-hub-map.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'flight.js'), 'utf8');

let pass = 0;
const ok = (name, fn) => {
    try { fn(); console.log(`  ✓ ${name}`); pass++; }
    catch (err) { console.log(`  ✗ ${name}\n      ${err.message}`); process.exitCode = 1; }
};
const head = (s) => console.log(`\n${s}`);

function slice(startMarker, endMarker) {
    const a = SRC.indexOf(startMarker);
    assert.ok(a >= 0, `missing: ${startMarker}`);
    const b = SRC.indexOf(endMarker, a);
    assert.ok(b > a, `missing end: ${endMarker}`);
    return SRC.slice(a, b);
}

/* ------------------------------------------------------------------ *
 * A DOM small enough to fit in this file.
 *
 * Only what the marker code actually touches: children, classes, the
 * dataset, one-level querySelector, and an <img> whose src fires 'error'
 * synchronously for a URL the test has declared dead.
 * ------------------------------------------------------------------ */

const DEAD = new Set();

function makeEl(tag) {
    const el = {
        tagName: String(tag).toUpperCase(),
        className: '',
        title: '',
        alt: '',
        textContent: '',
        style: {},
        dataset: {},
        children: [],
        parent: null,
        _listeners: {},
        addEventListener(type, fn) {
            (this._listeners[type] = this._listeners[type] || []).push(fn);
        },
        // Test-only: fire a listener the code registered.
        fire(type) {
            const ev = { stopPropagation() {} };
            (this._listeners[type] || []).forEach((fn) => fn(ev));
        },
        appendChild(child) {
            child.parent = this;
            this.children.push(child);
            return child;
        },
        remove() {
            if (!this.parent) return;
            this.parent.children = this.parent.children.filter((c) => c !== this);
            this.parent = null;
        },
        // Deep, class-selector only — which is all the marker code asks for.
        querySelector(sel) {
            const want = String(sel).replace(/^\./, '');
            for (const child of this.children) {
                if (child.className.split(/\s+/).includes(want)) return child;
                const deeper = child.querySelector(sel);
                if (deeper) return deeper;
            }
            return null;
        },
        // Test-only: every descendant carrying a class.
        all(cls) {
            const out = [];
            this.children.forEach((child) => {
                if (child.className.split(/\s+/).includes(cls)) out.push(child);
                out.push(...child.all(cls));
            });
            return out;
        }
    };

    el.classList = {
        add(c) {
            const set = new Set(el.className.split(/\s+/).filter(Boolean));
            set.add(c);
            el.className = [...set].join(' ');
        },
        remove(c) {
            el.className = el.className.split(/\s+/).filter((x) => x && x !== c).join(' ');
        },
        contains(c) { return el.className.split(/\s+/).includes(c); }
    };

    Object.defineProperty(el, 'innerHTML', {
        get() { return ''; },
        set(value) {
            assert.strictEqual(value, '', 'the marker code only ever clears innerHTML');
            el.children.forEach((c) => { c.parent = null; });
            el.children = [];
        }
    });

    if (el.tagName === 'IMG') {
        Object.defineProperty(el, 'src', {
            get() { return el._src; },
            set(value) {
                el._src = value;
                // Synchronous so the tests stay ordered; the browser fires it
                // on a later task, which the code does not depend on.
                if (DEAD.has(value)) el.fire('error');
            }
        });
    }

    return el;
}

const documentShim = {
    hidden: false,
    createElement: makeEl,
    head: makeEl('head')
};

/* ------------------------------------------------------------------ *
 * The real code, in a sandbox.
 * ------------------------------------------------------------------ */

const hubSrc = slice('let vaHubMarkers = [];', 'function renderVaHubMarkers');

const opened = [];
const windowShim = {
    InflightVaAds: { openPartners: (id) => opened.push(String(id)) },
    addEventListener() {}
};

const box = {};
// eslint-disable-next-line no-new-func
new Function('document', 'window', 'setInterval', 'clearInterval', `
    let activeAtcFacilities = [];
    ${hubSrc}
    this.dress = dressVaHubMarker;
    this.step = stepVaHubCycles;
    this.stop = stopVaHubCycle;
    this.refresh = refreshVaHubMarkerModes;
    this.atcIcaos = vaHubAtcIcaos;
    this.clear = clearVaHubMarkers;
    this.cap = VA_HUB_MAX_SIDE_BY_SIDE;
    this.cycleMs = VA_HUB_CYCLE_MS;
    this.cyclers = () => vaHubCyclers;
    this.setAtc = (list) => { activeAtcFacilities = list; };
    this.setMarkers = (list) => { vaHubMarkers = list; };
`).call(box, documentShim, windowShim, () => 1, () => {});

const va = (id, name, logo) => ({ id, name, logo: logo || `https://cdn/${id}.png` });

function pin(ads, cycles) {
    const el = makeEl('div');
    el.className = 'va-hub-marker';
    const entry = { el, icao: 'KJFK', ads, cycler: null, cycles: !!cycles, marker: { remove() {} } };
    box.dress(entry, !!cycles);
    return entry;
}

/* ------------------------------------------------------------------ */
head('Several VAs at one field');

ok('every VA hubbed there gets a cell, side by side', () => {
    const entry = pin([va('a', 'Alpha'), va('b', 'Bravo'), va('c', 'Charlie')], false);
    const cells = entry.el.all('va-hub-cell');
    assert.strictEqual(cells.length, 3, 'one cell per VA');
    assert.strictEqual(entry.el.all('va-hub-face').length, 0, 'a row is not a stack');
});

ok('the tooltip names all of them', () => {
    const entry = pin([va('a', 'Alpha'), va('b', 'Bravo')], false);
    assert.match(entry.el.title, /Alpha/);
    assert.match(entry.el.title, /Bravo/);
});

ok('a single VA is still a single cell with no counter', () => {
    const entry = pin([va('a', 'Alpha')], false);
    assert.strictEqual(entry.el.all('va-hub-cell').length, 1);
    assert.strictEqual(entry.el.all('va-hub-count').length, 0);
});

ok('each cell opens its own VA', () => {
    opened.length = 0;
    const entry = pin([va('a', 'Alpha'), va('b', 'Bravo')], false);
    entry.el.all('va-hub-cell')[1].fire('click');
    assert.deepStrictEqual(opened, ['b'], 'the second logo opens the second VA');
});

ok('a VA listing the same field twice is not two logos', () => {
    // The de-duplication lives in the grouping inside renderVaHubMarkers.
    const render = slice('function renderVaHubMarkers', 'window.renderVaHubMarkers');
    assert.match(render, /!list\.some\(\(other\) => String\(other\.id\) === String\(ad\.id\)\)/);
});

ok('a dead logo takes its own cell out, not the whole pin', () => {
    DEAD.add('https://cdn/b.png');
    const entry = pin([va('a', 'Alpha'), va('b', 'Bravo'), va('c', 'Charlie')], false);
    DEAD.delete('https://cdn/b.png');
    assert.strictEqual(entry.el.all('va-hub-cell').length, 2, 'the broken one is gone');
    assert.notStrictEqual(entry.el.style.display, 'none', 'the pin survives');
});

ok('…but a pin whose every logo is dead hides itself', () => {
    DEAD.add('https://cdn/a.png');
    const entry = pin([va('a', 'Alpha')], false);
    DEAD.delete('https://cdn/a.png');
    assert.strictEqual(entry.el.style.display, 'none');
});

/* ------------------------------------------------------------------ */
head('A field with somebody on frequency');

ok('an open position at the field puts it in the ATC set', () => {
    box.setAtc([{ airportName: 'kjfk', type: 1 }]);
    assert.ok(box.atcIcaos().has('KJFK'), 'matched case-insensitively');
});

ok('a centre is not a field being staffed', () => {
    box.setAtc([{ airportName: 'KZNY', type: 6 }]);
    assert.strictEqual(box.atcIcaos().size, 0, 'type 6 has no airport to speak for');
});

ok('the pin becomes one cell with every logo stacked in it', () => {
    const entry = pin([va('a', 'Alpha'), va('b', 'Bravo'), va('c', 'Charlie')], true);
    assert.strictEqual(entry.el.all('va-hub-cell').length, 1, 'one box wide, whatever the count');
    assert.strictEqual(entry.el.all('va-hub-face').length, 3, 'all three are in it');
});

ok('exactly one face is live at a time', () => {
    const entry = pin([va('a', 'Alpha'), va('b', 'Bravo')], true);
    const on = entry.el.all('va-hub-face').filter((f) => f.classList.contains('is-on'));
    assert.strictEqual(on.length, 1);
});

ok('the stack says how many are in it', () => {
    const entry = pin([va('a', 'Alpha'), va('b', 'Bravo'), va('c', 'Charlie')], true);
    const count = entry.el.all('va-hub-count')[0];
    assert.ok(count, 'a counter is drawn');
    assert.strictEqual(count.textContent, '3');
});

ok('a lone VA at a staffed field gets no counter', () => {
    const entry = pin([va('a', 'Alpha')], true);
    assert.strictEqual(entry.el.all('va-hub-count').length, 0, 'nothing to count through');
});

/* ------------------------------------------------------------------ */
head('Cycling');

ok('a tick moves to the next logo', () => {
    const entry = pin([va('a', 'Alpha'), va('b', 'Bravo'), va('c', 'Charlie')], true);
    const faces = entry.el.all('va-hub-face');
    assert.ok(faces[0].classList.contains('is-on'));
    box.step();
    assert.ok(faces[1].classList.contains('is-on'), 'advanced');
    assert.ok(!faces[0].classList.contains('is-on'), 'and only one is lit');
});

ok('it wraps back round', () => {
    const entry = pin([va('a', 'Alpha'), va('b', 'Bravo')], true);
    const faces = entry.el.all('va-hub-face');
    box.step();
    box.step();
    assert.ok(faces[0].classList.contains('is-on'));
});

ok('a logo that failed to load is skipped rather than shown blank', () => {
    DEAD.add('https://cdn/b.png');
    const entry = pin([va('a', 'Alpha'), va('b', 'Bravo'), va('c', 'Charlie')], true);
    DEAD.delete('https://cdn/b.png');
    const faces = entry.el.all('va-hub-face');
    assert.strictEqual(faces.length, 3, 'the broken face stays in the stack, marked');
    assert.strictEqual(faces[1].dataset.broken, '1');
    box.step();
    assert.ok(faces[2].classList.contains('is-on'), 'stepped straight past it');
});

ok('a stack where everything is broken simply stops rather than spinning', () => {
    DEAD.add('https://cdn/a.png');
    DEAD.add('https://cdn/b.png');
    const entry = pin([va('a', 'Alpha'), va('b', 'Bravo')], true);
    DEAD.delete('https://cdn/a.png');
    DEAD.delete('https://cdn/b.png');
    const faces = entry.el.all('va-hub-face');
    box.step();
    assert.ok(faces[0].classList.contains('is-on'), 'left where it was');
});

ok('it holds still under the cursor', () => {
    const entry = pin([va('a', 'Alpha'), va('b', 'Bravo')], true);
    const inner = entry.el.querySelector('.va-hub-marker-inner');
    const faces = entry.el.all('va-hub-face');
    inner.fire('mouseenter');
    box.step();
    assert.ok(faces[0].classList.contains('is-on'), 'paused');
    inner.fire('mouseleave');
    box.step();
    assert.ok(faces[1].classList.contains('is-on'), 'and resumes');
});

ok('a hidden tab does no work at all', () => {
    const entry = pin([va('a', 'Alpha'), va('b', 'Bravo')], true);
    const faces = entry.el.all('va-hub-face');
    documentShim.hidden = true;
    box.step();
    documentShim.hidden = false;
    assert.ok(faces[0].classList.contains('is-on'));
});

ok('the click opens whichever VA is on screen, not the first', () => {
    opened.length = 0;
    const entry = pin([va('a', 'Alpha'), va('b', 'Bravo')], true);
    const inner = entry.el.querySelector('.va-hub-marker-inner');
    box.step();
    inner.fire('click');
    assert.deepStrictEqual(opened, ['b']);
});

ok('one interval drives every pin, not one each', () => {
    const cycling = slice('function startVaHubCycle', 'function stepVaHubCycles');
    assert.match(cycling, /if \(vaHubCycleTimer \|\| !vaHubCyclers\.length\) return;/);
    assert.strictEqual((hubSrc.match(/setInterval\(/g) || []).length, 1);
});

/* ------------------------------------------------------------------ */
head('Changing its mind');

ok('re-dressing a pin drops its old cycler', () => {
    const before = box.cyclers().length;
    const entry = pin([va('a', 'Alpha'), va('b', 'Bravo')], true);
    assert.strictEqual(box.cyclers().length, before + 1);
    box.dress(entry, false);
    assert.strictEqual(box.cyclers().length, before, 'the stale one is gone');
});

ok('…and its old handlers with it', () => {
    // The cycling click lives on the box, which the re-dress replaces — a
    // handler on the root would outlive the stack it closes over.
    const dress = slice('function dressVaHubMarker', 'function refreshVaHubMarkerModes');
    assert.match(dress, /inner\.addEventListener\('click'/);
    assert.ok(!/entry\.el\.addEventListener\('click'/.test(dress), 'no click on the root');
    assert.ok(!/entry\.el\.addEventListener\('mouse/.test(dress), 'no hover on the root');
});

ok('a pin hidden by dead logos gets to try again when it is re-dressed', () => {
    DEAD.add('https://cdn/a.png');
    const entry = pin([va('a', 'Alpha')], false);
    DEAD.delete('https://cdn/a.png');
    assert.strictEqual(entry.el.style.display, 'none');
    box.dress(entry, false);
    assert.strictEqual(entry.el.style.display, '');
});

ok('ATC coming on frequency flips the field to a stack', () => {
    box.clear();
    const entry = pin([va('a', 'Alpha'), va('b', 'Bravo')], false);
    box.setMarkers([entry]);
    box.setAtc([{ airportName: 'KJFK', type: 1 }]);
    box.refresh();
    assert.strictEqual(entry.cycles, true);
    assert.strictEqual(entry.el.all('va-hub-cell').length, 1);
    assert.strictEqual(entry.el.all('va-hub-face').length, 2);
});

ok('…and going off frequency puts the row back', () => {
    box.setAtc([]);
    box.refresh();
    const entry = box.cyclers();
    assert.strictEqual(entry.length, 0, 'nothing is cycling any more');
});

ok('a field whose ATC did not change is not rebuilt', () => {
    box.clear();
    const entry = pin([va('a', 'Alpha'), va('b', 'Bravo')], false);
    box.setMarkers([entry]);
    box.setAtc([]);
    const cells = entry.el.all('va-hub-cell');
    box.refresh();
    assert.strictEqual(entry.el.all('va-hub-cell')[0], cells[0], 'the same DOM, untouched');
});

/* ------------------------------------------------------------------ */
head('The cap');

ok('a row is capped, and past it the pin cycles instead', () => {
    assert.ok(box.cap >= 2 && box.cap <= 6, `cap is a sane row width (${box.cap})`);
    const render = slice('function renderVaHubMarkers', 'window.renderVaHubMarkers');
    assert.match(render, /atc\.has\(icao\) \|\| list\.length > VA_HUB_MAX_SIDE_BY_SIDE/);
    const refresh = slice('function refreshVaHubMarkerModes', 'function renderVaHubMarkers');
    assert.match(refresh, /atc\.has\(entry\.icao\) \|\| entry\.ads\.length > VA_HUB_MAX_SIDE_BY_SIDE/);
});

ok('a logo holds long enough to read and not so long it looks stuck', () => {
    assert.ok(box.cycleMs >= 2000 && box.cycleMs <= 6000, `dwell is ${box.cycleMs}ms`);
});

/* ------------------------------------------------------------------ */
head('The box itself');

const styles = slice('function injectVaHubMarkerStyles', 'function clearVaHubMarkers');

ok('the box is free to grow sideways', () => {
    const inner = styles.match(/\.va-hub-marker-inner\s*\{[^}]*\}/)[0];
    assert.ok(!/width:/.test(inner), 'a hard width would clip the second logo');
    assert.match(inner, /height:\s*30px/);
});

ok('a cell is a fixed 30px, so the row grows by whole logos', () => {
    assert.match(styles, /\.va-hub-cell\s*\{[^}]*flex:\s*0 0 30px/);
    assert.match(styles, /\.va-hub-cell\s*\{[^}]*width:\s*30px/);
});

ok('the logos in a stack cross-fade rather than cut', () => {
    assert.match(styles, /\.va-hub-face\s*\{[^}]*transition:\s*opacity/);
    assert.match(styles, /\.va-hub-face\s*\{[^}]*opacity:\s*0/);
    assert.match(styles, /\.va-hub-face\.is-on\s*\{\s*opacity:\s*1/);
});

ok('no marker dimension is derived from zoom', () => {
    assert.ok(!/zoom/i.test(styles), 'no zoom reference');
    assert.ok(!/vw|vh/.test(styles), 'no viewport units in the pin');
});

/* ------------------------------------------------------------------ */
head('Wiring');

ok('the pins are re-dressed when the ATC feed lands', () => {
    const render = slice('function renderVaHubMarkers', 'window.renderVaHubMarkers');
    assert.match(render, /addEventListener\('activeAtcUpdated'/);
    assert.match(render, /refreshVaHubMarkerModes\(\)/);
    assert.match(render, /vaHubAtcWatchBound/, 'bound once, not once per render');
});

ok('clearing the pins also stops the cycle', () => {
    const clear = slice('function clearVaHubMarkers', 'function vaHubAtcIcaos');
    assert.match(clear, /vaHubCyclers = \[\]/);
    assert.match(clear, /stopVaHubCycle\(\)/);
});

box.stop();
console.log(`\n${process.exitCode ? 'FAILURES above. ' : ''}${pass} checks passed.`);
