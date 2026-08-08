# Aircraft shapes — third-party artwork

Everything in this directory is a **verbatim, unmodified copy** of the SVG
shapes from:

> **AircraftShapesSVG** — https://github.com/RexKramer1/AircraftShapesSVG
> by RexKramer1 and amnesica (the authors of the BelugaProject ADS-B viewer)

182 top-view aircraft planforms, named by ICAO type designator.

## Licence

**GNU General Public License, version 3.** The full text is in `LICENSE` in
this directory, and every SVG additionally carries the same declaration inside
its own `<dc:rights>` metadata.

This artwork is **not** covered by InFlight's own licence or reservation of
rights. It belongs to its authors and is redistributed here under the GPL-3.0.

Attribution also appears in the public Terms of Service, under
"Third-Party Services & APIs".

## Why the SVGs are shipped rather than pre-rasterised

Two reasons, and both matter.

The GPL asks that recipients receive the work in its **source form**. For
artwork that is the editable vector, not a PNG baked out of it — so the files
are served exactly as their authors published them.

It is also what makes them worth having: `aircraftShapes.js` rasterises them at
load into a canvas sized for the device actually running the app, which is the
whole reason they beat `markers.png`. Pre-rasterising would throw that away.

## What the app actually loads

Only the sixteen shapes that `_resolveAircraftCategory()` in `flight.js` can
produce — see the `SHAPE_FILE` table in `aircraftShapes.js`. The rest are kept
because they are part of the work as published, and because the type mapping
can be made finer later without going back to the source repository.

## Updating

Re-copy from upstream and re-run `node tools/test-aircraft-shapes.js`, which
checks that every category still resolves to a file that exists here.
