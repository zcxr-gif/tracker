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
        card: { airline: 'Skyward Virtual Airlines', number: '0042 1278 5590 3392', role: 'Crew ID', rank: 'CPT' },
        ratings: [
            { label: 'Type rating', code: 'A320 A321 A20N', tag: 'ACTIVE' },
            { label: 'Type rating', code: 'B738 B38M B739', tag: 'ACTIVE' },
            { label: 'Expired', code: 'B744 **** 1234', tag: '' },
            { label: 'Expired', code: 'MD11 **** 5611', tag: '' },
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
        'linear-gradient(150deg,#F06347,#B8321C)', 'linear-gradient(150deg,#4b5563,#1f2937)',
        'linear-gradient(150deg,#a8a29e,#57534e)', 'linear-gradient(150deg,#44403c,#1c1917)',
        'linear-gradient(150deg,#78716c,#292524)', 'linear-gradient(150deg,#7f1d1d,#3f1212)',
    ];
    const initials = (n) => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join('');

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
                + '" r="4.5" fill="#212121" stroke="#E8553B" stroke-width="1.6"/>';
        }).join('');
        return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + c.title + ', Monday to Friday">'
            + g
            + '<path d="' + path(c.last) + '" fill="none" stroke="#7a2a1e" stroke-width="2"/>'
            + '<path d="' + path(c.now) + '" fill="none" stroke="#E8553B" stroke-width="2.2"/>'
            + rings + '</svg>';
    }

    // A person, drawn, for the photo slot until pilots have photos here.
    const FIGURE = '<svg viewBox="0 0 100 100" aria-hidden="true">'
        + '<circle cx="50" cy="36" r="17" fill="#3b1810"/>'
        + '<path d="M14 100c2-24 17-36 36-36s34 12 36 36Z" fill="#2b1f2e"/>'
        + '<path d="M38 66l12 18 12-18" fill="none" stroke="#e8e2da" stroke-width="3"/></svg>';

    function html(d) {
        const tabs = d.tabs.map((t, i) => '<button type="button" role="tab" class="cc-tab" aria-selected="' + (i === d.tab) + '">' + t + '</button>').join('');

        const backs = d.ratings.map((r) => '<div class="cc-card cc-card-back" aria-hidden="true">'
            + '<b>' + r.code + '</b><span>' + r.label + (r.tag ? '<small>' + r.tag + '</small>' : '') + '</span></div>').join('');

        const rows = d.flights.map((f) => '<tr>'
            + '<td><span class="cc-who"><span class="cc-ico">' + ic(f.icon) + '</span>' + f.flight + '</span></td>'
            + '<td>' + f.route + '</td>'
            + '<td>' + f.when[0] + ' <b>' + f.when[1] + '</b></td>'
            + '<td>' + f.block + '</td>'
            + '<td>' + f.ac + '</td>'
            + '<td>' + f.status + '</td></tr>').join('');

        const groups = d.convos.groups.map((g, gi) => '<div class="cc-sec">' + g.name + '</div>'
            + g.items.map((m) => '<div class="cc-msg' + (m.fresh ? ' is-new' : '') + (m.old ? ' is-old' : '') + '">'
                + '<span class="cc-av" style="background:' + TONES[m.tone % TONES.length] + '">' + initials(m.who) + '</span>'
                + '<span class="cc-msg-name">' + m.who + '</span><time>' + m.at + '</time>'
                + '<p>' + m.text + '</p></div>').join('')
            + (gi < d.convos.groups.length - 1 ? '<div class="cc-div"></div>' : '')).join('');

        const p = d.pilot;
        return ''
        + '<aside class="cc-rail" aria-label="Sections">'
        +   '<span class="cc-logo" aria-hidden="true"></span>'
        +   '<nav class="cc-rail-nav">'
        +     '<button type="button" class="cc-rail-btn" aria-current="page" title="Home">' + ic('house') + '</button>'
        +     '<button type="button" class="cc-rail-btn" title="Radio">' + ic('voicemail') + '</button>'
        +     '<button type="button" class="cc-rail-btn" title="Inbox">' + ic('inbox') + '<span class="cc-pip"></span></button>'
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
        +   '<nav class="cc-tabs" role="tablist">' + tabs + '<button type="button" class="cc-tab cc-tab-cta">' + d.cta + '</button></nav>'

        +   '<section class="cc-board">'
        +     '<div class="cc-top">'
        +       '<div class="cc-stack">'
        +         '<div class="cc-card cc-card-front">'
        +           '<span class="cc-bank">' + d.card.airline + '</span>'
        +           '<span class="cc-num">' + d.card.number + '</span>'
        +           '<span class="cc-foot"><span>' + d.card.role + '</span><span>' + d.card.rank + '</span></span>'
        +         '</div>' + backs
        +       '</div>'
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
        +         '<button type="button" class="cc-btn-o">' + ic('refresh-cw') + 'Refresh</button>'
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
        +   '<div class="cc-convos-head"><h2>Conversations</h2><button type="button" title="Close">' + ic('x') + '</button></div>'
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
        el.innerHTML = html(DEMO);
        doc.body.appendChild(el);

        // Toggles in a row look pressed one at a time; nothing more yet.
        el.addEventListener('click', (e) => {
            const tab = e.target.closest('.cc-tab:not(.cc-tab-cta)');
            if (tab) el.querySelectorAll('.cc-tab').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
            const cb = e.target.closest('.cc-cb');
            if (cb) cb.setAttribute('aria-pressed', String(cb.getAttribute('aria-pressed') !== 'true'));
            const rail = e.target.closest('.cc-rail-nav .cc-rail-btn');
            if (rail) el.querySelectorAll('.cc-rail-nav .cc-rail-btn').forEach((b) => b.toggleAttribute('aria-current', b === rail));
        });

        if (global.CrewSkin) global.CrewSkin.renderToggles();
        try { if (global.lucide) global.lucide.createIcons(); } catch (_) {}
        // lucide may still be on its way from the CDN.
        global.addEventListener('load', () => { try { if (global.lucide) global.lucide.createIcons(); } catch (_) {} }, { once: true });
    }

    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
    if (global.CrewSkin) global.CrewSkin.onChange(() => mount());

    global.CrewConsole = { mount, demo: DEMO };
})(window);
