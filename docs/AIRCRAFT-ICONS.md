# Aircraft icons — where they come from, and what the options are

## The problem

`markers.png` is a 1024×512 sheet holding about sixty aircraft. That puts a
B737's tile at **32×32 physical pixels**, and `loadSpriteSheetAndGenerateIcons()`
registers it with a `pixelRatio` that declares it **128 logical pixels** wide.

At the default icon size on a 3× phone, roughly sixty device pixels are being
asked of a thirty-two pixel source. Every aircraft on the map is a ~2× upscale
of a small bitmap. That is the soft, slightly mushy look, and no amount of
rendering care fixes it — the detail was never in the file.

## What ships now

**`shapes`** — the vendored planform set, and the default. See "The decision"
below; the artwork is GPL-3.0 and that was accepted deliberately.

Only the sixteen categories `_resolveAircraftCategory()` can return get a
planform. It layers *over* `markers.png` rather than replacing it: the shape
loader runs first and the sheet's own `hasImage()` guards leave those alone,
then the sheet supplies the airport markers and everything else. A failure
anywhere in the shape path is therefore not fatal — the sheet fills the gap.

Rasterised at load into a canvas sized for the device, ~235 ms for 48 images
(16 shapes × silhouette, selected, natural) on a desktop browser. The shapes
are drawn to true relative scale — an A388 really is seven times a C172 — which
is compressed with a power curve to about 2:1 so the size cue survives without
half the fleet becoming invisible.

## What else has been tried

### 1. Drawing them (`aircraftIcons.js`) — kept as the `vector` option

Eighteen parametric silhouettes plus an alias table covering every category
`getAircraftCategory()` can return, rasterised at load into a canvas sized for
the actual device. Sharp at any density, no assets, no licence question, and
about 400 lines.

It is sharper than the sheet and it is **not as good as real artwork**. Drawing
convincing aircraft is a drawing problem, not a geometry problem — which is
what sent this looking for an external set. Kept because it is the only option
with no licence attached at all.

`tools/aircraft-icon-preview.html` renders all three sets beside each other at
map sizes.

### 2. External sets — surveyed August 2026

| Source | What it is | Licence | Verdict |
|---|---|---|---|
| [RexKramer1/AircraftShapesSVG](https://github.com/RexKramer1/AircraftShapesSVG) | **182 top-view planforms**, named by ICAO type (B738, A359, DH8D, EC35 …), drawn for ADS-B viewers, by the BelugaProject authors | **GPL-3.0** — in the repo *and* in each file's `<dc:rights>` metadata | **Adopted.** Best artwork found by a distance. |
| [wiedehopf/tar1090](https://github.com/wiedehopf/tar1090) | The shapes most ADS-B web UIs use | **GPL-2.0** | Same blocker |
| [rikgale/VRSCustomMarkers](https://github.com/rikgale/VRSCustomMarkers) | CC0-1.0, and promising on paper | CC0-1.0 | **No artwork in it** — it is Virtual Radar Server *configuration* (squawk colours, marker mappings). The markers themselves ship with VRS. |
| Iconoir, Bootstrap Icons, UXWing, SVG Silh, svgrepo | Permissive icon libraries | MIT / CC0 | One generic stylised plane symbol each. No per-type planforms. Not usable for a tracker. |

The pattern is consistent and worth stating plainly: **realistic per-type
top-down aircraft artwork is a thing the ADS-B community built, and the ADS-B
community licenses copyleft.** The permissive icon libraries have a plane
glyph, not an aircraft set. There is no permissive equivalent to find.

## The decision — accepted GPL-3.0, August 2026

Using RexKramer1's set means shipping GPL-3.0 artwork inside a commercial app
with a paid tier. That was raised explicitly and accepted; the alternatives
considered were asking the author to dual-license, and staying on `markers.png`.

**GPL-3.0 is not an attribution licence.** A credit line satisfies MIT or CC-BY.
The GPL additionally requires that the licence text travel with the work and
that recipients can get its source form. What is done here to meet that:

- the SVGs are vendored **verbatim and unmodified**, in their **source form**
  (the editable vector, not a rasterised bake), and served from
  `/vendor/aircraft-shapes/` on the live site;
- the complete GPL-3.0 text sits beside them in `vendor/aircraft-shapes/LICENSE`;
- `vendor/aircraft-shapes/README.md` records the provenance and that the work is
  its authors', not ours;
- the public Terms of Service carry the attribution, the licence name, a link to
  both the upstream repo and the licence, and the path where the source form is
  served.

`tools/test-aircraft-shapes.js` asserts the licence file, the vendor README and
the ToS attribution are all present, so a refactor cannot quietly drop them.

What is **not** settled here is whether the GPL's copyleft reaches the rest of
the application because it bundles this artwork. That is a legal question, it
was flagged before adoption, and it remains open. Revisit it with a lawyer
before it matters, or lift it entirely by getting the author's permission to
use the shapes under a permissive licence.

## Integration notes

From evaluating the set — kept because they are not obvious from the files:

- The SVGs are drawn as **black strokes on a light background** (`fill:none;
  stroke:#000`) with a separate white "Accent" layer. For a map icon the outline
  path wants filling instead — replacing the per-path `style` with
  `fill:<colour>;stroke:none` produces a clean silhouette, which is what the
  SDF tinting path needs.
- Shapes are drawn to **consistent real-world scale across the set** — a C172
  really is tiny beside an A388. That is correct and it is not what a map icon
  wants, so each shape needs normalising to its own bounding box, or a per-type
  size multiplier, rather than being rendered into a fixed box as-is.
- File names are **ICAO type designators**, so they map onto
  `_resolveAircraftCategory()` more precisely than the current category buckets
  do — an opportunity to show an A359 as an A359 rather than as "widebody".
- Two of our buckets have no exact match: `MD80` (closest is `B712`) and `E190`
  (`E195`).
- Registration reuses the existing path: same `icon-<KEY>` / `icon-<KEY>_S` /
  `icon-<KEY>-nat` ids, same 128-logical-pixel size, so `icon-size` and every
  setting built on it keep their meaning and the sets stay swappable.
- The bounding box of each shape is **measured at load** with `getBBox()` rather
  than tabulated. A baked table is one more thing that can quietly disagree with
  the artwork it describes, and sixteen measurements cost a few milliseconds.

## Turning any of this off

`mapFilters.iconSet` selects the set — `shapes` (default), `vector`, or
`classic` — and Settings → **Aircraft Icon Set** exposes all three.
`loadSpriteSheetAndGenerateIcons()` branches on it and falls back to
`markers.png` on its own if a set throws.

Removing the vendored set entirely, if the licence ever becomes a problem:
delete `vendor/aircraft-shapes/`, `aircraftShapes.js`, its branch in
`loadSpriteSheetAndGenerateIcons()`, its Settings option, the ToS paragraph, and
`tools/test-aircraft-shapes.js`. Default back to `classic`. Nothing else depends
on it.
