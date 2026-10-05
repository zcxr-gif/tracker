/* ============================================================================
   crewFlownAs.js — "what was this flight flown as?" on a PIREP.

   A flight report can say WHY it was flown, and that is what pays it:

     · an ordinary flight
     · one of the Route of the Week legs
     · the Route of the Day
     · an event — any event on the airline's calendar

   The same little control is used wherever a pilot files: picking a flight out
   of their Infinite Flight logbook (crewFlightPicker.js) and filing by hand
   (the pilot page). Picked flights only offer the featured legs that match the
   airports they actually flew, and preselect one when it does; by hand, picking
   a leg fills the airports and the aircraft in.

   The server checks every claim against what was featured when the flight was
   flown, so nothing here is a gate — it is the menu.

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewFlownAs: crewPanels.js must load first'); return; }
    const { esc } = P;

    const TTL_MS = 2 * 60 * 1000;
    let cache = null;
    let cachedAt = 0;
    let inFlight = null;

    const icao = (v) => String(v || '').trim().toUpperCase();

    /** What can be claimed right now: the featured legs and the events. */
    function load(api, { fresh = false } = {}) {
        if (!fresh && cache && Date.now() - cachedAt < TTL_MS) return Promise.resolve(cache);
        if (inFlight) return inFlight;
        inFlight = Promise.all([
            api('/featured-routes').catch(() => null),
            api('/events').catch(() => null),
        ]).then(([f, e]) => {
            const legs = (set) => ((set && set.legs) || []).map((l) => ({ ...l.route, bonus: l.bonus, estimatedMin: l.estimatedMin }));
            cache = {
                week: legs(f && f.week),
                day: legs(f && f.day),
                currency: (f && f.currency) || null,
                events: ((e && e.events) || [])
                    .filter((ev) => ev && ev.id && ev.status !== 'draft' && ev.status !== 'cancelled')
                    .sort((a, b) => new Date(b.startsAt || 0) - new Date(a.startsAt || 0)),
            };
            cachedAt = Date.now();
            inFlight = null;
            return cache;
        }).catch(() => { inFlight = null; return { week: [], day: [], events: [], currency: null }; });
        return inFlight;
    }

    const legLabel = (l, opts) => [
        `${l.origin} → ${l.destination}`, l.flightNumber, l.aircraft,
        l.kind === 'codeshare' && l.partnerName ? `Codeshare · ${l.partnerName}` : '',
        opts.currency && l.bonus > 1 ? `${Number(l.bonus)}× pay` : '',
    ].filter(Boolean).join(' · ');

    function eventLabel(ev) {
        const d = ev.startsAt ? new Date(ev.startsAt) : null;
        const when = d && !Number.isNaN(d.getTime())
            ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
        return [ev.title || 'Event', when, ev.origin && ev.destination ? `${ev.origin} → ${ev.destination}` : ''].filter(Boolean).join(' · ');
    }

    /**
     * The control. `flight` is { origin, destination } when the flight is
     * already known (picked from the logbook): only the featured legs that
     * match it are offered, and the first match is preselected.
     */
    function html(opts, { flight = null, eventId = '', chosen = null } = {}) {
        const o = opts || { week: [], day: [], events: [] };
        const fits = (l) => !flight || (icao(l.origin) === icao(flight.origin) && icao(l.destination) === icao(flight.destination));
        const week = o.week.filter(fits);
        const day = o.day.filter(fits);
        const events = o.events || [];
        // Preselect what is plainly true: a picked flight that IS a featured
        // leg was flown as one, as far as anybody can tell from here.
        // `chosen` is what the pilot already picked, carried across a redraw.
        const c = chosen || {};
        const kind = c.featured || (c.eventId ? 'event' : '')
            || (eventId ? 'event' : flight ? (day.length ? 'day' : week.length ? 'week' : '') : '');
        const picked = c.routeId || c.eventId || eventId || '';
        const sel = (k) => (k === kind ? 'selected' : '');
        const options = [
            '<option value="">A regular flight</option>',
            week.length ? `<option value="week" ${sel('week')}>Route of the Week</option>` : '',
            day.length ? `<option value="day" ${sel('day')}>Route of the Day</option>` : '',
            events.length ? `<option value="event" ${sel('event')}>An event</option>` : '',
        ].join('');
        const pick = (k, list, label) => `<select class="cp-select" data-fa-pick="${k}" ${k === kind ? '' : 'hidden'} aria-label="${esc(label)}">
            ${list.map((x) => `<option value="${esc(x.id)}" ${String(x.id) === String(picked) ? 'selected' : ''}>${esc(k === 'event' ? eventLabel(x) : legLabel(x, o))}</option>`).join('')}
        </select>`;
        const hint = flight && !week.length && !day.length
            ? '<p class="cp-note" style="margin:0">This flight isn’t one of this week’s or today’s featured routes.</p>' : '';
        return `<div class="cp-label" data-fa style="display:grid;gap:.4rem">
            <span>Flown as</span>
            <select class="cp-select" data-fa-kind>${options}</select>
            ${week.length ? pick('week', week, 'Which Route of the Week leg') : ''}
            ${day.length ? pick('day', day, 'The Route of the Day') : ''}
            ${events.length ? pick('event', events, 'Which event') : ''}
            ${hint}
        </div>`;
    }

    /** What the control says, as the body fields POST /pireps reads. */
    function read(root) {
        const box = root && root.querySelector('[data-fa]');
        if (!box) return {};
        const kind = (box.querySelector('[data-fa-kind]') || {}).value || '';
        const pick = box.querySelector(`[data-fa-pick="${kind}"]`);
        const id = pick ? pick.value : '';
        if (!kind) return { regular: true };
        if (kind === 'week' || kind === 'day') return id ? { featured: kind, routeId: id } : {};
        if (kind === 'event') return id ? { eventId: id } : {};
        return {};
    }

    /**
     * Show the right second menu as the first changes, and tell the host
     * which leg was picked so a by-hand form can fill its airports in.
     */
    function wire(root, { onLeg } = {}) {
        const box = root && root.querySelector('[data-fa]');
        if (!box || box.dataset.faWired) return;
        box.dataset.faWired = '1';
        const sync = () => {
            const kind = (box.querySelector('[data-fa-kind]') || {}).value || '';
            box.querySelectorAll('[data-fa-pick]').forEach((s) => { s.hidden = s.getAttribute('data-fa-pick') !== kind; });
            if (typeof onLeg === 'function' && (kind === 'week' || kind === 'day') && cache) {
                const pick = box.querySelector(`[data-fa-pick="${kind}"]`);
                const leg = (cache[kind] || []).find((l) => String(l.id) === String(pick && pick.value));
                if (leg) onLeg(leg, kind);
            }
        };
        box.addEventListener('change', sync);
    }

    window.CrewFlownAs = { load, html, read, wire };
})();
