/* ============================================================================
   crewViewSwitch.js — the button between the admin view and the pilot view.

   WHY THIS EXISTS

   A VA's staff fly. The crew center has two houses — the management dashboard
   (crew-dashboard.html) and the pilot home (crew-pilot.html) — and a staff
   session already works in both: every pilot endpoint resolves an owner or
   staff login to their own pilot record. What was missing was the door. An
   owner who wanted to see the crew center the way their pilots do, or to book
   a leg from the pilot home, had to know the address and type it.

   So both headers carry one button: "Pilot view" on the dashboard, "Admin
   view" on the pilot home. Same session, nothing to sign in to again.

   WHO SEES IT

   Owner and staff logins, and Inflight oversight (who may want to see what a
   VA's pilots see). Never a pilot: the dashboard sends a pilot session straight
   back to the pilot home, so an "Admin view" button would be a door that opens
   onto itself.

   WHICH ONE THEY LAND ON

   The last view somebody switched to is remembered per crew center, and the
   sign-in page (crew.html) honours it for staff — an owner who mostly flies
   lands on the pilot home without having to press the button every time.
   It is a preference on this device only, and only ever for staff.

   Mount: put <span data-view-switch="pilot"></span> (on the dashboard — the
   view it leads TO) or data-view-switch="admin" (on the pilot home) in the
   header. CrewViewSwitch.mount() fills every one it finds; it is also called
   on DOMContentLoaded, so a page only has to load the script.
   ========================================================================== */

(function () {
    'use strict';

    const PAGES = { pilot: 'crew-pilot.html', admin: 'crew-dashboard.html' };

    function slug() {
        const m = location.pathname.match(/\/crew\/([^/?#]+)/i);
        if (m && m[1] && !/\.html$/i.test(m[1])) return decodeURIComponent(m[1]).trim().toLowerCase();
        const q = new URLSearchParams(location.search).get('va');
        return q ? q.trim().toLowerCase() : '';
    }

    function session(s) {
        try { return JSON.parse(localStorage.getItem('crew:session:' + (s || slug())) || 'null'); } catch { return null; }
    }

    /** May this session move between the two views? */
    function canSwitch(sess) {
        const s = sess === undefined ? session() : sess;
        return !!(s && s.token && (s.role === 'owner' || s.role === 'staff' || s.oversight));
    }

    /** The address of a view, keeping the app's embed flag so the overlay stays the overlay. */
    function url(view, s) {
        const va = s || slug();
        if (!va || !PAGES[view]) return '';
        const qs = new URLSearchParams();
        qs.set('va', va);
        try { if (new URLSearchParams(location.search).get('embed') === '1') qs.set('embed', '1'); } catch { /* fine */ }
        return `/${PAGES[view]}?${qs.toString()}`;
    }

    const PREF = (s) => 'crew:view:' + s;
    function remember(view, s) {
        try { localStorage.setItem(PREF(s || slug()), view); } catch { /* private mode: no memory, no harm */ }
    }
    /** 'pilot' | 'admin' | '' — what this device last switched to at this crew center. */
    function preferred(s) {
        try { const v = localStorage.getItem(PREF(s || slug())); return v === 'pilot' || v === 'admin' ? v : ''; } catch { return ''; }
    }

    const LABEL = { pilot: 'Pilot view', admin: 'Admin view' };
    const ICON = { pilot: 'plane', admin: 'shield-check' };
    const TITLE = {
        pilot: 'See the crew center as your pilots do — book, file and fly as yourself',
        admin: 'Back to the admin dashboard',
    };

    function paint(host) {
        const view = host.getAttribute('data-view-switch');
        if (!PAGES[view] || !canSwitch()) { host.innerHTML = ''; host.hidden = true; return; }
        const href = url(view);
        if (!href) { host.innerHTML = ''; host.hidden = true; return; }
        host.hidden = false;
        host.innerHTML = `<a href="${href}" data-view-go="${view}" title="${TITLE[view]}"
            class="cvs-btn"><i data-lucide="${ICON[view]}"></i><span class="cvs-label">${LABEL[view]}</span></a>`;
        const a = host.querySelector('a');
        a.addEventListener('click', () => remember(view));
        try { if (window.lucide) window.lucide.createIcons(); } catch { /* a missing glyph is not worth a missing button */ }
    }

    function injectStyles() {
        if (document.getElementById('cvs-styles')) return;
        const st = document.createElement('style');
        st.id = 'cvs-styles';
        st.textContent = `
        [data-view-switch][hidden]{ display:none !important; }
        .cvs-btn{ display:inline-flex; align-items:center; gap:.4rem; height:2.25rem; padding:0 .7rem;
            border-radius:.5rem; border:1px solid var(--line,rgba(0,0,0,.12)); color:var(--ink,inherit);
            font-size:.8125rem; font-weight:600; text-decoration:none; white-space:nowrap;
            background:color-mix(in srgb, var(--accent,#2563eb) 8%, transparent); transition:border-color .15s, background .15s; }
        .cvs-btn:hover{ border-color:var(--accent,#2563eb); background:color-mix(in srgb, var(--accent,#2563eb) 14%, transparent); }
        .cvs-btn svg, .cvs-btn [data-lucide]{ width:1rem; height:1rem; }
        /* A phone's bar has a logo, a name, a bell and an avatar to fit. The
           icon carries the meaning there; the title says it in words. */
        @media (max-width:40rem){ .cvs-btn{ padding:0; width:2.25rem; justify-content:center; } .cvs-label{ display:none; } }`;
        document.head.appendChild(st);
    }

    function mount() {
        injectStyles();
        document.querySelectorAll('[data-view-switch]').forEach(paint);
    }

    window.CrewViewSwitch = { mount, url, canSwitch, remember, preferred, session };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
})();
