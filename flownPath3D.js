/**
 * flownPath3D.js
 * Handles the rendering of 3D flight trails using Three.js with MeshLine for consistent thickness.
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
            this._updateGeometry(map, flightId, trailData);
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

                // MeshLine implementation logic
                // We create a standard geometry first, which MeshLine will consume
                this.geometry = new THREE.BufferGeometry();
                
                // Material for the path
                this.material = new THREE.MeshBasicMaterial({ 
                    color: 0x38bdf8, 
                    transparent: true,
                    opacity: 0.9,
                    side: THREE.DoubleSide
                });

                // The Mesh object that will hold our path
                this.mesh = new THREE.Mesh(this.geometry, this.material);
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
                FlownPath3D._updateGeometry(map, flightId, trailData);
            },
            render: function (gl, matrix) {
                const m = new THREE.Matrix4().fromArray(matrix);
                this.camera.projectionMatrix = m;
                
                // Optional: Update thickness on every frame if zoom is changing
                // though usually handled in updatePath for performance.
                
                this.renderer.resetState(); 
                this.renderer.render(this.scene, this.camera);
            }
        };
    },

    /**
     * Internal: Updates coordinates and regenerates volumetric path with zoom-adjusted thickness
     */
    _updateGeometry(map, flightId, trailData) {
        if (!trailData || trailData.length < 2) return;
        
        const THREE = window.THREE;
        const layerObj = this.flightObjects[flightId];
        if (!layerObj || !layerObj.mesh) return;

        const positions = [];
        trailData.forEach(p => {
            const lng = p.longitude || p.lon;
            const lat = p.latitude || p.lat;
            const alt = (p.altitude || p.alt || 0) * 0.3048; 
            const coord = mapboxgl.MercatorCoordinate.fromLngLat([lng, lat], alt);
            positions.push(coord.x, coord.y, coord.z);
        });

        // 1. Calculate Dynamic Thickness based on Zoom
        // Mapbox zoom levels are logarithmic. We adjust the "world-space" thickness
        // so it appears relatively constant to the user's eye.
        const currentZoom = map.getZoom();
        
        // Base thickness at zoom 10
        const baseThickness = 0.000008; 
        
        // As zoom decreases (user zooms out), we need to INCREASE the world-space thickness
        // to keep it visible. As zoom increases (user zooms in), we decrease it for detail.
        const zoomFactor = Math.pow(2, 10 - currentZoom);
        const dynamicThickness = baseThickness * zoomFactor;

        // 2. Generate a "Tube" style MeshLine manually 
        // Note: Real THREE.MeshLine is an external library. Here we simulate 
        // the thickness using a high-resolution TubeGeometry which is the built-in 
        // way to handle 3D thickness in standard Three.js environments.
        const points = [];
        for (let i = 0; i < positions.length; i += 3) {
            points.push(new THREE.Vector3(positions[i], positions[i+1], positions[i+2]));
        }

        const curve = new THREE.CatmullRomCurve3(points);
        const tubularSegments = Math.max(20, points.length * 2);
        const radialSegments = 6; 
        
        const newGeometry = new THREE.TubeGeometry(
            curve, 
            tubularSegments, 
            dynamicThickness, 
            radialSegments, 
            false
        );

        // 3. Dispose and Swap
        if (layerObj.mesh.geometry) {
            layerObj.mesh.geometry.dispose();
        }
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