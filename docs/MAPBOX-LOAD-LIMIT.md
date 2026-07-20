# Mapbox map-load limit — automatic free-map fallback

The tracker renders with **Mapbox GL** (billed map loads) but can fall back to
the free **MapLibre + OpenFreeMap** engine — the *same map the VA embed uses* —
with zero billed loads. This doc covers the two ways that fallback is triggered
and the tiny backend endpoint the automatic one needs.

Mapbox's free web tier is **50,000 map loads/month**. We flip to the free map
once we reach a lower ceiling (default **40,000**) so we never bill past the
free tier, then flip back automatically at the start of the next month.

---

## The two triggers

| Trigger | Where | When to use |
|---------|-------|-------------|
| **Manual kill-switch** | Netlify env `USE_FREE_MAP=true` (see `netlify/functions/config.js`) | Emergency "turn Mapbox off *now*". Flip it back to `false`/unset to return to Mapbox. Always wins. |
| **Automatic quota guard** | Aircraft-images backend counter (below) | Set-and-forget. Counts map loads and switches on its own at the ceiling. |

The frontend logic lives in `flight.js → fetchApiKeys()`:

1. If Netlify's `useFreeMap` is on → free map immediately.
2. Otherwise it calls `POST {API_BASE_URL}/api/maploads/hit?limit=40000` on the
   aircraft-images backend. If the response says `useFreeMap: true`, it switches.
3. If that endpoint is missing/unreachable, it **fails open** and stays on
   Mapbox — the counter never breaks the map.

`API_BASE_URL` is already the indgo backend
(`https://site--indgo-backend--6dmjph8ltlhv.code.run`), the same origin the
tracker uses for `/api/aircraft/lookup`. The ceiling constant is
`MAPBOX_MONTHLY_LOAD_LIMIT` in `flight.js`.

---

## The backend endpoint to add

Add this one route to the aircraft-images (indgo) backend. It keeps a running
count **per calendar month** and returns whether the ceiling is reached.

### Contract

```
POST /api/maploads/hit?limit=40000      (GET is also accepted, for testing)
```

**Response — HTTP 200:**

```json
{ "ok": true, "month": "2026-07", "count": 12345, "limit": 40000, "useFreeMap": false }
```

Behaviour:

- While `count < limit`: **increment**, return `useFreeMap: false` (this session
  uses Mapbox — a real billed load, so it's counted).
- Once `count >= limit`: **do not increment**, return `useFreeMap: true` (this
  session uses the free map — not billed, so nothing to count). The counter
  self-caps at the limit.
- The month key resets the count automatically on the 1st, so Mapbox comes back
  by itself each month.

> **Why 40k and not 50k?** The counter increments once per page-session, but a
> single session can create a few Mapbox `Map` instances (main map, live-traffic
> map, sector-ops map). Counting per session while capping at 40k leaves
> headroom under the true 50k map-load ceiling. Tune the `limit` query param /
> `MAPBOX_MONTHLY_LOAD_LIMIT` constant if your real ratio differs.

### Drop-in Express route

```js
// routes/mapLoads.js
const express = require('express');
const router = express.Router();

// In-memory counter. Fine for a single instance; use Redis/DB if the backend
// runs more than one replica so the count is shared (see note below).
const counts = new Map(); // "YYYY-MM" -> number

const DEFAULT_LIMIT = 40000;
const HARD_CAP = 50000; // never let a client push the threshold above the free tier

function monthKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function handleHit(req, res) {
  // CORS — the tracker calls this from inflight.info (browser).
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cache-Control', 'no-store');

  const limit = Math.min(
    HARD_CAP,
    Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_LIMIT)
  );
  const month = monthKey();
  const current = counts.get(month) || 0;

  // Over the ceiling: serve the free map, don't count (it isn't a billed load).
  if (current >= limit) {
    return res.json({ ok: true, month, count: current, limit, useFreeMap: true });
  }

  // Under the ceiling: this session will use Mapbox — count it.
  const next = current + 1;
  counts.set(month, next);
  return res.json({ ok: true, month, count: next, limit, useFreeMap: false });
}

router.post('/api/maploads/hit', handleHit);
router.get('/api/maploads/hit', handleHit); // handy for eyeballing in a browser

// Optional: read-only status without incrementing.
router.get('/api/maploads/status', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cache-Control', 'no-store');
  const month = monthKey();
  const count = counts.get(month) || 0;
  const limit = DEFAULT_LIMIT;
  res.json({ ok: true, month, count, limit, useFreeMap: count >= limit });
});

module.exports = router;
```

Wire it up alongside the existing routes:

```js
app.use(require('./routes/mapLoads'));
```

### CORS

The tracker calls this from the browser on `inflight.info`, so the endpoint must
send `Access-Control-Allow-Origin` (the same requirement the aircraft-lookup
endpoints already meet). The snippet above sets `*`; echo the request `Origin`
instead if you want to restrict it.

### Multi-instance / persistence

The in-memory `Map` resets on redeploy and isn't shared across replicas. If the
backend scales beyond one instance, back the counter with Redis
(`INCR maploads:2026-07`) or a single-row DB counter keyed by month so every
replica sees the same total. The response contract stays identical.

---

## Verifying

```bash
# Under the ceiling → useFreeMap:false, count climbs
curl -X POST 'https://site--indgo-backend--6dmjph8ltlhv.code.run/api/maploads/hit?limit=3'
curl -X POST 'https://site--indgo-backend--6dmjph8ltlhv.code.run/api/maploads/hit?limit=3'
curl -X POST 'https://site--indgo-backend--6dmjph8ltlhv.code.run/api/maploads/hit?limit=3'
# 4th call → useFreeMap:true, count stops at 3
curl -X POST 'https://site--indgo-backend--6dmjph8ltlhv.code.run/api/maploads/hit?limit=3'
```

In the tracker, when the guard trips you'll see in the console:

```
🗺️ Free-map mode active (MapLibre + OpenFreeMap) — Mapbox map loads paused.
```
