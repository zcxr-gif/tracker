/*
 * crewMultipliers.js
 * Temporary multipliers on one event or one route.
 *
 * "The Christmas event counts double this week", "BA117 is 1.5× until Sunday".
 * A flight that matches and was flown inside the window is credited at that
 * factor — its hours (towards ranks) and its shop points. The backend decides
 * (crewMultipliers.js there); this file is the two screens that show it:
 *
 *   open()          staff: every multiplier, live, upcoming and finished,
 *                   with a form to add or change one.
 *   mountStrip()    a pilot's "Bonus flying" card: what is boosted now and
 *                   next. Hidden when nothing is.
 *
 * GET /multipliers   (public: live + upcoming; staff: all, plus canManage)
 * PUT /multipliers   { multipliers: [...] }
 */
(function () {
    'use strict';
    const P = window.CrewPanels;
    if (!P) { console.warn('crewMultipliers: crewPanels.js must load first'); return; }
    const { esc, icons } = P;

    let styled = false;
    function styles() {
        if (styled) return;
        styled = true;
        const el = document.createElement('style');
        el.textContent = `
        .mx-row{ display:flex; align-items:flex-start; gap:.6rem; padding:.65rem 0; border-top:1px solid var(--line,#e5e5e5); }
        .mx-row:first-child{ border-top:0; }
        .mx-x{ flex:none; min-width:2.6rem; padding:.2rem .4rem; border-radius:.5rem; text-align:center; font-weight:800; font-size:.9rem;
            background:color-mix(in srgb, var(--accent,#2563eb) 14%, transparent); color:var(--accent,#2563eb); }
        .mx-row.mx-ended .mx-x{ opacity:.45; }
        .mx-grow{ flex:1; min-width:0; }
        .mx-name{ font-weight:600; font-size:.9rem; }
        .mx-sub{ font-size:.78rem; opacity:.7; }
        .mx-h{ font-size:.68rem; font-weight:800; letter-spacing:.12em; text-transform:uppercase; opacity:.55; margin:.9rem 0 .2rem; }
        .mx-form{ display:grid; gap:.55rem; }
        .mx-two{ display:grid; grid-template-columns:repeat(auto-fit,minmax(10rem,1fr)); gap:.55rem; }
        .mx-acts{ display:flex; flex-wrap:wrap; gap:.4rem; }`;
        document.head.appendChild(el);
    }

    const S = { api: null, panel: null, list: [], routes: [], events: [], can: { route: false, event: false }, editing: null, error: '', loading: false, min: 1.1, max: 5 };

    const dateText = (iso) => { try { return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
    const shortDate = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); } catch { return ''; } };
    // <input type="datetime-local"> speaks local time without a zone.
    const toLocalInput = (iso) => {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    const fromLocalInput = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toISOString(); };
    const routeName = (r) => [r.flightNumber, `${r.origin || '—'} → ${r.destination || '—'}`].filter(Boolean).join(' · ');
    const targetName = (m, routes, events) => {
        if (m.kind === 'route') { const r = routes.find((x) => String(x.id) === m.targetId); return r ? routeName(r) : 'A route no longer on the network'; }
        const e = events.find((x) => String(x.id) === m.targetId);
        return e ? (e.title || 'Event') : 'An event no longer listed';
    };
    const stateOf = (m, now = Date.now()) => (new Date(m.endsAt).getTime() <= now ? 'ended'
        : new Date(m.startsAt).getTime() <= now ? 'live' : 'upcoming');

    async function loadAll(api) {
        const [mx, rt, ev] = await Promise.all([
            api('/multipliers'),
            api('/routes').catch(() => ({ routes: [] })),
            api('/events').catch(() => ({ events: [] })),
        ]);
        return { mx, routes: rt.routes || [], events: ev.events || [] };
    }

    /* ---- Staff panel ---------------------------------------------------- */

    function rowHtml(m) {
        const st = stateOf(m);
        const when = st === 'ended' ? `Ended ${shortDate(m.endsAt)}`
            : st === 'live' ? `Live until ${dateText(m.endsAt)}` : `${dateText(m.startsAt)} → ${dateText(m.endsAt)}`;
        const mine = m.kind === 'route' ? S.can.route : S.can.event;
        return `<div class="mx-row${st === 'ended' ? ' mx-ended' : ''}" data-mx-id="${esc(m.id)}">
                <span class="mx-x">${esc(String(m.factor))}×</span>
                <div class="mx-grow">
                    <div class="mx-name">${esc(targetName(m, S.routes, S.events))}</div>
                    <div class="mx-sub">${m.kind === 'route' ? 'Route' : 'Event'}${m.label ? ` · ${esc(m.label)}` : ''} · ${esc(when)}</div>
                </div>
                ${mine ? `<div class="mx-acts"><button type="button" class="cp-btn cp-btn-sm" data-mx-edit>Edit</button>
                    <button type="button" class="cp-btn cp-btn-sm cp-btn-bad" data-mx-del>${st === 'live' ? 'End now' : 'Remove'}</button></div>` : ''}
            </div>`;
    }

    function formHtml() {
        const f = S.editing;
        const kinds = [S.can.event && ['event', 'An event'], S.can.route && ['route', 'A route']].filter(Boolean);
        const opts = f.kind === 'route'
            ? S.routes.map((r) => [String(r.id), routeName(r)])
            : S.events.map((e) => [String(e.id), `${e.title || 'Event'}${e.startsAt ? ` — ${shortDate(e.startsAt)}` : ''}`]);
        return `<div class="cp-card mx-form" data-mx-form>
                <div class="mx-two">
                    <label class="cp-label">On
                        <select class="cp-select" data-mx-f="kind">${kinds.map(([k, n]) => `<option value="${k}" ${f.kind === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
                    <label class="cp-label">Which one
                        <select class="cp-select" data-mx-f="targetId"><option value="">— pick ${f.kind === 'route' ? 'a route' : 'an event'} —</option>
                        ${opts.map(([id, n]) => `<option value="${esc(id)}" ${f.targetId === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
                </div>
                <div class="mx-two">
                    <label class="cp-label">Multiplier
                        <input class="cp-input" type="number" step="0.1" min="${S.min}" max="${S.max}" data-mx-f="factor" value="${esc(String(f.factor))}"></label>
                    <label class="cp-label">Name pilots see (optional)
                        <input class="cp-input" maxlength="60" data-mx-f="label" value="${esc(f.label)}" placeholder="e.g. Christmas double"></label>
                </div>
                <div class="mx-two">
                    <label class="cp-label">Starts
                        <input class="cp-input" type="datetime-local" data-mx-f="startsAt" value="${esc(toLocalInput(f.startsAt))}"></label>
                    <label class="cp-label">Ends
                        <input class="cp-input" type="datetime-local" data-mx-f="endsAt" value="${esc(toLocalInput(f.endsAt))}"></label>
                </div>
                <p class="cp-note">Flights flown between these times on it get ${esc(String(f.factor))}× their hours towards ranks, and ${esc(String(f.factor))}× their points if you run a shop. If two apply to one flight, the bigger one counts — they don’t stack.</p>
                <div class="mx-acts">
                    <button type="button" class="cp-btn cp-btn-primary" data-mx-save><i data-lucide="save"></i> ${f.id ? 'Save' : 'Add multiplier'}</button>
                    <button type="button" class="cp-btn" data-mx-cancel>Cancel</button>
                </div>
            </div>`;
    }

    function draw() {
        if (!S.panel) return;
        const body = S.panel.body;
        if (S.loading) { body.innerHTML = '<p class="cp-note" style="text-align:center;padding:2rem 0">Loading…</p>'; return; }
        if (S.error) { body.innerHTML = `<div class="cp-empty"><i data-lucide="triangle-alert"></i>${esc(S.error)}</div>`; icons(); return; }
        const now = Date.now();
        const group = (st) => S.list.filter((m) => stateOf(m, now) === st);
        const section = (title, rows) => (rows.length ? `<div class="mx-h">${title}</div><div class="cp-card">${rows.map(rowHtml).join('')}</div>` : '');
        const canAdd = S.can.route || S.can.event;
        body.innerHTML = `
            <p class="cp-note">A multiplier boosts one event or one route for a while — its hours count ×N towards ranks, and so do its points.</p>
            ${S.editing ? formHtml() : (canAdd ? '<div class="mx-acts" style="margin-top:.5rem"><button type="button" class="cp-btn cp-btn-primary" data-mx-new><i data-lucide="plus"></i> New multiplier</button></div>' : '')}
            ${section('Live now', group('live'))}
            ${section('Coming up', group('upcoming'))}
            ${section('Finished', group('ended'))}
            ${S.list.length ? '' : '<p class="cp-note" style="margin-top:1rem">None yet.</p>'}`;
        icons();
    }

    async function load() {
        S.loading = true; S.error = ''; draw();
        try {
            const d = await loadAll(S.api);
            S.list = d.mx.multipliers || [];
            S.can = d.mx.canManage || { route: false, event: false };
            S.min = d.mx.min || 1.1; S.max = d.mx.max || 5;
            S.routes = d.routes; S.events = d.events;
        } catch (err) { S.error = err.message || 'Could not read the multipliers.'; }
        S.loading = false; draw();
    }

    async function save(next, okText) {
        try {
            const d = await S.api('/multipliers', { method: 'PUT', body: { multipliers: next } });
            S.list = d.multipliers || [];
            S.editing = null;
            P.toast(okText, 'ok');
            P.emit && P.emit('multipliers:changed');
        } catch (err) { P.toast(err.message || 'That didn’t save.', 'bad'); }
        draw();
    }

    function blank() {
        const kind = S.can.event ? 'event' : 'route';
        const now = new Date();
        return { id: '', kind, targetId: '', factor: 2, label: '', startsAt: now.toISOString(), endsAt: new Date(now.getTime() + 7 * 864e5).toISOString() };
    }

    function wire(panel) {
        panel.body.addEventListener('click', (ev) => {
            const t = ev.target.closest('button');
            if (!t) return;
            const row = t.closest('[data-mx-id]');
            const m = row ? S.list.find((x) => x.id === row.getAttribute('data-mx-id')) : null;
            if (t.hasAttribute('data-mx-new')) { S.editing = blank(); draw(); return; }
            if (t.hasAttribute('data-mx-cancel')) { S.editing = null; draw(); return; }
            if (t.hasAttribute('data-mx-edit') && m) { S.editing = { ...m }; draw(); return; }
            if (t.hasAttribute('data-mx-del') && m) {
                // A live one is ended rather than deleted, so the flights it
                // already boosted still read right in the list.
                const next = stateOf(m) === 'live'
                    ? S.list.map((x) => (x.id === m.id ? { ...x, endsAt: new Date().toISOString() } : x))
                    : S.list.filter((x) => x.id !== m.id);
                save(next, stateOf(m) === 'live' ? 'Ended — flights from now are credited normally.' : 'Removed.');
                return;
            }
            if (t.hasAttribute('data-mx-save') && S.editing) {
                const f = S.editing;
                if (!f.targetId) { P.toast(`Pick ${f.kind === 'route' ? 'a route' : 'an event'}.`, 'bad'); return; }
                const factor = Number(f.factor);
                if (!(factor >= S.min && factor <= S.max)) { P.toast(`The multiplier has to be between ${S.min}× and ${S.max}×.`, 'bad'); return; }
                if (!f.endsAt || new Date(f.endsAt) <= new Date(f.startsAt)) { P.toast('It has to end after it starts.', 'bad'); return; }
                const clean = { ...f, factor };
                const next = f.id ? S.list.map((x) => (x.id === f.id ? clean : x)) : [...S.list, clean];
                save(next, f.id ? 'Saved.' : `${factor}× is set.`);
            }
        });
        const onField = (ev) => {
            const el = ev.target.closest('[data-mx-f]');
            if (!el || !S.editing) return;
            const k = el.getAttribute('data-mx-f');
            if (k === 'startsAt' || k === 'endsAt') S.editing[k] = fromLocalInput(el.value);
            else S.editing[k] = el.value;
            // A different kind lists different things; an event picked first
            // pre-fills its own window.
            if (k === 'kind') { S.editing.targetId = ''; draw(); }
            if (k === 'targetId' && S.editing.kind === 'event') {
                const e = S.events.find((x) => String(x.id) === el.value);
                if (e && e.startsAt && !S.editing.id) {
                    S.editing.startsAt = new Date(e.startsAt).toISOString();
                    S.editing.endsAt = new Date(e.endsAt || new Date(e.startsAt).getTime() + 24 * 3600 * 1000).toISOString();
                    draw();
                }
            }
        };
        panel.body.addEventListener('change', onField);
        panel.body.addEventListener('input', (ev) => { if (ev.target.matches('[data-mx-f="factor"],[data-mx-f="label"]')) onField(ev); });
    }

    function open({ api } = {}) {
        if (typeof api !== 'function') { console.warn('crewMultipliers: needs an api function'); return; }
        styles();
        S.api = api;
        if (!S.panel) {
            S.panel = P.sheet({ id: 'crewMultipliers', title: 'Multipliers', icon: 'zap' });
            wire(S.panel);
        }
        S.editing = null;
        S.panel.open();
        load();
    }

    /* ---- Pilot strip ---------------------------------------------------- */

    async function mountStrip(host, { api } = {}) {
        if (!host || typeof api !== 'function') return;
        styles();
        host.classList.add('cp-hidden');
        let d;
        try { d = await loadAll(api); } catch (_) { return; }
        const now = Date.now();
        const list = (d.mx.multipliers || []).filter((m) => stateOf(m, now) !== 'ended').slice(0, 6);
        if (!list.length) return;
        host.innerHTML = `<div class="cp-card">
                <h3 class="cp-card-title">Bonus flying</h3>
                <p class="cp-note" style="margin-top:.2rem">Fly these while they last — hours and points count extra.</p>
                ${list.map((m) => {
                    const st = stateOf(m, now);
                    return `<div class="mx-row"><span class="mx-x">${esc(String(m.factor))}×</span><div class="mx-grow">
                        <div class="mx-name">${esc(targetName(m, d.routes, d.events))}</div>
                        <div class="mx-sub">${m.label ? `${esc(m.label)} · ` : ''}${st === 'live' ? `until ${esc(dateText(m.endsAt))}` : `from ${esc(dateText(m.startsAt))}`}</div></div></div>`;
                }).join('')}
            </div>`;
        host.classList.remove('cp-hidden');
        icons();
    }

    window.CrewMultipliers = { open, mountStrip, close: () => S.panel && S.panel.close() };
})();
