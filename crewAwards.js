/* ============================================================================
   crewAwards.js — what a pilot has to show for it.

   WHY THIS EXISTS

   Hours are a number that goes up. They are a perfectly good measure and a
   terrible reward: nobody screenshots 214.

   Everything here is computed from flights the VA has ALREADY approved, by the
   server, on a schedule. That matters more than it sounds:

     · Nothing new is being asked of staff. No badge needs awarding by hand, so
       no badge is forgotten, and there is no second currency to argue about.
     · Nothing can be gamed that the flight log does not already permit. If a
       flight was good enough to approve, it is good enough to count.
     · A VA that turns the shop off, or never opens this panel, still has every
       one of these accruing quietly — so the day they do open it, it is full.

   LOCKED BADGES SHOW THEIR PROGRESS

   A wall of grey squares with no explanation is a wall people close. Every
   locked badge says what it takes and how far along the pilot is, because the
   whole value of the thing is being able to see one you are close to.

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewAwards: crewPanels.js must load first'); return; }
    const { esc, icons, relativeText } = P;

    const S = { api: null, panel: null, data: null, loading: false, error: null, hosts: [] };

    function styles() {
        P.baseStyles();
        P.style('crew-awards', `
        .aw-grid{ display:grid; gap:.7rem; grid-template-columns:repeat(auto-fill,minmax(8.5rem,1fr)); }
        .aw{ display:flex; flex-direction:column; align-items:center; text-align:center; gap:.4rem;
            padding:.9rem .6rem; border:1px solid var(--line,#e5e5e5); border-radius:.9rem;
            background:var(--surface,#fff); }
        .aw-medal{ width:3.1rem; height:3.1rem; border-radius:50%; display:grid; place-items:center;
            position:relative; flex:none;
            background:radial-gradient(120% 120% at 30% 20%,
                color-mix(in srgb, var(--aw-c) 80%, #fff 20%), var(--aw-c));
            color:#fff; box-shadow:0 6px 16px -8px var(--aw-c), inset 0 1px 0 rgb(255 255 255 / .45); }
        .aw-medal i{ width:1.4rem; height:1.4rem; }
        /* Locked: the same medal with the light off. Recognisably the object
           they could have, which is the point — a grey box is not. */
        .aw-off .aw-medal{ background:color-mix(in srgb, var(--ink,#1C1A16) 8%, transparent);
            color:var(--faint,#A8A296); box-shadow:none; }
        .aw-off .aw-name{ color:var(--muted,#736E64); }
        .aw-name{ font-size:.8rem; font-weight:700; letter-spacing:-.01em; line-height:1.25; }
        .aw-desc{ font-size:.7rem; color:var(--muted,#736E64); line-height:1.3; }
        .aw-when{ font-size:.64rem; color:var(--faint,#A8A296); font-weight:700;
            letter-spacing:.06em; text-transform:uppercase; }
        .aw-bar{ width:100%; height:.3rem; border-radius:999px; margin-top:.1rem;
            background:color-mix(in srgb, var(--ink,#1C1A16) 8%, transparent); overflow:hidden; }
        .aw-bar span{ display:block; height:100%; background:var(--accent); border-radius:999px; }
        .aw-h{ font-size:.72rem; font-weight:800; letter-spacing:.14em; text-transform:uppercase;
            color:var(--faint,#A8A296); margin:.2rem 0 .1rem; }
        .aw-count{ font-size:.8rem; color:var(--muted,#736E64); text-align:center; }
        /* The strip on the pilot's page: the newest few, in a row. */
        .aw-strip{ display:flex; gap:.55rem; overflow-x:auto; padding-bottom:.2rem;
            scroll-snap-type:x mandatory; -webkit-overflow-scrolling:touch; }
        .aw-strip .aw{ flex:0 0 7.5rem; scroll-snap-align:start; }
        `);
    }

    /* Tiers are a visual grouping, not a score. They exist so a wall of forty
       badges has a shape — the rare ones read as rare at a glance. */
    const colour = (tier) => ({
        bronze: '#B4794A', silver: '#9AA3B2', gold: '#C9A227', platinum: '#6E8BFF',
    }[tier] || 'var(--accent)');

    async function load() {
        S.loading = true; S.error = null;
        draw();
        try { S.data = await S.api('/awards'); }
        catch (err) { S.error = err; }
        S.loading = false;
        draw(); paintStrips();
    }

    /** One badge, earned or not. Progress only where the server sent some. */
    function awardHtml(a, earnedAt, progress) {
        const on = !!earnedAt;
        const pct = progress && progress.need
            ? Math.min(100, Math.round((Number(progress.have) || 0) / Number(progress.need) * 100)) : 0;
        return `<div class="aw ${on ? '' : 'aw-off'}" style="--aw-c:${colour(a.tier)}">
            <span class="aw-medal"><i data-lucide="${esc(a.icon || 'award')}"></i></span>
            <span class="aw-name">${esc(a.name || 'Award')}</span>
            ${a.desc ? `<span class="aw-desc">${esc(a.desc)}</span>` : ''}
            ${on
                ? `<span class="aw-when">${esc(relativeText(earnedAt))}</span>`
                : progress && progress.need
                    ? `<span class="aw-bar"><span style="width:${pct}%"></span></span>
                       <span class="aw-desc">${esc(`${Math.round(Number(progress.have) || 0).toLocaleString()} of ${Number(progress.need).toLocaleString()}`)}</span>`
                    : ''}
        </div>`;
    }

    function draw() {
        if (!S.panel) return;
        P.keepPlace(S.panel.body, () => {
            S.panel.body.innerHTML = bodyHtml();
            try { icons(); } catch (_) {}
        });
    }

    function bodyHtml() {
        if (!S.data && S.loading) return `<p class="cp-note" style="text-align:center;padding:2rem 0">Counting them up…</p>`;
        if (S.error && !S.data) {
            if (P.isSchemaGap(S.error) || S.error.status === 404) {
                return P.schemaGapHtml(S.error.status === 404
                    ? { message: 'Awards need your crew center’s database brought up to date.' }
                    : S.error);
            }
            return `<div class="cp-empty"><i data-lucide="triangle-alert"></i>
                ${esc(S.error.message || 'Those could not be read.')}</div>`;
        }
        if (!S.data) return '';

        const catalog = S.data.catalog || [];
        if (!catalog.length) {
            return `<div class="cp-empty"><i data-lucide="award"></i>This airline has no awards set up.</div>`;
        }
        const earned = new Map((S.data.earned || []).map((e) => [String(e.id), e.at]));
        const progress = S.data.progress || {};
        const has = catalog.filter((a) => earned.has(String(a.id)));
        const not = catalog.filter((a) => !earned.has(String(a.id)));

        const who = S.data.forName ? ` · ${esc(S.data.forName)}` : '';
        return `<div class="aw-count">${has.length} of ${catalog.length} earned${who}</div>
            ${has.length ? `<div class="aw-h">Earned</div>
                <div class="aw-grid">${has.map((a) => awardHtml(a, earned.get(String(a.id)))).join('')}</div>` : ''}
            ${not.length ? `<div class="aw-h" style="margin-top:.9rem">Still to come</div>
                <div class="aw-grid">${not.map((a) => awardHtml(a, null, progress[a.id])).join('')}</div>` : ''}`;
    }

    /* =====================================================================
     * ON A PAGE
     *
     * The newest few, as a row, under the pilot's numbers. Draws nothing at
     * all until there is something to draw — an empty trophy shelf on the
     * page of somebody who has just joined is the opposite of encouraging.
     * =================================================================== */

    function paintStrips() {
        S.hosts = S.hosts.filter((h) => h.isConnected);
        S.hosts.forEach((host) => {
            const earned = (S.data && S.data.earned) || [];
            if (!earned.length) { host.innerHTML = ''; host.classList.add('cp-hidden'); return; }
            const byId = new Map(((S.data && S.data.catalog) || []).map((a) => [String(a.id), a]));
            const recent = earned.slice().sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 8);
            host.classList.remove('cp-hidden');
            host.innerHTML = `<div class="aw-strip">${recent.map((e) => {
                const a = byId.get(String(e.id)) || { name: e.name || 'Award', tier: e.tier, icon: e.icon };
                return awardHtml(a, e.at);
            }).join('')}</div>`;
            try { icons(); } catch (_) {}
        });
    }

    function mountStrip(host, { api } = {}) {
        if (!host || typeof api !== 'function') return;
        styles();
        S.api = api;
        host.classList.add('cp-hidden');
        if (S.hosts.indexOf(host) === -1) S.hosts.push(host);
        if (S.data) { paintStrips(); return; }
        S.api('/awards').then((d) => { S.data = d; paintStrips(); }).catch(() => {});
    }

    function open({ api } = {}) {
        if (typeof api !== 'function') { console.warn('crewAwards: needs an api function'); return; }
        styles();
        S.api = api;
        if (!S.panel) S.panel = P.sheet({ id: 'crewAwards', title: 'Awards', icon: 'award' });
        S.panel.open();
        draw();
        load();
    }

    window.CrewAwards = { open, close: () => S.panel && S.panel.close(), mountStrip };
})();
