/*
 * crewProbation.js
 * The set routes a new pilot flies to finish probation.
 *
 * An airline can ask its new pilots for more than "one flight in your first
 * week": a number of SET routes, drawn at random from its network or chosen by
 * staff for each pilot (crewRetention.js on the backend decides, and the roster
 * sweep enforces it). This file is the two screens that make that visible:
 *
 *   mountCard(host)   the pilot's own card — which routes, which are flown,
 *                     and when probation ends. Hidden unless they have some.
 *   mountStaff(host)  staff: every pilot still on probation, with a way to
 *                     choose their routes, draw again, or take them away.
 *
 * GET  /probation                (pilot: own; staff: everybody, ?memberId=, ?mine=1)
 * PUT  /probation/:memberId      { routeIds } | { random: true } | { clear: true }
 */
(function () {
    'use strict';
    const P = window.CrewPanels;
    if (!P) { console.warn('crewProbation: crewPanels.js must load first'); return; }
    const { esc, icons } = P;

    let styled = false;
    function styles() {
        if (styled) return;
        styled = true;
        const css = `
        .pb-legs{ display:grid; gap:.3rem; margin-top:.6rem; }
        .pb-leg{ display:flex; align-items:center; gap:.55rem; font-size:.86rem; }
        .pb-leg .pb-tick{ width:1.15rem; height:1.15rem; border-radius:999px; display:grid; place-items:center; flex:none;
            border:1.5px solid var(--line,#d4d4d4); font-size:.7rem; }
        .pb-leg.pb-done .pb-tick{ background:var(--accent,#2563eb); border-color:var(--accent,#2563eb); color:#fff; }
        .pb-leg.pb-done .pb-name{ opacity:.6; text-decoration:line-through; }
        .pb-bar{ height:.4rem; border-radius:999px; background:color-mix(in srgb, var(--accent,#2563eb) 14%, transparent); overflow:hidden; margin-top:.55rem; }
        .pb-bar > span{ display:block; height:100%; background:var(--accent,#2563eb); }
        .pb-row{ padding:.7rem 0; border-top:1px solid var(--line,#e5e5e5); }
        .pb-row:first-child{ border-top:0; }
        .pb-pick{ max-height:16rem; overflow-y:auto; display:grid; gap:.15rem; margin-top:.5rem; }
        .pb-pick label{ display:flex; align-items:center; gap:.5rem; font-size:.84rem; cursor:pointer; }
        .pb-acts{ display:flex; flex-wrap:wrap; gap:.4rem; margin-top:.5rem; }
        .pb-muted{ font-size:.8rem; opacity:.7; }`;
        const el = document.createElement('style');
        el.textContent = css;
        document.head.appendChild(el);
    }

    const legName = (r) => [r.flightNumber, `${r.origin} → ${r.destination}`].filter(Boolean).join(' · ');
    const dateText = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); } catch { return ''; } };
    const legsHtml = (routes) => `<div class="pb-legs">${routes.map((r) => `<div class="pb-leg${r.flown ? ' pb-done' : ''}">
            <span class="pb-tick">${r.flown ? '✓' : ''}</span><span class="pb-name">${esc(legName(r))}</span>
            ${r.aircraft ? `<span class="pb-muted">${esc(r.aircraft)}</span>` : ''}</div>`).join('')}</div>`;
    const bar = (done, of) => `<div class="pb-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${of}" aria-valuenow="${done}"><span style="width:${of ? Math.round((done / of) * 100) : 0}%"></span></div>`;

    /* ---- The pilot's card ---------------------------------------------- */

    async function mountCard(host, { api } = {}) {
        if (!host || typeof api !== 'function') return;
        styles();
        host.classList.add('cp-hidden');
        let d;
        try { d = await api('/probation?mine=1'); } catch (_) { return; }
        const m = d && d.mine;
        if (!d || !d.enabled || !m) return;
        if (!m.assigned) {
            // Staff mode, nothing chosen yet: say so, so the pilot is not left
            // wondering what "probation" means on their page.
            if (d.pick !== 'staff') return;
            host.innerHTML = `<div class="cp-card"><h3 class="cp-card-title">Your first routes</h3>
                <p class="pb-muted" style="margin-top:.35rem">Your staff will choose ${d.required} route${d.required === 1 ? '' : 's'} for you to fly. Once they do, you have ${d.days} day${d.days === 1 ? '' : 's'} to fly them — they will appear here.</p></div>`;
            host.classList.remove('cp-hidden');
            return;
        }
        if (m.complete) return;
        host.innerHTML = `<div class="cp-card">
                <div style="display:flex;align-items:baseline;justify-content:space-between;gap:.5rem">
                    <h3 class="cp-card-title">Your first routes</h3>
                    <span class="pb-muted">${m.done} of ${m.required} flown</span>
                </div>
                <p class="pb-muted" style="margin-top:.3rem">Fly ${m.required === 1 ? 'this route' : `these ${m.required} routes`} by <b>${esc(dateText(m.dueAt))}</b> to finish probation. A flight counts once it is approved.</p>
                ${bar(m.done, m.required)}
                ${legsHtml(m.routes)}
            </div>`;
        host.classList.remove('cp-hidden');
        icons();
    }

    /* ---- Staff: everybody on probation --------------------------------- */

    const St = { api: null, host: null, data: null, editing: '', picked: new Set(), q: '', busy: false, error: '' };

    async function loadStaff() {
        St.error = '';
        try { St.data = await St.api('/probation'); } catch (err) { St.error = err.message || 'Could not read probation routes.'; }
        drawStaff();
    }

    function pickerHtml(p) {
        const all = (St.data && St.data.routes) || [];
        const q = St.q.trim().toLowerCase();
        const shown = q ? all.filter((r) => legName(r).toLowerCase().includes(q) || String(r.aircraft || '').toLowerCase().includes(q)) : all;
        return `<div style="margin-top:.5rem">
                <input class="cp-input" data-pb-q placeholder="Search your routes — EGLL, BA117…" value="${esc(St.q)}">
                <div class="pb-pick">${shown.slice(0, 300).map((r) => `<label><input type="checkbox" data-pb-route="${esc(r.id)}" ${St.picked.has(r.id) ? 'checked' : ''}>
                    <span>${esc(legName(r))}</span>${r.aircraft ? `<span class="pb-muted">${esc(r.aircraft)}</span>` : ''}</label>`).join('')
                    || '<p class="pb-muted">No published routes match.</p>'}</div>
                <div class="pb-acts">
                    <button type="button" class="cp-btn cp-btn-sm cp-btn-primary" data-pb-save="${esc(p.memberId)}">Give ${St.picked.size || ''} route${St.picked.size === 1 ? '' : 's'}</button>
                    <button type="button" class="cp-btn cp-btn-sm" data-pb-cancel>Cancel</button>
                </div>
            </div>`;
    }

    function rowHtml(p) {
        const head = `<div style="display:flex;align-items:baseline;justify-content:space-between;gap:.5rem">
                <div><b>${esc(p.name || 'A pilot')}</b> <span class="pb-muted">${esc(p.callsign || '')}</span></div>
                <span class="pb-muted">${p.assigned ? `${p.done} of ${p.required} · ends ${esc(dateText(p.dueAt))}` : 'No routes yet'}</span>
            </div>`;
        const body = p.assigned ? `${bar(p.done, p.required)}${legsHtml(p.routes)}` : '<p class="pb-muted" style="margin-top:.3rem">Waiting for staff to choose — their clock has not started.</p>';
        const editing = St.editing === p.memberId;
        const acts = editing ? pickerHtml(p) : `<div class="pb-acts">
                <button type="button" class="cp-btn cp-btn-sm" data-pb-edit="${esc(p.memberId)}">${p.assigned ? 'Change routes' : 'Choose routes'}</button>
                <button type="button" class="cp-btn cp-btn-sm" data-pb-random="${esc(p.memberId)}">${p.assigned ? 'Draw again' : 'Pick at random'}</button>
                ${p.assigned ? `<button type="button" class="cp-btn cp-btn-sm" data-pb-clear="${esc(p.memberId)}">Take away</button>` : ''}
            </div>`;
        return `<div class="pb-row" data-pb-member="${esc(p.memberId)}">${head}${body}${acts}</div>`;
    }

    function drawStaff() {
        const host = St.host;
        if (!host) return;
        const d = St.data;
        if (St.error) { host.innerHTML = `<p class="pb-muted" style="text-align:center;padding:2rem 0">${esc(St.error)}</p>`; return; }
        if (!d) { host.innerHTML = '<p class="pb-muted" style="text-align:center;padding:2rem 0">Loading…</p>'; return; }
        if (!d.enabled) {
            host.innerHTML = `<div class="cp-card"><h3 class="cp-card-title">Probation routes are off</h3>
                <p class="pb-muted" style="margin-top:.35rem">Under Settings → Roster sweep, set <b>Routes to fly</b> on the first-flight deadline and new pilots get set routes to fly — at random, or chosen here.</p></div>`;
            return;
        }
        const pilots = d.pilots || [];
        const intro = `<p class="pb-muted" style="margin-bottom:.6rem">New pilots fly ${d.required} set route${d.required === 1 ? '' : 's'} within ${d.days} days of being given them. ${d.pick === 'staff' ? 'Your staff choose them here.' : 'They are drawn at random from your published routes — change any pilot’s here.'}</p>`;
        host.innerHTML = `<div class="cp-card">${intro}${pilots.length ? pilots.map(rowHtml).join('')
            : '<p class="pb-muted">Nobody on probation right now.</p>'}</div>`;
        icons();
    }

    async function send(memberId, body, btn) {
        if (St.busy) return;
        St.busy = true;
        if (btn) btn.disabled = true;
        try {
            const r = await St.api(`/probation/${encodeURIComponent(memberId)}`, { method: 'PUT', body });
            const list = (St.data && St.data.pilots) || [];
            const i = list.findIndex((p) => p.memberId === memberId);
            if (i >= 0) {
                if (body.clear && St.data.pick !== 'staff') list.splice(i, 1);
                else list[i] = { ...list[i], ...r.pilot };
            }
            St.editing = '';
            P.toast(body.clear ? 'Routes taken away.' : 'Routes given — their clock starts now.', 'ok');
        } catch (err) { P.toast(err.message || 'That didn’t save.', 'bad'); }
        finally { St.busy = false; drawStaff(); }
    }

    function wireStaff(host) {
        if (host.dataset.pbWired) return;
        host.dataset.pbWired = '1';
        host.addEventListener('click', (ev) => {
            const t = ev.target.closest('button');
            if (!t) return;
            const list = (St.data && St.data.pilots) || [];
            if (t.hasAttribute('data-pb-edit')) {
                const id = t.getAttribute('data-pb-edit');
                const p = list.find((x) => x.memberId === id);
                St.editing = id; St.q = '';
                St.picked = new Set(p && p.assigned ? p.routes.map((r) => r.id) : []);
                drawStaff();
                return;
            }
            if (t.hasAttribute('data-pb-cancel')) { St.editing = ''; drawStaff(); return; }
            if (t.hasAttribute('data-pb-random')) { send(t.getAttribute('data-pb-random'), { random: true }, t); return; }
            if (t.hasAttribute('data-pb-clear')) { send(t.getAttribute('data-pb-clear'), { clear: true }, t); return; }
            if (t.hasAttribute('data-pb-save')) {
                if (!St.picked.size) { P.toast('Tick at least one route.', 'bad'); return; }
                send(t.getAttribute('data-pb-save'), { routeIds: [...St.picked] }, t);
            }
        });
        host.addEventListener('change', (ev) => {
            const box = ev.target.closest('[data-pb-route]');
            if (!box) return;
            const id = box.getAttribute('data-pb-route');
            if (box.checked) St.picked.add(id); else St.picked.delete(id);
            const save = host.querySelector('[data-pb-save]');
            if (save) save.textContent = `Give ${St.picked.size || ''} route${St.picked.size === 1 ? '' : 's'}`;
        });
        host.addEventListener('input', (ev) => {
            if (!ev.target.matches('[data-pb-q]')) return;
            St.q = ev.target.value;
            const at = ev.target.selectionStart;
            drawStaff();
            const q = host.querySelector('[data-pb-q]');
            if (q) { q.focus(); try { q.setSelectionRange(at, at); } catch (_) {} }
        });
    }

    function mountStaff(host, { api } = {}) {
        if (!host || typeof api !== 'function') return;
        styles();
        St.api = api;
        St.host = host;
        wireStaff(host);
        drawStaff();
        return loadStaff();
    }

    window.CrewProbation = { mountCard, mountStaff, waitingCount: () => ((St.data && St.data.pilots) || []).filter((p) => !p.assigned).length };
})();
