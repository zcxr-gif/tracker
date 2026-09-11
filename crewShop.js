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

     GET    /shop                    the lot: settings, items, and the caller's
                                     own wallet. Public-ish: signed out gets
                                     the items and no wallet.
     POST   /shop/settings           staff. { enabled, currency, earn }
     POST   /shop/items              staff. one item
     PATCH  /shop/items/<id>         staff
     DELETE /shop/items/<id>         staff
     GET    /shop/orders             staff: everyone's. Pilot: their own.
     POST   /shop/orders             { itemId } → { order, wallet }
     PATCH  /shop/orders/<id>        staff. { action: 'fulfil' | 'cancel' }

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
        .sh-card{ position:relative; width:100%; aspect-ratio:1.586;
            border-radius:1.15rem; overflow:hidden; color:#fff; isolation:isolate;
            background:
                radial-gradient(120% 140% at 12% 4%, color-mix(in srgb, var(--accent) 88%, #fff 12%), transparent 58%),
                radial-gradient(100% 120% at 96% 96%, color-mix(in srgb, var(--accent) 70%, #000 30%), transparent 62%),
                linear-gradient(135deg, color-mix(in srgb, var(--accent) 92%, #000 8%), color-mix(in srgb, var(--accent) 58%, #000 42%));
            box-shadow:0 1px 0 0 rgb(255 255 255 / .22) inset,
                       0 18px 44px -18px color-mix(in srgb, var(--accent) 55%, transparent),
                       0 30px 60px -40px rgb(0 0 0 / .9);
            transition:transform .4s cubic-bezier(.22,1.12,.36,1), box-shadow .4s ease;
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
        /* The sheen. One pass of light across the face, following the pointer
           where there is one and sitting still where there is not. */
        .sh-card::before{
            content:''; position:absolute; inset:-40%; z-index:0; pointer-events:none;
            background:linear-gradient(115deg, transparent 38%, rgb(255 255 255 / .26) 48%,
                       rgb(255 255 255 / .06) 56%, transparent 64%);
            transform:translateX(var(--sh-sheen, -12%)) rotate(4deg);
            transition:transform .5s cubic-bezier(.22,1.12,.36,1);
        }
        /* A fine guilloché — the texture that stops a flat gradient reading as
           a placeholder. Two hairline grids at an angle, at 6% opacity. */
        .sh-card::after{
            content:''; position:absolute; inset:0; z-index:0; pointer-events:none; opacity:.16;
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
            opacity:.72; margin-top:.4cqi; }
        .sh-card-logo{ max-height:8cqi; max-width:24cqi; object-fit:contain; filter:drop-shadow(0 1px 2px rgb(0 0 0 / .35)); }
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
            font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
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
            .sh-card-live:hover{ box-shadow:0 1px 0 0 rgb(255 255 255 / .3) inset,
                0 26px 60px -20px color-mix(in srgb, var(--accent) 65%, transparent),
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
        .sh-hero-facts{ display:flex; flex-wrap:wrap; gap:.35rem .9rem; justify-content:center;
            font-size:.8rem; color:var(--muted,#736E64); }
        .sh-hero-facts b{ color:var(--ink,#1C1A16); }

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
        .sh-item-name{ font-size:.9rem; font-weight:700; letter-spacing:-.01em; }
        .sh-item-desc{ font-size:.78rem; color:var(--muted,#736E64); line-height:1.4; }
        .sh-item-foot{ display:flex; align-items:center; gap:.5rem; margin-top:auto; padding-top:.55rem; }
        .sh-price{ font-size:.95rem; font-weight:800; letter-spacing:-.01em; font-variant-numeric:tabular-nums;
            display:inline-flex; align-items:baseline; gap:.25rem; }
        .sh-price small{ font-size:.66rem; font-weight:700; color:var(--muted,#736E64); letter-spacing:.04em; }
        .sh-buy{ margin-left:auto; }
        .sh-stock{ font-size:.66rem; font-weight:700; letter-spacing:.08em; text-transform:uppercase;
            color:var(--muted,#736E64); }
        .sh-stock-out{ color:#DC2626; }
        .sh-short{ font-size:.66rem; font-weight:700; letter-spacing:.06em; text-transform:uppercase;
            color:var(--muted,#736E64); margin-left:auto; }

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

    function cardHtml(wallet, opts) {
        const o = opts || {};
        const w = wallet || null;
        const b = S.brand || {};
        const logo = b.logo && P.safeUrl(b.logo)
            ? `<img class="sh-card-logo" src="${esc(b.logo)}" alt="">` : '';
        const airline = esc(b.name || b.code || 'Crew Center');
        const tier = w && w.rank ? `<div class="sh-card-tier">${esc(w.rank)}</div>` : '';
        const name = w && (w.name || w.callsign) ? esc(w.name || w.callsign) : 'Not linked';
        const since = w && w.since
            ? `Member since ${new Date(w.since).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`
            : 'Member';
        const cs = w && w.callsign ? esc(w.callsign) : '';
        return `<div class="sh-card-fit"><div class="sh-card ${w ? 'sh-card-live' : 'sh-card-blank'}" ${o.interactive === false ? '' : 'data-sh-tilt'}>
            <div class="sh-card-top">
                <div><div class="sh-card-airline">${airline}</div>${tier}</div>
                ${logo}
            </div>
            <div class="sh-chip" aria-hidden="true"></div>
            <div class="sh-card-balance">
                <b>${w ? num(w.balance) : '—'}</b><span>${esc(currency().short)}</span>
            </div>
            <div class="sh-card-num">${esc(cardNumber(w))}</div>
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

        const tabs = [['shop', 'Shop'], ['orders', canManage ? 'Orders' : 'My orders']];
        if (canManage) tabs.push(['manage', 'Set up']);
        const tabBar = `<div class="sh-tabs" role="tablist">${tabs.map(([k, label]) =>
            `<button class="sh-tab ${S.view === k ? 'sh-tab-on' : ''}" role="tab"
                aria-selected="${S.view === k}" data-sh-view="${k}">${esc(label)}</button>`).join('')}</div>`;

        let view = '';
        if (S.view === 'orders') view = ordersHtml();
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
        if (P.isSchemaGap(err) || (err && err.status === 404)) {
            return P.schemaGapHtml(err && err.status === 404
                ? { message: 'The shop needs your crew center’s database brought up to date.' }
                : err);
        }
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
        const facts = [];
        if (w) {
            facts.push(`<span><b>${num(w.earned || 0)}</b> ${esc(c.short)} earned</span>`);
            facts.push(`<span><b>${num(w.spent || 0)}</b> ${esc(c.short)} spent</span>`);
        }
        const hero = `<div class="sh-hero">
            ${cardHtml(w)}
            ${facts.length ? `<div class="sh-hero-facts">${facts.join('')}</div>` : ''}
            ${!w ? `<p class="cp-note" style="text-align:center">Sign in as a pilot of this airline to start earning ${esc(c.name)}.</p>` : ''}
        </div>`;

        if (!items.length) {
            return hero + `<div class="cp-empty">
                <i data-lucide="package-open"></i>
                ${S.data.canManage
                    ? 'Nothing on the shelf yet. Add the first thing under “Set up”.'
                    : 'The shelf is empty right now — check back after your staff have stocked it.'}
            </div>`;
        }

        return hero + `<div class="sh-grid">${items.map((i) => itemHtml(i, w)).join('')}</div>`;
    }

    function itemHtml(item, wallet) {
        const art = item.image && P.safeUrl(item.image)
            ? `<div class="sh-item-art"><img src="${esc(item.image)}" alt="" loading="lazy"></div>`
            : `<div class="sh-item-band"><i data-lucide="${esc(item.icon || 'gift')}"></i></div>`;
        const out = Number(item.stock) === 0;
        const short = wallet && Number(wallet.balance) < Number(item.price);
        let right;
        if (out) right = `<span class="sh-stock sh-stock-out">Sold out</span>`;
        else if (!wallet) right = `<span class="sh-short">Sign in</span>`;
        else if (short) right = `<span class="sh-short">${num(Number(item.price) - Number(wallet.balance))} ${esc(currency().short)} short</span>`;
        else right = `<button class="cp-btn cp-btn-primary cp-btn-sm sh-buy" data-sh-buy="${esc(item.id)}">Buy</button>`;
        const stock = !out && Number(item.stock) > 0
            ? `<span class="sh-stock">${num(item.stock)} left</span>` : '';
        return `<article class="sh-item">
            ${art}
            <div class="sh-item-body">
                <div class="sh-item-name">${esc(item.name || 'Item')}</div>
                ${item.desc ? `<div class="sh-item-desc">${esc(item.desc)}</div>` : ''}
                <div class="sh-item-foot">
                    <span class="sh-price">${num(item.price)}<small>${esc(currency().short)}</small></span>
                    ${stock}${right}
                </div>
            </div>
        </article>`;
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
        const after = Number(w.balance) - Number(item.price);
        return `<div class="sh-pay-scrim"></div>
            <div class="sh-pay-card">
                <div class="sh-pay-mark"><i data-lucide="plane"></i> Inflight Pay</div>
                ${cardHtml(w)}
                <div class="sh-pay-what">
                    <div class="sh-pay-item">${esc(item.name || 'Item')}</div>
                    <div class="sh-pay-amount">${num(item.price)} <span style="font-size:.42em;font-weight:700">${esc(currency().short)}</span></div>
                    <div class="sh-pay-after">${num(after)} ${esc(currency().short)} left afterwards</div>
                </div>
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

    function receiptHtml(item, order) {
        const w = (S.data && S.data.wallet) || {};
        return `<div class="sh-pay-mark"><i data-lucide="plane"></i> Inflight Pay</div>
            <div class="sh-done">
                <div class="sh-tick"><i data-lucide="check"></i></div>
                <div class="sh-done-title">Paid · ${esc(money(item.price))}</div>
                <div class="cp-note">${esc(item.name || 'Item')} — ${esc(num(w.balance))} ${esc(currency().short)} left</div>
                ${order.code ? `<div class="sh-code">${esc(order.code)}</div>
                    <div class="cp-note">Show this to your staff to collect it.</div>`
                    : `<div class="cp-note">Your staff can see this order now.</div>`}
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

    function orderHtml(o) {
        const [label, chip] = ORDER_STATE[o.status] || ORDER_STATE.placed;
        const who = S.data.canManage && (o.pilotName || o.callsign)
            ? `${esc(o.pilotName || o.callsign)} · ` : '';
        const when = o.createdAt ? relativeText(o.createdAt) : '';
        const actions = S.data.canManage && o.status === 'placed'
            ? `<button class="cp-btn cp-btn-sm cp-btn-primary" data-sh-fulfil="${esc(o.id)}">Delivered</button>
               <button class="cp-btn cp-btn-sm cp-btn-bad" data-sh-refund="${esc(o.id)}">Refund</button>`
            : '';
        return `<div class="sh-row" data-sh-order="${esc(o.id)}">
            <div class="sh-row-main">
                <div class="sh-row-name">${esc(o.itemName || 'Item')}
                    <span class="cp-chip ${chip}" style="margin-left:.35rem">${label}</span></div>
                <div class="sh-row-sub">${who}${esc(money(o.price))}${when ? ` · ${esc(when)}` : ''}${o.code ? ` · <span style="font-family:ui-monospace,monospace">${esc(o.code)}</span>` : ''}</div>
            </div>
            <div class="sh-row-actions">${actions}</div>
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

    const RATES = [
        ['perHour', 'Per flight hour', 'The main one. A 2-hour flight pays twice this.'],
        ['perLanding', 'Per landing', 'For airlines that fly short legs.'],
        ['fleetBonus', 'Fleet bonus', 'Added when the aircraft is one of yours.'],
        ['violationPenalty', 'Violation penalty', 'Taken off per violation on the flight.'],
    ];

    function earn() { return (S.data && S.data.earn) || {}; }

    /** What the rates above pay for one real, ordinary flight. */
    function exampleHtml() {
        const e = earn();
        const hours = 2.25, landings = 1;
        const total = Math.max(0, Math.round(
            (Number(e.perHour) || 0) * hours
            + (Number(e.perLanding) || 0) * landings
            + (Number(e.fleetBonus) || 0)));
        return `<div class="sh-example">A 2h 15m flight in one of your own aircraft pays
            <b>${num(total)} ${esc(currency().short)}</b> when you approve it.</div>`;
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
            ${RATES.map(([k, label, note]) => `<div class="sh-rate">
                <label for="sh-r-${k}">${esc(label)}<small>${esc(note)}</small></label>
                <input id="sh-r-${k}" class="cp-input" type="number" min="0" step="1" inputmode="numeric"
                    data-sh-rate="${k}" value="${Math.max(0, Math.round(Number(e[k]) || 0))}">
            </div>`).join('')}
            ${exampleHtml()}
            <div>
                <button class="cp-btn cp-btn-primary" data-sh-saverates>Save the rate</button>
            </div>
            <p class="cp-note">Only approved flights pay, and each one pays once. Changing the rate
                does not re-price flights you have already approved.</p>

            <div class="sh-h" style="margin-top:.8rem">On the shelf</div>
            ${items.length ? items.map(manageItemHtml).join('') : '<p class="cp-note">Nothing yet.</p>'}
            <div><button class="cp-btn" data-sh-additem><i data-lucide="plus"></i> Add something</button></div>
        </div>`;
    }

    function manageItemHtml(i) {
        const bits = [money(i.price)];
        if (Number(i.stock) > 0) bits.push(`${num(i.stock)} left`);
        else if (Number(i.stock) === 0) bits.push('sold out');
        else bits.push('unlimited');
        if (i.limitPerPilot) bits.push(`${num(i.limitPerPilot)} per pilot`);
        return `<div class="sh-row">
            <div class="sh-row-main">
                <div class="sh-row-name">${esc(i.name || 'Item')}${i.active === false ? ' <span class="cp-chip cp-chip-mute">Hidden</span>' : ''}</div>
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
    function itemFormHtml() {
        const it = S.editing || {};
        const isNew = !it.id;
        return `<div class="sh-section">
            <div class="sh-h">${isNew ? 'New item' : 'Editing'}</div>
            <label class="cp-label">Name
                <input class="cp-input" data-sh-f="name" value="${esc(it.name || '')}" maxlength="60" placeholder="A320 Retro livery"></label>
            <label class="cp-label">What it is
                <textarea class="cp-textarea" data-sh-f="desc" maxlength="240"
                    placeholder="Two sentences. What the pilot gets, and anything they need to know.">${esc(it.desc || '')}</textarea></label>
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
            <div class="cp-ask-row" style="justify-content:flex-start">
                <button class="cp-btn cp-btn-primary" data-sh-saveitem>${isNew ? 'Put it on the shelf' : 'Save'}</button>
                <button class="cp-btn" data-sh-canceledit>Cancel</button>
            </div>
        </div>`;
    }

    function readForm(scope) {
        const out = {};
        scope.querySelectorAll('[data-sh-f]').forEach((el) => {
            const k = el.getAttribute('data-sh-f');
            out[k] = (el.type === 'number') ? Number(el.value) : el.value.trim();
        });
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
        const id = S.editing && S.editing.id;
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

            const fulfil = t.closest('[data-sh-fulfil]');
            if (fulfil) { reviewOrder(fulfil.getAttribute('data-sh-fulfil'), 'fulfil', fulfil); return; }
            const refund = t.closest('[data-sh-refund]');
            if (refund) { reviewOrder(refund.getAttribute('data-sh-refund'), 'cancel', refund); return; }

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
        });

        // The worked example under the rates keeps up as they are typed. It is
        // the only feedback that makes "perHour: 120" mean anything.
        panel.el.addEventListener('input', (ev) => {
            if (!ev.target.matches('[data-sh-rate]')) return;
            if (!S.data.earn) S.data.earn = {};
            S.data.earn[ev.target.getAttribute('data-sh-rate')] = Number(ev.target.value) || 0;
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
        host.innerHTML = `<div class="sh-hero">${cardHtml(w)}
            <button class="cp-btn cp-btn-primary" data-sh-open style="width:100%;justify-content:center">
                <i data-lucide="store"></i> ${w ? 'Spend it' : 'See the shop'}
            </button></div>`;
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
