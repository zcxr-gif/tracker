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

    // Only allow http(s) links through; anything else (javascript:, etc.) is
    // dropped so external ad data can't smuggle a dangerous href in.
    function safeUrl(u) {
        const s = String(u || '').trim();
        return /^https?:\/\//i.test(s) ? s : '';
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
        const lt = lastToken(callsign);
        if (!lt) return false;
        // Use the VA's declared tag when it has one (e.g. "Ocean XXVA" → "VA");
        // otherwise fall back to the standard "VA" suffix that denotes a virtual
        // airline member. We must match a specific tag, not just "any trailing
        // letters" — otherwise an unrelated suffix like "Air Canada 108AC" (the
        // pilot's own "AC", not a membership tag) would wrongly count as a
        // member. "Air Canada 001VA" → member; "108AC"/"500" → not.
        const tag = vaTag(va) || 'VA';
        return lt.length > tag.length && lt.endsWith(tag);
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
                width: 44px; height: 44px; border-radius: 10px; object-fit: cover;
                background: rgba(0,0,0,0.35); flex: 0 0 auto;
                display: flex; align-items: center; justify-content: center; color: #7dd3fc;
            }
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
            .va-ad-full-img { display: block; width: 100%; height: auto; transition: opacity .25s ease; }
            .va-ad-full .va-ad-dots { padding-top: 8px; }
            .va-ad-feature-banner { height: 84px; background-size: cover; background-position: center; background-color: rgba(56,189,248,0.08); }
            .va-ad-feature-body { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; }
            .va-ad-feature-meta { min-width: 0; flex: 1; }
            .va-ad-feature .va-ad-name { white-space: normal; }
            .va-ad-dots { display: flex; gap: 5px; justify-content: center; padding: 0 0 10px; }
            .va-ad-dot { width: 5px; height: 5px; border-radius: 50%; background: rgba(255,255,255,0.3); transition: background .2s ease, transform .2s ease; }
            .va-ad-dot.is-active { background: #7dd3fc; transform: scale(1.3); }

            .va-cs-badge { display: inline-flex; align-items: center; gap: 6px; vertical-align: middle; }
            .va-cs-hover { margin-left: 6px; }
            .va-cs-logo { width: 16px; height: 16px; border-radius: 4px; object-fit: cover; background: rgba(0,0,0,0.3); flex: 0 0 auto; }
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
            .va-ad-card-banner { height: 92px; background-size: cover; background-position: center; background-color: rgba(56,189,248,0.08); }
            .va-ad-card-body { padding: 12px 14px; display: flex; gap: 12px; align-items: flex-start; }
            .va-ad-card-body .va-ad-logo { width: 40px; height: 40px; }
            .va-ad-card-title { font-weight: 700; color: #fff; font-size: 0.92rem; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
            .va-ad-card-sub { font-size: 0.78rem; color: rgba(255,255,255,0.6); margin-top: 2px; }
            .va-ad-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
            .va-ad-chip { font-size: 0.62rem; color: rgba(255,255,255,0.7); background: rgba(255,255,255,0.07); border-radius: 999px; padding: 2px 8px; }

            .va-ad-detail-banner { height: 140px; background-size: cover; background-position: center; background-color: rgba(56,189,248,0.1); border-radius: 14px; }
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
            .va-detail-head .va-ad-logo { width: 52px; height: 52px; border-radius: 12px; }
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
            .va-event-when { font-size: 0.72rem; color: rgba(255,255,255,0.6); margin-top: 3px; }
            .va-event-when i { color: #7dd3fc; margin-right: 5px; }
            .va-event-desc { font-size: 0.78rem; color: rgba(255,255,255,0.72); margin-top: 5px; line-height: 1.5; white-space: pre-wrap; }

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
            ${ad.banner ? `<div class="va-ad-feature-banner" style="background-image:url('${esc(ad.banner)}')"></div>` : ''}
            <div class="va-ad-feature-body">
                ${logo}
                <div class="va-ad-feature-meta">
                    <div class="va-ad-eyebrow"><i class="fa-solid fa-handshake-angle"></i> VA Partner ${pills.join(' ')}</div>
                    <div class="va-ad-name">${esc(ad.name)}</div>
                    ${ad.tagline ? `<div class="va-ad-tag">${esc(ad.tagline)}</div>` : ''}
                    ${chips ? `<div class="va-ad-chips">${chips}</div>` : ''}
                    ${ad.website ? `<a class="va-ad-apply sm" href="${esc(ad.website)}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-paper-plane"></i> Apply now</a>` : ''}
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

        fullEl.addEventListener('click', () => openPartners(fullEl.getAttribute('data-va-ad-id')));

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
                ${ad.banner ? `<div class="va-ad-card-banner" style="background-image:url('${esc(ad.banner)}')"></div>` : ''}
                <div class="va-ad-card-body">
                    ${logo}
                    <div style="min-width:0; flex:1;">
                        <div class="va-ad-card-title">${esc(ad.name)} ${pills.join(' ')}</div>
                        ${sub ? `<div class="va-ad-card-sub">${esc(sub)}</div>` : ''}
                        ${ad.tagline ? `<div class="va-ad-card-sub">${esc(ad.tagline)}</div>` : ''}
                        ${chips ? `<div class="va-ad-chips">${chips}</div>` : ''}
                        ${ad.website ? `<a class="va-ad-apply sm" href="${esc(ad.website)}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-paper-plane"></i> Apply now</a>` : ''}
                    </div>
                </div>
            </div>`;
    }

    function bindCards(body) {
        body.querySelectorAll('[data-va-ad-id]').forEach((el) => {
            el.addEventListener('click', (e) => {
                if (e.target.closest('.va-ad-apply')) return; // the CTA navigates, not the card
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
            // Most-live first, then featured, otherwise keep server order.
            ads.sort((a, b) =>
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

    function eventRowHTML(it) {
        const link = it.link
            ? `<a class="va-event-link" href="${esc(it.link)}" target="_blank" rel="noopener noreferrer" title="Open event link"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>`
            : '';
        // Event banners are .webp; an animated upload comes back as ANIMATED
        // WebP and plays by itself inside an <img>. It MUST stay an <img> (never
        // a <canvas> or a background paint of a frame) or it freezes on frame 1.
        const banner = it.banner
            ? `<img class="va-event-banner" src="${esc(it.banner)}" alt="${esc(it.title)}" loading="lazy" decoding="async" onerror="this.style.display='none'">`
            : '';
        const dep = it.dep ? `<span class="va-event-dep"><i class="fa-solid fa-plane-departure"></i>${esc(it.dep)}</span>` : '';
        return `
            <div class="va-event-row${it.banner ? ' va-event-has-banner' : ''}">
                ${banner}
                <div class="va-event-body">
                    <div class="va-event-date">
                        <span class="va-event-mon">${MONTHS[it.when.getMonth()].slice(0, 3)}</span>
                        <span class="va-event-day">${it.when.getDate()}</span>
                    </div>
                    <div class="va-event-main">
                        <div class="va-event-title">${esc(it.title)}${link}</div>
                        <div class="va-event-when"><i class="fa-regular fa-clock"></i>${esc(fmtEventTime(it.when))}${dep}</div>
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

        let cells = '';
        for (let i = 0; i < startWeekday; i++) cells += `<div class="va-cal-cell va-cal-empty"></div>`;
        for (let d = 1; d <= daysInMonth; d++) {
            const k = `${year}-${month}-${d}`;
            const has = byDay.has(k);
            const cls = ['va-cal-cell'];
            if (has) cls.push('va-cal-has');
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
            const actions = [];
            if (ad.website) actions.push(`<a class="va-ad-apply" href="${esc(ad.website)}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-paper-plane"></i> Apply now</a>`);
            if (ad.website) actions.push(`<a class="va-ad-btn" href="${esc(ad.website)}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-globe"></i> Website</a>`);
            if (ad.discord) actions.push(`<a class="va-ad-btn" href="${esc(ad.discord)}" target="_blank" rel="noopener noreferrer"><i class="fa-brands fa-discord"></i> Discord</a>`);

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
                    ${ad.banner ? `<div class="va-ad-detail-banner" style="background-image:url('${esc(ad.banner)}')"></div>` : ''}
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

            // Wire fleet cards → open that flight on the map.
            body.querySelectorAll('[data-va-fleet-idx]').forEach((el) => {
                el.addEventListener('click', () => {
                    const entry = fleet[Number(el.getAttribute('data-va-fleet-idx'))];
                    if (entry) openFleetFlight(entry);
                });
            });

            // Scheduled events (month calendar + list) and the pilot roster.
            renderEvents(body.querySelector('.va-events-section'), evs);
            renderRoster(body.querySelector('.va-roster-section'), id, roster);

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

    function openPartners(adId) {
        ensureOverlay();
        overlayEl.classList.add('visible');
        if (adId) showDetail(adId);
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
            if (el) { e.preventDefault(); openPartners(el.getAttribute('data-va-ad-id')); }
        });
        // The simple flight window lives in an iframe and asks the host (here)
        // to open a partner when its badge is tapped.
        window.addEventListener('message', (e) => {
            const d = e && e.data;
            if (d && d.type === 'INFLIGHT_OPEN_VA_PARTNER' && d.id) openPartners(d.id);
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
        callsignBadgeHTML,
        partnersForIcao,
        allPartners,
        loadDirectory
    };
})();
