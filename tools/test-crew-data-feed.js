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
function makeEl(tag, attrs) {
    const el = {
        tagName: (tag || 'div').toUpperCase(),
        attrs: Object.assign({}, attrs),
        innerHTML: '',
        children: [],
        parentNode: null,
        style: { setProperty() {} },
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
        setAttribute(k, v) { this.attrs[k] = String(v); },
        removeAttribute(k) { delete this.attrs[k]; },
        hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); },
        appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
        removeChild(c) { const i = this.children.indexOf(c); if (i > -1) this.children.splice(i, 1); c.parentNode = null; return c; },
        // Only the selectors these files use: [data-x] and [data-x], [data-y].
        querySelectorAll(sel) { return descendants(this).filter((e) => matches(e, sel)); },
        querySelector(sel) { return descendants(this).find((e) => matches(e, sel)) || null; },
        closest(sel) { let n = this; while (n) { if (matches(n, sel)) return n; n = n.parentNode; } return null; },
    };
    return el;
}
function descendants(root) {
    const out = [];
    (function walk(n) { n.children.forEach((c) => { out.push(c); walk(c); }); })(root);
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

    section('crew-feed.js — painting somebody else’s page');
    {
        const { feed } = loadFeed({});
        const root = makeEl('div');
        const keep = root.appendChild(makeEl('b', { 'data-crew-stat': 'pilots' }));
        const figure = root.appendChild(makeEl('div', { 'data-crew-figure': '' }));
        const inside = figure.appendChild(makeEl('b', { 'data-crew-stat': 'landings' }));
        const when = root.appendChild(makeEl('section', { 'data-crew-when': 'flights30d' }));

        feed.paintStats({ pilots: 412 }, root);
        ok('a figure we have is written in', keep.innerHTML === '' && keep.textContent === '412', keep.textContent);
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

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
