# Crew Center on a VA's own website

Everything a VA's crew center holds — the network, the pilots, the week, the
events, the noticeboard and the headline figures — is readable from that VA's
own website, either as a drop-in widget or as plain JSON.

Two audiences:

- **A VA that wants it to look like their crew center** pastes an `<iframe>`.
  The Embeds tile in the crew center (Manage → Embeds) fills the snippet in
  with their own slug, name and brand colour, and previews the real widget.
- **A VA with a designer, a CMS or a Discord bot** calls the JSON endpoints
  below and renders it themselves.

Both read the same rows through the same rules, which is the point: a route on
the VA's homepage and the same route in their crew center are the same route or
one of the two is lying.

---

## 1. The widgets — `embed-crew.html`

```
https://inflight.info/embed-crew.html?va=<slug>&view=<view>
```

`<slug>` is the crew center's address — the `oceanic` in
`inflight.info/crew/oceanic`. No token, no session: this reads nothing a
visitor to the crew center could not already read.

| `view`     | Shows                                                      | Reads |
|------------|------------------------------------------------------------|-------|
| `notices`  | The noticeboard — staff notices, joins, promotions          | `/announcements` |
| `events`   | Published events, with cancelled ones still on the board    | `/events` |
| `schedule` | Published departures, grouped by day, with seats left       | `/schedules` |
| `routes`   | The route network, codeshares marked                        | `/routes` |
| `pilots`   | The roster — name, callsign, rank, hours                    | `/roster` |
| `stats`    | Pilots, flights (30d), hours, routes, flight reports        | `/stats` |

`roster`, `network`, `figures` and `numbers` are accepted as aliases for
`pilots`, `routes` and `stats`, because those are what the crew center calls
those panels.

### Appearance

Every one of these is optional.

| Param    | Example        | Notes |
|----------|----------------|-------|
| `name`   | `Ocean%20Virtual` | Prefixes the heading. |
| `title`  | `Our%20network`   | Replaces the heading outright. |
| `logo`   | `https://…/l.png` | Shown in the header bar. `https:` only. |
| `theme`  | `light`           | `dark` (default) or `light`. |
| `accent` | `%230B5FFF`       | Header colour and highlight. Alias: `color`. |
| `header` | `off`             | Hides the header bar. |
| `limit`  | `10`              | Rows to draw, 1–50. Ignored by `stats`. |
| `sort`   | `hours`           | `pilots` only — most hours first. Default is roster order. |
| `radius` | `0`               | Corner radius in px, 0–32. |
| `width`  | `520`             | Max width in px, 240–1600. |
| `powered`| `off`             | Hides the "Powered by Inflight" line. |

### The iframe

```html
<iframe
  src="https://inflight.info/embed-crew.html?va=oceanic&view=routes&theme=light&limit=12"
  style="width:100%;height:520px;border:0;border-radius:12px"
  loading="lazy"
  title="Ocean Virtual — Route network"></iframe>
```

It loads no font, no framework and no image from anywhere, and makes exactly
one network call — the one to the API. Height is yours to set; the widget fills
whatever width it is given and restacks its rows below ~480px.

---

## 2. The data — public JSON

```
GET https://site--indgo-backend--6dmjph8ltlhv.code.run/api/crew/<slug>/<feed>
```

No key, no session, CORS-open. Each answers with one named array (or, for
`stats`, one object), so `d.routes`, `d.roster`, `d.stats` and so on.

Times are ISO-8601 in UTC — render them in the reader's own zone. **A field we
have no value for is absent, not zero.** Treat a missing figure as unknown and
draw nothing; a `0` you invented is read by a pilot as a fact about their
airline.

### `/routes` → `{ "routes": [...], "partners": [...], "ranks": [...] }`

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable. |
| `flightNumber` | string | May be blank. |
| `origin`, `destination` | string | ICAO. |
| `aircraft` | string | Free text — whatever the VA typed. |
| `distanceNm` | number | Great-circle nautical miles; `0` when not set. |
| `notes` | string | |
| `active` | boolean | **`false` means draft.** See below. |
| `kind` | string | `own` or `codeshare`. |
| `partnerName`, `partnerLogo` | string | Codeshares only. |
| `minRank` | string | The rank this route opens at, if it is gated. |

`partners` groups the codeshare legs one entry per partner airline
(`name`, `logo`, `routes`, `destinations`), so a network summary and a route
list cannot disagree about how many legs a partner has.

> **Which routes are published.** A route is on the network unless it has been
> parked as a draft — that is, unless `active` is exactly `false`. A row that
> omits the field is published. Every surface applies this one rule: the staff
> route panel, the pilot's network panel, the route map, the event and schedule
> route pickers, and the widgets above. If you render this feed yourself, apply
> it too, or your site will show your pilots a leg the crew center does not.

### `/roster` → `{ "roster": [...] }`

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `name`, `callsign` | string | |
| `hours` | number | To one decimal. Round it for a headline. |
| `rank` | string or object | An object carries `name`, `color`, `icon`, `image`. |
| `role` | string | Their staff role, if any. |
| `status` | string | `active`, `loa`, `inactive`. |
| `aircraft` | string[] | What they are typed on. |

### `/stats` → `{ "stats": { … } }`

| Field | Means |
|---|---|
| `pilots` | Pilots on the roster |
| `pilotsActive` | …of whom this many are active |
| `flights30d` | Flights in the last 30 days |
| `flightHours30d` | Hours in the last 30 days |
| `hours` | Hours logged, all time |
| `flightHours` | …of which this many came from flight reports |
| `routes` | Routes on the network |
| `destinations` | Airports the network touches |
| `pirepsApproved` | Flight reports approved |
| `pirepsPending` | Flight reports awaiting review |
| `applicationsPending` | Applications awaiting review |

The `stats` widget draws the first seven. `pirepsPending` and
`applicationsPending` are staff to-do counts rather than achievements — "3
applications awaiting review" on a public homepage is a fact about the staff's
inbox — so they are in the feed for a VA that wants them and not in the widget.

### `/schedules` → `{ "schedules": [...] }`

`flightNumber`, `origin`, `destination`, `aircraft`, `departsAt`, `arrivesAt`,
`blockMinutes`, `seats`, `booked`, `seatsLeft`, `full`, `minRank`, `notes`,
`status` (`published` / `cancelled`), `routeId`.

### `/events` → `{ "events": [...] }`

`title`, `description`, `startsAt`, `origin`, `destination`, `aircraft`,
`going`, `minRank`, `status` (`published` / `cancelled`).

### `/announcements` → `{ "announcements": [...] }`

`title`, `body`, `kind` (`notice`, `join`, `promotion`, …), `pinned`,
`authorName`, `createdAt`.

### Drafts

Unauthenticated callers never see a draft: rows carrying `status: "draft"` are
withheld by row-level security in the VA's own database, and the widgets filter
for it again on the way in. Build the same guard into anything you write —
`status !== "draft" && active !== false` — so a change at either end cannot
publish somebody's working copy onto their homepage.

---

## 3. Live flights

The other widget — airborne pilots, as a list or on a map — is `embed.html` and
is documented in [`../EMBED.md`](../EMBED.md) and
[`EMBED-BACKEND.md`](EMBED-BACKEND.md). It reads live Infinite Flight data
rather than the crew center, which is why it is a separate page with its own
token.
