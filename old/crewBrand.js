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
    function declarations(palette) {
        if (!palette) return '';
        const out = [];
        for (const key in TOKENS) {
            if (isHex(palette[key])) out.push(`${TOKENS[key]}:${palette[key]};`);
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
        // No theme configured → leave the stock crew center completely alone.
        if (!theme || typeof theme !== 'object') return false;

        currentTheme = theme;
        loadFonts(theme);
        writeStyle(buildCss(theme));

        // A VA can pin its crew center to one mode; 'auto' (the default) leaves
        // the pilot's own choice — and the page's existing toggle — in charge.
        if (theme.mode === 'dark' || theme.mode === 'light') setMode(theme.mode, false);
        return true;
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
        setMode,
        isDark,
        getTheme: () => currentTheme,
        onMode: (fn) => { if (typeof fn === 'function') modeListeners.push(fn); },
    };
})(window);
