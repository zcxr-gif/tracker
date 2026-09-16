/* ============================================================================
   crewSuggestions.js — what to fly tonight.

   WHY THIS EXISTS

   A crew center has always been able to answer "what does this airline fly".
   It has never been able to answer the question a pilot actually opens it
   with, which is "what should I fly TONIGHT" — and a route list of four
   hundred legs is the worst possible answer to that. So pilots picked by
   scrolling, got bored of scrolling, and flew the same two sectors until they
   stopped flying.

   THREE ANSWERS, IN THE ORDER PEOPLE WANT THEM

     ROUTE OF THE DAY     one leg, today, the same for the whole airline.
     ROUTE OF THE WEEK    one leg, this week, ditto.
     AND FOR YOU          a short list scored against what THIS pilot flies.

   The two features are first because they are the ones that make a Discord
   talk to itself — "did you do today's?" is a thing a group flies together,
   where a personal recommendation is a thing one person does alone. Both are
   worked out by the server from the network and the date (see crewFeatured.js
   on the backend): nothing is stored, nothing has to run, and a VA that has
   never heard of this has a Route of the Week the first time somebody looks.

   WHERE THE LIVE ATC COMES FROM, AND WHY IT COMES FROM HERE

   The strongest reason to fly a particular leg tonight is that somebody is
   controlling at the other end. The server does not know that and should not
   learn it: this page is already running on a flight tracker that holds the
   live network, and having the crew backend poll Infinite Flight once per VA
   would be a second copy of a feed that is open in this tab.

   So the ATC read happens HERE, and the airline read happens THERE. This
   module asks the tracker's own live feed which fields are being controlled
   and where the traffic is pointed, hands the server a list of ICAOs, and the
   server — which is the only half that knows the airline's network, this
   pilot's logbook and the rank gates — decides what that means.

   IT IS OPTIONAL, ALL OF IT. Blocked, offline, or opened outside the tracker,
   the live read fails quietly and the panel still works: the suggestions come
   back scored on flying habits alone, and no tile claims an ATC reason it
   cannot support. That is the rule the whole feature is built on — a reason
   printed on a tile is a reason that actually scored.

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewSuggestions: crewPanels.js must load first'); return; }
    const { esc, icons, durationText } = P;

    const S = {
        api: null,
        panel: null,
        data: null,
        live: null,       // the last live ATC/traffic read, for the one-liner
        loading: false,
        error: null,
        hosts: [],        // in-page mounts to repaint when the fetch lands
        onOpenRoute: null,
    };

    /* =====================================================================
     * THE LIVE NETWORK
     *
     * Read through whatever this page already has, in order of preference:
     *
     *   1. window.InflightATC   the tracker's own read-only bridge. Free: the
     *                           data is already in memory and already fresh.
     *   2. the ACARS REST feed  for a crew center opened on its own, where
     *                           there is no map and nothing has been fetched.
     *
     * Never a hard dependency. Every path here ends at "we do not know", and
     * "we do not know" is a state the panel draws correctly.
     * =================================================================== */

    const LIVE_BASE = 'https://site--acars-backend--6dmjph8ltlhv.code.run';
    /* Two minutes. The controlled-fields list changes on the scale of a
       controller opening a position, which is minutes, and this is a panel
       somebody opens and closes — a shorter TTL would re-fetch the whole
       session's traffic every time they switched tabs. */
    const LIVE_TTL_MS = 120000;
    /* A live read must never be the reason a panel sits empty. If the feed has
       not answered in this long, the suggestions are drawn without it. */
    const LIVE_TIMEOUT_MS = 6000;

    let liveCache = null;
    let liveAt = 0;
    let liveInFlight = null;

    /** Centre controllers have no field. Everything else is at an airport. */
    const ATC_CENTER = 6;

    /**
     * What the tracker already knows, if it is on this page.
     *
     * The bridge is the tracker's own live ATC state — see window.InflightATC
     * in flight.js. Using it rather than fetching means a crew center opened
     * inside the app costs nothing at all for this, and is never out of step
     * with the map behind it.
     */
    function fromTracker() {
        const T = window.InflightATC;
        if (!T || typeof T.getFacilities !== 'function') return null;
        let facilities;
        try { facilities = T.getFacilities(); } catch (_) { return null; }
        if (!Array.isArray(facilities) || !facilities.length) return null;
        const atc = [];
        const seen = new Set();
        for (const f of facilities) {
            if (!f || Number(f.type) === ATC_CENTER) continue;
            const code = icaoOf(f.airportName);
            if (!code || seen.has(code)) continue;
            seen.add(code);
            atc.push(code);
        }
        // Inbound traffic is the map's, not the ATC bridge's, and the bridge is
        // the only thing guaranteed to be there. No counts is a fine answer —
        // ATC alone is the stronger signal anyway.
        return atc.length ? { atc, inbound: inboundFromMap() } : null;
    }

    /**
     * Where the traffic is pointed, off the tracker's live feature cache.
     *
     * Only flights that have actually FILED somewhere are counted: a flight
     * with no arrival field is a pilot with no plan, and counting them would
     * turn "twelve aircraft inbound to Heathrow" into "twelve aircraft exist".
     */
    function inboundFromMap() {
        const features = window.currentMapFeatures;
        if (!features || typeof features !== 'object') return {};
        const out = {};
        for (const key of Object.keys(features)) {
            const p = features[key] && features[key].properties;
            const to = p && icaoOf(p.arrivalIcao);
            if (to) out[to] = (out[to] || 0) + 1;
        }
        return out;
    }

    /**
     * The same two facts, fetched, for a crew center running on its own.
     *
     * Two hops — the session list, then that session's ATC and traffic — and
     * both are allowed to fail. This is decoration on a panel that works
     * without it, so nothing here retries, warns twice or blocks a draw.
     */
    async function fromNetwork() {
        const grab = async (url) => {
            const ctl = typeof AbortController === 'function' ? new AbortController() : null;
            const timer = ctl ? setTimeout(() => ctl.abort(), LIVE_TIMEOUT_MS) : null;
            try {
                const res = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
                if (!res.ok) return null;
                return await res.json();
            } catch (_) {
                return null;
            } finally { if (timer) clearTimeout(timer); }
        };

        const sessions = await grab(`${LIVE_BASE}/if-sessions`);
        const list = (sessions && sessions.sessions) || [];
        if (!Array.isArray(list) || !list.length) return null;
        // The busiest server. "Where is ATC" is a question about where people
        // are, and on a quiet training server the honest answer is nowhere.
        const best = list.slice().sort((a, b) =>
            (Number(b && b.userCount) || 0) - (Number(a && a.userCount) || 0))[0];
        if (!best || !best.id) return null;

        const [atcJson, flightsJson] = await Promise.all([
            grab(`${LIVE_BASE}/atc/${encodeURIComponent(best.id)}`),
            grab(`${LIVE_BASE}/flights/${encodeURIComponent(best.id)}`),
        ]);

        const atc = [];
        const seen = new Set();
        for (const f of (atcJson && atcJson.atc) || []) {
            if (!f || Number(f.type) === ATC_CENTER) continue;
            const code = icaoOf(f.airportName);
            if (!code || seen.has(code)) continue;
            seen.add(code);
            atc.push(code);
        }

        const inbound = {};
        const flights = (flightsJson && (flightsJson.flights || flightsJson.data))
            || (Array.isArray(flightsJson) ? flightsJson : []);
        for (const f of flights || []) {
            const to = icaoOf(f && f.arrivalIcao);
            if (to) inbound[to] = (inbound[to] || 0) + 1;
        }

        return (atc.length || Object.keys(inbound).length)
            ? { atc, inbound, server: best.name || '' }
            : null;
    }

    const icaoOf = (v) => String(v == null ? '' : v).trim().toUpperCase()
        .replace(/[^A-Z0-9]/g, '').slice(0, 4);

    /**
     * The live picture, cached, and never the reason nothing is drawn.
     *
     * Callers arriving while a read is open share it. A read that fails caches
     * `null` for the same TTL as a good one — a feed that is down stays down
     * for the next couple of minutes, and hammering it while a pilot flips
     * between tabs would help nobody.
     */
    function live() {
        if (liveCache !== undefined && Date.now() - liveAt < LIVE_TTL_MS) return Promise.resolve(liveCache);
        if (liveInFlight) return liveInFlight;
        liveInFlight = (async () => {
            let out = null;
            try { out = fromTracker() || await fromNetwork(); } catch (_) { out = null; }
            liveCache = out;
            liveAt = Date.now();
            liveInFlight = null;
            return out;
        })();
        return liveInFlight;
    }

    /** The live picture as query parameters the server will accept. */
    function busyQuery(picture) {
        if (!picture) return '';
        const parts = [];
        if (picture.atc && picture.atc.length) {
            parts.push(`atc=${encodeURIComponent(picture.atc.slice(0, 200).join(','))}`);
        }
        const inbound = Object.entries(picture.inbound || {})
            // Only fields with enough traffic to be worth a sentence. Sending
            // the whole world's arrival boards would be a long URL saying
            // nothing — one aircraft inbound is not "busy".
            .filter(([, n]) => Number(n) >= 3)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 60)
            .map(([code, n]) => `${code}:${n}`);
        if (inbound.length) parts.push(`inbound=${encodeURIComponent(inbound.join(','))}`);
        return parts.length ? `&${parts.join('&')}` : '';
    }

    /* =====================================================================
     * STYLES
     * =================================================================== */

    function styles() {
        P.baseStyles();
        P.style('crew-suggestions', `
        .sg-wrap{ display:grid; gap:1.1rem; }
        .sg-h{ font-size:.7rem; font-weight:800; letter-spacing:.1em; text-transform:uppercase;
            color:var(--muted,#736E64); }
        /* ---- THE FEATURED PAIR ------------------------------------------
           Two of them, side by side where there is room. The day's leg is
           first on purpose: it is the one with a deadline on it. */
        .sg-feature-pair{ display:grid; gap:.7rem; }
        @media (min-width:38rem){ .sg-feature-pair{ grid-template-columns:1fr 1fr; } }
        .sg-feature{ position:relative; overflow:hidden; border-radius:.9rem; padding:.95rem 1rem;
            color:#fff; isolation:isolate; display:grid; gap:.5rem; align-content:start;
            background:
                radial-gradient(120% 140% at 10% 0%, color-mix(in srgb, var(--accent) 90%, #fff 10%), transparent 60%),
                linear-gradient(135deg, color-mix(in srgb, var(--accent) 92%, #000 8%),
                                        color-mix(in srgb, var(--accent) 55%, #000 45%));
            box-shadow:0 1px 0 0 rgb(255 255 255 / .18) inset, 0 14px 34px -18px rgb(0 0 0 / .7); }
        /* The day's leg is the lighter of the two so the pair reads as a pair
           rather than as two of the same tile printed twice. */
        .sg-feature-day{ background:
                radial-gradient(120% 140% at 10% 0%, color-mix(in srgb, var(--accent) 70%, #fff 30%), transparent 60%),
                linear-gradient(135deg, color-mix(in srgb, var(--accent) 74%, #000 26%),
                                        color-mix(in srgb, var(--accent) 40%, #000 60%)); }
        .sg-feature::after{ content:''; position:absolute; inset:0; z-index:0; pointer-events:none; opacity:.14;
            background-image:repeating-linear-gradient(68deg, rgb(255 255 255 / .5) 0 1px, transparent 1px 10px);
            mask-image:radial-gradient(120% 120% at 85% 15%, #000, transparent 70%); }
        .sg-feature > *{ position:relative; z-index:1; }
        .sg-feature-kicker{ font-size:.64rem; font-weight:800; letter-spacing:.14em; text-transform:uppercase;
            opacity:.82; display:flex; align-items:center; gap:.35rem; }
        .sg-feature-kicker i{ width:.85rem; height:.85rem; }
        .sg-pair{ display:flex; align-items:center; gap:.5rem; font-size:1.35rem; font-weight:800;
            letter-spacing:-.02em; line-height:1; }
        .sg-pair i{ width:1rem; height:1rem; opacity:.75; }
        .sg-feature-sub{ font-size:.78rem; opacity:.85; }
        .sg-feature-foot{ display:flex; align-items:center; gap:.4rem; flex-wrap:wrap; margin-top:.15rem; }
        .sg-tag{ font-size:.66rem; font-weight:700; letter-spacing:.03em; padding:.2rem .5rem;
            border-radius:999px; background:rgb(255 255 255 / .16); white-space:nowrap; }
        .sg-tag-lock{ background:rgb(0 0 0 / .3); }
        /* ---- THE SHORT LIST --------------------------------------------- */
        .sg-list{ display:grid; gap:.45rem; }
        .sg-item-wrap{ display:grid; gap:.2rem; }
        .sg-item{ display:flex; align-items:flex-start; gap:.75rem; width:100%; text-align:left;
            padding:.7rem .8rem; border-radius:.7rem; cursor:pointer; font:inherit; color:inherit;
            border:1px solid var(--line,#e5e5e5); background:var(--surface,#fff);
            transition:border-color .16s ease, transform .16s cubic-bezier(.22,1.12,.36,1); }
        .sg-item:hover{ border-color:color-mix(in srgb, var(--accent) 45%, transparent); transform:translateY(-1px); }
        .sg-item-main{ flex:1; min-width:0; display:grid; gap:.22rem; }
        .sg-item-pair{ font-weight:700; letter-spacing:-.01em; display:flex; align-items:center;
            gap:.4rem; flex-wrap:wrap; }
        .sg-item-pair i{ width:.8rem; height:.8rem; opacity:.5; }
        .sg-item-sub{ font-size:.74rem; color:var(--muted,#736E64); }
        .sg-whys{ display:flex; flex-wrap:wrap; gap:.3rem; margin-top:.15rem; }
        .sg-why{ font-size:.7rem; font-weight:650; padding:.16rem .45rem; border-radius:999px;
            display:inline-flex; align-items:center; gap:.28rem;
            background:color-mix(in srgb, var(--ink,#1C1A16) 6%, transparent); color:var(--muted,#736E64); }
        .sg-why i{ width:.75rem; height:.75rem; }
        /* ATC is the reason people actually act on, so it is the only one that
           gets a colour. If everything is highlighted, nothing is. */
        .sg-why-atc{ background:color-mix(in srgb, #16A34A 18%, transparent); color:#15803D; }
        .sg-why-traffic{ background:color-mix(in srgb, var(--accent) 15%, transparent);
            color:color-mix(in srgb, var(--accent) 80%, var(--ink,#1C1A16)); }
        .sg-why-new{ background:color-mix(in srgb, var(--ink,#1C1A16) 8%, transparent); }
        .sg-item-num{ flex:none; text-align:right; font-size:.72rem; color:var(--faint,#A8A296);
            font-variant-numeric:tabular-nums; }
        .sg-item-num b{ display:block; font-size:.82rem; font-weight:700; color:var(--ink,#1C1A16); }
        .sg-locked{ opacity:.6; }
        /* ---- THE ONE STAFF CONTROL --------------------------------------
           Pinning is offered ON a suggestion rather than behind a route
           picker, because staff reading this panel are already looking at a
           scored list of their own network. There is no better picker than
           that, and building a second one would be building a worse one. */
        .sg-pin{ display:flex; gap:.3rem; flex-wrap:wrap; margin-top:.35rem; }
        .sg-pin button{ font:inherit; font-size:.68rem; font-weight:700; cursor:pointer;
            padding:.2rem .5rem; border-radius:999px; color:var(--muted,#736E64);
            border:1px dashed var(--line,#e5e5e5); background:none; }
        .sg-pin button:hover{ border-style:solid; border-color:var(--accent); color:var(--accent); }
        .sg-pin button[disabled]{ opacity:.5; cursor:default; }
        /* The tile fills its grid cell; the control floats on it. Absolute so
           adding it cannot change the height of one tile and not the other,
           which would break the pair. */
        .sg-feature-wrap{ position:relative; display:grid; }
        .sg-unpin{ position:absolute; top:.6rem; right:.6rem; z-index:2;
            font:inherit; font-size:.64rem; font-weight:700; cursor:pointer; color:#fff;
            padding:.2rem .5rem; border-radius:999px; border:1px solid rgb(255 255 255 / .3);
            background:rgb(0 0 0 / .28); }
        .sg-unpin:hover{ background:rgb(0 0 0 / .45); }
        /* ---- WHAT WE THINK YOU FLY -------------------------------------- */
        .sg-you{ font-size:.76rem; color:var(--muted,#736E64); line-height:1.5;
            padding:.6rem .75rem; border-radius:.6rem;
            background:color-mix(in srgb, var(--ink,#1C1A16) 3%, transparent); }
        .sg-you b{ color:var(--ink,#1C1A16); font-weight:700; }
        .sg-live{ display:flex; align-items:center; gap:.35rem; font-size:.7rem;
            color:var(--muted,#736E64); }
        .sg-live i{ width:.8rem; height:.8rem; }
        .sg-dot{ width:.45rem; height:.45rem; border-radius:999px; background:#16A34A; flex:none; }
        /* ---- THE IN-PAGE STRIP ------------------------------------------
           The same two features, on the pilot's home, above the fold. The
           panel is where somebody goes to browse; the strip is what catches
           them on the way past. */
        .sg-strip{ display:grid; gap:.7rem; }
        .sg-strip-more{ display:flex; align-items:center; justify-content:space-between; gap:.75rem; }
        `);
    }

    /* =====================================================================
     * READING
     * =================================================================== */

    async function load() {
        S.loading = true; S.error = null;
        draw();
        try {
            // The live picture first, so its ICAOs travel WITH the request
            // rather than forcing a second one. It is bounded by its own
            // timeout and can only ever resolve — see live().
            const picture = await live();
            S.data = await S.api(`/suggestions?limit=6${busyQuery(picture)}`);
            S.live = picture;
        } catch (err) {
            S.error = err;
        }
        S.loading = false;
        draw();
        repaint();
    }

    /* =====================================================================
     * DRAWING
     * =================================================================== */

    function draw() {
        if (!S.panel || !S.panel.isOpen()) return;
        P.keepPlace(S.panel.body, () => {
            S.panel.body.innerHTML = bodyHtml();
            try { icons(); } catch (_) {}
        });
    }

    function bodyHtml() {
        if (S.loading && !S.data) {
            return `<p class="cp-note" style="text-align:center;padding:2rem 0">Looking at the network…</p>`;
        }
        if (S.error && !S.data) return errorHtml(S.error);
        if (!S.data) return '';

        const d = S.data;
        const rows = Array.isArray(d.suggestions) ? d.suggestions : [];
        if (!d.network) {
            return `<div class="cp-empty"><i data-lucide="route"></i>
                This airline has not published any routes yet. Once your staff add some,
                this is where you will be told which to fly.</div>`;
        }

        return `<div class="sg-wrap">
            ${featuresHtml(d)}
            ${liveHtml()}
            <div>
                <div class="sg-h" style="margin-bottom:.45rem">For you</div>
                ${rows.length
                    ? `<div class="sg-list">${rows.map(itemHtml).join('')}</div>`
                    : `<div class="cp-empty"><i data-lucide="compass"></i>Nothing to suggest right now.</div>`}
            </div>
            ${youHtml(d.profile)}
        </div>`;
    }

    function errorHtml(err) {
        if (err && err.status === 404) return P.notBuiltHtml('Suggestions');
        if (P.isSchemaGap(err)) return P.schemaGapHtml(err);
        return `<div class="cp-empty"><i data-lucide="cloud-off"></i>
            ${esc((err && err.message) || 'Could not work out what to suggest.')}
            <div style="margin-top:.9rem"><button class="cp-btn" data-sg-retry>Try again</button></div>
        </div>`;
    }

    /* ---- The two features ----------------------------------------------- */

    function featuresHtml(d) {
        const tiles = [
            featureHtml(d.day, 'day'),
            featureHtml(d.week, 'week'),
        ].filter(Boolean);
        if (!tiles.length) return '';
        return `<div class="sg-feature-pair">${tiles.join('')}</div>`;
    }

    const FEATURE = {
        day: { kicker: 'Route of the day', icon: 'sun' },
        week: { kicker: 'Route of the week', icon: 'calendar-days' },
    };

    function featureHtml(f, period) {
        if (!f || !f.route) return '';
        const r = f.route;
        const meta = FEATURE[period] || FEATURE.week;
        const bits = [r.flightNumber, r.aircraft].filter(Boolean).join(' · ');
        const tags = [];
        if (f.estimatedMin) tags.push(`<span class="sg-tag">${esc(durationText(f.estimatedMin))}</span>`);
        if (r.distanceNm) tags.push(`<span class="sg-tag">${Math.round(r.distanceNm).toLocaleString()} nm</span>`);
        // Staff picked this one by hand. Worth saying — it is the difference
        // between the airline choosing a leg and a rotation landing on one.
        if (f.pinned) tags.push('<span class="sg-tag">Picked by your staff</span>');
        // Staff can hand the slot back. A real button, and a SIBLING of the
        // tile rather than a child of it: a button inside a button is invalid
        // HTML, and a span dressed up as one is not reachable from a keyboard.
        // Only where there IS a pin — the rotation's own pick is not a thing
        // to undo.
        const unpin = f.pinned && S.data && S.data.canManage
            ? `<button type="button" class="sg-unpin" data-sg-unpin="${esc(period)}"
                 title="Hands the slot back to the rotation.">Unpin</button>` : '';
        if (r.locked) {
            tags.push(`<span class="sg-tag sg-tag-lock">${r.hoursUntilUnlock
                ? `Unlocks in ${Math.round(r.hoursUntilUnlock)}h` : `${esc(r.minRank || 'Locked')}`}</span>`);
        }
        return `<div class="sg-feature-wrap">
            <button type="button" class="sg-feature${period === 'day' ? ' sg-feature-day' : ''}"
                data-sg-route="${esc(r.id)}">
                <span class="sg-feature-kicker"><i data-lucide="${esc(meta.icon)}"></i> ${esc(meta.kicker)}</span>
                <span class="sg-pair">${esc(r.origin)} <i data-lucide="arrow-right"></i> ${esc(r.destination)}</span>
                ${bits ? `<span class="sg-feature-sub">${esc(bits)}</span>` : ''}
                ${tags.length ? `<span class="sg-feature-foot">${tags.join('')}</span>` : ''}
            </button>
            ${unpin}
        </div>`;
    }

    /* ---- One suggestion --------------------------------------------------- */

    const WHY_ICON = { atc: 'radio-tower', traffic: 'plane', habit: 'history', new: 'sparkles' };

    function itemHtml(s) {
        const r = s.route || {};
        const sub = [r.flightNumber, r.aircraft,
            r.distanceNm ? `${Math.round(r.distanceNm).toLocaleString()} nm` : '',
        ].filter(Boolean).join(' · ');
        const whys = (s.why || []).map((w) => `<span class="sg-why sg-why-${esc(w.tone || 'habit')}">
            <i data-lucide="${esc(WHY_ICON[w.tone] || 'circle-check')}"></i>${esc(w.text)}</span>`).join('');
        return `<div class="sg-item-wrap">
        <button type="button" class="sg-item${r.locked ? ' sg-locked' : ''}" data-sg-route="${esc(r.id)}">
            <span class="sg-item-main">
                <span class="sg-item-pair">${esc(r.origin)} <i data-lucide="arrow-right"></i> ${esc(r.destination)}
                    ${r.locked ? `<span class="cp-chip cp-chip-mute">${r.hoursUntilUnlock
                        ? `${Math.round(r.hoursUntilUnlock)}h away` : esc(r.minRank || 'Locked')}</span>` : ''}</span>
                ${sub ? `<span class="sg-item-sub">${esc(sub)}</span>` : ''}
                ${whys ? `<span class="sg-whys">${whys}</span>` : ''}
            </span>
            ${s.estimatedMin ? `<span class="sg-item-num"><b>${esc(durationText(s.estimatedMin))}</b>about</span>` : ''}
        </button>
        ${pinHtml(r)}</div>`;
    }

    /**
     * Staff only: make this the airline's leg for the day or the week.
     *
     * Outside the tile's own button rather than inside it — a button inside a
     * button is invalid HTML and behaves differently in every browser that
     * tolerates it.
     *
     * A pin lasts for the period it was set in and then lapses back to the
     * rotation. That is the server's rule (see crewFeatured.js) and it is said
     * here in the button's title, because "why did my pin disappear" is the
     * only question this control can produce.
     */
    function pinHtml(r) {
        if (!S.data || !S.data.canManage || !r || !r.id) return '';
        const isDay = S.data.day && S.data.day.route && String(S.data.day.route.id) === String(r.id);
        const isWeek = S.data.week && S.data.week.route && String(S.data.week.route.id) === String(r.id);
        return `<div class="sg-pin">
            <button type="button" data-sg-pin="day" data-sg-id="${esc(r.id)}" ${isDay ? 'disabled' : ''}
                title="Makes this today's route for the whole airline. It goes back to the rotation tomorrow.">
                ${isDay ? '✓ Today’s route' : 'Make it today’s'}</button>
            <button type="button" data-sg-pin="week" data-sg-id="${esc(r.id)}" ${isWeek ? 'disabled' : ''}
                title="Makes this the airline's route this week. It goes back to the rotation on Monday.">
                ${isWeek ? '✓ This week’s route' : 'Make it this week’s'}</button>
        </div>`;
    }

    /* ---- The two sentences that make the rest make sense ------------------ */

    function liveHtml() {
        if (!S.live || !S.live.atc || !S.live.atc.length) return '';
        const n = S.live.atc.length;
        return `<div class="sg-live"><span class="sg-dot"></span>
            ${n} ${n === 1 ? 'field is' : 'fields are'} being controlled right now${S.live.server
                ? ` on ${esc(S.live.server)}` : ''} — legs into them are pushed up this list.</div>`;
    }

    /**
     * What we think this pilot flies, said out loud.
     *
     * A recommendation whose basis is invisible is a recommendation nobody
     * trusts, and this is the one line that turns "why is it showing me this"
     * into "yes, that is what I fly". It also makes the feature's one real
     * failure mode — a profile built on somebody's odd fortnight — visible to
     * the person best placed to notice it.
     */
    function youHtml(p) {
        if (!p) return '';
        if (!p.confident) {
            return `<p class="sg-you">${p.flights
                ? `You have ${p.flights} approved ${p.flights === 1 ? 'flight' : 'flights'} on the books.
                   A few more and these start matching how you actually fly.`
                : `Once your flights start being approved, these start matching how you actually fly —
                   your usual leg length, your aeroplane, the fields you know.`}</p>`;
        }
        const lean = p.lean === 'long' ? 'long haul'
            : p.lean === 'short' ? 'short hops' : 'medium sectors';
        const bits = [`You mostly fly <b>${esc(lean)}</b>`];
        if (p.typicalMin) bits.push(`about <b>${esc(durationText(p.typicalMin))}</b> at a time`);
        if (p.aircraft && p.aircraft[0]) bits.push(`usually on the <b>${esc(p.aircraft[0].value)}</b>`);
        if (p.airports && p.airports[0]) bits.push(`out of <b>${esc(p.airports[0].value)}</b>`);
        return `<p class="sg-you">${bits.join(', ')}. That is what the list above is matched against —
            ${p.flights} approved ${p.flights === 1 ? 'flight' : 'flights'}.</p>`;
    }

    /* =====================================================================
     * THE STRIP
     *
     * The same two features, on the pilot's home. Draws NOTHING — not a
     * spinner, not an empty frame — until the fetch has landed and there is a
     * leg to name: a VA with no published routes must not have a hole in its
     * pilot home where this would go.
     * =================================================================== */

    function repaint() {
        S.hosts = S.hosts.filter((h) => h.isConnected);
        S.hosts.forEach(paint);
    }

    function paint(host) {
        const d = S.data;
        const has = d && (d.day || d.week);
        if (!has) { host.innerHTML = ''; host.classList.add('cp-hidden'); return; }
        host.classList.remove('cp-hidden');
        const n = (d.suggestions || []).length;
        host.innerHTML = `<div class="sg-strip">
            ${featuresHtml(d)}
            <div class="sg-strip-more">
                ${liveHtml() || '<span class="cp-note">Picked from your airline’s own network.</span>'}
                <button class="cp-btn cp-btn-sm" data-sg-open>
                    <i data-lucide="compass"></i> ${n ? `${n} more for you` : 'What should I fly?'}
                </button>
            </div>
        </div>`;
        if (!host.dataset.sgWired) {
            host.dataset.sgWired = '1';
            host.addEventListener('click', (ev) => {
                if (ev.target.closest('[data-sg-open]')) { open({ api: S.api }); return; }
                const go = ev.target.closest('[data-sg-route]');
                if (go) openRoute(go.getAttribute('data-sg-route'));
            });
        }
        try { icons(); } catch (_) {}
    }

    /* =====================================================================
     * WIRING
     * =================================================================== */

    function openRoute(id) {
        if (typeof S.onOpenRoute === 'function') { S.onOpenRoute(id); return; }
        // No handler: the network panel is the natural home for a route, and
        // opening it is better than a dead tile. Where that is not on the page
        // either, do nothing rather than navigate somebody away.
        if (window.CrewNetwork && typeof CrewNetwork.open === 'function') {
            CrewNetwork.open({ api: S.api });
        }
    }

    /**
     * Pin a leg, or hand the slot back.
     *
     * The server answers with both features as they now stand, so the two
     * tiles are repainted from what it decided rather than from what this
     * asked for — a pin that was refused (a draft, a leg since deleted) must
     * not leave a tile claiming it took.
     */
    async function pin(period, routeId, btn) {
        const done = btn ? P.busy(btn, false) : () => {};
        try {
            const d = await S.api('/featured-routes', {
                method: 'POST', body: { [period]: routeId || '' },
            });
            if (S.data) { S.data.day = d.day; S.data.week = d.week; }
            draw();
            repaint();
            P.toast(routeId
                ? `Pinned as ${period === 'day' ? 'today’s' : 'this week’s'} route.`
                : 'Back on the rotation.', 'ok');
        } catch (err) {
            P.toast((err && err.message) || 'That didn’t work.', 'bad');
        } finally { done(); }
    }

    function wire(panel) {
        if (panel.el.dataset.sgWired) return;
        panel.el.dataset.sgWired = '1';
        panel.el.addEventListener('click', (ev) => {
            if (ev.target.closest('[data-sg-retry]')) { load(); return; }
            const unpin = ev.target.closest('[data-sg-unpin]');
            if (unpin) {
                // Inside a feature tile, which is itself a button. Stopping
                // here is what keeps "unpin" from also meaning "open the route".
                ev.preventDefault(); ev.stopPropagation();
                pin(unpin.getAttribute('data-sg-unpin'), '', unpin);
                return;
            }
            const set = ev.target.closest('[data-sg-pin]');
            if (set) {
                pin(set.getAttribute('data-sg-pin'), set.getAttribute('data-sg-id'), set);
                return;
            }
            const go = ev.target.closest('[data-sg-route]');
            if (go) { openRoute(go.getAttribute('data-sg-route')); }
        });
    }

    /* =====================================================================
     * PUBLIC
     * =================================================================== */

    /**
     * Paint the featured pair into a page.
     *
     * Same contract as CrewShop.mountCard: hidden until there is something
     * true to say, and silent when there is not.
     */
    function mountStrip(host, { api, onOpenRoute } = {}) {
        if (!host || typeof api !== 'function') return;
        styles();
        S.api = api;
        if (onOpenRoute) S.onOpenRoute = onOpenRoute;
        host.classList.add('cp-hidden');
        if (S.hosts.indexOf(host) === -1) S.hosts.push(host);
        if (S.data) { paint(host); return; }
        live()
            .then((picture) => { S.live = picture; return S.api(`/suggestions?limit=6${busyQuery(picture)}`); })
            .then((d) => { S.data = d; repaint(); })
            .catch(() => { /* no routes, no strip, no noise */ });
    }

    function open({ api, onOpenRoute } = {}) {
        if (typeof api !== 'function') { console.warn('crewSuggestions: needs an api function'); return; }
        styles();
        S.api = api;
        if (onOpenRoute) S.onOpenRoute = onOpenRoute;
        if (!S.panel) {
            S.panel = P.sheet({ id: 'crewSuggestions', title: 'What to fly', icon: 'compass' });
            wire(S.panel);
        }
        S.panel.open();
        draw();
        load();
    }

    window.CrewSuggestions = {
        open,
        close: () => S.panel && S.panel.close(),
        mountStrip,
        /* So a page that already has the live picture — the tracker itself —
           can hand it over instead of making this look for it. */
        live,
    };
})();
