# Building an airport's procedures by hand

The Approach game flies real procedures at US airports (FAA data) and
generates believable ones everywhere else. A hand-built file replaces the
generated procedures with the published ones, airport by airport. This
guide is for the people building them.

## The short version

1. **Start from what the game generates**:
   `npm run -s nav:gen EGLL > nav/custom/EGLL.json`
   That gives a working file: real navaids, invented fixes, four STARs, four
   SIDs, an ILS and RNAV approach per runway end.
2. **Replace the invented parts** with the published STARs, SIDs and
   approaches from the airport's charts (fixes, altitudes, speeds). Keep the
   format below.
3. **Check it**: `npm run -s nav:check` (every file in `nav/custom/`) or
   `npm run -s nav:check nav/custom/EGLL.json`. Fix every error; read every
   warning.
4. **Try it**: open `/approach.html?airport=EGLL`, start a shift on Approach,
   and open the Layers panel. It should say "Hand-built by …", and each
   procedure can be plotted on the scope.
5. Commit the file. Nothing else needs changing.

You don't have to do a whole airport at once. A file can hold only `star`,
only `sid`, only `iap`, or any two. Every section you include replaces the
generated one, and the rest stay generated. Your `fix` list is added to the
generated one (and wins where names clash).

## The file

`nav/custom/<ICAO>.json`, the same shape as the FAA files in `nav/`:

```json
{
  "icao": "EGLL",
  "source": "InFlight team",
  "cycle": "2611",
  "fix": {
    "LAM":   [51.6461, 0.1517, "V"],
    "BIG":   [51.3309, 0.0348, "V"],
    "ALESO": [51.0581, 1.0033, "F"],
    "RW27L": [51.4648, -0.4342, "F"]
  },
  "star": [
    { "id": "ALESO1H", "routes": [
      { "t": "", "legs": [
        ["ALESO", 15000, "+", null, "IF", ""],
        ["BIG",    7000, "",   220, "TF", ""]
      ] }
    ] }
  ],
  "sid": [
    { "id": "DET2J", "routes": [
      { "t": "RW27L", "legs": [[null, 580, "+", null, "VA", ""], ["D262H", 3000, "+", null, "DF", ""]] },
      { "t": "",      "legs": [["DET", 6000, "", null, "TF", ""]] }
    ] }
  ],
  "iap": [
    { "id": "I27L", "name": "ILS RWY 27L", "rwy": "27L", "type": "ILS", "routes": [
      { "t": "",    "legs": [["RODIL", 3000, "+", null, "IF", "I"], ["FAF27", 2000, "", null, "TF", "F"], ["RW27L", null, "", null, "TF", "M"]] },
      { "t": "BIG", "legs": [["BIG", 7000, "+", null, "IF", "A"], ["RODIL", 3000, "+", null, "TF", "I"]] }
    ] }
  ]
}
```

(An illustration of the shape, not a copy of the real charts. Every fix a
leg uses must be in `fix`, so this one would also need D262H, DET, RODIL
and FAF27.)

### Top level

| Field | What it is |
|---|---|
| `icao` | The airport, matching the file name. |
| `source` | Who built it. The Layers panel shows "Hand-built by …". |
| `cycle` | The AIRAC cycle the charts are from (e.g. `2611`), shown in the Layers panel. |
| `fix` | Every fix the procedures use: `"NAME": [lat, lon, kind]`, decimal degrees, 4 decimals is plenty. Kind is `F` (waypoint), `V` (VOR, DME, TACAN) or `N` (NDB). |
| `star`, `sid`, `iap` | Lists of procedures (below). Leave a section out to keep the generated one. |

Runway thresholds can be used as fixes without defining them: `RW27L` is
taken from the runway data. Define it yourself only to correct it.

### Procedures

Each procedure is `{ "id", "routes": [...] }`. Approaches also have `name`,
`rwy` and `type`.

- **Routes** are the common route (`"t": ""`) and the transitions (`"t"` is
  the transition's name).
  - **STARs**: enroute transitions start at their first fix and run into the
    common route. The game finds where each path first comes within 37 NM
    and makes that an entry fix; it must be at least 14 NM out.
  - **SIDs**: runway transitions are named `RW` plus the runway (`RW27L`, or
    `RW27B` for both parallels) and run into the common route, then any
    enroute transition. The last fix is the exit gate.
  - **Approaches**: the common route runs down the final, from the IF
    (`"IF"` leg, role `I`) through the FAF (role `F`) to the runway (role
    `M`). Transitions start at an IAF (role `A`).
- **`type`** (approaches): `ILS`, `LOC`, `RNAV` (GPS) or `RNAV_RNP`. Name
  them as the chart does: `"ILS RWY 27L"`, `"RNAV (GPS) Y RWY 27L"`. A Y or Z
  in the name shows in flight plans (`R27LY`).

### Legs

Each leg is six values: `[fix, altitude, descriptor, speed, path terminator, role]`.

| # | Value | Notes |
|---|---|---|
| 1 | fix | A name from `fix`, or `null` for a leg with no fix (a climb on a heading). |
| 2 | altitude | Feet, or `null`. |
| 3 | descriptor | `""` at, `"+"` at or above, `"-"` at or below, `"B"` between (the first altitude is used). |
| 4 | speed | Knots (a maximum), or `null`. |
| 5 | path terminator | The ARINC 424 leg type from the chart's coding: `IF`, `TF`, `CF`, `DF`, `VA`, `CA`, `RF`, `HF`… When unsure, `TF` (track to fix) for a fix after the first, `IF` for the first. |
| 6 | role | `""`, or on approaches `"A"` IAF, `"I"` IF, `"F"` FAF, `"M"` missed approach point. |

## What the game needs

`nav:check` enforces these, but it helps to know why:

- **Two or more STAR entry fixes and two or more SID exits.** Fewer, and
  the game drops the file's routing and invents fixes instead (a field
  needs traffic from more than one direction).
- **STARs reach inside the 40 NM scope**, entering 14–37 NM out.
- **An approach for each runway end you expect to use**, with an IF and a
  FAF. Without one, that runway can only take visual approaches.
- **Fixes near the field.** The scope is 40 NM. A fix over 150 NM away is
  an error (usually lat/lon swapped).

## Where the data comes from

Build from the airport's published charts: the State's AIP (eAIP), where
STARs, SIDs and approaches list each fix's coordinates, altitudes and
speeds. Check each AIP's terms of use before copying data out of it. Where
the terms are unclear, ask before publishing.

The navaids file (`nav/navaids.json`, OurAirports, public domain) already
has most VORs and NDBs, and `nav:gen` puts the nearby ones in your starting
file with the right coordinates.

## When charts change

Procedures change on the 28-day AIRAC cycle. Update the file and its
`cycle` when an airport's charts do. The FAA files for US airports are
rebuilt with `npm run build:nav`, which never touches `nav/custom/` or
`nav/navaids.json`.
