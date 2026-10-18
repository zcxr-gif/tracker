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
   the same shape stands in (an A330 is drawn as a 787, an A220 as an E190)
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
    const BASE = '/models/fleet/';

    // Family → file. `yaw` turns a model whose nose points the other way
    // (the FlightGear ones point down −X; the A380 arrived pointing +X).
    const MODELS = {
        a320: { file: 'a320.glb', label: 'Airbus A320' },
        b737: { file: '737.glb', label: 'Boeing 737' },
        b747: { file: '747.glb', label: 'Boeing 747' },
        b772: { file: '777-200er.glb', label: 'Boeing 777-200' },
        b773: { file: '777-300er.glb', label: 'Boeing 777-300' },
        b787: { file: '787.glb', label: 'Boeing 787' },
        a380: { file: 'a380.glb', label: 'Airbus A380', yaw: Math.PI },
        crj7: { file: 'crj700.glb', label: 'Bombardier CRJ700' },
        crj9: { file: 'crj900.glb', label: 'Bombardier CRJ900' },
        e175: { file: 'e175.glb', label: 'Embraer 175' },
        e190: { file: 'e190.glb', label: 'Embraer 190' },
        md11: { file: 'md11.glb', label: 'McDonnell Douglas MD-11' },
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
        [/MD11|MD-11/, 'md11', true],
        [/CRJ(9|10|X)|CRJ900|CRJ1000/, 'crj9', true],
        [/CRJ(1|2|7)|CRJ700|CRJ200|CRJ100/, 'crj7', true],
        [/E(RJ)?17[05]|EMBRAER17[05]|E1?7[05]E2|E75L|E75S|E170|E175/, 'e175', true],
        [/E(RJ)?19[05]|EMBRAER19[05]|E29[05]|E190|E195|EJET/, 'e190', true],
        // Close relatives of the same shape, where there is no model of the type.
        [/A3[34][0-9]|A33[0-9]|A34[0-9]|A35[0-9K]|A350|A330|A340|B76[0-9]|767|B75[0-9]|757/, 'b787', false],
        [/DC10|DC-10|MD10/, 'md11', false],
        [/A22[0-9]|BCS[13]|CS[13]00|A220/, 'e190', false],
        [/B71[0-9]|717|MD8[0-9]|MD90|DC9/, 'crj9', false],
        [/B70[0-9]|707|B72[0-9]|727/, 'b737', false],
    ];

    function match(name) {
        const s = String(name || '').toUpperCase().replace(/[\s\-_.·]+/g, '');
        if (!s) return null;
        for (const [re, id, exact] of RULES) {
            if (re.test(s)) return Object.assign({ id, exact, url: BASE + MODELS[id].file }, MODELS[id]);
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
            } catch (_) { /* offline, blocked: no model */ }
            const T = global.THREE;
            if (!T || !T.WebGLRenderer || !T.GLTFLoader) { threeP = null; return null; }
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
     * Models: loaded once, measured once, painted per colour.
     * ------------------------------------------------------------------- */
    const cache = new Map(); // url -> Promise<{ template, meshes, shape } | null>

    function pct(arr, p) {
        if (!arr.length) return 0;
        const a = arr.slice().sort((x, y) => x - y);
        return a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)))];
    }

    /**
     * Where the fuselage is. `u` runs nose (−L/2) to tail (+L/2) whichever
     * way the model was built; the fuselage is measured on a slice between
     * the nose and the wing, where nothing but fuselage reaches the middle.
     */
    function measure(T, meshes, flip) {
        const box = new T.Box3();
        meshes.forEach(({ pos }) => { for (let i = 0; i < pos.length; i += 3) box.expandByPoint(new T.Vector3(pos[i], pos[i + 1], pos[i + 2])); });
        const L = box.max.x - box.min.x;
        const ys = [];
        meshes.forEach(({ pos }) => {
            for (let i = 0; i < pos.length; i += 3) {
                const u = (flip ? -pos[i] : pos[i]);
                if (u > -0.38 * L && u < -0.22 * L && Math.abs(pos[i + 2]) < 0.06 * L) ys.push(pos[i + 1]);
            }
        });
        const top = ys.length ? pct(ys, 0.97) : box.max.y * 0.4;
        const bot = ys.length ? pct(ys, 0.06) : box.min.y * 0.4;
        return { L, top, bot, r: Math.max((top - bot) / 2, L * 0.02), cy: (top + bot) / 2, maxY: box.max.y, minY: box.min.y, flip };
    }

    function load(T, m) {
        if (cache.has(m.url)) return cache.get(m.url);
        const p = new Promise((resolve) => {
            new T.GLTFLoader().load(m.url, (g) => {
                const obj = g.scene;
                obj.updateMatrixWorld(true);
                const box = new T.Box3().setFromObject(obj);
                const c = box.getCenter(new T.Vector3());
                const size = box.getSize(new T.Vector3());
                obj.position.sub(c);
                obj.updateMatrixWorld(true);
                // Every vertex in the model's own (centred) frame, for the
                // livery — read once, kept.
                const meshes = [];
                const v = new T.Vector3();
                const nm = new T.Matrix3();
                obj.traverse((o) => {
                    if (!o.isMesh) return;
                    const a = o.geometry.getAttribute('position');
                    const na = o.geometry.getAttribute('normal');
                    nm.getNormalMatrix(o.matrixWorld);
                    const pos = new Float32Array(a.count * 3);
                    const nrm = new Float32Array(a.count * 3);
                    for (let i = 0; i < a.count; i++) {
                        v.set(a.getX(i), a.getY(i), a.getZ(i)).applyMatrix4(o.matrixWorld);
                        pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
                        // Quantised normals come back raw from r126; only
                        // their direction is wanted, so normalise.
                        if (na) {
                            v.set(na.getX(i), na.getY(i), na.getZ(i)).applyMatrix3(nm).normalize();
                            nrm[i * 3] = v.x; nrm[i * 3 + 1] = v.y; nrm[i * 3 + 2] = v.z;
                        }
                    }
                    meshes.push({ mesh: o, pos, nrm });
                });
                const shape = measure(T, meshes, m.yaw === Math.PI);
                shape.k = 1 / Math.max(size.x, size.y, size.z, 1e-6);
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
     * The livery: a colour for every vertex, from where it sits.
     * ------------------------------------------------------------------- */
    function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

    function paint(T, model, accent) {
        const S = model.shape, L = S.L, r = S.r;
        // Written as the airline wrote them (sRGB) and converted: the renderer
        // works in linear light, and a navy taken as linear comes out slate.
        const lin = (c) => new T.Color(c).convertSRGBToLinear();
        const white = lin(0xf4f3f0), wing = lin(0xdcdde0), gear = lin(0x55595f);
        const paintC = lin(isHex(accent) ? accent : '#E8553B');
        const dark = paintC.clone().lerp(lin(0x000000), 0.38);
        const lite = paintC.clone().lerp(lin(0xffffff), 0.12);
        const out = new T.Color();
        const engines = [];
        model.meshes.forEach(({ mesh, pos, nrm }) => {
            const n = pos.length / 3;
            const col = new Float32Array(n * 3);
            for (let i = 0; i < n; i++) {
                const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
                const nz = Math.abs(nrm[i * 3 + 2]), ny = nrm[i * 3 + 1];
                const u = S.flip ? -x : x;             // nose −, tail +
                const az = Math.abs(z);
                // The belly's top edge: low at the nose, sweeping up to meet
                // the fin. A cheatline in the darker shade runs along it.
                const cut = S.cy + r * (-0.62 + 0.95 * smooth(-0.45 * L, 0.42 * L, u));
                if (u > 0.2 * L && y > S.top + 0.22 * r) {
                    // The fin: the colour, deepening towards the tip.
                    out.copy(paintC).lerp(dark, smooth(S.top, S.maxY, y) * 0.55);
                } else if (az < 1.95 * r && y < S.bot - 0.25 * r) {
                    out.copy(gear);                    // the landing gear
                } else if (az >= 1.95 * r && az < 0.42 * L && Math.abs(u) < 0.32 * L && y < S.cy + 0.1 * r
                    && (nz > 0.35 || (ny < -0.6 && y < S.bot - 0.1 * r))) {
                    // The engines: under the wing, and facing sideways or down
                    // where the wing itself faces up or down.
                    out.copy(lite);
                    engines.push(u, y, az);
                } else if (az > 1.28 * r) {
                    out.copy(wing);                    // wings, tailplane
                } else if (y < cut) {
                    out.copy(paintC);                  // the belly
                } else if (y < cut + 0.13 * r) {
                    out.copy(dark);                    // the cheatline
                } else {
                    out.copy(white);                   // the crown
                }
                col[i * 3] = out.r; col[i * 3 + 1] = out.g; col[i * 3 + 2] = out.b;
            }
            mesh.geometry.setAttribute('color', new T.BufferAttribute(col, 3));
        });
        // Where the engines are, for the contrails in the hero.
        if (engines.length) {
            let su = 0, sy = 0, sz = 0;
            const k = engines.length / 3;
            for (let i = 0; i < engines.length; i += 3) { su += engines[i]; sy += engines[i + 1]; sz += engines[i + 2]; }
            S.engine = { u: su / k, y: sy / k, z: sz / k };
        }
        model.painted = accent;
    }

    /* ---------------------------------------------------------------------
     * A stage: one renderer, one scene, one aircraft.
     * ------------------------------------------------------------------- */
    function Stage(T, kind) {
        let renderer;
        try {
            renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: kind === 'hero' ? 'default' : 'low-power' });
        } catch (_) { return null; }
        renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
        renderer.outputEncoding = T.sRGBEncoding;
        // Filmic: white paint keeps its shape instead of blowing out.
        renderer.toneMapping = T.ACESFilmicToneMapping;
        renderer.toneMappingExposure = kind === 'hero' ? 1.05 : 1.1;
        const canvas = renderer.domElement;
        canvas.className = kind === 'hero' ? 'cc-hero3d' : 'cc-ac3d';
        canvas.setAttribute('aria-hidden', 'true');
        const scene = new T.Scene();
        scene.add(new T.HemisphereLight(0xffffff, 0x2a3140, kind === 'hero' ? 0.9 : 1.05));
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
        const material = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.12 });
        const st = { T, kind, renderer, canvas, scene, camera, rig, material, model: null, url: '', trails: null, frame: 0, last: 0, t: 0, drag: null, moved: false };
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
    function draw(st) { if (st.model && size(st)) st.renderer.render(st.scene, st.camera); }

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
        if (model.painted !== accent) paint(T, model, accent);
        if (st.url !== m.url || st.accent !== accent) {
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
