/**
 * flownPath3D.js
 * Handles the rendering of 3D flight trails using Three.js.
 * Updated to support variable thickness based on altitude.
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
        const baseThickness = 0.0000055; // Max thickness in Mercator units
        const minThicknessMult = 0.2;    // Thinnest part (at ground level) is 20% of base
        const fullThicknessAlt = 10000;  // Altitude (ft) at which thickness becomes 100%

        trailData.forEach((p, index) => {
            const lng = p.longitude || p.lon;
            const lat = p.latitude || p.lat;
            const rawAlt = (p.altitude || p.alt || 0);
            const altMeters = rawAlt * 0.3048; 
            
            const coord = mapboxgl.MercatorCoordinate.fromLngLat([lng, lat], altMeters);
            points.push(new THREE.Vector3(coord.x, coord.y, coord.z));

            // Calculate altitude-based multiplier (0.2 to 1.0)
            let altFactor = Math.min(rawAlt / fullThicknessAlt, 1.0);
            altFactor = minThicknessMult + (altFactor * (1.0 - minThicknessMult));

            // Taper the very end of the trail (the newest point) for a pointed look
            let tipTaper = 1.0;
            if (index === trailData.length - 1) tipTaper = 0.1;
            else if (index === trailData.length - 2) tipTaper = 0.6;

            thicknessFactors.push(altFactor * tipTaper);
        });

        const curve = new THREE.CatmullRomCurve3(points);
        const tubularSegments = Math.max(30, points.length * 3);
        const radialSegments = 8; 

        /**
         * customTubeGeometry
         * Overriding the radius calculation to use our thicknessFactors array.
         * TubeGeometry typically uses a constant radius; we create the buffers manually
         * to allow the radius to change per segment based on altitude.
         */
        const newGeometry = new THREE.TubeGeometry(
            curve, 
            tubularSegments, 
            baseThickness, 
            radialSegments, 
            false
        );

        // Modify the generated geometry to apply our variable radius factors
        const position = newGeometry.attributes.position;
        const normal = newGeometry.attributes.normal;

        for (let i = 0; i < position.count; i++) {
            // Each vertex in a TubeGeometry belongs to a specific segment along the curve
            // We calculate which segment index [0 to trailData.length-1] it belongs to
            const vertexIdx = i;
            const segmentProgress = Math.floor(vertexIdx / (radialSegments + 1)) / tubularSegments;
            
            // Interpolate the thickness factor based on progress along the line
            const factorIndex = Math.min(
                Math.floor(segmentProgress * (thicknessFactors.length - 1)), 
                thicknessFactors.length - 1
            );
            const factor = thicknessFactors[factorIndex];

            // Adjust position: Original Vertex = PathPoint + (Normal * BaseRadius)
            // New Vertex = PathPoint + (Normal * BaseRadius * factor)
            // Since the position is already calculated, we move it along the normal
            const nx = normal.getX(i);
            const ny = normal.getY(i);
            const nz = normal.getZ(i);

            const px = position.getX(i);
            const py = position.getY(i);
            const pz = position.getZ(i);

            // Calculate "offset" logic to shrink towards the center of the tube
            const shrinkAmount = baseThickness * (1 - factor);
            position.setXYZ(
                i, 
                px - (nx * shrinkAmount),
                py - (ny * shrinkAmount),
                pz - (nz * shrinkAmount)
            );
        }

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