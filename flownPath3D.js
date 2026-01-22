/**
 * flownPath3D.js
 * Handles the rendering of 3D flight trails using Three.js.
 * Updated to support variable thickness based on altitude with GPU update flags.
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

        if (!is3DEnabled || !trailData || trailData.length < 2) {
            this.clearPath(map, flightId);
            return;
        }

        if (!map.getLayer(layerId)) {
            const customLayer = this._createCustomLayer(layerId, flightId, trailData);
            map.addLayer(customLayer);
        } else {
            this._updateGeometry(map, flightId, trailData);
        }

        map.triggerRepaint();
    },

    _createCustomLayer(layerId, flightId, trailData) {
        const THREE = window.THREE;
        
        return {
            id: layerId,
            type: 'custom',
            renderingMode: '3d',
            onAdd: function (map, gl) {
                this.camera = new THREE.Camera();
                this.scene = new THREE.Scene();

                this.geometry = new THREE.BufferGeometry();
                
                this.material = new THREE.MeshBasicMaterial({ 
                    color: 0x38bdf8, 
                    transparent: false,
                    side: THREE.DoubleSide
                });

                this.mesh = new THREE.Mesh(this.geometry, this.material);
                this.mesh.frustumCulled = false; 

                this.scene.add(this.mesh);
                FlownPath3D.flightObjects[flightId] = this;

                this.renderer = new THREE.WebGLRenderer({
                    canvas: map.getCanvas(),
                    context: gl,
                    antialias: true
                });
                this.renderer.autoClear = false;

                FlownPath3D._updateGeometry(map, flightId, trailData);
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
     * Internal: Updates coordinates and regenerates path with altitude-dependent thickness
     */
    _updateGeometry(map, flightId, trailData) {
        if (!trailData || trailData.length < 2) return;
        
        const THREE = window.THREE;
        const layerObj = this.flightObjects[flightId];
        if (!layerObj || !layerObj.mesh) return;

        const points = [];
        const thicknessFactors = [];

        // Constants for thickness scaling
        const baseThickness = 0.0000035; 
        const minThicknessMult = 0.05;   
        const fullThicknessAlt = 15000;  

        trailData.forEach((p, index) => {
            const lng = p.longitude || p.lon;
            const lat = p.latitude || p.lat;
            const rawAlt = (p.altitude || p.alt || 0);
            const altMeters = rawAlt * 0.3048; 
            
            const coord = mapboxgl.MercatorCoordinate.fromLngLat([lng, lat], altMeters);
            points.push(new THREE.Vector3(coord.x, coord.y, coord.z));

            // Calculate altitude-based multiplier
            let altFactor = Math.min(rawAlt / fullThicknessAlt, 1.0);
            altFactor = minThicknessMult + (altFactor * (1.0 - minThicknessMult));

            // Apply tapering to the very end of the trail
            if (index === trailData.length - 1) altFactor *= 0.1;
            else if (index === trailData.length - 2) altFactor *= 0.5;

            thicknessFactors.push(altFactor);
        });

        const curve = new THREE.CatmullRomCurve3(points);
        const tubularSegments = Math.max(64, points.length * 2); // Increased for smoothness
        const radialSegments = 8; 

        const newGeometry = new THREE.TubeGeometry(
            curve, 
            tubularSegments, 
            baseThickness, 
            radialSegments, 
            false
        );

        const position = newGeometry.attributes.position;
        const normal = newGeometry.attributes.normal;

        for (let i = 0; i < position.count; i++) {
            // 1. Identify which ring this vertex belongs to
            const ringIdx = Math.floor(i / (radialSegments + 1));
            const progress = ringIdx / tubularSegments;
            
            // 2. Linear Interpolation for smooth thickness
            // We find the exact spot in our thicknessFactors array
            const floatIdx = progress * (thicknessFactors.length - 1);
            const idx1 = Math.floor(floatIdx);
            const idx2 = Math.min(idx1 + 1, thicknessFactors.length - 1);
            const weight = floatIdx - idx1;

            // Interpolated factor between the two nearest data points
            const factor = (thicknessFactors[idx1] * (1 - weight)) + (thicknessFactors[idx2] * weight);

            // 3. Apply displacement
            const nx = normal.getX(i);
            const ny = normal.getY(i);
            const nz = normal.getZ(i);

            const px = position.getX(i);
            const py = position.getY(i);
            const pz = position.getZ(i);

            // Calculate how much to "pull" the vertex back toward the center
            // If factor is 1.0, shrink is 0 (full thickness). If factor is 0.1, shrink is 0.9.
            const shrinkAmount = baseThickness * (1 - factor);

            position.setXYZ(
                i, 
                px - (nx * shrinkAmount),
                py - (ny * shrinkAmount),
                pz - (nz * shrinkAmount)
            );
        }

        position.needsUpdate = true;

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