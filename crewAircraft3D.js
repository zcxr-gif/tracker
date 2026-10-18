/* ============================================================================
   crewAircraft3D.js — the aircraft itself, in 3D, on the Console's cards.

     CrewAircraft3D.match(name)        which model draws this aircraft
     CrewAircraft3D.attach(host, name) draw it, turning, inside `host`

   THE MODELS are open ones, listed with their authors and licences in
   models/fleet/CREDITS.md: FlightGear's aircraft (GPL) and one CC-BY model,
   converted to small glTF files by tools/aircraft-models/. Twelve files
   cover the types virtual airlines fly most.

   MATCHING takes whatever the airline typed — an ICAO code ("B38M", "A20N"),
   a name ("Boeing 737-800", "Embraer 175", "A321neo") — and finds its
   family. Where there is no model of the type itself, a close relative of
   the same shape stands in (an A330 is drawn as a 787, an A220 as an E190)
   and `exact` is false. A type with nothing close — a turboprop, a bizjet —
   gets no model, and the card is drawn without one.

   ONE RENDERER for the whole page, moved into whichever card is face on.
   three.js is fetched the first time a card asks for it, never before; a
   page that never shows an aircraft card never downloads it. It turns slowly
   (not at all for a reader who has asked for less motion), can be dragged
   round, and stops drawing when it is not on screen.
   ========================================================================== */

(function (global) {
    'use strict';

    const THREE_URL = 'https://unpkg.com/three@0.126.0/build/three.min.js';
    const GLTF_URL = 'https://unpkg.com/three@0.126.0/examples/js/loaders/GLTFLoader.js';
    const BASE = '/models/fleet/';

    // Family → file. `yaw` turns a model whose nose points the other way.
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
     * had — the card simply goes without a model.
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

    const still = () => global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---------------------------------------------------------------------
     * The one renderer.
     * ------------------------------------------------------------------- */
    let R = null; // { T, renderer, scene, camera, spin, canvas }
    const cache = new Map(); // url -> Promise<Object3D|null>
    let current = null;      // { url, obj }
    let frame = 0, last = 0, drag = null, moved = false;

    function setup(T) {
        if (R) return R;
        let renderer;
        try {
            renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
        } catch (_) { return null; }  // no WebGL: no model
        renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
        renderer.outputEncoding = T.sRGBEncoding;
        const canvas = renderer.domElement;
        canvas.className = 'cc-ac3d';
        canvas.setAttribute('aria-hidden', 'true');
        const scene = new T.Scene();
        scene.add(new T.HemisphereLight(0xffffff, 0x3a3f4a, 1.05));
        const key = new T.DirectionalLight(0xffffff, 1.25);
        key.position.set(-2, 3, 2.5);
        scene.add(key);
        const rim = new T.DirectionalLight(0xffffff, 0.45);
        rim.position.set(2, 1, -3);
        scene.add(rim);
        const camera = new T.PerspectiveCamera(28, 1.6, 0.01, 20);
        camera.position.set(-1.25, 0.62, 1.55);
        camera.lookAt(0, -0.02, 0);
        const spin = new T.Group();
        spin.rotation.y = -0.5;
        scene.add(spin);
        // Every model in one plain finish, whatever it arrived painted in,
        // so a card never mixes a livery with a bare kit.
        const finish = new T.MeshStandardMaterial({ color: 0xf3f1ee, roughness: 0.48, metalness: 0.08 });
        R = { T, renderer, scene, camera, spin, canvas, finish };

        // Drag to turn it. A drag is not a press: the card under it does not
        // move on to the next one when the reader lets go.
        canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, r: spin.rotation.y }; moved = false; });
        global.addEventListener('pointermove', (e) => {
            if (!drag) return;
            const dx = e.clientX - drag.x;
            if (Math.abs(dx) > 4) moved = true;
            spin.rotation.y = drag.r + dx * 0.012;
            draw();
        });
        global.addEventListener('pointerup', () => { drag = null; });
        canvas.addEventListener('click', (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
        document.addEventListener('visibilitychange', loop);
        return R;
    }

    function load(url) {
        if (cache.has(url)) return cache.get(url);
        const p = new Promise((resolve) => {
            new R.T.GLTFLoader().load(url, (g) => {
                const T = R.T;
                const obj = g.scene;
                obj.traverse((o) => { if (o.isMesh) o.material = R.finish; });
                // Centred, longest side 1, sat on its wheels.
                obj.updateMatrixWorld(true);
                const box = new T.Box3().setFromObject(obj);
                const size = box.getSize(new T.Vector3());
                const c = box.getCenter(new T.Vector3());
                const k = 1 / Math.max(size.x, size.y, size.z, 1e-6);
                const holder = new T.Group();
                obj.position.sub(c);
                holder.add(obj);
                holder.scale.setScalar(k);
                resolve(holder);
            }, undefined, () => resolve(null));
        });
        cache.set(url, p);
        return p;
    }

    function size() {
        const c = R.canvas;
        const w = c.clientWidth, h = c.clientHeight;
        if (!w || !h) return false;
        const want = Math.round(w * R.renderer.getPixelRatio());
        if (c.width !== want) {
            R.renderer.setSize(w, h, false);
            R.camera.aspect = w / h;
            R.camera.updateProjectionMatrix();
        }
        return true;
    }

    function visible() {
        return R && R.canvas.isConnected && !document.hidden
            && document.documentElement.getAttribute('data-skin') === 'console';
    }

    function draw() { if (R && current && size()) R.renderer.render(R.scene, R.camera); }

    function loop() {
        cancelAnimationFrame(frame);
        if (!visible() || !current) return;
        frame = requestAnimationFrame((t) => {
            const dt = last ? Math.min(0.05, (t - last) / 1000) : 0;
            last = t;
            if (!drag && !still()) R.spin.rotation.y += dt * 0.32;
            draw();
            loop();
        });
    }

    /**
     * Draw `name` inside `host` (positioned by CSS). Resolves true when there
     * is a model on screen, false when this aircraft has none or 3D is not
     * available here.
     */
    async function attach(host, name) {
        const m = match(name);
        if (!host || !m) return false;
        const T = await three();
        if (!T || !host.isConnected) return false;
        if (!setup(T)) return false;
        const obj = await load(m.url);
        if (!obj || !host.isConnected) return false;
        if (!current || current.url !== m.url) {
            if (current) R.spin.remove(current.obj);
            R.spin.add(obj);
            if (m.yaw) obj.rotation.y = m.yaw;
            current = { url: m.url, obj };
        }
        R.canvas.title = m.exact ? m.label : m.label + ' (a close relative — no model of this type yet)';
        host.appendChild(R.canvas);
        last = 0;
        draw();
        loop();
        return true;
    }

    global.CrewAircraft3D = { match, attach, models: MODELS };
})(window);
