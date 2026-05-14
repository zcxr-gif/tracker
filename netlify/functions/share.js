// Share endpoint for flight permalinks.
//
// Flow:
//   /share/<flightId>  -> (via _redirects) /.netlify/functions/share?flight=<flightId>
//
// The function looks up the flight on the live ACARS feed, grabs its
// community aircraft photo, and returns an HTML page packed with Open Graph
// + Twitter Card meta tags so chat apps render a rich preview. The page also
// meta-refreshes / scripts to /?flight=<flightId> so when a human clicks
// the link, the main app loads and auto-opens that flight.

const ACARS_FLIGHTS_URL = 'https://site--acars-backend--6dmjph8ltlhv.code.run/flights';
const COMMUNITY_LOOKUP_URL = 'https://site--indgo-backend--6dmjph8ltlhv.code.run/api/aircraft/lookup';
const FALLBACK_IMAGE = 'https://indgo-va.netlify.app/CommunityPlanes/default.png';
const SITE_LOGO = 'https://indgo-va.netlify.app/logo.webp';

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

async function findFlight(flightId) {
    try {
        const res = await fetchFn(ACARS_FLIGHTS_URL, { headers: { 'accept': 'application/json' } });
        if (!res.ok) return null;
        const payload = await res.json();
        const flights = Array.isArray(payload) ? payload : (payload?.flights || payload?.data || []);
        return flights.find(f => f && f.flightId === flightId) || null;
    } catch (err) {
        console.warn('share: live flight fetch failed', err && err.message);
        return null;
    }
}

async function fetchAircraftImage(type, livery) {
    if (!type || !livery) return null;
    try {
        const url = `${COMMUNITY_LOOKUP_URL}?type=${encodeURIComponent(type)}&livery=${encodeURIComponent(livery)}`;
        const res = await fetchFn(url, { headers: { 'accept': 'application/json' } });
        if (!res.ok) return null;
        let data = await res.json();
        if (Array.isArray(data)) data = data.length ? data[0] : null;
        return data?.imageUrl || null;
    } catch (err) {
        console.warn('share: image lookup failed', err && err.message);
        return null;
    }
}

function buildPage({ siteOrigin, flightId, flight, imageUrl }) {
    const callsign = flight?.callsign || flight?.flightNumber || 'Live Flight';
    const username = flight?.username || flight?.virtualOrgName || 'Unknown Pilot';
    const dep = flight?.departureIcao || flight?.origin || '???';
    const arr = flight?.arrivalIcao || flight?.destination || '???';
    const acData = flight?.aircraft || {};
    const acName = acData.aircraftName || flight?.aircraftName || 'Aircraft';
    const livName = acData.liveryName || flight?.liveryName || '';
    const altitude = Math.round(flight?.position?.alt_ft || flight?.altitude || 0);
    const speed = Math.round(flight?.position?.gs_kt || flight?.groundSpeed || 0);

    const title = `${callsign} · ${dep} → ${arr}`;
    const descBits = [`Flown by ${username}`, `${acName}${livName ? ' · ' + livName : ''}`];
    if (altitude > 0) descBits.push(`FL${String(Math.round(altitude / 100)).padStart(3, '0')}`);
    if (speed > 0) descBits.push(`${speed} kt`);
    const description = descBits.join(' · ');

    const image = imageUrl || FALLBACK_IMAGE;
    const appUrl = `${siteOrigin}/?flight=${encodeURIComponent(flightId)}`;
    const shareUrl = `${siteOrigin}/share/${encodeURIComponent(flightId)}`;

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Indgo</title>
<meta name="description" content="${escapeAttr(description)}">

<!-- Open Graph -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="Indgo Live Flight Tracker">
<meta property="og:title" content="${escapeAttr(title)}">
<meta property="og:description" content="${escapeAttr(description)}">
<meta property="og:image" content="${escapeAttr(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${escapeAttr(shareUrl)}">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeAttr(title)}">
<meta name="twitter:description" content="${escapeAttr(description)}">
<meta name="twitter:image" content="${escapeAttr(image)}">

<link rel="icon" href="${escapeAttr(SITE_LOGO)}">
<meta http-equiv="refresh" content="0; url=${escapeAttr(appUrl)}">

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
      <div class="hero" style="background-image: url('${escapeAttr(image)}'), url('${escapeAttr(FALLBACK_IMAGE)}');"></div>
      <div class="body">
        <h1>${escapeHtml(callsign)}</h1>
        <p class="meta">${escapeHtml(description)}</p>
        <div class="route"><span>${escapeHtml(dep)}</span><span class="arr-icon">→</span><span>${escapeHtml(arr)}</span></div>
        <a class="cta" href="${escapeAttr(appUrl)}">Open in Indgo →</a>
        <div class="foot">Live Infinite Flight tracking</div>
      </div>
    </div>
  </div>
  <script>window.location.replace(${JSON.stringify(appUrl)});</script>
</body>
</html>`;
}

function buildNotFoundPage({ siteOrigin, flightId }) {
    const appUrl = `${siteOrigin}/`;
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Flight ended · Indgo</title>
<meta name="description" content="This live flight has ended or is no longer being tracked.">

<meta property="og:title" content="Flight ended">
<meta property="og:description" content="This live flight has ended or is no longer being tracked. Open Indgo to find another.">
<meta property="og:image" content="${escapeAttr(SITE_LOGO)}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">

<link rel="icon" href="${escapeAttr(SITE_LOGO)}">
<meta http-equiv="refresh" content="3; url=${escapeAttr(appUrl)}">

<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0a0f1f; color: #e5e7eb; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; }
  .card { max-width: 420px; text-align: center; }
  h1 { margin: 0 0 8px; font-size: 1.4rem; }
  p { color: #94a3b8; }
  a { color: #38bdf8; text-decoration: none; font-weight: 700; }
</style>
</head>
<body>
  <div class="card">
    <h1>This flight has ended</h1>
    <p>The flight <code>${escapeHtml(flightId || '')}</code> isn't live anymore.</p>
    <p><a href="${escapeAttr(appUrl)}">Open Indgo →</a></p>
  </div>
</body>
</html>`;
}

exports.handler = async (event) => {
    const flightId = (event.queryStringParameters && event.queryStringParameters.flight) || '';
    const proto = (event.headers && (event.headers['x-forwarded-proto'] || event.headers['X-Forwarded-Proto'])) || 'https';
    const host = (event.headers && (event.headers['x-forwarded-host'] || event.headers['host'] || event.headers['Host'])) || 'indgo-va.netlify.app';
    const siteOrigin = `${proto}://${host}`;

    if (!flightId) {
        return {
            statusCode: 400,
            headers: { 'content-type': 'text/html; charset=utf-8' },
            body: buildNotFoundPage({ siteOrigin, flightId: '' })
        };
    }

    const flight = await findFlight(flightId);
    if (!flight) {
        return {
            statusCode: 404,
            headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' },
            body: buildNotFoundPage({ siteOrigin, flightId })
        };
    }

    const acData = flight.aircraft || {};
    const acType = acData.aircraftName || flight.aircraftName;
    const acLivery = acData.liveryName || flight.liveryName;
    const imageUrl = await fetchAircraftImage(acType, acLivery);

    return {
        statusCode: 200,
        headers: {
            'content-type': 'text/html; charset=utf-8',
            // Short cache so a re-share within ~30s is cheap, but new state
            // (altitude/speed) refreshes for crawlers polling later.
            'cache-control': 'public, max-age=30, s-maxage=30'
        },
        body: buildPage({ siteOrigin, flightId, flight, imageUrl })
    };
};
