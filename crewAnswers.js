/* ============================================================================
   crewAnswers.js — what somebody actually answered, for staff.

   A result card used to stop at "6/10 · 60% against 80%". The person deciding
   whether to accept an applicant — or whether a pilot is ready for the type
   rating — needs the next sentence: WHICH four they got wrong, and what they
   picked instead. That is true for a pilot's quiz and for an entrance test sat
   by somebody with no account, and both are rows in the same table, so one
   helper serves the quiz admin (crewQuizAdmin.js) and the entrance tests
   (crewEntrance.js).

       CrewAnswers.toggle(button, { api, id })

   opens the breakdown under the card the button sits in, and closes it on the
   second press. `api` is a CrewPanels.api caller; `id` the attempt.

   Staff only: GET /quiz-attempts/:id/answers is gated server-side. This is the
   answer key and no taker-facing page loads this file.

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewAnswers: crewPanels.js must load first'); return; }
    const { esc, icons } = P;

    function rowHtml(r) {
        if (r.gone) {
            return `<li class="ca-q ${r.right ? 'ca-right' : 'ca-wrong'}">
                <div class="ca-qhead"><span class="ca-n">${r.n}</span>
                    <span class="ca-text ca-gone">A question that has since been removed from this quiz</span>
                    <span class="ca-mark">${r.right ? 'right' : 'wrong'}</span></div>
            </li>`;
        }
        const opts = (r.options || []).map((o, i) => {
            const cls = i === r.correct ? 'ca-opt-correct' : (i === r.chosen ? 'ca-opt-chosen' : '');
            const tag = i === r.correct && i === r.chosen ? 'their answer · right'
                : i === r.correct ? 'right answer'
                : i === r.chosen ? 'their answer' : '';
            return `<li class="ca-opt ${cls}"><span>${esc(o)}</span>${tag ? `<span class="ca-tag">${tag}</span>` : ''}</li>`;
        }).join('');
        return `<li class="ca-q ${r.right ? 'ca-right' : 'ca-wrong'}">
            <div class="ca-qhead"><span class="ca-n">${r.n}</span>
                <span class="ca-text">${esc(r.question)}</span>
                <span class="ca-mark"><i data-lucide="${r.right ? 'check' : 'x'}"></i></span></div>
            ${r.chosen < 0 ? '<div class="ca-skip">Left unanswered.</div>' : ''}
            <ul class="ca-opts">${opts}</ul>
        </li>`;
    }

    function listHtml(d) {
        const rows = Array.isArray(d.answers) ? d.answers : [];
        if (!rows.length) {
            return '<div class="ca-empty">Nothing handed in yet — the answers appear here once they submit.</div>';
        }
        const wrong = rows.filter((r) => !r.right).length;
        const head = wrong
            ? `${wrong} of ${rows.length} wrong${d.quizGone ? ' · this quiz has since been deleted' : ''}`
            : `All ${rows.length} right`;
        return `<div class="ca-head">${esc(head)}</div>
            <div class="ca-filter"><label><input type="checkbox" data-ca-wrong> Only the ones they got wrong</label></div>
            <ol class="ca-list">${rows.map(rowHtml).join('')}</ol>`;
    }

    async function toggle(btn, { api, id }) {
        const card = btn.closest('.qa-card, .et-row, .et-box, .cp-card') || btn.parentElement;
        const open = card.querySelector(':scope > .ca-wrap');
        if (open) { open.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
        const wrap = document.createElement('div');
        wrap.className = 'ca-wrap';
        wrap.innerHTML = '<div class="ca-empty">Loading their answers…</div>';
        card.appendChild(wrap);
        btn.setAttribute('aria-expanded', 'true');
        try {
            const d = await api(`/quiz-attempts/${encodeURIComponent(id)}/answers`);
            if (!wrap.isConnected) return;
            wrap.innerHTML = listHtml(d);
            const only = wrap.querySelector('[data-ca-wrong]');
            if (only) only.addEventListener('change', () => wrap.classList.toggle('ca-only-wrong', only.checked));
            icons();
        } catch (err) {
            wrap.innerHTML = `<div class="ca-empty">${esc(err.status === 404 && !err.code
                ? 'Reading answers isn’t available on this server yet.'
                : (err.message || 'Couldn’t load their answers.'))}</div>`;
        }
    }

    P.style('ca-styles', `
        .ca-wrap{ margin-top:.6rem; padding-top:.6rem; border-top:1px solid var(--line-soft,#F0ECE4); display:grid; gap:.5rem; }
        .ca-head{ font-size:.8rem; font-weight:600; color:var(--ink,#1C1A16); }
        .ca-filter{ font-size:.75rem; color:var(--muted,#736E64); }
        .ca-filter input{ accent-color:var(--accent,#1C1A16); vertical-align:-2px; margin-right:.3rem; }
        .ca-only-wrong .ca-right{ display:none; }
        .ca-list{ list-style:none; margin:0; padding:0; display:grid; gap:.5rem; }
        .ca-q{ border:1px solid var(--line-soft,#F0ECE4); border-radius:.6rem; padding:.55rem .65rem; }
        .ca-wrong{ border-color:color-mix(in srgb, #dc2626 35%, transparent); }
        .ca-qhead{ display:flex; gap:.5rem; align-items:flex-start; font-size:.82rem; }
        .ca-n{ font-size:.7rem; font-weight:700; color:var(--faint,#A8A296); min-width:1.1rem; padding-top:.1rem; }
        .ca-text{ flex:1; color:var(--ink,#1C1A16); font-weight:600; }
        .ca-gone{ font-weight:400; font-style:italic; color:var(--muted,#736E64); }
        .ca-mark{ flex-shrink:0; font-size:.72rem; font-weight:700; }
        .ca-mark i{ width:1rem; height:1rem; }
        .ca-right .ca-mark{ color:#16a34a; }
        .ca-wrong .ca-mark{ color:#dc2626; }
        .ca-skip{ font-size:.75rem; color:#d97706; margin:.3rem 0 0 1.6rem; }
        .ca-opts{ list-style:none; margin:.35rem 0 0 1.6rem; padding:0; display:grid; gap:.2rem; }
        .ca-opt{ display:flex; justify-content:space-between; gap:.6rem; font-size:.78rem; color:var(--muted,#736E64);
            padding:.2rem .45rem; border-radius:.4rem; }
        .ca-opt-correct{ background:color-mix(in srgb, #16a34a 12%, transparent); color:var(--ink,#1C1A16); }
        .ca-opt-chosen{ background:color-mix(in srgb, #dc2626 12%, transparent); color:var(--ink,#1C1A16); }
        .ca-tag{ font-size:.68rem; font-weight:700; white-space:nowrap; opacity:.8; }
        .ca-empty{ font-size:.8rem; color:var(--muted,#736E64); }
        @media (max-width:40rem){ .ca-opts{ margin-left:0; } .ca-opt{ flex-direction:column; gap:0; } }
    `);

    window.CrewAnswers = { toggle };
})();
