/**
 * flownPath3D.js
 * Handles the rendering of 3D flight trails using Three.js with TubeGeometry for thickness.
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

        // CRITICAL: Force Mapbox to repaint to show the updated line
        map.triggerRepaint();
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

                // Add lights so the Tube Mesh has shading and looks 3D
                const light = new THREE.DirectionalLight(0xffffff, 1);
                light.position.set(0, -1, 2).normalize();
                this.scene.add(light);
                
                const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
                this.scene.add(ambientLight);

                // Material for the tube
                // MeshStandardMaterial reacts to light, giving it a solid 3D look
                this.material = new THREE.MeshStandardMaterial({ 
                    color: 0x38bdf8, 
                    transparent: true,
                    opacity: 0.9,
                    roughness: 0.5,
                    metalness: 0.2
                });

                // The Mesh object that will hold our TubeGeometry
                this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
                
                // CRITICAL: Prevent the path from disappearing when looking away/zooming
                this.mesh.frustumCulled = false; 

                this.scene.add(this.mesh);

                // Track this layer for updates
                FlownPath3D.flightObjects[flightId] = this;

                this.renderer = new THREE.WebGLRenderer({
                    canvas: map.getCanvas(),
                    context: gl,
                    antialias: true
                });
                this.renderer.autoClear = false;

                // Initial data sync
                FlownPath3D._updateGeometry(flightId, trailData);
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
     * Internal: Updates coordinates and regenerates TubeGeometry
     */
    _updateGeometry(flightId, trailData) {
        if (!trailData || trailData.length < 2) return;
        
        const THREE = window.THREE;
        const layerObj = this.flightObjects[flightId];
        if (!layerObj || !layerObj.mesh) return;

        const points = [];
        
        trailData.forEach(p => {
            const lng = p.longitude || p.lon;
            const lat = p.latitude || p.lat;
            // alt is meters; coord.z in Mercator space is relative to world size
            const alt = (p.altitude || p.alt || 0) * 0.3048; 
            
            const coord = mapboxgl.MercatorCoordinate.fromLngLat([lng, lat], alt);
            points.push(new THREE.Vector3(coord.x, coord.y, coord.z));
        });

        // 1. Create a curve from the points
        const curve = new THREE.CatmullRomCurve3(points);

        // 2. Create New Tube Geometry
        // Parameters: (path, tubularSegments, radius, radialSegments, closed)
        // Radius is very small because Mapbox coordinates are 0 to 1 for the whole world.
        const tubeRadius = 0.000007; 
        const tubularSegments = points.length * 3; // Increase for smoother curves
        const radialSegments = 8; // 8 is usually enough for a circular look at this scale
        
        const newGeometry = new THREE.TubeGeometry(
            curve, 
            tubularSegments, 
            tubeRadius, 
            radialSegments, 
            false
        );

        // 3. Dispose of old geometry to prevent memory leaks
        if (layerObj.mesh.geometry) {
            layerObj.mesh.geometry.dispose();
        }

        // 4. Assign new geometry
        layerObj.mesh.geometry = newGeometry;
    },

    clearPath(map, flightId) {
        const layerId = `layer-3d-path-${flightId}`;
        const layerObj = this.flightObjects[flightId];

        if (layerObj) {
            if (layerObj.mesh) {
                if (layerObj.mesh.geometry) layerObj.mesh.geometry.dispose();
                if (layerObj.mesh.material) layerObj.mesh.material.dispose();
            }
        }

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