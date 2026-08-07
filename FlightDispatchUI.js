/**
 * FlightDispatchUI.js
 *
 * Owns the entire flight-plan ("Dispatch") tab in ProfileUI.
 *
 * Responsibilities:
 *   • Renders the tab — left column (filed flight tickets) + right column
 *     (quick-guide card + dispatch form).
 *   • Handles all UI interactions in that tab: quick-schedule chips, gate
 *     map picker, ICAO blur → EET autocalc, edit/delete on filed tickets.
 *   • Exposes a `resetForm()` for the host to call after a successful save.
 *
 * What this module does NOT own:
 *   • The Supabase insert/update on form submit. The host (ProfileUI) keeps
 *     its existing handler on `#pui-submit-flight-btn`. This module never
 *     touches that button so the host's listener fires unchanged.
 *
 * Features inside the form:
 *   1. Quick-Schedule Chips — "Now / +15m / +30m / +1h / +2h / Custom"
 *      replace the bare datetime-local as the primary departure-time entry.
 *      "Custom" reveals the original datetime-local for flights filed
 *      further out. Default chip on a fresh form is "+15m".
 *
 *   2. Gate Map Picker — a 📍 button next to each gate input opens a
 *      Leaflet 2D map with every `aeroway=gate` node from OpenStreetMap
 *      around that airport as a tappable marker. Falls back to the plain
 *      text input when OSM has no gate data for that airport.
 *
 * ─── INTEGRATION (profileUI.js side) ────────────────────────────────────
 *
 *   1. Import:
 *        import { FlightDispatchUI } from './FlightDispatchUI.js';
 *
 *   2. Init once on app boot (e.g. inside ProfileUI.init):
 *        FlightDispatchUI.init();
 *
 *   3. Replace the flight-plan branch in _getTabContentHTML:
 *        if (this._activeTab === 'flight-plan') {
 *            return FlightDispatchUI.getTabHTML(this);
 *        }
 *
 *   4. Replace the flight-plan listener block. Keep ONLY the submit handler:
 *        if (this._activeTab === 'flight-plan') {
 *            FlightDispatchUI.attachListeners(this);
 *
 *            document.getElementById('pui-submit-flight-btn')
 *                ?.addEventListener('click', async () => {
 *                    // ... existing Supabase insert/update logic, UNCHANGED ...
 *                    // After success:
 *                    this._fetchFlightPlans();
 *                    FlightDispatchUI.resetForm();
 *                });
 *        }
 *
 *   5. The host's existing `_resetFlightForm`, `_autoCalculateRouteEET`,
 *      and AIRCRAFT_SELECTION_LIST can be deleted from profileUI.js —
 *      they all live in this module now.
 *
 * Host (ProfileUI) methods/state this module reads or calls:
 *   • host._editingFlightId       (read + write)
 *   • host._flightPlansData       (read)
 *   • host._timezone              (read)
 *   • host._airportCache          (read + write — bootstrapped on demand)
 *   • host._supabase              (delete operation)
 *   • host._fetchFlightPlans()    (refresh after delete)
 *   • host._showToast()           (optional)
 *   • host._showMessage()         (optional)
 *   • host._showDeleteConfirmation() (optional — falls back to confirm())
 * ─────────────────────────────────────────────────────────────────────────
 */

const AIRCRAFT_SELECTION_LIST = [
    // Airbus
    { value: 'A318', name: 'Airbus A318-100' },
    { value: 'A319', name: 'Airbus A319-100' },
    { value: 'A320', name: 'Airbus A320-200' },
    { value: 'A20N', name: 'Airbus A320neo' },
    { value: 'A321', name: 'Airbus A321-200' },
    { value: 'A21N', name: 'Airbus A321neo' },
    { value: 'A333', name: 'Airbus A330-300' },
    { value: 'A339', name: 'Airbus A330-900neo' },
    { value: 'A346', name: 'Airbus A340-600' },
    { value: 'A359', name: 'Airbus A350-900' },
    { value: 'A388', name: 'Airbus A380-800' },
    // Boeing
    { value: 'B712', name: 'Boeing 717-200' },
    { value: 'B737', name: 'Boeing 737-700' },
    { value: 'B738', name: 'Boeing 737-800' },
    { value: 'B739', name: 'Boeing 737-900' },
    { value: 'B38M', name: 'Boeing 737 MAX 8' },
    { value: 'B742', name: 'Boeing 747-200B' },
    { value: 'B744', name: 'Boeing 747-400' },
    { value: 'B748', name: 'Boeing 747-8' },
    { value: 'B752', name: 'Boeing 757-200' },
    { value: 'B763', name: 'Boeing 767-300ER' },
    { value: 'B772', name: 'Boeing 777-200ER' },
    { value: 'B77L', name: 'Boeing 777-200LR' },
    { value: 'B77W', name: 'Boeing 777-300ER' },
    { value: 'B788', name: 'Boeing 787-8' },
    { value: 'B789', name: 'Boeing 787-9' },
    { value: 'B78X', name: 'Boeing 787-10' },
    // Bombardier (CRJ)
    { value: 'CRJ2', name: 'Bombardier CRJ-200' },
    { value: 'CRJ7', name: 'Bombardier CRJ-700' },
    { value: 'CRJ9', name: 'Bombardier CRJ-900' },
    { value: 'CRJX', name: 'Bombardier CRJ-1000' },
    // De Havilland
    { value: 'DH8D', name: 'De Havilland Dash 8 Q400' },
    // Embraer
    { value: 'E175', name: 'Embraer E175' },
    { value: 'E190', name: 'Embraer E190' },
    // McDonnell Douglas
    { value: 'DC10', name: 'McDonnell Douglas DC-10' },
    { value: 'MD11', name: 'McDonnell Douglas MD-11' },
];

/* ---------------------------------------------------------------------------
 * PERFORMANCE — what the fuel and payload plan is built out of.
 *
 * Seats and cruise TAS only. Fuel burn is deliberately NOT here: profileUI
 * already carries a burn table (`_fuelBurnKgPerHr`), the lifetime-stats ledger
 * is drawn from it, and a second table in this file would be a second thing to
 * keep in step — the first flight where the dispatch panel and the logbook
 * disagreed about a 777 would be a bug nobody could locate. We match against it
 * on the aircraft NAME, which is the string it already keys on and which this
 * list happens to hold.
 *
 * `seats` is a typical two-class arrangement rather than an exit limit: the
 * number is there to size a sensible load, and filing 853 on an A380 because
 * that is the certified maximum would be a worse default than any real airline
 * would ever dispatch.
 *
 * Anything missing falls back to NARROWBODY below, which is why an aircraft
 * added to the selection list and forgotten here still plans a usable flight
 * instead of a blank one.
 * ------------------------------------------------------------------------- */
const AIRCRAFT_PERFORMANCE = {
    A318: { seats: 107, cruiseKt: 447 }, A319: { seats: 134, cruiseKt: 447 },
    A320: { seats: 150, cruiseKt: 447 }, A20N: { seats: 165, cruiseKt: 455 },
    A321: { seats: 185, cruiseKt: 447 }, A21N: { seats: 200, cruiseKt: 455 },
    A333: { seats: 277, cruiseKt: 470 }, A339: { seats: 287, cruiseKt: 475 },
    A346: { seats: 326, cruiseKt: 483 }, A359: { seats: 315, cruiseKt: 488 },
    A388: { seats: 525, cruiseKt: 490 },
    B712: { seats: 106, cruiseKt: 421 }, B737: { seats: 126, cruiseKt: 447 },
    B738: { seats: 162, cruiseKt: 447 }, B739: { seats: 178, cruiseKt: 447 },
    B38M: { seats: 178, cruiseKt: 453 }, B742: { seats: 366, cruiseKt: 490 },
    B744: { seats: 416, cruiseKt: 493 }, B748: { seats: 467, cruiseKt: 495 },
    B752: { seats: 200, cruiseKt: 458 }, B763: { seats: 261, cruiseKt: 460 },
    B772: { seats: 305, cruiseKt: 482 }, B77L: { seats: 317, cruiseKt: 482 },
    B77W: { seats: 396, cruiseKt: 490 }, B788: { seats: 242, cruiseKt: 488 },
    B789: { seats: 290, cruiseKt: 488 }, B78X: { seats: 330, cruiseKt: 488 },
    CRJ2: { seats: 50, cruiseKt: 424 }, CRJ7: { seats: 70, cruiseKt: 447 },
    CRJ9: { seats: 90, cruiseKt: 447 }, CRJX: { seats: 104, cruiseKt: 447 },
    DH8D: { seats: 78, cruiseKt: 360 },
    E175: { seats: 88, cruiseKt: 447 }, E190: { seats: 114, cruiseKt: 447 },
    DC10: { seats: 270, cruiseKt: 476 }, MD11: { seats: 293, cruiseKt: 476 },
};
const NARROWBODY = { seats: 150, cruiseKt: 447 };

/* Fuel planning constants. These are the ordinary shape of a dispatch release,
 * not invented numbers: taxi out, the trip itself, a contingency percentage on
 * the trip, enough to reach an alternate, and a final reserve nobody plans to
 * touch. Naming each one is the point — a single "block fuel" figure the pilot
 * cannot take apart is a figure they cannot sanity-check. */
const TAXI_MIN = 12;          // engines running before wheels-up
const CONTINGENCY_PCT = 0.05; // 5% of trip fuel, the usual allowance
const ALTERNATE_MIN = 30;     // a diversion to somewhere sensible
const RESERVE_MIN = 30;       // final reserve, held to landing
const LOAD_FACTOR = 0.85;     // a full-ish aeroplane, not a sold-out one
const PAX_WEIGHT_LB = 210;    // passenger plus their bag, standard-ish
const KG_TO_LB = 2.20462;

const OVERPASS_ENDPOINT  = 'https://overpass-api.de/api/interpreter';
const LEAFLET_CSS_URL    = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS_URL     = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const AIRPORTS_DB_URL    = 'https://raw.githubusercontent.com/mwgg/Airports/master/airports.json';

export const FlightDispatchUI = {
    // ── Host wiring ────────────────────────────────────────────────────
    _host: null,

    // ── Caches ─────────────────────────────────────────────────────────
    _gateCache: new Map(),  // ICAO -> [{ ref, lat, lon, kind }]

    // ── Internal state ─────────────────────────────────────────────────
    _activeChipMinutes: null,
    _leafletReady: false,

    // =====================================================================
    //  PUBLIC API
    // =====================================================================

    init() {
        this.injectStyles();
    },

    /**
     * Returns the complete HTML for the flight-plan tab.
     * Call from `_getTabContentHTML` when activeTab === 'flight-plan'.
     */
    getTabHTML(host) {
        this._host = host;

        return `
            <div class="pui-tab-header pui-fade-in">
                <div>
                    <h2>Flight Dispatch</h2>
                    <p>File upcoming flight plans and review your active schedule.</p>
                </div>
            </div>
            <div class="pui-dispatch-layout pui-fade-in">
                <div class="pui-dispatch-list">
                    ${this._renderFlightCards()}
                </div>
                <div class="pui-dispatch-form-col">
                    ${this._renderQuickGuide()}
                    ${this._renderForm()}
                </div>
            </div>
        `;
    },

    /**
     * Wires every interaction in the dispatch tab EXCEPT the submit button.
     * The host keeps its existing submit handler — this module never
     * attaches anything to #pui-submit-flight-btn.
     */
    attachListeners(host) {
        this._host = host;
        this.injectStyles();
        this._attachQuickSchedule();
        this._attachGatePicker();
        this._attachEETAutocalc();
        this._attachLoadPlanner();
        this._attachEditDelete();
        this._attachCancelEdit();
        this._populateFormForEdit();
    },

    /**
     * Resets the form back to "Create" mode. Call from the host after
     * a successful Supabase save.
     */
    resetForm() {
        if (this._host) this._host._editingFlightId = null;

        const formTitle = document.getElementById('pui-dispatch-form-title');
        if (formTitle) formTitle.innerHTML = `<i class="fa-solid fa-file-pen"></i> Generate dispatch`;

        const submitBtn = document.getElementById('pui-submit-flight-btn');
        if (submitBtn) submitBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> File flight plan`;

        const cancelBtn = document.getElementById('pui-cancel-edit-btn');
        if (cancelBtn) cancelBtn.style.display = 'none';

        const inputs = [
            'pui-new-callsign', 'pui-new-aircraft', 'pui-new-dep', 'pui-new-arr',
            'pui-new-dep-gate', 'pui-new-arr-gate', 'pui-new-time', 'pui-new-duration',
            'pui-new-pax', 'pui-new-fuel',
        ];
        inputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

        // Reset chips back to the "+15m" default
        const customRow = document.getElementById('pui-custom-time-row');
        if (customRow) customRow.style.display = 'none';
        const defaultChip = document.querySelector('.pui-chip[data-quick-min="15"]');
        if (defaultChip) this._activateChip(15, defaultChip);
    },

    // =====================================================================
    //  HTML BUILDERS
    // =====================================================================

    _renderFlightCards() {
        const flights = this._host?._flightPlansData || [];
        if (flights.length === 0) {
            return `
                <div class="pui-empty-state">
                    <i class="fa-solid fa-paper-plane"></i>
                    <h4>No flights filed yet</h4>
                    <p>File your first flight plan using the form on the right.</p>
                </div>`;
        }

        const tz = this._host?._timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

        return flights.map((flight) => {
            const depTime = new Date(flight.dep_time);
            const day  = depTime.toLocaleDateString('en-US', { weekday: 'short', timeZone: tz });
            const date = depTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz });
            const time = depTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
            const hours = Math.floor(flight.duration_minutes / 60);
            const mins  = flight.duration_minutes % 60;
            return `
                <div class="pui-ticket">
                    <div class="pui-ticket-actions">
                        <button class="pui-icon-btn pui-ticket-edit-btn" data-id="${flight.flight_id}" title="Edit Flight"><i class="fa-solid fa-pen"></i></button>
                        <button class="pui-icon-btn pui-ticket-delete-btn" data-id="${flight.flight_id}" title="Delete Flight"><i class="fa-solid fa-trash"></i></button>
                    </div>
                    <div class="pui-ticket-stub">
                        <span class="pui-ticket-day">${day}</span>
                        <span class="pui-ticket-date">${date}</span>
                        <span class="pui-ticket-time pui-mono">${time}</span>
                        <span class="pui-ticket-cs">${flight.callsign}</span>
                    </div>
                    <div class="pui-ticket-body">
                        <div class="pui-ticket-route">
                            <div class="pui-ticket-point">
                                <span class="pui-ticket-icao">${flight.dep_icao}</span>
                                ${flight.dep_gate ? `<span class="pui-ticket-gate">Gate ${flight.dep_gate}</span>` : ''}
                            </div>
                            <div class="pui-ticket-path">
                                <span class="pui-ticket-duration">${hours}h ${mins}m</span>
                                <div class="pui-ticket-line"><i class="fa-solid fa-plane"></i></div>
                                <span class="pui-ticket-acft">${flight.aircraft_type}</span>
                            </div>
                            <div class="pui-ticket-point pui-ticket-point-right">
                                <span class="pui-ticket-icao">${flight.arr_icao}</span>
                                ${flight.arr_gate ? `<span class="pui-ticket-gate">Gate ${flight.arr_gate}</span>` : ''}
                            </div>
                        </div>
                    </div>
                    <div class="pui-ticket-aside">
                        ${flight.passengers ? `<div class="pui-ticket-stat"><i class="fa-solid fa-users"></i> ${flight.passengers} pax</div>` : ''}
                        ${flight.fuel_used ? `<div class="pui-ticket-stat"><i class="fa-solid fa-gas-pump"></i> ${flight.fuel_used.toLocaleString()} lbs</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    },

    _renderQuickGuide() {
        return `
            <div class="pui-card" style="margin-bottom: var(--pui-gap-md); background: var(--pui-accent-soft); border-color: var(--pui-accent-soft);">
                <div class="pui-card-body" style="padding: 16px;">
                    <h4 style="margin: 0 0 8px 0; font-size: 0.8rem; color: var(--pui-accent); text-transform: uppercase; letter-spacing: 0.05em;"><i class="fa-solid fa-map-location-dot"></i> Quick Guide: Filing a Plan</h4>
                    <ol style="margin: 0; padding-left: 18px; font-size: 0.8rem; color: var(--pui-text-secondary); line-height: 1.5;">
                        <li><strong>Identify:</strong> Set your Callsign and Aircraft Type.</li>
                        <li><strong>Route:</strong> Enter Origin/Destination (4-letter ICAO). EET will auto-calculate!</li>
                        <li><strong>Schedule:</strong> Tap a quick chip ("+15m") or pick a custom time. Tap the map icon next to a gate to choose visually.</li>
                        <li><strong>Load:</strong> Pax and block fuel plan themselves from the aircraft and the route — tap Recalculate after changing either.</li>
                    </ol>
                </div>
            </div>
        `;
    },

    _renderForm() {
        const aircraftOptions = AIRCRAFT_SELECTION_LIST.map(a =>
            `<option value="${a.value}">${a.name} (${a.value})</option>`
        ).join('');

        return `
            <div class="pui-card pui-dispatch-form">
                <div class="pui-card-header">
                    <h3 id="pui-dispatch-form-title"><i class="fa-solid fa-file-pen"></i> Generate dispatch</h3>
                </div>
                <div class="pui-card-body">

                    <!-- ─── Flight Identification ─── -->
                    <div class="pui-form-section">
                        <h4 class="pui-form-section-title">Flight Identification</h4>
                        <div class="pui-form-row">
                            <div class="pui-input-group">
                                <label>Callsign</label>
                                <div class="pui-input-wrapper">
                                    <i class="fa-solid fa-tower-broadcast pui-input-icon"></i>
                                    <input type="text" id="pui-new-callsign" class="pui-input has-icon" placeholder="DAL404">
                                </div>
                            </div>
                            <div class="pui-input-group">
                                <label>Aircraft Equipment</label>
                                <div class="pui-input-wrapper">
                                    <i class="fa-solid fa-plane pui-input-icon"></i>
                                    <select id="pui-new-aircraft" class="pui-input has-icon pui-select">
                                        <option value="" disabled selected>Select equipment</option>
                                        ${aircraftOptions}
                                    </select>
                                    <i class="fa-solid fa-chevron-down pui-select-chevron"></i>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- ─── Routing ─── -->
                    <div class="pui-form-section">
                        <h4 class="pui-form-section-title">Routing</h4>
                        <div class="pui-form-row">
                            <div class="pui-input-group">
                                <label>Origin</label>
                                <div class="pui-input-wrapper">
                                    <i class="fa-solid fa-plane-departure pui-input-icon"></i>
                                    <input type="text" id="pui-new-dep" class="pui-input has-icon pui-icao-input" placeholder="KJFK" maxlength="4">
                                </div>
                            </div>
                            <div class="pui-input-group">
                                <label>Destination</label>
                                <div class="pui-input-wrapper">
                                    <i class="fa-solid fa-plane-arrival pui-input-icon"></i>
                                    <input type="text" id="pui-new-arr" class="pui-input has-icon pui-icao-input" placeholder="EGLL" maxlength="4">
                                </div>
                            </div>
                        </div>
                        <div class="pui-form-row">
                            <div class="pui-input-group">
                                <label>Dep Gate</label>
                                <div class="pui-input-with-action">
                                    <input type="text" id="pui-new-dep-gate" class="pui-input" placeholder="B24">
                                    <button type="button" class="pui-input-action-btn" data-gate-picker="dep" title="Pick gate on map">
                                        <i class="fa-solid fa-map-location-dot"></i>
                                    </button>
                                </div>
                            </div>
                            <div class="pui-input-group">
                                <label>Arr Gate</label>
                                <div class="pui-input-with-action">
                                    <input type="text" id="pui-new-arr-gate" class="pui-input" placeholder="501">
                                    <button type="button" class="pui-input-action-btn" data-gate-picker="arr" title="Pick gate on map">
                                        <i class="fa-solid fa-map-location-dot"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- ─── Schedule & Load ─── -->
                    <div class="pui-form-section">
                        <h4 class="pui-form-section-title">Schedule &amp; Load</h4>

                        <div class="pui-quick-schedule-row">
                            <span class="pui-quick-schedule-label">Departing</span>
                            <div class="pui-chip-group" role="radiogroup" aria-label="Quick schedule">
                                <button type="button" class="pui-chip" data-quick-min="0">Now</button>
                                <button type="button" class="pui-chip" data-quick-min="15">+15m</button>
                                <button type="button" class="pui-chip" data-quick-min="30">+30m</button>
                                <button type="button" class="pui-chip" data-quick-min="60">+1h</button>
                                <button type="button" class="pui-chip" data-quick-min="120">+2h</button>
                                <button type="button" class="pui-chip" data-quick-min="custom">Custom…</button>
                            </div>
                        </div>

                        <p class="pui-quick-schedule-hint" id="pui-quick-schedule-hint" aria-live="polite"></p>

                        <!-- Datetime input — only visible in Custom mode. -->
                        <!-- Always present in DOM so submit handler can read it. -->
                        <div class="pui-form-row" id="pui-custom-time-row" style="display: none;">
                            <div class="pui-input-group" style="flex: 1;">
                                <label>Departure Time</label>
                                <input type="datetime-local" id="pui-new-time" class="pui-input">
                            </div>
                        </div>

                        <div class="pui-form-row">
                            <div class="pui-input-group">
                                <label>EET (minutes)</label>
                                <input type="number" id="pui-new-duration" class="pui-input" placeholder="Auto-calculated">
                            </div>
                            <div class="pui-input-group">
                                <label>POB (pax)</label>
                                <div class="pui-input-wrapper">
                                    <i class="fa-solid fa-users pui-input-icon"></i>
                                    <input type="number" id="pui-new-pax" class="pui-input has-icon" placeholder="212">
                                </div>
                            </div>
                        </div>
                        <div class="pui-form-row">
                            <div class="pui-input-group" style="flex: 1;">
                                <label>Block Fuel (lbs)</label>
                                <div class="pui-input-wrapper">
                                    <i class="fa-solid fa-gas-pump pui-input-icon"></i>
                                    <input type="number" id="pui-new-fuel" class="pui-input has-icon" placeholder="Auto-calculated">
                                </div>
                                <p class="pui-help-text">Planned from the route, the aircraft and the EET. Type your own figure and it is left alone.</p>
                                <div id="pui-load-plan"></div>
                            </div>
                        </div>
                    </div>

                    <div id="pui-add-flight-msg" class="pui-alert" style="display: none;"></div>

                    <div class="pui-form-actions-row" style="display: flex; gap: 10px; margin-top: 14px;">
                        <button class="pui-btn-ghost" id="pui-cancel-edit-btn" style="display: none; flex: 1;">Cancel</button>
                        <button class="pui-btn-primary" id="pui-submit-flight-btn" style="flex: 2; width: 100%;">
                            <i class="fa-solid fa-paper-plane"></i> File flight plan
                        </button>
                    </div>
                </div>
            </div>
        `;
    },

    // =====================================================================
    //  FEATURE — QUICK-SCHEDULE CHIPS
    // =====================================================================

    _attachQuickSchedule() {
        const chips = document.querySelectorAll('.pui-chip[data-quick-min]');
        chips.forEach(chip => {
            chip.addEventListener('click', () => {
                const val = chip.dataset.quickMin;
                if (val === 'custom') {
                    this._activateCustomMode();
                } else {
                    this._activateChip(parseInt(val, 10), chip);
                }
            });
        });

        // Default to "+15m" for fresh forms; jump straight to custom mode
        // when editing so the user sees their existing time.
        if (!this._host?._editingFlightId) {
            const defaultChip = document.querySelector('.pui-chip[data-quick-min="15"]');
            if (defaultChip) this._activateChip(15, defaultChip);
        }
    },

    _activateChip(minutes, chipEl) {
        this._activeChipMinutes = minutes;

        document.querySelectorAll('.pui-chip[data-quick-min]')
            .forEach(c => c.classList.remove('is-active'));
        chipEl?.classList.add('is-active');

        const customRow = document.getElementById('pui-custom-time-row');
        if (customRow) customRow.style.display = 'none';

        // Compute target time and write to #pui-new-time. Submit handler
        // reads .value from this same element, so it works whether the row
        // is visible or hidden.
        const target = new Date(Date.now() + minutes * 60_000);
        const iso    = this._toLocalISO(target);
        const timeInput = document.getElementById('pui-new-time');
        if (timeInput) timeInput.value = iso;

        this._updateChipHint(target, minutes);
    },

    _activateCustomMode(silent = false) {
        this._activeChipMinutes = null;
        document.querySelectorAll('.pui-chip[data-quick-min]')
            .forEach(c => c.classList.remove('is-active'));
        const customChip = document.querySelector('.pui-chip[data-quick-min="custom"]');
        customChip?.classList.add('is-active');

        const customRow = document.getElementById('pui-custom-time-row');
        if (customRow) customRow.style.display = '';

        const hint = document.getElementById('pui-quick-schedule-hint');
        if (hint) hint.textContent = silent ? '' : 'Pick any future date and time.';
    },

    _updateChipHint(date, minutes) {
        const hint = document.getElementById('pui-quick-schedule-hint');
        if (!hint) return;

        const tz = this._host?._timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const fmt = new Intl.DateTimeFormat(undefined, {
            hour: '2-digit', minute: '2-digit',
            weekday: minutes >= 60 ? 'short' : undefined,
            timeZone: tz,
        });
        const relative = minutes === 0 ? 'right now'
                       : minutes < 60  ? `in ${minutes} minutes`
                       : minutes === 60 ? 'in 1 hour'
                       : `in ${(minutes/60).toFixed(0)} hours`;
        hint.innerHTML = `<i class="fa-regular fa-clock"></i> Filing for <strong>${fmt.format(date)}</strong> — ${relative}`;
    },

    _toLocalISO(d) {
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },

    // =====================================================================
    //  FEATURE — GATE MAP PICKER
    // =====================================================================

    _attachGatePicker() {
        document.querySelectorAll('[data-gate-picker]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const which = btn.dataset.gatePicker; // 'dep' | 'arr'
                const icaoInputId = which === 'dep' ? 'pui-new-dep' : 'pui-new-arr';
                const targetId    = which === 'dep' ? 'pui-new-dep-gate' : 'pui-new-arr-gate';

                const icao = document.getElementById(icaoInputId)?.value.trim().toUpperCase();
                if (!icao || icao.length !== 4) {
                    this._toast(`Enter the ${which === 'dep' ? 'origin' : 'destination'} ICAO first.`, 'warn');
                    return;
                }

                btn.disabled = true;
                const originalIcon = btn.innerHTML;
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

                try {
                    const gates = await this._fetchAirportGates(icao);
                    if (!gates.length) {
                        this._toast(`No mapped gates found for ${icao}. Type the gate manually.`, 'info');
                        return;
                    }
                    await this._showGatePickerModal(icao, gates, targetId);
                } catch (err) {
                    console.error('[FlightDispatchUI] Gate fetch failed:', err);
                    this._toast('Could not load gate data for this airport.', 'error');
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = originalIcon;
                }
            });
        });
    },

    async _fetchAirportGates(icao) {
        if (this._gateCache.has(icao)) return this._gateCache.get(icao);

        // Reuse the host's airport cache; bootstrap if it isn't loaded yet.
        let cache = this._host?._airportCache;
        if (!cache) {
            const res = await fetch(AIRPORTS_DB_URL);
            cache = await res.json();
            if (this._host) this._host._airportCache = cache;
        }
        const apt = cache[icao];
        if (!apt) return [];

        return this._queryOverpassForGates(icao, apt.lat, apt.lon);
    },

async _queryOverpassForGates(icao, lat, lon) {
    // 7km radius — covers sprawling fields (KDFW, OMDB, KORD) where remote
    // hardstands sit well outside the terminal core.
    const radius = 7000;

    // Pull every flavor of parking spot OSM uses, as both nodes AND ways.
    // Some mappers tag stands/aprons as polygons; `out center` gives those
    // a representative lat/lon we can pin a marker on.
    // For aprons we require a ref or name — otherwise we'd drop a marker
    // on every nameless taxiway apron polygon.
    const query = `
        [out:json][timeout:25];
        (
          node["aeroway"="gate"](around:${radius},${lat},${lon});
          node["aeroway"="parking_position"](around:${radius},${lat},${lon});
          node["aeroway"="stand"](around:${radius},${lat},${lon});
          way["aeroway"="parking_position"](around:${radius},${lat},${lon});
          way["aeroway"="stand"](around:${radius},${lat},${lon});
          way["aeroway"="apron"]["ref"](around:${radius},${lat},${lon});
          way["aeroway"="apron"]["name"](around:${radius},${lat},${lon});
        );
        out center tags;
    `;

    const res = await fetch(OVERPASS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
    });
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    const data = await res.json();

    // Lower number = higher priority when two elements share a ref.
    // Fixes the "closer gate disappears" bug: previously dedupe was
    // order-dependent and often kept a farther parking_position node.
    const KIND_PRIORITY = { gate: 0, stand: 1, parking_position: 2, apron: 3 };

    const raw = (data.elements || [])
        .map(el => {
            const ref = el.tags?.ref || el.tags?.local_ref || el.tags?.name;
            if (!ref) return null;
            // Nodes carry lat/lon directly; ways carry it under .center
            const pLat = el.lat ?? el.center?.lat;
            const pLon = el.lon ?? el.center?.lon;
            if (pLat == null || pLon == null) return null;
            return { ref, lat: pLat, lon: pLon, kind: el.tags.aeroway };
        })
        .filter(Boolean);

    // Dedupe by ref, keeping the highest-priority kind.
    const byRef = new Map();
    for (const g of raw) {
        const existing = byRef.get(g.ref);
        if (!existing || KIND_PRIORITY[g.kind] < KIND_PRIORITY[existing.kind]) {
            byRef.set(g.ref, g);
        }
    }
    const gates = Array.from(byRef.values());

    this._gateCache.set(icao, gates);
    return gates;
},

    async _showGatePickerModal(icao, gates, targetInputId) {
        await this._ensureLeaflet();

        const overlay = document.createElement('div');
        overlay.className = 'pui-modal-overlay pui-fdu-modal';
        overlay.innerHTML = `
            <div class="pui-modal-card pui-fdu-gate-picker">
                <div class="pui-modal-header">
                    <div>
                        <h3><i class="fa-solid fa-map-location-dot"></i> Pick a gate · ${icao}</h3>
                        <p class="pui-modal-sub">${gates.length} gates mapped · click a marker or search</p>
                    </div>
                    <button class="pui-modal-close" aria-label="Close">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div class="pui-modal-body pui-fdu-gate-picker-body">
                    <div class="pui-gate-search-row">
                        <input type="text" id="pui-fdu-gate-search" class="pui-input" placeholder="Search gate (e.g. B24)…">
                    </div>
                    <div id="pui-fdu-gate-map" class="pui-gate-map"></div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        overlay.querySelector('.pui-modal-close')?.addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

        const L = window.L;
        const mapEl = overlay.querySelector('#pui-fdu-gate-map');

        const lats = gates.map(g => g.lat);
        const lons = gates.map(g => g.lon);
        const bounds = [
            [Math.min(...lats), Math.min(...lons)],
            [Math.max(...lats), Math.max(...lons)],
        ];

        const map = L.map(mapEl, { zoomControl: true, attributionControl: true });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap contributors',
        }).addTo(map);

        // Defer fitBounds until the modal has its final size
        requestAnimationFrame(() => map.fitBounds(bounds, { padding: [40, 40] }));

const labelFor = (g) => {
    if (g.kind === 'gate')  return `Gate ${g.ref}`;
    if (g.kind === 'apron') return `Apron ${g.ref}`;
    return `Stand ${g.ref}`; // parking_position + stand
};

const markers = gates.map(g => {
    const icon = L.divIcon({
        className: `pui-gate-marker pui-gate-marker-${g.kind}`,
        html: `<span>${g.ref}</span>`,
        iconSize: null,
    });
    const m = L.marker([g.lat, g.lon], { icon, gateRef: g.ref });
    m.bindTooltip(labelFor(g), { direction: 'top', offset: [0, -8] });
    m.on('click', () => {
        const target = document.getElementById(targetInputId);
        if (target) target.value = g.ref;
        this._toast(`${labelFor(g)} selected.`, 'success');
        close();
    });
    return m;
});
        const markerGroup = L.layerGroup(markers).addTo(map);

        const searchEl = overlay.querySelector('#pui-fdu-gate-search');
        searchEl.addEventListener('input', () => {
            const q = searchEl.value.trim().toUpperCase();
            markerGroup.clearLayers();
            const filtered = q
                ? markers.filter(m => m.options.gateRef.toUpperCase().includes(q))
                : markers;
            filtered.forEach(m => markerGroup.addLayer(m));

            if (filtered.length === 1) {
                map.setView(filtered[0].getLatLng(), 18);
            } else if (filtered.length) {
                const fb = L.latLngBounds(filtered.map(m => m.getLatLng()));
                map.fitBounds(fb, { padding: [40, 40] });
            }
        });

        setTimeout(() => searchEl.focus(), 50);
    },

    /** Lazy-load Leaflet from CDN. Idempotent. */
    async _ensureLeaflet() {
        if (this._leafletReady && window.L) return;

        if (!document.querySelector(`link[href="${LEAFLET_CSS_URL}"]`)) {
            const link = document.createElement('link');
            link.rel  = 'stylesheet';
            link.href = LEAFLET_CSS_URL;
            document.head.appendChild(link);
        }

        if (!window.L) {
            await new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = LEAFLET_JS_URL;
                s.onload  = resolve;
                s.onerror = () => reject(new Error('Failed to load Leaflet'));
                document.head.appendChild(s);
            });
        }
        this._leafletReady = true;
    },

    // =====================================================================
    //  EET AUTOCALC (ported from profileUI._autoCalculateRouteEET)
    // =====================================================================

    _attachEETAutocalc() {
        const depInput      = document.getElementById('pui-new-dep');
        const arrInput      = document.getElementById('pui-new-arr');
        const durationInput = document.getElementById('pui-new-duration');
        if (!depInput || !arrInput || !durationInput) return;

        const trigger = async () => {
            const dep = depInput.value.trim().toUpperCase();
            const arr = arrInput.value.trim().toUpperCase();

            if (dep.length === 4 && arr.length === 4 && !durationInput.value) {
                durationInput.placeholder = 'Calculating route...';
                durationInput.style.opacity = '0.5';

                const type = document.getElementById('pui-new-aircraft')?.value || '';
                const calc = await this._autoCalculateRouteEET(dep, arr, type);

                durationInput.style.opacity = '1';
                if (calc) {
                    durationInput.value = calc;
                    // The EET is what the fuel plan is a function of, so the
                    // moment it lands the load follows. Filing a time and then
                    // making the pilot press something to get the fuel would be
                    // the same half-finished form with an extra step.
                    this._recalculateLoad();
                    durationInput.style.transition = 'border-color 0.3s ease, box-shadow 0.3s ease';
                    durationInput.style.borderColor = 'var(--pui-pos)';
                    durationInput.style.boxShadow  = '0 0 0 3px var(--pui-pos-soft)';
                    setTimeout(() => {
                        durationInput.style.borderColor = '';
                        durationInput.style.boxShadow   = '';
                    }, 2000);
                } else {
                    durationInput.placeholder = 'Auto-calc failed, enter manually';
                }
            }
        };

        depInput.addEventListener('blur', trigger);
        arrInput.addEventListener('blur', trigger);
    },

    async _autoCalculateRouteEET(depIcao, arrIcao, type) {
        if (!depIcao || !arrIcao || depIcao.length !== 4 || arrIcao.length !== 4) return null;

        try {
            let cache = this._host?._airportCache;
            if (!cache) {
                const res = await fetch(AIRPORTS_DB_URL);
                if (!res.ok) throw new Error('Network error');
                cache = await res.json();
                if (this._host) this._host._airportCache = cache;
            }

            const origin = cache[depIcao.toUpperCase()];
            const dest   = cache[arrIcao.toUpperCase()];
            if (!origin || !dest) return null;

            // Haversine — earth radius in NM
            const toRad = v => v * Math.PI / 180;
            const R = 3440.065;
            const dLat = toRad(dest.lat - origin.lat);
            const dLon = toRad(dest.lon - origin.lon);
            const a = Math.sin(dLat / 2) ** 2 +
                      Math.cos(toRad(origin.lat)) * Math.cos(toRad(dest.lat)) *
                      Math.sin(dLon / 2) ** 2;
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            const distanceNM = R * c;

            // The type's own cruise TAS when we know it, 450kt otherwise, plus
            // 30 min for SID/STAR padding. A Q400 and an A350 flying the same
            // legs used to file the same time, which is wrong by well over an
            // hour on anything transcontinental.
            const cruiseKt = type ? this._perf(type).cruiseKt : 450;
            const cruiseHours = distanceNM / cruiseKt;
            return Math.round((cruiseHours * 60) + 30);
        } catch (e) {
            console.warn('[FlightDispatchUI] Auto-EET failed:', e);
            return null;
        }
    },

    // =====================================================================
    //  FUEL & PAYLOAD
    //
    //  The Block Fuel field shipped reading "(Future Update)" with the help
    //  text "Fuel telemetry will be fully integrated in an upcoming update",
    //  and the quick guide told pilots fuel calculations were coming soon. So
    //  the one number on this form nobody could reasonably work out in their
    //  head was the one the form declined to work out for them.
    //
    //  Everything needed was already here: the route gives distance, the type
    //  gives a burn rate and a cruise speed, and EET falls out of the two.
    // =====================================================================

    /** Performance for a type code, never null — see AIRCRAFT_PERFORMANCE. */
    _perf(type) {
        return AIRCRAFT_PERFORMANCE[String(type || '').toUpperCase()] || NARROWBODY;
    },

    /**
     * Burn in lbs/hour for a type code.
     *
     * Resolves the code to the name the selection list already carries, then
     * asks profileUI's existing table — the same one the lifetime ledger's
     * "est. fuel burned" is drawn from, so the two can never disagree. The
     * fallback exists only for a host that predates that method; it is
     * deliberately coarse, because a wrong-but-close number the pilot can see
     * beats a blank field, and anything better belongs in the shared table.
     */
    _burnLbPerHr(type) {
        const entry = AIRCRAFT_SELECTION_LIST.find(a => a.value === String(type || '').toUpperCase());
        const name = entry ? entry.name : String(type || '');
        const kg = typeof this._host?._fuelBurnKgPerHr === 'function'
            ? this._host._fuelBurnKgPerHr(name)
            : 2200;
        return Math.round(kg * KG_TO_LB);
    },

    /**
     * A fuel plan for a leg, broken into the parts a release is made of.
     *
     * Returned in pieces rather than as one total on purpose: a pilot who can
     * see that 9,200 lb of a 62,000 lb block is reserve can judge whether the
     * plan is sane. One opaque figure is one they either trust blindly or
     * ignore, and both of those are worse than arithmetic they can follow.
     */
    _planFuel(type, eetMinutes) {
        const burn = this._burnLbPerHr(type);
        const trip = Math.round(burn * (Math.max(0, Number(eetMinutes) || 0) / 60));
        const taxi = Math.round(burn * (TAXI_MIN / 60));
        const contingency = Math.round(trip * CONTINGENCY_PCT);
        const alternate = Math.round(burn * (ALTERNATE_MIN / 60));
        const reserve = Math.round(burn * (RESERVE_MIN / 60));
        return {
            burn, trip, taxi, contingency, alternate, reserve,
            block: taxi + trip + contingency + alternate + reserve,
        };
    },

    /** A sensible load for the type: seats, and 85% of them in the cabin. */
    _planPayload(type) {
        const seats = this._perf(type).seats;
        const pax = Math.round(seats * LOAD_FACTOR);
        return { seats, pax, payloadLb: pax * PAX_WEIGHT_LB };
    },

    /**
     * Fill EET, pax and block fuel from the route and the type.
     *
     * Never overwrites a number the pilot typed. Dispatch software that
     * recalculates over the top of a deliberate entry is dispatch software
     * people stop trusting — so a field with something in it is left alone,
     * and the breakdown underneath still updates so they can see how far off
     * the plan their figure is.
     */
    async _recalculateLoad({ force = false } = {}) {
        const type = document.getElementById('pui-new-aircraft')?.value || '';
        const dep = (document.getElementById('pui-new-dep')?.value || '').trim().toUpperCase();
        const arr = (document.getElementById('pui-new-arr')?.value || '').trim().toUpperCase();
        const durationInput = document.getElementById('pui-new-duration');
        const paxInput = document.getElementById('pui-new-pax');
        const fuelInput = document.getElementById('pui-new-fuel');
        if (!durationInput || !paxInput || !fuelInput) return;

        // EET first — the fuel plan is a function of it. Recomputed with the
        // type's own cruise speed when the route is known, which is why a Q400
        // and an A350 no longer file the same time for the same legs.
        let eet = Number(durationInput.value) || 0;
        if ((!eet || force) && dep.length === 4 && arr.length === 4) {
            const calc = await this._autoCalculateRouteEET(dep, arr, type);
            if (calc) { eet = calc; durationInput.value = calc; }
        }
        if (!eet) { this._renderLoadPlan(null); return; }

        const fuel = this._planFuel(type, eet);
        const load = this._planPayload(type);
        if (force || !paxInput.value) paxInput.value = load.pax;
        if (force || !fuelInput.value) fuelInput.value = fuel.block;
        this._renderLoadPlan({ type, eet, fuel, load });
    },

    /** The breakdown under the fuel field. Empty host when there is no plan. */
    _renderLoadPlan(plan) {
        const host = document.getElementById('pui-load-plan');
        if (!host) return;
        if (!plan) { host.innerHTML = ''; return; }

        const { fuel, load, eet } = plan;
        const lb = n => Number(n).toLocaleString();
        const hrs = Math.floor(eet / 60), mins = eet % 60;
        const line = (label, value, note) => `
            <div class="pui-load-line">
                <span>${label}${note ? ` <em>${note}</em>` : ''}</span>
                <b>${lb(value)}</b>
            </div>`;

        host.innerHTML = `
            <div class="pui-load-plan">
                <div class="pui-load-head">
                    <span><i class="fa-solid fa-calculator"></i> Planned load</span>
                    <button type="button" class="pui-load-redo" id="pui-load-redo"
                        title="Recalculate from the route and aircraft">Recalculate</button>
                </div>
                ${line('Taxi', fuel.taxi, `${TAXI_MIN} min`)}
                ${line('Trip', fuel.trip, `${hrs ? `${hrs}h ` : ''}${mins}m at ${lb(fuel.burn)} lb/hr`)}
                ${line('Contingency', fuel.contingency, `${Math.round(CONTINGENCY_PCT * 100)}% of trip`)}
                ${line('Alternate', fuel.alternate, `${ALTERNATE_MIN} min`)}
                ${line('Final reserve', fuel.reserve, `${RESERVE_MIN} min`)}
                <div class="pui-load-line pui-load-total"><span>Block fuel</span><b>${lb(fuel.block)} lb</b></div>
                <div class="pui-load-foot">
                    ${load.pax} of ${load.seats} seats · ${lb(load.payloadLb)} lb payload
                </div>
            </div>`;
    },

    /** Recalculate when the route, the type or the EET changes. */
    _attachLoadPlanner() {
        const ids = ['pui-new-dep', 'pui-new-arr', 'pui-new-duration'];
        ids.forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('blur', () => this._recalculateLoad());
        });
        const ac = document.getElementById('pui-new-aircraft');
        // A type change is the one edit that invalidates a figure already on
        // screen — the numbers were right for the aeroplane they are no longer
        // flying — so this is the one place we overwrite.
        if (ac) ac.addEventListener('change', () => this._recalculateLoad({ force: true }));

        const host = document.getElementById('pui-load-plan');
        if (host && !host.dataset.wired) {
            host.dataset.wired = '1';
            host.addEventListener('click', (ev) => {
                if (ev.target.closest('#pui-load-redo')) this._recalculateLoad({ force: true });
            });
        }
    },

    // =====================================================================
    //  EDIT / DELETE LISTENERS (ported from profileUI flight-plan block)
    // =====================================================================

    _attachEditDelete() {
        const list = document.querySelector('.pui-dispatch-list');
        if (!list) return;

        list.addEventListener('click', async (e) => {
            const editBtn   = e.target.closest('.pui-ticket-edit-btn');
            const deleteBtn = e.target.closest('.pui-ticket-delete-btn');

            if (editBtn) {
                const flightId = editBtn.dataset.id;
                const flight = this._host?._flightPlansData?.find(f => f.flight_id == flightId);
                if (!flight) return;
                this._enterEditMode(flight, flightId);
            }

            if (deleteBtn) {
                const flightId = deleteBtn.dataset.id;
                const flight = this._host?._flightPlansData?.find(f => f.flight_id == flightId);
                if (!flight) return;
                await this._handleDelete(flight, flightId, deleteBtn);
            }
        });
    },

    _enterEditMode(flight, flightId) {
        if (this._host) this._host._editingFlightId = flightId;

        const formTitle = document.getElementById('pui-dispatch-form-title');
        if (formTitle) formTitle.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> Edit dispatch`;

        const submitBtn = document.getElementById('pui-submit-flight-btn');
        if (submitBtn) submitBtn.innerHTML = `<i class="fa-solid fa-check"></i> Update flight plan`;

        const cancelBtn = document.getElementById('pui-cancel-edit-btn');
        if (cancelBtn) cancelBtn.style.display = 'block';

        // Populate
        const set = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val ?? '';
        };
        set('pui-new-callsign', flight.callsign);

        const acftSelect = document.getElementById('pui-new-aircraft');
        if (acftSelect) {
            acftSelect.value = Array.from(acftSelect.options).some(o => o.value === flight.aircraft_type)
                ? flight.aircraft_type
                : '';
        }

        set('pui-new-dep', flight.dep_icao);
        set('pui-new-arr', flight.arr_icao);
        set('pui-new-dep-gate', flight.dep_gate);
        set('pui-new-arr-gate', flight.arr_gate);

        if (flight.dep_time) {
            const dt = new Date(flight.dep_time);
            const formatted = this._toLocalISO(dt);
            set('pui-new-time', formatted);
        }

        set('pui-new-duration', flight.duration_minutes);
        set('pui-new-pax', flight.passengers);
        set('pui-new-fuel', flight.fuel_used);

        // Force chips into Custom mode so the user sees their existing time
        this._activateCustomMode(true);

        document.querySelector('.pui-dispatch-form')
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    /**
     * If the host re-renders mid-edit (e.g. flight list refreshed while
     * editing), make sure the form repopulates. Called from attachListeners.
     */
    _populateFormForEdit() {
        const editingId = this._host?._editingFlightId;
        if (!editingId) return;

        const flight = this._host?._flightPlansData?.find(f => f.flight_id == editingId);
        if (flight) this._enterEditMode(flight, editingId);
    },

    async _handleDelete(flight, flightId, deleteBtn) {
        // Prefer the host's premium confirmation modal if it exists,
        // fall back to native confirm().
        const isConfirmed = this._host?._showDeleteConfirmation
            ? await this._host._showDeleteConfirmation(flight)
            : window.confirm(`Delete flight ${flight.callsign} (${flight.dep_icao} → ${flight.arr_icao})?`);
        if (!isConfirmed) return;

        const ticketEl = deleteBtn.closest('.pui-ticket');
        if (ticketEl) {
            ticketEl.style.opacity = '0.5';
            ticketEl.style.pointerEvents = 'none';
        }

        try {
            const { error } = await this._host._supabase
                .from('user_flights')
                .delete()
                .eq('flight_id', flightId);
            if (error) throw error;

            this._showMessage('pui-add-flight-msg', 'Flight plan deleted.', 'success');

            if (this._host._editingFlightId === flightId) this.resetForm();
            this._host._fetchFlightPlans?.();
        } catch (err) {
            console.error('[FlightDispatchUI] Delete failed:', err);
            this._showMessage('pui-add-flight-msg', err.message || 'Error deleting flight plan.', 'error');
            if (ticketEl) {
                ticketEl.style.opacity = '1';
                ticketEl.style.pointerEvents = 'auto';
            }
        }
    },

    _attachCancelEdit() {
        document.getElementById('pui-cancel-edit-btn')
            ?.addEventListener('click', () => this.resetForm());
    },

    // =====================================================================
    //  HOST HELPER PASS-THROUGHS
    // =====================================================================

    _toast(msg, kind = 'info') {
        if (this._host?._showToast) this._host._showToast(msg, kind);
        else console.log(`[FlightDispatchUI:${kind}] ${msg}`);
    },

    _showMessage(id, msg, kind = 'info') {
        if (this._host?._showMessage) {
            this._host._showMessage(id, msg, kind);
        } else {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = msg;
                el.style.display = '';
            }
        }
    },

    // =====================================================================
    //  STYLES — appended once to <head>
    // =====================================================================

    injectStyles() {
        if (document.getElementById('pui-fdu-styles')) return;

        const css = `
            /* Fuel & payload breakdown — the arithmetic behind Block Fuel,
               shown so the figure is one the pilot can check rather than one
               they have to trust. */
            .pui-load-plan {
                margin-top: 10px; padding: 12px 14px;
                background: var(--pui-bg-surface);
                border: 1px solid var(--pui-border-light);
                border-radius: 10px;
                font-size: 0.82rem;
            }
            .pui-load-head {
                display: flex; align-items: center; justify-content: space-between;
                gap: 10px; margin-bottom: 8px;
                font-weight: 700; color: var(--pui-text-secondary);
                text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.72rem;
            }
            .pui-load-redo {
                font: inherit; text-transform: none; letter-spacing: 0;
                background: none; border: 1px solid var(--pui-border-light);
                color: var(--pui-text-secondary);
                border-radius: 999px; padding: 3px 10px; cursor: pointer;
            }
            .pui-load-redo:hover { border-color: var(--pui-accent); color: var(--pui-text-primary); }
            .pui-load-line {
                display: flex; align-items: baseline; justify-content: space-between;
                gap: 12px; padding: 3px 0;
                color: var(--pui-text-secondary);
            }
            .pui-load-line em {
                font-style: normal; color: var(--pui-text-tertiary); font-size: 0.92em;
            }
            .pui-load-line b { font-variant-numeric: tabular-nums; color: var(--pui-text-primary); }
            .pui-load-total {
                margin-top: 6px; padding-top: 8px;
                border-top: 1px solid var(--pui-border-light);
                font-weight: 700; color: var(--pui-text-primary);
            }
            .pui-load-foot {
                margin-top: 8px; color: var(--pui-text-tertiary); font-size: 0.78rem;
            }

            /* Quick-schedule chips */
            .pui-quick-schedule-row {
                display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
                margin-bottom: 8px;
            }
            .pui-quick-schedule-label {
                font-size: 0.85rem; color: var(--pui-text-secondary);
                font-weight: 600;
            }
            .pui-chip-group { display: flex; gap: 6px; flex-wrap: wrap; }
            .pui-chip {
                background: var(--pui-bg-surface);
                border: 1px solid var(--pui-border-light);
                color: var(--pui-text-secondary);
                font: inherit; font-size: 0.8rem; font-weight: 600;
                padding: 6px 12px; border-radius: 999px;
                cursor: pointer;
                transition: background-color var(--pui-d-fast, 0.15s) var(--pui-ease, ease),
                            border-color var(--pui-d-fast, 0.15s) var(--pui-ease, ease),
                            color var(--pui-d-fast, 0.15s) var(--pui-ease, ease);
            }
            .pui-chip:hover { border-color: var(--pui-accent); color: var(--pui-text-primary); }
            .pui-chip.is-active {
                background: var(--pui-accent);
                border-color: var(--pui-accent);
                color: #fff;
            }
            .pui-quick-schedule-hint {
                margin: 4px 0 14px;
                font-size: 0.82rem;
                color: var(--pui-text-secondary);
                display: flex; align-items: center; gap: 6px;
                min-height: 1.2em;
            }
            .pui-quick-schedule-hint strong { color: var(--pui-text-primary); }

            /* Input + inline action button (gate picker) */
            .pui-input-with-action {
                display: flex; gap: 6px; align-items: stretch;
            }
            .pui-input-with-action .pui-input { flex: 1; }
            .pui-input-action-btn {
                flex: 0 0 auto;
                width: 38px;
                background: var(--pui-bg-surface);
                border: 1px solid var(--pui-border-light);
                color: var(--pui-text-secondary);
                border-radius: 8px;
                cursor: pointer;
                display: inline-flex; align-items: center; justify-content: center;
                transition: background-color var(--pui-d-fast, 0.15s) var(--pui-ease, ease),
                            border-color var(--pui-d-fast, 0.15s) var(--pui-ease, ease),
                            color var(--pui-d-fast, 0.15s) var(--pui-ease, ease);
            }
            .pui-input-action-btn:hover:not(:disabled) {
                border-color: var(--pui-accent);
                color: var(--pui-accent);
                background: var(--pui-accent-soft, var(--pui-bg-surface));
            }
            .pui-input-action-btn:disabled { opacity: 0.5; cursor: not-allowed; }

            /* Modal scaffold */
            .pui-fdu-modal {
                position: fixed; inset: 0;
                background: rgba(0,0,0,0.5);
                z-index: 9999;
                display: flex; align-items: center; justify-content: center;
                padding: 20px;
                animation: pui-fdu-fade 0.18s ease;
            }
            @keyframes pui-fdu-fade { from { opacity: 0; } to { opacity: 1; } }
            .pui-modal-card {
                background: var(--pui-bg-elevated, var(--pui-bg-surface));
                border: 1px solid var(--pui-border-light);
                border-radius: 16px;
                box-shadow: 0 24px 80px rgba(0,0,0,0.35);
                width: 100%; max-width: 720px;
                max-height: 86vh;
                display: flex; flex-direction: column;
                overflow: hidden;
            }
            .pui-modal-header {
                display: flex; justify-content: space-between; align-items: flex-start;
                padding: 18px 22px;
                border-bottom: 1px solid var(--pui-border-light);
            }
            .pui-modal-header h3 {
                margin: 0; font-size: 1.05rem; font-weight: 700;
                color: var(--pui-text-primary);
                display: flex; align-items: center; gap: 8px;
            }
            .pui-modal-sub {
                margin: 4px 0 0; font-size: 0.82rem; color: var(--pui-text-secondary);
            }
            .pui-modal-close {
                background: transparent; border: none;
                color: var(--pui-text-secondary);
                cursor: pointer; padding: 6px; border-radius: 8px;
                font-size: 1rem;
                transition: background-color var(--pui-d-fast, 0.15s) var(--pui-ease, ease);
            }
            .pui-modal-close:hover { background: var(--pui-bg-surface); color: var(--pui-text-primary); }
            .pui-modal-body { flex: 1; overflow-y: auto; padding: 18px 22px; }

            /* Gate-picker map */
            .pui-fdu-gate-picker { max-width: 920px; }
            .pui-fdu-gate-picker-body { padding: 14px 18px; display: flex; flex-direction: column; gap: 12px; }
            .pui-gate-search-row .pui-input { width: 100%; }
            .pui-gate-map {
                width: 100%; height: 60vh;
                min-height: 360px;
                border-radius: 12px;
                border: 1px solid var(--pui-border-light);
                overflow: hidden;
                background: var(--pui-bg-surface);
            }
            .pui-gate-marker {
                background: var(--pui-accent);
                color: #fff;
                font-family: var(--pui-font-mono, ui-monospace, monospace);
                font-size: 0.7rem; font-weight: 700;
                padding: 3px 7px; border-radius: 6px;
                box-shadow: 0 2px 6px rgba(0,0,0,0.25);
                white-space: nowrap;
                border: 2px solid #fff;
                cursor: pointer;
                transition: transform 0.12s ease;
            }
            .pui-gate-marker:hover { transform: scale(1.15); z-index: 1000; }
        `;

        const style = document.createElement('style');
        style.id = 'pui-fdu-styles';
        style.textContent = css;
        document.head.appendChild(style);
    },
};
