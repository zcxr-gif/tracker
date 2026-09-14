/**
 * crewBrand.js — paints a VA's own design system onto the Crew Center.
 *
 * Until now a VA could set exactly one thing about how its crew center looked:
 * `accent`, a single hex. Everything else — paper colour, hairlines, text
 * greys, corner radius, typeface — was the same warm-neutral shell for every
 * VA. That is fine in isolation and jarring the moment a VA has its own
 * website: pilots leave a branded site and land somewhere that looks like a
 * different product.
 *
 * The backend now returns a `theme` object from /api/va-ads/by-slug/<slug>
 * (see CrewThemeSchema in the database repo). This module is the one place that
 * maps those tokens onto the CSS custom properties the crew center pages
 * already style themselves with:
 *
 *     theme.light.bg        → --bg
 *     theme.light.surface   → --surface
 *     theme.light.line      → --line          … and so on
 *     theme.radius          → --radius
 *     theme.font            → --crew-font     (loaded from Google Fonts)
 *
 * Design notes:
 *
 * · Tokens in, CSS out. Nothing from the theme is interpolated as raw CSS. Hex
 *   colours are re-validated here even though the backend sanitises on write,
 *   because ?accent= style query overrides never touch the backend at all.
 *
 * · No theme = no change. A VA that hasn't set one gets exactly the stock crew
 *   center, byte for byte. This module writes nothing at all in that case.
 *
 * · One <style> element, replaced wholesale on each apply, so re-applying (a
 *   host pushing a theme change, say) can't pile up stylesheets.
 *
 * Usage — after branding resolves:
 *     CrewBrand.apply(brandingObject);      // reads .theme, ignores the rest
 *     CrewBrand.onMode(fn);                 // notified when light/dark flips
 *
 * Loaded as a classic script (not a module) because the crew pages are
 * standalone documents with inline scripts, not a bundled app.
 */

(function (global) {
    'use strict';

    const STYLE_ID = 'crew-brand-theme';
    const FONT_ID = 'crew-brand-fonts';
    const THEME_KEY = 'crew-theme';           // the key the crew pages already use

    // token key → CSS custom property. Only these ten cross the boundary.
    const TOKENS = {
        bg: '--bg',
        surface: '--surface',
        surface2: '--surface-2',
        line: '--line',
        lineSoft: '--line-soft',
        ink: '--ink',
        muted: '--muted',
        faint: '--faint',
        accent: '--accent',
        accentInk: '--accent-ink',
    };

    const isHex = (c) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c || '');
    const isFontName = (s) => /^[a-z0-9][a-z0-9 \-]{0,39}$/i.test(s || '');
    const isGradientArgs = (s) => {
        const v = String(s || '').trim();
        if (!v || v.length > 240) return false;
        if (!/^[#a-z0-9%.,\s-]+$/i.test(v)) return false;
        if (/url|expression|javascript|import|\/\*|\\/i.test(v)) return false;
        return /#([0-9a-f]{3}|[0-9a-f]{6})/i.test(v);
    };

    const modeListeners = [];
    let currentTheme = null;

    // ---- Palette → declarations -------------------------------------------
    //
    // Every token is published TWICE: --bg and --brand-bg, --ink and
    // --brand-ink, and so on. The first is what the pages have always read.
    // The second exists so a second interface can be layered underneath a
    // brand without fighting it — crewSkin.css writes
    //
    //     --bg: var(--brand-bg, <its own value>);
    //
    // at a higher specificity than this sheet, which would otherwise mean the
    // skin's palette beat the VA's. With the alias the precedence comes out
    // the only way that can be right: the VA's colours, in the skin's form,
    // and the skin's colours only where the VA has not said.
    function declarations(palette) {
        if (!palette) return '';
        const out = [];
        for (const key in TOKENS) {
            if (isHex(palette[key])) {
                out.push(`${TOKENS[key]}:${palette[key]};`);
                out.push(`--brand-${key}:${palette[key]};`);
            }
        }
        return out.join('');
    }

    // ---- Web fonts ---------------------------------------------------------
    // Families are re-validated here, then URL-encoded, so nothing can escape
    // the href even if this is ever called with unsanitised input.
    function loadFonts(theme) {
        const families = [];
        if (isFontName(theme.font)) families.push([theme.font, 'wght@300;400;500;600;700;800;900']);
        if (isFontName(theme.displayFont) && theme.displayFont !== theme.font) {
            families.push([theme.displayFont, 'wght@600;700;800']);
        }
        if (isFontName(theme.monoFont)) families.push([theme.monoFont, 'wght@400;500;700']);
        if (!families.length) return;

        const query = families
            .map(([name, weights]) => 'family=' + encodeURIComponent(name.trim().replace(/ /g, '+')).replace(/%2B/g, '+') + ':' + weights)
            .join('&');
        const href = `https://fonts.googleapis.com/css2?${query}&display=swap`;

        let link = document.getElementById(FONT_ID);
        if (!link) {
            link = document.createElement('link');
            link.id = FONT_ID;
            link.rel = 'stylesheet';
            document.head.appendChild(link);
        }
        if (link.href !== href) link.href = href;
    }

    // ---- The stylesheet ----------------------------------------------------
    function buildCss(theme) {
        const light = declarations(theme.light);
        const dark = declarations(theme.dark);

        const font = isFontName(theme.font) ? `'${theme.font}'` : '';
        const display = isFontName(theme.displayFont) ? `'${theme.displayFont}'` : font;
        const mono = isFontName(theme.monoFont) ? `'${theme.monoFont}'` : '';
        const radius = Number.isFinite(+theme.radius)
            ? Math.max(0, Math.min(32, Math.round(+theme.radius))) : null;
        const gradient = isGradientArgs(theme.gradient) ? theme.gradient.trim() : '';

        // 'Inter' is the crew center's own stack, so it stays as the fallback —
        // unless it IS the chosen face, in which case naming it twice is noise.
        const stack = (family) => family === "'Inter'"
            ? `${family},system-ui,sans-serif`
            : `${family},'Inter',system-ui,sans-serif`;

        const root = [
            light,
            font ? `--crew-font:${stack(font)};` : '',
            display ? `--crew-font-display:${stack(display)};` : '',
            mono ? `--crew-font-mono:${mono},ui-monospace,monospace;` : '',
            radius !== null ? `--crew-radius:${radius}px;` : '',
            gradient ? `--crew-gradient:linear-gradient(${gradient});` : '',
        ].join('');

        let css = '';
        if (root) css += `:root{${root}}`;
        // The crew pages toggle .dark on <html>, which IS :root — so this one
        // selector covers it. (A `.dark :root` descendant rule can never match:
        // :root is the document element and has no ancestor.)
        if (dark) css += `:root.dark{${dark}}`;

        // Bind the tokens to the surfaces each page actually paints. The
        // dashboard and pilot/join pages already read --bg/--surface directly,
        // so these are no-ops there; the login page (crew.html) paints with
        // Tailwind utilities, and this is what makes it follow the brand.
        // body.embed stays transparent — the host shell supplies the backdrop.
        if (light || dark) {
            css += `
                body:not(.embed){background:var(--bg)!important;color:var(--ink)!important;}
                .surface{background:var(--surface)!important;border-color:var(--line)!important;}
                .accent-bg{background:var(--accent)!important;}
                .accent-text{color:var(--accent)!important;}
            `;
        }
        if (theme.light && isHex(theme.light.accentInk)) {
            // Text that sits ON the accent — a pale brand accent needs dark text,
            // and the stock pages hard-code white.
            css += `.accent-bg{color:var(--accent-ink)!important;}`;
        }
        if (font) css += `body{font-family:var(--crew-font)!important;}`;
        if (display) css += `h1,h2,h3,h4,.serif{font-family:var(--crew-font-display)!important;}`;
        if (mono) css += `.stat-num,.mono{font-family:var(--crew-font-mono)!important;}`;
        // Corner radius is a brand signal, and the crew center's cards vary it
        // (rounded-xl / rounded-2xl) for rhythm rather than meaning. One value
        // across the card surface reads as deliberate; this sheet is appended
        // after Tailwind's, so it wins on source order at equal specificity.
        if (radius !== null) css += `.surface{border-radius:var(--crew-radius)!important;}`;

        return css;
    }

    function writeStyle(css) {
        let el = document.getElementById(STYLE_ID);
        if (!el) {
            el = document.createElement('style');
            el.id = STYLE_ID;
            document.head.appendChild(el);
        }
        el.textContent = css;
    }

    /* ---- The tab -----------------------------------------------------------
     *
     * A crew centre is a page a pilot leaves open all day, next to their VA's
     * website and half a dozen other tabs. It carried no icon at all, so the
     * browser drew its own placeholder globe — the same globe as every other
     * unbranded page — and the one tab the airline most wants recognised was
     * the one tab you could not pick out.
     *
     * The airline's uploaded logo is the icon. Where there is none, the
     * MONOGRAM is: the same initials on the same accent the header already
     * shows, drawn here as an SVG rather than fetched, so an airline that has
     * never uploaded anything still gets its own mark instead of the globe.
     *
     * Everything below is written defensively because the accent can arrive
     * from a `?accent=` query override that never passed through the backend:
     * the logo has to parse as an https URL, and the colour has to be a hex
     * this file re-validates. Neither is interpolated anywhere it could become
     * anything other than an attribute value or an SVG fill.
     * --------------------------------------------------------------------- */
    const ICON_REL = 'icon';
    const ICON_MARK = 'data-crew-brand-icon';

    // An https URL, or one of our own — a logo is loaded by the browser as the
    // tab's icon, and http: on an https page is blocked anyway.
    function httpsUrl(u) {
        const raw = String(u == null ? '' : u).trim();
        // Not a guard against nothing: `new URL('', location.href)` resolves to
        // THIS PAGE, so an airline with no logo would have had its own HTML
        // document hung in the head as the tab's icon — which draws the globe
        // anyway, and silently, which is the worst of both.
        if (!raw) return '';
        try {
            const x = new URL(raw, location.href);
            return (x.protocol === 'https:' || x.origin === location.origin) ? x.href : '';
        } catch (_) { return ''; }
    }

    // "Ocean Virtual" → OV, "Aeromexico Virtual" → AV, and a one-word airline
    // falls back to its first two letters. The same rule the nav monogram uses.
    function initials(name, code) {
        const s = String(name || code || '').trim();
        if (!s) return '';
        const w = s.split(/\s+/).filter(Boolean);
        return (w.length >= 2 ? (w[0][0] + w[1][0]) : s.slice(0, 2)).toUpperCase();
    }

    // Black or white, whichever the accent can actually be read against. A VA
    // with a pale yellow accent must not get white initials on it.
    function readableInk(hex) {
        let h = String(hex || '').replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        const n = parseInt(h, 16);
        if (!isFinite(n)) return '#FFFFFF';
        const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
        const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
        return L > 0.45 ? '#111111' : '#FFFFFF';
    }

    // Whatever accent is in force right now, however it got there — a theme
    // this file just wrote, a query override, or the stock crew centre's own.
    function liveAccent() {
        try {
            const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
            return isHex(v) ? v : '';
        } catch (_) { return ''; }
    }

    function monogramIcon(name, code) {
        const text = initials(name, code);
        if (!text) return '';
        const bg = liveAccent() || '#1F6FEB';
        const ink = readableInk(bg);
        // A rounded square rather than a circle: at 16px a circle loses its
        // corners to the tab's own padding and reads as a smudge.
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
            + '<rect width="64" height="64" rx="14" fill="' + bg + '"/>'
            + '<text x="32" y="32" fill="' + ink + '" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif"'
            + ' font-size="30" font-weight="700" text-anchor="middle" dominant-baseline="central">'
            + text.replace(/[&<>"']/g, '') + '</text></svg>';
        return 'data:image/svg+xml,' + encodeURIComponent(svg);
    }

    // One set of links, replaced wholesale, so a second call (a host pushing a
    // brand change, /me landing after the public record) cannot stack them up.
    // The page's own <link rel="icon">, if it ever grows one, is left alone
    // until we have something better to put there — and then it goes, because
    // two icons is a browser's choice rather than the airline's.
    function writeIcon(href, type) {
        if (!href) return false;
        const head = document.head;
        if (!head) return false;
        Array.prototype.forEach.call(
            document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"], link[' + ICON_MARK + ']'),
            (el) => el.parentNode && el.parentNode.removeChild(el));
        const link = document.createElement('link');
        link.setAttribute('rel', ICON_REL);
        if (type) link.setAttribute('type', type);
        link.setAttribute(ICON_MARK, '1');
        link.setAttribute('href', href);
        head.appendChild(link);
        return true;
    }

    /**
     * Paint the tab from a branding record. Safe to call with anything —
     * a record that names no airline at all writes nothing and leaves the page
     * exactly as it found it.
     */
    function favicon(branding) {
        const b = branding || {};
        const logo = httpsUrl(b.logo);
        const href = logo || monogramIcon(b.name, b.code);
        if (!writeIcon(href, logo ? '' : 'image/svg+xml')) return false;
        // iOS wants a real bitmap for a home-screen bookmark and ignores SVG,
        // so the monogram never becomes one: an airline with no logo keeps the
        // Inflight icon the page shipped with, which is a real picture and a
        // better home-screen tile than a square iOS would draw itself.
        if (logo) {
            const prev = document.querySelector('link[rel="apple-touch-icon"]');
            if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
            const t = document.createElement('link');
            t.setAttribute('rel', 'apple-touch-icon');
            t.setAttribute(ICON_MARK, '1');
            t.setAttribute('href', logo);
            document.head.appendChild(t);
        }
        return true;
    }

    // ---- Light / dark ------------------------------------------------------
    function isDark() { return document.documentElement.classList.contains('dark'); }

    function setMode(mode, persist) {
        if (mode !== 'dark' && mode !== 'light') return;
        const dark = mode === 'dark';
        if (dark === isDark()) return;
        document.documentElement.classList.toggle('dark', dark);
        if (persist !== false) { try { localStorage.setItem(THEME_KEY, mode); } catch (_) {} }
        modeListeners.forEach(fn => { try { fn(mode); } catch (_) {} });
    }

    // ---- Public API --------------------------------------------------------
    function apply(branding) {
        const theme = branding && branding.theme;
        // No theme configured → leave the stock crew center's COLOURS alone.
        const themed = !!(theme && typeof theme === 'object');
        if (themed) {
            currentTheme = theme;
            loadFonts(theme);
            writeStyle(buildCss(theme));

            // A VA can pin its crew center to one mode; 'auto' (the default)
            // leaves the pilot's own choice — and the page's existing toggle —
            // in charge.
            if (theme.mode === 'dark' || theme.mode === 'light') setMode(theme.mode, false);
        }
        // The tab is not part of the theme and does not wait for one: an
        // airline that has never opened the theme controls still has a name, a
        // code and usually a logo, and that is all the icon needs. Painted
        // after the style is written, so the monogram reads the accent this
        // call just put in force rather than the one it replaced.
        favicon(branding);
        return themed;
    }

    // Hosts (the tracker's overlay, or a VA site framing the crew center) can
    // push their light/dark state so the framed page never sits light-on-dark
    // inside a dark shell. Only the two literal modes are honoured, and only
    // from our direct parent — the worst a hostile framer achieves is flipping
    // dark mode on, which is why a strict origin allow-list isn't needed here.
    function listenForHost() {
        if (global.parent === global) return;
        global.addEventListener('message', (e) => {
            if (e.source !== global.parent) return;
            const d = e.data;
            if (!d || d.type !== 'inflight:crew:theme') return;
            if (d.theme !== 'dark' && d.theme !== 'light') return;
            setMode(d.theme);
        });
    }

    listenForHost();

    global.CrewBrand = {
        apply,
        favicon,
        setMode,
        isDark,
        getTheme: () => currentTheme,
        onMode: (fn) => { if (typeof fn === 'function') modeListeners.push(fn); },
    };
})(window);
