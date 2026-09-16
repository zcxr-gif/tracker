/* ============================================================================
   crewAircraft3D.js — the aeroplane, turned around in your hands.

   WHAT THIS ADDS

   The crew center already shows a picture of every airframe: a silhouette we
   draw, upgraded to a real photograph where one exists (crewAircraftImage.js).
   A picture answers "which aeroplane is this". It does not answer the question
   a pilot actually has in front of a fleet board — what does it LOOK like, from
   the angle I am about to see it from.

   So where somebody has published a good 3D model of the type, the thumbnail
   gains a small 3D badge, and pressing it opens the model in a panel: spin it,
   zoom it, look at the tail. Everywhere else nothing changes at all. This is an
   upgrade on a type we happen to have, never a promise for every row.

   THE PART THAT IS ACTUALLY THE DESIGN: ADDING ONE COSTS A PASTE

   A registry of embeds rots the moment adding to it is a chore, because the
   chore is always "work out what this model is of, spell it the way the API
   spells it, and type that as the key". Sketchfab already knows what the model
   is of — its URL carries the name:

       https://sketchfab.com/3d-models/boeing-787-9-95967154ac554bd88b5620613a7c85b3
                                       └── the aircraft ──┘└──── the model id ────┘

   So nobody types the aircraft. An entry in LIBRARY is the URL, filed under
   whoever made it, and this file works out the rest: the title, the family, the
   variant, and which of Infinite Flight's type names it answers to. Adding the
   next model by the same author is one more line under their name — or one run
   of `node tools/add-aircraft-3d.js`, which takes the embed code Sketchfab
   gives you, pasted whole, and writes the line itself.

   HOW A MODEL FINDS ITS AIRCRAFT

   Type names arrive from three places that do not agree with each other: the
   Live API's canonical names ("Boeing 787-10 Dreamliner"), whatever staff typed
   into a schedule's aircraft field ("B789", "787-9"), and the model's own slug.
   Matching is therefore in tiers, and each tier knows how sure it is:

     exact    the designators agree down to the variant — b787-9 is a 787-9.
     closest  the family agrees but the variant does not. A 787-9 model shown
              against a 787-10 is useful and is NOT the same aeroplane, so it
              is labelled with its own name and marked as the nearest we have.
              This crew center does not quietly show one thing as another.

   The designator table below exists for exactly that distinction: without it a
   737-800 model would answer for a 737 MAX. Types where the variant is not what
   distinguishes the shape never reach it — they are matched on their words.

   NOTHING IS FETCHED UNTIL SOMEBODY ASKS. No iframe, no Sketchfab script, no
   stylesheet at load: a fleet board of forty rows costs the same as it did
   before, and the embed is created when the panel opens and destroyed when it
   closes, so a closed panel is not left running WebGL behind the page.

   USAGE

       CrewAircraft3D.forAircraft({ type: { name } })  -> a model, or null
       CrewAircraft3D.thumb(pictureHtml, aircraft)     -> that picture, badged
       CrewAircraft3D.button(aircraft)                 -> a "View in 3D" button
       CrewAircraft3D.open(uid)                        -> the viewer

   thumb() and button() return '' -> unchanged markup when there is no model, so
   a caller can pass everything through them unconditionally. Clicks are handled
   here, on the document, so no host has to wire anything up.

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewAircraft3D: crewPanels.js must load first'); return; }
    const { esc } = P;

    /* =====================================================================
     * THE LIBRARY
     *
     * One block per author, because an author is the thing that repeats: a
     * modeller who made a good 787 usually made a good 777 too, and their name
     * and profile link should be typed once, not once per aeroplane.
     *
     *   by      how they are credited, spelled their way
     *   at      their sketchfab.com handle, for the link
     *   models  the model page URLs. Paste and go — the aircraft is read out
     *           of the URL. Where a slug is unhelpful ("untitled-3d-model") or
     *           the aircraft needs to answer to names the slug does not carry,
     *           use the object form:
     *
     *               { url: '…', title: 'Boeing 787-9', also: ['B789'] }
     *
     * The `// ac3d:<handle>` and `// ac3d:authors` markers are anchors for
     * tools/add-aircraft-3d.js. Leave them where they are.
     *
     * ONE RULE FOR WHAT GOES IN HERE: the model must be one the author has
     * published on Sketchfab with embedding allowed, and the credit below is
     * shown every time it is. We are borrowing somebody's work; their name
     * travels with it.
     * ================================================================== */
    const LIBRARY = [
        {
            by: 'OUTPISTON', at: 'outpiston', models: [
                'https://sketchfab.com/3d-models/boeing-787-9-95967154ac554bd88b5620613a7c85b3',
                // ac3d:outpiston
            ],
        },
        // ac3d:authors
    ];

    /* =====================================================================
     * Names
     * ================================================================== */

    /** Lower case, one kind of dash, nothing but letters, digits and spaces. */
    function normalize(name) {
        return String(name || '')
            .toLowerCase()
            .replace(/[‐-―]/g, '-')
            .replace(/[^a-z0-9\s-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * ICAO type codes, expanded.
     *
     * This is how the schedule's free-text aircraft field arrives when staff
     * type "B789" rather than "Boeing 787-9" — and how half of it arrives when
     * they type "B738 heavy". So the expansion is per WORD rather than per
     * name: every key here is a four-character type code that no English word
     * and no manufacturer's own spelling collides with, and the codes that are
     * also real names ("A320") expand to themselves.
     */
    const ICAO = {
        b703: '707', b712: '717', b722: '727', b732: '737-200', b733: '737-300',
        b734: '737-400', b735: '737-500', b736: '737-600', b737: '737-700',
        b738: '737-800', b739: '737-900', b37m: '737 max 7', b38m: '737 max 8',
        b39m: '737 max 9', b3xm: '737 max 10',
        b741: '747-100', b742: '747-200', b743: '747-300', b744: '747-400',
        b748: '747-8', b752: '757-200', b753: '757-300', b762: '767-200',
        b763: '767-300', b764: '767-400', b772: '777-200', b77l: '777-200lr',
        b773: '777-300', b77w: '777-300er', b778: '777-8', b779: '777-9',
        b788: '787-8', b789: '787-9', b78x: '787-10',
        a318: 'a318', a319: 'a319', a320: 'a320', a321: 'a321',
        a19n: 'a319neo', a20n: 'a320neo', a21n: 'a321neo',
        a332: 'a330-200', a333: 'a330-300', a338: 'a330-800', a339: 'a330-900',
        a342: 'a340-200', a343: 'a340-300', a345: 'a340-500', a346: 'a340-600',
        a359: 'a350-900', a35k: 'a350-1000', a388: 'a380-800',
        bcs1: 'a220-100', bcs3: 'a220-300', a221: 'a220-100', a223: 'a220-300',
        crj2: 'crj200', crj7: 'crj700', crj9: 'crj900', crjx: 'crj1000',
        e170: 'e170', e175: 'e175', e190: 'e190', e195: 'e195',
        e75l: 'e175', e290: 'e190-e2', e295: 'e195-e2',
        md11: 'md-11', md82: 'md-82', md83: 'md-83', md88: 'md-88', md90: 'md-90',
        dc10: 'dc-10', dc86: 'dc-8', dc93: 'dc-9',
        at72: 'atr 72', at75: 'atr 72', at76: 'atr 72', at43: 'atr 42',
        dh8d: 'dash 8 q400',
    };

    function expand(normalized) {
        return normalized.split(' ')
            .map((w) => (Object.prototype.hasOwnProperty.call(ICAO, w) ? ICAO[w] : w))
            .join(' ');
    }

    /* ---------------------------------------------------------------------
     * Designators
     *
     * Each rule turns a name into a family ("b787") and, where the name says
     * so, a variant ("9"). Only families where the VARIANT CHANGES THE SHAPE
     * are here — a stretch is a different silhouette and a reader notices.
     * Everything else is left to the word matching below, which is better at
     * "Cessna 172 Skyhawk" than any regular expression should try to be.
     *
     * The rules run in order and the first hit wins.
     * ------------------------------------------------------------------- */
    const RULES = [
        // Boeing 707 … 787, plus the MAX, whose number follows a word.
        {
            re: /\b7([0-8])7[\s-]*(?:(max)[\s-]*(\d{1,2})|(\d{1,3}[a-z]{0,2}))?\b/,
            family: (m) => 'b7' + m[1] + '7',
            variant: (m) => (m[2] ? 'max' + (m[3] || '') : (m[4] || '')),
        },
        // Airbus. The variant is the second number (A350-900), a suffix (neo),
        // or absent (A320). Four-digit variants come first so the -1000 of an
        // A350-1000 is not read as a "100".
        {
            re: /\ba[\s-]*([23]\d{2}|4\d{2})[\s-]*(neo|ceo|m|\d{3,4}|\d{1,2})?\b/,
            family: (m) => 'a' + m[1],
            variant: (m) => m[2] || '',
        },
        { re: /\bcrj[\s-]*(\d{3,4})\b/, family: (m) => 'crj' + m[1], variant: () => '' },
        { re: /\b(?:erj|emb)[\s-]*(\d{3})\b/, family: (m) => 'erj' + m[1], variant: () => '' },
        {
            re: /\be[\s-]*(1[0-9]{2})[\s-]*(e2)?\b/,
            family: (m) => 'e' + m[1],
            variant: (m) => m[2] || '',
        },
        { re: /\bmd[\s-]*(\d{2})\b/, family: (m) => 'md' + m[1], variant: () => '' },
        { re: /\bdc[\s-]*(\d{1,2})\b/, family: (m) => 'dc' + m[1], variant: () => '' },
        { re: /\batr[\s-]*(\d{2})\b/, family: (m) => 'atr' + m[1], variant: () => '' },
        { re: /\b(?:dash[\s-]*8[\s-]*)?q[\s-]*(\d{3})\b/, family: (m) => 'q' + m[1], variant: () => '' },
    ];

    /**
     * The family and variant a name carries, or null when it carries neither.
     *
     * Returns `{ family, variant, key }` where key is the two joined — the
     * thing two names have to agree on to be the same aeroplane.
     */
    function designator(name) {
        const n = expand(normalize(name));
        if (!n) return null;
        for (const rule of RULES) {
            const m = n.match(rule.re);
            if (!m) continue;
            const family = rule.family(m);
            const variant = String(rule.variant(m) || '').replace(/[\s-]/g, '');
            return { family, variant, key: variant ? family + '-' + variant : family };
        }
        return null;
    }

    /**
     * The words in a name that say something.
     *
     * "Dreamliner", "series" and a manufacturer's own name are all true of the
     * aeroplane and none of them distinguish one from another, so they are
     * dropped: a model called "Boeing 787" must still answer to a type called
     * "787-9 Dreamliner". What is left is compared as a set.
     */
    const NOISE = /^(the|a|an|aircraft|plane|airplane|aeroplane|jet|airliner|series|model|3d|low|poly|lowpoly|free|download|rigged|animated|dreamliner|superjumbo|jumbo|neo|family|type)$/;

    function words(name) {
        return normalize(name)
            .split(/[\s-]+/)
            .filter((w) => w && !NOISE.test(w));
    }

    /* =====================================================================
     * Reading a Sketchfab URL, or the whole embed
     * ================================================================== */

    const UID = /([0-9a-f]{32})/i;

    /** Capitalisation for a slug's words. Short codes are shouted, not Title Cased. */
    const WORDS = {
        max: 'MAX', neo: 'neo', ceo: 'ceo', er: 'ER', lr: 'LR', ulr: 'ULR',
        e2: 'E2', bbj: 'BBJ', mrtt: 'MRTT', vip: 'VIP', usaf: 'USAF',
        crj: 'CRJ', erj: 'ERJ', atr: 'ATR', md: 'MD', dc: 'DC', raf: 'RAF',
    };

    function word(w) {
        if (WORDS[w]) return WORDS[w];
        // a350 -> A350, crj900 -> CRJ900: the letters are a code, not a word.
        if (/^[a-z]+\d/.test(w)) return w.replace(/^[a-z]+/, (s) => s.toUpperCase());
        // 300er -> 300ER
        if (/^\d/.test(w)) return w.toUpperCase();
        return w.charAt(0).toUpperCase() + w.slice(1);
    }

    /**
     * "boeing-787-9" -> "Boeing 787-9".
     *
     * The only judgement here is which hyphens survive: one between two numbers
     * is part of the aeroplane's name (787-9), one after a word is the slug's
     * own punctuation (boeing-787) and becomes a space.
     */
    function titleFromSlug(slug) {
        const parts = String(slug || '').split('-').filter(Boolean);
        let out = '';
        parts.forEach((p, i) => {
            if (i) out += (/^\d/.test(p) && /\d$/.test(parts[i - 1])) ? '-' : ' ';
            out += word(p);
        });
        return out;
    }

    /**
     * Pull a model out of anything Sketchfab hands you: the model page URL, the
     * embed URL, or the entire block of embed code with its attribution.
     *
     * Returns `{ uid, slug, title, by, at }` with whatever was in there, or
     * null if there was no model id at all. Exported because
     * tools/add-aircraft-3d.js reads the pasted embed with the same code that
     * reads the library — two parsers would drift.
     */
    function parseEmbed(text) {
        const src = String(text || '');
        const uid = (src.match(UID) || [])[1];
        if (!uid) return null;
        const out = { uid: uid.toLowerCase(), slug: '', title: '', by: '', at: '' };

        const page = src.match(/3d-models\/([a-z0-9-]+?)-?([0-9a-f]{32})/i);
        if (page && page[1]) out.slug = page[1].toLowerCase();

        const titled = src.match(/\btitle\s*=\s*"([^"]+)"/i);
        if (titled) out.title = titled[1].trim();
        if (!out.title && out.slug) out.title = titleFromSlug(out.slug);

        // The author link is the one sketchfab.com/<handle> that is not a model
        // page, and their name is what that link says.
        const author = src.match(/sketchfab\.com\/(?!3d-models|models)([A-Za-z0-9_.-]+)"[^>]*>\s*([^<]+?)\s*</);
        if (author) { out.at = author[1]; out.by = author[2].replace(/\s+/g, ' ').trim(); }
        return out;
    }

    /* =====================================================================
     * The index
     * ================================================================== */

    /** Every model in LIBRARY, resolved once, in the order they were written. */
    const MODELS = [];

    (function build() {
        for (const author of LIBRARY) {
            for (const raw of (author.models || [])) {
                const entry = typeof raw === 'string' ? { url: raw } : (raw || {});
                const parsed = parseEmbed(entry.url || entry.uid || '');
                if (!parsed) { console.warn('crewAircraft3D: no model id in', entry.url); continue; }
                const title = entry.title || parsed.title || 'Aircraft';
                const names = [title].concat(entry.also || []);
                MODELS.push({
                    uid: parsed.uid,
                    slug: parsed.slug,
                    title,
                    by: entry.by || author.by || parsed.by || '',
                    at: entry.at || author.at || parsed.at || '',
                    url: parsed.slug
                        ? 'https://sketchfab.com/3d-models/' + parsed.slug + '-' + parsed.uid
                        : 'https://sketchfab.com/models/' + parsed.uid,
                    // Every name this model answers to, pre-resolved: matching a
                    // fleet board of forty rows must not re-parse the library
                    // forty times.
                    keys: names.map(designator).filter(Boolean),
                    words: names.map(words).filter((w) => w.length),
                });
            }
        }
    }());

    const byUid = (uid) => MODELS.find((m) => m.uid === String(uid || '').toLowerCase()) || null;

    /** Is every word of `sub` present in `sup`? */
    const covers = (sup, sub) => sub.every((w) => sup.indexOf(w) !== -1);

    /**
     * The best model for a type name, with how sure we are.
     *
     * Four passes over the library rather than one, because the ORDER of the
     * tiers matters more than the order of the models: an exact 787-9 further
     * down the list must beat a 787-8 that happened to be written first.
     */
    function forType(name) {
        const type = String(name || '').trim();
        if (!type || !MODELS.length) return null;

        const d = designator(type);
        const w = words(type);
        if (!w.length) return null;

        if (d) {
            for (const m of MODELS) {
                if (m.keys.some((k) => k.key === d.key)) return { model: m, exact: true };
            }
            for (const m of MODELS) {
                if (m.keys.some((k) => k.family === d.family)) return { model: m, exact: false };
            }
        }
        // No designator on one side or the other: compare the words. Equal sets
        // are the same aeroplane; a model whose words are all present in the
        // type is the nearest thing we have to it.
        for (const m of MODELS) {
            if (m.words.some((mw) => mw.length === w.length && covers(w, mw))) {
                return { model: m, exact: true };
            }
        }
        // A designator on the TYPE and none on the model is not a match to make
        // on words alone: "737" appears in both "Boeing 737-800" and a model
        // called "737 cockpit", and the second is not an aeroplane.
        if (d) return null;
        for (const m of MODELS) {
            if (m.words.some((mw) => covers(w, mw))) return { model: m, exact: false };
        }
        return null;
    }

    /** The same, for the aircraft objects the fleet board deals in. */
    function forAircraft(aircraft) {
        const a = aircraft || {};
        const name = (a.type && (a.type.name || a.type)) || a.aircraft || a.name || '';
        return forType(name);
    }

    /* =====================================================================
     * Markup
     * ================================================================== */

    function injectStyles() {
        P.style('ac3d-styles', `
        /* The badge sits ON the thumbnail, so the button must not add a box of
           its own: no padding, no border, no background, and line-height:0 so
           the inline image does not leave a descender gap under it. */
        .ac3d-thumb{ position:relative; display:block; padding:0; border:0; background:none;
            line-height:0; cursor:pointer; flex:0 0 auto; border-radius:.35rem; }
        .ac3d-thumb:focus-visible{ outline:2px solid var(--accent,#1C1A16); outline-offset:2px; }
        .ac3d-badge{ position:absolute; right:.15rem; bottom:.15rem; line-height:1;
            font-size:.55rem; font-weight:800; letter-spacing:.04em; padding:.12rem .22rem;
            border-radius:.25rem; background:rgba(0,0,0,.62); color:#fff;
            pointer-events:none; }
        .cif-tile .ac3d-thumb{ width:100%; margin-bottom:.35rem; }
        .cif-tile .ac3d-thumb .cai{ margin-bottom:0; }
        .cif-tile .ac3d-badge{ right:.3rem; bottom:.3rem; font-size:.6rem; }
        .ac3d-thumb:hover .ac3d-badge{ background:var(--accent,#1C1A16); }

        /* The inline pill, for a line of text. Sized off the text it follows so
           it never becomes the loudest thing in the sentence. */
        .ac3d-link{ margin-left:.4rem; vertical-align:baseline; cursor:pointer;
            font:inherit; font-size:.62rem; font-weight:800; letter-spacing:.04em;
            padding:.1rem .3rem; border-radius:.25rem; line-height:1.3;
            border:1px solid var(--line,#e5e5e5); background:transparent; color:var(--muted,#736E64); }
        .ac3d-link:hover{ border-color:var(--accent,#1C1A16); color:var(--accent,#1C1A16); }

        /* Above anything it can be opened from. The schedule's detail dialog is
           z-index 90 and a plain crewPanels sheet is 70, so without this the
           viewer opens BEHIND the thing whose button you just pressed. Still
           under the toast layer (120) and the confirm (130), which have to be
           able to speak over it. */
        #ac3d-panel{ z-index:100; }

        /* The viewer. A fixed aspect box rather than a height, so the model is
           the same shape on a phone as on a desktop and the panel does not jump
           as the iframe loads. */
        .ac3d-frame{ position:relative; width:100%; aspect-ratio:16/10; min-height:15rem;
            max-height:62vh; border-radius:.6rem; overflow:hidden;
            background:color-mix(in srgb, var(--ink,#1C1A16) 8%, transparent); }
        .ac3d-frame iframe{ position:absolute; inset:0; width:100%; height:100%; border:0; }
        .ac3d-credit{ margin:.55rem 0 0; font-size:.75rem; line-height:1.45; color:var(--muted,#736E64); }
        .ac3d-credit a{ color:var(--accent,#1C1A16); font-weight:600;
            text-decoration:underline; text-underline-offset:2px; }
        .ac3d-note{ margin:.35rem 0 0; font-size:.72rem; color:var(--faint,#A8A296); }`);
    }

    /* A match that is only the nearest thing we have is marked in the markup,
     * not just in the tooltip — the viewer has to be able to say so too, and it
     * is opened from a click on a button, with nothing else to go on. */
    const approx = (hit) => (hit.exact ? '' : ' data-ac3d-approx="1"');

    const label = (m, exact) => (exact
        ? 'View the ' + m.title + ' in 3D'
        : 'View a ' + m.title + ' in 3D — the closest model we have');

    /**
     * A picture, badged if there is a model of it.
     *
     * Takes the markup crewAircraftImage.js produced rather than building its
     * own, so the guarantee that file makes — there is always an image, and it
     * cannot fail to load — is untouched by this one. No model, no change: the
     * same string comes back out.
     */
    function thumb(html, aircraft) {
        const hit = forAircraft(aircraft);
        if (!hit || !html) return html || '';
        injectStyles();
        const text = label(hit.model, hit.exact);
        return `<button type="button" class="ac3d-thumb" data-ac3d="${esc(hit.model.uid)}"${approx(hit)}
            title="${esc(text)}" aria-label="${esc(text)}">${html}<span class="ac3d-badge">3D</span></button>`;
    }

    /**
     * The same offer where there is no picture to badge.
     *
     * `inline` is the version that follows a line of text — a leg's aircraft
     * type on a schedule — and is deliberately a 3D pill rather than a full
     * button: the sentence it sits in is about the flight, not about us having
     * a model of the aeroplane.
     */
    function button(aircraft, { inline = false } = {}) {
        const hit = forAircraft(aircraft);
        if (!hit) return '';
        injectStyles();
        const text = label(hit.model, hit.exact);
        if (inline) {
            return `<button type="button" class="ac3d-link" data-ac3d="${esc(hit.model.uid)}"${approx(hit)}
                title="${esc(text)}" aria-label="${esc(text)}">3D</button>`;
        }
        return `<button type="button" class="cp-btn cp-btn-sm"
            data-ac3d="${esc(hit.model.uid)}"${approx(hit)} title="${esc(text)}">
            <i data-lucide="box"></i> View in 3D</button>`;
    }

    /* =====================================================================
     * The viewer
     * ================================================================== */

    let panel = null;

    /**
     * Open the model.
     *
     * The iframe is built here and torn down on close — see watchClose. A
     * Sketchfab embed left in the DOM keeps a WebGL context and an animation
     * loop alive behind whatever the reader went back to, which on a phone is
     * felt as the battery going and the rest of the page stuttering.
     */
    function open(uid, exact) {
        const m = typeof uid === 'object' ? uid : byUid(uid);
        if (!m) return;
        injectStyles();
        if (!panel) {
            panel = P.sheet({ id: 'ac3d-panel', title: m.title, icon: 'box' });
            watchClose();
        }
        panel.setTitle(m.title);

        const dark = !!(document.documentElement
            && document.documentElement.classList
            && document.documentElement.classList.contains('dark'));
        const src = 'https://sketchfab.com/models/' + encodeURIComponent(m.uid) + '/embed'
            + '?autospin=0.2&autostart=1&preload=1&transparent=0&ui_theme=' + (dark ? 'dark' : 'default');

        const who = m.at
            ? `<a href="https://sketchfab.com/${esc(m.at)}" target="_blank" rel="noopener nofollow">${esc(m.by || m.at)}</a>`
            : esc(m.by || 'its author');

        panel.body.innerHTML = `
            <div class="ac3d-frame">
                <iframe title="${esc(m.title)}" src="${esc(src)}"
                    frameborder="0" allowfullscreen mozallowfullscreen="true" webkitallowfullscreen="true"
                    allow="autoplay; fullscreen; xr-spatial-tracking"
                    xr-spatial-tracking execution-while-out-of-viewport
                    execution-while-not-rendered web-share loading="lazy"></iframe>
            </div>
            <p class="ac3d-credit">
                <a href="${esc(m.url)}" target="_blank" rel="noopener nofollow">${esc(m.title)}</a>
                by ${who} on
                <a href="https://sketchfab.com" target="_blank" rel="noopener nofollow">Sketchfab</a>
            </p>
            ${exact === false ? `<p class="ac3d-note">The closest model we have to this aircraft —
                it is a ${esc(m.title)}, not this exact variant.</p>` : ''}`;
        panel.open();
        try { P.icons(); } catch { /* a missing glyph is not worth a blank panel */ }
    }

    /**
     * Empty the panel whenever it closes.
     *
     * A panel can be closed four ways — the X, the scrim, Escape, and another
     * panel taking over — and crewPanels.js owns all four. Rather than guess at
     * them, watch the one thing they all do: add `cp-hidden` to the panel.
     */
    function watchClose() {
        if (typeof MutationObserver === 'undefined' || !panel) return;
        const obs = new MutationObserver(() => {
            if (panel.el.classList.contains('cp-hidden') && panel.body.innerHTML) {
                panel.body.innerHTML = '';
            }
        });
        obs.observe(panel.el, { attributes: true, attributeFilter: ['class'] });
    }

    /* One listener, on the document, for every badge and button this module
     * ever emits — including the ones painted into a host that has never heard
     * of this file.
     *
     * IN THE CAPTURE PHASE, and it stops there. A thumbnail often sits inside
     * something that is itself clickable — a schedule row that opens its own
     * detail, a tile that opens an aircraft — and a press on the 3D badge is
     * not a press on that. Capturing is the only way to answer first: by the
     * time a bubbling listener runs, the row's delegated handler has already
     * fired and opened something else on top of us. */
    if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('click', (ev) => {
            const t = ev.target && ev.target.closest && ev.target.closest('[data-ac3d]');
            if (!t) return;
            ev.preventDefault();
            ev.stopPropagation();
            open(t.getAttribute('data-ac3d'), !t.hasAttribute('data-ac3d-approx'));
        }, true);
    }

    window.CrewAircraft3D = {
        forType, forAircraft, thumb, button, open,
        all: () => MODELS.slice(),
        // Exported for tools/add-aircraft-3d.js and the tests. Nothing on a
        // page should need these.
        parseEmbed, designator, words, titleFromSlug, normalize,
    };
}());
