/**
 * natTracksLayer.js (Mapbox GL JS Version)
 * Updated: Added support for toggling labels, full track visibility, 
 * and persistent rendering across map style changes.
 */

const ACARS_SOCKET_URL = 'https://site--acars-backend--6dmjph8ltlhv.code.run';

const TRACK_COLOR_EXPRESSION = [
    'match',
    ['get', 'name'],
    'A', '#ff4d4d',
    'B', '#ffcc00',
    'C', '#2ecc71',
    'D', '#a29bfe',
    'E', '#e67e22',
    'F', '#00cec9',
    '#3498db'
];

// Pacific tracks are lettered (eastbound) and numbered (westbound) well past
// the NAT's A–F, so each track is coloured by its position in the day's list.
const PACIFIC_PALETTE = ['#38bdf8', '#f472b6', '#facc15', '#34d399', '#a78bfa', '#fb923c', '#22d3ee', '#f87171', '#a3e635', '#e879f9', '#60a5fa', '#fbbf24'];

// Pacific tracks come from the site's own proxy of the real-world PACOTS
// messages (netlify/functions/pacific-tracks.js); Infinite Flight's API only
// carries the North Atlantic set.
function pacificUrl() {
    const onSite = typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol) && window.location.hostname !== 'localhost';
    return (onSite ? '' : 'https://inflight.info') + '/.netlify/functions/pacific-tracks';
}

export class NatTracksLayer {
    /**
     * @param {Object} opts
     *   kind: 'NAT' (default) | 'PACOTS' — which set of tracks this layer draws.
     *   Layer/source ids are prefixed by kind so both can be on the map at once.
     */
    constructor(map, opts = {}) {
        this.map = map;
        this.kind = opts.kind === 'PACOTS' ? 'PACOTS' : 'NAT';
        const prefix = this.kind === 'PACOTS' ? 'pacots' : 'nat';
        this.sourceId = `${prefix}-tracks-source`;
        this.lineLayerId = `${prefix}-tracks-layer`;
        this.labelLayerId = `${prefix}-tracks-labels`;
        this.bgLayerId = `${prefix}-tracks-bg-circles`;
        this.colorExpr = this.kind === 'PACOTS' ? ['coalesce', ['get', 'color'], '#38bdf8'] : TRACK_COLOR_EXPRESSION;
        this.airplaneLayerId = 'sector-ops-live-flights-layer'; 
        this.tracks = [];
        this.refreshInterval = null;
        this.hoveredTrackId = null;

        // Internal State for settings
        this.showTracks = true;
        this.showLabels = true;
        
        // Listen for style changes to re-inject layers and sources
        this.map.on('style.load', () => {
            this.initSource();
        });

        // Initial setup
        this.initSource();
        this.setupInteractions();
        this.fetchTracks();
    }

    /**
     * Re-initializes the GeoJSON source and all associated layers.
     * This is called on construction and every time the map style changes.
     */
    initSource() {
        // Prevent duplicate source errors if called multiple times within one style life-cycle
        if (this.map.getSource(this.sourceId)) return;

        this.map.addSource(this.sourceId, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
            generateId: true,
            tolerance: 0 // NAT track lines stay smooth when zoomed out
        });

        const beforeId = this.map.getLayer(this.airplaneLayerId) ? this.airplaneLayerId : undefined;

        // 1. Line Layer (The track paths)
        this.map.addLayer({
            id: this.lineLayerId,
            type: 'line',
            source: this.sourceId,
            filter: ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
            layout: { 
                'line-join': 'round', 
                'line-cap': 'round',
                'visibility': this.showTracks ? 'visible' : 'none' 
            },
            paint: {
                'line-color': this.colorExpr,
                'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 3.5, 1.8],
                'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.8, 0.4]
            }
        }, beforeId);

        // 2. Circle Background (The markers at start/end points)
        this.map.addLayer({
            id: this.bgLayerId,
            type: 'circle',
            source: this.sourceId,
            filter: ['==', ['geometry-type'], 'Point'],
            layout: {
                'visibility': (this.showTracks && this.showLabels) ? 'visible' : 'none'
            },
            paint: {
                'circle-color': this.colorExpr,
                'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 8, 6.5],
                'circle-opacity': 0.9,
                'circle-stroke-width': 1,
                'circle-stroke-color': 'rgba(0,0,0,0.1)'
            }
        }, beforeId);

        // 3. Label Layer (The text identifying the track)
        this.map.addLayer({
            id: this.labelLayerId,
            type: 'symbol',
            source: this.sourceId,
            filter: ['==', ['geometry-type'], 'Point'],
            layout: {
                'text-field': ['get', 'name'],
                // Free-engine glyph servers don't host the Mapbox stacks;
                // flight.js swaps in Noto Sans via window.mapTextFont there.
                'text-font': (typeof window !== 'undefined' && window.mapTextFont)
                    ? window.mapTextFont(['Open Sans Bold', 'Arial Unicode MS Bold'])
                    : ['Open Sans Bold', 'Arial Unicode MS Bold'],
                'text-size': 7.5,
                'text-justify': 'center',
                'text-allow-overlap': true,
                'text-ignore-placement': true,
                'visibility': (this.showTracks && this.showLabels) ? 'visible' : 'none'
            },
            paint: {
                'text-color': '#ffffff'
            }
        }, beforeId);

        // If we already have tracks in memory (e.g., after a style change), render them immediately
        if (this.tracks.length > 0) {
            this.render();
        }
    }

    /**
     * Updates visibility and settings from external UI components.
     * @param {Object} options - { showTracks: boolean, showLabels: boolean }
     */
    setOptions(options) {
        if (options.showTracks !== undefined) this.showTracks = options.showTracks;
        if (options.showLabels !== undefined) this.showLabels = options.showLabels;
        this.updateVisibility();
    }

    /**
     * Applies visibility state to the Mapbox layers based on internal class state.
     */
    updateVisibility() {
        const trackVisibility = this.showTracks ? 'visible' : 'none';
        const labelVisibility = (this.showTracks && this.showLabels) ? 'visible' : 'none';

        if (this.map.getLayer(this.lineLayerId)) {
            this.map.setLayoutProperty(this.lineLayerId, 'visibility', trackVisibility);
        }
        if (this.map.getLayer(this.bgLayerId)) {
            this.map.setLayoutProperty(this.bgLayerId, 'visibility', labelVisibility);
        }
        if (this.map.getLayer(this.labelLayerId)) {
            this.map.setLayoutProperty(this.labelLayerId, 'visibility', labelVisibility);
        }
    }

    /**
     * Fetches current NAT tracks from the ACARS API.
     */
    async fetchTracks() {
        try {
            const url = this.kind === 'PACOTS' ? pacificUrl() : `${ACARS_SOCKET_URL}/api/live/tracks`;
            const response = await fetch(url);
            const data = await response.json();
            if (data.ok) {
                this.tracks = Array.isArray(data.tracks) ? data.tracks : [];
                this.render();
            }
        } catch (error) {
            console.error(`Error fetching ${this.kind} tracks:`, error);
        }
    }

    /**
     * A track as line parts split at the date line. Mapbox won't draw a line
     * with longitudes past ±180, and a segment from 170E to 170W joined
     * naively runs the long way round the world — so a crossing segment is
     * cut where it meets the antimeridian (latitude interpolated) and carries
     * on from the other edge as a new part.
     */
    splitAtDateLine(coords) {
        const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
        const parts = [];
        let part = [];
        const add = (pt) => { if (!same(part[part.length - 1], pt)) part.push(pt); };
        for (let i = 0; i < coords.length; i++) {
            let [lon, lat] = coords[i];
            if (part.length) {
                const [plon, plat] = part[part.length - 1];
                // A point exactly on the date line belongs to the side it is
                // approached from (so 170W → 180 is not a crossing).
                if (Math.abs(lon) === 180) lon = plon < 0 ? -180 : 180;
                const d = lon - plon;
                if (Math.abs(d) > 180) {
                    // Crossing: eastbound when the jump is negative (170 → -170).
                    const edge = d < 0 ? 180 : -180;
                    const lonUnwrapped = d < 0 ? lon + 360 : lon - 360;
                    const t = (edge - plon) / (lonUnwrapped - plon);
                    const latX = plat + t * (lat - plat);
                    add([edge, latX]);
                    if (part.length >= 2) parts.push(part);
                    part = [[-edge, latX]];
                }
            }
            add([lon, lat]);
        }
        if (part.length) parts.push(part);
        return parts.filter(p => p.length >= 2);
    }

    /**
     * Converts track data into GeoJSON Features and updates the map source.
     */
    render() {
        const features = [];
        this.tracks.forEach((track, i) => {
            const coordinates = Array.isArray(track.points) ? track.points : this.parsePath(track.path || []);
            if (coordinates.length < 2) return;
            const parts = this.splitAtDateLine(coordinates);

            const commonProps = this.kind === 'PACOTS' ? {
                name: track.name,
                type: 'PACOTS',
                color: PACIFIC_PALETTE[i % PACIFIC_PALETTE.length],
                validFrom: track.validFrom || '',
                validTo: track.validTo || '',
                pathString: track.route || ''
            } : {
                name: track.name,
                type: track.type,
                eastLevels: track.eastLevels?.join(', ') || 'None',
                westLevels: track.westLevels?.join(', ') || 'None',
                pathString: track.path.join(' → ')
            };

            // Add the track line (in parts where it crosses the date line)
            features.push({
                type: 'Feature',
                properties: commonProps,
                geometry: parts.length > 1
                    ? { type: 'MultiLineString', coordinates: parts }
                    : { type: 'LineString', coordinates: parts[0] || coordinates }
            });

            // Add point markers at start and end
            features.push({
                type: 'Feature',
                properties: commonProps,
                geometry: { type: 'Point', coordinates: coordinates[0] }
            });

            features.push({
                type: 'Feature',
                properties: commonProps,
                geometry: { type: 'Point', coordinates: coordinates[coordinates.length - 1] }
            });
        });

        const source = this.map.getSource(this.sourceId);
        if (source) {
            source.setData({ type: 'FeatureCollection', features });
        }
    }

    /**
     * Parses various coordinate formats into [lon, lat] arrays.
     */
    parsePath(path) {
        return path.map(point => {
            if (point.includes('/')) {
                const [lat, lon] = point.split('/').map(parseFloat);
                return [-lon, lat];
            }
            const match = String(point).trim().match(/^(\d{2})(\d{2})?([NS])(\d{2,3})(\d{2})?([EW])$/);
            if (match) {
                let lat = parseFloat(match[1]) + (match[2] ? parseFloat(match[2]) / 60 : 0);
                let lon = parseFloat(match[4]) + (match[5] ? parseFloat(match[5]) / 60 : 0);
                if (match[3] === 'S') lat = -lat;
                if (match[6] === 'W') lon = -lon;
                return [lon, lat];
            }
            return null; 
        }).filter(c => c !== null);
    }

    /**
     * Configures mouse events for highlighting tracks and showing popups.
     */
    setupInteractions() {
        const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 15 });

        this.map.on('mousemove', this.lineLayerId, (e) => {
            if (e.features.length > 0) {
                if (this.hoveredTrackId !== null) {
                    this.map.setFeatureState({ source: this.sourceId, id: this.hoveredTrackId }, { hover: false });
                }
                this.hoveredTrackId = e.features[0].id;
                this.map.setFeatureState({ source: this.sourceId, id: this.hoveredTrackId }, { hover: true });
                this.map.getCanvas().style.cursor = 'pointer';
            }
        });

        this.map.on('mouseleave', this.lineLayerId, () => {
            if (this.hoveredTrackId !== null) {
                this.map.setFeatureState({ source: this.sourceId, id: this.hoveredTrackId }, { hover: false });
            }
            this.hoveredTrackId = null;
            this.map.getCanvas().style.cursor = '';
            popup.remove();
        });

        this.map.on('click', this.lineLayerId, (e) => {
            const props = e.features[0].properties;
            const z = (iso) => iso ? new Date(iso).toISOString().slice(11, 16) + 'Z' : '--';
            const html = props.type === 'PACOTS' ? `
                <div style="font-family: 'Inter', sans-serif; padding: 4px; max-width: 260px;">
                    <b style="font-size: 14px;">Pacific Track ${props.name}</b><br/>
                    <small>Valid ${z(props.validFrom)} – ${z(props.validTo)}</small><br/>
                    <small style="opacity:.75; word-break: break-word;">${props.pathString}</small>
                </div>
            ` : `
                <div style="font-family: 'Inter', sans-serif; padding: 4px;">
                    <b style="font-size: 14px;">Track ${props.name}</b><br/>
                    <small>Levels: ${props.eastLevels} / ${props.westLevels}</small>
                </div>
            `;
            popup.setLngLat(e.lngLat).setHTML(html).addTo(this.map);
        });
    }

    /**
     * Starts the automated data polling loop.
     */
    startAutoRefresh(ms = 300000) {
        this.fetchTracks();
        this.refreshInterval = setInterval(() => this.fetchTracks(), ms);
    }

    /**
     * Stops the automated data polling loop.
     */
    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    /**
     * Public helper to toggle track visibility.
     */
    toggle(show) {
        this.showTracks = show;
        this.updateVisibility();
    }
}

export default NatTracksLayer;