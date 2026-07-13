# Inflight Public API — VA Pilots + Events

No-auth, CORS-open endpoints served by the InGdo backend (the same service —
and database — that powers the VA-Ads roster and community aircraft photos):

```
https://site--indgo-backend--6dmjph8ltlhv.code.run
```

`:id` is always the **VA ad id** from the public `GET /api/va-ads` listing.
Both routes return `404 { "message": "VA not found." }` on a bad/unknown id
and are cacheable for 60s (`Cache-Control: public, max-age=60`).

---

## GET /api/public/va/:id/pilots

Query params:

| Param   | Default | Notes                                   |
|---------|---------|-----------------------------------------|
| `q`     | —       | Optional case-insensitive username search. |
| `limit` | `500`   | Max `2000`.                             |
| `skip`  | `0`     | Paging offset.                          |

```json
{
  "va": { "id": "664a…", "name": "Ocean Virtual" },
  "total": 42,
  "rosterTotal": 180,
  "pilots": [
    { "username": "JohnDoe", "addedAt": "2026-07-10T14:02:00.000Z" }
  ]
}
```

`total` counts matches for the current search; `rosterTotal` is the whole
roster, ignoring the search.

## GET /api/public/va/:id/events

Upcoming events (anything starting later than 12h ago), soonest first, max 50.

```json
{
  "va": { "id": "664a…", "name": "Ocean Virtual" },
  "events": [{
    "id": "665f…",
    "title": "Friday Night Ops",
    "description": "Group flight …",
    "link": "https://discord.gg/…",
    "startsAt": "2026-07-18T19:00:00.000Z",
    "createdAt": "2026-07-13T02:11:00.000Z"
  }]
}
```

Field limits: `title` max 120 chars; `description` max 1000 chars, may be `""`;
`link` may be `""`.

---

## Drop-in client

```js
const API_BASE = 'https://site--indgo-backend--6dmjph8ltlhv.code.run';
const VA_ID = 'YOUR_VA_AD_ID_HERE'; // from GET /api/va-ads

async function getJson(path) {
  const res = await fetch(API_BASE + path);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

// ---- Pilots / roster ----
export function getPilots({ q = '', limit = 500, skip = 0 } = {}) {
  const qs = new URLSearchParams({ q, limit, skip });
  return getJson(`/api/public/va/${VA_ID}/pilots?${qs}`);
}

// ---- Events ----
export function getEvents() {
  return getJson(`/api/public/va/${VA_ID}/events`);
}

// ---- Example usage ----
// const { pilots, rosterTotal } = await getPilots();
// pilots.forEach(p => console.log(p.username));
//
// const { events } = await getEvents();
// events.forEach(e => console.log(e.title, new Date(e.startsAt).toLocaleString()));
```

---

## Where the tracker uses this

`vaAds.js` fetches `/api/public/va/:id/events` when a partner's detail view is
opened in the Partners slide-over and renders an **Upcoming Events** section
under the Live Fleet (hidden entirely when the VA has no upcoming events).
It is also exposed to other scripts as `window.InflightVaAds.events(adId)`,
which resolves to a normalized, soonest-first array:

```js
const events = await window.InflightVaAds.events(adId);
// [{ id, title, description, link, startsAt /* epoch ms */ }]
```
