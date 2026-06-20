/**
 * vaAds.js — VA-Ads client for the live tracker.
 *
 * Talks to the read-only VA-Ads endpoints served by the InGdo backend (the
 * same service that powers community aircraft photos). Replaces the old
 * Supabase "VA Partnership" system entirely.
 *
 *   GET /api/va-ads                     list (paginated, filterable)
 *   GET /api/va-ads/banner/:icao        banner ad(s) for an airport
 *   GET /api/va-ads/:id                 single ad by id
 *
 * Surfaces two things on the tracker:
 *   1. A banner inside the airport-info window for VAs hubbed at that field
 *      (window.InflightVaAds.hydrateAirportBanner(container, icao)).
 *   2. A "Partners" slide-over launched from the dashboard toolbar
 *      (window.InflightVaAds.openPartners()).
 *
 * Exposed as window.InflightVaAds. Loaded as a plain (non-module) script so it
 * is available synchronously before the deferred module scripts run.
 */
(function () {
    'use strict';

    const API_BASE = 'https://site--indgo-backend--6dmjph8ltlhv.code.run/api/va-ads';

    // ---------------------------------------------------------------------
    // Tiny helpers
    // ---------------------------------------------------------------------

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Only allow http(s) links through; anything else (javascript:, etc.) is
    // dropped so external ad data can't smuggle a dangerous href in.
    function safeUrl(u) {
        const s = String(u || '').trim();
        return /^https?:\/\//i.test(s) ? s : '';
    }

    // Leading callsign word, upper-cased — "Ocean XXVA" / "OceanXXVA" / "Ocean
    // 123" all reduce to "OCEAN". This is what we advertise against so a VA
    // whose callsign is "Ocean XXVA" matches any "Ocean …" flight.
    function firstToken(s) {
        return String(s || '').trim().toUpperCase().split(/[\s\-_/]+/)[0] || '';
    }

    async function getJSON(url) {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`VA-Ads request failed (${res.status})`);
        return res.json();
    }

    function buildQuery(params) {
        const q = new URLSearchParams();
        Object.keys(params || {}).forEach((k) => {
            const v = params[k];
            if (v !== undefined && v !== null && v !== '') q.set(k, v);
        });
        const s = q.toString();
        return s ? `?${s}` : '';
    }

    // The backend's exact field names aren't pinned down here, so normalise the
    // common variants into one predictable shape the renderers can rely on.
    function normalizeAd(ad) {
        if (!ad || typeof ad !== 'object') return null;
        const tags = Array.isArray(ad.tags)
            ? ad.tags
            : (typeof ad.tags === 'string'
                ? ad.tags.split(',').map((t) => t.trim()).filter(Boolean)
                : []);
        let icaoRaw = ad.icao != null ? ad.icao : (ad.hubs != null ? ad.hubs : ad.hub);
        const icao = Array.isArray(icaoRaw)
            ? icaoRaw
            : (typeof icaoRaw === 'string'
                ? icaoRaw.split(',').map((t) => t.trim()).filter(Boolean)
                : []);
        return {
            id: ad.id || ad._id || '',
            callsign: String(ad.callsign || ad.callsignCode || ad.code || '').trim().toUpperCase(),
            name: ad.name || ad.vaName || ad.title || 'Unknown VA',
            tagline: ad.tagline || ad.slogan || '',
            description: ad.description || ad.desc || '',
            type: String(ad.type || '').toUpperCase(),
            region: ad.region || '',
            recruiting: ad.recruiting === true || ad.recruiting === 'true',
            featured: ad.featured === true || ad.featured === 'true',
            tags: tags,
            logo: safeUrl(ad.logo || ad.logoUrl || ad.logo_url),
            banner: safeUrl(ad.banner || ad.bannerUrl || ad.banner_url || ad.image),
            website: safeUrl(ad.website || ad.websiteUrl || ad.website_url || ad.url || ad.link),
            discord: safeUrl(ad.discord || ad.discordUrl || ad.discord_url),
            icao: icao.map((c) => String(c).toUpperCase()),
            views: Number(ad.views != null ? ad.views : (ad.viewCount != null ? ad.viewCount : 0)) || 0
        };
    }

    function normalizeList(payload) {
        const arr = Array.isArray(payload)
            ? payload
            : (payload && Array.isArray(payload.data) ? payload.data : []);
        return arr.map(normalizeAd).filter(Boolean);
    }

    // ---------------------------------------------------------------------
    // Data API
    // ---------------------------------------------------------------------

    async function list(params) {
        const payload = await getJSON(`${API_BASE}${buildQuery(params)}`);
        return {
            ads: normalizeList(payload),
            pagination: (payload && payload.pagination) || null
        };
    }

    async function banner(icao, opts) {
        const code = String(icao || '').trim().toUpperCase();
        if (!code) return [];
        const payload = await getJSON(`${API_BASE}/banner/${encodeURIComponent(code)}${buildQuery(opts)}`);
        // ?pick=random returns a single ad object under data.
        if (payload && payload.data && !Array.isArray(payload.data)) {
            const one = normalizeAd(payload.data);
            return one ? [one] : [];
        }
        return normalizeList(payload);
    }

    async function get(id) {
        if (!id) return null;
        const payload = await getJSON(`${API_BASE}/${encodeURIComponent(id)}`);
        return normalizeAd(payload && payload.data ? payload.data : payload);
    }

    // ---------------------------------------------------------------------
    // Callsign directory — maps partner VA callsign codes to their ad so a
    // live flight can be matched to the VA whose code its callsign starts with.
    // ---------------------------------------------------------------------

    let directoryPromise = null;
    let directory = null; // [{ code, ad }] sorted longest-code-first
    let allAds = [];      // every partner ad we pulled (used for hub lookups)

    function loadDirectory() {
        if (directoryPromise) return directoryPromise;
        directoryPromise = (async () => {
            const all = [];
            try {
                // A few pages is plenty to cover the partner roster; bail early
                // once we've seen the last page.
                for (let page = 1; page <= 3; page++) {
                    const { ads, pagination } = await list({ limit: 100, page });
                    all.push(...ads);
                    if (!ads.length) break;
                    if (pagination && pagination.totalPages && page >= pagination.totalPages) break;
                    if (!pagination) break;
                }
            } catch (e) {
                // Keep whatever we managed to collect; matching just covers less.
            }
            allAds = all;
            directory = all
                .map((ad) => ({ code: firstToken(ad.callsign), ad }))
                .filter((entry) => entry.code)
                .sort((a, b) => b.code.length - a.code.length);
            return directory;
        })();
        return directoryPromise;
    }

    // Match a flight callsign to a partner VA by its leading word only (e.g. a
    // callsign of "Ocean XXVA" or "Ocean 123" matches the VA whose code is
    // "OCEAN"). Longest code wins; returns the first match. Synchronous — reads
    // the warm cache.
    function matchCallsign(callsign) {
        if (!directory) { loadDirectory(); return null; }
        const tok = firstToken(callsign);
        if (!tok) return null;
        const hit = directory.find((entry) => tok.startsWith(entry.code));
        return hit ? hit.ad : null;
    }

    // All partner ads hubbed at an airport (from the cached roster — no extra
    // request). Used to flag airports in search results.
    function partnersForIcao(icao) {
        const code = String(icao || '').trim().toUpperCase();
        if (!code || !allAds.length) return [];
        return allAds.filter((ad) => ad.icao && ad.icao.indexOf(code) !== -1);
    }

    // Small inline badge for a callsign-matched partner VA. variant 'hover' is
    // a logo-only chip for the map hover card; 'info' is a logo + name row for
    // the flight info window, with a membership disclaimer when the pilot is
    // not flagged as a VA member. Returns '' when there is no match.
    function callsignBadgeHTML(callsign, opts) {
        injectStyles();
        const ad = matchCallsign(callsign);
        if (!ad) return '';
        const o = opts || {};
        const logo = ad.logo
            ? `<img class="va-cs-logo" src="${esc(ad.logo)}" alt="" onerror="this.style.display='none'">`
            : '';
        if (o.variant === 'hover') {
            return logo
                ? `<span class="va-cs-badge va-cs-hover" title="${esc(ad.name)} · partner VA">${logo}</span>`
                : '';
        }
        const disclaimer = o.isMember
            ? ''
            : `<span class="va-cs-note">not a registered ${esc(ad.name)} member</span>`;
        return `
            <div class="va-cs-badge va-cs-info" data-va-ad-id="${esc(ad.id)}" role="button" tabindex="0" title="View ${esc(ad.name)}">
                ${logo || '<i class="fa-solid fa-handshake-angle" style="color:#7dd3fc"></i>'}
                <span class="va-cs-name">${esc(ad.name)} <span class="va-cs-tag">Partner VA</span></span>
                ${disclaimer}
            </div>`;
    }

    // ---------------------------------------------------------------------
    // Styles
    // ---------------------------------------------------------------------

    let stylesInjected = false;
    function injectStyles() {
        if (stylesInjected || typeof document === 'undefined') return;
        stylesInjected = true;
        const style = document.createElement('style');
        style.id = 'va-ads-styles';
        style.textContent = `
            .va-ad-banner-slot { margin: 16px; }
            .va-ad-logo {
                width: 44px; height: 44px; border-radius: 10px; object-fit: cover;
                background: rgba(0,0,0,0.35); flex: 0 0 auto;
                display: flex; align-items: center; justify-content: center; color: #7dd3fc;
            }
            .va-ad-eyebrow {
                font-size: 0.6rem; font-weight: 800; letter-spacing: .08em;
                text-transform: uppercase; color: #7dd3fc; display: flex; gap: 8px; align-items: center;
            }
            .va-ad-name { font-weight: 700; color: #fff; font-size: 0.95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .va-ad-tag { font-size: 0.78rem; color: rgba(255,255,255,0.6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .va-ad-pill {
                font-size: 0.58rem; font-weight: 800; text-transform: uppercase; letter-spacing: .05em;
                padding: 2px 6px; border-radius: 999px;
                background: rgba(74,222,128,0.15); color: #4ade80; border: 1px solid rgba(74,222,128,0.35);
            }
            .va-ad-pill.va-ad-pill-featured { background: rgba(250,204,21,0.15); color: #facc15; border-color: rgba(250,204,21,0.35); }

            .va-ad-feature {
                position: relative; cursor: pointer; overflow: hidden; border-radius: 14px;
                border: 1px solid rgba(255,255,255,0.08);
                background: linear-gradient(135deg, rgba(56,189,248,0.10), rgba(23,23,23,0.55));
                transition: border-color .15s ease, transform .15s ease;
            }
            .va-ad-feature:hover { border-color: rgba(56,189,248,0.4); transform: translateY(-1px); }
            .va-ad-feature-card { transition: opacity .25s ease; }
            .va-ad-feature-banner { height: 84px; background-size: cover; background-position: center; background-color: rgba(56,189,248,0.08); }
            .va-ad-feature-body { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; }
            .va-ad-feature-meta { min-width: 0; flex: 1; }
            .va-ad-feature .va-ad-name { white-space: normal; }
            .va-ad-dots { display: flex; gap: 5px; justify-content: center; padding: 0 0 10px; }
            .va-ad-dot { width: 5px; height: 5px; border-radius: 50%; background: rgba(255,255,255,0.3); transition: background .2s ease, transform .2s ease; }
            .va-ad-dot.is-active { background: #7dd3fc; transform: scale(1.3); }

            .va-cs-badge { display: inline-flex; align-items: center; gap: 6px; vertical-align: middle; }
            .va-cs-hover { margin-left: 6px; }
            .va-cs-logo { width: 16px; height: 16px; border-radius: 4px; object-fit: cover; background: rgba(0,0,0,0.3); flex: 0 0 auto; }
            .va-cs-info {
                margin-top: 8px; padding: 5px 9px; border-radius: 8px; cursor: pointer; max-width: 100%;
                background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.12); backdrop-filter: blur(4px);
                flex-wrap: wrap;
            }
            .va-cs-info:hover { border-color: rgba(56,189,248,0.4); }
            .va-cs-info .va-cs-logo { width: 18px; height: 18px; }
            .va-cs-name { font-size: 11px; font-weight: 700; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.8); }
            .va-cs-tag { font-size: 8.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; color: #7dd3fc; margin-left: 2px; }
            .va-cs-note { font-size: 9px; font-weight: 600; color: #fca5a5; margin-left: 4px; }

            /* Collapsible hero badge: opens full, then shrinks to a logo-only
               chip a few seconds after the window opens. Hovering (or keyboard
               focus) re-expands it. Driven by the .va-cs-collapsed class that
               flight.js toggles on a timer. */
            .va-cs-info { transition: padding .3s ease, gap .3s ease, background .2s ease, border-color .2s ease; overflow: hidden; }
            .va-cs-name, .va-cs-note {
                white-space: nowrap; overflow: hidden;
                max-width: 320px; opacity: 1;
                transition: max-width .35s ease, opacity .25s ease, margin .3s ease;
            }
            .va-cs-info.va-cs-collapsed { gap: 0; }
            .va-cs-info.va-cs-collapsed .va-cs-name,
            .va-cs-info.va-cs-collapsed .va-cs-note {
                max-width: 0; opacity: 0; margin-left: 0;
            }
            .va-cs-info.va-cs-collapsed:hover .va-cs-name,
            .va-cs-info.va-cs-collapsed:focus-within .va-cs-name,
            .va-cs-info.va-cs-collapsed:hover .va-cs-note,
            .va-cs-info.va-cs-collapsed:focus-within .va-cs-note {
                max-width: 320px; opacity: 1; margin-left: 4px;
            }

            .va-partners-overlay {
                position: fixed; inset: 0; z-index: 4000;
                display: flex; justify-content: flex-end;
                background: rgba(0,0,0,0.55); backdrop-filter: blur(4px);
                opacity: 0; pointer-events: none; transition: opacity .2s ease;
            }
            .va-partners-overlay.visible { opacity: 1; pointer-events: auto; }
            .va-partners-panel {
                width: min(440px, 100%); height: 100%; display: flex; flex-direction: column;
                background: #121212; border-left: 1px solid rgba(255,255,255,0.08);
                transform: translateX(20px); transition: transform .2s ease;
            }
            .va-partners-overlay.visible .va-partners-panel { transform: translateX(0); }
            .va-partners-head {
                display: flex; align-items: center; gap: 10px; padding: 18px 18px 12px;
                border-bottom: 1px solid rgba(255,255,255,0.06);
            }
            .va-partners-head h2 { font-size: 1.05rem; font-weight: 800; color: #fff; margin: 0; flex: 1; }
            .va-partners-close {
                background: rgba(255,255,255,0.06); border: none; color: #fff; cursor: pointer;
                width: 34px; height: 34px; border-radius: 9px; font-size: 0.95rem;
            }
            .va-partners-close:hover { background: rgba(255,255,255,0.12); }
            .va-partners-search { padding: 12px 18px; border-bottom: 1px solid rgba(255,255,255,0.06); }
            .va-partners-search input {
                width: 100%; box-sizing: border-box; padding: 9px 12px; border-radius: 10px;
                background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.12);
                color: #fff; font-size: 0.85rem;
            }
            .va-partners-body { flex: 1; overflow-y: auto; padding: 14px 18px; display: flex; flex-direction: column; gap: 12px; }
            .va-partners-empty { color: rgba(255,255,255,0.55); text-align: center; padding: 40px 10px; font-size: 0.9rem; }
            .va-ad-card {
                border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; overflow: hidden;
                background: rgba(255,255,255,0.03); cursor: pointer; transition: border-color .15s ease, transform .15s ease;
            }
            .va-ad-card:hover { border-color: rgba(56,189,248,0.4); transform: translateY(-2px); }
            .va-ad-card-banner { height: 92px; background-size: cover; background-position: center; background-color: rgba(56,189,248,0.08); }
            .va-ad-card-body { padding: 12px 14px; display: flex; gap: 12px; align-items: flex-start; }
            .va-ad-card-body .va-ad-logo { width: 40px; height: 40px; }
            .va-ad-card-title { font-weight: 700; color: #fff; font-size: 0.92rem; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
            .va-ad-card-sub { font-size: 0.78rem; color: rgba(255,255,255,0.6); margin-top: 2px; }
            .va-ad-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
            .va-ad-chip { font-size: 0.62rem; color: rgba(255,255,255,0.7); background: rgba(255,255,255,0.07); border-radius: 999px; padding: 2px 8px; }

            .va-ad-detail-banner { height: 140px; background-size: cover; background-position: center; background-color: rgba(56,189,248,0.1); border-radius: 14px; }
            .va-ad-detail h3 { color: #fff; font-size: 1.2rem; font-weight: 800; margin: 14px 0 4px; }
            .va-ad-detail p.desc { color: rgba(255,255,255,0.75); font-size: 0.88rem; line-height: 1.55; white-space: pre-wrap; }
            .va-ad-detail .va-ad-actions { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
            .va-ad-btn {
                display: inline-flex; align-items: center; gap: 8px; text-decoration: none;
                padding: 9px 14px; border-radius: 10px; font-weight: 700; font-size: 0.82rem;
                background: rgba(56,189,248,0.15); color: #7dd3fc; border: 1px solid rgba(56,189,248,0.35);
            }
            .va-ad-btn:hover { background: rgba(56,189,248,0.25); }
            .va-ad-back {
                background: none; border: none; color: #7dd3fc; cursor: pointer; font-weight: 700;
                font-size: 0.82rem; padding: 0; margin-bottom: 8px; display: inline-flex; gap: 6px; align-items: center;
            }`;
        document.head.appendChild(style);
    }

    // ---------------------------------------------------------------------
    // Airport-window banner
    // ---------------------------------------------------------------------

    // Inner markup of one feature card (banner image + logo + meta), styled
    // like the Partners-tab cards rather than the old single-line strip.
    function featureCardInner(ad) {
        const logo = ad.logo
            ? `<img class="va-ad-logo" src="${esc(ad.logo)}" alt="" onerror="this.style.display='none'">`
            : `<div class="va-ad-logo"><i class="fa-solid fa-building"></i></div>`;
        const pills = [];
        if (ad.featured) pills.push('<span class="va-ad-pill va-ad-pill-featured">Featured</span>');
        if (ad.recruiting) pills.push('<span class="va-ad-pill">Recruiting</span>');
        const chips = (ad.tags || []).slice(0, 3).map((tg) => `<span class="va-ad-chip">${esc(tg)}</span>`).join('');
        return `
            ${ad.banner ? `<div class="va-ad-feature-banner" style="background-image:url('${esc(ad.banner)}')"></div>` : ''}
            <div class="va-ad-feature-body">
                ${logo}
                <div class="va-ad-feature-meta">
                    <div class="va-ad-eyebrow"><i class="fa-solid fa-handshake-angle"></i> VA Partner ${pills.join(' ')}</div>
                    <div class="va-ad-name">${esc(ad.name)}</div>
                    ${ad.tagline ? `<div class="va-ad-tag">${esc(ad.tagline)}</div>` : ''}
                    ${chips ? `<div class="va-ad-chips">${chips}</div>` : ''}
                </div>
                <i class="fa-solid fa-chevron-right" style="color:rgba(255,255,255,0.4); align-self:center;"></i>
            </div>`;
    }

    // Render a (possibly rotating) feature card into a slot. When several VAs
    // share the slot we never stack them all at once — we show one card and
    // quietly cycle through them so each partner gets fair exposure. The
    // rotation timer is stored per-slot so independent slots (e.g. an airport
    // window and a flight window open at once) never clobber each other.
    function renderAdFeature(slot, ads) {
        if (!slot) return;
        if (slot._adRotateTimer) { clearInterval(slot._adRotateTimer); slot._adRotateTimer = null; }
        if (!ads || !ads.length) { slot.innerHTML = ''; slot.style.display = 'none'; return; }
        slot.style.display = '';

        slot.innerHTML = `
            <div class="va-ad-feature" data-va-ad-id="${esc(ads[0].id)}" role="button" tabindex="0">
                <div class="va-ad-feature-card"></div>
                ${ads.length > 1 ? '<div class="va-ad-dots"></div>' : ''}
            </div>`;
        const featureEl = slot.querySelector('.va-ad-feature');
        const cardEl = slot.querySelector('.va-ad-feature-card');
        const dotsEl = slot.querySelector('.va-ad-dots');

        let idx = 0;
        const render = () => {
            const ad = ads[idx];
            featureEl.setAttribute('data-va-ad-id', ad.id);
            cardEl.innerHTML = featureCardInner(ad);
            if (dotsEl) {
                dotsEl.innerHTML = ads
                    .map((_, i) => `<span class="va-ad-dot${i === idx ? ' is-active' : ''}"></span>`)
                    .join('');
            }
        };
        render();

        featureEl.addEventListener('click', () => openPartners(featureEl.getAttribute('data-va-ad-id')));

        if (ads.length > 1) {
            slot._adRotateTimer = setInterval(() => {
                // Stop once the host window (and this slot) is gone.
                if (!document.body.contains(cardEl)) {
                    clearInterval(slot._adRotateTimer);
                    slot._adRotateTimer = null;
                    return;
                }
                cardEl.style.opacity = '0';
                setTimeout(() => {
                    idx = (idx + 1) % ads.length;
                    render();
                    cardEl.style.opacity = '1';
                }, 220);
            }, 6000);
        }
    }

    async function hydrateAirportBanner(container, icao) {
        injectStyles();
        const root = container || document;
        const slot = root.querySelector ? root.querySelector('#apt-va-banner') : null;
        if (!slot) return;
        try {
            const ads = await banner(icao, { limit: 8 });
            renderAdFeature(slot, ads);
        } catch (e) {
            // A missing/unreachable ads service must never break the airport panel.
            slot.innerHTML = '';
            slot.style.display = 'none';
        }
    }

    // Flight info window ad: prefer the flight's OWN partner VA (matched by
    // callsign), and when the callsign isn't a partner fall back to the
    // partner VAs hubbed at the arrival, then departure airport so the slot is
    // rarely empty. Renders into a '#ac-va-banner' slot inside the container.
    async function hydrateFlightBanner(container, opts) {
        injectStyles();
        const root = container || document;
        const slot = root.querySelector ? root.querySelector('#ac-va-banner') : null;
        if (!slot) return;
        const o = opts || {};
        try {
            await loadDirectory();
            let ads = [];
            const own = matchCallsign(o.callsign);
            if (own) {
                ads = [own];
            } else {
                const codes = [o.arrIcao, o.depIcao]
                    .map((c) => String(c || '').trim().toUpperCase())
                    .filter(Boolean);
                for (const code of codes) {
                    const hub = await banner(code, { limit: 6 });
                    if (hub && hub.length) { ads = hub; break; }
                }
            }
            renderAdFeature(slot, ads);
        } catch (e) {
            // The ads service must never break the flight window.
            slot.innerHTML = '';
            slot.style.display = 'none';
        }
    }

    // ---------------------------------------------------------------------
    // Partners slide-over
    // ---------------------------------------------------------------------

    let overlayEl = null;

    function ensureOverlay() {
        if (overlayEl) return overlayEl;
        injectStyles();
        overlayEl = document.createElement('div');
        overlayEl.className = 'va-partners-overlay';
        overlayEl.innerHTML = `
            <div class="va-partners-panel" role="dialog" aria-label="VA Partners">
                <div class="va-partners-head">
                    <h2>VA Partners</h2>
                    <button class="va-partners-close" title="Close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="va-partners-search">
                    <input type="text" placeholder="Search partners by name, region, tag…" autocomplete="off">
                </div>
                <div class="va-partners-body"></div>
            </div>`;
        document.body.appendChild(overlayEl);

        overlayEl.addEventListener('click', (e) => {
            if (e.target === overlayEl) closePartners();
        });
        overlayEl.querySelector('.va-partners-close').addEventListener('click', closePartners);

        const input = overlayEl.querySelector('.va-partners-search input');
        let t = 0;
        input.addEventListener('input', () => {
            clearTimeout(t);
            t = setTimeout(() => loadPartnersList(input.value.trim()), 280);
        });
        return overlayEl;
    }

    function cardHTML(ad) {
        const logo = ad.logo
            ? `<img class="va-ad-logo" src="${esc(ad.logo)}" alt="" onerror="this.style.display='none'">`
            : `<div class="va-ad-logo"><i class="fa-solid fa-building"></i></div>`;
        const pills = [];
        if (ad.featured) pills.push('<span class="va-ad-pill va-ad-pill-featured">Featured</span>');
        if (ad.recruiting) pills.push('<span class="va-ad-pill">Recruiting</span>');
        const sub = [ad.type, ad.region].filter(Boolean).join(' · ');
        const chips = (ad.tags || []).slice(0, 4).map((tg) => `<span class="va-ad-chip">${esc(tg)}</span>`).join('');
        return `
            <div class="va-ad-card" data-va-ad-id="${esc(ad.id)}" role="button" tabindex="0">
                ${ad.banner ? `<div class="va-ad-card-banner" style="background-image:url('${esc(ad.banner)}')"></div>` : ''}
                <div class="va-ad-card-body">
                    ${logo}
                    <div style="min-width:0; flex:1;">
                        <div class="va-ad-card-title">${esc(ad.name)} ${pills.join(' ')}</div>
                        ${sub ? `<div class="va-ad-card-sub">${esc(sub)}</div>` : ''}
                        ${ad.tagline ? `<div class="va-ad-card-sub">${esc(ad.tagline)}</div>` : ''}
                        ${chips ? `<div class="va-ad-chips">${chips}</div>` : ''}
                    </div>
                </div>
            </div>`;
    }

    function bindCards(body) {
        body.querySelectorAll('[data-va-ad-id]').forEach((el) => {
            el.addEventListener('click', () => showDetail(el.getAttribute('data-va-ad-id')));
        });
    }

    async function loadPartnersList(search) {
        const body = overlayEl.querySelector('.va-partners-body');
        body.innerHTML = `<div class="va-partners-empty"><i class="fa-solid fa-spinner fa-spin"></i> Loading partners…</div>`;
        try {
            const { ads } = await list({ sort: 'popular', limit: 50, search: search || undefined });
            if (!ads.length) {
                body.innerHTML = `<div class="va-partners-empty">No partners found.</div>`;
                return;
            }
            // Featured first, otherwise keep server order.
            ads.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
            body.innerHTML = ads.map(cardHTML).join('');
            bindCards(body);
        } catch (e) {
            body.innerHTML = `<div class="va-partners-empty">Couldn't load partners right now.</div>`;
        }
    }

    async function showDetail(id) {
        const body = overlayEl.querySelector('.va-partners-body');
        body.innerHTML = `<div class="va-partners-empty"><i class="fa-solid fa-spinner fa-spin"></i> Loading…</div>`;
        try {
            const ad = await get(id);
            if (!ad) { body.innerHTML = `<div class="va-partners-empty">Partner not found.</div>`; return; }
            const pills = [];
            if (ad.featured) pills.push('<span class="va-ad-pill va-ad-pill-featured">Featured</span>');
            if (ad.recruiting) pills.push('<span class="va-ad-pill">Recruiting</span>');
            const sub = [ad.type, ad.region, ad.icao.join(', ')].filter(Boolean).join(' · ');
            const chips = (ad.tags || []).map((tg) => `<span class="va-ad-chip">${esc(tg)}</span>`).join('');
            const actions = [];
            if (ad.website) actions.push(`<a class="va-ad-btn" href="${esc(ad.website)}" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-globe"></i> Website</a>`);
            if (ad.discord) actions.push(`<a class="va-ad-btn" href="${esc(ad.discord)}" target="_blank" rel="noopener noreferrer"><i class="fa-brands fa-discord"></i> Discord</a>`);
            body.innerHTML = `
                <div class="va-ad-detail">
                    <button class="va-ad-back"><i class="fa-solid fa-arrow-left"></i> All partners</button>
                    ${ad.banner ? `<div class="va-ad-detail-banner" style="background-image:url('${esc(ad.banner)}')"></div>` : ''}
                    <h3>${esc(ad.name)} ${pills.join(' ')}</h3>
                    ${sub ? `<div class="va-ad-card-sub">${esc(sub)}</div>` : ''}
                    ${ad.tagline ? `<div class="va-ad-card-sub" style="margin-top:4px">${esc(ad.tagline)}</div>` : ''}
                    ${ad.description ? `<p class="desc" style="margin-top:12px">${esc(ad.description)}</p>` : ''}
                    ${chips ? `<div class="va-ad-chips" style="margin-top:12px">${chips}</div>` : ''}
                    ${actions.length ? `<div class="va-ad-actions">${actions.join('')}</div>` : ''}
                </div>`;
            const back = body.querySelector('.va-ad-back');
            if (back) back.addEventListener('click', () => loadPartnersList(''));
        } catch (e) {
            body.innerHTML = `<div class="va-partners-empty">Couldn't load this partner.</div>`;
        }
    }

    function openPartners(adId) {
        ensureOverlay();
        overlayEl.classList.add('visible');
        if (adId) showDetail(adId);
        else loadPartnersList('');
    }

    function closePartners() {
        if (overlayEl) overlayEl.classList.remove('visible');
    }

    // ---------------------------------------------------------------------
    // Toolbar launcher
    // ---------------------------------------------------------------------

    function wireToolbarButton() {
        const btn = document.getElementById('toolbar-partners-btn');
        if (btn && !btn.dataset.vaAdsWired) {
            btn.dataset.vaAdsWired = 'true';
            btn.addEventListener('click', () => openPartners());
        }
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', wireToolbarButton);
        } else {
            wireToolbarButton();
        }
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlayEl && overlayEl.classList.contains('visible')) closePartners();
        });
        // Any callsign-match "info" badge (injected into the flight info window)
        // opens that partner's detail when clicked, wherever it lives.
        document.addEventListener('click', (e) => {
            const el = e.target.closest && e.target.closest('.va-cs-info[data-va-ad-id]');
            if (el) { e.preventDefault(); openPartners(el.getAttribute('data-va-ad-id')); }
        });
        // The simple flight window lives in an iframe and asks the host (here)
        // to open a partner when its badge is tapped.
        window.addEventListener('message', (e) => {
            const d = e && e.data;
            if (d && d.type === 'INFLIGHT_OPEN_VA_PARTNER' && d.id) openPartners(d.id);
        });

        const isTopWindow = (window === window.parent);
        if (isTopWindow) {
            // Warm the callsign directory so hover/info badges resolve instantly.
            loadDirectory();
        }
    }

    window.InflightVaAds = {
        list,
        banner,
        get,
        hydrateAirportBanner,
        hydrateFlightBanner,
        openPartners,
        closePartners,
        matchCallsign,
        callsignBadgeHTML,
        partnersForIcao,
        loadDirectory
    };
})();
