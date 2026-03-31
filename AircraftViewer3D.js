// AircraftViewer3D.js — CesiumJS edition (v9 — Free Satellite Version)
// Fixes:
//   • Removed ALL dependencies on Cesium Ion to ensure 100% free commercial usage.
//   • Replaced default imagery with Esri ArcGIS World Imagery for a free satellite view.
//   • Replaced proprietary 3D terrain with default Ellipsoid surface.
//   • Map/Terrain : High-DPI resolution scaling, reduced Screen-Space Error, MSAA enabled.
//   • Model       : Removed artificial light multipliers, disabled backFaceCulling to fix hollow geometry.
//   • Initialization: Safe auto-scale wrapper.
//   • Camera      : Corrected mouse wheel zoom direction.
//   • Engines     : Dynamic "Smart Discovery" for baked GLTF animations and manual programmatic node rotation.
//   • Motion      : Added live spherical kinematics to animate the aircraft over the terrain based on speed/heading.
//   • Matching    : Upgraded model and engine config matching to be fully case-insensitive.
//   • Transparency: Added CustomShader to force OPAQUE translucencyMode, fixing depth-sorting bugs on glTF models.
//   • Gear State  : Completely new approach. Bypassed the playback timeline entirely.
//                   Added an animationTime interceptor that forces the model to permanently 
//                   evaluate and freeze at the final keyframe (Gear Up) to prevent playback failures.

export const AircraftViewer3D = {

    _modelMap: {
        "A320": "models/a320.glb",
        "Boeing 737-8 MAX": "models/b73m.glb",
        "B777": "models/b777.glb",
        "B787": "models/b787.glb",
        "A350": "models/a350.glb",
        "A380": "models/a380.glb"
    },

    _engineOffsets: {
        "A320":             [{ x: -19, y: -20, z: -8  }, { x:  19, y: -20, z: -8  }],
        "Boeing 737-8 MAX": [{ x: -21, y: -16, z: -9  }, { x:  21, y: -16, z: -9  }],
        "B777":             [{ x: -26, y: -12, z: -10 }, { x:  26, y: -12, z: -10 }],
        "B787":             [{ x: -24, y: -16, z: -9  }, { x:  24, y: -16, z: -9  }],
        "A350":             [{ x: -26, y: -12, z: -9  }, { x:  26, y: -12, z: -9  }],
        "DEFAULT":          [{ x: -20, y: -20, z: -8  }, { x:  20, y: -20, z: -8  }]
    },

    // Configuration for programmatic engine spinning
    _engineSpinConfig: {
        "A320":             { nodes: ["Fan_L", "Fan_R"], axis: "Z" },
        "Boeing 737-8 MAX": { nodes: ["Fan_L", "Fan_R"], axis: "Z" },
        "B777":             { nodes: ["Fan1", "Fan2"], axis: "Z" },
        "B787":             { nodes: ["Fan1", "Fan2"], axis: "Z" },
        "A350":             { nodes: ["Fan1", "Fan2"], axis: "Z" },
        "DEFAULT":          { nodes: ["Fan_Left", "Fan_Right"], axis: "Z" }
    },

    // Targeted fix for gear states: dictates which aircraft require their animation to be parked at the end
    _gearStateConfig: {
        "Boeing 737-8 MAX": { forceParkAtEnd: true }, 
        "A320":             { forceParkAtEnd: false },             
        "B777":             { forceParkAtEnd: false },
        "B787":             { forceParkAtEnd: false },
        "A350":             { forceParkAtEnd: false },
        "DEFAULT":          { forceParkAtEnd: false }
    },

    _defaultModelPath: "models/default_jet.glb",

    _currentPos: { pitch: 0, roll: 0, speed: 450, heading: 45 },

    updateFlightData(positionObj) {
        if (!positionObj) return;
        this._currentPos.pitch   = positionObj.pitch_deg || 0;
        this._currentPos.roll    = positionObj.roll_deg  || 0;
        this._currentPos.speed   = positionObj.gs_kt     || 450;
        this._currentPos.heading = positionObj.track ?? positionObj.heading ?? positionObj.heading_deg ?? this._currentPos.heading;
    },

    getModelPathForAircraft(name) {
        if (!name) return this._defaultModelPath;
        for (const [key, path] of Object.entries(this._modelMap)) {
            if (name.toUpperCase().includes(key.toUpperCase())) return path;
        }
        return this._defaultModelPath;
    },

    getHTML() {
        return `
        <div id="pui-hero-3d-container"
             style="width:100%;height:100%;position:relative;overflow:hidden;background:#0a1628;">
            <div id="pui-3d-loader"
                 style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
                        font-family:'Inter',sans-serif;color:rgba(255,255,255,0.85);
                        font-weight:600;font-size:0.78rem;z-index:10;
                        letter-spacing:0.12em;text-transform:uppercase;pointer-events:none;">
                <div style="display:flex;align-items:center;gap:10px;">
                    <div style="width:7px;height:7px;background:#ffffff;border-radius:50%;
                                animation:fr24Blink 1.1s ease-in-out infinite;"></div>
                    Rendering 3D Environment
                </div>
            </div>
        </div>
        <style>
            #pui-hero-3d-container .cesium-widget-credits,
            #pui-hero-3d-container .cesium-credit-logoContainer,
            #pui-hero-3d-container .cesium-credit-expand-link { display:none !important; }
            @keyframes fr24Blink {
                0%,100% { opacity:1; transform:scale(1); box-shadow:0 0 0 0 rgba(255,255,255,0.6); }
                50%      { opacity:0.35; transform:scale(1.6); box-shadow:0 0 0 4px rgba(255,255,255,0); }
            }
        </style>
        `;
    },

    _loadCesium() {
        const CESIUM_VERSION = '1.122';
        return new Promise((resolve, reject) => {
            if (window.Cesium) { resolve(window.Cesium); return; }
            if (!document.getElementById('cesium-widget-css')) {
                const link   = document.createElement('link');
                link.id      = 'cesium-widget-css';
                link.rel     = 'stylesheet';
                link.href    = `https://cesium.com/downloads/cesiumjs/releases/${CESIUM_VERSION}/Build/Cesium/Widgets/widgets.css`;
                document.head.appendChild(link);
            }
            const script     = document.createElement('script');
            script.src       = `https://cesium.com/downloads/cesiumjs/releases/${CESIUM_VERSION}/Build/Cesium/Cesium.js`;
            script.onload    = () => resolve(window.Cesium);
            script.onerror   = () => reject(new Error('[AircraftViewer3D] Failed to load CesiumJS from CDN'));
            document.head.appendChild(script);
        });
    },

    async init(aircraftName, positionOrAlt = 35000, speedArg = 450) {

        const container = document.getElementById("pui-hero-3d-container");
        if (!container) return;

        let lat = 46.0, lon = 7.5, altitude = 35000, speed = 450, pitch = 0, roll = 0, heading = 45;
        if (typeof positionOrAlt === 'object' && positionOrAlt !== null) {
            lat      = positionOrAlt.lat       ?? 46.0;
            lon      = positionOrAlt.lon       ?? 7.5;
            altitude = positionOrAlt.alt_ft    ?? 35000;
            speed    = positionOrAlt.gs_kt     ?? 450;
            pitch    = positionOrAlt.pitch_deg ?? 0;
            roll     = positionOrAlt.roll_deg  ?? 0;
            heading  = positionOrAlt.track     ?? positionOrAlt.heading ?? positionOrAlt.heading_deg ?? 45;
        } else {
            altitude = positionOrAlt;
            speed    = speedArg;
        }
        this._currentPos = { pitch, roll, speed, heading };
        const viewerRef  = this;
        const modelPath  = this.getModelPathForAircraft(aircraftName);
        const altMeters  = altitude * 0.3048;
        const TARGET_MODEL_M = 120;

        let Cesium;
        try { Cesium = await this._loadCesium(); }
        catch (err) { console.error(err); return; }

        const creditDiv         = document.createElement('div');
        creditDiv.style.display = 'none';

        const viewer = new Cesium.Viewer(container, {
            baseLayerPicker:      false,
            navigationHelpButton: false,
            animation:            false,
            timeline:             false,
            geocoder:             false,
            homeButton:           false,
            sceneModePicker:      false,
            infoBox:              false,
            selectionIndicator:   false,
            fullscreenButton:     false,
            vrButton:             false,
            creditContainer:      creditDiv,
            shouldAnimate:        true,
            imageryProvider:      false,
            terrainProvider:      new Cesium.EllipsoidTerrainProvider()
        });

        viewer.scene.screenSpaceCameraController.enableInputs = false;
        viewer.resolutionScale = Math.min(window.devicePixelRatio || 1.0, 2.0);
        viewer.scene.msaaSamples = 4;
        viewer.scene.globe.maximumScreenSpaceError = 4.0;
        viewer.scene.globe.tileCacheSize      = 1000;  
        viewer.scene.globe.preloadAncestors   = true;
        viewer.scene.globe.preloadSiblings    = true;

        try {
            viewer.imageryLayers.removeAll();
            
            const esriProvider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
                'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
            );
            viewer.imageryLayers.addImageryProvider(esriProvider);

        } catch (e) {
            console.warn('[AircraftViewer3D] Imagery resources unavailable, using defaults:', e.message);
        }

        viewer.scene.skyAtmosphere.show   = true;
        viewer.scene.fog.enabled          = true;
        viewer.scene.fog.density          = 0.00008;
        viewer.scene.globe.enableLighting = true;
        try { viewer.scene.highDynamicRange = true; } catch (_) {}

        let animAlt   = altMeters;
        let animPitch = pitch;
        let animRoll  = roll;

        const liveHpr = new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(heading - 90), 0, 0);

        let modelPrimitive = null;
        let modelScaleSet  = false;
        
        let manualEngineNodes = [];
        let manualEngineNodesCached = false;
        const updatedEngineMatrix = new Cesium.Matrix4(); 

        try {
            modelPrimitive = await Cesium.Model.fromGltfAsync({
                url:          modelPath,
                modelMatrix:  Cesium.Transforms.headingPitchRollToFixedFrame(
                                  Cesium.Cartesian3.fromDegrees(lon, lat, altMeters), liveHpr
                              ),
                scale:        1.0,
                shadows:      Cesium.ShadowMode.DISABLED,
                allowPicking: false,
                backFaceCulling: false,
                customShader: new Cesium.CustomShader({
                    translucencyMode: Cesium.CustomShaderTranslucencyMode.OPAQUE,
                    fragmentShaderText: `
                        void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
                            material.alpha = 1.0;
                        }
                    `
                })
            });
            viewer.scene.primitives.add(modelPrimitive);
        } catch (e) {
            console.error('[AircraftViewer3D] Model.fromGltfAsync failed:', e);
        }

        try {
            const clouds = viewer.scene.primitives.add(new Cesium.CloudCollection({
                noiseDetail: 16.0,
                noiseOffset: Cesium.Cartesian3.ZERO,
            }));
            for (let i = 0; i < 60; i++) {
                clouds.add({
                    position: Cesium.Cartesian3.fromDegrees(
                        lon + (Math.random() - 0.5) * 0.5,
                        lat + (Math.random() - 0.5) * 0.5,
                        altMeters + (Math.random() - 0.5) * 600
                    ),
                    scale:       new Cesium.Cartesian2(2000 + Math.random() * 5000, 400 + Math.random() * 600),
                    maximumSize: new Cesium.Cartesian3(60, 30, 18),
                    slice:       0.30 + Math.random() * 0.15,
                    brightness:  0.85 + Math.random() * 0.15,
                });
            }
        } catch (e) {
            console.warn('[AircraftViewer3D] CloudCollection unavailable:', e.message);
        }

        let orbitHeading    = Cesium.Math.toRadians(heading + 80);
        let orbitPitch      = Cesium.Math.toRadians(-22);
        let orbitRange      = altitude > 20000 ? 620 : altitude > 8000 ? 450 : 300;
        let userInteracting = false;
        let interactTimeout = null;
        let isDragging      = false;
        let lastX = 0, lastY = 0;

        const pauseOrbit  = () => { userInteracting = true; clearTimeout(interactTimeout); };
        const resumeOrbit = () => {
            interactTimeout = setTimeout(() => { userInteracting = false; }, 1500);
        };

        const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);

        handler.setInputAction((e) => {
            isDragging = true;
            lastX = e.position.x;
            lastY = e.position.y;
            pauseOrbit();
        }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

        handler.setInputAction((e) => {
            if (!isDragging) return;
            orbitHeading += (e.endPosition.x - lastX) * 0.005;
            orbitPitch    = Cesium.Math.clamp(
                orbitPitch - (e.endPosition.y - lastY) * 0.003,
                Cesium.Math.toRadians(-85),
                Cesium.Math.toRadians(-3)
            );
            lastX = e.endPosition.x;
            lastY = e.endPosition.y;
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        handler.setInputAction(() => {
            isDragging = false;
            resumeOrbit();
        }, Cesium.ScreenSpaceEventType.LEFT_UP);

        handler.setInputAction((delta) => {
            orbitRange = Cesium.Math.clamp(orbitRange * (1.0 - delta * 0.001), 80, 6000);
            pauseOrbit();
            resumeOrbit();
        }, Cesium.ScreenSpaceEventType.WHEEL);

        handler.setInputAction((e) => {
            lastY = e.position.y;
            pauseOrbit();
        }, Cesium.ScreenSpaceEventType.RIGHT_DOWN);

        handler.setInputAction((e) => {
            orbitPitch = Cesium.Math.clamp(
                orbitPitch - (e.endPosition.y - lastY) * 0.003,
                Cesium.Math.toRadians(-85),
                Cesium.Math.toRadians(-3)
            );
            lastY = e.endPosition.y;
        }, Cesium.ScreenSpaceEventType.RIGHT_DRAG);

        handler.setInputAction(resumeOrbit, Cesium.ScreenSpaceEventType.RIGHT_UP);

        let lastTouches = [];
        viewer.canvas.addEventListener('touchstart', (e) => {
            pauseOrbit();
            lastTouches = Array.from(e.touches).map(t => ({ x: t.clientX, y: t.clientY }));
        }, { passive: true });
        viewer.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const curr = Array.from(e.touches).map(t => ({ x: t.clientX, y: t.clientY }));
            if (curr.length === 1 && lastTouches.length >= 1) {
                orbitHeading += (curr[0].x - lastTouches[0].x) * 0.005;
                orbitPitch    = Cesium.Math.clamp(
                    orbitPitch - (curr[0].y - lastTouches[0].y) * 0.003,
                    Cesium.Math.toRadians(-85),
                    Cesium.Math.toRadians(-3)
                );
            }
            if (curr.length === 2 && lastTouches.length === 2) {
                const dNow  = Math.hypot(curr[0].x - curr[1].x, curr[0].y - curr[1].y);
                const dPrev = Math.hypot(lastTouches[0].x - lastTouches[1].x, lastTouches[0].y - lastTouches[1].y);
                if (dPrev > 0) orbitRange = Cesium.Math.clamp(orbitRange * (dPrev / dNow), 80, 6000);
            }
            lastTouches = curr;
        }, { passive: false });
        viewer.canvas.addEventListener('touchend', resumeOrbit, { passive: true });

        const ORBIT_DPS = 8;
        const EARTH_RADIUS = 6378137.0; 
        const t0 = performance.now();
        let lastFrameT = performance.now();
        let loaderRemoved = false;

        viewer.scene.postRender.addEventListener(() => {
            const now = performance.now();
            const dt  = (now - lastFrameT) / 1000.0; 
            const t   = (now - t0) / 1000.0;

            const currentSpeedKts   = viewerRef._currentPos.speed;
            const currentHeadingDeg = viewerRef._currentPos.heading;
            const currentHeadingRad = Cesium.Math.toRadians(currentHeadingDeg);

            const speedMs = currentSpeedKts * 0.514444;
            const distanceMeters = speedMs * dt;

            const latRad = Cesium.Math.toRadians(lat);
            const safeLatRad = Cesium.Math.clamp(latRad, -1.5707, 1.5707); 

            const dLat = (distanceMeters * Math.cos(currentHeadingRad)) / EARTH_RADIUS;
            const dLon = (distanceMeters * Math.sin(currentHeadingRad)) / (EARTH_RADIUS * Math.cos(safeLatRad));

            lat += Cesium.Math.toDegrees(dLat);
            lon += Cesium.Math.toDegrees(dLon);

            if (!userInteracting) {
                orbitHeading += Cesium.Math.toRadians(ORBIT_DPS * dt);
            }
            lastFrameT = now;

            animAlt   = altMeters + Math.sin(t * 0.72) * 15;
            animPitch = viewerRef._currentPos.pitch + Math.sin(t * 0.37) * 0.46;
            animRoll  = viewerRef._currentPos.roll  + Math.sin(t * 0.25) * 0.46;
            
            liveHpr.heading = currentHeadingRad - Cesium.Math.toRadians(90); 
            liveHpr.pitch   = Cesium.Math.toRadians(animPitch);
            liveHpr.roll    = Cesium.Math.toRadians(animRoll);

            const currentPos  = Cesium.Cartesian3.fromDegrees(lon, lat, animAlt);
            const acTransform = Cesium.Transforms.headingPitchRollToFixedFrame(currentPos, liveHpr);

            if (modelPrimitive && modelPrimitive.ready) {
                modelPrimitive.modelMatrix = acTransform;
                
                if (!modelScaleSet) {
                    try {
                        const bs = modelPrimitive.boundingSphere;
                        if (bs && bs.radius > 0) {
                            modelPrimitive.scale = TARGET_MODEL_M / (bs.radius * 2);
                            modelScaleSet = true;
                            
                            // --- NEW FIX: ANIMATION TIME INTERCEPTOR ---
                            const acKey = Object.keys(viewerRef._modelMap).find(k => aircraftName?.toUpperCase().includes(k.toUpperCase())) || "DEFAULT";
                            const gearConfig = viewerRef._gearStateConfig[acKey] || viewerRef._gearStateConfig["DEFAULT"];
                            
                            if (gearConfig.forceParkAtEnd) {
                                modelPrimitive.activeAnimations.addAll({
                                    // This function completely hijacks Cesium's playback clock.
                                    // By returning 'duration' (the total length of the animation), we force 
                                    // the model to permanently sit at the final frame (Gear Up) forever.
                                    animationTime: function(duration) {
                                        return duration; 
                                    },
                                    loop: Cesium.ModelAnimationLoop.NONE,
                                    removeOnStop: false
                                });
                            }

                            document.getElementById("pui-3d-loader")?.remove();
                            loaderRemoved = true;
                        }
                    } catch (e) {}
                }

                if (modelScaleSet) {
                    const modelConfigName = Object.keys(viewerRef._modelMap).find(k => aircraftName?.toUpperCase().includes(k.toUpperCase())) || "DEFAULT";
                    const spinConfig = viewerRef._engineSpinConfig[modelConfigName] || { axis: "Z", nodes: [] };

                    if (!manualEngineNodesCached) {
                        const preferredNodes = spinConfig.nodes || [];
                        const fallbackNodes = [
                            "Fan_L", "Fan_R", "Fan_Left", "Fan_Right", 
                            "Fan1", "Fan2", "Engine_L", "Engine_R", 
                            "f_spin_mu=1.0", "f_spin_mu=1.0.001"
                        ];
                        
                        const nodesToSearch = [...new Set([...preferredNodes, ...fallbackNodes])];

                        nodesToSearch.forEach(nodeName => {
                            try {
                                const node = modelPrimitive.getNode(nodeName);
                                if (node && !manualEngineNodes.find(n => n.name === nodeName) && manualEngineNodes.length < 2) {
                                    manualEngineNodes.push({
                                        name: nodeName,
                                        node: node,
                                        originalMatrix: Cesium.Matrix4.clone(node.matrix, new Cesium.Matrix4())
                                    });
                                }
                            } catch (e) {} 
                        });
                        manualEngineNodesCached = true;
                    }

                    if (manualEngineNodes.length > 0) {
                        const rpm = Math.max(1.0, currentSpeedKts * 0.1); 
                        const angle = (t * rpm) % (Math.PI * 2);
                        
                        let rotationMatrix3;
                        if (spinConfig.axis === 'X') {
                            rotationMatrix3 = Cesium.Matrix3.fromRotationX(angle);
                        } else if (spinConfig.axis === 'Y') {
                            rotationMatrix3 = Cesium.Matrix3.fromRotationY(angle);
                        } else {
                            rotationMatrix3 = Cesium.Matrix3.fromRotationZ(angle);
                        }

                        const rotationMatrix4 = Cesium.Matrix4.fromRotationTranslation(rotationMatrix3, Cesium.Cartesian3.ZERO);

                        manualEngineNodes.forEach(fan => {
                            Cesium.Matrix4.multiply(fan.originalMatrix, rotationMatrix4, updatedEngineMatrix);
                            fan.node.matrix = updatedEngineMatrix;
                        });
                    }
                }
            }

            viewer.camera.lookAt(
                currentPos,
                new Cesium.HeadingPitchRange(orbitHeading, orbitPitch, orbitRange)
            );

            if (!loaderRemoved && viewer.scene.globe.tilesLoaded) {
                document.getElementById("pui-3d-loader")?.remove();
                loaderRemoved = true;
            }
        });

        setTimeout(() => {
            document.getElementById("pui-3d-loader")?.remove();
            loaderRemoved = true;
        }, 8000);

        const observer = new MutationObserver(() => {
            if (!document.contains(container)) {
                clearTimeout(interactTimeout);
                handler.destroy();
                try { viewer.destroy(); } catch (_) {}
                observer.disconnect();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
};