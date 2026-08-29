// Crew Center engine — boots from a VA's OWN Supabase and renders their site.
//
// URL forms:
//   crewcenter.html?va=<slug>     → look the slug up in directory.json
//   crewcenter.html?url=..&key=.. → direct connection (onboarding preview)
//   crewcenter.html?demo=1        → no-backend static preview (demo-data.json)
//
// Everything data-related goes browser → the VA's Supabase. Nothing here calls
// our own backend, so it never touches Netlify Functions. See docs/crew-center.md.
//
// supabase-js is imported lazily (only for a real backend) so demo mode has no
// external dependency. Follow-up: vendor a pinned copy (see docs §11).
const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const ENGINE_SCHEMA_VERSION = 1;
const root = document.getElementById('cc-root');

// --- tiny helpers ----------------------------------------------------------
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const safeUrl = (u) => /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '';
const hours = (min) => (min ? (min / 60) : 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const initials = (name, call) => {
  const src = (name || call || '?').trim();
  const parts = src.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : src.slice(0, 2)).toUpperCase();
};
function fail(msg) {
  root.dataset.state = 'error';
  root.innerHTML = `<div class="cc-error">${esc(msg)}</div>`;
}

// --- resolve the VA connection ---------------------------------------------
async function resolveConnection() {
  const q = new URLSearchParams(location.search);
  const directUrl = q.get('url'), directKey = q.get('key');
  if (directUrl && directKey) return { url: directUrl, anonKey: directKey };
  const slug = q.get('va');
  if (!slug) throw new Error('No VA specified. Use ?va=<slug> or ?demo=1.');
  const res = await fetch('directory.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('Could not load the VA directory.');
  const dir = await res.json();
  const entry = dir && dir.vas && dir.vas[slug];
  if (!entry) throw new Error(`Unknown VA "${slug}".`);
  return entry;
}

// --- demo mode: mock the slice of supabase-js the renderers use ------------
function makeDemoClient(d) {
  const build = (table) => {
    let wantSingle = false;
    const b = {
      select() { return b; }, eq() { return b; }, order() { return b; }, limit() { return b; },
      single() { wantSingle = true; return b; }, maybeSingle() { wantSingle = true; return b; },
      then(resolve) {
        const v = d[table];
        const data = wantSingle
          ? (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))
          : (Array.isArray(v) ? v : (v == null ? [] : [v]));
        resolve({ data, error: null });
      },
    };
    return b;
  };
  const disabled = { error: { message: 'Demo preview — accounts are disabled here.' } };
  return {
    from: (t) => build(t),
    auth: {
      getSession: async () => ({ data: { session: null } }),
      signInWithPassword: async () => disabled,
      signUp: async () => ({ data: {}, ...disabled }),
      signOut: async () => ({}),
    },
    rpc: async () => disabled,
  };
}

// --- theme -----------------------------------------------------------------
function applyTheme(theme = {}) {
  const r = document.documentElement.style;
  const map = { primary: '--cc-primary', accent: '--cc-accent', bg: '--cc-bg',
    surface: '--cc-surface', text: '--cc-text', muted: '--cc-muted', font: '--cc-font', radius: '--cc-radius' };
  for (const [k, v] of Object.entries(map)) if (theme[k]) r.setProperty(v, String(theme[k]));
  if (theme.custom_css) { // CSS-only escape hatch — never JS (see phishing guardrail).
    const s = document.createElement('style'); s.textContent = String(theme.custom_css); document.head.appendChild(s);
  }
}

// --- HTML utilities --------------------------------------------------------
function section(eyebrow, title, inner, anchor) {
  return `<section class="cc-block"${anchor ? ` id="cc-${esc(anchor)}"` : ''}>
    <div class="cc-block-head">
      ${eyebrow ? `<div class="cc-eyebrow">${esc(eyebrow)}</div>` : ''}
      <h2>${esc(title)}</h2>
    </div>${inner}</section>`;
}
const errorNote = (e) => `<p class="cc-sub" style="color:var(--cc-muted)">Couldn't load this section (${esc(e.message)}).
  If this VA is new, the owner may still be running the setup SQL.</p>`;

// --- block renderers -------------------------------------------------------
const blocks = {
  hero(props, ctx) {
    const s = ctx.stats || {};
    const bg = safeUrl((ctx.cfg.theme || {}).hero_image);
    const style = bg ? ` style="background-image:linear-gradient(rgba(6,9,14,.55),rgba(6,9,14,.85)),url('${esc(bg)}')"` : '';
    const chips = [[s.pilots, 'pilots'], [s.routes, 'routes'], [s.hubs, 'hubs']]
      .filter(([n]) => n).map(([n, l]) => `<span class="cc-hero-chip">${esc(n)} ${esc(l)}</span>`).join('');
    const cta = ctx.hasAuth ? `<a class="cc-btn cc-hero-cta" href="#cc-auth">Join the crew</a>` : '';
    return `<div class="cc-hero"${style}><div class="cc-hero-inner">
      <div class="cc-eyebrow">Virtual Airline</div>
      <h1>${esc(ctx.cfg.va_name || 'Crew Center')}</h1>
      <p>${esc(props.tagline || '')}</p>
      ${chips ? `<div class="cc-hero-meta">${chips}</div>` : ''}
      ${cta}
    </div></div>`;
  },

  auth(props, ctx) {
    if (ctx.pilot) {
      return section('Pilot Area', props.label || 'Your Flight Deck', `
        <div class="cc-auth"><div class="cc-auth-card" id="cc-auth-box">
          <p style="margin-top:0">Signed in as <strong>${esc(ctx.pilot.display_name || ctx.session.user.email)}</strong>
             — <span class="cc-badge">${esc(ctx.pilot.status)}</span></p>
          <button class="cc-btn secondary" data-cc-signout>Sign out</button>
        </div></div>`, 'auth');
    }
    return section('Members', props.label || 'Pilot Login', `
      <div class="cc-auth"><div class="cc-auth-card" id="cc-auth-box">
        <input type="email" data-cc="email" placeholder="Email" autocomplete="email">
        <input type="password" data-cc="password" placeholder="Password" autocomplete="current-password">
        <div class="cc-row" style="margin-top:.4rem">
          <button class="cc-btn" data-cc-login>Log in</button>
          <button class="cc-btn secondary" data-cc-join>Sign up</button>
        </div>
        <input type="text" data-cc="callsign" placeholder="Callsign (sign-up only)" style="margin-top:.5rem">
        <input type="text" data-cc="invite" placeholder="Invite code (if required)">
        <div class="cc-msg" data-cc-msg></div>
      </div></div>`, 'auth');
  },

  async roster(props, ctx) {
    const { data, error } = await ctx.sb.from('pilots')
      .select('callsign, display_name, status, total_minutes, ranks(name,color), hubs(icao)')
      .eq('status', 'active').order('total_minutes', { ascending: false }).limit(200);
    if (error) return section('Crew', props.title || 'Roster', errorNote(error), 'roster');
    const rows = (data || []).map((p) => {
      const c = p.ranks?.color;
      return `<tr>
        <td><div class="cc-pilot">
          <div class="cc-avatar">${esc(initials(p.display_name, p.callsign))}</div>
          <div><div class="cc-pname">${esc(p.display_name || '—')}</div>
               <div class="cc-pcall">${esc(p.callsign || '')}</div></div>
        </div></td>
        <td>${p.ranks?.name ? `<span class="cc-pill"${c ? ` style="--rank:${esc(c)}"` : ''}>${esc(p.ranks.name)}</span>` : ''}</td>
        <td>${p.hubs?.icao ? `<span class="cc-chip-mono">${esc(p.hubs.icao)}</span>` : ''}</td>
        <td class="cc-num">${hours(p.total_minutes)}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="4" class="cc-sub" style="color:var(--cc-muted)">No active pilots yet.</td></tr>`;
    return section('Crew', props.title || 'Roster', `<div class="cc-table-wrap"><table class="cc-table">
      <thead><tr><th>Pilot</th><th>Rank</th><th>Hub</th><th class="cc-num">Hours</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`, 'roster');
  },

  async ranks(props, ctx) {
    const { data, error } = await ctx.sb.from('ranks').select('name, min_hours, color').order('sort_order');
    if (error) return section('Progression', props.title || 'Ranks', errorNote(error), 'ranks');
    const cards = (data || []).map((r) => `<div class="cc-card cc-rank" style="--rank:${r.color ? esc(r.color) : 'var(--cc-accent)'}">
      <div class="cc-card-title">${esc(r.name)}</div>
      <div class="cc-sub"><span class="num">${esc(Number(r.min_hours).toLocaleString())}</span>+ hours</div>
    </div>`).join('') || `<p class="cc-sub" style="color:var(--cc-muted)">No ranks defined yet.</p>`;
    return section('Progression', props.title || 'Ranks', `<div class="cc-grid">${cards}</div>`, 'ranks');
  },

  async hubs(props, ctx) {
    const { data, error } = await ctx.sb.from('hubs').select('icao, name, is_primary').order('is_primary', { ascending: false });
    if (error) return section('Network', props.title || 'Hubs', errorNote(error), 'hubs');
    const cards = (data || []).map((h) => `<div class="cc-card">
      <div class="cc-row" style="justify-content:space-between">
        <span class="cc-hub-icao">${esc(h.icao)}</span>
        ${h.is_primary ? '<span class="cc-badge">Primary</span>' : ''}
      </div>
      <div class="cc-sub" style="margin-top:.35rem">${esc(h.name || '')}</div>
    </div>`).join('') || `<p class="cc-sub" style="color:var(--cc-muted)">No hubs defined yet.</p>`;
    return section('Network', props.title || 'Hubs', `<div class="cc-grid">${cards}</div>`, 'hubs');
  },

  async routes(props, ctx) {
    const { data, error } = await ctx.sb.from('routes')
      .select('flight_number, dep_icao, arr_icao, aircraft, distance_nm').eq('active', true).limit(300);
    if (error) return section('Schedule', props.title || 'Routes', errorNote(error), 'routes');
    const rows = (data || []).map((r) => `<tr>
      <td><span class="cc-chip-mono">${esc(r.flight_number || '')}</span></td>
      <td><strong>${esc(r.dep_icao || '')}</strong> <span style="color:var(--cc-muted)">→</span> <strong>${esc(r.arr_icao || '')}</strong></td>
      <td>${esc(r.aircraft || '')}</td>
      <td class="cc-num">${r.distance_nm != null ? esc(Number(r.distance_nm).toLocaleString()) + ' nm' : ''}</td>
    </tr>`).join('') || `<tr><td colspan="4" class="cc-sub" style="color:var(--cc-muted)">No routes published yet.</td></tr>`;
    return section('Schedule', props.title || 'Routes', `<div class="cc-table-wrap"><table class="cc-table">
      <thead><tr><th>Flight</th><th>Route</th><th>Aircraft</th><th class="cc-num">Distance</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`, 'routes');
  },

  async events(props, ctx) {
    const { data, error } = await ctx.sb.from('events')
      .select('title, description, starts_at, dep_icao, arr_icao, banner_url').order('starts_at', { ascending: true }).limit(50);
    if (error) return section('Fly with us', props.title || 'Events', errorNote(error), 'events');
    const cards = (data || []).map((e) => {
      const dt = e.starts_at ? new Date(e.starts_at) : null;
      const date = dt ? `<div class="cc-datebox"><div class="d">${dt.getDate()}</div>
        <div class="m">${dt.toLocaleString(undefined, { month: 'short' })}</div></div>` : '';
      const leg = e.dep_icao ? `${esc(e.dep_icao)} → ${esc(e.arr_icao || '')}` : (e.arr_icao ? 'Fly-in · ' + esc(e.arr_icao) : '');
      return `<div class="cc-card"><div class="cc-event">${date}<div>
        <div class="cc-card-title">${esc(e.title)}</div>
        <div class="cc-sub" style="margin:.15rem 0 .4rem">${dt ? esc(dt.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })) : ''}${leg ? ' · ' + leg : ''}</div>
        <div>${esc(e.description || '')}</div>
      </div></div></div>`;
    }).join('') || `<p class="cc-sub" style="color:var(--cc-muted)">No upcoming events.</p>`;
    return section('Fly with us', props.title || 'Events', `<div class="cc-grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">${cards}</div>`, 'events');
  },
};

// --- stats band (auto, from the same data the blocks show) -----------------
function statsBand(stats) {
  const tiles = [
    [stats.pilots, 'Active Pilots'],
    [stats.hours, 'Hours Flown'],
    [stats.routes, 'Routes'],
    [stats.hubs, 'Hubs'],
  ];
  return `<div class="cc-stats"><div class="cc-stats-grid">${
    tiles.map(([n, l]) => `<div class="cc-stat"><div class="num">${esc(Number(n || 0).toLocaleString())}</div><div class="lbl">${esc(l)}</div></div>`).join('')
  }</div></div>`;
}

async function loadStats(sb) {
  try {
    const [p, r, h] = await Promise.all([
      sb.from('pilots').select('total_minutes, status').eq('status', 'active'),
      sb.from('routes').select('id').eq('active', true),
      sb.from('hubs').select('id'),
    ]);
    const pilots = (p.data || []);
    return {
      pilots: pilots.length,
      hours: Math.round(pilots.reduce((a, x) => a + (x.total_minutes || 0), 0) / 60),
      routes: (r.data || []).length,
      hubs: (h.data || []).length,
    };
  } catch (_) { return { pilots: 0, hours: 0, routes: 0, hubs: 0 }; }
}

// --- interactivity (auth) --------------------------------------------------
function wireAuth(ctx) {
  const el = document.getElementById('cc-auth-box');
  if (!el) return;
  const $ = (s) => el.querySelector(s);
  const msg = $('[data-cc-msg]');
  const say = (t, ok) => { if (msg) { msg.textContent = t; msg.className = 'cc-msg ' + (ok ? 'ok' : 'err'); } };
  const val = (n) => (el.querySelector(`[data-cc="${n}"]`)?.value || '').trim();

  $('[data-cc-login]')?.addEventListener('click', async () => {
    say('Signing in…', true);
    const { error } = await ctx.sb.auth.signInWithPassword({ email: val('email'), password: val('password') });
    if (error) return say(error.message);
    location.reload();
  });
  $('[data-cc-join]')?.addEventListener('click', async () => {
    say('Creating your account…', true);
    const { data: su, error: e1 } = await ctx.sb.auth.signUp({ email: val('email'), password: val('password') });
    if (e1) return say(e1.message);
    if (!su.session) return say('Account created — check your email to confirm, then log in.', true);
    const { error: e2 } = await ctx.sb.rpc('cc_join', { p_callsign: val('callsign') || null, p_display_name: null, p_token: val('invite') || null });
    if (e2) return say('Signed up, but joining failed: ' + e2.message);
    location.reload();
  });
  $('[data-cc-signout]')?.addEventListener('click', async () => { await ctx.sb.auth.signOut(); location.reload(); });
}

// --- boot ------------------------------------------------------------------
async function boot() {
  const q = new URLSearchParams(location.search);
  const demo = q.get('demo') === '1' || q.get('va') === 'demo';

  let sb;
  if (demo) {
    try { sb = makeDemoClient(await (await fetch('demo-data.json', { cache: 'no-cache' })).json()); }
    catch (e) { return fail('Could not load demo data.'); }
  } else {
    let conn;
    try { conn = await resolveConnection(); } catch (e) { return fail(e.message); }
    const { createClient } = await import(SUPABASE_ESM);
    sb = createClient(conn.url, conn.anonKey);
  }

  let versionWarning = '';
  try {
    const { data: meta } = await sb.from('schema_meta').select('version').eq('id', 1).single();
    if (meta && meta.version < ENGINE_SCHEMA_VERSION) {
      versionWarning = `<div class="cc-error">This crew center's database (v${meta.version}) is behind the engine (v${ENGINE_SCHEMA_VERSION}). The owner should run the latest setup SQL.</div>`;
    }
  } catch (_) { /* table missing → cfg read below explains */ }

  const { data: cfg, error: cfgErr } = await sb.from('site_config').select('*').eq('id', 1).single();
  if (cfgErr || !cfg) {
    return fail("This VA hasn't finished setup yet (no site_config found). Owners: run crew-center/install/schema.sql and complete onboarding.");
  }
  applyTheme(cfg.theme || {});

  const { data: sess } = await sb.auth.getSession();
  const session = sess?.session || null;
  let pilot = null;
  if (session) {
    const { data: me } = await sb.from('pilots').select('callsign, display_name, status, role').eq('user_id', session.user.id).maybeSingle();
    pilot = me || null;
  }

  const enabled = (Array.isArray(cfg.blocks) ? cfg.blocks : []).filter((b) => b && b.enabled && blocks[b.type]);
  const hasAuth = enabled.some((b) => b.type === 'auth');
  const stats = await loadStats(sb);
  const ctx = { sb, cfg, session, pilot, stats, hasAuth };

  // Header
  const nav = enabled.filter((b) => b.type !== 'hero')
    .map((b) => `<a href="#cc-${esc(b.type)}">${esc((b.props && (b.props.title || b.props.label)) || b.type)}</a>`).join('');
  const header = `<header class="cc-header">
    <span class="cc-brand">
      ${safeUrl(cfg.logo_url) ? `<img class="cc-logo" src="${esc(cfg.logo_url)}" alt="">` : ''}
      <span class="cc-va-name">${esc(cfg.va_name || 'Crew Center')}</span>
    </span>
    <nav class="cc-nav">${nav}</nav>
  </header>`;

  // Hero first, then the stats band, then the rest — in configured order.
  const heroBlock = enabled.find((b) => b.type === 'hero');
  const rest = enabled.filter((b) => b.type !== 'hero');
  const parts = [];
  if (heroBlock) { try { parts.push(blocks.hero(heroBlock.props || {}, ctx)); } catch (_) {} }
  parts.push(statsBand(stats));
  for (const b of rest) {
    try { parts.push(await blocks[b.type](b.props || {}, ctx)); }
    catch (e) { parts.push(section('', b.type, errorNote(e))); }
  }

  const demoBanner = demo
    ? `<div style="background:var(--cc-accent);color:#04070c;text-align:center;padding:.5rem;font-size:.85rem;font-weight:700">Demo preview — static data, accounts disabled. This is what a seeded crew center looks like.</div>`
    : '';

  root.dataset.state = 'ready';
  root.innerHTML = demoBanner + versionWarning + header + parts.join('') +
    `<footer class="cc-footer">Powered by Crew Center</footer>`;

  wireAuth(ctx);
}

boot();
