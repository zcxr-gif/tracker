/**
 * natTracksLayer.js (Mapbox GL JS Version)
 * Handles fetching and plotting North Atlantic Tracks (NAT) using GeoJSON.
 */

const ACARS_SOCKET_URL = 'https://site--acars-backend--6dmjph8ltlhv.code.run';


export class NatTracksLayer {
        constructor(map) {
        this.map = map;
        this.sourceId = 'nat-tracks-source';
        this.layerId = 'nat-tracks-layer';
        this.tracks = [];
        
        this.initSource();
    }

    /**
     * Initializes the GeoJSON source and layer on the Mapbox map.
     */
    initSource() {
        this.map.addSource(this.sourceId, {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: []
            }
        });

        this.map.addLayer({
            id: this.layerId,
            type: 'line',
            source: this.sourceId,
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': '#3498db',
                'line-width': 2,
                'line-dasharray': [2, 4], // Mapbox dasharray uses unit multiples of line width
                'line-opacity': 0.7
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

    /**
     * Converts track data into GeoJSON format and updates the map source.
     */
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

    /**
     * Maps "51/20" shorthand to [Longitude, Latitude]
     */
    parsePath(path) {
        return path.map(point => {
            if (point.includes('/')) {
                const parts = point.split('/');
                const lat = parseFloat(parts[0]);
                const lon = -parseFloat(parts[1]); // Assuming West longitudes
                // Mapbox format: [Lon, Lat]
                return [lon, lat]; 
            }
            return null; 
        }).filter(coord => coord !== null);
    }

    /**
     * Replaces Leaflet's .bindPopup with a Mapbox click listener
     */
    setupPopup() {
        const popup = new mapboxgl.Popup({
            closeButton: false,
            className: 'nat-track-popup'
        });

        this.map.on('click', this.layerId, (e) => {
            const props = e.features[0].properties;
            
            const html = `
                <div style="font-family: sans-serif; font-size: 12px;">
                    <strong>Track ${props.name}</strong><br>
                    <small>Type: ${props.type}</small><br>
                    <strong>Eastbound FL:</strong> ${props.eastLevels}<br>
                    <strong>Westbound FL:</strong> ${props.westLevels}<br>
                    <strong>Path:</strong> ${props.pathString}
                </div>
            `;

            popup.setLngLat(e.lngLat)
                .setHTML(html)
                .addTo(this.map);
        });

        // Change cursor on hover
        this.map.on('mouseenter', this.layerId, () => this.map.getCanvas().style.cursor = 'pointer');
        this.map.on('mouseleave', this.layerId, () => this.map.getCanvas().style.cursor = '');
    }

    toggle(show) {
        const visibility = show ? 'visible' : 'none';
        this.map.setLayoutProperty(this.layerId, 'visibility', visibility);
    }
}

export default NatTracksLayer;
