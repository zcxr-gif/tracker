/**
 * flownPath3D.js
 * Handles the rendering of 3D flight trails, vertical curtains, and 3D path-aligned labels.
 */

import { FontLoader } from 'https://cdn.jsdelivr.net/npm/three@0.145.0/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'https://cdn.jsdelivr.net/npm/three@0.145.0/examples/jsm/geometries/TextGeometry.js';

export const FlownPath3D = {
    flightObjects: {},
    font: null,
    
    // Performance Constants
    MAX_POINTS: 5000, 
    SAMPLES_PER_POINT: 8, 
    RADIAL_SEGMENTS: 6,   
    BASE_THICKNESS: 0.0000035,

    // Altitude Color Config (Feet)
    ALTITUDE_STOPS: [
        { alt: 0, color: new window.THREE.Color(0xf97316) },     
        { alt: 10000, color: new window.THREE.Color(0xfacc15) }, 
        { alt: 25000, color: new window.THREE.Color(0x38bdf8) }, 
        { alt: 40000, color: new window.THREE.Color(0x818cf8) }  
    ],

    async _loadFont() {
        if (this.font) return this.font;
        const loader = new FontLoader();
        // Loading a standard typeface font
        return new Promise((resolve) => {
            loader.load('https://cdn.jsdelivr.net/npm/three@0.145.0/examples/fonts/helvetiker_regular.typeface.json', (response) => {
                this.font = response;
                resolve(response);
            });
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

        // Ensure font is loaded for labels
        await this._loadFont();

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
                    opacity: 0.4,
                    side: THREE.DoubleSide
                });
                this.curtainMesh = new THREE.Mesh(this.curtainGeometry, this.curtainMaterial);
                this.curtainMesh.frustumCulled = false;
                this.scene.add(this.curtainMesh);

                // 3. Label Group
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
        
        // Update Tube Attributes (Thickness & Color)
        const posAttr = layerObj.geometry.attributes.position;
        const colorAttr = layerObj.geometry.attributes.color;
        const tempPos = tempTube.attributes.position;
        const tempNorm = tempTube.attributes.normal;

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

        // Update Curtain
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

        // 3D LABELS: Stick to path
        this._updateLabels(layerObj, curve, trailData);

        tempTube.dispose();
    },

    _updateLabels(layerObj, curve, trailData) {
        const THREE = window.THREE;
        // Clear existing labels
        while(layerObj.labelGroup.children.length > 0){ 
            const child = layerObj.labelGroup.children[0];
            child.geometry.dispose();
            child.material.dispose();
            layerObj.labelGroup.remove(child); 
        }

        if (!this.font) return;

        // Place a label every ~20% of the path
        const labelIntervals = [0.2, 0.5, 0.8]; 
        
        labelIntervals.forEach(t => {
            const pos = curve.getPointAt(t);
            const tangent = curve.getTangentAt(t).normalize();
            
            // Get local altitude for the text string
            const rawIdx = Math.floor(t * (trailData.length - 1));
            const alt = trailData[rawIdx].altitude || 0;
            const labelText = `${Math.round(alt).toLocaleString()} FT`;

            const textGeo = new TextGeometry(labelText, {
                font: this.font,
                size: 0.000008, // Adjust based on Mercator scale
                height: 0.000001,
                curveSegments: 4
            });
            
            const textMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
            const textMesh = new THREE.Mesh(textGeo, textMat);

            // Positioning: Offset slightly to the side of the path
            const up = new THREE.Vector3(0, 0, 1);
            const side = new THREE.Vector3().crossVectors(tangent, up).normalize();
            
            textMesh.position.copy(pos);
            textMesh.position.add(side.multiplyScalar(0.00001)); // Offset side

            // Orientation: Align with path tangent
            textMesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tangent);
            
            layerObj.labelGroup.add(textMesh);
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
                label.geometry.dispose();
                label.material.dispose();
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