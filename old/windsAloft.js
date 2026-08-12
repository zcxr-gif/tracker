/**
 * windsAloft.js — upper-air wind and temperature field for a flight.
 *
 * The app already asks Open-Meteo for weather, but it asks for `temperature_2m`
 * and `wind_speed_10m` — conditions two metres and ten metres above the ground
 * — and hands them to code that believes it is receiving the conditions at the
 * aircraft. For an aeroplane in the cruise both are badly wrong: the outside
 * air temperature at FL370 is around −57 °C, not the +18 °C on the ground
 * below it, and the wind there can be a 130 kt jet stream where the surface
 * shows eight knots. Fuel burn is very sensitive to both (density sets the
 * drag, temperature sets the engine's specific fuel consumption, and the wind
 * is the entire difference between ground speed and true airspeed), so this
 * module fetches the real thing.
 *
 * It requests Open-Meteo's pressure-level data — free, no key, the same host
 * the app already uses — at several columns spread along the route, hourly,
 * covering the whole time the flight has been airborne. The result is a small
 * four-dimensional field that can be sampled at any (lat, lon, altitude, time)
 * the flown path passes through.
 *
 * Two details worth knowing:
 *
 *   • Pressure levels map onto *pressure altitude*, which is exactly what an
 *     aircraft's barometric altimeter reports and therefore exactly what the
 *     tracked altitude already is. Converting a flight level to a pressure
 *     through the standard atmosphere is the definition of the thing, not an
 *     approximation, so no geopotential-height correction is needed.
 *
 *   • Wind directions are interpolated as vectors, never as angles. Averaging
 *     350° and 010° as numbers gives 180° — a wind blowing the opposite way.
 *
 * Every failure path is silent and total: no network, a bad response, a
 * missing level — the caller gets null and falls back to whatever it did
 * before. A fuel estimate is never worth breaking a flight window over.
 *
 * Exposes window.WindsAloft = { get, buildField, PRESSURE_LEVELS_HPA, pressureAltitudeFt }.
 */
(function (global) {
    'use strict';

    // Pressure levels to request, hPa. Chosen to bracket everything from the
    // circuit to the cruise ceiling with enough resolution through the climb,
    // where a large share of a flight's fuel is spent. More levels would cost
    // response size for very little accuracy once log-pressure interpolation
    // is doing the work between them.
    const PRESSURE_LEVELS_HPA = [925, 850, 700, 600, 500, 400, 300, 250, 200, 150];

    // Standard-atmosphere constants, matching fuelEstimator.js exactly so the
    // two modules never disagree about what altitude a pressure corresponds to.
    const P0 = 101325, T0 = 288.15, LAPSE = 0.0065, G0 = 9.80665, R_AIR = 287.053;
    const TROPO_M = 11000, T_TROPO = 216.65, P_TROPO = 22632.06;
    const FT_TO_M = 0.3048;

    /** Pressure (Pa) → pressure altitude (ft) through the standard atmosphere. */
    function pressureAltitudeFt(pa) {
        let h;
        if (pa >= P_TROPO) {
            h = (T0 / LAPSE) * (1 - Math.pow(pa / P0, (LAPSE * R_AIR) / G0));
        } else {
            h = TROPO_M + (R_AIR * T_TROPO / G0) * Math.log(P_TROPO / pa);
        }
        return h / FT_TO_M;
    }

    /** Pressure altitude (ft) → pressure (Pa). Inverse of the above. */
    function pressureAtAltFt(altFt) {
        const h = altFt * FT_TO_M;
        if (h < TROPO_M) return P0 * Math.pow((T0 - LAPSE * h) / T0, G0 / (LAPSE * R_AIR));
        return P_TROPO * Math.exp(-G0 * (h - TROPO_M) / (R_AIR * T_TROPO));
    }

    // Precomputed once: the altitude each requested level sits at.
    const LEVEL_ALT_FT = PRESSURE_LEVELS_HPA.map(hpa => pressureAltitudeFt(hpa * 100));

    // ── Vector helpers ────────────────────────────────────────────────────
    // Meteorological convention: a wind "from 270°" blows toward the east.
    function toUV(dirDeg, spdKt) {
        const r = (dirDeg || 0) * Math.PI / 180;
        return { u: -spdKt * Math.sin(r), v: -spdKt * Math.cos(r) };
    }
    function fromUV(u, v) {
        return {
            spdKt: Math.sqrt(u * u + v * v),
            dirDeg: (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360
        };
    }

    function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }

    function distanceNm(lat1, lon1, lat2, lon2) {
        const rad = Math.PI / 180;
        const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
        const a = Math.sin(dLat / 2) ** 2
            + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
        return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) / 1.852;
    }

    /**
     * Turn one Open-Meteo location response into a column: a time-ordered set
     * of vertical profiles. Tolerant by design — a level the model didn't
     * return is simply left out and interpolation spans the gap.
     */
    function parseColumn(res, lat, lon) {
        const h = res && res.hourly;
        if (!h || !Array.isArray(h.time) || !h.time.length) return null;

        // `timeformat=unixtime` gives seconds; older/ISO responses are parsed.
        const times = h.time.map(t => (typeof t === 'number' ? t * 1000 : Date.parse(t)))
            .map(t => (isFinite(t) ? t : null));

        const levels = [];
        PRESSURE_LEVELS_HPA.forEach((hpa, i) => {
            const T = h['temperature_' + hpa + 'hPa'];
            const S = h['wind_speed_' + hpa + 'hPa'];
            const D = h['wind_direction_' + hpa + 'hPa'];
            if (!Array.isArray(T) || !Array.isArray(S) || !Array.isArray(D)) return;
            levels.push({ hpa, altFt: LEVEL_ALT_FT[i], T, S, D });
        });
        if (!levels.length) return null;

        // The surface pair anchors the bottom of the profile, below the lowest
        // pressure level (925 hPa is already ~2,500 ft up).
        // Open-Meteo reports the model's terrain elevation in metres; the
        // surface pair belongs at that height, not at sea level.
        const sfcElevFt = num(res.elevation) != null ? res.elevation / FT_TO_M : 0;
        const sfc = {
            T: h.temperature_2m, S: h.wind_speed_10m, D: h.wind_direction_10m,
            altFt: sfcElevFt
        };
        const haveSfc = Array.isArray(sfc.T) && Array.isArray(sfc.S) && Array.isArray(sfc.D);

        return {
            lat: num(res.latitude) != null ? res.latitude : lat,
            lon: num(res.longitude) != null ? res.longitude : lon,
            times, levels, sfc: haveSfc ? sfc : null
        };
    }

    /**
     * Sample one column at an altitude and time.
     * Interpolates linearly in time between the bracketing hours and in
     * log-pressure between the bracketing levels (log-p is how the atmosphere
     * actually stratifies; linear-in-altitude would bias the upper levels).
     */
    function sampleColumn(col, altFt, tMs) {
        const times = col.times;
        // Bracketing hours.
        let i1 = 0;
        while (i1 < times.length - 1 && times[i1 + 1] != null && times[i1 + 1] <= tMs) i1++;
        const i2 = Math.min(times.length - 1, i1 + 1);
        const t1 = times[i1], t2 = times[i2];
        const wt = (t2 != null && t1 != null && t2 > t1)
            ? Math.max(0, Math.min(1, (tMs - t1) / (t2 - t1))) : 0;

        // Assembling and sorting a column's profile is the hot path — a long
        // trail samples the same handful of hours thousands of times — so each
        // hour's profile is built once and kept on the column.
        if (!col.__profiles) col.__profiles = [];
        const profileAt = (idx) => {
            if (col.__profiles[idx] !== undefined) return col.__profiles[idx];
            const stops = [];
            if (col.sfc) {
                const T = num(col.sfc.T[idx]), S = num(col.sfc.S[idx]), D = num(col.sfc.D[idx]);
                if (T != null && S != null && D != null) {
                    stops.push({ altFt: col.sfc.altFt || 0, T, S, D });
                }
            }
            for (const lv of col.levels) {
                const T = num(lv.T[idx]), S = num(lv.S[idx]), D = num(lv.D[idx]);
                if (T != null && S != null && D != null) stops.push({ altFt: lv.altFt, T, S, D });
            }
            stops.sort((a, b) => a.altFt - b.altFt);
            // Pre-convert to vector components so the sampler never re-does it.
            for (const st of stops) { const uv = toUV(st.D, st.S); st.u = uv.u; st.v = uv.v; }
            col.__profiles[idx] = stops.length ? stops : null;
            return col.__profiles[idx];
        };

        const at = (idx) => {
            const stops = profileAt(idx);
            if (!stops) return null;

            // Below the lowest stop or above the highest: hold the end value
            // rather than extrapolate a jet stream into the stratosphere.
            if (altFt <= stops[0].altFt) return stops[0];
            if (altFt >= stops[stops.length - 1].altFt) return stops[stops.length - 1];

            let k = 0;
            while (k < stops.length - 2 && stops[k + 1].altFt < altFt) k++;
            const a = stops[k], b = stops[k + 1];
            // Weight in log-pressure: the atmosphere stratifies by pressure,
            // so interpolating linearly in altitude would bias the thin upper
            // levels. Uses the exact standard-atmosphere pressure, the same
            // relation that put each level at its altitude in the first place.
            const la = Math.log(pressureAtAltFt(a.altFt));
            const lb = Math.log(pressureAtAltFt(b.altFt));
            const lx = Math.log(pressureAtAltFt(altFt));
            const f = (lb !== la) ? Math.max(0, Math.min(1, (lx - la) / (lb - la)))
                : (b.altFt !== a.altFt ? (altFt - a.altFt) / (b.altFt - a.altFt) : 0);
            return {
                T: a.T + (b.T - a.T) * f,
                u: a.u + (b.u - a.u) * f,
                v: a.v + (b.v - a.v) * f
            };
        };

        const s1 = at(i1), s2 = at(i2);
        if (!s1 && !s2) return null;
        const a = s1 || s2, b = s2 || s1;
        return {
            T: a.T + (b.T - a.T) * wt,
            u: a.u + (b.u - a.u) * wt,
            v: a.v + (b.v - a.v) * wt
        };
    }

    /**
     * Assemble sampled columns into a field object with a sample() method.
     * Horizontal blending is inverse-distance over the two nearest columns,
     * which is smooth along a route and cannot overshoot the data.
     */
    function buildField(columns, meta) {
        const cols = (columns || []).filter(Boolean);
        if (!cols.length) return null;

        return {
            source: 'open-meteo',
            columns: cols.length,
            fetchedAt: Date.now(),
            meta: meta || {},

            /**
             * @returns {{oatC:number, windDirDeg:number, windSpdKt:number,
             *            u:number, v:number}|null}
             */
            sample(lat, lon, altFt, tMs) {
                if (!isFinite(altFt)) return null;
                const t = isFinite(tMs) ? tMs : Date.now();

                let picks;
                if (cols.length === 1 || !isFinite(lat) || !isFinite(lon)) {
                    picks = [{ c: cols[0], w: 1 }];
                } else {
                    const ranked = cols
                        .map(c => ({ c, d: distanceNm(lat, lon, c.lat, c.lon) }))
                        .sort((a, b) => a.d - b.d)
                        .slice(0, 2);
                    // Exactly on a column: use it outright.
                    if (ranked[0].d < 1) picks = [{ c: ranked[0].c, w: 1 }];
                    else {
                        const w0 = 1 / ranked[0].d, w1 = 1 / Math.max(1, ranked[1].d);
                        const sum = w0 + w1;
                        picks = [{ c: ranked[0].c, w: w0 / sum }, { c: ranked[1].c, w: w1 / sum }];
                    }
                }

                let T = 0, u = 0, v = 0, wSum = 0;
                for (const p of picks) {
                    const s = sampleColumn(p.c, altFt, t);
                    if (!s) continue;
                    T += s.T * p.w; u += s.u * p.w; v += s.v * p.w; wSum += p.w;
                }
                if (wSum <= 0) return null;
                T /= wSum; u /= wSum; v /= wSum;
                const w = fromUV(u, v);
                return { oatC: T, windDirDeg: w.dirDeg, windSpdKt: w.spdKt, u, v };
            }
        };
    }

    // ── Fetching ──────────────────────────────────────────────────────────
    const _cache = new Map();
    const _inflight = new Map();
    const CACHE_TTL_MS = 20 * 60 * 1000;   // upper winds are forecast hourly
    const MAX_COLUMNS = 3;                 // keeps the response modest

    function buildUrl(points, pastDays, forecastDays) {
        const vars = ['temperature_2m', 'wind_speed_10m', 'wind_direction_10m'];
        for (const hpa of PRESSURE_LEVELS_HPA) {
            vars.push('temperature_' + hpa + 'hPa',
                      'wind_speed_' + hpa + 'hPa',
                      'wind_direction_' + hpa + 'hPa');
        }
        return 'https://api.open-meteo.com/v1/forecast'
            + '?latitude=' + points.map(p => p.lat.toFixed(3)).join(',')
            + '&longitude=' + points.map(p => p.lon.toFixed(3)).join(',')
            + '&hourly=' + vars.join(',')
            + '&wind_speed_unit=kn'
            + '&timeformat=unixtime'
            + '&past_days=' + pastDays
            + '&forecast_days=' + forecastDays;
    }

    /**
     * Fetch (or return cached) upper-air data for a route.
     *
     * @param {Array<{lat:number, lon:number}>} route  points to sample along —
     *        typically origin, current position and destination. Thinned to
     *        MAX_COLUMNS and de-duplicated.
     * @param {Object} [opts] { spanHours: how far back the flight started }
     * @returns {Promise<Object|null>} a field with .sample(), or null.
     */
    function get(route, opts) {
        opts = opts || {};
        const pts = [];
        for (const p of (route || [])) {
            if (!p || !isFinite(p.lat) || !isFinite(p.lon)) continue;
            // Drop points that would land in the same model cell anyway.
            if (pts.some(q => distanceNm(q.lat, q.lon, p.lat, p.lon) < 60)) continue;
            pts.push({ lat: p.lat, lon: p.lon });
            if (pts.length >= MAX_COLUMNS) break;
        }
        if (!pts.length) return Promise.resolve(null);

        // Enough history to cover the whole flight, and a day ahead for the
        // portion still to be flown. Open-Meteo counts `past_days` from
        // midnight, so one day already reaches at least 24 h back — plenty for
        // any single leg, and half the payload of asking for two.
        const pastDays = Math.max(1, Math.min(3, Math.ceil((opts.spanHours || 0) / 24)));
        const key = pts.map(p => p.lat.toFixed(1) + ',' + p.lon.toFixed(1)).join('|') + '|' + pastDays;

        const hit = _cache.get(key);
        if (hit && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.field);
        if (_inflight.has(key)) return _inflight.get(key);

        const req = fetch(buildUrl(pts, pastDays, 2))
            .then(r => (r.ok ? r.json() : null))
            .then(json => {
                if (!json) return null;
                // Open-Meteo returns an array when several locations are asked
                // for and a bare object for one.
                const list = Array.isArray(json) ? json : [json];
                const cols = list.map((res, i) => parseColumn(res, pts[i] && pts[i].lat, pts[i] && pts[i].lon));
                const field = buildField(cols, { levels: PRESSURE_LEVELS_HPA.length, pastDays });
                if (_cache.size > 24) _cache.clear();
                _cache.set(key, { at: Date.now(), field });
                return field;
            })
            .catch(() => null)
            .then(field => { _inflight.delete(key); return field; });

        _inflight.set(key, req);
        return req;
    }

    global.WindsAloft = {
        get, buildField, parseColumn,
        PRESSURE_LEVELS_HPA, pressureAltitudeFt, pressureAtAltFt, LEVEL_ALT_FT
    };

})(typeof window !== 'undefined' ? window : this);
