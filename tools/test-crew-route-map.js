/*
 * tools/test-crew-route-map.js — `npm run test:route-map`
 *
 * THE CREW CENTRE'S ROUTE MAP, WHEN THE INTERNET IS NOT PERFECT.
 *
 * The map proper is MapLibre over OpenFreeMap: an engine from a CDN and a
 * basemap from a tile service, two third-party hosts away. The crew centre used
 * to have no answer at all when either did not arrive — a blocked CDN, an
 * office proxy, an ad-blocker that eats tile hosts, a bad minute — and every one
 * of those produced the same thing, which was a route map that did not work.
 *
 * What is under test is the floor: the network drawn here, from data we already
 * hold, with no host to be blocked by. And that the floor is only the floor —
 * when the engine does load, it is the one that is used.
 *
 * No framework and no database: `node tools/test-crew-route-map.js`, exits
 * non-zero on a failure, needs nothing running.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, p === '/' ? '/crew-dashboard.html' : p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(''); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});

// A network with something of everything: two ends of the world, a short hop,
// somebody else's metal, and one route still in draft.
const AP = {
    EGLL: [51.47, -0.46], KJFK: [40.64, -73.78], LFPG: [49.01, 2.55],
    OMDB: [25.25, 55.36], YSSY: [-33.95, 151.18],
};
const ROUTES = [
    { id: '1', flightNumber: 'TA1', origin: 'EGLL', destination: 'KJFK', aircraft: 'Boeing 787-9', distanceNm: 3000, active: true, kind: 'own', partnerName: '' },
    { id: '2', flightNumber: 'TA2', origin: 'EGLL', destination: 'LFPG', aircraft: 'Airbus A320', distanceNm: 200, active: true, kind: 'own', partnerName: '' },
    { id: '3', flightNumber: 'TA3', origin: 'EGLL', destination: 'OMDB', aircraft: 'Boeing 787-9', distanceNm: 2900, active: true, kind: 'codeshare', partnerName: 'Emirates' },
    { id: '4', flightNumber: 'TA4', origin: 'EGLL', destination: 'YSSY', aircraft: 'Boeing 787-9', distanceNm: 9100, active: false, kind: 'own', partnerName: '' },
];
let routes = ROUTES;
let engineHits = 0;

const mapPayload = () => ({
    routes: routes.map(r => ({ ...r, o: AP[r.origin] || null, d: AP[r.destination] || null, mapped: !!(AP[r.origin] && AP[r.destination]) })),
    airports: [...new Set(routes.flatMap(r => [r.origin, r.destination]))]
        .filter(i => AP[i])
        .map(i => ({ icao: i, lat: AP[i][0], lon: AP[i][1], dep: 1, arr: 1, routes: 2, mapped: true })),
    stats: { unmapped: 0 },
});

/* Just enough of the Tailwind play CDN to give the overlay its geometry. The
   sandbox cannot reach the real one, and a map measured inside an unpositioned
   box is not a map anybody is testing. */
const TW = `(function(){var s=document.createElement('style');s.textContent=[
 '.fixed{position:fixed}.absolute{position:absolute}.relative{position:relative}',
 '.inset-0{inset:0}.inset-x-0{left:0;right:0}.top-0{top:0}.left-0{left:0}.right-0{right:0}.bottom-0{bottom:0}',
 '.grid{display:grid}.flex{display:flex}.block{display:block}.inline-flex{display:inline-flex}',
 '.place-items-center{place-items:center}.items-center{align-items:center}',
 '.flex-1{flex:1 1 0%}.shrink-0{flex-shrink:0}.min-w-0{min-width:0}',
 '.w-full{width:100%}.h-full{height:100%}.h-16{height:4rem}',
 '.overflow-y-auto{overflow-y:auto}.translate-x-full{transform:translateX(100%)}',
 '.pointer-events-none{pointer-events:none}.pointer-events-auto{pointer-events:auto}',
 '.z-10{z-index:10}.z-20{z-index:20}.z-\\\\[60\\\\]{z-index:60}.left-1\\\\/2{left:50%}',
 '.top-\\\\[4\\\\.5rem\\\\]{top:4.5rem}'
].join('');document.head.appendChild(s);window.tailwind={config:{}};})();`;

/* A MapLibre that behaves: enough surface for the dashboard's map path to run
   end to end, so "the engine loaded, so the drawn map is NOT used" is a thing
   this file can actually assert. */
const FAKE_MAPLIBRE = `(function(){
  function Evented(){ this._h={}; }
  Evented.prototype.on=function(a,b,c){ var t=(typeof b==='function')?a:a+':'+b; var f=(typeof b==='function')?b:c; (this._h[t]=this._h[t]||[]).push(f); return this; };
  Evented.prototype.fire=function(t,e){ (this._h[t]||[]).forEach(function(f){ f(e||{}); }); };
  function Map(opts){ Evented.call(this); this._s={}; this.opts=opts;
    var self=this; setTimeout(function(){ self.fire('load'); }, 10); }
  Map.prototype=Object.create(Evented.prototype);
  Map.prototype.addControl=function(){return this;};
  Map.prototype.addSource=function(id,d){ this._s[id]={_d:d.data,setData:function(x){this._d=x;}}; };
  Map.prototype.getSource=function(id){ return this._s[id]; };
  /* addLayer VALIDATES, because the real one does and that is the whole point.
     MapLibre checks a layer against the style spec and, when it does not pass,
     fires an error and RETURNS — the layer is simply never added, and a map
     that swallows its error events shows no sign of it. That is exactly how the
     route lines went missing: line-dasharray is a cross-faded property that
     takes the zoom and nothing else, and it was being handed a ['case', ['get',
     'codeshare'], …] per feature. Only the properties this page actually uses
     are checked; the rule is the spec's, not this file's opinion. */
  var FEATURE_BOUND=function(x){ if(!Array.isArray(x)) return false;
    if(x[0]==='get'||x[0]==='has'||x[0]==='feature-state'||x[0]==='id'||x[0]==='properties') return true;
    return x.some(FEATURE_BOUND); };
  var ZOOM_ONLY=['line-dasharray'];
  Map.prototype.addLayer=function(l){
    var paint=(l&&l.paint)||{};
    for(var i=0;i<ZOOM_ONLY.length;i++){
      var k=ZOOM_ONLY[i];
      if(k in paint && FEATURE_BOUND(paint[k])){
        this.fire('error',{error:new Error('layers.'+l.id+'.paint.'+k+': property expressions not supported')});
        return this;
      }
    }
    this._l=this._l||{}; this._l[l.id]=l; return this;
  };
  Map.prototype.getLayer=function(id){ return (this._l||{})[id]; };
  Map.prototype.setFilter=function(id){ if(!this.getLayer(id)) this.fire('error',{error:new Error("The layer '"+id+"' does not exist in the map's style.")}); };
  Map.prototype.setPaintProperty=function(id){ if(!this.getLayer(id)) this.fire('error',{error:new Error("The layer '"+id+"' does not exist in the map's style.")}); };
  Map.prototype.queryRenderedFeatures=function(){ return []; };
  Map.prototype.getCanvas=function(){ return { style:{} }; };
  Map.prototype.fitBounds=function(){};
  Map.prototype.resize=function(){};
  Map.prototype.remove=function(){};
  function LngLatBounds(){ this._n=0; }
  LngLatBounds.prototype.extend=function(){ this._n++; return this; };
  LngLatBounds.prototype.isEmpty=function(){ return this._n===0; };
  function Marker(){ }
  Marker.prototype.setLngLat=function(){ return this; };
  Marker.prototype.addTo=function(){ return this; };
  Marker.prototype.remove=function(){};
  window.maplibregl={ Map:Map, NavigationControl:function(){}, Marker:Marker, LngLatBounds:LngLatBounds };
})();`;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { console.log('  ✓ ' + n); pass++; } else { console.log('  ✗ ' + n + (x ? '  (' + x + ')' : '')); fail++; } };

(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });

    /**
     * @param engine 'blocked' — the CDN never answers (the reported failure)
     *               'works'   — the engine loads and MapLibre is used
     */
    const open = async (engine) => {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await ctx.newPage();
        const errs = []; page.on('pageerror', e => errs.push(e.message));
        await page.route('**/cdn.tailwindcss.com**', r => r.fulfill({ contentType: 'application/javascript', body: TW }));
        await page.route('**/unpkg.com/**', (r) => {
            const u = r.request().url();
            if (!/maplibre-gl@[\d.]+\/dist\/maplibre-gl\.js/.test(u)) return r.fulfill({ contentType: 'application/javascript', body: '' });
            engineHits += 1;
            if (engine === 'works') return r.fulfill({ contentType: 'application/javascript', body: FAKE_MAPLIBRE });
            return r.abort();
        });
        await page.route('**/tiles.openfreemap.org/**', r => r.abort());
        await page.route('**/api/**', (route) => {
            const p = new URL(route.request().url()).pathname;
            const json = (x) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
            if (p.endsWith('/crew/aircraft-metadata')) return json({ ok: true, aircraft: [], liveries: {} });
            if (p.endsWith('/route-map')) return json(mapPayload());
            if (p.endsWith('/routes')) return json({ routes, ranks: [] });
            if (p.includes('/va-ads/by-slug/') || p.endsWith('/branding')) return json({ name: 'Test VA', code: 'TVA', layout: 'editorial', allowedLayouts: ['editorial'], fleet: [] });
            if (p.endsWith('/me')) return json({ role: 'owner', capabilities: ['routes.manage'], name: 'Owner' });
            return json({});
        });
        await page.addInitScript(() => localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Owner', role: 'owner' })));
        await page.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva`);
        await page.waitForTimeout(1100);
        // The first-visit tour sits over the whole page and would eat every click.
        await page.evaluate(() => { try { if (window.CrewTour && CrewTour.close) CrewTour.close(); } catch {}
            document.querySelectorAll('.ctour-mask, .ctour-pop, .ctour').forEach(e => e.remove()); });
        return { ctx, page, errs };
    };

    const read = (page) => page.evaluate(() => ({
        fallback: (typeof RM !== 'undefined') && !!RM.fallback,
        arcs: document.querySelectorAll('#rmCanvas .cnm-arc').length,
        dashed: document.querySelectorAll('#rmCanvas .cnm-arc.is-share').length,
        draft: document.querySelectorAll('#rmCanvas .cnm-arc.is-draft').length,
        dots: document.querySelectorAll('#rmCanvas [data-airport]').length,
        labels: document.querySelectorAll('#rmCanvas .cnm-label').length,
        zoom: document.querySelectorAll('#rmCanvas [data-cnm-zoom]').length,
        note: (document.getElementById('rmFallbackNote') || {}).textContent || '',
        noteShown: !!(document.getElementById('rmFallbackNote') && !document.getElementById('rmFallbackNote').classList.contains('hidden')),
        spinnerShown: !document.getElementById('rmLoading').classList.contains('hidden'),
        emptyShown: !document.getElementById('rmEmpty').classList.contains('hidden'),
        emptyTitle: document.getElementById('rmEmptyTitle').textContent,
        stats: document.getElementById('rmStats').textContent.replace(/\s+/g, ' ').trim(),
        railShown: !document.getElementById('rmRail').classList.contains('hidden'),
        railTitle: document.getElementById('rmRailTitle').textContent,
    }));

    /* ==================================================================
     * 1. THE ENGINE NEVER ARRIVES — the reported failure
     * ================================================================ */
    console.log('\nWhen the map engine cannot be reached');
    routes = ROUTES;
    let { ctx, page, errs } = await open('blocked');
    await page.evaluate(() => { openRoutes(); openRouteMap(); });
    await page.waitForTimeout(2500);
    let s = await read(page);

    ok('the network is drawn anyway', s.fallback && s.arcs > 0, JSON.stringify(s));
    // Three of the four are active; the draft one is held back by "Active only".
    ok('…every active sector of it', s.arcs === 3, 'arcs ' + s.arcs);
    ok('…with an airport for each end, named', s.dots === 4 && s.labels > 0, 'dots ' + s.dots + ' labels ' + s.labels);
    ok('…somebody else’s metal drawn as somebody else’s', s.dashed === 1, 'dashed ' + s.dashed);
    ok('…and it can be zoomed', s.zoom === 3);
    ok('the spinner stops rather than turning for ever', !s.spinnerShown);
    // "Map unavailable" over an empty rectangle was the old answer to this.
    ok('the empty state is not shown over a drawn map', !s.emptyShown, s.emptyTitle);
    ok('it says plainly that this is the simplified map', s.noteShown && /simplified map/i.test(s.note), s.note);
    ok('…and offers to try the other one again', /try again/i.test(s.note), s.note);
    ok('the statistics still count the network', /3 routes/.test(s.stats) && /4 airports/.test(s.stats), s.stats);
    ok('no page errors', errs.length === 0, errs.join('|'));

    /* The filters are the same controls; they must mean the same thing. */
    console.log('\nThe filters work on the drawn map too');
    await page.evaluate(() => { document.getElementById('rmKind').value = 'own'; rmApplyFilters(); });
    await page.waitForTimeout(300);
    s = await read(page);
    ok('“our own metal” drops the codeshare', s.arcs === 2 && s.dashed === 0, JSON.stringify({ arcs: s.arcs, dashed: s.dashed }));

    await page.evaluate(() => { document.getElementById('rmKind').value = 'codeshare'; rmApplyFilters(); });
    await page.waitForTimeout(300);
    s = await read(page);
    ok('…and “codeshares” keeps only it', s.arcs === 1 && s.dashed === 1, JSON.stringify({ arcs: s.arcs, dashed: s.dashed }));

    await page.evaluate(() => { document.getElementById('rmKind').value = ''; rmToggleActive(); });
    await page.waitForTimeout(300);
    s = await read(page);
    ok('turning off “active only” brings the draft sector in', s.arcs === 4 && s.draft === 1, JSON.stringify({ arcs: s.arcs, draft: s.draft }));

    await page.evaluate(() => { document.getElementById('rmSearch').value = 'LFPG'; rmApplyFilters(); });
    await page.waitForTimeout(300);
    s = await read(page);
    ok('searching an airport narrows it to that airport’s sectors', s.arcs === 1, 'arcs ' + s.arcs);

    await page.evaluate(() => { document.getElementById('rmSearch').value = ''; rmToggleActive(); rmApplyFilters(); });
    await page.waitForTimeout(300);

    /* Tapping something is the point of a map. The highlight is MapLibre's, but
       the rail is not, and it used to throw on a null map. */
    console.log('\nTapping the drawn map');
    await page.evaluate(() => { const d = document.querySelector('#rmCanvas [data-airport="EGLL"]'); d.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await page.waitForTimeout(300);
    s = await read(page);
    ok('an airport opens its details', s.railShown && /EGLL/.test(s.railTitle), s.railTitle);
    ok('…without throwing on the map that is not there', errs.length === 0, errs.join('|'));

    /* ==================================================================
     * 2. A NETWORK WITH NOTHING IN IT
     *
     * "No routes yet" and "the map would not load" are different problems and
     * must not wear each other's words.
     * ================================================================ */
    console.log('\nAn airline with no routes');
    await ctx.close();
    routes = [];
    ({ ctx, page, errs } = await open('blocked'));
    await page.evaluate(() => { openRoutes(); openRouteMap(); });
    await page.waitForTimeout(2500);
    s = await read(page);
    ok('says there are no routes, not that the map is broken',
        s.emptyShown && /no routes/i.test(s.emptyTitle), s.emptyTitle);
    ok('no page errors', errs.length === 0, errs.join('|'));
    await ctx.close();

    /* ==================================================================
     * 3. THE ENGINE LOADS — the drawn map stays out of the way
     * ================================================================ */
    console.log('\nWhen the map engine does load');
    routes = ROUTES;
    ({ ctx, page, errs } = await open('works'));
    await page.evaluate(() => { openRoutes(); openRouteMap(); });
    await page.waitForTimeout(1500);
    s = await read(page);
    ok('MapLibre is used', await page.evaluate(() => typeof RM !== 'undefined' && !!RM.map && !!RM.ready));
    ok('…and the drawn map is not', !s.fallback && s.arcs === 0, JSON.stringify({ fallback: s.fallback, arcs: s.arcs }));
    ok('nothing tells the reader it is simplified', !s.noteShown, s.note);
    ok('the spinner stops', !s.spinnerShown);
    // THE ROUTES ARE ON IT. A layer the engine refused is drawn by nothing and
    // reported by nothing, and the map comes up as a basemap with some dots on
    // it — which on the dark basemap reads as a black screen. Both line layers
    // have to be there, and each has to carry only its own half of the network.
    const layers = await page.evaluate(() => {
        const l = RM.map._l || {};
        const shape = (id) => l[id] ? { filter: JSON.stringify(l[id].filter),
            dash: JSON.stringify((l[id].paint || {})['line-dasharray'] || null) } : null;
        return { own: shape('rm-routes-line'), share: shape('rm-routes-share'), ids: Object.keys(l) };
    });
    ok('the airline’s own sectors are drawn', !!layers.own, layers.ids.join(','));
    ok('…solid', layers.own && layers.own.dash === 'null', layers.own && layers.own.dash);
    ok('somebody else’s are drawn too', !!layers.share, layers.ids.join(','));
    ok('…dashed, and at a fixed dash the engine will take',
        layers.share && layers.share.dash === '[2,2]', layers.share && layers.share.dash);
    ok('…and the two do not draw each other',
        layers.own && layers.share
        && /"!"/.test(layers.own.filter) && /codeshare/.test(layers.own.filter)
        && /codeshare/.test(layers.share.filter) && !/"!"/.test(layers.share.filter),
        JSON.stringify(layers));
    // Focusing dims the rest of the network, and it has to reach both layers —
    // naming one by hand is how the second one gets forgotten.
    await page.evaluate(() => rmFocusRoute('1'));
    await page.waitForTimeout(120);
    ok('focusing a sector talks to every line layer, not one of them',
        await page.evaluate(() => RM_LINES.every(id => !!RM.map.getLayer(id))));
    ok('no page errors', errs.length === 0, errs.join('|'));
    await ctx.close();

    /* ==================================================================
     * 4. A FAILURE IS NOT FOREVER
     *
     * The loader used to cache its rejection, so one bad minute broke the map
     * for the rest of the session: pressing Map again re-used the failed
     * promise and failed instantly, without asking the network anything.
     * ================================================================ */
    console.log('\nA bad minute is not the rest of the session');
    ({ ctx, page, errs } = await open('blocked'));
    await page.evaluate(() => { openRoutes(); openRouteMap(); });
    await page.waitForTimeout(2500);
    const before = engineHits;
    await page.evaluate(() => rmRetryEngine());
    await page.waitForTimeout(2000);
    ok('trying again really asks for the engine again', engineHits > before,
        'hits ' + before + ' → ' + engineHits);
    s = await read(page);
    ok('…and when it still will not come, the network is drawn again',
        s.fallback && s.arcs > 0, JSON.stringify(s));
    ok('no page errors', errs.length === 0, errs.join('|'));
    await ctx.close();

    console.log(`\n${pass} passed, ${fail} failed`);
    await browser.close(); server.close();
    process.exit(fail ? 1 : 0);
})();
