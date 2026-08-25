// trafficClasses.js
// What "Cargo" means, in one place.
//
// The preset rail above the live map filters traffic by kind (MobileLandingChromeUI
// + updateAircraftLayerFilter in flight.js), and every surface that offers the
// same presets reads them from here — a pilot who taps Cargo in two places
// should be looking at the same fleet, and two copies of a list this long would
// not stay in step for a week.
//
// The evidence is thin on purpose. The recorder and the live feed both store
// the aircraft type the pilot selected in Infinite Flight and the callsign they
// typed, and nothing else about what kind of operation it is. Neither is
// authoritative — anyone can fly a 777 as "N172SP" — so this is a reading of
// the evidence rather than a lookup, and it is deliberately generous: a preset
// that quietly drops a third of its traffic is worse than one that lets a
// stray aircraft through.
//
// A flight carries EVERY class that fits. A 777F is cargo and a heavy and an
// airliner, and all three presets should find it.

export const T_AIRLINE  = 1 << 0;
export const T_HEAVY    = 1 << 1;
export const T_CARGO    = 1 << 2;
export const T_BUSINESS = 1 << 3;
export const T_GA       = 1 << 4;
export const T_MILITARY = 1 << 5;

// Matched as substrings against the uppercased aircraft type, in the order
// below: military first, because "C-130" would otherwise be read as a Cessna,
// and freighters before airliners so the -F suffix is seen.
const MIL_TYPES = [
    'F-14', 'F-15', 'F-16', 'F-18', 'F/A-18', 'F-22', 'F-35', 'A-10',
    'EUROFIGHTER', 'TYPHOON', 'SPITFIRE', 'P-38', 'MIG-', 'SU-27', 'SU-35',
    'C-130', 'C130', 'C-17', 'KC-10', 'KC-135', 'E-3', 'B-52',
    'TOMCAT', 'RAPTOR', 'HORNET', 'WARTHOG', 'THUNDERBOLT', 'FIGHTING FALCON',
    'GLOBEMASTER', 'HERCULES', 'BLACKHAWK', 'BLACK HAWK', 'APACHE', 'CHINOOK'
];
const HEAVY_TYPES = [
    'A330', 'A340', 'A350', 'A380', 'A388', 'A333', 'A339', 'A359',
    '747', 'B74', '767', 'B76', '777', 'B77', '787', 'B78',
    'MD-11', 'MD11', 'DC-10', 'C-17', 'KC-10'
];
const AIRLINE_TYPES = [
    'A220', 'A318', 'A319', 'A320', 'A321', 'A20N', 'A21N',
    '717', '737', 'B73', 'B38M', '757', 'B75', '767', 'B76',
    '777', 'B77', '787', 'B78', '747', 'B74',
    'A330', 'A340', 'A350', 'A380',
    'CRJ', 'E170', 'E175', 'E190', 'E195', 'EMBRAER 1',
    'DASH 8', 'DH8', 'Q400', 'ATR', 'MD-11', 'MD-80', 'DC-10'
];
const BIZ_TYPES = [
    'CITATION', 'PHENOM', 'LEARJET', 'GULFSTREAM', 'GLOBAL EXPRESS',
    'CHALLENGER', 'FALCON ', 'HAWKER', 'PRAETOR', 'LEGACY', 'TBM'
];
const GA_TYPES = [
    'C172', 'CESSNA 172', 'SKYHAWK', 'C152', 'C182', 'SR22', 'CIRRUS',
    'XCUB', 'X-CUB', 'CUB', 'CARAVAN', 'C208', '208B', 'SINGLEPROP',
    'DA40', 'DA62', 'PIPER', 'STEARMAN', 'BARON', 'BONANZA', 'KING AIR',
    'TBM', 'SPITFIRE', 'P-38',
    'EUROCOPTER', 'HELICOPTER', 'ROBINSON', 'R44', 'H125', 'H60', 'H64', 'LYNX'
];
// A freighter is either flown as one (the type carries an F) or flown by an
// operator that only carries boxes. Both readings are used.
const FREIGHTER_HINTS = ['FREIGHT', 'CARGO', '747-8F', '747-400F', '777F', '767-300F', '757-200F', 'MD-11F', 'BCF', 'BDSF'];
const CARGO_CALLSIGNS = [
    'FDX', 'FEDEX', 'UPS', 'GTI', 'GIANT', 'ATLAS', 'CLX', 'CARGOLUX',
    'GEC', 'BOX', 'AEROLOGIC', 'CKS', 'KALITTA', 'CJT', 'CARGOJET',
    'ABX', 'ABW', 'AIRBRIDGE', 'NCA', 'NIPPON CARGO', 'CAO', 'CKK',
    'MPH', 'MARTINAIR', 'SQC', 'BCS', 'DHL', 'DHK', 'PAC', 'POLAR',
    'TAY', 'WGN', 'WESTERN GLOBAL', 'SOO', 'SOUTHERN AIR', 'QAC', 'CV',
    'ETH CARGO', 'EK CARGO', 'UAE CARGO', 'QR CARGO', 'KE CARGO'
];

// The rail, in the order it is drawn. `all` is the reset; `mine` reads the
// pilot relation rather than the airframe, so it carries no mask.
export const TRAFFIC_PRESETS = [
    { id: 'all',      label: 'All Traffic', icon: 'fa-earth-americas' },
    { id: 'airline',  label: 'Airlines',    icon: 'fa-plane',       mask: T_AIRLINE },
    { id: 'heavy',    label: 'Heavies',     icon: 'fa-plane-up',    mask: T_HEAVY },
    { id: 'cargo',    label: 'Cargo',       icon: 'fa-box-open',    mask: T_CARGO },
    { id: 'business', label: 'Business',    icon: 'fa-briefcase',   mask: T_BUSINESS },
    { id: 'ga',       label: 'GA & Props',  icon: 'fa-fan',         mask: T_GA },
    { id: 'military', label: 'Military',    icon: 'fa-jet-fighter', mask: T_MILITARY },
    { id: 'mine',     label: 'Watchlist',   icon: 'fa-star',        relation: true }
];

const CLASS_CACHE = new Map();

function hasAny(haystack, needles) {
    for (let i = 0; i < needles.length; i++) {
        if (haystack.includes(needles[i])) return true;
    }
    return false;
}

/**
 * Every class this flight belongs to, as a bitmask.
 *
 * Cached by type+callsign: a busy server is a few thousand aircraft, but only
 * a few hundred distinct pairings, and the live map re-resolves this on every
 * polling tick.
 */
export function classifyFlight(aircraftName, callsign) {
    const key = `${aircraftName || ''}|${callsign || ''}`;
    const cached = CLASS_CACHE.get(key);
    if (cached !== undefined) return cached;

    const type = String(aircraftName || '').toUpperCase();
    const call = String(callsign || '').toUpperCase();
    let mask = 0;

    // Military first. Left later it would be shadowed — "C-130" contains no
    // Cessna, but "SPITFIRE" is both a warbird and, to the GA list, a piston
    // single, and a fighter reads better as a fighter.
    if (hasAny(type, MIL_TYPES)) mask |= T_MILITARY;

    if (hasAny(type, FREIGHTER_HINTS) || hasAny(call, CARGO_CALLSIGNS)) mask |= T_CARGO;
    if (hasAny(type, HEAVY_TYPES)) mask |= T_HEAVY;
    if (hasAny(type, BIZ_TYPES)) mask |= T_BUSINESS;
    if (hasAny(type, GA_TYPES)) mask |= T_GA;

    // "Airlines" means a scheduled-service airframe, so a fighter never lands
    // in it however it was called — but a freighter does, because a 777F is
    // still an airliner flying a route.
    if (!(mask & T_MILITARY) && hasAny(type, AIRLINE_TYPES)) mask |= T_AIRLINE;

    // A type nothing recognised is drawn as a generic airliner on the map, so
    // it is filtered as one too. Anything else and the commonest preset
    // silently loses every aircraft the type lists have not caught up with.
    if (!mask) mask = T_AIRLINE;

    CLASS_CACHE.set(key, mask);
    return mask;
}

const TAG_CACHE = new Map();

/**
 * The same answer as a delimited string, for the live map.
 *
 * Mapbox GL expressions have no bitwise operators, so the live layer filter
 * cannot test a mask. It can test substring containment, and `,cargo,` inside
 * `,airline,heavy,cargo,` is exactly the membership test needed — hence the
 * leading and trailing commas, without which "ga" would match "cargo".
 */
export function classTags(aircraftName, callsign) {
    const mask = classifyFlight(aircraftName, callsign);
    let tags = TAG_CACHE.get(mask);
    if (tags === undefined) {
        tags = ',' + TRAFFIC_PRESETS
            .filter(p => p.mask && (mask & p.mask))
            .map(p => p.id)
            .join(',') + ',';
        TAG_CACHE.set(mask, tags);
    }
    return tags;
}

/**
 * The union of the selected presets, as a Mapbox filter expression — or null
 * when the selection means "everything", which is both the empty selection and
 * an explicit All Traffic.
 *
 * `mine` is folded in here rather than handled by the caller because the
 * presets are a union: Cargo + Watchlist means cargo flights OR watchlist
 * pilots, and splitting it would silently make it an intersection.
 */
export function presetFilterExpression(ids, tagProperty = '__cls') {
    if (!Array.isArray(ids) || !ids.length || ids.includes('all')) return null;

    const clauses = [];
    for (const id of ids) {
        const preset = TRAFFIC_PRESETS.find(p => p.id === id);
        if (!preset) continue;
        if (preset.relation) {
            clauses.push(['!=', ['coalesce', ['get', 'pilotRelation'], 'none'], 'none']);
        } else if (preset.mask) {
            clauses.push(['in', `,${id},`, ['coalesce', ['get', tagProperty], '']]);
        }
    }
    if (!clauses.length) return null;
    return clauses.length === 1 ? clauses[0] : ['any', ...clauses];
}
