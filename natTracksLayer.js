/**
 * natTracksLayer.js (Mapbox GL JS Version)
 * Updated version: Includes integrated "bubbles" that feel like part of the line, 
 * with synchronized hover effects.
 */

const ACARS_SOCKET_URL = 'https://site--acars-backend--6dmjph8ltlhv.code.run';

export class NatTracksLayer {
    constructor(map) {
        this.map = map;
        this.sourceId = 'nat-tracks-source';
        this.lineLayerId = 'nat-tracks-layer';
        this.bubbleLayerId = 'nat-tracks-bubbles'; // Circle background
        this.labelLayerId = 'nat-tracks-labels';   // Letter inside
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

        // Shared color logic for lines and bubbles
        const colorExpression = [
            'match',
            ['get', 'name'],
            'A', '#ff4d4d', // Vibrant Red
            'B', '#ffcc00', // Gold
            'C', '#2ecc71', // Emerald
            'D', '#a29bfe', // Soft Purple
            'E', '#e67e22', // Carrot Orange
            'F', '#00cec9', // Robin's Egg
            '#3498db'       // Sky Blue
        ];

        // 1. Line Layer (Solid & Color-Coded)
        this.map.addLayer({
            id: this.lineLayerId,
            type: 'line',
            source: this.sourceId,
            filter: ['==', ['geometry-type'], 'LineString'],
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': colorExpression,
                'line-width': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false],
                    4.5,
                    2.2
                ],
                'line-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false],
                    1,
                    0.7
                ]
            }
        });

        // 2. Bubble Layer (The circle container - merged with line)
        this.map.addLayer({
            id: this.bubbleLayerId,
            type: 'circle',
            source: this.sourceId,
            filter: ['==', ['geometry-type'], 'Point'],
            paint: {
                'circle-radius': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false],
                    11,
                    9
                ],
                'circle-color': colorExpression,
                'circle-opacity': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false],
                    1,
                    0.9
                ]
                // Removed stroke to make it feel "one" with the line
            }
        });

        // 3. Label Layer (The letter inside the bubble)
        this.map.addLayer({
            id: this.labelLayerId,
            type: 'symbol',
            source: this.sourceId,
            filter: ['==', ['geometry-type'], 'Point'],
            layout: {
                'text-field': ['get', 'name'],
                'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                'text-size': [
                    'case',
                    ['boolean', ['feature-state', 'hover'], false],
                    11,
                    9.5
                ],
                'text-allow-overlap': true,
                'text-ignore-placement': true
            },
            paint: {
                'text-color': '#ffffff'
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

            // Add the LineString feature
            features.push({
                type: 'Feature',
                properties: commonProps,
                geometry: {
                    type: 'LineString',
                    coordinates: coordinates
                }
            });

            // Add Point feature for the START of the track
            features.push({
                type: 'Feature',
                properties: commonProps,
                geometry: {
                    type: 'Point',
                    coordinates: coordinates[0]
                }
            });

            // Add Point feature for the END of the track
            features.push({
                type: 'Feature',
                properties: commonProps,
                geometry: {
                    type: 'Point',
                    coordinates: coordinates[coordinates.length - 1]
                }
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

        // Hover effect listener on the line and bubble layers
        const handleHover = (e) => {
            if (e.features.length > 0) {
                const feature = e.features[0];
                const trackName = feature.properties.name;

                // Remove previous hover state
                if (this.hoveredTrackId !== null) {
                    this.setTrackHoverState(this.hoveredTrackId, false);
                }

                // We use the track name (A, B, C...) to highlight all components of that track
                this.hoveredTrackId = trackName;
                this.setTrackHoverState(trackName, true);
                
                this.map.getCanvas().style.cursor = 'pointer';
            }
        };

        const handleLeave = () => {
            if (this.hoveredTrackId !== null) {
                this.setTrackHoverState(this.hoveredTrackId, false);
            }
            this.hoveredTrackId = null;
            this.map.getCanvas().style.cursor = '';
            popup.remove();
        };

        [this.lineLayerId, this.bubbleLayerId].forEach(layerId => {
            this.map.on('mousemove', layerId, handleHover);
            this.map.on('mouseleave', layerId, handleLeave);
        });

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

    /**
     * Helper to set hover state across all features (Line and Points) sharing a track name
     */
    setTrackHoverState(trackName, isHovering) {
        // Since generateId: true only works for individual features, 
        // and we want to highlight the whole "track entity" (Line + 2 Bubbles),
        // we use a filter update or just iterate features if possible.
        // For efficiency in Mapbox GL JS, we typically use feature-state,
        // but that requires unique IDs. Here we'll update the feature state for all
        // rendered features matching the name.
        
        const source = this.map.getSource(this.sourceId);
        if (!source) return;

        const allFeatures = source._data.features;
        allFeatures.forEach((f, index) => {
            if (f.properties.name === trackName) {
                this.map.setFeatureState(
                    { source: this.sourceId, id: index },
                    { hover: isHovering }
                );
            }
        });
    }

    toggle(show) {
        const visibility = show ? 'visible' : 'none';
        const layers = [this.lineLayerId, this.bubbleLayerId, this.labelLayerId];
        
        layers.forEach(layerId => {
            if (this.map.getLayer(layerId)) {
                this.map.setLayoutProperty(layerId, 'visibility', visibility);
            }
        });
    }
}

export default NatTracksLayer;