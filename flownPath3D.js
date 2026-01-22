/**
 * flownPath3D.js - Enhanced Version
 * Handles high-quality 3D flight trails with thickness and smoothing.
 */

export const FlownPath3D = {
    flightObjects: {},

    /**
     * Adds or updates the 3D path.
     */
    updatePath(map, flightId, trailData, is3DEnabled) {
        if (!map || !flightId) return;

        const layerId = `layer-3d-path-${flightId}`;

        if (!is3DEnabled || !trailData || trailData.length < 2) {
            this.clearPath(map, flightId);
            return;
        }

        if (!map.getLayer(layerId)) {
            const customLayer = this._createCustomLayer(layerId, flightId, trailData);
            map.addLayer(customLayer);
        } else {
            this._updateGeometry(flightId, trailData, map);
        }

        map.triggerRepaint();
    },

    /**
     * Internal: Creates the Mapbox Custom Layer using Three.js Fat Lines
     */
    _createCustomLayer(layerId, flightId, trailData) {
        const THREE = window.THREE;
        // Ensure these are available on the THREE object or imported
        // Required: THREE.Line2, THREE.LineGeometry, THREE.LineMaterial

        return {
            id: layerId,
            type: 'custom',
            renderingMode: '3d',
            onAdd: function (map, gl) {
                this.camera = new THREE.Camera();
                this.scene = new THREE.Scene();

                // 1. Use LineMaterial for thickness support
                this.material = new THREE.LineMaterial({
                    color: 0xffffff,
                    linewidth: 4, // Thickness in pixels
                    vertexColors: true, // Enable altitude-based gradient
                    transparent: true,
                    opacity: 0.8,
                    dashed: false,
                    depthTest: true
                });

                // 2. Geometry placeholder
                this.geometry = new THREE.LineGeometry();

                // 3. Create the Line2 object
                this.line = new THREE.Line2(this.geometry, this.material);
                this.line.frustumCulled = false;

                this.scene.add(this.line);

                FlownPath3D.flightObjects[flightId] = this;

                this.renderer = new THREE.WebGLRenderer({
                    canvas: map.getCanvas(),
                    context: gl,
                    antialias: true
                });
                this.renderer.autoClear = false;

                FlownPath3D._updateGeometry(flightId, trailData, map);
            },
            render: function (gl, matrix) {
                // Update resolution so line width remains consistent
                this.material.resolution.set(gl.drawingBufferWidth, gl.drawingBufferHeight);
                
                const m = new THREE.Matrix4().fromArray(matrix);
                this.camera.projectionMatrix = m;
                this.renderer.resetState();
                this.renderer.render(this.scene, this.camera);
            }
        };
    },

    /**
     * Internal: Smooths coordinates and updates the Line2 geometry
     */
    _updateGeometry(flightId, trailData, map) {
        const layerObj = this.flightObjects[flightId];
        if (!layerObj || !trailData || trailData.length < 2) return;

        const THREE = window.THREE;
        
        // 1. Convert points to Vector3 in Mercator space
        const points = trailData.map(p => {
            const alt = (p.altitude || p.alt || 0) * 0.3048; 
            const coord = mapboxgl.MercatorCoordinate.fromLngLat([p.longitude || p.lon, p.latitude || p.lat], alt);
            return new THREE.Vector3(coord.x, coord.y, coord.z);
        });

        // 2. Smooth the path using a Catmull-Rom Curve
        // This makes the flight look like a natural arc instead of a series of lines
        const curve = new THREE.CatmullRomCurve3(points);
        const smoothedPoints = curve.getPoints(trailData.length * 4); // Increase multiplier for more smoothness

        const positions = [];
        const colors = [];
        const colorLow = new THREE.Color(0x00f2fe);  // Bright Cyan (Low altitude)
        const colorHigh = new THREE.Color(0xffffff); // White (High altitude)

        smoothedPoints.forEach(p => {
            positions.push(p.x, p.y, p.z);
            
            // Calculate color based on relative altitude (Z)
            // Note: In Mercator, higher Z is "up" but very small values. 
            // We'll interpolate between colors based on a heuristic or specific alt
            const t = Math.min(Math.max(p.z * 10000, 0), 1); // Simple scale for visual effect
            const mixedColor = new THREE.Color().copy(colorLow).lerp(colorHigh, t);
            colors.push(mixedColor.r, mixedColor.g, mixedColor.b);
        });

        // 3. Update LineGeometry
        layerObj.geometry.setPositions(positions);
        layerObj.geometry.setColors(colors);
        
        layerObj.line.computeLineDistances(); // Required for some material effects
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