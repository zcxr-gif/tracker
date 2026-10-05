/* ============================================================================
   crewFeaturedPlanner.js — staff build the Route of the Week and of the Day.

   WHAT IT DOES

   The crew center picks a Route of the Week (seven legs, some paying a random
   bonus) and a Route of the Day (one leg) on its own, every period, from the
   airline's network — codeshares included. This is where staff take over:

     · pick which week (this one, or up to eight ahead) or which day
     · add the legs from the network — own metal or a partner's, logo and all
     · set a bonus on any of them, or roll the bonuses at random
     · SAVE A DRAFT, which nobody but staff can see, and RELEASE it when it is
       ready — or release it in one go. A released plan for the current week
       goes to Discord straight away; one for a later week posts itself the
       moment that week starts.

   And the two switches around it: whether the rotation's own pick is posted
   when nobody has planned one, and "post it to Discord now".

   Nothing here decides anything the server would not: the legs are checked
   against the network, the periods against the calendar, and the bonuses are
   clamped, all on the way in.

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewFeaturedPlanner: crewPanels.js must load first'); return; }
    const { esc, icons, durationText } = P;

    const S = {
        api: null,
        panel: null,
        data: null,
        loading: false,
        error: null,
        period: 'week',
        key: '',
        draft: null,      // { legs: [{ routeId, bonus }], title, note }
        dirty: false,
        query: '',
        onChange: null,
    };

    const WORD = { week: 'Route of the Week', day: 'Route of the Day' };
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    function styles() {
        P.baseStyles();
        P.style('crew-featured-planner', `
        .fp2-wrap{ display:grid; gap:1rem; }
        .fp2-seg{ display:flex; gap:.25rem; padding:.25rem; border-radius:.7rem;
            background:color-mix(in srgb, var(--ink,#1C1A16) 6%, transparent); }
        .fp2-seg button{ flex:1; font:inherit; font-size:.82rem; font-weight:700; padding:.5rem; border:0;
            border-radius:.5rem; background:none; color:var(--muted,#736E64); cursor:pointer; }
        .fp2-seg button[aria-pressed="true"]{ background:var(--surface,#fff); color:var(--ink,#1C1A16);
            box-shadow:0 1px 2px rgb(0 0 0 / .12); }
        .fp2-status{ display:flex; gap:.6rem; align-items:flex-start; padding:.7rem .8rem; border-radius:.7rem;
            font-size:.8rem; line-height:1.45; background:color-mix(in srgb, var(--accent) 9%, transparent); }
        .fp2-status i{ width:1rem; height:1rem; flex:none; margin-top:.1rem; color:var(--accent); }
        .fp2-status b{ display:block; font-size:.85rem; }
        .fp2-status.is-draft{ background:color-mix(in srgb, #D97706 12%, transparent); }
        .fp2-status.is-draft i{ color:#B45309; }
        .fp2-h{ font-size:.7rem; font-weight:800; letter-spacing:.1em; text-transform:uppercase;
            color:var(--muted,#736E64); display:flex; justify-content:space-between; align-items:center; }
        .fp2-legs{ display:grid; gap:.45rem; }
        .fp2-leg{ display:flex; align-items:center; gap:.65rem; padding:.55rem .65rem; border-radius:.75rem;
            border:1px solid var(--line,#e5e5e5); background:var(--surface,#fff); }
        .fp2-logo{ width:2.1rem; height:2.1rem; flex:none; border-radius:999px; object-fit:contain; background:#fff;
            border:1px solid var(--line,#e5e5e5); display:grid; place-items:center; font-size:.68rem; font-weight:800;
            color:var(--muted,#736E64); overflow:hidden; }
        .fp2-leg-main{ flex:1; min-width:0; }
        .fp2-pair{ font-weight:800; letter-spacing:-.01em; }
        .fp2-sub{ font-size:.72rem; color:var(--muted,#736E64); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .fp2-leg select{ width:auto; flex:none; font-size:.75rem; padding:.3rem .4rem; }
        .fp2-x{ flex:none; border:0; background:none; cursor:pointer; color:var(--faint,#A8A296); font-size:1rem; padding:.2rem; }
        .fp2-x:hover{ color:#DC2626; }
        .fp2-move{ display:flex; flex-direction:column; flex:none; }
        .fp2-move button{ border:0; background:none; cursor:pointer; color:var(--faint,#A8A296); font-size:.7rem; line-height:1; padding:.1rem .25rem; }
        .fp2-move button:hover{ color:var(--accent); }
        .fp2-move button[disabled]{ opacity:.3; cursor:default; }
        .fp2-gone{ opacity:.6; border-style:dashed; }
        .fp2-bonus{ font-size:.66rem; font-weight:800; padding:.15rem .45rem; border-radius:999px;
            background:#FBBF24; color:#3B2A00; white-space:nowrap; }
        .fp2-find{ display:grid; gap:.4rem; }
        .fp2-results{ display:grid; gap:.3rem; max-height:16rem; overflow:auto; }
        .fp2-result{ display:flex; align-items:center; gap:.6rem; width:100%; text-align:left; font:inherit; cursor:pointer;
            padding:.45rem .55rem; border-radius:.6rem; border:1px dashed var(--line,#e5e5e5); background:none; color:inherit; }
        .fp2-result:hover{ border-style:solid; border-color:var(--accent); }
        .fp2-result .fp2-logo{ width:1.7rem; height:1.7rem; }
        .fp2-acts{ display:flex; flex-wrap:wrap; gap:.4rem; }
        .fp2-acts .cp-btn-primary{ flex:1 1 9rem; }
        .fp2-box{ border:1px solid var(--line,#e5e5e5); border-radius:.85rem; padding:.75rem .8rem; display:grid; gap:.55rem; }
        .fp2-check{ display:flex; gap:.5rem; align-items:flex-start; font-size:.82rem; }
        .fp2-check input{ margin-top:.15rem; accent-color:var(--accent); }
        .fp2-check span{ display:block; font-size:.74rem; color:var(--muted,#736E64); }
        `);
    }

    /* ---- Reading ---------------------------------------------------------- */

    async function load() {
        S.loading = true; S.error = null;
        draw();
        try {
            S.data = await S.api('/featured-routes');
            if (!S.data.canManage) throw Object.assign(new Error('Planning the featured routes is for whoever manages routes.'), { status: 403 });
            const keys = upcoming();
            if (!keys.some((k) => k.key === S.key)) S.key = (keys[0] && keys[0].key) || '';
            if (!S.dirty) syncDraft();
        } catch (err) { S.error = err; }
        S.loading = false;
        draw();
    }

    const upcoming = () => ((S.data && S.data.upcoming && S.data.upcoming[S.period]) || []);
    const planFor = (period, key) => ((S.data && S.data.plans) || []).find((p) => p.period === period && p.periodKey === key) || null;
    const routesById = () => new Map(((S.data && S.data.routes) || []).map((r) => [String(r.id), r]));
    const isCurrent = () => (upcoming()[0] || {}).key === S.key;
    const maxLegs = () => ((S.data && S.data.maxLegs) || { week: 7, day: 1 })[S.period] || 1;

    function syncDraft() {
        const plan = planFor(S.period, S.key);
        S.draft = plan
            ? { legs: plan.legs.map((l) => ({ routeId: String(l.routeId), bonus: Number(l.bonus) || 1 })), title: plan.title || '', note: plan.note || '' }
            : { legs: [], title: '', note: '' };
        S.dirty = false;
    }

    /* ---- Words ------------------------------------------------------------ */

    function periodLabel(period, startsAt, i) {
        const d = new Date(startsAt);
        if (Number.isNaN(d.getTime())) return '';
        if (period === 'day') {
            const name = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : DAYS[d.getUTCDay()];
            return `${name} · ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
        }
        const end = new Date(d.getTime() + 6 * 86400000);
        const name = i === 0 ? 'This week' : i === 1 ? 'Next week' : `Week of ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
        return `${name} · ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} – ${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]}`;
    }
    const bonusText = (b) => `${Number(b)}×`;

    function logoHtml(r) {
        const name = (r && (r.kind === 'codeshare' ? r.partnerName : '')) || '';
        if (r && r.logo) return `<img class="fp2-logo" src="${esc(r.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
        const letters = (name || r && r.flightNumber || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
        return `<span class="fp2-logo">${esc(letters)}</span>`;
    }
    function subOf(r, extra) {
        return [r.flightNumber, r.aircraft, r.estimatedMin ? durationText(r.estimatedMin) : '',
            r.kind === 'codeshare' ? `Codeshare · ${r.partnerName || 'partner'}` : '', extra].filter(Boolean).join(' · ');
    }

    /* ---- Drawing ---------------------------------------------------------- */

    function draw() {
        if (!S.panel || !S.panel.isOpen()) return;
        P.keepPlace(S.panel.body, () => {
            S.panel.body.innerHTML = bodyHtml();
            try { icons(); } catch (_) {}
        });
    }

    function bodyHtml() {
        if (S.loading && !S.data) return '<p class="cp-note" style="text-align:center;padding:2rem 0">Loading the network…</p>';
        if (S.error && !S.data) {
            return `<div class="cp-empty"><i data-lucide="cloud-off"></i>${esc(S.error.message || 'Could not load that.')}
                <div style="margin-top:.8rem"><button class="cp-btn" data-fp2-retry>Try again</button></div></div>`;
        }
        if (!S.data) return '';
        if (S.error && S.error.status === 403) return `<div class="cp-empty"><i data-lucide="lock"></i>${esc(S.error.message)}</div>`;
        if (!S.data.network) {
            return `<div class="cp-empty"><i data-lucide="route"></i>Publish some routes first — the Route of the Week is picked from your network.</div>`;
        }
        return `<div class="fp2-wrap">
            <div class="fp2-seg" role="group" aria-label="Which one">
                <button type="button" data-fp2-period="week" aria-pressed="${S.period === 'week'}">Route of the Week</button>
                <button type="button" data-fp2-period="day" aria-pressed="${S.period === 'day'}">Route of the Day</button>
            </div>
            <label class="cp-label">${S.period === 'week' ? 'Which week' : 'Which day'}
                <select class="cp-select" data-fp2-key>
                    ${upcoming().map((k, i) => {
                        const plan = planFor(S.period, k.key);
                        const tag = plan ? (plan.status === 'released' ? ' · Released' : ' · Draft') : '';
                        return `<option value="${esc(k.key)}" ${k.key === S.key ? 'selected' : ''}>${esc(periodLabel(S.period, k.startsAt, i) + tag)}</option>`;
                    }).join('')}
                </select></label>
            ${statusHtml()}
            ${editorHtml()}
            ${settingsHtml()}
        </div>`;
    }

    function statusHtml() {
        const plan = planFor(S.period, S.key);
        const now = isCurrent();
        if (plan && plan.status === 'released') {
            return `<div class="fp2-status"><i data-lucide="radio"></i><div><b>Released${now ? ' — live now' : ''}</b>
                ${now ? 'Every pilot sees these legs, whatever their rank.' : 'Goes live — and posts to Discord — when this period starts.'}
                ${plan.releasedBy ? ` Released by ${esc(plan.releasedBy)}.` : ''}</div></div>`;
        }
        if (plan) {
            return `<div class="fp2-status is-draft"><i data-lucide="pencil-ruler"></i><div><b>Draft — only staff can see this</b>
                Pilots ${now ? 'still see the rotation’s pick' : 'will see the rotation’s pick'} until you release it.</div></div>`;
        }
        return `<div class="fp2-status"><i data-lucide="shuffle"></i><div><b>Nothing planned — the rotation picks</b>
            ${now ? 'Below is what pilots see right now. Customise it, or build your own from the network.' : `Build the ${S.period === 'week' ? 'week' : 'day'} below, save it as a draft, and release it when it is ready.`}</div></div>`;
    }

    function editorHtml() {
        const byId = routesById();
        const legs = (S.draft && S.draft.legs) || [];
        const max = maxLegs();
        const live = S.data[S.period];
        const showRotation = !legs.length && isCurrent() && live && !live.planned && live.legs && live.legs.length;
        const bonuses = (S.data.bonusSteps || [1.25, 1.5, 2]);

        const rows = legs.map((l, i) => {
            const r = byId.get(String(l.routeId));
            if (!r) {
                return `<div class="fp2-leg fp2-gone"><span class="fp2-logo">?</span><div class="fp2-leg-main">
                    <div class="fp2-pair">A route no longer on the network</div><div class="fp2-sub">Remove it, or it is skipped.</div></div>
                    <button class="fp2-x" data-fp2-del="${i}" title="Remove">✕</button></div>`;
            }
            return `<div class="fp2-leg">
                ${max > 1 ? `<span class="fp2-move"><button data-fp2-up="${i}" ${i ? '' : 'disabled'} title="Up">▲</button>
                    <button data-fp2-down="${i}" ${i < legs.length - 1 ? '' : 'disabled'} title="Down">▼</button></span>` : ''}
                ${logoHtml(r)}
                <div class="fp2-leg-main"><div class="fp2-pair">${esc(r.origin)} → ${esc(r.destination)}</div>
                    <div class="fp2-sub">${esc(subOf(r))}</div></div>
                <select class="cp-select" data-fp2-bonus="${i}" title="Pays the whole flight again at this multiple">
                    <option value="1" ${l.bonus > 1 ? '' : 'selected'}>No bonus</option>
                    ${bonuses.map((b) => `<option value="${b}" ${Number(l.bonus) === b ? 'selected' : ''}>${bonusText(b)} pay</option>`).join('')}
                </select>
                <button class="fp2-x" data-fp2-del="${i}" title="Remove">✕</button>
            </div>`;
        }).join('');

        const rotation = showRotation ? `<div class="fp2-legs">${live.legs.map((l) => `<div class="fp2-leg">
                ${logoHtml(l.route)}<div class="fp2-leg-main"><div class="fp2-pair">${esc(l.route.origin)} → ${esc(l.route.destination)}</div>
                <div class="fp2-sub">${esc(subOf({ ...l.route, estimatedMin: l.estimatedMin }))}</div></div>
                ${l.bonus > 1 ? `<span class="fp2-bonus">${bonusText(l.bonus)} pay</span>` : ''}</div>`).join('')}</div>
            <div class="fp2-acts"><button class="cp-btn" data-fp2-adopt><i data-lucide="copy-plus"></i> Customise these</button></div>` : '';

        const chosen = new Set(legs.map((l) => String(l.routeId)));
        const q = S.query.trim().toLowerCase();
        const hits = legs.length >= max ? [] : ((S.data.routes || [])
            .filter((r) => !chosen.has(String(r.id)))
            .filter((r) => !q || [r.origin, r.destination, r.flightNumber, r.aircraft, r.partnerName, `${r.origin}-${r.destination}`, `${r.origin} ${r.destination}`]
                .some((v) => String(v || '').toLowerCase().includes(q)))
            .slice(0, 10));

        const find = legs.length >= max
            ? `<p class="cp-note">${max === 1 ? 'The day is one leg.' : `That’s all ${max} — remove one to swap it.`}</p>`
            : `<div class="fp2-find">
                <input class="cp-input" data-fp2-q value="${esc(S.query)}" placeholder="Find a route — ICAO, flight number, aircraft or partner" autocomplete="off" spellcheck="false">
                <div class="fp2-results">${hits.length ? hits.map((r) => `<button type="button" class="fp2-result" data-fp2-add="${esc(r.id)}">
                    ${logoHtml(r)}<span class="fp2-leg-main"><span class="fp2-pair">${esc(r.origin)} → ${esc(r.destination)}</span>
                    <span class="fp2-sub" style="display:block">${esc(subOf(r))}</span></span><i data-lucide="plus"></i></button>`).join('')
                    : '<p class="cp-note">No route matches that.</p>'}</div>
            </div>`;

        const plan = planFor(S.period, S.key);
        const released = plan && plan.status === 'released';
        const canSave = legs.some((l) => byId.has(String(l.routeId)));
        const noShop = !S.data.currency;

        return `<div class="fp2-box">
            <div class="fp2-h"><span>${S.period === 'week' ? 'The legs' : 'The leg'}</span><span>${legs.length} of ${max}</span></div>
            ${rotation}
            ${legs.length ? `<div class="fp2-legs">${rows}</div>` : (showRotation ? '' : '<p class="cp-note">No legs yet — add from your network below. Codeshares count.</p>')}
            ${find}
            <label class="cp-label">Headline <span class="cp-faint">(optional)</span>
                <input class="cp-input" data-fp2-title maxlength="80" value="${esc((S.draft && S.draft.title) || '')}" placeholder="${S.period === 'week' ? 'Ruta de la semana: the Pacific' : 'Tonight: the long one'}"></label>
            <label class="cp-label">A line for the crew <span class="cp-faint">(optional)</span>
                <textarea class="cp-textarea" rows="2" data-fp2-note maxlength="400" placeholder="Fly all seven for a badge.">${esc((S.draft && S.draft.note) || '')}</textarea></label>
            ${noShop ? '<p class="cp-note">Bonuses pay in your shop currency — turn the shop on (Shop → settings) for them to pay anything.</p>' : ''}
            <div class="fp2-acts">
                ${S.period === 'week' && legs.length > 1 ? '<button class="cp-btn" data-fp2-roll title="Puts a random bonus on some of the legs"><i data-lucide="dices"></i> Random bonuses</button>' : ''}
                ${released
                    ? `<button class="cp-btn cp-btn-primary" data-fp2-save ${canSave && S.dirty ? '' : 'disabled'}><i data-lucide="save"></i> Save changes</button>
                       <button class="cp-btn" data-fp2-unrelease><i data-lucide="eye-off"></i> Back to draft</button>`
                    : `<button class="cp-btn" data-fp2-save ${canSave ? '' : 'disabled'}><i data-lucide="save"></i> Save draft</button>
                       <button class="cp-btn cp-btn-primary" data-fp2-release ${canSave ? '' : 'disabled'}><i data-lucide="send"></i> ${isCurrent() ? 'Release now' : 'Release'}</button>`}
                ${plan ? '<button class="cp-btn cp-btn-bad" data-fp2-delete title="Hands this period back to the rotation"><i data-lucide="trash-2"></i></button>' : ''}
            </div>
        </div>`;
    }

    function settingsHtml() {
        const hook = !!S.data.webhook;
        return `<div class="fp2-box">
            <div class="fp2-h"><span>Discord</span></div>
            ${hook ? '' : '<p class="cp-note">No webhook yet — add one under <b>Settings → Alerts</b> (the “Featured routes” box, or your main one) and the cards post themselves.</p>'}
            <label class="fp2-check"><input type="checkbox" data-fp2-auto ${S.data.autoPost ? 'checked' : ''}>
                <b>Post the rotation’s pick automatically<span>Every Monday for the week and every midnight (Z) for the day. A plan you release is always posted.</span></b></label>
            <div class="fp2-acts">
                <button class="cp-btn cp-btn-sm" data-fp2-post="week" ${hook ? '' : 'disabled'}><i data-lucide="send"></i> Post this week’s now</button>
                <button class="cp-btn cp-btn-sm" data-fp2-post="day" ${hook ? '' : 'disabled'}><i data-lucide="send"></i> Post today’s now</button>
            </div>
        </div>`;
    }

    /* ---- Doing ------------------------------------------------------------ */

    function readFields() {
        if (!S.panel || !S.draft) return;
        const t = S.panel.body.querySelector('[data-fp2-title]');
        const n = S.panel.body.querySelector('[data-fp2-note]');
        if (t) S.draft.title = t.value;
        if (n) S.draft.note = n.value;
    }

    function rollBonuses() {
        const steps = S.data.bonusSteps || [1.25, 1.5, 2];
        const legs = S.draft.legs;
        legs.forEach((l) => {
            if (Math.random() < 0.35) {
                const r = Math.random();
                l.bonus = r < 0.5 ? steps[0] : r < 0.85 ? steps[1] : steps[2];
            } else l.bonus = 1;
        });
        if (legs.length > 1 && !legs.some((l) => l.bonus > 1)) legs[Math.floor(Math.random() * legs.length)].bonus = steps[1];
    }

    async function save(mode, btn) {
        readFields();
        const plan = planFor(S.period, S.key);
        const legs = S.draft.legs.filter((l) => routesById().has(String(l.routeId)));
        const done = P.busy(btn, mode === 'release' ? 'Releasing…' : 'Saving…');
        try {
            let d;
            if (plan) {
                d = await S.api(`/featured-routes/plans/${encodeURIComponent(plan.id)}`, {
                    method: 'PATCH',
                    body: { legs, title: S.draft.title, note: S.draft.note, ...(mode === 'release' ? { action: 'release' } : mode === 'unrelease' ? { action: 'unrelease' } : {}) },
                });
            } else {
                d = await S.api('/featured-routes/plans', {
                    method: 'POST',
                    body: { period: S.period, periodKey: S.key, legs, title: S.draft.title, note: S.draft.note, release: mode === 'release' },
                });
            }
            S.data = d;
            syncDraft();
            draw();
            changed();
            P.toast(mode === 'release'
                ? (d.posted ? 'Released — and posted to Discord.' : isCurrent() ? 'Released. Every pilot sees it now.' : 'Released. It goes live, and posts, when the period starts.')
                : mode === 'unrelease' ? 'Back to draft — pilots see the rotation again.' : 'Saved.', 'ok');
        } catch (err) {
            P.toast((err && err.message) || 'That didn’t save.', 'bad');
        } finally { done(); }
    }

    async function removePlan(btn) {
        const plan = planFor(S.period, S.key);
        if (!plan) return;
        const yes = await P.ask({
            title: 'Remove this plan?',
            body: 'The period goes back to the rotation’s own pick.',
            confirm: 'Remove', danger: true,
        });
        if (!yes) return;
        const done = P.busy(btn, false);
        try {
            S.data = await S.api(`/featured-routes/plans/${encodeURIComponent(plan.id)}`, { method: 'DELETE' });
            syncDraft();
            draw();
            changed();
            P.toast('Removed. The rotation picks again.', 'ok');
        } catch (err) { P.toast((err && err.message) || 'That didn’t work.', 'bad'); } finally { done(); }
    }

    async function setAuto(on) {
        try {
            const d = await S.api('/featured-routes/settings', { method: 'POST', body: { autoPost: !!on } });
            S.data.autoPost = d.autoPost;
            P.toast(on ? 'The rotation’s pick will be posted.' : 'Only plans you release will be posted.', 'ok');
        } catch (err) { P.toast((err && err.message) || 'That didn’t save.', 'bad'); draw(); }
    }

    async function postNow(period, btn) {
        const done = P.busy(btn, 'Posting…');
        try {
            await S.api('/featured-routes/post', { method: 'POST', body: { period } });
            P.toast('Posted to Discord.', 'ok');
        } catch (err) { P.toast((err && err.message) || 'That didn’t post.', 'bad'); } finally { done(); }
    }

    function changed() { if (typeof S.onChange === 'function') { try { S.onChange(); } catch (_) {} } }

    function wire(panel) {
        const el = panel.body;
        if (el.dataset.fp2Wired) return;
        el.dataset.fp2Wired = '1';
        el.addEventListener('input', (ev) => {
            if (ev.target.matches('[data-fp2-q]')) {
                S.query = ev.target.value;
                const pos = ev.target.selectionStart;
                draw();
                const q = S.panel.body.querySelector('[data-fp2-q]');
                if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (_) {} }
                return;
            }
            if (ev.target.matches('[data-fp2-title], [data-fp2-note]')) { readFields(); S.dirty = true; }
        });
        el.addEventListener('change', (ev) => {
            const t = ev.target;
            if (t.matches('[data-fp2-key]')) { S.key = t.value; S.query = ''; syncDraft(); draw(); return; }
            if (t.matches('[data-fp2-bonus]')) { readFields(); S.draft.legs[Number(t.getAttribute('data-fp2-bonus'))].bonus = Number(t.value) || 1; S.dirty = true; draw(); return; }
            if (t.matches('[data-fp2-auto]')) { setAuto(t.checked); }
        });
        el.addEventListener('click', (ev) => {
            const t = ev.target;
            if (t.closest('[data-fp2-retry]')) { load(); return; }
            const per = t.closest('[data-fp2-period]');
            if (per) {
                S.period = per.getAttribute('data-fp2-period');
                S.key = (upcoming()[0] || {}).key || '';
                S.query = '';
                syncDraft();
                draw();
                return;
            }
            const add = t.closest('[data-fp2-add]');
            if (add) {
                readFields();
                if (S.draft.legs.length < maxLegs()) S.draft.legs.push({ routeId: add.getAttribute('data-fp2-add'), bonus: 1 });
                S.dirty = true; S.query = ''; draw();
                return;
            }
            const del = t.closest('[data-fp2-del]');
            if (del) { readFields(); S.draft.legs.splice(Number(del.getAttribute('data-fp2-del')), 1); S.dirty = true; draw(); return; }
            const up = t.closest('[data-fp2-up]');
            const down = t.closest('[data-fp2-down]');
            if (up || down) {
                readFields();
                const i = Number((up || down).getAttribute(up ? 'data-fp2-up' : 'data-fp2-down'));
                const j = up ? i - 1 : i + 1;
                const L = S.draft.legs;
                if (j >= 0 && j < L.length) { [L[i], L[j]] = [L[j], L[i]]; S.dirty = true; draw(); }
                return;
            }
            if (t.closest('[data-fp2-adopt]')) {
                const live = S.data[S.period];
                S.draft.legs = (live && live.legs || []).map((l) => ({ routeId: String(l.route.id), bonus: Number(l.bonus) || 1 }));
                S.dirty = true; draw();
                return;
            }
            if (t.closest('[data-fp2-roll]')) { readFields(); rollBonuses(); S.dirty = true; draw(); return; }
            const sv = t.closest('[data-fp2-save]');
            if (sv) { save('save', sv); return; }
            const rl = t.closest('[data-fp2-release]');
            if (rl) { save('release', rl); return; }
            const un = t.closest('[data-fp2-unrelease]');
            if (un) { save('unrelease', un); return; }
            const rm = t.closest('[data-fp2-delete]');
            if (rm) { removePlan(rm); return; }
            const po = t.closest('[data-fp2-post]');
            if (po) { postNow(po.getAttribute('data-fp2-post'), po); }
        });
    }

    function open({ api, period, onChange } = {}) {
        if (typeof api !== 'function') { console.warn('crewFeaturedPlanner: needs an api function'); return; }
        styles();
        S.api = api;
        if (onChange) S.onChange = onChange;
        if (period === 'day' || period === 'week') { S.period = period; S.key = ''; }
        if (!S.panel) {
            S.panel = P.sheet({ id: 'crewFeaturedPlanner', title: 'Route of the Week & Day', icon: 'sparkles' });
            wire(S.panel);
        }
        S.panel.open();
        S.dirty = false;
        draw();
        load();
    }

    window.CrewFeaturedPlanner = { open, close: () => S.panel && S.panel.close() };
})();
