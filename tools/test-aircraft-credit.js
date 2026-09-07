/*
 * test-aircraft-credit.js — a photograph we show is a photograph we credit.
 *
 * WHY THIS TEST EXISTS
 *
 * crewAircraftImage.js draws a silhouette for every airframe and quietly
 * upgrades it to a real photograph from Planespotters where one is on file.
 * Those photographs are free to read on one condition: the photographer is
 * credited and the photo page is linked. For a while the upgrade took the
 * picture and dropped the name, which is not a cosmetic bug — it is showing
 * somebody's work on a hundred crew centres without their name on it.
 *
 * So the thing under test is not "does the picture change". It is:
 *
 *   - a real photograph NEVER lands without the photographer's name reaching
 *     the page;
 *   - a silhouette WE drew never grows a credit, because a blank caption under
 *     forty tiles is a visible cost paid for nothing;
 *   - the credit links back where there is a link, and is still words where
 *     there is not — an attribution is not deleted for want of a URL;
 *   - and none of it can throw, because it runs inside somebody else's render.
 *
 * Node builtins only — no browser, no network, no install. The module is run in
 * a vm against a DOM small enough to read.
 *
 * Run:  node tools/test-aircraft-credit.js
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
const tick = () => new Promise((r) => setImmediate(r));

/* ---- A DOM, only as big as this module uses ---------------------------- */
function makeEl(tag, attrs) {
    return {
        tagName: String(tag || 'div').toUpperCase(),
        attrs: Object.assign({}, attrs),
        children: [],
        parentNode: null,
        isConnected: true,
        hidden: true,
        title: '',
        src: '',
        textContent: '',
        get ownerDocument() { return DOC; },
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
        setAttribute(k, v) { this.attrs[k] = String(v); },
        appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
        querySelector(sel) {
            const m = String(sel).match(/^\[data-cai-credit="(.*)"\]$/);
            const all = [];
            (function walk(n) { n.children.forEach((c) => { all.push(c); walk(c); }); })(this);
            if (!m) return null;
            return all.find((e) => e.getAttribute('data-cai-credit') === m[1]) || null;
        },
        querySelectorAll() { return []; },
    };
}
const DOC = { createElement: (t) => makeEl(t) };

/** Load the module against a canned Planespotters reply. */
function load(reply) {
    const calls = [];
    const ctx = {
        console: { warn() {} },
        document: DOC,
        encodeURIComponent, decodeURIComponent, Math, JSON, String, Number, Object, Array,
        Promise, setTimeout, isFinite,
        fetch(url) {
            calls.push(String(url));
            if (reply === null) return Promise.reject(new Error('offline'));
            return Promise.resolve({ ok: reply.ok !== false, json: () => Promise.resolve(reply.body) });
        },
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'crewAircraftImage.js'), 'utf8'), ctx);
    return { cai: ctx.window.CrewAircraftImage, calls };
}

const PHOTO = { body: { photos: [{
    thumbnail_large: { src: 'https://cdn.planespotters.net/big.jpg' },
    photographer: 'Ana Ruiz',
    link: 'https://www.planespotters.net/photo/123',
}] } };

/** A picture and its credit slot, mounted in a holder the way a tile does. */
function mount(cai, aircraft) {
    const holder = makeEl('div');
    const img = makeEl('img', { 'data-cai-reg': aircraft.registration || '' });
    const slot = makeEl('small', { 'data-cai-credit': aircraft.registration || '' });
    holder.appendChild(img);
    holder.appendChild(slot);
    // upgrade() looks for images itself; hand it the pair directly.
    holder.querySelectorAll = (sel) => (/img\[data-cai-reg\]/.test(sel) ? [img] : []);
    return { holder, img, slot };
}

(async function run() {
    section('the floor — a picture that cannot fail');
    {
        const { cai, calls } = load(null);
        const s = cai.src({ registration: 'XA-ABC', type: { name: 'Boeing 737-800' } });
        ok('there is always a src', /^data:image\/svg\+xml/.test(s), s.slice(0, 30));
        ok('…and getting one costs no request', calls.length === 0, calls.join(' '));
        ok('a 747 is not drawn as a 737',
            cai.shapeFor('Boeing 747-8') !== cai.shapeFor('Boeing 737-800'));
        ok('an unknown type still gets an airliner', cai.shapeFor('Something Unheard Of') === 'wide');
    }

    section('a photograph arrives with its photographer, or not at all');
    {
        const { cai } = load(PHOTO);
        const p = await cai.photoFor('XA-ABC');
        ok('the src comes through', p.src === 'https://cdn.planespotters.net/big.jpg');
        ok('the photographer comes through the SAME call', p.by === 'Ana Ruiz');
        ok('…and so does the link back', p.link === 'https://www.planespotters.net/photo/123');
        ok('the credit reads as a sentence', cai.creditLine(p) === 'Photo: Ana Ruiz / Planespotters', cai.creditLine(p));
    }
    {
        // A link is an href. An http: or javascript: one is not usable.
        const { cai } = load({ body: { photos: [{
            thumbnail: { src: 'https://cdn.planespotters.net/small.jpg' },
            photographer: 'Sam', link: 'javascript:alert(1)',
        }] } });
        const p = await cai.photoFor('XA-ABC');
        ok('a link that is not https is dropped', p.link === '', JSON.stringify(p.link));
        ok('…and the name is still credited', cai.creditLine(p) === 'Photo: Sam / Planespotters');
    }
    {
        const { cai } = load({ body: { photos: [] } });
        ok('no photo on file is a miss, not an error', (await cai.photoFor('XA-ABC')) === null);
    }
    {
        const { cai } = load(null);
        ok('an unreachable API is a miss too', (await cai.photoFor('XA-ABC')) === null);
    }
    {
        const { cai, calls } = load(PHOTO);
        await cai.photoFor('N/A');
        ok('a placeholder registration is never asked about', calls.length === 0, calls.join(' '));
    }

    section('the credit reaches the page');
    {
        const { cai } = load(PHOTO);
        const { holder, img, slot } = mount(cai, { registration: 'XA-ABC' });
        cai.upgrade(holder);
        await tick(); await tick();
        ok('the photograph replaces the silhouette', img.src === 'https://cdn.planespotters.net/big.jpg');
        ok('the credit is no longer hidden', slot.hidden === false);
        ok('…and it is a link back to the photo page',
            slot.children.length === 1 && slot.children[0].href === 'https://www.planespotters.net/photo/123',
            JSON.stringify(slot.children.map((c) => c.href)));
        ok('…that opens safely', slot.children[0].rel === 'noopener noreferrer');
        ok('the name is the words of the link', slot.children[0].textContent === 'Photo: Ana Ruiz / Planespotters');
        ok('the picture itself carries the credit too, wherever it ends up',
            img.title === 'Photo: Ana Ruiz / Planespotters' && img.getAttribute('data-cai-by') === 'Ana Ruiz');
    }
    {
        // No link: the attribution is owed anyway and must not vanish with it.
        const { cai } = load({ body: { photos: [{
            thumbnail: { src: 'https://cdn.planespotters.net/s.jpg' }, photographer: 'Lee', link: '',
        }] } });
        const { holder, slot } = mount(cai, { registration: 'XA-ABC' });
        cai.upgrade(holder);
        await tick(); await tick();
        ok('a credit with no link is still shown, as words',
            slot.hidden === false && slot.textContent === 'Photo: Lee / Planespotters', slot.textContent);
        ok('…and no empty link is left behind', slot.children.length === 0);
    }
    {
        // The common case by a mile: an invented registration nobody has
        // photographed. It must cost the row nothing.
        const { cai } = load({ body: { photos: [] } });
        const { holder, img, slot } = mount(cai, { registration: 'XA-ABC' });
        const before = img.src;
        cai.upgrade(holder);
        await tick(); await tick();
        ok('a silhouette is left exactly as it was', img.src === before);
        ok('…and grows no empty caption', slot.hidden === true && slot.textContent === '');
        ok('…and claims no photographer', img.title === '' && img.getAttribute('data-cai-by') === null);
    }
    {
        // The slot is found from the image outwards, so two tiles cannot fill
        // each other's caption.
        const { cai } = load(PHOTO);
        const a = mount(cai, { registration: 'XA-ABC' });
        const b = mount(cai, { registration: 'XA-ZZZ' });
        cai.upgrade(a.holder);
        await tick(); await tick();
        ok('one aircraft’s credit does not land under another', b.slot.hidden === true);
    }
    {
        // This runs inside somebody else's render. It may not throw, ever.
        const { cai } = load(PHOTO);
        let threw = false;
        try { cai.upgrade(null); cai.upgrade({}); } catch (e) { threw = true; }
        ok('upgrade never throws, whatever it is handed', !threw);
    }

    section('the markup a caller gets');
    {
        const { cai } = load(PHOTO);
        const plain = cai.img({ registration: 'XA-ABC', type: { name: 'Airbus A320-200' } });
        ok('a plain picture is one <img> and nothing else',
            plain.indexOf('<img') === 0 && plain.indexOf('<small') === -1);
        const withCredit = cai.img({ registration: 'XA-ABC' }, { credit: true });
        ok('asking for the credit adds the slot', /<small class="cai-credit"[^>]*hidden><\/small>$/.test(withCredit), withCredit.slice(-90));
        ok('the slot is keyed to the registration', withCredit.includes('data-cai-credit="XA-ABC"'));
        ok('the slot can also be placed on its own',
            cai.creditSlot({ registration: 'XA-ABC' }).includes('data-cai-credit="XA-ABC"'));
        ok('a registration cannot write markup into the slot',
            !cai.creditSlot({ registration: '"><script>x</script>' }).includes('<script>'),
            cai.creditSlot({ registration: '"><script>x</script>' }));
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
