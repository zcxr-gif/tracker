/**
 * weatherWidget.js — Apple Maps-style weather pill for the flight window.
 *
 * A small glass pill pinned to the top-left of the map that appears ONLY
 * while the flight info window (#aircraft-info-window) is being displayed.
 * Collapsed it shows conditions where the aircraft currently IS — the METAR
 * station nearest its live position — with a sun/moon icon that reflects the
 * actual local day/night at the aircraft (solar altitude, not the viewer's
 * clock). When the aircraft sits inside an active SIGMET / AIRMET polygon
 * (via the app's Netlify hazard proxy) the pill grows a pulsing warning
 * badge tinted by the worst hazard. Tapping expands a popover with active
 * hazards at the aircraft, that nearby station, and full METAR details for
 * the departure and arrival airports.
 *
 * Wiring:
 *  • flight.js dispatches `flight-window-weather` with
 *    { flightId, depIcao, arrIcao } when a flight window opens — that is the
 *    widget's only data feed (METARs come from window.WeatherService).
 *  • Visibility mirrors the window element's classes via a MutationObserver:
 *    `visible` on desktop; on the mobile sheet (`mobile-legacy-sheet`) the
 *    pill shows only in the `peek` state — the fully-expanded sheet covers
 *    the screen, so the pill hides until the sheet drops back to peek. Every
 *    open / close / minimize / trip-card path funnels through those classes,
 *    so the pill can never outlive the window.
 */

(function () {
    'use strict';

    const REFRESH_MS = 10 * 60 * 1000; // METARs update at most every 10 min
    const POSITION_MS = 60 * 1000;     // re-read the aircraft position every minute
    const SIGMET_TTL_MS = 5 * 60 * 1000; // advisories: match the proxy's cache window

    // Same origin shim flight.js uses: inside the native app (capacitor://)
    // or local dev, relative netlify-function calls must hit production.
    const SIGMET_URL = (() => {
        const isLocalOrApp = window.location.hostname === 'localhost'
            || window.location.protocol === 'file:'
            || window.location.protocol === 'capacitor:';
        const origin = isLocalOrApp ? 'https://inflight.info' : window.location.origin;
        return `${origin}/.netlify/functions/sigmets`;
    })();

    const state = {
        ctx: null,          // { flightId, depIcao, arrIcao, lat, lon }
        position: null,     // latest known aircraft position { lat, lon }
        nowStation: null,   // nearest METAR station to the aircraft { icao, parsed, km }
        metars: { dep: null, arr: null },
        fetchedAt: 0,
        fetchSeq: 0,        // guards against out-of-order fetches
        nowSeq: 0,          // same, for the nearest-station resolution
        sigmets: [],        // cached advisory features (polygons + metadata)
        sigmetsAt: 0,       // when they were fetched
        sigmetSeq: 0,
        hazardsHere: [],    // advisories whose polygon contains the aircraft
        windowShown: false,
        popoverOpen: false,
        refreshTimer: null,
        positionTimer: null,
    };

    let root = null, pill = null, popover = null;

    // ── Day / night at a coordinate ────────────────────────────────────────
    // Solar altitude via the standard low-precision solar position formulas
    // (SunCalc-style). Below -6° (civil twilight) counts as night, so the
    // icon flips to the moon roughly when the sky actually gets dark where
    // the aircraft is right now.
    function isNightAt(lat, lon, date = new Date()) {
        if (lat == null || lon == null) return false;
        const rad = Math.PI / 180;
        const d = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 86400000;
        const g = (357.529 + 0.98560028 * d) * rad;                  // mean anomaly
        const q = 280.459 + 0.98564736 * d;                          // mean longitude
        const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad;
        const e = (23.439 - 0.00000036 * d) * rad;                   // obliquity
        const RA = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
        const dec = Math.asin(Math.sin(e) * Math.sin(L));
        const GMST = (18.697374558 + 24.06570982441908 * d) % 24;
        const H = (((GMST + lon / 15) % 24) * 15 * rad) - RA;        // hour angle
        const sinAlt = Math.sin(lat * rad) * Math.sin(dec)
                     + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(H);
        return (Math.asin(sinAlt) / rad) < -6;
    }

    // ── Icon selection from a parsed METAR + local day/night ───────────────
    // Composite glyphs so the pill reads like a tiny weather scene: rain
    // streaks under the cloud, the sun or moon peeking through light rain or
    // scattered cloud, a bolt under the cloud in thunderstorms.
    function iconFor(parsed, night = false) {
        const raw = parsed?.raw || '';
        const cover = parsed?.clouds?.[0]?.cover;
        const shut = cover === 'BKN' || cover === 'OVC' || cover === 'VV';

        if (/\bTS/.test(raw)) return 'fa-cloud-bolt';                       // lightning under the cloud
        if (/\b(?:\+|-)?(?:SH)?(?:SN|SG|PL|IC|GS|GR)\b/.test(raw)) return 'fa-snowflake';
        if (/\b(?:\+|-)?(?:SH|FZ)?(?:RA|DZ)\b/.test(raw)) {
            // Heavy rain, or a shut sky: rain streaks under a full cloud.
            if (/\+(?:SH|FZ)?(?:RA|DZ)/.test(raw) || shut) return 'fa-cloud-showers-heavy';
            // Lighter rain with the sun / moon still visible behind it.
            return night ? 'fa-cloud-moon-rain' : 'fa-cloud-sun-rain';
        }
        if (/\b(FG|BR|HZ|FU|DU|SA|VA)\b/.test(raw)) return 'fa-smog';
        if (shut) return 'fa-cloud';
        if (cover === 'FEW' || cover === 'SCT') return night ? 'fa-cloud-moon' : 'fa-cloud-sun';
        if ((parsed?.windSpeed || 0) >= 25 || (parsed?.windGust || 0) >= 35) return 'fa-wind';
        return night ? 'fa-moon' : 'fa-sun';
    }

    /** Day/night for a station: prefer its airport coordinates, falling back
     *  to the aircraft's position (they're near each other for the NEAR row). */
    function nightForStation(icao) {
        const coords = (typeof window.getAirportCoords === 'function' ? window.getAirportCoords(icao) : null)
            || state.position;
        return coords ? isNightAt(coords.lat, coords.lon) : false;
    }

    function fmtWind(p) {
        if (!p || (!p.windSpeed && p.windDir === null && !p.windVariable)) return '—';
        if (!p.windSpeed) return 'Calm';
        const dir = p.windVariable ? 'VRB' : (p.windDir !== null ? String(p.windDir).padStart(3, '0') + '°' : '—');
        return `${dir} @ ${p.windSpeed} kt${p.windGust ? ` G${p.windGust}` : ''}`;
    }

    function fmtClouds(p) {
        if (!p) return '—';
        if (p.ceiling !== null) return `Ceiling ${p.ceiling.toLocaleString()} ft`;
        if (p.clouds && p.clouds.length) return `${p.clouds[0].label} ${p.clouds[0].base.toLocaleString()} ft`;
        return p.conditionLabel === '—' ? '—' : (p.conditionLabel || '—');
    }

    function fmtQnh(p) {
        if (!p || (p.altimeterInHg === null && p.altimeterHpa === null)) return '—';
        const parts = [];
        if (p.altimeterInHg !== null) parts.push(`${p.altimeterInHg.toFixed(2)} inHg`);
        if (p.altimeterHpa !== null) parts.push(`${p.altimeterHpa} hPa`);
        return parts.join(' / ');
    }

    function ageLabel() {
        if (!state.fetchedAt) return '';
        const min = Math.floor((Date.now() - state.fetchedAt) / 60000);
        return min < 1 ? 'updated just now' : `updated ${min} min ago`;
    }

    function esc(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // ── DOM ────────────────────────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById('wx-widget-styles')) return;
        const style = document.createElement('style');
        style.id = 'wx-widget-styles';
        style.textContent = `
            #wx-widget-root {
                position: fixed;
                top: 14px;
                left: 14px;
                z-index: 2050; /* above the map chrome, below the info window (2100) */
                font-family: var(--font-ui, 'Inter', -apple-system, sans-serif);
                display: none;
                transition: left 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            }
            #wx-widget-root.wx-shown {
                display: flex;
                flex-direction: column;
                align-items: flex-start; /* pill keeps its own width when the popover is open */
            }
            /* Flight window docked to the left edge — slide out of its way. */
            @media (min-width: 993px) {
                #wx-widget-root.wx-shifted { left: 494px; }
            }
            /* Colors, radii and fonts come from the same :root theme variables
               the flight info window paints with (--iw-bg-*, --border-glass…),
               so the pill re-tints live whenever the window theme changes. */
            #wx-pill {
                display: flex;
                align-items: center;
                gap: 9px;
                padding: 9px 13px;
                background: linear-gradient(135deg, var(--iw-bg-start, rgba(45,45,45,0.9)), var(--iw-bg-end, rgba(45,45,45,0.9)));
                backdrop-filter: blur(40px) saturate(140%);
                -webkit-backdrop-filter: blur(40px) saturate(140%);
                border: 1px solid var(--border-glass, rgba(255,255,255,0.1));
                border-radius: var(--radius-lg, 16px);
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
                cursor: pointer;
                color: var(--text-primary, #fafafa);
                user-select: none;
                -webkit-tap-highlight-color: transparent;
                transition: transform 0.18s ease, border-color 0.18s ease;
                animation: wx-fade-in 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            }
            #wx-pill:hover { border-color: var(--border-highlight, rgba(255,255,255,0.15)); }
            #wx-pill:active { transform: scale(0.96); }
            #wx-pill .wx-pill-icon { font-size: 17px; color: var(--text-secondary, #a1a1aa); }
            #wx-pill .wx-pill-temp { font-size: 17px; font-weight: 700; letter-spacing: -0.3px; }
            #wx-pill .wx-pill-meta {
                display: flex;
                flex-direction: column;
                line-height: 1.15;
            }
            #wx-pill .wx-pill-icao {
                font-family: var(--font-data, ui-monospace, monospace);
                font-size: 10px;
                font-weight: 700;
                color: var(--text-dim, #94a3b8);
                letter-spacing: 0.04em;
            }
            #wx-pill .wx-pill-wind { font-size: 10px; color: var(--text-secondary, #a1a1aa); white-space: nowrap; }
            #wx-pill .wx-pill-hazard {
                display: inline-flex;
                align-items: center;
                gap: 3px;
                margin-left: 2px;
                font-size: 13px;
                animation: wx-haz-pulse 1.8s ease-in-out infinite;
            }
            #wx-pill .wx-pill-hazard .n {
                font-size: 10px;
                font-weight: 800;
            }
            @keyframes wx-haz-pulse {
                0%, 100% { opacity: 1; }
                50%      { opacity: 0.55; }
            }
            @keyframes wx-fade-in {
                from { opacity: 0; transform: translateY(-8px); }
                to   { opacity: 1; transform: translateY(0); }
            }
            #wx-popover {
                display: none;
                margin-top: 10px;
                width: min(330px, calc(100vw - 28px));
                background: linear-gradient(135deg, var(--iw-bg-start, rgba(45,45,45,0.9)), var(--iw-bg-end, rgba(45,45,45,0.9)));
                backdrop-filter: blur(40px) saturate(140%);
                -webkit-backdrop-filter: blur(40px) saturate(140%);
                border: 1px solid var(--border-glass, rgba(255,255,255,0.1));
                border-radius: var(--radius-lg, 16px);
                box-shadow: 0 18px 44px rgba(0, 0, 0, 0.55);
                color: var(--text-primary, #fafafa);
                overflow: hidden;
                animation: wx-fade-in 0.32s cubic-bezier(0.16, 1, 0.3, 1);
            }
            #wx-widget-root.wx-open #wx-popover { display: block; }
            .wx-pop-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 12px 15px 10px;
                border-bottom: 1px solid var(--border-glass, rgba(255,255,255,0.1));
            }
            .wx-pop-head .title { font-size: 12.5px; font-weight: 700; color: var(--text-primary, #fafafa); }
            .wx-pop-head .age { font-size: 10px; color: var(--text-secondary, #a1a1aa); }
            .wx-hazards {
                padding: 4px 0;
                border-bottom: 1px solid var(--border-glass, rgba(255,255,255,0.1));
            }
            .wx-haz {
                display: flex;
                gap: 10px;
                padding: 8px 15px;
            }
            .wx-haz > i { font-size: 13px; margin-top: 2px; flex: 0 0 auto; }
            .wx-haz-main { min-width: 0; flex: 1; }
            .wx-haz-title {
                display: flex;
                align-items: baseline;
                justify-content: space-between;
                gap: 8px;
                font-size: 12px;
                font-weight: 700;
                color: var(--text-primary, #fafafa);
            }
            .wx-haz-title .until {
                font-size: 10px;
                font-weight: 600;
                color: var(--text-secondary, #a1a1aa);
                white-space: nowrap;
            }
            .wx-haz-src { font-size: 10.5px; color: var(--text-secondary, #a1a1aa); margin-top: 1px; }
            .wx-haz-raw {
                margin-top: 4px;
                font-family: var(--font-data, ui-monospace, monospace);
                font-size: 9px;
                line-height: 1.45;
                color: var(--text-dim, #94a3b8);
                word-break: break-word;
                display: -webkit-box;
                -webkit-line-clamp: 3;
                -webkit-box-orient: vertical;
                overflow: hidden;
            }
            .wx-station { padding: 11px 15px; }
            .wx-station + .wx-station { border-top: 1px solid var(--border-glass, rgba(255,255,255,0.1)); }
            .wx-station-top {
                display: flex;
                align-items: baseline;
                gap: 8px;
                margin-bottom: 8px;
            }
            .wx-station-top .tag {
                font-size: 9px;
                font-weight: 800;
                letter-spacing: 0.08em;
                color: var(--text-secondary, #a1a1aa);
                text-transform: uppercase;
            }
            .wx-station-top .icao {
                font-family: var(--font-data, ui-monospace, monospace);
                font-size: 13.5px;
                font-weight: 700;
                color: var(--text-primary, #fafafa);
            }
            .wx-station-top .temp { margin-left: auto; font-size: 15px; font-weight: 700; color: var(--text-primary, #fafafa); }
            .wx-station-top .temp i { font-size: 12px; margin-right: 5px; color: var(--text-secondary, #a1a1aa); }
            .wx-rows { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; }
            .wx-row { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; }
            .wx-row .k { color: var(--text-secondary, #a1a1aa); }
            .wx-row .v { color: var(--text-primary, #fafafa); font-weight: 600; text-align: right; white-space: nowrap; }
            .wx-raw {
                margin-top: 8px;
                font-family: var(--font-data, ui-monospace, monospace);
                font-size: 9.5px;
                line-height: 1.5;
                color: var(--text-dim, #94a3b8);
                word-break: break-word;
            }
            .wx-unavailable { font-size: 11px; color: var(--text-secondary, #a1a1aa); }
        `;
        document.head.appendChild(style);
    }

    function injectDom() {
        if (document.getElementById('wx-widget-root')) return;
        root = document.createElement('div');
        root.id = 'wx-widget-root';
        root.innerHTML = `
            <div id="wx-pill" role="button" aria-label="Route weather" aria-expanded="false" tabindex="0"></div>
            <div id="wx-popover"></div>
        `;
        document.body.appendChild(root);
        pill = root.querySelector('#wx-pill');
        popover = root.querySelector('#wx-popover');

        pill.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePopover();
        });
        pill.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePopover(); }
        });
        // Capture phase: while the popover is open, a click anywhere else
        // dismisses it and goes no further — the map and the flight window
        // never see the event, so dismissing the weather widget can't close
        // the flight info window (or select another flight) underneath.
        document.addEventListener('click', (e) => {
            if (!state.popoverOpen || e.target.closest('#wx-widget-root')) return;
            e.stopPropagation();
            e.preventDefault();
            setPopover(false);
        }, true);
        // Same for Escape: consume it for the popover instead of letting the
        // app's own Escape handlers close the whole window.
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || !state.popoverOpen) return;
            e.stopPropagation();
            setPopover(false);
        }, true);
    }

    // ── SIGMET / AIRMET awareness ──────────────────────────────────────────
    // Hazard-code → label / colour / severity rank. Colours mirror the map's
    // SIGMET layer so the badge and the layer tell the same story.
    const HAZARDS = {
        TS: { label: 'Convective', color: '#ff3b30', rank: 0 },
        TSGR: { label: 'Convective', color: '#ff3b30', rank: 0 },
        TC: { label: 'Tropical cyclone', color: '#ff3b30', rank: 0 },
        CONVECTIVE: { label: 'Convective', color: '#ff3b30', rank: 0 },
        TURB: { label: 'Turbulence', color: '#ff9500', rank: 1 },
        ICE: { label: 'Icing', color: '#00bfff', rank: 2 },
        ICING: { label: 'Icing', color: '#00bfff', rank: 2 },
        MTW: { label: 'Mountain wave', color: '#bf5af2', rank: 3 },
        VA: { label: 'Volcanic ash', color: '#8e8e93', rank: 4 },
        ASH: { label: 'Volcanic ash', color: '#8e8e93', rank: 4 },
        DS: { label: 'Dust storm', color: '#d4a017', rank: 5 },
        SS: { label: 'Sandstorm', color: '#d4a017', rank: 5 },
        IFR: { label: 'IFR conditions', color: '#34c759', rank: 6 },
        'MTN OBSCN': { label: 'Mountain obscuration', color: '#34c759', rank: 6 },
    };
    const hazardMeta = (code) => HAZARDS[String(code || '').toUpperCase()]
        || { label: code || 'Advisory', color: '#888888', rank: 9 };

    // Even-odd ray casting across every ring, so polygon holes are honoured.
    function pointInRings(lat, lon, rings) {
        let inside = false;
        for (const ring of rings) {
            for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                const [xi, yi] = ring[i], [xj, yj] = ring[j]; // [lon, lat]
                if (((yi > lat) !== (yj > lat)) &&
                    (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
                    inside = !inside;
                }
            }
        }
        return inside;
    }

    function pointInFeature(lat, lon, geometry) {
        if (!geometry) return false;
        if (geometry.type === 'Polygon') return pointInRings(lat, lon, geometry.coordinates || []);
        if (geometry.type === 'MultiPolygon') {
            return (geometry.coordinates || []).some(poly => pointInRings(lat, lon, poly));
        }
        return false;
    }

    // AWC mixes ISO strings (isigmet) and epoch seconds (airsigmet).
    function parseAwcTime(v) {
        if (v == null) return null;
        if (typeof v === 'number') return v * (v < 1e12 ? 1000 : 1);
        const t = Date.parse(v);
        return Number.isNaN(t) ? null : t;
    }

    async function fetchSigmets(force = false) {
        if (!force && Date.now() - state.sigmetsAt < SIGMET_TTL_MS) return;
        if (state.sigmetsLoading) return;
        state.sigmetsLoading = true;
        const seq = ++state.sigmetSeq;
        try {
            const res = await fetch(SIGMET_URL);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const geojson = await res.json();
            if (seq !== state.sigmetSeq) return;
            state.sigmets = Array.isArray(geojson?.features)
                ? geojson.features.filter(f => f && f.geometry)
                : [];
            state.sigmetsAt = Date.now();
        } catch (_) {
            // Advisory feed down — keep whatever we had; the pill just won't
            // warn rather than erroring out.
            if (seq === state.sigmetSeq) state.sigmetsAt = Date.now();
        }
        state.sigmetsLoading = false;
        evaluateHazards();
    }

    /** Re-test which advisories contain the aircraft's current position. */
    function evaluateHazards() {
        const pos = state.position;
        if (!pos) {
            state.hazardsHere = [];
            return;
        }
        const now = Date.now();
        const hits = [];
        for (const f of state.sigmets) {
            const p = f.properties || {};
            const until = parseAwcTime(p.validTimeTo);
            if (until && until < now) continue; // expired advisory
            if (!pointInFeature(pos.lat, pos.lon, f.geometry)) continue;
            const meta = hazardMeta(p.hazard);
            const lo = p.base ?? p.altitudeLow1 ?? null;
            const hi = p.top ?? p.altitudeHi1 ?? null;
            hits.push({
                label: meta.label,
                color: meta.color,
                rank: meta.rank,
                qualifier: p.qualifier || p.severity || '',
                source: [p.firName, p.icaoId].filter(Boolean).join(' · '),
                band: (lo || hi) ? `${lo ? Number(lo).toLocaleString() : 'SFC'}–${hi ? Number(hi).toLocaleString() : '∞'} ft` : '',
                until,
                raw: p.rawSigmet || p.rawAirSigmet || '',
            });
        }
        hits.sort((a, b) => a.rank - b.rank);
        state.hazardsHere = hits;
        renderPill();
        if (state.popoverOpen) renderPopover();
    }

    // ── Rendering ──────────────────────────────────────────────────────────
    // The pill leads with the weather where the aircraft currently IS (the
    // nearest METAR station to its live position), falling back to arrival
    // then departure when the position or a nearby station is unknown.
    function primaryStation() {
        if (state.nowStation) return state.nowStation;
        if (state.ctx?.arrIcao && state.metars.arr) return { icao: state.ctx.arrIcao, parsed: state.metars.arr };
        if (state.ctx?.depIcao && state.metars.dep) return { icao: state.ctx.depIcao, parsed: state.metars.dep };
        const icao = state.ctx?.arrIcao || state.ctx?.depIcao || null;
        return icao ? { icao, parsed: null } : null;
    }

    function renderPill() {
        const st = primaryStation();
        if (!st) return;
        const p = st.parsed;
        const temp = (p && p.tempC !== null) ? `${p.tempC}°` : '--°';
        const wind = p ? fmtWind(p) : '';
        // The pill's sun/moon reflects the local time at the aircraft itself.
        const night = state.position
            ? isNightAt(state.position.lat, state.position.lon)
            : nightForStation(st.icao);
        // Hazard badge: the aircraft is inside at least one active SIGMET /
        // AIRMET polygon — tinted by the most severe hazard present.
        const haz = state.hazardsHere;
        const hazBadge = haz.length
            ? `<span class="wx-pill-hazard" style="color:${haz[0].color};" title="${esc(haz.map(h => h.label).join(', '))}">
                   <i class="fa-solid fa-triangle-exclamation"></i>${haz.length > 1 ? `<span class="n">${haz.length}</span>` : ''}
               </span>`
            : '';
        pill.innerHTML = `
            <i class="fa-solid ${p ? iconFor(p, night) : 'fa-cloud'} wx-pill-icon"></i>
            <span class="wx-pill-temp">${temp}</span>
            <span class="wx-pill-meta">
                <span class="wx-pill-icao">${esc(st.icao)}</span>
                ${wind && wind !== '—' ? `<span class="wx-pill-wind">${esc(wind)}</span>` : ''}
            </span>
            ${hazBadge}
        `;
    }

    function stationHTML(tag, icao, p) {
        if (!icao) return '';
        if (!p || p.raw === 'Not Available') {
            return `
                <div class="wx-station">
                    <div class="wx-station-top">
                        <span class="tag">${tag}</span>
                        <span class="icao">${esc(icao)}</span>
                    </div>
                    <div class="wx-unavailable">No METAR available for this station.</div>
                </div>`;
        }
        return `
            <div class="wx-station">
                <div class="wx-station-top">
                    <span class="tag">${tag}</span>
                    <span class="icao">${esc(icao)}</span>
                    <span class="temp"><i class="fa-solid ${iconFor(p, nightForStation(icao))}"></i>${p.tempC !== null ? `${p.tempC}°C` : '—'}</span>
                </div>
                <div class="wx-rows">
                    <div class="wx-row"><span class="k">Wind</span><span class="v">${esc(fmtWind(p))}</span></div>
                    <div class="wx-row"><span class="k">Visibility</span><span class="v">${esc(p.visibility || '—')}</span></div>
                    <div class="wx-row"><span class="k">Clouds</span><span class="v">${esc(fmtClouds(p))}</span></div>
                    <div class="wx-row"><span class="k">Dewpoint</span><span class="v">${p.dewpointC !== null ? `${p.dewpointC}°C` : '—'}</span></div>
                    <div class="wx-row" style="grid-column: 1 / -1;"><span class="k">Altimeter</span><span class="v">${esc(fmtQnh(p))}</span></div>
                </div>
                <div class="wx-raw">${esc(p.raw)}</div>
            </div>`;
    }

    function renderPopover() {
        if (!state.ctx) return;
        // NEAR = the station closest to where the aircraft is right now.
        // Skip it when it duplicates a route airport the popover already shows.
        const now = state.nowStation;
        const nowIsRoute = now && (now.icao === state.ctx.depIcao || now.icao === state.ctx.arrIcao);
        const nowHTML = (now && !nowIsRoute)
            ? stationHTML(now.km != null ? `NEAR · ${Math.round(now.km)} km` : 'NEAR', now.icao, now.parsed)
            : '';
        // Active hazards at the aircraft's position, most severe first.
        const hazHTML = state.hazardsHere.length ? `
            <div class="wx-hazards">
                ${state.hazardsHere.map(h => {
                    const untilStr = h.until
                        ? `until ${new Date(h.until).toISOString().slice(11, 16)}Z`
                        : '';
                    return `
                    <div class="wx-haz">
                        <i class="fa-solid fa-triangle-exclamation" style="color:${h.color};"></i>
                        <div class="wx-haz-main">
                            <div class="wx-haz-title">
                                <span>${esc([h.qualifier, h.label].filter(Boolean).join(' '))}</span>
                                <span class="until">${esc([h.band, untilStr].filter(Boolean).join(' · '))}</span>
                            </div>
                            ${h.source ? `<div class="wx-haz-src">${esc(h.source)}</div>` : ''}
                            ${h.raw ? `<div class="wx-haz-raw">${esc(h.raw)}</div>` : ''}
                        </div>
                    </div>`;
                }).join('')}
            </div>` : '';
        popover.innerHTML = `
            <div class="wx-pop-head">
                <span class="title">Route Weather</span>
                <span class="age">${ageLabel()}</span>
            </div>
            ${hazHTML}
            ${nowHTML}
            ${stationHTML('DEP', state.ctx.depIcao, state.metars.dep)}
            ${stationHTML('ARR', state.ctx.arrIcao, state.metars.arr)}
        `;
    }

    function setPopover(open) {
        state.popoverOpen = open;
        root.classList.toggle('wx-open', open);
        pill.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) renderPopover();
    }

    function togglePopover() { setPopover(!state.popoverOpen); }

    // ── Visibility sync (mirrors the flight window's classes) ──────────────
    function syncVisibility() {
        const win = document.getElementById('aircraft-info-window');
        let shown = false;
        if (win) {
            if (win.classList.contains('mobile-legacy-sheet')) {
                // Mobile sheet: the fully-expanded sheet covers the screen, so
                // the pill only shows while the sheet is in its peek state.
                shown = win.classList.contains('peek');
            } else {
                shown = win.classList.contains('visible');
            }
        }
        state.windowShown = shown;

        const show = shown && !!state.ctx && !!(state.ctx.depIcao || state.ctx.arrIcao);
        root.classList.toggle('wx-shown', show);
        root.classList.toggle('wx-shifted', !!win && win.classList.contains('dock-left'));
        if (!show && state.popoverOpen) setPopover(false);

        if (show && !state.refreshTimer) {
            fetchSigmets(); // hydrate advisories as soon as the pill appears
            state.refreshTimer = setInterval(() => {
                if (state.windowShown && state.ctx) {
                    fetchMetars(true);
                    resolveNowStation(true);
                    fetchSigmets(true);
                }
            }, REFRESH_MS);
        } else if (!show && state.refreshTimer) {
            clearInterval(state.refreshTimer);
            state.refreshTimer = null;
        }

        // Track the aircraft while the pill is up: refresh its position from
        // the live feed so the nearest station and the day/night icon follow
        // the flight instead of freezing at where it was when clicked.
        if (show && !state.positionTimer) {
            state.positionTimer = setInterval(updateAircraftPosition, POSITION_MS);
        } else if (!show && state.positionTimer) {
            clearInterval(state.positionTimer);
            state.positionTimer = null;
        }
    }

    function updateAircraftPosition() {
        if (!state.ctx?.flightId) return;
        try {
            // Keyed lookup where available — the fallback scan materialises an
            // array of every flight on the server just to find one.
            const feature = (typeof window.getLiveFlightById === 'function')
                ? window.getLiveFlightById(state.ctx.flightId)
                : (typeof window.getLiveFlightData === 'function'
                    ? window.getLiveFlightData().find(f =>
                        (f.properties?.flightId || null) === state.ctx.flightId)
                    : null);
            const coords = feature?.geometry?.coordinates;
            if (coords && coords.length >= 2) {
                state.position = { lat: coords[1], lon: coords[0] };
                resolveNowStation();
                evaluateHazards();
            }
        } catch (_) { /* live feed unavailable — keep the last known position */ }
        // Even without movement the sun sets: keep the day/night icon honest.
        renderPill();
        if (state.popoverOpen) renderPopover();
    }

    function observeWindow() {
        const win = document.getElementById('aircraft-info-window');
        if (!win) {
            // The window element is created after DOMContentLoaded — retry
            // until it exists, then observe it for the rest of the session.
            setTimeout(observeWindow, 1000);
            return;
        }
        new MutationObserver(syncVisibility).observe(win, { attributes: true, attributeFilter: ['class'] });
        syncVisibility();
    }

    // ── Data ───────────────────────────────────────────────────────────────
    /**
     * Resolve the METAR station nearest to the aircraft's current position.
     * airports.json holds thousands of strips that never publish METARs, so
     * walk the closest proper-ICAO candidates and keep the first that
     * actually returns one.
     */
    async function resolveNowStation(force = false) {
        if (!state.position || typeof window.findNearestAirports !== 'function' || !window.WeatherService) return;
        const seq = ++state.nowSeq;
        const prevIcao = state.nowStation?.icao || null;

        const candidates = window.findNearestAirports(state.position.lat, state.position.lon, 4);
        for (const cand of candidates) {
            // Same station as before — keep it (just refresh the distance)
            // unless this is the periodic refresh, which refetches its METAR.
            if (cand.icao === prevIcao && !force) {
                state.nowStation.km = cand.km;
                break;
            }
            const parsed = await window.WeatherService.fetchAndParseMetar(cand.icao).catch(() => null);
            if (seq !== state.nowSeq) return; // superseded by a newer resolve
            if (parsed && parsed.raw !== 'Not Available') {
                state.nowStation = { icao: cand.icao, parsed, km: cand.km };
                break;
            }
        }

        renderPill();
        if (state.popoverOpen) renderPopover();
    }

    async function fetchMetars(isRefresh = false) {
        if (!state.ctx || !window.WeatherService) return;
        const seq = ++state.fetchSeq;
        const { depIcao, arrIcao } = state.ctx;

        const [dep, arr] = await Promise.all([
            depIcao ? window.WeatherService.fetchAndParseMetar(depIcao).catch(() => null) : Promise.resolve(null),
            arrIcao ? window.WeatherService.fetchAndParseMetar(arrIcao).catch(() => null) : Promise.resolve(null),
        ]);

        if (seq !== state.fetchSeq) return; // a newer flight superseded this fetch

        state.metars.dep = dep;
        state.metars.arr = arr;
        state.fetchedAt = Date.now();
        renderPill();
        if (state.popoverOpen) renderPopover();
        if (!isRefresh) syncVisibility();
    }

    function setContext(detail) {
        const depIcao = (detail?.depIcao || '').toUpperCase() || null;
        const arrIcao = (detail?.arrIcao || '').toUpperCase() || null;
        const changed = !state.ctx
            || state.ctx.flightId !== detail?.flightId
            || state.ctx.depIcao !== depIcao
            || state.ctx.arrIcao !== arrIcao;

        state.ctx = { flightId: detail?.flightId || null, depIcao, arrIcao };
        if (detail?.lat != null && detail?.lon != null) {
            state.position = { lat: detail.lat, lon: detail.lon };
        } else if (changed) {
            state.position = null;
        }

        if (changed) {
            state.metars = { dep: null, arr: null };
            state.nowStation = null;
            state.nowSeq++;
            state.fetchedAt = 0;
            setPopover(false);
            renderPill();
            fetchMetars();
            resolveNowStation();
            evaluateHazards();
            fetchSigmets();
        }
        syncVisibility();
    }

    // ── Boot ───────────────────────────────────────────────────────────────
    function init() {
        injectStyles();
        injectDom();
        observeWindow();
        window.addEventListener('flight-window-weather', (e) => setContext(e.detail));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Exposed for debugging / tests
    window.FlightWeatherWidget = {
        setContext,
        syncVisibility: () => syncVisibility(),
        _tick: () => updateAircraftPosition(),
    };
})();
