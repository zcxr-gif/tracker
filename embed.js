/**
 * embed.js — Inflight "Active VA Pilots" embed.
 *
 * A self-contained widget a Virtual Airline can drop onto their own website to
 * show their currently-airborne pilots, pulled live from the same Infinite
 * Flight session data that powers the main tracker. Loaded by embed.html.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * TWO RENDER MODES
 *   • roster  — a live list of the VA's active pilots. Uses NO Mapbox at all,
 *               so it costs the VA (and us) zero map loads. This is the default.
 *   • map     — a live map with each pilot plotted. Mapbox GL bills *map loads*
 *               to whoever owns the access token, so map mode REQUIRES the VA to
 *               supply their OWN Mapbox public token. Those loads then hit the
 *               VA's Mapbox account, never ours.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * HOW A VA IS AUTHORISED — backend-issued embed tokens
 *
 * The embed is configured by a single opaque token the VA is issued by the
 * InGdo backend (the same service that serves community aircraft photos and
 * /api/va-ads). The VA pastes one iframe onto their site:
 *
 *     <iframe
 *       src="https://indgo-va.netlify.app/embed.html?token=THE_ISSUED_TOKEN"
 *       style="width:100%;height:520px;border:0"
 *       loading="lazy"></iframe>
 *
 * On load the embed calls:
 *
 *     GET {INGDO_BACKEND}/api/embed/resolve?token=<token>&origin=<embedding-origin>
 *
 * …which the backend implements to validate the token and return the VA's
 * embed config. THIS ENDPOINT IS THE PIECE TO BUILD ON THE BACKEND. Expected
 * shapes:
 *
 *   200 OK
 *   {
 *     "ok": true,
 *     "va":   { "code": "OCEAN", "name": "Ocean Virtual", "logo": "https://…" },
 *     "callsignPrefixes": ["OCEAN"],          // optional; defaults to [va.code]
 *     "mode": "map",                          // "map" | "roster"  (default "roster")
 *     "mapboxToken": "pk.eyJ…",               // REQUIRED when mode === "map"; the VA's own token
 *     "mapStyle": "mapbox://styles/mapbox/dark-v11",   // optional
 *     "theme": "dark",                        // "dark" | "light"  (optional)
 *     "servers": ["Expert"]                   // optional; IF session names to scan (substring match). [] = all
 *   }
 *
 *   4xx  { "ok": false, "error": "expired" }  // invalid / expired / revoked / origin-not-allowed
 *
 * The backend owns issuance: it decides which VA a token maps to, stores the
 * VA's Mapbox token, can restrict by embedding origin, and can revoke. Nothing
 * here needs to change when that lands — the client already calls /resolve.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * PREVIEW MODE (no backend required yet)
 *
 * Until /api/embed/resolve exists, the embed can be driven directly from query
 * params so you can build and demo it today:
 *
 *     embed.html?va=OCEAN&name=Ocean%20Virtual&mode=roster
 *     embed.html?va=OCEAN&name=Ocean%20Virtual&mode=map&mapboxToken=pk.eyJ…
 *
 * If a `token` is present it always takes precedence and is resolved via the
 * backend. Direct params are ignored once a token is supplied.
 */
(function () {
    'use strict';

    // ── Endpoints ────────────────────────────────────────────────────────────
    // Same hosts the main tracker talks to. The ACARS backend is public (no key)
    // and serves the live IF session + flight data.
    const INGDO_BACKEND = 'https://site--indgo-backend--6dmjph8ltlhv.code.run';
    const ACARS_BACKEND = 'https://site--acars-backend--6dmjph8ltlhv.code.run';
    const SESSIONS_URL  = `${ACARS_BACKEND}/if-sessions`;
    const FLIGHTS_BASE  = `${ACARS_BACKEND}/flights`;
    const HISTORY_BASE  = `${ACARS_BACKEND}/api/flights`;   // flown-trail breadcrumb
    const RESOLVE_URL   = `${INGDO_BACKEND}/api/embed/resolve`;
    const VAADS_URL     = `${INGDO_BACKEND}/api/va-ads`;

    const REFRESH_MS = 30000;          // live data poll cadence
    const MAPBOX_GL_VERSION = 'v3.9.1'; // CDN version loaded only in map mode

    // ── Tiny helpers ──────────────────────────────────────────────────────────
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Leading callsign word, upper-cased — "Ocean XXVA" / "Ocean 123" → "OCEAN".
    // Mirrors vaAds.js so the matching here behaves identically to the tracker.
    function firstToken(s) {
        return String(s || '').trim().toUpperCase().split(/[\s\-_/]+/)[0] || '';
    }

    // Aircraft name → sprite category. Ported verbatim from flight.js
    // getAircraftCategory so the embed plots the same silhouette the live map
    // would for any given airframe. Returns a key that exists in markers.png.
    function getAircraftCategory(aircraftName) {
        if (!aircraftName) return 'default';
        const name = aircraftName.toUpperCase();
        if (['F-16', 'F-18', 'F-22', 'F-35', 'A-10', 'EUFI'].some(ac => name.includes(ac))) return 'F16';
        if (['C-130', 'C130', 'AC-130'].some(ac => name.includes(ac))) return 'C130';
        if (name.includes('C-17') || name.includes('C5')) return 'C17';
        if (name.includes('A380') || name.includes('A388')) return 'A380';
        if (name.includes('747')) return 'B747';
        if (name.includes('777') || name.includes('B77')) return 'B777';
        if (name.includes('787') || name.includes('B78')) return 'B787';
        if (name.includes('A350') || name.includes('A359')) return 'A350';
        if (name.includes('A330') || name.includes('A333') || name.includes('A339')) return 'A330';
        if (name.includes('DC-10') || name.includes('MD-11')) return 'A330';
        if (name.includes('737') || name.includes('B73') || name.includes('B38M')) return 'B737';
        if (name.includes('A320') || name.includes('A321') || name.includes('A319') || name.includes('A20N') || name.includes('A21N')) return 'A320';
        if (name.includes('757') || name.includes('B75')) return 'B757';
        if (name.includes('CRJ') || name.includes('E175') || name.includes('E190')) return 'E190';
        if (name.includes('DASH 8') || name.includes('DH8D') || name.includes('Q400')) return 'DASH8';
        if (['C172', 'SR22', 'CESSNA', 'SINGLEPROP'].some(ac => name.includes(ac))) return 'SINGLEPROP';
        if (['EUROCOPTER', 'H60', 'H64', 'CHINOOK', 'LYNX'].some(ac => name.includes(ac))) return 'EUROCOPTER';
        return 'B737';
    }

    async function getJSON(url, opts) {
        const res = await fetch(url, Object.assign({ headers: { Accept: 'application/json' } }, opts || {}));
        if (!res.ok) {
            const err = new Error(`Request failed (${res.status})`);
            err.status = res.status;
            throw err;
        }
        return res.json();
    }

    function qp() {
        try { return new URLSearchParams(window.location.search); }
        catch (_) { return new URLSearchParams(); }
    }

    function rootEl() { return document.getElementById('inflight-embed'); }

    // ── Config resolution ─────────────────────────────────────────────────────
    // Returns a normalised config object, or throws with a user-facing message.
    async function resolveConfig() {
        const p = qp();
        const token = p.get('token');

        if (token) {
            // Backend-gated path. The origin is forwarded so the backend can
            // optionally restrict a token to specific embedding sites.
            const origin = (() => {
                try { return document.referrer ? new URL(document.referrer).origin : ''; }
                catch (_) { return ''; }
            })();
            let payload;
            try {
                payload = await getJSON(
                    `${RESOLVE_URL}?token=${encodeURIComponent(token)}&origin=${encodeURIComponent(origin)}`
                );
            } catch (e) {
                if (e.status === 401 || e.status === 403) throw new Error('This embed token is invalid or not allowed on this site.');
                if (e.status === 404 || e.status === 410) throw new Error('This embed token has expired or been revoked.');
                throw new Error('Couldn’t reach the embed service. Please try again later.');
            }
            if (!payload || payload.ok === false) {
                throw new Error(payload && payload.error
                    ? `Embed unavailable: ${payload.error}`
                    : 'This embed token could not be verified.');
            }
            return normalizeConfig(payload);
        }

        // Preview path — drive straight from query params (no backend needed).
        const va = (p.get('va') || '').trim();
        if (!va) {
            throw new Error('Missing embed token. Add ?token=… to the embed URL (or ?va=CODE for a preview).');
        }
        // A param can appear more than once (e.g. appending &mode=map to a URL
        // that already had mode=roster). Prefer an explicit "map" anywhere over
        // the first value, and trim stray whitespace from each candidate.
        const modes = p.getAll('mode').map(m => m.trim().toLowerCase());
        const mode = modes.includes('map') ? 'map' : (modes[0] || 'roster');
        return normalizeConfig({
            va: { code: va, name: (p.get('name') || va).trim(), logo: (p.get('logo') || '').trim() },
            callsignPrefixes: p.get('prefixes') ? p.get('prefixes').split(',') : null,
            mode: mode,
            mapboxToken: p.get('mapboxToken') || '',
            mapStyle: (p.get('mapStyle') || '').trim(),
            theme: (p.get('theme') || '').trim(),
            servers: p.get('servers') ? p.get('servers').split(',') : null
        });
    }

    function normalizeConfig(raw) {
        const va = raw.va || {};
        const code = firstToken(va.code || va.callsign || '');
        if (!code) throw new Error('Embed config is missing a VA callsign code.');

        const prefixes = (Array.isArray(raw.callsignPrefixes) && raw.callsignPrefixes.length
            ? raw.callsignPrefixes
            : [code]
        ).map(firstToken).filter(Boolean);

        let mode = (String(raw.mode || '').trim().toLowerCase() === 'map') ? 'map' : 'roster';
        const mapboxToken = String(raw.mapboxToken || '').trim();
        // Map mode silently degrades to roster if no token was issued — better a
        // working list than a broken map.
        if (mode === 'map' && !/^pk\./.test(mapboxToken)) mode = 'roster';

        return {
            code,
            name: va.name || code,
            logo: /^https?:\/\//i.test(va.logo || '') ? va.logo : '',
            prefixes,
            mode,
            mapboxToken,
            mapStyle: raw.mapStyle || 'mapbox://styles/mapbox/dark-v11',
            theme: (raw.theme === 'light') ? 'light' : 'dark',
            servers: Array.isArray(raw.servers) ? raw.servers.map(s => String(s).trim()).filter(Boolean) : []
        };
    }

    // ── Partner VA branding ─────────────────────────────────────────────────────
    // Pull the VA's real name + logo from the VA-Ads roster (same data the main
    // tracker uses) so preview embeds — and any token that didn't carry a logo —
    // still show proper partner branding. Best-effort; never throws.
    async function resolveVaBranding(code) {
        try {
            const data = await getJSON(`${VAADS_URL}?search=${encodeURIComponent(code)}&limit=20`);
            const arr = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : []);
            if (!arr.length) return null;
            // Prefer the ad whose callsign code matches exactly; else first hit.
            let hit = arr.find(a => firstToken(a.callsign || a.callsignCode || a.code) === code) || arr[0];
            if (!hit) return null;
            const rawLogo = hit.logo || hit.logoUrl || hit.logo_url || '';
            return {
                name: hit.name || hit.vaName || hit.title || '',
                logo: /^https?:\/\//i.test(rawLogo) ? rawLogo : ''
            };
        } catch (_) {
            return null;
        }
    }

    // ── Live data ──────────────────────────────────────────────────────────────
    // Does a flight callsign belong to this VA? Same rule as vaAds.matchCallsign:
    // the callsign's leading token must start with one of the VA's prefixes.
    function callsignMatches(callsign, prefixes) {
        const tok = firstToken(callsign);
        if (!tok) return false;
        return prefixes.some(pfx => tok.startsWith(pfx));
    }

    function normalizeFlight(f, serverName, sessionId) {
        const pos = f.position || {};
        const lat = pos.lat ?? pos.latitude;
        const lon = pos.lon ?? pos.longitude;
        const ac = f.aircraft || {};
        return {
            flightId: f.flightId,
            sessionId: sessionId || '',
            callsign: f.callsign || '',
            username: f.username || f.virtualOrgName || '',
            aircraft: ac.aircraftName || f.aircraftName || '',
            livery: ac.liveryName || f.liveryName || '',
            depIcao: f.departureIcao || '',
            arrIcao: f.arrivalIcao || '',
            category: getAircraftCategory(ac.aircraftName || f.aircraftName || ''),
            lat: (lat == null ? null : Number(lat)),
            lon: (lon == null ? null : Number(lon)),
            altitude: Math.round(pos.alt_ft || f.altitude || 0),
            speed: Math.round(pos.gs_kt || f.groundSpeed || 0),
            heading: Math.round(pos.heading_deg || f.heading || 0),
            server: serverName || ''
        };
    }

    // Pull every active pilot for this VA across the relevant IF sessions.
    async function fetchActivePilots(cfg) {
        const sj = await getJSON(SESSIONS_URL);
        let sessions = (sj && Array.isArray(sj.sessions)) ? sj.sessions : [];
        if (cfg.servers.length) {
            const wanted = cfg.servers.map(s => s.toLowerCase());
            sessions = sessions.filter(s =>
                wanted.some(w => String(s.name || '').toLowerCase().includes(w)));
        }
        if (!sessions.length) return [];

        const perSession = await Promise.allSettled(sessions.map(async (s) => {
            if (!s || !s.id) return [];
            const fj = await getJSON(`${FLIGHTS_BASE}/${s.id}`);
            const flights = fj.flights || fj.data || (Array.isArray(fj) ? fj : []);
            return flights
                .filter(f => f && callsignMatches(f.callsign, cfg.prefixes))
                .map(f => normalizeFlight(f, s.name, s.id));
        }));

        const out = [];
        for (const r of perSession) if (r.status === 'fulfilled') out.push(...r.value);
        // Sort by callsign for a stable roster ordering.
        out.sort((a, b) => a.callsign.localeCompare(b.callsign));
        return out;
    }

    // ── Shared chrome ───────────────────────────────────────────────────────────
    function headerHTML(cfg, count) {
        const logo = cfg.logo
            ? `<img class="emb-logo" src="${esc(cfg.logo)}" alt="" onerror="this.style.display='none'">`
            : `<div class="emb-logo emb-logo-fallback">${esc(cfg.code.slice(0, 2))}</div>`;
        return `
            <div class="emb-head">
                ${logo}
                <div class="emb-head-meta">
                    <div class="emb-head-name">${esc(cfg.name)}</div>
                    <div class="emb-head-sub"><span class="emb-live-dot"></span> ${count} pilot${count === 1 ? '' : 's'} airborne</div>
                </div>
                <a class="emb-brand" href="https://indgo-va.netlify.app" target="_blank" rel="noopener" title="Powered by Inflight">
                    <span class="emb-brand-by">Powered by</span>
                    <img class="emb-brand-logo" src="Images/inflight.png" alt="Inflight" onerror="this.outerHTML='Inflight'">
                </a>
            </div>`;
    }

    function pilotRowHTML(p) {
        const route = (p.depIcao || p.arrIcao)
            ? `${esc(p.depIcao || '—')} → ${esc(p.arrIcao || '—')}`
            : '';
        const acLine = [p.aircraft, p.livery].filter(Boolean).join(' · ');
        return `
            <div class="emb-row">
                <div class="emb-row-main">
                    <div class="emb-row-top">
                        <span class="emb-callsign">${esc(p.callsign || p.flightId)}</span>
                        ${p.username ? `<span class="emb-pilot">${esc(p.username)}</span>` : ''}
                    </div>
                    ${acLine ? `<div class="emb-row-ac">${esc(acLine)}</div>` : ''}
                    ${route ? `<div class="emb-row-route">${route}</div>` : ''}
                </div>
                <div class="emb-row-metrics">
                    <span><b>${p.altitude.toLocaleString()}</b> ft</span>
                    <span><b>${p.speed}</b> kt</span>
                </div>
            </div>`;
    }

    function emptyHTML(cfg) {
        return `
            <div class="emb-empty">
                <div class="emb-empty-icon">✈</div>
                <p>No ${esc(cfg.name)} pilots are airborne right now.</p>
                <span>This list updates automatically.</span>
            </div>`;
    }

    // ── Roster mode ───────────────────────────────────────────────────────────
    function renderRoster(cfg, pilots) {
        const root = rootEl();
        if (!root) return;
        root.innerHTML = `
            ${headerHTML(cfg, pilots.length)}
            <div class="emb-body">
                ${pilots.length ? pilots.map(pilotRowHTML).join('') : emptyHTML(cfg)}
            </div>`;
    }

    // ── Map mode ────────────────────────────────────────────────────────────────
    let _mapLoaded = false;
    function loadMapboxGL() {
        if (_mapLoaded) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const css = document.createElement('link');
            css.rel = 'stylesheet';
            css.href = `https://api.mapbox.com/mapbox-gl-js/${MAPBOX_GL_VERSION}/mapbox-gl.css`;
            document.head.appendChild(css);

            const js = document.createElement('script');
            js.src = `https://api.mapbox.com/mapbox-gl-js/${MAPBOX_GL_VERSION}/mapbox-gl.js`;
            js.onload = () => { _mapLoaded = true; resolve(); };
            js.onerror = () => reject(new Error('Failed to load Mapbox GL JS.'));
            document.head.appendChild(js);
        });
    }

    // ── Tap card (matches the desktop map hover card) ───────────────────────────
    const LOOKUP_URL = `${INGDO_BACKEND}/api/aircraft/lookup`;
    const DEFAULT_AC_IMG = '/CommunityPlanes/default.png';
    const _imgCache = new Map(); // "type|livery" -> Promise<{url, credit}|null>

    // Resolve the community aircraft photo for a type+livery, same endpoint the
    // share card uses. Cached per airframe; never rejects (returns null).
    function communityImage(type, livery) {
        if (!type || !livery) return Promise.resolve(null);
        const key = `${type}|${livery}`;
        if (_imgCache.has(key)) return _imgCache.get(key);
        const pr = getJSON(`${LOOKUP_URL}?type=${encodeURIComponent(type)}&livery=${encodeURIComponent(livery)}`)
            .then(d => {
                if (Array.isArray(d)) d = d.length ? d[0] : null;
                if (!d || !d.imageUrl) return null;
                return { url: d.imageUrl, credit: d.contributorName || d.contributor || d.credit || 'IF Community' };
            })
            .catch(() => null);
        _imgCache.set(key, pr);
        return pr;
    }

    // Airline logo path — same derivation as flight.js's hover card.
    function airlineLogoPath(livery) {
        const words = String(livery || '').trim().split(/\s+/);
        const logoName = words.length > 1 && /[^a-zA-Z0-9]/.test(words[1])
            ? words[0]
            : (words[0] + (words[1] ? ' ' + words[1] : ''));
        const s = logoName.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_');
        return s ? `Images/airline_logos/${s}.png` : '';
    }

    function fr24CardHTML(pr, imgUrl, credit) {
        const callsign = pr.callsign || '---';
        const username = pr.username || 'Unknown';
        const dep = pr.depIcao || '---';
        const arr = pr.arrIcao || '---';
        const alt = Math.round(Number(pr.altitude) || 0).toLocaleString();
        const gs = Math.round(Number(pr.speed) || 0);
        const logo = airlineLogoPath(pr.livery);
        return `
            <div class="fr24-card-container">
                <div class="fr24-image-box" style="background-image:url('${esc(imgUrl)}')">
                    <div class="fr24-image-overlay"></div>
                    <div class="fr24-copyright">© ${esc(credit || 'IF Community')}</div>
                </div>
                <div class="fr24-info-box">
                    <div class="fr24-header-row">
                        ${logo ? `<img src="${esc(logo)}" class="fr24-airline-logo" onerror="this.style.display='none'">` : ''}
                        <div class="fr24-ident-group"><span class="fr24-callsign">${esc(callsign)}</span></div>
                        <span class="fr24-user" title="${esc(username)}">${esc(username)}</span>
                    </div>
                    <div class="fr24-route-premium">
                        <span class="fr24-route-code" style="color:#f8fafc">${esc(dep)}</span>
                        <div class="fr24-route-line">
                            <div class="seg"></div>
                            <svg class="glyph" width="12" height="12" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M2 2L22 12L2 22L6 12L2 2Z" fill="#ffffff"/></svg>
                        </div>
                        <span class="fr24-route-code" style="color:#94a3b8">${esc(arr)}</span>
                    </div>
                    <div class="fr24-stats-row">
                        <span><b>${alt}</b> <span class="u">FT</span></span>
                        <span><b>${gs}</b> <span class="u">KTS</span></span>
                    </div>
                    ${vaChipHTML(_mapState.cfg)}
                </div>
            </div>`;
    }

    // Partner VA badge (logo + name) shown on every tap card so the VA's
    // branding rides along with each of their pilots.
    function vaChipHTML(cfg) {
        if (!cfg) return '';
        const logo = cfg.logo
            ? `<img class="fr24-va-logo" src="${esc(cfg.logo)}" alt="" onerror="this.style.display='none'">`
            : '';
        return `
            <div class="fr24-va">
                ${logo}
                <span class="fr24-va-name">${esc(cfg.name)}</span>
                <span class="fr24-va-tag">Partner VA</span>
            </div>`;
    }

    const SOURCE_ID = 'va-pilots';
    const LAYER_ID = 'va-pilots-layer';
    const SPRITE_URL = './markers.png';

    // On-tap flight path layers (flown trail behind + filed plan ahead). Drawn
    // lazily for the single tapped flight and cleared when its popup closes, so
    // we only ever load one flight's geometry at a time.
    const FLOWN_SRC = 'emb-flown-src',   FLOWN_LYR = 'emb-flown-lyr';
    const PLAN_SRC  = 'emb-plan-src',    PLAN_LYR  = 'emb-plan-lyr';

    function removeFlightPaths(map) {
        if (!map) return;
        [FLOWN_LYR, PLAN_LYR].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
        [FLOWN_SRC, PLAN_SRC].forEach(id => { if (map.getSource(id)) map.removeSource(id); });
    }

    // Flatten an IF flight plan (which can nest waypoints under `children`) into
    // an ordered [lon, lat] array, skipping null-island placeholders. Mirrors
    // flight.js flattenWaypointsFromPlan.
    function flattenPlanWaypoints(items) {
        const out = [];
        const walk = (arr) => {
            if (!Array.isArray(arr)) return;
            for (const item of arr) {
                if (Array.isArray(item.children) && item.children.length) {
                    walk(item.children);
                } else if (item.location
                    && typeof item.location.longitude === 'number'
                    && typeof item.location.latitude === 'number'
                    && (item.location.latitude !== 0 || item.location.longitude !== 0)) {
                    out.push([item.location.longitude, item.location.latitude]);
                }
            }
        };
        walk(items);
        return out;
    }

    // Fetch the tapped flight's flown trail (history) + filed plan and draw them.
    // Solid light-blue trail behind the aircraft, dashed magenta plan ahead —
    // same palette as the main tracker.
    async function drawFlightPaths(map, pr, clickedCoords) {
        const flightId = pr.flightId, sessionId = pr.sessionId;
        if (!map || !flightId) return;

        const planUrl    = `${FLIGHTS_BASE}/${sessionId || 'default'}/${flightId}/plan`;
        const historyUrl = `${HISTORY_BASE}/${flightId}/history`;

        const [planJson, histJson] = await Promise.all([
            getJSON(planUrl).catch(() => null),
            getJSON(historyUrl).catch(() => null)
        ]);

        // The popup may have been closed (or another flight tapped) while we
        // awaited — bail rather than drawing a stale path.
        if (!map.getStyle || _mapState.activePathId !== flightId) return;

        // Flown trail.
        const histArr = (histJson && (histJson.path || histJson.route)) || [];
        const flown = Array.isArray(histArr)
            ? histArr
                .slice()
                .sort((a, b) => new Date(a.date) - new Date(b.date))
                .map(p => [p.lon ?? p.longitude, p.lat ?? p.latitude])
                .filter(c => Number.isFinite(c[0]) && Number.isFinite(c[1]))
            : [];
        if (flown.length > 1) {
            map.addSource(FLOWN_SRC, { type: 'geojson',
                data: { type: 'Feature', geometry: { type: 'LineString', coordinates: flown } } });
            map.addLayer({ id: FLOWN_LYR, type: 'line', source: FLOWN_SRC,
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: { 'line-color': '#81D4FA', 'line-width': 2.5 } }, LAYER_ID);
        }

        // Filed plan ahead — from the next waypoint onward, anchored at the plane.
        const plan = planJson && planJson.plan;
        const items = plan && Array.isArray(plan.flightPlanItems) ? plan.flightPlanItems : [];
        if (items.length) {
            const nextIdx = typeof plan.nextWaypointIndex === 'number' ? plan.nextWaypointIndex : 0;
            const wps = flattenPlanWaypoints(items.slice(nextIdx));
            const planned = [clickedCoords, ...wps];
            if (planned.length > 1) {
                map.addSource(PLAN_SRC, { type: 'geojson',
                    data: { type: 'Feature', geometry: { type: 'LineString', coordinates: planned } } });
                map.addLayer({ id: PLAN_LYR, type: 'line', source: PLAN_SRC,
                    layout: { 'line-cap': 'round', 'line-join': 'round' },
                    paint: { 'line-color': '#e84393', 'line-width': 2.5, 'line-dasharray': [2, 2] } }, LAYER_ID);
            }
        }
    }
    const SPRITE_TARGET_SIZE = 128;  // matches flight.js loadSpriteSheetAndGenerateIcons

    // Same atmosphere the live map uses (flight.js setupMapLayersAndFog) so the
    // globe reads identically — blue horizon, deep-space backdrop, faint stars.
    const EMBED_FOG = {
        'color': 'rgb(186, 210, 235)',
        'high-color': 'rgb(36, 92, 235)',
        'horizon-blend': 0.02,
        'space-color': 'rgb(27, 27, 54)',
        'star-intensity': 0.3
    };

    // Slice markers.png into per-aircraft Mapbox images (icon-<CATEGORY>), exactly
    // like the live map does — non-SDF "natural" sprites so they keep their real
    // colours. Runs once per map; safe to await repeatedly (guards on hasImage).
    async function loadSpriteIcons(map) {
        const uvs = window.__EMBED_SPRITE_UVS__;
        if (!uvs) return; // embed-sprites.js missing → fall back to a circle layer
        const img = await new Promise((resolve, reject) => {
            const i = new Image();
            i.crossOrigin = 'Anonymous';
            i.onload = () => resolve(i);
            i.onerror = () => reject(new Error('Failed to load aircraft sprites.'));
            i.src = SPRITE_URL;
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);

        for (const [key, uv] of Object.entries(uvs)) {
            if (key.endsWith('_S')) continue; // skip the hover/selected variants
            const id = `icon-${key}`;
            if (map.hasImage(id)) continue;
            const [xR, yR, wR, hR] = uv;
            const x = Math.floor(xR * img.width), y = Math.floor(yR * img.height);
            const w = Math.floor(wR * img.width), h = Math.floor(hR * img.height);
            if (w === 0 || h === 0) continue;
            const data = ctx.getImageData(x, y, w, h);
            map.addImage(id, data, { pixelRatio: w / SPRITE_TARGET_SIZE, sdf: false });
        }
    }

    function pilotsToGeoJSON(pilots) {
        return {
            type: 'FeatureCollection',
            features: pilots
                .filter(p => p.lat != null && p.lon != null)
                .map(p => ({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
                    properties: {
                        category: p.category || 'B737',
                        heading: p.heading || 0,
                        flightId: p.flightId || '',
                        sessionId: p.sessionId || '',
                        callsign: p.callsign || p.flightId || '',
                        username: p.username || '',
                        depIcao: p.depIcao || '',
                        arrIcao: p.arrIcao || '',
                        aircraft: p.aircraft || '',
                        livery: p.livery || '',
                        altitude: p.altitude || 0,
                        speed: p.speed || 0
                    }
                }))
        };
    }

    const _mapState = { map: null, ready: false, hasIcons: false };

    function addPilotLayer(map) {
        if (map.getSource(SOURCE_ID)) return;
        map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

        if (_mapState.hasIcons) {
            // Real aircraft silhouettes, rotated to heading and locked to the map
            // (so they bank with the globe), mirroring the live traffic layer.
            map.addLayer({
                id: LAYER_ID,
                type: 'symbol',
                source: SOURCE_ID,
                layout: {
                    'icon-image': ['concat', 'icon-', ['coalesce', ['get', 'category'], 'B737']],
                    'icon-size': 0.15,                   // matches the live map's default plane size
                    'icon-rotate': ['get', 'heading'],
                    'icon-rotation-alignment': 'map',
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true
                }
            });
        } else {
            // Sprite sheet unavailable — graceful circle fallback so the map still
            // shows where pilots are.
            map.addLayer({
                id: LAYER_ID,
                type: 'circle',
                source: SOURCE_ID,
                paint: {
                    'circle-radius': 5,
                    'circle-color': '#38bdf8',
                    'circle-stroke-color': '#0b1220',
                    'circle-stroke-width': 1.5
                }
            });
        }

        // Tap a plane → FR24-style card, matching the desktop hover card. Opens
        // instantly with a placeholder photo, then swaps in the real community
        // aircraft image once the lookup resolves.
        map.on('click', LAYER_ID, (e) => {
            const f = e.features && e.features[0];
            if (!f) return;
            const pr = f.properties || {};
            const coords = f.geometry.coordinates.slice();

            // Tapping a new plane replaces any path from the previously open card.
            removeFlightPaths(map);
            _mapState.activePathId = pr.flightId || null;

            const popup = new window.mapboxgl.Popup({
                offset: 14, closeButton: false, maxWidth: 'none', className: 'emb-fr24-popup'
            })
                .setLngLat(coords)
                .setHTML(fr24CardHTML(pr, DEFAULT_AC_IMG))
                .addTo(map);

            // Clear the trail/plan when the card is dismissed.
            popup.on('close', () => {
                if (_mapState.activePathId === pr.flightId) _mapState.activePathId = null;
                removeFlightPaths(map);
            });

            // Lazily fetch + draw this one flight's flown trail and filed plan.
            drawFlightPaths(map, pr, coords).catch(() => {});

            communityImage(pr.aircraft, pr.livery).then(info => {
                if (!info || !info.url) return;
                const el = popup.getElement && popup.getElement();
                if (!el) return;
                const box = el.querySelector('.fr24-image-box');
                if (box) box.style.backgroundImage = `url('${info.url}')`;
                const cr = el.querySelector('.fr24-copyright');
                if (cr) cr.textContent = '© ' + info.credit;
            });
        });
        map.on('mouseenter', LAYER_ID, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', LAYER_ID, () => { map.getCanvas().style.cursor = ''; });
    }

    function fitToPilots(map, pilots) {
        const pts = pilots.filter(p => p.lat != null && p.lon != null);
        if (!pts.length) return;
        if (pts.length === 1) {
            map.easeTo({ center: [pts[0].lon, pts[0].lat], zoom: 4.5, duration: 700 });
            return;
        }
        const bounds = new window.mapboxgl.LngLatBounds();
        pts.forEach(p => bounds.extend([p.lon, p.lat]));
        map.fitBounds(bounds, { padding: 56, maxZoom: 6.5, duration: 700 });
    }

    async function renderMap(cfg, pilots) {
        const root = rootEl();
        if (!root) return;

        _mapState.cfg = cfg;   // branding for the tap card

        if (!_mapState.map) {
            await loadMapboxGL();
            root.innerHTML = `
                ${headerHTML(cfg, pilots.length)}
                <div class="emb-map" id="emb-map"></div>`;
            window.mapboxgl.accessToken = cfg.mapboxToken;   // the VA's OWN token
            const map = new window.mapboxgl.Map({
                container: 'emb-map',
                style: cfg.mapStyle,
                projection: 'globe',                 // match the tracker's globe
                center: [0, 25],
                zoom: 1.5,
                minZoom: 0,
                attributionControl: true
            });
            _mapState.map = map;
            map.addControl(new window.mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

            map.on('style.load', () => { try { map.setFog(EMBED_FOG); } catch (_) {} });

            // First load: slice sprites, add the source+layer, seed it, fit view.
            map.once('load', async () => {
                try { await loadSpriteIcons(map); _mapState.hasIcons = true; }
                catch (_) { _mapState.hasIcons = false; }
                addPilotLayer(map);
                map.getSource(SOURCE_ID).setData(pilotsToGeoJSON(pilots));
                _mapState.ready = true;
                fitToPilots(map, pilots);
            });
            _mapState._firstFit = true;
            return;
        }

        // Subsequent polls: refresh header count + live data without re-fitting
        // the camera (so we don't yank the view while someone is panning).
        const sub = root.querySelector('.emb-head-sub');
        if (sub) sub.innerHTML = `<span class="emb-live-dot"></span> ${pilots.length} pilot${pilots.length === 1 ? '' : 's'} airborne`;
        if (_mapState.ready && _mapState.map.getSource(SOURCE_ID)) {
            _mapState.map.getSource(SOURCE_ID).setData(pilotsToGeoJSON(pilots));
        }
    }

    // ── Boot + polling ──────────────────────────────────────────────────────────
    function showError(message) {
        const root = rootEl();
        if (!root) return;
        root.innerHTML = `
            <div class="emb-error">
                <div class="emb-error-icon">⚠</div>
                <p>${esc(message)}</p>
            </div>`;
    }

    function showLoading() {
        const root = rootEl();
        if (root) root.innerHTML = `<div class="emb-loading"><div class="emb-spinner"></div></div>`;
    }

    async function tick(cfg) {
        let pilots = [];
        try {
            pilots = await fetchActivePilots(cfg);
        } catch (e) {
            // Keep whatever is on screen; a transient data hiccup shouldn't blank
            // the widget. Only the very first failure (no prior render) shows an error.
            if (!rootEl().dataset.rendered) {
                showError('Couldn’t load live flight data right now.');
                return;
            }
            return;
        }
        if (cfg.mode === 'map') renderMap(cfg, pilots);
        else renderRoster(cfg, pilots);
        rootEl().dataset.rendered = '1';
    }

    async function boot() {
        showLoading();
        let cfg;
        try {
            cfg = await resolveConfig();
        } catch (e) {
            showError(e.message || 'This embed could not be configured.');
            return;
        }
        // Fill in the partner VA's name/logo from the VA-Ads roster when they
        // weren't supplied (e.g. preview embeds, or a token without a logo).
        if (!cfg.logo || cfg.name === cfg.code) {
            const brand = await resolveVaBranding(cfg.code);
            if (brand) {
                if (!cfg.logo && brand.logo) cfg.logo = brand.logo;
                if (cfg.name === cfg.code && brand.name) cfg.name = brand.name;
            }
        }

        const root = rootEl();
        root.setAttribute('data-theme', cfg.theme);
        root.classList.add('emb-mode-' + cfg.mode);

        await tick(cfg);
        // Pause polling while the tab is hidden to save the VA's bandwidth/loads.
        let timer = setInterval(() => { if (!document.hidden) tick(cfg); }, REFRESH_MS);
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) tick(cfg);
        });
        window.addEventListener('beforeunload', () => clearInterval(timer));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
