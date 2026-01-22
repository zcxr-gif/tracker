/**
 * flownPath3D.js
 * High-fidelity 3D flight path rendering for Mapbox using Three.js.
 * Features: 
 * - Thick Fat Lines (Line2) for high-altitude visibility.
 * - Altitude Curtains (vertical walls tethered to ground).
 * - Vertical Pillars for scale and depth.
 * - Catmull-Rom Spline smoothing.
 * - Altitude-based color gradients.
 */

export const FlownPath3D = {
    // Stores Three.js objects and metadata per flightId
    flightObjects: {},

    /**
     * Entry point: Adds or updates a high-quality 3D path.
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
     * Internal: Creates the Mapbox Custom Layer with Path, Curtain, and Pillars.
     */
    _createCustomLayer(layerId, flightId, trailData) {
        const THREE = window.THREE;

        // Fallback check for Fat Line extensions
        if (!THREE.Line2 || !THREE.LineGeometry || !THREE.LineMaterial) {
            console.warn("FlownPath3D: Three.js Line2 extensions missing. Falling back to basic lines.");
            return this._createBasicLayer(layerId, flightId, trailData);
        }

        const self = this;

        return {
            id: layerId,
            type: 'custom',
            renderingMode: '3d',
            onAdd: function (map, gl) {
                this.camera = new THREE.Camera();
                this.scene = new THREE.Scene();

                // --- 1. MAIN PATH (Fat Line) ---
                this.lineMaterial = new THREE.LineMaterial({
                    color: 0xffffff,
                    linewidth: 8,        // Thicker lines for visibility from up top
                    vertexColors: true,
                    transparent: true,
                    opacity: 0.9,
                    depthTest: true,
                    alphaToCoverage: true 
                });

                this.lineGeometry = new THREE.LineGeometry();
                this.line = new THREE.Line2(this.lineGeometry, this.lineMaterial);
                this.line.frustumCulled = false;
                this.scene.add(this.line);

                // --- 2. CURTAIN (Vertical Mesh) ---
                // Mesh connecting the flight path to the ground
                this.curtainGeometry = new THREE.BufferGeometry();
                this.curtainMaterial = new THREE.MeshBasicMaterial({
                    vertexColors: true,
                    transparent: true,
                    opacity: 0.25,      // Subtle curtain effect
                    side: THREE.DoubleSide,
                    depthWrite: false   // Prevents z-fighting with terrain/buildings
                });
                this.curtainMesh = new THREE.Mesh(this.curtainGeometry, this.curtainMaterial);
                this.scene.add(this.curtainMesh);

                // --- 3. PILLARS (Vertical Lines) ---
                this.pillarGeometry = new THREE.BufferGeometry();
                this.pillarMaterial = new THREE.LineBasicMaterial({
                    color: 0xffffff,
                    transparent: true,
                    opacity: 0.4
                });
                this.pillarLines = new THREE.LineSegments(this.pillarGeometry, this.pillarMaterial);
                this.scene.add(this.pillarLines);

                // Store reference for updates
                self.flightObjects[flightId] = this;

                this.renderer = new THREE.WebGLRenderer({
                    canvas: map.getCanvas(),
                    context: gl,
                    antialias: true
                });
                this.renderer.autoClear = false;

                self._updateGeometry(flightId, trailData);
            },
            render: function (gl, matrix) {
                // IMPORTANT: Line2 requires resolution sync to draw thickness correctly in screen space
                this.lineMaterial.resolution.set(gl.drawingBufferWidth, gl.drawingBufferHeight);

                const m = new THREE.Matrix4().fromArray(matrix);
                this.camera.projectionMatrix = m;
                this.renderer.resetState();
                this.renderer.render(this.scene, this.camera);
            }
        };
    },

    /**
     * Internal: Smooths coordinates and calculates geometry for Path, Curtain, and Pillars.
     */
    _updateGeometry(flightId, trailData) {
        const layerObj = this.flightObjects[flightId];
        if (!layerObj || !trailData || trailData.length < 2) return;

        const THREE = window.THREE;
        
        // 1. Convert raw points to 3D Vectors in Mercator space
        const rawVectors = trailData.map(p => {
            const lng = p.longitude || p.lon;
            const lat = p.latitude || p.lat;
            const alt = (p.altitude || p.alt || 0) * 0.3048; // ft to meters
            const coord = mapboxgl.MercatorCoordinate.fromLngLat([lng, lat], alt);
            return new THREE.Vector3(coord.x, coord.y, coord.z);
        });

        // 2. Spline Smoothing (4x density for fluidity)
        const curve = new THREE.CatmullRomCurve3(rawVectors);
        const smoothedPoints = curve.getPoints(trailData.length * 4);

        // Data containers
        const linePositions = [];
        const lineColors = [];
        
        const curtainPositions = [];
        const curtainColors = [];
        
        const pillarPositions = [];

        // Color Palette
        const colorLow = new THREE.Color(0x0c4a6e);  // Deep Navy (Ground/Curtain Bottom)
        const colorHigh = new THREE.Color(0x38bdf8); // Sky Blue (Cruising/Line)

        smoothedPoints.forEach((vector, i) => {
            // --- MAIN LINE ---
            linePositions.push(vector.x, vector.y, vector.z);
            
            // Calculate altitude gradient color
            const relativeAlt = Math.abs(vector.z) * 100000; 
            const t = Math.min(Math.max(relativeAlt / 5, 0), 1);
            const mixedColor = new THREE.Color().copy(colorLow).lerp(colorHigh, t);
            lineColors.push(mixedColor.r, mixedColor.g, mixedColor.b);

            // --- CURTAIN (Triangle Strip Mesh) ---
            // Point at altitude
            curtainPositions.push(vector.x, vector.y, vector.z);
            curtainColors.push(mixedColor.r, mixedColor.g, mixedColor.b);

            // Point at ground (z = 0 in Mercator space is sea level)
            curtainPositions.push(vector.x, vector.y, 0);
            curtainColors.push(colorLow.r, colorLow.g, colorLow.b); // Fade to dark at ground

            // --- PILLARS ---
            // Add a pillar every ~15 smoothed points to provide scale without cluttering
            if (i % 15 === 0) {
                pillarPositions.push(vector.x, vector.y, vector.z);
                pillarPositions.push(vector.x, vector.y, 0);
            }
        });

        // 3. Update Path (Fat Line) Attributes
        layerObj.lineGeometry.setPositions(linePositions);
        layerObj.lineGeometry.setColors(lineColors);
        layerObj.line.computeLineDistances();

        // 4. Update Curtain (Mesh) Attributes
        // Using BufferGeometry with standard draw calls (Triangles)
        // For a strip of N points, we have (N-1) quads, each quad is 2 triangles (6 indices)
        // Or we can use an index buffer for efficiency
        const indices = [];
        for (let j = 0; j < smoothedPoints.length - 1; j++) {
            const currTop = j * 2;
            const currBottom = j * 2 + 1;
            const nextTop = (j + 1) * 2;
            const nextBottom = (j + 1) * 2 + 1;

            // Triangle 1
            indices.push(currTop, currBottom, nextTop);
            // Triangle 2
            indices.push(currBottom, nextBottom, nextTop);
        }

        layerObj.curtainGeometry.setIndex(indices);
        layerObj.curtainGeometry.setAttribute('position', new THREE.Float32BufferAttribute(curtainPositions, 3));
        layerObj.curtainGeometry.setAttribute('color', new THREE.Float32BufferAttribute(curtainColors, 3));
        layerObj.curtainGeometry.attributes.position.needsUpdate = true;
        layerObj.curtainGeometry.attributes.color.needsUpdate = true;

        // 5. Update Pillars Attributes
        layerObj.pillarGeometry.setAttribute('position', new THREE.Float32BufferAttribute(pillarPositions, 3));
        layerObj.pillarGeometry.attributes.position.needsUpdate = true;
    },

    /**
     * Fallback: Standard thin lines if Line2 extensions are not loaded.
     */
    _createBasicLayer(layerId, flightId, trailData) {
        const THREE = window.THREE;
        const self = this;
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
                self.flightObjects[flightId] = this;
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

    /**
     * Remove specific flight layer and clean up resources.
     */
    clearPath(map, flightId) {
        const layerId = `layer-3d-path-${flightId}`;
        if (map.getLayer(layerId)) {
            map.removeLayer(layerId);
        }
        delete this.flightObjects[flightId];
    },

    /**
     * Clean up all active paths.
     */
    clearAllPaths(map) {
        if (!map) return;
        Object.keys(this.flightObjects).forEach(id => this.clearPath(map, id));
    }
};