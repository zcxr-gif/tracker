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
 *       src="https://inflight.info/embed.html?token=THE_ISSUED_TOKEN"
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
 *     "callsignPrefixes": ["Air Canada"],     // optional; full airline/callsign names (spaces ok). defaults to [va.code]
 *     "callsignSuffixes": ["EX", "VA"],       // optional tags; when set, a flight must match a declared prefix AND carry the tag (e.g. prefix "Air Canada" + "VA" → "Air Canada 001VA")
 *     "hubs": ["KJFK", "KBOS"],               // optional; hub ICAOs plotted as clickable airport-info markers (map mode). also accepts "icao"/"hub". defaults from VA-Ads.
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

    // Where every "Powered by Inflight" tap-through lands: the PRODUCTION
    // tracker, never a backend host or the Netlify test domain.
    const TRACKER_URL   = 'https://inflight.info';

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

    // Is the chosen basemap a light/white one? On those, the natural-colour plane
    // silhouettes wash out, so we switch to black SDF planes instead. Checks the
    // free style name, then the Mapbox style URL, then the declared theme.
    function isLightBasemap(cfg) {
        const free = String(cfg.freeStyle || '').toLowerCase();
        if (free) {
            if (/(positron|bright|liberty|light)/.test(free)) return true;
            if (/dark/.test(free)) return false;
        }
        const ms = String(cfg.mapStyle || '').toLowerCase();
        if (/(light|positron|bright|liberty)/.test(ms)) return true;
        if (/(dark|night|satellite)/.test(ms)) return false;
        return cfg.theme === 'light';
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

    // Aircraft name → sprite category. Mirrors flight.js getAircraftCategory so the
    // embed plots the same silhouette the live map would for any given airframe.
    // Returns a key that exists in markers.png. When IF reports no/"unknown"
    // aircraft (or a type we don't have a silhouette for) we fall back to the 777
    // — a generic, recognisable airliner — rather than an absent 'default' sprite.
    function getAircraftCategory(aircraftName) {
        const UNKNOWN = 'B777';
        if (!aircraftName) return UNKNOWN;
        const name = aircraftName.toUpperCase();
        if (name === 'UNKNOWN' || name === 'N/A') return UNKNOWN;
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
        return UNKNOWN;
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
            // "Regular" (untagged) callsigns — matched by prefix alone, always
            // included even when suffix-tag mode is on for the main prefixes.
            regularCallsigns: (p.get('regulars') || p.get('callsigns'))
                ? (p.get('regulars') || p.get('callsigns')).split(',') : null,
            hubs: p.get('hubs') ? p.get('hubs').split(',') : null,
            mode: mode,
            mapboxToken: p.get('mapboxToken') || '',
            mapStyle: (p.get('mapStyle') || '').trim(),
            provider: (p.get('provider') || '').trim(),
            freeStyle: (p.get('freeStyle') || '').trim(),
            theme: (p.get('theme') || '').trim(),
            accent: (p.get('color') || p.get('accent') || '').trim(),
            header: (p.get('header') || (p.get('hideHeader') ? 'off' : '')).trim(),
            headerPos: (p.get('headerPos') || p.get('headerPosition') || p.get('position') || '').trim(),
            gradient: (p.get('gradient') || '').trim(),
            gradientAngle: (p.get('angle') || p.get('gradientAngle') || '').trim(),
            compact: (p.get('compact') || '').trim(),
            radius: (p.get('radius') || '').trim(),
            // Flight-card customization (map mode): translucency + text colour.
            cardColor: (p.get('cardColor') || p.get('cardBg') || '').trim(),
            cardText: (p.get('cardText') || p.get('textColor') || '').trim(),
            cardOpacity: (p.get('cardOpacity') || p.get('opacity') || '').trim(),
            cardBlur: (p.get('cardBlur') || '').trim(),
            servers: p.get('servers') ? p.get('servers').split(',') : null
        });
    }

    function normalizeConfig(raw) {
        const va = raw.va || {};
        const code = firstToken(va.code || va.callsign || '');
        if (!code) throw new Error('Embed config is missing a VA callsign code.');

        // Prefixes are the full airline/callsign name the VA flies under, NOT just
        // the first word — IF callsigns are the spoken name, e.g. "Air Canada 001VA"
        // (tokens AIR / CANADA / 001VA). We compact each prefix (strip spaces and
        // separators) so "Air Canada" → "AIRCANADA" and matches the whole airline,
        // not every callsign that merely starts with "AIR".
        const prefixes = (Array.isArray(raw.callsignPrefixes) && raw.callsignPrefixes.length
            ? raw.callsignPrefixes
            : [code]
        ).map(compactCallsign).filter(Boolean);

        // Optional suffix tags. When set, matching requires a declared prefix AND
        // one of these tags on the LAST callsign token (e.g. prefix "Air Canada" +
        // tag "VA" → "Air Canada 001VA"). Uppercased, whitespace stripped.
        // Empty = prefix-only.
        const suffixes = (Array.isArray(raw.callsignSuffixes) ? raw.callsignSuffixes : [])
            .map(s => String(s || '').trim().toUpperCase().replace(/\s+/g, ''))
            .filter(Boolean);

        // "Regular" callsigns — additional full callsign names matched by PREFIX
        // ONLY (never require a suffix tag), always folded into the roster even
        // when the main prefixes are running in tag mode. Lets a VA list several
        // plain callsigns (e.g. staff / charter callsigns) alongside tagged
        // members. Compacted the same way as prefixes.
        const regulars = (Array.isArray(raw.regularCallsigns) ? raw.regularCallsigns : [])
            .map(compactCallsign).filter(Boolean);

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

        // Hub airports (ICAO list) — accepts hubs / icao / hub, array or CSV.
        const hubsRaw = raw.hubs != null ? raw.hubs : (raw.icao != null ? raw.icao : raw.hub);
        const hubs = (Array.isArray(hubsRaw) ? hubsRaw
            : (typeof hubsRaw === 'string' ? hubsRaw.split(',') : []))
            .map(s => String(s || '').trim().toUpperCase()).filter(Boolean);

        const isOn  = v => ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase()) || v === true;
        const isOff = v => ['0', 'false', 'no', 'off', 'none', 'hidden'].includes(String(v).trim().toLowerCase()) || v === false;

        // Header visibility & placement. Hiding the header is allowed — the
        // "Powered by Inflight" attribution then moves to a floating badge that
        // is always rendered (it is required to stay viewable).
        const hideHeader = isOff(raw.header != null ? raw.header : (raw.hideHeader ? 'off' : ''));
        const posRaw = String(raw.headerPos || raw.headerPosition || raw.position || '').trim().toLowerCase();
        const headerPos = ['top', 'bottom', 'left', 'right'].includes(posRaw) ? posRaw : 'top';

        // Brand colours. `accent` (or color/brandColor) accepts one colour or a
        // comma-separated list / array — multiple colours become a gradient.
        const accentRaw = raw.accent != null ? raw.accent : (raw.brandColor != null ? raw.brandColor : raw.color);
        const accentList = Array.isArray(accentRaw) ? accentRaw : String(accentRaw || '').split(',');
        const brandColors = accentList.map(s => parseColor(String(s || '').trim())).filter(Boolean).slice(0, 3);

        // gradient=off keeps a single flat colour; anything else lets one colour
        // auto-expand into a two-stop gradient (a derived companion shade).
        const gradient = isOff(raw.gradient) ? 'off' : 'auto';
        const angleN = parseFloat(raw.gradientAngle != null ? raw.gradientAngle : raw.angle);
        const gradientAngle = isFinite(angleN) ? ((angleN % 360) + 360) % 360 : 120;

        const radiusN = parseFloat(raw.radius);
        const radius = (isFinite(radiusN) && radiusN >= 0) ? Math.min(radiusN, 32) : null;

        // Flight-card look (map mode). All optional; when nothing is supplied the
        // card keeps its default appearance. `opacity` accepts 0–1 or 0–100 and
        // controls how see-through the card is; `blur` frosts the map behind a
        // translucent card; `color`/`text` accept hex, rgb() or a named colour.
        const pickCard = (...vals) => { for (const v of vals) if (v != null && String(v).trim() !== '') return v; return null; };
        const cardObj = (raw.card && typeof raw.card === 'object') ? raw.card : {};
        const cardBg = parseCssColor(pickCard(raw.cardColor, raw.cardBg, cardObj.color, cardObj.bg));
        const cardText = parseCssColor(pickCard(raw.cardText, raw.textColor, cardObj.text));
        let cardOpacity = null;
        const opRaw = pickCard(raw.cardOpacity, raw.opacity, cardObj.opacity);
        if (opRaw != null) {
            let n = parseFloat(opRaw);
            if (isFinite(n)) { if (n > 1) n /= 100; cardOpacity = Math.min(1, Math.max(0, n)); }
        }
        let cardBlur = null;
        const blRaw = pickCard(raw.cardBlur, cardObj.blur);
        if (blRaw != null) { const n = parseFloat(blRaw); if (isFinite(n)) cardBlur = Math.min(40, Math.max(0, n)); }
        const card = { bg: cardBg, text: cardText, opacity: cardOpacity, blur: cardBlur };

        return {
            code,
            name: va.name || code,
            logo: /^https?:\/\//i.test(va.logo || '') ? va.logo : '',
            prefixes,
            suffixes,
            regulars,
            card,
            hubs,
            mode,
            provider,
            mapboxToken,
            mapStyle,
            freeStyle,
            theme: (raw.theme === 'light') ? 'light' : 'dark',
            // Explicit brand colours ({r,g,b} objects). When set they override
            // the palette we would otherwise sample from the logo. Two or more
            // become a gradient; one may auto-expand (see `gradient`). The
            // chosen wordmark is filled in at boot.
            brandColors,
            gradient,
            gradientAngle,
            brandLogo: '',
            hideHeader,
            headerPos,
            compact: isOn(raw.compact),
            radius,
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
            const hubsRaw = hit.icao != null ? hit.icao : (hit.hubs != null ? hit.hubs : hit.hub);
            const hubs = (Array.isArray(hubsRaw) ? hubsRaw
                : (typeof hubsRaw === 'string' ? hubsRaw.split(',') : []))
                .map(s => String(s || '').trim().toUpperCase()).filter(Boolean);
            return {
                name: hit.name || hit.vaName || hit.title || '',
                logo: /^https?:\/\//i.test(rawLogo) ? rawLogo : '',
                hubs
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

    // Uppercased with every separator removed, so multi-word airline names line up
    // regardless of spacing: "Air Canada 001VA" → "AIRCANADA001VA", "Air Canada"
    // → "AIRCANADA". Used to match a VA's full callsign prefix against a flight.
    function compactCallsign(callsign) {
        return String(callsign || '').toUpperCase().replace(/[\s\-_/]+/g, '');
    }

    // Weight-class words a pilot appends for heavy/super aircraft — "United 2UA
    // Heavy" / "Lufthansa 400 Super". They are spoken wake-turbulence categories,
    // not part of the airline name or the VA tag, so they are peeled off the END
    // of the callsign before the trailing flight-number/tag token is read. Without
    // this a member flying a heavy reads its last token as "HEAVY"/"SUPER", fails
    // the suffix-tag test, and is wrongly dropped from the VA roster.
    const WEIGHT_CLASS_SUFFIXES = new Set(['HEAVY', 'SUPER']);
    function stripWeightClass(tokens) {
        const t = tokens.slice();
        while (t.length > 1 && WEIGHT_CLASS_SUFFIXES.has(t[t.length - 1])) t.pop();
        return t;
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

    // Does a flight callsign belong to this VA? Prefixes are matched against the
    // WHOLE leading callsign (separators removed), so a full airline name like
    // "Air Canada" matches "Air Canada 001VA" and only Air Canada — not Air France
    // or any other callsign that merely starts with "AIR".
    //
    //   • No suffix tags configured  →  PREFIX-ONLY. The compacted callsign must
    //     start with one of the VA's declared prefixes.
    //       prefix "AIRCANADA"  →  "Air Canada 001", "Air Canada 12"
    //
    //   • Suffix tags configured  →  PREFIX **AND** TAG. The flight only belongs
    //     to the VA when BOTH hold: the compacted callsign starts with a declared
    //     prefix/airline, AND the last token carries one of the VA's suffix tags.
    //       prefix "AIRCANADA", suffix "VA"
    //         → "Air Canada 001VA" ✓ ,  "Air Canada 001" ✗ (no tag),
    //           "United 045VA"     ✗ (airline not declared)
    //     A bare suffix never matches on its own, so a short tag like "VA" can no
    //     longer sweep up every unrelated callsign that happens to end in it — the
    //     VA must declare which airline prefixes they fly that tag under. To run
    //     the tag across several airlines, list each airline in callsignPrefixes.
    function callsignMatches(callsign, cfg) {
        const tokens = stripWeightClass(callsignTokens(callsign));
        if (!tokens.length) return false;
        const compact = tokens.join('');          // uppercased, separators removed

        // Regular (untagged) callsigns are matched by prefix alone and are always
        // included — they bypass the suffix-tag requirement entirely.
        if (cfg.regulars && cfg.regulars.some(p => p && compact.startsWith(p))) return true;

        const prefixHit = !!(cfg.prefixes && cfg.prefixes.some(p => p && compact.startsWith(p)));

        // Prefix-only mode (no tags) — unchanged.
        if (!cfg.suffixes || !cfg.suffixes.length) return prefixHit;

        // Tag mode — require the declared prefix AND at least one configured tag
        // on one of the LAST TWO tokens. Pilots often carry a second trailing tag
        // (a division / event code) after the VA tag — "Air Canada 001VA CX" or
        // "Air Canada 001 VA EX" — so a tag on either trailing token counts. Both
        // suffixes are optional; one is enough.
        const tail = tokens.slice(-2);
        const suffixHit = cfg.suffixes.some(s => s && tail.some(t => tokenHasSuffixTag(t, s)));
        return prefixHit && suffixHit;
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

    // ── Brand colour theming ────────────────────────────────────────────────────
    // The header (VA logo + name + "N pilots airborne" + the Powered-by chip) can
    // adopt the VA's own brand colour. We derive that colour from the VA's logo
    // (or take an explicit one from config), then compute text/border colours for
    // guaranteed contrast so nothing blends into the new background.
    const BRAND_LOGO_DARK_TEXT  = 'Images/inflight.png';        // dark wordmark → use on a LIGHT header
    const BRAND_LOGO_LIGHT_TEXT = 'Images/inflight-light.png';  // light wordmark → use on a DARK header

    // Parse "#rgb" / "#rrggbb" / "rgb()/rgba()" → {r,g,b}, else null.
    function parseColor(str) {
        if (!str) return null;
        const s = String(str).trim();
        let m = /^#([0-9a-f]{3})$/i.exec(s);
        if (m) {
            const h = m[1];
            return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) };
        }
        m = /^#([0-9a-f]{6})$/i.exec(s);
        if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16) };
        m = /^rgba?\(([^)]+)\)$/i.exec(s);
        if (m) {
            const p = m[1].split(',').map(x => parseFloat(x));
            if (p.length >= 3 && p.slice(0, 3).every(n => !isNaN(n))) return { r: p[0], g: p[1], b: p[2] };
        }
        return null;
    }

    function rgbCss(c, a) {
        const r = Math.round(c.r), g = Math.round(c.g), b = Math.round(c.b);
        return a == null ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
    }

    // A handful of common colour NAMES a VA might type ("red", "white") on top of
    // the hex / rgb() forms parseColor already handles. Kept small on purpose —
    // enough to cover "red text / white text etc" without pulling in a table of
    // 140 CSS names. Returns {r,g,b} or null.
    const NAMED_COLORS = {
        white: '#ffffff', black: '#000000', red: '#ef4444', crimson: '#dc2626',
        orange: '#f97316', amber: '#f59e0b', yellow: '#eab308', gold: '#fbbf24',
        lime: '#84cc16', green: '#22c55e', emerald: '#10b981', teal: '#14b8a6',
        cyan: '#06b6d4', sky: '#0ea5e9', blue: '#3b82f6', navy: '#1e3a8a',
        indigo: '#6366f1', violet: '#8b5cf6', purple: '#a855f7', magenta: '#d946ef',
        pink: '#ec4899', rose: '#f43f5e', slate: '#64748b', gray: '#6b7280',
        grey: '#6b7280', silver: '#cbd5e1'
    };
    function parseCssColor(str) {
        if (!str) return null;
        const s = String(str).trim().toLowerCase();
        if (NAMED_COLORS[s]) return parseColor(NAMED_COLORS[s]);
        return parseColor(s);
    }

    // Apply the VA's flight-card customization (map mode) as CSS variables on the
    // embed root. Only sets a variable the VA actually asked for, so an
    // unconfigured card keeps its default look. Pure CSS vars — set once at boot,
    // no per-frame or per-render cost, which matters for a lightweight embed.
    function applyCardTheme(root, cfg) {
        const c = cfg && cfg.card;
        if (!c) return;
        if (!(c.bg || c.text || c.opacity != null || c.blur != null)) return;
        const s = root.style;
        const light = cfg.theme === 'light';

        // Translucent / recoloured card surface.
        if (c.bg || c.opacity != null) {
            const surface = c.bg || (light ? { r: 255, g: 255, b: 255 } : { r: 28, g: 28, b: 30 });
            const alpha = c.opacity != null ? c.opacity : 1;
            s.setProperty('--emb-card-bg', rgbCss(surface, alpha));
            s.setProperty('--emb-card-panel', rgbCss(surface, alpha));
        }
        // Frost the map behind a see-through card: on by default once the card is
        // noticeably translucent, off otherwise; an explicit blur always wins.
        const blur = c.blur != null ? c.blur : ((c.opacity != null && c.opacity < 0.9) ? 12 : 0);
        s.setProperty('--emb-card-blur', blur + 'px');

        // Text colour — primary, plus a dimmed companion for secondary lines and
        // a faint version for the stat-tile chips so they stay visible on any hue.
        if (c.text) {
            s.setProperty('--emb-card-text', rgbCss(c.text));
            s.setProperty('--emb-card-text-dim', rgbCss(c.text, 0.62));
            s.setProperty('--emb-card-chip', rgbCss(c.text, 0.10));
        }
    }

    // WCAG relative luminance (0 = black … 1 = white).
    function luminance(c) {
        const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    }
    // A bright background wants dark text; otherwise white text reads best.
    function bgIsLight(c) { return luminance(c) > 0.45; }

    // RGB ↔ HSL, used to derive gradient companion shades. h in degrees, s/l 0..1.
    function rgbToHsl(c) {
        const r = c.r / 255, g = c.g / 255, b = c.b / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const l = (max + min) / 2;
        if (max === min) return { h: 0, s: 0, l };
        const d = max - min;
        const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        let h;
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        return { h: h * 60, s, l };
    }

    function hslToRgb(h, s, l) {
        h = ((h % 360) + 360) % 360;
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        const m = l - c / 2;
        let r, g, b;
        if (h < 60)       [r, g, b] = [c, x, 0];
        else if (h < 120) [r, g, b] = [x, c, 0];
        else if (h < 180) [r, g, b] = [0, c, x];
        else if (h < 240) [r, g, b] = [0, x, c];
        else if (h < 300) [r, g, b] = [x, 0, c];
        else              [r, g, b] = [c, 0, x];
        return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
    }

    // Derive a gradient partner for a lone brand colour: nudge the hue and shift
    // the lightness so a single colour still yields a rich two-stop gradient.
    function companionColor(c) {
        const { h, s, l } = rgbToHsl(c);
        const l2 = l > 0.5 ? Math.max(0.18, l - 0.18) : Math.min(0.82, l + 0.16);
        const s2 = Math.min(1, s * 1.1 + 0.05);
        return hslToRgb(h + 28, s2, l2);
    }

    // Pull the brand palette out of an image: the most vivid, mid-bright colour,
    // plus (when the logo genuinely has one) a second vivid colour from a clearly
    // different hue family — the pair drives an automatic gradient. Loads the
    // image cross-origin and samples a downscaled copy. Resolves null when the
    // image can't be read (tainted canvas, load/timeout error, no vivid colour)
    // so callers fall back to the default header.
    function extractLogoPalette(url) {
        return new Promise((resolve) => {
            if (!url) return resolve(null);
            let done = false;
            const finish = (v) => { if (!done) { done = true; resolve(v); } };
            const timer = setTimeout(() => finish(null), 3500);
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            img.onerror = () => { clearTimeout(timer); finish(null); };
            img.onload = () => {
                clearTimeout(timer);
                try {
                    const S = 48;
                    const cv = document.createElement('canvas');
                    cv.width = S; cv.height = S;
                    const ctx = cv.getContext('2d', { willReadFrequently: true });
                    ctx.drawImage(img, 0, 0, S, S);
                    const data = ctx.getImageData(0, 0, S, S).data;
                    // Best vivid pixel per 30° hue bucket, so a two-tone logo
                    // (e.g. navy + gold) surfaces both of its colour families.
                    const buckets = new Array(12).fill(null);
                    let sr = 0, sg = 0, sb = 0, sw = 0;   // saturation-weighted average (fallback)
                    for (let i = 0; i < data.length; i += 4) {
                        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
                        if (a < 128) continue;                          // transparent
                        const max = Math.max(r, g, b), min = Math.min(r, g, b);
                        const sat = max === 0 ? 0 : (max - min) / max;
                        const light = (max + min) / 510;                // 0..1
                        if (light > 0.95 || light < 0.06) continue;     // near-white / near-black
                        const w = sat * sat;
                        sr += r * w; sg += g * w; sb += b * w; sw += w;
                        const score = sat * (1 - Math.abs(light - 0.5));  // vivid + mid-bright
                        const bi = Math.min(11, Math.floor(rgbToHsl({ r, g, b }).h / 30));
                        if (!buckets[bi] || score > buckets[bi].score) buckets[bi] = { score, color: { r, g, b }, bi };
                    }
                    const ranked = buckets.filter(Boolean).sort((a, b) => b.score - a.score);
                    const primary = ranked[0];
                    if (primary && primary.score > 0.08) {
                        // Secondary: strong enough, and at least two hue buckets
                        // (60°+) away so near-identical shades don't count.
                        const secondary = ranked.find(e => {
                            const d = Math.abs(e.bi - primary.bi);
                            return Math.min(d, 12 - d) >= 2 && e.score >= Math.max(0.12, primary.score * 0.35);
                        });
                        return finish(secondary ? [primary.color, secondary.color] : [primary.color]);
                    }
                    if (sw > 0) return finish([{ r: sr / sw, g: sg / sw, b: sb / sw }]);
                    finish(null);
                } catch (_) { finish(null); }
            };
            img.src = url;
        });
    }

    // Write the header palette derived from the brand colours onto the embed root
    // as CSS variables, and return which Inflight wordmark keeps the corner
    // legible. `colors` is an array of {r,g,b}: one colour paints a flat header
    // (or auto-expands into a gradient unless gradient=off), two or more paint a
    // multi-stop gradient at cfg.gradientAngle. Text/border colours are computed
    // from the blend of all stops for WCAG contrast. With no brand colour we
    // leave the defaults and just pick the wordmark for the active theme.
    function applyHeaderTheme(root, colors, cfg) {
        if (!root) return BRAND_LOGO_LIGHT_TEXT;
        if (!colors || !colors.length) {
            const isDark = root.getAttribute('data-theme') !== 'light';
            return isDark ? BRAND_LOGO_LIGHT_TEXT : BRAND_LOGO_DARK_TEXT;
        }
        let stops = colors.slice(0, 3);
        if (stops.length === 1 && (!cfg || cfg.gradient !== 'off')) {
            stops = [stops[0], companionColor(stops[0])];
        }
        const angle = (cfg && isFinite(cfg.gradientAngle)) ? cfg.gradientAngle : 120;
        const bg = stops.length === 1
            ? rgbCss(stops[0])
            : `linear-gradient(${angle}deg, ${stops.map(c => rgbCss(c)).join(', ')})`;
        // Contrast is judged against the blend of every stop, so text stays
        // legible across the whole gradient rather than only at one end.
        const mix = stops.reduce((m, c) => ({ r: m.r + c.r / stops.length, g: m.g + c.g / stops.length, b: m.b + c.b / stops.length }), { r: 0, g: 0, b: 0 });
        const light = bgIsLight(mix);
        const text = light ? { r: 15, g: 23, b: 42 } : { r: 255, g: 255, b: 255 };
        const s = root.style;
        s.setProperty('--head-bg', bg);
        s.setProperty('--head-text', rgbCss(text));
        s.setProperty('--head-text-2', rgbCss(text, light ? 0.66 : 0.80));
        s.setProperty('--head-text-3', rgbCss(text, light ? 0.45 : 0.60));
        s.setProperty('--head-border', rgbCss(text, light ? 0.16 : 0.24));
        s.setProperty('--accent', rgbCss(stops[0]));
        return light ? BRAND_LOGO_DARK_TEXT : BRAND_LOGO_LIGHT_TEXT;
    }

    // ── Shared chrome ───────────────────────────────────────────────────────────
    function headerHTML(cfg, count) {
        const logo = cfg.logo
            ? `<img class="emb-logo" src="${esc(cfg.logo)}" alt="" onerror="this.style.display='none'">`
            : `<div class="emb-logo emb-logo-fallback">${esc(cfg.code.slice(0, 2))}</div>`;
        const brandLogo = cfg.brandLogo || BRAND_LOGO_LIGHT_TEXT;
        return `
            <div class="emb-head">
                ${logo}
                <div class="emb-head-meta">
                    <div class="emb-head-name">${esc(cfg.name)}</div>
                    <div class="emb-head-sub"><span class="emb-live-dot"></span> ${count} pilot${count === 1 ? '' : 's'} airborne</div>
                </div>
                <a class="emb-brand" href="${TRACKER_URL}" target="_blank" rel="noopener" title="Powered by Inflight">
                    <span class="emb-brand-by">Powered by</span>
                    <img class="emb-brand-logo" src="${esc(brandLogo)}" alt="Inflight" onerror="this.outerHTML='Inflight'">
                </a>
            </div>`;
    }

    // Floating "Powered by Inflight" badge — rendered whenever the header is
    // hidden, so the attribution is ALWAYS viewable no matter how the embed is
    // customised. Carries the live pilot count the hidden header would have
    // shown. Sits bottom-right in roster mode; bottom-left on the map, where
    // the GL attribution owns the bottom-right corner.
    function floatBrandHTML(cfg, count) {
        const light = cfg.mode === 'map' ? isLightBasemap(cfg) : cfg.theme === 'light';
        const wordmark = light ? BRAND_LOGO_DARK_TEXT : BRAND_LOGO_LIGHT_TEXT;
        return `
            <a class="emb-float-brand${light ? ' is-light' : ''}${cfg.mode === 'map' ? ' emb-float-mapside' : ''}"
               href="${TRACKER_URL}" target="_blank" rel="noopener" title="Powered by Inflight">
                <span class="emb-float-count"><span class="emb-live-dot"></span><b>${count}</b></span>
                <span class="emb-brand-by">Powered by</span>
                <img class="emb-brand-logo" src="${esc(wordmark)}" alt="Inflight" onerror="this.outerHTML='Inflight'">
            </a>`;
    }

    // Refresh the live pilot count wherever it is shown (header sub-line and/or
    // the floating badge) without re-rendering the whole widget.
    function updateLiveCounts(root, n) {
        const sub = root.querySelector('.emb-head-sub');
        if (sub) sub.innerHTML = `<span class="emb-live-dot"></span> ${n} pilot${n === 1 ? '' : 's'} airborne`;
        const fc = root.querySelector('.emb-float-count b');
        if (fc) fc.textContent = n;
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
            ${cfg.hideHeader ? '' : headerHTML(cfg, pilots.length)}
            <div class="emb-body">
                ${pilots.length ? pilots.map(pilotRowHTML).join('') : emptyHTML(cfg)}
            </div>
            ${cfg.hideHeader ? floatBrandHTML(cfg, pilots.length) : ''}`;
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
                    ${vaBadgeHTML(_mapState.cfg)}
                    <div class="fr24-copyright">© ${esc(credit || 'IF Community')}</div>
                </div>
                <div class="fr24-info-box">
                    <div class="fr24-header-row">
                        ${logo ? `<img src="${esc(logo)}" class="fr24-airline-logo" onerror="this.style.display='none'">` : ''}
                        <div class="fr24-ident-group"><span class="fr24-callsign">${esc(callsign)}</span></div>
                        <span class="fr24-user" title="${esc(username)}">${esc(username)}</span>
                    </div>
                    <div class="fr24-route-premium">
                        <span class="fr24-route-code" style="color:var(--emb-card-text, #f8fafc)">${esc(dep)}</span>
                        <div class="fr24-route-line">
                            <div class="seg fr24-prog-fill"></div>
                            <svg class="glyph fr24-prog-glyph" width="12" height="12" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M2 2L22 12L2 22L6 12L2 2Z" fill="#ffffff"/></svg>
                        </div>
                        <span class="fr24-route-code" style="color:var(--emb-card-text-dim, #94a3b8)">${esc(arr)}</span>
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
                    ${poweredByHTML()}
                </div>
            </div>`;
    }

    // Partner VA badge — their logo (or name) overlaid on the top-left of the
    // aircraft photo, on a faint see-through pill so it reads over the image.
    function vaBadgeHTML(cfg) {
        if (!cfg) return '';
        const inner = cfg.logo
            ? `<img src="${esc(cfg.logo)}" alt="${esc(cfg.name || '')}" onerror="this.style.display='none'">`
            : (cfg.name ? `<span>${esc(cfg.name)}</span>` : '');
        return inner ? `<div class="fr24-va-badge">${inner}</div>` : '';
    }

    // "Powered by Inflight" footer shown at the bottom of every tap card, with
    // our small logo — replaces the per-card partner-VA chip.
    function poweredByHTML() {
        return `
            <a class="fr24-powered" href="${TRACKER_URL}" target="_blank" rel="noopener" title="Powered by Inflight">
                <span class="fr24-powered-by">Powered by</span>
                <img class="fr24-powered-logo" src="Images/inflight.png" alt="Inflight" onerror="this.outerHTML='Inflight'">
            </a>`;
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
    async function drawFlightPaths(map, pr, clickedCoords, cardEl) {
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
                enrichCard(cardEl, flightId, waypointObjects, activeWpIndex, currentPosition, Number(pr.speed) || 0);
            }
        }
    }

    // Compute along-route progress + remaining distance + ETA from the filed
    // plan and live ground speed, then patch the open tap card in place.
    function enrichCard(cardEl, flightId, waypointObjects, activeWpIndex, currentPosition, gs) {
        if (!cardEl || _mapState.activePathId !== flightId) return;
        const el = cardEl;
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
            // SDF twin (icon-<KEY>-sdf): same silhouette but tintable via
            // icon-color, used to draw black planes on light/white basemaps.
            const sdfId = `${id}-sdf`;
            if (!map.hasImage(sdfId)) {
                map.addImage(sdfId, data, { pixelRatio: w / SPRITE_TARGET_SIZE, sdf: true });
            }
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

    // ── Docked flight-info panel ────────────────────────────────────────────
    // Replaces the map popup. Lives inside the embed root and is positioned by
    // CSS: a bottom sheet on mobile, a side panel on desktop, matching the main
    // tracker's flight info window. One flight is shown at a time.
    function ensureDetailPanel(map) {
        if (_mapState.detailRoot) return _mapState.detailRoot;
        // Anchor inside the map container (which sits BELOW the header) so the
        // panel never overlaps the VA header bar.
        const host = (map && map.getContainer && map.getContainer()) || rootEl();
        if (!host) return null;

        const panel = document.createElement('div');
        panel.className = 'emb-detail';
        panel.innerHTML =
            '<div class="emb-detail-grip"></div>' +
            '<div class="emb-detail-body"></div>';

        host.appendChild(panel);
        _mapState.detailRoot = panel;
        _mapState.detailBody = panel.querySelector('.emb-detail-body');
        return panel;
    }

    function closeDetail(map) {
        _mapState.activePathId = null;
        _mapState.activeAptIcao = null;
        removeFlightPaths(map);
        if (_mapState.detailRoot) _mapState.detailRoot.classList.remove('open');
    }

    // Pan the tapped plane into the part of the map the panel doesn't cover, so
    // it's never hidden behind the flight info window — the visible-area centre
    // is left of true centre on desktop (side panel) and above it on mobile
    // (bottom sheet). offset is in pixels relative to the map's real centre.
    function panToVisible(map, coords) {
        const panel = _mapState.detailRoot;
        if (!map || !map.getContainer) return;
        const mapEl = map.getContainer();
        const mw = mapEl.clientWidth, mh = mapEl.clientHeight;
        const isMobile = window.matchMedia('(max-width: 640px)').matches;
        let offset = [0, 0];
        if (isMobile) {
            const sheetH = (panel && panel.offsetHeight) || mh * 0.6;
            offset = [0, -sheetH / 2];
        } else {
            const panelW = (panel && panel.offsetWidth) || Math.min(320, mw * 0.88);
            offset = [-panelW / 2, 0];
        }
        try { map.easeTo({ center: coords, offset, duration: 600 }); } catch (_) {}
    }

    function openDetail(map, pr, coords) {
        const panel = ensureDetailPanel(map);
        if (!panel) return;

        // Opening a new plane replaces any path from the previously open card.
        removeFlightPaths(map);
        _mapState.activePathId = pr.flightId || null;
        _mapState.activeAptIcao = null;   // a flight tap supersedes any open airport

        const body = _mapState.detailBody;
        body.innerHTML = fr24CardHTML(pr, DEFAULT_AC_IMG);
        body.scrollTop = 0;

        // Reveal on the next frame so the slide-in transition runs from the
        // off-screen state rather than snapping straight to open, then pan the
        // plane into the area the panel leaves visible (measured once laid out).
        requestAnimationFrame(() => {
            panel.classList.add('open');
            panToVisible(map, coords);
        });

        // Lazily fetch + draw this flight's flown trail and filed plan, and
        // enrich the card with progress/ETA from the same data.
        drawFlightPaths(map, pr, coords, body).catch(() => {});

        communityImage(pr.aircraft, pr.livery).then(info => {
            if (!info || !info.url) return;
            if (_mapState.activePathId !== pr.flightId) return;   // card changed mid-fetch
            const box = body.querySelector('.fr24-image-box');
            if (box) box.style.backgroundImage = `url('${info.url}')`;
            const cr = body.querySelector('.fr24-copyright');
            if (cr) cr.textContent = '© ' + info.credit;
        });
    }

    // ── VA hub markers + airport info window ─────────────────────────────────
    // Plot a clickable marker at each of the VA's hub airports. Tapping one opens
    // the docked panel with that field's live data (basic info, METAR, ops/ATIS,
    // traffic) — the same shape the main tracker's airport window shows, pulled
    // from the same backend endpoints.
    const _aptCache = new Map();   // ICAO -> Promise<airport|null>
    let _aptSessionId;             // cached session id for live airport queries

    // Flags are derived from the ICAO location indicator, NOT from any
    // country field the live API hands back — that field is frequently wrong
    // (e.g. Infinite Flight reports the wrong country for some fields), which
    // produced mismatched flags. ICAO prefixes are a fixed, standardised
    // scheme, so the first two letters of an airport's ICAO code reliably
    // identify the country. This lookup was generated from the bundled
    // airports.json by taking the dominant ISO-2 country per ICAO prefix.
    // A handful of two-letter prefixes span more than one country, so those
    // are disambiguated by a small set of three-letter overrides.
    const _ICAO_CC2 = {AA:"AQ",AG:"SB",AN:"NR",AQ:"AQ",AY:"PG",BG:"GL",BI:"IS",BK:"XK",CB:"CA",CH:"CA",CM:"CA",CR:"CA",CW:"CA",CY:"CA",CZ:"CA",DA:"DZ",DB:"BJ",DF:"BF",DG:"GH",DI:"CI",DN:"NG",DR:"NE",DT:"TN",DX:"TG",EB:"BE",ED:"DE",EE:"EE",EF:"FI",EG:"GB",EH:"NL",EI:"IE",EK:"DK",EL:"LU",EN:"NO",EP:"PL",ES:"SE",ET:"DE",EV:"LV",EY:"LT",FA:"ZA",FB:"BW",FC:"CG",FD:"SZ",FE:"CF",FG:"GQ",FH:"SH",FI:"MU",FJ:"IO",FK:"CM",FL:"ZM",FM:"MG",FN:"AO",FO:"GA",FP:"ST",FQ:"MZ",FS:"SC",FT:"TD",FV:"ZW",FW:"MW",FX:"LS",FY:"NA",FZ:"CD",GA:"ML",GB:"GM",GC:"ES",GE:"ES",GF:"SL",GG:"GW",GL:"LR",GM:"MA",GO:"SN",GQ:"MR",GU:"GN",GV:"CV",HA:"ET",HB:"BI",HC:"SO",HD:"DJ",HE:"EG",HH:"ER",HJ:"SS",HK:"KE",HL:"LY",HR:"RW",HS:"SD",HT:"TZ",HU:"UG",KA:"US",KB:"US",KC:"US",KD:"US",KE:"US",KF:"US",KG:"US",KH:"US",KI:"US",KJ:"US",KK:"US",KL:"US",KM:"US",KN:"US",KO:"US",KP:"US",KR:"US",KS:"US",KT:"US",KU:"US",KV:"US",KW:"US",KX:"US",KY:"US",KZ:"US",LA:"AL",LB:"BG",LC:"CY",LD:"HR",LE:"ES",LF:"FR",LG:"GR",LH:"HU",LI:"IT",LJ:"SI",LK:"CZ",LL:"IL",LM:"MT",LN:"MC",LO:"AT",LP:"PT",LQ:"BA",LR:"RO",LS:"CH",LT:"TR",LU:"MD",LW:"MK",LX:"GI",LY:"RS",LZ:"SK",MB:"TC",MD:"DO",ME:"CR",MG:"GT",MH:"HN",MK:"JM",ML:"MH",MM:"MX",MN:"NI",MP:"PA",MR:"CR",MS:"SV",MT:"HT",MU:"CU",MW:"KY",MY:"BS",MZ:"BZ",NC:"CK",NF:"FJ",NG:"KI",NI:"NU",NL:"WF",NS:"WS",NT:"PF",NV:"VU",NW:"NC",NZ:"NZ",OA:"AF",OB:"BH",OE:"SA",OI:"IR",OJ:"JO",OK:"KW",OL:"LB",OM:"AE",OO:"OM",OP:"PK",OR:"IQ",OS:"SY",OT:"QA",OY:"YE",PA:"US",PC:"KI",PF:"US",PG:"MP",PH:"US",PK:"MH",PL:"KI",PM:"UM",PP:"US",PR:"PH",PT:"FM",PW:"UM",RC:"TW",RJ:"JP",RK:"KR",RO:"JP",RP:"PH",SA:"AR",SB:"BR",SC:"CL",SD:"BR",SE:"EC",SF:"FK",SG:"PY",SH:"CL",SI:"BR",SJ:"BR",SK:"CO",SL:"BO",SM:"SR",SN:"BR",SO:"GF",SP:"PE",SQ:"CO",SS:"BR",SU:"UY",SV:"VE",SW:"BR",SY:"GY",TA:"AG",TB:"BB",TD:"DM",TF:"GP",TG:"GD",TI:"VI",TJ:"PR",TK:"KN",TL:"LC",TN:"BQ",TQ:"AI",TR:"MS",TT:"TT",TU:"VG",TV:"VC",TX:"BM",UA:"KZ",UB:"AZ",UC:"KG",UD:"AM",UE:"RU",UG:"GE",UH:"RU",UI:"RU",UK:"UA",UL:"RU",UM:"BY",UN:"RU",UO:"RU",UP:"UA",UR:"RU",US:"RU",UT:"UZ",UU:"RU",UW:"RU",VA:"IN",VC:"LK",VD:"KH",VE:"IN",VG:"BD",VH:"HK",VI:"IN",VL:"LA",VM:"MO",VN:"NP",VO:"IN",VQ:"BT",VR:"MV",VT:"TH",VV:"VN",VY:"MM",WA:"ID",WB:"MY",WI:"ID",WM:"MY",WP:"TL",WR:"ID",WS:"SG",YA:"AU",YB:"AU",YC:"AU",YD:"AU",YE:"AU",YF:"AU",YG:"AU",YH:"AU",YI:"AU",YJ:"AU",YK:"AU",YL:"AU",YM:"AU",YN:"AU",YO:"AU",YP:"AU",YQ:"AU",YR:"AU",YS:"AU",YT:"AU",YU:"AU",YV:"AU",YW:"AU",YX:"AU",YY:"AU",YZ:"AU",ZB:"CN",ZG:"CN",ZH:"CN",ZJ:"CN",ZK:"KP",ZL:"CN",ZM:"MN",ZP:"CN",ZS:"CN",ZU:"CN",ZW:"CN",ZY:"CN"};
    const _ICAO_CC3 = {FME:"RE",FMZ:"TF",HSB:"SS",HSR:"SS",HST:"SS",HSW:"SS",HSY:"SS",MLL:"CR",NFT:"TO",NST:"AS",PGU:"GU",PLP:"UM",PTR:"PW",SOM:"PE",UAB:"KG",UAF:"KG",UMK:"RU",UTA:"TM",UTD:"TJ"};

    // ISO-2 country code for an ICAO airport identifier, or '' if unknown.
    function countryFromIcao(icao) {
        const code = String(icao || '').trim().toUpperCase();
        if (!/^[A-Z]{4}$/.test(code)) return '';
        return _ICAO_CC3[code.slice(0, 3)] || _ICAO_CC2[code.slice(0, 2)] || '';
    }

    function airportInfo(icao) {
        const code = String(icao || '').trim().toUpperCase();
        if (!code) return Promise.resolve(null);
        if (_aptCache.has(code)) return _aptCache.get(code);
        const pr = getJSON(`${ACARS_BACKEND}/api/airport/${encodeURIComponent(code)}`)
            .then(j => (j && j.ok && j.airport) ? j.airport : null)
            .catch(() => null);
        _aptCache.set(code, pr);
        return pr;
    }

    async function getAptSessionId(cfg) {
        if (_aptSessionId !== undefined) return _aptSessionId;
        _aptSessionId = null;
        try {
            const sj = await getJSON(SESSIONS_URL);
            let sessions = (sj && Array.isArray(sj.sessions)) ? sj.sessions : [];
            if (cfg && cfg.servers && cfg.servers.length) {
                const wanted = cfg.servers.map(s => s.toLowerCase());
                const f = sessions.filter(s => wanted.some(w => String(s.name || '').toLowerCase().includes(w)));
                if (f.length) sessions = f;
            }
            const exp = sessions.find(s => /expert/i.test(String(s.name || '')));
            _aptSessionId = ((exp || sessions[0]) || {}).id || null;
        } catch (_) {}
        return _aptSessionId;
    }

    // Minimal METAR parse — flight category + the four headline fields.
    function parseMetarLite(raw) {
        const s = String(raw || '').trim();
        if (!s || /no metar|not found|^404/i.test(s)) return null;
        let cat = 'VFR', color = '#4ade80';
        if (/\bLIFR\b/.test(s)) { cat = 'LIFR'; color = '#c084fc'; }
        else if (/\bIFR\b/.test(s)) { cat = 'IFR'; color = '#f87171'; }
        else if (/\bMVFR\b/.test(s)) { cat = 'MVFR'; color = '#60a5fa'; }
        const w = s.match(/\b(VRB|\d{3})(\d{2})(?:G\d{2})?KT\b/);
        const wind = w ? `${w[1]}/${w[2]}kt` : '—';
        let vis = '—';
        if (/\bCAVOK\b/.test(s) || /\b9999\b/.test(s)) vis = '10+ km';
        else {
            const sm = s.match(/\b(\d{1,2})SM\b/);
            const m = s.match(/\s(\d{4})\s/);
            if (sm) vis = sm[1] + ' SM';
            else if (m) vis = Number(m[1]) >= 1000 ? (Number(m[1]) / 1000) + ' km' : m[1] + ' m';
        }
        const tm = s.match(/\b(M?\d{2})\/(M?\d{2})\b/);
        const temp = tm ? tm[1].replace('M', '-') + '°' : '—';
        let qnh = '—';
        const q = s.match(/\bQ(\d{4})\b/), a = s.match(/\bA(\d{4})\b/);
        if (q) qnh = q[1]; else if (a) qnh = (Number(a[1]) / 100).toFixed(2) + 'inHg';
        return { cat, color, wind, vis, temp, qnh, raw: s };
    }

    // ATIS parse — same field extraction as the main tracker's parseAtis.
    function parseAtisLite(text) {
        if (!text) return null;
        const info = (text.match(/information\s+([A-Z])/i) || [])[1];
        const time = (text.match(/(\d{4})\s*Z/i) || [])[1];
        const ext = (str) => { if (!str) return '—'; const m = str.match(/\d{2}[LRC]?/g); return m ? m.join('/') : '—'; };
        const landing = ext((text.match(/Landing\s+([^,.]+)/i) || [])[1]);
        const departing = ext((text.match(/Departing\s+([^,.]+)/i) || [])[1]);
        const appM = text.match(/expect\s+(.*?)\s+approach/i);
        const appr = appM ? appM[1].toUpperCase().replace('VISUAL', 'VIS') : 'VIS';
        return { info: info ? info.toUpperCase() : '?', time: time ? time + 'Z' : '', landing, departing, appr };
    }

    function fetchMetar(icao) {
        return fetch(`https://metar.vatsim.net/metar.php?id=${encodeURIComponent(icao)}`)
            .then(r => r.ok ? r.text() : null)
            .then(t => parseMetarLite(t))
            .catch(() => null);
    }

    // Live inbound/outbound counts (and how many are this VA's pilots) + ATIS.
    async function airportLive(cfg, icao) {
        const out = { inbound: 0, outbound: 0, vaCount: 0, atis: null };
        const sid = await getAptSessionId(cfg);
        if (!sid) return out;
        const base = `${ACARS_BACKEND}/api/live/airport/${sid}/${encodeURIComponent(icao)}`;
        try {
            const [status, atis] = await Promise.all([
                fetch(`${base}/status`).then(r => r.ok ? r.json() : null).catch(() => null),
                fetch(`${base}/atis`).then(r => r.ok ? r.json() : null).catch(() => null)
            ]);
            if (status && status.ok && status.status) {
                const inb = status.status.inboundFlights || [];
                const oub = status.status.outboundFlights || [];
                out.inbound = inb.length;
                out.outbound = oub.length;
                out.vaCount = [...inb, ...oub].filter(f => f && callsignMatches(f.callsign, cfg)).length;
            }
            if (atis && atis.ok && atis.atis) out.atis = parseAtisLite(atis.atis);
        } catch (_) {}
        return out;
    }

    // Build the hub markers once (lazily, on first enable). Each is a small
    // fixed-size pin + ICAO tag that opens the airport window when tapped.
    async function buildHubMarkers(map, cfg) {
        if (_mapState.hubsBuilt || !cfg || !cfg.hubs || !cfg.hubs.length) return;
        _mapState.hubsBuilt = true;
        _mapState.hubMarkers = [];
        for (const icao of cfg.hubs) {
            const apt = await airportInfo(icao);
            const lat = apt && (apt.latitude != null ? apt.latitude : apt.lat);
            const lon = apt && (apt.longitude != null ? apt.longitude : apt.lon);
            if (lat == null || lon == null || !isFinite(Number(lat)) || !isFinite(Number(lon))) continue;
            const name = (apt && apt.name) || '';
            const cc = countryFromIcao(icao).toLowerCase();
            const flag = /^[a-z]{2}$/.test(cc)
                ? `<img class="emb-hub-flag" src="https://flagcdn.com/w20/${cc}.png" alt="" onerror="this.style.display='none'">`
                : '';
            const el = document.createElement('div');
            el.className = 'emb-hub';
            el.innerHTML =
                `<span class="emb-hub-pin"></span>` +
                `<div class="emb-hub-label">` +
                    `<div class="emb-hub-icao">${flag}<span>${esc(icao)}</span></div>` +
                    (name ? `<div class="emb-hub-name">${esc(name)}</div>` : '') +
                `</div>`;
            el.addEventListener('click', (ev) => {
                ev.stopPropagation();
                openAirportDetail(map, icao, [Number(lon), Number(lat)]);
            });
            try {
                const marker = new (gl().Marker)({ element: el, anchor: 'center' })
                    .setLngLat([Number(lon), Number(lat)])
                    .addTo(map);
                _mapState.hubMarkers.push(marker);
            } catch (_) {}
        }
        // Honour the current toggle state for freshly-built markers.
        applyHubVisibility();
    }

    function applyHubVisibility() {
        (_mapState.hubMarkers || []).forEach((m) => {
            const el = m.getElement && m.getElement();
            if (el) el.style.display = _mapState.hubsVisible ? '' : 'none';
        });
    }

    async function setHubsVisible(map, cfg, on) {
        _mapState.hubsVisible = on;
        if (_mapState.hubsBtn) {
            _mapState.hubsBtn.classList.toggle('is-on', on);
            _mapState.hubsBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        if (on && !_mapState.hubsBuilt) await buildHubMarkers(map, cfg);
        else applyHubVisibility();
    }

    // A small map control button that toggles the hub markers. Off by default.
    function makeHubsControl(map, cfg) {
        const container = document.createElement('div');
        container.className = 'mapboxgl-ctrl maplibregl-ctrl emb-hubs-ctrl';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'emb-hubs-toggle';
        btn.setAttribute('aria-pressed', 'false');
        btn.innerHTML = `<span class="emb-hubs-dot"></span><span>Hubs</span>`;
        btn.addEventListener('click', () => setHubsVisible(map, cfg, !_mapState.hubsVisible));
        container.appendChild(btn);
        _mapState.hubsBtn = btn;
        return {
            onAdd() { return container; },
            onRemove() { container.remove(); }
        };
    }

    function openAirportDetail(map, icao, coords) {
        const panel = ensureDetailPanel(map);
        if (!panel) return;

        removeFlightPaths(map);
        _mapState.activePathId = null;
        _mapState.activeAptIcao = icao;

        const body = _mapState.detailBody;
        body.innerHTML = airportCardHTML(icao, null);
        body.scrollTop = 0;
        requestAnimationFrame(() => {
            panel.classList.add('open');
            panToVisible(map, coords);
        });

        Promise.all([airportInfo(icao), fetchMetar(icao), airportLive(_mapState.cfg, icao)])
            .then(([apt, metar, live]) => {
                if (_mapState.activeAptIcao !== icao) return;   // panel changed mid-fetch
                body.innerHTML = airportCardHTML(icao, { apt, metar, live });
            })
            .catch(() => {
                if (_mapState.activeAptIcao === icao) body.innerHTML = airportCardHTML(icao, { error: true });
            });
    }

    function airportCardHTML(icao, data) {
        if (!data) {
            return `<div class="emb-apt"><div class="emb-apt-head"><div style="min-width:0">
                <div class="emb-apt-icao">${esc(icao)}</div>
                <div class="emb-apt-name">Loading airport…</div></div></div></div>`;
        }
        if (data.error) {
            return `<div class="emb-apt"><div class="emb-apt-head"><div style="min-width:0">
                <div class="emb-apt-icao">${esc(icao)}</div>
                <div class="emb-apt-name">Couldn’t load airport data.</div></div></div>
                ${poweredByHTML()}</div>`;
        }
        const apt = data.apt || {}, metar = data.metar, live = data.live || {};
        const name = apt.name || icao;
        const city = apt.city || '';
        const cc = countryFromIcao(icao).toLowerCase();
        const flag = /^[a-z]{2}$/.test(cc)
            ? `<img class="emb-apt-flag" src="https://flagcdn.com/w40/${cc}.png" alt="" onerror="this.style.display='none'">`
            : '';
        const loc = [city, cc.toUpperCase()].filter(Boolean).join(', ');
        const elev = (apt.elevation != null) ? `${Math.round(apt.elevation)} ft` : '';
        const sub = [loc, elev].filter(Boolean).join(' · ');

        const metarMod = metar ? `
            <div class="emb-apt-mod">
                <div class="emb-apt-mod-h"><span>METAR</span><span class="emb-apt-pill" style="color:${metar.color};border-color:${metar.color}">${metar.cat}</span></div>
                <div class="emb-apt-grid">
                    <div class="emb-apt-cell"><span class="l">Wind</span><span class="v">${esc(metar.wind)}</span></div>
                    <div class="emb-apt-cell"><span class="l">Vis</span><span class="v">${esc(metar.vis)}</span></div>
                    <div class="emb-apt-cell"><span class="l">Temp</span><span class="v">${esc(metar.temp)}</span></div>
                    <div class="emb-apt-cell"><span class="l">QNH</span><span class="v">${esc(metar.qnh)}</span></div>
                </div>
                <div class="emb-apt-metar-raw">${esc(metar.raw)}</div>
            </div>` : `
            <div class="emb-apt-mod"><div class="emb-apt-mod-h"><span>METAR</span></div>
                <div class="emb-apt-sub" style="margin:0">Weather unavailable.</div></div>`;

        const atis = live.atis;
        const opsMod = `
            <div class="emb-apt-mod">
                <div class="emb-apt-mod-h"><span>Operations</span>${atis
                    ? `<span class="emb-apt-pill" style="color:#fbbf24;border-color:#fbbf24">ATIS ${esc(atis.info)}</span>`
                    : `<span class="emb-apt-pill" style="color:#94a3b8;border-color:#475569">NO ATIS</span>`}</div>
                ${atis ? `<div class="emb-apt-grid" style="grid-template-columns:repeat(3,1fr)">
                    <div class="emb-apt-cell"><span class="l">Arr Rwy</span><span class="v" style="color:#4ade80">${esc(atis.landing)}</span></div>
                    <div class="emb-apt-cell"><span class="l">Dep Rwy</span><span class="v" style="color:#38bdf8">${esc(atis.departing)}</span></div>
                    <div class="emb-apt-cell"><span class="l">Appr</span><span class="v">${esc(atis.appr)}</span></div>
                </div>` : `<div class="emb-apt-sub" style="margin:0">No live ATIS broadcasting.</div>`}
            </div>`;

        // This VA's own pilots inbound to this field, taken from the live roster we
        // already fetched (filtered to the VA), so we have full callsign/route/pilot
        // detail rather than the bare flight IDs the airport-status endpoint returns.
        const vaName = (_mapState.cfg && _mapState.cfg.name) || 'VA';
        const vaInbound = (_mapState.pilots || []).filter(p =>
            p && p.arrIcao && String(p.arrIcao).toUpperCase() === String(icao).toUpperCase());

        const trafficMod = `
            <div class="emb-apt-mod">
                <div class="emb-apt-mod-h"><span>Traffic</span></div>
                <div class="emb-apt-grid" style="grid-template-columns:repeat(3,1fr)">
                    <div class="emb-apt-cell"><span class="l">Inbound</span><span class="v">${live.inbound || 0}</span></div>
                    <div class="emb-apt-cell"><span class="l">Outbound</span><span class="v">${live.outbound || 0}</span></div>
                    <div class="emb-apt-cell"><span class="l">VA Inbound</span><span class="v" style="color:#7dd3fc">${vaInbound.length}</span></div>
                </div>
            </div>`;

        const VA_INBOUND_MAX = 20;
        const vaInboundMod = `
            <div class="emb-apt-mod">
                <div class="emb-apt-mod-h"><span>Inbound ${esc(vaName)} Pilots</span><span class="emb-apt-pill" style="color:#7dd3fc;border-color:#7dd3fc">${vaInbound.length}</span></div>
                ${vaInbound.length
                    ? `<div class="emb-apt-valist">${vaInbound.slice(0, VA_INBOUND_MAX).map(p => `
                        <div class="emb-apt-vapilot">
                            <span class="cs">${esc(p.callsign || '—')}</span>
                            <span class="rt">${esc(p.depIcao || '???')} → ${esc(icao)}</span>
                            ${p.username ? `<span class="pl">${esc(p.username)}</span>` : ''}
                        </div>`).join('')}${vaInbound.length > VA_INBOUND_MAX
                            ? `<div class="emb-apt-vamore">+${vaInbound.length - VA_INBOUND_MAX} more inbound</div>` : ''}</div>`
                    : `<div class="emb-apt-sub" style="margin:0">No ${esc(vaName)} pilots inbound right now.</div>`}
            </div>`;

        return `
            <div class="emb-apt">
                <div class="emb-apt-head">${flag}<div style="min-width:0">
                    <div class="emb-apt-icao">${esc(icao)}</div>
                    <div class="emb-apt-name">${esc(name)}</div>
                    ${sub ? `<div class="emb-apt-sub">${esc(sub)}</div>` : ''}
                </div></div>
                ${metarMod}
                ${opsMod}
                ${trafficMod}
                ${vaInboundMod}
                ${poweredByHTML()}
            </div>`;
    }

    function addPilotLayer(map) {
        if (map.getSource(SOURCE_ID)) return;
        map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

        if (_mapState.hasIcons) {
            // Real aircraft silhouettes, rotated to heading and locked to the map
            // (so they bank with the globe), mirroring the live traffic layer. On a
            // light/white basemap the natural sprites wash out, so use the SDF twin
            // tinted black instead.
            const light = !!_mapState.lightBasemap;
            const base = ['coalesce', ['get', 'category'], 'B777'];
            const layer = {
                id: LAYER_ID,
                type: 'symbol',
                source: SOURCE_ID,
                layout: {
                    'icon-image': light
                        ? ['concat', 'icon-', base, '-sdf']
                        : ['concat', 'icon-', base],
                    'icon-size': 0.15,                   // matches the live map's default plane size
                    'icon-rotate': ['get', 'heading'],
                    'icon-rotation-alignment': 'map',
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true
                }
            };
            if (light) layer.paint = { 'icon-color': '#0b0f14' }; // black planes on white
            map.addLayer(layer);
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

        // Tap a plane → open the docked flight-info panel (bottom sheet on
        // mobile, side panel on desktop), mirroring the main tracker's flight
        // info window instead of a popup pinned to the aircraft.
        map.on('click', LAYER_ID, (e) => {
            const f = e.features && e.features[0];
            if (!f) return;
            const pr = f.properties || {};
            const coords = f.geometry.coordinates.slice();
            openDetail(map, pr, coords);
        });
        // Tapping empty map (not a plane) dismisses the panel.
        map.on('click', (e) => {
            const hits = map.queryRenderedFeatures(e.point, { layers: [LAYER_ID] });
            if (!hits.length) closeDetail(map);
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

        _mapState.cfg = cfg;       // branding for the tap card
        _mapState.pilots = pilots; // VA's live pilots — used for the airport window's inbound list

        if (!_mapState.map) {
            await loadMapEngine(cfg.provider);
            root.innerHTML = `
                ${cfg.hideHeader ? '' : headerHTML(cfg, pilots.length)}
                <div class="emb-map" id="emb-map"></div>
                ${cfg.hideHeader ? floatBrandHTML(cfg, pilots.length) : ''}`;

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
            map.addControl(new (gl().NavigationControl)({ showCompass: false }), 'top-left');
            // Hub markers are opt-in (off by default) via this toggle.
            _mapState.hubsVisible = false;
            if (cfg.hubs && cfg.hubs.length) {
                map.addControl(makeHubsControl(map, cfg), 'top-left');
            }

            map.on('style.load', () => { try { map.setFog(EMBED_FOG); } catch (_) {} });

            // First load: slice sprites, add the source+layer, seed it, fit view.
            map.once('load', async () => {
                try { await loadSpriteIcons(map); _mapState.hasIcons = true; }
                catch (_) { _mapState.hasIcons = false; }
                _mapState.lightBasemap = isLightBasemap(cfg);
                addPilotLayer(map);
                map.getSource(SOURCE_ID).setData(pilotsToGeoJSON(pilots));
                _mapState.ready = true;
                fitToPilots(map, pilots);
            });
            _mapState._firstFit = true;
            return;
        }

        // Subsequent polls: refresh the live count (header and/or floating badge)
        // + live data without re-fitting the camera (so we don't yank the view
        // while someone is panning).
        updateLiveCounts(root, pilots.length);
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
        if (root) root.innerHTML = `<div class="emb-loading"><img class="emb-loading-logo" src="Images/inflight-light.png" alt="Inflight" onerror="this.outerHTML='<span class=&quot;emb-loading-text&quot;>Inflight</span>'"></div>`;
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
        if (!cfg.logo || cfg.name === cfg.code || !cfg.hubs.length) {
            const brand = await resolveVaBranding(cfg.code);
            if (brand) {
                if (!cfg.logo && brand.logo) cfg.logo = brand.logo;
                if (cfg.name === cfg.code && brand.name) cfg.name = brand.name;
                if (!cfg.hubs.length && brand.hubs && brand.hubs.length) cfg.hubs = brand.hubs;
            }
        }

        const root = rootEl();
        root.setAttribute('data-theme', cfg.theme);
        root.classList.add('emb-mode-' + cfg.mode);
        root.classList.add('emb-pos-' + cfg.headerPos);
        if (cfg.hideHeader) root.classList.add('emb-noheader');
        if (cfg.compact) root.classList.add('emb-compact');
        if (cfg.radius != null) root.style.borderRadius = cfg.radius + 'px';
        applyCardTheme(root, cfg);

        // Colour the header from the VA's brand: explicit colours win (one or
        // several — several become a gradient), else we sample the logo's palette
        // (its two strongest hue families, when it has two, gradient together).
        // applyHeaderTheme also derives contrasting text colours and picks the
        // Inflight wordmark that stays legible on the result.
        let palette = cfg.brandColors;
        if (!palette.length && cfg.logo) {
            try { palette = (await extractLogoPalette(cfg.logo)) || []; } catch (_) { palette = []; }
        }
        cfg.brandLogo = applyHeaderTheme(root, palette, cfg);

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
