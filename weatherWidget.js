/**
 * weatherWidget.js — Apple Maps-style weather pill for the flight window.
 *
 * A small glass pill pinned to the top-left of the map that appears ONLY
 * while the flight info window (#aircraft-info-window) is being displayed.
 * Collapsed it shows the destination airport's condition icon + temperature;
 * tapping it expands a popover with full METAR details for both the
 * departure and arrival airports.
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

    const state = {
        ctx: null,          // { flightId, depIcao, arrIcao }
        metars: { dep: null, arr: null },
        fetchedAt: 0,
        fetchSeq: 0,        // guards against out-of-order fetches
        windowShown: false,
        popoverOpen: false,
        refreshTimer: null,
    };

    let root = null, pill = null, popover = null;

    // ── Icon selection from a parsed METAR ─────────────────────────────────
    function iconFor(parsed) {
        const raw = parsed?.raw || '';
        if (/\bTS/.test(raw)) return 'fa-cloud-bolt';
        if (/\b(?:\+|-)?(?:SH)?(?:SN|SG|PL|IC|GS|GR)\b/.test(raw)) return 'fa-snowflake';
        if (/\b(?:\+|-)?(?:SH|FZ)?(?:RA|DZ)\b/.test(raw)) return 'fa-cloud-rain';
        if (/\b(FG|BR|HZ|FU|DU|SA|VA)\b/.test(raw)) return 'fa-smog';
        const cover = parsed?.clouds?.[0]?.cover;
        if (cover === 'BKN' || cover === 'OVC' || cover === 'VV') return 'fa-cloud';
        if (cover === 'FEW' || cover === 'SCT') return 'fa-cloud-sun';
        return 'fa-sun';
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
        document.addEventListener('click', (e) => {
            if (state.popoverOpen && !e.target.closest('#wx-widget-root')) setPopover(false);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && state.popoverOpen) setPopover(false);
        });
    }

    // ── Rendering ──────────────────────────────────────────────────────────
    // The pill leads with the arrival airport — the weather a pilot is
    // flying toward — and falls back to departure when no arrival is known.
    function primaryStation() {
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
        pill.innerHTML = `
            <i class="fa-solid ${p ? iconFor(p) : 'fa-cloud'} wx-pill-icon"></i>
            <span class="wx-pill-temp">${temp}</span>
            <span class="wx-pill-meta">
                <span class="wx-pill-icao">${esc(st.icao)}</span>
                ${wind && wind !== '—' ? `<span class="wx-pill-wind">${esc(wind)}</span>` : ''}
            </span>
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
                    <span class="temp"><i class="fa-solid ${iconFor(p)}"></i>${p.tempC !== null ? `${p.tempC}°C` : '—'}</span>
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
        popover.innerHTML = `
            <div class="wx-pop-head">
                <span class="title">Route Weather</span>
                <span class="age">${ageLabel()}</span>
            </div>
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
            state.refreshTimer = setInterval(() => {
                if (state.windowShown && state.ctx) fetchMetars(true);
            }, REFRESH_MS);
        } else if (!show && state.refreshTimer) {
            clearInterval(state.refreshTimer);
            state.refreshTimer = null;
        }
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

        if (changed) {
            state.metars = { dep: null, arr: null };
            state.fetchedAt = 0;
            setPopover(false);
            renderPill();
            fetchMetars();
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
    window.FlightWeatherWidget = { setContext, syncVisibility: () => syncVisibility() };
})();
