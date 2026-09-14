/* ============================================================================
   crew-feed.js — put your crew center's own data on your own website.

   THE PROBLEM THIS SOLVES

   A virtual airline runs on its crew center: routes are added there, pilots
   join there, hours accrue there. The airline's public website then states the
   same facts a second time, typed in by hand — twenty-three destinations, four
   hundred pilots — and from that moment the two disagree. Every sector added
   and every pilot who joins widens the gap, and it is always the website that
   is wrong, because it is the copy nobody remembers to edit.

   The embeds (/embed-crew.html) answer that with an iframe: our markup, our
   look, dropped into their page. That is the right answer for a VA who wants a
   noticeboard on a Wix site and is done in a minute.

   It is the wrong answer for a VA that has built its own site and wants the
   figures in ITS typography, inside ITS layout, on ITS grid. That is what this
   file is: the same public data, handed over as plain JSON with no markup and
   no styling attached, plus a small declarative helper for the common case.

   USING IT

     <script src="https://inflight.info/crew-feed.js" data-va="ocean-virtual"></script>

   Then either read it yourself:

     const routes = await CrewFeed.routes();      // [] of sectors, or null
     const figures = await CrewFeed.stats();      // { pilots, hours, … } or null
     const wall = await CrewFeed.posts();         // [] of Instagram posts, or null
     const pulse = await CrewFeed.activity();     // [] of what the airline did

   The full set: routes, network, stats, events, schedule, notices, activity,
   posts, handle, brand, ranks, fleet, roles, staff, roster, hubs, partners.

   `roles` is the airline's DEPARTMENTS and `staff` is the PEOPLE holding them
   — name, rank, Community handle, and the short word the role carries.

   `hubs` and `partners` are WORKED OUT from the route map rather than stored
   anywhere — a route map already knows which airports carry the most sectors
   and which of those are flown with somebody else — so neither can go stale,
   which is the whole point of this file.

   `fleet` guarantees a picture for every aircraft: the airline's own livery
   upload where there is one, and a silhouette this file DRAWS where there is
   not. It carries the credit that goes with the picture, because a photograph
   we show is a photograph we credit.

   `notices` is the noticeboard as the crew center reads it;
   `notices({written:true})` is only what a person typed, and `activity()` only
   what the crew center recorded happening. Those two halves want different
   places on a page, which is why they are separate calls over one fetch.

   …or mark up the page and let it fill in the numbers:

     <p><b data-crew-stat="pilots">—</b> pilots</p>

   THE RULE, IN EVERY FUNCTION HERE

   The page must already be correct before this script runs.

   Every reader resolves to `null` on any failure — offline, slow, backend down,
   endpoint changed, VA not found — and never throws. A caller treats null as
   "leave what is already on the page". That is what keeps a website from going
   blank because a fetch timed out, and it is why nothing here is allowed to be
   the only source of a section.

   And ABSENT IS NOT ZERO. A figure the crew center did not send is a figure we
   did not learn. It is left out — the element is removed — rather than printed
   as 0. A website that prints a made-up number in big numerals next to true
   ones is worse than one that prints nothing: it reads as authoritative.

   No dependencies, no build step, no key. Every endpoint it reads is public and
   CORS-open — the same ones a visitor to the crew center reads. Writes are not
   possible from here at all.
   ========================================================================== */

(function () {
    'use strict';

    var DEFAULT_BACKEND = 'https://site--indgo-backend--6dmjph8ltlhv.code.run';

    var CFG = {
        va: '',
        backend: DEFAULT_BACKEND,
        timeout: 8000,
    };

    // Read the configuration off our own <script> tag, so the common case is
    // one line of HTML and no JavaScript at all.
    (function readTag() {
        var el = document.currentScript;
        if (!el) {
            var all = document.getElementsByTagName('script');
            for (var i = all.length - 1; i >= 0; i--) {
                if (/crew-feed\.js/.test(all[i].src || '')) { el = all[i]; break; }
            }
        }
        if (!el) return;
        CFG.va = String(el.getAttribute('data-va') || el.getAttribute('data-slug') || '').trim().toLowerCase();
        var b = String(el.getAttribute('data-backend') || '').trim();
        if (b) CFG.backend = b.replace(/\/+$/, '');
        var t = parseInt(el.getAttribute('data-timeout'), 10);
        if (isFinite(t) && t > 0) CFG.timeout = t;
        // Opt out of the automatic pass when a page wants to drive it by hand.
        CFG.auto = el.getAttribute('data-auto') !== 'off';
    })();

    function configure(opts) {
        if (!opts) return CFG;
        if (opts.va != null) CFG.va = String(opts.va).trim().toLowerCase();
        if (opts.backend) CFG.backend = String(opts.backend).replace(/\/+$/, '');
        if (opts.timeout) CFG.timeout = Number(opts.timeout) || CFG.timeout;
        return CFG;
    }

    /* ---------------------------------------------------------------------
     * One GET, JSON, never throws.
     *
     * Memoised for the life of the page: three sections reading `stats` is one
     * request, not three. The memo holds the PROMISE rather than the result, so
     * three synchronous calls in the same tick still share a single fetch.
     * ------------------------------------------------------------------- */
    var memo = {};

    function get(path) {
        if (memo[path]) return memo[path];
        var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
        var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, CFG.timeout);
        var opts = { headers: { Accept: 'application/json' }, credentials: 'omit' };
        if (ctrl) opts.signal = ctrl.signal;

        memo[path] = fetch(CFG.backend + path, opts)
            .then(function (res) { return res.ok ? res.json() : null; })
            .catch(function () { return null; })
            .then(function (d) { clearTimeout(timer); return d; });
        return memo[path];
    }

    /** Forget everything read so far — the next call goes back to the network. */
    function refresh() { memo = {}; return CrewFeed; }

    function crew(path) {
        if (!CFG.va) return Promise.resolve(null);
        return get('/api/crew/' + encodeURIComponent(CFG.va) + path);
    }

    var num = function (v) { return v != null && isFinite(Number(v)) ? Number(v) : undefined; };
    var text = function (v) { return String(v == null ? '' : v).trim(); };
    var icao = function (v) { return text(v).toUpperCase(); };
    var https = function (v) { return /^https:\/\//i.test(text(v)) ? text(v) : ''; };
    // One row built from a shared half and a specific half. Written out rather
    // than Object.assign because everything else in this file is ES5 and a
    // single modern call would decide, silently, which browsers a VA's public
    // website works in.
    var assign = function (a, b) {
        var out = {}, k;
        for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) out[k] = a[k];
        for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) out[k] = b[k];
        return out;
    };

    /* =====================================================================
     * ROUTES
     *
     * GET /api/crew/<slug>/routes
     *
     * The published network. Sectors staff have switched off are dropped —
     * `active` is only tested when the field is present, so a route saved
     * before that column existed is published rather than silently lost — and
     * so is anything without both ends, which cannot be drawn or flown.
     *
     * An empty list is a real answer and still resolves to null: a VA that has
     * not filled its crew center in yet should keep whatever its own site
     * already says, not have its network page emptied by ours.
     * =================================================================== */
    function routes(opts) {
        opts = opts || {};
        return crew('/routes').then(function (d) {
            if (!d || !Array.isArray(d.routes)) return null;
            var out = d.routes
                .filter(function (r) { return r && r.origin && r.destination; })
                .filter(function (r) { return opts.includeInactive ? true : r.active !== false; })
                .map(function (r) {
                    return {
                        from: icao(r.origin),
                        to: icao(r.destination),
                        flight: text(r.flightNumber),
                        aircraft: text(r.aircraft),
                        distanceNm: num(r.distanceNm) || 0,
                        notes: text(r.notes),
                        // A codeshare is a partner's metal. Carried through so a
                        // site can mark it as one; a network that draws someone
                        // else's sectors as its own overstates the airline.
                        codeshare: r.kind === 'codeshare',
                        partner: text(r.partnerName),
                        partnerLogo: https(r.partnerLogo),
                        minRank: text(r.minRank),
                        active: r.active !== false,
                        id: r.id != null ? String(r.id) : '',
                    };
                });
            if (opts.kind === 'own') out = out.filter(function (r) { return !r.codeshare; });
            if (opts.kind === 'codeshare') out = out.filter(function (r) { return r.codeshare; });
            if (opts.limit) out = out.slice(0, Number(opts.limit));
            return out.length ? out : null;
        });
    }

    /* =====================================================================
     * NETWORK — routes with coordinates
     *
     * GET /api/crew/<slug>/route-map
     *
     * The same sectors, already joined to aerodrome reference points, plus the
     * airports themselves with how many sectors touch each. This is what a site
     * needs to DRAW the network: a route whose airports it has no coordinates
     * for can only be left off, and an airline that adds a destination its
     * website has never heard of should still see it on the map.
     *
     * `unmapped` is the count the backend could not place. Say it rather than
     * quietly drawing a smaller network than the one listed underneath.
     * =================================================================== */
    function network() {
        return crew('/route-map').then(function (d) {
            if (!d || !Array.isArray(d.routes)) return null;
            var airports = {};
            (Array.isArray(d.airports) ? d.airports : []).forEach(function (a) {
                if (!a || a.lat == null || a.lon == null) return;
                airports[icao(a.icao)] = {
                    icao: icao(a.icao),
                    lat: Number(a.lat),
                    lon: Number(a.lon),
                    departures: num(a.dep) || 0,
                    arrivals: num(a.arr) || 0,
                    routes: num(a.routes) || 0,
                };
            });
            var legs = d.routes
                .filter(function (r) { return r && r.mapped && r.o && r.d; })
                .filter(function (r) { return r.active !== false; })
                .map(function (r) {
                    return {
                        from: icao(r.origin), to: icao(r.destination),
                        fromLatLon: [Number(r.o[0]), Number(r.o[1])],
                        toLatLon: [Number(r.d[0]), Number(r.d[1])],
                        flight: text(r.flightNumber),
                        aircraft: text(r.aircraft),
                        distanceNm: num(r.distanceNm) || 0,
                        codeshare: r.kind === 'codeshare',
                        partner: text(r.partnerName),
                    };
                });
            if (!legs.length && !Object.keys(airports).length) return null;
            return {
                routes: legs,
                airports: airports,
                unmapped: num(d.stats && d.stats.unmapped) || 0,
            };
        });
    }

    /* =====================================================================
     * STATS
     *
     * GET /api/crew/<slug>/stats
     *
     * The airline's figures, aggregated inside the airline's own database and
     * returned as one small object. Nothing here ever pulls a roster of people
     * down to count them.
     *
     * Resolves to null when the request failed, when the VA has not connected a
     * data store, or when every figure it holds is absent or zero — a crew
     * center nobody has flown in yet has nothing to say, and "0 pilots, 0
     * hours" in 48px numerals next to genuinely impressive facts is not the way
     * to say it. A zero among real figures is a true answer and is kept.
     * =================================================================== */
    function stats() {
        return crew('/stats').then(function (d) {
            if (!d || !d.stats || d.connected === false) return null;
            var s = d.stats;
            var pick = function () {
                for (var i = 0; i < arguments.length; i++) {
                    var v = num(arguments[i]);
                    if (v !== undefined) return v;
                }
                return undefined;
            };
            var round = function (v) { return v === undefined ? undefined : Math.round(v); };
            var figures = {
                pilots: pick(s.pilots),
                pilotsActive: pick(s.pilotsActive),
                // Credited roster hours — the figure the rank ladder is read
                // against. `flightHours` is the total on approved reports; the
                // two part company when staff hand-adjust a pilot's total.
                hours: round(pick(s.hours)),
                flightHours: round(pick(s.flightHours)),
                pireps: pick(s.pirepsApproved, s.pireps),
                pirepsPending: pick(s.pirepsPending),
                flights30d: pick(s.flights30d),
                flightHours30d: round(pick(s.flightHours30d)),
                landings: pick(s.landings),
                destinations: pick(s.destinations),
                routesActive: pick(s.routesActive),
                lastFlightAt: s.lastFlightAt || null,
            };

            var anything = Object.keys(figures).some(function (k) {
                return typeof figures[k] === 'number' && figures[k] > 0;
            });
            return anything ? figures : null;
        });
    }

    /* =====================================================================
     * EVENTS, SCHEDULE, NOTICES
     *
     * The three feeds the iframe widgets show, in the same shape, for a site
     * that would rather render them itself. Drafts never reach an
     * unauthenticated caller; cancelled events do, and are dropped here,
     * because a public calendar is a list of things you can turn up to.
     * =================================================================== */
    function events(opts) {
        opts = opts || {};
        var limit = Number(opts.limit) || 12;
        var past = !!opts.past;
        return crew('/events').then(function (d) {
            if (!d || !Array.isArray(d.events)) return null;
            // Six hours of grace, the same the crew center uses, so an event
            // under way is still listed as one you can join.
            var grace = Date.now() - 6 * 60 * 60 * 1000;
            var rows = d.events
                .filter(function (e) { return e && e.status === 'published' && e.startsAt; })
                .filter(function (e) {
                    var t = new Date(e.startsAt).getTime();
                    return past ? t <= grace : t > grace;
                })
                .sort(function (a, b) {
                    return past ? new Date(b.startsAt) - new Date(a.startsAt)
                                : new Date(a.startsAt) - new Date(b.startsAt);
                })
                .slice(0, limit)
                .map(function (e) {
                    return {
                        title: text(e.title),
                        description: text(e.description),
                        startsAt: e.startsAt,
                        from: icao(e.origin), to: icao(e.destination),
                        aircraft: text(e.aircraft),
                        server: text(e.server),
                        gate: icao(e.gateIcao),
                        slots: num(e.slots) || 0,
                        // Attendance rides along only when the backend counted
                        // it. "0 going" under an event nobody has counted is
                        // the kind of wrong that puts people off coming.
                        going: num(e.going),
                        seatsLeft: num(e.seatsLeft),
                        banner: https(e.bannerUrl),
                    };
                })
                .filter(function (e) { return e.title; });
            return rows.length ? rows : null;
        });
    }

    function schedule(opts) {
        opts = opts || {};
        var limit = Number(opts.limit) || 20;
        return crew('/schedules').then(function (d) {
            if (!d || !Array.isArray(d.schedules)) return null;
            var rows = d.schedules
                .filter(function (r) { return r && r.status !== 'draft'; })
                .slice(0, limit)
                .map(function (r) {
                    return {
                        flight: text(r.flightNumber),
                        from: icao(r.origin), to: icao(r.destination),
                        departsAt: r.departsAt || null,
                        arrivesAt: r.arrivesAt || null,
                        aircraft: text(r.aircraft),
                        minRank: text(r.minRank),
                        seatsLeft: num(r.seatsLeft),
                        full: !!r.full,
                        cancelled: r.status === 'cancelled',
                    };
                });
            return rows.length ? rows : null;
        });
    }

    function notices(opts) {
        opts = opts || {};
        var limit = Number(opts.limit) || 8;
        return crew('/announcements').then(function (d) {
            if (!d || !Array.isArray(d.announcements)) return null;
            var rows = d.announcements
                .filter(function (n) {
                    if (!n || n.status === 'draft' || !text(n.title)) return false;
                    // Opt-in: `notices()` keeps returning the board as it reads
                    // on the crew center — written rows and automatic ones
                    // together — because that is what every page using it today
                    // already prints. `{ written: true }` narrows it to what a
                    // person actually typed, leaving the pulse to activity().
                    return opts.written ? !n.auto : true;
                })
                .slice(0, limit)
                .map(function (n) {
                    return {
                        title: text(n.title),
                        body: text(n.body),
                        pinned: !!n.pinned,
                        createdAt: n.createdAt || null,
                    };
                });
            return rows.length ? rows : null;
        });
    }

    /* =====================================================================
     * ACTIVITY
     *
     * GET /api/crew/<slug>/announcements   (the same fetch `notices` uses)
     *
     * The noticeboard carries two kinds of row. A human writes one — "Winter
     * schedule is up, bids close Friday". The crew center writes the other,
     * with `auto: true`: a pilot joined, somebody made Captain, an event was
     * published, a schedule went up. `notices` above returns the first kind
     * plus the second, undifferentiated, because that is what a noticeboard
     * is when you are standing in front of it.
     *
     * On a public website they are not the same thing at all. The written
     * notice is an announcement and wants a headline. The automatic row is a
     * pulse — proof that the airline is being flown this week rather than
     * described — and wants a ticker. So this returns only the automatic ones,
     * and `notices({ written: true })` returns only the written ones, and a
     * page can put each where it belongs.
     *
     * NOTHING HERE IS A NAME YOU DID NOT ALREADY PUBLISH. The rows carry the
     * roster name the crew center shows on its own public noticeboard and
     * nothing more — no email, no application, no IFC handle the pilot did not
     * put on their profile. If a VA would rather its website not carry even
     * that, the answer is to not mark the page up for it; there is no filter
     * here that can put a name back once a site has printed it.
     * =================================================================== */
    function activity(opts) {
        opts = opts || {};
        var limit = Number(opts.limit) || 8;
        var kind = text(opts.kind);
        return crew('/announcements').then(function (d) {
            if (!d || !Array.isArray(d.announcements)) return null;
            var rows = d.announcements
                .filter(function (n) {
                    if (!n || n.status === 'draft' || !text(n.title)) return false;
                    if (!n.auto) return false;
                    return kind ? String(n.kind || '') === kind : true;
                })
                .slice(0, limit)
                .map(function (n) {
                    return {
                        title: text(n.title),
                        body: text(n.body),
                        // 'joined', 'promotion', 'checkride', 'event',
                        // 'schedule' — whatever the crew center recorded. A site
                        // that wants one sort of row asks for it by name; one
                        // that wants an icon per sort keys off this.
                        kind: text(n.kind),
                        createdAt: n.createdAt || null,
                    };
                });
            return rows.length ? rows : null;
        });
    }

    /* =====================================================================
     * POSTS — the Instagram wall
     *
     * GET /api/crew/<slug>/social  →  { handle, posts: [{kind, code, url,
     *                                   embedUrl}] }
     *
     * The posts the VA's staff hung on their crew center, handed over so the
     * airline's own site can hang the same wall. There is no Graph API here
     * and no token to keep alive: a single Instagram post embeds with nothing
     * but its shortcode, which is why the crew center stores chosen posts
     * rather than pulling a profile feed.
     *
     * THE ADDRESS IS REBUILT HERE TOO, from `code` and `kind`, even though the
     * backend already sent a `url` and an `embedUrl` it had itself assembled
     * from a closed alphabet. That is not distrust of the backend — it is that
     * this file's whole promise is that a page which drops it in cannot be made
     * to frame something hostile, and a promise that depends on a service
     * across the network continuing to behave is not one this file can keep on
     * its own. `code` is checked against [A-Za-z0-9_-] before it is used.
     *
     * Returns null — not [] — when there is no wall, so a site's own markup
     * survives a VA that has not set one up. See the rule at the top.
     * =================================================================== */
    var POST_KINDS = { p: 1, reel: 1, tv: 1 };

    function posts(opts) {
        opts = opts || {};
        var limit = Number(opts.limit) || 12;
        return crew('/social').then(function (d) {
            if (!d || !Array.isArray(d.posts)) return null;
            var handle = text(d.handle);
            var rows = d.posts
                .filter(function (p) {
                    return p && POST_KINDS[p.kind] && /^[A-Za-z0-9_-]{1,64}$/.test(String(p.code || ''));
                })
                .slice(0, limit)
                .map(function (p) {
                    return {
                        kind: p.kind,
                        code: p.code,
                        handle: handle,
                        url: 'https://www.instagram.com/' + p.kind + '/' + p.code + '/',
                        embedUrl: 'https://www.instagram.com/' + p.kind + '/' + p.code + '/embed/',
                    };
                });
            return rows.length ? rows : null;
        });
    }

    /** The handle on its own, for a "follow us" line. null when unset. */
    function handle() {
        return crew('/social').then(function (d) {
            var h = d && text(d.handle);
            return h || null;
        });
    }

    /* =====================================================================
     * BRAND — the airline's identity, not its operations
     *
     * GET /api/va-ads/<slug>  →  the crew centre's own record: name, callsign,
     * tagline, logo, banner, accent, the rank ladder, the roles, the fleet, and
     * how to join.
     *
     * NOT under /api/crew/, and that is not an oversight. Everything else this
     * file reads is DATA THE VA'S CREW CENTRE PRODUCED — sectors flown, hours
     * accrued, pilots joined — and lives in the VA's own store. This is the
     * directory record: what the airline IS rather than what it has been doing.
     * Two different things, in two different places, so two paths.
     *
     * It is the same endpoint the crew centre login reads before it has a
     * session, so it is public, CORS-open and cached for five minutes. There is
     * no secret in it: the Supabase block it also carries is the ANON key, and
     * this reader drops it anyway rather than hand a website a field it has no
     * business holding.
     *
     * EVERY URL IS RE-CHECKED FOR https:. A logo goes in an `src`, and an
     * `src` is where a wrong string stops being a broken image and starts
     * being somebody else's script. `https()` is the same guard the rest of
     * this file uses.
     * =================================================================== */
    function brandRaw() {
        if (!CFG.va) return Promise.resolve(null);
        return get('/api/va-ads/by-slug/' + encodeURIComponent(CFG.va));
    }

    /* THE FLAG, FROM THE CODE.
     *
     * A country is stored as two letters and nothing else, so the flag is
     * BUILT rather than fetched: a pair of regional-indicator code points is
     * an emoji every platform already has, which means no image to host, none
     * to go missing, and nothing to get wrong about a country's borders.
     *
     * A platform that will not draw the pair (Windows, famously) shows the two
     * letters instead — which is still the country, said plainly. */
    function flagOf(cc) {
        var c = text(cc).toUpperCase();
        if (!/^[A-Z]{2}$/.test(c) || typeof String.fromCodePoint !== 'function') return '';
        return String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65, 0x1F1E6 + c.charCodeAt(1) - 65);
    }

    /* And the country's NAME from the same two letters, in the visitor's own
     * language where the browser can. Derived rather than stored so there is
     * one spelling of every country on the platform; '' where the browser is
     * too old to know, which removes the element rather than printing a code
     * at somebody. */
    function countryName(cc) {
        var c = text(cc).toUpperCase();
        if (!/^[A-Z]{2}$/.test(c)) return '';
        try { return new Intl.DisplayNames(undefined, { type: 'region' }).of(c) || ''; }
        catch (e) { return ''; }
    }

    function brand() {
        return brandRaw().then(function (d) {
            if (!d || !text(d.name)) return null;
            var join = d.join || {};
            var country = /^[A-Za-z]{2}$/.test(text(d.country)) ? text(d.country).toUpperCase() : '';
            return {
                name: text(d.name),
                code: text(d.code),
                tagline: text(d.tagline),
                // Where the airline is from: the code, the flag drawn from it,
                // and the country's name. A site's footer wants the flag and
                // the name; the code is there for anything that wants to sort
                // or group by it.
                country: country,
                flag: flagOf(country),
                countryName: countryName(country),
                // The two of them as one line — "🇲🇽 Mexico" — for the common
                // case of a footer saying where the airline is from. ONE field
                // rather than two because a page that draws them separately
                // needs two [data-crew-figure] holders to stay tidy, and a
                // browser that knows the flag but not the country's name would
                // then lose both. The code stands in for a name the browser
                // cannot supply; the flag alone stands in for a browser that
                // draws neither.
                origin: country ? (flagOf(country) + ' ' + (countryName(country) || country)).trim() : '',
                logo: https(d.logo),
                banner: https(d.banner),
                website: https(d.website),
                // '' when the VA has not chosen one — a site that wants to
                // follow the crew centre's accent can read it, and a site with
                // its own theme.css simply does not ask.
                accent: /^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(text(d.accent)) ? text(d.accent) : '',
                callsignPrefix: text(join.callsignPrefix),
                minGrade: num(join.minGrade) || 0,
                discord: https(join.discordInvite),
                // Deliberately absent: d.supabase. A public anon key is not a
                // secret, and it is still not something a marketing page has
                // any use for. Nothing that has no reason to leave gets to.
            };
        });
    }

    /* ---------------------------------------------------------------------
     * RANKS — the ladder a pilot climbs.
     *
     * The one list on a VA's website that is genuinely persuasive to somebody
     * deciding whether to apply, and the one nobody keeps up to date by hand.
     * Sorted by the hours each rank asks for, so the ladder reads upward
     * whatever order it happens to be stored in.
     * ------------------------------------------------------------------- */
    function ranks(opts) {
        opts = opts || {};
        var limit = Number(opts.limit) || 20;
        return brandRaw().then(function (d) {
            if (!d || !Array.isArray(d.ranks)) return null;
            var rows = d.ranks
                .filter(function (r) { return r && text(r.name); })
                .map(function (r) {
                    var hours = num(r.minHours);
                    return {
                        name: text(r.name),
                        hours: hours === undefined ? 0 : hours,
                        // A rank with no hours set reads as "0 hours", which is
                        // true of the first rung and misleading on any other.
                        // `from` is the human string and is left EMPTY rather
                        // than saying nothing at length.
                        from: hours ? hours.toLocaleString() + ' hours' : '',
                        color: /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text(r.color)) ? text(r.color) : '',
                        icon: text(r.icon),
                        image: https(r.image),
                    };
                })
                .sort(function (a, b) { return a.hours - b.hours; })
                .slice(0, limit);
            return rows.length ? rows : null;
        });
    }

    /* ---------------------------------------------------------------------
     * AIRCRAFT PICTURES, AND WHO THEY BELONG TO
     *
     * THE PROBLEM. A VA's fleet page is the page with the most holes in it. The
     * crew centre's fleet editor takes an optional livery image and most
     * airlines fill in two of them and stop, so a grid of twelve aircraft comes
     * out as two pictures and ten grey boxes — which reads as "this airline's
     * data is broken", not as "this airline has not uploaded ten pictures".
     *
     * THE GUARANTEE. Every aircraft gets a picture, it is available
     * synchronously, and it cannot fail to load. The picture is DRAWN here as
     * an inline SVG data URI: no network, no host, no cache, no 404, no taint,
     * nothing to block. A VA's own upload is better and is used whenever it
     * exists; this is the floor, not the ceiling.
     *
     * Note the direction. Most image code starts with the good source and falls
     * back to a placeholder; this starts with the one that cannot fail. That
     * inversion is why there is no flicker, no layout shift and no broken-image
     * glyph: the <img> is born with a valid src.
     *
     * AND CREDIT. A picture on a website belongs to whoever made it, and that
     * does not stop being true because the picture is small or because it was
     * convenient. Every row therefore carries `credit` — plain text — and
     * `creditHref` alongside the image, and the templates print it under the
     * card. A VA's OWN upload is credited to nobody, because it is theirs.
     * These outlines are ours, so they say so.
     *
     * The shapes are deliberately simple. At the size a fleet card renders one,
     * detail is noise: what a reader actually decodes is the wing planform and
     * the engine count, and those are the two things each path gets right.
     * ------------------------------------------------------------------- */

    // Matched on the canonical Infinite Flight type string the crew centre
    // stores ("Boeing 787-10 Dreamliner", "Airbus A320-200"). Order matters —
    // the first hit wins, so "747" is tested before "Boeing" and "A380" before
    // anything that merely starts with an A.
    var SHAPES = [
        [/a380|747|a340|\b380\b|\b340\b/i, 'quad'],
        [/787|777|a350|a330|767|a300|a310|md-?11|dc-?10|\b350\b|\b330\b/i, 'wide'],
        [/737|a32[0-9]|a319|a318|757|md-?8|md-?9|717|727|707|dc-?9/i, 'narrow'],
        [/crj|erj|embraer|e-?jet|dash|q400|atr|saab|dornier|f-?50|regional/i, 'regional'],
        [/c-?130|c-?17|kc-?|a400|globemaster|hercules/i, 'quad'],
        [/f-?1[456]|f-?22|f-?18|f-?35|fighter|eurofighter|tornado|hawk|a-?10/i, 'fighter'],
        [/spitfire|cessna|c-?172|c-?152|piper|cub|sr-?22|tbm|caravan|\b208\b|\b172\b/i, 'ga'],
        [/heli|ec-?135|as-?350|uh-?|ah-?|bell|copter/i, 'heli'],
    ];

    // Top-view planforms on a 120x72 viewBox, nose left.
    var PLANFORMS = {
        narrow: 'M8 36 L30 33 L52 33 L58 20 L64 20 L62 33 L84 32 L96 26 L100 27 L96 34 '
            + 'L106 35 L112 36 L106 37 L96 38 L100 45 L96 46 L84 40 L62 39 L64 52 L58 52 L52 39 L30 39 Z',
        wide: 'M6 36 L26 32 L48 32 L54 16 L62 16 L60 32 L82 31 L96 24 L102 25 L97 34 '
            + 'L110 35 L116 36 L110 37 L97 38 L102 47 L96 48 L82 41 L60 40 L62 56 L54 56 L48 40 L26 40 Z',
        quad: 'M6 36 L24 32 L46 32 L50 14 L60 14 L58 32 L80 31 L96 22 L104 23 L98 34 '
            + 'L112 35 L118 36 L112 37 L98 38 L104 49 L96 50 L80 41 L58 40 L60 58 L50 58 L46 40 L24 40 Z '
            + 'M52 22 L58 22 L57 27 L51 27 Z M52 45 L58 45 L57 50 L51 50 Z',
        regional: 'M14 36 L34 34 L56 34 L62 24 L68 24 L66 34 L86 33 L96 29 L99 30 L96 35 '
            + 'L104 36 L108 36 L104 37 L96 38 L99 42 L96 43 L86 39 L66 38 L68 48 L62 48 L56 38 L34 38 Z',
        fighter: 'M18 36 L44 34 L58 22 L66 22 L64 34 L84 33 L98 30 L102 32 L104 36 '
            + 'L102 40 L98 42 L84 39 L64 38 L66 50 L58 50 L44 38 Z',
        ga: 'M22 36 L40 34 L48 22 L54 22 L52 34 L78 33 L92 32 L96 34 L98 36 L96 38 '
            + 'L92 40 L78 39 L52 38 L54 50 L48 50 L40 38 Z',
        heli: 'M30 36 L44 33 L74 33 L88 34 L96 36 L88 38 L74 39 L44 39 Z '
            + 'M14 35.4 L106 35.4 L106 36.6 L14 36.6 Z M56 20 L60 20 L60 52 L56 52 Z',
    };

    /* 'wide' is the default rather than 'narrow' because an unrecognised type in
     * a VA's fleet is more often a large aircraft than a small one, and a
     * widebody outline reads as "an airliner" to a glancing eye in a way a
     * Cessna does not. */
    function shapeFor(name) {
        var s = text(name);
        if (!s) return 'wide';
        for (var i = 0; i < SHAPES.length; i++) if (SHAPES[i][0].test(s)) return SHAPES[i][1];
        return 'wide';
    }

    /* THE COLOUR IS THE AIRLINE'S, AND THE FIELD IS THE PAGE'S.
     *
     * Two decisions, and the crew centre makes both of them the other way round
     * for good reasons that do not apply here.
     *
     * COLOUR. The crew centre tints these per registration, so an airframe is
     * recognisable at a glance in a list of forty. On the airline's OWN
     * WEBSITE that is wrong: twelve randomly hued tiles next to their wordmark
     * is a paint chart sitting where a livery should be. So the mark is drawn
     * in the accent they chose in the crew centre — the same colour as their
     * buttons and their links — and a VA who has chosen none gets a neutral
     * grey rather than a colour we invented for them.
     *
     * FIELD. There isn't one. The crew centre paints a coloured rectangle
     * behind the outline because it sits in a list with no container of its
     * own; a card on a website already HAS a well, with the design's own
     * surface colour in it. Painting a second rectangle inside the first is a
     * picture inside a picture — a letterboxed block in not-quite the same
     * grey, which reads as a rendering fault. So the artwork is the mark and
     * nothing else, and the card supplies the ground.
     *
     * The accent is legible on that ground by construction: it is the same
     * colour the design already puts links and buttons in, on the same surface.
     */
    var NEUTRAL_MARK = '#8b94a3';

    /* encodeURIComponent rather than base64: the SVG is small, the encoded form
     * is smaller than base64 would be, and it stays readable in devtools —
     * which matters the first time somebody wonders where a picture came from.
     *
     * No external references of any kind, which is what makes this incapable of
     * failing: there is nothing to fetch, so there is nothing to 404, block or
     * time out. */
    function silhouette(name, accent) {
        var shape = shapeFor(name);
        var mark = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(accent || '')) ? accent : NEUTRAL_MARK;
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 72" width="120" height="72">'
            + '<path d="' + (PLANFORMS[shape] || PLANFORMS.wide) + '" fill="' + mark + '"/>'
            + '</svg>';
        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    }

    /* ---------------------------------------------------------------------
     * WHAT THE AEROPLANE ACTUALLY IS
     *
     * A fleet page that says "Boeing 787-10" and "Ocean" twelve times tells a
     * reader who already knows aeroplanes nothing they did not know, and tells
     * everybody else nothing at all. What a visitor is actually asking is how
     * big it is and how far it goes — that is what makes a fleet page a fleet
     * page rather than a list of names.
     *
     * Published manufacturer figures: typical two-class seating, design range,
     * cruise, and the engine count. Not the airline's own configuration, which
     * nobody has a field for and which would be a guess — the card says
     * "typical" and means it.
     *
     * Matched on the same canonical Infinite Flight type string as SHAPES
     * above, with the same rule: the first hit wins, so the specific patterns
     * come first. An unrecognised type gets nothing rather than an average of
     * other people's aeroplanes.
     * ------------------------------------------------------------------- */
    var SPECS = [
        // ── Airbus ───────────────────────────────────────────────────────
        [/a380/i,                   { seats: 545, range: 8000, cruise: 'Mach 0.85', engines: 4 }],
        [/a350|\ba359\b/i,          { seats: 315, range: 8100, cruise: 'Mach 0.85', engines: 2 }],
        [/a340-?600|a346/i,         { seats: 326, range: 7900, cruise: 'Mach 0.83', engines: 4 }],
        [/a330-?900|a339|a330neo/i, { seats: 287, range: 7200, cruise: 'Mach 0.82', engines: 2 }],
        [/a330/i,                   { seats: 277, range: 6350, cruise: 'Mach 0.82', engines: 2 }],
        [/a321neo|a21n/i,           { seats: 200, range: 4000, cruise: 'Mach 0.78', engines: 2 }],
        [/a321/i,                   { seats: 185, range: 3200, cruise: 'Mach 0.78', engines: 2 }],
        [/a320neo|a20n/i,           { seats: 165, range: 3500, cruise: 'Mach 0.78', engines: 2 }],
        [/a320/i,                   { seats: 150, range: 3300, cruise: 'Mach 0.78', engines: 2 }],
        [/a319/i,                   { seats: 124, range: 3700, cruise: 'Mach 0.78', engines: 2 }],
        [/a318/i,                   { seats: 107, range: 3100, cruise: 'Mach 0.78', engines: 2 }],
        // ── Boeing ───────────────────────────────────────────────────────
        [/787-?10|b78x/i,           { seats: 336, range: 6430, cruise: 'Mach 0.85', engines: 2 }],
        [/787-?9|b789/i,            { seats: 296, range: 7565, cruise: 'Mach 0.85', engines: 2 }],
        [/787/i,                    { seats: 248, range: 7355, cruise: 'Mach 0.85', engines: 2 }],
        [/777-?300|b77w/i,          { seats: 396, range: 7370, cruise: 'Mach 0.84', engines: 2 }],
        [/777-?200lr|b77l/i,        { seats: 317, range: 8555, cruise: 'Mach 0.84', engines: 2 }],
        [/777/i,                    { seats: 313, range: 7065, cruise: 'Mach 0.84', engines: 2 }],
        [/767/i,                    { seats: 261, range: 5980, cruise: 'Mach 0.80', engines: 2 }],
        [/747-?8/i,                 { seats: 467, range: 7730, cruise: 'Mach 0.86', engines: 4 }],
        [/747-?400/i,               { seats: 416, range: 7260, cruise: 'Mach 0.85', engines: 4 }],
        [/747/i,                    { seats: 366, range: 6850, cruise: 'Mach 0.84', engines: 4 }],
        [/757/i,                    { seats: 200, range: 3915, cruise: 'Mach 0.80', engines: 2 }],
        [/737 ?max|b38m|737-?8 ?max/i, { seats: 178, range: 3550, cruise: 'Mach 0.79', engines: 2 }],
        [/737-?900/i,               { seats: 178, range: 2950, cruise: 'Mach 0.79', engines: 2 }],
        [/737-?800/i,               { seats: 162, range: 2935, cruise: 'Mach 0.79', engines: 2 }],
        [/737-?700/i,               { seats: 126, range: 3010, cruise: 'Mach 0.79', engines: 2 }],
        [/737/i,                    { seats: 162, range: 2935, cruise: 'Mach 0.79', engines: 2 }],
        [/717/i,                    { seats: 106, range: 2060, cruise: 'Mach 0.77', engines: 2 }],
        // ── Regional, trijets, turboprops ────────────────────────────────
        [/crj-?1000|crjx/i,         { seats: 100, range: 1620, cruise: 'Mach 0.78', engines: 2 }],
        [/crj-?900/i,               { seats: 86, range: 1550, cruise: 'Mach 0.78', engines: 2 }],
        [/crj-?700/i,               { seats: 70, range: 1378, cruise: 'Mach 0.78', engines: 2 }],
        [/crj/i,                    { seats: 50, range: 1700, cruise: 'Mach 0.74', engines: 2 }],
        [/e-?190|erj-?190/i,        { seats: 100, range: 2450, cruise: 'Mach 0.78', engines: 2 }],
        [/e-?175|erj-?175|embraer/i,{ seats: 78, range: 2150, cruise: 'Mach 0.78', engines: 2 }],
        [/md-?11/i,                 { seats: 293, range: 6840, cruise: 'Mach 0.82', engines: 3 }],
        [/dc-?10/i,                 { seats: 285, range: 5200, cruise: 'Mach 0.82', engines: 3 }],
        [/dash ?8|q400|dh8/i,       { seats: 78, range: 1100, cruise: '360 kt', engines: 2 }],
        [/caravan|c-?208|\b208\b/i, { seats: 9, range: 1070, cruise: '175 kt', engines: 1 }],
        // ── Light and business ───────────────────────────────────────────
        [/citation|c-?750/i,        { seats: 9, range: 3070, cruise: 'Mach 0.90', engines: 2 }],
        [/sr-?22|cirrus/i,          { seats: 3, range: 1169, cruise: '183 kt', engines: 1 }],
        [/c-?172|cessna 172/i,      { seats: 3, range: 640, cruise: '122 kt', engines: 1 }],
        [/xcub|cub/i,               { seats: 1, range: 800, cruise: '145 kt', engines: 1 }],
        [/spitfire/i,               { seats: 0, range: 410, cruise: '320 kt', engines: 1 }],
        // ── Military ─────────────────────────────────────────────────────
        [/c-?17|globemaster/i,      { seats: 0, range: 2400, cruise: 'Mach 0.76', engines: 4 }],
        [/c-?130|hercules/i,        { seats: 0, range: 2050, cruise: '292 kt', engines: 4 }],
        [/a-?10/i,                  { seats: 0, range: 2240, cruise: '300 kt', engines: 2 }],
        [/f-?22/i,                  { seats: 0, range: 1600, cruise: 'Mach 1.8', engines: 2 }],
        [/f-?18|super hornet/i,     { seats: 0, range: 1275, cruise: 'Mach 1.6', engines: 2 }],
        [/f-?16/i,                  { seats: 0, range: 2280, cruise: 'Mach 1.6', engines: 1 }],
    ];

    function specFor(name) {
        var s = text(name);
        if (!s) return null;
        for (var i = 0; i < SPECS.length; i++) if (SPECS[i][0].test(s)) return SPECS[i][1];
        return null;
    }

    // 7,565 rather than 7565. A four-figure distance with no separator reads as
    // a part number at the size this prints at.
    function group(n) { return String(n).replace(/\B(?=(\d{3})+$)/g, ','); }

    /** The spec line as one string, so a template can print it with one field
     *  and a design that wants it split can still read the parts. Empty when
     *  we do not know the type — an invented figure on an airline's own website
     *  is worse than a card that does not mention one. */
    function specLine(spec) {
        if (!spec) return '';
        var bits = [];
        if (spec.seats > 0) bits.push(spec.seats + ' seats');
        if (spec.range) bits.push(group(spec.range) + ' nm');
        if (spec.cruise) bits.push(spec.cruise);
        return bits.join(' · ');
    }

    /* ---------------------------------------------------------------------
     * FLEET — the aircraft the VA declared, and the liveries they fly them in.
     *
     * `type` is the aircraft and `name` is the livery, both as the canonical
     * Infinite Flight API strings, because that is what the tracker matches a
     * live flight against. A website wants them the other way round in a
     * sentence, so this hands over both under names that read correctly:
     * `aircraft` and `livery`.
     * ------------------------------------------------------------------- */
    function fleet(opts) {
        opts = opts || {};
        var limit = Number(opts.limit) || 40;
        return brandRaw().then(function (d) {
            if (!d || !Array.isArray(d.fleet)) return null;
            var accent = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text(d.accent)) ? text(d.accent) : '';
            var rows = d.fleet
                .filter(function (f) { return f && (text(f.type) || text(f.name)); })
                .slice(0, limit)
                .map(function (f) {
                    var aircraft = text(f.type);
                    var livery = text(f.name);
                    var own = https(f.image);
                    // Drawn in the airline's own accent — see THE COLOUR IS THE
                    // AIRLINE'S above. Also the standby for an upload that has
                    // rotted: a URL that worked when it was typed and 404s two
                    // years later is the common way a fleet page grows holes.
                    var drawn = silhouette(aircraft || livery, accent);
                    // A photographer's name and a link, if the crew centre ever
                    // carries one for this airframe. Read defensively rather
                    // than assumed absent: the day the fleet editor gains the
                    // field, every hosted site starts crediting it correctly
                    // without a line changing here.
                    var by = text(f.photographer || f.credit);
                    var byHref = https(f.photoLink || f.creditUrl);
                    var spec = specFor(aircraft || livery);

                    /* WHAT THE CARD SAYS ABOUT THE PICTURE, ON THE PICTURE.
                     *
                     * `credit` is the line under the card and has always been
                     * there. `mark` is new and is a small chip in the corner of
                     * the picture itself, because a credit that only exists
                     * under a card is a credit that does not travel: the
                     * picture is what gets screenshotted, linked and reposted.
                     *
                     * Whose name goes on it follows who made it, and nothing
                     * else. A photograph belongs to the photographer, so the
                     * mark is THEIR name — stamping ours across somebody else's
                     * work would be the opposite of attribution. A VA's own
                     * unattributed upload is theirs and gets no mark at all.
                     * The drawn outlines are ours, and those say Inflight. */
                    var common = {
                        aircraft: aircraft, livery: livery,
                        seats: spec && spec.seats > 0 ? String(spec.seats) : '',
                        range: spec && spec.range ? group(spec.range) + ' nm' : '',
                        cruise: spec ? spec.cruise : '',
                        engines: spec ? String(spec.engines) : '',
                        specs: specLine(spec),
                    };

                    if (own) {
                        return assign(common, {
                            image: own, fit: 'cover',
                            fallback: drawn,
                            // The VA's own upload. Credited to nobody, because
                            // it is theirs — unless they named a photographer.
                            credit: by ? 'Photo: ' + by : '',
                            creditHref: by ? byHref : '',
                            mark: by,
                        });
                    }
                    return assign(common, {
                        // Drawn, not fetched. See AIRCRAFT PICTURES above.
                        image: drawn,
                        fallback: drawn,
                        // 'contain', because this is artwork on a flat field
                        // and cropping it to fill cuts the wingtips off.
                        fit: 'contain',
                        credit: 'Outline by Inflight',
                        // Deliberately not a link. The credit is owed and is
                        // paid in words; turning it into an advert on somebody
                        // else's website is not the same thing.
                        creditHref: '',
                        mark: 'Inflight',
                    });
                });
            return rows.length ? rows : null;
        });
    }

    /* ---------------------------------------------------------------------
     * HUBS — where the airline is BASED.
     *
     * A different question from where it flies, and the one an applicant asks
     * first: nobody joins an airline whose whole network is on the far side of
     * the world from the time of day they play. Almost no VA website answers it.
     *
     * Worked out from the route map rather than typed anywhere, so it cannot go
     * stale — an airport becomes a hub by having the most sectors on it, which
     * is a fact the crew centre already holds. Ranked by routes, then by
     * departures, so a tie breaks on the busier airport rather than on
     * whichever order the store happened to return.
     * ------------------------------------------------------------------- */
    function hubs(opts) {
        opts = opts || {};
        var limit = Number(opts.limit) || 6;
        return network().then(function (n) {
            if (!n || !n.airports) return null;
            var rows = Object.keys(n.airports)
                .map(function (k) { return n.airports[k]; })
                .filter(function (a) { return a && a.icao && (a.routes || a.departures || a.arrivals); })
                .sort(function (a, b) { return (b.routes - a.routes) || (b.departures - a.departures); })
                .slice(0, limit)
                .map(function (a) {
                    return {
                        icao: a.icao,
                        routes: a.routes,
                        departures: a.departures,
                        arrivals: a.arrivals,
                    };
                });
            return rows.length ? rows : null;
        });
    }

    /* CODESHARES — who the airline flies with.
     *
     * Also off the route map: a sector already knows whether it is shared and
     * with whom. A partner list typed by hand is a list that outlives the
     * partnership, which is the failure mode this whole file exists to avoid.
     *
     * Deduplicated case-insensitively but printed in the casing the crew centre
     * stored, because that is how the partner writes its own name.
     * ------------------------------------------------------------------- */
    function partners(opts) {
        opts = opts || {};
        var limit = Number(opts.limit) || 12;
        return network().then(function (n) {
            if (!n || !Array.isArray(n.routes)) return null;
            var seen = {}, rows = [];
            n.routes.forEach(function (r) {
                var name = text(r && r.partner);
                if (!name) return;
                var key = name.toLowerCase();
                if (seen[key]) { seen[key].sectors += 1; return; }
                seen[key] = { name: name, sectors: 1 };
                rows.push(seen[key]);
            });
            rows.sort(function (a, b) { return b.sectors - a.sectors; });
            rows = rows.slice(0, limit);
            return rows.length ? rows : null;
        });
    }

    /** The staff/crew roles a VA defined. Definitions only — never who holds one. */
    function roles(opts) {
        opts = opts || {};
        var limit = Number(opts.limit) || 30;
        return brandRaw().then(function (d) {
            if (!d || !Array.isArray(d.roles)) return null;
            var rows = d.roles
                .filter(function (r) { return r && text(r.name); })
                .slice(0, limit)
                .map(function (r) {
                    return {
                        name: text(r.name),
                        color: /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text(r.color)) ? text(r.color) : '',
                        icon: text(r.icon),
                        image: https(r.image),
                    };
                });
            return rows.length ? rows : null;
        });
    }

    /* ---------------------------------------------------------------------
     * THE ROSTER — everybody who flies for the airline.
     *
     * GET /api/crew/<slug>/roster
     *
     * `staff` below is the handful of people who run it; this is the crew. An
     * applicant reading a VA's website wants to know how many pilots are
     * actually there and what a rank ladder looks like once people are on it —
     * "62 pilots" in a statistic is a number, and a list with sixty-two names
     * and their hours against them is an airline.
     *
     * The endpoint is the one the crew centre's own roster screen reads, and it
     * carries no more than that screen shows a signed-out visitor: a name, a
     * callsign, the rank the ladder puts them on, and hours. No e-mail, no
     * login, no Community handle — that last one is the deliberate difference
     * from `staff`, where a person holding a public role has opted into being
     * findable and a line pilot has not.
     *
     * PILOTS WHO HAVE LEFT ARE NOT ON IT. A roster row marked inactive is
     * somebody the airline has stopped counting, and a website that lists them
     * is overstating itself. Leave of absence is not leaving, so it stays —
     * carried as `status` for a site that wants to say so.
     *
     * Ordered by hours, most first, because that is the order the list is
     * interesting in and the order a rank ladder reads down.
     * ------------------------------------------------------------------- */
    function roster(opts) {
        opts = opts || {};
        var limit = Number(opts.limit) || 500;
        return crew('/roster').then(function (d) {
            if (!d || !Array.isArray(d.roster)) return null;
            var rows = d.roster
                .filter(function (m) { return m && text(m.name); })
                .filter(function (m) { return opts.includeInactive ? true : m.status !== 'inactive'; })
                .map(function (m) {
                    var rank = m.rank || {};
                    var hours = num(m.hours) || 0;
                    return {
                        name: text(m.name),
                        callsign: text(m.callsign),
                        role: text(m.role),
                        rank: text(rank.name),
                        rankColor: /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text(rank.color)) ? text(rank.color) : '',
                        rankImage: https(rank.image),
                        hours: hours,
                        // The figure as a person would write it, so a template
                        // does not have to know that 1204 means hours or where
                        // the thousands separator goes in the reader's locale.
                        hoursText: hours ? hours.toLocaleString() + ' h' : '',
                        status: text(m.status) || 'active',
                        // 'On leave' or '' — never 'Active', which is every
                        // other row and therefore says nothing.
                        note: m.status === 'loa' ? 'On leave' : '',
                    };
                })
                .sort(function (a, b) { return b.hours - a.hours || a.name.localeCompare(b.name); })
                .slice(0, limit);
            return rows.length ? rows : null;
        });
    }

    /* ---------------------------------------------------------------------
     * WHO RUNS THE AIRLINE
     *
     * GET /api/crew/<slug>/staff
     *
     * The people, not the departments. `roles` above answers "what teams does
     * this airline have" and is right for a row of labels; this answers "who
     * are you", which is the question somebody deciding whether to apply is
     * actually asking, and the one every VA answered with a paragraph of prose
     * and a screenshot of Discord.
     *
     * A pilot is here because staff gave them a role the airline declared —
     * never because they are on the roster. `ifc` is their Infinite Flight
     * Community handle and `ifcUrl` the profile it belongs to, built by the
     * backend from a closed alphabet; a handle that is not one arrives without
     * a URL and the name is drawn without a link.
     *
     * `message` is the ROLE's short word rather than the person's, so the
     * chief executive's welcome survives the day somebody else takes the
     * chair. `lead` marks whoever holds the first role the airline listed,
     * for a site that wants to feature them above the rest.
     * ------------------------------------------------------------------- */
    function staff(opts) {
        opts = opts || {};
        var limit = Number(opts.limit) || 24;
        return crew('/staff').then(function (d) {
            if (!d || !Array.isArray(d.staff)) return null;
            var rows = d.staff
                .filter(function (m) { return m && text(m.name); })
                .slice(0, limit)
                .map(function (m) {
                    var handle = text(m.ifc).replace(/^@/, '');
                    var url = https(m.ifcUrl);
                    return {
                        name: text(m.name),
                        role: text(m.role),
                        roleColor: /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text(m.roleColor)) ? text(m.roleColor) : '',
                        roleImage: https(m.roleImage),
                        rank: text(m.rank),
                        rankColor: /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text(m.rankColor)) ? text(m.rankColor) : '',
                        rankImage: https(m.rankImage),
                        callsign: text(m.callsign),
                        message: text(m.message),
                        // Two spellings of the same fact, because a template
                        // wants the handle to READ as one ("@rjb") and the
                        // profile to be where it goes. Both are empty for a
                        // staff member who has not linked a Community account,
                        // and an empty href is unwrapped by the list painter
                        // rather than left as a dead link.
                        ifc: handle ? '@' + handle : '',
                        ifcUrl: handle ? url : '',
                        lead: !!m.lead,
                        // The same fact as a class name, so a template can say
                        // which card is the airline's and let the stylesheet
                        // decide what that means. A boolean interpolated into
                        // markup reads as the word "true"; this does not.
                        leadClass: m.lead ? 'is-lead' : '',
                        // Initials, for a card with no photograph — which is
                        // every card, because the crew centre holds no portrait
                        // of anybody and asking for one is not this feature.
                        initials: text(m.name).split(/\s+/).slice(0, 2)
                            .map(function (w) { return w.charAt(0).toUpperCase(); }).join(''),
                    };
                });
            return rows.length ? rows : null;
        });
    }

    /* =====================================================================
     * DECLARATIVE PAINTING
     *
     * Mark the page up with the truth it already holds, then name the field
     * that should replace it:
     *
     *   <b data-crew-stat="pilots">—</b> pilots
     *   <div data-crew-figure><b data-crew-stat="hours"></b><span>hours</span></div>
     *   <section data-crew-when="pireps"> … </section>
     *
     * An element inside a [data-crew-figure] is treated as part of one figure:
     * if the number never arrives, that whole block goes rather than being left
     * as a label with nothing under it. [data-crew-when] removes a section that
     * only makes sense once there is a figure at all.
     *
     * Nothing is ever filled with 0 as a stand-in for "we did not find out".
     * =================================================================== */
    function paintStats(figures, root) {
        /* NULL IS NOT AN EMPTY ANSWER.
         *
         * An OBJECT without a key means the crew centre genuinely does not hold
         * that figure, and the element goes. `null` means no figures reached us
         * at all, and the page is left exactly as its author wrote it.
         *
         * This function used to treat those the same, so a backend that was down
         * for thirty seconds stripped the whole figures band off every hosted
         * site — the exact failure the rule at the top of this file exists to
         * prevent, and it was live.
         *
         * Being straight about the cost: stats() returns null both for "we could
         * not ask" AND for an airline that has flown nothing yet, so a brand-new
         * VA now keeps whatever their page says instead of losing the band. That
         * is the right way round. The fallback in the markup is a dash the page
         * author chose; the alternative was every established airline's figures
         * disappearing on a slow request.
         */
        if (figures === null || figures === undefined) return;

        var scope = root || document;
        var slots = scope.querySelectorAll('[data-crew-stat]');

        Array.prototype.forEach.call(slots, function (el) {
            var key = el.getAttribute('data-crew-stat');
            var value = figures ? figures[key] : undefined;
            var holder = el.closest ? el.closest('[data-crew-figure]') : null;

            if (!isFinite(Number(value)) || value === undefined || value === null) {
                if (holder) holder.parentNode && holder.parentNode.removeChild(holder);
                else el.parentNode && el.parentNode.removeChild(el);
                return;
            }
            var suffix = el.getAttribute('data-crew-suffix') || '';
            el.textContent = Number(value).toLocaleString() + suffix;
            if (holder) holder.removeAttribute('hidden');
        });

        Array.prototype.forEach.call(scope.querySelectorAll('[data-crew-when]'), function (el) {
            var key = el.getAttribute('data-crew-when');
            var ok = !!(figures && Number(figures[key]) > 0);
            if (!ok) el.parentNode && el.parentNode.removeChild(el);
            else el.removeAttribute('hidden');
        });
    }

    /* ---------------------------------------------------------------------
     * Brand painting.
     *
     *   <img data-crew-brand="logo" alt="">
     *   <h1 data-crew-brand="name">Ocean Virtual</h1>
     *   <p data-crew-brand="tagline">Write something true here.</p>
     *
     * On an <img> the value becomes the `src`; on anything else it becomes the
     * text. An element whose field the crew centre does not hold is REMOVED —
     * a VA with no banner gets a hero with no banner, not a broken image icon
     * with alt text where a photograph should be.
     *
     * That removal is why the same rule cannot be "leave what is on the page".
     * A figure has a true fallback a VA can type; a logo does not — there is no
     * placeholder image that is honest about an airline that has not uploaded
     * one. So: it arrives, or the element goes.
     * ------------------------------------------------------------------- */
    var BRAND_URL_FIELDS = { logo: 1, banner: 1, website: 1, discord: 1 };

    function paintBrand(b, root) {
        /* NULL IS NOT AN EMPTY ANSWER — the same distinction paintStats makes,
         * and the consequence here is worse. A [data-crew-brand="name"] element
         * carries the airline's OWN NAME as the text between its tags, so
         * treating an unreachable backend as "the VA has no name" deleted the
         * wordmark out of the header of every page on the site.
         *
         * A field genuinely absent from a brand record we DID receive is still
         * removed: there is no honest placeholder for a logo an airline has not
         * uploaded, which is the rule the removal exists for. */
        if (b === null || b === undefined) return;

        var scope = root || document;
        var slots = scope.querySelectorAll('[data-crew-brand]');
        if (!slots.length) return;

        Array.prototype.forEach.call(slots, function (el) {
            var key = el.getAttribute('data-crew-brand');
            var value = b ? b[key] : '';
            var holder = el.closest ? el.closest('[data-crew-figure]') : null;

            if (!value) {
                if (holder) holder.parentNode && holder.parentNode.removeChild(holder);
                else el.parentNode && el.parentNode.removeChild(el);
                return;
            }
            var tag = (el.tagName || '').toLowerCase();
            if (tag === 'img') {
                el.setAttribute('src', value);
                // An alt the page already wrote wins; otherwise the airline's
                // name, because "logo" is not what a screen reader should say.
                if (!el.getAttribute('alt')) el.setAttribute('alt', (b && b.name) || '');
            } else if (tag === 'a' && BRAND_URL_FIELDS[key]) {
                el.setAttribute('href', value);
                if (!text(el.textContent)) el.textContent = value;
            } else {
                el.textContent = value;
            }
            if (holder) holder.removeAttribute('hidden');
            el.setAttribute('data-crew-filled', '1');
        });
    }

    /* ---------------------------------------------------------------------
     * THE TAB.
     *
     * A generated site declares no icon, because the renderer that writes it
     * has no network and the airline's logo lives behind a request — the same
     * reason there is no og:image. So every VA's site opened with the browser's
     * own placeholder globe, identical to every other unbranded page, while the
     * logo sat in the header two inches below it.
     *
     * The logo arrives here anyway, in the brand record this file already
     * fetches for [data-crew-brand]. So the tab is painted from it, at the same
     * moment the header is, and an airline that has never uploaded a logo gets
     * its initials on its accent rather than the globe.
     *
     * AN ICON THE SITE DECLARED ITSELF ALWAYS WINS. These files are the VA's to
     * edit: someone who has written their own <link rel="icon"> has chosen one,
     * and this must not quietly replace it. Only a page with no icon at all is
     * painted, which is every page as generated and none that has been given
     * one by hand.
     * ------------------------------------------------------------------- */
    var ICON_MARK = 'data-crew-icon';

    function pageHasOwnIcon() {
        var own = document.querySelector('link[rel~="icon"], link[rel="shortcut icon"]');
        return !!(own && !own.hasAttribute(ICON_MARK));
    }

    // "Ocean Virtual" → OV. A one-word airline falls back to two letters, and
    // an airline with no name at all gets nothing rather than a blank square.
    function brandInitials(name, code) {
        var s = text(name) || text(code);
        if (!s) return '';
        var w = s.split(/\s+/).filter(Boolean);
        return (w.length >= 2 ? (w[0][0] + w[1][0]) : s.slice(0, 2))
            .toUpperCase().replace(/[^A-Z0-9]/g, '');
    }

    // Black or white, whichever can be read against the accent — a pale accent
    // with white initials on it is a blank square at 16 pixels.
    function readableInk(hex) {
        var h = String(hex || '').replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var n = parseInt(h, 16);
        if (!isFinite(n)) return '#FFFFFF';
        var lin = function (c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
        var L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
        return L > 0.45 ? '#111111' : '#FFFFFF';
    }

    // The site's own accent first — a site with a theme.css has one and it is
    // the colour the visitor is actually looking at — then the crew centre's,
    // then a neutral so the mark is never drawn on nothing.
    function siteAccent(b) {
        var v = '';
        try { v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); } catch (e) { v = ''; }
        if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) v = (b && b.accent) || '';
        return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : '#1F6FEB';
    }

    function monogramIcon(b) {
        var t = brandInitials(b && b.name, b && b.code);
        if (!t) return '';
        var bg = siteAccent(b);
        // A rounded square, not a circle: at 16px a circle loses its corners to
        // the tab's own padding and reads as a smudge.
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
            + '<rect width="64" height="64" rx="14" fill="' + bg + '"/>'
            + '<text x="32" y="32" fill="' + readableInk(bg) + '"'
            + ' font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif"'
            + ' font-size="30" font-weight="700" text-anchor="middle" dominant-baseline="central">'
            + t + '</text></svg>';
        return 'data:image/svg+xml,' + encodeURIComponent(svg);
    }

    function paintFavicon(b) {
        if (!b || !document.head) return false;
        if (pageHasOwnIcon()) return false;
        var logo = https(b.logo);
        var href = logo || monogramIcon(b);
        if (!href) return false;

        // Ours are replaced rather than added to: mount() is safe to call more
        // than once, and a tab does not want four icons to choose between.
        Array.prototype.forEach.call(document.querySelectorAll('link[' + ICON_MARK + ']'),
            function (el) { el.parentNode && el.parentNode.removeChild(el); });

        var link = document.createElement('link');
        link.setAttribute('rel', 'icon');
        if (!logo) link.setAttribute('type', 'image/svg+xml');
        link.setAttribute(ICON_MARK, '1');
        link.setAttribute('href', href);
        document.head.appendChild(link);

        // iOS ignores SVG for a home-screen bookmark, so only a real logo gets
        // one — better the system's own screenshot than a blank square.
        if (logo) {
            var t = document.createElement('link');
            t.setAttribute('rel', 'apple-touch-icon');
            t.setAttribute(ICON_MARK, '1');
            t.setAttribute('href', logo);
            document.head.appendChild(t);
        }
        return true;
    }

    /* ---------------------------------------------------------------------
     * List painting.
     *
     *   <div data-crew-list="routes" data-crew-limit="10">
     *     <template>
     *       <li><b>{{from}} → {{to}}</b> {{aircraft}}</li>
     *     </template>
     *   </div>
     *
     * Every {{field}} is escaped on the way in: these values come from a crew
     * center's own database, and a template that interpolated them raw would
     * make any staff member with a notes field an author of the host site's
     * HTML. A row is only rendered if the feed answered — a quiet backend
     * leaves whatever the page already had inside the container.
     * ------------------------------------------------------------------- */
    var LISTS = {
        routes: routes, events: events, schedule: schedule,
        notices: notices, activity: activity, posts: posts,
        ranks: ranks, fleet: fleet, roles: roles,
        hubs: hubs, partners: partners, staff: staff, roster: roster,
    };

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function fill(tpl, row) {
        return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, function (_, key) {
            var v = row[key];
            return v === undefined || v === null || v === false ? '' : escapeHtml(v);
        });
    }

    function paintList(host) {
        var which = host.getAttribute('data-crew-list');
        var reader = LISTS[which];
        if (!reader) return Promise.resolve(null);
        var tpl = host.querySelector('template');
        if (!tpl) return Promise.resolve(null);
        var limit = parseInt(host.getAttribute('data-crew-limit'), 10);
        var opts = {};
        if (isFinite(limit) && limit > 0) opts.limit = limit;
        if (host.getAttribute('data-crew-kind')) opts.kind = host.getAttribute('data-crew-kind');
        if (host.getAttribute('data-crew-past') === 'on') opts.past = true;
        if (host.getAttribute('data-crew-written') === 'on') opts.written = true;

        return reader(opts).then(function (rows) {
            if (!rows) return null;            // quiet backend — keep the page
            var src = tpl.innerHTML;
            host.innerHTML = rows.map(function (r) { return fill(src, r); }).join('');
            // A template can carry <img src="{{image}}"> for a rank badge or an
            // aircraft photo, and most rows will not have one. `fill` leaves an
            // absent field empty, and an <img src=""> is a broken-image icon in
            // every browser — so an image that never arrived is taken out.
            //
            // Keeping the ROWS aligned when only some have a picture is not
            // this file's job and deliberately so: wrap the img in a span in
            // the template and let CSS reserve the column with :has(img). A
            // stand-in element invented here would be a class name every site
            // using this feed had to know about.
            Array.prototype.forEach.call(host.querySelectorAll('img'), function (img) {
                if (!img.getAttribute('src')) { img.parentNode && img.parentNode.removeChild(img); return; }
                /* A STANDBY FOR A PICTURE THAT ROTS.
                 *
                 * The other half of the same problem. An <img> with no src is a
                 * broken-image glyph, and so is one whose src 404s — and the
                 * second is the one that arrives LATER: a VA types a working
                 * image address, and two years on the host it was on is gone.
                 * Nobody is watching, so the fleet page quietly grows holes.
                 *
                 * A template that offers data-crew-fallback is saying it has
                 * something to put there instead. The handler clears the
                 * attribute before it swaps, so a fallback that itself fails
                 * cannot loop. */
                var standby = img.getAttribute('data-crew-fallback');
                if (!standby || standby === img.getAttribute('src')) return;
                img.addEventListener('error', function once() {
                    img.removeEventListener('error', once);
                    img.removeAttribute('data-crew-fallback');
                    img.src = standby;
                    // The standby is artwork on a flat field, not a photograph:
                    // cropping it to fill cuts the wingtips off.
                    if (img.hasAttribute('data-fit')) img.setAttribute('data-fit', 'contain');
                });
            });
            // The same problem one element along. A template can carry
            // <a href="{{creditHref}}">{{credit}}</a> for a photographer, and
            // most rows have the name without a page to point at. An anchor
            // with no address is not a link — but its WORDS are usually the
            // row's only copy of that fact, and an attribution deleted for want
            // of a URL is an attribution not paid. So it is UNWRAPPED rather
            // than removed: the text stays, the dead link goes.
            Array.prototype.forEach.call(host.querySelectorAll('a'), function (a) {
                if (a.getAttribute('href')) return;
                var parent = a.parentNode;
                if (!parent) return;
                while (a.firstChild) parent.insertBefore(a.firstChild, a);
                parent.removeChild(a);
            });
            host.setAttribute('data-crew-filled', String(rows.length));
            return rows;
        });
    }

    /**
     * Fill everything on the page that asked to be filled. Safe to call more
     * than once and safe to call before the DOM is ready; pages that use only
     * the reader functions never need it.
     */
    function mount(root) {
        var scope = root || document;
        var jobs = [];
        if (scope.querySelector('[data-crew-stat], [data-crew-when]')) {
            jobs.push(stats().then(function (f) { paintStats(f, scope); return f; }));
        }
        if (scope.querySelector('[data-crew-brand]')) {
            // The tab is painted from the same record as the header, and from
            // the document rather than the scope: a fragment mounted into a
            // page still belongs to the same tab.
            jobs.push(brand().then(function (b) { paintBrand(b, scope); paintFavicon(b); return b; }));
        }
        Array.prototype.forEach.call(scope.querySelectorAll('[data-crew-list]'), function (host) {
            jobs.push(paintList(host));
        });
        return Promise.all(jobs);
    }

    var CrewFeed = {
        configure: configure, refresh: refresh,
        routes: routes, network: network, stats: stats,
        events: events, schedule: schedule, notices: notices,
        activity: activity, posts: posts, handle: handle,
        brand: brand, ranks: ranks, fleet: fleet, roles: roles, staff: staff,
        roster: roster,
        hubs: hubs, partners: partners, silhouette: silhouette,
        paintBrand: paintBrand, paintFavicon: paintFavicon,
        paintStats: paintStats, mount: mount,
        get va() { return CFG.va; },
        get backend() { return CFG.backend; },
        version: 1,
    };

    window.CrewFeed = CrewFeed;

    // The automatic pass. A page that only wants the reader functions is
    // unaffected — with no [data-crew-*] markup this does nothing at all.
    if (CFG.auto !== false && CFG.va) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () { mount(); });
        } else {
            mount();
        }
    }
})();
