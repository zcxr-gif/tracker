/**
 * flight-legs.js — dependency-free multi-leg / "previous flights" detector.
 *
 * Analyses a flight's position history (the /history breadcrumb trail) and
 * reconstructs the journey it represents: every takeoff→landing hop, so a
 * pilot who flew A→B, parked, then flew B→C shows up as two legs instead of a
 * single point-to-point line. Each completed leg is matched to the airports it
 * departed and arrived at (nearest airport in the supplied database) and
 * carries its own stats (duration, distance flown, top altitude, top speed).
 *
 * Shared by both flight-info windows exactly like flight-graph.js: detection
 * runs on the flight.js side (where the airport database lives) and the plain
 * result is rendered identically in the full avionics window and the simple
 * window (inside its iframe). Point parsing mirrors flight-graph.js so the two
 * modules agree on how to read the same trail.
 *
 * Exposes window.FlightLegs = { detect, renderHTML }.
 */
(function (global) {
    'use strict';

    // Ground/air classification and stop thresholds. Cruise ground speed is
    // hundreds of knots and taxi is tens, so a single speed cut cleanly splits
    // flight from ground ops; the time thresholds reject glitches and taxi
    // blips from being mistaken for real landings/legs.
    const GROUND_GS_KT     = 40;          // at/below this the aircraft is on the ground
    const STOP_MIN_MS      = 90 * 1000;   // sustained ground time that counts as a landing
    const MIN_LEG_MS       = 3 * 60 * 1000; // an airborne run shorter than this is noise
    const MIN_LEG_MAX_GS   = 90;          // a real leg actually reached flight speed
    const AIRPORT_RADIUS_KM = 12;         // nearest-airport match tolerance for a stop

    function num(v) { return (typeof v === 'number' && !isNaN(v)) ? v : null; }

    // --- Tolerant point readers (kept in sync with flight-graph.js) ----------
    function pointTime(p) {
        if (!p) return null;
        if (p.date) { const t = Date.parse(p.date); if (!isNaN(t)) return t; }
        if (num(p.lastReportMs) != null) return p.lastReportMs;
        if (p.position) {
            if (num(p.position.lastReportMs) != null) return p.position.lastReportMs;
            if (p.position.lastReport) { const t = Date.parse(p.position.lastReport); if (!isNaN(t)) return t; }
        }
        if (num(p.timestamp) != null) return p.timestamp;
        return null;
    }
    function pointLat(p) {
        if (!p) return null;
        let v = num(p.lat); if (v != null) return v;
        v = num(p.latitude); if (v != null) return v;
        if (p.position) { v = num(p.position.lat); if (v != null) return v; v = num(p.position.latitude); if (v != null) return v; }
        return null;
    }
    function pointLon(p) {
        if (!p) return null;
        let v = num(p.lon); if (v != null) return v;
        v = num(p.lng); if (v != null) return v;
        v = num(p.longitude); if (v != null) return v;
        if (p.position) { v = num(p.position.lon); if (v != null) return v; v = num(p.position.longitude); if (v != null) return v; }
        return null;
    }
    function pointAlt(p) {
        if (!p) return null;
        let v = num(p.altitude); if (v != null) return v;
        v = num(p.alt_ft); if (v != null) return v;
        if (p.position) { v = num(p.position.alt_ft); if (v != null) return v; v = num(p.position.altitude); if (v != null) return v; }
        return null;
    }
    function pointGs(p) {
        if (!p) return null;
        let v = num(p.groundSpeed); if (v != null) return v;
        v = num(p.gs_kt); if (v != null) return v;
        v = num(p.speed); if (v != null) return v;
        if (p.position) { v = num(p.position.gs_kt); if (v != null) return v; v = num(p.position.groundSpeed); if (v != null) return v; }
        return null;
    }

    function haversineKm(lat1, lon1, lat2, lon2) {
        const R = 6371, toRad = d => d * Math.PI / 180;
        const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // Nearest airport in the (ICAO-keyed) database to a point, within radius.
    // Returns { icao, name, lat, lon, distanceKm } or null. Scanning the whole
    // database is O(#airports), so results are memoised by ~100m-quantised
    // position: stop locations barely move between live ticks, which keeps the
    // per-tick cost of re-detection negligible after the first scan.
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
            if (d < bestD) { bestD = d; best = { icao: (a.icao || icao), name: a.name || '', lat: aLat, lon: aLon, distanceKm: d }; }
        }
        const result = (best && best.distanceKm <= AIRPORT_RADIUS_KM) ? best : null;
        if (_nearestCache.size > 500) _nearestCache.clear();
        _nearestCache.set(key, result);
        return result;
    }

    // Normalise the raw trail into a clean, chronological array of samples.
    function normalize(points) {
        if (!Array.isArray(points)) return [];
        const arr = [];
        for (const p of points) {
            const t = pointTime(p), lat = pointLat(p), lon = pointLon(p);
            if (t == null || lat == null || lon == null) continue;
            arr.push({ t, lat, lon, alt: pointAlt(p), gs: pointGs(p) });
        }
        arr.sort((a, b) => a.t - b.t);
        return arr;
    }

    /**
     * Detects the flight's legs from its position history.
     * @param {Array} points - raw /history trail points (any supported shape).
     * @param {Object} airportsData - ICAO-keyed airport DB ({ lat, lon, name }).
     * @returns {Array} legs, oldest first. Each leg:
     *   { index, depIcao, depName, arrIcao, arrName, depTime, arrTime,
     *     durationMin, distanceNm, maxAltFt, maxGsKt, inProgress }
     */
    function detect(points, airportsData) {
        const pts = normalize(points);
        if (pts.length < 2) return [];

        const grounded = (p) => (p.gs == null ? false : p.gs <= GROUND_GS_KT);

        // Maximal airborne runs (start/end indices into pts).
        const runs = [];
        let i = 0;
        while (i < pts.length) {
            if (!grounded(pts[i])) {
                let j = i;
                while (j + 1 < pts.length && !grounded(pts[j + 1])) j++;
                runs.push({ start: i, end: j });
                i = j + 1;
            } else i++;
        }
        if (!runs.length) return [];

        // Merge runs separated only by a brief ground gap (data dropouts / a
        // momentary dip below the speed cut) — those are not real landings.
        const merged = [runs[0]];
        for (let k = 1; k < runs.length; k++) {
            const prev = merged[merged.length - 1];
            const gapMs = pts[runs[k].start].t - pts[prev.end].t;
            if (gapMs < STOP_MIN_MS) prev.end = runs[k].end;
            else merged.push(runs[k]);
        }

        const legs = [];
        merged.forEach((run) => {
            const startP = pts[run.start], endP = pts[run.end];
            const landed = run.end + 1 < pts.length;      // a ground sample follows → it came down
            const inProgress = !landed;

            // Departure position: the last ground sample before rotation (falls
            // back to the first airborne sample). Arrival: the first ground
            // sample after rollout (falls back to the last airborne sample).
            const depP = run.start - 1 >= 0 ? pts[run.start - 1] : startP;
            const arrP = landed ? pts[run.end + 1] : endP;

            let maxAlt = null, maxGs = null, distNm = 0;
            for (let n = run.start; n <= run.end; n++) {
                const p = pts[n];
                if (p.alt != null) maxAlt = Math.max(maxAlt == null ? -Infinity : maxAlt, p.alt);
                if (p.gs != null) maxGs = Math.max(maxGs == null ? -Infinity : maxGs, p.gs);
                if (n > run.start) distNm += haversineKm(pts[n - 1].lat, pts[n - 1].lon, p.lat, p.lon) / 1.852;
            }

            const depTime = depP.t;
            const arrTime = arrP.t;
            if ((arrTime - depTime) < MIN_LEG_MS) return;                 // too brief to be a flight
            if (maxGs == null || maxGs < MIN_LEG_MAX_GS) return;          // never really flew

            const depApt = nearestAirport(airportsData, depP.lat, depP.lon);
            const arrApt = inProgress ? null : nearestAirport(airportsData, arrP.lat, arrP.lon);

            legs.push({
                index: legs.length,
                depIcao: depApt ? depApt.icao : null,
                depName: depApt ? depApt.name : null,
                arrIcao: arrApt ? arrApt.icao : null,
                arrName: arrApt ? arrApt.name : null,
                depTime, arrTime,
                durationMin: Math.max(0, Math.round((arrTime - depTime) / 60000)),
                distanceNm: Math.round(distNm),
                maxAltFt: (maxAlt != null && maxAlt !== -Infinity) ? Math.round(maxAlt) : null,
                maxGsKt: (maxGs != null && maxGs !== -Infinity) ? Math.round(maxGs) : null,
                inProgress
            });
        });

        // Re-index after filtering so index reflects journey order.
        legs.forEach((l, idx) => { l.index = idx; });
        return legs;
    }

    // ---------------------------------------------------------------- render --

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
    function fmtDur(min) {
        if (min == null) return '--';
        const h = Math.floor(min / 60), m = min % 60;
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }
    function fmtAlt(ft) {
        if (ft == null) return null;
        return ft >= 18000 ? 'FL' + Math.round(ft / 100) : Math.round(ft).toLocaleString() + ' ft';
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

    /**
     * Renders the "Previous Flights" panel from detect()'s output.
     * @param {Array} legs
     * @param {Object} [opts] - { includeInProgress:false, title:'Previous Flights' }
     * @returns {string} HTML (empty string when there is nothing to show).
     */
    function renderHTML(legs, opts) {
        opts = opts || {};
        const list = (legs || []).filter(l => opts.includeInProgress ? true : !l.inProgress);
        if (!list.length) return '';

        const totalNm = list.reduce((s, l) => s + (l.distanceNm || 0), 0);
        const title = esc(opts.title || 'Previous Flights');
        const subtitle = `${list.length} leg${list.length > 1 ? 's' : ''}`
            + (totalNm > 0 ? ` · ${totalNm.toLocaleString()} nm flown` : '');

        const rows = list.map((l) => {
            const stats = [];
            stats.push(`<i class="fa-solid fa-clock" style="opacity:.6;"></i> ${fmtUtc(l.depTime)}–${fmtUtc(l.arrTime)}Z`);
            if (l.durationMin != null) stats.push(`<i class="fa-solid fa-hourglass-half" style="opacity:.6;"></i> ${fmtDur(l.durationMin)}`);
            if (l.distanceNm)   stats.push(`<i class="fa-solid fa-ruler" style="opacity:.6;"></i> ${l.distanceNm.toLocaleString()} nm`);
            const alt = fmtAlt(l.maxAltFt);
            if (alt)            stats.push(`<i class="fa-solid fa-mountain" style="opacity:.6;"></i> ${alt}`);
            if (l.maxGsKt)      stats.push(`<i class="fa-solid fa-gauge-high" style="opacity:.6;"></i> ${l.maxGsKt} kt`);

            return ''
                + '<div style="display:flex;gap:10px;padding:10px 0;border-top:1px solid rgba(255,255,255,0.05);">'
                +   `<div style="flex:0 0 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;width:22px;">`
                +     `<span style="font-size:9px;font-weight:800;color:#64748b;letter-spacing:.5px;">${l.index + 1}</span>`
                +     '<i class="fa-solid fa-plane" style="font-size:10px;color:#38bdf8;transform:rotate(45deg);margin-top:3px;"></i>'
                +   '</div>'
                +   '<div style="flex:1 1 auto;min-width:0;">'
                +     '<div style="display:flex;align-items:center;gap:8px;font-size:14px;line-height:1;">'
                +       icaoChip(l.depIcao)
                +       '<i class="fa-solid fa-arrow-right-long" style="font-size:11px;color:#475569;"></i>'
                +       icaoChip(l.arrIcao)
                +     '</div>'
                +     (l.depName || l.arrName
                        ? `<div style="font-size:10px;color:#94a3b8;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(l.depName || '')}${l.arrName ? ' → ' + esc(l.arrName) : ''}</div>`
                        : '')
                +     `<div style="display:flex;flex-wrap:wrap;gap:5px 12px;margin-top:6px;font-size:10px;color:#cbd5e1;font-weight:600;">${stats.join('')}</div>`
                +   '</div>'
                + '</div>';
        }).join('');

        return ''
            + '<div class="fl-legs-card" style="margin:8px 0;background:rgba(15,23,42,0.4);border:1px solid rgba(255,255,255,0.05);border-radius:12px;padding:12px;overflow:hidden;">'
            +   '<div style="display:flex;align-items:center;gap:8px;color:#cbd5e1;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;">'
            +     `<i class="fa-solid fa-route" style="color:#38bdf8;"></i> ${title}`
            +     `<span style="margin-left:auto;color:#64748b;font-size:10px;font-weight:600;letter-spacing:.3px;text-transform:none;">${esc(subtitle)}</span>`
            +   '</div>'
            +   rows
            + '</div>';
    }

    global.FlightLegs = { detect, renderHTML, normalize };
})(typeof window !== 'undefined' ? window : this);
