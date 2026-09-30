/* ============================================================================
   crewGoals.js — tours and challenges, for pilots and for the staff who set
   them.

   WHAT IT DRAWS

     • TOURS       a journey of legs. Each card is the route itself, drawn as a
                   line of airports with the ones you have flown ticked, your
                   next leg called out, and who has finished it.
     • CHALLENGES  a figure to reach — per pilot, or the whole crew together as
                   one bar — with the leaderboard under it.
     • THE EDITOR  for staff (events.manage): a tour is typed as a routing
                   ("EGLL LFPG EDDF LIRF") or picked leg by leg from the
                   network; a challenge is a metric, a target and a few filters.

   NOTHING IS MARKED BY HAND. Progress is the server's arithmetic over approved
   flights (crewGoals.js in the database repo), so this file only draws what it
   is sent — the same rule crewAwards.js follows.

   WHAT IT NEEDS FROM ITS HOST

       CrewGoals.open({ api, tab })              the sheet
       CrewGoals.mountStrip(host, { api })       "your next leg", on a page

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewGoals: crewPanels.js must load first'); return; }
    const { esc, icons, relativeText } = P;

    const S = { api: null, panel: null, tab: 'tours', data: null, loading: false, error: null, view: null, routes: null, hosts: [] };

    const METRICS = {
        flights: { label: 'Flights', unit: 'flights' },
        hours: { label: 'Hours flown', unit: 'hours' },
        distance: { label: 'Distance', unit: 'nm' },
        landings: { label: 'Landings', unit: 'landings' },
        airports: { label: 'Different airports', unit: 'airports' },
    };
    const TIERS = ['bronze', 'silver', 'gold', 'platinum'];
    const TIER_COLOUR = { bronze: '#B4794A', silver: '#9AA3B2', gold: '#C9A227', platinum: '#6E8BFF' };

    function styles() {
        P.baseStyles();
        P.style('crew-goals', `
        .gl-tabs{ display:flex; gap:.25rem; padding:.25rem; border:1px solid var(--line,#e5e5e5); border-radius:.7rem; }
        .gl-tab{ flex:1; border:0; background:transparent; padding:.5rem; border-radius:.5rem; font-weight:700; font-size:.84rem;
            color:var(--muted,#736E64); cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:.35rem; }
        .gl-tab[aria-selected="true"]{ background:var(--accent,#1C1A16); color:#fff; }
        .gl-card{ border:1px solid var(--line,#e5e5e5); border-radius:.9rem; overflow:hidden; background:var(--surface,#fff); }
        .gl-art{ height:6.5rem; background-size:cover; background-position:center; }
        .gl-in{ padding:.9rem; display:grid; gap:.6rem; }
        .gl-top{ display:flex; gap:.6rem; align-items:flex-start; }
        .gl-title{ font-weight:800; letter-spacing:-.02em; font-size:1.02rem; line-height:1.2; }
        .gl-when{ font-size:.74rem; color:var(--muted,#736E64); margin-top:.15rem; }
        .gl-medal{ width:2.3rem; height:2.3rem; border-radius:50%; display:grid; place-items:center; color:#fff; flex:none;
            background:radial-gradient(120% 120% at 30% 20%, color-mix(in srgb, var(--gl-c) 80%, #fff 20%), var(--gl-c)); }
        .gl-medal i{ width:1.1rem; height:1.1rem; }
        .gl-route{ display:flex; flex-wrap:wrap; align-items:center; gap:.2rem .3rem; font-size:.8rem; font-weight:700; }
        .gl-stop{ padding:.15rem .45rem; border-radius:.4rem; border:1px solid var(--line,#e5e5e5); }
        .gl-stop.gl-done{ background:#16A34A; color:#fff; border-color:transparent; }
        .gl-stop.gl-next{ border-color:var(--accent,#1C1A16); box-shadow:inset 0 0 0 1px var(--accent,#1C1A16); }
        .gl-arrow{ color:var(--faint,#A8A296); font-weight:400; }
        .gl-bar{ height:.45rem; border-radius:999px; background:color-mix(in srgb, var(--ink,#1C1A16) 8%, transparent); overflow:hidden; }
        .gl-bar span{ display:block; height:100%; background:var(--accent,#1C1A16); border-radius:999px; transition:width .4s; }
        .gl-bar.gl-won span{ background:#16A34A; }
        .gl-next{ font-size:.82rem; padding:.5rem .65rem; border-radius:.55rem;
            background:color-mix(in srgb, var(--accent,#1C1A16) 8%, transparent); }
        .gl-board{ display:grid; gap:.2rem; font-size:.8rem; }
        .gl-board div{ display:flex; gap:.5rem; align-items:center; }
        .gl-board .gl-pos{ width:1.3rem; text-align:right; color:var(--faint,#A8A296); font-weight:700; }
        .gl-board .gl-who{ flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .gl-row{ display:flex; flex-wrap:wrap; gap:.4rem; }
        .gl-legs{ display:grid; gap:.4rem; }
        .gl-leg{ display:grid; grid-template-columns:1.4rem 5rem 5rem 1fr auto; gap:.35rem; align-items:center; }
        .gl-leg .gl-n{ font-size:.72rem; color:var(--faint,#A8A296); font-weight:700; text-align:right; }
        @media (max-width:560px){ .gl-leg{ grid-template-columns:1.2rem 1fr 1fr auto; } .gl-leg .gl-ac{ grid-column:2 / 4; } }
        .gl-strip{ display:grid; gap:.55rem; }
        `);
    }

    /* ---------------------------------------------------------------------
     * Loading
     * ------------------------------------------------------------------- */

    async function load() {
        S.loading = true; S.error = null;
        draw();
        try { S.data = await S.api('/goals'); } catch (err) { S.error = err; }
        S.loading = false;
        draw();
        paintStrips();
    }

    /* ---------------------------------------------------------------------
     * Pieces
     * ------------------------------------------------------------------- */

    const phaseChip = (g) => {
        if (!g.active) return '<span class="cp-chip cp-chip-mute">Draft</span>';
        if (g.phase === 'upcoming') return '<span class="cp-chip cp-chip-warn">Upcoming</span>';
        if (g.phase === 'ended') return '<span class="cp-chip cp-chip-mute">Ended</span>';
        return '<span class="cp-chip cp-chip-ok">Live</span>';
    };
    const dateText = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
    const windowText = (g) => {
        if (g.startsAt && g.endsAt) return `${dateText(g.startsAt)} – ${dateText(g.endsAt)}`;
        if (g.endsAt) return `Until ${dateText(g.endsAt)}`;
        if (g.startsAt) return `From ${dateText(g.startsAt)}`;
        return 'Any time';
    };
    const medal = (g, fallback) => `<span class="gl-medal" style="--gl-c:${TIER_COLOUR[(g.award && g.award.tier) || 'gold'] || 'var(--accent)'}" title="${esc((g.award && g.award.name) || '')}"><i data-lucide="${esc((g.award && g.award.icon) || fallback)}"></i></span>`;
    const bar = (pct, won) => `<div class="gl-bar ${won ? 'gl-won' : ''}"><span style="width:${Math.max(0, Math.min(100, pct))}%"></span></div>`;
    const num = (n) => Number(n || 0).toLocaleString();

    function stopsHtml(t) {
        const me = t.me;
        // A tour that is one continuous journey reads as a line of airports.
        // One whose legs do not chain is drawn leg by leg.
        const chained = t.legs.every((l, i) => i === 0 || t.legs[i - 1].destination === l.origin);
        if (chained) {
            const stops = [t.legs[0].origin, ...t.legs.map((l) => l.destination)];
            return `<div class="gl-route">${stops.map((code, i) => {
                // Stop i is reached once leg i-1 is flown; the first is where you start.
                const done = me && i > 0 && me.legs[i - 1];
                const next = me && !me.complete && me.nextLeg === i - 1 && i > 0;
                return `${i ? '<span class="gl-arrow">→</span>' : ''}<span class="gl-stop ${done ? 'gl-done' : ''} ${next ? 'gl-next' : ''}">${esc(code)}</span>`;
            }).join('')}</div>`;
        }
        return `<div class="gl-route">${t.legs.map((l, i) => {
            const done = me && me.legs[i];
            return `<span class="gl-stop ${done ? 'gl-done' : ''}">${esc(l.origin)}–${esc(l.destination)}</span>`;
        }).join('')}</div>`;
    }

    function boardHtml(board, fmt) {
        if (!board || !board.top || !board.top.length) return '';
        return `<div class="gl-board">${board.top.map((r, i) => `<div>
            <span class="gl-pos">${i + 1}</span>
            <span class="gl-who">${esc(r.name)}${r.callsign ? ` <span class="cp-faint">${esc(r.callsign)}</span>` : ''}</span>
            <span class="cp-muted">${fmt(r)}</span></div>`).join('')}</div>`;
    }

    function tourCard(t, { full = false } = {}) {
        const me = t.me;
        const pct = me ? Math.round((me.done / me.total) * 100) : 0;
        const next = me && !me.complete && me.nextLeg >= 0 ? t.legs[me.nextLeg] : null;
        const staff = S.data && S.data.canManage;
        return `<div class="gl-card" data-gl-id="${esc(t.id)}">
            ${t.image && P.safeUrl(t.image) ? `<div class="gl-art" style="background-image:url('${esc(t.image)}')"></div>` : ''}
            <div class="gl-in">
                <div class="gl-top">${medal(t, 'flag')}
                    <div style="flex:1;min-width:0"><div class="gl-title">${esc(t.title)}</div>
                        <div class="gl-when">${esc(windowText(t))} · ${t.legs.length} leg${t.legs.length === 1 ? '' : 's'}${t.ordered ? ', in order' : ', any order'}${t.minRank ? ` · ${esc(t.minRank)}+` : ''}</div></div>
                    ${phaseChip(t)}</div>
                ${t.blurb ? `<div class="cp-note" style="white-space:pre-line">${esc(full ? t.blurb : t.blurb.slice(0, 220) + (t.blurb.length > 220 ? '…' : ''))}</div>` : ''}
                ${stopsHtml(t)}
                ${me ? `${bar(pct, me.complete)}<div class="cp-note">${me.complete ? `Finished ${esc(relativeText(me.completedAt))} — <b>${esc(t.award.name)}</b> is on your awards shelf.` : `${me.done} of ${me.total} flown`}</div>` : ''}
                ${t.locked ? `<div class="cp-note cp-note-warn"><i data-lucide="lock" style="width:.85rem;height:.85rem;vertical-align:-1px"></i> Opens at ${esc(t.minRank)}. Legs you fly before then still count.</div>` : ''}
                ${next ? `<div class="gl-next"><b>Next:</b> ${esc(next.origin)} → ${esc(next.destination)}${next.aircraft ? ` in the ${esc(next.aircraft)}` : ''}${next.note ? ` — ${esc(next.note)}` : ''}</div>` : ''}
                ${t.board && t.board.flying ? `<div class="cp-note">${t.board.finishers} finished · ${t.board.flying} flying it</div>` : ''}
                ${full ? boardHtml(t.board, (r) => (r.completedAt ? `✓ ${esc(dateText(r.completedAt))}` : `${r.done}/${r.total}`)) : ''}
                ${full ? `<div class="gl-legs">${t.legs.map((l, i) => `<div class="cp-note">${i + 1}. <b>${esc(l.origin)} → ${esc(l.destination)}</b>${l.aircraft ? ` · ${esc(l.aircraft)}` : ''}${l.note ? ` — ${esc(l.note)}` : ''}${me && me.legs[i] ? ` <span class="cp-chip cp-chip-ok">flown ${esc(dateText(me.legs[i].at))}</span>` : ''}</div>`).join('')}</div>` : ''}
                <div class="gl-row">
                    ${full ? '' : `<button type="button" class="cp-btn cp-btn-sm" data-gl-open>Details &amp; leaderboard</button>`}
                    ${staff ? `<button type="button" class="cp-btn cp-btn-sm" data-gl-edit><i data-lucide="pencil"></i> Edit</button>
                        <button type="button" class="cp-btn cp-btn-sm" data-gl-toggle>${t.active ? 'Unpublish' : 'Publish'}</button>
                        <button type="button" class="cp-btn cp-btn-sm cp-btn-bad" data-gl-del><i data-lucide="trash-2"></i></button>` : ''}
                </div>
            </div></div>`;
    }

    function filterText(c) {
        const f = c.filter || {};
        const bits = [];
        if (f.airport) bits.push(`in or out of ${f.airport}`);
        if (f.origin) bits.push(`from ${f.origin}`);
        if (f.destination) bits.push(`to ${f.destination}`);
        if (f.aircraft) bits.push(`in the ${f.aircraft}`);
        if (f.routeKind === 'codeshare') bits.push('on codeshare routes');
        if (f.routeKind === 'own') bits.push('on our own routes');
        return bits.join(', ');
    }

    function challengeCard(c, { full = false } = {}) {
        const m = METRICS[c.metric] || METRICS.flights;
        const staff = S.data && S.data.canManage;
        const p = c.scope === 'crew' ? c.crew : c.me;
        const f = filterText(c);
        return `<div class="gl-card" data-gl-id="${esc(c.id)}">
            ${c.image && P.safeUrl(c.image) ? `<div class="gl-art" style="background-image:url('${esc(c.image)}')"></div>` : ''}
            <div class="gl-in">
                <div class="gl-top">${medal(c, 'trophy')}
                    <div style="flex:1;min-width:0"><div class="gl-title">${esc(c.title)}</div>
                        <div class="gl-when">${esc(windowText(c))} · ${c.scope === 'crew' ? 'the whole crew together' : 'each pilot'}</div></div>
                    ${phaseChip(c)}</div>
                <div style="font-size:.9rem"><b>${num(c.target)} ${esc(m.unit)}</b>${f ? ` <span class="cp-muted">${esc(f)}</span>` : ''}</div>
                ${c.blurb ? `<div class="cp-note" style="white-space:pre-line">${esc(full ? c.blurb : c.blurb.slice(0, 220) + (c.blurb.length > 220 ? '…' : ''))}</div>` : ''}
                ${p ? `${bar(p.pct, p.complete)}<div class="cp-note">${p.complete
                    ? (c.scope === 'crew' ? `Done together ${esc(relativeText(p.completedAt))}.` : `Done ${esc(relativeText(p.completedAt))} — <b>${esc(c.award.name)}</b> is on your awards shelf.`)
                    : `${num(p.have)} of ${num(p.need)} ${esc(m.unit)}${c.scope === 'crew' ? ' between everybody' : ''}`}</div>` : ''}
                ${boardHtml(c.board && { ...c.board, top: (c.board.top || []).slice(0, full ? 50 : 3) }, (r) => `${num(r.have)}${r.completedAt ? ' ✓' : ''}`)}
                <div class="gl-row">
                    ${full || !(c.board && c.board.flying > 3) ? '' : `<button type="button" class="cp-btn cp-btn-sm" data-gl-open>Full leaderboard</button>`}
                    ${staff ? `<button type="button" class="cp-btn cp-btn-sm" data-gl-edit><i data-lucide="pencil"></i> Edit</button>
                        <button type="button" class="cp-btn cp-btn-sm" data-gl-toggle>${c.active ? 'Unpublish' : 'Publish'}</button>
                        <button type="button" class="cp-btn cp-btn-sm cp-btn-bad" data-gl-del><i data-lucide="trash-2"></i></button>` : ''}
                </div>
            </div></div>`;
    }

    /* ---------------------------------------------------------------------
     * The sheet
     * ------------------------------------------------------------------- */

    function draw() {
        if (!S.panel) return;
        P.keepPlace(S.panel.body, () => {
            S.panel.body.innerHTML = S.view ? viewHtml() : listHtml();
            try { icons(); } catch (_) {}
        }, S.view ? `v:${S.view.kind}` : S.tab);
    }

    function listHtml() {
        if (!S.data && S.loading) return `<p class="cp-note" style="text-align:center;padding:2rem 0">Loading…</p>`;
        if (S.error && !S.data) {
            if (S.error.status === 404) return P.notBuiltHtml('Tours and challenges');
            return `<div class="cp-empty"><i data-lucide="triangle-alert"></i>${esc(S.error.message || 'Those could not be read.')}</div>`;
        }
        if (!S.data) return '';
        const staff = S.data.canManage;
        const tours = S.data.tours || [];
        const challenges = S.data.challenges || [];
        // Live first, then upcoming, then drafts, then finished — what can be
        // flown now is what the reader came for.
        const order = { live: 0, upcoming: 1, ended: 3 };
        const sort = (a, b) => ((a.active ? order[a.phase] : 2) - (b.active ? order[b.phase] : 2));
        const tab = (id, label, icon, n) => `<button type="button" class="gl-tab" data-gl-tab="${id}" aria-selected="${S.tab === id}"><i data-lucide="${icon}" style="width:1rem;height:1rem"></i>${label}${n ? ` · ${n}` : ''}</button>`;
        const list = S.tab === 'tours' ? tours.slice().sort(sort) : challenges.slice().sort(sort);
        const empty = S.tab === 'tours'
            ? `<div class="cp-empty"><i data-lucide="map"></i>No tours yet.${staff ? ' A tour is a journey of legs — the Silk Road in seven sectors, every capital in Europe — with an award at the end.' : ' When your airline sets one, it will be here.'}</div>`
            : `<div class="cp-empty"><i data-lucide="trophy"></i>No challenges yet.${staff ? ' A figure to reach in a window — fifty hours out of the hub this month, or a thousand landings between everybody.' : ' When your airline sets one, it will be here.'}</div>`;
        return `<div class="gl-tabs" role="tablist">${tab('tours', 'Tours', 'map', tours.length)}${tab('challenges', 'Challenges', 'trophy', challenges.length)}</div>
            ${staff ? `<button type="button" class="cp-btn cp-btn-primary" data-gl-new style="justify-content:center"><i data-lucide="plus"></i> New ${S.tab === 'tours' ? 'tour' : 'challenge'}</button>` : ''}
            ${!S.data.signedIn && !staff ? '<p class="cp-note">Sign in to see how far along you are.</p>' : ''}
            ${list.length ? list.map((g) => (S.tab === 'tours' ? tourCard(g) : challengeCard(g))).join('') : empty}`;
    }

    function viewHtml() {
        const v = S.view;
        const back = `<button type="button" class="cp-btn cp-btn-sm" data-gl-back style="justify-self:start"><i data-lucide="arrow-left"></i> Back</button>`;
        if (v.kind === 'detail') {
            if (!v.goal) return `${back}<p class="cp-note" style="text-align:center;padding:2rem 0">Loading…</p>`;
            return back + (v.goal.kind === 'tour' ? tourCard(v.goal, { full: true }) : challengeCard(v.goal, { full: true }));
        }
        return back + (v.kind === 'tour' ? tourForm(v.draft) : challengeForm(v.draft));
    }

    /* ---------------------------------------------------------------------
     * The editors
     * ------------------------------------------------------------------- */

    const toLocal = (iso) => {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    };
    const field = (label, html, hint = '') => `<div><label class="cp-label">${esc(label)}</label>${html}${hint ? `<div class="cp-note" style="margin-top:.25rem">${hint}</div>` : ''}</div>`;
    const awardFields = (a, fallback) => `<div class="cp-grid2">
            ${field('Award', `<input class="cp-input" data-f="award.name" maxlength="60" value="${esc(a.name || '')}" placeholder="${esc(fallback)}">`, 'Lands on the pilot’s awards shelf when they finish.')}
            ${field('Medal', `<select class="cp-select" data-f="award.tier">${TIERS.map((t) => `<option value="${t}" ${a.tier === t ? 'selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select>`)}
        </div>`;
    const commonFields = (d, kind) => `
        ${field('Title', `<input class="cp-input" data-f="title" maxlength="80" value="${esc(d.title || '')}" placeholder="${kind === 'tour' ? 'The Silk Road' : 'Hub hero'}">`)}
        ${field('What it is', `<textarea class="cp-textarea" data-f="blurb" maxlength="1200" placeholder="${kind === 'tour' ? 'Seven sectors from London to Beijing, the way the caravans went.' : 'Fly the most hours out of Heathrow this month.'}">${esc(d.blurb || '')}</textarea>`)}
        <div class="cp-grid2">
            ${field('Starts', `<input class="cp-input" type="datetime-local" data-f="startsAt" value="${esc(toLocal(d.startsAt))}">`, 'Empty: already open.')}
            ${field('Ends', `<input class="cp-input" type="datetime-local" data-f="endsAt" value="${esc(toLocal(d.endsAt))}">`, 'Empty: no deadline.')}
        </div>
        ${field('Picture (https link)', `<input class="cp-input" data-f="image" value="${esc(d.image || '')}" placeholder="https://…">`)}`;

    function tourForm(d) {
        const routes = S.routes || [];
        const chainBreak = d.legs.findIndex((l, i) => i > 0 && d.legs[i - 1].destination && l.origin && d.legs[i - 1].destination !== l.origin);
        return `<div class="cp-card" style="display:grid;gap:.75rem">
            <div class="cp-card-title">${d.id ? 'Edit tour' : 'New tour'}</div>
            ${commonFields(d, 'tour')}
            <div>
                <label class="cp-label">Legs</label>
                ${field('', `<div style="display:flex;gap:.4rem"><input class="cp-input" data-gl-routing placeholder="Type a routing: EGLL LFPG EDDF LIRF"><button type="button" class="cp-btn cp-btn-sm" data-gl-routing-go>Make legs</button></div>`, 'Airports in order, separated by spaces or dashes — each pair becomes a leg.')}
                <div class="gl-legs" style="margin-top:.6rem">${d.legs.map((l, i) => `<div class="gl-leg" data-leg="${i}">
                    <span class="gl-n">${i + 1}</span>
                    <input class="cp-input" data-leg-f="origin" maxlength="4" placeholder="From" value="${esc(l.origin)}" style="text-transform:uppercase" aria-label="Leg ${i + 1} from">
                    <input class="cp-input" data-leg-f="destination" maxlength="4" placeholder="To" value="${esc(l.destination)}" style="text-transform:uppercase" aria-label="Leg ${i + 1} to">
                    <input class="cp-input gl-ac" data-leg-f="aircraft" maxlength="60" placeholder="Any aircraft" value="${esc(l.aircraft || '')}" aria-label="Leg ${i + 1} aircraft">
                    <button type="button" class="cp-icon-btn" data-leg-del title="Remove leg"><i data-lucide="x"></i></button>
                </div>`).join('')}</div>
                ${chainBreak > 0 ? `<div class="cp-note cp-note-warn" style="margin-top:.4rem">Leg ${chainBreak + 1} does not start where leg ${chainBreak} ends. That is allowed — it will be drawn leg by leg rather than as one journey.</div>` : ''}
                <div class="gl-row" style="margin-top:.5rem">
                    <button type="button" class="cp-btn cp-btn-sm" data-leg-add><i data-lucide="plus"></i> Add a leg</button>
                    ${routes.length ? `<select class="cp-select" data-leg-from-network style="max-width:18rem"><option value="">Add one of your routes…</option>${routes.slice(0, 500).map((r) => `<option value="${esc(r.id)}">${esc([r.flightNumber, `${r.origin}→${r.destination}`, r.aircraft].filter(Boolean).join(' · '))}</option>`).join('')}</select>` : ''}
                </div>
            </div>
            <label class="cs-toggle" style="display:flex;gap:.55rem;align-items:flex-start;font-size:.85rem"><input type="checkbox" data-f="ordered" ${d.ordered !== false ? 'checked' : ''}> <span><b>In order</b><br><span class="cp-note">A leg only counts once the one before it is flown. Off, they can be flown in any order.</span></span></label>
            ${field('Opens at rank', `<input class="cp-input" data-f="minRank" maxlength="40" value="${esc(d.minRank || '')}" placeholder="Anyone">`, 'Optional. Your rank names, as on the ladder.')}
            ${awardFields(d.award || {}, d.title || 'Tour complete')}
            <label style="display:flex;gap:.55rem;align-items:center;font-size:.85rem"><input type="checkbox" data-f="active" ${d.active !== false ? 'checked' : ''}> Published — pilots can see it${d.id ? '' : ', and your Discord events feed hears about it'}</label>
            <button type="button" class="cp-btn cp-btn-primary" data-gl-save style="justify-content:center"><i data-lucide="save"></i> Save tour</button>
        </div>`;
    }

    function challengeForm(d) {
        const f = d.filter || {};
        return `<div class="cp-card" style="display:grid;gap:.75rem">
            <div class="cp-card-title">${d.id ? 'Edit challenge' : 'New challenge'}</div>
            ${commonFields(d, 'challenge')}
            <div class="cp-grid2">
                ${field('Count', `<select class="cp-select" data-f="metric">${Object.entries(METRICS).map(([k, m]) => `<option value="${k}" ${d.metric === k ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select>`)}
                ${field('Target', `<input class="cp-input" type="number" min="1" step="1" data-f="target" value="${esc(d.target || '')}" placeholder="50">`)}
            </div>
            ${field('Who', `<select class="cp-select" data-f="scope"><option value="pilot" ${d.scope !== 'crew' ? 'selected' : ''}>Each pilot on their own — with a leaderboard</option><option value="crew" ${d.scope === 'crew' ? 'selected' : ''}>The whole crew together — one bar</option></select>`)}
            <details ${f.airport || f.origin || f.destination || f.aircraft || f.routeKind ? 'open' : ''}><summary class="cp-label" style="cursor:pointer">Which flights count (optional)</summary>
                <div style="display:grid;gap:.6rem;margin-top:.5rem">
                    <div class="cp-grid2">
                        ${field('Airport, either end', `<input class="cp-input" data-f="filter.airport" maxlength="4" value="${esc(f.airport || '')}" placeholder="EGLL" style="text-transform:uppercase">`)}
                        ${field('Aircraft', `<input class="cp-input" data-f="filter.aircraft" maxlength="60" value="${esc(f.aircraft || '')}" placeholder="A320">`)}
                    </div>
                    <div class="cp-grid2">
                        ${field('From', `<input class="cp-input" data-f="filter.origin" maxlength="4" value="${esc(f.origin || '')}" style="text-transform:uppercase">`)}
                        ${field('To', `<input class="cp-input" data-f="filter.destination" maxlength="4" value="${esc(f.destination || '')}" style="text-transform:uppercase">`)}
                    </div>
                    ${field('Routes', `<select class="cp-select" data-f="filter.routeKind"><option value="">Any route</option><option value="own" ${f.routeKind === 'own' ? 'selected' : ''}>Only our own routes</option><option value="codeshare" ${f.routeKind === 'codeshare' ? 'selected' : ''}>Only codeshare routes</option></select>`)}
                </div>
            </details>
            ${awardFields(d.award || {}, d.title || 'Challenge won')}
            <label style="display:flex;gap:.55rem;align-items:center;font-size:.85rem"><input type="checkbox" data-f="active" ${d.active !== false ? 'checked' : ''}> Published — pilots can see it${d.id ? '' : ', and your Discord events feed hears about it'}</label>
            <button type="button" class="cp-btn cp-btn-primary" data-gl-save style="justify-content:center"><i data-lucide="save"></i> Save challenge</button>
        </div>`;
    }

    /** Read the form back into the draft, so a redraw never loses typing. */
    function readForm() {
        const v = S.view;
        if (!v || !v.draft) return;
        const d = v.draft;
        S.panel.body.querySelectorAll('[data-f]').forEach((el) => {
            const key = el.getAttribute('data-f');
            let val = el.type === 'checkbox' ? el.checked : el.value;
            if (el.type === 'datetime-local') val = val ? new Date(val).toISOString() : null;
            if (/^filter\.(airport|origin|destination)$/.test(key)) val = String(val).toUpperCase().trim();
            const [a, b] = key.split('.');
            if (b) { d[a] = d[a] || {}; d[a][b] = val; } else d[a] = val;
        });
        if (d.target !== undefined && d.target !== '') d.target = Number(d.target);
        if (v.kind === 'tour') {
            S.panel.body.querySelectorAll('[data-leg]').forEach((row) => {
                const l = d.legs[Number(row.getAttribute('data-leg'))];
                if (!l) return;
                row.querySelectorAll('[data-leg-f]').forEach((el) => {
                    const k = el.getAttribute('data-leg-f');
                    l[k] = k === 'aircraft' ? el.value : el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
                });
            });
        }
    }

    const blankTour = () => ({ title: '', blurb: '', image: '', legs: [{ origin: '', destination: '', aircraft: '' }], ordered: true, minRank: '', active: true, award: { tier: 'gold' } });
    const blankChallenge = () => ({ title: '', blurb: '', image: '', metric: 'flights', target: '', scope: 'pilot', filter: {}, active: true, award: { tier: 'gold' } });
    const clone = (o) => JSON.parse(JSON.stringify(o));

    async function networkRoutes() {
        if (S.routes) return S.routes;
        try { const d = await S.api('/routes'); S.routes = (d.routes || []).filter((r) => r.origin && r.destination); } catch { S.routes = []; }
        return S.routes;
    }

    async function onClick(ev) {
        const t = ev.target.closest('button, select[data-leg-from-network]');
        if (!t) return;
        if (t.tagName === 'SELECT') return;
        const card = t.closest('[data-gl-id]');
        const id = card && card.getAttribute('data-gl-id');
        const list = S.tab === 'tours' ? (S.data && S.data.tours) || [] : (S.data && S.data.challenges) || [];
        const goal = id ? (list.find((g) => g.id === id) || (S.view && S.view.goal)) : null;
        const kind = (goal && goal.kind) || (S.tab === 'tours' ? 'tour' : 'challenge');
        const base = kind === 'tour' ? '/tours' : '/challenges';

        if (t.hasAttribute('data-gl-tab')) { S.tab = t.getAttribute('data-gl-tab'); draw(); return; }
        if (t.hasAttribute('data-gl-back')) { S.view = null; draw(); return; }
        if (t.hasAttribute('data-gl-new')) {
            const k = S.tab === 'tours' ? 'tour' : 'challenge';
            S.view = { kind: k, draft: k === 'tour' ? blankTour() : blankChallenge() };
            if (k === 'tour') await networkRoutes();
            draw();
            return;
        }
        if (t.hasAttribute('data-gl-edit') && goal) {
            S.view = { kind, draft: clone(goal) };
            if (kind === 'tour') await networkRoutes();
            draw();
            return;
        }
        if (t.hasAttribute('data-gl-open') && goal) {
            S.view = { kind: 'detail', goal: null };
            draw();
            try { S.view.goal = (await S.api(`/goals/${encodeURIComponent(goal.id)}`)).goal; } catch (err) { P.toast(err.message, 'bad'); S.view = null; }
            draw();
            return;
        }
        if (t.hasAttribute('data-gl-toggle') && goal) {
            const done = P.busy(t, false);
            try { await S.api(`${base}/${encodeURIComponent(goal.id)}`, { method: 'PATCH', body: { active: !goal.active } }); P.toast(goal.active ? 'Unpublished.' : 'Published.', 'ok'); await load(); } catch (err) { P.toast(err.message, 'bad'); } finally { done(); }
            return;
        }
        if (t.hasAttribute('data-gl-del') && goal) {
            if (!await P.ask({ title: `Remove “${goal.title}”?`, body: 'Nobody’s flying is lost — progress is only ever worked out from approved flights — but the award comes off pilots’ shelves.', confirm: 'Remove', danger: true })) return;
            try { await S.api(`${base}/${encodeURIComponent(goal.id)}`, { method: 'DELETE' }); P.toast('Removed.', 'ok'); S.view = null; await load(); } catch (err) { P.toast(err.message, 'bad'); }
            return;
        }

        // ---- inside an editor ----
        const v = S.view;
        if (!v || !v.draft) return;
        readForm();
        const d = v.draft;
        if (t.hasAttribute('data-leg-add')) { d.legs.push({ origin: (d.legs[d.legs.length - 1] || {}).destination || '', destination: '', aircraft: '' }); draw(); return; }
        if (t.hasAttribute('data-leg-del')) { d.legs.splice(Number(t.closest('[data-leg]').getAttribute('data-leg')), 1); if (!d.legs.length) d.legs.push({ origin: '', destination: '', aircraft: '' }); draw(); return; }
        if (t.hasAttribute('data-gl-routing-go')) {
            const input = S.panel.body.querySelector('[data-gl-routing]');
            const codes = String((input && input.value) || '').toUpperCase().split(/[^A-Z0-9]+/).filter((c) => c.length >= 3 && c.length <= 4);
            if (codes.length < 2) { P.toast('Type at least two airport codes.', 'bad'); return; }
            const legs = codes.slice(1).map((c, i) => ({ origin: codes[i], destination: c, aircraft: '' }));
            // Replace a blank starting leg; append to real ones.
            d.legs = d.legs.filter((l) => l.origin || l.destination).concat(legs);
            draw();
            return;
        }
        if (t.hasAttribute('data-gl-save')) {
            const body = clone(d);
            if (v.kind === 'tour') body.legs = body.legs.filter((l) => l.origin && l.destination);
            if (!String(body.title || '').trim()) { P.toast('Give it a title.', 'bad'); return; }
            if (v.kind === 'tour' && !body.legs.length) { P.toast('A tour needs at least one leg with both airports.', 'bad'); return; }
            if (v.kind === 'challenge' && !(Number(body.target) > 0)) { P.toast('Set a target above zero.', 'bad'); return; }
            const done = P.busy(t, 'Saving…');
            try {
                const path = v.kind === 'tour' ? '/tours' : '/challenges';
                if (d.id) await S.api(`${path}/${encodeURIComponent(d.id)}`, { method: 'PATCH', body });
                else await S.api(path, { method: 'POST', body });
                P.toast('Saved.', 'ok');
                S.view = null;
                S.tab = v.kind === 'tour' ? 'tours' : 'challenges';
                await load();
            } catch (err) { P.toast(err.message, 'bad'); } finally { done(); }
        }
    }

    function onChange(ev) {
        const sel = ev.target.closest('[data-leg-from-network]');
        if (!sel || !sel.value || !S.view || !S.view.draft) return;
        readForm();
        const r = (S.routes || []).find((x) => String(x.id) === sel.value);
        if (r) {
            const d = S.view.draft;
            d.legs = d.legs.filter((l) => l.origin || l.destination);
            d.legs.push({ origin: r.origin, destination: r.destination, aircraft: '' });
        }
        draw();
    }

    /* ---------------------------------------------------------------------
     * On a page: the tour you are part-way through, and the live challenge
     * you are closest to — hidden entirely until there is one.
     * ------------------------------------------------------------------- */

    function paintStrips() {
        S.hosts = S.hosts.filter((h) => h.isConnected);
        const d = S.data;
        for (const host of S.hosts) {
            const tour = d && (d.tours || []).find((t) => t.active && t.phase === 'live' && t.me && t.me.done > 0 && !t.me.complete);
            const chal = d && (d.challenges || []).filter((c) => c.active && c.phase === 'live' && (c.me || c.crew) && !(c.me || c.crew).complete)
                .sort((a, b) => ((b.me || b.crew).pct - (a.me || a.crew).pct))[0];
            if (!tour && !chal) { host.innerHTML = ''; host.classList.add('cp-hidden'); continue; }
            host.classList.remove('cp-hidden');
            host.innerHTML = `<div class="gl-strip">${tour ? tourCard(tour) : ''}${chal ? challengeCard(chal) : ''}</div>`;
            host.querySelectorAll('.gl-row').forEach((r) => { r.innerHTML = '<button type="button" class="cp-btn cp-btn-sm" data-gl-strip>All tours &amp; challenges</button>'; });
            try { icons(); } catch (_) {}
        }
    }

    function mountStrip(host, { api } = {}) {
        if (!host || typeof api !== 'function') return;
        styles();
        S.api = api;
        host.classList.add('cp-hidden');
        if (!host.dataset.glWired) {
            host.dataset.glWired = '1';
            host.addEventListener('click', (ev) => { if (ev.target.closest('[data-gl-strip]')) open({ api }); });
        }
        if (S.hosts.indexOf(host) === -1) S.hosts.push(host);
        if (S.data) { paintStrips(); return; }
        S.api('/goals').then((d) => { S.data = d; paintStrips(); }).catch(() => {});
    }

    function open({ api, tab } = {}) {
        if (typeof api !== 'function') { console.warn('crewGoals: needs an api function'); return; }
        styles();
        S.api = api;
        S.view = null;
        if (tab) S.tab = tab;
        if (!S.panel) {
            S.panel = P.sheet({ id: 'crewGoals', title: 'Tours & challenges', icon: 'flag', wide: true });
            S.panel.body.addEventListener('click', (ev) => { onClick(ev).catch((err) => P.toast(err.message || 'That didn’t work.', 'bad')); });
            S.panel.body.addEventListener('change', onChange);
        }
        S.panel.open();
        draw();
        load();
    }

    window.CrewGoals = { open, close: () => S.panel && S.panel.close(), mountStrip };
})();
