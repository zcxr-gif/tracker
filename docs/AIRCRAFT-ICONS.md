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

**`marks`** — the marks the Inflight iOS app draws, and the default since
August 2026.

The app and the website should not draw the same aeroplane as two different
shapes, and the map is the thing people look at hardest in both. So these are
the app's own drawings, carried over as path data rather than redrawn:
`tools/gen-plane-marks.js` reads `PlaneArtwork.swift`, `PlaneMarks.swift` and
`PlaneSprites.swift` out of an Inflight-IOS checkout and writes
`planeMarks.data.js`, which is committed. Serving the site needs no iOS
checkout; changing the artwork means re-running the generator and committing
the result.

What the set says that neither of the others does is engine count, jets against
props, and a size that tracks the real aircraft: a 747 has four engines under
its wings in the drawing, and an A380 is a different and bigger drawing again.
At fifteen pixels that is most of what an icon can usefully tell you. What it
gives up is a distinct outline per airliner variant — an A320 and a 737 are
both `medium2jet` — which is a distinction that does not survive twenty pixels
on a map anyway.

The artwork is Virtual Radar Server's markers (**BSD 3-Clause**) plus the
community pack written to extend them (**CC0 1.0**). Both notices travel in the
generated file's header and in the public Terms; see "Licences" below. That is
not why it was adopted, but it is a relief — the planform set it replaced as
the default is GPL-3.0, with an open question attached.

Only the sixteen categories `_resolveAircraftCategory()` can return are
generated, for the same reason the planform set only loads sixteen: nothing
else ever reaches `icon-<KEY>`, and the icons that are registered are what
fills the atlas. The app's own table is much larger — it tells an Apache from a
Chinook — and widening `_resolveAircraftCategory()` to reach it is a real
change with a texture-budget cost, not a regeneration. `tools/test-plane-marks.js`
fails if the resolver and the generated data ever disagree.

### Everybody, not just new visitors

`iconSet` is a saved preference, so changing the default only ever reaches
people who never opened the setting — and by now the default has changed twice,
so most saved profiles carry an explicit older value. For them the phone and the
website went on drawing the same aircraft two different ways, which is the whole
thing the mark set exists to stop.

`migrateIconSet()` in `flight.js` moves every saved profile across once,
whatever it had. It is stamped with `iconSetVersion` rather than forced on every
launch, so it is a migration and not a policy: read the setting afterwards, pick
the classic sheet deliberately, and it stays picked. Only a bump of
`ICON_SET_VERSION` moves anyone again.

It runs twice on the load path — once after the localStorage merge and again
after the cloud copy lands — because a Pro pilot's cloud settings overwrite both
the set *and* the stamp that says the migration ran. Miss the second call and
the old set comes back down on the next device they open.

**`shapes`** — the vendored planform set, the default until August 2026. See
"The decision" below; the artwork is GPL-3.0 and that was accepted deliberately.
Kept because the artwork is genuinely good and per-type.

Both layer *over* `markers.png` rather than replacing it: the set's loader runs
first and the sheet's own `hasImage()` guards leave those alone, then the sheet
supplies the airport markers and everything else. A failure anywhere in a
vector path is therefore not fatal — the sheet fills the gap.

Rasterised at load into a canvas sized for the device, ~235 ms for 48 images
(16 drawings × silhouette, selected, natural) on a desktop browser. The
planforms are drawn to true relative scale — an A388 really is seven times a
C172 — which is compressed with a power curve to about 2:1 so the size cue
survives without half the fleet becoming invisible. The marks carry the app's
own per-key scale table instead, which is the same compression done by hand.

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

`tools/aircraft-icon-preview.html` renders all four sets beside each other at
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

### 3. The iOS app's marks — adopted as the default, August 2026

The survey above was run for the website alone, and its conclusion — that
realistic per-type top-down artwork is a thing the ADS-B community built and
licenses copyleft — was right about the *planform* sets. What it missed is that
Virtual Radar Server's own markers, which are BSD, are a usable set in a
different style: size-and-engine-count families rather than per-type outlines.
The iOS app found them, extended them with the CC0 community pack, and has been
drawing them since.

Adopting them here was not primarily a licence decision. It was that two
products in the same family were drawing the same aeroplane two different ways.
The licences are the part that makes it comfortable rather than the part that
made it happen.

The VRSCustomMarkers row in the table above is worth reading with that in mind:
it says there is no artwork in the repo, which was true of the file that was
checked. The marks are in `MyMarkers1.html`.

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

## The aircraft you have opened

On iOS, tapping an aircraft repaints its mark amber — `PlaneSprites.Palette.selected`,
`UIColor(red: 1.00, green: 0.62, blue: 0.04)` — leaving the outline alone, so a
recoloured aeroplane still reads against a dark map.

On the web that tap used to change nothing. The layer for it
(`sector-ops-live-flights-hover-layer`) has existed all along, registered against
the `icon-<KEY>_S` sprites every set carries — and its filter was never once set,
so it never drew anything. Worse, it was painted with the ordinary traffic colour
expression, so even if it had drawn, the opened aeroplane would have been the
same colour as every other one.

Both are fixed. `markSelectedAircraft()` sets the filter wherever
`currentFlightInWindow` changes, and the layer paints
`SELECTED_AIRCRAFT_COLOR` — the same amber, kept in step with the app by name
and by a test. The layer sits above both traffic layers, so the opened aircraft
is drawn twice: the natural sprite underneath keeps its dark rim and this covers
the body, which is the iOS treatment arrived at from the other direction. The
layer keeps its old `hover` name; nothing else about it is about hovering.

`tools/aircraft-icon-preview.html` draws the opened treatment over dark, light
and satellite grounds.

## Licences

Four sets, four positions:

| Set | Artwork | Licence | What that obliges |
|---|---|---|---|
| `marks` | Virtual Radar Server markers | BSD 3-Clause | the copyright notice, the conditions and the disclaimer must reach whoever receives the icons — which for a rasterised icon on a web map is the binary-form clause. They are in `planeMarks.data.js` and in the public Terms. |
| `marks` | VRSCustomMarkers (rikgale, shish0r) | CC0 1.0 | nothing. Credited anyway. |
| `shapes` | AircraftShapesSVG (RexKramer1, amnesica) | GPL-3.0 | see "The decision" below — the source form is served, the licence text travels with it, and whether the copyleft reaches the rest of the app is still open. |
| `vector` | ours | — | nothing. |

`tools/test-plane-marks.js` and `tools/test-aircraft-shapes.js` each assert
their own notices are still present, so a refactor cannot quietly drop one.

## Turning any of this off

`mapFilters.iconSet` selects the set — `marks` (default), `shapes`, `vector`,
or `classic` — and Settings → **Aircraft Icon Set** exposes all four. A choice
made there survives: the migration above is stamped and will not overwrite it.
`loadSpriteSheetAndGenerateIcons()` branches on it and falls back to
`markers.png` on its own if a set throws.

Removing the vendored set entirely, if the licence ever becomes a problem:
delete `vendor/aircraft-shapes/`, `aircraftShapes.js`, its branch in
`loadSpriteSheetAndGenerateIcons()`, its Settings option, the ToS paragraph, and
`tools/test-aircraft-shapes.js`. Default back to `classic`. Nothing else depends
on it.
