// Crew Center engine — boots from a VA's OWN Supabase and renders their site.
//
// URL forms:
//   crewcenter.html?va=<slug>     → look the slug up in directory.json
//   crewcenter.html?url=..&key=.. → direct connection (used by the onboarding
//                                    preview before a VA is in the directory)
//
// Everything data-related goes browser → the VA's Supabase. Nothing here calls
// our own backend, so it never touches Netlify Functions. See docs/crew-center.md.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const ENGINE_SCHEMA_VERSION = 1;

const root = document.getElementById('cc-root');

// --- tiny helpers ----------------------------------------------------------
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const safeUrl = (u) => /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '';

function fail(msg) {
  root.dataset.state = 'error';
  root.innerHTML = `<div class="cc-error">${esc(msg)}</div>`;
}

// --- resolve the VA connection ---------------------------------------------
async function resolveConnection() {
  const q = new URLSearchParams(location.search);
  const directUrl = q.get('url');
  const directKey = q.get('key');
  if (directUrl && directKey) return { url: directUrl, anonKey: directKey };

  const slug = q.get('va');
  if (!slug) throw new Error('No VA specified. Use ?va=<slug>.');

  const res = await fetch('directory.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('Could not load the VA directory.');
  const dir = await res.json();
  const entry = dir && dir.vas && dir.vas[slug];
  if (!entry) throw new Error(`Unknown VA "${slug}".`);
  return entry;
}

// --- theme -----------------------------------------------------------------
function applyTheme(theme = {}) {
  const r = document.documentElement.style;
  const map = {
    primary: '--cc-primary', accent: '--cc-accent', bg: '--cc-bg',
    surface: '--cc-surface', text: '--cc-text', muted: '--cc-muted',
    font: '--cc-font', radius: '--cc-radius',
  };
  for (const [k, cssVar] of Object.entries(map)) {
    if (theme[k]) r.setProperty(cssVar, String(theme[k]));
  }
  // Custom CSS escape hatch (owner-supplied). CSS only — custom JS is never
  // allowed (see the phishing guardrail in docs/crew-center.md).
  if (theme.custom_css) {
    const style = document.createElement('style');
    style.textContent = String(theme.custom_css);
    document.head.appendChild(style);
  }
}

// --- block renderers -------------------------------------------------------
// Each returns an HTML string. `ctx` carries { sb, cfg, session, pilot }.
const blocks = {
  hero(props, ctx) {
    const theme = ctx.cfg.theme || {};
    const bg = safeUrl(theme.hero_image);
    const style = bg ? ` style="background-image:linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.45)),url('${esc(bg)}')"` : '';
    return `<div class="cc-hero"${style}>
      <h1>${esc(ctx.cfg.va_name || 'Crew Center')}</h1>
      <p>${esc(props.tagline || '')}</p>
    </div>`;
  },

  auth(props, ctx) {
    const id = 'cc-auth';
    if (ctx.pilot) {
      const status = esc(ctx.pilot.status);
      return section(props.label || 'Pilot Area', `
        <div class="cc-auth" id="${id}">
          <p>Signed in as <strong>${esc(ctx.pilot.display_name || ctx.session.user.email)}</strong>
             — <span class="cc-badge">${status}</span></p>
          <button class="cc-btn secondary" data-cc-signout>Sign out</button>
        </div>`, 'auth');
    }
    return section(props.label || 'Pilot Login', `
      <div class="cc-auth" id="${id}">
        <input type="email" data-cc="email" placeholder="Email" autocomplete="email">
        <input type="password" data-cc="password" placeholder="Password" autocomplete="current-password">
        <div class="cc-row">
          <button class="cc-btn" data-cc-login>Log in</button>
          <button class="cc-btn secondary" data-cc-join>Sign up</button>
        </div>
        <input type="text" data-cc="callsign" placeholder="Callsign (sign-up only)" style="margin-top:.5rem">
        <input type="text" data-cc="invite" placeholder="Invite code (if required)">
        <div class="cc-msg" data-cc-msg></div>
      </div>`, 'auth');
  },

  async roster(props, ctx) {
    const { data, error } = await ctx.sb
      .from('pilots')
      .select('callsign, display_name, status, total_minutes, ranks(name), hubs(icao)')
      .eq('status', 'active')
      .order('total_minutes', { ascending: false })
      .limit(200);
    if (error) return section(props.title || 'Roster', errorNote(error));
    const rows = (data || []).map((p) => `<tr>
      <td>${esc(p.callsign || '')}</td>
      <td>${esc(p.display_name || '')}</td>
      <td>${esc(p.ranks?.name || '')}</td>
      <td>${esc(p.hubs?.icao || '')}</td>
      <td>${hours(p.total_minutes)}</td>
    </tr>`).join('') || emptyRow(5, 'No active pilots yet.');
    return section(props.title || 'Roster', table(
      ['Callsign', 'Pilot', 'Rank', 'Hub', 'Hours'], rows), 'roster');
  },

  async ranks(props, ctx) {
    const { data, error } = await ctx.sb.from('ranks')
      .select('name, min_hours, color').order('sort_order');
    if (error) return section(props.title || 'Ranks', errorNote(error));
    const cards = (data || []).map((r) => `<div class="cc-card">
      <div style="font-weight:600;color:${r.color ? esc(r.color) : 'inherit'}">${esc(r.name)}</div>
      <div class="cc-sub">${esc(r.min_hours)}+ hours</div>
    </div>`).join('') || `<p class="cc-sub">No ranks defined yet.</p>`;
    return section(props.title || 'Ranks', `<div class="cc-grid">${cards}</div>`, 'ranks');
  },

  async hubs(props, ctx) {
    const { data, error } = await ctx.sb.from('hubs')
      .select('icao, name, is_primary').order('is_primary', { ascending: false });
    if (error) return section(props.title || 'Hubs', errorNote(error));
    const cards = (data || []).map((h) => `<div class="cc-card">
      <div style="font-weight:600">${esc(h.icao)} ${h.is_primary ? '<span class="cc-badge">Primary</span>' : ''}</div>
      <div class="cc-sub">${esc(h.name || '')}</div>
    </div>`).join('') || `<p class="cc-sub">No hubs defined yet.</p>`;
    return section(props.title || 'Hubs', `<div class="cc-grid">${cards}</div>`, 'hubs');
  },

  async routes(props, ctx) {
    const { data, error } = await ctx.sb.from('routes')
      .select('flight_number, dep_icao, arr_icao, aircraft, distance_nm')
      .eq('active', true).limit(300);
    if (error) return section(props.title || 'Routes', errorNote(error));
    const rows = (data || []).map((r) => `<tr>
      <td>${esc(r.flight_number || '')}</td>
      <td>${esc(r.dep_icao || '')} → ${esc(r.arr_icao || '')}</td>
      <td>${esc(r.aircraft || '')}</td>
      <td>${r.distance_nm != null ? esc(r.distance_nm) + ' nm' : ''}</td>
    </tr>`).join('') || emptyRow(4, 'No routes published yet.');
    return section(props.title || 'Routes', table(
      ['Flight', 'Route', 'Aircraft', 'Distance'], rows), 'routes');
  },

  async events(props, ctx) {
    const { data, error } = await ctx.sb.from('events')
      .select('title, description, starts_at, dep_icao, arr_icao, banner_url')
      .order('starts_at', { ascending: true }).limit(50);
    if (error) return section(props.title || 'Events', errorNote(error));
    const cards = (data || []).map((e) => `<div class="cc-card">
      ${safeUrl(e.banner_url) ? `<img src="${esc(e.banner_url)}" alt="" style="width:100%;border-radius:8px;margin-bottom:.5rem" loading="lazy">` : ''}
      <div style="font-weight:600">${esc(e.title)}</div>
      <div class="cc-sub">${e.starts_at ? esc(new Date(e.starts_at).toLocaleString()) : ''}
        ${e.dep_icao ? '· ' + esc(e.dep_icao) + ' → ' + esc(e.arr_icao || '') : ''}</div>
      <div style="margin-top:.4rem">${esc(e.description || '')}</div>
    </div>`).join('') || `<p class="cc-sub">No upcoming events.</p>`;
    return section(props.title || 'Events', `<div class="cc-grid">${cards}</div>`, 'events');
  },
};

// --- small HTML utilities --------------------------------------------------
function section(title, inner, anchor) {
  return `<section class="cc-block"${anchor ? ` id="cc-${esc(anchor)}"` : ''}>
    <h2>${esc(title)}</h2>${inner}</section>`;
}
function table(headers, rows) {
  return `<div class="cc-table-wrap"><table class="cc-table"><thead><tr>${
    headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
const emptyRow = (cols, msg) => `<tr><td colspan="${cols}" class="cc-sub">${esc(msg)}</td></tr>`;
const hours = (min) => min ? (min / 60).toFixed(1) : '0.0';
function errorNote(error) {
  // A read error here almost always means the install SQL hasn't been run.
  return `<p class="cc-sub">Couldn't load this section (${esc(error.message)}).
    If this VA is new, the owner may still be running the setup SQL.</p>`;
}

// --- interactivity (auth) --------------------------------------------------
function wireAuth(ctx) {
  const el = document.getElementById('cc-auth');
  if (!el) return;
  const $ = (sel) => el.querySelector(sel);
  const msg = $('[data-cc-msg]');
  const say = (text, ok) => { if (msg) { msg.textContent = text; msg.className = 'cc-msg ' + (ok ? 'ok' : 'err'); } };
  const val = (name) => (el.querySelector(`[data-cc="${name}"]`)?.value || '').trim();

  $('[data-cc-login]')?.addEventListener('click', async () => {
    say('Signing in…', true);
    const { error } = await ctx.sb.auth.signInWithPassword({ email: val('email'), password: val('password') });
    if (error) return say(error.message);
    location.reload();
  });

  $('[data-cc-join]')?.addEventListener('click', async () => {
    say('Creating your account…', true);
    const { data: signUp, error: e1 } = await ctx.sb.auth.signUp({ email: val('email'), password: val('password') });
    if (e1) return say(e1.message);
    // Some projects require email confirmation before a session exists.
    if (!signUp.session) return say('Account created — check your email to confirm, then log in.', true);
    const token = val('invite') || null;
    const { error: e2 } = await ctx.sb.rpc('cc_join', {
      p_callsign: val('callsign') || null, p_display_name: null, p_token: token,
    });
    if (e2) return say('Signed up, but joining the roster failed: ' + e2.message);
    location.reload();
  });

  $('[data-cc-signout]')?.addEventListener('click', async () => {
    await ctx.sb.auth.signOut();
    location.reload();
  });
}

// --- boot ------------------------------------------------------------------
async function boot() {
  let conn;
  try { conn = await resolveConnection(); }
  catch (e) { return fail(e.message); }

  const sb = createClient(conn.url, conn.anonKey);

  // Version check — a friendly nudge if the VA's schema is behind the engine.
  let versionWarning = '';
  try {
    const { data: meta } = await sb.from('schema_meta').select('version').eq('id', 1).single();
    if (meta && meta.version < ENGINE_SCHEMA_VERSION) {
      versionWarning = `<div class="cc-error">This crew center's database (v${meta.version})
        is behind the engine (v${ENGINE_SCHEMA_VERSION}). The owner should run the latest setup SQL.</div>`;
    }
  } catch (_) { /* table missing → the read errors below will explain */ }

  const { data: cfg, error: cfgErr } = await sb.from('site_config').select('*').eq('id', 1).single();
  if (cfgErr || !cfg) {
    return fail('This VA hasn\'t finished setup yet (no site_config found). '
      + 'Owners: run crew-center/install/schema.sql and complete onboarding.');
  }

  applyTheme(cfg.theme || {});

  const { data: sess } = await sb.auth.getSession();
  const session = sess?.session || null;
  let pilot = null;
  if (session) {
    const { data: me } = await sb.from('pilots')
      .select('callsign, display_name, status, role').eq('user_id', session.user.id).maybeSingle();
    pilot = me || null;
  }

  const ctx = { sb, cfg, session, pilot };
  const enabled = (Array.isArray(cfg.blocks) ? cfg.blocks : []).filter((b) => b && b.enabled && blocks[b.type]);

  // Header + nav
  const nav = enabled.filter((b) => b.type !== 'hero')
    .map((b) => `<a href="#cc-${esc(b.type)}">${esc((b.props && b.props.title) || b.type)}</a>`).join('');
  const header = `<header class="cc-header">
    ${safeUrl(cfg.logo_url) ? `<img class="cc-logo" src="${esc(cfg.logo_url)}" alt="">` : ''}
    <span class="cc-va-name">${esc(cfg.va_name || 'Crew Center')}</span>
    <nav class="cc-nav">${nav}</nav>
  </header>`;

  // Render blocks (renderers may be async)
  const parts = [];
  for (const b of enabled) {
    try { parts.push(await blocks[b.type](b.props || {}, ctx)); }
    catch (e) { parts.push(section(b.type, errorNote(e))); }
  }

  root.dataset.state = 'ready';
  root.innerHTML = versionWarning + header + parts.join('') +
    `<footer class="cc-footer">Powered by Crew Center</footer>`;

  wireAuth(ctx);
}

boot();
