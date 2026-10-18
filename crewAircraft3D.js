/* ============================================================================
   crewAircraft3D.js — the aircraft itself, in 3D, in the airline's colours.

     CrewAircraft3D.match(name)               which model draws this aircraft
     CrewAircraft3D.attach(host, name, opts)  on a Console card, turning
     CrewAircraft3D.hero(host, name, opts)    in the Console's hero, flying
         opts.accent   the airline's colour, '#rrggbb' — the livery

   THE MODELS are open ones, listed with their authors and licences in
   models/fleet/CREDITS.md: FlightGear's aircraft (GPL) and one CC-BY model,
   converted to small glTF files by tools/aircraft-models/. Twelve files
   cover the types virtual airlines fly most.

   MATCHING takes whatever the airline typed — an ICAO code ("B38M", "A20N"),
   a name ("Boeing 737-800", "Embraer 175", "A321neo") — and finds its
   family. Where there is no model of the type itself, a close relative of
   the same shape stands in (an A350 is drawn as an A330, an A220 as an E190)
   and `exact` is false. A type with nothing close — a turboprop, a bizjet —
   gets no model.

   THE LIVERY is painted, not shipped. The models carry no textures, so the
   airline's colour is laid onto each one by where on the aeroplane a point
   is: a white crown, a belly in the airline's colour that sweeps up towards
   the tail with a darker cheatline along its edge, the fin and the engines
   in the colour too. The fuselage is found by measuring the model (its
   centreline and radius just behind the nose), so the same rules fit an
   E175 and an A380. Every airline gets a livery; none has to upload one.

   two stages, at most: the card one and the hero one, each its own WebGL
   renderer (two contexts are fine; dozens are not), sharing the loaded
   models. three.js is fetched the first time either is asked for. They stop
   drawing when off screen, and hold still for a reader who has asked for
   less motion.
   ========================================================================== */

(function (global) {
    'use strict';

    const THREE_URL = 'https://unpkg.com/three@0.126.0/build/three.min.js';
    const GLTF_URL = 'https://unpkg.com/three@0.126.0/examples/js/loaders/GLTFLoader.js';
    // The models are meshopt-compressed (tools/aircraft-models/pack.mjs):
    // about a quarter of the bytes for the same detail.
    const MESHOPT_URL = 'https://unpkg.com/three@0.126.0/examples/js/libs/meshopt_decoder.js';
    const BASE = '/models/fleet/';
    // Bumped whenever the model files change. They are cached for a day
    // (_headers), and a reader holding yesterday's file would otherwise keep
    // seeing it — the rougher one, as it happens, the first time this mattered.
    const MODEL_VERSION = '3';

    // Family → file. `yaw` turns a model built facing another way round to
    // the common frame, nose toward −X (the FlightGear ones already are; the
    // A380 arrived nose toward +Z).
    // `len` is the real aeroplane's length in metres: what tells the livery
    // how far apart to space the cabin windows on a model of any scale.
    const MODELS = {
        a320: { file: 'a320.glb', label: 'Airbus A320', len: 37.57 },
        b737: { file: '737.glb', label: 'Boeing 737', len: 33.4 },
        b747: { file: '747.glb', label: 'Boeing 747', len: 70.6 },
        b772: { file: '777-200er.glb', label: 'Boeing 777-200', len: 63.7 },
        b773: { file: '777-300er.glb', label: 'Boeing 777-300', len: 73.9 },
        b787: { file: '787.glb', label: 'Boeing 787', len: 56.7 },
        a330: { file: 'a330.glb', label: 'Airbus A330', len: 63.7 },
        a380: { file: 'a380.glb', label: 'Airbus A380', len: 72.7, yaw: -Math.PI / 2 },
        crj7: { file: 'crj700.glb', label: 'Bombardier CRJ700', len: 32.3 },
        crj9: { file: 'crj900.glb', label: 'Bombardier CRJ900', len: 36.2 },
        e175: { file: 'e175.glb', label: 'Embraer 175', len: 31.7 },
        e190: { file: 'e190.glb', label: 'Embraer 190', len: 36.2 },
        md11: { file: 'md11.glb', label: 'McDonnell Douglas MD-11', len: 61.6 },
    };

    // Tried in order against the name with spaces and dashes taken out and
    // upper-cased ("Boeing 737-800" → "BOEING737800"). The first rule that
    // matches wins, so the specific ones come first.
    const RULES = [
        [/A38[0-9]|A380/, 'a380', true],
        [/B77W|B773|B77X|B778|B779|7773|777300|777X|7778|7779/, 'b773', true],
        [/B77[0-9L]|B772|777/, 'b772', true],
        [/B78[0-9X]|787/, 'b787', true],
        [/B74[0-9A-Z]|747/, 'b747', true],
        [/B73[0-9A-Z]|B3[789X]M|B37M|737/, 'b737', true],
        [/A3(18|19|20|21)|A(19|20|21)N|A3(18|19|20|21)NEO/, 'a320', true],
        [/A33[0-9]|A330/, 'a330', true],
        [/MD11|MD-11/, 'md11', true],
        [/CRJ(9|10|X)|CRJ900|CRJ1000/, 'crj9', true],
        [/CRJ(1|2|7)|CRJ700|CRJ200|CRJ100/, 'crj7', true],
        [/E(RJ)?17[05]|EMBRAER17[05]|E1?7[05]E2|E75L|E75S|E170|E175/, 'e175', true],
        [/E(RJ)?19[05]|EMBRAER19[05]|E29[05]|E190|E195|EJET/, 'e190', true],
        // Close relatives of the same shape, where there is no model of the type.
        [/A34[0-9]|A35[0-9K]|A350|A340/, 'a330', false],
        [/B76[0-9]|767|B75[0-9]|757/, 'b787', false],
        [/DC10|DC-10|MD10/, 'md11', false],
        [/A22[0-9]|BCS[13]|CS[13]00|A220/, 'e190', false],
        [/B71[0-9]|717|MD8[0-9]|MD90|DC9/, 'crj9', false],
        [/B70[0-9]|707|B72[0-9]|727/, 'b737', false],
    ];

    function match(name) {
        const s = String(name || '').toUpperCase().replace(/[\s\-_.·]+/g, '');
        if (!s) return null;
        for (const [re, id, exact] of RULES) {
            if (re.test(s)) return Object.assign({ id, exact, url: BASE + MODELS[id].file + '?v=' + MODEL_VERSION }, MODELS[id]);
        }
        return null;
    }

    /* ---------------------------------------------------------------------
     * three.js, on demand. Resolves with THREE, or null if it could not be
     * had — the page simply goes without a model.
     * ------------------------------------------------------------------- */
    let threeP = null;
    function script(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src; s.async = true;
            s.onload = resolve; s.onerror = reject;
            document.head.appendChild(s);
        });
    }
    function three() {
        if (threeP) return threeP;
        threeP = (async () => {
            try {
                if (!global.THREE) await script(THREE_URL);
                if (global.THREE && !global.THREE.GLTFLoader) await script(GLTF_URL);
                if (!global.MeshoptDecoder) await script(MESHOPT_URL);
                if (global.MeshoptDecoder && global.MeshoptDecoder.ready) await global.MeshoptDecoder.ready;
            } catch (_) { /* offline, blocked: no model */ }
            const T = global.THREE;
            if (!T || !T.WebGLRenderer || !T.GLTFLoader || !global.MeshoptDecoder) { threeP = null; return null; }
            return T;
        })();
        return threeP;
    }

    // The hero's heading: nose toward the viewer's left shoulder, three-
    // quarters on, so the contrails run away into the distance behind it.
    const HERO_YAW = 0.2;
    const still = () => global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isHex = (c) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c || '');

    /* ---------------------------------------------------------------------
     * Models: loaded once, measured once (the livery is painted per pixel).
     * ------------------------------------------------------------------- */
    const cache = new Map(); // url -> Promise<{ template, meshes, shape } | null>

    function pct(arr, p) {
        if (!arr.length) return 0;
        const a = arr.slice().sort((x, y) => x - y);
        return a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)))];
    }

    /**
     * Where the fuselage is, in the common frame (x runs nose −L/2 to tail
     * +L/2). Measured on a slice between the nose and the wing, where nothing
     * but fuselage reaches the middle.
     */
    function measure(T, meshes) {
        const box = new T.Box3();
        meshes.forEach(({ pos }) => { for (let i = 0; i < pos.length; i += 3) box.expandByPoint(new T.Vector3(pos[i], pos[i + 1], pos[i + 2])); });
        const L = box.max.x - box.min.x;
        // The radius from the fuselage's WIDTH on that slice, and its crown
        // from the highest point: neither is moved by what hangs beneath it.
        // (A detailed model has thousands of vertices in gear bays and door
        // seams under the nose; a percentile of heights sinks into them.)
        const ys = [], zs = [];
        meshes.forEach(({ pos }) => {
            for (let i = 0; i < pos.length; i += 3) {
                const u = pos[i], az = Math.abs(pos[i + 2]);
                if (u > -0.38 * L && u < -0.22 * L && az < 0.075 * L) { ys.push(pos[i + 1]); zs.push(az); }
            }
        });
        if (!ys.length) {
            const r0 = L * 0.05;
            return { L, top: r0, bot: -r0, r: r0, cy: 0, maxY: box.max.y, minY: box.min.y };
        }
        const r = Math.max(pct(zs, 0.995), L * 0.02);
        const top = pct(ys, 0.995);
        const cy = top - r;
        return { L, top, bot: cy - r, r, cy, maxY: box.max.y, minY: box.min.y };
    }

    // A compressed attribute comes back from r126 as its raw integers; this
    // is what turns them back into the numbers they stand for. (The GPU does
    // it by itself; only code reading the values needs telling.)
    function unpack(a) {
        if (!a.normalized) return 1;
        const arr = a.isInterleavedBufferAttribute ? a.data.array : a.array;
        return arr instanceof Int8Array ? 1 / 127 : arr instanceof Uint8Array ? 1 / 255
            : arr instanceof Int16Array ? 1 / 32767 : arr instanceof Uint16Array ? 1 / 65535 : 1;
    }

    function load(T, m) {
        if (cache.has(m.url)) return cache.get(m.url);
        const p = new Promise((resolve) => {
            const loader = new T.GLTFLoader();
            loader.setMeshoptDecoder(global.MeshoptDecoder);
            loader.load(m.url, (g) => {
                const obj = g.scene;
                obj.updateMatrixWorld(true);
                // Every vertex in the model's own frame, read once and kept:
                // the bounds come from these (r126's own Box3 would read the
                // compressed integers as they are), and so does the livery.
                const meshes = [];
                const v = new T.Vector3();
                const nm = new T.Matrix3();
                const box = new T.Box3();
                obj.traverse((o) => {
                    if (!o.isMesh) return;
                    const a = o.geometry.getAttribute('position');
                    const na = o.geometry.getAttribute('normal');
                    const ka = unpack(a), kn = na ? unpack(na) : 1;
                    nm.getNormalMatrix(o.matrixWorld);
                    const pos = new Float32Array(a.count * 3);
                    const nrm = new Float32Array(a.count * 3);
                    for (let i = 0; i < a.count; i++) {
                        v.set(a.getX(i) * ka, a.getY(i) * ka, a.getZ(i) * ka).applyMatrix4(o.matrixWorld);
                        box.expandByPoint(v);
                        pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
                        if (na) {
                            v.set(na.getX(i) * kn, na.getY(i) * kn, na.getZ(i) * kn).applyMatrix3(nm).normalize();
                            nrm[i * 3] = v.x; nrm[i * 3 + 1] = v.y; nrm[i * 3 + 2] = v.z;
                        }
                    }
                    meshes.push({ mesh: o, pos, nrm });
                });
                const c = box.getCenter(new T.Vector3());
                const size = box.getSize(new T.Vector3());
                // Centred, then turned into the common frame (nose toward −X),
                // the same frame the livery shader paints in once the yaw is
                // applied to the model below.
                const yaw = new T.Matrix4().makeRotationY(m.yaw || 0);
                meshes.forEach(({ pos, nrm }) => {
                    for (let i = 0; i < pos.length; i += 3) {
                        v.set(pos[i] - c.x, pos[i + 1] - c.y, pos[i + 2] - c.z).applyMatrix4(yaw);
                        pos[i] = v.x; pos[i + 1] = v.y; pos[i + 2] = v.z;
                        v.set(nrm[i], nrm[i + 1], nrm[i + 2]).transformDirection(yaw);
                        nrm[i] = v.x; nrm[i + 1] = v.y; nrm[i + 2] = v.z;
                    }
                });
                obj.position.sub(c);
                const shape = measure(T, meshes);
                shape.k = 1 / Math.max(size.x, size.y, size.z, 1e-6);
                findEngines({ shape, meshes });
                const template = new T.Group();
                template.add(obj);
                template.scale.setScalar(shape.k);
                if (m.yaw) obj.rotation.y = m.yaw, obj.position.applyAxisAngle(new T.Vector3(0, 1, 0), m.yaw);
                resolve({ template, meshes, shape });
            }, undefined, () => resolve(null));
        });
        cache.set(m.url, p);
        return p;
    }

    /* ---------------------------------------------------------------------
     * Where the engines hang, for the contrails: the same test the livery
     * uses to paint them (outboard, under the wing, facing sideways or down
     * where the wing faces up or down), averaged.
     * ------------------------------------------------------------------- */
    function findEngines(model) {
        const S = model.shape, L = S.L, r = S.r;
        const hit = [];
        model.meshes.forEach(({ pos, nrm }) => {
            for (let i = 0; i < pos.length; i += 3) {
                const u = pos[i], y = pos[i + 1], az = Math.abs(pos[i + 2]);
                const nz = Math.abs(nrm[i + 2]), ny = nrm[i + 1];
                if (az >= 1.95 * r && az < 0.42 * L && Math.abs(u) < 0.32 * L && y < S.cy + 0.1 * r
                    && (nz > 0.35 || (ny < -0.6 && y < S.bot - 0.1 * r))) hit.push(u, y, az);
            }
        });
        if (hit.length < 30) return;
        // The nacelle as a cylinder: its axis (median height and span), its
        // radius, and how far it runs fore and aft. The livery paints
        // everything inside it, intake lip included, which a test on the
        // way a surface faces would miss.
        // One engine a side, or two (a 747, an A380). Split the hits into two
        // groups along the wing (1-D k-means); two engines when the groups sit
        // well apart — one engine cut in half never does, its halves are an
        // engine's width apart at most.
        const zsAll = [];
        for (let i = 0; i < hit.length; i += 3) zsAll.push(hit[i + 2]);
        let c1 = pct(zsAll, 0.25), c2 = pct(zsAll, 0.75);
        for (let it = 0; it < 12; it++) {
            let s1 = 0, n1 = 0, s2 = 0, n2 = 0;
            zsAll.forEach((z) => { if (Math.abs(z - c1) <= Math.abs(z - c2)) { s1 += z; n1++; } else { s2 += z; n2++; } });
            if (n1) c1 = s1 / n1;
            if (n2) c2 = s2 / n2;
        }
        const at = (c1 + c2) / 2;
        const groups = Math.abs(c2 - c1) > 1.4 * r ? [(z) => z < at, (z) => z >= at] : [() => true];
        const pods = groups.map((inGroup) => {
            const us = [], ys = [], zs = [];
            for (let i = 0; i < hit.length; i += 3) if (inGroup(hit[i + 2])) { us.push(hit[i]); ys.push(hit[i + 1]); zs.push(hit[i + 2]); }
            if (us.length < 15) return null;
            const ey = pct(ys, 0.5), ez = pct(zs, 0.5);
            const rad = [];
            for (let i = 0; i < ys.length; i++) rad.push(Math.hypot(ys[i] - ey, zs[i] - ez));
            // Capped: a nacelle is never wider than the fuselage it hangs
            // beside, and a stray hit on the wing root must not swell it until
            // it swallows the fuselage.
            return { u: pct(us, 0.5), y: ey, z: ez, r: Math.min(pct(rad, 0.85) * 1.15, 0.8 * r), u0: pct(us, 0.05), u1: pct(us, 0.95) };
        }).filter(Boolean);
        if (!pods.length) return;
        S.engine = pods[0];                 // the inner one: where the contrails start
        S.engine2 = pods[1] || null;
    }

    /* ---------------------------------------------------------------------
     * The livery, painted per pixel.
     *
     * Every point on the aeroplane is placed in the model's own frame (nose
     * toward −x, up +y) and coloured by where it sits: the fin in the
     * airline's colour deepening to the tip; the belly in it, sweeping up
     * from the nose to meet the fin, edged with a darker cheatline; a white
     * crown with a row of cabin windows at the real pitch; cockpit glass;
     * engines in a lighter shade; wings and tail planes in light grey; the
     * gear in dark grey. Edges are anti-aliased in screen space (fwidth), so
     * they stay sharp however coarse the mesh under them.
     * ------------------------------------------------------------------- */
    const LIVERY_VERT_HEAD = `
        uniform mat4 uToLocal;
        varying vec3 vLiv;
        varying vec3 vLivN;
    `;
    const LIVERY_VERT_BODY = `
        vLiv = (uToLocal * modelMatrix * vec4(transformed, 1.0)).xyz;
        vLivN = normalize(mat3(uToLocal) * mat3(modelMatrix) * objectNormal);
    `;
    const LIVERY_FRAG_HEAD = `
        uniform vec3 uWhite, uWing, uGear, uPaint, uDark, uLite, uGlass;
        uniform float uL, uTop, uBot, uR, uCy, uMaxY, uUnit;
        uniform vec4 uEng;     // inner nacelle axis: height, span, radius (0: none)
        uniform vec2 uEngU;    // inner nacelle from, to (fore and aft)
        uniform vec4 uEng2;    // outer nacelle, on a four-engined aeroplane
        uniform vec2 uEngU2;
        bool lvPod(vec4 e, vec2 eu, float u, float y, float az, float L) {
            return e.z > 0.0 && u > eu.x - 0.02 * L && u < eu.y + 0.02 * L && length(vec2(y - e.x, az - e.y)) < e.z;
        }
        varying vec3 vLiv;
        varying vec3 vLivN;
        float lvEdge(float e, float x, float w) { return smoothstep(e - w, e + w, x); }
        vec3 livery() {
            float L = uL, r = uR;
            float u = vLiv.x, y = vLiv.y, az = abs(vLiv.z);
            float ay = fwidth(y) * 1.1 + 1e-5;
            float aaz = fwidth(az) * 1.1 + 1e-5;
            // The fin.
            if (u > 0.2 * L && y > uTop + 0.22 * r) {
                return mix(uPaint, uDark, smoothstep(uTop, uMaxY, y) * 0.55);
            }
            // The gear.
            if (az < 1.95 * r && y < uBot - 0.25 * r) return uGear;
            // The engines: inside the nacelle's cylinder, either side.
            if (az > 1.3 * r && (lvPod(uEng, uEngU, u, y, az, L) || lvPod(uEng2, uEngU2, u, y, az, L))) return uLite;
            // Wings and tail planes, softly edged against the fuselage.
            float wing = lvEdge(1.28 * r, az, aaz);
            // The fuselage: belly, cheatline, crown.
            float cut = uCy + r * (-0.62 + 0.95 * smoothstep(-0.45 * L, 0.42 * L, u));
            vec3 c = uWhite;
            c = mix(c, uDark, lvEdge(cut, y, ay) * (1.0 - lvEdge(cut + 0.13 * r, y, ay)));
            c = mix(c, uPaint, 1.0 - lvEdge(cut, y, ay));
            // Cabin windows: a ring at window height meets the skin only on
            // the sides, so this draws a row each side and nothing on top.
            float pitch = 0.53 * uUnit;
            float f = fract(u / pitch);
            float fw = fwidth(u / pitch) * 1.2 + 1e-4;
            float pane = smoothstep(0.30 - fw, 0.30 + fw, f) * (1.0 - smoothstep(0.66 - fw, 0.66 + fw, f));
            float row = 1.0 - lvEdge(0.07 * r, abs(y - (uCy + 0.27 * r)), ay);
            float cabin = step(-0.39 * L, u) * step(u, 0.31 * L);
            c = mix(c, uGlass, pane * row * cabin);
            // Cockpit glass, a band across the nose.
            float ck = step(-0.475 * L, u) * step(u, -0.44 * L) * (1.0 - lvEdge(0.085 * r, abs(y - (uCy + 0.36 * r)), ay));
            c = mix(c, uGlass, ck);
            return mix(c, uWing, wing);
        }
    `;

    function liveryMaterial(T, kind) {
        const mat = new T.MeshPhysicalMaterial({
            color: 0xffffff, roughness: 0.34, metalness: 0.06,
            clearcoat: 0.65, clearcoatRoughness: 0.22, envMapIntensity: kind === 'hero' ? 0.85 : 0.7,
        });
        const u = {
            uToLocal: { value: new T.Matrix4() },
            uWhite: { value: new T.Color() }, uWing: { value: new T.Color() }, uGear: { value: new T.Color() },
            uPaint: { value: new T.Color() }, uDark: { value: new T.Color() }, uLite: { value: new T.Color() },
            uGlass: { value: new T.Color() },
            uEng: { value: new T.Vector4() }, uEngU: { value: new T.Vector2() },
            uEng2: { value: new T.Vector4() }, uEngU2: { value: new T.Vector2() },
            uL: { value: 1 }, uTop: { value: 0 }, uBot: { value: 0 }, uR: { value: 1 }, uCy: { value: 0 }, uMaxY: { value: 1 }, uUnit: { value: 1 },
        };
        mat.extensions = { derivatives: true };
        mat.onBeforeCompile = (sh) => {
            Object.assign(sh.uniforms, u);
            sh.vertexShader = LIVERY_VERT_HEAD + sh.vertexShader
                .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + LIVERY_VERT_BODY);
            sh.fragmentShader = LIVERY_FRAG_HEAD + sh.fragmentShader
                .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb = livery();');
        };
        return { mat, u };
    }

    // Colours are written as the airline wrote them (sRGB) and converted: the
    // renderer works in linear light, and a navy taken as linear comes out slate.
    function setLivery(T, u, shape, unit, accent) {
        const lin = (c) => new T.Color(c).convertSRGBToLinear();
        const paintC = lin(isHex(accent) ? accent : '#E8553B');
        u.uWhite.value.copy(lin(0xf5f4f1));
        u.uWing.value.copy(lin(0xd9dade));
        u.uGear.value.copy(lin(0x3a3d42));
        u.uGlass.value.copy(lin(0x141922));
        u.uPaint.value.copy(paintC);
        u.uDark.value.copy(paintC.clone().lerp(lin(0x000000), 0.4));
        // The engines in the colour itself: a lighter shade, under the gloss
        // of the sky, read as unpainted metal on a dark livery.
        u.uLite.value.copy(paintC.clone().lerp(lin(0xffffff), 0.04));
        u.uL.value = shape.L; u.uTop.value = shape.top; u.uBot.value = shape.bot;
        u.uR.value = shape.r; u.uCy.value = shape.cy; u.uMaxY.value = shape.maxY; u.uUnit.value = unit;
        const e = shape.engine;
        u.uEng.value.set(e ? e.y : 0, e ? e.z : 0, e ? e.r : 0, 0);
        u.uEngU.value.set(e ? e.u0 : 0, e ? e.u1 : 0);
        const e2 = shape.engine2;
        u.uEng2.value.set(e2 ? e2.y : 0, e2 ? e2.z : 0, e2 ? e2.r : 0, 0);
        u.uEngU2.value.set(e2 ? e2.u0 : 0, e2 ? e2.u1 : 0);
    }

    // A soft sky for the paint to reflect: bright above, warm at the horizon,
    // dark below — what makes a white fuselage read as gloss, not plaster.
    function skyEnvironment(T, renderer) {
        try {
            const scene = new T.Scene();
            const geo = new T.SphereGeometry(10, 32, 16);
            const col = [];
            const top = new T.Color(0xcfdcf2), mid = new T.Color(0xffd7b0), low = new T.Color(0x1b1f27);
            const p = geo.getAttribute('position');
            for (let i = 0; i < p.count; i++) {
                const h = p.getY(i) / 10;
                const c = h > 0 ? mid.clone().lerp(top, Math.min(1, h * 1.6)) : mid.clone().lerp(low, Math.min(1, -h * 3));
                col.push(c.r, c.g, c.b);
            }
            geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));
            scene.add(new T.Mesh(geo, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide })));
            const pm = new T.PMREMGenerator(renderer);
            const env = pm.fromScene(scene, 0.03).texture;
            pm.dispose();
            return env;
        } catch (_) { return null; }
    }

    /* ---------------------------------------------------------------------
     * A stage: one renderer, one scene, one aircraft.
     * ------------------------------------------------------------------- */
    function Stage(T, kind) {
        let renderer;
        try {
            renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: kind === 'hero' ? 'default' : 'low-power' });
        } catch (_) { return null; }
        // The hero is the page's centrepiece: it gets a little more of a
        // high-density screen than the card does.
        renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, kind === 'hero' ? 2.5 : 2));
        renderer.outputEncoding = T.sRGBEncoding;
        // Filmic: white paint keeps its shape instead of blowing out.
        renderer.toneMapping = T.ACESFilmicToneMapping;
        renderer.toneMappingExposure = kind === 'hero' ? 1.05 : 1.1;
        const canvas = renderer.domElement;
        canvas.className = kind === 'hero' ? 'cc-hero3d' : 'cc-ac3d';
        canvas.setAttribute('aria-hidden', 'true');
        const scene = new T.Scene();
        scene.environment = skyEnvironment(T, renderer);
        scene.add(new T.HemisphereLight(0xffffff, 0x2a3140, kind === 'hero' ? 0.7 : 0.85));
        const key = new T.DirectionalLight(0xfff4e6, kind === 'hero' ? 1.5 : 1.25);
        key.position.set(-2, 3, 2.5);
        scene.add(key);
        const rim = new T.DirectionalLight(0xffffff, kind === 'hero' ? 0.9 : 0.45);
        rim.position.set(2.5, 1.2, -3);
        scene.add(rim);
        const camera = new T.PerspectiveCamera(kind === 'hero' ? 26 : 28, 1.6, 0.01, 30);
        // The hero looks up at it from a little below and ahead, close: the
        // angle of a photograph taken from the wing of a chase plane.
        if (kind === 'hero') { camera.position.set(-0.92, 0.0, 1.18); camera.lookAt(0.1, 0.035, 0); }
        else { camera.position.set(-1.25, 0.62, 1.55); camera.lookAt(0, -0.02, 0); }
        const rig = new T.Group();                     // turns (card) or flies (hero)
        scene.add(rig);
        const { mat: material, u: liveryU } = liveryMaterial(T, kind);
        const st = { T, kind, renderer, canvas, scene, camera, rig, material, liveryU, model: null, url: '', trails: null, frame: 0, last: 0, t: 0, drag: null, moved: false };
        if (kind === 'card') {
            rig.rotation.y = -0.5;
            // Drag to turn it. A drag is not a press: the card under it does
            // not move on to the next one when the reader lets go.
            canvas.addEventListener('pointerdown', (e) => { st.drag = { x: e.clientX, r: rig.rotation.y }; st.moved = false; });
            global.addEventListener('pointermove', (e) => {
                if (!st.drag) return;
                const dx = e.clientX - st.drag.x;
                if (Math.abs(dx) > 4) st.moved = true;
                rig.rotation.y = st.drag.r + dx * 0.012;
                draw(st);
            });
            global.addEventListener('pointerup', () => { st.drag = null; });
            canvas.addEventListener('click', (e) => { if (st.moved) { e.stopPropagation(); e.preventDefault(); st.moved = false; } }, true);
        }
        document.addEventListener('visibilitychange', () => loop(st));
        return st;
    }

    function size(st) {
        const c = st.canvas;
        const w = c.clientWidth, h = c.clientHeight;
        if (!w || !h) return false;
        if (c.width !== Math.round(w * st.renderer.getPixelRatio())) {
            st.renderer.setSize(w, h, false);
            st.camera.aspect = w / h;
            st.camera.updateProjectionMatrix();
        }
        return true;
    }
    const visible = (st) => st.canvas.isConnected && !document.hidden
        && document.documentElement.getAttribute('data-skin') === 'console';
    function draw(st) {
        if (!st.model || !size(st)) return;
        // The livery is painted in the model's own frame: hand the shader
        // the way back to it from wherever the rig has flown it.
        st.scene.updateMatrixWorld();
        st.liveryU.uToLocal.value.copy(st.model.matrixWorld).invert();
        st.renderer.render(st.scene, st.camera);
    }

    // Contrails: two thin trails from behind the engines, fading out.
    function trails(st) {
        const T = st.T;
        if (st.trails) { st.rig.remove(st.trails); st.trails = null; }
        const S = st.shape;
        if (!S || !S.engine) return;
        const k = S.k;
        const cvs = document.createElement('canvas');
        cvs.width = 4; cvs.height = 256;
        const cx = cvs.getContext('2d');
        const grad = cx.createLinearGradient(0, 256, 0, 0);    // v=0 at the engine end
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(0.06, 'rgba(255,255,255,0.42)');
        grad.addColorStop(0.35, 'rgba(255,255,255,0.18)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        cx.fillStyle = grad; cx.fillRect(0, 0, 4, 256);
        const mat = new T.MeshBasicMaterial({ map: new T.CanvasTexture(cvs), transparent: true, depthWrite: false });
        const len = 2.2, rad = 0.0045;
        const g = new T.Group();
        [-1, 1].forEach((side) => {
            const m = new T.Mesh(new T.CylinderGeometry(rad, rad * 2.4, len, 10, 1, true), mat);
            m.rotation.z = Math.PI / 2;                          // along the aeroplane, aft is +x
            // Starting a little behind the exhaust. Every model sits nose
            // toward −x in the rig (the yaw saw to the odd one out).
            m.position.set((S.engine.u + 0.22 * S.L) * k + len / 2, (S.engine.y - 0.05 * S.r) * k, side * S.engine.z * k);
            g.add(m);
        });
        st.trails = g;
        st.rig.add(g);
    }

    function loop(st) {
        cancelAnimationFrame(st.frame);
        if (!visible(st) || !st.model) return;
        st.frame = requestAnimationFrame((now) => {
            const dt = st.last ? Math.min(0.05, (now - st.last) / 1000) : 0;
            st.last = now;
            if (!still()) {
                st.t += dt;
                if (st.kind === 'card') { if (!st.drag) st.rig.rotation.y += dt * 0.32; }
                else {
                    // Cruising: a slow bank and settle, a breath of pitch, the
                    // nose wandering a few degrees — never a loop-the-loop.
                    const t = st.t;
                    st.rig.rotation.set(Math.sin(t * 0.45) * 0.06, HERO_YAW + Math.sin(t * 0.21) * 0.07, Math.sin(t * 0.33) * 0.025);
                    st.rig.position.y = Math.sin(t * 0.6) * 0.012;
                }
            }
            draw(st);
            loop(st);
        });
    }

    const stages = {};
    async function show(kind, host, name, opts) {
        const m = match(name);
        if (!host || !m) return false;
        const T = await three();
        if (!T || !host.isConnected) return false;
        const st = stages[kind] || (stages[kind] = Stage(T, kind));
        if (!st) return false;
        const model = await load(T, m);
        if (!model || !host.isConnected) return false;
        const accent = (opts && opts.accent) || '';
        if (st.url !== m.url || st.accent !== accent) {
            setLivery(T, st.liveryU, model.shape, model.shape.L / (m.len || model.shape.L), accent);
            if (st.model) st.rig.remove(st.model);
            const obj = model.template.clone();
            obj.traverse((o) => { if (o.isMesh) o.material = st.material; });
            st.model = obj;
            st.shape = model.shape;
            st.url = m.url;
            st.accent = accent;
            st.rig.add(obj);
            if (kind === 'hero') { st.rig.rotation.set(0, HERO_YAW, 0); trails(st); }
        }
        st.canvas.title = m.exact ? m.label : m.label + ' (a close relative — no model of this type yet)';
        host.appendChild(st.canvas);
        st.last = 0;
        draw(st);
        loop(st);
        return true;
    }

    global.CrewAircraft3D = {
        match,
        attach: (host, name, opts) => show('card', host, name, opts),
        hero: (host, name, opts) => show('hero', host, name, opts),
        models: MODELS,
    };
})(window);
