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
            id: '2026.08.09',
            date: 'August 2026',
            title: 'Rewind The Whole Map',
            tagline: 'Pick a moment in the past and watch every flight on the server fly it again, exactly as it happened.',
            entries: [
                {
                    tag: 'new', icon: 'fa-clock-rotate-left',
                    text: 'Global Playback — not one aircraft and not one controller, but the whole map. Choose a moment, choose how long to watch, and the traffic moves as it actually did: interpolated between position reports rather than hopping between them, with comet trails, the altitude ramp and the rain radar all available while it runs. Free reaches back 24 hours; Pro reaches back two weeks.',
                    visual: `
                        <div class="cl-vis-card">
                            <div class="row" style="justify-content:space-between;">
                                <b class="cl-vis-mono" style="color:#fff; font-size:17px;">02:49Z</b>
                                <span style="font-size:9px; font-weight:800; letter-spacing:1px; color:#38bdf8; border:1px solid rgba(56,189,248,.32); background:rgba(56,189,248,.12); border-radius:999px; padding:3px 8px;">2 HOURS AGO</span>
                            </div>
                            <div class="row" style="gap:8px;">
                                <span style="flex:1; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); border-radius:8px; padding:6px 8px;">
                                    <b class="cl-vis-mono" style="color:#fff; font-size:14px;">1,482</b>
                                    <b class="cl-vis-dim" style="display:block; font-size:7.5px; letter-spacing:1.4px;">AIRBORNE</b>
                                </span>
                                <span style="flex:1; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); border-radius:8px; padding:6px 8px;">
                                    <b class="cl-vis-mono" style="color:#fff; font-size:14px;">1 HOUR</b>
                                    <b class="cl-vis-dim" style="display:block; font-size:7.5px; letter-spacing:1.4px;">IN WINDOW</b>
                                </span>
                            </div>
                            <div style="height:5px; border-radius:999px; background:linear-gradient(90deg,#38bdf8 0%,#6366f1 42%,rgba(255,255,255,.15) 42%);"></div>
                        </div>`
                },
                {
                    tag: 'new', icon: 'fa-filter',
                    text: 'Filter what you are watching — Airlines, Heavies, Cargo, Business, GA, Military or your watchlist, each carrying the count behind it. Tap an aircraft for its callsign, pilot and readings at that instant, and its route drawn on the map.'
                },
                {
                    tag: 'new', icon: 'fa-circle-info',
                    text: 'Full flight information from a replay. The info button on the flight card opens the same window a tap on the live map does, in whichever look you have chosen in Settings, showing the flight as far as it had got at the moment you are watching. Departure and arrival stay blank: those come from the filed plan, and a plan is not something a recording keeps.'
                },
                {
                    tag: 'fixed', icon: 'fa-bug',
                    text: 'Playback no longer crashes when zoomed out over a busy window. The map was being handed new frames faster than it could draw them, so on a world view the backlog grew until the tab gave up. It now waits for each frame to land before sending the next.'
                },
                {
                    tag: 'improved', icon: 'fa-palette',
                    text: 'Playback looks like the rest of the app now, and fits a phone. The controls follow the same dark glass and blue as everywhere else, and the moment picker opens as a bottom sheet with Start playback always in reach instead of a card taller than the screen.'
                }
            ]
        },
        {
            id: '2026.08.06',
            date: 'August 2026',
            title: 'Your Stats, On Your IFC Profile',
            tagline: 'Your Infinite Flight stats as one image built for your Infinite Flight Community profile — you choose what is on it, and one line of paste puts it there.',
            entries: [
                {
                    tag: 'new', icon: 'fa-id-card',
                    text: 'Profile Card — your grade, XP, landings, flight time, online flights, violations, ATC operations, ATC rank and virtual airline, as a single image made for your IFC About Me. You pick which of them appear and in what order, so it is your card and not a template: tick two and you get two tiles, not nine with seven blanks. Four looks to choose from, because IFC has a light theme and a dark one. Build one at inflight.info/card, paste the line it gives you, done.',
                    visual: `
                        <div class="cl-vis-card">
                            <div class="row" style="justify-content:space-between;">
                                <b style="color:#fff; font-size:11px;"><i class="fa-solid fa-id-card" style="color:#38bdf8; margin-right:6px;"></i>PROFILE CARD</b>
                                <span class="cl-vis-dim cl-vis-mono" style="font-size:9px;">IFC · ABOUT ME</span>
                            </div>
                            <div class="row" style="gap:6px;">
                                <span style="flex:1; text-align:center; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); border-radius:8px; padding:7px 4px;">
                                    <b class="cl-vis-dim" style="display:block; font-size:7.5px; letter-spacing:1.4px;">GRADE</b>
                                    <b style="color:#38bdf8; font-size:17px;">5</b>
                                </span>
                                <span style="flex:1; text-align:center; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); border-radius:8px; padding:7px 4px;">
                                    <b class="cl-vis-dim" style="display:block; font-size:7.5px; letter-spacing:1.4px;">XP</b>
                                    <b style="color:#fff; font-size:15px;">1,204,880</b>
                                </span>
                                <span style="flex:1; text-align:center; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); border-radius:8px; padding:7px 4px;">
                                    <b class="cl-vis-dim" style="display:block; font-size:7.5px; letter-spacing:1.4px;">LANDINGS</b>
                                    <b style="color:#fff; font-size:15px;">4,210</b>
                                </span>
                            </div>
                        </div>`
                },
                {
                    tag: 'new', icon: 'fa-rotate',
                    text: 'Pro keeps it current. A free card is a snapshot of the day you made it and says so on its face. Turn on the monthly refresh and your numbers re-read themselves from Infinite Flight at the start of every month, so the card sitting on your profile never quietly goes stale.'
                },
                {
                    tag: 'new', icon: 'fa-user-check',
                    text: 'You do not need an account to look. Type any IFC username and the card builds itself in front of you — signing in is only how you save one and get your link.'
                },
            ],
        },
        {
            id: '2026.08.05',
            date: 'August 2026',
            title: 'Your Month, And Maps That Do Something',
            tagline: 'A monthly report built from your own logbook, the route drawn inside the flight window, and a network map you can actually act on.',
            entries: [
                {
                    tag: 'new', icon: 'fa-chart-pie',
                    text: 'Your Month — your flying month read straight from your Infinite Flight logbook: hours, the route you wore out, your longest leg, the airports and countries you touched and the airframe you keep coming back to. Free, and built to be shared. Pro adds the deep cuts — hours by weekday, leg distribution, the whole fleet you flew. Find it at inflight.info/month.',
                    visual: `
                        <div class="cl-vis-card">
                            <div class="row" style="justify-content:space-between;">
                                <b style="color:#fff; font-size:11px;"><i class="fa-solid fa-chart-pie" style="color:#a78bfa; margin-right:6px;"></i>YOUR MONTH</b>
                                <span class="cl-vis-dim cl-vis-mono" style="font-size:9px;">AUGUST</span>
                            </div>
                            <div class="row" style="gap:14px;">
                                <span style="display:flex; flex-direction:column; gap:4px;">
                                    <b style="color:#fff; font-size:19px;">41h 20m</b>
                                    <b class="cl-vis-dim" style="font-size:8px; letter-spacing:1.4px;">IN THE AIR</b>
                                </span>
                                <span style="display:flex; flex-direction:column; gap:4px;">
                                    <b style="color:#fff; font-size:19px;">28</b>
                                    <b class="cl-vis-dim" style="font-size:8px; letter-spacing:1.4px;">LEGS</b>
                                </span>
                                <span style="display:flex; flex-direction:column; gap:4px; min-width:0;">
                                    <b class="cl-vis-mono" style="color:#34d399; font-size:13px;">EGLL → KJFK</b>
                                    <b class="cl-vis-dim" style="font-size:8px; letter-spacing:1.4px;">MOST FLOWN</b>
                                </span>
                            </div>
                        </div>`
                },
                {
                    tag: 'new', icon: 'fa-map-location-dot',
                    text: 'The route, inside the flight window. Open a flight and the great-circle track between its airports is drawn under the departure/arrival bar, with the aircraft on it — a picture of that flight, not a stock photo of the type. Four palettes in Settings, and flights whose airports cannot be placed simply leave the bar as it was.'
                },
                {
                    tag: 'improved', icon: 'fa-diagram-project',
                    text: 'The network map does something now. It is no longer a picture you look at: pick a route off it and the map keeps only that pairing, so going from "what is this airline flying" to watching one of those flights is a tap instead of a search.'
                },
            ],
        },
        {
            id: '2026.08.04',
            date: 'August 2026',
            title: 'Nearby & Routes',
            tagline: 'Two new ways to find a flight: a radar scope showing what is around you right now, and a search box that finally understands "EGLL-KJFK".',
            entries: [
                {
                    tag: 'new', icon: 'fa-satellite-dish',
                    text: 'Nearby — a radar scope of the traffic around a point you choose: your own location, wherever the map is pointed, or any airport you name. Rings out to 500 NM, one blip per aircraft placed on its real bearing and distance and pointed the way it is actually flying, coloured by how high it is. Tap a blip or a row to open that flight. Turn on the bell and you will be told when something crosses into the ring. On a phone it is the new Nearby tab inside Airports & ATC; on the web it is the Nearby button beside Network.',
                    visual: `
                        <div class="cl-vis-card">
                            <div class="row" style="justify-content:space-between;">
                                <b style="color:#fff; font-size:11px;"><i class="fa-solid fa-satellite-dish" style="color:#38bdf8; margin-right:6px;"></i>NEARBY</b>
                                <span class="cl-vis-dim cl-vis-mono" style="font-size:9px;">100 NM · MAP CENTRE</span>
                            </div>
                            <div class="row" style="gap:14px;">
                                <svg viewBox="0 0 74 74" style="width:74px; height:74px; flex:none;">
                                    <circle cx="37" cy="37" r="34" fill="none" stroke="rgba(56,189,248,.35)" stroke-width="1"/>
                                    <circle cx="37" cy="37" r="22" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="1"/>
                                    <circle cx="37" cy="37" r="11" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="1"/>
                                    <line x1="37" y1="3" x2="37" y2="71" stroke="rgba(255,255,255,.06)"/>
                                    <line x1="3" y1="37" x2="71" y2="37" stroke="rgba(255,255,255,.06)"/>
                                    <circle cx="37" cy="37" r="2" fill="#38bdf8"/>
                                    <path d="M 0 -4 L 2.6 3.4 L 0 1.8 L -2.6 3.4 Z" fill="#f472b6" transform="translate(52 20) rotate(120)"/>
                                    <path d="M 0 -4 L 2.6 3.4 L 0 1.8 L -2.6 3.4 Z" fill="#34d399" transform="translate(24 47) rotate(310)"/>
                                    <path d="M 0 -4 L 2.6 3.4 L 0 1.8 L -2.6 3.4 Z" fill="#38bdf8" transform="translate(43 52) rotate(20)"/>
                                </svg>
                                <span style="display:flex; flex-direction:column; gap:5px; min-width:0; flex:1;">
                                    <span style="display:flex; justify-content:space-between; gap:8px;">
                                        <b style="color:#fff; font-size:11px;">BAW117</b>
                                        <b class="cl-vis-mono" style="color:#38bdf8; font-size:10px;">9.7 NM · 022°</b>
                                    </span>
                                    <span style="display:flex; justify-content:space-between; gap:8px;">
                                        <b style="color:#fff; font-size:11px;">EZY42</b>
                                        <b class="cl-vis-mono" style="color:#34d399; font-size:10px;">26 NM · 134°</b>
                                    </span>
                                    <span style="display:flex; justify-content:space-between; gap:8px;">
                                        <b style="color:#fff; font-size:11px;">QFA1</b>
                                        <b class="cl-vis-mono" style="color:#f472b6; font-size:10px;">88 NM · 041°</b>
                                    </span>
                                </span>
                            </div>
                        </div>`
                },
                {
                    tag: 'new', icon: 'fa-route',
                    text: 'Route search — type two airports into the search box and you get the pairing itself: how far it is, and everyone flying it right now, closest to landing first. Any spelling works — EGLL-KJFK, LHR JFK, egll to kjfk. Tap the route and the map keeps only that pairing.',
                    visual: `
                        <div class="cl-vis-card">
                            <div class="row">
                                <span class="glyph" style="color:#38bdf8;"><i class="fa-solid fa-route"></i></span>
                                <span class="who">
                                    <b>EGLL → KJFK</b>
                                    <span>London Heathrow — John F Kennedy Intl</span>
                                </span>
                                <b class="cl-vis-mono" style="color:#38bdf8; font-size:11px;">2,991 NM</b>
                            </div>
                            <div class="row">
                                <span class="who">
                                    <b style="font-size:11px;">VIR3</b>
                                    <span>84 NM to run</span>
                                </span>
                                <b class="cl-vis-mono cl-vis-dim" style="font-size:10px;">9,000 ft</b>
                            </div>
                            <div class="row">
                                <span class="who">
                                    <b style="font-size:11px;">BAW175</b>
                                    <span>1,909 NM to run</span>
                                </span>
                                <b class="cl-vis-mono cl-vis-dim" style="font-size:10px;">37,000 ft</b>
                            </div>
                        </div>`
                },
            ],
        },
        {
            id: '2026.07.27',
            date: 'July 2026',
            title: 'Fuel, Tanks & Cabins',
            tagline: 'Open any flight and you can now see how much fuel it has burned, what is left in each tank, and where everyone is sitting — plus the winds and temperature it is actually flying through, instead of the weather on the ground below it.',
            entries: [
                {
                    tag: 'new', icon: 'fa-gas-pump',
                    text: 'Fuel tracking — open any flight and scroll to the new Fuel section. Infinite Flight never reports fuel, so we model it: the aircraft’s drag and engines are flown against the exact path it took, second by second, to work out what it has burned and what should be left. You get fuel remaining, live fuel flow, endurance, what it will land with, and how much of that is reserve.',
                    visual: `
                        <div class="cl-vis-card">
                            <div class="row" style="justify-content:space-between;">
                                <b style="color:#fff; font-size:11px;"><i class="fa-solid fa-gas-pump" style="color:#38bdf8; margin-right:6px;"></i>FUEL</b>
                                <span style="display:inline-flex; gap:2px; background:rgba(255,255,255,.07); border-radius:99px; padding:2px;">
                                    <b style="background:#18181b; color:#38bdf8; border-radius:99px; padding:2px 9px; font-size:9px; letter-spacing:.06em;">KG</b>
                                    <b style="color:#71717a; padding:2px 9px; font-size:9px; letter-spacing:.06em;">LB</b>
                                </span>
                            </div>
                            <div class="row" style="flex-direction:column; align-items:flex-start; gap:3px;">
                                <span class="cl-vis-dim" style="font-size:8.5px; font-weight:800; letter-spacing:.08em;">ESTIMATED FUEL REMAINING</span>
                                <b class="cl-vis-mono" style="color:#38bdf8; font-size:22px; font-weight:500;">38,228<span style="color:#71717a; font-size:11px; margin-left:3px;">kg</span></b>
                            </div>
                            <div class="row cl-vis-dim" style="font-size:10px; flex-wrap:wrap; gap:4px 10px;">
                                <span style="white-space:nowrap;">Flow <b style="color:#d4d4d8;">7,079 kg/h</b></span>
                                <span style="white-space:nowrap;">Endurance <b style="color:#d4d4d8;">5:10</b></span>
                                <span style="white-space:nowrap;">Lands with <b style="color:#d4d4d8;">10,925 kg</b></span>
                            </div>
                        </div>`
                },
                {
                    tag: 'new', icon: 'fa-oil-can',
                    text: 'Tanks you can actually see — the Fuel section draws the aircraft’s real tanks, filled to what is in them. They also empty in the right order: the centre tank goes first and the wings hold on, so a 747 half-way through a flight shows its outboard tanks still brimming and the centre bone dry, exactly as it happens.',
                    visual: `
                        <div class="cl-vis-card">
                            <div class="row" style="gap:6px;">
                                <span class="cl-vis-dim" style="font-size:8px; font-weight:800; letter-spacing:.08em;"><i class="fa-solid fa-plane-up"></i> TANKS</span>
                                <span class="cl-vis-dim" style="margin-left:auto; font-size:8px;">kg remaining</span>
                            </div>
                            <div class="row" style="gap:4px; align-items:flex-end;">
                                ${['L OUT:100', 'L INR:44', 'CTR:0', 'R INR:44', 'R OUT:100'].map(t => {
                                    const [n, pc] = t.split(':');
                                    return `<span style="flex:1; text-align:center;">
                                        <span style="position:relative; display:block; height:26px; border:1px solid rgba(255,255,255,.14); border-radius:3px; background:rgba(128,128,128,.14); overflow:hidden;">
                                            <span style="position:absolute; left:0; right:0; bottom:0; height:${pc}%; background:#38bdf8; opacity:.85;"></span>
                                            <span class="cl-vis-mono" style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:8px; font-weight:700; color:#fff;">${pc}%</span>
                                        </span>
                                        <span class="cl-vis-dim" style="display:block; font-size:7.5px; font-weight:800; margin-top:3px;">${n}</span>
                                    </span>`;
                                }).join('')}
                            </div>
                        </div>`
                },
                {
                    tag: 'new', icon: 'fa-chair',
                    text: 'Cabin layouts — a new Cabin section under Fuel shows the aircraft in plan with its seats, drawn to the type’s own shape: the right seating abreast, the right nose and tail, the wing box and the doors. Filled seats are the passengers the fuel figures are carrying, so the load behind every number is something you can look at. It is a model of the type, not your airline’s exact cabin — the card says so.',
                    visual: `
                        <div class="cl-vis-card">
                            <div class="row" style="justify-content:space-between;">
                                <b style="color:#fff; font-size:11px;"><i class="fa-solid fa-chair" style="color:#38bdf8; margin-right:6px;"></i>CABIN <span class="cl-vis-dim" style="font-weight:600; font-size:8.5px; border:1px solid rgba(255,255,255,.14); border-radius:99px; padding:1px 6px; margin-left:4px;">TYPICAL</span></b>
                                <b class="cl-vis-mono" style="color:#fff; font-size:11px;">340 <span class="cl-vis-dim" style="font-weight:500;">/ 396</span></b>
                            </div>
                            <div class="row" style="padding:12px 11px;">
                                <svg viewBox="0 0 300 62" style="width:100%; height:auto; display:block;">
                                    <path d="M 4 31 C 4 15 26 6 40 6 L 236 6 Q 268 6 296 27 L 296 35 Q 268 56 236 56 L 40 56 C 26 56 4 47 4 31 Z"
                                          fill="none" stroke="#71717a" stroke-width="1.3" opacity="0.6"/>
                                    <rect x="112" y="6" width="42" height="50" fill="#71717a" opacity="0.10"/>
                                    ${[0,1,2,3,4,5].map(r => [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15].map(c => {
                                        const y = 7.5 + r * 7 + (r > 2 ? 5 : 0);
                                        const x = 44 + c * 11.5;
                                        const filled = c < 11;
                                        return `<rect x="${x}" y="${y}" width="6" height="6" rx="1.3" ${filled ? 'fill="#38bdf8" opacity="0.95"' : 'fill="none" stroke="#38bdf8" stroke-width="0.8" opacity="0.34"'}/>`;
                                    }).join('')).join('')}
                                </svg>
                            </div>
                        </div>`
                },
                {
                    tag: 'new', icon: 'fa-scale-balanced',
                    text: 'Switch between kilograms and pounds — the KG / LB control sits at the top right of the Fuel section. Whichever you pick sticks, and every fuel figure across every flight window follows it.'
                },
                {
                    tag: 'improved', icon: 'fa-wind',
                    text: 'Real winds and temperature aloft — the app used to read the weather two metres above the ground and hand it to your aircraft at 37,000 feet. It now reads the actual pressure level you are flying at, so the outside air temperature is the −57 °C it really is up there, and the wind is the jet stream rather than the eight knots on the field below.'
                },
                {
                    tag: 'fixed', icon: 'fa-gauge-simple-high',
                    text: 'True airspeed is finally true — TAS was being worked out from temperature, which meant it always read higher than your ground speed even with a howling tailwind. It now subtracts the actual wind, so a tailwind correctly shows TAS below ground speed and a headwind above it.'
                },
                {
                    tag: 'improved', icon: 'fa-sliders',
                    text: 'Both new sections are yours to arrange — in the Simple window, open Customize → Layout to switch Fuel and Cabin on or off, or drag them anywhere in the order. They appear in all three flight window styles (Legacy, Simple and Card), which you pick in Settings.'
                },
                {
                    tag: 'fixed', icon: 'fa-crown',
                    text: 'Pro upgrades that get stuck now unstick themselves — if a payment went through but Pro never switched on, the app notices, re-checks your subscription and applies it, retrying on later visits if it has to, instead of leaving you to find the Restore button.'
                },
            ],
        },
        {
            id: '2026.07.26',
            date: 'July 2026',
            title: 'Faster Everywhere',
            tagline: 'The app opens dramatically quicker, the map is live and flying before the loading screen lifts, and everything from zooming to opening a flight now moves the way it should.',
            entries: [
                {
                    tag: 'improved', icon: 'fa-gauge-high',
                    text: 'A much faster start — the first thing you see now arrives roughly ten times sooner, and the app pulls down a fraction of what it used to before the map appears. The difference is biggest on mobile data.'
                },
                {
                    tag: 'improved', icon: 'fa-plane-circle-check',
                    text: 'Everything is ready at once — the loading screen now waits for the map, your controls and live traffic to all be on screen together, so aircraft no longer pop in a second after everything else.'
                },
                {
                    tag: 'fixed', icon: 'fa-triangle-exclamation',
                    text: 'No more staring at a black screen — if the map is taking a while, the loading screen tells you it is still working. If it cannot start at all, it says why and offers a Try again button instead of leaving you on an empty page.'
                },
                {
                    tag: 'improved', icon: 'fa-magnifying-glass-location',
                    text: 'Smoother zooming — aircraft and their labels no longer blink out and back while you pinch or scroll, and the map keeps a sensible amount of detail cached instead of hoarding it until your device starts to struggle.'
                },
                {
                    tag: 'improved', icon: 'fa-magnifying-glass',
                    text: 'Search keeps up with your typing — results across every airport and every live flight come back several times faster, with no stutter between keystrokes.'
                },
                {
                    tag: 'improved', icon: 'fa-window-maximize',
                    text: 'Flight windows open properly — the window now grows into its finished size instead of snapping to it, and switching between flights no longer collapses the panel and rebuilds it. On phones it no longer swings in from the top corner and drops to the bottom before opening — the sheet simply slides up.'
                },
                {
                    tag: 'improved', icon: 'fa-cloud-sun',
                    text: 'Fewer hitches while you fly — the weather pill’s nearest-station lookup and the busiest parts of the live feed were quietly stalling the app every few seconds. They do not any more.'
                },
                {
                    tag: 'improved', icon: 'fa-tower-control',
                    text: 'The map names the airports that matter — zoomed out you now see the big international fields instead of whichever tiny airstrip happened to get there first, and smaller fields fade in as you zoom toward them. Heliports and closed strips no longer take a label from the airport next door.'
                },
                {
                    tag: 'improved', icon: 'fa-magnifying-glass-plus',
                    text: 'Search leads with the airport you meant — typing a city now puts its main airport first. “Paris” starts with Orly rather than a municipal strip in Tennessee, and “Dubai” with Dubai International rather than a creek seaplane base.'
                },
                {
                    tag: 'new', icon: 'fa-chart-simple',
                    text: 'New Network panel — see what the whole server is doing at a glance: the busiest routes, the aircraft everyone is flying, and which airlines are out in force, with live counts for how many pilots are airborne and on the ground. Tap any row and the map narrows to just those flights, so you can go from “A350s are everywhere tonight” to watching only them in one press. On phones it sits beside the airport list as a second tab in Airports &amp; ATC.'
                },
            ],
        },
        {
            id: '2026.07.11',
            date: 'July 2026',
            title: 'Upgrades That Actually Land',
            tagline: 'Upgrading to Pro from your profile now unlocks everything the moment you’re back — and if a payment ever went through without your Pro arriving, you can put it right yourself.',
            entries: [
                {
                    tag: 'fixed', icon: 'fa-bolt',
                    text: 'Upgrading to Pro from your profile now grants Pro. Payments that completed without unlocking anything are the bug we just closed — your tools unlock the moment you’re back from checkout, no reload needed.'
                },
                {
                    tag: 'new', icon: 'fa-rotate',
                    text: 'Restore Pro access — paid but still seeing the free tier? Settings → Billing has a button that re-checks your subscription and puts your Pro back straight away.'
                },
            ],
        },
        {
            id: '2026.07.10',
            date: 'July 2026',
            title: 'Free Accounts & a Profile Worth Showing Off',
            tagline: 'Start flying with InFlight for free — no card needed — and a redesigned profile that maps every city you’ve flown to, badges the Virtual Airlines you fly for, and tallies your whole career down to the fuel you’ve burned.',
            entries: [
                {
                    tag: 'new', icon: 'fa-user-plus',
                    text: 'Free accounts — create an account in seconds with no payment and jump straight into the app. You keep your dashboard, dossier stats and settings; Pro unlocks the flagship tools whenever you’re ready.'
                },
                {
                    tag: 'new', icon: 'fa-id-badge',
                    text: 'A redesigned profile — a big “Hello, <you>” banner (a plane of your choice for Pro pilots, a clean look for everyone else), your most-used aircraft, and cards that finally feel like yours.'
                },
                {
                    tag: 'new', icon: 'fa-earth-americas',
                    text: 'Your Flight Map — a world map that connects every city you’ve flown to, drawn straight from your logbook and lighting up the regions you’ve reached.'
                },
                {
                    tag: 'new', icon: 'fa-shield-halved',
                    text: 'Your Virtual Airlines — Pro pilots show off the VAs they fly for as badges: the airline’s logo and banner, your role, callsign and hours, each a tap to open its crew center.'
                },
                {
                    tag: 'new', icon: 'fa-gas-pump',
                    text: 'Lifetime Ledger — your whole career in one place: distance flown (and laps around the Earth), estimated fuel burned, hours, landings, airports and continents, longest flight and busiest route — plus a per-aircraft breakdown down to the fuel each type has burned.'
                },
                {
                    tag: 'new', icon: 'fa-plane-up',
                    text: 'Pick any aircraft as your banner — Pro pilots can set their profile banner to any aircraft in our database (searchable by type, livery or tail) or their own image.'
                },
                {
                    tag: 'new', icon: 'fa-route',
                    text: 'Explore any pilot’s route network — tap a flight’s pilot report and, as a Pro pilot, hit “Map their routes” to draw their entire flown network as great-circle arcs on the 3D globe. Toggle a 3D tilt, hide all live aircraft, and tap any airport for its own history card: your visits, landings, hours and fuel there, plus whether you favour short/medium/long hauls and which aircraft you usually fly in.'
                },
                {
                    tag: 'improved', icon: 'fa-crown',
                    text: 'Clearer Pro — Pro tools and settings now unlock on your actual Pro membership, with a tidy upgrade prompt on anything a free account hasn’t unlocked yet.'
                },
                {
                    tag: 'fixed', icon: 'fa-lock',
                    text: 'Pro map styles, 3D traffic, custom map layers and airport pings are properly reserved for Pro — no longer handed out just for being signed in.'
                },
            ],
        },
        {
            id: '2026.07.9',
            date: 'July 2026',
            title: 'Rewind Any Flight',
            tagline: 'Play back any saved flight on its own page — a map that draws the path behind the aircraft, a synced altitude & speed graph, and a running commentary of exactly what’s happening, moment to moment.',
            entries: [
                {
                    tag: 'new', icon: 'fa-clock-rotate-left',
                    text: 'Browse Replays — a new panel (the clock button in the map toolbar) lists every saved flight across all pilots, grouped by pilot and searchable. Open any one and it plays straight back on the map.'
                },
                {
                    tag: 'new', icon: 'fa-circle-play',
                    text: 'Replays in every profile — search any pilot and their stored replays now sit in their profile, each one a tap to play. Someone flying right now is replayable in progress, too.'
                },
                {
                    tag: 'new', icon: 'fa-map-location-dot',
                    text: 'A dedicated replay page — a clean map with the flown path drawing itself behind the aircraft (the same silhouette as the live map), a scrubber with play/pause, speed, follow and path controls, and an altitude & speed graph you can drag to scrub. Zoom stays where you put it.'
                },
                {
                    tag: 'new', icon: 'fa-comment-dots',
                    text: 'Live commentary — as the replay plays it narrates the flight: boarding at the gate with a departure countdown, taxiing out, taking off from a runway, climbing, cruising, descending, on approach, and parked at the gate on arrival.',
                    visual: `
                        <div class="cl-vis-card">
                            <div class="row">
                                <span class="glyph"><i class="fa-solid fa-plane-departure"></i></span>
                                <span class="who"><b>Taking off from runway 24</b><span>VHHH → OMDB</span></span>
                            </div>
                            <div class="row cl-vis-mono" style="font-weight:700; color:#fff;">
                                12:58 <span class="cl-vis-dim" style="margin-left:auto; font-weight:600;">2,875 ft · 185 kt</span>
                            </div>
                            <div class="row cl-vis-dim" style="font-size:10px;">Boarding at gate <b style="color:#d4d4d8;">B12</b> · departing in <b style="color:#d4d4d8;">5 min</b></div>
                        </div>`
                },
                {
                    tag: 'new', icon: 'fa-route',
                    text: 'Multi-leg journeys — a flight that landed and parked before flying on is split into separate legs you can switch between, each with its own times and distance.'
                },
                {
                    tag: 'fixed', icon: 'fa-image',
                    text: 'VA partner logos no longer render oversized — the Virtual Airline logos in the desktop Filters (and other spots) are back to their proper size.'
                },
                {
                    tag: 'fixed', icon: 'fa-hand-pointer',
                    text: 'The aircraft hover card no longer pops up — and stick — when you tap an aircraft on mobile; it’s a mouse-only card again.'
                }
            ]
        },
        {
            id: '2026.07.8',
            date: 'July 2026',
            title: 'Your Fleet & The Weather Up Front',
            tagline: 'A live hangar of the aircraft you’re flying right now, and a weather pill that knows where your flight is, what time it is there, and what the sky is doing.',
            entries: [
                {
                    tag: 'new', icon: 'fa-plane-up',
                    text: 'New Fleet tab in the Pro dashboard — on the desktop dock and the mobile tab bar. Every aircraft you currently have on the live map gets its own card: live route and telemetry, that airframe’s career record from your logbook (flights, hours, landings), its previous leg, and a one-tap way to plan the route again.',
                    visual: `
                        <div class="cl-vis-card">
                            <div class="row">
                                <span class="glyph"><i class="fa-solid fa-plane-up"></i></span>
                                <span class="who"><b>Boeing 777-300ER</b><span>Emirates</span></span>
                                <span class="cl-vis-badge"><span class="dot"></span>IN FLIGHT</span>
                            </div>
                            <div class="row cl-vis-mono" style="font-weight:700; color:#fff;">
                                EGLL <i class="fa-solid fa-plane" style="font-size:9px; color:#4ade80;"></i> KJFK
                                <span class="cl-vis-dim" style="margin-left:auto; font-weight:600;">36,000 ft · 481 kt</span>
                            </div>
                            <div class="row cl-vis-dim" style="font-size:10px;">
                                <b style="color:#d4d4d8;">20</b> flights&nbsp;·&nbsp;<b style="color:#d4d4d8;">136.4</b> hrs&nbsp;·&nbsp;<b style="color:#d4d4d8;">19</b> landings
                            </div>
                        </div>`
                },
                {
                    tag: 'new', icon: 'fa-cloud-sun-rain',
                    text: 'Weather pill — whenever a flight window is open, a small glass pill sits top-left with the conditions where your aircraft is right now, from the nearest reporting station. Tap it for the full picture: that nearby station plus departure and arrival METARs — wind, visibility, clouds, altimeter and the raw report.',
                    visual: `
                        <div class="cl-vis-pill">
                            <i class="fa-solid fa-cloud-moon-rain"></i>
                            <span class="t">18°</span>
                            <span class="m"><b>EGLL</b><span>240° @ 12 kt G22</span></span>
                        </div>
                        <div class="cl-vis-card">
                            <div class="row" style="justify-content:space-between;">
                                <b style="color:#fff; font-size:11px;">Route Weather</b>
                                <span class="cl-vis-dim" style="font-size:9px;">updated just now</span>
                            </div>
                            <div class="row">
                                <span class="cl-vis-dim" style="font-size:8.5px; font-weight:800; letter-spacing:.06em;">NEAR · 12 KM</span>
                                <b class="cl-vis-mono" style="color:#fff;">EGLL</b>
                                <span style="margin-left:auto; color:#fff; font-weight:700;">18°C</span>
                            </div>
                            <div class="row cl-vis-dim" style="font-size:10px;">Wind <b style="color:#d4d4d8;">240° @ 12 kt G22</b> · Ceiling <b style="color:#d4d4d8;">2,500 ft</b> · <b style="color:#d4d4d8;">1013 hPa</b></div>
                        </div>`
                },
                {
                    tag: 'new', icon: 'fa-moon',
                    text: 'The pill’s sun or moon is real — computed from the sun’s actual position over your aircraft, so it shows a moon when it’s dark where you’re flying, whatever your own clock says. Condition icons are little scenes too: rain under the cloud with the sun or moon behind it, a bolt for storms, wind for gusty clear days.'
                },
                {
                    tag: 'new', icon: 'fa-triangle-exclamation',
                    text: 'SIGMET awareness — the pill grows a pulsing hazard badge when your flight is inside an active SIGMET or AIRMET area, tinted by the worst hazard (storms, turbulence, icing and more). The panel lists each advisory with its altitude band, expiry time and the raw text.',
                    visual: `
                        <div class="cl-vis-pill">
                            <i class="fa-solid fa-cloud"></i>
                            <span class="t">24°</span>
                            <span class="m"><b>KJFK</b><span>280° @ 8 kt</span></span>
                            <span class="hz"><i class="fa-solid fa-triangle-exclamation"></i></span>
                        </div>
                        <div class="cl-vis-card">
                            <div class="row cl-vis-haz">
                                <i class="fa-solid fa-triangle-exclamation" style="color:#ff9500;"></i>
                                <span class="hz-main"><b>SEV Turbulence</b><span>24,000–38,000 ft · until 17:30Z · MUMBAI FIR</span></span>
                            </div>
                            <div class="row cl-vis-haz">
                                <i class="fa-solid fa-triangle-exclamation" style="color:#ff3b30;"></i>
                                <span class="hz-main"><b>EMBD Convective</b><span>tops FL450 · until 16:30Z</span></span>
                            </div>
                        </div>`
                },
                {
                    tag: 'improved', icon: 'fa-palette',
                    text: 'The weather pill wears the flight window’s own colours — re-theme the window and the pill re-tints with it, live.'
                },
                {
                    tag: 'improved', icon: 'fa-mobile-screen-button',
                    text: 'On phones the pill knows the sheet — it steps aside while the flight sheet is fully expanded and returns when you drop back to the peek view. And dismissing the weather panel never closes the flight window behind it.'
                }
            ]
        },
        {
            id: '2026.07.7',
            date: 'July 2026',
            title: 'A Sharper Trail',
            tagline: 'The flown path is rebuilt end-to-end — crisp at every zoom, an altitude rainbow, true polar routes — and Filters learn to hide what you don’t want.',
            entries: [
                { tag: 'improved', icon: 'fa-route', text: 'Flown path rebuilt — one continuous altitude-coloured line instead of thousands of tiny pieces. It stays crisp however far you zoom out and updates the moment each position report arrives, even hours into a long-haul.' },
                { tag: 'new', icon: 'fa-palette', text: 'Fourteen altitude colours — the trail sweeps a full warm-to-cool spectrum: orange at rotation, yellows and greens through the climb, blues at cruise, violet and magenta up high. Every climb and descent reads like an altitude rainbow.' },
                { tag: 'fixed', icon: 'fa-earth-americas', text: 'Polar routes draw correctly — a path over the top (or bottom) of the world now follows the real great circle across the pole instead of sweeping sideways around it.' },
                { tag: 'fixed', icon: 'fa-location-crosshairs', text: 'The path now ends exactly at the aircraft — no more trail poking out ahead of the plane.' },
                { tag: 'new', icon: 'fa-eye-slash', text: 'Filters can hide, not just show — every rule (aircraft type, airline, category, phase, altitude, speed, route and more) now has a Show / Hide switch: Show keeps only matching aircraft, Hide removes them from the map.' },
                { tag: 'new', icon: 'fa-plane-up', text: 'New Flight State quick filters — Airborne Only, On Ground Only, and Has a Flight Plan.' },
                { tag: 'fixed', icon: 'fa-user-check', text: 'VA rosters match more reliably — pilot usernames from the VA directory and the live feed are now normalised identically, so rostered pilots no longer drop out of VA filters or rosters over invisible character differences.' },
                { tag: 'new', icon: 'fa-clock', text: 'Local time in flight windows — show departure and arrival times in your own time zone (or your device’s) and switch between 24-hour and 12-hour (AM/PM). Open to everyone, under Settings → Flight Window.' },
                { tag: 'improved', icon: 'fa-id-card', text: 'The Card flight window dropped the big logo tile between the photo and the callsign — the callsign now sits cleanly under the hero shot.' }
            ]
        },
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
            tagline: 'Flight links that never die, a trip card rebuilt as a cockpit HUD, and every partner VA’s fleet live on its page.',
            entries: [
                { tag: 'new', icon: 'fa-share-nodes', text: 'Share Flight rebuilt — links now carry the flight with them and open instantly for the recipient. Links from the mobile apps finally work too.' },
                { tag: 'new', icon: 'fa-clock-rotate-left', text: 'Shared flight already landed? The link drops straight into the full map replay instead of a dead spinner.' },
                { tag: 'new', icon: 'fa-image', text: 'Sharing inflight.info in Discord, WhatsApp or iMessage now unfurls with a branded banner and description.' },
                { tag: 'improved', icon: 'fa-gauge-high', text: 'Trip card completely rehauled — a spread-out glass HUD in the replay panel’s style: live phase of flight, ETA and Zulu time, V/S, heading, airport names and a one-tap Replay handoff.' },
                { tag: 'new', icon: 'fa-plane', text: 'Partner pages show the VA’s Live Fleet — aircraft photo cards for every member in the air. Tap one to jump to that flight on the map.' },
                { tag: 'improved', icon: 'fa-user-check', text: 'Fleet lists and live counts only include callsigns carrying the VA’s membership tag — no more strangers in the roster.' },
                { tag: 'fixed', icon: 'fa-wand-magic-sparkles', text: 'First launch is smooth now — Terms, the window picker and What’s New take turns instead of piling on top of each other.' },
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

            /* Optional "See it" visual dropdown under an entry */
            .cl-visual { margin-top: 8px; }
            .cl-visual summary {
                display: inline-flex; align-items: center; gap: 6px;
                list-style: none; cursor: pointer; user-select: none;
                font-size: 0.66rem; font-weight: 700; letter-spacing: .04em;
                color: #7dd3fc; padding: 4px 10px; border-radius: 999px;
                background: rgba(56,189,248,0.08); border: 1px solid rgba(56,189,248,0.2);
                transition: background .15s ease;
            }
            .cl-visual summary::-webkit-details-marker { display: none; }
            .cl-visual summary:hover { background: rgba(56,189,248,0.15); }
            .cl-visual-chev { font-size: 0.55rem; transition: transform .2s ease; }
            .cl-visual[open] .cl-visual-chev { transform: rotate(180deg); }
            .cl-visual-body {
                margin-top: 10px; padding: 16px 12px;
                border-radius: 12px; border: 1px solid rgba(255,255,255,0.07);
                background:
                    radial-gradient(120% 120% at 20% 0%, rgba(56,189,248,0.06), transparent 55%),
                    rgba(0,0,0,0.35);
                display: flex; flex-direction: column; align-items: center; gap: 10px;
                animation: cl-vis-in .25s ease;
            }
            @keyframes cl-vis-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }

            /* Miniature mockups used inside the visuals */
            .cl-vis-pill {
                display: inline-flex; align-items: center; gap: 8px;
                padding: 8px 12px; border-radius: 14px;
                background: linear-gradient(135deg, rgba(45,45,45,0.95), rgba(30,30,34,0.95));
                border: 1px solid rgba(255,255,255,0.12);
                box-shadow: 0 8px 20px rgba(0,0,0,0.4);
            }
            .cl-vis-pill > i { font-size: 15px; color: #cbd5e1; }
            .cl-vis-pill .t { font-size: 15px; font-weight: 800; color: #fff; }
            .cl-vis-pill .m { display: flex; flex-direction: column; line-height: 1.15; }
            .cl-vis-pill .m b { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: #94a3b8; letter-spacing: .04em; }
            .cl-vis-pill .m span { font-size: 9px; color: #64748b; }
            .cl-vis-pill .hz { color: #ff9500; font-size: 12px; animation: cl-vis-pulse 1.8s ease-in-out infinite; }
            @keyframes cl-vis-pulse { 0%,100% { opacity: 1; } 50% { opacity: .5; } }
            .cl-vis-card {
                width: min(300px, 100%);
                border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);
                background: rgba(28,28,32,0.95); overflow: hidden;
                text-align: left; font-size: 11px; color: #d4d4d8;
            }
            .cl-vis-card .row { display: flex; align-items: center; gap: 9px; padding: 9px 11px; }
            .cl-vis-card .row + .row { border-top: 1px solid rgba(255,255,255,0.06); }
            .cl-vis-card .glyph {
                width: 28px; height: 28px; border-radius: 8px; flex: 0 0 auto;
                display: grid; place-items: center; font-size: 12px;
                background: rgba(74,222,128,0.12); color: #4ade80;
            }
            .cl-vis-card .who { min-width: 0; flex: 1; }
            .cl-vis-card .who b { display: block; color: #fff; font-size: 12px; }
            .cl-vis-card .who span { color: #71717a; font-size: 10px; }
            .cl-vis-badge {
                flex: 0 0 auto; display: inline-flex; align-items: center; gap: 5px;
                font-size: 8.5px; font-weight: 800; letter-spacing: .06em;
                padding: 3px 8px; border-radius: 999px;
                background: rgba(74,222,128,0.14); color: #4ade80;
            }
            .cl-vis-badge .dot { width: 5px; height: 5px; border-radius: 50%; background: #4ade80; animation: cl-vis-pulse 1.6s ease-in-out infinite; }
            .cl-vis-mono { font-family: 'JetBrains Mono', monospace; }
            .cl-vis-dim { color: #71717a; }
            .cl-vis-haz { display: flex; gap: 8px; align-items: flex-start; }
            .cl-vis-haz > i { margin-top: 1px; font-size: 12px; }
            .cl-vis-haz .hz-main b { display: block; color: #fff; font-size: 11px; }
            .cl-vis-haz .hz-main span { color: #71717a; font-size: 9.5px; }

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
        // e.visual is trusted markup authored in this file (never user data):
        // a small inline mockup shown behind an optional <details> dropdown.
        const visual = e.visual ? `
            <details class="cl-visual">
                <summary><i class="fa-solid fa-eye"></i> See it <i class="fa-solid fa-chevron-down cl-visual-chev"></i></summary>
                <div class="cl-visual-body">${e.visual}</div>
            </details>` : '';
        return `
            <div class="cl-item">
                <div class="cl-item-icon"><i class="fa-solid ${esc(e.icon || 'fa-sparkles')}"></i></div>
                <div class="cl-item-main">
                    <span class="cl-tag ${meta.cls}">${meta.label}</span>
                    <div class="cl-item-text">${esc(e.text)}</div>
                    ${visual}
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
