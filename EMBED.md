# Inflight VA Embed — "Active VA Pilots"

A drop-in widget Virtual Airlines can put on their own website to show their
currently-airborne pilots, live from the same Infinite Flight data the main
tracker uses.

Files:

- **`embed.html`** — the standalone widget page (served at `/embed.html`).
- **`embed.js`** — all the logic (token resolve → live data → render).

There are no framing restrictions (`_headers`/`netlify.toml` set none), so the
page can be iframed from any site.

---

## The two render modes

| Mode     | Mapbox cost                          | Needs a Mapbox token? |
|----------|--------------------------------------|-----------------------|
| `roster` | **Zero** (it's just a live list)     | No                    |
| `map`    | One map load per view — **billed to whoever owns the token** | **Yes — the VA's own `pk.` token** |

Because Mapbox bills *map loads* to the token owner, map mode requires the VA
to supply **their own** public token. Those loads then hit the VA's Mapbox
account and never touch ours. Roster mode renders no map at all, so it's free
for everyone — make it the default offer.

---

## How a VA embeds it (what you give them)

A single iframe pointing at an **embed token** you issue them:

```html
<iframe
  src="https://indgo-va.netlify.app/embed.html?token=THE_ISSUED_TOKEN"
  style="width:100%;height:520px;border:0"
  loading="lazy"
  title="Active VA Pilots"></iframe>
```

That's it. Everything else (which VA, roster vs map, the VA's Mapbox token) is
attached to the token on the backend.

---

## Backend work — `/api/embed/resolve` (the piece to build)

The widget is authorised entirely by one opaque token, resolved against the
**InGdo backend** (`https://site--indgo-backend--6dmjph8ltlhv.code.run`, the
same service that serves community aircraft photos and `/api/va-ads`). On load
the widget calls:

```
GET /api/embed/resolve?token=<token>&origin=<embedding-site-origin>
```

Implement this endpoint to validate the token and return the VA's embed config.

### Success — `200 OK`

```jsonc
{
  "ok": true,
  "va": {
    "code": "OCEAN",                 // VA callsign code (leading callsign word)
    "name": "Ocean Virtual",
    "logo": "https://.../logo.png"   // optional
  },
  "callsignPrefixes": ["OCEAN"],     // optional; defaults to [va.code]
  "mode": "map",                     // "map" | "roster"  (default "roster")
  "mapboxToken": "pk.eyJ…",          // REQUIRED when mode == "map" — the VA's OWN token
  "mapStyle": "mapbox://styles/mapbox/dark-v11",  // optional
  "theme": "dark",                   // "dark" | "light"  (optional)
  "servers": ["Expert"]              // optional; IF session names to scan (substring). [] = all
}
```

### Failure — `4xx`

```json
{ "ok": false, "error": "expired" }
```

The widget maps statuses to friendly messages:

- `401` / `403` → "invalid or not allowed on this site"
- `404` / `410` → "expired or been revoked"
- anything else → generic "couldn't reach the embed service"

### What the backend owns (issuance)

- **Issue** tokens: mint an opaque token (or JWT) per VA and store the mapping
  → VA code, name, logo, mode, the VA's Mapbox token, allowed origins.
- **Restrict** by `origin` if you want a token to only work on the VA's domain
  (the widget forwards the embedding page's origin via `document.referrer`).
- **Revoke / expire** by failing the lookup with a 4xx.

> CORS: `/api/embed/resolve` must allow the embed's origin
> (`https://indgo-va.netlify.app`, plus any preview/deploy domains). The live
> flight endpoints on the ACARS backend are already public and CORS-open.

Nothing in `embed.js` needs to change when this lands — it already calls
`/resolve`. The only client constant is `INGDO_BACKEND` in `embed.js`.

---

## Previewing today (before the backend endpoint exists)

The widget also accepts direct query params so you can build and demo it now. A
`token`, when present, always wins; these are ignored once a token is supplied.

```
# Roster (no Mapbox, free)
/embed.html?va=OCEAN&name=Ocean%20Virtual&mode=roster

# Map (needs a real pk. token; loads bill that token's owner)
/embed.html?va=OCEAN&name=Ocean%20Virtual&mode=map&mapboxToken=pk.eyJ…

# Optional extras
&prefixes=OCEAN,OCN          # extra callsign prefixes to match
&servers=Expert              # restrict to a server (substring of IF session name)
&theme=light
&logo=https://.../logo.png
```

---

## Data sources (no key needed)

- Sessions: `GET https://site--acars-backend--6dmjph8ltlhv.code.run/if-sessions`
- Flights:  `GET https://site--acars-backend--6dmjph8ltlhv.code.run/flights/:sessionId`

A pilot is matched to the VA when their callsign's **leading word** starts with
one of the VA's `callsignPrefixes` — identical to `vaAds.js` `matchCallsign`,
so the embed and the tracker agree on who belongs to a VA. The widget polls
every 30s and pauses while the tab is hidden.

---

## Protect our own Mapbox token (do this regardless)

The main app hands our Mapbox token to any browser via
`/.netlify/functions/config`. Add **URL restrictions** to that public token in
the Mapbox dashboard so it only works on our own domain(s). Public `pk.` tokens
are always visible client-side; URL restriction is what stops someone scraping
it and running up our bill from their own site. The embed never uses our token
— map mode only ever uses the VA's.
