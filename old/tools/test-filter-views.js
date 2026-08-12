// test-filter-views.js — saved filter views on the tactical board.
//
// The board can express a dozen rules at once and Reset was the only one-tap
// control, so a combination you use every session had to be rebuilt by hand.
// A view is a named snapshot of that state.
//
// The property that matters, and the one a reader cannot verify by eye, is that
// a view captures EXACTLY the state Reset clears. If the two sets ever drift,
// "save, reset, apply" silently stops round-tripping: something you had set is
// cleared by Reset and never restored, and the view looks like it half-worked.
// That is asserted here against the real resetTacticalFilters source.
//
// Node builtins only — no browser, no install step. MobileSettingsUI is an ES
// module that touches `window` only inside its methods, so it imports cleanly
// and the view logic can be called directly against a stub mapFilters.
//
// Run:  node tools/test-filter-views.js
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

// Minimal localStorage; the module only ever getItem/setItem's one key.
const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};
globalThis.window = globalThis.window || {};
globalThis.document = { getElementById: () => null, querySelectorAll: () => [] };
window.localStorage = globalThis.localStorage;

(async () => {
    const { MobileSettingsUI: UI } = await import(
        pathToFileURL(path.join(ROOT, 'MobileSettingsUI.js')).href);

    // renderFilterViews touches the DOM; the logic under test does not. Stub it
    // so applyFilterView can be exercised headlessly.
    UI.renderFilterViews = () => {};
    UI.syncTacticalControls = () => {};
    UI.updateFilterBadge = () => {};

    const setFilters = (f) => { window.mapFilters = f; };

    // ------------------------------------------------------------------
    head('Capturing the current filters');
    setFilters({
        tactical: { type: 'A380', altitude: { min: 30000, max: '' } },
        tacticalExclude: { type: false },
        airborneOnly: true, onGroundOnly: false, hasPlanOnly: false,
        vaFilterId: null,
        mapStyle: 'dark',              // not a filter — must not be captured
    });
    const snap = UI.captureFilterState();
    ok('it captures the tactical rules', snap.tactical.type === 'A380');
    ok('it captures the quick toggles', snap.airborneOnly === true && snap.hasPlanOnly === false);
    ok('it captures the VA focus slot', 'vaFilterId' in snap);
    ok('it ignores settings that are not filters', !('mapStyle' in snap));

    // A view must not move when the live filters do afterwards.
    window.mapFilters.tactical.type = 'B738';
    ok('the snapshot is a copy, not a live reference', snap.tactical.type === 'A380');

    // ------------------------------------------------------------------
    head('Knowing when there is nothing to save');
    ok('empty filters are empty', UI.filterStateIsEmpty({ tactical: {}, tacticalExclude: {} }));
    ok('blank strings do not count as a rule',
        UI.filterStateIsEmpty({ tactical: { type: '', livery: '' }, tacticalExclude: {} }));
    ok('an empty range does not count as a rule',
        UI.filterStateIsEmpty({ tactical: { altitude: { min: '', max: '' } }, tacticalExclude: {} }));
    ok('a real rule counts',
        !UI.filterStateIsEmpty({ tactical: { type: 'A320' }, tacticalExclude: {} }));
    ok('a half-open range counts',
        !UI.filterStateIsEmpty({ tactical: { speed: { min: 250, max: '' } }, tacticalExclude: {} }));
    ok('a quick toggle alone counts',
        !UI.filterStateIsEmpty({ tactical: {}, tacticalExclude: {}, airborneOnly: true }));
    ok('a VA focus alone counts',
        !UI.filterStateIsEmpty({ tactical: {}, tacticalExclude: {}, vaFilterId: 'va_1' }));
    ok('nothing at all is empty', UI.filterStateIsEmpty(null));

    // ------------------------------------------------------------------
    head('Describing a view');
    const describe = (t, extra = {}) => UI.describeFilterState(
        { tactical: t, tacticalExclude: extra.excl || {}, ...extra });
    ok('it names the rules', describe({ type: 'A380', livery: 'Emirates' }) === 'A380 · Emirates');
    ok('a closed band reads as a range',
        describe({ altitude: { min: 30000, max: 40000 } }) === '30000–40000 ft');
    ok('an open-topped band reads as "above"',
        describe({ altitude: { min: 30000, max: '' } }) === 'above 30000 ft');
    ok('an open-bottomed band reads as "below"',
        describe({ speed: { min: '', max: 250 } }) === 'below 250 kt');
    ok('a Hide rule says so',
        describe({ type: 'A320' }, { excl: { type: true } }) === 'not A320');
    ok('a proximity radius is described',
        describe({ airportRadius: { icao: 'EGLL', radiusNm: 40 } }) === '40 NM of EGLL');
    ok('quick toggles are described',
        describe({}, { airborneOnly: true, hasPlanOnly: true }) === 'airborne · has a plan');
    ok('"All Countries" is not a rule', describe({ country: 'All Countries' }) === 'No rules');
    ok('an empty view says so', describe({}) === 'No rules');

    // ------------------------------------------------------------------
    head('Naming a new view');
    ok('a name is suggested from the rules',
        UI.suggestViewName({ tactical: { type: 'A380', livery: 'Emirates' }, tacticalExclude: {} })
            === 'A380 · Emirates');
    ok('the suggestion is capped in length',
        UI.suggestViewName({ tactical: { type: 'x'.repeat(80) }, tacticalExclude: {} }).length <= 34);
    ok('an empty state still gets a usable name',
        UI.suggestViewName({ tactical: {}, tacticalExclude: {} }) === 'My view');

    // ------------------------------------------------------------------
    head('Storage');
    store.clear();
    ok('no views to start with', UI.loadFilterViews().length === 0);
    UI.saveFilterViews([{ name: 'Heavies', state: snap }]);
    ok('a saved view comes back', UI.loadFilterViews()[0].name === 'Heavies');

    UI.saveFilterViews(Array.from({ length: 40 }, (_, i) => ({ name: 'v' + i, state: snap })));
    ok('the list is capped', UI.loadFilterViews().length === UI._VIEWS_MAX, String(UI.loadFilterViews().length));

    store.set(UI._VIEWS_KEY, 'not json at all');
    ok('corrupt storage reads as empty rather than throwing', UI.loadFilterViews().length === 0);
    store.set(UI._VIEWS_KEY, JSON.stringify([{ name: 'ok', state: {} }, { junk: true }, null, 'x']));
    ok('malformed entries are dropped', UI.loadFilterViews().length === 1);

    // ------------------------------------------------------------------
    head('Applying a view');
    {
        let vaSetTo = 'untouched';
        window.setVaFilter = (id) => { vaSetTo = id; };
        let mapUpdated = false; let persisted = false;
        window.updateMapFilters = () => { mapUpdated = true; };
        window.saveFiltersToLocalStorage = () => { persisted = true; };

        setFilters({
            tactical: { livery: 'Ryanair' }, tacticalExclude: { livery: true },
            airborneOnly: false, onGroundOnly: true, hasPlanOnly: true, vaFilterId: 'va_old',
        });
        const view = {
            name: 'Heavies over the Atlantic',
            state: {
                tactical: { type: 'B777', altitude: { min: 30000, max: '' } },
                tacticalExclude: {},
                airborneOnly: true, onGroundOnly: false, hasPlanOnly: false,
                vaFilterId: null,
            },
        };
        UI.applyFilterView(view);

        ok('the rules are replaced, not merged',
            window.mapFilters.tactical.type === 'B777' && !('livery' in window.mapFilters.tactical),
            JSON.stringify(window.mapFilters.tactical));
        ok('the Show/Hide flags are replaced too',
            Object.keys(window.mapFilters.tacticalExclude).length === 0);
        ok('the quick toggles are replaced',
            window.mapFilters.airborneOnly === true
            && window.mapFilters.onGroundOnly === false
            && window.mapFilters.hasPlanOnly === false);
        ok('the VA focus goes through setVaFilter', vaSetTo === null, String(vaSetTo));
        ok('the map is re-filtered', mapUpdated);
        ok('the choice is persisted', persisted);

        // Applying must not hand the live filters the stored object itself, or
        // editing a rule afterwards would silently rewrite the saved view.
        window.mapFilters.tactical.type = 'A320';
        ok('the stored view is not mutated by later edits', view.state.tactical.type === 'B777');
    }

    // ------------------------------------------------------------------
    head('A view captures exactly what Reset clears');
    {
        // The real risk: someone adds a filter to the board and wires it into
        // Reset but not into captureFilterState. "Save, reset, apply" then
        // silently loses it. Compare the two against the source.
        const src = fs.readFileSync(path.join(ROOT, 'MobileSettingsUI.js'), 'utf8');
        const resetSrc = src.slice(src.indexOf('resetTacticalFilters(root) {'));
        const resetBody = resetSrc.slice(0, resetSrc.indexOf('\n    },'));

        const captured = Object.keys(UI.captureFilterState());
        for (const key of ['tactical', 'tacticalExclude', 'airborneOnly', 'onGroundOnly', 'hasPlanOnly']) {
            ok(`Reset clears ${key}, and a view captures it`,
                resetBody.includes(key) && captured.includes(key));
        }
        ok('Reset clears the VA focus, and a view captures it',
            /setVaFilter\(null\)/.test(resetBody) && captured.includes('vaFilterId'));
    }

    // ------------------------------------------------------------------
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
