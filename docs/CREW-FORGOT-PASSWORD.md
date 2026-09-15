# Forgotten passwords

A pilot who forgot their password had exactly one route back: message the
airline. A staff member then opened the dashboard, found them, issued a
temporary password, copied the message and sent it — usually not that day, and
usually not the staff member who was asked. It is the commonest piece of admin
a virtual airline does and the slowest thing that ever happens to one of its
pilots.

## Why it is not just an email

Because for most VAs an email reset would do nothing at all.

Email in the crew center is **bring-your-own-provider and off by default**, and
a pilot only has an address on file if they gave one. "A reset link has been
sent to your email" that silently reaches nobody is worse than the Discord
message they were about to send, because now they are waiting for it as well.

So there are three ways back, and the server picks whichever **this airline and
this account** can actually support:

| | |
|---|---|
| **Discord** | They linked it. There was never anything to reset — they can sign in now. |
| **Email** | The VA runs a provider *and* the account has an address: a one-time link, and no staff member is involved at any point. |
| **Staff** | Everything else. The request lands in the crew center as a login waiting to be handed over, and the press that issues and sends it is one press. |

Only the third still costs an airline anything, and it costs one press instead
of five minutes of digging.

## The page is never told which

This is the part worth guarding. A page that answers *"check your email"* for
one username and *"we have told your staff"* for another is a page that will
tell a stranger which usernames exist at this airline, and which of them have
an address on file. It takes about four minutes to turn that into a list.

So the server answers **identically** in every case — found, not found, has an
email, has none, rate-limited — and the page says one sentence that is true of
all of them:

> If that is an account here, a way back in is on its way. Gave your airline an
> email address? It is in your inbox — check the spam folder too. If not, your
> staff have been asked to issue you a new password.

The Discord line on the panel is shown to **everybody** at a VA that offers
Discord sign-in, never only to accounts that have linked it, for the same
reason.

**One case does get its own words:** a 404, which means this crew center's
database predates resets. That is the difference between waiting for an email
that is coming and waiting for one that is not, so it says so and points at the
staff — the only honest answer while the VA is on an older schema.

## Where the two screens live

Both are panes of `crew.html` rather than pages of their own, swapped in place
of the sign-in form. A reset that drops somebody onto a bare white screen has
taken them out of their airline at the one moment they are least sure anything
is working; here they keep the VA's look, backdrop, banner, logo and colour,
because the page has already resolved all of it.

The markup is duplicated across the two looks (`center` and `split`) and shares
class names only — which is how every other control on that page spans them,
because the two looks share no styles at all. `tools/test-crew-forgot-password.js`
opens both, because duplicated markup drifts.

**The far end of the link** is `?reset=<token>` on the same page. It asks the
server whether the token is still good *before* drawing a form — a form that
cannot work is worse than a sentence — and a spent or expired link lands on the
sign-in card with the one thing worth saying: ask for another.

After a successful reset the pilot is **not** signed in. They are put back on
the sign-in form with their username filled in and told to use the new
password. The reset proves somebody had the link; typing the password once
proves they know what they just chose. The spent token is taken out of the
address bar, so a refresh does not say "that link has been used".

## What staff see

The roster drawer's third tab is now **Logins** rather than Invitations,
because it holds both halves of one job: a login minted for a new pilot and
waiting to be handed over, and one an existing pilot has asked to have
replaced. The badge counts both, and a pilot standing at a sign-in page they
cannot get through is drawn above an invitation that has been sitting unused
for a fortnight.

Each request says who asked, how long ago, and **why it reached a human at
all** — no email on file, or an email that could not be sent. One press issues
the password; it is emailed where that is possible, and the Copy message that
invitations already use is the fallback it has always been. Dismissing one
touches nothing: they keep the password they have, and they can ask again.

A crew center whose database predates all this shows one fewer thing in the
tab, not an error where the list should be.

## The backend

Implemented in the database repo, like the rest of the crew center.

```
POST /api/crew/<slug>/forgot-password          { who }        → { ok: true }
GET  /api/crew/<slug>/password-reset/<token>                  → { ok, name }
POST /api/crew/<slug>/password-reset/<token>   { newPassword } → { ok, username }

GET  /api/crew/<slug>/password-requests        staff: what is still waiting
POST /api/crew/<slug>/password-requests/<id>   staff: { action: 'issue' | 'dismiss' }
```

`GET /password-requests` returns
`{ requests: [{ id, name, username, email, askedAt, password?, message?, emailed? }] }`.
`password` and `message` appear only after the request has been issued, and
`issue` answers with the same row.

Server-side rules the client depends on:

* **`POST /forgot-password` answers the same thing every time.** Same status,
  same body, whether or not the account exists and whether or not it has an
  email address. Everything above rests on this.
* It is **rate-limited per account and per caller**, and the limit is not
  visible in the answer either — a 429 would be the same oracle by another
  route.
* A token is **single-use and short-lived**, is invalidated by a successful
  reset, by a later request, and by the password being changed any other way.
* A pilot with Discord linked and no password is still a valid request: the
  staff path issues them one.
* An issued reset sets `mustChangePassword`, exactly as an invitation does, so
  a temporary password a staff member has read is replaced on first sign-in.
* Dismissing a request must not touch the account.

## Files

| | |
|---|---|
| `crew.html` | Both panes, in both looks, and the one sentence. |
| `crew-dashboard.html` | The Logins tab: requests beside invitations. |
| `docs/CREW-FORGOT-PASSWORD.md` | This. |
| `tools/test-crew-forgot-password.js` | 51 checks. |

## Tests

```
node tools/test-crew-forgot-password.js
```

Covers: that the link is on the card and does not start open; that asking sends
what was typed and clears the box; **that an account which does not exist is
told character-for-character what a real one is told**; that a crew center
which cannot do resets says so instead of promising an email; that the Discord
line follows the VA's setting and not the account's; that a reset link opens a
named form on the airline's own page; that a mismatch and a too-short password
are refused without troubling the server; that a good one is sent with the
token, lands back on sign-in with the username filled and the spent token out
of the address bar; that a used link does not draw a form that cannot work;
that both looks do all of it; and on the staff side that a request appears
under Logins with how long they have waited and why it reached a human, that
one press issues it, that the password is hidden until asked for, that
dismissing says it is a dismissal, and that an older database shows an empty
tab rather than an error.
