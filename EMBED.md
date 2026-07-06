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
  "accent": "#1e3a8a",               // optional; header brand colour(s). A string, a
                                     // comma-separated list, or an array — two or more
                                     // colours paint a gradient. Omit to auto-derive
                                     // from the logo (two-tone logos auto-gradient)
  "gradient": "auto",                // optional; "off" keeps ONE colour flat instead of
                                     // auto-expanding it into a two-stop gradient
  "gradientAngle": 120,              // optional; gradient direction in degrees
  "header": "on",                    // optional; "off" hides the header entirely — the
                                     // "Powered by Inflight" badge then floats over the
                                     // widget (attribution always stays visible)
  "headerPos": "top",                // optional; "top" | "bottom" | "left" | "right".
                                     // left/right render a vertical side rail (collapses
                                     // back to top on narrow embeds)
  "compact": false,                  // optional; slimmer header
  "radius": 14,                      // optional; widget corner radius in px (0–32)
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
&prefixes=Air%20Canada,OCEAN # full airline/callsign names this VA flies under
&suffixes=VA,EX             # tags; when set, a flight must match a prefix AND carry a tag
&servers=Expert              # restrict to a server (substring of IF session name)
&theme=light
&logo=https://.../logo.png
&color=%231e3a8a             # force the header brand colour (hex). Omit to auto-derive from the logo
&color=%231e3a8a,%23f59e0b   # …or several colours → a gradient header
&gradient=off                # keep a single colour flat (no auto two-stop gradient)
&angle=90                    # gradient direction in degrees (default 120)
&header=off                  # hide the header; Powered-by floats over the widget instead
&headerPos=left              # header placement: top (default) | bottom | left | right
&compact=1                   # slimmer header
&radius=0                    # widget corner radius in px (e.g. 0 for square corners)
```

---

## Header brand colours & gradients

The header — the VA logo, the VA name, the "N pilots airborne" line and the
"Powered by Inflight" chip — takes on the **VA's own brand colours**:

- **Auto** (default): the widget samples the VA's logo for its most vivid
  colours. A single-colour logo paints the header with that colour blended into
  a derived companion shade (a subtle two-stop gradient); a two-tone logo (e.g.
  navy + gold) gradients its two hue families together. Text and borders are
  recomputed for contrast (WCAG luminance, judged against the blend of all
  stops) so the name/count stay legible, and the corner Inflight wordmark swaps
  between its dark and light versions to suit. If the logo can't be read
  (cross-origin / tainted canvas) the header keeps the default theme look.
- **Explicit**: set `accent` in the resolved config (or `?color=…` in preview)
  to force the header colours. One colour works like the auto case; two or
  three comma-separated colours paint a multi-stop gradient. `gradient=off`
  keeps a single colour flat, and `gradientAngle` (or `&angle=`) sets the
  direction.

## Header layout (hide / move / density)

- **Hide it**: `header: "off"` (or `?header=off`). The header disappears and a
  floating pill — live pilot count + "Powered by Inflight" — is overlaid on the
  widget instead. The attribution is **required to stay viewable**, so it is
  always rendered in one place or the other; there is no way to remove both.
- **Move it**: `headerPos: top | bottom | left | right`. `bottom` flips the bar
  under the content; `left`/`right` render a vertical brand rail (bigger logo,
  wrapping VA name, Powered-by pinned to the rail's foot) and automatically
  collapse back to the classic top bar when the embed is narrower than ~560px.
- **Density / shape**: `compact: true` slims the header; `radius` (0–32 px)
  rounds or squares the widget's corners.

---

## Data sources (no key needed)

- Sessions: `GET https://site--acars-backend--6dmjph8ltlhv.code.run/if-sessions`
- Flights:  `GET https://site--acars-backend--6dmjph8ltlhv.code.run/flights/:sessionId`

A pilot is matched to the VA by their callsign:

- **Prefix** — the callsign (spaces/separators ignored) starts with one of the
  VA's `callsignPrefixes`. These are the **full** airline/callsign names the VA
  flies under, e.g. `Air Canada` matches `Air Canada 001` (and only Air Canada,
  not Air France). Defaults to `[va.code]`.
- **Suffix tags** — optional `callsignSuffixes` (e.g. `VA`, `EX`). When a VA
  supplies tags, a flight must match a declared prefix **AND** carry one of the
  tags on its last token (e.g. `Air Canada 001VA`). A bare tag like `VA` never
  matches on its own, so unrelated callsigns that merely end in `VA` are not
  swept in. To fly a tag across several airlines, list each airline in
  `callsignPrefixes`.

The widget polls every 30s and pauses while the tab is hidden.

---

## Protect our own Mapbox token (do this regardless)

The main app hands our Mapbox token to any browser via
`/.netlify/functions/config`. Add **URL restrictions** to that public token in
the Mapbox dashboard so it only works on our own domain(s). Public `pk.` tokens
are always visible client-side; URL restriction is what stops someone scraping
it and running up our bill from their own site. The embed never uses our token
— map mode only ever uses the VA's.
