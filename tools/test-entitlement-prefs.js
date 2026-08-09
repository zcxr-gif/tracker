// test-entitlement-prefs.js — who is Pro, and what may leave the device.
//
// Two things here are worth a test because getting either wrong is expensive
// in a way a code review does not reliably catch.
//
// The first is the entitlement order. The old rule read "signed in unless
// stamped free", which meant a cancellation could not lock an account that had
// never been stamped. The new order has to put an ENDED subscription above
// profiles.is_pro — otherwise a missed webhook leaves a cancelled account
// unlocked forever, which is the whole bug — while still leaving a
// grandfathered pilot alone, because nobody who has Pro today may lose it.
//
// The second is the sync allowlist. localStorage also holds a Discord bearer
// token, a remembered email and the Pro flag itself. A sync that scooped those
// up would be a credential leak, and it would not look like one in a diff —
// it would look like one more string in a list.
//
// Node builtins only.
//
// Run:  node tools/test-entitlement-prefs.js
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');

let pass = 0; let fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log(`  ✓ ${name}`); pass++; }
    else { console.error(`  ✗ ${name}${extra ? `\n      ${extra}` : ''}`); fail++; }
};

// --- browser stubs -------------------------------------------------------
const store = new Map();
global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
};
global.window = {
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    isInflightPro: () => true
};
global.document = { addEventListener() {}, visibilityState: 'visible' };
global.CustomEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init); } };

const DAY = 24 * 60 * 60 * 1000;

/**
 * The entitlement order, as a pure function.
 *
 * Mirrors public.pro_entitlement() (supabase/sql/entitlement-and-preferences
 * .sql) and refreshProStatusFallback() in flight.js. Restated here rather than
 * imported because flight.js cannot be loaded outside a browser — so what is
 * pinned down is the RULE, and the two implementations are checked against it
 * by reading, which is the honest description of this test.
 */
function entitlement({ subscription = null, isPro = false, legacyPro = false }, now = Date.now()) {
    const GRACE_MS = 14 * DAY;
    if (subscription) {
        const end = subscription.current_period_end ?? null;
        const within = end === null || end > now;
        if (['active', 'trialing'].includes(subscription.status) && within) return 'subscription';
        if (subscription.status === 'past_due' && (end === null || end > now - GRACE_MS)) return 'grace';
        if (legacyPro) return 'legacy';
        return 'expired';
    }
    if (isPro) return 'profile';
    if (legacyPro) return 'legacy';
    return 'free';
}

(async () => {
    console.log('\nEntitlement + preference sync\n');

    /* ---------------------------------------------------------------- *
     * Who is Pro
     * ---------------------------------------------------------------- */
    {
        const isPro = (s) => !['expired', 'free', 'signed-out'].includes(s);

        ok('a live subscription is Pro',
            entitlement({ subscription: { status: 'active', current_period_end: Date.now() + 20 * DAY } }) === 'subscription');

        ok('a trial is Pro',
            entitlement({ subscription: { status: 'trialing', current_period_end: Date.now() + 5 * DAY } }) === 'subscription');

        // Cancelling at Stripe leaves status 'active' with cancel_at_period_end
        // set. The pilot paid for the rest of the month and keeps it.
        ok('cancelling keeps Pro until the paid period actually ends',
            entitlement({ subscription: { status: 'active', cancel_at_period_end: true, current_period_end: Date.now() + 3 * DAY } }) === 'subscription');

        ok('…and locks the moment that period is past',
            entitlement({ subscription: { status: 'canceled', current_period_end: Date.now() - 1 } }) === 'expired');

        // The bug this whole change exists for: profiles.is_pro left true by a
        // webhook that never arrived must NOT keep a cancelled account open.
        ok('an ended subscription outranks a stale is_pro',
            entitlement({ subscription: { status: 'canceled', current_period_end: Date.now() - DAY }, isPro: true }) === 'expired',
            'a missed webhook would leave the account unlocked forever');

        // Stripe retries a failed card for about a fortnight. Pulling the app
        // during that window punishes a payment that is about to succeed.
        ok('a failed payment keeps Pro while Stripe is still retrying',
            entitlement({ subscription: { status: 'past_due', current_period_end: Date.now() - 2 * DAY } }) === 'grace');

        ok('…but not once the retries are long over',
            entitlement({ subscription: { status: 'past_due', current_period_end: Date.now() - 30 * DAY } }) === 'expired');

        // The promise made when the rule changed: nobody who had Pro loses it.
        ok('a grandfathered account is Pro with no subscription at all',
            entitlement({ legacyPro: true }) === 'legacy');

        ok('a grandfathered account that once paid falls back, not out',
            entitlement({ subscription: { status: 'canceled', current_period_end: Date.now() - DAY }, legacyPro: true }) === 'legacy');

        ok('a manual grant is Pro',
            entitlement({ isPro: true }) === 'profile');

        // The hole that was open before: an account nobody stamped anything on.
        // Under the old rule this was Pro. It is not any more.
        ok('a plain new account is free, not Pro by omission',
            entitlement({}) === 'free',
            'the "signed in unless stamped free" rule is back');

        ok('every Pro source reads as Pro, and only those',
            ['subscription', 'grace', 'profile', 'legacy'].every(isPro) &&
            !['expired', 'free'].some(isPro));
    }

    /* ---------------------------------------------------------------- *
     * What may leave the device
     * ---------------------------------------------------------------- */
    {
        const { PreferenceSync, SYNCED_KEYS, NEVER_SYNC } =
            await import(pathToFileURL(path.join(ROOT, 'preferenceSync.js')).href);

        // The one that matters most. A bearer token in a settings blob is a
        // credential leak that looks like a feature in the diff.
        ok('the Discord bearer token is not synced',
            !SYNCED_KEYS.includes('inflight.discordPresence.token'));

        ok('no excluded key has crept onto the allowlist',
            NEVER_SYNC.every(k => !SYNCED_KEYS.includes(k)),
            NEVER_SYNC.filter(k => SYNCED_KEYS.includes(k)).join(', '));

        // Syncing the entitlement would let one device teach another that it
        // is Pro, which is the client granting itself Pro by another name.
        ok('the Pro flag is not synced',
            !SYNCED_KEYS.includes('inflight_is_pro') && !SYNCED_KEYS.includes('inflight_pro_detail'));

        // flight.js writes mapFilters to its own column. Two writers for one
        // setting is how a setting starts flickering between devices.
        ok('mapFilters is left to its existing owner',
            !SYNCED_KEYS.includes('mapFilters'));

        ok('nothing appears on the allowlist twice',
            new Set(SYNCED_KEYS).size === SYNCED_KEYS.length);

        // ── snapshot / apply ──
        store.clear();
        localStorage.setItem('pui-theme', 'dark');
        localStorage.setItem('inflightFuelUnit', 'kg');
        localStorage.setItem('inflight.discordPresence.token', 'super-secret');
        localStorage.setItem('inflight_is_pro', 'true');

        const snap = PreferenceSync.snapshot();
        ok('a snapshot carries the allowlisted settings',
            snap['pui-theme'] === 'dark' && snap['inflightFuelUnit'] === 'kg');
        ok('…and carries nothing else, whatever else is in storage',
            !('inflight.discordPresence.token' in snap) && !('inflight_is_pro' in snap),
            Object.keys(snap).filter(k => !SYNCED_KEYS.includes(k)).join(', '));

        // A key with no value is absent rather than present-and-null, so a
        // device that has never set a preference cannot push a null that
        // clears it on the device that has.
        ok('an unset preference is absent from the snapshot, not null',
            !('pui-accent' in snap));

        // ── applying a blob from the network ──
        store.clear();
        const applied = PreferenceSync.apply({
            'pui-theme': 'light',
            'inflightFuelUnit': 'lbs',
            // A row that somehow contained these must not be able to act on
            // them on the way in. The allowlist is enforced in both directions.
            'inflight_is_pro': 'true',
            'inflight.discordPresence.token': 'injected',
            'some_key_we_do_not_know': 'x'
        });
        ok('applying a blob writes the allowlisted keys',
            localStorage.getItem('pui-theme') === 'light' &&
            localStorage.getItem('inflightFuelUnit') === 'lbs' && applied === 2);
        ok('applying a blob cannot grant Pro or plant a token',
            localStorage.getItem('inflight_is_pro') === null &&
            localStorage.getItem('inflight.discordPresence.token') === null);
        ok('…or write a key nobody has heard of',
            localStorage.getItem('some_key_we_do_not_know') === null);

        // Re-applying the same blob is not a change, so it cannot start a
        // push-pull loop between two devices.
        ok('re-applying an unchanged blob writes nothing',
            PreferenceSync.apply({ 'pui-theme': 'light', 'inflightFuelUnit': 'lbs' }) === 0);

        // ── eligibility ──
        window.isInflightPro = () => false;
        ok('a free account is not eligible to sync', PreferenceSync.isEligible() === false);
        window.isInflightPro = () => true;
        ok('a Pro account is', PreferenceSync.isEligible() === true);
    }

    console.log(`\n${pass} passing${fail ? `, ${fail} failing` : ''}\n`);
    process.exit(fail === 0 ? 0 : 1);
})();
