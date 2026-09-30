/* ============================================================================
   crewAirline.js — the objects an airline hands its people, drawn as
   themselves. Part of the Airline interface (crewSkin.css §17).

     CrewAirline.mountBoard(host, { api, branding })
         DEPARTURES. The schedule's next departures as an airport board —
         time, flight, destination, gate, status — in amber split-flap type.
         A VA that publishes no schedule gets its route network on the board
         instead, so the board is never empty for want of a feature.

     CrewAirline.mountPass(host, { api, branding })
         BOARDING PASS. The pilot's own next booked departure, as a pass with a
         stub: from and to in big letters, flight, date, gate, boarding time,
         and a barcode. No booking: a pass-shaped invitation to book one.

     CrewAirline.mountCrewCard(host, { api, branding })
         CREW ID. The pilot's card: the airline's livery and logo, their name,
         rank, callsign and hours, and a barcode off their member number.

   All three are real data, from the endpoints the crew centre already has —
   /schedules, /routes and /me/badges. Nothing is invented: a figure the
   server did not send is left off the card rather than made up.

   They draw only while the Airline interface is on (the hosts carry
   `.al-only`), and fetch only then: a crew on another interface pays nothing.
   Switching to Airline from the top bar draws them on the spot.
   ========================================================================== */

(function (global) {
    'use strict';

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const on = () => document.documentElement.getAttribute('data-skin') === 'airline';
    const https = (u) => /^https:\/\/[^\s"'<>()\\]+$/i.test(String(u || ''));
    const pending = [];

    function styles() {
        if (document.getElementById('crew-airline-styles')) return;
        const s = document.createElement('style');
        s.id = 'crew-airline-styles';
        s.textContent = `
        .alb{ background:#0E1116; color:#E8ECF2; border-radius:.6rem; overflow:hidden; box-shadow:0 18px 40px -28px rgb(0 0 0 / .8); }
        .alb-head{ display:flex; align-items:center; gap:.7rem; padding:.8rem 1rem; background:linear-gradient(100deg, var(--accent,#C8102E), color-mix(in srgb, var(--accent,#C8102E) 55%, #0B1A33)); color:#fff; }
        .alb-head b{ font-size:.95rem; letter-spacing:.2em; text-transform:uppercase; }
        .alb-head span{ margin-left:auto; font:700 .85rem/1 ui-monospace,Menlo,monospace; letter-spacing:.1em; }
        .alb table{ width:100%; border-collapse:collapse; font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace; }
        .alb th{ text-align:left; font-size:.62rem; letter-spacing:.18em; color:#8791A3; font-weight:700; padding:.55rem .8rem; border-bottom:1px solid #1F2530; }
        .alb td{ padding:.5rem .8rem; border-bottom:1px solid #161B24; font-size:.9rem; letter-spacing:.08em; white-space:nowrap; }
        .alb tr:last-child td{ border-bottom:0; }
        .alb .fl{ color:#FFC53D; }
        .alb .ch{ display:inline-block; min-width:.62em; text-align:center; background:#151A22; border-radius:2px; margin-right:1px;
            box-shadow:inset 0 -1px 0 #0A0D12, inset 0 1px 0 #202733; animation:alFlip .5s both; }
        @keyframes alFlip{ 0%{ transform:rotateX(90deg); opacity:.2 } 60%{ transform:rotateX(-12deg) } 100%{ transform:none; opacity:1 } }
        @media (prefers-reduced-motion: reduce){ .alb .ch{ animation:none } }
        .alb .st{ font-size:.72rem; font-weight:800; letter-spacing:.14em; }
        .alb .st-board{ color:#4ADE80; animation:alBlink 1.2s steps(2) infinite; }
        .alb .st-full{ color:#FB923C; } .alb .st-cxl{ color:#F87171; } .alb .st-dep{ color:#8791A3; } .alb .st-ok{ color:#E8ECF2; }
        @keyframes alBlink{ 50%{ opacity:.35 } }
        .alb-empty{ padding:1.4rem 1rem; color:#8791A3; font:600 .85rem/1.4 ui-monospace,Menlo,monospace; letter-spacing:.06em; }
        .alb-scroll{ overflow-x:auto; }

        .alp{ display:grid; grid-template-columns:1fr 9.5rem; background:var(--surface,#fff); color:var(--ink,#0B1A33); border-radius:.9rem; overflow:hidden;
            box-shadow:0 1px 2px rgb(11 26 51 / .08), 0 22px 44px -30px rgb(11 26 51 / .6); position:relative; min-height:13rem; }
        .alp-main{ padding:0; display:flex; flex-direction:column; }
        .alp-top{ display:flex; align-items:center; gap:.6rem; padding:.7rem 1rem; background:linear-gradient(100deg, var(--accent,#C8102E), color-mix(in srgb, var(--accent,#C8102E) 55%, #0B1A33)); color:#fff; }
        .alp-top img{ height:1.6rem; width:auto; max-width:6rem; object-fit:contain; background:#fff; border-radius:.3rem; padding:.1rem .25rem; }
        .alp-top b{ font-size:.8rem; letter-spacing:.14em; text-transform:uppercase; }
        .alp-top span{ margin-left:auto; font-size:.66rem; font-weight:800; letter-spacing:.22em; opacity:.9; }
        .alp-route{ display:flex; align-items:center; gap:.8rem; padding:.9rem 1rem .4rem; }
        .alp-code{ font-size:2.3rem; font-weight:900; letter-spacing:-.02em; line-height:1; }
        .alp-city{ font-size:.66rem; color:var(--muted,#4D5B73); font-weight:700; letter-spacing:.12em; text-transform:uppercase; margin-top:.2rem; }
        .alp-plane{ flex:1; display:flex; align-items:center; gap:.3rem; color:var(--accent,#C8102E); }
        .alp-plane::before,.alp-plane::after{ content:''; flex:1; border-top:2px dotted color-mix(in srgb, var(--ink,#0B1A33) 25%, transparent); }
        .alp-grid{ display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:.6rem; padding:.5rem 1rem 1rem; }
        .alp-k{ font-size:.58rem; color:var(--faint,#8391A8); font-weight:800; letter-spacing:.16em; text-transform:uppercase; }
        .alp-v{ font-size:.95rem; font-weight:800; letter-spacing:.02em; font-variant-numeric:tabular-nums; }
        .alp-stub{ border-left:2px dashed color-mix(in srgb, var(--ink,#0B1A33) 18%, transparent); padding:.8rem .8rem; display:flex; flex-direction:column; gap:.45rem; position:relative;
            background:color-mix(in srgb, var(--accent,#C8102E) 5%, var(--surface,#fff)); }
        .alp-stub::before,.alp-stub::after{ content:''; position:absolute; left:-.6rem; width:1.1rem; height:1.1rem; border-radius:50%; background:var(--bg,#EDF1F6); }
        .alp-stub::before{ top:-.55rem; } .alp-stub::after{ bottom:-.55rem; }
        .alp-bar{ margin-top:auto; height:3.2rem; }
        .alp-bar svg{ width:100%; height:100%; display:block; }
        .alp-cta{ margin:.2rem 1rem 1rem; }
        @media (max-width:560px){ .alp{ grid-template-columns:1fr; } .alp-stub{ border-left:0; border-top:2px dashed color-mix(in srgb, var(--ink,#0B1A33) 18%, transparent); flex-direction:row; flex-wrap:wrap; }
            .alp-stub::before,.alp-stub::after{ display:none; } .alp-bar{ width:100%; } .alp-grid{ grid-template-columns:repeat(2,1fr); } }

        .alc{ border-radius:1rem; overflow:hidden; color:#fff; position:relative; min-height:13rem; display:flex; flex-direction:column;
            background:linear-gradient(135deg, var(--accent,#C8102E), color-mix(in srgb, var(--accent,#C8102E) 45%, #0B1A33) 70%);
            box-shadow:0 22px 44px -28px color-mix(in srgb, var(--accent,#C8102E) 80%, #000); }
        .alc::after{ content:''; position:absolute; right:-3rem; top:-3rem; width:12rem; height:12rem; border-radius:50%;
            background:radial-gradient(circle, rgb(255 255 255 / .18), transparent 70%); pointer-events:none; }
        .alc-top{ display:flex; align-items:center; gap:.6rem; padding:.9rem 1.1rem .4rem; }
        .alc-top img{ height:2rem; width:auto; max-width:7rem; object-fit:contain; background:#fff; border-radius:.35rem; padding:.15rem .3rem; }
        .alc-top b{ font-size:.8rem; letter-spacing:.14em; text-transform:uppercase; }
        .alc-top span{ margin-left:auto; font-size:.62rem; font-weight:900; letter-spacing:.28em; padding:.25rem .5rem; border:1px solid rgb(255 255 255 / .5); border-radius:.3rem; }
        .alc-body{ display:flex; gap:1rem; padding:.6rem 1.1rem 1rem; align-items:center; position:relative; z-index:1; }
        .alc-ph{ width:4.6rem; height:5.6rem; border-radius:.5rem; background:rgb(255 255 255 / .16); border:2px solid rgb(255 255 255 / .55); display:grid; place-items:center; font-size:1.6rem; font-weight:900; flex:none; }
        .alc-name{ font-size:1.25rem; font-weight:900; letter-spacing:-.01em; line-height:1.1; }
        .alc-rank{ display:inline-block; margin-top:.3rem; font-size:.66rem; font-weight:900; letter-spacing:.16em; text-transform:uppercase; background:#fff; color:var(--accent,#C8102E); padding:.18rem .5rem; border-radius:.3rem; }
        .alc-grid{ display:grid; grid-template-columns:repeat(3, auto); gap:.2rem 1.1rem; margin-top:.6rem; }
        .alc-k{ font-size:.55rem; font-weight:800; letter-spacing:.18em; opacity:.75; text-transform:uppercase; }
        .alc-v{ font:800 .95rem/1.1 ui-monospace,Menlo,monospace; letter-spacing:.06em; }
        .alc-bar{ margin-top:auto; background:#fff; padding:.35rem .8rem; display:flex; align-items:center; gap:.8rem; color:#0B1A33; }
        .alc-bar svg{ height:1.8rem; flex:1; }
        .alc-bar b{ font:800 .7rem ui-monospace,Menlo,monospace; letter-spacing:.2em; }
        .al-pair{ display:grid; gap:1rem; grid-template-columns:minmax(0,1fr) minmax(0,1.5fr); }
        @media (max-width:860px){ .al-pair{ grid-template-columns:1fr; } }
        `;
        document.head.appendChild(s);
    }

    /* A barcode from a string: deterministic bars, so the same pass always
       shows the same code. Decoration, not a symbology — nothing scans it. */
    function barcode(text, { height = 40, color = '#0B1A33' } = {}) {
        let h = 2166136261;
        const bars = [];
        const src = String(text || 'crew');
        for (let i = 0; i < 64; i++) {
            h ^= src.charCodeAt(i % src.length) + i;
            h = Math.imul(h, 16777619) >>> 0;
            bars.push(1 + (h % 3));
        }
        let x = 0;
        const rects = bars.map((w, i) => { const r = i % 2 ? '' : `<rect x="${x}" y="0" width="${w}" height="${height}"/>`; x += w; return r; }).join('');
        return `<svg viewBox="0 0 ${x} ${height}" preserveAspectRatio="none" fill="${color}" aria-hidden="true">${rects}</svg>`;
    }

    const pad = (n) => String(n).padStart(2, '0');
    const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const dayLabel = (d) => {
        const now = new Date();
        const same = d.toDateString() === now.toDateString();
        const tmr = new Date(now.getTime() + 864e5).toDateString() === d.toDateString();
        return same ? '' : tmr ? 'TMRW' : d.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase();
    };
    const flap = (text, delay = 0) => String(text || '').toUpperCase().split('').map((c, i) => `<span class="ch" style="animation-delay:${delay + i * 35}ms">${c === ' ' ? '&nbsp;' : esc(c)}</span>`).join('');

    // One read of the schedule and the network per page, shared by the board
    // and the pass — they ask the same question.
    const cache = new Map();
    function once(api, path) {
        if (!cache.has(path)) cache.set(path, api(path).catch((err) => { cache.delete(path); throw err; }));
        return cache.get(path);
    }

    /* ---------------------------------------------------------------------
     * DEPARTURES
     * ------------------------------------------------------------------- */

    async function drawBoard(host, { api, branding }) {
        styles();
        const name = (branding && (branding.code || branding.name)) || 'Departures';
        host.innerHTML = `<div class="alb"><div class="alb-head"><b>Departures</b><span data-al-clock>${hhmm(new Date())}</span></div><div class="alb-empty">LOADING…</div></div>`;
        let sched = null; let routes = [];
        try { sched = await once(api, '/schedules?upcoming=1'); } catch (_) { sched = null; }
        try { routes = ((await once(api, '/routes')).routes) || []; } catch (_) { routes = []; }
        const gate = new Map(routes.map((r) => [String(r.id), r.departureGate || '']));
        const now = Date.now();
        const list = ((sched && sched.schedules) || [])
            .filter((s) => s.departsAt && new Date(s.departsAt).getTime() > now - 30 * 60e3)
            .sort((a, b) => new Date(a.departsAt) - new Date(b.departsAt))
            .slice(0, 8);
        const box = host.querySelector('.alb');
        if (list.length) {
            box.innerHTML = `<div class="alb-head"><b>Departures</b><span data-al-clock>${hhmm(new Date())}</span></div>
                <div class="alb-scroll"><table><thead><tr><th>Time</th><th>Flight</th><th>From</th><th>To</th><th>Gate</th><th>Status</th></tr></thead><tbody>
                ${list.map((s, i) => {
                    const d = new Date(s.departsAt);
                    const mins = (d.getTime() - now) / 60e3;
                    const st = s.status === 'cancelled' ? ['CANCELLED', 'st-cxl']
                        : mins < 0 ? ['DEPARTED', 'st-dep']
                            : mins <= 45 ? ['BOARDING', 'st-board']
                                : s.full ? ['FULL', 'st-full'] : ['ON TIME', 'st-ok'];
                    return `<tr><td class="fl">${flap(hhmm(d), i * 60)}${dayLabel(d) ? ` <small style="color:#8791A3">${esc(dayLabel(d))}</small>` : ''}</td>
                        <td>${flap(s.flightNumber || '—', i * 60 + 80)}</td><td>${flap(s.origin || '', i * 60 + 140)}</td><td class="fl">${flap(s.destination || '', i * 60 + 200)}</td>
                        <td>${flap(gate.get(String(s.routeId)) || '—', i * 60 + 260)}</td><td class="st ${st[1]}">${st[0]}</td></tr>`;
                }).join('')}</tbody></table></div>`;
        } else {
            // No published schedule: the network itself, so the board still
            // says where this airline goes.
            const net = routes.filter((r) => r.active !== false && r.origin && r.destination).slice(0, 8);
            box.innerHTML = `<div class="alb-head"><b>Our network</b><span>${esc(String(name).toUpperCase())}</span></div>
                ${net.length ? `<div class="alb-scroll"><table><thead><tr><th>Flight</th><th>From</th><th>To</th><th>Aircraft</th><th>Gate</th></tr></thead><tbody>
                ${net.map((r, i) => `<tr><td class="fl">${flap(r.flightNumber || '—', i * 60)}</td><td>${flap(r.origin, i * 60 + 80)}</td><td class="fl">${flap(r.destination, i * 60 + 140)}</td>
                    <td style="color:#8791A3;font-size:.78rem">${esc(String(r.aircraft || '').slice(0, 22).toUpperCase())}</td><td>${flap(r.departureGate || '—', i * 60 + 200)}</td></tr>`).join('')}
                </tbody></table></div>` : '<div class="alb-empty">NO DEPARTURES PUBLISHED YET</div>'}`;
        }
    }

    /* ---------------------------------------------------------------------
     * BOARDING PASS
     * ------------------------------------------------------------------- */

    async function drawPass(host, { api, branding }) {
        styles();
        let sched = null; let routes = []; let me = null;
        try { sched = await once(api, '/schedules?upcoming=1'); } catch (_) { sched = null; }
        try { routes = ((await once(api, '/routes')).routes) || []; } catch (_) { routes = []; }
        try { me = await once(api, '/me/badges'); } catch (_) { me = null; }
        const pilot = (me && me.pilot) || null;
        const mine = new Set(((sched && sched.mine) || []).filter((b) => b.status !== 'cancelled').map((b) => String(b.scheduleId)));
        const now = Date.now();
        const next = ((sched && sched.schedules) || [])
            .filter((s) => mine.has(String(s.id)) && s.departsAt && new Date(s.departsAt).getTime() > now - 60 * 60e3 && s.status !== 'cancelled')
            .sort((a, b) => new Date(a.departsAt) - new Date(b.departsAt))[0];
        const logo = branding && https(branding.logo) ? `<img src="${esc(branding.logo)}" alt="">` : '';
        const airline = esc((branding && branding.name) || 'Crew');
        if (!next) {
            host.innerHTML = `<div class="alp"><div class="alp-main">
                <div class="alp-top">${logo}<b>${airline}</b><span>BOARDING PASS</span></div>
                <div class="alp-route"><div><div class="alp-code">— — —</div><div class="alp-city">Where to next?</div></div></div>
                <div class="cp-note" style="padding:0 1rem;color:var(--muted)">You have no departure booked. Take a leg off the schedule and your pass appears here.</div>
                <div class="alp-cta"><button type="button" class="cp-btn cp-btn-primary" data-al-book>Book a flight</button></div>
            </div><div class="alp-stub"><div class="alp-k">Passenger</div><div class="alp-v">${esc((pilot && pilot.name) || '—')}</div><div class="alp-bar">${barcode('empty')}</div></div></div>`;
            const b = host.querySelector('[data-al-book]');
            if (b) b.addEventListener('click', () => { if (typeof global.openSchedule === 'function') global.openSchedule(); });
            return;
        }
        const d = new Date(next.departsAt);
        const boarding = new Date(d.getTime() - 30 * 60e3);
        const g = (routes.find((r) => String(r.id) === String(next.routeId)) || {}).departureGate || '—';
        const date = d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }).toUpperCase();
        host.innerHTML = `<div class="alp"><div class="alp-main">
            <div class="alp-top">${logo}<b>${airline}</b><span>BOARDING PASS</span></div>
            <div class="alp-route">
                <div><div class="alp-code">${esc(next.origin)}</div><div class="alp-city">From</div></div>
                <div class="alp-plane">✈</div>
                <div style="text-align:right"><div class="alp-code">${esc(next.destination)}</div><div class="alp-city">To</div></div>
            </div>
            <div class="alp-grid">
                <div><div class="alp-k">Flight</div><div class="alp-v">${esc(next.flightNumber || '—')}</div></div>
                <div><div class="alp-k">Date</div><div class="alp-v">${esc(date)}</div></div>
                <div><div class="alp-k">Boarding</div><div class="alp-v">${esc(hhmm(boarding))}</div></div>
                <div><div class="alp-k">Departs</div><div class="alp-v">${esc(hhmm(d))}</div></div>
                <div><div class="alp-k">Gate</div><div class="alp-v">${esc(g)}</div></div>
                <div><div class="alp-k">Aircraft</div><div class="alp-v" style="font-size:.78rem">${esc(String(next.aircraft || '—').slice(0, 26))}</div></div>
                <div><div class="alp-k">Seat</div><div class="alp-v">Flight deck</div></div>
                <div><div class="alp-k">Pilot</div><div class="alp-v" style="font-size:.8rem">${esc((pilot && (pilot.callsign || pilot.name)) || '—')}</div></div>
            </div>
        </div>
        <div class="alp-stub">
            <div><div class="alp-k">Passenger</div><div class="alp-v" style="font-size:.85rem">${esc((pilot && pilot.name) || '—')}</div></div>
            <div><div class="alp-k">Flight</div><div class="alp-v">${esc(next.flightNumber || '—')}</div></div>
            <div><div class="alp-k">Route</div><div class="alp-v">${esc(next.origin)} → ${esc(next.destination)}</div></div>
            <div class="alp-bar">${barcode(`${next.id}${pilot ? pilot.memberId : ''}`)}</div>
        </div></div>`;
    }

    /* ---------------------------------------------------------------------
     * CREW ID
     * ------------------------------------------------------------------- */

    async function drawCrewCard(host, { api, branding }) {
        styles();
        let me = null;
        try { me = await once(api, '/me/badges'); } catch (_) { me = null; }
        const pilot = me && me.pilot;
        if (!pilot) { host.innerHTML = ''; return; }
        const rank = ((me.badges || []).find((b) => b.kind === 'rank') || {}).name || '';
        const logo = branding && https(branding.logo) ? `<img src="${esc(branding.logo)}" alt="">` : '';
        const initials = String(pilot.name || pilot.callsign || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
        const id = String(pilot.memberId || '').replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase() || '—';
        host.innerHTML = `<div class="alc" role="img" aria-label="${esc(`Crew ID: ${pilot.name}${rank ? `, ${rank}` : ''}`)}">
            <div class="alc-top">${logo}<b>${esc((branding && branding.name) || 'Airline')}</b><span>CREW</span></div>
            <div class="alc-body">
                <div class="alc-ph">${esc(initials)}</div>
                <div style="min-width:0">
                    <div class="alc-name">${esc(pilot.name || '—')}</div>
                    ${rank ? `<span class="alc-rank">${esc(rank)}</span>` : ''}
                    <div class="alc-grid">
                        <div><div class="alc-k">Callsign</div><div class="alc-v">${esc(pilot.callsign || '—')}</div></div>
                        <div><div class="alc-k">Hours</div><div class="alc-v">${esc(Number(pilot.hours || 0).toLocaleString())}</div></div>
                        <div><div class="alc-k">Base</div><div class="alc-v">${esc((branding && branding.code) || '—')}</div></div>
                    </div>
                </div>
            </div>
            <div class="alc-bar">${barcode(pilot.memberId || pilot.name)}<b>${esc(id)}</b></div>
        </div>`;
    }

    /* ---------------------------------------------------------------------
     * Mounting: draw now if the Airline interface is on, or the moment it is
     * switched on. Drawn once per host; a re-mount redraws.
     * ------------------------------------------------------------------- */
    function mount(fn, host, opts) {
        if (!host || !opts || typeof opts.api !== 'function') return;
        const job = { fn, host, opts, drawn: false };
        pending.push(job);
        const run = () => { if (on() && !job.drawn && host.isConnected) { job.drawn = true; fn(host, opts).catch(() => { job.drawn = false; }); } };
        run();
    }
    if (global.CrewSkin && global.CrewSkin.onChange) {
        global.CrewSkin.onChange(() => {
            pending.forEach((job) => { if (on() && !job.drawn && job.host.isConnected) { job.drawn = true; job.fn(job.host, job.opts).catch(() => { job.drawn = false; }); } });
        });
    }
    // The board's clock ticks.
    setInterval(() => { document.querySelectorAll('[data-al-clock]').forEach((el) => { el.textContent = hhmm(new Date()); }); }, 20e3);

    global.CrewAirline = {
        mountBoard: (host, opts) => mount(drawBoard, host, opts),
        mountPass: (host, opts) => mount(drawPass, host, opts),
        mountCrewCard: (host, opts) => mount(drawCrewCard, host, opts),
        barcode,
    };
})(window);
