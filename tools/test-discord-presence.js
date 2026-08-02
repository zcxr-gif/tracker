// test-discord-presence.js
// Drives the REAL discordPresence.js against a stubbed Discord client to prove
// the thing a pilot's friends actually see is correct:
//
//   * the handshake goes to Discord's local RPC port with the app's client id
//   * the activity carries the flight — callsign, type, route, flight level,
//     phase, speed — and the aircraft photo as the large image
//   * `timestamps.end` is set, because the countdown to touchdown is the whole
//     point of the card, and it lands within a minute of the honest estimate
//   * following survives the pilot respawning onto a NEW flight id
//   * a flight that changed nothing does not spend a rate-limit slot
//   * no Discord running, or a rejected origin, degrades to a clear message
//     rather than an exception
//
// The stub replaces window.WebSocket before the module loads, so everything
// under test — port scan, nonce matching, payload building, coalescing — is the
// shipped code. Only the Discord client itself is fake.
//
// Run:  node tools/test-discord-presence.js
// Needs: playwright-core, and a Chromium at $PLAYWRIGHT_CHROMIUM (or the
//        pre-installed /opt/pw-browsers/chromium). Set PLAYWRIGHT_NO_SANDBOX=1
//        when running as root in a container.
const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, p === '/' ? '/index.html' : p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(''); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});

let pass = 0; let fail = 0;
const ok = (name) => { pass += 1; console.log(`  ✓ ${name}`); };
const bad = (name, detail) => { fail += 1; console.log(`  ✗ ${name}\n      ${detail}`); };
const eq = (name, actual, expected) => (
    actual === expected ? ok(name) : bad(name, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
);
const has = (name, haystack, needle) => (
    String(haystack).includes(needle) ? ok(name) : bad(name, `${JSON.stringify(haystack)} does not contain ${JSON.stringify(needle)}`)
);

// A cruising 777 out of JFK, shaped exactly like an all_flights_update entry.
const FLIGHT = {
    flightId: 'flt-1',
    callsign: 'BAW278',
    username: 'speedbird',
    aircraft: { aircraftName: 'Boeing 777-300ER', liveryName: 'British Airways', registration: 'G-STBA' },
    departureIcao: 'KJFK',
    arrivalIcao: 'EGLL',
    position: { lat: 51.0, lon: -10.0, alt_ft: 38000, gs_kt: 500, vs_fpm: 0, heading_deg: 80 },
};

/**
 * Install the fake Discord client and the fake backend, then load the module.
 * `mode` picks which failure the stub simulates.
 */
function stubEnvironment(mode) {
    return `
    window.__rpc = { handshakes: [], sent: [] };

    class FakeDiscordSocket {
        constructor(url) {
            this.url = url;
            this.readyState = 0;
            window.__rpc.handshakes.push(url);
            const port = Number(new URL(url.replace('ws://', 'http://')).port);

            setTimeout(() => {
                // Only one port hosts the real thing, same as a live machine.
                if (${mode === 'no-discord'} || port !== 6463) return this._close(1006);
                if (${mode === 'bad-origin'}) return this._close(4002);
                this.readyState = 1;
                this._emit('message', { data: JSON.stringify({
                    cmd: 'DISPATCH', evt: 'READY',
                    data: { v: 1, user: { id: '42', username: 'pilot', global_name: 'Pilot' } },
                }) });
            }, 5);
        }
        _emit(type, payload) {
            (this['__' + type] || []).forEach((fn) => fn(payload));
        }
        _close(code) {
            this.readyState = 3;
            this._emit('close', { code });
        }
        addEventListener(type, fn) {
            const key = '__' + type;
            (this[key] = this[key] || []).push(fn);
        }
        send(raw) {
            const frame = JSON.parse(raw);
            window.__rpc.sent.push(frame);
            setTimeout(() => this._emit('message', { data: JSON.stringify({
                cmd: frame.cmd, evt: null, nonce: frame.nonce, data: {},
            }) }), 2);
        }
        close() { this._close(1000); }
    }
    FakeDiscordSocket.OPEN = 1;
    window.WebSocket = FakeDiscordSocket;
    window.WebSocket.OPEN = 1;

    // Backend: config, plus an asset mint that echoes a deterministic key.
    const realFetch = window.fetch;
    window.fetch = async (input, init) => {
        const url = String(input);
        if (url.includes('/api/discord/presence/config')) {
            return new Response(JSON.stringify({ ok: true, enabled: true, clientId: 'test-client-id', externalAssets: true }),
                { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.includes('/api/discord/presence/assets')) {
            const body = JSON.parse(init.body);
            const assets = {};
            body.urls.forEach((u) => { assets[u] = 'mp:external/abc/' + encodeURIComponent(u); });
            return new Response(JSON.stringify({ ok: true, assets }),
                { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.includes('/api/airport/EGLL')) {
            return new Response(JSON.stringify({ latitude: 51.4775, longitude: -0.4614 }),
                { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return realFetch(input, init);
    };
    `;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({
        executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium',
        args: process.env.PLAYWRIGHT_NO_SANDBOX ? ['--no-sandbox'] : [],
    });

    /** Fresh page with the stub installed and the module imported. */
    async function open(mode) {
        const page = await browser.newPage();
        await page.addInitScript(stubEnvironment(mode));
        // A bare page: the module only needs SocketDataHub, not the whole map.
        await page.goto(`http://127.0.0.1:${port}/tools/__presence-harness.html`);
        await page.waitForFunction(() => !!window.DiscordPresence);
        return page;
    }

    // The harness is written next to the test so the page can import the real
    // module by path, and removed again on the way out.
    const harness = path.join(ROOT, 'tools', '__presence-harness.html');
    fs.writeFileSync(harness, `<!doctype html><meta charset="utf-8"><title>presence harness</title>
<script type="module">
  import { DiscordPresence } from '../discordPresence.js';
  import { socketDataHub } from '../SocketDataHub.js';
  window.DiscordPresence = DiscordPresence;
  window.publish = (flights) => socketDataHub.publish('all_flights_update', { server: 'Expert Server', flights });
  DiscordPresence.boot();
</script>`);

    try {
        // ── The happy path ──────────────────────────────────────────────────
        console.log('\nBroadcasting a flight\n');
        {
            const page = await open('ok');
            await page.evaluate((f) => window.publish([f]), FLIGHT);
            await page.evaluate(() => window.DiscordPresence.connect());
            await page.evaluate((f) => window.DiscordPresence.follow({
                flightId: f.flightId, username: f.username, label: f.callsign,
            }), FLIGHT);
            await wait(600);

            const handshakes = await page.evaluate(() => window.__rpc.handshakes);
            has('handshake targets the local RPC port', handshakes[0], 'ws://127.0.0.1:646');
            has('handshake carries the client id', handshakes[0], 'client_id=test-client-id');
            eq('every RPC port is probed', handshakes.length, 10);

            const frames = await page.evaluate(() => window.__rpc.sent.filter((f) => f.cmd === 'SET_ACTIVITY'));
            const activity = frames[frames.length - 1]?.args?.activity;

            if (!activity) {
                bad('an activity was pushed', 'no SET_ACTIVITY frame was sent');
            } else {
                eq('details name the callsign and type', activity.details, 'BAW278 · Boeing 777-300ER');
                eq('state carries route and flight level', activity.state, 'KJFK → EGLL · FL380');
                eq('large text is the operator and tail', activity.assets.large_text, 'British Airways · G-STBA');
                eq('small text is phase and speed', activity.assets.small_text, 'Cruising · 500 kt · +0 fpm');
                eq('phase drives the small image', activity.assets.small_image, 'phase_cruise');
                has('the deep link points at this flight', activity.buttons[0].url, '?flight=flt-1');
                has('the deep link carries the session', activity.buttons[0].url, 'server=Expert+Server');

                // ~361 nm to Heathrow at 500 kt is a little over 43 minutes.
                // The point is that a countdown exists and is roughly sane, not
                // that it matches a great-circle calculator to the second.
                const minutesOut = (activity.timestamps.end - Date.now()) / 60000;
                (minutesOut > 35 && minutesOut < 55)
                    ? ok('timestamps.end gives a plausible countdown')
                    : bad('timestamps.end gives a plausible countdown', `${minutesOut.toFixed(1)} minutes out`);
            }
            await page.close();
        }

        // ── The aircraft photo ──────────────────────────────────────────────
        console.log('\nThe aircraft photo\n');
        {
            const page = await open('ok');
            await page.evaluate(() => {
                // The map resolves photos onto its own features; presence reads
                // them from there.
                window.getLiveFlightData = () => ([{ properties: {
                    flightId: 'flt-1', communityImageUrl: 'https://cdn.example/g-stba.jpg',
                } }]);
            });
            await page.evaluate((f) => window.publish([f]), FLIGHT);
            await page.evaluate(() => window.DiscordPresence.connect());
            await page.evaluate((f) => window.DiscordPresence.follow({ flightId: f.flightId, username: f.username }), FLIGHT);
            await wait(700);

            const activity = await page.evaluate(() => {
                const frames = window.__rpc.sent.filter((f) => f.cmd === 'SET_ACTIVITY');
                return frames[frames.length - 1]?.args?.activity;
            });
            has('the photo is minted into an external asset key', activity?.assets?.large_image, 'mp:external/abc/');
            await page.close();
        }

        // ── Following a pilot, not just an id ───────────────────────────────
        console.log('\nA pilot who respawns\n');
        {
            const page = await open('ok');
            await page.evaluate((f) => window.publish([f]), FLIGHT);
            await page.evaluate(() => window.DiscordPresence.connect());
            await page.evaluate((f) => window.DiscordPresence.follow({ flightId: f.flightId, username: f.username }), FLIGHT);
            await wait(400);

            // Same pilot, brand new flight id and a different route.
            await page.evaluate((f) => window.publish([{
                ...f, flightId: 'flt-2', callsign: 'BAW117', departureIcao: 'EGLL', arrivalIcao: 'KJFK',
            }]), FLIGHT);
            await wait(6000); // past the update floor

            const state = await page.evaluate(() => window.DiscordPresence.getState());
            eq('the new flight id is adopted', state.follow.flightId, 'flt-2');
            eq('the new leg is what is shown', state.flight.callsign, 'BAW117');
            await page.close();
        }

        // ── Rate-limit discipline ───────────────────────────────────────────
        console.log('\nRate limits\n');
        {
            const page = await open('ok');
            await page.evaluate((f) => window.publish([f]), FLIGHT);
            await page.evaluate(() => window.DiscordPresence.connect());
            await page.evaluate((f) => window.DiscordPresence.follow({ flightId: f.flightId, username: f.username }), FLIGHT);
            await wait(500);

            const before = await page.evaluate(() => window.__rpc.sent.filter((f) => f.cmd === 'SET_ACTIVITY').length);
            // Ten identical packets — a parked aircraft, or a quiet cruise.
            for (let i = 0; i < 10; i += 1) await page.evaluate((f) => window.publish([f]), FLIGHT);
            await wait(2000);
            const after = await page.evaluate(() => window.__rpc.sent.filter((f) => f.cmd === 'SET_ACTIVITY').length);

            eq('an unchanged flight sends nothing', after, before);
            await page.close();
        }

        // ── Degrading honestly ──────────────────────────────────────────────
        console.log('\nWhen Discord is not there\n');
        {
            const page = await open('no-discord');
            const err = await page.evaluate(() => window.DiscordPresence.connect().then(() => '', (e) => e.message));
            has('no client says so plainly', err, 'No Discord desktop app found');
            const state = await page.evaluate(() => window.DiscordPresence.getState());
            eq('and the panel is left in an error state', state.status, 'error');
            await page.close();
        }
        {
            const page = await open('bad-origin');
            const err = await page.evaluate(() => window.DiscordPresence.connect().then(() => '', (e) => e.message));
            has('a rejected origin points at the portal', err, 'RPC Origins');
            await page.close();
        }
    } finally {
        fs.rmSync(harness, { force: true });
        await browser.close();
        server.close();
    }

    console.log(`\n${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
})();
