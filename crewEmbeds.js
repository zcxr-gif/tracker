/* ============================================================================
   crewEmbeds.js — the widgets we provide, pre-filled with the VA's own details.

   WHAT THIS REPLACES

   A tile in the Manage grid labelled "Embeds — Site widgets" that did nothing
   when pressed. Meanwhile the widgets themselves have existed for a long time
   and are documented in EMBED.md — a VA who wanted one had to be sent a URL by
   hand, or find the documentation and assemble the query string themselves.

   WHAT IT DOES

   Five things, in order of how much of the job they are:

     1. Lists what we actually provide, with an honest note about what each one
        costs. Map mode bills Mapbox map loads to whoever owns the token, which
        is the single most important sentence on this panel and is therefore
        next to the option rather than in a document.
     2. Fills in the VA's own code, name and brand colour, so the default
        snippet is already theirs.
     3. Shows it. The preview is a live iframe of the exact URL being copied —
        not a mock-up of one — so what a VA sees here is what their visitors
        will see, including when it says "nothing published yet".
     4. Hands over the <iframe> to paste.
     5. For a VA that has built its own website and wants the data in its OWN
        typography rather than in ours, hands over the data instead: the public
        JSON endpoints, and a one-line script that fills their markup in from
        them. An iframe is the right answer for a Wix site and the wrong answer
        for a designed one, and until this panel offered both, the second kind
        of VA had no answer at all.

   WHY THE PREVIEW IS THE REAL WIDGET

   Because a preview that approximates the thing is a preview that lies as soon
   as the two drift, and this one would drift the first time a widget changed.
   Rendering the actual URL also means a VA discovers HERE that their
   noticeboard is empty, rather than after pasting it onto their homepage.

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewEmbeds: crewPanels.js must load first'); return; }
    const { esc, icons } = P;

    // Where the widgets are served from. The crew center is itself served from
    // this origin in production, so `location.origin` is right — and stays
    // right on a staging deploy, which a hardcoded inflight.info would not.
    const HOST = location.origin;

    // The service that answers for crew centers. Passed in by the dashboard so
    // a staging deploy quotes its own backend in the snippet it hands over.
    const DEFAULT_BACKEND = 'https://site--indgo-backend--6dmjph8ltlhv.code.run';

    const S = {
        slug: '',
        code: '',
        name: '',
        accent: '',
        backend: DEFAULT_BACKEND,
        pick: 'roster',
        opts: {},          // per-widget option state, keyed by widget id
    };

    let panel = null;

    /* ---------------------------------------------------------------------
     * The catalogue
     *
     * `build` returns the widget's URL from the current options. Each entry
     * owns its own option controls, because the options genuinely differ —
     * pretending map mode and the noticeboard share a settings form would mean
     * a form mostly full of controls that do not apply.
     * ------------------------------------------------------------------- */
    const WIDGETS = [
        {
            id: 'roster',
            label: 'Live flights — roster',
            icon: 'radio',
            blurb: 'Your pilots who are airborne right now, as a live list. Reads the same '
                + 'Infinite Flight data the tracker does.',
            cost: 'Free. No map, so nothing is billed to anyone.',
            height: 520,
            needs: 'code',
            options: [
                { key: 'theme', label: 'Theme', type: 'select', values: [['dark', 'Dark'], ['light', 'Light']], def: 'dark' },
                { key: 'header', label: 'Header bar', type: 'select', values: [['on', 'Show'], ['off', 'Hide']], def: 'on' },
                { key: 'color', label: 'Header colour', type: 'color' },
            ],
            build: (o) => url('/embed.html', {
                va: S.code, name: S.name, mode: 'roster',
                theme: o.theme, header: o.header === 'off' ? 'off' : '', color: o.color,
            }),
        },
        {
            id: 'map',
            label: 'Live flights — map',
            icon: 'map',
            blurb: 'The same live traffic, drawn on a map of your network with your hubs marked.',
            cost: 'Map mode needs YOUR OWN Mapbox public token (pk.…). Mapbox bills map loads '
                + 'to whoever owns the token, so these land on your account and never on ours. '
                + 'Leave it blank to use the free basemap instead.',
            height: 560,
            needs: 'code',
            options: [
                { key: 'theme', label: 'Theme', type: 'select', values: [['dark', 'Dark'], ['light', 'Light']], def: 'dark' },
                { key: 'hubs', label: 'Hub ICAOs', type: 'text', placeholder: 'EGLL, EGKK' },
                { key: 'mapboxToken', label: 'Your Mapbox token', type: 'text', placeholder: 'pk.eyJ… (optional)' },
                { key: 'color', label: 'Header colour', type: 'color' },
            ],
            build: (o) => url('/embed.html', {
                va: S.code, name: S.name, mode: 'map',
                theme: o.theme, freeStyle: o.theme === 'light' ? 'positron' : 'dark',
                hubs: (o.hubs || '').replace(/\s+/g, ''),
                mapboxToken: o.mapboxToken, provider: o.mapboxToken ? 'mapbox' : 'free',
                color: o.color,
            }),
        },
        {
            id: 'notices',
            label: 'Noticeboard',
            icon: 'megaphone',
            blurb: 'What your crew center is telling your crew — staff notices, plus the pilots '
                + 'who joined, the promotions and the flying that went up.',
            cost: 'Free. Reads the same public feed your crew center shows.',
            height: 460,
            needs: 'slug',
            options: [
                { key: 'theme', label: 'Theme', type: 'select', values: [['dark', 'Dark'], ['light', 'Light']], def: 'dark' },
                { key: 'limit', label: 'How many rows', type: 'number', def: '8', min: 1, max: 50 },
                { key: 'header', label: 'Header bar', type: 'select', values: [['on', 'Show'], ['off', 'Hide']], def: 'on' },
                { key: 'accent', label: 'Accent', type: 'color' },
            ],
            build: (o) => url('/embed-crew.html', {
                va: S.slug, view: 'notices', name: S.name,
                theme: o.theme, limit: o.limit, header: o.header === 'off' ? 'off' : '', accent: o.accent,
            }),
        },
        {
            id: 'events',
            label: 'Events calendar',
            icon: 'calendar-days',
            blurb: 'The events you publish in the Events panel — group flights, fly-ins — '
                + 'on your own site, from the same rows.',
            cost: 'Free. Published events only; drafts never leave the crew center.',
            height: 460,
            needs: 'slug',
            options: [
                { key: 'theme', label: 'Theme', type: 'select', values: [['dark', 'Dark'], ['light', 'Light']], def: 'dark' },
                { key: 'limit', label: 'How many events', type: 'number', def: '6', min: 1, max: 50 },
                { key: 'header', label: 'Header bar', type: 'select', values: [['on', 'Show'], ['off', 'Hide']], def: 'on' },
                { key: 'accent', label: 'Accent', type: 'color' },
            ],
            build: (o) => url('/embed-crew.html', {
                va: S.slug, view: 'events', name: S.name,
                theme: o.theme, limit: o.limit, header: o.header === 'off' ? 'off' : '', accent: o.accent,
            }),
        },
        {
            id: 'routes',
            label: 'Route network',
            icon: 'route',
            blurb: 'Every sector you have published — flight number, city pair, aircraft and '
                + 'distance. Add a route here and it appears on your website; switch one off '
                + 'and it leaves.',
            cost: 'Free. Active routes only — a sector you have switched off never leaves the crew center.',
            height: 520,
            needs: 'slug',
            options: [
                { key: 'theme', label: 'Theme', type: 'select', values: [['dark', 'Dark'], ['light', 'Light']], def: 'dark' },
                { key: 'limit', label: 'How many sectors', type: 'number', def: '20', min: 1, max: 50 },
                { key: 'kind', label: 'Which sectors', type: 'select', values: [['', 'All'], ['own', 'Our own metal'], ['codeshare', 'Codeshares only']], def: '' },
                { key: 'sort', label: 'Order', type: 'select', values: [['', 'By airport pair'], ['distance', 'Longest first'], ['shortest', 'Shortest first'], ['flight', 'By flight number']], def: '' },
                { key: 'aircraft', label: 'Only this aircraft', type: 'text', placeholder: 'e.g. 787' },
                { key: 'header', label: 'Header bar', type: 'select', values: [['on', 'Show'], ['off', 'Hide']], def: 'on' },
                { key: 'accent', label: 'Accent', type: 'color' },
            ],
            build: (o) => url('/embed-crew.html', {
                va: S.slug, view: 'routes', name: S.name,
                theme: o.theme, limit: o.limit, kind: o.kind, sort: o.sort, aircraft: o.aircraft,
                header: o.header === 'off' ? 'off' : '', accent: o.accent,
            }),
        },
        {
            id: 'stats',
            label: 'By the numbers',
            icon: 'bar-chart-3',
            blurb: 'Your pilots, hours, flights filed and the size of your network — the figures '
                + 'this crew center already holds, on your own site and correct the day after '
                + 'they change.',
            cost: 'Free. A figure we did not get is left out rather than printed as zero.',
            height: 300,
            needs: 'slug',
            options: [
                { key: 'theme', label: 'Theme', type: 'select', values: [['dark', 'Dark'], ['light', 'Light']], def: 'dark' },
                { key: 'limit', label: 'How many figures', type: 'number', def: '6', min: 1, max: 9 },
                { key: 'header', label: 'Header bar', type: 'select', values: [['on', 'Show'], ['off', 'Hide']], def: 'on' },
                { key: 'accent', label: 'Accent', type: 'color' },
            ],
            build: (o) => url('/embed-crew.html', {
                va: S.slug, view: 'stats', name: S.name,
                theme: o.theme, limit: o.limit, header: o.header === 'off' ? 'off' : '', accent: o.accent,
            }),
        },
        {
            id: 'schedule',
            label: 'Schedule',
            icon: 'calendar-clock',
            blurb: 'The week you have published — departures, times and how many seats are '
                + 'still open on each.',
            cost: 'Free. Published departures only.',
            height: 500,
            needs: 'slug',
            options: [
                { key: 'theme', label: 'Theme', type: 'select', values: [['dark', 'Dark'], ['light', 'Light']], def: 'dark' },
                { key: 'limit', label: 'How many departures', type: 'number', def: '10', min: 1, max: 50 },
                { key: 'header', label: 'Header bar', type: 'select', values: [['on', 'Show'], ['off', 'Hide']], def: 'on' },
                { key: 'accent', label: 'Accent', type: 'color' },
            ],
            build: (o) => url('/embed-crew.html', {
                va: S.slug, view: 'schedule', name: S.name,
                theme: o.theme, limit: o.limit, header: o.header === 'off' ? 'off' : '', accent: o.accent,
            }),
        },
        {
            id: 'feed',
            label: 'Live data (JSON)',
            icon: 'plug',
            feed: true,
            blurb: 'The same routes, figures, events and notices as plain data, with no markup '
                + 'and no styling attached — for a site that wants them in its own typography, '
                + 'on its own grid. Read the endpoints directly, or drop in the one-line script '
                + 'and mark up the page.',
            cost: 'Free, public and CORS-open — no key, nothing to keep secret. These are read '
                + 'endpoints only: nothing here can change anything in your crew center.',
            needs: 'slug',
            options: [],
        },
    ];

    const widget = (id) => WIDGETS.find((w) => w.id === id) || WIDGETS[0];

    /** Build a URL, dropping every empty parameter rather than sending `&x=`. */
    function url(path, params) {
        const q = new URLSearchParams();
        Object.keys(params).forEach((k) => {
            const v = params[k];
            if (v === undefined || v === null || v === '') return;
            q.set(k, String(v));
        });
        const s = q.toString();
        return HOST + path + (s ? '?' + s : '');
    }

    /** The current option values for a widget, defaults filled in. */
    function optsFor(w) {
        if (!S.opts[w.id]) {
            const o = {};
            (w.options || []).forEach((opt) => {
                // The VA's own accent is a better default than ours, and it is
                // the whole point of the panel filling things in.
                o[opt.key] = opt.type === 'color' ? (S.accent || '') : (opt.def || '');
            });
            S.opts[w.id] = o;
        }
        return S.opts[w.id];
    }

    const snippet = (w, src) => `<iframe
  src="${src}"
  style="width:100%;height:${w.height}px;border:0;border-radius:12px"
  loading="lazy"
  title="${(S.name || 'Crew Center').replace(/"/g, '')} — ${w.label}"></iframe>`;

    /* ---------------------------------------------------------------------
     * The direct-integration path.
     *
     * The endpoints are listed as URLs rather than described, because the VA
     * pasting them into their own code is the whole point — and every one is a
     * plain GET they can open in a browser tab right now to see exactly what
     * comes back. What a developer needs from this panel is the address, not a
     * paragraph about the address.
     * ------------------------------------------------------------------- */
    const FEEDS = [
        { path: '/routes',        what: 'Your route network — every published sector.' },
        { path: '/stats',         what: 'Pilots, hours, flights filed, the size of the network.' },
        { path: '/events',        what: 'The events calendar you publish.' },
        { path: '/schedules',     what: 'Published departures and the seats left on each.' },
        { path: '/announcements', what: 'The noticeboard.' },
        { path: '/route-map',     what: 'The same routes joined to airport coordinates, for drawing a map.' },
    ];

    const feedUrl = (path) => `${S.backend}/api/crew/${encodeURIComponent(S.slug)}${path}`;

    const feedSnippet = () => `<script src="${HOST}/crew-feed.js" data-va="${S.slug}"><\/script>

<!-- Your own markup. Any figure the crew center holds, in your type, on your grid.
     A figure it could not tell us is removed rather than printed as zero. -->
<p><b data-crew-stat="pilots">—</b> pilots · <b data-crew-stat="hours">—</b> hours flown</p>

<!-- Your route network, in your own template. {{fields}}: from, to, flight,
     aircraft, distanceNm, notes, partner, minRank -->
<ul data-crew-list="routes" data-crew-limit="10">
  <template>
    <li><b>{{from}} → {{to}}</b> {{aircraft}}</li>
  </template>
</ul>`;

    const feedJs = () => `// Or read it yourself. Every call resolves to null on any
// failure, so your page keeps whatever it already showed.
const routes  = await CrewFeed.routes();   // [{ from, to, flight, aircraft, … }]
const figures = await CrewFeed.stats();    // { pilots, hours, pireps, … }`;

    /* =====================================================================
     * RENDER
     * =================================================================== */

    function render() {
        const w = widget(S.pick);
        const o = optsFor(w);
        const missing = w.needs === 'code' ? !S.code : !S.slug;
        const src = missing || w.feed ? '' : w.build(o);

        const picker = WIDGETS.map((x) => `
            <button class="ce-pick${x.id === S.pick ? ' ce-pick-on' : ''}" data-pick="${esc(x.id)}">
                <i data-lucide="${esc(x.icon)}"></i>
                <span>${esc(x.label)}</span>
            </button>`).join('');

        const controls = (w.options || []).map((opt) => {
            const v = o[opt.key] || '';
            if (opt.type === 'select') {
                return `<div><label class="cp-label" for="ce_${esc(opt.key)}">${esc(opt.label)}</label>
                    <select id="ce_${esc(opt.key)}" class="cp-select" data-opt="${esc(opt.key)}">
                        ${opt.values.map(([val, lbl]) => `<option value="${esc(val)}"${v === val ? ' selected' : ''}>${esc(lbl)}</option>`).join('')}
                    </select></div>`;
            }
            if (opt.type === 'color') {
                return `<div><label class="cp-label" for="ce_${esc(opt.key)}">${esc(opt.label)}</label>
                    <div class="ce-color">
                        <input id="ce_${esc(opt.key)}" type="color" data-opt="${esc(opt.key)}" value="${esc(v || '#2563eb')}">
                        <button class="cp-btn cp-btn-sm" data-clear="${esc(opt.key)}">Auto</button>
                    </div></div>`;
            }
            if (opt.type === 'number') {
                return `<div><label class="cp-label" for="ce_${esc(opt.key)}">${esc(opt.label)}</label>
                    <input id="ce_${esc(opt.key)}" class="cp-input" type="number" data-opt="${esc(opt.key)}"
                        min="${opt.min || 1}" max="${opt.max || 50}" value="${esc(v)}"></div>`;
            }
            return `<div><label class="cp-label" for="ce_${esc(opt.key)}">${esc(opt.label)}</label>
                <input id="ce_${esc(opt.key)}" class="cp-input" data-opt="${esc(opt.key)}"
                    placeholder="${esc(opt.placeholder || '')}" value="${esc(v)}"></div>`;
        }).join('');

        panel.body.innerHTML = `
            <div class="ce-picker">${picker}</div>

            <section class="cp-card ce-about">
                <h3 class="cp-card-title">${esc(w.label)}</h3>
                <p class="cp-note">${esc(w.blurb)}</p>
                <p class="cp-note ce-cost"><i data-lucide="info"></i> ${esc(w.cost)}</p>
            </section>

            ${missing ? `<div class="cp-empty"><i data-lucide="alert-triangle"></i>
                ${w.needs === 'code'
                    ? 'This widget needs your VA callsign code, which your Inflight listing hasn’t got yet.'
                    : 'This widget needs your crew center’s address, which we couldn’t read from this page.'}
            </div>` : w.feed ? feedBody() : `
            <section class="cp-card">
                <div class="ce-opts">${controls}</div>
            </section>

            <section class="ce-preview">
                <div class="ce-preview-head">
                    <span class="cp-label" style="margin:0">Live preview</span>
                    <a class="cp-btn cp-btn-sm" href="${esc(src)}" target="_blank" rel="noopener">
                        <i data-lucide="external-link"></i> Open
                    </a>
                </div>
                <iframe id="cePreview" src="${esc(src)}" style="--ce-h:${w.height}px"
                    loading="lazy" title="Preview"></iframe>
            </section>

            <section class="cp-card">
                <label class="cp-label" for="ceSnippet">Paste this into your website</label>
                <textarea id="ceSnippet" class="cp-textarea ce-snippet" readonly rows="5">${esc(snippet(w, src))}</textarea>
                <div class="ce-copy-row">
                    <button class="cp-btn cp-btn-primary" id="ceCopy"><i data-lucide="copy"></i> Copy the snippet</button>
                    <button class="cp-btn" id="ceCopyUrl"><i data-lucide="link"></i> Copy just the URL</button>
                </div>
                <p class="cp-note">Anywhere that accepts HTML will do — a page on your site, a
                    widget block, a Notion or Carrd embed. It resizes itself to whatever width
                    you give it.</p>
            </section>`}`;

        icons();
        wire(w, src);
    }

    /** The Live-data view: the endpoints, then the drop-in snippet. */
    function feedBody() {
        const rows = FEEDS.map((f) => `
            <div class="ce-feed-row">
                <div class="ce-feed-main">
                    <code>${esc(feedUrl(f.path))}</code>
                    <p class="cp-note">${esc(f.what)}</p>
                </div>
                <div class="ce-feed-acts">
                    <a class="cp-btn cp-btn-sm" href="${esc(feedUrl(f.path))}" target="_blank" rel="noopener">
                        <i data-lucide="external-link"></i> Open
                    </a>
                    <button class="cp-btn cp-btn-sm" data-copy-url="${esc(feedUrl(f.path))}">
                        <i data-lucide="copy"></i> Copy
                    </button>
                </div>
            </div>`).join('');

        return `
            <section class="cp-card">
                <label class="cp-label">Your endpoints</label>
                <div class="ce-feeds">${rows}</div>
                <p class="cp-note">Plain GETs. Open one now and you will see exactly what your
                    site will get. Drafts are never in them — an unauthenticated caller sees
                    only what your crew center already shows the public.</p>
            </section>

            <section class="cp-card">
                <label class="cp-label" for="ceSnippet">Or drop this in and mark up your page</label>
                <textarea id="ceSnippet" class="cp-textarea ce-snippet" readonly rows="14">${esc(feedSnippet())}</textarea>
                <div class="ce-copy-row">
                    <button class="cp-btn cp-btn-primary" id="ceCopy"><i data-lucide="copy"></i> Copy the snippet</button>
                </div>
                <pre class="ce-code">${esc(feedJs())}</pre>
            </section>`;
    }

    function wire(w, src) {
        const body = panel.body;

        body.querySelectorAll('[data-copy-url]').forEach((b) => {
            b.addEventListener('click', () => copyText(b.getAttribute('data-copy-url'), 'URL copied.'));
        });

        body.querySelectorAll('[data-pick]').forEach((b) => {
            b.addEventListener('click', () => { S.pick = b.getAttribute('data-pick'); render(); });
        });

        // Options repaint the preview and the snippet, and nothing else. A
        // full re-render on every keystroke would reload the iframe on each
        // character of a Mapbox token, which is both slow and, on map mode, a
        // map load per keystroke against the VA's own account.
        body.querySelectorAll('[data-opt]').forEach((el) => {
            const ev = el.tagName === 'SELECT' || el.type === 'color' ? 'change' : 'input';
            el.addEventListener(ev, () => {
                optsFor(w)[el.getAttribute('data-opt')] = el.value;
                refresh(w);
            });
        });

        body.querySelectorAll('[data-clear]').forEach((b) => {
            b.addEventListener('click', () => {
                optsFor(w)[b.getAttribute('data-clear')] = '';
                render();
            });
        });

        const copy = body.querySelector('#ceCopy');
        if (copy) copy.addEventListener('click', () => copyText(body.querySelector('#ceSnippet').value, 'Snippet copied.'));
        const copyUrl = body.querySelector('#ceCopyUrl');
        if (copyUrl) copyUrl.addEventListener('click', () => copyText(currentSrc(w) || src, 'URL copied.'));
    }

    let refreshTimer = null;
    function currentSrc(w) {
        const frame = panel.body.querySelector('#cePreview');
        return frame ? frame.dataset.src || frame.src : '';
    }
    function refresh(w) {
        const src = w.build(optsFor(w));
        const snip = panel.body.querySelector('#ceSnippet');
        if (snip) snip.value = snippet(w, src);
        const frame = panel.body.querySelector('#cePreview');
        if (!frame) return;
        frame.dataset.src = src;
        // Debounced: typing a hub list should not reload the widget six times.
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => { frame.src = src; }, 400);
    }

    /**
     * Copy, with a fallback.
     *
     * navigator.clipboard needs a secure context and, in some browsers, a
     * permission the user has not granted. The textarea fallback works
     * everywhere and is the difference between a panel whose only purpose is
     * handing over text and one that silently fails to.
     */
    async function copyText(text, okMsg) {
        try {
            await navigator.clipboard.writeText(text);
            P.toast(okMsg, 'ok');
            return;
        } catch { /* fall through */ }
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            P.toast(okMsg, 'ok');
        } catch {
            P.toast('Select the snippet and copy it by hand — this browser wouldn’t let us.', 'bad');
        }
        ta.remove();
    }

    /* =====================================================================
     * STYLES
     * =================================================================== */

    function injectStyles() {
        P.baseStyles();
        P.style('ce-styles', `
        .ce-picker{ display:flex; gap:.4rem; overflow-x:auto; padding-bottom:.2rem; }
        .ce-pick{ display:inline-flex; align-items:center; gap:.4rem; padding:.5rem .75rem;
            border:1px solid var(--line,#e5e5e5); border-radius:.6rem; cursor:pointer;
            background:var(--surface,#fff); color:var(--muted,#736E64); font-size:.82rem;
            font-weight:600; font-family:inherit; white-space:nowrap; }
        .ce-pick i{ width:1rem; height:1rem; }
        .ce-pick-on{ border-color:var(--accent,#1C1A16); color:var(--ink,#1C1A16); }

        .ce-about{ display:grid; gap:.4rem; }
        .ce-cost{ display:flex; align-items:flex-start; gap:.4rem;
            padding:.5rem .6rem; border-radius:.5rem;
            background:color-mix(in srgb, var(--accent,#1C1A16) 8%, transparent); }
        .ce-cost i{ flex-shrink:0; margin-top:.15rem; }

        .ce-opts{ display:grid; grid-template-columns:1fr 1fr; gap:.7rem; }
        @media (max-width:34rem){ .ce-opts{ grid-template-columns:1fr; } }
        .ce-color{ display:flex; align-items:center; gap:.4rem; }
        .ce-color input[type=color]{ width:2.6rem; height:2.2rem; padding:0; border:1px solid var(--line,#e5e5e5);
            border-radius:.4rem; background:none; cursor:pointer; }

        .ce-preview{ display:grid; gap:.4rem; }
        .ce-preview-head{ display:flex; align-items:center; justify-content:space-between; }
        .ce-preview iframe{ width:100%; height:var(--ce-h,480px);
            border:1px solid var(--line,#e5e5e5); border-radius:.75rem;
            background:var(--bg,#f6f3ed); display:block; }

        .ce-snippet{ font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.75rem;
            line-height:1.5; }

        /* Live data. The URL is the thing being handed over, so it gets the
           room: it wraps rather than truncating, because a half-shown endpoint
           is one a VA has to come back for. */
        .ce-feeds{ display:grid; gap:.1rem; }
        .ce-feed-row{ display:flex; align-items:flex-start; gap:.6rem; padding:.6rem 0;
            border-top:1px solid var(--line,#e5e5e5); }
        .ce-feed-row:first-child{ border-top:0; }
        .ce-feed-main{ flex:1; min-width:0; }
        .ce-feed-main code{ display:block; font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
            font-size:.72rem; color:var(--ink,#1C1A16); word-break:break-all; }
        .ce-feed-main .cp-note{ margin:.15rem 0 0; }
        .ce-feed-acts{ display:flex; gap:.3rem; flex-shrink:0; }
        .ce-code{ margin:.7rem 0 0; padding:.6rem .7rem; border-radius:.5rem; overflow-x:auto;
            background:color-mix(in srgb, var(--ink,#1C1A16) 6%, transparent);
            font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.72rem;
            line-height:1.55; color:var(--muted,#736E64); }
        .ce-copy-row{ display:flex; gap:.5rem; margin-top:.6rem; flex-wrap:wrap; }

        /* Mobile. The widget picker becomes a scrolling rail with the edge
           faded, so it reads as "there is more" rather than as a clipped row.
           The preview is capped at a share of the viewport: a 560px iframe on a
           phone is the whole screen, and the snippet — the thing the panel
           exists to hand over — would be below the fold every time. */
        @media (max-width:40rem){
            .ce-picker{ margin:0 -.85rem; padding:0 .85rem .25rem;
                scroll-snap-type:x proximity; -webkit-overflow-scrolling:touch;
                mask-image:linear-gradient(90deg,#000 calc(100% - 2rem),transparent);
                -webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 2rem),transparent); }
            .ce-pick{ scroll-snap-align:start; min-height:2.75rem; }
            .ce-opts{ grid-template-columns:1fr; }
            .ce-preview iframe{ height:min(var(--ce-h,480px), 52vh); height:min(var(--ce-h,480px), 52dvh); }
            .ce-copy-row .cp-btn{ flex:1 1 100%; justify-content:center; }
            .ce-snippet{ font-size:.72rem; }
            .ce-feed-row{ flex-direction:column; gap:.4rem; }
            .ce-feed-acts .cp-btn{ min-height:2.25rem; }
        }`);
    }

    /* =====================================================================
     * PUBLIC API
     * =================================================================== */

    /**
     * `code` is the VA's callsign code and `name` its display name — both come
     * from the host page's branding, which has already resolved them. The
     * accent is read off the live CSS token rather than passed, so a VA who has
     * themed their crew center gets a snippet themed to match without this
     * panel having to know anything about crewBrand.js.
     */
    function open({ slug, code, name, backend } = {}) {
        injectStyles();
        if (!panel) panel = P.sheet({ id: 'cePanel', title: 'Embeds', icon: 'code-xml', wide: true });
        S.slug = String(slug || '').toLowerCase();
        S.code = String(code || '').trim();
        S.name = String(name || '').trim();
        S.backend = String(backend || DEFAULT_BACKEND).replace(/\/+$/, '');
        S.accent = readAccent();
        panel.open();
        render();
    }

    function readAccent() {
        try {
            const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
            // Only a hex is any use as a URL parameter; a VA theme could have
            // set this to anything CSS accepts.
            return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : '';
        } catch { return ''; }
    }

    window.CrewEmbeds = {
        open,
        close: () => panel && panel.close(),
        get widgets() { return WIDGETS.map((w) => ({ id: w.id, label: w.label })); },
    };
})();
