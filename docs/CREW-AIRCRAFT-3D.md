# 3D models in the crew center

Where somebody has published a good 3D model of an aircraft type, the crew
center's thumbnail of that type gains a small **3D** badge. Pressing it opens
the model in a panel — spin it, zoom it, look at the tail.

Everywhere else nothing changes at all. This is an upgrade on the types we
happen to have a model of, never a promise about every row.

| | |
|---|---|
| `crewAircraft3D.js` | The library, the matching, and the viewer. |
| `tools/add-aircraft-3d.js` | Paste Sketchfab's embed code; it writes the entry. |
| `tools/test-aircraft-3d.js` | The right aeroplane, or none — and always the credit. |

---

## Adding a model

Copy the embed code from the model's Sketchfab page (**Embed → copy**) and
paste it in:

```
pbpaste | node tools/add-aircraft-3d.js
```

That is the whole job. The tool reads the model id, the aircraft and the author
out of the block, writes the line into `crewAircraft3D.js` under that author,
and prints back which type names the model will answer to:

```
  Boeing 787-9
  by OUTPISTON (sketchfab.com/outpiston)
  https://sketchfab.com/3d-models/boeing-787-9-95967154ac554bd88b5620613a7c85b3

  Answers to:
    Boeing 787-9 → exact
    Boeing 787   → closest match

  Written to crewAircraft3D.js
```

Read that last block before committing — it is the only check that the model
landed on the aeroplane you meant.

Other ways in, for when the paste is not a full embed block:

```
node tools/add-aircraft-3d.js '<model url>' --at outpiston --by OUTPISTON
node tools/add-aircraft-3d.js --dry < embed.txt          # print, change nothing
node tools/add-aircraft-3d.js --title 'Boeing 787-9' --also 'B789,Dreamliner' < embed.txt
```

Or edit `crewAircraft3D.js` directly: the `LIBRARY` block is one entry per
author, and a model is a URL on a line of its own. **Nobody types the aircraft
name** — it is in the URL, which is the entire reason this is arranged the way
it is. A registry whose upkeep is "work out what this is and spell it the way
the API spells it" is a registry that stops being updated.

The `// ac3d:<handle>` and `// ac3d:authors` lines in that block are where the
tool writes. Leave them alone.

## How a model finds its aircraft

Type names reach the crew center from three places that do not agree with each
other: the Live API's canonical names (`Boeing 787-10 Dreamliner`), whatever
staff typed into a schedule's aircraft field (`B789`, `787-9`), and the model's
own URL slug (`boeing-787-9`). So matching happens in tiers, and each tier
knows how sure it is:

| | |
|---|---|
| **exact** | The designators agree down to the variant. `b787-9` is a 787-9. |
| **closest** | The family agrees, the variant does not. |
| **nothing** | No badge, no change to the row. |

A **closest** match is shown, because a 787-9 model against a 787-10 is genuinely
useful — but it is labelled with the model's own name and the panel says in
words that it is not that exact variant. Showing one aeroplane as another is the
kind of quiet invention the rest of the crew center was rewritten to stop doing.

Behind that: ICAO type codes are expanded per word (`B789` → `787-9`), then a
small table of designator rules pulls out a family and a variant (`b787` + `9`).
The table only covers families where **the variant changes the shape** — a
stretch is a different silhouette and a reader notices. Anything else (a Cessna
172, a Spitfire) is matched on its words instead, which is a better tool for
those names than any regular expression should try to be.

## Where the badge appears

- **The fleet board and the fleet panel** — `crewInfiniteFlight.js`, on both
  the owner dashboard and the pilot page. The badge sits on the thumbnail
  `crewAircraftImage.js` already draws; that module's guarantee (there is always
  an image, and it cannot fail to load) is untouched, because this one only ever
  wraps the markup it produced.
- **A departure's detail** — `crewSchedule.js`, as a small `3D` pill after the
  aircraft type.

Adding it somewhere else is two lines:

```js
// a picture, badged if we have a model of it — unchanged if we do not
window.CrewAircraft3D ? window.CrewAircraft3D.thumb(html, aircraft) : html

// or, where there is no picture to badge
window.CrewAircraft3D ? window.CrewAircraft3D.button({ type }, { inline: true }) : ''
```

Both return the input unchanged (or an empty string) when there is no model, so
they can be called unconditionally. Clicks are handled by the module itself, in
the **capture** phase — a badge inside a row that opens its own detail must not
open both.

## What it costs a page that has no models

Nothing. There is no iframe, no Sketchfab script and no stylesheet at load: the
library is a handful of strings, the embed is created when the panel opens, and
it is destroyed when the panel closes — a closed panel is not left running a
WebGL context behind the page.

## Why an embed rather than a file

There are `.glb` files in `models/`, downloaded from Sketchfab and credited in
`contributes.txt`, which nothing currently draws. Embedding is the better trade
here:

- **It is the author's own rendering**, with their materials and lighting, not
  our reimport of them.
- **It costs a VA nothing until somebody asks.** A file we ship is bytes in the
  deploy whether or not any crew center has the type in its fleet.
- **The licence travels with it.** Sketchfab's embed carries the model page, the
  author and the link; the viewer renders all three, every time it opens, and
  `tools/test-aircraft-3d.js` fails if any of them stops reaching the page.
  Files we ship are a separate obligation, which is what `contributes.txt` is —
  models added here do not go in it.

Only models the author has published with embedding allowed go in the library.
We are borrowing somebody's work; their name travels with it.
