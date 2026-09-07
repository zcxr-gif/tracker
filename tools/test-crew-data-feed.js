// test-crew-data-feed.js — the crew center's data, on somebody else's website.
//
// Two things ship that data out, and both have the same one job: never state
// something about an airline that the airline did not say.
//
//   * embed-crew.html's `routes` and `stats` views — our markup in an iframe.
//   * crew-feed.js — the same data as plain JSON, for a site that renders it
//     itself.
//
// What is actually worth testing here is the refusals, because they are what a
// careless rewrite would quietly drop and nobody would notice until a VA's
// homepage was carrying a number nobody could account for:
//
//   - a figure the backend did not send must be LEFT OUT, never printed as 0;
//   - a route staff switched off must not reach the public;
//   - a codeshare must be labelled as the partner's, not printed as ours;
//   - a backend that is down must leave the host page exactly as it was;
//   - and a notes field from a VA's database must never be able to write HTML
//     into the site that embedded it.
//
// Node builtins only — no browser, no network, no install. The widget's script
// is pulled out of the HTML and run in a vm with a DOM small enough to read;
// crew-feed.js is loaded the same way with a stubbed <script> tag.
//
// Run:  node tools/test-crew-data-feed.js
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

/* =========================================================================
 * A DOM, only as big as these two files actually use.
 * ===================================================================== */
/* WHY innerHTML IS PARSED HERE AND NOT JUST STORED
 *
 * crew-feed.js does two pieces of DOM surgery AFTER it writes a list's markup:
 * it removes an <img> whose src never arrived, and it unwraps an <a> whose
 * href never arrived. Both exist because the alternative a visitor sees is a
 * broken-image glyph or a dead link — and neither was reachable by this harness
 * while innerHTML was an inert string, so neither was ever really tested.
 *
 * So the setter parses. Deliberately minimally: tags, attributes, void
 * elements, and text taken VERBATIM — no entity decoding, which is what lets
 * the round trip be exact and keeps the escaping tests honest (a stored
 * "&lt;b&gt;" has to come back out as "&lt;b&gt;", not as "<b>").
 *
 * The getter still returns the string that was set, so every assertion written
 * against the old harness reads the same value. It is only re-serialised when
 * something actually mutated the parsed children — which is exactly the case
 * these two rules are about.
 */
const VOID_TAGS = { IMG: 1, BR: 1, HR: 1, INPUT: 1, META: 1, LINK: 1, SOURCE: 1 };

function parseHtml(html, parent) {
    const out = [];
    const stack = [{ el: null, kids: out }];
    // Flat, not nested. "(?:\s+attr(?:="v")?)*" is a quantifier inside a
    // quantifier and backtracks catastrophically on real markup; [^>]* cannot.
    const re = /<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)([^>]*)>/g;
    let last = 0, m;
    const pushText = (t) => { if (t) stack[stack.length - 1].kids.push({ text: t }); };
    while ((m = re.exec(html))) {
        pushText(html.slice(last, m.index));
        last = re.lastIndex;
        if (m[1]) {                                   // closing tag
            if (stack.length > 1) stack.pop();
            continue;
        }
        const tag = m[2];
        const attrs = {};
        const ar = /([\w:-]+)(?:="([^"]*)")?/g;
        let a;
        while ((a = ar.exec(m[3] || ''))) attrs[a[1]] = a[2] === undefined ? '' : a[2];
        const el = makeEl(tag, attrs);
        stack[stack.length - 1].kids.push(el);
        if (!VOID_TAGS[el.tagName] && !/\/\s*$/.test(m[3] || '')) stack.push({ el, kids: el.children });
    }
    pushText(html.slice(last));

    // Link the tree up now that it is built.
    (function link(kids, p) {
        kids.forEach((k) => { if (k.tagName) { k.parentNode = p; link(k.children, k); } else { k.parentNode = p; } });
    })(out, parent);
    return out;
}

function serialize(nodes) {
    return nodes.map((n) => {
        if (!n.tagName) return n.text;
        const tag = n.tagName.toLowerCase();
        const attrs = Object.keys(n.attrs).map((k) => ` ${k}="${n.attrs[k]}"`).join('');
        if (VOID_TAGS[n.tagName]) return `<${tag}${attrs}>`;
        return `<${tag}${attrs}>${serialize(n.children)}</${tag}>`;
    }).join('');
}

function makeEl(tag, attrs) {
    const el = {
        tagName: (tag || 'div').toUpperCase(),
        attrs: Object.assign({}, attrs),
        _html: '',
        _text: null,
        _fromHtml: false,
        _on: Object.create(null),
        children: [],
        parentNode: null,
        style: { setProperty() {} },
        get innerHTML() { return this._html; },
        set innerHTML(v) {
            this._html = String(v);
            this._text = null;
            this.children = parseHtml(this._html, this);
            this._fromHtml = true;
        },
        get textContent() { return this._text != null ? this._text : this._html; },
        set textContent(v) {
            // A real DOM keeps these two in step: setting textContent replaces
            // the children AND the markup, with the text escaped. Holding the
            // raw text alongside is what lets a reader get back what was set
            // without this harness having to decode entities.
            this._text = String(v);
            this._html = this._text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
            this.children = [];
            this._fromHtml = false;
        },
        // The parsed children and the string have to stay in step, or a removal
        // is invisible to the very assertion that is checking for it.
        /* The string and the parsed children have to stay in step, or a
         * removal is invisible to the very assertion checking for it. The
         * mutations happen deep in the tree and the string lives on whichever
         * ancestor innerHTML was set on, so this walks up to find it. */
        _resync() {
            let n = this;
            while (n && !n._fromHtml) n = n.parentNode;
            if (n) n._html = serialize(n.children);
        },
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
        setAttribute(k, v) { this.attrs[k] = String(v); },
        removeAttribute(k) { delete this.attrs[k]; },
        hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); },
        appendChild(c) { c.parentNode = this; this.children.push(c); this._resync(); return c; },
        insertBefore(c, ref) {
            // A real insertBefore MOVES the node — it is detached from whatever
            // parent it had first. Without that, unwrapping an element by
            // walking its firstChild out never terminates, because the child is
            // still the child.
            if (c.parentNode) {
                const j = c.parentNode.children.indexOf(c);
                if (j > -1) c.parentNode.children.splice(j, 1);
            }
            const i = this.children.indexOf(ref);
            c.parentNode = this;
            this.children.splice(i < 0 ? this.children.length : i, 0, c);
            this._resync();
            return c;
        },
        removeChild(c) {
            const i = this.children.indexOf(c);
            if (i > -1) this.children.splice(i, 1);
            c.parentNode = null;
            this._resync();
            return c;
        },
        get firstChild() { return this.children[0] || null; },
        // Only as much of the event API as crew-feed.js uses. The handler is
        // parked on _on so a test can fire it without a real browser.
        addEventListener(type, fn) { this._on[type] = fn; },
        removeEventListener(type) { delete this._on[type]; },
        // Only the selectors these files use: [data-x], a tag name, and lists.
        querySelectorAll(sel) { return descendants(this).filter((e) => e.tagName && matches(e, sel)); },
        querySelector(sel) { return descendants(this).find((e) => e.tagName && matches(e, sel)) || null; },
        closest(sel) { let n = this; while (n) { if (n.tagName && matches(n, sel)) return n; n = n.parentNode; } return null; },
    };
    return el;
}
function descendants(root) {
    const out = [];
    (function walk(n) {
        (n.children || []).forEach((c) => { out.push(c); if (c.children) walk(c); });
    })(root);
    return out;
}
function matches(el, sel) {
    return String(sel).split(',').map((s) => s.trim()).some((s) => {
        const attr = s.match(/^\[([\w-]+)\]$/);
        if (attr) return el.hasAttribute(attr[1]);
        return el.tagName === s.toUpperCase();
    });
}

/* =========================================================================
 * embed-crew.html
 * ===================================================================== */
const HTML = fs.readFileSync(path.join(ROOT, 'embed-crew.html'), 'utf8');
const WIDGET_JS = (HTML.match(/<script>([\s\S]*?)<\/script>/) || [])[1];

/** Render one view of the widget against a canned backend reply. */
async function renderWidget(query, reply) {
    const wrap = makeEl('div');
    const calls = [];
    const ctx = {
        console,
        URL, URLSearchParams, Date, Math, Number, String, Array, Object, JSON, isFinite, parseInt,
        setTimeout, clearTimeout,
        location: { search: '?' + query, href: 'https://inflight.info/embed-crew.html?' + query },
        document: {
            getElementById: (id) => (id === 'wrap' ? wrap : null),
            body: makeEl('body'),
            documentElement: makeEl('html'),
        },
        fetch(url) {
            calls.push(String(url));
            if (reply === null) return Promise.reject(new Error('offline'));
            return Promise.resolve({ ok: reply.ok !== false, status: reply.status || 200, json: () => Promise.resolve(reply.body) });
        },
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(WIDGET_JS, ctx);
    await tick(); await tick(); await tick();
    return { html: wrap.innerHTML, calls };
}

const ROUTES = [
    { id: '1', flightNumber: 'AM404', origin: 'MMMX', destination: 'KJFK', aircraft: 'B789', distanceNm: 2085, active: true, kind: 'own' },
    { id: '2', flightNumber: 'AM11', origin: 'MMMX', destination: 'EGLL', aircraft: 'B789', distanceNm: 4770, active: true, kind: 'own', minRank: 'Captain' },
    { id: '3', flightNumber: 'AM7002', origin: 'MMMX', destination: 'KATL', aircraft: 'B739', distanceNm: 1180, active: true, kind: 'codeshare', partnerName: 'Delta Virtual' },
    { id: '4', flightNumber: 'AM999', origin: 'MMMX', destination: 'MMTJ', aircraft: 'B738', distanceNm: 1290, active: false, kind: 'own' },
    { id: '5', flightNumber: 'AM000', origin: '', destination: 'MMUN', aircraft: '', distanceNm: 0, active: true, kind: 'own' },
];

(async function run() {
    section('embed-crew.html — the route network');
    {
        const { html, calls } = await renderWidget('va=amv&view=routes', { body: { routes: ROUTES } });
        ok('it asks the routes endpoint', /\/api\/crew\/amv\/routes$/.test(calls[0]), calls[0]);
        ok('a published sector is shown', html.includes('AM404') && html.includes('KJFK'));
        ok('a sector staff switched off is NOT', !html.includes('AM999'), 'inactive route reached the public');
        ok('a sector missing an end is dropped', !html.includes('AM000'));
        ok('a codeshare carries the partner’s name', html.includes('Delta Virtual'));
        ok('a rank gate is shown', html.includes('Captain'));
        ok('the distance is formatted, not raw', html.includes('4,770 nm'), html.slice(0, 200));
        ok('the header counts what is shown', /class="count">3</.test(html), html.slice(0, 300));
    }
    {
        const { html } = await renderWidget('va=amv&view=routes&kind=own', { body: { routes: ROUTES } });
        ok('kind=own drops the codeshares', !html.includes('Delta Virtual') && html.includes('AM404'));
    }
    {
        const { html } = await renderWidget('va=amv&view=routes&kind=codeshare', { body: { routes: ROUTES } });
        ok('kind=codeshare keeps only them', html.includes('AM7002') && !html.includes('AM404'));
    }
    {
        const { html } = await renderWidget('va=amv&view=routes&sort=distance&limit=1', { body: { routes: ROUTES } });
        ok('sort=distance puts the longest first', html.includes('EGLL') && !html.includes('KJFK'));
    }
    {
        const { html } = await renderWidget('va=amv&view=routes&aircraft=739', { body: { routes: ROUTES } });
        ok('an aircraft filter narrows the list', html.includes('AM7002') && !html.includes('AM404'));
    }
    {
        const { html } = await renderWidget('va=amv&view=routes', { body: { routes: [] } });
        ok('an empty network says so', html.includes('No routes published yet'));
    }
    {
        const { html } = await renderWidget('va=amv&view=routes', { ok: false, status: 404 });
        ok('a missing crew center says so', html.includes('could not be found'));
    }
    {
        const evil = [{ id: '9', origin: 'MMMX', destination: 'KJFK', active: true, notes: '<img src=x onerror=alert(1)>' }];
        const { html } = await renderWidget('va=amv&view=routes', { body: { routes: evil } });
        ok('a notes field cannot write HTML into the host page',
            !html.includes('<img src=x') && html.includes('&lt;img'), html.slice(-260));
    }

    section('embed-crew.html — the figures');
    {
        const { html, calls } = await renderWidget('va=amv&view=stats', {
            body: { connected: true, stats: { pilots: 412, pilotsActive: 180, hours: 3984.4, pirepsApproved: 2104, routesActive: 23 } },
        });
        ok('it asks the stats endpoint', /\/api\/crew\/amv\/stats$/.test(calls[0]), calls[0]);
        ok('the pilot count is shown', html.includes('412'));
        ok('a sub-figure rides along', html.includes('180 active'));
        ok('hours are rounded to a figure, not a measurement', html.includes('3,984') && !html.includes('3,984.4'));
        ok('a figure the backend did not send is left out, not printed as 0',
            !html.includes('Landings') && !html.includes('Destinations'), html);
        ok('the header carries no count for the figures view', !html.includes('class="count"'));
    }
    {
        const { html } = await renderWidget('va=amv&view=stats&fields=routesActive,pilots', {
            body: { connected: true, stats: { pilots: 412, hours: 3984, routesActive: 23 } },
        });
        const iRoutes = html.indexOf('Routes'), iPilots = html.indexOf('Pilots');
        ok('fields= chooses and orders the tiles', iRoutes > -1 && iPilots > iRoutes && !html.includes('Hours'), html);
    }
    {
        const { html } = await renderWidget('va=amv&view=stats', { body: { connected: false } });
        ok('a VA with no data store gets the empty state, not zeroes',
            html.includes('no figures to show') && !html.includes('>0<'), html);
    }
    {
        const { html } = await renderWidget('va=amv&view=stats', { body: { connected: true, stats: { pilots: 0 } } });
        ok('a real zero the backend DID send is shown', html.includes('>0</b>'), html);
    }

    section('crew-feed.js — the readers');
    const FEED_JS = fs.readFileSync(path.join(ROOT, 'crew-feed.js'), 'utf8');

    function loadFeed(replies) {
        const tag = makeEl('script', { 'data-va': 'amv', src: 'https://inflight.info/crew-feed.js' });
        const doc = makeEl('document');
        doc.currentScript = tag;
        doc.readyState = 'complete';
        doc.getElementsByTagName = () => [tag];
        const calls = [];
        const ctx = {
            console, URL, URLSearchParams, Date, Math, Number, String, Array, Object, JSON, isFinite,
            parseInt, parseFloat, Promise, setTimeout, clearTimeout, AbortController,
            document: doc,
            fetch(url) {
                calls.push(String(url));
                const key = Object.keys(replies).find((k) => String(url).endsWith(k));
                const r = key ? replies[key] : null;
                if (!r) return Promise.reject(new Error('offline'));
                return Promise.resolve({ ok: r.ok !== false, status: r.status || 200, json: () => Promise.resolve(r.body) });
            },
        };
        ctx.window = ctx;
        vm.createContext(ctx);
        vm.runInContext(FEED_JS, ctx);
        return { feed: ctx.window.CrewFeed, calls, doc, makeEl };
    }

    {
        const { feed, calls } = loadFeed({ '/routes': { body: { routes: ROUTES } } });
        const rows = await feed.routes();
        ok('it reads the slug off its own script tag', /\/api\/crew\/amv\/routes$/.test(calls[0]), calls[0]);
        ok('inactive and half-typed sectors are dropped', rows.length === 3, JSON.stringify(rows.map(r => r.flight)));
        ok('a codeshare is flagged as one', rows.find((r) => r.flight === 'AM7002').codeshare === true);
        ok('our own metal is not', rows.find((r) => r.flight === 'AM404').codeshare === false);
        ok('kind=own filters', (await feed.routes({ kind: 'own' })).length === 2);
        ok('one request serves repeat readers', calls.length === 1, calls.join(' '));
    }
    {
        const { feed } = loadFeed({ '/routes': { body: { routes: [] } } });
        ok('an empty network resolves null, so the host page keeps its own', (await feed.routes()) === null);
    }
    {
        const { feed } = loadFeed({});
        ok('a backend that is down resolves null rather than throwing', (await feed.routes()) === null);
        ok('…and so do the figures', (await feed.stats()) === null);
    }
    {
        const { feed } = loadFeed({ '/stats': { body: { connected: true, stats: { pilots: 412, hours: 3984.4, landings: null } } } });
        const s = await feed.stats();
        ok('hours are rounded', s.hours === 3984);
        ok('a field the backend did not send stays undefined', s.landings === undefined && s.destinations === undefined);
    }
    {
        const { feed } = loadFeed({ '/stats': { body: { connected: false } } });
        ok('no data store resolves null', (await feed.stats()) === null);
    }
    {
        const { feed } = loadFeed({ '/stats': { body: { connected: true, stats: { pilots: 0, hours: 0, routesActive: 0 } } } });
        ok('an airline nobody has flown in yet resolves null, not a wall of zeroes',
            (await feed.stats()) === null);
    }
    {
        const { feed } = loadFeed({ '/stats': { body: { connected: true, stats: { pilots: 0, routesActive: 23 } } } });
        const s = await feed.stats();
        ok('a zero among real figures is kept', s !== null && s.pilots === 0 && s.routesActive === 23);
    }
    {
        const { feed } = loadFeed({ '/route-map': { body: {
            routes: [{ origin: 'MMMX', destination: 'KJFK', o: [19.4, -99.0], d: [40.6, -73.7], mapped: true, active: true, distanceNm: 2085 },
                     { origin: 'MMMX', destination: 'XXXX', mapped: false, active: true }],
            airports: [{ icao: 'MMMX', lat: 19.4, lon: -99.0, dep: 2, arr: 0, routes: 2 }],
            stats: { unmapped: 1 },
        } } });
        const net = await feed.network();
        ok('the map feed keeps only what it can place', net.routes.length === 1);
        ok('…and says how many it could not', net.unmapped === 1);
        ok('airports come back keyed by ICAO with coordinates', net.airports.MMMX.lat === 19.4);
    }

    section('crew-feed.js — the wall and the pulse');
    {
        // One board, two kinds of row: what a person typed, and what the crew
        // center recorded happening. A public page wants them apart.
        const BOARD = { announcements: [
            { title: 'Winter schedule is up', body: 'Bids close Friday.', auto: false, kind: 'notice', createdAt: '2026-01-02' },
            { title: 'Ana joined as First Officer', auto: true, kind: 'joined', createdAt: '2026-01-03' },
            { title: 'Luis made Captain', auto: true, kind: 'promotion', createdAt: '2026-01-04' },
            { title: 'A draft nobody published', auto: false, status: 'draft' },
            { title: '', auto: true, kind: 'joined' },
        ] };
        const { feed, calls } = loadFeed({ '/announcements': { body: BOARD } });
        const pulse = await feed.activity();
        ok('activity keeps only what the crew center wrote', pulse.length === 2, JSON.stringify(pulse.map(r => r.title)));
        ok('…and carries the kind, so a page can pick an icon', pulse[0].kind === 'joined', pulse[0].kind);
        ok('activity can be narrowed to one kind', (await feed.activity({ kind: 'promotion' })).length === 1);
        const written = await feed.notices({ written: true });
        ok('notices({written}) keeps only what a person typed', written.length === 1 && written[0].title === 'Winter schedule is up');
        const both = await feed.notices();
        ok('a bare notices() is unchanged — the board as the crew center reads it', both.length === 3);
        ok('a draft never reaches either', both.every((n) => n.title !== 'A draft nobody published'));
        ok('one fetch feeds the wall, the pulse and the board', calls.length === 1, calls.join(' '));
    }
    {
        // The refusal that matters. `posts` ends up in an iframe src, so a code
        // the backend sent that is not a shortcode must not survive the reader —
        // even though the backend is supposed to have refused it first.
        const { feed } = loadFeed({ '/social': { body: { handle: 'aeromexicovirtual', posts: [
            { kind: 'p', code: 'ABC123_-x' },
            { kind: 'reel', code: 'XY9' },
            { kind: 'p', code: '../../evil' },
            { kind: 'javascript', code: 'alert' },
            { kind: 'p', code: 'a b' },
        ] } } });
        const wall = await feed.posts();
        ok('the wall keeps the posts that are posts', wall.length === 2, JSON.stringify(wall.map(p => p.code)));
        ok('a code that is not a shortcode is dropped', !wall.some((p) => /evil|alert| /.test(p.code)));
        ok('the embed address is rebuilt here, not echoed',
            wall[0].embedUrl === 'https://www.instagram.com/p/ABC123_-x/embed/', wall[0].embedUrl);
        ok('…and the canonical link too', wall[0].url === 'https://www.instagram.com/p/ABC123_-x/');
        ok('the handle rides along for a follow line', wall[0].handle === 'aeromexicovirtual');
        ok('handle() answers on its own', (await feed.handle()) === 'aeromexicovirtual');
    }
    {
        const { feed } = loadFeed({ '/social': { body: { handle: '', posts: [] } } });
        ok('a VA with no wall resolves null, so the site keeps its own markup', (await feed.posts()) === null);
        ok('…and no handle resolves null too', (await feed.handle()) === null);
    }
    {
        const { feed } = loadFeed({});   // every fetch rejects
        ok('a quiet backend leaves the wall null', (await feed.posts()) === null);
        ok('…and the pulse null', (await feed.activity()) === null);
    }

    section('crew-feed.js — the airline’s identity');
    {
        // The directory record, as /api/va-ads/by-slug returns it — including
        // the two things that must NOT come out the other side.
        const BRAND = {
            name: 'Ocean Virtual', code: 'OCN', tagline: 'The long way round.',
            logo: 'https://cdn.test/logo.png',
            banner: 'http://cdn.test/banner.jpg',          // not https
            accent: '#14375e',
            ranks: [
                { name: 'Captain', minHours: 120, color: '#c00', icon: 'star', image: 'https://cdn.test/cap.png' },
                { name: 'Cadet', minHours: 0, color: 'not-a-colour' },
                { name: 'First Officer', minHours: 40, image: 'javascript:alert(1)' },
                { name: '' },
            ],
            fleet: [
                { type: 'Boeing 787-10 Dreamliner', name: 'Ocean', image: 'https://cdn.test/789.jpg' },
                { type: '', name: '' },
            ],
            roles: [{ name: 'Events', color: '#0a0' }],
            join: { minGrade: 3, callsignPrefix: 'OCN', discordInvite: 'https://discord.gg/abc' },
            supabase: { url: 'https://x.supabase.co', anonKey: 'ey.SECRETISH' },
        };
        const { feed, calls } = loadFeed({ '/api/va-ads/by-slug/amv': { body: BRAND } });

        const b = await feed.brand();
        ok('the airline names itself', b.name === 'Ocean Virtual' && b.code === 'OCN');
        ok('an https logo comes through', b.logo === 'https://cdn.test/logo.png', b.logo);
        ok('a plain-http banner does not', b.banner === '', JSON.stringify(b.banner));
        ok('the join details a public page can use are there',
            b.callsignPrefix === 'OCN' && b.minGrade === 3 && /discord\.gg/.test(b.discord));
        // The anon key is not a secret and it is still not a website's business.
        ok('the Supabase block never leaves', b.supabase === undefined && !JSON.stringify(b).includes('SECRETISH'));

        const ladder = await feed.ranks();
        ok('the ladder reads upward whatever order it was stored in',
            ladder.map(r => r.name).join(' < ') === 'Cadet < First Officer < Captain',
            ladder.map(r => r.name).join(','));
        ok('a rank with no name is dropped', ladder.length === 3, String(ladder.length));
        ok('hours become a phrase a page can print', ladder[2].from === '120 hours', ladder[2].from);
        ok('the first rung says nothing rather than “0 hours”', ladder[0].from === '', JSON.stringify(ladder[0].from));
        ok('a colour that is not one is dropped', ladder[0].color === '', JSON.stringify(ladder[0].color));
        // A badge goes in an <img src>. This is the one that matters.
        ok('a javascript: badge never survives', ladder[1].image === '', JSON.stringify(ladder[1].image));
        ok('a real badge does', ladder[2].image === 'https://cdn.test/cap.png');

        const air = await feed.fleet();
        ok('the fleet reads as aircraft and livery, not type and name',
            air[0].aircraft === 'Boeing 787-10 Dreamliner' && air[0].livery === 'Ocean');
        ok('a half-typed fleet row is dropped', air.length === 1, String(air.length));
        ok('roles come through as definitions', (await feed.roles())[0].name === 'Events');

        ok('one request serves brand, ranks, fleet and roles', calls.length === 1, calls.join(' '));
        ok('…and it is the directory record, not a crew endpoint',
            /\/api\/va-ads\/by-slug\/amv$/.test(calls[0]), calls[0]);
    }
    {
        const { feed } = loadFeed({});   // every fetch rejects
        ok('a quiet backend leaves the brand null', (await feed.brand()) === null);
        ok('…and the ladder null', (await feed.ranks()) === null);
    }

    section('crew-feed.js — an image field most rows will not have');
    {
        const { feed } = loadFeed({ '/api/va-ads/by-slug/amv': { body: { name: 'X', ranks: [
            { name: 'Cadet', minHours: 0 },
            { name: 'Captain', minHours: 120, image: 'https://cdn.test/cap.png' },
        ] } } });
        const ladder = await feed.ranks();
        ok('a rank with a badge carries it', ladder[1].image === 'https://cdn.test/cap.png');
        // fill() leaves an absent field empty, and <img src=""> is a broken
        // image icon in every browser. paintList strips those; keeping the rows
        // in one column afterwards is the template's job, with :has(img).
        ok('a rank without one carries an empty string, never undefined',
            ladder[0].image === '', JSON.stringify(ladder[0].image));
    }

    section('crew-feed.js — painting somebody else’s page');
    {
        const { feed } = loadFeed({});
        const root = makeEl('div');
        const keep = root.appendChild(makeEl('b', { 'data-crew-stat': 'pilots' }));
        const figure = root.appendChild(makeEl('div', { 'data-crew-figure': '' }));
        const inside = figure.appendChild(makeEl('b', { 'data-crew-stat': 'landings' }));
        const when = root.appendChild(makeEl('section', { 'data-crew-when': 'flights30d' }));

        feed.paintStats({ pilots: 412 }, root);
        // Written in as TEXT, not as markup — which is the property that
        // matters, and the one a real browser also reports: setting
        // textContent leaves no child elements behind.
        ok('a figure we have is written in',
            keep.textContent === '412' && keep.children.length === 0, keep.textContent);
        ok('a figure we do not have takes its whole block with it', root.children.indexOf(figure) === -1);
        ok('…and the element inside it goes too', inside.parentNode === figure && figure.parentNode === null);
        ok('a section that needs a figure is removed when there is none', root.children.indexOf(when) === -1);
    }
    {
        const { feed } = loadFeed({ '/routes': { body: { routes: [
            { origin: 'MMMX', destination: 'KJFK', aircraft: 'B789', active: true, notes: '<b>hi</b>' },
        ] } } });
        const host = makeEl('ul', { 'data-crew-list': 'routes', 'data-crew-limit': '5' });
        const tpl = host.appendChild(makeEl('template'));
        tpl.innerHTML = '<li>{{from}} → {{to}} {{aircraft}} {{notes}}</li>';
        await feed.mount(host.parentNode || { querySelector: () => null, querySelectorAll: (s) => (s === '[data-crew-list]' ? [host] : []) });
        ok('a list template is filled from the feed', host.innerHTML.includes('MMMX → KJFK') && host.innerHTML.includes('B789'), host.innerHTML);
        ok('a value out of the VA’s database cannot write HTML',
            host.innerHTML.includes('&lt;b&gt;hi') && !host.innerHTML.includes('<b>hi</b>'), host.innerHTML);
    }
    {
        const { feed } = loadFeed({});
        const host = makeEl('ul', { 'data-crew-list': 'routes' });
        const tpl = host.appendChild(makeEl('template'));
        tpl.innerHTML = '<li>{{from}}</li>';
        const before = host.innerHTML;
        await feed.mount({ querySelector: () => null, querySelectorAll: (s) => (s === '[data-crew-list]' ? [host] : []) });
        ok('a quiet backend leaves the host page exactly as it was', host.innerHTML === before);
    }

    /* =====================================================================
     * THE FLEET PICTURE, AND WHOSE IT IS
     *
     * The guarantee under test: every aircraft has a picture, it needs no
     * network, and whatever is not the airline's own work says whose it is.
     * =================================================================== */
    section('crew-feed.js — every aircraft gets a picture');
    {
        const { feed } = loadFeed({ '/api/va-ads/by-slug/amv': { body: { name: 'X', fleet: [
            { type: 'Boeing 787-10 Dreamliner', name: 'Ocean', image: 'https://cdn.test/789.jpg' },
            { type: 'Airbus A320-200', name: 'Standard' },
            { type: 'Boeing 747-8', name: 'Freighter' },
            { type: 'Cessna 172 Skyhawk', name: 'Trainer' },
            { type: 'Boeing 777-300ER', name: 'Retro', image: 'http://cdn.test/insecure.jpg' },
        ] } } });
        const air = await feed.fleet();

        ok('the VA’s own upload wins', air[0].image === 'https://cdn.test/789.jpg' && air[0].fit === 'cover');
        // A URL that worked when it was typed and 404s two years later is how a
        // fleet page quietly grows holes. Every row carries the standby.
        ok('…and still carries a standby for the day it 404s',
            /^data:image\/svg\+xml/.test(air[0].fallback), String(air[0].fallback).slice(0, 30));
        ok('…and is credited to nobody, because it is theirs', air[0].credit === '', JSON.stringify(air[0].credit));

        // The floor. No fetch, no host, nothing that can 404.
        ok('an aircraft with no picture still has one',
            /^data:image\/svg\+xml/.test(air[1].image), air[1].image.slice(0, 40));
        // The XML namespace is a URI and is not fetched. What matters is that
        // there is nothing in here the browser will go and ASK for.
        ok('…drawn here, so it cannot fail to load',
            !/(src|xlink:href|url\()/i.test(decodeURIComponent(air[1].image)),
            air[1].image.slice(0, 60));
        ok('…contained rather than cropped, so the wingtips survive', air[1].fit === 'contain');
        ok('…and it says whose outline it is', air[2].credit === 'Outline by Inflight');
        ok('a credit we cannot link is words, not a dead link', air[2].creditHref === '');

        // A 747 must not come out looking like an A320: the planform is the
        // whole reason for drawing these rather than shipping one grey plane.
        const four = decodeURIComponent(air[2].image);
        const two = decodeURIComponent(air[1].image);
        const light = decodeURIComponent(air[3].image);
        ok('a quad is not drawn as a narrowbody', four !== two);
        ok('…nor a light aircraft as either', light !== two && light !== four);
        ok('the same type always gets the same tile',
            feed.silhouette('Airbus A320-200') === air[1].image);

        // A plain-http upload is not usable in an https page, and falling back
        // to the drawn outline is better than a blocked image.
        ok('an insecure upload falls through to the outline',
            /^data:image/.test(air[4].image), air[4].image.slice(0, 24));
    }

    {
        /* THE OUTLINE IS DRAWN IN THE AIRLINE'S OWN COLOUR.
         *
         * The crew centre tints these per registration so an airframe is
         * recognisable in a list of forty. On the airline's own website that is
         * wrong: twelve randomly hued tiles next to their wordmark is a paint
         * chart sitting where a livery should be. */
        const withAccent = loadFeed({ '/api/va-ads/by-slug/amv': { body: { name: 'X', accent: '#d8102f', fleet: [
            { type: 'Airbus A320-200', name: 'Standard' },
        ] } } });
        const a = await withAccent.feed.fleet();
        const svg = decodeURIComponent(a[0].image);
        ok('the outline is drawn in the airline’s accent', svg.includes('fill="#d8102f"'), svg.slice(0, 200));
        // No field of its own: the card well is the ground. A second rectangle
        // inside the first is a picture inside a picture.
        ok('…as a mark, with no rectangle of its own', !svg.includes('<rect'), svg.slice(0, 200));

        const none = loadFeed({ '/api/va-ads/by-slug/amv': { body: { name: 'X', fleet: [
            { type: 'Airbus A320-200', name: 'Standard' },
        ] } } });
        const n2 = decodeURIComponent((await none.feed.fleet())[0].image);
        ok('an airline with no accent gets a neutral mark, not one we invented',
            n2.includes('fill="#8b94a3"'), n2.slice(0, 200));

        const junk = loadFeed({ '/api/va-ads/by-slug/amv': { body: { name: 'X', accent: 'red; }', fleet: [
            { type: 'Airbus A320-200', name: 'Standard' },
        ] } } });
        const j2 = decodeURIComponent((await junk.feed.fleet())[0].image);
        ok('an accent that is not a colour never reaches the SVG',
            !j2.includes('red') && j2.includes('#8b94a3'), j2.slice(0, 200));
    }
    {
        // The swap itself. An <img> whose src 404s is the same broken glyph as
        // one with no src at all, and it is the one that arrives LATER.
        const { feed } = loadFeed({ '/api/va-ads/by-slug/amv': { body: { name: 'X', fleet: [
            { type: 'Boeing 737-800', name: 'Standard', image: 'https://cdn.test/gone.jpg' },
        ] } } });
        const host = makeEl('ul', { 'data-crew-list': 'fleet' });
        const tpl = host.appendChild(makeEl('template'));
        tpl.innerHTML = '<li><img src="{{image}}" data-fit="{{fit}}" data-crew-fallback="{{fallback}}"></li>';
        await feed.mount({ querySelector: () => null, querySelectorAll: (s) => (s === '[data-crew-list]' ? [host] : []) });
        const img = host.querySelectorAll('img')[0];
        ok('the upload is used while it works', img.getAttribute('src') === 'https://cdn.test/gone.jpg');
        ok('…and an error handler is waiting', typeof img._on.error === 'function');
        img._on.error();
        ok('a picture that 404s falls back to the drawn outline',
            /^data:image\/svg\+xml/.test(img.src), String(img.src).slice(0, 30));
        ok('…contained, so the wingtips survive', img.getAttribute('data-fit') === 'contain');
        ok('…and cannot loop on a standby that fails too',
            img.getAttribute('data-crew-fallback') === null);
    }

    section('crew-feed.js — hubs and codeshares, off the route map');
    {
        const MAP = { body: {
            routes: [
                { origin: 'MMMX', destination: 'KJFK', o: [19.4, -99], d: [40.6, -73.7], mapped: true, active: true },
                { origin: 'MMMX', destination: 'KLAX', o: [19.4, -99], d: [33.9, -118.4], mapped: true, active: true, kind: 'codeshare', partnerName: 'Delta Virtual' },
                { origin: 'MMMY', destination: 'KDFW', o: [25.8, -100.2], d: [32.9, -97], mapped: true, active: true, kind: 'codeshare', partnerName: 'delta virtual' },
                { origin: 'MMMY', destination: 'KIAH', o: [25.8, -100.2], d: [30, -95.3], mapped: true, active: false },
            ],
            airports: [
                { icao: 'MMMX', lat: 19.4, lon: -99, dep: 9, arr: 4, routes: 12 },
                { icao: 'MMMY', lat: 25.8, lon: -100.2, dep: 3, arr: 2, routes: 5 },
                { icao: 'MMGL', lat: 20.5, lon: -103.3, dep: 1, arr: 1, routes: 5 },
            ],
        } };
        const { feed } = loadFeed({ '/route-map': MAP });
        const bases = await feed.hubs({ limit: 2 });
        ok('the busiest airport is the hub', bases[0].icao === 'MMMX', JSON.stringify(bases));
        ok('a tie on routes breaks on departures', bases[1].icao === 'MMMY', JSON.stringify(bases[1]));
        ok('the limit is honoured', bases.length === 2);

        const { feed: f2 } = loadFeed({ '/route-map': MAP });
        const co = await f2.partners();
        ok('a codeshare partner is listed once, not per sector', co.length === 1, JSON.stringify(co));
        ok('…in the casing the crew centre stored', co[0].name === 'Delta Virtual', co[0].name);
        ok('…and it counts the sectors', co[0].sectors === 2, String(co[0].sectors));
    }
    {
        // A VA that flies alone has no partner section, and an empty list is
        // null so the page keeps whatever it already said.
        const { feed } = loadFeed({ '/route-map': { body: { routes: [
            { origin: 'MMMX', destination: 'KJFK', o: [1, 1], d: [2, 2], mapped: true, active: true },
        ], airports: [] } } });
        ok('no codeshares is null, not an empty list', (await feed.partners()) === null);
        ok('no airports is null too', (await feed.hubs()) === null);
    }
    {
        const { feed } = loadFeed({});
        ok('a quiet backend leaves hubs null', (await feed.hubs()) === null);
        ok('…and partners null', (await feed.partners()) === null);
    }

    section('crew-feed.js — an attribution is never deleted for want of a link');
    {
        const { feed } = loadFeed({ '/api/va-ads/by-slug/amv': { body: { name: 'X', fleet: [
            { type: 'Airbus A320-200', name: 'Standard' },
        ] } } });
        const host = makeEl('ul', { 'data-crew-list': 'fleet' });
        const tpl = host.appendChild(makeEl('template'));
        tpl.innerHTML = '<li><img src="{{image}}"><a href="{{creditHref}}">{{credit}}</a></li>';
        await feed.mount({ querySelector: () => null, querySelectorAll: (s) => (s === '[data-crew-list]' ? [host] : []) });
        ok('the words of the credit survive', host.innerHTML.includes('Outline by Inflight'), host.innerHTML);
        ok('…while the empty link around them does not',
            !/<a[^>]*href=""/.test(host.innerHTML), host.innerHTML);
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
