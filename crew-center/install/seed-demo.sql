-- ===========================================================================
-- Crew Center — DEMO seed  (Oceanic Virtual)
-- ===========================================================================
-- Populates a *test* crew center with realistic data shaped like a VA-Ads
-- record (name / callsign / logo / tagline / hubs / region — the same fields
-- vaAds.js reads), plus ranks, routes, and events so every block has content.
--
-- Run AFTER install/schema.sql, in the SQL Editor of a THROWAWAY Supabase
-- project. It seeds reference data only — pilots still come from real sign-ups
-- (the first person to sign up becomes the owner). Idempotent: safe to re-run.
--
-- ⚠️  Do NOT run this on a real VA's database — it writes demo ranks/hubs/etc.
-- ===========================================================================

-- --- Branding / site_config (VA-Ads-style fields) --------------------------
update public.site_config set
  va_name     = 'Oceanic Virtual',
  va_slug     = 'oceanic',
  logo_url    = null,                       -- point at your Supabase Storage logo
  signup_mode = 'open',
  theme = jsonb_build_object(
    'primary',    '#0b7285',
    'accent',     '#f59f00',
    'bg',         '#0d1117',
    'surface',    '#161b22',
    'text',       '#e6edf3',
    'muted',      '#8b949e',
    'radius',     '14px',
    'font',       '''Inter'', system-ui, sans-serif',
    'hero_image', null
  ),
  blocks = '[
    {"type":"hero",   "enabled":true, "props":{"tagline":"Connecting the Pacific — one leg at a time."}},
    {"type":"auth",   "enabled":true, "props":{"label":"Pilot Login"}},
    {"type":"roster", "enabled":true, "props":{"title":"Our Pilots"}},
    {"type":"ranks",  "enabled":true, "props":{"title":"Rank Structure"}},
    {"type":"hubs",   "enabled":true, "props":{"title":"Our Hubs"}},
    {"type":"routes", "enabled":true, "props":{"title":"Route Network"}},
    {"type":"events", "enabled":true, "props":{"title":"Upcoming Events"}}
  ]'::jsonb,
  updated_at = now()
where id = 1;

-- --- Ranks (standard VA ladder) --------------------------------------------
insert into public.ranks (name, min_hours, sort_order, color)
select v.name, v.min_hours, v.sort_order, v.color
from (values
  ('Cadet',                0,   10, '#94a3b8'),
  ('Second Officer',      10,   20, '#38bdf8'),
  ('First Officer',       50,   30, '#22c55e'),
  ('Senior First Officer',150,  40, '#eab308'),
  ('Captain',            300,   50, '#f59f00'),
  ('Senior Captain',     600,   60, '#f97316'),
  ('Training Captain',  1000,   70, '#ef4444')
) as v(name, min_hours, sort_order, color)
where not exists (select 1 from public.ranks r where r.name = v.name);

-- --- Hubs (Pacific network) ------------------------------------------------
insert into public.hubs (icao, name, is_primary)
select v.icao, v.name, v.is_primary
from (values
  ('NZAA', 'Auckland',      true),
  ('YSSY', 'Sydney',        false),
  ('KLAX', 'Los Angeles',   false),
  ('PHNL', 'Honolulu',      false),
  ('RJTT', 'Tokyo Haneda',  false)
) as v(icao, name, is_primary)
where not exists (select 1 from public.hubs h where h.icao = v.icao);

-- --- Routes ----------------------------------------------------------------
insert into public.routes (flight_number, dep_icao, arr_icao, aircraft, distance_nm, notes)
select v.fn, v.dep, v.arr, v.ac, v.dist, v.notes
from (values
  ('OCA1',  'NZAA', 'YSSY', 'Airbus A320',        1345, 'Trans-Tasman daily'),
  ('OCA12', 'NZAA', 'PHNL', 'Boeing 787-9',       3825, 'Pacific long-haul'),
  ('OCA20', 'PHNL', 'KLAX', 'Boeing 787-9',       2215, 'Island to mainland'),
  ('OCA44', 'YSSY', 'RJTT', 'Boeing 777-300ER',   4180, 'Sydney–Tokyo'),
  ('OCA7',  'NZAA', 'RJTT', 'Boeing 787-9',       4770, 'Ultra long-haul'),
  ('OCA31', 'KLAX', 'NZAA', 'Boeing 777-300ER',   5680, 'Flagship service')
) as v(fn, dep, arr, ac, dist, notes)
where not exists (select 1 from public.routes r where r.flight_number = v.fn);

-- --- Events ----------------------------------------------------------------
insert into public.events (title, description, dep_icao, arr_icao, starts_at)
select v.title, v.descr, v.dep, v.arr, now() + v.offs
from (values
  ('Trans-Tasman Group Flight', 'Fly OCA1 together from Auckland to Sydney. Formation on approach!', 'NZAA', 'YSSY', interval '7 days'),
  ('Honolulu Fly-In',           'All hubs converge on PHNL for our monthly fly-in.',                 null,   'PHNL', interval '18 days'),
  ('Founder''s Day Longhaul',   'Celebrate with the flagship KLAX–NZAA service.',                    'KLAX', 'NZAA', interval '30 days')
) as v(title, descr, dep, arr, offs)
where not exists (select 1 from public.events e where e.title = v.title);

-- ===========================================================================
-- Done. Your test crew center now has branding, ranks, hubs, routes & events.
-- Open it with:  crewcenter.html?url=<your-project-url>&key=<your-anon-key>
-- (or add an "oceanic" entry to directory.json to use crewcenter.html?va=oceanic)
-- The first account to sign up becomes the owner.
-- ===========================================================================
