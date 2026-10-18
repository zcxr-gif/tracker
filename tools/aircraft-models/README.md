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

# An existing glTF: textures off, simplified
node strip.mjs in.glb out.glb
```

`ac2glb.mjs` keeps the outside of the aeroplane only and carries no textures;
the crew centre draws every model in one plain finish, so a livery would not
be seen anyway.
