# The crew center's two interfaces

A virtual airline's crew center is the second thing it shows a recruit, after
its website. Until now every one of them looked identical: the warm, papery,
hairline-ruled shell this product shipped with, with the VA's logo in the
corner. That shell is a good piece of design and it is deliberately quiet —
and quiet is not what every airline wants. A VA with a neon brand, a dark
website and a Discord full of livery renders was sending its pilots somewhere
that read as somebody else's product.

So there are two now, and a VA picks.

| | |
|---|---|
| **Essential** | The original. Warm paper, hairlines, flat cards, a ruled top bar. Unchanged in every respect — see below. |
| **Aurora** | Dark-first. An ambient gradient canvas, glass panels floating over it, luminous rims and depth instead of rules, a top bar that floats free of the window, and motion on a spring. |

Both work in light and dark — the reader's light/dark choice is a separate
setting and neither interface takes it over.

## Picking one

**An owner**, in Settings → Appearance → Interface. Each option draws a working
miniature of the interface it is offering, in that interface's colours; the
choice applies on the spot and is saved to the crew record as `ui`, so everyone
in the VA gets it on their next visit.

**Anyone else** — every pilot, on the pilot home — from the switch in the top
bar. That is a personal, per-device choice: it is remembered for that VA on
that browser and it never touches the crew record. Settings is a staff room
and most of the people reading a crew center never see it.

**A preview link**: `?ui=aurora` on any crew center URL. Deliberately not
persisted, so an owner can paste one into Discord for staff to look at without
rewriting the preference of everyone who clicks it.

Precedence, highest first: `?ui=` → this device → the crew record → Essential.

## What it is made of

| File | What it does |
|---|---|
| `crewSkin.js` | Resolves which interface is on, writes `data-skin` on `<html>` before the first paint, draws the chooser and the top-bar switch. |
| `crewSkin.css` | Draws Aurora. Every rule is scoped to `:root[data-skin="aurora"]`, so `essential` matches nothing in it. |

Both are loaded, in that order, by `crew-dashboard.html`, `crew-pilot.html`,
`crew.html`, `crew-join.html`, `crew-status.html` and `crew-website.html` —
every page of the crew center, so the look does not change character halfway
through a recruit's first hour with an airline.

### Why one stylesheet covers fourteen modules

The crew center is a dashboard, a pilot home, a website builder, a login, a
join form, a status page and fourteen panel modules. None of them were touched
to add the second interface, and they did not need to be: they are all built
from the same small vocabulary — the design tokens (`--bg`, `--surface`,
`--line`, `--ink`, `--muted`, `--faint`, `--accent`), the page primitives
(`.surface`, `.hair`, `.tile`, `.accent-bg`, `.stat-num`) and the shared panel
chrome (`crewPanels.js`'s `cp-*` classes, and `crewEvents.js`'s matching
`cev-*`). `crewPanels.js` states the rule outright: *every colour is a `var()`
off the host page*.

`crewSkin.css` re-states that vocabulary, and the product follows — including
modules written a year before the file existed.

### The VA's brand always wins

`crewBrand.js` publishes every token it resolves twice: `--bg` **and**
`--brand-bg`, `--ink` and `--brand-ink`, and so on. `crewSkin.css` reads the
brand alias first and only falls back to its own value:

```css
--bg: var(--brand-bg, #070A12);
```

So the precedence comes out the only way that can be right: **a VA's colours,
in the interface's form**, and the interface's colours only where the VA has
not said. A VA that has set nothing gets Aurora's own palette, which is the
point of offering a second look at all.

Anything the brand sets with `!important` — the body background, `.surface`'s
fill and border, `--crew-radius` — still wins outright. Aurora's contribution
there is depth, motion and geometry, which a brand theme has no opinion about.

## Adding a third

1. Add its name to `SKINS` and a name/description to `META` in `crewSkin.js`.
2. Add a `.ifc-prev-<name>` palette block in `crewSkin.css` §16 so its option in
   the chooser draws itself.
3. Write its rules under `:root[data-skin="<name>"]`, reading `--brand-*` first
   for anything it colours.

Nothing else changes: the chooser, the top-bar switch, persistence, the crew
record and the preview link are all driven off `SKINS`.

## Things it deliberately does not do

* **It does not touch Essential.** A VA that has never chosen renders
  byte-for-byte the crew center it had before this existed — no attribute
  matches, no rule applies. `tools/test-crew-interface.js` asserts this.
* **It does not fight a host page.** Framed with `?embed=1`, Aurora keeps its
  colours, depth and motion and gives back the page chrome that belongs to the
  host: no ambient canvas, no floating bar.
* **It does not move for a reader who asked it not to.** Every animation sits
  behind `prefers-reduced-motion: no-preference`, and the file ends by stilling
  everything else.
* **It does not spend blur it does not need.** `backdrop-filter` is costly and
  a dashboard can carry thirty cards; it is spent only where a reader sees
  through to something moving underneath — the top bar, the drawers, the
  scrims. Cards use a translucent fill and a shadow, which composite for free.

## Tests

```
node tools/test-crew-interface.js
```

Drives the real dashboard: that an untouched VA is unchanged, that the preview
link previews without persisting, that the chooser applies live and posts `ui`
to the crew record, that the top-bar switch is per-device and outranks the
crew default, that the cached default paints before the record lands, that a
brand palette beats the skin's, and that the module panels follow the page.
