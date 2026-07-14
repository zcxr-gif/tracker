/**
 * changelog.js — "What's New" release notes for the live tracker.
 *
 * Two surfaces, one data source (RELEASES below):
 *   1. A one-time popup after the loading screen — shown once per release
 *      (localStorage 'inflight_changelog_seen' remembers the last version
 *      the user has been shown).
 *   2. A browsable changelog inside Settings — the desktop Global Settings
 *      modal hosts renderSettingsPanel(); the mobile Settings sheet's More
 *      tab opens the full modal via open().
 *
 * To ship notes for a new update: prepend a release object to RELEASES.
 * The popup re-arms automatically because the stored "seen" id no longer
 * matches the newest release id.
 *
 * Exposed as window.InflightChangelog. Loaded as a plain (non-module)
 * script alongside vaAds.js.
 */
(function () {
    'use strict';

    const SEEN_KEY = 'inflight_changelog_seen';

    // Newest release FIRST. tag: 'new' | 'improved' | 'fixed'.
    const RELEASES = [
        {
            id: '2026.07.6',
            date: 'July 2026',
            title: 'Every VA Has a Calendar',
            tagline: 'Partner pages now carry the VA’s events calendar and pilot roster — with animated event banners.',
            entries: [
                { tag: 'new', icon: 'fa-calendar-days', text: 'Events calendar on every partner page — a month view that marks the days a VA has something planned; tap a day to see just its events, or browse the full upcoming list underneath.' },
                { tag: 'new', icon: 'fa-image', text: 'Events can carry their own banner artwork — including animated ones, which play right in the list.' },
                { tag: 'new', icon: 'fa-users', text: 'Pilot roster — each partner page now shows the VA’s registered pilots and a running count, with a quick search to find anyone on the roster.' },
                { tag: 'new', icon: 'fa-plane-departure', text: 'Event cards show the departure airport at a glance when the VA sets one.' },
                { tag: 'new', icon: 'fa-satellite-dish', text: 'See when an event is on — a live “Happening now” badge marks events under way, and every other one shows a countdown (in 20m, in 3h, in 2d) so you know how long you’ve got.' },
                { tag: 'new', icon: 'fa-bolt', text: 'A “Next up” card sits above each calendar with the soonest event and its countdown — tap it to jump straight to that day on the calendar.' }
            ]
        },
        {
            id: '2026.07.5',
            date: 'July 2026',
            title: 'Legacy, Reborn',
            tagline: 'The Legacy flight window below the navigation display is redesigned — the Card window’s calm look, big journey numbers and live flight stats.',
            entries: [
                { tag: 'improved', icon: 'fa-layer-group', text: 'Everything under the ND now wears the Card window’s calm, monochrome look — clear headings over quiet surfaces, plain-language labels, and colour saved for the data that means something.' },
                { tag: 'new', icon: 'fa-stopwatch', text: 'New This Flight card — big flown / remaining readouts around a live progress line, with time airborne, average and max ground speed, and max altitude straight from the flight’s history.' },
                { tag: 'improved', icon: 'fa-chart-area', text: 'The Speed & Altitude graph moved into the lineup under the ND, matching the Simple and Card windows.' },
                { tag: 'improved', icon: 'fa-location-crosshairs', text: 'Navigation is grouped into Position and Atmosphere & Plan, and the waypoint / nearest-airport readouts read as simple detail rows.' }
            ]
        },
        {
            id: '2026.07.4',
            date: 'July 2026',
            title: 'Know Where You’re Landing',
            tagline: 'Every flight window now carries a destination dropdown, and airports show their real photos.',
            entries: [
                { tag: 'new', icon: 'fa-plane-arrival', text: 'Destination dropdown — every flight window (Legacy, Simple and Card, desktop and mobile) now has a tap-to-open panel about the airport you’re flying to: its photo, location, elevation, runways and live METAR, plus a one-tap jump to the full airport window.' },
                { tag: 'new', icon: 'fa-sun', text: 'The destination panel shows whether it’s day, sunset, twilight or night at the field right now — know what light you’ll be landing in.' },
                { tag: 'new', icon: 'fa-sliders', text: 'The Simple window’s layout studio gained a Destination section — drag it anywhere in your layout or hide it entirely, like every other block.' },
                { tag: 'improved', icon: 'fa-image', text: 'Airport Cards now lead with the airport’s own photo when we have one — the top-down aerial view steps in only when there’s no photo (or it fails to load).' },
                { tag: 'improved', icon: 'fa-wand-magic-sparkles', text: 'First launch now shows all three window styles — Legacy, Simple and Card — as live examples, so you pick from the full lineup from day one.' }
            ]
        },
        {
            id: '2026.07.3',
            date: 'July 2026',
            title: 'The Card Window',
            tagline: 'A third window style for flights and airports — a clean place-card look with partner VAs on board.',
            entries: [
                { tag: 'new', icon: 'fa-id-card', text: 'New “Card” window style — pick it under Settings → Info Windows, for both flights and airports, alongside Legacy and Simple.' },
                { tag: 'new', icon: 'fa-mobile-screen-button', text: 'The flight Card opens like a place card — full-width photo hero, the airline’s logo tile, big centred callsign, and one-tap Follow / Replay / Share buttons with the live ETE.' },
                { tag: 'new', icon: 'fa-images', text: 'Photo rail — every community shot of the airframe in a swipeable gallery, each with its photographer credit.' },
                { tag: 'new', icon: 'fa-handshake-angle', text: 'Partner VAs now advertise inside the flight Card — the flight’s own VA (or VAs hubbed at its airports) with full banner artwork and a one-tap Apply Now.' },
                { tag: 'new', icon: 'fa-compress', text: 'Collapsed on mobile, the Card is a glanceable peek bar — route with live progress, departed / lands-in times, altitude, speed, type and registration.' },
                { tag: 'new', icon: 'fa-wind', text: 'The airport Card reads the field for you — wind-aware runway list with the preferred end highlighted, live ATC on frequency and a day / night chip.' },
                { tag: 'improved', icon: 'fa-palette', text: 'The Card wears soft whites and grays — colour is saved for what it means: flight phase, climb / descend, takeoff / landing.' }
            ]
        },
        {
            id: '2026.07.2',
            date: 'July 2026',
            title: 'Airport Map Detail & Runway Winds',
            tagline: 'Runway numbers and gate stands now show on the map’s airport layout, and the airport window reads the wind for you.',
            entries: [
                { tag: 'new', icon: 'fa-road', text: 'Runway numbers on the map — the airport layout now paints 09/27-style designators, aligned with each runway end just like the real markings.' },
                { tag: 'new', icon: 'fa-square-parking', text: 'Gates & parking stands — the airport layout now shows gate/stand pins with their identifiers (e.g. A12) when you zoom in.' },
                { tag: 'new', icon: 'fa-wind', text: 'Wind-aware runways — each runway now shows its head / cross-wind from the live METAR, with the favoured landing direction highlighted and the best runway tagged PREFERRED.' },
                { tag: 'new', icon: 'fa-clock', text: 'Airport details now show the field’s current local time.' },
                { tag: 'new', icon: 'fa-sun', text: 'Daylight at a glance — a Day / Sunset / Twilight / Night indicator computed from the airport’s position.' },
                { tag: 'new', icon: 'fa-palette', text: 'Embed: the map flight-card is now fully customizable — set its transparency (see-through / frosted) and text colour to match your site.' },
                { tag: 'new', icon: 'fa-tags', text: 'Embed: callsign matching now accepts a second optional tag at the end (e.g. “Air Canada 001VA CX”), plus a list of regular untagged callsigns to always include.' },
                { tag: 'new', icon: 'fa-image', text: 'Airport windows now show a real aerial photo of the field — every airport gets an image, not a placeholder.' },
                { tag: 'new', icon: 'fa-diagram-project', text: 'Embed map: opening an airport now draws its runways & taxiways (with gate stands) right on the map.' },
                { tag: 'new', icon: 'fa-plane-departure', text: 'Embed map: tapping a flight drops takeoff & landing pins on its airports — tap either (or the new card buttons) to open that airport.' },
                { tag: 'new', icon: 'fa-warehouse', text: 'Airport windows now list gates by terminal (as dropdowns), showing who’s parked at each stand — everyone on the main tracker, your VA members in the embed.' },
                { tag: 'new', icon: 'fa-warehouse', text: 'Embed flight card now shows the gate the pilot departed from.' }
            ]
        },
        {
            id: '2026.07.1',
            date: 'July 2026',
            title: 'Sharing, Trip Card & Live Fleets',
            tagline: 'Flight links that never die, a trip card rebuilt as a cockpit HUD, and every partner VA\u2019s fleet live on its page.',
            entries: [
                { tag: 'new', icon: 'fa-share-nodes', text: 'Share Flight rebuilt — links now carry the flight with them and open instantly for the recipient. Links from the mobile apps finally work too.' },
                { tag: 'new', icon: 'fa-clock-rotate-left', text: 'Shared flight already landed? The link drops straight into the full map replay instead of a dead spinner.' },
                { tag: 'new', icon: 'fa-image', text: 'Sharing inflight.info in Discord, WhatsApp or iMessage now unfurls with a branded banner and description.' },
                { tag: 'improved', icon: 'fa-gauge-high', text: 'Trip card completely rehauled — a spread-out glass HUD in the replay panel\u2019s style: live phase of flight, ETA and Zulu time, V/S, heading, airport names and a one-tap Replay handoff.' },
                { tag: 'new', icon: 'fa-plane', text: 'Partner pages show the VA\u2019s Live Fleet — aircraft photo cards for every member in the air. Tap one to jump to that flight on the map.' },
                { tag: 'improved', icon: 'fa-user-check', text: 'Fleet lists and live counts only include callsigns carrying the VA\u2019s membership tag — no more strangers in the roster.' },
                { tag: 'fixed', icon: 'fa-wand-magic-sparkles', text: 'First launch is smooth now — Terms, the window picker and What\u2019s New take turns instead of piling on top of each other.' },
                { tag: 'fixed', icon: 'fa-link', text: 'Opening a shared flight on your very first visit no longer stalls behind the intro.' }
            ]
        },
        {
            id: '2026.07',
            date: 'July 2026',
            title: 'Airports, ATC & Partners',
            tagline: 'The airport window grows a weather station, ATC gets a real traffic board, and partner VAs are one tap from your cockpit.',
            entries: [
                { tag: 'new', icon: 'fa-cloud-sun-rain', text: 'Airport weather station — live wind compass, visibility, ceiling and full METAR instruments in the airport window.' },
                { tag: 'new', icon: 'fa-tower-broadcast', text: 'Live ATIS card — the complete broadcast with the current info letter and arrival / departure runways.' },
                { tag: 'new', icon: 'fa-plane-arrival', text: 'Smarter Traffic tab — arrivals bucketed by ETA (5 / 10 / 15 / 30 / 60 min), pilot-status stats and one-tap filter chips.' },
                { tag: 'new', icon: 'fa-map-pin', text: 'Pin airports to the map — a pinned field keeps its ICAO on screen as a glass label. Pin from the airport window or the ATC board.' },
                { tag: 'new', icon: 'fa-headset', text: 'Full Live ATC board — every airport with traffic (not just staffed ones), search, active ATC on top and IFATC picks for busy unstaffed fields.' },
                { tag: 'new', icon: 'fa-images', text: 'Aircraft photos now auto-cycle with a soft crossfade — toggle it under Settings → More.' },
                { tag: 'improved', icon: 'fa-handshake-angle', text: 'VA Partners — redesigned directory and yellow Apply Now buttons that jump straight to the VA’s website.' },
                { tag: 'improved', icon: 'fa-tag', text: 'ATC map tags got a glass facelift and stay one crisp size at every zoom level.' },
                { tag: 'improved', icon: 'fa-route', text: 'Flight paths render sharper when zoomed out, build up live with the aircraft and never cover the plane icon.' },
                { tag: 'fixed', icon: 'fa-filter', text: 'Filters no longer come back after being reset.' },
                { tag: 'fixed', icon: 'fa-rotate', text: 'The dashboard reliably appears right after loading — no more blank screen until you open a flight.' }
            ]
        }
    ];

    const LATEST = RELEASES[0];

    const TAG_META = {
        new:      { label: 'NEW',      cls: 'cl-tag-new' },
        improved: { label: 'IMPROVED', cls: 'cl-tag-improved' },
        fixed:    { label: 'FIXED',    cls: 'cl-tag-fixed' }
    };

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getSeen() {
        try { return localStorage.getItem(SEEN_KEY); } catch (_) { return null; }
    }

    function markSeen() {
        try { localStorage.setItem(SEEN_KEY, LATEST.id); } catch (_) { /* private mode */ }
    }

    // ---------------------------------------------------------------------
    // Styles
    // ---------------------------------------------------------------------

    function injectStyles() {
        if (document.getElementById('inflight-changelog-styles')) return;
        const style = document.createElement('style');
        style.id = 'inflight-changelog-styles';
        style.textContent = `
            .cl-overlay {
                /* Above the desktop Global Settings modal (99999) and the
                   mobile settings sheet (6001) so "What's New" opens on top. */
                position: fixed; inset: 0; z-index: 100000;
                display: flex; align-items: center; justify-content: center;
                background: rgba(8, 10, 16, 0.66); backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                opacity: 0; pointer-events: none; transition: opacity .22s ease;
                padding: 18px; box-sizing: border-box;
            }
            .cl-overlay.visible { opacity: 1; pointer-events: auto; }
            .cl-card {
                width: min(500px, 100%); max-height: min(82dvh, 720px);
                display: flex; flex-direction: column; overflow: hidden;
                background: #121214; border: 1px solid rgba(255,255,255,0.1);
                border-radius: 18px; box-shadow: 0 24px 70px rgba(0,0,0,0.6);
                transform: translateY(14px) scale(0.98);
                transition: transform .28s cubic-bezier(0.16,1,0.3,1);
            }
            .cl-overlay.visible .cl-card { transform: translateY(0) scale(1); }
            .cl-head {
                position: relative; flex: 0 0 auto; padding: 20px 20px 14px;
                background:
                    radial-gradient(circle at 85% -20%, rgba(56,189,248,0.22), transparent 60%),
                    radial-gradient(circle at 0% 120%, rgba(168,85,247,0.12), transparent 55%);
                border-bottom: 1px solid rgba(255,255,255,0.07);
            }
            .cl-eyebrow {
                display: inline-flex; align-items: center; gap: 7px;
                font-size: 0.62rem; font-weight: 800; letter-spacing: .1em;
                text-transform: uppercase; color: #7dd3fc; margin-bottom: 7px;
            }
            .cl-head h2 {
                margin: 0; color: #fff; font-size: 1.35rem; font-weight: 800;
                letter-spacing: -0.4px; line-height: 1.15; padding-right: 34px;
            }
            .cl-meta { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
            .cl-ver-pill {
                font-size: 0.62rem; font-weight: 800; letter-spacing: .05em;
                color: #0b1120; background: #38bdf8; border-radius: 999px; padding: 3px 9px;
            }
            .cl-date { font-size: 0.72rem; font-weight: 600; color: rgba(255,255,255,0.45); }
            .cl-tagline { margin: 10px 0 0; font-size: 0.8rem; line-height: 1.5; color: #a1a1aa; }
            .cl-close {
                position: absolute; top: 14px; right: 14px;
                width: 32px; height: 32px; border-radius: 50%; border: none; cursor: pointer;
                background: rgba(255,255,255,0.07); color: #fff; font-size: 0.9rem;
                display: grid; place-items: center;
            }
            .cl-close:hover { background: rgba(255,255,255,0.14); }
            .cl-body {
                flex: 1 1 auto; min-height: 0; overflow-y: auto;
                -webkit-overflow-scrolling: touch; overscroll-behavior: contain;
                padding: 14px 20px;
            }
            .cl-release + .cl-release { margin-top: 20px; padding-top: 18px; border-top: 1px solid rgba(255,255,255,0.07); }
            .cl-release-head { display: flex; align-items: baseline; gap: 9px; margin-bottom: 4px; }
            .cl-release-head h3 { margin: 0; color: #fff; font-size: 0.98rem; font-weight: 800; letter-spacing: -0.2px; }
            .cl-release-tagline { margin: 0 0 12px; font-size: 0.76rem; line-height: 1.5; color: #71717a; }
            .cl-list { display: flex; flex-direction: column; gap: 9px; }
            .cl-item {
                display: flex; gap: 11px; align-items: flex-start;
                background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
                border-radius: 12px; padding: 10px 12px;
            }
            .cl-item-icon {
                flex: 0 0 auto; width: 30px; height: 30px; border-radius: 9px;
                display: grid; place-items: center; font-size: 0.8rem;
                background: rgba(56,189,248,0.12); color: #7dd3fc;
            }
            .cl-item-main { min-width: 0; flex: 1; }
            .cl-tag {
                display: inline-block; font-size: 0.56rem; font-weight: 800;
                letter-spacing: .07em; border-radius: 999px; padding: 2px 7px; margin-bottom: 4px;
            }
            .cl-tag-new      { background: rgba(74,222,128,0.14); color: #4ade80; border: 1px solid rgba(74,222,128,0.3); }
            .cl-tag-improved { background: rgba(56,189,248,0.14); color: #7dd3fc; border: 1px solid rgba(56,189,248,0.3); }
            .cl-tag-fixed    { background: rgba(251,191,36,0.14); color: #fbbf24; border: 1px solid rgba(251,191,36,0.3); }
            .cl-item-text { font-size: 0.78rem; line-height: 1.5; color: #d4d4d8; }
            .cl-foot {
                flex: 0 0 auto; padding: 14px 20px;
                padding-bottom: max(env(safe-area-inset-bottom, 0px), 14px);
                border-top: 1px solid rgba(255,255,255,0.07);
            }
            .cl-cta {
                width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
                padding: 12px 16px; border: none; border-radius: 12px; cursor: pointer;
                background: linear-gradient(135deg, #38bdf8, #0ea5e9); color: #0b1120;
                font-size: 0.88rem; font-weight: 800; font-family: inherit; letter-spacing: 0.2px;
                box-shadow: 0 6px 20px rgba(56,189,248,0.3);
                transition: transform .12s ease, box-shadow .15s ease;
            }
            .cl-cta:hover { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(56,189,248,0.4); }

            /* Inline flavor for the desktop Settings pane (no card chrome —
               the config pane already provides the surface + scrolling). */
            .cl-inline .cl-release-head h3 { font-size: 1.02rem; }
        `;
        document.head.appendChild(style);
    }

    // ---------------------------------------------------------------------
    // Markup builders
    // ---------------------------------------------------------------------

    function entryHTML(e) {
        const meta = TAG_META[e.tag] || TAG_META.new;
        return `
            <div class="cl-item">
                <div class="cl-item-icon"><i class="fa-solid ${esc(e.icon || 'fa-sparkles')}"></i></div>
                <div class="cl-item-main">
                    <span class="cl-tag ${meta.cls}">${meta.label}</span>
                    <div class="cl-item-text">${esc(e.text)}</div>
                </div>
            </div>`;
    }

    function releaseHTML(rel, { withHead } = { withHead: true }) {
        return `
            <div class="cl-release">
                ${withHead ? `
                    <div class="cl-release-head">
                        <h3>${esc(rel.title)}</h3>
                        <span class="cl-date">${esc(rel.date)} · v${esc(rel.id)}</span>
                    </div>
                    ${rel.tagline ? `<p class="cl-release-tagline">${esc(rel.tagline)}</p>` : ''}
                ` : ''}
                <div class="cl-list">${rel.entries.map(entryHTML).join('')}</div>
            </div>`;
    }

    /**
     * Inline changelog for the desktop Settings modal's "What's New" tab.
     * Pure markup — no handlers needed.
     */
    function renderSettingsPanel() {
        injectStyles();
        return `<div class="cl-inline">${RELEASES.map(r => releaseHTML(r)).join('')}</div>`;
    }

    // ---------------------------------------------------------------------
    // Modal (popup + full changelog share one shell)
    // ---------------------------------------------------------------------

    let overlayEl = null;

    function closeModal() {
        if (!overlayEl) return;
        overlayEl.classList.remove('visible');
        const el = overlayEl;
        overlayEl = null;
        setTimeout(() => { try { el.remove(); } catch (_) {} }, 260);
    }

    function showModal({ popup } = { popup: false }) {
        injectStyles();
        if (overlayEl) closeModal();

        const body = popup
            ? releaseHTML(LATEST, { withHead: false })
            : RELEASES.map(r => releaseHTML(r)).join('');

        overlayEl = document.createElement('div');
        overlayEl.className = 'cl-overlay';
        overlayEl.innerHTML = `
            <div class="cl-card" role="dialog" aria-modal="true" aria-label="What's new">
                <div class="cl-head">
                    <span class="cl-eyebrow"><i class="fa-solid fa-wand-magic-sparkles"></i> ${popup ? 'Just updated' : 'Changelog'}</span>
                    <h2>${popup ? esc(LATEST.title) : "What's New"}</h2>
                    <div class="cl-meta">
                        <span class="cl-ver-pill">v${esc(LATEST.id)}</span>
                        <span class="cl-date">${esc(LATEST.date)}</span>
                    </div>
                    ${popup && LATEST.tagline ? `<p class="cl-tagline">${esc(LATEST.tagline)}</p>` : ''}
                    <button class="cl-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="cl-body custom-scroll">${body}</div>
                <div class="cl-foot">
                    <button class="cl-cta">${popup ? '<i class="fa-solid fa-plane-departure"></i> Let’s fly' : 'Done'}</button>
                </div>
            </div>`;

        overlayEl.addEventListener('click', (e) => {
            if (e.target === overlayEl || e.target.closest('.cl-close') || e.target.closest('.cl-cta')) closeModal();
        });
        document.body.appendChild(overlayEl);
        // Next frame so the entrance transition runs.
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (overlayEl) overlayEl.classList.add('visible');
        }));
    }

    // ---------------------------------------------------------------------
    // One-time popup after the loading screen
    // ---------------------------------------------------------------------

    function maybeShowOnBoot() {
        // Share-link arrivals land straight on a flight window — don't stack a
        // popup on top of it. They'll get the notes on their next normal visit.
        try {
            const p = new URLSearchParams(window.location.search || '');
            if (p.get('flight') || p.get('replay') ||
                sessionStorage.getItem('inflight_share_payload') ||
                sessionStorage.getItem('inflight_replay_payload')) return;
        } catch (_) { /* non-fatal */ }

        // Already seen this release (or storage is unreadable — in that case we
        // can't remember showing it, so never nag on every load).
        let seen;
        try { seen = localStorage.getItem(SEEN_KEY); } catch (_) { return; }
        if (seen === LATEST.id) return;

        // Wait for the splash overlay to dismiss itself (it's removed from the
        // DOM — see index.html), then for the first-run gate (ToS acceptance +
        // flight-window picker) to finish, then let the UI settle for a beat.
        // Without the gate wait, a brand-new user got the legal modal, the
        // window picker AND this popup stacked on top of each other.
        const started = Date.now();
        const timer = setInterval(() => {
            const splashGone = !document.getElementById('inflight-pro-loader-overlay');
            const loaded = document.readyState === 'complete';
            if (splashGone && loaded) {
                clearInterval(timer);
                waitForFirstRunGate().then(() => {
                    setTimeout(() => {
                        // Mark seen the moment it shows so it truly appears once,
                        // even if the tab dies before the user taps the button.
                        markSeen();
                        showModal({ popup: true });
                    }, 900);
                });
            } else if (Date.now() - started > 30000) {
                clearInterval(timer); // splash never cleared — skip this session
            }
        }, 400);
    }

    // flight.js publishes window.__inflightFirstRunPromise when the onboarding
    // gate starts (firstRunExperience.js resolves it when both steps finish;
    // returning users resolve immediately). It's created a beat into boot, so
    // poll briefly for it to appear before awaiting it. Fails open so a boot
    // hiccup can only ever delay the popup, never permanently eat it.
    async function waitForFirstRunGate() {
        const t0 = Date.now();
        while (!window.__inflightFirstRunPromise && Date.now() - t0 < 20000) {
            await new Promise((r) => setTimeout(r, 200));
        }
        try {
            if (window.__inflightFirstRunPromise) {
                await Promise.race([
                    window.__inflightFirstRunPromise,
                    new Promise((r) => setTimeout(r, 10 * 60 * 1000))
                ]);
            }
        } catch (_) { /* never block What's New on gate errors */ }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', maybeShowOnBoot, { once: true });
    } else {
        maybeShowOnBoot();
    }

    // ---------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------

    window.InflightChangelog = {
        latestVersion: LATEST.id,
        releases: RELEASES,
        open() { showModal({ popup: false }); },
        showPopup() { showModal({ popup: true }); },
        renderSettingsPanel
    };
})();
