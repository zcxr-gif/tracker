/**
 * natTracksLayer.js (Mapbox GL JS Version)
 * Refined version: Removed labels, added hover effects, and improved parsing.
 */

const ACARS_SOCKET_URL = 'https://site--acars-backend--6dmjph8ltlhv.code.run';

export class NatTracksLayer {
    constructor(map) {
        this.map = map;
        this.sourceId = 'nat-tracks-source';
        this.lineLayerId = 'nat-tracks-layer';
        this.tracks = [];
        this.refreshInterval = null;
        this.hoveredTrackId = null;
        
        this.initSource();
    }

    initSource() {
        if (this.map.getSource(this.sourceId)) return;

        this.map.addSource(this.sourceId, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
            generateId: true // Required for feature-state hover effects
        });

        // Line Layer (Solid & Color-Coded)
        this.map.addLayer({
            id: this.lineLayerId,
            type: 'line',
            source: this.sourceId,
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': [
                    'match',
                    ['get', 'name'],
                    'A', '#ff4d4d', // Vibrant Red
                    'B', '#ffcc00', // Gold
                    'C', '#2ecc71', // Emerald
                    'D', '#a29bfe', // Soft Purple
                    'E', '#e67e22', // Carrot Orange
                    'F', '#00cec9', // Robin's Egg
                    '#3498db'       // Sky Blue
                ],
                // Line thickens when hovered
                'line-width': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false],
                    4.5,
                    2.2
                ],
                // Line becomes more opaque when hovered
                'line-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false],
                    1,
                    0.6
                ]
            }
        });

        this.setupInteractions();
    }

    async fetchTracks() {
        try {
            const response = await fetch(`${ACARS_SOCKET_URL}/api/live/tracks`);
            const data = await response.json();

            if (data.ok) {
                this.tracks = data.tracks;
                this.render();
            }
        } catch (error) {
            console.error('Error fetching NAT tracks:', error);
        }
    }

    startAutoRefresh(intervalMs = 300000) { // Default 5 mins
        this.fetchTracks();
        this.refreshInterval = setInterval(() => this.fetchTracks(), intervalMs);
    }

    stopAutoRefresh() {
        if (this.refreshInterval) clearInterval(this.refreshInterval);
    }

    render() {
        const features = this.tracks.map(track => {
            const coordinates = this.parsePath(track.path);
            
            return {
                type: 'Feature',
                properties: {
                    name: track.name,
                    type: track.type,
                    eastLevels: track.eastLevels?.join(', ') || 'None',
                    westLevels: track.westLevels?.join(', ') || 'None',
                    pathString: track.path.join(' → ')
                },
                geometry: {
                    type: 'LineString',
                    coordinates: coordinates
                }
            };
        }).filter(f => f.geometry.coordinates.length > 1);

        const source = this.map.getSource(this.sourceId);
        if (source) source.setData({ type: 'FeatureCollection', features });
    }

    parsePath(path) {
        return path.map(point => {
            // Handle "50/20" format
            if (point.includes('/')) {
                const [lat, lon] = point.split('/').map(parseFloat);
                return [-lon, lat]; // Assuming West for NAT
            }
            // Handle "50N020W" standard aviation format
            const match = point.match(/(\d+)([NS])(\d+)([EW])/);
            if (match) {
                let lat = parseFloat(match[1]);
                let lon = parseFloat(match[3]);
                if (match[2] === 'S') lat = -lat;
                if (match[4] === 'W') lon = -lon;
                return [lon, lat];
            }
            return null; 
        }).filter(coord => coord !== null);
    }

    setupInteractions() {
        const popup = new mapboxgl.Popup({
            closeButton: false,
            closeOnClick: false,
            className: 'nat-track-popup',
            offset: 15
        });

        // HOVER EFFECTS
        this.map.on('mousemove', this.lineLayerId, (e) => {
            if (e.features.length > 0) {
                if (this.hoveredTrackId !== null) {
                    this.map.setFeatureState(
                        { source: this.sourceId, id: this.hoveredTrackId },
                        { hover: false }
                    );
                }
                this.hoveredTrackId = e.features[0].id;
                this.map.setFeatureState(
                    { source: this.sourceId, id: this.hoveredTrackId },
                    { hover: true }
                );
                this.map.getCanvas().style.cursor = 'pointer';
            }
        });

        this.map.on('mouseleave', this.lineLayerId, () => {
            if (this.hoveredTrackId !== null) {
                this.map.setFeatureState(
                    { source: this.sourceId, id: this.hoveredTrackId },
                    { hover: false }
                );
            }
            this.hoveredTrackId = null;
            this.map.getCanvas().style.cursor = '';
            popup.remove();
        });

        // CLICK POPUP
        this.map.on('click', this.lineLayerId, (e) => {
            const props = e.features[0].properties;
            const html = `
                <div style="font-family: 'Inter', sans-serif; min-width: 180px;">
                    <div style="display:flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <b style="font-size: 16px;">Track ${props.name}</b>
                        <span style="background: #eee; padding: 2px 6px; border-radius: 4px; font-size: 10px;">${props.type}</span>
                    </div>
                    <div style="font-size: 11px; line-height: 1.5;">
                        <b>Eastbound:</b> ${props.eastLevels}<br>
                        <b>Westbound:</b> ${props.westLevels}<br>
                        <div style="margin-top: 6px; color: #666; font-style: italic;">${props.pathString}</div>
                    </div>
                </div>
            `;
            popup.setLngLat(e.lngLat).setHTML(html).addTo(this.map);
        });
    }

    toggle(show) {
        const visibility = show ? 'visible' : 'none';
        if (this.map.getLayer(this.lineLayerId)) {
            this.map.setLayoutProperty(this.lineLayerId, 'visibility', visibility);
        }
    }
}

export default NatTracksLayer;