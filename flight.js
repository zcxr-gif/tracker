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
        themeStartColor: '#121426', // Default Dark Blue/Black
        themeEndColor: '#121426',   // Default Dark Blue/Black
        themeOpacity: 95            // Default 95% opacity
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


function injectCustomStyles() {
    const styleId = 'sector-ops-custom-styles';
    if (document.getElementById(styleId)) return;

    const css = `
        /* --- CSS VARIABLES FOR THEMING --- */
        :root {
            --iw-bg-start: rgba(18, 20, 38, 0.95);
            --iw-bg-end: rgba(18, 20, 38, 0.95);
        }

        /* --- VIRTUAL COCKPIT SEAT SENSOR --- */
        .seat-sensor-wrapper {
            background: #000; 
            border: 2px solid #333; 
            border-radius: 4px; 
            display: flex;
            flex-direction: column;
            box-shadow: inset 0 0 20px rgba(0,0,0,0.8);
            overflow: hidden;
            position: relative;
        }

        .sensor-header {
            background: #111;
            padding: 6px 10px;
            border-bottom: 1px solid #333;
            display: flex;
            justify-content: space-between;
            font-size: 0.8rem;
            font-weight: bold;
            color: #fff;
            flex-shrink: 0;
            font-family: 'Consolas', monospace;
        }

        .sensor-body {
            padding: 15px;
            display: flex;
            flex-direction: column;
            align-items: center;
            position: relative;
            background: #0f1115; 
        }

        .cockpit-view {
            position: relative;
            width: 140px;
            height: 80px;
            background: #1a1a1a;
            border-radius: 40px 40px 10px 10px;
            border: 2px solid #444;
            display: flex;
            justify-content: space-between;
            padding: 10px 20px;
            box-sizing: border-box;
            margin-bottom: 10px;
        }

        .cockpit-view::after {
            content: '';
            position: absolute;
            left: 50%;
            bottom: 10px;
            transform: translateX(-50%);
            width: 14px;
            height: 40px;
            background: #333;
            border-radius: 4px;
            border: 1px solid #555;
        }

        .seat {
            width: 35px;
            height: 40px;
            background: #222;
            border-radius: 6px;
            border: 2px solid #444;
            transition: all 0.5s ease;
            position: relative;
            display: flex;
            justify-content: center;
            align-items: center;
        }

        .seat::before {
            content: '';
            position: absolute;
            top: -8px;
            width: 25px;
            height: 8px;
            background: inherit;
            border-radius: 4px;
            border: 2px solid #444;
        }

        .cockpit-overlay-icon {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 2.5rem;
            z-index: 10;
            opacity: 0;
            transition: opacity 0.3s ease, transform 0.3s ease;
            pointer-events: none;
            text-shadow: 0 2px 10px rgba(0,0,0,0.8);
        }

        .cockpit-overlay-icon.visible {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
        }

        .icon-parking { color: #ff3333; border: 3px solid #ff3333; border-radius: 50%; width: 45px; height: 45px; display: flex; align-items: center; justify-content: center; font-weight: bold; background: rgba(0,0,0,0.6); font-family: sans-serif; }
        .icon-coffee { color: #ffaa00; }
        .icon-cloud { color: #00a8ff; }

        .seat.active-green { background: rgba(0, 255, 0, 0.1); border-color: #00ff00; box-shadow: 0 0 15px rgba(0, 255, 0, 0.4); }
        .seat.active-green::before { border-color: #00ff00; background: #003300; }

        .seat.active-amber { background: rgba(255, 170, 0, 0.1); border-color: #ffaa00; box-shadow: 0 0 15px rgba(255, 170, 0, 0.4); }
        .seat.active-amber::before { border-color: #ffaa00; background: #442200; }

        .seat.active-blue { background: rgba(0, 168, 255, 0.1); border-color: #00a8ff; box-shadow: 0 0 15px rgba(0, 168, 255, 0.4); }
        .seat.active-blue::before { border-color: #00a8ff; background: #002244; }

        .seat::after { content: attr(data-role); font-size: 0.6rem; font-weight: bold; color: #555; margin-top: 2px; }
        .seat.active-green::after, .seat.active-amber::after, .seat.active-blue::after { color: #fff; text-shadow: 0 0 5px currentColor; }

        .seat-status-display {
            margin-top: 8px;
            font-family: 'Consolas', monospace;
            font-size: 0.75rem;
            text-align: center;
            width: 100%;
            display: flex;
            justify-content: space-between;
            color: #888;
        }

        .status-pill { padding: 2px 8px; border-radius: 4px; background: #222; border: 1px solid #333; }
        .status-pill.green { color: #00ff00; border-color: #00ff00; }
        .status-pill.amber { color: #ffaa00; border-color: #ffaa00; }
        .status-pill.blue { color: #00a8ff; border-color: #00a8ff; }
        .status-pill.red { color: #ff3333; border-color: #ff3333; }

        #seat-narrative-text {
            font-family: 'Segoe UI', sans-serif;
            font-size: 0.7rem;
            color: #aaa;
            margin-top: 8px;
            text-align: center;
            border-top: 1px solid #333;
            padding-top: 6px;
            width: 100%;
            font-style: italic;
        }
        
        #view-rosters.active {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            padding: 0;
            overflow: hidden;
            display: grid;
            grid-template-columns: 1fr;
            grid-template-rows: 1fr;
        }
        #sector-ops-map-fullscreen {
            grid-column: 1 / -1;
            grid-row: 1 / -1;
        }
        .main-content:has(#view-rosters.active) {
            padding: 0; 
            height: 100dvh; 
            overflow: hidden; 
        }
        
        /* --- INFO WINDOW STYLES (UPDATED) --- */
        .info-window {
            position: absolute;
            top: 20px; 
            right: 20px;
            width: 600px; 
            max-width: 95vw;
            max-height: calc(100vh - 40px);
            background: linear-gradient(160deg, var(--iw-bg-start), var(--iw-bg-end));
            backdrop-filter: blur(20px) saturate(180%);
            -webkit-backdrop-filter: blur(20px) saturate(180%);
            border-radius: 16px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            box-shadow: 0 20px 50px rgba(0,0,0,0.8); 
            z-index: 1060; 
            display: flex;
            flex-direction: column;
            overflow: hidden;
            color: #e8eaf6;
            transition: opacity 0.3s ease, transform 0.3s ease;
            opacity: 0;
            transform: translateX(20px);
            pointer-events: none; 
        }
        .info-window.visible { 
            opacity: 1;
            transform: translateX(0);
            pointer-events: auto;
        }
        .info-window-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 20px;
            background: rgba(0, 0, 0, 0.1); 
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            flex-shrink: 0;
        }
        .info-window-header h3 {
            margin: 0; 
            font-size: 1.3rem; 
            color: #fff;
            font-weight: 600;
            text-shadow: 0 2px 5px rgba(0,0,0,0.4);
        }
        .info-window-actions button {
            background: rgba(255,255,255,0.05); 
            border: 1px solid rgba(255,255,255,0.1);
            color: #c5cae9; 
            cursor: pointer;
            font-size: 1rem; 
            width: 32px; height: 32px;
            border-radius: 50%;
            margin-left: 8px;
            line-height: 1; 
            display: grid;
            place-items: center;
            transition: all 0.2s ease-in-out;
        }
        .info-window-actions button:hover { 
            background: #00a8ff;
            color: #fff; 
            transform: scale(1.1) rotate(90deg);
            border-color: #00a8ff;
        }
        .info-window-content { 
            overflow-y: auto; 
            flex-grow: 1; 
            padding: 0;
            background: transparent; 
        }

        .pfd-and-location-grid { 
            display: grid; 
            grid-template-columns: 2fr 1fr; 
            gap: 8px;
        }

        .info-right-col {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        
        .fms-module-container {
            height: 380px; 
            max-height: 380px;
            background: #000;
            color: #00e600; 
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            display: flex;
            flex-direction: column;
            border: 2px solid #333;
            border-radius: 4px;
            box-shadow: inset 0 0 20px rgba(0,0,0,0.8);
            box-sizing: border-box;
            overflow: hidden; 
        }
        .fms-header {
            background: #111;
            padding: 6px 10px;
            border-bottom: 1px solid #333;
            display: flex;
            justify-content: space-between;
            font-size: 0.8rem;
            font-weight: bold;
            color: #fff;
            flex-shrink: 0;
        }
        .fms-columns {
            display: grid;
            grid-template-columns: 2fr 1fr 1fr;
            padding: 4px 10px;
            border-bottom: 1px dashed #333;
            font-size: 0.7rem;
            color: #00a8ff;
            flex-shrink: 0;
        }
        .fms-list-scrollarea {
            flex-grow: 1;
            overflow-y: auto;
            padding: 5px 0;
            scrollbar-width: thin;
            scrollbar-color: #333 #000;
        }
        .fms-list-scrollarea::-webkit-scrollbar { width: 6px; }
        .fms-list-scrollarea::-webkit-scrollbar-track { background: #000; }
        .fms-list-scrollarea::-webkit-scrollbar-thumb { background-color: #333; border-radius: 3px; border: 1px solid #111; }
        .fms-list-scrollarea::-webkit-scrollbar-thumb:hover { background-color: #555; }
        .fms-row {
            display: grid;
            grid-template-columns: 2fr 1fr 1fr;
            padding: 4px 10px;
            font-size: 0.85rem;
            border-bottom: 1px solid #111;
            align-items: center;
        }
        .fms-row.active-leg {
            background: rgba(255, 0, 255, 0.15);
            color: #ff00ff;
            font-weight: bold;
        }
        .fms-row.passed-leg { color: #555; }
        .fms-proc-header {
            padding: 4px 10px;
            background: #1a1a1a;
            color: #fff;
            font-size: 0.75rem;
            font-weight: bold;
            border-top: 1px solid #333;
            border-bottom: 1px solid #333;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .proc-tag {
            font-size: 0.6rem;
            padding: 1px 4px;
            border-radius: 2px;
            background: #333;
            color: #ccc;
        }
        .proc-tag.sid { background: #004d40; color: #4db6ac; }
        .proc-tag.star { background: #3e2723; color: #ffab91; }
        .fms-row.is-child { padding-left: 20px; }
        .fms-footer {
            background: #111;
            padding: 6px 10px;
            border-top: 1px solid #333;
            display: flex;
            justify-content: space-between;
            flex-shrink: 0;
        }
        .fms-stat { display: flex; gap: 8px; font-size: 0.8rem; }
        .stat-label { color: #aaa; }
        .stat-value { color: #fff; font-weight: bold; }
        .fms-empty-state { text-align: center; padding: 20px; color: #555; font-style: italic; }

        /* --- REDESIGNED LOCATION DATA PANEL (No Bleeding) --- */
        #location-data-panel {
            background: #0f1115;
            border-radius: 8px;
            border: 1px solid #333;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            width: 100%;
            display: flex;
            flex-direction: column;
            overflow: visible; /* Allow content to dictate height */
        }
        .nav-header {
            background: #181b21;
            padding: 8px 12px;
            border-bottom: 1px solid #333;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .nav-title { 
            font-size: 0.7rem; 
            font-weight: 700; 
            color: #6b7280; 
            letter-spacing: 1px; 
            font-family: 'Segoe UI', sans-serif;
        }
        .nav-status-indicator {
            display: flex; align-items: center; gap: 6px;
            font-size: 0.65rem; font-weight: 700; letter-spacing: 0.5px;
            color: #10b981; text-transform: uppercase;
        }
        .nav-blink {
            width: 6px; height: 6px; border-radius: 50%; background: #10b981;
            box-shadow: 0 0 6px #10b981;
            animation: navPulse 2s infinite;
        }
        @keyframes navPulse { 0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; } }
        
        .nav-grid-container {
            padding: 10px;
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 8px;
        }
        .nav-cell {
            background: rgba(255, 255, 255, 0.03);
            border-radius: 4px;
            padding: 6px 10px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            /* Allow height to grow based on content */
            height: auto; 
            min-height: 45px;
            border: 1px solid transparent;
            transition: background 0.2s;
            overflow: visible; /* Prevent cutting off */
        }
        .nav-cell:hover {
            background: rgba(255, 255, 255, 0.06);
            border-color: rgba(255, 255, 255, 0.1);
        }
        .nav-span-2 { grid-column: span 2; }
        .nav-span-4 { grid-column: span 4; }
        .nav-label {
            font-size: 0.6rem;
            color: #00a8ff;
            text-transform: uppercase;
            margin-bottom: 4px;
            font-weight: 600;
            letter-spacing: 0.5px;
            display: flex;
            align-items: center;
            gap: 6px;
            white-space: nowrap; /* Keep label on one line if possible */
        }
        .nav-label i { opacity: 0.7; font-size: 0.7rem; }
        
        /* FIX FOR BLEEDING: Allow wrapping, remove ellipsis */
        .nav-value {
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 1.0rem; /* Slightly smaller for better fit */
            color: #fff;
            font-weight: 600;
            
            /* The Critical Fixes */
            white-space: normal;  /* Allow text to wrap */
            overflow: visible;    /* Show all content */
            text-overflow: clip;  /* Remove ellipsis */
            word-wrap: break-word; /* Break long words if needed */
            line-height: 1.2;     /* Tighter line height for wrapped text */
        }
        
        .nav-value.large { font-size: 1.2rem; }
        .nav-value.small { font-size: 0.85rem; color: #ccc; }
        .nav-value.highlight { color: #4ade80; text-shadow: 0 0 5px rgba(74, 222, 128, 0.2); }
        .nav-value.accent { color: #f59e0b; }
        
        /* FIX FOR ROWS: Allow wrapping inside rows too */
        .nav-row {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            width: 100%;
            flex-wrap: wrap; /* Allow items to stack if they hit width limit */
            gap: 4px; /* Space between wrapped items */
        }
        
        .nav-unit {
            font-size: 0.7rem;
            color: #6b7280;
            margin-left: 2px;
            font-family: 'Segoe UI', sans-serif;
            font-weight: 400;
            white-space: nowrap;
        }

        @media (max-width: 992px) {
            .info-window { width: 95vw; top: 10px; right: 2.5vw; left: 2.5vw; max-height: calc(100vh - 20px); }
            .pfd-and-location-grid { grid-template-columns: 1fr; } 
            #fms-legs-module { display: none; }
            #location-data-panel { min-height: auto; }
            /* On mobile, switch grid to 2 columns to give more space */
            .nav-grid-container { grid-template-columns: repeat(2, 1fr); }
            .nav-span-2 { grid-column: span 2; }
        }
        
        .aircraft-overview-panel { 
            position: relative; 
            height: 200px; 
            background-size: cover; 
            background-position: center; 
            border-bottom-left-radius: 0; 
            border-bottom-right-radius: 0; 
            color: #fff; 
            display: flex; 
            flex-direction: column; 
            justify-content: space-between; 
            margin-bottom: -40px; 
        }
        
        .aircraft-overview-panel::before { 
            content: ''; 
            position: absolute; 
            inset: 0; 
            z-index: 1; 
            background: linear-gradient(
                to bottom,
                rgba(0, 0, 0, 0.7) 0%, 
                rgba(0, 0, 0, 0) 35%, 
                rgba(0, 0, 0, 0.2) 80%, 
                var(--iw-bg-start) 100%
            ); 
        }
        
        .overview-content { position: relative; z-index: 2; padding: 16px 20px 0 20px; display: flex; justify-content: space-between; align-items: flex-start; }
        .overview-col-left h3 { margin: 0; font-size: 1.6rem; font-weight: 700; text-shadow: 0 4px 10px rgba(0, 0, 0, 0.7); display: flex; align-items: center; gap: 12px; }
        .ac-header-logo { height: 1.8rem; width: auto; max-width: 100px; object-fit: contain; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.7)); }
        .overview-col-left p { position: relative; margin: 0; font-size: 1.0rem; color: #e8eaf6; font-weight: 400; text-shadow: 0 2px 5px rgba(0, 0, 0, 0.6); min-height: 1.2em; margin-top: 4px; }
        
        .ac-header-subtext { 
            position: absolute; 
            top: 0; 
            left: 0; 
            width: 100%; 
            opacity: 0; 
            white-space: normal; 
        }
        
        @keyframes primarySubtextAnimation { 0% { opacity: 1; transform: translateY(0); } 40% { opacity: 1; transform: translateY(0); } 50% { opacity: 0; transform: translateY(10px); } 51% { opacity: 0; transform: translateY(-10px); } 90% { opacity: 0; transform: translateY(-10px); } 100% { opacity: 1; transform: translateY(0); } }
        @keyframes secondarySubtextAnimation { 0% { opacity: 0; transform: translateY(-10px); } 40% { opacity: 0; transform: translateY(-10px); } 50% { opacity: 1; transform: translateY(0); } 90% { opacity: 1; transform: translateY(0); } 100% { opacity: 0; transform: translateY(10px); } }
        #ac-header-livery { animation: primarySubtextAnimation 8s infinite ease-in-out; }
        #ac-header-actype { animation: secondarySubtextAnimation 8s infinite ease-in-out; }
        .overview-actions { position: absolute; top: 16px; right: 16px; z-index: 3; display: flex; gap: 8px; }
        
        .route-summary-overlay { 
            position: relative; 
            padding: 15px 20px 12px 20px; 
            background: linear-gradient(180deg, 
                transparent 0%, 
                rgba(0, 0, 0, 0.2) 40%, 
                var(--iw-bg-start) 100%
            ); 
            display: grid; 
            grid-template-columns: auto 1fr auto; 
            align-items: center; 
            gap: 16px; 
            width: 100%; 
        }
        
        .route-summary-airport { display: flex; flex-direction: column; }
        #route-summary-dep { text-align: left; align-items: center; }
        #route-summary-arr { text-align: right; align-items: center; }
        .route-summary-airport .airport-line { display: flex; align-items: center; gap: 8px; }
        .route-summary-airport .icao { font-family: 'Courier New', monospace; font-size: 1.2rem; font-weight: 700; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,0.5); }
        .route-summary-airport .time { font-size: 0.85rem; font-weight: 600; color: #c5cae9; margin-top: 4px; text-align: center; }
        .country-flag { width: 20px; height: auto; border-radius: 3px; border: 1px solid rgba(255, 255, 255, 0.2); display: none; }
        .route-progress-container { display: grid; grid-template-columns: 1fr; grid-template-rows: 1fr; align-items: center; justify-items: center; position: relative; min-height: 28px; }
        .route-progress-bar-container { width: 100%; height: 6px; background: rgba(10, 12, 26, 0.7); border-radius: 3px; overflow: hidden; grid-row: 1; grid-column: 1; z-index: 1; }
        .progress-bar-fill { height: 100%; width: 0%; background: linear-gradient(90deg, #00a8ff, #89f7fe); transition: width 0.5s ease-out; border-radius: 3px; }
        .flight-phase-indicator { padding: 4px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: 700; color: #fff; border: 1px solid rgba(255, 255, 255, 0.1); grid-row: 1; grid-column: 1; z-index: 2; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5); }
        .phase-climb { background: rgba(34, 139, 34, 0.9); } .phase-cruise { background: rgba(0, 119, 255, 0.9); } .phase-descent { background: rgba(255, 140, 0, 0.9); } .phase-approach { background: rgba(138, 43, 226, 0.9); } .phase-enroute { background: rgba(100, 110, 130, 0.9); }
        
        .unified-display-main-content { 
            padding: 16px; 
            flex-grow: 1; 
            display: flex; 
            flex-direction: column; 
            gap: 16px; 
            background: linear-gradient(180deg, var(--iw-bg-start), var(--iw-bg-end));
            border-top: 1px solid rgba(255, 255, 255, 0.05);
        }

        .ac-tab-pane { display: none; flex-direction: column; gap: 16px; animation: fadeIn 0.4s; }
        .ac-tab-pane.active { display: flex; }
        .ac-profile-card-new { 
            background: rgba(0, 0, 0, 0.2); 
            border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.05); padding: 10px; border-top: 3px solid #a33ea3; display: flex; flex-direction: column; gap: 10px; 
        }
        .ac-profile-header { display: flex; justify-content: space-between; align-items: center; padding: 0 5px; }
        .profile-toggle-buttons { display: flex; background: rgba(0,0,0,0.3); border-radius: 6px; }
        .profile-toggle-btn { background: transparent; border: none; color: #9fa8da; padding: 6px 10px; font-size: 0.75rem; font-weight: 600; cursor: pointer; border-radius: 6px; transition: all 0.2s; }
        .profile-toggle-btn:hover { color: #fff; }
        .profile-toggle-btn.active { background: #00a8ff; color: #fff; box-shadow: 0 2px 5px rgba(0, 168, 255, 0.3); }
        
        .pfd-main-panel { 
            display: flex; 
            flex-direction: column; 
            width: 100%; 
            align-items: center; 
            gap: 16px; 
        }

        .display-bezel { 
            position: relative; 
            background-color: #1f2937; 
            border: 4px solid #374151; 
            padding: 12px; 
            border-radius: 1rem; 
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); 
            width: 100%; 
            box-sizing: border-box; 
            display: flex;
            flex-direction: column;
        }
        
        .screw { 
            position: absolute; 
            width: 0.5rem; 
            height: 0.5rem; 
            background-color: #4b5563; 
            border-radius: 50%; 
            box-shadow: inset 1px 1px 2px rgba(0,0,0,0.5); 
            z-index: 5; 
        }
        .screw.tl { top: 0.35rem; left: 0.35rem; } 
        .screw.tr { top: 0.35rem; right: 0.35rem; } 
        .screw.bl { bottom: 0.35rem; left: 0.35rem; } 
        .screw.br { bottom: 0.35rem; right: 0.35rem; }
        
        .crt-container { 
            width: 100%; 
            position: relative; 
            border: 2px solid #111827; 
            background: #000; 
            border-radius: 12px; 
            overflow: hidden; 
            box-shadow: inset 0 0 20px rgba(0,0,0,0.8); 
            display: flex; 
        }
        
        .scanlines::before { 
            content: " "; 
            display: block; 
            position: absolute; 
            top: 0; left: 0; bottom: 0; right: 0; 
            background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), 
                        linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06)); 
            z-index: 10; 
            background-size: 100% 2px, 3px 100%; 
            pointer-events: none; 
        }
        
        #pfd-container { width: 100%; }
        
        #pfd-container svg { 
            width: 100%; 
            height: auto; 
            display: block;
            margin: 0; 
            max-width: none; 
            aspect-ratio: 787 / 800; 
            background-color: #1a1a1a; 
            overflow: hidden; 
            border-radius: 0; 
            filter: brightness(1.3) contrast(1.2) drop-shadow(0 0 2px rgba(255, 255, 255, 0.3)); 
        }
        
        #nd-container { 
            width: 100%;
            aspect-ratio: 787 / 800; 
            background: transparent; 
            overflow: hidden; 
            display: flex; 
            justify-content: center; 
            height: auto; 
        }
        
        #nav-display-frame {
            width: 100%; 
            height: 100%; 
            border: none;
            display: block;
        }

        .rules-module-container {
            background: #000;
            border: 2px solid #333;
            border-radius: 4px;
            display: flex;
            flex-direction: column;
            box-shadow: inset 0 0 20px rgba(0,0,0,0.8);
            overflow: hidden;
        }

        .rules-header {
            background: #111;
            padding: 6px 10px;
            border-bottom: 1px solid #333;
            display: flex;
            justify-content: space-between;
            font-size: 0.8rem;
            font-weight: bold;
            color: #fff;
            font-family: 'Consolas', monospace;
        }

        .rules-body {
            padding: 12px;
            display: flex;
            justify-content: center;
            align-items: center;
            background: #0f1115; 
        }

        .flight-rules-badge {
            padding: 6px 16px;
            border-radius: 4px;
            font-family: 'Consolas', monospace;
            font-weight: bold;
            font-size: 1.1rem;
            text-align: center;
            width: 100%;
            border: 1px solid rgba(255,255,255,0.1);
            box-shadow: 0 4px 15px rgba(0,0,0,0.5);
            text-shadow: 0 1px 2px rgba(0,0,0,0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
        }

        .badge-ifr {
            background: linear-gradient(180deg, rgba(0, 119, 255, 0.2) 0%, rgba(0, 60, 130, 0.4) 100%);
            color: #00a8ff;
            border-color: #0077ff;
        }

        .badge-vfr {
            background: linear-gradient(180deg, rgba(40, 167, 69, 0.2) 0%, rgba(20, 80, 35, 0.4) 100%);
            color: #28a745;
            border-color: #28a745;
        }

        .badge-svfr {
            background: linear-gradient(180deg, rgba(255, 193, 7, 0.2) 0%, rgba(130, 100, 5, 0.4) 100%);
            color: #ffc107;
            border-color: #ffc107;
        }
        
        .vsd-module-container {
            height: 260px; 
            max-height: 260px;
            background: #000;
            border: 2px solid #333;
            border-radius: 4px;
            display: flex;
            flex-direction: column;
            box-shadow: inset 0 0 20px rgba(0,0,0,0.8);
            box-sizing: border-box;
            overflow: hidden;
            margin-bottom: 16px; 
        }

        .vsd-panel { 
            display: flex; 
            flex-direction: column; 
            background: #0f1115; 
            flex-grow: 1;
            position: relative;
            overflow: hidden; 
            width: 100%; 
        }

        .vsd-graph-window { 
            position: relative; 
            width: 100%; 
            height: 100%; 
            overflow: hidden; 
            padding-left: 35px; 
            box-sizing: border-box; 
        }

        #vsd-y-axis {
            position: absolute;
            top: 0;
            left: 0;
            width: 35px;
            height: 100%;
            background: #111;
            border-right: 1px solid #333;
            z-index: 10;
        }
        .y-axis-label {
            position: absolute;
            right: 4px;
            font-family: 'Consolas', monospace;
            font-size: 0.65rem;
            color: #666;
            transform: translateY(-50%);
        }

        #vsd-graph-content {
            position: relative;
            height: 100%;
        }

        #vsd-profile-svg {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            overflow: visible;
        }

        #vsd-profile-path {
            fill: none;
            stroke: #444; 
            stroke-width: 2;
            stroke-dasharray: 4, 2;
        }

        #vsd-flown-path {
            fill: none;
            stroke: #00e600; 
            stroke-width: 3;
            filter: drop-shadow(0 0 4px rgba(0, 230, 0, 0.5));
        }

        #vsd-aircraft-icon {
            position: absolute;
            width: 14px;
            height: 14px;
            background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="%2300a8ff" d="M488 256l-112-80v-96l-80 48-80-48v96L104 256 24 288v64l192-48v96l-32 32v32l72-24 72 24v-32l-32-32v-96l192 48v-64l-80-32z"/></svg>');
            background-size: contain;
            background-repeat: no-repeat;
            transform: translate(-50%, -50%);
            z-index: 20;
        }

        .vsd-wp-label {
            position: absolute;
            transform: translateX(-50%);
            font-family: 'Consolas', monospace;
            text-align: center;
            width: 60px;
            pointer-events: none;
        }
        .vsd-wp-label .wp-name {
            display: block;
            font-size: 0.7rem;
            color: #00a8ff;
            font-weight: bold;
            background: rgba(0,0,0,0.7);
            padding: 1px 3px;
            border-radius: 2px;
        }
        .vsd-wp-label .wp-alt {
            display: block;
            font-size: 0.6rem;
            color: #888;
            margin-top: 1px;
        }
        
        .vsd-footer {
            background: #111;
            padding: 4px 10px;
            border-top: 1px solid #333;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 0.7rem;
            color: #888;
            flex-shrink: 0;
        }
        .vsd-legend-item { display: flex; align-items: center; gap: 5px; }
        .dot-plan { width: 6px; height: 6px; background: #444; border-radius: 50%; }
        .dot-flown { width: 6px; height: 6px; background: #00e600; border-radius: 50%; box-shadow: 0 0 4px #00e600; }
        
        .ac-info-window-tabs {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: var(--iw-bg-start);
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            padding: 0 20px;
            height: 60px;
        }

        .ac-tabs-wrapper {
            display: flex;
            gap: 20px;
            height: 100%;
        }

        .ac-info-tab-logo {
            height: 32px; 
            width: auto;
            object-fit: contain;
            opacity: 0.8;
        }

        .ac-info-tab-btn {
            padding: 0 10px;
            height: 100%;
            border: none;
            background: transparent;
            color: #9fa8da;
            cursor: pointer;
            font-size: 0.95rem;
            font-family: 'Segoe UI', sans-serif;
            font-weight: 600;
            position: relative;
            display: flex;
            align-items: center;
            gap: 10px;
            transition: all 0.3s ease;
            border-bottom: 3px solid transparent;
        }

        .ac-info-tab-btn:hover {
            color: #fff;
        }

        .ac-info-tab-btn.active {
            color: #fff;
            border-bottom-color: #00a8ff;
            text-shadow: 0 0 10px rgba(0, 168, 255, 0.5);
        }
        .ac-info-tab-btn.active i {
            color: #00a8ff;
        }

        .ac-info-tab-btn.pilot-tab-btn {
            color: #e0e0e0;
            font-weight: 700;
            letter-spacing: 0.5px;
        }
        .ac-info-tab-btn.pilot-tab-btn i {
            color: #ffb74d; 
        }
        .ac-info-tab-btn.pilot-tab-btn.active {
            color: #fff;
            border-bottom-color: #ffb74d; 
            text-shadow: 0 0 10px rgba(255, 183, 77, 0.5);
        }

        @media (max-width: 768px) {
            .ac-info-tab-logo {
                display: none !important;
            }
            .ac-info-window-tabs {
                justify-content: center;
                padding: 0 10px;
            }
            .ac-tabs-wrapper {
                width: 100%;
                justify-content: space-around;
                gap: 0;
            }
        }

        .vsd-disclaimer { background: rgba(10, 12, 26, 0.5); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 8px; padding: 10px 14px; margin-top: 0; }

        /* --- MAPBOX POPUP OVERRIDES (FIXED) --- */
        .mapboxgl-popup-content {
            background: transparent !important;
            box-shadow: none !important;
            padding: 0 !important;
            border: none !important;
            /* This allows clicks/scrolls to pass through to the map */
            pointer-events: none !important; 
        }
        .mapboxgl-popup-tip {
            display: none !important;
        }
        
        /* --- FR24 STYLE CARD CONTAINER (MICRO) --- */
        .fr24-card-container {
            width: 160px;
            display: flex;
            flex-direction: column;
            gap: 3px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            /* Ensure the card itself doesn't block events either */
            pointer-events: none; 
        }

        /* --- TOP IMAGE BUBBLE --- */
        .fr24-image-box {
            height: 85px;
            width: 100%;
            background-color: #2c2c2e;
            background-size: cover;
            background-position: center;
            border-radius: 8px;
            position: relative;
            box-shadow: 0 2px 8px rgba(0,0,0,0.4);
            overflow: hidden;
        }
        
        .fr24-copyright {
            position: absolute;
            bottom: 3px;
            left: 6px;
            color: rgba(255, 255, 255, 0.7);
            font-size: 7px;
            font-weight: 500;
            text-shadow: 0 1px 2px rgba(0,0,0,1);
            z-index: 2;
        }
        
        .fr24-image-overlay {
            position: absolute;
            inset: 0;
            background: linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 40%);
        }

        /* --- BOTTOM INFO BUBBLE --- */
        .fr24-info-box {
            background-color: #2c2c2e;
            border-radius: 8px;
            padding: 6px 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.4);
            display: flex;
            flex-direction: column;
            gap: 4px;
            color: #ffffff;
        }

        .fr24-header-row {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .fr24-airline-logo {
            height: 14px;
            width: auto;
            max-width: 35px;
            object-fit: contain;
            border-radius: 1px;
        }

        .fr24-ident-group {
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .fr24-callsign {
            font-size: 13px;
            font-weight: 700;
            color: #fff;
            line-height: 1;
        }

        .fr24-ac-badge {
            background-color: #3a3a3c;
            border: 1px solid #48484a;
            color: #d1d1d6;
            font-size: 8px;
            font-weight: 600;
            padding: 0px 3px;
            border-radius: 3px;
            line-height: 1.1;
        }

        .fr24-route {
            font-size: 10px;
            font-weight: 500;
            color: #d1d1d6;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 100px;
        }

        .fr24-progress-track {
            height: 3px;
            width: 100%;
            background-color: #3a3a3c;
            border-radius: 1.5px;
            overflow: hidden;
            margin-top: 1px;
        }

        .fr24-progress-fill {
            height: 100%;
            background-color: #ff3b30;
            border-radius: 1.5px;
        }

        .fr24-stats-row {
            font-size: 10px;
            color: #98989d;
            font-weight: 600;
            margin-top: 1px;
        }

        /* --- AIRPORT WINDOW SPECIFIC STYLES --- */

/* 1. Airport Hero Header */
.airport-hero {
    background: linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    padding: 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    position: relative;
    overflow: hidden;
}

/* A subtle pattern overlay for the header */
.airport-hero::before {
    content: '';
    position: absolute;
    top: 0; right: 0; bottom: 0; left: 0;
    background-image: radial-gradient(#ffffff 1px, transparent 1px);
    background-size: 20px 20px;
    opacity: 0.05;
    pointer-events: none;
}

.apt-ident-group {
    display: flex;
    flex-direction: column;
    z-index: 2;
}

.apt-icao {
    font-family: 'Consolas', monospace;
    font-size: 2.5rem;
    font-weight: 800;
    color: #fff;
    line-height: 1;
    text-shadow: 0 4px 10px rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    gap: 12px;
}

.apt-name {
    font-size: 0.9rem;
    color: #94a3b8;
    margin-top: 6px;
    font-weight: 500;
}

.apt-meta-badge {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.1);
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 0.75rem;
    color: #cbd5e1;
    display: flex;
    align-items: center;
    gap: 6px;
}

/* 2. Weather Module Refactor */
.weather-module-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-top: 12px;
}

.wx-stat-box {
    background: rgba(255,255,255,0.03);
    border-radius: 6px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
}

.wx-label {
    font-size: 0.65rem;
    color: #64748b;
    text-transform: uppercase;
    font-weight: 700;
    margin-bottom: 4px;
}

.wx-value {
    font-family: 'Consolas', monospace;
    font-size: 0.95rem;
    color: #e2e8f0;
    font-weight: 600;
}

.wx-condition-pill {
    grid-column: span 4;
    background: rgba(16, 185, 129, 0.1); 
    border: 1px solid rgba(16, 185, 129, 0.2);
    color: #34d399;
    padding: 8px;
    border-radius: 6px;
    text-align: center;
    font-weight: 700;
    font-size: 0.9rem;
    margin-top: 4px;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
}

/* Dynamic colors for flight rules */
.wx-vfr { background: rgba(34, 197, 94, 0.1); color: #4ade80; border-color: rgba(34, 197, 94, 0.3); }
.wx-mvfr { background: rgba(59, 130, 246, 0.1); color: #60a5fa; border-color: rgba(59, 130, 246, 0.3); }
.wx-ifr { background: rgba(239, 68, 68, 0.1); color: #f87171; border-color: rgba(239, 68, 68, 0.3); }
.wx-lifr { background: rgba(168, 85, 247, 0.1); color: #c084fc; border-color: rgba(168, 85, 247, 0.3); }

/* 3. Route Cards (Flight Strips) */
.route-card {
    background: linear-gradient(to right, rgba(30, 41, 59, 0.4), rgba(30, 41, 59, 0.2));
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-left: 3px solid #00a8ff;
    border-radius: 4px;
    padding: 10px 14px;
    margin-bottom: 8px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    transition: all 0.2s;
}

.route-card:hover {
    background: rgba(30, 41, 59, 0.7);
    transform: translateX(2px);
    border-color: rgba(255, 255, 255, 0.15);
}

.route-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.route-callsign {
    font-family: 'Consolas', monospace;
    font-size: 1rem;
    color: #fff;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 8px;
}

.route-details {
    font-size: 0.75rem;
    color: #94a3b8;
    display: flex;
    align-items: center;
    gap: 10px;
}

.route-ac-badge {
    background: #1e293b;
    padding: 2px 6px;
    border-radius: 3px;
    color: #cbd5e1;
    font-weight: 600;
    font-size: 0.7rem;
    border: 1px solid rgba(255,255,255,0.1);
}

.plan-btn-mini {
    background: rgba(14, 165, 233, 0.1);
    color: #38bdf8;
    border: 1px solid rgba(14, 165, 233, 0.3);
    padding: 6px 12px;
    border-radius: 4px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
}

.plan-btn-mini:hover {
    background: #0ea5e9;
    color: #fff;
}

/* 4. ATC Grid */
.atc-grid-card {
    background: #1e293b;
    border: 1px solid rgba(255,255,255,0.05);
    border-radius: 6px;
    padding: 10px;
    margin-bottom: 8px;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.atc-type-badge {
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 800;
    text-transform: uppercase;
    width: 80px;
    text-align: center;
}
.atc-type-gnd { background: #0f172a; color: #94a3b8; border: 1px solid #334155; }
.atc-type-twr { background: #1e3a8a; color: #60a5fa; border: 1px solid #2563eb; }
.atc-type-app { background: #312e81; color: #818cf8; border: 1px solid #4f46e5; }
.atc-type-obs { background: #3f3f46; color: #a1a1aa; border: 1px solid #52525b; }

.atc-controller {
    font-weight: 600;
    color: #e2e8f0;
    font-size: 0.9rem;
}

.atc-duration {
    font-family: monospace;
    color: #64748b;
    font-size: 0.8rem;
}

/* --- [NEW] HERO ACTION BUTTONS --- */
        .hero-actions {
            position: absolute;
            top: 15px;
            right: 15px;
            display: flex;
            gap: 8px;
            z-index: 10;
        }

        .hero-btn {
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.2);
            color: #fff;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            cursor: pointer;
            display: grid;
            place-items: center;
            transition: all 0.2s ease;
            backdrop-filter: blur(4px);
        }

        .hero-btn:hover {
            background: rgba(255, 255, 255, 0.2);
            transform: scale(1.1);
        }

        /* --- AIRPORT WINDOW TABS (REDESIGNED) --- */
        .apt-tabs-header {
            display: flex;
            background: rgba(0, 0, 0, 0.2);
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            margin-bottom: 16px;
        }

        .apt-tab-btn {
            flex: 1;
            padding: 12px 10px;
            background: transparent;
            border: none;
            color: #94a3b8;
            font-size: 0.85rem;
            font-weight: 600;
            text-transform: uppercase;
            cursor: pointer;
            border-bottom: 2px solid transparent;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }

        .apt-tab-btn:hover {
            color: #fff;
            background: rgba(255, 255, 255, 0.05);
        }

        .apt-tab-btn.active {
            color: #38bdf8;
            border-bottom-color: #38bdf8;
            background: rgba(56, 189, 248, 0.1);
        }

        .apt-tab-content {
            display: none;
            animation: fadeIn 0.3s ease;
        }

        .apt-tab-content.active {
            display: block;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(5px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* --- RUNWAY DROPDOWN STYLES --- */
        .runway-dropdown-header {
            cursor: pointer;
            transition: background 0.2s;
        }
        .runway-dropdown-header:hover {
            background: rgba(255, 255, 255, 0.05);
        }
        .runway-dropdown-content {
            display: none; /* Closed by default */
            padding: 8px;
            border-top: 1px solid rgba(255, 255, 255, 0.05);
        }
        .runway-dropdown-content.open {
            display: grid; /* Grid layout when open */
            grid-template-columns: 1fr 1fr; 
            gap: 8px;
            animation: slideDown 0.3s ease-out;
        }
        .runway-toggle-icon {
            color: #94a3b8;
            transition: transform 0.3s ease;
        }
        .runway-dropdown-header.open .runway-toggle-icon {
            transform: rotate(180deg);
        }
        
        @keyframes slideDown {
            from { opacity: 0; transform: translateY(-5px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* --- SERVER SELECTOR PILL --- */
        #server-selector-container {
            position: absolute;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(15, 23, 42, 0.9);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 999px; /* Pill shape */
            padding: 4px;
            display: flex;
            gap: 4px;
            z-index: 1050; /* Above map, below modals */
            box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        }

        .server-btn {
            background: transparent;
            border: none;
            color: #94a3b8;
            padding: 6px 16px;
            font-size: 0.8rem;
            font-weight: 600;
            border-radius: 999px;
            cursor: pointer;
            transition: all 0.2s ease;
            white-space: nowrap;
            font-family: 'Inter', sans-serif;
        }

        .server-btn:hover {
            color: #fff;
            background: rgba(255, 255, 255, 0.05);
        }

        .server-btn.active {
            background: #3b82f6; /* Blue active state */
            color: #fff;
            box-shadow: 0 2px 10px rgba(59, 130, 246, 0.4);
        }

        /* Mobile adjustment to drop it below the search bar if needed */
        @media (max-width: 768px) {
            #server-selector-container {
                top: 70px; /* Push down below search bar on mobile */
                width: auto;
                max-width: 90vw;
            }
            .server-btn {
                padding: 6px 12px;
                font-size: 0.75rem;
            }
        }

    `;

    const style = document.createElement('style');
    style.id = styleId;
    style.type = 'text/css';
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
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

        // 2. Clear Map Data (Visuals) - IMMEDIATE FLUSH
        
        // Remove aircraft markers from DOM immediately
        Object.keys(pilotMarkers).forEach(fid => {
            if (pilotMarkers[fid].marker) pilotMarkers[fid].marker.remove();
        });
        pilotMarkers = {};
        
        // Clear caches
        liveTrailCache.clear();
        
        // Clear object IN PLACE to preserve reference for MapAnimator
        for (const key in currentMapFeatures) {
            delete currentMapFeatures[key];
        }
        
        // [PERFORMANCE TWEAK] Immediately notify MapAnimator to clear the canvas
        // before waiting for network data. This removes "ghost planes".
        if (mapAnimator && typeof mapAnimator._updateMapSource === 'function') {
            mapAnimator._updateMapSource(); 
        }
        
        // Clear any open flight details
        if (currentFlightInWindow) {
            const closeBtn = document.querySelector('.aircraft-window-close-btn');
            if (closeBtn) closeBtn.click();
        }

        // --- [UPDATED] ATC & NOTAM Reset Logic ---
        
        // A. Stop the existing polling interval. 
        // This prevents a pending request from the OLD server from returning 
        // and populating the map after we've cleared it.
        if (sectorOpsAtcNotamInterval) {
            clearInterval(sectorOpsAtcNotamInterval);
            sectorOpsAtcNotamInterval = null;
        }

        // B. Wipe Data arrays immediately
        activeAtcFacilities = [];
        activeNotams = [];
        
        // C. Force a re-render immediately.
        // Since activeAtcFacilities is now empty, this visually erases all 
        // red ATC dots from the map instantly.
        renderAirportMarkers();

        // 3. UI Updates
        document.querySelectorAll('.server-btn').forEach(btn => {
            if (btn.dataset.server === currentServerName) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // 4. Show "Loading" State
        showNotification(`Switching to ${currentServerName}...`, 'info');

        // 5. Socket Handshake (Joins the new room for live aircraft positions)
        if (sectorOpsSocket && sectorOpsSocket.connected) {
            sectorOpsSocket.emit('join_server_room', currentServerName);
        }

        // 6. Restart Data Polling (Just like Page Load)
        // Fetch new data immediately...
        updateSectorOpsSecondaryData();
        // ...and set up the interval for future updates.
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
     * --- [FIXED] Handles the search input event.
     * Finds matching flights from the live data and calls the render function.
     * @param {string} searchText - The text from the search input.
     */
    function handleSearchInput(searchText) {
        const dropdown = document.getElementById('search-results-dropdown');
        if (!dropdown) return;

        if (searchText.length < 2) {
            dropdown.innerHTML = ''; // Clear and hide
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
                const callsign = props.callsign || '';
                const username = props.username || '';

                if (callsign.toUpperCase().includes(upperSearchText) ||
                    username.toUpperCase().includes(upperSearchText)) {

                    // --- [MODIFICATION] ---
                    // Push the entire feature, not just text.
                    // This gives the render function access to coordinates and properties.
                    matches.push(feature);
                }
            } catch (error) {
                console.error('Error searching feature:', error, currentMapFeatures[flightId]);
            }
        }
        
        renderSearchResultsDropdown(matches);
    }


    /**
     * --- [FIXED] Renders the search results into the dropdown.
     * Now embeds all required data into the HTML to prevent race conditions.
     * @param {Array} matches - An array of full GeoJSON feature objects.
     */
    function renderSearchResultsDropdown(matches) {
        const dropdown = document.getElementById('search-results-dropdown');
        if (!dropdown) return;

        if (matches.length === 0) {
            dropdown.innerHTML = ''; // Clear and hide
            return;
        }

        // Limit to 10 results
        dropdown.innerHTML = matches.slice(0, 10).map(feature => {
            const props = feature.properties;
            const coords = feature.geometry.coordinates;

            // Stringify all data and escape single quotes for HTML safety
            const propsString = JSON.stringify(props).replace(/'/g, "&apos;");
            const coordsString = JSON.stringify(coords);

            return `
            <div class="search-result-item" 
                 data-flight-id="${props.flightId}"
                 data-coordinates='${coordsString}'
                 data-properties='${propsString}'>
                <i class="fa-solid fa-plane"></i>
                <div class="search-result-info">
                    <strong>${props.callsign}</strong>
                    <small>${props.username}</small>
                </div>
            </div>
        `;
        }).join('');
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
     * --- [FIXED] Toggles the OpenWeatherMap Precipitation Layer ---
     * Switched from the paid Maps 2.0 API to the free Maps 1.0 API endpoint.
     */
    function toggleWeatherLayer(show) {
        if (!sectorOpsMap) return;

        const SOURCE_ID = 'owm-precipitation-source'; // Renamed for clarity
        const LAYER_ID = 'owm-precipitation-layer';   // Renamed for clarity

        // 1. First-time creation
        if (show && !isWeatherLayerAdded) {
            if (!OWM_API_KEY) {
                console.error('OWM API Key is not loaded. Cannot add weather layer.');
                showNotification('Weather service is unavailable (No API Key).', 'error');
                return;
            }

            // --- [FIX] Define the OWM tile URL for the FREE Maps 1.0 API ---
            const owmTileUrl = `https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${OWM_API_KEY}`;
            
            // --- Add the source ---
            sectorOpsMap.addSource(SOURCE_ID, {
                'type': 'raster',
                'tiles': [owmTileUrl],
                'tileSize': 256,
                'maxzoom': 9 
            });

            // --- Add the layer ---
            sectorOpsMap.addLayer({
                'id': LAYER_ID,
                'type': 'raster',
                'source': SOURCE_ID,
                'paint': {
                    'raster-opacity': 0.7, // Precipitation can be a bit darker
                    'raster-fade-duration': 300
                }
            }, 
            'sector-ops-live-flights-layer' // Draw under aircraft
            ); 
            
            isWeatherLayerAdded = true;
            console.log('Precipitation layer added (using free Maps 1.0).');

        // 2. Toggle visibility
        } else if (isWeatherLayerAdded) {
            sectorOpsMap.setLayoutProperty(
                LAYER_ID,
                'visibility',
                show ? 'visible' : 'none'
            );
        }
    }

/**
     * --- [NEW] Toggles the OpenWeatherMap Cloud Layer ---
     * Uses the free 'clouds_new' layer from the Maps 1.0 API.
     */
    function toggleCloudLayer(show) {
        if (!sectorOpsMap) return;

        const SOURCE_ID = 'owm-cloud-source';
        const LAYER_ID = 'owm-cloud-layer';

        // 1. First-time creation
        if (show && !isCloudLayerAdded) {
            if (!OWM_API_KEY) {
                console.error('OWM API Key is not loaded. Cannot add cloud layer.');
                showNotification('Weather service is unavailable (No API Key).', 'error');
                return;
            }

            // --- Use the 'clouds_new' layer ---
            const owmTileUrl = `https://tile.openweathermap.org/map/clouds_new/{z}/{x}/{y}.png?appid=${OWM_API_KEY}`;
            
            sectorOpsMap.addSource(SOURCE_ID, {
                'type': 'raster',
                'tiles': [owmTileUrl],
                'tileSize': 256,
                'maxzoom': 9
            });

            sectorOpsMap.addLayer({
                'id': LAYER_ID,
                'type': 'raster',
                'source': SOURCE_ID,
                'paint': {
                    'raster-opacity': 0.6, // Slightly more transparent for layering
                    'raster-fade-duration': 300
                }
            }, 
            'sector-ops-live-flights-layer' // Draw under aircraft
            ); 
            
            isCloudLayerAdded = true;
            console.log('Cloud layer added (using free Maps 1.0).');

        // 2. Toggle visibility
        } else if (isCloudLayerAdded) {
            sectorOpsMap.setLayoutProperty(
                LAYER_ID,
                'visibility',
                show ? 'visible' : 'none'
            );
        }
    }

    /**
     * --- [NEW] Toggles the OpenWeatherMap Wind Speed Layer ---
     * Uses the free 'wind_new' layer from the Maps 1.0 API.
     */
    function toggleWindLayer(show) {
        if (!sectorOpsMap) return;

        const SOURCE_ID = 'owm-wind-source';
        const LAYER_ID = 'owm-wind-layer';

        // 1. First-time creation
        if (show && !isWindLayerAdded) {
            if (!OWM_API_KEY) {
                console.error('OWM API Key is not loaded. Cannot add wind layer.');
                showNotification('Weather service is unavailable (No API Key).', 'error');
                return;
            }

            // --- Use the 'wind_new' layer ---
            const owmTileUrl = `https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid=${OWM_API_KEY}`;
            
            sectorOpsMap.addSource(SOURCE_ID, {
                'type': 'raster',
                'tiles': [owmTileUrl],
                'tileSize': 256,
                'maxzoom': 9
            });

            sectorOpsMap.addLayer({
                'id': LAYER_ID,
                'type': 'raster',
                'source': SOURCE_ID,
                'paint': {
                    'raster-opacity': 0.6, // Slightly more transparent for layering
                    'raster-fade-duration': 300
                }
            }, 
            'sector-ops-live-flights-layer' // Draw under aircraft
            ); 
            
            isWindLayerAdded = true;
            console.log('Wind layer added (using free Maps 1.0).');

        // 2. Toggle visibility
        } else if (isWindLayerAdded) {
            sectorOpsMap.setLayoutProperty(
                LAYER_ID,
                'visibility',
                show ? 'visible' : 'none'
            );
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

// flight.js (Add this new function somewhere before handleSocketFlightUpdate)

    /**
     * --- [NEW FUNCTION] ---
     * Fetches community aircraft details from the backend and caches the result.
     * Uses a queue to prevent duplicate API calls for the same aircraft type/livery.
     * @param {string} type - The aircraftType (e.g., "Airbus A320-200").
     * @param {string} livery - The liveryName (e.g., "Air France").
     * @returns {Promise<object|null>} The cached data { imageUrl, contributorName } or null.
     */
    async function fetchCommunityAircraftDetails(type, livery) {
        if (!type || !livery) return null;

        const key = `${type}/${livery}`;

        // 1. Check local cache first
        if (communityAircraftCache.has(key)) {
            return communityAircraftCache.get(key);
        }

        // 2. Check if a fetch is already in progress (in the queue)
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
                    
                    // Handle array response from find() (though API returns results[0])
                    if (Array.isArray(data)) {
                        data = data.length > 0 ? data[0] : null;
                    }

                    if (data && data.imageUrl && data.contributorName) {
                        const result = { 
                            communityImageUrl: data.imageUrl, 
                            contributorName: data.contributorName 
                        };
                        communityAircraftCache.set(key, result);
                        return result;
                    }
                }
            } catch (error) {
                console.warn(`Background lookup failed for ${key}:`, error);
                // On failure, cache null to avoid repeated failing lookups
                communityAircraftCache.set(key, null); 
            }
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
            last_update: flight.position.lastReport || data.timestamp,
            // Preserve existing cached data
            communityImageUrl: existingProps.communityImageUrl || null, 
            contributorName: existingProps.contributorName || null,
        };

        // --- START: ASYNCHRONOUS LOOKUP LOGIC FOR HOVER CARD ---
        // Only run lookup if we don't have cached data yet and the aircraft info is present.
        if (acName && livName && !existingProps.communityImageUrl) {
            
            // Check the main cache map for instant hit
            const cachedData = communityAircraftCache.get(lookupKey);
            
            if (cachedData) {
                // If found in the main cache, apply immediately
                newProperties.communityImageUrl = cachedData.communityImageUrl;
                newProperties.contributorName = cachedData.contributorName;
            } else if (!lookupQueue.has(lookupKey)) {
                // If not in main cache AND not already in the queue, trigger the fetch.
                fetchCommunityAircraftDetails(acName, livName)
                    .then(result => {
                        // Once resolved, immediately update the feature in the cache
                        if (result && currentMapFeatures[flightId]) {
                            currentMapFeatures[flightId].properties.communityImageUrl = result.communityImageUrl;
                            currentMapFeatures[flightId].properties.contributorName = result.contributorName;
                            // Trigger a map redraw on the layer source if necessary (MapAnimator does this, but good practice)
                            if (isMapReady && sectorOpsMap.getSource('sector-ops-live-flights-source')) {
                                // Only need to update the source data if the properties changed
                                sectorOpsMap.getSource('sector-ops-live-flights-source').setData({
                                    type: 'FeatureCollection', 
                                    features: Object.values(currentMapFeatures)
                                });
                            }
                        }
                    })
                    .catch(err => console.error("Aircraft lookup failed:", err));
            }
            // If in queue, wait for it to resolve and update later.
        }
        // --- END: ASYNCHRONOUS LOOKUP LOGIC ---


        // Manually update the data cache (currentMapFeatures) immediately.
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
            // Update existing entry
            currentMapFeatures[flightId].properties = newProperties;
            currentMapFeatures[flightId].geometry.coordinates = [flight.position.lon, flight.position.lat];
        }

        // ================================================================
        // === SELECTED AIRCRAFT UPDATE LOGIC (UNCHANGED) ===
        // ================================================================
        if (flightId === currentFlightInWindow) {
            
            // 1. Update the shared position object
            currentAircraftPositionForGeocode = flight.position;
            
            // 2. Retrieve Cached Weather Data
            const cachedOat = currentAircraftPositionForGeocode.oat_c ?? 15; 
            const cachedWindDir = currentAircraftPositionForGeocode.wind_dir || 0;
            const cachedWindSpd = currentAircraftPositionForGeocode.wind_spd_kts || 0;

            // 3. Calculate TAS
            let calculatedTas = 0;
            if (flight.position.alt_ft != null) {
                calculatedTas = calculateTas(
                    flight.position.alt_ft, 
                    cachedOat, 
                    flight.position.gs_kt || 0
                );
            }

            // 4. Update Trail Cache
            const localTrail = liveTrailCache.get(flightId);
            const fullFlightProps = { ...newProperties, position: flight.position, aircraft: aircraftData };

            if (localTrail) {
                const newRoutePoint = {
                    latitude: flight.position.lat,
                    longitude: flight.position.lon,
                    altitude: flight.position.alt_ft,
                    groundSpeed: flight.position.gs_kt,
                    track: flight.position.heading_deg,
                    date: new Date(flight.position.lastReport || Date.now()).toISOString()
                };
                localTrail.push(newRoutePoint);
                liveTrailCache.set(flightId, localTrail);

                // 5. Update PFD Display
                updatePfdDisplay(flight.position);

                // Update Nav Panel
                updateNavPanelData(
                    flight.position.lat,
                    flight.position.lon,
                    flight.position.heading_deg,
                    cachedOat,
                    cachedWindDir,
                    cachedWindSpd
                );
                
                // 6. Update Navigation Display Iframe (Traffic, Plan, Wind)
                const navIframe = document.getElementById('nav-display-frame');
                if (navIframe && navIframe.contentWindow) {
                    
                    // A. Process Traffic
                    const ndTraffic = [];
                    const myLat = flight.position.lat;
                    const myLon = flight.position.lon;
                    const myAlt = flight.position.alt_ft;

                    flights.forEach(other => {
                        if (other.flightId === flightId) return; 
                        const otherFeature = currentMapFeatures[other.flightId];
                        if (!otherFeature || !otherFeature.properties || !otherFeature.properties.position) return;

                        let otherPos;
                        try {
                             otherPos = JSON.parse(otherFeature.properties.position);
                        } catch (e) { return; }

                        const latDiff = Math.abs(otherPos.lat - myLat);
                        const lonDiff = Math.abs(otherPos.lon - myLon);
                        if (latDiff > 1 || lonDiff > 1) return; 

                        const distKm = getDistanceKm(myLat, myLon, otherPos.lat, otherPos.lon);
                        const distNM = distKm / 1.852;

                        if (distNM < 45) {
                            const bearingTo = getBearing(myLat, myLon, otherPos.lat, otherPos.lon);
                            let relBearing = bearingTo - flight.position.heading_deg;
                            if (relBearing > 180) relBearing -= 360;
                            if (relBearing < -180) relBearing += 360;
                            const altDiffFt = otherPos.alt_ft - myAlt;
                            const altDiff100 = Math.round(altDiffFt / 100);

                            ndTraffic.push({
                                id: other.flightId,
                                bearing: relBearing,
                                dist: distNM,
                                altDiff: altDiff100,
                                vs: otherPos.vs_fpm
                            });
                        }
                    });

                    // B. Process Flight Plan for ND
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

                        const currentTrack = flight.position.heading_deg;
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
                            const gs = Math.max(1, flight.position.gs_kt || 0);
                            
                            ndNextWp = wp.identifier || wp.name || "WPT";
                            ndDist = Math.round(distNM);
                            
                            const totalMinutes = (distNM / gs) * 60;
                            const h = Math.floor(totalMinutes / 60);
                            const m = Math.floor(totalMinutes % 60);
                            ndEte = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                        }
                    }

                    navIframe.contentWindow.postMessage({
                        heading: flight.position.heading_deg,
                        track: flight.position.heading_deg,
                        gs: Math.round(flight.position.gs_kt),
                        tas: calculatedTas, 
                        windDir: cachedWindDir, 
                        windSpd: cachedWindSpd,
                        traffic: ndTraffic,
                        flightPlan: ndFlightPlan,
                        nextWp: ndNextWp,
                        nextWpDist: ndDist,
                        nextWpEte: ndEte
                    }, '*');
                }

                // 7. Update Info Window UI
                updateAircraftInfoWindow(fullFlightProps, cachedFlightDataForStatsView.plan, localTrail);

                // 8. Update Map Trail
                if (isMapReady) {
                    const layerId = sectorOpsLiveFlightPathLayers[flightId]?.flown;
                    const source = layerId ? sectorOpsMap.getSource(layerId) : null;
                    if (source) {
                        const newRouteData = generateAltitudeColoredRoute(localTrail, flight.position, cachedFlightDataForStatsView.plan);
                        source.setData(newRouteData);
                    }
                }
            }

            // 9. Update Planned Route Line
            if (cachedFlightDataForStatsView.plan && mapFilters.planDisplayMode !== 'none' && isMapReady) {
                updateFlightPlanLayer(flightId, cachedFlightDataForStatsView.plan, flight.position);
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
            // Clean visual and data cache
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

    sectorOpsSocket.on('disconnect', (reason) => {
        console.warn(`Socket: Disconnected. Reason: ${reason}`);
    });

    sectorOpsSocket.on('connect_error', (error) => {
        console.error(`Socket: Connection Error. ${error.message}`);
    });
}

/**
 * Densifies a route by adding intermediate points between each coordinate pair.
 * @param {Array<[number, number]>} coordinates - The original array of [lon, lat] points.
 * @param {number} numPoints - The number of intermediate points to add between each original point.
 * @returns {Array<[number, number]>} The new, densified array of [lon, lat] points.
 */
function densifyRoute(coordinates, numPoints = 20) {
    if (coordinates.length < 2) {
        return coordinates;
    }

    const densified = [];
    densified.push(coordinates[0]); // Start with the first point

    for (let i = 0; i < coordinates.length - 1; i++) {
        const [lon1, lat1] = coordinates[i];
        const [lon2, lat2] = coordinates[i + 1];

        // Only densify if the points are reasonably far apart
        if (getDistanceKm(lat1, lon1, lat2, lon2) > 5) { // e.g., don't densify short taxi segments
            for (let j = 1; j <= numPoints; j++) {
                const fraction = j / (numPoints + 1);
                const intermediate = getIntermediatePoint(lat1, lon1, lat2, lon2, fraction);
                densified.push([intermediate.lon, intermediate.lat]);
            }
        }
        
        densified.push(coordinates[i + 1]); // Add the next original point
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



/**
 * --- [UPDATED] Generates HTML for the Airport Info Window ---
 * Fixes: 3D Badge moved to right/silver, Attributes compacted, "Drag & Taxi" rename.
 */
async function createAirportInfoWindowHTML(icao) {
    // 1. Get Static Data (Fallback from airports.json)
    const staticData = airportsData[icao] || {};
    
    // 2. Fetch Live Data from Backend (ACARS URL)
    let liveData = null;
    try {
        const response = await fetch(`${ACARS_SOCKET_URL}/api/airport/${icao}`);
        if (response.ok) {
            const json = await response.json();
            if (json.ok && json.airport) {
                liveData = json.airport;
            }
        }
    } catch (e) {
        console.warn(`Could not fetch live data for ${icao}`, e);
    }

    // 3. Merge Data
    const airportName = liveData?.name || staticData.name || 'Unknown Airport';
    
    const city = liveData?.city || staticData.city;
    const state = liveData?.state || staticData.state;
    const cityState = [city, state].filter(Boolean).join(', ') || 'Location N/A';

    const countryName = liveData?.country?.name || staticData.country || '';
    let countryCode = '';
    if (liveData?.country?.isoCode) {
        countryCode = liveData.country.isoCode.toLowerCase();
    } else if (staticData.country) {
        countryCode = staticData.country.toLowerCase();
    }
    const flagSrc = countryCode ? `https://flagcdn.com/w40/${countryCode}.png` : '';
    
    const elevation = liveData?.elevation ?? staticData.elevation_ft ?? 0;
    const coords = {
        lat: liveData?.latitude ?? staticData.lat,
        lon: liveData?.longitude ?? staticData.lon
    };

    // --- 3D Badge Logic (Updated: Silver & Right Side) ---
    const is3D = liveData?.has3dBuildings === true;
    const badge3DHtml = is3D ? 
        `<span style="background: linear-gradient(135deg, #e2e8f0 0%, #94a3b8 100%); color: #0f172a; font-size: 0.65rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; margin-left: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.3); letter-spacing: 0.5px; text-shadow: none; vertical-align: middle;">3D</span>` 
        : '';

    // Filter Derived Data
    const atcForAirport = activeAtcFacilities.filter(f => f.airportName === icao);
    const notamsForAirport = activeNotams.filter(n => n.airportIcao === icao);
    const routesFromAirport = ALL_AVAILABLE_ROUTES.filter(r => r.departure === icao);
    const airportRunways = runwaysData[icao] || [];

    // --- Weather Logic ---
    let weatherHtml = '';
    let runwayRecHtml = ''; 
    let flightCategory = 'WAITING';
    let badgeClass = '';
    
    try {
        if (window.WeatherService) {
            const w = await window.WeatherService.fetchAndParseMetar(icao);
            
            flightCategory = 'VFR'; badgeClass = 'wx-vfr';
            if (w.raw.includes('LIFR')) { flightCategory = 'LIFR'; badgeClass = 'wx-lifr'; }
            else if (w.raw.includes('IFR') || w.raw.includes('VV')) { flightCategory = 'IFR'; badgeClass = 'wx-ifr'; }
            else if (w.raw.includes('MVFR')) { flightCategory = 'MVFR'; badgeClass = 'wx-mvfr'; }

            const recs = getRunwayRecommendations(airportRunways, w.wind);
            
            if (recs.length > 0) {
                runwayRecHtml = `
                <div class="tech-module" style="margin-bottom: 8px;">
                    <div class="tech-module-header runway-dropdown-header" id="runway-accordion-toggle">
                        <span class="tech-module-title"><i class="fa-solid fa-road"></i> RECOMMENDED RUNWAYS</span>
                        <i class="fa-solid fa-chevron-down runway-toggle-icon"></i>
                    </div>
                    <div class="tech-module-body runway-dropdown-content" id="runway-accordion-content">
                        ${recs.map(r => {
                            const windIcon = r.headwind >= 0 ? 'fa-arrow-down' : 'fa-arrow-up'; 
                            const windColor = r.headwind >= 0 ? '#4ade80' : '#ef4444';
                            return `
                            <div style="background: rgba(255,255,255,0.03); border-left: 3px solid ${r.color === 'green' ? '#22c55e' : r.color === 'orange' ? '#f59e0b' : '#ef4444'}; border-radius: 4px; padding: 8px; display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <div style="font-weight: 700; font-size: 1.1rem; color: #fff;">RWY ${r.ident}</div>
                                    <div style="font-size: 0.65rem; color: ${r.color === 'green' ? '#86efac' : r.color === 'orange' ? '#fcd34d' : '#fca5a5'}; font-weight: 600;">${r.reason}</div>
                                </div>
                                <div style="text-align: right;">
                                    <div style="font-size: 0.8rem; color: #e2e8f0; font-family: monospace;">
                                        <i class="fa-solid ${windIcon}" style="color: ${windColor}; font-size: 0.7rem;"></i> ${Math.abs(r.headwind)}<span style="font-size: 0.6rem; color: #64748b;">KT</span>
                                    </div>
                                </div>
                            </div>`;
                        }).join('')}
                    </div>
                </div>`;
            } else {
                runwayRecHtml = `<div class="tech-module" style="margin-bottom: 8px; padding: 12px; color: #64748b; font-size: 0.8rem; text-align: center;">No runway data available.</div>`;
            }

            weatherHtml = `
                <div class="tech-module" style="margin-bottom: 8px;">
                    <div class="tech-module-header">
                        <span class="tech-module-title"><i class="fa-solid fa-cloud-sun"></i> LIVE METAR</span>
                        <span class="tech-badge" style="background: rgba(255,255,255,0.1); color: #fff;">${new Date().toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'})} Z</span>
                    </div>
                    <div class="tech-module-body">
                        <div class="wx-condition-pill ${badgeClass}"><i class="fa-solid fa-plane-up"></i> ${flightCategory} CONDITIONS</div>
                        <div class="weather-module-grid">
                            <div class="wx-stat-box"><span class="wx-label">WIND</span><span class="wx-value" style="color: #38bdf8;">${w.wind}</span></div>
                            <div class="wx-stat-box"><span class="wx-label">VIS</span><span class="wx-value">${w.visibility || '10KM'}</span></div>
                            <div class="wx-stat-box"><span class="wx-label">TEMP</span><span class="wx-value" style="color: #fbbf24;">${w.temp}</span></div>
                            <div class="wx-stat-box"><span class="wx-label">QNH</span><span class="wx-value">${w.qnh || '1013'}</span></div>
                        </div>
                        <div style="margin-top: 12px; padding: 8px; background: rgba(0,0,0,0.3); border-radius: 4px; border: 1px solid rgba(255,255,255,0.05);">
                            <code style="font-family: monospace; color: #94a3b8; font-size: 0.75rem; line-height: 1.4; display: block; word-break: break-all;">${w.raw}</code>
                        </div>
                    </div>
                </div>`;
        } else {
            weatherHtml = '<div class="tech-module"><div class="tech-module-body"><p class="muted-text">Weather service unavailable.</p></div></div>';
        }
    } catch (err) {
        weatherHtml = '<div class="tech-module"><div class="tech-module-body"><p class="muted-text">Weather data offline.</p></div></div>';
    }

    // --- Attributes Module (Re-Designed) ---
    // Moved features here to make them less dense (Pills instead of big circles)
    let featuresHtml = '';
    if (liveData) {
        const features = [
            { key: 'hasJetbridges', label: 'Jetbridges', icon: 'fa-person-walking-luggage' },
            { key: 'hasSafedockUnits', label: 'Safedock', icon: 'fa-square-parking' },
            { key: 'hasTaxiwayRouting', label: 'Drag & Taxi', icon: 'fa-route' } // <-- Renamed
        ];

        const featurePills = features.map(f => {
            const isActive = liveData[f.key];
            const color = isActive ? '#4ade80' : '#475569';
            const opacity = isActive ? '1' : '0.5';
            // Sleek pill design instead of dense circles
            return `
                <div style="display: flex; align-items: center; gap: 6px; opacity: ${opacity}; color: ${isActive ? '#e2e8f0' : '#64748b'}; font-size: 0.7rem; font-weight: 600; background: rgba(255,255,255,0.03); padding: 4px 8px; border-radius: 4px; border: 1px solid ${isActive ? 'rgba(74, 222, 128, 0.2)' : 'transparent'};">
                    <i class="fa-solid ${f.icon}" style="color: ${color};"></i> ${f.label}
                </div>
            `;
        }).join('');

        const aptClass = liveData.class ? `Class ${liveData.class}` : 'N/A';
        const timezone = liveData.timezone ? liveData.timezone.split(' ')[0] : 'UTC';

        featuresHtml = `
            <div class="tech-module" style="margin-bottom: 8px;">
                <div class="tech-module-body" style="padding: 12px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;">
                        <div style="display: flex; gap: 12px;">
                            <span style="font-size: 0.75rem; color: #94a3b8;"><i class="fa-solid fa-earth-americas"></i> ${timezone}</span>
                            <span style="font-size: 0.75rem; color: #94a3b8;"><i class="fa-solid fa-ranking-star"></i> ${aptClass}</span>
                        </div>
                        <span style="font-size: 0.75rem; color: #94a3b8;">${countryName}</span>
                    </div>
                    
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        ${featurePills}
                    </div>
                </div>
            </div>
        `;
    }

    // --- Standard Tabs Content (Unchanged) ---
    let routesHtml = '<div style="padding: 20px; text-align: center; color: #64748b;">No departing routes found in database.</div>';
    if (routesFromAirport.length > 0) {
        routesHtml = `<div style="padding: 12px; display: flex; flex-direction: column; gap: 4px;">${routesFromAirport.map(route => {
            const airlineCode = extractAirlineCode(route.flightNumber);
            const routeDataString = JSON.stringify(route).replace(/'/g, "&apos;");
            const shortAc = route.aircraft.replace('Boeing', 'B').replace('Airbus', 'A').split(' ')[0];
            return `<div class="route-card"><div class="route-info"><div class="route-callsign"><img src="Images/vas/${airlineCode}.png" style="height: 16px; width: auto; max-width: 40px;" onerror="this.style.display='none'"> ${route.flightNumber}</div><div class="route-details"><span class="route-ac-badge">${shortAc}</span><span><i class="fa-solid fa-plane-arrival" style="color: #64748b;"></i> ${route.arrival}</span></div></div><button class="plan-btn-mini plan-flight-from-explorer-btn" data-route='${routeDataString}'>PLAN <i class="fa-solid fa-angle-right"></i></button></div>`;
        }).join('')}</div>`;
    }
    
    let atcHtml = '<div style="padding: 20px; text-align: center; color: #64748b;">No active ATC frequencies.</div>';
    if (atcForAirport.length > 0) {
        atcHtml = `<div style="padding: 12px;">${atcForAirport.map(f => {
            const typeName = atcTypeToString(f.type);
            let badgeClass = f.type === 1 ? 'atc-type-twr' : f.type === 0 ? 'atc-type-gnd' : (f.type === 4 || f.type === 5) ? 'atc-type-app' : 'atc-type-obs';
            return `<div class="atc-grid-card"><div style="display: flex; align-items: center; gap: 12px;"><span class="atc-type-badge ${badgeClass}">${typeName}</span><span class="atc-controller">${f.username || 'Unknown'}</span></div><span class="atc-duration"><i class="fa-regular fa-clock"></i> ${formatAtcDuration(f.startTime)}</span></div>`;
        }).join('')}</div>`;
    }

    let notamsHtml = '<div style="padding: 20px; text-align: center; color: #64748b;">No active NOTAMs.</div>';
    if (notamsForAirport.length > 0) {
        notamsHtml = `<div style="padding: 12px; display: flex; flex-direction: column; gap: 8px;">${notamsForAirport.map(n => `<div style="background: rgba(234, 179, 8, 0.1); border-left: 3px solid #eab308; padding: 10px; border-radius: 4px; color: #fef08a; font-family: monospace; font-size: 0.8rem;"><i class="fa-solid fa-triangle-exclamation"></i> ${n.message}</div>`).join('')}</div>`;
    }

    // --- Final Assembly ---
    // Note: badge3DHtml is now placed AFTER the flag image in the template below
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

        <div style="padding: 16px; flex-grow: 1; overflow-y: auto;">
            ${featuresHtml}
            ${weatherHtml}
            ${runwayRecHtml} 

            <div class="tech-module" style="min-height: 300px; display: flex; flex-direction: column;">
                <div class="apt-tabs-header">
                    <button class="apt-tab-btn active" data-target="apt-routes"><i class="fa-solid fa-route"></i> ROUTES</button>
                    <button class="apt-tab-btn" data-target="apt-atc"><i class="fa-solid fa-headset"></i> ATC</button>
                    <button class="apt-tab-btn" data-target="apt-notams"><i class="fa-solid fa-triangle-exclamation"></i> NOTAMs</button>
                </div>
                <div id="apt-routes" class="apt-tab-content active" style="padding: 0;">${routesHtml}</div>
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

        // 4. Handle Close Logic
        if (closeBtn) {
            aircraftInfoWindow.classList.remove('visible');
            if (window.MobileUIHandler) window.MobileUIHandler.closeActiveWindow();
            aircraftInfoWindowRecallBtn.classList.remove('visible');
            
            clearLiveFlightPath(currentFlightInWindow); 
            
            // --- [CRITICAL FIX] Clear ALL intervals ---
            if (activePfdUpdateInterval) clearInterval(activePfdUpdateInterval);
            if (activeGeocodeUpdateInterval) clearInterval(activeGeocodeUpdateInterval);
            if (activeWeatherUpdateInterval) clearInterval(activeWeatherUpdateInterval); // Clear Weather
            
            activePfdUpdateInterval = null;
            activeGeocodeUpdateInterval = null;
            activeWeatherUpdateInterval = null;
            // ------------------------------------------
            
            currentAircraftPositionForGeocode = null;
            liveTrailCache.delete(currentFlightInWindow);
            currentFlightInWindow = null;
            cachedFlightDataForStatsView = { flightProps: null, plan: null };
        }

        // 5. Handle Hide Logic
        if (hideBtn) {
            aircraftInfoWindow.classList.remove('visible');
            clearLiveFlightPath(currentFlightInWindow);

            // --- [CRITICAL FIX] Clear ALL intervals (pause updates while hidden) ---
            if (activePfdUpdateInterval) clearInterval(activePfdUpdateInterval);
            if (activeGeocodeUpdateInterval) clearInterval(activeGeocodeUpdateInterval);
            if (activeWeatherUpdateInterval) clearInterval(activeWeatherUpdateInterval); // Clear Weather
            
            activePfdUpdateInterval = null;
            activeGeocodeUpdateInterval = null;
            activeWeatherUpdateInterval = null;
            // ---------------------------------------------------------------------
            
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
                        // [UPDATED] Use helper
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
            // --- 1. [NEW] Inject Server Selector Pill ---
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

            // --- 2. Inject the Search Bar (Existing) ---
            if (!document.getElementById('sector-ops-search-container')) {
                const searchHtml = `
                    <div id="sector-ops-search-container" class="sector-ops-search">
                        <div class="search-bar-container">
                            <label for="sector-ops-search-input" class="search-icon-label">
                                <i class="fa-solid fa-magnifying-glass search-icon"></i>
                            </label>
                            <input type="text" id="sector-ops-search-input" placeholder="Search callsign or username..." aria-label="Search callsign or username" autocomplete="off">
                            <button id="sector-ops-search-clear" class="search-clear-btn" aria-label="Clear search" style="display: none;">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                        <div id="search-results-dropdown" class="search-results-dropdown"></div>
                    </div>
                `;
                mapContainer.insertAdjacentHTML('beforeend', searchHtml);
            }

            // --- 3. Inject Airport Info Window (Existing) ---
            if (!document.getElementById('airport-info-window')) {
                 const windowHtml = `
                    <div id="airport-info-window" class="info-window">
                        <div id="airport-window-content" class="info-window-content"></div>
                    </div>
                `;
                mapContainer.insertAdjacentHTML('beforeend', windowHtml);
            }

            // --- 4. Inject Aircraft Info Window (Existing) ---
            if (!document.getElementById('aircraft-info-window')) {
                 const windowHtml = `
                    <div id="aircraft-info-window" class="info-window">
                        
                    </div>
                `;
                mapContainer.insertAdjacentHTML('beforeend', windowHtml);
            }

            // --- 5. Inject Weather Settings Window (Existing) ---
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
                                    <span class="weather-toggle-label"><i class="fa-solid fa-cloud-rain"></i> Precipitation</span>
                                    <label class="toggle-switch">
                                        <input type="checkbox" id="weather-toggle-precip">
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
                                <strong>Note:</strong> These layers are provided by a free service. Please use them gently as resources are limited.
                            </div>
                        </div>
                    </div>
                `;
                mapContainer.insertAdjacentHTML('beforeend', windowHtml);
            }

            // --- 6. Inject Filter Settings Window (Existing) ---
            if (!document.getElementById('filter-settings-window')) {
                // ... (Keep existing Filter Window HTML logic exactly as is) ...
                const windowHtml = `
                    <div id="filter-settings-window" class="info-window">
                        <div class="info-window-header">
                            <h3><i class="fa-solid fa-filter" style="margin-right: 10px;"></i> Map Filters</h3>
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
            
            // --- 7. Inject Toolbar Buttons (if missing) ---
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
                        <button id="open-filter-settings-btn" class="toolbar-btn" title="Map Filters">
                            <i class="fa-solid fa-filter"></i>
                        </button>
                    `);
                 }
            }
            
            // --- 8. Assign Global Variables ---
            airportInfoWindow = document.getElementById('airport-info-window');
            airportInfoWindowRecallBtn = document.getElementById('airport-recall-btn');
            aircraftInfoWindow = document.getElementById('aircraft-info-window');
            aircraftInfoWindowRecallBtn = document.getElementById('aircraft-recall-btn');
            weatherSettingsWindow = document.getElementById('weather-settings-window');
            filterSettingsWindow = document.getElementById('filter-settings-window');

            // --- 9. Initialize Map and Load Content ---
            const selectedHub = "VIDP"; 
            await initializeSectorOpsMap(selectedHub);
            await loadExternalPanelContent();

            // --- 10. Set Up Event Listeners ---
            setupSectorOpsEventListeners();
            setupAirportWindowEvents();
            setupAircraftWindowEvents();
            setupWeatherSettingsWindowEvents();
            setupFilterSettingsWindowEvents(); 
            setupSearchEventListeners();

            // --- 11. Listen for ND_READY signal ---
            window.addEventListener('message', (event) => {
                if (event.data && event.data.type === 'ND_READY') {
                    refreshNavDisplayFromCache();
                }
            });

            // --- 12. Start Live Loop ---
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
            // --- [MODIFIED] Pass plan ---
            const routeFeatureCollection = generateAltitudeColoredRoute(localTrail, currentPosition, plan);

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
                    // --- [MODIFIED] Include new opacity and dash logic ---
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
                    
                    // ##### FIX START #####
                    // This is the fix for the "termites" / Z-fighting glitch.
                    'line-translate': [0, -2],
                    'line-translate-anchor': 'viewport'
                    // ##### FIX END #####
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

/**
 * --- [MODIFIED] Draws or updates the filed flight plan layers (direct or full)
 * based on the current filter settings.
 * @param {string} flightId - The flightId of the selected aircraft.
 * @param {object} plan - The parsed flight plan object.
 * @param {object} currentPosition - The aircraft's current position { lat, lon }.
 */
function updateFlightPlanLayer(flightId, plan, currentPosition) {
    if (!sectorOpsMap || !plan || !plan.flightPlanItems || plan.flightPlanItems.length < 2) {
        return; // Not enough data
    }

    const layerIdDirect = `plan-path-direct-${flightId}`;
    const layerIdFull = `plan-path-full-${flightId}`;
    
    // --- [MODIFICATION] Add new layer ID for labels ---
    const layerIdFullLabels = layerIdFull + '-labels'; // e.g., 'plan-path-full-FLIGHTID-labels'

    // --- Ensure layer IDs are tracked ---
    if (!sectorOpsLiveFlightPathLayers[flightId]) {
        sectorOpsLiveFlightPathLayers[flightId] = {};
    }
    sectorOpsLiveFlightPathLayers[flightId].planDirect = layerIdDirect;
    sectorOpsLiveFlightPathLayers[flightId].planFull = layerIdFull;
    // --- [NEW] Track the label layer ID ---
    sectorOpsLiveFlightPathLayers[flightId].planFullLabels = layerIdFullLabels;
    
    // --- Get destination coordinates ---
    const allWaypointsForLine = flattenWaypointsFromPlan(plan.flightPlanItems); // Kept for 'direct' mode
    if (allWaypointsForLine.length < 2) return;
    const destinationCoords = allWaypointsForLine[allWaypointsForLine.length - 1];
    const currentCoords = [currentPosition.lon, currentPosition.lat];

    // --- 1. Handle "Direct to Destination" Line ---
    if (mapFilters.planDisplayMode === 'direct') {
        const directLineData = {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: [currentCoords, destinationCoords]
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
                    'line-dasharray': [2, 2] // Dashed line
                }
            }, 'sector-ops-live-flights-layer'); // Below aircraft
        }
    } else {
        // Remove the layer if the mode is not 'direct'
        if (sectorOpsMap.getLayer(layerIdDirect)) sectorOpsMap.removeLayer(layerIdDirect);
        if (sectorOpsMap.getSource(layerIdDirect)) sectorOpsMap.removeSource(layerIdDirect);
    }

    // --- 2. Handle "Full Filed Plan" Line ---
    if (mapFilters.planDisplayMode === 'full') {
        const source = sectorOpsMap.getSource(layerIdFull);
        if (!source) {
            // --- [START MODIFICATION] ---
            // This layer is static, so we only create it once
            
            // Get coordinates for the line
            const allWaypoints = flattenWaypointsFromPlan(plan.flightPlanItems);
            // Get objects for the points/labels
            const waypointObjects = getFlatWaypointObjects(plan.flightPlanItems);

            const features = [];

            // 1. Add the LineString feature
            features.push({
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: allWaypoints
                }
            });

            // 2. Add all the Point features for labels
            waypointObjects.forEach(wp => {
                // Only add if it has a valid location
                if (wp.location && wp.location.longitude != null && wp.location.latitude != null) {
                    features.push({
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: [wp.location.longitude, wp.location.latitude]
                        },
                        properties: {
                            // Use identifier first (e.g., "KLAX", "VDOT"), fallback to name (e.g., "Los Angeles Intl")
                            name: wp.identifier || wp.name || '' 
                        }
                    });
                }
            });
            
            const fullLineData = {
                type: 'FeatureCollection',
                features: features
            };
            
            sectorOpsMap.addSource(layerIdFull, { type: 'geojson', data: fullLineData });
            
            // Add the LINE layer (as requested by user)
            sectorOpsMap.addLayer({
                id: layerIdFull,
                type: 'line',
                source: layerIdFull,
                // Filter so this layer only draws the LineString
                'filter': ['==', '$type', 'LineString'], 
                paint: {
                    'line-color': '#aaaaaa',      // Light grey color
                    'line-width': 2,
                    'line-opacity': 0.7,        // Not too showy
                    'line-dasharray': [3, 3]    // Dashed line
                }
            }, 'sector-ops-live-flights-layer'); // Below aircraft

            // Add the LABEL layer
            sectorOpsMap.addLayer({
                id: layerIdFullLabels, // Use the new ID
                type: 'symbol',
                source: layerIdFull,
                // Filter so this layer only draws the Points
                'filter': ['==', '$type', 'Point'],
                layout: {
                    'text-field': ['get', 'name'],
                    'text-font': ['Mapbox Txt Regular', 'Arial Unicode MS Regular'],
                    'text-size': 10, // "not too big"
                    'text-offset': [0, 0.8], // Offset slightly above the point
                    'text-anchor': 'top',
                    'text-allow-overlap': false, // Prevent clutter
                    'text-ignore-placement': false
                },
                paint: {
                    // --- [START OF FIX] ---
                    'text-color': '#ffffff', // Keep text white
                    'text-halo-color': 'rgba(10, 12, 26, 0.9)', // Use a dark, opaque UI color for the halo
                    'text-halo-width': 2, // Make the halo thicker to act as a background
                    'text-halo-blur': 1   // Add a slight blur to soften it
                    // --- [END OF FIX] ---
                }
            }, 'sector-ops-live-flights-layer'); // Below aircraft
            
            // --- [END MODIFICATION] ---
        }
    } else {
        // Remove the layer if the mode is not 'full'
        if (sectorOpsMap.getLayer(layerIdFull)) sectorOpsMap.removeLayer(layerDetails);
        // --- [NEW] Also remove the label layer ---
        if (sectorOpsMap.getLayer(layerIdFullLabels)) sectorOpsMap.removeLayer(layerIdFullLabels);
        
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

        // --- [REMOVED] Title Element Logic ---
        // const titleEl = document.getElementById('airport-window-title'); <-- Removed
        // titleEl.innerHTML = ...; <-- Removed
        
        const contentEl = document.getElementById('airport-window-content');
        contentEl.innerHTML = `<div class="spinner-small" style="margin: 2rem auto;"></div>`; // Loading state
        
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

                    // 1. Remove active class from all buttons
                    const allBtns = tabContainer.querySelectorAll('.apt-tab-btn');
                    allBtns.forEach(b => b.classList.remove('active'));

                    // 2. Add active class to clicked button
                    btn.classList.add('active');

                    // 3. Hide all tab content
                    const allContent = contentEl.querySelectorAll('.apt-tab-content');
                    allContent.forEach(content => content.classList.remove('active'));

                    // 4. Show target content
                    const targetId = btn.dataset.target;
                    const targetContent = contentEl.querySelector(`#${targetId}`);
                    if (targetContent) {
                        targetContent.classList.add('active');
                    }
                });
            }
        } else {
             airportInfoWindow.classList.remove('visible');
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



/**
 * --- [UPDATED v3] Generates an altitude-segmented GeoJSON FeatureCollection.
 * Includes Smart Gap Detection, Anti-Backtracking Logic, and Altitude Smoothing.
 */
function generateAltitudeColoredRoute(sortedPoints, currentPosition, flightPlan = null) {
    const features = [];
    
    // 1. Create a single array of all points
    const allPoints = [
        ...sortedPoints.map(p => ({
            longitude: p.longitude,
            latitude: p.latitude,
            altitude: p.altitude
        })),
        {
            longitude: currentPosition.lon,
            latitude: currentPosition.lat,
            altitude: currentPosition.alt_ft
        }
    ];

    if (allPoints.length < 2) {
        return { type: 'FeatureCollection', features: [] };
    }

    // 2. Create a new array of "unwrapped" points (Antimeridian fix)
    const unwrappedPoints = [];
    let firstValidIndex = allPoints.findIndex(p => p.longitude != null);
    
    if (firstValidIndex === -1) {
        return { type: 'FeatureCollection', features: [] };
    }
    
    let prevLon = allPoints[firstValidIndex].longitude;

    // Add points up to the first valid one
    for (let i = 0; i <= firstValidIndex; i++) {
        unwrappedPoints.push({
            ...allPoints[i],
            unwrappedLongitude: allPoints[i].longitude
        });
    }

    // Unwrap the rest
    for (let i = firstValidIndex + 1; i < allPoints.length; i++) {
        const currentPoint = allPoints[i];
        let currentLon = currentPoint.longitude;

        if (currentLon == null || prevLon == null) {
            unwrappedPoints.push({ ...currentPoint, unwrappedLongitude: currentLon });
            prevLon = currentLon;
            continue;
        }

        const dLon = currentLon - prevLon;

        // Fix crossing the 180th meridian
        if (dLon > 180) {
            currentLon -= 360; 
        } else if (dLon < -180) {
            currentLon += 360;
        }
        
        unwrappedPoints.push({
            ...currentPoint,
            unwrappedLongitude: currentLon
        });
        
        prevLon = currentLon; 
    }

    // 3. Prepare Flight Plan Waypoints for Gap Filling
    let planWaypoints = [];
    if (flightPlan && flightPlan.flightPlanItems) {
        // Flatten plan into simple objects with lat/lon/alt
        const flatten = (items) => {
            let res = [];
            items.forEach(item => {
                if (item.children && item.children.length > 0) {
                    res = res.concat(flatten(item.children));
                } else if (item.location) {
                    res.push({
                        lat: item.location.latitude,
                        lon: item.location.longitude,
                        alt: parseInt(item.altitude) || 0 
                    });
                }
            });
            return res;
        };
        planWaypoints = flatten(flightPlan.flightPlanItems);
    }

    // Helper to find closest plan index
    const getClosestPlanIndex = (lat, lon) => {
        let minDist = Infinity;
        let index = -1;
        for(let i=0; i<planWaypoints.length; i++) {
            const d = getDistanceKm(lat, lon, planWaypoints[i].lat, planWaypoints[i].lon);
            if(d < minDist) {
                minDist = d;
                index = i;
            }
        }
        return { index, dist: minDist };
    };

    const GAP_THRESHOLD_KM = 100;

    for (let i = 0; i < unwrappedPoints.length - 1; i++) {
        const p1 = unwrappedPoints[i];
        const p2 = unwrappedPoints[i+1];

        if (!p1 || !p2 || p1.unwrappedLongitude == null || p1.latitude == null || p2.unwrappedLongitude == null || p2.latitude == null) {
            continue;
        }

        const distKm = getDistanceKm(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
        
        // --- GAP DETECTION & SIMULATION ---
        if (distKm > GAP_THRESHOLD_KM) {
            
            // Try to bridge the gap using the flight plan
            let gapBridged = false;

            if (planWaypoints.length > 0) {
                const startMatch = getClosestPlanIndex(p1.latitude, p1.longitude);
                const endMatch = getClosestPlanIndex(p2.latitude, p2.longitude);

                // If we found sequential waypoints between the gap start and end
                if (startMatch.index !== -1 && endMatch.index !== -1 && endMatch.index > startMatch.index) {
                    
                    let prevGapPoint = p1;
                    
                    // --- [SMARTER SMOOTHING LOGIC] ---
                    // Determine where to start in the plan.
                    // If the closest waypoint is BEHIND us, we should skip it to avoid a "hook" shape.
                    let loopStartIndex = startMatch.index;

                    // Check if we have a "next" waypoint to compare against
                    if (loopStartIndex + 1 <= endMatch.index) {
                        const wpCurrent = planWaypoints[loopStartIndex];
                        const wpNext = planWaypoints[loopStartIndex + 1];

                        // Distance from Waypoint A -> Waypoint B
                        const legDist = getDistanceKm(wpCurrent.lat, wpCurrent.lon, wpNext.lat, wpNext.lon);
                        // Distance from Plane (p1) -> Waypoint B
                        const distToNext = getDistanceKm(p1.latitude, p1.longitude, wpNext.lat, wpNext.lon);

                        // If the Plane is closer to Waypoint B than Waypoint A is, 
                        // it means we are "past" Waypoint A. Skip A.
                        if (distToNext < legDist) {
                            loopStartIndex++;
                        }
                    }

                    // Iterate through the valid plan points
                    for (let j = loopStartIndex; j <= endMatch.index; j++) {
                        const wp = planWaypoints[j];
                        
                        // Smart Altitude: Inherit previous if current is 0/missing
                        let prevAlt = prevGapPoint.altitude || 0;
                        let targetAlt = wp.alt;
                        if (targetAlt <= 100) { 
                            targetAlt = prevAlt; 
                        }

                        // Create segment from Prev -> Plan WP
                        features.push({
                            type: 'Feature',
                            geometry: {
                                type: 'LineString',
                                coordinates: [
                                    [prevGapPoint.unwrappedLongitude || prevGapPoint.longitude, prevGapPoint.latitude],
                                    [wp.lon, wp.lat]
                                ]
                            },
                            properties: {
                                avgAltitude: (prevAlt + targetAlt) / 2,
                                simulated: true 
                            }
                        });
                        
                        // Update Prev for next loop
                        prevGapPoint = { 
                            latitude: wp.lat, 
                            longitude: wp.lon, 
                            unwrappedLongitude: wp.lon, 
                            altitude: targetAlt 
                        };
                    }

                    // Final segment: Last Plan WP -> p2 (Connect nicely to current location)
                    features.push({
                        type: 'Feature',
                        geometry: {
                            type: 'LineString',
                            coordinates: [
                                [prevGapPoint.unwrappedLongitude || prevGapPoint.longitude, prevGapPoint.latitude],
                                [p2.unwrappedLongitude, p2.latitude]
                            ]
                        },
                        properties: {
                            avgAltitude: ( (prevGapPoint.altitude||0) + (p2.altitude||0) ) / 2,
                            simulated: true
                        }
                    });
                    
                    gapBridged = true;
                }
            }

            // Fallback: If no plan or plan matching failed, draw a direct simulated line
            if (!gapBridged) {
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
                        avgAltitude: ((p1.altitude || 0) + (p2.altitude || 0)) / 2,
                        simulated: true
                    }
                });
            }

            continue; // Move to next iteration
        }
        
        // --- NORMAL FLOWN PATH ---
        const coords = [
            [p1.unwrappedLongitude, p1.latitude],
            [p2.unwrappedLongitude, p2.latitude]
        ];
        
        const alt1 = p1.altitude || 0;
        const alt2 = p2.altitude || 0;
        const avgAltitude = (alt1 + alt2) / 2;

        features.push({
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: coords
            },
            properties: {
                avgAltitude: avgAltitude,
                simulated: false 
            }
        });
    }

    return { type: 'FeatureCollection', features: features };
}



/**
 * --- [UPDATED] Handles the click on an aircraft, fetches data, and opens the window.
 * Now fetches Community Aircraft details from the backend.
 */
async function handleAircraftClick(flightProps, sessionId) {
    if (!flightProps || !flightProps.flightId) return;

    // [RESILIENCE] Prevent new clicks if one is already loading
    if (isAircraftWindowLoading) {
        console.warn("Aircraft click ignored: window is already loading.");
        return;
    }

    // [ORIGINAL] Prevent re-opening an already open window for the same flight
    if (currentFlightInWindow === flightProps.flightId && aircraftInfoWindow.classList.contains('visible')) {
        return;
    }

    // [RESILIENCE] Set loading flag
    isAircraftWindowLoading = true;

    // --- [CRITICAL] Clear ALL existing intervals first ---
    if (activePfdUpdateInterval) {
        clearInterval(activePfdUpdateInterval);
        activePfdUpdateInterval = null;
    }
    if (activeGeocodeUpdateInterval) {
        clearInterval(activeGeocodeUpdateInterval);
        activeGeocodeUpdateInterval = null;
    }

    resetPfdState();

    // [ORIGINAL] Clear previous flight's path/cache
    if (currentFlightInWindow && currentFlightInWindow !== flightProps.flightId) {
        clearLiveFlightPath(currentFlightInWindow);
        liveTrailCache.delete(currentFlightInWindow);
    }

    // --- Set State ---
    currentFlightInWindow = flightProps.flightId; 
    currentAircraftPositionForGeocode = flightProps.position; 
    lastGeocodeCoords = { lat: 0, lon: 0 }; 
    cachedFlightDataForStatsView = { flightProps: null, plan: null };

    // [UI] Show Window
    if (window.MobileUIHandler && window.MobileUIHandler.isMobile()) {
        window.MobileUIHandler.openWindow(aircraftInfoWindow);
    } else {
        aircraftInfoWindow.classList.add('visible');
    }
    aircraftInfoWindowRecallBtn.classList.remove('visible');
    
    // [UI] Loading State (Center spinner)
    const windowEl = document.getElementById('aircraft-info-window');
    windowEl.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 300px; color: #fff;">
            <div class="spinner-small" style="margin-bottom: 1rem;"></div>
            <p style="font-family: 'Inter', sans-serif; font-size: 0.9rem; color: #94a3b8;">Acquiring Flight & Aircraft Data...</p>
        </div>
    `;

    try {
        // Define layer ID for flown path
        const flownLayerId = `flown-path-${flightProps.flightId}`;
        
        // --- PREPARE DATA FOR LOOKUP ---
        const acName = flightProps.aircraft?.aircraftName || '';
        const livName = flightProps.aircraft?.liveryName || '';

        // --- FETCH DATA (Parallel: Plan, Route, AND Aircraft Details) ---
        const [planRes, routeRes, aircraftLookupRes] = await Promise.all([
            fetch(`${LIVE_FLIGHTS_API_URL}/${sessionId}/${flightProps.flightId}/plan`),
            fetch(`${LIVE_FLIGHTS_API_URL}/${sessionId}/${flightProps.flightId}/route`),
            // Fetch from your custom backend without sanitizing, just encoding for URL safety
            fetch(`${API_BASE_URL}/api/aircraft/lookup?type=${encodeURIComponent(acName)}&livery=${encodeURIComponent(livName)}`)
        ]);
        
        const planData = planRes.ok ? await planRes.json() : null;
        const plan = (planData && planData.ok) ? planData.plan : null;
        const routeData = routeRes.ok ? await routeRes.json() : null;

        // Process Aircraft Lookup Result
        let communityAircraftData = null;
        if (aircraftLookupRes.ok) {
            communityAircraftData = await aircraftLookupRes.json();
        } else {
            console.warn(`Aircraft lookup failed or no match found for ${acName} / ${livName}`);
        }
        
        // --- Process Route History ---
        let sortedRoutePoints = [];
        if (routeData && routeData.ok && Array.isArray(routeData.route) && routeData.route.length > 0) {
            sortedRoutePoints = routeData.route.sort((a, b) => {
                const timeA = a.date ? new Date(a.date).getTime() : 0;
                const timeB = b.date ? new Date(b.date).getTime() : 0;
                return timeA - timeB;
            });
        }
        
        // Seed the cache
        liveTrailCache.set(flightProps.flightId, sortedRoutePoints);
        // Cache data for stats view
        cachedFlightDataForStatsView = { flightProps, plan };
        
        // --- [RENDER] Populate the new Window UI (Pass the new data) ---
        populateAircraftInfoWindow(flightProps, plan, sortedRoutePoints, communityAircraftData);
        
        // --- [GEOCODE] Initial Fetch ---
        fetchAndDisplayGeocode(flightProps.position.lat, flightProps.position.lon);

        // --- [NAV PANEL] Initial Update ---
        updateNavPanelData(
            flightProps.position.lat,
            flightProps.position.lon,
            flightProps.position.heading_deg,
            flightProps.position.oat_c || 15,
            flightProps.position.wind_dir || 0,
            flightProps.position.wind_spd_kts || 0
        );

        // --- [MAP] Generate Altitude Colored Route (WITH SIMULATION) ---
        // Pass 'plan' to enable gap filling
        const routeFeatureCollection = generateAltitudeColoredRoute(sortedRoutePoints, flightProps.position, plan);

        if (!sectorOpsMap.getSource(flownLayerId)) {
            sectorOpsMap.addSource(flownLayerId, {
                type: 'geojson',
                data: routeFeatureCollection
            });
            sectorOpsMap.addLayer({
                id: flownLayerId,
                type: 'line',
                source: flownLayerId,
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
                    'line-opacity': 0.9, 
                    'line-dasharray': [1, 0],
                    'line-translate': [0, -2], 
                    'line-translate-anchor': 'viewport'
                }
            }, 'sector-ops-live-flights-layer');
        } else {
             sectorOpsMap.getSource(flownLayerId).setData(routeFeatureCollection);
        }

        // Store layer ID for cleanup
        sectorOpsLiveFlightPathLayers[flightProps.flightId] = {
            flown: flownLayerId
        };
        
        // --- [MAP] Draw Planned Route (if exists) ---
        if (plan) {
            updateFlightPlanLayer(flightProps.flightId, plan, flightProps.position);
        }
        
        // --- [INTERVALS] Start Updates ---
        const FIVE_MINUTES_MS = 300000; 
        activeGeocodeUpdateInterval = setInterval(() => {
            if (currentAircraftPositionForGeocode) {
                fetchAndDisplayGeocode(
                    currentAircraftPositionForGeocode.lat,
                    currentAircraftPositionForGeocode.lon
                );
            }
        }, FIVE_MINUTES_MS);
        
        // Initial Weather Fetch
        fetchAndDisplayWeather();
        if (activeWeatherUpdateInterval) clearInterval(activeWeatherUpdateInterval);
        activeWeatherUpdateInterval = setInterval(() => {
             fetchAndDisplayWeather();
        }, FIVE_MINUTES_MS);

        isAircraftWindowLoading = false;

    } catch (error) {
        console.error("Error fetching or plotting aircraft details:", error);
        windowEl.innerHTML = `<p class="error-text" style="padding: 2rem; color: #ef4444;">Could not retrieve complete flight details. The aircraft may have landed or disconnected.</p>`;
        
        isAircraftWindowLoading = false; 
        currentFlightInWindow = null; 
        cachedFlightDataForStatsView = { flightProps: null, plan: null };
        liveTrailCache.delete(flightProps.flightId);
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



/**
 * --- [UPDATED] Populates the aircraft info window with data from backend lookup.
 */
function populateAircraftInfoWindow(baseProps, plan, sortedRoutePoints, communityAircraftData) {
    // --- Helper function to update all elements matching a selector ---
    const updateAll = (selector, value, isHTML = false) => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
            if (isHTML) {
                el.innerHTML = value;
            } else {
                el.textContent = value;
            }
        });
    };
    
    // --- Helper for styling ---
    const styleAll = (selector, property, value) => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
            el.style[property] = value;
        });
    };

    // --- Get Original Data ---
    const originalFlatWaypoints = (plan && plan.flightPlanItems) ? flattenWaypointsFromPlan(plan.flightPlanItems) : [];
    const originalFlatWaypointObjects = (plan && plan.flightPlanItems) ? getFlatWaypointObjects(plan.flightPlanItems) : [];
    const hasPlan = originalFlatWaypoints.length >= 2;
    const windowEl = document.getElementById('aircraft-info-window');

    // Aircraft Info
    const aircraftName = baseProps.aircraft?.aircraftName || 'Unknown Type';
    const airlineName = baseProps.aircraft?.liveryName || 'Generic Livery';
    const liveryName = baseProps.aircraft?.liveryName || '';
    const reg = baseProps.aircraft?.registration || 'N/A';
    
    // Logo Logic (Client-side logic for Airline Logo remains useful)
    const words = liveryName.trim().split(/\s+/);
    let logoName = words.length > 1 && /[^a-zA-Z0-9]/.test(words[1]) ? words[0] : (words[0] + (words[1] ? ' ' + words[1] : ''));
    const sanitizedLogoName = logoName.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_');
    const logoPath = sanitizedLogoName ? `Images/airline_logos/${sanitizedLogoName}.png` : '';
    const logoHtml = logoPath ? `<img src="${logoPath}" alt="${liveryName}" class="ac-header-logo" onerror="this.style.display='none'">` : '';

    // Times & Flags
    const atdTimestamp = (sortedRoutePoints && sortedRoutePoints.length > 0) ? sortedRoutePoints[0].date : null;
    const atdTime = atdTimestamp ? formatTimeFromTimestamp(atdTimestamp) : '--:--';
    const etaTime = '--:--'; 
    const departureIcao = hasPlan ? originalFlatWaypointObjects[0]?.identifier || originalFlatWaypointObjects[0]?.name : 'N/A';
    const arrivalIcao = hasPlan ? originalFlatWaypointObjects[originalFlatWaypointObjects.length - 1]?.identifier || originalFlatWaypointObjects[originalFlatWaypointObjects.length - 1]?.name : 'N/A';
    const depCountryCode = airportsData[departureIcao]?.country ? airportsData[departureIcao].country.toLowerCase() : '';
    const arrCountryCode = airportsData[arrivalIcao]?.country ? airportsData[arrivalIcao].country.toLowerCase() : '';
    const depFlagSrc = depCountryCode ? `https://flagcdn.com/w20/${depCountryCode}.png` : '';
    const arrFlagSrc = arrCountryCode ? `https://flagcdn.com/w20/${arrCountryCode}.png` : '';
    const depFlagDisplay = depCountryCode ? 'block' : 'none';
    const arrFlagDisplay = arrCountryCode ? 'block' : 'none';

    // Plan Button
    const simbriefAircraftValue = findSimbriefAircraftValue(aircraftName);
    let planButtonHtml = '';
    if (hasPlan && simbriefAircraftValue) {
        planButtonHtml = `
        <button id="plan-this-flight-btn" class="pilot-stats-toggle-btn" 
                data-departure="${departureIcao}" 
                data-arrival="${arrivalIcao}" 
                data-aircraft="${simbriefAircraftValue}"
                style="width: 100%; margin-top: 16px;">
            <i class="fa-solid fa-file-invoice"></i> Plan This Flight
        </button>`;
    }

    const pilotUsername = baseProps.username || 'N/A';
    const pilotReportTabText = (pilotUsername !== 'N/A' && pilotUsername) ? pilotUsername : 'Pilot Report';

    // --- DYNAMIC IMAGE & CONTRIBUTOR LOGIC ---
    // Default Fallback
    let techCardImagePath = '/CommunityPlanes/default.png';
    let photographerName = 'IF Community';
    let techCardTail = reg; // Default to live registration

    // [FIX START] Handle if data comes as an array (common with DB lookups)
    if (Array.isArray(communityAircraftData)) {
        communityAircraftData = communityAircraftData.length > 0 ? communityAircraftData[0] : null;
    }

    // If backend returned data, use it
    if (communityAircraftData && communityAircraftData.imageUrl) {
        techCardImagePath = communityAircraftData.imageUrl;
        photographerName = communityAircraftData.contributorName || 'IF Community';
        // [FIX] Uncommented this to show the tail number from your DB
        if (communityAircraftData.tailNumber) {
            techCardTail = communityAircraftData.tailNumber; 
        }
    }
    // [FIX END]

    // --- Distance Calc for TOD Logic ---
    let distanceToDestNM = 0;
    if (hasPlan) {
        let totalDistanceKm = 0;
        for (let i = 0; i < originalFlatWaypoints.length - 1; i++) {
            const [lon1, lat1] = originalFlatWaypoints[i];
            const [lon2, lat2] = originalFlatWaypoints[i + 1];
            totalDistanceKm += getDistanceKm(lat1, lon1, lat2, lon2);
        }
        const totalDistanceNM = totalDistanceKm / 1.852;
        if (totalDistanceNM > 0) {
            const [destLon, destLat] = originalFlatWaypoints[originalFlatWaypoints.length - 1];
            const remainingDistanceKm = getDistanceKm(baseProps.position.lat, baseProps.position.lon, destLat, destLon);
            distanceToDestNM = remainingDistanceKm / 1.852;
        }
    }

    // --- TOD Calculator Logic ---
    let todHtml = '';
    
    // We need a destination and valid physics to calculate TOD
    if (hasPlan && baseProps.position.alt_ft > 5000 && distanceToDestNM > 20) {
        // 1. Get Altitudes
        const currentAlt = baseProps.position.alt_ft;
        // Try to get destination elevation from plan, default to 0 (Sea Level) if missing
        const destElev = (plan.destination && plan.destination.elevation_ft) ? parseInt(plan.destination.elevation_ft) : 0;
        
        // 2. Calculate Descent
        const altToLose = currentAlt - destElev;
        // 3:1 Rule: 3nm distance for every 1000ft height
        const descentDistanceNM = (altToLose / 1000) * 3;
        
        // 3. Calculate TOD location relative to us
        const distToTodNM = distanceToDestNM - descentDistanceNM;
        
        // 4. Calculate Time to TOD (based on current GS)
        let timeToTodStr = '--:--';
        if (baseProps.position.gs_kt > 50) {
            const timeHours = distToTodNM / baseProps.position.gs_kt;
            const minutes = Math.floor(timeHours * 60);
            const seconds = Math.floor((timeHours * 60 - minutes) * 60);
            
            // Format nicely
            if (distToTodNM > 0) {
                 timeToTodStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            } else {
                 timeToTodStr = 'NOW';
            }
        }

        // 5. Determine State (Cruise vs Descent)
        const isPastTod = distToTodNM <= 0;
        const statusColor = isPastTod ? '#ef4444' : '#34d399'; // Red if past, Green if pending
        const statusText = isPastTod ? 'DESCEND NOW' : 'CRUISING';
        const distDisplay = isPastTod ? `+${Math.abs(distToTodNM).toFixed(1)} NM` : `${distToTodNM.toFixed(1)} NM`;

        // 6. Build the HTML Module
        todHtml = `
        <div class="tech-module" id="tod-calculator-module">
            <div class="tech-module-header">
                <span class="tech-module-title"><i class="fa-solid fa-calculator"></i> DESCENT (3:1)</span>
                <span class="tech-badge" style="background: rgba(16, 185, 129, 0.1); color: ${statusColor}; border-color: ${statusColor};">
                    ${statusText}
                </span>
            </div>
            <div class="tech-module-body" style="padding: 8px; display: flex; gap: 8px; align-items: center;">
                
                <div style="flex: 1; display: flex; flex-direction: column; align-items: center; background: rgba(255,255,255,0.03); border-radius: 6px; padding: 6px;">
                    <span class="tech-stat-label" style="font-size: 8px; color: #94a3b8; margin-bottom: 2px;">DIST TO TOD</span>
                    <span class="tech-stat-value" style="font-size: 1.0rem;">${distDisplay}</span>
                </div>

                <div style="flex: 1; display: flex; flex-direction: column; align-items: center; background: rgba(255,255,255,0.03); border-radius: 6px; padding: 6px;">
                    <span class="tech-stat-label" style="font-size: 8px; color: #94a3b8; margin-bottom: 2px;">TIME TO TOD</span>
                    <span class="tech-stat-value" style="font-size: 1.0rem; color: #38bdf8;">${timeToTodStr}</span>
                </div>

                <div style="flex: 1; display: flex; flex-direction: column; align-items: center; background: rgba(255,255,255,0.03); border-radius: 6px; padding: 6px;">
                    <span class="tech-stat-label" style="font-size: 8px; color: #94a3b8; margin-bottom: 2px;">REQ. RATE</span>
                    <span class="tech-stat-value" style="font-size: 1.0rem; color: #fbbf24;">-${Math.round(baseProps.position.gs_kt * 5)}</span>
                </div>

            </div>
        </div>
        `;
    } else if (hasPlan && baseProps.position.alt_ft <= 5000) {
         todHtml = `
        <div class="tech-module">
            <div class="tech-module-header">
                <span class="tech-module-title"><i class="fa-solid fa-calculator"></i> DESCENT PHASE</span>
                <span class="tech-badge" style="color: #38bdf8; border-color: #38bdf8;">ACTIVE</span>
            </div>
            <div class="tech-module-body" style="padding: 12px; text-align: center; color: #94a3b8; font-size: 0.8rem;">
                Aircraft is in terminal phase.
            </div>
        </div>`;
    }

    // --- HTML Construction ---
    windowEl.innerHTML = `
    <style>
        /* --- Shared Tech Style --- */
        .tech-module {
            background: #0f172a; /* Solid Dark Slate */
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
            margin-bottom: 8px; 
            display: flex;
            flex-direction: column;
        }

        .tech-module-header {
            background: rgba(30, 41, 59, 0.5); /* Slightly lighter header */
            padding: 8px 12px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .tech-module-title {
            font-size: 0.75rem;
            font-weight: 700;
            color: #94a3b8; /* Muted text */
            text-transform: uppercase;
            letter-spacing: 0.05em;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .tech-module-body {
            padding: 12px;
            background: #0f172a;
            position: relative;
        }

        /* --- Tech Card Specifics --- */
        .tech-card {
            background: #0f172a; 
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px; 
            overflow: hidden;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
            position: relative;
            font-family: 'Inter', sans-serif;
            margin-bottom: 12px; 
        }
        .tech-card-header {
            padding: 12px 16px 4px; 
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            position: relative;
            z-index: 10;
        }
        .tech-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 1px 6px;
            border-radius: 999px;
            background: rgba(16, 185, 129, 0.1);
            border: 1px solid rgba(16, 185, 129, 0.2);
            font-size: 9px;
            font-weight: 700;
            color: #34d399;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .tech-ping {
            position: relative;
            display: flex;
            height: 5px;
            width: 5px;
        }
        .tech-ping span {
            position: absolute;
            display: inline-flex;
            height: 100%;
            width: 100%;
            border-radius: 50%;
            background-color: #34d399;
        }
        .tech-ping .animate {
            animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite;
            opacity: 0.75;
        }
        @keyframes ping {
            75%, 100% { transform: scale(2); opacity: 0; }
        }
        .tech-model {
            font-size: 1.1rem;
            font-weight: 700;
            color: #fff;
            letter-spacing: -0.025em;
            margin: 0;
            line-height: 1.2;
        }
        .tech-airline {
            font-size: 0.75rem;
            font-weight: 500;
            color: rgba(56, 189, 248, 0.9);
            margin-top: 0px;
            display: flex;
            align-items: center;
            gap: 5px;
        }
        .tech-content {
            padding: 12px;
            position: relative;
            z-index: 10;
        }
        .tech-image-container {
            position: relative;
            width: 100%;
            aspect-ratio: 21 / 9;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.2);
            border: 1px solid rgba(255, 255, 255, 0.05);
            background: #000;
        }
        .tech-image {
            width: 100%;
            height: 100%;
            object-fit: cover;
            transition: transform 0.7s ease-out;
        }
        .tech-image-container:hover .tech-image {
            transform: scale(1.05);
        }
        .tech-image-overlay {
            position: absolute;
            inset: 0;
            background: linear-gradient(to top, rgba(2, 6, 23, 0.9), transparent, transparent);
            opacity: 0.8;
        }
        .tech-image-info {
            position: absolute;
            bottom: 8px;
            left: 10px;
            right: 10px;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
        }
        .tech-photographer {
            display: flex;
            flex-direction: column;
        }
        .tech-photo-label {
            font-size: 9px;
            color: #cbd5e1;
            font-weight: 500;
            margin-bottom: 0px;
            line-height: 1;
        }
        .tech-photo-name {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 10px;
            font-weight: 600;
            color: #fff;
        }
        .tech-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
            margin-top: 12px;
        }
        .tech-stat-card {
            background: rgba(30, 41, 59, 0.5);
            border: 1px solid rgba(255, 255, 255, 0.05);
            padding: 8px 10px;
            border-radius: 6px;
            transition: background 0.2s;
        }
        .tech-stat-card:hover {
            background: rgba(30, 41, 59, 0.8);
        }
        .tech-stat-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 2px;
        }
        .tech-stat-label {
            font-size: 9px;
            font-weight: 600;
            color: #94a3b8;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .tech-stat-value {
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 0.95rem;
            color: #fff;
            font-weight: 600;
            letter-spacing: -0.025em;
        }
        .tech-country-card {
            grid-column: span 2;
            background: rgba(30, 41, 59, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.05);
            padding: 6px 10px;
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .tech-country-left {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .tech-country-icon {
            width: 24px;
            height: 24px;
            border-radius: 4px;
            background: rgba(51, 65, 85, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            color: #94a3b8;
        }
        .tech-bottom-bar {
            height: 3px;
            width: 100%;
            background: linear-gradient(to right, #0ea5e9, #2563eb, #4f46e5);
            opacity: 0.8;
        }

        /* --- FMS Overrides for Tech Style --- */
        .fms-columns {
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            color: #94a3b8;
        }
        .fms-row {
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }
        .fms-footer {
            background: rgba(30, 41, 59, 0.3);
            border-top: 1px solid rgba(255, 255, 255, 0.1);
        }

        /* --- Nav Data Overrides --- */
        .nav-header {
             display: none; /* We use the tech-module-header now */
        }
        #location-data-panel {
            background: transparent;
            border: none;
            box-shadow: none;
        }
        .nav-grid-container {
            padding: 0; /* Remove internal padding as body handles it */
        }
        .nav-cell {
            background: rgba(30, 41, 59, 0.5); /* Match tech-stat-card */
            border: 1px solid rgba(255, 255, 255, 0.05);
        }

        /* --- VSD Overrides --- */
        .vsd-module-container {
             background: transparent; 
             border: none;
             box-shadow: none;
             margin-bottom: 12px;
        }
        .vsd-footer {
            background: rgba(30, 41, 59, 0.3);
            border-top: 1px solid rgba(255, 255, 255, 0.1);
        }
        .vsd-graph-window {
            background: #0f172a; /* Match background */
        }
        #vsd-y-axis {
            background: #0f172a;
            border-right: 1px solid rgba(255, 255, 255, 0.1);
        }
    </style>

    <div class="info-window-content">
        <div class="aircraft-overview-panel" id="ac-overview-panel">
            <div class="overview-actions">
                <button class="aircraft-window-hide-btn" title="Hide"><i class="fa-solid fa-compress"></i></button>
                <button class="aircraft-window-close-btn" title="Close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="overview-content">
                <div class="overview-col-left">
                    <h3 id="ac-header-callsign">${logoHtml}${baseProps.callsign}</h3>
                    <p id="ac-header-subtext-container">
                        <span class="ac-header-subtext" id="ac-header-livery">${airlineName}</span>
                        <span class="ac-header-subtext" id="ac-header-actype">${aircraftName}</span>
                    </p>
                </div>
                <div class="overview-col-right">
                    <span class="route-icao" id="ac-header-dep">${departureIcao}</span>
                    <span class="route-icao" id="ac-header-arr">${arrivalIcao}</span>
                </div>
            </div>
        </div>

        <div class="route-summary-overlay">
            <div class="route-summary-airport" id="route-summary-dep">
                <div class="airport-line">
                    <img src="${depFlagSrc}" class="country-flag" id="ac-bar-dep-flag" alt="${depCountryCode}" style="display: ${depFlagDisplay};">
                    <span class="icao" id="ac-bar-dep">${departureIcao}</span>
                </div>
                <span class="time" id="ac-bar-atd">${atdTime} Z</span>
            </div>
            <div class="route-progress-container">
                <div class="route-progress-bar-container">
                    <div class="progress-bar-fill" id="ac-progress-bar"></div>
                </div>
                <div class="flight-phase-indicator" id="ac-phase-indicator">ENROUTE</div>
            </div>
            <div class="route-summary-airport" id="route-summary-arr">
                 <div class="airport-line">
                    <span class="icao" id="ac-bar-arr">${arrivalIcao}</span>
                    <img src="${arrFlagSrc}" class="country-flag" id="ac-bar-arr-flag" alt="${arrCountryCode}" style="display: ${arrFlagDisplay};">
                </div>
                <span class="time" id="ac-bar-eta">${etaTime} Z</span>
            </div>
        </div>

        <div class="ac-info-window-tabs">
            <div class="ac-tabs-wrapper">
                <button class="ac-info-tab-btn active" data-tab="ac-tab-flight-data">
                    <i class="fa-solid fa-gauge-high"></i> Flight Display
                </button>
                <button class="ac-info-tab-btn pilot-tab-btn" data-tab="ac-tab-pilot-report" data-user-id="${baseProps.userId}" data-username="${pilotUsername}">
                    <i class="fa-solid fa-chart-simple"></i> ${pilotReportTabText}
                </button>
            </div>
            <img src="Images/inflight.png" alt="Inflight Logo" class="ac-info-tab-logo">
        </div>

        <div class="unified-display-main-content">
            <div id="ac-tab-flight-data" class="ac-tab-pane active" style="gap: 6px;">
                
                <div class="pfd-and-location-grid">
                    <div class="pfd-main-panel">
                        <div class="display-bezel">
                            <div class="screw tl"></div><div class="screw tr"></div><div class="screw bl"></div><div class="screw br"></div>
                            <div class="crt-container scanlines" id="pfd-container">
                                <svg width="787" height="800" viewBox="0 0 787 800" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <g id="PFD" clip-path="url(#clip0_1_2890)">
                                    <g transform="translate(0, 100)">
                                        <g id="attitude_group">
                                            <rect id="Sky" x="-186" y="-222" width="1121" height="600" fill="#0596FF"/>
                                            <rect id="Ground" x="-138" y="307" width="1024" height="527" fill="#9A4710"/>
                                        </g>
                                        <rect id="Rectangle 1" x="-6" y="5" width="191" height="566" fill="#030309"/>
                                        <rect id="Rectangle 9" x="609" width="185" height="566" fill="#030309"/>
                                        <path id="Rectangle 2" d="M273.905 84.9424L180.983 183.181L-23 -9.76114L69.9218 -108L273.905 84.9424Z" fill="#030309"/>
                                        <path id="Rectangle 8" d="M303.215 77.0814L187.591 147.198L42 -92.8829L157.624 -163L303.215 77.0814Z" fill="#030309"/>
                                        <path id="Rectangle 7" d="M372.606 54.0171L244.59 97.5721L154.152 -168.242L282.169 -211.796L372.606 54.0171Z" fill="#030309"/>
                                        <rect id="Rectangle 10" x="25" y="487.905" width="168.696" height="262.947" transform="rotate(-31.8041 25 487.905)" fill="#030309"/>
                                        <rect id="Rectangle 14" width="67.3639" height="53.5561" transform="matrix(-0.972506 0.23288 0.23288 0.972506 482.512 537)" fill="#030309"/>
                                        <rect id="Rectangle 19" width="80.8905" height="53.5561" transform="matrix(-0.999899 0.0142423 0.0142423 0.999899 442.882 549.506)" fill="#030309"/>
                                        <rect id="Rectangle 18" width="46.2297" height="53.5561" transform="matrix(-0.988103 -0.153795 -0.153795 0.988103 369.916 549.11)" fill="#030309"/>
                                        <rect id="Rectangle 17" width="46.2297" height="53.5561" transform="matrix(-0.940186 -0.340662 -0.340662 0.940186 337.709 546.749)" fill="#030309"/>
                                        <rect id="Rectangle 16" width="46.2297" height="53.5561" transform="matrix(-0.940186 -0.340662 -0.340662 0.940186 299.709 531.749)" fill="#030309"/>
                                        <rect id="Rectangle 15" x="387" y="587.269" width="168.696" height="262.947" transform="rotate(-27.6434 387 587.269)" fill="#030309"/>
                                        <rect id="Rectangle 13" x="86" y="584.104" width="168.696" height="262.947" transform="rotate(-46.8648 86 584.104)" fill="#030309"/>
                                        <rect id="Rectangle 11" x="527" y="532.777" width="168.696" height="262.947" transform="rotate(-51.9135 527 532.777)" fill="#030309"/>
                                        <rect id="Rectangle 12" x="503" y="527.247" width="168.696" height="262.947" transform="rotate(-31.9408 503 527.247)" fill="#030309"/>
                                        <rect id="Rectangle 6" x="456.715" y="60.2651" width="131.991" height="278.153" transform="rotate(-177.303 456.715 60.2651)" fill="#030309"/>
                                        <rect id="Rectangle 5" x="525.118" y="90.4898" width="131.991" height="274.627" transform="rotate(-158.368 525.118 90.4898)" fill="#030309"/>
                                        <rect id="Rectangle 4" x="570.695" y="127.633" width="109.94" height="223.222" transform="rotate(-142.051 570.695 127.633)" fill="#030309"/>
                                        <rect id="Rectangle 3" x="613.292" y="189.098" width="99.2768" height="223.222" transform="rotate(-128.125 613.292 189.098)" fill="#030309"/>
                                        <path id="Vector 3" d="M609 183V422.5" stroke="#E7E6E8" stroke-width="4"/>
                                        <path id="Vector 1" d="M185.5 425.5L185 180" stroke="#DBDBDC" stroke-width="4"/>
                                        <path id="Vector 2" d="M185 181.502C185 181.502 269.8 52.0936 397 56.0907C524.2 60.0879 576.603 135.189 609 184" stroke="#DBDBDC" stroke-width="4"/>
                                        <path id="Vector 4" d="M608.5 424.5C608.5 424.5 557 548 396 550.5C235 553 185 424.5 185 424.5" stroke="#DBDBDC" stroke-width="4"/>
                                        <path id="Polygon 1" d="M396.252 65.2333L377.848 35.8138L414.647 35.8079L396.252 65.2333Z" fill="#E7F013"/>
                                        <path id="Polygon 2" d="M407.919 38.9482L396.431 59.4193L384.446 38.7244L407.919 38.9482Z" fill="#030309"/>
                                        <path id="Vector 6" d="M307 76L302 64.5L312 60.5L317 71" stroke="#E7E6E8" stroke-width="4"/>
                                        <path id="Vector 7" d="M279.5 91L268.5 73.5L259 79L269.5 97.5" stroke="#E7E6E8" stroke-width="4"/>
                                        <path id="Vector 8" d="M225 135L206.5 117" stroke="#E7E6E8" stroke-width="4"/>
                                        <path id="Vector 9" d="M477.153 71.5794L479.366 59.3018L489.886 61.5697L488.226 73.0218" stroke="#E7E6E8" stroke-width="4"/>
                                        <path id="Vector 10" d="M347.928 61.4888L346.352 49.0483L357.072 48.0112L358.929 59.4917" stroke="#E7E6E8" stroke-width="4"/>
                                        <path id="Vector 11" d="M435.153 59.5794L437.366 47.3018L447.886 49.5697L446.226 61.0218" stroke="#E7E6E8" stroke-width="4"/>
                                        <path id="Vector 12" d="M514.032 86.1754L522.756 72.2658L533.956 78.0405L525.5 93.5" stroke="#E7E6E8" stroke-width="4"/>
                                        <path id="Vector 13" d="M569.5 131.5L585.5 116" stroke="#E7E6E8" stroke-width="4"/>
                                        <path id="Vector 15" d="M183.5 193.5L173 187" stroke="#029705" stroke-width="4"/>
                                        <path id="Vector 16" d="M184 203L173.5 196.5" stroke="#029705" stroke-width="4"/>
                                        <path id="Vector 17" d="M610 193.5L619 188" stroke="#029705" stroke-width="3"/>
                                        <path id="Vector 18" d="M610 199.5L619 194" stroke="#029705" stroke-width="3"/>
                                        <line id="Line 1" x1="184" y1="211" x2="184" y2="184" stroke="#DBDBDC" stroke-width="2"/>
                                        <line id="Line 2" x1="610" y1="211" x2="610" y2="184" stroke="#DBDBDC" stroke-width="2"/>
                                        <rect id="altitude_bg" x="675" y="73" width="72" height="476" fill="#76767A"/>
                                        <g clip-path="url(#altTapeClip)">
                                            <svg x="675" y="73" width="72" height="476"><g id="altitude_tape_group"></g></svg>
                                        </g>
                                        <g id="altitude_indicator_static">
                                            <rect id="altitude_1" x="675" y="280" width="73" height="49" fill="#030309"/>
                                            <text id="altitude_readout_hundreds" x="740" y="316" fill="#00FF00" font-size="32" text-anchor="end" font-weight="bold">0</text>
                                            <g id="altitude_tens_reel_container" clip-path="url(#tensReelClip)"><g id="altitude_tens_reel_group"></g></g>
                                            <line id="Line 8" x1="669" y1="307" x2="618" y2="307" stroke="#DDDF07" stroke-width="8"/>
                                        </g>
                                        <path id="limit" d="M636 336.08L621.413 307.511L650.858 307.651L636 336.08Z" fill="#C477C6"/>
                                        <path id="limit2" d="M636 279L650.722 307.5H621.278L636 279Z" fill="#C477C6"/>
                                        <path id="limit3" d="M636 285L643.794 303H628.206L636 285Z" fill="#100010"/>
                                        <path id="limit4" d="M636.191 329.14L628.276 311.242L643.534 310.999L636.191 329.14Z" fill="#030309"/>
                                        <line id="Line 6" x1="746.5" y1="263" x2="746.5" y2="281" stroke="#ECED06" stroke-width="3"/>
                                        <line id="Line 4" x1="746.5" y1="329" x2="746.5" y2="347" stroke="#ECED06" stroke-width="3"/>
                                        <path id="Ellipse 1" d="M636 481C636 484.866 632.866 488 629 488C625.134 488 622 484.866 622 481C622 477.134 625.134 474 629 474C632.866 474 636 477.134 636 481Z" fill="#D9D9D9"/>
                                        <path id="Ellipse 4" d="M636 147C636 150.866 632.866 154 629 154C625.134 154 622 150.866 622 147C622 143.134 625.134 140 629 140C632.866 140 636 143.134 636 147Z" fill="#D9D9D9"/>
                                        <g id="Ellipse 3">
                                            <path d="M636 229C636 232.866 632.866 236 629 236C625.134 236 622 232.866 622 229C622 225.134 625.134 222 629 222C632.866 222 636 225.134 636 229Z" fill="#D9D9D9"/>
                                            <path d="M636 395C636 398.866 632.866 402 629 402C625.134 402 622 398.866 622 395C622 391.134 625.134 388 629 388C632.866 388 636 391.134 636 395Z" fill="#D9D9D9"/>
                                        </g>
                                        <rect id="speed" x="28" y="73" width="97" height="477" fill="#76767A"/>
                                        <g clip-path="url(#speedTapeClip)">
                                            <svg x="28" y="73" width="97" height="477"><g id="speed_tape_group"></g></svg>
                                        </g>
                                        <g id="speed_indicator_static">
                                            <path id="Polygon 9" d="M128.036 311.591L150.451 301.561L150.513 321.482L128.036 311.591Z" fill="#FDFD03"/>
                                            <path id="Vector 20" d="M137 311H96.5" stroke="#FDFD03" stroke-width="4"/>
                                            <rect x="50" y="296" width="45" height="30" fill="black" stroke="#999" stroke-width="1"/>
                                            <text id="speed_readout" x="72.5" y="318" fill="#00FF00" font-size="20" text-anchor="middle" font-weight="bold">0</text>
                                        </g>
                                        <path id="Vector 19" d="M19.5 311H31" stroke="#FDFD03" stroke-width="4"/>
                                        <path id="Vector 21" d="M29 73H151.5" stroke="#E7E6E8" stroke-width="4"/>
                                        <path id="Vector 22" d="M28 549H151.5" stroke="#E7E6E8" stroke-width="4"/>
                                        <path id="Vector 23" d="M672.5 73H774" stroke="#E7E6E8" stroke-width="4"/>
                                        <path id="Vector 24" d="M672 548.5H773" stroke="#E7E6E8" stroke-width="4"/>
                                        <path id="Vector 25" d="M745 549.5L746 347" stroke="#E7E6E8" stroke-width="3"/>
                                        <path id="Vector 26" d="M745 73V265" stroke="#E7E6E8" stroke-width="3"/>
                                        <g id="wings">
                                            <rect id="Rectangle 21" x="280" y="315" width="11" height="25" fill="#030309"/>
                                            <rect id="Rectangle 23" x="522" y="304" width="71" height="12" fill="#030309"/>
                                            <rect id="Rectangle 22" x="512" y="305" width="13" height="35" fill="#030309"/>
                                            <rect id="Rectangle 20" x="208" y="304" width="83" height="13" fill="#030309"/>
                                            <g id="wing">
                                                <path d="M278.591 316.857H208V304H291.608V340H278.591V316.857Z" stroke="#FEFE03" stroke-width="3"/>
                                                <path d="M511.392 340V304H595V316.857H524.409V340H511.392Z" stroke="#FEFE03" stroke-width="3"/>
                                            </g>
                                        </g>
                                        <g id="middle">
                                            <rect id="middle_2" x="393" y="304" width="17" height="17" fill="#0CC704"/>
                                            <rect id="Rectangle 24" x="395" y="307" width="13" height="11" fill="#030309"/>
                                        </g>
                                        <rect id="Rectangle 25" y="571" width="787" height="140" fill="#030309"/>
                                        <rect id="header" x="243" y="599" width="326" height="66" fill="#76767A"/>
                                        <g id="heading_indicator">
                                            <g id="heading_tape_container" clip-path="url(#headingClip)"><g id="heading_tape_group"></g></g>
                                            <g id="heading_static_elements">
                                                <line x1="406" y1="620" x2="406" y2="635" stroke="#FDFD03" stroke-width="3"/>
                                                <rect x="381" y="599" width="50" height="20" fill="black" stroke="#FFFFFF" stroke-width="1"/>
                                                <text id="heading_readout" x="406" y="615" fill="#00FF00" font-size="16" text-anchor="middle" font-weight="bold">000</text>
                                            </g>
                                        </g>
                                        <path id="Vector 27" d="M243 599V667" stroke="#FCFCFF" stroke-width="4"/>
                                        <g id="Line 5"><line id="Line 5_2" x1="745" y1="264.5" x2="787" y2="264.5" stroke="#ECED06" stroke-width="3"/></g>
                                        <line id="Line 6_2" x1="671" y1="279.5" x2="748" y2="279.5" stroke="#ECED06" stroke-width="3"/>
                                        <line id="Line 7" x1="671" y1="329.5" x2="748" y2="329.5" stroke="#ECED06" stroke-width="3"/>
                                        <line id="Line 3" x1="746" y1="345.5" x2="786" y2="345.5" stroke="#ECED06" stroke-width="3"/>
                                    </g> 
                                    </g>
                                    <defs>
                                        <clipPath id="clip0_1_2890"><rect width="787" height="800" fill="white"/></clipPath>
                                        <clipPath id="tensReelClip"><rect x="732" y="269" width="50" height="75"/></clipPath>
                                        <clipPath id="headingClip"><rect x="243" y="620" width="326" height="45"/></clipPath>
                                        <clipPath id="speedTapeClip"><rect x="28" y="73" width="97" height="477"/></clipPath>
                                        <clipPath id="altTapeClip"><rect x="675" y="73" width="72" height="476"/></clipPath>
                                    </defs>
                                </svg>
                            </div>
                        </div>
                        
                        <div class="display-bezel">
                            <div class="screw tl"></div><div class="screw tr"></div><div class="screw bl"></div><div class="screw br"></div>
                            <div class="crt-container scanlines">
                                <div id="nd-container">
                                    <iframe id="nav-display-frame" src="nav.html" scrolling="no"></iframe>
                                </div>
                            </div>
                        </div>

                    </div>
                    
                    <div class="info-right-col">
                        
                        <div class="tech-module" id="cockpit-seat-sensor">
                            <div class="tech-module-header">
                                <span class="tech-module-title"><i class="fa-solid fa-chair"></i> COCKPIT STATE</span>
                                <span class="fms-page-count"><i class="fa-solid fa-satellite-dish"></i></span>
                            </div>
                            <div class="tech-module-body">
                                <div class="cockpit-view">
                                    <div id="seat-cpt" class="seat" data-role="CPT"></div>
                                    <div id="seat-fo" class="seat" data-role="FO"></div>
                                    
                                    <div id="icon-parking-overlay" class="cockpit-overlay-icon icon-parking">P</div>
                                    <div id="icon-coffee-overlay" class="cockpit-overlay-icon icon-coffee"><i class="fa-solid fa-mug-hot"></i></div>
                                    <div id="icon-cloud-overlay" class="cockpit-overlay-icon icon-cloud"><i class="fa-solid fa-cloud"></i></div>
                                </div>
                                <div class="seat-status-display">
                                    <span id="status-cpt-text" class="status-pill">CMD: ---</span>
                                    <span id="status-fo-text" class="status-pill">FO: ---</span>
                                </div>
                                <div id="seat-narrative-text">
                                    Initializing...
                                </div>
                            </div>
                        </div>

                        ${todHtml}

                        <div id="fms-legs-module" class="tech-module" style="height: 380px; max-height: 380px; display: flex; flex-direction: column; margin-top: 12px;">
                            <div class="tech-module-header">
                                <span class="tech-module-title"><i class="fa-solid fa-route"></i> ACTIVE FLIGHT PLAN</span>
                                <span class="fms-page-count">1/1</span>
                            </div>
                            
                            <div class="fms-columns">
                                <span class="col-wpt">LEGS</span>
                                <span class="col-data text-center">CRS</span>
                                <span class="col-data text-right">DIST</span>
                            </div>

                            <div id="fms-legs-list" class="fms-list-scrollarea">
                                <div class="fms-empty-state">NO ROUTE LOADED</div>
                            </div>
                            
                            <div class="fms-footer">
                                <div class="fms-stat">
                                    <span class="stat-label">DTG</span>
                                    <span id="fms-total-dist" class="stat-value">---- NM</span>
                                </div>
                                <div class="fms-stat">
                                    <span class="stat-label">ETE</span>
                                    <span id="fms-total-ete" class="stat-value">--:--</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="tech-module" id="location-data-panel">
                    <div class="tech-module-header">
                        <span class="tech-module-title"><i class="fa-solid fa-location-crosshairs"></i> NAV DATA</span>
                        <span class="nav-status-indicator"><div class="nav-blink"></div> LIVE</span>
                    </div>
                    
                    <div class="tech-module-body" style="padding: 8px;">
                        <div class="nav-grid-container">
                            <div class="nav-cell">
                                <span class="nav-label"><i class="fa-solid fa-map-location-dot"></i> Region</span>
                                <span class="nav-value small" id="ac-location">Scanning...</span>
                            </div>
                            <div class="nav-cell">
                                <span class="nav-label"><i class="fa-solid fa-tower-control"></i> Nearest</span>
                                <div class="nav-row">
                                    <span class="nav-value highlight" id="ac-nearest-apt">---</span>
                                    <span class="nav-value" id="ac-nearest-apt-dist">--.- <span class="nav-unit">NM</span></span>
                                </div>
                            </div>
                            <div class="nav-cell">
                                <span class="nav-label"><i class="fa-solid fa-wind"></i> Wind</span>
                                <span class="nav-value" id="ac-env-wind">---/--</span>
                            </div>
                            <div class="nav-cell">
                                <span class="nav-label"><i class="fa-solid fa-temperature-half"></i> OAT</span>
                                <span class="nav-value" id="ac-env-oat">--°C</span>
                            </div>

                            <div class="nav-cell nav-span-2">
                                <span class="nav-label"><i class="fa-solid fa-location-crosshairs"></i> Position</span>
                                <div class="nav-row">
                                    <div><span class="nav-unit">LAT</span> <span class="nav-value" id="ac-lat">---</span></div>
                                    <div><span class="nav-unit">LON</span> <span class="nav-value" id="ac-lon">---</span></div>
                                </div>
                            </div>
                            <div class="nav-cell nav-span-2">
                                 <span class="nav-label"><i class="fa-solid fa-arrow-up-right-dots"></i> Vertical Speed</span>
                                 <span class="nav-value large highlight" id="ac-vs">--- <span class="nav-unit">fpm</span></span>
                            </div>

                            <div class="nav-cell nav-span-2">
                                <span class="nav-label"><i class="fa-solid fa-location-arrow"></i> Next Waypoint</span>
                                <div class="nav-row">
                                    <span class="nav-value accent" id="ac-next-wp">---</span>
                                    <span class="nav-value" id="ac-next-wp-dist">--.- <span class="nav-unit">NM</span></span>
                                </div>
                            </div>
                            <div class="nav-cell nav-span-2">
                                <span class="nav-label"><i class="fa-solid fa-flag-checkered"></i> Destination</span>
                                <div class="nav-row">
                                    <div><span class="nav-unit">DIST</span> <span class="nav-value" id="ac-dist">---</span></div>
                                    <div><span class="nav-unit">ETE</span> <span class="nav-value" id="ac-ete">--:--</span></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="tech-card">
                    <div class="tech-card-header">
                        <div>
                            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                                <div class="tech-badge">
                                    <span class="tech-ping">
                                      <span class="animate"></span>
                                      <span></span>
                                    </span>
                                    Active
                                </div>
                                <span style="font-size: 10px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.1em;">Flight Data</span>
                            </div>
                            <h1 class="tech-model">${aircraftName}</h1>
                            <p class="tech-airline">
                                <i class="fa-solid fa-plane" style="font-size: 12px;"></i>
                                <span>${airlineName}</span>
                            </p>
                        </div>
                        <button style="padding: 8px; color: #94a3b8; background: transparent; border: none; cursor: pointer;">
                            <i class="fa-solid fa-ellipsis" style="font-size: 16px;"></i>
                        </button>
                    </div>

                    <div class="tech-content">
                        <div class="tech-image-container">
                            <img src="${techCardImagePath}" onerror="this.src='/CommunityPlanes/default.png'" class="tech-image" alt="Aircraft">
                            <div class="tech-image-overlay"></div>
                            
                            <div class="tech-image-info">
                                <div class="tech-photographer">
                                    <span class="tech-photo-label">Contributor</span>
                                    <div class="tech-photo-name">
                                        <i class="fa-solid fa-camera" style="color: #38bdf8; font-size: 12px;"></i>
                                        <span>${photographerName}</span>
                                    </div>
                                </div>
                                <a href="#" style="padding: 8px; background: rgba(255,255,255,0.1); border-radius: 8px; color: #fff; border: 1px solid rgba(255,255,255,0.1); display: flex;">
                                    <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 14px;"></i>
                                </a>
                            </div>
                        </div>

                        <div class="tech-grid">
                            <div class="tech-stat-card">
                                <div class="tech-stat-header">
                                    <span class="tech-stat-label">Registration</span>
                                    <i class="fa-solid fa-hashtag" style="font-size: 12px; color: #475569;"></i>
                                </div>
                                <span class="tech-stat-value">${techCardTail}</span>
                            </div>

                            <div class="tech-stat-card">
                                <div class="tech-stat-header">
                                    <span class="tech-stat-label">Callsign</span>
                                    <i class="fa-solid fa-tag" style="font-size: 12px; color: #475569;"></i>
                                </div>
                                <span class="tech-stat-value">${baseProps.callsign}</span>
                            </div>

                            <div class="tech-country-card">
    <div class="tech-country-left">
        <div class="tech-country-icon">
            <i class="fa-solid fa-plane-up" style="font-size: 14px;"></i>
        </div>
        <div style="display: flex; flex-direction: column;">
            <span class="tech-stat-label" style="font-size: 9px; margin-bottom: 2px;">Category</span>
            <span style="font-size: 13px; font-weight: 600; color: #fff; text-transform: capitalize;">${baseProps.category || 'Standard'}</span>
        </div>
    </div>
    <div style="padding: 4px 8px; background: rgba(51, 65, 85, 0.5); border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.05);">
        <span style="font-family: monospace; font-size: 10px; color: #cbd5e1;">CLASS</span>
    </div>
</div>
                        </div>
                    </div>
                    <div class="tech-bottom-bar"></div>
                </div>

                <div class="tech-module vsd-module-container">
                    <div class="tech-module-header">
                        <span class="tech-module-title"><i class="fa-solid fa-chart-area"></i> VERTICAL SITUATION DISPLAY</span>
                        <span class="fms-page-count">VSD</span>
                    </div>
                    
                    <div id="vsd-panel" class="vsd-panel active" data-plan-id="" data-profile-built="false">
                        <div id="vsd-graph-window" class="vsd-graph-window">
                            <div id="vsd-aircraft-icon"></div>
                            <div id="vsd-graph-content">
                                <svg id="vsd-profile-svg" xmlns="http://www.w3.org/2000/svg">
                                    <path id="vsd-flown-path" d="" />
                                    <path id="vsd-profile-path" d="" />
                                </svg>
                                <div id="vsd-waypoint-labels"></div>
                            </div>
                        ${planButtonHtml} </div>
                    </div>

                    <div class="vsd-footer">
                        <div class="vsd-legend-item"><div class="dot-plan"></div> PLANNED</div>
                        <div class="vsd-legend-item"><div class="dot-flown"></div> FLOWN</div>
                        <div>ALTITUDE PROFILE</div>
                    </div>
                </div>
                </div> 
            
            <div id="ac-tab-pilot-report" class="ac-tab-pane">
                <div id="pilot-stats-display"></div>
            </div>
        </div> 
    </div>
    `;
    
    // --- POST-RENDER LOGIC ---
    createPfdDisplay();
    updatePfdDisplay(baseProps.position);
    updateAircraftInfoWindow(baseProps, plan, sortedRoutePoints, communityAircraftData);
    
    // --- FIX IMPLEMENTATION: SET THE DATA ATTRIBUTE ON THE HEADER HERE ---
    const imagePath = techCardImagePath; 
    const fallbackPath = '/CommunityPlanes/default.png';
    const newImageUrl = `url('${imagePath}'), url('${fallbackPath}')`; 

    const overviewPanels = document.querySelectorAll('#ac-overview-panel');
    
    overviewPanels.forEach(overviewPanel => {
        // Set the background image
        overviewPanel.style.backgroundImage = newImageUrl;
        
        // --- CRITICAL FIX: Set the path to the high-quality image ---
        overviewPanel.dataset.currentPath = imagePath;
        // --- END CRITICAL FIX ---
    });

}

/**
 * --- [UPDATED] Updates the Navigation Data Panel ---
 */
function updateNavPanelData(lat, lon, heading, oat, windDir, windSpd) {
    // 1. Update Coordinates (Clean formatting)
    const latEl = document.getElementById('ac-lat');
    const lonEl = document.getElementById('ac-lon');
    
    // Use toFixed(3) to save space and prevent "falling out"
    if (latEl) latEl.textContent = lat.toFixed(3);
    if (lonEl) lonEl.textContent = lon.toFixed(3);

    // 2. Update Environment
    const windEl = document.getElementById('ac-env-wind');
    const oatEl = document.getElementById('ac-env-oat');
    
    // Format: 270 / 15
    if (windEl) windEl.textContent = `${String(windDir).padStart(3, '0')}° / ${windSpd}`;
    if (oatEl) oatEl.textContent = `${oat}°C`;

    // 3. Nearest Airport Logic (Unchanged, just targets)
    if (airportsData && Object.keys(airportsData).length > 0) {
        let nearestICAO = '---';
        let minDist = Infinity;
        
        // Optimization: Only check airports within ~2 degrees lat/lon
        for (const icao in airportsData) {
            const apt = airportsData[icao];
            if (!apt || apt.lat == null || apt.lon == null) continue;

            const latDiff = Math.abs(apt.lat - lat);
            const lonDiff = Math.abs(apt.lon - lon);

            if (latDiff > 2 || lonDiff > 2) continue;

            const dist = getDistanceKm(lat, lon, apt.lat, apt.lon);
            if (dist < minDist) {
                minDist = dist;
                nearestICAO = icao;
            }
        }

        const nearestEl = document.getElementById('ac-nearest-apt');
        const nearestDistEl = document.getElementById('ac-nearest-apt-dist');
        
        if (nearestEl && minDist !== Infinity) {
            nearestEl.textContent = nearestICAO;
            const distNM = (minDist / 1.852).toFixed(1);
            nearestDistEl.textContent = `${distNM} NM`;
        }
    }
}

function updateSeatSensor(flightProps) {
    const seatCpt = document.getElementById('seat-cpt');
    const seatFo = document.getElementById('seat-fo');
    const statusCpt = document.getElementById('status-cpt-text');
    const statusFo = document.getElementById('status-fo-text');
    const narrative = document.getElementById('seat-narrative-text');
    
    // Overlays
    const parkingOverlay = document.getElementById('icon-parking-overlay');
    const coffeeOverlay = document.getElementById('icon-coffee-overlay');
    const cloudOverlay = document.getElementById('icon-cloud-overlay');

    if (!seatCpt || !seatFo) return;

    // 1. DETERMINE STATE
    // Default to 0 (Active) if undefined
    let state = flightProps.pilotState !== undefined ? flightProps.pilotState : 0;

    // 2. RESET VISUALS
    // Remove all active color classes
    seatCpt.classList.remove('active-green', 'active-amber', 'active-blue');
    seatFo.classList.remove('active-green', 'active-amber', 'active-blue');
    
    // Reset pills
    statusCpt.className = 'status-pill';
    statusFo.className = 'status-pill';
    
    // Hide all overlays
    if(parkingOverlay) parkingOverlay.classList.remove('visible');
    if(coffeeOverlay) coffeeOverlay.classList.remove('visible');
    if(cloudOverlay) cloudOverlay.classList.remove('visible');

    // Reset Narrative Display
    if(narrative) narrative.style.display = 'block';

    // 3. APPLY LOGIC
    switch (state) {
        case 0: // ACTIVE
            seatCpt.classList.add('active-green');
            
            statusCpt.classList.add('green');
            statusCpt.textContent = 'CMD: PILOT';
            
            statusFo.textContent = 'FO: MONITOR';
            
            narrative.textContent = "Manual inputs detected. Pilot has controls.";
            break;

        case 1: // AWAY (IN FLIGHT) - Monitoring
            seatCpt.classList.add('active-amber');
            
            statusCpt.classList.add('amber');
            statusCpt.textContent = 'CMD: AUTO';
            
            statusFo.textContent = 'FO: MONITOR';
            
            if(coffeeOverlay) coffeeOverlay.classList.add('visible');
            narrative.textContent = "No recent inputs. Pilot is monitoring cruise systems.";
            break;

        case 2: // AWAY (PARKED) - Secured
            // Seats remain dark/grey (no active class)
            
            statusCpt.classList.add('red'); // Use red border/text for park brake
            statusCpt.textContent = 'PARK BRK: SET';
            statusCpt.style.width = '100%'; // Span full width
            statusCpt.style.textAlign = 'center';
            
            statusFo.style.display = 'none'; // Hide FO pill in this specific state
            
            if(parkingOverlay) parkingOverlay.classList.add('visible');
            narrative.textContent = "Cockpit secured. Parking brake set.";
            break;

        case 3: // BACKGROUND - Relief Pilot / Rest
            seatFo.classList.add('active-blue');
            
            statusCpt.textContent = 'CMD: REST';
            
            statusFo.classList.add('blue');
            statusFo.textContent = 'FO: ACTIVE';
            
            if(cloudOverlay) cloudOverlay.classList.add('visible');
            
            // [MODIFIED] Removed the "Relief Pilot" text and hid the element to push content up
            if(narrative) {
                narrative.textContent = ""; 
                narrative.style.display = 'none';
            }
            break;

        default:
            narrative.textContent = "No telemetry data available.";
            break;
    }

    // Restore FO display if not in state 2
    if (state !== 2) {
        statusFo.style.display = 'block';
        statusCpt.style.width = 'auto';
        statusCpt.style.textAlign = 'left';
    }
}

/**
 * --- [REHAULED v2.1] Renders the Pilot Report with collapsible sections and a case-sensitive profile link.
 * --- [MODIFIED v2.2] Removed back button for new tabbed layout
 */
function renderPilotStatsHTML(stats, username) {
    if (!stats) return '<p class="error-text">Could not load pilot statistics.</p>';

    // --- Data Extraction & Helpers ---
    const getRuleValue = (rules, ruleName) => {
        if (!Array.isArray(rules)) return null;
        const rule = rules.find(r => r.definition?.name === ruleName);
        return rule ? rule.referenceValue : null;
    };
    const formatViolationDate = (dateString) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    };

    const currentGradeIndex = stats.gradeDetails?.gradeIndex;
    const currentGrade = stats.gradeDetails?.grades?.[currentGradeIndex];
    const nextGrade = stats.gradeDetails?.grades?.[currentGradeIndex + 1];

    const atcRankId = stats.atcRank;
    const atcRankMap = { 0: 'Observer', 1: 'Trainee', 2: 'Apprentice', 3: 'Specialist', 4: 'Officer', 5: 'Supervisor', 6: 'Recruiter', 7: 'Manager' };
    const atcRankName = atcRankId in atcRankMap ? atcRankMap[atcRankId] : 'N/A';
    
    // --- Key Performance Indicators (KPIs) ---
    const kpis = {
        grade: currentGrade?.name.replace('Grade ', '') || 'N/A',
        xp: (stats.totalXP || 0).toLocaleString(),
        atcRank: atcRankName,
        totalViolations: (stats.violationCountByLevel?.level1 || 0) + (stats.violationCountByLevel?.level2 || 0) + (stats.violationCountByLevel?.level3 || 0)
    };
    
    // --- Detailed Stats ---
    const details = {
        lvl1Vios: stats.violationCountByLevel?.level1 || 0,
        lvl2Vios: stats.violationCountByLevel?.level2 || 0,
        lvl3Vios: stats.violationCountByLevel?.level3 || 0,
        lastViolation: formatViolationDate(stats.lastLevel1ViolationDate),
        flightTime90d: getRuleValue(currentGrade?.rules, 'Flight Time (90 days)'),
        landings90d: getRuleValue(currentGrade?.rules, 'Landings (90 days)')
    };

    // --- Progression Card Generator ---
    const createProgressCard = (title, gradeData) => {
        if (!gradeData) {
            return `<div class="progress-card complete"><h4><i class="fa-solid fa-crown"></i> Max Grade Achieved</h4><p>Congratulations, you have reached the highest available grade!</p></div>`;
        }
        const reqXp = getRuleValue(gradeData.rules, 'XP');
        const reqVios = getRuleValue(gradeData.rules, 'All Level 2/3 Violations (1 year)');
        const xpProgress = reqXp > 0 ? Math.min(100, (stats.totalXP / reqXp) * 100) : 100;
        const viosMet = stats.total12MonthsViolations <= reqVios;
        return `<div class="progress-card"><h4>${title}</h4><div class="progress-item"><div class="progress-label"><span><i class="fa-solid fa-star"></i> XP</span><span>${stats.totalXP.toLocaleString()} / ${reqXp.toLocaleString()}</span></div><div class="progress-bar-bg"><div class="progress-bar-fg" style="width: ${xpProgress.toFixed(1)}%;"></div></div></div><div class="progress-item"><div class="progress-label"><span><i class="fa-solid fa-shield-halved"></i> 1-Year Violations</span><span class="${viosMet ? 'req-met' : 'req-not-met'}">${stats.total12MonthsViolations} / ${reqVios} max<i class="fa-solid ${viosMet ? 'fa-check-circle' : 'fa-times-circle'}"></i></span></div></div></div>`;
    };
    
    // --- Final HTML Assembly with Accordion ---
    return `
        <div class="stats-rehaul-container">
            <div class="stats-header">
                <h4>${username}</h4>
                <a href="https://community.infiniteflight.com/u/${username}/summary" target="_blank" rel="noopener noreferrer" class="community-profile-link" title="View Community Profile">
                    <i class="fa-solid fa-external-link-alt"></i> View Profile
                </a>
            </div>

            <div class="kpi-grid">
                <div class="kpi-card"><div class="kpi-label"><i class="fa-solid fa-user-shield"></i> Grade</div><div class="kpi-value">${kpis.grade}</div></div>
                <div class="kpi-card"><div class="kpi-label"><i class="fa-solid fa-star"></i> Total XP</div><div class="kpi-value">${kpis.xp}</div></div>
                <div class="kpi-card"><div class="kpi-label"><i class="fa-solid fa-headset"></i> ATC Rank</div><div class="kpi-value">${kpis.atcRank}</div></div>
                <div class="kpi-card"><div class="kpi-label"><i class="fa-solid fa-triangle-exclamation"></i> Total Violations</div><div class="kpi-value">${kpis.totalViolations}</div></div>
            </div>

            <div class="stats-accordion">
                <div class="accordion-item">
                    <button class="accordion-header">
                        <span><i class="fa-solid fa-chart-line"></i> Grade Progression</span>
                        <i class="fa-solid fa-chevron-down toggle-icon"></i>
                    </button>
                    <div class="accordion-content">
                        <div class="progression-container">
                            ${createProgressCard(`Current: Grade ${kpis.grade}`, currentGrade)}
                            ${createProgressCard(`Next: Grade ${nextGrade?.name.replace('Grade ', '') || ''}`, nextGrade)}
                        </div>
                    </div>
                </div>

                <div class="accordion-item">
                    <button class="accordion-header">
                        <span><i class="fa-solid fa-list-check"></i> Detailed Statistics</span>
                        <i class="fa-solid fa-chevron-down toggle-icon"></i>
                    </button>
                    <div class="accordion-content">
                        <div class="details-grid">
                             <div class="detail-item"><span class="detail-label">Level 1 Violations</span><span class="detail-value">${details.lvl1Vios}</span></div>
                            <div class="detail-item"><span class="detail-label">Level 2 Violations</span><span class="detail-value">${details.lvl2Vios}</span></div>
                            <div class="detail-item"><span class="detail-label">Level 3 Violations</span><span class="detail-value">${details.lvl3Vios}</span></div>
                             <div class="detail-item"><span class="detail-label">Last Violation Date</span><span class="detail-value">${details.lastViolation}</span></div>
                            <div class="detail-item"><span class="detail-label">Flight Time (90 days)</span><span class="detail-value">${details.flightTime90d ? details.flightTime90d.toFixed(1) + ' hrs' : 'N/A'}</span></div>
                            <div class="detail-item"><span class="detail-label">Landings (90 days)</span><span class="detail-value">${details.landings90d || 'N/A'}</span></div>
                        </div>
                    </div>
                </div>
            </div>
            
            </div>
    `;
}

// --- [NEW & FIXED] Fetches and displays the pilot stats, and attaches its own event listeners ---
    async function displayPilotStats(userId, username) {
        if (!userId) return;

        // Get the containers
        // const statsPane = document.getElementById('ac-tab-pilot-report'); // No longer needed
        // const flightPane = document.getElementById('ac-tab-flight-data'); // No longer needed
        const statsDisplay = document.getElementById('pilot-stats-display');
        
        if (!statsDisplay) return;

        // Show loading spinner in stats panel
        statsDisplay.innerHTML = `<div class="spinner-small" style="margin: 2rem auto;"></div><p style="text-align: center;">Loading pilot report for ${username}...</p>`;
        
        // --- [REMOVED] Toggle visibility ---
        // flightPane.classList.remove('active');
        // statsPane.classList.add('active');

        try {
            const res = await fetch(`${ACARS_USER_API_URL}/${userId}/grade`);
            if (!res.ok) throw new Error('Could not fetch pilot data.');
            
            const data = await res.json();
            if (data.ok && data.gradeInfo) {
                statsDisplay.innerHTML = renderPilotStatsHTML(data.gradeInfo, username);
                
                // --- Accordion event listeners ---
                const accordionHeaders = statsDisplay.querySelectorAll('.accordion-header');
                accordionHeaders.forEach(header => {
                    header.addEventListener('click', () => {
                        const item = header.closest('.accordion-item');
                        const content = header.nextElementSibling;
                        const isExpanded = item.classList.contains('active');
                        
                        item.classList.toggle('active');

                        if (isExpanded) {
                            content.style.maxHeight = null;
                        } else {
                            content.style.maxHeight = content.scrollHeight + 'px';
                        }
                    });
                });

                // The main delegate in setupAircraftWindowEvents will catch the back button click
                
            } else {
                throw new Error('Pilot data not found or invalid.');
            }
        } catch (error) {
            console.error('Error fetching pilot stats:', error);
            // [MODIFIED] Removed back button from error message
            statsDisplay.innerHTML = `<div class="stats-rehaul-container">
                <p class="error-text">${error.message}</p>
            </div>`;
        }
    }



function updateAircraftInfoWindow(baseProps, plan, sortedRoutePoints) {
    // --- Helper function to update all elements matching a selector ---
    const updateAll = (selector, value, isHTML = false) => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
            if (isHTML) {
                el.innerHTML = value;
            } else {
                el.textContent = value;
            }
        });
    };
    
    // --- Helper for styling ---
    const styleAll = (selector, property, value) => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
            el.style[property] = value;
        });
    };

    // --- Get Original Data ---
    const originalFlatWaypoints = (plan && plan.flightPlanItems) ? flattenWaypointsFromPlan(plan.flightPlanItems) : [];
    const originalFlatWaypointObjects = (plan && plan.flightPlanItems) ? getFlatWaypointObjects(plan.flightPlanItems) : [];
    const hasPlan = originalFlatWaypoints.length >= 2;

    let progress = 0, ete = '--:--', distanceToDestNM = 0;
    let totalDistanceNM = 0;

    if (hasPlan) {
        // ... (calculation logic for progress, ete, etc. is unchanged) ...
        let totalDistanceKm = 0;
        for (let i = 0; i < originalFlatWaypoints.length - 1; i++) {
            const [lon1, lat1] = originalFlatWaypoints[i];
            const [lon2, lat2] = originalFlatWaypoints[i + 1];
            totalDistanceKm += getDistanceKm(lat1, lon1, lat2, lon2);
        }
        totalDistanceNM = totalDistanceKm / 1.852;

        if (totalDistanceNM > 0) {
            const [destLon, destLat] = originalFlatWaypoints[originalFlatWaypoints.length - 1];
            const remainingDistanceKm = getDistanceKm(baseProps.position.lat, baseProps.position.lon, destLat, destLon);
            
            distanceToDestNM = remainingDistanceKm / 1.852;
            progress = Math.max(0, Math.min(100, (1 - (distanceToDestNM / totalDistanceNM)) * 100));

            if (baseProps.position.gs_kt > 50) {
                const timeHours = distanceToDestNM / baseProps.position.gs_kt;
                const hours = Math.floor(timeHours);
                const minutes = Math.round((timeHours - hours) * 60);
                ete = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
            }
        }
    }

    // --- Pre-calculate cumulative NM ---
    if (hasPlan) {
        let cumulativeDistNM = 0;
        let lastLat = originalFlatWaypointObjects[0].location.latitude;
        let lastLon = originalFlatWaypointObjects[0].location.longitude;

        for (let i = 0; i < originalFlatWaypointObjects.length; i++) {
            const wp = originalFlatWaypointObjects[i];
            if (!wp.location) continue; 
            const wpLat = wp.location.latitude;
            const wpLon = wp.location.longitude;
            
            const segmentDistNM = (i === 0) ? 0 : getDistanceKm(lastLat, lastLon, wpLat, wpLon) / 1.852;
            cumulativeDistNM += segmentDistNM;
            
            wp.cumulativeNM = cumulativeDistNM;
            
            lastLat = wpLat;
            lastLon = wpLon;
        }
        totalDistanceNM = cumulativeDistNM;
    }

    // --- Flight Plan Data Extraction ---
    let nextWpName = '---';
    let nextWpDistNM = '---';
    let bestWpIndex = -1;
    let minScore = Infinity;
    if (plan) { 
        // ... (logic for finding next waypoint is unchanged) ...
        const currentPos = baseProps.position;
        const currentTrack = currentPos.heading_deg;
        
        if (originalFlatWaypointObjects.length > 1 && currentPos && typeof currentTrack === 'number') {
            for (let i = 1; i < originalFlatWaypointObjects.length; i++) { 
                const wp = originalFlatWaypointObjects[i];
                if (!wp.location || wp.location.latitude == null || wp.location.longitude == null) {
                    continue; 
                }
                const distanceToWpKm = getDistanceKm(currentPos.lat, currentPos.lon, wp.location.latitude, wp.location.longitude);
                const bearingToWp = getBearing(currentPos.lat, currentPos.lon, wp.location.latitude, wp.location.longitude);
                const bearingDiff = Math.abs(normalizeBearingDiff(currentTrack - bearingToWp));
                if (bearingDiff <= 95) { 
                    if (distanceToWpKm < minScore) {
                        minScore = distanceToWpKm;
                        bestWpIndex = i;
                    }
                }
            }
        }
        if (bestWpIndex !== -1) {
            const nextWp = originalFlatWaypointObjects[bestWpIndex]; 
            if (nextWp) {
                nextWpName = nextWp.identifier || nextWp.name || 'N/A';
                nextWpDistNM = (minScore / 1.852).toFixed(0);
            }
        } else if (hasPlan && distanceToDestNM < 10 && distanceToDestNM > 0.5) {
            nextWpName = originalFlatWaypointObjects.length > 0 ? (originalFlatWaypointObjects[originalFlatWaypoints.length - 1].identifier || originalFlatWaypointObjects[originalFlatWaypoints.length - 1].name) : "DEST";
            nextWpDistNM = distanceToDestNM.toFixed(0);
        } else if (hasPlan && distanceToDestNM <= 0.5) {
             nextWpName = "DEST";
             nextWpDistNM = "0";
        }
    }
    
    // --- Calculate accurate progress along the planned route ---
    let progressAlongRouteNM = 0;
    if (hasPlan && bestWpIndex > 0) {
        // ... (progressAlongRouteNM logic is unchanged) ...
        const prevWp = originalFlatWaypointObjects[bestWpIndex - 1];
        const nextWp = originalFlatWaypointObjects[bestWpIndex];
        
        if (prevWp && nextWp && prevWp.cumulativeNM != null && nextWp.cumulativeNM != null) {
            const segmentTotalNM = nextWp.cumulativeNM - prevWp.cumulativeNM;
            const distToNextNM = minScore / 1.852;
            
            if (segmentTotalNM > 0) {
                const segmentProgressNM = Math.max(0, segmentTotalNM - distToNextNM);
                progressAlongRouteNM = prevWp.cumulativeNM + segmentProgressNM;
            } else {
                progressAlongRouteNM = prevWp.cumulativeNM;
            }
        } else {
             progressAlongRouteNM = Math.max(0.01, totalDistanceNM - distanceToDestNM);
        }
    } else if (hasPlan && (bestWpIndex === 0 || bestWpIndex === -1) && distanceToDestNM >= 1.0) { 
        progressAlongRouteNM = Math.max(0.01, totalDistanceNM - distanceToDestNM);
    } else if (hasPlan && distanceToDestNM < 1.0) { 
        progressAlongRouteNM = totalDistanceNM;
    }


    // --- Update New Data Bar ---
    const nextWpDisplay = nextWpName;
    const nextWpDistDisplay = (nextWpDistNM === '---' || isNaN(parseFloat(nextWpDistNM))) ? '--.-' : Number(nextWpDistNM).toFixed(1);

    updateAll('#ac-next-wp', nextWpDisplay);
    updateAll('#ac-next-wp-dist', `${nextWpDistDisplay}<span class="unit">NM</span>`, true);
    updateAll('#ac-dist', `${Math.round(distanceToDestNM)}<span class="unit">NM</span>`, true);
    updateAll('#ac-ete', ete);

    // --- Flight Phase State Machine (Unchanged) ---
    let flightPhase = 'ENROUTE';
    let phaseClass = 'phase-enroute';
    let phaseIcon = 'fa-route';
    const vs = baseProps.position.vs_fpm || 0;
    const altitude = baseProps.position.alt_ft || 0;
    const gs = baseProps.position.gs_kt || 0;
    let departureIcao = null;
    let arrivalIcao = null;
    if (plan && Array.isArray(plan.flightPlanItems) && plan.flightPlanItems.length >= 2) {
        departureIcao = plan.flightPlanItems[0]?.identifier?.trim().toUpperCase();
        arrivalIcao = plan.flightPlanItems[plan.flightPlanItems.length - 1]?.identifier?.trim().toUpperCase();
    }
    const aircraftPos = { lat: baseProps.position.lat, lon: baseProps.position.lon, heading_deg: baseProps.position.heading_deg };
    let nearestRunwayInfo = null;
    if (hasPlan) {
        const distanceFlownKm = totalDistanceNM * 1.852 - distanceToDestNM * 1.852;
        if (distanceToDestNM * 1.852 < distanceFlownKm && arrivalIcao) {
             nearestRunwayInfo = getNearestRunway(aircraftPos, arrivalIcao, 1.5);
        } else if (departureIcao) {
             nearestRunwayInfo = getNearestRunway(aircraftPos, departureIcao, 1.5);
        }
    }
    let altitudeAGL = null;
    if (nearestRunwayInfo && nearestRunwayInfo.elevation_ft != null) {
        altitudeAGL = altitude - nearestRunwayInfo.elevation_ft;
    } else {
        const originElevationFt = (plan?.origin?.elevation_ft) ? parseFloat(plan.origin.elevation_ft) : null;
        const destElevationFt = (plan?.destination?.elevation_ft) ? parseFloat(plan.destination.elevation_ft) : null;
        const relevantElevationFt = (totalDistanceNM > 0 && distanceToDestNM < totalDistanceNM / 2) ? destElevationFt : originElevationFt;
        if (relevantElevationFt !== null) {
            altitudeAGL = altitude - relevantElevationFt;
        }
    }
    const aglCheck = altitudeAGL !== null && altitudeAGL < 75;
    const fallbackGroundCheck = altitudeAGL === null && gs < 35 && Math.abs(vs) < 150;
    const isOnGround = aglCheck || fallbackGroundCheck;
    const isLinedUpForLanding = nearestRunwayInfo && nearestRunwayInfo.airport === arrivalIcao && nearestRunwayInfo.headingDiff < 10;
    if (isOnGround) {
        if (gs > 35) {
            if (progress > 90) { flightPhase = 'LANDING ROLLOUT'; phaseClass = 'phase-approach'; phaseIcon = 'fa-plane-arrival';
            } else if (progress < 10) { flightPhase = 'TAKEOFF ROLL'; phaseClass = 'phase-climb'; phaseIcon = 'fa-plane-departure';
            } else { flightPhase = 'HIGH-SPEED TAXI'; phaseIcon = 'fa-road'; phaseClass = 'phase-enroute'; }
        } else {
            const isStopped = gs <= 2.0;
            const isAtTerminal = (progress < 2) || (progress > 98);
            const relevantIcao = progress < 50 ? departureIcao : arrivalIcao;
            const closeRunwayInfo = getNearestRunway(aircraftPos, relevantIcao, 0.15);
            const isLinedUp = closeRunwayInfo && closeRunwayInfo.headingDiff < 10;
            if (isLinedUp) { flightPhase = `LINED UP RWY ${closeRunwayInfo.ident}`; phaseIcon = 'fa-arrow-up'; phaseClass = 'phase-climb';
            } else if (isStopped) {
                if (closeRunwayInfo) { flightPhase = `HOLDING SHORT RWY ${closeRunwayInfo.ident}`; phaseIcon = 'fa-pause-circle'; phaseClass = 'phase-enroute';
                } else if (isAtTerminal) { flightPhase = 'PARKED'; phaseIcon = 'fa-parking'; phaseClass = 'phase-enroute';
                } else { flightPhase = 'HOLDING POSITION'; phaseIcon = 'fa-hand'; phaseClass = 'phase-enroute'; }
            } else {
                flightPhase = 'TAXIING'; phaseIcon = 'fa-road'; phaseClass = 'phase-enroute';
                if (progress > 50) { flightPhase = 'TAXIING TO GATE';
                } else if (progress < 10) { flightPhase = 'TAXIING TO RUNWAY'; }
            }
        }
    } else {
        const isInLandingSequence = isLinedUpForLanding && altitudeAGL !== null;
        if (isInLandingSequence && altitudeAGL < 2500) {
            if (altitudeAGL < 60 && vs < -50) { flightPhase = 'FLARE';
            } else if (altitudeAGL < 500) { flightPhase = 'SHORT FINAL';
            } else { flightPhase = 'FINAL APPROACH'; }
            phaseClass = 'phase-approach'; phaseIcon = 'fa-plane-arrival';
        } else if (hasPlan && distanceToDestNM < 40 && progress > 5) {
            flightPhase = 'APPROACH'; phaseClass = 'phase-approach'; phaseIcon = 'fa-plane-arrival';
        } else if (vs > 300) {
            flightPhase = 'CLIMB'; phaseClass = 'phase-climb'; phaseIcon = 'fa-arrow-trend-up';
            if (progress < 10 && altitudeAGL !== null && altitudeAGL < 1500) {
                 flightPhase = 'LIFTOFF'; phaseIcon = 'fa-plane-up';
            }
        } else if (vs < -500) {
            flightPhase = 'DESCENT'; phaseClass = 'phase-descent'; phaseIcon = 'fa-arrow-trend-down';
        } else if (altitude > 18000 && Math.abs(vs) < 500) {
            flightPhase = 'CRUISE'; phaseClass = 'phase-cruise'; phaseIcon = 'fa-minus';
        }
    }


    // --- VSD LOGIC (Fixed Height) ---
    const vsdPanels = document.querySelectorAll('#vsd-panel');
    const planId = (plan && (plan.flightPlanId || plan.id)) || 'unknown';

    vsdPanels.forEach(vsdPanel => {
        if (!hasPlan) return;
        
        // Find elements *relative* to this specific vsdPanel
        const vsdAircraftIcon = vsdPanel.querySelector('#vsd-aircraft-icon');
        const vsdGraphWindow = vsdPanel.querySelector('#vsd-graph-window');
        const vsdGraphContent = vsdPanel.querySelector('#vsd-graph-content');
        const vsdProfilePath = vsdPanel.querySelector('#vsd-profile-path');
        const vsdFlownPath = vsdPanel.querySelector('#vsd-flown-path');
        const vsdWpLabels = vsdPanel.querySelector('#vsd-waypoint-labels');

        if (!vsdGraphContent || !vsdAircraftIcon) return;

        // --- 1. Define VSD scales ---
        const VSD_HEIGHT_PX = vsdGraphContent.clientHeight || 210; 
        const MAX_ALT_FT = 45000;
        const Y_SCALE_PX_PER_FT = VSD_HEIGHT_PX / MAX_ALT_FT;
        const FIXED_X_SCALE_PX_PER_NM = 4;
        
        // --- 2. Build the Profile (Only once) ---
        if (vsdPanel.dataset.profileBuilt !== 'true' || vsdPanel.dataset.planId !== planId) {
            let flatWaypointObjects = JSON.parse(JSON.stringify(originalFlatWaypointObjects));
            if (flatWaypointObjects.length > 0) {
                const lastIdx = flatWaypointObjects.length - 1;
                if (flatWaypointObjects[0].altitude == null) {
                    flatWaypointObjects[0].altitude = plan?.origin?.elevation_ft || 0;
                }
                if (flatWaypointObjects[lastIdx].altitude == null) {
                    const prevAlt = (lastIdx > 0) ? flatWaypointObjects[lastIdx - 1]?.altitude : null;
                    flatWaypointObjects[lastIdx].altitude = (prevAlt != null) ? prevAlt : (plan?.destination?.elevation_ft || 0);
                }
                for (let i = 1; i < lastIdx; i++) {
                    const wp = flatWaypointObjects[i];
                    if (wp.altitude == null || (typeof wp.altitude === 'number' && wp.altitude <= 0)) {
                        wp.altitude = null;
                    }
                }
                let lastValidAltIndex = 0; 
                for (let i = 1; i < flatWaypointObjects.length; i++) {
                    const wp = flatWaypointObjects[i];
                    if (wp.altitude != null && typeof wp.altitude === 'number') {
                        if (i > lastValidAltIndex + 1) {
                            const gapStartIndex = lastValidAltIndex;
                            const gapEndIndex = i;
                            const startAlt = flatWaypointObjects[gapStartIndex].altitude;
                            const endAlt = flatWaypointObjects[gapEndIndex].altitude;
                            const numStepsInGap = gapEndIndex - gapStartIndex;

                            for (let j = 1; j < numStepsInGap; j++) {
                                const stepIndex = gapStartIndex + j;
                                const fraction = j / numStepsInGap;
                                const interpolatedAlt = startAlt + (endAlt - startAlt) * fraction;
                                flatWaypointObjects[stepIndex].altitude = Math.round(interpolatedAlt);
                            }
                        }
                        lastValidAltIndex = i;
                    }
                }
            }

            if (vsdGraphWindow && !vsdGraphWindow.querySelector('#vsd-y-axis')) {
                let yAxisHtml = '<div id="vsd-y-axis">';
                const altLabels = [10000, 20000, 30000, 40000];
                for (const alt of altLabels) {
                    const yPos = VSD_HEIGHT_PX - (alt * Y_SCALE_PX_PER_FT);
                    yAxisHtml += `<div class="y-axis-label" style="top: ${yPos}px;">${alt / 1000}K</div>`;
                }
                yAxisHtml += '</div>';
                vsdGraphWindow.insertAdjacentHTML('afterbegin', yAxisHtml);
            }
            
            let path_d = "";
            let labels_html = "";
            let current_x_px = 0;
            let last_label_x_px = -1000;
            let stagger_level = 0;
            const MIN_LABEL_SPACING_PX = 80;
            
            if (flatWaypointObjects.length === 0) return;

            for (let i = 0; i < flatWaypointObjects.length; i++) {
                const wp = flatWaypointObjects[i];
                const wpAltFt = wp.altitude; 
                const wpAltPx = VSD_HEIGHT_PX - (wpAltFt * Y_SCALE_PX_PER_FT);
                current_x_px = wp.cumulativeNM * FIXED_X_SCALE_PX_PER_NM;

                if (i === 0) {
                    path_d = `M ${current_x_px} ${wpAltPx}`;
                } else {
                    path_d += ` L ${current_x_px} ${wpAltPx}`;
                }

                let label_top_px;
                let label_class = '';
                if (current_x_px - last_label_x_px < MIN_LABEL_SPACING_PX) {
                    stagger_level = 1 - stagger_level;
                } else {
                    stagger_level = 0;
                }
                if (stagger_level === 1) {
                    label_class = 'low-label';
                    label_top_px = wpAltPx + 12;
                } else {
                    label_class = 'high-label';
                    label_top_px = wpAltPx - 42;
                }
                last_label_x_px = current_x_px;

                labels_html += `
                    <div class="vsd-wp-label ${label_class}" style="left: ${current_x_px}px; top: ${label_top_px}px;">
                        <span class="wp-name">${wp.identifier}</span>
                        <span class="wp-alt">${Math.round(wpAltFt)}ft</span>
                    </div>`;
            }
            
            vsdGraphContent.style.width = `${current_x_px + 100}px`;
            vsdProfilePath.closest('svg').style.width = `${current_x_px + 100}px`;
            vsdProfilePath.setAttribute('d', path_d);
            vsdWpLabels.innerHTML = labels_html;
            vsdPanel.dataset.profileBuilt = 'true';
            vsdPanel.dataset.planId = planId;
        }
        
        // --- 3. Build/Update Flown Altitude Path ---
        if (vsdFlownPath && hasPlan && originalFlatWaypointObjects.length > 0) {
            let flown_path_d = "";
            let lastFlownLat, lastFlownLon;
            let currentFlightRoutePoints = [...sortedRoutePoints]; 
            const originLat = plan?.origin?.latitude;
            const originLon = plan?.origin?.longitude;
            if (originLat != null && originLon != null && sortedRoutePoints.length > 10) {
                let startIndex = -1;
                for (let i = sortedRoutePoints.length - 1; i > 0; i--) {
                    const point = sortedRoutePoints[i];
                    if (!point.latitude || !point.longitude || point.altitude == null) continue;
                    const distKm = getDistanceKm(point.latitude, point.longitude, originLat, originLon);
                    if (point.altitude < 1000 && distKm < 25) {
                        startIndex = i;
                        break;
                    }
                }
                if (startIndex !== -1) {
                    currentFlightRoutePoints = sortedRoutePoints.slice(startIndex);
                }
            }
            const fullFlownRoute = [];
            if (currentFlightRoutePoints && currentFlightRoutePoints.length > 0) {
                fullFlownRoute.push(...currentFlightRoutePoints); 
                lastFlownLat = currentFlightRoutePoints[0].latitude;
                lastFlownLon = currentFlightRoutePoints[0].longitude;
            }
            fullFlownRoute.push({
                latitude: baseProps.position.lat,
                longitude: baseProps.position.lon,
                altitude: baseProps.position.alt_ft,
                groundSpeed: baseProps.position.gs_kt
            });
            const flownPathPoints = [];
            let totalActualFlownNM = 0;
            if (fullFlownRoute.length > 0) {
                if (!lastFlownLat) {
                    lastFlownLat = fullFlownRoute[0].latitude;
                    lastFlownLon = fullFlownRoute[0].longitude;
                }
                const startAltFt = originalFlatWaypointObjects[0]?.altitude || fullFlownRoute[0].altitude;
                const startAltPx = VSD_HEIGHT_PX - (startAltFt * Y_SCALE_PX_PER_FT);
                for (let i = 0; i < fullFlownRoute.length; i++) {
                    const point = fullFlownRoute[i];
                    const wpAltFt = typeof point.altitude === 'number' ? point.altitude : 0;
                    const wpAltPx = VSD_HEIGHT_PX - (wpAltFt * Y_SCALE_PX_PER_FT);
                    const wpLat = point.latitude;
                    const wpLon = point.longitude;
                    let segmentDistNM = 0;
                    if (i > 0) { 
                        segmentDistNM = getDistanceKm(lastFlownLat, lastFlownLon, wpLat, wpLon) / 1.852;
                    }
                    totalActualFlownNM += segmentDistNM;
                    
                    flownPathPoints.push({ 
                        x_nm: totalActualFlownNM, 
                        y_px_alt: wpAltPx
                    });

                    lastFlownLat = wpLat;
                    lastFlownLon = wpLon;
                }
                const plannedProgressNM = progressAlongRouteNM;
                const scaleFactor = (totalActualFlownNM > 0.1 && plannedProgressNM > 0.01) ? (plannedProgressNM / totalActualFlownNM) : 1;
                
                for (let i = 0; i < flownPathPoints.length; i++) {
                    const point = flownPathPoints[i];
                    const scaled_x_px = point.x_nm * scaleFactor * FIXED_X_SCALE_PX_PER_NM; 
                    
                    if (i === 0) {
                        flown_path_d = `M 0 ${startAltPx}`;
                        if (flownPathPoints.length === 1) {
                            flown_path_d += ` L ${scaled_x_px} ${point.y_px_alt}`;
                        }
                    } else {
                        flown_path_d += ` L ${scaled_x_px} ${point.y_px_alt}`;
                    }
                }
                
                vsdFlownPath.setAttribute('d', flown_path_d);
            }
        }

        const currentAltPx = VSD_HEIGHT_PX - (altitude * Y_SCALE_PX_PER_FT);
        vsdAircraftIcon.style.top = `${currentAltPx}px`;

        if (vsdGraphWindow && vsdGraphWindow.clientWidth > 0) {
            const distanceFlownNM = progressAlongRouteNM; 
            const scrollOffsetPx = (distanceFlownNM * FIXED_X_SCALE_PX_PER_NM);
            const vsdViewportWidth = vsdGraphWindow.clientWidth;
            const totalProfileWidthPx = vsdGraphContent.scrollWidth;
            const centerOffset = (vsdViewportWidth / 2) + 35;
            const desiredTranslateX = centerOffset - scrollOffsetPx;
            const maxTranslateX = 0;
            const minTranslateX = Math.min(0, vsdViewportWidth - totalProfileWidthPx);
            const finalTranslateX = Math.max(minTranslateX, Math.min(maxTranslateX, desiredTranslateX));
            vsdGraphContent.style.transform = `translateX(${finalTranslateX - 35}px)`;
            const iconLeftPx = scrollOffsetPx + finalTranslateX;
            vsdAircraftIcon.style.left = `${iconLeftPx}px`;
        } else {
            const distanceFlownNM = progressAlongRouteNM;
            const scrollOffsetPx = (distanceFlownNM * FIXED_X_SCALE_PX_PER_NM);
            const translateX = 75 - scrollOffsetPx; 
            vsdGraphContent.style.transform = `translateX(${translateX - 35}px)`;
            vsdAircraftIcon.style.left = `75px`;
        }
        
        const vsdSummaryVS = vsdPanel.closest('.ac-tab-pane').querySelector('#ac-vs');
        if (vsdSummaryVS) {
            vsdSummaryVS.innerHTML = `<i class="fa-solid ${vs > 100 ? 'fa-arrow-up' : vs < -100 ? 'fa-arrow-down' : 'fa-minus'}"></i> ${Math.round(vs)}<span class="unit">fpm</span>`;
        }
    });

    // --- Update Other DOM Elements ---
    styleAll('#ac-progress-bar', 'width', `${progress.toFixed(1)}%`);
    updateAll('#ac-phase-indicator', `<i class="fa-solid ${phaseIcon}"></i> ${flightPhase}`, true);
    
    const phaseIndicators = document.querySelectorAll('#ac-phase-indicator');
    phaseIndicators.forEach(el => {
        el.className = `flight-phase-indicator ${phaseClass}`;
    });

    const atdTimestamp = (sortedRoutePoints && sortedRoutePoints.length > 0) ? sortedRoutePoints[0].date : null;
    const atdTime = atdTimestamp ? formatTimeFromTimestamp(atdTimestamp) : '--:--';
    let etaTime = '--:--';
    if (baseProps.position.gs_kt > 50 && totalDistanceNM > 0) {
        const eteHours = distanceToDestNM / baseProps.position.gs_kt;
        if (eteHours > 0 && eteHours < 48) { 
            const eteMs = eteHours * 3600 * 1000;
            const etaTimestamp = new Date(Date.now() + eteMs);
            etaTime = formatTimeFromTimestamp(etaTimestamp);
        }
    }
    const depCountryCode = airportsData[departureIcao]?.country ? airportsData[departureIcao].country.toLowerCase() : '';
    const arrCountryCode = airportsData[arrivalIcao]?.country ? airportsData[arrivalIcao].country.toLowerCase() : '';
    const depFlagSrc = depCountryCode ? `https://flagcdn.com/w20/${depCountryCode}.png` : '';
    const arrFlagSrc = arrCountryCode ? `https://flagcdn.com/w20/${arrCountryCode}.png` : '';

    updateAll('#ac-bar-atd', `${atdTime} Z`);
    updateAll('#ac-bar-eta', `${etaTime} Z`);
    
    document.querySelectorAll('#ac-bar-dep-flag').forEach(el => {
        el.src = depFlagSrc; 
        el.alt = depCountryCode; 
        el.style.display = depCountryCode ? 'block' : 'none'; 
    });
    document.querySelectorAll('#ac-bar-arr-flag').forEach(el => {
        el.src = arrFlagSrc; 
        el.alt = arrCountryCode; 
        el.style.display = arrCountryCode ? 'block' : 'none'; 
    });


    // --- CALL THE FMS UPDATE ---
    updateFmsLegsModule(plan, baseProps.position);

    // --- Update Cockpit Seat Sensor ---
    updateSeatSensor(baseProps);

    // --- UPDATE FLIGHT RULES ---
    const rulesDisplay = document.getElementById('flight-rules-display');
    if (rulesDisplay) {
        if (typeof determineFlightRules === 'function') {
            const rule = determineFlightRules(baseProps, plan);
            rulesDisplay.className = `flight-rules-badge ${rule.class}`;
            rulesDisplay.innerHTML = `<i class="fa-solid ${rule.icon}"></i> ${rule.label}`;
        } else {
            console.warn("determineFlightRules helper missing.");
            rulesDisplay.textContent = "RULES UNKNOWN";
        }
    }
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
     * Sets up event listeners for the new Weather Settings info window.
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
                MobileUIHandler.closeActiveWindow();
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
                    case 'weather-toggle-clouds':
                        toggleCloudLayer(isChecked);
                        break;
                    case 'weather-toggle-wind':
                        toggleWindLayer(isChecked);
                        break;
                }
                
                // Update the toolbar button's active state
                updateWeatherToolbarButtonState();
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
        const currentMobileMode = localStorage.getItem('mobileDisplayMode') || 'hud';
        const mobileModeHud = document.getElementById('mobile-mode-hud');
        const mobileModeLegacy = document.getElementById('mobile-mode-legacy');
        if (mobileModeHud && mobileModeLegacy) {
            if (currentMobileMode === 'legacy') {
                mobileModeLegacy.checked = true;
            } else {
                mobileModeHud.checked = true;
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


   /**
     * --- [MODIFIED] Sets up event listeners for the map search bar.
     * Now triggers autocomplete search instead of filtering.
     */
    function setupSearchEventListeners() {
        const searchInput = document.getElementById('sector-ops-search-input');
        const searchClear = document.getElementById('sector-ops-search-clear');
        const searchContainer = document.getElementById('sector-ops-search-container');
        const dropdown = document.getElementById('search-results-dropdown');

        if (!searchInput || !searchClear || !searchContainer || !dropdown) {
            console.warn("Could not find all search bar elements.");
            return;
        }
        
        let isListening = searchContainer.dataset.searchListeners === 'true';
        if (isListening) return; // Prevent duplicate listeners

        // On typing, call the new search handler
        searchInput.addEventListener('input', () => {
            handleSearchInput(searchInput.value);
            
            // Show/hide clear button
            if (searchInput.value) {
                searchClear.style.display = 'block';
            } else {
                searchClear.style.display = 'none';
            }
        });

        // On clear, clear input and hide dropdown
        searchClear.addEventListener('click', () => {
            searchInput.value = '';
            handleSearchInput(''); // This will clear the dropdown
            searchClear.style.display = 'none';
            searchInput.focus(); // Keep the bar expanded
        });

        // [MODIFIED] Add a click listener for the results dropdown
        dropdown.addEventListener('click', (e) => {
            const item = e.target.closest('.search-result-item');
            if (item) {
                // Pass the whole element to the click handler
                onSearchResultClick(item); 
            }
        });

        // ⬇️ --- [THIS IS THE NEW FIX] --- ⬇️
        // Add a 'mousedown' listener to the dropdown.
        // This prevents the 'blur' event from firing on the search input
        // when a user clicks a result. This stops the CSS from hiding
        // the dropdown (due to :focus-within) before the 'click' event
        // can be processed.
        dropdown.addEventListener('mousedown', (e) => {
            e.preventDefault();
        });
        // ⬆️ --- [END OF NEW FIX] --- ⬆️

        // Add a listener to the whole document to hide the dropdown
        // when clicking away from the search bar.
        document.addEventListener('click', (e) => {
            // If the click is *outside* the main search container, blur the input
            if (!searchContainer.contains(e.target)) {
                searchInput.blur();
                dropdown.innerHTML = ''; // Hide dropdown
            }
        }, true); // Use capture phase to catch clicks on the map
        
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

        // Inject all custom CSS
        injectCustomStyles();

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