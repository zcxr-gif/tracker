# Crew Center — Design & Decisions

Status: **foundation locked**. This doc records the decisions we agreed on so
every later change starts from a concrete position. Veto anything here in a PR
comment rather than in your head.

## 1. Architecture: bring-your-own-Supabase

We build a crew-center **engine**, not a host. Each VA points the engine at
*their own* Supabase project (URL + anon key). Their pilots, auth, rosters, and
PIREPs live in their database. We store almost nothing.

- **Auth** → Supabase Auth. Each VA has its own user pool; a pilot registers
  with that VA. Tenant isolation is free.
- **Storage / cost / liability / GDPR** → the VA's Supabase, on their bill.
- **Netlify** → serves only the static shell, cached hard (CDN + browser +
  `sw.js`). No Functions in the request path. Cost to us stays ~flat.

### Cost analysis (why this doesn't eat Netlify credit)

Netlify bills bandwidth, build minutes, and Function invocations. In this model
the heavy traffic (login, every query, every PIREP write) goes **browser →
VA's Supabase**, never through us. We serve a ~200 KB gzipped shell that is
cached three ways; repeat visits cost ~nothing. For scale: the tracker already
serves `flight.js` (1.1 MB), `runways.json` (26 MB), `airports.json` (12 MB) —
the crew-center shell is a rounding error. **The only thing that would eat
credit is proxying Supabase through a Netlify Function — so we never do that.**
The directory is static JSON on the CDN; VA logos live in the VA's Supabase
Storage (served from Supabase's CDN, their bill).

## 2. The schema contract

For the engine to render "a roster" the VA's Supabase must have the tables the
engine expects. The install pack (`crew-center/install/schema.sql`) is the
foundation of the whole product: tables + RLS + a `schema_meta.version`. A VA
runs it once in their SQL editor.

## 3. Security model

The anon key is public by design; **all** security is RLS. Defense-in-depth:

- **RLS** on every table (public read where intended, staff-only writes).
- **`SECURITY DEFINER` guard triggers** clamp privileged columns (`role`,
  `status`, `total_minutes`, pirep `status`) so a client can't escalate even if
  a policy is loose.
- **`cc_join()` RPC** is the *only* way to become a pilot — direct inserts into
  `pilots` are denied. This centralizes signup gating and keeps invite tokens
  private.

Run `/security-review` on the pack before production. Never enter the
`service_role` key anywhere in the crew center.

## 4. Roles & permissions

Per-pilot `role`: `owner` / `staff` / `pilot`, enforced by RLS + `cc_role()`.
The **first** pilot to join a fresh DB becomes `owner` + `active`
automatically (bootstrap). Everyone else is `pilot` + `pending` until staff
activate them.

## 5. Signup modes (the "lock it later" mechanism)

`site_config.signup_mode`:

- **`open`** (default now) — anyone can sign up; lands as `pending`.
- **`invite`** — signup requires a token from `invite_tokens`; you hand out a
  specific link. This is the "we'll lock it later" state — the mechanism ships
  now, the default is open.
- **`closed`** — no new signups.

The setting-up owner chooses the mode in onboarding.

## 6. Discovery & URL scheme

`yourdomain/crew-center/crewcenter.html?va=<slug>` (pretty `/va/<slug>` routing
via Netlify `_redirects` is a follow-up). The engine looks the slug up in
`directory.json` (`slug → { url, anonKey }`), a static CDN file. For v1 the
directory is **curated/approved by us** to prevent impersonation/squatting
(someone claiming "United"); self-serve registration is a later phase.

## 7. Customization ceiling ("look totally different")

Bounded, not a freeform canvas:

- **Theme tokens** — brand colors, accent, background, font, radius, logo,
  hero — as CSS variables from `site_config.theme`.
- **Block layout** — a fixed catalog of blocks the owner toggles/reorders in
  `site_config.blocks`.
- **Custom login** — fully themeable (Supabase Auth is headless).
- **Custom CSS** — allowed as an escape hatch. **Custom JS is not** — see the
  phishing note.
- **No** arbitrary drag-anywhere builder.

### Phishing guardrail

A custom login on *our* domain is a credential-harvesting surface wearing our
reputation. So: theme freely, custom CSS yes, **custom JS no**, and auth always
routes through our controlled `supabase.auth` call. The engine never posts
credentials anywhere but the VA's Supabase.

## 8. v1 module list (scope boundary)

In: `roster · ranks · hubs · routes/schedule · logbook/PIREPs · events ·
staff admin`. Later: `leaderboards · news · custom pages · alliances ·
custom domains · auto-PIREP from the live feed`.

## 9. Auto-PIREP (v2, differentiator)

We already do roster ↔ live-socket username matching (`vaAds.js` `normUsername`).
A pilot flying their VA callsign live can have a PIREP auto-written into their
VA's Supabase, client-side, only when the live feed confirms the callsign.
Trust = live feed as source of truth + RLS. Sketched now, built after the
foundation is validated.

## 10. Migration/versioning

Independently-hosted DBs drift. Each release bumps `schema_meta.version`; the
engine compares it to the version it needs and shows a "your DB is vN, run this
migration" health check. Cheap now, expensive to bolt on later.

## 11. supabase-js delivery

No build step in this repo. For the scaffold the engine imports `supabase-js`
v2 as an ESM module from a CDN. **Follow-up: vendor a pinned bundled copy** to
match the repo's "vendor everything" pattern (see local `leaflet.js`) and to
survive a strict CSP.

## Phased build order

1. **Foundation (this PR):** schema + RLS pack, `site_config` shape, engine
   skeleton (boot + theme + read-only blocks + auth/join), onboarding wizard.
2. Staff admin (approve pilots, edit ranks/hubs/routes/events, manage invites).
3. Manual PIREP filing + approval flow + hours rollup.
4. Pretty routing, health-check screen, vendored supabase-js.
5. Auto-PIREP from the live feed.
6. Self-serve directory registration, leaderboards, custom pages, custom domains.
