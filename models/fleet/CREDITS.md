# Fleet models — where they come from

The 3D aircraft the crew centre draws on the Console's aircraft cards
(`crewAircraft3D.js`). Every one is an open model with its licence stated by
its authors; none is drawn or painted by us. What we changed is listed per
model, and the tools that did it are in `tools/aircraft-models/`.

## FlightGear (GPL)

From the FlightGear flight simulator's aircraft, on GitHub (the FGMEMBERS
mirrors, and the IDG team's own repositories for their A320 and MD-11). Converted from AC3D to glTF by `tools/aircraft-models/ac2glb.mjs`:
exterior only (flight deck, cabin, lights, landing gear and ground equipment
left out, so the aeroplane is shown in flight), window glass kept as glass,
textures not carried, geometry at the source's full detail with smoothed
normals; then compressed for the web by `pack.mjs` (meshopt, positions at
16 bits, normals at 12). `tools/aircraft-models/build.sh` rebuilds the lot. Licensed under the GNU GPL as each repository states; the licence
texts are alongside (`LICENSE-GPL-2.0.txt`, `LICENSE-GPL-3.0.txt`).

| File | Aircraft | Source (commit) | Authors | Licence |
|---|---|---|---|---|
| `a320.glb` | Airbus A320-200 (CFM) | [legoboyvdlp/A320-family](https://github.com/legoboyvdlp/A320-family) `fec1ecb`, `Models/A320-200-CFM.xml` | Josh Davidson, Jonathan Redpath, merspieler, Matthew Maring, Thorsten Herrmann, Semir Gebran (IDG) | GPL-2.0 |
| `737.glb` | Boeing 737-800 | [FGMEMBERS/737-800YV](https://github.com/FGMEMBERS/737-800YV) `2393ec1`, `Models/737-800.xml` | Gabriel Hernandez (YV3399), Joshua Davidson, Jonathan Redpath, RenanMsV; Innis Cunningham (3D), D-ECHO and ACJZA (3D improvements) | GPL-2.0 |
| `747.glb` | Boeing 747-400 | [FGMEMBERS/747-400](https://github.com/FGMEMBERS/747-400) `887ff47`, `Models/747-400.xml` | Gijs de Rooy, Jonathan Redpath, Ivan Ngeow, Markus Bulik and others | GPL-2.0 |
| `777-200er.glb` | Boeing 777-200ER | [FGMEMBERS/777](https://github.com/FGMEMBERS/777) `371a354`, `Models/777-200ER.ac` | Syd Adams (3D), Karla, and the authors in the repo's `AUTHORS` | see note |
| `777-300er.glb` | Boeing 777-300ER | [FGMEMBERS/777](https://github.com/FGMEMBERS/777) `371a354`, `Models/777-300ER.ac` | as above | see note |
| `787.glb` | Boeing 787-9 | [FGMEMBERS/787-9](https://github.com/FGMEMBERS/787-9) `f58fce9`, `Models/787-9.ac` | Narendran Muraleedharan, Dwayne Gable, Nicky Ivy, Jonathan Redpath | GPL-2.0 |
| `crj700.glb` | Bombardier CRJ700 | [FGMEMBERS/CRJ700-family](https://github.com/FGMEMBERS/CRJ700-family) `4862db2`, `Models/CRJ700.xml` | Ryan Miller | GPL-2.0+ |
| `crj900.glb` | Bombardier CRJ900 | [FGMEMBERS/CRJ700-family](https://github.com/FGMEMBERS/CRJ700-family) `4862db2`, `Models/CRJ900.xml` | Ryan Miller | GPL-2.0+ |
| `e175.glb` | Embraer 175 | [FGMEMBERS/E-jet-family](https://github.com/FGMEMBERS/E-jet-family) `45be9f8`, `Models/erj175.ac` | Narendran Muraleedharan and contributors | GPL-2.0 |
| `e190.glb` | Embraer 190 | [FGMEMBERS/E-jet-family](https://github.com/FGMEMBERS/E-jet-family) `45be9f8`, `Models/erj190.ac` | Narendran Muraleedharan and contributors | GPL-2.0 |
| `md11.glb` | McDonnell Douglas MD-11 (GE) | [Octal450/MD-11](https://github.com/Octal450/MD-11) `c2edac5`, `Models/MD-11-GE.xml` | Josh Davidson and the IDG MD-11 contributors | GPL-2.0 |
| `a330.glb` | Airbus A330-300 (CF6) | [FGMEMBERS/A330-300](https://github.com/FGMEMBERS/A330-300) `7d93076`, `Models/A330-303.xml` | TheOmegaHangar (from their A330-200) and contributors | GPL-2.0 |

**Note on the 777.** The FGMEMBERS/777 repository carries an `AUTHORS` file
but no licence file of its own. It is distributed with FlightGear's aircraft,
which are GPL-licensed as a condition of being hosted there, and is treated as
GPL-2.0 here — but the repository does not say so in its own words. Replace or
remove the two 777 files if that is not good enough.

## Sketchfab (CC-BY-4.0)

| File | Aircraft | Source | Author | Licence | Changes |
|---|---|---|---|---|---|
| `a380.glb` | Airbus A380-800 | [sketchfab.com/3d-models/airbus-a380-800-cfd1092a207b4085a32fbb89c6b32f25](https://sketchfab.com/3d-models/airbus-a380-800-cfd1092a207b4085a32fbb89c6b32f25) (via `models/airbus_a380_-_800.glb`) | Nobilis 2 | [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/) | Textures removed (`tools/aircraft-models/strip.mjs`), compressed (`pack.mjs`) |

## Not used

`models/airbus_a320.glb`, `models/airbus_A350-900.glb` and
`models/boeing_737-8_max.glb` (already in the repository) carry no author or
licence in their metadata, so the crew centre does not draw them.
