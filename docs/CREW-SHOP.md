# The shop, the card, and Inflight Pay

A virtual airline has one thing to give a pilot for flying: hours. They go up,
and they are never spent on anything. Every VA that has wanted more than that
has built the same thing by hand — a points spreadsheet, a Discord channel of
shop screenshots, and a staff member subtracting numbers by hand when somebody
redeems something. It works for about a month.

So the crew center offers it properly. It is **off** until an owner turns it on,
and a VA that never does sees no trace of it: no tile, no card, no settings tab.

## The parts

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

#### Events pay, and they pay through the flight

Every VA wants its group flights to be worth turning up to, and the obvious way
to arrange that — a button that hands out points for attendance — is exactly the
second supply the rule above exists to prevent. Somebody would have to decide
who attended, nothing would audit it, and the first argument about it would be
the last day anybody trusted the balance.

So an event pays like everything else pays: **`eventBonus`, added when the
flight report filed for that event is approved.** Signing up and not flying pays
nothing, which is also the honest answer. It is a fifth rate beside the four
above, and the worked example prices both flights:

> A 2h 15m flight in one of your own aircraft pays **325 mi** when you approve
> it, or **575 mi** if it was flown for an event.

An individual event can name its own figure, because a transcontinental
group flight is worth more than a routine fly-in and an airline that cannot say
so pays the same for both. The field appears in the event editor **only when the
VA runs a shop**, defaults to the standing bonus, and an empty box means "use
it" rather than "pay nothing".

Pilots see it in two places and in two lengths. On the calendar card, a chip:
`+900 mi` — because somebody scrolling on a Friday night is choosing between
this and nothing. In the brief, the whole sentence, because that is where there
is room for the condition:

> Flying this pays **900 mi** on top of the usual rate — added when your flight
> report for it is approved.

A VA with no shop sees none of it: no chip, no note, no field, no empty `+0`.
The server's silence — no `currency` on `GET /events` — is what decides that.

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

Then: a tick, the amount, the new balance, and — depending on how the item is
delivered — either what they just bought, or the code they show their staff.

### 4. Claiming it yourself

The shop shipped with one ending: a code, and a staff member who reads it and
does the thing. That is right for "name a route" and wrong for everything a VA
could simply hand over on the spot — a Discord invite, a livery link, a form, a
key from a list they bought once. Waiting on a human for those turns a shop into
a ticket queue, and it is the queue that quietly kills the economy: a pilot who
waits three days for the thing they saved twenty hours for does not save for a
second one.

So an item says how it is delivered, and two of the three need nobody:

| `delivery` | What happens when somebody buys it |
|---|---|
| `staff` | The original. The order joins the queue with a code; staff mark it delivered. |
| `instant` | The item carries `reward` — written once, handed to every buyer. |
| `codes` | The VA pastes a list; the server pops the next unused one per purchase. |

The tile says **Instant** before a pilot spends anything, and the Inflight Pay
sheet says *"Yours the moment this goes through"* rather than *"Your staff get
the order"*. What comes back is selectable, has a copy button, has any link in
it made tappable through the same `safeUrl` rule as everything else in the crew
center — and **stays on the order for ever**. A reward you can only read once is
a support request waiting to happen, and "I closed the box" must not cost
somebody twenty hours of flying.

The client never decides any of this. It renders whatever the order comes back
carrying: the server pops the code and fulfils the order **inside the same
statement that debits the balance**, or none of it happens. Two pilots pressing
Buy on the last key is the case that has to be impossible, not unlikely.

Codes are **added, never replaced**. The box in the back office holds what is
being pasted in now; the list already in the database has had half of it handed
out, and a save that sent the whole list would either re-issue those or throw
the rest away. The item row shows how many are unused and carries an
**Out of codes** chip at zero — the one failure that turns a shop into a shop
that takes points and gives nothing back.

### 5. Saving for one thing

A balance on its own is a score. A balance with a bar under it and the name of
the thing beside it is a reason to file another flight, which is the only reason
to pay pilots for flying in the first place.

A pilot pins one shelf item — from the tile, where the wanting happens, not from
a screen they would have to go and find — and the card grows a line beside it:
the name, a bar, and *"5,520 mi to go · 69%"*. It is kept on the wallet rather
than in the browser, because pilots file flights on a phone and read their card
on a laptop, and a goal that only exists on one of them is a goal that keeps
disappearing.

The pin is only offered on something they cannot afford yet. Saving for a thing
already in your pocket is not a goal, it is a note to go and press Buy. A goal
pointing at an item that has since come off the shelf quietly stops existing
rather than reporting an error.

### 6. Sections, and things that are only true this week

Two small shelf features that a VA with twenty items needs and a VA with four
does not, so both are opt-in and invisible until used.

**Sections.** An item can carry a `group`. Give two or more items one and the
shelf splits into headed rows; leave them all empty and it is the same single
grid it always was. Whatever is left ungrouped collects under a heading at the
*end* — a VA who has sorted half their shelf has not thereby said the other half
comes first. Anything added from the suggested catalogue arrives in the section
it was offered under rather than in a heap.

**Offers.** An item can carry a `salePrice` and a `saleEndsAt`, and separately
an `availableUntil` after which it leaves the shelf. The tile shows the offer
with the old price struck through beside it and counts down — *Ends in 3 days* —
and both dates run to the end of the day the VA picks, because a deal that
expires at midnight on the morning of the day it names is a bug report.

One function decides which of the two prices is in force, so the tile, the
shortfall label, the Inflight Pay sheet and the saving-for bar cannot quote
different numbers at each other. And it is a **courtesy, not a gate**: the
server re-prices every order, so a device whose clock is a day fast cannot buy
last week's sale. An "offer" that is not cheaper than the price is a typo and
is refused in the form, because two price fields is exactly the shape of mistake
that puts a whole shelf on the house.

## What a virtual airline actually sells

The form was never the hard part. The hard part is the blank page: there is no
warehouse, nothing ships, and a pilot who has flown forty hours cannot be handed
anything physical. "What do I even sell" is where a VA stopped, and a shop
nobody stocks is a feature nobody uses.

So the back office offers **twelve things a VA can really give a pilot**, under
the shelf. Tap one and it becomes an ordinary item they own, edit and price like
any other — there is no trace afterwards of it having come from a catalogue,
because a suggestion that stayed special would be a second kind of shelf item to
reason about forever.

| Shelf | What is on it |
|---|---|
| Identity | a profile badge, your own callsign, a tail number of your choosing |
| The network | name a route, request a livery, open a new destination |
| Events | first pick of the gate, lead the next group flight |
| Getting on | an extra check-ride attempt, thirty more days of leave |
| Recognition | featured on the website, a line in the next NOTAM |

Three tests, and a thing had to pass all of them: **a staff member can deliver
it today** with no new backend and nothing they cannot already do; **a pilot
actually wants it** — status, a say in how the airline flies, or being seen;
and **it cannot be bought twice into nonsense**, so anything absurd to hold two
of carries a limit and anything genuinely scarce carries stock. Two "lead the
next group flight" is not a lead.

Neither of the two under *Getting on* buys a rank. They buy another attempt and
a longer clock; the check ride itself is unchanged.

### Priced in flights, not in points

The decision that makes the catalogue worth having. A fixed price is wrong for
everybody: a VA paying 120 an hour and a VA paying 5 an hour run the same
economy at different scales, and `1,500` is a fortnight of flying to one of them
and a lifetime to the other. A suggestion priced in somebody else's currency is
worse than no suggestion, because it looks like advice.

So each entry carries what it should cost in **typical flights**, and the price
is worked out from the VA's own rates when the catalogue is read. `flights: 8`
means "about eight flights' worth" at whatever rate the VA ever sets. The unit
is `examplePay` — the same 2h 15m in-fleet flight the worked example under the
rates is computed from — so the sentence a VA reads before saving and the prices
they are offered come from one function.

Prices are rounded up to a step that grows with the number (fives, then
twenty-fives, then fifties, then hundreds) so a shelf reads as a price list
rather than as arithmetic. Never down: a suggestion that undercuts the effort it
stands for is selling somebody's pilots' hours cheap.

A VA who has not set a rate yet is priced off a stated placeholder flight rather
than at zero — a shelf of free things is worse than an empty one, because a
pilot buys the lot before the VA has finished setting up. The moment a rate is
saved, the server sends the catalogue back repriced with it.

**Nothing is seeded.** No shop gets a row its owner did not put there. That is
the same rule the settings follow, for the same reason: deploying a file must
not start an economy in three hundred airlines that did not ask for one.

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
| `crewEvents.js` | The event half of earning: what an event pays, on the card and in the brief. |
| `docs/CREW-SHOP.md` | This. |
| `tools/test-crew-shop.js` | The shop, against the real dashboard. |
| `tools/test-crew-events-*.js` | What an event says it pays, and says nothing of without a shop. |

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
POST   /api/crew/<slug>/shop/goal       { itemId } → { wallet }   '' clears it
```

The item gains, all optional and all defaulting to the shop as it shipped:

| Field | |
|---|---|
| `delivery` | `'staff'` (default), `'instant'` or `'codes'` |
| `reward` | what an `instant` item hands over. Never sent to anyone but a buyer. |
| `codes` | write-only, on POST/PATCH: codes to **append** to the pool |
| `codesLeft` | staff-only, read-only: how many are unused |
| `group` | the section it sits under on the shelf |
| `salePrice`, `saleEndsAt` | an offer, and when it stops |
| `availableUntil` | when the item leaves the shelf |

The wallet gains `goalItemId`. `GET /events` gains `currency` —
`{ name, short, eventBonus }`, and **only while the shop is on** — and an event
gains `bonus` (null meaning "use the standing rate").

`GET /api/va-ads/by-slug/<slug>` carries `shop: { enabled }` so the dashboard
knows whether to draw the tile without asking for the whole shop on every page
load.

`GET /shop` and `POST /shop/settings` both carry `suggested` for staff — the
catalogue, priced from that VA's rates. It rides the responses the panel already
makes rather than a call of its own, and it comes back with the settings because
every price in it is worked out from the rates that were just saved: the one
moment a VA is certain to read those prices is immediately after changing the
rate that decides them. Pilots never receive it; it is a back-office tool, and a
pilot who could see it would be reading a list of things the airline does not
sell.

Server-side rules the client depends on:

* `POST /shop/orders` is the only thing that moves a balance. It must re-check
  the price, the stock and `limitPerPilot`, and debit in the same statement.
* **It must re-price from the offer**, not from what the buyer's device thinks
  the price is, and an expired `saleEndsAt` or `availableUntil` refuses the
  order. The client's countdown is decoration.
* **A self-claimed order is fulfilled in the same statement as the debit**, and
  a `codes` item pops exactly one unused code inside it. Two pilots pressing Buy
  on the last key must not both get it — and a debit that succeeds while the
  hand-over fails is the one outcome there is no apology for.
* `reward` goes back **only to the pilot who bought it**. Staff reading the
  queue see that an order went out, not what the key was.
* `codes` on a write is appended to the pool, never assigned over it.
* Approving a PIREP credits it once. Re-approving an already-approved flight
  must not pay twice, and changing the rate must not re-price history.
* **An event bonus is part of that same credit**, applied when the approved
  PIREP belongs to an event: the event's own `bonus` when it has one, the
  airline's `earn.eventBonus` otherwise. There is no path that pays for
  attendance, and there must not be one.
* Cancelling an order refunds it; deleting an item leaves existing orders alone.
* `POST /shop/goal` stores a preference and nothing else. It cannot move a
  balance, and an id that is not on the shelf is stored or rejected — either is
  fine, because the client renders nothing for one it cannot find.

## Tests

```
node tools/test-crew-shop.js
```

Covers, on top of everything below: that a thing which delivers itself says so
before it is bought and hands the thing over on the spot, with the link in it
made tappable and no code to queue with, and that the order still carries it
afterwards; that a `codes` item hands over the next unused key; that an item on
offer quotes the offer on the tile, with the old price struck through, and that
**Inflight Pay charges the offer rather than the old price**; that a shelf with
sections gets headings; that a goal can be pinned and unpinned, is sent to the
server rather than kept in the browser, and is not offered on something already
affordable; that the delivery picker shows and hides the fields belonging to
each choice without losing what is already typed; that codes are sent as a
tidied list and nothing belonging to an unused delivery rides along; that an
"offer" dearer than the price is refused rather than saved; and that the event
bonus is one of the rates, with the worked example pricing both flights.

`tools/test-crew-events-pilot.js` and `tools/test-crew-events-staff.js` cover
the other half: that an event says what it pays on the card and states the
condition in the brief, that the figure is sent with the event and an empty box
means the standing rate, and that **a VA with no shop sees no trace of any of
it**.

Also: the catalogue — that a VA with an empty shelf is offered things to put
on it, grouped and priced in their own currency; that one already on the shelf
stays visible but unpressable rather than vanishing under the finger aiming at
it; that tapping one sends the whole item, scarcity included, and nothing that
says where it came from; and that changing the rate reprices what is on offer.
Also that an item's icon can be chosen and is saved with it.

And: a VA with no shop has no tile; the one screen that switches it on; the
shelf's three states (buy / how short / sold out); that a click, a slip and a
half-press spend nothing while a held press pays exactly once; that the balance
shown afterwards is the server's; the back office and its live worked example;
and that an out-of-date database is told to update rather than shown an error.
