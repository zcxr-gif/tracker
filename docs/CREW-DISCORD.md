# Signing in with Discord

A virtual airline already runs on Discord. Recruitment happens there, the NOTAMs
are posted there, and a pilot who has never opened the crew center still knows
exactly which account is theirs.

What the crew center gives them instead is a username they did not choose and a
password somebody generated and handed over in a DM. That is why
`must_change_password` exists, and it is why the single most common support
message a VA gets is a pilot who has lost it.

So there is a second key.

## The one thing it is not

It is a **second key to an existing door**. A pilot signs in once with the
password they were given, links Discord from their own page, and from then on
the button signs them in.

It is **not a way to get an account**. Nothing in the flow creates, claims or
promotes anything: the callback looks up an account that is *already* linked to
that Discord id and signs it in, or it signs nobody in. There is no fallback to
matching on a name, an email or anything else.

That is worth being exact about, because the tempting version — *anybody in the
VA's Discord server can sign in* — hands the roster to whoever can join a
server, and a server invite is a link that gets pasted in public. A VA's roster
is the VA's, and a login button does not get to add to it.

`scripts/test-crew-discord-routes.js` asserts it directly: a sign-in for an
unlinked Discord account leaves the account table byte-for-byte unchanged.

## One application, not one per VA

Every VA would otherwise have to register a Discord application, hold a client
secret and keep a redirect URI in step with us. Most would not; the ones who did
would eventually paste the secret into a support thread; and one who rotated it
would break their own pilots' logins with no way to find out why.

So there is one Inflight application, the redirect comes back to **us**, and the
signed `state` says which crew center the pilot was standing in.

The only scope requested is `identify` — not `email`, which we have no use for,
and not `guilds`, which would read every server a pilot is in to answer a
question nobody is asking. The consent screen a pilot sees is the shortest one
Discord can draw, and every extra line on it is a reason to press Cancel.

## The flow

```
GET  /api/crew/<slug>/auth/discord          leave for Discord, to sign in
POST /api/crew/<slug>/auth/discord/link     leave for Discord, to link (authenticated)
GET  /api/crew/auth/discord/callback        Discord returns here, to the API
POST /api/crew/<slug>/auth/discord/exchange the crew center swaps a handoff for a session
DEL  /api/crew/<slug>/account/discord       unlink
```

### Why there are two ways to leave

A **sign-in** needs nothing authenticated: it can only ever find an account that
is already linked, so starting one proves nothing and costs nothing. It is a
plain redirect, and the button is an ordinary navigation.

A **link** has to know *which* account is linking, and the only trustworthy
answer is the caller's own session — which lives in an `Authorization` header,
which a browser cannot attach to a navigation. The obvious workaround is to let
the token ride in the query string instead, and it is the wrong one: it writes a
week-long credential into browser history, into a `Referer`, and into every log
between here and Discord. So the page **POSTs**, gets back a URL carrying only a
signed state, and navigates to that.

The account id is sealed into the state at that moment and is never read from
anything the browser hands back afterwards. That is what stops a link round trip
being aimed at somebody else's account.

### Why there is a handoff

The callback lands on the API, and the session it has just established belongs
to a page on another origin. The crew center has never used a cookie — that is
why its CORS is as simple as it is — so the session has to cross the redirect,
and a bearer token good for a week has no business being in a URL.

What crosses instead is a **handoff**: good for ninety seconds, spendable at
exactly one endpoint, and worth nothing to look at. It rides in the URL
**fragment**, which is never sent to a server — so it is in no access log of
ours, none of the crew center's, and none of any proxy in between.

Spending it re-reads the account rather than trusting the token beyond the id.
The ninety seconds between the callback and the exchange are ninety seconds in
which staff could have switched the account off, and the session it produces has
to be the one the password door would have produced at that instant.

### The two intents are not interchangeable

A link flow returns a Discord identity about to be **attached** to a signed-in
account. A login flow returns one about to be **trusted as** an account. A
callback that could not tell them apart would let a link round trip be replayed
as a sign-in, so the intent is sealed into the state and every token in the flow
is typed: a state cannot be spent as a handoff, a handoff cannot be spent as a
state, and neither can be a session.

## What a pilot is told

The backend never distinguishes *never linked*, *wrong airline* and *account
switched off*. All three come back as `not_linked` with the same sentence —
telling them apart would let somebody map a VA's roster by trying Discord
accounts.

| Reason | What the page says |
|---|---|
| `not_linked` | Sign in with your password once, then link it from your account page |
| `link_taken` | Already linked to another pilot at this airline |
| `link_denied` | Sign in first, then link from your account page |
| `needs_update` | The database needs the v16 SQL re-run |
| `unavailable` | Not switched on for this deployment |
| `cancelled` | *nothing* — they pressed Cancel, they know |
| `failed` | Try again, or use your password |

## Where it is stored

Four columns on `crew_accounts`, in the VA's **own** project like every other
thing about their pilots — Inflight holds no pilot credentials for any VA:

```sql
discord_id        text not null default ''
discord_username  text not null default ''
discord_avatar    text not null default ''
discord_linked_at timestamptz
```

`discord_id` is the identity. Everything else is a label Discord lets people
change whenever they like, so it is stored to be **shown** and never to be
matched on.

The unique index is partial —

```sql
create unique index crew_accounts_discord_idx
    on crew_accounts (va_slug, discord_id) where discord_id <> '';
```

— because every account that has not linked holds `''`, and a plain unique index
would make the second unlinked account in a VA a constraint violation. It is
scoped per `va_slug` because one person genuinely may fly for two airlines with
the same Discord account; what must not happen is one Discord identity opening
two different pilots' logins inside **one** airline.

## Where a pilot links it

The **Signing in** card near the foot of `crew-pilot.html`, which is where a
pilot manages their own access. It is drawn only when `/me` says both halves are
true: that this deployment offers Discord at all, and that this login is one
that can hold a link.

**A known gap.** A VA owner or staff member whose account lives in the crew
store signs in to `crew-dashboard.html` instead, and that page has never had any
self-service account controls — there is no password change on it either. Their
login *can* hold a link and the backend will accept it; they just have no button
for it unless they open the pilot page. Giving the dashboard an account area is
its own piece of work and this feature did not invent one.

## An older database

The columns are `LATE_COLUMNS` in `crewStore.js`, so a VA who has not re-run the
SQL carries on exactly as before — every pilot has a password, and that is the
door Discord is a second key to. Linking tells them the database needs updating;
nothing else changes, and nothing breaks.

## Switching it off

Leave `DISCORD_CLIENT_SECRET` empty and the feature is off, completely and
silently: the sign-in page never draws the button, the pilot page never draws
the card, and nobody is ever sent to Discord only to be told on the way back
that this deployment was never set up. `GET /api/va-ads/by-slug/<slug>` carries
`discordLogin: true|false` so the sign-in page knows before it has a session.

See `.env.example` in the backend repo for the four settings.

## One pilot, two airlines

Somebody genuinely may fly for two VAs with the same Discord account. Pressing
the button in one crew center signs them into **that** one, as the account that
airline knows them by.

It works because of where the question is asked. Each airline keeps its pilots
in its **own** database, so "which account is this Discord id" is only ever
asked inside one of them — and which one is decided by the crew center the
button was pressed in, sealed into the signed state before the pilot ever left.
Nothing in the flow can cross from one airline to the other:

* the return address is built from the **canonical slug in the state**, so a
  pilot who arrived at `/crew/BAW` by callsign still lands on `/crew/ba`;
* a handoff issued at one airline is refused at another;
* an airline they have **not** linked at says so, and does not quietly send them
  to the one they have.

`scripts/test-crew-discord-routes.js` runs two airlines with two rosters and the
same Discord account across both. Making the callback read the wrong airline's
roster fails four of its checks; making the return address ignore the sealed
slug fails two more.

## Inside the app's overlay

The crew center is also framed inside the app, with `?embed=1`. That flag is
sealed into the state as a **boolean** and handed back on the return, so a pilot
who signs in there comes back into the overlay rather than being answered with
the standalone page in its frame.

It is the one thing about the round trip the page gets a say in, and it can only
change how the destination *dresses itself* — never where that destination is.

## Setting it up

1. **Discord developer portal** → your existing application (the one
   `DISCORD_CLIENT_ID` already names) → **OAuth2**.
   - Copy the **client secret** into `DISCORD_CLIENT_SECRET`.
   - Add this redirect to the allow-list, and set the same string as
     `DISCORD_OAUTH_REDIRECT_URI`:
     `https://<this-api-host>/api/crew/auth/discord/callback`
   - No scopes need ticking there; the flow asks for `identify` per request.

   **It must point at the API host, not at the public site.** They are
   different hosts and the site does not proxy `/api`. An address built from
   `PUBLIC_BASE_URL` resolves to the site's catch-all: Discord sends the pilot
   to a page that is not this route, nothing errors, and the sign-in never
   completes.

2. **`CREW_PUBLIC_BASE_URL`** — the origin the crew center is served from, no
   trailing slash. A pilot lands on `<base>/crew/<slug>` afterwards.

3. **Re-run the setup SQL** on each VA's project (Crew Center → Settings → Data
   store → the update button). That is schema **v16**, which adds the four
   `crew_accounts` columns. Until a VA does this their pilots carry on signing
   in with passwords and linking says the database needs updating.

4. **Restart the backend** so the new environment reaches it.

5. **Check the door is open.** `GET /api/va-ads/by-slug/<slug>` should report
   `discordLogin: true`, and the button should appear on that VA's sign-in page.
   If the flag is true but pressing it lands you somewhere odd, the redirect in
   step 1 is pointing at the wrong host.

6. **Walk one pilot through it.** Sign in with a password → **Signing in** card
   at the foot of the pilot page → *Link Discord* → approve → it says linked.
   Sign out, press **Continue with Discord**, and you should land back on that
   airline's crew center, signed in.

### Telling your VAs

What a pilot needs to know is one sentence: *sign in with your password once,
open your pilot page, and link Discord — after that the button works.* The
button is visible before they link, and pressing it tells them exactly that, so
nobody is stuck.

Staff should know two things: a pilot who loses their Discord account still has
their password, and unlinking (theirs, from the same card) never removes it.

## Files

| | |
|---|---|
| `crewDiscord.js` (backend) | the rules, and the two calls that touch Discord |
| `crewAuth.js` (backend) | the five routes |
| `crew.html` | the button, and landing from a sign-in |
| `crew-pilot.html` | the *Signing in* card: link and unlink |
| `docs/CREW-DISCORD.md` | this |

## Tests

```
node scripts/test-crew-discord.js          # 42 checks — the rules
node scripts/test-crew-discord-routes.js   # 40 checks — the routes, end to end
```

Both live in the backend repo. The first covers what a state says, what a
handoff is worth, and that a profile with no usable id is refused outright. The
second drives the real Express routes with Discord stubbed and holds the
properties above: that a sign-in creates nothing, that a link cannot be spent as
a sign-in, that one Discord account opens one login per crew center, and that no
session ever travels in a query string.
