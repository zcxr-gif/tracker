/* ============================================================================
   crewShop.js — the VA shop, the pilot's card, and Inflight Pay.

   WHY THIS EXISTS

   A virtual airline has exactly one thing to give a pilot for flying: hours,
   which go up and are never spent on anything. Every VA that has wanted more
   than that has built the same thing by hand — a points spreadsheet, a Discord
   channel of "shop" screenshots, and a staff member manually subtracting
   numbers when somebody redeems something. It works for a month.

   So the crew center offers it properly, and a VA that does not want it never
   sees it: the shop is OFF until an owner turns it on, and every entry point
   into it — the dashboard tile, the pilot's card, the settings tab — is absent
   rather than empty while it is off.

   THE THREE THINGS IT IS

   1. EARNING. Points come from approved flight reports and nothing else. A
      PIREP is already the unit of work this product is built around: it is
      reviewed, it cannot be filed twice, and approving it is a deliberate act
      by a staff member. Anything else (a manual "give Rae 500 points" button)
      is a second, unaudited currency supply, and every VA that has run one has
      had the argument about it. Staff set the rate; the server does the sums
      when it approves the flight.

      There are ten rates rather than the original four, because three of those
      four were the same sentence — you flew, here is some money — and nothing
      in the set could say that one flight was worth more to the airline than
      another. The extra six are the levers a VA already wanted: the long haul,
      its own route network, a rostered departure, an event, the route of the
      week, and landing it clean. Every one of them still pays THROUGH the
      flight, and there is still no button that hands anybody anything.

   1b. THE STREAK. How many weeks in a row a pilot has flown. The only number
      in the crew center that can go down, and the only one that says somebody
      came BACK rather than that they flew a lot — hours, flights and miles all
      count the same thing. It pays a percentage per week to a cap, plus one-off
      milestones, and both ride on an approved flight like everything else.

      Nothing about it is stored: the server derives it from the VA's own
      logbook every time it is asked, so this file never computes one. Drawing
      a run the browser had guessed at would mean drawing a different number
      from the one the approval paid.

   2. THE CARD. Every pilot has one — their name, their callsign, their
      airline's colours and logo, their balance. It is deliberately the most
      finished-looking object in the crew center, because it is the thing a
      pilot screenshots into their VA's Discord, and that screenshot is the
      only advertising this feature will ever get.

   3. INFLIGHT PAY. Buying something is a sheet that comes up over the shop
      with the card on it, the amount, and one control you hold for a moment
      while it authorises. Not a form. Not a confirm() saying "Are you sure?".
      The point of the hold is not security — the server decides that — it is
      that a deliberate, physical gesture is what makes a transaction feel like
      a transaction rather than a click that might have been a mistake.

   WHAT THE CLIENT IS NOT ALLOWED TO DO

   Never compute a balance it then trusts, and never decide whether a pilot can
   afford something. It asks; the server debits, checks the stock and the
   per-pilot limit inside one statement in the VA's own database, and answers
   with the new balance. This file renders that answer. A shop where the
   browser subtracts the price is a shop where the browser can be told not to.

   THE BACKEND (implemented in the database repo)

     GET    /shop                    the lot: settings, items, the clubs, what a
                                     streak is worth here, and the caller's own
                                     wallet (which carries their run). Public-ish:
                                     signed out gets the items and no wallet.
     POST   /shop/settings           staff. { enabled, currency, earn }
     POST   /shop/items              staff. one item
     PATCH  /shop/items/<id>         staff
     DELETE /shop/items/<id>         staff
     GET    /shop/orders             staff: everyone's. Pilot: their own.
     POST   /shop/orders             { itemId } → { order, wallet }
     PATCH  /shop/orders/<id>        staff. { action: 'fulfil' | 'cancel' }
     GET    /streaks                 what a streak is worth here, and the
                                     caller's own. Public to read.
     POST   /streaks                 staff. { perWeek, maxBonus, freezeOnLeave,
                                     milestones: [{ weeks, bonus }] }
     GET    /streaks/suggested       staff. A worked set, priced in this
                                     airline's own flights.
     GET    /pireps/<id>/earnings    why that flight paid what it paid — the
                                     lines, the bonuses and the total. The pilot
                                     it belongs to, or anyone who reviews.

   Until a VA's database has those, every call answers 409 with a `*_missing`
   code, which CrewPanels.isSchemaGap already recognises — so a VA on an older
   schema is told to update it rather than shown a broken shop.

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewShop: crewPanels.js must load first'); return; }
    const { esc, icons, whenText, relativeText } = P;

    const S = {
        api: null,
        brand: {},          // { name, code, accent, logo } — for the card face
        panel: null,
        view: 'shop',       // shop | orders | manage
        data: null,         // the last GET /shop
        orders: null,
        crew: null,         // the last GET /shop/crew — the roster's cards
        crewError: null,
        crewOpen: '',       // the pilot whose shelf is expanded, by id
        loading: false,
        error: null,
        editing: null,      // the item being added or changed, in the back office
        cardHosts: [],      // in-page card mounts to repaint after a purchase
    };

    const tap = (kind) => {
        const H = window.InflightHaptics;
        if (!H) return;
        try { (H[kind] || H.tap || function () {})(); } catch (_) {}
    };

    const still = () => window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* =====================================================================
     * MONEY
     *
     * A VA names its own currency — Miles, Credits, Points, SkyCoins — so
     * nothing below ever says "points" in a string a pilot reads. `n()` is the
     * only place a number becomes text, so grouping and the unit agree
     * everywhere: the card, the price tag, the pay sheet and the receipt.
     * =================================================================== */

    const currency = () => (S.data && S.data.currency) || { name: 'Points', short: 'pts' };
    const num = (v) => Math.round(Number(v) || 0).toLocaleString();
    const money = (v) => `${num(v)} ${currency().short}`;

    /* =====================================================================
     * WHAT A THING COSTS TODAY
     *
     * An item can go on offer: a second, lower price that stands until a
     * date. `priceOf` is the only place that decides which of the two is in
     * force, so the tile, the shortfall label, the Inflight Pay sheet and the
     * saving-for bar cannot end up quoting three different numbers at each
     * other.
     *
     * It is a COURTESY, not a gate. The server re-prices every order and is
     * the only thing that can spend a balance — a device whose clock is a day
     * fast must not be able to buy last week's sale.
     * =================================================================== */

    const at = (v) => { const t = v ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; };
    const gone = (v) => { const t = at(v); return t != null && t <= Date.now(); };

    function onOffer(item) {
        if (!item || item.salePrice == null || item.salePrice === '') return false;
        const sale = Number(item.salePrice);
        if (!Number.isFinite(sale) || sale < 0) return false;
        // A "sale" at or above the price is a typo, not an offer, and drawing
        // a struck-through smaller number beside a larger one reads as a lie.
        if (!(sale < Number(item.price))) return false;
        return !gone(item.saleEndsAt);
    }
    const priceOf = (item) => (onOffer(item)
        ? Math.round(Number(item.salePrice))
        : Math.max(0, Math.round(Number(item && item.price) || 0)));

    /* =====================================================================
     * WHO HANDS IT OVER
     *
     * The shop shipped with one answer: a code, and a staff member who reads
     * it and does the thing. That is right for "name a route" and wrong for
     * everything a VA could simply give a pilot on the spot — a Discord
     * invite, a livery link, a form to fill in, a key from a list they bought
     * once. Waiting on a human for those is the difference between a shop and
     * a ticket queue, and it is the queue that quietly kills the economy: a
     * pilot who waits three days for the thing they saved twenty hours for
     * does not save for a second one.
     *
     * So an item says how it is delivered, and two of the three need nobody:
     *
     *   staff    the original. An order to work through, with a code.
     *   instant  the item carries what the pilot gets. Handed over on the spot.
     *   codes    the VA pastes a list; the server pops one per purchase.
     *
     * The CLIENT never decides this. It renders whatever the order comes back
     * carrying — the server pops the code and fulfils the order inside the
     * same statement that debits the balance, or none of it happens.
     * =================================================================== */

    const DELIVERY = {
        staff: { label: 'Staff hand it over', icon: 'user-round-check',
            note: 'It joins the orders queue with a code. Somebody on your team marks it delivered.' },
        instant: { label: 'They get it straight away', icon: 'zap',
            note: 'Write once what the pilot gets — a link, an invite, instructions. Every buyer sees exactly that.' },
        codes: { label: 'One code from a list', icon: 'ticket',
            note: 'Paste your codes, one per line. Each buyer gets the next unused one, and the shelf sells out when they run out.' },
    };
    const deliveryOf = (item) => (DELIVERY[item && item.delivery] ? item.delivery : 'staff');
    /** True when buying it needs nobody on the staff to do anything. */
    const selfClaim = (item) => deliveryOf(item) !== 'staff';

    /**
     * The card's number.
     *
     * The server issues one where it can. Where it has not yet, this derives a
     * stable number from the pilot's own id — the same pilot always sees the
     * same card, it is theirs, and it is not a random figure dressed up as a
     * record. It is a membership number, not an account that holds money: the
     * balance is the balance, and it lives in the VA's database.
     */
    function cardNumber(wallet) {
        if (wallet && wallet.cardNumber) return String(wallet.cardNumber);
        const seed = String((wallet && (wallet.pilotId || wallet.id || wallet.callsign)) || '');
        if (!seed) return '•••• •••• •••• ••••';
        let h = 2166136261;
        for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
        const digits = String(Math.abs(h)).padStart(8, '0').slice(0, 8);
        return `•••• •••• ${digits.slice(0, 4)} ${digits.slice(4, 8)}`;
    }

    /* =====================================================================
     * STYLES
     *
     * One sheet, added once. Every colour is a var() off the host page — the
     * rule crewPanels sets and the reason this looks like the VA's product in
     * either of the crew center's two interfaces without knowing which is on.
     *
     * The card is the exception that proves it: its face is built FROM the
     * accent rather than painted in tokens, because a membership card that
     * changes colour with the page's light/dark setting is not a card, it is a
     * div. A pilot's card looks the same at midnight as at noon.
     * =================================================================== */

    function styles() {
        P.baseStyles();
        P.style('crew-shop', `
        /* ---- THE CARD ---------------------------------------------------
           1.586:1 is the ISO/IEC 7810 ID-1 ratio — the shape of every bank
           card, and the reason this reads as one before a word of it is. */
        /* The card's own sizes are in cqi, and a cqi length inside an element
           resolves against the nearest ANCESTOR container, never against the
           element itself. So
           the container is this wrapper and the card is its only child: the
           face then scales off the width the wrapper was given, whether that
           is a phone's screen, the shop's hero or the pay sheet. */
        .sh-card-fit{ container-type:inline-size; width:100%; max-width:26rem; }
        /* THE FACE IS --sh-face, NOT --accent.
           ------------------------------------------------------------------
           The card used to be painted straight out of the page's accent, which
           meant every pilot at an airline held an identical object for as long
           as they flew there. It is now painted out of a colour the SERVER
           sends with the wallet: the colour of the CLUB their flying has
           earned them (see crewClubs.js on the backend). The default below is
           the old behaviour exactly, so a card drawn before the fetch lands,
           or for a signed-out visitor, or by an older server that knows
           nothing about clubs, is the card this always was.

           The three numbers under it are the finish: how hard the light comes
           off the face, how much texture it carries, and what the rim is made
           of. Those are what actually make a Platinum card look like a
           different object from a Standard one — a colour swap alone reads as
           a theme, where deeper light and a brighter edge read as better
           material, which is the thing being rewarded. */
        .sh-card{ position:relative; width:100%; aspect-ratio:1.586;
            --sh-face:var(--accent);
            --sh-gloss:.26;
            --sh-grain:.16;
            --sh-rim:rgb(255 255 255 / .22);
            border-radius:1.15rem; overflow:hidden; color:#fff; isolation:isolate;
            background:
                radial-gradient(120% 140% at 12% 4%, color-mix(in srgb, var(--sh-face) 88%, #fff 12%), transparent 58%),
                radial-gradient(100% 120% at 96% 96%, color-mix(in srgb, var(--sh-face) 70%, #000 30%), transparent 62%),
                linear-gradient(135deg, color-mix(in srgb, var(--sh-face) 92%, #000 8%), color-mix(in srgb, var(--sh-face) 58%, #000 42%));
            box-shadow:0 1px 0 0 var(--sh-rim) inset,
                       0 18px 44px -18px color-mix(in srgb, var(--sh-face) 55%, transparent),
                       0 30px 60px -40px rgb(0 0 0 / .9);
            transition:transform .4s cubic-bezier(.22,1.12,.36,1), box-shadow .4s ease,
                       background .6s ease;
            transform-style:preserve-3d; will-change:transform;
            padding:4.4cqi 4.8cqi; display:flex; flex-direction:column;
            font-variant-numeric:tabular-nums;
            /* EVERY SIZE ON THE FACE IS IN cqi — a percentage of the card's own
               width. The card appears at three sizes (the pilot's home, the
               shop's hero, the pay sheet) and a face laid out in rem is a
               different design at each of them: the chip flattens, the balance
               swamps the name, the number wraps. In cqi it is one card, drawn
               larger or smaller, exactly like the object it is imitating. */
        }
        /* The finishes, richest last. Which club maps to which is the server's
           decision — only the VA's ladder knows where its own top is — and
           these are just the materials. */
        .sh-card-t1{ --sh-gloss:.30; --sh-grain:.19; --sh-rim:rgb(255 226 196 / .34); }
        .sh-card-t2{ --sh-gloss:.36; --sh-grain:.22; --sh-rim:rgb(236 242 248 / .42); }
        .sh-card-t3{ --sh-gloss:.44; --sh-grain:.27; --sh-rim:rgb(255 236 178 / .52); }
        /* Four materials and not one per club, because a VA may run eight and
           nobody can tell a seventh finish from an eighth. A ladder longer than
           this tops out here — which is right: the top club should look like
           the top, and the colour is already doing the work of saying which. */
        .sh-card-t4{ --sh-gloss:.54; --sh-grain:.32; --sh-rim:rgb(226 232 244 / .68); }
        /* The sheen. One pass of light across the face, following the pointer
           where there is one and sitting still where there is not. */
        .sh-card::before{
            content:''; position:absolute; inset:-40%; z-index:0; pointer-events:none;
            background:linear-gradient(115deg, transparent 38%,
                       rgb(255 255 255 / var(--sh-gloss)) 48%,
                       rgb(255 255 255 / .06) 56%, transparent 64%);
            transform:translateX(var(--sh-sheen, -12%)) rotate(4deg);
            transition:transform .5s cubic-bezier(.22,1.12,.36,1);
        }
        /* A fine guilloché — the texture that stops a flat gradient reading as
           a placeholder. Two hairline grids at an angle. */
        .sh-card::after{
            content:''; position:absolute; inset:0; z-index:0; pointer-events:none;
            opacity:var(--sh-grain);
            background-image:
                repeating-linear-gradient(68deg, rgb(255 255 255 / .5) 0 1px, transparent 1px 9px),
                repeating-linear-gradient(-68deg, rgb(255 255 255 / .35) 0 1px, transparent 1px 13px);
            mask-image:radial-gradient(120% 120% at 80% 20%, #000, transparent 72%);
        }
        .sh-card > *{ position:relative; z-index:1; }
        .sh-card-top{ display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; }
        .sh-card-airline{ font-size:2.9cqi; font-weight:800; letter-spacing:.16em; text-transform:uppercase;
            opacity:.86; line-height:1.3; max-width:60cqi; }
        .sh-card-tier{ font-size:2.4cqi; font-weight:800; letter-spacing:.14em; text-transform:uppercase;
            opacity:.72; margin-top:.4cqi; display:flex; align-items:center; gap:1.4cqi; flex-wrap:wrap; }
        /* The finish, named. A pilot who can see their card change but cannot
           say what it changed TO has been given a mood, not a reward — and
           "Gold" is a word an airline's pilots already know the meaning of. */
        .sh-card-finish{ display:inline-flex; align-items:center; gap:.9cqi; opacity:1;
            padding:.5cqi 1.5cqi; border-radius:999px; letter-spacing:.16em;
            border:1px solid var(--sh-rim); background:rgb(255 255 255 / .1); }
        /* How far up the ladder that finish is. The pips are the half a pilot
           acts on: the name says what they hold, the pips say there is more. */
        .sh-pips{ display:inline-flex; gap:.6cqi; }
        .sh-pip{ width:1.1cqi; height:1.1cqi; border-radius:999px; background:rgb(255 255 255 / .28); }
        .sh-pip-on{ background:#fff; box-shadow:0 0 .8cqi rgb(255 255 255 / .6); }
        /* ROUNDED, because a VA's mark is very often a square PNG and a square
           corner against a rounded card reads as a sticker somebody left on it.
           A logo with its own transparent margin loses nothing to this — the
           radius clips a corner that was not drawn on. */
        .sh-card-logo{ max-height:8cqi; max-width:24cqi; object-fit:contain; border-radius:1.4cqi;
            filter:drop-shadow(0 1px 2px rgb(0 0 0 / .35)); }
        /* The chip. Drawn rather than an image so it takes the card's own
           light, and because one more network request for 34 pixels is silly. */
        .sh-chip{ flex:none; width:10cqi; height:7.7cqi; border-radius:1.4cqi; margin:3.4cqi 0 .8cqi;
            background:linear-gradient(135deg, #F7E7B4, #C9A94E 46%, #F3E3AE 60%, #B8983F);
            box-shadow:0 1px 2px rgb(0 0 0 / .35), 0 0 0 1px rgb(255 255 255 / .25) inset;
            position:relative; overflow:hidden; }
        .sh-chip::before,.sh-chip::after{ content:''; position:absolute; background:rgb(0 0 0 / .22); }
        .sh-chip::before{ left:0; right:0; top:50%; height:1px; }
        .sh-chip::after{ top:0; bottom:0; left:33%; width:1px; box-shadow:3.3cqi 0 0 rgb(0 0 0 / .22); }
        .sh-card-balance{ margin-top:auto; display:flex; align-items:baseline; gap:1.5cqi; }
        .sh-card-balance b{ font-size:7.4cqi; font-weight:800; letter-spacing:-.03em; line-height:1; }
        .sh-card-balance span{ font-size:3cqi; font-weight:700; opacity:.8; letter-spacing:.04em; }
        .sh-card-num{ font-size:3.2cqi; letter-spacing:.14em; opacity:.85; margin-top:1.9cqi; white-space:nowrap;
            font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
            display:flex; align-items:center; gap:2.4cqi; }
        .sh-card-foot{ display:flex; align-items:flex-end; justify-content:space-between; gap:3cqi; margin-top:1.7cqi; }
        .sh-card-name{ font-size:3.2cqi; font-weight:700; letter-spacing:.06em; text-transform:uppercase;
            white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .sh-card-since{ font-size:2.2cqi; font-weight:700; letter-spacing:.12em; text-transform:uppercase; opacity:.7; }
        .sh-card-mark{ font-size:2.4cqi; font-weight:800; letter-spacing:.1em; text-transform:uppercase;
            opacity:.85; display:flex; align-items:center; gap:1cqi; white-space:nowrap; }
        .sh-card-mark i{ width:.9em; height:.9em; }
        /* Signed out, or a staff account with no pilot record: the face is the
           same object with nothing claimed on it. */
        .sh-card-blank .sh-card-balance b,.sh-card-blank .sh-card-name{ opacity:.45; }

        @media (hover:hover){
            .sh-card-live:hover{ box-shadow:0 1px 0 0 var(--sh-rim) inset,
                0 26px 60px -20px color-mix(in srgb, var(--sh-face) 65%, transparent),
                0 40px 70px -40px rgb(0 0 0 / .95); }
        }
        @media (prefers-reduced-motion:reduce){
            .sh-card,.sh-card::before{ transition:none !important; }
        }
        `);

        /* ---- THE SHOP, THE PAY SHEET AND THE BACK OFFICE ----------------
           Split into a second sheet only so the card above can be read on its
           own; both are added once and never removed. */
        P.style('crew-shop-ui', `
        .sh-wrap{ display:grid; gap:1rem; }
        .sh-hero{ display:grid; gap:.9rem; justify-items:center; }

        /* ---- THE SPACE EITHER SIDE OF THE CARD --------------------------
           The card is a bank card: 1.586:1, and it stops at 26rem because
           past that it stops looking like one. Everything else was stacked
           UNDER it — what has been earned, what has been spent, the way into
           the shop — so in a 46rem panel, and across the full width of a
           pilot's own page, the card sat between two columns of nothing while
           the page grew downwards past it.

           Widening the card is not available; it is the shape it is. So the
           stack goes BESIDE it once there is room for both, and goes back to
           a stack when there is not. Same markup, one class. */
        .sh-hero-split{ width:100%; max-width:54rem; margin-inline:auto; }
        @media (min-width:44rem){
            .sh-hero-split{ grid-template-columns:minmax(0,24rem) minmax(0,1fr);
                align-items:center; gap:1.1rem 1.75rem; justify-items:stretch; }
        }
        .sh-hero-side{ display:grid; gap:.75rem; align-content:center; width:100%;
            justify-items:center; text-align:center; }
        @media (min-width:44rem){ .sh-hero-side{ justify-items:start; text-align:left; } }
        .sh-hero-side .cp-btn{ width:100%; justify-content:center; }
        /* Earned and spent, as figures rather than a sentence: the card
           already carries the balance, and what fills a column beside it is
           the two numbers that say where the balance came from. */
        .sh-stats{ display:grid; grid-template-columns:repeat(auto-fit,minmax(7.5rem,1fr));
            gap:.5rem; width:100%; }
        .sh-stat{ border:1px solid var(--line,#e5e5e5); border-radius:.85rem;
            background:var(--surface,#fff); padding:.55rem .75rem .6rem; }
        .sh-stat b{ display:block; font-size:1.15rem; font-weight:800; letter-spacing:-.02em;
            line-height:1.15; font-variant-numeric:tabular-nums; }
        .sh-stat span{ font-size:.64rem; font-weight:700; letter-spacing:.1em;
            text-transform:uppercase; color:var(--muted,#736E64); }
        .sh-hero-note{ font-size:.78rem; color:var(--muted,#736E64); line-height:1.45; margin:0; }

        .sh-tabs{ display:flex; gap:.35rem; padding:.25rem; border-radius:999px;
            background:color-mix(in srgb, var(--ink,#1C1A16) 6%, transparent); }
        .sh-tab{ flex:1; border:0; background:none; cursor:pointer; font:inherit; font-size:.8rem;
            font-weight:700; padding:.45rem .7rem; border-radius:999px; color:var(--muted,#736E64);
            transition:background .18s ease, color .18s ease; }
        .sh-tab-on{ background:var(--surface,#fff); color:var(--ink,#1C1A16);
            box-shadow:0 1px 2px rgb(0 0 0 / .12); }

        /* ---- The shelves ------------------------------------------------ */
        .sh-grid{ display:grid; gap:.75rem; grid-template-columns:repeat(auto-fill,minmax(13rem,1fr)); }
        .sh-item{ display:flex; flex-direction:column; border:1px solid var(--line,#e5e5e5);
            border-radius:.9rem; background:var(--surface,#fff); overflow:hidden;
            transition:border-color .22s ease, transform .22s cubic-bezier(.22,1.12,.36,1), box-shadow .22s ease; }
        @media (hover:hover){
            .sh-item:hover{ transform:translateY(-2px); border-color:color-mix(in srgb, var(--accent) 45%, transparent);
                box-shadow:0 12px 30px -18px rgb(0 0 0 / .55); }
        }
        .sh-item-art{ aspect-ratio:16/10; background:color-mix(in srgb, var(--accent) 9%, transparent);
            display:grid; place-items:center; overflow:hidden; }
        .sh-item-art img{ width:100%; height:100%; object-fit:cover; display:block; }
        /* Most things a VA sells are not photographable — a livery unlock, a
           Discord role, a slot on a group flight. Those get a band with the
           item's own icon rather than a 16:10 hole where a picture is not. */
        .sh-item-band{ height:2.9rem; display:flex; align-items:center; padding:0 .85rem;
            background:linear-gradient(105deg, color-mix(in srgb, var(--accent) 20%, transparent),
                       color-mix(in srgb, var(--accent) 6%, transparent)); }
        .sh-item-band i{ width:1.15rem; height:1.15rem; color:color-mix(in srgb, var(--accent) 85%, var(--ink,#1C1A16)); }
        .sh-item-body{ padding:.8rem .85rem .85rem; display:flex; flex-direction:column; gap:.3rem; flex:1; }
        .sh-item-name{ font-size:.9rem; font-weight:700; letter-spacing:-.01em;
            display:flex; align-items:flex-start; gap:.4rem; }
        .sh-item-name > span{ min-width:0; }
        .sh-item-desc{ font-size:.78rem; color:var(--muted,#736E64); line-height:1.4; }
        /* Price, an old price, how short they are, and a Buy button, on a
           13rem tile. It wraps rather than squeezing the shortfall into two
           cramped lines over the price it belongs to. */
        .sh-item-foot{ display:flex; align-items:center; flex-wrap:wrap; gap:.35rem .5rem;
            margin-top:auto; padding-top:.55rem; }
        .sh-price{ font-size:.95rem; font-weight:800; letter-spacing:-.01em; font-variant-numeric:tabular-nums;
            display:inline-flex; align-items:baseline; gap:.25rem; }
        .sh-price small{ font-size:.66rem; font-weight:700; color:var(--muted,#736E64); letter-spacing:.04em; }
        .sh-buy{ margin-left:auto; }

        /* ---- THE THREE SIZES A THING IS DRAWN AT ------------------------
           The shelf shipped as one grid of identical tiles, which is right for
           a shop where everything costs about the same and wrong for this one.
           The three things on it a pilot will actually talk about — their own
           livery, the month they were the crew centre's hero, the aircraft
           they put in the fleet — were the same 13rem card as "a line in the
           next NOTAM", and the effect was that a shelf of genuinely good
           things read as a list of odds and ends.

           See TIERS in crewShop.js on the backend for what each one means.

           SHOWCASE: twice the width and a picture that is allowed to be a
           picture. These are the things whose entire value is that other
           people can see them, and a thing nobody notices on the shelf is a
           thing nobody buys. It spans two columns where two exist and falls
           back to one on a phone: a two-column span on a one-column grid is not an
           error, it is one column. */
        .sh-item-showcase{ grid-column:span 2; }
        .sh-item-showcase .sh-item-art{ aspect-ratio:16/7; }
        .sh-item-showcase .sh-item-band{ height:4rem; }
        .sh-item-showcase .sh-item-band i{ width:1.6rem; height:1.6rem; }
        .sh-item-showcase .sh-item-name{ font-size:1.02rem; }
        .sh-item-showcase .sh-item-desc{ font-size:.82rem; }
        .sh-item-showcase .sh-price{ font-size:1.1rem; }
        @media (max-width:33rem){ .sh-item-showcase{ grid-column:span 1; } }

        /* FLAGSHIP: a band across the whole shelf, above everything else.
           These change the AIRLINE rather than the pilot — an aircraft in the
           fleet, a base, the livery everybody flies — there are never more
           than a few, and each one is a month of somebody's flying. A grid
           tile cannot carry that, so they do not get one.

           The gold hairline and the corner mark are the only ornament in this
           whole file, and they are here because this is the one row on the
           shelf where a pilot should be able to tell, without reading, that
           they are looking at something different in kind. */
        .sh-flag-band{ display:grid; gap:.6rem; margin:.2rem 0 .9rem; }
        .sh-fl{ position:relative; display:flex; align-items:stretch; gap:0;
            border:1px solid color-mix(in srgb, #C9A227 45%, var(--line,#e5e5e5));
            border-radius:1rem; overflow:hidden; background:
                linear-gradient(100deg, color-mix(in srgb, #C9A227 9%, var(--surface,#fff)),
                var(--surface,#fff) 60%);
            transition:border-color .22s ease, transform .22s cubic-bezier(.22,1.12,.36,1), box-shadow .22s ease; }
        @media (hover:hover){
            .sh-fl:hover{ transform:translateY(-2px); border-color:#C9A227;
                box-shadow:0 16px 40px -22px rgb(0 0 0 / .6); }
        }
        .sh-fl-art{ width:11rem; flex:none; background:color-mix(in srgb, #C9A227 14%, transparent);
            display:grid; place-items:center; overflow:hidden; }
        .sh-fl-art img{ width:100%; height:100%; object-fit:cover; display:block; }
        .sh-fl-art i{ width:2.1rem; height:2.1rem; color:color-mix(in srgb, #C9A227 70%, var(--ink,#1C1A16)); }
        .sh-fl-body{ flex:1; min-width:0; padding:1rem 1.1rem; display:flex; flex-direction:column; gap:.35rem; }
        .sh-fl-kind{ font-size:.6rem; font-weight:800; letter-spacing:.14em; text-transform:uppercase;
            color:color-mix(in srgb, #C9A227 68%, var(--ink,#1C1A16)); display:inline-flex; align-items:center; gap:.3rem; }
        .sh-fl-kind i{ width:.8rem; height:.8rem; }
        .sh-fl-name{ font-size:1.15rem; font-weight:800; letter-spacing:-.02em; line-height:1.15;
            display:flex; align-items:flex-start; gap:.4rem; }
        .sh-fl-name > span{ min-width:0; }
        .sh-fl-desc{ font-size:.84rem; color:var(--muted,#736E64); line-height:1.45; }
        .sh-fl-foot{ display:flex; align-items:center; flex-wrap:wrap; gap:.4rem .7rem; margin-top:auto; padding-top:.7rem; }
        .sh-fl-foot .sh-price{ font-size:1.3rem; }
        @media (max-width:33rem){
            .sh-fl{ flex-direction:column; }
            .sh-fl-art{ width:auto; height:6rem; }
            .sh-fl-body{ padding:.85rem .9rem; }
            .sh-fl-name{ font-size:1.02rem; }
        }
        /* The shut state applies to a flagship exactly as it does to a tile. */
        .sh-fl.sh-item-shut{ opacity:.72; }
        .sh-fl.sh-item-shut .sh-fl-art{ filter:saturate(.4); }
        @media (prefers-reduced-motion:reduce){ .sh-fl{ transition:none; } }
        .sh-stock{ font-size:.66rem; font-weight:700; letter-spacing:.08em; text-transform:uppercase;
            color:var(--muted,#736E64); }
        .sh-stock-out{ color:#DC2626; }
        .sh-short{ font-size:.66rem; font-weight:700; letter-spacing:.06em; text-transform:uppercase;
            color:var(--muted,#736E64); margin-left:auto; }

        /* ---- The marks on a tile ---------------------------------------
           A pilot decides whether to spend twenty hours of flying on the
           strength of one tile, so anything that changes the answer belongs
           ON it: that it arrives instantly, that the price is only this good
           until Sunday, that this is the one they are saving for. */
        .sh-flags{ display:flex; flex-wrap:wrap; gap:.3rem; margin-bottom:.1rem; }
        .sh-flag{ display:inline-flex; align-items:center; gap:.25rem; font-size:.6rem; font-weight:800;
            letter-spacing:.08em; text-transform:uppercase; padding:.15rem .4rem; border-radius:.35rem;
            background:color-mix(in srgb, var(--ink,#1C1A16) 7%, transparent); color:var(--muted,#736E64); }
        .sh-flag i{ width:.85em; height:.85em; }
        .sh-flag-now{ background:color-mix(in srgb, var(--accent) 16%, transparent);
            color:color-mix(in srgb, var(--accent) 80%, var(--ink,#1C1A16)); }
        .sh-flag-sale{ background:#DC2626; color:#fff; }
        .sh-flag-goal{ background:color-mix(in srgb, var(--accent) 88%, #000 12%); color:#fff; }
        .sh-was{ font-size:.7rem; font-weight:700; color:var(--muted,#736E64); text-decoration:line-through;
            text-decoration-thickness:1px; }

        /* The pin. One shelf item at a time is "the one I'm flying towards",
           and it is a toggle on the tile rather than a screen of its own —
           a goal you have to go somewhere to set is a goal nobody sets. */
        .sh-pin{ border:0; background:none; cursor:pointer; padding:.2rem; margin:-.2rem -.2rem -.2rem auto;
            color:var(--faint,#A8A296); border-radius:.4rem; line-height:0;
            transition:color .18s ease, background .18s ease; }
        .sh-pin i{ width:1rem; height:1rem; }
        .sh-pin:hover{ color:var(--ink,#1C1A16); background:color-mix(in srgb, var(--ink,#1C1A16) 7%, transparent); }
        .sh-pin[aria-pressed="true"]{ color:var(--accent); }

        /* ---- Saving for -------------------------------------------------
           Beside the card: the one thing this balance is FOR. A number with
           nothing to be measured against is a number nobody watches. */
        .sh-goal{ width:100%; display:grid; gap:.4rem; padding:.65rem .75rem .7rem;
            border:1px solid var(--line,#e5e5e5); border-radius:.85rem; background:var(--surface,#fff); text-align:left; }
        .sh-goal-head{ display:flex; align-items:baseline; gap:.5rem; }
        .sh-goal-for{ font-size:.62rem; font-weight:800; letter-spacing:.1em; text-transform:uppercase;
            color:var(--muted,#736E64); }
        .sh-goal-name{ font-size:.88rem; font-weight:700; letter-spacing:-.01em; margin-left:auto;
            text-align:right; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .sh-goal-bar{ height:.45rem; border-radius:999px; overflow:hidden;
            background:color-mix(in srgb, var(--ink,#1C1A16) 9%, transparent); }
        .sh-goal-fill{ height:100%; border-radius:999px; background:var(--accent);
            width:calc(var(--sh-g,0) * 100%); transition:width .5s cubic-bezier(.22,1.12,.36,1); }
        .sh-goal-note{ font-size:.72rem; color:var(--muted,#736E64); font-variant-numeric:tabular-nums; }
        .sh-goal-note b{ color:var(--ink,#1C1A16); }
        @media (prefers-reduced-motion:reduce){ .sh-goal-fill{ transition:none; } }

        /* ---- What a self-claimed purchase hands back --------------------
           A link, an invite, a key. It is the whole value of the purchase, so
           it is selectable, copyable, and kept on the order for ever — a
           reward you can only read once is a support ticket waiting to
           happen. */
        .sh-reward{ width:100%; display:grid; gap:.5rem; text-align:left;
            border:1px solid var(--line,#e5e5e5); border-radius:.85rem;
            background:color-mix(in srgb, var(--accent) 6%, var(--surface,#fff)); padding:.7rem .8rem .75rem; }
        .sh-reward-h{ font-size:.62rem; font-weight:800; letter-spacing:.1em; text-transform:uppercase;
            color:var(--muted,#736E64); }
        .sh-reward-body{ font-size:.84rem; line-height:1.5; white-space:pre-wrap; word-break:break-word;
            -webkit-user-select:text; user-select:text; }
        .sh-reward-body a{ color:var(--accent); text-decoration:underline; text-underline-offset:2px; }
        .sh-copy{ justify-self:start; }

        /* ---- INFLIGHT PAY ------------------------------------------------
           Its own layer above the panel: a pilot presses Buy inside the shop
           and this comes up over it, so the shop is still there behind and
           cancelling puts them back exactly where they were. */
        .sh-pay{ position:fixed; inset:0; z-index:140; display:grid; align-items:end; justify-items:center; }
        @media (min-width:40rem){ .sh-pay{ align-items:center; } }
        .sh-pay-scrim{ position:absolute; inset:0; background:rgb(4 6 12 / .62);
            -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px); }
        .sh-pay-card{ position:relative; width:min(27rem,100%); background:var(--surface,#fff);
            border:1px solid var(--line,#e5e5e5); border-radius:1.4rem 1.4rem 0 0;
            padding:1.1rem 1.1rem 1.35rem; display:grid; gap:.9rem; justify-items:center;
            box-shadow:0 -20px 60px -20px rgb(0 0 0 / .6);
            animation:sh-up .38s cubic-bezier(.22,1.12,.36,1) both; }
        @media (min-width:40rem){
            .sh-pay-card{ border-radius:1.4rem; box-shadow:0 40px 90px -30px rgb(0 0 0 / .7); }
        }
        @keyframes sh-up{ from{ transform:translateY(14%); opacity:0; } to{ transform:none; opacity:1; } }
        .sh-pay-mark{ display:flex; align-items:center; gap:.4rem; font-size:.72rem; font-weight:800;
            letter-spacing:.14em; text-transform:uppercase; color:var(--muted,#736E64); }
        .sh-pay-mark i{ width:1em; height:1em; }
        .sh-pay-card .sh-card-fit{ max-width:19rem; }
        .sh-pay-what{ text-align:center; display:grid; gap:.15rem; }
        .sh-pay-item{ font-size:.88rem; font-weight:700; letter-spacing:-.01em; }
        .sh-pay-amount{ font-size:2.1rem; font-weight:800; letter-spacing:-.035em; line-height:1.05;
            font-variant-numeric:tabular-nums; }
        .sh-pay-after{ font-size:.74rem; color:var(--muted,#736E64); }
        .sh-pay-note{ font-size:.74rem; color:var(--muted,#736E64); text-align:center; max-width:20rem; }
        .sh-pay-bad{ color:#DC2626; }

        /* Hold to pay. The ring fills for as long as the press is held; let go
           early and it empties again. The gesture is the point: a purchase
           that happens on mousedown is a purchase somebody made by accident. */
        .sh-hold{ position:relative; width:100%; display:flex; align-items:center; justify-content:center;
            gap:.5rem; min-height:3.1rem; border:0; border-radius:999px; cursor:pointer;
            font:inherit; font-size:.92rem; font-weight:800; letter-spacing:.01em;
            background:var(--ink,#1C1A16); color:var(--bg,#fff); overflow:hidden;
            touch-action:none; -webkit-user-select:none; user-select:none; }
        .sh-hold:disabled{ opacity:.5; cursor:default; }
        .sh-hold-fill{ position:absolute; inset:0; transform-origin:left center;
            transform:scaleX(var(--sh-p,0)); background:color-mix(in srgb, var(--accent) 82%, #fff 18%);
            transition:transform .12s linear; }
        .sh-hold-label{ position:relative; display:inline-flex; align-items:center; gap:.45rem; }
        .sh-hold-label i{ width:1.05em; height:1.05em; }
        .sh-cancel{ background:none; border:0; font:inherit; font-size:.82rem; font-weight:600;
            color:var(--muted,#736E64); cursor:pointer; padding:.3rem .6rem; }

        /* The authorised state. One tick, drawn, then the receipt. */
        .sh-done{ display:grid; gap:.7rem; justify-items:center; text-align:center; padding:.6rem 0 .2rem; }
        .sh-tick{ width:3.4rem; height:3.4rem; border-radius:50%; display:grid; place-items:center;
            background:#16A34A; color:#fff; animation:sh-pop .42s cubic-bezier(.22,1.3,.36,1) both; }
        .sh-tick i{ width:1.8rem; height:1.8rem; stroke-width:3; }
        @keyframes sh-pop{ from{ transform:scale(.4); opacity:0; } to{ transform:none; opacity:1; } }
        .sh-done-title{ font-size:1rem; font-weight:800; letter-spacing:-.015em; }
        .sh-code{ font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:1.05rem;
            font-weight:700; letter-spacing:.18em; padding:.45rem .8rem; border-radius:.6rem;
            border:1px dashed var(--line,#e5e5e5); background:color-mix(in srgb, var(--ink,#1C1A16) 4%, transparent); }

        /* ---- Orders and the back office --------------------------------- */
        .sh-row{ display:flex; align-items:center; gap:.75rem; padding:.7rem .8rem;
            border:1px solid var(--line,#e5e5e5); border-radius:.8rem; background:var(--surface,#fff); }
        .sh-row-main{ min-width:0; flex:1; }
        .sh-row-name{ font-size:.88rem; font-weight:700; letter-spacing:-.01em; }
        .sh-row-sub{ font-size:.74rem; color:var(--muted,#736E64); margin-top:.1rem; }
        .sh-row-actions{ display:flex; align-items:center; gap:.35rem; flex-shrink:0; }
        /* An order that was claimed on the spot keeps what it handed over,
           under the row it belongs to, for as long as the order exists. */
        .sh-order{ display:grid; gap:.5rem; }
        .sh-order .sh-reward{ margin-left:.1rem; }

        /* ---- How a thing reaches a pilot -------------------------------
           Three named choices rather than a dropdown, because each of them
           changes what the rest of the form asks for and a VA has to be able
           to read what they are choosing between before they choose. */
        .sh-deliv{ display:grid; gap:.4rem; }
        .sh-deliv-opt{ display:flex; align-items:flex-start; gap:.6rem; width:100%; text-align:left;
            padding:.6rem .7rem; border:1px solid var(--line,#e5e5e5); border-radius:.75rem;
            background:var(--surface,#fff); cursor:pointer; font:inherit; color:inherit;
            transition:border-color .18s ease, background .18s ease; }
        .sh-deliv-opt:hover{ border-color:color-mix(in srgb, var(--accent) 45%, var(--line,#e5e5e5)); }
        .sh-deliv-opt[aria-pressed="true"]{ border-color:var(--accent);
            background:color-mix(in srgb, var(--accent) 7%, var(--surface,#fff)); }
        .sh-deliv-opt i{ width:1.05rem; height:1.05rem; flex:none; margin-top:.1rem;
            color:color-mix(in srgb, var(--accent) 80%, var(--ink,#1C1A16)); }
        .sh-deliv-opt b{ display:block; font-size:.85rem; font-weight:700; letter-spacing:-.01em; }
        .sh-deliv-opt small{ display:block; font-size:.74rem; color:var(--muted,#736E64); line-height:1.4; margin-top:.1rem; }
        /* A hidden field is hidden. .cp-label sets its own display, which
           beats the browser's own rule for [hidden] — so it is said again,
           louder, rather than by inventing a second way to hide something. */
        .sh-section [hidden]{ display:none !important; }
        .sh-codes-left{ font-variant-numeric:tabular-nums; }
        .sh-codes-none{ color:#DC2626; font-weight:700; }
        .sh-section{ display:grid; gap:.55rem; }
        .sh-h{ font-size:.72rem; font-weight:800; letter-spacing:.14em; text-transform:uppercase;
            color:var(--faint,#A8A296); }
        .sh-rate{ display:grid; grid-template-columns:1fr 6.5rem; gap:.5rem; align-items:center; }
        .sh-rate label{ font-size:.84rem; }
        .sh-rate small{ display:block; font-size:.72rem; color:var(--muted,#736E64); }
        /* The one line that makes the earning rules legible: the rates above,
           spent on a flight a pilot has actually flown. */
        .sh-example{ font-size:.82rem; padding:.7rem .8rem; border-radius:.8rem;
            background:color-mix(in srgb, var(--accent) 8%, transparent);
            border:1px solid color-mix(in srgb, var(--accent) 22%, transparent); }
        .sh-example b{ font-variant-numeric:tabular-nums; }
        .sh-switch{ display:flex; align-items:center; gap:.7rem; padding:.8rem .85rem;
            border:1px solid var(--line,#e5e5e5); border-radius:.9rem; background:var(--surface,#fff); }
        .sh-switch-main{ flex:1; min-width:0; }
        /* ---- The suggestions ------------------------------------------
           A grid rather than a list, and deliberately not styled like the
           shelf above it: these are not on sale yet, and a VA scanning the
           back office must never have to work out which rows are real. */
        .sh-sug-group{ font-size:.72rem; font-weight:700; color:var(--muted,#736E64);
            margin:.35rem 0 .1rem; }
        .sh-sugs{ display:grid; gap:.4rem;
            grid-template-columns:repeat(auto-fill, minmax(min(13rem,100%), 1fr)); }
        .sh-sug{ display:flex; align-items:center; gap:.55rem; width:100%; text-align:left;
            padding:.55rem .6rem; border-radius:.7rem; cursor:pointer; font:inherit;
            border:1px dashed var(--line,#e5e5e5);
            background:color-mix(in srgb, var(--ink,#1C1A16) 2%, transparent);
            color:inherit; transition:border-color .15s ease, background-color .15s ease; }
        .sh-sug:hover{ border-style:solid; border-color:var(--accent);
            background:color-mix(in srgb, var(--accent) 7%, transparent); }
        .sh-sug[disabled]{ opacity:.55; cursor:default; }
        .sh-sug i{ width:1rem; height:1rem; flex-shrink:0; color:var(--accent); }
        .sh-sug-main{ display:block; min-width:0; flex:1; }
        .sh-sug-name{ display:block; font-size:.8rem; font-weight:700; letter-spacing:-.01em;
            overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .sh-sug-price{ display:block; font-size:.72rem; color:var(--muted,#736E64);
            font-variant-numeric:tabular-nums; }
        /* ---- The icon picker ------------------------------------------- */
        .sh-icons{ display:flex; flex-wrap:wrap; gap:.3rem; }
        .sh-icon{ width:2.1rem; height:2.1rem; display:grid; place-items:center; cursor:pointer;
            border:1px solid var(--line,#e5e5e5); border-radius:.6rem; background:var(--surface,#fff);
            color:inherit; padding:0; }
        .sh-icon i{ width:1rem; height:1rem; }
        .sh-icon[aria-pressed="true"]{ border-color:var(--accent);
            box-shadow:0 0 0 1px var(--accent); color:var(--accent); }
        /* ---- THE CLUBS --------------------------------------------------
           The ladder a pilot climbs by flying, and what each rung is worth.
           The NEXT club is the whole screen — everything under it is context
           for one sentence — so it gets the only box with a colour in it. */
        .sh-club-next{ border-radius:.8rem; padding:.85rem .95rem; display:grid; gap:.5rem;
            margin-bottom:1rem; border:1px solid color-mix(in srgb, var(--accent) 35%, transparent);
            background:color-mix(in srgb, var(--accent) 7%, transparent); }
        .sh-club-next-h{ font-size:.95rem; font-weight:650; letter-spacing:-.01em;
            display:flex; align-items:center; gap:.4rem; }
        .sh-club-next-h b{ font-size:1.25rem; font-weight:800; letter-spacing:-.02em; }
        .sh-club-next-h i{ width:1.05rem; height:1.05rem; color:var(--accent); }
        .sh-club-top{ background:color-mix(in srgb, var(--accent) 10%, transparent); }
        .sh-club-bar{ height:.4rem; border-radius:999px; overflow:hidden;
            background:color-mix(in srgb, var(--ink,#1C1A16) 10%, transparent); }
        .sh-club-bar span{ display:block; height:100%; border-radius:999px; background:var(--accent);
            transition:width .5s cubic-bezier(.22,1.12,.36,1); }
        .sh-club-next-foot{ display:flex; justify-content:space-between; gap:.75rem; }
        .sh-club-gets{ display:flex; flex-wrap:wrap; gap:.3rem; align-items:center; }
        .sh-club-gets-h{ font-size:.66rem; font-weight:800; letter-spacing:.08em; text-transform:uppercase;
            color:var(--muted,#736E64); width:100%; }
        .sh-club-get{ display:inline-flex; align-items:center; gap:.3rem; font-size:.74rem; font-weight:650;
            padding:.2rem .5rem; border-radius:999px;
            background:color-mix(in srgb, var(--ink,#1C1A16) 6%, transparent); }
        .sh-club-get i{ width:.8rem; height:.8rem; color:var(--accent); }
        .sh-club-list{ display:grid; gap:.35rem; }
        .sh-club{ display:flex; gap:.7rem; padding:.6rem .7rem; border-radius:.6rem;
            border:1px solid transparent; align-items:flex-start; }
        .sh-club-here{ border-color:var(--accent);
            background:color-mix(in srgb, var(--accent) 6%, transparent); }
        /* A club already behind you is dimmed rather than hidden: the ladder
           has to read as a ladder, and the rungs below are what make the one
           you are on mean anything. */
        .sh-club-past{ opacity:.55; }
        .sh-club-swatch{ flex:none; width:.5rem; align-self:stretch; min-height:2.2rem; border-radius:999px;
            background:linear-gradient(180deg, color-mix(in srgb, var(--sh-face) 92%, #fff 8%),
                       color-mix(in srgb, var(--sh-face) 55%, #000 45%)); }
        .sh-club-main{ flex:1; min-width:0; display:grid; gap:.25rem; }
        .sh-club-name{ font-weight:700; letter-spacing:-.01em; display:flex; align-items:center; gap:.4rem; }
        .sh-club-at{ font-size:.75rem; color:var(--muted,#736E64); }
        .sh-club-staff{ margin-top:1rem; padding-top:.8rem; display:grid; gap:.5rem; justify-items:start;
            border-top:1px dashed var(--line,#e5e5e5); }
        /* Early access, on the shelf. */
        .sh-flag-club{ background:color-mix(in srgb, var(--accent) 88%, #000 12%); color:#fff; }
        .sh-flag-wait{ background:color-mix(in srgb, var(--ink,#1C1A16) 10%, transparent);
            color:var(--muted,#736E64); }
        .sh-item-shut{ opacity:.72; }
        .sh-item-shut .sh-item-art,.sh-item-shut .sh-item-band{ filter:saturate(.4); }
        /* ---- THE STREAK -------------------------------------------------
           One number, as big as the card's balance, because it is the same
           KIND of thing: a figure a pilot checks rather than reads. The state
           is carried by the border and the rule under the number, not by the
           number's colour — a red "12" reads as an error. */
        .sh-streak{ border-radius:.8rem; padding:1rem; display:grid; gap:.6rem;
            border:1px solid var(--line,#e5e5e5); background:var(--surface,#fff); }
        .sh-streak-n{ display:flex; align-items:baseline; gap:.5rem; }
        .sh-streak-n i{ width:1.4rem; height:1.4rem; align-self:center;
            color:color-mix(in srgb, var(--ink,#1C1A16) 35%, transparent); }
        .sh-streak-n b{ font-size:2.6rem; line-height:1; font-weight:800; letter-spacing:-.04em;
            font-variant-numeric:tabular-nums; }
        .sh-streak-n span{ font-size:.82rem; font-weight:650; color:var(--muted,#736E64); }
        .sh-streak-line{ margin:0; font-size:.88rem; font-weight:600; letter-spacing:-.01em; }
        .sh-streak-pay{ display:grid; gap:.35rem; }
        .sh-streak-foot{ display:flex; justify-content:space-between; gap:.75rem; flex-wrap:wrap;
            border-top:1px dashed var(--line,#e5e5e5); padding-top:.5rem; }
        /* SAFE is calm and AT RISK is the only loud thing in this panel. It is
           loud because it is the one piece of genuinely useful bad news the
           crew center has: there is something to lose and time left to save
           it. ON LEAVE is deliberately NOT loud — a pilot who told their
           airline they are away has already done the right thing. */
        .sh-streak-safe{ border-color:color-mix(in srgb, var(--accent) 35%, transparent);
            background:color-mix(in srgb, var(--accent) 6%, transparent); }
        .sh-streak-safe .sh-streak-n i{ color:var(--accent); }
        .sh-streak-risk{ border-color:color-mix(in srgb, #C2410C 45%, transparent);
            background:color-mix(in srgb, #C2410C 7%, transparent); }
        .sh-streak-risk .sh-streak-n i{ color:#C2410C; }
        .sh-streak-risk .sh-streak-line{ color:#9A3412; }
        .sh-streak-leave .sh-streak-n i{ color:var(--muted,#736E64); }
        .sh-streak-leave .sh-streak-n b{ opacity:.65; }
        /* On the card itself: a chip, not a second balance. The card already
           has one big number and a face; this is the smallest thing on it that
           is still legible at the size a screenshot gets shared at. */
        .sh-card-streak{ display:inline-flex; align-items:center; gap:.25rem; flex:none;
            font-family:inherit; font-size:2.6cqi; font-weight:800; letter-spacing:.02em; opacity:1;
            padding:.15rem .45rem; border-radius:999px;
            background:rgba(255,255,255,.16); color:#fff; }
        .sh-card-streak i{ width:2.8cqi; height:2.8cqi; }
        /* ---- THE RATES, GROUPED ------------------------------------------
           Ten numbers in one column is a form nobody finishes. */
        .sh-rateset{ display:grid; gap:.3rem; padding:.7rem .8rem; border-radius:.7rem;
            border:1px solid var(--line,#e5e5e5); margin-bottom:.5rem; }
        .sh-rateset-h{ font-size:.68rem; font-weight:800; letter-spacing:.09em; text-transform:uppercase;
            color:var(--muted,#736E64); }
        .sh-rateset .cp-note{ margin:0 0 .2rem; }
        /* ---- THE CLUB EDITOR, IN THE BACK OFFICE ------------------------ */
        .sh-cedit{ display:grid; gap:.4rem; }
        .sh-crow{ display:grid; gap:.4rem; padding:.6rem .7rem; border-radius:.6rem;
            border:1px solid var(--line,#e5e5e5); background:var(--surface,#fff); }
        .sh-crow-top{ display:flex; gap:.4rem; align-items:center; }
        .sh-crow-top input[type="text"]{ flex:1; min-width:0; }
        .sh-crow-grid{ display:grid; gap:.4rem; grid-template-columns:repeat(auto-fit, minmax(7.5rem, 1fr)); }
        .sh-crow-f{ display:grid; gap:.15rem; }
        .sh-crow-f label{ font-size:.66rem; font-weight:800; letter-spacing:.06em; text-transform:uppercase;
            color:var(--muted,#736E64); }
        .sh-crow-check{ display:flex; align-items:center; gap:.4rem; font-size:.78rem; font-weight:650; }
        .sh-crow-del{ flex:none; }
        /* ---- THE CREW, AND WHAT THEY HOLD -------------------------------
           Rows, not cards. A roster of two hundred cards is a wall; the card
           is what you get when you open ONE of them, which is also the shape
           of the question people actually ask here. */
        .sh-crew{ display:grid; gap:.3rem; }
        .sh-crew-row{ border:1px solid transparent; border-radius:.6rem; transition:border-color .15s ease; }
        .sh-crew-open{ border-color:var(--line,#e5e5e5);
            background:color-mix(in srgb, var(--ink,#1C1A16) 2%, transparent); }
        .sh-crew-head{ display:flex; align-items:center; gap:.7rem; width:100%; text-align:left;
            padding:.55rem .6rem; border:0; background:none; color:inherit; font:inherit; cursor:pointer;
            border-radius:.6rem; }
        .sh-crew-head:hover{ background:color-mix(in srgb, var(--ink,#1C1A16) 4%, transparent); }
        /* The finish, at a glance, down the left edge of the list. This is what
           makes the progression legible as a LIST — a column of colours that
           gets richer towards the top is the whole reward, seen from outside. */
        .sh-crew-swatch{ flex:none; width:1.6rem; height:1.1rem; border-radius:.25rem;
            --sh-face:var(--accent); --sh-rim:rgb(255 255 255 / .22);
            background:linear-gradient(135deg, color-mix(in srgb, var(--sh-face) 92%, #fff 8%),
                       color-mix(in srgb, var(--sh-face) 58%, #000 42%));
            box-shadow:0 0 0 1px var(--sh-rim) inset, 0 1px 2px rgb(0 0 0 / .25); }
        .sh-crew-who{ flex:1; min-width:0; display:grid; gap:.1rem; }
        .sh-crew-name{ font-weight:650; letter-spacing:-.01em; overflow:hidden;
            text-overflow:ellipsis; white-space:nowrap; }
        .sh-crew-sub{ font-size:.75rem; color:var(--muted,#736E64); overflow:hidden;
            text-overflow:ellipsis; white-space:nowrap; }
        .sh-crew-holds{ display:flex; align-items:center; gap:.25rem; flex-shrink:0;
            max-width:min(48%, 18rem); overflow:hidden; }
        .sh-crew-holds .cp-chip{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:9rem; }
        .sh-crew-none{ font-size:.72rem; color:var(--faint,#A8A296); }
        .sh-crew-caret{ width:1rem; height:1rem; flex:none; color:var(--faint,#A8A296);
            transition:transform .18s ease; }
        .sh-crew-open .sh-crew-caret{ transform:rotate(180deg); }
        .sh-crew-body{ display:grid; gap:1rem; padding:.2rem .6rem .8rem; }
        @media (min-width:34rem){ .sh-crew-body{ grid-template-columns:minmax(0,17rem) minmax(0,1fr);
            align-items:start; } }
        .sh-crew-side{ display:grid; gap:.7rem; align-content:start; }
        .sh-crew-list{ list-style:none; margin:0; padding:0; display:grid; gap:.3rem; }
        .sh-crew-list li{ display:flex; align-items:center; gap:.45rem; font-size:.82rem; }
        .sh-crew-list i{ width:.9rem; height:.9rem; flex:none; color:var(--accent); }
        .sh-crew-list b{ font-weight:700; }
        .sh-crew-list em{ margin-left:auto; font-style:normal; font-size:.72rem;
            color:var(--faint,#A8A296); white-space:nowrap; }
        @media (hover:none){ .sh-crew-holds{ display:none; } }
        .sh-off{ text-align:center; padding:2.2rem 1rem; display:grid; gap:.6rem; justify-items:center; }
        .sh-off i{ width:1.7rem; height:1.7rem; color:var(--faint,#A8A296); }
        .sh-off-title{ font-size:1rem; font-weight:800; letter-spacing:-.015em; }
        .sh-off-body{ font-size:.85rem; color:var(--muted,#736E64); max-width:26rem; }
        `);
    }

    /* =====================================================================
     * THE CARD
     *
     * Drawn from whatever is known and never from a placeholder. A pilot who
     * has flown nothing has a card with a zero on it — that is true, and it is
     * the thing the shop is asking them to change. A signed-out visitor gets
     * the same object with nothing claimed on it, because the card IS the
     * advertisement for signing in.
     * =================================================================== */

    /* =====================================================================
     * THE CLUB, ON THE FACE OF THE CARD
     *
     * TWO LADDERS, AND THE CARD SHOWS BOTH.
     *
     * The rank is what the airline CALLS this pilot: a decision somebody made,
     * usually with a check-ride behind it. The club is what their flying has
     * earned them: a line they crossed, applied automatically, that nobody has
     * to remember to award. They are different in kind, every real airline runs
     * both, and printing one in place of the other would lose the half that
     * made the card worth looking at.
     *
     * WHICH CLUB, AND WHAT COLOUR, IS THE SERVER'S DECISION. Only the VA's own
     * ladder knows where its top is and what it is called, so this reads
     * `wallet.club` and draws it. It invents nothing when it is absent: an
     * older server sends a wallet with no club, and the card falls back to the
     * page's accent and names no club, which is exactly the card this was
     * before and much better than a browser guessing at somebody's standing.
     * =================================================================== */

    const clubOf = (w) => (w && w.club && typeof w.club === 'object' ? w.club : null);

    /** The face colour, as an inline custom property. Empty when unknown. */
    function faceStyle(w) {
        const c = clubOf(w);
        // A colour only, and only one this module recognises as one: it lands
        // in a style attribute, and a style attribute is not a place to put a
        // string a server sent without looking at it.
        const hex = c && typeof c.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(c.color.trim())
            ? c.color.trim() : '';
        return hex ? ` style="--sh-face:${esc(hex)}"` : '';
    }

    /** `sh-card-t3`, or nothing. The material, not the colour. */
    function clubClass(w) {
        const c = clubOf(w);
        const at = c ? Math.round(Number(c.index)) : NaN;
        return Number.isFinite(at) && at > 0 ? ` sh-card-t${Math.min(4, at)}` : '';
    }

    /**
     * The line under the airline's name: the rank, and the club.
     *
     * The pips are the half a pilot acts on. The name says which club they are
     * in; the pips say there are more of them, which is the only part of this
     * that makes anybody fly another leg. Drawn only where there IS a ladder to
     * climb — a one-club airline has not made a progression, and a row of empty
     * circles would be a promise nobody there can keep.
     */
    function clubHtml(w) {
        const c = clubOf(w);
        const rank = w && w.rank ? esc(w.rank) : '';
        if (!rank && !c) return '';
        const pips = c && Number(c.of) > 1
            ? `<span class="sh-pips" aria-hidden="true">${Array.from({ length: Number(c.of) }, (_, i) =>
                `<span class="sh-pip${i <= Number(c.index) ? ' sh-pip-on' : ''}"></span>`).join('')}</span>`
            : '';
        const club = c && c.name
            ? `<span class="sh-card-finish">${pips}${esc(c.name)}</span>` : '';
        if (!rank && !club) return '';
        return `<div class="sh-card-tier">${rank}${club}</div>`;
    }

    /**
     * The run, on the card face.
     *
     * Drawn from two weeks up, never from one: "1 week running" on somebody's
     * first flight is not an achievement, it is a description of having flown,
     * and putting it on the card would make the chip mean nothing by the time
     * it means something.
     *
     * A chip and not a second balance. The card already has one big number; this
     * is the smallest thing on it that is still legible at the size a screenshot
     * gets shared at, which is the only size that matters for this card.
     */
    function streakChipHtml(w) {
        const st = w && w.streak;
        const weeks = st ? Math.round(Number(st.weeks) || 0) : 0;
        if (weeks < 2) return '';
        return `<span class="sh-card-streak" title="${weeks} weeks running">
            <i data-lucide="flame"></i>${weeks}w</span>`;
    }

    function cardHtml(wallet, opts) {
        const o = opts || {};
        const w = wallet || null;
        const b = S.brand || {};
        const logo = b.logo && P.safeUrl(b.logo)
            ? `<img class="sh-card-logo" src="${esc(b.logo)}" alt="">` : '';
        const airline = esc(b.name || b.code || 'Crew Center');
        const club = clubHtml(w);
        const name = w && (w.name || w.callsign) ? esc(w.name || w.callsign) : 'Not linked';
        const since = w && w.since
            ? `Member since ${new Date(w.since).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`
            : 'Member';
        const cs = w && w.callsign ? esc(w.callsign) : '';
        return `<div class="sh-card-fit"><div class="sh-card ${w ? 'sh-card-live' : 'sh-card-blank'}${clubClass(w)}"${faceStyle(w)} ${o.interactive === false ? '' : 'data-sh-tilt'}>
            <div class="sh-card-top">
                <div><div class="sh-card-airline">${airline}</div>${club}</div>
                ${logo}
            </div>
            <div class="sh-chip" aria-hidden="true"></div>
            <div class="sh-card-balance">
                <b>${w ? num(w.balance) : '—'}</b><span>${esc(currency().short)}${w && w.balanceNote
                    ? ` ${esc(w.balanceNote)}` : ''}</span>
            </div>
            <div class="sh-card-num">${esc(cardNumber(w))}${streakChipHtml(w)}</div>
            <div class="sh-card-foot">
                <div class="min-w-0">
                    <div class="sh-card-name">${name}${cs && cs !== name ? ` · ${cs}` : ''}</div>
                    <div class="sh-card-since">${esc(since)}</div>
                </div>
                <div class="sh-card-mark"><i data-lucide="plane"></i> Inflight Pay</div>
            </div>
        </div></div>`;
    }

    /**
     * The card, and what belongs beside it.
     *
     * Three places show this — the pilot's home, the shop's own hero, and (as
     * the card alone) the skeleton. Written once so the two that carry facts
     * carry the same ones, in the same order, at the same size.
     */
    function heroHtml(wallet, opts) {
        const o = opts || {};
        const c = currency();
        const stat = (label, v) => `<div class="sh-stat"><b>${num(v)}</b><span>${esc(c.short)} ${esc(label)}</span></div>`;
        const side = [];
        // The goal first: it is the only thing here that says what the balance
        // is FOR, and it is the reason somebody opens this at all.
        if (wallet) side.push(goalHtml(wallet));
        // Deliberately not the balance: that is the biggest thing on the card
        // itself, and printing it twice a centimetre apart reads as a mistake.
        if (wallet) side.push(`<div class="sh-stats">${stat('earned', wallet.earned || 0)}${stat('spent', wallet.spent || 0)}</div>`);
        if (o.cta) side.push(o.cta);
        if (o.note) side.push(`<p class="sh-hero-note">${o.note}</p>`);
        const card = cardHtml(wallet, o.card);
        const rows = side.filter(Boolean);
        if (!rows.length) return `<div class="sh-hero">${card}</div>`;
        return `<div class="sh-hero sh-hero-split">${card}
            <div class="sh-hero-side">${rows.join('')}</div></div>`;
    }

    /**
     * The tilt. A card you can push around with a finger is the difference
     * between a picture of a card and one you own — but it is decoration, so
     * it is bolted on after the markup exists, never depended on, and skipped
     * entirely for a reader who has asked for less movement.
     */
    function wireTilt(scope) {
        if (still()) return;
        scope.querySelectorAll('[data-sh-tilt]').forEach((el) => {
            if (el.dataset.shTilted) return;
            el.dataset.shTilted = '1';
            const reset = () => { el.style.transform = ''; el.style.setProperty('--sh-sheen', '-12%'); };
            const move = (ev) => {
                const r = el.getBoundingClientRect();
                const pt = ev.touches ? ev.touches[0] : ev;
                const x = (pt.clientX - r.left) / r.width;
                const y = (pt.clientY - r.top) / r.height;
                if (x < 0 || x > 1 || y < 0 || y > 1) return reset();
                el.style.transform = `perspective(900px) rotateY(${(x - .5) * 13}deg) rotateX(${(.5 - y) * 10}deg) translateY(-2px)`;
                el.style.setProperty('--sh-sheen', `${(x * 130 - 60).toFixed(1)}%`);
            };
            el.addEventListener('pointermove', move);
            el.addEventListener('pointerleave', reset);
            el.addEventListener('pointercancel', reset);
        });
    }

    /* =====================================================================
     * READING
     * =================================================================== */

    async function load() {
        S.loading = true; S.error = null;
        draw();
        try {
            S.data = await S.api('/shop');
        } catch (err) {
            S.error = err;
        }
        S.loading = false;
        draw();
        repaintCards();
    }

    async function loadOrders() {
        try {
            const d = await S.api('/shop/orders');
            S.orders = Array.isArray(d.orders) ? d.orders : [];
        } catch (err) {
            S.orders = null; S.error = err;
        }
        draw();
    }

    /**
     * The crew, and what they hold.
     *
     * Its own fetch rather than part of /shop: it is a read of the whole
     * roster joined to the whole order table, and a pilot who only ever opens
     * the shelf should not pay for it on every visit. Fetched the first time
     * the tab is opened and kept — a shelf does not change while somebody is
     * looking at it, and re-reading it on every redraw would mean a round trip
     * per expanded row.
     */
    async function loadCrew() {
        try {
            const d = await S.api('/shop/crew');
            S.crew = Array.isArray(d.crew) ? d.crew : [];
        } catch (err) {
            S.crew = null; S.crewError = err;
        }
        draw();
    }

    /* =====================================================================
     * DRAWING
     *
     * One function owns the panel's body, and every state the shop can be in
     * is a branch of it: reading, broken, switched off, and open. Splitting
     * those across handlers is how a panel ends up showing an empty shelf
     * because a fetch failed.
     * =================================================================== */

    function draw() {
        if (!S.panel) return;
        const body = S.panel.body;
        P.keepPlace(body, () => {
            body.innerHTML = bodyHtml();
            try { icons(); } catch (_) {}
            wireTilt(body);
        });
    }

    function bodyHtml() {
        if (S.loading && !S.data) return skeleton();
        if (S.error && !S.data) return errorHtml(S.error);
        if (!S.data) return skeleton();

        const canManage = !!S.data.canManage;
        if (!S.data.enabled) return canManage ? offStaffHtml() : offPilotHtml();

        const tabs = [['shop', 'Shop'], ['clubs', 'Clubs'], ['streak', 'Streak'], ['crew', 'Crew'],
            ['orders', canManage ? 'Orders' : 'My orders']];
        if (canManage) tabs.push(['manage', 'Set up']);
        const tabBar = `<div class="sh-tabs" role="tablist">${tabs.map(([k, label]) =>
            `<button class="sh-tab ${S.view === k ? 'sh-tab-on' : ''}" role="tab"
                aria-selected="${S.view === k}" data-sh-view="${k}">${esc(label)}</button>`).join('')}</div>`;

        let view = '';
        if (S.view === 'orders') view = ordersHtml();
        else if (S.view === 'clubs') view = clubsHtml();
        else if (S.view === 'streak') view = streakHtml();
        else if (S.view === 'crew') view = crewHtml();
        else if (S.view === 'manage' && canManage) view = manageHtml();
        else view = shopHtml();

        return `<div class="sh-wrap">${tabBar}${view}</div>`;
    }

    function skeleton() {
        return `<div class="sh-wrap"><div class="sh-hero">${cardHtml(null, { interactive: false })}</div>
            <p class="cp-note" style="text-align:center">Opening the shop…</p></div>`;
    }

    /**
     * A shop whose backend is not there yet.
     *
     * 409 with a `*_missing` code is the database-behind-the-app case
     * crewPanels already knows how to explain, and it comes with the button
     * that fixes it. A 404 is the same problem seen from one version further
     * back — the route itself is not deployed — so it is told the same way
     * rather than as "That didn't work."
     */
    function errorHtml(err) {
        // A 404 is this crew center's server having no shop routes at all.
        // That is not something the "Update my database" button can fix, and
        // telling it as a schema gap sent VAs chasing a healthy project.
        if (err && err.status === 404) return P.notBuiltHtml('The shop');
        if (P.isSchemaGap(err)) return P.schemaGapHtml(err);
        return `<div class="cp-empty">
            <i data-lucide="triangle-alert"></i>
            ${esc((err && err.message) || 'The shop could not be opened.')}
            <div style="margin-top:.9rem">
                <button class="cp-btn" data-sh-retry>Try again</button>
            </div>
        </div>`;
    }

    /** Off, seen by a pilot. Reachable by a pasted link; never by a tile. */
    function offPilotHtml() {
        return `<div class="sh-off">
            <i data-lucide="store"></i>
            <div class="sh-off-title">No shop here</div>
            <div class="sh-off-body">This airline doesn’t run a shop. Your flying still counts — hours, rank and the standings all work the same.</div>
        </div>`;
    }

    /** Off, seen by an owner: the one screen that turns it on. */
    function offStaffHtml() {
        const c = currency();
        return `<div class="sh-off">
            <i data-lucide="store"></i>
            <div class="sh-off-title">Give your pilots something to fly for</div>
            <div class="sh-off-body">Approved flights start paying ${esc(c.name)}. Pilots get a card with your
                colours on it and spend what they earn on whatever you put on the shelf — liveries, ranks, event
                seats, a slot on the next group flight. You decide the rate and the stock; nobody can spend what
                they have not flown.</div>
            <button class="cp-btn cp-btn-primary" data-sh-enable>
                <i data-lucide="sparkles"></i> Turn the shop on
            </button>
            <div class="cp-note">You can switch it off again at any time — balances are kept.</div>
        </div>`;
    }

    /* ---- The shelves ---------------------------------------------------- */

    function shopHtml() {
        const w = S.data.wallet || null;
        const items = (S.data.items || []).filter((i) => i.active !== false);
        const c = currency();
        const hero = heroHtml(w, {
            note: w ? '' : `Sign in as a pilot of this airline to start earning ${esc(c.name)}.`,
        });

        if (!items.length) {
            return hero + `<div class="cp-empty">
                <i data-lucide="package-open"></i>
                ${S.data.canManage
                    ? 'Nothing on the shelf yet. Add the first thing under “Set up”.'
                    : 'The shelf is empty right now — check back after your staff have stocked it.'}
            </div>`;
        }

        return hero + shelfHtml(items, w);
    }

    /* THE SHELF, IN SECTIONS WHEN THERE ARE SECTIONS TO MAKE.
     *
     * A flat grid is right for six things and a wall for twenty-six. Grouping
     * is opt-in and per item, so a VA that never sets one sees exactly the
     * shelf they always had — and one heading over the whole shelf is noise,
     * so it takes two before any appear. Whatever is left ungrouped collects
     * under a heading at the END: a VA who has sorted half their shelf has not
     * thereby said the other half comes first.
     */
    /** How loudly a thing is drawn. Anything unrecognised — including the
     *  absent value every item saved before tiers existed carries — is an
     *  ordinary tile, which is what those items already were. */
    const tierOf = (i) => (['standard', 'showcase', 'flagship'].indexOf(String((i && i.tier) || '')) !== -1
        ? String(i.tier) : 'standard');

    function shelfHtml(items, wallet) {
        /* THE FLAGSHIPS COME OUT FIRST, AND OUT OF THE GROUPING ENTIRELY.
         *
         * They change the airline rather than the pilot — an aircraft in the
         * fleet, a base, the livery everybody flies — there are never more
         * than a few, and each one is a month of somebody's flying. A tile in
         * a grid cannot carry that, and a heading over them would put them
         * back in the shelf they are deliberately above. So: a band across the
         * top, then the shelf.
         *
         * Sorted cheapest first, unlike the rest, which keeps whatever order
         * the VA gave it: this is a ladder a pilot is reading as "what could I
         * actually get to", and a ladder that starts at the top is a wall. */
        const flag = items.filter((i) => tierOf(i) === 'flagship')
            .slice()
            .sort((a, b) => priceOf(a) - priceOf(b));
        const rest = items.filter((i) => tierOf(i) !== 'flagship');
        const band = flag.length
            ? `<div class="sh-flag-band">${flag.map((i) => flagshipHtml(i, wallet)).join('')}</div>` : '';

        const groups = [];
        rest.forEach((i) => {
            const name = String(i.group || '').trim();
            const at = groups.find((g) => g.name.toLowerCase() === name.toLowerCase());
            if (at) at.items.push(i); else groups.push({ name, items: [i] });
        });
        const grid = (rows) => (rows.length
            ? `<div class="sh-grid">${rows.map((i) => itemHtml(i, wallet)).join('')}</div>` : '');
        if (groups.length < 2 || !groups.some((g) => g.name)) return band + grid(rest);
        groups.sort((a, b) => (a.name ? 0 : 1) - (b.name ? 0 : 1));
        return band + groups.map((g) => `<div class="sh-h" style="margin-top:.4rem">${esc(g.name || 'Everything else')}</div>
            ${grid(g.items)}`).join('');
    }

    /** The shelf item this pilot is flying towards, if they have named one. */
    const goalId = () => String((S.data && S.data.wallet && S.data.wallet.goalItemId) || '');

    /* WHAT THE SHELF HAS TO SAY ABOUT ONE THING, WORKED OUT ONCE.
     *
     * Three tiers draw the same item at three sizes, and every one of them has
     * to answer the same questions: is it on offer, is it sold out, is it shut
     * behind a club, can this pilot afford it, are they saving for it. That is
     * eight branches, and three copies of eight branches is how a shelf ends up
     * saying "Sold out" on a tile and "Buy" on the band above it.
     *
     * So it is computed here and the three renderers only lay it out.
     */
    function itemState(item, wallet) {
        const price = priceOf(item);
        const over = gone(item.availableUntil);
        const out = Number(item.stock) === 0;
        const short = wallet && Number(wallet.balance) < price;
        const sale = onOffer(item);
        const pinned = !!goalId() && goalId() === String(item.id);
        // Early access. The server decides it; this draws what it decided and
        // never works it out, because the buy route enforces the same answer
        // and two copies of a rule is two rules eventually.
        const a = (item.access && typeof item.access === 'object') ? item.access : null;
        const shut = !!(a && a.open === false);

        /* The three things that change the answer to "should I spend twenty
           hours of flying on this", said where the decision is actually made
           rather than one tap further in. */
        const flags = [];
        if (selfClaim(item)) flags.push(`<span class="sh-flag sh-flag-now"><i data-lucide="zap"></i>Instant</span>`);
        if (sale) flags.push(`<span class="sh-flag sh-flag-sale"><i data-lucide="tag"></i>${
            item.saleEndsAt ? `Ends ${esc(relativeText(item.saleEndsAt))}` : 'On offer'}</span>`);
        else if (item.availableUntil && !over) flags.push(`<span class="sh-flag"><i data-lucide="clock"></i>Until ${esc(relativeText(item.availableUntil))}</span>`);
        if (pinned) flags.push(`<span class="sh-flag sh-flag-goal"><i data-lucide="target"></i>Saving for</span>`);
        // "Yours first" while it is theirs; "opens in two days" while it is
        // not. A pilot who cannot have it yet is told when they can and which
        // club would have had it — which is an argument for flying, where a
        // row that simply is not there is indistinguishable from a shelf that
        // is smaller than advertised.
        if (a && a.early) flags.push(`<span class="sh-flag sh-flag-club"><i data-lucide="sparkles"></i>Yours first</span>`);
        else if (shut) flags.push(`<span class="sh-flag sh-flag-wait"><i data-lucide="lock"></i>${a.needs
            ? `${esc(a.needs.name)} first` : 'Not yet'}</span>`);

        let right;
        if (shut) right = `<span class="sh-stock">${a.opensAt
            ? `Opens ${esc(relativeText(a.opensAt))}` : 'Opens soon'}</span>`;
        else if (over) right = `<span class="sh-stock sh-stock-out">Offer over</span>`;
        else if (out) right = `<span class="sh-stock sh-stock-out">Sold out</span>`;
        else if (!wallet) right = `<span class="sh-short">Sign in</span>`;
        else if (short) right = `<span class="sh-short">${num(price - Number(wallet.balance))} ${esc(currency().short)} short</span>`;
        else right = `<button class="cp-btn cp-btn-primary cp-btn-sm sh-buy" data-sh-buy="${esc(item.id)}">Buy</button>`;

        const stock = !out && !over && Number(item.stock) > 0
            ? `<span class="sh-stock">${num(item.stock)} left</span>` : '';

        /* The pin is offered to a pilot who cannot afford this yet, and to one
           who has already pinned it so they can unpin. Never on something they
           could buy right now: "saving for" a thing already in your pocket is
           not a goal, it is a note to go and press Buy. */
        const pin = wallet && !out && !over && !shut && (short || pinned)
            ? `<button type="button" class="sh-pin" data-sh-goal="${esc(item.id)}" aria-pressed="${pinned}"
                title="${pinned ? 'Stop saving for this' : 'Save for this'}"
                aria-label="${pinned ? 'Stop saving for this' : 'Save for this'}"><i data-lucide="${pinned ? 'bookmark-check' : 'bookmark'}"></i></button>`
            : '';

        return { price, over, out, short, sale, pinned, shut, flags, right, stock, pin };
    }

    /**
     * A FLAGSHIP: the whole width of the shelf, above everything else.
     *
     * The only ornament in this file — a gold hairline and a word — and it is
     * here because this is the one row on the shelf where a pilot should be
     * able to tell, without reading, that they are looking at something
     * different in kind from the tiles below it.
     */
    function flagshipHtml(item, wallet) {
        const st = itemState(item, wallet);
        const art = item.image && P.safeUrl(item.image)
            ? `<div class="sh-fl-art"><img src="${esc(item.image)}" alt="" loading="lazy"></div>`
            : `<div class="sh-fl-art"><i data-lucide="${esc(item.icon || 'crown')}"></i></div>`;
        return `<article class="sh-fl${st.shut ? ' sh-item-shut' : ''}">
            ${art}
            <div class="sh-fl-body">
                <span class="sh-fl-kind"><i data-lucide="crown"></i>For the airline</span>
                <div class="sh-fl-name"><span>${esc(item.name || 'Item')}</span>${st.pin}</div>
                ${item.desc ? `<div class="sh-fl-desc">${esc(item.desc)}</div>` : ''}
                ${st.flags.length ? `<div class="sh-flags">${st.flags.join('')}</div>` : ''}
                <div class="sh-fl-foot">
                    <span class="sh-price">${num(st.price)}<small>${esc(currency().short)}</small></span>
                    ${st.sale ? `<span class="sh-was">${num(item.price)}</span>` : ''}
                    ${st.stock}${st.right}
                </div>
            </div>
        </article>`;
    }

    function itemHtml(item, wallet) {
        const art = item.image && P.safeUrl(item.image)
            ? `<div class="sh-item-art"><img src="${esc(item.image)}" alt="" loading="lazy"></div>`
            : `<div class="sh-item-band"><i data-lucide="${esc(item.icon || 'gift')}"></i></div>`;
        const price = priceOf(item);
        const over = gone(item.availableUntil);
        const out = Number(item.stock) === 0;
        const short = wallet && Number(wallet.balance) < price;
        const sale = onOffer(item);
        const pinned = !!goalId() && goalId() === String(item.id);
        // Early access. The server decides it; this draws what it decided and
        // never works it out, because the buy route enforces the same answer
        // and two copies of a rule is two rules eventually.
        const a = (item.access && typeof item.access === 'object') ? item.access : null;
        const shut = !!(a && a.open === false);

        /* The three things that change the answer to "should I spend twenty
           hours of flying on this", said on the tile where the decision is
           actually made rather than one tap further in. */
        const flags = [];
        if (selfClaim(item)) flags.push(`<span class="sh-flag sh-flag-now"><i data-lucide="zap"></i>Instant</span>`);
        if (sale) flags.push(`<span class="sh-flag sh-flag-sale"><i data-lucide="tag"></i>${
            item.saleEndsAt ? `Ends ${esc(relativeText(item.saleEndsAt))}` : 'On offer'}</span>`);
        else if (item.availableUntil && !over) flags.push(`<span class="sh-flag"><i data-lucide="clock"></i>Until ${esc(relativeText(item.availableUntil))}</span>`);
        if (pinned) flags.push(`<span class="sh-flag sh-flag-goal"><i data-lucide="target"></i>Saving for</span>`);
        // "Yours first" while it is theirs; "opens in two days" while it is
        // not. A pilot who cannot have it yet is told when they can and which
        // club would have had it — which is an argument for flying, where a
        // row that simply is not there is indistinguishable from a shelf that
        // is smaller than advertised.
        if (a && a.early) flags.push(`<span class="sh-flag sh-flag-club"><i data-lucide="sparkles"></i>Yours first</span>`);
        else if (shut) flags.push(`<span class="sh-flag sh-flag-wait"><i data-lucide="lock"></i>${a.needs
            ? `${esc(a.needs.name)} first` : 'Not yet'}</span>`);

        let right;
        if (shut) right = `<span class="sh-stock">${a.opensAt
            ? `Opens ${esc(relativeText(a.opensAt))}` : 'Opens soon'}</span>`;
        else if (over) right = `<span class="sh-stock sh-stock-out">Offer over</span>`;
        else if (out) right = `<span class="sh-stock sh-stock-out">Sold out</span>`;
        else if (!wallet) right = `<span class="sh-short">Sign in</span>`;
        else if (short) right = `<span class="sh-short">${num(price - Number(wallet.balance))} ${esc(currency().short)} short</span>`;
        else right = `<button class="cp-btn cp-btn-primary cp-btn-sm sh-buy" data-sh-buy="${esc(item.id)}">Buy</button>`;

        const stock = !out && !over && Number(item.stock) > 0
            ? `<span class="sh-stock">${num(item.stock)} left</span>` : '';

        /* The pin is offered to a pilot who cannot afford this yet, and to one
           who has already pinned it so they can unpin. Never on something they
           could buy right now: "saving for" a thing already in your pocket is
           not a goal, it is a note to go and press Buy. */
        const pin = wallet && !out && !over && !shut && (short || pinned)
            ? `<button type="button" class="sh-pin" data-sh-goal="${esc(item.id)}" aria-pressed="${pinned}"
                title="${pinned ? 'Stop saving for this' : 'Save for this'}"
                aria-label="${pinned ? 'Stop saving for this' : 'Save for this'}"><i data-lucide="${pinned ? 'bookmark-check' : 'bookmark'}"></i></button>`
            : '';

        return `<article class="sh-item${shut ? ' sh-item-shut' : ''}${
            tierOf(item) === 'showcase' ? ' sh-item-showcase' : ''}">
            ${art}
            <div class="sh-item-body">
                ${flags.length ? `<div class="sh-flags">${flags.join('')}</div>` : ''}
                <div class="sh-item-name"><span>${esc(item.name || 'Item')}</span>${pin}</div>
                ${item.desc ? `<div class="sh-item-desc">${esc(item.desc)}</div>` : ''}
                <div class="sh-item-foot">
                    <span class="sh-price">${num(price)}<small>${esc(currency().short)}</small></span>
                    ${sale ? `<span class="sh-was">${num(item.price)}</span>` : ''}
                    ${stock}${right}
                </div>
            </div>
        </article>`;
    }

    /**
     * SAVING FOR.
     *
     * A balance on its own is a score. A balance with a bar under it and the
     * name of the thing beside it is a reason to file another flight, which is
     * the only reason to pay pilots for flying in the first place. Pinned from
     * the shelf, kept on the wallet so it follows a pilot from their phone to
     * their desk, and drawn wherever the card is drawn.
     */
    function goalHtml(wallet) {
        if (!wallet || !wallet.goalItemId) return '';
        const item = (S.data.items || []).find((x) => String(x.id) === String(wallet.goalItemId));
        // A goal pointing at something taken off the shelf is not an error to
        // report, it is a goal that quietly stops existing.
        if (!item || item.active === false || gone(item.availableUntil)) return '';
        const price = priceOf(item);
        if (price <= 0) return '';
        const have = Math.max(0, Number(wallet.balance) || 0);
        const left = Math.max(0, price - have);
        const p = Math.max(0, Math.min(1, have / price));
        return `<div class="sh-goal" style="--sh-g:${p.toFixed(3)}">
            <div class="sh-goal-head">
                <span class="sh-goal-for">Saving for</span>
                <span class="sh-goal-name">${esc(item.name || 'Item')}</span>
            </div>
            <div class="sh-goal-bar"><div class="sh-goal-fill"></div></div>
            <div class="sh-goal-note">${left
                ? `<b>${num(left)} ${esc(currency().short)}</b> to go · ${Math.round(p * 100)}%`
                : '<b>You can buy this now.</b>'}</div>
        </div>`;
    }

    /* =====================================================================
     * INFLIGHT PAY
     *
     * The sheet a purchase happens in. Three states in one element: the offer
     * (card, amount, hold-to-pay), the moment it is being authorised, and the
     * receipt.
     *
     * WHY HOLD AND NOT CLICK
     *
     * Not security — the server is the only thing that can actually spend a
     * balance, and it re-checks the price, the stock and the per-pilot limit
     * whatever this sends. It is that spending something you worked twenty
     * hours for should take a moment longer than dismissing a cookie banner.
     * A press that fills a ring is also the one gesture that tells you it is
     * about to happen while you can still change your mind: let go and it
     * empties.
     *
     * The whole thing is keyboard-reachable: Enter or Space on the button
     * holds it in exactly the same way, and Escape is Cancel.
     * =================================================================== */

    const HOLD_MS = 750;

    function pay(item) {
        const w = S.data && S.data.wallet;
        if (!item || !w) return;
        styles();

        const host = document.createElement('div');
        host.className = 'sh-pay';
        host.setAttribute('role', 'dialog');
        host.setAttribute('aria-modal', 'true');
        host.setAttribute('aria-label', `Pay ${money(item.price)} for ${item.name || 'item'}`);
        host.innerHTML = offerHtml(item, w);
        document.body.appendChild(host);
        P.lockScroll();
        try { icons(); } catch (_) {}
        wireTilt(host);

        let done = false;
        const shut = () => {
            if (done) return;
            done = true;
            document.removeEventListener('keydown', onKey);
            host.remove();
            P.unlockScroll();
        };
        function onKey(ev) {
            if (ev.key === 'Escape') { ev.preventDefault(); shut(); }
        }
        document.addEventListener('keydown', onKey);
        // The sheet rises into place over about a third of a second, and for
        // that third of a second the scrim is still under where the Hold
        // button is about to be. A press aimed at the button that lands a
        // frame early would otherwise dismiss the whole thing — which reads,
        // correctly, as "it cancelled my purchase for no reason". Nothing
        // outside the card counts until it has arrived.
        const openedAt = Date.now();
        host.addEventListener('click', (ev) => {
            if (ev.target.closest('[data-sh-paycancel]') || ev.target.closest('[data-sh-paydone]')) { shut(); return; }
            if (ev.target.classList.contains('sh-pay-scrim') && Date.now() - openedAt > 420) shut();
        });

        wireHold(host, item, shut);
        const btn = host.querySelector('.sh-hold');
        if (btn) btn.focus();
    }

    function offerHtml(item, w) {
        const price = priceOf(item);
        const after = Number(w.balance) - price;
        // What happens next, before it happens. A pilot who knows the thing
        // arrives on the spot presses differently from one who knows they are
        // joining a queue, and both of those are fine as long as they know.
        const how = selfClaim(item)
            ? 'Yours the moment this goes through.'
            : 'Your staff get the order and hand it over.';
        return `<div class="sh-pay-scrim"></div>
            <div class="sh-pay-card">
                <div class="sh-pay-mark"><i data-lucide="plane"></i> Inflight Pay</div>
                ${cardHtml(w)}
                <div class="sh-pay-what">
                    <div class="sh-pay-item">${esc(item.name || 'Item')}</div>
                    <div class="sh-pay-amount">${num(price)} <span style="font-size:.42em;font-weight:700">${esc(currency().short)}</span></div>
                    <div class="sh-pay-after">${num(after)} ${esc(currency().short)} left afterwards</div>
                </div>
                <p class="sh-pay-note">${esc(how)}</p>
                <button class="sh-hold" data-sh-hold>
                    <span class="sh-hold-fill"></span>
                    <span class="sh-hold-label"><i data-lucide="fingerprint"></i> Hold to pay</span>
                </button>
                <button class="sh-cancel" data-sh-paycancel>Cancel</button>
            </div>`;
    }

    /**
     * The press.
     *
     * Driven off requestAnimationFrame rather than a CSS transition with a
     * timeout behind it, because those two disagree the moment the tab is
     * backgrounded mid-press — and the version that disagrees is the one that
     * charges somebody for a purchase they let go of.
     */
    function wireHold(host, item, shut) {
        const btn = host.querySelector('[data-sh-hold]');
        if (!btn) return;
        const fill = host.querySelector('.sh-hold-fill');
        let raf = 0, start = 0, held = false, spent = false;

        const setP = (p) => fill && fill.style.setProperty('--sh-p', String(p));

        const frame = (t) => {
            if (!held) return;
            if (!start) start = t;
            const p = Math.min(1, (t - start) / HOLD_MS);
            setP(p);
            if (p >= 1) { held = false; charge(); return; }
            raf = requestAnimationFrame(frame);
        };
        const begin = (ev) => {
            if (spent || held || btn.disabled) return;
            if (ev && ev.button != null && ev.button !== 0) return;
            held = true; start = 0;
            tap('selection');
            raf = requestAnimationFrame(frame);
        };
        const end = () => {
            if (!held) return;
            held = false; start = 0;
            cancelAnimationFrame(raf);
            setP(0);
        };

        btn.addEventListener('pointerdown', begin);
        btn.addEventListener('pointerup', end);
        btn.addEventListener('pointerleave', end);
        btn.addEventListener('pointercancel', end);
        // Keyboard. A held key repeats, so only the first one starts the fill.
        btn.addEventListener('keydown', (ev) => {
            if ((ev.key === 'Enter' || ev.key === ' ') && !ev.repeat) { ev.preventDefault(); begin(); }
        });
        btn.addEventListener('keyup', (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); end(); }
        });
        // A click that never became a hold must not fall through to anything.
        btn.addEventListener('click', (ev) => ev.preventDefault());

        async function charge() {
            if (spent) return;
            spent = true;
            btn.disabled = true;
            setP(1);
            btn.querySelector('.sh-hold-label').innerHTML = '<span class="cp-spin"></span> Authorising…';
            try {
                const d = await S.api('/shop/orders', { method: 'POST', body: { itemId: item.id } });
                // The server is the only thing that knows what a balance is
                // now; take its word for all of it rather than subtracting the
                // price from what we happened to be holding.
                if (d.wallet && S.data) S.data.wallet = d.wallet;
                if (Array.isArray(d.items) && S.data) S.data.items = d.items;
                else if (S.data) decrementStock(item.id);
                tap('success');
                host.querySelector('.sh-pay-card').innerHTML = receiptHtml(item, d.order || {});
                try { icons(); } catch (_) {}
                S.orders = null;                 // stale the moment this lands
                draw();
                repaintCards();
            } catch (err) {
                tap('error');
                spent = false;
                btn.disabled = false;
                setP(0);
                btn.querySelector('.sh-hold-label').innerHTML = '<i data-lucide="fingerprint"></i> Hold to pay';
                let note = host.querySelector('.sh-pay-bad');
                if (!note) {
                    note = document.createElement('p');
                    note.className = 'sh-pay-note sh-pay-bad';
                    btn.parentNode.insertBefore(note, btn);
                }
                note.textContent = (err && err.message) || 'That did not go through. Nothing was spent.';
                try { icons(); } catch (_) {}
            }
        }
    }

    function decrementStock(id) {
        const it = (S.data.items || []).find((x) => String(x.id) === String(id));
        if (it && Number(it.stock) > 0) it.stock = Number(it.stock) - 1;
    }

    /* Text a VA typed, with any link in it made tappable. Escaped FIRST and
       matched afterwards, so nothing pasted into the box can become markup —
       and only through CrewPanels.safeUrl, which is the same rule every other
       link in the crew centre goes through. */
    function linkify(text) {
        return esc(String(text || '')).replace(/https?:\/\/[^\s<]+/g, (u) => {
            // Punctuation at the end of a sentence is not part of the address.
            const clean = u.replace(/[.,;:!?)\]]+$/, '');
            const tail = u.slice(clean.length);
            if (!P.safeUrl(clean)) return u;
            return `<a href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>${tail}`;
        });
    }

    /**
     * What a self-claimed purchase hands back.
     *
     * The link, the invite, the key — the whole value of what was just bought.
     * It is selectable, it has a copy button, and it is kept on the order for
     * ever: a reward you can only read once is a support request waiting to
     * happen, and "I closed the box" is not a thing a pilot should be able to
     * lose twenty hours of flying to.
     */
    function rewardHtml(reward, heading) {
        if (!reward) return '';
        return `<div class="sh-reward">
            <div class="sh-reward-h">${esc(heading || 'Yours')}</div>
            <div class="sh-reward-body">${linkify(reward)}</div>
            <button type="button" class="cp-btn cp-btn-sm sh-copy" data-sh-copy="${esc(reward)}">
                <i data-lucide="copy"></i> Copy</button>
        </div>`;
    }

    function receiptHtml(item, order) {
        const w = (S.data && S.data.wallet) || {};
        // Three endings, and which one a pilot gets is the server's answer,
        // not this file's guess at it: an order that came back carrying what
        // was bought was fulfilled in the same statement that debited them.
        let tail;
        if (order.reward) tail = rewardHtml(order.reward, 'Yours — keep this');
        else if (order.code) tail = `<div class="sh-code">${esc(order.code)}</div>
            <div class="cp-note">Show this to your staff to collect it.</div>`;
        else tail = '<div class="cp-note">Your staff can see this order now.</div>';
        return `<div class="sh-pay-mark"><i data-lucide="plane"></i> Inflight Pay</div>
            <div class="sh-done">
                <div class="sh-tick"><i data-lucide="check"></i></div>
                <div class="sh-done-title">Paid · ${esc(money(order.price != null ? order.price : priceOf(item)))}</div>
                <div class="cp-note">${esc(item.name || 'Item')} — ${esc(num(w.balance))} ${esc(currency().short)} left</div>
                ${tail}
            </div>
            <button class="cp-btn cp-btn-primary" data-sh-paydone style="width:100%;justify-content:center">Done</button>`;
    }

    /* =====================================================================
     * ORDERS
     *
     * For a pilot: what they have bought and whether it has been handed over.
     * For staff: the queue — because a shop whose orders nobody can see is a
     * shop that takes points and gives nothing back, which is worse than no
     * shop at all.
     * =================================================================== */

    const ORDER_STATE = {
        placed: ['Waiting', 'cp-chip-warn'],
        fulfilled: ['Delivered', 'cp-chip-ok'],
        cancelled: ['Refunded', 'cp-chip-mute'],
    };

    function ordersHtml() {
        if (S.orders === null) {
            loadOrders();
            return `<p class="cp-note" style="text-align:center;padding:2rem 0">Reading your orders…</p>`;
        }
        if (!S.orders.length) {
            return `<div class="cp-empty">
                <i data-lucide="receipt"></i>
                ${S.data.canManage ? 'Nobody has bought anything yet.' : 'You haven’t bought anything yet.'}
            </div>`;
        }
        return `<div class="sh-section">${S.orders.map(orderHtml).join('')}</div>`;
    }

    /* =====================================================================
     * THE CLUBS
     *
     * A VA's second ladder, and the only screen that says what it is FOR.
     *
     * The rank ladder answers "what does this airline call me". The club
     * ladder answers "what has my flying actually got me", and until there is
     * a page that says so, a colour on a card is a mood. So this is the page:
     * every club, where this pilot sits, what each one gives, and how far the
     * next one is.
     *
     * THE NEXT CLUB IS THE POINT. Everything else here is context for one
     * sentence — "38 hours to Gold, and Gold pays 15% more" — because that is
     * the only part of a loyalty scheme that makes anybody fly another leg. It
     * is drawn first, above the ladder, and it is the one thing on this screen
     * that is a number rather than a list.
     *
     * The ladder comes down with the shop (GET /shop carries `clubs`), so
     * opening this tab costs nothing. `S.data.wallet.club` is where the caller
     * stands; a signed-out visitor has no club and is told what the ladder is
     * without being told a claim about themselves.
     * =================================================================== */

    const clubs = () => (S.data && Array.isArray(S.data.clubs) ? S.data.clubs : []);
    const myClub = () => clubOf(S.data && S.data.wallet);
    /** True where any club on this ladder actually gives something. */
    const clubsPay = () => clubs().some((c) => (c.benefits || []).length);

    function clubsHtml() {
        // An older server sends a shop with no `clubs` on it at all. That is a
        // different sentence from "this airline runs none", and telling the
        // second one would have a VA looking for a switch that is not there.
        if (!S.data || !Array.isArray(S.data.clubs)) return P.notBuiltHtml('Clubs');
        const list = clubs();
        if (!list.length) {
            return `<div class="cp-empty"><i data-lucide="medal"></i>
                This airline does not run clubs.</div>`;
        }
        const mine = myClub();
        const staff = S.data.canManage
            ? `<div class="sh-club-staff">
                <p class="cp-note">${clubsPay()
                    ? 'Your pilots see exactly this. Change what each club is worth under Set&nbsp;up.'
                    : 'Your clubs are colours on a card until you give them something. Set what each one is worth under Set&nbsp;up.'}</p>
                <button class="cp-btn cp-btn-sm" data-sh-view="manage"><i data-lucide="settings-2"></i> Set up clubs</button>
            </div>` : '';
        return `${nextClubHtml(mine)}
            <div class="sh-club-list">${list.map((c) => clubRowHtml(c, mine)).join('')}</div>
            ${clubsPay() ? '' : `<p class="cp-note" style="margin-top:.8rem">These clubs are a badge on your
                card for now — your airline has not attached anything to them yet.</p>`}
            ${staff}`;
    }

    /**
     * How far the next club is, and what crossing that line is worth.
     *
     * Drawn from the club the SERVER sent, which carries the next one and its
     * benefits with it — so the sentence and the bar cannot disagree about
     * which club is being talked about.
     *
     * Three states, and they read differently on purpose: climbing (a bar and
     * a number), at the top (an arrival — "you are in the highest club" is not
     * an empty progress bar), and signed out (the ladder, and nothing claimed
     * about anybody).
     */
    function nextClubHtml(mine) {
        if (!mine) {
            return `<p class="cp-note" style="margin-bottom:.9rem">Sign in as a pilot of this
                airline to see which club you are in.</p>`;
        }
        const next = mine.next || null;
        if (!next) {
            return `<div class="sh-club-next sh-club-top">
                <div class="sh-club-next-h"><i data-lucide="crown"></i> You are in ${esc(mine.name)}</div>
                <p class="cp-note">The highest club this airline runs. Nothing left to climb.</p>
            </div>`;
        }
        const hours = Number((S.data.wallet && S.data.wallet.hours) || 0);
        const from = Number(mine.minHours) || 0;
        const to = Number(next.minHours) || 0;
        // Progress across THIS step rather than across the whole ladder: the
        // question is "how close am I to the next one", and a bar measured from
        // zero hours barely moves for somebody three clubs up.
        const pct = to > from ? Math.max(0, Math.min(100, Math.round(((hours - from) / (to - from)) * 100))) : 0;
        const away = Number(next.hoursAway) || 0;
        const gets = (next.benefits || []);
        return `<div class="sh-club-next">
            <div class="sh-club-next-h">
                <b>${esc(hoursText(away))}</b> to ${esc(next.name)}
            </div>
            <div class="sh-club-bar"><span style="width:${pct}%"></span></div>
            <div class="sh-club-next-foot">
                <span class="cp-note">${esc(mine.name)} → ${esc(next.name)}</span>
                <span class="cp-note">${esc(hoursText(hours))} flown</span>
            </div>
            ${gets.length ? `<div class="sh-club-gets">
                <span class="sh-club-gets-h">What ${esc(next.name)} adds</span>
                ${gets.map((b) => `<span class="sh-club-get"><i data-lucide="${esc(BENEFIT_ICON[b.kind] || 'gift')}"></i>${esc(b.label)}</span>`).join('')}
            </div>` : ''}
        </div>`;
    }

    const BENEFIT_ICON = { earn: 'trending-up', early: 'sparkles', priority: 'zap' };

    /** Hours, as a person says them. `38h`, `1,240h`, `half an hour`. */
    function hoursText(h) {
        const n = Number(h) || 0;
        if (n > 0 && n < 1) return `${Math.round(n * 60)} minutes`;
        return `${Math.round(n).toLocaleString()}h`;
    }

    function clubRowHtml(c, mine) {
        const here = mine && mine.key === c.key;
        const past = mine && Number(mine.index) > clubAt(c.key);
        const gets = c.benefits || [];
        return `<div class="sh-club${here ? ' sh-club-here' : ''}${past ? ' sh-club-past' : ''}">
            <span class="sh-club-swatch" style="--sh-face:${esc(hexOr(c.color))}" aria-hidden="true"></span>
            <div class="sh-club-main">
                <div class="sh-club-name">${esc(c.name)}
                    ${here ? '<span class="cp-chip cp-chip-accent">You</span>' : ''}</div>
                <div class="sh-club-at">${c.minHours ? `From ${esc(hoursText(c.minHours))} flown` : 'From your first flight'}</div>
                ${gets.length
                    ? `<div class="sh-club-gets">${gets.map((b) => `<span class="sh-club-get">
                        <i data-lucide="${esc(BENEFIT_ICON[b.kind] || 'gift')}"></i>${esc(b.label)}</span>`).join('')}</div>`
                    : '<div class="sh-club-at">The badge, and the card.</div>'}
            </div>
        </div>`;
    }

    const clubAt = (key) => clubs().findIndex((c) => c.key === key);
    /** A colour we are willing to put in a style attribute, or the page accent. */
    const hexOr = (v) => (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim() : 'var(--accent)');

    /* =====================================================================
     * THE STREAK
     *
     * How many weeks in a row this pilot has flown, and what their airline
     * gives them for it. The third thing flying earns, and the only one that is
     * not a ladder: a rank and a club both go up and stay up, and a streak is
     * the one number on this screen that can go DOWN.
     *
     * WHICH IS THE ENTIRE REASON IT WORKS, and it is also the reason this tab
     * is written the way it is. A thing you can lose needs to tell you, in
     * order: where you stand, whether it is safe, and by when. Everything else
     * — what it is paying, the next milestone, the settings — is context under
     * those three, and a card that opened with "you earn 18% more" would have
     * buried the only sentence a pilot acts on.
     *
     * NOTHING IS COMPUTED HERE. The run, the deadline, the bonus and the next
     * milestone all come down with the shop (GET /shop carries `streaks`, and
     * the wallet carries `streak`), because a streak is derived from the VA's
     * own logbook and a browser guessing at it would guess differently from the
     * approval that pays it. This file draws the answer.
     * =================================================================== */

    const streakSettings = () => (S.data && S.data.streaks) || {};
    const myStreak = () => (S.data && S.data.wallet && S.data.wallet.streak) || null;
    /** True where a streak actually gives a pilot at this airline anything. */
    const streaksPay = () => !!streakSettings().pays;

    /** Weeks, as a person says them — the client half of crewStreaks.weeksText. */
    function weeksText(n) {
        const w = Math.max(0, Math.round(Number(n) || 0));
        if (w === 1) return '1 week';
        if (w === 52) return 'a year';
        if (w === 26) return '6 months';
        if (w === 13) return '3 months';
        if (w && w % 52 === 0) return `${w / 52} years`;
        return `${w} weeks`;
    }

    function streakHtml() {
        // An older server sends a shop with no `streaks` on it at all. That is
        // a different sentence from "this airline pays nothing for one", and
        // telling the second would have a VA looking for a switch that is not
        // there yet.
        if (!S.data || !S.data.streaks) return P.notBuiltHtml('Streaks');
        const mine = myStreak();
        const st = streakSettings();
        const staff = S.data.canManage
            ? `<div class="sh-club-staff">
                <p class="cp-note">${streaksPay()
                    ? 'Your pilots see exactly this. Change what a streak is worth under Set&nbsp;up.'
                    : 'Every pilot already has a streak — it is a fact about their logbook. What it is WORTH is under Set&nbsp;up, and it is nothing until you set it.'}</p>
                <button class="cp-btn cp-btn-sm" data-sh-view="manage"><i data-lucide="settings-2"></i> Set up streaks</button>
            </div>` : '';
        const offer = (st.benefits || []).length
            ? `<div class="sh-club-gets" style="margin-top:.9rem">
                <span class="sh-club-gets-h">What a streak is worth here</span>
                ${st.benefits.map((b) => `<span class="sh-club-get">
                    <i data-lucide="${b.kind === 'milestone' ? 'gift' : 'flame'}"></i>${esc(b.label)}</span>`).join('')}
            </div>`
            : '';
        return `${streakCardHtml(mine)}${offer}${milestoneListHtml(mine)}${staff}`;
    }

    /**
     * Where they stand, whether it is safe, and by when.
     *
     * Four states, and they read differently on purpose:
     *
     *   SIGNED OUT   the offer, and nothing claimed about anybody.
     *   NO RUN       an invitation. "Fly once this week and you are on one" is
     *                a thing somebody can do tonight; an empty progress bar is
     *                a thing that has already failed.
     *   SAFE         flown this week. The deadline is a week further out and
     *                the card is calm about it.
     *   AT RISK      the only loud state in this file, and it is loud because
     *                it is the one piece of genuinely useful bad news the crew
     *                center has: there is something to lose and time to save
     *                it. On leave is NOT this — a pilot who has told their
     *                airline they are away has already done the right thing.
     */
    function streakCardHtml(mine) {
        if (!mine) {
            return `<div class="sh-streak">
                <div class="sh-streak-n"><i data-lucide="flame"></i><b>—</b></div>
                <p class="cp-note">Sign in as a pilot of this airline to see your streak.</p>
            </div>`;
        }
        const weeks = Math.max(0, Math.round(Number(mine.weeks) || 0));
        if (!weeks) {
            return `<div class="sh-streak">
                <div class="sh-streak-n"><i data-lucide="flame"></i><b>0</b><span>weeks running</span></div>
                <p class="sh-streak-line">Fly once this week and you are on a streak. One flight a week keeps it.</p>
                ${mine.longest > 0 ? `<p class="cp-note">Your longest run so far: ${esc(weeksText(mine.longest))}.</p>` : ''}
            </div>`;
        }
        const state = mine.onLeave ? 'leave' : (mine.atRisk ? 'risk' : 'safe');
        const when = mine.endsAt ? whenText(mine.endsAt) : '';
        const line = mine.onLeave
            ? 'Held while you’re on leave. It picks up where you left it.'
            : (mine.atRisk
                ? `Fly once before ${esc(when)} to keep it.`
                : `Safe until ${esc(when)}.`);
        const pct = mine.maxBonus > 0
            ? Math.max(0, Math.min(100, Math.round((Number(mine.bonus) || 0) / mine.maxBonus * 100)))
            : 0;
        return `<div class="sh-streak sh-streak-${state}">
            <div class="sh-streak-n"><i data-lucide="flame"></i><b>${num(weeks)}</b>
                <span>${weeks === 1 ? 'week' : 'weeks'} running</span></div>
            <p class="sh-streak-line">${line}</p>
            ${mine.bonus ? `<div class="sh-streak-pay">
                <div class="sh-club-bar"><span style="width:${pct}%"></span></div>
                <div class="sh-club-next-foot">
                    <span class="cp-note"><b>${mine.bonus}%</b> more on every flight</span>
                    <span class="cp-note">${mine.bonus >= mine.maxBonus
                        ? 'the most a streak pays'
                        : `${mine.nextBonus}% next week · ${mine.maxBonus}% at ${esc(weeksText(mine.capAt))}`}</span>
                </div>
            </div>` : ''}
            <div class="sh-streak-foot">
                <span class="cp-note">Longest: ${esc(weeksText(mine.longest))}</span>
                <span class="cp-note">${num(mine.totalWeeks)} weeks flown in all</span>
            </div>
        </div>`;
    }

    /**
     * The milestones, and how far off the next one is.
     *
     * Drawn as a list with the passed ones dimmed, which is the same shape the
     * club ladder uses and for the same reason: the ones behind you are what
     * make the one ahead mean anything.
     */
    function milestoneListHtml(mine) {
        const list = (streakSettings().milestones || []).filter((m) => m.bonus > 0);
        if (!list.length) return '';
        const weeks = mine ? Math.max(0, Math.round(Number(mine.weeks) || 0)) : -1;
        const c = currency();
        return `<div class="sh-h" style="margin-top:1rem">Milestones</div>
            <div class="sh-club-list">${list.map((m) => {
                const past = weeks >= m.weeks;
                const away = weeks >= 0 ? m.weeks - weeks : null;
                return `<div class="sh-club${past ? ' sh-club-past' : ''}">
                    <span class="sh-club-swatch" style="--sh-face:var(--accent)" aria-hidden="true"></span>
                    <div class="sh-club-main">
                        <div class="sh-club-name">${esc(weeksText(m.weeks))} running
                            ${past ? '<span class="cp-chip">Reached</span>' : ''}</div>
                        <div class="sh-club-at">Pays <b>${num(m.bonus)} ${esc(c.short)}</b> once, on the
                            flight that gets you there.${away != null && away > 0
                                ? ` ${esc(weeksText(away))} to go.` : ''}</div>
                    </div>
                </div>`;
            }).join('')}</div>`;
    }

    /* =====================================================================
     * THE CREW
     *
     * WHY A SHOP HAS A CREW LIST AT ALL
     *
     * Look at what a VA actually sells. A badge on your profile. Your own
     * callsign. A tail number with your name on the fleet page. First pick of
     * the gate. Featured on the website. Every one of those is a thing whose
     * entire value is that OTHER PEOPLE CAN SEE IT — and until now nobody
     * could. A pilot spent twenty hours of flying on a badge and the only
     * person in the airline who knew was them.
     *
     * So this is the other half of the shelf: the same card every pilot holds,
     * the finish their rank has earned, and what they have bought. It is the
     * reason the badge was worth buying.
     *
     * WHAT IT DOES NOT SHOW, and the server enforces all of it rather than
     * trusting this file: no balances, no prices, nobody's receipts, nothing
     * still in the queue. What somebody has left to spend is between them and
     * the airline. See crewShop.publicHolder on the backend.
     *
     * ONE ROW OPEN AT A TIME. A roster of two hundred cards is not a list, it
     * is a wall — so the list is rows, and opening one draws that pilot's card
     * at full size. Which is also the honest shape of the question people ask
     * here, which is about one person at a time.
     * =================================================================== */

    function crewHtml() {
        if (S.crew === null) {
            if (!S.crewError) { loadCrew(); return `<p class="cp-note" style="text-align:center;padding:2rem 0">Reading the crew…</p>`; }
            const err = S.crewError;
            if (err && err.status === 401) {
                return `<div class="cp-empty"><i data-lucide="lock"></i>
                    Sign in as a pilot of this airline to see the crew.</div>`;
            }
            if (P.isSchemaGap(err)) return P.schemaGapHtml(err);
            if (err && err.status === 404) return P.notBuiltHtml('The crew list');
            return `<div class="cp-empty"><i data-lucide="cloud-off"></i>
                ${esc((err && err.message) || 'The crew could not be read.')}</div>`;
        }
        if (!S.crew.length) {
            return `<div class="cp-empty"><i data-lucide="users"></i>
                Nobody on the roster yet.</div>`;
        }
        const holders = S.crew.filter((c) => c.holds && c.holds.length).length;
        const note = holders
            ? `${holders} of ${S.crew.length} ${S.crew.length === 1 ? 'pilot has' : 'pilots have'} something on the shelf.`
            : `Nobody has collected anything yet. Whatever your crew buy shows up here.`;
        return `<p class="cp-note" style="margin-bottom:.7rem">${esc(note)}</p>
            <div class="sh-crew">${S.crew.map(crewRowHtml).join('')}</div>`;
    }

    function crewRowHtml(c) {
        const open = String(S.crewOpen) === String(c.pilotId);
        const holds = c.holds || [];
        // The chips ARE the point of the row. Two at most before it becomes
        // "+3 more": a row that wraps to three lines has stopped being a row,
        // and the whole shelf is one tap away underneath it.
        const chips = holds.slice(0, 2).map((h) =>
            `<span class="cp-chip">${esc(h.name)}${h.count > 1 ? ` ×${h.count}` : ''}</span>`).join('');
        const more = holds.length > 2
            ? `<span class="cp-chip cp-chip-mute">+${holds.length - 2}</span>` : '';
        // The club goes in the row's subtitle beside the rank: this list is
        // where a pilot finds out the clubs are real and that other people are
        // further up them.
        const sub = [c.callsign, c.rank, c.club && c.club.name].filter(Boolean).join(' · ');
        return `<div class="sh-crew-row${open ? ' sh-crew-open' : ''}">
            <button type="button" class="sh-crew-head" data-sh-crew="${esc(c.pilotId)}"
                aria-expanded="${open}">
                <span class="sh-crew-swatch${clubClass(c)}"${faceStyle(c)} aria-hidden="true"></span>
                <span class="sh-crew-who">
                    <span class="sh-crew-name">${esc(c.name || 'A pilot')}${c.isMe
                        ? ' <span class="cp-chip cp-chip-accent">You</span>' : ''}</span>
                    <span class="sh-crew-sub">${esc(sub) || '&nbsp;'}</span>
                </span>
                <span class="sh-crew-holds">${chips}${more}
                    ${holds.length ? '' : '<span class="sh-crew-none">Nothing yet</span>'}</span>
                <i data-lucide="chevron-down" class="sh-crew-caret"></i>
            </button>
            ${open ? crewDetailHtml(c) : ''}
        </div>`;
    }

    /**
     * One pilot, opened: their card, and the whole shelf under it.
     *
     * The card is drawn by the same `cardHtml` the pilot themselves sees, with
     * their own finish on it — that is the whole point, and a second, lesser
     * rendering of a card for "other people" would be a different object.
     * `interactive:false` because a card you can tilt is a card you own.
     */
    function crewDetailHtml(c) {
        const holds = c.holds || [];
        const shelf = holds.length
            ? `<ul class="sh-crew-list">${holds.map((h) => `<li>
                <i data-lucide="check"></i>
                <span>${esc(h.name)}${h.count > 1 ? ` <b>×${h.count}</b>` : ''}</span>
                ${h.since ? `<em>${esc(relativeText(h.since))}</em>` : ''}
            </li>`).join('')}</ul>`
            : `<p class="cp-note">Nothing collected yet.</p>`;
        const earned = Number(c.earned) || 0;
        return `<div class="sh-crew-body">
            ${cardHtml(crewWallet(c), { interactive: false })}
            <div class="sh-crew-side">
                <div class="sh-stats">
                    <div class="sh-stat"><b>${num(c.hours)}</b><span>hours flown</span></div>
                    <div class="sh-stat"><b>${num(earned)}</b><span>${esc(currency().short)} earned</span></div>
                </div>
                ${shelf}
            </div>
        </div>`;
    }

    /**
     * A crew member, in the shape the card draws.
     *
     * `balance` is deliberately absent and the card handles that: it prints the
     * total this pilot has EARNED instead, which is a fact about their flying
     * rather than about their money, and never goes down. What somebody has
     * left to spend is theirs.
     */
    const crewWallet = (c) => ({
        pilotId: c.pilotId,
        name: c.name,
        callsign: c.callsign,
        rank: c.rank,
        club: c.club,
        since: c.since,
        balance: Number(c.earned) || 0,
        // The card prints this word next to the figure. Without it the number
        // would read as a balance, and it is not one — it is what this pilot's
        // flying has earned them, all of it, whatever they have since spent.
        balanceNote: 'earned',
    });

    function orderHtml(o) {
        const [label, chip] = ORDER_STATE[o.status] || ORDER_STATE.placed;
        const who = S.data.canManage && (o.pilotName || o.callsign)
            ? `${esc(o.pilotName || o.callsign)} · ` : '';
        const when = o.createdAt ? relativeText(o.createdAt) : '';
        const actions = S.data.canManage && o.status === 'placed'
            ? `<button class="cp-btn cp-btn-sm cp-btn-primary" data-sh-fulfil="${esc(o.id)}">Delivered</button>
               <button class="cp-btn cp-btn-sm cp-btn-bad" data-sh-refund="${esc(o.id)}">Refund</button>`
            : '';
        // `reward` only ever comes back on the buyer's own orders; staff
        // reading the queue see that one went out, not what the key was.
        return `<div class="sh-order" data-sh-order="${esc(o.id)}">
            <div class="sh-row">
                <div class="sh-row-main">
                    <div class="sh-row-name">${esc(o.itemName || 'Item')}
                        <span class="cp-chip ${chip}" style="margin-left:.35rem">${label}</span></div>
                    <div class="sh-row-sub">${who}${esc(money(o.price))}${when ? ` · ${esc(when)}` : ''}${o.code ? ` · <span style="font-family:ui-monospace,monospace">${esc(o.code)}</span>` : ''}</div>
                </div>
                <div class="sh-row-actions">${actions}</div>
            </div>
            ${o.reward ? rewardHtml(o.reward, 'Yours') : ''}
        </div>`;
    }

    async function reviewOrder(id, action, btn) {
        const doneBtn = P.busy(btn, action === 'fulfil' ? 'Saving…' : false);
        try {
            if (action === 'cancel' && !await P.ask({
                title: 'Refund this order?', danger: true, confirm: 'Refund it',
                body: 'The pilot gets their ' + currency().name + ' back and the order is cancelled.',
            })) return;
            await S.api(`/shop/orders/${encodeURIComponent(id)}`, { method: 'PATCH', body: { action } });
            await loadOrders();
            P.toast(action === 'fulfil' ? 'Marked as delivered.' : 'Refunded.', 'ok');
        } catch (err) {
            P.toast((err && err.message) || 'That didn’t work.', 'bad');
        } finally { doneBtn(); }
    }

    /* =====================================================================
     * THE BACK OFFICE
     *
     * Deliberately one screen and not a section of the settings drawer: a VA
     * running a shop sets the rate once and then only ever touches the shelf.
     * Putting the rate somewhere else would make "how do I add something to
     * the shop" a question with two answers.
     * =================================================================== */

    /* ---- WHAT A FLIGHT IS WORTH -----------------------------------------
     *
     * The shop shipped with four rates: an hour, a landing, a bonus for the
     * airline's own aircraft, and a fine per violation. Three of them are the
     * same sentence — you flew, here is some money — and nothing in the set
     * could say that one flight was worth more to the airline than another.
     *
     * The rest are the levers a VA already wanted and had nowhere to pull: the
     * long haul, its own network, a rostered departure, an event, the route of
     * the week, and landing it clean. Grouped, because ten numbers in one
     * column is a form nobody finishes and three short lists is a screen — and
     * the groups are the honest shape of them anyway. The rate is what flying
     * costs the airline; a bonus is what the airline is asking for.
     *
     * EVERY ONE DEFAULTS TO ZERO on the server, so opening this screen is the
     * only thing that can change what an airline pays.
     */
    const RATE_GROUPS = [
        ['The rate', 'Paid on every approved flight, whatever it was.', [
            ['perHour', 'Per flight hour', 'The main one. A 2-hour flight pays twice this.'],
            ['perLanding', 'Per landing', 'For airlines that fly short legs.'],
            ['per100Nm', 'Per 100 nautical miles', 'For the long haul. A 4,000nm sector pays forty times this.'],
        ]],
        ['Bonuses', 'Paid on top, when the flight was the one you were asking for.', [
            ['fleetBonus', 'Flown in your fleet', 'Added when the aircraft is one of yours.'],
            ['routeBonus', 'On your route network', 'Added when the leg matched a route you published.'],
            ['scheduleBonus', 'A rostered departure', 'Added when they flew a seat they booked on your schedule.'],
            /* EVENTS PAY, AND THEY PAY THROUGH THE FLIGHT.
             *
             * Every VA wants its group flights to be worth turning up to, and
             * the obvious way to do that — a button that hands out points for
             * attendance — is the one thing this economy does not have and
             * must not get. A second supply nobody can audit is how every
             * hand-rolled VA economy has ended up in an argument.
             *
             * So an event pays the same way everything else does: the pilot
             * flies it, files it, a staff member approves it, and the approval
             * carries this on top of the usual rate. Signing up and not flying
             * pays nothing, which is also the honest answer. */
            ['eventBonus', 'Flown for an event', 'Added when the approved flight was for one of your events.'],
            ['featuredBonus', 'The featured route', 'Added for the route of the week, and the route of the day.'],
            ['cleanBonus', 'No violations', 'Added when they got it down clean.'],
        ]],
        ['Taken off', '', [
            ['violationPenalty', 'Per violation', 'Taken off the flight. It never takes a balance a pilot already has.'],
        ]],
    ];

    const RATES = RATE_GROUPS.reduce((all, [, , rows]) => all.concat(rows), []);

    function earn() { return (S.data && S.data.earn) || {}; }

    /* ONE ORDINARY FLIGHT, and the reason the rates mean anything.
     *
     * "perHour: 120" is not a number anybody has a feeling about. "A 2h 15m
     * sector pays 412" is, and it is the only feedback that makes this screen
     * possible to fill in — so it is recomputed under the fields as they are
     * typed rather than after a save.
     *
     * The same leg the SERVER prices (crewShop.exampleFlight), and priced the
     * same way: per line, rounded per line, floored once at the end. Two copies
     * of that arithmetic is two answers eventually, so the server sends its own
     * figure as `unit` on load — this exists for the keystrokes in between, and
     * if the two ever disagree the server is right.
     *
     * It has to exercise the bonuses to be worth printing: an example that
     * ignored six of the ten rates would tell a VA their new distance rate had
     * changed nothing. */
    const EXAMPLE = {
        durationMin: 135, landings: 1, violations: 0,
        inFleet: true, distanceNm: 980, routeId: 'example',
    };
    const EXAMPLE_UNITS = {
        perHour: EXAMPLE.durationMin / 60,
        perLanding: EXAMPLE.landings,
        per100Nm: EXAMPLE.distanceNm / 100,
        fleetBonus: 1,
        routeBonus: 1,
        cleanBonus: 1,
    };

    function examplePay(e) {
        let total = 0;
        for (const [k, units] of Object.entries(EXAMPLE_UNITS)) {
            const rate = Math.max(0, Number((e || {})[k]) || 0);
            if (rate) total += Math.round(rate * units);
        }
        return Math.max(0, Math.round(total));
    }

    /** What the rates above pay for one real, ordinary flight. */
    function exampleHtml() {
        const e = earn();
        const base = examplePay(e);
        const c = currency();
        // The two rates the example flight deliberately does NOT trigger, named
        // rather than folded in: a VA needs to see that an event is worth more
        // than an ordinary leg, and adding both to one figure would hide it.
        const on = [
            ['eventBonus', 'flown for an event'],
            ['featuredBonus', 'the featured route'],
        ].filter(([k]) => Math.round(Number(e[k]) || 0) > 0)
            .map(([k, what]) => `<b>${num(base + Math.round(Number(e[k]) || 0))} ${esc(c.short)}</b> ${esc(what)}`);
        return `<div class="sh-example">A 2h 15m, 980nm flight on your own network, in one of your
            own aircraft, with no violations, pays <b>${num(base)} ${esc(c.short)}</b> when you approve
            it${on.length ? ` — or ${on.join(', or ')}` : ''}.${streakTail(base)}</div>`;
    }

    /* AND WHAT A PILOT ON A RUN WOULD GET FOR IT. Appended to the example
       rather than given a worked example of its own: a streak bonus is a
       percentage of the number immediately to its left, and printing it
       anywhere else would make a VA do the multiplication themselves. */
    function streakTail(base) {
        const st = streakSettings();
        if (!base || !st.maxBonus || !st.perWeek) return '';
        const top = Math.round(base * (1 + st.maxBonus / 100));
        return ` A pilot at the top of a streak gets <b>${num(top)} ${esc(currency().short)}</b> for the same leg.`;
    }

    function manageHtml() {
        if (S.editing) return itemFormHtml();
        const c = currency();
        const e = earn();
        const items = S.data.items || [];
        return `<div class="sh-section">
            <div class="sh-switch">
                <div class="sh-switch-main">
                    <div class="sh-row-name">The shop is on</div>
                    <div class="sh-row-sub">Pilots can see the shelf and spend what they have earned.</div>
                </div>
                <button class="cp-btn cp-btn-sm" data-sh-disable>Turn off</button>
            </div>

            <div class="sh-h" style="margin-top:.5rem">What you call it</div>
            <div class="cp-grid2">
                <label class="cp-label">Name<input class="cp-input" data-sh-cur="name" value="${esc(c.name)}" maxlength="24" placeholder="Miles"></label>
                <label class="cp-label">Short<input class="cp-input" data-sh-cur="short" value="${esc(c.short)}" maxlength="6" placeholder="mi"></label>
            </div>

            <div class="sh-h" style="margin-top:.5rem">What a flight earns</div>
            ${RATE_GROUPS.map(([heading, note, rows]) => `<div class="sh-rateset">
                <div class="sh-rateset-h">${esc(heading)}</div>
                ${note ? `<p class="cp-note">${esc(note)}</p>` : ''}
                ${rows.map(([k, label, hint]) => `<div class="sh-rate">
                    <label for="sh-r-${k}">${esc(label)}<small>${esc(hint)}</small></label>
                    <input id="sh-r-${k}" class="cp-input" type="number" min="0" step="1" inputmode="numeric"
                        data-sh-rate="${k}" value="${Math.max(0, Math.round(Number(e[k]) || 0))}">
                </div>`).join('')}
            </div>`).join('')}
            ${exampleHtml()}
            <div>
                <button class="cp-btn cp-btn-primary" data-sh-saverates>Save the rate</button>
            </div>
            <p class="cp-note">Only approved flights pay, and each one pays once. Changing the rate
                does not re-price flights you have already approved.</p>

            ${clubEditHtml()}
            ${streakEditHtml()}

            <div class="sh-h" style="margin-top:.8rem">On the shelf</div>
            ${items.length ? items.map(manageItemHtml).join('') : '<p class="cp-note">Nothing yet.</p>'}
            <div><button class="cp-btn" data-sh-additem><i data-lucide="plus"></i> Add something</button></div>
            ${suggestHtml()}
        </div>`;
    }

    /* ---- The streak, in the back office ----------------------------------
     *
     * Two percentages and a list. The screen's real job is the same one the
     * club editor's is: the hard part is never the form, it is the blank page —
     * "what should twelve weeks be worth" is where a VA stops. One tap fills
     * every field with a set that climbs, priced against THIS airline's own
     * rates, and it is theirs to edit immediately because nothing is saved
     * until they press Save.
     *
     * EDITED IN PLACE, IN THE DOM, like the clubs above and the rates above
     * those: the milestone list is read back off the fields on save (see
     * readMilestones), so the rows carry no state of their own and typing in
     * one never triggers a redraw. A redraw per keystroke would take the cursor
     * out of the field somebody is in.
     */
    function streakEditHtml() {
        const st = streakSettings();
        const c = currency();
        const rows = st.milestones || [];
        const cap = st.capAt;
        return `<div class="sh-h" style="margin-top:.8rem">Streaks</div>
            <p class="cp-note">A pilot's streak is the number of weeks in a row they have flown at least
                one approved flight. Every pilot already has one — it is counted off their logbook, and
                nothing here turns it on. What these set is what it is <em>worth</em>.</p>
            <div class="cp-grid2">
                <label class="cp-label">Added per week
                    <input class="cp-input" type="number" min="0" max="25" step="1" inputmode="numeric"
                        data-sh-st="perWeek" value="${Math.max(0, Math.round(Number(st.perWeek) || 0))}">
                    <small class="cp-note">Per cent, on every flight. A 6-week streak is five steps.</small>
                </label>
                <label class="cp-label">Never more than
                    <input class="cp-input" type="number" min="0" max="200" step="1" inputmode="numeric"
                        data-sh-st="maxBonus" value="${Math.max(0, Math.round(Number(st.maxBonus) || 0))}">
                    <small class="cp-note">Per cent. ${cap
                        ? `Reached at ${esc(weeksText(cap))} running.`
                        : 'The ceiling the steps climb to.'}</small>
                </label>
            </div>
            <label class="sh-switch" style="margin-top:.4rem">
                <div class="sh-switch-main">
                    <div class="sh-row-name">Leave holds a streak</div>
                    <div class="sh-row-sub">A week a pilot spends on declared leave neither counts nor breaks
                        their run. Off, and leave ends it like any other quiet week.</div>
                </div>
                <input type="checkbox" data-sh-st="freezeOnLeave" ${st.freezeOnLeave === false ? '' : 'checked'}>
            </label>

            <div class="sh-h" style="margin-top:.6rem">Milestones</div>
            <p class="cp-note">A one-off payment, carried by the flight that gets a pilot there. It rides on
                an approved flight like everything else in this shop — there is no button that hands anybody
                ${esc(c.name)}, and there is deliberately no way to add one.</p>
            <div class="sh-cedit">${rows.length
                ? rows.map(milestoneEditRowHtml).join('')
                : '<p class="cp-note">None yet.</p>'}</div>
            <div style="display:flex;gap:.4rem;flex-wrap:wrap">
                <button class="cp-btn cp-btn-primary" data-sh-savestreak><i data-lucide="check"></i> Save the streak</button>
                <button class="cp-btn" data-sh-addms><i data-lucide="plus"></i> Add a milestone</button>
                <button class="cp-btn" data-sh-suggeststreak><i data-lucide="wand-sparkles"></i> Use a sensible set</button>
            </div>
            <p class="cp-note">Changing any of this does not re-price flights you have already approved.</p>`;
    }

    function milestoneEditRowHtml(m) {
        const c = currency();
        return `<div class="sh-crow" data-sh-ms>
            <div class="sh-crow-top">
                <label class="cp-label" style="flex:1;min-width:6rem">Weeks
                    <input class="cp-input" type="number" min="1" max="208" step="1" inputmode="numeric"
                        data-sh-mf="weeks" value="${Math.max(1, Math.round(Number(m.weeks) || 1))}"></label>
                <label class="cp-label" style="flex:1;min-width:6rem">Pays (${esc(c.short)})
                    <input class="cp-input" type="number" min="0" max="100000" step="1" inputmode="numeric"
                        data-sh-mf="bonus" value="${Math.max(0, Math.round(Number(m.bonus) || 0))}"></label>
                <button class="cp-btn cp-btn-sm" data-sh-delms title="Remove this milestone"
                    aria-label="Remove this milestone"><i data-lucide="trash-2"></i></button>
            </div>
        </div>`;
    }

    /**
     * The milestone list, read back off the fields.
     *
     * A blank week or a blank payment is a row somebody started and abandoned,
     * not a milestone at nought weeks — it is dropped rather than saved, which
     * is the same rule readClubs applies to a club with no name.
     */
    function readMilestones(scope) {
        return [...scope.querySelectorAll('[data-sh-ms]')].map((row) => {
            const v = (k) => {
                const el = row.querySelector(`[data-sh-mf="${k}"]`);
                return el ? el.value.trim() : '';
            };
            return { weeks: Math.round(Number(v('weeks')) || 0), bonus: Math.round(Number(v('bonus')) || 0) };
        }).filter((m) => m.weeks > 0 && m.bonus > 0);
    }

    /* ---- The clubs, in the back office ----------------------------------
     *
     * The ladder every VA already has, and the three things a rung can be
     * worth. Every airline on the platform starts with five clubs and nothing
     * attached to them, because a deploy must not start paying a 20% bonus in
     * three hundred airlines that did not ask for one — so this screen's real
     * job is the one button at the bottom of it.
     *
     * "USE A SENSIBLE LADDER" is the same idea as the shelf suggestions above,
     * and it exists for the same reason: the hard part is not the form, it is
     * the blank page. "What should Gold be worth" is where a VA stops. One tap
     * fills every row with a set that climbs, and it is theirs to edit
     * immediately — nothing is saved until they press Save.
     *
     * EDITED IN PLACE, IN THE DOM. The whole ladder is read back off the
     * fields on save (see readClubs), which is why the rows carry no state of
     * their own and typing in one never triggers a redraw. A redraw per
     * keystroke here would take the cursor out of the field somebody is in —
     * the same reason the rate inputs above are read the same way.
     */
    function clubEditHtml() {
        const list = clubs();
        const pays = clubsPay();
        return `<div class="sh-h" style="margin-top:.8rem">Clubs</div>
            <p class="cp-note">A second ladder, climbed by flying rather than by promotion. Every pilot
                is in one from their first flight, and the club they are in is the colour of their card.
                ${pays ? '' : 'They are a badge and nothing else until you give them something below.'}</p>
            <div class="sh-cedit">${list.map(clubEditRowHtml).join('')}</div>
            <div style="display:flex;gap:.4rem;flex-wrap:wrap">
                <button class="cp-btn cp-btn-primary" data-sh-saveclubs><i data-lucide="check"></i> Save the clubs</button>
                <button class="cp-btn" data-sh-addclub><i data-lucide="plus"></i> Add a club</button>
                <button class="cp-btn" data-sh-suggestclubs><i data-lucide="wand-sparkles"></i> Use a sensible ladder</button>
            </div>
            <p class="cp-note">Changing what a club is worth does not re-price flights you have already
                approved. A club with nothing attached is still a badge on the card.</p>`;
    }

    function clubEditRowHtml(c, i) {
        const n = (v) => Math.max(0, Math.round(Number(v) || 0));
        return `<div class="sh-crow" data-sh-club>
            <div class="sh-crow-top">
                <input type="color" data-sh-cf="color" value="${esc(hexOr(c.color) === 'var(--accent)' ? '#4A5568' : hexOr(c.color))}"
                    aria-label="Club colour" style="width:2.2rem;height:2.2rem;padding:0;border:0;background:none">
                <input type="text" class="cp-input" data-sh-cf="name" maxlength="30"
                    value="${esc(c.name || '')}" placeholder="Club name" aria-label="Club name">
                <input type="hidden" data-sh-cf="key" value="${esc(c.key || '')}">
                <button type="button" class="cp-btn cp-btn-sm cp-btn-bad sh-crow-del" data-sh-delclub
                    ${i === 0 ? 'disabled title="Every pilot starts in the first club"' : ''}
                    aria-label="Remove this club"><i data-lucide="trash-2"></i></button>
            </div>
            <div class="sh-crow-grid">
                <div class="sh-crow-f">
                    <label>Hours to reach</label>
                    <input type="number" class="cp-input" data-sh-cf="minHours" min="0" step="1" inputmode="numeric"
                        value="${n(c.minHours)}" ${i === 0 ? 'disabled' : ''}>
                </div>
                <div class="sh-crow-f">
                    <label>Earn bonus %</label>
                    <input type="number" class="cp-input" data-sh-cf="earnBonus" min="0" max="100" step="1" inputmode="numeric"
                        value="${n(c.earnBonus)}">
                </div>
                <div class="sh-crow-f">
                    <label>Early access h</label>
                    <input type="number" class="cp-input" data-sh-cf="earlyHours" min="0" max="336" step="1" inputmode="numeric"
                        value="${n(c.earlyHours)}">
                </div>
                <label class="sh-crow-check">
                    <input type="checkbox" data-sh-cf="priority" ${c.priority ? 'checked' : ''}>
                    Orders first
                </label>
            </div>
        </div>`;
    }

    /**
     * The ladder, read back off the fields.
     *
     * The server bounds every one of these again — see crewClubs.normalizeClubs
     * — so this does no validation beyond sending numbers as numbers. That is
     * deliberate: a browser that decided what a legal bonus was would be a
     * second opinion on a rule the server has to hold anyway.
     */
    function readClubs(scope, { keepBlank = false } = {}) {
        return [...scope.querySelectorAll('[data-sh-club]')].map((row) => {
            const get = (f) => row.querySelector(`[data-sh-cf="${f}"]`);
            const val = (f) => { const el = get(f); return el ? el.value : ''; };
            return {
                key: val('key'),
                name: String(val('name') || '').trim(),
                minHours: Number(val('minHours')) || 0,
                color: val('color'),
                earnBonus: Number(val('earnBonus')) || 0,
                earlyHours: Number(val('earlyHours')) || 0,
                priority: !!(get('priority') && get('priority').checked),
            };
        // Blanks are kept while a row is being ADDED or REMOVED, so the array
        // and the fields on screen stay index-for-index; they are dropped on
        // save, where a club with no name is nothing at all.
        }).filter((c) => keepBlank || c.name);
    }

    async function saveClubs(btn) {
        const rows = readClubs(S.panel.body);
        if (!rows.length) { P.toast('Give at least one club a name.', 'bad'); return; }
        const done = P.busy(btn, false);
        try {
            const d = await S.api('/clubs', { method: 'POST', body: { clubs: rows } });
            // The ladder the SERVER settled on, not the one that was typed: it
            // sorts by hours, floors the bottom rung at zero and clamps every
            // rate, and the editor must show what was actually saved.
            if (S.data) S.data.clubs = Array.isArray(d.clubs) ? d.clubs : S.data.clubs;
            // The card's colour may have just changed under everybody,
            // including the person editing.
            await load();
            P.toast('Clubs saved.', 'ok');
        } catch (err) {
            P.toast((err && err.message) || 'That didn’t work.', 'bad');
        } finally { done(); }
    }

    /** A worked ladder from the server, dropped into the fields unsaved. */
    async function suggestClubs(btn) {
        const done = P.busy(btn, false);
        try {
            const d = await S.api('/clubs/suggested');
            if (S.data && Array.isArray(d.clubs) && d.clubs.length) {
                S.data.clubs = d.clubs;
                draw();
                // Said out loud, because nothing has been written yet and a
                // screen that filled itself in looks like it saved.
                P.toast('Filled in — press Save the clubs to keep it.', 'ok');
            }
        } catch (err) {
            P.toast((err && err.message) || 'That didn’t work.', 'bad');
        } finally { done(); }
    }

    /**
     * One more rung, added to what is on screen rather than to what is saved.
     *
     * Read back off the fields first, so a VA who has typed into three rows and
     * then presses Add does not lose the three.
     */
    function addClub() {
        const rows = readClubs(S.panel.body, { keepBlank: true });
        const top = rows.length ? Math.max(...rows.map((r) => Number(r.minHours) || 0)) : 0;
        rows.push({ key: '', name: 'New club', minHours: top + 250, color: '#4A5568',
            earnBonus: 0, earlyHours: 0, priority: false });
        if (S.data) S.data.clubs = rows.map((r) => ({ ...r, benefits: [] }));
        draw();
    }

    function removeClub(row) {
        const rows = readClubs(S.panel.body, { keepBlank: true });
        const all = [...S.panel.body.querySelectorAll('[data-sh-club]')];
        const at = all.indexOf(row);
        if (at < 0 || at === 0) return;   // the first club is where everybody starts

        rows.splice(at, 1);
        if (S.data) S.data.clubs = rows.map((r) => ({ ...r, benefits: [] }));
        draw();
    }

    /* ---- The streak, saved ----------------------------------------------
     *
     * The same three actions the club editor has, and written the same way for
     * the same reasons: the list is read off the DOM so typing never redraws,
     * the server's answer replaces what was typed so the screen shows what was
     * actually saved, and a suggestion fills the fields without writing
     * anything.
     */
    async function saveStreak(btn) {
        const body = S.panel.body;
        const patch = { milestones: readMilestones(body) };
        body.querySelectorAll('[data-sh-st]').forEach((el) => {
            const k = el.getAttribute('data-sh-st');
            patch[k] = el.type === 'checkbox' ? el.checked : Math.max(0, Math.round(Number(el.value) || 0));
        });
        const done = P.busy(btn, false);
        try {
            const d = await S.api('/streaks', { method: 'POST', body: patch });
            // What the SERVER settled on: it clamps both percentages, drops
            // duplicate weeks and sorts the list, and the editor must show what
            // was saved rather than what was typed.
            if (S.data && d.settings) S.data.streaks = d.settings;
            draw();
            P.toast('Streaks saved.', 'ok');
        } catch (err) {
            P.toast((err && err.message) || 'That didn’t work.', 'bad');
        } finally { done(); }
    }

    /** A worked set from the server, priced in this airline's own flights. */
    async function suggestStreak(btn) {
        const done = P.busy(btn, false);
        try {
            const d = await S.api('/streaks/suggested');
            if (S.data && d.settings) {
                S.data.streaks = d.settings;
                draw();
                // Said out loud, because nothing has been written yet and a
                // screen that filled itself in looks like it saved.
                P.toast('Filled in — press Save the streak to keep it.', 'ok');
            }
        } catch (err) {
            P.toast((err && err.message) || 'That didn’t work.', 'bad');
        } finally { done(); }
    }

    /**
     * One more milestone, added to what is on screen rather than to what is
     * saved — and read back off the fields first, so a VA who has typed into
     * two rows and then presses Add does not lose the two.
     *
     * The suggested week is double the last one, which is roughly the shape of
     * every set of milestones anybody has ever written down.
     */
    function addMilestone() {
        const rows = readMilestones(S.panel.body);
        const top = rows.length ? Math.max(...rows.map((r) => r.weeks)) : 0;
        rows.push({ weeks: Math.min(208, top ? top * 2 : 4), bonus: 0 });
        if (S.data) S.data.streaks = { ...streakSettings(), milestones: rows };
        draw();
    }

    function removeMilestone(row) {
        const rows = readMilestones(S.panel.body);
        const all = [...S.panel.body.querySelectorAll('[data-sh-ms]')];
        const at = all.indexOf(row);
        if (at < 0) return;
        rows.splice(at, 1);
        if (S.data) S.data.streaks = { ...streakSettings(), milestones: rows };
        draw();
    }

    /* ---- Things a virtual airline can actually sell ---------------------
     *
     * The hard part of setting up a shop is not the form, it is the blank
     * page: there is no warehouse, nothing ships, and "what do I even sell"
     * is where a VA stops. So the server sends a dozen answers, priced from
     * this airline's own rates, and tapping one puts it on the shelf as an
     * ordinary item to edit like any other.
     *
     * ALREADY-ADDED ONES STAY VISIBLE, disabled and marked, rather than
     * disappearing. A grid that silently loses a tile every time you tap one
     * makes the remaining ones jump under your finger, and somebody adding
     * four things in a row would be aiming at a moving target. Matched on the
     * name, because that is what a VA sees — rename it and it is theirs, and
     * offering it again is correct.
     */
    function suggestHtml() {
        const sugs = S.data.suggested || [];
        if (!sugs.length) return '';
        const have = new Set((S.data.items || []).map((i) => String(i.name || '').trim().toLowerCase()));
        const groups = [];
        sugs.forEach((sg) => {
            const at = groups.find((g) => g.name === sg.group);
            if (at) at.items.push(sg); else groups.push({ name: sg.group, items: [sg] });
        });
        return `<div class="sh-h" style="margin-top:.8rem">Things you could sell</div>
            <p class="cp-note" style="margin:0">Worked out from the rate you set above. Tap one to put it
                on the shelf, then change the words and the price to suit.</p>
            ${groups.map((g) => `<div class="sh-sug-group">${esc(g.name)}</div>
                <div class="sh-sugs">${g.items.map((sg) => {
                    const added = have.has(String(sg.name || '').trim().toLowerCase());
                    return `<button type="button" class="sh-sug" data-sh-suggest="${esc(sg.id)}"
                        ${added ? 'disabled' : ''} title="${esc(sg.desc || '')}">
                        <i data-lucide="${esc(added ? 'check' : (sg.icon || 'gift'))}"></i>
                        <span class="sh-sug-main">
                            <span class="sh-sug-name">${esc(sg.name)}</span>
                            <span class="sh-sug-price">${added ? 'on the shelf' : money(sg.price)}</span>
                        </span>
                    </button>`;
                }).join('')}</div>`).join('')}`;
    }

    function manageItemHtml(i) {
        const bits = [onOffer(i) ? `${money(i.salePrice)} (was ${money(i.price)})` : money(i.price)];
        if (Number(i.stock) > 0) bits.push(`${num(i.stock)} left`);
        else if (Number(i.stock) === 0) bits.push('sold out');
        else bits.push('unlimited');
        if (i.limitPerPilot) bits.push(`${num(i.limitPerPilot)} per pilot`);
        if (i.group) bits.push(String(i.group));
        // The two facts a VA needs at a glance and would otherwise have to
        // open the item to learn: that it delivers itself, and — the one that
        // actually breaks a shop — that it has run out of codes to deliver.
        const d = deliveryOf(i);
        if (d !== 'staff') bits.push(DELIVERY[d].label.toLowerCase());
        const dry = d === 'codes' && Number(i.codesLeft) === 0;
        return `<div class="sh-row">
            <div class="sh-row-main">
                <div class="sh-row-name">${esc(i.name || 'Item')}${i.active === false ? ' <span class="cp-chip cp-chip-mute">Hidden</span>' : ''}${
                    dry ? ' <span class="cp-chip cp-chip-bad">Out of codes</span>' : ''}${
                    // Only when it is not the ordinary one. A chip on every row
                    // saying "Ordinary" is a column of the word "Ordinary".
                    tierOf(i) !== 'standard'
                        ? ` <span class="cp-chip">${esc(TIER_META[tierOf(i)].label)}</span>` : ''}</div>
                <div class="sh-row-sub">${esc(bits.join(' · '))}</div>
            </div>
            <div class="sh-row-actions">
                <button class="cp-icon-btn" data-sh-edititem="${esc(i.id)}" aria-label="Edit"><i data-lucide="pencil"></i></button>
                <button class="cp-icon-btn" data-sh-delitem="${esc(i.id)}" aria-label="Remove"><i data-lucide="trash-2"></i></button>
            </div>
        </div>`;
    }

    /* ---- One thing on the shelf -----------------------------------------
       An inline form rather than another layer of panel: adding a second item
       is the action a VA takes twenty times in a row on the day they set the
       shop up, and a dialog that has to be opened and dismissed each time is
       what makes that feel like work. */
    /* A date input speaks local days; the server is told an instant. "Until
       Sunday" means the end of Sunday where the VA lives, because a deal that
       expires at midnight on the morning of the day it names is a bug report. */
    const dayEndIso = (v) => {
        if (!v) return '';
        const d = new Date(`${v}T23:59:59`);
        return Number.isNaN(d.getTime()) ? '' : d.toISOString();
    };
    const dayValue = (iso) => {
        const t = at(iso);
        if (t == null) return '';
        const d = new Date(t), pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };

    /** The sections a VA has already used, so the next item can join one. */
    function knownGroups() {
        const seen = [];
        (S.data.items || []).forEach((i) => {
            const g = String(i.group || '').trim();
            if (g && !seen.some((x) => x.toLowerCase() === g.toLowerCase())) seen.push(g);
        });
        (S.data.suggested || []).forEach((sg) => {
            const g = String(sg.group || '').trim();
            if (g && !seen.some((x) => x.toLowerCase() === g.toLowerCase())) seen.push(g);
        });
        return seen;
    }

    function itemFormHtml() {
        const it = S.editing || {};
        const isNew = !it.id;
        const deliv = deliveryOf(it);
        const left = Number(it.codesLeft);
        const groups = knownGroups();
        return `<div class="sh-section">
            <div class="sh-h">${isNew ? 'New item' : 'Editing'}</div>
            <label class="cp-label">Name
                <input class="cp-input" data-sh-f="name" value="${esc(it.name || '')}" maxlength="60" placeholder="A320 Retro livery"></label>
            <label class="cp-label">What it is
                <textarea class="cp-textarea" data-sh-f="desc" maxlength="240"
                    placeholder="Two sentences. What the pilot gets, and anything they need to know.">${esc(it.desc || '')}</textarea></label>

            <div class="cp-label">How it reaches them
                <div class="sh-deliv">${Object.keys(DELIVERY).map((k) => `<button type="button"
                    class="sh-deliv-opt" data-sh-deliv="${k}" aria-pressed="${deliv === k ? 'true' : 'false'}">
                    <i data-lucide="${esc(DELIVERY[k].icon)}"></i>
                    <span><b>${esc(DELIVERY[k].label)}</b><small>${esc(DELIVERY[k].note)}</small></span>
                </button>`).join('')}</div>
            </div>

            <label class="cp-label" data-sh-when="instant" ${deliv === 'instant' ? '' : 'hidden'}>What they get
                <textarea class="cp-textarea" data-sh-f="reward" maxlength="2000" rows="4"
                    placeholder="A link, an invite, a set of instructions. Every buyer sees exactly this.">${esc(it.reward || '')}</textarea></label>
            <p class="cp-note" data-sh-when="instant" ${deliv === 'instant' ? '' : 'hidden'}>Links are made tappable.
                Pilots keep this on the order, so they can come back to it.</p>

            <label class="cp-label" data-sh-when="codes" ${deliv === 'codes' ? '' : 'hidden'}>${isNew ? 'Your codes, one per line' : 'Add more codes, one per line'}
                <textarea class="cp-textarea" data-sh-f="codes" rows="4" placeholder="ABC-123&#10;DEF-456&#10;GHI-789"></textarea></label>
            <p class="cp-note" data-sh-when="codes" ${deliv === 'codes' ? '' : 'hidden'}>
                ${isNew ? 'Each buyer gets the next unused one, and it sells out when they run out.'
                    : `<span class="sh-codes-left ${left === 0 ? 'sh-codes-none' : ''}">${
                        Number.isFinite(left) ? `${num(left)} unused` : 'Codes already saved'}</span> —
                        anything typed here is <b>added</b> to them, never a replacement.`}</p>

            <div class="cp-grid2">
                <label class="cp-label">Price (${esc(currency().short)})
                    <input class="cp-input" type="number" min="0" step="1" inputmode="numeric" data-sh-f="price" value="${Math.max(0, Math.round(Number(it.price) || 0))}"></label>
                <label class="cp-label">Stock
                    <input class="cp-input" type="number" min="-1" step="1" inputmode="numeric" data-sh-f="stock"
                        value="${it.stock == null ? -1 : Math.round(Number(it.stock))}"></label>
            </div>
            <p class="cp-note">Stock of <b>-1</b> means unlimited — a livery or a Discord role does not run out.</p>
            <div class="cp-grid2">
                <label class="cp-label">Limit per pilot
                    <input class="cp-input" type="number" min="0" step="1" inputmode="numeric" data-sh-f="limitPerPilot"
                        value="${Math.max(0, Math.round(Number(it.limitPerPilot) || 0))}"></label>
                <label class="cp-label">Picture (link)
                    <input class="cp-input" data-sh-f="image" value="${esc(it.image || '')}" placeholder="https://…"></label>
            </div>
            <p class="cp-note">A limit of 0 means no limit. Leave the picture empty and it gets a plain tile.</p>

            <div class="cp-label">How loudly it is drawn
                <div class="sh-deliv">${Object.keys(TIER_META).map((k) => `<button type="button"
                    class="sh-deliv-opt" data-sh-tier="${k}" aria-pressed="${tierOf(it) === k ? 'true' : 'false'}">
                    <i data-lucide="${esc(TIER_META[k].icon)}"></i>
                    <span><b>${esc(TIER_META[k].label)}</b><small>${esc(TIER_META[k].note)}</small></span>
                </button>`).join('')}</div>
            </div>
            <p class="cp-note">Most of a shelf is ordinary. Keep <b>showcase</b> for the few things a pilot
                would screenshot, and <b>flagship</b> for the ones that change the airline — those go in a
                band above everything else, so three of them is a shelf and eight is wallpaper.</p>

            <label class="cp-label">Section <span class="cp-note" style="font-weight:400">optional</span>
                <input class="cp-input" data-sh-f="group" list="shGroups" maxlength="40"
                    value="${esc(it.group || '')}" placeholder="Liveries">
                <datalist id="shGroups">${groups.map((g) => `<option value="${esc(g)}"></option>`).join('')}</datalist></label>
            <p class="cp-note">Give two or more things a section and the shelf splits into headed rows.
                Leave them all empty and it stays one grid.</p>

            <div class="sh-h" style="margin-top:.4rem">For a while only</div>
            <div class="cp-grid2">
                <label class="cp-label">Offer price (${esc(currency().short)})
                    <input class="cp-input" type="number" min="0" step="1" inputmode="numeric" data-sh-f="salePrice"
                        value="${it.salePrice == null || it.salePrice === '' ? '' : Math.max(0, Math.round(Number(it.salePrice)))}" placeholder="none"></label>
                <label class="cp-label">Offer ends
                    <input class="cp-input" type="date" data-sh-f="saleEndsAt" value="${esc(dayValue(it.saleEndsAt))}"></label>
            </div>
            <label class="cp-label">On the shelf until
                <input class="cp-input" type="date" data-sh-f="availableUntil" value="${esc(dayValue(it.availableUntil))}"></label>
            <p class="cp-note">An offer price shows the old one struck through and counts down on the tile.
                Both dates run to the end of the day you pick, and both are enforced by the server — not by the
                clock on a pilot's phone.</p>

            <div class="cp-label">Icon
                <div class="sh-icons">${ICONS.map((ic) => `<button type="button" class="sh-icon"
                    data-sh-icon="${esc(ic)}" aria-label="${esc(ic)}"
                    aria-pressed="${(it.icon || 'gift') === ic ? 'true' : 'false'}"><i data-lucide="${esc(ic)}"></i></button>`).join('')}</div>
            </div>
            <p class="cp-note">Shown on the tile when there is no picture.</p>
            <div class="cp-ask-row" style="justify-content:flex-start">
                <button class="cp-btn cp-btn-primary" data-sh-saveitem>${isNew ? 'Put it on the shelf' : 'Save'}</button>
                <button class="cp-btn" data-sh-canceledit>Cancel</button>
            </div>
        </div>`;
    }

    /* The icons offered for an item with no picture.
     *
     * A short, fixed list rather than a free-text field, and rather than all of
     * Lucide. The name goes into a data-lucide attribute that is rendered on a
     * page pilots open, so what a VA may type there is worth keeping to a set
     * somebody chose — and a picker of twelve is a decision, where a picker of
     * fourteen hundred is a search box and a shrug. These are the twelve the
     * suggested catalogue uses, so anything a VA adds from it can be matched by
     * anything they write themselves. */
    const ICONS = ['gift', 'shield', 'radio', 'plane', 'route', 'paintbrush',
        'map-pin', 'ticket', 'users', 'clipboard-check', 'calendar-plus', 'star', 'megaphone',
        // The icons the flagship and showcase suggestions use. Added so a VA
        // who takes one from the catalogue and then edits it can find the icon
        // it arrived with — an editor that cannot represent the thing it is
        // editing silently rewrites it on the first save.
        'plane-takeoff', 'tower-control', 'calendar-heart', 'spray-can', 'palette',
        'crown', 'image', 'type', 'scroll'];

    /* The three sizes a thing is drawn at, in the words a VA reads. The keys
       match TIERS in crewShop.js on the backend, which is where the rule
       actually lives — this is the picker for it, not a second copy of it. */
    const TIER_META = {
        standard: { label: 'Ordinary', icon: 'square', note: 'A tile on the shelf. Most things.' },
        showcase: { label: 'Showcase', icon: 'sparkles', note: 'Twice the width, room for the picture. Things people show off.' },
        flagship: { label: 'Flagship', icon: 'crown', note: 'A band above the shelf. Things that change the airline.' },
    };

    function readForm(scope) {
        const out = {};
        scope.querySelectorAll('[data-sh-f]').forEach((el) => {
            const k = el.getAttribute('data-sh-f');
            if (el.type === 'number') out[k] = Number(el.value);
            else if (el.type === 'date') out[k] = dayEndIso(el.value);
            else out[k] = el.value.trim();
        });
        // Buttons rather than inputs, so neither is in the sweep above. Both
        // are held on S.editing, which is where the form's starting values
        // live anyway.
        out.icon = (S.editing && S.editing.icon) || 'gift';
        out.delivery = deliveryOf(S.editing);
        out.tier = tierOf(S.editing);

        // An empty offer price is "no offer", which is not the same number as
        // free — and a zero here would put the whole shelf on the house.
        if (!(Number(out.salePrice) > 0)) { out.salePrice = null; out.saleEndsAt = out.saleEndsAt || ''; }

        /* CODES ARE ADDED, NEVER REPLACED. The box holds what the VA is
           pasting in now; the ones already in the database have had half of
           them handed out, and a save that sent the whole list would either
           re-issue those or throw the rest away. The server appends. */
        out.codes = String(out.codes || '').split('\n').map((x) => x.trim()).filter(Boolean);

        // Only the fields that belong to the chosen delivery are sent, so
        // flipping between them while writing cannot leave a stale reward on
        // an item that no longer hands one over.
        if (out.delivery !== 'instant') out.reward = '';
        // An empty list is not "append nothing", it is a sentence the server
        // should never have to parse. Not sending it says the same thing and
        // cannot be read as "replace them with none".
        if (out.delivery !== 'codes' || !out.codes.length) delete out.codes;
        return out;
    }

    /* =====================================================================
     * WRITING
     * =================================================================== */

    async function saveSettings(patch, okMsg, btn) {
        const done = P.busy(btn, 'Saving…');
        try {
            const d = await S.api('/shop/settings', { method: 'POST', body: patch });
            // Take the server's version of the settings, not the one just
            // typed: it is the thing that clamps a rate somebody put 1e9 in.
            if (d && typeof d === 'object') S.data = { ...S.data, ...d };
            draw(); repaintCards();
            if (okMsg) P.toast(okMsg, 'ok');
        } catch (err) {
            P.toast((err && err.message) || 'That didn’t save.', 'bad');
        } finally { done(); }
    }

    async function saveItem(scope, btn) {
        const f = readForm(scope);
        if (!f.name) { P.toast('Give it a name.', 'bad'); return; }
        if (!(f.price >= 0)) { P.toast('A price of 0 or more, please.', 'bad'); return; }
        if (f.salePrice != null && !(Number(f.salePrice) < Number(f.price))) {
            P.toast('An offer has to be cheaper than the price.', 'bad'); return;
        }
        if (f.delivery === 'instant' && !f.reward) {
            P.toast('Write what the pilot gets, or let staff hand it over.', 'bad'); return;
        }
        const id = S.editing && S.editing.id;
        if (f.delivery === 'codes' && !(f.codes || []).length && (!id || !Number(S.editing.codesLeft))) {
            P.toast('Paste at least one code.', 'bad'); return;
        }
        const done = P.busy(btn, 'Saving…');
        try {
            await S.api(id ? `/shop/items/${encodeURIComponent(id)}` : '/shop/items',
                { method: id ? 'PATCH' : 'POST', body: f });
            S.editing = null;
            await load();
            P.toast(id ? 'Saved.' : 'It’s on the shelf.', 'ok');
        } catch (err) {
            P.toast((err && err.message) || 'That didn’t save.', 'bad');
        } finally { done(); }
    }

    /* One suggestion, onto the shelf.
     *
     * It goes through the same POST /shop/items as anything a VA types, with
     * the price the server worked out from their rates — so what lands is an
     * ordinary item they own, and nothing downstream has to know it came from
     * a catalogue. The `id` on a suggestion names the catalogue entry and is
     * dropped here rather than sent; the server issues the item's own.
     */
    async function addSuggested(id, btn) {
        const sug = (S.data.suggested || []).find((x) => String(x.id) === String(id));
        if (!sug) return;
        const done = P.busy(btn, false);
        try {
            await S.api('/shop/items', {
                method: 'POST',
                body: {
                    name: sug.name, desc: sug.desc, icon: sug.icon, image: '',
                    price: sug.price, stock: sug.stock,
                    // The catalogue is already sorted into the five shelves a
                    // VA reads it on, so an item added from it arrives in the
                    // section it was offered under rather than in a heap.
                    group: sug.group || '',
                    limitPerPilot: sug.limitPerPilot, active: true,
                },
            });
            await load();
            P.toast('It’s on the shelf.', 'ok');
        } catch (err) {
            P.toast((err && err.message) || 'That didn’t save.', 'bad');
        } finally { done(); }
    }

    /**
     * Pin, or unpin, the thing this pilot is flying towards.
     *
     * Kept on the wallet rather than in this browser, because a pilot files
     * their flights on a phone and reads their card on a laptop, and a goal
     * that only exists on one of them is a goal that keeps disappearing. The
     * wallet that comes back is the server's, like every other balance here.
     */
    async function setGoal(id, btn) {
        const w = S.data && S.data.wallet;
        if (!w) return;
        const next = String(w.goalItemId || '') === String(id) ? '' : String(id);
        const done = P.busy(btn, false);
        try {
            const d = await S.api('/shop/goal', { method: 'POST', body: { itemId: next } });
            S.data.wallet = (d && d.wallet) || { ...w, goalItemId: next };
            tap('selection');
            draw(); repaintCards();
        } catch (err) {
            P.toast((err && err.message) || 'That didn’t save.', 'bad');
        } finally { done(); }
    }

    /* Copy, with the answer on the button itself. A toast for this would be a
       notification about a clipboard, which nobody has ever needed. */
    async function copyReward(btn) {
        const text = btn.getAttribute('data-sh-copy') || '';
        const label = btn.innerHTML;
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
            else throw new Error('no clipboard');
            btn.innerHTML = '<i data-lucide="check"></i> Copied';
            tap('success');
        } catch (_) {
            // A browser that will not copy is not a failure worth a dialog:
            // the text is right there, selectable, and saying so is enough.
            btn.innerHTML = '<i data-lucide="text-cursor"></i> Select it above';
        }
        try { icons(); } catch (_) {}
        setTimeout(() => { btn.innerHTML = label; try { icons(); } catch (_) {} }, 2200);
    }

    async function removeItem(id, btn) {
        const item = (S.data.items || []).find((x) => String(x.id) === String(id));
        const done = P.busy(btn, false);
        try {
            if (!await P.ask({
                title: `Remove ${item ? item.name : 'this item'}?`, danger: true, confirm: 'Remove it',
                body: 'It comes off the shelf. Orders already placed for it are kept.',
            })) return;
            await S.api(`/shop/items/${encodeURIComponent(id)}`, { method: 'DELETE' });
            await load();
            P.toast('Removed.', 'ok');
        } catch (err) {
            P.toast((err && err.message) || 'That didn’t work.', 'bad');
        } finally { done(); }
    }

    /* =====================================================================
     * WIRING
     *
     * One delegated listener on the panel for the whole shop. The body is
     * redrawn wholesale on every change, so a listener per button would be a
     * listener per button per draw.
     * =================================================================== */

    function wire(panel) {
        if (panel.el.dataset.shWired) return;
        panel.el.dataset.shWired = '1';

        panel.el.addEventListener('click', (ev) => {
            const t = ev.target;
            const view = t.closest('[data-sh-view]');
            if (view) { S.view = view.getAttribute('data-sh-view'); S.editing = null; draw(); return; }
            if (t.closest('[data-sh-retry]')) { load(); return; }
            if (t.closest('[data-sh-enable]')) {
                saveSettings({ enabled: true }, 'The shop is open.', t.closest('[data-sh-enable]'));
                return;
            }
            if (t.closest('[data-sh-disable]')) { disable(t.closest('[data-sh-disable]')); return; }

            const buy = t.closest('[data-sh-buy]');
            if (buy) {
                const item = (S.data.items || []).find((x) => String(x.id) === buy.getAttribute('data-sh-buy'));
                if (item) pay(item);
                return;
            }

            // One row open at a time: a second tap on the same pilot closes
            // them, and opening another closes the first. A list where five
            // cards are open at once is the wall this list exists to avoid.
            const crew = t.closest('[data-sh-crew]');
            if (crew) {
                const id = crew.getAttribute('data-sh-crew');
                S.crewOpen = String(S.crewOpen) === String(id) ? '' : id;
                draw();
                return;
            }

            const fulfil = t.closest('[data-sh-fulfil]');
            if (fulfil) { reviewOrder(fulfil.getAttribute('data-sh-fulfil'), 'fulfil', fulfil); return; }
            const refund = t.closest('[data-sh-refund]');
            if (refund) { reviewOrder(refund.getAttribute('data-sh-refund'), 'cancel', refund); return; }

            if (t.closest('[data-sh-savestreak]')) { saveStreak(t.closest('[data-sh-savestreak]')); return; }
            if (t.closest('[data-sh-suggeststreak]')) { suggestStreak(t.closest('[data-sh-suggeststreak]')); return; }
            if (t.closest('[data-sh-addms]')) { addMilestone(); return; }
            const delMs = t.closest('[data-sh-delms]');
            if (delMs) { removeMilestone(delMs.closest('[data-sh-ms]')); return; }

            if (t.closest('[data-sh-saveclubs]')) { saveClubs(t.closest('[data-sh-saveclubs]')); return; }
            if (t.closest('[data-sh-suggestclubs]')) { suggestClubs(t.closest('[data-sh-suggestclubs]')); return; }
            if (t.closest('[data-sh-addclub]')) { addClub(); return; }
            const delClub = t.closest('[data-sh-delclub]');
            if (delClub) { removeClub(delClub.closest('[data-sh-club]')); return; }

            if (t.closest('[data-sh-saverates]')) { saveRates(t.closest('[data-sh-saverates]')); return; }
            if (t.closest('[data-sh-additem]')) { S.editing = {}; draw(); return; }
            const edit = t.closest('[data-sh-edititem]');
            if (edit) {
                S.editing = (S.data.items || []).find((x) => String(x.id) === edit.getAttribute('data-sh-edititem')) || {};
                draw();
                return;
            }
            const del = t.closest('[data-sh-delitem]');
            if (del) { removeItem(del.getAttribute('data-sh-delitem'), del); return; }
            if (t.closest('[data-sh-canceledit]')) { S.editing = null; draw(); return; }
            if (t.closest('[data-sh-saveitem]')) { saveItem(panel.body, t.closest('[data-sh-saveitem]')); return; }

            /* The icon picker. Held on S.editing and the buttons repainted in
               place rather than redrawing the panel: a redraw would throw away
               every other half-typed field in the form. */
            const pick = t.closest('[data-sh-icon]');
            if (pick) {
                const name = pick.getAttribute('data-sh-icon');
                S.editing = { ...(S.editing || {}), icon: name };
                panel.body.querySelectorAll('[data-sh-icon]').forEach((el) => {
                    el.setAttribute('aria-pressed', el.getAttribute('data-sh-icon') === name ? 'true' : 'false');
                });
                return;
            }

            /* The delivery picker, the same way and for the same reason — and
               it shows and hides the two boxes that belong to it rather than
               redrawing, so a VA can read all three descriptions, change their
               mind twice, and still have what they typed. */
            const dpick = t.closest('[data-sh-deliv]');
            if (dpick) {
                const kind = dpick.getAttribute('data-sh-deliv');
                S.editing = { ...(S.editing || {}), delivery: kind };
                panel.body.querySelectorAll('[data-sh-deliv]').forEach((el) => {
                    el.setAttribute('aria-pressed', el.getAttribute('data-sh-deliv') === kind ? 'true' : 'false');
                });
                panel.body.querySelectorAll('[data-sh-when]').forEach((el) => {
                    el.hidden = el.getAttribute('data-sh-when') !== kind;
                });
                return;
            }

            /* The tier picker. Held on S.editing like the icon and the
               delivery, for the same reason: it is a set of buttons rather
               than an input, so readForm's sweep of [data-sh-f] cannot see it,
               and the form's starting values live there anyway. */
            const tpick = t.closest('[data-sh-tier]');
            if (tpick) {
                const kind = tpick.getAttribute('data-sh-tier');
                S.editing = { ...(S.editing || {}), tier: kind };
                panel.body.querySelectorAll('[data-sh-tier]').forEach((el) => {
                    el.setAttribute('aria-pressed', el.getAttribute('data-sh-tier') === kind ? 'true' : 'false');
                });
                return;
            }

            const goal = t.closest('[data-sh-goal]');
            if (goal) { setGoal(goal.getAttribute('data-sh-goal'), goal); return; }

            const copy = t.closest('[data-sh-copy]');
            if (copy) { copyReward(copy); return; }

            const sug = t.closest('[data-sh-suggest]');
            if (sug) { addSuggested(sug.getAttribute('data-sh-suggest'), sug); return; }
        });

        // The worked example under the rates keeps up as they are typed. It is
        // the only feedback that makes "perHour: 120" mean anything.
        panel.el.addEventListener('input', (ev) => {
            const rate = ev.target.matches('[data-sh-rate]');
            // The streak's two percentages feed the same sentence — it ends
            // with what a pilot at the top of a run gets for the same leg — so
            // they repaint it too. Held on S.data rather than redrawn, for the
            // reason every other field on this screen is: a redraw per
            // keystroke takes the cursor out of the field somebody is in.
            const st = !rate && ev.target.matches('[data-sh-st]:not([type=checkbox])');
            if (!rate && !st) return;
            if (rate) {
                if (!S.data.earn) S.data.earn = {};
                S.data.earn[ev.target.getAttribute('data-sh-rate')] = Number(ev.target.value) || 0;
            } else {
                S.data.streaks = { ...streakSettings(),
                    [ev.target.getAttribute('data-sh-st')]: Number(ev.target.value) || 0 };
            }
            const ex = panel.body.querySelector('.sh-example');
            if (ex) ex.outerHTML = exampleHtml();
        });
    }

    function saveRates(btn) {
        const body = S.panel.body;
        const earnPatch = {};
        body.querySelectorAll('[data-sh-rate]').forEach((el) => {
            earnPatch[el.getAttribute('data-sh-rate')] = Math.max(0, Math.round(Number(el.value) || 0));
        });
        const cur = {};
        body.querySelectorAll('[data-sh-cur]').forEach((el) => { cur[el.getAttribute('data-sh-cur')] = el.value.trim(); });
        if (!cur.name) cur.name = 'Points';
        if (!cur.short) cur.short = 'pts';
        saveSettings({ earn: earnPatch, currency: cur }, 'Saved for your crew.', btn);
    }

    async function disable(btn) {
        if (!await P.ask({
            title: 'Turn the shop off?',
            confirm: 'Turn it off',
            body: 'Pilots stop seeing the shelf and stop earning. Balances and orders are kept, so turning it back on picks up where you left off.',
        })) return;
        saveSettings({ enabled: false }, 'The shop is closed.', btn);
    }

    /* =====================================================================
     * THE CARD, ON A PAGE
     *
     * The pilot home shows the card itself rather than a link to it, because
     * a balance you have to go and look for is a balance nobody looks at. The
     * host element is remembered so a purchase made in the panel updates the
     * card on the page behind it.
     * =================================================================== */

    function repaintCards() {
        S.cardHosts = S.cardHosts.filter((h) => h.isConnected);
        S.cardHosts.forEach(paintCard);
    }

    function paintCard(host) {
        if (!S.data || !S.data.enabled) { host.innerHTML = ''; host.classList.add('cp-hidden'); return; }
        host.classList.remove('cp-hidden');
        const w = S.data.wallet || null;
        host.innerHTML = heroHtml(w, {
            cta: `<button class="cp-btn cp-btn-primary" data-sh-open>
                <i data-lucide="store"></i> ${w ? 'Spend it' : 'See the shop'}
            </button>`,
            note: w
                ? `Earned on every flight your staff approve. Spend it on whatever is on the shelf.`
                : `Sign in as a pilot of this airline to start earning ${esc(currency().name)}.`,
        });
        if (!host.dataset.shWired) {
            host.dataset.shWired = '1';
            host.addEventListener('click', (ev) => {
                if (ev.target.closest('[data-sh-open]')) open({ api: S.api, brand: S.brand });
            });
        }
        try { icons(); } catch (_) {}
        wireTilt(host);
    }

    /**
     * Paint the pilot's card into a page.
     *
     * Draws nothing at all — not a spinner, not an empty frame — until the
     * shop's own fetch has landed and said the shop is on. A VA that does not
     * run one must not have a hole in its pilot home where a card would go.
     */
    function mountCard(host, { api, brand } = {}) {
        if (!host || typeof api !== 'function') return;
        styles();
        S.api = api;
        if (brand) S.brand = brand;
        host.classList.add('cp-hidden');
        if (S.cardHosts.indexOf(host) === -1) S.cardHosts.push(host);
        if (S.data) { paintCard(host); return; }
        S.api('/shop').then((d) => {
            S.data = d;
            repaintCards();
        }).catch(() => { /* no shop, no card, no noise */ });
    }

    /* =====================================================================
     * PUBLIC
     * =================================================================== */

    /**
     * Open the shop.
     *
     * `api` is a CrewPanels.api-shaped call, so this never has to know how the
     * page it is on keeps a session. `view` picks the tab — the dashboard's
     * tile opens staff straight onto the shelf they manage.
     */
    function open({ api, brand, view } = {}) {
        if (typeof api !== 'function') { console.warn('crewShop: needs an api function'); return; }
        styles();
        S.api = api;
        if (brand) S.brand = brand;
        if (view) S.view = view;
        if (!S.panel) {
            S.panel = P.sheet({ id: 'crewShop', title: 'Shop', icon: 'store' });
            wire(S.panel);
        }
        S.panel.open();
        draw();
        load();
    }

    window.CrewShop = {
        open,
        close: () => S.panel && S.panel.close(),
        mountCard,
        cardHtml,          // the card, for anything that wants to show one
        isOn: () => !!(S.data && S.data.enabled),
    };
})();
