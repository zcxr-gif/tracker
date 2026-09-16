/**
 * crew787Hero.js — the 787 on the crew center's front door.
 *
 * A preview, deliberately: the three Boeing 787 tracker models are new, nobody
 * has seen them in a page yet, and the sign-in screen is where the crew center
 * is first looked at. This renders one of them into the existing #backdrop
 * layer, under the login card, so the model is judged at the size and against
 * the colours it would actually be shipped at.
 *
 * Which one, and whether at all:
 *
 *   ?hero=787-8 | 787-9 | 787-10   pick a variant   (default: 787-9)
 *   ?hero=off                      no aircraft, page exactly as before
 *
 * Everything here fails soft. WebGL is not promised on every device the crew
 * center is opened on, three.js is a 660 KB import that a slow connection may
 * never finish, and a sign-in page that cannot
 * be signed in to because a decoration threw is a far worse page than one with
 * no decoration. Every failure path ends in the same place: the backdrop that
 * was already there.
 *
 * ABOUT THE MODELS
 *
 * They are authored +X nose / +Y right / +Z up (see the README that shipped
 * with them); glTF is +Y up / -Z forward, and the loader does not fix that for
 * us. Hence the -90° about X below — without it the aircraft sits on its tail.
 *
 * They also carry POSITION and nothing else: no normals, no UVs, four flat PBR
 * materials. glTF says a primitive without normals is flat-shaded, so
 * GLTFLoader turns flatShading on and a fuselage arrives visibly faceted, and
 * the 0.7-metalness nacelles render black with no environment to reflect. Both
 * are fixed here rather than in the asset: normals are computed, and a
 * RoomEnvironment is generated once and used as the scene environment.
 */

const VARIANTS = {
    '787-8':  { file: '/models/boeing_787-8_tracker.glb',  label: 'Boeing 787-8'  },
    '787-9':  { file: '/models/boeing_787-9_tracker.glb',  label: 'Boeing 787-9'  },
    '787-10': { file: '/models/boeing_787-10_tracker.glb', label: 'Boeing 787-10' },
};
const DEFAULT_VARIANT = '787-9';

// Vendored rather than loaded from a CDN — see vendor/three/README.md. A
// sign-in page is the worst place in the product to make a decoration depend on
// somebody else's uptime, and a locally served module is also the only version
// of this that can be checked in a browser test.
const THREE_DIR = '/vendor/three';

(async function crew787Hero() {
    let variant;
    try {
        const asked = new URLSearchParams(location.search).get('hero');
        if (asked === 'off') return;
        variant = VARIANTS[asked] || VARIANTS[DEFAULT_VARIANT];
    } catch { variant = VARIANTS[DEFAULT_VARIANT]; }

    const backdrop = document.getElementById('backdrop');
    if (!backdrop) return;

    // NOT ON A PHONE, and the reason is the layout rather than the budget: the
    // sign-in card is nearly full-bleed under about 900px, so an aircraft
    // behind it is an aircraft nobody can see. Deciding here rather than in
    // fit() means a phone never downloads three.js at all — which is also the
    // device where 660 KB and a WebGL context cost the most.
    if (!window.matchMedia('(min-width: 900px)').matches) return;

    // Cheapest possible WebGL test. A device that fails it gets the page it
    // had before this file existed, with no console noise and no half-built
    // canvas sitting in the layer.
    try {
        const probe = document.createElement('canvas');
        if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return;
    } catch { return; }

    let THREE, GLTFLoader, RoomEnvironment;
    try {
        [THREE, { GLTFLoader }, { RoomEnvironment }] = await Promise.all([
            import(`${THREE_DIR}/three.module.min.js`),
            import(`${THREE_DIR}/GLTFLoader.js`),
            import(`${THREE_DIR}/RoomEnvironment.js`),
        ]);
    } catch { return; }

    const host = document.createElement('div');
    host.className = 'bd-787';
    host.setAttribute('aria-hidden', 'true');
    // Above the colour field, below .look (z-index 1) — so the login card keeps
    // sitting on top of the aircraft rather than the other way round.
    host.style.cssText = 'position:absolute;inset:0;z-index:0;pointer-events:none;opacity:0;transition:opacity 1.2s ease';
    backdrop.appendChild(host);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    // Capped at 2: the aircraft is a soft background object, and a 3x phone
    // rendering it at native density spends a lot of battery on a decoration.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 400);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    // The environment does the metal; these do the shape. A key from high and
    // forward so the wing's leading edge catches, and a dim fill from behind so
    // the shaded side is a colour rather than a silhouette.
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 6, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xbfd4ff, 0.7);
    fill.position.set(-5, 2, -4);
    scene.add(fill);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x2a3240, 0.6));

    let gltf;
    try {
        gltf = await new GLTFLoader().loadAsync(variant.file);
    } catch {
        host.remove();
        renderer.dispose();
        return;
    }

    const model = gltf.scene;

    // See ABOUT THE MODELS. Normals first, because flatShading has to come off
    // the materials the loader already built.
    model.traverse((o) => {
        if (!o.isMesh) return;
        if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) { m.flatShading = false; m.needsUpdate = true; }
    });

    // Z-up as authored → Y-up as rendered.
    const craft = new THREE.Group();
    model.rotation.x = -Math.PI / 2;
    craft.add(model);

    // Centre on the model's own box, and scale on the WINGSPAN rather than the
    // longest side. All three variants span 60.1 m and differ only down the
    // fuselage, so scaling on the span gives them one common scale — and the
    // 787-10 then reads as eleven metres longer than the -8, which is the whole
    // reason for looking at three of them. Scaling on the longest side would
    // normalise that difference away and draw three identical aeroplanes.
    //
    // After the -90° the axes are: x = length, y = height, z = wingspan.
    const box = new THREE.Box3().setFromObject(craft);
    const size = box.getSize(new THREE.Vector3());
    model.position.sub(box.getCenter(new THREE.Vector3()));
    craft.scale.setScalar(2.6 / size.z);

    // A three-quarter view from above and ahead: the angle an airline uses for
    // a fleet photograph, and the one that reads as an aeroplane at a glance
    // rather than as a cross. The pivot holds that tilt and never moves; the
    // aircraft inside it only ever sways a little either side of BASE_YAW.
    //
    // It is deliberately not a turntable. A full rotation spends a third of
    // every cycle showing a tail or a belly, and one of those is what a visitor
    // who happens to look up at the wrong moment takes away as the picture.
    const BASE_YAW = -0.9;
    const SWAY = 0.22;
    const pivot = new THREE.Group();
    pivot.rotation.set(-0.30, 0, 0.13);
    pivot.add(craft);
    craft.rotation.y = BASE_YAW;
    scene.add(pivot);

    camera.position.set(0, 0.15, 1).normalize();
    camera.lookAt(0, 0, 0);

    // What the camera has to clear. Measured from the turning group, so the
    // radius covers the aircraft at every angle of the spin — fitting to the
    // three-quarter pose alone would put the wingtips off the sides a few
    // seconds later, when it comes round side-on.
    const radius = new THREE.Box3().setFromObject(pivot).getBoundingSphere(new THREE.Sphere()).radius;

    const fit = () => {
        const w = host.clientWidth || window.innerWidth;
        const h = host.clientHeight || window.innerHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;

        const vFov = camera.fov * Math.PI / 180;
        const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
        // A portrait phone is framed by its narrow width, a monitor by its
        // height; taking the smaller of the two fields covers both without the
        // breakpoint this used to have. The margin is the space left around the
        // aircraft: generous, because it is a background.
        const dist = (radius * 1.7) / Math.sin(Math.min(vFov, hFov) / 2);
        camera.position.setLength(dist);
        camera.updateProjectionMatrix();

        // WHERE IT SITS, which is the whole difference between a hero and a
        // wallpaper nobody can see. The card is centred, so an aircraft centred
        // behind it is an aircraft with two wingtips showing; this puts it out
        // in the space to the right of the card, emerging from behind its edge.
        const visW = 2 * dist * Math.tan(hFov / 2);
        const visH = 2 * dist * Math.tan(vFov / 2);
        pivot.position.set(visW * 0.27, visH * 0.03, 0);

        // A window dragged narrow after load: the card takes the width, so the
        // aircraft goes away rather than hiding behind it. It comes back if the
        // window is widened again.
        host.style.display = window.innerWidth < 900 ? 'none' : '';
    };
    fit();
    window.addEventListener('resize', fit, { passive: true });

    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let raf = 0;
    const tick = (now) => {
        raf = requestAnimationFrame(tick);
        if (!still) {
            // Two slow sines at different periods, so the motion never quite
            // repeats and never gets quick enough to pull the eye off the
            // sign-in form. ~30s and ~14s.
            craft.rotation.y = BASE_YAW + Math.sin(now / 4800) * SWAY;
            craft.rotation.x = Math.sin(now / 7000) * 0.05;
        }
        renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    // A login page left open in a background tab should not hold a GPU.
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
        else if (!raf) raf = requestAnimationFrame(tick);
    });

    requestAnimationFrame(() => { host.style.opacity = '1'; });

    // For the preview page and the console, so "which one am I looking at" has
    // an answer that is not counting windows.
    window.Crew787Hero = { variant: variant.label, file: variant.file };
})();
