/**
 * pilotStanding.js
 *
 * The website's side of the warnings the iOS app already shows. When a
 * moderator takes a picture down and warns the pilot (the staff hub's Pilot
 * Content page → admin_pilot_takedown), the pilot has to be told, in words,
 * and has to say they have read it. The rules live in the database
 * (Inflight-IOS: 20260908000000_pilot_content_moderation.sql); this file
 * calls the same two functions the app does:
 *
 *   pilot_my_standing()              warnings (newest first), how many are
 *                                    unread, and whether adding pictures is
 *                                    paused — with the sentence to show for it
 *   pilot_acknowledge_warning(id)    "I understand", stamped acknowledged_at
 *                                    (staff see "Read <when>" in the hub)
 *
 * Signed in with an unread warning, a sheet shows it once the map is up and
 * nothing else is on screen, and stays until it is acknowledged. The picture
 * editor (pilotCardEditor.js) reads the same standing to say when uploads are
 * paused, and opens the full record from there.
 *
 *   PilotStanding.init(supabase)      once, at boot
 *   PilotStanding.get()               last known standing, or null
 *   PilotStanding.refresh()           re-read (after a refused upload, say)
 *   PilotStanding.openRecord()        every warning, read-only
 */

const RETRY_MS = 4000;
const GIVE_UP_MS = 180000;
const BLOCKERS = '#fre-overlay, #fre-window-demo, .cl-overlay, #auth-modal-overlay.open, .iadj-overlay, .acs-overlay, .pcp-overlay';
const TERMS_URL = 'terms.html#user-content';
const SUPPORT = 'inflightCustomer@gmail.com';

// Same vocabulary as the staff console (database: pilotModeration.js).
const LEVELS = {
    notice: { title: 'A note about something you uploaded', meaning: 'This is on your record, with no penalty. Please don’t upload anything like it again.', icon: 'fa-circle-info', tone: 'info' },
    first: { title: 'A warning on your account', meaning: 'This is a formal warning. Another one could lead to a final warning.', icon: 'fa-triangle-exclamation', tone: 'warn' },
    final: { title: 'A final warning', meaning: 'This is your last warning. One more breach of the rules can cost you your account.', icon: 'fa-triangle-exclamation', tone: 'danger' },
    suspended: { title: 'Your profile is suspended', meaning: 'Your profile is hidden from other pilots and stays that way.', icon: 'fa-ban', tone: 'danger' },
};
const CATEGORIES = {
    sexual: 'Sexual or adult content',
    violence: 'Violent or graphic content',
    hate: 'Hateful content',
    harassment: 'Harassment or bullying',
    impersonation: 'Impersonation',
    spam: 'Spam or advertising',
    other: 'Other',
};

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function day(d) {
    if (!d) return '';
    try { return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }); } catch (_) { return ''; }
}

export const PilotStanding = {
    _supabase: null,
    _standing: null,
    _uid: null,
    _root: null,
    _timer: null,
    _since: 0,
    _run: 0,

    init(supabase) {
        if (this._supabase || !supabase) return;
        this._supabase = supabase;
        supabase.auth.onAuthStateChange((event) => {
            // Deferred: supabase-js deadlocks on its own calls inside this callback.
            if (event === 'SIGNED_OUT') { this._standing = null; this._uid = null; this._announce(); this._close(); return; }
            if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') setTimeout(() => this.refresh(), 0);
        });
        // A warning issued while the tab sat open is shown when it comes back.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && this._uid && Date.now() - (this._readAt || 0) > 10 * 60 * 1000) this.refresh();
        });
        this.refresh();
    },

    get() { return this._standing; },

    async refresh() {
        const run = ++this._run;
        const sb = this._supabase;
        if (!sb) return null;
        let uid = null;
        try {
            const { data: { session } = {} } = await sb.auth.getSession();
            uid = session?.user?.id || null;
        } catch (_) { return this._standing; }
        if (!uid) { this._standing = null; this._uid = null; this._announce(); return null; }
        const { data, error } = await sb.rpc('pilot_my_standing');
        if (run !== this._run) return this._standing;
        // A failed read changes nothing — never a sheet from a network blip.
        if (error) return this._standing;
        const row = Array.isArray(data) ? data[0] : data;
        this._uid = uid;
        this._readAt = Date.now();
        this._standing = row ? {
            warnings: Array.isArray(row.warnings) ? row.warnings : [],
            activeCount: row.active_count || 0,
            unreadCount: row.unacknowledged_count || 0,
            uploadsRestricted: !!row.uploads_restricted,
            uploadsRestrictedUntil: row.uploads_restricted_until || null,
            uploadsNotice: row.uploads_notice || '',
        } : null;
        this._announce();
        if (this._unread().length) this._schedule();
        return this._standing;
    },

    _unread() {
        return (this._standing?.warnings || []).filter(w => !w.rescinded_at && !w.acknowledged_at);
    },

    _announce() {
        try { window.dispatchEvent(new CustomEvent('inflight:pilot-standing', { detail: this._standing })); } catch (_) { /* old browser */ }
    },

    // After the map is up and nothing else is asking for attention.
    _schedule() {
        if (this._timer || this._root) return;
        this._since = Date.now();
        const attempt = () => {
            this._timer = null;
            if (!this._unread().length || this._root) return;
            const bootState = window.__inflightBoot && window.__inflightBoot.state;
            const ready = !window.__inflightBoot || bootState === 'map-ready';
            if (!ready || document.hidden || document.querySelector(BLOCKERS)) {
                if (Date.now() - this._since < GIVE_UP_MS) this._timer = setTimeout(attempt, RETRY_MS);
                return;
            }
            this._open({ mode: 'ack' });
        };
        this._timer = setTimeout(attempt, 1500);
    },

    openRecord() {
        if (this._root) return;
        if (!this._standing) { this.refresh().then(() => this._standing && this._open({ mode: 'record' })); return; }
        this._open({ mode: 'record' });
    },

    _warningHtml(w) {
        const lv = LEVELS[w.level] || LEVELS.notice;
        const rescinded = !!w.rescinded_at;
        const cat = w.category && CATEGORIES[w.category];
        return `
            <article class="pst-warning pst-${lv.tone}${rescinded ? ' is-rescinded' : ''}">
                <header>
                    <span class="pst-ic"><i class="fa-solid ${lv.icon}"></i></span>
                    <div>
                        <b>${esc(lv.title)}</b>
                        <small>${esc(day(w.created_at))}${cat ? ' · ' + esc(cat) : ''}${rescinded ? ' · withdrawn' : ''}</small>
                    </div>
                </header>
                ${w.reason ? `<p class="pst-reason">${esc(w.reason)}</p>` : ''}
                <p class="pst-meaning">${rescinded ? 'We withdrew this warning — it no longer counts against you.' : esc(lv.meaning)}</p>
                ${!rescinded && w.upload_block ? `<p class="pst-block"><i class="fa-solid fa-image"></i> ${w.upload_block_until
                    ? 'Adding pictures is paused until ' + esc(day(w.upload_block_until)) + '.'
                    : 'Adding pictures is paused until we lift it.'}</p>` : ''}
            </article>`;
    },

    _open({ mode }) {
        this._injectStyles();
        const s = this._standing || { warnings: [] };
        const list = mode === 'ack' ? this._unread() : s.warnings;
        if (!list.length && mode === 'ack') return;
        const root = document.createElement('div');
        root.className = 'pst-overlay';
        root.innerHTML = `
            <div class="pst-sheet" role="alertdialog" aria-modal="true" aria-labelledby="pst-title" tabindex="-1">
                <h2 id="pst-title">${mode === 'ack'
                    ? (list.length > 1 ? `${list.length} messages about your account` : 'A message about your account')
                    : 'Your account standing'}</h2>
                <p class="pst-sub">${mode === 'ack'
                    ? 'Something you uploaded to your profile broke our rules for pictures, and our team took it down. Here’s what happened.'
                    : (s.activeCount ? `${s.activeCount} warning${s.activeCount === 1 ? '' : 's'} on record.` : 'Nothing on your record. Thanks for keeping Inflight friendly.')}</p>
                <div class="pst-list">${list.map(w => this._warningHtml(w)).join('')}</div>
                ${s.uploadsRestricted && s.uploadsNotice ? `<p class="pst-notice"><i class="fa-solid fa-circle-pause"></i> ${esc(s.uploadsNotice)}</p>` : ''}
                <p class="pst-rules">Pictures on your profile and flight window are seen by everyone. Nothing adult, violent, hateful or harassing, no pretending to be someone else, no ads.
                    <a href="${TERMS_URL}" target="_blank" rel="noopener">Read the Terms</a> ·
                    <a href="mailto:${SUPPORT}?subject=${encodeURIComponent('About a warning on my Inflight account')}">Think we got it wrong?</a></p>
                <footer>
                    <button type="button" class="pst-btn pst-primary" data-act="${mode === 'ack' ? 'ack' : 'close'}">${mode === 'ack' ? 'I understand' : 'Close'}</button>
                </footer>
            </div>`;
        document.body.appendChild(root);
        this._root = root;
        const btn = root.querySelector('[data-act]');
        btn.addEventListener('click', async () => {
            if (btn.dataset.act === 'close') { this._close(); return; }
            btn.disabled = true;
            btn.textContent = 'Saving…';
            const ids = list.map(w => w.id);
            const results = await Promise.all(ids.map(id => this._supabase.rpc('pilot_acknowledge_warning', { p_warning_id: id })
                .then(r => !r.error).catch(() => false)));
            if (results.every(Boolean)) {
                const now = new Date().toISOString();
                (this._standing?.warnings || []).forEach(w => { if (ids.includes(w.id)) w.acknowledged_at = now; });
                if (this._standing) this._standing.unreadCount = this._unread().length;
                this._announce();
                this._close();
            } else {
                btn.disabled = false;
                btn.textContent = 'I understand';
                let err = root.querySelector('.pst-err');
                if (!err) { err = document.createElement('p'); err.className = 'pst-err'; btn.parentElement.prepend(err); }
                err.textContent = 'Couldn’t save that — check your connection and try again.';
            }
        });
        // A record can be closed any way; a warning only with "I understand".
        if (mode === 'record') {
            root.addEventListener('click', (e) => { if (e.target === root) this._close(); });
            this._onKey = (e) => { if (e.key === 'Escape') this._close(); };
            document.addEventListener('keydown', this._onKey);
        }
        requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('is-open')));
        root.querySelector('.pst-sheet').focus({ preventScroll: true });
    },

    _close() {
        const root = this._root;
        if (!root) return;
        this._root = null;
        if (this._onKey) { document.removeEventListener('keydown', this._onKey); this._onKey = null; }
        root.classList.remove('is-open');
        setTimeout(() => root.remove(), 300);
    },

    _injectStyles() {
        if (document.getElementById('pst-styles')) return;
        const st = document.createElement('style');
        st.id = 'pst-styles';
        st.textContent = `
            .pst-overlay {
                position: fixed; inset: 0; z-index: 21000; display: grid; place-items: center; padding: 16px;
                background: rgba(0,0,0,0); transition: background .28s ease;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
            }
            .pst-overlay.is-open { background: rgba(0,0,0,.62); }
            .pst-sheet {
                box-sizing: border-box; width: min(520px, 100%); max-height: calc(100vh - 32px); overflow-y: auto;
                background: #1c1c1e; color: #f2f2f7; border-radius: 20px; padding: 22px 22px 18px;
                border: 1px solid rgba(255,255,255,.08); box-shadow: 0 24px 70px rgba(0,0,0,.55);
                opacity: 0; transform: translateY(12px) scale(.98); transition: opacity .28s ease, transform .42s cubic-bezier(.32,.72,0,1);
            }
            .pst-overlay.is-open .pst-sheet { opacity: 1; transform: none; }
            .pst-sheet:focus { outline: none; }
            .pst-sheet h2 { margin: 0 0 6px; font-size: 1.2rem; font-weight: 700; letter-spacing: -.01em; }
            .pst-sub { margin: 0 0 16px; font-size: .88rem; line-height: 1.5; color: rgba(235,235,245,.65); }
            .pst-list { display: flex; flex-direction: column; gap: 10px; }
            .pst-warning { padding: 14px; border-radius: 14px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); }
            .pst-warning header { display: flex; gap: 12px; align-items: center; }
            .pst-warning header b { display: block; font-size: .95rem; }
            .pst-warning header small { display: block; margin-top: 2px; font-size: .78rem; color: rgba(235,235,245,.55); }
            .pst-ic { flex: 0 0 auto; width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; }
            .pst-info .pst-ic { background: rgba(56,189,248,.14); color: #7dd3fc; }
            .pst-warn .pst-ic { background: rgba(251,191,36,.14); color: #fbbf24; }
            .pst-danger .pst-ic { background: rgba(248,113,113,.14); color: #f87171; }
            .pst-warn { border-color: rgba(251,191,36,.22); }
            .pst-danger { border-color: rgba(248,113,113,.28); }
            .pst-warning.is-rescinded { opacity: .6; }
            .pst-reason { margin: 12px 0 0; font-size: .9rem; line-height: 1.5; white-space: pre-wrap; }
            .pst-meaning { margin: 8px 0 0; font-size: .82rem; line-height: 1.45; color: rgba(235,235,245,.62); }
            .pst-block { margin: 10px 0 0; font-size: .82rem; color: #fca5a5; display: flex; gap: 8px; align-items: baseline; }
            .pst-notice { margin: 12px 0 0; padding: 10px 12px; border-radius: 12px; background: rgba(248,113,113,.08); font-size: .82rem; line-height: 1.45; color: #fecaca; display: flex; gap: 8px; align-items: baseline; }
            .pst-rules { margin: 14px 0 0; font-size: .78rem; line-height: 1.5; color: rgba(235,235,245,.5); }
            .pst-rules a { color: rgba(235,235,245,.8); }
            .pst-sheet footer { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 16px; }
            .pst-err { flex: 1; margin: 0; font-size: .8rem; color: #fca5a5; }
            .pst-btn { height: 42px; padding: 0 22px; border-radius: 12px; cursor: pointer; font: inherit; font-size: .92rem; font-weight: 700; border: 0; }
            .pst-primary { background: #f2f2f7; color: #1c1c1e; }
            .pst-btn:disabled { opacity: .6; cursor: default; }
            @media (max-width: 768px) {
                .pst-overlay { padding: 12px; }
                .pst-sheet { width: 100%; max-height: calc(100dvh - 24px); border-radius: 20px; padding: 20px 16px 16px; }
                .pst-btn { flex: 1; }
            }
            @media (prefers-reduced-motion: reduce) { .pst-overlay, .pst-sheet { transition: none; } }
        `;
        document.head.appendChild(st);
    },
};

if (typeof window !== 'undefined') window.PilotStanding = PilotStanding;
