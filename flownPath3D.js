/**
 * flownPath3D.js
 * Handles the rendering of 3D flight trails, vertical curtains, and milestone pillars using Three.js.
 */

export const FlownPath3D = {
    flightObjects: {},
    
    // Performance Constants
    MAX_POINTS: 5000, 
    SAMPLES_PER_POINT: 8, 
    RADIAL_SEGMENTS: 6,   
    BASE_THICKNESS: 0.0000035,
    PILLAR_INTERVAL: 2000, // Every 2000ft

    // Altitude Color Config (Feet)
    ALTITUDE_STOPS: [
        { alt: 0, color: new window.THREE.Color(0xf97316) },     // Orange (Low)
        { alt: 10000, color: new window.THREE.Color(0xfacc15) }, // Yellow
        { alt: 25000, color: new window.THREE.Color(0x38bdf8) }, // Sky Blue
        { alt: 40000, color: new window.THREE.Color(0x818cf8) }  // Indigo (High)
    ],

    _getColorForAlt(alt) {
        const stops = this.ALTITUDE_STOPS;
        if (alt <= stops[0].alt) return stops[0].color;
        if (alt >= stops[stops.length - 1].alt) return stops[stops.length - 1].color;

        for (let i = 0; i < stops.length - 1; i++) {
            const s1 = stops[i];
            const s2 = stops[i + 1];
            if (alt >= s1.alt && alt <= s2.alt) {
                const t = (alt - s1.alt) / (s2.alt - s1.alt);
                return new window.THREE.Color().copy(s1.color).lerp(s2.color, t);
            }
        }
        return stops[0].color;
    },

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
                this.geometry = new THREE.BufferGeometry();
                const totalTubeVertices = self.MAX_POINTS * self.SAMPLES_PER_POINT * (self.RADIAL_SEGMENTS + 1);
                this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(totalTubeVertices * 3), 3));
                this.geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(totalTubeVertices * 3), 3));
                this.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(totalTubeVertices * 3), 3));
                
                this.material = new THREE.MeshBasicMaterial({ 
                    vertexColors: true,
                    side: THREE.DoubleSide
                });
                this.mesh = new THREE.Mesh(this.geometry, this.material);
                this.mesh.frustumCulled = false; 
                this.scene.add(this.mesh);

                // 2. Curtain Geometry Setup
                this.curtainGeometry = new THREE.BufferGeometry();
                const totalCurtainVertices = self.MAX_POINTS * self.SAMPLES_PER_POINT * 2;
                this.curtainGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(totalCurtainVertices * 3), 3));
                this.curtainGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(totalCurtainVertices * 3), 3));
                
                this.curtainMaterial = new THREE.MeshBasicMaterial({
                    vertexColors: true,
                    transparent: true,
                    opacity: 0.3,
                    side: THREE.DoubleSide
                });
                this.curtainMesh = new THREE.Mesh(this.curtainGeometry, this.curtainMaterial);
                this.curtainMesh.frustumCulled = false;
                this.scene.add(this.curtainMesh);

                // 3. Pillars Group
                this.pillarsGroup = new THREE.Group();
                this.scene.add(this.pillarsGroup);

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

        const points = [];
        const rawThicknessFactors = [];
        const rawAltitudes = [];
        const pillarLocations = [];

        let lastPillarZone = -1;
        
        trailData.forEach((p, index) => {
            const alt = p.altitude || p.alt || 0;
            const altMeters = alt * 0.3048; 
            const coord = mapboxgl.MercatorCoordinate.fromLngLat([p.longitude || p.lon, p.latitude || p.lat], altMeters);
            const vec = new THREE.Vector3(coord.x, coord.y, coord.z);
            points.push(vec);
            rawAltitudes.push(alt);

            // Pillar detection: Crossing a multiple of PILLAR_INTERVAL
            const currentPillarZone = Math.floor(alt / this.PILLAR_INTERVAL);
            if (index > 0 && currentPillarZone !== lastPillarZone && alt > 0) {
                pillarLocations.push({
                    pos: vec,
                    alt: alt,
                    color: this._getColorForAlt(alt)
                });
            }
            lastPillarZone = currentPillarZone;

            // Thickness calculations
            const fullThicknessAlt = 15000;
            const minThicknessMult = 0.05;
            let altFactor = Math.min(alt / fullThicknessAlt, 1.0);
            altFactor = minThicknessMult + (altFactor * (1.0 - minThicknessMult));
            
            if (index === trailData.length - 1) altFactor *= 0.1;
            else if (index === trailData.length - 2) altFactor *= 0.5;

            rawThicknessFactors.push(altFactor);
        });

        // Update Tube
        const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
        const tubularSegments = Math.min((points.length - 1) * this.SAMPLES_PER_POINT, this.MAX_POINTS - 1);
        const tempTube = new THREE.TubeGeometry(curve, tubularSegments, this.BASE_THICKNESS, this.RADIAL_SEGMENTS, false);
        
        const posAttr = layerObj.geometry.attributes.position;
        const normAttr = layerObj.geometry.attributes.normal;
        const colorAttr = layerObj.geometry.attributes.color;
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
            const currentAlt = (rawAltitudes[idx1] * (1 - weight)) + (rawAltitudes[idx2] * weight);
            const color = this._getColorForAlt(currentAlt);
            
            const nx = tempNorm.getX(i);
            const ny = tempNorm.getY(i);
            const nz = tempNorm.getZ(i);
            const px = tempPos.getX(i);
            const py = tempPos.getY(i);
            const pz = tempPos.getZ(i);

            const shrinkAmount = this.BASE_THICKNESS * (1 - factor);
            posAttr.setXYZ(i, px - (nx * shrinkAmount), py - (ny * shrinkAmount), pz - (nz * shrinkAmount));
            normAttr.setXYZ(i, nx, ny, nz);
            colorAttr.setXYZ(i, color.r, color.g, color.b);
        }

        layerObj.geometry.setIndex(tempTube.index);
        posAttr.needsUpdate = true;
        normAttr.needsUpdate = true;
        colorAttr.needsUpdate = true;
        layerObj.geometry.setDrawRange(0, tempTube.index.count);

        // Update Curtain
        const curtainPosAttr = layerObj.curtainGeometry.attributes.position;
        const curtainColorAttr = layerObj.curtainGeometry.attributes.color;
        const curvePoints = curve.getPoints(tubularSegments);
        const curtainIndices = [];

        for (let i = 0; i <= tubularSegments; i++) {
            const p = curvePoints[i];
            const idx = i * 2;
            const floatIdx = (i / tubularSegments) * (rawAltitudes.length - 1);
            const idx1 = Math.floor(floatIdx);
            const idx2 = Math.min(idx1 + 1, rawAltitudes.length - 1);
            const weight = floatIdx - idx1;
            const currentAlt = (rawAltitudes[idx1] * (1 - weight)) + (rawAltitudes[idx2] * weight);
            const color = this._getColorForAlt(currentAlt);

            curtainPosAttr.setXYZ(idx, p.x, p.y, p.z);     
            curtainPosAttr.setXYZ(idx + 1, p.x, p.y, 0); 
            curtainColorAttr.setXYZ(idx, color.r, color.g, color.b);
            curtainColorAttr.setXYZ(idx + 1, color.r, color.g, color.b);

            if (i > 0) {
                const curr = i * 2;
                const prev = (i - 1) * 2;
                curtainIndices.push(prev, prev + 1, curr, prev + 1, curr + 1, curr);
            }
        }
        
        curtainPosAttr.needsUpdate = true;
        curtainColorAttr.needsUpdate = true;
        layerObj.curtainGeometry.setIndex(curtainIndices);
        layerObj.curtainGeometry.setDrawRange(0, curtainIndices.length);

        // Update Pillars
        this._updatePillars(layerObj, pillarLocations);

        tempTube.dispose();
    },

    _updatePillars(layerObj, locations) {
        const THREE = window.THREE;
        const group = layerObj.pillarsGroup;

        // Clear existing pillars in this group
        while(group.children.length > 0) {
            const child = group.children[0];
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
            group.remove(child);
        }

        const pillarRadius = this.BASE_THICKNESS * 2.5;

        locations.forEach(loc => {
            // A pillar from ground (z=0) to flight altitude (z=loc.pos.z)
            const height = Math.abs(loc.pos.z);
            if (height <= 0) return;

            const geometry = new THREE.CylinderGeometry(pillarRadius, pillarRadius, height, 8);
            const material = new THREE.MeshBasicMaterial({ 
                color: loc.color,
                transparent: true,
                opacity: 0.8
            });
            
            const pillar = new THREE.Mesh(geometry, material);
            
            // Cylinder is created centered on Y axis by default in Three.js
            // Rotate to align with Z axis and position correctly
            pillar.rotation.x = Math.PI / 2;
            pillar.position.set(loc.pos.x, loc.pos.y, loc.pos.z / 2);
            
            group.add(pillar);
        });
    },
    
    clearPath(map, flightId) {
        const layerId = `layer-3d-path-${flightId}`;
        const layerObj = this.flightObjects[flightId];

        if (layerObj) {
            const items = [layerObj.mesh, layerObj.curtainMesh];
            if (layerObj.pillarsGroup) {
                layerObj.pillarsGroup.children.forEach(c => items.push(c));
            }

            items.forEach(obj => {
                if (obj) {
                    if (obj.geometry) obj.geometry.dispose();
                    if (obj.material) obj.material.dispose();
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