/**
 * pilotAchievements.js — career achievement derivation.
 *
 * Pure data in, pure data out: no DOM, no network, no Supabase. Everything is
 * derived from the `_lifetime` ledger and the Infinite Flight stats both
 * ProfileUI (desktop) and MobileDashboardUI (mobile) already compute, so adding
 * achievements costs no extra requests and can't fail independently of the
 * dossier itself.
 *
 * Both UIs build an identical `_lifetime` shape (ProfileUI._recomputeLifetime /
 * MobileDashboardUI._recomputeLifetime), which is what lets one module serve
 * both. Fields consumed here:
 *
 *   lifetime.totalMin        total minutes flown
 *   lifetime.totalLandings   lifetime landings
 *   lifetime.totalDist       nautical miles (0 unless haveDistance)
 *   lifetime.haveDistance    whether airport coords resolved far enough to trust totalDist
 *   lifetime.uniqueAirports  distinct ICAOs touched
 *   lifetime.continents      distinct continents touched
 *   lifetime.fleet[]         per-aircraft records, one entry per distinct type
 *   lifetime.longest         { min, dep, arr } single longest flight
 *   lifetime.total           total flights (falls back to scanned)
 *
 *   stats.totalXP, stats.violations, stats.landingCount,
 *   stats.gradeDetails.gradeIndex
 */

// Earth's circumference at the equator, in nautical miles. Used for the
// "trips around the world" distance tiers.
export const EARTH_CIRCUMFERENCE_NM = 21639;

/**
 * Achievement definitions.
 *
 * Each entry produces one tiered achievement track. `value(ctx)` returns the
 * pilot's current figure, or null when the underlying data isn't available
 * (e.g. distance before airport coords resolve) — a null value marks the whole
 * track as indeterminate rather than showing a misleading 0.
 *
 * `tiers` are ascending thresholds; the pilot earns every tier at or below
 * their value. Keeping them ascending is a hard requirement — `deriveTrack()`
 * relies on it to find the next target.
 */
const DEFINITIONS = [
    {
        id: 'hours',
        category: 'Experience',
        icon: 'fa-clock',
        name: 'Flight Hours',
        unit: 'h',
        value: ctx => (ctx.lifetime ? ctx.lifetime.totalMin / 60 : null),
        tiers: [10, 50, 100, 500, 1000],
        labels: ['First Officer', 'Captain', 'Senior Captain', 'Line Check Airman', 'Chief Pilot'],
        blurb: n => `Log ${fmt(n)} hours of flight time`,
    },
    {
        id: 'flights',
        category: 'Experience',
        icon: 'fa-plane-departure',
        name: 'Flights Flown',
        unit: '',
        value: ctx => (ctx.totalFlights != null ? ctx.totalFlights : null),
        tiers: [10, 50, 100, 500, 1000],
        labels: ['Getting Airborne', 'Regular', 'Centurion', 'Veteran', 'Legend'],
        blurb: n => `Complete ${fmt(n)} flights`,
    },
    {
        id: 'landings',
        category: 'Handling',
        icon: 'fa-plane-arrival',
        name: 'Landings',
        unit: '',
        value: ctx => (ctx.lifetime ? ctx.lifetime.totalLandings : null),
        tiers: [50, 250, 1000, 5000],
        labels: ['Greaser', 'Polished', 'Butter Merchant', 'Touchdown Master'],
        blurb: n => `Record ${fmt(n)} landings`,
    },
    {
        id: 'distance',
        category: 'Navigation',
        icon: 'fa-route',
        name: 'Distance Flown',
        unit: 'nm',
        // Only meaningful once enough airport coords have resolved; otherwise the
        // ledger reports 0 and the track would read as "no progress" incorrectly.
        value: ctx => (ctx.lifetime && ctx.lifetime.haveDistance ? ctx.lifetime.totalDist : null),
        tiers: [5000, 25000, EARTH_CIRCUMFERENCE_NM * 2, EARTH_CIRCUMFERENCE_NM * 5, EARTH_CIRCUMFERENCE_NM * 10],
        labels: ['Regional', 'Continental', 'Twice Around', 'Five Times Around', 'Ten Times Around'],
        blurb: n => `Fly ${fmt(n)} nautical miles`,
    },
    {
        id: 'airports',
        category: 'Navigation',
        icon: 'fa-tower-control',
        name: 'Airports Visited',
        unit: '',
        value: ctx => (ctx.lifetime ? ctx.lifetime.uniqueAirports : null),
        tiers: [10, 50, 150, 400],
        labels: ['Explorer', 'Globetrotter', 'Route Builder', 'Atlas'],
        blurb: n => `Touch ${fmt(n)} distinct airports`,
    },
    {
        id: 'continents',
        category: 'Navigation',
        icon: 'fa-earth-americas',
        name: 'Continents',
        unit: '',
        value: ctx => (ctx.lifetime ? ctx.lifetime.continents : null),
        tiers: [2, 4, 6, 7],
        labels: ['Crossing Over', 'Wide Body', 'Six Down', 'Every Continent'],
        blurb: n => `Fly to or from ${fmt(n)} continents`,
    },
    {
        id: 'fleet',
        category: 'Fleet',
        icon: 'fa-plane-up',
        name: 'Type Ratings',
        unit: '',
        value: ctx => (ctx.lifetime && Array.isArray(ctx.lifetime.fleet) ? ctx.lifetime.fleet.length : null),
        tiers: [3, 10, 20, 35],
        labels: ['Dual Rated', 'Multi Type', 'Fleet Manager', 'Rated On Everything'],
        blurb: n => `Fly ${fmt(n)} distinct aircraft types`,
    },
    {
        id: 'longhaul',
        category: 'Endurance',
        icon: 'fa-moon',
        name: 'Longest Flight',
        unit: 'h',
        value: ctx => (ctx.lifetime && ctx.lifetime.longest ? ctx.lifetime.longest.min / 60 : null),
        tiers: [3, 6, 10, 14],
        labels: ['Medium Haul', 'Long Haul', 'Ultra Long Haul', 'Endurance Record'],
        blurb: n => `Complete a single flight of ${fmt(n)} hours`,
    },
    {
        id: 'xp',
        category: 'Experience',
        icon: 'fa-star',
        name: 'Total XP',
        unit: '',
        value: ctx => (ctx.stats && typeof ctx.stats.totalXP === 'number' ? ctx.stats.totalXP : null),
        tiers: [10000, 100000, 500000, 1000000],
        labels: ['Building Up', 'Six Figures', 'Half a Million', 'Millionaire'],
        blurb: n => `Earn ${fmt(n)} XP`,
    },
];

/** Compact number formatting for thresholds: 1000 -> 1,000 and 21639 -> 21,639. */
function fmt(n) {
    return Math.round(n).toLocaleString();
}

/**
 * Safety is derived rather than tiered on a raw count: it's the share of
 * landings not accompanied by a violation. Pilots with no landings yet have no
 * meaningful ratio, so it reports null instead of a flattering 100%.
 */
export function computeSafetyIndex(ctx) {
    const landings = ctx.lifetime ? ctx.lifetime.totalLandings : (ctx.stats && ctx.stats.landingCount) || 0;
    const violations = (ctx.stats && ctx.stats.violations) || 0;
    if (!landings) return null;
    const pct = Math.max(0, ((landings - violations) / landings) * 100);
    return Math.min(100, pct);
}

/**
 * Expand one definition into a track: which tiers are earned, what's next, and
 * how far along the pilot is toward it.
 */
function deriveTrack(def, ctx) {
    const raw = def.value(ctx);
    const known = typeof raw === 'number' && isFinite(raw);
    const value = known ? raw : 0;

    let earnedCount = 0;
    for (const t of def.tiers) {
        if (value >= t) earnedCount++;
        else break;
    }

    const complete = earnedCount >= def.tiers.length;
    const nextTarget = complete ? null : def.tiers[earnedCount];
    const prevTarget = earnedCount > 0 ? def.tiers[earnedCount - 1] : 0;

    // Progress is measured across the current tier band, not from zero, so a
    // pilot at 900/1000 hours doesn't show the same bar as one at 100/1000.
    let progress = 0;
    if (complete) progress = 1;
    else if (known && nextTarget > prevTarget) {
        progress = Math.max(0, Math.min(1, (value - prevTarget) / (nextTarget - prevTarget)));
    }

    return {
        id: def.id,
        category: def.category,
        icon: def.icon,
        name: def.name,
        unit: def.unit,
        known,
        value,
        earnedCount,
        totalTiers: def.tiers.length,
        complete,
        nextTarget,
        // Title of the highest tier reached, or null before the first.
        currentLabel: earnedCount > 0 ? def.labels[earnedCount - 1] : null,
        nextLabel: complete ? null : def.labels[earnedCount],
        nextBlurb: complete ? null : def.blurb(nextTarget),
        progress,
    };
}

/**
 * Build the full achievement set.
 *
 * @param {object} ctx
 * @param {object|null} ctx.lifetime      the `_lifetime` ledger, or null before it's computed
 * @param {object|null} ctx.stats         Infinite Flight stats block
 * @param {number|null} ctx.totalFlights  total flights (logbookTotal), independent of the scan depth
 * @returns {{tracks: Array, earnedTiers: number, totalTiers: number, completedTracks: number,
 *            nextUp: Array, safety: number|null, hasData: boolean}}
 */
export function computeAchievements(ctx = {}) {
    const safeCtx = {
        lifetime: ctx.lifetime || null,
        stats: ctx.stats || null,
        totalFlights: typeof ctx.totalFlights === 'number' ? ctx.totalFlights : null,
    };

    const tracks = DEFINITIONS.map(def => deriveTrack(def, safeCtx));

    const earnedTiers = tracks.reduce((s, t) => s + t.earnedCount, 0);
    const totalTiers = tracks.reduce((s, t) => s + t.totalTiers, 0);
    const completedTracks = tracks.filter(t => t.complete).length;

    // "Next up" surfaces the three closest unfinished tracks, so the dossier can
    // show something actionable rather than a wall of locked badges. Tracks whose
    // data hasn't resolved are excluded — suggesting a goal we can't measure is
    // worse than showing nothing.
    const nextUp = tracks
        .filter(t => !t.complete && t.known)
        .sort((a, b) => b.progress - a.progress)
        .slice(0, 3);

    return {
        tracks,
        earnedTiers,
        totalTiers,
        completedTracks,
        nextUp,
        safety: computeSafetyIndex(safeCtx),
        hasData: !!safeCtx.lifetime,
    };
}

/** Exposed for tests and for UIs that want to render a single track. */
export const ACHIEVEMENT_DEFINITIONS = DEFINITIONS;
