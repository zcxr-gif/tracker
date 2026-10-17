/* ============================================================================
   crewConsole.js — the Console interface's shell (crewSkin.css §18).

   Every other interface re-dresses the dashboard that is already on the page.
   This one is a different arrangement altogether — a dispatcher's desk:

     rail          the sections, as icons, down the left
     tabs          the topics, opening into one dark board
     board         the pilot's crew ID and ratings as a stack of cards, the
                   week's hours as a chart, and their latest flights
     on the line   the pilot being looked at, and what we know about them
     call bar      what can be done to them, all on one row
     inbox         applications, Discord and mail, down the right

   So it is drawn as its own layer over the dashboard, and the dashboard's own
   header and main are hidden while it is up.

   NOT WIRED YET. Everything below is placeholder content laid out to the
   design; nothing is fetched and the buttons only look pressed. When it is
   wired, each block maps onto an endpoint the dashboard already calls (the
   roster, /pireps, the inbox) — the markup is laid out so each one can be
   filled on its own.

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
        // A wallet: the crew ID, then the pilot's type ratings. One is face
        // on; the rest stand on edge behind it, in the order they come next.
        // `top` of the crew ID is the airline's name (see content()).
        cards: [
            { id: 'crew', top: 'Skyward Virtual Airlines', number: '0042 1278 5590 3392', kind: 'Crew ID', tag: 'CPT' },
            { id: 'a320', top: 'Airbus', number: 'A320 A321 A20N', kind: 'Type rating', tag: 'ACTIVE' },
            { id: 'b738', top: 'Boeing', number: 'B738 B38M B739', kind: 'Type rating', tag: 'ACTIVE' },
            { id: 'b744', top: 'Boeing', number: 'B744 **** 1234', kind: 'Expired', tag: 'LAPSED', expired: true },
            { id: 'md11', top: 'McDonnell Douglas', number: 'MD11 **** 5611', kind: 'Expired', tag: 'LAPSED', expired: true },
        ],
        chart: {
            title: 'Flight hours',
            days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
            // Two weeks: this one and the last, both on the same 150–750 scale.
            now: [455, 360, 330, 395, 450, 520, 610, 690, 650, 700],
            last: [390, 470, 520, 460, 440, 470, 520, 540, 560, 590],
        },
        flights: [
            { icon: 'plane-takeoff', flight: 'SKY 214', route: 'London Heathrow → Dubai', when: ['02.06.2026', '08:13 AM'], block: '+ 7.12', ac: 'A20N', status: 'In review' },
            { icon: 'plane', flight: 'SKY 1189', route: 'Dubai → Singapore', when: ['02.06.2026', '06:22 AM'], block: '+ 7.49', ac: 'B38M', status: 'In review' },
            { icon: 'user', flight: '**** 2214', route: 'Transfer of hours', when: ['02.06.2026', '06:07 AM'], block: '+ 37.00', ac: 'MANUAL', status: 'Accepted' },
            { icon: 'landmark', flight: 'Event · JFK', route: 'Group flight', when: ['02.05.2026', '11:54 PM'], block: '+ 3.99', ac: 'A321', status: 'Accepted' },
        ],
        pilot: {
            callsign: 'SKY1278', timer: '04:32', name: 'Brandon Ashton Warren', tier: 'Senior Captain',
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

    /** The placeholder content, in this airline's name and flight code. */
    function content() {
        const br = brandOf(branding);
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
     * The chart: dashed rules, two smooth lines, a ring where this week's line
     * crosses a rule. Plain SVG — no library for five days of numbers.
     * ------------------------------------------------------------------- */
    function chartSvg(c) {
        const W = 420, H = 190, L = 30, T = 8, B = 160, MIN = 150, MAX = 750;
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
        let g = '';
        [750, 600, 450, 300, 150].forEach((v) => {
            g += '<line x1="' + L + '" x2="' + W + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="#5a5856" stroke-dasharray="5 5" stroke-width="1"/>'
                + '<text x="0" y="' + (y(v) + 4) + '">' + v + '</text>';
        });
        c.days.forEach((d, i) => {
            g += '<text x="' + (L + 22 + i * ((W - L - 60) / (c.days.length - 1))) + '" y="' + (H - 4) + '" text-anchor="middle">' + d + '</text>';
        });
        const rings = [[1, 1], [3, 0], [5, 0]].map(([i]) => {
            const v = c.now[i + 1] !== undefined ? (c.now[i] + c.now[i + 1]) / 2 : c.now[i];
            return '<circle cx="' + ((x(i, c.now.length) + x(i + 1, c.now.length)) / 2).toFixed(1) + '" cy="' + y(v).toFixed(1)
                + '" r="4.5" class="cc-ring" stroke-width="1.6"/>';
        }).join('');
        return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + c.title + ', Monday to Friday">'
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
        return d.cards.map((_, k) => d.cards[(at + k) % n]).map((c, k) => k === 0
            ? '<button type="button" class="cc-card cc-card-front' + (c.expired ? ' is-expired' : '') + '" data-card="' + esc(c.id) + '"'
                + vt(c) + ' aria-label="' + esc(c.kind + ' ' + c.number) + ', show the next card">'
                + '<span class="cc-bank"><span>' + esc(c.top) + '</span>' + logo + '</span>'
                + '<span class="cc-num">' + esc(c.number) + '</span>'
                + '<span class="cc-foot"><span>' + esc(c.kind) + '</span><span>' + esc(c.tag) + '</span></span></button>'
            : '<button type="button" class="cc-card cc-card-back" data-card="' + esc(c.id) + '"'
                + vt(c) + ' aria-label="Show ' + esc(c.kind + ' ' + c.number) + '">'
                + '<b>' + esc(c.number) + '</b><span>' + esc(c.kind) + '<small>' + esc(c.tag) + '</small></span></button>'
        ).join('');
    }

    function showCard(id) {
        const el = doc.querySelector('#crewConsole .cc-stack');
        if (!el) return;
        const d = content();
        const i = d.cards.findIndex((c) => c.id === id);
        if (i < 0) return;
        const n = d.cards.length;
        cardAt = i === ((cardAt % n) + n) % n ? i + 1 : i;   // the front one moves on
        const swap = () => { el.innerHTML = stackHtml(d); el.scrollLeft = 0; };
        const still = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!still && typeof doc.startViewTransition === 'function') {
            try { doc.startViewTransition(swap); return; } catch (_) {}
        }
        swap();
    }

    function html(d) {
        const tabs = d.tabs.map((t, i) => '<button type="button" role="tab" class="cc-tab" aria-selected="' + (i === d.tab) + '">' + t + '</button>').join('');

        const rows = d.flights.map((f) => '<tr>'
            + '<td class="cc-c-flight"><span class="cc-who"><span class="cc-ico">' + ic(f.icon) + '</span>' + f.flight + '</span></td>'
            + '<td class="cc-c-route">' + f.route + '</td>'
            + '<td class="cc-c-when">' + f.when[0] + ' <b>' + f.when[1] + '</b></td>'
            + '<td class="cc-c-block">' + f.block + '</td>'
            + '<td class="cc-c-ac">' + f.ac + '</td>'
            + '<td class="cc-c-status">' + f.status + '</td></tr>').join('');

        const groups = d.convos.groups.map((g, gi) => '<div class="cc-sec">' + g.name + '</div>'
            + g.items.map((m) => '<div class="cc-msg' + (m.fresh ? ' is-new' : '') + (m.old ? ' is-old' : '') + '">'
                + '<span class="cc-av" style="background:' + TONES[m.tone % TONES.length] + '">' + initials(m.who) + '</span>'
                + '<span class="cc-msg-name">' + m.who + '</span><time>' + m.at + '</time>'
                + '<p>' + m.text + '</p></div>').join('')
            + (gi < d.convos.groups.length - 1 ? '<div class="cc-div"></div>' : '')).join('');

        const p = d.pilot;
        return ''
        + '<aside class="cc-rail" aria-label="Sections">'
        +   logoHtml(d.brand)
        +   '<nav class="cc-rail-nav">'
        +     '<button type="button" class="cc-rail-btn" aria-current="page" title="Home">' + ic('house') + '</button>'
        +     '<button type="button" class="cc-rail-btn" title="Radio">' + ic('voicemail') + '</button>'
        +     '<button type="button" class="cc-rail-btn" title="Inbox" data-cc-inbox>' + ic('inbox') + '<span class="cc-pip"></span></button>'
        +     '<button type="button" class="cc-rail-btn" title="Schedule">' + ic('calendar') + '</button>'
        +     '<button type="button" class="cc-rail-btn" title="Statistics">' + ic('chart-no-axes-column') + '</button>'
        +     '<button type="button" class="cc-rail-btn" title="All sections">' + ic('layout-grid') + '</button>'
        +   '</nav>'
        +   '<div class="cc-rail-foot">'
        +     '<button type="button" class="cc-rail-btn" title="Theme">' + ic('moon') + '</button>'
        +     '<button type="button" class="cc-rail-btn" title="Settings">' + ic('settings') + '</button>'
        // The way out: crewSkin.js puts the interface switch here, since the
        // dashboard's own top bar is hidden while this shell is up.
        +     '<span data-skin-toggle></span>'
        +     '<button type="button" class="cc-rail-btn" title="Sign out">' + ic('log-out') + '</button>'
        +   '</div>'
        + '</aside>'

        + '<div class="cc-main">'
        // A phone's own top bar: the switch out and the inbox, which on a
        // phone is a sheet rather than a column. Hidden on anything wider.
        +   '<div class="cc-mhead">'
        +     logoHtml(d.brand)
        +     '<span class="cc-mtitle">' + esc(d.brand.name || 'Crew centre') + '</span>'
        +     '<span data-skin-toggle></span>'
        +     '<button type="button" class="cc-rail-btn" title="Conversations" data-cc-inbox>' + ic('message-circle') + '<span class="cc-pip"></span></button>'
        +   '</div>'
        +   '<nav class="cc-tabs" role="tablist">' + tabs + '<button type="button" class="cc-tab cc-tab-cta">' + d.cta + '</button></nav>'

        +   '<section class="cc-board">'
        +     '<div class="cc-top">'
        +       '<div class="cc-stack" role="group" aria-label="Crew ID and type ratings">' + stackHtml(d) + '</div>'
        +       '<div class="cc-chart"><h2 class="cc-h">Analytics</h2>' + chartSvg(d.chart) + '</div>'
        +     '</div>'
        +     '<div class="cc-scroll"><table class="cc-table">'
        +       '<thead><tr><th>Flight</th><th>Route</th><th>Date and time</th><th>Block</th><th>Aircraft</th><th>Status</th></tr></thead>'
        +       '<tbody>' + rows + '</tbody></table></div>'
        +   '</section>'

        +   '<div class="cc-lower">'
        +     '<section class="cc-panel cc-pilot">'
        +       '<div class="cc-photo">' + FIGURE + '</div>'
        +       '<div>'
        +         '<div class="cc-pills"><span class="cc-pill">' + ic('radio') + p.callsign + ' - <b>' + p.timer + '</b></span><span class="cc-rec">LIVE</span></div>'
        +         '<div class="cc-name">' + p.name + '</div>'
        +         '<div class="cc-tier">' + ic('sparkle') + p.tier + '</div>'
        +         '<div class="cc-addr">' + p.base + '</div>'
        +       '</div>'
        +     '</section>'
        +     '<section class="cc-panel cc-ident">'
        +       '<span class="cc-kv">IFC: <b>' + p.ifc + '</b></span><span class="cc-id">' + p.id + '</span>'
        +       '<span class="cc-kv" style="grid-column:1/-1">Joined: <b>' + p.joined + '</b></span>'
        +       '<span class="cc-kv" style="grid-column:1/-1">Discord: <b>' + p.discord + '</b></span>'
        +       '<div class="cc-actions">'
        +         '<button type="button" class="cc-btn-w">' + ic('info') + 'See all pilot’s information</button>'
        +         '<button type="button" class="cc-btn-o">' + ic('refresh-cw') + '<span class="cc-lbl">Refresh</span></button>'
        +       '</div>'
        +     '</section>'
        +   '</div>'

        +   '<div class="cc-callbar">'
        +     '<button type="button" class="cc-cb" aria-pressed="false">' + ic('pause') + 'Hold</button>'
        +     '<button type="button" class="cc-cb" aria-pressed="true">' + ic('user-plus') + 'Add</button>'
        +     '<button type="button" class="cc-cb" aria-pressed="false">' + ic('mic-off') + 'Mute</button>'
        +     '<button type="button" class="cc-cb" aria-pressed="false">' + ic('message-circle') + 'Message</button>'
        +     '<button type="button" class="cc-cb" aria-pressed="false">' + ic('sliders-horizontal') + 'Settings</button>'
        +     '<button type="button" class="cc-end">' + ic('phone-off') + 'End review</button>'
        +   '</div>'
        + '</div>'

        + '<aside class="cc-convos" aria-label="Conversations">'
        +   '<div class="cc-convos-head"><h2>Conversations</h2><button type="button" title="Close" data-cc-close>' + ic('x') + '</button></div>'
        +   '<label class="cc-search">' + ic('search') + '<input type="search" placeholder="Search by assigned to you"></label>'
        +   '<div class="cc-count"><span>' + d.convos.count + ' conversations</span>' + ic('arrow-up-down') + ic('settings-2') + '</div>'
        +   '<div class="cc-convo-scroll">'
        +     '<div class="cc-sec">Help center</div>'
        +     '<div class="cc-help"><b>' + d.convos.help.title + '</b><span>' + d.convos.help.body + '</span></div>'
        +     '<div class="cc-div"></div>'
        +     groups
        +   '</div>'
        +   '<button type="button" class="cc-start">Start new</button>'
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

        // Toggles in a row look pressed one at a time; nothing more yet.
        el.addEventListener('click', (e) => {
            // The inbox sheet (phones only; on a wide screen it is always up).
            if (e.target.closest('[data-cc-inbox]')) el.classList.add('cc-inbox-open');
            if (e.target.closest('[data-cc-close]')) el.classList.remove('cc-inbox-open');
            const tab = e.target.closest('.cc-tab:not(.cc-tab-cta)');
            if (tab) el.querySelectorAll('.cc-tab').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
            const card = e.target.closest('[data-card]');
            if (card) showCard(card.getAttribute('data-card'));
            const cb = e.target.closest('.cc-cb');
            if (cb) cb.setAttribute('aria-pressed', String(cb.getAttribute('aria-pressed') !== 'true'));
            const rail = e.target.closest('.cc-rail-nav .cc-rail-btn');
            if (rail) el.querySelectorAll('.cc-rail-nav .cc-rail-btn').forEach((b) => b.toggleAttribute('aria-current', b === rail));
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
        try { if (global.lucide) global.lucide.createIcons(); } catch (_) {}
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

    global.CrewConsole = { mount, brand, demo: DEMO };
})(window);
