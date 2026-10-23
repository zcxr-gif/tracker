# Hand-built procedures

One file per airport, `<ICAO>.json`, in the same format as the FAA files in
`nav/`. They take priority over the published and generated procedures,
section by section.

Start one with `npm run -s nav:gen <ICAO> > nav/custom/<ICAO>.json` and
check it with `npm run -s nav:check`. The full guide is
`docs/NAV-AUTHORING.md`.
