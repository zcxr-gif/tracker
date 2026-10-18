# tools/aircraft-models

How `models/fleet/*.glb` were made. See `models/fleet/CREDITS.md` for what
each file is and whose it is.

```sh
npm i @gltf-transform/core@4.5.1 @gltf-transform/functions@4.5.1 \
      @gltf-transform/extensions@4.5.1 meshoptimizer

# A single AC3D file
node ac2glb.mjs out.glb path/to/Models/787-8.ac

# A FlightGear model XML (parts placed at their offsets); the second half
# is the aircraft's root, which "Aircraft/<name>/…" paths resolve against
node ac2glb.mjs out.glb "path/to/A320-family/XMLs/A320-211.xml::path/to/A320-family"

# An existing glTF: textures off
node strip.mjs in.glb out.glb

# Last, for every model: compress for the web (meshopt; three.js decodes it)
node pack.mjs in.glb ../../models/fleet/out.glb

# Or the whole fleet, as committed, from a folder of FlightGear checkouts
FG=/path/to/checkouts sh build.sh
```

`SKIP_EXTRA='regex'` before `node ac2glb.mjs` leaves out any further objects
by name, for one model's odd parts (`build.sh` shows where it is used).

After changing any model, bump `MODEL_VERSION` in crewAircraft3D.js: the files
are cached for a day, and a reader would otherwise keep the old one.

`ac2glb.mjs` keeps the outside of the aeroplane only, with its gear up, and
carries no textures: the crew centre paints its own livery on every model, per
pixel, in the airline's colour (crewAircraft3D.js). Geometry is kept at full
detail. Window glass is kept, as a material named `glass`, since the fuselage
has holes where it goes; the crew centre draws it as dark glass, and draws any
face seen from behind (the inside, through a window cut in the skin) the same.
For that to hold, every face is wound to face outward: polygons are
triangulated by ear clipping about their Newell normal, and a surface the
model marks two-sided goes in twice, back to back.
