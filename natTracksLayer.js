/**
 * natTracksLayer.js (Mapbox GL JS Version)
 * Updated: Integrated start/end track letters that match line styling.
 */

const ACARS_SOCKET_URL = 'https://site--acars-backend--6dmjph8ltlhv.code.run';

// Shared color logic to ensure line and text are "one"
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

export class NatTracksLayer {
    constructor(map) {
        this.map = map;
        this.sourceId = 'nat-tracks-source';
        this.lineLayerId = 'nat-tracks-layer';
        this.labelLayerId = 'nat-tracks-labels';
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
            generateId: true 
        });

        // Line Layer
        this.map.addLayer({
            id: this.lineLayerId,
            type: 'line',
            source: this.sourceId,
            filter: ['==', ['geometry-type'], 'LineString'],
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
                'line-color': TRACK_COLOR_EXPRESSION,
                'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 4.5, 2.2],
                'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0.6]
            }
        });

        // Label Layer (Points at each end)
        this.map.addLayer({
            id: this.labelLayerId,
            type: 'symbol',
            source: this.sourceId,
            filter: ['==', ['geometry-type'], 'Point'],
            layout: {
                'text-field': ['get', 'name'],
                'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                'text-size': 11,
                'text-justify': 'center',
                'text-allow-overlap': true,
                'text-ignore-placement': true
            },
            paint: {
                'text-color': TRACK_COLOR_EXPRESSION,
                'text-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0.8],
                // Subtle halo matches dark backgrounds to keep the letter "clean" on the line tip
                'text-halo-color': 'rgba(26, 26, 26, 0.8)', 
                'text-halo-width': 1
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

    render() {
        const features = [];
        this.tracks.forEach(track => {
            const coordinates = this.parsePath(track.path);
            if (coordinates.length < 2) return;

            const commonProps = {
                name: track.name,
                type: track.type,
                eastLevels: track.eastLevels?.join(', ') || 'None',
                westLevels: track.westLevels?.join(', ') || 'None',
                pathString: track.path.join(' → ')
            };

            // 1. The Line
            features.push({
                type: 'Feature',
                properties: commonProps,
                geometry: { type: 'LineString', coordinates }
            });

            // 2. Start Point Label
            features.push({
                type: 'Feature',
                properties: commonProps,
                geometry: { type: 'Point', coordinates: coordinates[0] }
            });

            // 3. End Point Label
            features.push({
                type: 'Feature',
                properties: commonProps,
                geometry: { type: 'Point', coordinates: coordinates[coordinates.length - 1] }
            });
        });

        const source = this.map.getSource(this.sourceId);
        if (source) source.setData({ type: 'FeatureCollection', features });
    }

    parsePath(path) {
        return path.map(point => {
            if (point.includes('/')) {
                const [lat, lon] = point.split('/').map(parseFloat);
                return [-lon, lat];
            }
            const match = point.match(/(\d+)([NS])(\d+)([EW])/);
            if (match) {
                let lat = parseFloat(match[1]), lon = parseFloat(match[3]);
                if (match[2] === 'S') lat = -lat;
                if (match[4] === 'W') lon = -lon;
                return [lon, lat];
            }
            return null; 
        }).filter(c => c !== null);
    }

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
            const html = `
                <div style="font-family: 'Inter', sans-serif; padding: 4px;">
                    <b style="font-size: 14px;">Track ${props.name}</b><br/>
                    <small>Levels: ${props.eastLevels} / ${props.westLevels}</small>
                </div>
            `;
            popup.setLngLat(e.lngLat).setHTML(html).addTo(this.map);
        });
    }

    startAutoRefresh(ms = 300000) {
        this.fetchTracks();
        this.refreshInterval = setInterval(() => this.fetchTracks(), ms);
    }

    stopAutoRefresh() {
        if (this.refreshInterval) clearInterval(this.refreshInterval);
    }

    toggle(show) {
        const visibility = show ? 'visible' : 'none';
        [this.lineLayerId, this.labelLayerId].forEach(id => {
            if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', visibility);
        });
    }
}

export default NatTracksLayer;