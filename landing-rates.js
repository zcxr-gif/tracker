/**
 * landing-rates.js — dependency-free touchdown / approach analyser.
 *
 * Reconstructs every landing in a flight's position history (the /history
 * breadcrumb trail) and estimates how it was flown: the vertical rate at
 * touchdown, the average rate over the final 1000 ft, where on the runway the
 * wheels went down, how fast, how straight, and how long the rollout ran.
 *
 * ── Why this is an *estimate* ─────────────────────────────────────────────
 * Infinite Flight's Live API exposes no touchdown vertical speed, and neither
 * does the user logbook (`/users/{id}/flights` carries `landingCount` and
 * nothing about how the landing went). All we have is the position trail, and
 * the tracker samples it every 15 s while a client is connected. A flare lasts
 * three or four seconds, so it usually falls between two fixes.
 *
 * The analyser therefore reports what the data can actually support:
 *
 *   • `fpm`        — best estimate of the touchdown rate, fitted over the
 *                    lowest airborne fixes inside the final 150 ft AGL. Present
 *                    only when a fix landed low enough to mean anything.
 *   • `finalFpm`   — average rate over the last 1000 ft AGL. Always available
 *                    when the descent was tracked; this is the stabilised-
 *                    approach number (ICAO/FSF criteria: ≤ 1000 fpm below
 *                    1000 ft AGL), and it is a real measurement, not a guess.
 *   • `confidence` — 'high' | 'medium' | 'low'. 'high' needs two or more fixes
 *                    inside 100 ft AGL, the lowest of them inside 50 ft, spaced
 *                    under 10 s apart. Anything less only saw the approach.
 *   • `measured`   — true when the flare was genuinely observed. This is the
 *                    switch everything downstream keys off.
 *
 * A landing is graded (Butter … Heavy) only when `measured` is true. This
 * matters more than it looks: a normal ILS descends at ~700 fpm, so grading the
 * approach gradient would stamp "Hard" on nearly every well-flown arrival. When
 * the flare wasn't sampled, `grade` is null, the card leads with the approach
 * rate and the stabilised/unstable verdict, and the butter-to-heavy vocabulary
 * stays off the page entirely. summarize() excludes unmeasured landings from
 * best/average/butter for the same reason.
 *
 * Shared exactly like flight-legs.js and flight-graph.js: detection runs where
 * the airport/runway databases live and the plain result is rendered
 * identically by the full avionics window and the simple window's iframe.
 *
 * Exposes window.LandingRates = { detect, summarize, renderHTML, grade,
 *                                 gradeOf, normalize }.
 */
(function (global) {
    'use strict';

    // ── Tuning ────────────────────────────────────────────────────────────
    // Ground/air split. Rollout runs well above taxi speed, so a gs cut alone
    // marks touchdown far too late — it is used only to bracket the airborne
    // run, and the touchdown fix itself is found by altitude (below).
    const GROUND_GS_KT      = 40;      // at/below this the aircraft has slowed off the runway
    const TOUCHDOWN_BAND_FT = 20;      // height above the trail's own settled altitude that counts as down
    const FLARE_BAND_FT     = 150;     // only fixes this low can say anything about the flare
    const FLARE_FIXES       = 4;       // how many of them to fit — the lowest ones win
    // What it takes to claim the flare was actually observed. A flare begins
    // somewhere around 30-50 ft, so a pair of fixes at 100 and 60 ft describes
    // the approach and nothing else — the lowest fix has to be inside the flare
    // itself, with a second one close above it, and both close together in time.
    const CONFIDENT_AGL_FT  = 50;      // the lowest fix must be this deep into the flare
    const CONFIDENT_NEAR_FT = 100;     // ...with at least two fixes below this
    const CONFIDENT_GAP_MS  = 10000;   // ...spaced no wider than this
    const STABILISED_FT     = 1000;    // FSF stabilised-approach gate
    const APPROACH_MAX_MS   = 6 * 60 * 1000;  // don't reach further back than this for the fit
    const AIRPORT_RADIUS_KM = 12;      // nearest-airport match tolerance
    const MIN_APPROACH_ALT_FT = 400;   // the run must have climbed this far to be a real flight
    const ROLLOUT_STOP_KT   = 35;      // rollout is over once the aircraft is this slow

    // ── Small helpers ─────────────────────────────────────────────────────
    function num(v) { return (typeof v === 'number' && !isNaN(v)) ? v : null; }

    function pickNum() {
        for (let i = 0; i < arguments.length; i++) {
            const v = arguments[i];
            if (typeof v === 'number' && !isNaN(v)) return v;
        }
        return null;
    }
    function pickTime() {
        for (let i = 0; i < arguments.length; i++) {
            const v = arguments[i];
            if (typeof v === 'number' && !isNaN(v)) return v;
            if (typeof v === 'string' && v) { const t = Date.parse(v); if (!isNaN(t)) return t; }
        }
        return null;
    }

    // Tolerant point readers — the /history trail is read in several shapes
    // across the app (flat and nested under `position`, short and long keys).
    // Mirrors flight-legs.js so both modules agree on the same trail.
    function pointLat(p) { const o = (p && p.position) || {}; return pickNum(o.lat, o.latitude, p && p.lat, p && p.latitude); }
    function pointLon(p) { const o = (p && p.position) || {}; return pickNum(o.lon, o.lng, o.longitude, p && p.lon, p && p.lng, p && p.longitude); }
    function pointAlt(p) { const o = (p && p.position) || {}; return pickNum(o.alt, o.altitude, o.alt_ft, p && p.alt, p && p.altitude, p && p.alt_ft); }
    function pointGs(p)  { const o = (p && p.position) || {}; return pickNum(o.gs, o.groundSpeed, o.gs_kt, o.speed, p && p.gs, p && p.groundSpeed, p && p.gs_kt, p && p.speed); }
    function pointHdg(p) { const o = (p && p.position) || {}; return pickNum(o.hdg, o.heading, o.heading_deg, o.track, p && p.hdg, p && p.heading, p && p.heading_deg, p && p.track); }
    function pointTime(p) {
        const o = (p && p.position) || {};
        return pickTime(o.time, o.lastReportMs, o.timeMs, p && p.time, p && p.lastReportMs, p && p.timeMs,
            o.date, o.timestamp, o.lastReport, p && p.date, p && p.timestamp, p && p.lastReport);
    }

    function haversineKm(lat1, lon1, lat2, lon2) {
        const R = 6371, toRad = d => d * Math.PI / 180;
        const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // Shortest signed angle between two bearings, in degrees (0-180).
    function bearingDelta(a, b) {
        if (a == null || b == null) return null;
        let d = Math.abs(a - b) % 360;
        if (d > 180) d = 360 - d;
        return d;
    }

    // Ordinary least squares of alt (ft) against time (ms). Returns ft/min,
    // negative for a descent, plus the fit's R² so callers can tell a clean
    // glidepath from a scattered one.
    function fitRate(samples) {
        const n = samples.length;
        if (n < 2) return null;
        let sx = 0, sy = 0;
        for (const s of samples) { sx += s.t; sy += s.alt; }
        const mx = sx / n, my = sy / n;
        let sxy = 0, sxx = 0, syy = 0;
        for (const s of samples) {
            const dx = s.t - mx, dy = s.alt - my;
            sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
        }
        if (sxx === 0) return null;
        const slopePerMs = sxy / sxx;                       // ft per ms
        const r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : 1; // 1 == perfectly linear
        return { fpm: slopePerMs * 60000, r2: Math.max(0, Math.min(1, r2)), samples: n };
    }

    // Position along a trail at an arbitrary instant, linearly interpolated
    // between the fixes either side of it. Clamped to the trail's own ends.
    function positionAt(pts, time) {
        if (!pts.length) return null;
        if (time <= pts[0].t) return { lat: pts[0].lat, lon: pts[0].lon };
        const last = pts[pts.length - 1];
        if (time >= last.t) return { lat: last.lat, lon: last.lon };
        let hi = 1;
        while (hi < pts.length && pts[hi].t < time) hi++;
        const a = pts[hi - 1], b = pts[hi];
        const span = b.t - a.t;
        const f = span > 0 ? (time - a.t) / span : 0;
        return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
    }

    // Nearest airport in the ICAO-keyed database, memoised by ~100 m quantised
    // position: touchdown points barely move between live re-detections, which
    // keeps the per-tick cost negligible after the first scan.
    const _nearestCache = new Map();
    function nearestAirport(airportsData, lat, lon) {
        if (!airportsData || lat == null || lon == null) return null;
        const key = lat.toFixed(3) + ',' + lon.toFixed(3);
        if (_nearestCache.has(key)) return _nearestCache.get(key);
        let best = null, bestD = Infinity;
        for (const icao in airportsData) {
            const a = airportsData[icao];
            if (!a) continue;
            const aLat = num(a.lat != null ? a.lat : a.latitude);
            const aLon = num(a.lon != null ? a.lon : a.longitude);
            if (aLat == null || aLon == null) continue;
            const d = haversineKm(lat, lon, aLat, aLon);
            if (d < bestD) {
                bestD = d;
                best = {
                    icao: (a.icao || icao),
                    name: a.name || '',
                    lat: aLat, lon: aLon,
                    elevationFt: num(a.elevation_ft != null ? a.elevation_ft : a.elevationFt),
                    distanceKm: d
                };
            }
        }
        const result = (best && best.distanceKm <= AIRPORT_RADIUS_KM) ? best : null;
        if (_nearestCache.size > 500) _nearestCache.clear();
        _nearestCache.set(key, result);
        return result;
    }

    /** Normalise a raw trail into clean, chronological samples. */
    function normalize(points) {
        if (!Array.isArray(points)) return [];
        const arr = [];
        for (const p of points) {
            const t = pointTime(p), lat = pointLat(p), lon = pointLon(p);
            if (t == null || lat == null || lon == null) continue;
            arr.push({ t, lat, lon, alt: pointAlt(p), gs: pointGs(p), hdg: pointHdg(p) });
        }
        arr.sort((a, b) => a.t - b.t);
        return arr;
    }

    // ── Grading ───────────────────────────────────────────────────────────
    // Bands over |fpm| at touchdown. Deliberately a little wider than the
    // numbers pilots quote in-sim, because ours is reconstructed from fixes
    // rather than read off the touchdown event.
    const GRADES = [
        { max: 150,      key: 'butter', label: 'Butter',   color: '#34d399', blurb: 'Barely felt it' },
        { max: 250,      key: 'smooth', label: 'Smooth',   color: '#4ade80', blurb: 'Nicely flown' },
        { max: 400,      key: 'good',   label: 'Good',     color: '#38bdf8', blurb: 'Textbook' },
        { max: 600,      key: 'firm',   label: 'Firm',     color: '#fbbf24', blurb: 'Positive touchdown' },
        { max: 900,      key: 'hard',   label: 'Hard',     color: '#fb923c', blurb: 'Felt in the cabin' },
        { max: Infinity, key: 'heavy',  label: 'Heavy',    color: '#f87171', blurb: 'Inspection territory' }
    ];

    /** Grade descriptor for a vertical rate (sign-agnostic). */
    function grade(fpm) {
        if (fpm == null) return null;
        const mag = Math.abs(fpm);
        for (const g of GRADES) if (mag <= g.max) return g;
        return GRADES[GRADES.length - 1];
    }
    /**
     * Grade descriptor for a landing — but only when the touchdown was actually
     * observed. At the tracker's 15 s cadence the flare usually falls between
     * two fixes, leaving nothing but the approach gradient, and a 700 fpm
     * glidepath is a perfectly normal ILS. Grading that as "Hard" would stamp a
     * bad landing on almost every well-flown arrival. When the flare wasn't
     * sampled the caller gets null and must present the approach figures
     * instead — see `measured` on each landing.
     */
    function gradeOf(landing) {
        if (!landing || landing.fpm == null || landing.confidence !== 'high') return null;
        return grade(landing.fpm);
    }

    /** Stabilised/unstable verdict — what we can always say about an approach. */
    function approachVerdict(landing) {
        if (!landing || landing.stabilised == null) return null;
        return landing.stabilised
            ? { key: 'stable', label: 'Stabilised', color: '#34d399', blurb: 'Inside 1,000 fpm on final' }
            : { key: 'unstable', label: 'Unstable', color: '#fbbf24', blurb: 'Steep inside 1,000 ft' };
    }

    /** The descriptor a landing should actually be presented with. */
    function verdictOf(landing) {
        return gradeOf(landing) || approachVerdict(landing);
    }

    /**
     * Detects every landing in a position trail and analyses each one.
     *
     * @param {Array}  points        raw /history trail points (any supported shape)
     * @param {Object} airportsData  ICAO-keyed airport DB ({ lat, lon, name })
     * @param {Object} [opts]
     * @param {Function} [opts.runwayLookup] (lat, lon, icao, headingDeg) => runway|null,
     *        where runway is { ident, heading, elevation_ft, lat, lon }. Optional;
     *        when supplied it sharpens field elevation and adds runway/threshold data.
     * @returns {Array} landings, oldest first. Each:
     *   { index, icao, name, time, fpm, finalFpm, confidence, sampleAglFt,
     *     gapSec, r2, stabilised, runway, alignmentDeg, thresholdNm,
     *     touchdownGsKt, rolloutNm, grade }
     */
    function detect(points, airportsData, opts) {
        opts = opts || {};
        const pts = normalize(points);
        if (pts.length < 3) return [];

        const hasGs = pts.some(p => p.gs != null);
        if (!hasGs) return [];   // without speed we cannot bracket an airborne run

        // Maximal airborne runs by ground speed. The rollout sits inside the
        // tail of each run (a jet is still doing 120 kt after touchdown), so
        // the actual touchdown fix is located by altitude further down.
        const runs = [];
        let i = 0;
        while (i < pts.length) {
            if (pts[i].gs != null && pts[i].gs > GROUND_GS_KT) {
                let j = i;
                while (j + 1 < pts.length && pts[j + 1].gs != null && pts[j + 1].gs > GROUND_GS_KT) j++;
                runs.push({ start: i, end: j });
                i = j + 1;
            } else i++;
        }

        const landings = [];

        for (const run of runs) {
            // A run that never slows again is still flying (or still rolling) —
            // there is no completed landing to measure.
            const stopIdx = run.end + 1;
            if (stopIdx >= pts.length) continue;

            // ── Field elevation ───────────────────────────────────────────
            // Once stopped the aircraft sits on the field, so the fixes after
            // the run give a self-calibrating field elevation. Prefer a runway
            // end's surveyed elevation when the caller can supply one.
            const restLimit = Math.min(pts.length, stopIdx + 12);
            let restMin = Infinity;
            for (let n = stopIdx; n < restLimit; n++) {
                if (pts[n].alt != null && pts[n].alt < restMin) restMin = pts[n].alt;
            }

            const apt = nearestAirport(airportsData, pts[stopIdx].lat, pts[stopIdx].lon);
            const lookupRunway = (lat, lon, hdg) => {
                if (typeof opts.runwayLookup !== 'function' || !apt) return null;
                try { return opts.runwayLookup(lat, lon, apt.icao, hdg) || null; }
                catch (_) { return null; }
            };
            // First pass, from where the aircraft came to rest: all we want here
            // is a surveyed field elevation, which any runway end at the field
            // gives us. The touchdown fix can't be located without it.
            let runway = lookupRunway(pts[stopIdx].lat, pts[stopIdx].lon, pts[stopIdx].hdg);

            let fieldElev = null;
            if (runway && num(runway.elevation_ft) != null) fieldElev = num(runway.elevation_ft);
            else if (restMin !== Infinity) fieldElev = restMin;
            else if (apt && apt.elevationFt != null) fieldElev = apt.elevationFt;
            if (fieldElev == null) continue;

            const agl = (p) => (p.alt == null ? null : p.alt - fieldElev);

            // ── Touchdown fix ─────────────────────────────────────────────
            // Walk back from the stop to the last fix that was clearly airborne;
            // the fix straight after it is the first one on the ground.
            //
            // The "on the ground" test is made against the altitude the aircraft
            // itself reported once stopped, not against the surveyed field
            // elevation. Both describe the same runway, but comparing the feed
            // to itself cancels out whatever offset it carries, which lets the
            // band be tight enough (20 ft) that a densely-sampled approach isn't
            // declared down while it is still several fixes from the tarmac.
            const groundRef = restMin !== Infinity ? restMin : fieldElev;
            let lastAir = -1;
            for (let n = stopIdx - 1; n >= run.start; n--) {
                if (pts[n].alt != null && pts[n].alt > groundRef + TOUCHDOWN_BAND_FT) { lastAir = n; break; }
            }
            if (lastAir < 0) continue;              // never left the ground band — a taxi run
            const tdIdx = lastAir + 1;
            if (tdIdx > stopIdx) continue;

            // The run has to have actually flown. Guards against a fast taxi or
            // a rejected takeoff being scored as a landing.
            let peakAgl = -Infinity;
            for (let n = run.start; n <= run.end; n++) {
                const a = agl(pts[n]);
                if (a != null && a > peakAgl) peakAgl = a;
            }
            if (peakAgl < MIN_APPROACH_ALT_FT) continue;

            const td = pts[tdIdx];
            const gapMs = td.t - pts[lastAir].t;
            const lastAirAgl = agl(pts[lastAir]);

            // ── Rate estimates ────────────────────────────────────────────
            // Collect the approach fixes leading into the touchdown, newest
            // last, bounded so a long hold earlier in the flight can't leak in.
            const approach = [];
            for (let n = lastAir; n >= run.start; n--) {
                if (td.t - pts[n].t > APPROACH_MAX_MS) break;
                const a = agl(pts[n]);
                if (a == null) continue;
                if (a > STABILISED_FT * 2) break;   // above the window we care about
                approach.unshift({ t: pts[n].t, alt: pts[n].alt, agl: a });
            }
            // Every rate below is fitted over *airborne* fixes only. The first
            // ground fix is deliberately excluded: its timestamp is whenever the
            // tracker next polled, not the moment the wheels touched, so pairing
            // it with an airborne fix stretches the descent over an interval
            // that partly happened on the runway and reads far too soft.

            // Touchdown estimate. `approach` descends monotonically, so its last
            // entries are its lowest — take the deepest few inside the flare
            // band and nothing above it. Fitting the whole band instead would
            // average the 700 fpm glidepath into the flare and grade a greased
            // landing as firm.
            const flareFixes = approach.filter(s => s.agl <= FLARE_BAND_FT).slice(-FLARE_FIXES);

            let touchdownFit = null;
            if (flareFixes.length >= 2) {
                touchdownFit = fitRate(flareFixes);
            } else if (flareFixes.length === 1) {
                // One fix in the band: pair it with the fix above to get a
                // gradient. That gradient is the approach, not the flare — the
                // confidence rating below is what stops it being read as one.
                const idx = approach.indexOf(flareFixes[0]);
                if (idx > 0) touchdownFit = fitRate([approach[idx - 1], flareFixes[0]]);
            }
            // A fit that reads as a climb is a sampling artefact, not a landing.
            if (touchdownFit && touchdownFit.fpm > 0) touchdownFit = null;

            // Stabilised-approach rate: everything inside the final 1,000 ft.
            const stabSamples = approach.filter(s => s.agl > 0 && s.agl <= STABILISED_FT);
            const stabFit = stabSamples.length >= 2 ? fitRate(stabSamples) : null;

            // Confidence. Two things have to hold before a number is presented
            // as a touchdown rate: fixes low enough to contain the flare, and
            // spacing tight enough that they aren't just two points either side
            // of it. Anything less is the approach gradient wearing a disguise.
            const lowestAgl = flareFixes.length ? flareFixes[flareFixes.length - 1].agl : lastAirAgl;
            let maxGapMs = 0;
            for (let n = 1; n < flareFixes.length; n++) {
                maxGapMs = Math.max(maxGapMs, flareFixes[n].t - flareFixes[n - 1].t);
            }
            const nearFixes = flareFixes.filter(s => s.agl <= CONFIDENT_NEAR_FT).length;
            let confidence = 'low';
            if (nearFixes >= 2 && lowestAgl != null && lowestAgl <= CONFIDENT_AGL_FT
                && maxGapMs <= CONFIDENT_GAP_MS) {
                confidence = 'high';
            } else if (touchdownFit && lowestAgl != null && lowestAgl <= FLARE_BAND_FT) {
                confidence = 'medium';
            }

            const fpm = touchdownFit ? Math.round(touchdownFit.fpm) : null;
            const finalFpm = stabFit && stabFit.fpm < 0 ? Math.round(stabFit.fpm) : null;

            // ── Where the wheels actually touched ─────────────────────────
            // The first ground fix is recorded whenever the tracker next polled,
            // so at a 15 s cadence it can sit a mile down the runway from the
            // real touchdown. Now that the descent rate is known, walk the last
            // airborne fix down to the ground at that rate and interpolate the
            // position to match. Without this the touchdown point is reported
            // wherever the poll happened to land, which is nowhere in particular.
            let tdTime = td.t, tdLat = td.lat, tdLon = td.lon;
            if (touchdownFit && lastAirAgl != null && lastAirAgl > 0) {
                const ftPerMs = Math.abs(touchdownFit.fpm) / 60000;
                if (ftPerMs > 0) {
                    // The predicted moment can land several fixes past the one
                    // that first read as down — a dense trail crosses the 20 ft
                    // classification band well before the wheels arrive — so the
                    // position is read off the trail as a whole, not interpolated
                    // between two chosen fixes. The stop is a hard backstop: the
                    // aircraft is unarguably on the ground by then.
                    tdTime = Math.min(pts[lastAir].t + lastAirAgl / ftPerMs, pts[stopIdx].t);
                    const at = positionAt(pts, tdTime);
                    if (at) { tdLat = at.lat; tdLon = at.lon; }
                }
            }

            // ── Runway geometry ───────────────────────────────────────────
            // Re-resolve from the touchdown point itself, now that we know where
            // it is, and with the aircraft's heading so the resolver can pick
            // the landing end rather than the one it rolled out towards.
            const tdRunway = lookupRunway(tdLat, tdLon, td.hdg) || runway;
            let alignmentDeg = null, thresholdNm = null;
            if (tdRunway) {
                alignmentDeg = bearingDelta(td.hdg, num(tdRunway.heading));
                const rLat = num(tdRunway.lat), rLon = num(tdRunway.lon);
                if (rLat != null && rLon != null) {
                    thresholdNm = haversineKm(tdLat, tdLon, rLat, rLon) / 1.852;
                }
            }

            // ── Rollout ───────────────────────────────────────────────────
            let rolloutNm = haversineKm(tdLat, tdLon, td.lat, td.lon) / 1.852;
            for (let n = tdIdx + 1; n < pts.length; n++) {
                rolloutNm += haversineKm(pts[n - 1].lat, pts[n - 1].lon, pts[n].lat, pts[n].lon) / 1.852;
                if (pts[n].gs != null && pts[n].gs < ROLLOUT_STOP_KT) break;
                if (pts[n].t - tdTime > 10 * 60 * 1000) break;
            }

            const entry = {
                index: landings.length,
                icao: apt ? apt.icao : null,
                name: apt ? apt.name : null,
                time: Math.round(tdTime),
                fpm,
                finalFpm,
                confidence,
                sampleAglFt: lastAirAgl != null ? Math.round(lastAirAgl) : null,
                gapSec: Math.round(gapMs / 1000),
                r2: touchdownFit ? Math.round(touchdownFit.r2 * 100) / 100 : null,
                stabilised: finalFpm != null ? Math.abs(finalFpm) <= 1000 : null,
                runway: tdRunway && tdRunway.ident ? String(tdRunway.ident) : null,
                alignmentDeg: alignmentDeg != null ? Math.round(alignmentDeg) : null,
                thresholdNm: thresholdNm != null ? Math.round(thresholdNm * 100) / 100 : null,
                touchdownGsKt: td.gs != null ? Math.round(td.gs) : null,
                rolloutNm: rolloutNm > 0 ? Math.round(rolloutNm * 100) / 100 : null,
                fieldElevFt: Math.round(fieldElev)
            };
            // True only when fixes inside the flare actually pinned the
            // touchdown down. Everything downstream keys off this to decide
            // whether it may talk about the landing or only about the approach.
            entry.measured = fpm != null && confidence === 'high';
            entry.grade = gradeOf(entry);
            entry.verdict = verdictOf(entry);
            landings.push(entry);
        }

        landings.forEach((l, idx) => { l.index = idx; });
        return landings;
    }

    /**
     * Aggregates a set of landings (from one flight or a whole logbook) into
     * headline career numbers. Only landings with a usable touchdown estimate
     * count toward best/average, so a pile of low-confidence fixes cannot drag
     * the average around.
     */
    function summarize(landings) {
        const list = (landings || []).filter(Boolean);
        // Only observed touchdowns feed best/average/butter. Folding in the
        // approach-only ones would quietly turn "we didn't see the flare" into
        // "this pilot lands hard".
        const rated = list.filter(l => l.measured);
        const out = {
            total: list.length,
            rated: rated.length,
            best: null,
            average: null,
            worst: null,
            butterRate: null,
            stabilisedRate: null,
            avgApproachFpm: null
        };
        if (rated.length) {
            let sum = 0, best = null, worst = null, butter = 0;
            for (const l of rated) {
                const mag = Math.abs(l.fpm);
                sum += mag;
                if (best == null || mag < Math.abs(best.fpm)) best = l;
                if (worst == null || mag > Math.abs(worst.fpm)) worst = l;
                if (mag <= 150) butter++;
            }
            out.best = best;
            out.worst = worst;
            out.average = -Math.round(sum / rated.length);
            out.butterRate = Math.round((butter / rated.length) * 100);
        }
        const stab = list.filter(l => l.stabilised != null);
        if (stab.length) {
            out.stabilisedRate = Math.round((stab.filter(l => l.stabilised).length / stab.length) * 100);
        }
        // The approach average is the number that always exists — it's measured
        // from the final 1,000 ft, which the trail does capture.
        const approach = list.filter(l => l.finalFpm != null);
        if (approach.length) {
            out.avgApproachFpm = -Math.round(
                approach.reduce((s, l) => s + Math.abs(l.finalFpm), 0) / approach.length);
        }
        return out;
    }

    // ── Render ────────────────────────────────────────────────────────────

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function fmtUtc(ms) {
        if (ms == null) return '--:--';
        const d = new Date(ms);
        if (isNaN(d.getTime())) return '--:--';
        return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
    }
    // ICAO chip clickable in BOTH windows: the full window listens for
    // .ac-icao-link, the simple window for .icao-clickable.
    function icaoChip(icao) {
        const code = (icao || '').trim().toUpperCase();
        if (!/^[A-Z0-9]{3,4}$/.test(code)) {
            return '<span style="font-family:\'JetBrains Mono\',monospace;font-weight:800;color:#64748b;">????</span>';
        }
        return `<span class="ac-icao-link icao-clickable" data-icao="${esc(code)}" role="button" tabindex="0" title="View ${esc(code)}" `
            + `style="font-family:'JetBrains Mono',monospace;font-weight:800;color:#e2e8f0;cursor:pointer;">${esc(code)}</span>`;
    }

    const CONFIDENCE = {
        high:   { dot: '#34d399', label: 'High confidence' },
        medium: { dot: '#fbbf24', label: 'Estimated' },
        low:    { dot: '#64748b', label: 'Low confidence' }
    };

    // Position of a rate on the 0→900 fpm scale, as a percentage.
    function scalePct(fpm) {
        if (fpm == null) return null;
        return Math.max(2, Math.min(98, (Math.abs(fpm) / 900) * 100));
    }

    function metric(label, value, tone) {
        if (value == null || value === '') return '';
        return ''
            + '<div style="min-width:0;">'
            +   `<div style="font-size:9px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:#64748b;">${esc(label)}</div>`
            +   `<div style="font-size:13px;font-weight:700;color:${tone || '#e2e8f0'};margin-top:2px;font-family:'JetBrains Mono',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${value}</div>`
            + '</div>';
    }

    /** The full hero treatment for one landing — used for the latest landing. */
    function renderHero(l) {
        // A landing is only allowed to lead with a touchdown rate when the
        // flare was sampled. Otherwise the approach is the headline and the
        // grade language stays off the card entirely.
        const measured = !!l.measured;
        const v = (measured ? (l.grade || gradeOf(l)) : null) || approachVerdict(l)
            || { label: 'Landed', color: '#94a3b8', blurb: 'Approach not fully tracked' };
        const conf = CONFIDENCE[l.confidence] || CONFIDENCE.low;
        const headline = measured ? l.fpm : (l.finalFpm != null ? l.finalFpm : l.fpm);
        const pct = measured ? scalePct(headline) : null;

        // Honest one-liner about where the number came from.
        let provenance;
        if (measured) {
            provenance = `Flare sampled down to ${(l.sampleAglFt || 0).toLocaleString()} ft AGL`
                + (l.gapSec != null ? ` · ${l.gapSec}s to touchdown` : '');
        } else if (l.sampleAglFt != null) {
            provenance = `Touchdown itself wasn't sampled — the last fix was ${l.sampleAglFt.toLocaleString()} ft up, `
                + `${l.gapSec}s out`;
        } else {
            provenance = 'Reconstructed from tracked position reports';
        }

        const chips = [
            l.runway ? metric('Runway', esc(l.runway)) : '',
            (measured && l.finalFpm != null)
                ? metric('Final 1,000 ft', `${l.finalFpm.toLocaleString()}<span style="font-size:9px;color:#64748b;"> fpm</span>`,
                    Math.abs(l.finalFpm) > 1000 ? '#fb923c' : '#e2e8f0')
                : '',
            l.touchdownGsKt != null ? metric('At touchdown', `${l.touchdownGsKt}<span style="font-size:9px;color:#64748b;"> kt</span>`) : '',
            l.thresholdNm != null ? metric('From threshold', `${l.thresholdNm.toFixed(2)}<span style="font-size:9px;color:#64748b;"> nm</span>`) : '',
            l.alignmentDeg != null ? metric('Off centreline', `${l.alignmentDeg}<span style="font-size:9px;color:#64748b;">°</span>`,
                l.alignmentDeg > 10 ? '#fbbf24' : '#e2e8f0') : '',
            l.rolloutNm != null ? metric('Rollout', `${l.rolloutNm.toFixed(2)}<span style="font-size:9px;color:#64748b;"> nm</span>`) : ''
        ].filter(Boolean).join('');

        return ''
            + `<div style="display:flex;align-items:flex-end;gap:14px;padding:2px 0 12px;">`
            +   '<div style="flex:1 1 auto;min-width:0;">'
            +     `<div style="display:flex;align-items:baseline;gap:6px;">`
            +       `<span style="font-size:34px;font-weight:800;line-height:1;letter-spacing:-1px;color:${v.color};font-family:'JetBrains Mono',monospace;">`
            +         (headline != null ? headline.toLocaleString() : '––')
            +       '</span>'
            +       '<span style="font-size:12px;font-weight:700;color:#64748b;">fpm</span>'
            +     '</div>'
            +     `<div style="font-size:10px;color:#94a3b8;margin-top:5px;">${esc(measured ? 'At touchdown' : 'Final approach — last 1,000 ft')}</div>`
            +   '</div>'
            +   '<div style="flex:0 0 auto;text-align:right;">'
            +     `<div style="display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;background:${v.color}1a;border:1px solid ${v.color}40;">`
            +       `<span style="width:6px;height:6px;border-radius:50%;background:${v.color};"></span>`
            +       `<span style="font-size:11px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:${v.color};">${esc(v.label)}</span>`
            +     '</div>'
            +     `<div style="font-size:9px;color:#64748b;margin-top:5px;font-weight:600;">${esc(v.blurb)}</div>`
            +   '</div>'
            + '</div>'

            // Scale bar — only for a touchdown we actually watched. Placing a
            // marker on a butter-to-heavy scale from an approach gradient would
            // say something about the landing that the data does not support.
            + (measured
                ? '<div style="position:relative;height:4px;border-radius:999px;overflow:hidden;'
                       + 'background:linear-gradient(90deg,#34d399 0%,#4ade80 17%,#38bdf8 33%,#fbbf24 55%,#fb923c 78%,#f87171 100%);opacity:.85;"></div>'
                  + (pct != null
                      ? `<div style="position:relative;height:0;"><div style="position:absolute;top:-7px;left:${pct}%;transform:translateX(-50%);width:2px;height:10px;border-radius:1px;background:#fff;box-shadow:0 0 0 2px rgba(2,6,23,.85);"></div></div>`
                      : '')
                  + '<div style="display:flex;justify-content:space-between;font-size:8px;font-weight:700;letter-spacing:.5px;color:#475569;margin-top:8px;">'
                  +   '<span>BUTTER</span><span>FIRM</span><span>HEAVY</span>'
                  + '</div>'
                : '')

            + (chips
                ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(78px,1fr));gap:12px 10px;margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.06);">${chips}</div>`
                : '')

            + '<div style="display:flex;align-items:center;gap:6px;margin-top:12px;font-size:9px;color:#64748b;line-height:1.4;">'
            +   `<span style="flex:0 0 auto;width:5px;height:5px;border-radius:50%;background:${conf.dot};"></span>`
            +   `<span><strong style="color:#94a3b8;font-weight:700;">${esc(conf.label)}</strong> · ${esc(provenance)}</span>`
            + '</div>';
    }

    /** Compact one-line summary for an earlier landing in the same journey. */
    function renderRow(l) {
        const measured = !!l.measured;
        const v = (measured ? (l.grade || gradeOf(l)) : null) || approachVerdict(l)
            || { label: 'Landed', color: '#94a3b8' };
        const headline = measured ? l.fpm : (l.finalFpm != null ? l.finalFpm : l.fpm);
        const bits = [];
        if (l.runway) bits.push(`RWY ${esc(l.runway)}`);
        if (l.touchdownGsKt != null) bits.push(`${l.touchdownGsKt} kt`);
        bits.push(fmtUtc(l.time) + 'Z');

        return ''
            + '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid rgba(255,255,255,.05);">'
            +   `<span style="flex:0 0 auto;width:3px;height:26px;border-radius:2px;background:${v.color};"></span>`
            +   '<div style="flex:1 1 auto;min-width:0;">'
            +     `<div style="display:flex;align-items:center;gap:7px;font-size:13px;line-height:1;">${icaoChip(l.icao)}`
            +       `<span style="font-size:9px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:${v.color};">${esc(v.label)}</span>`
            +     '</div>'
            +     `<div style="font-size:9px;color:#64748b;margin-top:4px;font-weight:600;">${bits.join(' · ')}</div>`
            +   '</div>'
            +   '<div style="flex:0 0 auto;text-align:right;">'
            +     `<div style="font-size:15px;font-weight:800;color:${v.color};font-family:'JetBrains Mono',monospace;line-height:1;">${headline != null ? headline.toLocaleString() : '––'}</div>`
            +     `<div style="font-size:8px;color:#475569;font-weight:700;letter-spacing:.5px;margin-top:3px;">${measured ? 'FPM' : 'FPM · APCH'}</div>`
            +   '</div>'
            + '</div>';
    }

    /**
     * Renders the Landing performance panel.
     * @param {Array}  landings  detect() output
     * @param {Object} [opts]    { title:'Landing performance', maxRows:4 }
     * @returns {string} HTML — empty string when there is nothing to show.
     */
    function renderHTML(landings, opts) {
        opts = opts || {};
        const list = (landings || []).filter(l => l && (l.fpm != null || l.finalFpm != null));
        if (!list.length) return '';

        const latest = list[list.length - 1];
        const earlier = list.slice(0, -1).reverse().slice(0, opts.maxRows || 4);
        const title = esc(opts.title || 'Landing performance');
        const subtitle = list.length > 1
            ? `${list.length} landings`
            : (latest.icao ? `${esc(latest.icao)} · ${fmtUtc(latest.time)}Z` : `${fmtUtc(latest.time)}Z`);

        return ''
            + '<div class="fl-landing-card" style="margin:8px 0;background:rgba(15,23,42,0.4);border:1px solid rgba(255,255,255,0.05);border-radius:12px;padding:12px;overflow:hidden;">'
            +   '<div style="display:flex;align-items:center;gap:8px;color:#cbd5e1;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;margin-bottom:10px;">'
            +     `<i class="fa-solid fa-plane-arrival" style="color:#38bdf8;"></i> ${title}`
            +     `<span style="margin-left:auto;color:#64748b;font-size:10px;font-weight:600;letter-spacing:.3px;text-transform:none;">${subtitle}</span>`
            +   '</div>'
            +   renderHero(latest)
            +   (earlier.length
                    ? '<div style="margin-top:12px;padding-top:2px;">'
                      + '<div style="font-size:9px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:#475569;margin-bottom:2px;">Earlier this journey</div>'
                      + earlier.map(renderRow).join('')
                      + '</div>'
                    : '')
            + '</div>';
    }

    /**
     * Renders a pilot's landing log: the headline numbers across a set of
     * landings, then the landings themselves.
     *
     * Unlike renderHTML() this is a *career* view, so it leads with the caveat
     * rather than burying it — the set only covers the flights the tracker
     * recorded, which is a fraction of any real logbook. Callers pass that
     * scope in `opts.scope` and it is shown, not implied.
     *
     * @param {Array}  landings  detect() output, oldest first
     * @param {Object} [opts]    { title, scope, maxRows }
     * @returns {string} HTML — empty string when there is nothing to show.
     */
    function renderLogHTML(landings, opts) {
        opts = opts || {};
        const all = (landings || []).filter(l => l && (l.fpm != null || l.finalFpm != null));
        if (!all.length) return '';

        const s = summarize(all);
        const recent = all.slice().reverse().slice(0, opts.maxRows || 6);
        const bestGrade = s.best ? grade(s.best.fpm) : null;

        const stat = (label, value, sub, color) => ''
            + '<div style="min-width:0;">'
            +   `<div style="font-size:19px;font-weight:800;line-height:1;color:${color || '#e2e8f0'};font-family:'JetBrains Mono',monospace;">${value}</div>`
            +   `<div style="font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#64748b;margin-top:5px;">${esc(label)}</div>`
            +   (sub ? `<div style="font-size:9px;color:#475569;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(sub)}</div>` : '')
            + '</div>';

        // Touchdown tiles only appear for landings whose flare was sampled; the
        // approach tiles are always real, so they carry the strip on their own
        // when nothing cleared that bar.
        const tiles = [
            s.best != null
                ? stat('Best landing', s.best.fpm.toLocaleString(), s.best.icao || '', bestGrade ? bestGrade.color : null)
                : '',
            s.average != null ? stat('Avg touchdown', s.average.toLocaleString(), `over ${s.rated} measured`) : '',
            s.butterRate != null ? stat('Butter rate', s.butterRate + '%', '≤ 150 fpm') : '',
            s.avgApproachFpm != null ? stat('Avg approach', s.avgApproachFpm.toLocaleString(), 'last 1,000 ft') : '',
            s.stabilisedRate != null
                ? stat('Stabilised', s.stabilisedRate + '%', 'approaches', s.stabilisedRate < 70 ? '#fbbf24' : '#34d399')
                : ''
        ].filter(Boolean).join('');

        const note = s.rated === 0 && all.length
            ? '<div style="font-size:9px;color:#64748b;line-height:1.45;margin-top:10px;">'
              + `None of these ${all.length} landing${all.length > 1 ? 's were' : ' was'} sampled closely enough to `
              + 'measure the touchdown itself — position reports arrive every 15 s and a flare takes about four. '
              + 'The approach figures are measured, not estimated.</div>'
            : '';

        const body = (tiles
            ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(84px,1fr));gap:14px 10px;">${tiles}</div>`
            : '') + note;

        return ''
            + '<div class="fl-landing-log" style="margin:8px 0;background:rgba(15,23,42,0.4);border:1px solid rgba(255,255,255,0.05);border-radius:12px;padding:12px;overflow:hidden;">'
            +   '<div style="display:flex;align-items:center;gap:8px;color:#cbd5e1;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;margin-bottom:12px;">'
            +     `<i class="fa-solid fa-plane-arrival" style="color:#38bdf8;"></i> ${esc(opts.title || 'Landing log')}`
            +     `<span style="margin-left:auto;color:#64748b;font-size:10px;font-weight:600;letter-spacing:.3px;text-transform:none;">${all.length} landing${all.length > 1 ? 's' : ''}</span>`
            +   '</div>'
            +   body
            +   `<div style="margin-top:14px;">${recent.map(renderRow).join('')}</div>`
            +   (opts.scope
                    ? `<p style="margin:10px 0 0;font-size:9px;color:#64748b;line-height:1.45;">${esc(opts.scope)}</p>`
                    : '')
            + '</div>';
    }

    global.LandingRates = { detect, summarize, renderHTML, renderLogHTML, renderRow,
                            grade, gradeOf, approachVerdict, verdictOf, normalize, GRADES };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = global.LandingRates;
    }
})(typeof window !== 'undefined' ? window : this);
