/* ============================================================================
   crewInbox.js — messages addressed to one pilot.

   WHAT THIS IS FOR

   The noticeboard (crewNotices.js) is the airline talking to everybody at once,
   and it is the wrong shape for half of what a VA needs to say:

       "Your application was accepted."
       "You're on Thursday's LHR–JFK, seat 1."
       "You're ready for your Captain check-ride."

   Put those on a board and you either tell the whole roster somebody else's
   business or — what actually happened before this — do not say them at all. The
   pilot found out by noticing, or did not.

   So this is the other half: one message, one pilot, kept. Most of them are
   written by the crew center itself the moment the thing happens, which is why
   the inbox fills up without anybody being asked to remember.

   TWO SURFACES, ONE MODULE

   A pilot gets their inbox and an unread badge. Staff holding `members.message`
   get a compose form — send to everyone, to the pilots still flying, to a rank
   band, or to named pilots. Which one you see is `canSend`, decided by the
   backend; a page cannot talk this file into showing the compose form.

   Staff do NOT get a view of anybody else's inbox, and there is no parameter
   anywhere that would ask for one. A pilot's correspondence includes what staff
   said about their application, and the read path is scoped to the signed-in
   account by the backend rather than by a filter this file passes.

   WHAT STAFF MAY CLAIM TO BE SENDING

   'message', and only that. The other kinds — promotion, booking, check-ride —
   are the crew center's own record of things that happened, and a hand-written
   "promotion" would be indistinguishable in the inbox from a real one. Same rule
   crewNotices applies to the noticeboard's generated rows, enforced by the
   backend rather than trusted to this file.

   WHAT IT NEEDS FROM ITS HOST

       CrewInbox.mount({ backend: BACKEND, slug: getSlug(), token: sessionToken });

   Then CrewInbox.open() from a button, and CrewInbox.renderBadge(el) to keep an
   unread count painted on it.

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewInbox: crewPanels.js must load first'); return; }
    const { esc, safeUrl, icons, relativeText, whenText } = P;

    const S = {
        api: null,
        slug: '',
        messages: [],
        unread: 0,
        canSend: false,      // does this viewer hold members.message?
        isPilot: false,      // is there an inbox to read at all?
        loaded: false,
        error: null,
        ranks: [],
        roster: [],          // for the "named pilots" audience; fetched on first compose
        rosterTried: false,  // so a VA with an empty roster is not re-fetched forever
        composing: false,
        busy: false,
    };

    let panel = null;

    /* ---------------------------------------------------------------------
     * How each kind reads
     *
     * The icon carries most of it: a pilot scanning their inbox wants to know
     * "is this about my rank, my flying, or somebody talking to me" before they
     * read a word.
     * ------------------------------------------------------------------- */
    const KINDS = {
        message:     { icon: 'mail',             label: 'Message' },
        application: { icon: 'user-check',       label: 'Application' },
        promotion:   { icon: 'badge-check',      label: 'Promotion' },
        booking:     { icon: 'calendar-clock',   label: 'Departure' },
        event:       { icon: 'calendar-days',    label: 'Event' },
        document:    { icon: 'book-open',        label: 'Document' },
        checkride:   { icon: 'clipboard-check',  label: 'Check-ride' },
        system:      { icon: 'settings',         label: 'Crew centre' },
    };
    const kindOf = (n) => KINDS[n && n.kind] || KINDS.message;

    const AUDIENCES = [
        { id: 'active', label: 'Pilots still flying', hint: 'Everyone active — not those on leave.' },
        { id: 'all',    label: 'The whole roster',    hint: 'Including pilots on leave and gone quiet.' },
        { id: 'rank',   label: 'A rank and above',    hint: 'The thing Discord can’t do.' },
        { id: 'member', label: 'Named pilots',        hint: 'Pick them individually.' },
    ];

    /* =====================================================================
     * DATA
     * =================================================================== */

    async function load() {
        try {
            const d = await S.api('/inbox');
            S.messages = Array.isArray(d.messages) ? d.messages : [];
            S.unread = Number(d.unread) || 0;
            S.isPilot = true;
            S.error = null;
        } catch (err) {
            // A 401 here is not a fault: it is a staff member, or the public,
            // asking for an inbox that is not theirs to have. Recorded as "no
            // inbox" rather than as an error, so a dashboard does not shout
            // about it — see paintBadge, which draws nothing at all in that case.
            if (err.status === 401) {
                S.isPilot = false;
                S.messages = [];
                S.unread = 0;
                S.error = null;
            } else {
                S.error = err;
                S.messages = [];
                S.unread = 0;
            }
        }
        S.loaded = true;
        paintAll();
        return S.messages;
    }

    /**
     * The roster, for the "named pilots" audience.
     *
     * Fetched here, lazily, on the first compose — rather than taken from the
     * host at mount. The dashboard loads its roster only when the roster panel is
     * opened, so a `roster` handed over at mount time is usually the empty array,
     * and "pick a pilot" with nobody in it is a bug that depends on which panel
     * the staff member happened to visit first.
     *
     * The endpoint is a public read, so this costs nothing a page could not
     * already do, and it is asked for once per visit.
     */
    async function ensureRoster() {
        if (S.roster.length || S.rosterTried) return S.roster;
        S.rosterTried = true;
        try {
            const d = await S.api('/roster');
            S.roster = (Array.isArray(d.roster) ? d.roster : [])
                // Alphabetical: this is a list somebody reads to find a name, not
                // one ordered by hours.
                .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        } catch { S.roster = []; }
        return S.roster;
    }

    /* =====================================================================
     * THE BADGE
     * =================================================================== */

    const badgeHosts = new Map();

    function paintBadge(el) {
        if (!el) return;
        // Nothing until the fetch lands, and nothing for somebody with no inbox.
        // A staff member is not a pilot and should not get an empty envelope.
        if (!S.loaded || !S.isPilot) { el.innerHTML = ''; el.classList.add('cp-hidden'); return; }
        el.classList.remove('cp-hidden');
        if (!S.unread) { el.innerHTML = ''; el.classList.add('cp-hidden'); return; }
        const n = Math.min(S.unread, 99);
        el.innerHTML = `<span class="ci-badge">${esc(String(n))}${S.unread > 99 ? '+' : ''}</span>`;
    }

    function paintAll() {
        badgeHosts.forEach((_, el) => {
            if (!el.isConnected) { badgeHosts.delete(el); return; }
            paintBadge(el);
        });
        if (panel && panel.isOpen()) renderPanel();
    }

    /* =====================================================================
     * THE LIST
     * =================================================================== */

    function messageHtml(n) {
        const k = kindOf(n);
        const unread = !n.readAt;
        const link = n.linkUrl && safeUrl(n.linkUrl);
        return `<article class="cp-card ci-msg${unread ? ' ci-msg-unread' : ''}" data-ci-id="${esc(n.id)}">
            <div class="ci-msg-head">
                <span class="ci-msg-icon"><i data-lucide="${esc(k.icon)}"></i></span>
                <span class="cp-chip cp-chip-mute">${esc(k.label)}</span>
                ${unread ? '<span class="cp-chip cp-chip-accent">New</span>' : ''}
                <span class="cp-fact ci-msg-when">${esc(whenText(n.createdAt))}</span>
                <button class="cp-icon-btn ci-msg-del" data-ci-del="${esc(n.id)}"
                        aria-label="Remove this message"><i data-lucide="x"></i></button>
            </div>
            <h3 class="cp-card-title">${esc(n.title)}</h3>
            ${n.body ? `<p class="ci-msg-body">${esc(n.body)}</p>` : ''}
            <div class="cp-facts ci-msg-foot">
                ${n.senderName
                    ? `<span class="cp-fact cp-faint">From ${esc(n.senderName)}</span>`
                    : '<span class="cp-fact cp-faint">From the crew centre</span>'}
                <span class="cp-fact cp-faint">${esc(relativeText(n.createdAt))}</span>
                ${link ? `<a class="cp-fact ci-msg-link" href="${esc(n.linkUrl)}"
                    target="_blank" rel="noopener noreferrer">
                    <i data-lucide="arrow-up-right"></i> Open</a>` : ''}
            </div>
        </article>`;
    }

    /** The tickable roster. Its own function so it can be painted into an open
     *  form when the fetch lands, without re-rendering what has been typed. */
    function pilotListHtml() {
        if (!S.rosterTried) return '<p class="cp-note cp-faint">Loading the roster…</p>';
        if (!S.roster.length) return '<p class="cp-note">Nobody on the roster yet.</p>';
        return `<div class="ci-pilots">
            ${S.roster.map((m) => `
                <label class="ci-pilot">
                    <input type="checkbox" name="memberIds" value="${esc(m.id)}">
                    ${esc(m.name || 'Unnamed')}${m.callsign ? ` <span class="cp-faint">${esc(m.callsign)}</span>` : ''}
                </label>`).join('')}
        </div>`;
    }

    function paintPilotList() {
        if (!panel || !panel.isOpen()) return;
        const host = panel.el.querySelector('[data-ci-pilots]');
        if (host) host.innerHTML = pilotListHtml();
    }

    function composeHtml() {
        const rungs = (S.ranks || []).map((r) => r && r.name).filter(Boolean);
        return `<form class="ci-compose" data-ci-form>
            <div>
                <label class="cp-label">Who it goes to</label>
                <div class="ci-auds">
                    ${AUDIENCES.map((a, i) => `
                        <label class="ci-aud${i === 0 ? ' ci-aud-on' : ''}" title="${esc(a.hint)}">
                            <input type="radio" name="audience" value="${esc(a.id)}"${i === 0 ? ' checked' : ''}>
                            ${esc(a.label)}
                        </label>`).join('')}
                </div>
            </div>

            <div data-ci-aud="rank" class="cp-hidden">
                <label class="cp-label" for="ci-minRank">From this rank up</label>
                <select class="cp-select" id="ci-minRank" name="minRank">
                    ${rungs.length
                        ? rungs.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')
                        : '<option value="">Your ladder has no ranks yet</option>'}
                </select>
            </div>

            <div data-ci-aud="member" class="cp-hidden">
                <label class="cp-label">Pilots</label>
                <div data-ci-pilots>${pilotListHtml()}</div>
            </div>

            <div>
                <label class="cp-label" for="ci-title">Subject</label>
                <input class="cp-input" id="ci-title" name="title" maxlength="160" required
                       placeholder="New fuel policy — read before your next flight">
            </div>
            <div>
                <label class="cp-label" for="ci-body">Message</label>
                <textarea class="cp-textarea ci-body" id="ci-body" name="body" maxlength="4000"
                          placeholder="Plain text. Line breaks are kept."></textarea>
            </div>
            <div>
                <label class="cp-label" for="ci-linkUrl">Link (optional)</label>
                <input class="cp-input" id="ci-linkUrl" name="linkUrl" maxlength="600"
                       placeholder="https://…">
            </div>
            <p class="cp-note">This lands in each pilot's inbox and stays there. It is sent as a
               message from you — the crew centre writes its own notices about promotions and
               bookings, so those can't be mistaken for hand-written ones.</p>
            <div class="ci-compose-actions">
                <button class="cp-btn cp-btn-primary" type="submit"${S.busy ? ' disabled' : ''}>
                    <i data-lucide="send"></i> Send
                </button>
                <button class="cp-btn" type="button" data-ci-cancel>Cancel</button>
            </div>
        </form>`;
    }

    function renderPanel() {
        const body = panel.body;

        if (S.composing) {
            body.innerHTML = composeHtml();
            icons();
            return;
        }
        if (!S.loaded) { body.innerHTML = '<div class="cp-empty">Loading your messages…</div>'; return; }
        if (S.error && P.isSchemaGap(S.error)) {
            body.innerHTML = P.schemaGapHtml(S.error);
            icons();
            return;
        }
        if (S.error) {
            body.innerHTML = `<div class="cp-empty"><i data-lucide="triangle-alert"></i>
                ${esc(S.error.message || 'Couldn’t load your messages.')}</div>`;
            icons();
            return;
        }

        const sendBtn = S.canSend
            ? `<button class="cp-btn cp-btn-primary ci-send" data-ci-new>
                   <i data-lucide="send"></i> Message the crew</button>`
            : '';

        // Staff with no inbox of their own still get the compose form — that is
        // the whole of their business here.
        if (!S.isPilot) {
            body.innerHTML = `${sendBtn}
                <div class="cp-empty">
                    <i data-lucide="mail"></i>
                    ${S.canSend
                        ? 'Messages you send land in each pilot’s inbox. Staff don’t have one — you read the dashboard.'
                        : 'Sign in as a pilot to read your messages.'}
                </div>`;
            icons();
            return;
        }

        if (!S.messages.length) {
            body.innerHTML = `${sendBtn}
                <div class="cp-empty">
                    <i data-lucide="mail"></i>
                    Nothing yet. Promotions, departures assigned to you and anything staff
                    send you personally will land here.
                </div>`;
            icons();
            return;
        }

        const readAll = S.unread
            ? `<button class="cp-btn cp-btn-sm ci-readall" data-ci-readall>
                   <i data-lucide="check-check"></i> Mark all read</button>`
            : '';

        body.innerHTML = `<div class="ci-tools">${sendBtn}${readAll}</div>
            <div class="ci-list">${S.messages.map(messageHtml).join('')}</div>`;
        icons();
    }

    /* =====================================================================
     * ACTIONS
     * =================================================================== */

    /**
     * Mark what is on screen as read.
     *
     * Fired once, shortly after the panel opens, rather than per-message on
     * scroll: the pilot has the panel open and the messages in front of them,
     * and a badge that clears when you look is the behaviour every inbox has.
     * The delay is so opening and immediately closing does not silently clear
     * a notice that was never read.
     */
    let readTimer = null;
    function markVisibleRead() {
        clearTimeout(readTimer);
        const unread = S.messages.filter((m) => !m.readAt).map((m) => m.id);
        if (!unread.length) return;
        readTimer = setTimeout(async () => {
            if (!panel || !panel.isOpen()) return;
            try {
                await S.api('/inbox/read', { method: 'POST', body: { ids: unread } });
                // Marked locally rather than re-fetching: the rows have not
                // otherwise changed, and a reload would jump the list under
                // somebody mid-read.
                const seen = new Set(unread);
                const now = new Date().toISOString();
                S.messages = S.messages.map((m) => (seen.has(m.id) ? { ...m, readAt: m.readAt || now } : m));
                S.unread = S.messages.filter((m) => !m.readAt).length;
                paintAll();
            } catch { /* a badge that stays lit is not worth a toast */ }
        }, 1200);
    }

    async function markAllRead() {
        try {
            await S.api('/inbox/read', { method: 'POST', body: { all: true } });
            const now = new Date().toISOString();
            S.messages = S.messages.map((m) => ({ ...m, readAt: m.readAt || now }));
            S.unread = 0;
            paintAll();
        } catch (err) { P.toast(err.message || 'Could not update your messages.', 'bad'); }
    }

    async function remove(id) {
        try {
            await S.api(`/inbox/${encodeURIComponent(id)}`, { method: 'DELETE' });
            S.messages = S.messages.filter((m) => m.id !== id);
            S.unread = S.messages.filter((m) => !m.readAt).length;
            paintAll();
        } catch (err) { P.toast(err.message || 'Could not remove the message.', 'bad'); }
    }

    async function send(form) {
        if (S.busy) return;
        const fd = new FormData(form);
        const payload = {
            audience: String(fd.get('audience') || 'active'),
            minRank: String(fd.get('minRank') || ''),
            memberIds: fd.getAll('memberIds').map((v) => String(v)),
            title: String(fd.get('title') || '').trim(),
            body: String(fd.get('body') || ''),
            linkUrl: String(fd.get('linkUrl') || '').trim(),
        };
        if (!payload.title) { P.toast('Give the message a subject.', 'bad'); return; }
        S.busy = true;
        try {
            const out = await S.api('/inbox/send', { method: 'POST', body: payload });
            const n = Number(out.sent) || 0;
            P.toast(n === 1 ? 'Sent to 1 pilot.' : `Sent to ${n} pilots.`, 'ok');
            if (out.warning) P.toast(out.warning, 'bad');
            S.composing = false;
            await load();
        } catch (err) {
            P.toast(err.message || 'Could not send the message.', 'bad');
        } finally {
            S.busy = false;
            if (panel && panel.isOpen()) renderPanel();
        }
    }

    /* =====================================================================
     * THE PANEL
     * =================================================================== */

    function ensurePanel() {
        if (panel) return;
        panel = P.sheet({ id: 'ci-panel', title: 'Messages', icon: 'mail' });

        panel.el.addEventListener('click', (ev) => {
            const t = ev.target;
            if (t.closest('[data-ci-cancel]')) { S.composing = false; renderPanel(); return; }
            if (t.closest('[data-ci-new]')) {
                S.composing = true;
                renderPanel();
                // The pilot list needs the roster, fetched on first use. Painted
                // INTO the open form rather than by re-rendering it: a re-render
                // would throw away whatever has been typed in the meantime, and
                // the fetch is slow enough for that to be a real race.
                ensureRoster().then(paintPilotList);
                return;
            }
            if (t.closest('[data-ci-readall]')) { markAllRead(); return; }
            const del = t.closest('[data-ci-del]');
            if (del) { ev.stopPropagation(); remove(del.getAttribute('data-ci-del')); }
        });

        panel.el.addEventListener('submit', (ev) => {
            const form = ev.target.closest('[data-ci-form]');
            if (!form) return;
            ev.preventDefault();
            send(form);
        });

        // The audience radios show the rank picker or the pilot list. Changed in
        // place rather than re-rendered so a half-written message survives.
        panel.el.addEventListener('change', (ev) => {
            const radio = ev.target.closest('input[name="audience"]');
            if (!radio) return;
            const form = radio.closest('[data-ci-form]');
            if (!form) return;
            form.querySelectorAll('[data-ci-aud]').forEach((box) => {
                box.classList.toggle('cp-hidden', box.getAttribute('data-ci-aud') !== radio.value);
            });
            form.querySelectorAll('.ci-aud').forEach((l) => {
                l.classList.toggle('ci-aud-on', l.querySelector('input').checked);
            });
        });
    }

    function injectStyles() {
        P.baseStyles();
        P.style('ci-styles', `
        .ci-badge{ display:inline-grid; place-items:center; min-width:1.125rem; height:1.125rem;
            padding:0 .25rem; border-radius:999px; background:#DC2626; color:#fff;
            font-size:.68rem; font-weight:800; line-height:1; }
        .ci-tools{ display:flex; gap:.5rem; flex-wrap:wrap; }
        .ci-list{ display:grid; gap:.6rem; }
        .ci-msg-head{ display:flex; align-items:center; gap:.4rem; flex-wrap:wrap; margin-bottom:.35rem; }
        .ci-msg-icon{ display:grid; place-items:center; width:1.6rem; height:1.6rem; border-radius:.4rem;
            background:var(--line,#e5e5e5); color:var(--muted,#736E64); }
        .ci-msg-icon i{ width:.9rem; height:.9rem; }
        /* The unread mark is a left edge rather than a background tint: it
           survives both themes without a second colour, and it does not make the
           text of an unread message harder to read than a read one. */
        .ci-msg-unread{ border-left:3px solid var(--accent,#1C1A16); }
        .ci-msg-unread .ci-msg-icon{ background:var(--accent,#1C1A16); color:#fff; }
        .ci-msg-when{ font-size:.75rem; }
        .ci-msg-del{ margin-left:auto; width:1.75rem; height:1.75rem; }
        .ci-msg-del i{ width:.85rem; height:.85rem; }
        .ci-msg-body{ white-space:pre-wrap; font-size:.85rem; line-height:1.55; margin:.25rem 0 .5rem;
            color:var(--ink,#1C1A16); }
        .ci-msg-foot{ font-size:.75rem; }
        .ci-msg-link{ color:var(--accent,#1C1A16); font-weight:600; text-decoration:none; }
        .ci-msg-link:hover{ text-decoration:underline; }

        .ci-compose{ display:grid; gap:.8rem; }
        .ci-compose-actions{ display:flex; gap:.5rem; flex-wrap:wrap; }
        .ci-body{ min-height:8rem; }
        .ci-auds{ display:flex; gap:.4rem; flex-wrap:wrap; }
        .ci-aud{ display:inline-flex; align-items:center; cursor:pointer; padding:.45rem .7rem;
            border-radius:.5rem; font-size:.82rem; font-weight:600;
            border:1px solid var(--line,#e5e5e5); color:var(--muted,#736E64);
            /* See the same note in crewDocuments.js: the containing block for the
               hidden radio, without which it is absolute against the panel. */
            position:relative; }
        .ci-aud input{ position:absolute; inset:0; opacity:0; margin:0; cursor:pointer; }
        .ci-aud-on{ border-color:var(--accent,#1C1A16); color:var(--ink,#1C1A16); }
        .ci-pilots{ display:grid; gap:.2rem; max-height:14rem; overflow-y:auto;
            border:1px solid var(--line,#e5e5e5); border-radius:.5rem; padding:.5rem; }
        .ci-pilot{ display:flex; align-items:center; gap:.45rem; font-size:.85rem;
            color:var(--ink,#1C1A16); cursor:pointer; padding:.2rem; }
        @media (max-width:40rem){
            .ci-aud{ min-height:2.75rem; }
            .ci-msg-del{ width:2.25rem; height:2.25rem; }
        }`);
    }

    /* =====================================================================
     * PUBLIC
     * =================================================================== */

    function open() {
        ensurePanel();
        S.composing = false;
        panel.open();
        renderPanel();
        // Always re-read on open, then clear what was actually looked at.
        load().then(() => { if (panel && panel.isOpen()) markVisibleRead(); });
    }

    function mount({ backend, slug, token, ranks, roster, canSend }) {
        injectStyles();
        S.api = P.api({ backend, slug, token });
        S.slug = String(slug || '').toLowerCase();
        S.ranks = Array.isArray(ranks) ? ranks : [];
        S.roster = Array.isArray(roster) ? roster : [];
        // Told by the host rather than guessed: the dashboard already knows what
        // the signed-in staff member may do, and asking a second endpoint to
        // find out would be a round trip for something we have.
        S.canSend = !!canSend;
        if (!S.slug) return Promise.resolve([]);
        return load();
    }

    /** Paint an unread count into a host element, and keep it painted. */
    function renderBadge(el) {
        if (!el) return;
        injectStyles();
        badgeHosts.set(el, true);
        paintBadge(el);
    }

    /** The ladder and the roster, once the host has them — the compose form
     *  needs rung names and pilot names. */
    function setContext({ ranks, roster, canSend } = {}) {
        if (Array.isArray(ranks)) S.ranks = ranks;
        if (Array.isArray(roster)) S.roster = roster;
        if (canSend !== undefined) S.canSend = !!canSend;
        if (panel && panel.isOpen()) renderPanel();
    }

    window.CrewInbox = {
        mount, open, renderBadge, setContext,
        close: () => panel && panel.close(),
        reload: () => load(),
        get unread() { return S.unread; },
        get messages() { return S.messages.slice(); },
        get isPilot() { return S.isPilot; },
    };
})();
