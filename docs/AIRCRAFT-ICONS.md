# Aircraft icons — where they come from, and what the options are

## The problem

`markers.png` is a 1024×512 sheet holding about sixty aircraft. That puts a
B737's tile at **32×32 physical pixels**, and `loadSpriteSheetAndGenerateIcons()`
registers it with a `pixelRatio` that declares it **128 logical pixels** wide.

At the default icon size on a 3× phone, roughly sixty device pixels are being
asked of a thirty-two pixel source. Every aircraft on the map is a ~2× upscale
of a small bitmap. That is the soft, slightly mushy look, and no amount of
rendering care fixes it — the detail was never in the file.

## What has been tried

### 1. Drawing them (`aircraftIcons.js`) — shipped, not the default

Eighteen parametric silhouettes plus an alias table covering every category
`getAircraftCategory()` can return, rasterised at load into a canvas sized for
the actual device. Sharp at any density, no assets, no licence question, and
about 400 lines.

It is sharper than the sheet and it is **not as good as real artwork**. Drawing
convincing aircraft is a drawing problem, not a geometry problem. Kept as the
`vector` option in Settings; the default is back to `classic`.

`tools/aircraft-icon-preview.html` renders it beside the sheet at map sizes.

### 2. External sets — surveyed August 2026

| Source | What it is | Licence | Verdict |
|---|---|---|---|
| [RexKramer1/AircraftShapesSVG](https://github.com/RexKramer1/AircraftShapesSVG) | **182 top-view planforms**, named by ICAO type (B738, A359, DH8D, EC35 …), drawn for ADS-B viewers, by the BelugaProject authors | **GPL-3.0** — in the repo *and* in each file's `<dc:rights>` metadata | Best artwork found by a distance. Licence is the blocker. |
| [wiedehopf/tar1090](https://github.com/wiedehopf/tar1090) | The shapes most ADS-B web UIs use | **GPL-2.0** | Same blocker |
| [rikgale/VRSCustomMarkers](https://github.com/rikgale/VRSCustomMarkers) | CC0-1.0, and promising on paper | CC0-1.0 | **No artwork in it** — it is Virtual Radar Server *configuration* (squawk colours, marker mappings). The markers themselves ship with VRS. |
| Iconoir, Bootstrap Icons, UXWing, SVG Silh, svgrepo | Permissive icon libraries | MIT / CC0 | One generic stylised plane symbol each. No per-type planforms. Not usable for a tracker. |

The pattern is consistent and worth stating plainly: **realistic per-type
top-down aircraft artwork is a thing the ADS-B community built, and the ADS-B
community licenses copyleft.** The permissive icon libraries have a plane
glyph, not an aircraft set. There is no permissive equivalent to find.

## The decision

Using RexKramer1's set means shipping GPL-3.0 artwork inside a commercial app
with a paid tier. Whether the GPL reaches a bundled asset that is loaded rather
than linked is genuinely arguable, but it is not a call to make quietly on
someone else's product, and it is not reversible once distributed.

Three ways forward:

1. **Ask the author.** The README's whole framing is "time to give something
   back", and the repo exists to be reused. A request to dual-license the
   shapes under CC0 or MIT for this use has a real chance, costs nothing, and
   removes the question permanently. This is the recommended first move.
2. **Accept GPL-3.0** and comply with it for the distribution.
3. **Stay on `markers.png`** and accept the softness, with the `vector` set
   available for anyone who prefers sharp over pretty.

## If the external set is adopted

Notes from evaluating it, so the integration is not re-derived:

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
- Registration should reuse the existing path: same `icon-<KEY>` /
  `icon-<KEY>-nat` ids, same 128-logical-pixel size, so `icon-size` and every
  setting built on it keep their meaning and the sets stay swappable.

## Turning any of this off

`mapFilters.iconSet` selects the set, Settings → **Aircraft Icon Set** exposes
it, and `loadSpriteSheetAndGenerateIcons()` branches on it — falling back to
`markers.png` on its own if a chosen set throws. Removing the drawn set
entirely is deleting `aircraftIcons.js` and that branch.
