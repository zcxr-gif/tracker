/* ============================================================================
   crewAlerts.js — the bell, and what it is supposed to mean.

   WHY THIS EXISTS

   The pilot home has a bell in its top bar with a dot on it. The dot is a
   <span> in the markup. It is always there, it has never counted anything, and
   pressing the bell does nothing at all. Every pilot who has used this page has
   learned, once, that the dot means nothing — and a notification light that
   means nothing is worse than none, because it also teaches them to ignore the
   one that will eventually mean something.

   WHAT IT CARRIES

   Only things that happened TO THIS PERSON, and only things they would want to
   know without being asked:

     · a flight they filed was approved, or was not
     · a message from staff arrived
     · a leg they booked was confirmed, moved or cancelled
     · their rank changed
     · they earned something
     · an order they paid for was handed over

   Deliberately NOT: everything that happened at the airline. That is the
   noticeboard, it already exists, and a bell that lights up because somebody
   else filed a flight is a bell people turn off.

   READ IS A FACT, NOT A GUESS

   Opening the panel marks what is IN it read, by id, on the server — not "all
   alerts before now", which is how a notification arriving while the panel is
   open gets silently swallowed. Anything that lands after the read is still
   unread, and the dot comes back.

   IT IS ALLOWED NOT TO EXIST

   A VA whose database predates this gets 404 or 409 from /alerts, and the
   answer to that is a bell with no dot on it and a panel that says so — not an
   error. The bell is chrome; chrome does not get to shout.

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewAlerts: crewPanels.js must load first'); return; }
    const { esc, icons, relativeText } = P;

    const S = {
        api: null,
        panel: null,
        alerts: null,       // null = not read yet
        unread: 0,
        error: null,
        hosts: [],          // bell elements to keep painted
        polling: false,
        onOpen: null,       // (alert) => void, for alerts that point somewhere
    };

    /* What each kind looks like. The icon and the colour are the whole of the
       glanceable difference between "your flight was approved" and "your
       flight was rejected", so they are not decoration. */
    const KIND = {
        pirep_approved:  { icon: 'circle-check', tone: 'ok',   opens: 'logbook' },
        pirep_rejected:  { icon: 'circle-x',     tone: 'bad',  opens: 'logbook' },
        message:         { icon: 'mail',         tone: '',     opens: 'inbox' },
        booking:         { icon: 'calendar-check', tone: '',   opens: 'schedule' },
        booking_cancelled: { icon: 'calendar-x', tone: 'warn', opens: 'schedule' },
        rank:            { icon: 'badge-check',  tone: 'ok',   opens: 'training' },
        award:           { icon: 'award',        tone: 'ok',   opens: 'awards' },
        order:           { icon: 'package-check', tone: 'ok',  opens: 'shop' },
        event:           { icon: 'calendar-days', tone: '',    opens: 'events' },
    };
    const kindOf = (a) => KIND[a && a.kind] || { icon: 'bell', tone: '', opens: '' };

    function styles() {
        P.baseStyles();
        P.style('crew-alerts', `
        .al-dot{ position:absolute; top:.35rem; right:.35rem; min-width:1.05rem; height:1.05rem;
            padding:0 .22rem; border-radius:999px; background:var(--accent); color:#fff;
            font-size:.62rem; font-weight:800; line-height:1.05rem; text-align:center;
            box-shadow:0 0 0 2px var(--bg,#fff); }
        .al-row{ display:flex; gap:.75rem; padding:.75rem .3rem; align-items:flex-start;
            border-bottom:1px solid var(--line-soft,var(--line,#e5e5e5)); width:100%;
            text-align:left; background:none; border-left:0; border-right:0; border-top:0;
            font:inherit; color:inherit; cursor:pointer; }
        .al-row:last-child{ border-bottom:0; }
        .al-row:hover{ background:color-mix(in srgb, var(--ink,#1C1A16) 4%, transparent); }
        .al-ico{ width:2rem; height:2rem; border-radius:.6rem; flex:none; display:grid; place-items:center;
            background:color-mix(in srgb, var(--ink,#1C1A16) 6%, transparent); color:var(--muted,#736E64); }
        .al-ico i{ width:1rem; height:1rem; }
        .al-ok{ background:color-mix(in srgb, #16A34A 14%, transparent); color:#16A34A; }
        .al-bad{ background:color-mix(in srgb, #DC2626 14%, transparent); color:#DC2626; }
        .al-warn{ background:color-mix(in srgb, #D97706 16%, transparent); color:#D97706; }
        /* Spans in a flex row: each needs to be a block of its own, or the
           title, the body and the timestamp come out as one line of prose. */
        .al-main{ min-width:0; flex:1; display:block; }
        .al-title{ display:block; font-size:.88rem; font-weight:650; letter-spacing:-.01em; }
        .al-body{ display:block; font-size:.8rem; color:var(--muted,#736E64); margin-top:.1rem; }
        .al-when{ display:block; font-size:.7rem; color:var(--faint,#A8A296); margin-top:.2rem; }
        /* Unread is a state, not a colour scheme: one mark, on the left, that
           disappears the moment it has been seen. */
        .al-new{ position:relative; }
        .al-new::before{ content:''; position:absolute; left:-.15rem; top:1.15rem;
            width:.35rem; height:.35rem; border-radius:50%; background:var(--accent); }
        .al-head{ display:flex; align-items:center; justify-content:space-between; gap:.6rem;
            padding-bottom:.4rem; }
        `);
    }

    /* =====================================================================
     * THE BELL
     * =================================================================== */

    function paintBells() {
        S.hosts = S.hosts.filter((h) => h.isConnected);
        S.hosts.forEach((btn) => {
            let dot = btn.querySelector('.al-dot');
            if (!S.unread) { if (dot) dot.remove(); btn.setAttribute('aria-label', 'Notifications'); return; }
            if (!dot) {
                dot = document.createElement('span');
                dot.className = 'al-dot';
                btn.appendChild(dot);
            }
            dot.textContent = S.unread > 9 ? '9+' : String(S.unread);
            btn.setAttribute('aria-label', `Notifications — ${S.unread} unread`);
        });
    }

    /**
     * Adopt a page's bell button.
     *
     * The dot already in the markup is removed on sight: it is a decoration
     * that has been lying since the page shipped, and leaving it to be
     * overwritten later would mean it was still lying in the meantime.
     */
    function adopt(btn) {
        if (!btn || btn.dataset.alBound) return;
        btn.dataset.alBound = '1';
        btn.querySelectorAll('span:not(.al-dot)').forEach((s) => {
            if (!s.textContent.trim()) s.remove();
        });
        btn.style.position = 'relative';
        btn.addEventListener('click', () => open());
        S.hosts.push(btn);
        paintBells();
    }

    /* =====================================================================
     * READING
     * =================================================================== */

    async function load({ quiet = false } = {}) {
        try {
            const d = await S.api('/alerts');
            S.alerts = Array.isArray(d.alerts) ? d.alerts : [];
            S.unread = Number(d.unread) || S.alerts.filter((a) => !a.readAt).length;
            S.error = null;
        } catch (err) {
            // A bell is chrome. It does not get to shout about a 404.
            S.error = err;
            if (S.alerts === null) S.alerts = [];
            S.unread = 0;
        }
        paintBells();
        if (!quiet) draw();
    }

    /** Mark exactly what is on screen read — see the note at the top. */
    async function markRead() {
        const ids = (S.alerts || []).filter((a) => !a.readAt).map((a) => a.id).filter(Boolean);
        if (!ids.length) return;
        const now = new Date().toISOString();
        (S.alerts || []).forEach((a) => { if (ids.includes(a.id)) a.readAt = now; });
        S.unread = Math.max(0, S.unread - ids.length);
        paintBells();
        try { await S.api('/alerts/read', { method: 'POST', body: { ids } }); }
        catch (_) { /* it stays unread on the server; the next open tries again */ }
    }

    /* =====================================================================
     * THE PANEL
     * =================================================================== */

    function draw() {
        if (!S.panel) return;
        P.keepPlace(S.panel.body, () => {
            S.panel.body.innerHTML = bodyHtml();
            try { icons(); } catch (_) {}
        });
    }

    function bodyHtml() {
        if (S.alerts === null) return `<p class="cp-note" style="text-align:center;padding:2rem 0">Catching up…</p>`;
        if (S.error) {
            if (P.isSchemaGap(S.error)) return P.schemaGapHtml(S.error);
            return `<div class="cp-empty"><i data-lucide="bell-off"></i>
                Notifications are not switched on for this crew center yet.</div>`;
        }
        if (!S.alerts.length) {
            return `<div class="cp-empty"><i data-lucide="bell"></i>
                Nothing new. When a flight of yours is reviewed, a leg is confirmed or staff
                message you, it lands here.</div>`;
        }
        const unread = S.alerts.filter((a) => !a.readAt).length;
        const head = `<div class="al-head">
            <span class="cp-muted" style="font-size:.8rem">${unread ? `${unread} new` : 'All caught up'}</span>
            ${unread ? '<button class="cp-btn cp-btn-sm" data-al-readall>Mark all read</button>' : ''}
        </div>`;
        return head + S.alerts.map(rowHtml).join('');
    }

    function rowHtml(a) {
        const k = kindOf(a);
        const tone = k.tone ? ` al-${k.tone}` : '';
        return `<button class="al-row ${a.readAt ? '' : 'al-new'}" data-al-id="${esc(a.id || '')}" type="button">
            <span class="al-ico${tone}"><i data-lucide="${esc(k.icon)}"></i></span>
            <span class="al-main">
                <span class="al-title">${esc(a.title || 'Update')}</span>
                ${a.body ? `<span class="al-body">${esc(a.body)}</span>` : ''}
                ${a.createdAt ? `<span class="al-when">${esc(relativeText(a.createdAt))}</span>` : ''}
            </span>
        </button>`;
    }

    function open() {
        styles();
        if (!S.panel) {
            S.panel = P.sheet({ id: 'crewAlerts', title: 'Notifications', icon: 'bell' });
            S.panel.el.addEventListener('click', (ev) => {
                if (ev.target.closest('[data-al-readall]')) { markRead().then(draw); return; }
                const row = ev.target.closest('[data-al-id]');
                if (!row) return;
                const a = (S.alerts || []).find((x) => String(x.id) === row.getAttribute('data-al-id'));
                if (!a) return;
                const where = a.opens || kindOf(a).opens;
                if (where && typeof S.onOpen === 'function') {
                    S.panel.close();
                    setTimeout(() => { try { S.onOpen(where, a); } catch (_) {} }, 0);
                }
            });
        }
        S.panel.open();
        draw();
        load().then(() => {
            draw();
            // Marked read on open, not on click: a reader who opened the panel
            // has seen them, and making them clear each one individually is how
            // a bell ends up permanently lit.
            markRead().then(draw);
        });
    }

    /* =====================================================================
     * KEEPING UP
     *
     * No sockets and no timer while the tab is in the background: the crew
     * center's other live pieces already agreed that coming back to the tab is
     * when a reader wants the truth, and a bell polling every thirty seconds
     * into a laptop lid is the definition of a battery complaint.
     * =================================================================== */

    let lastPoll = 0;
    function catchUp() {
        if (document.visibilityState === 'hidden') return;
        if (Date.now() - lastPoll < 45000) return;
        lastPoll = Date.now();
        load({ quiet: !(S.panel && S.panel.isOpen()) });
    }

    function mount({ api, onOpen } = {}) {
        if (typeof api !== 'function') { console.warn('crewAlerts: needs an api function'); return; }
        S.api = api;
        S.onOpen = onOpen;
        styles();
        document.querySelectorAll('[data-crew-bell]').forEach(adopt);
        load({ quiet: true });
        if (!S.polling) {
            S.polling = true;
            document.addEventListener('visibilitychange', catchUp);
            window.addEventListener('focus', catchUp);
        }
    }

    window.CrewAlerts = {
        mount, open,
        close: () => S.panel && S.panel.close(),
        unread: () => S.unread,
        refresh: () => load({ quiet: true }),
    };
})();
