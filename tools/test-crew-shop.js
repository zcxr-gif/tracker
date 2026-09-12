// test-crew-shop.js
// Drives the REAL crew-dashboard.html to prove the shop behaves like a shop:
//
//   * a VA that has not turned it on has no shop — no tile for the crew, and
//     the one screen that switches it on for whoever can
//   * the shelf tells a pilot what they can actually do: buy it, how much
//     short they are, or that it is gone
//   * INFLIGHT PAY ONLY CHARGES ON A HELD PRESS. A click, a slip, a let-go
//     halfway — none of them spend anything. This is the whole safety
//     property of the thing and the first test that should ever fail
//   * one press is one order: the button cannot be re-armed while it is in
//     flight
//   * the balance shown afterwards is the SERVER'S, not the price subtracted
//     from whatever the page was holding
//   * staff get a back office that reprices earning and stocks the shelf, and
//     a worked example that keeps up as the rate is typed
//   * a crew center whose database predates the shop is told to update it,
//     not shown "that didn't work"
//
// Run:  node tools/test-crew-shop.js
// Needs: playwright-core, and a Chromium at $PLAYWRIGHT_CHROMIUM (or the
//        pre-installed /opt/pw-browsers/chromium).
const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, p === '/' ? '/crew-dashboard.html' : p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(''); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});

// The settings drawer and the tool grid are Tailwind-positioned, and the CDN is
// not reachable from a test box. See test-crew-interface.js.
const TAILWIND = fs.readFileSync(path.join(__dirname, 'crew-tailwind.css'), 'utf8');

const CAPABILITIES = [
    { id: 'settings.branding', group: 'Appearance', label: 'Change appearance' },
    { id: 'flights.review', group: 'Operations', label: 'Review flights' },
];

let state = null;
const freshState = () => ({
    caps: CAPABILITIES.map((c) => c.id),
    shopOn: true,
    canManage: true,
    missing: false,               // the database predates the shop
    balance: 4820,
    orders: [],                   // every POST /shop/orders, in order
    settings: [],                 // every POST /shop/settings, in order
    added: [],                    // every POST /shop/items, in order
});

const ITEMS = () => ([
    { id: 'i1', name: 'A320 Retro livery', desc: 'The 1987 scheme.', price: 1500, stock: -1 },
    { id: 'i2', name: 'Custom callsign', desc: 'Any three digits.', price: 6200, stock: -1 },
    { id: 'i3', name: 'Gate 1A at KSEA', desc: 'Your pick of stand.', price: 900, stock: 0 },
]);

/* What the server offers a VA with an empty shelf, priced from their own rates.
 * A representative slice of the real catalogue rather than all of it — the
 * arithmetic that produces these is unit-tested where it lives, in the database
 * repo, and what this file has to prove is what the back office DOES with them.
 *
 * "A320 Retro livery" deliberately matches an item already on the shelf in
 * ITEMS(), because the state worth testing is the one where a VA has already
 * taken a suggestion and must not be offered it twice. */
const SUGGESTED = () => ([
    { id: 'badge', group: 'Identity', name: 'A badge on your profile', desc: 'A mark beside your name.', icon: 'shield', price: 1100, stock: -1, limitPerPilot: 0 },
    { id: 'callsign', group: 'Identity', name: 'Your own callsign', desc: 'A flight number that is yours.', icon: 'radio', price: 2900, stock: -1, limitPerPilot: 1 },
    { id: 'lead', group: 'Events', name: 'Lead the next group flight', desc: 'Fly as number one.', icon: 'users', price: 5400, stock: 1, limitPerPilot: 1 },
    { id: 'livery', group: 'The network', name: 'A320 Retro livery', desc: 'Already on this shelf.', icon: 'paintbrush', price: 10800, stock: 3, limitPerPilot: 1 },
]);

function api(route) {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const method = route.request().method();
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });

    if (p.includes('/api/va-ads/by-slug/')) {
        return json({ name: 'Test VA', code: 'TST', shop: { enabled: state.shopOn } });
    }
    if (p.endsWith('/me')) {
        // Role matters as much as the capability list: an owner can do
        // everything whatever `caps` says, so the no-say case has to be a
        // crew member rather than an owner holding an empty list.
        return json({ role: state.caps.length ? 'owner' : 'member', caps: state.caps, capabilities: CAPABILITIES, rolePresets: [], staffRoles: [], staffAssignments: [] });
    }
    // The shop itself.
    if (p.endsWith('/shop') && method === 'GET') {
        if (state.missing) return json({ error: 'Your crew center’s database needs updating.', code: 'shop_missing' }, 409);
        return json({
            enabled: state.shopOn,
            canManage: state.canManage,
            currency: { name: 'Miles', short: 'mi' },
            earn: { perHour: 120, perLanding: 15, fleetBonus: 40, violationPenalty: 60 },
            items: ITEMS(),
            suggested: SUGGESTED(),
            wallet: {
                pilotId: 'p-8812', balance: state.balance, earned: 9140, spent: 4320,
                name: 'Sam Reyes', callsign: 'TST1174', rank: 'First Officer', since: '2026-03-02',
            },
        });
    }
    if (p.endsWith('/shop/settings') && method === 'POST') {
        const body = route.request().postDataJSON() || {};
        state.settings.push(body);
        if (typeof body.enabled === 'boolean') state.shopOn = body.enabled;
        // Re-priced with the settings, because every suggestion's price is
        // worked out from the rates that were just saved.
        return json({ enabled: state.shopOn, canManage: true, currency: { name: 'Miles', short: 'mi' },
            earn: { perHour: 120, perLanding: 15, fleetBonus: 40, violationPenalty: 60 }, items: ITEMS(),
            suggested: SUGGESTED().map((x) => ({ ...x, price: x.price * 2 })),
            wallet: { pilotId: 'p-8812', balance: state.balance, name: 'Sam Reyes', callsign: 'TST1174' } });
    }
    if (p.endsWith('/shop/items') && method === 'POST') {
        state.added.push(route.request().postDataJSON() || {});
        return json({ item: { id: 'new1', ...(route.request().postDataJSON() || {}) } }, 201);
    }
    if (p.endsWith('/shop/orders') && method === 'POST') {
        const body = route.request().postDataJSON() || {};
        state.orders.push(body);
        const item = ITEMS().find((i) => i.id === body.itemId);
        // Deliberately NOT balance - price: the test wants to prove the page
        // renders what the server says rather than its own arithmetic.
        state.balance = 1234;
        return json({ order: { id: 'o9', code: 'TST-4XB2', itemName: item.name, price: item.price, status: 'placed' },
            wallet: { pilotId: 'p-8812', balance: state.balance, name: 'Sam Reyes', callsign: 'TST1174' } });
    }
    if (p.endsWith('/shop/orders') && method === 'GET') {
        return json({ orders: [{ id: 'o1', itemName: 'A320 Retro livery', price: 1500, status: 'placed', code: 'TST-7Q2K', createdAt: new Date().toISOString(), pilotName: 'Sam Reyes' }] });
    }
    if (p.endsWith('/stats')) return json({ ok: true, connected: true, stats: { pilots: 12, hours: 400, flights30d: 3, pireps: 9 } });
    if (p.endsWith('/me/pilot')) return json({ linkable: false, linked: false, pilot: null });
    return json({});
}

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });

    let failures = 0;
    const check = (label, ok, extra) => {
        if (!ok) { failures++; console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); } else console.log('  ✓ ' + label);
    };

    const openDash = async () => {
        const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.route('**/api/**', (r) => api(r));
        await page.route('https://cdn.tailwindcss.com**', (r) => r.fulfill({
            contentType: 'text/javascript',
            body: `document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(TAILWIND)};document.head.appendChild(s);});`,
        }));
        await page.route('https://unpkg.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.lucide={createIcons(){}};' }));
        await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
        await page.addInitScript(() => localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Owner', role: 'owner' })));
        await page.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva`);
        await page.waitForTimeout(1600);
        return { page, errors };
    };

    const openShop = async (page) => {
        await page.evaluate(() => openShop());
        await page.waitForSelector('#crewShop:not(.cp-hidden)', { timeout: 5000 });
        await page.waitForTimeout(700);
    };

    // A held press, done the way a finger does it.
    const hold = async (page, ms) => {
        const btn = await page.$('[data-sh-hold]');
        const box = await btn.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(ms);
        await page.mouse.up();
        await page.waitForTimeout(500);
    };

    // ---- 1. A VA that does not run one --------------------------------------
    console.log('\nNo shop');
    state = freshState(); state.shopOn = false; state.caps = [];
    {
        const { page, errors } = await openDash();
        const tiles = await page.$$eval('#toolGrid a', (els) => els.map((e) => e.textContent.trim()));
        check('a crew member with no say over it gets no Shop tile',
            !tiles.some((t) => /^Shop/.test(t)), tiles.join(' | '));
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    console.log('\nSwitching it on');
    state = freshState(); state.shopOn = false;
    {
        const { page, errors } = await openDash();
        const tiles = await page.$$eval('#toolGrid a', (els) => els.map((e) => e.textContent.trim()));
        check('whoever can turn it on can still find it', tiles.some((t) => /^Shop/.test(t)));

        await openShop(page);
        check('…and gets the one screen that does it', await page.isVisible('[data-sh-enable]'));
        await page.click('[data-sh-enable]');
        await page.waitForTimeout(600);
        check('pressing it opens the shop for the crew',
            state.settings.some((s) => s.enabled === true), JSON.stringify(state.settings));
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    // ---- 2. The shelf --------------------------------------------------------
    console.log('\nThe shelf');
    state = freshState();
    {
        const { page, errors } = await openDash();
        await openShop(page);
        check('the pilot’s own balance is on the card',
            (await page.textContent('.sh-card-balance b')).trim() === '4,820');
        check('the airline is on the front of it',
            (await page.textContent('.sh-card-airline')).trim() === 'Test VA');
        check('something they can afford offers to sell it', await page.isVisible('[data-sh-buy="i1"]'));
        check('something they cannot says how short they are',
            !(await page.isVisible('[data-sh-buy="i2"]'))
            && /1,380 mi short/.test(await page.textContent('.sh-grid')));
        check('something that has run out says so, and does not offer',
            !(await page.isVisible('[data-sh-buy="i3"]'))
            && /Sold out/.test(await page.textContent('.sh-grid')));
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    // ---- 3. Inflight Pay -----------------------------------------------------
    console.log('\nInflight Pay');
    state = freshState();
    {
        const { page, errors } = await openDash();
        await openShop(page);
        await page.click('[data-sh-buy="i1"]');
        await page.waitForSelector('.sh-pay', { timeout: 4000 });
        check('the sheet says what is being bought and for how much',
            /A320 Retro livery/.test(await page.textContent('.sh-pay-card'))
            && /1,500/.test(await page.textContent('.sh-pay-amount')));
        check('…and what is left afterwards, before anything is spent',
            /3,320 mi left/.test(await page.textContent('.sh-pay-after')));

        // A CLICK IS NOT A PURCHASE.
        await page.click('[data-sh-hold]');
        await page.waitForTimeout(400);
        check('a click spends nothing', state.orders.length === 0, JSON.stringify(state.orders));

        // NEITHER IS LETTING GO HALFWAY.
        await hold(page, 250);
        check('letting go halfway spends nothing', state.orders.length === 0, JSON.stringify(state.orders));
        check('…and the sheet is still open, still offering', await page.isVisible('[data-sh-hold]'));

        // HOLDING IT DOES.
        await hold(page, 1100);
        check('holding it pays', state.orders.length === 1, JSON.stringify(state.orders));
        check('…for the thing that was on the sheet',
            state.orders[0] && state.orders[0].itemId === 'i1');
        check('…and shows the receipt', await page.isVisible('.sh-tick'));
        check('…with the code the pilot collects it with',
            /TST-4XB2/.test(await page.textContent('.sh-pay-card')));
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    console.log('\nAfter it has gone through');
    state = freshState();
    {
        const { page, errors } = await openDash();
        await openShop(page);
        await page.click('[data-sh-buy="i1"]');
        await page.waitForSelector('.sh-pay', { timeout: 4000 });
        await page.waitForTimeout(500);          // it rises into place first
        await hold(page, 1100);
        // The mock answers 1234 rather than 4820 - 1500. A page doing its own
        // arithmetic would show 3,320 and be wrong about the one number that
        // matters.
        check('the new balance is the server’s answer, not our subtraction',
            /1,234/.test(await page.textContent('.sh-pay-card')), await page.textContent('.sh-done-title'));
        await page.click('[data-sh-paydone]');
        await page.waitForTimeout(400);
        check('the sheet closes on Done', !(await page.isVisible('.sh-pay')));
        check('…and the card behind it has caught up',
            (await page.textContent('.sh-card-balance b')).trim() === '1,234');
        check('one press is one order', state.orders.length === 1, JSON.stringify(state.orders));
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    // ---- 4. The back office --------------------------------------------------
    console.log('\nRunning it');
    state = freshState();
    {
        const { page, errors } = await openDash();
        await openShop(page);
        await page.click('[data-sh-view="manage"]');
        await page.waitForTimeout(400);
        check('the rate is one screen with the shelf',
            await page.isVisible('[data-sh-rate="perHour"]') && await page.isVisible('[data-sh-additem]'));
        const before = await page.textContent('.sh-example');
        check('…explained with a flight somebody has actually flown',
            /2h 15m/.test(before) && /325 mi/.test(before), before);

        await page.fill('[data-sh-rate="perHour"]', '200');
        await page.waitForTimeout(200);
        const after = await page.textContent('.sh-example');
        check('…which keeps up as the rate is typed', /505 mi/.test(after), after);

        await page.click('[data-sh-saverates]');
        await page.waitForTimeout(600);
        const saved = state.settings[state.settings.length - 1] || {};
        check('saving sends the rate and what the VA calls it',
            saved.earn && saved.earn.perHour === 200 && saved.currency && saved.currency.short === 'mi',
            JSON.stringify(saved));

        await page.click('[data-sh-additem]');
        await page.waitForTimeout(300);
        check('adding something is a form, not another panel', await page.isVisible('[data-sh-f="name"]'));

        /* THE ICON. It has always been in the item model and drawn on every
           tile that has no picture, and there has never been a way to set it. */
        check('a tile’s icon can be chosen', await page.isVisible('[data-sh-icon="plane"]'));
        await page.click('[data-sh-icon="plane"]');
        await page.waitForTimeout(150);
        check('…and the chosen one is the one marked',
            await page.getAttribute('[data-sh-icon="plane"]', 'aria-pressed') === 'true'
            && await page.getAttribute('[data-sh-icon="gift"]', 'aria-pressed') === 'false');
        await page.fill('[data-sh-f="name"]', 'Jumpseat ride');
        await page.fill('[data-sh-f="price"]', '400');
        await page.click('[data-sh-saveitem]');
        await page.waitForTimeout(600);
        const typed = state.added[state.added.length - 1] || {};
        check('…and it is saved with the item',
            typed.name === 'Jumpseat ride' && typed.icon === 'plane', JSON.stringify(typed));

        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    /* ---- 5. The blank shelf ------------------------------------------------
     *
     * The form has always been the easy half. What stops a VA is that there is
     * no warehouse and nothing ships, so "what does a virtual airline even
     * sell" is a blank page — and a shop nobody stocks is a feature nobody
     * uses. The catalogue is the answer to that question, priced in this
     * airline's own currency. */
    console.log('\nThings you could sell');
    state = freshState();
    {
        const { page, errors } = await openDash();
        await openShop(page);
        await page.click('[data-sh-view="manage"]');
        await page.waitForTimeout(400);

        check('a VA with an empty shelf is given things to put on it',
            (await page.$$('[data-sh-suggest]')).length >= 4);
        check('…grouped, so they read as a few short lists rather than one long one',
            (await page.$$('.sh-sug-group')).length >= 2);
        check('…priced in this airline’s own currency',
            /2,?900 mi/.test(await page.textContent('[data-sh-suggest="callsign"]')),
            await page.textContent('[data-sh-suggest="callsign"]'));

        /* One of them is already on the shelf under the same name. It stays
           where it is, marked and unpressable — a grid that drops a tile every
           time you tap one moves the rest under your finger. */
        check('one already on the shelf is not offered again',
            await page.getAttribute('[data-sh-suggest="livery"]', 'disabled') !== null);
        check('…and says so where its price was',
            /on the shelf/i.test(await page.textContent('[data-sh-suggest="livery"]')));
        check('…while the others are still pressable',
            await page.getAttribute('[data-sh-suggest="callsign"]', 'disabled') === null);

        await page.click('[data-sh-suggest="lead"]');
        await page.waitForTimeout(700);
        const sent = state.added[state.added.length - 1] || {};
        check('tapping one puts it on the shelf, whole',
            sent.name === 'Lead the next group flight' && sent.price === 5400
            && sent.icon === 'users', JSON.stringify(sent));
        check('…carrying the scarcity that was the point of it',
            sent.stock === 1 && sent.limitPerPilot === 1, JSON.stringify(sent));
        check('…and nothing that says it came from a catalogue',
            sent.id === undefined && sent.group === undefined, JSON.stringify(sent));

        /* Every price here is worked out from the rates. The one moment a VA is
           certain to read them is right after changing the rate that decides
           them, so they cannot still be the old ones. */
        await page.fill('[data-sh-rate="perHour"]', '240');
        await page.click('[data-sh-saverates]');
        await page.waitForTimeout(700);
        check('changing the rate reprices what is on offer',
            /5,?800 mi/.test(await page.textContent('[data-sh-suggest="callsign"]')),
            await page.textContent('[data-sh-suggest="callsign"]'));

        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    // ---- 6. A database that predates the shop --------------------------------
    console.log('\nAn out-of-date database');
    state = freshState(); state.missing = true;
    {
        const { page, errors } = await openDash();
        await openShop(page);
        const text = await page.textContent('#crewShop .cp-body');
        check('is told what is wrong', /database/i.test(text), text.slice(0, 90));
        check('…and given the button that fixes it', await page.isVisible('[data-cp-fix-store]'));
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    await browser.close();
    server.close();
    console.log(failures ? `\n${failures} check(s) failed\n` : '\nAll checks passed\n');
    process.exit(failures ? 1 : 0);
})();
