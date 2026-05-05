/**
 * SVG badge renderer.
 *
 * Pure string concatenation, no dependencies. Stays under 1ms per render.
 * Output is a self-contained SVG with all styling inline so it works in
 * IFC signatures, Discourse posts, GitHub READMEs, forum embeds, etc.
 *
 * Fixed dimensions: 400x80. Two themes: dark (default), light.
 */

const WIDTH = 400;
const HEIGHT = 80;

const THEMES = {
  dark: {
    bg: '#0f1419',
    bgGradient: '#1a2332',
    border: '#2a3441',
    text: '#e6edf3',
    textDim: '#8b949e',
    accent: '#58a6ff',
    accentMuted: '#1f6feb',
    success: '#3fb950',
    danger: '#f85149',
  },
  light: {
    bg: '#ffffff',
    bgGradient: '#f6f8fa',
    border: '#d0d7de',
    text: '#1f2328',
    textDim: '#656d76',
    accent: '#0969da',
    accentMuted: '#218bff',
    success: '#1a7f37',
    danger: '#cf222e',
  },
};

/**
 * Escape user-controlled strings before injecting into SVG.
 * SVG is XML, so the same rules as HTML attribute/text escaping apply.
 */
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Truncate with ellipsis at character count (rough — SVG doesn't measure text).
 */
function truncate(s, max) {
  if (!s) return '';
  s = String(s);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/**
 * Format altitude as e.g. "FL370" or "12,500 ft".
 */
function formatAlt(altFt) {
  if (typeof altFt !== 'number' || !isFinite(altFt)) return '—';
  if (altFt >= 18000) {
    return 'FL' + String(Math.round(altFt / 100)).padStart(3, '0');
  }
  return Math.round(altFt).toLocaleString('en-US') + ' ft';
}

/**
 * Format ground speed as "423 kt" or "—".
 */
function formatGS(gsKt) {
  if (typeof gsKt !== 'number' || !isFinite(gsKt)) return '—';
  return Math.round(gsKt) + ' kt';
}

/**
 * Renders the offline state.
 */
function renderOffline(username, theme) {
  const t = THEMES[theme] || THEMES.dark;
  const safeUser = esc(truncate(username, 24));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${safeUser} is not currently flying">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="${t.bgGradient}"/>
<stop offset="100%" stop-color="${t.bg}"/>
</linearGradient>
</defs>
<rect width="${WIDTH}" height="${HEIGHT}" rx="8" fill="url(#bg)" stroke="${t.border}" stroke-width="1"/>
<g font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">
<circle cx="24" cy="40" r="6" fill="${t.textDim}"/>
<text x="44" y="34" fill="${t.text}" font-size="14" font-weight="600">${safeUser}</text>
<text x="44" y="54" fill="${t.textDim}" font-size="12">Not currently flying</text>
<text x="${WIDTH - 12}" y="${HEIGHT - 10}" fill="${t.textDim}" font-size="9" text-anchor="end" opacity="0.7">inflight.info</text>
</g>
</svg>`;
}

/**
 * Renders the active flight state.
 *
 * `flight` is a simplifyFlight() output. `server` is the server display name
 * (e.g. "Expert Server").
 */
function renderActive(username, flight, server, theme) {
  const t = THEMES[theme] || THEMES.dark;

  const safeUser = esc(truncate(username, 18));
  const safeCallsign = esc(truncate(flight.callsign || '—', 10));
  const safeAircraft = esc(truncate(flight.aircraft?.aircraftName || 'Unknown aircraft', 26));

  const dep = esc(truncate(flight.departureIcao || '????', 4));
  const arr = esc(truncate(flight.arrivalIcao || '????', 4));

  const alt = esc(formatAlt(flight.position?.alt_ft));
  const gs = esc(formatGS(flight.position?.gs_kt));

  // Server abbreviation pill
  const serverShort = (server || '').includes('Expert') ? 'EXPERT'
    : (server || '').includes('Training') ? 'TRAINING'
    : (server || '').includes('Casual') ? 'CASUAL'
    : 'LIVE';

  const serverColor = serverShort === 'EXPERT' ? t.success
    : serverShort === 'TRAINING' ? t.accent
    : t.textDim;

  // Pulsing dot indicates "live"
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${safeUser} flying ${safeCallsign} from ${dep} to ${arr}">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="${t.bgGradient}"/>
<stop offset="100%" stop-color="${t.bg}"/>
</linearGradient>
</defs>
<rect width="${WIDTH}" height="${HEIGHT}" rx="8" fill="url(#bg)" stroke="${t.border}" stroke-width="1"/>
<g font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">

<circle cx="20" cy="20" r="4" fill="${t.success}">
<animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite"/>
</circle>
<text x="32" y="24" fill="${t.text}" font-size="13" font-weight="600">${safeUser}</text>

<rect x="${WIDTH - 70}" y="10" width="60" height="18" rx="9" fill="${serverColor}" opacity="0.18"/>
<text x="${WIDTH - 40}" y="22" fill="${serverColor}" font-size="9" font-weight="700" text-anchor="middle" letter-spacing="0.5">${serverShort}</text>

<text x="12" y="48" fill="${t.accent}" font-size="16" font-weight="700" letter-spacing="0.3">${safeCallsign}</text>
<text x="12" y="64" fill="${t.textDim}" font-size="11">${safeAircraft}</text>

<g transform="translate(${WIDTH - 168}, 38)">
<text x="0" y="10" fill="${t.text}" font-size="14" font-weight="600">${dep}</text>
<line x1="38" y1="6" x2="74" y2="6" stroke="${t.textDim}" stroke-width="1" stroke-dasharray="2 2"/>
<path d="M 56 0 L 60 6 L 56 12 Z" fill="${t.textDim}"/>
<text x="82" y="10" fill="${t.text}" font-size="14" font-weight="600">${arr}</text>
</g>

<text x="${WIDTH - 12}" y="60" fill="${t.textDim}" font-size="10" text-anchor="end">${alt} • ${gs}</text>
<text x="${WIDTH - 12}" y="${HEIGHT - 6}" fill="${t.textDim}" font-size="9" text-anchor="end" opacity="0.7">inflight.info</text>
</g>
</svg>`;
}

/**
 * Renders the "not opted in" state.
 */
function renderNotOptedIn(username, theme) {
  const t = THEMES[theme] || THEMES.dark;
  const safeUser = esc(truncate(username, 24));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${safeUser} has not enabled this badge">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="${t.bgGradient}"/>
<stop offset="100%" stop-color="${t.bg}"/>
</linearGradient>
</defs>
<rect width="${WIDTH}" height="${HEIGHT}" rx="8" fill="url(#bg)" stroke="${t.border}" stroke-width="1"/>
<g font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">
<text x="${WIDTH / 2}" y="34" fill="${t.text}" font-size="13" font-weight="600" text-anchor="middle">${safeUser}</text>
<text x="${WIDTH / 2}" y="54" fill="${t.textDim}" font-size="11" text-anchor="middle">Badge not enabled — visit inflight.info to opt in</text>
</g>
</svg>`;
}

/**
 * Public render entrypoint.
 *
 * @param {string} username   IF username being requested
 * @param {object|null} flight  simplifyFlight() output, or null if offline
 * @param {string|null} server  e.g. "Expert Server"
 * @param {'dark'|'light'} theme
 * @param {'offline'|'active'|'not_opted_in'} state
 */
function render(username, flight, server, theme, state) {
  if (state === 'not_opted_in') return renderNotOptedIn(username, theme);
  if (state === 'offline' || !flight) return renderOffline(username, theme);
  return renderActive(username, flight, server, theme);
}

module.exports = { render };
