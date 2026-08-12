// historicalFlightWindow.js
// The app's own flight window, opened for a flight that is no longer flying.
//
// Global playback needed the same window a live tap opens — in whichever of
// the three looks the pilot has already chosen in Settings, because a second
// opinion about how a flight should be presented is not something this app
// should hold.
//
// It cannot go through handleAircraftClick. That fetches the live route, the
// filed plan and the geocode, starts the PFD and geocode intervals, and files
// the flight in Recents — all of it about an aircraft currently in the air.
// Infinite Flight serves plans and routes for live flights only, so for a
// window from last Tuesday there is nothing on the other end of any of those
// calls.
//
// What a replay does have is the recorded track, and that carries most of the
// window: formatDataForSimpleWindow derives elapsed time, distance flown, the
// phase of flight and the readouts from routePoints alone. The fields that
// genuinely need a filed plan — origin, destination, waypoints — come through
// as their own "no data" state, which is honest. Inventing an origin from the
// first recorded position would be a guess wearing an ICAO code, and this
// window is read as fact.
//
// This lives outside flight.js so it can be driven without a Mapbox context,
// an API and an hour of recorded traffic — see tools/test-historical-window.js.
// Every collaborator is injected for the same reason.

/**
 * @param {object} deps
 * @param {() => HTMLElement|null} deps.windowEl        the #aircraft-info-window element
 * @param {() => string} deps.getFlightWindowMode       'legacy' | 'simple' | 'embed'
 * @param {(id: string|null) => void} deps.setCurrentFlight
 * @param {() => string|null} deps.getCurrentFlight
 * @param {() => boolean} deps.isMobile
 * @param {object} deps.ui   the flight.js helpers this window is assembled from
 */
export function createHistoricalFlightWindow(deps) {
    const {
        windowEl, getFlightWindowMode, setCurrentFlight, getCurrentFlight,
        isMobile, ui
    } = deps;

    const MARK = 'historical-flight';

    function flightPropsFrom(data) {
        const pos = data.position || {};
        return {
            flightId: data.flightId,
            callsign: data.callsign || '----',
            username: data.username || '',
            userId: data.userId || null,
            aircraft: {
                aircraftName: data.aircraftName || '',
                liveryName: data.liveryName || '',
                registration: null
            },
            position: {
                lat: pos.lat, lon: pos.lon,
                alt_ft: pos.alt_ft, gs_kt: pos.gs_kt,
                heading_deg: pos.heading_deg, vs_fpm: pos.vs_fpm
            },
            // Every downstream "is this live?" check reads false off this. The
            // window must not offer to follow, share or re-centre on an
            // aircraft that landed two weeks ago.
            isHistorical: true
        };
    }

    // The recorded track in the shape the live path endpoint returns. Readers
    // accept lat/latitude either way, but `date` is the one every caller
    // parses, so it is always an ISO string.
    //
    // Truncated at the replay clock: handing over the whole track would show a
    // flight that has already landed while the replay is mid-ocean.
    function routePointsFrom(track, untilMs) {
        if (!Array.isArray(track)) return [];
        const out = [];
        for (const p of track) {
            if (untilMs != null && p.t > untilMs) break;
            out.push({
                date: new Date(p.t).toISOString(),
                latitude: p.lat, longitude: p.lon,
                altitude: p.alt, speed: p.gs, track: p.hdg
            });
        }
        return out;
    }

    function open(data) {
        if (!data || !data.flightId) return false;
        const el = windowEl();
        if (!el) return false;

        const flightProps = flightPropsFrom(data);
        const routePoints = routePointsFrom(data.track, data.atMs);
        const mode = getFlightWindowMode();
        const onMobile = isMobile();

        setCurrentFlight(data.flightId);
        el.classList.add(MARK);

        if (mode === 'simple' || mode === 'embed') {
            ui.primeSimpleWindowPeekHeight();
            // Mobile opens in the collapsed peek bar the sheet gestures expect;
            // desktop has no peek concept and goes straight to the full layout.
            const phase = onMobile ? 'collapsed' : 'expanded';
            ui.applySimpleWindowPhase(phase);
            const src = mode === 'embed'
                ? ('embed-flight.html' + (onMobile ? '' : '?desktop=1'))
                : 'flightinfo.html';
            ui.setInfoWindowContent(el, `<iframe id="simple-flight-window-frame" src="${src}" style="width:100%; height:100%; border:none; display:block;" scrolling="no"></iframe>`);
            const payload = ui.formatDataForSimpleWindow(flightProps, null, routePoints, null, null);
            const iframe = document.getElementById('simple-flight-window-frame');
            if (iframe) {
                iframe.onload = () => {
                    iframe.contentWindow.postMessage({ type: 'FLIGHT_DATA_UPDATE', payload }, '*');
                    if (phase === 'expanded') {
                        iframe.contentWindow.postMessage({ type: 'SET_PHASE', phase: 'expanded' }, '*');
                    }
                };
            }
        } else {
            ui.populateAircraftInfoWindow(flightProps, null, routePoints, null, null);
        }

        if (onMobile) ui.openMobileWindow(el);
        else el.classList.add('visible');
        return true;
    }

    // Called as the replay clock advances. The content is already mounted, so
    // this only re-posts the numbers — swapping the iframe every frame would
    // reload the document underneath the reader.
    function update(data) {
        if (!data || data.flightId !== getCurrentFlight()) return false;
        const el = windowEl();
        if (!el || !el.classList.contains(MARK)) return false;

        const flightProps = flightPropsFrom(data);
        const routePoints = routePointsFrom(data.track, data.atMs);
        const iframe = document.getElementById('simple-flight-window-frame');
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({
                type: 'FLIGHT_DATA_UPDATE',
                payload: ui.formatDataForSimpleWindow(flightProps, null, routePoints, null, null)
            }, '*');
        } else {
            ui.populateAircraftInfoWindow(flightProps, null, routePoints, null, null);
        }
        return true;
    }

    function close() {
        const el = windowEl();
        if (!el || !el.classList.contains(MARK)) return false;
        el.classList.remove(MARK);
        setCurrentFlight(null);
        ui.closeAircraftWindow();
        return true;
    }

    return { open, update, close, _internals: { flightPropsFrom, routePointsFrom } };
}
