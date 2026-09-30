# Codeshares, tours & challenges, hubs and exports

Four things that grow a VA's network beyond its own aircraft. The screens are
in this repo (`crewCodeshare.js`, `crewGoals.js`); the rules and the endpoints
are in the database repo (`crewCodeshare.js`, `crewGoals.js`,
`crewNetworkRoutes.js`).

## 1. Codeshares between crew centres

A codeshare used to be something a VA typed in: the partner's name forty times,
the logo URL forty times, and a stale copy the day the partner renumbered a
flight. Both airlines are on this platform, so the agreement is made here.

**Asking.** Routes → **Codeshare partners** → *Find a partner*. Pick an airline,
then:

1. tick which of **their** routes you want to sell — or *All of them*, which
   keeps up as they add routes;
2. optionally offer some or all of **yours** back;
3. write a line to their staff, and send.

The request lands in their crew centre (a badge on the same button) and in their
Discord route feed.

**Answering.** The airline that was asked opens *Review & accept*. Both pickers
start from what was asked. They can untick any of their own routes, and choose
which of the offered routes to sell in return (or none — a codeshare can be
one-way). Then accept or decline.

**On accept**, each side's chosen legs are written into the *other* side's own
database as codeshares, with the partner's name and logo filled in. Each copy is
linked back to the route it came from (`crew_routes.partner_slug` and
`source_route_id`, schema v23).

**From then on:**

| When | What happens |
|---|---|
| The partner edits a shared route | About 20 seconds later your copy follows: new number, aircraft, distance. Your rank gate, notes, gates and draft/published state are **yours** and are never overwritten. |
| The partner adds a route | You get it too, if you chose *All of them*. |
| The partner drops a route | Your copy is removed. |
| Either side changes its half | *Choose routes* on the agreement: you change what you sell of theirs, and what you allow them to sell of yours. Nothing can widen past what the other side allows. |
| Either side ends it | Every copy leaves both networks. A codeshare somebody typed in by hand is never touched. |

**Never shared:** a draft route, or a codeshare of a codeshare. That would be a
third airline's route, and it isn't yours to hand on.

**Older databases (before v23).** Syncing still works, matching on flight number
and airports. Nothing is ever *deleted* on those projects, because a copy can't
be told apart from a hand-typed codeshare with the same partner name. The panel
says how many rows are waiting, and offers the database update.

**Switching it off.** *Let other airlines ask us* removes the VA from the partner
search. Agreements it already has carry on.

## 2. Tours & challenges

- **Tour:** a journey of legs, e.g. "the Silk Road in seven sectors".
  - In order (the default) or in any order.
  - Optional start and end dates.
  - Optional aircraft per leg, and an optional minimum rank.
  - Staff type it as a routing (`EGLL LFPG EDDF LIRF` becomes three legs) or add
    legs from the network.
- **Challenge:** a figure to reach, e.g. "50 hours out of the hub in March".
  - Measured in flights, hours, distance, landings or different airports.
  - For each pilot (with a leaderboard), or for the whole crew as one shared bar.
  - Optional filters: airport (either end), origin, destination, aircraft, or
    own/codeshare routes only.

**Nothing is marked by hand.** Progress is worked out from **approved** flights
on every read, the same way awards are. A pending or rejected report never
counts, and a flight outside the dates counts for nothing.

**Finished tours and personal challenges are awards.** They appear on the
awards shelf and in the badge row with everything else. A pilot's page shows the
tour they're part-way through, with the next leg called out.

The definitions live on the VA record alongside the rank ladder, so **no
database update is needed** to use them. Staff with `events.manage` create and
edit them; publishing one posts to the Discord events feed.

## 3. Hubs

Routes → **Hubs**. Declare hubs and focus cities; tap a busy airport to add it.
The public feed (`CrewFeed.hubs()`), the map and hosted sites use declared hubs
ahead of the old guess (the airports with the most routes). A VA that declares
none keeps the guess.

## 4. Exports

From the CSV dialog, or by ticking routes in the list (*Select*):

| Export | What's in it |
|---|---|
| Whole network | Every route |
| Own / codeshares only | One kind of route |
| One partner | Codeshares with one airline |
| Selected | Exactly the routes you ticked |
| **Combined sheet** | Every airline in one file, with an `operator` column first |

The combined sheet imports straight back: the import reads the `operator`
column, puts your own name's rows into your own network, and turns everyone
else's into codeshares. It also accepts `airline`, `carrier`, `operated by` and
`operating airline` as the column name.

From the codeshare panel you can also download a partner's own shareable
network as a codeshare-ready CSV.

## The endpoints

```
GET    /api/crew/<slug>/codeshare                   staff: { agreements, open, incoming, schemaLinks, me }
POST   /api/crew/<slug>/codeshare                   { partner, take, offer, message }
POST   /api/crew/<slug>/codeshare/settings          { open }
GET    /api/crew/<slug>/codeshare/directory?q=      { airlines: [{ slug, name, …, standing }] }
GET    /api/crew/<slug>/codeshare/network/<partner>  their shareable legs (?format=csv)
POST   /api/crew/<slug>/codeshare/<id>/accept       { offer, take, reply }
POST   /api/crew/<slug>/codeshare/<id>/decline      { reply }
POST   /api/crew/<slug>/codeshare/<id>/withdraw
PATCH  /api/crew/<slug>/codeshare/<id>              { take?, offer? }
POST   /api/crew/<slug>/codeshare/<id>/sync
POST   /api/crew/<slug>/codeshare/<id>/end          { keepRoutes? }

GET    /api/crew/<slug>/goals                       { tours, challenges, canManage, signedIn }
GET    /api/crew/<slug>/goals/<id>                  one, with the full leaderboard
POST   /api/crew/<slug>/tours | /challenges         events.manage
PATCH  /api/crew/<slug>/tours/<id> | /challenges/<id>
DELETE /api/crew/<slug>/tours/<id> | /challenges/<id>

GET    /api/crew/<slug>/hubs                        public
PUT    /api/crew/<slug>/hubs                        routes.manage: { hubs: [{ icao, name, kind }] }

GET    /api/crew/<slug>/routes.csv?scope=&partner=&ids=&combined=
POST   /api/crew/<slug>/routes/export               { scope, partner, ids, combined, layout, id }
```

A selection is `{ mode: 'all' | 'selected' | 'none', routeIds }`.

## Tests

- `npm run test:codeshare` (this repo) drives the real dashboard and pilot page.
- `npm run test:codeshare` and `npm run test:goals` in the database repo cover
  the rules and run the full request → accept → follow → end flow against two
  in-memory airlines.
