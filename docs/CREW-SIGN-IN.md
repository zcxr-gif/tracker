# The sign-in page: looks, backdrops, and the banner

`crew.html` is the first page of a VA's crew center anybody sees. It has two
**looks** and six **backdrops**, and they are separate choices.

## Why two controls and not one

They are genuinely independent. A look is the **layout** — where the card sits
and what is beside it. A backdrop is **what fills the space around it**. Every
backdrop works under either layout, so two small pickers give a VA twelve
sign-in pages where one picker would have given two, and no combination of them
is broken.

| Look | |
|---|---|
| `center` | a card in the middle of the page |
| `split` | an editorial brand panel beside the sign-in |

| Backdrop | |
|---|---|
| `auto` | **the default.** The banner if there is one, Aurora if not |
| `banner` | the airline's banner, blurred, as the page's colour |
| `aurora` | soft light in the airline's own colours. No picture needed |
| `grid` | dark and technical, a drafting grid under a vignette |
| `horizon` | a drawn sky, deep at the top, with a great circle across it |
| `paper` | quiet and plain — the page's original field |

Four of the six need **no photograph at all**, which matters more than it
sounds: most VAs never upload a banner, and until now their sign-in page was a
grey dot field with a card on it.

`auto` resolves in the browser rather than on the server, because the answer
depends on something only the page knows for certain — whether the banner is a
URL it is willing to load.

## The banner, and what was wrong with it

A VA's banner is a **wide** picture. Three to one, often wider. It is a banner:
it was made to sit across the top of something.

The page used to stretch it over the whole viewport with `object-cover`. That
does not distort it — what it does instead is worse. Covering a phone screen
(one to two) with a three-to-one picture means scaling it about **seven times**
and showing a tall slice out of the middle. The airline's aircraft is off the
side of the screen; what is left is a few blurry pixels of sky. On a desktop it
was a heavy crop rather than a ruinous one, which is why it looked almost
passable and never good.

### It is now used twice, for two different jobs

**The ambience.** The banner blurred past recognition and scaled up, as the
page's colour field. Crop does not matter once a picture is blurred — what
survives is the airline's colour, which is the only thing a background was ever
contributing.

**The subject.** The *same* banner, crisp, in a band whose shape is a banner's
shape. Sixteen by six against a three-to-one source is about a tenth cropped off
the sides and no scaling worth the name. It is the first time the picture has
actually been looked at on this page.

In `center` the band is the top of the card and the logo rides its lower edge.
In `split` it sits at the foot of the brand panel — which is also why that panel
no longer drops the banner to a quarter opacity to make it tolerable.

**The rule that keeps it fixed:** never `object-cover` a banner into a box
taller than it is wide. `tools/test-crew-login-look.js` measures it directly —
it computes how much the browser actually had to scale the image and fails above
1.35×. Reverting to the old full-viewport treatment makes it report 6.9×.

## Two bugs worth remembering

**A `display:none` element is still in the DOM.** The pull that tucks the card's
head under the banner was written as `.bannerBand + .cardHead`. An adjacent
sibling selector goes on matching when the sibling is hidden, so a VA with no
banner got the pull anyway — and their logo was dragged up under the card's own
clipped top edge and cut in half. It looked like a layout bug and was a selector
bug. The rule is scoped to `body[data-banner="1"]` now.

**A backdrop nobody can see is not a choice.** In the split look the two panels
cover the window between them, so the backdrop would never have been visible
under half the looks on offer. The brand panel is transparent now and the
backdrop shows through it, under a fixed dark scrim — the panel's type is white,
two of the drawn backdrops are light, and white on a pale aurora is nothing at
all.

## Colour

Every drawn backdrop is built from `--accent`, the VA's own colour, with two
companions mixed from it:

```css
--bd-warm: color-mix(in srgb, var(--accent) 45%, #ff8a5b);
--bd-cool: color-mix(in srgb, var(--accent) 45%, #4ec3ff);
```

Mixed rather than hue-rotated, which CSS cannot do to a custom property. A red
accent warms to red-orange and cools to plum; a blue one to violet and to cyan.
Both stay unmistakably the airline's.

The first version of Aurora mixed the accent **into transparent** over a white
page and came out as fog — because most airline accents are dark, and a dark
colour at low alpha over white is grey, every time. Colour has to be mixed into
something luminous to stay colour. `grid` is dark in **both** themes on purpose:
a drafting grid on white is a spreadsheet, and a VA who picks it is picking the
instrument panel.

## Where it is stored

`loginLook` and `loginBackdrop` on the VA record, beside the layout and the
accent. Both are validated server-side against `LOGIN_LOOKS` and
`LOGIN_BACKDROPS` in `crewAuth.js`, and both come back on
`GET /api/va-ads/by-slug/<slug>` so the sign-in page can read them before it has
a session.

`?look=` and `?bg=` override for previewing; the dashboard's **Preview login**
link carries both plus the accent, so a VA sees what they are about to save.

## Files

| | |
|---|---|
| `crew.html` | the looks, the backdrops, and the banner in both its jobs |
| `crew-dashboard.html` | the two pickers, under *Login page look* |
| `tools/test-crew-login-look.js` | 37 checks |

## Tests

```
node tools/test-crew-login-look.js
```

Measures the banner's actual scale at phone and desktop widths; checks every
backdrop paints something and that the drawn ones need no picture; checks a VA
with no banner gets no empty band and an unclipped logo; checks an unknown or
stale stored value falls back rather than painting a void; and checks neither
look scrolls sideways.
