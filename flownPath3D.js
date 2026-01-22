/**
 * flownPath3D.js
 * Handles the rendering of 3D flight trails and vertical curtains using Three.js.
 */

export const FlownPath3D = {
    flightObjects: {},

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

                // 1. Tube Geometry (The Line)
                this.geometry = new THREE.BufferGeometry();
                this.material = new THREE.MeshBasicMaterial({ 
                    color: 0x38bdf8, 
                    transparent: false,
                    side: THREE.DoubleSide
                });
                this.mesh = new THREE.Mesh(this.geometry, this.material);
                this.mesh.frustumCulled = false; 
                this.scene.add(this.mesh);

                // 2. Curtain Geometry (The Wall)
                this.curtainGeometry = new THREE.BufferGeometry();
                this.curtainMaterial = new THREE.MeshBasicMaterial({
                    color: 0x38bdf8,
                    transparent: true,
                    opacity: 0.3, // Semi-transparent curtain
                    side: THREE.DoubleSide
                });
                this.curtainMesh = new THREE.Mesh(this.curtainGeometry, this.curtainMaterial);
                this.curtainMesh.frustumCulled = false;
                this.scene.add(this.curtainMesh);

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

    _updateGeometry(map, flightId, trailData) {
        if (!trailData || !trailData.length || trailData.length < 2) return;
        
        const THREE = window.THREE;
        const layerObj = this.flightObjects[flightId];
        if (!layerObj || !layerObj.mesh) return;

        const points = [];
        const rawThicknessFactors = [];

        // 1. Convert Data to Vector3 Points
        trailData.forEach((p, index) => {
            const lng = p.longitude || p.lon;
            const lat = p.latitude || p.lat;
            const rawAlt = (p.altitude || p.alt || 0);
            const altMeters = rawAlt * 0.3048; 
            
            const coord = mapboxgl.MercatorCoordinate.fromLngLat([lng, lat], altMeters);
            points.push(new THREE.Vector3(coord.x, coord.y, coord.z));

            // Calculate thickness for this specific raw point
            const fullThicknessAlt = 15000;
            const minThicknessMult = 0.05;
            let altFactor = Math.min(rawAlt / fullThicknessAlt, 1.0);
            altFactor = minThicknessMult + (altFactor * (1.0 - minThicknessMult));
            
            // Taper the end (the plane's current position)
            if (index === trailData.length - 1) altFactor *= 0.1;
            else if (index === trailData.length - 2) altFactor *= 0.5;

            rawThicknessFactors.push(altFactor);
        });

        // 2. Create the Smooth Spline
        // 'centripetal' is crucial for flight paths—it avoids "wobbles" in sharp turns
        const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
        
        // Increase tubularSegments for high-quality smoothness
        // 12 segments per data point usually looks like a perfect curve
        const tubularSegments = points.length * 12; 
        const radialSegments = 8; 
        const baseThickness = 0.0000035;

        const newTubeGeometry = new THREE.TubeGeometry(curve, tubularSegments, baseThickness, radialSegments, false);

        // 3. Update Curtain Geometry to match the Spline
        const curtainVertices = [];
        const curtainIndices = [];
        
        // We sample the curve to build the curtain so it matches the smooth tube
        for (let i = 0; i <= tubularSegments; i++) {
            const t = i / tubularSegments;
            const pos = curve.getPoint(t);

            curtainVertices.push(pos.x, pos.y, pos.z); // Top (on the spline)
            curtainVertices.push(pos.x, pos.y, 0);     // Bottom (at ground level)

            if (i > 0) {
                const curr = i * 2;
                const prev = (i - 1) * 2;
                // Triangle 1
                curtainIndices.push(prev, prev + 1, curr);
                // Triangle 2
                curtainIndices.push(prev + 1, curr + 1, curr);
            }
        }

        layerObj.curtainGeometry.setIndex(curtainIndices);
        layerObj.curtainGeometry.setAttribute('position', new THREE.Float32BufferAttribute(curtainVertices, 3));
        layerObj.curtainGeometry.attributes.position.needsUpdate = true;

        // 4. Apply Dynamic Thickness Scaling to the Tube
        const position = newTubeGeometry.attributes.position;
        const normal = newTubeGeometry.attributes.normal;

        for (let i = 0; i < position.count; i++) {
            const ringIdx = Math.floor(i / (radialSegments + 1));
            const progress = ringIdx / tubularSegments;
            
            // Map progress to the rawThicknessFactors array
            const floatIdx = progress * (rawThicknessFactors.length - 1);
            const idx1 = Math.floor(floatIdx);
            const idx2 = Math.min(idx1 + 1, rawThicknessFactors.length - 1);
            const weight = floatIdx - idx1;

            const factor = (rawThicknessFactors[idx1] * (1 - weight)) + (rawThicknessFactors[idx2] * weight);
            
            const nx = normal.getX(i);
            const ny = normal.getY(i);
            const nz = normal.getZ(i);
            const px = position.getX(i);
            const py = position.getY(i);
            const pz = position.getZ(i);

            // Push vertices inward based on the thickness factor
            const shrinkAmount = baseThickness * (1 - factor);
            position.setXYZ(i, px - (nx * shrinkAmount), py - (ny * shrinkAmount), pz - (nz * shrinkAmount));
        }

        position.needsUpdate = true;
        if (layerObj.mesh.geometry) layerObj.mesh.geometry.dispose();
        layerObj.mesh.geometry = newTubeGeometry;
    },
    
    clearPath(map, flightId) {
        const layerId = `layer-3d-path-${flightId}`;
        const layerObj = this.flightObjects[flightId];

        if (layerObj) {
            // Clean up both Tube and Curtain
            [layerObj.mesh, layerObj.curtainMesh].forEach(mesh => {
                if (mesh) {
                    if (mesh.geometry) mesh.geometry.dispose();
                    if (mesh.material) mesh.material.dispose();
                }
            });
        }

        if (map.getLayer(layerId)) map.removeLayer(layerId);
        delete this.flightObjects[flightId];
    },

    clearAllPaths(map) {
        if (!map) return;
        Object.keys(this.flightObjects).forEach(id => this.clearPath(map, id));
    }
};