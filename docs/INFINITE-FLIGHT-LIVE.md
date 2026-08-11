# Infinite Flight Live in the crew center

Infinite Flight's **PublicApi v3** exposes a VA's Live *organization* over
OAuth2: the aircraft they actually own, in fleet order, where each one last was,
and the rota of flights each aircraft is going to operate. `crewInfiniteFlight.js`
is that, inside the crew center.

Before this, a VA's fleet was visible only in the Live portal — which is not
somewhere a pilot goes to answer *"is 682XL back yet?"*, and not somewhere staff
can build a week from. The crew center already knows who everyone is and what the
airline is flying; the fleet was the piece it could not see.

> **The API is a preview.** Infinite Flight say its paths, fields, enum values,
> validation rules and rate limits may change before general availability. Two
> consequences show up in this file: nothing here maps an enum number to a word
> (the backend sends every enum already decoded, *including values it does not
> recognise*, so an unknown status renders as "Status 5" instead of throwing),
> and nothing here holds a token.

## Two surfaces, two audiences

| | staff panel | pilot board |
|---|---|---|
| mounted by | `crew-dashboard.html` | `crew-pilot.html` |
| opened with | `CrewIF.open()` | never — `renderBoard(el)` only |
| endpoints | `/if`, `/if/fleet`, `/if/aircraft/*`, `/if/schedules/*` | `/if/board`, and nothing else |
| can change anything | yes, with `schedules.manage` | no |

**Setting the fleet up is staff work; pilots use it.** That split is enforced in
three independent places, which is the point:

1. **The server.** Fleet and schedule endpoints require a staff or owner token —
   a pilot session is refused outright. Writes additionally require
   `schedules.manage`. Connecting the account and choosing the organization
   require the **owner**.
2. **The dashboard tile.** Gated on `schedules.manage`, like the Schedules tile,
   so a staff member without it is not offered a panel that would 403 on the
   first button.
3. **The pilot mount.** `CrewIF.mount({ boardOnly: true })` skips the status
   fetch entirely and makes `open()` a no-op — so a pilot page does not even
   *ask* a question it would collect a 403 for.

On top of all that sits a ceiling nobody here imposes: every call is made as the
one Infinite Flight user who pressed Connect, so Infinite Flight's own rules
apply — reads need membership of the organization, writes need owner or admin of
it. A crew center can never do more to a VA's Live organization than that person
could do by hand.

## Mounting it

```js
CrewIF.mount({
    backend: BACKEND,          // the crew backend
    slug: getSlug(),
    token: sessionToken,
    liveBase: 'https://…',     // optional — the ACARS/live-traffic service
    boardOnly: false,          // true on a pilot page
}).then(() => {
    CrewIF.renderBoard(document.getElementById('ifFleet'), { limit: 8 });
});
```

`renderBoard` paints **nothing** until its fetch lands, and nothing at all for a
crew center that has not connected an organization. That is deliberate and is
the same rule the quick-links board and the noticeboard follow: a grid that
renders empty and then fills reads as *"this VA has no aircraft"*, which is an
invented fact.

Both host pages hide the surrounding section when the board comes back empty, so
a VA without a Live organization carries no orphan heading.

## What the panel does

- **Fleet** — every aircraft with its fleet rank, whether it is in an active
  slot / storage / hangared, and its last stored position.
- **Schedules** — one aircraft's rota in sequence: add a leg, edit it, replace
  just its flight plan, move it (top / up / down), remove it. Legs the crew
  center already has a departure for are marked.
- **Utilisation** — which aeroplanes nobody is using. See below.
- **Connection** — pick the organization, set the sync, review the granted
  scopes, reconnect, disconnect.

Plus the bridge, both ways: **push** the crew center's published upcoming
departures onto an aircraft's rota, or **import** that rota into the crew center
as drafts.

A push never deletes anything in Infinite Flight, and an import never touches
seats, rank gates, publication status or bookings. See the *Infinite Flight
Live* section of the backend's `supabase/README.md` for why both of those are
structural rather than promises.

## Which aeroplane a departure is on

The crew center's schedule editor (`crewSchedule.js`) gains an **Aircraft
assigned** field — a specific airframe out of the VA's Live fleet, as opposed to
the free-text *Aircraft* field beside it, which is the type and livery and has
always been there. Pilots booking the leg are told which one they are on, in the
schedule row and in the departure's timeline.

The field is drawn **only** for a VA that has connected an organization with
aircraft in it. `/if/airframes` answers `200` with an empty list otherwise, so
the editor needs no special case: no connection means no field, and a schedule
form never has to understand the Live integration. The aeroplane a departure is
already on stays in the list even if it has since gone into storage — dropping
it would silently unassign the departure the moment somebody opened it to change
the time.

## The sync: two switches, two questions

| | says |
|---|---|
| assigning an aircraft to a departure | **which** aeroplane |
| the sync switch, on the Connection tab | **whether** we write to its real rota |

With the switch off, the aircraft is purely a label: pilots see the
registration, the Infinite Flight rota is untouched, and the manual **Push**
button still does what it always did. With it on, publishing a departure puts it
on that aircraft's rota, edits follow it, and cancelling or deleting it takes it
back off.

They are separate because assigning an aircraft is something staff do constantly
while building a week, and treating that as permission to start editing a live
fleet would be a surprise nobody asked for.

## Utilisation

One question a fleet board cannot answer by scrolling: **which of these
aeroplanes is nobody using?** An airframe unflown for three weeks that everyone
assumes somebody else is on is invisible in a rota read one aircraft at a time.

Per aircraft: legs booked, block hours scheduled, next departure, and how long
since it last flew. Sorted so the thing to act on is first — never-flown above
long-idle.

Three things it will not do, and each is the "don't invent" rule again:

- An aircraft whose rota **could not be read** shows *"Not read"*, never
  *"nothing scheduled"*.
- **Only an actual arrival counts as flown.** A past schedule nobody flew is a
  plan, not evidence.
- **In storage is not idle** — that is a decision somebody made.

It costs one call per aircraft, so it is its own tab loaded on demand rather
than part of the fleet board's refresh, and the result is kept until you press
Refresh.

## Times are Zulu

Every time field in this API is named `…Utc` and means it. The forms feed
`<input type="datetime-local">` **UTC parts** and label the field UTC, rather
than binding it to the browser's timezone — a VA scheduling 18:30Z types 18:30.
Binding it locally would silently move every departure by the reader's offset,
and the reader would have no way to tell.

## "Flying now"

The stored position is explicitly the *last persisted* state and can be stale.
The v3 docs say what to do about that: compare the aircraft id against the v2
multiplayer feed. `liveBase` points at the tracker's live-flights service, which
already polls that feed, so `POST /api/live/aircraft-active` answers from a cache
rather than costing anyone a rate limit.

It is strictly a bonus. Without `liveBase` — or with the service down — the
board simply never shows a green dot, and a board without green dots is still a
board. Nothing waits on it.

## Every aircraft has a picture

`crewAircraftImage.js`, and the design is inverted from the usual: it starts
with the image that **cannot fail** and upgrades from there, rather than
starting with the good one and falling back.

| tier | what | can it fail? |
|---|---|---|
| 3 | a silhouette drawn inline as an SVG data URI | **no** — nothing to fetch |
| 2 | the right silhouette for the type (a 747 is not an A320) | no |
| 1 | a real photo of the airframe, by registration, from Planespotters | yes, and it's never waited on |

That inversion is why there is no loading flicker, no layout shift and no
broken-image glyph: the `<img>` is born with a valid `src` and is only ever
*replaced*, never emptied. `onerror` restores the silhouette, so even a photo
URL that 404s later leaves a picture behind.

A hole in a fleet board reads as "this VA's data is wrong", and the aircraft it
lands on is usually the interesting one — the obscure registrations a VA
invented for itself are exactly the ones with no photo on file. So a missing
photo is not allowed to be visible as a miss.

Tint is derived from the registration, so an airframe keeps the same tile across
reloads and across pilots. The type name comes from the backend, which resolves
the Live `aircraftId` UUID against the same aircraft/livery catalogue live
flights use — and when that resolution fails, the generic silhouette still
renders.

> The vendored `vendor/aircraft-shapes` planforms are deliberately **not** used
> here. They are GPL-3.0 and are rasterised into a canvas atlas built for map
> markers at device resolution; reusing them would mean either loading that
> machinery on a page with no map, or fetching SVGs over the network — which
> puts a failure mode back into the one place this module exists to remove it.

## Panels must never open blank

Reported as *"the window doesn't load, the whole page just goes white"* — black
inside the app's overlay.

That symptom is not an empty panel; an empty panel still leaves the dashboard
visible behind it. It is the **scroll lock left on**. Opening a sheet sets
`position:fixed; top:-<scrollY>px` on the body, which collapses the document to
nothing. If the render then throws, the lock is never released and what remains
is the page background under an empty sheet — no content, no error, nothing to
click, Escape the only way out.

`crewPanels.js` carries a safety net for this, but a net is a last resort. So
every render path in the Live panel now paints an honest failure instead of
nothing:

- `render()` catches a throwing view and shows a message the reader can act on
- `paintBoard()` fails to an *empty host*, which both host pages already treat
  as "nothing to show" — an exception escaping there would abort the rest of the
  host page's boot, not just blank a board
- the icon pass and the photo upgrade are each isolated, because a missing
  lucide glyph or a network hiccup must not take a panel down

**`npm run test:panels`** proves it in real Chromium. Seven ways of breaking the
backend — 500, HTML instead of JSON, an expired grant, an old schema, a response
shaped like nothing the panel has seen, follow-up calls failing, plus a healthy
control — and for each one it asserts the same three things: the body is not
empty, the page is not left scroll-locked, and the panel still closes. It skips
cleanly where there is no Chromium.

The harness was checked by deliberately breaking a view and confirming it
*fails* — a test for a blank screen that cannot detect a blank screen is worth
nothing.

## Rows say how old they are

Every position on the board carries its own age, and a reading past fifteen
minutes is marked stale. A position of exactly `0,0` is treated as *"we have
never had one"* rather than as a spot in the Gulf of Guinea. Both decisions are
made on the backend (`ifLive.publicPosition`) so this file, the pilot board and
anything built later cannot disagree about them.
