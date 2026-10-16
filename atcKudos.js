/**
 * Kudos and RateMyATC — thanks and ratings for ATC controllers on frequency.
 *
 * KUDOS are one tap: 👍 or ☀️ sends straight away, and the toast offers "Add a
 * note". RATEMYATC is a 1–5 star rating per controller session. Every star is
 * public (average and count on the controller's row and profile); a comment
 * on a 4–5 star rating is public, a comment on a 1–3 star rating goes
 * privately to the controller only, without the rater's name.
 *
 * Controllers volunteer their evenings to open fields that would otherwise be
 * uncontrolled. Kudos let pilots say thanks: buttons on every live controller
 * (the airport window's "On frequency" card, the desktop ATC board, the mobile
 * ATC sheet), an optional short note, a Kudos section and banner pill on the
 * controller's profile, and an alert on the controller's own screen when a new
 * one lands.
 *
 * POSITIVE ONLY. There is no thumbs-down. Anybody with a complaint, or a
 * violation to appeal, is pointed at the IFC thread where Infinite Flight
 * actually handles that (FEEDBACK_URL below).
 *
 * HOW IT PLUGS IN. Render sites only emit markup — `onFrequencyHTML()` for an
 * airport, `controlsHTML(facility)` for a controller row, `airportFeedHTML()`
 * for a field's kudos list — and a MutationObserver hydrates any such markup
 * that appears, wherever it was rendered from. Counts are cached per
 * controller for a minute, so boards that re-render on every ATC tick do not
 * re-query.
 *
 * Backend: the `atc_*` RPCs in Inflight-IOS
 * supabase/migrations/20261015000000_atc_commendations.sql (the tables keep
 * their original "commendations" name; only the product name changed).
 */

const FEEDBACK_URL = 'https://community.infiniteflight.com/t/procedures-for-appealing-violations-and-providing-atc-feedback/795506';
const NOTE_MAX = 140;
const RATE_MAX = 280;
const COUNTS_TTL_MS = 60 * 1000;
const INBOX_POLL_MS = 60 * 1000;
const SEEN_KEY = 'inflight-kudos-seen-at';
const PILLS = '#open-auth-btn, #ios-profile-btn';   // desktop nav pill, phone profile orb

const KINDS = {
    thumbs_up: { label: 'Thumbs up', short: '👍', icon: 'fa-thumbs-up' },
    good_day:  { label: 'Good Day',  short: '☀️', icon: 'fa-sun' },
};

const FACILITY = {
    0: ['GND', 'Ground', 'gnd'], 1: ['TWR', 'Tower', 'twr'], 2: ['UNI', 'Unicom', 'obs'],
    3: ['CLR', 'Clearance', 'gnd'], 4: ['APP', 'Approach', 'app'], 5: ['DEP', 'Departure', 'app'],
    6: ['CTR', 'Center', 'ctr'], 7: ['ATIS', 'ATIS', 'obs'],
};
const FACILITY_ORDER = { 7: 0, 3: 1, 0: 2, 1: 3, 5: 4, 4: 5, 6: 6 };

export const AtcKudos = {
    _sb: null,
    _counts: new Map(),      // controllerId -> { at, total, thumbs_up, good_day, my_session_started_at, my_kind }
    _pending: null,          // Promise of the in-flight counts fetch
    _scanTimer: null,
    _stylesInjected: false,
    _compose: null,          // facility being commended in the open dialog
    _inbox: null,            // last atc_kudos_inbox result for the signed-in controller
    _inboxTimer: null,
    _inboxPolledAt: null,    // ISO time of the previous successful poll

    init(supabase) {
        if (this._sb || !supabase) return;
        this._sb = supabase;
        this._injectStyles();
        document.addEventListener('click', (e) => this._onClick(e), true);
        try {
            new MutationObserver(() => this._scheduleScan())
                .observe(document.body, { childList: true, subtree: true });
        } catch (_) { /* no observer: rows simply show without counts */ }
        this._scheduleScan();
        window.InflightKudos = this;

        // The controller's own alert: poll while signed in and visible.
        supabase.auth.onAuthStateChange(() => setTimeout(() => this._restartInbox(), 0));
        document.addEventListener('visibilitychange', () => { if (!document.hidden) this._pollInbox(); });
        this._restartInbox();
    },

    /* ─────────────────────────── Markup for render sites ─────────────────────────── */

    // The airport window's "On frequency" card: every controller at the field
    // with their kudos buttons, plus the field's kudos total and latest note.
    // Shown first in the window so kudos are never a hidden feature.
    onFrequencyHTML(icao, facilities) {
        const list = (facilities || [])
            .filter(Boolean)
            .slice()
            .sort((a, b) => (FACILITY_ORDER[a.type] ?? 9) - (FACILITY_ORDER[b.type] ?? 9));
        const rows = list.map(f => {
            const [abbr, , cls] = FACILITY[Number(f.type)] || ['ATC', 'ATC', 'obs'];
            const dur = this._duration(f.startTime);
            const name = this._esc(f.username || 'Unknown controller');
            return `
                <div class="atcc-of-row">
                    <span class="atcc-type atcc-type-${cls}">${abbr}</span>
                    <span class="atcc-of-main">
                        ${f.username
                            ? `<button type="button" class="atcc-of-name" data-atcc-act="profile" data-atcc-user="${name}" data-atcc-id="${this._esc(f.userId || '')}" title="Open ${name}'s profile">${name}</button>`
                            : `<span class="atcc-of-name">${name}</span>`}
                        ${dur ? `<span class="atcc-of-dur"><i class="fa-regular fa-clock"></i> ${this._esc(dur)}</span>` : ''}
                    </span>
                    ${this.controlsHTML(f, { view: false })}
                </div>`;
        }).join('');
        return `
            <section class="atcc-of" data-atcc-of="${this._esc(icao)}">
                <header class="atcc-of-head">
                    <span class="atcc-of-title">
                        <span class="atcc-live-dot${list.length ? '' : ' is-off'}"></span>
                        ${list.length ? 'On frequency' : 'No ATC online'}
                    </span>
                    <span class="atcc-of-head-right">
                        <span class="atcc-of-total" data-atcc-total></span>
                        <button type="button" class="atcc-board-link" data-atcc-act="board" title="Open the RateMyATC board">★ RateMyATC</button>
                    </span>
                </header>
                ${list.length ? rows : `
                <p class="atcc-of-empty">This field is uncontrolled right now. When a controller opens a
                    frequency here you can thank them with <b>kudos</b>.</p>`}
                <div class="atcc-of-latest" data-atcc-latest></div>
            </section>`;
    },

    // Kudos buttons for one live controller row. `f` is a facility from the IF
    // ATC feed (userId, username, airportName, type, startTime). Returns '' for
    // a facility that cannot be given kudos (no id or no session start).
    controlsHTML(f, { view = true } = {}) {
        if (!f || !f.userId || !f.startTime) return '';
        const attrs = [
            `data-atcc-id="${this._esc(f.userId)}"`,
            `data-atcc-user="${this._esc(f.username || '')}"`,
            `data-atcc-apt="${this._esc(f.airportName || '')}"`,
            `data-atcc-type="${this._esc(f.type ?? '')}"`,
            `data-atcc-start="${this._esc(f.startTime)}"`,
        ].join(' ');
        const btn = (kind) => `
            <button type="button" class="atcc-btn atcc-${kind}" data-atcc-act="${kind}" aria-pressed="false"
                    title="Give ${KINDS[kind].label} kudos">
                <span class="atcc-emoji" aria-hidden="true">${KINDS[kind].short}</span><span class="atcc-n" data-atcc-n="${kind}"></span>
                <span class="atcc-sr">${KINDS[kind].label}</span>
            </button>`;
        return `
            <span class="atcc-controls" ${attrs}>
                ${btn('thumbs_up')}${btn('good_day')}
                <button type="button" class="atcc-btn atcc-rate" data-atcc-act="rate" title="Rate this controller (RateMyATC)">
                    <span class="atcc-star" aria-hidden="true">★</span><span class="atcc-n" data-atcc-avg>Rate</span>
                </button>
                ${view ? `<button type="button" class="atcc-btn atcc-view" data-atcc-act="view"
                        title="See this controller's kudos"><i class="fa-solid fa-award"></i></button>` : ''}
            </span>`;
    },

    // A field's kudos list (the ATC tab of the airport window).
    airportFeedHTML(icao) {
        if (!icao) return '';
        return `<div class="atcc-airport" data-atcc-airport="${this._esc(icao)}"></div>`;
    },

    /* ─────────────────────────── Hydration ─────────────────────────── */

    _scheduleScan() {
        if (this._scanTimer) return;
        this._scanTimer = setTimeout(() => {
            this._scanTimer = null;
            this._scan();
        }, 120);
    },

    async _scan() {
        const rows = [...document.querySelectorAll('.atcc-controls[data-atcc-id]:not([data-atcc-ready])')];
        const feeds = [...document.querySelectorAll('.atcc-airport[data-atcc-airport]:not([data-atcc-ready])')];
        const cards = [...document.querySelectorAll('.atcc-of[data-atcc-of]:not([data-atcc-ready])')];
        feeds.forEach(el => { el.setAttribute('data-atcc-ready', '1'); this._fillAirport(el); });
        cards.forEach(el => { el.setAttribute('data-atcc-ready', '1'); this._fillOnFrequency(el); });
        this._paintPills();
        if (!rows.length) return;
        rows.forEach(el => el.setAttribute('data-atcc-ready', '1'));
        await this._ensureCounts(rows.map(el => el.dataset.atccId));
        rows.forEach(el => this._paintRow(el));
    },

    async _ensureCounts(ids, force = false) {
        if (!this._sb) return;
        const now = Date.now();
        const want = [...new Set(ids.filter(Boolean))].filter(id => {
            const c = this._counts.get(id);
            return force || !c || now - c.at > COUNTS_TTL_MS;
        });
        if (!want.length) return this._pending;
        const p = (async () => {
            try {
                const ids = want.slice(0, 100);
                const [k, rt] = await Promise.all([
                    this._sb.rpc('atc_commendation_counts', { p_controller_if_ids: ids }),
                    this._sb.rpc('atc_rating_counts', { p_controller_if_ids: ids }),
                ]);
                if (k.error) throw k.error;
                const at = Date.now();
                const ratings = new Map((rt.data || []).map(x => [x.controller_if_id, x]));
                (k.data || []).forEach(row => {
                    const x = ratings.get(row.controller_if_id) || {};
                    this._counts.set(row.controller_if_id, {
                        ...row, at,
                        rating_avg: x.rating_avg == null ? null : Number(x.rating_avg),
                        rating_count: x.rating_count || 0,
                        my_stars: x.my_stars || null,
                        my_rated_session: x.my_session_started_at || null,
                    });
                });
            } catch (err) {
                console.warn('[Kudos] counts failed:', err?.message || err);
            }
        })();
        this._pending = p;
        return p;
    },

    _paintRow(el) {
        const c = this._counts.get(el.dataset.atccId);
        if (!c) return;
        const set = (kind, n) => {
            const span = el.querySelector(`[data-atcc-n="${kind}"]`);
            if (span) span.textContent = n > 0 ? String(n) : '';
        };
        set('thumbs_up', c.thumbs_up);
        set('good_day', c.good_day);
        const mine = c.my_kind && this._sameSession(c.my_session_started_at, el.dataset.atccStart) ? c.my_kind : null;
        el.querySelectorAll('[data-atcc-act="thumbs_up"],[data-atcc-act="good_day"]').forEach(b => {
            const on = b.dataset.atccAct === mine;
            const label = KINDS[b.dataset.atccAct].label;
            b.classList.toggle('is-on', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
            b.title = on ? `You gave ${label} kudos — press again to take it back` : `Give ${label} kudos (one tap)`;
        });
        const rate = el.querySelector('[data-atcc-act="rate"]');
        if (rate) {
            const avgEl = rate.querySelector('[data-atcc-avg]');
            const myStars = c.my_stars && this._sameSession(c.my_rated_session, el.dataset.atccStart) ? c.my_stars : null;
            if (avgEl) avgEl.textContent = c.rating_count ? c.rating_avg.toFixed(1) : 'Rate';
            rate.classList.toggle('is-on', !!myStars);
            rate.dataset.atccMyStars = myStars || '';
            rate.title = c.rating_count
                ? `RateMyATC: ${c.rating_avg.toFixed(1)}★ from ${c.rating_count} rating${c.rating_count === 1 ? '' : 's'}${myStars ? ` · you gave ${myStars}★` : ''}`
                : 'Rate this controller (RateMyATC)';
        }
    },

    _repaintAll(id) {
        document.querySelectorAll('.atcc-controls[data-atcc-id]').forEach(el => {
            if (!id || el.dataset.atccId === id) this._paintRow(el);
        });
    },

    // The feed's startTime and the stored one round-trip through different
    // formats; compare to the second, as the server truncates to it.
    _sameSession(a, b) {
        const ta = Date.parse(a), tb = Date.parse(b);
        return Number.isFinite(ta) && Number.isFinite(tb) && Math.floor(ta / 1000) === Math.floor(tb / 1000);
    },

    /* ─────────────────────────── Clicks ─────────────────────────── */

    _onClick(e) {
        const btn = e.target.closest && e.target.closest('[data-atcc-act]');
        if (!btn) return;
        // Rows live inside clickable boards (expand/collapse, fly-to); a press
        // here must not also toggle the row underneath it.
        e.preventDefault();
        e.stopPropagation();
        const act = btn.dataset.atccAct;

        if (act === 'close') return this._closeCompose();
        if (act === 'submit') return this._submit();
        if (act === 'star') return this._pickStars(Number(btn.dataset.atccStars));
        if (act === 'rate-submit') return this._submitRate();
        if (act === 'pick') return this._pickKind(btn.dataset.atccKind);
        if (act === 'profile') return this.openProfile(btn.dataset.atccUser, btn.dataset.atccId);
        if (act === 'inbox') return this._openInbox();
        if (act === 'board') {
            window.dispatchEvent(new CustomEvent('openRateMyAtc', { detail: { tab: btn.dataset.atccTab || 'top' } }));
            return;
        }
        if (act === 'scroll-kudos') {
            document.getElementById('ups-commendations')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }

        const row = btn.closest('.atcc-controls');
        if (!row) return;
        const f = {
            userId: row.dataset.atccId,
            username: row.dataset.atccUser,
            airportName: row.dataset.atccApt,
            type: row.dataset.atccType === '' ? null : Number(row.dataset.atccType),
            startTime: row.dataset.atccStart,
        };
        if (act === 'view') return this.openProfile(f.username, f.userId);
        if (act === 'rate') return this._openRate(f, Number(btn.dataset.atccMyStars) || 0);
        if (act === 'thumbs_up' || act === 'good_day') {
            // Pressing your own highlighted button again takes it back.
            if (btn.classList.contains('is-on')) return this._withdraw(f, act);
            this._quickKudos(f, act, btn);
        }
    },

    // Opens a controller's profile scrolled to their kudos.
    openProfile(username, userId) {
        if (!username) return;
        try { window.InflightHaptics?.select?.(); } catch (_) {}
        import('./UserProfileUI.js')
            .then(m => m.UserProfileUI.open({ username, userId: userId || null, focus: 'commendations' }))
            .catch(err => console.error('Failed to load UserProfileUI:', err));
    },

    async _withdraw(f, kind) {
        const { error } = await this._sb.rpc('atc_commendation_withdraw', {
            p_controller_if_id: f.userId,
            p_session_started_at: new Date(f.startTime).toISOString(),
        });
        if (error) {
            this._notify(error.message || 'Could not take that back. Try again.', 'error');
            return;
        }
        this._notify(`${KINDS[kind].label} kudos withdrawn.`, 'info');
        await this._refreshAfterChange(f);
    },

    async _refreshAfterChange(f) {
        await this._ensureCounts([f.userId], true);
        this._repaintAll(f.userId);
        const apt = CSS.escape(f.airportName || '');
        document.querySelectorAll(`.atcc-airport[data-atcc-airport="${apt}"]`).forEach(el => this._fillAirport(el));
        document.querySelectorAll(`.atcc-of[data-atcc-of="${apt}"]`).forEach(el => this._fillOnFrequency(el));
        document.querySelectorAll(`.atcc-profile[data-atcc-profile="${CSS.escape(f.userId)}"]`)
            .forEach(el => this.renderProfileInto(el, f.userId, f.username));
    },

    async _signedIn(what) {
        const { data } = await this._sb.auth.getSession().catch(() => ({ data: null }));
        if (data?.session) return true;
        this._notify(`Sign in to ${what}.`, 'info');
        try { window.AuthUI?.open?.(); } catch (_) {}
        return false;
    },

    // One tap: send straight away, no note needed. The toast offers to add one.
    async _quickKudos(f, kind, btn) {
        if (!(await this._signedIn('give kudos'))) return;
        if (btn) { btn.disabled = true; btn.classList.add('is-sending'); }
        const { error } = await this._sb.rpc('atc_commend', {
            p_controller_if_id: f.userId,
            p_controller_username: f.username || null,
            p_airport_icao: f.airportName || null,
            p_facility_type: Number.isFinite(f.type) ? f.type : null,
            p_session_started_at: new Date(f.startTime).toISOString(),
            p_kind: kind,
            p_note: null,
        });
        if (btn) { btn.disabled = false; btn.classList.remove('is-sending'); }
        if (error) { this._notify(error.message || 'Could not send that. Try again.', 'error'); return; }
        const msg = `${KINDS[kind].short} ${KINDS[kind].label} sent to ${f.username || 'the controller'}!`;
        const notify = window.InflightNotify;
        if (notify?.notify) {
            notify.notify(msg, 'success', { timeout: 6000, action: { label: 'Add a note', onClick: () => this._openCompose(f, kind) } });
        } else this._notify(msg, 'success');
        await this._refreshAfterChange(f);
    },

    /* ─────────────────────────── Add-a-note dialog ─────────────────────────── */

    async _openCompose(f, kind) {
        if (!(await this._signedIn('give kudos'))) return;
        this._compose = { f, kind };
        let root = document.getElementById('atcc-compose');
        if (!root) {
            root = document.createElement('div');
            root.id = 'atcc-compose';
            root.className = 'atcc-backdrop';
            root.addEventListener('click', (e) => { if (e.target === root) this._closeCompose(); });
            document.body.appendChild(root);
        }
        const where = [FACILITY[f.type]?.[1], f.airportName].filter(Boolean).join(' · ');
        const choice = (k) => `
            <button type="button" class="atcc-choice${k === kind ? ' is-on' : ''}" data-atcc-act="pick" data-atcc-kind="${k}">
                <span class="atcc-choice-emoji">${KINDS[k].short}</span>${KINDS[k].label}
            </button>`;
        root.innerHTML = `
            <div class="atcc-dialog" role="dialog" aria-modal="true" aria-labelledby="atcc-title">
                <button type="button" class="atcc-x" data-atcc-act="close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
                <div class="atcc-dialog-badge" aria-hidden="true"><i class="fa-solid fa-award"></i></div>
                <h3 id="atcc-title">Add a note for ${this._esc(f.username || 'this controller')}</h3>
                ${where ? `<p class="atcc-where"><i class="fa-solid fa-headset"></i> ${this._esc(where)}</p>` : ''}
                <div class="atcc-choices">${choice('thumbs_up')}${choice('good_day')}</div>
                <label class="atcc-label" for="atcc-note">Your note <span>(public, positive only)</span></label>
                <textarea id="atcc-note" maxlength="${NOTE_MAX}" rows="3"
                    placeholder="Thanks for opening the field — smooth flow tonight!"></textarea>
                <div class="atcc-meta"><span id="atcc-left">${NOTE_MAX}</span> left · shown on the airport and on their profile</div>
                <p class="atcc-policy">
                    Kudos are for thanks only. To appeal a violation or give other ATC feedback, use the
                    <a href="${FEEDBACK_URL}" target="_blank" rel="noopener">official IFC thread</a>.
                </p>
                <p class="atcc-err" id="atcc-err" hidden></p>
                <div class="atcc-actions">
                    <button type="button" class="atcc-secondary" data-atcc-act="close">Cancel</button>
                    <button type="button" class="atcc-primary" data-atcc-act="submit" id="atcc-submit">Save note</button>
                </div>
            </div>`;
        const ta = root.querySelector('#atcc-note');
        const left = root.querySelector('#atcc-left');
        ta.addEventListener('input', () => { left.textContent = String(NOTE_MAX - ta.value.length); });
        root.classList.add('is-open');
        this._escHandler = (e) => { if (e.key === 'Escape') this._closeCompose(); };
        document.addEventListener('keydown', this._escHandler);
        setTimeout(() => ta.focus(), 30);
    },

    _pickKind(kind) {
        if (!this._compose || !KINDS[kind]) return;
        this._compose.kind = kind;
        document.querySelectorAll('#atcc-compose .atcc-choice').forEach(b =>
            b.classList.toggle('is-on', b.dataset.atccKind === kind));
    },

    _closeCompose() {
        this._compose = null;
        this._rate = null;
        const root = document.getElementById('atcc-compose');
        if (root) { root.classList.remove('is-open'); root.innerHTML = ''; }
        if (this._escHandler) document.removeEventListener('keydown', this._escHandler);
        this._escHandler = null;
    },

    async _submit() {
        const c = this._compose;
        if (!c) return;
        const btn = document.getElementById('atcc-submit');
        const errEl = document.getElementById('atcc-err');
        const note = (document.getElementById('atcc-note')?.value || '').trim();
        if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
        if (errEl) errEl.hidden = true;

        const { error } = await this._sb.rpc('atc_commend', {
            p_controller_if_id: c.f.userId,
            p_controller_username: c.f.username || null,
            p_airport_icao: c.f.airportName || null,
            p_facility_type: Number.isFinite(c.f.type) ? c.f.type : null,
            p_session_started_at: new Date(c.f.startTime).toISOString(),
            p_kind: c.kind,
            p_note: note || null,
        });

        if (error) {
            if (errEl) { errEl.textContent = error.message || 'Could not send that. Try again.'; errEl.hidden = false; }
            if (btn) { btn.disabled = false; btn.textContent = 'Save note'; }
            return;
        }

        this._closeCompose();
        this._notify(`${KINDS[c.kind].short} Note added to your kudos for ${c.f.username || 'the controller'}.`, 'success');
        await this._refreshAfterChange(c.f);
    },

    /* ─────────────────────────── RateMyATC dialog ─────────────────────────── */

    async _openRate(f, current) {
        if (!(await this._signedIn('rate a controller'))) return;
        this._rate = { f, stars: current || 0 };
        let root = document.getElementById('atcc-compose');
        if (!root) {
            root = document.createElement('div');
            root.id = 'atcc-compose';
            root.className = 'atcc-backdrop';
            root.addEventListener('click', (e) => { if (e.target === root) this._closeCompose(); });
            document.body.appendChild(root);
        }
        const where = [FACILITY[f.type]?.[1], f.airportName].filter(Boolean).join(' · ');
        const stars = [1, 2, 3, 4, 5].map(n => `
            <button type="button" class="atcc-star-btn" data-atcc-act="star" data-atcc-stars="${n}"
                    aria-label="${n} star${n === 1 ? '' : 's'}">★</button>`).join('');
        root.innerHTML = `
            <div class="atcc-dialog" role="dialog" aria-modal="true" aria-labelledby="atcc-rate-title">
                <button type="button" class="atcc-x" data-atcc-act="close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
                <div class="atcc-dialog-badge is-rate" aria-hidden="true">★</div>
                <h3 id="atcc-rate-title">Rate ${this._esc(f.username || 'this controller')}</h3>
                <p class="atcc-where"><b>RateMyATC</b>${where ? ` · ${this._esc(where)}` : ''}</p>
                <div class="atcc-stars" role="radiogroup" aria-label="Stars">${stars}</div>
                <p class="atcc-stars-label" id="atcc-stars-label">Tap a star</p>
                <label class="atcc-label" for="atcc-rate-note">Comment <span>(optional)</span></label>
                <textarea id="atcc-rate-note" maxlength="${RATE_MAX}" rows="3" placeholder="What went well, or what could be better?"></textarea>
                <div class="atcc-meta"><span id="atcc-rate-left">${RATE_MAX}</span> left</div>
                <p class="atcc-visibility" id="atcc-visibility"></p>
                <p class="atcc-policy">
                    Stars are public. To appeal a violation, use the
                    <a href="${FEEDBACK_URL}" target="_blank" rel="noopener">official IFC thread</a>.
                </p>
                <p class="atcc-err" id="atcc-err" hidden></p>
                <div class="atcc-actions">
                    <button type="button" class="atcc-secondary" data-atcc-act="close">Cancel</button>
                    <button type="button" class="atcc-primary" data-atcc-act="rate-submit" id="atcc-rate-submit" disabled>Submit rating</button>
                </div>
            </div>`;
        const ta = root.querySelector('#atcc-rate-note');
        const left = root.querySelector('#atcc-rate-left');
        ta.addEventListener('input', () => { left.textContent = String(RATE_MAX - ta.value.length); });
        root.classList.add('is-open');
        this._escHandler = (e) => { if (e.key === 'Escape') this._closeCompose(); };
        document.addEventListener('keydown', this._escHandler);
        this._pickStars(this._rate.stars);
    },

    _pickStars(n) {
        if (!this._rate) return;
        this._rate.stars = n;
        document.querySelectorAll('#atcc-compose .atcc-star-btn').forEach(b =>
            b.classList.toggle('is-on', Number(b.dataset.atccStars) <= n));
        const labels = ['Tap a star', 'Poor', 'Below average', 'OK', 'Good', 'Excellent'];
        const lab = document.getElementById('atcc-stars-label');
        if (lab) lab.textContent = labels[n] || labels[0];
        const vis = document.getElementById('atcc-visibility');
        if (vis) {
            vis.className = 'atcc-visibility' + (n && n <= 3 ? ' is-private' : n ? ' is-public' : '');
            vis.innerHTML = !n ? ''
                : n <= 3
                    ? '<i class="fa-solid fa-lock"></i> Your comment goes <b>privately to the controller only</b>. It is never shown publicly and your name is not attached. Your stars still count publicly.'
                    : '<i class="fa-solid fa-globe"></i> Your comment will be <b>shown publicly</b> on their profile with your stars.';
        }
        const submit = document.getElementById('atcc-rate-submit');
        if (submit) submit.disabled = !n;
    },

    async _submitRate() {
        const c = this._rate;
        if (!c || !c.stars) return;
        const btn = document.getElementById('atcc-rate-submit');
        const errEl = document.getElementById('atcc-err');
        const comment = (document.getElementById('atcc-rate-note')?.value || '').trim();
        if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
        if (errEl) errEl.hidden = true;
        const { error } = await this._sb.rpc('atc_rate', {
            p_controller_if_id: c.f.userId,
            p_controller_username: c.f.username || null,
            p_airport_icao: c.f.airportName || null,
            p_facility_type: Number.isFinite(c.f.type) ? c.f.type : null,
            p_session_started_at: new Date(c.f.startTime).toISOString(),
            p_stars: c.stars,
            p_comment: comment || null,
        });
        if (error) {
            if (errEl) { errEl.textContent = error.message || 'Could not submit that. Try again.'; errEl.hidden = false; }
            if (btn) { btn.disabled = false; btn.textContent = 'Submit rating'; }
            return;
        }
        this._closeCompose();
        this._notify(comment && c.stars <= 3
            ? `Rated ${c.stars}★. Your comment was sent privately to ${c.f.username || 'the controller'}.`
            : `Rated ${c.stars}★ — thanks for the feedback!`, 'success');
        await this._refreshAfterChange(c.f);
    },

    /* ─────────────────────────── Airport window ─────────────────────────── */

    async _airportData(icao, limit) {
        const { data, error } = await this._sb.rpc('atc_commendations_for_airport', { p_icao: icao, p_limit: limit });
        return error ? null : data;
    },

    // The "On frequency" card's footer: the field's kudos total and the most
    // recent note, so a field with history shows it even when nobody is on.
    async _fillOnFrequency(el) {
        const icao = el.dataset.atccOf;
        if (!this._sb || !icao) return;
        const data = await this._airportData(icao, 1);
        const totalEl = el.querySelector('[data-atcc-total]');
        const latestEl = el.querySelector('[data-atcc-latest]');
        if (!data) return;
        if (totalEl) totalEl.innerHTML = data.total
            ? `<i class="fa-solid fa-award"></i> ${Number(data.total).toLocaleString()} kudos here` : '';
        const r = (data.recent || [])[0];
        if (latestEl) latestEl.innerHTML = r ? `
            <span class="atcc-latest-kind">${(KINDS[r.kind] || KINDS.thumbs_up).short}</span>
            <span class="atcc-latest-text">${r.note ? `“${this._esc(r.note)}”` : `${(KINDS[r.kind] || KINDS.thumbs_up).label} for ${this._esc(r.controller_username || 'a controller')}`}</span>
            <span class="atcc-latest-by">${this._esc(this._byName(r.by))} · ${this._esc(this._ago(r.created_at))}</span>` : '';
        el.classList.toggle('has-latest', !!r);
    },

    async _fillAirport(el) {
        const icao = el.dataset.atccAirport;
        if (!this._sb || !icao) return;
        const data = await this._airportData(icao, 10);
        if (!data) { el.innerHTML = ''; return; }
        const recent = data.recent || [];
        el.innerHTML = `
            <div class="atcc-block">
                <div class="atcc-block-head">
                    <span><i class="fa-solid fa-award"></i> Kudos at ${this._esc(icao)}</span>
                    ${data.total ? `<span class="atcc-pill">${Number(data.total).toLocaleString()}</span>` : ''}
                </div>
                ${recent.length ? recent.map(r => this._noteHTML(r, { showController: true })).join('') : `
                <p class="atcc-empty">No kudos here yet. When this field is staffed, tap 👍 or ☀️ next to a
                    controller to thank them.</p>`}
                ${this._policyLine()}
            </div>`;
    },

    /* ─────────────────────────── Profile ─────────────────────────── */

    // Fills `el` with a controller's kudos and RateMyATC summary and returns
    // the data, so the profile can also put pills on its header/banner. When
    // the profile is the signed-in controller's own, their private feedback
    // (1–3 star comments) shows here too, for their eyes only.
    async renderProfileInto(el, ifUserId, username) {
        if (!el || !ifUserId || !this._sb) return null;
        el.classList.add('atcc-profile');
        el.setAttribute('data-atcc-profile', ifUserId);
        const [k, rt] = await Promise.all([
            this._sb.rpc('atc_commendation_profile', { p_controller_if_id: ifUserId, p_limit: 20 }),
            this._sb.rpc('atc_rating_profile', { p_controller_if_id: ifUserId, p_limit: 10 }),
        ]);
        const data = k.error ? null : k.data;
        const rating = rt.error ? null : rt.data;
        if (!data) {
            el.innerHTML = `<div class="ups-section-title">Kudos</div>
                <div class="ups-empty is-inline"><p>Kudos are unavailable right now.</p></div>`;
            return null;
        }
        const n = (v) => Number(v || 0).toLocaleString();
        const since = data.first_at ? new Date(data.first_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : null;
        const airports = (data.airports || []).map(a =>
            `<span class="atcc-apt-chip">${this._esc(a.icao)} <b>${n(a.count)}</b></span>`).join('');
        const recent = data.recent || [];
        const isMe = !!(this._inbox?.owner && username && this._inbox.username === String(username).toLowerCase());
        el.innerHTML = `
            ${this._ratingBlockHTML(rating, username)}
            ${isMe ? this._privateFeedbackHTML(this._inbox) : ''}
            <div class="ups-section-title">Kudos
                ${data.total ? `<span class="ups-section-count">${n(data.total)}</span>` : ''}
            </div>
            ${data.total ? `
            <div class="atcc-summary">
                <div class="atcc-stat"><span class="atcc-stat-v">👍 ${n(data.thumbs_up)}</span><span class="atcc-stat-l">Thumbs up</span></div>
                <div class="atcc-stat"><span class="atcc-stat-v">☀️ ${n(data.good_day)}</span><span class="atcc-stat-l">Good Day</span></div>
                <div class="atcc-stat"><span class="atcc-stat-v">${n(data.sessions)}</span><span class="atcc-stat-l">Sessions thanked</span></div>
            </div>
            ${since ? `<p class="atcc-since">Thanked by pilots since ${this._esc(since)}</p>` : ''}
            ${airports ? `<div class="atcc-apts">${airports}</div>` : ''}
            ${recent.map(r => this._noteHTML(r, { showAirport: true })).join('')}
            ` : `
            <div class="ups-empty is-inline"><p>No kudos yet. When ${this._esc(username || 'this controller')}
                is on frequency, pilots can thank them from the airport window or the ATC board.</p></div>`}
            ${this._policyLine()}`;
        if (isMe) this._markSeen();
        return { ...data, rating };
    },

    _starsHTML(avg) {
        const v = Math.max(0, Math.min(5, Number(avg) || 0));
        const pct = (v / 5) * 100;
        return `<span class="atcc-stars-meter" aria-label="${v.toFixed(1)} out of 5">
                    <span class="atcc-stars-bg">★★★★★</span>
                    <span class="atcc-stars-fg" style="width:${pct}%">★★★★★</span>
                </span>`;
    },

    _ratingBlockHTML(rating, username) {
        const count = Number(rating?.count || 0);
        if (!count) {
            return `<div class="ups-section-title">RateMyATC ${this._boardLink()}</div>
                <div class="ups-empty is-inline"><p>No ratings yet. Pilots can rate ${this._esc(username || 'this controller')}
                    with ★ next to their name while they are on frequency.</p></div>`;
        }
        const dist = rating.dist || {};
        const bars = [5, 4, 3, 2, 1].map(st => {
            const c = Number(dist[st] || 0);
            const w = count ? Math.round((c / count) * 100) : 0;
            return `<div class="atcc-dist-row"><span>${st}★</span>
                        <span class="atcc-dist-bar"><span style="width:${w}%"></span></span>
                        <span class="atcc-dist-n">${c.toLocaleString()}</span></div>`;
        }).join('');
        const comments = (rating.comments || []).map(c => `
            <div class="atcc-note">
                <span class="atcc-note-kind atcc-note-stars">${'★'.repeat(c.stars)}</span>
                <div class="atcc-note-main">
                    <div class="atcc-note-head"><span>${[FACILITY[c.facility_type]?.[1], c.airport_icao].filter(Boolean).map(x => this._esc(x)).join(' · ')}</span>
                        <span class="atcc-note-time">${this._esc(this._ago(c.created_at))}</span></div>
                    <p class="atcc-note-text">${this._esc(c.comment)}</p>
                    <span class="atcc-note-by">— ${this._esc(this._byName(c.by))}</span>
                </div>
            </div>`).join('');
        return `
            <div class="ups-section-title">RateMyATC <span class="ups-section-count">${count.toLocaleString()}</span> ${this._boardLink()}</div>
            <div class="atcc-rating">
                <div class="atcc-rating-big">
                    <span class="atcc-rating-avg">${Number(rating.avg).toFixed(1)}</span>
                    ${this._starsHTML(rating.avg)}
                    <span class="atcc-rating-count">${count.toLocaleString()} rating${count === 1 ? '' : 's'}</span>
                </div>
                <div class="atcc-dist">${bars}</div>
            </div>
            ${comments}`;
    },

    _boardLink() {
        return '<button type="button" class="atcc-board-link is-inline" data-atcc-act="board">See the board ›</button>';
    },

    _privateFeedbackHTML(inbox) {
        const items = inbox?.feedback || [];
        return `
            <div class="atcc-private">
                <div class="atcc-private-head"><i class="fa-solid fa-lock"></i> Private feedback
                    <span>only you can see this</span></div>
                ${items.length ? items.map(f => `
                    <div class="atcc-note">
                        <span class="atcc-note-kind atcc-note-stars">${'★'.repeat(f.stars)}</span>
                        <div class="atcc-note-main">
                            <div class="atcc-note-head"><span>${[FACILITY[f.facility_type]?.[1], f.airport_icao].filter(Boolean).map(x => this._esc(x)).join(' · ')}</span>
                                <span class="atcc-note-time">${this._esc(this._ago(f.created_at))}</span></div>
                            <p class="atcc-note-text">${this._esc(f.comment)}</p>
                            <span class="atcc-note-by">— anonymous pilot</span>
                        </div>
                    </div>`).join('') : '<p class="atcc-empty">No private feedback. Comments on 1–3 star ratings land here, anonymously.</p>'}
            </div>`;
    },

    // The pills a profile header shows: kudos total and RateMyATC average. On a
    // profile with an InFlight banner they sit on the banner, where they are the
    // first thing anyone opening the profile sees.
    profilePillHTML(data) {
        const total = Number(data?.total || 0);
        const rc = Number(data?.rating?.count || 0);
        const kudos = total ? `<button type="button" class="atcc-profile-pill" data-atcc-act="scroll-kudos"
                    title="${total.toLocaleString()} kudos from pilots — see them">
                    <i class="fa-solid fa-award"></i> ${total.toLocaleString()} kudos
                </button>` : '';
        const stars = rc ? `<button type="button" class="atcc-profile-pill is-rating" data-atcc-act="scroll-kudos"
                    title="RateMyATC: ${Number(data.rating.avg).toFixed(1)} from ${rc} rating${rc === 1 ? '' : 's'}">
                    ★ ${Number(data.rating.avg).toFixed(1)} <span>(${rc.toLocaleString()})</span>
                </button>` : '';
        return kudos + stars;
    },

    /* ─────────────────────────── The controller's own alert ─────────────────────────── */

    // A signed-in controller (their pilot profile carries their IF username)
    // gets a badge on the account pill and a toast when new kudos arrive.
    async _restartInbox() {
        clearInterval(this._inboxTimer);
        this._inboxTimer = null;
        this._inbox = null;
        this._inboxPolledAt = null;
        this._paintPills();
        const { data } = await this._sb.auth.getSession().catch(() => ({ data: null }));
        if (!data?.session) return;
        await this._pollInbox(true);
        this._inboxTimer = setInterval(() => this._pollInbox(), INBOX_POLL_MS);
    },

    _seenAt() {
        try {
            const v = localStorage.getItem(SEEN_KEY);
            if (v && Number.isFinite(Date.parse(v))) return v;
        } catch (_) {}
        // First visit: count the last week as new, so a controller who was
        // thanked before ever signing in here still finds out.
        return new Date(Date.now() - 7 * 86400e3).toISOString();
    },

    _markSeen() {
        try { localStorage.setItem(SEEN_KEY, new Date().toISOString()); } catch (_) {}
        if (this._inbox) { this._inbox.unseen = 0; this._inbox.feedback_unseen = 0; }
        this._paintPills();
    },

    async _pollInbox(first = false) {
        if (!this._sb || document.hidden) return;
        const { data, error } = await this._sb.rpc('atc_kudos_inbox', { p_since: this._seenAt(), p_limit: 5 });
        if (error || !data) return;
        const prevPoll = this._inboxPolledAt;
        this._inboxPolledAt = new Date().toISOString();
        this._inbox = data;
        this._paintPills();
        if (!data.linked) return;
        const fb = Number(data.feedback_unseen || 0);
        if (!data.unseen && !fb) return;

        const recent = data.recent || [];
        if (first) {
            // One summary on load rather than a toast per item.
            if (data.unseen) {
                this._kudosToast(data.unseen > 1
                    ? `You have ${data.unseen} new kudos from pilots.`
                    : this._inboxLine(recent[0]), data.unseen > 1 ? 'New kudos' : 'You got kudos!');
            }
            if (fb) this._kudosToast(`You have ${fb} new private feedback comment${fb === 1 ? '' : 's'} from RateMyATC.`, 'Private feedback', 'info');
            return;
        }
        const isNew = (t) => !prevPoll || Date.parse(t) > Date.parse(prevPoll);
        recent.filter(r => isNew(r.created_at)).slice(0, 3).reverse()
            .forEach(r => this._kudosToast(this._inboxLine(r), 'You got kudos!'));
        (data.feedback || []).filter(f => isNew(f.created_at)).slice(0, 2).reverse()
            .forEach(f => this._kudosToast(`${'★'.repeat(f.stars)} An anonymous pilot left you private feedback${f.airport_icao ? ` at ${f.airport_icao}` : ''}.`, 'Private feedback', 'info'));
    },

    _inboxLine(r) {
        if (!r) return 'A pilot thanked you for controlling.';
        const k = KINDS[r.kind] || KINDS.thumbs_up;
        const at = r.airport_icao ? ` at ${r.airport_icao}` : '';
        return `${k.short} ${this._byName(r.by)} gave you ${k.label}${at}${r.note ? `: “${r.note}”` : '.'}`;
    },

    _kudosToast(message, title, type = 'success') {
        const notify = window.InflightNotify;
        const opts = { title, timeout: 9000, action: { label: 'View', onClick: () => this._openInbox() } };
        if (notify?.notify) notify.notify(message, type, opts);
        else this._notify(message, type);
    },

    _openInbox() {
        const i = this._inbox;
        this._markSeen();
        if (i?.username) this.openProfile(i.username, i.controller_if_id || null);
    },

    _paintPills() {
        const i = this._inbox;
        const unseen = i?.linked ? Number(i.unseen || 0) + Number(i.feedback_unseen || 0) : 0;
        document.querySelectorAll(PILLS).forEach(pill => {
            let badge = pill.querySelector(':scope > .atcc-kudos-badge');
            if (!unseen) { badge?.remove(); return; }
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'atcc-kudos-badge';
                badge.setAttribute('data-atcc-act', 'inbox');
                badge.setAttribute('role', 'button');
                badge.tabIndex = 0;
                pill.style.position = pill.style.position || 'relative';
                pill.appendChild(badge);
            }
            badge.title = `${unseen} new kudos or feedback from pilots — see them`;
            badge.innerHTML = `<i class="fa-solid fa-award"></i><b>${unseen > 9 ? '9+' : unseen}</b>`;
        });
    },

    /* ─────────────────────────── Shared bits ─────────────────────────── */

    _noteHTML(r, { showController = false, showAirport = false } = {}) {
        const k = KINDS[r.kind] || KINDS.thumbs_up;
        const ctx = [
            showController && r.controller_username ? this._esc(r.controller_username) : '',
            FACILITY[r.facility_type]?.[1] || '',
            showAirport && r.airport_icao ? this._esc(r.airport_icao) : '',
        ].filter(Boolean).join(' · ');
        const ctrlLink = showController && r.controller_username
            ? `<button type="button" class="atcc-link" data-atcc-act="profile"
                       data-atcc-user="${this._esc(r.controller_username)}" data-atcc-id="${this._esc(r.controller_if_id || '')}">${ctx}</button>`
            : `<span>${ctx}</span>`;
        return `
            <div class="atcc-note">
                <span class="atcc-note-kind" title="${k.label}">${k.short}</span>
                <div class="atcc-note-main">
                    <div class="atcc-note-head">${ctrlLink}<span class="atcc-note-time">${this._esc(this._ago(r.created_at))}</span></div>
                    ${r.note ? `<p class="atcc-note-text">${this._esc(r.note)}</p>` : `<p class="atcc-note-text is-muted">${k.label}</p>`}
                    <span class="atcc-note-by">— ${this._esc(this._byName(r.by))}</span>
                </div>
            </div>`;
    },

    _byName(by) {
        return (by && (by.display_name || by.handle)) || 'A pilot';
    },

    _policyLine() {
        return `<p class="atcc-policy is-small"><i class="fa-solid fa-circle-info"></i>
            Kudos are thanks only. Violation appeals and other ATC feedback go to the
            <a href="${FEEDBACK_URL}" target="_blank" rel="noopener">IFC feedback thread</a>.</p>`;
    },

    _duration(startTime) {
        const api = window.InflightATC;
        if (api && typeof api.formatDuration === 'function') {
            try { return api.formatDuration(startTime) || ''; } catch (_) {}
        }
        const t = Date.parse(startTime);
        if (!Number.isFinite(t)) return '';
        const m = Math.max(0, Math.round((Date.now() - t) / 60000));
        return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
    },

    _ago(iso) {
        const t = Date.parse(iso);
        if (!Number.isFinite(t)) return '';
        const s = Math.max(0, (Date.now() - t) / 1000);
        if (s < 60) return 'just now';
        if (s < 3600) return `${Math.floor(s / 60)}m ago`;
        if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
        if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
        return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    },

    _notify(msg, type) {
        if (typeof window.showNotification === 'function') window.showNotification(msg, type);
    },

    _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    },

    _injectStyles() {
        if (this._stylesInjected) return;
        this._stylesInjected = true;
        const css = `
            .atcc-controls { display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; margin-left: auto; }
            .atcc-btn { display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 28px; min-width: 34px; padding: 0 8px;
                border-radius: 14px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.05);
                color: #e4e4e7; font-family: inherit; font-weight: 700; font-size: 0.72rem; line-height: 1; cursor: pointer;
                transition: background .15s, color .15s, border-color .15s, transform .1s; }
            .atcc-btn:hover { background: rgba(255,255,255,0.12); color: #fff; }
            .atcc-btn:active { transform: scale(0.94); }
            .atcc-btn:focus-visible { outline: 2px solid #38bdf8; outline-offset: 1px; }
            .atcc-emoji { font-size: 0.9rem; line-height: 1; }
            .atcc-btn.is-on.atcc-thumbs_up { background: rgba(56,189,248,0.2); border-color: rgba(56,189,248,0.7); color: #bae6fd; }
            .atcc-btn.is-on.atcc-good_day { background: rgba(251,191,36,0.2); border-color: rgba(251,191,36,0.7); color: #fde68a; }
            .atcc-btn .atcc-n:empty { display: none; }
            .atcc-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
            .atcc-view { color: #a1a1aa; min-width: 28px; padding: 0; }

            /* On frequency card (airport window) */
            .atcc-of { margin: 12px 16px 0; padding: 12px; border-radius: 12px;
                background: linear-gradient(180deg, rgba(56,189,248,0.07), rgba(255,255,255,0.02));
                border: 1px solid rgba(56,189,248,0.18); }
            .atcc-of-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
            .atcc-of-title { display: inline-flex; align-items: center; gap: 8px; font-size: 0.72rem; font-weight: 800;
                letter-spacing: .06em; text-transform: uppercase; color: #e0f2fe; }
            .atcc-live-dot { width: 8px; height: 8px; border-radius: 50%; background: #4ade80; box-shadow: 0 0 0 3px rgba(74,222,128,0.2);
                animation: atcc-pulse 2s ease-in-out infinite; }
            .atcc-live-dot.is-off { background: #52525b; box-shadow: none; animation: none; }
            @keyframes atcc-pulse { 50% { box-shadow: 0 0 0 6px rgba(74,222,128,0.05); } }
            .atcc-of-total { font-size: 0.7rem; font-weight: 700; color: #fcd34d; white-space: nowrap; }
            .atcc-of-head-right { display: inline-flex; align-items: center; gap: 8px; }
            .atcc-board-link { padding: 3px 9px; border-radius: 999px; border: 1px solid rgba(250,204,21,0.45);
                background: rgba(250,204,21,0.1); color: #fde68a; font-family: inherit; font-size: 0.66rem; font-weight: 800;
                cursor: pointer; white-space: nowrap; }
            .atcc-board-link:hover { background: rgba(250,204,21,0.2); }
            .atcc-board-link.is-inline { margin-left: auto; font-size: 0.62rem; padding: 2px 8px; text-transform: none; letter-spacing: 0; }
            .atcc-of-total i { margin-right: 3px; }
            .atcc-of-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; }
            .atcc-of-row + .atcc-of-row { border-top: 1px solid rgba(255,255,255,0.06); }
            .atcc-type { flex: 0 0 auto; width: 42px; text-align: center; padding: 4px 0; border-radius: 6px;
                font-size: 0.62rem; font-weight: 800; letter-spacing: .04em; background: rgba(255,255,255,0.08); color: #d4d4d8; }
            .atcc-type-twr { background: rgba(248,113,113,0.16); color: #fca5a5; }
            .atcc-type-gnd { background: rgba(74,222,128,0.14); color: #86efac; }
            .atcc-type-app { background: rgba(96,165,250,0.16); color: #93c5fd; }
            .atcc-type-ctr { background: rgba(192,132,252,0.16); color: #d8b4fe; }
            .atcc-of-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
            .atcc-of-name { padding: 0; border: 0; background: none; font-family: inherit; font-size: 0.86rem; font-weight: 700;
                color: #f4f4f5; text-align: left; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            button.atcc-of-name:hover { color: #7dd3fc; }
            .atcc-of-dur { font-size: 0.68rem; color: #a1a1aa; }
            .atcc-of-empty { margin: 2px 0 0; font-size: 0.75rem; line-height: 1.45; color: #a1a1aa; }
            .atcc-of-latest:empty { display: none; }
            .atcc-of-latest { display: grid; grid-template-columns: auto 1fr; column-gap: 8px; margin-top: 8px; padding: 8px 10px;
                border-radius: 8px; background: rgba(251,191,36,0.07); border: 1px solid rgba(251,191,36,0.15); }
            .atcc-latest-kind { grid-row: span 2; font-size: 1rem; line-height: 1.2; }
            .atcc-latest-text { font-size: 0.78rem; color: #fef3c7; overflow-wrap: anywhere; }
            .atcc-latest-by { font-size: 0.66rem; color: #a1a1aa; }

            /* Give-kudos dialog */
            .atcc-backdrop { position: fixed; inset: 0; z-index: 100000; display: none; align-items: center; justify-content: center;
                padding: 16px; background: rgba(0,0,0,0.55); backdrop-filter: blur(4px); }
            .atcc-backdrop.is-open { display: flex; }
            .atcc-dialog { position: relative; width: 100%; max-width: 420px; padding: 22px 20px 18px; border-radius: 16px;
                background: #18181b; border: 1px solid rgba(255,255,255,0.1); color: #e4e4e7;
                box-shadow: 0 24px 60px rgba(0,0,0,0.5); font-family: inherit; }
            .atcc-dialog-badge { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; margin-bottom: 10px;
                background: linear-gradient(135deg, #fbbf24, #f59e0b); color: #1c1917; font-size: 1.1rem; }
            .atcc-dialog h3 { margin: 0 28px 4px 0; font-size: 1.05rem; color: #fff; }
            .atcc-x { position: absolute; top: 12px; right: 12px; width: 30px; height: 30px; border-radius: 50%; border: 0;
                background: rgba(255,255,255,0.06); color: #a1a1aa; cursor: pointer; }
            .atcc-where { margin: 0 0 14px; font-size: 0.78rem; color: #a1a1aa; }
            .atcc-choices { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px; }
            .atcc-choice { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px 8px; border-radius: 12px;
                border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); color: #e4e4e7;
                font-family: inherit; font-weight: 600; font-size: 0.85rem; cursor: pointer; }
            .atcc-choice.is-on { border-color: #38bdf8; background: rgba(56,189,248,0.14); color: #fff; }
            .atcc-choice-emoji { font-size: 1.15rem; }
            .atcc-label { display: block; font-size: 0.75rem; font-weight: 600; color: #d4d4d8; margin-bottom: 6px; }
            .atcc-label span { color: #71717a; font-weight: 400; }
            #atcc-note { width: 100%; box-sizing: border-box; resize: vertical; min-height: 64px; padding: 10px 12px; border-radius: 10px;
                border: 1px solid rgba(255,255,255,0.12); background: #0f0f12; color: #f4f4f5;
                font-family: inherit; font-size: 0.85rem; line-height: 1.4; }
            #atcc-note:focus { outline: none; border-color: #38bdf8; }
            .atcc-meta { margin-top: 4px; font-size: 0.68rem; color: #71717a; }
            .atcc-policy { margin: 12px 0 0; font-size: 0.72rem; line-height: 1.45; color: #a1a1aa; }
            .atcc-policy a { color: #7dd3fc; }
            .atcc-policy.is-small { margin-top: 10px; font-size: 0.66rem; color: #71717a; }
            .atcc-err { margin: 10px 0 0; padding: 8px 10px; border-radius: 8px; background: rgba(239,68,68,0.12); color: #fca5a5; font-size: 0.75rem; }
            .atcc-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
            .atcc-primary, .atcc-secondary { height: 36px; padding: 0 16px; border-radius: 10px; border: 0;
                font-family: inherit; font-weight: 600; font-size: 0.82rem; cursor: pointer; }
            .atcc-primary { background: #0ea5e9; color: #fff; }
            .atcc-primary:disabled { opacity: 0.6; cursor: default; }
            .atcc-secondary { background: rgba(255,255,255,0.08); color: #e4e4e7; }

            /* Kudos list (ATC tab, profile) */
            .atcc-block { margin: 12px; padding: 12px; border-radius: 10px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); }
            .atcc-block-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;
                font-size: 0.72rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #a1a1aa; }
            .atcc-block-head i { color: #fbbf24; margin-right: 6px; }
            .atcc-pill { padding: 2px 8px; border-radius: 999px; background: rgba(251,191,36,0.15); color: #fcd34d; font-size: 0.68rem; }
            .atcc-empty { margin: 0; font-size: 0.75rem; line-height: 1.45; color: #71717a; }
            .atcc-note { display: flex; gap: 10px; padding: 8px 0; }
            .atcc-note + .atcc-note { border-top: 1px solid rgba(255,255,255,0.06); }
            .atcc-note-kind { flex: 0 0 auto; font-size: 1rem; line-height: 1.3; }
            .atcc-note-main { min-width: 0; flex: 1 1 auto; }
            .atcc-note-head { display: flex; justify-content: space-between; gap: 8px; font-size: 0.7rem; color: #a1a1aa; }
            .atcc-note-time { flex: 0 0 auto; color: #71717a; }
            .atcc-note-text { margin: 2px 0; font-size: 0.8rem; line-height: 1.4; color: #e4e4e7; overflow-wrap: anywhere; }
            .atcc-note-text.is-muted { color: #a1a1aa; font-style: italic; }
            .atcc-note-by { font-size: 0.68rem; color: #71717a; }
            .atcc-link { padding: 0; border: 0; background: none; color: #7dd3fc; font: inherit; cursor: pointer; text-align: left; }
            .atcc-link:hover { text-decoration: underline; }

            .atcc-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 8px; }
            .atcc-stat { display: flex; flex-direction: column; gap: 2px; padding: 10px; border-radius: 10px; background: rgba(255,255,255,0.04); }
            .atcc-stat-v { font-size: 1rem; font-weight: 700; color: #fff; }
            .atcc-stat-l { font-size: 0.66rem; color: #a1a1aa; text-transform: uppercase; letter-spacing: .04em; }
            .atcc-since { margin: 0 0 8px; font-size: 0.72rem; color: #a1a1aa; }
            .atcc-apts { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
            .atcc-apt-chip { padding: 3px 8px; border-radius: 999px; background: rgba(56,189,248,0.1); color: #7dd3fc; font-size: 0.7rem; font-family: monospace; }
            .atcc-apt-chip b { color: #e0f2fe; }

            /* Profile pill (sits on the banner when the pilot has one) */
            .atcc-profile-pill { display: inline-flex; align-items: center; gap: 6px; margin-top: 6px; padding: 4px 10px;
                border-radius: 999px; border: 1px solid rgba(251,191,36,0.55);
                background: linear-gradient(135deg, rgba(251,191,36,0.28), rgba(245,158,11,0.18));
                color: #fef3c7; font-family: inherit; font-size: 0.72rem; font-weight: 800; cursor: pointer;
                box-shadow: 0 2px 10px rgba(0,0,0,0.25); backdrop-filter: blur(6px); animation: atcc-pop .35s ease-out; }
            .atcc-profile-pill i { color: #fbbf24; }
            @keyframes atcc-pop { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }

            .atcc-btn.is-sending { opacity: .6; }
            .atcc-rate .atcc-star { color: #fbbf24; font-size: 0.85rem; }
            .atcc-rate.is-on { background: rgba(251,191,36,0.16); border-color: rgba(251,191,36,0.6); color: #fde68a; }
            .atcc-profile-pill.is-rating { border-color: rgba(250,204,21,0.5); background: rgba(24,24,27,0.55); color: #fde68a; margin-left: 6px; }
            .atcc-profile-pill.is-rating span { color: #a1a1aa; font-weight: 600; }

            /* RateMyATC dialog */
            .atcc-dialog-badge.is-rate { background: linear-gradient(135deg, #facc15, #f97316); font-size: 1.3rem; }
            .atcc-stars { display: flex; gap: 6px; justify-content: center; margin: 6px 0 2px; }
            .atcc-star-btn { width: 46px; height: 46px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.12);
                background: rgba(255,255,255,0.04); color: #52525b; font-size: 1.6rem; line-height: 1; cursor: pointer;
                transition: color .12s, transform .12s, background .12s; }
            .atcc-star-btn:hover { transform: translateY(-1px); }
            .atcc-star-btn.is-on { color: #facc15; background: rgba(250,204,21,0.12); border-color: rgba(250,204,21,0.5); }
            .atcc-stars-label { text-align: center; margin: 4px 0 12px; font-size: 0.78rem; font-weight: 700; color: #e4e4e7; min-height: 1em; }
            #atcc-rate-note { width: 100%; box-sizing: border-box; resize: vertical; min-height: 64px; padding: 10px 12px; border-radius: 10px;
                border: 1px solid rgba(255,255,255,0.12); background: #0f0f12; color: #f4f4f5;
                font-family: inherit; font-size: 0.85rem; line-height: 1.4; }
            #atcc-rate-note:focus { outline: none; border-color: #facc15; }
            .atcc-visibility { margin: 10px 0 0; padding: 0; font-size: 0.74rem; line-height: 1.45; color: #a1a1aa; }
            .atcc-visibility:empty { display: none; }
            .atcc-visibility.is-private { padding: 8px 10px; border-radius: 8px; background: rgba(167,139,250,0.1); border: 1px solid rgba(167,139,250,0.3); color: #ddd6fe; }
            .atcc-visibility.is-public { padding: 8px 10px; border-radius: 8px; background: rgba(74,222,128,0.08); border: 1px solid rgba(74,222,128,0.25); color: #bbf7d0; }

            /* RateMyATC on the profile */
            .atcc-rating { display: grid; grid-template-columns: auto 1fr; gap: 16px; align-items: center; margin-bottom: 10px;
                padding: 12px; border-radius: 12px; background: rgba(255,255,255,0.04); }
            .atcc-rating-big { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 92px; }
            .atcc-rating-avg { font-size: 2rem; font-weight: 800; color: #fff; line-height: 1; }
            .atcc-rating-count { font-size: 0.66rem; color: #a1a1aa; }
            .atcc-stars-meter { position: relative; display: inline-block; font-size: 0.95rem; letter-spacing: 1px; line-height: 1; }
            .atcc-stars-bg { color: #3f3f46; }
            .atcc-stars-fg { position: absolute; inset: 0 auto 0 0; overflow: hidden; white-space: nowrap; color: #facc15; }
            .atcc-dist { display: flex; flex-direction: column; gap: 3px; }
            .atcc-dist-row { display: grid; grid-template-columns: 26px 1fr 28px; gap: 6px; align-items: center; font-size: 0.66rem; color: #a1a1aa; }
            .atcc-dist-bar { height: 6px; border-radius: 3px; background: rgba(255,255,255,0.08); overflow: hidden; }
            .atcc-dist-bar span { display: block; height: 100%; background: #facc15; border-radius: 3px; }
            .atcc-dist-n { text-align: right; }
            .atcc-note-stars { color: #facc15; font-size: 0.7rem; letter-spacing: -1px; white-space: nowrap; }
            .atcc-private { margin: 10px 0 14px; padding: 12px; border-radius: 12px; background: rgba(167,139,250,0.08); border: 1px solid rgba(167,139,250,0.28); }
            .atcc-private-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; font-size: 0.75rem; font-weight: 800; color: #ddd6fe; }
            .atcc-private-head span { font-weight: 500; font-size: 0.66rem; color: #a78bfa; }

            /* New-kudos badge on the account pill */
            .atcc-kudos-badge { position: absolute; top: -6px; left: -6px; z-index: 2; display: inline-flex; align-items: center; gap: 3px;
                height: 20px; padding: 0 6px; border-radius: 10px; background: linear-gradient(135deg, #fbbf24, #f59e0b);
                color: #1c1917; font-size: 0.66rem; line-height: 1; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.35);
                animation: atcc-pop .35s ease-out; }
            .atcc-kudos-badge b { font-weight: 800; }

            @media (max-width: 480px) {
                .atcc-btn { height: 32px; min-width: 38px; }
                .atcc-dialog { padding: 20px 16px 16px; }
                .atcc-of { margin: 10px 12px 0; }
            }
        `;
        const style = document.createElement('style');
        style.id = 'atcc-styles';
        style.textContent = css;
        document.head.appendChild(style);
    },
};

export default AtcKudos;
