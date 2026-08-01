// test-va-event-map.js — the VA event pins on the live map.
//
// Exercises the marker/window/filter logic out of flight.js against a DOM,
// without booting the whole map: the pieces under test are the marker markup,
// the event window, and the airline filter, none of which need Mapbox.
//
//   * the pin carries the event banner, capped so one VA's artwork cannot make
//     its pin twice everybody else's size
//   * pin size is fixed in px and never derived from zoom
//   * clicking opens the flight-info-style window, not a map popup
//   * the window shows the banner, the gate board state and the crew-centre link
//   * the airline filter hides other VAs, persists, and "empty means all"
//
// Run:  node tools/test-va-event-map.js
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

// Pull a named function's source out of flight.js so it can be exercised in
// isolation. Crude, but the alternative is booting a 27k-line map module.
function slice(startMarker, endMarker) {
    const a = SRC.indexOf(startMarker);
    assert.ok(a >= 0, `missing: ${startMarker}`);
    const b = SRC.indexOf(endMarker, a);
    assert.ok(b > a, `missing end: ${endMarker}`);
    return SRC.slice(a, b);
}

/* ------------------------------------------------------------------ */
head('The pin');

const styles = slice('function injectVaEventMarkerStyles', 'function clearVaEventMarkers');

ok('the banner is rendered above the pill', () => {
    const marker = slice('const live = isVaEventLive(ev.startsAt);', 'const marker = new mapboxgl.Marker');
    const bannerAt = marker.indexOf('va-event-marker-banner');
    const innerAt = marker.indexOf('va-event-marker-inner');
    assert.ok(bannerAt > 0 && innerAt > 0, 'both parts present');
    assert.ok(bannerAt < innerAt, 'banner must come before the pill');
});

ok('the banner is cropped to a fixed height', () => {
    assert.match(styles, /\.va-event-marker-banner\s*\{[^}]*height:\s*46px/);
    assert.match(styles, /\.va-event-marker-banner\s*\{[^}]*object-fit:\s*cover/);
});

ok('the card has a hard pixel width', () => {
    assert.match(styles, /\.va-event-marker-card\s*\{[^}]*width:\s*132px/);
});

ok('no marker dimension is derived from zoom', () => {
    // Anything responsive to zoom would have to come through a variable or a
    // calc referencing one; the pin must be pure px.
    const block = styles.match(/\.va-event-marker[\s\S]*?\.va-event-marker-gates\s*\{[^}]*\}/)[0];
    assert.ok(!/zoom/i.test(block), 'no zoom reference');
    assert.ok(!/vw|vh/.test(block), 'no viewport units in the pin');
});

ok('a dead banner URL removes only the image', () => {
    const marker = slice('const live = isVaEventLive(ev.startsAt);', 'const marker = new mapboxgl.Marker');
    assert.match(marker, /class="va-event-marker-banner"[^>]*onerror="this\.remove\(\)"/);
});

ok('an open gate board is flagged on the pin', () => {
    const marker = slice('const live = isVaEventLive(ev.startsAt);', 'const marker = new mapboxgl.Marker');
    assert.match(marker, /ev\.gates && ev\.gates\.open && !ev\.gates\.locked/);
    assert.match(marker, /va-event-marker-gates/);
});

/* ------------------------------------------------------------------ */
head('Not a map popup any more');

ok('the marker no longer gets a mapboxgl.Popup', () => {
    const render = slice('function renderVaEventMarkers', 'window.renderVaEventMarkers');
    assert.ok(!/new mapboxgl\.Popup/.test(render), 'Popup should be gone from the event markers');
    assert.ok(!/\.setPopup\(/.test(render), 'setPopup should be gone');
});

ok('clicking a pin opens the event window instead', () => {
    const marker = slice('const live = isVaEventLive(ev.startsAt);', 'const marker = new mapboxgl.Marker');
    assert.match(marker, /addEventListener\('click'/);
    assert.match(marker, /openVaEventWindow\(ev, icao\)/);
});

ok('the window reuses the info-window chrome', () => {
    const win = slice('function ensureVaEventWindow', 'function closeVaEventWindow');
    assert.match(win, /className\s*=\s*'info-window'/);
});

ok('…so it inherits the existing mobile sheet rule', () => {
    // .info-window already has a phone rule in the main stylesheet; the event
    // window must not re-implement one.
    const evStyles = SRC.slice(SRC.indexOf('#va-event-window .vew-banner'), SRC.indexOf('.vaef-list'));
    assert.ok(!/@media/.test(evStyles), 'event window should carry no media query of its own');
});

/* ------------------------------------------------------------------ */
head('What the window shows');

const winFn = slice('function openVaEventWindow', 'window.openVaEventWindow');

ok('the banner, full width', () => assert.match(winFn, /class="vew-banner"/));
ok('the airline, with its logo', () => assert.match(winFn, /vew-va[\s\S]*ev\.va\.logo/));
ok('an open gate board is called out', () => assert.match(winFn, /Stands open/));
ok('…and a locked one distinguished', () => assert.match(winFn, /Stands locked/));
ok('a live event reads differently from a soon one', () => assert.match(winFn, /Under way/));
ok('the route is shown when there is one', () => assert.match(winFn, /ev\.arrivalIcao/));
ok('a crew-centre event links into the crew centre', () => assert.match(winFn, /Open in crew centre/));
ok('Watch live still reaches group watch', () => assert.match(winFn, /enterGroupWatch\(data\)/));
ok('everything user-supplied is escaped', () => {
    assert.match(winFn, /esc\(ev\.title\)/);
    assert.match(winFn, /esc\(ev\.bannerUrl\)/);
    assert.match(winFn, /esc\(ev\.description\)/);
});

/* ------------------------------------------------------------------ */
head('Choosing which airlines');

// Exercise the filter for real, with a fake localStorage.
const store = {};
global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
};
const filterSrc = slice('var vaEventVaFilterSet = null;', 'function renderVaEventVaPicker');
const sandbox = {};
// eslint-disable-next-line no-new-func
new Function('localStorage', `${filterSrc};
    this.load = () => { vaEventVaFilterSet = null; return getVaEventVaFilter(); };
    this.set = setVaEventVaFilter;
    this.passes = vaEventPassesFilter;`).call(sandbox, global.localStorage);

const evOf = (id) => ({ va: { id } });

ok('an empty filter means every airline', () => {
    sandbox.set(new Set());
    assert.strictEqual(sandbox.passes(evOf('a')), true);
    assert.strictEqual(sandbox.passes(evOf('b')), true);
});

ok('a chosen set hides the others', () => {
    sandbox.set(new Set(['a']));
    assert.strictEqual(sandbox.passes(evOf('a')), true);
    assert.strictEqual(sandbox.passes(evOf('b')), false);
});

ok('the choice persists', () => {
    sandbox.set(new Set(['a', 'c']));
    const reloaded = sandbox.load();
    assert.deepStrictEqual([...reloaded].sort(), ['a', 'c']);
});

ok('a corrupt stored value falls back to "all" rather than throwing', () => {
    store['inflight:vaEventVaFilter'] = 'not json';
    assert.strictEqual(sandbox.load().size, 0);
});

ok('"None" is a real choice, not the same as unset', () => {
    sandbox.set(new Set(['__none__']));
    assert.strictEqual(sandbox.passes(evOf('a')), false);
});

ok('the picker checkboxes are excluded from the mobile settings handler', () => {
    const mobile = fs.readFileSync(path.join(__dirname, '..', 'MobileSettingsUI.js'), 'utf8');
    assert.match(mobile, /:not\(\.vaef-check\)/);
    assert.match(SRC, /class="vaef-check"/);
});

ok('mobile and desktop paint the same picker', () => {
    const mobile = fs.readFileSync(path.join(__dirname, '..', 'MobileSettingsUI.js'), 'utf8');
    assert.match(mobile, /window\.renderVaEventVaPicker\(host\)/);
    assert.match(SRC, /renderVaEventVaPicker\(vaEventPickerHost\)/);
    assert.match(SRC, /window\.renderVaEventVaPicker = renderVaEventVaPicker/);
});

ok('the filter is applied before a pin is placed', () => {
    const render = slice('function renderVaEventMarkers', 'window.renderVaEventMarkers');
    assert.match(render, /if \(!vaEventPassesFilter\(ev\)\) continue;/);
});

console.log(`\n${process.exitCode ? 'FAILURES above. ' : ''}${pass} checks passed.`);
