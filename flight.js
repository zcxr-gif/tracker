import { MapAnimator } from './mapAnimator.js';

document.addEventListener('DOMContentLoaded', async () => {
    // --- Global Configuration ---
    const API_BASE_URL = 'https://site--indgo-backend--6dmjph8ltlhv.code.run';
    const LIVE_FLIGHTS_API_URL = 'https://site--acars-backend--6dmjph8ltlhv.code.run/flights';
    const ACARS_USER_API_URL = 'https://site--acars-backend--6dmjph8ltlhv.code.run/users'; // NEW: For user stats
    const TARGET_SERVER_NAME = 'Expert Server';
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
        showAircraftLabels: false 
    };

    const departureHubs = []; // Empty array
    let ALL_AVAILABLE_ROUTES = []; // Empty array
    const DYNAMIC_FLEET = []; // Empty array
    const AIRCRAFT_SELECTION_LIST = []; // Empty array

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
        /* --- [FIX] Sector Ops View Layout --- */
        #view-rosters.active {
            position: absolute;
            inset: 0; /* Sets top, right, bottom, left to 0 */
            width: 100%;
            height: 100%;
            padding: 0;
            overflow: hidden;

            /* Use Grid to layer the map and floating panel */
            display: grid;
            grid-template-columns: 1fr;
            grid-template-rows: 1fr;
        }

        /* This places the map into the grid, filling the entire space */
        #sector-ops-map-fullscreen {
            grid-column: 1 / -1;
            grid-row: 1 / -1;
        }

        /* * --- [ - MOVED!] ---
         * This rule is now GLOBAL (for desktop + mobile).
         * It makes the main content area fill the entire viewport 
         * ONLY when the Sector Ops map is active.
        */
        .main-content:has(#view-rosters.active) {
            padding: 0; /* Remove ALL padding (top, right, bottom, left) */
            height: 100dvh; /* Set height to 100% of the viewport height */
            overflow: hidden; /* Prevent the main container from scrolling */
        }
        
        /* --- [OVERHAUL] Base Info Window Styles (Refined Glassmorphism) --- */
        .info-window {
            position: absolute;
            /* ##### FIX START ##### */
            /* Reverted to original top position */
            top: 20px; 
            /* ##### FIX END ##### */
            right: 20px;
            /* --- REDESIGN: Wider for new layout --- */
            width: 540px; 
            max-width: 90vw;
            /* ##### FIX START ##### */
            /* Reverted to original max-height */
            max-height: calc(100vh - 40px);
            /* ##### FIX END ##### */
            background: rgba(18, 20, 38, 0.75);
            backdrop-filter: blur(20px) saturate(180%);
            -webkit-backdrop-filter: blur(20px) saturate(180%);
            border-radius: 16px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            box-shadow: 0 12px 40px rgba(0,0,0,0.6);
            /* ##### FIX START ##### */
            /* Set z-index to be ON TOP of search */
            z-index: 1060; 
            /* ##### FIX END ##### */
            /* --- [FIX] Changed 'display: none' to 'display: flex' for fade-out --- */
            display: flex;
            flex-direction: column;
            overflow: hidden;
            color: #e8eaf6;
            transition: opacity 0.3s ease, transform 0.3s ease;
            opacity: 0;
            transform: translateX(20px);
            /* --- [FIX] Add pointer-events to prevent interaction when hidden --- */
            pointer-events: none; 
        }
        .info-window.visible { 
            /* --- [FIX] Removed 'display: flex' (now in base) --- */
            opacity: 1;
            transform: translateX(0);
            /* --- [FIX] Allow interaction only when visible --- */
            pointer-events: auto;
        }
        .info-window-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 20px;
            background: rgba(10, 12, 26, 0.6);
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            flex-shrink: 0;
        }
        .info-window-header h3 {
            margin: 0; 
            font-size: 1.3rem; 
            color: #fff;
            font-weight: 600;
            text-shadow: 0 2px 5px rgba(0,0,0,0.4);
        }
        .info-window-header h3 small { 
            font-weight: 300; 
            color: #c5cae9; 
            font-size: 0.9rem; 
            margin-left: 5px; 
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
        }
        /* Custom Scrollbar */
        .info-window-content::-webkit-scrollbar { width: 8px; }
        .info-window-content::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); }
        .info-window-content::-webkit-scrollbar-thumb { background-color: #00a8ff; border-radius: 10px; border: 2px solid transparent; background-clip: content-box; }
        .info-window-content::-webkit-scrollbar-thumb:hover { background-color: #33c1ff; }

        /* --- [OVERHAUL] Airport Window: Weather & Tabs --- */
        .airport-info-weather {
            padding: 20px;
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 15px 20px;
            align-items: center;
            background: linear-gradient(135deg, rgba(0, 168, 255, 0.15), rgba(0, 100, 200, 0.25));
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        .weather-flight-rules { 
            font-size: 1.8rem; font-weight: 700; 
            padding: 12px 18px; border-radius: 10px;
            grid-row: 1 / 3;
            text-shadow: 1px 1px 3px rgba(0,0,0,0.3);
        }
        .flight-rules-vfr { background-color: #28a745; color: white; }
        .flight-rules-mvfr { background-color: #007bff; color: white; }
        .flight-rules-ifr { background-color: #dc3545; color: white; }
        .flight-rules-lifr { background-color: #a33ea3; color: white; }
        .weather-details-grid { 
            display: grid; grid-template-columns: 1fr 1fr; 
            gap: 10px 15px; text-align: left;
        }
        .weather-details-grid span { display: flex; align-items: center; gap: 8px; font-size: 0.95rem; }
        .weather-details-grid .fa-solid { color: #00a8ff; width: 16px; text-align: center; }
        .metar-code {
            grid-column: 1 / -1; font-family: 'Courier New', Courier, monospace;
            background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;
            font-size: 0.8rem; color: #e0e0e0; margin-top: 5px;
        }
        
        .info-window-tabs { display: flex; background: rgba(10, 12, 26, 0.4); padding: 5px 15px 0 15px; }
        .info-tab-btn {
            padding: 14px 18px; border: none; background: none; color: #c5cae9;
            cursor: pointer; font-size: 0.9rem; font-weight: 600;
            border-bottom: 3px solid transparent; transition: all 0.25s;
            display: flex; align-items: center; gap: 8px;
        }
        .info-tab-btn:hover { color: #fff; }
        .info-tab-btn.active { color: #00a8ff; border-bottom-color: #00a8ff; }
        .info-tab-content { display: none; animation: fadeIn 0.4s; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .info-tab-content.active { display: block; }
        .info-tab-content ul { list-style: none; padding: 0; margin: 0; }
        .info-tab-content li { padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.08); }
        .info-tab-content li:last-child { border-bottom: none; }
        .muted-text { color: #9fa8da; text-align: center; padding: 2rem; }


        /* --- [NEW DESIGN] AIRCRAFT FLIGHT DISPLAY --- */
        #aircraft-info-window .info-window-content {
            background: #1C1E2A; /* Solid dark background for content area */
        }
        
        /* 1. Overview Panel (Image + Top Info) */
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

            /* --- [NEW SMOOTHER FADE] ---
              This gradient now has an intermediate step for a
              more gradual fade-out compared to the old 70%-100% linear fade.
            */
            -webkit-mask-image: linear-gradient(180deg, black 65%, rgba(0,0,0,0.7) 80%, transparent 100%);
            mask-image: linear-gradient(180deg, black 65%, rgba(0,0,0,0.7) 80%, transparent 100%);
            
            /* --- [MODIFIED v12] ---
              Pull the element below it (the summary bar) up by 40px
              so it overlaps with the faded-out image area.
            */
            margin-bottom: -40px; 
        }
        
        /* --- [FIXED GRADIENT] ---
           This overlay provides a *subtle* hint of darkness at the top
           for text readability, without darkening the whole image.
           It's now controlled here in CSS, not in JavaScript.
        */
        .aircraft-overview-panel::before {
            content: '';
            position: absolute;
            inset: 0;
            z-index: 1;
            background: linear-gradient(180deg, 
                rgba(0, 0, 0, 0.4) 0%,  /* Hint of dark at the top */
                rgba(0, 0, 0, 0) 35%   /* Fades out quickly */
            );
        }
        
        /* Container for top-left/right text */
        .overview-content {
            position: relative;
            z-index: 2;
            padding: 16px 20px 0 20px;
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
        }
        .overview-col-left h3 {
            margin: 0;
            font-size: 1.6rem; 
            font-weight: 700; 
            letter-spacing: 0.5px;
            text-shadow: 0 4px 10px rgba(0, 0, 0, 0.7), 0 0 2px rgba(255, 255, 255, 0.2);
            display: flex;
            align-items: center;
            gap: 12px;
        }

        /* --- [NEW] Style for Airline Logo in Header --- */
        .ac-header-logo {
            height: 1.8rem; 
            width: auto;
            max-width: 100px; /* Prevent huge logos */
            object-fit: contain;
            filter: drop-shadow(0 2px 4px rgba(0,0,0,0.7)) drop-shadow(0 0 5px rgba(255, 255, 255, 0.3));
        }
        
        /* --- [MODIFIED] Container for animating subtext --- */
        .overview-col-left p {
            position: relative; 
            margin: 0;
            font-size: 1.0rem; 
            color: #e8eaf6; 
            font-weight: 400;
            text-shadow: 0 2px 5px rgba(0, 0, 0, 0.6);
            min-height: 1.2em; /* 1.0rem * 1.2 line-height */
            margin-top: 4px; 
        }

        /* --- [NEW] Keyframes for subtext animation --- */
        @keyframes primarySubtextAnimation {
            0%   { opacity: 1; transform: translateY(0); }
            60%  { opacity: 1; transform: translateY(0); } /* Hold Username (6s) */
            65%  { opacity: 0; transform: translateY(10px); } /* Fade Out (0.5s) */
            95%  { opacity: 0; transform: translateY(-10px); } /* Stay Hidden (3s) */
            100% { opacity: 1; transform: translateY(0); } /* Fade In (0.5s) */
        }
        @keyframes secondarySubtextAnimation {
            0%   { opacity: 0; transform: translateY(-10px); } /* Start Hidden (6.5s) */
            65%  { opacity: 0; transform: translateY(-10px); }
            70%  { opacity: 1; transform: translateY(0); } /* Fade In (0.5s) */
            90%  { opacity: 1; transform: translateY(0); } /* Hold Aircraft (2s) */
            95%  { opacity: 0; transform: translateY(10px); } /* Fade Out (0.5s) */
            100% { opacity: 0; transform: translateY(-10px); } /* Stay Hidden (0.5s) */
        }
        
        /* --- [NEW] Individual subtext items --- */
        .ac-header-subtext {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            animation-name: primarySubtextAnimation; /* Default to primary */
            animation-iteration-count: infinite;
            animation-duration: 10s;
            animation-timing-function: ease-in-out;
            opacity: 0; /* Start hidden, animation will show it */
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        
        #ac-header-username {
            animation-name: primarySubtextAnimation;
        }
        
        #ac-header-actype {
            animation-name: secondarySubtextAnimation;
        }

        .overview-col-right {
            text-align: right;
            display: none; /* Hide the top-right ICAOs */
        }
        .overview-col-right .route-icao {
            font-size: 1.5rem;
            font-weight: 700;
            font-family: 'Courier New', monospace;
            display: block;
        }
        .overview-col-right .route-subtext {
            font-size: 0.85rem;
            color: #c5cae9;
        }
        
        /* Action buttons (Hide/Close) */
        .overview-actions {
            position: absolute;
            top: 16px;
            right: 16px;
            z-index: 3;
            display: flex;
            gap: 8px;
        }
        .overview-actions button {
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            color: #e8eaf6;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            cursor: pointer;
            display: grid;
            place-items: center;
            transition: all 0.2s ease-in-out;
            backdrop-filter: blur(5px);
        }
        .overview-actions button:hover {
            background: #00a8ff;
            color: #fff;
            transform: scale(1.1);
            border-color: transparent;
        }

        /* 2. Route Summary Overlay (User Request) */
        .route-summary-overlay {
            /* --- [NEW v12] --- 
              Add position relative so it renders correctly 
              when overlapping the image panel above it.
            */
            position: relative;
            
            /* --- [MODIFIED v12] ---
               Change padding to give more space at the top
               for the elements sitting on the transparent area.
            */
            padding: 25px 20px 12px 20px;
            
            /* --- [NEW COLOR MIX] --- 
               This gradient now fades from transparent to a
               subtle light blue (rgba(0, 168, 255, 0.15)), 
               then to the dark UI color.
            */
            background: linear-gradient(
                180deg, 
                transparent 0%, 
                rgba(0, 168, 255, 0.15) 30%, /* <-- Added light blue glow */
                rgba(18, 20, 38, 0.8) 50%, 
                #1C1E2A 70%
            );
            
            border-radius: 0; /* Flush with content above and below */
            
            display: grid;
            grid-template-columns: auto 1fr auto;
            align-items: center;
            gap: 16px;
            width: 100%;
            box-sizing: border-box; 
        }

        /* --- [NEW] Styles for Flag/Time/ICAO --- */
        .route-summary-airport {
            display: flex;
            flex-direction: column;
        }
        #route-summary-dep { 
            text-align: left; 
            /* --- [NEW v12] --- */
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        #route-summary-arr { 
            text-align: right; 
            /* --- [NEW v12] --- */
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        
        .route-summary-airport .airport-line {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        #route-summary-arr .airport-line {
            justify-content: flex-end; /* Align arrival to the right */
        }
        
        .route-summary-airport .icao {
            font-family: 'Courier New', monospace;
            font-size: 1.2rem;
            font-weight: 700;
            color: #fff;
            /* --- [NEW v12] --- */
            text-shadow: 0 1px 3px rgba(0,0,0,0.5); 
        }
        .route-summary-airport .time {
            font-size: 0.85rem;
            font-weight: 600;
            color: #c5cae9;
            margin-top: 4px; /* [MODIFIED v12] Added slightly more margin */
            /* --- [NEW v12] --- 
               Force it to be a block and center its own text.
               This aligns it with the ICAO/flag line above.
            */
            display: block;
            text-align: center;
        }
        .route-summary-airport .country-flag {
            width: 20px;
            height: auto;
            border-radius: 3px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            display: none; /* Hidden by default, shown by JS */
        }
        /* --- [END NEW] --- */

        .route-progress-container {
            /* --- MODIFIED: Use Grid for layering --- */
            display: grid;
            grid-template-columns: 1fr;
            grid-template-rows: 1fr;
            align-items: center;
            justify-items: center;
            position: relative;
            min-height: 28px; /* Space for the pill indicator */
        }
        .route-progress-bar-container {
            width: 100%;
            height: 6px;
            background: rgba(10, 12, 26, 0.7);
            border-radius: 3px;
            overflow: hidden;
            /* --- MODIFIED: Layering --- */
            grid-row: 1 / 1;
            grid-column: 1 / 1;
            z-index: 1;
        }
        .progress-bar-fill {
            height: 100%;
            width: 0%;
            background: linear-gradient(90deg, #00a8ff, #89f7fe);
            transition: width 0.5s ease-out;
            border-radius: 3px;
        }
        .flight-phase-indicator {
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.75rem;
            font-weight: 700;
            color: #fff;
            display: flex;
            align-items: center;
            gap: 6px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            transition: all 0.4s ease-out;
            /* --- MODIFIED: Layering & Shadow --- */
            grid-row: 1 / 1;
            grid-column: 1 / 1;
            z-index: 2;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
        }
        .flight-phase-indicator .fa-solid { font-size: 0.8rem; }
        /* --- [MODIFIED] --- Opacity increased from 0.7 to 0.9 --- */
        .phase-climb { background: rgba(34, 139, 34, 0.9); box-shadow: 0 0 10px rgba(34, 139, 34, 0.7); }
        .phase-cruise { background: rgba(0, 119, 255, 0.9); box-shadow: 0 0 10px rgba(0, 119, 255, 0.7); }
        .phase-descent { background: rgba(255, 140, 0, 0.9); box-shadow: 0 0 10px rgba(255, 140, 0, 0.7); }
        .phase-approach { background: rgba(138, 43, 226, 0.9); box-shadow: 0 0 10px rgba(138, 43, 226, 0.7); }
        .phase-enroute { background: rgba(100, 110, 130, 0.9); box-shadow: 0 0 10px rgba(100, 110, 130, 0.7); }

        /* 3. Main Content (PFD + Grids) */
        .unified-display-main-content {
            padding: 16px;
            flex-grow: 1;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
        
        /* ====================================================================
        --- [START] REHAUL: PFD-first, top-down layout ---
        ====================================================================
        */
        
        /* --- [REMOVED] Tab styles --- */

        /* --- [NEW] Simple Pane switching --- */
        .ac-tab-pane {
            display: none;
            /* --- [NEW] Use Flex Column for new layout --- */
            display: none;
            flex-direction: column;
            gap: 16px; /* <-- Matches gap of .unified-display-main-content */
            animation: fadeIn 0.4s;
        }
        .ac-tab-pane.active {
            display: flex;
        }

        /* [REMOVED] .pfd-data-grid (The 2-column layout) */
        .pfd-data-grid {
            display: none; /* This layout is no longer used */
        }
        
        /* [REMOVED] .live-data-panel-new (The right-hand data panel) */
        .live-data-panel-new {
            display: none; /* This layout is no longer used */
        }
        
        /* [REMOVED] .ac-primary-data-item (The individual items in the right panel) */
        .ac-primary-data-item {
           display: none;
        }
        
        /* --- [REMOVED] Donut Chart Styles --- */
        .donut-chart-container { display: none; }
        .donut-chart { display: none; }
        .donut-chart-text { display: none; }
        .donut-bg, .donut-fg { display: none; }

        /* --- [REMOVED] Odometer Styles --- */
        .odometer-container { display: none; }
        .odometer-separator { display: none; }
        .odometer-value { display: none; }

        /* [NEW] This is the new data bar that sits below the PFD */
        .flight-data-bar {
            display: grid;
            /* --- [NEW] This grid creates 3 columns on small screens, 5 on larger ones --- */
            grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
            gap: 12px;
            
            /* Give it the "card" look */
            background: rgba(10, 12, 26, 0.5);
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.05);
            padding: 16px;
            border-top: 3px solid #00a8ff; /* Colorful accent */
        }

        /* [NEW] This is an individual item in the new data bar */
        .data-bar-item {
            display: flex;
            flex-direction: column;
            text-align: center;
            gap: 4px;
        }
        .data-bar-item .data-label {
            font-size: 0.7rem;
            color: #c5cae9;
            text-transform: uppercase;
        }
        .data-bar-item .data-value {
            font-size: 1.5rem;
            color: #fff;
            font-weight: 600;
            font-family: 'Courier New', monospace;
            line-height: 1.1;
        }
        .data-bar-item .data-value .unit {
            font-size: 0.8rem;
            font-weight: 400;
            color: #9fa8da;
            margin-left: 3px;
            font-family: 'Segoe UI', sans-serif;
        }
        .data-bar-item .data-value .fa-solid {
            font-size: 0.9rem;
            margin-right: 4px;
            color: #00a8ff;
            font-family: "Font Awesome 6 Free";
        }
        /* --- [END NEW] --- */
        
        /* [NEW] This is the full-width VSD card (styles mostly unchanged) */
        .ac-profile-card-new {
            background: rgba(10, 12, 26, 0.5);
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.05);
            padding: 10px;
            border-top: 3px solid #a33ea3; /* Colorful accent */
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .ac-profile-card-new h4 { /* Title for VSD */
            margin: 0 0 5px 0;
            font-size: 0.9rem;
            font-weight: 600;
            color: #e8eaf6;
            text-align: center;
        }
        
        /* ====================================================================
        --- [END] REHAUL: PFD-first, top-down layout ---
        ====================================================================
        */

        #aircraft-display-main {
            /* --- [REMOVED] --- This ID is no longer used for layout --- */
        }
        .unified-display-main {
            /* --- [REMOVED] --- Replaced by .pfd-data-grid --- */
        }

        /* 4. PFD Styles (Resized) */
        
        /* --- [NEW] 2-Column Grid for PFD + Location --- */
        .pfd-and-location-grid {
            display: grid;
            grid-template-columns: 1fr; /* Mobile: 1 column */
            gap: 16px;
        }
        
        /* --- [NEW] Desktop: 2 columns --- */
        @media (min-width: 500px) {
            .pfd-and-location-grid {
                 /* PFD gets 2 parts, Location gets 1 part */
                grid-template-columns: 2fr 1fr;
            }
        }
        
        /* --- [NEW] Right-hand column for Location --- */
        #location-data-panel {
            /* Use .data-bar-item styles but add card look */
            background: rgba(10, 12, 26, 0.5);
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.05);
            padding: 16px;
            border-top: 3px solid #28a745; /* Green accent */
            
            /* Center content */
            justify-content: center;
            height: 100%;
            box-sizing: border-box;
        }
        #location-data-panel .data-label {
            font-size: 0.8rem; /* Make label a bit bigger */
        }
        #location-data-panel .data-value {
             /* Make text smaller to fit long names */
            font-size: 1.1rem;
            font-family: 'Segoe UI', sans-serif;
            font-weight: 600;
            white-space: normal; /* Allow wrapping */
            line-height: 1.3;
            margin-top: 8px;
            color: #e8eaf6;
        }
        /* --- [END NEW] --- */

        .pfd-main-panel {
            display: flex;
            flex-direction: column;
            justify-content: flex-start; 
            min-width: 0;
            gap: 0;
            /* --- [MODIFIED] No longer centered, width is 100% of its grid col */
            max-width: 100%;
            width: 100%;
            margin: 0;
        }
        
        #pfd-container {
            display: grid;
            place-items: center;
            background: rgba(10, 12, 26, 0.5);
            border-radius: 12px;
            overflow: hidden;
            min-width: 0;
            /* --- [MODIFIED] PFD container is now standalone --- */
        }
        #pfd-container svg {
            width: 100%;
            height: auto;
            /* --- [MODIFIED] Max width is now smaller --- */
            max-width: 300px;
            /* --- MODIFIED: New aspect ratio based on cropped height --- */
            aspect-ratio: 787 / 635; 
            background-color: #1a1a1a;
            font-family: monospace, sans-serif;
            color: white;
            overflow: hidden;
            position: relative;
            border-radius: 8px;
        }
        #pfd-container svg #attitude_group {
            transition: transform 0.5s ease-out;
        }

        /* --- [REMOVED] PFD Footer Display --- */
        .pfd-footer-display {
           display: none;
        }
        .pfd-footer-ac-icon {
           display: none;
        }
        .pfd-footer-nav-item {
           display: none;
        }
        /* --- [END REMOVED] --- */


        /* Aircraft Type Readout (REMOVED) */
        #aircraft-type-readout {
           display: none; /* This is no longer used */
        }

        /* --- [REMOVED] --- .live-data-panel styles (replaced by .live-data-panel-new) */

        /* 6. Pilot Stats Button */
        /* --- [RESTORED] --- */
        .pilot-stats-toggle-btn {
            background: rgba(255,255,255,0.08);
            border: 1px solid rgba(255,255,255,0.15);
            color: #e8eaf6;
            padding: 10px 12px;
            width: 100%;
            border-radius: 8px;
            cursor: pointer;
            text-align: center;
            transition: all 0.2s;
            font-size: 0.9rem;
            font-weight: 600;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }
        .pilot-stats-toggle-btn:hover {
            background: #00a8ff;
            color: #fff;
        }

        /* 7. Pilot Stats View */
        #pilot-stats-display {
            /* --- [REMOVED] --- This is now handled by .ac-tab-pane */
        }
        .stats-rehaul-container {
            padding: 0; /* Remove padding, handled by parent */
            display: flex;
            flex-direction: column;
            gap: 16px;
            color: #e8eaf6;
        }
        .section-title {
            margin: 8px 0 -8px 0;
            font-size: 0.9rem;
            font-weight: 600;
            color: #9fa8da;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
            padding-bottom: 8px;
        }
        .kpi-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
            gap: 12px;
        }
        .kpi-card {
            background: rgba(10, 12, 26, 0.7);
            border-radius: 8px;
            padding: 12px;
            text-align: center;
            border: 1px solid rgba(255,255,255,0.05);
        }
        .kpi-label {
            font-size: 0.7rem;
            color: #c5cae9;
            margin-bottom: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }
        .kpi-value {
            font-size: 1.4rem;
            font-weight: 700;
            color: #fff;
            line-height: 1.2;
        }
        .progression-container {
            display: grid;
            grid-template-columns: 1fr;
            gap: 12px;
        }
        .progress-card {
            background: rgba(10, 12, 26, 0.6);
            border-radius: 8px;
            padding: 16px;
            border-left: 4px solid #00a8ff;
        }
        .progress-card.complete {
            border-left-color: #28a745;
            text-align: center;
        }
        .progress-card h4 {
            margin: 0 0 12px 0;
            font-size: 1.1rem;
            color: #fff;
        }
        .progress-item {
            margin-bottom: 12px;
        }
        .progress-item:last-child {
            margin-bottom: 0;
        }
        .progress-label {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 0.85rem;
            margin-bottom: 6px;
            color: #e8eaf6;
        }
        .progress-label .fa-solid { color: #9fa8da; margin-right: 6px; }
        .progress-bar-bg {
            width: 100%;
            height: 8px;
            background-color: rgba(0,0,0,0.3);
            border-radius: 4px;
            overflow: hidden;
        }
        .progress-bar-fg {
            height: 100%;
            background: linear-gradient(90deg, #00a8ff, #89f7fe);
            border-radius: 4px;
            transition: width 0.5s ease-out;
        }
        .req-met { color: #28a745; }
        .req-not-met { color: #dc3545; }
        .req-met .fa-solid, .req-not-met .fa-solid { margin-left: 6px; }

        .details-grid.stats-details { /* Add class to differentiate */
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px 16px;
            background: rgba(10, 12, 26, 0.6);
            padding: 16px;
            border-radius: 8px;
        }
        .detail-item.stats-item { /* Add class to differentiate */
            display: flex;
            justify-content: space-between;
            font-size: 0.9rem;
            padding: 6px 0;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .detail-item.stats-item:last-child, .detail-item.stats-item:nth-last-child(2) { border-bottom: none; }
        /* --- MODIFIED: Need to redefine detail-label/value as they were removed --- */
        .detail-label { color: #c5cae9; }
        .detail-value { color: #fff; font-weight: 600; }
        .back-to-flight-btn { /* Changed from back-to-pfd-btn */
            background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15);
            color: #e8eaf6; padding: 10px 12px; width: 100%;
            border-radius: 8px; cursor: pointer; text-align: center;
            transition: all 0.2s; font-size: 0.9rem; font-weight: 600;
        }
        .back-to-flight-btn:hover { background: #00a8ff; color: #fff; }

        /* Stats Accordion */
        .stats-rehaul-container .stats-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 0; /* Adjusted margin */
        }
        .stats-rehaul-container .stats-header h4 {
            margin: 0;
            font-size: 1.4rem;
        }
        .community-profile-link {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background-color: rgba(0, 168, 255, 0.1);
            color: #00a8ff;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 600;
            text-decoration: none;
            border: 1px solid rgba(0, 168, 255, 0.3);
            transition: all 0.2s ease-in-out;
        }
        .community-profile-link:hover {
            background-color: #00a8ff;
            color: #fff;
            transform: translateY(-2px);
            box-shadow: 0 4px 10px rgba(0, 168, 255, 0.3);
        }

        .stats-accordion {
            margin-top: 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .accordion-item {
            background: rgba(10, 12, 26, 0.5);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            overflow: hidden;
            transition: background-color 0.2s;
        }
        .accordion-item.active {
            background: rgba(10, 12, 26, 0.8);
        }
        .accordion-header {
            width: 100%;
            background: none;
            border: none;
            padding: 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: pointer;
            font-size: 1rem;
            font-weight: 600;
            color: #e8eaf6;
            text-align: left;
        }
        .accordion-header span {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .accordion-header .toggle-icon {
            transition: transform 0.3s ease-in-out;
            color: #9fa8da;
        }
        .accordion-item.active .toggle-icon {
            transform: rotate(180deg);
        }
        .accordion-content {
            max-height: 0;
            overflow: hidden;
            transition: max-height 0.3s ease-in-out, padding 0.3s ease-in-out;
            padding: 0 16px;
        }
        .accordion-item.active .accordion-content {
            padding: 0 16px 16px 16px;
        }
        .accordion-content > .progression-container,
        .accordion-content > .details-grid {
            padding-top: 8px;
        }
        
        /* --- Toolbar Recall Buttons --- */
        #airport-recall-btn, #aircraft-recall-btn {
            display: none; font-size: 1.1rem; position: relative;
        }
        #airport-recall-btn.visible, #aircraft-recall-btn.visible {
            display: inline-block;
        }
        #airport-recall-btn.palpitate, #aircraft-recall-btn.palpitate {
            animation: palpitate 0.5s ease-in-out 2;
        }
        @keyframes palpitate {
            0%, 100% { transform: scale(1); color: #00a8ff; }
            50% { transform: scale(1.3); color: #fff; }
        }
        
        /* Styles for Active ATC Markers on Sector Ops Map */
        @keyframes atc-pulse {
            0% { box-shadow: 0 0 0 0 rgba(220, 53, 69, 0.7); }
            70% { box-shadow: 0 0 0 10px rgba(220, 53, 69, 0); }
            100% { box-shadow: 0 0 0 0 rgba(220, 53, 69, 0); }
        }
        @keyframes atc-breathe {
            0% { transform: scale(0.95); opacity: 0.6; }
            50% { transform: scale(1.4); opacity: 0.9; }
            100% { transform: scale(0.95); opacity: 0.6; }
        }
        .atc-active-marker {
            width: 15px; height: 15px; background-color: #dc3545; border-radius: 50%;
            border: 2px solid #fff; cursor: pointer; animation: atc-pulse 2s infinite;
            display: grid; place-items: center;
        }
        .atc-approach-active::before {
            content: ''; grid-area: 1 / 1; width: 250%; height: 250%; border-radius: 50%;
            background-color: rgba(240, 173, 78, 0.8); z-index: -1; 
            animation: atc-breathe 4s ease-in-out infinite;
        }
        
        /* --- [NEW] Mobile Sidebar Toggle & Overlay --- */
        .mobile-sidebar-toggle-btn {
            display: none; /* Hidden by default on desktop */
            place-items: center;
            position: fixed;
            top: 15px;
            left: 15px;
            z-index: 1100; /* ✅ High z-index to be on top of everything */
            background-color: rgba(18, 20, 38, 0.8);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: #e8eaf6;
            width: 44px;
            height: 44px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 1.2rem;
            backdrop-filter: blur(10px);
            transition: all 0.2s ease-in-out;
        }
        .mobile-sidebar-toggle-btn:hover {
            background-color: #00a8ff;
            color: #fff;
            transform: scale(1.1);
        }

        .mobile-nav-overlay {
            display: none; /* ✅ Should be hidden by default */
            position: fixed;
            inset: 0;
            background-color: rgba(0, 0, 0, 0.6);
            z-index: 998; /* ✅ Below sidebar, above content */
        }

        /* --- [NEW] Responsive Media Query for Mobile --- */
        @media (max-width: 992px) {
            .mobile-sidebar-toggle-btn {
                display: grid; /* Show the button on mobile */
            }

            /* Hide the desktop toggle button on mobile */
            #sidebar-toggle {
                display: none;
            }

            .sidebar {
                position: fixed;
                left: 0;
                top: 0;
                height: 100%;
                width: 260px;
                transform: translateX(-100%); /* Start off-screen */
                transition: transform 0.3s ease-in-out;
                z-index: 999; /* ✅ Higher than the overlay */
                box-shadow: 5px 0 25px rgba(0,0,0,0.3);
            }

            /* When the menu is open, slide the sidebar in */
            .dashboard-container.sidebar-mobile-open .sidebar {
                transform: translateX(0);
            }

            /* ✅ When the menu is open, show the overlay */
            .dashboard-container.sidebar-mobile-open .mobile-nav-overlay {
                display: block;
            }
            
            
            /*
             * --- [ - REMOVED!] ---
             * This rule was moved out of the media query
             * to apply to all screen sizes.
            */
            /*
            .main-content:has(#view-rosters.active) {
                padding: 0; 
                height: 100dvh; 
                overflow: hidden; 
            }
            */

            /* --- [REDESIGN] Mobile layout for info window --- */
            .info-window {
                width: 95vw; /* Almost full width */
                top: 10px;
                right: 2.5vw;
                left: 2.5vw;
                max-height: calc(100vh - 20px);
            }
            
            /* --- [REMOVED] Mobile grid styles for deleted elements --- */
            
            /* --- [NEW] Make new data bar stack on mobile --- */
            .flight-data-bar {
                grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
                gap: 16px 8px; /* More vertical gap */
            }

            /* ⬇️ --- [NEW FIX] --- ⬇️ */
            /* Selectively reduce callsign font size only on mobile */
            .overview-col-left h3 {
                font-size: 1.1rem;
            }
            .ac-header-logo {
                height: 1.3rem;
            }
            /* ⬆️ --- [END NEW FIX] --- ⬆️ */
            
            /* --- [NEW] On mobile, stack PFD and Location --- */
            .pfd-and-location-grid {
                grid-template-columns: 1fr; /* 1 column */
            }

            /* ##### MODIFICATION START (Specificity Fix) ##### */
            /* Show the mobile-only filter section on mobile, using a stronger selector */
            #filter-settings-window .mobile-only-filter-section {
                display: block;
            }
            /* ##### MODIFICATION END (Specificity Fix) ##### */
        }
        
        /* ====================================================================
        --- [START] VSD RE-DESIGN (USER REQUEST) --- 
        ====================================================================
        */
        #vsd-panel {
            position: relative;
            display: flex;
            flex-direction: column;
            background: transparent; /* --- [MODIFIED] Card bg handles this --- */
            border-radius: 12px;
            min-height: 240px; /* Give it a fixed height */
            max-height: 240px;
            overflow: hidden;
            font-family: 'Courier New', monospace;
            flex-grow: 1; /* --- [NEW] --- */
            width: 100%; /* --- [NEW] --- */
        }
        
        #vsd-summary-bar {
           /* --- [REMOVED] --- This is no longer used --- */
           display: none;
        }

        #vsd-graph-window {
            position: relative;
            width: 100%;
            flex-grow: 1;
            overflow: hidden;
            border-radius: 12px;
            
            /* --- [MODIFIED] Add padding for the new Y-Axis --- */
            padding-left: 35px;
            box-sizing: border-box; /* Ensure padding is included in width */
            
            /* Add horizontal grid lines for altitude */
            background: linear-gradient(
                rgba(0, 168, 255, 0.1) 1px, 
                transparent 1px
            );
            /* --- [MODIFIED] Adjusted background size to match 10k ft intervals --- */
            background-size: 100% 53.3px; /* (240px / 45k ft) * 10k ft */
        }

        /* --- [NEW] Y-Axis (Altitude Scale) --- */
        #vsd-y-axis {
            position: absolute;
            left: 0;
            top: 0;
            bottom: 0;
            width: 35px; /* Matches padding-left */
            font-size: 0.7rem;
            color: #9fa8da;
            font-weight: 600;
            padding: 5px 0;
            box-sizing: border-box;
            border-right: 1px solid rgba(0, 168, 255, 0.1);
            pointer-events: none; /* Let clicks pass through */
        }
        .y-axis-label {
            position: absolute;
            left: 5px;
            transform: translateY(-50%); /* Center on its 'top' value */
            text-shadow: 0 0 3px rgba(0,0,0,0.5);
        }
        /* --- [END NEW] --- */

        /* --- [MODIFIED] Aircraft Icon (Added Dropline) --- */
        #vsd-aircraft-icon {
            position: absolute;
            left: 0px; /* Will be set by JS */
            top: 50%; /* Will be set by JS */
            width: 30px;
            height: 20px;
            z-index: 10;
            /* Simple '>' icon for aircraft */
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 30 20' fill='%2300a8ff'%3E%3Cpath d='M2,10 L10,2 L10,7 L28,7 L28,13 L10,13 L10,18 L2,10 Z' /%3E%3C/svg%3E");
            background-size: contain;
            background-repeat: no-repeat;
            background-position: center;
            transform: translateY(-50%);
            transition: top 0.5s ease-out, left 1s linear;
        }
        
        /* --- [NEW] Vertical Dropline for aircraft --- */
        #vsd-aircraft-icon::before {
            content: '';
            position: absolute;
            top: 50%; /* Start at icon center */
            left: 10px; /* Position horizontally within icon bounds */
            width: 2px;
            height: 500px; /* Arbitrarily long */
            background: linear-gradient(to bottom, #00a8ff, transparent 80%);
            opacity: 0.7;
        }
        /* --- [END NEW] --- */
        
        #vsd-graph-content {
            position: absolute;
            top: 0;
            left: 35px; /* --- [MODIFIED] Start after Y-Axis --- */
            height: 100%;
            width: 1px; /* Will be set by JS */
            will-change: transform;
            transition: transform 1s linear; /* Smooth scroll */
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
            stroke: #00a8ff;
            stroke-width: 3;
            stroke-linejoin: round;
        }

        /* --- [MODIFIED] Style for the Flown Altitude Path --- */
        #vsd-flown-path {
            fill: none;
            stroke: #dc3545; /* Red */
            stroke-width: 4; /* <-- MODIFIED */
            stroke-linejoin: round;
            opacity: 0.9; /* <-- MODIFIED */
        }
        /* --- [END MODIFIED] --- */

        #vsd-waypoint-labels {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
        }
        
        /* --- [MODIFIED] Waypoint Labels (Staggering) --- */
        .vsd-wp-label {
            position: absolute;
            transform: translateX(-50%); /* Center the label on its 'left' pos */
            color: #fff;
            font-size: 0.8rem;
            text-align: center;
            text-shadow: 0 0 5px rgba(0,0,0,0.8);
            line-height: 1.2;
            padding: 2px 4px;
            background: rgba(10, 12, 26, 0.5);
            border-radius: 3px;
            white-space: nowrap;
        }
        .vsd-wp-label .wp-name {
            font-weight: 700;
            font-size: 0.9rem;
            color: #89f7fe;
        }
        .vsd-wp-label .wp-alt {
            font-size: 0.75rem;
            color: #c5cae9;
        }

        /* --- [NEW] Tick lines for labels --- */
        .vsd-wp-label::after {
            content: '';
            position: absolute;
            left: 50%;
            transform: translateX(-50%);
            width: 1px;
            height: 12px; /* Connects label to profile */
            background: rgba(255, 255, 255, 0.3);
        }
        
        /* High label: tick goes from bottom-center DOWN */
        .vsd-wp-label.high-label::after {
            top: 100%;
        }

        /* Low label: tick goes from top-center UP */
        .vsd-wp-label.low-label::after {
            bottom: 100%;
        }
        /* --- [END NEW] --- */

        /* ====================================================================
        --- [END] VSD RE-DESIGN --- 
        ====================================================================
        */

        /* ##### MODIFICATION START ##### */
        /* --- [NEW] Aircraft Window Tab Styles --- */
        .ac-info-window-tabs {
            display: flex;
            /* [MODIFIED] Use space-between to push logo to the right */
            justify-content: space-between; 
            /* [NEW] Vertically center the buttons and logo */
            align-items: center; 
            
            background: rgba(10, 12, 26, 0.4);
            padding: 5px 15px 0 15px;
            /* --- [FIX] Removed margins that incorrectly placed it inside the content area --- */
            /* margin: 0 16px; */ 
            /* margin-top: 16px; */
            border-radius: 0; /* --- [FIX] Removed border-radius --- */
        }

        /* [NEW] Wrapper for the tab buttons */
        .ac-tabs-wrapper {
            display: flex;
        }

        /* [NEW] Style for your logo */
        .ac-info-tab-logo {
            height: 48px; /* Adjust height as needed */
            width: auto;
            object-fit: contain;
            opacity: 0.7; /* Optional: makes it blend nicely */
        }
        /* ##### MODIFICATION END ##### */

        .ac-info-tab-btn {
            padding: 14px 18px;
            border: none;
            background: none;
            color: #c5cae9;
            cursor: pointer;
            font-size: 0.9rem;
            font-weight: 600;
            border-bottom: 3px solid transparent;
            transition: all 0.25s;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .ac-info-tab-btn:hover { color: #fff; }
        .ac-info-tab-btn.active { color: #00a8ff; border-bottom-color: #00a8ff; }

        /* Hide the old toggle buttons, as tabs replace them */
        .pilot-stats-toggle-btn,
        .back-to-flight-btn {
            display: none !important;
        }

        /* --- [MODIFIED] VSD Disclaimer --- */
        .vsd-disclaimer {
            background: rgba(10, 12, 26, 0.5); /* --- [MODIFIED] Re-add bg --- */
            border: 1px solid rgba(255, 255, 255, 0.05); /* --- [MODIFIED] Re-add border --- */
            border-radius: 8px; /* --- [NEW] --- */
            padding: 10px 14px;
            margin-top: 0; 
        }
        .disclaimer-legend {
            display: flex;
            justify-content: center;
            gap: 20px;
            margin-bottom: 8px;
            font-size: 0.8rem;
            font-weight: 600;
        }
        .disclaimer-legend span {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .vsd-disclaimer p {
            font-size: 0.75rem;
            color: #9fa8da;
            text-align: center;
            margin: 0;
            padding-top: 8px;
            border-top: 1px solid rgba(255, 255, 255, 0.05);
        }
        .vsd-disclaimer p .fa-solid {
            margin-right: 4px;
        }
        
        /* ====================================================================
        --- [NEW STYLES FOR WEATHER WINDOW] --- 
        ====================================================================
        */

        #weather-settings-window {
            /* Position on the left, not the right */
            left: 20px;
            right: auto;
            
            /* Make it smaller */
            width: 360px;
            
            /* Fix transform direction */
            transform: translateX(-20px);
        }
        
        #weather-settings-window.visible {
            transform: translateX(0);
        }

        .weather-toggle-list {
            list-style: none;
            padding: 16px 20px;
            margin: 0;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
        
        .weather-toggle-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .weather-toggle-label {
            font-size: 1rem;
            font-weight: 600;
            color: #e8eaf6;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .weather-toggle-label .fa-solid {
            width: 20px;
            text-align: center;
            color: #00a8ff;
        }
        
        .weather-disclaimer-note {
            padding: 16px 20px;
            margin: 0 20px 20px 20px;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 8px;
            font-size: 0.8rem;
            color: #c5cae9;
            border: 1px solid rgba(255, 255, 255, 0.05);
            line-height: 1.5;
        }
        .weather-disclaimer-note .fa-solid {
            color: #f39c12;
            margin-right: 8px;
        }

        /* --- CSS Toggle Switch --- */
        .toggle-switch {
            position: relative;
            display: inline-block;
            width: 50px;
            height: 28px;
        }
        .toggle-switch input {
            opacity: 0;
            width: 0;
            height: 0;
        }
        .toggle-slider {
            position: absolute;
            cursor: pointer;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: rgba(10, 12, 26, 0.7);
            border: 1px solid rgba(255, 255, 255, 0.1);
            transition: .3s;
            border-radius: 28px;
        }
        .toggle-slider:before {
            position: absolute;
            content: "";
            height: 20px;
            width: 20px;
            left: 3px;
            bottom: 3px;
            background-color: white;
            transition: .3s;
            border-radius: 50%;
        }
        input:checked + .toggle-slider {
            background-color: #00a8ff;
        }
        input:checked + .toggle-slider:before {
            transform: translateX(22px);
        }
        /* --- End Toggle Switch --- */

        /* ====================================================================
        --- [NEW STYLES FOR FILTER WINDOW] --- 
        ====================================================================
        */

        #filter-settings-window {
            /* Position on the left, not the right */
            left: 20px;
            right: auto;
            
            /* --- [NEW] Stack it below the weather window --- */
            top: 20px; 
            
            /* Make it smaller */
            width: 360px;
            
            /* Fix transform direction */
            transform: translateX(-20px);
        }
        
        #filter-settings-window.visible {
            transform: translateX(0);
        }

        .filter-toggle-list {
            list-style: none;
            padding: 16px 20px;
            margin: 0;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
        
        .filter-toggle-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .filter-toggle-label {
            font-size: 1rem;
            font-weight: 600;
            color: #e8eaf6;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .filter-toggle-label .fa-solid {
            width: 20px;
            text-align: center;
            color: #00a8ff; /* Re-use blue color for consistency */
        }

        /* --- [START NEW] --- */
        .filter-section-divider {
            padding: 12px 20px 8px 20px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
        }

        .filter-section-title {
            font-size: 0.8rem;
            font-weight: 600;
            color: #9fa8da;
            text-transform: uppercase;
        }

        .filter-radio-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 0; /* A bit less padding than toggles */
        }
        
        .filter-radio-item input[type="radio"] {
            /* Use accent-color for modern browsers */
            accent-color: #00a8ff;
            width: 18px;
            height: 18px;
        }
        
        .filter-radio-item label {
            font-size: 1rem;
            font-weight: 600;
            color: #e8eaf6;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        .filter-radio-item label .fa-solid {
            width: 20px;
            text-align: center;
            color: #00a8ff;
        }
        /* --- [END NEW] --- */

        /* ##### MODIFICATION START (Specificity Fix) ##### */
        /* By default, hide the mobile-only setting on desktop */
        .mobile-only-filter-section {
            display: none;
        }
        /* ##### MODIFICATION END (Specificity Fix) ##### */

        /* ====================================================================
        --- [NEW STYLES FOR MAP SEARCH BAR] --- 
        ====================================================================
        */
        .sector-ops-search {
            position: absolute;
            top: 20px;
            
            /* ##### FIX START ##### */
            /* Position top-right */
            right: 20px; 
            /* ##### FIX END ##### */
            
            /* ##### FIX START ##### */
            /* Set z-index to be BENEATH info window */
            z-index: 1050; 
            /* ##### FIX END ##### */
            display: flex;
            flex-direction: column; 
            align-items: center;
            transition: all 0.3s ease;
        }

        /* --- [NEW] Container for the input bar itself --- */
        .search-bar-container {
            position: relative;
            display: flex;
            align-items: center;
            width: 300px; /* Start at full width */
            background: rgba(18, 20, 38, 0.75);
            backdrop-filter: blur(15px);
            -webkit-backdrop-filter: blur(15px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 25px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.4);
            overflow: hidden;
            z-index: 2; /* Keep bar above results */
        }
        
        /* Minimal "icon only" state when not focused */
        .sector-ops-search:not(:focus-within) .search-bar-container {
            width: 44px;
        }
        
        /* --- [START OF FIX] --- */
        /* This rule now targets the new <label> element */
        .sector-ops-search .search-icon-label {
            color: #9fa8da;
            padding: 12px 14px;
            font-size: 1rem;
            z-index: 1;
            transition: color 0.2s;
            line-height: 1;
            cursor: text;
            display: grid;
            place-items: center;
        }
        
        /* [NEW] This rule removes padding from the <i> icon itself */
        .sector-ops-search .search-icon {
            padding: 0;
        }
        /* --- [END OF FIX] --- */

        #sector-ops-search-input {
            width: 0; /* Hidden by default */
            border: none;
            background: transparent;
            color: #e8eaf6;
            font-size: 1rem; /* --- [FIX] Changed from 0.95rem to prevent mobile zoom --- */
            outline: none;
            padding: 12px 0 12px 0;
            transition: width 0.3s ease-in-out;
        }
        
        #sector-ops-search-input::placeholder {
            color: #9fa8da;
            opacity: 0.8;
        }
        
        /* Expand when the input or its container is focused */
        .sector-ops-search:focus-within .search-bar-container {
            width: 300px;
            background: rgba(10, 12, 26, 0.8);
            border-bottom-left-radius: 0; /* --- [NEW] --- */
            border-bottom-right-radius: 0; /* --- [NEW] --- */
        }
        
        /* --- [START OF FIX] --- */
        /* This rule now targets the <label> on focus-within */
        .sector-ops-search:focus-within .search-icon-label {
            color: #00a8ff;
        }
        /* --- [END OF FIX] --- */
        
        .sector-ops-search:focus-within #sector-ops-search-input {
            /* 300px (total) - 44px (icon) - 46px (clear button) */
            width: 210px; 
        }

        .search-clear-btn {
            background: none;
            border: none;
            color: #9fa8da;
            cursor: pointer;
            font-size: 1.1rem;
            padding: 10px 14px;
            margin-left: auto;
            line-height: 1;
        }
        .search-clear-btn:hover {
            color: #fff;
        }
        
        /* Show/hide clear button logic */
        .sector-ops-search:focus-within #sector-ops-search-input:not(:placeholder-shown) + #sector-ops-search-clear {
            display: block;
        }
        .sector-ops-search:focus-within #sector-ops-search-input:placeholder-shown + #sector-ops-search-clear,
        .sector-ops-search:not(:focus-within) #sector-ops-search-clear {
            display: none;
        }

        /* --- [START NEW] Search Results Dropdown --- */
        .search-results-dropdown {
            width: 300px;
            max-height: 400px;
            overflow-y: auto;
            background: rgba(10, 12, 26, 0.9);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-top: none;
            border-radius: 0 0 16px 16px;
            box-shadow: 0 10px 20px rgba(0,0,0,0.3);
            z-index: 1; /* Below bar */
            display: none; /* Hidden by default */
        }

        /* Show dropdown when search is focused and has results */
        .sector-ops-search:focus-within .search-results-dropdown:not(:empty) {
            display: block;
        }

        .search-result-item {
            padding: 12px 16px;
            display: flex;
            align-items: center;
            gap: 12px;
            cursor: pointer;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            transition: background-color 0.2s;
        }
        .search-result-item:last-child {
            border-bottom: none;
        }
        .search-result-item:hover {
            background-color: #00a8ff;
        }

        .search-result-item .fa-solid {
            color: #9fa8da;
            width: 16px;
        }
        .search-result-item:hover .fa-solid {
            color: #fff;
        }

        .search-result-info {
            display: flex;
            flex-direction: column;
            line-height: 1.3;
            overflow: hidden;
        }
        .search-result-info strong {
            font-size: 0.95rem;
            color: #fff;
            white-space: nowrap;
            text-overflow: ellipsis;
            overflow: hidden;
        }
        .search-result-info small {
            font-size: 0.8rem;
            color: #c5cae9;
            white-space: nowrap;
            text-overflow: ellipsis;
            overflow: hidden;
        }
        .search-result-item:hover small {
            color: #e8eaf6;
        }
        /* --- [END NEW] Search Results Dropdown --- */


        /* --- Mobile adjustments for search bar --- */
        @media (max-width: 992px) {
            .sector-ops-search {
                /* --- [START MODIFICATION - TOP FIX] --- */
                top: 15px; /* Change from 50px to 15px to move it to the very top */
                left: 50%;
                transform: translateX(-50%);
                z-index: 990 !important;
                width: 300px;
                max-width: calc(100vw - 30px);
                /* --- [END MODIFICATION - TOP FIX] --- */
            }
            
            /* Keep it expanded on mobile */
            .search-bar-container,
            .sector-ops-search:not(:focus-within) .search-bar-container,
            .sector-ops-search:focus-within .search-bar-container {
                 width: 100%;
                 border-radius: 25px; 
            }

            /* --- [NEW] --- */
            .search-results-dropdown {
                width: 100%;
            }
            .sector-ops-search:focus-within .search-bar-container {
                border-bottom-left-radius: 0;
                border-bottom-right-radius: 0;
            }
            /* --- [END NEW] --- */
            
            .sector-ops-search #sector-ops-search-input,
            .sector-ops-search:focus-within #sector-ops-search-input {
                 /* Fill remaining space */
                 width: calc(100% - 88px);
            }

            /* Show clear button if not empty (no focus-within needed) */
            #sector-ops-search-input:not(:placeholder-shown) + #sector-ops-search-clear {
                display: block;
            }
            #sector-ops-search-input:placeholder-shown + #sector-ops-search-clear {
                display: none;
            }

            /* --- [START MODIFICATION - INFO WINDOW FIX] --- */
            /* Adjust info window to not clash */
            .info-window {
                /* Sits below the search bar */
                top: 75px; 
                max-height: calc(100vh - 90px); /* Adjust max-height accordingly */
            }
            /* --- [END MODIFICATION - INFO WINDOW FIX] --- */
        }
    `;

    const style = document.createElement('style');
    style.id = styleId;
    style.type = 'text/css';
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
}

//**
     * --- [FIXED] Fetches and injects the external HTML content for the info panel.
     * This function now ALSO contains the tab-switching logic from panel-tabs.js
     * to ensure the elements exist before event listeners are attached.
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
            // ===================================================================
            // END: Logic from panel-tabs.js
            // ===================================================================
            
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
        
        // 6. Fetch session and call handleAircraftClick
        // (This part is unchanged)
        fetch('https://site--acars-backend--6dmjph8ltlhv.code.run/if-sessions')
            .then(res => res.json())
            .then(data => {
                const expertSession = data.sessions.find(s => s.name.toLowerCase().includes('expert'));
                if (expertSession) {
                    handleAircraftClick(flightProps, expertSession.id);
                }
            });
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
 * --- [REPLACEMENT - DELEGATOR VERSION] Handles live flight data received from the WebSocket.
 * This function now only validates data, creates the properties object,
 * and delegates all animation/map logic to the MapAnimator.
 */
function handleSocketFlightUpdate(data) {
    if (!data || !Array.isArray(data.flights) || !data.timestamp) {
        console.warn('Socket: Received invalid or untimestamped flights data packet.');
        return;
    }
    
    // --- Timestamp validation ---
    const newPacketTimestamp = new Date(data.timestamp).getTime();
    if (newPacketTimestamp <= lastSocketUpdateTimestamp) {
        console.warn(`Socket: Discarding stale flight data packet (Lag: ${lastSocketUpdateTimestamp - newPacketTimestamp}ms)`);
        return;
    }
    const packetDuration = newPacketTimestamp - lastSocketUpdateTimestamp;
    lastSocketUpdateTimestamp = newPacketTimestamp;
    // --- [END] ---

    if (!sectorOpsMap || !sectorOpsMap.isStyleLoaded() || !mapAnimator) {
        return; // Map or Animator not ready
    }

    const flights = data.flights;
    const updatedFlightIds = new Set();

    flights.forEach(flight => {
        if (!flight.position || flight.position.lat == null || flight.position.lon == null) return;

        const flightId = flight.flightId;
        updatedFlightIds.add(flightId);

        // --- This function is still responsible for building the properties ---
        // --- (because this is application-specific) ---
        
        const litePhase = getLiteFlightPhase(flight.position);
        const aircraftData = flight.aircraft || null;
        
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
            category: getAircraftCategory(flight.aircraft?.aircraftName),
            heading: flight.position.heading_deg || 0,
            isStaff: flight.isStaff,
            isVAMember: flight.isVAMember,
            phase: litePhase 
        };

        // --- Delegate to the animator ---
        mapAnimator.updateFlight(flight.position, newProperties, packetDuration);
    });

    // Clean up old flights
    for (const flightId in currentMapFeatures) {
        if (!updatedFlightIds.has(String(flightId))) {
            // --- Delegate removal to the animator ---
            mapAnimator.removeFlight(flightId);
        }
    }
}

/**
 * --- [NEW] Initializes and connects the Socket.IO client for Sector Ops.
 * Manages connection, room joining, and data event listeners.
 */
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
    // ASSUMPTION: The Socket.IO client library (socket.io.js) is included in your HTML.
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
        transports: ['websocket'] // Prefer websocket
    });

    // On successful connection, join the server room
    sectorOpsSocket.on('connect', () => {
        console.log(`Socket: Connected with ID ${sectorOpsSocket.id}. Joining room: ${TARGET_SERVER_NAME.toLowerCase()}`);
        sectorOpsSocket.emit('join_server_room', TARGET_SERVER_NAME);
    });

    // --- THIS IS THE CORE ---
    // Listen for the broadcasted flight data
    sectorOpsSocket.on('all_flights_update', handleSocketFlightUpdate);
    // --- END OF CORE ---

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

    /**
     * Initializes the SVG PFD by generating its static elements like tapes and ladders.
     * This function should only be called ONCE when the PFD container is first created.
     */
    function createPfdDisplay() {
        const SVG_NS = "http://www.w3.org/2000/svg";
        const attitudeGroup = document.getElementById('attitude_group');
        const speedTapeGroup = document.getElementById('speed_tape_group');
        const altitudeTapeGroup = document.getElementById('altitude_tape_group');
        const tensReelGroup = document.getElementById('altitude_tens_reel_group');
        const headingTapeGroup = document.getElementById('heading_tape_group');

        if (!attitudeGroup || !speedTapeGroup || !altitudeTapeGroup || !tensReelGroup || !headingTapeGroup || attitudeGroup.dataset.initialized) {
            return;
        }


        // --- GENERATION FUNCTIONS (unchanged from your original static function) ---
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
        function generateAltitudeTape() {
            // ✅ FIX: Changed MIN_ALTITUDE from -1000 to 0 to prevent negative numbers on the tape.
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
        function generateAltitudeTensReel() {
            const center_y = 316;
            for (let i = -5; i < 10; i++) {
                let value = (i * 20); value = (value < 0) ? 100 + (value % 100) : value % 100;
                const displayValue = String(value).padStart(2, '0');
                const yPos = center_y + (i * PFD_REEL_SPACING);
                const text = document.createElementNS(SVG_NS, 'text');
                text.setAttribute('x', '745'); text.setAttribute('y', yPos);
                text.setAttribute('fill', '#00FF00'); text.setAttribute('font-size', '32');
                text.setAttribute('font-weight', 'bold'); text.textContent = displayValue;
                tensReelGroup.appendChild(text);
            }
        }
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
        
        generateAttitudeIndicators();
        generateSpeedTape();
        generateAltitudeTape();
        generateAltitudeTensReel();
        generateHeadingTape();

        attitudeGroup.dataset.initialized = 'true'; 
    }
    

/**
 * [FIXED] Updates the PFD display(s).
 * This function is now safe for mobile cloning because it uses
 * querySelectorAll to find and update *all* PFD instances,
 * rather than just the first one found by getElementById.
 */
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
  
  // (All calculation logic below is unchanged)

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

  // ---- global scales (with sane fallbacks) ----
  const PFD_PITCH_SCALE       = window.PFD_PITCH_SCALE ?? 2.0;
  const PFD_SPEED_REF_VALUE   = window.PFD_SPEED_REF_VALUE ?? 0;
  const PFD_SPEED_SCALE       = window.PFD_SPEED_SCALE ?? -0.6;
  const PFD_ALTITUDE_SCALE    = window.PFD_ALTITUDE_SCALE ?? 0.7;
  const PFD_REEL_SPACING      = window.PFD_REEL_SPACING ?? 40;
  const PFD_HEADING_REF_VALUE = window.PFD_HEADING_REF_VALUE ?? 0;
  const PFD_HEADING_SCALE     = window.PFD_HEADING_SCALE ?? 4;

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
  const reelYOffset = -(tensValue / 20) * PFD_REEL_SPACING;
  tensReelGroups.forEach(el => el.setAttribute('transform', `translate(0, ${reelYOffset})`));

  const hdg = ((Math.round(track_deg) % 360) + 360) % 360;
  const xOffset = -(track_deg - PFD_HEADING_REF_VALUE) * PFD_HEADING_SCALE;
  headingReadouts.forEach(el => el.textContent = String(hdg).padStart(3, '0'));
  headingTapeGroups.forEach(el => el.setAttribute('transform', `translate(${xOffset}, 0)`));
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
 * --- [REVAMPED] Creates the rich HTML content for the airport information window.
 * This now includes a live weather widget and a tabbed interface.
 */
    async function createAirportInfoWindowHTML(icao) {
        const atcForAirport = activeAtcFacilities.filter(f => f.airportName === icao);
        const notamsForAirport = activeNotams.filter(n => n.airportIcao === icao);
        const routesFromAirport = ALL_AVAILABLE_ROUTES.filter(r => r.departure === icao);

        // Fetch weather
        let weatherHtml = '';
        try {
            const weatherRes = await fetch(`${CURRENT_SITE_URL}/.netlify/functions/weather?icao=${icao}`);
            if (weatherRes.ok) {
                const weatherData = await weatherRes.json();
                if (weatherData.data && weatherData.data.length > 0) {
                     const metar = weatherData.data[0];
                     const flightCategory = metar.flight_category || 'N/A';
                     weatherHtml = `
                        <div class="airport-info-weather">
                            <span class="weather-flight-rules flight-rules-${flightCategory.toLowerCase()}">${flightCategory}</span>
                            <div class="weather-details-grid">
                                <span><i class="fa-solid fa-temperature-half"></i> ${metar.temperature?.celsius || '--'}°C</span>
                                <span><i class="fa-solid fa-droplet"></i> ${metar.dewpoint?.celsius || '--'}°C</span>
                                <span><i class="fa-solid fa-wind"></i> ${metar.wind?.degrees || '---'}° @ ${metar.wind?.speed_kts || '--'} kts</span>
                                <span><i class="fa-solid fa-gauge"></i> ${metar.barometer?.hpa || '----'} hPa</span>
                                <span><i class="fa-solid fa-eye"></i> ${metar.visibility?.miles || '--'} SM</span>
                                <span><i class="fa-solid fa-cloud"></i> ${metar.clouds?.[0]?.text || 'Clear'}</span>
                            </div>
                            <code class="metar-code">${metar.raw_text}</code>
                        </div>
                     `;
                }
            }
        } catch (err) {
            console.error(`Could not fetch weather for ${icao}:`, err);
            weatherHtml = '<div class="airport-info-weather"><p>Weather data unavailable.</p></div>';
        }

        // If there's no data at all (besides weather), don't show a popup
        if (atcForAirport.length === 0 && notamsForAirport.length === 0 && routesFromAirport.length === 0) {
            return null;
        }

        let atcHtml = '<p class="muted-text">No active ATC reported.</p>';
        if (atcForAirport.length > 0) {
            atcHtml = `
                <ul class="atc-frequencies">
                    ${atcForAirport.map(f => `
                        <li class="atc-frequency-item">
                            <span class="freq-type">${atcTypeToString(f.type)}:</span>
                            <span class="freq-user">${f.username || 'N/A'}</span>
                            <span class="freq-time">${formatAtcDuration(f.startTime)}</span>
                        </li>
                    `).join('')}
                </ul>
            `;
        }

        let notamsHtml = '<p class="muted-text">No active NOTAMs.</p>';
        if (notamsForAirport.length > 0) {
            notamsHtml = `
                <ul class="notam-list">
                    ${notamsForAirport.map(n => `<li>${n.message}</li>`).join('')}
                </ul>
            `;
        }
        
        let routesHtml = '<p class="muted-text">No departing routes from this airport in our database.</p>';
        if (routesFromAirport.length > 0) {
            routesHtml = `
                <ul class="popup-routes-list">
                    ${routesFromAirport.map(route => {
                        const airlineCode = extractAirlineCode(route.flightNumber);
                        const logoPath = airlineCode ? `Images/vas/${airlineCode}.png` : '';
                        const aircraftInfo = AIRCRAFT_SELECTION_LIST.find(ac => ac.value === route.aircraft);
                        const aircraftName = aircraftInfo ? aircraftInfo.name : route.aircraft;
                        const aircraftImagePath = `Images/planesForCC/${route.aircraft}.png`;
                        
                        const routeDataString = JSON.stringify(route).replace(/'/g, "&apos;");

                        return `
                        <li class="popup-route-item">
                            <div class="route-item-header">
                                <div class="route-item-info">
                                    <img src="${logoPath}" class="route-item-airline-logo" alt="${airlineCode}" onerror="this.style.display='none'">
                                    <div class="route-item-flight-details">
                                        <span class="flight-number">${route.flightNumber}</span>
                                        <span class="destination">to ${route.arrival}</span>
                                    </div>
                                </div>
                                <div class="route-item-actions">
                                     <button class="cta-button plan-flight-from-explorer-btn" data-route='${routeDataString}'>Plan</button>
                                </div>
                            </div>
                            <div class="route-item-footer">
                                <div class="route-item-aircraft-info">
                                    <img src="${aircraftImagePath}" class="route-item-aircraft-img" alt="${aircraftName}" onerror="this.style.display='none'">
                                    <span>${aircraftName}</span>
                                </div>
                                ${getRankBadgeHTML(route.rankUnlock || deduceRankFromAircraftFE(route.aircraft), { showImage: true, imageClass: 'roster-req-rank-badge' })}
                            </div>
                        </li>
                        `;
                    }).join('')}
                </ul>
            `;
        }

        return `
            ${weatherHtml}
            <div class="info-window-tabs">
                <button class="info-tab-btn active" data-tab="airport-routes"><i class="fa-solid fa-route"></i> Routes</button>
                <button class="info-tab-btn" data-tab="airport-atc"><i class="fa-solid fa-headset"></i> ATC</button>
                <button class="info-tab-btn" data-tab="airport-notams"><i class="fa-solid fa-triangle-exclamation"></i> NOTAMs</button>
            </div>
            <div id="airport-routes" class="info-tab-content active" style="padding: 20px;">
                ${routesHtml}
            </div>
            <div id="airport-atc" class="info-tab-content" style="padding: 20px;">
                ${atcHtml}
            </div>
            <div id="airport-notams" class="info-tab-content" style="padding: 20px;">
                ${notamsHtml}
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


    // ==========================================================
    // START: SECTOR OPS / ROUTE EXPLORER LOGIC (INTERACTIVE AIRPORT MAP)
    // ==========================================================
    
    // NEW: Function to set up event listeners for the Airport Info Window
    function setupAirportWindowEvents() {
        if (!airportInfoWindow || airportInfoWindow.dataset.eventsAttached === 'true') return;

        const closeBtn = document.getElementById('airport-window-close-btn');
        const hideBtn = document.getElementById('airport-window-hide-btn');

        closeBtn.addEventListener('click', () => {
            airportInfoWindow.classList.remove('visible');
            MobileUIHandler.closeActiveWindow();
            airportInfoWindowRecallBtn.classList.remove('visible');
            clearRouteLayers(); // Closing also clears the map routes
            currentAirportInWindow = null;
        });

        hideBtn.addEventListener('click', () => {
            airportInfoWindow.classList.remove('visible');
            if (currentAirportInWindow) {
                airportInfoWindowRecallBtn.classList.add('visible');
                // Trigger animation by adding and removing the class
                airportInfoWindowRecallBtn.classList.add('palpitate');
                setTimeout(() => {
                    airportInfoWindowRecallBtn.classList.remove('palpitate');
                }, 1000); // Duration of 2 palpitations (0.5s each)
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
    



/**
 * [FIXED] Attaches event listeners to the aircraft info window.
 * Now correctly clears *both* intervals on close/hide to prevent memory leaks.
 */
function setupAircraftWindowEvents() {
    if (!aircraftInfoWindow || aircraftInfoWindow.dataset.eventsAttached === 'true') return;

    aircraftInfoWindow.addEventListener('click', async (e) => {
        const closeBtn = e.target.closest('.aircraft-window-close-btn');
        const hideBtn = e.target.closest('.aircraft-window-hide-btn');
        const tabBtn = e.target.closest('.ac-info-tab-btn');

        // --- Tab Switching Logic (Unchanged) ---
        if (tabBtn) {
            e.preventDefault();
            const tabId = tabBtn.dataset.tab;
            if (!tabId || tabBtn.classList.contains('active')) {
                return;
            }
            const windowContent = tabBtn.closest('.info-window-content');
            if (!windowContent) return;
            tabBtn.closest('.ac-info-window-tabs').querySelector('.ac-info-tab-btn.active')?.classList.remove('active');
            windowContent.querySelector('.ac-tab-pane.active')?.classList.remove('active');
            tabBtn.classList.add('active');
            const newPane = windowContent.querySelector(`#${tabId}`);
            
            if (newPane) {
                newPane.classList.add('active');
            }
            if (tabId === 'ac-tab-pilot-report') {
                const statsDisplay = newPane.querySelector('#pilot-stats-display');
                if (statsDisplay && statsDisplay.innerHTML.trim() === '') { 
                    const userId = tabBtn.dataset.userId;
                    const username = tabBtn.dataset.username;
                    if (userId) {
                        await displayPilotStats(userId, username); 
                    }
                }
            }
        }

        // --- [FIXED] Close/Hide Logic ---
        if (closeBtn) {
            aircraftInfoWindow.classList.remove('visible');
            MobileUIHandler.closeActiveWindow();
            aircraftInfoWindowRecallBtn.classList.remove('visible');
            
            clearLiveFlightPath(currentFlightInWindow); 
            
            // --- [CRITICAL FIX] Clear BOTH intervals ---
            if (activePfdUpdateInterval) clearInterval(activePfdUpdateInterval);
            if (activeGeocodeUpdateInterval) clearInterval(activeGeocodeUpdateInterval);
            activePfdUpdateInterval = null;
            activeGeocodeUpdateInterval = null;
            currentAircraftPositionForGeocode = null;
            // --- [END FIX] ---
            
            liveTrailCache.delete(currentFlightInWindow);
            currentFlightInWindow = null;
            cachedFlightDataForStatsView = { flightProps: null, plan: null };
        }

        if (hideBtn) {
            aircraftInfoWindow.classList.remove('visible');
            clearLiveFlightPath(currentFlightInWindow);

            // --- [CRITICAL FIX] Clear BOTH intervals ---
            if (activePfdUpdateInterval) clearInterval(activePfdUpdateInterval);
            if (activeGeocodeUpdateInterval) clearInterval(activeGeocodeUpdateInterval);
            activePfdUpdateInterval = null;
            activeGeocodeUpdateInterval = null;
            // --- [END FIX] ---
            
            if (currentFlightInWindow) {
                aircraftInfoWindowRecallBtn.classList.add('visible', 'palpitate');
                setTimeout(() => aircraftInfoWindowRecallBtn.classList.remove('palpitate'), 1000);
            }
        }
    });

    // The recall button logic remains the same.
    aircraftInfoWindowRecallBtn.addEventListener('click', () => {
        if (currentFlightInWindow) {
            const layer = sectorOpsMap.getLayer('sector-ops-live-flights-layer');
            if (layer) {
                const source = sectorOpsMap.getSource('sector-ops-live-flights-source');
                const features = source._data.features;
                const feature = features.find(f => f.properties.flightId === currentFlightInWindow);
                if (feature) {
                    const props = feature.properties;
                    // --- [FIX] Re-parse position from stringified properties ---
                    const flightProps = { ...props, position: JSON.parse(props.position), aircraft: JSON.parse(props.aircraft) };
                    
                    fetch('https://site--acars-backend--6dmjph8ltlhv.code.run/if-sessions').then(res => res.json()).then(data => {
                        const expertSession = data.sessions.find(s => s.name.toLowerCase().includes('expert'));
                        if(expertSession) {
                            handleAircraftClick(flightProps, expertSession.id);
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



async function initializeSectorOpsView() {
    // const selector = document.getElementById('departure-hub-selector'); // <-- REMOVED
    const mapContainer = document.getElementById('sector-ops-map-fullscreen');
    // const viewContainer = document.getElementById('view-rosters'); // <-- REMOVED
    
    // --- [FIX] Changed viewContainer to mapContainer and removed !selector check ---
    const viewContainer = document.getElementById('standalone-map-view'); // Use the correct ID from your HTML
    if (!viewContainer || !mapContainer) return; // Modified check
    
    mainContentLoader.classList.add('active');

    try {
        // --- [NEW] Inject the Search Bar ---
        if (!document.getElementById('sector-ops-search-container')) {
            // ... (search bar HTML unchanged) ...
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
            // --- [FIX] Changed viewContainer to mapContainer ---
            mapContainer.insertAdjacentHTML('beforeend', searchHtml);
        }

        // ... (Airport & Aircraft window HTML unchanged) ...
        if (!document.getElementById('airport-info-window')) {
             const windowHtml = `
                <div id="airport-info-window" class="info-window">
                    <div class="info-window-header">
                        <h3 id="airport-window-title"></h3>
                        <div class="info-window-actions">
                            <button id="airport-window-hide-btn" title="Hide"><i class="fa-solid fa-compress"></i></button>
                            <button id="airport-window-close-btn" title="Close"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                    </div>
                    <div id="airport-window-content" class="info-window-content"></div>
                </div>
            `;
            // --- [FIX] Changed viewContainer to mapContainer ---
            mapContainer.insertAdjacentHTML('beforeend', windowHtml);
        }
        if (!document.getElementById('aircraft-info-window')) {
             const windowHtml = `
                <div id="aircraft-info-window" class="info-window">
                    
                </div>
            `;
            // --- [FIX] Changed viewContainer to mapContainer ---
            mapContainer.insertAdjacentHTML('beforeend', windowHtml);
        }
        if (!document.getElementById('weather-settings-window')) {
            // ... (Weather window HTML unchanged) ...
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
            // --- [FIX] Changed viewContainer to mapContainer ---
            mapContainer.insertAdjacentHTML('beforeend', windowHtml);
        }

        // --- [MODIFIED FILTER WINDOW INJECTION] ---
        if (!document.getElementById('filter-settings-window')) {
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
                        </div>
                </div>
            `;
            // --- [FIX] Changed viewContainer to mapContainer ---
            mapContainer.insertAdjacentHTML('beforeend', windowHtml);
        }
        // --- [END MODIFIED FILTER WINDOW INJECTION] ---
        
        // ... (Rest of the function is unchanged) ...
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
        
        airportInfoWindow = document.getElementById('airport-info-window');
        airportInfoWindowRecallBtn = document.getElementById('airport-recall-btn');
        aircraftInfoWindow = document.getElementById('aircraft-info-window');
        aircraftInfoWindowRecallBtn = document.getElementById('aircraft-recall-btn');
        weatherSettingsWindow = document.getElementById('weather-settings-window');
        filterSettingsWindow = document.getElementById('filter-settings-window');

        // 2. [REMOVED] Hub selector population ---
        const selectedHub = "VIDP"; // <-- Hard-coded a default hub for the map

        // 3. Initialize the Mapbox map
        await initializeSectorOpsMap(selectedHub);

        // 4. [MODIFIED] Fetch panel content instead of routes/rosters ---
        await loadExternalPanelContent();

        // 5. Set up all event listeners
        setupSectorOpsEventListeners();
        setupAirportWindowEvents();
        setupAircraftWindowEvents();
        setupWeatherSettingsWindowEvents();
        setupFilterSettingsWindowEvents(); 
        setupSearchEventListeners();

        // 6. Start the live data loop.
        startSectorOpsLiveLoop();

    } catch (error) {
        console.error("Error initializing Sector Ops view:", error);
        showNotification(error.message, 'error');
        // Handle error display in the new panel if needed
        const panelContentWrapper = document.querySelector('#sector-ops-floating-panel .panel-content-wrapper');
        if (panelContentWrapper) {
            panelContentWrapper.innerHTML = `<p class="error-text" style="padding: 20px;">${error.message}</p>`;
        }
    } finally {
        mainContentLoader.classList.remove('active');
    }
}


async function initializeSectorOpsMap(centerICAO) {
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
     * --- [NEW] Extracted function to set up base layers.
     * This is called on initial load AND on every style change.
     * --- [MODIFIED] Added text labels for callsign and phase.
     * --- [MODIFIED v2] Split icons and labels into two layers
     * to allow icons to always show while labels can hide.
     */
    async function setupMapLayersAndFog() {
        // 1. Set globe fog (Unchanged)
        sectorOpsMap.setFog({
            color: 'rgb(186, 210, 235)', // Lower atmosphere
            'high-color': 'rgb(36, 92, 223)', // Upper atmosphere
            'horizon-blend': 0.02, // Smooth blend
            'space-color': 'rgb(11, 11, 25)', // Space color
            'star-intensity': 0.6 // Adjust star intensity
        });

        // 2. Load all aircraft icons (Unchanged)
        const iconsToLoad = [
            // Regular (Default)
            { id: 'icon-jumbo', path: '/Images/map_icons/jumbo.png' },
            { id: 'icon-widebody', path: '/Images/map_icons/widebody.png' },
            { id: 'icon-narrowbody', path: '/Images/map_icons/narrowbody.png' },
            { id: 'icon-regional', path: '/Images/map_icons/regional.png' },
            { id: 'icon-private', path: '/Images/map_icons/private.png' },
            { id: 'icon-fighter', path: '/Images/map_icons/fighter.png' },
            { id: 'icon-default', path: '/Images/map_icons/default.png' },
            { id: 'icon-military', path: '/Images/map_icons/military.png' },
            { id: 'icon-cessna', path: '/Images/map_icons/cessna.png' },
            
            // --- MODIFICATION: Changed 'red' to 'orange' ---
            { id: 'icon-jumbo-orange', path: '/Images/map_icons/orange/jumbo.png' },
            { id: 'icon-widebody-orange', path: '/Images/map_icons/orange/widebody.png' },
            { id: 'icon-narrowbody-orange', path: '/Images/map_icons/orange/narrowbody.png' },
            { id: 'icon-regional-orange', path: '/Images/map_icons/orange/regional.png' },
            { id: 'icon-private-orange', path: '/Images/map_icons/orange/private.png' },
            { id: 'icon-fighter-orange', path: '/Images/map_icons/orange/fighter.png' },
            { id: 'icon-default-orange', path: '/Images/map_icons/orange/default.png' },
            { id: 'icon-military-orange', path: '/Images/map_icons/orange/military.png' },
            { id: 'icon-cessna-orange', path: '/Images/map_icons/orange/cessna.png' },

            // --- MODIFICATION: Renamed 'staff' to 'blue' ---
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
                // Check if image already exists (Mapbox preserves images across style loads)
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
        console.log('All custom aircraft icons are ready.');

        // 3. Add base flight data source (Unchanged)
        if (!sectorOpsMap.getSource('sector-ops-live-flights-source')) {
            sectorOpsMap.addSource('sector-ops-live-flights-source', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: Object.values(currentMapFeatures) } // Use current state
            });
        }

        mapAnimator = new MapAnimator(sectorOpsMap, 'sector-ops-live-flights-source', currentMapFeatures);

        // 4. --- [START OF MODIFICATION] ---
        // Add the ICON layer
        if (!sectorOpsMap.getLayer('sector-ops-live-flights-layer')) {
            sectorOpsMap.addLayer({
                id: 'sector-ops-live-flights-layer', // Keep original ID for click listeners
                type: 'symbol',
                source: 'sector-ops-live-flights-source',
                layout: {
                    // --- Icon Properties ONLY ---
                    'icon-image': getIconImageExpression(mapFilters.iconColorMode),
                    'icon-size': 0.08,
                    'icon-rotate': ['get', 'heading'],
                    'icon-rotation-alignment': 'map',
                    
                    // --- THIS IS THE KEY ---
                    // Force icons to always show, even if they overlap
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,

                    // --- Remove all text properties ---
                    // 'text-field': ... (REMOVED)
                    // 'text-font': ... (REMOVED)
                    // etc.
                }
                // --- No 'paint' block needed (it was only for text) ---
            });

            // 4a. Add click/hover listeners (These will now only apply to the icon layer)
            sectorOpsMap.on('click', 'sector-ops-live-flights-layer', (e) => {
                const props = e.features[0].properties;
                const flightProps = { ...props, position: JSON.parse(props.position), aircraft: JSON.parse(props.aircraft) };
                fetch('https://site--acars-backend--6dmjph8ltlhv.code.run/if-sessions').then(res => res.json()).then(data => {
                    const expertSession = data.sessions.find(s => s.name.toLowerCase().includes('expert'));
                    if (expertSession) {
                        handleAircraftClick(flightProps, expertSession.id);
                    }
                });
            });
            sectorOpsMap.on('mouseenter', 'sector-ops-live-flights-layer', () => { sectorOpsMap.getCanvas().style.cursor = 'pointer'; });
            sectorOpsMap.on('mouseleave', 'sector-ops-live-flights-layer', () => { sectorOpsMap.getCanvas().style.cursor = ''; });
        }
        
        // 5. Add the LABEL layer
        if (!sectorOpsMap.getLayer('sector-ops-live-flights-labels')) {
            sectorOpsMap.addLayer({
                id: 'sector-ops-live-flights-labels',
                type: 'symbol',
                source: 'sector-ops-live-flights-source', // Use the SAME source
                
                // ##### PERFORMANCE FIX START #####
                // By setting a minzoom, we prevent Mapbox from trying to
                // calculate label collisions for all aircraft on the map
                // when zoomed out, which is the cause of the lag.
                //
                // ##### THIS IS THE FIX (Removed the asterisks) #####
                minzoom: 6.5, 
                // ##### PERFORMANCE FIX END #####

                layout: {
                    // ##### MODIFICATION START #####
                    'visibility': mapFilters.showAircraftLabels ? 'visible' : 'none',
                    // ##### MODIFICATION END #####

                    // --- [MODIFICATION START] ---
                    // Use a 'format' expression to set colors per line
                    'text-field': [
                        'format',
                        // Part 1: Callsign (White)
                        ['get', 'callsign'], 
                        { 'text-color': '#FFFFFF' }, 
                        
                        // Part 2: Newline
                        '\n',                
                        {},                  
                        
                        // Part 3: Phase (Color-coded)
                        ['get', 'phase'],    
                        { 
                            'text-color': [ 
                                'match',
                                ['get', 'phase'],
                                'Climb', '#28a745',     // Green
                                'Cruise', '#007bff',    // Blue
                                'Descent', '#ff9900',   // Orange
                                'Approach', '#a33ea3',  // Purple
                                'Ground', '#9fa8da',    // Muted Grey
                                '#e8eaf6' // Default (for Enroute etc.)
                            ]
                        }
                    ],
                    // --- [MODIFICATION END] ---

                    'text-font': ['Mapbox Txt Regular', 'Arial Unicode MS Regular'],
                    'text-size': 10,
                    'text-offset': [0, 2.5], // Offset text below the icon
                    'text-anchor': 'top',
                    
                    'text-allow-overlap': false,
                    'text-ignore-placement': false,

                    // --- [NEW] ---
                    'text-padding': 3, // Add padding *inside* the background box
                },
                paint: {
                    // --- [MODIFICATION START] ---
                    // 'text-color' is REMOVED (now handled by 'format' in layout)
                    
                    // Use the halo as a solid background
                    'text-halo-color': 'rgba(10, 12, 26, 0.85)', // Dark UI color
                    'text-halo-width': 2, // This creates the box padding effect
                    'text-halo-blur': 0   // This makes the box sharp
                    // --- [MODIFICATION END] ---
                }
            });
        }
        // --- [END OF MODIFICATION] ---
    }
    
    // --- [NEW] This handles style changes ---
    sectorOpsMap.on('style.load', async () => {
        console.log("Map style reloading. Rebuilding layers...");
        await setupMapLayersAndFog(); // Re-add fog, icons, base layer
        rebuildDynamicLayers();     // Re-add weather, routes, trails, filters
    });

    // --- This handles the initial map load ---
    return new Promise(resolve => {
        sectorOpsMap.on('load', async () => {
            await setupMapLayersAndFog(); // Run setup for the first time
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

        // --- [START MODIFICATION] ---
        // Get all layers associated with this flight
        const layers = sectorOpsLiveFlightPathLayers[flightId];
        if (!layers) return;

        // Loop over all layer types (flown, planDirect, planFull) and remove them
        Object.values(layers).forEach(layerId => {
            if (layerId) {
                if (sectorOpsMap.getLayer(layerId)) sectorOpsMap.removeLayer(layerId);
                if (sectorOpsMap.getSource(layerId)) sectorOpsMap.removeSource(layerId);
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
                    'line-opacity': 0.9,
                    
                    // ##### FIX START #####
                    // This is the fix for the "termites" / Z-fighting glitch.
                    // It ensures the line is also rendered correctly after
                    // a map style change (e.g., to Light/Satellite).
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


    /**
     * --- [MODIFIED] Centralized handler for clicking any airport marker.
     * This now opens the persistent info window instead of a popup.
     */
    async function handleAirportClick(icao) {
        if (currentAirportInWindow && currentAirportInWindow !== icao) {
            airportInfoWindow.classList.remove('visible');
            airportInfoWindowRecallBtn.classList.remove('visible');
            clearRouteLayers();
        }

        plotRoutesFromAirport(icao);

        const airport = airportsData[icao];
        if (!airport) return;

        const titleEl = document.getElementById('airport-window-title');
        const contentEl = document.getElementById('airport-window-content');
        
        titleEl.innerHTML = `${icao} <small>- ${airport.name || 'Airport'}</small>`;
        contentEl.innerHTML = `<div class="spinner-small" style="margin: 2rem auto;"></div>`; // Loading state
        
        // --- [FIX] Use the same mobile-aware logic as handleAircraftClick ---
        if (window.MobileUIHandler && window.MobileUIHandler.isMobile()) {
            window.MobileUIHandler.openWindow(airportInfoWindow);
        } else {
            airportInfoWindow.classList.add('visible');
        }
        // --- [END FIX] ---

        airportInfoWindowRecallBtn.classList.remove('visible');
        currentAirportInWindow = icao;

        const windowContentHTML = await createAirportInfoWindowHTML(icao);

        if (windowContentHTML) {
            contentEl.innerHTML = windowContentHTML;
            contentEl.scrollTop = 0;

            // Add event listeners for the new tabs
            const tabContainer = contentEl.querySelector('.info-window-tabs');
            tabContainer.addEventListener('click', (e) => {
                const tabBtn = e.target.closest('.info-tab-btn');
                if (!tabBtn) return;
                
                tabContainer.querySelector('.active').classList.remove('active');
                contentEl.querySelector('.info-tab-content.active').classList.remove('active');

                tabBtn.classList.add('active');
                contentEl.querySelector(`#${tabBtn.dataset.tab}`).classList.add('active');
            });
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
 * --- [NEW HELPER] Generates an altitude-segmented GeoJSON FeatureCollection for the flown route.
 * Breaks the route into segments, each with an 'avgAltitude' property for color-coding.
 *
 * --- [FIXED] This version now includes longitude "unwrapping" logic to prevent
 * the flight path from lapping around the globe when it crosses the antimeridian.
 *
 * @param {Array} sortedPoints - Array of historical route point objects.
 * @param {object} currentPosition - The aircraft's current position object.
 * @returns {object} A GeoJSON FeatureCollection.
 */
function generateAltitudeColoredRoute(sortedPoints, currentPosition) {
    const features = [];
    
    // 1. Create a single array of all points (as before)
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

    // 2. Create a new array of "unwrapped" points
    const unwrappedPoints = [];
    
    // Get the first valid longitude as the starting point
    let firstValidIndex = allPoints.findIndex(p => p.longitude != null);
    if (firstValidIndex === -1) {
        // No valid points at all
        return { type: 'FeatureCollection', features: [] };
    }
    
    let prevLon = allPoints[firstValidIndex].longitude;

    // Add all points up to the first valid one as-is
    for (let i = 0; i <= firstValidIndex; i++) {
        unwrappedPoints.push({
            ...allPoints[i],
            unwrappedLongitude: allPoints[i].longitude
        });
    }

    // Start unwrapping from the point *after* the first valid one
    for (let i = firstValidIndex + 1; i < allPoints.length; i++) {
        const currentPoint = allPoints[i];
        let currentLon = currentPoint.longitude;

        // --- START OF LONGITUDE WRAP FIX ---
        if (currentLon == null || prevLon == null) {
            // Can't unwrap if data is missing, just add the point
            unwrappedPoints.push({
                ...currentPoint,
                unwrappedLongitude: currentLon
            });
            prevLon = currentLon; // Update prevLon even if it's null
            continue;
        }

        const dLon = currentLon - prevLon;

        if (dLon > 180) {
            // Aircraft moved West across the antimeridian (e.g., -179.9 -> 179.9)
            // But calculation is (179.9 - (-179.9)) = 359.8
            // We subtract 360 from the current longitude.
            currentLon -= 360; 
        } else if (dLon < -180) {
            // Aircraft moved East across the antimeridian (e.g., 179.9 -> -179.9)
            // Calculation is (-179.9 - 179.9) = -359.8
            // We add 360 to the current longitude.
            currentLon += 360;
        }
        // --- END OF LONGITUDE WRAP FIX ---
        
        unwrappedPoints.push({
            ...currentPoint,
            unwrappedLongitude: currentLon // Store the new unwrapped value
        });
        
        // The *unwrapped* longitude becomes the new "previous"
        prevLon = currentLon; 
    }

    // 3. Generate features using the "unwrapped" points
    for (let i = 0; i < unwrappedPoints.length - 1; i++) {
        const p1 = unwrappedPoints[i];
        const p2 = unwrappedPoints[i+1];

        // Skip segments with invalid data
        if (!p1 || !p2 || p1.unwrappedLongitude == null || p1.latitude == null || p2.unwrappedLongitude == null || p2.latitude == null) {
            continue;
        }

        // Use the unwrappedLongitude for drawing
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
                avgAltitude: avgAltitude
            }
        });
    }

    return { type: 'FeatureCollection', features: features };
}



async function handleAircraftClick(flightProps, sessionId) {
    if (!flightProps || !flightProps.flightId) return;

    // [RESILIENCE] Prevent new clicks if one is already loading
    if (isAircraftWindowLoading) {
        console.warn("Aircraft click ignored: window is already loading.");
        return;
    }

    // [ORIGINAL] Prevent re-opening an already open window.
    if (currentFlightInWindow === flightProps.flightId && aircraftInfoWindow.classList.contains('visible')) {
        return;
    }

    // [RESILIENCE] Set loading flag *after* initial checks
    isAircraftWindowLoading = true;

    // --- [MODIFIED] Clear ALL existing intervals *first*. ---
    if (activePfdUpdateInterval) {
        clearInterval(activePfdUpdateInterval);
        activePfdUpdateInterval = null;
    }
    if (activeGeocodeUpdateInterval) {
        clearInterval(activeGeocodeUpdateInterval);
        activeGeocodeUpdateInterval = null;
    }
    // --- [END MODIFIED] ---

    resetPfdState();

    // [ORIGINAL] Clear previous flight's path
    if (currentFlightInWindow && currentFlightInWindow !== flightProps.flightId) {
        clearLiveFlightPath(currentFlightInWindow);
        // --- [NEW] ---
        // Clean up the cache for the *previous* flight
        liveTrailCache.delete(currentFlightInWindow);
    }

    // --- [MODIFIED] Set state for BOTH intervals ---
    currentFlightInWindow = flightProps.flightId; // Set state
    currentAircraftPositionForGeocode = flightProps.position; // NEW
    lastGeocodeCoords = { lat: 0, lon: 0 }; // NEW: Reset distance check
    cachedFlightDataForStatsView = { flightProps: null, plan: null }; // Clear cache
    // --- [END MODIFIED] ---

    // [ORIGINAL] Show loading state
    if (window.MobileUIHandler && window.MobileUIHandler.isMobile()) {
        window.MobileUIHandler.openWindow(aircraftInfoWindow);
    } else {
        aircraftInfoWindow.classList.add('visible');
    }
    aircraftInfoWindowRecallBtn.classList.remove('visible');
    
    const windowEl = document.getElementById('aircraft-info-window');
    windowEl.innerHTML = `<div class="spinner-small" style="margin: 2rem auto;"></div><p style="text-align: center;">Loading flight data...</p>`;

    try {
        // --- [NEW] Define the layer ID for the flown path ---
        const flownLayerId = `flown-path-${flightProps.flightId}`;
        
        const [planRes, routeRes] = await Promise.all([
            fetch(`${LIVE_FLIGHTS_API_URL}/${sessionId}/${flightProps.flightId}/plan`),
            fetch(`${LIVE_FLIGHTS_API_URL}/${sessionId}/${flightProps.flightId}/route`)
        ]);
        
        const planData = planRes.ok ? await planRes.json() : null;
        const plan = (planData && planData.ok) ? planData.plan : null;
        const routeData = routeRes.ok ? await routeRes.json() : null;
        
        let sortedRoutePoints = [];
        if (routeData && routeData.ok && Array.isArray(routeData.route) && routeData.route.length > 0) {
            sortedRoutePoints = routeData.route.sort((a, b) => {
                const timeA = a.date ? new Date(a.date).getTime() : 0;
                const timeB = b.date ? new Date(b.date).getTime() : 0;
                return timeA - timeB;
            });
        }
        
        // ⬇️ === NEW: SEED THE CACHE === ⬇️
        // This saves the historical data as the starting point for our trail
        liveTrailCache.set(flightProps.flightId, sortedRoutePoints);
        // ⬆️ === END NEW === ⬆️

        // NEW: Cache data for stats view
        cachedFlightDataForStatsView = { flightProps, plan };
        
        // Pass the *initial* historical route data to the info window builder
        populateAircraftInfoWindow(flightProps, plan, sortedRoutePoints);
        
        // --- [NEW] Perform the *first* geocode call immediately ---
        fetchAndDisplayGeocode(flightProps.position.lat, flightProps.position.lon);

        // --- [NEW] Generate the initial altitude-colored route ---
        const routeFeatureCollection = generateAltitudeColoredRoute(sortedRoutePoints, flightProps.position);

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
                        0,     '#e6e600', // Yellow (Ground / Low)
                        10000, '#ff9900', // Orange (Climb)
                        20000, '#ff3300', // Red (Mid-Climb)
                        29000, '#00BFFF', // Blue (Cruise)
                        38000, '#9400D3'  // Purple (High Cruise)
                    ],
                    'line-width': 4,
                    'line-opacity': 0.9,
                    
                    // ##### FIX START #####
                    // This is the fix for the "termites" / Z-fighting glitch.
                    // It offsets the line 2 pixels "up" (toward the camera)
                    // relative to the viewport, ensuring it always wins
                    // the 3D rendering fight against the map's surface.
                    'line-translate': [0, -2],
                    'line-translate-anchor': 'viewport'
                    // ##### FIX END #####
                }
            }, 'sector-ops-live-flights-layer'); // Ensure it's drawn below aircraft
        } else {
            // Source already exists, just update its data
             sectorOpsMap.getSource(flownLayerId).setData(routeFeatureCollection);
        }

        // --- [NEW] Store layer ID for live updates ---
        sectorOpsLiveFlightPathLayers[flightProps.flightId] = {
            flown: flownLayerId
        };
        
        // --- [REMOVED] The automatic zoom-to-fit block (`fitBounds`) ---

        // --- [FIX 1 of 2] ---
        // Draw the planned route line (Direct, Full, or None) *immediately*
        // based on the current filter state, instead of waiting for a change.
        if (plan) {
            updateFlightPlanLayer(flightProps.flightId, plan, flightProps.position);
        }
        // --- [END OF FIX 1] ---
        
        // --- [MODIFIED BY USER REQUEST] Start the geocode update interval (5 minutes) ---
        const FIVE_MINUTES_MS = 300000; 
        activeGeocodeUpdateInterval = setInterval(() => {
            if (currentAircraftPositionForGeocode) {
                // This call will use the *latest* position stored by the fast 3-second PFD loop
                fetchAndDisplayGeocode(
                    currentAircraftPositionForGeocode.lat,
                    currentAircraftPositionForGeocode.lon
                );
            }
        }, FIVE_MINUTES_MS); // Call again every 5 minutes
        // --- [END MODIFICATION] ---

        // --- [MODIFIED] ---
        // The interval will NOW re-fetch the route data on every tick.
        activePfdUpdateInterval = setInterval(async () => {
            try {
                // --- [MODIFIED] ---
                // We ONLY fetch the live flights data now.
                const [freshDataRes] = await Promise.all([
                    fetch(`${LIVE_FLIGHTS_API_URL}/${sessionId}`), // Live position
                    // The 'routeRes' fetch has been REMOVED.
                ]);


                if (!freshDataRes.ok) throw new Error("Flight data update failed.");
                
                const allFlights = await freshDataRes.json();
                const updatedFlight = allFlights.flights.find(f => f.flightId === flightProps.flightId);

                // --- [MODIFIED] ---
                // Get the trail from our local cache.
                const localTrail = liveTrailCache.get(flightProps.flightId);
                if (!localTrail) {
                    // This can happen if the window was closed and re-opened quickly.
                    // We must stop the interval.
                    throw new Error("Local trail cache was lost.");
                }
                // The 'updatedSortedRoutePoints' block has been REMOVED.
                // --- [END MODIFICATION] ---

                if (updatedFlight && updatedFlight.position) {
                    
                    // --- [NEW] Update the shared position variable ---
                    currentAircraftPositionForGeocode = updatedFlight.position;
                    // --- [END NEW] ---

                    // --- Logic to update the info window (Unchanged) ---
                    updatePfdDisplay(updatedFlight.position);
                    
                    // --- [NEW: THE FIX] ---
                    // Convert the new live data to a "route point" format
                    // so it matches the historical data.
                    const newRoutePoint = {
                        latitude: updatedFlight.position.lat,
                        longitude: updatedFlight.position.lon,
                        altitude: updatedFlight.position.alt_ft,
                        groundSpeed: updatedFlight.position.gs_kt,
                        track: updatedFlight.position.heading_deg, // Use heading_deg
                        date: new Date(updatedFlight.position.lastReport || Date.now()).toISOString()
                    };
                    
                    // Add this new, high-resolution point to our local trail
                    localTrail.push(newRoutePoint);
                    // Update the cache with the new, longer trail
                    liveTrailCache.set(flightProps.flightId, localTrail);
                    // --- [END NEW] ---
                    
                    // Pass the NEWLY fetched *and grown* local trail
                    updateAircraftInfoWindow(updatedFlight, plan, localTrail);
                    
                    // --- [NEW] Live update for the 2D altitude-colored trail ---
                    const layerId = sectorOpsLiveFlightPathLayers[flightProps.flightId]?.flown;
                    const source = layerId ? sectorOpsMap.getSource(layerId) : null;
                    
                    if (source) {
                        // Pass the *updated* local trail to the map drawing function
                        const newRouteData = generateAltitudeColoredRoute(localTrail, updatedFlight.position);
                        source.setData(newRouteData);
                    }
                    // --- [END NEW] ---

                    // --- [FIX 2 of 2] ---
                    // Live-update the planned layer. This is essential for the
                    // "Direct to Destination" line to follow the aircraft.
                    // We only run it if the mode is 'direct' to save resources.
                    if (plan && mapFilters.planDisplayMode === 'direct') {
                        updateFlightPlanLayer(flightProps.flightId, plan, updatedFlight.position);
                    }
                    // --- [END OF FIX 2] ---

                } else {
                    // Flight no longer found, stop the interval
                    clearInterval(activePfdUpdateInterval);
                    activePfdUpdateInterval = null;
                    // --- [NEW] Stop geocode interval too ---
                    if (activeGeocodeUpdateInterval) clearInterval(activeGeocodeUpdateInterval);
                    activeGeocodeUpdateInterval = null;
                    
                    // --- [NEW] ---
                    // Clean up the cache for this flight
                    liveTrailCache.delete(flightProps.flightId);
                    // --- [END NEW] ---
                }
            } catch (error) {
                console.error("Stopping PFD update due to error:", error);
                clearInterval(activePfdUpdateInterval);
                activePfdUpdateInterval = null;
                // --- [NEW] Stop geocode interval too ---
                if (activeGeocodeUpdateInterval) clearInterval(activeGeocodeUpdateInterval);
                activeGeocodeUpdateInterval = null;

                // --- [NEW] ---
                // Clean up the cache for this flight
                liveTrailCache.delete(flightProps.flightId);
                // --- [END NEW] ---
            }
        }, 3000); // 3000ms is a good, fast interval

        // [RESILIENCE] Unset loading flag on success
        isAircraftWindowLoading = false;

    } catch (error) {
        console.error("Error fetching or plotting aircraft details:", error);
        windowEl.innerHTML = `<p class="error-text" style="padding: 2rem;">Could not retrieve complete flight details. The aircraft may have landed or disconnected.</p>`;
        
        // [RESILIENCE & CRITICAL] Reset state on failure
        isAircraftWindowLoading = false; 
        currentFlightInWindow = null; 
        cachedFlightDataForStatsView = { flightProps: null, plan: null };
        // --- [NEW] Clean up the cache ---
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
                    'line-opacity': 0.9,
                    
                    // ##### FIX START #####
                    // This is the fix for the "termites" / Z-fighting glitch.
                    // It ensures the line is also rendered correctly after
                    // a map style change (e.g., to Light/Satellite).
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



function populateAircraftInfoWindow(baseProps, plan, sortedRoutePoints) { // <-- MODIFIED: Added 3rd arg
    const windowEl = document.getElementById('aircraft-info-window');

    // --- Get Aircraft & Route Data ---
    const aircraftName = baseProps.aircraft?.aircraftName || 'Unknown Type';
    const airlineName = baseProps.aircraft?.liveryName || 'Generic Livery';

    const allWaypoints = [];
    if (plan && plan.flightPlanItems) {
        const extractWps = (items) => {
            for (const item of items) {
                if (item.location && (item.location.latitude !== 0 || item.location.longitude !== 0)) { allWaypoints.push(item); }
                if (Array.isArray(item.children)) { extractWps(item.children); }
            }
        };
        extractWps(plan.flightPlanItems);
    }
    const hasPlan = allWaypoints.length >= 2;
    const departureIcao = hasPlan ? allWaypoints[0]?.name : 'N/A';
    const arrivalIcao = hasPlan ? allWaypoints[allWaypoints.length - 1]?.name : 'N/A';

    // --- [NEW] Get Airline Logo (REVISED with new rules) ---
    const liveryName = baseProps.aircraft?.liveryName || '';
    const words = liveryName.trim().split(/\s+/); // Split by one or more spaces
    let logoName = '';
    const specialCharRegex = /[^a-zA-Z0-9]/; // Regex to find any non-alphanumeric character

    if (words.length === 1) {
        // Rule 2: Only one thing, take it. (e.g., "Generic")
        logoName = words[0];
    } else if (words.length > 1) {
        const firstWord = words[0];
        const secondWord = words[1];

        // Rule 3: Check if the second word contains special characters (e.g., "(6E)")
        if (specialCharRegex.test(secondWord)) {
            // It's a special word, so "just keep the first thing"
            logoName = firstWord; // e.g., "IndiGo"
        } else {
            // Rule 1: Second word is clean, take the first two. (e.g., "El Al", "Delta Air")
            logoName = `${firstWord} ${secondWord}`;
        }
    }

    // Sanitize the final result for the filename
    const sanitizedLogoName = logoName
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '') // Remove any remaining special chars
        .replace(/\s+/g, '_'); // Replace spaces with underscores

    // The path is still 'Images/airline_logos/'
    const logoPath = sanitizedLogoName ? `Images/airline_logos/${sanitizedLogoName}.png` : '';
    const logoHtml = logoPath ? `<img src="${logoPath}" alt="${liveryName}" class="ac-header-logo" onerror="this.style.display='none'">` : '';
    // --- End [NEW] ---

    // --- [YOUR FIX] ---
    // We set no image initially. The 'updateAircraftInfoWindow' function
    // (called immediately after) will handle loading the correct image.
    // This prevents the "flash" of the default image.
    const tempBg = ``;
    // --- [END FIX] ---
    
    // --- [MODIFIED - YOUR FIX] Get Actual Departure Time and clear initial ETA ---
    const atdTimestamp = (sortedRoutePoints && sortedRoutePoints.length > 0) ? sortedRoutePoints[0].date : null;
    const atdTime = atdTimestamp ? formatTimeFromTimestamp(atdTimestamp) : '--:--'; // This is now ATD
    const etaTime = '--:--'; // ETA will be calculated live
    // --- [END FIX] ---

    // --- [FIX v11] ---
    // Get country code from our own airportsData using the ICAO, not the plan object.
    const depCountryCode = airportsData[departureIcao]?.country ? airportsData[departureIcao].country.toLowerCase() : '';
    const arrCountryCode = airportsData[arrivalIcao]?.country ? airportsData[arrivalIcao].country.toLowerCase() : '';
    // --- [END FIX v11] ---

    const depFlagSrc = depCountryCode ? `https://flagcdn.com/w20/${depCountryCode}.png` : '';
    const arrFlagSrc = arrCountryCode ? `https://flagcdn.com/w20/${arrCountryCode}.png` : '';
    const depFlagDisplay = depCountryCode ? 'block' : 'none';
    const arrFlagDisplay = arrCountryCode ? 'block' : 'none';
    // --- [END NEW] ---

    windowEl.innerHTML = `
    <div class="info-window-content">
        <div class="aircraft-overview-panel" id="ac-overview-panel" style="${tempBg}">
            
            <div class="overview-actions">
                <button class="aircraft-window-hide-btn" title="Hide"><i class="fa-solid fa-compress"></i></button>
                <button class="aircraft-window-close-btn" title="Close"><i class="fa-solid fa-xmark"></i></button>
            </div>

            <div class="overview-content">
                <div class="overview-col-left">
                    <h3 id="ac-header-callsign">${logoHtml}${baseProps.callsign}</h3>
                    
                    <p id="ac-header-subtext-container">
                        <span class="ac-header-subtext" id="ac-header-username">${baseProps.username || 'N/A'}</span>
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
                <button class="ac-info-tab-btn" data-tab="ac-tab-pilot-report" data-user-id="${baseProps.userId}" data-username="${baseProps.username || 'N/A'}">
                    <i class="fa-solid fa-chart-simple"></i> Pilot Report
                </button>
            </div>
            
            <img src="Images/inflight.png" alt="Inflight Logo" class="ac-info-tab-logo">
        </div>
        <div class="unified-display-main-content">
            
            <div id="ac-tab-flight-data" class="ac-tab-pane active">
                
                <div class="pfd-and-location-grid">
                
                    <div class="pfd-main-panel">
                        <div id="pfd-container">
                            <svg width="787" height="635" viewBox="0 30 787 665" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <g id="PFD" clip-path="url(#clip0_1_2890)">
                                <g id="attitude_group">
                                    <rect id="Sky" x="-186" y="-222" width="1121" height="532" fill="#0596FF"/>
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
                                <svg x="675" y="73" width="72" height="476"><g id="altitude_tape_group"></g></svg>
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
                                <svg x="28" y="73" width="97" height="477"><g id="speed_tape_group"></g></svg>
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
                            <defs>
                                <clipPath id="clip0_1_2890"><rect width="787" height="695" fill="white"/></clipPath>
                                <clipPath id="tensReelClip"><rect x="732" y="269" width="50" height="75"/></clipPath>
                                <clipPath id="headingClip"><rect x="243" y="620" width="326" height="45"/></clipPath>
                            </defs>
                            </svg>
                        </div>
                    </div>
                    
                    <div id="location-data-panel" class="data-bar-item">
                        <span class="data-label">CURRENTLY OVER</span>
                        <span class="data-value" id="ac-location">---</span>
                    </div>
                
                </div>
                <div class="flight-data-bar">
                    <div class="data-bar-item">
                        <span class="data-label">NEXT WP</span>
                        <span class="data-value" id="ac-next-wp">---</span>
                    </div>
                    <div class="data-bar-item">
                        <span class="data-label">DIST. TO WP</span>
                        <span class="data-value" id="ac-next-wp-dist">--.-<span class="unit">NM</span></span>
                    </div>
                    <div class="data-bar-item">
                        <span class="data-label">DIST. TO DEST.</span>
                        <span class="data-value" id="ac-dist">---<span class="unit">NM</span></span>
                    </div>
                    <div class="data-bar-item">
                        <span class="data-label">ETE TO DEST.</span>
                        <span class="data-value" id="ac-ete">--:--</span>
                    </div>
                    <div class="data-bar-item">
                        <span class="data-label">VERTICAL SPEED</span>
                        <span class="data-value" id="ac-vs">---<span class="unit">fpm</span></span>
                    </div>
                    </div>
                
                <div class="ac-profile-card-new">
                    <h4>Vertical Profile</h4>
                    <div id="vsd-panel" class="vsd-panel" data-plan-id="" data-profile-built="false">
                        <div id="vsd-graph-window" class="vsd-graph-window">
                            <div id="vsd-aircraft-icon"></div>
                            <div id="vsd-graph-content">
                                <svg id="vsd-profile-svg" xmlns="http://www.w3.org/2000/svg">
                                    <path id="vsd-flown-path" d="" />
                                    <path id="vsd-profile-path" d="" />
                                </svg>
                                <div id="vsd-waypoint-labels"></div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="vsd-disclaimer">
                    <div class="disclaimer-legend">
                        <span><i class="fa-solid fa-circle" style="color: #00a8ff;"></i> Planned FPL</span>
                        <span><i class="fa-solid fa-circle" style="color: #dc3545;"></i> Flown Route</span>
                    </div>
                    <p><i class="fa-solid fa-circle-info"></i> The vertical profile may be inaccurate if your filed flight plan altitudes are incomplete or incorrect.</p>
                </div>

                </div> 
            
            <div id="ac-tab-pilot-report" class="ac-tab-pane">
                <div id="pilot-stats-display">
                    </div>
            </div>

        </div> 
    </div>
    `;
    
    createPfdDisplay();
    updatePfdDisplay(baseProps.position);
    
    // --- [MODIFIED] ---
    // Pass the historical route data to the update function
    updateAircraftInfoWindow(baseProps, plan, sortedRoutePoints);
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

/**
 * --- [REHAULED v2.1] Renders the Pilot Report with collapsible sections and a case-sensitive profile link.
 * --- [MODIFIED v2.2] Removed back button for new tabbed layout
 * --- [MODIFIED v8] Added Donut Chart and Odometer logic
 * --- [MODIFIED v9] Added live updates for Flags and Times
 * --- [MODIFIED v11] Use airportsData for flags
 * --- [MODIFIED v12.1] Removed inline gradient from image loading
 * --- [MODIFIED v13 - YOUR FIX] Calculate live ETA and use ATD.
 * --- [MODIFIED v14 - REHAUL] Re-bound data to new top-down layout. Removed donut/odometer logic.
*/
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


    // --- [MODIFIED] Update New Data Bar (using helper) ---
    const nextWpDisplay = nextWpName;
    const nextWpDistDisplay = (nextWpDistNM === '---' || isNaN(parseFloat(nextWpDistNM))) ? '--.-' : Number(nextWpDistNM).toFixed(1);

    updateAll('#ac-next-wp', nextWpDisplay);
    updateAll('#ac-next-wp-dist', `${nextWpDistDisplay}<span class="unit">NM</span>`, true);
    updateAll('#ac-dist', `${Math.round(distanceToDestNM)}<span class="unit">NM</span>`, true);
    updateAll('#ac-ete', ete);
    // --- [END MODIFIED] ---


    // --- Flight Phase State Machine (Unchanged) ---
    // ... (This entire section is unchanged) ...
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


    // --- [MODIFIED] VSD LOGIC (using querySelectorAll) ---
    // This logic is now safe because it queries *within* its parent.
    const vsdPanels = document.querySelectorAll('#vsd-panel');
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
        const VSD_HEIGHT_PX = vsdGraphContent.clientHeight || 240;
        const MAX_ALT_FT = 45000;
        const Y_SCALE_PX_PER_FT = VSD_HEIGHT_PX / MAX_ALT_FT;
        const FIXED_X_SCALE_PX_PER_NM = 4;
        
        // --- 2. Build the Profile (Only once) ---
        const planId = plan.flightPlanId || plan.id || 'unknown';
        if (vsdPanel.dataset.profileBuilt !== 'true' || vsdPanel.dataset.planId !== planId) {
            // ... (VSD profile, label, and Y-axis generation logic is unchanged) ...
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
            // ... (VSD flown path logic is unchanged) ...
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
                altitude: baseProps.position.alt_ft
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
                    flownPathPoints.push({ x_nm: totalActualFlownNM, y_px: wpAltPx });
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
                            flown_path_d += ` L ${scaled_x_px} ${point.y_px}`;
                        }
                    } else {
                        flown_path_d += ` L ${scaled_x_px} ${point.y_px}`;
                    }
                }
                vsdFlownPath.setAttribute('d', flown_path_d);
            }
        }

        // --- 4. Update Aircraft Icon Position (Vertical) ---
        const currentAltPx = VSD_HEIGHT_PX - (altitude * Y_SCALE_PX_PER_FT);
        vsdAircraftIcon.style.top = `${currentAltPx}px`;

        // --- 5. Scroll the Graph (Horizontal) ---
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
        
        // --- 6. [MODIFIED] Update Data Bar's V/S (using querySelector) ---
        const vsdSummaryVS = vsdPanel.closest('.ac-tab-pane').querySelector('#ac-vs');
        if (vsdSummaryVS) {
            vsdSummaryVS.innerHTML = `<i class="fa-solid ${vs > 100 ? 'fa-arrow-up' : vs < -100 ? 'fa-arrow-down' : 'fa-minus'}"></i> ${Math.round(vs)}<span class="unit">fpm</span>`;
        }
    });
    // --- [END VSD LOGIC] ---


    // --- [MODIFIED] Update Other DOM Elements (using helpers) ---
    styleAll('#ac-progress-bar', 'width', `${progress.toFixed(1)}%`);
    updateAll('#ac-phase-indicator', `<i class="fa-solid ${phaseIcon}"></i> ${flightPhase}`, true);
    
    // Set the class separately as it's a list
    const phaseIndicators = document.querySelectorAll('#ac-phase-indicator');
    phaseIndicators.forEach(el => {
        el.className = `flight-phase-indicator ${phaseClass}`;
    });

    // --- Update Times and Flags ---
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

    // --- Update Aircraft Image (using querySelectorAll) ---
    const overviewPanels = document.querySelectorAll('#ac-overview-panel');
    overviewPanels.forEach(overviewPanel => {
        const sanitizeFilename = (name) => {
            if (!name || typeof name !== 'string') return 'unknown';
            return name.trim().toLowerCase().replace(/[^a-z0-j-9-]/g, '_');
        };
        const aircraftName = baseProps.aircraft?.aircraftName || 'Generic Aircraft';
        const liveryName = baseProps.aircraft?.liveryName || 'Default Livery';
        const sanitizedAircraft = sanitizeFilename(aircraftName);
        const sanitizedLivery = sanitizeFilename(liveryName);
        const imagePath = `/CommunityPlanes/${sanitizedAircraft}/${sanitizedLivery}.png`;
        const fallbackPath = '/CommunityPlanes/default.png';
        const newImageUrl = `url('${imagePath}')`;

        if (overviewPanel.dataset.currentPath !== imagePath) {
            const img = new Image();
            img.src = imagePath;
            img.onload = () => {
                overviewPanel.style.backgroundImage = newImageUrl;
                overviewPanel.dataset.currentPath = imagePath;
            };
            img.onerror = () => {
                overviewPanel.style.backgroundImage = `url('${fallbackPath}')`;
                overviewPanel.dataset.currentPath = fallbackPath;
            };
        }
    });
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

        // --- [REMOVED] Tab switching logic ---
        // --- [REMOVED] Hub selector logic ---
        // --- [REMOVED] Route search/filter logic ---

        // --- [MODIFIED] Add listener for the NEW single weather button ---
        const openWeatherBtn = document.getElementById('open-weather-settings-btn');
        if (openWeatherBtn) {
            openWeatherBtn.addEventListener('click', () => {
                // Toggle visibility of the new window
                if (weatherSettingsWindow) {
                    const isVisible = weatherSettingsWindow.classList.toggle('visible');
                    if (isVisible) {
                        MobileUIHandler.openWindow(weatherSettingsWindow);
                    } else {
                        MobileUIHandler.closeActiveWindow();
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
                        MobileUIHandler.openWindow(filterSettingsWindow);
                    } else {
                        MobileUIHandler.closeActiveWindow();
                    }
                }
            });
        }
        // --- [END NEW FILTER BUTTON LISTENER] ---
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

    // --- [NEW] Helper to set the UI state from mapFilters ---
    const setUIFromState = () => {
        // Toggles
        document.getElementById('filter-toggle-atc').checked = mapFilters.hideAtcMarkers;
        document.getElementById('filter-toggle-satellite-mode').checked = (currentMapStyle === MAP_STYLE_SATELLITE);
        // --- [NEW] Set the new label toggle ---
        document.getElementById('filter-toggle-aircraft-labels').checked = mapFilters.showAircraftLabels;

        // Radios
        document.querySelector(`input[name="icon-color-mode"][value="${mapFilters.iconColorMode}"]`).checked = true;
        document.querySelector(`input[name="plan-display-mode"][value="${mapFilters.planDisplayMode}"]`).checked = true;
        
        // Mobile-specific (no change, this was correct)
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
    
    // --- [NEW] Set the UI when the window is first set up ---
    setUIFromState();

    // Use a single listener on the window for better performance
    filterSettingsWindow.addEventListener('click', (e) => {
        // ... (close button logic unchanged) ...
        const target = e.target;
        if (target.closest('.filter-window-close-btn') || target.closest('.filter-window-hide-btn')) {
            filterSettingsWindow.classList.remove('visible');
            MobileUIHandler.closeActiveWindow();
        }
    });

    // Use a 'change' listener for all toggles and radios
    filterSettingsWindow.addEventListener('change', (e) => {
        const target = e.target;
        
        // --- Handle Flight Plan Radio Logic ---
        if (target.name === 'plan-display-mode') {
            mapFilters.planDisplayMode = target.value;
            saveFiltersToLocalStorage(); // <-- SAVE
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
            saveFiltersToLocalStorage(); // <-- SAVE
            const newExpression = getIconImageExpression(mapFilters.iconColorMode);
            
            if (sectorOpsMap && sectorOpsMap.getLayer('sector-ops-live-flights-layer')) {
                sectorOpsMap.setLayoutProperty('sector-ops-live-flights-layer', 'icon-image', newExpression);
            }
            return; 
        }
        
        // Handle Mobile Display Mode Radio Logic
        if (target.name === 'mobile-display-mode') {
            // (This was already saving to its own local storage item, which is fine)
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

        // --- [NEW] Handle Aircraft Label Toggle ---
        if (target.id === 'filter-toggle-aircraft-labels') {
            mapFilters.showAircraftLabels = target.checked;
            saveFiltersToLocalStorage(); // <-- SAVE
            updateAircraftLabelVisibility(); // Apply the change
            // No need to update other filters, so we can return
            return;
        }

        // --- Handle Map Style Logic ---
        const satelliteModeToggle = document.getElementById('filter-toggle-satellite-mode');
        // --- [REMOVED] lightModeToggle ---
        let styleChanged = false;
        let newMapStyle = currentMapStyle;

        // --- [MODIFIED] Simplified style logic ---
        if (target.id === 'filter-toggle-satellite-mode') {
            if (target.checked) {
                newMapStyle = MAP_STYLE_SATELLITE;
            } else {
                newMapStyle = MAP_STYLE_DARK; // Revert to dark
            }
            styleChanged = true;
        }
        // --- [END MODIFIED] ---

        // 1. Update the global mapFilters state object from the DOM
        mapFilters.showVaOnly = document.getElementById('filter-toggle-members-only')?.checked || false;
        mapFilters.hideAtcMarkers = document.getElementById('filter-toggle-atc')?.checked || false;
        mapFilters.hideNoAtcMarkers = document.getElementById('filter-toggle-no-atc')?.checked || false;
        
        // 2. Decide whether to change style or just filters
        if (styleChanged && newMapStyle !== currentMapStyle) {
            console.log(`Changing map style to: ${newMapStyle}`);
            currentMapStyle = newMapStyle;
            sectorOpsMap.setStyle(currentMapStyle);
            // Don't save style to local storage, but filters will be re-applied on 'style.load'
        } else if (!styleChanged) {
            // If just a regular filter (like hideAtc) changed
            saveFiltersToLocalStorage(); // <-- SAVE
            updateMapFilters();
        }

        // 3. Update toolbar button state (always)
        // (This is now called by updateMapFilters, but we call it again for safety)
        updateToolbarButtonStates(); // <-- MODIFIED: Renamed function
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
    currentMapFeatures = {};
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


// --- [REPLACEMENT] for updateSectorOpsLiveFlights ---
// --- [MODIFIED] This function is now named 'updateSectorOpsSecondaryData'
// and ONLY fetches Sessions, ATC, and NOTAMs.
// Flight data is now handled by the 'handleSocketFlightUpdate' function via WebSocket.
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
        const expertSession = sessionsData.sessions.find(s => s.name.toLowerCase().includes('expert'));

        if (!expertSession) {
            console.warn('Sector Ops Map: Expert Server session not found.');
            return;
        }

        // --- MODIFIED: Removed 'flightsRes' from Promise.all ---
        const [atcRes, notamsRes] = await Promise.all([
            fetch(`${LIVE_FLIGHTS_BACKEND}/atc/${expertSession.id}`),
            fetch(`${LIVE_FLIGHTS_BACKEND}/notams/${expertSession.id}`)
        ]);
        
        // Update ATC & NOTAMs (Unchanged)
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

        // --- REMOVED: All flight processing logic ('flightsRes', 'flightsData', loops) ---
        // This is now handled by 'handleSocketFlightUpdate'

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