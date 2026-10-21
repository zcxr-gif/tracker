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

- **Approach (system)**: sequences arrivals to a base point 16 NM out and
  3 NM off the final, about 110 s apart (150 s behind a heavy). It holds
  arrivals at their entry fix when the sequence is full, then turns them in
  at 30° with "maintain until established, cleared ILS". It climbs
  departures on runway heading until 3,500 ft above the field, then sends
  them direct to their gate at the exit altitude. It approves weather
  deviations.
- **Tower (system)**: clears arrivals to land inside 8 NM. It clears a
  departure for takeoff when the runway is empty, no arrival is inside
  4 NM, the wake interval has passed, and the last departure from that
  runway left 75 s ago or more. It approves runway crossings when the
  runway is clear.
- **Ground (system)**: approves pushback when the pilot calls ready, and
  taxis departures to the runway and arrivals to their gate.

## Ground

The taxi network is the airport's real OpenStreetMap layout: taxiways,
taxilanes, aprons and gates, the same data the live map draws.
`approachGround.js` turns it into a graph. Routes are the shortest path,
and the clearance reads out the taxiway names, e.g. *"runway 22R, taxi via
B, K, hold short of runway 13L/31R"*.

- Departures call ready to push at a gate. You approve pushback, the pilot
  reports ready to taxi, and you clear them to their runway. At the
  holding point they switch to Tower.
- Arrivals roll out, turn off at the first exit past about 0.9 NM, and call
  Ground clear of the runway. You taxi them to their assigned gate. They
  park and leave after about 25 s.
- A route that crosses a runway stops at the hold-short line, and the pilot
  asks **Tower** to cross. Crossing clearances are always Tower's.
- Pilots stop behind traffic ahead (about 85 m). If two aircraft meet nose
  to nose, they wait 25 s and then one squeezes by, which costs points.
  *Hold position* and *continue* let you sequence them yourself.
- Anything on a runway while another aircraft takes off or lands on it is a
  **runway incursion** (−30 if you work Tower). The exception is lining up
  and waiting behind a departure that is already rolling.
- With no taxi map (Overpass down, or a field OSM hasn't mapped), the
  Ground position is unavailable. Departures then start at the runway, and
  arrivals leave the scope on landing.

Scoring by position:

| Position | Event | Points |
|---|---|---|
| Ground | Departure delivered to the runway | +3 |
| Ground | Arrival parked at its gate | +3 |
| Tower | Takeoff | +3 |
| Tower or Approach | Landing | +10 |
| Approach | Departure out through its gate | +10 |

## Not modelled

Obstacles (towers, buildings) in the MVAs, and real published MVA charts (the
game derives its own from terrain). Visual approaches. SIDs, STARs and
published holds. Intersection departures, high-speed exit geometry, and
de-icing. Small (under
41,000 lb) aircraft, and the small-behind-large rules that come with them.
