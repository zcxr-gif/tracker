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
 *     "callsignPrefixes": ["OCEAN"],          // optional; leading-token prefixes. defaults to [va.code]
 *     "callsignSuffixes": ["EX", "VA"],       // optional; match the LAST token ending with these (e.g. "OCEAN 01EX", "UPS 01EX")
 *     "mode": "map",                          // "map" | "roster"  (default "roster")
 *     "provider": "mapbox",                   // "mapbox" | "free"  (optional; auto: free when no token)
 *     "mapboxToken": "pk.eyJ…",               // the VA's own token (only needed for the mapbox provider)
 *     "mapStyle": "mapbox://styles/mapbox/dark-v11",   // optional (mapbox provider)
 *     "freeStyle": "dark",                    // optional (free provider): dark|liberty|bright|positron or a style URL
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
 *     embed.html?va=OCEAN&name=Ocean%20Virtual&mode=map&mapboxToken=pk.eyJ…   (mapbox)
 *     embed.html?va=OCEAN&name=Ocean%20Virtual&mode=map                       (free map — no token)
 *     embed.html?va=OCEAN&name=Ocean%20Virtual&mode=map&provider=free&freeStyle=liberty
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
    const MAPLIBRE_VERSION = '4.7.1';   // free engine — no token required

    // Free, key-less vector styles (OpenFreeMap). Used when a VA has no Mapbox
    // token, so they're never locked out of the map view.
    const FREE_STYLES = {
        dark:     'https://tiles.openfreemap.org/styles/dark',
        liberty:  'https://tiles.openfreemap.org/styles/liberty',
        bright:   'https://tiles.openfreemap.org/styles/bright',
        positron: 'https://tiles.openfreemap.org/styles/positron'
    };
    function resolveFreeStyle(s) {
        const v = String(s || '').trim();
        if (/^https?:\/\//i.test(v)) return v;            // a full style URL
        return FREE_STYLES[v.toLowerCase()] || FREE_STYLES.dark;
    }

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
            callsignSuffixes: p.get('suffixes') ? p.get('suffixes').split(',') : null,
            mode: mode,
            mapboxToken: p.get('mapboxToken') || '',
            mapStyle: (p.get('mapStyle') || '').trim(),
            provider: (p.get('provider') || '').trim(),
            freeStyle: (p.get('freeStyle') || '').trim(),
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

        // Optional suffix tags: match on the LAST callsign token ending with these
        // (e.g. "EX", "01VA"). Uppercased, whitespace stripped. Empty = prefix-only.
        const suffixes = (Array.isArray(raw.callsignSuffixes) ? raw.callsignSuffixes : [])
            .map(s => String(s || '').trim().toUpperCase().replace(/\s+/g, ''))
            .filter(Boolean);

        let mode = (String(raw.mode || '').trim().toLowerCase() === 'map') ? 'map' : 'roster';
        const mapboxToken = String(raw.mapboxToken || '').trim();
        const hasToken = /^pk\./.test(mapboxToken);

        // Pick the rendering engine. A VA without a Mapbox token isn't locked out
        // of the map — it falls back to the free, key-less OpenFreeMap source via
        // MapLibre. An explicit provider param wins, but "mapbox" without a token
        // still degrades to free rather than breaking.
        const providerRaw = String(raw.provider || '').trim().toLowerCase();
        let provider;
        if (['free', 'osm', 'openfreemap', 'maplibre'].includes(providerRaw)) provider = 'free';
        else if (providerRaw === 'mapbox') provider = hasToken ? 'mapbox' : 'free';
        else provider = hasToken ? 'mapbox' : 'free';

        // Map mode is always renderable now (free engine needs no token).
        const mapStyle = raw.mapStyle || 'mapbox://styles/mapbox/dark-v11';
        const freeStyle = resolveFreeStyle(
            raw.freeStyle || (provider === 'free' && !/^mapbox:/i.test(raw.mapStyle || '') ? raw.mapStyle : '')
        );

        return {
            code,
            name: va.name || code,
            logo: /^https?:\/\//i.test(va.logo || '') ? va.logo : '',
            prefixes,
            suffixes,
            mode,
            provider,
            mapboxToken,
            mapStyle,
            freeStyle,
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
    // Split a callsign into its uppercased tokens ("OCEAN 01EX" → ["OCEAN","01EX"]).
    function callsignTokens(callsign) {
        return String(callsign || '').trim().toUpperCase().split(/[\s\-_/]+/).filter(Boolean);
    }

    // Is a suffix tag actually a TAG on this token, not just letters that happen
    // to end it? A short tag like "VA" ends a huge number of unrelated callsigns
    // ("MOSKVA", "NOVA", "…VA"), so endsWith alone is far too greedy. A tag only
    // counts when it is EITHER the whole token (a standalone "VA"), or glued onto
    // a flight number — i.e. the char immediately before it is a digit ("01VA",
    // "123EX"). That's exactly how VAs append their tag and nothing else.
    function tokenHasSuffixTag(token, tag) {
        if (!token.endsWith(tag)) return false;
        if (token === tag) return true;                       // standalone tag: "VA"
        const before = token.charAt(token.length - tag.length - 1);
        return before >= '0' && before <= '9';                // tag on a number: "01VA"
    }

    // Does a flight callsign belong to this VA? A callsign matches if EITHER rule
    // hits, so a VA can mix styles:
    //   • PREFIX rule  — the leading token starts with one of the VA's prefixes.
    //       prefix "OCEAN"  →  "OCEAN 01", "OCEAN123"
    //   • SUFFIX rule  — the LAST token carries one of the VA's suffix tags,
    //     either standalone or glued to a flight number (see tokenHasSuffixTag).
    //       suffix "EX"  →  "OCEAN 01EX", "UPS 01EX", "UPS EX"   (NOT "APEX")
    //     This lets a VA fly other airlines' callsigns and still be picked up by
    //     their private tag, and lets one VA run several tags (e.g. EX + VA).
    function callsignMatches(callsign, cfg) {
        const tokens = callsignTokens(callsign);
        if (!tokens.length) return false;
        const first = tokens[0];
        const last = tokens[tokens.length - 1];
        if (cfg.prefixes && cfg.prefixes.some(p => p && first.startsWith(p))) return true;
        if (cfg.suffixes && cfg.suffixes.some(s => s && tokenHasSuffixTag(last, s))) return true;
        return false;
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
                .filter(f => f && callsignMatches(f.callsign, cfg))
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
    // The active GL engine global. MapLibre is API-compatible with Mapbox GL for
    // everything the embed uses (Map, Popup, LngLatBounds, sources/layers,
    // addImage), so the rest of the code is engine-agnostic via gl().
    let _glEngine = null;   // 'mapbox' | 'free'
    function gl() {
        return _glEngine === 'free' ? window.maplibregl : window.mapboxgl;
    }

    let _mapLoaded = false;
    function loadScriptOnce(jsUrl, cssUrl, errLabel) {
        return new Promise((resolve, reject) => {
            const css = document.createElement('link');
            css.rel = 'stylesheet';
            css.href = cssUrl;
            document.head.appendChild(css);

            const js = document.createElement('script');
            js.src = jsUrl;
            js.onload = () => resolve();
            js.onerror = () => reject(new Error(`Failed to load ${errLabel}.`));
            document.head.appendChild(js);
        });
    }

    function loadMapEngine(provider) {
        _glEngine = provider === 'free' ? 'free' : 'mapbox';
        if (_mapLoaded) return Promise.resolve();
        const p = _glEngine === 'free'
            ? loadScriptOnce(
                `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`,
                `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`,
                'MapLibre GL JS')
            : loadScriptOnce(
                `https://api.mapbox.com/mapbox-gl-js/${MAPBOX_GL_VERSION}/mapbox-gl.js`,
                `https://api.mapbox.com/mapbox-gl-js/${MAPBOX_GL_VERSION}/mapbox-gl.css`,
                'Mapbox GL JS');
        return p.then(() => { _mapLoaded = true; });
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
        const hdg = Math.round(Number(pr.heading) || 0);
        const actype = (pr.aircraft || '').toString();
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
                            <div class="seg fr24-prog-fill"></div>
                            <svg class="glyph fr24-prog-glyph" width="12" height="12" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M2 2L22 12L2 22L6 12L2 2Z" fill="#ffffff"/></svg>
                        </div>
                        <span class="fr24-route-code" style="color:#94a3b8">${esc(arr)}</span>
                    </div>
                    <div class="fr24-meta">
                        <span class="fr24-meta-dist">—</span>
                        <span class="fr24-meta-eta">ETA —</span>
                    </div>
                    <div class="fr24-stats-grid">
                        <div class="fr24-stat"><b>${alt}</b><span class="u">FT</span></div>
                        <div class="fr24-stat"><b>${gs}</b><span class="u">KTS</span></div>
                        <div class="fr24-stat"><b>${hdg}°</b><span class="u">HDG</span></div>
                    </div>
                    ${actype ? `<div class="fr24-actype" title="${esc(actype)}">${esc(actype)}</div>` : ''}
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

    // ── Flight path engine ───────────────────────────────────────────────────
    // Ported verbatim from flight.js so the embed draws the flown trail and the
    // filed plan EXACTLY like the main tracker: an altitude-coloured, Catmull-Rom
    // smoothed, great-circle-densified trail, plus a glowing cyan dashed "Full
    // Plan" with waypoint dots + labels. Geometry is loaded one flight at a time
    // (on tap) and cleared when the card closes.

    // On-tap layer ids — one active flight at a time.
    const FLOWN_SRC  = 'emb-flown-src',  FLOWN_LYR  = 'emb-flown-lyr';
    const PLAN_SRC   = 'emb-plan-src';
    const PLAN_GLOW  = 'emb-plan-glow',  PLAN_LINE = 'emb-plan-line';
    const PLAN_DOTS  = 'emb-plan-dots',  PLAN_LBLS = 'emb-plan-lbls';

    function removeFlightPaths(map) {
        if (!map || !map.getStyle) return;
        [FLOWN_LYR, PLAN_GLOW, PLAN_LINE, PLAN_DOTS, PLAN_LBLS].forEach(id => {
            if (map.getLayer(id)) map.removeLayer(id);
        });
        [FLOWN_SRC, PLAN_SRC].forEach(id => { if (map.getSource(id)) map.removeSource(id); });
    }

    // --- Geometry helpers (verbatim from flight.js) ---
    function getDistanceKm(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const toRad = Math.PI / 180;
        const dLat = (lat2 - lat1) * toRad;
        const dLon = (lon2 - lon1) * toRad;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    function getIntermediatePoint(lat1, lon1, lat2, lon2, fraction) {
        const toRad = Math.PI / 180;
        const toDeg = 180 / Math.PI;
        const lat1Rad = lat1 * toRad, lon1Rad = lon1 * toRad;
        const lat2Rad = lat2 * toRad, lon2Rad = lon2 * toRad;
        const d = getDistanceKm(lat1, lon1, lat2, lon2) / 6371;
        if (d === 0) return { lat: lat1, lon: lon1 };
        const sinD = Math.sin(d);
        const a = Math.sin((1 - fraction) * d) / sinD;
        const b = Math.sin(fraction * d) / sinD;
        const x = a * Math.cos(lat1Rad) * Math.cos(lon1Rad) + b * Math.cos(lat2Rad) * Math.cos(lon2Rad);
        const y = a * Math.cos(lat1Rad) * Math.sin(lon1Rad) + b * Math.cos(lat2Rad) * Math.sin(lon2Rad);
        const z = a * Math.sin(lat1Rad) + b * Math.sin(lat2Rad);
        return { lat: Math.atan2(z, Math.sqrt(x * x + y * y)) * toDeg, lon: Math.atan2(y, x) * toDeg };
    }

    function unwrapLineCoordinates(coords) {
        if (!coords || coords.length < 2) return coords;
        const newCoords = [coords[0]];
        let lastLon = coords[0][0];
        for (let i = 1; i < coords.length; i++) {
            const [rawLon, lat] = coords[i];
            let delta = rawLon - (lastLon % 360);
            if (delta > 180) delta -= 360;
            if (delta < -180) delta += 360;
            const newLon = lastLon + delta;
            newCoords.push([newLon, lat]);
            lastLon = newLon;
        }
        return newCoords;
    }

    function densifyRoute(coordinates, maxSegmentLengthKm = 100) {
        if (!coordinates || coordinates.length < 2) return coordinates;
        const densified = [coordinates[0]];
        for (let i = 0; i < coordinates.length - 1; i++) {
            const start = coordinates[i];
            const end = coordinates[i + 1];
            const dist = getDistanceKm(start[1], start[0], end[1], end[0]);
            if (dist > maxSegmentLengthKm) {
                const steps = Math.ceil(dist / maxSegmentLengthKm);
                for (let j = 1; j < steps; j++) {
                    const fraction = j / steps;
                    const intermediate = getIntermediatePoint(start[1], start[0], end[1], end[0], fraction);
                    let lon = intermediate.lon;
                    let prevLon = densified[densified.length - 1][0];
                    let delta = lon - (prevLon % 360);
                    while (delta > 180) delta -= 360;
                    while (delta < -180) delta += 360;
                    densified.push([prevLon + delta, intermediate.lat]);
                }
            }
            densified.push(end);
        }
        return densified;
    }

    function generateSmoothPath(points, tension = 0.5) {
        if (points.length < 4) return points;
        const result = [];
        const interpolate = (p0, p1, p2, p3, t) => {
            const t2 = t * t, t3 = t2 * t;
            return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
        };
        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[i === 0 ? i : i - 1];
            const p1 = points[i];
            const p2 = points[i + 1];
            const p3 = points[i + 2 >= points.length ? i + 1 : i + 2];
            const d = Math.sqrt(Math.pow(p2.unwrappedLon - p1.unwrappedLon, 2) + Math.pow(p2.lat - p1.lat, 2));
            const steps = Math.max(24, Math.min(64, Math.ceil(d * 400)));
            for (let t = 0; t < 1; t += 1 / steps) {
                result.push({
                    unwrappedLon: interpolate(p0.unwrappedLon, p1.unwrappedLon, p2.unwrappedLon, p3.unwrappedLon, t),
                    lat: interpolate(p0.lat, p1.lat, p2.lat, p3.lat, t),
                    alt: p1.alt + (p2.alt - p1.alt) * t
                });
            }
        }
        result.push(points[points.length - 1]);
        return result;
    }

    function generateAltitudeColoredRoute(trailPoints, currentPosition) {
        const features = [];
        const allPoints = [...(trailPoints || [])];
        if (currentPosition) {
            allPoints.push({
                latitude: currentPosition.lat,
                longitude: currentPosition.lon,
                altitude: currentPosition.alt_ft || 0
            });
        }
        if (allPoints.length < 2) return { type: 'FeatureCollection', features: [] };

        const unwrappedPoints = [];
        let prevLon = allPoints[0].longitude || allPoints[0].lon;
        unwrappedPoints.push({
            unwrappedLon: prevLon,
            lat: allPoints[0].latitude || allPoints[0].lat,
            alt: allPoints[0].altitude || allPoints[0].alt || 0
        });
        for (let i = 1; i < allPoints.length; i++) {
            let lon = allPoints[i].longitude || allPoints[i].lon;
            const lat = allPoints[i].latitude || allPoints[i].lat;
            const alt = allPoints[i].altitude || allPoints[i].alt || 0;
            while (lon - prevLon > 180) lon -= 360;
            while (prevLon - lon > 180) lon += 360;
            unwrappedPoints.push({ unwrappedLon: lon, lat, alt });
            prevLon = lon;
        }

        const smoothedPoints = unwrappedPoints.length >= 4
            ? generateSmoothPath(unwrappedPoints, 0.5)
            : unwrappedPoints;

        for (let i = 0; i < smoothedPoints.length - 1; i++) {
            const p1 = smoothedPoints[i];
            const p2 = smoothedPoints[i + 1];
            features.push({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [[p1.unwrappedLon, p1.lat], [p2.unwrappedLon, p2.lat]] },
                properties: { altitude: p1.alt }
            });
        }
        return { type: 'FeatureCollection', features };
    }

    function flattenWaypointsFromPlan(items) {
        const waypoints = [];
        if (!Array.isArray(items)) return waypoints;
        const extract = (planItems) => {
            for (const item of planItems) {
                if (Array.isArray(item.children) && item.children.length > 0) {
                    extract(item.children);
                } else if (item.location && typeof item.location.longitude === 'number' && typeof item.location.latitude === 'number' && (item.location.latitude !== 0 || item.location.longitude !== 0)) {
                    waypoints.push([item.location.longitude, item.location.latitude]);
                }
            }
        };
        extract(items);
        return waypoints;
    }

    function getFlatWaypointObjects(items) {
        const waypoints = [];
        if (!Array.isArray(items)) return waypoints;
        const extract = (planItems) => {
            for (const item of planItems) {
                if (Array.isArray(item.children) && item.children.length > 0) {
                    extract(item.children);
                } else if (item.location && typeof item.location.longitude === 'number' && typeof item.location.latitude === 'number' && (item.location.latitude !== 0 || item.location.longitude !== 0)) {
                    waypoints.push(item);
                }
            }
        };
        extract(items);
        return waypoints;
    }

    // Fetch the tapped flight's flown trail + filed plan and draw both, matching
    // the main tracker's sector-ops rendering exactly.
    async function drawFlightPaths(map, pr, clickedCoords, popup) {
        const flightId = pr.flightId, sessionId = pr.sessionId;
        if (!map || !flightId) return;

        const planUrl    = `${FLIGHTS_BASE}/${sessionId || 'default'}/${flightId}/plan`;
        const historyUrl = `${HISTORY_BASE}/${flightId}/history`;

        const [planJson, histJson] = await Promise.all([
            getJSON(planUrl).catch(() => null),
            getJSON(historyUrl).catch(() => null)
        ]);

        // Popup may have closed (or another flight tapped) mid-fetch — bail.
        if (!map.getStyle || _mapState.activePathId !== flightId) return;

        const currentPosition = {
            lat: clickedCoords[1],
            lon: clickedCoords[0],
            alt_ft: Number(pr.altitude) || 0
        };

        // ── 1. Flown path — altitude-coloured gradient trail ──
        const histArr = (histJson && (histJson.path || histJson.route)) || [];
        const trail = Array.isArray(histArr)
            ? histArr.slice().sort((a, b) => new Date(a.date) - new Date(b.date))
            : [];
        const routeFeature = generateAltitudeColoredRoute(trail, currentPosition);
        if (routeFeature.features.length) {
            map.addSource(FLOWN_SRC, {
                type: 'geojson',
                data: routeFeature,
                lineMetrics: true,   // CRITICAL for gradients
                tolerance: 0         // Don't simplify segments away at low zoom
            });
            map.addLayer({
                id: FLOWN_LYR,
                type: 'line',
                source: FLOWN_SRC,
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-width': 4,
                    'line-opacity': 1,
                    'line-color': [
                        'interpolate', ['linear'], ['get', 'altitude'],
                        0, '#94a3b8',       // Ground / Taxi / Parked (Grey)
                        3000, '#c084fc',    // Approach / Initial Climb (Purple)
                        12000, '#f59e0b',   // Lower Descent / Climb (Orange)
                        20000, '#10b981',   // Climb / High Descent (Green)
                        30000, '#38bdf8',   // Cruise (Blue)
                        45000, '#0284c7'    // High Cruise (Darker Blue)
                    ]
                }
            }, LAYER_ID);
        }

        // ── 2. Filed plan — full route (glow + dashed cyan + waypoint dots/labels) ──
        const plan = planJson && planJson.plan;
        if (plan && Array.isArray(plan.flightPlanItems) && plan.flightPlanItems.length >= 2) {
            const allWaypointsForLine = flattenWaypointsFromPlan(plan.flightPlanItems);
            if (allWaypointsForLine.length >= 2) {
                const rawWaypoints = flattenWaypointsFromPlan(plan.flightPlanItems);
                const unwrappedWaypoints = unwrapLineCoordinates(rawWaypoints);
                const densifiedWaypoints = densifyRoute(unwrappedWaypoints, 100);
                const waypointObjects = getFlatWaypointObjects(plan.flightPlanItems);

                // Mark the closest waypoint as "active" so prior ones read as passed.
                let activeWpIndex = 0, minDist = Infinity;
                waypointObjects.forEach((wp, idx) => {
                    if (!wp.location) return;
                    const d = getDistanceKm(currentPosition.lat, currentPosition.lon, wp.location.latitude, wp.location.longitude);
                    if (d < minDist) { minDist = d; activeWpIndex = idx; }
                });

                const features = [{
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: densifiedWaypoints }
                }];
                waypointObjects.forEach((wp, idx) => {
                    if (wp.location && wp.location.longitude != null && wp.location.latitude != null) {
                        features.push({
                            type: 'Feature',
                            geometry: { type: 'Point', coordinates: [wp.location.longitude, wp.location.latitude] },
                            properties: { name: (wp.identifier || wp.name || '').toUpperCase(), isPassed: idx < activeWpIndex }
                        });
                    }
                });

                map.addSource(PLAN_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features } });

                map.addLayer({
                    id: PLAN_GLOW, type: 'line', source: PLAN_SRC,
                    filter: ['==', '$type', 'LineString'],
                    paint: { 'line-color': '#06b6d4', 'line-width': 6, 'line-opacity': 0.25, 'line-blur': 4 }
                }, LAYER_ID);

                map.addLayer({
                    id: PLAN_LINE, type: 'line', source: PLAN_SRC,
                    filter: ['==', '$type', 'LineString'],
                    paint: { 'line-color': '#67e8f9', 'line-width': 2, 'line-opacity': 0.9, 'line-dasharray': [3, 4] }
                }, LAYER_ID);

                map.addLayer({
                    id: PLAN_DOTS, type: 'circle', source: PLAN_SRC,
                    filter: ['==', '$type', 'Point'],
                    paint: {
                        'circle-radius': 1.5,
                        'circle-color': ['case', ['==', ['get', 'isPassed'], true], '#eab308', '#1e1b4b'],
                        'circle-stroke-width': 1,
                        'circle-stroke-color': ['case', ['==', ['get', 'isPassed'], true], '#ca8a04', '#67e8f9']
                    }
                }, LAYER_ID);

                map.addLayer({
                    id: PLAN_LBLS, type: 'symbol', source: PLAN_SRC,
                    filter: ['all', ['==', '$type', 'Point'], ['==', ['get', 'isPassed'], false]],
                    layout: {
                        'text-field': ['get', 'name'],
                        // Font families differ per engine's glyph set.
                        'text-font': _glEngine === 'free'
                            ? ['Noto Sans Regular']
                            : ['Mapbox Txt Regular', 'Arial Unicode MS Regular'],
                        'text-size': 9,
                        'text-offset': [0.6, -0.6],
                        'text-anchor': 'bottom-left',
                        'text-allow-overlap': false,
                        'text-ignore-placement': false,
                        'text-letter-spacing': 0.1
                    },
                    paint: {
                        'text-color': '#fdf4ff',
                        'text-halo-color': 'rgba(15, 23, 42, 0.9)',
                        'text-halo-width': 2,
                        'text-halo-blur': 1
                    }
                }, LAYER_ID);

                // ── Card enrichment: route progress, distance remaining, ETA ──
                // Pure math on the plan we already fetched — no extra requests.
                enrichCard(popup, flightId, waypointObjects, activeWpIndex, currentPosition, Number(pr.speed) || 0);
            }
        }
    }

    // Compute along-route progress + remaining distance + ETA from the filed
    // plan and live ground speed, then patch the open tap card in place.
    function enrichCard(popup, flightId, waypointObjects, activeWpIndex, currentPosition, gs) {
        if (!popup || _mapState.activePathId !== flightId) return;
        const el = popup.getElement && popup.getElement();
        if (!el) return;

        const coords = waypointObjects
            .filter(w => w.location && w.location.longitude != null && w.location.latitude != null)
            .map(w => [w.location.longitude, w.location.latitude]);
        if (coords.length < 2) return;

        const segKm = (a, b) => getDistanceKm(a[1], a[0], b[1], b[0]);
        let totalKm = 0;
        for (let i = 0; i < coords.length - 1; i++) totalKm += segKm(coords[i], coords[i + 1]);

        const idx = Math.min(Math.max(activeWpIndex, 0), coords.length - 1);
        let remainingKm = segKm([currentPosition.lon, currentPosition.lat], coords[idx]);
        for (let i = idx; i < coords.length - 1; i++) remainingKm += segKm(coords[i], coords[i + 1]);
        remainingKm = Math.min(remainingKm, totalKm);

        const flownKm = Math.max(0, totalKm - remainingKm);
        const progressPct = totalKm > 0 ? Math.max(0, Math.min(100, (flownKm / totalKm) * 100)) : 0;
        const remainingNm = remainingKm / 1.852;

        const fill = el.querySelector('.fr24-prog-fill');
        const glyph = el.querySelector('.fr24-prog-glyph');
        const distEl = el.querySelector('.fr24-meta-dist');
        const etaEl = el.querySelector('.fr24-meta-eta');
        if (fill) fill.style.width = progressPct.toFixed(0) + '%';
        if (glyph) { glyph.style.left = progressPct.toFixed(0) + '%'; }
        if (distEl) distEl.textContent = `${Math.round(remainingNm).toLocaleString()} NM left`;
        if (etaEl) {
            if (gs >= 30 && remainingNm > 1) {
                const eta = new Date(Date.now() + (remainingNm / gs) * 3600000);
                const hh = String(eta.getUTCHours()).padStart(2, '0');
                const mm = String(eta.getUTCMinutes()).padStart(2, '0');
                etaEl.textContent = `ETA ${hh}:${mm}z`;
            } else {
                etaEl.textContent = 'ETA —';
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

            const popup = new (gl().Popup)({
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

            // Lazily fetch + draw this one flight's flown trail and filed plan,
            // and enrich the card with progress/ETA from the same data.
            drawFlightPaths(map, pr, coords, popup).catch(() => {});

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
        const bounds = new (gl().LngLatBounds)();
        pts.forEach(p => bounds.extend([p.lon, p.lat]));
        map.fitBounds(bounds, { padding: 56, maxZoom: 6.5, duration: 700 });
    }

    async function renderMap(cfg, pilots) {
        const root = rootEl();
        if (!root) return;

        _mapState.cfg = cfg;   // branding for the tap card

        if (!_mapState.map) {
            await loadMapEngine(cfg.provider);
            root.innerHTML = `
                ${headerHTML(cfg, pilots.length)}
                <div class="emb-map" id="emb-map"></div>`;

            const isFree = cfg.provider === 'free';
            const mapOpts = {
                container: 'emb-map',
                style: isFree ? cfg.freeStyle : cfg.mapStyle,
                center: [0, 25],
                zoom: 1.5,
                minZoom: 0,
                attributionControl: true
            };
            // Globe is a Mapbox feature; the free MapLibre engine renders flat.
            if (!isFree) {
                window.mapboxgl.accessToken = cfg.mapboxToken;   // the VA's OWN token
                mapOpts.projection = 'globe';                    // match the tracker's globe
            }
            const map = new (gl().Map)(mapOpts);
            _mapState.map = map;
            map.addControl(new (gl().NavigationControl)({ showCompass: false }), 'top-right');

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
