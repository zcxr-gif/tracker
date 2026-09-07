/* ============================================================================
   crewAircraftImage.js — every aircraft gets a picture. No exceptions.

   THE GUARANTEE, AND WHY IT IS THE WHOLE DESIGN

   A fleet board with a hole in it looks broken in a way a fleet board with no
   pictures at all does not. One aircraft showing a grey box, or a browser's
   broken-image glyph, reads as "this VA's data is wrong" — and the aircraft it
   happens to is usually the interesting one, because the airframes with no
   photo on file are the obscure registrations a VA invented for itself.

   So this module is built around a promise it can actually keep: **there is
   always an image, it is available synchronously, and it can never fail to
   load.** Everything else is an upgrade on top of that.

     tier 3   a silhouette this file DRAWS, as an inline SVG data URI. No
              network, no fetch, no external host, no cache, no failure mode.
              Chosen from the aircraft type where we know it, generic where we
              do not. This is what makes the guarantee true.
     tier 2   the type's own planform, so a 747 does not look like an A320.
              Still tier 3's mechanism — same inline SVG — just a better shape.
     tier 1   a real photograph of the actual airframe, by registration, from
              Planespotters. Best when it exists, absent more often than not,
              and NEVER waited on. It is also the only tier that is somebody
              else's work, so it is the only one that carries a credit — see
              paintCredit below. The name and the link come out of the same
              call as the src, because a picture we are entitled to show and a
              picture we are not are the same bytes with and without them.

   Note the direction. Most image code starts with the good source and falls
   back; this starts with the one that cannot fail and upgrades. That inversion
   is the reason there is no loading flicker, no layout shift and no broken
   image: the <img> is born with a valid src and is only ever REPLACED, never
   emptied.

   WHY NOT THE VENDORED SHAPES

   vendor/aircraft-shapes carries 182 real top-view planforms and the map uses
   them. They are GPL-3.0 and they are rasterised into a canvas atlas by
   aircraftShapes.js — a pipeline built for map markers at device resolution,
   not for an <img> in a list. Reusing it here would mean either loading the
   atlas machinery on a page that has no map, or fetching individual SVGs over
   the network, which puts a failure mode back into the one place this module
   exists to remove it from. The silhouettes below are drawn here, are mine, and
   are perhaps a tenth of the artwork — which is the correct trade for a
   thumbnail that must never not render.

   USAGE

       CrewAircraftImage.src({ registration, type })   -> a src, always
       CrewAircraftImage.img({ registration, type })   -> a full <img> tag
       CrewAircraftImage.creditSlot({ registration })  -> the hidden credit line
       CrewAircraftImage.upgrade(rootEl)               -> swap in real photos,
                                                          and say who took them

   `img()` returns markup safe to drop into any innerHTML. `upgrade()` is
   optional and idempotent: call it after painting and any airframe with a photo
   on file quietly gains one.
   ========================================================================== */

(function () {
    'use strict';

    /* ---------------------------------------------------------------------
     * Type → silhouette
     *
     * Matched on the canonical Infinite Flight type name the backend resolved
     * ("Boeing 787-10 Dreamliner", "Airbus A320-200"). Keyword order matters:
     * the first hit wins, so the specific patterns come before the general
     * ones — "747" before "Boeing", "A380" before "A3".
     * ------------------------------------------------------------------- */
    const SHAPES = [
        [/a380|747|a340|380|340/i, 'quad'],
        [/787|777|a350|a330|767|a300|a310|md-?11|dc-?10|350|330/i, 'wide'],
        [/737|a320|a319|a321|a318|757|md-?8|md-?9|717|727|707|dc-?9/i, 'narrow'],
        [/crj|erj|embraer|e-?jet|dash|q400|atr|saab|dornier|f-?50|regional/i, 'regional'],
        [/c-?130|c-?17|kc-?|a400|globemaster|hercules/i, 'quad'],
        [/f-?1[456]|f-?22|f-?18|f-?35|fighter|eurofighter|tornado|hawk|jet ?trainer|a-?10/i, 'fighter'],
        [/spitfire|cessna|c-?172|c-?152|piper|cub|xcub|sr-?22|tbm|caravan|208|172|light/i, 'ga'],
        [/heli|ec-?135|as-?350|uh-?|ah-?|bell|copter/i, 'heli'],
    ];

    /**
     * Which silhouette to draw. 'wide' is the default rather than 'narrow'
     * because an unrecognised type in a VA's fleet is more often a large
     * aircraft than a small one, and a widebody outline reads as "an airliner"
     * to a glancing eye in a way a Cessna does not.
     */
    function shapeFor(type) {
        const name = String((type && (type.name || type)) || '');
        if (!name) return 'wide';
        for (const [re, shape] of SHAPES) if (re.test(name)) return shape;
        return 'wide';
    }

    /* ---------------------------------------------------------------------
     * The silhouettes
     *
     * Top-view planforms, drawn on a 120×72 viewBox, nose left. Deliberately
     * simple: at the size these render (a 40–64px thumbnail) detail is noise,
     * and what a reader is actually decoding is the wing planform and the
     * engine count. Those two are what each path gets right.
     * ------------------------------------------------------------------- */
    const PATHS = {
        narrow:
            'M8 36 L30 33 L52 33 L58 20 L64 20 L62 33 L84 32 L96 26 L100 27 L96 34 '
            + 'L106 35 L112 36 L106 37 L96 38 L100 45 L96 46 L84 40 L62 39 L64 52 L58 52 L52 39 L30 39 Z',
        wide:
            'M6 36 L26 32 L48 32 L54 16 L62 16 L60 32 L82 31 L96 24 L102 25 L97 34 '
            + 'L110 35 L116 36 L110 37 L97 38 L102 47 L96 48 L82 41 L60 40 L62 56 L54 56 L48 40 L26 40 Z',
        quad:
            'M6 36 L24 32 L46 32 L50 14 L60 14 L58 32 L80 31 L96 22 L104 23 L98 34 '
            + 'L112 35 L118 36 L112 37 L98 38 L104 49 L96 50 L80 41 L58 40 L60 58 L50 58 L46 40 L24 40 Z '
            + 'M52 22 L58 22 L57 27 L51 27 Z M52 45 L58 45 L57 50 L51 50 Z',
        regional:
            'M14 36 L34 34 L56 34 L62 24 L68 24 L66 34 L86 33 L96 29 L99 30 L96 35 '
            + 'L104 36 L108 36 L104 37 L96 38 L99 42 L96 43 L86 39 L66 38 L68 48 L62 48 L56 38 L34 38 Z',
        fighter:
            'M18 36 L44 34 L58 22 L66 22 L64 34 L84 33 L98 30 L102 32 L104 36 '
            + 'L102 40 L98 42 L84 39 L64 38 L66 50 L58 50 L44 38 Z',
        ga: 'M22 36 L40 34 L48 22 L54 22 L52 34 L78 33 L92 32 L96 34 L98 36 L96 38 '
            + 'L92 40 L78 39 L52 38 L54 50 L48 50 L40 38 Z',
        heli:
            'M30 36 L44 33 L74 33 L88 34 L96 36 L88 38 L74 39 L44 39 Z '
            + 'M14 35.4 L106 35.4 L106 36.6 L14 36.6 Z M56 20 L60 20 L60 52 L56 52 Z',
    };

    /* ---------------------------------------------------------------------
     * Colour
     *
     * Derived from the registration so an airframe keeps the same tile every
     * time anybody looks at it — recognisable, and stable across reloads and
     * across pilots. Hues are spread over the full wheel but held to a
     * restrained saturation so a fleet of forty does not read as a paint chart.
     *
     * Nothing here reads the page's theme. These tiles sit on both the light
     * and dark crew center, so the silhouette is drawn light-on-tint at a
     * contrast that works on either.
     * ------------------------------------------------------------------- */
    function hash(str) {
        let h = 2166136261;
        const s = String(str || '');
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return Math.abs(h);
    }

    function tint(seed) {
        const h = hash(seed) % 360;
        return { bg: `hsl(${h} 42% 34%)`, fg: `hsl(${h} 55% 88%)` };
    }

    /**
     * The silhouette, as a data URI.
     *
     * `encodeURIComponent` rather than base64: the SVG is small, the encoded
     * form is smaller than base64, and it stays readable in devtools — which
     * matters the first time somebody wonders where a picture came from.
     *
     * No external references of any kind. That is what makes this tier
     * incapable of failing: there is nothing to fetch, so there is nothing to
     * 404, block, time out or taint a canvas.
     */
    function silhouette({ registration, type } = {}) {
        const shape = shapeFor(type);
        const { bg, fg } = tint(registration || (type && type.name) || shape);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 72" width="120" height="72">`
            + `<rect width="120" height="72" fill="${bg}"/>`
            + `<path d="${PATHS[shape] || PATHS.wide}" fill="${fg}" fill-opacity="0.92"/>`
            + `</svg>`;
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }

    /* ---------------------------------------------------------------------
     * Real photographs
     *
     * Planespotters, by registration, same source aircraftPhoto.js uses for
     * the search card and the pilot profile. Kept at arm's length on purpose:
     *
     *   · never awaited by anything that renders
     *   · a miss is CACHED, so forty airframes with no photo cost forty
     *     lookups once and nothing thereafter
     *   · a failure is a miss, not an error
     *
     * A VA's fleet is mostly invented registrations, so the honest expectation
     * is that most of these miss. That is fine — it is an upgrade path, not a
     * dependency.
     * ------------------------------------------------------------------- */
    const PHOTO_API = 'https://api.planespotters.net/pubapi/v1/photos/reg/';
    const photos = new Map();          // REG -> Promise<{src, by, link}|null>

    // A registration real enough to be worth asking about. A VA's fleet is
    // full of placeholders, and "N/A", "TBD" or a bare number are not
    // registrations — asking about them spends a request to be told nothing.
    const askable = (reg) => /^[A-Z0-9]{2,3}-?[A-Z0-9]{2,5}$/i.test(String(reg || '').trim());

    /**
     * A photograph of this airframe, AND WHO TOOK IT.
     *
     * The photographer's name and the link back are not extra fields to use if
     * a caller feels like it. Planespotters' public API is free to read on the
     * condition that its photographers are credited, so a src fetched without
     * the name beside it is a src we are not entitled to display. They travel
     * together, out of one function, so there is no way to take the picture
     * and leave the credit behind.
     *
     * Resolves to null on any miss — no photo on file, offline, a 500, a
     * placeholder registration. A miss is CACHED, so forty airframes with no
     * photo cost forty lookups once and nothing thereafter.
     */
    function photoFor(registration) {
        const reg = String(registration || '').trim().toUpperCase();
        if (!reg || !askable(reg)) return Promise.resolve(null);
        if (photos.has(reg)) return photos.get(reg);
        const p = fetch(`${PHOTO_API}${encodeURIComponent(reg)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => {
                const first = j && Array.isArray(j.photos) ? j.photos[0] : null;
                if (!first) return null;
                const src = (first.thumbnail_large && first.thumbnail_large.src)
                    || (first.thumbnail && first.thumbnail.src) || '';
                if (!src) return null;
                return {
                    src,
                    by: String(first.photographer || '').trim(),
                    // Only ever an https link, and only ever to a page. This
                    // string ends up in an href.
                    link: /^https:\/\//i.test(String(first.link || '')) ? String(first.link) : '',
                };
            })
            .catch(() => null);       // a miss, not an error
        photos.set(reg, p);
        return p;
    }

    /** How a credit reads. One place, so the wording cannot drift between the
     *  tooltip and the visible line. */
    function creditLine(photo) {
        if (!photo) return '';
        return photo.by ? `Photo: ${photo.by} / Planespotters` : 'Photo: Planespotters';
    }

    /* ---------------------------------------------------------------------
     * Public
     * ------------------------------------------------------------------- */

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

    /** A src for this aircraft. Synchronous, and never empty. */
    const src = (aircraft) => silhouette(aircraft || {});

    /**
     * A complete <img> for this aircraft.
     *
     * Three things worth noting in the markup:
     *
     *   · `onerror` restores the silhouette. Tier 1 replaces the src with a
     *     third-party URL, and if that URL later 404s or is blocked, this puts
     *     the guaranteed image back rather than leaving a broken glyph. The
     *     handler clears itself first so a failing fallback cannot loop.
     *   · `loading="lazy"` and explicit dimensions, so a fleet of forty does
     *     not fetch forty photos on paint and the list does not reflow as they
     *     arrive.
     *   · `alt` is the registration and type, because this image is
     *     information — a screen reader should get "N682XL, Boeing 787-10", not
     *     "aircraft".
     */
    function img(aircraft, { className = 'cai', width = 60, height = 36, credit = false } = {}) {
        const a = aircraft || {};
        const fallback = silhouette(a);
        const label = [a.registration, a.type && a.type.name].filter(Boolean).join(', ') || 'Aircraft';
        const reg = esc(a.registration || '');
        const tag = `<img class="${esc(className)}" src="${fallback}" alt="${esc(label)}"`
            + ` width="${Number(width) || 60}" height="${Number(height) || 36}" loading="lazy" decoding="async"`
            + ` data-cai-reg="${reg}"`
            + ` data-cai-fallback="${fallback}"`
            + ` onerror="this.onerror=null;this.src=this.getAttribute('data-cai-fallback');">`;
        // The slot ships EMPTY and HIDDEN, and upgrade() fills it only if a real
        // photograph arrives. Almost every row is a silhouette we drew, which is
        // owed no credit, so this must cost that row nothing — an empty caption
        // reserving a line under forty tiles would be a visible change to every
        // fleet board for the sake of the handful that need it.
        return credit ? tag + creditSlot(a) : tag;
    }

    /**
     * The empty, hidden line a credit will be written into.
     *
     * Separate from img() because the two do not always belong next to each
     * other: in a grid tile the credit sits under the picture, and in a flex
     * row it belongs under the aircraft type, three elements away. A caller
     * that can take `img() + creditSlot()` adjacent passes {credit:true} and
     * gets both; one that cannot places this itself.
     *
     * It ships EMPTY and HIDDEN and upgrade() fills it only if a real
     * photograph arrives. Almost every row is a silhouette we drew, which is
     * owed no credit — so this must cost that row nothing, or every fleet board
     * on the platform gains a blank line under forty tiles for the sake of the
     * handful that need one.
     */
    function creditSlot(aircraft) {
        const reg = esc((aircraft && aircraft.registration) || '');
        return `<small class="cai-credit" data-cai-credit="${reg}" hidden></small>`;
    }

    /**
     * Swap in real photographs where they exist.
     *
     * Idempotent and safe to call on every repaint: an <img> is marked once it
     * has been looked at, so re-running this over a list costs nothing.
     *
     * Never throws, whatever the DOM looks like. This is decoration running
     * after a panel has painted, and an exception here would be an exception
     * inside somebody else's render — precisely the shape of failure that
     * leaves a sheet blank.
     */
    function upgrade(root) {
        try {
            const scope = root && root.querySelectorAll ? root : document;
            const nodes = scope.querySelectorAll('img[data-cai-reg]:not([data-cai-done])');
            for (const el of nodes) {
                el.setAttribute('data-cai-done', '1');
                const reg = el.getAttribute('data-cai-reg');
                if (!reg) continue;
                photoFor(reg).then((found) => {
                    // Re-checked because the panel may have repainted and
                    // replaced this node while the lookup was in flight.
                    if (!found || !el.isConnected) return;
                    el.src = found.src;
                    paintCredit(el, reg, found);
                }).catch(() => {});
            }
        } catch (err) {
            console.warn('crewAircraftImage: upgrade skipped —', err && err.message);
        }
    }

    /**
     * Say whose photograph this is.
     *
     * Three places, deliberately, because a fleet board is not the only shape
     * this image gets used in and an attribution that only works in one layout
     * is an attribution that will be missing from the next one:
     *
     *   · the img's own `title`, so the credit is reachable by hovering
     *     wherever the picture ends up, with no cooperation from the caller
     *   · `data-cai-by` / `data-cai-link`, so a caller that lays the credit out
     *     itself can read it off the element
     *   · a `[data-cai-credit]` slot for this registration, which is the
     *     VISIBLE line — img({credit:true}) emits one, hidden, and this is what
     *     unhides it
     *
     * The slot is searched from the image's own parent outwards rather than
     * from the document, so two tiles for two airframes cannot fill each
     * other's caption.
     *
     * Never throws. This runs after somebody else's panel has painted, and an
     * exception here would be an exception inside their render.
     */
    function paintCredit(el, reg, photo) {
        const line = creditLine(photo);
        if (!line) return;
        try {
            el.title = line;
            if (photo.by) el.setAttribute('data-cai-by', photo.by);
            if (photo.link) el.setAttribute('data-cai-link', photo.link);

            const scope = el.parentNode || el.ownerDocument;
            if (!scope || !scope.querySelector) return;
            const slot = scope.querySelector(`[data-cai-credit="${cssEscape(reg)}"]`);
            if (!slot) return;
            slot.textContent = '';
            if (photo.link) {
                const a = (el.ownerDocument || document).createElement('a');
                a.href = photo.link;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.textContent = line;
                slot.appendChild(a);
            } else {
                slot.textContent = line;
            }
            slot.hidden = false;
        } catch (err) {
            console.warn('crewAircraftImage: credit skipped —', err && err.message);
        }
    }

    /* A registration is [A-Z0-9-] by the time it gets here, but it arrives from
     * a VA's own database and this string goes into a selector. Quoting it is
     * cheaper than trusting it. */
    function cssEscape(v) {
        const s = String(v == null ? '' : v);
        return (window.CSS && typeof CSS.escape === 'function')
            ? CSS.escape(s)
            : s.replace(/["'\\\]\[]/g, '');
    }

    window.CrewAircraftImage = { src, img, creditSlot, upgrade, silhouette, shapeFor, photoFor, creditLine };
})();
