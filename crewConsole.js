/* ============================================================================
   crewConsole.js — the Console interface's shell (crewSkin.css §18).

   Every other interface re-dresses the dashboard that is already on the page.
   This one is a different arrangement altogether — a dispatcher's desk:

     rail          the sections, as icons, down the left
     tabs          the topics, opening into one dark board
     board         the member's crew ID with the aircraft that open next
                   behind it, the week's hours as a chart, the latest flights
     on the line   the pilot being looked at, and what we know about them
     call bar      what can be done to them, all on one row
     inbox         applications, Discord and mail, down the right

   So it is drawn as its own layer over the dashboard, and the dashboard's own
   header and main are hidden while it is up.

   THE FRONT PAGE IS LIVE (see LIVE below): the crew ID and the aircraft
   that open next, the week's hours, the latest flight reports, the pilot
   behind them and the inbox, all off endpoints the dashboard already calls.
   Every tab, rail button and call-bar button opens the dashboard's own panel
   for that job. With nobody signed in (a preview), placeholder content.

   Loaded as a classic script in <head>, after crewSkin.js. It marks <html>
   with data-console at once, so crewSkin.css knows this page carries the
   shell before the body paints.
   ========================================================================== */

(function (global) {
    'use strict';

    const doc = global.document;
    const root = doc.documentElement;
    root.setAttribute('data-console', '');

    const on = () => root.getAttribute('data-skin') === 'console';
    const ic = (name) => '<i data-lucide="' + name + '"></i>';

    function fonts() {
        if (doc.getElementById('cc-font')) return;
        const l = doc.createElement('link');
        l.id = 'cc-font';
        l.rel = 'stylesheet';
        l.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap';
        doc.head.appendChild(l);
    }

    /* ---------------------------------------------------------------------
     * Placeholder content. One object per block, so wiring a block is a
     * matter of replacing its object with a fetch.
     * ------------------------------------------------------------------- */
    const DEMO = {
        tabs: ['Pilot Approval', 'Fleet', 'Routes', 'Flights', 'Events', 'Awards', 'All sections'],
        tab: 3,
        cta: 'Post a NOTAM',
        // A wallet: the crew ID, then the aircraft that open next. One is face
        // on; the rest stand on edge behind it, in the order they come next.
        // `top` of the crew ID is the airline's name (see content()).
        //   face on:  top · number · meta · left / right
        //   on edge:  number · label · tag
        cards: [
            { id: 'crew', top: 'Skyward Virtual Airlines', number: '0042 1278 5590 3392', meta: 'SKY1278 · 1,248 h',
                left: 'Brandon Ashton Warren', right: 'Captain', label: 'Crew ID', tag: 'CPT' },
            { id: 'ac-b77w', top: 'Opens at Senior Captain', number: 'Boeing 777-300ER', aircraft: 'Boeing 777-300ER', meta: '6 routes', locked: true,
                left: '52 h to go', right: 'LOCKED', label: 'Next aircraft', tag: '52 h' },
            { id: 'ac-b789', top: 'Opens at Senior Captain', number: 'Boeing 787-9', aircraft: 'Boeing 787-9', meta: '4 routes', locked: true,
                left: '52 h to go', right: 'LOCKED', label: 'Next aircraft', tag: '52 h' },
            { id: 'ac-a359', top: 'Opens at Commander', number: 'Airbus A350-900', aircraft: 'Airbus A350-900', meta: '3 routes', locked: true,
                left: '402 h to go', right: 'LOCKED', label: 'Next aircraft', tag: '402 h' },
            { id: 'ac-b748', top: 'Opens at Commander', number: 'Boeing 747-8', aircraft: 'Boeing 747-8', meta: '2 routes', locked: true,
                left: '402 h to go', right: 'LOCKED', label: 'Next aircraft', tag: '402 h' },
        ],
        hero: {
            greeting: 'Good evening, Brandon.', rank: 'Captain', hours: 1248, flights: 214,
            next: { name: 'Senior Captain', at: 1300, from: 750 }, aircraft: 'Boeing 787-9',
            caption: 'Last flown · SKY1278 · MMMX → LEMD', member: '',
        },
        chart: {
            title: 'Flight hours',
            days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
            // Two weeks: this one and the last, both on the same 150–750 scale.
            now: [455, 360, 330, 395, 450, 520, 610, 690, 650, 700],
            last: [390, 470, 520, 460, 440, 470, 520, 540, 560, 590],
            min: 150, max: 750, rings: [2, 5, 7],
        },
        flights: [
            { icon: 'plane-takeoff', flight: 'SKY 214', route: 'London Heathrow → Dubai', when: ['02.06.2026', '08:13 AM'], block: '+ 7.12', ac: 'A20N', status: 'In review' },
            { icon: 'plane', flight: 'SKY 1189', route: 'Dubai → Singapore', when: ['02.06.2026', '06:22 AM'], block: '+ 7.49', ac: 'B38M', status: 'In review' },
            { icon: 'user', flight: '**** 2214', route: 'Transfer of hours', when: ['02.06.2026', '06:07 AM'], block: '+ 37.00', ac: 'MANUAL', status: 'Accepted' },
            { icon: 'landmark', flight: 'Event · JFK', route: 'Group flight', when: ['02.05.2026', '11:54 PM'], block: '+ 3.99', ac: 'A321', status: 'Accepted' },
        ],
        pilot: {
            callsign: 'SKY1278', timer: '04:32', state: 'LIVE', name: 'Brandon Ashton Warren', tier: 'Senior Captain',
            base: 'Based at EGLL · London Heathrow · Joined March 2024',
            ifc: 'brandon.warren', joined: '05/06/2024', discord: 'brandAshwar', id: 'ID: 5771182944',
        },
        convos: {
            count: 12,
            help: { title: 'How to review a PIREP in under a minute', body: 'Go to the flight on the pilot’s logbook, then compare the block time…' },
            groups: [
                { name: 'Live', items: [{ who: 'James Wilson', at: '08:24 AM', text: 'SKY417 · on frequency', fresh: true, tone: 0 }] },
                { name: 'Discord', items: [{ who: 'Angel Fusher', at: '07:24 PM', text: 'Hey! I called Morris to sort the event roster out', tone: 1 }] },
                { name: 'Inbox', items: [
                    { who: 'Thomas Moris', at: '07:18 AM', text: 'Hello, we need help with our hours transfer. It', fresh: true, tone: 2 },
                    { who: 'Brandie Flores', at: '07:03 AM', text: 'My friend would like to apply to join our crew p', tone: 3 },
                    { who: 'Peter Peterson', at: '06:57 AM', text: 'You should call me or John to continue', tone: 4 },
                    { who: 'Barbara Stranger', at: '06:34 AM', text: 'What can I do about it?', tone: 5, old: true },
                ] },
            ],
        },
    };

    // Avatar fills, until there are pictures to put in them.
    const TONES = [
        'linear-gradient(150deg,var(--cc-accent),color-mix(in srgb,var(--cc-accent) 60%,#000))', 'linear-gradient(150deg,#4b5563,#1f2937)',
        'linear-gradient(150deg,#a8a29e,#57534e)', 'linear-gradient(150deg,#44403c,#1c1917)',
        'linear-gradient(150deg,#78716c,#292524)', 'linear-gradient(150deg,#7f1d1d,#3f1212)',
    ];
    const initials = (n) => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join('');

    /* ---------------------------------------------------------------------
     * The airline's own look: its logo, its name, its flight code and its
     * colour, off the same branding record the rest of the dashboard paints
     * from (crew-dashboard.html applyBranding → CrewConsole.brand).
     *
     * The colour is the airline's accent — the dark-mode one first, since this
     * interface is dark — and two shades are worked out from it: one solid
     * enough to be a card or a button on #212121, one light enough to be text
     * or a line on it. A navy or near-black livery would otherwise vanish into
     * the board. Neither is written for an airline that has no accent: the
     * shell keeps its own orange.
     * ------------------------------------------------------------------- */
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const isHex = (c) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c || '');
    const https = (u) => /^https:\/\/[^\s"'<>()\\]+$/i.test(String(u || ''));

    function rgb(hex) {
        let h = hex.slice(1);
        if (h.length === 3) h = h.replace(/./g, '$&$&');
        const n = parseInt(h, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    function luminance(c) {
        const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
    }
    /** The colour, moved toward white only as far as it takes to reach `min`. */
    function lift(hex, min) {
        const c = rgb(hex);
        for (let t = 0; t <= 1; t += 0.05) {
            const m = c.map((v) => Math.round(v + (255 - v) * t));
            if (luminance(m) >= min) return '#' + m.map((v) => v.toString(16).padStart(2, '0')).join('');
        }
        return '#ffffff';
    }

    let branding = null;

    function brandOf(b) {
        const r = b || {};
        const t = (r.theme && typeof r.theme === 'object') ? r.theme : {};
        const accent = [t.dark && t.dark.accent, r.accent, t.light && t.light.accent].find(isHex) || '';
        const code = String(r.code || '').trim().toUpperCase();
        return {
            name: String(r.name || '').trim(),
            logo: https(r.logo) ? r.logo : '',
            code: /^[A-Z0-9]{2,4}$/.test(code) ? code : '',
            accent,
        };
    }

    // "Aeromexico Virtual" → AV, the same rule crewBrand.js draws the tab with.
    function monogram(name) {
        const w = name.split(/\s+/).filter(Boolean);
        return (w.length >= 2 ? w[0][0] + w[1][0] : name.slice(0, 2)).toUpperCase();
    }

    function logoHtml(br) {
        if (br.logo) return '<span class="cc-logo has-img"><img src="' + esc(br.logo) + '" alt="' + esc(br.name) + '"></span>';
        if (br.name) return '<span class="cc-logo is-mono" aria-hidden="true">' + esc(monogram(br.name)) + '</span>';
        return '<span class="cc-logo" aria-hidden="true"></span>';
    }

    /**
     * What the shell draws. Signed in, it is the crew centre's own data (see
     * LIVE below) and nothing is made up: a block with nothing to show says
     * so. With nobody signed in — a design preview, a test page — it is the
     * placeholder content, in this airline's name and flight code.
     */
    function content() {
        const br = brandOf(branding);
        if (liveApi()) return Object.assign(liveContent(br), { brand: br, live: true });
        let json = JSON.stringify(DEMO);
        if (br.code) json = json.replace(/SKY(?=[ 0-9])/g, br.code);
        const d = JSON.parse(json);
        if (br.name) d.cards[0].top = br.name;
        d.brand = br;
        return d;
    }

    function paintColour(el) {
        const br = brandOf(branding);
        const props = ['--cc-accent', '--cc-accent-hi', '--cc-accent-ink'];
        if (!br.accent) { props.forEach((p) => el.style.removeProperty(p)); return; }
        const fill = lift(br.accent, 0.035);
        el.style.setProperty('--cc-accent', fill);
        el.style.setProperty('--cc-accent-hi', lift(br.accent, 0.2));
        el.style.setProperty('--cc-accent-ink', luminance(rgb(fill)) > 0.45 ? '#111111' : '#ffffff');
    }

    /* ---------------------------------------------------------------------
     * LIVE. The front page, off the endpoints the dashboard already calls:
     *
     *   /me/badges   the signed-in member's own pilot record and rank — the
     *                crew ID card. Staff fly too: an owner or staff login
     *                resolves to their own pilot record where they have one.
     *   /routes      every route, marked locked where this member's rank does
     *                not reach yet, with the hours still to fly. The aircraft
     *                that fly only on locked routes are the next to open, and
     *                stand behind the crew ID in the order they unlock.
     *   /pireps      the latest flight reports — the table, the week's hours
     *                in the chart, and whose flight the panel below shows.
     *   /roster      that pilot's rank, hours and accounts.
     *   /inbox       the conversations column (a pilot's inbox; staff, who
     *                have none, are told so and pointed at Start new).
     *
     * Asked for once when the Console is first drawn, and again on Refresh.
     * Each read stands alone: one failing leaves its block empty, not the page.
     * ------------------------------------------------------------------- */
    const live = { loaded: false, loading: false, me: null, routes: null, pireps: null, roster: null, inbox: null, noInbox: false, picked: '' };

    function liveApi() {
        try {
            if (typeof global.crewApi !== 'function' || typeof global.sessionToken !== 'function') return null;
            return global.sessionToken() ? global.crewApi() : null;
        } catch (_) { return null; }
    }

    async function load(force) {
        const api = liveApi();
        if (!api || live.loading || (live.loaded && !force)) return;
        live.loading = true;
        const read = (path) => api(path).then((v) => ({ ok: true, v }), (err) => ({ ok: false, err }));
        const [me, routes, pireps, roster, inbox] = await Promise.all(
            ['/me/badges', '/routes', '/pireps', '/roster', '/inbox'].map(read));
        live.me = me.ok ? me.v : null;
        live.routes = routes.ok ? routes.v : null;
        live.pireps = pireps.ok ? pireps.v : null;
        live.roster = roster.ok ? roster.v : null;
        live.inbox = inbox.ok ? inbox.v : null;
        live.noInbox = !inbox.ok && inbox.err && inbox.err.status === 401;
        live.loaded = true;
        live.loading = false;
        if (mounted) render();
    }

    const arr = (v) => (Array.isArray(v) ? v : []);
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const whenOf = (p) => new Date(p.flownAt || p.createdAt || 0);
    const hhmm = (min) => { const m = Math.max(0, Math.round(num(min))); return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0'); };
    const dur = (min) => { const m = Math.max(0, Math.round(num(min))); const h = Math.floor(m / 60); return h ? h + 'h ' + (m % 60) + 'm' : (m % 60) + 'm'; };
    const STATUS = { pending: 'In review', approved: 'Accepted', rejected: 'Rejected' };
    const STATUS_ICON = { pending: 'clock', approved: 'plane-landing', rejected: 'circle-x' };

    function session() {
        try { return JSON.parse(localStorage.getItem('crew:session:' + (global.CrewSkin ? global.CrewSkin.slug() : '')) || 'null') || {}; } catch (_) { return {}; }
    }

    function ladder() {
        const fromRoutes = live.routes && arr(live.routes.ranks);
        const r = fromRoutes && fromRoutes.length ? fromRoutes : arr(branding && branding.ranks);
        return r.slice().sort((a, b) => num(a.minHours) - num(b.minHours));
    }
    function rankFor(hours) {
        let out = null;
        ladder().forEach((r) => { if (num(hours) >= num(r.minHours)) out = r; });
        return out;
    }
    const rankName = (r) => (r && typeof r === 'object' ? r.name : r) || '';

    // A member number as a card number: in fours, like the real thing.
    function cardNumber(id) {
        const raw = String(id || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
        if (!raw) return '•••• •••• •••• ••••';
        return raw.slice(-16).match(/.{1,4}/g).join(' ');
    }

    function crewCard(br) {
        const me = live.me || {};
        const p = me.pilot;
        const rank = (arr(me.badges).find((b) => b.kind === 'rank') || {}).name || rankName(p && rankFor(p.hours));
        if (!p) {
            const s = session();
            return { id: 'crew', top: br.name || 'Crew ID', number: cardNumber(''), meta: 'No pilot record on this login',
                left: s.name || 'Crew centre', right: String(s.role || 'staff').toUpperCase(), label: 'Crew ID', tag: '' };
        }
        const meta = [p.callsign, Math.round(num(p.hours)).toLocaleString() + ' h'].filter(Boolean).join(' · ');
        return { id: 'crew', top: br.name || 'Crew ID', number: cardNumber(p.memberId), meta,
            left: p.name || p.callsign || 'Pilot', right: rank, label: 'Crew ID', tag: rank };
    }

    /**
     * The aircraft that open next: the types that fly ONLY on routes this
     * member's rank does not reach yet, each at the soonest rank that opens
     * one of its routes. A type already on an open route is not "next" — it
     * is flyable now. The server's own `locked` / `hoursUntilUnlock` are used
     * where it sent them; otherwise they are worked out from the rank ladder.
     */
    function unlockCards() {
        const p = live.me && live.me.pilot;
        const routes = arr(live.routes && live.routes.routes);
        if (!routes.length) return [];
        const hours = num(p && p.hours);
        const steps = ladder();
        const need = (name) => { const r = steps.find((x) => x.name === name); return r ? num(r.minHours) : null; };
        const locked = (r) => (r.locked != null ? !!r.locked : !!(p && r.minRank && need(r.minRank) != null && need(r.minRank) > hours));
        const toGo = (r) => (r.hoursUntilUnlock != null ? num(r.hoursUntilUnlock) : Math.max(0, (need(r.minRank) || 0) - hours));
        const key = (a) => String(a || '').trim().toLowerCase();
        const open = new Set(routes.filter((r) => !locked(r)).map((r) => key(r.aircraft)));
        const next = new Map();
        routes.filter((r) => locked(r) && key(r.aircraft) && !open.has(key(r.aircraft))).forEach((r) => {
            const k = key(r.aircraft);
            const h = toGo(r);
            const cur = next.get(k);
            if (!cur) next.set(k, { name: String(r.aircraft).trim(), hours: h, rank: r.minRank || '', routes: 1 });
            else {
                cur.routes += 1;
                if (h < cur.hours) { cur.hours = h; cur.rank = r.minRank || cur.rank; }
            }
        });
        return Array.from(next.values()).sort((a, b) => a.hours - b.hours || a.name.localeCompare(b.name)).slice(0, 4).map((a, i) => {
            const h = Math.ceil(a.hours);
            return {
                id: 'ac-' + i + '-' + a.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
                top: a.rank ? 'Opens at ' + a.rank : 'Locked', number: a.name, aircraft: a.name,
                meta: a.routes + ' route' + (a.routes === 1 ? '' : 's'), locked: true,
                left: h > 0 ? h.toLocaleString() + ' h to go' : 'Needs a sign-off', right: 'LOCKED',
                label: 'Next aircraft', tag: h > 0 ? h.toLocaleString() + ' h' : rankName(a.rank),
            };
        });
    }

    function flightRows() {
        const list = arr(live.pireps && live.pireps.pireps).slice().sort((a, b) => whenOf(b) - whenOf(a));
        return list;
    }

    // The week's hours, Monday first, against the week before. Rejected
    // flights did not count, so they are not drawn.
    function weekChart(list) {
        const now = new Date();
        const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
        const thisWeek = [0, 0, 0, 0, 0, 0, 0], lastWeek = [0, 0, 0, 0, 0, 0, 0];
        list.forEach((p) => {
            if (p.status === 'rejected') return;
            const t = whenOf(p);
            const day = Math.floor((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - monday) / 864e5);
            if (day >= 0 && day < 7) thisWeek[day] += num(p.durationMin) / 60;
            else if (day >= -7 && day < 0) lastWeek[day + 7] += num(p.durationMin) / 60;
        });
        const r = (v) => Math.round(v * 10) / 10;
        return { title: 'Flight hours', unit: 'h', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            now: thisWeek.map(r), last: lastWeek.map(r) };
    }

    function pilotPanel(list) {
        const me = live.me && live.me.pilot;
        const roster = arr(live.roster && live.roster.roster);
        const member = live.picked || (list[0] && list[0].memberId) || (me && me.memberId) || '';
        const m = roster.find((x) => String(x.id) === String(member)) || {};
        const theirs = list.filter((p) => String(p.memberId) === String(member));
        const last = theirs[0];
        const name = m.name || (last && last.pilotName) || (me && String(me.memberId) === String(member) ? me.name : '') || '';
        if (!member || !name) {
            return { member: '', name: 'No pilot yet', base: 'Flight reports bring their pilot here.', ifc: '—', joined: '—', discord: '—', id: '', initials: '—' };
        }
        const hours = m.hours != null ? num(m.hours) : num(me && me.hours);
        const tier = rankName(m.rank) || rankName(rankFor(hours));
        const joinedAt = m.joinedAt || m.createdAt;
        const status = last ? last.status : '';
        return {
            member: String(member), name, tier, initials: initials(name).toUpperCase(),
            callsign: m.callsign || (last && last.callsign) || '',
            timer: last ? hhmm(last.durationMin) : '',
            state: status ? (STATUS[status] || status).toUpperCase() : (m.status && m.status !== 'active' ? String(m.status).toUpperCase() : ''),
            stateQuiet: status !== 'pending',
            base: [Math.round(hours).toLocaleString() + ' h', theirs.length + ' recent flight' + (theirs.length === 1 ? '' : 's'),
                arr(m.aircraft).slice(0, 3).join(', ')].filter(Boolean).join(' · '),
            ifc: m.ifcUsername || m.ifc || m.ifcName || '—',
            joined: joinedAt ? new Date(joinedAt).toLocaleDateString() : '—',
            discord: m.discordUsername || m.discord || m.discordName || '—',
            id: 'ID: ' + String(member).replace(/[^a-z0-9-]/gi, '').slice(-12).toUpperCase(),
        };
    }

    function conversations() {
        const msgs = arr(live.inbox && live.inbox.messages).slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        const item = (n, i) => ({
            who: n.senderName || 'Crew centre', text: n.title || n.body || '', fresh: !n.readAt, tone: i,
            at: n.createdAt ? new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
        });
        const unread = msgs.filter((n) => !n.readAt), earlier = msgs.filter((n) => n.readAt);
        const groups = [];
        if (unread.length) groups.push({ name: 'Unread', items: unread.map(item) });
        if (earlier.length) groups.push({ name: 'Earlier', items: earlier.slice(0, 12).map((n, i) => item(n, i + unread.length)) });
        return {
            count: msgs.length, unread: unread.length, groups,
            note: live.noInbox ? 'Staff logins have no inbox of their own. Start new to write to your crew.'
                : !live.loaded ? 'Loading…' : msgs.length ? '' : 'No messages yet.',
            help: { title: 'Getting your crew centre ready', body: 'The setup guide walks through ranks, fleet, routes and your first pilots.' },
        };
    }

    function greeting(name) {
        const h = new Date().getHours();
        const part = h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
        const first = String(name || '').trim().split(/\s+/)[0];
        return part + (first ? ', ' + first : '') + '.';
    }

    // The hero: who is here, how far they have come, what they fly.
    function heroLive(list, cards) {
        const me = live.me || {};
        const p = me.pilot;
        const s = session();
        const hours = num(p && p.hours);
        const steps = ladder();
        const rank = (arr(me.badges).find((b) => b.kind === 'rank') || {}).name || rankName(p && rankFor(hours));
        const nextRank = p ? steps.find((r) => num(r.minHours) > hours) : null;
        const cur = p ? rankFor(hours) : null;
        const mine = p ? list.filter((x) => String(x.memberId) === String(p.memberId)) : [];
        // What to draw: their own last aircraft, else the next one they are
        // flying towards, else what the airline flies most.
        const routes = arr(live.routes && live.routes.routes);
        const counts = {};
        routes.forEach((r) => { if (r.aircraft) counts[r.aircraft] = (counts[r.aircraft] || 0) + 1; });
        const common = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || '';
        const nextAc = (cards.find((c) => c.aircraft) || {}).aircraft || '';
        const last = mine[0];
        const aircraft = (last && last.aircraftName) || common || nextAc;
        const caption = last && last.aircraftName
            ? 'Last flown · ' + [last.flightNumber || last.callsign, (last.origin || '—') + ' → ' + (last.destination || '—')].filter(Boolean).join(' · ')
            : aircraft === common && common ? 'The airline’s workhorse' : aircraft ? 'Next to unlock' : '';
        return {
            greeting: greeting((p && p.name) || s.name),
            rank: rank || (p ? '' : String(s.role || 'staff').replace(/^./, (c) => c.toUpperCase())),
            hours: p ? hours : null, flights: p ? mine.length : null,
            next: nextRank ? { name: nextRank.name, at: num(nextRank.minHours), from: num(cur && cur.minHours) } : null,
            aircraft, caption, member: p ? String(p.memberId || '') : '',
        };
    }

    function liveContent(br) {
        const list = flightRows();
        const cards = [crewCard(br)].concat(unlockCards());
        const pilot = pilotPanel(list);
        return {
            hero: heroLive(list, cards),
            tabs: DEMO.tabs, tab: DEMO.tab, cta: DEMO.cta,
            cards,
            chart: weekChart(list),
            flights: list.slice(0, 4).map((p) => ({
                member: p.memberId ? String(p.memberId) : '',
                icon: STATUS_ICON[p.status] || 'plane',
                flight: p.flightNumber || p.callsign || p.pilotName || '—',
                route: (p.origin || '—') + ' → ' + (p.destination || '—'),
                when: (() => { const t = whenOf(p); return +t ? [t.toLocaleDateString(), t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })] : ['—', '']; })(),
                block: p.durationMin != null ? dur(p.durationMin) : '—',
                ac: p.aircraftName || '—',
                status: STATUS[p.status] || p.status || '—',
            })),
            flightsEmpty: !live.loaded ? 'Loading flight reports…' : 'No flight reports yet.',
            pending: list.filter((p) => p.status === 'pending').length,
            pilot,
            convos: conversations(),
        };
    }

    function icons() { try { if (global.lucide) global.lucide.createIcons(); } catch (_) {} }

    /* ---------------------------------------------------------------------
     * The chart: dashed rules, two smooth lines (this week bright, last week
     * dim), and a ring on this week's line where there was flying. Plain SVG —
     * no library for a week of numbers. `min`/`max` fix the scale; otherwise
     * it is worked out from the numbers, so a quiet crew's week is not a flat
     * line along the floor.
     * ------------------------------------------------------------------- */
    function chartSvg(c) {
        const W = 420, H = 190, L = 30, T = 8, B = 160;
        const all = c.now.concat(c.last);
        const top = Math.max.apply(null, all.concat([1]));
        const MIN = c.min != null ? c.min : 0;
        const MAX = c.max != null ? c.max : (top <= 4 ? 4 : Math.ceil(top / 4) * 4);
        const y = (v) => B - ((v - MIN) / (MAX - MIN)) * (B - T);
        const x = (i, n) => L + (i / (n - 1)) * (W - L);
        const path = (vals) => {
            const p = vals.map((v, i) => [x(i, vals.length), y(v)]);
            let d = 'M' + p[0][0].toFixed(1) + ' ' + p[0][1].toFixed(1);
            for (let i = 1; i < p.length; i++) {
                const [x0, y0] = p[i - 1], [x1, y1] = p[i], mx = (x0 + x1) / 2;
                d += ' C' + mx.toFixed(1) + ' ' + y0.toFixed(1) + ' ' + mx.toFixed(1) + ' ' + y1.toFixed(1) + ' ' + x1.toFixed(1) + ' ' + y1.toFixed(1);
            }
            return d;
        };
        const unit = c.unit || '';
        let g = '';
        for (let k = 4; k >= 0; k--) {
            const v = MIN + ((MAX - MIN) * k) / 4;
            g += '<line x1="' + L + '" x2="' + W + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="#5a5856" stroke-dasharray="5 5" stroke-width="1"/>'
                + '<text x="0" y="' + (y(v) + 4) + '">' + (Math.round(v * 10) / 10) + unit + '</text>';
        }
        const n = c.days.length;
        c.days.forEach((d, i) => {
            const cx = n > 1 ? L + 22 + i * ((W - L - 44) / (n - 1)) : W / 2;
            g += '<text x="' + cx.toFixed(1) + '" y="' + (H - 4) + '" text-anchor="middle">' + esc(d) + '</text>';
        });
        const rings = (c.rings || c.now.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0)).map((i) =>
            '<circle cx="' + x(i, c.now.length).toFixed(1) + '" cy="' + y(c.now[i]).toFixed(1) + '" r="4.5" class="cc-ring" stroke-width="1.6"/>').join('');
        return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(c.title) + ', this week against last week">'
            + g
            + '<path d="' + path(c.last) + '" fill="none" class="cc-ln-last" stroke-width="2"/>'
            + '<path d="' + path(c.now) + '" fill="none" class="cc-ln-now" stroke-width="2.2"/>'
            + rings + '</svg>';
    }

    // A person, drawn, for the photo slot until pilots have photos here.
    const FIGURE = '<svg viewBox="0 0 100 100" aria-hidden="true">'
        + '<circle cx="50" cy="36" r="17" fill="#3b1810"/>'
        + '<path d="M14 100c2-24 17-36 36-36s34 12 36 36Z" fill="#2b1f2e"/>'
        + '<path d="M38 66l12 18 12-18" fill="none" stroke="#e8e2da" stroke-width="3"/></svg>';

    /* ---------------------------------------------------------------------
     * The cards. `cardAt` is the one face on; the others follow it round in
     * order, so the first card on edge is always the one that comes next.
     * Pressing a card on edge brings it to the front; pressing the front one
     * moves on to the next. Every card carries a view-transition-name, so
     * where the browser can, each one glides to its new place rather than the
     * stack being redrawn in a blink.
     * ------------------------------------------------------------------- */
    let cardAt = 0;

    function stackHtml(d) {
        const n = d.cards.length;
        const at = ((cardAt % n) + n) % n;
        const logo = d.brand.logo ? '<img class="cc-card-logo" src="' + esc(d.brand.logo) + '" alt="">' : '';
        const vt = (c) => ' style="view-transition-name:cc-card-' + esc(c.id) + '"';
        const more = n > 1 ? ', show the next card' : '';
        return d.cards.map((_, k) => d.cards[(at + k) % n]).map((c, k) => k === 0
            ? '<button type="button" class="cc-card cc-card-front' + (c.locked ? ' is-locked' : '') + '" data-card="' + esc(c.id) + '"'
                + (c.aircraft ? ' data-aircraft="' + esc(c.aircraft) + '"' : '')
                + vt(c) + ' aria-label="' + esc(c.label + ': ' + c.number + (c.top ? ', ' + c.top : '')) + more + '">'
                + (c.aircraft ? '<span class="cc-ac3d-host"></span>' : '')
                + '<span class="cc-bank">' + (c.locked ? ic('lock') : '') + '<span>' + esc(c.top) + '</span>' + logo + '</span>'
                + '<span class="cc-num">' + esc(c.number) + '</span>'
                + (c.meta ? '<span class="cc-meta">' + esc(c.meta) + '</span>' : '')
                + '<span class="cc-foot"><span>' + esc(c.left) + '</span><span>' + esc(c.right) + '</span></span></button>'
            : '<button type="button" class="cc-card cc-card-back" data-card="' + esc(c.id) + '"'
                + vt(c) + ' aria-label="Show ' + esc(c.label + ': ' + c.number) + '">'
                + '<b>' + esc(c.number) + '</b><span>' + esc(c.label) + '<small>' + esc(c.tag) + '</small></span></button>'
        ).join('');
    }

    /* The aircraft on the card face on, in 3D (crewAircraft3D.js — fetched,
     * with three.js, only once an aircraft card is actually face on). */
    let viewerP = null;
    function viewer() {
        if (global.CrewAircraft3D) return Promise.resolve(global.CrewAircraft3D);
        if (!viewerP) {
            viewerP = new Promise((resolve) => {
                const s = doc.createElement('script');
                s.src = '/crewAircraft3D.js';
                s.onload = () => resolve(global.CrewAircraft3D || null);
                s.onerror = () => { viewerP = null; resolve(null); };
                doc.head.appendChild(s);
            });
        }
        return viewerP;
    }
    function model() {
        // The livery is the airline's own colour, as it is — a navy livery
        // is navy paint on a white aeroplane, not the lifted shade the dark
        // board uses for text.
        const accent = brandOf(branding).accent;
        const front = doc.querySelector('#crewConsole .cc-card-front[data-aircraft]');
        if (front) {
            viewer().then((V) => V && V.attach(front.querySelector('.cc-ac3d-host'), front.getAttribute('data-aircraft'), { accent }))
                .then((ok) => { if (ok) front.classList.add('has-model'); })
                .catch(() => {});
        }
        const sky = doc.querySelector('#crewConsole .cc-hero-plane[data-hero-aircraft]');
        if (sky) {
            viewer().then((V) => V && V.hero(sky, sky.getAttribute('data-hero-aircraft'), { accent }))
                .then((ok) => { if (ok) sky.closest('.cc-hero').classList.add('has-model'); })
                .catch(() => {});
        }
    }

    function showCard(id) {
        const el = doc.querySelector('#crewConsole .cc-stack');
        if (!el) return;
        const d = content();
        const i = d.cards.findIndex((c) => c.id === id);
        if (i < 0) return;
        const n = d.cards.length;
        cardAt = i === ((cardAt % n) + n) % n ? i + 1 : i;   // the front one moves on
        const swap = () => { el.innerHTML = stackHtml(d); el.scrollLeft = 0; icons(); model(); };
        const still = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!still && typeof doc.startViewTransition === 'function') {
            try { doc.startViewTransition(swap); return; } catch (_) {}
        }
        swap();
    }

    /* ---------------------------------------------------------------------
     * Where each control goes. Every one opens a part of the dashboard that is
     * already there (its own drawers and panels sit above this shell), so the
     * Console is a new front door rather than a second copy of the house.
     * A name the page does not define is a control that does nothing — the
     * dashboard decides who may open what, exactly as it does from its own.
     * ------------------------------------------------------------------- */
    const TAB_ACTS = ['openRecruit', 'openFleet', 'openRoutes', 'openPireps', 'openEvents', 'openAwards', '@command'];
    const CALLS = [
        { act: 'openLogbook', icon: 'book-open', label: 'Logbook', pilot: true },
        { act: 'openRoster', icon: 'user-plus', label: 'Roster' },
        { act: 'openTraining', icon: 'graduation-cap', label: 'Training' },
        { act: 'openInbox', icon: 'message-circle', label: 'Message' },
        { act: 'openSettings', icon: 'sliders-horizontal', label: 'Settings' },
    ];

    function act(name, arg) {
        if (name === '@command') {
            if (global.CrewCommand && typeof global.CrewCommand.open === 'function') global.CrewCommand.open();
            return;
        }
        if (name === '@refresh') { load(true); return; }
        if (name === '@top') { const el = doc.getElementById('crewConsole'); if (el) el.scrollTo({ top: 0, behavior: 'smooth' }); return; }
        const fn = global[name];
        if (typeof fn === 'function') { try { fn(arg); } catch (_) {} }
    }

    /* The hero: the aeroplane in the airline's livery, flying, over a sky lit
     * in the airline's colour — and the pilot's own place in it. */
    function heroHtml(d) {
        const h = d.hero;
        if (!h) return '';
        const n = h.next;
        const pct = n && n.at > n.from ? Math.max(0, Math.min(100, ((num(h.hours) - n.from) / (n.at - n.from)) * 100)) : 100;
        const left = n ? Math.max(0, Math.ceil(n.at - num(h.hours))) : 0;
        const stat = (v, k) => (v == null ? '' : '<span class="cc-hstat"><b>' + esc(v) + '</b>' + esc(k) + '</span>');
        return '<div class="cc-hero">'
            + '<div class="cc-sky" aria-hidden="true"><i class="cc-stars"></i><i class="cc-cloud c1"></i><i class="cc-cloud c2"></i><i class="cc-cloud c3"></i><i class="cc-glow"></i></div>'
            + '<div class="cc-hero-plane"' + (h.aircraft ? ' data-hero-aircraft="' + esc(h.aircraft) + '"' : '') + '></div>'
            + '<div class="cc-hero-copy">'
            +   '<span class="cc-eyebrow">' + esc((d.brand.name || 'Crew centre').toUpperCase()) + '</span>'
            +   '<h1 class="cc-hero-title">' + esc(h.greeting) + '</h1>'
            +   '<div class="cc-hstats">'
            +     (h.rank ? '<span class="cc-hstat cc-hrank">' + ic('sparkle') + esc(h.rank) + '</span>' : '')
            +     stat(h.hours == null ? null : Math.round(h.hours).toLocaleString(), ' hours')
            +     stat(h.flights, ' recent flights')
            +   '</div>'
            +   (n ? '<div class="cc-hprog"><div class="cc-hprog-row"><span>Next: <b>' + esc(n.name) + '</b></span><span>' + left.toLocaleString() + ' h to go</span></div>'
                + '<div class="cc-hbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(pct) + '" aria-label="Progress to ' + esc(n.name) + '"><i style="width:' + pct.toFixed(1) + '%"></i></div></div>' : '')
            +   '<div class="cc-hcta">'
            +     '<button type="button" class="cc-hbtn is-main" data-cc-act="openSchedule">' + ic('plane-takeoff') + 'Book a flight</button>'
            +     '<button type="button" class="cc-hbtn" data-cc-act="openPirepForm">' + ic('clipboard-pen') + 'File a flight</button>'
            +     (h.member ? '<button type="button" class="cc-hbtn" data-cc-act="openLogbook" data-cc-arg="' + esc(h.member) + '">' + ic('book-open') + 'Logbook</button>' : '')
            +   '</div>'
            + '</div>'
            + (h.aircraft ? '<div class="cc-hero-tag"><b>' + esc(h.aircraft) + '</b>' + (h.caption ? '<span>' + esc(h.caption) + '</span>' : '') + '</div>' : '')
            + '</div>';
    }

    function html(d) {
        const tabs = d.tabs.map((t, i) => '<button type="button" role="tab" class="cc-tab" data-cc-act="' + TAB_ACTS[i] + '" aria-selected="' + (i === d.tab) + '">' + esc(t) + '</button>').join('');

        const rows = d.flights.length ? d.flights.map((f) => '<tr' + (f.member ? ' data-cc-pilot="' + esc(f.member) + '"' : '')
            + (f.member && f.member === d.pilot.member ? ' class="is-picked"' : '') + '>'
            + '<td class="cc-c-flight"><span class="cc-who"><span class="cc-ico">' + ic(f.icon) + '</span>' + esc(f.flight) + '</span></td>'
            + '<td class="cc-c-route">' + esc(f.route) + '</td>'
            + '<td class="cc-c-when">' + esc(f.when[0]) + ' <b>' + esc(f.when[1]) + '</b></td>'
            + '<td class="cc-c-block">' + esc(f.block) + '</td>'
            + '<td class="cc-c-ac">' + esc(f.ac) + '</td>'
            + '<td class="cc-c-status">' + esc(f.status) + '</td></tr>').join('')
            : '<tr class="cc-empty"><td colspan="6">' + esc(d.flightsEmpty || 'No flight reports yet.') + '</td></tr>';

        const groups = d.convos.groups.map((g, gi) => '<div class="cc-sec">' + esc(g.name) + '</div>'
            + g.items.map((m) => '<div class="cc-msg' + (m.fresh ? ' is-new' : '') + (m.old ? ' is-old' : '') + '" data-cc-act="openInbox">'
                + '<span class="cc-av" style="background:' + TONES[m.tone % TONES.length] + '">' + esc(initials(m.who)) + '</span>'
                + '<span class="cc-msg-name">' + esc(m.who) + '</span><time>' + esc(m.at) + '</time>'
                + '<p>' + esc(m.text) + '</p></div>').join('')
            + (gi < d.convos.groups.length - 1 ? '<div class="cc-div"></div>' : '')).join('')
            + (d.convos.note ? '<p class="cc-note">' + esc(d.convos.note) + '</p>' : '');

        const p = d.pilot;
        const pip = (show) => (show ? '<span class="cc-pip"></span>' : '');
        const unread = d.convos.unread == null ? true : d.convos.unread > 0;
        return ''
        + '<aside class="cc-rail" aria-label="Sections">'
        +   logoHtml(d.brand)
        +   '<nav class="cc-rail-nav">'
        +     '<button type="button" class="cc-rail-btn" aria-current="page" title="Home" data-cc-act="@top">' + ic('house') + '</button>'
        +     '<button type="button" class="cc-rail-btn" title="Notices" data-cc-act="openNotices">' + ic('voicemail') + '</button>'
        +     '<button type="button" class="cc-rail-btn" title="Inbox" data-cc-inbox data-cc-act="openInbox">' + ic('inbox') + pip(unread) + '</button>'
        +     '<button type="button" class="cc-rail-btn" title="Schedule" data-cc-act="openSchedule">' + ic('calendar') + '</button>'
        +     '<button type="button" class="cc-rail-btn" title="Insights" data-cc-act="openInsights">' + ic('chart-no-axes-column') + '</button>'
        +     '<button type="button" class="cc-rail-btn" title="All sections" data-cc-act="@command">' + ic('layout-grid') + '</button>'
        +   '</nav>'
        +   '<div class="cc-rail-foot">'
        +     '<button type="button" class="cc-rail-btn" title="Leave" data-cc-act="openLeave">' + ic('moon') + '</button>'
        +     '<button type="button" class="cc-rail-btn" title="Settings" data-cc-act="openSettings">' + ic('settings') + '</button>'
        // The way out: crewSkin.js puts the interface switch here, since the
        // dashboard's own top bar is hidden while this shell is up.
        +     '<span data-skin-toggle></span>'
        +     '<button type="button" class="cc-rail-btn" title="Sign out" data-cc-act="logout">' + ic('log-out') + '</button>'
        +   '</div>'
        + '</aside>'

        + '<div class="cc-main">'
        // A phone's own top bar: the switch out and the inbox, which on a
        // phone is a sheet rather than a column. Hidden on anything wider.
        +   '<div class="cc-mhead">'
        +     logoHtml(d.brand)
        +     '<span class="cc-mtitle">' + esc(d.brand.name || 'Crew centre') + '</span>'
        +     '<span data-skin-toggle></span>'
        +     '<button type="button" class="cc-rail-btn" title="Conversations" data-cc-inbox>' + ic('message-circle') + pip(unread) + '</button>'
        +   '</div>'
        +   '<nav class="cc-tabs" role="tablist">' + tabs + '<button type="button" class="cc-tab cc-tab-cta" data-cc-act="openNotices">' + esc(d.cta) + '</button></nav>'

        +   '<section class="cc-board">'
        +     heroHtml(d)
        +     '<div class="cc-top">'
        +       '<div class="cc-stack" role="group" aria-label="Crew ID and the aircraft that open next">' + stackHtml(d) + '</div>'
        +       '<div class="cc-chart"><h2 class="cc-h">Analytics</h2>' + chartSvg(d.chart) + '</div>'
        +     '</div>'
        +     '<div class="cc-scroll"><table class="cc-table">'
        +       '<thead><tr><th>Flight</th><th>Route</th><th>Date and time</th><th>Block</th><th>Aircraft</th><th>Status</th></tr></thead>'
        +       '<tbody>' + rows + '</tbody></table></div>'
        +   '</section>'

        +   '<div class="cc-lower">'
        +     '<section class="cc-panel cc-pilot">'
        +       (p.initials ? '<div class="cc-photo is-initials">' + esc(p.initials) + '</div>' : '<div class="cc-photo">' + FIGURE + '</div>')
        +       '<div>'
        +         '<div class="cc-pills">'
        +           (p.callsign ? '<span class="cc-pill">' + ic('radio') + esc(p.callsign) + (p.timer ? ' - <b>' + esc(p.timer) + '</b>' : '') + '</span>' : '')
        +           (p.state ? '<span class="cc-rec' + (p.stateQuiet ? ' is-quiet' : '') + '">' + esc(p.state) + '</span>' : '')
        +         '</div>'
        +         '<div class="cc-name">' + esc(p.name) + '</div>'
        +         (p.tier ? '<div class="cc-tier">' + ic('sparkle') + esc(p.tier) + '</div>' : '')
        +         '<div class="cc-addr">' + esc(p.base) + '</div>'
        +       '</div>'
        +     '</section>'
        +     '<section class="cc-panel cc-ident">'
        +       '<span class="cc-kv">IFC: <b>' + esc(p.ifc) + '</b></span><span class="cc-id">' + esc(p.id) + '</span>'
        +       '<span class="cc-kv" style="grid-column:1/-1">Joined: <b>' + esc(p.joined) + '</b></span>'
        +       '<span class="cc-kv" style="grid-column:1/-1">Discord: <b>' + esc(p.discord) + '</b></span>'
        +       '<div class="cc-actions">'
        +         '<button type="button" class="cc-btn-w" data-cc-act="openLogbook" data-cc-arg="' + esc(p.member || '') + '"' + (p.member || !d.live ? '' : ' disabled') + '>' + ic('info') + 'See all pilot’s information</button>'
        +         '<button type="button" class="cc-btn-o" data-cc-act="@refresh">' + ic('refresh-cw') + '<span class="cc-lbl">Refresh</span></button>'
        +       '</div>'
        +     '</section>'
        +   '</div>'

        +   '<div class="cc-callbar">'
        +     CALLS.map((c) => '<button type="button" class="cc-cb" data-cc-act="' + c.act + '"'
                + (c.pilot ? ' data-cc-arg="' + esc(p.member || '') + '"' + (p.member || !d.live ? '' : ' disabled') : '') + '>'
                + ic(c.icon) + c.label + '</button>').join('')
        +     '<button type="button" class="cc-end" data-cc-act="openPireps">' + ic('clipboard-check') + 'Review flights'
        +       (d.pending ? ' <span class="cc-count-pill">' + d.pending + '</span>' : '') + '</button>'
        +   '</div>'
        + '</div>'

        + '<aside class="cc-convos" aria-label="Conversations">'
        +   '<div class="cc-convos-head"><h2>Conversations</h2><button type="button" title="Close" data-cc-close>' + ic('x') + '</button></div>'
        +   '<label class="cc-search">' + ic('search') + '<input type="search" placeholder="Search messages" data-cc-search></label>'
        +   '<div class="cc-count"><span>' + d.convos.count + ' conversation' + (d.convos.count === 1 ? '' : 's') + '</span>' + ic('arrow-up-down') + ic('settings-2') + '</div>'
        +   '<div class="cc-convo-scroll">'
        +     '<div class="cc-sec">Help center</div>'
        +     '<button type="button" class="cc-help" data-cc-act="openGuide"><b>' + esc(d.convos.help.title) + '</b><span>' + esc(d.convos.help.body) + '</span></button>'
        +     '<div class="cc-div"></div>'
        +     groups
        +   '</div>'
        +   '<button type="button" class="cc-start" data-cc-act="openInbox">Start new</button>'
        + '</aside>';
    }

    /* ---------------------------------------------------------------------
     * Mount once, the first time the Console is on. Switching away leaves it
     * in the DOM — crewSkin.css hides it — so coming back is instant.
     * ------------------------------------------------------------------- */
    let mounted = false;
    function mount() {
        if (mounted || !on() || !doc.body) return;
        mounted = true;
        fonts();
        const el = doc.createElement('div');
        el.id = 'crewConsole';
        doc.body.appendChild(el);
        render();
        load();

        const phone = () => global.matchMedia && global.matchMedia('(max-width: 720px)').matches;
        el.addEventListener('click', (e) => {
            // The inbox: a sheet on a phone; on a wide screen the column is
            // always up, and the rail's inbox opens the full one.
            const inbox = e.target.closest('[data-cc-inbox]');
            if (inbox && (phone() || !inbox.hasAttribute('data-cc-act'))) { el.classList.add('cc-inbox-open'); return; }
            if (e.target.closest('[data-cc-close]')) { el.classList.remove('cc-inbox-open'); return; }
            const card = e.target.closest('[data-card]');
            if (card) { showCard(card.getAttribute('data-card')); return; }
            // A flight row puts its pilot in the panel below.
            const row = e.target.closest('[data-cc-pilot]');
            if (row) { live.picked = row.getAttribute('data-cc-pilot'); render(); return; }
            const go = e.target.closest('[data-cc-act]');
            if (go && !go.disabled) {
                if (go.closest('.cc-convos')) el.classList.remove('cc-inbox-open');
                act(go.getAttribute('data-cc-act'), go.getAttribute('data-cc-arg') || undefined);
            }
        });
        // Search the conversations as you type.
        el.addEventListener('input', (e) => {
            if (!e.target.matches('[data-cc-search]')) return;
            const q = e.target.value.trim().toLowerCase();
            el.querySelectorAll('.cc-msg').forEach((m) => { m.hidden = !!q && m.textContent.toLowerCase().indexOf(q) === -1; });
        });

        // lucide may still be on its way from the CDN.
        global.addEventListener('load', () => { try { if (global.lucide) global.lucide.createIcons(); } catch (_) {} }, { once: true });
    }

    /** Draw (or redraw) the shell's contents in the current airline's look. */
    function render() {
        const el = doc.getElementById('crewConsole');
        if (!el) return;
        el.innerHTML = html(content());
        paintColour(el);
        if (global.CrewSkin) global.CrewSkin.renderToggles();
        icons();
        model();
    }

    /**
     * The airline's branding record, as the dashboard resolves it. Kept even
     * while the Console is not on, so switching to it later draws it in the
     * airline's look straight away.
     */
    function brand(b) {
        branding = b && typeof b === 'object' ? b : null;
        if (mounted) render();
    }

    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
    if (global.CrewSkin) global.CrewSkin.onChange(() => mount());

    global.CrewConsole = { mount, brand, refresh: () => load(true), demo: DEMO };
})(window);
