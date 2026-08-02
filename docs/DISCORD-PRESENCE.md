# Discord Rich Presence

Puts a live flight on a pilot's Discord profile: callsign, aircraft type, route,
altitude, phase, a countdown to touchdown, and the community photo of the actual
airframe as the large image.

```
┌──────────────────────────────────────┐
│ PLAYING A GAME                       │
│ ┌────────┐  Inflight                 │
│ │ photo  │  BA278 · Boeing 777-300ER │
│ │  of    │  KJFK → EGLL · FL380      │
│ │ G-STBA │  Cruising · 512 kt        │
│ └───┬────┘  02:14 left               │
│   [phase]                            │
│  [ Track this flight ] [ Live map ]  │
└──────────────────────────────────────┘
```

Pilots turn it on from **Profile → Settings → Discord Rich Presence**, pick a
flight, and their status follows it until it lands or they stop it.

## Moving parts

| Where | File | Does |
|---|---|---|
| Browser | `discordPresence.js` | Talks to the local Discord client over RPC, builds the activity, coalesces updates |
| Browser | `discordPresenceUI.js` | The Settings panel, the live card preview and the flight picker |
| Browser | `index.html` | Boots presence so it survives with the profile panel closed |
| Backend | `discord_presence.cjs` | OAuth code exchange and community-photo → activity asset minting |

The browser connects straight to the Discord desktop client on
`ws://127.0.0.1:6463-6472`. The backend never sees a flight or a presence — it
only holds the two secrets a browser cannot.

## Setup

Nothing below is optional if you want the feature live. Until the backend has
`DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`, `/api/discord/presence/config`
reports `enabled: false` and the client hides the panel entirely, which is the
intended behaviour for an unconfigured deploy.

### 1. Discord application

In the [developer portal](https://discord.com/developers/applications):

1. **New Application** → name it `Inflight`. The name is what renders as the
   bold first line of the card, so it is user-visible.
2. **Rich Presence → Art Assets**, upload these keys (1024×1024 PNG):

   | Key | Used for |
   |---|---|
   | `inflight_logo` | Large image when a flight has no community photo |
   | `phase_taxi` | Taxiing |
   | `phase_takeoff` | Takeoff / landing roll |
   | `phase_climb` | Climbing |
   | `phase_cruise` | Cruising |
   | `phase_descent` | Descending |
   | `phase_ground` | Ground / unknown |

   The keys are the contract — `PHASE_ASSETS` in `discordPresence.js` maps phase
   names onto them. Assets take a few minutes to propagate after upload.
3. **Rich Presence → RPC Origins**, add every origin the tracker is served from:

   ```
   https://inflight.info
   http://localhost:8080      (or whatever your dev server uses)
   ```

   The browser sets the `Origin` header itself and cannot fake it. An origin
   that isn't listed gets the socket closed with code **4002**, which the panel
   surfaces as "Discord rejected this site's origin".
4. **OAuth2 → Redirects**, add `https://inflight.info`. This value is never
   navigated to, but the token exchange must send a redirect URI that matches
   one on the application, or Discord answers `invalid_grant`.
5. **Bot → Add Bot**, and copy the token. This is only used to mint external
   image assets; the bot never joins a server.

### 2. Backend environment

```bash
DISCORD_CLIENT_ID=...          # required — also served to the client
DISCORD_CLIENT_SECRET=...      # required — code → token exchange
DISCORD_BOT_TOKEN=...          # optional — community photos as the large image
DISCORD_PRESENCE_REDIRECT=https://inflight.info   # must match step 4
DISCORD_PRESENCE_ENABLED=1     # optional override of the auto-detected switch
```

Without `DISCORD_BOT_TOKEN` everything still works — every card just falls back
to `inflight_logo` instead of the aircraft photo.

### 3. Verify

```bash
curl https://<backend>/api/discord/presence/config
# {"ok":true,"enabled":true,"clientId":"...","externalAssets":true}
```

Then open the tracker with Discord running, go to Profile → Settings, connect,
and pick a flight. The panel's preview card is rendered from the same copy that
goes over RPC, so if it looks right, the real card is right.

## How the photo becomes an image

Rich Presence assets are normally fixed keys uploaded in the portal, which can't
show a per-airframe photo. Discord's `external-assets` endpoint converts an
arbitrary https URL into an `mp:external/...` key that activities accept, and it
needs the bot token — hence the backend hop.

The flow, per flight:

1. The map resolves the community photo onto its feature (existing behaviour).
2. `discordPresence.js` posts that URL to `/api/discord/presence/assets`.
3. The backend asks Discord for an asset path and caches it for 24 hours —
   the same livery is requested by every viewer watching that flight.
4. The key goes into `assets.large_image`.

Any failure in that chain falls back to `inflight_logo`. Misses are cached too:
a photo Discord won't proxy will not start working on a retry.

## Rate limits and cadence

Discord allows roughly 5 `SET_ACTIVITY` calls per 20 seconds. `discordPresence.js`
holds a 4.5 s hard floor and a 15 s steady-state cadence, coalescing telemetry in
between, and skips frames that are byte-identical to the last one — a parked
aircraft sends nothing at all. Changing the followed flight jumps the queue but
still respects the floor.

## Behaviour notes

- **Following survives a new leg.** The target is stored as flight id *and*
  username. When a pilot respawns and the id changes, the username match picks
  the new flight up and the stored id is updated.
- **No flight, still connected.** The card falls back to "Browsing the live map"
  with a live airborne count, so the status never goes stale-but-present.
- **Consent is usually not needed.** Most Discord builds accept `SET_ACTIVITY`
  straight after the handshake. The OAuth flow (`AUTHORIZE` → backend exchange →
  `AUTHENTICATE`) runs once, lazily, only if a build refuses — and the token is
  cached in `localStorage` so it isn't asked for twice.
- **Auto-reconnect is opt-in by history.** Only a browser that has connected
  before retries on load, so a first-time visitor never sees a Discord dialog
  they didn't ask for.

## Troubleshooting

| Panel says | Cause |
|---|---|
| "Discord presence is not enabled on this deployment" | Backend has no `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET` |
| "No Discord desktop app found" | Discord isn't running, or it's the browser version — there is no local RPC server in that case |
| "Discord rejected this site's origin" | The origin is missing from RPC Origins (step 3) |
| "Discord rejected the authorisation: invalid_grant" | `DISCORD_PRESENCE_REDIRECT` doesn't match a redirect on the application (step 4) |
| Card shows the logo, never the aircraft | `DISCORD_BOT_TOKEN` unset, or the flight has no community photo yet |
| Card shows the phase dot as a blank circle | Art assets not uploaded, or still propagating |
