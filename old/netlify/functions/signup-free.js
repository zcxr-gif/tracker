// Free-account signup — creates a Supabase user that is confirmed on the spot,
// so a new free pilot lands straight in the app with no "check your email"
// detour. This mirrors how the paid flow provisions its accounts server-side.
//
// The one privileged call — creating a user with the email pre-confirmed —
// hits Supabase's Auth Admin REST endpoint directly with the service-role key,
// which lives only in this function's environment and never reaches the
// browser. Using plain fetch keeps the function dependency-free (Netlify runs
// Node 18+, which has global fetch).
//
// Netlify environment variables:
//   SUPABASE_URL                — project URL (defaults to the known one)
//   SUPABASE_SERVICE_ROLE_KEY   — service-role secret (server-side only)
//
// If the service-role key isn't configured we return 501 so the client can
// fall back to the ordinary (email-confirmation) sign-up path instead of
// breaking.

// This Netlify runtime doesn't reliably expose a global fetch (the sibling
// functions all pull in node-fetch), so use the global when present and fall
// back to node-fetch otherwise.
const fetchFn = (typeof globalThis !== 'undefined' && globalThis.fetch)
  ? (...args) => globalThis.fetch(...args)
  : (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://lcgaoiqwwpyqndaucyzu.supabase.co').replace(/\/+$/, '');
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const json = (statusCode, obj) => ({ statusCode, headers: CORS, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  // Health check: GET the URL in a browser to confirm the function is deployed
  // and whether it can see the service-role key. Never returns the key itself.
  if (event.httpMethod === 'GET') {
    return json(200, {
      ok: true,
      configured: Boolean(SERVICE_ROLE),
      supabaseUrl: SUPABASE_URL,
      hint: SERVICE_ROLE
        ? 'Ready: SUPABASE_SERVICE_ROLE_KEY is set for this deploy.'
        : 'SUPABASE_SERVICE_ROLE_KEY is NOT visible to this deploy — set it in Netlify and redeploy (check the context: Production vs Deploy Previews vs Branch deploys).',
    });
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  // Not configured → tell the client to use its fallback path.
  if (!SERVICE_ROLE) return json(501, { error: 'not_configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Invalid request.' }); }

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const name = String(body.name || '').trim();

  if (!email || !password) return json(400, { error: 'Email and password are required.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'Please enter a valid email address.' });
  if (password.length < 6) return json(400, { error: 'Password must be at least 6 characters.' });

  try {
    const res = await fetchFn(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true, // no verification email — account is live immediately
        user_metadata: { full_name: name, name, is_pro: false },
      }),
    });

    const payload = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = String(payload?.msg || payload?.error_description || payload?.error || payload?.message || '');
      const already = res.status === 422 || /registered|already|exists/i.test(msg);
      return json(already ? 409 : 400, {
        error: already
          ? 'That email already has an account. Please sign in instead.'
          : (msg || 'Could not create your account.'),
      });
    }

    return json(200, { ok: true, userId: payload?.id || payload?.user?.id || null });
  } catch (err) {
    console.error('[signup-free] failed:', err);
    return json(500, { error: 'Could not create your account. Please try again.' });
  }
};
