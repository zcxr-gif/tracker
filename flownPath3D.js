/**
 * flownPath3D.js
 * Optimized for high-impact visuals: larger labels, rich data density, and neon aesthetics.
 */

export const FlownPath3D = {
    flightObjects: {},
    font: null,
    
    // Performance & Visual Constants
    MAX_POINTS: 8000, 
    SAMPLES_PER_POINT: 12, // Increased for smoother curves
    RADIAL_SEGMENTS: 8,    
    BASE_THICKNESS: 0.000005, // Slightly thicker for "cooler" presence

    // High-Contrast Neon Altitude Palette
    ALTITUDE_STOPS: [
        { alt: 0, color: new window.THREE.Color(0xff0055) },     // Deep Pink (Ground)
        { alt: 5000, color: new window.THREE.Color(0xffaa00) },  // Amber
        { alt: 15000, color: new window.THREE.Color(0x00ffcc) }, // Cyan/Teal
        { alt: 30000, color: new window.THREE.Color(0x3366ff) }, // Electric Blue
        { alt: 45000, color: new window.THREE.Color(0xcc00ff) }  // Purple (High Altitude)
    ],

    /**
     * Loads the font required for 3D labels.
     */
    async _loadFont() {
        if (this.font) return this.font;
        const THREE = window.THREE;
        
        if (!THREE.FontLoader) {
            await this._loadScript('https://cdn.jsdelivr.net/npm/three@0.145.0/examples/js/loaders/FontLoader.js');
        }

        const loader = new THREE.FontLoader();
        return new Promise((resolve, reject) => {
            loader.load('https://cdn.jsdelivr.net/npm/three@0.145.0/examples/fonts/helvetiker_bold.typeface.json', (response) => {
                this.font = response;
                resolve(response);
            }, undefined, reject);
        });
    },

    _loadScript(url) {
        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = url;
            script.onload = resolve;
            document.head.appendChild(script);
        });
    },

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

    async updatePath(map, flightId, trailData, is3DEnabled) {
        if (!map || !flightId) return;
        const layerId = `layer-3d-path-${flightId}`;

        if (!is3DEnabled || !trailData || trailData.length < 2) {
            this.clearPath(map, flightId);
            return;
        }

        try {
            await this._loadFont();
        } catch (e) {
            console.error("Failed to load 3D Font", e);
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

                // Path Tube
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

                // Vertical Curtain (Holographic look)
                this.curtainGeometry = new THREE.BufferGeometry();
                const totalCurtainVertices = self.MAX_POINTS * self.SAMPLES_PER_POINT * 2;
                this.curtainGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(totalCurtainVertices * 3), 3));
                this.curtainGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(totalCurtainVertices * 3), 3));
                
                this.curtainMaterial = new THREE.MeshBasicMaterial({
                    vertexColors: true,
                    transparent: true,
                    opacity: 0.25,
                    side: THREE.DoubleSide
                });
                this.curtainMesh = new THREE.Mesh(this.curtainGeometry, this.curtainMaterial);
                this.curtainMesh.frustumCulled = false;
                this.scene.add(this.curtainMesh);

                this.labelGroup = new THREE.Group();
                this.scene.add(this.labelGroup);

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
        const rawAltitudes = []; 
        
        trailData.forEach((p) => {
            const alt = p.altitude || p.alt || 0;
            const altMeters = alt * 0.3048; 
            const coord = mapboxgl.MercatorCoordinate.fromLngLat([p.longitude || p.lon, p.latitude || p.lat], altMeters);
            points.push(new THREE.Vector3(coord.x, coord.y, coord.z));
            rawAltitudes.push(alt);
        });

        const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
        const tubularSegments = Math.min((points.length - 1) * this.SAMPLES_PER_POINT, this.MAX_POINTS - 1);
        
        const tempTube = new THREE.TubeGeometry(curve, tubularSegments, this.BASE_THICKNESS, this.RADIAL_SEGMENTS, false);
        
        const posAttr = layerObj.geometry.attributes.position;
        const colorAttr = layerObj.geometry.attributes.color;
        const tempPos = tempTube.attributes.position;

        for (let i = 0; i < tempPos.count; i++) {
            const ringIdx = Math.floor(i / (this.RADIAL_SEGMENTS + 1));
            const progress = ringIdx / tubularSegments;
            const floatIdx = progress * (rawAltitudes.length - 1);
            const idx1 = Math.floor(floatIdx);
            const idx2 = Math.min(idx1 + 1, rawAltitudes.length - 1);
            const weight = floatIdx - idx1;
            const currentAlt = (rawAltitudes[idx1] * (1 - weight)) + (rawAltitudes[idx2] * weight);
            const color = this._getColorForAlt(currentAlt);
            
            posAttr.setXYZ(i, tempPos.getX(i), tempPos.getY(i), tempPos.getZ(i));
            colorAttr.setXYZ(i, color.r, color.g, color.b);
        }

        layerObj.geometry.setIndex(tempTube.index);
        posAttr.needsUpdate = true;
        colorAttr.needsUpdate = true;
        layerObj.geometry.setDrawRange(0, tempTube.index.count);

        const curtainPosAttr = layerObj.curtainGeometry.attributes.position;
        const curtainColorAttr = layerObj.curtainGeometry.attributes.color;
        const curvePoints = curve.getPoints(tubularSegments);
        const curtainIndices = [];

        for (let i = 0; i <= tubularSegments; i++) {
            const p = curvePoints[i];
            const idx = i * 2;
            const floatIdx = (i / tubularSegments) * (rawAltitudes.length - 1);
            const alt = rawAltitudes[Math.round(floatIdx)];
            const color = this._getColorForAlt(alt);

            curtainPosAttr.setXYZ(idx, p.x, p.y, p.z);     
            curtainPosAttr.setXYZ(idx + 1, p.x, p.y, 0); 
            curtainColorAttr.setXYZ(idx, color.r, color.g, color.b);
            curtainColorAttr.setXYZ(idx + 1, color.r, color.g, color.b);

            if (i > 0) {
                const curr = i * 2; const prev = (i - 1) * 2;
                curtainIndices.push(prev, prev + 1, curr, prev + 1, curr + 1, curr);
            }
        }
        curtainPosAttr.needsUpdate = true;
        curtainColorAttr.needsUpdate = true;
        layerObj.curtainGeometry.setIndex(curtainIndices);
        layerObj.curtainGeometry.setDrawRange(0, curtainIndices.length);

        this._updateLabels(layerObj, curve, trailData);
        tempTube.dispose();
    },

    _updateLabels(layerObj, curve, trailData) {
        const THREE = window.THREE;
        if (!this.font) return;

        while(layerObj.labelGroup.children.length > 0){ 
            const child = layerObj.labelGroup.children[0];
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
            layerObj.labelGroup.remove(child); 
        }

        // Increased data frequency: Labels at 10% intervals
        const labelIntervals = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 0.95]; 
        const offsetDist = 0.000003; 

        labelIntervals.forEach(t => {
            const pos = curve.getPointAt(t);
            const tangent = curve.getTangentAt(t).normalize();
            
            const rawIdx = Math.floor(t * (trailData.length - 1));
            const alt = trailData[rawIdx].altitude || 0;
            
            // Richer Data: Add altitude delta trend
            let trend = "";
            if (rawIdx > 0) {
                const prevAlt = trailData[rawIdx - 1].altitude || 0;
                if (alt > prevAlt + 50) trend = " ▲";
                else if (alt < prevAlt - 50) trend = " ▼";
            }
            
            const labelText = `${Math.round(alt).toLocaleString()} FT${trend}`;
            const labelSize = 0.000018; // 50% Bigger

            const up = new THREE.Vector3(0, 0, 1);
            const side = new THREE.Vector3().crossVectors(tangent, up).normalize();
            const centeredZ = pos.z / 1.5; // Offset slightly for better visibility

            const createLabel = (direction) => {
                const shapes = this.font.generateShapes(labelText, labelSize);
                const textGeo = new THREE.ShapeGeometry(shapes);
                
                textGeo.computeBoundingBox();
                const centerOffset = new THREE.Vector3();
                textGeo.boundingBox.getCenter(centerOffset).multiplyScalar(-1);
                textGeo.translate(centerOffset.x, centerOffset.y, centerOffset.z);

                const textMat = new THREE.MeshBasicMaterial({ 
                    color: 0xffffff,
                    side: THREE.FrontSide,
                    depthTest: true, 
                    polygonOffset: true,
                    polygonOffsetFactor: -2,
                    polygonOffsetUnits: -2
                });

                const mesh = new THREE.Mesh(textGeo, textMat);
                mesh.position.set(pos.x, pos.y, centeredZ);
                
                const horizontalOffset = side.clone().multiplyScalar(direction * offsetDist);
                mesh.position.add(horizontalOffset);

                const zAxis = side.clone().multiplyScalar(-direction); 
                const yAxis = up.clone();
                const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
                
                const matrix = new THREE.Matrix4();
                matrix.makeBasis(xAxis, yAxis, zAxis);
                mesh.quaternion.setFromRotationMatrix(matrix);

                layerObj.labelGroup.add(mesh);
            };

            createLabel(-1);
            createLabel(1);
        });
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
            layerObj.labelGroup.children.forEach(label => {
                if (label.geometry) label.geometry.dispose();
                if (label.material) label.material.dispose();
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