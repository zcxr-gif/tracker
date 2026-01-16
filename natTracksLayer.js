/**
 * natTracksLayer.js (Mapbox GL JS Version)
 * Optimized: Solid lines, color-coding, and layer-depth management.
 */

const ACARS_SOCKET_URL = 'https://site--acars-backend--6dmjph8ltlhv.code.run';

export class NatTracksLayer {
    constructor(map, planeLayerId = 'aircraft-layer') {
        this.map = map;
        this.planeLayerId = planeLayerId; // The ID of your aircraft layer
        this.sourceId = 'nat-tracks-source';
        this.lineLayerId = 'nat-tracks-layer';
        this.glowLayerId = 'nat-tracks-glow';
        this.tracks = [];
        
        this.initSource();
    }

    initSource() {
        this.map.addSource(this.sourceId, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });

        // 1. Glow/Outer Blur Layer (Improves visibility against dark backgrounds)
        this.map.addLayer({
            id: this.glowLayerId,
            type: 'line',
            source: this.sourceId,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
                'line-color': '#000000',
                'line-width': 5,
                'line-opacity': 0.3,
                'line-blur': 3
            }
        }, this.planeLayerId); // <--- Ensures it renders BELOW the planes

        // 2. Main Track Layer (Color-Coded & Solid)
        this.map.addLayer({
            id: this.lineLayerId,
            type: 'line',
            source: this.sourceId,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
                'line-color': [
                    'match',
                    ['get', 'name'],
                    'A', '#FF4B2B', // Vibrant Red-Orange
                    'B', '#FFD200', // Gold
                    'C', '#1D976C', // Emerald
                    'D', '#8E2DE2', // Deep Purple
                    'E', '#00d2ff', // Sky Blue
                    'F', '#F09819', // Amber
                    '#5D26C1'       // Default Indigo
                ],
                'line-width': 2.5,
                'line-opacity': 0.9
            }
        }, this.planeLayerId); // <--- Ensures it renders BELOW the planes

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
                // Handle Longitude: NAT points are West (negative)
                const lon = -parseFloat(parts[1]); 
                return [lon, lat]; 
            }
            return null; 
        }).filter(coord => coord !== null);
    }

    setupPopup() {
        const popup = new mapboxgl.Popup({
            closeButton: false,
            className: 'nat-track-popup',
            maxWidth: '300px'
        });

        this.map.on('click', this.lineLayerId, (e) => {
            const props = e.features[0].properties;
            
            const html = `
                <div style="font-family: 'Segoe UI', Tahoma, sans-serif; padding: 10px; border-radius: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 18px; font-weight: bold; color: #333;">Track ${props.name}</span>
                        <span style="background: #eee; padding: 2px 6px; border-radius: 4px; font-size: 10px;">${props.type}</span>
                    </div>
                    <hr style="border: 0; border-top: 1px solid #ddd; margin: 8px 0;">
                    <div style="font-size: 11px; color: #555; line-height: 1.6;">
                        <strong>Eastbound FL:</strong> <span style="color: #2c3e50;">${props.eastLevels}</span><br>
                        <strong>Westbound FL:</strong> <span style="color: #2c3e50;">${props.westLevels}</span><br>
                        <div style="margin-top: 5px; padding: 5px; background: #f9f9f9; border-radius: 4px; font-family: monospace;">
                            ${props.pathString}
                        </div>
                    </div>
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
        this.map.setLayoutProperty(this.glowLayerId, 'visibility', visibility);
    }
}

export default NatTracksLayer;