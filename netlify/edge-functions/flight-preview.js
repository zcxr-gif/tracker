/**
 * flight-preview.js — per-flight link previews for the app's own share URLs.
 *
 * Sharing a flight produces `https://inflight.info/?flight=<id>&server=<name>&s=<snapshot>`
 * (see buildFlightShareUrl in flight.js). That URL is deliberately a direct hit
 * on the SPA: the snapshot rides in the query string, so the flight window opens
 * the instant the page loads instead of waiting on a function round-trip and a
 * websocket. It is the right call for humans and the wrong one for crawlers —
 * index.html carries the site-wide Open Graph tags, so pasting a flight into
 * Discord or iMessage unfurls as the generic InFlight banner with no callsign,
 * no route and no picture of the flight.
 *
 * The fix is not to route humans back through a function. It is to notice that
 * the /.netlify/functions/share endpoint ALREADY builds exactly the page a
 * crawler wants — it looks the flight up across all sessions, falls back to a
 * stored snapshot once the flight has ended, and emits full OG + Twitter tags.
 * It stopped being reachable only because nothing links to /share/<id> any more.
 *
 * So this runs at the site root and does one thing: when a request for `/`
 * carries a `flight` parameter AND comes from a link-preview crawler, it
 * rewrites to that function. Everything else — every human, every request
 * without a flight, every other path — is returned untouched, so the fast path
 * this was built to protect stays exactly as it was.
 *
 * A rewrite, not a redirect: the crawler's URL stays the one the user shared,
 * which is what ends up in the unfurl.
 */

// Kept in step with CRAWLER_UA_RE in netlify/functions/share.js. Two copies is
// the cost of the edge runtime being a separate module system from the
// function's; the shape of the list is stable and the failure mode of a drift
// is mild (a crawler falls through and sees the generic banner, exactly as it
// does today).
const CRAWLER_UA_RE = /discord|slack|twitter|telegram|whatsapp|facebookexternalhit|facebot|linkedin|skype|pinterest|redditbot|embedly|googlebot|bingbot|duckduckbot|applebot|yandex|baiduspider|snapchat|tumblr|vkshare|iframely|tiktok|preview|unfurl|bot\b|crawler|spider/i;

// Parameters worth carrying into the preview. `s` (the snapshot blob) is
// deliberately dropped: it can be kilobytes, the function does its own lookup,
// and a crawler has no use for the app handoff payload.
const FORWARD = ['flight', 'server', 'map'];

export default async (request, context) => {
    let url;
    try {
        url = new URL(request.url);
    } catch {
        return; // Unparseable: not ours to handle.
    }

    // Only the bare site root. A share URL is always `/?flight=…`, and matching
    // more broadly would put this in front of pages that have their own tags.
    if (url.pathname !== '/' && url.pathname !== '/index.html') return;

    const flightId = url.searchParams.get('flight');
    if (!flightId) return;

    const ua = request.headers.get('user-agent') || '';
    if (!CRAWLER_UA_RE.test(ua)) return;

    const params = new URLSearchParams();
    for (const key of FORWARD) {
        const value = url.searchParams.get(key);
        if (value) params.set(key, value);
    }

    return context.rewrite(`/.netlify/functions/share?${params.toString()}`);
};

// Declared in-file rather than in a netlify.toml. The site has never had one,
// which means its build settings live in the Netlify UI; introducing a
// netlify.toml would start overriding them from the repo and is a much bigger
// change than this needs to be.
export const config = { path: '/' };
