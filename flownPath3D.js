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
        if (!trailData || trailData.length < 2) return;
        
        const THREE = window.THREE;
        const layerObj = this.flightObjects[flightId];
        if (!layerObj || !layerObj.mesh) return;

        const points = [];
        const thicknessFactors = [];
        const curtainVertices = [];
        const curtainIndices = [];

        const baseThickness = 0.0000035; 
        const minThicknessMult = 0.05;   
        const fullThicknessAlt = 15000;  

        trailData.forEach((p, index) => {
            const lng = p.longitude || p.lon;
            const lat = p.latitude || p.lat;
            const rawAlt = (p.altitude || p.alt || 0);
            const altMeters = rawAlt * 0.3048; 
            
            const coord = mapboxgl.MercatorCoordinate.fromLngLat([lng, lat], altMeters);
            const groundCoord = mapboxgl.MercatorCoordinate.fromLngLat([lng, lat], 0);
            
            const topPoint = new THREE.Vector3(coord.x, coord.y, coord.z);
            points.push(topPoint);

            // --- Curtain Construction ---
            // We add two vertices per trail point: Top and Bottom
            curtainVertices.push(coord.x, coord.y, coord.z);    // Top
            curtainVertices.push(coord.x, coord.y, 0);          // Bottom (Ground)

            // Create triangles for the curtain wall (Quad)
            if (index > 0) {
                const i = index * 2;
                // Triangle 1: Top Prev, Bottom Prev, Top Curr
                curtainIndices.push(i - 2, i - 1, i);
                // Triangle 2: Bottom Prev, Bottom Curr, Top Curr
                curtainIndices.push(i - 1, i + 1, i);
            }

            // --- Tube Thickness Logic ---
            let altFactor = Math.min(rawAlt / fullThicknessAlt, 1.0);
            altFactor = minThicknessMult + (altFactor * (1.0 - minThicknessMult));
            if (index === trailData.length - 1) altFactor *= 0.1;
            else if (index === trailData.length - 2) altFactor *= 0.5;

            thicknessFactors.push(altFactor);
        });

        // Update Curtain Geometry
        layerObj.curtainGeometry.setAttribute('position', new THREE.Float32BufferAttribute(curtainVertices, 3));
        layerObj.curtainGeometry.setIndex(curtainIndices);
        layerObj.curtainGeometry.attributes.position.needsUpdate = true;

        // Update Tube Geometry (Existing Logic)
        const curve = new THREE.CatmullRomCurve3(points);
        const tubularSegments = Math.max(64, points.length * 2);
        const radialSegments = 8; 

        const newTubeGeometry = new THREE.TubeGeometry(curve, tubularSegments, baseThickness, radialSegments, false);
        const position = newTubeGeometry.attributes.position;
        const normal = newTubeGeometry.attributes.normal;

        for (let i = 0; i < position.count; i++) {
            const ringIdx = Math.floor(i / (radialSegments + 1));
            const progress = ringIdx / tubularSegments;
            const floatIdx = progress * (thicknessFactors.length - 1);
            const idx1 = Math.floor(floatIdx);
            const idx2 = Math.min(idx1 + 1, thicknessFactors.length - 1);
            const weight = floatIdx - idx1;

            const factor = (thicknessFactors[idx1] * (1 - weight)) + (thicknessFactors[idx2] * weight);
            const nx = normal.getX(i);
            const ny = normal.getY(i);
            const nz = normal.getZ(i);

            const px = position.getX(i);
            const py = position.getY(i);
            const pz = position.getZ(i);

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