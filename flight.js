
document.addEventListener('DOMContentLoaded', async () => {       
            // --- Global Configuration ---
            const API_BASE_URL = 'https://site--indgo-backend--6dmjph8ltlhv.code.run';
            const LIVE_FLIGHTS_API_URL = 'https://site--acars-backend--6dmjph8ltlhv.code.run/flights';
            const ACARS_USER_API_URL = 'https://site--acars-backend--6dmjph8ltlhv.code.run/users';
            const TARGET_SERVER_NAME = 'Expert Server';
            const AIRCRAFT_SELECTION_LIST = [
                { value: 'A318', name: 'Airbus A318-100' },
                { value: 'A319', name: 'Airbus A319-100' },
                { value: 'A320', name: 'Airbus A320-200' },
                { value: 'A20N', name: 'Airbus A320neo' },
                { value: 'A321', name: 'Airbus A321-200' },
                { value: 'A21N', name: 'Airbus A321neo' },
                { value: 'A306', name: 'Airbus A300B4-600' },
                { value: 'A310', name: 'Airbus A310-304' },
                { value: 'A332', name: 'Airbus A330-200' },
                { value: 'A333', name: 'Airbus A330-300' },
                { value: 'A339', name: 'Airbus A330-900neo' },
                { value: 'A343', name: 'Airbus A340-300' },
                { value: 'A346', name: 'Airbus A340-600' },
                { value: 'A359', name: 'Airbus A350-900' },
                { value: 'A35K', name: 'Airbus A350-1000' },
                { value: 'A388', name: 'Airbus A380-800' },
                { value: 'B712', name: 'Boeing 717-200' },
                { value: 'B722', name: 'Boeing 727-200' },
                { value: 'B732', name: 'Boeing 737-200' },
                { value: 'B733', name: 'Boeing 737-300' },
                { value: 'B734', name: 'Boeing 737-400' },
                { value: 'B735', name: 'Boeing 737-500' },
                { value: 'B736', name: 'Boeing 737-600' },
                { value: 'B737', name: 'Boeing 737-700' },
                { value: 'B738', name: 'Boeing 737-800' },
                { value: 'B739', name: 'Boeing 737-900' },
                { value: 'B38M', name: 'Boeing 737 MAX 8' },
                { value: 'B742', name: 'Boeing 747-200B' },
                { value: 'B744', name: 'Boeing 747-400' },
                { value: 'B748', name: 'Boeing 747-8' },
                { value: 'B752', name: 'Boeing 757-200' },
                { value: 'B753', name: 'Boeing 757-300' },
                { value: 'B762', name: 'Boeing 767-200ER' },
                { value: 'B763', name: 'Boeing 767-300ER' },
                { value: 'B772', name: 'Boeing 777-200ER' },
                { value: 'B77L', name: 'Boeing 777-200LR' },
                { value: 'B77W', name: 'Boeing 777-300ER' },
                { value: 'B788', name: 'Boeing 787-8' },
                { value: 'B789', name: 'Boeing 787-9' },
                { value: 'B78X', name: 'Boeing 787-10' },
                { value: 'CRJ2', name: 'Bombardier CRJ-200' },
                { value: 'CRJ7', name: 'Bombardier CRJ-700' },
                { value: 'CRJ9', name: 'Bombardier CRJ-900' },
                { value: 'CRJX', name: 'Bombardier CRJ-1000' },
                { value: 'DH8D', name: 'De Havilland Dash 8 Q400' },
                { value: 'E135', name: 'Embraer ERJ-135' },
                { value: 'E145', name: 'Embraer ERJ-145' },
                { value: 'E170', name: 'Embraer E170' },
                { value: 'E175', name: 'Embraer E175' },
                { value: 'E190', name: 'Embraer E190' },
                { value: 'E195', name: 'Embraer E195' },
                { value: 'DC10', name: 'McDonnell Douglas DC-10' },
                { value: 'MD11', name: 'McDonnell Douglas MD-11' },
                { value: 'MD82', name: 'McDonnell Douglas MD-82' },
                { value: 'MD88', name: 'McDonnell Douglas MD-88' },
                { value: 'MD90', name: 'McDonnell Douglas MD-90' },
            ];
            const DATA_REFRESH_INTERVAL_MS = 50000;
            const ACARS_SOCKET_URL = 'https://site--acars-backend--6dmjph8ltlhv.code.run';
            
            // --- State Variables ---
            let OWM_API_KEY = null;
            let isWeatherLayerAdded = false;
            let isCloudLayerAdded = false;
            let isWindLayerAdded = false; 
            let MAPBOX_ACCESS_TOKEN = null;
            let DYNAMIC_FLEET = []; // We won't use this in standalone tracker
            let CURRENT_PILOT = null; // We will set a mock one
            let ACTIVE_FLIGHT_PLANS = []; // We will set a mock one
            let airportsData = {};
            let ALL_AVAILABLE_ROUTES = []; // Will be populated by our mock function
            let runwaysData = {}; 
            let currentMapFeatures = {}; 
            
            const MAP_STYLE_DARK = 'mapbox://styles/mapbox/dark-v11';
            const MAP_STYLE_LIGHT = 'mapbox://styles/servernoob/cmg3wq7an002p01s17kbx7lqk';
            const MAP_STYLE_SATELLITE = 'mapbox://styles/mapbox/satellite-streets-v12';
            let currentMapStyle = MAP_STYLE_DARK; 

            // --- Map-related State ---
            let lastSocketUpdateTimestamp = 0; 
            let liveTrailCache = new Map();
            let sectorOpsMap = null;
            let airportAndAtcMarkers = {}; 
            let sectorOpsMapRouteLayers = [];
            let sectorOpsLiveFlightPathLayers = {}; 
            let sectorOpsAtcNotamInterval = null; 
            let sectorOpsSocket = null; 
            let activeAtcFacilities = []; 
            let activeNotams = []; 
            let airportInfoWindow = null;
            let airportInfoWindowRecallBtn = null;
            let currentAirportInWindow = null;
            let aircraftInfoWindow = null;
            let weatherSettingsWindow = null; 
            let filterSettingsWindow = null; 
            let aircraftInfoWindowRecallBtn = null;
            let currentFlightInWindow = null; 
            let activePfdUpdateInterval = null; 
            let activeGeocodeUpdateInterval = null; 
            let currentAircraftPositionForGeocode = null; 
            let lastGeocodeCoords = { lat: 0, lon: 0 }; 
            let lastPfdState = { track_deg: 0, timestamp: 0, roll_deg: 0 };
            let cachedFlightDataForStatsView = { flightProps: null, plan: null };
            let isAircraftWindowLoading = false;
            let mapFilters = {
                showVaOnly: false,
                showStaffOnly: false,
                hideAllAircraft: false,
                showAtcAirportsOnly: false,
                hideAtcMarkers: false,
                hideAllAirports: false,
                hideNoAtcMarkers: false,
                planDisplayMode: 'none'
            };

            // --- DOM Elements ---
            const mainContentLoader = document.getElementById('main-content-loader');
            
            
            // ==========================================================
            // START: CORE SECTOR OPS FUNCTIONS
            // (Copied from crew-center.js)
            // ==========================================================

            /**
             * --- [MODIFIED] Helper: Fetches/Sets API Keys ---
             * In this standalone file, you must set your keys here.
             */
            async function fetchApiKeys() {
                try {
                    // --- PLACEHOLDER KEYS ---
                    // IMPORTANT: Replace with your actual keys
                    MAPBOX_ACCESS_TOKEN = 'YOUR_MAPBOX_ACCESS_TOKEN_HERE'; 
                    OWM_API_KEY = 'YOUR_OPENWEATHERMAP_API_KEY_HERE'; 
                    
                    if (MAPBOX_ACCESS_TOKEN === 'YOUR_MAPBOX_ACCESS_TOKEN_HERE' || !MAPBOX_ACCESS_TOKEN) {
                            throw new Error('Mapbox token is not set. Please edit standalone_tracker.html (line ~1300).');
                    }
                    if (OWM_API_KEY === 'YOUR_OPENWEATHERMAP_API_KEY_HERE' || !OWM_API_KEY) {
                            console.warn('OWM API key is not set. Weather layers will not work.');
                    }
                    
                    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

                } catch (error) {
                    console.error('Failed to initialize API keys:', error.message);
                    showNotification(error.message, 'error');
                }
            }

            /**
             * --- [MODIFIED] Handles search input.
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
                            matches.push(feature);
                        }
                    } catch (error) {
                        console.error('Error searching feature:', error, currentMapFeatures[flightId]);
                    }
                }
                
                renderSearchResultsDropdown(matches);
            }

            /**
             * --- [MODIFIED] Renders search results.
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
                    </div>`;
                }).join('');
            }

            /**
             * --- [MODIFIED] Handles search result click.
             */
            function onSearchResultClick(itemElement) {
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
                    return; 
                }

                const dropdown = document.getElementById('search-results-dropdown');
                const searchInput = document.getElementById('sector-ops-search-input');
                
                if (dropdown) dropdown.innerHTML = '';
                if (searchInput) {
                    searchInput.value = '';
                    searchInput.blur(); 
                }
                
                sectorOpsMap.flyTo({
                    center: coordinates,
                    zoom: 9,
                    essential: true
                });

                let flightProps;
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
                
                if (!flightProps || !flightProps.position) {
                    console.error('onSearchResultClick: Aborting, flight has no valid position data after parsing.');
                    return;
                }
                
                // Fetch session and call handleAircraftClick
                // We'll mock the session part
                const mockSessionId = 'mock-expert-session-id';
                handleAircraftClick(flightProps, mockSessionId);
            }

            /**
             * Toggles OWM Precipitation Layer.
             */
            function toggleWeatherLayer(show) {
                if (!sectorOpsMap) return;
                const SOURCE_ID = 'owm-precipitation-source';
                const LAYER_ID = 'owm-precipitation-layer';

                if (show && !isWeatherLayerAdded) {
                    if (!OWM_API_KEY) {
                        console.error('OWM API Key is not loaded. Cannot add weather layer.');
                        showNotification('Weather service is unavailable (No API Key).', 'error');
                        return;
                    }
                    const owmTileUrl = `https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${OWM_API_KEY}`;
                    sectorOpsMap.addSource(SOURCE_ID, {
                        'type': 'raster', 'tiles': [owmTileUrl], 'tileSize': 256, 'maxzoom': 9 
                    });
                    sectorOpsMap.addLayer({
                        'id': LAYER_ID, 'type': 'raster', 'source': SOURCE_ID,
                        'paint': { 'raster-opacity': 0.7, 'raster-fade-duration': 300 }
                    }, 'sector-ops-live-flights-layer'); 
                    isWeatherLayerAdded = true;
                } else if (isWeatherLayerAdded) {
                    sectorOpsMap.setLayoutProperty(LAYER_ID, 'visibility', show ? 'visible' : 'none');
                }
            }

            /**
             * Toggles OWM Cloud Layer.
             */
            function toggleCloudLayer(show) {
                if (!sectorOpsMap) return;
                const SOURCE_ID = 'owm-cloud-source';
                const LAYER_ID = 'owm-cloud-layer';

                if (show && !isCloudLayerAdded) {
                    if (!OWM_API_KEY) {
                        showNotification('Weather service is unavailable (No API Key).', 'error');
                        return;
                    }
                    const owmTileUrl = `https://tile.openweathermap.org/map/clouds_new/{z}/{x}/{y}.png?appid=${OWM_API_KEY}`;
                    sectorOpsMap.addSource(SOURCE_ID, {
                        'type': 'raster', 'tiles': [owmTileUrl], 'tileSize': 256, 'maxzoom': 9
                    });
                    sectorOpsMap.addLayer({
                        'id': LAYER_ID, 'type': 'raster', 'source': SOURCE_ID,
                        'paint': { 'raster-opacity': 0.6, 'raster-fade-duration': 300 }
                    }, 'sector-ops-live-flights-layer'); 
                    isCloudLayerAdded = true;
                } else if (isCloudLayerAdded) {
                    sectorOpsMap.setLayoutProperty(LAYER_ID, 'visibility', show ? 'visible' : 'none');
                }
            }

            /**
             * Toggles OWM Wind Layer.
             */
            function toggleWindLayer(show) {
                if (!sectorOpsMap) return;
                const SOURCE_ID = 'owm-wind-source';
                const LAYER_ID = 'owm-wind-layer';

                if (show && !isWindLayerAdded) {
                    if (!OWM_API_KEY) {
                        showNotification('Weather service is unavailable (No API Key).', 'error');
                        return;
                    }
                    const owmTileUrl = `https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid=${OWM_API_KEY}`;
                    sectorOpsMap.addSource(SOURCE_ID, {
                        'type': 'raster', 'tiles': [owmTileUrl], 'tileSize': 256, 'maxzoom': 9
                    });
                    sectorOpsMap.addLayer({
                        'id': LAYER_ID, 'type': 'raster', 'source': SOURCE_ID,
                        'paint': { 'raster-opacity': 0.6, 'raster-fade-duration': 300 }
                    }, 'sector-ops-live-flights-layer'); 
                    isWindLayerAdded = true;
                } else if (isWindLayerAdded) {
                    sectorOpsMap.setLayoutProperty(LAYER_ID, 'visibility', show ? 'visible' : 'none');
                }
            }

            /**
             * Applies all active map filters.
             */
            function updateMapFilters() {
                if (!sectorOpsMap) return;
                updateAircraftLayerFilter();
                renderAirportMarkers();
                updateToolbarButtonStates();
            }

            /**
             * Builds and applies Mapbox filter expression to aircraft layer.
             */
            function updateAircraftLayerFilter() {
                if (!sectorOpsMap || !sectorOpsMap.getLayer('sector-ops-live-flights-layer')) return;

                let filter = ['all']; 

                if (mapFilters.hideAllAircraft) {
                    filter = ['==', 'flightId', '']; 
                    sectorOpsMap.setFilter('sector-ops-live-flights-layer', filter);
                    return; 
                } else if (mapFilters.showStaffOnly) {
                    filter.push(['==', 'isStaff', true]);
                } else if (mapFilters.showVaOnly) {
                    filter.push(['==', 'isVAMember', true]);
                }
                
                sectorOpsMap.setFilter('sector-ops-live-flights-layer', filter);
            }

            /**
             * Updates toolbar buttons to show if layers are active.
             */
            function updateToolbarButtonStates() {
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

                const openFiltersBtn = document.getElementById('open-filter-settings-btn');
                if (openFiltersBtn) {
                    const isFilterActive = mapFilters.showVaOnly || 
                                        mapFilters.hideAtcMarkers || 
                                        mapFilters.hideNoAtcMarkers; 
                    openFiltersBtn.classList.toggle('active', isFilterActive);
                }
            }

            /**
             * Fetches reverse geocoded location and updates UI.
             */
            async function fetchAndDisplayGeocode(lat, lon) {
                if (!lat || !lon) return;

                const distanceMovedKm = getDistanceKm(lat, lon, lastGeocodeCoords.lat, lastGeocodeCoords.lon);
                if (distanceMovedKm < 20 && lastGeocodeCoords.lat !== 0) {
                    return; // Not far enough
                }

                lastGeocodeCoords = { lat, lon };
                
                const initialElements = document.querySelectorAll('#ac-location');
                if (initialElements.length === 0) return;
                initialElements.forEach(el => {
                    el.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; 
                });

                try {
                    // This uses a Netlify function from the original project.
                    // This will ONLY work if that function is CORS-enabled for your domain.
                    // You may need to replace this with a different geocoding service.
                    const response = await fetch(`https://indgo-va.netlify.app/.netlify/functions/reverse-geocode?lat=${lat}&lon=${lon}`);

                    const currentElements = document.querySelectorAll('#ac-location');

                    if (response.ok) {
                        const data = await response.json();
                        currentElements.forEach(el => {
                            el.textContent = data.location || 'Remote Area';
                        });
                    } else {
                        currentElements.forEach(el => {
                            el.textContent = 'Ocean / Remote Area';
                        });
                    }
                } catch (error) {
                    console.error("Geocode fetch error:", error);
                    const currentElements = document.querySelectorAll('#ac-location');
                    currentElements.forEach(el => {
                        el.textContent = 'N/A'; // Fetch failed
                    });
                }
            }

            /**
             * --- [MODIFIED] Fetches Airport Coordinate Data from local JSON.
             */
            async function fetchAirportsData() {
                try {
                    const response = await fetch('airports.json');
                    if (!response.ok) throw new Error('Could not load airports.json. Please create this file.');
                    airportsData = await response.json();
                    console.log(`Successfully loaded data for ${Object.keys(airportsData).length} airports.`);
                } catch (error) {
                    console.error('Failed to fetch airport data:', error);
                    showNotification('Could not load airport location data.', 'error');
                }
            }

            /**
             * --- [MODIFIED] Fetches Runway Data from local JSON.
             */
            async function fetchRunwaysData() {
                try {
                    const response = await fetch('runways.json'); 
                    if (!response.ok) throw new Error('Could not load runways.json.');
                    const rawRunways = await response.json();

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
                    showNotification('Runway data not available.', 'error');
                }
            }
            
            // --- Helper Functions ---

            function getAircraftCategory(aircraftName) {
                if (!aircraftName) return 'default';
                const name = aircraftName.toLowerCase();
                if (['f-16', 'f-18', 'f-22', 'f-35', 'f/a-18', 'a-10'].some(ac => name.includes(ac))) return 'fighter';
                if (['c-130', 'ac-130', 'hercules', 'c-17'].some(ac => name.includes(ac))) return 'military';
                if (['a380', '747', 'vc-25'].some(ac => name.includes(ac))) return 'jumbo';
                if (['a330', 'a340', 'a350', '767', '777', '787', 'dc-10', 'md-11'].some(ac => name.includes(ac))) return 'widebody';
                if (['crj', 'erj', 'dh8d', 'q400'].some(ac => name.includes(ac))) return 'regional';
                if (['cessna', 'c172', 'c208', 'xcub', 'tbm', 'sr22'].some(ac => name.includes(ac))) return 'cessna';
                if (['citation', 'cirrus','challenger'].some(ac => name.includes(ac))) return 'private';
                if (['a318', 'a319', 'a320', 'a321', '717', '727', '737', '757', 'a220', 'e17', 'e19'].some(ac => name.includes(ac))) return 'narrowbody';
                return 'default';
            }

            function getDistanceKm(lat1, lon1, lat2, lon2) {
                const R = 6371; // Radius of the Earth in km
                const toRad = (v) => (v * Math.PI) / 180;
                const dLat = toRad(lat2 - lat1);
                const dLon = toRad(lon2 - lon1);
                const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                return R * c;
            }

            function getBearing(lat1, lon1, lat2, lon2) {
                const toRad = (v) => v * Math.PI / 180;
                const toDeg = (v) => v * 180 / Math.PI;
                const lat1Rad = toRad(lat1), lon1Rad = toRad(lon1), lat2Rad = toRad(lat2), lon2Rad = toRad(lon2);
                const dLon = lon2Rad - lon1Rad;
                const y = Math.sin(dLon) * Math.cos(lat2Rad);
                const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
                let brng = toDeg(Math.atan2(y, x));
                return (brng + 360) % 360; // Normalize to 0-360
            }

            function normalizeBearingDiff(diff) {
                let normalized = diff % 360;
                if (normalized > 180) normalized -= 360;
                if (normalized < -180) normalized += 360;
                return normalized;
            }

            function getIntermediatePoint(lat1, lon1, lat2, lon2, fraction) {
                const toRad = (v) => v * Math.PI / 180;
                const toDeg = (v) => v * 180 / Math.PI;
                const lat1Rad = toRad(lat1), lon1Rad = toRad(lon1), lat2Rad = toRad(lat2), lon2Rad = toRad(lon2);
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
             * Handles live flight data from WebSocket.
             */
            function handleSocketFlightUpdate(data) {
                if (!data || !Array.isArray(data.flights) || !data.timestamp) {
                    console.warn('Socket: Received invalid or untimestamped flights data packet.');
                    return;
                }

                const newPacketTimestamp = new Date(data.timestamp).getTime();
                if (newPacketTimestamp <= lastSocketUpdateTimestamp) {
                    console.warn(`Socket: Discarding stale flight data packet (Lag: ${lastSocketUpdateTimestamp - newPacketTimestamp}ms)`);
                    return;
                }
                lastSocketUpdateTimestamp = newPacketTimestamp;

                if (!sectorOpsMap || !sectorOpsMap.isStyleLoaded()) return; 
                const source = sectorOpsMap.getSource('sector-ops-live-flights-source');
                if (!source) {
                    console.warn('Socket: Map source not found, cannot update flight positions.');
                    return;
                }

                const flights = data.flights;
                const updatedFlightIds = new Set();

                flights.forEach(flight => {
                    if (!flight.position || flight.position.lat == null || flight.position.lon == null) return;
                    const flightId = flight.flightId;
                    updatedFlightIds.add(flightId);

                    const newApiLat = flight.position.lat;
                    const newApiLon = flight.position.lon;
                    const newApiHeading = flight.position.heading_deg || 0;
                    const newApiSpeed = flight.position.gs_kt || 0;
                    const aircraftData = flight.aircraft || null;
                    
                    const newProperties = {
                        flightId: flight.flightId,
                        callsign: flight.callsign,
                        username: flight.username,
                        altitude: flight.position.alt_ft,
                        speed: newApiSpeed,
                        verticalSpeed: flight.position.vs_fpm || 0,
                        position: JSON.stringify(flight.position),
                        aircraft: JSON.stringify(aircraftData), 
                        userId: flight.userId,
                        category: getAircraftCategory(flight.aircraft?.aircraftName),
                        heading: newApiHeading,
                        isStaff: flight.isStaff,
                        isVAMember: flight.isVAMember
                    };

                    currentMapFeatures[flightId] = {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [newApiLon, newApiLat] },
                        properties: newProperties
                    };
                });

                // Clean up old flights
                for (const flightId in currentMapFeatures) {
                    if (!updatedFlightIds.has(flightId)) {
                        delete currentMapFeatures[flightId];
                    }
                }

                // Update the map source
                source.setData({
                    type: 'FeatureCollection',
                    features: Object.values(currentMapFeatures)
                });
            }

            /**
             * Initializes and connects the Socket.IO client.
             */
            function initializeSectorOpsSocket() {
                if (sectorOpsSocket && sectorOpsSocket.connected) return;
                if (sectorOpsSocket) {
                    sectorOpsSocket.connect();
                    return;
                }

                if (typeof io === 'undefined') {
                    console.error('Socket.IO client library (io) is not loaded.');
                    showNotification('Live service connection failed.', 'error');
                    return;
                }
                
                console.log(`Socket: Connecting to ${ACARS_SOCKET_URL}...`);
                sectorOpsSocket = io(ACARS_SOCKET_URL, {
                    reconnection: true,
                    reconnectionAttempts: 5,
                    reconnectionDelay: 2000,
                    transports: ['websocket'] 
                });

                sectorOpsSocket.on('connect', () => {
                    console.log(`Socket: Connected with ID ${sectorOpsSocket.id}. Joining room: ${TARGET_SERVER_NAME.toLowerCase()}`);
                    sectorOpsSocket.emit('join_server_room', TARGET_SERVER_NAME);
                });

                sectorOpsSocket.on('all_flights_update', handleSocketFlightUpdate);

                sectorOpsSocket.on('disconnect', (reason) => console.warn(`Socket: Disconnected. Reason: ${reason}`));
                sectorOpsSocket.on('connect_error', (error) => console.error(`Socket: Connection Error. ${error.message}`));
            }
            
            function getNearestRunway(aircraftPos, airportIcao, maxDistanceNM = 2.0) {
                const runways = runwaysData[airportIcao];
                if (!runways || runways.length === 0) return null;

                let closestRunway = null;
                let minDistanceKm = maxDistanceNM * 1.852;

                for (const runway of runways) {
                    const ends = [
                        { ident: runway.le_ident, lat: runway.le_latitude_deg, lon: runway.le_longitude_deg, heading: runway.le_heading_degT, elevation_ft: runway.le_elevation_ft },
                        { ident: runway.he_ident, lat: runway.he_latitude_deg, lon: runway.he_longitude_deg, heading: runway.he_heading_degT, elevation_ft: runway.he_elevation_ft }
                    ];

                    for (const end of ends) {
                        if (end.lat == null || end.lon == null) continue;
                        const distanceKm = getDistanceKm(aircraftPos.lat, aircraftPos.lon, end.lat, end.lon);
                        if (distanceKm < minDistanceKm) {
                            minDistanceKm = distanceKm;
                            closestRunway = { ...end, airport: airportIcao, distanceNM: distanceKm / 1.852 };
                        }
                    }
                }

                if (closestRunway) {
                    let headingDiff = Math.abs(aircraftPos.heading_deg - closestRunway.heading);
                    if (headingDiff > 180) headingDiff = 360 - headingDiff;
                    closestRunway.headingDiff = headingDiff;
                }
                return closestRunway;
            }
            
            function formatTime(ms) {
                if (ms < 0) ms = 0;
                let s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
                s = s % 60; m = m % 60;
                return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
            }

            function formatTimeFromTimestamp(timestamp) {
                if (!timestamp) return '----';
                const date = (typeof timestamp === 'number' && timestamp.toString().length === 10) ? new Date(timestamp * 1000) : new Date(timestamp);
                if (isNaN(date.getTime())) return '----';
                return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
            }

            function extractAirlineCode(flightNumber) {
                if (!flightNumber || typeof flightNumber !== 'string') return 'UNKNOWN';
                const match = flightNumber.trim().toUpperCase().match(/^([A-Z0-9]{2,3})/);
                return match ? match[1].substring(0, 2) : 'UNKNOWN';
            }

            function atcTypeToString(typeId) {
                const types = { 0: 'Ground', 1: 'Tower', 2: 'Unicom', 3: 'Clearance', 4: 'Approach', 5: 'Departure', 6: 'Center', 7: 'ATIS' };
                return types[typeId] || 'Unknown';
            }

            function formatAtcDuration(startTime) {
                if (!startTime) return '';
                const diffMs = Math.max(0, Date.now() - new Date(startTime).getTime());
                const hours = Math.floor(diffMs / 3600000);
                const minutes = Math.floor((diffMs % 3600000) / 60000);
                return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
            }

            // --- PFD Constants and Functions ---
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
                const attitudeGroup = document.getElementById('attitude_group');
                const speedTapeGroup = document.getElementById('speed_tape_group');
                const altitudeTapeGroup = document.getElementById('altitude_tape_group');
                const tensReelGroup = document.getElementById('altitude_tens_reel_group');
                const headingTapeGroup = document.getElementById('heading_tape_group');

                if (!attitudeGroup || !speedTapeGroup || !altitudeTapeGroup || !tensReelGroup || !headingTapeGroup || attitudeGroup.dataset.initialized) {
                    return;
                }

                // --- Generation Functions ---
                function generateAttitudeIndicators() {
                    const centerX = 401.5, centerY = 312.5;
                    for (let p = -90; p <= 90; p += 2.5) {
                        if (p === 0) continue;
                        const y = centerY - (p * PFD_PITCH_SCALE);
                        const isMajor = (p % 10 === 0), isMinor = (p % 5 === 0);
                        if (isMajor || isMinor) {
                            const lineWidth = isMajor ? 80 : 40;
                            const line = document.createElementNS(SVG_NS, 'line');
                            line.setAttribute('x1', centerX - lineWidth / 2); line.setAttribute('x2', centerX + lineWidth / 2);
                            line.setAttribute('y1', y); line.setAttribute('y2', y);
                            line.setAttribute('stroke', 'white'); line.setAttribute('stroke-width', 2);
                            attitudeGroup.appendChild(line);
                            if (isMajor) {
                                const textLeft = document.createElementNS(SVG_NS, 'text');
                                textLeft.setAttribute('x', centerX - lineWidth / 2 - 10); textLeft.setAttribute('y', y + 5);
                                textLeft.setAttribute('fill', 'white'); textLeft.setAttribute('font-size', '18');
                                textLeft.setAttribute('text-anchor', 'end'); textLeft.textContent = Math.abs(p);
                                attitudeGroup.appendChild(textLeft);
                                const textRight = document.createElementNS(SVG_NS, 'text');
                                textRight.setAttribute('x', centerX + lineWidth / 2 + 10); textRight.setAttribute('y', y + 5);
                                textRight.setAttribute('fill', 'white'); textRight.setAttribute('font-size', '18');
                                textRight.setAttribute('text-anchor', 'start'); textRight.textContent = Math.abs(p);
                                attitudeGroup.appendChild(textRight);
                            }
                        }
                    }
                }
                function generateSpeedTape() {
                    for (let s = 0; s <= 999; s += 5) {
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
                    for (let alt = 0; alt <= 50000; alt += 20) {
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
            
            function updatePfdDisplay(pfdData) {
                if (!pfdData) return;
                const gs_kt = pfdData.gs_kt ?? 0;
                const track_deg = pfdData.heading_deg ?? pfdData.track_deg ?? 0;
                const alt_ft = pfdData.alt_ft ?? 0;
                const vs_fpm = pfdData.vs_fpm ?? 0;
                const attitudeGroup = document.getElementById('attitude_group'), speedTapeGroup = document.getElementById('speed_tape_group'), altitudeTapeGroup = document.getElementById('altitude_tape_group'), tensReelGroup = document.getElementById('altitude_tens_reel_group'), headingTapeGroup = document.getElementById('heading_tape_group'), speedReadout = document.getElementById('speed_readout'), altReadoutHund = document.getElementById('altitude_readout_hundreds'), headingReadout = document.getElementById('heading_readout');
                if (!attitudeGroup || !speedTapeGroup || !altitudeTapeGroup || !headingTapeGroup || !tensReelGroup) return;

                const WINDOW_SEC = 2.4, LATCH_ON_TURN = 0.20, LATCH_OFF_TURN = 0.10, LATCH_HOLD_MS = 400, MAX_BANK_DEG = 35, MAX_ROLL_RATE = 60, MIN_GS_FOR_TURN = 1, PITCH_LIMIT = 25, DATA_HOLD_MS = 1400, STALE_MS = 4000, HDG_EPS = 0.4, GS_EPS = 0.5, DECAY_TO_LEVEL_DPS = 12, MICRO_DECAY_FACTOR = 0.25, EMA_ALPHA = 0.35, SIGN_MIN_DEG = 3.0, SIGN_HOLD_MS = 250;
                const now = performance.now();
                if (!window.lastPfdState || typeof window.lastPfdState !== 'object') {
                    window.lastPfdState = { unwrapped: track_deg, lastTime: now, buf: [], rollDisp: 0, turning: false, lastTurnLatchTs: 0, lastDataTs: 0, lastTurnRate: 0, lastRawTrack: track_deg, lastRawGs: gs_kt, prevUnwrapped: track_deg, turnRateEma: 0, rollSign: 0, lastSignChangeTs: 0 };
                }
                const S = window.lastPfdState;
                let delta = track_deg - (S.unwrapped % 360);
                if (delta > 180) delta -= 360; if (delta < -180) delta += 360;
                const unwrapped = S.unwrapped + delta;
                const unwrappedDelta = Math.abs(unwrapped - S.unwrapped);
                const isFresh = unwrappedDelta > HDG_EPS || Math.abs(gs_kt - S.lastRawGs) > GS_EPS;
                const tNow = now / 1000;
                if (isFresh) {
                    S.lastDataTs = now; S.lastRawTrack = track_deg; S.lastRawGs = gs_kt;
                    const cutoff = tNow - WINDOW_SEC;
                    S.buf.push({ t: tNow, hdg: unwrapped });
                    while (S.buf.length && S.buf[0].t < cutoff) S.buf.shift();
                }
                let turnRate = S.lastTurnRate;
                if (isFresh) {
                    if (S.buf.length >= 3 && gs_kt > MIN_GS_FOR_TURN) {
                        const t0 = S.buf[0].t; let sumT = 0, sumH = 0, sumTT = 0, sumTH = 0, n = S.buf.length;
                        for (let i = 0; i < n; i++) { const ti = S.buf[i].t - t0, hi = S.buf[i].hdg; sumT += ti; sumH += hi; sumTT += ti * ti; sumTH += ti * hi; }
                        const denom = n * sumTT - sumT * sumT;
                        if (denom !== 0) { turnRate = (n * sumTH - sumT * sumH) / denom; } else { const dtS = Math.max(0.02, (now - S.lastTime) / 1000); turnRate = (unwrapped - S.prevUnwrapped) / dtS; }
                    } else { const dtS = Math.max(0.02, (now - S.lastTime) / 1000); turnRate = (unwrapped - S.prevUnwrapped) / dtS; }
                    S.lastTurnRate = turnRate;
                }
                S.turnRateEma = EMA_ALPHA * turnRate + (1 - EMA_ALPHA) * S.turnRateEma;
                const sinceFresh = now - S.lastDataTs, rateAbs = Math.abs(S.turnRateEma), wasTurning = S.turning, forceTurningByHold = sinceFresh <= DATA_HOLD_MS && Math.abs(S.lastTurnRate) >= LATCH_OFF_TURN;
                if (!wasTurning) { if (rateAbs >= LATCH_ON_TURN || forceTurningByHold) { S.turning = true; S.lastTurnLatchTs = now; } } else { const timeSinceLatch = now - S.lastTurnLatchTs, allowUnlatch = rateAbs < LATCH_OFF_TURN && timeSinceLatch > LATCH_HOLD_MS && sinceFresh > DATA_HOLD_MS; if (allowUnlatch && sinceFresh > STALE_MS) { S.turning = false; } else if (rateAbs >= LATCH_OFF_TURN || forceTurningByHold) { S.lastTurnLatchTs = now; } }
                const Vms = Math.max(0, gs_kt) * 0.514444, omega = (S.turnRateEma * Math.PI) / 180, bankAbs = Math.atan(Math.abs(omega) * Vms / 9.81) * 180 / Math.PI;
                let targetRoll = (S.turnRateEma >= 0 ? 1 : -1) * Math.min(bankAbs, MAX_BANK_DEG);
                const desiredSign = Math.sign(targetRoll);
                if (desiredSign !== 0 && desiredSign !== S.rollSign) { const bigEnough = Math.abs(targetRoll) >= SIGN_MIN_DEG, persisted = (now - S.lastSignChangeTs) >= SIGN_HOLD_MS; if (bigEnough && persisted) { S.rollSign = desiredSign; S.lastSignChangeTs = now; } else { targetRoll = Math.abs(targetRoll) * (S.rollSign || desiredSign); } } else if (S.rollSign === 0 && desiredSign !== 0) { S.rollSign = desiredSign; S.lastSignChangeTs = now; }
                if (!S.turning) { const dt = Math.max(0.01, (now - S.lastTime) / 1000), base = DECAY_TO_LEVEL_DPS * dt, decayStep = sinceFresh <= STALE_MS ? base * MICRO_DECAY_FACTOR : base; targetRoll = (Math.abs(S.rollDisp) <= decayStep) ? 0 : S.rollDisp - Math.sign(S.rollDisp) * decayStep; }
                { const dt = Math.max(0.01, (now - S.lastTime) / 1000), maxStep = dt * MAX_ROLL_RATE, diff = targetRoll - S.rollDisp; S.rollDisp += Math.abs(diff) > maxStep ? Math.sign(diff) * maxStep : diff; }
                S.unwrapped = unwrapped; S.prevUnwrapped = unwrapped; S.lastTime = now;
                const pitch_deg = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, (vs_fpm / 1000) * 4));
                const _PFD_PITCH_SCALE = window.PFD_PITCH_SCALE ?? 2.0, _PFD_SPEED_REF_VALUE = window.PFD_SPEED_REF_VALUE ?? 0, _PFD_SPEED_SCALE = window.PFD_SPEED_SCALE ?? -0.6, _PFD_ALTITUDE_SCALE = window.PFD_ALTITUDE_SCALE ?? 0.7, _PFD_REEL_SPACING = window.PFD_REEL_SPACING ?? 40, _PFD_HEADING_REF_VALUE = window.PFD_HEADING_REF_VALUE ?? 0, _PFD_HEADING_SCALE = window.PFD_HEADING_SCALE ?? 4;
                const rollForSvg = -S.rollDisp; 
                attitudeGroup.setAttribute('transform', `translate(0, ${pitch_deg * _PFD_PITCH_SCALE}) rotate(${rollForSvg}, 401.5, 312.5)`);
                speedReadout.textContent = Math.round(gs_kt);
                const speedYOffset = (gs_kt - _PFD_SPEED_REF_VALUE) * _PFD_SPEED_SCALE;
                speedTapeGroup.setAttribute('transform', `translate(0, ${speedYOffset})`);
                const altitude = Math.max(0, alt_ft);
                altReadoutHund.textContent = Math.floor(altitude / 100);
                const tapeYOffset = altitude * _PFD_ALTITUDE_SCALE;
                altitudeTapeGroup.setAttribute('transform', `translate(0, ${tapeYOffset})`);
                const tensValue = altitude % 100;
                const reelYOffset = -(tensValue / 20) * _PFD_REEL_SPACING;
                tensReelGroup.setAttribute('transform', `translate(0, ${reelYOffset})`);
                const hdg = ((Math.round(track_deg) % 360) + 360) % 360;
                headingReadout.textContent = String(hdg).padStart(3, '0');
                const xOffset = -(track_deg - _PFD_HEADING_REF_VALUE) * _PFD_HEADING_SCALE;
                headingTapeGroup.setAttribute('transform', `translate(${xOffset}, 0)`);
            }

            function resetPfdState() {
                window.lastPfdState = null;
                const attitudeGroup = document.getElementById('attitude_group');
                const speedReadout = document.getElementById('speed_readout');
                const altReadoutHund = document.getElementById('altitude_readout_hundreds');
                const headingReadout = document.getElementById('heading_readout');
                const speedTapeGroup = document.getElementById('speed_tape_group');
                const altitudeTapeGroup = document.getElementById('altitude_tape_group');
                const headingTapeGroup = document.getElementById('heading_tape_group');
                if (attitudeGroup) attitudeGroup.setAttribute('transform', 'translate(0, 0) rotate(0, 401.5, 312.5)');
                if (speedReadout) speedReadout.textContent = '---';
                if (altReadoutHund) altReadoutHund.textContent = '---';
                if (headingReadout) headingReadout.textContent = '---';
                if (speedTapeGroup) speedTapeGroup.setAttribute('transform', 'translate(0, 0)');
                if (altitudeTapeGroup) altitudeTapeGroup.setAttribute('transform', 'translate(0, 0)');
                if (headingTapeGroup) headingTapeGroup.setAttribute('transform', 'translate(0, 0)');
            }

            /**
             * Creates HTML for airport info window.
             */
            async function createAirportInfoWindowHTML(icao) {
                const atcForAirport = activeAtcFacilities.filter(f => f.airportName === icao);
                const notamsForAirport = activeNotams.filter(n => n.airportIcao === icao);
                const routesFromAirport = ALL_AVAILABLE_ROUTES.filter(r => r.departure === icao);

                // Fetch weather
                let weatherHtml = '';
                try {
                    // This uses a Netlify function from the original project.
                    // This will ONLY work if that function is CORS-enabled for your domain.
                    const weatherRes = await fetch(`https_://indgo-va.netlify.app/.netlify/functions/weather?icao=${icao}`.replace('https_://', 'https://'));
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
                                </div>`;
                        }
                    } else {
                         throw new Error('Weather service failed');
                    }
                } catch (err) {
                    console.warn(`Could not fetch weather for ${icao}:`, err);
                    weatherHtml = `<div class="airport-info-weather"><p class="muted-text">Weather data unavailable.</p></div>`;
                }

                if (atcForAirport.length === 0 && notamsForAirport.length === 0 && routesFromAirport.length === 0) {
                    return null; // Don't show a popup for an empty airport
                }

                let atcHtml = '<p class="muted-text">No active ATC reported.</p>';
                if (atcForAirport.length > 0) {
                    atcHtml = `<ul style="list-style:none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px;">
                        ${atcForAirport.map(f => `<li style="display: flex; justify-content: space-between; font-size: 0.9rem;">
                            <span>${atcTypeToString(f.type)}: <strong>${f.username || 'N/A'}</strong></span>
                            <span style="color: #9fa8da;">${formatAtcDuration(f.startTime)}</span>
                        </li>`).join('')}
                    </ul>`;
                }

                let notamsHtml = '<p class="muted-text">No active NOTAMs.</p>';
                if (notamsForAirport.length > 0) {
                    notamsHtml = `<ul style="list-style:none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px;">
                        ${notamsForAirport.map(n => `<li style="font-size: 0.9rem;">${n.message}</li>`).join('')}
                    </ul>`;
                }
                
                let routesHtml = '<p class="muted-text">No departing routes from this airport in our database.</p>';
                if (routesFromAirport.length > 0) {
                    routesHtml = `
                        <ul class="popup-routes-list">
                            ${routesFromAirport.map(route => {
                                const airlineCode = extractAirlineCode(route.flightNumber);
                                const aircraftInfo = AIRCRAFT_SELECTION_LIST.find(ac => ac.value === route.aircraft);
                                const aircraftName = aircraftInfo ? aircraftInfo.name : route.aircraft;
                                const routeDataString = JSON.stringify(route).replace(/'/g, "&apos;");
                                return `
                                <li class="popup-route-item">
                                    <div class="route-item-header">
                                        <div class="route-item-info">
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
                                            <span>${aircraftName}</span>
                                        </div>
                                        ${getRankBadgeHTML(route.rankUnlock || deduceRankFromAircraftFE(route.aircraft), { showImage: true, imageClass: 'roster-req-rank-badge' })}
                                    </div>
                                </li>`;
                            }).join('')}
                        </ul>`;
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

            // ==========================================================
            // START: SECTOR OPS / ROUTE EXPLORER LOGIC
            // ==========================================================
            
            function setupAirportWindowEvents() {
                if (!airportInfoWindow || airportInfoWindow.dataset.eventsAttached === 'true') return;
                const closeBtn = document.getElementById('airport-window-close-btn');
                const hideBtn = document.getElementById('airport-window-hide-btn');
                closeBtn.addEventListener('click', () => {
                    airportInfoWindow.classList.remove('visible');
                    MobileUIHandler.closeActiveWindow();
                    airportInfoWindowRecallBtn.classList.remove('visible');
                    clearRouteLayers(); 
                    currentAirportInWindow = null;
                });
                hideBtn.addEventListener('click', () => {
                    airportInfoWindow.classList.remove('visible');
                    if (currentAirportInWindow) {
                        airportInfoWindowRecallBtn.classList.add('visible');
                        airportInfoWindowRecallBtn.classList.add('palpitate');
                        setTimeout(() => airportInfoWindowRecallBtn.classList.remove('palpitate'), 1000);
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
                                if (userId) {
                                    await displayPilotStats(userId, username); 
                                }
                            }
                        }
                    }

                    if (closeBtn) {
                        aircraftInfoWindow.classList.remove('visible');
                        MobileUIHandler.closeActiveWindow();
                        aircraftInfoWindowRecallBtn.classList.remove('visible');
                        clearLiveFlightPath(currentFlightInWindow); 
                        if (activePfdUpdateInterval) clearInterval(activePfdUpdateInterval);
                        if (activeGeocodeUpdateInterval) clearInterval(activeGeocodeUpdateInterval);
                        activePfdUpdateInterval = null;
                        activeGeocodeUpdateInterval = null;
                        currentAircraftPositionForGeocode = null;
                        liveTrailCache.delete(currentFlightInWindow);
                        currentFlightInWindow = null;
                        cachedFlightDataForStatsView = { flightProps: null, plan: null };
                    }

                    if (hideBtn) {
                        aircraftInfoWindow.classList.remove('visible');
                        clearLiveFlightPath(currentFlightInWindow);
                        if (activePfdUpdateInterval) clearInterval(activePfdUpdateInterval);
                        if (activeGeocodeUpdateInterval) clearInterval(activeGeocodeUpdateInterval);
                        activePfdUpdateInterval = null;
                        activeGeocodeUpdateInterval = null;
                        if (currentFlightInWindow) {
                            aircraftInfoWindowRecallBtn.classList.add('visible', 'palpitate');
                            setTimeout(() => aircraftInfoWindowRecallBtn.classList.remove('palpitate'), 1000);
                        }
                    }
                });

                aircraftInfoWindowRecallBtn.addEventListener('click', () => {
                    if (currentFlightInWindow) {
                        const layer = sectorOpsMap.getLayer('sector-ops-live-flights-layer');
                        if (layer) {
                            const source = sectorOpsMap.getSource('sector-ops-live-flights-source');
                            const features = source._data.features;
                            const feature = features.find(f => f.properties.flightId === currentFlightInWindow);
                            if (feature) {
                                const props = feature.properties;
                                const flightProps = { ...props, position: JSON.parse(props.position) };
                                // Mock session ID for recall
                                handleAircraftClick(flightProps, 'mock-expert-session-id');
                            }
                        }
                    }
                });
                
                aircraftInfoWindow.dataset.eventsAttached = 'true';
            }

            /**
             * --- [MODIFIED] Initializes the Sector Ops View.
             * This is the main entry point for the map.
             */
            async function initializeSectorOpsView() {
                const mapContainer = document.getElementById('sector-ops-map-fullscreen');
                const viewContainer = document.getElementById('view-rosters');
                if (!mapContainer) return;

                mainContentLoader.classList.add('active');

                try {
                    // Inject Search Bar
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
                            </div>`;
                        viewContainer.insertAdjacentHTML('beforeend', searchHtml);
                    }

                    // Inject Info Windows
                    if (!document.getElementById('airport-info-window')) {
                        viewContainer.insertAdjacentHTML('beforeend', `
                            <div id="airport-info-window" class="info-window">
                                <div class="info-window-header">
                                    <h3 id="airport-window-title"></h3>
                                    <div class="info-window-actions">
                                        <button id="airport-window-hide-btn" title="Hide"><i class="fa-solid fa-compress"></i></button>
                                        <button id="airport-window-close-btn" title="Close"><i class="fa-solid fa-xmark"></i></button>
                                    </div>
                                </div>
                                <div id="airport-window-content" class="info-window-content"></div>
                            </div>`);
                    }
                    if (!document.getElementById('aircraft-info-window')) {
                        viewContainer.insertAdjacentHTML('beforeend', `<div id="aircraft-info-window" class="info-window"></div>`);
                    }
                    if (!document.getElementById('weather-settings-window')) {
                        viewContainer.insertAdjacentHTML('beforeend', `
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
                                        <li class="weather-toggle-item"><span class="weather-toggle-label"><i class="fa-solid fa-cloud-rain"></i> Precipitation</span><label class="toggle-switch"><input type="checkbox" id="weather-toggle-precip"><span class="toggle-slider"></span></label></li>
                                        <li class="weather-toggle-item"><span class="weather-toggle-label"><i class="fa-solid fa-cloud"></i> Cloud Cover</span><label class="toggle-switch"><input type="checkbox" id="weather-toggle-clouds"><span class="toggle-slider"></span></label></li>
                                        <li class="weather-toggle-item"><span class="weather-toggle-label"><i class="fa-solid fa-wind"></i> Wind Speed</span><label class="toggle-switch"><input type="checkbox" id="weather-toggle-wind"><span class="toggle-slider"></span></label></li>
                                    </ul>
                                    <div class="weather-disclaimer-note"><i class="fa-solid fa-server"></i><strong>Note:</strong> Weather layers require a valid OWM_API_KEY.</div>
                                </div>
                            </div>`);
                    }
                    if (!document.getElementById('filter-settings-window')) {
                        viewContainer.insertAdjacentHTML('beforeend', `
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
                                        <li class="filter-toggle-item"><span class="filter-toggle-label"><i class="fa-solid fa-plane-circle-check"></i> Show VA Members Only</span><label class="toggle-switch"><input type="checkbox" id="filter-toggle-members-only"><span class="toggle-slider"></span></label></li>
                                        <li class="filter-toggle-item"><span class="filter-toggle-label"><i class="fa-solid fa-tower-broadcast"></i> Hide Staffed Airports</span><label class="toggle-switch"><input type="checkbox" id="filter-toggle-atc"><span class="toggle-slider"></span></label></li>
                                        <li class="filter-toggle-item"><span class="filter-toggle-label"><i class="fa-solid fa-location-dot"></i> Hide Unstaffed Airports</span><label class="toggle-switch"><input type="checkbox" id="filter-toggle-no-atc"><span class="toggle-slider"></span></label></li>
                                        <li class="filter-toggle-item"><span class="filter-toggle-label"><i class="fa-solid fa-sun"></i> Light Mode</span><label class="toggle-switch"><input type="checkbox" id="filter-toggle-light-mode"><span class="toggle-slider"></span></label></li>
                                        <li class="filter-toggle-item"><span class="filter-toggle-label"><i class="fa-solid fa-satellite"></i> Satellite Mode</span><label class="toggle-switch"><input type="checkbox" id="filter-toggle-satellite-mode"><span class="toggle-slider"></span></label></li>
                                    </ul>
                                    <div class="filter-section-divider"><span class="filter-section-title">Active Flight Plan Display</span></div>
                                    <ul class="filter-toggle-list" id="plan-filter-group" style="padding-top: 8px;">
                                        <li class="filter-radio-item"><input type="radio" id="plan-filter-none" name="plan-display-mode" value="none" checked><label for="plan-filter-none"><i class="fa-solid fa-eye-slash"></i> Hide Plan</label></li>
                                        <li class="filter-radio-item"><input type="radio" id="plan-filter-direct" name="plan-display-mode" value="direct"><label for="plan-filter-direct"><i class="fa-solid fa-route"></i> Direct to Destination</label></li>
                                        <li class="filter-radio-item"><input type="radio" id="plan-filter-full" name="plan-display-mode" value="full"><label for="plan-filter-full"><i class="fa-solid fa-diagram-project"></i> Full Filed Plan</label></li>
                                    </ul>
                                    <div class="filter-section-divider"><span class="filter-section-title">Mobile Display Mode</span></div>
                                    <ul class="filter-toggle-list" id="mobile-mode-filter-group" style="padding-top: 8px;">
                                        <li class="filter-radio-item"><input type="radio" id="mobile-mode-hud" name="mobile-display-mode" value="hud" checked><label for="mobile-mode-hud"><i class="fa-solid fa-rocket"></i> HUD View</label></li>
                                        <li class="filter-radio-item"><input type="radio" id="mobile-mode-legacy" name="mobile-display-mode" value="legacy"><label for="mobile-mode-legacy"><i class="fa-solid fa-layer-group"></i> Legacy Sheet</label></li>
                                    </ul>
                                </div>
                            </div>`);
                    }
                    
                    // Inject Toolbar Buttons
                    const toolbarToggleBtn = document.getElementById('toolbar-toggle-panel-btn-group');
                    if (toolbarToggleBtn) {
                        if (!document.getElementById('airport-recall-btn')) {
                            toolbarToggleBtn.insertAdjacentHTML('afterend', `
                                <button id="airport-recall-btn" class="toolbar-btn" title="Show Airport Info"><i class="fa-solid fa-location-dot"></i></button>
                                <button id="aircraft-recall-btn" class="toolbar-btn" title="Show Aircraft Info"><i class="fa-solid fa-plane-up"></i></button>
                                <button id="open-weather-settings-btn" class="toolbar-btn" title="Weather Settings"><i class="fa-solid fa-cloud-sun"></i></button>
                                <button id="open-filter-settings-btn" class="toolbar-btn" title="Map Filters"><i class="fa-solid fa-filter"></i></button>
                            `);
                        }
                    }
                    
                    // Assign global DOM vars
                    airportInfoWindow = document.getElementById('airport-info-window');
                    airportInfoWindowRecallBtn = document.getElementById('airport-recall-btn');
                    aircraftInfoWindow = document.getElementById('aircraft-info-window');
                    aircraftInfoWindowRecallBtn = document.getElementById('aircraft-recall-btn');
                    weatherSettingsWindow = document.getElementById('weather-settings-window');
                    filterSettingsWindow = document.getElementById('filter-settings-window');

                    // Set a default hub (from mock data)
                    const selectedHub = "VIDP"; 

                    // Initialize the Mapbox map
                    await initializeSectorOpsMap(selectedHub);

                    // Fetch data
                    await fetchAndRenderRoutes(); // This now uses the stub
                    renderAirportMarkers();

                    // Set up all event listeners
                    setupSectorOpsEventListeners();
                    setupAirportWindowEvents();
                    setupAircraftWindowEvents();
                    setupWeatherSettingsWindowEvents();
                    setupFilterSettingsWindowEvents();
                    setupSearchEventListeners();

                    // Start the live data loop
                    startSectorOpsLiveLoop();

                } catch (error) {
                    console.error("Error initializing Sector Ops view:", error);
                    showNotification(error.message, 'error');
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
                    style: currentMapStyle, 
                    center: centerCoords,
                    zoom: 4.5,
                    interactive: true,
                    projection: 'globe'
                });

                async function setupMapLayersAndFog() {
                    sectorOpsMap.setFog({
                        color: 'rgb(186, 210, 235)', 'high-color': 'rgb(36, 92, 223)',
                        'horizon-blend': 0.02, 'space-color': 'rgb(11, 11, 25)', 'star-intensity': 0.6
                    });

                    // Load all aircraft icons
                    const iconsToLoad = [
                        { id: 'icon-jumbo', path: 'https://i.imgur.com/L3gR3R8.png' }, { id: 'icon-widebody', path: 'https://i.imgur.com/z0aD4v9.png' },
                        { id: 'icon-narrowbody', path: 'https://i.imgur.com/z7n0nCB.png' }, { id: 'icon-regional', path: 'https://i.imgur.com/pY2pGjE.png' },
                        { id: 'icon-private', path: 'https://i.imgur.com/r62S8U3.png' }, { id: 'icon-fighter', path: 'https://i.imgur.com/mY7Yj9S.png' },
                        { id: 'icon-default', path: 'https://i.imgur.com/cQ0mXHB.png' }, { id: 'icon-military', path: 'https://i.imgur.com/dEaD8xO.png' },
                        { id: 'icon-cessna', path: 'https://i.imgur.com/tF95Ais.png' },
                        { id: 'icon-jumbo-member', path: 'https://i.imgur.com/HqNqeP8.png' }, { id: 'icon-widebody-member', path: 'https://i.imgur.com/jM8Nwn5.png' },
                        { id: 'icon-narrowbody-member', path: 'https://i.imgur.com/sNn3FfM.png' }, { id: 'icon-regional-member', path: 'https://i.imgur.com/aCgNqTS.png' },
                        { id: 'icon-private-member', path: 'https://i.imgur.com/P1iNf1b.png' }, { id: 'icon-fighter-member', path: 'https://i.imgur.com/qL7yP24.png' },
                        { id: 'icon-default-member', path: 'https://i.imgur.com/dKqkhkK.png' }, { id: 'icon-military-member', path: 'https://i.imgur.com/1ZCxGAY.png' },
                        { id: 'icon-cessna-member', path: 'https://i.imgur.com/J3t5W3U.png' },
                        { id: 'icon-jumbo-staff', path: 'https://i.imgur.com/h5T2XN6.png' }, { id: 'icon-widebody-staff', path: 'https://i.imgur.com/jI6CqjM.png' },
                        { id: 'icon-narrowbody-staff', path: 'https://i.imgur.com/mFzWGlC.png' }, { id: 'icon-regional-staff', path: 'https://i.imgur.com/dYn1e1E.png' },
                        { id: 'icon-private-staff', path: 'https://i.imgur.com/sZl5tS3.png' }, { id: 'icon-fighter-staff', path: 'https://i.imgur.com/N18mJ3j.png' },
                        { id: 'icon-default-staff', path: 'https://i.imgur.com/sV5gE5A.png' }, { id: 'icon-military-staff', path: 'https://i.imgur.com/T0gCg2b.png' },
                        { id: 'icon-cessna-staff', path: 'https://i.imgur.com/1nQ7E21.png' }
                    ];

                    const imagePromises = iconsToLoad.map(icon =>
                        new Promise((res, rej) => {
                            if (sectorOpsMap.hasImage(icon.id)) { res(); return; }
                            sectorOpsMap.loadImage(icon.path, (error, image) => {
                                if (error) { console.warn(`Could not load icon: ${icon.path}`); rej(error); } 
                                else { sectorOpsMap.addImage(icon.id, image); res(); }
                            });
                        })
                    );
                    await Promise.all(imagePromises).catch(err => console.error("Error loading map icons", err));
                    
                    if (!sectorOpsMap.getSource('sector-ops-live-flights-source')) {
                        sectorOpsMap.addSource('sector-ops-live-flights-source', {
                            type: 'geojson',
                            data: { type: 'FeatureCollection', features: Object.values(currentMapFeatures) } 
                        });
                    }

                    if (!sectorOpsMap.getLayer('sector-ops-live-flights-layer')) {
                        sectorOpsMap.addLayer({
                            id: 'sector-ops-live-flights-layer',
                            type: 'symbol',
                            source: 'sector-ops-live-flights-source',
                            layout: {
                                'icon-image': [
                                    'case',
                                    ['==', ['get', 'isStaff'], true],
                                    ['match', ['get', 'category'], 'jumbo', 'icon-jumbo-staff', 'widebody', 'icon-widebody-staff', 'narrowbody', 'icon-narrowbody-staff', 'regional', 'icon-regional-staff', 'private', 'icon-private-staff', 'fighter', 'icon-fighter-staff', 'military', 'icon-military-staff', 'cessna', 'icon-cessna-staff', 'icon-default-staff'],
                                    ['==', ['get', 'isVAMember'], true],
                                    ['match', ['get', 'category'], 'jumbo', 'icon-jumbo-member', 'widebody', 'icon-widebody-member', 'narrowbody', 'icon-narrowbody-member', 'regional', 'icon-regional-member', 'private', 'icon-private-member', 'fighter', 'icon-fighter-member', 'military', 'icon-military-member', 'cessna', 'icon-cessna-member', 'icon-default-member'],
                                    ['match', ['get', 'category'], 'jumbo', 'icon-jumbo', 'widebody', 'icon-widebody', 'narrowbody', 'icon-narrowbody', 'regional', 'icon-regional', 'private', 'icon-private', 'fighter', 'icon-fighter', 'military', 'icon-military', 'cessna', 'icon-cessna', 'icon-default']
                                ],
                                'icon-size': 0.08,
                                'icon-rotate': ['get', 'heading'],
                                'icon-rotation-alignment': 'map',
                                'icon-allow-overlap': true,
                                'icon-ignore-placement': true
                            }
                        });

                        sectorOpsMap.on('click', 'sector-ops-live-flights-layer', (e) => {
                            const props = e.features[0].properties;
                            const flightProps = { ...props, position: JSON.parse(props.position), aircraft: JSON.parse(props.aircraft) };
                            // Mock session ID
                            handleAircraftClick(flightProps, 'mock-expert-session-id');
                        });
                        sectorOpsMap.on('mouseenter', 'sector-ops-live-flights-layer', () => { sectorOpsMap.getCanvas().style.cursor = 'pointer'; });
                        sectorOpsMap.on('mouseleave', 'sector-ops-live-flights-layer', () => { sectorOpsMap.getCanvas().style.cursor = ''; });
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

            function clearRouteLayers() {
                sectorOpsMapRouteLayers.forEach(id => {
                    if (sectorOpsMap.getLayer(id)) sectorOpsMap.removeLayer(id);
                    if (sectorOpsMap.getSource(id)) sectorOpsMap.removeSource(id);
                });
                sectorOpsMapRouteLayers = [];
            }

            function clearLiveFlightPath(flightId) {
                if (!sectorOpsMap || !flightId) return;
                const layers = sectorOpsLiveFlightPathLayers[flightId];
                if (!layers) return;
                Object.values(layers).forEach(layerId => {
                    if (layerId) {
                        if (sectorOpsMap.getLayer(layerId)) sectorOpsMap.removeLayer(layerId);
                        if (sectorOpsMap.getSource(layerId)) sectorOpsMap.removeSource(layerId);
                    }
                });
                delete sectorOpsLiveFlightPathLayers[flightId];
            }

            function rebuildDynamicLayers() {
                console.log("Rebuilding dynamic layers...");
                if (document.getElementById('weather-toggle-precip')?.checked) { isWeatherLayerAdded = false; toggleWeatherLayer(true); }
                if (document.getElementById('weather-toggle-clouds')?.checked) { isCloudLayerAdded = false; toggleCloudLayer(true); }
                if (document.getElementById('weather-toggle-wind')?.checked) { isWindLayerAdded = false; toggleWindLayer(true); }
                if (currentAirportInWindow) plotRoutesFromAirport(currentAirportInWindow);

                if (currentFlightInWindow) {
                    const flightId = currentFlightInWindow;
                    clearLiveFlightPath(flightId); 
                    delete sectorOpsLiveFlightPathLayers[flightId]; 
                    const { flightProps, plan } = cachedFlightDataForStatsView; 
                    if (flightProps) {
                        const localTrail = liveTrailCache.get(flightId) || [];
                        const currentPosition = currentAircraftPositionForGeocode || flightProps.position;
                        const routeFeatureCollection = generateAltitudeColoredRoute(localTrail, currentPosition);
                        sectorOpsMap.addSource(`flown-path-${flightId}`, { type: 'geojson', data: routeFeatureCollection });
                        sectorOpsMap.addLayer({
                            id: `flown-path-${flightId}`, type: 'line', source: `flown-path-${flightId}`,
                            paint: {
                                'line-color': ['interpolate', ['linear'], ['get', 'avgAltitude'], 0, '#e6e600', 10000, '#ff9900', 20000, '#ff3300', 29000, '#00BFFF', 38000, '#9400D3'],
                                'line-width': 4, 'line-opacity': 0.9
                            }
                        }, 'sector-ops-live-flights-layer');
                        sectorOpsLiveFlightPathLayers[flightId] = { flown: `flown-path-${flightId}` };
                        if (plan) {
                            updateFlightPlanLayer(flightId, plan, position);
                        }
                    }
                }
                updateAircraftLayerFilter();
                renderAirportMarkers();
            }

            function updateFlightPlanLayer(flightId, plan, currentPosition) {
                if (!sectorOpsMap || !plan || !plan.flightPlanItems || plan.flightPlanItems.length < 2) return;
                const layerIdDirect = `plan-path-direct-${flightId}`, layerIdFull = `plan-path-full-${flightId}`;
                if (!sectorOpsLiveFlightPathLayers[flightId]) sectorOpsLiveFlightPathLayers[flightId] = {};
                sectorOpsLiveFlightPathLayers[flightId].planDirect = layerIdDirect;
                sectorOpsLiveFlightPathLayers[flightId].planFull = layerIdFull;
                
                const allWaypoints = flattenWaypointsFromPlan(plan.flightPlanItems);
                if (allWaypoints.length < 2) return;
                const destinationCoords = allWaypoints[allWaypoints.length - 1];
                const currentCoords = [currentPosition.lon, currentPosition.lat];

                if (mapFilters.planDisplayMode === 'direct') {
                    const directLineData = { type: 'Feature', geometry: { type: 'LineString', coordinates: [currentCoords, destinationCoords] } };
                    const source = sectorOpsMap.getSource(layerIdDirect);
                    if (source) source.setData(directLineData);
                    else {
                        sectorOpsMap.addSource(layerIdDirect, { type: 'geojson', data: directLineData });
                        sectorOpsMap.addLayer({ id: layerIdDirect, type: 'line', source: layerIdDirect, paint: { 'line-color': '#00a8ff', 'line-width': 2, 'line-opacity': 0.8, 'line-dasharray': [2, 2] } }, 'sector-ops-live-flights-layer');
                    }
                } else {
                    if (sectorOpsMap.getLayer(layerIdDirect)) sectorOpsMap.removeLayer(layerIdDirect);
                    if (sectorOpsMap.getSource(layerIdDirect)) sectorOpsMap.removeSource(layerIdDirect);
                }

                if (mapFilters.planDisplayMode === 'full') {
                    const source = sectorOpsMap.getSource(layerIdFull);
                    if (!source) {
                        const fullLineData = { type: 'Feature', geometry: { type: 'LineString', coordinates: allWaypoints } };
                        sectorOpsMap.addSource(layerIdFull, { type: 'geojson', data: fullLineData });
                        sectorOpsMap.addLayer({ id: layerIdFull, type: 'line', source: layerIdFull, paint: { 'line-color': '#00a8ff', 'line-width': 2, 'line-opacity': 0.8 } }, 'sector-ops-live-flights-layer');
                    }
                } else {
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

                const titleEl = document.getElementById('airport-window-title');
                const contentEl = document.getElementById('airport-window-content');
                titleEl.innerHTML = `${icao} <small>- ${airport.name || 'Airport'}</small>`;
                contentEl.innerHTML = `<div class="spinner-small" style="margin: 2rem auto;"></div>`; 
                MobileUIHandler.openWindow(airportInfoWindow);
                airportInfoWindow.classList.add('visible');
                airportInfoWindowRecallBtn.classList.remove('visible');
                currentAirportInWindow = icao;

                const windowContentHTML = await createAirportInfoWindowHTML(icao);

                if (windowContentHTML) {
                    contentEl.innerHTML = windowContentHTML;
                    contentEl.scrollTop = 0;
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
            
            function getFlatWaypointObjects(items) {
                const waypoints = [];
                if (!Array.isArray(items)) return waypoints;
                const extract = (planItems) => {
                    for (const item of planItems) {
                        if (Array.isArray(item.children) && item.children.length > 0) extract(item.children);
                        else if (item.location && typeof item.location.longitude === 'number' && typeof item.location.latitude === 'number' && (item.location.latitude !== 0 || item.location.longitude !== 0)) {
                            waypoints.push(item); 
                        }
                    }
                };
                extract(items);
                return waypoints;
            }
            
            function flattenWaypointsFromPlan(items) {
                const waypoints = [];
                if (!Array.isArray(items)) return waypoints;
                const extract = (planItems) => {
                    for (const item of planItems) {
                        if (Array.isArray(item.children) && item.children.length > 0) extract(item.children);
                        else if (item.location && typeof item.location.longitude === 'number' && typeof item.location.latitude === 'number' && (item.location.latitude !== 0 || item.location.longitude !== 0)) {
                            waypoints.push([item.location.longitude, item.location.latitude]);
                        }
                    }
                };
                extract(items);
                return waypoints;
            }

            function generateAltitudeColoredRoute(sortedPoints, currentPosition) {
                const features = [];
                const allPoints = [
                    ...sortedPoints.map(p => ({ longitude: p.longitude, latitude: p.latitude, altitude: p.altitude })),
                    { longitude: currentPosition.lon, latitude: currentPosition.lat, altitude: currentPosition.alt_ft }
                ];
                for (let i = 0; i < allPoints.length - 1; i++) {
                    const p1 = allPoints[i], p2 = allPoints[i + 1];
                    if (!p1 || !p2 || p1.longitude == null || p1.latitude == null || p2.longitude == null || p2.latitude == null) continue;
                    const coords = [[p1.longitude, p1.latitude], [p2.longitude, p2.latitude]];
                    const alt1 = p1.altitude || 0, alt2 = p2.altitude || 0, avgAltitude = (alt1 + alt2) / 2;
                    features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { avgAltitude: avgAltitude } });
                }
                return { type: 'FeatureCollection', features: features };
            }

            async function handleAircraftClick(flightProps, sessionId) {
                if (!flightProps || !flightProps.flightId) return;
                if (isAircraftWindowLoading) return;
                if (currentFlightInWindow === flightProps.flightId && aircraftInfoWindow.classList.contains('visible')) return;
                isAircraftWindowLoading = true;
                if (activePfdUpdateInterval) { clearInterval(activePfdUpdateInterval); activePfdUpdateInterval = null; }
                if (activeGeocodeUpdateInterval) { clearInterval(activeGeocodeUpdateInterval); activeGeocodeUpdateInterval = null; }
                resetPfdState();
                if (currentFlightInWindow && currentFlightInWindow !== flightProps.flightId) {
                    clearLiveFlightPath(currentFlightInWindow);
                    liveTrailCache.delete(currentFlightInWindow);
                }
                currentFlightInWindow = flightProps.flightId; 
                currentAircraftPositionForGeocode = flightProps.position; 
                lastGeocodeCoords = { lat: 0, lon: 0 }; 
                cachedFlightDataForStatsView = { flightProps: null, plan: null }; 
                if (window.MobileUIHandler && window.MobileUIHandler.isMobile()) window.MobileUIHandler.openWindow(aircraftInfoWindow);
                else aircraftInfoWindow.classList.add('visible');
                aircraftInfoWindowRecallBtn.classList.remove('visible');
                const windowEl = document.getElementById('aircraft-info-window');
                windowEl.innerHTML = `<div class="spinner-small" style="margin: 2rem auto;"></div><p style="text-align: center;">Loading flight data...</p>`;

                try {
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
                        sortedRoutePoints = routeData.route.sort((a, b) => (new Date(a.date).getTime() || 0) - (new Date(b.date).getTime() || 0));
                    }
                    liveTrailCache.set(flightProps.flightId, sortedRoutePoints);
                    cachedFlightDataForStatsView = { flightProps, plan };
                    populateAircraftInfoWindow(flightProps, plan, sortedRoutePoints);
                    fetchAndDisplayGeocode(flightProps.position.lat, flightProps.position.lon);
                    const routeFeatureCollection = generateAltitudeColoredRoute(sortedRoutePoints, flightProps.position);
                    if (!sectorOpsMap.getSource(flownLayerId)) {
                        sectorOpsMap.addSource(flownLayerId, { type: 'geojson', data: routeFeatureCollection });
                        sectorOpsMap.addLayer({
                            id: flownLayerId, type: 'line', source: flownLayerId,
                            paint: { 'line-color': ['interpolate', ['linear'], ['get', 'avgAltitude'], 0, '#e6e600', 10000, '#ff9900', 20000, '#ff3300', 29000, '#00BFFF', 38000, '#9400D3'], 'line-width': 4, 'line-opacity': 0.9 }
                        }, 'sector-ops-live-flights-layer');
                    } else {
                        sectorOpsMap.getSource(flownLayerId).setData(routeFeatureCollection);
                    }
                    sectorOpsLiveFlightPathLayers[flightProps.flightId] = { flown: flownLayerId };
                    if (plan) updateFlightPlanLayer(flightProps.flightId, plan, flightProps.position);
                    
                    activeGeocodeUpdateInterval = setInterval(() => {
                        if (currentAircraftPositionForGeocode) {
                            fetchAndDisplayGeocode(currentAircraftPositionForGeocode.lat, currentAircraftPositionForGeocode.lon);
                        }
                    }, 60000); 

                    activePfdUpdateInterval = setInterval(async () => {
                        try {
                            const freshDataRes = await fetch(`${LIVE_FLIGHTS_API_URL}/${sessionId}`);
                            if (!freshDataRes.ok) throw new Error("Flight data update failed.");
                            const allFlights = await freshDataRes.json();
                            const updatedFlight = allFlights.flights.find(f => f.flightId === flightProps.flightId);
                            const localTrail = liveTrailCache.get(flightProps.flightId);
                            if (!localTrail) throw new Error("Local trail cache was lost.");

                            if (updatedFlight && updatedFlight.position) {
                                currentAircraftPositionForGeocode = updatedFlight.position;
                                updatePfdDisplay(updatedFlight.position);
                                const newRoutePoint = {
                                    latitude: updatedFlight.position.lat, longitude: updatedFlight.position.lon, altitude: updatedFlight.position.alt_ft,
                                    groundSpeed: updatedFlight.position.gs_kt, track: updatedFlight.position.heading_deg, 
                                    date: new Date(updatedFlight.position.lastReport || Date.now()).toISOString()
                                };
                                localTrail.push(newRoutePoint);
                                liveTrailCache.set(flightProps.flightId, localTrail);
                                updateAircraftInfoWindow(updatedFlight, plan, localTrail);
                                const layerId = sectorOpsLiveFlightPathLayers[flightProps.flightId]?.flown;
                                const source = layerId ? sectorOpsMap.getSource(layerId) : null;
                                if (source) {
                                    const newRouteData = generateAltitudeColoredRoute(localTrail, updatedFlight.position);
                                    source.setData(newRouteData);
                                }
                                if (plan && mapFilters.planDisplayMode === 'direct') {
                                    updateFlightPlanLayer(flightProps.flightId, plan, updatedFlight.position);
                                }
                            } else {
                                clearInterval(activePfdUpdateInterval); activePfdUpdateInterval = null;
                                if (activeGeocodeUpdateInterval) clearInterval(activeGeocodeUpdateInterval); activeGeocodeUpdateInterval = null;
                                liveTrailCache.delete(flightProps.flightId);
                            }
                        } catch (error) {
                            console.error("Stopping PFD update due to error:", error);
                            clearInterval(activePfdUpdateInterval); activePfdUpdateInterval = null;
                            if (activeGeocodeUpdateInterval) clearInterval(activeGeocodeUpdateInterval); activeGeocodeUpdateInterval = null;
                            liveTrailCache.delete(flightProps.flightId);
                        }
                    }, 3000); 
                    isAircraftWindowLoading = false;
                } catch (error) {
                    console.error("Error fetching or plotting aircraft details:", error);
                    windowEl.innerHTML = `<p class="error-text" style="padding: 2rem;">Could not retrieve complete flight details.</p>`;
                    isAircraftWindowLoading = false; 
                    currentFlightInWindow = null; 
                    cachedFlightDataForStatsView = { flightProps: null, plan: null };
                    liveTrailCache.delete(flightProps.flightId);
                }
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
            <button class="ac-info-tab-btn active" data-tab="ac-tab-flight-data">
                <i class="fa-solid fa-gauge-high"></i> Flight Display
            </button>
            <button class="ac-info-tab-btn" data-tab="ac-tab-pilot-report" data-user-id="${baseProps.userId}" data-username="${baseProps.username || 'N/A'}">
                <i class="fa-solid fa-chart-simple"></i> Pilot Report
            </button>
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

        // Tab switching now ONLY changes the panel content
        panel.querySelector('.panel-tabs')?.addEventListener('click', (e) => {
            const tabLink = e.target.closest('.tab-link');
            if (!tabLink) return;
            
            panel.querySelectorAll('.tab-link, .tab-content').forEach(el => el.classList.remove('active'));
            const tabId = tabLink.dataset.tab;
            tabLink.classList.add('active');
            panel.querySelector(`#${tabId}`).classList.add('active');
        });

        // Hub selector only updates the roster list. Map is independent.
        panel.querySelector('#departure-hub-selector')?.addEventListener('change', async (e) => {
            const selectedHub = e.target.value;
            await fetchAndRenderRosters(selectedHub);
        });

        // Route search/filter (for the global list)
        panel.querySelector('#route-search-input')?.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toUpperCase().trim();
            document.querySelectorAll('#route-list-container .route-card').forEach(card => {
                const departure = card.dataset.departure;
                const arrival = card.dataset.arrival;
                const aircraft = card.dataset.aircraft;
                const operator = card.dataset.operator.toUpperCase();
                
                const isMatch = (
                    departure.includes(searchTerm) ||
                    arrival.includes(searchTerm) ||
                    aircraft.includes(searchTerm) ||
                    operator.includes(searchTerm)
                );
                card.style.display = isMatch ? 'flex' : 'none';
            });
        });

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

    // --- [NEW] Read settings from localStorage on window open ---
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
    // --- [END NEW] ---

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
            if (currentFlightInWindow && cachedFlightDataForStatsView.plan) {
                const { flightProps, plan } = cachedFlightDataForStatsView;
                const position = currentAircraftPositionForGeocode || flightProps.position;
                updateFlightPlanLayer(currentFlightInWindow, plan, position);
            }
            return;
        }
        
        // --- [START NEW] Handle Mobile Display Mode Radio Logic ---
        if (target.name === 'mobile-display-mode') {
            const newMode = target.value;
            localStorage.setItem('mobileDisplayMode', newMode);
            // Show a note that a change requires re-opening the window
            if (!document.getElementById('mobile-mode-note')) {
                document.getElementById('mobile-mode-filter-group').insertAdjacentHTML(
                    'beforeend',
                    '<p id="mobile-mode-note" class="muted-text" style="padding: 10px 0 0 0; text-align: left; font-size: 0.8rem;">Changes will apply the next time you open an aircraft window.</p>'
                );
            }
            return; // Stop processing
        }
        // --- [END NEW] ---

        if (target.type !== 'checkbox') return;

        // --- Handle Map Style Logic ---
        const lightModeToggle = document.getElementById('filter-toggle-light-mode');
        const satelliteModeToggle = document.getElementById('filter-toggle-satellite-mode');
        let styleChanged = false;
        let newMapStyle = currentMapStyle;

        if (target.id === 'filter-toggle-light-mode' && target.checked) {
            if (satelliteModeToggle) satelliteModeToggle.checked = false;
            newMapStyle = MAP_STYLE_LIGHT;
            styleChanged = true;
        } else if (target.id === 'filter-toggle-satellite-mode' && target.checked) {
            if (lightModeToggle) lightModeToggle.checked = false;
            newMapStyle = MAP_STYLE_SATELLITE;
            styleChanged = true;
        } else if ((target.id === 'filter-toggle-light-mode' || target.id === 'filter-toggle-satellite-mode') && !target.checked) {
            if (!lightModeToggle.checked && !satelliteModeToggle.checked) {
                newMapStyle = MAP_STYLE_DARK; // Revert to dark
                styleChanged = true;
            }
        }

        // 1. Update the global mapFilters state object from the DOM
        mapFilters.showVaOnly = document.getElementById('filter-toggle-members-only')?.checked || false;
        mapFilters.hideAtcMarkers = document.getElementById('filter-toggle-atc')?.checked || false;
        mapFilters.hideNoAtcMarkers = document.getElementById('filter-toggle-no-atc')?.checked || false;
        
        // 2. Decide whether to change style or just filters
        if (styleChanged && newMapStyle !== currentMapStyle) {
            console.log(`Changing map style to: ${newMapStyle}`);
            currentMapStyle = newMapStyle;
            sectorOpsMap.setStyle(currentMapStyle);
        } else if (!styleChanged) {
            updateMapFilters();
        }

        // 3. Update toolbar button state (always)
        updateMapFilters();
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

    // --- [REPLACEMENT for startSectorOpsLiveLoop] ---
// This function is updated to only connect to the WebSocket and 
// set up the poller for ATC/NOTAMs.
function startSectorOpsLiveLoop() {
    stopSectorOpsLiveLoop(); // Clear any old loops

    // 1. Start the data fetching loop for ATC/NOTAMs (infrequent)
    updateSectorOpsSecondaryData(); // Fetch immediately
    sectorOpsAtcNotamInterval = setInterval(updateSectorOpsSecondaryData, DATA_REFRESH_INTERVAL_MS); 

    // 2. Initialize and connect the WebSocket
    // This is responsible for receiving flight data
    initializeSectorOpsSocket();

    // 3. Animation loop is no longer started here.
    // Data updates happen directly in handleSocketFlightUpdate.
}


// --- [REPLACEMENT for stopSectorOpsLiveLoop] ---
// This function is updated to stop the socket
// and clear the ATC/NOTAM poller.
function stopSectorOpsLiveLoop() {
    // 1. Clear the data-fetching interval for ATC/NOTAMs
    if (sectorOpsAtcNotamInterval) {
        clearInterval(sectorOpsAtcNotamInterval);
        sectorOpsAtcNotamInterval = null;
    }
    
    // 2. Disconnect the WebSocket and remove listeners
    if (sectorOpsSocket) {
        console.log('Socket: Disconnecting from Sector Ops...');
        sectorOpsSocket.disconnect();
        sectorOpsSocket = null;
    }

    // 3. NEW: Clear the feature state to prevent stale aircraft
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

async function fetchFleetData() {
        try {
            const response = await fetch(`${API_BASE_URL}/api/aircrafts`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) {
                throw new Error('Could not load fleet data from the server.');
            }
            DYNAMIC_FLEET = await response.json();
        } catch (error) {
            console.error('Error fetching dynamic fleet:', error);
            showNotification('Could not load the aircraft library. Some features may not work.', 'error');
            DYNAMIC_FLEET = [];
        }
    }

    async function initializeApp() {
        mainContentLoader.classList.add('active');

        // Fetch essential data in parallel
        await Promise.all([
            fetchApiKeys(),
            fetchAirportsData(),
            fetchRunwaysData()
        ]);
        
        // This was the main function call in your original script
        await initializeSectorOpsView(); 
        
        mainContentLoader.classList.remove('active');
    }

    // --- Start the application ---
    initializeApp();
});