import { MapAnimator } from './mapAnimator.js';

document.addEventListener('DOMContentLoaded', async () => {
    // --- Global Configuration ---
    const API_BASE_URL = 'https://site--indgo-backend--6dmjph8ltlhv.code.run';
    const LIVE_FLIGHTS_API_URL = 'https://site--acars-backend--6dmjph8ltlhv.code.run/flights';
    const ACARS_USER_API_URL = 'https://site--acars-backend--6dmjph8ltlhv.code.run/users'; // NEW: For user stats
    let currentServerName = localStorage.getItem('preferredServer') || 'Expert Server';
    const CURRENT_SITE_URL = window.location.origin;


    // --- State Variables ---
    let OWM_API_KEY = null;
    let isWeatherLayerAdded = false;
    let isCloudLayerAdded = false;   // NEW: For Clouds
    let isWindLayerAdded = false;    // NEW: For Wind
    let MAPBOX_ACCESS_TOKEN = null;
    let CURRENT_PILOT = null;
    let CURRENT_OFP_DATA = null;
    let airportsData = {};
    let runwaysData = {}; // NEW: To store runway data indexed by airport ICAO
    let currentMapFeatures = {}; // Key: flightId, Value: GeoJSON Feature
    const DATA_REFRESH_INTERVAL_MS = 50000; // Your current refresh interval
    const ACARS_SOCKET_URL = 'https://site--acars-backend--6dmjph8ltlhv.code.run'; // <-- NEW: For WebSocket
    let isAircraftWindowLoading = false;

    // --- [NEW] Map Style Constants & State ---
    const MAP_STYLE_DARK = 'mapbox://styles/mapbox/dark-v11';
    const MAP_STYLE_LIGHT = 'mapbox://styles/servernoob/cmg3wq7an002p01s17kbx7lqk';
    const MAP_STYLE_SATELLITE = 'mapbox://styles/mapbox/satellite-streets-v12';
    let currentMapStyle = MAP_STYLE_DARK; // Set the default

    // --- Map-related State ---
    let lastSocketUpdateTimestamp = 0; // NEW: Tracks the last valid flight data packet
    let liveTrailCache = new Map();
    const communityAircraftCache = new Map();
    const lookupQueue = new Map();
    let liveFlightsMap = null;
    let pilotMarkers = {};
    let liveFlightsInterval = null;
    let sectorOpsMap = null;
    let mapAnimator = null;
    let airportAndAtcMarkers = {}; // Holds all airport markers (blue dots and red ATC dots)
    let sectorOpsMapRouteLayers = [];
    let sectorOpsLiveFlightPathLayers = {}; // NEW: To track multiple flight trails
    let sectorOpsAtcNotamInterval = null; // <-- MODIFIED: Renamed from sectorOpsLiveFlightsInterval
    let sectorOpsSocket = null; // <-- NEW: Socket.IO client instance
    let activeAtcFacilities = []; // To store fetched ATC data
    let activeNotams = []; // To store fetched NOTAMs data
    let atcPopup = null; // To manage a single, shared popup instance
    // State for the airport info window
    let airportInfoWindow = null;
    let airportInfoWindowRecallBtn = null;
    let currentAirportInWindow = null;
    // NEW: State for the aircraft info window
    let aircraftInfoWindow = null;
    let weatherSettingsWindow = null; // <-- This was added in the last step
    let filterSettingsWindow = null; // <-- ADD THIS NEW VARIABLE
    let aircraftInfoWindowRecallBtn = null;
    let currentFlightInWindow = null; // Stores the flightId of the last selected aircraft
    let activePfdUpdateInterval = null; // Interval for updating the PFD display
    let activeGeocodeUpdateInterval = null; // NEW: Interval for reverse geocoding
    let activeWeatherUpdateInterval = null;
    let currentAircraftPositionForGeocode = null; // NEW: Stores the latest position
    let lastGeocodeCoords = { lat: 0, lon: 0 }; // NEW: Prevents redundant calls
    // --- FIX: Added roll_deg to state to prevent flickering ---
    let lastPfdState = { track_deg: 0, timestamp: 0, roll_deg: 0 };
    // --- NEW: To cache flight data when switching to stats view ---
    let cachedFlightDataForStatsView = { flightProps: null, plan: null };
    let mapFilters = {
        showVaOnly: false,
        showStaffOnly: false,
        hideAllAircraft: false,
        showAtcAirportsOnly: false,
        hideAtcMarkers: false,
        hideAllAirports: false,
        hideNoAtcMarkers: false,
        planDisplayMode: 'none',
        iconColorMode: 'default',
        showAircraftLabels: false,
        useSimpleFlightWindow: false,
        themeStartColor: '#18181b', // [UPDATED] Carbon/Zinc-900
        themeEndColor: '#18181b',   // [UPDATED] Carbon/Zinc-900
        themeOpacity: 90            // [UPDATED] Slightly more transparent (90%)
    };

    const departureHubs = []; // Empty array
    let ALL_AVAILABLE_ROUTES = []; // Empty array
    const DYNAMIC_FLEET = []; // Empty array
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

    /**
     * --- [NEW] Saves the current mapFilters state to local storage.
     */
    function saveFiltersToLocalStorage() {
        try {
            localStorage.setItem('mapFilters', JSON.stringify(mapFilters));
        } catch (e) {
            console.warn("Could not save filters to local storage.", e);
        }
    }

    /**
     * --- [NEW] Loads mapFilters from local storage and merges with defaults.
     */
    function loadFiltersFromLocalStorage() {
        const savedFilters = localStorage.getItem('mapFilters');
        if (savedFilters) {
            try {
                const parsedFilters = JSON.parse(savedFilters);
                // Merge saved filters with defaults to ensure new properties are not lost
                mapFilters = { ...mapFilters, ...parsedFilters };
                console.log("Loaded map filters from local storage.", mapFilters);
            } catch (e) {
                console.warn("Could not parse saved filters from local storage.", e);
                // On error, just use the defaults
            }
        }
    }

    async function fetchAndRenderRosters(hubIcao) {
        // This feature is disabled
        console.log("Roster feature is disabled.");
        return []; // Return empty array
    }

    /**
     * Helper Function: Renders the dispatch preview.
     * This is the 'populateDispatchPass' function that
     * SimbriefIntegration.js (sb.js) requires.
     */
    function populateDispatchPass(container, plan, options = {}) {
        // Clear previous content
        container.innerHTML = '';

        // --- Helper functions for formatting ---
        const formatEtd = (date) => {
            const d = new Date(date);
            return {
                time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }),
                date: d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
            };
        };
        
        const formatEet = (decimalHours) => {
            const hours = Math.floor(decimalHours);
            const minutes = Math.round((decimalHours % 1) * 60);
            return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        };

        // --- Format data for display ---
        const etd = formatEtd(plan.etd);
        const eetFormatted = formatEet(plan.eet);
        const cargoFormatted = (plan.cargo > 0) ? plan.cargo.toFixed(0) : '0';
        const cruiseSpeed = String(plan.cruiseSpeed).startsWith('M') ? plan.cruiseSpeed : `M${plan.cruiseSpeed}`;

        // --- Define reusable inline styles ---
        const sectionStyle = `padding: 16px 20px; border-bottom: 1px solid rgba(255, 255, 255, 0.1);`;
        const gridStyle = `display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 16px;`;
        const itemStyle = `display: flex; flex-direction: column; gap: 4px;`;
        const labelStyle = `font-size: 0.8rem; color: #9fa8da; text-transform: uppercase; font-weight: 600;`;
        const valueStyle = `font-size: 1.1rem; color: #fff; font-weight: 600;`;
        const headingStyle = `margin: 0 0 15px 0; color: #00a8ff; font-size: 1rem; font-weight: 600; display: flex; align-items: center; gap: 8px;`;
        const metarStyle = `display: block; width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.2); padding: 8px 10px; border-radius: 4px; font-family: monospace; color: #e0e0e0; font-size: 0.85rem; border: 1px solid rgba(255,255,255,0.1);`;

        // Build the HTML for the dispatch preview
        container.innerHTML = `
            <div class="info-panel-header" style="display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; background: rgba(10, 12, 26, 0.6); border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                <h3>Dispatch Preview</h3>
                <button id="dispatch-close-btn" class="sb-close-btn" title="Close Preview" style="background: none; border: none; color: #fff; font-size: 1.2rem; cursor: pointer;">
                    <i class="fa-solid fa-times"></i>
                </button>
            </div>
            <div class="dispatch-pass-body" style="padding: 0; color: #e8eaf6;">

                <div class="dispatch-section" style="${sectionStyle}">
                    <h4 style="${headingStyle}"><i class="fa-solid fa-plane"></i> Flight Details</h4>
                    <div class="dispatch-grid" style="${gridStyle} grid-template-columns: 1fr 1fr;">
                        <div class="dispatch-item" style="${itemStyle}">
                            <span style="${labelStyle}">Flight</span>
                            <span style="${valueStyle}">${plan.flightNumber}</span>
                        </div>
                        <div class="dispatch-item" style="${itemStyle}">
                            <span style="${labelStyle}">Aircraft</span>
                            <span style="${valueStyle}">${plan.aircraft}</span>
                        </div>
                        <div class="dispatch-item" style="${itemStyle}">
                            <span style="${labelStyle}">Departure</span>
                            <span style="${valueStyle}">${plan.departure}</span>
                        </div>
                        <div class="dispatch-item" style="${itemStyle}">
                            <span style="${labelStyle}">Arrival</span>
                            <span style="${valueStyle}">${plan.arrival}</span>
                        </div>
                        <div class="dispatch-item" style="${itemStyle}">
                            <span style="${labelStyle}">Alternate</span>
                            <span style="${valueStyle}">${plan.alternate || 'N/A'}</span>
                        </div>
                        <div class="dispatch-item" style="${itemStyle}">
                            <span style="${labelStyle}">Squawk</span>
                            <span style="${valueStyle}">${plan.squawkCode || '----'}</span>
                        </div>
                    </div>
                </div>

                <div class="dispatch-section" style="${sectionStyle}">
                    <h4 style="${headingStyle}"><i class="fa-solid fa-clock"></i> Performance & Time</h4>
                    <div class="dispatch-grid" style="${gridStyle}">
                        <div class="dispatch-item" style="${itemStyle}">
                            <span style="${labelStyle}">ETD (UTC)</span>
                            <span style="${valueStyle}">${etd.time}</span>
                        </div>
                        <div class="dispatch-item" style="${itemStyle}">
                            <span style="${labelStyle}">Date</span>
                            <span style="${valueStyle}">${etd.date}</span>
                        </div>
                        <div class="dispatch-item" style="${itemStyle}">
                            <span style="${labelStyle}">EET</span>
                            <span style="${valueStyle}">${eetFormatted}</span>
                        </div>
                        <div class="dispatch-item" style="${itemStyle}">
                            <span style="${labelStyle}">Cruise</span>
                            <span style="${valueStyle}">${plan.cruiseAltitude} ft / ${cruiseSpeed}</span>
                        </div>
                    </div>
                </div>

                <div class="dispatch-section" style="${sectionStyle}">
                    <h4 style="${headingStyle}"><i class="fa-solid fa-weight-hanging"></i> Weight & Fuel</h4>
                    <div class="dispatch-grid" style="${gridStyle}">
                        <div class="dispatch-item" style="${itemStyle}">
                            <span style="${labelStyle}">POB</span>
                            <span style="${valueStyle}">${plan.pob}</span>
                        </div>
                        <div class="dispatch-item" style="${itemStyle}">
                            <span style="${labelStyle}">Cargo (KG)</span>
                            <span style="${valueStyle}">${cargoFormatted}</span>
                        </div>
                        <div class="dispatch-item" style="${itemStyle}">
                            <span style="${labelStyle}">ZFW (KG)</span>
                            <span style="${valueStyle}">${plan.zfw}</span>
                        </div>
                        <div class="dispatch-item" style="${itemStyle}">
                            <span style="${labelStyle}">TOW (KG)</span>
                            <span style="${valueStyle}">${plan.tow}</span>
                        </div>
                        <div class="dispatch-item" style="${itemStyle} grid-column: 1 / -1;">
                            <span style="${labelStyle}">Block Fuel (KG)</span>
                            <span style="${valueStyle}">${plan.fuelTotal}</span>
                        </div>
                    </div>
                </div>

                <div class="dispatch-section" style="${sectionStyle}">
                    <h4 style="${headingStyle}"><i class="fa-solid fa-cloud-sun"></i> Weather</h4>
                    <div class="dispatch-item" style="${itemStyle} margin-bottom: 12px;">
                        <span style="${labelStyle}">Departure (${plan.departure})</span>
                        <code style="${metarStyle}">${plan.departureWeather.raw}</code>
                    </div>
                    <div class="dispatch-item" style="${itemStyle}">
                        <span style="${labelStyle}">Arrival (${plan.arrival})</span>
                        <code style="${metarStyle}">${plan.arrivalWeather.raw}</code>
                    </div>
                </div>
                
                <div class="dispatch-section" style="padding: 16px 20px; background: rgba(10, 12, 26, 0.6);">
                    <h4 style="${headingStyle}"><i class="fa-solid fa-route"></i> Full Route</h4>
                    <textarea readonly style="width: 100%; height: 100px; background: #1a1a1a; color: #fff; border: 1px solid #444; border-radius: 4px; font-family: monospace; padding: 8px; box-sizing: border-box;">${plan.route}</textarea>
                </div>
                
                ${options.isPreview ? `
                    <div class="dispatch-button-area" style="padding: 16px 20px; background: rgba(10, 12, 26, 0.6);">
                        <button id="save-from-simbrief-btn" class="sb-generate-btn" style="width: 100%; padding: 12px; background: #00a8ff; color: #fff; border: none; border-radius: 5px; cursor: pointer; font-size: 1rem; font-weight: 600;">
                            <i class="fa-solid fa-save"></i> Save This Flight Plan
                        </button>
                    </div>
                ` : ``}
            </div>
        `;
    }

    /**
 * Helper Function: Callback for when flights are saved/erased.
 * This is the 'onFlightSaved' callback for SimbriefIntegration.js.
 * --- MODIFIED: This function now re-renders the saved flight list. ---
 */
function refreshSavedFlightList() {
    console.log("SimbriefIntegration: onFlightSaved callback triggered!");
    // This new function will render the list in the UI
    renderSavedFlightList();
}

/**
 * --- [NEW FUNCTION] ---
 * Renders the list of saved flights from local storage into the UI.
 */
function renderSavedFlightList() {
    // Ensure SimbriefIntegration is available
    if (typeof SimbriefIntegration === 'undefined') {
        return;
    }

    const flights = SimbriefIntegration.getAllSavedFlights();
    
    const listContainer = document.getElementById('saved-flights-list');
    const noFlightsMsg = document.getElementById('no-saved-flights-msg');
    const deleteAllBtn = document.getElementById('saved-flights-delete-all-btn');

    if (!listContainer || !noFlightsMsg || !deleteAllBtn) {
        // The HTML for the panel hasn't loaded yet, or is missing.
        return;
    }

    // Clear the list first
    listContainer.innerHTML = '';

    if (flights.length === 0) {
        // Show "No flights" message
        noFlightsMsg.style.display = 'block';
        listContainer.style.display = 'none';
        deleteAllBtn.style.display = 'none';
    } else {
        // Hide "No flights" message and show list
        noFlightsMsg.style.display = 'none';
        listContainer.style.display = 'block';
        deleteAllBtn.style.display = 'block';

        // `getAllSavedFlights` returns flights oldest-to-newest.
        // We reverse it to show the newest flight on top.
        flights.reverse().forEach(flight => {
            const flightHtml = `
                <li class="saved-flight-item">
                    <div class="saved-flight-info">
                        <strong>
                            <i class="fa-solid fa-plane"></i>
                            ${flight.flightNumber || 'No Callsign'}
                        </strong>
                        <small>${flight.departure || '???'} &rarr; ${flight.arrival || '???'} (${flight.aircraft || 'A/C'})</small>
                    </div>
                    <div class="saved-flight-actions">
                        <button class="saved-flight-btn saved-flight-view-btn" data-flight-id="${flight.id}">
                            View
                        </button>
                        <button class="saved-flight-btn saved-flight-delete-btn" data-flight-id="${flight.id}" title="Delete this plan">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </li>
            `;
            listContainer.insertAdjacentHTML('beforeend', flightHtml);
        });
    }
}

/**
 * --- [NEW FUNCTION] ---
 * Handles all clicks for the saved flights list using event delegation.
 */
function handleSavedFlightListClick(e) {
    const viewBtn = e.target.closest('.saved-flight-view-btn');
    const deleteBtn = e.target.closest('.saved-flight-delete-btn');
    const deleteAllBtn = e.target.closest('#saved-flights-delete-all-btn');

    // 1. Handle "View" button click
    if (viewBtn) {
        e.preventDefault();
        const flightId = viewBtn.dataset.flightId;
        if (!flightId || typeof SimbriefIntegration === 'undefined') return;

        const flights = SimbriefIntegration.getAllSavedFlights();
        const flightToView = flights.find(f => f.id === flightId);

        if (flightToView) {
            // The dispatch pass renderer needs 'etd' and 'eta' as Date objects.
            // The saved payload has 'etd' as a string and only 'eet' (decimal hours).
            
            // Re-calculate ETA
            const etdDate = new Date(flightToView.etd);
            const eetMs = (flightToView.eet || 0) * 3600 * 1000;
            const etaDate = new Date(etdDate.getTime() + eetMs);

            // Get containers
            const dispatchDisplay = document.getElementById('dispatch-pass-display');
            const manualDispatchContainer = document.getElementById('manual-dispatch-container');

            if (!dispatchDisplay || !manualDispatchContainer) return;

            // Populate the dispatch pass
            // We create a new object to pass the correct Date objects
            populateDispatchPass(dispatchDisplay, {
                ...flightToView,
                etd: etdDate,
                eta: etaDate
            }, { isPreview: false }); // isPreview: false hides the "Save" button

            // Show the dispatch pass and hide the form
            manualDispatchContainer.style.display = 'none';
            dispatchDisplay.style.display = 'block';

            // Scroll the tab content to the top
            const tabContent = dispatchDisplay.closest('.tab-content');
            if (tabContent) {
                tabContent.scrollTop = 0;
            }
        }
        return; // End execution
    }

    // 2. Handle "Delete" (single) button click
    if (deleteBtn) {
        e.preventDefault();
        const flightId = deleteBtn.dataset.flightId;
        if (!flightId || typeof SimbriefIntegration === 'undefined') return;
        
        // Use native browser confirm dialog
        if (confirm("Are you sure you want to delete this flight plan?")) {
            const flights = SimbriefIntegration.getAllSavedFlights();
            const newFlights = flights.filter(f => f.id !== flightId);
            
            // Save the new array back to local storage
            // Note: sb.js doesn't have a "delete one" method, so we do it manually
            localStorage.setItem('communityTrackerFlights', JSON.stringify(newFlights));
            
            // Manually trigger the refresh
            refreshSavedFlightList();
            showNotification('Flight plan deleted.', 'success');
        }
        return; // End execution
    }

    // 3. Handle "Delete All" button click
    if (deleteAllBtn) {
        e.preventDefault();
        if (typeof SimbriefIntegration === 'undefined') return;

        // Use native browser confirm dialog
        if (confirm("Are you sure you want to delete ALL saved flight plans? This cannot be undone.")) {
            // This function from sb.js will delete the key
            // and automatically call our 'refreshSavedFlightList'
            // callback, which re-renders the (now empty) list.
            SimbriefIntegration.eraseAllSavedFlights();
        }
        return; // End execution
    }
}
    
    async function fetchAndRenderRoutes() {
        // This feature is disabled
        console.log("Route feature is disabled.");
        const routeContainer = document.getElementById('route-list-container');
        if (routeContainer) {
             routeContainer.innerHTML = '<p class="muted-text" style="padding: 2rem;">Route loading is disabled.</p>';
        }
        return []; // Return empty array
    }


    // --- Helper: Fetch API Keys from Netlify Function ---
    async function fetchApiKeys() {
        try {
            const response = await fetch(`${CURRENT_SITE_URL}/.netlify/functions/config`);
            if (!response.ok) throw new Error('Could not fetch server configuration.');
            
            const config = await response.json();
            
            if (!config.mapboxToken) throw new Error('Mapbox token is missing from server configuration.');
            if (!config.owmApiKey) throw new Error('OWM API key is missing from server configuration.');

            // Set Mapbox key
            MAPBOX_ACCESS_TOKEN = config.mapboxToken;
            mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;
            
            // Set OWM key
            OWM_API_KEY = config.owmApiKey;

        } catch (error) {
            console.error('Failed to initialize API keys:', error.message);
            showNotification('Could not load mapping or weather services.', 'error');
        }
    }

/**
 * Deciphers Infinite Flight ATIS text into a structured object.
 * Extracts Info letter, Time, Runways, Approaches, and Remarks.
 */
function parseAtis(text) {
    if (!text) return null;
    
    // 1. Info Letter (e.g., "Information ALPHA")
    const infoMatch = text.match(/information\s+([A-Z])/i);
    const info = infoMatch ? infoMatch[1].toUpperCase() : '?';

    // 2. Time (e.g., "0522 ZULU")
    const timeMatch = text.match(/(\d{4})\s*Z/i);
    const time = timeMatch ? timeMatch[1] + 'Z' : '--';

    // 3. Runways (e.g., "Landing Runway 31R", "Departing Runways 4L and 4R")
    // We capture the phrase after "Landing/Departing" then find all runway codes in it.
    const landingMatch = text.match(/Landing\s+([^,.]+)/i);
    const departingMatch = text.match(/Departing\s+([^,.]+)/i);
    
    const extractRwys = (str) => {
        if (!str) return '---';
        const matches = str.match(/\d{2}[LRC]?/g);
        return matches ? matches.join('/') : '---';
    };

    const landing = extractRwys(landingMatch ? landingMatch[1] : null);
    const departing = extractRwys(departingMatch ? departingMatch[1] : null);

    // 4. Approach (e.g., "expect ILS approach")
    const approachMatch = text.match(/expect\s+(.*?)\s+approach/i);
    let approach = approachMatch ? approachMatch[1].toUpperCase() : 'VISUAL';
    // Clean up common long words
    approach = approach.replace('VISUAL', 'VIS').replace('APPROACH', '');

    // 5. Remarks (e.g., "Remarks, no pattern work.")
    // Captures text after "Remarks" until the next period or major keyword.
    const remarksMatch = text.match(/Remarks[.,]\s*(.*?)(?=\.|Landing|Departing|Advise|$)/i);
    let remarks = remarksMatch ? remarksMatch[1].trim() : null;
    
    // Formatting cleanup
    if (remarks && remarks.toLowerCase().includes('no pattern work')) remarks = 'NO PATTERN WORK';

    return { info, time, landing, departing, approach, remarks };
}

async function createAirportInfoWindowHTML(icao) {
    // 1. Get Static Data
    const staticData = airportsData[icao] || {};
    
    // 2. Fetch Live Airport Details
    let liveData = null;
    try {
        const response = await fetch(`${ACARS_SOCKET_URL}/api/airport/${icao}`);
        if (response.ok) {
            const json = await response.json();
            if (json.ok && json.airport) liveData = json.airport;
        }
    } catch (e) { console.warn(`Could not fetch live data for ${icao}`, e); }

    // 3. Fetch Live Traffic & ATIS
    let inbounds = [];
    let outbounds = [];
    let rawAtisText = null; 
    let trafficFetchSuccess = false;

    try {
        const sessionsRes = await fetch(`${ACARS_SOCKET_URL}/if-sessions`);
        const sessionsData = await sessionsRes.json();
        const sessionId = getCurrentSessionId(sessionsData);

        if (sessionId) {
            const [statusRes, atisRes] = await Promise.all([
                fetch(`${ACARS_SOCKET_URL}/api/live/airport/${sessionId}/${icao}/status`),
                fetch(`${ACARS_SOCKET_URL}/api/live/airport/${sessionId}/${icao}/atis`)
            ]);

            if (statusRes.ok) {
                const statusJson = await statusRes.json();
                if (statusJson.ok && statusJson.status) {
                    inbounds = statusJson.status.inboundFlights || [];
                    outbounds = statusJson.status.outboundFlights || [];
                    trafficFetchSuccess = true;
                }
            }

            if (atisRes.ok) {
                const atisJson = await atisRes.json();
                if (atisJson.ok && atisJson.atis) {
                    rawAtisText = atisJson.atis;
                }
            }
        }
    } catch (e) { console.error("Error fetching live stats:", e); }

    // 4. Merge Data
    const airportName = liveData?.name || staticData.name || 'Unknown Airport';
    const city = liveData?.city || staticData.city;
    const state = liveData?.state || staticData.state;
    const cityState = [city, state].filter(Boolean).join(', ') || 'Location N/A';
    const countryCode = (liveData?.country?.isoCode || staticData.country || '').toLowerCase();
    const flagSrc = countryCode ? `https://flagcdn.com/w40/${countryCode}.png` : '';
    const elevation = liveData?.elevation ?? staticData.elevation_ft ?? 0;
    const coords = { lat: liveData?.latitude ?? staticData.lat, lon: liveData?.longitude ?? staticData.lon };
    const badge3DHtml = liveData?.has3dBuildings ? `<span style="background: linear-gradient(135deg, #e2e8f0 0%, #94a3b8 100%); color: #0f172a; font-size: 0.65rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; margin-left: 10px;">3D</span>` : '';

    // Filter Derived Data
    const atcForAirport = activeAtcFacilities.filter(f => f.airportName === icao);
    const notamsForAirport = activeNotams.filter(n => n.airportIcao === icao);
    const airportRunways = runwaysData[icao] || [];

    // --- Weather & ATIS Logic ---
    let weatherModuleHtml = '';
    let atisModuleHtml = '';
    let metarString = '';
    let runwayRecHtml = ''; 
    
    try {
        if (window.WeatherService) {
            const w = await window.WeatherService.fetchAndParseMetar(icao);
            let flightCategory = 'VFR'; 
            let catColor = '#4ade80';
            if (w.raw.includes('LIFR')) { flightCategory = 'LIFR'; catColor = '#c084fc'; }
            else if (w.raw.includes('IFR') || w.raw.includes('VV')) { flightCategory = 'IFR'; catColor = '#f87171'; }
            else if (w.raw.includes('MVFR')) { flightCategory = 'MVFR'; catColor = '#60a5fa'; }
            metarString = w.raw;

            // --- BUILD ATIS DISPLAY ---
            if (rawAtisText) {
                // 1. DECIPHERED REAL ATIS
                const atis = parseAtis(rawAtisText);
                const infoPill = `<span style="color: #fbbf24; border: 1px solid #fbbf24; padding: 0 4px; border-radius: 3px; font-size: 0.6rem;">INFO ${atis.info}</span>`;
                
                // Remarks Footer (Only if remarks exist)
                const remarksHtml = atis.remarks ? 
                    `<div class="apt-mini-footer" title="${atis.remarks}"><i class="fa-solid fa-circle-info"></i> ${atis.remarks}</div>` : '';

                atisModuleHtml = `
                <div class="apt-mini-module">
                    <div class="apt-mini-header">
                        <span><i class="fa-solid fa-tower-broadcast"></i> ATIS</span>
                        ${infoPill}
                    </div>
                    <div class="apt-mini-body" style="padding-bottom: ${atis.remarks ? '0' : '10px'};">
                        <div class="stat-grid-compact">
                            <div class="compact-stat-box"><span class="compact-label">ARR RWY</span><span class="compact-value" style="color: #4ade80;">${atis.landing}</span></div>
                            <div class="compact-stat-box"><span class="compact-label">DEP RWY</span><span class="compact-value" style="color: #38bdf8;">${atis.departing}</span></div>
                            <div class="compact-stat-box"><span class="compact-label">APPR</span><span class="compact-value">${atis.approach}</span></div>
                            <div class="compact-stat-box"><span class="compact-label">TIME</span><span class="compact-value">${atis.time}</span></div>
                        </div>
                    </div>
                    ${remarksHtml}
                </div>`;

            } else {
                // 2. FALLBACK: ESTIMATED RUNWAYS (If ATIS Offline)
                const recs = getRunwayRecommendations(airportRunways, w.wind);
                const activeRunways = recs.slice(0, 2).map(r => r.ident).join('/');
                const activeHtml = activeRunways || '---';

                atisModuleHtml = `
                <div class="apt-mini-module">
                    <div class="apt-mini-header">
                        <span><i class="fa-solid fa-calculator"></i> EST. OPS</span>
                        <span style="color: #94a3b8; border: 1px solid #475569; padding: 0 4px; border-radius: 3px; font-size: 0.6rem;">NO ATIS</span>
                    </div>
                    <div class="apt-mini-body">
                        <div class="stat-grid-compact">
                            <div class="compact-stat-box"><span class="compact-label">EST ARR</span><span class="compact-value" style="color: #4ade80;">${activeHtml}</span></div>
                            <div class="compact-stat-box"><span class="compact-label">EST DEP</span><span class="compact-value" style="color: #38bdf8;">${activeHtml}</span></div>
                            <div class="compact-stat-box"><span class="compact-label">WIND</span><span class="compact-value">${w.wind}</span></div>
                            <div class="compact-stat-box"><span class="compact-label">STATUS</span><span class="compact-value">CALC</span></div>
                        </div>
                    </div>
                </div>`;
            }

            // Weather Module (Standard)
            weatherModuleHtml = `
            <div class="apt-mini-module">
                <div class="apt-mini-header">
                    <span><i class="fa-solid fa-cloud-sun"></i> METAR</span>
                    <span style="color: ${catColor}; border: 1px solid ${catColor}; padding: 0 4px; border-radius: 3px; font-size: 0.6rem;">${flightCategory}</span>
                </div>
                <div class="apt-mini-body">
                    <div class="stat-grid-compact">
                        <div class="compact-stat-box"><span class="compact-label">WIND</span><span class="compact-value" style="color: #38bdf8;">${w.wind}</span></div>
                        <div class="compact-stat-box"><span class="compact-label">VIS</span><span class="compact-value">${w.visibility || '10KM'}</span></div>
                        <div class="compact-stat-box"><span class="compact-label">TEMP</span><span class="compact-value" style="color: #fbbf24;">${w.temp}</span></div>
                        <div class="compact-stat-box"><span class="compact-label">QNH</span><span class="compact-value">${w.qnh || '1013'}</span></div>
                    </div>
                </div>
            </div>`;
            
            // Detailed Wind Analysis (Accordion) - Kept as extra info
            const recs = getRunwayRecommendations(airportRunways, w.wind);
            if (recs.length > 0) {
                runwayRecHtml = `
                <div class="tech-module" style="margin: 0 16px 8px 16px;">
                    <div class="tech-module-header runway-dropdown-header" id="runway-accordion-toggle">
                        <span class="tech-module-title"><i class="fa-solid fa-wind"></i> WIND ANALYSIS</span>
                        <i class="fa-solid fa-chevron-down runway-toggle-icon"></i>
                    </div>
                    <div class="tech-module-body runway-dropdown-content" id="runway-accordion-content" style="background: rgba(15, 23, 42, 0.4);">
                        ${recs.map(r => `
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                                <div><span style="font-weight: 700; color: #fff;">RWY ${r.ident}</span> <span style="font-size: 0.65rem; color: ${r.color === 'green' ? '#86efac' : r.color === 'orange' ? '#fcd34d' : '#fca5a5'}; margin-left: 6px;">${r.reason}</span></div>
                                <div style="font-size: 0.75rem; font-family: monospace; color: #94a3b8;"><i class="fa-solid ${r.headwind >= 0 ? 'fa-arrow-down' : 'fa-arrow-up'}"></i> ${Math.abs(r.headwind)}kt</div>
                            </div>
                        `).join('')}
                    </div>
                </div>`;
            }

        } else {
            weatherModuleHtml = `<div class="apt-mini-module"><div class="apt-mini-body"><p class="muted-text">Weather Unavailable</p></div></div>`;
            atisModuleHtml = `<div class="apt-mini-module"><div class="apt-mini-body"><p class="muted-text">ATIS Offline</p></div></div>`;
        }
    } catch (err) { 
        weatherModuleHtml = `<div class="apt-mini-module"><div class="apt-mini-body"><p class="muted-text">Offline</p></div></div>`; 
        atisModuleHtml = `<div class="apt-mini-module"><div class="apt-mini-body"><p class="muted-text">Offline</p></div></div>`;
    }

    // --- Feature Strip ---
    let featureStripHtml = '';
    if (liveData) {
        const features = [
            { key: 'hasJetbridges', label: 'Jetbridges', icon: 'fa-person-walking-luggage' },
            { key: 'hasSafedockUnits', label: 'Safedock', icon: 'fa-square-parking' },
            { key: 'hasTaxiwayRouting', label: 'Drag & Taxi', icon: 'fa-route' }
        ];
        const aptClass = liveData.class ? `Class ${liveData.class}` : 'N/A';
        const timezone = liveData.timezone ? liveData.timezone.split(' ')[0] : 'UTC';
        featureStripHtml = `
            <div class="apt-quick-info-strip">
                <div class="apt-feature-pill"><i class="fa-solid fa-earth-americas"></i> ${timezone}</div>
                <div class="apt-feature-pill"><i class="fa-solid fa-ranking-star"></i> ${aptClass}</div>
                ${features.map(f => liveData[f.key] ? `<div class="apt-feature-pill" style="color: #cbd5e1; border-color: rgba(74, 222, 128, 0.3); background: rgba(74, 222, 128, 0.05);"><i class="fa-solid ${f.icon}" style="color: #4ade80;"></i> ${f.label}</div>` : '').join('')}
            </div>`;
    }

    // --- Tab Contents (Traffic, ATC, NOTAMs) ---
    const renderFlightCard = (fid, type) => {
        const f = currentMapFeatures[fid];
        let cs = 'Unknown', usr = 'Pilot', ac = '---', al = 'UNKNOWN';
        if (f && f.properties) {
            const p = f.properties; cs = p.callsign||cs; usr = p.username||usr;
            const acn = (typeof p.aircraft==='string'?JSON.parse(p.aircraft):p.aircraft)?.aircraftName||'';
            ac = acn.split(' ')[0].substring(0,4).toUpperCase();
            if(acn.includes('777')) ac='B777'; else if(acn.includes('320')) ac='A320';
            al = extractAirlineCode(cs);
        }
        const color = type === 'in' ? '#4ade80' : '#38bdf8';
        return `<div class="route-card" style="border-left: 3px solid ${color}; padding: 8px 12px;"><div class="route-info"><div class="route-callsign" style="font-size: 0.95rem;"><img src="Images/vas/${al}.png" style="height: 14px; width: auto; max-width: 30px;" onerror="this.style.display='none'"> ${cs}</div><div class="route-details" style="font-size: 0.7rem;"><span class="route-ac-badge" style="font-size: 0.65rem;">${ac}</span><span>${usr}</span></div></div><div style="font-size: 0.7rem; font-weight: bold; color: ${color};"><i class="fa-solid ${type==='in'?'fa-plane-arrival':'fa-plane-departure'}"></i></div></div>`;
    };

    let trafficHtml = (!trafficFetchSuccess) ? '<div style="padding: 20px; text-align: center; color: #64748b;">Data unavailable.</div>' :
        (inbounds.length===0 && outbounds.length===0) ? '<div style="padding: 20px; text-align: center; color: #64748b;">No live traffic.</div>' :
        `<div style="padding: 12px; display: flex; flex-direction: column; gap: 4px;">${inbounds.length>0 ? `<div style="margin-bottom:8px;"><div style="font-size:0.7rem;color:#94a3b8;font-weight:700;margin-bottom:4px;padding-left:4px;">INBOUND (${inbounds.length})</div>${inbounds.map(id=>renderFlightCard(id,'in')).join('')}</div>` : ''}${outbounds.length>0 ? `<div><div style="font-size:0.7rem;color:#94a3b8;font-weight:700;margin-bottom:4px;padding-left:4px;">OUTBOUND (${outbounds.length})</div>${outbounds.map(id=>renderFlightCard(id,'out')).join('')}</div>` : ''}</div>`;

    let atcHtml = atcForAirport.length === 0 ? '<div style="padding: 20px; text-align: center; color: #64748b;">No active frequencies.</div>' :
        `<div style="padding: 12px;">${atcForAirport.map(f => `<div class="atc-grid-card" style="padding: 8px;"><div style="display: flex; align-items: center; gap: 12px;"><span class="atc-type-badge ${f.type===1?'atc-type-twr':f.type===0?'atc-type-gnd':(f.type===4||f.type===5)?'atc-type-app':'atc-type-obs'}" style="width: 60px; font-size: 0.65rem;">${atcTypeToString(f.type)}</span><span class="atc-controller" style="font-size: 0.85rem;">${f.username||'Unknown'}</span></div><span class="atc-duration" style="font-size: 0.75rem;"><i class="fa-regular fa-clock"></i> ${formatAtcDuration(f.startTime)}</span></div>`).join('')}</div>`;

    let notamsHtml = notamsForAirport.length === 0 ? '<div style="padding: 20px; text-align: center; color: #64748b;">No active NOTAMs.</div>' :
        `<div style="padding: 12px; display: flex; flex-direction: column; gap: 8px;">${notamsForAirport.map(n => `<div style="background: rgba(234, 179, 8, 0.1); border-left: 3px solid #eab308; padding: 8px; border-radius: 4px; color: #fef08a; font-family: monospace; font-size: 0.75rem;"><i class="fa-solid fa-triangle-exclamation"></i> ${n.message}</div>`).join('')}</div>`;

    // --- Final Render ---
    return `
        <div class="airport-hero">
            <div class="hero-actions">
                <button id="airport-window-hide-btn" class="hero-btn" title="Hide Window"><i class="fa-solid fa-compress"></i></button>
                <button id="airport-window-close-btn" class="hero-btn" title="Close Window"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="apt-ident-group">
                <div class="apt-icao">${icao}${flagSrc ? `<img src="${flagSrc}" style="height: 24px; border-radius: 2px; margin-left: 10px;">` : ''}${badge3DHtml}</div>
                <div class="apt-name">${airportName}</div>
                <div style="font-size: 0.8rem; color: #64748b; margin-top: 2px;">${cityState}</div>
                <div style="margin-top: 8px; display: flex; gap: 8px;">
                     <span class="apt-meta-badge"><i class="fa-solid fa-location-crosshairs"></i> ${coords.lat?.toFixed(3)}, ${coords.lon?.toFixed(3)}</span>
                     <span class="apt-meta-badge"><i class="fa-solid fa-arrows-up-down"></i> ${elevation} ft</span>
                </div>
            </div>
            <i class="fa-solid fa-plane-departure" style="font-size: 6rem; color: rgba(255,255,255,0.03); position: absolute; right: -10px; bottom: -20px; transform: rotate(-15deg);"></i>
        </div>
        ${featureStripHtml}
        <div style="flex-grow: 1; overflow-y: auto; padding-top: 12px;">
            <div class="apt-dashboard-grid">
                ${weatherModuleHtml}
                ${atisModuleHtml} </div>
            ${metarString ? `<div class="metar-strip">${metarString}</div>` : ''}
            <div style="margin-top: 12px;">${runwayRecHtml}</div>
            <div class="tech-module" style="min-height: 300px; display: flex; flex-direction: column; margin: 0 16px 16px 16px; border: 1px solid rgba(255,255,255,0.05);">
                <div class="apt-tabs-header">
                    <button class="apt-tab-btn active" data-target="apt-traffic"><i class="fa-solid fa-plane-circle-check"></i> TRAFFIC</button>
                    <button class="apt-tab-btn" data-target="apt-atc"><i class="fa-solid fa-headset"></i> ATC</button>
                    <button class="apt-tab-btn" data-target="apt-notams"><i class="fa-solid fa-triangle-exclamation"></i> NOTAMs</button>
                </div>
                <div id="apt-traffic" class="apt-tab-content active" style="padding: 0;">${trafficHtml}</div>
                <div id="apt-atc" class="apt-tab-content" style="padding: 0;">${atcHtml}</div>
                <div id="apt-notams" class="apt-tab-content" style="padding: 0;">${notamsHtml}</div>
            </div>
        </div>
    `;
}

/**
 * --- [REPLACED] Traffic UI Module ---
 * Renders the Delay Index bar and stats matching your theme.
 */
function generateTrafficForecastHTML(congestion) {
    if (!congestion) return `<div class="apt-mini-module"><div class="apt-mini-body" style="padding:10px; text-align:center;">No Traffic Data</div></div>`;

    // Convert 0.0-1.0 score to percentage for the bar width
    const percent = Math.min(congestion.score * 100, 100);
    
    return `
    <div class="apt-mini-module">
        <div class="apt-mini-header">
            <span><i class="fa-solid fa-chart-line"></i> DELAY INDEX</span>
            <span style="color: ${congestion.color}; font-family: 'Consolas', monospace; font-size: 0.8rem;">
                ${congestion.scoreDisplay} / 5.0
            </span>
        </div>
        <div class="apt-mini-body">
            
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span style="font-size: 0.75rem; font-weight: 700; color: ${congestion.color};">${congestion.level}</span>
                <span style="font-size: 0.65rem; color: #94a3b8; text-transform: uppercase;">
                    <i class="fa-solid fa-arrow-trend-up"></i> ${congestion.trend}
                </span>
            </div>

            <div style="height: 6px; width: 100%; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden; margin-bottom: 10px;">
                <div style="width: ${percent}%; height: 100%; background-color: ${congestion.color}; transition: width 0.5s ease;"></div>
            </div>

            <div class="stat-grid-compact" style="grid-template-columns: 1fr 1fr 1fr;">
                <div class="compact-stat-box">
                    <span class="compact-label">ARRIVALS</span>
                    <span class="compact-value" style="color: #38bdf8;">${congestion.stats.inbound}</span>
                </div>
                <div class="compact-stat-box">
                    <span class="compact-label">GROUND</span>
                    <span class="compact-value">${congestion.stats.ground}</span>
                </div>
                <div class="compact-stat-box">
                    <span class="compact-label">HOLDING</span>
                    <span class="compact-value" style="color: ${congestion.stats.holding > 0 ? '#ef4444' : '#e2e8f0'};">${congestion.stats.holding}</span>
                </div>
            </div>

        </div>
    </div>
    `;
}

/**
 * --- [NEW] Generates the HTML for the Traffic Forecast Module ---
 */
function generateTrafficForecastHTML(congestion) {
    // Calculate percentages for the flow bar
    const total = congestion.imminent + congestion.approach + congestion.enroute;
    const pImm = total > 0 ? (congestion.imminent / total) * 100 : 0;
    const pApp = total > 0 ? (congestion.approach / total) * 100 : 0;
    const pEnr = total > 0 ? (congestion.enroute / total) * 100 : 0;

    return `
    <div class="tech-module" style="margin-bottom: 8px;">
        <div class="tech-module-header">
            <span class="tech-module-title"><i class="fa-solid fa-chart-pie"></i> TRAFFIC FORECAST</span>
            <span class="tech-badge" style="background: rgba(255,255,255,0.05); color: ${congestion.color}; border-color: ${congestion.color};">
                ${congestion.level}
            </span>
        </div>
        <div class="tech-module-body" style="padding: 12px;">
            
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <div style="text-align: center; flex: 1;">
                    <div style="font-size: 1.2rem; font-weight: 700; color: #fff;">${congestion.imminent}</div>
                    <div style="font-size: 0.6rem; color: #ef4444; font-weight: 600; text-transform: uppercase;">Final (< 12m)</div>
                </div>
                <div style="text-align: center; flex: 1; border-left: 1px solid rgba(255,255,255,0.1); border-right: 1px solid rgba(255,255,255,0.1);">
                    <div style="font-size: 1.2rem; font-weight: 700; color: #fff;">${congestion.approach}</div>
                    <div style="font-size: 0.6rem; color: #f59e0b; font-weight: 600; text-transform: uppercase;">Appr (12-25m)</div>
                </div>
                <div style="text-align: center; flex: 1;">
                    <div style="font-size: 1.2rem; font-weight: 700; color: #fff;">${congestion.enroute}</div>
                    <div style="font-size: 0.6rem; color: #38bdf8; font-weight: 600; text-transform: uppercase;">Enroute (25m+)</div>
                </div>
            </div>

            <div style="height: 6px; width: 100%; background: #1e293b; border-radius: 3px; display: flex; overflow: hidden; margin-top: 10px;">
                <div style="width: ${pImm}%; background: #ef4444;"></div>
                <div style="width: ${pApp}%; background: #f59e0b;"></div>
                <div style="width: ${pEnr}%; background: #38bdf8;"></div>
            </div>
            
            <div style="margin-top: 8px; font-size: 0.75rem; color: #94a3b8; text-align: center; font-style: italic;">
                <i class="fa-solid fa-arrow-trend-up"></i> Status: <span style="color: #e2e8f0; font-weight: 600;">${congestion.trend}</span>
                ${congestion.avgHoldTime > 0 ? `<span style="margin-left: 8px; color: #ef4444;">(Est. Delay: ~${congestion.avgHoldTime}m)</span>` : ''}
            </div>

        </div>
    </div>
    `;
}

/**
     * --- [NEW] Helper to find the session ID for the currently selected server ---
     */
    function getCurrentSessionId(sessionsData) {
        if (!sessionsData || !Array.isArray(sessionsData.sessions)) return null;
        
        const targetName = currentServerName.toLowerCase();
        
        // 1. Try Exact Match
        let session = sessionsData.sessions.find(s => s.name.toLowerCase() === targetName);
        
        // 2. Try Fuzzy Match (e.g. "Expert" matching "Expert Server")
        if (!session) {
            session = sessionsData.sessions.find(s => s.name.toLowerCase().includes(targetName.split(' ')[0]));
        }
        
        return session ? session.id : null;
    }

    function switchServer(newServerName) {
        if (newServerName === currentServerName) return;

        console.log(`Switching server from ${currentServerName} to ${newServerName}...`);
        
        // 1. Update State & Storage
        currentServerName = newServerName;
        localStorage.setItem('preferredServer', currentServerName);

        // 2. Clear Live Aircraft Data (Visuals)
        
        // Remove pilot markers
        Object.keys(pilotMarkers).forEach(fid => {
            if (pilotMarkers[fid].marker) pilotMarkers[fid].marker.remove();
        });
        pilotMarkers = {};
        
        // Clear caches
        liveTrailCache.clear();
        
        // Clear feature object
        for (const key in currentMapFeatures) {
            delete currentMapFeatures[key];
        }
        
        // Flush MapAnimator
        if (mapAnimator && typeof mapAnimator._updateMapSource === 'function') {
            mapAnimator._updateMapSource(); 
        }
        
        // Close flight window if open
        if (currentFlightInWindow) {
            const closeBtn = document.querySelector('.aircraft-window-close-btn');
            if (closeBtn) closeBtn.click();
        }

        // --- 3. ATC & AIRPORT MARKER RESET (The Fix) ---
        
        // A. Stop the polling interval immediately to prevent race conditions
        if (sectorOpsAtcNotamInterval) {
            clearInterval(sectorOpsAtcNotamInterval);
            sectorOpsAtcNotamInterval = null;
        }

        // B. Manually remove every existing airport marker from the map instance
        // This ensures visual removal of "old" red dots immediately.
        Object.values(airportAndAtcMarkers).forEach(obj => {
            if (obj && obj.marker) {
                obj.marker.remove();
            }
        });
        airportAndAtcMarkers = {}; // Reset the tracking object

        // C. Wipe the data arrays
        activeAtcFacilities = [];
        activeNotams = [];
        
        // D. Render the "Clean State"
        // Since activeAtcFacilities is empty, this draws only standard blue route dots (if configured)
        // and ensures no leftover red dots remain.
        renderAirportMarkers();

        // 4. UI Updates
        document.querySelectorAll('.server-btn').forEach(btn => {
            if (btn.dataset.server === currentServerName) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // 5. Show Notification
        showNotification(`Switching to ${currentServerName}...`, 'info');

        // 6. Socket Handshake (Join new room)
        if (sectorOpsSocket && sectorOpsSocket.connected) {
            sectorOpsSocket.emit('join_server_room', currentServerName);
        }

        // 7. Restart Data Polling
        // This fetches new data -> populates activeAtcFacilities -> calls renderAirportMarkers() again
        // to draw the *new* red dots for the selected server.
        updateSectorOpsSecondaryData();
        sectorOpsAtcNotamInterval = setInterval(updateSectorOpsSecondaryData, DATA_REFRESH_INTERVAL_MS);
    }

/**
 * --- [NEW] SMART RUNWAY LOGIC ---
 * Parses wind string (e.g. "360 @ 10KT") into numeric values.
 */
function parseWindString(windStr) {
    if (!windStr) return { dir: 0, spd: 0 };
    
    // Remove " @ " if present to standardize
    const cleanStr = windStr.replace(' @ ', '');
    
    // Handle "VRB" (Variable)
    if (cleanStr.startsWith('VRB')) {
        const spdMatch = cleanStr.match(/VRB(\d+)/);
        return { dir: -1, spd: spdMatch ? parseInt(spdMatch[1]) : 0 };
    }

    // Standard format (e.g. 36010KT or 360/10)
    const match = cleanStr.match(/(\d{3})\/?(\d+)(?:KT|MPS)?/);
    if (match) {
        return { dir: parseInt(match[1]), spd: parseInt(match[2]) };
    }
    
    return { dir: 0, spd: 0 };
}

/**
 * Calculates headwind/crosswind components and assigns a suitability score.
 */
function getRunwayRecommendations(runways, windStr) {
    if (!runways || runways.length === 0) return [];
    
    const wind = parseWindString(windStr);
    
    // Logic for Calm/Variable winds (< 5 kts)
    if (wind.spd < 5 || wind.dir === -1) {
        // Just return longest runways, marking them as "CALM / ANY"
        return runways.flatMap(r => [
            { ident: r.le_ident, score: 100, reason: 'CALM WIND', color: 'green', headwind: 0, crosswind: 0 },
            { ident: r.he_ident, score: 100, reason: 'CALM WIND', color: 'green', headwind: 0, crosswind: 0 }
        ]).sort((a, b) => a.ident.localeCompare(b.ident)).slice(0, 4);
    }

    const recommendations = [];

    runways.forEach(r => {
        // Check both ends (Low End and High End)
        [
            { ident: r.le_ident, heading: r.le_heading_degT },
            { ident: r.he_ident, heading: r.he_heading_degT }
        ].forEach(end => {
            if (end.heading == null) return;

            // --- PHYSICS CALCULATION ---
            // 1. Calculate angle difference (0-180)
            let angleDiff = Math.abs(end.heading - wind.dir);
            if (angleDiff > 180) angleDiff = 360 - angleDiff;
            
            // 2. Convert to Radians
            const rads = angleDiff * (Math.PI / 180);
            
            // 3. Components
            const headwind = Math.round(wind.spd * Math.cos(rads));
            const crosswind = Math.round(wind.spd * Math.sin(rads));

            // --- SCORING LOGIC ---
            let score = 100;
            let color = 'green';
            let reason = 'FAVORABLE';

            // Headwind is good (add to score), Tailwind is bad (subtract)
            score += headwind * 2; 

            // Tailwind Penalty
            if (headwind < -5) {
                score -= 200; // Heavy penalty for significant tailwind
                color = 'red';
                reason = 'TAILWIND';
            } else if (headwind < 0) {
                score -= 50; // Minor penalty for slight tailwind
                color = 'orange';
                reason = 'MARGINAL';
            }

            // Crosswind Penalty
            if (Math.abs(crosswind) > 20) {
                score -= 100;
                color = 'red';
                reason = 'X-WIND LIMIT';
            } else if (Math.abs(crosswind) > 12) {
                score -= 30;
                color = 'orange';
                reason = 'CROSSWIND';
            }

            recommendations.push({
                ident: end.ident,
                score: score,
                color: color,
                reason: reason,
                headwind: headwind,
                crosswind: Math.abs(crosswind)
            });
        });
    });

    // Sort by score (descending) and return top 4
    return recommendations.sort((a, b) => b.score - a.score).slice(0, 4);
}

/**
 * --- [FIXED] Helper to find the Simbrief aircraft <option> value
 * from a given aircraft name.
 * @param {string} aircraftName - The aircraft name (e.g., "Airbus A320-200" or "A320").
 * @returns {string|null} The matching value (e.g., "A320") or null.
 */
function findSimbriefAircraftValue(aircraftName) {
    if (!aircraftName || !AIRCRAFT_SELECTION_LIST) return null;
    
    const upperName = aircraftName.toUpperCase().trim();

    // --- [NEW FIX] Step 0: Create a specific mapping for known mismatches ---
    // This is the most reliable solution.
    // Key: The exact name from the Infinite Flight API (in uppercase).
    // Value: The "value" from your AIRCRAFT_SELECTION_LIST.
    const knownMismatches = {
        // --- Airbus ---
        "AIRBUS A318": "A318",
        "AIRBUS A319": "A319",
        "AIRBUS A320-200": "A320",
        "A320": "A320", // In case the API just sends "A320"
        "AIRBUS A320NEO": "A20N",
        "A320NEO": "A20N",
        "AIRBUS A321": "A321",
        "A321": "A321",
        "AIRBUS A321NEO": "A21N",
        "A321NEO": "A21N",
        "AIRBUS A330-300": "A333",
        "AIRBUS A330-900": "A339",
        "AIRBUS A340": "A346",
        "AIRBUS A350": "A359",
        "AIRBUS A380": "A388",
        
        // --- Boeing ---
        "BOEING 717-200": "B712",
        "BOEING 737-700": "B737",
        "BOEING 737-800": "B738",
        "B738": "B738", // In case the API just sends "B738"
        "BOEING 737-900": "B739",
        "BOEING 737 MAX 8": "B38M",
        "BOEING 747-200B": "B742",
        "BOEING 747-400": "B744",
        "BOEING 747-8": "B748",
        "BOEING 757-200": "B752",
        "BOEING 767-300ER": "B763",
        "BOEING 777-200ER": "B772",
        "BOEING 777-200LR": "B77L",
        "BOEING 777-300ER": "B77W",
        "BOEING 787-8": "B788",
        "BOEING 787-9": "B789",
        "BOEING 787-10": "B78X",

        // --- Others ---
        "CRJ-200": "CRJ2",
        "CRJ-700": "CRJ7",
        "CRJ-900": "CRJ9",
        "CRJ-1000": "CRJX",
        "DE HAVILLAND DASH 8 Q400": "DH8D",
        "E175": "E175",
        "E190": "E190",
        "DC-10": "DC10",
        "MD-11": "MD11"
        
        // --- Add more known mismatches here as you find them ---
        // "API NAME": "YOUR_VALUE",
    };

    // Try the new mismatch map first.
    if (knownMismatches[upperName]) {
        return knownMismatches[upperName];
    }
    
    // --- If not in the map, fallback to existing logic ---

    // 1. Try to match by "value" (e.g., "A320")
    let match = AIRCRAFT_SELECTION_LIST.find(ac => ac.value.toUpperCase() === upperName);
    if (match) return match.value;

    // 2. Try to match by "name" (e.g., "Airbus A320-200")
    match = AIRCRAFT_SELECTION_LIST.find(ac => ac.name.toUpperCase() === upperName);
    if (match) return match.value;
    
    // 3. Fallback: Try to find a "value" that is *included* in the name
    // (e.g., name is "Airbus A320neo", value is "A20N")
    match = AIRCRAFT_SELECTION_LIST.find(ac => upperName.includes(ac.value.toUpperCase()));
    if (match) return match.value;

    // 4. Fallback: Try to find a "name" that *includes* the given name
    // (e.g., name is "A320", list name is "Airbus A320-200")
     match = AIRCRAFT_SELECTION_LIST.find(ac => ac.name.toUpperCase().includes(upperName));
    if (match) return match.value;

    console.warn(`Could not find Simbrief match for aircraft: ${aircraftName}`);
    return null; // No match found
}


    /**
 * render the flight list on load.
 */
async function loadExternalPanelContent() {
    const panel = document.getElementById('sector-ops-floating-panel');
    if (!panel) {
        console.error('Could not find #sector-ops-floating-panel to inject content.');
        return;
    }

    // 1. Find and remove the old UI tabs
    const oldTabs = panel.querySelector('.panel-tabs');
    if (oldTabs) {
        oldTabs.remove();
    }

    // 2. Find the main content container (which we will REUSE)
    const mainContentContainer = panel.querySelector('.panel-content');
    if (!mainContentContainer) {
        console.error('Could not find .panel-content to inject content into.');
        return;
    }
    
    // 3. Clear this container and show a loading spinner
    mainContentContainer.innerHTML = '<div class="spinner-small" style="margin: 2rem auto;"></div>';

    // 4. [CRITICAL FIX] Modify the container to be scrollable
    // The original CSS in index.html has 'overflow: hidden', which we must override.
    mainContentContainer.style.overflow = 'auto'; 
    
    // 5. Fetch and inject the new content
    try {
        const response = await fetch('panel-content.html');
        if (!response.ok) {
            throw new Error(`Failed to fetch panel-content.html (Status: ${response.status})`);
        }
        const htmlContent = await response.text();
        
        // Inject the new content directly into the existing .panel-content div
        mainContentContainer.innerHTML = htmlContent;

        // ===================================================================
        // START: Logic from panel-tabs.js
        // We run this logic *after* mainContentContainer.innerHTML is set.
        // ===================================================================
        
        // Note: We query *inside* the mainContentContainer to be specific
        const tabButtons = mainContentContainer.querySelectorAll('.panel-tab-btn');
        const tabContents = mainContentContainer.querySelectorAll('.tab-content');

        // Function to switch to a specific tab
        function activateTab(tabId) {
            tabButtons.forEach(btn => {
                if (btn.dataset.tab === tabId) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });

            tabContents.forEach(content => {
                if (content.id === tabId) {
                    content.classList.add('active');
                } else {
                    content.classList.remove('active');
                }
            });
        }

        // Add click event listener to each tab button
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const tabId = button.dataset.tab;
                activateTab(tabId);
            });
        });

        // --- SimBrief Integration Logic ---
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('view') === 'view-flight-plan' || urlParams.has('ofp_id')) {
            activateTab('tab-flightplan');
        } else {
            // Show the default active tab (Welcome)
            // The 'active' class is already on the HTML, but this confirms it.
            activateTab('tab-welcome');
        }

        const aircraftSelect = mainContentContainer.querySelector('#fp-aircraft');
        
        if (aircraftSelect && AIRCRAFT_SELECTION_LIST.length > 0) {
            // Loop through the constant and create <option> elements
            AIRCRAFT_SELECTION_LIST.forEach(aircraft => {
                const option = document.createElement('option');
                option.value = aircraft.value; // e.g., "A320"
                option.textContent = aircraft.name; // e.g., "Airbus A320-200"
                aircraftSelect.appendChild(option);
            });
        } else {
            console.warn("Could not find #fp-aircraft select or AIRCRAFT_SELECTION_LIST is empty.");
        }

        // Check if SimbriefIntegration object (from sb.js) exists
        if (typeof SimbriefIntegration !== 'undefined') {
            
            // Initialize the module, passing in the helpers it needs
            SimbriefIntegration.init({
                // netlifySimbriefUrl is already set in sb.js

                // Pass the main showNotification function from flight.js
                showNotification: showNotification,

                // Pass the populateDispatchPass function we just added
                populateDispatchPass: populateDispatchPass,

                // Pass the onFlightSaved callback we just added
                onFlightSaved: refreshSavedFlightList,

                // (Optional) Max number of flights to save.
                maxFlights: 2
            });
            
            console.log("SimbriefIntegration module initialized successfully.");

            // --- [NEW CODE TO ADD START] ---
            
            // 1. Add the master click listener for the saved flights list
            // We attach it to mainContentContainer for event delegation
            mainContentContainer.addEventListener('click', handleSavedFlightListClick);

            // 2. Render the saved flights list on initial load
            renderSavedFlightList();

            // --- [NEW CODE TO ADD END] ---
            
        } else {
            console.error("SimbriefIntegration (sb.js) is not loaded. SimBrief features will not work.");
            // We can use the main notification function to tell the user
            showNotification("SimBrief integration script (sb.js) failed to load.", "error");
        }
        
    } catch (error) {
        console.error('Error loading external panel content:', error);
        mainContentContainer.innerHTML = `
            <div class="info-panel-content">
                <p class="error-text">Could not load panel content.</p>
            </div>
        `;
    }
}

    /**
     * --- [ENHANCED] Handles the search input event.
     * Searches Callsign, Username, Aircraft Type, Livery, and Altitude.
     */
    function handleSearchInput(searchText) {
        const dropdown = document.getElementById('search-results-dropdown');
        if (!dropdown) return;

        // Require at least 2 characters to start searching
        if (!searchText || searchText.length < 2) {
            dropdown.innerHTML = '';
            dropdown.style.display = 'none';
            return;
        }

        const upperSearchText = searchText.toUpperCase();
        const matches = [];

        // Search through the live flight data cache
        for (const flightId in currentMapFeatures) {
            try {
                const feature = currentMapFeatures[flightId];
                if (!feature || !feature.properties) continue;

                const props = feature.properties;
                
                // 1. Get Basic Strings
                const callsign = (props.callsign || '').toUpperCase();
                const username = (props.username || '').toUpperCase();
                
                // 2. Get Aircraft/Livery Data safely
                let acName = '';
                let livName = '';
                if (props.aircraft) {
                    const acObj = (typeof props.aircraft === 'string') ? JSON.parse(props.aircraft) : props.aircraft;
                    acName = (acObj.aircraftName || '').toUpperCase();
                    livName = (acObj.liveryName || '').toUpperCase();
                }

                // 3. Get Altitude as String
                const altStr = props.altitude ? Math.round(props.altitude).toString() : '';

                // 4. Perform Matching
                const isMatch = 
                    callsign.includes(upperSearchText) ||
                    username.includes(upperSearchText) ||
                    acName.includes(upperSearchText) ||
                    livName.includes(upperSearchText) ||
                    altStr.startsWith(upperSearchText); // Altitude usually searched by start (e.g. "350" for 35000)

                if (isMatch) {
                    matches.push(feature);
                }
            } catch (error) {
                console.error('Error searching feature:', error);
            }
        }
        
        // Sort results: Exact callsign matches first, then others
        matches.sort((a, b) => {
            const aCall = (a.properties.callsign || '').toUpperCase();
            const bCall = (b.properties.callsign || '').toUpperCase();
            const aExact = aCall === upperSearchText;
            const bExact = bCall === upperSearchText;
            if (aExact && !bExact) return -1;
            if (!aExact && bExact) return 1;
            return 0;
        });

        renderSearchResultsDropdown(matches);
    }


 /**
 * --- [RE-DONE] Renders detailed search results.
 * Manages the visibility and styling of the dropdown container.
 */
function renderSearchResultsDropdown(matches) {
    const dropdown = document.getElementById('search-results-dropdown');
    const searchBar = document.querySelector('#sector-ops-search-container .search-bar-container');
    
    if (!dropdown || !searchBar) return;

    // Clear previous content
    dropdown.innerHTML = '';

    if (matches.length === 0) {
        dropdown.innerHTML = `
            <div style="padding: 24px 16px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: #94a3b8; opacity: 0.8;">
                <i class="fa-solid fa-plane-slash" style="font-size: 1.2rem;"></i>
                <span style="font-size: 0.85rem; font-weight: 500;">No active flights found</span>
            </div>
        `;
        dropdown.style.display = 'block';
        searchBar.classList.add('has-results'); // Keep the merged look
        return;
    }

    // Render HTML
    dropdown.innerHTML = matches.slice(0, 15).map(feature => {
        const props = feature.properties;
        const coords = feature.geometry.coordinates;

        // Safe Data Parsing
        const acData = (typeof props.aircraft === 'string') ? JSON.parse(props.aircraft) : (props.aircraft || {});
        const acName = acData.aircraftName || 'Unknown';
        const livName = acData.liveryName || 'Generic';
        
        // Format Display Values
        const altDisplay = props.altitude ? Math.round(props.altitude).toLocaleString() : '0';
        const gsDisplay = props.speed ? Math.round(props.speed) : '0';
        
        // Shorten Aircraft Name
        let shortType = acName.split(' ')[0].substring(0,4).toUpperCase();
        if(acName.includes("777")) shortType = "B77W";
        else if(acName.includes("737")) shortType = "B737";
        else if(acName.includes("320")) shortType = "A320";
        else if(acName.includes("321")) shortType = "A321";
        else if(acName.includes("350")) shortType = "A350";
        else if(acName.includes("380")) shortType = "A380";
        else if(acName.includes("787")) shortType = "B787";
        else if(acName.includes("747")) shortType = "B747";
        else if(acName.includes("CRJ")) shortType = "CRJ";
        else if(acName.includes("Dash")) shortType = "DH8D";

        // Airline Logo Logic
        const words = livName.trim().split(/\s+/);
        let logoName = words.length > 1 && /[^a-zA-Z0-9]/.test(words[1]) ? words[0] : (words[0] + (words[1] ? ' ' + words[1] : ''));
        const sanitizedLogoName = logoName.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_');
        const logoPath = `Images/airline_logos/${sanitizedLogoName}.png`;

        // Escape quotes for data attributes
        const propsString = JSON.stringify(props).replace(/'/g, "&apos;").replace(/"/g, "&quot;");
        const coordsString = JSON.stringify(coords);

        return `
        <div class="search-result-item" 
             data-flight-id="${props.flightId}"
             data-coordinates='${coordsString}'
             data-properties='${propsString}'>
            
            <div class="search-result-img-box">
                <img src="${logoPath}" class="search-result-logo" onerror="this.style.display='none';this.parentElement.innerHTML='<i class=\'fa-solid fa-plane\' style=\'color:#52525b;\'></i>'">
            </div>

            <div class="search-result-info">
                <div class="search-main-text">
                    <span class="callsign-text">${props.callsign}</span>
                    <span class="search-badge-ac">${shortType}</span>
                </div>
                <div class="search-sub-text">
                    <span class="username-text">${props.username}</span>
                    <span class="separator">•</span>
                    <span class="livery-text">${livName}</span>
                </div>
            </div>

            <div class="search-result-stats">
                <div class="stat-row">
                    <span class="stat-val alt">${altDisplay}</span> <span class="stat-unit">ft</span>
                </div>
                <div class="stat-row">
                    <span class="stat-val gs">${gsDisplay}</span> <span class="stat-unit">kts</span>
                </div>
            </div>
        </div>
        `;
    }).join('');
    
    // Show Dropdown & Merge Corners
    dropdown.style.display = 'block';
    searchBar.classList.add('has-results');
}


    /**
     * --- [FIXED] Handles the click on a search result item.
     * Now reads all data directly from the clicked element's data attributes
     * *before* clearing the dropdown, fixing the race condition.
     * @param {HTMLElement} itemElement - The clicked <div> element.
     */
    function onSearchResultClick(itemElement) {
        // --- [START OF FIX] ---
        // 1. Get data directly from the element's dataset FIRST.
        // This must happen before we clear the dropdown, which destroys the element.
        let coordinates;
        let props;
        try {
            coordinates = JSON.parse(itemElement.dataset.coordinates);
            props = JSON.parse(itemElement.dataset.properties);
            
            if (!coordinates || !props || !props.flightId) {
                 throw new Error('Search item is missing required data.');
            }
        } catch (e) {
            console.error(`onSearchResultClick: Failed to parse data from clicked search item.`, e, itemElement.dataset);
            return; // Abort if data is bad
        }
        // --- [END OF FIX] ---

        // 2. Get UI elements
        const dropdown = document.getElementById('search-results-dropdown');
        const searchInput = document.getElementById('sector-ops-search-input');
        
        // 3. Hide dropdown and clear input NOW
        if (dropdown) dropdown.innerHTML = '';
        if (searchInput) {
            searchInput.value = '';
            searchInput.blur(); // Remove focus
        }
        
        // 4. Fly to the aircraft
        sectorOpsMap.flyTo({
            center: coordinates, // <-- Use data from element
            zoom: 9,
            essential: true
        });

        // 5. Open the info window
        let flightProps;

        // Safely parse the *nested* JSON strings (position, aircraft)
        try {
            flightProps = {
                ...props,
                position: props.position ? JSON.parse(props.position) : null,
                aircraft: props.aircraft ? JSON.parse(props.aircraft) : null
            };
        } catch (parseError) {
            console.error('onSearchResultClick: Failed to parse *nested* flight properties:', parseError, props);
            flightProps = { ...props }; // Fallback
        }
        
        // Check if parsing failed fatally
        if (!flightProps || !flightProps.position) {
            console.error('onSearchResultClick: Aborting, flight has no valid position data after parsing.');
            return;
        }
        
        fetch('https://site--acars-backend--6dmjph8ltlhv.code.run/if-sessions')
            .then(res => res.json())
            .then(data => {
                // [UPDATED] Use helper
                const sessionId = getCurrentSessionId(data);
                if (sessionId) {
                    handleAircraftClick(flightProps, sessionId);
                }
            });
    }

/**
 * --- [NEW FUNCTION] ---
 * Toggles the visibility of the aircraft label layer based on mapFilters.showAircraftLabels state.
 */
function updateAircraftLabelVisibility() {
    if (!sectorOpsMap || !sectorOpsMap.getLayer('sector-ops-live-flights-labels')) {
        return;
    }
    
    // Use setLayoutProperty to change the layer's visibility
    sectorOpsMap.setLayoutProperty(
        'sector-ops-live-flights-labels',
        'visibility',
        mapFilters.showAircraftLabels ? 'visible' : 'none'
    );
    
    console.log('Aircraft label visibility set to:', mapFilters.showAircraftLabels ? 'visible' : 'none');
}

/**
 * --- [UPDATED] "Pro Smooth" RainViewer Layer ---
 * Uses Source Clamping (maxzoom: 8) to force smooth interpolation
 * instead of pixelated blocks when zooming in.
 */
async function toggleWeatherLayer(show) {
    if (!sectorOpsMap) return;

    const SOURCE_ID = 'rainviewer-radar-source';
    const LAYER_ID = 'rainviewer-radar-layer';

    if (show && !isWeatherLayerAdded) {
        try {
            // 1. Fetch official configuration
            const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
            const data = await res.json();
            const host = data.host; 
            
            // Get the very latest frame
            const latestFrame = data.radar.past[data.radar.past.length - 1];
            const path = latestFrame.path;

            // --- SETTINGS ---
            // 512 = High DPI (Retina)
            // 4   = 'Titan' Color Scheme (Professional Aviation)
            // 1_1 = Smooth (1) + Snow (1)
            const tileUrl = `${host}${path}/512/{z}/{x}/{y}/4/1_1.png`;

            // 2. Add Source with "Clamped" Zoom
            sectorOpsMap.addSource(SOURCE_ID, {
                'type': 'raster',
                'tiles': [tileUrl],
                'tileSize': 512,
                
                // --- THE TRICK IS HERE ---
                // We tell Mapbox the server only has data up to zoom 8.
                // When you zoom past 8, Mapbox will stretch these tiles smoothly.
                'maxzoom': 8 
            });

            // 3. Add Layer
            sectorOpsMap.addLayer({
                'id': LAYER_ID,
                'type': 'raster',
                'source': SOURCE_ID,
                'paint': {
                    'raster-opacity': 0.65,       // Slightly transparent for modern look
                    'raster-resampling': 'linear', // FORCE smooth gradient scaling
                    'raster-fade-duration': 0
                }
            }, 'sector-ops-live-flights-layer'); // Draw underneath aircraft

            isWeatherLayerAdded = true;
            console.log(`Premium Smooth Radar layer added.`);

        } catch (error) {
            console.error("Failed to init weather layer:", error);
            showNotification('Could not load radar data.', 'error');
        }

    } else if (isWeatherLayerAdded) {
        const visibility = show ? 'visible' : 'none';
        if (sectorOpsMap.getLayer(LAYER_ID)) {
            sectorOpsMap.setLayoutProperty(LAYER_ID, 'visibility', visibility);
        }
    }
}

/**
 * --- [NEW] SIGMET Vector Layer (Volanta Style) ---
 * Fetches active aviation hazards (Turbulence, Icing, Convection).
 */
let isSigmetLayerAdded = false;

async function toggleSigmetLayer(show) {
    if (!sectorOpsMap) return;

    const SOURCE_ID = 'aviation-sigmet-source';
    const FILL_LAYER_ID = 'aviation-sigmet-fill';
    const LINE_LAYER_ID = 'aviation-sigmet-outline';

    if (show && !isSigmetLayerAdded) {
        try {
            // Fetch GeoJSON from NOAA Aviation Weather Center
            const response = await fetch('https://aviationweather.gov/api/data/isigmet?format=geojson');
            const geojson = await response.json();

            sectorOpsMap.addSource(SOURCE_ID, {
                'type': 'geojson',
                'data': geojson
            });

            // 1. Fill Layer (Transparent Colors)
            sectorOpsMap.addLayer({
                'id': FILL_LAYER_ID,
                'type': 'fill',
                'source': SOURCE_ID,
                'paint': {
                    'fill-color': [
                        'match',
                        ['get', 'hazard'],
                        'CONVECTIVE', '#ff0000', // Red for storms
                        'TURB', '#ffa500',       // Orange for turbulence
                        'ICING', '#00bfff',      // Blue for icing
                        '#888888'                // Fallback
                    ],
                    'fill-opacity': 0.20
                }
            }, 'sector-ops-live-flights-layer'); 

            // 2. Outline Layer (Solid Lines)
            sectorOpsMap.addLayer({
                'id': LINE_LAYER_ID,
                'type': 'line',
                'source': SOURCE_ID,
                'paint': {
                    'line-color': [
                        'match',
                        ['get', 'hazard'],
                        'CONVECTIVE', '#ff0000',
                        'TURB', '#ffa500',
                        'ICING', '#00bfff',
                        '#888888'
                    ],
                    'line-width': 1.5,
                    'line-opacity': 0.8
                }
            }, 'sector-ops-live-flights-layer');

            // 3. Click interaction for details
            sectorOpsMap.on('click', FILL_LAYER_ID, (e) => {
                const props = e.features[0].properties;
                new mapboxgl.Popup()
                    .setLngLat(e.lngLat)
                    .setHTML(`
                        <div style="color:#333; padding:5px;">
                            <strong>${props.hazard || 'SIGMET'}</strong><br>
                            <span style="font-size: 0.8em; color: #555;">${props.rawSigmet || 'No details'}</span>
                        </div>
                    `)
                    .addTo(sectorOpsMap);
            });

            isSigmetLayerAdded = true;
            console.log('SIGMET vector layer added.');

        } catch (error) {
            console.error('Failed to load SIGMETs:', error);
            // Fallback notification or silent fail
        }

    } else if (isSigmetLayerAdded) {
        const vis = show ? 'visible' : 'none';
        if (sectorOpsMap.getLayer(FILL_LAYER_ID)) sectorOpsMap.setLayoutProperty(FILL_LAYER_ID, 'visibility', vis);
        if (sectorOpsMap.getLayer(LINE_LAYER_ID)) sectorOpsMap.setLayoutProperty(LINE_LAYER_ID, 'visibility', vis);
    }
}
/**
     * --- [NEW] Applies all active map filters.
     * This function calls the specific sub-functions to update
     * aircraft layers and airport markers based on the mapFilters state.
     */
    function updateMapFilters() {
        if (!sectorOpsMap) return;

        // 1. Update Aircraft Filter (using Mapbox setFilter)
        updateAircraftLayerFilter();

        // 2. Update Aircraft Label Filter
        updateAircraftLabelVisibility();

        // 3. Update Airport Filter (by re-rendering markers)
        renderAirportMarkers();
        
        // 4. Update Toolbar Button States (Weather + Filters)
        updateToolbarButtonStates();
    }

    /**
     * --- [MODIFIED] Builds and applies a Mapbox filter expression to the live aircraft layer.
     * This function now ONLY applies the filter toggles (mapFilters state).
     * The search bar logic has been removed and moved to its own handler.
     */
    function updateAircraftLayerFilter() {
        if (!sectorOpsMap || !sectorOpsMap.getLayer('sector-ops-live-flights-layer')) return;

        let filter = ['all']; // Start with a base 'all' filter

        // --- 1. Apply Toggle Filters (from mapFilters state) ---
        if (mapFilters.hideAllAircraft) {
            // Use a filter that matches nothing
            filter = ['==', 'flightId', '']; 
            
            // Apply the filter and exit early
            sectorOpsMap.setFilter('sector-ops-live-flights-layer', filter);
            return; 

        } else if (mapFilters.showStaffOnly) {
            // Show only features where isStaff is true
            filter.push(['==', 'isStaff', true]);
        } else if (mapFilters.showVaOnly) {
            // Show only features where isVAMember is true
            filter.push(['==', 'isVAMember', true]);
        }
        
        // --- 2. [REMOVED] ---
        // The entire "Apply Search Filter" block has been deleted.
        // This function no longer reads from the search input.

        // --- 3. Apply the combined filter to the map ---
        sectorOpsMap.setFilter('sector-ops-live-flights-layer', filter);
    }

    /**
     * --- [RENAMED & MODIFIED] Updates the main toolbar buttons to show if any layers are active.
     * Now handles both Weather and Filter buttons.
     */
    function updateToolbarButtonStates() {
        // --- Weather Button (Existing) ---
        const openWeatherBtn = document.getElementById('open-weather-settings-btn');
        if (openWeatherBtn) {
            const precipToggle = document.getElementById('weather-toggle-precip');
            const cloudsToggle = document.getElementById('weather-toggle-clouds');
            const windToggle = document.getElementById('weather-toggle-wind');

            const isWeatherActive = (precipToggle && precipToggle.checked) ||
                                (cloudsToggle && cloudsToggle.checked) ||
                                (windToggle && windToggle.checked);

            openWeatherBtn.classList.toggle('active', isWeatherActive);
        }

        // --- [FIXED] Filter Button (Reads from state) ---
        const openFiltersBtn = document.getElementById('filters-settings-btn');
        if (openFiltersBtn) {
            // Check if any filter in mapFilters is true
            const isFilterActive = mapFilters.showVaOnly || 
                                   mapFilters.hideAtcMarkers || 
                                   mapFilters.hideNoAtcMarkers; // Use the state object
            openFiltersBtn.classList.toggle('active', isFilterActive);
        }
    }

/**
 * [FIXED & MODIFIED BY USER] Fetches reverse geocoded location and updates the UI.
 * The 20km distance-based check has been removed per user request
 * to rely solely on a time-based interval.
 */
async function fetchAndDisplayGeocode(lat, lon) {
    if (!lat || !lon) return;

    // [USER REQ] Distance check removed to force time-based updates.
    
    // 1. Store new coordinates (still useful, though not for distance check)
    lastGeocodeCoords = { lat, lon };
    
    // [FIX] Query all *before* the await to set loading state
    const initialElements = document.querySelectorAll('#ac-location');
    if (initialElements.length === 0) return;

    initialElements.forEach(el => {
        el.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; // Loading state
    });

    try {
        // 3. Call your new Netlify Function
        const response = await fetch(`${CURRENT_SITE_URL}/.netlify/functions/reverse-geocode?lat=${lat}&lon=${lon}`);

        // [CRITICAL FIX] Query all *after* the await to get the (potentially) new DOM structure
        const currentElements = document.querySelectorAll('#ac-location');

        if (response.ok) {
            const data = await response.json();
            currentElements.forEach(el => {
                el.textContent = data.location || 'Remote Area';
            });
        } else {
            // API returned an error (e.g., 404 for ocean)
            currentElements.forEach(el => {
                el.textContent = 'Ocean / Remote Area';
            });
        }
    } catch (error) {
        console.error("Geocode fetch error:", error);
        // [CRITICAL FIX] Query all *after* the await, even in the catch block
        const currentElements = document.querySelectorAll('#ac-location');
        currentElements.forEach(el => {
            el.textContent = 'N/A'; // Fetch failed
        });
    }
}


    // --- NEW: Fetch Runway Data ---
async function fetchRunwaysData() {
    try {
        // Make sure the path to your JSON file is correct
        const response = await fetch('runways.json'); 
        if (!response.ok) throw new Error('Could not load runway data.');
        const rawRunways = await response.json();

        // Re-structure data for easier lookup by airport ICAO
        runwaysData = rawRunways.reduce((acc, runway) => {
            const ident = runway.airport_ident;
            if (!acc[ident]) {
                acc[ident] = [];
            }
            acc[ident].push(runway);
            return acc;
        }, {});
        console.log(`Successfully loaded and indexed runway data for ${Object.keys(runwaysData).length} airports.`);
    } catch (error) {
        console.error('Failed to fetch runway data:', error);
        showNotification('Runway data not available; takeoff/landing detection may be limited.', 'error');
    }
}

/**
 * --- [NEW] Gets a simplified, "lite" flight phase based only on position data.
 * This is cheap to calculate and suitable for all-flight map labels.
 * @param {object} position - The flight's position object from the socket.
 * @returns {string} A simple phase string.
 */
function getLiteFlightPhase(position) {
    if (!position) return '';

    const vs = position.vs_fpm || 0;
    const altitude = position.alt_ft || 0;
    const gs = position.gs_kt || 0;

    // On Ground Check (simplified: under 1000ft, low groundspeed, low VS)
    if (altitude < 1000 && gs < 40 && Math.abs(vs) < 150) {
        return 'Ground';
    }
    
    // In-Air Checks
    if (vs > 350) {
        return 'Climb';
    }
    if (vs < -500) {
        return 'Descent';
    }
    if (altitude > 18000 && Math.abs(vs) < 500) {
        return 'Cruise';
    }
    
    return 'Enroute'; // Default for level flight, etc.
}

/**
     * --- [NEW] Master formatter for iframe data ---
     * This prepares the JSON payload for BOTH Simple and Standard windows.
     */
    function formatWindowPayload(flightProps, plan, routePoints, communityData) {
        if (!flightProps) return null;
        
        const pos = flightProps.position || {};
        const aircraft = (typeof flightProps.aircraft === 'string') ? JSON.parse(flightProps.aircraft) : (flightProps.aircraft || {});

        // 1. Basic Props
        const baseProps = {
            callsign: flightProps.callsign,
            username: flightProps.username,
            userId: flightProps.userId,
            aircraft: {
                aircraftName: aircraft.aircraftName,
                liveryName: aircraft.liveryName,
                registration: communityData?.tailNumber || aircraft.registration || 'N/A'
            },
            pilotState: flightProps.pilotState !== undefined ? flightProps.pilotState : 0,
            position: pos
        };

        // 2. Images
        const images = {
            url: communityData?.imageUrl || flightProps.communityImageUrl || '',
            credit: communityData?.contributorName || flightProps.contributorName || ''
        };

        // 3. Route & FMS Processing
        let originIcao = '---', destIcao = '---';
        let originTime = '--:--', eta = '--:--', progress = 0;
        let depCountry = '', arrCountry = '';
        let fmsList = [];
        let totalDistNM = 0;
        let distToDestNM = 0;
        let simbriefAc = null;

        if (plan && plan.flightPlanItems) {
            // A. SimBrief Code
            simbriefAc = findSimbriefAircraftValue(aircraft.aircraftName);

            // B. Origin/Dest
            originIcao = plan.origin?.icao || '---';
            destIcao = plan.destination?.icao || '---';
            if (airportsData[originIcao]) depCountry = airportsData[originIcao].country.toLowerCase();
            if (airportsData[destIcao]) arrCountry = airportsData[destIcao].country.toLowerCase();

            // C. Times (from History)
            if (routePoints && routePoints.length > 0) {
                 const startTime = new Date(routePoints[0].date).getTime();
                 originTime = new Date(startTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
            }

            // D. Calculate Distances & Progress
            const waypoints = flattenWaypointsFromPlan(plan.flightPlanItems);
            let cumDist = 0;
            for(let i=0; i<waypoints.length-1; i++) {
                cumDist += getDistanceKm(waypoints[i][1], waypoints[i][0], waypoints[i+1][1], waypoints[i+1][0]);
            }
            totalDistNM = cumDist / 1.852;

            if (totalDistNM > 0) {
                const lastWp = waypoints[waypoints.length-1];
                const remKm = getDistanceKm(pos.lat, pos.lon, lastWp[1], lastWp[0]);
                distToDestNM = remKm / 1.852;
                progress = Math.max(0, Math.min(100, (1 - (distToDestNM / totalDistNM)) * 100));
                
                // ETA
                if (pos.gs_kt > 50) {
                    const hrs = distToDestNM / pos.gs_kt;
                    const etaDate = new Date(Date.now() + hrs * 3600000);
                    eta = etaDate.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', timeZone:'UTC' });
                }
            }

            // E. Build FMS List for UI
            // This is simplified logic from the old `updateFmsLegsModule`
            let activeIdx = 0;
            let minD = Infinity;
            // Find active
            const flatObjs = getFlatWaypointObjects(plan.flightPlanItems);
            flatObjs.forEach((wp, i) => {
                if(!wp.location) return;
                const d = getDistanceKm(pos.lat, pos.lon, wp.location.latitude, wp.location.longitude);
                if(d < minD) { minD = d; activeIdx = i; }
            });

            // Process Header/Rows
            plan.flightPlanItems.forEach((item, idx) => {
                if(item.children && item.children.length > 0) {
                    // Header
                    let type = 'PROC'; let cls = '';
                    const id = item.identifier || item.name;
                    if(idx<=1) { type='SID'; cls='sid'; }
                    else if(/^[A-Z]\d{2}/.test(id)) { type='APPR'; cls='appr'; }
                    else { type='STAR'; cls='star'; }
                    
                    fmsList.push({ isHeader: true, type, typeClass: cls, ident: id });
                    
                    item.children.forEach(child => {
                       processWp(child);
                    });
                } else {
                    processWp(item);
                }
            });

            var globalIdx = 0;
            function processWp(wp) {
                if(!wp.location) return;
                const dist = getDistanceKm(pos.lat, pos.lon, wp.location.latitude, wp.location.longitude) / 1.852;
                const bearing = getBearing(pos.lat, pos.lon, wp.location.latitude, wp.location.longitude);
                
                const isActive = globalIdx === activeIdx;
                const isPassed = globalIdx < activeIdx;
                globalIdx++;

                fmsList.push({
                    ident: wp.identifier || wp.name,
                    crs: Math.round(bearing).toString().padStart(3,'0')+'°',
                    dist: dist.toFixed(1),
                    active: isActive,
                    passed: isPassed
                });
            }
        }

        // 4. TOD Calculation
        let tod = null;
        if(distToDestNM > 20 && pos.alt_ft > 5000) {
            const destElev = (plan?.destination?.elevation_ft) ? parseInt(plan.destination.elevation_ft) : 0;
            const altToLose = pos.alt_ft - destElev;
            const descDist = (altToLose / 1000) * 3;
            const distToTod = distToDestNM - descDist;
            
            let tStr = '--:--';
            if(pos.gs_kt > 50) {
                const min = (distToTod / pos.gs_kt) * 60;
                tStr = distToTod > 0 ? `${Math.floor(min)}:${Math.floor((min%1)*60).toString().padStart(2,'0')}` : 'NOW';
            }
            
            tod = {
                dist: distToTod,
                time: tStr,
                status: distToTod <= 0 ? 'DESCEND NOW' : 'CRUISING'
            };
        }

        // 5. Nearest Airport
        let nearest = null;
        let minAptDist = Infinity;
        // Simple search
        for(const k in airportsData) {
            const a = airportsData[k];
            if(Math.abs(a.lat - pos.lat) < 2) {
                 const d = getDistanceKm(pos.lat, pos.lon, a.lat, a.lon);
                 if(d < minAptDist) { minAptDist = d; nearest = { icao: k, dist: d/1.852 }; }
            }
        }

        // 6. VSD Data (Simplified Profile)
        let vsd = null;
        if(plan) {
            const flat = getFlatWaypointObjects(plan.flightPlanItems);
            let cum = 0;
            let lastLat=flat[0]?.location.latitude, lastLon=flat[0]?.location.longitude;
            const profile = flat.map(wp => {
                const d = getDistanceKm(lastLat, lastLon, wp.location.latitude, wp.location.longitude)/1.852;
                cum += d;
                lastLat = wp.location.latitude; lastLon = wp.location.longitude;
                return { name: wp.identifier, dist: cum, alt: wp.altitude || 0 };
            });
            vsd = { profile, totalDist: cum };
        }

        return {
            baseProps,
            images,
            telemetry: {
                pitch: 0, // IF API doesn't provide pitch, assume 0 or derive from VS/Speed if needed
                roll: 0, // IF API doesn't provide roll? Wait, mapAnimator calculates it?
                         // Actually the API sends `bank` sometimes, or we derive it.
                         // For now, we use 0 or MapAnimator's value if accessed. 
                         // *Correction*: API sends `heading`, `vs`, `gs`. No roll/pitch. 
                         // The PFD logic in the previous file DERIVED roll from turn rate. 
                         // The iframe PFD logic will need to do the same derivation based on Heading changes.
                heading: pos.heading_deg,
                altitude: pos.alt_ft,
                speed: pos.gs_kt, // IAS approx as GS
                groundSpeed: pos.gs_kt,
                verticalSpeed: pos.vs_fpm,
                windDir: flightProps.wind_dir,
                windSpd: flightProps.wind_spd_kts,
                oat: flightProps.oat_c
            },
            derived: {
                departureIcao: originIcao,
                arrivalIcao: destIcao,
                depCountry, arrCountry,
                originTime, eta,
                progress,
                progressAlongRouteNM: (progress/100)*totalDistNM, // Approx
                flightPhase: getFlightPhase(pos, progress),
                simbriefAircraft: simbriefAc,
                nearestAirport: nearest,
                tod: tod
            },
            fms: fmsList,
            vsd: vsd,
            seatSensor: flightProps.pilotState !== undefined ? flightProps.pilotState : 0,
            theme: {
                start: mapFilters.themeStartColor,
                end: mapFilters.themeEndColor
            }
        };
    }

/**
 * --- [NEW FIX] Fetches the airport database from airports.json
 * This function was missing, causing a 'ReferenceError'.
 */
async function fetchAirportsData() {
    try {
        const response = await fetch('airports.json'); // Assumes airports.json is in the same directory
        if (!response.ok) {
            throw new Error('Could not load airports.json database.');
        }
        
        const rawAirports = await response.json();

        // Check if the file is an array (which needs to be indexed)
        // or an object (which is already indexed)
        if (Array.isArray(rawAirports)) {
            // It's an array, so we must index it by ICAO
            airportsData = rawAirports.reduce((acc, airport) => {
                // Use 'icao' or 'ident' as the key, ensure it's uppercase
                const ikey = airport.icao || airport.ident; 
                if (ikey) {
                    acc[ikey.toUpperCase()] = airport;
                }
                return acc;
            }, {});
        } else {
            // It's already an object, just use it
            airportsData = rawAirports;
        }

        console.log(`Successfully loaded data for ${Object.keys(airportsData).length} airports.`);

    } catch (error) {
        console.error('Failed to fetch airport data:', error);
        // Use the showNotification function if it's available
        if (typeof showNotification === 'function') {
            showNotification('Airport database could not be loaded. Map may be incomplete.', 'error');
        }
    }
}
    /// --- Helper Functions ---

/**
     * --- [NEW] Helper function to update odometer-style text with a fade.
     * Uses a transitionend listener for a smooth update without chained setTimeouts.
     * @param {HTMLElement} el - The DOM element (span) to update.
     * @param {string} newValue - The new text content to display.
     */
    function updateOdometerDigit(el, newValue) {
        if (!el) return;
        
        const currentValue = el.textContent;
        
        if (currentValue !== newValue) {
            // 1. Fade out the old value
            el.style.opacity = 0;
            
            // 2. Listen for the fade-out to finish
            el.addEventListener('transitionend', function handler() {
                // 3. Once faded out, change the text
                el.textContent = newValue;
                
                // 4. Fade back in
                el.style.opacity = 1;
                
                // 5. Clean up the listener
                el.removeEventListener('transitionend', handler);
            }, { once: true });
        }
    }


function getAircraftCategory(aircraftName) {
    if (!aircraftName) return 'default';
    const name = aircraftName.toLowerCase();

    // Fighter / Military
    if (['f-16', 'f-18', 'f-22', 'f-35', 'f/a-18', 'a-10'].some(ac => name.includes(ac))) {
        return 'fighter';
    }

    // --- [NEW] Military Cargo ---
    if (['c-130', 'ac-130', 'hercules', 'c-17'].some(ac => name.includes(ac))) {
        return 'military';
    }

    // --- NEW: Jumbo Jets (Supers) ---
    // This check MUST come before the wide-body check.
    if (['a380', '747', 'vc-25'].some(ac => name.includes(ac))) {
        return 'jumbo';
    }

    // Wide-body Jets
    if (['a330', 'a340', 'a350', '767', '777', '787', 'dc-10', 'md-11'].some(ac => name.includes(ac))) {
        return 'widebody';
    }
    
    // Regional Jets (CRJs, Embraer, etc.)
    if (['crj', 'erj', 'dh8d', 'q400'].some(ac => name.includes(ac))) {
        return 'regional';
    }
    
    // --- [NEW] Split GA: Cessna ---
    if (['cessna', 'c172', 'c208', 'xcub', 'tbm', 'sr22'].some(ac => name.includes(ac))) {
        return 'cessna';
    }
    
    // Private / General Aviation (remaining)
    if (['citation', 'cirrus','challenger'].some(ac => name.includes(ac))) {
        return 'private';
    }

    // Narrow-body Jets
    if (['a318', 'a319', 'a320', 'a321', '717', '727', '737', '757', 'a220', 'e17', 'e19'].some(ac => name.includes(ac))) {
        return 'narrowbody';
    }
    
    return 'default';
}

/**
 * Determines Flight Rules (IFR/VFR) based on aircraft state, equipment, and flight plan.
 */
function determineFlightRules(flightProps, plan) {
    const altitude = flightProps.position.alt_ft;
    const vs = flightProps.position.vs_fpm;
    const category = flightProps.category; // 'jumbo', 'widebody', 'narrowbody', 'cessna', etc.
    const hasPlan = plan && plan.flightPlanItems && plan.flightPlanItems.length > 1;
    
    // --- 1. DEFINE STATES ---
    const IFR = { type: 'IFR', label: 'IFR', class: 'badge-ifr', icon: 'fa-cloud' };
    const VFR = { type: 'VFR', label: 'VFR', class: 'badge-vfr', icon: 'fa-sun' };
    const VFR_FPL = { type: 'VFR', label: 'VFR + FPL', class: 'badge-vfr', icon: 'fa-map' };
    
    // --- 2. GROUND LOGIC (Intent-Based) ---
    // Detect if on ground (low altitude, low speed)
    if (altitude < 2000 && flightProps.position.gs_kt < 50) {
        
        // Rule: Heavy Metal is always IFR
        if (['jumbo', 'widebody', 'fighter'].includes(category)) {
            return IFR;
        }

        // Rule: No Flight Plan = VFR (Pattern work or just spawned)
        if (!hasPlan) {
            return VFR;
        }

        // Rule: Check for Procedures (SIDs/STARs) in Plan
        // If plan has items that are NOT simple coords, likely IFR
        // (Simple heuristic: IFR plans usually have many waypoints)
        if (hasPlan && plan.flightPlanItems.length > 5) {
            return IFR;
        }

        // Rule: GA with Plan = VFR + FPL (Flight Following assumption)
        if (['cessna', 'general', 'private'].includes(category) && hasPlan) {
            return VFR_FPL;
        }

        // Default Ground for Airliners with Plan
        if (['narrowbody', 'regional'].includes(category) && hasPlan) {
            return IFR;
        }

        return VFR; // Fallback
    }

    // --- 3. IN-AIR LOGIC (Behavior-Based) ---

    // Rule: Class A Airspace (Hard limit)
    if (altitude > 18000) {
        return IFR;
    }

    // Rule: No Plan in Air = VFR
    if (!hasPlan) {
        return VFR;
    }

    // Rule: "Hemispheric Rule" (The modulo check)
    // Only apply if in relatively stable cruise (VS < 500)
    if (Math.abs(vs) < 500) {
        const remainder = altitude % 1000;
        
        // VFR is usually X,500 (remainder ~500)
        // Allow buffer of +/- 200ft (300 to 700)
        if (remainder > 300 && remainder < 700) {
            return VFR_FPL;
        }
        
        // IFR is usually X,000 (remainder near 0 or 1000)
        // (e.g. 0-200 or 800-1000)
        if (remainder < 200 || remainder > 800) {
            return IFR;
        }
    }

    // --- 4. CLIMB/DESCENT TRANSITION (Fallback) ---
    // If we are climbing/descending < 18k, fallback to Category
    if (['jumbo', 'widebody', 'narrowbody', 'regional'].includes(category)) {
        return IFR;
    }

    return VFR_FPL; // Default for GA in the air with a plan
}

/**
 * Fetches OAT and Wind data from OpenMeteo and stores it in the flight state.
 */
async function fetchAndDisplayWeather() {
    if (!currentAircraftPositionForGeocode) return;

    const lat = currentAircraftPositionForGeocode.lat;
    const lon = currentAircraftPositionForGeocode.lon;

    // Use OpenMeteo API endpoint (No API key required for this data)
    const OPENMETEO_URL = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,wind_direction_10m&forecast_days=1`;
    
    // Elements to update (optional, but good for debugging)
    const windDisplay = document.getElementById('wind-speed-display');

    try {
        // 1. Fetch data
        const response = await fetch(OPENMETEO_URL);
        if (!response.ok) throw new Error('OpenMeteo fetch failed.');
        
        const data = await response.json();
        const current = data.current;

        if (!current) throw new Error('Invalid OpenMeteo response.');

        // 2. Update the shared state object with new data
        // We use temperature_2m as OAT approximation (simplification)
        currentAircraftPositionForGeocode.oat_c = current.temperature_2m;
        currentAircraftPositionForGeocode.wind_dir = current.wind_direction_10m;
        
        // Convert m/s to knots (1 m/s ≈ 1.944 kts)
        currentAircraftPositionForGeocode.wind_spd_kts = Math.round(current.wind_speed_10m * 1.944);

        // 3. Update the Nav Display iframe *immediately* with new wind data
        const navIframe = document.getElementById('nav-display-frame');
        if (navIframe && navIframe.contentWindow) {
             navIframe.contentWindow.postMessage({
                windDir: currentAircraftPositionForGeocode.wind_dir,
                windSpd: currentAircraftPositionForGeocode.wind_spd_kts
            }, '*');
        }

        console.log(`Weather updated: OAT=${current.temperature_2m}C, Wind=${current.wind_direction_10m}° @ ${currentAircraftPositionForGeocode.wind_spd_kts}kts`);
        
    } catch (error) {
        console.error("Weather fetch error:", error);
        // Clear or set default values on error
        if (currentAircraftPositionForGeocode) {
            currentAircraftPositionForGeocode.oat_c = 15; // Default ISA temp
            currentAircraftPositionForGeocode.wind_dir = 0;
            currentAircraftPositionForGeocode.wind_spd_kts = 0;
        }
    }
}

    /**
     * Calculates the distance between two coordinates in kilometers using the Haversine formula.
     */
    function getDistanceKm(lat1, lon1, lat2, lon2) {
      const R = 6371; // Radius of the Earth in km
      const toRad = (v) => (v * Math.PI) / 180;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    }

/**
 * --- [NEW] Unwraps coordinates to prevent Date Line issues ---
 * Converts a raw [-180, 180] line string into a continuous world-space line
 * (e.g., converts a jump from 179 to -179 into 179 to 181).
 */
function unwrapLineCoordinates(coords) {
    if (!coords || coords.length < 2) return coords;

    const newCoords = [coords[0]]; // Start with first point
    let lastLon = coords[0][0]; // Track the "unwrapped" longitude

    for (let i = 1; i < coords.length; i++) {
        const [rawLon, lat] = coords[i];
        
        // Calculate the jump from the previous *unwrapped* longitude
        // We use modulo to compare against the raw equivalent of the last point
        let delta = rawLon - (lastLon % 360);

        // Normalize delta to be the shortest path (-180 to 180)
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;

        // Apply the delta to the continuous chain
        const newLon = lastLon + delta;
        newCoords.push([newLon, lat]);
        
        lastLon = newLon;
    }
    return newCoords;
}

    /**
 * Calculates True Airspeed (TAS) in knots based on Pressure Altitude and OAT.
 * Uses the approximate TAS formula derived from the speed of sound ratio.
 *
 * @param {number} alt_ft - Pressure altitude in feet (from flight data).
 * @param {number} oat_c - Outside Air Temperature in Celsius (from OpenMeteo).
 * @param {number} gs_kt - Ground Speed in knots (from flight data, used as a starting point).
 * @returns {number} Calculated TAS in knots.
 */
function calculateTas(alt_ft, oat_c, gs_kt) {
    // 1. Convert Altitude to Pressure Altitude in meters (approx)
    const alt_m = alt_ft * 0.3048;

    // 2. Calculate Standard Temperature at Altitude (ISA) in Kelvin (K)
    // T_ISA = 288.15 - 0.0065 * alt_m (up to 11,000m)
    const T_ISA_K = 288.15 - 0.0065 * alt_m; 
    
    // 3. Convert OAT (C) to Kelvin (K)
    const T_OAT_K = oat_c + 273.15;
    
    // 4. TAS is proportional to IAS/CAS times the square root of (T_OAT / T_ISA)
    // For simplicity and avoiding IAS conversion, we use GS as a base,
    // which provides a reasonable wind-corrected approximation for display.
    if (T_ISA_K <= 0) return gs_kt; // Safety check

    const TAS_kt = gs_kt * Math.sqrt(T_OAT_K / T_ISA_K);

    return Math.round(TAS_kt);
}


    /**
     * --- [NEW] Calculates the initial bearing from point 1 to point 2.
     * @param {number} lat1 - Latitude of the starting point in degrees.
     * @param {number} lon1 - Longitude of the starting point in degrees.
     * @param {number} lat2 - Latitude of the ending point in degrees.
     * @param {number} lon2 - Longitude of the ending point in degrees.
     * @returns {number} The initial bearing in degrees (0-360).
     */
    function getBearing(lat1, lon1, lat2, lon2) {
        const toRad = (v) => v * Math.PI / 180;
        const toDeg = (v) => v * 180 / Math.PI;

        const lat1Rad = toRad(lat1);
        const lon1Rad = toRad(lon1);
        const lat2Rad = toRad(lat2);
        const lon2Rad = toRad(lon2);

        const dLon = lon2Rad - lon1Rad;

        const y = Math.sin(dLon) * Math.cos(lat2Rad);
        const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
                  Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
        
        let brng = toDeg(Math.atan2(y, x));
        return (brng + 360) % 360; // Normalize to 0-360
    }

    /**
     * --- [NEW] Normalizes a bearing difference to the smallest angle (-180 to 180).
     * @param {number} diff - The difference in degrees.
     * @returns {number} The normalized difference.
     */
    function normalizeBearingDiff(diff) {
        let normalized = diff % 360;
        if (normalized > 180) {
            normalized -= 360;
        }
        if (normalized < -180) {
            normalized += 360;
        }
        return normalized;
    }

/**
 * Calculates an intermediate point along a great-circle path.
 * @param {number} lat1 - Latitude of the starting point in degrees.
 * @param {number} lon1 - Longitude of the starting point in degrees.
 * @param {number} lat2 - Latitude of the ending point in degrees.
 * @param {number} lon2 - Longitude of the ending point in degrees.
 * @param {number} fraction - The fraction of the distance along the path (0.0 to 1.0).
 * @returns {{lat: number, lon: number}} The intermediate point's coordinates.
 */
function getIntermediatePoint(lat1, lon1, lat2, lon2, fraction) {
    const toRad = (v) => v * Math.PI / 180;
    const toDeg = (v) => v * 180 / Math.PI;

    const lat1Rad = toRad(lat1);
    const lon1Rad = toRad(lon1);
    const lat2Rad = toRad(lat2);
    const lon2Rad = toRad(lon2);

    const d = getDistanceKm(lat1, lon1, lat2, lon2) / 6371; // Angular distance in radians

    const a = Math.sin((1 - fraction) * d) / Math.sin(d);
    const b = Math.sin(fraction * d) / Math.sin(d);

    const x = a * Math.cos(lat1Rad) * Math.cos(lon1Rad) + b * Math.cos(lat2Rad) * Math.cos(lon2Rad);
    const y = a * Math.cos(lat1Rad) * Math.sin(lon1Rad) + b * Math.cos(lat2Rad) * Math.sin(lon2Rad);
    const z = a * Math.sin(lat1Rad) + b * Math.sin(lat2Rad);

    const latI = toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)));
    const lonI = toDeg(Math.atan2(y, x));

    return { lat: latI, lon: lonI };
}

/**
     * --- [UPDATED] ---
     * Fetches community aircraft details from the backend and caches the result.
     * IMPORTS "NEGATIVE CACHING": If a lookup fails or finds nothing, we cache null 
     * to prevent future network attempts for this specific livery.
     */
    async function fetchCommunityAircraftDetails(type, livery) {
        if (!type || !livery) return null;

        const key = `${type}/${livery}`;

        // 1. Check local cache first (Success OR Previous Failure)
        if (communityAircraftCache.has(key)) {
            return communityAircraftCache.get(key);
        }

        // 2. Check if a fetch is already in progress
        if (lookupQueue.has(key)) {
            return lookupQueue.get(key);
        }

        const lookupPromise = (async () => {
            try {
                // Encode parameters for the URL
                const encodedType = encodeURIComponent(type);
                const encodedLivery = encodeURIComponent(livery);

                const response = await fetch(`${API_BASE_URL}/api/aircraft/lookup?type=${encodedType}&livery=${encodedLivery}`);

                if (response.ok) {
                    let data = await response.json();
                    
                    // Handle array response
                    if (Array.isArray(data)) {
                        data = data.length > 0 ? data[0] : null;
                    }

                    if (data && data.imageUrl) {
                        const result = { 
                            communityImageUrl: data.imageUrl, 
                            contributorName: data.contributorName || 'IF Community',
                            tailNumber: data.tailNumber || null
                        };
                        communityAircraftCache.set(key, result); // Cache Success
                        return result;
                    }
                }
            } catch (error) {
                // Console warning is optional, keeping it clean as requested
                // console.warn(`Background lookup failed for ${key}`, error); 
            }

            // --- NEGATIVE CACHING FIX ---
            // If we reached here, the fetch failed, or returned 404, or the data was empty.
            // We cache 'null' so we know we checked this already and found nothing.
            communityAircraftCache.set(key, null); 
            return null;
        })();

        // 3. Store the promise in the queue
        lookupQueue.set(key, lookupPromise);

        // 4. Remove the promise from the queue once resolved/rejected
        lookupPromise.finally(() => lookupQueue.delete(key));

        return lookupPromise;
    }

function handleSocketFlightUpdate(data) {
    if (!data || !Array.isArray(data.flights) || !data.timestamp) {
        console.warn('Socket: Received invalid or untimestamped flights data packet.');
        return;
    }
    
    // --- [FIX] Race Condition Check (Case Insensitive) ---
    // Ignore packets that don't match the currently selected server.
    if (data.server && data.server.toLowerCase() !== currentServerName.toLowerCase()) {
        return; 
    }
    
    lastSocketUpdateTimestamp = new Date(data.timestamp).getTime();

    const isMapReady = (sectorOpsMap && sectorOpsMap.isStyleLoaded() && mapAnimator);
    const flights = data.flights;
    const updatedFlightIds = new Set();

    flights.forEach(flight => {
        if (!flight.position || !isFinite(flight.position.lat) || !isFinite(flight.position.lon)) {
            return; // Skip this flight
        }

        const flightId = flight.flightId;

        // --- [CRITICAL FIX] STALENESS CHECK ---
        // 1. Calculate the timestamp of the incoming data
        // We prefer the position report time, falling back to the packet time.
        const newTimestampRaw = flight.position.lastReport || data.timestamp;
        const newTime = new Date(newTimestampRaw).getTime();

        // 2. Get the timestamp of the data we already have (if any)
        let existingTime = 0;
        if (currentMapFeatures[flightId] && 
            currentMapFeatures[flightId].properties && 
            currentMapFeatures[flightId].properties.last_update) {
            existingTime = new Date(currentMapFeatures[flightId].properties.last_update).getTime();
        }

        // 3. If new data is OLDER than or EQUAL to existing data, ignore it.
        // This prevents the plane from "jumping back" to a previous position.
        if (newTime <= existingTime) {
            updatedFlightIds.add(flightId); // Mark as active so it doesn't get deleted
            return; 
        }
        // --- [END FIX] ---

        updatedFlightIds.add(flightId);

        const litePhase = getLiteFlightPhase(flight.position);
        const aircraftData = flight.aircraft || null;
        const acName = aircraftData?.aircraftName || '';
        const livName = aircraftData?.liveryName || '';
        const lookupKey = `${acName}/${livName}`;
        
        let existingFeature = currentMapFeatures[flightId] || {};
        let existingProps = existingFeature.properties || {};

        const newProperties = {
            flightId: flight.flightId,
            callsign: flight.callsign,
            username: flight.username,
            altitude: flight.position.alt_ft,
            speed: flight.position.gs_kt || 0,
            verticalSpeed: flight.position.vs_fpm || 0,
            position: JSON.stringify(flight.position),
            aircraft: JSON.stringify(aircraftData),
            userId: flight.userId,
            category: getAircraftCategory(acName),
            heading: flight.position.heading_deg, 
            isStaff: flight.isStaff,
            isVAMember: flight.isVAMember,
            phase: litePhase,
            pilotState: flight.pilotState,
            last_update: newTimestampRaw, // Store the specific time used for the check
            // Preserve existing cached data (Images + TAIL NUMBER)
            communityImageUrl: existingProps.communityImageUrl || null, 
            contributorName: existingProps.contributorName || null,
            tailNumber: existingProps.tailNumber || null 
        };

        // --- START: ASYNCHRONOUS LOOKUP LOGIC FOR HOVER CARD ---
        if (acName && livName && !existingProps.communityImageUrl) {
            if (communityAircraftCache.has(lookupKey)) {
                const cachedData = communityAircraftCache.get(lookupKey);
                if (cachedData) {
                    newProperties.communityImageUrl = cachedData.communityImageUrl;
                    newProperties.contributorName = cachedData.contributorName;
                    newProperties.tailNumber = cachedData.tailNumber;
                }
            } else if (!lookupQueue.has(lookupKey)) {
                fetchCommunityAircraftDetails(acName, livName)
                    .then(result => {
                        if (result && currentMapFeatures[flightId]) {
                            currentMapFeatures[flightId].properties.communityImageUrl = result.communityImageUrl;
                            currentMapFeatures[flightId].properties.contributorName = result.contributorName;
                            currentMapFeatures[flightId].properties.tailNumber = result.tailNumber;
                            
                            if (isMapReady && sectorOpsMap.getSource('sector-ops-live-flights-source')) {
                                sectorOpsMap.getSource('sector-ops-live-flights-source').setData({
                                    type: 'FeatureCollection', 
                                    features: Object.values(currentMapFeatures)
                                });
                            }
                        }
                    })
                    .catch(() => { /* Ignore errors */ });
            }
        }
        // --- END: ASYNCHRONOUS LOOKUP LOGIC ---

        // Manually update the data cache
        if (!currentMapFeatures[flightId]) {
            currentMapFeatures[flightId] = {
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [flight.position.lon, flight.position.lat]
                },
                properties: newProperties
            };
        } else {
            currentMapFeatures[flightId].properties = newProperties;
            currentMapFeatures[flightId].geometry.coordinates = [flight.position.lon, flight.position.lat];
        }

        if (flightId === currentFlightInWindow) {
            currentAircraftPositionForGeocode = flight.position;
            const fullFlightProps = { ...newProperties, position: flight.position, aircraft: aircraftData };

            // 1. SIMPLE WINDOW UPDATE
            const simpleIframe = document.getElementById('simple-flight-window-frame');
            if (simpleIframe && simpleIframe.contentWindow) {
                const simpleData = formatDataForSimpleWindow(fullFlightProps, cachedFlightDataForStatsView.plan, liveTrailCache.get(flightId), {
                    imageUrl: fullFlightProps.communityImageUrl,
                    contributorName: fullFlightProps.contributorName,
                    tailNumber: fullFlightProps.tailNumber
                });
                simpleIframe.contentWindow.postMessage({ type: 'FLIGHT_DATA_UPDATE', payload: simpleData }, '*');
            }

            // 2. STANDARD WINDOW UPDATE
            const standardIframe = document.getElementById('standard-flight-window-frame');
            if (standardIframe && standardIframe.contentWindow) {
                const standardData = formatWindowPayload(fullFlightProps, cachedFlightDataForStatsView.plan, liveTrailCache.get(flightId), {
                    imageUrl: fullFlightProps.communityImageUrl,
                    contributorName: fullFlightProps.contributorName,
                    tailNumber: fullFlightProps.tailNumber
                });
                standardIframe.contentWindow.postMessage({ type: 'FLIGHT_DATA_UPDATE', payload: standardData }, '*');
            }
        }

        // Only update the Map Animation/Icons if the map is actually ready.
        if (isMapReady) {
            mapAnimator.updateFlight(flight.position, newProperties);
        }
    });

    // Clean up old flights
    for (const flightId in currentMapFeatures) {
        if (!updatedFlightIds.has(String(flightId))) {
            if (isMapReady) {
                mapAnimator.removeFlight(flightId);
            }
            delete currentMapFeatures[flightId]; 
        }
    }
}

function initializeSectorOpsSocket() {
    // Prevent duplicate connections if called multiple times
    if (sectorOpsSocket && sectorOpsSocket.connected) {
        return;
    }

    // If a socket exists but is disconnected, try to reconnect
    if (sectorOpsSocket) {
        sectorOpsSocket.connect();
        return;
    }

    // Create new connection
    if (typeof io === 'undefined') {
        console.error('Socket.IO client library (io) is not loaded. Cannot connect to WebSocket.');
        showNotification('Live service connection failed. Please reload.', 'error');
        return;
    }
    
    console.log(`Socket: Connecting to ${ACARS_SOCKET_URL}...`);
    sectorOpsSocket = io(ACARS_SOCKET_URL, {
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
        transports: ['websocket'] 
    });

    // On successful connection, join the server room based on State
    sectorOpsSocket.on('connect', () => {
        // [UPDATED] Use currentServerName
        console.log(`Socket: Connected with ID ${sectorOpsSocket.id}. Joining room: ${currentServerName.toLowerCase()}`);
        sectorOpsSocket.emit('join_server_room', currentServerName);
    });

    // Listen for the broadcasted flight data
    sectorOpsSocket.on('all_flights_update', handleSocketFlightUpdate);

    // --- [NEW FIX] Listen for ATC/NOTAM updates (Secondary Data) ---
    // This catches the immediate packet sent after joining the room
    sectorOpsSocket.on('secondary_data_update', (data) => {
        // Validation: Ensure packet belongs to current server
        if (!data || !data.server || data.server.toLowerCase() !== currentServerName.toLowerCase()) {
            return;
        }

        console.log(`Socket: Received secondary update (ATC/NOTAMs) for ${data.server}`);

        // Update State
        activeAtcFacilities = (data.atc && Array.isArray(data.atc)) ? data.atc : [];
        activeNotams = (data.notams && Array.isArray(data.notams)) ? data.notams : [];

        // Redraw Map Markers Immediately
        renderAirportMarkers();
    });

    sectorOpsSocket.on('disconnect', (reason) => {
        console.warn(`Socket: Disconnected. Reason: ${reason}`);
    });

    sectorOpsSocket.on('connect_error', (error) => {
        console.error(`Socket: Connection Error. ${error.message}`);
    });
}

/**
 * --- [UPDATED] Smart Route Densification ---
 * Adds intermediate points along the Great Circle path between coordinates.
 * Prevents lines from "cutting through" the globe on long segments.
 * @param {Array<[number, number]>} coordinates - Array of [lon, lat] points.
 * @param {number} maxSegmentLengthKm - Max distance between points (default 100km).
 * @returns {Array<[number, number]>} Densified coordinates.
 */
function densifyRoute(coordinates, maxSegmentLengthKm = 100) {
    if (!coordinates || coordinates.length < 2) return coordinates || [];

    const densified = [coordinates[0]];

    for (let i = 0; i < coordinates.length - 1; i++) {
        const start = coordinates[i];
        const end = coordinates[i + 1];
        
        // Handle potential unwrapped coordinates (if > 180 or < -180)
        // We normalize them for the distance calc, but keep the raw value for the array
        const lon1 = start[0];
        const lat1 = start[1];
        const lon2 = end[0];
        const lat2 = end[1];

        const distKm = getDistanceKm(lat1, lon1, lat2, lon2);

        // If segment is long, add intermediate points
        if (distKm > maxSegmentLengthKm) {
            const numSteps = Math.ceil(distKm / maxSegmentLengthKm);
            
            for (let j = 1; j < numSteps; j++) {
                const fraction = j / numSteps;
                // getIntermediatePoint calculates the Great Circle position
                const intermediate = getIntermediatePoint(lat1, lon1, lat2, lon2, fraction);
                
                // --- [FIX] Handle Date Line Unwrapping during interpolation ---
                // If the original segment was crossing the date line (unwrapped),
                // we need to ensure the intermediate points follow that unwrap logic.
                let newLon = intermediate.lon;
                
                // Simple check: if start is ~179 and end is ~181 (unwrapped), 
                // intermediate shouldn't be -179.
                // We assume getIntermediatePoint returns normalized -180 to 180.
                // We re-apply the unwrap logic relative to the previous point.
                const prevLon = densified[densified.length - 1][0];
                let delta = newLon - (prevLon % 360);
                if (delta > 180) delta -= 360;
                if (delta < -180) delta += 360;
                
                densified.push([prevLon + delta, intermediate.lat]);
            }
        }
        
        // Always add the original end point
        densified.push(end);
    }

    return densified;
}



/**
 * --- NEW HELPER FUNCTION ---
 * Finds the closest runway end to a given aircraft position and track.
 * @param {object} aircraftPos - { lat, lon, heading_deg } // <-- MODIFIED
 * @param {string} airportIcao - The ICAO of the airport to check.
 * @param {number} maxDistanceNM - The maximum search radius in nautical miles.
 * @returns {object|null} - The runway end details (including distance and heading difference) or null if none are close enough.
 */
function getNearestRunway(aircraftPos, airportIcao, maxDistanceNM = 2.0) {
    const runways = runwaysData[airportIcao];
    if (!runways || runways.length === 0) {
        return null;
    }

    let closestRunway = null;
    let minDistanceKm = maxDistanceNM * 1.852;

    for (const runway of runways) {
        // Check both ends of the runway ('le' = low end, 'he' = high end)
        const ends = [
            // ✅ CORRECTION: Added elevation_ft to each end
            { ident: runway.le_ident, lat: runway.le_latitude_deg, lon: runway.le_longitude_deg, heading: runway.le_heading_degT, elevation_ft: runway.le_elevation_ft },
            { ident: runway.he_ident, lat: runway.he_latitude_deg, lon: runway.he_longitude_deg, heading: runway.he_heading_degT, elevation_ft: runway.he_elevation_ft }
        ];

        for (const end of ends) {
            if (end.lat == null || end.lon == null) continue;

            const distanceKm = getDistanceKm(aircraftPos.lat, aircraftPos.lon, end.lat, end.lon);

            if (distanceKm < minDistanceKm) {
                minDistanceKm = distanceKm;
                closestRunway = {
                    ...end,
                    airport: airportIcao,
                    distanceNM: distanceKm / 1.852
                };
            }
        }
    }

    // If a close runway was found, calculate the heading difference
    if (closestRunway) {
        // ⬇️ MODIFIED: Use heading_deg instead of track_deg
        let headingDiff = Math.abs(aircraftPos.heading_deg - closestRunway.heading);
        if (headingDiff > 180) {
            headingDiff = 360 - headingDiff; // Normalize to the shortest angle
        }
        closestRunway.headingDiff = headingDiff;
    }

    return closestRunway;
}
    

    function formatTime(ms) {
        if (ms < 0) ms = 0;
        let seconds = Math.floor(ms / 1000);
        let minutes = Math.floor(seconds / 60);
        let hours = Math.floor(minutes / 60);
        seconds = seconds % 60;
        minutes = minutes % 60;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    function formatDuration(seconds) {
        if (isNaN(seconds) || seconds < 0) return '00:00';
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }

    function formatTimeFromTimestamp(timestamp) {
        if (!timestamp) return '----';
        const date = (typeof timestamp === 'number' && timestamp.toString().length === 10) ?
            new Date(timestamp * 1000) :
            new Date(timestamp);
        if (isNaN(date.getTime())) return '----';
        return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
    }


    function extractAirlineCode(flightNumber) {
        if (!flightNumber || typeof flightNumber !== 'string') return 'UNKNOWN';
        const cleanedFlightNumber = flightNumber.trim().toUpperCase();
        const match = cleanedFlightNumber.match(/^([A-Z0-9]{2,3})([0-9]{1,4})([A-Z]?)$/);
        if (match && match[1]) return match[1].substring(0, 2);
        const fallbackMatch = cleanedFlightNumber.match(/^(\D+)/);
        if (fallbackMatch && fallbackMatch[1]) return fallbackMatch[1].substring(0, 2);
        return 'UNKNOWN';
    }

    


    function atcTypeToString(typeId) {
        const types = {
            0: 'Ground', 1: 'Tower', 2: 'Unicom', 3: 'Clearance',
            4: 'Approach', 5: 'Departure', 6: 'Center', 7: 'ATIS',
            8: 'Aircraft', 9: 'Recorded', 10: 'Unknown', 11: 'Unused'
        };
        return types[typeId] || 'Unknown';
    }

    function formatAtcDuration(startTime) {
        if (!startTime) return '';
        const start = new Date(startTime).getTime();
        const now = Date.now();
        const diffMs = Math.max(0, now - start);
        const hours = Math.floor(diffMs / 3600000);
        const minutes = Math.floor((diffMs % 3600000) / 60000);
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }

    // --- [NEW] PFD Constants and Functions ---
    const PFD_PITCH_SCALE = 8;
    const PFD_SPEED_SCALE = 7;
    const PFD_SPEED_CENTER_Y = 238;
    const PFD_SPEED_REF_VALUE = 120;
    const PFD_ALTITUDE_SCALE = 0.7;
    const PFD_ALTITUDE_CENTER_Y = 234;
    const PFD_ALTITUDE_REF_VALUE = 0;
    const PFD_REEL_SPACING = 30;
    const PFD_HEADING_SCALE = 5;
    const PFD_HEADING_CENTER_X = 406;
    const PFD_HEADING_REF_VALUE = 0;

    function createPfdDisplay() {
        const SVG_NS = "http://www.w3.org/2000/svg";
        
        // --- Existing Groups ---
        const attitudeGroup = document.getElementById('attitude_group');
        const speedTapeGroup = document.getElementById('speed_tape_group');
        const altitudeTapeGroup = document.getElementById('altitude_tape_group');
        const tensReelGroup = document.getElementById('altitude_tens_reel_group');
        const headingTapeGroup = document.getElementById('heading_tape_group');
        
        // --- NEW: Select the main PFD group to attach the FMA ---
        const pfdGroup = document.getElementById('PFD');

        // Safety check
        if (!attitudeGroup || !speedTapeGroup || !altitudeTapeGroup || !tensReelGroup || !headingTapeGroup || !pfdGroup) {
            return;
        }
        
        // Prevent double-initialization
        if (attitudeGroup.dataset.initialized === 'true') return;

        // 1. Generate Attitude Indicators (Existing Logic)
        function generateAttitudeIndicators() {
            const centerX = 401.5;
            const centerY = 312.5;
            for (let p = -90; p <= 90; p += 2.5) {
                if (p === 0) continue;
                const y = centerY - (p * PFD_PITCH_SCALE);
                const isMajor = (p % 10 === 0);
                const isMinor = (p % 5 === 0);
                if (isMajor || isMinor) {
                    const lineWidth = isMajor ? 80 : 40;
                    const line = document.createElementNS(SVG_NS, 'line');
                    line.setAttribute('x1', centerX - lineWidth / 2);
                    line.setAttribute('x2', centerX + lineWidth / 2);
                    line.setAttribute('y1', y);
                    line.setAttribute('y2', y);
                    line.setAttribute('stroke', 'white');
                    line.setAttribute('stroke-width', 2);
                    attitudeGroup.appendChild(line);
                    if (isMajor) {
                        const textLeft = document.createElementNS(SVG_NS, 'text');
                        textLeft.setAttribute('x', centerX - lineWidth / 2 - 10);
                        textLeft.setAttribute('y', y + 5);
                        textLeft.setAttribute('fill', 'white');
                        textLeft.setAttribute('font-size', '18');
                        textLeft.setAttribute('text-anchor', 'end');
                        textLeft.textContent = Math.abs(p);
                        attitudeGroup.appendChild(textLeft);
                        const textRight = document.createElementNS(SVG_NS, 'text');
                        textRight.setAttribute('x', centerX + lineWidth / 2 + 10);
                        textRight.setAttribute('y', y + 5);
                        textRight.setAttribute('fill', 'white');
                        textRight.setAttribute('font-size', '18');
                        textRight.setAttribute('text-anchor', 'start');
                        textRight.textContent = Math.abs(p);
                        attitudeGroup.appendChild(textRight);
                    }
                }
            }
        }

        // 2. Generate Speed Tape (Existing Logic)
        function generateSpeedTape() {
            const MIN_SPEED = 0, MAX_SPEED = 999;
            for (let s = MIN_SPEED; s <= MAX_SPEED; s += 5) {
                const yPos = PFD_SPEED_CENTER_Y - (s - PFD_SPEED_REF_VALUE) * PFD_SPEED_SCALE;
                const tick = document.createElementNS(SVG_NS, 'line');
                tick.setAttribute('y1', yPos); tick.setAttribute('y2', yPos);
                tick.setAttribute('stroke', 'white'); tick.setAttribute('stroke-width', '2');
                if (s % 10 === 0) {
                    tick.setAttribute('x1', '67'); tick.setAttribute('x2', '52');
                    const text = document.createElementNS(SVG_NS, 'text');
                    text.setAttribute('x', '37'); text.setAttribute('y', yPos + 5);
                    text.setAttribute('fill', 'white'); text.setAttribute('font-size', '18');
                    text.setAttribute('text-anchor', 'middle'); text.textContent = s;
                    speedTapeGroup.appendChild(text);
                } else {
                    tick.setAttribute('x1', '67'); tick.setAttribute('x2', '60');
                }
                speedTapeGroup.appendChild(tick);
            }
        }

        // 3. Generate Altitude Tape (Existing Logic)
        function generateAltitudeTape() {
            const MIN_ALTITUDE = 0, MAX_ALTITUDE = 50000;
            for (let alt = MIN_ALTITUDE; alt <= MAX_ALTITUDE; alt += 20) {
                const yPos = PFD_ALTITUDE_CENTER_Y - (alt - PFD_ALTITUDE_REF_VALUE) * PFD_ALTITUDE_SCALE;
                const tick = document.createElementNS(SVG_NS, 'line');
                tick.setAttribute('y1', yPos); tick.setAttribute('y2', yPos);
                tick.setAttribute('stroke', 'white'); tick.setAttribute('stroke-width', '2');
                tick.setAttribute('x1', '72');
                if (alt % 100 === 0) {
                    tick.setAttribute('x2', '52');
                    const text = document.createElementNS(SVG_NS, 'text');
                    text.setAttribute('x', '25'); text.setAttribute('y', yPos + 5);
                    text.setAttribute('fill', 'white'); text.setAttribute('font-size', '18');
                    text.setAttribute('text-anchor', 'middle'); text.textContent = alt / 100;
                    altitudeTapeGroup.appendChild(text);
                } else {
                    tick.setAttribute('x2', '62');
                }
                altitudeTapeGroup.appendChild(tick);
            }
        }

        // 4. Generate Reels (Existing Logic)
        function generateAltitudeTensReel() {
            const center_y = 316;
            for (let i = -5; i < 10; i++) {
                let value = (i * 20); value = (value < 0) ? 100 + (value % 100) : value % 100;
                const displayValue = String(value).padStart(2, '0');
                const yPos = center_y - (i * PFD_REEL_SPACING);
                const text = document.createElementNS(SVG_NS, 'text');
                text.setAttribute('x', '745'); text.setAttribute('y', yPos);
                text.setAttribute('fill', '#00FF00'); text.setAttribute('font-size', '32');
                text.setAttribute('font-weight', 'bold'); text.textContent = displayValue;
                tensReelGroup.appendChild(text);
            }
        }

        // 5. Generate Heading Tape (Existing Logic)
        function generateHeadingTape() {
            const y_text = 650, y_tick_top = 620, y_tick_bottom_major = 635, y_tick_bottom_minor = 628;
            for (let h = -360; h <= 720; h += 5) {
                const xPos = PFD_HEADING_CENTER_X + (h - PFD_HEADING_REF_VALUE) * PFD_HEADING_SCALE;
                const normalizedH = (h + 360) % 360;
                if (normalizedH % 90 === 0) continue;
                const tick = document.createElementNS(SVG_NS, 'line');
                tick.setAttribute('x1', xPos); tick.setAttribute('x2', xPos);
                tick.setAttribute('stroke', 'white'); tick.setAttribute('stroke-width', '1.5');
                tick.setAttribute('y1', y_tick_top); tick.setAttribute('y2', (h % 10 === 0) ? y_tick_bottom_major : y_tick_bottom_minor);
                headingTapeGroup.appendChild(tick);
            }
            for (let h = 0; h < 360; h += 10) {
                for (let offset of [-360, 0, 360]) {
                    const currentH = h + offset;
                    const xPos = PFD_HEADING_CENTER_X + (currentH - PFD_HEADING_REF_VALUE) * PFD_HEADING_SCALE;
                    const text = document.createElementNS(SVG_NS, 'text');
                    text.setAttribute('x', xPos); text.setAttribute('y', y_text);
                    text.setAttribute('fill', 'white'); text.setAttribute('font-size', '16');
                    text.setAttribute('text-anchor', 'middle');
                    let displayVal = '';
                    switch (h) { case 0: displayVal = 'N'; break; case 90: displayVal = 'E'; break; case 180: displayVal = 'S'; break; case 270: displayVal = 'W'; break; default: if (h % 30 === 0) { displayVal = h / 10; } }
                    if (displayVal !== '') { text.textContent = displayVal; headingTapeGroup.appendChild(text); }
                }
            }
        }
        
        // --- 6. NEW: Generate Flight Mode Annunciator (FMA) ---
        function generateFMA() {
            // FMA Container Group
            const fmaGroup = document.createElementNS(SVG_NS, 'g');
            fmaGroup.setAttribute('id', 'fma_group');
            
            // Background Box (Top of PFD)
            // UPDATED: Height 100
            const fmaBg = document.createElementNS(SVG_NS, 'rect');
            fmaBg.setAttribute('x', '0');
            fmaBg.setAttribute('y', '0'); 
            fmaBg.setAttribute('width', '787');
            fmaBg.setAttribute('height', '100'); // Taller
            fmaBg.setAttribute('fill', '#101010'); 
            fmaBg.setAttribute('stroke', '#555');
            fmaBg.setAttribute('stroke-width', '0'); 
            fmaGroup.appendChild(fmaBg);

            // Separator Lines (5 Columns -> 4 lines)
            const colWidth = 157.4;
            for (let i = 1; i < 5; i++) {
                const x = i * colWidth;
                const line = document.createElementNS(SVG_NS, 'line');
                line.setAttribute('x1', x); line.setAttribute('x2', x);
                // UPDATED: y2 is 100
                line.setAttribute('y1', '0'); line.setAttribute('y2', '100');
                line.setAttribute('stroke', '#555'); 
                line.setAttribute('stroke-width', '1');
                fmaGroup.appendChild(line);
            }

            // Text Placeholders
            // UPDATED: Centered vertically for 100px height (~58px) and increased font size
            
            // Col 1: Auto-Thrust
            const textCol1 = document.createElementNS(SVG_NS, 'text');
            textCol1.setAttribute('id', 'fma_col1_text');
            textCol1.setAttribute('x', '78');
            textCol1.setAttribute('y', '58'); 
            textCol1.setAttribute('fill', '#00FF00'); 
            textCol1.setAttribute('font-family', 'monospace');
            textCol1.setAttribute('font-size', '24'); // Larger
            textCol1.setAttribute('font-weight', 'bold');
            textCol1.setAttribute('text-anchor', 'middle');
            textCol1.textContent = ""; 
            fmaGroup.appendChild(textCol1);

            // Col 2: Vertical Mode
            const textCol2 = document.createElementNS(SVG_NS, 'text');
            textCol2.setAttribute('id', 'fma_col2_text');
            textCol2.setAttribute('x', '235');
            textCol2.setAttribute('y', '58');
            textCol2.setAttribute('fill', '#00FF00');
            textCol2.setAttribute('font-family', 'monospace');
            textCol2.setAttribute('font-size', '24');
            textCol2.setAttribute('font-weight', 'bold');
            textCol2.setAttribute('text-anchor', 'middle');
            textCol2.textContent = ""; 
            fmaGroup.appendChild(textCol2);

            // Col 3: Lateral Mode
            const textCol3 = document.createElementNS(SVG_NS, 'text');
            textCol3.setAttribute('id', 'fma_col3_text');
            textCol3.setAttribute('x', '392');
            textCol3.setAttribute('y', '58');
            textCol3.setAttribute('fill', '#00FF00');
            textCol3.setAttribute('font-family', 'monospace');
            textCol3.setAttribute('font-size', '24');
            textCol3.setAttribute('font-weight', 'bold');
            textCol3.setAttribute('text-anchor', 'middle');
            textCol3.textContent = ""; 
            fmaGroup.appendChild(textCol3);

            // Col 4: Approach Capability
            const textCol4 = document.createElementNS(SVG_NS, 'text');
            textCol4.setAttribute('id', 'fma_col4_text');
            textCol4.setAttribute('x', '549');
            textCol4.setAttribute('y', '52'); // Slightly higher
            textCol4.setAttribute('fill', '#FFFFFF'); 
            textCol4.setAttribute('font-family', 'monospace');
            textCol4.setAttribute('font-size', '20'); // Larger
            textCol4.setAttribute('text-anchor', 'middle');
            
            const tspan1 = document.createElementNS(SVG_NS, 'tspan');
            tspan1.setAttribute('x', '549');
            tspan1.setAttribute('dy', '0');
            tspan1.textContent = ""; 
            textCol4.appendChild(tspan1);
            
            const tspan2 = document.createElementNS(SVG_NS, 'tspan');
            tspan2.setAttribute('x', '549');
            tspan2.setAttribute('dy', '22');
            tspan2.textContent = ""; 
            textCol4.appendChild(tspan2);
            
            fmaGroup.appendChild(textCol4);
            
            // --- Add a divider line at the bottom of the FMA ---
            const bottomBorder = document.createElementNS(SVG_NS, 'line');
            bottomBorder.setAttribute('x1', '0'); bottomBorder.setAttribute('x2', '787');
            // UPDATED: y 100
            bottomBorder.setAttribute('y1', '100'); bottomBorder.setAttribute('y2', '100');
            bottomBorder.setAttribute('stroke', '#ffffff');
            bottomBorder.setAttribute('stroke-width', '2');
            fmaGroup.appendChild(bottomBorder);

            // Append FMA to PFD Group (Last = On Top)
            pfdGroup.appendChild(fmaGroup);
        }

        generateAttitudeIndicators();
        generateSpeedTape();
        generateAltitudeTape();
        generateAltitudeTensReel();
        generateHeadingTape();
        generateFMA(); // <-- Call the new generator

        attitudeGroup.dataset.initialized = 'true'; 
    }
    

function updatePfdDisplay(pfdData) {
  if (!pfdData) return;

  // ---- tolerate common key names ----
  const gs_kt =
    pfdData.gs_kt ??
    pfdData.groundspeed_kts ??
    pfdData.groundspeed ??
    pfdData.gs ??
    (pfdData.speed && (pfdData.speed.kt || pfdData.speed.kts)) ??
    0;

  const track_deg =
    pfdData.heading_deg ??
    pfdData.track_deg ??
    pfdData.track ??
    pfdData.hdg ??
    0;

  const alt_ft = pfdData.alt_ft ?? pfdData.altitude_ft ?? pfdData.altitude ?? 0;
  const vs_fpm = pfdData.vs_fpm ?? pfdData.vertical_speed_fpm ?? pfdData.vs ?? 0;

  // ---- [FIX] DOM elements are now selected via querySelectorAll ----
  const attitudeGroups     = document.querySelectorAll('#attitude_group');
  const speedTapeGroups    = document.querySelectorAll('#speed_tape_group');
  const altitudeTapeGroups = document.querySelectorAll('#altitude_tape_group');
  const tensReelGroups     = document.querySelectorAll('#altitude_tens_reel_group');
  const headingTapeGroups  = document.querySelectorAll('#heading_tape_group');
  const speedReadouts      = document.querySelectorAll('#speed_readout');
  const altReadoutHunds    = document.querySelectorAll('#altitude_readout_hundreds');
  const headingReadouts    = document.querySelectorAll('#heading_readout');
  
  if (attitudeGroups.length === 0) return; // No PFDs found, exit
  
  // ---- tunables ----
  const WINDOW_SEC          = 2.4;   // regression window
  const LATCH_ON_TURN       = 0.20;  // deg/s to latch "turning"
  const LATCH_OFF_TURN      = 0.10;  // deg/s to unlatch
  const LATCH_HOLD_MS       = 400;   // chatter guard
  const MAX_BANK_DEG        = 35;
  const MAX_ROLL_RATE       = 60;    // display slew (deg/s)
  const MIN_GS_FOR_TURN     = 1;
  const PITCH_LIMIT         = 25;

  const DATA_HOLD_MS        = 1400;  // hold last turn-rate after last fresh packet
  const STALE_MS            = 4000;  // after this, allow full decay/unlatch
  const HDG_EPS             = 0.4;   // unwrapped degrees to consider heading "changed"
  const GS_EPS              = 0.5;   // kt change to consider GS "changed"
  const DECAY_TO_LEVEL_DPS  = 12;    // decay when not turning
  const MICRO_DECAY_FACTOR  = 0.25;  // softer decay before STALE_MS

  const EMA_ALPHA           = 0.35;  // EMA smoothing on turn-rate (0..1)
  const SIGN_MIN_DEG        = 3.0;   // min magnitude to accept L/R sign flip
  const SIGN_HOLD_MS        = 250;   // new sign must persist this long

  const now = performance.now();

  // ---- persistent state ----
  if (!window.lastPfdState || typeof window.lastPfdState !== 'object') {
    window.lastPfdState = {
      unwrapped: track_deg,
      lastTime: now,
      buf: [],                  // [{t, hdg}] for fresh samples only
      rollDisp: 0,
      turning: false,
      lastTurnLatchTs: 0,

      // freshness / hold
      lastDataTs: 0,
      lastTurnRate: 0,
      lastRawTrack: track_deg,
      lastRawGs: gs_kt,
      prevUnwrapped: track_deg,

      // smoothing & sign guard
      turnRateEma: 0,
      rollSign: 0,
      lastSignChangeTs: 0
    };
  }
  const S = window.lastPfdState;

  // ---- unwrap heading ----
  let delta = track_deg - (S.unwrapped % 360);
  if (delta > 180)  delta -= 360;
  if (delta < -180) delta += 360;
  const unwrapped = S.unwrapped + delta;

  // ---- detect "fresh" API packet vs. render tick (use unwrapped delta) ----
  const unwrappedDelta = Math.abs(unwrapped - S.unwrapped);
  const isFresh =
    unwrappedDelta > HDG_EPS ||
    Math.abs(gs_kt - S.lastRawGs) > GS_EPS;

  // ---- manage regression buffer (only for fresh samples) ----
  const tNow = now / 1000;
  if (isFresh) {
    S.lastDataTs = now;
    S.lastRawTrack = track_deg;
    S.lastRawGs = gs_kt;
    const cutoff = tNow - WINDOW_SEC;
    S.buf.push({ t: tNow, hdg: unwrapped });
    while (S.buf.length && S.buf[0].t < cutoff) S.buf.shift();
  }

  // ---- turn-rate estimate (deg/s): fresh -> compute; else -> hold previous ----
  let turnRate = S.lastTurnRate;
  if (isFresh) {
    if (S.buf.length >= 3 && gs_kt > MIN_GS_FOR_TURN) {
      // linear regression slope
      const t0 = S.buf[0].t;
      let sumT = 0, sumH = 0, sumTT = 0, sumTH = 0, n = S.buf.length;
      for (let i = 0; i < n; i++) {
        const ti = S.buf[i].t - t0;
        const hi = S.buf[i].hdg;
        sumT  += ti;
        sumH  += hi;
        sumTT += ti * ti;
        sumTH += ti * hi;
      }
      const denom = n * sumTT - sumT * sumT;
      if (denom !== 0) {
        turnRate = (n * sumTH - sumT * sumH) / denom; // deg/s
      } else {
        const dtS = Math.max(0.02, (now - S.lastTime) / 1000);
        turnRate = (unwrapped - S.prevUnwrapped) / dtS;
      }
    } else {
      const dtS = Math.max(0.02, (now - S.lastTime) / 1000);
      turnRate = (unwrapped - S.prevUnwrapped) / dtS;
    }
    S.lastTurnRate = turnRate;
  }

  // ---- EMA smoothing on turn-rate ----
  S.turnRateEma = EMA_ALPHA * turnRate + (1 - EMA_ALPHA) * S.turnRateEma;

  // ---- hysteresis + data-hold for "turning" ----
  const sinceFresh = now - S.lastDataTs;
  const rateAbs    = Math.abs(S.turnRateEma);
  const wasTurning = S.turning;
  const forceTurningByHold = sinceFresh <= DATA_HOLD_MS && Math.abs(S.lastTurnRate) >= LATCH_OFF_TURN;

  if (!wasTurning) {
    if (rateAbs >= LATCH_ON_TURN || forceTurningByHold) {
      S.turning = true;
      S.lastTurnLatchTs = now;
    }
  } else {
    const timeSinceLatch = now - S.lastTurnLatchTs;
    const allowUnlatch = rateAbs < LATCH_OFF_TURN && timeSinceLatch > LATCH_HOLD_MS && sinceFresh > DATA_HOLD_MS;
    if (allowUnlatch && sinceFresh > STALE_MS) {
      S.turning = false;
    } else if (rateAbs >= LATCH_OFF_TURN || forceTurningByHold) {
      S.lastTurnLatchTs = now;
    }
  }

  // ---- coordinated-turn bank target from smoothed rate ----
  const Vms   = Math.max(0, gs_kt) * 0.514444;
  const omega = (S.turnRateEma * Math.PI) / 180; // rad/s
  const bankAbs = Math.atan(Math.abs(omega) * Vms / 9.81) * 180 / Math.PI;
  let targetRoll = (S.turnRateEma >= 0 ? 1 : -1) * Math.min(bankAbs, MAX_BANK_DEG);

  // ---- sign stickiness (prevents brief L/R flips) ----
  const desiredSign = Math.sign(targetRoll);
  if (desiredSign !== 0 && desiredSign !== S.rollSign) {
    const bigEnough = Math.abs(targetRoll) >= SIGN_MIN_DEG;
    const persisted = (now - S.lastSignChangeTs) >= SIGN_HOLD_MS;
    if (bigEnough && persisted) {
      S.rollSign = desiredSign;
      S.lastSignChangeTs = now;
    } else {
      targetRoll = Math.abs(targetRoll) * (S.rollSign || desiredSign);
    }
  } else if (S.rollSign === 0 && desiredSign !== 0) {
    S.rollSign = desiredSign;
    S.lastSignChangeTs = now;
  }

  // ---- when not turning: decay toward level (hold pose before STALE_MS) ----
  if (!S.turning) {
    const dt = Math.max(0.01, (now - S.lastTime) / 1000);
    const base = DECAY_TO_LEVEL_DPS * dt;
    const decayStep = sinceFresh <= STALE_MS ? base * MICRO_DECAY_FACTOR : base;
    targetRoll = (Math.abs(S.rollDisp) <= decayStep) ? 0 : S.rollDisp - Math.sign(S.rollDisp) * decayStep;
  }

  // ---- slew-limit the displayed roll ----
  {
    const dt = Math.max(0.01, (now - S.lastTime) / 1000);
    const maxStep = dt * MAX_ROLL_RATE;
    const diff = targetRoll - S.rollDisp;
    S.rollDisp += Math.abs(diff) > maxStep ? Math.sign(diff) * maxStep : diff;
  }

  // ---- update state timestamps/unwraps ----
  S.unwrapped = unwrapped;
  S.prevUnwrapped = unwrapped;
  S.lastTime = now;

  // ---- pitch from VS ----
  const pitch_deg = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, (vs_fpm / 1000) * 4));

  // ---- [FIX] Apply transforms to ALL found elements ----
  const rollForSvg = -S.rollDisp; // SVG rotation sense
  const attitudeTransform = `translate(0, ${pitch_deg * PFD_PITCH_SCALE}) rotate(${rollForSvg}, 401.5, 312.5)`;
  attitudeGroups.forEach(el => el.setAttribute('transform', attitudeTransform));

  // ---- [FIX] Apply tape/readout updates to ALL found elements ----
  const speedYOffset = (gs_kt - PFD_SPEED_REF_VALUE) * PFD_SPEED_SCALE;
  speedReadouts.forEach(el => el.textContent = Math.round(gs_kt));
  speedTapeGroups.forEach(el => el.setAttribute('transform', `translate(0, ${speedYOffset})`));

  const altitude = Math.max(0, alt_ft);
  const tapeYOffset = altitude * PFD_ALTITUDE_SCALE;
  altReadoutHunds.forEach(el => el.textContent = Math.floor(altitude / 100));
  altitudeTapeGroups.forEach(el => el.setAttribute('transform', `translate(0, ${tapeYOffset})`));

  const tensValue = altitude % 100;
  // [FIXED] Removed negative sign. Moves DOWN (positive Y) as value increases to reveal numbers from above.
  const reelYOffset = (tensValue / 20) * PFD_REEL_SPACING;
  tensReelGroups.forEach(el => el.setAttribute('transform', `translate(0, ${reelYOffset})`));

  const hdg = ((Math.round(track_deg) % 360) + 360) % 360;
  const xOffset = -(track_deg - PFD_HEADING_REF_VALUE) * PFD_HEADING_SCALE;
  headingReadouts.forEach(el => el.textContent = String(hdg).padStart(3, '0'));
  headingTapeGroups.forEach(el => el.setAttribute('transform', `translate(${xOffset}, 0)`));

  // ---------------------------------------------------------
  // ---- NEW: UPDATE FMA TEXT (Flight Mode Annunciator) ----
  // ---------------------------------------------------------
  
  // 1. Determine Modes Logic
  let thrustMode = "SPEED";
  let vertMode = "ALT";
  let latMode = "NAV";
  let catStatus = ""; // E.g., "CAT3\nDUAL"

  // -- Logic: Phase Detection --
  const isClimbing = vs_fpm > 400;
  const isDescending = vs_fpm < -400;
  const isOnGround = alt_ft < 50 && gs_kt > 30; // Pseudo-takeoff
  const isTurning = Math.abs(S.rollDisp) > 3.0;
  
  // Use inferred alignment logic (Low alt, low speed, steady roll)
  // Note: This assumes landing configuration without checking runways directly (simulated)
  const isLandingConfig = alt_ft < 2500 && gs_kt < 180 && !isClimbing; 
  const isEstablished = isLandingConfig && !isTurning;

  // -- Col 1: Auto-Thrust --
  if (isOnGround) {
      thrustMode = "TOGA";
  } else if (isClimbing) {
      thrustMode = "THR CLB";
  } else if (isDescending) {
      thrustMode = "THR IDLE";
  } else {
      thrustMode = "SPEED";
  }

  // -- Col 2: Vertical Mode --
  if (isClimbing) {
      vertMode = "CLB";
  } else if (isDescending) {
      vertMode = "DES";
  } else if (isEstablished && isLandingConfig) {
      vertMode = "G/S";
  } else {
      vertMode = "ALT"; // Level flight
  }

  // -- Col 3: Lateral Mode --
  if (isOnGround) {
      latMode = "RWY";
  } else if (isEstablished && isLandingConfig) {
      latMode = "LOC";
  } else if (isTurning) {
      latMode = "HDG";
  } else {
      latMode = "NAV";
  }

  // -- Col 4: Approach Status (Simulated) --
  if (latMode === "LOC" && vertMode === "G/S" && alt_ft < 1000) {
      catStatus = "CAT3\nDUAL"; 
  }

  // 2. Update DOM
  const fmaCol1 = document.getElementById('fma_col1_text');
  const fmaCol2 = document.getElementById('fma_col2_text');
  const fmaCol3 = document.getElementById('fma_col3_text');
  const fmaCol4 = document.getElementById('fma_col4_text');

  if (fmaCol1) fmaCol1.textContent = thrustMode;
  if (fmaCol2) fmaCol2.textContent = vertMode;
  if (fmaCol3) fmaCol3.textContent = latMode;

  if (fmaCol4) {
      // Handle multiline logic for Col 4
      const lines = catStatus.split('\n');
      const spans = fmaCol4.querySelectorAll('tspan');
      if (spans.length >= 2) {
          spans[0].textContent = lines[0] || "";
          spans[1].textContent = lines[1] || "";
      }
  }
}

    /**
     * --- [NEW] Resets the PFD state and visuals to neutral. ---
     * Call this when selecting a new aircraft to prevent displaying stale data.
     */
    function resetPfdState() {
        // 1. Invalidate the persistent state object.
        //    This forces updatePfdDisplay to re-initialize it on its next run.
        window.lastPfdState = null;

        // 2. Immediately set the core SVG elements to a neutral, "level flight" state.
        const attitudeGroup = document.getElementById('attitude_group');
        const speedReadout = document.getElementById('speed_readout');
        const altReadoutHund = document.getElementById('altitude_readout_hundreds');
        const headingReadout = document.getElementById('heading_readout');
        const speedTapeGroup = document.getElementById('speed_tape_group');
        const altitudeTapeGroup = document.getElementById('altitude_tape_group');
        const headingTapeGroup = document.getElementById('heading_tape_group');

        if (attitudeGroup) {
            // Set to zero pitch translation and zero roll rotation.
            attitudeGroup.setAttribute('transform', 'translate(0, 0) rotate(0, 401.5, 312.5)');
        }
        
        // 3. Clear readouts to avoid showing the last aircraft's data.
        if (speedReadout) speedReadout.textContent = '---';
        if (altReadoutHund) altReadoutHund.textContent = '---';
        if (headingReadout) headingReadout.textContent = '---';

        // 4. Reset tape positions to zero.
        if (speedTapeGroup) speedTapeGroup.setAttribute('transform', 'translate(0, 0)');
        if (altitudeTapeGroup) altitudeTapeGroup.setAttribute('transform', 'translate(0, 0)');
        if (headingTapeGroup) headingTapeGroup.setAttribute('transform', 'translate(0, 0)');
    }



async function createAirportInfoWindowHTML(icao) {
    // 1. Get Static Data
    const staticData = airportsData[icao] || {};
    
    // 2. Fetch Live Airport Details (Jetbridges, etc.)
    let liveData = null;
    try {
        const response = await fetch(`${ACARS_SOCKET_URL}/api/airport/${icao}`);
        if (response.ok) {
            const json = await response.json();
            if (json.ok && json.airport) liveData = json.airport;
        }
    } catch (e) { console.warn(`Could not fetch live data for ${icao}`, e); }

    // 3. Fetch Live Traffic & ATIS
    let inbounds = [];
    let outbounds = [];
    let rawAtisText = null; // Store real ATIS here
    let trafficFetchSuccess = false;

    try {
        // A. Get Session ID
        const sessionsRes = await fetch(`${ACARS_SOCKET_URL}/if-sessions`);
        const sessionsData = await sessionsRes.json();
        const sessionId = getCurrentSessionId(sessionsData);

        if (sessionId) {
            // B. Parallel Fetch: Status (Traffic) AND ATIS
            const [statusRes, atisRes] = await Promise.all([
                fetch(`${ACARS_SOCKET_URL}/api/live/airport/${sessionId}/${icao}/status`),
                fetch(`${ACARS_SOCKET_URL}/api/live/airport/${sessionId}/${icao}/atis`)
            ]);

            // Process Traffic
            if (statusRes.ok) {
                const statusJson = await statusRes.json();
                if (statusJson.ok && statusJson.status) {
                    inbounds = statusJson.status.inboundFlights || [];
                    outbounds = statusJson.status.outboundFlights || [];
                    trafficFetchSuccess = true;
                }
            }

            // Process ATIS
            if (atisRes.ok) {
                const atisJson = await atisRes.json();
                if (atisJson.ok && atisJson.atis) {
                    rawAtisText = atisJson.atis; // This is the raw string from IF API
                }
            }
        }
    } catch (e) { console.error("Error fetching live stats/atis:", e); }

    // 4. Merge Basic Data
    const airportName = liveData?.name || staticData.name || 'Unknown Airport';
    const city = liveData?.city || staticData.city;
    const state = liveData?.state || staticData.state;
    const cityState = [city, state].filter(Boolean).join(', ') || 'Location N/A';
    const countryCode = (liveData?.country?.isoCode || staticData.country || '').toLowerCase();
    const flagSrc = countryCode ? `https://flagcdn.com/w40/${countryCode}.png` : '';
    const elevation = liveData?.elevation ?? staticData.elevation_ft ?? 0;
    const coords = { lat: liveData?.latitude ?? staticData.lat, lon: liveData?.longitude ?? staticData.lon };
    const badge3DHtml = liveData?.has3dBuildings ? `<span style="background: linear-gradient(135deg, #e2e8f0 0%, #94a3b8 100%); color: #0f172a; font-size: 0.65rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; margin-left: 10px;">3D</span>` : '';

    // Filter Derived Data
    const atcForAirport = activeAtcFacilities.filter(f => f.airportName === icao);
    const notamsForAirport = activeNotams.filter(n => n.airportIcao === icao);
    const airportRunways = runwaysData[icao] || [];

    // --- LOGIC: ATIS / WEATHER MODULE ---
    let weatherModuleHtml = '';
    let atisModuleHtml = ''; 
    let metarString = '';
    
    try {
        // Fetch Weather
        if (window.WeatherService) {
            const w = await window.WeatherService.fetchAndParseMetar(icao);
            let flightCategory = 'VFR'; 
            let catColor = '#4ade80';
            if (w.raw.includes('LIFR')) { flightCategory = 'LIFR'; catColor = '#c084fc'; }
            else if (w.raw.includes('IFR') || w.raw.includes('VV')) { flightCategory = 'IFR'; catColor = '#f87171'; }
            else if (w.raw.includes('MVFR')) { flightCategory = 'MVFR'; catColor = '#60a5fa'; }
            metarString = w.raw;

            // --- BUILD ATIS DISPLAY ---
            if (rawAtisText) {
                // 1. REAL ATIS IS ONLINE
                
                // Extract Info Letter (e.g., "Airport Info A" or "Information A")
                const infoMatch = rawAtisText.match(/Info(?:rmation)?\s+([A-Z])/i);
                const infoLetter = infoMatch ? `INFO ${infoMatch[1].toUpperCase()}` : 'D-ATIS';
                
                // Extract Time (e.g., "2000Z")
                const timeMatch = rawAtisText.match(/(\d{4}Z)/);
                const atisTime = timeMatch ? timeMatch[1] : 'LIVE';

                atisModuleHtml = `
                <div class="apt-mini-module" style="border-color: rgba(251, 191, 36, 0.3);">
                    <div class="apt-mini-header" style="background: rgba(251, 191, 36, 0.1);">
                        <span style="color: #fbbf24;"><i class="fa-solid fa-tower-broadcast"></i> ACTIVE ATIS</span>
                        <span style="color: #fbbf24; font-weight:700;">ONLINE</span>
                    </div>
                    <div class="apt-mini-body">
                        <div class="atis-status-row">
                            <span class="atis-code-large">${infoLetter}</span>
                            <span class="atis-timestamp"><i class="fa-regular fa-clock"></i> ${atisTime}</span>
                        </div>
                        <div class="terminal-text-box">${rawAtisText}</div>
                    </div>
                </div>`;

            } else {
                // 2. ATIS IS OFFLINE -> Use Calculation Fallback
                // We assume active runways based on wind recommendations
                const recs = getRunwayRecommendations(airportRunways, w.wind);
                
                // Take top 2 runways
                const activeRunways = recs.slice(0, 2).map(r => r.ident); 
                const activeArrHtml = activeRunways.length ? activeRunways.map(r => `<span class="atis-pill pill-arr">${r}</span>`).join('') : '<span style="color:#666;">---</span>';
                const activeDepHtml = activeRunways.length ? activeRunways.map(r => `<span class="atis-pill pill-dep">${r}</span>`).join('') : '<span style="color:#666;">---</span>';

                atisModuleHtml = `
                <div class="apt-mini-module">
                    <div class="apt-mini-header">
                        <span><i class="fa-solid fa-calculator"></i> EST. RUNWAYS</span>
                        <span style="color: #94a3b8; border: 1px solid #475569; padding: 0 4px; border-radius: 3px; font-size: 0.6rem;">NO ATIS</span>
                    </div>
                    <div class="apt-mini-body">
                        <div style="display: flex; flex-direction: column; gap: 6px;">
                            <div class="atis-runway-row">
                                <span class="atis-label">ARR</span>
                                <div style="display:flex;">${activeArrHtml}</div>
                            </div>
                            <div class="atis-runway-row">
                                <span class="atis-label">DEP</span>
                                <div style="display:flex;">${activeDepHtml}</div>
                            </div>
                            <div style="font-size: 0.65rem; color: #64748b; text-align: center; margin-top: 4px;">
                                <i class="fa-solid fa-wind"></i> Calculated based on wind
                            </div>
                        </div>
                    </div>
                </div>`;
            }

            // Weather Module (Standard)
            weatherModuleHtml = `
            <div class="apt-mini-module">
                <div class="apt-mini-header">
                    <span><i class="fa-solid fa-cloud-sun"></i> METAR</span>
                    <span style="color: ${catColor}; border: 1px solid ${catColor}; padding: 0 4px; border-radius: 3px; font-size: 0.6rem;">${flightCategory}</span>
                </div>
                <div class="apt-mini-body">
                    <div class="stat-grid-compact">
                        <div class="compact-stat-box"><span class="compact-label">WIND</span><span class="compact-value" style="color: #38bdf8;">${w.wind}</span></div>
                        <div class="compact-stat-box"><span class="compact-label">VIS</span><span class="compact-value">${w.visibility || '10KM'}</span></div>
                        <div class="compact-stat-box"><span class="compact-label">TEMP</span><span class="compact-value" style="color: #fbbf24;">${w.temp}</span></div>
                        <div class="compact-stat-box"><span class="compact-label">QNH</span><span class="compact-value">${w.qnh || '1013'}</span></div>
                    </div>
                </div>
            </div>`;

        } else {
            // Fallback if WeatherService is down
            weatherModuleHtml = `<div class="apt-mini-module"><div class="apt-mini-body"><p class="muted-text">Weather Unavailable</p></div></div>`;
            atisModuleHtml = `<div class="apt-mini-module"><div class="apt-mini-body"><p class="muted-text">Data Unavailable</p></div></div>`;
        }
    } catch (err) { 
        weatherModuleHtml = `<div class="apt-mini-module"><div class="apt-mini-body"><p class="muted-text">Offline</p></div></div>`;
        atisModuleHtml = `<div class="apt-mini-module"><div class="apt-mini-body"><p class="muted-text">Offline</p></div></div>`;
    }

    // --- Feature Strip ---
    let featureStripHtml = '';
    if (liveData) {
        const features = [
            { key: 'hasJetbridges', label: 'Jetbridges', icon: 'fa-person-walking-luggage' },
            { key: 'hasSafedockUnits', label: 'Safedock', icon: 'fa-square-parking' },
            { key: 'hasTaxiwayRouting', label: 'Drag & Taxi', icon: 'fa-route' }
        ];
        const aptClass = liveData.class ? `Class ${liveData.class}` : 'N/A';
        const timezone = liveData.timezone ? liveData.timezone.split(' ')[0] : 'UTC';
        featureStripHtml = `
            <div class="apt-quick-info-strip">
                <div class="apt-feature-pill"><i class="fa-solid fa-earth-americas"></i> ${timezone}</div>
                <div class="apt-feature-pill"><i class="fa-solid fa-ranking-star"></i> ${aptClass}</div>
                ${features.map(f => liveData[f.key] ? `<div class="apt-feature-pill" style="color: #cbd5e1; border-color: rgba(74, 222, 128, 0.3); background: rgba(74, 222, 128, 0.05);"><i class="fa-solid ${f.icon}" style="color: #4ade80;"></i> ${f.label}</div>` : '').join('')}
            </div>`;
    }

    // --- Tab Contents (Traffic, ATC, NOTAMs) ---
    // (Kept compact for brevity, logic matches original)
    const renderFlightCard = (fid, type) => {
        const f = currentMapFeatures[fid];
        let cs = 'Unknown', usr = 'Pilot', ac = '---', al = 'UNKNOWN';
        if (f && f.properties) {
            const p = f.properties; cs = p.callsign||cs; usr = p.username||usr;
            const acn = (typeof p.aircraft==='string'?JSON.parse(p.aircraft):p.aircraft)?.aircraftName||'';
            ac = acn.split(' ')[0].substring(0,4).toUpperCase();
            if(acn.includes('777')) ac='B777'; else if(acn.includes('320')) ac='A320';
            al = extractAirlineCode(cs);
        }
        const color = type === 'in' ? '#4ade80' : '#38bdf8';
        return `<div class="route-card" style="border-left: 3px solid ${color}; padding: 8px 12px;"><div class="route-info"><div class="route-callsign" style="font-size: 0.95rem;"><img src="Images/vas/${al}.png" style="height: 14px; width: auto; max-width: 30px;" onerror="this.style.display='none'"> ${cs}</div><div class="route-details" style="font-size: 0.7rem;"><span class="route-ac-badge" style="font-size: 0.65rem;">${ac}</span><span>${usr}</span></div></div><div style="font-size: 0.7rem; font-weight: bold; color: ${color};"><i class="fa-solid ${type==='in'?'fa-plane-arrival':'fa-plane-departure'}"></i></div></div>`;
    };

    let trafficHtml = (!trafficFetchSuccess) ? '<div style="padding: 20px; text-align: center; color: #64748b;">Data unavailable.</div>' :
        (inbounds.length===0 && outbounds.length===0) ? '<div style="padding: 20px; text-align: center; color: #64748b;">No live traffic.</div>' :
        `<div style="padding: 12px; display: flex; flex-direction: column; gap: 4px;">${inbounds.length>0 ? `<div style="margin-bottom:8px;"><div style="font-size:0.7rem;color:#94a3b8;font-weight:700;margin-bottom:4px;padding-left:4px;">INBOUND (${inbounds.length})</div>${inbounds.map(id=>renderFlightCard(id,'in')).join('')}</div>` : ''}${outbounds.length>0 ? `<div><div style="font-size:0.7rem;color:#94a3b8;font-weight:700;margin-bottom:4px;padding-left:4px;">OUTBOUND (${outbounds.length})</div>${outbounds.map(id=>renderFlightCard(id,'out')).join('')}</div>` : ''}</div>`;

    let atcHtml = atcForAirport.length === 0 ? '<div style="padding: 20px; text-align: center; color: #64748b;">No active frequencies.</div>' :
        `<div style="padding: 12px;">${atcForAirport.map(f => `<div class="atc-grid-card" style="padding: 8px;"><div style="display: flex; align-items: center; gap: 12px;"><span class="atc-type-badge ${f.type===1?'atc-type-twr':f.type===0?'atc-type-gnd':(f.type===4||f.type===5)?'atc-type-app':'atc-type-obs'}" style="width: 60px; font-size: 0.65rem;">${atcTypeToString(f.type)}</span><span class="atc-controller" style="font-size: 0.85rem;">${f.username||'Unknown'}</span></div><span class="atc-duration" style="font-size: 0.75rem;"><i class="fa-regular fa-clock"></i> ${formatAtcDuration(f.startTime)}</span></div>`).join('')}</div>`;

    let notamsHtml = notamsForAirport.length === 0 ? '<div style="padding: 20px; text-align: center; color: #64748b;">No active NOTAMs.</div>' :
        `<div style="padding: 12px; display: flex; flex-direction: column; gap: 8px;">${notamsForAirport.map(n => `<div style="background: rgba(234, 179, 8, 0.1); border-left: 3px solid #eab308; padding: 8px; border-radius: 4px; color: #fef08a; font-family: monospace; font-size: 0.75rem;"><i class="fa-solid fa-triangle-exclamation"></i> ${n.message}</div>`).join('')}</div>`;

    // --- Final Render ---
    return `
        <div class="airport-hero">
            <div class="hero-actions">
                <button id="airport-window-hide-btn" class="hero-btn" title="Hide Window"><i class="fa-solid fa-compress"></i></button>
                <button id="airport-window-close-btn" class="hero-btn" title="Close Window"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="apt-ident-group">
                <div class="apt-icao">${icao}${flagSrc ? `<img src="${flagSrc}" style="height: 24px; border-radius: 2px; margin-left: 10px;">` : ''}${badge3DHtml}</div>
                <div class="apt-name">${airportName}</div>
                <div style="font-size: 0.8rem; color: #64748b; margin-top: 2px;">${cityState}</div>
                <div style="margin-top: 8px; display: flex; gap: 8px;">
                     <span class="apt-meta-badge"><i class="fa-solid fa-location-crosshairs"></i> ${coords.lat?.toFixed(3)}, ${coords.lon?.toFixed(3)}</span>
                     <span class="apt-meta-badge"><i class="fa-solid fa-arrows-up-down"></i> ${elevation} ft</span>
                </div>
            </div>
            <i class="fa-solid fa-plane-departure" style="font-size: 6rem; color: rgba(255,255,255,0.03); position: absolute; right: -10px; bottom: -20px; transform: rotate(-15deg);"></i>
        </div>
        ${featureStripHtml}
        <div style="flex-grow: 1; overflow-y: auto; padding-top: 12px;">
            <div class="apt-dashboard-grid">
                ${weatherModuleHtml}
                ${atisModuleHtml}
            </div>
            ${metarString ? `<div class="metar-strip">${metarString}</div>` : ''}
            <div class="tech-module" style="min-height: 300px; display: flex; flex-direction: column; margin: 16px 16px 16px 16px; border: 1px solid rgba(255,255,255,0.05);">
                <div class="apt-tabs-header">
                    <button class="apt-tab-btn active" data-target="apt-traffic"><i class="fa-solid fa-plane-circle-check"></i> TRAFFIC</button>
                    <button class="apt-tab-btn" data-target="apt-atc"><i class="fa-solid fa-headset"></i> ATC</button>
                    <button class="apt-tab-btn" data-target="apt-notams"><i class="fa-solid fa-triangle-exclamation"></i> NOTAMs</button>
                </div>
                <div id="apt-traffic" class="apt-tab-content active" style="padding: 0;">${trafficHtml}</div>
                <div id="apt-atc" class="apt-tab-content" style="padding: 0;">${atcHtml}</div>
                <div id="apt-notams" class="apt-tab-content" style="padding: 0;">${notamsHtml}</div>
            </div>
        </div>
    `;
}

    // --- Rank & Fleet Models ---
    const PILOT_RANKS = [
        'IndGo Cadet', 'Skyline Observer', 'Route Explorer', 'Skyline Officer',
        'Command Captain', 'Elite Captain', 'Blue Eagle', 'Line Instructor',
        'Chief Flight Instructor', 'IndGo SkyMaster', 'Blue Legacy Commander'
    ];
    const rankIndex = (r) => PILOT_RANKS.indexOf(String(r || '').trim());

    const deduceRankFromAircraftFE = (acStr) => {
        const s = String(acStr || '').toUpperCase();
        const has = (pat) => new RegExp(pat, 'i').test(s);
        if (has('(DH8D|Q400|A320|B738)')) return 'IndGo Cadet';
        if (has('(A321|B737|B739)')) return 'Skyline Observer';
        if (has('(A330|B38M)')) return 'Route Explorer';
        if (has('(787-8|B788|777-200LR|B77L)')) return 'Skyline Officer';
        if (has('(787-9|B789|777-300ER|B77W)')) return 'Command Captain';
        if (has('A350')) return 'Elite Captain';
        if (has('(A380|747|744|B744)')) return 'Blue Eagle';
        return 'Unknown';
    };

    const userCanFlyAircraft = (userRank, aircraftIcao) => {
        const ac = DYNAMIC_FLEET.find(a => a.icao === aircraftIcao);
        if (!ac) return false;
        const ui = rankIndex(userRank);
        const ri = rankIndex(ac.rankUnlock);
        return ui >= 0 && ri >= 0 && ri <= ui;
    };

    const getAllowedFleet = (userRank) => {
        return DYNAMIC_FLEET.filter(ac => {
            const userRankIndex = rankIndex(userRank);
            const aircraftRankIndex = rankIndex(ac.rankUnlock);
            return userRankIndex >= 0 && aircraftRankIndex >= 0 && aircraftRankIndex <= userRankIndex;
        });
    };

    // --- Notifications ---
    function showNotification(message, type) {
        Toastify({
            text: message,
            duration: 3000,
            close: true,
            gravity: "top",
            position: "right",
            stopOnFocus: true,
            style: { background: type === 'success' ? "#28a745" : type === 'error' ? "#dc3545" : "#001B94" }
        }).showToast();
    }

    window.showGlobalNotification = showNotification;

    // --- DOM elements ---
    const pilotNameElem = document.getElementById('pilot-name');
    const pilotCallsignElem = document.getElementById('pilot-callsign');
    const profilePictureElem = document.getElementById('profile-picture');
    const logoutButton = document.getElementById('logout-button');
    const mainContentContainer = document.querySelector('.main-content');
    const mainContentLoader = document.getElementById('main-content-loader');
    const sidebarNav = document.querySelector('.sidebar-nav');
    const dashboardContainer = document.querySelector('.dashboard-container');
    const sidebarToggleBtn = document.getElementById('sidebar-toggle');
    const notificationsBell = document.getElementById('notifications-bell');
    const notificationsModal = document.getElementById('notifications-modal');

    // Modals
    const promotionModal = document.getElementById('promotion-modal');
    const arriveFlightModal = document.getElementById('arrive-flight-modal');

    // --- Mapbox Plotting Functions ---

 
    /**
     * Initializes the live operations map.
     */
    function initializeLiveMap() {
        if (!MAPBOX_ACCESS_TOKEN) return;
        if (document.getElementById('live-flights-map-container') && !liveFlightsMap) {
            liveFlightsMap = new mapboxgl.Map({
                container: 'live-flights-map-container',
                style: 'mapbox://styles/mapbox/dark-v11',
                center: [78.9629, 22.5937],
                zoom: 4,
                minZoom: 2
            });
            liveFlightsMap.on('load', startLiveLoop);
        } else {
            startLiveLoop();
        }
    }

    /**
     * Starts or restarts the live flight update interval.
     */
    function startLiveLoop() {
        if (!liveFlightsInterval) {
            updateLiveFlights();
            liveFlightsInterval = setInterval(updateLiveFlights, 3000);
        }
    }

    /**
     * Helper to remove dynamic flight path layers from the map.
     */
    function removeFlightPathLayers(map) {
        if (map.getLayer('flown-path')) map.removeLayer('flown-path');
        if (map.getSource('flown-path-source')) map.removeSource('flown-path-source');
        if (map.getLayer('planned-path')) map.removeLayer('planned-path');
        if (map.getSource('planned-path-source')) map.removeSource('planned-path-source');
    }

/**
 * Fetches live flight data and updates the map.
 */
async function updateLiveFlights() {
    if (!liveFlightsMap || !liveFlightsMap.isStyleLoaded()) return;

    try {
        const sessionsRes = await fetch('https://site--acars-backend--6dmjph8ltlhv.code.run/if-sessions');
        const expertSession = (await sessionsRes.json()).sessions.find(s => s.name.toLowerCase().includes('expert'));
        if (!expertSession) {
            console.warn('No Expert Server session found for live flights.');
            return;
        }

        const response = await fetch(`${LIVE_FLIGHTS_API_URL}/${expertSession.id}?callsignEndsWith=GO`);
        const flights = (await response.json()).flights || [];
        const activeFlightIds = new Set();

        flights.forEach(f => {
            const { flightId, position: pos, callsign, username } = f;
            if (!flightId || !pos || pos.lat == null || pos.lon == null) return;

            activeFlightIds.add(flightId);
            const lngLat = [pos.lon, pos.lat];

            if (pilotMarkers[flightId]) {
                // Update existing marker
                const entry = pilotMarkers[flightId];
                entry.marker.setLngLat(lngLat);
                // ⬇️ MODIFIED: Use heading_deg as track_deg is no longer sent
                entry.marker.getElement().style.transform = `rotate(${pos.heading_deg ?? 0}deg)`;
            } else {
                // Create new marker
                const el = document.createElement('div');
                el.className = 'plane-marker';
                const marker = new mapboxgl.Marker(el).setLngLat(lngLat).addTo(liveFlightsMap);
                pilotMarkers[flightId] = { marker: marker };

                // Add click event listener
                marker.getElement().addEventListener('click', async () => {
                    removeFlightPathLayers(liveFlightsMap);
                    const popup = new mapboxgl.Popup({ closeButton: false, offset: 25 }).setLngLat(lngLat).setHTML(`<b>${callsign}</b><br><i>Loading flight data...</i>`).addTo(liveFlightsMap);

                    try {
                        const [planRes, routeRes] = await Promise.all([
                            fetch(`${LIVE_FLIGHTS_API_URL}/${expertSession.id}/${flightId}/plan`),
                            fetch(`${LIVE_FLIGHTS_API_URL}/${expertSession.id}/${flightId}/route`)
                        ]);
                        const planJson = await planRes.json();
                        const routeJson = await routeRes.json();
                        let allCoordsForBounds = [];

                        // Flown path
                        const flownCoords = (routeRes.ok && routeJson.ok && Array.isArray(routeJson.route)) ? routeJson.route.map(p => [p.lon, p.lat]) : [];
                        if (flownCoords.length > 1) {
                            allCoordsForBounds.push(...flownCoords);
                            liveFlightsMap.addSource('flown-path-source', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: flownCoords } } });
                            liveFlightsMap.addLayer({ id: 'flown-path', type: 'line', source: 'flown-path-source', paint: { 'line-color': '#00b894', 'line-width': 4 } });
                        }

                        // Planned path
                        if (planRes.ok && planJson.ok && Array.isArray(planJson?.plan?.flightPlanItems) && planJson.plan.flightPlanItems.length > 0) {
                            const nextIdx = (typeof planJson?.plan?.nextWaypointIndex === 'number') ? planJson.plan.nextWaypointIndex : 0;
                            const items = Array.isArray(planJson.plan.flightPlanItems) ? planJson.plan.flightPlanItems.slice(nextIdx) : [];
                            const plannedWps = flattenWaypointsFromPlan(items);
                            const remainingPathCoords = [lngLat, ...plannedWps];
                            allCoordsForBounds.push(...remainingPathCoords);
                            liveFlightsMap.addSource('planned-path-source', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: remainingPathCoords } } });
                            liveFlightsMap.addLayer({ id: 'planned-path', type: 'line', source: 'planned-path-source', paint: { 'line-color': '#e84393', 'line-width': 3, 'line-dasharray': [2, 2] } });
                            popup.setHTML(`<b>${callsign}</b> (${username || 'N/A'})<br>Route and flight plan loaded.`);
                        } else {
                            popup.setHTML(`<b>${callsign}</b> (${username || 'N/A'})<br>No flight plan filed.`);
                        }

                        if (allCoordsForBounds.length > 0) {
                            const bounds = allCoordsForBounds.reduce((b, coord) => b.extend(coord), new mapboxgl.LngLatBounds(allCoordsForBounds[0], allCoordsForBounds[0]));
                            liveFlightsMap.fitBounds(bounds, { padding: 60, maxZoom: 10 });
                        }
                    } catch (err) {
                        console.error("Failed to fetch/render flight paths:", err);
                        popup.setHTML(`<b>${callsign}</b> (${username || 'N/A'})<br>Could not load flight data.`);
                    }
                });
            }
        });

        // Remove inactive markers
        Object.keys(pilotMarkers).forEach(fid => {
            if (!activeFlightIds.has(String(fid))) {
                pilotMarkers[fid].marker?.remove();
                delete pilotMarkers[fid];
            }
        });
    } catch (err) {
        console.error('Error updating live flights:', err);
    }
}


    function setupAirportWindowEvents() {
        if (!airportInfoWindow || airportInfoWindow.dataset.eventsAttached === 'true') return;

        // Use Event Delegation on the main container
        airportInfoWindow.addEventListener('click', (e) => {
            const closeBtn = e.target.closest('#airport-window-close-btn');
            const hideBtn = e.target.closest('#airport-window-hide-btn');
            
            // --- [NEW] Accordion Toggle Logic ---
            const toggleBtn = e.target.closest('#runway-accordion-toggle');
            if (toggleBtn) {
                const content = document.getElementById('runway-accordion-content');
                if (content) {
                    toggleBtn.classList.toggle('open');
                    content.classList.toggle('open');
                }
            }

            if (closeBtn) {
                airportInfoWindow.classList.remove('visible');
                if (window.MobileUIHandler) MobileUIHandler.closeActiveWindow();
                airportInfoWindowRecallBtn.classList.remove('visible');
                clearRouteLayers(); 
                currentAirportInWindow = null;
            }

            if (hideBtn) {
                airportInfoWindow.classList.remove('visible');
                if (currentAirportInWindow) {
                    airportInfoWindowRecallBtn.classList.add('visible');
                    airportInfoWindowRecallBtn.classList.add('palpitate');
                    setTimeout(() => {
                        airportInfoWindowRecallBtn.classList.remove('palpitate');
                    }, 1000);
                }
            }
        });

        airportInfoWindowRecallBtn.addEventListener('click', () => {
            if (currentAirportInWindow) {
                airportInfoWindow.classList.add('visible');
                airportInfoWindowRecallBtn.classList.remove('visible');
            }
        });

        airportInfoWindow.dataset.eventsAttached = 'true';
    }
    

function setupAircraftWindowEvents() {
    if (!aircraftInfoWindow || aircraftInfoWindow.dataset.eventsAttached === 'true') return;

    aircraftInfoWindow.addEventListener('click', async (e) => {
        const closeBtn = e.target.closest('.aircraft-window-close-btn');
        const hideBtn = e.target.closest('.aircraft-window-hide-btn');
        const tabBtn = e.target.closest('.ac-info-tab-btn');
        const planBtn = e.target.closest('#plan-this-flight-btn');
        const profileToggleBtn = e.target.closest('.profile-toggle-btn');

        // 1. Handle VSD/SSD Toggle
        if (profileToggleBtn) {
            e.preventDefault();
            if (profileToggleBtn.classList.contains('active')) return;

            const targetPanelId = profileToggleBtn.dataset.target;
            const profileCard = profileToggleBtn.closest('.ac-profile-card-new');
            
            if (!targetPanelId || !profileCard) return;

            profileCard.querySelector('.profile-toggle-btn.active')?.classList.remove('active');
            profileCard.querySelector('#vsd-panel.active')?.classList.remove('active');
            profileCard.querySelector('#ssd-panel.active')?.classList.remove('active');

            profileToggleBtn.classList.add('active');
            profileCard.querySelector(`#${targetPanelId}`)?.classList.add('active');
            return;
        }

        // 2. Handle "Plan This Flight" Button
        if (planBtn) {
            e.preventDefault();
            const departure = planBtn.dataset.departure;
            const arrival = planBtn.dataset.arrival;
            const aircraft = planBtn.dataset.aircraft;

            if (!departure || !arrival || !aircraft) {
                showNotification("Could not get flight data to plan.", "error");
                return;
            }

            const depInput = document.getElementById('fp-departure');
            const arrInput = document.getElementById('fp-arrival');
            const acSelect = document.getElementById('fp-aircraft');
            
            if (!depInput || !arrInput || !acSelect) {
                showNotification("Flight plan form is not loaded.", "error");
                return;
            }

            depInput.value = departure;
            arrInput.value = arrival;
            acSelect.value = aircraft;

            const flightPlanTabBtn = document.querySelector('.panel-tab-btn[data-tab="tab-flightplan"]');
            if (flightPlanTabBtn) flightPlanTabBtn.click();
            
            const hideButton = aircraftInfoWindow.querySelector('.aircraft-window-hide-btn');
            if (hideButton) hideButton.click();
            
            const panel = document.getElementById('sector-ops-floating-panel');
            if (panel && panel.classList.contains('panel-collapsed')) {
                const toolbarToggleBtn = document.getElementById('toolbar-toggle-panel-btn');
                if (toolbarToggleBtn) toolbarToggleBtn.click();
            }
            
            const flightPlanTabContent = document.getElementById('tab-flightplan');
            if (flightPlanTabContent) flightPlanTabContent.scrollTop = 0;

            showNotification("Flight plan form populated.", "success");
            return;
        }

        // 3. Handle Tab Switching
        if (tabBtn) {
            e.preventDefault();
            const tabId = tabBtn.dataset.tab;
            if (!tabId || tabBtn.classList.contains('active')) return;
            
            const windowContent = tabBtn.closest('.info-window-content');
            if (!windowContent) return;
            
            tabBtn.closest('.ac-info-window-tabs').querySelector('.ac-info-tab-btn.active')?.classList.remove('active');
            windowContent.querySelector('.ac-tab-pane.active')?.classList.remove('active');
            
            tabBtn.classList.add('active');
            const newPane = windowContent.querySelector(`#${tabId}`);
            if (newPane) newPane.classList.add('active');
            
            if (tabId === 'ac-tab-pilot-report') {
                const statsDisplay = newPane.querySelector('#pilot-stats-display');
                if (statsDisplay && statsDisplay.innerHTML.trim() === '') { 
                    const userId = tabBtn.dataset.userId;
                    const username = tabBtn.dataset.username;
                    if (userId) await displayPilotStats(userId, username); 
                }
            }
        }

        // 4. Handle Close Logic (USING HELPER)
        if (closeBtn) {
            closeAircraftWindow(); 
        }

        // 5. Handle Hide Logic
        if (hideBtn) {
            aircraftInfoWindow.classList.remove('visible');
            clearLiveFlightPath(currentFlightInWindow);

            // Clear intervals (pause updates while hidden)
            if (activePfdUpdateInterval) clearInterval(activePfdUpdateInterval);
            if (activeGeocodeUpdateInterval) clearInterval(activeGeocodeUpdateInterval);
            if (activeWeatherUpdateInterval) clearInterval(activeWeatherUpdateInterval); 
            
            activePfdUpdateInterval = null;
            activeGeocodeUpdateInterval = null;
            activeWeatherUpdateInterval = null;
            
            if (currentFlightInWindow) {
                aircraftInfoWindowRecallBtn.classList.add('visible', 'palpitate');
                setTimeout(() => aircraftInfoWindowRecallBtn.classList.remove('palpitate'), 1000);
            }
        }
    });

    // Recall Button Logic
    aircraftInfoWindowRecallBtn.addEventListener('click', () => {
        if (currentFlightInWindow) {
            const layer = sectorOpsMap.getLayer('sector-ops-live-flights-layer');
            if (layer) {
                const source = sectorOpsMap.getSource('sector-ops-live-flights-source');
                const features = source._data.features;
                const feature = features.find(f => f.properties.flightId === currentFlightInWindow);
                if (feature) {
                    const props = feature.properties;
                    const flightProps = { ...props, position: JSON.parse(props.position), aircraft: JSON.parse(props.aircraft) };
                    
                    fetch('https://site--acars-backend--6dmjph8ltlhv.code.run/if-sessions').then(res => res.json()).then(data => {
                        const sessionId = getCurrentSessionId(data);
                        if(sessionId) {
                            handleAircraftClick(flightProps, sessionId);
                        }
                    });
                }
            }
        }
    });
    
    aircraftInfoWindow.dataset.eventsAttached = 'true';
}

/**
 * --- [NEW] Helper function to build the icon-image expression based on the filter state
 * @param {string} colorMode - 'default', 'blue', or 'orange'
 * @returns {Array} A Mapbox 'match' expression
 */
function getIconImageExpression(colorMode = 'default') {
    let suffix = '';
    if (colorMode === 'orange') {
        suffix = '-orange';
    } else if (colorMode === 'blue') {
        suffix = '-blue';
    }
    // 'default' mode (white) has no suffix

    return [
        'match',
        ['get', 'category'],
        'jumbo', `icon-jumbo${suffix}`,
        'widebody', `icon-widebody${suffix}`,
        'narrowbody', `icon-narrowbody${suffix}`,
        'regional', `icon-regional${suffix}`,
        'private', `icon-private${suffix}`,
        'fighter', `icon-fighter${suffix}`,
        'military', `icon-military${suffix}`,
        'cessna', `icon-cessna${suffix}`,
        `icon-default${suffix}` // Fallback
    ];
}

/**
 * --- [UPDATED] Formats data for the Simple Flight Info Iframe ---
 * Now passes the raw 'pilotState' (0-3) for the true Seat Sensor status.
 */
function formatDataForSimpleWindow(flightProps, plan, routePoints, communityData) {
    if (!flightProps) return null;

    // 1. Parsing
    const pos = flightProps.position || {};
    const aircraft = (typeof flightProps.aircraft === 'string') ? JSON.parse(flightProps.aircraft) : (flightProps.aircraft || {});
    
    // --- REGISTRATION LOGIC ---
    let finalRegistration = '---';
    if (communityData && communityData.tailNumber) {
        finalRegistration = communityData.tailNumber;
    } else if (aircraft.registration) {
        finalRegistration = aircraft.registration;
    }

    // 2. Route Calculations
    let originIcao = '---', destIcao = '---';
    let progress = 0, elapsed = '--:--', eta = '--:--', ete = '--:--', originTime = '--:--';
    let originCountry = '', destCountry = '';

    // --- TIME & ELAPSED CALCULATIONS ---
    // We use the first point in routePoints (history) to determine start time
    if (routePoints && routePoints.length > 0) {
        const firstPoint = routePoints[0];
        if (firstPoint && firstPoint.date) {
            const startTime = new Date(firstPoint.date).getTime();
            const now = Date.now();
            
            // 1. Calculate Departure Time (UTC)
            originTime = new Date(startTime).toLocaleTimeString('en-GB', { 
                hour: '2-digit', 
                minute: '2-digit', 
                timeZone: 'UTC' 
            });

            // 2. Calculate Elapsed Time
            const diffMs = now - startTime;
            if (diffMs > 0) {
                const h = Math.floor(diffMs / 3600000);
                const m = Math.floor((diffMs % 3600000) / 60000);
                elapsed = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            }
        }
    }

    // We will build a structured waypoint list here
    const structuredWaypoints = [];

    if (plan && plan.flightPlanItems && plan.flightPlanItems.length > 1) {
        originIcao = plan.origin?.icao || plan.flightPlanItems[0].identifier || '---';
        destIcao = plan.destination?.icao || plan.flightPlanItems[plan.flightPlanItems.length - 1].identifier || '---';
        
        if (airportsData[originIcao]) originCountry = airportsData[originIcao].country;
        if (airportsData[destIcao]) destCountry = airportsData[destIcao].country;

        // --- A. FLATTEN AND IDENTIFY GROUPS ---
        const flatList = [];
        
        plan.flightPlanItems.forEach((item, index) => {
            let groupName = "ENROUTE";
            const children = item.children || [];
            const hasChildren = children.length > 0;
            const ident = (item.identifier || item.name || '').toUpperCase();

            // Detect Procedure Type
            if (hasChildren) {
                if (index <= 1) {
                    groupName = `SID: ${ident}`;
                } else if (/^[A-Z]\d{2}[LRC]?$/.test(ident)) { // Runway identifier regex
                    groupName = `APPR: ${ident}`;
                } else {
                    groupName = `STAR: ${ident}`;
                }
                
                // Add children to list
                children.forEach(child => {
                    if (child.location) {
                        flatList.push({ 
                            ...child, 
                            group: groupName 
                        });
                    }
                });
            } else if (item.location) {
                // Top level waypoint
                flatList.push({ ...item, group: "ENROUTE" });
            }
        });

        // --- B. FIND ACTIVE WAYPOINT ---
        let activeIndex = 0;
        let minScore = Infinity;
        const currentTrack = pos.heading_deg || 0;

        if (flatList.length > 0) {
            flatList.forEach((wp, idx) => {
                if (!wp.location) return;
                const d = getDistanceKm(pos.lat, pos.lon, wp.location.latitude, wp.location.longitude);
                
                // Simple bearing check to prefer points in front of us
                const bearingTo = getBearing(pos.lat, pos.lon, wp.location.latitude, wp.location.longitude);
                const bearingDiff = Math.abs(normalizeBearingDiff(currentTrack - bearingTo));
                
                // Only consider points roughly ahead (within 100 deg) or very close (<5km)
                if (bearingDiff < 100 || d < 5) {
                    if (d < minScore) {
                        minScore = d;
                        activeIndex = idx;
                    }
                }
            });
        }

        // --- C. CALCULATE TOTAL DISTANCE & ETA ---
        let totalDist = 0;
        for (let i = 0; i < flatList.length - 1; i++) {
            totalDist += getDistanceKm(flatList[i].location.latitude, flatList[i].location.longitude, flatList[i+1].location.latitude, flatList[i+1].location.longitude);
        }
        
        // Progress Logic
        if (totalDist > 0 && flatList.length > 0) {
            const destLat = flatList[flatList.length - 1].location.latitude;
            const destLon = flatList[flatList.length - 1].location.longitude;
            const distRemaining = getDistanceKm(pos.lat, pos.lon, destLat, destLon);
            
            progress = Math.max(0, Math.min(100, (1 - (distRemaining / totalDist)) * 100));
            
            // ETA Calculation
            const speedKts = pos.gs_kt || 0;
            if (speedKts > 50) {
                const hours = (distRemaining / 1.852) / speedKts;
                const h = Math.floor(hours);
                const m = Math.round((hours - h) * 60);
                ete = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                
                const arrivalDate = new Date(Date.now() + (hours * 3600000));
                eta = arrivalDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
            }
        }

        // --- D. FORMAT OUTPUT LIST ---
        flatList.forEach((wp, idx) => {
            const distKm = getDistanceKm(pos.lat, pos.lon, wp.location.latitude, wp.location.longitude);
            const distNM = distKm / 1.852;
            
            structuredWaypoints.push({
                ident: wp.identifier || wp.name,
                name: wp.name,
                type: wp.type,
                group: wp.group,
                active: (idx === activeIndex),
                passed: (idx < activeIndex),
                time: idx === activeIndex ? `${distNM.toFixed(1)} NM` : (idx < activeIndex ? 'PASS' : '')
            });
        });
    }

    // 4. Construct Payload
    return {

        theme: {
            start: mapFilters.themeStartColor || '#18181b',
            end: mapFilters.themeEndColor || '#18181b',
            opacity: mapFilters.themeOpacity || 90
        },
        username: flightProps.username,
        callsign: flightProps.callsign,
        phase: flightProps.phase || 'ENROUTE',
        // --- NEW: Pass the raw pilot state (0-3) ---
        pilotState: flightProps.pilotState !== undefined ? flightProps.pilotState : 0, 
        telemetry: {
            altitude: pos.alt_ft,
            groundSpeed: pos.gs_kt,
            verticalSpeed: pos.vs_fpm,
            heading: pos.heading_deg,
            squawk: '2000', 
            windDir: flightProps.wind_dir || 0,
            windSpd: flightProps.wind_spd_kts || 0
        },
        aircraft: {
            aircraftName: aircraft.aircraftName,
            liveryName: aircraft.liveryName,
            registration: finalRegistration 
        },
        images: {
            url: communityData ? communityData.imageUrl : (flightProps.communityImageUrl || ''),
            credit: communityData ? communityData.contributorName : (flightProps.contributorName || '')
        },
        route: {
            originIcao, originCountry,
            destIcao, destCountry,
            originTime: originTime,
            destTime: eta,
            progress: progress,
            elapsed: elapsed,
            eta: eta,
            ete: ete
        },
        waypoints: structuredWaypoints
    };
}

/**
     * --- [NEW FUNCTION] ---
     * Immediately calculates and sends flight data to the ND iframe.
     * This is called when the iframe signals it is 'ready' via postMessage.
     */
    function refreshNavDisplayFromCache() {
        if (!currentFlightInWindow) return;

        // 1. Get the current flight's feature from the cache
        const myFeature = currentMapFeatures[currentFlightInWindow];
        if (!myFeature || !myFeature.properties) return;

        const flightId = currentFlightInWindow;
        const flightProps = { ...myFeature.properties };
        
        // Parse position string back to object
        let position;
        try {
            position = JSON.parse(flightProps.position);
        } catch (e) { return; }

        // 2. Calculate TAS using the helper and cached OAT
        const cachedOat = currentAircraftPositionForGeocode ? (currentAircraftPositionForGeocode.oat_c || 15) : 15;
        const calculatedTas = calculateTas(position.alt_ft || 0, cachedOat, position.gs_kt || 0);
        const cachedWindDir = (currentAircraftPositionForGeocode && currentAircraftPositionForGeocode.wind_dir) || 0;
        const cachedWindSpd = (currentAircraftPositionForGeocode && currentAircraftPositionForGeocode.wind_spd_kts) || 0;

        // 3. Calculate Traffic
        const ndTraffic = [];
        const myLat = position.lat;
        const myLon = position.lon;
        const myAlt = position.alt_ft;

        Object.values(currentMapFeatures).forEach(feature => {
            const otherProps = feature.properties;
            if (otherProps.flightId === flightId) return;

            let otherPos;
            try {
                otherPos = JSON.parse(otherProps.position);
            } catch(e) { return; }

            const latDiff = Math.abs(otherPos.lat - myLat);
            const lonDiff = Math.abs(otherPos.lon - myLon);
            if (latDiff > 1 || lonDiff > 1) return; 

            const distKm = getDistanceKm(myLat, myLon, otherPos.lat, otherPos.lon);
            const distNM = distKm / 1.852;

            if (distNM < 45) {
                const bearingTo = getBearing(myLat, myLon, otherPos.lat, otherPos.lon);
                let relBearing = bearingTo - position.heading_deg;
                if (relBearing > 180) relBearing -= 360;
                if (relBearing < -180) relBearing += 360;
                const altDiffFt = otherPos.alt_ft - myAlt;
                const altDiff100 = Math.round(altDiffFt / 100);

                ndTraffic.push({
                    id: otherProps.flightId,
                    bearing: relBearing,
                    dist: distNM,
                    altDiff: altDiff100,
                    vs: otherPos.vs_fpm
                });
            }
        });

        // 4. Calculate Flight Plan (Logic copied from handleSocketFlightUpdate)
        let ndFlightPlan = [];
        let ndNextWp = "WYPT";
        let ndDist = 0;
        let ndEte = "00:00";

        if (cachedFlightDataForStatsView && cachedFlightDataForStatsView.plan) {
            const planItems = cachedFlightDataForStatsView.plan.flightPlanItems;
            const flatWaypoints = getFlatWaypointObjects(planItems);
            
            ndFlightPlan = flatWaypoints.map(wp => {
                if (!wp.location || wp.location.latitude == null || wp.location.longitude == null) return null;
                const distKm = getDistanceKm(myLat, myLon, wp.location.latitude, wp.location.longitude);
                const distNM = distKm / 1.852;
                const bearingTo = getBearing(myLat, myLon, wp.location.latitude, wp.location.longitude);
                const rad = bearingTo * Math.PI / 180;
                return {
                    name: wp.identifier || wp.name || 'WP',
                    x: Math.sin(rad) * distNM, 
                    y: Math.cos(rad) * distNM 
                };
            }).filter(Boolean);

            const currentTrack = position.heading_deg;
            let bestIndex = -1;
            let minDist = Infinity;

            if (flatWaypoints.length > 1) {
                for (let i = 1; i < flatWaypoints.length; i++) {
                    const wp = flatWaypoints[i];
                    if (!wp.location) continue;
                    
                    const dKm = getDistanceKm(myLat, myLon, wp.location.latitude, wp.location.longitude);
                    const b = getBearing(myLat, myLon, wp.location.latitude, wp.location.longitude);
                    const bDiff = Math.abs(normalizeBearingDiff(currentTrack - b));
                    
                    if (bDiff <= 100 && dKm < minDist) {
                        minDist = dKm;
                        bestIndex = i;
                    }
                }
            }

            if (bestIndex !== -1) {
                const wp = flatWaypoints[bestIndex];
                const distNM = minDist / 1.852;
                const gs = Math.max(1, position.gs_kt || 0);
                
                ndNextWp = wp.identifier || wp.name || "WPT";
                ndDist = Math.round(distNM);
                
                const totalMinutes = (distNM / gs) * 60;
                const h = Math.floor(totalMinutes / 60);
                const m = Math.floor(totalMinutes % 60);
                ndEte = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            }
        }

        // 5. Send to Iframe
        const navIframe = document.getElementById('nav-display-frame');
        if (navIframe && navIframe.contentWindow) {
            navIframe.contentWindow.postMessage({
                heading: position.heading_deg,
                track: position.heading_deg,
                gs: Math.round(position.gs_kt),
                tas: calculatedTas, 
                windDir: cachedWindDir, 
                windSpd: cachedWindSpd,
                traffic: ndTraffic,
                flightPlan: ndFlightPlan,
                nextWp: ndNextWp,
                nextWpDist: ndDist,
                nextWpEte: ndEte
            }, '*');
            console.log(`ND Iframe Handshake successful. Data pushed for ${flightId}`);
        }
    }

    async function initializeSectorOpsView() {
        const mapContainer = document.getElementById('sector-ops-map-fullscreen');
        const viewContainer = document.getElementById('standalone-map-view'); 
        
        if (!viewContainer || !mapContainer) return;
        
        mainContentLoader.classList.add('active');

        try {
            // --- [MOVED UP] 1. Initialize Map FIRST ---
            // We do this first so the map canvas is created at the bottom of the stack.
            // Any HTML injected afterwards will correctly sit ON TOP of the map.
            const selectedHub = "VIDP"; 
            await initializeSectorOpsMap(selectedHub);

            // --- 2. Inject Server Selector Pill ---
            if (!document.getElementById('server-selector-container')) {
                const selectorHtml = `
                    <div id="server-selector-container">
                        <button class="server-btn ${currentServerName === 'Expert Server' ? 'active' : ''}" data-server="Expert Server">Expert</button>
                        <button class="server-btn ${currentServerName === 'Training Server' ? 'active' : ''}" data-server="Training Server">Training</button>
                        <button class="server-btn ${currentServerName === 'Casual Server' ? 'active' : ''}" data-server="Casual Server">Casual</button>
                    </div>
                `;
                mapContainer.insertAdjacentHTML('beforeend', selectorHtml);
            }

            // --- 3. Inject the Search Bar ---
            if (!document.getElementById('sector-ops-search-container')) {
                const searchHtml = `
                    <div id="sector-ops-search-container">
                        <div class="search-bar-container">
                            <input type="text" id="sector-ops-search-input" placeholder="Search callsign..." autocomplete="off">
                            
                            <button id="sector-ops-search-clear" class="search-clear-btn" title="Clear">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                            
                            <div class="search-icon-label">
                                <i class="fa-solid fa-magnifying-glass"></i>
                            </div>
                        </div>
                        
                        <div id="search-results-dropdown" class="search-results-dropdown"></div>
                    </div>
                `;
                mapContainer.insertAdjacentHTML('beforeend', searchHtml);
            }

            // --- 4. Inject Airport Info Window ---
            if (!document.getElementById('airport-info-window')) {
                 const windowHtml = `
                    <div id="airport-info-window" class="info-window">
                        <div id="airport-window-content" class="info-window-content"></div>
                    </div>
                `;
                mapContainer.insertAdjacentHTML('beforeend', windowHtml);
            }

            // --- 5. Inject Aircraft Info Window ---
            if (!document.getElementById('aircraft-info-window')) {
                 const windowHtml = `
                    <div id="aircraft-info-window" class="info-window">
                        
                    </div>
                `;
                mapContainer.insertAdjacentHTML('beforeend', windowHtml);
            }

            // --- 6. Inject Weather Settings Window ---
            if (!document.getElementById('weather-settings-window')) {
                const windowHtml = `
                    <div id="weather-settings-window" class="info-window">
                        <div class="info-window-header">
                            <h3><i class="fa-solid fa-cloud-sun" style="margin-right: 10px;"></i> Weather Settings</h3>
                            <div class="info-window-actions">
                                <button class="weather-window-hide-btn" title="Hide"><i class="fa-solid fa-compress"></i></button>
                                <button class="weather-window-close-btn" title="Close"><i class="fa-solid fa-xmark"></i></button>
                            </div>
                        </div>
                        <div id="weather-window-content" class="info-window-content">
                            <ul class="weather-toggle-list">
                                <li class="weather-toggle-item">
                                    <span class="weather-toggle-label"><i class="fa-solid fa-cloud-rain"></i> Radar (Precip)</span>
                                    <label class="toggle-switch">
                                        <input type="checkbox" id="weather-toggle-precip">
                                        <span class="toggle-slider"></span>
                                    </label>
                                </li>
                                <li class="weather-toggle-item">
                                    <span class="weather-toggle-label"><i class="fa-solid fa-triangle-exclamation"></i> SIGMETs</span>
                                    <label class="toggle-switch">
                                        <input type="checkbox" id="weather-toggle-sigmets">
                                        <span class="toggle-slider"></span>
                                    </label>
                                </li>
                                <li class="weather-toggle-item">
                                    <span class="weather-toggle-label"><i class="fa-solid fa-cloud"></i> Cloud Cover</span>
                                    <label class="toggle-switch">
                                        <input type="checkbox" id="weather-toggle-clouds">
                                        <span class="toggle-slider"></span>
                                    </label>
                                </li>
                                <li class="weather-toggle-item">
                                    <span class="weather-toggle-label"><i class="fa-solid fa-wind"></i> Wind Speed</span>
                                    <label class="toggle-switch">
                                        <input type="checkbox" id="weather-toggle-wind">
                                        <span class="toggle-slider"></span>
                                    </label>
                                </li>
                            </ul>
                            <div class="weather-disclaimer-note">
                                <i class="fa-solid fa-server"></i>
                                <strong>Note:</strong> ONLY rain radar is provided. Other radars (sigmets, clouds, wind) are not available.
                            </div>
                        </div>
                    </div>
                `;
                mapContainer.insertAdjacentHTML('beforeend', windowHtml);
            }

            // --- 7. Inject Settings Window ---
            if (!document.getElementById('filter-settings-window')) {
                const windowHtml = `
                    <div id="filter-settings-window" class="info-window">
                        <div class="info-window-header">
                            <h3><i class="fa-solid fa-gear" style="margin-right: 10px;"></i> Settings</h3>
                            <div class="info-window-actions">
                                <button class="filter-window-hide-btn" title="Hide"><i class="fa-solid fa-compress"></i></button>
                                <button class="filter-window-close-btn" title="Close"><i class="fa-solid fa-xmark"></i></button>
                            </div>
                        </div>
                        <div id="filter-window-content" class="info-window-content">
                            <ul class="filter-toggle-list">
                                <li class="filter-toggle-item">
                                    <span class="filter-toggle-label"><i class="fa-solid fa-tower-broadcast"></i> Hide Staffed Airports</span>
                                    <label class="toggle-switch">
                                        <input type="checkbox" id="filter-toggle-atc">
                                        <span class="toggle-slider"></span>
                                    </label>
                                </li>

                                <li class="filter-toggle-item">
                                    <span class="filter-toggle-label"><i class="fa-solid fa-satellite"></i> Satellite Mode</span>
                                    <label class="toggle-switch">
                                        <input type="checkbox" id="filter-toggle-satellite-mode">
                                        <span class="toggle-slider"></span>
                                    </label>
                                </li>
                                
                                <li class="filter-toggle-item">
                                    <span class="filter-toggle-label"><i class="fa-solid fa-tags"></i> Show Aircraft Labels</span>
                                    <label class="toggle-switch">
                                        <input type="checkbox" id="filter-toggle-aircraft-labels">
                                        <span class="toggle-slider"></span>
                                    </label>
                                </li>
                            </ul>

                            <div class="filter-section-divider">
                                <span class="filter-section-title">Interface Style</span>
                            </div>
                            <ul class="filter-toggle-list" style="padding-top: 8px;">
                                <li class="filter-toggle-item">
                                    <span class="filter-toggle-label"><i class="fa-solid fa-tablet-screen-button"></i> Simple Flight Window</span>
                                    <label class="toggle-switch">
                                        <input type="checkbox" id="filter-toggle-simple-window">
                                        <span class="toggle-slider"></span>
                                    </label>
                                </li>
                            </ul>

                            <div class="filter-section-divider">
                                <span class="filter-section-title">Aircraft Icon Color</span>
                            </div>
                            <ul class="filter-toggle-list" id="icon-color-filter-group" style="padding-top: 8px;">
                                <li class="filter-radio-item">
                                    <input type="radio" id="icon-color-default" name="icon-color-mode" value="default" checked>
                                    <label for="icon-color-default"><i class="fa-solid fa-plane" style="color: #fff;"></i> Default (White)</label>
                                </li>
                                <li class="filter-radio-item">
                                    <input type="radio" id="icon-color-blue" name="icon-color-mode" value="blue">
                                    <label for="icon-color-blue"><i class="fa-solid fa-plane" style="color: #00a8ff;"></i> Blue</label>
                                </li>
                                <li class="filter-radio-item">
                                    <input type="radio" id="icon-color-orange" name="icon-color-mode" value="orange">
                                    <label for="icon-color-orange"><i class="fa-solid fa-plane" style="color: #ff9900;"></i> Orange</label>
                                </li>
                            </ul>
                            
                            <div class="filter-section-divider">
                                <span class="filter-section-title">Active Flight Plan Display</span>
                            </div>
                            <ul class="filter-toggle-list" id="plan-filter-group" style="padding-top: 8px;">
                                <li class="filter-radio-item">
                                    <input type="radio" id="plan-filter-none" name="plan-display-mode" value="none" checked>
                                    <label for="plan-filter-none"><i class="fa-solid fa-eye-slash"></i> Hide Plan</label>
                                </li>
                                <li class="filter-radio-item">
                                    <input type="radio" id="plan-filter-direct" name="plan-display-mode" value="direct">
                                    <label for="plan-filter-direct"><i class="fa-solid fa-route"></i> Direct to Destination</label>
                                </li>
                                <li class="filter-radio-item">
                                    <input type="radio" id="plan-filter-full" name="plan-display-mode" value="full">
                                    <label for="plan-filter-full"><i class="fa-solid fa-diagram-project"></i> Full Filed Plan</label>
                                </li>
                            </ul>

                            <div class="mobile-only-filter-section">
                                <div class="filter-section-divider">
                                    <span class="filter-section-title">Mobile Display Mode</span>
                                </div>
                                <ul class="filter-toggle-list" id="mobile-mode-filter-group" style="padding-top: 8px;">
                                    <li class="filter-radio-item">
                                        <input type="radio" id="mobile-mode-hud" name="mobile-display-mode" value="hud" checked>
                                        <label for="mobile-mode-hud"><i class="fa-solid fa-rocket"></i> HUD View</label>
                                    </li>
                                    <li class="filter-radio-item">
                                        <input type="radio" id="mobile-mode-legacy" name="mobile-display-mode" value="legacy">
                                        <label for="mobile-mode-legacy"><i class="fa-solid fa-layer-group"></i> Legacy Sheet</label>
                                    </li>
                                </ul>
                            </div>

                            <div class="filter-section-divider">
                                <span class="filter-section-title">Window Appearance</span>
                            </div>
                            <div class="filter-appearance-controls" style="padding: 10px; display: flex; flex-direction: column; gap: 10px;">
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <span style="color: #ccc; font-size: 0.9rem;">Gradient Start Color</span>
                                    <input type="color" id="theme-color-start" value="#121426" style="background: none; border: none; width: 50px; height: 30px; cursor: pointer;">
                                </div>
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <span style="color: #ccc; font-size: 0.9rem;">Gradient End Color</span>
                                    <input type="color" id="theme-color-end" value="#121426" style="background: none; border: none; width: 50px; height: 30px; cursor: pointer;">
                                </div>
                                <div style="display: flex; gap: 10px;">
                                     <button id="theme-reset-btn" class="cta-button" style="width: 100%; padding: 8px; font-size: 0.85rem; border-radius: 4px; background: rgba(255,255,255,0.1); border: 1px solid #444; color: #fff; cursor: pointer;">Reset Default Theme</button>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
                mapContainer.insertAdjacentHTML('beforeend', windowHtml);
            }
            
            // --- 8. Inject Toolbar Buttons (if missing) ---
            const toolbarToggleBtn = document.getElementById('toolbar-toggle-panel-btn');
            if (toolbarToggleBtn) {
                 if (!document.getElementById('airport-recall-btn')) {
                    toolbarToggleBtn.parentElement.insertAdjacentHTML('beforeend', `
                        <button id="airport-recall-btn" class="toolbar-btn" title="Show Airport Info">
                            <i class="fa-solid fa-location-dot"></i>
                        </button>
                    `);
                 }
                 if (!document.getElementById('aircraft-recall-btn')) {
                      toolbarToggleBtn.parentElement.insertAdjacentHTML('beforeend', `
                        <button id="aircraft-recall-btn" class="toolbar-btn" title="Show Aircraft Info">
                            <i class="fa-solid fa-plane-up"></i>
                        </button>
                    `);
                 }
                 if (!document.getElementById('open-weather-settings-btn')) {
                    toolbarToggleBtn.parentElement.insertAdjacentHTML('beforeend', `
                        <button id="open-weather-settings-btn" class="toolbar-btn" title="Weather Settings">
                            <i class="fa-solid fa-cloud-sun"></i>
                        </button>
                    `);
                 }
                 if (!document.getElementById('open-filter-settings-btn')) {
                    toolbarToggleBtn.parentElement.insertAdjacentHTML('beforeend', `
                        <button id="open-filter-settings-btn" class="toolbar-btn" title="Settings">
                            <i class="fa-solid fa-gear"></i>
                        </button>
                    `);
                 }
            }
            
            // --- 9. Assign Global Variables ---
            airportInfoWindow = document.getElementById('airport-info-window');
            airportInfoWindowRecallBtn = document.getElementById('airport-recall-btn');
            aircraftInfoWindow = document.getElementById('aircraft-info-window');
            aircraftInfoWindowRecallBtn = document.getElementById('aircraft-recall-btn');
            weatherSettingsWindow = document.getElementById('weather-settings-window');
            filterSettingsWindow = document.getElementById('filter-settings-window');

            // --- 10. Load Content and Setup Listeners ---
            await loadExternalPanelContent();

            setupSectorOpsEventListeners();
            setupAirportWindowEvents();
            setupAircraftWindowEvents();
            setupWeatherSettingsWindowEvents();
            setupFilterSettingsWindowEvents(); 
            
            // --- 11. Setup Search Listeners (Now that elements exist) ---
            setupSearchEventListeners();

            // --- [NEW] Initialize Smart Map Click ---
            setupSmartMapBackgroundClick(); 

            // --- 12. Listen for ND_READY signal ---
            window.addEventListener('message', (event) => {
                if (event.data && event.data.type === 'ND_READY') {
                    refreshNavDisplayFromCache();
                }
            });

            // --- 13. Start Live Loop ---
            startSectorOpsLiveLoop();

        } catch (error) {
            console.error("Error initializing Sector Ops view:", error);
            showNotification(error.message, 'error');
            const panelContentWrapper = document.querySelector('#sector-ops-floating-panel .panel-content-wrapper');
            if (panelContentWrapper) {
                panelContentWrapper.innerHTML = `<p class="error-text" style="padding: 20px;">${error.message}</p>`;
            }
        } finally {
            mainContentLoader.classList.remove('active');
        }
    }


function initializeSectorOpsMap(centerICAO) {
    if (!MAPBOX_ACCESS_TOKEN) {
        document.getElementById('sector-ops-map-fullscreen').innerHTML = '<p class="map-error-msg">Map service not available.</p>';
        return;
    }
    if (sectorOpsMap) sectorOpsMap.remove();

    const centerCoords = airportsData[centerICAO] ? [airportsData[centerICAO].lon, airportsData[centerICAO].lat] : [77.2, 28.6];

    sectorOpsMap = new mapboxgl.Map({
        container: 'sector-ops-map-fullscreen',
        style: currentMapStyle, // Use the global state variable
        center: centerCoords,
        zoom: 4.5,
        interactive: true,
        projection: 'globe'
    });


    /**
     * --- [FIXED] Generates the HTML for the Hover Card (FR24 Style) ---
     * Reads pre-cached image/contributor data from props.
     */
    function generateHoverCardHTML(props) {
        // 1. Data Parsing & Cached Lookup
        const aircraftData = typeof props.aircraft === 'string' ? JSON.parse(props.aircraft || '{}') : (props.aircraft || {});
        
        // --- READ CACHED BACKEND DATA ---
        const imagePath = props.communityImageUrl || '/CommunityPlanes/default.png'; // Use cached S3 URL
        const contributor = props.contributorName || 'IF Community'; // Use cached contributor
        
        // 2. Image Logic (Now simplified as it relies on the cached URL)
        const fallbackPath = '/CommunityPlanes/default.png';

        // 3. Airline Logo Logic (Unchanged)
        const livName = aircraftData.liveryName || '';
        const words = livName.trim().split(/\s+/);
        let logoName = words.length > 1 && /[^a-zA-Z0-9]/.test(words[1]) ? words[0] : (words[0] + (words[1] ? ' ' + words[1] : ''));
        const sanitizedLogoName = logoName.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_');
        const logoPath = `Images/airline_logos/${sanitizedLogoName}.png`;

        // 4. Formatting Data
        const callsign = props.callsign || 'N/A';
        const altitude = props.altitude ? Math.round(props.altitude).toLocaleString() : '0';
        const speed = props.speed ? Math.round(props.speed) : '0';
        
        // Create a short aircraft code 
        const acName = aircraftData.aircraftName || 'Unknown';
        let shortType = "JET";
        if(acName.includes("777")) shortType = "B77W";
        else if(acName.includes("737")) shortType = "B737";
        else if(acName.includes("320")) shortType = "A320";
        else if(acName.includes("321")) shortType = "A321";
        else if(acName.includes("350")) shortType = "A350";
        else if(acName.includes("380")) shortType = "A380";
        else if(acName.includes("787")) shortType = "B787";
        else shortType = acName.split(' ')[0].substring(0, 4).toUpperCase();

        // 5. Route Logic
        let routeText = "Enroute";
        if (props.origin && props.destination) {
            routeText = `${props.origin} to ${props.destination}`;
        } else if (aircraftData.origin && aircraftData.destination) {
             routeText = `${aircraftData.origin} to ${aircraftData.destination}`;
        }
        
        // 6. Progress Logic (Mocked or Real)
        const progressPercent = props.progress || 50; 

        // 7. HTML Construction
        return `
            <div class="fr24-card-container">
                <div class="fr24-image-box" style="background-image: url('${imagePath}'), url('${fallbackPath}');">
                    <div class="fr24-image-overlay"></div>
                    <span class="fr24-copyright">© ${contributor}</span>
                </div>

                <div class="fr24-info-box">
                    <div class="fr24-header-row">
                        <img src="${logoPath}" class="fr24-airline-logo" onerror="this.style.display='none'" alt="Logo">
                        <div style="display: flex; flex-direction: column; gap: 2px;">
                            <div class="fr24-ident-group">
                                <span class="fr24-callsign">${callsign}</span>
                                <span class="fr24-ac-badge">${shortType}</span>
                            </div>
                             <div class="fr24-route">${routeText}</div>
                        </div>
                    </div>
                   
                    <div class="fr24-progress-track">
                        <div class="fr24-progress-fill" style="width: ${progressPercent}%;"></div>
                    </div>

                    <div class="fr24-stats-row">
                        ${altitude} ft • ${speed} kts
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * --- [NEW] Extracted function to set up base layers.
     * This is called on initial load AND on every style change.
     */
    async function setupMapLayersAndFog() {
        // 1. Set globe fog
        sectorOpsMap.setFog({
            color: 'rgb(186, 210, 235)', // Lower atmosphere
            'high-color': 'rgb(36, 92, 223)', // Upper atmosphere
            'horizon-blend': 0.02, // Smooth blend
            'space-color': 'rgb(11, 11, 25)', // Space color
            'star-intensity': 0.6 // Adjust star intensity
        });

        // 2. Load all aircraft icons
        const iconsToLoad = [
            { id: 'icon-jumbo', path: '/Images/map_icons/jumbo.png' },
            { id: 'icon-widebody', path: '/Images/map_icons/widebody.png' },
            { id: 'icon-narrowbody', path: '/Images/map_icons/narrowbody.png' },
            { id: 'icon-regional', path: '/Images/map_icons/regional.png' },
            { id: 'icon-private', path: '/Images/map_icons/private.png' },
            { id: 'icon-fighter', path: '/Images/map_icons/fighter.png' },
            { id: 'icon-default', path: '/Images/map_icons/default.png' },
            { id: 'icon-military', path: '/Images/map_icons/military.png' },
            { id: 'icon-cessna', path: '/Images/map_icons/cessna.png' },
            { id: 'icon-jumbo-orange', path: '/Images/map_icons/orange/jumbo.png' },
            { id: 'icon-widebody-orange', path: '/Images/map_icons/orange/widebody.png' },
            { id: 'icon-narrowbody-orange', path: '/Images/map_icons/orange/narrowbody.png' },
            { id: 'icon-regional-orange', path: '/Images/map_icons/orange/regional.png' },
            { id: 'icon-private-orange', path: '/Images/map_icons/orange/private.png' },
            { id: 'icon-fighter-orange', path: '/Images/map_icons/orange/fighter.png' },
            { id: 'icon-default-orange', path: '/Images/map_icons/orange/default.png' },
            { id: 'icon-military-orange', path: '/Images/map_icons/orange/military.png' },
            { id: 'icon-cessna-orange', path: '/Images/map_icons/orange/cessna.png' },
            { id: 'icon-jumbo-blue', path: '/Images/map_icons/blue/jumbo.png' },
            { id: 'icon-widebody-blue', path: '/Images/map_icons/blue/widebody.png' },
            { id: 'icon-narrowbody-blue', path: '/Images/map_icons/blue/narrowbody.png' },
            { id: 'icon-regional-blue', path: '/Images/map_icons/blue/regional.png' },
            { id: 'icon-private-blue', path: '/Images/map_icons/blue/private.png' },
            { id: 'icon-fighter-blue', path: '/Images/map_icons/blue/fighter.png' },
            { id: 'icon-default-blue', path: '/Images/map_icons/blue/default.png' },
            { id: 'icon-military-blue', path: '/Images/map_icons/blue/military.png' },
            { id: 'icon-cessna-blue', path: '/Images/map_icons/blue/cessna.png' }
        ];

        const imagePromises = iconsToLoad.map(icon =>
            new Promise((res, rej) => {
                if (sectorOpsMap.hasImage(icon.id)) {
                    res();
                    return;
                }
                sectorOpsMap.loadImage(icon.path, (error, image) => {
                    if (error) {
                        console.warn(`Could not load icon: ${icon.path}`);
                        rej(error);
                    } else {
                        sectorOpsMap.addImage(icon.id, image);
                        res();
                    }
                });
            })
        );
        
        await Promise.all(imagePromises).catch(err => console.error("Error loading map icons", err));

        // 3. Add base flight data source
        if (!sectorOpsMap.getSource('sector-ops-live-flights-source')) {
            sectorOpsMap.addSource('sector-ops-live-flights-source', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: Object.values(currentMapFeatures) }
            });
        }

        mapAnimator = new MapAnimator(sectorOpsMap, 'sector-ops-live-flights-source', currentMapFeatures);

        // 4. Add the ICON layer
        if (!sectorOpsMap.getLayer('sector-ops-live-flights-layer')) {
            sectorOpsMap.addLayer({
                id: 'sector-ops-live-flights-layer',
                type: 'symbol',
                source: 'sector-ops-live-flights-source',
                layout: {
                    'icon-image': getIconImageExpression(mapFilters.iconColorMode),
                    'icon-size': 0.08,
                    'icon-rotate': ['get', 'heading'],
                    'icon-rotation-alignment': 'map',
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,
                }
            });

            sectorOpsMap.on('click', 'sector-ops-live-flights-layer', (e) => {
                const props = e.features[0].properties;
                const flightProps = { ...props, position: JSON.parse(props.position), aircraft: JSON.parse(props.aircraft) };
                fetch('https://site--acars-backend--6dmjph8ltlhv.code.run/if-sessions').then(res => res.json()).then(data => {
                    // [UPDATED] Use helper
                    const sessionId = getCurrentSessionId(data);
                    if (sessionId) {
                        handleAircraftClick(flightProps, sessionId);
                    }
                });
            });

            // -------------------------------------------------------------
            // --- NEW: HOVER POPUP LOGIC ---
            // -------------------------------------------------------------
            
            // ✅ FIX: Only attach hover listeners on non-mobile/tablet devices
            if (typeof window.MobileUIHandler === 'undefined' || !window.MobileUIHandler.isMobile()) {
                
                const hoverPopup = new mapboxgl.Popup({
                    closeButton: false,
                    closeOnClick: false,
                    offset: 20 // Distance from the aircraft icon
                });

                sectorOpsMap.on('mouseenter', 'sector-ops-live-flights-layer', (e) => {
                    // Change cursor
                    sectorOpsMap.getCanvas().style.cursor = 'pointer';

                    // Get properties
                    const coordinates = e.features[0].geometry.coordinates.slice();
                    const props = e.features[0].properties;

                    // Handle map wrapping
                    while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
                        coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
                    }

                    // Generate Custom "Widget" HTML
                    const cardHTML = generateHoverCardHTML(props);

                    // Set HTML and Show
                    hoverPopup.setLngLat(coordinates)
                              .setHTML(cardHTML)
                              .addTo(sectorOpsMap);
                });

                sectorOpsMap.on('mouseleave', 'sector-ops-live-flights-layer', () => {
                    sectorOpsMap.getCanvas().style.cursor = '';
                    hoverPopup.remove(); // Hide the card immediately on exit
                });
            } else {
                 console.log("Hover popup disabled for mobile device.");
            }
            // -------------------------------------------------------------
        }
        
        // 5. Add the LABEL layer
        if (!sectorOpsMap.getLayer('sector-ops-live-flights-labels')) {
            sectorOpsMap.addLayer({
                id: 'sector-ops-live-flights-labels',
                type: 'symbol',
                source: 'sector-ops-live-flights-source', 
                minzoom: 6.5,
                layout: {
                    'visibility': mapFilters.showAircraftLabels ? 'visible' : 'none',
                    'text-field': [
                        'format',
                        ['get', 'callsign'], { 'text-color': '#FFFFFF' }, 
                        '\n', {},                  
                        ['get', 'phase'],    
                        { 
                            'text-color': [ 
                                'match',
                                ['get', 'phase'],
                                'Climb', '#28a745',
                                'Cruise', '#007bff',
                                'Descent', '#ff9900',
                                'Approach', '#a33ea3',
                                'Ground', '#9fa8da',
                                '#e8eaf6'
                            ]
                        }
                    ],
                    'text-font': ['Mapbox Txt Regular', 'Arial Unicode MS Regular'],
                    'text-size': 10,
                    'text-offset': [0, 2.5],
                    'text-anchor': 'top',
                    'text-allow-overlap': false,
                    'text-ignore-placement': false,
                    'text-padding': 3,
                },
                paint: {
                    'text-halo-color': 'rgba(10, 12, 26, 0.85)',
                    'text-halo-width': 2,
                    'text-halo-blur': 0
                }
            });
        }
    }
    
    sectorOpsMap.on('style.load', async () => {
        console.log("Map style reloading. Rebuilding layers...");
        await setupMapLayersAndFog();
        rebuildDynamicLayers();
    });

    return new Promise(resolve => {
        sectorOpsMap.on('load', async () => {
            await setupMapLayersAndFog();
            resolve();
        });
    });
}



    /**
     * (REFACTORED) Clears only the route line layers from the map.
     */
    function clearRouteLayers() {
        sectorOpsMapRouteLayers.forEach(id => {
            if (sectorOpsMap.getLayer(id)) sectorOpsMap.removeLayer(id);
            if (sectorOpsMap.getSource(id)) sectorOpsMap.removeSource(id);
        });
        sectorOpsMapRouteLayers = [];
    }

    // NEW: Helper to clear the live flight trail from the map
    function clearLiveFlightPath(flightId) {
        if (!sectorOpsMap || !flightId) return;

        // Get all layers associated with this flight
        const layersObj = sectorOpsLiveFlightPathLayers[flightId];
        if (!layersObj) return;

        const ids = Object.values(layersObj);

        // --- PASS 1: Remove ALL Layers first ---
        ids.forEach(layerId => {
            if (layerId && sectorOpsMap.getLayer(layerId)) {
                sectorOpsMap.removeLayer(layerId);
            }
        });

        // --- PASS 2: Remove Sources ---
        // We do this only after all layers are gone to prevent "Source in use" errors.
        ids.forEach(sourceId => {
            if (sourceId && sectorOpsMap.getSource(sourceId)) {
                sectorOpsMap.removeSource(sourceId);
            }
        });
        
        delete sectorOpsLiveFlightPathLayers[flightId];
    }

    

 /**
     * --- [UPDATED] Rebuilds all dynamic layers after a map style change.
     * Ensures Volanta-style Radar and SIGMETs are restored correctly.
     */
    function rebuildDynamicLayers() {
        console.log("Rebuilding dynamic layers...");

        // 1. Re-apply SIGMETS (Volanta Style)
        if (document.getElementById('weather-toggle-sigmets')?.checked) {
            isSigmetLayerAdded = false; // Force re-fetch/re-add
            toggleSigmetLayer(true);
        }

        // 2. Re-apply Radar (Precip - RainViewer)
        // We set isWeatherLayerAdded = false to force it to re-fetch the dynamic RainViewer path
        if (document.getElementById('weather-toggle-precip')?.checked) {
            isWeatherLayerAdded = false; 
            toggleWeatherLayer(true);
        }

        // 3. Re-apply Clouds
        if (document.getElementById('weather-toggle-clouds')?.checked) {
            isCloudLayerAdded = false; // Force re-creation
            toggleCloudLayer(true);
        }

        // 4. Re-apply Wind
        if (document.getElementById('weather-toggle-wind')?.checked) {
            isWindLayerAdded = false; // Force re-creation
            toggleWindLayer(true);
        }

        // 5. Re-apply airport routes
        if (currentAirportInWindow) {
            // This function already clears old layers and re-adds new ones
            plotRoutesFromAirport(currentAirportInWindow);
        }

        // 6. Re-apply active flight trail
        if (currentFlightInWindow) {
            const flightId = currentFlightInWindow;
            
            // Clear any stray map state
            clearLiveFlightPath(flightId); 
            delete sectorOpsLiveFlightPathLayers[flightId]; 

            // Get cached data from when the window was opened
            const { flightProps, plan } = cachedFlightDataForStatsView;
            if (flightProps) {
                const localTrail = liveTrailCache.get(flightId) || [];
                const currentPosition = currentAircraftPositionForGeocode || flightProps.position;
                
                const routeFeatureCollection = generateAltitudeColoredRoute(localTrail, currentPosition, plan);

                // Re-add source
                sectorOpsMap.addSource(`flown-path-${flightId}`, {
                    type: 'geojson',
                    data: routeFeatureCollection
                });
                
                // Re-add layer
                sectorOpsMap.addLayer({
                    id: `flown-path-${flightId}`,
                    type: 'line',
                    source: `flown-path-${flightId}`,
                    paint: {
                        'line-color': [
                            'interpolate',
                            ['linear'],
                            ['get', 'avgAltitude'],
                            0,     '#e6e600',
                            10000, '#ff9900',
                            20000, '#ff3300',
                            29000, '#00BFFF',
                            38000, '#9400D3'
                        ],
                        'line-width': 4,
                        'line-opacity': [
                            'case',
                            ['boolean', ['get', 'simulated'], false],
                            0.6,
                            0.9
                        ],
                        'line-dasharray': [
                            'case',
                            ['boolean', ['get', 'simulated'], false],
                            ['literal', [2, 2]],
                            ['literal', [1, 0]]
                        ],
                        'line-translate': [0, -2],
                        'line-translate-anchor': 'viewport'
                    }
                }, 'sector-ops-live-flights-layer'); // Draw below aircraft
                
                sectorOpsLiveFlightPathLayers[flightId] = { flown: `flown-path-${flightId}` };
                console.log(`Rebuilt active trail for ${flightId}`);

                // Re-draw the planned route line based on filter state
                if (plan) {
                    const position = currentAircraftPositionForGeocode || flightProps.position;
                    updateFlightPlanLayer(flightId, plan, position);
                }
            }
        }
        
        // 7. Re-apply aircraft filters
        updateAircraftLayerFilter();

        // 8. Re-render airport markers
        renderAirportMarkers();
    }

/**
 * --- [MODIFIED] Draws or updates the filed flight plan layers (direct or full)
 * based on the current filter settings. Now uses DENSIFICATION for 3D paths.
 */
function updateFlightPlanLayer(flightId, plan, currentPosition) {
    if (!sectorOpsMap || !plan || !plan.flightPlanItems || plan.flightPlanItems.length < 2) {
        return; // Not enough data
    }

    const layerIdDirect = `plan-path-direct-${flightId}`;
    const layerIdFull = `plan-path-full-${flightId}`;
    const layerIdFullLabels = layerIdFull + '-labels';

    if (!sectorOpsLiveFlightPathLayers[flightId]) {
        sectorOpsLiveFlightPathLayers[flightId] = {};
    }
    sectorOpsLiveFlightPathLayers[flightId].planDirect = layerIdDirect;
    sectorOpsLiveFlightPathLayers[flightId].planFull = layerIdFull;
    sectorOpsLiveFlightPathLayers[flightId].planFullLabels = layerIdFullLabels;
    
    // --- Get coords ---
    const allWaypointsForLine = flattenWaypointsFromPlan(plan.flightPlanItems);
    if (allWaypointsForLine.length < 2) return;
    
    // Unwrap destination for direct line calculation
    const currentCoords = [currentPosition.lon, currentPosition.lat];
    const destinationCoords = unwrapLineCoordinates([currentCoords, allWaypointsForLine[allWaypointsForLine.length - 1]])[1];

    // --- 1. Handle "Direct to Destination" Line ---
    if (mapFilters.planDisplayMode === 'direct') {
        
        // [FIX] Densify the single long segment into a curve
        const directPath = densifyRoute([currentCoords, destinationCoords], 100); // 100km segments

        const directLineData = {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: directPath
            }
        };

        const source = sectorOpsMap.getSource(layerIdDirect);
        if (source) {
            source.setData(directLineData);
        } else {
            sectorOpsMap.addSource(layerIdDirect, { type: 'geojson', data: directLineData });
            sectorOpsMap.addLayer({
                id: layerIdDirect,
                type: 'line',
                source: layerIdDirect,
                paint: {
                    'line-color': '#00a8ff',
                    'line-width': 2,
                    'line-opacity': 0.8,
                    'line-dasharray': [2, 2]
                }
            }, 'sector-ops-live-flights-layer');
        }
    } else {
        if (sectorOpsMap.getLayer(layerIdDirect)) sectorOpsMap.removeLayer(layerIdDirect);
        if (sectorOpsMap.getSource(layerIdDirect)) sectorOpsMap.removeSource(layerIdDirect);
    }

    // --- 2. Handle "Full Filed Plan" Line ---
    if (mapFilters.planDisplayMode === 'full') {
        const source = sectorOpsMap.getSource(layerIdFull);
        if (!source) {
            // Get coordinates and unwrap them for date line safety
            let rawWaypoints = flattenWaypointsFromPlan(plan.flightPlanItems);
            let unwrappedWaypoints = unwrapLineCoordinates(rawWaypoints);

            // [FIX] Densify the segments between waypoints (e.g. oceanic legs)
            const densifiedWaypoints = densifyRoute(unwrappedWaypoints, 100);

            // Get points for labels (original waypoints only, don't label the densified dots)
            const waypointObjects = getFlatWaypointObjects(plan.flightPlanItems);

            const features = [];

            // 1. LineString (Densified Curve)
            features.push({
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: densifiedWaypoints
                }
            });

            // 2. Points (Labels)
            waypointObjects.forEach(wp => {
                if (wp.location && wp.location.longitude != null && wp.location.latitude != null) {
                    features.push({
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: [wp.location.longitude, wp.location.latitude]
                        },
                        properties: {
                            name: wp.identifier || wp.name || '' 
                        }
                    });
                }
            });
            
            const fullLineData = { type: 'FeatureCollection', features: features };
            
            sectorOpsMap.addSource(layerIdFull, { type: 'geojson', data: fullLineData });
            
            // Add LINE Layer
            sectorOpsMap.addLayer({
                id: layerIdFull,
                type: 'line',
                source: layerIdFull,
                'filter': ['==', '$type', 'LineString'], 
                paint: {
                    'line-color': '#aaaaaa',
                    'line-width': 2,
                    'line-opacity': 0.7,
                    'line-dasharray': [3, 3]
                }
            }, 'sector-ops-live-flights-layer');

            // Add LABEL Layer
            sectorOpsMap.addLayer({
                id: layerIdFullLabels,
                type: 'symbol',
                source: layerIdFull,
                'filter': ['==', '$type', 'Point'],
                layout: {
                    'text-field': ['get', 'name'],
                    'text-font': ['Mapbox Txt Regular', 'Arial Unicode MS Regular'],
                    'text-size': 10,
                    'text-offset': [0, 0.8],
                    'text-anchor': 'top',
                    'text-allow-overlap': false,
                    'text-ignore-placement': false
                },
                paint: {
                    'text-color': '#ffffff',
                    'text-halo-color': 'rgba(10, 12, 26, 0.9)',
                    'text-halo-width': 2,
                    'text-halo-blur': 1
                }
            }, 'sector-ops-live-flights-layer');
        }
    } else {
        if (sectorOpsMap.getLayer(layerIdFullLabels)) sectorOpsMap.removeLayer(layerIdFullLabels);
        if (sectorOpsMap.getLayer(layerIdFull)) sectorOpsMap.removeLayer(layerIdFull);
        if (sectorOpsMap.getSource(layerIdFull)) sectorOpsMap.removeSource(layerIdFull);
    }
}


    async function handleAirportClick(icao) {
        if (currentAirportInWindow && currentAirportInWindow !== icao) {
            airportInfoWindow.classList.remove('visible');
            airportInfoWindowRecallBtn.classList.remove('visible');
            clearRouteLayers();
        }

        plotRoutesFromAirport(icao);

        const airport = airportsData[icao];
        if (!airport) return;

        const contentEl = document.getElementById('airport-window-content');
        contentEl.innerHTML = `<div class="spinner-small" style="margin: 2rem auto;"></div>`; // Loading state
        
        // --- MOVED UP: Trigger Mobile UI immediately to show the sheet ---
        if (window.MobileUIHandler && window.MobileUIHandler.isMobile()) {
            window.MobileUIHandler.openWindow(airportInfoWindow);
        } else {
            airportInfoWindow.classList.add('visible');
        }

        airportInfoWindowRecallBtn.classList.remove('visible');
        currentAirportInWindow = icao;

        const windowContentHTML = await createAirportInfoWindowHTML(icao);

        if (windowContentHTML) {
            contentEl.innerHTML = windowContentHTML;
            contentEl.scrollTop = 0;

            // --- REDESIGNED TAB SWITCHING LOGIC ---
            const tabContainer = contentEl.querySelector('.apt-tabs-header');
            if (tabContainer) {
                tabContainer.addEventListener('click', (e) => {
                    const btn = e.target.closest('.apt-tab-btn');
                    if (!btn) return;

                    const allBtns = tabContainer.querySelectorAll('.apt-tab-btn');
                    allBtns.forEach(b => b.classList.remove('active'));

                    btn.classList.add('active');

                    const allContent = contentEl.querySelectorAll('.apt-tab-content');
                    allContent.forEach(content => content.classList.remove('active'));

                    const targetId = btn.dataset.target;
                    const targetContent = contentEl.querySelector(`#${targetId}`);
                    if (targetContent) {
                        targetContent.classList.add('active');
                    }
                });
            }
        } else {
             airportInfoWindow.classList.remove('visible');
             // Also close mobile window if fetch failed
             if (window.MobileUIHandler && window.MobileUIHandler.isMobile()) {
                 window.MobileUIHandler.closeActiveWindow();
             }
             currentAirportInWindow = null;
        }
    }

    /**
 * --- [NEW HELPER FUNCTION FOR WAYPOINT FIX] ---
 * Recursively flattens the nested flightPlanItems from the SimBrief API plan
 * into a single, clean array of the full waypoint *objects*.
 * @param {Array} items - The flightPlanItems array from the API response.
 * @returns {Array<object>} A flat array of waypoint objects.
 */
function getFlatWaypointObjects(items) {
    const waypoints = [];
    if (!Array.isArray(items)) return waypoints;

    const extract = (planItems) => {
        for (const item of planItems) {
            // If an item is a container for a procedure (like a SID/STAR),
            // ignore its own object and process its children instead.
            if (Array.isArray(item.children) && item.children.length > 0) {
                extract(item.children);
            } 
            // Otherwise, if it's a simple waypoint, add its object.
            else if (item.location && typeof item.location.longitude === 'number' && typeof item.location.latitude === 'number' && (item.location.latitude !== 0 || item.location.longitude !== 0)) {
                waypoints.push(item); // Push the whole object
            }
        }
    };

    extract(items);
    return waypoints;
}
    
    /**
     * --- [FIXED HELPER] ---
     * Recursively flattens the nested flightPlanItems from the SimBrief API plan
     * into a single, clean array of [longitude, latitude] coordinates.
     * This version correctly handles nested procedures like SIDs and STARs.
     * @param {Array} items - The flightPlanItems array from the API response.
     * @returns {Array<[number, number]>} A flat array of coordinates.
     */
    function flattenWaypointsFromPlan(items) {
        const waypoints = [];
        if (!Array.isArray(items)) return waypoints;

        const extract = (planItems) => {
            for (const item of planItems) {
                // If an item is a container for a procedure (like a SID/STAR),
                // ignore its own coordinates and process its children instead.
                if (Array.isArray(item.children) && item.children.length > 0) {
                    extract(item.children);
                } 
                // Otherwise, if it's a simple waypoint, add its coordinates.
                else if (item.location && typeof item.location.longitude === 'number' && typeof item.location.latitude === 'number' && (item.location.latitude !== 0 || item.location.longitude !== 0)) {
                    waypoints.push([item.location.longitude, item.location.latitude]);
                }
            }
        };

        extract(items);
        return waypoints;
    }


function calculateTurnAngle(p1, p2, p3) {
    // Vectors
    const v1 = { x: p2.longitude - p1.longitude, y: p2.latitude - p1.latitude };
    const v2 = { x: p3.longitude - p2.longitude, y: p3.latitude - p2.latitude };

    // Dot product & Magnitudes
    const dot = (v1.x * v2.x) + (v1.y * v2.y);
    const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
    const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);

    if (mag1 === 0 || mag2 === 0) return 0;

    // Angle in radians
    const angleRad = Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2))));
    return angleRad * (180 / Math.PI); // Convert to degrees
}

/**
 * --- [HELPER] Generates a smoothed coordinate array using Cubic Hermite Splines ---
 */
function generateSmoothPath(points) {
    if (points.length < 3) return points;

    const smoothPoints = [];
    const mathPoints = points.map(p => ({ x: p.unwrappedLongitude, y: p.latitude, alt: p.altitude }));

    // Add phantom points for spline continuity
    mathPoints.unshift(mathPoints[0]);
    mathPoints.push(mathPoints[mathPoints.length - 1]);

    for (let i = 0; i < mathPoints.length - 3; i++) {
        const p0 = mathPoints[i];
        const p1 = mathPoints[i + 1];
        const p2 = mathPoints[i + 2];
        const p3 = mathPoints[i + 3];

        const dist = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
        // Dynamic resolution: more segments for longer lines to keep curvature smooth
        const segments = Math.max(2, Math.floor(dist * 8)); 

        if (i === 0) {
            smoothPoints.push({ unwrappedLongitude: p1.x, latitude: p1.y, altitude: p1.alt });
        }

        for (let j = 1; j <= segments; j++) {
            const t = j / segments;
            const t2 = t * t, t3 = t2 * t;

            // Cardinal Spline / Catmull-Rom Simplified
            const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
            const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
            const alt = p1.alt + (p2.alt - p1.alt) * t;

            smoothPoints.push({ unwrappedLongitude: x, latitude: y, altitude: alt });
        }
    }
    return smoothPoints;
}

/**
 * --- [FIXED v5] Smart Route Generator ---
 * Fixes:
 * 1. Intelligent Plan Backfill (Simulated History).
 * 2. Gap Filling.
 * 3. Date Line Safety.
 * 4. 3D Great Circle Densification.
 * 5. [NEW] Disables Spline Smoothing for sparse/simulated paths to prevent "bowing".
 */
function generateAltitudeColoredRoute(sortedPoints, currentPosition, flightPlan = null) {
    const features = [];
    const GAP_THRESHOLD_KM = 20; 
    const MIN_DIST_FROM_NOSE_KM = 0.2; 
    
    // Maximum segment length for 3D rendering. 
    const MAX_RENDER_SEGMENT_KM = 50; 

    // --- 1. PREPARE FLIGHT PLAN WAYPOINTS ---
    let flatPlan = [];
    if (flightPlan && flightPlan.flightPlanItems) {
        const extract = (items) => {
            let res = [];
            items.forEach(item => {
                if (item.children && item.children.length) res = res.concat(extract(item.children));
                else if (item.location) res.push({ lat: item.location.latitude, lon: item.location.longitude, alt: item.altitude || 0 });
            });
            return res;
        };
        flatPlan = extract(flightPlan.flightPlanItems);
    }

    // Helper: Find closest waypoint index in plan
    const getPlanIndex = (lat, lon) => {
        let bestIdx = -1, minD = Infinity;
        for(let i=0; i<flatPlan.length; i++) {
            const d = getDistanceKm(lat, lon, flatPlan[i].lat, flatPlan[i].lon);
            if (d < minD && d < 500) { 
                minD = d;
                bestIdx = i;
            }
        }
        return bestIdx;
    };

    // --- 2. SANITIZATION ---
    const cleanHistory = sortedPoints.filter((p, i) => {
        if (!p.latitude || !p.longitude) return false;
        if (getDistanceKm(p.latitude, p.longitude, currentPosition.lat, currentPosition.lon) < MIN_DIST_FROM_NOSE_KM) return false;
        if (i > 0) {
            const prev = sortedPoints[i-1];
            if (getDistanceKm(p.latitude, p.longitude, prev.latitude, prev.longitude) < 0.2) return false;
        }
        return true;
    });

    // --- 3. SPIKE REMOVAL ---
    let deSpikedHistory = [];
    if (cleanHistory.length > 0) deSpikedHistory.push(cleanHistory[0]);

    for (let i = 1; i < cleanHistory.length - 1; i++) {
        const prev = deSpikedHistory[deSpikedHistory.length - 1];
        const curr = cleanHistory[i];
        const next = cleanHistory[i+1];
        const turnAngle = calculateTurnAngle(prev, curr, next); 
        if (Math.abs(turnAngle) < 130) { 
            deSpikedHistory.push(curr);
        }
    }
    if (cleanHistory.length > 1) deSpikedHistory.push(cleanHistory[cleanHistory.length - 1]);

    // --- 4. INTELLIGENT PLAN BACKFILL ---
    let effectiveHistory = [...deSpikedHistory];

    if (flatPlan.length > 0) {
        const currentPlanIdx = getPlanIndex(currentPosition.lat, currentPosition.lon);
        
        if (effectiveHistory.length < 5 && currentPlanIdx > 0) {
            // Case A: Missing history -> Simulate from plan
            const simulated = flatPlan.slice(0, currentPlanIdx + 1).map(wp => ({
                latitude: wp.lat,
                longitude: wp.lon,
                altitude: wp.alt,
                groundSpeed: 0
            }));
            effectiveHistory = simulated;
        } 
        else if (effectiveHistory.length >= 5) {
            // Case B: Partial history -> Prepend plan
            const firstHist = effectiveHistory[0];
            const startPlanIdx = getPlanIndex(firstHist.latitude, firstHist.longitude);
            
            if (startPlanIdx > 2) {
                const prefix = flatPlan.slice(0, startPlanIdx).map(wp => ({
                    latitude: wp.lat,
                    longitude: wp.lon,
                    altitude: wp.alt
                }));
                effectiveHistory = [...prefix, ...effectiveHistory];
            }
        }
    }

    // --- 5. CONSTRUCT FINAL ARRAY (With Gap Filling) ---
    const finalPoints = [];
    let prevPoint = null;

    effectiveHistory.forEach((p) => {
        const point = { ...p, unwrappedLongitude: p.longitude };
        
        if (prevPoint) {
            const dist = getDistanceKm(prevPoint.latitude, prevPoint.longitude, point.latitude, point.longitude);
            if (dist > GAP_THRESHOLD_KM && flatPlan.length > 0) {
                const startIdx = getPlanIndex(prevPoint.latitude, prevPoint.longitude);
                const endIdx = getPlanIndex(point.latitude, point.longitude);

                if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
                    for (let k = startIdx + 1; k < endIdx; k++) {
                        const wp = flatPlan[k];
                        const injectedAlt = wp.alt > 100 ? wp.alt : (prevPoint.altitude + point.altitude) / 2;
                        finalPoints.push({
                            latitude: wp.lat,
                            longitude: wp.lon,
                            unwrappedLongitude: wp.lon, 
                            altitude: injectedAlt
                        });
                    }
                }
            }
        }
        finalPoints.push(point);
        prevPoint = point;
    });

    // Add Nose
    finalPoints.push({
        latitude: currentPosition.lat,
        longitude: currentPosition.lon,
        unwrappedLongitude: currentPosition.lon,
        altitude: currentPosition.alt_ft
    });

    if (finalPoints.length < 2) return { type: 'FeatureCollection', features: [] };

    // --- 6. UNWRAP LONGITUDES ---
    let lastUnwrappedLon = finalPoints[0].longitude; 
    finalPoints[0].unwrappedLongitude = lastUnwrappedLon;
    let maxLatitude = 0; // Track max lat for safety

    for (let i = 1; i < finalPoints.length; i++) {
        let currentRawLon = finalPoints[i].longitude;
        let delta = currentRawLon - (lastUnwrappedLon % 360);
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        let newUnwrappedLon = lastUnwrappedLon + delta;
        finalPoints[i].unwrappedLongitude = newUnwrappedLon;
        lastUnwrappedLon = newUnwrappedLon;
        
        const absLat = Math.abs(finalPoints[i].latitude);
        if (absLat > maxLatitude) maxLatitude = absLat;
    }

    // --- 7. NORMALIZE STRIP ---
    const headLon = finalPoints[finalPoints.length - 1].unwrappedLongitude;
    const shift = Math.round(headLon / 360) * 360;
    if (shift !== 0) {
        for (let i = 0; i < finalPoints.length; i++) {
            finalPoints[i].unwrappedLongitude -= shift;
        }
    }

    // --- 8. SMOOTHING (WITH SAFETY CHECK) ---
    // [FIX] Calculate average segment distance.
    // If points are far apart (e.g. > 20km), it means this is a simulated plan (not live breadcrumbs).
    // Applying spline smoothing to points 500km apart creates massive distortions (the "bowing" issue).
    let totalPathDist = 0;
    for(let i=0; i<finalPoints.length-1; i++) {
        totalPathDist += getDistanceKm(
            finalPoints[i].latitude, finalPoints[i].unwrappedLongitude, 
            finalPoints[i+1].latitude, finalPoints[i+1].unwrappedLongitude
        );
    }
    const avgSegmentDist = totalPathDist / (finalPoints.length - 1);
    
    // Disable smoothing if:
    // 1. We are at high latitudes (> 60 deg) where Mercator distortion breaks splines.
    // 2. The data is sparse (> 20km gaps), meaning we should rely on Great Circle densification (Step 9) instead.
    const shouldDisableSmoothing = (maxLatitude > 60) || (avgSegmentDist > 20);

    let smoothPoints;
    if (shouldDisableSmoothing) {
        smoothPoints = finalPoints.map(p => ({
            unwrappedLongitude: p.unwrappedLongitude,
            latitude: p.latitude,
            altitude: p.altitude
        }));
    } else {
        smoothPoints = generateSmoothPath(finalPoints);
    }

    // Lock Nose
    const trueEnd = finalPoints[finalPoints.length - 1];
    const smoothEnd = smoothPoints[smoothPoints.length - 1];
    smoothEnd.latitude = trueEnd.latitude;
    smoothEnd.unwrappedLongitude = trueEnd.unwrappedLongitude;
    smoothEnd.altitude = trueEnd.altitude;

    // --- 9. BUILD GEOJSON (WITH 3D DENSIFICATION) ---
    for (let i = 0; i < smoothPoints.length - 1; i++) {
        const p1 = smoothPoints[i];
        const p2 = smoothPoints[i+1];

        // Basic Sanity Check
        if (Math.abs(p1.latitude - p2.latitude) > 40 || Math.abs(p1.unwrappedLongitude - p2.unwrappedLongitude) > 100) continue;

        const distKm = getDistanceKm(p1.latitude, p1.unwrappedLongitude, p2.latitude, p2.unwrappedLongitude);

        if (distKm > MAX_RENDER_SEGMENT_KM) {
            const steps = Math.ceil(distKm / MAX_RENDER_SEGMENT_KM);
            
            for (let j = 0; j < steps; j++) {
                const fractionStart = j / steps;
                const fractionEnd = (j + 1) / steps;

                // Interpolate Coordinates (Great Circle)
                const startCoord = getIntermediatePoint(p1.latitude, p1.unwrappedLongitude, p2.latitude, p2.unwrappedLongitude, fractionStart);
                const endCoord = getIntermediatePoint(p1.latitude, p1.unwrappedLongitude, p2.latitude, p2.unwrappedLongitude, fractionEnd);

                // Interpolate Altitude (Linear)
                const startAlt = p1.altitude + (p2.altitude - p1.altitude) * fractionStart;
                const endAlt = p1.altitude + (p2.altitude - p1.altitude) * fractionEnd;
                const avgChunkAlt = (startAlt + endAlt) / 2;

                const normalizeLon = (lon, ref) => {
                    let d = lon - (ref % 360);
                    if (d > 180) d -= 360;
                    if (d < -180) d += 360;
                    return ref + d;
                };

                features.push({
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: [
                            [normalizeLon(startCoord.lon, p1.unwrappedLongitude), startCoord.lat],
                            [normalizeLon(endCoord.lon, p1.unwrappedLongitude), endCoord.lat]
                        ]
                    },
                    properties: {
                        avgAltitude: avgChunkAlt,
                        simulated: false 
                    }
                });
            }
        } else {
            const avgAlt = (p1.altitude + p2.altitude) / 2;
            features.push({
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: [
                        [p1.unwrappedLongitude, p1.latitude],
                        [p2.unwrappedLongitude, p2.latitude]
                    ]
                },
                properties: {
                    avgAltitude: avgAlt,
                    simulated: false 
                }
            });
        }
    }

    return { type: 'FeatureCollection', features: features };
}

/**
 * --- [NEW] Reusable function to close the aircraft window and clean up resources ---
 */
function closeAircraftWindow() {
    if (!aircraftInfoWindow) return;

    // 1. Hide UI
    aircraftInfoWindow.classList.remove('visible');
    if (window.MobileUIHandler) window.MobileUIHandler.closeActiveWindow();
    if (aircraftInfoWindowRecallBtn) aircraftInfoWindowRecallBtn.classList.remove('visible');

    // 2. Clear Map Elements
    clearLiveFlightPath(currentFlightInWindow); 

    // 3. Clear ALL Intervals (Critical for performance)
    if (activePfdUpdateInterval) {
        clearInterval(activePfdUpdateInterval);
        activePfdUpdateInterval = null;
    }
    if (activeGeocodeUpdateInterval) {
        clearInterval(activeGeocodeUpdateInterval);
        activeGeocodeUpdateInterval = null;
    }
    if (activeWeatherUpdateInterval) {
        clearInterval(activeWeatherUpdateInterval);
        activeWeatherUpdateInterval = null;
    }

    // 4. Reset State
    currentAircraftPositionForGeocode = null;
    liveTrailCache.delete(currentFlightInWindow);
    currentFlightInWindow = null;
    cachedFlightDataForStatsView = { flightProps: null, plan: null };
    
    // 5. Reset PFD visual state
    resetPfdState();
}

async function handleAircraftClick(flightProps, sessionId) {
    if (!flightProps || !flightProps.flightId) return;

    if (isAircraftWindowLoading) return;

    // Prevent re-opening the same flight if already visible
    if (currentFlightInWindow === flightProps.flightId && aircraftInfoWindow.classList.contains('visible')) {
        return;
    }

    isAircraftWindowLoading = true;

    // 1. Clear ALL existing intervals to prevent memory leaks and ghost updates
    if (activePfdUpdateInterval) clearInterval(activePfdUpdateInterval);
    if (activeGeocodeUpdateInterval) clearInterval(activeGeocodeUpdateInterval);
    if (activeWeatherUpdateInterval) clearInterval(activeWeatherUpdateInterval);
    activePfdUpdateInterval = null;
    activeGeocodeUpdateInterval = null;
    activeWeatherUpdateInterval = null;

    resetPfdState();

    if (currentFlightInWindow && currentFlightInWindow !== flightProps.flightId) {
        clearLiveFlightPath(currentFlightInWindow);
        liveTrailCache.delete(currentFlightInWindow);
    }

    // Update State
    currentFlightInWindow = flightProps.flightId; 
    currentAircraftPositionForGeocode = flightProps.position; 
    lastGeocodeCoords = { lat: 0, lon: 0 }; 
    cachedFlightDataForStatsView = { flightProps: null, plan: null };

    const windowEl = document.getElementById('aircraft-info-window');
    
    // Show Loading Spinner
    windowEl.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 300px; color: #fff;">
            <div class="spinner-small" style="margin-bottom: 1rem;"></div>
            <p style="font-family: 'Inter', sans-serif; font-size: 0.9rem; color: #94a3b8;">Acquiring Flight Data...</p>
        </div>
    `;

    if (window.MobileUIHandler && window.MobileUIHandler.isMobile()) {
        window.MobileUIHandler.openWindow(aircraftInfoWindow);
    } else {
        aircraftInfoWindow.classList.add('visible');
    }
    aircraftInfoWindowRecallBtn.classList.remove('visible');

    try {
        const acName = flightProps.aircraft?.aircraftName || '';
        const livName = flightProps.aircraft?.liveryName || '';

        // 2. Parallel Data Fetch
        const [planRes, routeRes, aircraftLookupRes] = await Promise.all([
            fetch(`${LIVE_FLIGHTS_API_URL}/${sessionId}/${flightProps.flightId}/plan`),
            fetch(`${LIVE_FLIGHTS_API_URL}/${sessionId}/${flightProps.flightId}/route`),
            fetch(`${API_BASE_URL}/api/aircraft/lookup?type=${encodeURIComponent(acName)}&livery=${encodeURIComponent(livName)}`)
        ]);
        
        const planData = planRes.ok ? await planRes.json() : null;
        const plan = (planData && planData.ok) ? planData.plan : null;
        const routeData = routeRes.ok ? await routeRes.json() : null;
        
        let communityData = null;
        if (aircraftLookupRes.ok) communityData = await aircraftLookupRes.json();
        
        let sortedRoutePoints = [];
        if (routeData && routeData.ok && Array.isArray(routeData.route)) {
            sortedRoutePoints = routeData.route.sort((a, b) => new Date(a.date) - new Date(b.date));
        }
        
        liveTrailCache.set(flightProps.flightId, sortedRoutePoints);
        cachedFlightDataForStatsView = { flightProps, plan };

        // 3. Inject Iframe based on Selection Mode
        if (mapFilters.useSimpleFlightWindow) {
            // --- SIMPLE WINDOW (flightinfo.html) ---
            windowEl.style.width = '420px'; 
            windowEl.style.height = 'calc(100vh - 40px)';
            windowEl.innerHTML = `<iframe id="simple-flight-window-frame" src="flightinfo.html" style="width:100%; height:100%; border:none;" scrolling="no"></iframe>`;
            
            const iframe = document.getElementById('simple-flight-window-frame');
            const simplePayload = formatDataForSimpleWindow(flightProps, plan, sortedRoutePoints, communityData);
            
            iframe.onload = () => {
                // Simple window uses FLIGHT_DATA_UPDATE for everything
                iframe.contentWindow.postMessage({ type: 'FLIGHT_DATA_UPDATE', payload: simplePayload }, '*');
            };
        } else {
            // --- STANDARD WINDOW (standard-flight-info.html) ---
            windowEl.style.width = ''; 
            windowEl.style.height = ''; 
            windowEl.innerHTML = `<iframe id="standard-flight-window-frame" src="standard-flight-info.html" style="width:100%; height:100%; border:none;" scrolling="no"></iframe>`;
            
            const iframe = document.getElementById('standard-flight-window-frame');
            const standardPayload = formatWindowPayload(flightProps, plan, sortedRoutePoints, communityData);
            
            iframe.onload = () => {
                // Standard window REQUIRES 'INITIAL_LOAD' to set up its state
                iframe.contentWindow.postMessage({ type: 'INITIAL_LOAD', payload: standardPayload }, '*');
            };
        }

        // 4. Start Background Helpers
        fetchAndDisplayGeocode(flightProps.position.lat, flightProps.position.lon);
        fetchAndDisplayWeather();

        // Start Intervals (Geocode every 5 mins)
        activeGeocodeUpdateInterval = setInterval(() => {
            if (currentAircraftPositionForGeocode) {
                fetchAndDisplayGeocode(currentAircraftPositionForGeocode.lat, currentAircraftPositionForGeocode.lon);
            }
        }, 300000);

        // Map Trails
        const flownLayerId = `flown-path-${flightProps.flightId}`;
        const routeFC = generateAltitudeColoredRoute(sortedRoutePoints, flightProps.position, plan);
        if (!sectorOpsMap.getSource(flownLayerId)) {
            sectorOpsMap.addSource(flownLayerId, { type: 'geojson', data: routeFC });
            sectorOpsMap.addLayer({
                id: flownLayerId,
                type: 'line',
                source: flownLayerId,
                paint: {
                    'line-color': ['interpolate', ['linear'], ['get', 'avgAltitude'], 0, '#e6e600', 10000, '#ff9900', 20000, '#ff3300', 29000, '#00BFFF', 38000, '#9400D3'],
                    'line-width': 4,
                    'line-opacity': 0.9
                }
            }, 'sector-ops-live-flights-layer');
        }
        sectorOpsLiveFlightPathLayers[flightProps.flightId] = { flown: flownLayerId };
        if (plan) updateFlightPlanLayer(flightProps.flightId, plan, flightProps.position);

        isAircraftWindowLoading = false;
    } catch (error) {
        console.error("Window Load Error:", error);
        windowEl.innerHTML = `<p style="padding: 20px; color: #f87171;">Error loading flight data.</p>`;
        isAircraftWindowLoading = false;
    }
}

/**
 * --- [NEW] Rebuilds all dynamic layers after a map style change.
 * This includes weather, airport routes, and the active aircraft trail.
 */
function rebuildDynamicLayers() {
    console.log("Rebuilding dynamic layers...");

    // 1. Re-apply weather layers
    if (document.getElementById('weather-toggle-precip')?.checked) {
        isWeatherLayerAdded = false; // Force re-creation
        toggleWeatherLayer(true);
    }
    if (document.getElementById('weather-toggle-clouds')?.checked) {
        isCloudLayerAdded = false; // Force re-creation
        toggleCloudLayer(true);
    }
    if (document.getElementById('weather-toggle-wind')?.checked) {
        isWindLayerAdded = false; // Force re-creation
        toggleWindLayer(true);
    }

    // 2. Re-apply airport routes
    if (currentAirportInWindow) {
        // This function already clears old layers and re-adds new ones
        plotRoutesFromAirport(currentAirportInWindow);
    }

    // 3. Re-apply active flight trail
    if (currentFlightInWindow) {
        const flightId = currentFlightInWindow;
        
        // Clear any stray map state
        clearLiveFlightPath(flightId); 
        delete sectorOpsLiveFlightPathLayers[flightId]; 

        // Get cached data from when the window was opened
        const { flightProps, plan } = cachedFlightDataForStatsView; // <-- Add 'plan'
        if (flightProps) {
            const localTrail = liveTrailCache.get(flightId) || [];
            const currentPosition = currentAircraftPositionForGeocode || flightProps.position;
            const routeFeatureCollection = generateAltitudeColoredRoute(localTrail, currentPosition);

            // Re-add source
            sectorOpsMap.addSource(`flown-path-${flightId}`, { // Use base ID
                type: 'geojson',
                data: routeFeatureCollection
            });
            
            // Re-add layer (copying paint properties from handleAircraftClick)
            sectorOpsMap.addLayer({
                id: `flown-path-${flightId}`, // Use base ID
                type: 'line',
                source: `flown-path-${flightId}`, // Use base ID
                paint: {
                    'line-color': [
                        'interpolate',
                        ['linear'],
                        ['get', 'avgAltitude'],
                        0,     '#e6e600',
                        10000, '#ff9900',
                        20000, '#ff3300',
                        29000, '#00BFFF',
                        38000, '#9400D3'
                    ],
                    'line-width': 4,
                    // --- [MODIFIED] Uniform Opacity ---
                    'line-opacity': 0.9,
                    // --- [MODIFIED] Solid Line Only ---
                    'line-dasharray': [1, 0],

                    'line-translate': [0, -2],
                    'line-translate-anchor': 'viewport'
                }
            }, 'sector-ops-live-flights-layer'); // Draw below aircraft
            
            sectorOpsLiveFlightPathLayers[flightId] = { flown: `flown-path-${flightId}` };
            console.log(`Rebuilt active trail for ${flightId}`);

            // --- [START NEW] ---
            // Re-draw the planned route line based on filter state
            if (plan) {
                const position = currentAircraftPositionForGeocode || flightProps.position;
                updateFlightPlanLayer(flightId, plan, position);
            }
            // --- [END NEW] ---
        }
    }
    
    // 4. Re-apply aircraft filters
    updateAircraftLayerFilter();

    // 5. Re-render airport markers
    renderAirportMarkers();
}


function updateFmsLegsModule(plan, currentPos) {
    const listContainer = document.getElementById('fms-legs-list');
    const totalDistEl = document.getElementById('fms-total-dist');
    const totalEteEl = document.getElementById('fms-total-ete');
    
    if (!listContainer) return;

    // 1. Basic Validation
    if (!plan || !plan.flightPlanItems || plan.flightPlanItems.length === 0) {
        listContainer.innerHTML = '<div class="fms-empty-state">NO ROUTE LOADED</div>';
        if(totalDistEl) totalDistEl.textContent = '---- NM';
        if(totalEteEl) totalEteEl.textContent = '--:--';
        return;
    }

    // --- Capture current scroll position ---
    const previousScrollTop = listContainer.scrollTop;

    let html = '';
    let globalLeafIndex = 0; // Tracks index of actual flyable waypoints
    
    // Find the "Active" waypoint index
    const flatWaypoints = getFlatWaypointObjects(plan.flightPlanItems);
    let activeWpIndex = 0;
    let minDist = Infinity;
    
    if (currentPos && flatWaypoints.length > 0) {
        flatWaypoints.forEach((wp, idx) => {
            if (!wp.location) return;
            const d = getDistanceKm(currentPos.lat, currentPos.lon, wp.location.latitude, wp.location.longitude);
            if (d < minDist) {
                minDist = d;
                activeWpIndex = idx;
            }
        });
    }

    // Track previous coords for Distance/Bearing calc
    let prevLat = (plan.origin && plan.origin.latitude) || currentPos.lat;
    let prevLon = (plan.origin && plan.origin.longitude) || currentPos.lon;

    // --- MAIN LOOP: Iterate the Top-Level Items ---
    plan.flightPlanItems.forEach((item, index) => {
        const hasChildren = Array.isArray(item.children) && item.children.length > 0;
        
        // --- 2. HEADER LOGIC (SID/STAR/APPR detection) ---
        if (hasChildren) {
            let typeTag = 'PROC'; 
            let typeClass = '';
            const ident = (item.identifier || item.name || '').toUpperCase();
            
            // A. SID Logic (Start of plan)
            if (index <= 1) { 
                typeTag = 'SID'; 
                typeClass = 'sid';
            } 
            // B. Approach Logic (Pattern match or explicit type)
            else {
                // Regex: Starts with exactly 1 Letter [A-Z], followed by 2 digits \d{2}, 
                // optionally followed by L, R, or C.
                const isApproachPattern = /^[A-Z]\d{2}[LRC]?$/.test(ident);

                if (isApproachPattern) {
                    typeTag = 'APPR';
                    typeClass = 'appr';
                } else {
                    typeTag = 'STAR'; 
                    typeClass = 'star';
                }
            }

            // Render The Header Row
            html += `
                <div class="fms-proc-header">
                    <span class="proc-tag ${typeClass}">${typeTag}</span>
                    <span>${ident}</span>
                </div>
            `;

            // --- 3. CHILDREN LOOP (With isLast detection) ---
            item.children.forEach((child, cIdx) => {
                const isLast = cIdx === item.children.length - 1;
                html += renderLegRow(child, true, isLast); 
            });

        } else {
            // --- 4. STANDARD ROW ---
            html += renderLegRow(item, false, false);
        }
    });

    // --- Helper to Render a Single Waypoint Row ---
    function renderLegRow(wp, isChild, isLastChild) {
        if (!wp.location || wp.location.latitude == null) return '';

        // Calc Leg Data
        const distKm = getDistanceKm(prevLat, prevLon, wp.location.latitude, wp.location.longitude);
        const distNM = distKm / 1.852;
        const bearing = getBearing(prevLat, prevLon, wp.location.latitude, wp.location.longitude);

        // Determine Row State
        let rowClass = '';
        if (globalLeafIndex < activeWpIndex) rowClass = 'passed-leg';
        else if (globalLeafIndex === activeWpIndex) rowClass = 'active-leg';
        
        const ident = wp.identifier || wp.name || 'WPT';
        const crsDisplay = Math.round(bearing).toString().padStart(3, '0') + '°';
        const distDisplay = distNM.toFixed(1);

        // Update Prev coords for next loop
        prevLat = wp.location.latitude;
        prevLon = wp.location.longitude;

        globalLeafIndex++;
        
        // --- NEW: Add is-last-child class if applicable ---
        const childClasses = isChild ? `is-child ${isLastChild ? 'is-last-child' : ''}` : '';

        return `
            <div class="fms-row ${rowClass} ${childClasses}" id="leg-${globalLeafIndex}">
                <span class="col-wpt">${ident}</span>
                <span class="col-data text-center">${crsDisplay}</span>
                <span class="col-data text-right">${distDisplay}</span>
            </div>
        `;
    }

    listContainer.innerHTML = html;

    // --- Restore scroll position ---
    if (previousScrollTop > 0) {
        listContainer.scrollTop = previousScrollTop;
    }

    // --- [FIXED] Scroll Active Leg into View (ONCE) without scrolling parent window ---
    if (listContainer.dataset.initialScrollComplete !== 'true') {
        setTimeout(() => {
            const activeRow = listContainer.querySelector('.active-leg');
            if (activeRow) {
                // Calculate position manually to avoid 'scrollIntoView' bubbling up to the main window
                const rowTop = activeRow.offsetTop;
                const rowHeight = activeRow.offsetHeight;
                const containerHeight = listContainer.clientHeight;
                
                // Center the row: Row Top - Half Container + Half Row
                listContainer.scrollTo({
                    top: rowTop - (containerHeight / 2) + (rowHeight / 2),
                    behavior: 'smooth'
                });

                listContainer.dataset.initialScrollComplete = 'true';
            }
        }, 100);
    }

    // --- Footer Stats ---
    if(totalDistEl && document.getElementById('ac-dist')) {
        totalDistEl.innerHTML = document.getElementById('ac-dist').innerHTML;
    }
    if(totalEteEl && document.getElementById('ac-ete')) {
        totalEteEl.textContent = document.getElementById('ac-ete').textContent;
    }
}

    /**
     * (NEW) Clears old routes and draws all new routes originating from a selected airport.
     */
    function plotRoutesFromAirport(departureICAO) {
        clearRouteLayers(); // Clear only the lines, not the airport markers

        const departureAirport = airportsData[departureICAO];
        if (!departureAirport) return;

        const departureCoords = [departureAirport.lon, departureAirport.lat];
        const routesFromHub = ALL_AVAILABLE_ROUTES.filter(r => r.departure === departureICAO);

        if (routesFromHub.length === 0) {
            return;
        }

        // Create line features for each route
        const routeLineFeatures = routesFromHub.map(route => {
            const arrivalAirport = airportsData[route.arrival];
            if (arrivalAirport) {
                return {
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: [departureCoords, [arrivalAirport.lon, arrivalAirport.lat]]
                    }
                };
            }
            return null;
        }).filter(Boolean); // Filter out any routes with missing arrival data

        const routeLinesId = `routes-from-${departureICAO}`;
        sectorOpsMap.addSource(routeLinesId, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: routeLineFeatures }
        });

        sectorOpsMap.addLayer({
            id: routeLinesId,
            type: 'line',
            source: routeLinesId,
            paint: {
                'line-color': '#00a8ff', // A bright blue for visibility
                'line-width': 2,
                'line-opacity': 0.8
            }
        });

        sectorOpsMapRouteLayers.push(routeLinesId); // Track the new layer for cleanup

        // Fly to the selected airport
        sectorOpsMap.flyTo({
            center: departureCoords,
            zoom: 5,
            essential: true
        });
    }



function setupSectorOpsEventListeners() {
    const panel = document.getElementById('sector-ops-floating-panel');
    if (!panel || panel.dataset.listenersAttached === 'true') return;
    panel.dataset.listenersAttached = 'true';

    // --- START: REFACTORED for Toolbar and Panel Toggle ---
    const internalToggleBtn = document.getElementById('sector-ops-toggle-btn');
    const toolbarToggleBtn = document.getElementById('toolbar-toggle-panel-btn');

    const togglePanel = () => {
        const isNowCollapsed = panel.classList.toggle('panel-collapsed');
        
        // Update UI state for both buttons
        if (internalToggleBtn) {
            internalToggleBtn.setAttribute('aria-expanded', !isNowCollapsed);
        }
        if (toolbarToggleBtn) {
            toolbarToggleBtn.classList.toggle('active', !isNowCollapsed);
        }

        // Resize the map
        if (sectorOpsMap) {
            setTimeout(() => {
                sectorOpsMap.resize();
            }, 400); // Match CSS transition duration
        }
    };

    if (internalToggleBtn) {
        internalToggleBtn.addEventListener('click', togglePanel);
    }
    if (toolbarToggleBtn) {
        toolbarToggleBtn.addEventListener('click', togglePanel);
    }
    // --- END: REFACTORED for Toolbar and Panel Toggle ---

    // --- [MODIFIED] Add listener for the NEW single weather button ---
    const openWeatherBtn = document.getElementById('open-weather-settings-btn');
    if (openWeatherBtn) {
        openWeatherBtn.addEventListener('click', () => {
            // Toggle visibility of the new window
            if (weatherSettingsWindow) {
                const isVisible = weatherSettingsWindow.classList.toggle('visible');
                if (isVisible) {
                    if (typeof MobileUIHandler !== 'undefined') MobileUIHandler.openWindow(weatherSettingsWindow);
                } else {
                    if (typeof MobileUIHandler !== 'undefined') MobileUIHandler.closeActiveWindow();
                }
            }
        });
    }

    // --- [START NEW FILTER BUTTON LISTENER] ---
    const openFilterBtn = document.getElementById('open-filter-settings-btn');
    if (openFilterBtn) {
        openFilterBtn.addEventListener('click', () => {
            // Toggle visibility of the new window
            if (filterSettingsWindow) {
                const isVisible = filterSettingsWindow.classList.toggle('visible');
                if (isVisible) {
                    if (typeof MobileUIHandler !== 'undefined') MobileUIHandler.openWindow(filterSettingsWindow);
                } else {
                    if (typeof MobileUIHandler !== 'undefined') MobileUIHandler.closeActiveWindow();
                }
            }
        });
    }
    // --- [END NEW FILTER BUTTON LISTENER] ---

    // --- [NEW] Server Selector Listeners ---
    const serverContainer = document.getElementById('server-selector-container');
    if (serverContainer) {
        serverContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.server-btn');
            if (btn) {
                const selectedServer = btn.dataset.server;
                if (selectedServer) {
                    // Call the global switch logic
                    switchServer(selectedServer);
                }
            }
        });
    }

    // --- [NEW] Global Message Listener for Iframe Communication ---
    window.addEventListener('message', handleIframeMessage);
}

/**
 * --- [UPDATED] Handles messages from the Simple Flight Window Iframe ---
 * Now includes logic to parse raw API data into the format flightinfo.html expects.
 */
async function handleIframeMessage(event) {
    // 1. ND Ready Check (Existing)
    if (event.data && event.data.type === 'ND_READY') {
        refreshNavDisplayFromCache();
        return;
    }

    // 2. Flight Data Update (Existing Loopback - ignored here)
    if (event.data && event.data.type === 'FLIGHT_DATA_UPDATE') {
        return;
    }

    // 3. [UPDATED] Handle Stats Request
    if (event.data && event.data.type === 'REQUEST_PILOT_STATS') {
        const iframe = document.getElementById('simple-flight-window-frame');
        if (!iframe || !iframe.contentWindow) return;

        // Get the current user ID from the active flight
        if (!currentFlightInWindow || !currentMapFeatures[currentFlightInWindow]) {
            iframe.contentWindow.postMessage({
                type: 'PILOT_STATS_ERROR',
                message: 'No active flight selected.'
            }, '*');
            return;
        }

        const props = currentMapFeatures[currentFlightInWindow].properties;
        const userId = props.userId;
        const username = props.username;

        if (!userId) {
            iframe.contentWindow.postMessage({
                type: 'PILOT_STATS_ERROR',
                message: 'User ID not available.'
            }, '*');
            return;
        }

        try {
            // Use the global API URL defined at top of file
            // Note: ACARS_USER_API_URL must be defined in your global scope (it is in your file: '.../users')
            const res = await fetch(`${ACARS_USER_API_URL}/${userId}/grade`);

            if (!res.ok) throw new Error('Failed to fetch pilot grade.');

            const data = await res.json();

            if (data.ok && data.gradeInfo) {
                // Process the raw IF API data into the UI-ready format
                const formattedProfile = processRawPilotData(data.gradeInfo);

                // Send the specific payload structure expected by flightinfo.html
                iframe.contentWindow.postMessage({
                    type: 'PILOT_STATS_DATA',
                    payload: {
                        profile: formattedProfile
                    }
                }, '*');
            } else {
                throw new Error('Invalid data format received from server.');
            }

        } catch (error) {
            console.error("Iframe Stats Fetch Error:", error);
            iframe.contentWindow.postMessage({
                type: 'PILOT_STATS_ERROR',
                message: 'Could not load pilot statistics.'
            }, '*');
        }
    }
}

/**
 * --- [NEW HELPER] Processes Raw Infinite Flight Grade Data for the UI ---
 * Maps complex rule definitions into simple progress bars.
 */
function processRawPilotData(gradeInfo) {
    if (!gradeInfo) return null;

    // Helper to extract specific rule values safely
    const getRule = (rules, name) => {
        if (!Array.isArray(rules)) return null;
        return rules.find(r => r.definition && r.definition.name === name);
    };

    const currentGradeIdx = gradeInfo.gradeDetails?.gradeIndex || 0;
    const gradesList = gradeInfo.gradeDetails?.grades || [];
    const currentGradeObj = gradesList[currentGradeIdx];
    const nextGradeObj = gradesList[currentGradeIdx + 1]; // Can be undefined if max grade

    // 1. Basic Stats
    const totalXP = gradeInfo.totalXP || 0;
    const violations = gradeInfo.violationCountByLevel || { level1: 0, level2: 0, level3: 0 };
    const totalViolations = (violations.level1 || 0) + (violations.level2 || 0) + (violations.level3 || 0);
    
    // Map ATC Rank ID to Name
    const atcRankMap = { 0: 'Observer', 1: 'Trainee', 2: 'Apprentice', 3: 'Specialist', 4: 'Officer', 5: 'Supervisor', 6: 'Recruiter', 7: 'Manager' };
    const atcRankName = atcRankMap[gradeInfo.atcRank] || 'Observer';

    // 2. Build Progression Array
    // We compare current stats against the requirements for the NEXT grade.
    // If max grade, we just show current stats vs current requirements.
    const targetGrade = nextGradeObj || currentGradeObj;
    const progression = [];

    if (targetGrade && Array.isArray(targetGrade.rules)) {
        
        // A. XP Progression
        const xpRule = getRule(targetGrade.rules, 'XP');
        if (xpRule) {
            progression.push({
                label: 'Total XP',
                current: totalXP,
                target: xpRule.referenceValue,
                type: 'ACCUMULATE'
            });
        }

        // B. Landing Count (90 Days)
        const landingsRule = getRule(targetGrade.rules, 'Landings (90 days)');
        if (landingsRule) {
            progression.push({
                label: 'Landings (90d)',
                current: landingsRule.userValue, // The API provides the user's current value here
                target: landingsRule.referenceValue,
                type: 'ACCUMULATE'
            });
        }

        // C. Flight Time (90 Days)
        const timeRule = getRule(targetGrade.rules, 'Flight Time (90 days)');
        if (timeRule) {
            progression.push({
                label: 'Flight Time (90d)',
                // Convert minutes to hours for display, usually API sends minutes
                current: Math.floor(timeRule.userValue / 60), 
                target: Math.floor(timeRule.referenceValue / 60),
                type: 'ACCUMULATE'
            });
        }

        // D. Violation Limits (Level 2/3 in 1 year) - Inverse logic (Max Limit)
        const vioRule = getRule(targetGrade.rules, 'All Level 2/3 Violations (1 year)');
        if (vioRule) {
            progression.push({
                label: 'Violations (1yr)',
                current: gradeInfo.total12MonthsViolations || 0,
                target: vioRule.referenceValue, // This is a MAX limit
                type: 'MAX_LIMIT'
            });
        }
    }

    return {
        grade: currentGradeObj ? currentGradeObj.name.replace('Grade ', 'Grade ') : `Grade ${currentGradeIdx + 1}`,
        xp: totalXP,
        atcRank: atcRankName,
        virtualAirline: gradeInfo.virtualAirline || 'N/A',
        totalViolations: totalViolations,
        violationDetails: violations,
        lastViolationDate: gradeInfo.lastLevel1ViolationDate ? new Date(gradeInfo.lastLevel1ViolationDate).toLocaleDateString() : 'None',
        flightTime90: 'N/A', // Calculated in progression
        landings90: 'N/A',   // Calculated in progression
        progression: progression
    };
}

/**
     * --- [NEW] Smart Map Background Click Handler ---
     * Closes the flight window when clicking the map background.
     * Distinguishes between a "Click" ( < 5px movement) and a "Map Pan/Drag" ( > 5px movement).
     */
    function setupSmartMapBackgroundClick() {
        if (!sectorOpsMap) return;

        let startPoint = null;

        // 1. Record position when mouse/finger goes DOWN
        sectorOpsMap.on('mousedown', (e) => {
            startPoint = e.point;
        });
        
        // 2. Handle Touch devices (touchstart)
        sectorOpsMap.on('touchstart', (e) => {
            startPoint = e.point;
        });

        // 3. Listen for the actual Click event
        sectorOpsMap.on('click', (e) => {
            // Validation: Must have a start point to compare
            if (!startPoint) return;

            // A. Calculate Distance Moved (Pythagorean theorem)
            const endPoint = e.point;
            const dist = Math.sqrt(
                Math.pow(endPoint.x - startPoint.x, 2) + 
                Math.pow(endPoint.y - startPoint.y, 2)
            );

            // B. Define "Drag Tolerance" (pixels)
            // If moved < 5 pixels, it is a deliberate click.
            const IS_CLICK = dist < 5;

            // C. Check if we clicked on an existing Aircraft Feature
            // We do NOT want to close the window if the user clicked another plane (that logic handles the switch).
            // HTML Markers (Airports) handle their own clicks and stop propagation, so they won't trigger this.
            const features = sectorOpsMap.queryRenderedFeatures(e.point, {
                layers: ['sector-ops-live-flights-layer'] // The aircraft icon layer
            });
            
            const clickedOnAircraft = features.length > 0;

            // D. EXECUTE CLOSE LOGIC
            // Condition: It was a Click + Not on a Plane + A flight is currently selected
            if (IS_CLICK && !clickedOnAircraft && currentFlightInWindow) {
                // Check if window is actually visible to avoid redundant calls
                if (aircraftInfoWindow.classList.contains('visible')) {
                    console.log("Smart Click: Closing flight window (Map clicked, not dragged).");
                    closeAircraftWindow(); 
                }
            }
            
            // Reset
            startPoint = null;
        });
    }

    /**
     * Updates the main weather toolbar button to show if any layers are active.
     */
    function updateWeatherToolbarButtonState() {
        const openWeatherBtn = document.getElementById('open-weather-settings-btn');
        if (!openWeatherBtn) return;

        const precipToggle = document.getElementById('weather-toggle-precip');
        const cloudsToggle = document.getElementById('weather-toggle-clouds');
        const windToggle = document.getElementById('weather-toggle-wind');

        const isAnyActive = (precipToggle && precipToggle.checked) ||
                            (cloudsToggle && cloudsToggle.checked) ||
                            (windToggle && windToggle.checked);

        openWeatherBtn.classList.toggle('active', isAnyActive);
    }

    /**
     * Sets up event listeners for the Weather Settings info window.
     */
    function setupWeatherSettingsWindowEvents() {
        if (!weatherSettingsWindow || weatherSettingsWindow.dataset.eventsAttached === 'true') {
            return;
        }

        // Use a single listener on the window for better performance
        weatherSettingsWindow.addEventListener('click', (e) => {
            const target = e.target;

            // Handle Close or Hide buttons
            if (target.closest('.weather-window-close-btn') || target.closest('.weather-window-hide-btn')) {
                weatherSettingsWindow.classList.remove('visible');
                if (typeof MobileUIHandler !== 'undefined') MobileUIHandler.closeActiveWindow();
            }
        });

        // Use a 'change' listener for the toggles
        weatherSettingsWindow.addEventListener('change', (e) => {
            const target = e.target;

            if (target.type === 'checkbox') {
                const isChecked = target.checked;
                
                switch (target.id) {
                    case 'weather-toggle-precip':
                        toggleWeatherLayer(isChecked);
                        break;
                    case 'weather-toggle-sigmets':
                        toggleSigmetLayer(isChecked);
                        break;
                    case 'weather-toggle-clouds':
                        toggleCloudLayer(isChecked);
                        break;
                    case 'weather-toggle-wind':
                        toggleWindLayer(isChecked);
                        break;
                }
                
                // Update the toolbar button's active state
                // This assumes updateWeatherToolbarButtonState() checks all boxes including the new SIGMET one
                const openWeatherBtn = document.getElementById('open-weather-settings-btn');
                if (openWeatherBtn) {
                    const isAnyActive = document.querySelectorAll('.weather-toggle-list input[type="checkbox"]:checked').length > 0;
                    openWeatherBtn.classList.toggle('active', isAnyActive);
                }
            }
        });

        weatherSettingsWindow.dataset.eventsAttached = 'true';
    }



function setupFilterSettingsWindowEvents() {
    if (!filterSettingsWindow || filterSettingsWindow.dataset.eventsAttached === 'true') {
        return;
    }

    // --- Helper: Convert Hex to RGBA ---
    const hexToRgba = (hex, alpha) => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    // --- Helper: Apply Theme to CSS Vars ---
    const applyWindowTheme = (startHex, endHex) => {
        const root = document.documentElement;
        const opacity = (mapFilters.themeOpacity || 95) / 100;
        
        root.style.setProperty('--iw-bg-start', hexToRgba(startHex, opacity));
        root.style.setProperty('--iw-bg-end', hexToRgba(endHex, opacity));
    };

    // --- Helper: Set UI from State ---
    const setUIFromState = () => {
        // Toggles
        document.getElementById('filter-toggle-atc').checked = mapFilters.hideAtcMarkers;
        document.getElementById('filter-toggle-satellite-mode').checked = (currentMapStyle === MAP_STYLE_SATELLITE);
        document.getElementById('filter-toggle-aircraft-labels').checked = mapFilters.showAircraftLabels;
        
        // Simple Window Toggle
        const simpleWindowToggle = document.getElementById('filter-toggle-simple-window');
        if (simpleWindowToggle) {
            simpleWindowToggle.checked = mapFilters.useSimpleFlightWindow;
        }

        // Radios
        const colorRadio = document.querySelector(`input[name="icon-color-mode"][value="${mapFilters.iconColorMode}"]`);
        if (colorRadio) colorRadio.checked = true;
        
        const planRadio = document.querySelector(`input[name="plan-display-mode"][value="${mapFilters.planDisplayMode}"]`);
        if (planRadio) planRadio.checked = true;

        // Colors
        document.getElementById('theme-color-start').value = mapFilters.themeStartColor || '#121426';
        document.getElementById('theme-color-end').value = mapFilters.themeEndColor || '#121426';
        
        // Apply immediately on load
        applyWindowTheme(mapFilters.themeStartColor, mapFilters.themeEndColor);

        // Mobile-specific
        const currentMobileMode = localStorage.getItem('mobileDisplayMode') || 'legacy'; // Default to legacy
        const mobileModeHud = document.getElementById('mobile-mode-hud');
        const mobileModeLegacy = document.getElementById('mobile-mode-legacy');
        
        if (mobileModeHud && mobileModeLegacy) {
            // [UPDATED] If Simple Window is active, force UI to reflect Locked Legacy Mode
            if (mapFilters.useSimpleFlightWindow) {
                mobileModeLegacy.checked = true;
                mobileModeHud.disabled = true; // Lock HUD option
                mobileModeHud.parentElement.style.opacity = '0.5'; // Visual feedback
            } else {
                mobileModeHud.disabled = false;
                mobileModeHud.parentElement.style.opacity = '1';
                
                if (currentMobileMode === 'legacy') {
                    mobileModeLegacy.checked = true;
                } else {
                    mobileModeHud.checked = true;
                }
            }
        }
    };
    
    // --- Set the UI when the window is first set up ---
    setUIFromState();

    // --- Event Listener: Color Inputs (Input = Realtime Preview) ---
    const startPicker = document.getElementById('theme-color-start');
    const endPicker = document.getElementById('theme-color-end');
    const resetBtn = document.getElementById('theme-reset-btn');

    const handleColorChange = () => {
        const s = startPicker.value;
        const e = endPicker.value;
        applyWindowTheme(s, e);
        // Update state
        mapFilters.themeStartColor = s;
        mapFilters.themeEndColor = e;
        saveFiltersToLocalStorage();

        const iframe = document.getElementById('simple-flight-window-frame');
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({
                type: 'THEME_UPDATE',
                payload: { 
                    start: s, 
                    end: e,
                    opacity: mapFilters.themeOpacity || 90
                }
            }, '*');
        }
    };

    if (startPicker) startPicker.addEventListener('input', handleColorChange);
    if (endPicker) endPicker.addEventListener('input', handleColorChange);

    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            const defColor = '#121426';
            startPicker.value = defColor;
            endPicker.value = defColor;
            applyWindowTheme(defColor, defColor);
            
            mapFilters.themeStartColor = defColor;
            mapFilters.themeEndColor = defColor;
            saveFiltersToLocalStorage();
            showNotification("Window theme reset to default.", "success");
        });
    }

    // Use a single listener on the window for better performance
    filterSettingsWindow.addEventListener('click', (e) => {
        const target = e.target;
        if (target.closest('.filter-window-close-btn') || target.closest('.filter-window-hide-btn')) {
            filterSettingsWindow.classList.remove('visible');
            MobileUIHandler.closeActiveWindow();
        }
    });

    // Use a 'change' listener for all toggles and radios
    filterSettingsWindow.addEventListener('change', (e) => {
        const target = e.target;
        
        // [UPDATED] Handle Simple Window Toggle & Interdependency
        if (target.id === 'filter-toggle-simple-window') {
            mapFilters.useSimpleFlightWindow = target.checked;
            saveFiltersToLocalStorage();
            
            const mobileModeHud = document.getElementById('mobile-mode-hud');
            const mobileModeLegacy = document.getElementById('mobile-mode-legacy');

            if (target.checked) {
                // LOCK OUT HUD MODE
                if (mobileModeHud) {
                    mobileModeHud.disabled = true;
                    mobileModeHud.parentElement.style.opacity = '0.5';
                }
                if (mobileModeLegacy) {
                    mobileModeLegacy.checked = true;
                }
                // Force save 'legacy' to storage so UI Handler picks it up next time
                localStorage.setItem('mobileDisplayMode', 'legacy');
            } else {
                // UNLOCK HUD MODE
                if (mobileModeHud) {
                    mobileModeHud.disabled = false;
                    mobileModeHud.parentElement.style.opacity = '1';
                }
            }
            
            // If a window is currently open, reload it to reflect changes
            if (currentFlightInWindow) {
                const closeBtn = document.querySelector('.aircraft-window-close-btn');
                if (closeBtn) closeBtn.click();
            }
            return;
        }

        // Handle Flight Plan Radio Logic
        if (target.name === 'plan-display-mode') {
            mapFilters.planDisplayMode = target.value;
            saveFiltersToLocalStorage(); 
            if (currentFlightInWindow && cachedFlightDataForStatsView.plan) {
                const { flightProps, plan } = cachedFlightDataForStatsView;
                const position = currentAircraftPositionForGeocode || flightProps.position;
                updateFlightPlanLayer(currentFlightInWindow, plan, position);
            }
            return;
        }
        
        // Handle Icon Color Radio Logic
        if (target.name === 'icon-color-mode') {
            mapFilters.iconColorMode = target.value;
            saveFiltersToLocalStorage(); 
            const newExpression = getIconImageExpression(mapFilters.iconColorMode);
            if (sectorOpsMap && sectorOpsMap.getLayer('sector-ops-live-flights-layer')) {
                sectorOpsMap.setLayoutProperty('sector-ops-live-flights-layer', 'icon-image', newExpression);
            }
            return; 
        }
        
        // Handle Mobile Display Mode Radio Logic
        if (target.name === 'mobile-display-mode') {
            // Prevent changing if locked (double check for safety)
            if (mapFilters.useSimpleFlightWindow && target.value === 'hud') {
                target.checked = false;
                document.getElementById('mobile-mode-legacy').checked = true;
                return;
            }

            const newMode = target.value;
            localStorage.setItem('mobileDisplayMode', newMode);
            if (!document.getElementById('mobile-mode-note')) {
                document.getElementById('mobile-mode-filter-group').insertAdjacentHTML(
                    'beforeend',
                    '<p id="mobile-mode-note" class="muted-text" style="padding: 10px 0 0 0; text-align: left; font-size: 0.8rem;">Changes will apply the next time you open an aircraft window.</p>'
                );
            }
            return; 
        }

        if (target.type !== 'checkbox') return;

        // Handle Aircraft Label Toggle
        if (target.id === 'filter-toggle-aircraft-labels') {
            mapFilters.showAircraftLabels = target.checked;
            saveFiltersToLocalStorage(); 
            updateAircraftLabelVisibility(); 
            return;
        }

        // Handle Map Style Logic
        const satelliteModeToggle = document.getElementById('filter-toggle-satellite-mode');
        let styleChanged = false;
        let newMapStyle = currentMapStyle;

        if (target.id === 'filter-toggle-satellite-mode') {
            if (target.checked) {
                newMapStyle = MAP_STYLE_SATELLITE;
            } else {
                newMapStyle = MAP_STYLE_DARK; 
            }
            styleChanged = true;
        }

        // Update mapFilters state
        mapFilters.showVaOnly = document.getElementById('filter-toggle-members-only')?.checked || false;
        mapFilters.hideAtcMarkers = document.getElementById('filter-toggle-atc')?.checked || false;
        mapFilters.hideNoAtcMarkers = document.getElementById('filter-toggle-no-atc')?.checked || false;
        
        if (styleChanged && newMapStyle !== currentMapStyle) {
            console.log(`Changing map style to: ${newMapStyle}`);
            currentMapStyle = newMapStyle;
            sectorOpsMap.setStyle(currentMapStyle);
        } else if (!styleChanged) {
            saveFiltersToLocalStorage(); 
            updateMapFilters();
        }

        updateToolbarButtonStates(); 
    });

    filterSettingsWindow.dataset.eventsAttached = 'true';
}


function setupSearchEventListeners() {
    const searchInput = document.getElementById('sector-ops-search-input');
    const searchClear = document.getElementById('sector-ops-search-clear');
    const searchContainer = document.getElementById('sector-ops-search-container');
    const dropdown = document.getElementById('search-results-dropdown');
    const searchBar = searchContainer ? searchContainer.querySelector('.search-bar-container') : null;

    if (!searchInput || !searchClear || !searchContainer || !dropdown) return;
    
    // Prevent attaching listeners multiple times
    if (searchContainer.dataset.searchListeners === 'true') return; 

    // --- Helper Functions ---
    const openDropdown = () => {
        if (searchInput.value.length >= 2 && dropdown.children.length > 0) {
            dropdown.style.display = 'block';
            searchBar.classList.add('has-results');
        }
    };

    const closeDropdown = () => {
        dropdown.style.display = 'none';
        searchBar.classList.remove('has-results');
    };

    // --- 1. FORCE FOCUS ON CLICK (The Fix) ---
    // This ensures clicking the glass bar actually activates the hidden input
    searchBar.addEventListener('click', () => {
        searchInput.focus();
    });

    // --- 2. Input Typing ---
    searchInput.addEventListener('input', () => {
        const val = searchInput.value;
        searchClear.style.display = val ? 'flex' : 'none';

        if (val.length >= 2) {
            handleSearchInput(val);
            // Slight delay to allow render to finish
            setTimeout(() => {
                if (dropdown.children.length > 0) openDropdown();
                else closeDropdown();
            }, 50);
        } else {
            closeDropdown();
        }
    });

    // --- 3. Re-open on Focus ---
    searchInput.addEventListener('focus', () => {
        if (searchInput.value.length >= 2) {
            handleSearchInput(searchInput.value); // Refresh data
            openDropdown();
        }
    });

    // --- 4. Clear Button ---
    searchClear.addEventListener('click', (e) => {
        e.stopPropagation(); 
        searchInput.value = '';
        handleSearchInput('');
        searchClear.style.display = 'none';
        closeDropdown();
        searchInput.focus(); 
    });

    // --- 5. Result Selection ---
    dropdown.addEventListener('click', (e) => {
        const item = e.target.closest('.search-result-item');
        if (item) {
            onSearchResultClick(item); 
        }
    });

    // Prevent blur when clicking dropdown
    dropdown.addEventListener('mousedown', (e) => e.preventDefault());

    // --- 6. Click Outside to Close ---
    document.addEventListener('click', (e) => {
        if (!searchContainer.contains(e.target)) {
            closeDropdown();
        }
    }, true); 
    
    searchContainer.dataset.searchListeners = 'true';
}

    // ==========================================================
    // END: SECTOR OPS / ROUTE EXPLORER LOGIC
    // ==========================================================

    // ====================================================================
    // START: NEW LIVE FLIGHTS & ATC/NOTAM LOGIC FOR SECTOR OPS MAP
    // ====================================================================


// --- [REPLACEMENT] ---
// Starts the data polling AND the animation loop.
function startSectorOpsLiveLoop() {
    stopSectorOpsLiveLoop(); // Clear any old loops

    // 1. Start the data fetching loop for ATC/NOTAMs (infrequent)
    updateSectorOpsSecondaryData(); // Fetch immediately
    sectorOpsAtcNotamInterval = setInterval(updateSectorOpsSecondaryData, DATA_REFRESH_INTERVAL_MS); 

    // 2. Initialize and connect the WebSocket
    initializeSectorOpsSocket();

    // 3. Start the MapAnimator loop
    if (mapAnimator) {
        mapAnimator.start();
    }
}

// Stops the data polling AND the animation loop.
function stopSectorOpsLiveLoop() {
    // 1. Clear the data-fetching interval for ATC/NOTAMs
    if (sectorOpsAtcNotamInterval) {
        clearInterval(sectorOpsAtcNotamInterval);
        sectorOpsAtcNotamInterval = null;
    }
    
    // 2. Disconnect the WebSocket
    if (sectorOpsSocket) {
        console.log('Socket: Disconnecting from Sector Ops...');
        sectorOpsSocket.disconnect();
        sectorOpsSocket = null;
    }

    // 3. Stop the MapAnimator loop
    if (mapAnimator) {
        mapAnimator.stop();
    }

    // 4. Clear the feature state
    // FIX: Clear in place so MapAnimator keeps the reference
    for (const key in currentMapFeatures) {
        delete currentMapFeatures[key];
    }
}


function renderAirportMarkers() {
        if (!sectorOpsMap || !sectorOpsMap.isStyleLoaded()) return;

        // --- [FIXED] Read filter state from the global object ---
        const hideNoAtc = mapFilters.hideNoAtcMarkers;
        const hideAtc = mapFilters.hideAtcMarkers;
        // --- [END FIXED] ---

        // Clear all previously rendered airport markers to ensure a fresh state
        Object.values(airportAndAtcMarkers).forEach(({ marker }) => marker.remove());
        airportAndAtcMarkers = {};

        const atcAirportIcaos = new Set(activeAtcFacilities.map(f => f.airportName).filter(Boolean));
        
        const allRouteAirports = new Set();
        ALL_AVAILABLE_ROUTES.forEach(route => {
            allRouteAirports.add(route.departure);
            allRouteAirports.add(route.arrival);
        });

        const allAirportsToRender = new Set([...allRouteAirports, ...atcAirportIcaos]);

        allAirportsToRender.forEach(icao => {
            const airport = airportsData[icao];
            if (!airport || airport.lat == null || airport.lon == null) return;

            const hasAtc = atcAirportIcaos.has(icao);

            // --- [FIXED] Apply filter logic from state ---
            if (hideNoAtc && !hasAtc) {
                return; // Skip rendering this marker
            }
            if (hideAtc && hasAtc) {
                return; // Skip rendering this marker
            }
            // --- [END FIXED] ---

            let markerClass; // Use 'let' to allow modification
            let title = `${icao}: ${airport.name || 'Unknown Airport'}`;

            if (hasAtc) {
                const airportAtc = activeAtcFacilities.filter(f => f.airportName === icao);
                // Check for Approach (type 4) or Departure (type 5)
                const hasApproachOrDeparture = airportAtc.some(f => f.type === 4 || f.type === 5);

                // Start with the base class for any staffed airport
                markerClass = 'atc-active-marker';
                title += ' (Active ATC)';

                // Add the aura class if Approach/Departure is active
                if (hasApproachOrDeparture) {
                    markerClass += ' atc-approach-active';
                    title += ' - Approach/Departure';
                }

            } else {
                markerClass = 'destination-marker'; // For non-ATC airports
            }
            
            const el = document.createElement('div');
            el.className = markerClass;
            el.title = title;

            const marker = new mapboxgl.Marker({ element: el })
                .setLngLat([airport.lon, airport.lat])
                .addTo(sectorOpsMap);

            el.addEventListener('click', (e) => {
                e.stopPropagation();
                handleAirportClick(icao);
            });

            airportAndAtcMarkers[icao] = { marker: marker, className: markerClass };
        });
    }


// --- [UPDATED] Fetches ATC & NOTAMs for the CURRENTLY SELECTED SERVER ---
async function updateSectorOpsSecondaryData() {
    if (!sectorOpsMap || !sectorOpsMap.isStyleLoaded()) return;

    const LIVE_FLIGHTS_BACKEND = 'https://site--acars-backend--6dmjph8ltlhv.code.run';

    try {
        const sessionsRes = await fetch(`${LIVE_FLIGHTS_BACKEND}/if-sessions`);
        if (!sessionsRes.ok) {
            console.warn('Sector Ops Map: Could not fetch server sessions. Skipping secondary data update.');
            return;
        }
        const sessionsData = await sessionsRes.json();
        
        // [UPDATED] Use helper to get ID for currentServerName
        const targetSessionId = getCurrentSessionId(sessionsData);

        if (!targetSessionId) {
            console.warn(`Sector Ops Map: Session ID not found for ${currentServerName}`);
            return;
        }

        const [atcRes, notamsRes] = await Promise.all([
            fetch(`${LIVE_FLIGHTS_BACKEND}/atc/${targetSessionId}`),
            fetch(`${LIVE_FLIGHTS_BACKEND}/notams/${targetSessionId}`)
        ]);
        
        // Update ATC & NOTAMs
        if (atcRes.ok) {
            const atcData = await atcRes.json();
            activeAtcFacilities = (atcData.ok && Array.isArray(atcData.atc)) ? atcData.atc : [];
        }
        if (notamsRes.ok) {
            const notamsData = await notamsRes.json();
            activeNotams = (notamsData.ok && Array.isArray(notamsData.notams)) ? notamsData.notams : [];
        }
        // Re-render airport markers with fresh ATC data
        renderAirportMarkers(); 

    } catch (error) {
        console.error('Error updating Sector Ops secondary data (ATC/NOTAMs):', error);
    }
}
    // ====================================================================
    // END: NEW LIVE FLIGHTS & ATC/NOTAM LOGIC FOR SECTOR OPS MAP
    // ====================================================================



    // --- Initial Load ---
async function initializeApp() {
        mainContentLoader.classList.add('active');

        loadFiltersFromLocalStorage();


        // Fetch essential data in parallel
        await Promise.all([
            fetchApiKeys(),
            fetchAirportsData(),
            fetchRunwaysData()
        ]);
        
        // Initialize the Sector Ops view
        await initializeSectorOpsView(); 
        
        mainContentLoader.classList.remove('active');
    }

    window.displayPilotStats = displayPilotStats;

    initializeApp();
});