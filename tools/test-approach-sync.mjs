/**
 * test-approach-sync.mjs — Approach multiplayer: what a guest sees is what the host has.
 *
 * Run with: node tools/test-approach-sync.mjs
 *
 * The host's aircraft point at shared map objects (a runway end, a fix) and at
 * each other. A guest has its own copy of the map, so a pointer has to arrive
 * pointing at the guest's copy of the same object, an aircraft has to stay the
 * same object from one message to the next (or the selected one would drop),
 * and a missed message has to be noticed rather than drawn wrong.
 */
import assert from 'assert';
import { buildRegistry, encode, decode, Publisher, Subscriber } from '../approachSync.js';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// The same world, built twice: once on the host, once on the guest.
function world() {
    const le = { id: '28L', thr: { x: 0, y: 0 }, course: 280 }, he = { id: '10R', thr: { x: 2, y: 0 }, course: 100 };
    le.opp = he; he.opp = le;
    const star = { id: 'BDEGA4', legs: [{ fix: 'BDEGA', alt: 11000 }, { fix: 'CORKK', alt: 8000 }] };
    const fixes = [{ name: 'BDEGA', stars: [star] }, { name: 'CORKK' }];
    return { ends: [le, he], fixes, xing: new Map([[1, { cached: true }]]) };
}
function ground() { return { gates: [{ ref: 'A1', x: 1, y: 1 }, { ref: 'A2', x: 1.1, y: 1 }] }; }
const registry = (w, g) => buildRegistry({ g }, { base: 1e6, into: buildRegistry({ w }, { skip: ['xing'] }) });

function setup() {
    const hw = world(), hg = ground(), gw = world(), gg = ground();
    gw.xing.set(2, { extra: true });  // a cache filled differently on each side must not matter
    return { hw, hg, gw, gg, hreg: registry(hw, hg), greg: registry(gw, gg) };
}

const SKIP_AC = ['box', 'color'];

// A guest always starts from the full state (here, before anything has been sent).
function joined(pub, opts, greg) { const sub = new Subscriber(opts); sub.apply(pub.full(), {}, greg); return sub; }

test('a pointer to map data arrives pointing at the guest\'s own copy', () => {
    const { hw, hg, gw, gg, hreg, greg } = setup();
    const a = { id: 1, cs: 'UAL1', rwy: hw.ends[0], stand: hg.gates[1], via: { legs: hw.fixes[0].stars[0].legs, i: 0 } };
    const pub = new Publisher({ skipAc: SKIP_AC }), sub = joined(pub, { keepAc: SKIP_AC }, greg);
    const isAc = o => o === a;
    const G = {};
    const r = sub.apply(pub.diff([a], {}, { reg: hreg, isAc }), G, greg);
    const b = r.aircraft[0];
    assert.strictEqual(b.rwy, gw.ends[0]);
    assert.strictEqual(b.rwy.opp, gw.ends[1]);
    assert.strictEqual(b.stand, gg.gates[1]);
    assert.strictEqual(b.via.legs, gw.fixes[0].stars[0].legs);
});

test('aircraft keep their identity, point at each other, and only changes are sent', () => {
    const { hw, hreg, greg } = setup();
    const a = { id: 1, x: 10, y: 5, rwy: hw.ends[0] }, c = { id: 2, x: 3, y: 4 };
    c.follow = a;
    const acs = [a, c], isAc = o => acs.includes(o);
    const pub = new Publisher(), sub = joined(pub, {}, greg), G = {};
    const first = sub.apply(pub.diff(acs, { score: 0 }, { reg: hreg, isAc }), G, greg).aircraft;
    assert.strictEqual(first[1].follow, first[0]);
    a.x = 10.5;
    const m = pub.diff(acs, { score: 0 }, { reg: hreg, isAc });
    assert.deepStrictEqual(m.ac, { 1: { set: { x: 10.5 } } });
    assert.ok(!m.order && !m.g);
    const second = sub.apply(m, G, greg).aircraft;
    assert.strictEqual(second[0], first[0]);
    assert.strictEqual(second[0].x, 10.5);
    assert.strictEqual(pub.diff(acs, { score: 0 }, { reg: hreg, isAc }), null);
});

test('removed keys, gone aircraft and game state follow; local keys stay the guest\'s', () => {
    const { hreg, greg } = setup();
    const a = { id: 1, appr: { along: 5 }, box: { x: 1 } }, c = { id: 2 };
    let acs = [a, c];
    const isAc = o => acs.includes(o);
    const pub = new Publisher({ skipAc: SKIP_AC }), sub = joined(pub, { keepAc: SKIP_AC }, greg);
    const G = { wind: null };
    const g = { wind: { dir: 280, spd: 12 }, nextSpawn: Infinity, conf: new Map([['1-2', { a, t: 3 }]]), positions: new Set(['APP']) };
    sub.apply(pub.diff(acs, g, { reg: hreg, isAc }), G, greg);
    const mine = sub.byId.get(1);
    assert.ok(!('box' in mine));
    mine.color = '#f00';
    assert.strictEqual(G.nextSpawn, Infinity);
    assert.strictEqual(G.conf.get('1-2').a, mine);
    assert.ok(G.positions instanceof Set && G.positions.has('APP'));
    delete a.appr; acs = [a];
    const r = sub.apply(pub.diff(acs, g, { reg: hreg, isAc }), G, greg);
    assert.strictEqual(r.aircraft.length, 1);
    assert.ok(!('appr' in r.aircraft[0]));
    assert.strictEqual(r.aircraft[0].color, '#f00');
});

test('a missed message is noticed, and the full state puts it right', () => {
    const { hreg, greg } = setup();
    const a = { id: 1, x: 0 }, isAc = o => o === a;
    const pub = new Publisher(), sub = joined(pub, {}, greg), G = {};
    sub.apply(pub.diff([a], {}, { reg: hreg, isAc }), G, greg);
    a.x = 1; pub.diff([a], {}, { reg: hreg, isAc });          // lost on the way
    a.x = 2;
    assert.ok(sub.apply(pub.diff([a], {}, { reg: hreg, isAc }), G, greg).missed);
    a.x = 3;
    assert.ok(sub.apply(pub.diff([a], {}, { reg: hreg, isAc }), G, greg).stale);   // ignored until the full state
    const full = pub.full();
    const r = sub.apply(full, G, greg);
    assert.strictEqual(r.aircraft[0].x, 3);
    a.x = 4;
    assert.strictEqual(sub.apply(pub.diff([a], {}, { reg: hreg, isAc }), G, greg).aircraft[0].x, 4);
});

test('a late joiner starts from the full state and follows on', () => {
    const { hreg, greg } = setup();
    const a = { id: 7, x: 0 }, isAc = o => o === a;
    const pub = new Publisher();
    for (let i = 1; i <= 5; i++) { a.x = i; pub.diff([a], { t: i }, { reg: hreg, isAc }); }
    const sub = new Subscriber(), G = {};
    assert.ok(sub.apply({ seq: 5, ac: {} }, G, greg).stale);
    sub.apply(pub.full(), G, greg);
    assert.strictEqual(G.t, 5);
    a.x = 6;
    assert.strictEqual(sub.apply(pub.diff([a], { t: 6 }, { reg: hreg, isAc }), G, greg).aircraft[0].x, 6);
});

test('a clearance from a guest decodes to the host\'s objects', () => {
    const { hw, gw, hreg, greg } = setup();
    const hostAc = { id: 4 }, guestAc = { id: 4 };
    const c = { ils: gw.ends[1], direct: gw.fixes[1], giveWay: guestAc, alt: 5000 };
    const wire = JSON.parse(JSON.stringify(encode(c, { reg: greg, isAc: o => o === guestAc })));
    const back = decode(wire, { reg: hreg, ac: id => (id === 4 ? hostAc : null) });
    assert.strictEqual(back.ils, hw.ends[1]);
    assert.strictEqual(back.direct, hw.fixes[1]);
    assert.strictEqual(back.giveWay, hostAc);
    assert.strictEqual(back.alt, 5000);
});

test('cycles that are not map data or aircraft end, functions are dropped', () => {
    const o = { a: 1, f: () => 1 };
    o.self = o;
    assert.deepStrictEqual(encode(o, {}), { a: 1, self: null });
});

let failed = 0;
for (const [name, fn] of tests) {
    try { fn(); console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
console.log(`\n${tests.length - failed} passing${failed ? `, ${failed} failing` : ''}`);
process.exit(failed ? 1 : 0);
