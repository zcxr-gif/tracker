/* ============================================================================
   crewLogbook.js — one pilot's flying, opened by their staff.

   WHY THIS EXISTS

   A pilot's hours are the one number in this product that decides things. They
   decide the rank they hold, the club their card wears, what the shop will sell
   them, and whether a rank-gated route is even on their network. And they are
   built by adding up flight reports, most of which arrive from Infinite Flight
   without a human ever having looked at them.

   Which means they are sometimes wrong. A flight that dropped its connection
   ten minutes before the gate is filed at the duration IF recorded, not the
   duration flown. A pilot who sat on a stand with the engines running for forty
   minutes has forty minutes of it in their logbook. A pilot told to file the
   same leg twice has it twice.

   None of that was unusual and none of it was fixable. Staff had exactly three
   verbs — approve, reject, delete — and the tool for "this flight is real but
   it says 4h 10m and it was 3h 20m" was to DELETE the pilot's flight and ask
   them to file it again by hand, which throws away the Infinite Flight record,
   the XP, the violations and the date it was actually flown. It also, in the
   meantime, takes the hours off their rank.

   WHAT THIS IS

   Three screens that are really one screen, opened off a pilot's row on the
   roster:

     THE LOGBOOK   every report that pilot has ever filed, whatever its status,
                   with the arithmetic underneath: what their reports add up
                   to, what the roster row says, and the difference. That last
                   one is the whole point. The question staff actually have is
                   never "what is this one report" — it is "their row says 214
                   hours and their logbook says 197, which is right", and that
                   is not a question you can answer one report at a time.

     ONE FLIGHT    everything on the record, including the things the flight
                   list has never had room for: the livery, the server, the XP,
                   the violations, whether it matched a route, whether it came
                   out of a logbook or out of a form, what it paid, and who has
                   corrected it before.

     A CORRECTION  the duration and the landings, as a form. The hours move
                   with it — the server applies the DIFFERENCE, so a VA's
                   hand-granted hours are not silently absorbed — and the pilot
                   is told.

   AND FILING BY HAND. The same panel files a flight ONTO a pilot, which is the
   other end of the same problem: when the logbook is missing a flight rather
   than wrong about one, the fix is for staff to put it in. Optionally approved
   on the way in, because the person filing it is the person who would press
   Approve one second later.

   WHO. Everything here is `flights.review` — the capability that already
   approves and rejects. A staff member trusted to decide whether a flight
   counts is the one who should be able to say how much of it counts.

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewLogbook: crewPanels.js must load first'); return; }
    const { esc, icons, whenText, relativeText } = P;

    const S = {
        api: null,
        panel: null,
        pilotId: '',
        data: null,       // the logbook as the server sent it
        view: 'list',     // list | flight | edit | file
        flightId: '',
        error: null,
        onChanged: null,  // the page's own "the roster moved" hook
    };

    /* =====================================================================
     * STYLES
     * =================================================================== */

    function styles() {
        P.baseStyles();
        P.style('crew-logbook', `
        /* ---- THE HEAD: who, and the three figures ------------------------
           The drift is the one number on this panel that is an opinion rather
           than a record, so it is the one that is coloured. Zero is not
           "good", it is "these two agree" — which is why it is grey at zero
           and amber otherwise rather than green and red. A VA who granted
           forty hours by hand has a drift of forty and nothing is wrong. */
        .lb-head{ display:flex; align-items:flex-start; gap:.9rem; padding:.2rem 0 .9rem;
            border-bottom:1px solid var(--line,#e5e5e5); margin-bottom:.9rem; }
        .lb-avatar{ width:2.8rem; height:2.8rem; border-radius:999px; flex:none; display:grid;
            place-items:center; font-weight:800; font-size:.9rem;
            background:var(--accent-fill,var(--accent,#1C1A16)); color:var(--accent-ink,#fff); }
        .lb-who{ min-width:0; flex:1; display:grid; gap:.15rem; }
        .lb-name{ font-size:1.05rem; font-weight:800; letter-spacing:-.02em; }
        .lb-sub{ font-size:.75rem; color:var(--muted,#736E64); }
        .lb-figs{ display:grid; grid-template-columns:repeat(3,1fr); gap:.5rem; margin-bottom:1rem; }
        .lb-fig{ border:1px solid var(--line,#e5e5e5); border-radius:.75rem; padding:.6rem .7rem;
            background:var(--surface,#fff); }
        .lb-fig-k{ font-size:.6rem; font-weight:800; letter-spacing:.1em; text-transform:uppercase;
            color:var(--muted,#736E64); }
        .lb-fig-v{ font-size:1.15rem; font-weight:800; letter-spacing:-.02em;
            font-variant-numeric:tabular-nums; margin-top:.15rem; }
        .lb-fig-n{ font-size:.66rem; color:var(--muted,#736E64); margin-top:.1rem; }
        .lb-drift-off .lb-fig-v{ color:#B45309; }
        /* Said in words under the figures, because three numbers and a
           subtraction is not an explanation. */
        .lb-drift-note{ font-size:.75rem; line-height:1.45; color:var(--muted,#736E64);
            background:color-mix(in srgb, #B45309 8%, transparent); border-radius:.6rem;
            padding:.55rem .7rem; margin:-.5rem 0 1rem; }

        /* ---- THE FLIGHTS ------------------------------------------------ */
        .lb-list{ display:grid; gap:.35rem; }
        .lb-row{ display:flex; align-items:center; gap:.7rem; width:100%; text-align:left;
            padding:.6rem .7rem; border-radius:.7rem; cursor:pointer; font:inherit; color:inherit;
            border:1px solid var(--line,#e5e5e5); background:var(--surface,#fff);
            transition:border-color .16s ease; }
        .lb-row:hover{ border-color:color-mix(in srgb, var(--accent) 45%, transparent); }
        .lb-row-main{ flex:1; min-width:0; display:grid; gap:.15rem; }
        .lb-leg{ font-weight:700; letter-spacing:-.01em; font-size:.88rem;
            overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .lb-meta{ font-size:.72rem; color:var(--muted,#736E64);
            overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .lb-time{ font-variant-numeric:tabular-nums; font-weight:700; font-size:.82rem; flex:none; }
        /* The status, as a dot rather than a word: a column of "approved"
           twenty times over is a column nobody reads, and the two that matter
           are the ones that are NOT approved. */
        .lb-dot{ width:.5rem; height:.5rem; border-radius:999px; flex:none; }
        .lb-dot-approved{ background:#16A34A; }
        .lb-dot-pending{ background:#D97706; }
        .lb-dot-rejected{ background:#DC2626; }
        .lb-tabs{ display:flex; gap:.25rem; background:color-mix(in srgb, var(--ink) 6%, transparent);
            border-radius:999px; padding:.2rem; margin-bottom:.8rem; }
        .lb-tab{ flex:1; border:0; background:none; cursor:pointer; font:inherit; font-size:.78rem;
            font-weight:700; padding:.4rem .6rem; border-radius:999px; color:var(--muted,#736E64); }
        .lb-tab-on{ background:var(--surface,#fff); color:var(--ink,#1C1A16);
            box-shadow:0 1px 2px rgb(0 0 0 / .12); }

        /* ---- ONE FLIGHT, IN FULL ---------------------------------------- */
        .lb-back{ display:inline-flex; align-items:center; gap:.3rem; font-size:.75rem; font-weight:700;
            color:var(--muted,#736E64); background:none; border:0; cursor:pointer; font-family:inherit;
            padding:.2rem 0; margin-bottom:.6rem; }
        .lb-back i{ width:.9rem; height:.9rem; }
        .lb-fl-leg{ font-size:1.35rem; font-weight:800; letter-spacing:-.03em; }
        .lb-fl-when{ font-size:.78rem; color:var(--muted,#736E64); margin-top:.1rem; }
        .lb-facts{ display:grid; grid-template-columns:repeat(2,1fr); gap:.4rem; margin:.9rem 0; }
        .lb-fact{ border:1px solid var(--line,#e5e5e5); border-radius:.6rem; padding:.5rem .65rem;
            background:var(--surface,#fff); min-width:0; }
        .lb-fact-k{ font-size:.58rem; font-weight:800; letter-spacing:.1em; text-transform:uppercase;
            color:var(--muted,#736E64); }
        .lb-fact-v{ font-size:.86rem; font-weight:650; margin-top:.1rem;
            overflow:hidden; text-overflow:ellipsis; }
        .lb-edited{ font-size:.73rem; line-height:1.45; color:var(--muted,#736E64);
            border-left:2px solid color-mix(in srgb, var(--accent) 50%, transparent);
            padding:.1rem 0 .1rem .6rem; margin:.2rem 0 .9rem; }
        .lb-actions{ display:flex; flex-wrap:wrap; gap:.4rem; margin-top:.9rem; }

        /* ---- THE CORRECTION FORM ---------------------------------------- */
        /* Hours and minutes as two boxes, not "270". Nobody has ever known
           how many minutes four and a half hours is without stopping to work
           it out, and a field that makes somebody stop is a field they get
           wrong. The live total under it is the check. */
        .lb-hm{ display:grid; grid-template-columns:1fr 1fr; gap:.5rem; }
        .lb-total{ font-size:.78rem; color:var(--muted,#736E64); margin-top:.35rem; }
        .lb-total b{ color:var(--ink,#1C1A16); font-variant-numeric:tabular-nums; }
        .lb-warn{ font-size:.75rem; line-height:1.45; border-radius:.6rem; padding:.55rem .7rem;
            background:color-mix(in srgb, #B45309 9%, transparent); color:var(--ink,#1C1A16);
            margin-top:.7rem; }
        @media (max-width:33rem){
            .lb-figs{ grid-template-columns:1fr; }
            .lb-facts{ grid-template-columns:1fr; }
        }
        `);
    }

    /* =====================================================================
     * SMALL THINGS
     * =================================================================== */

    const initials = (name) => String(name || '').trim().split(/\s+/).slice(0, 2)
        .map((w) => w.charAt(0).toUpperCase()).join('') || '?';

    /** Minutes as a person writes them. `durationText` is the shared one; this
     *  is here because a zero has to read as "0m" and not as nothing. */
    const hm = (min) => {
        const m = Math.max(0, Math.round(Number(min) || 0));
        const h = Math.floor(m / 60), mi = m % 60;
        return h ? `${h}h${mi ? ` ${mi}m` : ''}` : `${mi}m`;
    };
    const hours1 = (n) => (Math.round((Number(n) || 0) * 10) / 10).toLocaleString();
    const num = (n) => (Math.round(Number(n) || 0)).toLocaleString();
    const leg = (f) => [f.origin, f.destination].filter(Boolean).join(' → ')
        || f.flightNumber || 'Flight';

    const flights = () => (S.data && S.data.flights) || [];
    const flightById = (id) => flights().find((f) => String(f.id) === String(id)) || null;

    /* =====================================================================
     * THE LOGBOOK
     * =================================================================== */

    let FILTER = 'all';

    function headHtml() {
        const p = (S.data && S.data.pilot) || {};
        const rank = (S.data && S.data.rank && S.data.rank.name) || '';
        const bits = [p.callsign, rank, p.status && p.status !== 'active' ? p.status : '']
            .filter(Boolean).join(' · ');
        return `<div class="lb-head">
            <span class="lb-avatar">${esc(initials(p.name))}</span>
            <span class="lb-who">
                <span class="lb-name">${esc(p.name || 'Pilot')}</span>
                ${bits ? `<span class="lb-sub">${esc(bits)}</span>` : ''}
                ${p.ifUserId ? '' : '<span class="lb-sub">No Infinite Flight account linked — nothing will arrive on its own.</span>'}
            </span>
        </div>`;
    }

    /**
     * The three figures, and the sentence under them.
     *
     * THE DRIFT IS THE POINT. Staff do not open a logbook to read a list; they
     * open it because a number somewhere else looked wrong. So the two numbers
     * that could disagree are put next to each other and the difference is
     * stated rather than left for somebody to work out.
     *
     * AND IT IS NOT AN ACCUSATION. A drift is not a fault — hours granted by
     * hand when a pilot transferred in, hours edited on the roster row, and
     * reports approved before this product recorded any of it all make one. The
     * sentence says that, because a panel that implies a bug sends somebody
     * looking for one.
     */
    function figuresHtml() {
        const t = (S.data && S.data.totals) || {};
        const drift = Number(t.drift) || 0;
        const off = Math.abs(drift) >= 0.1;
        return `<div class="lb-figs">
            <div class="lb-fig">
                <div class="lb-fig-k">In the logbook</div>
                <div class="lb-fig-v">${hours1(t.flownHours)}h</div>
                <div class="lb-fig-n">${num(t.flights)} approved flight${Number(t.flights) === 1 ? '' : 's'}</div>
            </div>
            <div class="lb-fig">
                <div class="lb-fig-k">On the roster</div>
                <div class="lb-fig-v">${hours1(t.rosterHours)}h</div>
                <div class="lb-fig-n">What their rank is worked out from</div>
            </div>
            <div class="lb-fig${off ? ' lb-drift-off' : ''}">
                <div class="lb-fig-k">Difference</div>
                <div class="lb-fig-v">${drift > 0 ? '+' : ''}${hours1(drift)}h</div>
                <div class="lb-fig-n">${off ? 'Worth a look' : 'They agree'}</div>
            </div>
        </div>
        ${off ? `<div class="lb-drift-note">The roster holds ${drift > 0 ? 'more' : 'less'} than these
            reports add up to. That is not always a fault — hours granted by hand, hours carried over from
            another airline, and flights approved before this crew centre recorded any of it all show up
            here. Correct a flight below, or set the figure on their roster row.</div>` : ''}`;
    }

    const TABS = [
        ['all', 'All'],
        ['pending', 'Waiting'],
        ['approved', 'Approved'],
        ['rejected', 'Rejected'],
    ];

    function tabsHtml() {
        const t = (S.data && S.data.totals) || {};
        const count = { all: t.reports, pending: t.pending, approved: t.flights, rejected: t.rejected };
        return `<div class="lb-tabs">${TABS.map(([k, label]) => `<button type="button"
            class="lb-tab${FILTER === k ? ' lb-tab-on' : ''}" data-lb-tab="${k}">${esc(label)}${
            Number(count[k]) ? ` ${num(count[k])}` : ''}</button>`).join('')}</div>`;
    }

    function rowHtml(f) {
        const when = f.flownAt || f.createdAt;
        const meta = [
            when ? whenText(when) : '',
            f.aircraftName || '',
            Number(f.landings) ? `${num(f.landings)} landing${Number(f.landings) === 1 ? '' : 's'}` : '',
            // Said on the row, because it is the first thing that decides how
            // much to trust the number beside it.
            f.fromLogbook ? 'from Infinite Flight' : 'typed',
            f.editedAt ? 'corrected' : '',
        ].filter(Boolean).join(' · ');
        return `<button type="button" class="lb-row" data-lb-open="${esc(f.id)}">
            <span class="lb-dot lb-dot-${esc(f.status || 'pending')}" aria-hidden="true"></span>
            <span class="lb-row-main">
                <span class="lb-leg">${esc(leg(f))}${f.flightNumber ? ` · ${esc(f.flightNumber)}` : ''}</span>
                <span class="lb-meta">${esc(meta)}</span>
            </span>
            <span class="lb-time">${esc(hm(f.durationMin))}</span>
        </button>`;
    }

    function listHtml() {
        const rows = flights().filter((f) => FILTER === 'all' || f.status === FILTER);
        if (!flights().length) {
            return `${headHtml()}${figuresHtml()}
                <div class="cp-empty"><i data-lucide="book-open"></i>
                    Nothing in this logbook yet. File a flight for them below if one is missing.</div>
                ${fileButtonHtml()}`;
        }
        return `${headHtml()}${figuresHtml()}${tabsHtml()}
            ${rows.length
                ? `<div class="lb-list">${rows.map(rowHtml).join('')}</div>`
                : '<div class="cp-empty"><i data-lucide="filter"></i>Nothing with that status.</div>'}
            ${fileButtonHtml()}`;
    }

    const fileButtonHtml = () => `<div class="lb-actions">
        <button class="cp-btn cp-btn-primary" data-lb-file>
            <i data-lucide="clipboard-pen"></i> File a flight for them
        </button>
    </div>`;

    /* =====================================================================
     * ONE FLIGHT, IN FULL
     *
     * Everything on the record. The flight list has never had room for most of
     * it, and every one of these is a thing staff have at some point had to
     * take somebody's word for: what it was flown in, on which server, whether
     * it matched a route, whether the number came out of Infinite Flight or out
     * of a form, and whether anybody has already corrected it.
     * =================================================================== */

    function factsHtml(f) {
        const facts = [
            ['Time', hm(f.durationMin)],
            ['Landings', num(f.landings)],
            ['Aircraft', f.aircraftName || '—'],
            ['Livery', f.liveryName || '—'],
            ['Flight number', f.flightNumber || '—'],
            ['Flown', f.flownAt ? whenText(f.flownAt) : '—'],
            ['Filed', f.createdAt ? relativeText(f.createdAt) : '—'],
            ['Distance', Number(f.distanceNm) ? `${num(f.distanceNm)} nm` : '—'],
            ['Violations', num(f.violations)],
            ['XP', Number(f.xp) ? num(f.xp) : '—'],
            ['Server', f.server || '—'],
            // The three judgements the airline made about it, which are the
            // ones that decide whether it paid and how much.
            ['In the fleet', f.inFleet ? 'Yes' : 'No'],
            ['Matched a route', f.routeMatched ? 'Yes' : 'No'],
            ['Where it came from', f.fromLogbook ? 'Infinite Flight' : 'Typed in'],
            ['Counted towards hours', f.hoursApplied ? 'Yes' : 'Not yet'],
        ];
        if (f.pointsAwarded != null) facts.push(['Paid', num(f.pointsAwarded)]);
        return `<div class="lb-facts">${facts.map(([k, v]) => `<div class="lb-fact">
            <div class="lb-fact-k">${esc(k)}</div>
            <div class="lb-fact-v">${esc(String(v))}</div>
        </div>`).join('')}</div>`;
    }

    function flightHtml() {
        const f = flightById(S.flightId);
        if (!f) return '<div class="cp-empty"><i data-lucide="search-x"></i>That flight is no longer here.</div>';
        const status = { approved: 'Approved', pending: 'Waiting on review', rejected: 'Not approved' }[f.status] || f.status;
        return `<button type="button" class="lb-back" data-lb-list><i data-lucide="chevron-left"></i> ${esc(((S.data && S.data.pilot) || {}).name || 'Logbook')}</button>
            <div class="lb-fl-leg">${esc(leg(f))}</div>
            <div class="lb-fl-when">${esc(status)}${f.flownAt ? ` · ${esc(whenText(f.flownAt))}` : ''}</div>
            ${f.editedAt ? `<div class="lb-edited">Corrected ${esc(relativeText(f.editedAt))}${
                f.editedBy ? ` by ${esc(f.editedBy)}` : ''}.</div>` : ''}
            ${factsHtml(f)}
            <div class="lb-actions">
                <button class="cp-btn cp-btn-primary" data-lb-edit="${esc(f.id)}"><i data-lucide="pencil"></i> Correct the hours</button>
                ${f.status !== 'approved' ? `<button class="cp-btn" data-lb-act="approve"><i data-lucide="check"></i> Approve</button>` : ''}
                ${f.status !== 'rejected' ? `<button class="cp-btn" data-lb-act="reject"><i data-lucide="x"></i> Reject</button>` : ''}
            </div>`;
    }

    /* =====================================================================
     * THE CORRECTION
     * =================================================================== */

    function editHtml() {
        const f = flightById(S.flightId);
        if (!f) return '<div class="cp-empty"><i data-lucide="search-x"></i>That flight is no longer here.</div>';
        const mins = Math.max(0, Math.round(Number(f.durationMin) || 0));
        return `<button type="button" class="lb-back" data-lb-open-back><i data-lucide="chevron-left"></i> ${esc(leg(f))}</button>
            <div class="lb-fl-leg">Correct this flight</div>
            <div class="lb-fl-when">${esc(leg(f))}${f.flownAt ? ` · ${esc(whenText(f.flownAt))}` : ''}</div>

            <div class="cp-label" style="margin-top:.9rem">How long it took</div>
            <div class="lb-hm">
                <label class="cp-label">Hours
                    <input class="cp-input" type="number" min="0" max="99" step="1" inputmode="numeric"
                        data-lb-f="hours" value="${Math.floor(mins / 60)}"></label>
                <label class="cp-label">Minutes
                    <input class="cp-input" type="number" min="0" max="59" step="1" inputmode="numeric"
                        data-lb-f="minutes" value="${mins % 60}"></label>
            </div>
            <div class="lb-total">Was <b>${esc(hm(mins))}</b> · now <b data-lb-total>${esc(hm(mins))}</b></div>

            <label class="cp-label" style="margin-top:.8rem">Landings
                <input class="cp-input" type="number" min="0" max="100" step="1" inputmode="numeric"
                    data-lb-f="landings" value="${Math.max(0, Math.round(Number(f.landings) || 0))}"></label>

            <div class="cp-grid2">
                <label class="cp-label">From
                    <input class="cp-input" data-lb-f="origin" maxlength="4" value="${esc(f.origin || '')}" placeholder="CYYZ"></label>
                <label class="cp-label">To
                    <input class="cp-input" data-lb-f="destination" maxlength="4" value="${esc(f.destination || '')}" placeholder="EGLL"></label>
            </div>
            <label class="cp-label">Aircraft
                <input class="cp-input" data-lb-f="aircraftName" maxlength="60" value="${esc(f.aircraftName || '')}"></label>

            ${f.hoursApplied
                ? `<div class="lb-warn">This flight has already been counted. Saving moves
                    ${esc(((S.data && S.data.pilot) || {}).name || 'this pilot')}'s hours by the difference —
                    not to the new figure — so anything you have granted them by hand stays where it is.
                    They are told what changed.</div>`
                : `<div class="lb-warn">This flight has not been counted yet, so nothing on the roster
                    moves. It will be credited at whatever it says here when you approve it.</div>`}

            <div class="lb-actions">
                <button class="cp-btn cp-btn-primary" data-lb-save><i data-lucide="check"></i> Save the correction</button>
                <button class="cp-btn" data-lb-open-back>Cancel</button>
            </div>`;
    }

    /* =====================================================================
     * FILING ONE BY HAND
     *
     * The other end of the same problem. A logbook that is WRONG about a flight
     * is corrected above; a logbook that is MISSING one needs somebody to put
     * it in, and until now the only way was to ask the pilot to type it
     * themselves and then go and approve it.
     * =================================================================== */

    function fileHtml() {
        const p = (S.data && S.data.pilot) || {};
        const today = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const day = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
        return `<button type="button" class="lb-back" data-lb-list><i data-lucide="chevron-left"></i> ${esc(p.name || 'Logbook')}</button>
            <div class="lb-fl-leg">File a flight</div>
            <div class="lb-fl-when">Onto ${esc(p.name || 'this pilot')}'s logbook</div>

            <div class="cp-grid2" style="margin-top:.9rem">
                <label class="cp-label">From
                    <input class="cp-input" data-lb-n="origin" maxlength="4" placeholder="CYYZ"></label>
                <label class="cp-label">To
                    <input class="cp-input" data-lb-n="destination" maxlength="4" placeholder="EGLL"></label>
            </div>
            <div class="cp-label">How long it took</div>
            <div class="lb-hm">
                <label class="cp-label">Hours
                    <input class="cp-input" type="number" min="0" max="99" step="1" inputmode="numeric" data-lb-n="hours" value="0"></label>
                <label class="cp-label">Minutes
                    <input class="cp-input" type="number" min="0" max="59" step="1" inputmode="numeric" data-lb-n="minutes" value="0"></label>
            </div>
            <div class="cp-grid2" style="margin-top:.6rem">
                <label class="cp-label">Landings
                    <input class="cp-input" type="number" min="0" max="100" step="1" inputmode="numeric" data-lb-n="landings" value="1"></label>
                <label class="cp-label">When
                    <input class="cp-input" type="date" data-lb-n="flownAt" value="${esc(day)}"></label>
            </div>
            <div class="cp-grid2">
                <label class="cp-label">Aircraft
                    <input class="cp-input" data-lb-n="aircraftName" maxlength="60" placeholder="A320"></label>
                <label class="cp-label">Flight number <span class="cp-note" style="font-weight:400">optional</span>
                    <input class="cp-input" data-lb-n="flightNumber" maxlength="12" placeholder="ACA1174"></label>
            </div>

            <label class="cp-label" style="display:flex;align-items:center;gap:.5rem;text-transform:none;font-size:.82rem">
                <input type="checkbox" data-lb-n="approve" checked> Count it straight away
            </label>
            <p class="cp-note">Leave this on and the hours are credited now. Turn it off and it joins the
                review queue like any other report.</p>

            <div class="lb-warn">A flight typed here is your word for it, not Infinite Flight's — it
                carries no flight id, so the sweep will never match it against a real one. Use it where the
                logbook is missing a flight, not where it is wrong about one.</div>

            <div class="lb-actions">
                <button class="cp-btn cp-btn-primary" data-lb-filesave><i data-lucide="check"></i> File it</button>
                <button class="cp-btn" data-lb-list>Cancel</button>
            </div>`;
    }

    /* =====================================================================
     * DRAWING
     * =================================================================== */

    function bodyHtml() {
        if (S.error) {
            if (P.isSchemaGap(S.error)) return P.schemaGapHtml(S.error);
            return `<div class="cp-empty"><i data-lucide="alert-triangle"></i>
                ${esc(S.error.message || 'That logbook could not be read.')}</div>`;
        }
        if (!S.data) {
            return `<div class="cp-empty"><i data-lucide="loader"></i>Reading their logbook…</div>`;
        }
        if (S.view === 'flight') return flightHtml();
        if (S.view === 'edit') return editHtml();
        if (S.view === 'file') return fileHtml();
        return listHtml();
    }

    function draw() {
        if (!S.panel) return;
        // The view key matters here: this panel has four screens in one body,
        // and a list scrolled to the fortieth flight must not hand its scroll
        // position to a two-field correction form — which is how a form opens
        // already scrolled past its own heading.
        P.keepPlace(S.panel.body, () => {
            S.panel.body.innerHTML = bodyHtml();
            try { icons(); } catch (_) {}
        }, `${S.view}:${S.flightId || ''}:${FILTER}`);
    }

    async function load() {
        S.data = null; S.error = null; draw();
        try {
            S.data = await S.api(`/roster/${encodeURIComponent(S.pilotId)}/logbook`);
        } catch (err) {
            S.error = err;
        }
        draw();
    }

    /* =====================================================================
     * WRITING
     * =================================================================== */

    const readFields = (attr) => {
        const out = {};
        S.panel.body.querySelectorAll(`[data-lb-${attr}]`).forEach((el) => {
            const k = el.getAttribute(`data-lb-${attr}`);
            if (el.type === 'checkbox') out[k] = !!el.checked;
            else if (el.type === 'number') out[k] = Number(el.value);
            else out[k] = String(el.value || '').trim();
        });
        return out;
    };

    async function saveEdit(btn) {
        const f = flightById(S.flightId);
        if (!f) return;
        const v = readFields('f');
        const mins = Math.max(0, Math.round((Number(v.hours) || 0) * 60 + (Number(v.minutes) || 0)));
        if (!v.origin || !v.destination) { P.toast('A flight needs both airports.', 'bad'); return; }
        const done = P.busy(btn, 'Saving…');
        try {
            await S.api(`/pireps/${encodeURIComponent(f.id)}`, {
                method: 'PATCH',
                body: {
                    action: 'edit',
                    durationMin: mins,
                    landings: Math.max(0, Math.round(Number(v.landings) || 0)),
                    origin: v.origin,
                    destination: v.destination,
                    aircraftName: v.aircraftName || '',
                },
            });
            P.toast('Corrected. Their hours have been adjusted.', 'ok');
            // The whole logbook, not the one row: the totals and the drift on
            // the head both moved, and a panel that repaints one flight while
            // the arithmetic above it still shows the old answer is worse than
            // one that reloads.
            S.view = 'flight';
            await load();
            changed();
        } catch (err) {
            P.toast((err && err.message) || 'That didn’t save.', 'bad');
        } finally { done(); }
    }

    async function review(action, btn) {
        const f = flightById(S.flightId);
        if (!f) return;
        const done = P.busy(btn, action === 'approve' ? 'Approving…' : 'Rejecting…');
        try {
            await S.api(`/pireps/${encodeURIComponent(f.id)}`, { method: 'PATCH', body: { action } });
            P.toast(action === 'approve' ? 'Approved.' : 'Rejected.', 'ok');
            await load();
            changed();
        } catch (err) {
            P.toast((err && err.message) || 'That didn’t work.', 'bad');
        } finally { done(); }
    }

    async function fileFlight(btn) {
        const v = readFields('n');
        if (!v.origin || !v.destination) { P.toast('Enter both airports.', 'bad'); return; }
        const mins = Math.max(0, Math.round((Number(v.hours) || 0) * 60 + (Number(v.minutes) || 0)));
        if (!mins) { P.toast('How long did it take?', 'bad'); return; }
        const done = P.busy(btn, 'Filing…');
        try {
            await S.api('/pireps', {
                method: 'POST',
                body: {
                    memberId: S.pilotId,
                    origin: v.origin,
                    destination: v.destination,
                    durationMin: mins,
                    landings: Math.max(0, Math.round(Number(v.landings) || 0)),
                    aircraftName: v.aircraftName || '',
                    flightNumber: v.flightNumber || '',
                    // A date input speaks local days. The end of the chosen day
                    // rather than its start, for the same reason the shop's
                    // offer dates do: a flight filed "on Sunday" that lands at
                    // 00:00 Sunday sorts before everything else flown that day.
                    flownAt: v.flownAt ? new Date(`${v.flownAt}T12:00:00`).toISOString() : undefined,
                    approve: !!v.approve,
                },
            });
            P.toast(v.approve ? 'Filed and credited.' : 'Filed — it is in the review queue.', 'ok');
            S.view = 'list';
            await load();
            changed();
        } catch (err) {
            P.toast((err && err.message) || 'That didn’t file.', 'bad');
        } finally { done(); }
    }

    function changed() {
        if (typeof S.onChanged === 'function') { try { S.onChanged(); } catch (_) {} }
    }

    /* =====================================================================
     * WIRING
     * =================================================================== */

    function onClick(ev) {
        const t = ev.target;

        const tab = t.closest('[data-lb-tab]');
        if (tab) { FILTER = tab.getAttribute('data-lb-tab'); draw(); return; }

        const open = t.closest('[data-lb-open]');
        if (open) { S.flightId = open.getAttribute('data-lb-open'); S.view = 'flight'; draw(); return; }

        if (t.closest('[data-lb-list]')) { S.view = 'list'; draw(); return; }
        if (t.closest('[data-lb-open-back]')) { S.view = 'flight'; draw(); return; }

        const edit = t.closest('[data-lb-edit]');
        if (edit) { S.flightId = edit.getAttribute('data-lb-edit'); S.view = 'edit'; draw(); return; }

        if (t.closest('[data-lb-file]')) { S.view = 'file'; draw(); return; }

        const save = t.closest('[data-lb-save]');
        if (save) { saveEdit(save); return; }

        const fileSave = t.closest('[data-lb-filesave]');
        if (fileSave) { fileFlight(fileSave); return; }

        const act = t.closest('[data-lb-act]');
        if (act) { review(act.getAttribute('data-lb-act'), act); return; }
    }

    /** The live total under the two boxes. The whole reason the duration is two
     *  fields is that nobody knows what four and a half hours is in minutes;
     *  this is the sentence that proves the two boxes say what was meant. */
    function onInput(ev) {
        if (!ev.target.matches('[data-lb-f="hours"],[data-lb-f="minutes"]')) return;
        const out = S.panel.body.querySelector('[data-lb-total]');
        if (!out) return;
        const v = readFields('f');
        out.textContent = hm((Number(v.hours) || 0) * 60 + (Number(v.minutes) || 0));
    }

    /* =====================================================================
     * PUBLIC
     * =================================================================== */

    /**
     * Open one pilot's logbook.
     *
     * `onChanged` is the page's hook for "the roster moved" — correcting a
     * flight changes somebody's hours, which changes their rank, which changes
     * the row this panel was opened from. The panel does not know what that row
     * looks like, so it says that something happened and lets the page decide.
     */
    function open({ api, pilotId, onChanged } = {}) {
        if (typeof api !== 'function' || !pilotId) return;
        styles();
        S.api = api;
        S.onChanged = onChanged || null;
        // A different pilot is a different panel's worth of state. Reset rather
        // than reuse: opening Rae's logbook and seeing Sam's flight still on
        // screen for a beat is the kind of bug that gets one of them corrected.
        if (String(pilotId) !== String(S.pilotId)) {
            S.pilotId = String(pilotId);
            S.data = null; S.error = null; S.flightId = ''; S.view = 'list'; FILTER = 'all';
        }
        if (!S.panel) {
            S.panel = P.sheet({ id: 'crewLogbook', title: 'Logbook', icon: 'book-open', wide: true });
            S.panel.el.addEventListener('click', onClick);
            S.panel.el.addEventListener('input', onInput);
        }
        S.panel.open();
        draw();
        load();
    }

    window.CrewLogbook = { open };
})();
