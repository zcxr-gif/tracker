/* ============================================================================
   crewLiveFlight.js — the leg the pilot is on, on the page about their flying.

   WHY THIS EXISTS

   A pilot could be three hours into a sector flown under the airline's own
   callsign, with the crew centre open in the next tab, and nothing on the page
   knew. The live map behind the hero drew their aeroplane as one unlabelled dot
   among everybody else's; the logbook showed nothing until they landed and
   filed. The one moment a pilot is most engaged with their airline — the moment
   they are actually flying for it — was the one moment the crew centre had
   nothing to say to them.

   WHAT IT SHOWS, AND WHAT IT REFUSES TO

   The route, the aircraft, the callsign, the server, and how high and how fast.
   Not an ETA, not a percentage, not a progress bar: those need a destination
   the pilot may not have filed and a groundspeed that means nothing in a climb,
   and a crew centre that guesses "43 minutes to go" and is an hour out is worse
   than one that says where you are and leaves the arithmetic to the aeroplane.

   WHAT DECIDES "FLYING FOR THE VA"

   Not this file. The callsign rule lives in one place — the matcher that the
   live map, the takeoff/landing webhooks and the Discord feed all share — and
   the endpoint behind this asks that service. A pilot airborne under their own
   registration is not flying for the airline, and this draws nothing, which is
   the same answer the map gives.

   THE RULE IT FOLLOWS

   IT IS NOT THERE UNLESS IT IS TRUE. No skeleton, no "you are not flying"
   state, no empty frame. A pilot on the ground — which is nearly every pilot
   nearly always — sees the page they have always seen. The card appears when
   there is a flight and removes itself when there is not.

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewLiveFlight: crewPanels.js must load first'); return; }
    const { esc, icons } = P;

    const S = {
        api: null,
        host: null,
        data: null,
        timer: null,
        // How often the page asks. The upstream is a poll we do not control and
        // the endpoint caches for twenty seconds per airline, so anything under
        // that is asking for an answer that cannot have changed.
        everyMs: 45000,
    };

    function styles() {
        P.baseStyles();
        P.style('crew-live-flight', `
        /* A band rather than a tile, and the accent rather than the surface:
           this is the only thing on the page that is true right now, and it
           has to read as different in kind from the eight tiles under it
           without being a second hero. */
        .lf{ position:relative; overflow:hidden; border-radius:1rem;
            border:1px solid color-mix(in srgb, var(--accent) 35%, var(--line,#e5e5e5));
            background:linear-gradient(105deg,
                color-mix(in srgb, var(--accent) 12%, var(--surface,#fff)),
                var(--surface,#fff) 62%);
            padding:1rem 1.15rem; }
        .lf-head{ display:flex; align-items:center; gap:.5rem; flex-wrap:wrap; }
        /* The dot is the only moving thing on the card, and it is the one fact
           the card exists to carry: this is happening now. */
        .lf-live{ display:inline-flex; align-items:center; gap:.4rem;
            font-size:.6rem; font-weight:800; letter-spacing:.14em; text-transform:uppercase;
            color:var(--accent-on, var(--accent)); }
        .lf-dot{ width:.45rem; height:.45rem; border-radius:999px; background:currentColor;
            animation:lf-pulse 2s ease-in-out infinite; }
        @keyframes lf-pulse{ 0%,100%{opacity:1;} 50%{opacity:.25;} }
        .lf-cs{ font-size:.7rem; font-weight:700; letter-spacing:.06em;
            color:var(--muted,#736E64); }
        /* The route. The biggest thing on the card because it is the answer to
           "what am I doing" — and it degrades to the callsign alone for a pilot
           who filed no plan, rather than showing two dashes with an arrow. */
        .lf-route{ display:flex; align-items:center; gap:.6rem; margin-top:.5rem;
            font-size:1.5rem; font-weight:800; letter-spacing:-.03em; line-height:1.1; }
        .lf-route i{ width:1.1rem; height:1.1rem; color:var(--muted,#736E64); flex:none; }
        .lf-sub{ font-size:.8rem; color:var(--muted,#736E64); margin-top:.25rem; }
        .lf-nums{ display:flex; flex-wrap:wrap; gap:.4rem .6rem; margin-top:.8rem; }
        .lf-num{ display:inline-flex; align-items:baseline; gap:.3rem;
            border:1px solid var(--line,#e5e5e5); border-radius:.55rem;
            padding:.3rem .55rem; background:var(--surface,#fff); }
        .lf-num b{ font-size:.86rem; font-weight:800; font-variant-numeric:tabular-nums;
            letter-spacing:-.01em; }
        .lf-num span{ font-size:.62rem; font-weight:700; letter-spacing:.07em;
            text-transform:uppercase; color:var(--muted,#736E64); }
        .lf-foot{ font-size:.7rem; color:var(--faint,#A8A296); margin-top:.7rem; }
        @media (max-width:520px){ .lf-route{ font-size:1.25rem; } }
        @media (prefers-reduced-motion:reduce){ .lf-dot{ animation:none; } }
        `);
    }

    const num = (n) => Math.round(Number(n) || 0).toLocaleString();

    /**
     * Climbing, descending, or neither.
     *
     * ±200 fpm rather than zero, because a cruising aeroplane holding altitude
     * reports a few dozen feet a minute either way all the time, and a card
     * that flickers between "climbing" and "descending" at cruise is a card
     * that is wrong twice a second.
     */
    function vertical(fpm) {
        const v = Number(fpm) || 0;
        if (v > 200) return { word: 'Climbing', icon: 'trending-up' };
        if (v < -200) return { word: 'Descending', icon: 'trending-down' };
        return { word: 'Cruising', icon: 'minus' };
    }

    function cardHtml(f) {
        const hasRoute = !!(f.origin && f.destination);
        const v = vertical(f.verticalSpeed);
        const sub = [
            f.aircraftName || '',
            f.liveryName && f.liveryName !== f.aircraftName ? f.liveryName : '',
            f.server ? `${f.server} Server` : '',
        ].filter(Boolean).join(' · ');

        return `<div class="lf">
            <div class="lf-head">
                <span class="lf-live"><span class="lf-dot"></span>In the air now</span>
                ${f.callsign ? `<span class="lf-cs">${esc(f.callsign)}</span>` : ''}
            </div>
            <div class="lf-route">
                ${hasRoute
                    ? `<span>${esc(f.origin)}</span><i data-lucide="arrow-right"></i><span>${esc(f.destination)}</span>`
                    // No filed plan is not an error and not a gap: the callsign
                    // is what the pilot is flying as, and it is the true thing
                    // we have. Two dashes and an arrow would be neither.
                    : `<span>${esc(f.callsign || 'Airborne')}</span>`}
            </div>
            ${sub ? `<div class="lf-sub">${esc(sub)}</div>` : ''}
            <div class="lf-nums">
                <span class="lf-num"><b>${num(f.altitude)}</b><span>ft</span></span>
                <span class="lf-num"><b>${num(f.speed)}</b><span>kt</span></span>
                <span class="lf-num"><b>${num(f.heading)}°</b><span>hdg</span></span>
                <span class="lf-num"><b>${esc(v.word)}</b></span>
            </div>
            <div class="lf-foot">${hasRoute
                ? 'From the plan you filed. File your PIREP from your logbook when you are down — this leg is already in it.'
                : 'No flight plan filed, so there is no route to show. Everything else is live.'}</div>
        </div>`;
    }

    function paint() {
        const host = S.host;
        if (!host || !host.isConnected) return;
        const f = S.data && S.data.flying;
        // Not there unless it is true. See the rule at the top: a pilot on the
        // ground gets the page they have always had, with no empty frame in it.
        if (!f) { host.innerHTML = ''; host.classList.add('cp-hidden'); return; }
        host.classList.remove('cp-hidden');
        host.innerHTML = cardHtml(f);
        try { icons(); } catch (_) {}
    }

    async function read() {
        if (typeof S.api !== 'function') return;
        // A hidden tab is a tab whose pilot is flying rather than reading. The
        // poll stops and catches up when they come back, which is also the
        // moment the answer matters again.
        if (document.visibilityState === 'hidden') return;
        try {
            S.data = await S.api('/me/live');
        } catch (err) {
            // Silent, and deliberately. This card is an extra: a backend that
            // has not deployed it yet (404), a store that blipped, or an
            // upstream that did not answer are all reasons to show nothing,
            // and none of them is worth an error where a pilot's flight would
            // be. Whatever was on screen stays until the next read.
            if (!S.data) S.data = { linked: true, flying: null };
        }
        paint();
    }

    function stop() {
        if (S.timer) { clearInterval(S.timer); S.timer = null; }
    }

    /**
     * Mount the card and keep it current.
     *
     * Same contract as CrewBadges.mountRail and CrewShop.mountCard: hidden
     * until there is something true to say, and silent when there is not.
     */
    function mount(host, { api, everyMs } = {}) {
        if (!host || typeof api !== 'function') return;
        styles();
        S.api = api;
        S.host = host;
        if (Number(everyMs) > 0) S.everyMs = Math.max(20000, Number(everyMs));
        host.classList.add('cp-hidden');
        read();
        stop();
        S.timer = setInterval(read, S.everyMs);
        if (!mount._wired) {
            mount._wired = true;
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') read();
            });
        }
    }

    /** Ask again now — after filing a PIREP, or on a manual refresh. */
    const refresh = () => read();

    window.CrewLiveFlight = { mount, refresh, stop };
})();
