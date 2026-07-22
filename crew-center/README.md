# Crew Center

A **bring-your-own-Supabase** crew-center engine for Virtual Airlines (VAs).

Instead of hosting VA data ourselves, each VA points the engine at **their own
Supabase project**. Their pilots, logins, rosters, and PIREPs live in *their*
database — we only ship the front-end shell and a tiny public directory that
maps a VA slug to its Supabase URL + anon key.

```
Browser ──(login, roster, PIREPs, everything)──▶  <that-VA>.supabase.co
Browser ──(loads the shell once, then cached)──▶  our CDN (Netlify)
```

## Why this shape

- **Auth** is Supabase Auth — each VA gets its own user pool, so a pilot
  literally registers with that VA. Perfect tenant isolation, zero effort.
- **Data / cost / liability** live on the VA's Supabase, not ours.
- **Netlify** only ever serves static assets (cached hard). No per-request
  Functions in the hot path, so this barely touches our bandwidth. See
  [`../docs/crew-center.md`](../docs/crew-center.md) for the cost analysis.
- The login screen is **fully themeable** because Supabase Auth is headless —
  we render our own form and call `supabase.auth.signInWithPassword()`.

## Files

| Path | What it is |
| --- | --- |
| `install/schema.sql` | The one-time SQL a VA runs in their Supabase (tables + **RLS** + versioning). |
| `install/seed-demo.sql` | Optional demo data (Oceanic Virtual) for a throwaway test project. |
| `demo-data.json` | Static data behind the no-backend preview. |
| `crewcenter.html` + `engine.js` | The public crew-center engine. Boots from `?va=<slug>`. |
| `onboarding.html` + `onboarding.js` | Setup wizard for a VA owner. |
| `config.example.json` | Shape of the `site_config` row (theme + blocks). |
| `directory.json` | Public map of `slug → { url, anonKey }`. Served as static JSON. |

## Try it (no Supabase needed)

Open `crewcenter.html?demo=1` to see a fully rendered test crew center
("Oceanic Virtual") driven by `demo-data.json` — theme, roster, ranks, hubs,
routes, and events, with accounts disabled. To make it *real*, spin up a
throwaway Supabase, run `install/schema.sql` then `install/seed-demo.sql`, and
open `crewcenter.html?url=<project-url>&key=<anon-key>`.

## Security note

`install/schema.sql` ships **Row Level Security** policies to non-experts. The
Supabase anon key is public by design — *all* security rests on RLS. This pack
uses defense-in-depth (RLS + `SECURITY DEFINER` guard triggers + a single
`cc_join` RPC) so a misconfigured client can't escalate. **Run
`/security-review` on this pack before any VA relies on it in production, and
never enter the `service_role` key into the crew center.**

## Status

Foundation scaffold. See [`../docs/crew-center.md`](../docs/crew-center.md) for
the locked design decisions and the phased build order.
