/**
 * ATC commendations — a thumbs-up or a "Good Day" for a controller on frequency.
 *
 * Controllers volunteer their evenings to open fields that would otherwise be
 * uncontrolled. This gives pilots a way to say thanks: a button on every live
 * controller row (airport window, desktop ATC board, mobile ATC sheet), an
 * optional short note, and a section on the controller's profile that collects
 * everything they have been given.
 *
 * POSITIVE ONLY. There is no thumbs-down. Anybody with a complaint, or a
 * violation to appeal, is pointed at the IFC thread where Infinite Flight
 * actually handles that (FEEDBACK_URL below).
 *
 * HOW IT PLUGS IN. Render sites only emit markup — `controlsHTML(facility)`
 * for a controller row and `airportSectionHTML(icao)` for an airport — and a
 * MutationObserver hydrates any such markup that appears, wherever it was
 * rendered from. Counts are cached per controller for a minute, so boards that
 * re-render on every ATC tick do not re-query.
 *
 * Backend: the `atc_*` RPCs in Inflight-IOS
 * supabase/migrations/20261015000000_atc_commendations.sql.
 */

const FEEDBACK_URL = 'https://community.infiniteflight.com/t/procedures-for-appealing-violations-and-providing-atc-feedback/795506';
const NOTE_MAX = 140;
const COUNTS_TTL_MS = 60 * 1000;

const KINDS = {
    thumbs_up: { label: 'Thumbs up', short: '👍', icon: 'fa-thumbs-up' },
    good_day:  { label: 'Good Day',  short: '☀️', icon: 'fa-sun' },
};

const FACILITY_LABELS = {
    0: 'Ground', 1: 'Tower', 2: 'Unicom', 3: 'Clearance', 4: 'Approach',
    5: 'Departure', 6: 'Center', 7: 'ATIS',
};

export const AtcCommendations = {
    _sb: null,
    _counts: new Map(),      // controllerId -> { at, total, thumbs_up, good_day, my_session_started_at, my_kind }
    _pending: null,          // Promise of the in-flight counts fetch
    _scanTimer: null,
    _stylesInjected: false,
    _compose: null,          // facility being commended in the open dialog

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
        window.InflightCommendations = this;
    },

    /* ─────────────────────────── Markup for render sites ─────────────────────────── */

    // Buttons for one live controller row. `f` is a facility from the IF ATC
    // feed (userId, username, airportName, type, startTime). Returns '' for a
    // facility that cannot be commended (no id or no session start).
    controlsHTML(f) {
        if (!f || !f.userId || !f.startTime) return '';
        const attrs = [
            `data-atcc-id="${this._esc(f.userId)}"`,
            `data-atcc-user="${this._esc(f.username || '')}"`,
            `data-atcc-apt="${this._esc(f.airportName || '')}"`,
            `data-atcc-type="${this._esc(f.type ?? '')}"`,
            `data-atcc-start="${this._esc(f.startTime)}"`,
        ].join(' ');
        const btn = (kind) => `
            <button type="button" class="atcc-btn" data-atcc-act="${kind}" aria-pressed="false"
                    title="${KINDS[kind].label} — thank this controller">
                <i class="fa-solid ${KINDS[kind].icon}"></i><span class="atcc-n" data-atcc-n="${kind}"></span>
            </button>`;
        return `
            <span class="atcc-controls" ${attrs}>
                ${btn('thumbs_up')}${btn('good_day')}
                <button type="button" class="atcc-btn atcc-view" data-atcc-act="view"
                        title="View this controller's commendations">
                    <i class="fa-solid fa-award"></i>
                </button>
            </span>`;
    },

    // A placeholder for an airport's recent commendations; filled on hydrate.
    airportSectionHTML(icao) {
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
        const airports = [...document.querySelectorAll('.atcc-airport[data-atcc-airport]:not([data-atcc-ready])')];
        airports.forEach(el => {
            el.setAttribute('data-atcc-ready', '1');
            this._fillAirport(el);
        });
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
                const { data, error } = await this._sb.rpc('atc_commendation_counts', { p_controller_if_ids: want.slice(0, 100) });
                if (error) throw error;
                const at = Date.now();
                (data || []).forEach(r => this._counts.set(r.controller_if_id, { ...r, at }));
            } catch (err) {
                console.warn('[AtcCommendations] counts failed:', err?.message || err);
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
            b.title = on ? `You sent ${label} — press again to take it back` : `${label} — thank this controller`;
        });
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
        if (act === 'pick') return this._pickKind(btn.dataset.atccKind);
        if (act === 'profile') return this.openProfile(btn.dataset.atccUser, btn.dataset.atccId);

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
        if (act === 'thumbs_up' || act === 'good_day') {
            // Pressing your own highlighted button again takes it back.
            if (btn.classList.contains('is-on')) return this._withdraw(f, act);
            this._openCompose(f, act);
        }
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
        this._notify(`${KINDS[kind].label} withdrawn.`, 'info');
        await this._refreshAfterChange(f);
    },

    async _refreshAfterChange(f) {
        await this._ensureCounts([f.userId], true);
        this._repaintAll(f.userId);
        document.querySelectorAll(`.atcc-airport[data-atcc-airport="${CSS.escape(f.airportName || '')}"]`)
            .forEach(el => this._fillAirport(el));
        document.querySelectorAll(`.atcc-profile[data-atcc-profile="${CSS.escape(f.userId)}"]`)
            .forEach(el => this.renderProfileInto(el, f.userId, f.username));
    },

    // Opens the controller's profile scrolled to their commendations.
    openProfile(username, userId) {
        if (!username) return;
        try { window.InflightHaptics?.select?.(); } catch (_) {}
        import('./UserProfileUI.js')
            .then(m => m.UserProfileUI.open({ username, userId: userId || null, focus: 'commendations' }))
            .catch(err => console.error('Failed to load UserProfileUI:', err));
    },

    /* ─────────────────────────── Compose dialog ─────────────────────────── */

    async _openCompose(f, kind) {
        const { data } = await this._sb.auth.getSession().catch(() => ({ data: null }));
        if (!data?.session) {
            this._notify('Sign in to commend a controller.', 'info');
            try { window.AuthUI?.open?.(); } catch (_) {}
            return;
        }
        this._compose = { f, kind };
        let root = document.getElementById('atcc-compose');
        if (!root) {
            root = document.createElement('div');
            root.id = 'atcc-compose';
            root.className = 'atcc-backdrop';
            root.addEventListener('click', (e) => { if (e.target === root) this._closeCompose(); });
            document.body.appendChild(root);
        }
        const where = [FACILITY_LABELS[f.type], f.airportName].filter(Boolean).join(' · ');
        const choice = (k) => `
            <button type="button" class="atcc-choice${k === kind ? ' is-on' : ''}" data-atcc-act="pick" data-atcc-kind="${k}">
                <span class="atcc-choice-emoji">${KINDS[k].short}</span>${KINDS[k].label}
            </button>`;
        root.innerHTML = `
            <div class="atcc-dialog" role="dialog" aria-modal="true" aria-labelledby="atcc-title">
                <button type="button" class="atcc-x" data-atcc-act="close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
                <h3 id="atcc-title">Commend ${this._esc(f.username || 'this controller')}</h3>
                ${where ? `<p class="atcc-where"><i class="fa-solid fa-headset"></i> ${this._esc(where)}</p>` : ''}
                <div class="atcc-choices">${choice('thumbs_up')}${choice('good_day')}</div>
                <label class="atcc-label" for="atcc-note">Add a note <span>(optional)</span></label>
                <textarea id="atcc-note" maxlength="${NOTE_MAX}" rows="3"
                    placeholder="Thanks for opening the field — smooth flow tonight!"></textarea>
                <div class="atcc-meta"><span id="atcc-left">${NOTE_MAX}</span> left · shown on the airport and on their profile</div>
                <p class="atcc-policy">
                    Commendations are for thanks only. To appeal a violation or give other ATC feedback, use the
                    <a href="${FEEDBACK_URL}" target="_blank" rel="noopener">official IFC thread</a>.
                </p>
                <p class="atcc-err" id="atcc-err" hidden></p>
                <div class="atcc-actions">
                    <button type="button" class="atcc-secondary" data-atcc-act="close">Cancel</button>
                    <button type="button" class="atcc-primary" data-atcc-act="submit" id="atcc-submit">Send</button>
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
            if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
            return;
        }

        this._closeCompose();
        this._notify(`${KINDS[c.kind].short} Sent to ${c.f.username || 'the controller'} — thanks for supporting ATC!`, 'success');
        await this._refreshAfterChange(c.f);
    },

    /* ─────────────────────────── Airport window ─────────────────────────── */

    async _fillAirport(el) {
        const icao = el.dataset.atccAirport;
        if (!this._sb || !icao) return;
        const { data, error } = await this._sb.rpc('atc_commendations_for_airport', { p_icao: icao, p_limit: 10 });
        if (error || !data) { el.innerHTML = ''; return; }
        const recent = data.recent || [];
        el.innerHTML = `
            <div class="atcc-block">
                <div class="atcc-block-head">
                    <span><i class="fa-solid fa-award"></i> ATC commendations</span>
                    ${data.total ? `<span class="atcc-pill">${Number(data.total).toLocaleString()}</span>` : ''}
                </div>
                ${recent.length ? recent.map(r => this._noteHTML(r, { showController: true })).join('') : `
                <p class="atcc-empty">No commendations here yet. When this field is staffed, tap
                    <i class="fa-solid fa-thumbs-up"></i> or <i class="fa-solid fa-sun"></i> on a controller to thank them.</p>`}
                ${this._policyLine()}
            </div>`;
    },

    /* ─────────────────────────── Profile ─────────────────────────── */

    // Fills `el` with the controller's commendation summary. Safe to call
    // repeatedly; the element remembers whose it is.
    async renderProfileInto(el, ifUserId, username) {
        if (!el || !ifUserId || !this._sb) return;
        el.classList.add('atcc-profile');
        el.setAttribute('data-atcc-profile', ifUserId);
        const { data, error } = await this._sb.rpc('atc_commendation_profile', { p_controller_if_id: ifUserId, p_limit: 20 });
        if (error || !data) {
            el.innerHTML = `<div class="ups-section-title">ATC commendations</div>
                <div class="ups-empty is-inline"><p>Commendations are unavailable right now.</p></div>`;
            return;
        }
        const n = (v) => Number(v || 0).toLocaleString();
        const since = data.first_at ? new Date(data.first_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : null;
        const airports = (data.airports || []).map(a =>
            `<span class="atcc-apt-chip">${this._esc(a.icao)} <b>${n(a.count)}</b></span>`).join('');
        const recent = data.recent || [];
        el.innerHTML = `
            <div class="ups-section-title">ATC commendations
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
            <div class="ups-empty is-inline"><p>No commendations yet. When ${this._esc(username || 'this controller')}
                is on frequency, pilots can thank them from the airport window or the ATC board.</p></div>`}
            ${this._policyLine()}`;
    },

    /* ─────────────────────────── Shared bits ─────────────────────────── */

    _noteHTML(r, { showController = false, showAirport = false } = {}) {
        const k = KINDS[r.kind] || KINDS.thumbs_up;
        const by = r.by && (r.by.display_name || r.by.handle)
            ? this._esc(r.by.display_name || r.by.handle) : 'A pilot';
        const ctx = [
            showController && r.controller_username ? this._esc(r.controller_username) : '',
            FACILITY_LABELS[r.facility_type] || '',
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
                    <span class="atcc-note-by">— ${by}</span>
                </div>
            </div>`;
    },

    _policyLine() {
        return `<p class="atcc-policy is-small"><i class="fa-solid fa-circle-info"></i>
            Thanks only. Violation appeals and other ATC feedback go to the
            <a href="${FEEDBACK_URL}" target="_blank" rel="noopener">IFC feedback thread</a>.</p>`;
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
            .atcc-btn { display: inline-flex; align-items: center; gap: 4px; height: 26px; min-width: 26px; padding: 0 7px;
                border-radius: 13px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.05);
                color: #d4d4d8; font-family: inherit; font-weight: 600; font-size: 0.7rem; line-height: 1; cursor: pointer; transition: background .15s, color .15s, border-color .15s; }
            .atcc-btn:hover { background: rgba(255,255,255,0.12); color: #fff; }
            .atcc-btn:focus-visible { outline: 2px solid #38bdf8; outline-offset: 1px; }
            .atcc-btn.is-on[data-atcc-act="thumbs_up"] { background: rgba(56,189,248,0.18); border-color: rgba(56,189,248,0.6); color: #7dd3fc; }
            .atcc-btn.is-on[data-atcc-act="good_day"] { background: rgba(251,191,36,0.18); border-color: rgba(251,191,36,0.6); color: #fcd34d; }
            .atcc-btn .atcc-n:empty { display: none; }
            .atcc-view { color: #a1a1aa; }
            .atc-grid-card:has(.atcc-controls) { flex-wrap: wrap; gap: 6px 10px; }
            .atc-grid-card .atcc-controls { margin-left: 0; }

            .atcc-backdrop { position: fixed; inset: 0; z-index: 100000; display: none; align-items: center; justify-content: center;
                padding: 16px; background: rgba(0,0,0,0.55); backdrop-filter: blur(4px); }
            .atcc-backdrop.is-open { display: flex; }
            .atcc-dialog { position: relative; width: 100%; max-width: 420px; padding: 22px 20px 18px; border-radius: 16px;
                background: #18181b; border: 1px solid rgba(255,255,255,0.1); color: #e4e4e7;
                box-shadow: 0 24px 60px rgba(0,0,0,0.5); font-family: inherit; }
            .atcc-dialog h3 { margin: 0 28px 4px 0; font-size: 1.05rem; color: #fff; }
            .atcc-x { position: absolute; top: 12px; right: 12px; width: 30px; height: 30px; border-radius: 50%; border: 0;
                background: rgba(255,255,255,0.06); color: #a1a1aa; cursor: pointer; }
            .atcc-where { margin: 0 0 14px; font-size: 0.78rem; color: #a1a1aa; }
            .atcc-choices { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px; }
            .atcc-choice { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 12px 8px; border-radius: 12px;
                border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); color: #e4e4e7; font-family: inherit; font-weight: 600; font-size: 0.85rem; cursor: pointer; }
            .atcc-choice.is-on { border-color: #38bdf8; background: rgba(56,189,248,0.14); color: #fff; }
            .atcc-choice-emoji { font-size: 1.15rem; }
            .atcc-label { display: block; font-size: 0.75rem; font-weight: 600; color: #d4d4d8; margin-bottom: 6px; }
            .atcc-label span { color: #71717a; font-weight: 400; }
            #atcc-note { width: 100%; box-sizing: border-box; resize: vertical; min-height: 64px; padding: 10px 12px; border-radius: 10px;
                border: 1px solid rgba(255,255,255,0.12); background: #0f0f12; color: #f4f4f5; font-family: inherit; font-size: 0.85rem; line-height: 1.4; }
            #atcc-note:focus { outline: none; border-color: #38bdf8; }
            .atcc-meta { margin-top: 4px; font-size: 0.68rem; color: #71717a; }
            .atcc-policy { margin: 12px 0 0; font-size: 0.72rem; line-height: 1.45; color: #a1a1aa; }
            .atcc-policy a { color: #7dd3fc; }
            .atcc-policy.is-small { margin-top: 10px; font-size: 0.66rem; color: #71717a; }
            .atcc-err { margin: 10px 0 0; padding: 8px 10px; border-radius: 8px; background: rgba(239,68,68,0.12); color: #fca5a5; font-size: 0.75rem; }
            .atcc-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
            .atcc-primary, .atcc-secondary { height: 36px; padding: 0 16px; border-radius: 10px; border: 0; font-family: inherit; font-weight: 600; font-size: 0.82rem; cursor: pointer; }
            .atcc-primary { background: #0ea5e9; color: #fff; }
            .atcc-primary:disabled { opacity: 0.6; cursor: default; }
            .atcc-secondary { background: rgba(255,255,255,0.08); color: #e4e4e7; }

            .atcc-block { margin: 4px 12px 12px; padding: 12px; border-radius: 10px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); }
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

            @media (max-width: 480px) {
                .atcc-btn { height: 30px; min-width: 30px; }
                .atcc-dialog { padding: 20px 16px 16px; }
            }
        `;
        const style = document.createElement('style');
        style.id = 'atcc-styles';
        style.textContent = css;
        document.head.appendChild(style);
    },
};

export default AtcCommendations;
