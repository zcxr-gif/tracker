# Crew Center data — on somebody else's website

A virtual airline runs on its crew center. Routes are added there, pilots join
there, hours accrue there. The airline's public website then states the same
facts a second time — *twenty-three destinations*, *four hundred pilots* — typed
in by hand, and from that moment the two disagree. Every sector added widens the
gap, and it is always the website that is wrong, because it is the copy nobody
remembers to edit.

This is the fix, in two shapes. Both read the same public endpoints, neither
needs a key, and neither can change anything in the crew center.

| | **Embed** | **Direct** |
|---|---|---|
| What you paste | one `<iframe>` | one `<script>`, then your own markup |
| Whose design | ours, themed from the URL | entirely yours |
| Good for | a Wix/Carrd/Notion site, a sidebar, five minutes' work | a site somebody designed |
| Files | `embed-crew.html` | `crew-feed.js`, or the raw JSON |

Staff find both in the crew center under **Manage → Embeds**, pre-filled with
their own slug — including a live preview of the widget and their own endpoint
URLs. Nobody should have to read this document to get a widget.

---

## 1. The embed

```html
<iframe
  src="https://inflight.info/embed-crew.html?va=ocean-virtual&view=routes"
  style="width:100%;height:520px;border:0;border-radius:12px"
  loading="lazy"
  title="Ocean Virtual — Route network"></iframe>
```

`va` is the crew center's slug — the one already in the URL of the crew center
itself. There is no token: this widget reads nothing that is not already public,
and nothing that costs anybody money.

### Views

| `view` | Shows | Reads |
|---|---|---|
| `notices` *(default)* | The noticeboard | `/announcements` |
| `events` | The published events calendar | `/events` |
| `schedule` | The week's departures, grouped by day, with seats left | `/schedules` |
| `routes` | The route network — flight number, city pair, aircraft, distance | `/routes` |
| `stats` | The airline's figures as a tile grid | `/stats` |

### Parameters

Shared by every view:

| Param | Example | Notes |
|---|---|---|
| `va` | `ocean-virtual` | **Required.** The crew center slug. |
| `view` | `routes` | See the table above. Defaults to `notices`. |
| `limit` | `20` | Rows (or, for `stats`, tiles). 1–50. Per-view defaults: 20 for routes, 6 for stats, 8 elsewhere. |
| `name` | `Ocean%20Virtual` | Airline name in the header. |
| `title` | `Our%20network` | Overrides the whole header title. |
| `logo` | `https://…/logo.png` | https only. |
| `theme` | `light` | `dark` (default) or `light`. |
| `accent` | `%230b5fff` | Header colour, hex. Alias: `color`. |
| `radius` | `0` | Corner radius in px, 0–32. |
| `width` | `900` | Max content width in px. |
| `header` | `off` | Hides the header bar. |
| `powered` | `off` | Hides the "Powered by Inflight" line. |

`view=routes` adds:

| Param | Example | Notes |
|---|---|---|
| `kind` | `own` | `own` drops codeshares; `codeshare` keeps only those. |
| `aircraft` | `787` | Substring match on the aircraft name. |
| `sort` | `distance` | `distance` (longest first), `shortest`, `flight`, or the default airport-pair order. |

`view=stats` adds:

| Param | Example | Notes |
|---|---|---|
| `fields` | `pilots,hours,routesActive` | Which figures to show, in this order. Omit for whatever the crew center returned. |

Routes that staff have switched off never leave the crew center, and drafts
never reach an unauthenticated caller at all.

---

## 2. Direct — `crew-feed.js`

For a site that wants the airline's real figures in its own typography, on its
own grid.

```html
<script src="https://inflight.info/crew-feed.js" data-va="ocean-virtual"></script>
```

### Mark the page up

Write the page so it is already correct, then name the field that should replace
what is there:

```html
<p><b data-crew-stat="pilots">—</b> pilots · <b data-crew-stat="hours">—</b> hours</p>

<div data-crew-figure hidden>
  <b data-crew-stat="pireps"></b>
  <span>flights filed</span>
</div>

<section data-crew-when="flights30d">…only rendered once there are recent flights…</section>

<ul data-crew-list="routes" data-crew-limit="10">
  <template>
    <li><b>{{from}} → {{to}}</b> {{aircraft}} · {{distanceNm}} nm</li>
  </template>
</ul>
```

- `data-crew-stat` — replaced with the figure.
- `data-crew-figure` — the whole block is removed if its figure never arrives,
  so the page never carries a label with nothing under it.
- `data-crew-when` — removes a section that only makes sense once there is a
  figure at all.
- `data-crew-list` — `routes`, `events`, `schedule` or `notices`; the child
  `<template>` is repeated per row, with `{{field}}` placeholders. Every value
  is HTML-escaped on the way in.

### Or read it yourself

```js
const routes  = await CrewFeed.routes();            // [{ from, to, flight, aircraft, distanceNm, … }]
const own     = await CrewFeed.routes({ kind: 'own' });
const figures = await CrewFeed.stats();             // { pilots, hours, pireps, destinations, … }
const map     = await CrewFeed.network();           // routes with lat/lon + airports, for drawing
const soon    = await CrewFeed.events({ limit: 4 });
const flown   = await CrewFeed.events({ past: true });
const week    = await CrewFeed.schedule();
const board   = await CrewFeed.notices();
```

`CrewFeed.configure({ va })` sets the airline in JavaScript instead of on the
tag; `CrewFeed.refresh()` clears the per-page cache so the next call goes back to
the network.

### The two rules everything here follows

**Every reader resolves to `null` on any failure** — offline, slow, backend down,
VA not found — and never throws. `null` means *leave what is already on the
page*. This is what stops a website going blank because a fetch timed out, and it
is why nothing from this feed may be the only source of a section.

**Absent is not zero.** A figure the crew center did not send is one we did not
learn, so it is left out rather than printed as `0`. A made-up number in big
numerals next to true ones is worse than no number: it reads as authoritative.
A real `0` that the backend *did* send is a true answer and is shown — but a set
of figures that is *all* zeroes resolves to `null` instead, because a crew center
nobody has flown in yet has nothing to put on a homepage.

---

## 3. The endpoints

All public, all CORS-open (`Access-Control-Allow-Origin: *`), all plain GETs
against `https://site--indgo-backend--6dmjph8ltlhv.code.run`. Open one in a
browser tab to see exactly what a site will get.

| Endpoint | Returns |
|---|---|
| `/api/crew/<slug>/routes` | `{ routes: [{ id, flightNumber, origin, destination, aircraft, distanceNm, notes, active, kind, partnerName, minRank }], partners, ranks }` |
| `/api/crew/<slug>/route-map` | `{ routes: [{ …, o: [lat,lon], d: [lat,lon], mapped }], airports: [{ icao, lat, lon, dep, arr, routes }], stats: { unmapped } }` |
| `/api/crew/<slug>/stats` | `{ connected, stats: { pilots, pilotsActive, hours, flightHours, pirepsApproved, pirepsPending, flights30d, flightHours30d, landings, destinations, routesActive, lastFlightAt } }` |
| `/api/crew/<slug>/events` | `{ events: [{ title, description, origin, destination, aircraft, server, startsAt, slots, going, seatsLeft, bannerUrl, gateIcao, status }] }` |
| `/api/crew/<slug>/schedules` | `{ schedules: [{ flightNumber, origin, destination, departsAt, arrivesAt, aircraft, minRank, seatsLeft, full, status }] }` |
| `/api/crew/<slug>/announcements` | `{ announcements: [{ title, body, pinned, createdAt, status }] }` |

What an unauthenticated caller sees is exactly what the crew center already shows
the public: drafts are withheld by row-level security in the VA's own database,
not by the widget. `stats` answers `connected: false` for a VA that has not
attached a data store — which is a different sentence from "this airline has
flown nothing", and is why both the widget and `crew-feed.js` refuse to print
zeroes for it.

Figures are aggregated inside the airline's own database and returned as one
small object. Nothing here ever pulls a roster of people down to count them.

---

## 4. Which one to offer

Offer the embed first. It is one line, it is themeable, and it is finished in a
minute.

Offer the feed when a VA has a designed site and the embed would look like a
window cut into it — or when they want a fact of ours somewhere an iframe cannot
go: a headline, a page title, a count inside a sentence.
