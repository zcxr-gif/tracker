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
   posts, handle. `notices` is the noticeboard as the crew center reads it;
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
