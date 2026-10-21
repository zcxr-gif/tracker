/**
 * aircraftEngine.js
 * -------------------------------------------------------------------
 * The live map's 3D aircraft: FlightGear's AI models (see
 * aircraftModels.js), each in its airline's paint, placed by the same rules
 * the iOS app's AircraftEngine draws by.
 *
 * ## What it draws
 *
 * - Each aeroplane at its real position and real height above the field —
 *   on the terrain, where the map has terrain — turned to its heading, pitch
 *   and bank. The feed has no pitch or bank, so, like the instruments, pitch
 *   is the flight path angle and bank is what a coordinated turn at the
 *   observed rate would need, eased rather than jumped (`Attitude`).
 * - At the size `magnification` gives for how large a metre is on screen *at
 *   that aeroplane*: real size close in; further out a size curve, so an
 *   A320 is still a few dozen pixels over a city and a speck's worth over a
 *   continent; and never bigger than the airfield while on the ground.
 * - On the flat map, on the globe, and through the change between them:
 *   every aeroplane carries a matrix for each world, blended the way Mapbox
 *   blends its own layers. Everything is worked out in double precision on
 *   the CPU, so what reaches the GPU is each aeroplane's own model-to-clip
 *   matrix, small numbers all, and nothing shimmers at street level.
 * - Every aeroplane of a type and livery in one instanced draw per texture,
 *   so a thousand cost little more than a dozen.
 *
 * Its flat icon is hidden (feature-state `model`) only once its model is
 * ready to draw, so nothing ever blinks out while a model downloads. Taps
 * are answered from where each aeroplane was last drawn (`hitTest`).
 *
 * ## The open aircraft's path, in the air
 *
 * As the iOS app's AircraftPath: the flown path at the heights it was
 * flown, ending on the model as it is drawn — a line a few pixels wide in
 * the colour of each stretch's altitude, over a darker halo, and a
 * translucent curtain hanging from it to the ground that says how high and
 * over what from any angle. The map's flat line stays under it as its
 * shadow. Every point is projected on the CPU and the ribbon widened in
 * screen space, so it is the same width in every world and at every tilt.
 *
 * Public API:
 *   init(map, { features, pose, selected, onModelled, path, pathOn, pathColour })
 *     features()            -> the live feature cache (currentMapFeatures)
 *     pose(id, nowMs)       -> [lon, lat, heading] as the icon is drawn, or null
 *     selected()            -> the open flight's id
 *     onModelled(id, bool)  -> show/hide that flight's flat icon
 *     path(id)              -> its trail: [{ latitude, longitude, altitude
 *                              (ft), groundSpeed (kt) }, …], oldest first
 *     pathOn()              -> whether the flown path is shown
 *     pathColour(feet)      -> [r, g, b] 0…1, the path's colour at a height
 *   setVisible(on), isVisible(), refresh(), hitTest({x, y}) -> flightId|null
 * ===================================================================
 */

import { loadThree } from './threeLoader.js';
import { FlownHead } from './flownHead.js';
import {
    designatorForName, chooseModel, loadGeometry, loadTexture, texturePath, forgetTexture
} from './aircraftModels.js';

export const AircraftEngine = (() => {
    const LAYER_ID = 'aircraft-3d-models';

    // Below this zoom the icons are drawn instead: the whole world's fleet
    // would be every model at once, for aeroplanes a few pixels long.
    const MIN_ZOOM = 4;
    // An aeroplane is painted in its airline's livery once it is drawn at
    // least this long; smaller, the type's plain paint, which every
    // aeroplane of the type shares.
    const LIVERY_MIN_PX = 22;
    // Liveries kept on the GPU at once, beyond the plain ones.
    const MAX_LIVERIES = 48;

    // --- Size (iOS AircraftModelStyle) ---------------------------------
    // How long an A320 is drawn on screen, in pixels, at each zoom, while
    // real size is smaller. Read between stops on a log scale.
    const FAR_LENGTHS = [[2, 5], [5, 8], [8, 12], [11, 18], [13, 26], [15, 38], [16, 46]];
    const REFERENCE_LENGTH = 38;
    const SMALLEST_SHARE = 0.6;
    const GROUND_LONGEST = 150;
    const GROUND_LIFT_DOUBLING = 150;
    const METRES_PER_PX_Z0 = 40075016.686 / 512;

    function farLength(zoom) {
        const first = FAR_LENGTHS[0], last = FAR_LENGTHS[FAR_LENGTHS.length - 1];
        if (zoom <= first[0]) return first[1];
        if (zoom >= last[0]) return last[1];
        for (let i = 1; i < FAR_LENGTHS.length; i++) {
            if (zoom <= FAR_LENGTHS[i][0]) {
                const lo = FAR_LENGTHS[i - 1], hi = FAR_LENGTHS[i];
                const share = (zoom - lo[0]) / (hi[0] - lo[0]);
                return lo[1] * Math.pow(hi[1] / lo[1], share);
            }
        }
        return last[1];
    }

    // The factor a model `length` metres long is drawn at, where a metre is
    // `ppm` pixels: one — real size — whenever real size is at least the
    // curve, just enough larger to reach it when not, and never so large on
    // or near the ground that it outgrows the airfield.
    function magnification(length, ppm, lat, height) {
        length = Math.max(length, 1);
        if (!(ppm > 0) || !isFinite(ppm)) return 1;
        const localZoom = Math.log2(ppm * METRES_PER_PX_Z0 * Math.max(Math.cos(lat * DEG), 0.01));
        const a320 = farLength(localZoom);
        const px = Math.max(a320 * length / REFERENCE_LENGTH, a320 * SMALLEST_SHARE);
        const curve = Math.max(1, px / (length * ppm));
        const longest = GROUND_LONGEST * Math.pow(2, Math.min(Math.max(height, 0), 3000) / GROUND_LIFT_DOUBLING);
        return Math.min(curve, Math.max(1, longest / length));
    }

    // --- Attitude (iOS AircraftAttitude) -------------------------------
    const DEG = Math.PI / 180;
    const KT = 0.514444;
    const FT = 0.3048;

    // A value that settles on its target over about a second.
    class Eased {
        constructor() { this.from = 0; this.to = 0; this.since = 0; }
        value(now) { return this.to + (this.from - this.to) * Math.exp(-Math.max(now - this.since, 0) / 1.2); }
        aim(target, now) { this.from = this.value(now); this.to = target; this.since = now; }
    }

    // A value reported with a rate: run forward at that rate for up to 12 s,
    // with the gap to each new report closed over about a second.
    class Carried {
        constructor() { this.base = 0; this.rate = 0; this.since = 0; this.correction = 0; this.started = false; }
        value(now) {
            const t = Math.max(now - this.since, 0);
            return this.base + this.rate * Math.min(t, 12) + this.correction * Math.exp(-t);
        }
        report(value, rate, now) {
            const drawn = this.started ? this.value(now) : value;
            this.started = true;
            this.base = value; this.rate = rate; this.since = now; this.correction = drawn - value;
        }
    }

    class Attitude {
        constructor() {
            this.lastHeading = null; this.lastAt = 0; this.turnRate = 0;
            this.bank = new Eased(); this.pitch = new Eased(); this.height = new Carried();
            this.groundFeet = null; this.onGround = false; this.speedKt = 0; this.fixAt = 0;
        }
        report(p, now) {
            const alt = Number(p.altitude) || 0;
            const speed = Number(p.speed) || 0;
            const vs = Number(p.verticalSpeed) || 0;
            const heading = Number(p.heading) || 0;
            const onGround = speed < 40 && alt < 10000;
            if (onGround) this.groundFeet = alt;
            this.onGround = onGround;
            this.speedKt = speed;

            // Turn rate between reports, smoothed, the feed's rounding read
            // as wings level.
            if (this.lastHeading !== null) {
                const dt = now - this.lastAt;
                if (dt > 0.5 && dt < 30) {
                    let d = heading - this.lastHeading;
                    if (d > 180) d -= 360;
                    if (d < -180) d += 360;
                    const rate = d / dt;
                    if (Math.abs(rate) <= 12) this.turnRate = this.turnRate * 0.4 + rate * 0.6;
                }
            }
            this.lastHeading = heading;
            this.lastAt = now;

            let bank = 0;
            if (!onGround && Math.abs(this.turnRate) >= 0.4) {
                bank = Math.atan(speed * KT * this.turnRate * DEG / 9.81) / DEG;
                bank = Math.min(Math.max(bank, -35), 35);
            }
            this.bank.aim(bank, now);
            const forward = speed * 101.269;
            const pitch = onGround || forward <= 600 ? 0
                : Math.min(Math.max(Math.atan2(vs, forward) / DEG, -20), 20);
            this.pitch.aim(pitch, now);

            const height = onGround ? 0 : Math.max(alt - (this.groundFeet || 0), 0) * FT;
            this.height.report(height, onGround ? 0 : vs * FT / 60, now);
        }
        heightMetres(now) { return Math.max(this.height.value(now), 0); }
        seaMetres(now) { return (this.groundFeet || 0) * FT + this.heightMetres(now); }
    }

    // --- Matrices (column-major, as WebGL takes them) ------------------
    function mul(a, b) {
        const o = new Float64Array(16);
        for (let c = 0; c < 4; c++) {
            for (let r = 0; r < 4; r++) {
                o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
            }
        }
        return o;
    }
    function apply(m, x, y, z) {
        return [
            m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14],
            m[3] * x + m[7] * y + m[11] * z + m[15]
        ];
    }
    // A frame from three axes (east, north, up in the target's units) and an
    // origin.
    function frame(e, n, u, o) {
        return Float64Array.of(e[0], e[1], e[2], 0, n[0], n[1], n[2], 0, u[0], u[1], u[2], 0, o[0], o[1], o[2], 1);
    }

    // Model directions (right +X, roof +Y, nose −Z) to east, north and up:
    // bank about the fuselage, then pitch about the wings, then heading
    // about the vertical. Rows of the 3×3, as [east; north; up].
    function attitudeMatrix(heading, pitch, bank) {
        const h = heading * DEG, p = pitch * DEG, b = bank * DEG;
        const ch = Math.cos(h), sh = Math.sin(h), cp = Math.cos(p), sp = Math.sin(p), cb = Math.cos(b), sb = Math.sin(b);
        // roll (about model Z), then pitch (about model X), then base (model
        // → ENU with heading north), then yaw (clockwise from north).
        const roll = [cb, sb, 0, -sb, cb, 0, 0, 0, 1];
        const pitchUp = [1, 0, 0, 0, cp, -sp, 0, sp, cp];
        const base = [1, 0, 0, 0, 0, -1, 0, 1, 0];
        const yaw = [ch, sh, 0, -sh, ch, 0, 0, 0, 1];
        const m3 = (a, b2) => {
            const o = new Array(9);
            for (let r = 0; r < 3; r++) {
                for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b2[c] + a[r * 3 + 1] * b2[3 + c] + a[r * 3 + 2] * b2[6 + c];
            }
            return o;
        };
        return m3(m3(m3(yaw, base), pitchUp), roll);
    }

    const EARTH_RADIUS = 6371008.8;
    const CIRCUMFERENCE = 2 * Math.PI * EARTH_RADIUS;
    const GLOBE_RADIUS = 8192 / Math.PI / 2;
    const ECEF_PER_METRE = GLOBE_RADIUS / EARTH_RADIUS;

    // --- Shaders -------------------------------------------------------
    const VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
attribute vec3 color;
attribute vec4 f0; attribute vec4 f1; attribute vec4 f2; attribute vec4 f3;
attribute vec4 g0; attribute vec4 g1; attribute vec4 g2; attribute vec4 g3;
attribute vec3 sun;
attribute vec3 sky;
attribute vec4 tint;
uniform float u_transition;
varying vec2 vUv;
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vSun;
varying vec3 vSky;
varying vec4 vTint;
void main() {
    vec4 p = vec4(position, 1.0);
    vec4 clip = mat4(f0, f1, f2, f3) * p;
    if (u_transition < 1.0) {
        vec4 globe = mat4(g0, g1, g2, g3) * p;
        clip = mix(globe / globe.w, clip / clip.w, u_transition);
    }
    gl_Position = clip;
    vUv = uv;
    vColor = color;
    vNormal = normal;
    vSun = sun;
    vSky = sky;
    vTint = tint;
}`;

    const FRAGMENT = `
precision mediump float;
uniform sampler2D map;
uniform float u_hasMap;
uniform float u_flip;
varying vec2 vUv;
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vSun;
varying vec3 vSky;
varying vec4 vTint;
void main() {
    vec3 base = vColor;
    if (u_hasMap > 0.5) {
        vec4 t = texture2D(map, vUv);
        if (t.a < 0.35) discard;
        base *= t.rgb;
    }
    // Lit from whichever side is showing: a face wound the wrong way in
    // the model has its normal the wrong way too.
    vec3 n = normalize(vNormal);
    if (gl_FrontFacing != (u_flip > 0.0)) n = -n;
    float sunlight = max(dot(n, normalize(vSun)), 0.0);
    float skylight = 0.5 + 0.5 * dot(n, normalize(vSky));
    vec3 c = base * (0.36 + 0.24 * skylight + 0.55 * sunlight);
    gl_FragColor = vec4(mix(c, vTint.rgb, vTint.a), 1.0);
}`;

    // The sun, in east/north/up: high in the north-west, as map shading is.
    const SUN = (() => {
        const az = -40 * DEG, el = 55 * DEG;
        return [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
    })();

    // --- State ---------------------------------------------------------
    let map = null;
    let opts = null;
    let visible = false;
    let gl3 = null;          // { THREE, renderer, scene, camera, shared }
    const tracks = new Map();      // flightId -> track
    const models = new Map();      // model.id -> { model, state, geometry, parts }
    const batches = new Map();     // `${model.id}|${livery}` -> batch
    let drawn = [];                // [{ id, x, y, r }] from the last frame
    let repaintTimer = null;
    let lastSweep = 0;

    function now() { return performance.now() / 1000; }

    // --- Models and liveries -------------------------------------------

    function modelState(model) {
        let s = models.get(model.id);
        if (!s) {
            s = { model, state: 'loading', geometry: null };
            models.set(model.id, s);
            loadGeometry(model).then((g) => {
                s.geometry = g;
                s.state = 'ready';
                if (gl3) buildParts(s);
                kick();
            }, (e) => {
                console.warn('[AircraftEngine] model failed', model.id, e);
                s.state = 'failed';
            });
        }
        return s;
    }

    function buildParts(s) {
        if (s.parts || !s.geometry || !gl3) return;
        const { THREE } = gl3;
        s.parts = s.geometry.parts.map((p) => ({
            textureIndex: p.textureIndex,
            gear: p.gear,
            attrs: {
                position: new THREE.BufferAttribute(p.position, 3),
                normal: new THREE.BufferAttribute(p.normal, 3),
                uv: new THREE.BufferAttribute(p.uv, 2),
                color: new THREE.BufferAttribute(p.color, 3)
            }
        }));
    }

    function batchFor(model, livery) {
        const key = `${model.id}|${livery}`;
        let b = batches.get(key);
        if (!b) {
            b = {
                key, model, livery, state: 'loading', textures: [], lastUsed: now(),
                meshes: null, sets: null, list: [], gearList: []
            };
            batches.set(key, b);
            const paths = model.textures.map((_, i) => texturePath(model, livery, i));
            b.paths = paths;
            Promise.all(paths.map((rel) => (rel ? loadTexture(model, rel).catch(() => null) : null)))
                .then((canvases) => {
                    b.canvases = canvases;
                    b.state = 'ready';
                    kick();
                });
        }
        return b;
    }

    function ensureMeshes(b) {
        if (b.meshes || !gl3) return;
        const s = models.get(b.model.id);
        if (!s || !s.parts) return;
        const { THREE, scene, shared } = gl3;
        b.textures = (b.canvases || []).map((c) => {
            if (!c) return null;
            const t = new THREE.CanvasTexture(c);
            t.anisotropy = 4;
            return t;
        });
        b.sets = { all: makeSet(THREE, 64), gear: makeSet(THREE, 64) };
        b.meshes = s.parts.map((part) => {
            const tex = part.textureIndex >= 0 ? b.textures[part.textureIndex] : null;
            const material = new THREE.RawShaderMaterial({
                vertexShader: VERTEX,
                fragmentShader: FRAGMENT,
                uniforms: {
                    map: { value: tex },
                    u_hasMap: { value: tex ? 1 : 0 },
                    u_transition: shared.u_transition,
                    u_flip: shared.u_flip
                },
                side: THREE.DoubleSide
            });
            const mesh = new THREE.Mesh(geometryFor(THREE, part, b.sets[part.gear ? 'gear' : 'all']), material);
            mesh.frustumCulled = false;
            mesh.userData.part = part;
            scene.add(mesh);
            return mesh;
        });
    }

    // Per-instance attributes: the two model-to-clip matrices, the sun and
    // the sky in the model's own axes, and a tint.
    function makeSet(THREE, capacity) {
        const set = { capacity, count: 0 };
        set.data = {};
        const sizes = { f0: 4, f1: 4, f2: 4, f3: 4, g0: 4, g1: 4, g2: 4, g3: 4, sun: 3, sky: 3, tint: 4 };
        for (const k in sizes) {
            const attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * sizes[k]), sizes[k]);
            if (attr.setUsage) attr.setUsage(THREE.DynamicDrawUsage);
            set.data[k] = attr;
        }
        return set;
    }

    function geometryFor(THREE, part, set) {
        const g = new THREE.InstancedBufferGeometry();
        for (const k in part.attrs) g.setAttribute(k, part.attrs[k]);
        for (const k in set.data) g.setAttribute(k, set.data[k]);
        g.instanceCount = 0;
        return g;
    }

    function growSet(b, name, need) {
        const { THREE } = gl3;
        let cap = b.sets[name].capacity;
        if (need <= cap) return;
        while (cap < need) cap *= 2;
        b.sets[name] = makeSet(THREE, cap);
        for (const mesh of b.meshes) {
            const part = mesh.userData.part;
            if (!!part.gear !== (name === 'gear')) continue;
            mesh.geometry.dispose();
            mesh.geometry = geometryFor(THREE, part, b.sets[name]);
        }
    }

    function disposeBatch(b) {
        if (b.meshes) {
            for (const mesh of b.meshes) {
                gl3.scene.remove(mesh);
                mesh.geometry.dispose();
                mesh.material.dispose();
            }
        }
        for (const t of b.textures) if (t) t.dispose();
        b.meshes = null;
        b.textures = [];
        batches.delete(b.key);
        // Free the decoded image too, unless the plain paint still uses it.
        const plain = batches.get(`${b.model.id}|`);
        (b.paths || []).forEach((rel, i) => {
            if (rel && !(plain && plain.paths && plain.paths[i] === rel)) forgetTexture(b.model, rel);
        });
    }

    // Liveries not drawn for a while go first when there are too many.
    function sweep(t) {
        if (t - lastSweep < 5) return;
        lastSweep = t;
        const painted = [...batches.values()].filter((b) => b.livery && b.state === 'ready');
        if (painted.length <= MAX_LIVERIES) return;
        painted.sort((a, b) => a.lastUsed - b.lastUsed);
        for (const b of painted.slice(0, painted.length - MAX_LIVERIES)) {
            if (t - b.lastUsed > 20) disposeBatch(b);
        }
    }

    // --- Tracks --------------------------------------------------------

    function refresh() {
        if (!visible || !map || !opts) return;
        const feats = opts.features() || {};
        const t = now();
        const seen = new Set();
        for (const key in feats) {
            const f = feats[key];
            if (!f || !f.properties || !f.geometry) continue;
            const p = f.properties;
            const id = String(p.flightId != null ? p.flightId : key);
            seen.add(id);
            let tr = tracks.get(id);
            if (!tr) {
                tr = { id, attitude: new Attitude(), name: null, airline: null, choice: null, modelled: false, sig: null };
                tracks.set(id, tr);
            }
            const sig = `${p.__lastUpdateMs}|${f.geometry.coordinates[0]}|${f.geometry.coordinates[1]}`;
            if (sig !== tr.sig) {
                tr.sig = sig;
                tr.attitude.report(p, t);
            }
            tr.feature = f;
            const name = p.aircraftName || '';
            const airline = p.airlineIcao || '';
            if (name !== tr.name || airline !== tr.airline) {
                tr.name = name;
                tr.airline = airline;
                tr.choice = chooseModel(designatorForName(name), airline);
            }
        }
        for (const [id, tr] of tracks) {
            if (!seen.has(id)) {
                if (tr.modelled) setModelled(tr, false);
                tracks.delete(id);
            }
        }
        kick();
    }

    function setModelled(tr, on) {
        if (tr.modelled === on) return;
        tr.modelled = on;
        try { opts.onModelled && opts.onModelled(tr.id, on); } catch (_) {}
    }

    // --- Drawing -------------------------------------------------------

    function ensureLayer() {
        if (!map || !visible || !gl3 || map.getLayer(LAYER_ID)) return;
        const { THREE } = gl3;
        const layer = {
            id: LAYER_ID,
            type: 'custom',
            renderingMode: '3d',
            onAdd(m, gl) {
                gl3.renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true });
                gl3.renderer.autoClear = false;
            },
            onRemove() {
                // The renderer shares the map's context, so there is nothing
                // of its own to tear down; meshes are rebuilt on the next add.
                for (const b of batches.values()) {
                    if (b.meshes) {
                        for (const mesh of b.meshes) { gl3.scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); }
                        for (const tx of b.textures) if (tx) tx.dispose();
                        b.meshes = null;
                        b.textures = [];
                    }
                }
                if (pathMesh) {
                    gl3.scene.remove(pathMesh.mesh);
                    pathMesh.geometry.dispose();
                    for (const m of pathMesh.materials) m.dispose();
                    pathMesh = null;
                }
                gl3.renderer = null;
            },
            render(gl, matrix, projection, globeToMerc, transition, centerInMerc, ppmRatio) {
                if (!gl3.renderer || !visible) return;
                try {
                    draw(matrix, projection, globeToMerc, transition, centerInMerc, ppmRatio);
                } catch (e) {
                    console.warn('[AircraftEngine] draw failed', e);
                }
            }
        };
        try { map.addLayer(layer); } catch (e) { console.warn('[AircraftEngine] layer add failed', e); }
    }

    function draw(matrix, projection, globeToMerc, transition, centerInMerc, ppmRatio) {
        const { scene, camera, renderer, shared } = gl3;
        const t = now();
        const tMs = t * 1000;
        const zoom = map.getZoom();
        const isGlobe = !!(projection && projection.name === 'globe' && globeToMerc);
        const phase = isGlobe ? Math.min(Math.max(transition, 0), 1) : 1;
        shared.u_transition.value = phase;

        // Close up to an aeroplane, Mapbox's near plane (1/75 of the way to
        // the map's centre — hundreds of metres with an airliner at cruise
        // in front of it) would cut the model away. Then the models and the
        // path get one fifty times nearer, and a depth buffer of their own,
        // since theirs no longer reads like the map's. Decided from the last
        // frame: the aeroplane a frame ago is close enough.
        const P0 = Float64Array.from(matrix);
        const near = nearOf(P0);
        const P = closeUp && near ? withNear(P0, near / NEAR_SHRINK) : P0;
        const PG = isGlobe ? mul(P, Float64Array.from(globeToMerc)) : null;
        let PA = P;
        if (isGlobe && centerInMerc && ppmRatio && ppmRatio !== 1) {
            // Mapbox's flat world on the globe: scaled about the centre.
            const r = ppmRatio, cx = centerInMerc[0], cy = centerInMerc[1];
            PA = mul(P, Float64Array.of(r, 0, 0, 0, 0, r, 0, 0, 0, 0, r, 0, cx * (1 - r), cy * (1 - r), 0, 1));
        }
        // The eye, in the globe's earth-centred units: what the projection
        // sends to infinity. An aeroplane over the horizon from it is not
        // drawn (see the depth note below).
        let eye = null;
        if (isGlobe && phase < 1) {
            // The projection sends the eye to clip (0, 0, c, 0), so it is
            // the inverse's third column, homogeneous.
            const inv = invert4(PG);
            if (inv && Math.abs(inv[11]) > 1e-12) eye = [inv[8] / inv[11], inv[9] / inv[11], inv[10] / inv[11]];
        }
        const canvas = map.getCanvas();
        const width = canvas.clientWidth || canvas.width;
        const height = canvas.clientHeight || canvas.height;
        const terrain = typeof map.getTerrain === 'function' && map.getTerrain();
        const selectedId = opts.selected ? String(opts.selected() || '') : '';

        for (const b of batches.values()) { b.list.length = 0; b.gearList.length = 0; }
        const nextDrawn = [];
        let head = null;
        let fastest = 0;
        let flipSet = false;
        let nearest = Infinity;

        const toScreen = (flat, globe) => {
            let x, y, w = flat[3];
            if (w <= 1e-9) return null;
            x = flat[0] / w; y = flat[1] / w;
            if (globe) {
                if (globe[3] <= 1e-9) return null;
                x = globe[0] / globe[3] + (x - globe[0] / globe[3]) * phase;
                y = globe[1] / globe[3] + (y - globe[1] / globe[3]) * phase;
            }
            return [(x + 1) / 2 * width, (1 - y) / 2 * height];
        };

        // A first, cheap cut to what is near the screen, before anything is
        // fetched or the terrain asked: the bounds, a fifth wider each way.
        const bounds = map.getBounds();
        const south = bounds.getSouth(), north = bounds.getNorth();
        const west = bounds.getWest(), east = bounds.getEast();
        const padLat = (north - south) * 0.2, padLon = (east - west) * 0.2;
        const wraps = east - west + 2 * padLon >= 360;
        const nearScreen = (lon, lat) => {
            if (lat < south - padLat || lat > north + padLat) return false;
            if (wraps) return true;
            while (lon < west - padLon) lon += 360;
            return lon <= east + padLon;
        };

        for (const tr of tracks.values()) {
            if (!tr.choice || zoom < MIN_ZOOM) { if (tr.modelled) setModelled(tr, false); continue; }
            const pose = (opts.pose && opts.pose(tr.id, tMs)) || null;
            const coords = tr.feature.geometry.coordinates;
            const lon = pose ? pose[0] : coords[0];
            const lat = Math.min(Math.max(pose ? pose[1] : coords[1], -85), 85);
            if (tr.id !== selectedId && !nearScreen(lon, lat)) continue;

            const s = modelState(tr.choice.model);
            if (s.state !== 'ready') continue;
            if (!s.parts) buildParts(s);
            const plain = batchFor(tr.choice.model, '');
            if (plain.state !== 'ready') continue;
            if (!tr.modelled) setModelled(tr, true);

            const heading = pose ? pose[2] : (Number(tr.feature.properties.heading) || 0);
            const att = tr.attitude;
            const heightM = att.heightMetres(t);

            // With terrain, close to the ground the height rides the terrain
            // under the aeroplane, so a taxi sits on it; in the air the true
            // altitude is drawn, never below the ground (iOS AircraftFrame).
            let alt = heightM;
            let ground = 0;
            if (terrain) {
                try { ground = map.queryTerrainElevation([lon, lat]) || 0; } catch (_) {}
                const hugging = ground + heightM;
                const flown = Math.max(att.seaMetres(t), ground);
                const share = Math.min(Math.max((heightM - 30) / 120, 0), 1);
                alt = hugging + (flown - hugging) * share;
            }
            // How far above the ground under it the model is drawn — what a
            // camera aiming at it needs (see heightOf).
            tr.drawnHeight = alt - ground;

            // Flat: east, north and up in metres to Mapbox's mercator units.
            const mx = (lon + 180) / 360;
            const my = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + lat * DEG / 2))) / 360;
            const sm = 1 / (CIRCUMFERENCE * Math.cos(lat * DEG));
            const flatFrame = frame([sm, 0, 0], [0, -sm, 0], [0, 0, sm], [mx, my, alt * sm]);
            const flatToClip = mul(PA, flatFrame);

            // Globe: east, north and up to Mapbox's earth-centred units.
            let globeToClip = null;
            if (isGlobe && phase < 1) {
                const la = lat * DEG, lo = lon * DEG;
                const up = [Math.cos(la) * Math.sin(lo), -Math.sin(la), Math.cos(la) * Math.cos(lo)];
                if (eye) {
                    const r0 = GLOBE_RADIUS + alt * ECEF_PER_METRE;
                    const facing = up[0] * (eye[0] - up[0] * r0) + up[1] * (eye[1] - up[1] * r0) + up[2] * (eye[2] - up[2] * r0);
                    if (facing < 0) continue;
                }
                const east = [Math.cos(lo), 0, -Math.sin(lo)];
                const north = [-Math.sin(la) * Math.sin(lo), -Math.cos(la), -Math.sin(la) * Math.cos(lo)];
                const radius = GLOBE_RADIUS + alt * ECEF_PER_METRE;
                const k = ECEF_PER_METRE;
                globeToClip = mul(PG, frame(
                    [east[0] * k, east[1] * k, east[2] * k],
                    [north[0] * k, north[1] * k, north[2] * k],
                    [up[0] * k, up[1] * k, up[2] * k],
                    [up[0] * radius, up[1] * radius, up[2] * radius]));
            }

            const origin = apply(flatToClip, 0, 0, 0);
            const centre = toScreen(origin, globeToClip && apply(globeToClip, 0, 0, 0));
            if (!centre) continue;
            // How far in front of the camera it is, in the projection's own
            // units (clip w is the distance along the view).
            if (origin[3] > 0) nearest = Math.min(nearest, origin[3]);
            // How big a metre is on screen, here: measured along the ground
            // both ways and the larger taken, so a view down a tilted map
            // does not read one foreshortened direction as the scale.
            let ppm = 0;
            for (const [ex, ny] of [[100, 0], [0, 100]]) {
                const q = toScreen(apply(flatToClip, ex, ny, 0), globeToClip && apply(globeToClip, ex, ny, 0));
                if (q) ppm = Math.max(ppm, Math.hypot(q[0] - centre[0], q[1] - centre[1]) / 100);
            }
            if (!(ppm > 0) || !isFinite(ppm)) continue;

            const length = s.geometry.length;
            const mag = magnification(length, ppm, lat, heightM);
            const screenLength = length * mag * ppm;
            const margin = screenLength * 0.6 + 8;
            if (centre[0] < -margin || centre[0] > width + margin || centre[1] < -margin || centre[1] > height + margin) continue;

            // Which paint: the airline's once it is big enough to see, and
            // ready; the type's plain one until then.
            let batch = plain;
            if (tr.choice.livery && screenLength >= LIVERY_MIN_PX) {
                const painted = batchFor(tr.choice.model, tr.choice.livery);
                if (painted.state === 'ready') batch = painted;
            }
            batch.lastUsed = t;
            plain.lastUsed = t;

            const pitch = att.pitch.value(t);
            const bank = att.bank.value(t);
            const R = attitudeMatrix(heading, pitch, bank); // rows: east, north, up
            // Model → ENU, scaled: columns are R's columns times mag.
            const modelM = Float64Array.of(
                R[0] * mag, R[3] * mag, R[6] * mag, 0,
                R[1] * mag, R[4] * mag, R[7] * mag, 0,
                R[2] * mag, R[5] * mag, R[8] * mag, 0,
                0, 0, 0, 1);
            const flatM = mul(flatToClip, modelM);
            const globeM = globeToClip ? mul(globeToClip, modelM) : flatM;
            if (!flipSet) {
                // A projection that keeps a model's handedness turns its
                // outward faces anticlockwise on screen, as WebGL's front
                // faces are; one that mirrors it (det > 0, here) the other way.
                shared.u_flip.value = det4(flatM) <= 0 ? 1 : -1;
                flipSet = true;
            }
            // The sun and the sky in the model's axes: Rᵀ · v.
            const sun = [
                R[0] * SUN[0] + R[3] * SUN[1] + R[6] * SUN[2],
                R[1] * SUN[0] + R[4] * SUN[1] + R[7] * SUN[2],
                R[2] * SUN[0] + R[5] * SUN[1] + R[8] * SUN[2]];
            const sky = [R[6], R[7], R[8]];
            const entry = { flatM, globeM, sun, sky, tint: NO_TINT };
            batch.list.push(entry);
            const gearDown = att.onGround || (heightM < 900 && att.speedKt < 200);
            if (gearDown) batch.gearList.push(entry);

            nextDrawn.push({ id: tr.id, x: centre[0], y: centre[1], r: Math.max(screenLength * 0.5, 10) });
            // The open aircraft's path ends on the middle of the model as it
            // is drawn on this frame, however large that is.
            if (tr.id === selectedId) {
                head = { lon, lat, heading, alt: alt + (s.geometry.height || 0) * mag * 0.5, ground };
            }
            if (!att.onGround || att.speedKt > 3) fastest = Math.max(fastest, att.speedKt * KT * ppm);
        }
        drawn = nextDrawn;
        const wasCloseUp = closeUp;
        closeUp = !!near && nearest < near * CLOSE_UP_FACTOR;
        if (closeUp !== wasCloseUp) kick();

        for (const b of batches.values()) {
            if (!b.list.length) {
                if (b.meshes) for (const mesh of b.meshes) mesh.geometry.instanceCount = 0;
                continue;
            }
            ensureMeshes(b);
            if (!b.meshes) continue;
            growSet(b, 'all', b.list.length);
            growSet(b, 'gear', b.gearList.length);
            write(b.sets.all, b.list);
            write(b.sets.gear, b.gearList);
            for (const mesh of b.meshes) {
                mesh.geometry.instanceCount = (mesh.userData.part.gear ? b.gearList : b.list).length;
            }
        }

        drawPath(selectedId, head, { PA, PG, phase, eye, width, height, terrain, t });

        renderer.resetState();
        // On the globe Mapbox's depth buffer holds nothing a custom layer can
        // be tested against, and everything is drawn under the models anyway
        // at those zooms: they get a cleared one of their own, so they still
        // hide their own far sides, and the horizon test above does the rest.
        // Close in, the map's depth is kept, and terrain and buildings hide
        // what is behind them.
        if (phase < 1 || (wasCloseUp && near)) renderer.clearDepth();
        renderer.render(scene, camera);
        sweep(t);

        // Next frame when the fastest aeroplane on screen has moved half a
        // pixel, as MapAnimator paces the icons; the map redraws for its own
        // reasons in between.
        if (nextDrawn.length) scheduleRepaint(fastest > 0 ? 500 / fastest : 1000);
    }

    const NO_TINT = [0, 0, 0, 0];

    // --- Near plane ------------------------------------------------------
    // Within this many of Mapbox's near distances, an aeroplane is close up.
    const CLOSE_UP_FACTOR = 4;
    const NEAR_SHRINK = 50;
    let closeUp = false;

    // A GL perspective matrix's near distance, read back from its depth row:
    // z = A·w + B, A = (f+n)/(f−n), B = −2fn/(f−n), so n = −B/(A+1).
    // Column-major; row 3 is w, row 2 is z, and the view is affine.
    function nearOf(m) {
        let k = -1;
        for (let c = 0; c < 3; c++) if (Math.abs(m[c * 4 + 3]) > 1e-12) { k = c; break; }
        if (k < 0) return 0;
        const A = m[k * 4 + 2] / m[k * 4 + 3];
        const B = m[14] - A * m[15];
        const n = -B / (A + 1);
        return n > 0 && isFinite(n) ? n : 0;
    }

    // The same matrix with its near plane at `n`, far plane kept.
    function withNear(m, n) {
        const k = [0, 1, 2].find((c) => Math.abs(m[c * 4 + 3]) > 1e-12);
        const A = m[k * 4 + 2] / m[k * 4 + 3];
        const B = m[14] - A * m[15];
        const f = -B / (A - 1);
        if (!(f > n) || !isFinite(f)) return m;
        const A2 = (f + n) / (f - n), B2 = -2 * f * n / (f - n);
        const o = Float64Array.from(m);
        for (let c = 0; c < 4; c++) o[c * 4 + 2] = A2 * m[c * 4 + 3];
        o[14] += B2;
        return o;
    }

    // --- The open aircraft's path (iOS AircraftPath) ---------------------

    const PATH_LINE_PX = 3.4;
    const PATH_HALO_PX = 7;
    const PATH_HALO = [0.03, 0.05, 0.09, 0.55];
    const PATH_CURTAIN = 0.24;
    // Most points projected a frame; older stretches are thinned to fit,
    // the latest kept whole.
    const PATH_MAX_POINTS = 1800;
    const PATH_KEEP_RECENT = 300;
    const FEET = 0.3048;

    let pathCache = null;   // { id, trail, length, last, pts }
    let pathMesh = null;    // { mesh, geometry, materials }

    // The trail as heights above the field the aeroplane last stood on, as
    // iOS FlownPathProfile.heights: on the ground 0; in the air above the
    // last field before (or, before any, the first after); a sample with no
    // height filled between its neighbours.
    function pathPoints(id, trail) {
        const n = trail.length;
        const lastPt = trail[n - 1];
        if (pathCache && pathCache.id === id && pathCache.trail === trail
            && pathCache.length === n && pathCache.last === lastPt) return pathCache.pts;

        // Thin the older part of a long trail.
        const idx = [];
        if (n > PATH_MAX_POINTS) {
            const older = n - PATH_KEEP_RECENT;
            const stride = Math.ceil(older / (PATH_MAX_POINTS - PATH_KEEP_RECENT));
            for (let i = 0; i < older; i += stride) idx.push(i);
            for (let i = older; i < n; i++) idx.push(i);
        } else {
            for (let i = 0; i < n; i++) idx.push(i);
        }

        const raw = idx.map((i) => {
            const p = trail[i] || {};
            const lon = Number(p.longitude != null ? p.longitude : p.lon);
            const lat = Number(p.latitude != null ? p.latitude : p.lat);
            const ft = p.altitude != null ? Number(p.altitude) : NaN;
            const gs = Number(p.groundSpeed != null ? p.groundSpeed : p.gs) || 0;
            return { lon, lat, ft, gs };
        }).filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat));

        const known = raw.map((p) => Number.isFinite(p.ft));
        const airborne = raw.map((p) => !(p.gs < 40 && p.ft < 10000));
        let firstGround = null;
        for (let i = 0; i < raw.length; i++) {
            if (known[i] && !airborne[i]) { firstGround = raw[i].ft; break; }
        }
        let lastGround = null;
        const h = new Array(raw.length).fill(null);
        const sea = new Array(raw.length).fill(null);
        for (let i = 0; i < raw.length; i++) {
            if (!known[i]) continue;
            if (!airborne[i]) { lastGround = raw[i].ft; h[i] = 0; }
            else h[i] = Math.max(raw[i].ft - (lastGround != null ? lastGround : (firstGround || 0)), 0) * FEET;
            sea[i] = raw[i].ft * FEET;
        }
        fillGaps(h);
        fillGaps(sea);

        const pts = raw.map((p, i) => {
            const ft = Number.isFinite(p.ft) ? p.ft : (sea[i] || 0) / FEET;
            const c = (opts.pathColour && opts.pathColour(ft)) || [0.22, 0.74, 0.97];
            // Where it lies on Mapbox's flat world, worked out once rather
            // than on every frame it is drawn.
            const lat = Math.min(Math.max(p.lat, -85), 85);
            const mx = (p.lon + 180) / 360;
            const my = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + lat * DEG / 2))) / 360;
            const sm = 1 / (CIRCUMFERENCE * Math.cos(lat * DEG));
            return { lon: p.lon, lat: p.lat, mx, my, sm, h: h[i] || 0, sea: sea[i] || 0, colour: c, ground: 0, groundAt: -1 };
        });
        pathCache = { id, trail, length: n, last: lastPt, pts };
        return pts;
    }

    function fillGaps(values) {
        const first = values.findIndex((v) => v != null);
        if (first < 0) { values.fill(0); return; }
        for (let i = 0; i < first; i++) values[i] = values[first];
        let prev = first;
        for (let i = first + 1; i < values.length; i++) {
            if (values[i] == null) continue;
            for (let g = prev + 1; g < i; g++) {
                values[g] = values[prev] + (values[i] - values[prev]) * (g - prev) / (i - prev);
            }
            prev = i;
        }
        for (let i = prev + 1; i < values.length; i++) values[i] = values[prev];
    }

    function ensurePathMesh() {
        if (pathMesh || !gl3) return pathMesh;
        const { THREE, scene } = gl3;
        const vertex = `
precision highp float;
attribute vec3 position;
attribute vec4 color;
varying vec4 vColor;
void main() { gl_Position = vec4(position, 1.0); vColor = color; }`;
        const fragment = `
precision mediump float;
varying vec4 vColor;
void main() { gl_FragColor = vColor; }`;
        // All three in the transparent pass, in this order — curtain, halo,
        // line — so the line is drawn over its halo rather than under it.
        const make = (depthWrite) => new THREE.RawShaderMaterial({
            vertexShader: vertex, fragmentShader: fragment, side: THREE.DoubleSide,
            transparent: true, depthWrite
        });
        const geometry = new THREE.BufferGeometry();
        const materials = [make(false), make(false), make(true)]; // curtain, halo, line
        const mesh = new THREE.Mesh(geometry, materials);
        mesh.frustumCulled = false;
        // Under the aeroplanes, so the line meets the model rather than
        // painting over it.
        mesh.renderOrder = -1;
        scene.add(mesh);
        pathMesh = { mesh, geometry, materials, capacity: 0 };
        return pathMesh;
    }

    function hidePath() {
        if (pathMesh) pathMesh.mesh.visible = false;
    }

    // Scratch for drawPath, grown as needed and reused frame to frame, so
    // drawing the path allocates nothing: a point's screen position (x, y,
    // z in NDC, then pixels), the points kept on screen, and the vertex and
    // index data handed to the GPU — six vertices a point (halo either side,
    // line either side, curtain top and bottom), in that order.
    const scratch = { n: 0, top: null, bot: null, alt: null, gnd: null, kept: null, pos: null, col: null, idx: null };
    function growScratch(n) {
        if (scratch.n >= n) return;
        const c = Math.max(n, scratch.n * 2, 256);
        scratch.n = c;
        scratch.top = new Float64Array(c * 5);
        scratch.bot = new Float64Array(c * 3);
        scratch.alt = new Float64Array(c);
        scratch.gnd = new Float64Array(c);
        scratch.kept = new Int32Array(c);
        scratch.pos = new Float32Array(c * 6 * 3);
        scratch.col = new Float32Array(c * 6 * 4);
        scratch.idx = new Uint32Array(c * 18);
    }

    // Terrain under the path is asked about a slice of points a frame, every
    // point within about three seconds, rather than all of them at once.
    const PATH_GROUND_EVERY_S = 3;
    let pathGroundCursor = 0;

    function drawPath(id, head, f) {
        const trail = id && opts.path && (!opts.pathOn || opts.pathOn()) ? opts.path(id) : null;
        if (!trail || trail.length < 1) { hidePath(); return; }
        const pts = pathPoints(id, trail);
        if (!pts.length) { hidePath(); return; }

        const { PA, PG, phase, eye, width, height, terrain, t } = f;
        const globe = !!(PG && phase < 1);

        // On to the aeroplane, when it is drawn on this frame — from the
        // last breadcrumb it has passed, not from one it has yet to reach,
        // so the path never runs out in front of it (see flownHead.js).
        const count = head ? FlownHead.trimAhead(pts, [head.lon, head.lat, head.heading], (p) => [p.lon, p.lat]) : pts.length;
        const n = count + (head ? 1 : 0);
        if (n < 1) { hidePath(); return; }
        growScratch(n);
        const { top, bot, alt, gnd, kept, pos, col, idx } = scratch;

        // The ground under each point, and the altitude drawn over it — as
        // the models are (iOS AircraftFrame.altitude).
        if (terrain) {
            const slice = Math.max(1, Math.ceil(count / (PATH_GROUND_EVERY_S * 60)));
            for (let k = 0; k < slice && count; k++) {
                const p = pts[pathGroundCursor % count];
                pathGroundCursor = (pathGroundCursor + 1) % count;
                try { p.ground = map.queryTerrainElevation([p.lon, p.lat]) || 0; } catch (_) { p.ground = 0; }
                p.groundAt = t;
            }
        }
        for (let i = 0; i < count; i++) {
            const p = pts[i];
            if (terrain) {
                if (p.groundAt < 0) {
                    try { p.ground = map.queryTerrainElevation([p.lon, p.lat]) || 0; } catch (_) { p.ground = 0; }
                    p.groundAt = t;
                }
                const ground = p.ground;
                const hugging = ground + p.h;
                const flown = Math.max(p.sea, ground);
                const share = Math.min(Math.max((p.h - 30) / 120, 0), 1);
                alt[i] = hugging + (flown - hugging) * share;
                gnd[i] = ground;
            } else {
                alt[i] = p.h;
                gnd[i] = 0;
            }
        }
        if (head) { alt[count] = head.alt; gnd[count] = head.ground; }
        const lonOf = (i) => (i < count ? pts[i].lon : head.lon);
        const latOf = (i) => (i < count ? pts[i].lat : head.lat);

        // A point at an altitude to NDC, through each world, blended after the
        // divide as the models are, into out[o..o+2] (and pixels into
        // out[o+3], out[o+4] when `px`); false behind the camera or the globe.
        const project = (i, a, out, o, px) => {
            const p = i < count ? pts[i] : null;
            let mx, my, sm;
            if (p) { mx = p.mx; my = p.my; sm = p.sm; } else {
                const lat = Math.min(Math.max(head.lat, -85), 85);
                mx = (head.lon + 180) / 360;
                my = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + lat * DEG / 2))) / 360;
                sm = 1 / (CIRCUMFERENCE * Math.cos(lat * DEG));
            }
            const z0 = a * sm;
            const w = PA[3] * mx + PA[7] * my + PA[11] * z0 + PA[15];
            if (w <= 1e-9) return false;
            let x = (PA[0] * mx + PA[4] * my + PA[8] * z0 + PA[12]) / w;
            let y = (PA[1] * mx + PA[5] * my + PA[9] * z0 + PA[13]) / w;
            let z = (PA[2] * mx + PA[6] * my + PA[10] * z0 + PA[14]) / w;
            if (globe) {
                const la = latOf(i) * DEG, lo = lonOf(i) * DEG;
                const r = GLOBE_RADIUS + a * ECEF_PER_METRE;
                const ux = Math.cos(la) * Math.sin(lo), uy = -Math.sin(la), uz = Math.cos(la) * Math.cos(lo);
                const gx = ux * r, gy = uy * r, gz = uz * r;
                if (eye && ux * (eye[0] - gx) + uy * (eye[1] - gy) + uz * (eye[2] - gz) < 0) return false;
                const gw = PG[3] * gx + PG[7] * gy + PG[11] * gz + PG[15];
                if (gw <= 1e-9) return false;
                const nx = (PG[0] * gx + PG[4] * gy + PG[8] * gz + PG[12]) / gw;
                const ny = (PG[1] * gx + PG[5] * gy + PG[9] * gz + PG[13]) / gw;
                const nz = (PG[2] * gx + PG[6] * gy + PG[10] * gz + PG[14]) / gw;
                x = nx + (x - nx) * phase;
                y = ny + (y - ny) * phase;
                z = nz + (z - nz) * phase;
            }
            out[o] = x; out[o + 1] = y; out[o + 2] = z;
            if (px) { out[o + 3] = (x + 1) / 2 * width; out[o + 4] = (1 - y) / 2 * height; }
            return true;
        };

        // Every point projected; then only those at least half a pixel on
        // from the last one kept (and the ends, and the edges of a stretch
        // behind the camera) are drawn — a long trail seen from afar costs
        // what it covers on screen, not how long it is. A point behind the
        // camera is kept as -1: a break in the line.
        let m = 0;
        let lastX = NaN, lastY = NaN;
        for (let i = 0; i < n; i++) {
            const ok = project(i, alt[i], top, i * 5, true);
            if (!ok) {
                if (m && kept[m - 1] >= 0) kept[m++] = -1;
                lastX = NaN;
                continue;
            }
            const sx = top[i * 5 + 3], sy = top[i * 5 + 4];
            const last = i === n - 1;
            if (!last && m && kept[m - 1] >= 0 && Math.abs(sx - lastX) < 0.5 && Math.abs(sy - lastY) < 0.5) continue;
            kept[m++] = i;
            lastX = sx; lastY = sy;
        }

        // Vertices, six a kept point; a point with no direction on screen
        // (or behind the camera) has none, and ends the line there.
        const hx = PATH_HALO_PX / 2, lx = PATH_LINE_PX / 2;
        const put = (v, px, py, pz, r, g, b, a) => {
            const pv = v * 3, cv = v * 4;
            pos[pv] = px; pos[pv + 1] = py; pos[pv + 2] = pz;
            col[cv] = r; col[cv + 1] = g; col[cv + 2] = b; col[cv + 3] = a;
        };
        const has = scratch.has || (scratch.has = []);
        const hasBottom = scratch.hasBottom || (scratch.hasBottom = []);
        has.length = m; hasBottom.length = m;
        for (let k = 0; k < m; k++) {
            const i = kept[k];
            has[k] = false; hasBottom[k] = false;
            if (i < 0) continue;
            const before = k > 0 ? kept[k - 1] : -1, after = k < m - 1 ? kept[k + 1] : -1;
            const o = i * 5;
            let dx = 0, dy = 0;
            if (after >= 0) { dx += top[after * 5 + 3] - top[o + 3]; dy += top[after * 5 + 4] - top[o + 4]; }
            if (before >= 0) { dx += top[o + 3] - top[before * 5 + 3]; dy += top[o + 4] - top[before * 5 + 4]; }
            const len = Math.hypot(dx, dy);
            if (len < 1e-6) continue;
            has[k] = true;
            const nx = -dy / len, ny = dx / len;
            const ox = 2 * nx / width, oy = -2 * ny / height;
            const x = top[o], y = top[o + 1], z = top[o + 2];
            const c = i < count ? pts[i].colour : (count ? pts[count - 1].colour : [0.22, 0.74, 0.97]);
            const v = k * 6;
            const H = PATH_HALO;
            put(v, x + ox * hx, y + oy * hx, z, H[0], H[1], H[2], H[3]);
            put(v + 1, x - ox * hx, y - oy * hx, z, H[0], H[1], H[2], H[3]);
            put(v + 2, x + ox * lx, y + oy * lx, z, c[0], c[1], c[2], 1);
            put(v + 3, x - ox * lx, y - oy * lx, z, c[0], c[1], c[2], 1);
            if (project(i, gnd[i], bot, k * 3, false)) {
                hasBottom[k] = true;
                put(v + 4, x, y, z, c[0], c[1], c[2], PATH_CURTAIN);
                put(v + 5, bot[k * 3], bot[k * 3 + 1], bot[k * 3 + 2], c[0], c[1], c[2], 0);
            }
        }

        // Quads between neighbouring kept points that both have vertices:
        // the curtains, the halos and the lines, each in a block of its own.
        const block = Math.max(m - 1, 1) * 6;
        let cN = 0, hN = 0, lN = 0;
        const q = (at, a0, a1, b0, b1) => {
            idx[at] = a0; idx[at + 1] = b0; idx[at + 2] = a1;
            idx[at + 3] = b0; idx[at + 4] = b1; idx[at + 5] = a1;
        };
        for (let k = 0; k < m - 1; k++) {
            if (!has[k] || !has[k + 1]) continue;
            const a = k * 6, b = (k + 1) * 6;
            if (hasBottom[k] && hasBottom[k + 1]) { q(cN, a + 4, a + 5, b + 4, b + 5); cN += 6; }
            q(block + hN, a, a + 1, b, b + 1); hN += 6;
            q(2 * block + lN, a + 2, a + 3, b + 2, b + 3); lN += 6;
        }
        if (!lN) { hidePath(); return; }

        const pm = ensurePathMesh();
        if (!pm) return;
        const { THREE } = gl3;
        const g = pm.geometry;
        const vcount = m * 6;
        if (vcount > pm.capacity) {
            pm.capacity = Math.max(vcount, pm.capacity * 2, 256);
            g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pm.capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
            g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pm.capacity * 4), 4).setUsage(THREE.DynamicDrawUsage));
        }
        g.attributes.position.array.set(pos.subarray(0, vcount * 3));
        g.attributes.color.array.set(col.subarray(0, vcount * 4));
        g.attributes.position.needsUpdate = true;
        g.attributes.color.needsUpdate = true;
        const icount = 3 * block;
        if (!pm.index || pm.index.array.length < icount) {
            pm.index = new THREE.BufferAttribute(new Uint32Array(Math.max(icount, (pm.index ? pm.index.array.length : 0) * 2, 1536)), 1)
                .setUsage(THREE.DynamicDrawUsage);
            g.setIndex(pm.index);
        }
        pm.index.array.set(idx.subarray(0, icount));
        pm.index.needsUpdate = true;
        g.clearGroups();
        g.addGroup(0, cN, 0);
        g.addGroup(block, hN, 1);
        g.addGroup(2 * block, lN, 2);
        g.setDrawRange(0, icount);
        pm.mesh.visible = true;
    }

    function invert4(m) {
        const inv = new Float64Array(16);
        inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
        inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
        inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
        inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
        inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
        inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
        inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
        inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
        inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
        inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
        inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
        inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
        inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
        inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
        inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
        inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
        const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
        if (!det) return null;
        for (let i = 0; i < 16; i++) inv[i] /= det;
        return inv;
    }

    function det4(m) {
        const [a, b, c, d, e, f, g, h, i, j, k, l, mm, n, o, p] = m;
        const kp = k * p - l * o, jp = j * p - l * n, jo = j * o - k * n;
        const ip = i * p - l * mm, io = i * o - k * mm, in_ = i * n - j * mm;
        return a * (f * kp - g * jp + h * jo) - b * (e * kp - g * ip + h * io)
            + c * (e * jp - f * ip + h * in_) - d * (e * jo - f * io + g * in_);
    }

    function write(set, list) {
        const d = set.data;
        for (let i = 0; i < list.length; i++) {
            const e = list[i];
            const fm = e.flatM, gm = e.globeM;
            d.f0.array.set([fm[0], fm[1], fm[2], fm[3]], i * 4);
            d.f1.array.set([fm[4], fm[5], fm[6], fm[7]], i * 4);
            d.f2.array.set([fm[8], fm[9], fm[10], fm[11]], i * 4);
            d.f3.array.set([fm[12], fm[13], fm[14], fm[15]], i * 4);
            d.g0.array.set([gm[0], gm[1], gm[2], gm[3]], i * 4);
            d.g1.array.set([gm[4], gm[5], gm[6], gm[7]], i * 4);
            d.g2.array.set([gm[8], gm[9], gm[10], gm[11]], i * 4);
            d.g3.array.set([gm[12], gm[13], gm[14], gm[15]], i * 4);
            d.sun.array.set(e.sun, i * 3);
            d.sky.array.set(e.sky, i * 3);
            d.tint.array.set(e.tint, i * 4);
        }
        set.count = list.length;
        if (list.length) for (const k in d) d[k].needsUpdate = true;
    }

    function scheduleRepaint(ms) {
        if (!visible || !map) return;
        ms = Math.min(Math.max(ms, 16), 1000);
        if (repaintTimer) clearTimeout(repaintTimer);
        repaintTimer = setTimeout(() => {
            repaintTimer = null;
            if (visible && map) map.triggerRepaint();
        }, ms);
    }

    // Something new to draw: a model or livery arrived, or new positions.
    function kick() {
        if (visible && map) map.triggerRepaint();
    }

    // --- Public --------------------------------------------------------

    // Called again whenever the host rebuilds its layers; only the first call
    // for a map binds anything.
    function init(m, options) {
        opts = options || {};
        if (map === m) return;
        map = m;
        // A style change drops custom layers; put it back.
        map.on('style.load', () => { if (visible) ensureLayer(); });
    }

    async function setVisible(on) {
        visible = !!on;
        if (!map) return visible;
        if (visible) {
            try {
                const THREE = await loadThree();
                if (!gl3) {
                    gl3 = {
                        THREE,
                        scene: new THREE.Scene(),
                        camera: new THREE.Camera(),
                        renderer: null,
                        shared: { u_transition: { value: 1 }, u_flip: { value: 1 } }
                    };
                }
            } catch (e) {
                console.warn('[AircraftEngine] three.js unavailable', e);
                visible = false;
                return false;
            }
            if (!visible) return false;
            ensureLayer();
            refresh();
        } else {
            if (repaintTimer) { clearTimeout(repaintTimer); repaintTimer = null; }
            for (const tr of tracks.values()) setModelled(tr, false);
            tracks.clear();
            drawn = [];
            if (map.getLayer(LAYER_ID)) { try { map.removeLayer(LAYER_ID); } catch (_) {} }
            for (const b of [...batches.values()]) if (b.livery) disposeBatch(b);
        }
        return visible;
    }

    function isVisible() { return visible; }

    /**
     * How high above the ground under it a flight's model is drawn, in
     * metres: the last frame's, or its reported height if it has not been
     * drawn yet. 0 for a flight the engine has no track of.
     */
    function heightOf(id) {
        const tr = tracks.get(String(id));
        if (!tr) return 0;
        return Number.isFinite(tr.drawnHeight) ? tr.drawnHeight : tr.attitude.heightMetres(now());
    }

    /** The flight drawn under a screen point, nearest first, or null. */
    function hitTest(point) {
        if (!visible || !point) return null;
        let best = null, bestD = Infinity;
        for (const d of drawn) {
            const dist = Math.hypot(d.x - point.x, d.y - point.y);
            if (dist <= d.r && dist < bestD) { best = d.id; bestD = dist; }
        }
        return best;
    }

    // Exposed for tests.
    const _internals = { magnification, farLength, attitudeMatrix, Attitude };

    return { init, setVisible, isVisible, refresh, hitTest, heightOf, _internals };
})();
