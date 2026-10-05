/* CREW SESSION GUARD — an expired sign-in goes to the sign-in page, not the crew center.
 *
 * THE BUG THIS EXISTS FOR
 *
 * crew.html stores the session (token, name, role) in localStorage, and the
 * crew pages paint from it: the name in the corner, the pilot home, the staff
 * tiles. Nothing checked that the token was still good. A week later the token
 * had expired, the page drew itself exactly as before — name filled in, cards
 * laid out — and every button quietly failed. The pilot was signed out and the
 * page said they weren't.
 *
 * WHAT IT DOES
 *
 *   1. Before the page is parsed (it is loaded in the <head>), it reads the
 *      token's own expiry. Expired means the stored session is removed and the
 *      reader is sent to the sign-in page at once — nothing of the crew center
 *      is drawn first.
 *
 *   2. A token that is still in date can still be dead: the account switched
 *      off, the password changed. Any crew API call that carried this session
 *      and came back 401 is checked once against /me, and if /me refuses it
 *      too, the same thing happens. One 401 on its own is not enough — some
 *      routes use it for "not a pilot of this airline", and a wrong current
 *      password is not a reason to sign anybody out.
 *
 * The sign-in page is told why (?expired=1) so it can say so.
 */
(function () {
    'use strict';

    function slug() {
        const m = location.pathname.match(/\/crew\/([^/?#]+)/i);
        if (m && m[1] && !/\.html$/i.test(m[1])) return decodeURIComponent(m[1]).trim().toLowerCase();
        const q = new URLSearchParams(location.search).get('va');
        return q ? q.trim().toLowerCase() : '';
    }
    function key(s) { return 'crew:session:' + (s || slug()); }
    function stored(s) {
        try { return JSON.parse(localStorage.getItem(key(s)) || 'null'); } catch (_) { return null; }
    }

    /** Milliseconds since the epoch when this token stops working, or 0 if unknown. */
    function expiresAt(token) {
        try {
            const part = String(token || '').split('.')[1];
            if (!part) return 0;
            const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
            const exp = JSON.parse(json).exp;
            return typeof exp === 'number' ? exp * 1000 : 0;
        } catch (_) { return 0; }
    }

    function isExpired(sess) {
        if (!sess || !sess.token) return false;
        const at = sess.expiresAt || expiresAt(sess.token);
        return !!at && Date.now() >= at;
    }

    let leaving = false;
    /** Drop the stored session and go to this crew center's sign-in page. */
    function expire(s) {
        if (leaving) return;
        leaving = true;
        const sl = s || slug();
        try { localStorage.removeItem(key(sl)); } catch (_) {}
        const embed = new URLSearchParams(location.search).get('embed') === '1' ? '&embed=1' : '';
        location.replace(sl ? `/crew/${encodeURIComponent(sl)}?expired=1${embed}` : '/crew');
    }

    // ---- 1. Before anything is drawn ----
    if (isExpired(stored())) { expire(); return; }

    // ---- 2. A refusal from the server, confirmed ----
    const nativeFetch = window.fetch && window.fetch.bind(window);
    if (!nativeFetch) return;

    function bearerOf(input, init) {
        let h = init && init.headers;
        if (!h && input && typeof input === 'object' && input.headers) h = input.headers;
        if (!h) return '';
        let v = '';
        if (typeof h.get === 'function') v = h.get('Authorization') || '';
        else if (Array.isArray(h)) { const e = h.find(p => String(p[0]).toLowerCase() === 'authorization'); v = e ? e[1] : ''; }
        else v = h.Authorization || h.authorization || '';
        return String(v).startsWith('Bearer ') ? String(v).slice(7).trim() : '';
    }

    let probing = null;
    function confirmDead(url, token) {
        if (probing) return probing;
        const m = String(url).match(/^(.*\/api\/crew\/[^/?#]+)/);
        if (!m) return Promise.resolve(false);
        probing = nativeFetch(m[1] + '/me', { headers: { Accept: 'application/json', Authorization: 'Bearer ' + token } })
            .then(r => r.status === 401)
            .catch(() => false)
            .finally(() => { probing = null; });
        return probing;
    }

    window.fetch = function (input, init) {
        const p = nativeFetch(input, init);
        return p.then((res) => {
            if (res.status !== 401 || leaving) return res;
            const url = typeof input === 'string' ? input : (input && input.url) || '';
            if (!/\/api\/crew\//.test(url)) return res;
            const sess = stored();
            const token = bearerOf(input, init);
            // Only this crew center's own session — a call made with some
            // other credential is none of our business.
            if (!sess || !sess.token || token !== sess.token) return res;
            confirmDead(url, token).then((dead) => {
                const now = stored();
                if (dead && now && now.token === token) expire();
            });
            return res;
        });
    };

    // A tab left open past the token's expiry goes the same way when the
    // reader comes back to it, rather than on their next click.
    function recheck() {
        if (document.visibilityState === 'hidden') return;
        if (isExpired(stored())) expire();
    }
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);

    window.CrewSessionGuard = { expire, isExpired, expiresAt };
})();
