/**
 * natTracksLayer.js (Mapbox GL JS Version)
 * Updated for better aesthetics: solid lines, color-coding, and labels.
 */

const ACARS_SOCKET_URL = 'https://site--acars-backend--6dmjph8ltlhv.code.run';

export class NatTracksLayer {
    constructor(map) {
        this.map = map;
        this.sourceId = 'nat-tracks-source';
        this.lineLayerId = 'nat-tracks-layer';
        this.labelLayerId = 'nat-tracks-labels'; // New layer for the letters
        this.tracks = [];
        
        this.initSource();
    }

    initSource() {
        this.map.addSource(this.sourceId, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });

        // 1. Line Layer (Solid & Color-Coded)
        this.map.addLayer({
            id: this.lineLayerId,
            type: 'line',
            source: this.sourceId,
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                // Color coding based on the track name (A, B, C, etc.)
                'line-color': [
                    'match',
                    ['get', 'name'],
                    'A', '#e74c3c', // Red
                    'B', '#f1c40f', // Yellow
                    'C', '#2ecc71', // Green
                    'D', '#9b59b6', // Purple
                    'E', '#e67e22', // Orange
                    'F', '#1abc9c', // Teal
                    '#3498db'       // Default Blue for others
                ],
                'line-width': 2.5,
                'line-opacity': 0.8
                // Removed line-dasharray for solid lines
            }
        });

        // 2. Label Layer (Displaying the Letter)
        this.map.addLayer({
            id: this.labelLayerId,
            type: 'symbol',
            source: this.sourceId,
            layout: {
                'symbol-placement': 'line-center', // Places letter in the middle of the line
                'text-field': ['get', 'name'],
                'text-size': 14,
                'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                'text-allow-overlap': false,
                'text-ignore-placement': false
            },
            paint: {
                'text-color': '#ffffff',
                'text-halo-color': 'rgba(0,0,0,0.8)',
                'text-halo-width': 2
            }
        });

        this.setupPopup();
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
        const features = this.tracks.map(track => {
            const coordinates = this.parsePath(track.path);
            
            return {
                type: 'Feature',
                properties: {
                    name: track.name,
                    type: track.type,
                    eastLevels: track.eastLevels ? track.eastLevels.join(', ') : 'None',
                    westLevels: track.westLevels ? track.westLevels.join(', ') : 'None',
                    pathString: track.path.join(' → ')
                },
                geometry: {
                    type: 'LineString',
                    coordinates: coordinates
                }
            };
        }).filter(f => f.geometry.coordinates.length > 0);

        this.map.getSource(this.sourceId).setData({
            type: 'FeatureCollection',
            features: features
        });
    }

    parsePath(path) {
        return path.map(point => {
            if (point.includes('/')) {
                const parts = point.split('/');
                const lat = parseFloat(parts[0]);
                const lon = -parseFloat(parts[1]); 
                return [lon, lat]; 
            }
            return null; 
        }).filter(coord => coord !== null);
    }

    setupPopup() {
        const popup = new mapboxgl.Popup({
            closeButton: false,
            className: 'nat-track-popup'
        });

        // Apply click listener to the line layer
        this.map.on('click', this.lineLayerId, (e) => {
            const props = e.features[0].properties;
            
            const html = `
                <div style="font-family: sans-serif; font-size: 12px; padding: 5px;">
                    <strong style="font-size: 14px;">Track ${props.name}</strong><br>
                    <hr style="margin: 5px 0; border: 0; border-top: 1px solid #eee;">
                    <strong>Direction:</strong> ${props.type}<br>
                    <strong>Eastbound FL:</strong> ${props.eastLevels}<br>
                    <strong>Westbound FL:</strong> ${props.westLevels}<br>
                    <strong>Path:</strong> <span style="word-break: break-all;">${props.pathString}</span>
                </div>
            `;

            popup.setLngLat(e.lngLat).setHTML(html).addTo(this.map);
        });

        this.map.on('mouseenter', this.lineLayerId, () => this.map.getCanvas().style.cursor = 'pointer');
        this.map.on('mouseleave', this.lineLayerId, () => this.map.getCanvas().style.cursor = '');
    }

    toggle(show) {
        const visibility = show ? 'visible' : 'none';
        this.map.setLayoutProperty(this.lineLayerId, 'visibility', visibility);
        this.map.setLayoutProperty(this.labelLayerId, 'visibility', visibility);
    }
}

export default NatTracksLayer;