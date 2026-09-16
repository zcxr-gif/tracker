# three.js, vendored

three r160, cut down to the four modules the 787 preview needs.

| File | From the npm package |
|---|---|
| `three.module.min.js` | `build/three.module.min.js` |
| `GLTFLoader.js` | `examples/jsm/loaders/GLTFLoader.js` |
| `BufferGeometryUtils.js` | `examples/jsm/utils/BufferGeometryUtils.js` (GLTFLoader imports it) |
| `OrbitControls.js` | `examples/jsm/controls/OrbitControls.js` |
| `RoomEnvironment.js` | `examples/jsm/environments/RoomEnvironment.js` |

The only edit is the import specifiers. The addons ship importing the bare name
`three`, which a browser cannot resolve without an import map; each is rewritten
to `./three.module.min.js`, and GLTFLoader's `../utils/BufferGeometryUtils.js`
to `./BufferGeometryUtils.js`. Nothing else is touched, so a version bump is:

    npm pack three@<version>
    tar xzf three-<version>.tgz
    # copy the five files above, then redo those two rewrites

**Why not a CDN.** The crew center already pulls Tailwind and Lucide from one,
so this would have been the house style — but those two degrade into a plain
page, and a 3D scene degrades into nothing at all. The one that renders the
sign-in page's aircraft should not be able to go down independently of the site,
and a locally served module is also the only version a browser test can load.

MIT licensed; `LICENSE` is the package's own.
