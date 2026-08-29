// test-landing-rates.js
//
// The touchdown analyser in landing-rates.js.
//
// This is a feature that can be confidently wrong: every step of it produces a
// plausible-looking number whether or not the maths holds. A field elevation
// read off the wrong fix, a touchdown located at the far end of the runway, a
// regression fitted over the pre-flare descent — none of them throw, and all of
// them ship a rate a pilot would believe. So the tests build trails whose true
// answer is known by construction and check the analyser recovers it, then
// check the guards that stop it inventing landings out of taxi runs.
//
// Node builtins only, like tools/verify-data.js — no browser, no install step.
// landing-rates.js is a UMD-ish IIFE that assigns to `module.exports` when it
// sees one, so a plain require() is enough.
//
// Run:  node tools/test-landing-rates.js
'use strict';
const path = require('path');

const LR = require(path.resolve(__dirname, '..', 'landing-rates.js'));

let pass = 0; let fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log(`  ✓ ${name}`); pass++; }
    else { console.log(`  ✗ ${name}${extra ? `  (${extra})` : ''}`); fail++; }
};
const head = (s) => console.log(`\n${s}`);
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;

// A field to land at. Elevation 500 ft so a bug that treats altitude as AGL
// shows up rather than cancelling out against a sea-level airport.
const FIELD = { lat: 51.4700, lon: -0.4543, elev: 500 };
const AIRPORTS = {
    EGLL: { name: 'Heathrow', lat: FIELD.lat, lon: FIELD.lon, country: 'GB' },
    KJFK: { name: 'John F Kennedy', lat: 40.6398, lon: -73.7789, country: 'US' }
};

// Runway resolver of the shape flight.js hands in: one end, on the field,
// facing 090.
const RUNWAY = { ident: '09L', heading: 90, elevation_ft: FIELD.elev, lat: FIELD.lat, lon: FIELD.lon };
const runwayLookup = () => RUNWAY;

/**
 * Builds a synthetic trail for one approach and landing.
 *
 * @param {Object} o
 * @param {number} o.stepSec      seconds between fixes
 * @param {number} o.approachFpm  descent rate flown down the glidepath
 * @param {number} o.flareFpm     descent rate through the last `flareFt`
 * @param {number} o.flareFt      AGL at which the flare begins
 * @param {number} o.fromFt       AGL the trail starts at
 * @param {number} o.gs           ground speed on approach (kt)
 * @returns {Array} fixes in the short {lat,lon,alt,gs,time,hdg} shape
 */
function buildApproach(o) {
    const stepSec = o.stepSec, stepMs = stepSec * 1000;
    const pts = [];
    let t = 1700000000000;
    let agl = o.fromFt;
    let lon = FIELD.lon - 0.25;                     // start ~10 nm west, tracking 090
    const gs = o.gs != null ? o.gs : 140;
    const lonPerSec = 0.25 / ((10 / gs) * 3600);    // close the 0.25° over the run

    // Descent to touchdown, switching to the flare rate at flareFt.
    while (agl > 0) {
        pts.push({ lat: FIELD.lat, lon, alt: FIELD.elev + agl, gs, time: t, hdg: 90 });
        const rate = agl <= o.flareFt ? o.flareFpm : o.approachFpm;   // fpm, positive
        agl -= (rate / 60) * stepSec;
        lon += lonPerSec * stepSec;
        t += stepMs;
    }
    // Touchdown fix, then a decelerating rollout onto the ground.
    pts.push({ lat: FIELD.lat, lon, alt: FIELD.elev, gs, time: t, hdg: 90 });
    let rollGs = gs;
    const touchdownLon = lon;
    for (let i = 0; i < 8; i++) {
        t += stepMs; lon += lonPerSec * stepSec * (rollGs / gs);
        rollGs = Math.max(5, rollGs - 25);
        pts.push({ lat: FIELD.lat, lon, alt: FIELD.elev, gs: rollGs, time: t, hdg: 90 });
    }
    // Slide the whole trail so the wheels touch down on the threshold. The
    // approach's along-track maths is only approximate, and the threshold-
    // distance assertion needs a fixture whose answer is known exactly.
    const shift = FIELD.lon - touchdownLon;
    return pts.map(p => ({ ...p, lon: p.lon + shift }));
}

// ---------------------------------------------------------------------------
head('Touchdown rate recovery');

{
    // Densely-sampled flare: fixes land inside the last 250 ft, so the analyser
    // should read the flare rate (150 fpm) and not the 700 fpm glidepath above
    // it. Getting the glidepath here is the single most likely bug in the file.
    const pts = buildApproach({ stepSec: 3, approachFpm: 700, flareFpm: 150, flareFt: 120, fromFt: 2000 });
    const [l] = LR.detect(pts, AIRPORTS, { runwayLookup });

    ok('a landing is detected', !!l);
    ok('the touchdown rate reflects the flare, not the glidepath',
        near(l.fpm, -150, 60), `got ${l && l.fpm}`);
    ok('it grades as butter', l && l.grade && l.grade.key === 'butter', l && l.grade && l.grade.key);
    ok('confidence is high when a fix sits low in the flare',
        l.confidence === 'high', l.confidence);
    ok('the arrival field is identified', l.icao === 'EGLL', l.icao);
    ok('field elevation comes from the runway, not the trail',
        l.fieldElevFt === FIELD.elev, String(l.fieldElevFt));
}

{
    // Same approach flown onto the runway with no flare at all: the touchdown
    // rate should be the glidepath rate and grade accordingly.
    const pts = buildApproach({ stepSec: 3, approachFpm: 750, flareFpm: 750, flareFt: 0, fromFt: 2000 });
    const [l] = LR.detect(pts, AIRPORTS, { runwayLookup });
    ok('an unflared arrival reads as its full descent rate',
        near(l.fpm, -750, 90), `got ${l && l.fpm}`);
    ok('it grades hard', l.grade.key === 'hard', l.grade.key);
}

{
    // The real sampling case: 15 s between fixes (live_flights.cjs ACTIVE_POLL_MS).
    // At 700 fpm the aircraft covers 175 ft between fixes, so the flare is
    // usually missed entirely. The analyser must not pretend otherwise.
    const pts = buildApproach({ stepSec: 15, approachFpm: 700, flareFpm: 150, flareFt: 60, fromFt: 2000 });
    const [l] = LR.detect(pts, AIRPORTS, { runwayLookup });
    ok('a coarse trail still yields a landing', !!l);
    ok('a coarse trail is not reported as high confidence',
        l.confidence !== 'high', l.confidence);
    ok('a coarse trail reports the approach gradient it actually saw',
        near(l.fpm, -700, 120), `got ${l && l.fpm}`);
    ok('the stabilised-approach rate is still measured',
        near(l.finalFpm, -700, 120), `got ${l && l.finalFpm}`);
    ok('a 700 fpm approach is flagged stabilised', l.stabilised === true);
}

{
    // A dive at 1,600 fpm below 1,000 ft AGL busts the stabilised gate.
    const pts = buildApproach({ stepSec: 5, approachFpm: 1600, flareFpm: 1600, flareFt: 0, fromFt: 2000 });
    const [l] = LR.detect(pts, AIRPORTS, { runwayLookup });
    ok('an unstable approach is flagged', l.stabilised === false, String(l.stabilised));
}

// ---------------------------------------------------------------------------
head('Runway geometry');

{
    const pts = buildApproach({ stepSec: 3, approachFpm: 700, flareFpm: 160, flareFt: 120, fromFt: 1500 });
    const [l] = LR.detect(pts, AIRPORTS, { runwayLookup });
    ok('the runway is named', l.runway === '09L', l.runway);
    ok('an on-heading touchdown reads as aligned', l.alignmentDeg === 0, String(l.alignmentDeg));
    ok('the touchdown point is measured from the threshold',
        near(l.thresholdNm, 0, 0.05), String(l.thresholdNm));
    ok('a rollout distance is produced', l.rolloutNm > 0, String(l.rolloutNm));
    ok('the speed at touchdown is carried', l.touchdownGsKt === 140, String(l.touchdownGsKt));
}

{
    // Crabbed on 20° at touchdown — the alignment figure is what tells a viewer
    // the aircraft was not tracking the centreline.
    const pts = buildApproach({ stepSec: 3, approachFpm: 700, flareFpm: 160, flareFt: 120, fromFt: 1500 });
    pts.forEach(p => { p.hdg = 110; });
    const [l] = LR.detect(pts, AIRPORTS, { runwayLookup });
    ok('a crabbed touchdown reports its offset', l.alignmentDeg === 20, String(l.alignmentDeg));
}

// ---------------------------------------------------------------------------
head('Guards against invented landings');

{
    // A fast taxi run: above the ground-speed cut, but it never climbs.
    const pts = [];
    let t = 1700000000000, lon = FIELD.lon;
    for (let i = 0; i < 20; i++) {
        pts.push({ lat: FIELD.lat, lon, alt: FIELD.elev + (i < 10 ? 20 : 0), gs: i < 15 ? 60 : 5, time: t, hdg: 90 });
        t += 5000; lon += 0.0005;
    }
    ok('a high-speed taxi run is not scored as a landing',
        LR.detect(pts, AIRPORTS, { runwayLookup }).length === 0);
}

{
    // Still airborne — no ground fixes follow, so there is nothing to measure.
    const full = buildApproach({ stepSec: 3, approachFpm: 700, flareFpm: 150, flareFt: 120, fromFt: 2000 });
    const airborne = full.filter(p => p.alt > FIELD.elev + 300);
    ok('a flight still in the air produces no landing',
        LR.detect(airborne, AIRPORTS, { runwayLookup }).length === 0);
}

{
    ok('an empty trail is handled', LR.detect([], AIRPORTS, { runwayLookup }).length === 0);
    ok('a trail with no speed data is handled',
        LR.detect([{ lat: 1, lon: 1, alt: 100, time: 1 }, { lat: 1, lon: 1, alt: 0, time: 2 }], AIRPORTS).length === 0);
    ok('detect works with no runway resolver at all',
        LR.detect(buildApproach({ stepSec: 3, approachFpm: 700, flareFpm: 150, flareFt: 120, fromFt: 1500 }),
            AIRPORTS).length === 1);
}

{
    // Two legs in one trail: A→B, park, B→C. Both landings must appear, oldest
    // first, so the panel's "earlier this journey" list is in the right order.
    const first = buildApproach({ stepSec: 3, approachFpm: 700, flareFpm: 150, flareFt: 120, fromFt: 1500 });
    const gapT = first[first.length - 1].time + 20 * 60 * 1000;
    const second = buildApproach({ stepSec: 3, approachFpm: 700, flareFpm: 550, flareFt: 120, fromFt: 1500 })
        .map(p => ({ ...p, time: p.time + (gapT - first[0].time) }));
    const landings = LR.detect(first.concat(second), AIRPORTS, { runwayLookup });
    ok('both legs of a journey are analysed', landings.length === 2, String(landings.length));
    ok('landings come back oldest first',
        landings.length === 2 && landings[0].time < landings[1].time);
    ok('each leg keeps its own rate',
        landings.length === 2 && Math.abs(landings[1].fpm) > Math.abs(landings[0].fpm) + 200,
        landings.map(l => l.fpm).join(', '));
}

// ---------------------------------------------------------------------------
head('Grading and aggregation');

{
    ok('150 fpm is butter', LR.grade(-150).key === 'butter');
    ok('151 fpm is not butter', LR.grade(-151).key !== 'butter');
    ok('grading ignores sign', LR.grade(400).key === LR.grade(-400).key);
    ok('an absurd rate still grades', LR.grade(-99999).key === 'heavy');
    ok('a missing rate grades to nothing', LR.grade(null) === null);
}

{
    const s = LR.summarize([
        { fpm: -100, measured: true,  finalFpm: -700, stabilised: true },
        { fpm: -300, measured: true,  finalFpm: -700, stabilised: true },
        { fpm: -900, measured: false, finalFpm: -1500, stabilised: false },  // approach only
        { fpm: null, measured: false, finalFpm: -700, stabilised: true }     // no rate at all
    ]);
    ok('every landing counts toward the total', s.total === 4, String(s.total));
    ok('only measured touchdowns feed the averages', s.rated === 2, String(s.rated));
    ok('the average is over the measured set only', s.average === -200, String(s.average));
    ok('the best landing is the softest', s.best.fpm === -100, String(s.best.fpm));
    ok('the worst measured landing is picked out', s.worst.fpm === -300, String(s.worst.fpm));
    ok('butter rate is a percentage of the measured set', s.butterRate === 50, String(s.butterRate));
    ok('stabilised rate spans everything that reported it', s.stabilisedRate === 75, String(s.stabilisedRate));
    ok('the approach average spans every landing, measured or not',
        s.avgApproachFpm === -900, String(s.avgApproachFpm));
    ok('an empty set summarises without throwing',
        LR.summarize([]).total === 0 && LR.summarize([]).average === null);
}

{
    // A set where nothing was measured still has real approach numbers to show.
    const s = LR.summarize([
        { fpm: -700, measured: false, finalFpm: -700, stabilised: true },
        { fpm: -720, measured: false, finalFpm: -720, stabilised: true }
    ]);
    ok('an unmeasured set reports no touchdown average', s.average === null);
    ok('an unmeasured set still reports the approach average',
        s.avgApproachFpm === -710, String(s.avgApproachFpm));
    ok('an unmeasured set still reports stabilised rate', s.stabilisedRate === 100);
}

// ---------------------------------------------------------------------------
head('Never grading a touchdown we did not watch');

{
    // At the tracker's real 15 s cadence the flare falls between fixes, so the
    // only rate available is the ~700 fpm glidepath — a perfectly normal ILS.
    // Grading that as "Hard" would stamp a bad landing on a good arrival, so
    // the whole grade vocabulary has to stay off the card.
    const pts = buildApproach({ stepSec: 15, approachFpm: 700, flareFpm: 150, flareFt: 60, fromFt: 2000 });
    const [l] = LR.detect(pts, AIRPORTS, { runwayLookup });

    ok('an unsampled flare is not marked measured', l.measured === false, String(l.measured));
    ok('an unsampled flare gets no touchdown grade', l.grade === null, l.grade && l.grade.key);
    ok('it falls back to the stabilised verdict', l.verdict && l.verdict.key === 'stable',
        l.verdict && l.verdict.key);

    const html = LR.renderHTML([l]);
    ok('the card leads with the approach, not a touchdown', html.includes('Final approach'));
    ok('the card says the touchdown was not sampled',
        html.includes('Touchdown itself') && html.includes('sampled'));
    ok('no butter-to-heavy scale is drawn for it', !html.includes('BUTTER'));
    for (const word of ['Butter', 'Firm', 'Hard', 'Heavy']) {
        ok(`the word "${word}" never appears`, !html.includes('>' + word + '<'));
    }
}

{
    // A densely-sampled flare earns the grade, the scale and the vocabulary.
    const pts = buildApproach({ stepSec: 3, approachFpm: 700, flareFpm: 150, flareFt: 120, fromFt: 2000 });
    const [l] = LR.detect(pts, AIRPORTS, { runwayLookup });
    ok('a sampled flare is marked measured', l.measured === true);
    ok('a sampled flare is graded', l.grade && l.grade.key === 'butter', l.grade && l.grade.key);

    const html = LR.renderHTML([l]);
    ok('the card leads with the touchdown', html.includes('At touchdown'));
    ok('the butter-to-heavy scale is drawn', html.includes('BUTTER'));
    ok('the card says the flare was sampled', html.includes('Flare sampled'));
}

{
    // An unstable approach with no measured touchdown must still be called out.
    const pts = buildApproach({ stepSec: 15, approachFpm: 1600, flareFpm: 1600, flareFt: 0, fromFt: 2500 });
    const [l] = LR.detect(pts, AIRPORTS, { runwayLookup });
    ok('an unstable unmeasured approach carries the unstable verdict',
        l.verdict && l.verdict.key === 'unstable', l.verdict && l.verdict.key);
    ok('the unstable verdict reaches the card', LR.renderHTML([l]).includes('Unstable'));
}

{
    // Fixes at 106 ft and 60 ft AGL bracket the approach, not the flare — a
    // flare has not begun at 60 ft. Sampling that finely is not the same as
    // sampling low enough, and the analyser must not treat it as a measurement.
    // 1180 ft at 46.7 ft/fix steps straight over the 50-100 ft window: the last
    // two airborne fixes land at 107 ft and 60 ft, and the next is already down.
    const pts = buildApproach({ stepSec: 4, approachFpm: 700, flareFpm: 120, flareFt: 50, fromFt: 1180 });
    const [l] = LR.detect(pts, AIRPORTS, { runwayLookup });
    const lowestFix = Math.min(...pts.filter(p => p.alt > FIELD.elev + 20).map(p => p.alt - FIELD.elev));
    ok('the fixture really does stop short of the flare', lowestFix > 50, String(lowestFix));
    ok('tight spacing above the flare is not a measured touchdown',
        l.measured === false, `${l.confidence} / ${l.fpm}`);
    ok('and so it carries no grade', l.grade === null, l.grade && l.grade.key);
}

// ---------------------------------------------------------------------------
head('Rendering');

{
    const pts = buildApproach({ stepSec: 3, approachFpm: 700, flareFpm: 150, flareFt: 120, fromFt: 1500 });
    const landings = LR.detect(pts, AIRPORTS, { runwayLookup });
    const html = LR.renderHTML(landings);

    ok('the panel renders', html.length > 0);
    ok('the rate is on the page', html.includes('-150') || /-1[0-9]{2}/.test(html));
    ok('the grade is named', html.includes('Butter'));
    ok('the confidence is stated alongside the number', html.includes('High confidence'));
    ok('the number says where it came from', /ft AGL/.test(html));
    ok('the ICAO is clickable in both windows',
        html.includes('ac-icao-link') || html.includes('EGLL'));
    ok('nothing renders for an empty set', LR.renderHTML([]) === '');
    ok('nothing renders for null', LR.renderHTML(null) === '');
}

{
    // A landing with only the final-approach figure must say so rather than
    // presenting a glidepath average as a touchdown rate.
    const html = LR.renderHTML([{ icao: 'KJFK', time: Date.now(), fpm: null, finalFpm: -690,
        confidence: 'low', measured: false, stabilised: true, sampleAglFt: 640, gapSec: 15 }]);
    ok('an estimate-only landing is labelled as the final approach rate',
        html.includes('Final approach'));
    ok('an estimate-only landing explains the missing flare',
        html.includes('Touchdown itself') && html.includes('the last fix was 640 ft up'));
}

{
    // Nothing user-supplied reaches the DOM raw.
    const html = LR.renderHTML([{ icao: '<img src=x>', name: '<script>alert(1)</script>',
        time: Date.now(), fpm: -200, finalFpm: -600, confidence: 'high', measured: true,
        runway: '<b>09</b>' }]);
    ok('a hostile ICAO does not survive into the markup', !html.includes('<img'));
    ok('a hostile runway ident is escaped', !html.includes('<b>09</b>'));
}

// ---------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
