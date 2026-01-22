/**
 * flownPath3D.js
 * High-fidelity 3D flight path rendering for Mapbox using Three.js.
 * Features: Variable thickness (Fat Lines), Spline smoothing, Altitude Gradients, 
 * and Vertical Curtains (Walls) to the ground.
 */

export const FlownPath3D = {
    // Stores Three.js objects and metadata per flightId
    flightObjects: {},

    /**
     * Entry point: Adds or updates a high-quality 3D path with curtains.
     * @param {Object} map - Mapbox GL instance.
     * @param {string} flightId - Unique identifier for the flight.
     * @param {Array} trailData - Array of {lat, lon, alt} points.
     * @param {boolean} is3DEnabled - Toggle for the layer.
     */
    updatePath(map, flightId, trailData, is3DEnabled) {
        if (!map || !flightId) return;

        const layerId = `layer-3d-path-${flightId}`;

        // Cleanup if disabled or insufficient data for a line
        if (!is3DEnabled || !trailData || trailData.length < 2) {
            this.clearPath(map, flightId);
            return;
        }

        if (!map.getLayer(layerId)) {
            const customLayer = this._createCustomLayer(layerId, flightId, trailData);
            map.addLayer(customLayer);
        } else {
            this._updateGeometry(flightId, trailData);
        }

        map.triggerRepaint();
    },

    /**
     * Internal: Creates the Mapbox Custom Layer.
     * Manages both the Fat Line (path) and BufferMesh (curtain).
     */
    _createCustomLayer(layerId, flightId, trailData) {
        const THREE = window.THREE;

        // Fallback check for Line2 extensions
        if (!THREE.Line2 || !THREE.LineGeometry || !THREE.LineMaterial) {
            console.warn("FlownPath3D: Three.js Line2 extensions missing. Falling back to basic lines.");
            return this._createBasicLayer(layerId, flightId, trailData);
        }

        return {
            id: layerId,
            type: 'custom',
            renderingMode: '3d',
            onAdd: function (map, gl) {
                this.camera = new THREE.Camera();
                this.scene = new THREE.Scene();

                // 1. Path Material (Fat Lines)
                this.lineMaterial = new THREE.LineMaterial({
                    color: 0xffffff,
                    linewidth: 4,
                    vertexColors: true,
                    transparent: true,
                    opacity: 0.9,
                    depthTest: true,
                    alphaToCoverage: true 
                });

                // 2. Curtain Material (Vertical Wall)
                this.curtainMaterial = new THREE.MeshBasicMaterial({
                    vertexColors: true,
                    transparent: true,
                    opacity: 0.4,       // Subtle fill
                    side: THREE.DoubleSide,
                    depthWrite: false,  // Better transparency sorting
                    blending: THREE.AdditiveBlending // Makes the colors "glow" slightly against the map
                });

                // Initialize Line Object
                this.lineGeometry = new THREE.LineGeometry();
                this.line = new THREE.Line2(this.lineGeometry, this.lineMaterial);
                this.line.frustumCulled = false;

                // Initialize Curtain Object
                this.curtainGeometry = new THREE.BufferGeometry();
                this.curtainMesh = new THREE.Mesh(this.curtainGeometry, this.curtainMaterial);
                this.curtainMesh.frustumCulled = false;

                this.scene.add(this.line);
                this.scene.add(this.curtainMesh);

                FlownPath3D.flightObjects[flightId] = this;

                this.renderer = new THREE.WebGLRenderer({
                    canvas: map.getCanvas(),
                    context: gl,
                    antialias: true
                });
                this.renderer.autoClear = false;

                FlownPath3D._updateGeometry(flightId, trailData);
            },
            render: function (gl, matrix) {
                // Resolution sync for Line2
                this.lineMaterial.resolution.set(gl.drawingBufferWidth, gl.drawingBufferHeight);

                const m = new THREE.Matrix4().fromArray(matrix);
                this.camera.projectionMatrix = m;
                this.renderer.resetState();
                this.renderer.render(this.scene, this.camera);
            }
        };
    },

    /**
     * Internal: Smoothes coordinates and updates both Line and Curtain geometries.
     */
    _updateGeometry(flightId, trailData) {
        const layerObj = this.flightObjects[flightId];
        if (!layerObj || !trailData || trailData.length < 2) return;

        const THREE = window.THREE;
        
        // Convert raw points to 3D Vectors in Mercator space
        const rawVectors = trailData.map(p => {
            const lng = p.longitude || p.lon;
            const lat = p.latitude || p.lat;
            const alt = (p.altitude || p.alt || 0) * 0.3048; // ft to meters
            const coord = mapboxgl.MercatorCoordinate.fromLngLat([lng, lat], alt);
            return new THREE.Vector3(coord.x, coord.y, coord.z);
        });

        // Spline Smoothing
        const curve = new THREE.CatmullRomCurve3(rawVectors);
        const smoothedPoints = curve.getPoints(trailData.length * 4);

        const linePositions = [];
        const lineColors = [];
        
        const curtainPositions = [];
        const curtainColors = [];

        // Color Palette
        const colorLow = new THREE.Color(0x0c4a6e);  // Deep Navy
        const colorHigh = new THREE.Color(0x38bdf8); // Sky Blue

        smoothedPoints.forEach((vector, i) => {
            // 1. Calculate Path Color (Altitude-based)
            const relativeAlt = Math.abs(vector.z) * 100000; 
            const t = Math.min(Math.max(relativeAlt / 5, 0), 1);
            const mixedColor = new THREE.Color().copy(colorLow).lerp(colorHigh, t);

            // 2. Line Data
            linePositions.push(vector.x, vector.y, vector.z);
            lineColors.push(mixedColor.r, mixedColor.g, mixedColor.b);

            // 3. Curtain Data (Triangulation)
            if (i < smoothedPoints.length - 1) {
                const nextVector = smoothedPoints[i + 1];
                
                // Segment Quad Points
                const topCurr = [vector.x, vector.y, vector.z];
                const botCurr = [vector.x, vector.y, 0]; // Ground level
                const topNext = [nextVector.x, nextVector.y, nextVector.z];
                const botNext = [nextVector.x, nextVector.y, 0]; // Ground level

                // Tri 1
                curtainPositions.push(...topCurr, ...botCurr, ...topNext);
                // Tri 2
                curtainPositions.push(...botCurr, ...botNext, ...topNext);

                // Curtain Colors
                const topColor = mixedColor;
                const bottomColor = new THREE.Color(colorLow).multiplyScalar(0.4);

                // Color mapping per vertex (match top and fade bottom)
                // Triangle 1 Colors
                curtainColors.push(topColor.r, topColor.g, topColor.b);
                curtainColors.push(bottomColor.r, bottomColor.g, bottomColor.b);
                curtainColors.push(topColor.r, topColor.g, topColor.b);

                // Triangle 2 Colors
                curtainColors.push(bottomColor.r, bottomColor.g, bottomColor.b);
                curtainColors.push(bottomColor.r, bottomColor.g, bottomColor.b);
                curtainColors.push(topColor.r, topColor.g, topColor.b);
            }
        });

        // Update the Line2
        layerObj.lineGeometry.setPositions(linePositions);
        layerObj.lineGeometry.setColors(lineColors);
        layerObj.line.computeLineDistances();

        // Update the Curtain Mesh
        layerObj.curtainGeometry.setAttribute('position', new THREE.Float32BufferAttribute(curtainPositions, 3));
        layerObj.curtainGeometry.setAttribute('color', new THREE.Float32BufferAttribute(curtainColors, 3));
        // Recalculate normals for correct rendering side handling
        layerObj.curtainGeometry.computeVertexNormals();
    },

    /**
     * Fallback: Standard thin lines if Line2 extensions are not loaded.
     */
    _createBasicLayer(layerId, flightId, trailData) {
        const THREE = window.THREE;
        return {
            id: layerId,
            type: 'custom',
            renderingMode: '3d',
            onAdd: function (map, gl) {
                this.camera = new THREE.Camera();
                this.scene = new THREE.Scene();
                this.geometry = new THREE.BufferGeometry();
                this.material = new THREE.LineBasicMaterial({ color: 0x38bdf8, opacity: 0.8, transparent: true });
                this.line = new THREE.Line(this.geometry, this.material);
                this.scene.add(this.line);
                FlownPath3D.flightObjects[flightId] = this;
                this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl });
                this.renderer.autoClear = false;
            },
            render: function (gl, matrix) {
                const m = new THREE.Matrix4().fromArray(matrix);
                this.camera.projectionMatrix = m;
                this.renderer.resetState();
                this.renderer.render(this.scene, this.camera);
            }
        };
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