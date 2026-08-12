# Inflight Tracker — native iOS

A bare-bones live flight tracker for Infinite Flight, written in Swift and
SwiftUI with no third-party dependencies.

The previous web tracker — the whole thing, unchanged — now lives in
[`old/`](old/). It is still the source of truth for the backend's data shapes
and is referenced from the Swift comments where the two overlap.

## What v1 does

- Live traffic on a MapKit map, for any Infinite Flight server.
- Server picker (Expert / Training / Casual), remembered between launches.
- Tap an aircraft for callsign, pilot, airframe, livery, registration, route,
  altitude, ground speed, vertical speed, heading and last report age.
- Search the whole server by callsign, pilot, registration, ICAO or operator,
  and jump the camera to the result.
- Standard / hybrid / satellite map styles, altitude-banded aircraft colours,
  and a toggle for parked aircraft (off by default — they are most of a busy
  server and none of the interest).

## How the live data works

Two clocks, in `LiveTrafficStore`:

| Clock | Interval | Job |
|---|---|---|
| poll | 15 s | `GET /flights/:sessionId` — the only network traffic |
| tick | 1 s | dead-reckon the snapshot forward, re-cull it to the visible region |

The backend reports roughly every 15 seconds. Rendering those reports directly
would make the map a slideshow, so `Flight.advanced(by:)` walks each aircraft
along its heading at its ground speed between reports, capped at 90 seconds so
a flight whose reports have stopped parks itself instead of flying off the map.

Culling matters as much: a busy Expert Server carries well over a thousand
aircraft, and handing all of them to SwiftUI drops the frame rate into single
digits. The tick keeps the 300 nearest the centre of the visible region, plus
whatever is selected.

The web app takes the same data over a Socket.IO delta stream
(`old/FlightDeltaClient.js`). This app polls the equivalent REST snapshot
instead, which costs a little freshness and buys a build with no SPM, no
CocoaPods and no Podfile. `TrackerAPI` is a narrow enough seam that anything
producing `[Flight]` on a timer can replace it later.

## Building locally

The `.xcodeproj` is generated, not committed — a pbxproj is an unreviewable
diff and a permanent merge conflict.

```sh
brew install xcodegen
xcodegen generate
open InflightTracker.xcodeproj
```

Requires Xcode 15+ and an iOS 17 deployment target (the app uses the SwiftUI
`Map(position:)` API and `ContentUnavailableView`).

## Shipping

`codemagic.yaml` has two workflows, and the order matters if you have no Mac.

**`ios-compile-check` — run this first.** It generates the project and compiles
for the simulator with signing switched off, so it needs no certificate, no
registered bundle id and no TestFlight slot. It answers only "does this
build?". Start it by hand from the Codemagic UI; it has no trigger, so it never
competes with the release workflow for build minutes. If it is green, the only
things left that can fail are signing and upload.

**`ios-native-workflow` — the real one.** Builds and pushes to TestFlight on
every push, the same way the Inflight-IOS repo does: App Store Connect
integration, automatic signing, build number taken from `$BUILD_NUMBER`. The
difference is the project comes from `xcodegen generate` rather than
`npx cap add ios`, and there is no dependency install step at all.

Note that it triggers on every branch (`pattern: '*'`), inherited from the
Inflight-IOS config — so any push attempts a TestFlight build. Narrow the
pattern to `main` if that is not what you want.

**Before the first build**, the bundle id `com.tracker.InflightTracker` has to
exist in App Store Connect. It is set in two places that must agree:

- `project.yml` → `PRODUCT_BUNDLE_IDENTIFIER`
- `codemagic.yaml` → `ios_signing.bundle_identifier`

## Layout

```
InflightTracker/
  Sources/
    App/        entry point and scene-phase handling
    Models/     Flight, Session, and their lenient decoders
    Services/   TrackerAPI (transport), LiveTrafficStore (state)
    Views/      MapScreen and its three sheets
    Support/    formatting and decoding helpers
  Resources/    Info.plist, asset catalogue
project.yml     XcodeGen spec — the project definition
codemagic.yaml  CI → TestFlight
old/            the previous web tracker, untouched
```
