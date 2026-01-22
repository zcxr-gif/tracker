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

        // 1. Process Coordinates (Identical for both Curtain and Path)
        trailData.forEach((p, index) => {
            const lng = p.longitude || p.lon;
            const lat = p.latitude || p.lat;
            const rawAlt = (p.altitude || p.alt || 0);
            const altMeters = rawAlt * 0.3048; 
            
            const coord = mapboxgl.MercatorCoordinate.fromLngLat([lng, lat], altMeters);
            
            const topPoint = new THREE.Vector3(coord.x, coord.y, coord.z);
            points.push(topPoint);

            // Curtain Construction
            curtainVertices.push(coord.x, coord.y, coord.z);    // Top
            curtainVertices.push(coord.x, coord.y, 0);          // Bottom (Ground)

            if (index > 0) {
                const i = index * 2;
                curtainIndices.push(i - 2, i - 1, i);
                curtainIndices.push(i - 1, i + 1, i);
            }

            // Thickness Logic
            let altFactor = Math.min(rawAlt / fullThicknessAlt, 1.0);
            altFactor = minThicknessMult + (altFactor * (1.0 - minThicknessMult));
            if (index === trailData.length - 1) altFactor *= 0.1;
            thicknessFactors.push(altFactor);
        });

        // Update Curtain Geometry
        layerObj.curtainGeometry.setAttribute('position', new THREE.Float32BufferAttribute(curtainVertices, 3));
        layerObj.curtainGeometry.setIndex(curtainIndices);
        layerObj.curtainGeometry.attributes.position.needsUpdate = true;

        // 2. Linear Path Construction (The Fix)
        const curvePath = new THREE.CurvePath();
        for (let i = 0; i < points.length - 1; i++) {
            curvePath.add(new THREE.LineCurve3(points[i], points[i + 1]));
        }

        // KEY CHANGE: Set segments to EXACTLY the number of points minus one.
        // This ensures the tube "rings" align perfectly with the curtain vertices.
        const tubularSegments = points.length - 1; 
        const radialSegments = 8; 

        const newTubeGeometry = new THREE.TubeGeometry(curvePath, tubularSegments, baseThickness, radialSegments, false);
        const position = newTubeGeometry.attributes.position;
        const normal = newTubeGeometry.attributes.normal;

        // 3. Apply Thickness Scaling (Simplified 1:1 Mapping)
        for (let i = 0; i < position.count; i++) {
            // Because segments = points - 1, ringIdx maps directly to our point index
            const ringIdx = Math.floor(i / (radialSegments + 1));
            const factor = thicknessFactors[ringIdx];
            
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