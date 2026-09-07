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
   posts, handle, brand, ranks, fleet, roles, hubs, partners.

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

    function brand() {
        return brandRaw().then(function (d) {
            if (!d || !text(d.name)) return null;
            var join = d.join || {};
            return {
                name: text(d.name),
                code: text(d.code),
                tagline: text(d.tagline),
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

                    if (own) {
                        return {
                            aircraft: aircraft, livery: livery,
                            image: own, fit: 'cover',
                            fallback: drawn,
                            // The VA's own upload. Credited to nobody, because
                            // it is theirs — unless they named a photographer.
                            credit: by ? 'Photo: ' + by : '',
                            creditHref: by ? byHref : '',
                        };
                    }
                    return {
                        aircraft: aircraft, livery: livery,
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
                    };
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
        hubs: hubs, partners: partners,
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
            jobs.push(brand().then(function (b) { paintBrand(b, scope); return b; }));
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
        brand: brand, ranks: ranks, fleet: fleet, roles: roles,
        hubs: hubs, partners: partners, silhouette: silhouette,
        paintBrand: paintBrand,
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
