// Crew Center onboarding wizard. Walks a VA owner through:
//   1. Connect their Supabase (URL + anon key)
//   2. Run the install SQL
//   3. Create the owner account (first pilot → owner via cc_join)
//   4. Brand + choose modules + signup mode  → save site_config
//   5. Publish (directory snippet + crew-center link)
//
// The owner decides everything in step 4. Signup starts "open"; flip it to
// "invite" later to lock joining behind a specific link.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const nav = document.getElementById('cc-steps-nav');
const body = document.getElementById('cc-wizard-body');

const STEPS = ['Connect', 'Install', 'Owner', 'Brand & Modules', 'Publish'];
const state = { sb: null, url: '', anonKey: '', slug: '', sqlText: '' };
let current = 0;

const ALL_BLOCKS = [
  { type: 'hero',   label: 'Hero banner',   on: true },
  { type: 'auth',   label: 'Pilot login',   on: true },
  { type: 'roster', label: 'Roster',        on: true },
  { type: 'ranks',  label: 'Ranks',         on: true },
  { type: 'hubs',   label: 'Hubs',          on: true },
  { type: 'routes', label: 'Routes',        on: true },
  { type: 'events', label: 'Events',        on: true },
];

function renderNav() {
  nav.innerHTML = STEPS.map((s, i) =>
    `<span class="${i === current ? 'active' : ''}">${i + 1}. ${esc(s)}</span>`).join('');
}

function go(i) { current = i; renderNav(); RENDER[current](); }

// --- Step 1: Connect -------------------------------------------------------
function stepConnect() {
  body.innerHTML = `<div class="cc-step">
    <h2>1. Connect your Supabase</h2>
    <p class="cc-sub">Create a free project at supabase.com, then copy your
      <strong>Project URL</strong> and <strong>anon public key</strong> from
      Project Settings → API. Never paste your <em>service_role</em> key.</p>
    <label>Project URL</label>
    <input id="f-url" placeholder="https://xxxx.supabase.co" value="${esc(state.url)}">
    <label>anon public key</label>
    <input id="f-key" placeholder="eyJhbGci..." value="${esc(state.anonKey)}">
    <div class="cc-msg" id="m"></div>
    <div class="cc-actions"><button class="cc-btn" id="next">Test & continue</button></div>
  </div>`;
  const m = document.getElementById('m');
  document.getElementById('next').onclick = async () => {
    state.url = document.getElementById('f-url').value.trim();
    state.anonKey = document.getElementById('f-key').value.trim();
    if (!/^https?:\/\//.test(state.url) || !state.anonKey) { m.className = 'cc-msg err'; m.textContent = 'Enter a valid URL and anon key.'; return; }
    m.className = 'cc-msg'; m.textContent = 'Connecting…';
    try {
      state.sb = createClient(state.url, state.anonKey);
      go(1);
    } catch (e) { m.className = 'cc-msg err'; m.textContent = e.message; }
  };
}

// --- Step 2: Install SQL ---------------------------------------------------
async function stepInstall() {
  if (!state.sqlText) {
    try { state.sqlText = await (await fetch('install/schema.sql')).text(); }
    catch (_) { state.sqlText = '-- Could not load schema.sql — copy it from crew-center/install/schema.sql'; }
  }
  const sqlEditor = state.url.replace(/\.supabase\.co.*$/, '') + '.supabase.co';
  body.innerHTML = `<div class="cc-step">
    <h2>2. Run the setup SQL</h2>
    <p class="cc-sub">Open your Supabase <strong>SQL Editor</strong>, paste this, and click Run.
      It creates the tables and the security policies. Safe to re-run.</p>
    <textarea class="sql" id="sql" readonly>${esc(state.sqlText)}</textarea>
    <div class="cc-actions">
      <button class="cc-btn secondary" id="copy">Copy SQL</button>
      <button class="cc-btn secondary" id="check">I've run it — check</button>
      <button class="cc-btn" id="next" disabled>Continue</button>
    </div>
    <div class="cc-msg" id="m"></div>
  </div>`;
  const m = document.getElementById('m');
  document.getElementById('copy').onclick = async () => {
    try { await navigator.clipboard.writeText(state.sqlText); m.className = 'cc-msg ok'; m.textContent = 'Copied.'; }
    catch (_) { document.getElementById('sql').select(); }
  };
  document.getElementById('check').onclick = async () => {
    m.className = 'cc-msg'; m.textContent = 'Checking…';
    const { data, error } = await state.sb.from('schema_meta').select('version').eq('id', 1).maybeSingle();
    if (error || !data) { m.className = 'cc-msg err'; m.textContent = 'Not found yet — make sure the SQL ran without errors.'; return; }
    m.className = 'cc-msg ok'; m.textContent = `Schema v${data.version} detected.`;
    document.getElementById('next').disabled = false;
  };
  document.getElementById('next').onclick = () => go(2);
}

// --- Step 3: Owner account -------------------------------------------------
function stepOwner() {
  body.innerHTML = `<div class="cc-step">
    <h2>3. Create the owner account</h2>
    <p class="cc-sub">The first account to join becomes the <strong>owner</strong> automatically.</p>
    <div class="cc-two">
      <div><label>Email</label><input id="f-email" type="email"></div>
      <div><label>Password</label><input id="f-pass" type="password"></div>
    </div>
    <label>Your callsign / display name</label>
    <input id="f-call" placeholder="e.g. OCA001">
    <div class="cc-actions"><button class="cc-btn" id="next">Create owner</button></div>
    <div class="cc-msg" id="m"></div>
  </div>`;
  const m = document.getElementById('m');
  document.getElementById('next').onclick = async () => {
    const email = document.getElementById('f-email').value.trim();
    const password = document.getElementById('f-pass').value;
    const call = document.getElementById('f-call').value.trim();
    m.className = 'cc-msg'; m.textContent = 'Creating…';
    const { data: su, error: e1 } = await state.sb.auth.signUp({ email, password });
    if (e1) { m.className = 'cc-msg err'; m.textContent = e1.message; return; }
    if (!su.session) {
      // Email confirmation is on. Try to sign in (works if confirmation is off).
      const { error: e2 } = await state.sb.auth.signInWithPassword({ email, password });
      if (e2) { m.className = 'cc-msg err'; m.textContent = 'Account made, but email confirmation is on. Confirm your email, then reload and continue.'; return; }
    }
    const { error: e3 } = await state.sb.rpc('cc_join', { p_callsign: call || null, p_display_name: call || null, p_token: null });
    if (e3) { m.className = 'cc-msg err'; m.textContent = 'Join failed: ' + e3.message; return; }
    m.className = 'cc-msg ok'; m.textContent = 'You are the owner.';
    go(3);
  };
}

// --- Step 4: Brand + modules ----------------------------------------------
function stepBrand() {
  const blockChecks = ALL_BLOCKS.map((b) =>
    `<label style="display:flex;gap:.5rem;align-items:center;color:var(--cc-text)">
       <input type="checkbox" data-block="${b.type}" ${b.on ? 'checked' : ''} style="width:auto"> ${esc(b.label)}
     </label>`).join('');
  body.innerHTML = `<div class="cc-step">
    <h2>4. Brand &amp; modules</h2>
    <div class="cc-two">
      <div><label>VA name</label><input id="b-name" placeholder="Oceanic Virtual"></div>
      <div><label>Slug (URL id)</label><input id="b-slug" placeholder="oceanic"></div>
    </div>
    <label>Tagline</label><input id="b-tag" placeholder="Fly the Pacific.">
    <label>Logo URL (optional)</label><input id="b-logo" placeholder="https://…/logo.png">
    <label>Hero image URL (optional)</label><input id="b-hero" placeholder="https://…/hero.jpg">
    <div class="cc-two">
      <div><label>Primary colour</label><input id="b-primary" type="color" value="#2563eb"></div>
      <div><label>Accent colour</label><input id="b-accent" type="color" value="#f59e0b"></div>
    </div>
    <div class="cc-two">
      <div><label>Background</label><input id="b-bg" type="color" value="#0d1117"></div>
      <div><label>Corner radius</label><input id="b-radius" value="14px"></div>
    </div>
    <label>Custom CSS (optional escape hatch — no JS)</label>
    <textarea id="b-css" class="sql" placeholder="/* your CSS */"></textarea>
    <label>Signup mode</label>
    <select id="b-signup">
      <option value="open" selected>Open — anyone can sign up (approve later)</option>
      <option value="invite">Invite only — signup needs a code/link</option>
      <option value="closed">Closed — no new signups</option>
    </select>
    <label style="margin-top:1rem">Modules to show</label>
    <div style="display:grid;gap:.4rem">${blockChecks}</div>
    <div class="cc-actions"><button class="cc-btn" id="next">Save &amp; publish</button></div>
    <div class="cc-msg" id="m"></div>
  </div>`;
  const m = document.getElementById('m');
  document.getElementById('next').onclick = async () => {
    const g = (id) => document.getElementById(id).value.trim();
    state.slug = g('b-slug').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'va';
    const blocksSel = ALL_BLOCKS.map((b) => ({
      type: b.type,
      enabled: document.querySelector(`[data-block="${b.type}"]`).checked,
      props: b.type === 'hero' ? { tagline: g('b-tag') } : {},
    }));
    const payload = {
      va_name: g('b-name'), va_slug: state.slug,
      logo_url: g('b-logo') || null,
      signup_mode: g('b-signup'),
      theme: {
        primary: g('b-primary'), accent: g('b-accent'), bg: g('b-bg'),
        radius: g('b-radius'), hero_image: g('b-hero') || null,
        custom_css: document.getElementById('b-css').value || null,
      },
      blocks: blocksSel,
      updated_at: new Date().toISOString(),
    };
    m.className = 'cc-msg'; m.textContent = 'Saving…';
    const { error } = await state.sb.from('site_config').update(payload).eq('id', 1);
    if (error) { m.className = 'cc-msg err'; m.textContent = 'Save failed (are you signed in as owner?): ' + error.message; return; }
    go(4);
  };
}

// --- Step 5: Publish -------------------------------------------------------
function stepPublish() {
  const snippet = JSON.stringify({ [state.slug]: { url: state.url, anonKey: state.anonKey } }, null, 2);
  const link = `${location.origin}${location.pathname.replace(/onboarding\.html$/, 'crewcenter.html')}?va=${encodeURIComponent(state.slug)}`;
  const preview = `${location.origin}${location.pathname.replace(/onboarding\.html$/, 'crewcenter.html')}?url=${encodeURIComponent(state.url)}&key=${encodeURIComponent(state.anonKey)}`;
  body.innerHTML = `<div class="cc-step">
    <h2>5. You're live 🎉</h2>
    <p class="cc-sub">Preview it now (works before you're in the directory):</p>
    <p><a class="cc-btn" href="${esc(preview)}" target="_blank" rel="noopener">Open my crew center</a></p>
    <p class="cc-sub">To get the clean <code>?va=${esc(state.slug)}</code> link, send us this directory entry to add to <code>directory.json</code>:</p>
    <textarea class="sql" readonly>${esc(snippet)}</textarea>
    <p class="cc-sub">Once added, your public link will be:</p>
    <input readonly value="${esc(link)}">
    <p class="cc-sub" style="margin-top:1rem">The anon key is safe to share — it's public by design and all access is
      controlled by the Row Level Security policies you installed. Never share your service_role key.</p>
  </div>`;
}

const RENDER = [stepConnect, stepInstall, stepOwner, stepBrand, stepPublish];
go(0);
