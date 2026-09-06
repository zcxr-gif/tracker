/**
 * crewSocial.js — the VA's Instagram wall.
 *
 * Staff paste the links to posts they want on the crew center; everyone sees
 * them in a column they can scroll. Desktop gets a rail down the side, a phone
 * gets a row it swipes sideways.
 *
 * WHY LINKS AND NOT A PROFILE FEED. Instagram stopped letting anyone embed a
 * profile years ago — pulling "the latest N posts" needs the Graph API, which
 * needs a Facebook app, a Business account and a token to keep alive. That is
 * a lot of scaffolding for a VA. A single POST still embeds with no API at all,
 * so a wall of chosen posts is the version that works without asking a VA to
 * become a Meta developer. The trade is that it does not update itself: staff
 * pick what hangs there, which is closer to how the rest of this crew center
 * works anyway.
 *
 * THE URL IS NEVER PASSED THROUGH. What staff paste is parsed down to a
 * shortcode — the `[A-Za-z0-9_-]` id in /p/<code>/ — and the embed address is
 * rebuilt from it here. Nothing a staff member types reaches an iframe `src`,
 * so a pasted `javascript:` or a look-alike host cannot become a frame.
 *
 * EMBEDS ARE BUILT WHEN THEY COME INTO VIEW. Every Instagram embed loads a
 * whole Instagram page and its scripts. Six of them mounted at once is several
 * megabytes for something sitting off the side of a dashboard, so each is a
 * still placeholder until it is scrolled to.
 *
 * Loaded as a classic script, like crewNotices.js and crewLinks.js, because the
 * crew pages are not bundled.
 */

(function (global) {
    'use strict';

    const doc = global.document;

    // Instagram's own embeds refuse to lay out under 326px, so that is the
    // width one is built at. A narrower rail scales the whole frame down rather
    // than letting it be clipped — see mount().
    const EMBED_W = 326;
    // Nothing can measure a cross-origin frame, and Instagram's resize script
    // only talks to a host that has loaded their embed.js. So the height is
    // ours to choose: this is a square photo plus room for a couple of lines of
    // caption, which is the shape most VA posts are.
    const EMBED_H = 470;
    const MAX_POSTS = 12;

    /**
     * The shortcode and kind out of anything a staff member might paste —
     * a share link, a copied address bar, with or without tracking junk.
     * Returns null for anything that is not an Instagram post.
     */
    function parsePost(input) {
        const raw = String(input || '').trim();
        if (!raw) return null;
        let u;
        try { u = new URL(raw.startsWith('http') ? raw : 'https://' + raw); } catch (_) { return null; }
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
        // The host must BE instagram, not merely end with it: `notinstagram.com`
        // and `instagram.com.evil.test` both end the naive check.
        const host = u.hostname.toLowerCase().replace(/^www\./, '');
        if (host !== 'instagram.com' && !host.endsWith('.instagram.com')) return null;
        // /p/<code>, /reel/<code>, /reels/<code>, /tv/<code>, optionally behind
        // a profile segment (/<user>/p/<code>).
        const m = u.pathname.match(/(?:^|\/)(p|reel|reels|tv)\/([A-Za-z0-9_-]{1,64})/);
        if (!m) return null;
        const kind = m[1] === 'reels' ? 'reel' : m[1];
        return { kind, code: m[2] };
    }

    /** The canonical link to a post, for the "open on Instagram" fallback. */
    function postUrl(p) { return `https://www.instagram.com/${p.kind}/${p.code}/`; }
    /** The embed address. Built here from a parsed code — never from input. */
    function embedUrl(p) { return `https://www.instagram.com/${p.kind}/${p.code}/embed/`; }

    /**
     * A stored config into the shape everything below expects. Invalid or
     * duplicate links are dropped rather than rendered as holes.
     */
    function normalize(social) {
        const s = social && typeof social === 'object' ? social : {};
        const handle = String(s.handle || '').trim().replace(/^@+/, '').slice(0, 40);
        const seen = new Set();
        const posts = [];
        (Array.isArray(s.posts) ? s.posts : []).forEach((entry) => {
            const p = parsePost(typeof entry === 'string' ? entry : (entry && entry.url));
            if (!p || seen.has(p.code)) return;
            seen.add(p.code);
            posts.push(p);
        });
        return { handle, posts: posts.slice(0, MAX_POSTS) };
    }

    /** True when there is anything worth giving space to. */
    function hasContent(social) {
        const s = normalize(social);
        return !!(s.posts.length || s.handle);
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    /**
     * Size every slot to the same scaled height, and tell callers the scale.
     *
     * A frame is always BUILT at EMBED_W and then scaled down, because
     * Instagram's own stylesheet gives it a hard min-width and a 300px rail
     * would otherwise clip the right edge off every post.
     *
     * The heights have to be set on the whole strip at once, not on each slot
     * as it mounts. They were, and it showed: a mounted slot shrank to its
     * scaled height while the ones still waiting kept the full unscaled one, so
     * the strip stayed as tall as its tallest unmounted member and left a band
     * of dead space under the post you were actually looking at.
     */
    function fit(host) {
        const strip = host && host.querySelector('.cs-strip');
        if (!strip) return 1;
        const first = strip.querySelector('.cs-slot');
        if (!first) return 1;
        const scale = Math.min(1, (first.clientWidth || EMBED_W) / EMBED_W);
        const h = Math.round(EMBED_H * scale) + 'px';
        strip.querySelectorAll('.cs-slot').forEach((s) => { s.style.height = h; });
        strip.querySelectorAll('iframe').forEach((f) => { f.style.transform = `scale(${scale})`; });
        return scale;
    }

    /** Swap a placeholder for the real embed. */
    function mount(slot) {
        if (slot.dataset.mounted) return;
        slot.dataset.mounted = '1';
        const p = { kind: slot.dataset.kind, code: slot.dataset.code };
        const width = slot.clientWidth || EMBED_W;
        const scale = Math.min(1, width / EMBED_W);

        const frame = doc.createElement('iframe');
        frame.src = embedUrl(p);
        frame.title = 'Instagram post';
        frame.loading = 'lazy';
        frame.setAttribute('scrolling', 'no');
        frame.setAttribute('allowtransparency', 'true');
        frame.setAttribute('frameborder', '0');
        // A cross-origin frame is its own origin, so allow-same-origin here lets
        // Instagram be Instagram — it grants nothing over this page. Scripts are
        // needed for the embed to render at all; popups let "view on Instagram"
        // work. Nothing else.
        frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
        frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        frame.style.cssText =
            `width:${EMBED_W}px;height:${EMBED_H}px;border:0;display:block;` +
            `transform:scale(${scale});transform-origin:top left;`;
        slot.innerHTML = '';
        slot.appendChild(frame);
    }

    let io = null;
    function observe(slot) {
        if (!('IntersectionObserver' in global)) { mount(slot); return; }
        if (!io) {
            io = new IntersectionObserver((entries) => {
                entries.forEach((e) => {
                    if (!e.isIntersecting) return;
                    mount(e.target);
                    io.unobserve(e.target);
                });
                // A rail that is off the bottom of a long dashboard should start
                // loading slightly before it is reached, not as it arrives.
            }, { rootMargin: '300px' });
        }
        io.observe(slot);
    }

    function slotHtml(p, i) {
        return `<div class="cs-slot" data-kind="${esc(p.kind)}" data-code="${esc(p.code)}"
                     style="height:${EMBED_H}px">
            <a class="cs-placeholder" href="${esc(postUrl(p))}" target="_blank" rel="noopener noreferrer">
                <span class="cs-ph-mark"><i data-lucide="instagram"></i></span>
                <span class="cs-ph-text">Post ${i + 1}</span>
            </a>
        </div>`;
    }

    /**
     * Paint the wall into `host`. Safe to call again — it rebuilds.
     * `social` is the stored config; anything invalid in it is simply not drawn.
     */
    function render(host, social) {
        if (!host) return;
        const s = normalize(social);
        if (!s.posts.length && !s.handle) { host.innerHTML = ''; return; }

        const follow = s.handle
            ? `<a class="cs-follow" href="https://www.instagram.com/${esc(s.handle)}/" target="_blank" rel="noopener noreferrer">@${esc(s.handle)}</a>`
            : '';

        host.innerHTML = s.posts.length
            ? `<div class="cs-strip">${s.posts.map(slotHtml).join('')}</div>${follow}`
            : `<p class="cs-empty">Nothing pinned here yet.</p>${follow}`;

        fit(host);
        host.querySelectorAll('.cs-slot').forEach(observe);
        if (global.lucide) global.lucide.createIcons();

        // A rail becomes a swipe row and back as the window crosses the
        // breakpoint, and the scale goes with it. One listener per host, marked
        // so re-rendering does not stack them up.
        if (!host.dataset.csResize) {
            host.dataset.csResize = '1';
            let t = null;
            global.addEventListener('resize', () => {
                clearTimeout(t);
                t = setTimeout(() => fit(host), 150);
            }, { passive: true });
        }
    }

    global.CrewSocial = { parsePost, postUrl, embedUrl, normalize, hasContent, render, fit, MAX_POSTS };
})(window);
