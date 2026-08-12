/* ============================================================================
   crewStandings.js — where a pilot sits among the people they fly with.

   WHY THIS EXISTS

   The insights panel has ranked pilots for as long as it has existed, and only
   ever answered to a manager. So the airline's own pilots — the people who
   generate every number in it — were the one group who could not see it. A
   pilot filed a flight, watched their hours tick up, and had no way of knowing
   whether that was a lot.

   RANKED BY FLIGHTS, OVER A WINDOW

   Not by career hours. The hours column never goes down, so ranking on it ranks
   who has been here longest: a hall of fame a pilot who joined in March cannot
   appear on however hard they fly. "Who is carrying the airline this month" is
   the question worth answering, and the only one a new pilot can act on.

   THE ROW THAT MATTERS IS THEIRS

   A leaderboard a mid-table pilot is absent from is a leaderboard they close.
   So the signed-in pilot's own standing is always on screen — highlighted in
   place when they are on the board, pinned underneath when they are not, and
   told plainly when they have flown nothing in the window. "34th of 51" is a
   worse-looking number than nothing at all, and a far more useful one.

   Nothing here is newly public. The roster endpoint hands out every name,
   callsign and rank without a gate, and the flight log already shows every
   approved flight; this is those two joined, which the server does because a
   browser doing it would have to download both.

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewStandings: crewPanels.js must load first'); return; }
    const { esc, icons, durationText, relativeText } = P;

    const WINDOWS = [
        { days: 30, label: 'This month' },
        { days: 90, label: '3 months' },
        { days: 0, label: 'All time' },
    ];

    const S = {
        api: null,
        panel: null,
        days: 30,
        board: [],
        me: null,
        totals: null,
        loading: false,
        error: null,
    };

    /* =====================================================================
     * STYLES
     * =================================================================== */

    function styles() {
        P.style('crew-standings-css', `
        .cs-tabs{display:flex;gap:.35rem;margin-bottom:.9rem;flex-wrap:wrap}
        .cs-tab{font-size:.75rem;font-weight:700;padding:.3rem .7rem;border-radius:999px;
            border:1px solid var(--line,#e5e5e5);background:var(--surface,#fff);
            color:var(--muted,#736E64);cursor:pointer;font-family:inherit}
        .cs-tab[aria-pressed="true"]{background:var(--accent,#1C1A16);color:#fff;border-color:transparent}
        .cs-list{list-style:none;margin:0;padding:0;display:grid;gap:.35rem}
        .cs-row{display:flex;align-items:center;gap:.75rem;padding:.6rem .75rem;
            border:1px solid transparent;border-radius:.55rem}
        .cs-row-me{border-color:var(--accent,#1C1A16);
            background:color-mix(in srgb, var(--accent,#1C1A16) 8%, transparent)}
        .cs-pos{font-weight:800;font-variant-numeric:tabular-nums;min-width:1.9rem;
            text-align:right;color:var(--faint,#A8A296)}
        .cs-pos-top{color:var(--accent,#1C1A16)}
        .cs-who{flex:1;min-width:0;display:grid;gap:.1rem}
        .cs-name{font-weight:650;letter-spacing:-.01em;overflow:hidden;
            text-overflow:ellipsis;white-space:nowrap}
        .cs-sub{font-size:.75rem;color:var(--muted,#736E64);overflow:hidden;
            text-overflow:ellipsis;white-space:nowrap}
        .cs-num{text-align:right;flex-shrink:0}
        .cs-num b{display:block;font-variant-numeric:tabular-nums;font-weight:700}
        .cs-num span{font-size:.7rem;color:var(--faint,#A8A296);text-transform:uppercase;
            letter-spacing:.04em}
        .cs-gap{margin-top:.5rem;padding-top:.5rem;border-top:1px dashed var(--line,#e5e5e5)}
        `);
    }

    /* =====================================================================
     * DATA
     * =================================================================== */

    async function load(days) {
        S.days = days;
        S.loading = true;
        S.error = null;
        render();
        try {
            const d = await S.api(`/standings?window=${encodeURIComponent(days)}`);
            S.board = Array.isArray(d.board) ? d.board : [];
            S.me = d.me || null;
            S.totals = d.totals || null;
        } catch (err) {
            S.error = err;
            S.board = [];
        }
        S.loading = false;
        render();
    }

    /* =====================================================================
     * RENDER
     * =================================================================== */

    function render() {
        if (!S.panel || !S.panel.isOpen()) return;
        const body = S.panel.body;

        if (S.error && P.isSchemaGap(S.error)) { body.innerHTML = P.schemaGapHtml(S.error); icons(); return; }

        const tabs = `<div class="cs-tabs">${WINDOWS.map((w) => `
            <button class="cs-tab" data-cs-window="${w.days}" aria-pressed="${w.days === S.days}">${esc(w.label)}</button>`).join('')}</div>`;

        if (S.loading && !S.board.length) {
            body.innerHTML = `${tabs}<div class="cp-empty">Counting up…</div>`;
            wire(); icons(); return;
        }
        if (S.error) {
            body.innerHTML = `${tabs}<div class="cp-empty"><i data-lucide="cloud-off"></i>
                ${esc(S.error.message || 'Could not load the standings.')}</div>`;
            wire(); icons(); return;
        }
        if (!S.board.length) {
            body.innerHTML = `${tabs}<div class="cp-empty"><i data-lucide="trophy"></i>
                ${S.days ? 'Nobody has had a flight approved in this window yet.'
                    : 'No approved flights yet. The first one filed and approved starts the board.'}</div>`;
            wire(); icons(); return;
        }

        const meId = S.me ? String(S.me.memberId) : '';
        const onBoard = !!(S.me && S.me.rank);
        body.innerHTML = `
            ${tabs}
            ${summaryHtml()}
            <ul class="cs-list">${S.board.map((r) => rowHtml(r, meId)).join('')}</ul>
            ${onBoard ? '' : meHtml()}
            <p class="cp-note" style="margin-top:.9rem">Approved flights only, so a report still
                waiting on staff isn’t counted yet. Ranked by flights rather than career hours —
                the hours column never goes down, which would make this a list of who joined first.</p>`;
        wire();
        icons();
    }

    function summaryHtml() {
        if (!S.totals) return '';
        const bits = [
            `${S.totals.pilots} ${S.totals.pilots === 1 ? 'pilot' : 'pilots'} flying`,
            `${S.totals.flights} ${S.totals.flights === 1 ? 'flight' : 'flights'}`,
            S.totals.hours ? `${S.totals.hours}h` : '',
        ].filter(Boolean);
        return `<p class="cp-note" style="margin-bottom:.7rem">${esc(bits.join(' · '))}</p>`;
    }

    function rowHtml(r, meId) {
        const isMe = meId && String(r.memberId) === meId;
        const sub = [r.callsign, r.badge && r.badge.name, r.onRoster ? '' : 'No longer on the roster']
            .filter(Boolean).join(' · ');
        return `<li class="cs-row${isMe ? ' cs-row-me' : ''}">
            <span class="cs-pos${r.rank <= 3 ? ' cs-pos-top' : ''}">${r.rank}</span>
            <span class="cs-who">
                <span class="cs-name">${esc(r.name)}${isMe ? ' <span class="cp-chip cp-chip-accent">You</span>' : ''}</span>
                <span class="cs-sub">${esc(sub) || '&nbsp;'}</span>
            </span>
            <span class="cs-num"><b>${r.flights}</b><span>${r.flights === 1 ? 'flight' : 'flights'}</span></span>
            <span class="cs-num"><b>${esc(durationText(Math.round((Number(r.hours) || 0) * 60)) || '—')}</b><span>flown</span></span>
        </li>`;
    }

    /* The pilot who is not in the top 25 — pinned under the board rather than
       left off it. Whether they are 30th or have flown nothing at all, the
       answer to "where am I?" is on screen. */
    function meHtml() {
        if (!S.me) return '';
        const flown = Number(S.me.flights) || 0;
        const lead = flown
            ? `${esc(S.me.name)} · ${flown} ${flown === 1 ? 'flight' : 'flights'}`
            : `${esc(S.me.name)} · nothing flown ${S.days ? 'in this window' : 'yet'}`;
        // How far off the board they are, when that is a number worth knowing.
        const last = S.board[S.board.length - 1];
        const gap = last && flown < last.flights ? last.flights - flown : 0;
        return `<div class="cs-gap">
            <div class="cs-row cs-row-me">
                <span class="cs-pos">${S.me.rank || '—'}</span>
                <span class="cs-who">
                    <span class="cs-name">You</span>
                    <span class="cs-sub">${lead}${S.me.of ? ` · of ${S.me.of} flying` : ''}</span>
                </span>
                <span class="cs-num"><b>${flown}</b><span>${flown === 1 ? 'flight' : 'flights'}</span></span>
            </div>
            ${gap ? `<p class="cp-note" style="margin-top:.4rem">${gap} more ${gap === 1 ? 'flight' : 'flights'}
                and you’re on the board.</p>` : ''}
        </div>`;
    }

    /* =====================================================================
     * WIRING — delegated, because the body is replaced on every render.
     * =================================================================== */

    function wire() {
        const body = S.panel.body;
        if (body.dataset.csWired) return;
        body.dataset.csWired = '1';
        body.addEventListener('click', (ev) => {
            const tab = ev.target.closest('[data-cs-window]');
            if (tab) {
                const days = Number(tab.getAttribute('data-cs-window'));
                if (days !== S.days) load(days);
            }
        });
    }

    /* =====================================================================
     * PUBLIC
     * =================================================================== */

    /**
     * Open the standings.
     *
     * `api` is a CrewPanels.api-shaped call, so this never has to know how the
     * page it is on stores a session — and works signed out, where the board
     * still draws and simply highlights nobody.
     */
    function open({ api, title } = {}) {
        if (typeof api !== 'function') { console.warn('crewStandings: needs an api function'); return; }
        styles();
        S.api = api;
        if (!S.panel) {
            S.panel = P.sheet({ id: 'crewStandings', title: title || 'Standings', icon: 'trophy' });
        }
        S.panel.open();
        load(S.days);
    }

    window.CrewStandings = { open, close: () => S.panel && S.panel.close() };
})();
