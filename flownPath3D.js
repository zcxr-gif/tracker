/**
 * flownPath3D.js
 * Handles the rendering of 3D flight trails and vertical curtains using Three.js.
 * Optimized for incremental updates using pre-allocated buffers.
 */

export const FlownPath3D = {
    flightObjects: {},
    
    // Performance Constants
    MAX_POINTS: 5000, 
    SAMPLES_PER_POINT: 8, // Smoothness multiplier for the spline
    RADIAL_SEGMENTS: 6,   // Detail of the tube cross-section
    BASE_THICKNESS: 0.0000035,

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
        const self = this;
        
        return {
            id: layerId,
            type: 'custom',
            renderingMode: '3d',
            onAdd: function (map, gl) {
                this.camera = new THREE.Camera();
                this.scene = new THREE.Scene();

                // 1. Tube Geometry Setup
                // We pre-allocate a large buffer to avoid recreating geometry objects
                this.geometry = new THREE.BufferGeometry();
                const totalTubeVertices = self.MAX_POINTS * self.SAMPLES_PER_POINT * (self.RADIAL_SEGMENTS + 1);
                this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(totalTubeVertices * 3), 3));
                this.geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(totalTubeVertices * 3), 3));
                
                this.material = new THREE.MeshBasicMaterial({ 
                    color: 0x38bdf8, 
                    transparent: false,
                    side: THREE.DoubleSide
                });
                this.mesh = new THREE.Mesh(this.geometry, this.material);
                this.mesh.frustumCulled = false; 
                this.scene.add(this.mesh);

                // 2. Curtain Geometry Setup
                this.curtainGeometry = new THREE.BufferGeometry();
                const totalCurtainVertices = self.MAX_POINTS * self.SAMPLES_PER_POINT * 2;
                this.curtainGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(totalCurtainVertices * 3), 3));
                
                this.curtainMaterial = new THREE.MeshBasicMaterial({
                    color: 0x38bdf8,
                    transparent: true,
                    opacity: 0.3,
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
        if (!trailData || trailData.length < 2) return;
        
        const THREE = window.THREE;
        const layerObj = this.flightObjects[flightId];
        if (!layerObj) return;

        // 1. Process points into Vector3
        const points = [];
        const rawThicknessFactors = [];
        
        trailData.forEach((p, index) => {
            const altMeters = (p.altitude || p.alt || 0) * 0.3048; 
            const coord = mapboxgl.MercatorCoordinate.fromLngLat([p.longitude || p.lon, p.latitude || p.lat], altMeters);
            points.push(new THREE.Vector3(coord.x, coord.y, coord.z));

            const fullThicknessAlt = 15000;
            const minThicknessMult = 0.05;
            let altFactor = Math.min((p.altitude || p.alt || 0) / fullThicknessAlt, 1.0);
            altFactor = minThicknessMult + (altFactor * (1.0 - minThicknessMult));
            
            // Taper effect for the leading edge
            if (index === trailData.length - 1) altFactor *= 0.1;
            else if (index === trailData.length - 2) altFactor *= 0.5;

            rawThicknessFactors.push(altFactor);
        });

        // 2. Create Curve and Sample Points
        const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
        const tubularSegments = Math.min((points.length - 1) * this.SAMPLES_PER_POINT, this.MAX_POINTS - 1);
        
        // Use a temporary TubeGeometry to get high-quality normals and vertex offsets,
        // but we copy the data into our persistent buffer instead of swapping the mesh geometry.
        const tempTube = new THREE.TubeGeometry(curve, tubularSegments, this.BASE_THICKNESS, this.RADIAL_SEGMENTS, false);
        
        // 3. Update Tube persistent buffer
        const posAttr = layerObj.geometry.attributes.position;
        const normAttr = layerObj.geometry.attributes.normal;
        const tempPos = tempTube.attributes.position;
        const tempNorm = tempTube.attributes.normal;

        for (let i = 0; i < tempPos.count; i++) {
            const ringIdx = Math.floor(i / (this.RADIAL_SEGMENTS + 1));
            const progress = ringIdx / tubularSegments;
            
            const floatIdx = progress * (rawThicknessFactors.length - 1);
            const idx1 = Math.floor(floatIdx);
            const idx2 = Math.min(idx1 + 1, rawThicknessFactors.length - 1);
            const weight = floatIdx - idx1;
            const factor = (rawThicknessFactors[idx1] * (1 - weight)) + (rawThicknessFactors[idx2] * weight);
            
            const nx = tempNorm.getX(i);
            const ny = tempNorm.getY(i);
            const nz = tempNorm.getZ(i);
            const px = tempPos.getX(i);
            const py = tempPos.getY(i);
            const pz = tempPos.getZ(i);

            const shrinkAmount = this.BASE_THICKNESS * (1 - factor);
            posAttr.setXYZ(i, px - (nx * shrinkAmount), py - (ny * shrinkAmount), pz - (nz * shrinkAmount));
            normAttr.setXYZ(i, nx, ny, nz);
        }

        layerObj.geometry.setIndex(tempTube.index);
        posAttr.needsUpdate = true;
        normAttr.needsUpdate = true;
        layerObj.geometry.setDrawRange(0, tempTube.index.count);

        // 4. Update Curtain persistent buffer
        const curtainPosAttr = layerObj.curtainGeometry.attributes.position;
        const curvePoints = curve.getPoints(tubularSegments);
        const curtainIndices = [];

        for (let i = 0; i <= tubularSegments; i++) {
            const p = curvePoints[i];
            const idx = i * 2;
            curtainPosAttr.setXYZ(idx, p.x, p.y, p.z);     // Top
            curtainPosAttr.setXYZ(idx + 1, p.x, p.y, 0); // Ground

            if (i > 0) {
                const curr = i * 2;
                const prev = (i - 1) * 2;
                curtainIndices.push(prev, prev + 1, curr, prev + 1, curr + 1, curr);
            }
        }
        
        curtainPosAttr.needsUpdate = true;
        layerObj.curtainGeometry.setIndex(curtainIndices);
        layerObj.curtainGeometry.setDrawRange(0, curtainIndices.length);

        // Cleanup temporary object
        tempTube.dispose();
    },
    
    clearPath(map, flightId) {
        const layerId = `layer-3d-path-${flightId}`;
        const layerObj = this.flightObjects[flightId];

        if (layerObj) {
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