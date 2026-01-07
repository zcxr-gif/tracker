/**
 * groupFlightManager.js
 * Logic for detecting and visualizing group flights (pilots flying together).
 */

export const GroupFlightManager = {
    _map: null,
    _isVisible: false,
    _groups: [],
    _layerIds: ['group-links-layer', 'group-glow-layer'],
    _sourceId: 'group-flights-source',

    init(map) {
        this._map = map;
        this.setupLayers();
    },

    setupLayers() {
        if (!this._map) return;

        this._map.addSource(this._sourceId, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
        });

        // 1. The "Web" Links (Lines connecting pilots)
        this._map.addLayer({
            id: 'group-links-layer',
            type: 'line',
            source: this._sourceId,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
                'line-color': '#00e6ff',
                'line-width': 2,
                'line-opacity': 0.4,
                'line-dasharray': [2, 2]
            },
            filter: ['==', ['geometry-type'], 'LineString']
        }, 'sector-ops-live-flights-layer');

        // 2. Group Area Glow (Polygons/Circles around groups)
        this._map.addLayer({
            id: 'group-glow-layer',
            type: 'circle',
            source: this._sourceId,
            paint: {
                'circle-radius': 40,
                'circle-color': '#00e6ff',
                'circle-opacity': 0.1,
                'circle-blur': 1
            },
            filter: ['==', ['geometry-type'], 'Point']
        }, 'sector-ops-live-flights-layer');

        this.updateVisibility();
    },

    update(features) {
        if (!this._isVisible || !features) return;

        const flights = Object.values(features);
        const groups = this.detectGroups(flights);
        
        const geojson = {
            type: 'FeatureCollection',
            features: this.generateGeoJSON(groups)
        };

        const source = this._map.getSource(this._sourceId);
        if (source) source.setData(geojson);
    },

    detectGroups(flights) {
        const potentialGroups = {};

        flights.forEach(f => {
            const props = f.properties;
            const plan = props.plan ? (typeof props.plan === 'string' ? JSON.parse(props.plan) : props.plan) : null;
            
            if (!plan || !plan.departure || !plan.arrival) return;

            // Grouping Key: Departure + Arrival (Standardized)
            const routeKey = `${plan.departure.toUpperCase()}-${plan.arrival.toUpperCase()}`;
            
            if (!potentialGroups[routeKey]) potentialGroups[routeKey] = [];
            potentialGroups[routeKey].push(f);
        });

        // Filter out "groups" of 1 and ensure they are physically close (within 50nm)
        return Object.values(potentialGroups).filter(group => group.length > 1);
    },

    generateGeoJSON(groups) {
        const features = [];

        groups.forEach(group => {
            const coords = group.map(f => f.geometry.coordinates);
            
            // Add Point features for the "Glow"
            group.forEach(f => {
                features.push({
                    type: 'Feature',
                    geometry: f.geometry,
                    properties: { type: 'member' }
                });
            });

            // Add LineString features to connect the group in a "star" or "web"
            // We connect every pilot to the first pilot in the list (the "Lead")
            const lead = coords[0];
            for (let i = 1; i < coords.length; i++) {
                features.push({
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: [lead, coords[i]]
                    },
                    properties: { type: 'link' }
                });
            }
        });

        return features;
    },

    toggle(visible) {
        this._isVisible = visible;
        this.updateVisibility();
    },

    updateVisibility() {
        if (!this._map) return;
        const status = this._isVisible ? 'visible' : 'none';
        this._layerIds.forEach(id => {
            if (this._map.getLayer(id)) {
                this._map.setLayoutProperty(id, 'visibility', status);
            }
        });
    }
};