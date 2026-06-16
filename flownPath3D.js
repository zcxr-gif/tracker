/**
 * flownPath3D.js
 * Handles the rendering of 3D flight trails, vertical curtains, and 3D path-aligned labels.
 *
 * Works in both Mapbox projections:
 *   - 'mercator' (flat): geometry is built in Mercator world units.
 *   - 'globe':           geometry is built in the globe's ECEF coordinate space and
 *                        rendered with the map's globe camera matrix, so the trail
 *                        follows the curvature of the planet and extrudes radially.
 */

export const FlownPath3D = {
    flightObjects: {},
    font: null,

    // One WebGLRenderer is shared across every path layer. They all draw into the
    // same map canvas / GL context, so creating one per flight just leaked GPU state.
    _sharedRenderer: null,
    _sharedRendererGl: null,

    // Performance Constants
    MAX_POINTS: 5000,
    SAMPLES_PER_POINT: 8,
    RADIAL_SEGMENTS: 6,
    BASE_THICKNESS: 0.0000035,

    // --- Globe (ECEF) constants, matched to Mapbox GL JS internals ---
    // Mapbox places the world on a sphere of radius EXTENT / (2*PI) in ECEF units.
    // A Mercator world-unit therefore maps to EXTENT (8192) ECEF units, which is the
    // scale factor used to convert Mercator-tuned sizes (thickness, label size) to globe.
    EXTENT: 8192,
    GLOBE_RADIUS: 8192 / (2 * Math.PI),
    EARTH_RADIUS_M: 6371008.8,
    DEG2RAD: Math.PI / 180,

    // Altitude Color Config (Feet)
    ALTITUDE_STOPS: [
        { alt: 0, color: new window.THREE.Color(0xf97316) },
        { alt: 10000, color: new window.THREE.Color(0xfacc15) },
        { alt: 25000, color: new window.THREE.Color(0x38bdf8) },
        { alt: 40000, color: new window.THREE.Color(0x818cf8) }
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
            loader.load('https://cdn.jsdelivr.net/npm/three@0.145.0/examples/fonts/helvetiker_regular.typeface.json', (response) => {
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

    // --- Projection helpers -------------------------------------------------

    /** True only when the globe projection is active AND its camera matrix is exposed. */
    _isGlobe(map) {
        try {
            if (!map.getProjection || map.getProjection().name !== 'globe') return false;
            const gm = map.transform && map.transform.globeMatrix;
            return !!gm && gm.length === 16;
        } catch (e) {
            return false;
        }
    },

    /** Pixel-size scale: Mercator sizes are multiplied by EXTENT to match globe ECEF units. */
    _worldScale(isGlobe) {
        return isGlobe ? this.EXTENT : 1;
    },

    /** Project a lng/lat/altitude into the active world space (Mercator or ECEF globe). */
    _projectPoint(lng, lat, altMeters, isGlobe) {
        const THREE = window.THREE;
        if (isGlobe) {
            const R = this.GLOBE_RADIUS * (1 + (altMeters || 0) / this.EARTH_RADIUS_M);
            const latR = lat * this.DEG2RAD;
            const lngR = lng * this.DEG2RAD;
            const cosLat = Math.cos(latR);
            // Axis convention matches Mapbox latLngToECEF so transform.globeMatrix applies.
            return new THREE.Vector3(
                R * cosLat * Math.sin(lngR),
                -R * Math.sin(latR),
                R * cosLat * Math.cos(lngR)
            );
        }
        const coord = window.mapboxgl.MercatorCoordinate.fromLngLat([lng, lat], altMeters || 0);
        return new THREE.Vector3(coord.x, coord.y, coord.z);
    },

    /** The point on the surface directly below a path point, for the curtain base. */
    _groundPoint(p, isGlobe) {
        const THREE = window.THREE;
        if (isGlobe) {
            return p.clone().normalize().multiplyScalar(this.GLOBE_RADIUS);
        }
        return new THREE.Vector3(p.x, p.y, 0);
    },

    /** Up (radial) direction at a path point: radial on the globe, +Z on flat map. */
    _upAt(p, isGlobe) {
        const THREE = window.THREE;
        return isGlobe ? p.clone().normalize() : new THREE.Vector3(0, 0, 1);
    },

    /** Height of the curtain at a path point in the active world units. */
    _curtainHeight(p, isGlobe) {
        return isGlobe ? (p.length() - this.GLOBE_RADIUS) : p.z;
    },

    _getRenderer(map, gl) {
        const THREE = window.THREE;
        if (this._sharedRenderer && this._sharedRendererGl === gl) {
            return this._sharedRenderer;
        }
        this._sharedRenderer = new THREE.WebGLRenderer({
            canvas: map.getCanvas(),
            context: gl,
            antialias: true
        });
        this._sharedRenderer.autoClear = false;
        this._sharedRendererGl = gl;
        return this._sharedRenderer;
    },

    // -----------------------------------------------------------------------

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
            console.error("Failed to load 3D Font for labels", e);
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
                this.map = map;
                this.camera = new THREE.Camera();
                this.scene = new THREE.Scene();

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

                this.labelGroup = new THREE.Group();
                this.scene.add(this.labelGroup);

                FlownPath3D.flightObjects[flightId] = this;

                // Shared renderer across all path layers (one GL context).
                this.renderer = FlownPath3D._getRenderer(map, gl);

                FlownPath3D._updateGeometry(map, flightId, trailData);
            },
            render: function (gl, matrix) {
                // On the globe, the trail geometry lives in ECEF space and must be
                // rendered with the globe camera matrix, not the (always-Mercator)
                // matrix Mapbox passes to custom layers.
                let m;
                if (this.isGlobe && this.map && this.map.transform && this.map.transform.globeMatrix) {
                    m = new THREE.Matrix4().fromArray(this.map.transform.globeMatrix);
                } else {
                    m = new THREE.Matrix4().fromArray(matrix);
                }
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

        const isGlobe = this._isGlobe(map);
        layerObj.isGlobe = isGlobe;
        const worldScale = this._worldScale(isGlobe);
        const thickness = this.BASE_THICKNESS * worldScale;

        const points = [];
        const rawAltitudes = [];

        trailData.forEach((p) => {
            const alt = p.altitude || p.alt || 0;
            const altMeters = alt * 0.3048;
            const lng = p.longitude || p.lon;
            const lat = p.latitude || p.lat;
            points.push(this._projectPoint(lng, lat, altMeters, isGlobe));
            rawAltitudes.push(alt);
        });

        const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
        const tubularSegments = Math.min((points.length - 1) * this.SAMPLES_PER_POINT, this.MAX_POINTS - 1);

        const tempTube = new THREE.TubeGeometry(curve, tubularSegments, thickness, this.RADIAL_SEGMENTS, false);

        const posAttr = layerObj.geometry.attributes.position;
        const colorAttr = layerObj.geometry.attributes.color;
        const tempPos = tempTube.attributes.position;
        // Never write past the pre-allocated buffer (silent corruption otherwise).
        const maxTubeVerts = posAttr.count;
        const tubeVertCount = Math.min(tempPos.count, maxTubeVerts);

        for (let i = 0; i < tubeVertCount; i++) {
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

        // Clamp the index buffer to the vertices we actually wrote.
        const tubeIndexArr = tempTube.index.array;
        const maxTubeIndex = (() => {
            let count = tubeIndexArr.length;
            for (let k = 0; k < tubeIndexArr.length; k++) {
                if (tubeIndexArr[k] >= tubeVertCount) { count = k - (k % 3); break; }
            }
            return count;
        })();

        layerObj.geometry.setIndex(tempTube.index);
        posAttr.needsUpdate = true;
        colorAttr.needsUpdate = true;
        layerObj.geometry.setDrawRange(0, maxTubeIndex);

        const curtainPosAttr = layerObj.curtainGeometry.attributes.position;
        const curtainColorAttr = layerObj.curtainGeometry.attributes.color;
        // Two curtain vertices per segment point; cap segments to the buffer.
        const maxCurtainSegments = Math.floor(curtainPosAttr.count / 2) - 1;
        const curtainSegments = Math.min(tubularSegments, maxCurtainSegments);
        const curvePoints = curve.getPoints(curtainSegments);
        const curtainIndices = [];

        for (let i = 0; i <= curtainSegments; i++) {
            const p = curvePoints[i];
            const ground = this._groundPoint(p, isGlobe);
            const idx = i * 2;
            const floatIdx = (i / curtainSegments) * (rawAltitudes.length - 1);
            const alt = rawAltitudes[Math.round(floatIdx)];
            const color = this._getColorForAlt(alt);

            curtainPosAttr.setXYZ(idx, p.x, p.y, p.z);
            curtainPosAttr.setXYZ(idx + 1, ground.x, ground.y, ground.z);
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

        this._updateLabels(layerObj, curve, trailData, isGlobe, worldScale);

        tempTube.dispose();
    },

    /**
     * Renders labels that adjust their size based on the vertical space (curtain height).
     */
    _updateLabels(layerObj, curve, trailData, isGlobe, worldScale) {
        const THREE = window.THREE;
        if (!this.font) return;

        // Clear existing labels
        while (layerObj.labelGroup.children.length > 0) {
            const child = layerObj.labelGroup.children[0];
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
            layerObj.labelGroup.remove(child);
        }

        // Labels at 35% and 70% of the path
        const labelIntervals = [0.35, 0.70];
        const offsetDist = 0.000004 * worldScale;

        labelIntervals.forEach(t => {
            const pos = curve.getPointAt(t);
            const tangent = curve.getTangentAt(t).normalize();
            const rawIdx = Math.floor(t * (trailData.length - 1));
            const point = trailData[rawIdx];
            const alt = point.altitude || point.alt || 0;

            const lines = [`${Math.round(alt).toLocaleString()} FT`];

            // Available vertical space is the curtain height in world units.
            const curtainHeight = this._curtainHeight(pos, isGlobe);
            const maxAllowedHeight = curtainHeight * 0.75; // Leave 25% padding

            // Standard size for high altitudes, scaled into the active world units.
            const baseSize = 0.000040 * worldScale;

            const estimatedTotalHeight = lines.length * (baseSize * 1.3);

            const scaleFactor = estimatedTotalHeight > maxAllowedHeight
                ? maxAllowedHeight / estimatedTotalHeight
                : 1;

            const labelSize = baseSize * scaleFactor;
            const lineHeight = labelSize * 1.3;

            // Up is radial on the globe, +Z on the flat map.
            const up = this._upAt(pos, isGlobe);
            const side = new THREE.Vector3().crossVectors(tangent, up).normalize();

            // Anchor label in the middle of the curtain, measured from the surface.
            const surface = this._groundPoint(pos, isGlobe);
            const center = surface.clone().add(up.clone().multiplyScalar(curtainHeight / 2));

            const createLabelLine = (text, lineOffset, direction) => {
                const shapes = this.font.generateShapes(text, labelSize);
                const textGeo = new THREE.ShapeGeometry(shapes);

                textGeo.computeBoundingBox();
                const centerOffset = new THREE.Vector3();
                textGeo.boundingBox.getCenter(centerOffset).multiplyScalar(-1);
                textGeo.translate(centerOffset.x, centerOffset.y, centerOffset.z);

                const textMat = new THREE.MeshBasicMaterial({
                    color: 0xffffff,
                    side: THREE.FrontSide,
                    transparent: true,
                    opacity: 0.9,
                    depthTest: true,
                    depthWrite: true,
                    polygonOffset: true,
                    polygonOffsetFactor: -1,
                    polygonOffsetUnits: -1
                });

                const mesh = new THREE.Mesh(textGeo, textMat);
                // Centered in curtain, shifted by lineOffset along up, then off to the side.
                mesh.position.copy(center)
                    .add(up.clone().multiplyScalar(-lineOffset))
                    .add(side.clone().multiplyScalar(direction * offsetDist));

                const zAxis = side.clone().multiplyScalar(-direction);
                const yAxis = up.clone();
                const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();

                const matrix = new THREE.Matrix4();
                matrix.makeBasis(xAxis, yAxis, zAxis);
                mesh.quaternion.setFromRotationMatrix(matrix);

                layerObj.labelGroup.add(mesh);
            };

            lines.forEach((lineText, index) => {
                const verticalOffset = (index - (lines.length - 1) / 2) * lineHeight;
                createLabelLine(lineText, verticalOffset, -1); // Side A
                createLabelLine(lineText, verticalOffset, 1);  // Side B
            });
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
            if (layerObj.labelGroup) {
                layerObj.labelGroup.children.forEach(label => {
                    if (label.geometry) label.geometry.dispose();
                    if (label.material) label.material.dispose();
                });
            }
        }

        if (map && map.getLayer(layerId)) map.removeLayer(layerId);
        delete this.flightObjects[flightId];
    },

    clearAllPaths(map) {
        Object.keys(this.flightObjects).forEach(id => this.clearPath(map, id));
        // The shared renderer is tied to the map's GL context; drop it so a fresh
        // map (e.g. after sectorOpsMap.remove()) gets a clean renderer.
        if (this._sharedRenderer) {
            try { this._sharedRenderer.dispose(); } catch (e) { /* context already gone */ }
        }
        this._sharedRenderer = null;
        this._sharedRendererGl = null;
    }
};
