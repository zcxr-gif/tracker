/**
 * vaAds.js — VA-Ads client for the live tracker.
 *
 * Talks to the read-only VA-Ads endpoints served by the InGdo backend (the
 * same service that powers community aircraft photos). Replaces the old
 * Supabase "VA Partnership" system entirely.
 *
 *   GET /api/va-ads                     list (paginated, filterable)
 *   GET /api/va-ads/banner/:icao        banner ad(s) for an airport
 *   GET /api/va-ads/:id                 single ad by id
 *
 * Surfaces two things on the tracker:
 *   1. A banner inside the airport-info window for VAs hubbed at that field
 *      (window.InflightVaAds.hydrateAirportBanner(container, icao)).
 *   2. A "Partners" slide-over launched from the dashboard toolbar
 *      (window.InflightVaAds.openPartners()).
 *
 * Exposed as window.InflightVaAds. Loaded as a plain (non-module) script so it
 * is available synchronously before the deferred module scripts run.
 */
(function () {
    'use strict';

    const API_BASE = 'https://site--indgo-backend--6dmjph8ltlhv.code.run/api/va-ads';

    // ---------------------------------------------------------------------
    // Tiny helpers
    // ---------------------------------------------------------------------

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Canonical username key for roster ⇆ live-socket matching. The VA-Ads
    // backend and the live socket feed are two different sources for the SAME
    // pilot handle, and they don't always agree byte-for-byte: case, stray
    // whitespace, Unicode compatibility forms (full-width chars), a different
    // NFC/NFD composition, or an invisible zero-width/BiDi character can all
    // sneak in on one side and not the other. `.trim().toLowerCase()` alone
    // misses every case but the first two. Folding both sides through this one
    // function is what makes them line up: NFKC to collapse compatibility
    // forms, strip the invisible characters, drop internal whitespace (IF
    // handles carry none), then trim + lowercase. Both the roster set build and
    // the socket lookup MUST use this so the two keys are computed identically.
    function normUsername(u) {
        let s = String(u == null ? '' : u);
        try { s = s.normalize('NFKC'); } catch (_) { /* older engine — skip */ }
        return s
            // soft hyphen, zero-width chars, BiDi marks, word joiner, BOM
            .replace(/[\u00AD\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '')
            .replace(/\s+/g, '')
            .toLowerCase();
    }

    // Only allow http(s) links through; anything else (javascript:, etc.) is
    // dropped so external ad data can't smuggle a dangerous href in.
    function safeUrl(u) {
        const s = String(u || '').trim();
        return /^https?:\/\//i.test(s) ? s : '';
    }

    // A VA/event banner as an <img>, never a CSS background paint. bannerUrl is
    // always .webp and an animated upload comes back as ANIMATED WebP — it plays
    // by itself inside an <img>, but a frame painted into a background-image
    // would freeze on frame 1. The class sizes/crops it; a broken URL hides the
    // element so the slot collapses instead of showing a gap.
    function bannerImgHTML(url, cls, alt) {
        return url
            ? `<img class="${cls}" src="${esc(url)}" alt="${esc(alt || '')}" loading="lazy" decoding="async" onerror="this.style.display='none'">`
            : '';
    }

    // A callsign with all separators removed, upper-cased — "Air Canada 001VA"
    // → "AIRCANADA001VA", "Ocean XXVA" → "OCEANXXVA".
    //
    // NOTE on Infinite Flight callsigns: pilots fly under the FULL airline
    // callsign, e.g. "United 123" / "American 456" — NOT a short VA code like
    // "UVAL" or "AAL". So a partner VA is matched on the leading airline name
    // of that full callsign ("UNITED"), never on a short tag. Tags, when a VA
    // uses one at all, are an extra suffix on the flight number ("United 123VA")
    // and only refine membership — they are never the thing we match the VA on.
    function compactCallsign(s) {
        return stripWeightClass(callsignParts(s)).join('');
    }

    // Split a callsign into its uppercased, separator-free tokens.
    function callsignParts(s) {
        return String(s || '').trim().toUpperCase().split(/[\s\-_/]+/).filter(Boolean);
    }

    // Weight-class words a pilot appends for heavy/super aircraft — "United 2UA
    // Heavy", "Lufthansa 400 Super". They are spoken wake-turbulence categories,
    // never part of the airline name or the VA tag, so they are peeled off the
    // END of a callsign before the leading name and trailing flight-number/tag
    // token are read. Otherwise the last token reads "HEAVY"/"SUPER" and a member
    // flying a heavy is wrongly treated as not carrying the VA's tag — i.e. shown
    // as "not a registered member" even though they clearly are.
    const WEIGHT_CLASS = new Set(['HEAVY', 'SUPER']);
    function stripWeightClass(tokens) {
        const t = tokens.slice();
        while (t.length > 1 && WEIGHT_CLASS.has(t[t.length - 1])) t.pop();
        return t;
    }

    // The compacted-callsign offsets that land on a real WORD boundary of the
    // callsign: the end of each space-separated token, plus the letter→digit
    // seam inside a glued token ("UNITED123" → after "UNITED"). A partner code
    // must line up with one of these. Without this, the raw substring match
    // below lets a shorter airline whose name is only a FRAGMENT of a longer
    // one hijack the flight — e.g. a VA coded "UNI" (Uni Air) would swallow
    // every "United ###" callsign. The full word "UNITED" must match the full
    // word, not the first three letters of it.
    function callsignBoundaries(callsign) {
        const tokens = stripWeightClass(callsignParts(callsign));
        const bounds = new Set();
        let acc = '';
        for (const t of tokens) {
            const seam = t.match(/^([A-Z]+)\d/); // airline letters then a flight number
            if (seam) bounds.add((acc + seam[1]).length);
            acc += t;
            bounds.add(acc.length);
        }
        return bounds;
    }

    // True when a callsign token is a flight-number / placeholder / tag rather
    // than part of the airline name: "001", "001VA", "XXVA"/"##UA"/"XX"
    // (placeholders), or a short standalone tag word like "VA". The flight
    // number may be written as real digits OR as a placeholder run of "X" or
    // "#" — VAs commonly register a template callsign like "United ##UA", and
    // the "##" must be recognised as the number slot so the token is dropped
    // and the code reduces to the airline name "UNITED". Airline-name words
    // ("CANADA", "AIRWAYS") are kept.
    function isFlightNumberToken(t) {
        return /[0-9]/.test(t) || /^[X#]+[A-Z]*$/.test(t) || /^[A-Z]{1,3}$/.test(t);
    }

    // The VA's matching code — the airline-name portion of its callsign,
    // compacted. The trailing flight-number/tag token is dropped so a VA whose
    // callsign is "Air Canada 001VA" advertises as "AIRCANADA" (not just "AIR",
    // which used to swallow Air India / Airbus / Air France). Single-token codes
    // like "DLVA" are kept whole.
    //
    // A trailing "VIRTUAL" descriptor is also dropped: members fly the real
    // airline callsign ("United 123"), never "United Virtual 123", so a partner
    // registered as "United Virtual" must still resolve to "UNITED" and match
    // the flights that simply read "United". Otherwise its code ("UNITEDVIRTUAL")
    // never lines up with any real callsign and the flight falls through to some
    // other VA — the "callsign says United but it picks something else" bug.
    function vaCodeFromCallsign(s) {
        const parts = String(s || '').trim().toUpperCase().split(/[\s\-_/]+/).filter(Boolean);
        if (!parts.length) return '';
        if (parts.length >= 2 && isFlightNumberToken(parts[parts.length - 1])) parts.pop();
        if (parts.length >= 2 && parts[parts.length - 1] === 'VIRTUAL') parts.pop();
        return parts.join('');
    }

    async function getJSON(url) {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`VA-Ads request failed (${res.status})`);
        return res.json();
    }

    // ---------------------------------------------------------------------
    // Statistics beacons
    //
    // Every VA in the directory gets a daily scorecard — how many people saw it
    // on the tracker, how many opened it, and which links they followed. That
    // only works if this side reports what actually happened, so each surface
    // below fires a small typed event.
    //
    // Rules that keep it honest and cheap:
    //   • Events are QUEUED and flushed in one batched request (or a sendBeacon
    //     when the page is going away), never one request per click.
    //   • "Was seen" events (impression / open / profile) are deduped per VA for
    //     the life of the page, so a card rotating back into view — or a panel
    //     reopened five times — doesn't inflate the numbers. Clicks are never
    //     deduped: each one is a real, separate action.
    //   • Everything fails silently. A blocked or offline stats endpoint must
    //     never affect what the user sees.
    // ---------------------------------------------------------------------

    const STATS_URL = 'https://site--indgo-backend--6dmjph8ltlhv.code.run/api/va-stats/track';
    const STATS_FLUSH_MS = 4000;
    const ONCE_PER_SESSION = new Set(['impression', 'open', 'profile', 'roster']);

    let statsQueue = [];
    let statsTimer = null;
    const statsSeen = new Set();

    function flushStats(useBeacon) {
        if (statsTimer) { clearTimeout(statsTimer); statsTimer = null; }
        if (!statsQueue.length) return;
        const payload = JSON.stringify({ events: statsQueue.splice(0, statsQueue.length) });
        try {
            if (useBeacon && navigator.sendBeacon) {
                // A Blob with a JSON type keeps the request parseable by the same
                // express.json() handler the fetch path uses.
                navigator.sendBeacon(STATS_URL, new Blob([payload], { type: 'application/json' }));
                return;
            }
            fetch(STATS_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload,
                keepalive: true,
            }).catch(() => {});
        } catch (e) { /* stats are never worth surfacing */ }
    }

    // Queue one event. `immediate` skips the batching delay for actions a user
    // might navigate away from right after (outbound link clicks).
    function track(vaId, type, immediate) {
        const id = String(vaId || '').trim();
        if (!id || !type) return;
        if (ONCE_PER_SESSION.has(type)) {
            const key = type + ':' + id;
            if (statsSeen.has(key)) return;
            statsSeen.add(key);
        }
        statsQueue.push({ vaId: id, type: type });
        if (statsQueue.length >= 20 || immediate) { flushStats(false); return; }
        if (!statsTimer) statsTimer = setTimeout(() => flushStats(false), STATS_FLUSH_MS);
    }

    // ---------------------------------------------------------------------
    // Group flights
    //
    // A VA runs an event, a dozen aircraft depart together, and the owner wants
    // ONE link to post on the IFC rather than twelve. The owner selects the
    // aircraft from their VA's own Live Fleet list, titles it, and gets a short
    // link back.
    //
    // Who is allowed to publish is decided by the backend, not here: the VA is
    // bound to whichever Inflight account signs in with the contact email
    // already on file for the partnership, and only one account can hold it.
    // This side simply asks "do I own a VA?" once per session and shows the
    // controls if the answer names the VA whose panel is open.
    // ---------------------------------------------------------------------

    const GROUP_API = 'https://site--indgo-backend--6dmjph8ltlhv.code.run';

    let ownerStatePromise = null;   // cached per page load

    async function accessToken() {
        try {
            return typeof window.getInflightAccessToken === 'function'
                ? await window.getInflightAccessToken()
                : null;
        } catch (e) { return null; }
    }

    // { signedIn, va } for the current account. The two are kept apart on
    // purpose: "not signed in" and "signed in but hasn't linked a VA yet" need
    // different treatment — the second gets offered the claim, the first
    // shouldn't be nagged. Cached because every panel render would otherwise
    // re-ask and the answer can't change mid-session (a claim updates it in
    // place).
    async function ownerState() {
        if (ownerStatePromise) return ownerStatePromise;
        ownerStatePromise = (async () => {
            const token = await accessToken();
            if (!token) return { signedIn: false, va: null };
            try {
                const res = await fetch(`${GROUP_API}/api/va-link/me`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ accessToken: token }),
                });
                const data = await res.json();
                if (!data || !data.ok) return { signedIn: false, va: null };
                return { signedIn: !!data.signedIn, va: data.va || null };
            } catch (e) { return { signedIn: false, va: null }; }
        })();
        return ownerStatePromise;
    }

    // Bind this account to the VA registered to its email address.
    async function claimVa() {
        const token = await accessToken();
        if (!token) return { ok: false, error: 'Sign in to Inflight first.' };
        try {
            const res = await fetch(`${GROUP_API}/api/va-link/claim`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accessToken: token }),
            });
            const data = await res.json();
            if (data && data.ok) ownerStatePromise = Promise.resolve({ signedIn: true, va: data.va });
            return data || { ok: false, error: 'Could not link your account.' };
        } catch (e) {
            return { ok: false, error: 'Could not reach the server.' };
        }
    }

    // Publish. `fleet` entries are the same shape liveFleetFor() produces.
    async function publishGroupFlight(title, fleet, eventId) {
        const token = await accessToken();
        if (!token) return { ok: false, error: 'Sign in to Inflight first.' };
        const aircraft = fleet.map((f) => {
            const pos = parseMaybeJSON(f.props.position) || {};
            return {
                flightId: f.props.flightId || f.props.id || '',
                callsign: f.callsign,
                username: f.username,
                aircraft: f.type,
                livery: f.livery,
                dep: f.dep,
                arr: f.arr,
                lat: pos.lat != null ? pos.lat : pos.latitude,
                lon: pos.lon != null ? pos.lon : pos.longitude,
                altFt: f.altFt,
                gsKt: f.gsKt,
                headingDeg: pos.heading_deg,
            };
        }).filter((a) => a.flightId);

        try {
            const res = await fetch(`${GROUP_API}/api/group-flights`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    accessToken: token,
                    title,
                    aircraft,
                    eventId: eventId || undefined,
                    server: typeof window.getCurrentServerName === 'function' ? window.getCurrentServerName() : '',
                }),
            });
            return await res.json();
        } catch (e) {
            return { ok: false, error: 'Could not reach the server.' };
        }
    }

    function buildQuery(params) {
        const q = new URLSearchParams();
        Object.keys(params || {}).forEach((k) => {
            const v = params[k];
            if (v !== undefined && v !== null && v !== '') q.set(k, v);
        });
        const s = q.toString();
        return s ? `?${s}` : '';
    }

    // The backend's exact field names aren't pinned down here, so normalise the
    // common variants into one predictable shape the renderers can rely on.
    function normalizeAd(ad) {
        if (!ad || typeof ad !== 'object') return null;
        const tags = Array.isArray(ad.tags)
            ? ad.tags
            : (typeof ad.tags === 'string'
                ? ad.tags.split(',').map((t) => t.trim()).filter(Boolean)
                : []);
        let icaoRaw = ad.icao != null ? ad.icao : (ad.hubs != null ? ad.hubs : ad.hub);
        const icao = Array.isArray(icaoRaw)
            ? icaoRaw
            : (typeof icaoRaw === 'string'
                ? icaoRaw.split(',').map((t) => t.trim()).filter(Boolean)
                : []);
        return {
            id: ad.id || ad._id || '',
            // The VA's crew center address (/crew/<slug>). Present on approved
            // ads that have one configured; null otherwise, and we never guess
            // one from the callsign — a VA with a custom slug would 404.
            slug: (() => {
                const s = String(ad.slug || '').trim().toLowerCase();
                return /^[a-z0-9][a-z0-9._-]{0,80}$/.test(s) ? s : null;
            })(),
            callsign: String(ad.callsign || ad.callsignCode || ad.code || '').trim().toUpperCase(),
            name: ad.name || ad.vaName || ad.title || 'Unknown VA',
            tagline: ad.tagline || ad.slogan || '',
            description: ad.description || ad.desc || '',
            type: String(ad.type || '').toUpperCase(),
            region: ad.region || '',
            recruiting: ad.recruiting === true || ad.recruiting === 'true',
            featured: ad.featured === true || ad.featured === 'true',
            tags: tags,
            logo: safeUrl(ad.logo || ad.logoUrl || ad.logo_url),
            banner: safeUrl(ad.banner || ad.bannerUrl || ad.banner_url || ad.image),
            website: safeUrl(ad.website || ad.websiteUrl || ad.website_url || ad.url || ad.link),
            discord: safeUrl(ad.discord || ad.discordUrl || ad.discord_url),
            icao: icao.map((c) => String(c).toUpperCase()),
            views: Number(ad.views != null ? ad.views : (ad.viewCount != null ? ad.viewCount : 0)) || 0
        };
    }

    function normalizeList(payload) {
        const arr = Array.isArray(payload)
            ? payload
            : (payload && Array.isArray(payload.data) ? payload.data : []);
        return arr.map(normalizeAd).filter(Boolean);
    }

    // ---------------------------------------------------------------------
    // Data API
    // ---------------------------------------------------------------------

    async function list(params) {
        const payload = await getJSON(`${API_BASE}${buildQuery(params)}`);
        return {
            ads: normalizeList(payload),
            pagination: (payload && payload.pagination) || null
        };
    }

    async function banner(icao, opts) {
        const code = String(icao || '').trim().toUpperCase();
        if (!code) return [];
        const payload = await getJSON(`${API_BASE}/banner/${encodeURIComponent(code)}${buildQuery(opts)}`);
        // ?pick=random returns a single ad object under data.
        if (payload && payload.data && !Array.isArray(payload.data)) {
            const one = normalizeAd(payload.data);
            return one ? [one] : [];
        }
        return normalizeList(payload);
    }

    async function get(id) {
        if (!id) return null;
        const payload = await getJSON(`${API_BASE}/${encodeURIComponent(id)}`);
        return normalizeAd(payload && payload.data ? payload.data : payload);
    }

    // ---------------------------------------------------------------------
    // Public per-VA data — pilot roster + scheduled events. These live on the
    // same InGdo backend under /api/public/va/:id/* (no auth, open CORS,
    // cacheable 60s). :id is the VA ad's own id — the same id used by get()
    // above. Both fail soft to an empty shape so a missing/slow feed never
    // breaks the partner detail panel.
    // ---------------------------------------------------------------------

    const PUBLIC_BASE = 'https://site--indgo-backend--6dmjph8ltlhv.code.run/api/public/va';

    // Roster page: { total, rosterTotal, pilots:[{username, addedAt}] }.
    // opts may carry q (search), limit (default 500, max 2000) and skip (paging).
    async function pilots(id, opts) {
        const empty = { total: 0, rosterTotal: 0, pilots: [] };
        if (!id) return empty;
        try {
            const payload = await getJSON(`${PUBLIC_BASE}/${encodeURIComponent(id)}/pilots${buildQuery(opts)}`);
            return {
                total: Number(payload && payload.total) || 0,
                rosterTotal: Number(payload && payload.rosterTotal) || 0,
                pilots: Array.isArray(payload && payload.pilots) ? payload.pilots : []
            };
        } catch (e) {
            return empty;
        }
    }

    // Upcoming scheduled events (soonest first, max 50) — each
    // { id, title, description, link, startsAt, createdAt }.
    async function events(id) {
        if (!id) return [];
        try {
            const payload = await getJSON(`${PUBLIC_BASE}/${encodeURIComponent(id)}/events`);
            return Array.isArray(payload && payload.events) ? payload.events : [];
        } catch (e) {
            return [];
        }
    }

    // ---------------------------------------------------------------------
    // Callsign directory — maps partner VA callsign codes to their ad so a
    // live flight can be matched to the VA whose code its callsign starts with.
    // ---------------------------------------------------------------------

    let directoryPromise = null;
    let directory = null; // [{ code, ad }] sorted longest-code-first
    let allAds = [];      // every partner ad we pulled (used for hub lookups)

    function loadDirectory() {
        if (directoryPromise) return directoryPromise;
        directoryPromise = (async () => {
            const all = [];
            try {
                // A few pages is plenty to cover the partner roster; bail early
                // once we've seen the last page.
                for (let page = 1; page <= 3; page++) {
                    const { ads, pagination } = await list({ limit: 100, page });
                    all.push(...ads);
                    if (!ads.length) break;
                    if (pagination && pagination.totalPages && page >= pagination.totalPages) break;
                    if (!pagination) break;
                }
            } catch (e) {
                // Keep whatever we managed to collect; matching just covers less.
            }
            allAds = all;
            directory = all
                .map((ad) => ({ code: vaCodeFromCallsign(ad.callsign), ad }))
                .filter((entry) => entry.code)
                .sort((a, b) => b.code.length - a.code.length);
            return directory;
        })();
        return directoryPromise;
    }

    // Match a flight callsign to a partner VA by its full airline-name code
    // (e.g. "Air Canada 001VA" matches the VA coded "AIRCANADA", but "Air India
    // 123" / "Airbus …" do not). The flight callsign is compacted and tested
    // against each VA code as a prefix; longest code wins so the most specific
    // VA matches first.
    //
    // The prefix must end on a callsign WORD boundary (see callsignBoundaries),
    // so the VA's full airline name has to match the flight's full airline name —
    // "UNITED" matches "United 123" but a fragment like "UNI" (Uni Air) cannot
    // grab it. Synchronous — reads the warm cache.
    function matchCallsign(callsign) {
        if (!directory) { loadDirectory(); return null; }
        const compact = compactCallsign(callsign);
        if (!compact) return null;
        const bounds = callsignBoundaries(callsign);
        const hit = directory.find((entry) =>
            compact.startsWith(entry.code) && bounds.has(entry.code.length));
        return hit ? hit.ad : null;
    }

    // Trailing word of a callsign, upper-cased — the flight-number+tag part.
    // "Air Canada 001VA" → "001VA", "OceanXXVA" → "OCEANXXVA".
    function lastToken(s) {
        const parts = stripWeightClass(callsignParts(s));
        return parts.length ? parts[parts.length - 1] : '';
    }

    // The VA's callsign tag — the suffix a member appends to their flight
    // number, derived from the VA's declared callsign. The tag is the trailing
    // letters of the last token after its number/placeholder run:
    //   "Ocean XXVA"        → "VA"   (XX is the flight-number placeholder)
    //   "United ##UA"       → "UA"   (## is the flight-number placeholder)
    //   "Air Canada 001VA"  → "VA"
    //   "Delta VA"          → "VA"   (tag declared as its own word)
    //   "Ocean"             → ""     (no tag declared — membership unknowable)
    function vaTag(ad) {
        const lt = lastToken(ad && ad.callsign);
        if (!lt) return '';
        const m = lt.match(/^[0-9X#]+([A-Z]+)$/);  // <number/placeholder><TAG>
        if (m) return m[1];
        // Tag declared as a separate short word (and not the airline name itself).
        const parts = String(ad.callsign || '').trim().toUpperCase().split(/[\s\-_/]+/).filter(Boolean);
        if (parts.length >= 2 && /^[A-Z]{1,3}$/.test(lt)) return lt;
        return '';
    }

    // Does this flight callsign mark the pilot as a registered member of the
    // matched VA? Mirrors the embed's prefix+tag filtering: the callsign must
    // match the VA (leading word, via matchCallsign) AND carry the VA's tag on
    // its flight-number token. "Air Canada 001VA" → member; "Air Canada 500" →
    // matched as a partner but not a registered member. Pass the already-matched
    // ad to avoid a second directory lookup; otherwise it is resolved here.
    function isCallsignMember(callsign, ad) {
        const va = ad || matchCallsign(callsign);
        if (!va) return false;
        // Use the VA's declared tag when it has one (e.g. "Ocean XXVA" → "VA");
        // otherwise fall back to the standard "VA" suffix that denotes a virtual
        // airline member. The tag must sit as a REAL tag (whole token, or glued
        // onto the flight number — see tokenCarriesTag), not just any trailing
        // letters: "Air Canada 001VA" → member; "108AC"/"500"/"1NOVA" → not.
        // Checked on the last two tokens so a second trailing tag ("… 001VA CX")
        // doesn't hide the membership tag, matching the embed's rule.
        const tag = vaTag(va) || 'VA';
        return callsignHasTag(callsign, tag);
    }

    // ---------------------------------------------------------------------
    // VA membership for the live-map "filter to one VA" feature. A plane counts
    // for a VA when EITHER its callsign carries that VA's suffix tag, OR the
    // pilot is on the VA's registered roster AND is flying the VA's airline
    // callsign (the roster waives the tag, never the airline — a rostered pilot
    // flying some other VA's callsign is not this VA's flight). The one
    // exception is the generic "VA" tag: countless VAs share it, so matching on
    // it alone would lump every "###VA" pilot together — for those we keep the
    // default behaviour (the leading airline word must resolve to THIS VA, via
    // matchCallsign), which is exactly how the rest of the tracker already
    // decides membership.
    // ---------------------------------------------------------------------

    // Is `tag` actually a TAG on this token, not just letters that happen to end
    // it? A bare endsWith is far too greedy — "9ANV" would count for an "NV"
    // VA, "MOSKVA"/"NOVA" for a "VA" one. A tag only counts when it is EITHER
    // the whole token (declared as its own word: "Air Norway 123 NV") or glued
    // straight onto the flight number ("123NV" — the char before it is a
    // digit). Mirrors the embed's tokenHasSuffixTag exactly.
    function tokenCarriesTag(token, tag) {
        if (!token || !tag || !token.endsWith(tag)) return false;
        if (token === tag) return true;                        // standalone tag word
        const before = token.charAt(token.length - tag.length - 1);
        return before >= '0' && before <= '9';                 // tag on a number
    }

    // Does the callsign carry `tag` as a real membership tag? Checked on the
    // LAST TWO tokens (weight-class words stripped) because pilots often append
    // a second trailing tag after the VA one — "Air Norway 123NV EX" — and the
    // tag may be written as its own word ("Air Norway 123 NV").
    function callsignHasTag(callsign, tag) {
        if (!tag) return false;
        const tail = stripWeightClass(callsignParts(callsign)).slice(-2);
        return tail.some((t) => tokenCarriesTag(t, tag));
    }

    // Does the callsign's leading airline word belong to this ad? The same
    // word-boundary prefix test matchCallsign runs, but against ONE ad instead
    // of the whole directory — so it needs no directory warm-up.
    function callsignMatchesAd(callsign, ad) {
        const code = vaCodeFromCallsign(ad && ad.callsign);
        if (!code) return false;
        const compact = compactCallsign(callsign);
        return compact.startsWith(code) && callsignBoundaries(callsign).has(code.length);
    }

    // Per-VA roster cache. ensureRoster(adId) pulls the public roster once and
    // remembers each pilot under its canonical normUsername() key; rosterHas()
    // is the synchronous lookup the map's per-feature tagging calls, keyed the
    // same way. Both fail soft to "no roster".
    const rosterSets = new Map();     // adId -> Set(normUsername) once resolved
    const rosterPromises = new Map(); // adId -> in-flight fetch promise

    function ensureRoster(adId) {
        const id = String(adId || '');
        if (!id) return Promise.resolve(new Set());
        if (rosterSets.has(id)) return Promise.resolve(rosterSets.get(id));
        if (rosterPromises.has(id)) return rosterPromises.get(id);
        const p = (async () => {
            const set = new Set();
            try {
                // limit is capped at 2000 server-side — one page covers any roster.
                const res = await pilots(id, { limit: 2000 });
                (res.pilots || []).forEach((pl) => {
                    const u = normUsername(pl.username);
                    if (u) set.add(u);
                });
            } catch (e) { /* keep the empty set — matching falls back to the tag */ }
            rosterSets.set(id, set);
            return set;
        })();
        rosterPromises.set(id, p);
        return p;
    }

    // usernameNorm must already be a normUsername() key (the set is built from
    // the same function), so the roster and the live socket handle compare as
    // the same canonical string.
    function rosterHas(adId, usernameNorm) {
        const s = rosterSets.get(String(adId || ''));
        return !!(s && usernameNorm && s.has(usernameNorm));
    }

    // The map filter's membership test for one VA. Synchronous — roster hits only
    // resolve once ensureRoster(ad.id) has run (the caller warms it, then re-tags).
    function vaFilterMember(callsign, username, ad) {
        if (!ad) return false;
        // A rostered pilot still has to be flying THIS VA's airline callsign —
        // the roster only waives the suffix tag ("Air Norway 123" flown by a
        // registered Norway pilot counts). It must NOT vouch for whatever else
        // that pilot happens to be flying: their "Etihad 456FR" for some other
        // VA stays out of a Norway VA filter.
        const uname = normUsername(username);
        if (uname && rosterHas(ad.id, uname) && callsignMatchesAd(callsign, ad)) return true;
        const tag = vaTag(ad) || 'VA';
        if (tag === 'VA') {
            // Generic tag → the leading airline word must resolve to THIS VA and
            // the callsign must carry the tag (the tracker's default behaviour).
            const hit = matchCallsign(callsign);
            return !!hit && String(hit.id) === String(ad.id) && isCallsignMember(callsign, hit);
        }
        // Distinctive tag → the suffix alone identifies the VA.
        return callsignHasTag(callsign, tag);
    }

    // All partner ads hubbed at an airport (from the cached roster — no extra
    // request). Used to flag airports in search results.
    function partnersForIcao(icao) {
        const code = String(icao || '').trim().toUpperCase();
        if (!code || !allAds.length) return [];
        return allAds.filter((ad) => ad.icao && ad.icao.indexOf(code) !== -1);
    }

    // Every partner ad we've cached (after loadDirectory). Used by the tracker
    // to place opt-in VA hub markers on the live map.
    function allPartners() {
        return allAds.slice();
    }

    // Small inline badge for a callsign-matched partner VA. variant 'hover' is
    // a logo-only chip for the map hover card; 'info' is a logo + name row for
    // the flight info window, with a membership disclaimer when the pilot is
    // not flagged as a VA member. Returns '' when there is no match.
    function callsignBadgeHTML(callsign, opts) {
        injectStyles();
        const ad = matchCallsign(callsign);
        if (!ad) return '';
        const o = opts || {};
        const logo = ad.logo
            ? `<img class="va-cs-logo" src="${esc(ad.logo)}" alt="" onerror="this.style.display='none'">`
            : '';
        if (o.variant === 'hover') {
            return logo
                ? `<span class="va-cs-badge va-cs-hover" title="${esc(ad.name)} · partner VA">${logo}</span>`
                : '';
        }
        // Registered member when the caller already knows it, or when the
        // callsign itself carries the VA's tag (e.g. "Air Canada 001VA").
        const member = o.isMember || isCallsignMember(callsign, ad);
        const note = member
            ? `<span class="va-cs-note va-cs-member"><i class="fa-solid fa-circle-check"></i> Registered ${esc(ad.name)} member</span>`
            : `<span class="va-cs-note">not a registered ${esc(ad.name)} member</span>`;
        return `
            <div class="va-cs-badge va-cs-info" data-va-ad-id="${esc(ad.id)}" role="button" tabindex="0" title="View ${esc(ad.name)}">
                ${logo || '<i class="fa-solid fa-handshake-angle" style="color:#7dd3fc"></i>'}
                <span class="va-cs-name">${esc(ad.name)} <span class="va-cs-tag">Partner VA</span></span>
                ${note}
            </div>`;
    }

    // ---------------------------------------------------------------------
    // Styles
    // ---------------------------------------------------------------------

    let stylesInjected = false;
    function injectStyles() {
        if (stylesInjected || typeof document === 'undefined') return;
        stylesInjected = true;
        const style = document.createElement('style');
        style.id = 'va-ads-styles';
        style.textContent = `
            .va-ad-banner-slot { margin: 16px; }
            .va-ad-logo {
                width: 44px; height: 44px; max-width: 44px; max-height: 44px;
                border-radius: 10px; object-fit: cover; overflow: hidden;
                background: rgba(0,0,0,0.35); flex: 0 0 auto;
                display: flex; align-items: center; justify-content: center; color: #7dd3fc;
            }
            /* The flex centering above is for the icon fallback (<div>); on the
               logo <img> it can let an intrinsically large image escape the box,
               so pin the <img> to a plain, clipped replaced element. */
            img.va-ad-logo { display: block; }
            .va-ad-eyebrow {
                font-size: 0.6rem; font-weight: 800; letter-spacing: .08em;
                text-transform: uppercase; color: #7dd3fc; display: flex; gap: 8px; align-items: center;
            }
            .va-ad-name { font-weight: 700; color: #fff; font-size: 0.95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .va-ad-tag { font-size: 0.78rem; color: rgba(255,255,255,0.6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .va-ad-pill {
                font-size: 0.58rem; font-weight: 800; text-transform: uppercase; letter-spacing: .05em;
                padding: 2px 6px; border-radius: 999px;
                background: rgba(74,222,128,0.15); color: #4ade80; border: 1px solid rgba(74,222,128,0.35);
            }
            .va-ad-pill.va-ad-pill-featured { background: rgba(250,204,21,0.15); color: #facc15; border-color: rgba(250,204,21,0.35); }

            .va-ad-feature {
                position: relative; cursor: pointer; overflow: hidden; border-radius: 14px;
                border: 1px solid rgba(255,255,255,0.08);
                background: linear-gradient(135deg, rgba(56,189,248,0.10), rgba(23,23,23,0.55));
                transition: border-color .15s ease, transform .15s ease;
            }
            .va-ad-feature:hover { border-color: rgba(56,189,248,0.4); transform: translateY(-1px); }
            .va-ad-feature-card { transition: opacity .25s ease; }

            /* Full, uncropped VA banner — the whole artwork the VA uploaded,
               sized to the slot width at its natural aspect ratio rather than
               clipped into a strip. Shown in addition to the compact ad card. */
            .va-ad-full {
                position: relative; cursor: pointer; overflow: hidden; border-radius: 14px;
                border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03);
                transition: border-color .15s ease, transform .15s ease;
            }
            .va-ad-full:hover { border-color: rgba(56,189,248,0.4); transform: translateY(-1px); }
            /* Full, uncropped banner. Capped in height so a partner who uploads a
               square/tall logo into the banner slot can't blow the image up to
               fill the whole flight/airport window — object-fit: contain keeps it
               uncropped, just letterboxed, within the cap. Normal wide banners
               stay well under the cap and are unaffected. */
            .va-ad-full-img { display: block; width: 100%; height: auto; max-height: 220px; object-fit: contain; transition: opacity .25s ease; }
            .va-ad-full .va-ad-dots { padding-top: 8px; }
            .va-ad-feature-banner { display: block; width: 100%; height: 84px; object-fit: cover; background-color: rgba(56,189,248,0.08); }
            .va-ad-feature-body { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; }
            .va-ad-feature-meta { min-width: 0; flex: 1; }
            .va-ad-feature .va-ad-name { white-space: normal; }
            .va-ad-dots { display: flex; gap: 5px; justify-content: center; padding: 0 0 10px; }
            .va-ad-dot { width: 5px; height: 5px; border-radius: 50%; background: rgba(255,255,255,0.3); transition: background .2s ease, transform .2s ease; }
            .va-ad-dot.is-active { background: #7dd3fc; transform: scale(1.3); }

            .va-cs-badge { display: inline-flex; align-items: center; gap: 6px; vertical-align: middle; }
            .va-cs-hover { margin-left: 6px; }
            .va-cs-logo { width: 16px; height: 16px; max-width: 18px; max-height: 18px; border-radius: 4px; object-fit: cover; overflow: hidden; background: rgba(0,0,0,0.3); flex: 0 0 auto; }
            .va-cs-info {
                margin-top: 8px; padding: 5px 9px; border-radius: 8px; cursor: pointer; max-width: 100%;
                background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.12); backdrop-filter: blur(4px);
                flex-wrap: wrap;
            }
            .va-cs-info:hover { border-color: rgba(56,189,248,0.4); }
            .va-cs-info .va-cs-logo { width: 18px; height: 18px; }
            .va-cs-name { font-size: 11px; font-weight: 700; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.8); }
            .va-cs-tag { font-size: 8.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; color: #7dd3fc; margin-left: 2px; }
            .va-cs-note { font-size: 9px; font-weight: 600; color: #fca5a5; margin-left: 4px; }
            .va-cs-note.va-cs-member { color: #4ade80; }
            .va-cs-note.va-cs-member i { margin-right: 2px; }

            /* Collapsible hero badge: opens full, then shrinks to a logo-only
               chip a few seconds after the window opens. Hovering (or keyboard
               focus) re-expands it. Driven by the .va-cs-collapsed class that
               flight.js toggles on a timer. */
            .va-cs-info { transition: padding .3s ease, gap .3s ease, background .2s ease, border-color .2s ease; overflow: hidden; }
            .va-cs-name, .va-cs-note {
                white-space: nowrap; overflow: hidden;
                max-width: 320px; opacity: 1;
                transition: max-width .35s ease, opacity .25s ease, margin .3s ease;
            }
            .va-cs-info.va-cs-collapsed { gap: 0; }
            .va-cs-info.va-cs-collapsed .va-cs-name,
            .va-cs-info.va-cs-collapsed .va-cs-note {
                max-width: 0; opacity: 0; margin-left: 0;
            }
            .va-cs-info.va-cs-collapsed:hover .va-cs-name,
            .va-cs-info.va-cs-collapsed:focus-within .va-cs-name,
            .va-cs-info.va-cs-collapsed:hover .va-cs-note,
            .va-cs-info.va-cs-collapsed:focus-within .va-cs-note {
                max-width: 320px; opacity: 1; margin-left: 4px;
            }

            .va-partners-overlay {
                position: fixed; inset: 0; z-index: 5050;
                display: flex; justify-content: flex-end;
                background: rgba(0,0,0,0.55); backdrop-filter: blur(4px);
                opacity: 0; pointer-events: none; transition: opacity .2s ease;
            }
            .va-partners-overlay.visible { opacity: 1; pointer-events: auto; }
            .va-partners-panel {
                width: min(640px, 94vw); height: 100%; display: flex; flex-direction: column;
                background: #121212; border-left: 1px solid rgba(255,255,255,0.08);
                transform: translateX(20px); transition: transform .25s cubic-bezier(0.16,1,0.3,1);
            }
            .va-partners-overlay.visible .va-partners-panel { transform: translateX(0); }
            .va-partners-grip { display: none; }
            .va-partners-head {
                display: flex; align-items: flex-end; justify-content: space-between;
                gap: 12px; padding: 18px 18px 14px; flex: 0 0 auto;
                border-bottom: 1px solid rgba(255,255,255,0.06);
            }
            .va-partners-titles { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
            .va-partners-eyebrow {
                font-size: 11px; font-weight: 700; letter-spacing: .6px;
                text-transform: uppercase; color: rgba(255,255,255,0.45);
            }
            .va-partners-head h2 { font-size: 1.6rem; font-weight: 800; letter-spacing: -0.5px; color: #fff; margin: 0; line-height: 1; }
            .va-partners-close {
                background: rgba(255,255,255,0.06); border: none; color: #fff; cursor: pointer;
                width: 34px; height: 34px; border-radius: 50%; font-size: 0.95rem;
                display: grid; place-items: center; flex: 0 0 auto;
            }
            .va-partners-close:hover { background: rgba(255,255,255,0.12); }
            .va-partners-search { padding: 12px 18px; border-bottom: 1px solid rgba(255,255,255,0.06); flex: 0 0 auto; }
            .va-partners-search input {
                width: 100%; box-sizing: border-box; padding: 9px 12px; border-radius: 10px;
                background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.12);
                color: #fff; font-size: 0.85rem;
            }
            .va-partners-body {
                flex: 1 1 auto; min-height: 0; overflow-y: auto;
                -webkit-overflow-scrolling: touch; overscroll-behavior: contain;
                padding: 14px 18px; padding-bottom: max(env(safe-area-inset-bottom, 0px), 18px);
                /* Responsive grid: cards flow 2-up when the panel has room
                   instead of one fixed column sandwiching everything.
                   Rows MUST be max-content: with plain auto rows, once the list
                   overflows the fixed-height panel the browser compresses every
                   row and the overflow:hidden cards clip to empty slivers. */
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
                grid-auto-rows: max-content;
                gap: 12px;
                align-content: start;
            }
            .va-partners-empty { grid-column: 1 / -1; color: rgba(255,255,255,0.55); text-align: center; padding: 40px 10px; font-size: 0.9rem; }
            .va-ad-detail { grid-column: 1 / -1; }

            /* Mobile: present as a bottom sheet that slides up, matching the other
               iOS tabs (server / weather / ATC) instead of a right slide-over.
               Taller sheet + clipped-tab-bar padding so the whole VA list scrolls. */
            @media (max-width: 768px) {
                .va-partners-overlay { justify-content: center; align-items: flex-end; }
                .va-partners-panel {
                    width: 100%; max-width: 100%;
                    height: min(90dvh, 880px);
                    border-left: none; border-radius: 22px 22px 0 0;
                    transform: translateY(101%);
                    transition: transform .42s cubic-bezier(0.16,1,0.3,1);
                    box-shadow: 0 -10px 44px rgba(0,0,0,0.5);
                }
                .va-partners-overlay.visible .va-partners-panel { transform: translateY(0); }
                .va-partners-grip {
                    display: block; flex: 0 0 auto;
                    width: 38px; height: 5px; border-radius: 10px;
                    background: rgba(255,255,255,0.22); margin: 9px auto 2px; touch-action: none;
                }
                .va-partners-head { padding: 6px 20px 12px; touch-action: none; }
                .va-partners-head h2 { font-size: 1.7rem; }
                .va-partners-body { gap: 8px; padding-bottom: max(env(safe-area-inset-bottom, 0px), 96px); }
                /* Compact list rows — drop the big banner so many more VAs fit
                   on screen (logo + name + tagline only). */
                .va-ad-card-banner { display: none; }
                .va-ad-card { border-radius: 12px; }
                .va-ad-card-body { padding: 10px 12px; align-items: center; gap: 11px; }
                .va-ad-card-body .va-ad-logo { width: 38px; height: 38px; }
                .va-ad-card-title { font-size: 0.9rem; }
                .va-ad-card-sub { margin-top: 1px; }
                .va-ad-chips { margin-top: 5px; }
            }
            .va-ad-card {
                border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; overflow: hidden;
                background: rgba(255,255,255,0.03); cursor: pointer; transition: border-color .15s ease, transform .15s ease;
                display: flex; flex-direction: column;
            }
            .va-ad-card .va-ad-card-body { flex: 1 1 auto; }
            .va-ad-card:hover { border-color: rgba(56,189,248,0.4); transform: translateY(-2px); }
            /* The card is position:static, so anchor the star against the panel
               and let the card establish the containing block only here. */
            .va-ad-card { position: relative; }
            .va-fav-btn {
                position: absolute; top: 8px; right: 8px; z-index: 2;
                width: 30px; height: 30px; border-radius: 9px;
                display: grid; place-items: center; cursor: pointer;
                border: 1px solid rgba(255,255,255,0.14);
                background: rgba(12,14,20,0.62); color: rgba(255,255,255,0.62);
                font-size: 12px; line-height: 1;
                backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
                transition: color .15s ease, border-color .15s ease, background .15s ease;
            }
            .va-fav-btn:hover { color: #fbbf24; border-color: rgba(251,191,36,0.5); background: rgba(12,14,20,0.85); }
            .va-fav-btn.is-on { color: #fbbf24; border-color: rgba(251,191,36,0.55); }
            .va-fav-btn:active { transform: scale(0.94); }
            /* No explicit display: it's a flex child of .va-ad-card (so already
               block-level, no inline gap) and the mobile rule below hides it
               with display:none — setting display here would override that. */
            .va-ad-card-banner { width: 100%; height: 92px; object-fit: cover; background-color: rgba(56,189,248,0.08); }
            .va-ad-card-body { padding: 12px 14px; display: flex; gap: 12px; align-items: flex-start; }
            .va-ad-card-body .va-ad-logo { width: 40px; height: 40px; }
            .va-ad-card-title { font-weight: 700; color: #fff; font-size: 0.92rem; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
            .va-ad-card-sub { font-size: 0.78rem; color: rgba(255,255,255,0.6); margin-top: 2px; }
            .va-ad-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
            .va-ad-chip { font-size: 0.62rem; color: rgba(255,255,255,0.7); background: rgba(255,255,255,0.07); border-radius: 999px; padding: 2px 8px; }

            .va-ad-detail-banner { display: block; width: 100%; height: 140px; object-fit: cover; background-color: rgba(56,189,248,0.1); border-radius: 14px; }
            .va-ad-detail h3 { color: #fff; font-size: 1.2rem; font-weight: 800; margin: 14px 0 4px; }
            .va-ad-detail p.desc { color: rgba(255,255,255,0.75); font-size: 0.88rem; line-height: 1.55; white-space: pre-wrap; }
            .va-ad-detail .va-ad-actions { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
            .va-ad-btn {
                display: inline-flex; align-items: center; gap: 8px; text-decoration: none;
                padding: 9px 14px; border-radius: 10px; font-weight: 700; font-size: 0.82rem;
                background: rgba(56,189,248,0.15); color: #7dd3fc; border: 1px solid rgba(56,189,248,0.35);
            }
            .va-ad-btn:hover { background: rgba(56,189,248,0.25); }
            /* Yellow "Apply now" — the attention CTA that jumps to the VA's site. */
            /* Crew Center: the sign-in door for pilots already in the VA. Styled
               as a secondary action so it reads as distinct from "Apply now",
               which is aimed at people who aren't members yet. */
            .va-ad-crew {
                display: inline-flex; align-items: center; gap: 7px; text-decoration: none;
                padding: 9px 16px; border-radius: 10px; font-weight: 800; font-size: 0.82rem;
                background: rgba(56,189,248,0.12); color: #7dd3fc;
                border: 1px solid rgba(56,189,248,0.42);
                transition: background .15s ease, border-color .15s ease, transform .12s ease;
            }
            .va-ad-crew:hover { background: rgba(56,189,248,0.2); border-color: rgba(56,189,248,0.7); }
            .va-ad-crew:active { transform: scale(0.98); }
            .va-ad-crew.sm { padding: 6px 11px; font-size: 0.76rem; border-radius: 8px; }
            .va-ad-card-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 9px; }
            .va-ad-card-actions .va-ad-apply.sm { margin-top: 0; }

            .va-ad-apply {
                display: inline-flex; align-items: center; gap: 7px; text-decoration: none;
                padding: 9px 16px; border-radius: 10px; font-weight: 800; font-size: 0.82rem;
                background: #fbbf24; color: #1a1205; border: 1px solid rgba(251,191,36,0.5);
                box-shadow: 0 2px 12px rgba(251,191,36,0.3);
                transition: background .15s ease, transform .12s ease;
            }
            .va-ad-apply:hover { background: #fcd34d; transform: translateY(-1px); }
            .va-ad-apply.sm { padding: 5px 11px; font-size: 0.7rem; border-radius: 8px; gap: 6px; margin-top: 9px; align-self: flex-start; }
            .va-ad-back {
                background: none; border: none; color: #7dd3fc; cursor: pointer; font-weight: 700;
                font-size: 0.82rem; padding: 0; margin-bottom: 8px; display: inline-flex; gap: 6px; align-items: center;
            }

            /* ---- Fleet-style partner detail ---- */
            .va-detail-head { display: flex; align-items: center; gap: 14px; margin-top: 14px; min-width: 0; }
            .va-detail-head .va-ad-logo { width: 52px; height: 52px; max-width: 52px; max-height: 52px; border-radius: 12px; }
            .va-detail-titles { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 4px; }
            .va-detail-titles h3 { margin: 0; color: #fff; font-size: 1.25rem; font-weight: 800; letter-spacing: -0.3px; }
            .va-detail-subrow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
            .va-code-chip {
                font-family: 'JetBrains Mono', ui-monospace, monospace;
                font-size: 0.68rem; font-weight: 800; letter-spacing: 0.6px;
                padding: 3px 9px; border-radius: 7px;
                background: rgba(168, 85, 247, 0.22); color: #d8b4fe;
                border: 1px solid rgba(168, 85, 247, 0.45);
                text-transform: uppercase;
            }
            .va-stat-row {
                display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
                gap: 8px; margin-top: 14px;
            }
            .va-stat-tile {
                display: flex; flex-direction: column; gap: 4px;
                padding: 11px 12px; border-radius: 12px;
                background: rgba(0, 0, 0, 0.35); border: 1px solid rgba(255, 255, 255, 0.08);
                min-width: 0;
            }
            .va-stat-tile label {
                font-size: 0.58rem; font-weight: 800; letter-spacing: 0.9px;
                text-transform: uppercase; color: rgba(255,255,255,0.45);
            }
            .va-stat-tile span {
                font-size: 0.88rem; font-weight: 700; color: #fff;
                display: flex; align-items: center; gap: 7px;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .va-stat-tile span i { color: #7dd3fc; font-size: 0.8rem; flex-shrink: 0; }
            .va-stat-tile .va-stat-live { color: #4ade80; }

            .va-fleet-title {
                display: flex; align-items: baseline; gap: 9px; margin: 22px 0 10px;
            }
            .va-fleet-title h4 { margin: 0; color: #fff; font-size: 1.02rem; font-weight: 800; }
            .va-fleet-title .va-fleet-count {
                font-family: 'JetBrains Mono', ui-monospace, monospace;
                font-size: 0.72rem; font-weight: 700; color: #4ade80;
            }
            .va-fleet-grid {
                display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
                gap: 12px;
            }
            .va-fleet-card {
                border-radius: 14px; overflow: hidden; cursor: pointer;
                background: rgba(0, 0, 0, 0.35); border: 1px solid rgba(255, 255, 255, 0.08);
                transition: border-color .15s ease, transform .15s ease;
            }
            .va-fleet-card:hover { border-color: rgba(56,189,248,0.45); transform: translateY(-2px); }
            .va-fleet-img {
                position: relative; aspect-ratio: 16 / 8.4;
                background-color: #0c0e12; background-size: cover; background-position: center;
            }
            .va-fleet-img::after {
                content: ''; position: absolute; inset: 0; pointer-events: none;
                background: linear-gradient(to bottom, rgba(12,14,18,0) 55%, rgba(12,14,18,0.78) 100%);
            }
            .va-fleet-chip {
                position: absolute; z-index: 1;
                font-family: 'JetBrains Mono', ui-monospace, monospace;
                font-size: 0.62rem; font-weight: 700; letter-spacing: 0.5px;
                padding: 3px 8px; border-radius: 999px;
                background: rgba(0, 0, 0, 0.6); color: #e8eaed;
                border: 1px solid rgba(255, 255, 255, 0.14);
                backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px);
                max-width: calc(100% - 18px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                box-sizing: border-box;
            }
            .va-fleet-callsign { top: 9px; left: 9px; }
            .va-fleet-route { bottom: 9px; right: 9px; }
            .va-fleet-route .va-fleet-arrow { color: #7dd3fc; }
            .va-fleet-stats {
                display: grid; grid-template-columns: 1.3fr 1fr;
                gap: 1px; background: rgba(255,255,255,0.06);
            }
            .va-fleet-stat {
                display: flex; flex-direction: column; gap: 3px;
                padding: 9px 12px; background: #101216; min-width: 0;
            }
            .va-fleet-stat label {
                font-size: 0.54rem; font-weight: 800; letter-spacing: 0.8px;
                text-transform: uppercase; color: rgba(255,255,255,0.42);
            }
            .va-fleet-stat span {
                font-size: 0.76rem; font-weight: 700; color: #fff;
                display: flex; align-items: center; gap: 6px;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .va-fleet-stat span i { color: #7dd3fc; font-size: 0.68rem; flex-shrink: 0; }
            .va-fleet-empty {
                border: 1px dashed rgba(255,255,255,0.14); border-radius: 14px;
                padding: 26px 14px; text-align: center; color: rgba(255,255,255,0.5);
                font-size: 0.84rem;
            }
            .va-fleet-empty i { display: block; font-size: 1.3rem; margin-bottom: 8px; color: rgba(255,255,255,0.3); }
            .va-ad-pill.va-ad-pill-live {
                background: rgba(56,189,248,0.14); color: #7dd3fc; border-color: rgba(56,189,248,0.4);
            }

            /* ---- Events calendar ---- */
            .va-cal {
                border: 1px solid rgba(255,255,255,0.08); border-radius: 14px;
                background: rgba(0,0,0,0.35); padding: 12px; margin-top: 2px;
            }
            .va-cal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
            .va-cal-month { font-weight: 800; color: #fff; font-size: 0.92rem; letter-spacing: -0.2px; }
            .va-cal-nav {
                background: rgba(255,255,255,0.06); border: none; color: #cbd5e1; cursor: pointer;
                width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; font-size: 0.72rem;
            }
            .va-cal-nav:hover { background: rgba(56,189,248,0.2); color: #7dd3fc; }
            .va-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
            .va-cal-dow { margin-bottom: 4px; }
            .va-cal-dowcell {
                text-align: center; font-size: 0.56rem; font-weight: 800; letter-spacing: 0.5px;
                text-transform: uppercase; color: rgba(255,255,255,0.4); padding: 2px 0;
            }
            .va-cal-cell {
                position: relative; aspect-ratio: 1 / 1; border-radius: 8px;
                display: flex; align-items: center; justify-content: center;
                font-size: 0.72rem; color: rgba(255,255,255,0.5);
            }
            .va-cal-empty { visibility: hidden; }
            .va-cal-has {
                cursor: pointer; color: #fff; font-weight: 700;
                background: rgba(56,189,248,0.14); border: 1px solid rgba(56,189,248,0.35);
            }
            .va-cal-has:hover { background: rgba(56,189,248,0.28); }
            .va-cal-today { box-shadow: inset 0 0 0 1px rgba(255,255,255,0.4); }
            .va-cal-selected { background: #7dd3fc !important; color: #05202b !important; border-color: #7dd3fc !important; }
            .va-cal-selected .va-cal-dot { background: #05202b; }
            .va-cal-dot {
                position: absolute; bottom: 4px; left: 50%; transform: translateX(-50%);
                width: 4px; height: 4px; border-radius: 50%; background: #7dd3fc;
            }
            .va-cal-clear { margin: 12px 0 0; }

            .va-events-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
            .va-events-empty {
                color: rgba(255,255,255,0.5); font-size: 0.84rem; text-align: center;
                padding: 20px 10px; border: 1px dashed rgba(255,255,255,0.14); border-radius: 12px;
            }
            .va-events-empty i { margin-right: 6px; color: rgba(255,255,255,0.35); }
            .va-event-row {
                border-radius: 12px; overflow: hidden;
                background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.08);
            }
            /* Animated WebP animates natively as an <img>; a 16:6 event banner
               strip sits above the row body. Placeholder colour shows while it
               loads and stays if the image errors (the <img> hides itself). */
            .va-event-banner {
                display: block; width: 100%; aspect-ratio: 16 / 6; object-fit: cover;
                background: #0e1420; border-bottom: 1px solid rgba(255,255,255,0.06);
            }
            .va-event-body { display: flex; gap: 12px; padding: 10px 12px; }
            .va-event-dep { margin-left: 10px; }
            .va-event-date {
                flex: 0 0 auto; width: 44px; display: flex; flex-direction: column;
                align-items: center; justify-content: center; border-radius: 9px;
                background: rgba(56,189,248,0.12); border: 1px solid rgba(56,189,248,0.3);
            }
            .va-event-mon { font-size: 0.54rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.6px; color: #7dd3fc; }
            .va-event-day { font-size: 1.05rem; font-weight: 800; color: #fff; line-height: 1.15; }
            .va-event-main { min-width: 0; flex: 1; }
            .va-event-title { font-size: 0.88rem; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
            .va-event-link { color: #7dd3fc; text-decoration: none; font-size: 0.75rem; }
            .va-event-link:hover { color: #bae6fd; }

            /* "Watch live" — shown on an event once its group flight is up. */
            .va-event-watch {
                margin-left: 10px; display: inline-flex; align-items: center; gap: 5px;
                padding: 2px 8px; border-radius: 999px; cursor: pointer;
                background: rgba(52,211,153,0.16); border: 1px solid rgba(52,211,153,0.32);
                color: #6ee7b7; font-size: 0.68rem; font-weight: 800;
            }
            .va-event-watch:hover { background: rgba(52,211,153,0.26); color: #a7f3d0; }

            /* Group-flight composer — only rendered for the VA's own owner. */
            .va-group-box {
                margin: 10px 0 4px; padding: 12px; border-radius: 12px;
                background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.09);
            }
            .va-group-head {
                display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
                font-size: 0.82rem; font-weight: 800; color: #e2e8f0;
            }
            .va-group-head i { color: #38bdf8; }
            .va-group-owner {
                margin-left: auto; font-size: 0.65rem; font-weight: 700; text-transform: uppercase;
                letter-spacing: 0.04em; color: rgba(255,255,255,0.42);
            }
            .va-group-hint { margin: 0 0 10px; font-size: 0.72rem; color: rgba(255,255,255,0.55); }
            .va-group-picks {
                display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
                gap: 4px; max-height: 168px; overflow-y: auto; margin-bottom: 10px;
            }
            .va-group-pick {
                display: flex; align-items: center; gap: 7px; padding: 5px 7px;
                border-radius: 8px; cursor: pointer; font-size: 0.72rem;
                background: rgba(255,255,255,0.03);
            }
            .va-group-pick:hover { background: rgba(255,255,255,0.08); }
            .va-group-cs { font-weight: 700; color: #e2e8f0; }
            .va-group-rt { color: rgba(255,255,255,0.45); margin-left: auto; white-space: nowrap; }
            .va-group-title, .va-group-event, .va-group-result input {
                width: 100%; box-sizing: border-box; padding: 7px 10px; margin-bottom: 8px;
                border-radius: 9px; border: 1px solid rgba(255,255,255,0.12);
                background: rgba(0,0,0,0.28); color: #e2e8f0; font-size: 0.78rem;
                font-family: inherit;
            }
            .va-group-go {
                width: 100%; padding: 8px; border-radius: 9px; border: 0; cursor: pointer;
                background: #0284c7; color: #fff; font-size: 0.78rem; font-weight: 800;
                display: inline-flex; align-items: center; justify-content: center; gap: 7px;
            }
            .va-group-go:hover:not(:disabled) { background: #0369a1; }
            .va-group-go:disabled { opacity: 0.55; cursor: default; }
            .va-group-msg { margin: 8px 0 0; font-size: 0.72rem; color: rgba(255,255,255,0.62); min-height: 1em; }
            .va-group-result { display: flex; gap: 6px; margin-top: 8px; }
            .va-group-result input { margin: 0; }
            .va-group-copy {
                flex-shrink: 0; padding: 0 12px; border-radius: 9px; border: 0; cursor: pointer;
                background: rgba(255,255,255,0.12); color: #e2e8f0; font-size: 0.72rem; font-weight: 700;
            }
            .va-group-copy:hover { background: rgba(255,255,255,0.2); }
            /* The claim prompt is deliberately quieter than the composer —
               most signed-in pilots don't run a VA and shouldn't be nagged. */
            .va-group-box.is-claim { background: rgba(255,255,255,0.02); }
            .va-group-claim {
                padding: 6px 12px; border-radius: 9px; cursor: pointer;
                background: rgba(255,255,255,0.10); border: 1px solid rgba(255,255,255,0.14);
                color: #e2e8f0; font-size: 0.72rem; font-weight: 700;
                display: inline-flex; align-items: center; gap: 6px;
            }
            .va-group-claim:hover:not(:disabled) { background: rgba(255,255,255,0.18); }
            .va-group-claim:disabled { opacity: 0.55; cursor: default; }

            @media (max-width: 768px) {
                /* iOS Safari zooms the whole page when a focused input's text is
                   under 16px. The composer is used one-handed on a phone mid-
                   event, so these have to be 16px or the map lurches on tap. */
                .va-group-title, .va-group-event, .va-group-result input { font-size: 16px; padding: 10px 12px; }
                /* Comfortable tap targets: one aircraft per row, taller rows,
                   a full-width publish button and a bigger watch chip. */
                .va-group-picks { grid-template-columns: 1fr; max-height: 200px; }
                .va-group-pick { padding: 10px 10px; font-size: 0.8rem; }
                .va-group-go { padding: 12px; font-size: 0.85rem; }
                .va-group-claim { padding: 10px 14px; font-size: 0.8rem; }
                .va-group-copy { padding: 0 16px; }
                .va-event-watch { padding: 5px 11px; font-size: 0.72rem; margin-left: 8px; }
            }
            .va-event-when { font-size: 0.72rem; color: rgba(255,255,255,0.6); margin-top: 3px; }
            .va-event-when i { color: #7dd3fc; margin-right: 5px; }
            .va-event-desc { font-size: 0.78rem; color: rgba(255,255,255,0.72); margin-top: 5px; line-height: 1.5; white-space: pre-wrap; }

            /* At-a-glance "Next up" card above the calendar */
            .va-next-up {
                width: 100%; box-sizing: border-box; text-align: left; cursor: pointer;
                display: flex; flex-direction: column; gap: 3px; padding: 11px 14px; margin: 2px 0 10px;
                border-radius: 12px; color: #fff;
                background: linear-gradient(135deg, rgba(56,189,248,0.16), rgba(56,189,248,0.04));
                border: 1px solid rgba(56,189,248,0.35);
                transition: border-color .15s ease, transform .15s ease;
            }
            .va-next-up:hover { border-color: rgba(56,189,248,0.6); transform: translateY(-1px); }
            .va-next-up.is-live {
                background: linear-gradient(135deg, rgba(74,222,128,0.18), rgba(74,222,128,0.04));
                border-color: rgba(74,222,128,0.45);
            }
            .va-next-up-eyebrow {
                font-size: 0.58rem; font-weight: 800; letter-spacing: 0.9px; text-transform: uppercase;
                color: #7dd3fc; display: inline-flex; align-items: center; gap: 6px;
            }
            .va-next-up.is-live .va-next-up-eyebrow { color: #4ade80; }
            .va-next-up-title { font-size: 0.95rem; font-weight: 800; color: #fff; }
            .va-next-up-when { font-size: 0.72rem; color: rgba(255,255,255,0.7); }

            /* Pulsing "live" dot, shared by the next-up card, event pills and legend */
            .va-live-dot {
                width: 7px; height: 7px; border-radius: 50%; background: #4ade80; flex: 0 0 auto;
                box-shadow: 0 0 0 0 rgba(74,222,128,0.55); animation: va-live-pulse 1.8s infinite;
            }
            @keyframes va-live-pulse {
                0%   { box-shadow: 0 0 0 0 rgba(74,222,128,0.55); }
                70%  { box-shadow: 0 0 0 7px rgba(74,222,128,0); }
                100% { box-shadow: 0 0 0 0 rgba(74,222,128,0); }
            }

            /* Per-event status pill: countdown, or a green "Happening now" */
            .va-event-status {
                margin-left: auto; display: inline-flex; align-items: center; gap: 5px;
                font-size: 0.6rem; font-weight: 800; letter-spacing: 0.4px; text-transform: uppercase;
                padding: 3px 8px; border-radius: 999px; white-space: nowrap;
                background: rgba(56,189,248,0.14); color: #7dd3fc; border: 1px solid rgba(56,189,248,0.3);
            }
            .va-event-status.va-event-live { background: rgba(74,222,128,0.16); color: #4ade80; border-color: rgba(74,222,128,0.4); }
            .va-event-row.is-live { border-color: rgba(74,222,128,0.4); }

            /* Calendar day holding a live event */
            .va-cal-live { background: rgba(74,222,128,0.16) !important; border: 1px solid rgba(74,222,128,0.45) !important; color: #fff; }
            .va-cal-live .va-cal-dot { background: #4ade80; }

            /* ---- Pilot roster ---- */
            .va-roster-search { margin: 2px 0 10px; }
            .va-roster-search input {
                width: 100%; box-sizing: border-box; padding: 8px 11px; border-radius: 10px;
                background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.12); color: #fff; font-size: 0.82rem;
            }
            .va-roster-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px; }
            .va-roster-list .va-events-empty { grid-column: 1 / -1; }
            .va-roster-row {
                display: flex; align-items: center; gap: 9px; padding: 8px 10px; border-radius: 10px;
                background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.07); min-width: 0;
            }
            .va-roster-avatar {
                flex: 0 0 auto; width: 26px; height: 26px; border-radius: 50%;
                display: grid; place-items: center; font-size: 0.72rem; font-weight: 800; color: #05202b;
                background: linear-gradient(135deg, #7dd3fc, #38bdf8);
            }
            .va-roster-name { font-size: 0.82rem; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
            .va-roster-since { font-size: 0.62rem; color: rgba(255,255,255,0.45); white-space: nowrap; flex: 0 0 auto; }`;
        document.head.appendChild(style);
    }

    // ---------------------------------------------------------------------
    // Live fleet (partner aircraft currently in the air)
    // ---------------------------------------------------------------------

    const AC_LOOKUP_URL = 'https://site--indgo-backend--6dmjph8ltlhv.code.run/api/aircraft/lookup';
    const GENERIC_PLANE_IMG = '/CommunityPlanes/default.png';
    const acImageCache = new Map();

    // Community photo for a type+livery; falls back to the type's Generic
    // livery, then the bundled default plane art. Cached per combination.
    async function aircraftImage(type, livery) {
        const key = `${type || ''}|${livery || ''}`;
        if (acImageCache.has(key)) return acImageCache.get(key);
        const promise = (async () => {
            const liveries = [livery, 'Generic'].filter(Boolean);
            for (const liv of liveries) {
                if (!type) break;
                try {
                    let data = await getJSON(`${AC_LOOKUP_URL}?type=${encodeURIComponent(type)}&livery=${encodeURIComponent(liv)}`);
                    if (Array.isArray(data)) data = data[0];
                    const url = String((data && (data.imageUrl || (Array.isArray(data.imageUrls) && data.imageUrls[0]))) || '').trim();
                    // https or same-origin paths only — never javascript: etc.
                    if (/^https:\/\//i.test(url) || /^\//.test(url)) return url;
                } catch (e) { /* try the next livery */ }
            }
            return GENERIC_PLANE_IMG;
        })();
        acImageCache.set(key, promise);
        return promise;
    }

    function parseMaybeJSON(v) {
        if (typeof v !== 'string') return v || null;
        try { return JSON.parse(v); } catch (e) { return null; }
    }

    // All live flights on the map (flight.js exposes a read-only getter).
    function liveFeatures() {
        try {
            const feats = typeof window.getLiveMapFeatures === 'function' ? window.getLiveMapFeatures() : null;
            return feats && typeof feats === 'object' ? Object.values(feats) : [];
        } catch (e) { return []; }
    }

    // The VA's aircraft currently in the air, newest-ish first, capped.
    // Members only, embed-style: the callsign must both match the VA's airline
    // name AND carry the VA's membership tag ("Indonesia 77GG" counts for a
    // GG-tagged VA, a plain "Indonesia 77" does not).
    function liveFleetFor(ad, cap) {
        const out = [];
        for (const f of liveFeatures()) {
            const props = f && f.properties;
            if (!props || !props.callsign) continue;
            const hit = matchCallsign(props.callsign);
            if (!hit || String(hit.id) !== String(ad.id)) continue;
            if (!isCallsignMember(props.callsign, hit)) continue;
            const acData = parseMaybeJSON(props.aircraft) || {};
            const pos = parseMaybeJSON(props.position) || {};
            out.push({
                props,
                callsign: props.callsign,
                username: props.username || '',
                type: acData.aircraftName || props.aircraftName || '',
                livery: acData.liveryName || props.liveryName || '',
                registration: acData.registration || props.registration || '',
                dep: props.departureIcao || '???',
                arr: props.arrivalIcao || '???',
                altFt: Math.round(pos.alt_ft || 0),
                gsKt: Math.round(pos.gs_kt || 0)
            });
            if (out.length >= (cap || 24)) break;
        }
        return out;
    }

    // adId -> number of its aircraft in the air, for the list-view badges.
    // Same members-only rule as liveFleetFor so the badge and the fleet agree.
    function liveCountsByAd() {
        const counts = new Map();
        for (const f of liveFeatures()) {
            const cs = f && f.properties && f.properties.callsign;
            if (!cs) continue;
            const hit = matchCallsign(cs);
            if (!hit || !isCallsignMember(cs, hit)) continue;
            const k = String(hit.id);
            counts.set(k, (counts.get(k) || 0) + 1);
        }
        return counts;
    }

    // Opens a live flight on the map (same entry point the map markers use)
    // and closes the partners panel.
    function openFleetFlight(entry) {
        const fn = window.handleAircraftClick;
        if (typeof fn !== 'function') return;
        closePartners();
        const props = entry.props;
        try {
            fn({
                ...props,
                position: parseMaybeJSON(props.position) || props.position,
                aircraft: parseMaybeJSON(props.aircraft) || props.aircraft
            });
        } catch (e) { /* the map handler owns its own errors */ }
    }

    // ---------------------------------------------------------------------
    // Airport-window banner
    // ---------------------------------------------------------------------

    // Inner markup of one feature card (banner image + logo + meta), styled
    // like the Partners-tab cards rather than the old single-line strip.
    function featureCardInner(ad) {
        const logo = ad.logo
            ? `<img class="va-ad-logo" src="${esc(ad.logo)}" alt="" onerror="this.style.display='none'">`
            : `<div class="va-ad-logo"><i class="fa-solid fa-building"></i></div>`;
        const pills = [];
        if (ad.featured) pills.push('<span class="va-ad-pill va-ad-pill-featured">Featured</span>');
        if (ad.recruiting) pills.push('<span class="va-ad-pill">Recruiting</span>');
        const chips = (ad.tags || []).slice(0, 3).map((tg) => `<span class="va-ad-chip">${esc(tg)}</span>`).join('');
        return `
            ${bannerImgHTML(ad.banner, 'va-ad-feature-banner', ad.name)}
            <div class="va-ad-feature-body">
                ${logo}
                <div class="va-ad-feature-meta">
                    <div class="va-ad-eyebrow"><i class="fa-solid fa-handshake-angle"></i> VA Partner ${pills.join(' ')}</div>
                    <div class="va-ad-name">${esc(ad.name)}</div>
                    ${ad.tagline ? `<div class="va-ad-tag">${esc(ad.tagline)}</div>` : ''}
                    ${chips ? `<div class="va-ad-chips">${chips}</div>` : ''}
                    ${ad.website ? `<a class="va-ad-apply sm" data-va-link="apply" data-va-ad-id="${esc(ad.id)}" href="${esc(ad.website)}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-paper-plane"></i> Apply now</a>` : ''}
                </div>
                <i class="fa-solid fa-chevron-right" style="color:rgba(255,255,255,0.4); align-self:center;"></i>
            </div>`;
    }

    // Render a (possibly rotating) feature card into a slot. When several VAs
    // share the slot we never stack them all at once — we show one card and
    // quietly cycle through them so each partner gets fair exposure. The
    // rotation timer is stored per-slot so independent slots (e.g. an airport
    // window and a flight window open at once) never clobber each other.
    function renderAdFeature(slot, ads) {
        if (!slot) return;
        if (slot._adRotateTimer) { clearInterval(slot._adRotateTimer); slot._adRotateTimer = null; }
        if (!ads || !ads.length) { slot.innerHTML = ''; slot.style.display = 'none'; return; }
        slot.style.display = '';

        slot.innerHTML = `
            <div class="va-ad-feature" data-va-ad-id="${esc(ads[0].id)}" role="button" tabindex="0">
                <div class="va-ad-feature-card"></div>
                ${ads.length > 1 ? '<div class="va-ad-dots"></div>' : ''}
            </div>`;
        const featureEl = slot.querySelector('.va-ad-feature');
        const cardEl = slot.querySelector('.va-ad-feature-card');
        const dotsEl = slot.querySelector('.va-ad-dots');

        let idx = 0;
        const render = () => {
            const ad = ads[idx];
            featureEl.setAttribute('data-va-ad-id', ad.id);
            // The card is on screen now — that's an impression for this partner.
            // Rotating back to it later won't count twice (deduped per session).
            track(ad.id, 'impression');
            cardEl.innerHTML = featureCardInner(ad);
            if (dotsEl) {
                dotsEl.innerHTML = ads
                    .map((_, i) => `<span class="va-ad-dot${i === idx ? ' is-active' : ''}"></span>`)
                    .join('');
            }
        };
        render();

        featureEl.addEventListener('click', (e) => {
            if (e.target.closest('.va-ad-apply')) return; // CTA navigates to the VA site
            track(featureEl.getAttribute('data-va-ad-id'), 'click');
            openPartners(featureEl.getAttribute('data-va-ad-id'));
        });

        if (ads.length > 1) {
            slot._adRotateTimer = setInterval(() => {
                // Stop once the host window (and this slot) is gone.
                if (!document.body.contains(cardEl)) {
                    clearInterval(slot._adRotateTimer);
                    slot._adRotateTimer = null;
                    return;
                }
                cardEl.style.opacity = '0';
                setTimeout(() => {
                    idx = (idx + 1) % ads.length;
                    render();
                    cardEl.style.opacity = '1';
                }, 220);
            }, 6000);
        }
    }

    // Render the full, uncropped banner artwork for one (or several rotating)
    // VAs into a slot. Unlike renderAdFeature this shows just the banner image
    // at its natural aspect ratio — nothing is clipped — and clicking it opens
    // that partner. Ads without a banner image are skipped; the slot hides
    // entirely when none of them have one. The rotation timer is stored per-slot
    // so independent slots never clobber each other.
    function renderFullBanner(slot, ads) {
        if (!slot) return;
        if (slot._adRotateTimer) { clearInterval(slot._adRotateTimer); slot._adRotateTimer = null; }
        const withBanner = (ads || []).filter((ad) => ad && ad.banner);
        if (!withBanner.length) { slot.innerHTML = ''; slot.style.display = 'none'; return; }
        slot.style.display = '';

        slot.innerHTML = `
            <div class="va-ad-full" data-va-ad-id="${esc(withBanner[0].id)}" role="button" tabindex="0">
                <img class="va-ad-full-img" src="" alt="">
                ${withBanner.length > 1 ? '<div class="va-ad-dots"></div>' : ''}
            </div>`;
        const fullEl = slot.querySelector('.va-ad-full');
        const imgEl = slot.querySelector('.va-ad-full-img');
        const dotsEl = slot.querySelector('.va-ad-dots');

        let idx = 0;
        const render = () => {
            const ad = withBanner[idx];
            fullEl.setAttribute('data-va-ad-id', ad.id);
            fullEl.setAttribute('title', `View ${ad.name}`);
            track(ad.id, 'impression');
            imgEl.src = ad.banner;
            imgEl.alt = `${ad.name} banner`;
            if (dotsEl) {
                dotsEl.innerHTML = withBanner
                    .map((_, i) => `<span class="va-ad-dot${i === idx ? ' is-active' : ''}"></span>`)
                    .join('');
            }
        };
        render();

        // A broken banner URL collapses the slot rather than leaving a gap.
        imgEl.addEventListener('error', () => {
            if (slot._adRotateTimer) { clearInterval(slot._adRotateTimer); slot._adRotateTimer = null; }
            slot.innerHTML = '';
            slot.style.display = 'none';
        });

        fullEl.addEventListener('click', () => {
            track(fullEl.getAttribute('data-va-ad-id'), 'click');
            openPartners(fullEl.getAttribute('data-va-ad-id'));
        });

        if (withBanner.length > 1) {
            slot._adRotateTimer = setInterval(() => {
                if (!document.body.contains(imgEl)) {
                    clearInterval(slot._adRotateTimer);
                    slot._adRotateTimer = null;
                    return;
                }
                imgEl.style.opacity = '0';
                setTimeout(() => {
                    idx = (idx + 1) % withBanner.length;
                    render();
                    imgEl.style.opacity = '1';
                }, 220);
            }, 6000);
        }
    }

    async function hydrateAirportBanner(container, icao) {
        injectStyles();
        const root = container || document;
        const slot = root.querySelector ? root.querySelector('#apt-va-banner') : null;
        if (!slot) return;
        try {
            const ads = await banner(icao, { limit: 8 });
            renderAdFeature(slot, ads);
        } catch (e) {
            // A missing/unreachable ads service must never break the airport panel.
            slot.innerHTML = '';
            slot.style.display = 'none';
        }
    }

    // Flight info window ad: prefer the flight's OWN partner VA (matched by
    // callsign), and when the callsign isn't a partner fall back to the
    // partner VAs hubbed at the arrival, then departure airport so the slot is
    // rarely empty. Renders into a '#ac-va-banner' slot inside the container.
    async function hydrateFlightBanner(container, opts) {
        injectStyles();
        const root = container || document;
        const slot = root.querySelector ? root.querySelector('#ac-va-banner') : null;
        const fullSlot = root.querySelector ? root.querySelector('#ac-va-full-banner') : null;
        if (!slot && !fullSlot) return;
        const o = opts || {};
        try {
            await loadDirectory();
            let ads = [];
            const own = matchCallsign(o.callsign);
            if (own) {
                ads = [own];
            } else {
                const codes = [o.arrIcao, o.depIcao]
                    .map((c) => String(c || '').trim().toUpperCase())
                    .filter(Boolean);
                for (const code of codes) {
                    const hub = await banner(code, { limit: 6 });
                    if (hub && hub.length) { ads = hub; break; }
                }
            }
            renderAdFeature(slot, ads);
            renderFullBanner(fullSlot, ads);
        } catch (e) {
            // The ads service must never break the flight window.
            if (slot) { slot.innerHTML = ''; slot.style.display = 'none'; }
            if (fullSlot) { fullSlot.innerHTML = ''; fullSlot.style.display = 'none'; }
        }
    }

    // ---------------------------------------------------------------------
    // Partners slide-over
    // ---------------------------------------------------------------------

    let overlayEl = null;

    function ensureOverlay() {
        if (overlayEl) return overlayEl;
        injectStyles();
        overlayEl = document.createElement('div');
        overlayEl.className = 'va-partners-overlay';
        overlayEl.innerHTML = `
            <div class="va-partners-panel" role="dialog" aria-label="VA Partners">
                <div class="va-partners-grip"></div>
                <div class="va-partners-head">
                    <div class="va-partners-titles">
                        <span class="va-partners-eyebrow">Network</span>
                        <h2>VA Partners</h2>
                    </div>
                    <button class="va-partners-close" title="Close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="va-partners-search">
                    <input type="text" placeholder="Search partners by name, region, tag…" autocomplete="off">
                </div>
                <div class="va-partners-body"></div>
            </div>`;
        document.body.appendChild(overlayEl);

        overlayEl.addEventListener('click', (e) => {
            if (e.target === overlayEl) closePartners();
        });
        overlayEl.querySelector('.va-partners-close').addEventListener('click', closePartners);

        const input = overlayEl.querySelector('.va-partners-search input');
        let t = 0;
        input.addEventListener('input', () => {
            clearTimeout(t);
            t = setTimeout(() => loadPartnersList(input.value.trim()), 280);
        });

        attachSheetSwipe();
        return overlayEl;
    }

    // Swipe the grip/header down to dismiss the bottom sheet on mobile, matching
    // the other iOS tabs. No-op on desktop (where the panel is a side slide-over).
    function attachSheetSwipe() {
        const panel = overlayEl.querySelector('.va-partners-panel');
        const handles = overlayEl.querySelectorAll('.va-partners-grip, .va-partners-head');
        if (!panel || !handles.length) return;
        const isMobile = () => window.matchMedia('(max-width: 768px)').matches;
        let startY = 0, dy = 0, dragging = false;
        const onStart = (e) => {
            if (!isMobile()) return;
            dragging = true; dy = 0;
            startY = e.touches ? e.touches[0].clientY : e.clientY;
            panel.style.transition = 'none';
        };
        const onMove = (e) => {
            if (!dragging) return;
            const y = e.touches ? e.touches[0].clientY : e.clientY;
            dy = Math.max(0, y - startY);
            panel.style.transform = `translateY(${dy}px)`;
        };
        const onEnd = () => {
            if (!dragging) return;
            dragging = false;
            panel.style.transition = '';
            panel.style.transform = '';
            if (dy > 90) closePartners();
        };
        handles.forEach((h) => {
            h.addEventListener('touchstart', onStart, { passive: true });
            h.addEventListener('touchmove', onMove, { passive: true });
            h.addEventListener('touchend', onEnd);
        });
    }

    function cardHTML(ad, liveCount) {
        const logo = ad.logo
            ? `<img class="va-ad-logo" src="${esc(ad.logo)}" alt="" onerror="this.style.display='none'">`
            : `<div class="va-ad-logo"><i class="fa-solid fa-building"></i></div>`;
        const pills = [];
        if (liveCount > 0) pills.push(`<span class="va-ad-pill va-ad-pill-live"><i class="fa-solid fa-plane" style="font-size:0.55rem"></i> ${liveCount} live</span>`);
        if (ad.featured) pills.push('<span class="va-ad-pill va-ad-pill-featured">Featured</span>');
        if (ad.recruiting) pills.push('<span class="va-ad-pill">Recruiting</span>');
        const sub = [ad.type, ad.region].filter(Boolean).join(' · ');
        const chips = (ad.tags || []).slice(0, 4).map((tg) => `<span class="va-ad-chip">${esc(tg)}</span>`).join('');
        return `
            <div class="va-ad-card" data-va-ad-id="${esc(ad.id)}" role="button" tabindex="0">
                ${bannerImgHTML(ad.banner, 'va-ad-card-banner', ad.name)}
                ${favButtonHTML(ad.id)}
                <div class="va-ad-card-body">
                    ${logo}
                    <div style="min-width:0; flex:1;">
                        <div class="va-ad-card-title">${esc(ad.name)} ${pills.join(' ')}</div>
                        ${sub ? `<div class="va-ad-card-sub">${esc(sub)}</div>` : ''}
                        ${ad.tagline ? `<div class="va-ad-card-sub">${esc(ad.tagline)}</div>` : ''}
                        ${chips ? `<div class="va-ad-chips">${chips}</div>` : ''}
                        <div class="va-ad-card-actions">
                            ${crewButtonHTML(ad, 'va-ad-crew sm')}
                            ${ad.website ? `<a class="va-ad-apply sm" data-va-link="apply" data-va-ad-id="${esc(ad.id)}" href="${esc(ad.website)}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-paper-plane"></i> Apply now</a>` : ''}
                        </div>
                    </div>
                </div>
            </div>`;
    }

    // ---------------------------------------------------------------------
    // Favourites
    //
    // Pinning a VA is how a pilot keeps their own crew center within reach:
    // favourites sort to the top of the Partners list so the one they actually
    // sign in to isn't buried behind whoever happens to be busiest right now.
    //
    // Deliberately localStorage-only and anonymous. Crew Center access must not
    // require an account with us, so favouriting can't either — a VA pilot who
    // has never signed in here still gets the shortcut.
    // ---------------------------------------------------------------------

    const FAV_KEY = 'inflight_va_favorites';

    function favIds() {
        try {
            const raw = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
            return Array.isArray(raw) ? raw.map(String).filter(Boolean) : [];
        } catch (_) { return []; }
    }

    function isFav(id) { return favIds().includes(String(id)); }

    function toggleFav(id) {
        const key = String(id);
        if (!key) return false;
        const cur = favIds();
        const at = cur.indexOf(key);
        if (at >= 0) cur.splice(at, 1); else cur.push(key);
        try { localStorage.setItem(FAV_KEY, JSON.stringify(cur.slice(0, 200))); } catch (_) {}
        return at < 0; // true when it just became a favourite
    }

    function favButtonHTML(id) {
        const on = isFav(id);
        return `<button type="button" class="va-fav-btn${on ? ' is-on' : ''}" data-va-fav="${esc(id)}"
                        aria-pressed="${on}" title="${on ? 'Remove from favourites' : 'Save to favourites'}"
                        aria-label="${on ? 'Remove from favourites' : 'Save to favourites'}">
                    <i class="fa-${on ? 'solid' : 'regular'} fa-star"></i>
                </button>`;
    }

    // Delegated so it covers both the list cards and the detail panel, and
    // survives re-renders.
    function bindFavButtons(root) {
        root.querySelectorAll('[data-va-fav]').forEach((btn) => {
            if (btn.dataset.favWired) return;
            btn.dataset.favWired = '1';
            btn.addEventListener('click', (e) => {
                // Never let the star bubble into the card's open-detail handler.
                e.preventDefault();
                e.stopPropagation();
                const nowOn = toggleFav(btn.getAttribute('data-va-fav'));
                btn.classList.toggle('is-on', nowOn);
                btn.setAttribute('aria-pressed', String(nowOn));
                const label = nowOn ? 'Remove from favourites' : 'Save to favourites';
                btn.title = label;
                btn.setAttribute('aria-label', label);
                const icon = btn.querySelector('i');
                if (icon) icon.className = `fa-${nowOn ? 'solid' : 'regular'} fa-star`;
            });
        });
    }

    /**
     * "Crew Center" CTA — the sign-in door for a VA's own portal.
     *
     * Only rendered when the VA actually has a crew center configured; we never
     * synthesise a slug from the callsign, because a VA with a custom slug would
     * get a dead link. No account with us is required to use it.
     */
    function crewButtonHTML(ad, cls) {
        if (!ad || !ad.slug) return '';
        return `<a class="${cls}" data-va-link="crew" data-va-crew="${esc(ad.slug)}"
                   data-va-ad-id="${esc(ad.id)}" href="/crew/${encodeURIComponent(ad.slug)}"
                   rel="noopener"><i class="fa-solid fa-right-to-bracket"></i> Crew Center</a>`;
    }

    // Inside the app the crew center opens as an overlay over the map; on the
    // landing/embed surfaces (where the overlay module isn't loaded) the anchor's
    // own href takes over, so the link works either way.
    function bindCrewButtons(root) {
        root.querySelectorAll('[data-va-crew]').forEach((el) => {
            if (el.dataset.crewWired) return;
            el.dataset.crewWired = '1';
            el.addEventListener('click', (e) => {
                e.stopPropagation(); // don't also open the detail panel
                const slug = el.getAttribute('data-va-crew');
                const overlay = window.CrewCenterOverlay;
                if (slug && overlay && typeof overlay.open === 'function' && overlay.open(slug)) {
                    e.preventDefault();
                    track(el.getAttribute('data-va-ad-id'), 'click');
                }
            });
        });
    }

    function bindCards(body) {
        bindFavButtons(body);
        bindCrewButtons(body);
        body.querySelectorAll('.va-ad-card[data-va-ad-id]').forEach((el) => {
            // The card is listed in the panel — an impression for that partner.
            track(el.getAttribute('data-va-ad-id'), 'impression');
            el.addEventListener('click', (e) => {
                if (e.target.closest('.va-ad-apply')) return; // the CTA navigates, not the card
                track(el.getAttribute('data-va-ad-id'), 'click');
                showDetail(el.getAttribute('data-va-ad-id'));
            });
        });
    }

    async function loadPartnersList(search) {
        const body = overlayEl.querySelector('.va-partners-body');
        body.innerHTML = `<div class="va-partners-empty"><i class="fa-solid fa-spinner fa-spin"></i> Loading partners…</div>`;
        try {
            const { ads } = await list({ sort: 'popular', limit: 50, search: search || undefined });
            if (!ads.length) {
                body.innerHTML = `<div class="va-partners-empty">No partners found.</div>`;
                return;
            }
            // Live fleet counts power the "N live" badges; the directory must
            // be warm for callsign matching. Both fail soft to zero badges.
            await loadDirectory().catch(() => {});
            const counts = liveCountsByAd();
            // Favourites first — a pilot's own VA should never be buried behind
            // whoever happens to be busiest — then most-live, then featured,
            // otherwise keep server order.
            const favs = new Set(favIds());
            ads.sort((a, b) =>
                (favs.has(String(b.id)) ? 1 : 0) - (favs.has(String(a.id)) ? 1 : 0) ||
                (counts.get(String(b.id)) || 0) - (counts.get(String(a.id)) || 0) ||
                (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
            body.innerHTML = ads.map((ad) => cardHTML(ad, counts.get(String(ad.id)) || 0)).join('');
            bindCards(body);
        } catch (e) {
            body.innerHTML = `<div class="va-partners-empty">Couldn't load partners right now.</div>`;
        }
    }

    // ---------------------------------------------------------------------
    // Events calendar + pilot roster (partner-detail sections)
    // ---------------------------------------------------------------------

    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Local Y-M-D key so events group onto the calendar day the viewer actually
    // sees in their own timezone (the feed carries a UTC startsAt).
    function dayKey(d) {
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    }

    function fmtEventTime(d) {
        try {
            return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        } catch (e) {
            return d.toISOString();
        }
    }

    // Whether an event is under way now. The feed only keeps events until ~12h
    // after they start, so a start time already in the past means it is (almost
    // certainly) happening right now rather than long over.
    function isLiveEvent(when) {
        return when.getTime() <= Date.now();
    }

    // A short, glanceable countdown: "Happening now" once it has started, else
    // "in 8m" / "in 5h" / "in 3d" / "in 2w".
    function relativeWhen(when) {
        const diff = when.getTime() - Date.now();
        if (diff <= 0) return 'Happening now';
        const min = 60000, hr = 60 * min, day = 24 * hr;
        if (diff < hr) return `in ${Math.max(1, Math.round(diff / min))}m`;
        if (diff < day) return `in ${Math.round(diff / hr)}h`;
        if (diff < 14 * day) return `in ${Math.round(diff / day)}d`;
        return `in ${Math.round(diff / (7 * day))}w`;
    }

    // The at-a-glance "Next up" card above the calendar — the soonest event
    // (or the one under way now), with its countdown. Clicking it jumps the
    // calendar to that event's day. Empty when there are no events.
    function nextUpHTML(items) {
        if (!items.length) return '';
        const it = items[0];
        const live = isLiveEvent(it.when);
        const eyebrow = live
            ? '<span class="va-live-dot"></span> Happening now'
            : '<i class="fa-regular fa-clock"></i> Next up';
        return `
            <button class="va-next-up${live ? ' is-live' : ''}" data-va-nextup type="button" title="Show on calendar">
                <span class="va-next-up-eyebrow">${eyebrow}</span>
                <span class="va-next-up-title">${esc(it.title)}</span>
                <span class="va-next-up-when">${esc(relativeWhen(it.when))} · ${esc(fmtEventTime(it.when))}</span>
            </button>`;
    }

    function eventRowHTML(it) {
        const link = it.link
            ? `<a class="va-event-link" href="${esc(it.link)}" target="_blank" rel="noopener noreferrer" title="Open event link"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>`
            : '';
        // The formation for this event is in the air — one tap frames it.
        const watch = it.groupCode
            ? `<button type="button" class="va-event-watch" data-group-code="${esc(it.groupCode)}" title="Watch this group flight"><i class="fa-solid fa-satellite-dish"></i> Watch live</button>`
            : '';
        // Event banners are .webp; an animated upload comes back as ANIMATED
        // WebP and plays by itself inside an <img>. It MUST stay an <img> (never
        // a <canvas> or a background paint of a frame) or it freezes on frame 1.
        const banner = it.banner
            ? `<img class="va-event-banner" src="${esc(it.banner)}" alt="${esc(it.title)}" loading="lazy" decoding="async" onerror="this.style.display='none'">`
            : '';
        const dep = it.dep ? `<span class="va-event-dep"><i class="fa-solid fa-plane-departure"></i>${esc(it.dep)}</span>` : '';
        // Live badge once it has started, otherwise a countdown chip.
        const live = isLiveEvent(it.when);
        const status = live
            ? `<span class="va-event-status va-event-live"><span class="va-live-dot"></span>Happening now</span>`
            : `<span class="va-event-status">${esc(relativeWhen(it.when))}</span>`;
        return `
            <div class="va-event-row${it.banner ? ' va-event-has-banner' : ''}${live ? ' is-live' : ''}">
                ${banner}
                <div class="va-event-body">
                    <div class="va-event-date">
                        <span class="va-event-mon">${MONTHS[it.when.getMonth()].slice(0, 3)}</span>
                        <span class="va-event-day">${it.when.getDate()}</span>
                    </div>
                    <div class="va-event-main">
                        <div class="va-event-title">${esc(it.title)}${link}${status}</div>
                        <div class="va-event-when"><i class="fa-regular fa-clock"></i>${esc(fmtEventTime(it.when))}${dep}${watch}</div>
                        ${it.description ? `<div class="va-event-desc">${esc(it.description)}</div>` : ''}
                    </div>
                </div>
            </div>`;
    }

    function eventsSectionHTML(state, items, byDay) {
        const { year, month, selected } = state;
        const todayKey = dayKey(new Date());
        const startWeekday = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        // Days that hold an event under way right now get a live accent.
        const liveDays = new Set();
        byDay.forEach((evs, k) => { if (evs.some((e) => isLiveEvent(e.when))) liveDays.add(k); });

        let cells = '';
        for (let i = 0; i < startWeekday; i++) cells += `<div class="va-cal-cell va-cal-empty"></div>`;
        for (let d = 1; d <= daysInMonth; d++) {
            const k = `${year}-${month}-${d}`;
            const has = byDay.has(k);
            const cls = ['va-cal-cell'];
            if (has) cls.push('va-cal-has');
            if (liveDays.has(k)) cls.push('va-cal-live');
            if (k === todayKey) cls.push('va-cal-today');
            if (k === selected) cls.push('va-cal-selected');
            cells += `<div class="${cls.join(' ')}"${has ? ` data-va-cal-day="${k}" role="button" tabindex="0" title="${byDay.get(k).length} event${byDay.get(k).length === 1 ? '' : 's'}"` : ''}><span class="va-cal-num">${d}</span>${has ? '<span class="va-cal-dot"></span>' : ''}</div>`;
        }

        // The list shows every upcoming event, or just the picked day's events.
        const listItems = selected ? (byDay.get(selected) || []) : items;
        const list = listItems.length
            ? listItems.map(eventRowHTML).join('')
            : `<div class="va-events-empty"><i class="fa-regular fa-calendar-xmark"></i> No ${selected ? 'events on this day' : 'upcoming events'}.</div>`;

        return `
            <div class="va-fleet-title">
                <h4>Events</h4>
                <span class="va-fleet-count">${items.length ? items.length + ' upcoming' : ''}</span>
            </div>
            ${nextUpHTML(items)}
            <div class="va-cal">
                <div class="va-cal-head">
                    <button class="va-cal-nav" data-va-cal-nav="-1" aria-label="Previous month"><i class="fa-solid fa-chevron-left"></i></button>
                    <span class="va-cal-month">${MONTHS[month]} ${year}</span>
                    <button class="va-cal-nav" data-va-cal-nav="1" aria-label="Next month"><i class="fa-solid fa-chevron-right"></i></button>
                </div>
                <div class="va-cal-grid va-cal-dow">${WEEKDAYS.map((w) => `<div class="va-cal-dowcell">${w}</div>`).join('')}</div>
                <div class="va-cal-grid">${cells}</div>
            </div>
            ${selected ? `<button class="va-ad-back va-cal-clear"><i class="fa-solid fa-arrow-left"></i> All upcoming events</button>` : ''}
            <div class="va-events-list">${list}</div>`;
    }

    // Render the Events section (month calendar + event list) into a container.
    // View state (shown month, selected day) rides on a redraw closure so month
    // navigation and day-picking don't need any persistent element wiring.
    function renderEvents(container, evs) {
        if (!container) return;
        injectStyles();
        const items = (evs || [])
            .map((e) => {
                const when = new Date(e.startsAt);
                if (isNaN(when.getTime())) return null;
                return {
                    id: String(e.id || ''),
                    title: String(e.title || 'Untitled event'),
                    description: String(e.description || ''),
                    link: safeUrl(e.link),
                    banner: safeUrl(e.bannerUrl || e.banner),
                    dep: String(e.departureIcao || '').trim().toUpperCase(),
                    // Set once the VA has published a group flight for this
                    // event — the card then offers to watch the formation.
                    groupCode: String(e.groupCode || '').trim(),
                    when
                };
            })
            .filter(Boolean)
            .sort((a, b) => a.when - b.when);

        const byDay = new Map();
        items.forEach((it) => {
            const k = dayKey(it.when);
            if (!byDay.has(k)) byDay.set(k, []);
            byDay.get(k).push(it);
        });

        // Open on the first upcoming event's month (today's month when empty).
        const first = items.length ? items[0].when : new Date();
        const state = { year: first.getFullYear(), month: first.getMonth(), selected: null };

        const draw = () => {
            container.innerHTML = eventsSectionHTML(state, items, byDay);
            container.querySelectorAll('[data-va-cal-nav]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    let m = state.month + Number(btn.getAttribute('data-va-cal-nav'));
                    let y = state.year;
                    if (m < 0) { m = 11; y--; }
                    if (m > 11) { m = 0; y++; }
                    state.month = m; state.year = y; state.selected = null;
                    draw();
                });
            });
            container.querySelectorAll('[data-va-cal-day]').forEach((cell) => {
                cell.addEventListener('click', () => {
                    const k = cell.getAttribute('data-va-cal-day');
                    state.selected = state.selected === k ? null : k; // toggle off on re-click
                    draw();
                });
            });
            const clear = container.querySelector('.va-cal-clear');
            if (clear) clear.addEventListener('click', () => { state.selected = null; draw(); });
            // "Next up" jumps the calendar to that event's month + day.
            const nextBtn = container.querySelector('[data-va-nextup]');
            if (nextBtn && items.length) {
                nextBtn.addEventListener('click', () => {
                    const it = items[0];
                    state.year = it.when.getFullYear();
                    state.month = it.when.getMonth();
                    state.selected = dayKey(it.when);
                    draw();
                });
            }
        };
        draw();
    }

    function rosterCountText(data, q) {
        if (q) return `${data.total} of ${data.rosterTotal}`;
        return `${data.rosterTotal} pilot${data.rosterTotal === 1 ? '' : 's'}`;
    }

    function rosterListHTML(data, q) {
        if (!data.pilots.length) {
            return `<div class="va-events-empty"><i class="fa-solid fa-user-slash"></i> ${q ? 'No pilots match your search.' : 'No pilots on the roster yet.'}</div>`;
        }
        return data.pilots.map((p) => {
            const uname = String(p.username || '').trim();
            let added = '';
            const d = p.addedAt ? new Date(p.addedAt) : null;
            if (d && !isNaN(d.getTime())) {
                try { added = d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { /* keep blank */ }
            }
            const initial = (uname[0] || '?').toUpperCase();
            return `
                <div class="va-roster-row">
                    <span class="va-roster-avatar">${esc(initial)}</span>
                    <span class="va-roster-name">${esc(uname || '—')}</span>
                    ${added ? `<span class="va-roster-since">${esc(added)}</span>` : ''}
                </div>`;
        }).join('');
    }

    function rosterSectionHTML(data, q) {
        return `
            <div class="va-fleet-title">
                <h4>Roster</h4>
                <span class="va-fleet-count va-roster-count">${esc(rosterCountText(data, q))}</span>
            </div>
            <div class="va-roster-search"><input type="text" placeholder="Search pilots…" autocomplete="off"></div>
            <div class="va-roster-list">${rosterListHTML(data, q)}</div>`;
    }

    // Render the Roster section into a container. The search box re-queries the
    // backend (server-side q=) with a debounce and swaps only the count + list
    // so the input never loses focus mid-type. Fails soft to an empty roster.
    function renderRoster(container, id, initial) {
        if (!container) return;
        injectStyles();
        container.innerHTML = rosterSectionHTML(initial || { total: 0, rosterTotal: 0, pilots: [] }, '');
        const input = container.querySelector('.va-roster-search input');
        if (!input) return;
        let searchTimer = 0;
        input.addEventListener('input', () => {
            clearTimeout(searchTimer);
            const val = input.value.trim();
            const listEl = container.querySelector('.va-roster-list');
            searchTimer = setTimeout(async () => {
                if (listEl) listEl.innerHTML = `<div class="va-events-empty"><i class="fa-solid fa-spinner fa-spin"></i> Searching…</div>`;
                const res = await pilots(id, { q: val || undefined, limit: 500 });
                // The search may have moved on while this request was in flight;
                // only paint if the box still holds the query we searched for.
                if (input.value.trim() !== val) return;
                const countEl = container.querySelector('.va-roster-count');
                if (countEl) countEl.textContent = rosterCountText(res, val);
                if (listEl) listEl.innerHTML = rosterListHTML(res, val);
            }, 280);
        });
    }

    async function showDetail(id) {
        const body = overlayEl.querySelector('.va-partners-body');
        track(id, 'profile');
        body.innerHTML = `<div class="va-partners-empty"><i class="fa-solid fa-spinner fa-spin"></i> Loading…</div>`;
        try {
            // Pull the ad, its scheduled events and its pilot roster together;
            // the events/roster feeds fail soft so the panel still renders.
            const [ad, evs, roster] = await Promise.all([
                get(id),
                events(id),
                pilots(id, { limit: 500 }),
                loadDirectory().catch(() => {})
            ]);
            if (!ad) { body.innerHTML = `<div class="va-partners-empty">Partner not found.</div>`; return; }

            const pills = [];
            if (ad.featured) pills.push('<span class="va-ad-pill va-ad-pill-featured">Featured</span>');
            if (ad.recruiting) pills.push('<span class="va-ad-pill">Recruiting</span>');
            const chips = (ad.tags || []).map((tg) => `<span class="va-ad-chip">${esc(tg)}</span>`).join('');
            // data-va-link tags each CTA so the delegated handler below can tell
            // the statistics which destination a visitor actually chose.
            const actions = [];
            // Crew Center leads: for a pilot already in the VA it's the thing
            // they came for, and it needs no account with us.
            const crewCta = crewButtonHTML(ad, 'va-ad-crew');
            if (crewCta) actions.push(crewCta);
            if (ad.website) actions.push(`<a class="va-ad-apply" data-va-link="apply" data-va-ad-id="${esc(ad.id)}" href="${esc(ad.website)}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-paper-plane"></i> Apply now</a>`);
            if (ad.website) actions.push(`<a class="va-ad-btn" data-va-link="website" data-va-ad-id="${esc(ad.id)}" href="${esc(ad.website)}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-globe"></i> Website</a>`);
            if (ad.discord) actions.push(`<a class="va-ad-btn" data-va-link="discord" data-va-ad-id="${esc(ad.id)}" href="${esc(ad.discord)}" target="_blank" rel="noopener noreferrer"><i class="fa-brands fa-discord"></i> Discord</a>`);

            const fleet = liveFleetFor(ad);
            const code = vaCodeFromCallsign(ad.callsign);
            const logo = ad.logo
                ? `<img class="va-ad-logo" src="${esc(ad.logo)}" alt="" onerror="this.style.display='none'">`
                : `<div class="va-ad-logo"><i class="fa-solid fa-building"></i></div>`;

            // Stat tiles, reference-style: TYPE / REGION / HUB / LIVE NOW.
            const statTiles = [];
            if (ad.type) statTiles.push(`<div class="va-stat-tile"><label>Type</label><span><i class="fa-solid fa-sitemap"></i>${esc(ad.type)}</span></div>`);
            if (ad.region) statTiles.push(`<div class="va-stat-tile"><label>Region</label><span><i class="fa-solid fa-earth-americas"></i>${esc(ad.region)}</span></div>`);
            if (ad.icao.length) statTiles.push(`<div class="va-stat-tile"><label>Hub${ad.icao.length > 1 ? 's' : ''}</label><span><i class="fa-solid fa-tower-control"></i>${esc(ad.icao.slice(0, 3).join(' · '))}</span></div>`);
            statTiles.push(`<div class="va-stat-tile"><label>Live now</label><span class="va-stat-live"><i class="fa-solid fa-plane" style="color:#4ade80"></i>${fleet.length} aircraft</span></div>`);

            const fleetCards = fleet.map((f, i) => `
                <div class="va-fleet-card" data-va-fleet-idx="${i}" role="button" tabindex="0" title="Open ${esc(f.callsign)} on the map">
                    <div class="va-fleet-img" data-va-fleet-img="${i}">
                        <span class="va-fleet-chip va-fleet-callsign">${esc(f.callsign)}</span>
                        <span class="va-fleet-chip va-fleet-route">${esc(f.dep)} <span class="va-fleet-arrow">→</span> ${esc(f.arr)}</span>
                    </div>
                    <div class="va-fleet-stats">
                        <div class="va-fleet-stat">
                            <label>Aircraft</label>
                            <span><i class="fa-solid fa-plane"></i>${esc(f.type || 'Unknown')}</span>
                        </div>
                        <div class="va-fleet-stat">
                            <label>Pilot</label>
                            <span><i class="fa-solid fa-user"></i>${esc(f.username || '—')}</span>
                        </div>
                        <div class="va-fleet-stat">
                            <label>Livery</label>
                            <span>${esc(f.livery || 'Generic')}</span>
                        </div>
                        <div class="va-fleet-stat">
                            <label>Alt / GS</label>
                            <span>${f.altFt > 100 ? 'FL' + String(Math.round(f.altFt / 100)).padStart(3, '0') : f.altFt + ' ft'} · ${f.gsKt} kt</span>
                        </div>
                    </div>
                </div>`).join('');

            body.innerHTML = `
                <div class="va-ad-detail">
                    <button class="va-ad-back"><i class="fa-solid fa-arrow-left"></i> All partners</button>
                    ${bannerImgHTML(ad.banner, 'va-ad-detail-banner', ad.name)}
                    <div class="va-detail-head">
                        ${logo}
                        <div class="va-detail-titles">
                            <h3>${esc(ad.name)}</h3>
                            <div class="va-detail-subrow">
                                ${code ? `<span class="va-code-chip">${esc(code)}</span>` : ''}
                                ${pills.join(' ')}
                            </div>
                        </div>
                    </div>
                    ${ad.tagline ? `<div class="va-ad-card-sub" style="margin-top:10px">${esc(ad.tagline)}</div>` : ''}
                    <div class="va-stat-row">${statTiles.join('')}</div>
                    <div class="va-fleet-title">
                        <h4>Live Fleet</h4>
                        <span class="va-fleet-count">${fleet.length ? fleet.length + ' in the air' : ''}</span>
                    </div>
                    <div class="va-group-slot"></div>
                    ${fleet.length
                        ? `<div class="va-fleet-grid">${fleetCards}</div>`
                        : `<div class="va-fleet-empty"><i class="fa-solid fa-plane-slash"></i>No ${esc(ad.name)} aircraft in the air right now — check back soon.</div>`}
                    <div class="va-events-section"></div>
                    <div class="va-roster-section"></div>
                    ${ad.description ? `<p class="desc" style="margin-top:16px">${esc(ad.description)}</p>` : ''}
                    ${chips ? `<div class="va-ad-chips" style="margin-top:12px">${chips}</div>` : ''}
                    ${actions.length ? `<div class="va-ad-actions">${actions.join('')}</div>` : ''}
                </div>`;

            const back = body.querySelector('.va-ad-back');
            if (back) back.addEventListener('click', () => loadPartnersList(''));

            // Crew Center CTA in the detail panel gets the same in-app overlay
            // treatment as the list cards.
            bindCrewButtons(body);

            // Wire fleet cards → open that flight on the map.
            body.querySelectorAll('[data-va-fleet-idx]').forEach((el) => {
                el.addEventListener('click', () => {
                    const entry = fleet[Number(el.getAttribute('data-va-fleet-idx'))];
                    track(id, 'fleet');
                    if (entry) openFleetFlight(entry);
                });
            });

            // Scheduled events (month calendar + list) and the pilot roster.
            renderEvents(body.querySelector('.va-events-section'), evs);
            renderRoster(body.querySelector('.va-roster-section'), id, roster);
            // Both sections belong to this VA — tag their links so the delegated
            // click handler can attribute an event click without another lookup.
            body.querySelectorAll('.va-event-link').forEach((a) => {
                a.setAttribute('data-va-link', 'event');
                a.setAttribute('data-va-ad-id', id);
            });
            if (roster && roster.pilots && roster.pilots.length) track(id, 'roster');
            // Group-flight composer — only for the account that owns THIS VA.
            renderGroupComposer(body.querySelector('.va-group-slot'), ad, fleet, evs);

            // Hydrate aircraft photos lazily: community shot for the exact
            // type+livery, else the type's Generic livery, else default art.
            fleet.forEach((f, i) => {
                aircraftImage(f.type, f.livery).then((url) => {
                    const img = body.querySelector(`[data-va-fleet-img="${i}"]`);
                    if (img) img.style.backgroundImage = `url('${esc(url)}'), url('${GENERIC_PLANE_IMG}')`;
                });
            });
        } catch (e) {
            body.innerHTML = `<div class="va-partners-empty">Couldn't load this partner.</div>`;
        }
    }

    // Render the group-flight composer into the VA detail panel.
    //
    // Three states, decided by the backend's answer to "which VA does this
    // account own":
    //   • not signed in, or signed in and owns a DIFFERENT VA → render nothing.
    //     The panel is a public directory entry; a stranger shouldn't see
    //     publishing controls for someone else's airline.
    //   • signed in, owns nothing yet → offer the one-click claim. This is the
    //     only route a VA has into the feature, so it can't be omitted; it's
    //     kept quiet because most signed-in pilots don't run a VA.
    //   • owns this VA, fewer than two aircraft airborne → explain why the
    //     button isn't there yet, rather than showing a dead control.
    //   • owns this VA, formation in the air → select, title, publish.
    async function renderGroupComposer(slot, ad, fleet, events) {
        if (!slot) return;
        const state = await ownerState();
        if (!state.signedIn) return;

        if (!state.va) {
            slot.innerHTML = `
                <div class="va-group-box is-claim">
                    <p class="va-group-hint">
                        Run ${esc(ad.name)}? Link this account with the email address on file for your
                        partnership and you can publish group-flight links for your events.
                    </p>
                    <button type="button" class="va-group-claim"><i class="fa-solid fa-link"></i> Link my account</button>
                    <p class="va-group-msg"></p>
                </div>`;
            const box = slot.querySelector('.va-group-box');
            const btn = box.querySelector('.va-group-claim');
            const msg = box.querySelector('.va-group-msg');
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                msg.textContent = 'Checking…';
                const out = await claimVa();
                if (out && out.ok) {
                    // Re-render the panel so the composer replaces this prompt.
                    msg.textContent = `Linked to ${out.va?.name || 'your VA'}.`;
                    renderGroupComposer(slot, ad, fleet, events);
                } else {
                    btn.disabled = false;
                    msg.textContent = (out && out.error) || 'Could not link your account.';
                }
            });
            return;
        }

        const mine = state.va;
        if (String(mine.id) !== String(ad.id)) return;

        // Only the VA's own scheduled events can be attached, and only ones
        // near enough in time to plausibly be the flight taking off now.
        const soon = (events || []).filter((e) => {
            const t = new Date(e.startsAt).getTime();
            return Number.isFinite(t) && Math.abs(Date.now() - t) < 12 * 60 * 60 * 1000;
        });

        if (fleet.length < 2) {
            slot.innerHTML = `
                <div class="va-group-box">
                    <div class="va-group-head">
                        <i class="fa-solid fa-people-group"></i>
                        <span>Group flight</span>
                        <span class="va-group-owner">You manage ${esc(mine.name)}</span>
                    </div>
                    <p class="va-group-hint">Once at least two of your aircraft are airborne, select them here to publish one link people can watch the whole formation on.</p>
                </div>`;
            return;
        }

        slot.innerHTML = `
            <div class="va-group-box">
                <div class="va-group-head">
                    <i class="fa-solid fa-people-group"></i>
                    <span>Group flight</span>
                    <span class="va-group-owner">You manage ${esc(mine.name)}</span>
                </div>
                <p class="va-group-hint">Pick the aircraft flying together, give it a title, and share one link.</p>
                <div class="va-group-picks">
                    ${fleet.map((f, i) => `
                        <label class="va-group-pick">
                            <input type="checkbox" data-group-idx="${i}" checked>
                            <span class="va-group-cs">${esc(f.callsign)}</span>
                            <span class="va-group-rt">${esc(f.dep)} → ${esc(f.arr)}</span>
                        </label>`).join('')}
                </div>
                <input type="text" class="va-group-title" maxlength="90" placeholder="Event title — e.g. Transatlantic Friday">
                ${soon.length ? `
                <select class="va-group-event">
                    <option value="">Don't attach to an event</option>
                    ${soon.map((e) => `<option value="${esc(e.id)}">Attach to: ${esc(e.title)}</option>`).join('')}
                </select>` : ''}
                <button type="button" class="va-group-go"><i class="fa-solid fa-link"></i> Create group link</button>
                <p class="va-group-msg"></p>
            </div>`;

        const box = slot.querySelector('.va-group-box');
        const titleEl = box.querySelector('.va-group-title');
        const eventEl = box.querySelector('.va-group-event');
        const goEl = box.querySelector('.va-group-go');
        const msgEl = box.querySelector('.va-group-msg');
        // Pre-fill from an imminent event so the common case is one click.
        if (soon.length && titleEl) titleEl.value = soon[0].title || '';

        const selected = () => Array.from(box.querySelectorAll('[data-group-idx]'))
            .filter((cb) => cb.checked)
            .map((cb) => fleet[Number(cb.getAttribute('data-group-idx'))])
            .filter(Boolean);

        goEl.addEventListener('click', async () => {
            const picks = selected();
            const title = (titleEl.value || '').trim();
            if (picks.length < 2) { msgEl.textContent = 'Pick at least two aircraft.'; return; }
            if (!title) { msgEl.textContent = 'Give the group flight a title.'; return; }

            goEl.disabled = true;
            msgEl.textContent = 'Creating…';
            const out = await publishGroupFlight(title, picks, eventEl ? eventEl.value : '');
            goEl.disabled = false;

            if (!out || !out.ok) {
                msgEl.textContent = (out && out.error) || 'Could not create the link.';
                return;
            }
            // Show the link and put it on the clipboard in one go — the whole
            // point is pasting it somewhere else immediately.
            box.querySelector('.va-group-result')?.remove();
            const result = document.createElement('div');
            result.className = 'va-group-result';
            result.innerHTML = `
                <input type="text" readonly value="${esc(out.shareUrl)}">
                <button type="button" class="va-group-copy"><i class="fa-solid fa-copy"></i> Copy</button>`;
            box.appendChild(result);
            msgEl.textContent = `Live — ${out.count} aircraft.`;

            const copy = async () => {
                try {
                    await navigator.clipboard.writeText(out.shareUrl);
                    msgEl.textContent = 'Link copied — paste it wherever you like.';
                } catch (e) {
                    result.querySelector('input').select();
                }
            };
            result.querySelector('.va-group-copy').addEventListener('click', copy);
            copy();
        });
    }

    function openPartners(adId) {
        ensureOverlay();
        overlayEl.classList.add('visible');
        if (adId) { track(adId, 'open'); showDetail(adId); }
        else loadPartnersList('');
    }

    function closePartners() {
        if (overlayEl) overlayEl.classList.remove('visible');
    }

    // ---------------------------------------------------------------------
    // Toolbar launcher
    // ---------------------------------------------------------------------

    function wireToolbarButton() {
        const btn = document.getElementById('toolbar-partners-btn');
        if (btn && !btn.dataset.vaAdsWired) {
            btn.dataset.vaAdsWired = 'true';
            btn.addEventListener('click', () => openPartners());
        }
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', wireToolbarButton);
        } else {
            wireToolbarButton();
        }
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlayEl && overlayEl.classList.contains('visible')) closePartners();
        });
        // Any callsign-match "info" badge (injected into the flight info window)
        // opens that partner's detail when clicked, wherever it lives.
        document.addEventListener('click', (e) => {
            const el = e.target.closest && e.target.closest('.va-cs-info[data-va-ad-id]');
            if (el) {
                e.preventDefault();
                track(el.getAttribute('data-va-ad-id'), 'badge');
                openPartners(el.getAttribute('data-va-ad-id'));
            }
        });
        // Outbound CTAs (apply / website / Discord / event link). Delegated so it
        // covers every surface that renders one, including markup injected later.
        // The link still navigates normally — we only record which one was taken,
        // flushed immediately since the user may leave straight away.
        document.addEventListener('click', (e) => {
            const link = e.target.closest && e.target.closest('[data-va-link][data-va-ad-id]');
            if (link) track(link.getAttribute('data-va-ad-id'), link.getAttribute('data-va-link'), true);
        }, true);
        // "Watch live" on an event card whose formation is airborne. Fetches the
        // group and hands it to the map's group-watch view, closing the panel so
        // the formation isn't hidden behind it.
        document.addEventListener('click', async (e) => {
            const btn = e.target.closest && e.target.closest('[data-group-code]');
            if (!btn) return;
            e.preventDefault();
            const code = btn.getAttribute('data-group-code');
            try {
                const res = await fetch(`${GROUP_API}/api/group-flights/${encodeURIComponent(code)}`, {
                    headers: { Accept: 'application/json' },
                });
                const data = await res.json();
                if (data && data.ok && typeof window.watchGroupFlight === 'function') {
                    closePartners();
                    window.watchGroupFlight(data);
                }
            } catch (err) { /* a dead link just does nothing */ }
        });
        // The simple flight window lives in an iframe and asks the host (here)
        // to open a partner when its badge is tapped.
        window.addEventListener('message', (e) => {
            const d = e && e.data;
            if (d && d.type === 'INFLIGHT_OPEN_VA_PARTNER' && d.id) openPartners(d.id);
        });
        // Anything still queued when the page goes away rides out on a beacon,
        // which the browser delivers even as the document is being torn down.
        window.addEventListener('pagehide', () => flushStats(true));
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') flushStats(true);
        });

        const isTopWindow = (window === window.parent);
        if (isTopWindow) {
            // Warm the callsign directory so hover/info badges resolve instantly.
            loadDirectory();
        }
    }

    window.InflightVaAds = {
        list,
        banner,
        get,
        pilots,
        events,
        hydrateAirportBanner,
        hydrateFlightBanner,
        openPartners,
        closePartners,
        matchCallsign,
        isCallsignMember,
        vaFilterMember,
        ensureRoster,
        rosterHas,
        normUsername,
        callsignBadgeHTML,
        partnersForIcao,
        allPartners,
        loadDirectory,
        // Report a VA interaction from anywhere else in the tracker. type is one
        // of impression / click / open / profile / apply / website / discord /
        // event / fleet / roster / badge / share.
        track
    };
})();
