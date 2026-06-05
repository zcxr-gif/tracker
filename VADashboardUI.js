import {
    getSession, isStaff, getMyApplications, submitApplication,
    getVaByCeo, listEventsForVa, createEvent, formatEventTime, isLive,
    listUpcomingApprovedEvents, listPendingApplications, approveApplication,
    rejectApplication, slugify
} from './vaService.js';

export const VADashboardUI = {
    _supabase: null,
    _isOpen: false,
    _activeTab: 'home',
    _user: null,
    _myVA: null,
    _myApps: [],
    _isStaff: false,
    _events: [],
    _injected: false,

    init(supabaseClient) {
        this._supabase = supabaseClient;
    },

    async open(user) {
        if (!this._injected) {
            this._injectStyles();
            this._injected = true;
        }
        this._user = user;
        this._isOpen = true;
        this._activeTab = 'home';

        // Remove old shell if present so we rebuild with correct staff tabs
        const old = document.getElementById('va-dashboard-overlay');
        if (old) old.remove();

        this._buildShell();
        this._show();
        await this._loadData();
        this._switchTab('home');
    },

    close() {
        const overlay = document.getElementById('va-dashboard-overlay');
        if (!overlay) return;
        overlay.classList.remove('va-dash-visible');
        setTimeout(() => {
            if (!overlay.classList.contains('va-dash-visible')) overlay.remove();
        }, 320);
        this._isOpen = false;
    },

    async _loadData() {
        const [myVA, myApps, staffResult] = await Promise.all([
            getVaByCeo().catch(() => null),
            getMyApplications().catch(() => []),
            isStaff().catch(() => false)
        ]);
        this._myVA = myVA;
        this._myApps = myApps;
        this._isStaff = staffResult;
        if (myVA) {
            this._events = await listEventsForVa(myVA.id).catch(() => []);
        }
    },

    _buildShell() {
        const overlay = document.createElement('div');
        overlay.id = 'va-dashboard-overlay';
        overlay.className = 'va-dash-overlay';
        overlay.innerHTML = `
            <div class="va-dash-card" role="dialog" aria-label="VA Partnership Dashboard">
                <div class="va-dash-top-strip">
                    <div class="va-dash-brand">
                        <div class="va-dash-brand-dot"></div>
                        <span class="va-dash-brand-text">VA Partnership</span>
                    </div>
                    <div class="va-dash-top-actions">
                        <button class="va-dash-top-btn" id="va-dash-switch-pro" title="Switch to InFlight Pro">
                            <i class="fa-solid fa-gem"></i><span>Pro</span>
                        </button>
                        <button class="va-dash-top-btn va-dash-close-btn" id="va-dash-close" title="Close">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                </div>
                <div class="va-dash-content" id="va-dash-content">
                    <div class="va-dash-loading"><div class="va-dash-spinner"></div><p>Loading…</p></div>
                </div>
                <div class="va-dash-dock" id="va-dash-dock">
                    <button class="va-dock-btn active" data-tab="home"><i class="fa-solid fa-house"></i><span>Home</span></button>
                    <button class="va-dock-btn" data-tab="apply"><i class="fa-solid fa-paper-plane"></i><span>Apply</span></button>
                    <button class="va-dock-btn" data-tab="events"><i class="fa-solid fa-calendar-days"></i><span>Events</span></button>
                    ${this._isStaff ? `<button class="va-dock-btn" data-tab="staff"><i class="fa-solid fa-shield-halved"></i><span>Staff</span></button>` : ''}
                    <button class="va-dock-btn" data-tab="settings"><i class="fa-solid fa-gear"></i><span>Settings</span></button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        this._attachShellListeners();
    },

    _show() {
        const overlay = document.getElementById('va-dashboard-overlay');
        if (!overlay) return;
        overlay.classList.add('va-dash-open');
        requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('va-dash-visible')));
    },

    _attachShellListeners() {
        const overlay = document.getElementById('va-dashboard-overlay');
        if (!overlay) return;
        overlay.querySelector('#va-dash-close').addEventListener('click', () => this.close());
        overlay.querySelector('#va-dash-switch-pro').addEventListener('click', () => {
            this.close();
            localStorage.setItem('inflight_auth_type', 'pro');
            if (window.AuthUI) { window.AuthUI._accountType = 'pro'; window.AuthUI.open(); }
        });
        overlay.addEventListener('click', (e) => { if (e.target === overlay) this.close(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this._isOpen) this.close(); });
        overlay.querySelectorAll('.va-dock-btn').forEach(btn => {
            btn.addEventListener('click', () => this._switchTab(btn.dataset.tab));
        });
    },

    _switchTab(tab) {
        this._activeTab = tab;
        document.querySelectorAll('.va-dock-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        const content = document.getElementById('va-dash-content');
        if (!content) return;
        switch (tab) {
            case 'home':     content.innerHTML = this._renderHome(); break;
            case 'apply':    content.innerHTML = this._renderApply(); break;
            case 'events':   content.innerHTML = this._renderEvents(); break;
            case 'staff':    content.innerHTML = this._renderStaff(); break;
            case 'settings': content.innerHTML = this._renderSettings(); break;
        }
        this._attachTabListeners(tab);
    },

    _renderHome() {
        const user = this._user;
        const va = this._myVA;
        const apps = this._myApps;
        const handle = user?.user_metadata?.if_username || user?.email?.split('@')[0] || 'Pilot';
        const h = new Date().getHours();
        const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';

        let vaBlock = '';
        if (va) {
            const live = this._events.filter(e => isLive(e));
            vaBlock = `
                <div class="va-dash-section">
                    <div class="va-section-title">Your Virtual Airline</div>
                    <div class="va-card">
                        <div class="va-card-head">
                            ${va.logo_url
                                ? `<img src="${va.logo_url}" alt="${va.name}" class="va-card-logo">`
                                : `<div class="va-card-logo-ph"><i class="fa-solid fa-plane"></i></div>`}
                            <div class="va-card-meta">
                                <div class="va-card-name">${va.name}</div>
                                <div class="va-card-sign">${va.callsign}${va.hub ? ` · ${va.hub}` : ''}</div>
                            </div>
                            ${va.trusted ? `<span class="va-trust-badge"><i class="fa-solid fa-circle-check"></i> Trusted</span>` : ''}
                        </div>
                        <div class="va-card-stats">
                            <div class="va-stat"><div class="va-stat-val">${this._events.length}</div><div class="va-stat-lbl">Events</div></div>
                            ${live.length > 0 ? `<div class="va-stat"><div class="va-stat-val" style="color:#4ade80">${live.length}</div><div class="va-stat-lbl">Live</div></div>` : ''}
                        </div>
                        <button class="va-btn va-btn-primary" id="va-home-events"><i class="fa-solid fa-calendar-days"></i> Manage Events</button>
                    </div>
                </div>`;
        } else if (apps.length > 0) {
            const latest = apps[0];
            const sc = { pending: { i: 'fa-clock', c: '#f59e0b', l: 'Under Review' }, approved: { i: 'fa-circle-check', c: '#4ade80', l: 'Approved' }, rejected: { i: 'fa-circle-xmark', c: '#f87171', l: 'Not Approved' } }[latest.status] || { i: 'fa-clock', c: '#f59e0b', l: 'Pending' };
            vaBlock = `
                <div class="va-dash-section">
                    <div class="va-section-title">Your Application</div>
                    <div class="va-card">
                        <div class="va-app-row">
                            <i class="fa-solid ${sc.i}" style="font-size:1.4rem;color:${sc.c}"></i>
                            <div><div class="va-card-name">${latest.va_name}</div><div style="font-size:0.82rem;font-weight:700;color:${sc.c}">${sc.l}</div></div>
                        </div>
                        ${latest.status === 'rejected' && latest.reject_reason ? `<div class="va-reject-note"><i class="fa-solid fa-info-circle"></i> ${latest.reject_reason}</div>` : ''}
                    </div>
                </div>`;
        } else {
            vaBlock = `
                <div class="va-dash-section">
                    <div class="va-cta-card">
                        <div class="va-cta-icon"><i class="fa-solid fa-paper-plane"></i></div>
                        <div class="va-cta-title">Partner Your VA</div>
                        <div class="va-cta-desc">Apply to join the InFlight VA Partnership Program and get your virtual airline listed.</div>
                        <button class="va-btn va-btn-primary" id="va-home-apply">Apply Now</button>
                    </div>
                </div>`;
        }

        return `<div class="va-dash-tab-content">
            <div class="va-dash-greeting">
                <div class="va-greet-main">${greeting}, <strong>${handle}</strong></div>
                <div class="va-greet-sub">${user?.email || ''}</div>
            </div>
            ${vaBlock}
        </div>`;
    },

    _renderApply() {
        const pending = this._myApps.find(a => a.status === 'pending');
        if (pending) return `<div class="va-dash-tab-content"><div class="va-dash-header"><div class="va-dash-header-title">VA Application</div></div><div class="va-card" style="text-align:center;padding:28px"><i class="fa-solid fa-clock" style="font-size:2rem;color:#f59e0b;margin-bottom:12px;display:block"></i><div style="font-weight:700;color:#fff;margin-bottom:8px">Application Under Review</div><div style="color:#a1a1aa;font-size:0.88rem">Your application for <strong>${pending.va_name}</strong> is being reviewed. We'll notify you of the outcome.</div></div></div>`;
        if (this._myVA) return `<div class="va-dash-tab-content"><div class="va-dash-header"><div class="va-dash-header-title">VA Application</div></div><div class="va-card" style="text-align:center;padding:28px"><i class="fa-solid fa-circle-check" style="font-size:2rem;color:#4ade80;margin-bottom:12px;display:block"></i><div style="font-weight:700;color:#fff;margin-bottom:8px">You're a VA Partner!</div><div style="color:#a1a1aa;font-size:0.88rem">${this._myVA.name} is an approved partner.</div></div></div>`;

        return `<div class="va-dash-tab-content">
            <div class="va-dash-header">
                <div class="va-dash-header-title">Apply for VA Partnership</div>
                <div class="va-dash-header-sub">Free to apply — no card required.</div>
            </div>
            <form id="va-apply-form" class="va-form">
                <div class="va-form-row">
                    <div class="va-field"><label>VA Name <span class="va-req">*</span></label><input type="text" name="va_name" placeholder="e.g. Delta Virtual" required></div>
                    <div class="va-field"><label>Callsign <span class="va-req">*</span></label><input type="text" name="callsign" placeholder="e.g. DAL" maxlength="5" required></div>
                </div>
                <div class="va-form-row">
                    <div class="va-field"><label>CEO IFC Handle <span class="va-req">*</span></label><input type="text" name="ceo_ifc_handle" placeholder="Your IFC username" required></div>
                    <div class="va-field"><label>Hub Airport <span class="va-req">*</span></label><input type="text" name="hub" placeholder="e.g. KATL" maxlength="4" required></div>
                </div>
                <div class="va-form-row">
                    <div class="va-field"><label>Fleet <span class="va-opt">(optional)</span></label><input type="text" name="fleet" placeholder="e.g. B738, A321"></div>
                    <div class="va-field"><label>Region <span class="va-opt">(optional)</span></label><input type="text" name="region" placeholder="e.g. North America"></div>
                </div>
                <div class="va-form-row">
                    <div class="va-field"><label>Website <span class="va-opt">(optional)</span></label><input type="url" name="website" placeholder="https://..."></div>
                    <div class="va-field"><label>Discord <span class="va-opt">(optional)</span></label><input type="url" name="discord" placeholder="Discord invite URL"></div>
                </div>
                <div class="va-field"><label>Logo URL <span class="va-opt">(optional)</span></label><input type="url" name="logo_url" placeholder="https://..."></div>
                <div class="va-field"><label>Pitch <span class="va-opt">(optional)</span></label><textarea name="pitch" rows="3" placeholder="Tell us about your VA…"></textarea></div>
                <div id="va-apply-msg" class="va-msg" style="display:none"></div>
                <button type="submit" class="va-btn va-btn-primary va-btn-full" id="va-apply-btn">Submit Application</button>
            </form>
        </div>`;
    },

    _renderEvents() {
        const va = this._myVA;
        if (!va) return `<div class="va-dash-tab-content"><div class="va-dash-header"><div class="va-dash-header-title">Upcoming Events</div></div><div id="va-public-events"><div class="va-dash-loading"><div class="va-dash-spinner"></div></div></div></div>`;

        return `<div class="va-dash-tab-content">
            <div class="va-dash-header">
                <div class="va-dash-header-title">Events — ${va.name}</div>
                <button class="va-btn va-btn-primary va-btn-sm" id="va-ev-new-btn"><i class="fa-solid fa-plus"></i> New</button>
            </div>
            <div id="va-ev-form-wrap" style="display:none" class="va-card" style="margin-bottom:14px">
                <form id="va-ev-form" class="va-form">
                    <div class="va-form-row">
                        <div class="va-field"><label>Name <span class="va-req">*</span></label><input type="text" name="name" required placeholder="Group flight to KORD"></div>
                        <div class="va-field"><label>Server <span class="va-req">*</span></label><select name="server" required><option value="">Choose…</option><option value="expert">Expert</option><option value="training">Training</option><option value="casual">Casual</option></select></div>
                    </div>
                    <div class="va-form-row">
                        <div class="va-field"><label>Start <span class="va-req">*</span></label><input type="datetime-local" name="start_at" required></div>
                        <div class="va-field"><label>End <span class="va-opt">(opt)</span></label><input type="datetime-local" name="end_at"></div>
                    </div>
                    <div class="va-form-row">
                        <div class="va-field"><label>Origin <span class="va-req">*</span></label><input type="text" name="origin_icao" maxlength="4" required placeholder="KLAX"></div>
                        <div class="va-field"><label>Destination <span class="va-req">*</span></label><input type="text" name="destination_icao" maxlength="4" required placeholder="KORD"></div>
                    </div>
                    <div class="va-form-row">
                        <div class="va-field"><label>Aircraft <span class="va-opt">(opt)</span></label><input type="text" name="aircraft" placeholder="B738"></div>
                        <div class="va-field"><label>Route <span class="va-opt">(opt)</span></label><input type="text" name="route" placeholder="DCT RIVET J146"></div>
                    </div>
                    <div class="va-field"><label>Briefing <span class="va-req">*</span></label><textarea name="briefing" rows="3" required placeholder="Event details and pilot instructions…"></textarea></div>
                    <div class="va-field"><label>Sign-Up URL <span class="va-opt">(opt)</span></label><input type="url" name="signup_url" placeholder="https://…"></div>
                    <div id="va-ev-msg" class="va-msg" style="display:none"></div>
                    <div style="display:flex;gap:8px"><button type="submit" class="va-btn va-btn-primary" id="va-ev-submit">Create Event</button><button type="button" class="va-btn va-btn-ghost" id="va-ev-cancel">Cancel</button></div>
                </form>
            </div>
            <div class="va-events-list">
                ${this._events.length === 0
                    ? `<div class="va-empty"><i class="fa-solid fa-calendar-xmark"></i><p>No events yet.</p></div>`
                    : this._events.map(e => this._eventTile(e)).join('')}
            </div>
        </div>`;
    },

    _eventTile(ev) {
        const live = isLive(ev);
        const sc = { pending: ['#f59e0b', 'Pending'], approved: ['#4ade80', 'Approved'], rejected: ['#f87171', 'Rejected'] }[ev.status] || ['#f59e0b', 'Pending'];
        return `<div class="va-ev-tile${live ? ' va-ev-live' : ''}">
            <div class="va-ev-head">
                <span class="va-ev-name">${ev.name}</span>
                <span class="va-ev-status" style="color:${sc[0]}">${live ? '🔴 LIVE' : sc[1]}</span>
            </div>
            <div class="va-ev-route">${ev.origin_icao || '?'} → ${ev.destination_icao || '?'}</div>
            <div class="va-ev-time">${formatEventTime(ev.start_at)}</div>
            ${ev.status === 'rejected' && ev.reject_reason ? `<div class="va-ev-reject">${ev.reject_reason}</div>` : ''}
        </div>`;
    },

    _renderSettings() {
        const u = this._user;
        const ifc = u?.user_metadata?.if_username;
        return `<div class="va-dash-tab-content">
            <div class="va-dash-header"><div class="va-dash-header-title">Account</div></div>
            <div class="va-card" style="margin-bottom:14px">
                <div class="va-setting-row"><span class="va-setting-lbl">Email</span><span class="va-setting-val">${u?.email || '—'}</span></div>
                ${ifc ? `<div class="va-setting-row"><span class="va-setting-lbl">IFC Handle</span><span class="va-setting-val">@${ifc}</span></div>` : ''}
                ${this._isStaff ? `<div class="va-setting-row"><span class="va-setting-lbl">Role</span><span class="va-setting-val" style="color:#60a5fa"><i class="fa-solid fa-shield-halved"></i> Staff</span></div>` : ''}
            </div>
            <div style="display:flex;flex-direction:column;gap:8px">
                <button class="va-btn va-btn-outline" id="va-set-switch-pro"><i class="fa-solid fa-gem"></i> Switch to InFlight Pro</button>
                <button class="va-btn va-btn-danger" id="va-set-signout"><i class="fa-solid fa-right-from-bracket"></i> Sign Out</button>
            </div>
        </div>`;
    },

    _renderStaff() {
        if (!this._isStaff) return `<div class="va-dash-tab-content"><div class="va-empty">Access denied.</div></div>`;
        return `<div class="va-dash-tab-content">
            <div class="va-dash-header"><div class="va-dash-header-title">Staff Console</div><div class="va-dash-header-sub">Review pending VA applications</div></div>
            <div id="va-staff-list"><div class="va-dash-loading"><div class="va-dash-spinner"></div></div></div>
        </div>`;
    },

    _attachTabListeners(tab) {
        const self = this;
        if (tab === 'home') {
            document.getElementById('va-home-apply')?.addEventListener('click', () => self._switchTab('apply'));
            document.getElementById('va-home-events')?.addEventListener('click', () => self._switchTab('events'));
        }

        if (tab === 'apply') {
            document.getElementById('va-apply-form')?.addEventListener('submit', async (e) => {
                e.preventDefault();
                const fd = Object.fromEntries(new FormData(e.currentTarget).entries());
                const btn = document.getElementById('va-apply-btn');
                const msg = document.getElementById('va-apply-msg');
                btn.disabled = true; btn.textContent = 'Submitting…';
                msg.style.display = 'none';
                try {
                    await submitApplication(fd);
                    self._myApps = await getMyApplications().catch(() => []);
                    self._switchTab('apply');
                } catch (err) {
                    msg.textContent = err.message; msg.className = 'va-msg va-msg-err'; msg.style.display = 'block';
                    btn.disabled = false; btn.textContent = 'Submit Application';
                }
            });
        }

        if (tab === 'events') {
            document.getElementById('va-ev-new-btn')?.addEventListener('click', () => {
                const w = document.getElementById('va-ev-form-wrap');
                if (w) w.style.display = w.style.display === 'none' ? 'block' : 'none';
            });
            document.getElementById('va-ev-cancel')?.addEventListener('click', () => {
                const w = document.getElementById('va-ev-form-wrap');
                if (w) w.style.display = 'none';
            });
            document.getElementById('va-ev-form')?.addEventListener('submit', async (e) => {
                e.preventDefault();
                const fd = Object.fromEntries(new FormData(e.currentTarget).entries());
                const btn = document.getElementById('va-ev-submit');
                const msg = document.getElementById('va-ev-msg');
                btn.disabled = true; btn.textContent = 'Creating…';
                msg.style.display = 'none';
                try {
                    await createEvent(self._myVA.id, {
                        ...fd,
                        start_at: fd.start_at ? new Date(fd.start_at).toISOString() : null,
                        end_at: fd.end_at ? new Date(fd.end_at).toISOString() : null
                    });
                    self._events = await listEventsForVa(self._myVA.id).catch(() => []);
                    self._switchTab('events');
                } catch (err) {
                    msg.textContent = err.message; msg.className = 'va-msg va-msg-err'; msg.style.display = 'block';
                    btn.disabled = false; btn.textContent = 'Create Event';
                }
            });
            if (!self._myVA) self._loadPublicEvents();
        }

        if (tab === 'staff') self._loadStaffApps();

        if (tab === 'settings') {
            document.getElementById('va-set-signout')?.addEventListener('click', async () => {
                await self._supabase.auth.signOut();
                localStorage.removeItem('inflight_auth_type');
                self.close();
                if (window.AuthUI) { window.AuthUI._accountType = null; }
            });
            document.getElementById('va-set-switch-pro')?.addEventListener('click', () => {
                self.close();
                localStorage.setItem('inflight_auth_type', 'pro');
                if (window.AuthUI) { window.AuthUI._accountType = 'pro'; window.AuthUI.open(); }
            });
        }
    },

    async _loadPublicEvents() {
        const evs = await listUpcomingApprovedEvents().catch(() => []);
        const el = document.getElementById('va-public-events');
        if (!el) return;
        if (!evs.length) { el.innerHTML = `<div class="va-empty"><i class="fa-solid fa-calendar-xmark"></i><p>No upcoming events.</p></div>`; return; }
        el.innerHTML = `<div class="va-events-list">${evs.map(e => `
            <div class="va-ev-tile${isLive(e) ? ' va-ev-live' : ''}">
                <div class="va-ev-head"><span class="va-ev-name">${e.name}</span><span class="va-ev-va" style="color:#60a5fa">${e.vas?.name || ''}</span></div>
                <div class="va-ev-route">${e.origin_icao || '?'} → ${e.destination_icao || '?'}</div>
                <div class="va-ev-time">${formatEventTime(e.start_at)}</div>
            </div>`).join('')}</div>`;
    },

    async _loadStaffApps() {
        const apps = await listPendingApplications().catch(() => []);
        const el = document.getElementById('va-staff-list');
        if (!el) return;
        if (!apps.length) { el.innerHTML = `<div class="va-empty"><i class="fa-solid fa-inbox"></i><p>No pending applications.</p></div>`; return; }

        el.innerHTML = apps.map(app => `
            <div class="va-card va-staff-card" data-app="${app.id}">
                <div class="va-staff-head">
                    <div><div class="va-card-name">${app.va_name}</div><div style="color:#a1a1aa;font-size:0.8rem">${app.callsign} · ${app.ceo_ifc_handle} · Hub: ${app.hub}</div></div>
                </div>
                ${app.pitch ? `<div class="va-app-pitch">${app.pitch}</div>` : ''}
                <div class="va-staff-btns">
                    <button class="va-btn va-btn-primary va-btn-sm va-approve-btn" data-id="${app.id}" data-slug="${slugify(app.va_name)}"><i class="fa-solid fa-check"></i> Approve</button>
                    <button class="va-btn va-btn-danger va-btn-sm va-reject-btn" data-id="${app.id}"><i class="fa-solid fa-xmark"></i> Reject</button>
                </div>
                <div class="va-reject-inline" id="rej-${app.id}" style="display:none">
                    <input type="text" class="va-rej-input" placeholder="Rejection reason…">
                    <button class="va-btn va-btn-danger va-btn-sm va-rej-confirm" data-id="${app.id}">Confirm</button>
                </div>
            </div>`).join('');

        el.querySelectorAll('.va-approve-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                try {
                    await approveApplication(btn.dataset.id, btn.dataset.slug);
                    btn.closest('.va-staff-card').remove();
                    if (!el.querySelector('.va-staff-card')) el.innerHTML = `<div class="va-empty"><i class="fa-solid fa-inbox"></i><p>No pending applications.</p></div>`;
                } catch (err) { btn.disabled = false; alert(err.message); }
            });
        });
        el.querySelectorAll('.va-reject-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const f = document.getElementById(`rej-${btn.dataset.id}`);
                if (f) f.style.display = f.style.display === 'none' ? 'flex' : 'none';
            });
        });
        el.querySelectorAll('.va-rej-confirm').forEach(btn => {
            btn.addEventListener('click', async () => {
                const reason = document.getElementById(`rej-${btn.dataset.id}`)?.querySelector('.va-rej-input')?.value || '';
                btn.disabled = true;
                try {
                    await rejectApplication(btn.dataset.id, reason);
                    btn.closest('.va-staff-card').remove();
                    if (!el.querySelector('.va-staff-card')) el.innerHTML = `<div class="va-empty"><i class="fa-solid fa-inbox"></i><p>No pending applications.</p></div>`;
                } catch (err) { btn.disabled = false; alert(err.message); }
            });
        });
    },

    _injectStyles() {
        if (document.getElementById('va-dashboard-styles')) return;
        const style = document.createElement('style');
        style.id = 'va-dashboard-styles';
        style.textContent = `
        .va-dash-overlay{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.72);backdrop-filter:blur(10px);display:none;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;font-family:'Inter',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
        .va-dash-overlay.va-dash-open{display:flex}
        .va-dash-card{background:#0e0e10;border:1px solid rgba(255,255,255,0.10);border-radius:20px;width:100%;max-width:680px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 40px 100px rgba(0,0,0,0.8);overflow:hidden;transform:translateY(20px) scale(0.97);opacity:0;transition:transform 300ms cubic-bezier(0.16,1,0.3,1),opacity 250ms ease}
        .va-dash-overlay.va-dash-visible .va-dash-card{transform:translateY(0) scale(1);opacity:1}
        .va-dash-top-strip{display:flex;align-items:center;justify-content:space-between;padding:13px 18px;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0}
        .va-dash-brand{display:flex;align-items:center;gap:9px}
        .va-dash-brand-dot{width:8px;height:8px;border-radius:50%;background:#3b82f6;box-shadow:0 0 8px rgba(59,130,246,0.7);animation:va-pulse 2s ease-in-out infinite}
        @keyframes va-pulse{0%,100%{opacity:1;box-shadow:0 0 8px rgba(59,130,246,0.7)}50%{opacity:0.7;box-shadow:0 0 14px rgba(59,130,246,0.4)}}
        .va-dash-brand-text{font-size:0.83rem;font-weight:700;color:#e4e4e7;letter-spacing:-0.01em}
        .va-dash-top-actions{display:flex;gap:5px}
        .va-dash-top-btn{display:flex;align-items:center;gap:6px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);color:#a1a1aa;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:0.8rem;font-weight:600;font-family:inherit;transition:all 140ms ease}
        .va-dash-top-btn:hover{color:#fff;background:rgba(255,255,255,0.10);border-color:rgba(255,255,255,0.16)}
        .va-dash-close-btn{padding:6px 8px}
        .va-dash-content{flex:1;overflow-y:auto;overflow-x:hidden;min-height:0;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.10) transparent}
        .va-dash-content::-webkit-scrollbar{width:4px}
        .va-dash-content::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.10);border-radius:2px}
        .va-dash-tab-content{padding:20px}
        .va-dash-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;gap:10px}
        .va-dash-header-title{font-size:1.05rem;font-weight:700;color:#fff;letter-spacing:-0.02em}
        .va-dash-header-sub{font-size:0.8rem;color:#71717a;margin-top:2px}
        .va-dash-greeting{margin-bottom:22px}
        .va-greet-main{font-size:1.15rem;font-weight:700;color:#fff;letter-spacing:-0.02em}
        .va-greet-main strong{color:#60a5fa}
        .va-greet-sub{font-size:0.8rem;color:#71717a;margin-top:3px}
        .va-dash-section{margin-bottom:20px}
        .va-section-title{font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.10em;color:#71717a;margin-bottom:9px}
        .va-card{background:#161619;border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:16px;margin-bottom:10px}
        .va-card-head{display:flex;align-items:center;gap:14px;margin-bottom:12px}
        .va-card-logo{width:42px;height:42px;border-radius:10px;object-fit:contain;background:#1e1e22}
        .va-card-logo-ph{width:42px;height:42px;border-radius:10px;background:rgba(59,130,246,0.15);display:flex;align-items:center;justify-content:center;color:#3b82f6;font-size:1.1rem}
        .va-card-meta{flex:1;min-width:0}
        .va-card-name{font-size:0.95rem;font-weight:700;color:#fff}
        .va-card-sign{font-size:0.75rem;color:#71717a;font-family:monospace;letter-spacing:0.05em;margin-top:2px}
        .va-trust-badge{margin-left:auto;font-size:0.7rem;font-weight:700;color:#4ade80;padding:4px 10px;border-radius:999px;background:rgba(74,222,128,0.10);border:1px solid rgba(74,222,128,0.22);display:flex;align-items:center;gap:5px;white-space:nowrap}
        .va-card-stats{display:flex;gap:18px;margin-bottom:14px}
        .va-stat{text-align:center}
        .va-stat-val{font-size:1.2rem;font-weight:800;color:#fff}
        .va-stat-lbl{font-size:0.7rem;color:#71717a;text-transform:uppercase;letter-spacing:0.06em;margin-top:2px}
        .va-app-row{display:flex;align-items:center;gap:14px}
        .va-reject-note{margin-top:10px;padding:10px 12px;background:rgba(248,113,113,0.08);border:1px solid rgba(248,113,113,0.20);border-radius:8px;font-size:0.8rem;color:#fca5a5;display:flex;gap:8px}
        .va-cta-card{background:linear-gradient(145deg,rgba(59,130,246,0.08),rgba(59,130,246,0.03));border:1px solid rgba(59,130,246,0.20);border-radius:16px;padding:24px;text-align:center}
        .va-cta-icon{font-size:2rem;color:#3b82f6;margin-bottom:12px}
        .va-cta-title{font-size:0.95rem;font-weight:700;color:#fff;margin-bottom:8px}
        .va-cta-desc{font-size:0.84rem;color:#a1a1aa;line-height:1.5;margin-bottom:16px}
        .va-btn{display:inline-flex;align-items:center;gap:7px;padding:10px 16px;border-radius:10px;font-size:0.88rem;font-weight:700;font-family:inherit;border:0;cursor:pointer;transition:all 140ms ease;white-space:nowrap}
        .va-btn-sm{padding:7px 12px;font-size:0.8rem;border-radius:8px}
        .va-btn-full{width:100%;justify-content:center}
        .va-btn-primary{background:#3b82f6;color:#fff}
        .va-btn-primary:hover:not(:disabled){background:#2563eb}
        .va-btn-primary:disabled{opacity:0.5;cursor:not-allowed}
        .va-btn-outline{background:transparent;color:#a1a1aa;border:1px solid rgba(255,255,255,0.12)}
        .va-btn-outline:hover{color:#fff;border-color:rgba(255,255,255,0.25)}
        .va-btn-ghost{background:rgba(255,255,255,0.05);color:#a1a1aa;border:1px solid rgba(255,255,255,0.08)}
        .va-btn-ghost:hover{background:rgba(255,255,255,0.10);color:#fff}
        .va-btn-danger{background:rgba(248,113,113,0.12);color:#f87171;border:1px solid rgba(248,113,113,0.22)}
        .va-btn-danger:hover{background:rgba(248,113,113,0.20)}
        .va-form{display:flex;flex-direction:column;gap:13px}
        .va-form-row{display:flex;gap:12px}
        .va-form-row .va-field{flex:1}
        .va-field{display:flex;flex-direction:column;gap:5px}
        .va-field label{font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#a1a1aa}
        .va-req{color:#f87171}
        .va-opt{color:#52525b;text-transform:none;font-weight:400;letter-spacing:0}
        .va-field input,.va-field select,.va-field textarea{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);color:#fff;border-radius:10px;padding:9px 13px;font-size:0.88rem;font-family:inherit;outline:none;resize:vertical;transition:border-color 140ms,background 140ms;width:100%;box-sizing:border-box}
        .va-field input::placeholder,.va-field textarea::placeholder{color:#52525b}
        .va-field input:focus,.va-field select:focus,.va-field textarea:focus{border-color:rgba(96,165,250,0.6);background:rgba(255,255,255,0.07);box-shadow:0 0 0 3px rgba(96,165,250,0.14)}
        .va-field select option{background:#1e1e22}
        .va-msg{padding:10px 13px;border-radius:8px;font-size:0.83rem;font-weight:500}
        .va-msg-err{background:rgba(248,113,113,0.10);border:1px solid rgba(248,113,113,0.25);color:#f87171}
        .va-msg-ok{background:rgba(74,222,128,0.10);border:1px solid rgba(74,222,128,0.25);color:#4ade80}
        .va-events-list{display:flex;flex-direction:column;gap:9px}
        .va-ev-tile{background:#161619;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:13px 15px;transition:border-color 150ms}
        .va-ev-tile:hover{border-color:rgba(255,255,255,0.14)}
        .va-ev-live{border-color:rgba(74,222,128,0.25)!important;background:rgba(74,222,128,0.04)}
        .va-ev-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:5px}
        .va-ev-name{font-size:0.88rem;font-weight:700;color:#fff}
        .va-ev-va{font-size:0.74rem;font-weight:600}
        .va-ev-status{font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;flex-shrink:0}
        .va-ev-route{font-size:0.8rem;color:#a1a1aa;font-family:monospace;margin-bottom:3px}
        .va-ev-time{font-size:0.76rem;color:#71717a}
        .va-ev-reject{margin-top:8px;padding:5px 9px;background:rgba(248,113,113,0.08);border-radius:6px;font-size:0.76rem;color:#f87171}
        .va-setting-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06)}
        .va-setting-row:last-child{border-bottom:0}
        .va-setting-lbl{font-size:0.8rem;color:#71717a}
        .va-setting-val{font-size:0.86rem;color:#e4e4e7;font-weight:500}
        .va-staff-card{margin-bottom:10px}
        .va-staff-head{margin-bottom:10px}
        .va-app-pitch{font-size:0.8rem;color:#a1a1aa;line-height:1.5;margin-bottom:10px;padding:9px;background:rgba(255,255,255,0.03);border-radius:8px}
        .va-staff-btns{display:flex;gap:8px}
        .va-reject-inline{margin-top:10px;display:flex;gap:8px;align-items:center}
        .va-rej-input{flex:1;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);color:#fff;border-radius:8px;padding:7px 12px;font-size:0.84rem;font-family:inherit;outline:none}
        .va-empty{text-align:center;padding:32px 20px;color:#71717a}
        .va-empty i{font-size:2rem;margin-bottom:12px;display:block}
        .va-empty p{margin:0;font-size:0.88rem}
        .va-dash-loading{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px;color:#71717a}
        .va-dash-loading p{margin:12px 0 0;font-size:0.86rem}
        .va-dash-spinner{width:26px;height:26px;border:2px solid rgba(255,255,255,0.08);border-top-color:#3b82f6;border-radius:50%;animation:va-spin 0.7s linear infinite}
        @keyframes va-spin{to{transform:rotate(360deg)}}
        .va-dash-dock{display:flex;border-top:1px solid rgba(255,255,255,0.06);padding:7px 10px;gap:2px;flex-shrink:0}
        .va-dock-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;background:transparent;border:0;color:#52525b;padding:7px 4px;border-radius:10px;cursor:pointer;font-family:inherit;transition:color 140ms,background 140ms}
        .va-dock-btn i{font-size:0.95rem}
        .va-dock-btn span{font-size:0.62rem;font-weight:600;letter-spacing:0.02em}
        .va-dock-btn:hover{color:#a1a1aa;background:rgba(255,255,255,0.04)}
        .va-dock-btn.active{color:#60a5fa;background:rgba(96,165,250,0.10)}
        @media(max-width:600px){.va-dash-card{border-radius:16px 16px 0 0;max-height:95vh}.va-dash-overlay{align-items:flex-end;padding:0}.va-form-row{flex-direction:column}}
        `;
        document.head.appendChild(style);
    }
};
