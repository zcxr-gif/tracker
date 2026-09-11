# The crew center, beyond the panels

Four systems added on top of the roster/routes/schedule/flights core. Two of
them exist because the pages were making a promise they did not keep; two
because a VA was doing the work anyway, in Discord, by hand.

| | |
|---|---|
| `crewCommand.js` | The search box, made real. |
| `crewAlerts.js` | The bell, made real. |
| `crewTraining.js` | The rank ladder and the check-rides that move a pilot up it. |
| `crewAwards.js` | What a pilot has to show for it. |
| `crewLeave.js` | Being away on purpose, and spotting the pilots slipping away by accident. |

All five are built on `crewPanels.js`, so they follow whichever of the two
interfaces is on (see `CREW-INTERFACES.md`) and are re-skinned for free.

---

## 1. The search box

Both crew center pages have had a search field in the top bar since they
shipped. It took focus, it took typing, and it answered with nothing. A control
that looks like it works and does not teaches a reader that the rest of the page
might not either — so this is a bug fix before it is a feature.

**Opening it:** `⌘K` / `Ctrl-K` anywhere, `/` anywhere outside a field, or
clicking the box. The field is `readOnly` now: it cannot take a caret it has no
way to answer.

**What it searches:** the four lists the crew center already publishes — the
roster, the network, the calendar and the library — read once on the first open
and kept for the visit. Nothing is newly public.

**Plus actions**, which the page reads back **off its own tile grid**. That
matters: the grid is already filtered by capability, so the palette can never
offer a door this member is not allowed through, and the two can't drift apart
by keeping separate copies of the list. The test asserts a crew member with no
roster capability is not offered the roster.

**Ranking** is four rules a reader can predict, not a fuzzy matcher:

```
exact  >  starts with  >  a word in it starts with  >  contains  >  initials
```

Which is the difference between typing `BA` and getting `BAW22`, and typing
`BA` and getting `Gibraltar` because it contains b…a.

## 2. The bell

The pilot page's bell had a dot on it. The dot was a `<span>` in the markup:
always on, never counting anything. It is gone, and `crewAlerts.js` owns the
button.

**It carries only things that happened to *this person*** — a flight reviewed,
a message, a booking moved, a rank change, an award, an order handed over.
Deliberately not everything that happened at the airline: that is the
noticeboard, it already exists, and a bell that lights up because somebody else
filed a flight is a bell people turn off.

**Read is a fact, not a guess.** Opening the panel marks what is *in* it read,
by id — not "everything before now", which is how an alert arriving while the
panel is open gets silently swallowed.

**It is allowed not to exist.** 404 or 409 from `/alerts` produces a bell with
no dot and a panel that says so. Chrome does not get to shout.

## 3. Training & check-rides

A VA's ranks are a list of names with an hours figure. That is enough to
*display* a rank and nothing like enough to award one, so every airline runs the
same six steps in Discord instead — and the last step, actually changing the
rank, is the one that gets forgotten.

The same six steps, written down:

1. A pilot sees the ladder, where they are on it, and **exactly what the next
   rank is short of** — hours, flights, and the VA's own sentence.
2. They ask. It is a row, not a message.
3. Staff schedule it (a date in their own words; the pilot sees it).
4. Staff record pass or not-yet, with a note the pilot reads.

**Recording a pass is the same act as the promotion.** It cannot be the step
that gets forgotten because it is not a separate step.

Ranks, names and hours stay in Settings → Crew where they already were. This
adds only what the ladder did not carry — a flights figure, whether a rank needs
a check-ride at all, and a line in the VA's own words. A training system with
its own copy of the ranks is one that disagrees with the roster by month two.

## 4. Awards

Hours are a fine measure and a terrible reward: nobody screenshots 214.

Everything is computed **by the server from flights the VA has already
approved**. Nothing new is asked of staff, so no badge is forgotten; nothing can
be gamed that the flight log does not already permit; and a VA that never opens
the panel still has them accruing, so the day they do it is full.

**Locked badges show their progress** — "6 of 10" and a bar. A wall of grey
squares with no explanation is a wall people close, and the whole value is
seeing one you are close to.

The newest few appear as a strip on the pilot's own page, hidden entirely until
there is one.

## 5. Leave, and crew health

The roster sweep already removes pilots who stop flying. It has one hole: it
cannot tell a pilot who lost interest from one sitting an exam. Both go quiet;
only one should be removed.

**A pilot can say they are away** — a return date, an optional sentence — and
the sweep leaves them alone until it passes.

**The harder half** is that by the time the sweep removes somebody, the airline
has already lost them. The useful moment was three weeks earlier. The
crew-health board is that shape — four groups, each a different conversation:

| | |
|---|---|
| **Going quiet** | Flew regularly, has not lately. The one worth a message. |
| **Never started** | Joined, never filed. A recruitment problem, not retention — usually nobody told them how. |
| **Nearly out** | Inside the sweep's window. Last chance to ask. |
| **Away** | On leave, with a date. Here so nobody chases them. |

Each row carries an eight-week spark of that pilot's flying — not a chart, a
shape, and the shape is the reason the row is on a list called "going quiet".

**Every row has one button**, and it sends a note through the inbox the crew
center already has, in the staff member's own words, starting from a draft
(a blank box is what stops people sending anything). A board that only shows you
who is leaving is a board that makes you feel bad on a schedule.

---

## The backend

Implemented in the database repo. Every one of these answers 409 with a
`*_missing` code until the VA's database has it — which `CrewPanels.isSchemaGap`
already recognises — so an out-of-date crew center is told to update, with the
button that does it, rather than shown a broken screen. A bare 404 (the route
not deployed at all) is treated the same way.

```
GET    /api/crew/<slug>/alerts               this caller's own. { alerts, unread }
POST   /api/crew/<slug>/alerts/read          { ids: [...] } — exactly those

GET    /api/crew/<slug>/training             { ranks, me, requests, canManage }
POST   /api/crew/<slug>/training/requests    { forRank }
PATCH  /api/crew/<slug>/training/requests/<id>
                                             { action: schedule|pass|fail|withdraw, at?, notes? }
POST   /api/crew/<slug>/training/settings    staff: { ranks: [{name, minFlights, checkride, note}] }

GET    /api/crew/<slug>/awards               { catalog, earned, progress, forName }

GET    /api/crew/<slug>/leave                { mine, canManage, sweep }
POST   /api/crew/<slug>/leave                { until, reason }
DELETE /api/crew/<slug>/leave/<id>
GET    /api/crew/<slug>/crew-health          staff: { groups: { quiet, never, edge, away } }
POST   /api/crew/<slug>/crew-health/nudge    staff: { pilotId, message }
```

The palette needs no endpoints of its own — it reads `/roster`, `/routes`,
`/events` and `/documents`, which already exist.

Server-side rules the client depends on:

* `action: 'pass'` **moves the rank** in the same call. The client never writes
  a rank.
* Awards are earned by the server from approved flights; the client only renders
  `earned` and `progress`.
* A pilot on leave is excluded from the roster sweep until `until` passes.
* `alerts/read` marks the ids it is given and nothing else.

## Tests

```
node tools/test-crew-command.js     # 35 checks
```

Covers: the search box no longer takes a caret and opens something that works;
the ranking rules; that the palette offers only permitted tools; that the bell
counts real unread and marks exactly what was shown; that the ladder states the
shortfall and a pass is the promotion; that locked awards show progress; that
the health board sorts into the four groups, does not chase pilots who are
legitimately away, and sends a real message; and that all of it degrades to
"update your database" rather than an error.
