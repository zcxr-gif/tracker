# The shop, the card, and Inflight Pay

A virtual airline has one thing to give a pilot for flying: hours. They go up,
and they are never spent on anything. Every VA that has wanted more than that
has built the same thing by hand — a points spreadsheet, a Discord channel of
shop screenshots, and a staff member subtracting numbers by hand when somebody
redeems something. It works for about a month.

So the crew center offers it properly. It is **off** until an owner turns it on,
and a VA that never does sees no trace of it: no tile, no card, no settings tab.

## The three parts

### 1. Earning — PIREPs, and nothing else

Points come from approved flight reports. A PIREP is already the unit of work
this product is built around: it is reviewed, it cannot be filed twice, and
approving it is a deliberate act by a staff member. That makes it the only
honest supply of a currency.

There is deliberately **no "give Rae 500 points" button**. A second, unaudited
supply is how every hand-rolled VA economy has ended up in an argument.

Staff set four numbers, and the server does the arithmetic when it approves a
flight:

| Rate | What it does |
|---|---|
| `perHour` | The main one. A 2-hour flight pays twice this. |
| `perLanding` | For airlines flying short legs. |
| `fleetBonus` | Added when the aircraft is one of the VA's own. |
| `violationPenalty` | Taken off per violation on the flight. |

Under the four inputs is one line of live arithmetic — *"A 2h 15m flight in one
of your own aircraft pays 325 mi when you approve it"* — which updates as the
rates are typed. It is the only thing that makes `perHour: 120` mean anything.

Each VA names its own currency (Miles, Credits, SkyCoins); nothing in the UI
says "points" in a string a pilot reads.

### 2. The card

Every pilot has one: their name, their callsign, their rank, their airline's
colours and mark, and their balance. It is deliberately the most finished
object in the crew center, because it is the thing a pilot screenshots into
their VA's Discord — and that screenshot is the only advertising this feature
will ever get.

It appears at three sizes (the pilot's home page, the shop's hero, the Inflight
Pay sheet) and is **one design at all three**: every size on the face is in
`cqi`, a percentage of the card's own width, so it scales like the object it is
imitating instead of relaxing into a different layout at each size. The face is
built from the VA's accent rather than the page's tokens, so a card looks the
same at midnight as at noon.

The card number is the server's where it issues one, and otherwise derived from
the pilot's own id — stable, theirs, and a membership number rather than an
account that holds money. The balance is the balance, and it lives in the VA's
database.

### 3. Inflight Pay

Buying something is a sheet that comes up over the shop with the card on it, the
amount, what is left afterwards, and one control you **hold** for a moment.

The hold is not a security measure — the server is the only thing that can
actually spend a balance. It is that spending something you flew twenty hours
for should take a moment longer than dismissing a cookie banner, and that a
press which fills a ring tells you what is about to happen while you can still
change your mind. Let go early and it empties. `tools/test-crew-shop.js` asserts
that a click, a slip and a half-press all spend nothing.

Then: a tick, the amount, the new balance, and the code the pilot shows their
staff to collect it.

## What the browser is not allowed to do

**Never compute a balance it then trusts, and never decide whether a pilot can
afford something.** It asks; the server debits, checks the stock and the
per-pilot limit inside one statement in the VA's own database, and answers with
the new balance. This client renders that answer — the test proves it by having
the mock reply with a number that is *not* `balance - price`.

The "1,380 mi short" label on a shelf is a courtesy, not a gate.

## Files

| | |
|---|---|
| `crewShop.js` | All of it: the shelf, the card, Inflight Pay, the orders queue and the back office. |
| `docs/CREW-SHOP.md` | This. |
| `tools/test-crew-shop.js` | 30 checks against the real dashboard. |

Wired into `crew-dashboard.html` (the Shop tile, and the `shop` flag off the VA
record) and `crew-pilot.html` (the card on the page, and the tile). It is built
on `crewPanels.js` like every other module, so it follows whichever of the crew
center's two interfaces is on — see `docs/CREW-INTERFACES.md`.

## The backend

Implemented in the database repo. Until a VA's database has it, every call
answers 409 with a `*_missing` code, which `CrewPanels.isSchemaGap` already
recognises — so a VA on an older schema is told to update it, with the button
that does it, rather than shown a broken shop.

```
GET    /api/crew/<slug>/shop            settings, items, and the caller's wallet
POST   /api/crew/<slug>/shop/settings   staff: { enabled, currency, earn }
POST   /api/crew/<slug>/shop/items      staff: one item
PATCH  /api/crew/<slug>/shop/items/<id> staff
DELETE /api/crew/<slug>/shop/items/<id> staff
GET    /api/crew/<slug>/shop/orders     staff: everyone's. Pilot: their own.
POST   /api/crew/<slug>/shop/orders     { itemId } → { order, wallet }
PATCH  /api/crew/<slug>/shop/orders/<id> staff: { action: 'fulfil' | 'cancel' }
```

`GET /api/va-ads/by-slug/<slug>` carries `shop: { enabled }` so the dashboard
knows whether to draw the tile without asking for the whole shop on every page
load.

Server-side rules the client depends on:

* `POST /shop/orders` is the only thing that moves a balance. It must re-check
  the price, the stock and `limitPerPilot`, and debit in the same statement.
* Approving a PIREP credits it once. Re-approving an already-approved flight
  must not pay twice, and changing the rate must not re-price history.
* Cancelling an order refunds it; deleting an item leaves existing orders alone.

## Tests

```
node tools/test-crew-shop.js
```

Covers: a VA with no shop has no tile; the one screen that switches it on; the
shelf's three states (buy / how short / sold out); that a click, a slip and a
half-press spend nothing while a held press pays exactly once; that the balance
shown afterwards is the server's; the back office and its live worked example;
and that an out-of-date database is told to update rather than shown an error.
