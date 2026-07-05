// Share endpoint for flight permalinks.
//
// Flow:
//   /share/<flightId>  -> (via _redirects) /.netlify/functions/share?flight=<flightId>
//
// The function looks up the flight on the live ACARS feed across all sessions
// (Expert / Training / Casual), grabs its community aircraft photo, and returns
// an HTML page packed with Open Graph + Twitter Card meta tags so chat apps
// render a rich preview. The page also redirects the human visitor to
// /?flight=<flightId>&server=<name> so the main app loads, switches to the
// correct server, and auto-opens that flight on landing.
//
// IMPORTANT: Discord's link unfurl bot *follows* <meta http-equiv="refresh">
// tags, which previously caused it to land on the SPA (which has no per-flight
// OG tags) and embed nothing. We now detect known crawler user agents and
// serve them HTML with NO meta refresh — they get pure OG tags. Humans get
// the meta refresh + JS redirect as a fallback.
//
// LEGACY: new shares are link-only (direct /?flight=<id>&s=<snapshot> app
// URLs built client-side) and never touch this function. This endpoint stays
// to serve /share/<id> links that are already in the wild. Resolution is
// snapshot-first: this function persists a snapshot to Netlify Blobs on every
// successful live lookup, so even after the flight ends the link still
// unfurls with the real callsign/route/photo and humans land on a proper
// "flight completed" page instead of a spinner that gives up.

const { getShareStore, readSnapshot, writeSnapshot, buildSnapshot } = require('./lib/shareStore');

const ACARS_SESSIONS_URL = 'https://site--acars-backend--6dmjph8ltlhv.code.run/if-sessions';
const ACARS_FLIGHTS_BASE = 'https://site--acars-backend--6dmjph8ltlhv.code.run/flights';
const ACARS_HISTORY_BASE = 'https://site--acars-backend--6dmjph8ltlhv.code.run/api/flights';
const COMMUNITY_LOOKUP_URL = 'https://site--indgo-backend--6dmjph8ltlhv.code.run/api/aircraft/lookup';

const SITE_HOST_FALLBACK = 'inflight.info';
const BRAND_NAME = 'InFlight';
const BRAND_TAGLINE = 'InFlight Live Flight Tracker';
const BRAND_LOGO_PATH = '/Images/inflight.png';
// Branded 1200x630 hero used when there is no community aircraft photo.
const PLANE_FALLBACK_PATH = '/Images/og-banner.png';
const PLANE_FALLBACK_TYPE = 'image/png';

// If a snapshot was seen live within this window and the REST lookup misses,
// assume the miss is feed lag and treat the flight as (possibly) still live.
// Beyond it, the flight is presented as completed.
const LIVE_GRACE_MS = 12 * 60 * 1000;

// User agents we recognise as link-preview crawlers. For these we suppress the
// meta-refresh so they actually parse our OG tags instead of following the
// redirect to the SPA.
const CRAWLER_UA_RE = /discord|slack|twitter|telegram|whatsapp|facebookexternalhit|facebot|linkedin|skype|pinterest|redditbot|embedly|googlebot|bingbot|duckduckbot|applebot|yandex|baiduspider|snapchat|tumblr|vkshare|iframely|tiktok|preview|unfurl|bot\b|crawler|spider/i;

const fetchFn = (typeof fetch === 'function')
    ? fetch
    : (...args) => import('node-fetch').then(({ default: f }) => f(...args));

function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
    return escapeHtml(value);
}

async function fetchJson(url) {
    try {
        const res = await fetchFn(url, { headers: { 'accept': 'application/json' } });
        if (!res.ok) return null;
        return await res.json();
    } catch (err) {
        console.warn('share: fetch failed', url, err && err.message);
        return null;
    }
}

// Walk every available IF session looking for the flight. Returns
// { flight, serverName } or null. We don't short-circuit to "Expert" because
// shares often come from Training/Casual users too.
async function findFlight(flightId) {
    const sessionsJson = await fetchJson(ACARS_SESSIONS_URL);
    const sessions = (sessionsJson && Array.isArray(sessionsJson.sessions)) ? sessionsJson.sessions : [];
    if (!sessions.length) return null;

    const results = await Promise.allSettled(
        sessions.map(async (session) => {
            if (!session || !session.id) return null;
            const flightsJson = await fetchJson(`${ACARS_FLIGHTS_BASE}/${session.id}`);
            if (!flightsJson) return null;
            const flights = flightsJson.flights || flightsJson.data || (Array.isArray(flightsJson) ? flightsJson : []);
            const match = flights.find(f => f && f.flightId === flightId);
            return match ? { flight: match, serverName: session.name || '' } : null;
        })
    );

    for (const r of results) {
        if (r.status === 'fulfilled' && r.value) return r.value;
    }
    return null;
}

// The ACARS REST endpoint lags the live socket by a few seconds, so a freshly
// shared flight can be present on the socket but not yet listed via HTTP. Retry
// a couple of times before giving up — this is the difference between a
// link that "works" and one that dead-ends on a "Flight ended" page.
async function findFlightWithRetry(flightId, { attempts = 3, delayMs = 1200 } = {}) {
    for (let i = 0; i < attempts; i++) {
        const hit = await findFlight(flightId);
        if (hit) return hit;
        if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs));
    }
    return null;
}

// Recorded flight path, kept by the ACARS backend after the flight ends —
// the same endpoint the in-app replay uses. Returns normalized points or [].
async function fetchFlightHistory(flightId) {
    const json = await fetchJson(`${ACARS_HISTORY_BASE}/${encodeURIComponent(flightId)}/history`);
    if (!json || json.ok === false) return [];
    const raw = json.path || json.route || [];
    if (!Array.isArray(raw)) return [];

    const pickNum = (...vals) => {
        for (const v of vals) if (typeof v === 'number' && !Number.isNaN(v)) return v;
        return null;
    };
    const points = [];
    for (const p of raw) {
        if (!p || typeof p !== 'object') continue;
        const pos = (p.position && typeof p.position === 'object') ? p.position : p;
        const lat = pickNum(pos.lat, pos.latitude, p.lat, p.latitude);
        const lon = pickNum(pos.lon, pos.longitude, p.lon, p.longitude);
        if (lat === null || lon === null) continue;
        let t = null;
        for (const v of [pos.time, pos.lastReportMs, pos.timeMs, p.time, p.lastReportMs, p.timeMs,
                         pos.date, pos.timestamp, pos.lastReport, p.date, p.timestamp, p.lastReport]) {
            if (typeof v === 'number' && !Number.isNaN(v)) { t = v; break; }
            if (typeof v === 'string' && v) {
                const parsed = Date.parse(v);
                if (!Number.isNaN(parsed)) { t = parsed; break; }
            }
        }
        if (t === null) continue;
        points.push({
            lat, lon, t,
            alt: pickNum(pos.alt, pos.altitude, pos.alt_ft, p.alt, p.altitude, p.alt_ft) || 0,
            gs: pickNum(pos.gs, pos.groundSpeed, pos.gs_kt, p.gs, p.groundSpeed, p.gs_kt) || 0
        });
    }
    points.sort((a, b) => a.t - b.t);
    return points;
}

// Flight totals for the completed-flight card, computed from the recorded path.
function computeReplayStats(points) {
    if (!Array.isArray(points) || points.length < 2) return null;
    const R_NM = 3440.065;
    const toRad = (d) => d * Math.PI / 180;
    let distanceNm = 0;
    let maxAlt = 0;
    let maxGs = 0;
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (p.alt > maxAlt) maxAlt = p.alt;
        if (p.gs > maxGs) maxGs = p.gs;
        if (i > 0) {
            const q = points[i - 1];
            const dLat = toRad(p.lat - q.lat);
            const dLon = toRad(p.lon - q.lon);
            const a = Math.sin(dLat / 2) ** 2 +
                Math.cos(toRad(q.lat)) * Math.cos(toRad(p.lat)) * Math.sin(dLon / 2) ** 2;
            distanceNm += 2 * R_NM * Math.asin(Math.sqrt(a));
        }
    }
    const durationMs = points[points.length - 1].t - points[0].t;
    if (durationMs <= 0) return null;
    return {
        durationMs,
        distanceNm: Math.round(distanceNm),
        maxAltFt: Math.round(maxAlt),
        maxGsKt: Math.round(maxGs)
    };
}

function fmtDuration(ms) {
    const totalMin = Math.round(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

async function fetchAircraftImage(type, livery) {
    if (!type || !livery) return null;
    const url = `${COMMUNITY_LOOKUP_URL}?type=${encodeURIComponent(type)}&livery=${encodeURIComponent(livery)}`;
    let data = await fetchJson(url);
    if (Array.isArray(data)) data = data.length ? data[0] : null;
    return data?.imageUrl || null;
}

function absoluteUrl(siteOrigin, path) {
    if (!path) return null;
    if (/^https?:\/\//i.test(path)) return path;
    if (path.startsWith('/')) return siteOrigin + path;
    return `${siteOrigin}/${path}`;
}

function guessImageType(url) {
    if (!url) return null;
    const u = String(url).split('?')[0].toLowerCase();
    if (u.endsWith('.png')) return 'image/png';
    if (u.endsWith('.jpg') || u.endsWith('.jpeg')) return 'image/jpeg';
    if (u.endsWith('.webp')) return 'image/webp';
    if (u.endsWith('.gif')) return 'image/gif';
    return null;
}

function buildPage({ siteOrigin, flightId, flight, serverName, imageUrl, isCrawler }) {
    const callsign = flight?.callsign || flight?.flightNumber || 'Live Flight';
    const username = flight?.username || flight?.virtualOrgName || 'Unknown Pilot';
    const dep = flight?.departureIcao || flight?.origin || '???';
    const arr = flight?.arrivalIcao || flight?.destination || '???';
    const acData = flight?.aircraft || {};
    const acName = acData.aircraftName || flight?.aircraftName || 'Aircraft';
    const livName = acData.liveryName || flight?.liveryName || '';
    const altitude = Math.round(flight?.position?.alt_ft || flight?.altitude || 0);
    const speed = Math.round(flight?.position?.gs_kt || flight?.groundSpeed || 0);

    // Payload the main app reads from sessionStorage so it can open the flight
    // info window the instant the page loads, without waiting on the websocket.
    // We pass the live position we already fetched here as a starting point —
    // the live socket overwrites it the moment its first packet arrives.
    const handoffPayload = {
        flightId,
        serverName: serverName || '',
        capturedAt: Date.now(),
        flight: {
            flightId: flight?.flightId || flightId,
            callsign: flight?.callsign || null,
            username: flight?.username || null,
            virtualOrgName: flight?.virtualOrgName || null,
            departureIcao: flight?.departureIcao || null,
            arrivalIcao: flight?.arrivalIcao || null,
            aircraftName: acData.aircraftName || flight?.aircraftName || null,
            liveryName: acData.liveryName || flight?.liveryName || null,
            registration: acData.registration || flight?.registration || null,
            userId: flight?.userId || null,
            isStaff: !!flight?.isStaff,
            isVAMember: !!flight?.isVAMember,
            pilotState: flight?.pilotState ?? null,
            position: flight?.position || null,
            aircraft: acData || null
        },
        communityImageUrl: imageUrl || null
    };

    const title = `${callsign} · ${dep} → ${arr}`;
    const descBits = [`Flown by ${username}`, `${acName}${livName ? ' · ' + livName : ''}`];
    if (altitude > 0) descBits.push(`FL${String(Math.round(altitude / 100)).padStart(3, '0')}`);
    if (speed > 0) descBits.push(`${speed} kt`);
    const description = descBits.join(' · ');

    const fallbackImage = absoluteUrl(siteOrigin, PLANE_FALLBACK_PATH);
    const brandLogo = absoluteUrl(siteOrigin, BRAND_LOGO_PATH);
    const image = imageUrl || fallbackImage || brandLogo;
    const imageType = guessImageType(image) || (image === fallbackImage ? PLANE_FALLBACK_TYPE : null);

    const appParams = new URLSearchParams();
    appParams.set('flight', flightId);
    if (serverName) appParams.set('server', serverName);
    const appUrl = `${siteOrigin}/?${appParams.toString()}`;
    const shareUrl = `${siteOrigin}/share/${encodeURIComponent(flightId)}`;

    // Humans: set the handoff snapshot and THEN redirect, in that order, from a
    // single <head> script. Doing both here (instead of a body script) means the
    // snapshot can never be lost to a meta-refresh race — the old `content="0"`
    // refresh fired during head parsing, before the body script ran, so the SPA
    // frequently loaded with no snapshot. No-JS humans fall back to a meta
    // refresh. Crawlers get NEITHER — they must only parse the OG tags, never
    // follow a refresh onto the SPA (which has no per-flight OG tags).
    const handoffJson = JSON.stringify(JSON.stringify(handoffPayload));
    const appUrlJson = JSON.stringify(appUrl);
    const headRedirect = isCrawler
        ? ''
        : `<script>
  try { sessionStorage.setItem('inflight_share_payload', ${handoffJson}); } catch (_) {}
  location.replace(${appUrlJson});
</script>
<noscript><meta http-equiv="refresh" content="0; url=${escapeAttr(appUrl)}"></noscript>`;

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · ${escapeHtml(BRAND_NAME)}</title>
<meta name="description" content="${escapeAttr(description)}">
<meta name="theme-color" content="#38bdf8">

<!-- Open Graph -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeAttr(BRAND_TAGLINE)}">
<meta property="og:title" content="${escapeAttr(title)}">
<meta property="og:description" content="${escapeAttr(description)}">
<meta property="og:url" content="${escapeAttr(shareUrl)}">
<meta property="og:image" content="${escapeAttr(image)}">
<meta property="og:image:secure_url" content="${escapeAttr(image)}">
<meta property="og:image:alt" content="${escapeAttr(acName + (livName ? ' (' + livName + ')' : ''))}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
${imageType ? `<meta property="og:image:type" content="${escapeAttr(imageType)}">` : ''}

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeAttr(title)}">
<meta name="twitter:description" content="${escapeAttr(description)}">
<meta name="twitter:image" content="${escapeAttr(image)}">

<link rel="icon" href="${escapeAttr(brandLogo)}">
${headRedirect}

<style>
  html, body { margin: 0; padding: 0; background: #0a0f1f; color: #e5e7eb; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; min-height: 100vh; }
  .wrap { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; box-sizing: border-box; }
  .card { max-width: 480px; width: 100%; background: linear-gradient(180deg, rgba(56,189,248,0.08), rgba(15,23,42,0)); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; overflow: hidden; box-shadow: 0 12px 40px rgba(0,0,0,0.45); }
  .hero { aspect-ratio: 16 / 9; background: #0f172a center/cover no-repeat; }
  .body { padding: 18px 20px 22px; }
  h1 { font-size: 1.3rem; margin: 0 0 6px; font-weight: 800; letter-spacing: 0.2px; }
  .meta { font-size: 0.85rem; color: #94a3b8; margin: 0 0 14px; line-height: 1.45; }
  .route { display: flex; align-items: center; gap: 12px; font-family: "JetBrains Mono", ui-monospace, Consolas, monospace; font-size: 1.4rem; font-weight: 700; }
  .route .arr-icon { color: #38bdf8; font-size: 1.2rem; }
  a.cta { display: inline-block; margin-top: 18px; padding: 10px 18px; border-radius: 8px; background: linear-gradient(135deg,#38bdf8,#a855f7); color: #fff; font-weight: 700; text-decoration: none; font-size: 0.9rem; }
  a.cta:hover { filter: brightness(1.05); }
  .foot { margin-top: 14px; font-size: 0.7rem; color: #64748b; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="hero" style="background-image: url('${escapeAttr(image)}'), url('${escapeAttr(fallbackImage)}');"></div>
      <div class="body">
        <h1>${escapeHtml(callsign)}</h1>
        <p class="meta">${escapeHtml(description)}</p>
        <div class="route"><span>${escapeHtml(dep)}</span><span class="arr-icon">→</span><span>${escapeHtml(arr)}</span></div>
        <a class="cta" href="${escapeAttr(appUrl)}">Open in ${escapeHtml(BRAND_NAME)} →</a>
        <div class="foot">Live Infinite Flight tracking</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// Completed-flight page, rendered from a stored snapshot once the flight is
// no longer live. Crawlers still get full OG tags with the real flight data,
// so old links keep unfurling nicely forever. Humans get a summary card with
// a CTA into the app instead of a spinner that times out after 60 seconds.
function buildEndedPage({ siteOrigin, flightId, snapshot, imageUrl, replayStats }) {
    const flight = snapshot.flight || {};
    const callsign = flight.callsign || 'Flight';
    const username = flight.username || flight.virtualOrgName || 'Unknown Pilot';
    const dep = flight.departureIcao || '???';
    const arr = flight.arrivalIcao || '???';
    const acName = flight.aircraftName || 'Aircraft';
    const livName = flight.liveryName || '';

    const title = `${callsign} · ${dep} → ${arr}`;
    const descBits = [`Flight completed`, `Flown by ${username}`, `${acName}${livName ? ' · ' + livName : ''}`];
    if (replayStats) {
        descBits.push(fmtDuration(replayStats.durationMs));
        if (replayStats.distanceNm > 0) descBits.push(`${replayStats.distanceNm.toLocaleString('en-US')} nm`);
    }
    if (snapshot.serverName) descBits.push(snapshot.serverName);
    const description = descBits.join(' · ');

    const fallbackImage = absoluteUrl(siteOrigin, PLANE_FALLBACK_PATH);
    const brandLogo = absoluteUrl(siteOrigin, BRAND_LOGO_PATH);
    const image = imageUrl || snapshot.communityImageUrl || fallbackImage || brandLogo;
    const imageType = guessImageType(image) || (image === fallbackImage ? PLANE_FALLBACK_TYPE : null);
    const shareUrl = `${siteOrigin}/share/${encodeURIComponent(flightId)}`;
    const appUrl = `${siteOrigin}/`;
    const replayUrl = `${siteOrigin}/?replay=${encodeURIComponent(flightId)}`;

    // Meta handed to the app so the replay HUD can label the flight before
    // the history fetch finishes. Stored on page load (same-tab navigation
    // keeps sessionStorage), consumed by consumeReplayLinkParam.
    const replayPayloadJson = JSON.stringify(JSON.stringify({
        flightId,
        capturedAt: Date.now(),
        meta: {
            callsign: flight.callsign || '',
            depIcao: flight.departureIcao || '',
            arrIcao: flight.arrivalIcao || '',
            aircraftName: flight.aircraftName || ''
        }
    }));

    const statsHtml = replayStats ? `
        <div class="stats">
          <div class="stat"><span class="stat-v">${escapeHtml(fmtDuration(replayStats.durationMs))}</span><span class="stat-k">Duration</span></div>
          <div class="stat"><span class="stat-v">${escapeHtml(replayStats.distanceNm.toLocaleString('en-US'))}<small> nm</small></span><span class="stat-k">Distance</span></div>
          <div class="stat"><span class="stat-v">${escapeHtml(Math.round(replayStats.maxAltFt / 100) >= 10 ? 'FL' + String(Math.round(replayStats.maxAltFt / 100)).padStart(3, '0') : replayStats.maxAltFt + ' ft')}</span><span class="stat-k">Max Alt</span></div>
          <div class="stat"><span class="stat-v">${escapeHtml(String(replayStats.maxGsKt))}<small> kt</small></span><span class="stat-k">Max GS</span></div>
        </div>` : '';

    const ctaHtml = replayStats
        ? `<a class="cta" href="${escapeAttr(replayUrl)}">▶&nbsp; Watch Flight Replay</a>
        <a class="cta-secondary" href="${escapeAttr(appUrl)}">Track live flights on ${escapeHtml(BRAND_NAME)} →</a>`
        : `<a class="cta" href="${escapeAttr(appUrl)}">Track live flights on ${escapeHtml(BRAND_NAME)} →</a>`;

    const endedDate = (() => {
        const t = snapshot.lastSeenLiveAt || snapshot.capturedAt;
        if (!t) return '';
        try {
            return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
        } catch (_) { return ''; }
    })();

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · ${escapeHtml(BRAND_NAME)}</title>
<meta name="description" content="${escapeAttr(description)}">
<meta name="theme-color" content="#38bdf8">

<!-- Open Graph -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeAttr(BRAND_TAGLINE)}">
<meta property="og:title" content="${escapeAttr(title)}">
<meta property="og:description" content="${escapeAttr(description)}">
<meta property="og:url" content="${escapeAttr(shareUrl)}">
<meta property="og:image" content="${escapeAttr(image)}">
<meta property="og:image:secure_url" content="${escapeAttr(image)}">
<meta property="og:image:alt" content="${escapeAttr(acName + (livName ? ' (' + livName + ')' : ''))}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
${imageType ? `<meta property="og:image:type" content="${escapeAttr(imageType)}">` : ''}

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeAttr(title)}">
<meta name="twitter:description" content="${escapeAttr(description)}">
<meta name="twitter:image" content="${escapeAttr(image)}">

<link rel="icon" href="${escapeAttr(brandLogo)}">
<script>
  try { sessionStorage.setItem('inflight_replay_payload', ${replayPayloadJson}); } catch (_) {}
</script>

<style>
  html, body { margin: 0; padding: 0; background: #0a0f1f; color: #e5e7eb; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; min-height: 100vh; }
  .wrap { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; box-sizing: border-box; }
  .card { max-width: 480px; width: 100%; background: linear-gradient(180deg, rgba(56,189,248,0.08), rgba(15,23,42,0)); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; overflow: hidden; box-shadow: 0 12px 40px rgba(0,0,0,0.45); }
  .hero { aspect-ratio: 16 / 9; background: #0f172a center/cover no-repeat; position: relative; }
  .badge { position: absolute; top: 12px; left: 12px; padding: 5px 12px; border-radius: 999px; background: rgba(15,23,42,0.85); border: 1px solid rgba(148,163,184,0.35); color: #cbd5e1; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; }
  .body { padding: 18px 20px 22px; }
  h1 { font-size: 1.3rem; margin: 0 0 6px; font-weight: 800; letter-spacing: 0.2px; }
  .meta { font-size: 0.85rem; color: #94a3b8; margin: 0 0 14px; line-height: 1.45; }
  .route { display: flex; align-items: center; gap: 12px; font-family: "JetBrains Mono", ui-monospace, Consolas, monospace; font-size: 1.4rem; font-weight: 700; }
  .route .arr-icon { color: #38bdf8; font-size: 1.2rem; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 16px; }
  .stat { background: rgba(15,23,42,0.6); border: 1px solid rgba(148,163,184,0.16); border-radius: 10px; padding: 10px 6px; text-align: center; display: flex; flex-direction: column; gap: 3px; }
  .stat-v { font-family: "JetBrains Mono", ui-monospace, Consolas, monospace; font-weight: 700; font-size: 0.92rem; color: #e2e8f0; }
  .stat-v small { font-size: 0.68rem; color: #94a3b8; font-weight: 600; }
  .stat-k { font-size: 0.62rem; font-weight: 700; letter-spacing: 0.7px; text-transform: uppercase; color: #64748b; }
  a.cta { display: block; text-align: center; margin-top: 18px; padding: 12px 18px; border-radius: 8px; background: linear-gradient(135deg,#38bdf8,#a855f7); color: #fff; font-weight: 700; text-decoration: none; font-size: 0.9rem; }
  a.cta:hover { filter: brightness(1.05); }
  a.cta-secondary { display: block; text-align: center; margin-top: 10px; padding: 10px 18px; border-radius: 8px; border: 1px solid rgba(148,163,184,0.3); color: #cbd5e1; font-weight: 600; text-decoration: none; font-size: 0.82rem; }
  a.cta-secondary:hover { border-color: rgba(148,163,184,0.55); color: #f1f5f9; }
  .foot { margin-top: 14px; font-size: 0.7rem; color: #64748b; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="hero" style="background-image: url('${escapeAttr(image)}'), url('${escapeAttr(fallbackImage)}');">
        <span class="badge">Flight completed</span>
      </div>
      <div class="body">
        <h1>${escapeHtml(callsign)}</h1>
        <p class="meta">${escapeHtml(description)}${endedDate ? ` · ${escapeHtml(endedDate)}` : ''}</p>
        <div class="route"><span>${escapeHtml(dep)}</span><span class="arr-icon">→</span><span>${escapeHtml(arr)}</span></div>
        ${statsHtml}
        ${ctaHtml}
        <div class="foot">Live Infinite Flight tracking</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// Handoff page used when the REST lookup missed (the flight may still be live
// on the socket — REST just hasn't caught up yet). Crucially, this page always
// preserves ?flight=<id> in the redirect so the client can keep polling for it,
// and stashes a minimal payload in sessionStorage so consumeShareLinkParam
// knows what to look for.
//
// For crawlers we serve brand-neutral OG tags ("Live flight on Inflight") so
// Discord's link unfurl doesn't get cached with a misleading "Flight ended"
// preview the next time someone shares the same link.
function buildPendingHandoffPage({ siteOrigin, flightId, isCrawler }) {
    const brandLogo = absoluteUrl(siteOrigin, BRAND_LOGO_PATH);
    const fallbackImage = absoluteUrl(siteOrigin, PLANE_FALLBACK_PATH);
    const heroImage = fallbackImage || brandLogo;
    const heroType = guessImageType(heroImage);

    const handoffPayload = flightId ? {
        flightId,
        serverName: '',
        capturedAt: Date.now(),
        flight: null,
        communityImageUrl: null,
        pending: true
    } : null;

    const appParams = new URLSearchParams();
    if (flightId) appParams.set('flight', flightId);
    const appUrl = `${siteOrigin}/${appParams.toString() ? '?' + appParams.toString() : ''}`;
    const shareUrl = flightId
        ? `${siteOrigin}/share/${encodeURIComponent(flightId)}`
        : `${siteOrigin}/`;

    // Humans: stash the (pending) snapshot then redirect, from one head script,
    // so the client keeps the flightId to poll for. Crawlers must not follow any
    // refresh — they only parse OG tags.
    const pendingJson = handoffPayload ? JSON.stringify(JSON.stringify(handoffPayload)) : null;
    const appUrlJson = JSON.stringify(appUrl);
    const headRedirect = isCrawler
        ? ''
        : `<script>
  try { ${pendingJson ? `sessionStorage.setItem('inflight_share_payload', ${pendingJson});` : ''} } catch (_) {}
  location.replace(${appUrlJson});
</script>
<noscript><meta http-equiv="refresh" content="0; url=${escapeAttr(appUrl)}"></noscript>`;

    const ogTitle = `Live flight on ${BRAND_NAME}`;
    const ogDescription = `Watch this live flight on ${BRAND_TAGLINE}.`;

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Opening flight · ${escapeHtml(BRAND_NAME)}</title>
<meta name="description" content="${escapeAttr(ogDescription)}">
<meta name="theme-color" content="#38bdf8">

<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeAttr(BRAND_TAGLINE)}">
<meta property="og:title" content="${escapeAttr(ogTitle)}">
<meta property="og:description" content="${escapeAttr(ogDescription)}">
<meta property="og:url" content="${escapeAttr(shareUrl)}">
<meta property="og:image" content="${escapeAttr(heroImage)}">
<meta property="og:image:secure_url" content="${escapeAttr(heroImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
${heroType ? `<meta property="og:image:type" content="${escapeAttr(heroType)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeAttr(ogTitle)}">
<meta name="twitter:description" content="${escapeAttr(ogDescription)}">
<meta name="twitter:image" content="${escapeAttr(heroImage)}">

<link rel="icon" href="${escapeAttr(brandLogo)}">
${headRedirect}

<style>
  html, body { margin: 0; padding: 0; background: #0a0f1f; color: #e5e7eb; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; min-height: 100vh; }
  .wrap { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; box-sizing: border-box; }
  .card { max-width: 360px; text-align: center; }
  .spinner { width: 48px; height: 48px; margin: 0 auto 18px; border-radius: 50%; border: 3px solid rgba(56,189,248,0.18); border-top-color: #38bdf8; animation: spin 0.9s linear infinite; }
  h1 { margin: 0 0 6px; font-size: 1.15rem; font-weight: 700; }
  p { margin: 0; color: #94a3b8; font-size: 0.9rem; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="spinner"></div>
      <h1>Opening flight…</h1>
      <p>Connecting to ${escapeHtml(BRAND_NAME)}.</p>
    </div>
  </div>
</body>
</html>`;
}

exports.handler = async (event) => {
    const flightId = (event.queryStringParameters && event.queryStringParameters.flight) || '';
    const headers = event.headers || {};
    const proto = headers['x-forwarded-proto'] || headers['X-Forwarded-Proto'] || 'https';
    const host = headers['x-forwarded-host'] || headers['host'] || headers['Host'] || SITE_HOST_FALLBACK;
    const siteOrigin = `${proto}://${host}`;
    const ua = String(headers['user-agent'] || headers['User-Agent'] || '');
    const isCrawler = CRAWLER_UA_RE.test(ua);

    if (!flightId) {
        return {
            statusCode: 400,
            headers: {
                'content-type': 'text/html; charset=utf-8',
                'cache-control': 'no-store'
            },
            body: buildPendingHandoffPage({ siteOrigin, flightId: '', isCrawler })
        };
    }

    // 1) Stored snapshot first — written below on every live hit. This is
    //    what makes the link durable: it resolves even when the live feed
    //    can't.
    const store = getShareStore(event);
    const snapshot = await readSnapshot(store, flightId);

    // 2) Live lookup. With a snapshot in hand we retry less aggressively —
    //    the snapshot already guarantees a rich response either way.
    const result = await findFlightWithRetry(flightId, snapshot ? { attempts: 2, delayMs: 900 } : {});

    if (result) {
        const { flight, serverName } = result;
        const acData = flight.aircraft || {};
        const acType = acData.aircraftName || flight.aircraftName;
        const acLivery = acData.liveryName || flight.liveryName;
        const imageUrl = (await fetchAircraftImage(acType, acLivery)) ||
            (snapshot && snapshot.communityImageUrl) || null;

        // Refresh the stored snapshot with the latest live state so the link
        // keeps working after the flight ends.
        const freshSnapshot = buildSnapshot({
            flightId,
            serverName,
            flight,
            communityImageUrl: imageUrl,
            lastSeenLiveAt: Date.now()
        });
        if (freshSnapshot) await writeSnapshot(store, freshSnapshot);

        return {
            statusCode: 200,
            headers: {
                'content-type': 'text/html; charset=utf-8',
                // Short cache so a re-share within ~30s is cheap, but new state
                // (altitude/speed) refreshes for crawlers polling later.
                'cache-control': 'public, max-age=30, s-maxage=30'
            },
            body: buildPage({ siteOrigin, flightId, flight, serverName, imageUrl, isCrawler })
        };
    }

    if (snapshot && snapshot.flight) {
        const lastSeen = snapshot.lastSeenLiveAt || snapshot.capturedAt || 0;
        const withinGrace = Date.now() - lastSeen < LIVE_GRACE_MS;

        if (withinGrace) {
            // Seen live moments ago — the REST feed is probably just lagging.
            // Serve the full rich page from the snapshot: crawlers get real
            // OG tags, humans get an instant handoff (the app opens the
            // window from the snapshot and the socket takes over).
            return {
                statusCode: 200,
                headers: {
                    'content-type': 'text/html; charset=utf-8',
                    'cache-control': 'no-store, no-cache, must-revalidate'
                },
                body: buildPage({
                    siteOrigin,
                    flightId,
                    flight: snapshot.flight,
                    serverName: snapshot.serverName,
                    imageUrl: snapshot.communityImageUrl,
                    isCrawler
                })
            };
        }

        // Flight is over. Still a first-class result: full OG preview from
        // the snapshot plus a summary card with the recorded flight's totals
        // and a "Watch Flight Replay" CTA when the backend still has the
        // path. Cacheable since the data is final.
        const historyPoints = await fetchFlightHistory(flightId);
        const replayStats = computeReplayStats(historyPoints);

        return {
            statusCode: 200,
            headers: {
                'content-type': 'text/html; charset=utf-8',
                'cache-control': 'public, max-age=3600, s-maxage=3600'
            },
            body: buildEndedPage({
                siteOrigin,
                flightId,
                snapshot,
                imageUrl: snapshot.communityImageUrl,
                replayStats
            })
        };
    }

    // 3) Nothing stored and nothing live. The flight may still exist (socket
    //    ahead of REST) — hand the user off to the app with ?flight=<id>
    //    preserved so the client can poll. Never cache misses, otherwise the
    //    CDN poisons future clicks within the same window.
    return {
        statusCode: 200,
        headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store, no-cache, must-revalidate'
        },
        body: buildPendingHandoffPage({ siteOrigin, flightId, isCrawler })
    };
};
