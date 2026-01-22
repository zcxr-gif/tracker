/**
 * flownPath3D.js
 * Handles the rendering of 3D flight trails using Three.js.
 */

export const FlownPath3D = {
    // Stores Three.js objects per flightId
    flightObjects: {},

    /**
     * Adds or updates the 3D path using Three.js.
     */
    updatePath(map, flightId, trailData, is3DEnabled) {
        if (!map || !flightId) return;

        const layerId = `layer-3d-path-${flightId}`;

        // Cleanup if disabled or insufficient data
        if (!is3DEnabled || !trailData || trailData.length < 2) {
            this.clearPath(map, flightId);
            return;
        }

        // If the custom layer doesn't exist, create it
        if (!map.getLayer(layerId)) {
            const customLayer = this._createCustomLayer(layerId, flightId, trailData);
            map.addLayer(customLayer);
        } else {
            // Update existing geometry
            this._updateGeometry(flightId, trailData);
        }
    },

    /**
     * Internal: Creates the Mapbox Custom Layer for Three.js
     */
    _createCustomLayer(layerId, flightId, trailData) {
        const THREE = window.THREE;
        
        return {
            id: layerId,
            type: 'custom',
            renderingMode: '3d',
            onAdd: function (map, gl) {
                this.camera = new THREE.Camera();
                this.scene = new THREE.Scene();

                // Create the line geometry
                const geometry = new THREE.BufferGeometry();
                const material = new THREE.LineBasicMaterial({ 
                    color: 0x38bdf8, 
                    linewidth: 3,
                    transparent: true,
                    opacity: 0.9 
                });

                const line = new THREE.Line(geometry, material);
                this.scene.add(line);

                this.line = line;
                this.renderer = new THREE.WebGLRenderer({
                    canvas: map.getCanvas(),
                    context: gl,
                    antialias: true
                });
                this.renderer.autoClear = false;

                // Initial data sync
                FlownPath3D._updateGeometry(flightId, trailData, this.line);
            },
            render: function (gl, matrix) {
                const m = new THREE.Matrix4().fromArray(matrix);
                this.camera.projectionMatrix = m;
                this.renderer.state.reset();
                this.renderer.render(this.scene, this.camera);
            }
        };
    },

    /**
     * Internal: Updates coordinates into Mercator space for Three.js
     */
    _updateGeometry(flightId, trailData, existingLine = null) {
        const THREE = window.THREE;
        // Mapbox specific coordinates: [0,0] is NW, [1,1] is SE
        const positions = [];
        
        trailData.forEach(p => {
            const lng = p.longitude || p.lon;
            const lat = p.latitude || p.lat;
            const alt = (p.altitude || p.alt || 0) * 0.3048; // Feet to Meters
            
            const coord = mapboxgl.MercatorCoordinate.fromLngLat([lng, lat], alt);
            positions.push(coord.x, coord.y, coord.z);
        });

        const line = existingLine || this.flightObjects[flightId]?.line;
        if (line) {
            line.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            line.geometry.attributes.position.needsUpdate = true;
        }
    },

    clearPath(map, flightId) {
        const layerId = `layer-3d-path-${flightId}`;
        if (map.getLayer(layerId)) {
            map.removeLayer(layerId);
        }
        delete this.flightObjects[flightId];
    },

    clearAllPaths(map) {
        if (!map) return;
        Object.keys(this.flightObjects).forEach(id => this.clearPath(map, id));
    }
};