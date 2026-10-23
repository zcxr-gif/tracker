# Approach — the ATC rules the game follows

> Approach is an independent, fan-made practice tool from InFlight. It
> isn't affiliated with, endorsed by or connected to Infinite Flight or
> IFATC. Their names are used only to say what it helps you practise. It
> doesn't set out to copy anyone's product. The aim is a familiar
> experience, so IFATC controllers can practise and Infinite Flight pilots
> can learn how ATC works. Not for real-world navigation.

## The start screen

It is laid out like Infinite Flight's Control screen:
- **The map** (left) draws the chosen airport's runways. A search box and
  the featured airports sit on top of it.
- **The panel** (right) has:
  - the airport (name, ICAO, runways);
  - its real frequencies (ATIS, Ground, Tower, Approach and Departure).
    Tap Ground, Tower or Approach to work that position; green is yours;
  - Traffic (Light, Normal, Busy, Event) and how many aircraft there are
    at the start;
  - Rules (Real life or Infinite Flight);
  - Inbounds, when you aren't working Approach: Vectored (the system's
    Approach) or Pattern entries (no radar: arrivals call Tower);
  - Options (terrain, weather, pattern work when you're on Tower,
    emergencies);
  - How to play;
  - the disclaimer above.
- **MODE ATC and CONTROL** at the bottom start the shift.

While an aircraft is selected in a shift, the log shows only its radio:
its calls and yours to it.

`approach.html` / `approachGame.js` model a US terminal radar (TRACON)
controller who is also working the tower. Where the game models a rule, it
follows FAA Order JO 7110.65 (*Air Traffic Control*). This file lists each
rule, its paragraph, and what the game does when it is broken.

There are two kinds of error:

- A **separation loss** (−10, then −2 every 10 s until fixed, −40 more for
  a near miss under 0.5 NM / 500 ft) is when two airborne aircraft are closer
  than the minimum below.
- A **rule violation** (−5) is a clearance that breaks a procedure. The
  pilot still flies it, as a real one would, and the log names the paragraph.

Pilots refuse (they say "unable") only when they physically can't comply.
For example, a heading that never reaches the localizer outside the final
approach fix.

## Separation

| Rule | Value | Source |
|---|---|---|
| Radar separation | 3 NM (the whole scope is inside 40 NM of the antenna) | 5-5-4 |
| Vertical separation | 1,000 ft | 5-5-5 |
| In trail on the same final, both inside 10 NM | 2.5 NM | 5-5-4 |
| Wake turbulence: behind a Super | Heavy 6, B757 7, Large 7 NM | 5-5-4 (weight classes) |
| Wake turbulence: behind a Heavy | Heavy 4, B757 5, Large 5 NM | 5-5-4 (weight classes) |
| Wake applies when "directly behind" | in trail on the same final, or within 2,500 ft of the leader's track and less than 1,000 ft below it | 5-5-4 |
| Dependent parallel approaches, centerlines 2,500–4,300 ft apart | 1.5 NM diagonal | 5-9-6 |
| Independent parallel approaches, centerlines 4,300 ft or more apart | none once both are established | 5-9-7 |
| Parallels under 2,500 ft apart | treated as one runway for wake and in-trail rules | 5-9-6, 3-9-6 |
| Successive departures, courses diverging 15° or more | 1 NM, not when wake turbulence separation applies | 5-8-3 |
| Arrival and departure both inside 5 NM and below 2,500 ft above the field | no radar minimum; the tower separates them visually | 7-2-1 (simplified) |

On the same final, vertical separation doesn't count. Two aircraft on one
glideslope are separated by the miles between them, not the feet.

Wake separation uses the weight-class table (Super / Heavy / B757 / Large).
The FAA has since moved to the nine-category Consolidated Wake Turbulence
(CWT) table. We couldn't verify every CWT value, so the game keeps the older
table. It is at least as strict for the aircraft the game spawns. The Super is
the A388; Heavies are the widebodies (B763, B772/77W/77L, B789, A339, A359,
A35K, B748, MD11).

**Under Infinite Flight rules (IFATC 6.2):**

- 6.2.1 **Terrain**: at least 1,000 ft above the ground under the aircraft
  (with Terrain on), instead of the MVA. Below it, the low altitude alert
  and a note citing 6.2.1. The pattern, VFR services and aircraft close in
  at the runway are left to the pilot.
- 6.2.2 3 NM or 1,000 ft, everywhere (no wake, no 2.5 NM).
- 6.2.3 **Not separated when it first called you**: no penalty. You're told,
  and have 60 seconds to separate them before it counts as your loss.
- 6.2.4 **Collision alert**: a red target and ring inside 3 NM and 1,000 ft.
  Inside 1.5 NM and 500 ft, a flashing inner ring, plus an alarm beep with
  sound on. Tapping one of the aircraft silences the beep, not the conflict.
  Every loss of separation with your traffic needs **Traffic alert** (Misc.
  messages) to one of them within 20 seconds, or it's a violation.
- 6.2.5 **VFR services** (flight following, transitions, the pattern) see and
  avoid: against them only 500 ft vertical, or ¾ NM, counts. A light
  aircraft's downwind is ½–1 NM off the runway, so traffic on final abeam it
  is the pattern working. Not counted at all: an arrival on short final
  behind a departure climbing off the same runway (that's runway separation,
  checked at the threshold), and two aircraft on final to parallel runways,
  each on its own centerline. With no radar, Tower's traffic is separated
  this way against everyone, including departures already handed off.

**Drag and vector (IFATC 6.3):**

- 6.3.1 Dragging a heading shows the heading, the distance, the time at the
  aircraft's speed, the nearest fix or navaid within 2 NM, and (with Terrain
  on) the highest terrain between the aircraft and the point. Dropping it on
  a fix gives the direct-to prompt.
- 6.3.2 / 6.3.3 It also shows the **minimum**: that terrain rounded up to the
  next 1,000 ft, plus 1,000 ft (10,800 ft → 12,000 ft). It turns red when the
  aircraft's assigned altitude is below it. In the altitude ladder that
  follows, rungs below it are red, and picking one gets a warning.
- The MVA sectors are drawn by the same rule under Infinite Flight rules:
  each one's highest terrain rounded up to the next 1,000 ft, plus 1,000 ft.

## Approaches

- **Approach gate** is 1 NM outside the final approach fix. The game puts
  the FAF at 5 NM, so the gate is at 6 NM. Vectors must join the final
  approach course at least 2 NM outside the gate, which is 8 NM from the
  threshold (5-9-1). The game assumes instrument weather, so the
  closer-in exceptions never apply.
- **Intercept angle**: 30° maximum, 20° maximum within 2 NM of the
  approach gate (5-9-2).
- **Glideslope from below**: the "maintain … until established" altitude
  must be at or below the glideslope where the aircraft joins.
- **Phraseology** (5-9-4): *"turn left heading 190, maintain 3,000 until
  established on the localizer, cleared ILS runway 22L approach."*
- A heading, direct, hold or 360 after the approach clearance cancels it.
- **Stabilized approach**: not on the glideslope by 1,000 ft above the
  field and the crew goes around.
- **Landing clearance** is required: *"wind 210 at 12, runway 22L,
  cleared to land."* No clearance by 0.6 NM and the crew goes around.
- **Runway separation for arrivals** (3-10-3): the arrival may not cross
  the threshold until the runway is clear. The game approximates that as a
  landing aircraft holding the runway for 35 s, and a departure holding it
  until it is airborne. If the runway isn't clear, the arrival goes around.
- **Go around / missed approach**: runway heading, 3,000 ft above the
  field, 210 kt.

### Approach types

The information panel offers the approach the ATIS names for each landing
runway (below). **Other approach…** lists every other one the field
publishes. Where there is no real data (outside the US), every runway is
assumed to have all of them.

- **ILS** and **localizer (LOC)**: vectors to final as above. The localizer is
  Real-life rules only, since Infinite Flight has no localizer-only approach.
- **RNAV (GPS)** (called GPS under Infinite Flight rules). If no heading is
  given and the aircraft is within 25 NM of one of the approach's
  initial or intermediate fixes, it flies the published procedure:
  - The transition and common route take it to the final approach fix,
    keeping the published altitudes.
  - It then joins final and calls Tower.
  - Phrase: *"cross REPRE at or above 3,000, cleared RNAV Y runway 04R
    approach."*

  Otherwise (or with a heading) it is vectored onto the final like an ILS:
  *"maintain 3,000 until established on the final approach course, cleared
  RNAV (GPS) runway 04R approach."* RNP approaches are used only where
  there is no plain RNAV one.
- **Visual** (7110.65 7-4). It needs:
  - weather of ceiling 1,000 ft and visibility 3 SM or better;
  - the field in sight: within 20 NM, below 10,000 ft above it and roughly
    facing it.

  Without it the clearance becomes *"report the airport in sight"*, and the
  pilot calls when it is. Once cleared, the aircraft flies its own way in:
  - straight in when it is lined up;
  - otherwise a base from its side.

  It hands itself to Tower once established. In instrument weather the
  clearance is refused.
- **Pilot requests**: on Approach, within 18 NM, about one pilot in three who
  has the field asks for the visual, and now and then one asks for the
  RNAV. The request shows as **REQ** in the data block, with **Approve** and
  **Unable** buttons on the panel. The system's Approach approves a visual
  in good weather and turns down the rest.
- **Report field in sight** is a button of its own, or `rfs`.
- Typed: `i22L` ILS, `loc22L` localizer, `rnav22L` or `gps22L` RNAV,
  `va22L` visual, `rfs` report the field in sight, `un` unable (a request).

## Frequencies

Down the left of the scope is a frequency list, as in Infinite Flight:
- Status, Ground, Tower, Approach and Departure, then the ATIS.
- Real frequencies and facility names ("Kennedy Tower (119.10)", "Norcal
  Approach (128.325)") from OurAirports (public domain), built into
  `approach-freqs.json` by `npm run build:freqs`.
- Pilots call the facilities by those names. Where the list has no name, it's
  the field's code and the position.

How it works:
- Tap a frequency to list only its traffic. Tap it again for everything.
- A gold count shows who is waiting on you there.
- Grey frequencies are the system's.
- **Status** folds the airport info box, and the **ATIS** entry opens the ATIS
  page.
- On an upright phone the list runs across the top of the scope.

## ATIS

The ATIS page is laid out like Infinite Flight's:
- the METAR and the current time;
- the wind, the next information letter and **PUBLISH**;
- columns of Runways, Remarks and NOTAMs;
- the text as it will be read.

While it's open it takes the whole game beside the frequency list: the
aircraft list, log and score step aside until it closes.

Nothing changes until **PUBLISH**:
- the letter advances;
- the full ATIS goes in the log;
- a runway change moves everyone, as a wind-driven change does.

Under Infinite Flight rules the text follows Infinite Flight's wording and
order: *"San Francisco airport, ATIS information BRAVO, time 1730 ZULU, Wind
230 at 9, … Remarks, no intersection departures, expect long taxi times.
Landing Runways 28R and 28L, … Notams, event in progress, expect delays, …"*

What it sets:
- **Runways**: a DEP and an LDG tile for every runway end.
  - Green means a headwind and red a tailwind, as in Infinite Flight. Gold
    marks what's in use.
  - Touching one switches from **BY WIND** to your own choice. Picked
    runways stay when the wind shifts.
  - A tailwind over 10 kt is flagged, both on the page and when the wind
    turns (IFATC 2.1.2).
- **Remarks**: Infinite Flight's set. No intersection dept. and Intersection
  dept OK exclude each other.
  - **No intersection departures** is enforced: dragging a departure to an
    intersection is refused.
  - **Rolling dpt**: cleared for takeoff, departures line up and roll without
    stopping. Line up and wait still works.
  - **Gate hold**: departures at the gate wait to call for pushback.
  - **No light aircraft**: no new C172, SR22 or PA28 pattern work,
    transitions or VFR inbounds.
  - The rest are read out for pilots: pattern work, flow control, long taxi,
    FPL required.
- **NOTAMs**: event, size restrictions, severe weather, low visibility. These
  are read out only.
- **Approaches**: any mix of ILS, LOC, RNAV/GPS and visual (at least one),
  read out as *"RNAV (GPS), ILS and visual approaches in use"*.
  - An arrival checks in asking for the first of them its runway has, e.g.
    *"…requesting the RNAV (GPS) approach runway 04L"*.
  - Pilots ask for an accepted visual or RNAV more often than for one that
    isn't.
  - The system's Approach clears the same way, falling back to the ILS on
    a runway with none of them.
- **Recommended arrivals and departures.** These list only the published
  STARs and SIDs the game's traffic can fly here: a STAR has to enter the
  scope at least 14 NM out.
  - Arrivals file a recommended STAR three times in four.
  - Departures are sent to an exit the recommended SID serves, and fly that
    SID when it serves their exit.
- **Straight out dept** (a remark; tap again to step 1,000, 3,000, 5,000 ft,
  off): runway heading to that height above the field before the SID or a
  turn on course.
  - The Infinite Flight ATIS remark *"Straight Out Dept."* sets this.
  - Under Real-life rules it is also part of the clearance: *"fly runway
    heading until 3,000, then the DEEZZ6 departure, cleared for takeoff."*

The approaches, recommended procedures, remarks and NOTAMs are remembered
per airport. Runways always start by the wind.

**Under Infinite Flight rules the ATIS is yours (IFATC 4.1):**

- 4.1.2 **Keep it current.** A wind or weather change doesn't bring a new
  letter by itself. The ATIS goes **OUT OF DATE** (shown on its page, with
  why) and the runways stay as published until you publish again.
  - Not published within 3 minutes: a violation.
  - At least once an hour: a reminder at 55 minutes, a violation at 60.
  - **Broadcast it**: after publishing, "Notify ATIS update" (or "Check
    ATIS") within 2 minutes on your frequencies, or it's a violation. The
    system's controllers are told in the coordination log and tell their own
    traffic.
- 4.1.2 **Pilots report the letter they have.** Aircraft already on your
  frequencies keep the old letter until your broadcast, and about one pilot
  in twelve checks in with the previous one. "Check ATIS" from Misc. messages
  fixes it (+1 when the letter was wrong); after that it's the pilot's job.
- 4.1.3 Letters go in order and start at Alpha.
- 4.1.4 Picking runways by hand, the page warns when any runway in the flow
  only lands, only departs or isn't used.
- 4.1.5 With radar open the ATIS always names the approach type ("Expect ILS
  approaches"), and an advertised GPS that no landing runway publishes is
  flagged.
- **Remarks and NOTAMs** (the 4.1 table), shown as warnings on the page:
  - below VMC, No pattern work **must** be on it: publishing without it is a
    violation;
  - No intersection dept. only when one blocks the only way to full length;
  - Gate hold: favour "hold position", and 10 minutes at most (a violation
    after that);
  - No light aircraft not at GA airports (taken as the smaller fields);
  - FPL required only below VMC or when SID/STAR use is required;
  - Event for Infinite Flight sponsored events only;
  - Low visibility exactly when visibility is under 1/4 SM.

Not modelled: multiple frequencies (4.1.6), Check Forum, Mult. Freq. In
Use, Size restrictions' effect.

**Preferred SIDs and STARs (IFATC 4.2.2):**

- They're Radar's to pick. With the system on Approach it picks them, one
  STAR into every entry and one SID out to every exit, and the ATIS page shows
  them as "Picked by Radar" (tapping one is refused). Your own picks stay
  saved for when you work Approach. With no radar, Tower may pick them, with a
  note that it isn't encouraged.
- Picking them yourself, the page lists any entry or exit left without a
  preferred procedure: a variety from ALL directions.
- Under Infinite Flight rules traffic comes from every direction whatever is
  preferred. An arrival files the preferred STAR at its entry about 60% of the
  time, 85% with **SID/STAR use rcmd** on the ATIS and 95% with **SID/STAR use
  req**. (Real life: the recommended STARs draw the traffic, as before.)
- The two remarks exclude each other, and are flagged where nothing is
  published, req in light traffic, and rcmd in busy traffic.

## Speed

- 250 kt maximum below 10,000 ft (14 CFR 91.117).
- Minimum assignable speeds for turbojets (5-7-3): 250 kt at or above
  10,000 ft; 210 kt below; 170 kt within 20 flying miles of the threshold;
  departures 230 kt. Lower assignments are raised to the minimum, with a
  note in the log.
- No speed adjustments inside the final approach fix or 5 NM from the
  runway (5-7-1).
- An approach clearance cancels assigned speeds unless they are restated
  (5-7-1). A restated speed is held to the 5-mile final, or to the mile
  final you name: *"maintain 180 knots until 8 mile final"* (Request speed
  → Maintain speed until a mile final). Said before the approach
  clearance, it carries over instead of being cancelled. Otherwise the crew
  flies its own profile: 210, then 180 inside 15 NM, 160 inside 8 NM, and
  Vapp inside the FAF.
- Holding speeds: 200 kt to 6,000 ft, 230 kt to 14,000 ft, 265 kt above
  (AIM 5-3-8 maximum holding speeds).

## How the aircraft fly

Each aircraft flies by its size. Bigger is slower at everything: climbing,
speeding up and slowing down, rolling into a turn, and down the runway.

| Size | Types | Climb / descent (fpm) | Speed up level / climbing (kt/s) | Slow down level / descending (kt/s) | Bank | Rotate / approach (kt) |
|---|---|---|---|---|---|---|
| Light | C172, SR22, PA28, DA40 (C208) | 700 (900) / 700 | 1.5 / 0.8 | 1.5 / 1.0 | 30° | 55 / 65 (70 / 80) |
| Regional | CRJ, E-jets | 3,000 / 2,200 | 1.6 / 1.1 | 1.0 / 0.6 | 27° | 135 / 130 |
| Narrowbody | A320 family, 737, 757 | 2,500 / 2,000 | 1.3 / 0.9 | 0.8 / 0.5 | 25° | 145 (757: 150) / 140 |
| Widebody | 767, 787, A330, A350, 777-200 | 2,000 / 1,900 | 1.0 / 0.7 | 0.7 / 0.45 | 24° | 155 / 145 |
| Heavy | 777-300ER/F, 747-8, MD-11 | 1,700 / 1,800 | 0.85 / 0.55 | 0.6 / 0.4 | 22° | 165 / 155 |
| Super | A380 | 1,500 / 1,700 | 0.8 / 0.5 | 0.55 / 0.35 | 20° | 160 / 145 |

- **Turns**: standard rate (3°/s) when slow, never more than the size's
  bank. The rate builds as the aircraft rolls in and eases as the heading
  comes up, and the big ones roll in more slowly. A 90° turn at 210 kt takes
  about 39 s in an E175, 43 s in an A320, 49 s in a 777-300ER and 54 s in an
  A380. Localizer intercepts lead the turn by the radius and the roll-in
  time, so the bigger ones start their turns earlier.
- **Speed**: slowing down is slower while descending ("descend or slow
  down"); on final, with the flaps coming out, 25% quicker than level.
- **Climbs**: 25% slower above 10,000 ft. From brake release to 3,000 ft
  above the field takes about 1:40 in an E175 and 3:05 in an A380.
- **Takeoff roll**: from 36 s (E175) to 64 s (A380) to rotation.
- **Descents**: 2,200 fpm on the glideslope. The vertical speed builds and
  eases at about 500 fpm per second and levels off smoothly at the assigned
  altitude.

## Departures

- *"Runway 22R, line up and wait"* (LUAW) puts the departure on the runway.
  An arrival will go around rather than land on it.
- Takeoff clearance includes the wind and the heading: *"wind 210 at 12,
  runway 22R, fly heading 190, cleared for takeoff."*
- **Same-runway separation** (3-9-6): no takeoff roll while another
  aircraft is rolling or lined up on the runway, or a landing aircraft is
  still on it.
- **Wake turbulence for departures** (3-9-6): 2 minutes behind a Heavy and
  3 minutes behind a Super. This applies on the same runway or a parallel
  less than 2,500 ft away.
- Departures fly runway heading until 400 ft. Then they check in with
  departure (*"radar contact"*), climb to the exit altitude and leave through
  their gate. Leaving at another gate, or below the exit altitude, costs
  points.

**Under Infinite Flight rules (IFATC 6.4):**

- 6.4.4 **Check In**: with you on Departure, a departure checks in and waits
  for you. **Radar contact** (highlighted on its card, or `rc`) accepts its
  flight plan and clears it to its initial cruising (exit) altitude. From
  then on it flies its SID (or its filed route) and climbs on its own: no
  vectors or altitudes are needed (6.4.3). Not answered: it calls again at
  45 s, and at 90 s it's a violation. The system's Departure answers its own.
- After a heading or an altitude, hand the plan back once the conflict is
  gone: **Continue as filed**, **Altitude at your discretion** (`ad`), or
  **Resume own navigation** (`ron`) when it won't rejoin its plan.
  - A departure that took off on a heading from Tower starts out on vectors.
  - Still on vectors or an assigned altitude 10 NM from the edge of the scope,
    the pilot asks for them. Leaving that way costs 3.

**STARs from Center's part of the manual (IFATC 6.6):** there's no Center
position, so Approach does the STAR work Center would.

- 6.6.12 About one STAR arrival in three (with you on Approach) checks in
  still level: *"…on the BDEGA4 arrival, request descent via the arrival"*.
  It stays level until you send **Descend via the BDEGA4** (`dv`), or you
  vector it and give it altitudes instead.
- 6.6.10 An arrival on a STAR that isn't preferred shows "(not a preferred
  STAR)" on its card. **Amend FPL with preferred STAR** (Misc. messages):
  about 30 s later it's on the preferred STAR from its entry, joined at the
  nearest leg. With none from that direction, it says so.
- 6.6.13 Asking one already established in the descent is flagged: vector it
  for sequencing instead.
- 6.6.8 VFR semicircular levels are used for VFR traffic (below).

Not modelled: Center itself, cruise, Mach, active/away, Resume Flight
(6.6.1–6.6.7, 6.6.14).

**Approach check-in (IFATC 6.9):** under Infinite Flight rules:

- 6.9.3 Arrivals check in with their approach request. **Continue as filed,
  expect the ILS 28R** is for one descending via its STAR. For one still
  level and not cleared to descend via, on vectors, or with no STAR, it gets
  a note: **Expect vectors for…** fits. Unanswered for a minute, the pilot
  asks again.
- 6.9.4 Preferred STARs as in 6.6.10 above.
- 6.9.9 **Flight plan approach codes**: most arrivals have programmed the
  approach they expect, shown in the FPL line on the card with Infinite
  Flight's prefix: I (ILS), L (LOC), R (RNAV (GPS)), H (RNAV (RNP)), then the
  runway and any Y/Z suffix: `I28R`, `H35LZ`. Telling it to expect another
  approach reprograms it.

**GPS approach (IFATC 6.10):** under Infinite Flight rules:

- 6.10.1 The system's Approach now approves a GPS request when it has 6 or
  fewer aircraft, and vectors it onto the GPS approach rather than the ILS.
- 6.10.2 Within 25 NM of one of the procedure's initial or intermediate
  fixes, **Cleared GPS approach runway 28L** (no heading) is all it needs:
  no vectors, altitude or intercept. It flies the procedure to the threshold.
- 6.10.3 It goes to Tower once established on final; "Contact Tower" isn't
  offered before.
- 6.10.4 Further out, after a missed approach, or when the STAR doesn't lead
  in: vectors to the procedure (or onto the final), and the clearance is
  refused if it can't join from where it's heading.

**ILS approaches (IFATC 6.11):** under Infinite Flight rules:

- 6.11.3 Intercepts as close to 30° as possible: over 30° is a violation, and
  a vectored intercept of 10° or less (inside 20 NM) gets a note. Dragging an
  aircraft onto a final picks a 30° heading for you.
- 6.11.4 The altitude must be below the glideslope where it joins (300 ft per
  mile above the field): above it is a violation.
- 6.11.5 Every ILS clearance carries an altitude ("maintain 3,000 until
  established"). Without a heading it flies its present track, refused when
  that doesn't join outside the final approach fix.
- 6.11.7 **Parallel operations**: IFR separation applies until both are
  established on the localizer (or GPS final). Then, on parallel runways at
  any spacing, it no longer does. Visual approaches don't get this.
- 6.11.8 The system's Approach brings parallel finals in level, 1,000 ft
  apart, and turns them in line abreast.

**Radar vectors (IFATC 6.12):** under Infinite Flight rules:

- 6.12.1 An aircraft on radar vectors is put on a recognizable leg and
  brought down to pattern altitude (props 1,000 ft, jets 1,500 ft above the
  field) before **Contact Tower (radar vectors)**. Handing one over more than
  10 NM out, or not at or descending to pattern altitude, gets a note. VFR
  and radar-vectors traffic can be given pattern altitude (other traffic
  stays in whole thousands above the minimum).
- It is **not cleared for an approach**: an ILS, GPS or visual clearance to a
  VFR inbound asking for vectors is refused. Vector it toward the localizer
  if you like; Tower gives the entry, sequence and clearance (3.6.3).
- 6.12.2 The system's Approach vectors them for a base entry point 7 NM out,
  3 NM abeam, and descends them to pattern altitude, or higher where the
  terrain on the way needs it. It hands them over near that point.
- 6.12.3 **Below VMC** a radar-vectors handover is only for an aircraft
  pointed at an instrument final: in the cone 5–20 NM out, within 45° of the
  course and below the glideslope. Tower then has a straight in only (no
  pattern below VMC).

**Visual approaches (IFATC 6.13):** under Infinite Flight rules:

- 6.13.1 VMC is 3 SM visibility (no ceiling test), for visual approaches,
  the pattern and VFR services alike.
- 6.13.3 The pilot reports the airport in sight before the clearance. A
  visual clearance to one that hasn't reported asks it instead (*"report the
  airport in sight"*); with the field in sight it reports at once, and the
  next clearance goes through. A pilot who asked for the visual has already
  reported. Vectors can carry on in between.
- 6.13.2 At Tower a visual gets a sequence (if not number 1) and its
  clearance, no pattern entry (3.6.3 above).

**Handover to Tower (IFATC 6.14):** under Infinite Flight rules, with you
on Approach and the system on Tower:

- An arrival established on the localizer stays with you until you switch
  it: **Contact Tower** moves to the top of its card. It asks at 4 NM, and on
  a 2 NM final it switches itself (−2).
- 6.14.1 / 6.14.2 Switching an ILS or GPS arrival before it's established
  (aligned with the centerline, not just in the cone) is a violation.
- 6.14.3 So is switching one that's closing on the aircraft ahead fast
  enough to be under 3 NM when that one lands (ground speeds, wind
  included). Slow it first, or keep it on frequency until spacing is
  assured.
- 6.14.4 "Maintain 180 knots until 5 mile final" is in Request speed.

**Aircraft speed (IFATC 6.15):** under Infinite Flight rules:

- 6.15.1–6.15.4 The data block on the scope shows **ground speed** (true
  airspeed for the altitude, less the headwind). The card shows both: "IAS
  250 · GS 268". Speed commands are in IAS. (Mach isn't needed: nothing flies
  above FL240 here.)
- 6.15.6 / 6.15.7 Slowing an aircraft while a faster one up to 10 NM behind
  it, on the same runway, has no speed of its own gets a note: slow the one
  behind first. "Adjust speed to follow aircraft ahead" when the one ahead has
  no speed assigned gets a note too: it would set the pace for the whole flow.
- 6.15.8 A jet slowed under 210 kt more than 20 track miles out gets a note
  (the minimum speed rules usually stop it first).
- 6.15.9 / 6.15.10 Speed is the pilot's after leaving a hold, and after the
  approach clearance unless restated ("maintain 180 knots until 5 mile
  final").

**Direct-to (IFATC 6.16):** under Infinite Flight rules, direct-to is only to
a fix still ahead on the aircraft's flight plan (its STAR, SID or filed
fixes):

- **Direct to…** lists just those. An aircraft with no flight plan has none:
  vector it.
- Dragging shows the direct-to prompt only over one of them (6.3.1).
  Elsewhere the drag stays a heading.
- Sending one to any other fix is refused, with the fixes it does have.

**Holding (IFATC 6.7):** under Infinite Flight rules:

- 6.7.2 **Hold at…** lists **Present position** and the fixes still ahead on
  the aircraft's flight plan (its STAR, SID or filed fixes). Real-life mode
  keeps any fix nearby.
- 6.7.3 Then **Left turns** or **Right turns**, then the altitude. The speed
  goes with the altitude: 200 kt up to 6,000 ft, 230 up to 14,000, 265 above
  (props 175). The hold sits on the aircraft's inbound track to the fix (its
  heading, at present position). *"…hold at BDEGA, left turns, descend and
  maintain 9,000."*
- 6.7.5 It enters the way a pilot would, from its heading against the inbound
  course: **direct** (the 180° sector), **parallel** (the 110° on the
  non-holding side: outbound on that side, then back through the holding
  side to the fix) or **teardrop** (the 70° beside it: 30° off the outbound,
  then turn in).
- **Exit hold** (`xh`): it carries on along its flight plan (its STAR again,
  or the next fix), and the speed is its own again (6.15.9).
- The long-press quick menu has Hold (fix, then turns) and Exit hold too.

**Diversions (IFATC 6.8):** under Infinite Flight rules, now and then an
arrival on Approach asks to divert to a real airport 40–200 NM away (*"request
diversion to KOAK, 12 miles southeast, due to weather at our destination"*),
shown as REQ DIV. The card names the airport, its distance and its longest
runway.

- **Approved, resume own navigation**: it turns for the airport and leaves,
  not counted against you. In busy airspace (8 or more on frequency, or
  traffic within 5 NM and 1,500 ft) you're reminded vectors out are safer
  (6.8.2).
- **Approved, expect radar vectors**: it flies your headings until
  **Resume own navigation**, then turns for the airport.
- **Unable**: for an airport too short for the type (2,500 ft props, 6,000
  jets, 8,000 heavies) or at capacity. Denying a suitable one is flagged
  (6.8.3).
- The system's Approach approves its own, with vectors when it's busy.

**Flight following (IFATC 6.5):** with you on Approach under Infinite Flight
rules, VFR light aircraft cross the scope at VFR levels (odd thousands plus
500 heading 000–179, even plus 500 heading 180–359) and ask for flight
following. VFR inbounds ask for flight following or vectors to the field.

- 6.5.1 **Radar contact, maintain VFR** (`rc`) acknowledges it; the pilot
  sees and avoids and carries on. Unanswered, it asks again at 45 s and is a
  violation at 90 s. **Unable flight following** (`uff`) denies it. That's
  for when you're busy: with fewer than 8 aircraft on your frequency you're
  reminded that vectors away from the finals are the better service.
- 6.5.2 / 6.5.3 They take vectors and altitudes. With no flight plan, hand
  them back with **Resume own navigation** ("Continue as filed" isn't
  offered).
- 6.5.4 **Frequency change approved** (`fc`) as it leaves your airspace and
  no longer affects your traffic: switching one more than 12 NM inside the
  edge, or in a conflict, gets a note. Leaving without it costs 2; with it,
  +3.
- 6.5.5 Never asked for an approach request: "Say intentions" to one is a
  violation, and "Expect approach" is refused with the options (vectors into
  the sequence, an early switch to Tower, or a leg of the pattern).

## Radio

- Arrivals check in with the ATIS letter. Approach replies with the
  altimeter and the expected runway. ATIS changes letter, and the altimeter
  drifts, at every wind shift.
- Heavies and Supers add "heavy" or "super" to their callsign. Data blocks
  tag them H/ and J/.
- Holding (no published holds exist here, so all holds are standard):
  *"hold east of ZUBUW, inbound course 279, right turns, expect further
  clearance 1617."* Legs are 1 minute at or below 14,000 ft and 1½ minutes
  above.

## Terrain (option)

The scope always shows land, water and terrain. The data comes from the
keyless Terrarium elevation tiles (AWS Open Data), the same source as
`terrainMode.js`; `approachTerrain.js` loads them. A coarse picture of the
whole airspace sits underneath, and a small tile engine (`TerrainTiles`)
fetches sharper tiles for whatever is on screen at the screen's own
resolution, from about 400 m per pixel zoomed out down to about 20 m
zoomed in. Terrain is drawn as flat,
smoothed height bands measured from the field's elevation, with a thin line
at the coast and at each band edge, inside the airspace only. The **Chart**
button switches to a light map like ifatc.org's; **Radar** is the dark
scope.

With **Terrain: On**:

- **Minimum vectoring altitudes** come from the real ground and are laid
  out the way TRACON MVA charts usually are: rings every 5 NM, cut into 30°
  wedges, with one area around the field. Each area gets 1,000 ft above the
  highest terrain within 3 NM of it, or 2,000 ft where the ground is rugged
  (more than 2,000 ft of relief). That is rounded up to the next 500 ft,
  with the field's floor as the minimum. Dashed lines mark where the MVA
  steps. Each run of equal areas is labelled once, in hundreds of feet.
- Assigning an altitude below the MVA where the aircraft is counts as a
  violation.
- An aircraft below the MVA triggers an automatic **low altitude alert**
  (7110.65 2-1-6 safety alert phraseology): −10. Aircraft established on the
  localizer, and departures or missed approaches still climbing, are
  exempt; their procedure protects them.
- An aircraft below the terrain is lost: −100.
- Arrivals spawn at least 1,000 ft above the MVA. Each exit gate's
  altitude clears the highest MVA within 10 NM of it, and is shown next to
  the gate.

With **Terrain: Off**, one minimum altitude (about 1,500 ft above the
field) applies everywhere.

## Weather (option)

- Storm cells drift with the wind aloft, building and decaying over 40–70
  minutes. They are drawn like weather radar: green, yellow, and red for the
  heavy core.
- A pilot who sees a red core within 8 NM ahead asks for a deviation:
  *"request 30 degrees left for weather."* Approve it with the card button
  or `dev`. The pilot turns, then reports "clear of the weather", and the
  aircraft needs a new clearance. No answer within 45 s and the captain
  deviates anyway (−5).
- Flying through a red core costs −5 for turbulence. On final inside
  8 NM, the aircraft goes around for windshear (no penalty).
- The ATIS carries a ceiling, visibility and gusts. Now and then the
  weather drops below CAT I ILS minimums (200 ft and ½ mile). Arrivals then
  go around at decision height (no penalty) until it lifts, after 5–8
  minutes.

## Positions

You pick any mix of **Approach**, **Tower** and **Ground** at the start.
Every aircraft is on one frequency at a time, and is handed on the way a
real one is:

- Ground at the gate.
- Tower at the runway's holding point.
- Departure (Approach) once airborne ("radar contact").
- Arrivals: Approach until established on the localizer, then Tower,
  then Ground once clear of the runway.

The system works every position you don't. Its clearances show greyed in the
log. You can't give clearances to aircraft on its frequencies, and its
traffic doesn't count against you.

- **Approach (system)** works like a TRACON arrival manager:
  - **Runways:** one flow at a time, no crossing runways at once. With
    parallels, the outermost runway on each side lands and the ones inside
    it depart, as at ATL, LAX or DEN (Real life; under Infinite Flight rules
    every runway does both, IFATC 3.6.1). Side-by-side finals are flown 1,000 ft
    apart (dependent parallels), and arrivals always take the runway on
    their own side when one exists, so nobody turns in across another
    final.
  - **Finals planned from the terrain:** the join altitude clears every MVA
    along the final, from the FAF out to 25 NM and 3 NM either side. The
    intercept point is where the glideslope is above that altitude, and
    never inside the approach gate plus 2 NM. The base point is 4 NM beside
    the final for a 30° intercept, pushed further out when an aircraft
    needs the miles to get down.
  - **Sequencing by time:** each arrival books a threshold time, first come
    first served, spaced by the radar or wake minimum plus 1.2 NM. Small
    delays are absorbed with speed (180 to 250 kt, within the legal band).
    Long ones go to a hold at the entry fix: a standard racetrack outside
    the fix (on the field side above 14,000 ft, where the legs get longer),
    stacked bottom-up. The lowest aircraft leaves first, the rest step down
    behind it, and each leaves at the moment that makes its time.
  - **Turn-in:** before clearing the ILS it checks the spacing by distance
    to the threshold against everyone on that final, and the 1.5 NM
    diagonal against a dependent parallel. If it's too tight, it extends
    the downwind until there's room.
  - **On final:** every 2 s it plays each follower and the aircraft ahead
    down to the runway, including the leader slowing to its approach speed.
    It gives the follower the fastest speed, no faster than its normal
    profile (210 / 180 / 160 kt by distance), that keeps 3 NM plus a margin,
    or clears its speed when there's room. It only ever slows the one behind
    (IFATC 6.15.6). Under Infinite Flight rules it can slow one to 10 kt above
    its approach speed; in Real life mode, no lower than 170 kt (5-7-3).
  - If even that won't keep the spacing and the follower is still more than
    8 NM out, it's turned off the final and re-sequenced. A go-around is only
    the last resort close in.
  - It keeps an established arrival on its own frequency until its closure on
    the one ahead is acceptable (IFATC 6.14.3), or the final approach fix. The
    system's Tower keeps up the same speed control on its final.
  - A visual approach (asked for, or at the turn-in) is cleared only when the
    aircraft's own way in fits the sequence: 3 NM plus a margin from
    everything on that final. Otherwise it stays on vectors.
  - **Conflict probe:** every 2 s it projects everything airborne 2 minutes
    ahead. When one of its own aircraft would lose radar or wake
    separation, it stops that aircraft at an altitude 1,000 ft clear of the
    other's whole climb or descent, never below the MVA 4 minutes ahead. It
    holds that altitude until 30 s after the conflict clears, so it never
    flip-flops.
  - **Terrain safety net:** anything it controls that will be below the
    MVA within 3 minutes on its heading climbs immediately. Missed
    approaches climb clear of the terrain along runway heading and go back
    to Approach. Weather deviations are approved with an altitude that
    clears the terrain on the new heading.
  - **Departures:** climb on the diverging heading Tower gave them until
    above every arrival join altitude and the terrain toward their gate,
    then go direct to the gate at its exit altitude.
- **Tower (system)**: clears arrivals to land inside 8 NM. It clears a
  departure for takeoff when all of these hold:
  - the runway is empty and no arrival is inside 4 NM;
  - the wake interval has passed;
  - 100 s have passed since the last takeoff clearance on that runway, and
    60 s since any.

  Each departure gets a heading 20° away from the other departure runways,
  or alternating sides off a lone runway (7110.65 5-8-3 diverging
  departures). It approves runway crossings when the runway is clear.
- **Ground (system)**: approves pushback when the pilot calls ready, and
  taxis departures to the runway ("contact Tower when ready") and arrivals
  to their gate. Tower (system) sends arrivals to Ground once clear.

## Ground

The taxi network is the airport's real OpenStreetMap layout: taxiways,
taxilanes, aprons and gates, the same data the live map draws.
`approachGround.js` turns it into a graph. Routes are the shortest path,
and the clearance reads out the taxiway names, e.g. *"runway 22R, taxi via
B, K, hold short of runway 13L/31R"*.

- **Drag and drop.** Drag a ground aircraft onto a runway, a taxiway or a
  gate dot. The route is drawn as you drag, with what the clearance will
  say ("Runway 31L via C K", "Gate 12 via B", "Via A, hold short of B") and
  red dots at runway hold-short lines. Release to transmit it.
  - On a runway: a departure taxis to that end's holding point (drop it
    toward the end you want).
  - On a gate: an arrival taxis there.
  - On a taxiway: taxi there and hold, e.g. *"taxi via A, hold short of B"*.
  - From a gate: pushback, the tail the way you drag (below). Onto the
    runway it is waiting to cross: cross it.
    A departure holding short, onto its runway: *contact Tower* (on Ground)
    or *line up and wait* (on Tower).
- Departures call ready to push at a gate. You approve pushback, the pilot
  reports ready to taxi, and you clear them to their runway.
- **Pushback** is a real push: straight back off the stand (up to about
  240 ft), then the tug swings it round so the tail ends up along the
  taxilane, about 180 ft down it, nose the other way. It moves at about 4 kt,
  so the whole push takes about a minute. Hold position works during it.
  - **Automatic**: plain *pushback approved* picks the tail for you, away from
    its route to the runway, so it ends nose-first toward its runway:
    *"pushback approved, tail south"*.
  - **Drag**: drag the aircraft at its gate toward where the tail should go.
    It snaps to the nearest taxilane direction, shows the push path dashed
    with an arrow, and reads *"Pushback approved, tail east"*. Let go to send
    it.
  - **Pushback, tail…** on the card lists each way it can go, and typed `pb e`
    (or `pb tail sw`) picks the closest to that direction.
  - **Pushback approved, expect runway…** lets you pick the runway: the ones
    in use first (the one it filed for on top), then any other with a holding
    point, marked "(not in use)". It then taxis to that one, and the automatic
    tail follows it. Typed: `pb 28L`, or `pb tail e 28L`.
- Zoom goes in to about 3,000 pixels a mile, close enough to watch a push
  (aircraft icons grow to their real size). Tell them
  **contact Tower when ready** on the way (or **contact Tower** once they're
  holding short). Without it they report holding short to Ground and wait,
  and Tower can't clear them.
- Arrivals roll out (braking to a 30 kt roll, then slowing for the turn-off),
  turn off at the first exit past their stopping distance (about 0.9 NM for
  a jet, ¼ NM for a Cessna), and
  report clear of the runway to **Tower**, who tells them **contact Ground**.
  You then taxi them to their gate. They park and leave after about 25 s.
- Headings are for airborne aircraft only: dragging a target on the ground
  never gives one, and the card has no heading on the ground.
- Commands: `tx` (taxi to the usual place), `tx 31L`, `tx 12` (a gate),
  `pb`, `hp` / `ct` (hold position / continue), `cr` (cross), `mt` (contact
  Tower), `mg` (contact Ground).
- **Starting traffic** on the start screen sets how many aircraft are
  already on frequency when the shift opens: none, a random number, or a
  set count (1 to 20). New traffic keeps coming at the Traffic level:

  | Level | A new aircraft about every | At most at once | Departures on the ground |
  |---|---|---|---|
  | Light | 80 s | 8 | 4 |
  | Normal | 50 s | 14 | 6 |
  | Busy | 32 s | 20 | 9 |
  | Event | 20 s | 28 | 12 |

  The gaps shrink by up to 45% over the first ninety minutes. About 45% of
  new traffic is departures, while the holding-short queue is short.
- A route that crosses a runway stops at the hold-short line, and the pilot
  asks **Tower** to cross. Crossing clearances are always Tower's.
- Pilots stop behind traffic ahead (about 85 m). If two aircraft meet nose
  to nose, they wait 25 s and then one squeezes by, which costs points.
  *Hold position* and *continue* let you sequence them yourself.
- Anything on a runway while another aircraft takes off or lands on it is a
  **runway incursion** (−30 if you work Tower). The exception is lining up
  and waiting behind a departure that is already rolling.
- The taxi map comes from the sources the live map itself uses
  (`approachTiles.js`). All three are asked at once, and the fullest
  network built from them is kept:
  - **Taxiways** from OpenFreeMap's keyless vector tiles (the live map's
    free engine and 3D taxi view): the OpenMapTiles `aeroway` layer at z14,
    `class` taxiway/apron/gate with `ref` letters. No Mapbox token is used.
    The tiles are decoded by a small built-in reader, and since they cut and
    simplify lines, the network builder splits crossings, joins line ends
    that stop on another line, and merges points within ~11 m. If the lines
    can't be joined into a network to taxi on, they're still drawn on the
    scope (Ground is then unavailable).
  - OpenFreeMap's tiles carry taxiways but not the **taxilanes** between
    the terminals, so OpenStreetMap is always asked too. Overpass can take
    a minute at a big field (the live map simply waits), so the shift starts
    on OpenFreeMap's network and OpenStreetMap's replaces it when it
    arrives, if fuller ("Taxilanes in" in the log). OpenStreetMap's layout
    is then kept on the device for two weeks, so the next shift at that
    airport has it at once.
  - Each stand gets a lead-in to the closest point on a taxiway or taxilane
    within ~550 m that doesn't pass through a building (the edge is split
    there), instead of a line to the nearest junction.
  - **Gates** from our backend's `/api/gates/{ICAO}`, the same data
    the live map uses for departure and arrival gates.
  - **OpenStreetMap** (three Overpass servers, plus the live map's own
    airport request) as a fallback. The log says what came back, e.g. "Surface: 412
  taxiway segments, 96 gates, holding points at 8 of 8 runway ends".
  Gates up to about 650 m from a taxiway are connected. With no usable
  gates, stands go on the aprons or at dead-end taxilanes.
- With no taxi map at all (every server down, or a field OSM hasn't
  mapped), the log and a banner say why and the Ground position is
  unavailable. Departures then start at the runway, and
  arrivals leave the scope on landing.

Scoring by position:

| Position | Event | Points |
|---|---|---|
| Ground | Departure delivered to the runway | +3 |
| Ground | Arrival parked at its gate | +3 |
| Tower | Takeoff | +3 |
| Tower or Approach | Landing | +10 |
| Approach | Departure out through its gate | +10 |

## Waypoints and procedures

Every airport has waypoints and procedures, from one of three sources:

1. **Hand-built** by the InFlight team (`nav/custom/<ICAO>.json`). These
   take priority, section by section: a file with only STARs keeps the other
   sections from below. The authoring guide is `docs/NAV-AUTHORING.md`.
2. **Published (US)**: FAA data, below.
3. **Generated** everywhere else (`approachNavGen.js`), around the real
   navaids:
   - STARs from four directions, each starting at a real VOR (else NDB) in
     that sector 24–37 NM out when there is one (at Heathrow: LAM, MID, CPT,
     CFD), else at an invented fix;
   - SIDs to four exits between them, likewise, each with a transition for
     every runway end;
   - an ILS (runways of 5,000 ft or more) and an RNAV (GPS) approach on every
     runway end: IF at 10 NM, FAF at 5 NM, T-bar IAFs;
   - the real navaids within 45 NM as waypoints.

   They're seeded by the ICAO, so a field's procedures are the same every
   shift. The navaids are every VOR, NDB and DME in the world from
   OurAirports (public domain): `npm run build:navaids` writes
   `nav/navaids.json` (about 11,000, 113 kB compressed), and it is loaded only
   at airports without published data. Generated altitudes don't know the
   terrain: with Terrain on, the MVAs and the system's terrain safety net
   still apply.

The Layers panel says which source is on the scope.

At US airports the fixes and procedures are real, from FAA data: the
current AIRAC cycle of the FAA's CIFP (SIDs, STARs, instrument approaches)
and NASR (waypoints, navaids), via the MIT-licensed `@squawk/procedure-data`,
`@squawk/fix-data` and `@squawk/navaid-data` npm packages.

- `npm run build:nav` (`tools/build-nav.mjs`) writes `nav/<ICAO>.json` for
  every US airport with a SID, STAR or ILS (about 1,100 airports, 16 MB in
  all, 35–110 KB each) and `nav/index.json` with the cycle date. Re-run it
  every 28 days.
- **Entry fixes** are where each STAR enters the scope. Arrivals check in
  "descending via the PARCH4 arrival" and fly it, with its altitude and speed
  constraints, until given a heading, a direct, a hold or an approach
  (`dv` / "Descend via" resumes it; an altitude ends only the vertical part).
  At the end of the STAR they ask for vectors.
- **Exit gates** are where the SIDs end. Departures are cleared with the SID
  for their runway ("SKORR6 departure, cleared for takeoff") and fly it after
  takeoff, climbing via it to the exit altitude, unless given a heading
  (`cv` / "Climb via" resumes it).
- **Approach fixes** are each runway's ILS intermediate fix (e.g. ROSLY for
  22L at JFK), and the other fixes the procedures use are drawn as small
  waypoints, for direct-to and holds (the Direct to list shows the 24
  nearest).
- **Layers** (the button by Targets) sets what's drawn:
  - waypoints on, dim or off (off also hides them from tapping);
  - a brightness slider for the plotted procedures;
  - "Runways in use" (the STARs, the SIDs off the departure runways and the
    ILS/LOC for the landing ones, updated when the runways change), All, or
    None;
  - every STAR, SID and approach at the field as a button, to plot or hide
    it. Plotted procedures show their route, their name, and each fix's
    altitude constraint once zoomed in.
  Choices are kept on the device, per airport.
- Airports with too little routing (fewer than two STAR entries or two SID
  exits) fall back to the game's invented fixes.

## Controls

The controls work the way the Infinite Flight ATC client does.

- **Tap** an aircraft, its strip, or a log line that names it. The aircraft
  gets a purple ring and a line to the side panel. The aircraft list there
  turns into its command menu.
  - **The menu**: numbered items with sub-menus (›) and a back arrow.
    Airborne, it offers:
    - the pilot's request first, in green. Arrivals check in asking for
      an approach and runway (*"requesting the ILS approach runway 31L"*, or
      *"radar vectors for…"* without a filed STAR). The answers:
      - *"expect the ILS approach runway 31L, continue as filed"* (only with
        a filed route);
      - *"expect vectors for…"*;
      - another approach;
      - clear it now;
      - unable.
    - Vectoring instructions: fly heading, climb or descend, direct to,
      hold at, 360s, descend or climb via;
    - Request speed;
    - Expect approach: each type, then the runways, the one the pilot asked
      for first. With a filed route each runway also comes as *"…, continue
      as filed"*;
    - Contact other frequency: Tower once it's cleared for an approach, or
      frequency change for a departure;
    - Clear for approach;
    - Ask for intentions (the pilot says what it wants);
    - Misc. messages;
    - Missed approach instructions: runway heading and an altitude. A go
      around then climbs to it;
    - Continue as filed: back onto its STAR (or SID, or exit) after
      vectors;
    - Go around.

    On the ground and the runway it offers:
    - pushback and taxi;
    - Contact Tower or Ground;
    - hold position and continue;
    - progressive taxi, give way and follow;
    - runway crossings;
    - takeoff, line up and wait, hold short and number for departure.
  - **The tile** under the menu is the likely next call: pushback, cleared
    for takeoff, cleared to land, the pilot's request. It's one tap.
  - **✕** goes back to the aircraft list.
- **Flight plans.** Every aircraft has one, shown as **FPL** at the top of
  its menu (*"ROBER PARCH4 ZACHS KJFK/31L"*, or *"KJFK/31L DEEZZ6 CANDR"*).
  When it's selected, the rest of the route is drawn on the scope as a
  dashed line with its fixes named.
  - An arrival's plan: its STAR (or its entry fix), then its runway's
    approach fix.
  - A departure's plan: its SID, then its exit.
  - **Continue as filed** puts an aircraft back on that route after
    vectors. An arrival without a STAR flies the filed fixes at its present
    altitude.
- **Hold** a target (long press) for the quick menu:
  - Assign Altitude;
  - Hold;
  - Set Reminder (its strip asks for you when it's due);
  - Show Information;
  - Assign Color (yellow, red, blue, green);
  - Tag Placement (right, left, above, below).
- Nothing in the game can be selected or copied, and a held finger brings no
  callout, so a long press or a drag never turns into a text selection.
- The command line is still there for keyboard players. The arrow keys turn
  the selected aircraft 5° (10° with Shift) or climb and descend it 1,000 ft.
- **Drag** an airborne target:
  - to give a heading. The line shows the heading, the distance and the
    minutes to the end of it. Let go and an altitude ladder opens beside the
    aircraft: pick the altitude, or keep the one it has. The altitude it's
    at now is green. One transmission:
    *"turn left heading 030, descend and maintain 4,000."*;
  - onto a fix for direct to it;
  - onto an arrival runway's final approach course for the ILS (the
    intercept heading is worked out, aimed at the point dropped on, no
    steeper than 30°; the label goes red when it can't be joined from
    there, and warns when it would join inside the gate);
  - onto its runway, once on the localizer, for cleared to land.
- **Drag** a departure at the runway onto it: line up and wait, then cleared
  for takeoff. On the ground, see Ground below.
- **Map buttons**, bottom right as in Infinite Flight: settings (the gear),
  zoom in, zoom out, recenter, and the airport. They fade after four
  seconds without a touch and come back on the next one.
- **Settings** sit behind the gear button:
  - speed (pause, 1×, 2×, 3×, 4×);
  - map (Radar or Chart);
  - traffic as targets or aircraft;
  - voice, map layers and End shift.
- **Paused**: tap the PAUSED tag to resume at the speed you were on.
- **Sideways phones**: the scope sits beside the aircraft list as on a
  desktop, the site header hides during a shift, and the info box starts
  folded.
- **Upright phones**: the whole game fits on one screen with no page
  scrolling. The scope is on top; the aircraft list and log are below, each
  scrolling on its own.
- **Add to Home Screen** (iOS Safari: Share → Add to Home Screen) installs it
  as an app called Approach, with its own icon (`approach.webmanifest`). It
  opens full screen:
  - no Safari bars and no site header;
  - kept clear of the notch, the status bar and the home bar.

## Infinite Flight's Tower and Ground commands

The command menus follow the lists in the IF community guide *Guide into ATC
instructions (Tower & Ground)*, with the same groups and, under Infinite
Flight rules, the same wording. Each command also does something to the
aircraft wherever there is something to do.

- **Pushback**:
  - *pushback approved, tail south, expect runway XX* (you pick XX);
  - *pushback approved, tail south*;
  - *Pushback, tail…*: each way it can push.
- **Taxi to…**:
  - *taxi to runway XX, contact tower when ready*;
  - *taxi to parking, at your discretion*.
- **Progressive taxi**:
  - *expect progressive taxi instructions*;
  - *cross runway XX* (plus *please expedite*);
  - *turn left/right next taxiway*;
  - *continue straight ahead*;
  - *make 180*;
  - *continue taxi at your discretion*;
  - *follow aircraft ahead*.
- **Give way**: *give way to aircraft exiting runway XX / on your left / on
  your right / ahead*, phrased from where the other aircraft is.
- **Cleared for takeoff…**:
  - *(wind), runway XX, cleared for takeoff*;
  - *…cleared for immediate takeoff*;
  - *…cleared for takeoff. Fly runway heading until at or above X,XXXft*
    (1,000–5,000 ft above the field), on its own or with *immediate*.
  - Pattern work also gets *make left/right traffic*.
- **Line up and wait runway XX**, **hold short runway XX**, **you're number
  X for departure**, and **cancel takeoff clearance, hold position** (too
  late above 100 kt).
- **Back taxi…**: *back taxi runway XX* (*, line up and wait*, *, please
  expedite*). A departure at an intersection backtracks to the full length
  and lines up.
- **Exit runway…**: for an arrival rolling out:
  - *when able turn left/right* or *exit runway when able*, then
    *contact ground when off the runway*;
  - each can add *please expedite* (harder braking), *cross runway XX and
    contact ground* (the first crossing is pre-cleared), or *hold short
    runway XX* (no handoff).
  - It takes the first turn-off on that side it can make.
- **Cleared to land / option…**:
  - *number X, runway XX, cleared to land*;
  - *number X, runway XX, cleared for the option[, make left/right
    traffic]*. The option means a touch and go; with a traffic direction
    the next circuit goes that way.
- **Pattern instructions**:
  - *enter [leg], runway XX* (the entry adds *number X, traffic to follow is
    on [leg]* when someone is ahead);
  - *turn crosswind*;
  - *extend upwind, I'll call your crosswind*;
  - *turn base*;
  - *extend downwind, I'll call your base*;
  - *make short approach*;
  - *make left/right traffic*;
  - *descend to pattern altitude*;
  - *cancel landing clearance, number X, traffic to follow is on [leg]*;
  - *number X, traffic to follow is on [leg]*.
- **Request speed**:
  - *maintain 160/170/180 knots until 4/5/6 mile final* (more choices
    under Real-life rules);
  - *speed at your discretion* (lifts restrictions);
  - *maintain present speed*;
  - *maintain slowest practical speed*;
  - *maintain best forward speed*;
  - *adjust speed to follow aircraft ahead* (matches it until the final
    approach fix);
  - then exact speeds.
- **Go around…**: *go around*, or *go around, make left/right traffic runway
  XX*. With a traffic direction it stays with Tower and flies the pattern
  round.
- **Make a 360 for spacing**.
- **Deny entry**:
  - *due to heavy traffic, airport is not accepting incoming airplanes at
    this time*;
  - *an event is in progress, please contact approach for sequencing*.
  - Either way the aircraft turns away and leaves without counting against
    you.
- **Misc. messages**: Ground's and Tower's lists, word for word.
  - *Please expedite* speeds the aircraft up for a while: taxiing, braking,
    climbing and descending.
  - *Unable, divert*, *aircraft too large* and *no light aircraft* send it
    away.
  - *No pattern work*, *pattern full* and *no more pattern work, land or
    divert* end its pattern work.
  - The rest (follow instructions, check ATIS, traffic alert, stay on my
    frequency…) are read back.
- **Standby / corrections**: *standby* (its request stops flashing for 45
  s), *correction, standby*, *disregard last message*, *say intentions*.
- **Broadcast** (on the frequency list): all twelve *Attention all aircraft,
  …* messages, such as *ATIS information X is now current*, *runway change
  is in progress* and *airport is busy, expect delays*.

Not modelled: back taxi for arrivals (*back taxi runway XX, contact ground
when off the runway*), and the On Guard messages.

## Rules: Real life or Infinite Flight

The start screen picks the rule set (`RULESETS` in `approachGame.js`, one
line per switch).

- **Real life (FAA)**: everything in this document.
- **Infinite Flight (IFATC)**: plays the way IFATC controls on the Expert
  Server, and leaves out what Infinite Flight doesn't have.
  - No wake turbulence (the sim doesn't model it), so there are no wake
    minima on final and no 2/3-minute departure intervals behind heavies.
  - 3 NM / 1,000 ft radar separation throughout, without the 2.5 NM in-trail
    reduction.
  - Taxi clearances by runway or parking ("taxi to runway 27L"), with the
    route dragged on the map as IF's drag-and-taxi does. "Contact Tower when
    ready" stays.
  - Speed control, including "maintain slowest practical speed" (also
    available in Real life mode).
  - No emergencies, no storm cells or deviation requests, and no forced
    go-arounds below ILS minimums. The ATIS still carries the wind and
    visibility.
  - Messages drop the FAA paragraph numbers, and violations are labelled
    "IFATC procedure".

**Ground, from the IFATC manual (sections 2.1–2.3):**

- 2.1.3 Pushback only with the area clear: pushing back with traffic moving
  right behind the stand is a violation. Use "hold position" or "give way"
  first.
- 2.1.6 Departures are sent to the closest runway in use.
- 2.2.1 **Give way**: drag one ground aircraft onto another, or pick it from
  the card (`gw AAL123`). It stops while the other is close and still
  coming, and carries on once it's past.
- 2.2.2 The default commands are "Taxi to RWYXX, contact tower when ready"
  and "Taxi to Parking". Drag and taxi gives a specific route, and jets go to
  Tower at the runway either way. Ground issues each **runway crossing**,
  one at a time: the next runway can't be cleared until the aircraft has
  crossed the one before.
- 2.2.4 No gates are assigned: arrivals taxi to parking and the pilot picks
  the spot.
- 2.2.5 **Progressive taxi**: expect progressive taxi instructions, turn
  left/right next taxiway, continue straight ahead, make a 180, follow
  aircraft ahead, then "continue taxi at your discretion" (`ept`, `tl`, `tr`,
  `sa`, `180`, `fol AAL123`, `cyd`). Each leg runs to the next junction,
  where the pilot holds and asks for further instructions.
- 2.3.1 Runways are named in the direction in use ("cross runway 18", not 36).
- 2.3.2 A crossing is a violation if a departure is rolling toward the
  crossing point, or an arrival is over the threshold and neither past the
  crossing point nor exiting before it.
- 2.3.3 Anticipated crossings: "Cross runway" works before the aircraft
  reaches the hold-short line.

**Tower, from the IFATC manual (section 3.1):**

- 3.1.1 Separation, on the same runway, applied when a takeoff roll starts
  and when an arrival reaches the threshold:
  - **Departure/Departure**: the first must be airborne before the second
    rolls. A second roll too early is a violation.
  - **Arrival/Arrival** and **Departure/Arrival**: the runway must be clear
    of the first (airborne, or clear of the runway edge) before the second
    crosses the threshold; otherwise it goes around.
  - **Arrival/Departure**: the arrival must be clear of the runway edge
    before the departure rolls.
  - **Intersecting runways**: traffic rolling, rolling out or within 1.5
    miles of landing on a crossing runway must be beyond the intersection
    before a departure is cleared or an arrival lands (this applies in Real
    life mode too, 7110.65 3-9-8 / 3-10-4). Crossing extended centerlines
    aren't checked yet.
- 3.1.2 **Anticipated takeoff clearances**: you can clear the next departure
  while the one ahead is still rolling; 3.1.1 is checked when it actually
  rolls. The system's own Tower doesn't anticipate.
- 3.1.2 / 3.1.3 **Cancel takeoff clearance** (`cxto`, or the button while
  rolling or lining up to roll): lining up, it becomes line up and wait;
  rolling below 100 kt, a rejected takeoff, after which it taxis back to
  hold short; above 100 kt, "unable".
- 3.1.4 **Maintain slowest practical speed** is refused within 4 miles of
  touchdown: it's already at final approach speed, and a go-around may be
  the only option left.

**Departures, from the IFATC manual (section 3.2):**

- 3.2.1 **Hold short** (`hs`) answers a departure that can't be cleared or
  lined up yet. Unanswered, it calls again after a minute.
- 3.2.2 **Departure sequence**: "number N for departure" (`seq`) by the order
  they reached the runway. A lined-up aircraft counts as number 1. Number 1
  always gets "hold short".
- 3.2.5 **Intersection departures**: drag a departure onto its runway at a
  taxiway that meets it part way along. The label shows the runway left
  ("Runway 31L at K (8,400 ft)"); under 6,000 ft is refused.
- 3.2.6 Jets are ready at the runway. Ground hands them to Tower as they
  approach it, and Tower can line them up or clear them before they stop
  (the clearance applies when they reach the runway).
- 3.2.7 **Immediate take-off** (`ito`) lines up and rolls faster. It's for
  an arrival close in on final (within 3 miles on the same runway); used
  otherwise, it's a violation.
- 3.2.8 Arrivals on the localizer show their distance from the threshold in
  the data block (e.g. `LOC 22L 3.4`).
- 3.2.11 Departures stay with Tower after takeoff. **Frequency change
  approved** (`fc`, or the button) hands them to Departure: before half a
  mile past the runway end it's a violation (critical phase), and not done
  by 3 miles past, it happens anyway for −2. The system's Tower does it at
  half a mile.

**Inbounds, from the IFATC manual (section 3.3):** with **Inbounds: Pattern
entries** on the start screen (either rule set, when you aren't working
Approach), there's no radar controller. Use it to practise pattern entries:

- Arrivals call Tower directly: "inbound on the ILS runway 10L" when lined
  up with a final, otherwise "inbound for landing, 18 miles west".
- 3.3.1 Every one needs a **pattern entry** and a **landing clearance** at
  minimum: straight in, left/right downwind or left/right base, for any
  landing runway (the Pattern entry list, or `ent DL 28R`).
  - A downwind or base entry joins the traffic pattern itself (below): at
    45° to midfield downwind, or onto base, at pattern altitude.
  - A straight-in joins final from 6.5 miles.
  - Cleared to land can come with the entry.
- 3.3.2 **Continue inbound** (`ci`) is fine while you decide, and a pattern
  entry without a sequence too, with **Number N** (`no`) added later. But by
  8 miles out it must have an entry: if not, it's a violation and it orbits
  until it gets one.
- 3.3.4 A runway change cancels the entry and the clearance: a new pattern
  entry and clearance are needed.
- Go-arounds stay with Tower and need a new entry.
- With no radar, and for pattern traffic and transitions always, two
  aircraft both with Tower only count as a conflict inside 1 mile and 500
  ft. Tower sequences them, so radar minima don't apply. (This threshold is
  the game's own: the manual extract doesn't give one.)
- If the system works Tower, it gives each inbound a straight in and a
  landing clearance at 15 miles.
- Departures handed off with "frequency change approved" go on their own
  navigation (there's no Departure).

**The traffic pattern (IFATC 3.4):** with **Pattern work: On** and you on
Tower, light aircraft and the odd jet do circuits off your runway.
- **When**: only in visual conditions (3 SM or better), and not while the
  ATIS says *No pattern work*. More of them at busier traffic levels (1 to 4
  at once).
- **The pattern**: upwind, crosswind, downwind, base and final.
  - **Height**: props at 1,000 ft above the field, jets at 1,500 ft.
  - **Downwind width by size**: as wide as the aircraft's own 180° turn at
    pattern speed (90 kt props, 220 kt jets), so it rolls out on downwind and
    final without overshooting. The FAA's guidance is about ½–1 NM out for
    light aircraft and wider for bigger, faster ones. Here: a Cessna about
    1 NM, E175 3.1, A320, 737, 757 and 787 3.4, 777-300ER 3.9, A380 4
    (1–4 NM).
  - **Speeds**: props 90 kt on downwind and 80 on base; jets fly the
    conservative speeds of IFATC's practical test: 220 kt downwind and 190 on
    base, slowing to the final approach speed.
  - **Base**: far enough out to roll out on a stabilised final: 4 NM of
    final for jets (on the glidepath by 1,000 ft), so they turn base about
    5 NM from the threshold; props about 1.5 NM. Never inside the point
    where the threshold is 45° behind. A short approach brings it in (3 NM
    of final for jets).
  - **Turns** start a turn radius early, as a pilot leads them. Turning in on
    a visual or the pattern, an aircraft that hasn't captured the centerline
    yet turns in at up to 45° (before, it dropped the approach and flew on).
  - **Descent** starts on base, onto a 3° path.
- **Departing**: they hold short *"…ready for departure, remaining in the
  pattern"*, and the takeoff clearance carries the direction: *"make right
  traffic, cleared for takeoff"* (left if none is given).
- **Landing clearance**: on downwind they want one, shown as ATC (1).
  - *Cleared for the option* or *cleared touch and go* means a touch and
    go, then round again.
  - *Cleared to land* means a full stop.
  - After a few laps they ask for a full stop themselves.
  - No clearance by short final and they go around, then fly upwind and
    rejoin.
- **Sequencing and shaping**:
  - *Number N, follow the Cessna on base* (the "Number, follow traffic…"
    list). It won't turn base until the traffic it follows is on final
    with room behind it, and would be on the runway a minute or more ahead
    (a jet behind a 65 kt Cessna waits longer).
  - See-and-avoid: traffic on base or final has the right of way, so no one
    turns base to reach the runway within about 70 s of it, even from a
    longer final. On the downwind they slow (as far as the type can) to
    keep their spacing behind traffic ahead on the same downwind.
  - *Extend downwind*, *turn base*, *make short approach*, *make left/right
    traffic* (on upwind or crosswind), *left/right 360*.
  - An extended downwind past 7 miles asks for base.
- Inbounds given a downwind or base entry fly the same pattern, for a full
  stop.

**Transitions (IFATC 3.4.2–3.4.4):** with Pattern entries (no radar), VFR
light aircraft crossing the field call at about 12 miles: *"request
transition through your airspace southbound"*.
- **Answers**: *Transition approved* (at its altitude), *transition approved,
  maintain 3,500*, or *unable transition, remain clear*.
- **Waiting**: unanswered by 6 miles, it orbits outside.
- **Rules**:
  - an approval above Tower's airspace (5,000 ft above the field) breaks
    3.4.3;
  - one less than 500 ft above the pattern traffic breaks 3.4.4.

Not modelled: "Flight of XX" formations (3.4.5).

Not modelled: back-taxi (3.2.4), multiple aircraft lined up at once (3.2.3),
and "Straight Out Dept." in the ATIS (3.2.9–3.2.10).

**Tower working with Radar (IFATC 3.6):** with Approach open (yours or the
system's), under Infinite Flight rules.

- 3.6.1 **All runways**: Radar lands and departs on every runway in the
  flow, not outer-lands, inner-departs. Side-by-side finals stay 1,000 ft
  apart, and an arrival turns in across another final for an inside runway
  when that saves it a couple of minutes.
- 3.6.1 **5 miles at busy times**: with a departure waiting for a runway, the
  system's Approach leaves 5 miles between arrivals on it, room for one to go.
  It watches the queue itself. The system's Tower asks your Approach for a
  5-mile gap (6 in Real life mode).
- 3.6.1 **Runway changes**: re-clearing an ILS or GPS arrival onto another
  runway once it's with Tower is flagged: keep them to a minimum.
- 3.6.2 **Pattern work stays with Tower**. **Contact Approach (radar
  pattern)** (`rp`) on a circuit is refused unless pattern work is denied (No
  pattern work on the ATIS). Then it asks Approach for a radar pattern:
  - the system's Approach takes it when it has 6 or fewer aircraft (9 with
    three departures waiting, for Tower's sake), and vectors it round for a
    full stop;
  - otherwise it says unable and sends it back to Tower for a full stop;
  - your Approach answers it like any request.
- 3.6.3 What Tower gives an arrival from Radar:

  | Handed over on | Pattern entry | Sequence | Clearance |
  |---|---|---|---|
  | ILS / GPS | No | No | Yes |
  | Radar vectors | Yes | If not number 1 | Yes |
  | Flight following | Yes | If not number 1 | Yes |
  | Visual | No | If not number 1 | Yes |

  - ILS and GPS arrivals: a pattern entry or "number N" is refused, and the
    landing clearance drops the number ("runway 28R, cleared to land").
  - Visuals: no pattern entry; **Number N** is on the card until cleared.
  - **VFR inbounds** (light aircraft, in VMC) call Approach for vectors to the
    field or flight following. The system's Approach gives radar contact and
    hands them to Tower at 12 miles: *"…12 miles east, 4,500, inbound for
    landing with you on radar vectors"*. Then it's as 3.3: a pattern entry by
    8 miles (or a violation, and it orbits), a sequence when needed, and the
    clearance. A go-around stays with Tower and needs a new entry.
  - Your Approach can hand any arrival over that way within 15 miles in VMC
    (**Contact Tower (radar vectors)**). Still with you at 6 miles, a VFR
    inbound orbits once and asks for Tower.

Not modelled: the Tower controller handover frequency (3.6.1).

The Radar sections of the manual (4.x) aren't in yet, so Approach follows
Infinite Flight's features and community guidance. Where the manual says
otherwise, change that line in `RULESETS`.

## Emergencies (option)

On by default ("Rare"); the start screen turns them off. About one flight in
45 declares, once it's settled: an arrival more than 10 NM out, or a
departure climbing through 1,500 ft (which then returns to land).

- Mayday (engine failure, low fuel, smoke) or pan-pan (medical, hydraulics,
  bird strike), with souls on board, as a pilot would say it. The target and
  its strip turn red and the data block reads MAYDAY or PAN.
- It refuses holds and 360s. Engine and hydraulic failures cap its speed.
- The system's Approach puts it first in the sequence, on a short base
  2.5 NM off the final, and re-spaces everyone else behind it.
- Once it's down, +10, and the runway closes for two minutes while the fire
  crews inspect it.

## Coordination

Where the system and the player share the airport, the system's controllers
adapt to the player instead of pushing traffic into them. Their questions
appear in a box on the scope (and in the log, in purple), and take the
highlighted answer if left for 45 s.

- **System Approach → your Tower**: asks once how you want arrivals on final:
  tight (3 NM), gaps every time, or gaps only when two or more departures are
  waiting. The answer is remembered between shifts. Every arrival you have
  to send around (runway occupied, no landing clearance) adds a mile in
  trail on that final, up to four. After two, it offers gaps every time.
  Ten quiet minutes take half a mile back off.
- **System Tower → your Approach**: with three departures holding, asks for
  a 6-mile gap; give one and it thanks you (+5) as a departure rolls.
- **System Tower → your Ground**: with five departures queued for a runway,
  asks you to hold them at the gate for three minutes. Sending one anyway
  costs 3.

## Tower practical test (IFATC)

A mock of IFATC's Tower practical: **Practical test** at the top of the
start screen's panel, then one of the test airports (EDDH, EGCC, KPDX,
KSJC). You work Ground and Tower together, under Infinite Flight rules,
with no radar (inbounds call you for a pattern entry), no weather,
terrain, emergencies or random traffic. The wind is set at random each
time (5–18 kt), so the runways change from one try to the next. As IFATC sets the test, nothing is bigger than a 757, and the jets
fly conservative patterns: downwind 210–250 kt, base 180–210, final
160–180.

**The seven pilots** call in this order (seconds after the taxi map is in):

| Pilot | When | What |
|---|---|---|
| D1 · 737-800 | 0:05 | Departure. Once pushed, asks for another runway: *Runway X approved* or *Unable runway X, expect runway Y* (Ground menu). |
| D2 · A320 | 0:25 | Departure. |
| P1 · Cessna 172 | 0:50 | Pattern work: a pattern departure, touch and go, then a full stop. |
| A1 · 737-800 | 2:00 | Inbound from 16 NM, needs a pattern entry. |
| A2 · E175 | 3:20 | Already lined up on a 13 NM final. |
| T1 · SR22 | 4:20 | VFR transition request from 15 NM. |
| A3 · CRJ-700 | 5:30 | Inbound from 16 NM with an old ATIS letter. |

**Marking.** The examiner marks each element of the test and writes down
every error, with the time:

| Element | A major error (fails the test) | Minor errors |
|---|---|---|
| Pushback | | Pushing into moving traffic (2.1) |
| Taxi | | Ground conflicts, a runway with a tailwind, a pilot left waiting over 2 minutes |
| Departure | | No left/right traffic for a pattern departure, other 3.1–3.2 rules |
| **Aircraft Separation** | Any loss of separation; a takeoff with the runway not clear (3.1.1); a crossing into traffic (2.3.2) | |
| Runway Usage | | A runway request left unanswered; only one runway used (4.1.4) |
| Pattern | An arrival never cleared to land | No pattern entry (3.3.2), other 3.3–3.6 rules |
| Transition | | Not answered before it had to orbit; 3.4.2–3.4.4 |
| **Go-Around** | An arrival that had to go around on its own (runway occupied, crossing traffic) | |
| Runway Exit | | No exit instruction (a note if *expedite* would have helped) |

The two elements in bold are automatic failures: IFATC marks them in red.
Any major error fails the test; otherwise up to three minor errors pass.
It also fails if not every pilot is handled within 60 minutes (of game
time: the speed buttons work), or if you end it early.

**The report** shows PASS or FAIL, each element (✓, minor, ✗), and the
examiner's notes, including what went well (a runway change facilitated,
an ATIS recheck asked for, an anticipated takeoff clearance). **Retake**
starts it again; scores and best scores aren't kept for a test.

## Not modelled

Obstacles (towers, buildings) in the MVAs, and real published MVA charts (the
game derives its own from terrain). Visual approaches. SIDs, STARs and
published holds. Intersection departures, high-speed exit geometry, and
de-icing. Small (under
41,000 lb) aircraft, and the small-behind-large rules that come with them.
