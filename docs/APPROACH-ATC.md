# Approach — the ATC rules the game follows

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

## Speed

- 250 kt maximum below 10,000 ft (14 CFR 91.117).
- Minimum assignable speeds for turbojets (5-7-3): 250 kt at or above
  10,000 ft; 210 kt below; 170 kt within 20 flying miles of the threshold;
  departures 230 kt. Lower assignments are raised to the minimum, with a
  note in the log.
- No speed adjustments inside the final approach fix or 5 NM from the
  runway (5-7-1).
- An approach clearance cancels assigned speeds unless they are restated
  (5-7-1). Restated speeds are held to the 5-mile final. Otherwise the crew
  flies its own profile: 210, then 180 inside 15 NM, 160 inside 8 NM, and
  Vapp inside the FAF.
- Holding speeds: 200 kt to 6,000 ft, 230 kt to 14,000 ft, 265 kt above
  (AIM 5-3-8 maximum holding speeds).

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

## Not modelled

Terrain and MVA charts (the game uses one minimum altitude, about 1,500 ft
above the field). Weather minima and visual approaches. SIDs, STARs and
published holds. Tower/approach handoffs as separate positions; you are
both. Runway exits and taxiing. Intersection departures. Small (under
41,000 lb) aircraft, and the small-behind-large rules that come with them.
