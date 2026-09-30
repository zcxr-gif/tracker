# The airline's own look

Every VA used to get the same crew centre with its logo in the corner. There are
now four ways for a VA's own design to go up in it. All are edited in one place,
the **Design studio** tile (needs `settings.branding`). The front end is
`crewDesign.js` and `crewAirline.js`; the backend is `crewDesign.js` and
`crewDesignRoutes.js` in the database repo.

## 1. Artwork showcase

Upload liveries, posters, wallpapers and banners: drag them in, or paste an
https link to a picture hosted elsewhere. Each picture has a title, a kind, the
artist's name and an optional link back to the artist.

- Pictures marked **In showcase** rotate on the dashboard and on every pilot's
  home.
- The artist is credited on every slide, and clicking a slide opens a
  full-screen gallery.
- Portrait posters are shown whole over a blurred copy of themselves rather than
  cropped.
- A crew centre holds up to 60 pictures, re-encoded to WebP with the long edge
  capped at 2400px.
- Removing a picture also removes it from everywhere it's placed (hero,
  backdrop, covers). Only pictures this feature uploaded are deleted from
  storage; a linked picture is never touched.

## 2. Section artwork

*Placement* tab:

- **Hero:** replaces the directory banner behind the dashboard's airline card
  and across the top of the pilot home. The directory listing keeps its own
  banner.
- **Page backdrop:** a faint picture behind the whole crew centre, with a
  strength slider.
- **Section covers:** a picture on any tile (Routes, Events, Fleet,
  Schedules, Tours…) on both the dashboard and the pilot home.

## 3. Theme file

*Theme* tab:

- Colours for light and dark mode (ten tokens each).
- Body and heading fonts (Google Fonts names).
- Corner radius, an accent gradient, and whether the crew centre opens in
  light, dark or the reader's own choice.
- **Custom CSS.**

**Download theme** gives the designer `<slug>.crewtheme.json`: colours, fonts,
CSS, picture placement and the interface in one file. **Upload theme…** reads it
back. It shows a preview first ("it sets light colours, custom CSS…"). A plain
`.css` file goes straight into the CSS editor.

### What custom CSS can and can't do

It's cleaned on the server (`sanitizeCss`) by a tokenizer, not a regex. It keeps
style rules, `@media`, `@supports`, `@keyframes` and `@font-face` with an https
source. It removes:

- `@import`, `@namespace`, `@charset`
- any `url()` that isn't https (including `data:`, `javascript:` and `//host`)
- `expression()`, `behavior` and `-moz-binding`
- any HTML

Every selector is prefixed with `html[data-crew-css]`, so the sheet only applies
to crew pages and overrides the stock styles without `!important`. The editor
lists anything that was removed. Size limit: 24 KB.

## 4. The Airline interface

A third interface next to Essential and Aurora. An owner picks it for the whole
crew in the studio's *Interface* tab (or in Settings → Appearance). Any reader
can still switch for themselves from the top bar.

- **The livery everywhere:** the top bar, the airline card and the pilot hero
  are painted in the VA's accent. Every card gets a cheatline stripe, labels use
  airport signage type, and tiles look like wayfinding signs.
- **Departures board:** the next scheduled departures on an amber split-flap
  board, with time, flight, from, to, gate (taken from the route) and status
  (BOARDING within 45 minutes, FULL, CANCELLED, DEPARTED). A VA with no
  published schedule gets its route network on the board instead.
- **Boarding pass:** the pilot's own next booked departure. It shows from and
  to, flight, date, boarding time, departure time, gate and aircraft, with a
  stub and a barcode. With nothing booked, it offers "Book a flight".
- **Crew ID card:** the airline's livery and logo, with the pilot's name, rank,
  callsign, hours and a barcode made from their member number.

All three use data the crew centre already has (`/schedules`, `/routes`,
`/me/badges`). They are only fetched while the Airline interface is on.

## Also fixed: layouts that stretched

Every desktop layout except editorial ran one block down several grid rows: the
console tool rail, the split map, the classic stats sidebar, and the Instagram
wall. A grid row is as tall as its tallest item, so everything beside those
blocks stretched to match. The live map reached about 2,650px, the stats strip
1,260px, and the event card was 600px tall around 85px of content.

Layouts are now column stacks (`LAYOUT_COLUMNS` / `arrangeGrid()` in
`crew-dashboard.html`), and each column is only as tall as its own contents.

- The live map has a fixed height.
- The console tool rail is a compact list that scrolls within itself.
- Phones use the same code as a single column, so a new block is placed in one
  list per layout instead of eight area maps.

## Endpoints

```
GET    /api/crew/<slug>/design           settings.branding: { theme, art, artwork, ui, limits }
PUT    /api/crew/<slug>/design           { theme?, art?, ui? }  → + dropped[]
POST   /api/crew/<slug>/design/import    { file, dryRun? }
GET    /api/crew/<slug>/design/export    <slug>.crewtheme.json
POST   /api/crew/<slug>/artwork          multipart image + title, kind, credit, creditUrl, featured
POST   /api/crew/<slug>/artwork/link     { url, title, kind, credit }
PATCH  /api/crew/<slug>/artwork/<id>
DELETE /api/crew/<slug>/artwork/<id>
PUT    /api/crew/<slug>/artwork/order    { ids }
```

`/api/va-ads/by-slug/<slug>` now also returns `theme` (null when unset), `art`,
`artwork` and `ui`. The `ui` value sent by the settings screen is now stored;
before this, nothing saved it.

## Tests

- `npm run test:design` (this repo): layouts, showcase, covers, CSS, the
  Airline interface and the studio, against the real pages.
- `npm run test:design` (database repo): the CSS sanitiser against hostile
  input, the theme file round trip, and the artwork library.
