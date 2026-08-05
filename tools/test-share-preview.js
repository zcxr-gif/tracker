// test-share-preview.js — per-flight link previews.
//
// Sharing a flight produces a direct app URL, which is fast for humans and
// invisible to crawlers: index.html only carries the site-wide Open Graph tags,
// so a flight pasted into a chat unfurled as the generic banner. Two pieces fix
// that, and both fail quietly rather than loudly if they regress:
//
//   * the edge function, which must catch crawlers asking for a shared flight
//     and — just as importantly — must NOT catch anything else. A false
//     positive puts every human through a function they were deliberately
//     routed around.
//   * share.js's image choice, where the failure mode is an og:image the
//     crawler cannot fetch. That is worse than no map: the unfurl loses its
//     picture entirely instead of falling back to the photo we already have.
//
// Node builtins only, no browser and no network. The edge function is an ES
// module for Deno, so its default export is imported and called with stub
// Request/context objects; share.js is CommonJS and its helpers are exercised
// through a stubbed global fetch.
//
// Run:  node tools/test-share-preview.js
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');

let pass = 0; let fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log(`  ✓ ${name}`); pass++; }
    else { console.log(`  ✗ ${name}${extra ? `  (${extra})` : ''}`); fail++; }
};
const head = (s) => console.log(`\n${s}`);

const DISCORD_UA = 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)';
const HUMAN_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Minimal stand-ins for what the edge runtime hands the function.
const req = (url, ua) => ({ url, headers: { get: (k) => (k.toLowerCase() === 'user-agent' ? ua : null) } });
const ctx = { rewrite: (target) => ({ __rewrite: target }) };

(async () => {
    const edge = (await import(pathToFileURL(
        path.join(ROOT, 'netlify', 'edge-functions', 'flight-preview.js')).href)).default;

    // ------------------------------------------------------------------
    head('The edge function catches crawlers on a shared flight');
    for (const ua of [
        DISCORD_UA,
        'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
        'Twitterbot/1.0',
        'WhatsApp/2.19.81 A',
        'TelegramBot (like TwitterBot)',
        'facebookexternalhit/1.1',
        'Mozilla/5.0 (compatible; Googlebot/2.1)',
    ]) {
        const out = await edge(req('https://inflight.info/?flight=abc123', ua), ctx);
        ok(`${ua.split('/')[0]} is rewritten`, out && typeof out.__rewrite === 'string', JSON.stringify(out));
    }

    head('...and leaves everything else alone');
    const passesThrough = async (label, url, ua) => {
        const out = await edge(req(url, ua), ctx);
        ok(label, out === undefined, JSON.stringify(out));
    };
    await passesThrough('a human opening a shared flight',
        'https://inflight.info/?flight=abc123&s=eyJ4IjoxfQ', HUMAN_UA);
    await passesThrough('a crawler on the bare site root',
        'https://inflight.info/', DISCORD_UA);
    await passesThrough('a crawler on the root with other params',
        'https://inflight.info/?server=Expert', DISCORD_UA);
    await passesThrough('a crawler on another page',
        'https://inflight.info/career.html?flight=abc123', DISCORD_UA);
    await passesThrough('a crawler on the crew centre',
        'https://inflight.info/crew/example?flight=abc', DISCORD_UA);
    await passesThrough('a request with no user agent at all',
        'https://inflight.info/?flight=abc123', '');
    await passesThrough('an empty flight parameter',
        'https://inflight.info/?flight=', DISCORD_UA);

    head('The rewrite carries the right query');
    {
        const out = await edge(req(
            'https://inflight.info/?flight=abc123&server=Expert&map=midnight&s=' + 'x'.repeat(4000),
            DISCORD_UA), ctx);
        const q = new URLSearchParams(out.__rewrite.split('?')[1]);
        ok('it targets the share function', out.__rewrite.startsWith('/.netlify/functions/share?'), out.__rewrite.slice(0, 40));
        ok('the flight id is forwarded', q.get('flight') === 'abc123');
        ok('the server is forwarded', q.get('server') === 'Expert');
        ok('the chosen map style is forwarded', q.get('map') === 'midnight');
        // The snapshot blob is for the app, not the crawler, and it is large.
        ok('the app handoff snapshot is dropped', q.get('s') === null);
        ok('the rewrite stays small', out.__rewrite.length < 200, String(out.__rewrite.length));
    }

    head('It is declared to run at the site root');
    {
        const mod = await import(pathToFileURL(
            path.join(ROOT, 'netlify', 'edge-functions', 'flight-preview.js')).href);
        ok('config.path is /', mod.config && mod.config.path === '/', JSON.stringify(mod.config));
        // A netlify.toml would start overriding the site's UI build settings.
        ok('no netlify.toml was introduced', !fs.existsSync(path.join(ROOT, 'netlify.toml')));
    }

    // ------------------------------------------------------------------
    head('share.js picks a preview image');
    {
        // Stub fetch before requiring: share.js captures it at module load.
        const calls = [];
        let respond = () => ({ ok: true });
        global.fetch = async (url, opts) => { calls.push({ url: String(url), opts }); return respond(url); };

        const share = require(path.join(ROOT, 'netlify', 'functions', 'share.js'));
        const { routeMapImageUrl, confirmedRouteMapUrl } = share.__test || {};
        ok('the helpers are exported for testing', typeof routeMapImageUrl === 'function');

        const flight = {
            departureIcao: 'EGLL', arrivalIcao: 'KJFK',
            position: { lat: 53.1234567, lon: -30.7654321 },
        };

        const url = new URL(routeMapImageUrl(flight, 'midnight'));
        ok('it asks the backend for the route map', url.pathname === '/api/route-map', url.pathname);
        ok('it requests the link-preview size', url.searchParams.get('size') === 'og');
        ok('it passes the chosen style', url.searchParams.get('style') === 'midnight');
        ok('it passes both airports',
            url.searchParams.get('dep') === 'EGLL' && url.searchParams.get('arr') === 'KJFK');
        ok('it rounds the position rather than sending full precision',
            url.searchParams.get('lat') === '53.123' && url.searchParams.get('lon') === '-30.765',
            `${url.searchParams.get('lat')},${url.searchParams.get('lon')}`);

        ok('an unknown style falls back to the default',
            new URL(routeMapImageUrl(flight, 'neon')).searchParams.get('style') === 'dark');
        ok('no style falls back to the default',
            new URL(routeMapImageUrl(flight, '')).searchParams.get('style') === 'dark');
        ok('off means no map', routeMapImageUrl(flight, 'off') === null);

        head('...and declines to when there is nothing to draw');
        ok('a missing arrival is not a route', routeMapImageUrl({ departureIcao: 'EGLL' }, 'dark') === null);
        ok('a missing departure is not a route', routeMapImageUrl({ arrivalIcao: 'KJFK' }, 'dark') === null);
        ok('a circular route is not a route',
            routeMapImageUrl({ departureIcao: 'EGLL', arrivalIcao: 'EGLL' }, 'dark') === null);
        ok('a malformed code is not a route',
            routeMapImageUrl({ departureIcao: 'X', arrivalIcao: 'KJFK' }, 'dark') === null);
        ok('an empty flight is not a route', routeMapImageUrl({}, 'dark') === null);
        ok('no flight at all is handled', routeMapImageUrl(null, 'dark') === null);
        ok('a flight with no position still maps',
            routeMapImageUrl({ departureIcao: 'EGLL', arrivalIcao: 'KJFK' }, 'dark') !== null);
        ok('a nonsense position is dropped, not sent',
            new URL(routeMapImageUrl(
                { departureIcao: 'EGLL', arrivalIcao: 'KJFK', position: { lat: 999, lon: 0 } }, 'dark'
            )).searchParams.get('lat') === null);

        head('...and only uses a map the backend confirms');
        calls.length = 0;
        respond = () => ({ ok: true });
        ok('a confirmed map is used', (await confirmedRouteMapUrl(flight, 'dark')) !== null);
        ok('the probe is a HEAD, not a full download',
            calls.length === 1 && calls[0].opts && calls[0].opts.method === 'HEAD',
            JSON.stringify(calls[0] && calls[0].opts));

        respond = () => ({ ok: false, status: 404 });
        ok('an unmappable route falls back rather than serving a broken image',
            (await confirmedRouteMapUrl(flight, 'dark')) === null);

        respond = () => { throw new Error('backend down'); };
        ok('a backend failure falls back too',
            (await confirmedRouteMapUrl(flight, 'dark')) === null);

        calls.length = 0;
        ok('off never even probes',
            (await confirmedRouteMapUrl(flight, 'off')) === null && calls.length === 0);
    }

    // ------------------------------------------------------------------
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
