// test-crew-zulu.js
// The clock in the top bar, checked against the one thing it must never get
// wrong: the time.
//
// crewZulu's only real logic is `reading()` — turning a Date into the string a
// pilot glances at and the sentence behind it — and it is worth asserting
// rather than eyeballing, because every failure mode here is silent. A clock
// that is an hour out, or that drops a leading zero, or that shows yesterday's
// date after 0000Z, looks exactly like a clock that is right.
//
// Pure: no browser, no playwright. The module wants `window` and `document`, so
// it gets just enough of both to load — everything under test is arithmetic.
//
// Run:  node tools/test-crew-zulu.js
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0;
const fails = [];
const check = (what, ok) => { if (ok) pass++; else fails.push(what); };

/* The smallest DOM that lets the file load. Nothing here is exercised — the
   tests call reading(), which touches neither. */
const el = () => ({
    id: '', textContent: '', className: '', innerHTML: '', tagName: 'TIME',
    dataset: {}, isConnected: true,
    setAttribute() {}, getAttribute() { return null; }, querySelector() { return null; },
    appendChild() {},
});
const sandbox = {
    document: {
        getElementById: () => null,
        createElement: el,
        querySelectorAll: () => [],
        addEventListener() {},
        head: el(),
        documentElement: el(),
        visibilityState: 'visible',
    },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
};
sandbox.window = sandbox;

const src = fs.readFileSync(path.join(__dirname, '..', 'crewZulu.js'), 'utf8');
vm.runInNewContext(src, sandbox, { filename: 'crewZulu.js' });
const CrewZulu = sandbox.CrewZulu;

check('the module loads and exposes a reading', !!(CrewZulu && typeof CrewZulu.reading === 'function'));

/* ------------------------------------------------------------------- Zulu
 *
 * The whole point. A machine in Toronto and a machine in Berlin looking at the
 * same instant must read the same thing, because that is what Z means — so the
 * expected values below are UTC and the test does not care where it runs. */
{
    const r = CrewZulu.reading(new Date(Date.UTC(2026, 0, 15, 14, 30, 5)));
    check('the reading is UTC, not the machine’s own zone', r.hhmm === '14:30:05');
    check('…and the sentence behind it names the same instant',
        r.full === 'Thu 15 Jan 2026, 14:30:05Z');
    check('…and the machine-readable form is the ISO instant',
        r.iso === '2026-01-15T14:30:05.000Z');
}

/* ------------------------------------------------------------------ padding
 *
 * "9:5:3" is not a time. Every field is two digits, always. */
{
    const r = CrewZulu.reading(new Date(Date.UTC(2026, 5, 3, 9, 5, 3)));
    check('single digits are padded, all three of them', r.hhmm === '09:05:03');
}

/* ------------------------------------------------------------- the boundaries
 *
 * Midnight is 00:00:00, not 24:00:00 and not 12:00:00. */
{
    check('midnight Zulu reads as 00:00:00',
        CrewZulu.reading(new Date(Date.UTC(2026, 0, 1, 0, 0, 0))).hhmm === '00:00:00');
    check('midday Zulu reads as 12:00:00',
        CrewZulu.reading(new Date(Date.UTC(2026, 0, 1, 12, 0, 0))).hhmm === '12:00:00');
    check('the last second of the day reads as 23:59:59',
        CrewZulu.reading(new Date(Date.UTC(2026, 0, 1, 23, 59, 59))).hhmm === '23:59:59');
}

/* ------------------------------------------------------------ the date rolls
 *
 * The reason the date is in the title at all. A crew centre open at 23:40 in
 * Toronto is already tomorrow in Zulu, and an event card that says "Saturday
 * 0200Z" is the single largest source of confusion in a virtual airline. The
 * date shown must be the ZULU date, whatever the machine's calendar says. */
{
    // 2026-01-15 23:40 in Toronto (UTC-5) is 2026-01-16 04:40Z.
    const r = CrewZulu.reading(new Date(Date.UTC(2026, 0, 16, 4, 40, 0)));
    check('the date in the title is the Zulu date, not the local one',
        r.full === 'Fri 16 Jan 2026, 04:40:00Z');
    // And across a year boundary, which is the same bug one digit bigger.
    const ny = CrewZulu.reading(new Date(Date.UTC(2027, 0, 1, 0, 30, 0)));
    check('…and it rolls the year with it', ny.full === 'Fri 1 Jan 2027, 00:30:00Z');
}

/* ------------------------------------------------------- every month and day
 *
 * The month and weekday names are two hand-written arrays, which is exactly the
 * kind of thing that is wrong by one for eleven months of the year without
 * anybody noticing. Checked against the platform's own UTC formatter. */
{
    // `en-US` rather than `en-GB`, and not arbitrarily: CLDR's British short
    // month for September is "Sept", four letters, where every aviation
    // document ever written says "Sep". The module is right and the British
    // oracle is the odd one out, so the American list — which is the plain
    // three-letter set — is what it is measured against.
    let monthsOk = true, daysOk = true;
    for (let m = 0; m < 12; m++) {
        const d = new Date(Date.UTC(2026, m, 15, 12, 0, 0));
        const want = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
        if (!CrewZulu.reading(d).full.includes(want)) monthsOk = false;
    }
    for (let i = 0; i < 7; i++) {
        const d = new Date(Date.UTC(2026, 0, 4 + i, 12, 0, 0));   // 4 Jan 2026 is a Sunday
        const want = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
        if (!CrewZulu.reading(d).full.startsWith(want)) daysOk = false;
    }
    check('all twelve month names line up with the calendar', monthsOk);
    check('all seven weekday names line up with the calendar', daysOk);
}

/* --------------------------------------------------------------- no argument
 *
 * The live path. It must read now, to the second, rather than throwing or
 * returning a fixed string. */
{
    const now = new Date();
    const r = CrewZulu.reading();
    const want = [now.getUTCHours(), now.getUTCMinutes()]
        .map((n) => String(n).padStart(2, '0')).join(':');
    check('called with nothing, it reads the current minute in Zulu',
        typeof r.hhmm === 'string' && r.hhmm.startsWith(want));
}

console.log('');
if (fails.length) {
    fails.forEach((f) => console.log('  FAIL ', f));
    console.log(`\n${pass} passed, ${fails.length} failed`);
    process.exit(1);
}
console.log(`${pass} passed`);
