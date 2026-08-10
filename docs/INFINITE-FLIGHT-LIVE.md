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
- **Connection** — pick the organization, set which aircraft the crew schedule
  pushes to, review the granted scopes, reconnect, disconnect.

Plus the bridge, both ways: **push** the crew center's published upcoming
departures onto an aircraft's rota, or **import** that rota into the crew center
as drafts.

A push never deletes anything in Infinite Flight, and an import never touches
seats, rank gates, publication status or bookings. See the *Infinite Flight
Live* section of the backend's `supabase/README.md` for why both of those are
structural rather than promises.

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

## Rows say how old they are

Every position on the board carries its own age, and a reading past fifteen
minutes is marked stale. A position of exactly `0,0` is treated as *"we have
never had one"* rather than as a spot in the Gulf of Guinea. Both decisions are
made on the backend (`ifLive.publicPosition`) so this file, the pilot board and
anything built later cannot disagree about them.
