// VAPortalUI — in-tracker pop-out for the Virtual Airline partnership.
//
// Replaces the old "redirect to va-dashboard.html" flow. Pops out over the
// tracker like ProfileUI (same visual language: warm light shell, caramel
// accent, floating bottom dock) and ports the full VA experience:
//   • CEO Dashboard  — Profile, Roster, Events   (parity with va-dashboard.html)
//   • Staff Console  — Review apps/events, Staff  (parity with va-admin.html)
//
// Tabs are role-aware: VA owners get the dashboard tabs, staff get the console
// tabs, and an account that is both gets all of them. The module is fully
// self-contained (its own toast / confirm / prompt dialogs) so it does not
// depend on va-ui.css, which the tracker doesn't load.
//
// Entry point: VAPortalUI.launch() — opens the portal if signed in, otherwise
// pops out the existing VA sign-in modal (vaAuth.js) and opens on success.

import {
    supabase, getSession, signOut, isStaff,
    getVaByCeo, updateVa,
    listPilots, addPilot, removePilot,
    listEventsForVa, createEvent, deleteEvent,
    listPendingApplications, approveApplication, rejectApplication, slugify,
    listPendingEvents, approveEvent, rejectEvent,
    formatEventTime
} from './vaService.js';

const REJECT_REASONS_APP = [
    'Insufficient information — please add more detail and reapply.',
    'Duplicate of an existing VA in our directory.',
    'Inactive VA — no recent activity verifiable on IFC.',
    "Doesn't meet quality bar — see partnership guidelines."
];
const REJECT_REASONS_EVENT = [
    'Briefing is too thin — please add gate, pushback, expected ATC, etc.',
    'Conflicts with another major event already on the board at this time.',
    'Server choice is inappropriate for this aircraft / route.',
    'Route or origin/destination ICAO is invalid.'
];

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

export const VAPortalUI = {
    _injected: false,
    _isOpen: false,
    _busy: false,
    _theme: 'light',
    _session: null,
    _va: null,
    _isStaff: false,
    _pilots: [],
    _events: [],
    _apps: [],
    _pendingEvents: [],
    _staff: [],
    _activeTab: null,
    _showEventForm: false,

    // ─── Entry point ──────────────────────────────────────────────────────
    async launch() {
        let session = null;
        try { session = await getSession(); } catch (_) {}
        if (session) {
            this.open();
            return;
        }
        // Not signed in — pop out the existing VA sign-in modal, then open
        // the portal on success (the two stacked pop-outs).
        try {
            const mod = await import('./vaAuth.js');
            await mod.openAuthModal('signin', { onAuthed: () => this.open() });
        } catch (err) {
            console.error('[VAPortalUI] Failed to load VA sign-in modal:', err);
        }
    },

    // ─── Lifecycle ────────────────────────────────────────────────────────
    async open() {
        this._theme = localStorage.getItem('vap-theme') || 'light';
        if (!this._injected) {
            this._inject();
            this._injected = true;
        }
        const overlay = document.getElementById('va-portal-overlay');
        overlay.setAttribute('data-theme', this._theme);

        requestAnimationFrame(() => requestAnimationFrame(() => {
            overlay.classList.add('vap-open');
            this._isOpen = true;
            document.body.style.overflow = 'hidden';
        }));

        this._renderShell(this._loadingHTML());
        await this._boot();
    },

    close() {
        document.getElementById('va-portal-overlay')?.classList.remove('vap-open');
        this._isOpen = false;
        document.body.style.overflow = '';
    },

    async _boot() {
        try {
            this._session = await getSession();
            if (!this._session) {
                this._renderShell(this._gateHTML());
                return;
            }
            const [va, staff] = await Promise.all([
                getVaByCeo().catch(() => null),
                isStaff().catch(() => false)
            ]);
            this._va = va;
            this._isStaff = !!staff;

            const tabs = this._availableTabs();
            if (tabs.length === 0) {
                this._renderShell(this._noVaHTML());
                return;
            }

            // Load all data relevant to this user's roles in parallel so the
            // dock badges are accurate on first paint.
            const jobs = [];
            if (va) {
                jobs.push(listPilots(va.id).then(p => { this._pilots = p; }).catch(() => {}));
                jobs.push(listEventsForVa(va.id).then(e => { this._events = e; }).catch(() => {}));
            }
            if (this._isStaff) {
                jobs.push(listPendingApplications().then(a => { this._apps = a; }).catch(() => {}));
                jobs.push(listPendingEvents().then(e => { this._pendingEvents = e; }).catch(() => {}));
                jobs.push(this._loadStaff());
            }
            await Promise.all(jobs);

            if (!this._activeTab || !tabs.includes(this._activeTab)) {
                this._activeTab = tabs[0];
            }
            this._renderDashboard();
        } catch (err) {
            this._renderShell(this._errorHTML(err?.message));
        }
    },

    async _loadStaff() {
        const { data, error } = await supabase
            .from('va_staff')
            .select('user_id, granted_at')
            .order('granted_at', { ascending: true });
        this._staff = error ? [] : (data || []);
    },

    _availableTabs() {
        const t = [];
        if (this._va) t.push('profile', 'roster', 'events');
        if (this._isStaff) t.push('review-apps', 'review-events', 'staff');
        return t;
    },

    // ─── Shell rendering ──────────────────────────────────────────────────
    _inject() {
        const el = document.createElement('div');
        el.id = 'va-portal-overlay';
        el.className = 'vap-wrapper-layer';
        el.setAttribute('data-theme', this._theme);
        el.innerHTML = `<div class="vap-shell" id="vap-shell"></div>`;
        document.body.appendChild(el);

        el.addEventListener('click', (e) => { if (e.target === el) this.close(); });
        document.addEventListener('keydown', (e) => {
            if (this._isOpen && e.key === 'Escape' && !document.getElementById('vap-dialog-host')) {
                this.close();
            }
        });

        el.addEventListener('click', (e) => this._onClick(e));
        el.addEventListener('submit', (e) => this._onSubmit(e));

        this._injectStyles();
    },

    _renderShell(contentHTML, withChrome = false) {
        const shell = document.getElementById('vap-shell');
        if (!shell) return;
        shell.innerHTML = `
            ${this._topStripHTML()}
            <main class="vap-content" id="vap-content">${contentHTML}</main>
            ${withChrome ? this._dockHTML() : ''}
        `;
    },

    _renderDashboard() {
        this._renderShell(this._tabContentHTML(), true);
    },

    _renderContentOnly() {
        // Rebuild content + dock (so count badges stay accurate) while keeping
        // the shell mounted. Listeners are delegated on the overlay root, so
        // swapping innerHTML is safe.
        const content = document.getElementById('vap-content');
        if (content) content.innerHTML = this._tabContentHTML();
        const dock = document.querySelector('.vap-dock');
        if (dock) dock.outerHTML = this._dockHTML();
    },

    _topStripHTML() {
        const email = this._session?.user?.email || '';
        const initial = (email[0] || 'V').toUpperCase();
        const themeIcon = this._theme === 'dark' ? 'fa-moon' : 'fa-sun';
        return `
            <header class="vap-topstrip">
                <div class="vap-brand">
                    <span class="vap-brand-name">InFlight</span>
                    <span class="vap-brand-tag">Partnership</span>
                </div>
                <div class="vap-topstrip-right">
                    <button class="vap-icon-btn" id="vap-theme-btn" title="Toggle theme"><i class="fa-solid ${themeIcon}"></i></button>
                    ${email ? `
                        <div class="vap-user-chip">
                            <span class="vap-user-initials">${esc(initial)}</span>
                            <span class="vap-user-email">${esc(email)}</span>
                        </div>
                        <button class="vap-icon-btn" id="vap-signout-btn" title="Sign out"><i class="fa-solid fa-arrow-right-from-bracket"></i></button>
                    ` : ''}
                    <button class="vap-icon-btn vap-icon-btn-close" id="vap-close-btn" title="Close"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </header>
        `;
    },

    _dockHTML() {
        const dashTabs = [
            { id: 'profile', icon: 'fa-building', label: 'Profile' },
            { id: 'roster', icon: 'fa-user-group', label: 'Roster', count: this._pilots.length },
            { id: 'events', icon: 'fa-calendar-days', label: 'Events', count: this._events.length }
        ].filter(() => !!this._va);
        const adminTabs = [
            { id: 'review-apps', icon: 'fa-inbox', label: 'Applications', count: this._apps.length },
            { id: 'review-events', icon: 'fa-clipboard-check', label: 'Review', count: this._pendingEvents.length },
            { id: 'staff', icon: 'fa-user-shield', label: 'Staff' }
        ].filter(() => this._isStaff);

        const item = (t) => `
            <button class="vap-dock-item ${this._activeTab === t.id ? 'active' : ''}" data-tab="${t.id}" title="${t.label}">
                <span class="vap-dock-icon"><i class="fa-solid ${t.icon}"></i></span>
                <span class="vap-dock-label">${t.label}</span>
                ${typeof t.count === 'number' && t.count > 0 ? `<span class="vap-dock-badge">${t.count}</span>` : ''}
            </button>`;

        const sep = (dashTabs.length && adminTabs.length) ? `<span class="vap-dock-sep"></span>` : '';
        return `
            <nav class="vap-dock" aria-label="VA navigation">
                <div class="vap-dock-inner">
                    ${dashTabs.map(item).join('')}
                    ${sep}
                    ${adminTabs.map(item).join('')}
                </div>
            </nav>`;
    },

    _tabContentHTML() {
        switch (this._activeTab) {
            case 'profile':       return this._profileHTML();
            case 'roster':        return this._rosterHTML();
            case 'events':        return this._eventsHTML();
            case 'review-apps':   return this._reviewAppsHTML();
            case 'review-events': return this._reviewEventsHTML();
            case 'staff':         return this._staffHTML();
            default:              return '';
        }
    },

    // ─── State screens ────────────────────────────────────────────────────
    _loadingHTML() {
        return `<div class="vap-gate"><i class="fa-solid fa-circle-notch fa-spin vap-gate-spin"></i><div class="vap-gate-sub">Loading your VA portal…</div></div>`;
    },
    _gateHTML() {
        return `
            <div class="vap-gate">
                <div class="vap-gate-icon"><i class="fa-solid fa-id-badge"></i></div>
                <h2 class="vap-gate-title">VA Partner Portal</h2>
                <p class="vap-gate-sub">Sign in to your InFlight account to manage your virtual airline and partnership tools.</p>
                <button class="vap-btn vap-btn-primary" id="vap-gate-signin"><i class="fa-solid fa-right-to-bracket"></i> Sign in</button>
            </div>`;
    },
    _noVaHTML() {
        return `
            <div class="vap-gate">
                <div class="vap-gate-icon"><i class="fa-solid fa-plane-departure"></i></div>
                <h2 class="vap-gate-title">No virtual airline yet</h2>
                <p class="vap-gate-sub">You're signed in, but this account doesn't own an approved VA and isn't staff. Apply to start your partnership.</p>
                <a class="vap-btn vap-btn-primary" href="va-apply.html"><i class="fa-solid fa-paper-plane"></i> Apply for partnership</a>
            </div>`;
    },
    _errorHTML(msg) {
        return `
            <div class="vap-gate">
                <div class="vap-gate-icon vap-gate-icon-err"><i class="fa-solid fa-triangle-exclamation"></i></div>
                <h2 class="vap-gate-title">Couldn't load the portal</h2>
                <p class="vap-gate-sub">${esc(msg || 'Something went wrong. Check your connection and try again.')}</p>
                <button class="vap-btn vap-btn-secondary" id="vap-retry"><i class="fa-solid fa-rotate-right"></i> Retry</button>
            </div>`;
    },

    // ─── Profile tab ──────────────────────────────────────────────────────
    _profileHTML() {
        const va = this._va || {};
        const regions = ['North America', 'South America', 'Europe', 'Africa', 'Middle East', 'Asia', 'Oceania', 'Worldwide'];
        const approved = this._events.filter(e => e.status === 'approved').length;
        const pending = this._events.filter(e => e.status === 'pending').length;
        const trustPct = va.trusted ? 100 : Math.min(100, (approved / 5) * 100);
        const slug = va.slug ? `va.html?slug=${encodeURIComponent(va.slug)}` : null;
        return `
            <div class="vap-page">
                <div class="vap-hero">
                    <div class="vap-hero-logo">${va.logo_url
                        ? `<img src="${esc(va.logo_url)}" alt="" onerror="this.style.display='none';this.parentNode.innerHTML='<i class=\\'fa-solid fa-plane\\'></i>'">`
                        : `<i class="fa-solid fa-plane"></i>`}</div>
                    <div class="vap-hero-body">
                        <div class="vap-hero-titlerow">
                            <h1>${esc(va.name || 'Your VA')}</h1>
                            ${va.callsign ? `<span class="vap-badge vap-badge-mono">${esc(va.callsign)}</span>` : ''}
                            ${va.trusted ? `<span class="vap-badge vap-badge-pos"><i class="fa-solid fa-shield-check"></i> Trusted</span>` : ''}
                        </div>
                        <div class="vap-hero-meta">
                            ${va.hub ? `<span><i class="fa-solid fa-tower-control"></i> ${esc(va.hub)}</span>` : ''}
                            ${va.region ? `<span><i class="fa-solid fa-earth-americas"></i> ${esc(va.region)}</span>` : ''}
                            ${slug ? `<a href="${esc(slug)}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> Public page</a>` : ''}
                        </div>
                    </div>
                </div>

                <div class="vap-stats">
                    ${this._statCard('fa-user-group', this._pilots.length, 'Pilots')}
                    ${this._statCard('fa-circle-check', approved, 'Approved events')}
                    ${this._statCard('fa-clock', pending, 'Pending review')}
                    <div class="vap-stat-card vap-stat-trust">
                        <div class="vap-stat-trust-head">
                            <span>${va.trusted ? 'Trusted' : `${approved}/5 to Trusted`}</span>
                            <span class="vap-muted">${va.trusted ? 'Events publish instantly' : 'Approved events unlock Trusted'}</span>
                        </div>
                        <div class="vap-progress"><div class="vap-progress-bar" style="width:${trustPct}%"></div></div>
                    </div>
                </div>

                <form id="vap-profile-form" class="vap-card">
                    <div class="vap-card-header"><h2>VA profile</h2><span class="vap-form-msg" id="vap-profile-msg"></span></div>
                    <div class="vap-card-body vap-form-grid">
                        ${this._field('name', 'Name', va.name, { required: true })}
                        ${this._field('callsign', 'Callsign', va.callsign, { required: true, maxlength: 8, mono: true })}
                        ${this._field('hub', 'Hub (ICAO)', va.hub, { maxlength: 4, mono: true })}
                        ${this._select('region', 'Region', va.region, regions)}
                        ${this._field('fleet', 'Fleet', va.fleet, { placeholder: 'A320, B738…' })}
                        ${this._field('website', 'Website', va.website, { type: 'url' })}
                        ${this._field('discord', 'Discord invite', va.discord)}
                        ${this._field('logo_url', 'Logo URL', va.logo_url, { type: 'url', hint: 'Direct image URL. Square images look best.' })}
                        ${this._textarea('description', 'Description', va.description, { full: true, maxlength: 1200 })}
                    </div>
                    <div class="vap-card-footer">
                        <button type="submit" class="vap-btn vap-btn-primary"><i class="fa-solid fa-floppy-disk"></i> Save changes</button>
                    </div>
                </form>
            </div>`;
    },

    // ─── Roster tab ───────────────────────────────────────────────────────
    _rosterHTML() {
        const rows = this._pilots.length ? this._pilots.map(p => `
            <div class="vap-row" data-id="${p.id}">
                <div class="vap-avatar"><i class="fa-solid fa-user"></i></div>
                <div class="vap-row-body">
                    <div class="vap-row-title">@${esc(p.ifc_handle)}</div>
                    <div class="vap-row-sub ${p.rank ? '' : 'vap-muted'}">${p.rank ? esc(p.rank) : 'No rank set'}</div>
                </div>
                <button class="vap-btn vap-btn-danger vap-btn-sm" data-pilot-del="${p.id}" aria-label="Remove pilot"><i class="fa-solid fa-trash"></i></button>
            </div>`).join('') : this._empty('fa-user-group', 'No pilots yet', 'Add your first pilot below.');
        return `
            <div class="vap-page">
                <form id="vap-pilot-form" class="vap-card">
                    <div class="vap-card-header"><h2>Add pilot</h2></div>
                    <div class="vap-card-body vap-form-inline">
                        ${this._field('ifc_handle', 'IFC handle', '', { required: true, placeholder: 'CaptainSmith' })}
                        ${this._field('rank', 'Rank', '', { placeholder: 'Senior FO' })}
                        <button type="submit" class="vap-btn vap-btn-primary vap-inline-submit"><i class="fa-solid fa-plus"></i> Add</button>
                    </div>
                </form>
                <div class="vap-section-title">Roster <span class="vap-count">${this._pilots.length}</span></div>
                <div class="vap-list">${rows}</div>
            </div>`;
    },

    // ─── Events tab ───────────────────────────────────────────────────────
    _eventsHTML() {
        const badge = (status) => {
            const icon = status === 'pending' ? 'fa-clock' : status === 'approved' ? 'fa-check' : 'fa-xmark';
            const cls = status === 'approved' ? 'vap-badge-pos' : status === 'rejected' ? 'vap-badge-neg' : 'vap-badge-warn';
            return `<span class="vap-badge ${cls}"><i class="fa-solid ${icon}"></i> ${status}</span>`;
        };
        const rows = this._events.length ? this._events.map(ev => `
            <div class="vap-row vap-row-block" data-id="${ev.id}">
                <div class="vap-row-main">
                    <div class="vap-row-title-line">
                        <span class="vap-row-title">${esc(ev.name)}</span>
                        ${badge(ev.status)}
                        <span class="vap-badge vap-badge-soft">${esc(ev.server)}</span>
                    </div>
                    <div class="vap-row-sub">
                        <span class="vap-mono">${esc(ev.origin_icao || '')}</span> → <span class="vap-mono">${esc(ev.destination_icao || '')}</span>
                        &nbsp;·&nbsp; ${esc(formatEventTime(ev.start_at))}
                    </div>
                    ${ev.status === 'rejected' && ev.reject_reason ? `<div class="vap-reject"><b>Rejected:</b> ${esc(ev.reject_reason)}</div>` : ''}
                </div>
                <button class="vap-btn vap-btn-danger vap-btn-sm" data-event-del="${ev.id}" aria-label="Delete event"><i class="fa-solid fa-trash"></i></button>
            </div>`).join('') : this._empty('fa-calendar-days', 'No events yet', 'Create your first event to get on the board.');

        const servers = ['expert', 'training', 'casual'];
        const form = this._showEventForm ? `
            <form id="vap-event-form" class="vap-card vap-event-form">
                <div class="vap-card-header"><h2>New event</h2><span class="vap-form-msg" id="vap-event-msg"></span></div>
                <div class="vap-card-body vap-form-grid">
                    ${this._field('name', 'Event name', '', { required: true, maxlength: 120 })}
                    ${this._select('server', 'Server', 'expert', servers, true)}
                    ${this._field('start_at', 'Start', '', { type: 'datetime-local', required: true })}
                    ${this._field('end_at', 'End (optional)', '', { type: 'datetime-local' })}
                    ${this._field('origin_icao', 'Origin ICAO', '', { required: true, maxlength: 4, mono: true })}
                    ${this._field('destination_icao', 'Destination ICAO', '', { required: true, maxlength: 4, mono: true })}
                    ${this._field('aircraft', 'Aircraft', '', { placeholder: 'A321' })}
                    ${this._field('livery', 'Livery suggestion', '')}
                    ${this._field('route', 'Route', '', { mono: true, full: true })}
                    ${this._textarea('briefing', 'Briefing', '', { full: true, required: true, maxlength: 2000, hint: 'Gates, pushback, expected ATC, etc.' })}
                    ${this._field('signup_url', 'Sign-up URL', '', { type: 'url', full: true })}
                </div>
                <div class="vap-card-footer">
                    <button type="button" class="vap-btn vap-btn-ghost" id="vap-event-cancel">Cancel</button>
                    <button type="submit" class="vap-btn vap-btn-primary"><i class="fa-solid fa-paper-plane"></i> Submit event</button>
                </div>
            </form>` : '';

        return `
            <div class="vap-page">
                <div class="vap-toolbar">
                    <div class="vap-section-title" style="margin:0;">Events <span class="vap-count">${this._events.length}</span></div>
                    <button class="vap-btn vap-btn-primary vap-btn-sm" id="vap-new-event-btn">
                        <i class="fa-solid ${this._showEventForm ? 'fa-xmark' : 'fa-plus'}"></i> ${this._showEventForm ? 'Close' : 'New event'}
                    </button>
                </div>
                ${form}
                <div class="vap-list">${rows}</div>
            </div>`;
    },

    // ─── Staff: review applications ───────────────────────────────────────
    _reviewAppsHTML() {
        const rows = this._apps.length ? this._apps.map(a => {
            const proposed = slugify(a.va_name);
            return `
            <div class="vap-card vap-review" data-id="${a.id}">
                <div class="vap-review-head">
                    <div class="vap-review-logo">${a.logo_url ? `<img src="${esc(a.logo_url)}" alt="">` : `<i class="fa-solid fa-plane"></i>`}</div>
                    <div class="vap-review-body">
                        <div class="vap-row-title-line"><span class="vap-row-title">${esc(a.va_name)}</span>
                            <span class="vap-badge vap-badge-soft">${esc(a.callsign)}</span>
                            <span class="vap-badge vap-badge-warn"><i class="fa-solid fa-clock"></i> pending</span></div>
                        <div class="vap-row-sub">CEO @${esc(a.ceo_ifc_handle)} · Hub <span class="vap-mono">${esc(a.hub)}</span>${a.region ? ` · ${esc(a.region)}` : ''}</div>
                        <div class="vap-stamp">Submitted ${new Date(a.created_at).toLocaleString()}</div>
                    </div>
                </div>
                <details class="vap-details"><summary>View full submission</summary>
                    <div class="vap-details-body">
                        ${a.fleet ? `<div><b>Fleet:</b> ${esc(a.fleet)}</div>` : ''}
                        ${a.website ? `<div><b>Website:</b> <a href="${esc(a.website)}" target="_blank" rel="noopener">${esc(a.website)}</a></div>` : ''}
                        ${a.discord ? `<div><b>Discord:</b> <a href="${esc(a.discord)}" target="_blank" rel="noopener">${esc(a.discord)}</a></div>` : ''}
                        <div class="vap-details-pitch">${a.pitch ? esc(a.pitch) : 'No pitch provided.'}</div>
                    </div>
                </details>
                <div class="vap-review-actions">
                    <div class="vap-slug-wrap"><label>Slug</label><input class="vap-input vap-mono vap-slug-input" value="${esc(proposed)}" data-id="${a.id}"></div>
                    <button class="vap-btn vap-btn-success" data-action="approve" data-id="${a.id}"><i class="fa-solid fa-check"></i> Approve</button>
                    <button class="vap-btn vap-btn-danger" data-action="reject" data-id="${a.id}"><i class="fa-solid fa-xmark"></i> Reject</button>
                </div>
            </div>`;
        }).join('') : this._empty('fa-check-double', 'All clear', 'No pending VA applications.');
        return `<div class="vap-page"><div class="vap-section-title">Applications <span class="vap-count">${this._apps.length}</span></div>${rows}</div>`;
    },

    // ─── Staff: review events ─────────────────────────────────────────────
    _reviewEventsHTML() {
        const rows = this._pendingEvents.length ? this._pendingEvents.map(ev => `
            <div class="vap-card vap-review" data-id="${ev.id}">
                <div class="vap-review-head">
                    <div class="vap-review-logo">${ev.vas?.logo_url ? `<img src="${esc(ev.vas.logo_url)}" alt="">` : `<i class="fa-solid fa-calendar"></i>`}</div>
                    <div class="vap-review-body">
                        <div class="vap-row-title-line"><span class="vap-row-title">${esc(ev.name)}</span>
                            <span class="vap-badge vap-badge-soft">${esc(ev.server)}</span>
                            <span class="vap-badge vap-badge-warn"><i class="fa-solid fa-clock"></i> pending</span></div>
                        <div class="vap-row-sub">${esc(ev.vas?.name || '—')} · <span class="vap-mono">${esc(ev.origin_icao || '')}</span> → <span class="vap-mono">${esc(ev.destination_icao || '')}</span></div>
                        <div class="vap-stamp">Starts ${new Date(ev.start_at).toLocaleString()}</div>
                    </div>
                </div>
                <details class="vap-details"><summary>View briefing</summary>
                    <div class="vap-details-body">
                        ${ev.aircraft ? `<div><b>Aircraft:</b> ${esc(ev.aircraft)}${ev.livery ? ` · ${esc(ev.livery)}` : ''}</div>` : ''}
                        ${ev.route ? `<div><b>Route:</b> <span class="vap-mono">${esc(ev.route)}</span></div>` : ''}
                        ${ev.signup_url ? `<div><b>Sign-up:</b> <a href="${esc(ev.signup_url)}" target="_blank" rel="noopener">${esc(ev.signup_url)}</a></div>` : ''}
                        <div class="vap-details-pitch">${ev.briefing ? esc(ev.briefing) : 'No briefing provided.'}</div>
                    </div>
                </details>
                <div class="vap-review-actions">
                    <button class="vap-btn vap-btn-success" data-action="approve-event" data-id="${ev.id}"><i class="fa-solid fa-check"></i> Approve</button>
                    <button class="vap-btn vap-btn-danger" data-action="reject-event" data-id="${ev.id}"><i class="fa-solid fa-xmark"></i> Reject</button>
                </div>
            </div>`).join('') : this._empty('fa-check-double', 'No pending events', 'Trusted VAs publish instantly.');
        return `<div class="vap-page"><div class="vap-section-title">Pending events <span class="vap-count">${this._pendingEvents.length}</span></div>${rows}</div>`;
    },

    // ─── Staff: manage staff ──────────────────────────────────────────────
    _staffHTML() {
        const me = this._session?.user?.id || '';
        const rows = this._staff.length ? this._staff.map(s => {
            const isMe = s.user_id === me;
            return `
            <div class="vap-row" data-id="${esc(s.user_id)}">
                <div class="vap-avatar"><i class="fa-solid fa-user-shield"></i></div>
                <div class="vap-row-body">
                    <div class="vap-row-title vap-mono" style="font-size:.82rem;">${esc(s.user_id)}${isMe ? ` <span class="vap-badge vap-badge-soft">you</span>` : ''}</div>
                    <div class="vap-row-sub">Granted ${new Date(s.granted_at).toLocaleDateString()}</div>
                </div>
                ${isMe ? '' : `<button class="vap-btn vap-btn-danger vap-btn-sm" data-action="remove-staff" data-id="${esc(s.user_id)}"><i class="fa-solid fa-user-minus"></i> Revoke</button>`}
            </div>`;
        }).join('') : this._empty('fa-user-shield', 'No staff yet', 'Grant access by user ID below.');
        return `
            <div class="vap-page">
                <form id="vap-staff-form" class="vap-card">
                    <div class="vap-card-header"><h2>Grant staff access</h2><span class="vap-form-msg" id="vap-staff-msg"></span></div>
                    <div class="vap-card-body vap-form-inline">
                        ${this._field('user_id', 'User ID (UUID)', '', { required: true, mono: true, placeholder: '00000000-0000-0000-0000-000000000000' })}
                        <button type="submit" class="vap-btn vap-btn-primary vap-inline-submit"><i class="fa-solid fa-user-plus"></i> Grant</button>
                    </div>
                </form>
                <div class="vap-section-title">Staff <span class="vap-count">${this._staff.length}</span></div>
                <div class="vap-list">${rows}</div>
            </div>`;
    },

    // ─── Field/markup helpers ─────────────────────────────────────────────
    _statCard(icon, value, label) {
        return `<div class="vap-stat-card"><div class="vap-stat-icon"><i class="fa-solid ${icon}"></i></div><div><div class="vap-stat-value">${value}</div><div class="vap-stat-label">${label}</div></div></div>`;
    },
    _field(name, label, value, opt = {}) {
        const o = opt || {};
        return `
            <div class="vap-input-group ${o.full ? 'vap-col-full' : ''}">
                <label>${label}${o.required ? ' <span class="vap-req">*</span>' : ''}</label>
                <input class="vap-input ${o.mono ? 'vap-mono' : ''}" type="${o.type || 'text'}" name="${name}"
                    value="${esc(value || '')}" ${o.required ? 'required' : ''} ${o.maxlength ? `maxlength="${o.maxlength}"` : ''}
                    placeholder="${esc(o.placeholder || '')}">
                ${o.hint ? `<span class="vap-hint">${esc(o.hint)}</span>` : ''}
            </div>`;
    },
    _select(name, label, value, options, required = false) {
        return `
            <div class="vap-input-group">
                <label>${label}${required ? ' <span class="vap-req">*</span>' : ''}</label>
                <select class="vap-input" name="${name}" ${required ? 'required' : ''}>
                    ${required ? '' : `<option value="">—</option>`}
                    ${options.map(o => `<option value="${esc(o)}" ${o === value ? 'selected' : ''}>${esc(o.charAt(0).toUpperCase() + o.slice(1))}</option>`).join('')}
                </select>
            </div>`;
    },
    _textarea(name, label, value, opt = {}) {
        const o = opt || {};
        return `
            <div class="vap-input-group ${o.full ? 'vap-col-full' : ''}">
                <label>${label}${o.required ? ' <span class="vap-req">*</span>' : ''}</label>
                <textarea class="vap-input vap-textarea" name="${name}" ${o.required ? 'required' : ''} ${o.maxlength ? `maxlength="${o.maxlength}"` : ''}>${esc(value || '')}</textarea>
                ${o.hint ? `<span class="vap-hint">${esc(o.hint)}</span>` : ''}
            </div>`;
    },
    _empty(icon, title, sub) {
        return `<div class="vap-empty"><i class="fa-solid ${icon}"></i><div class="vap-empty-title">${title}</div><div class="vap-empty-sub">${sub}</div></div>`;
    },

    // ─── Event handlers ───────────────────────────────────────────────────
    async _onClick(e) {
        const t = e.target;
        if (t.closest('#vap-close-btn')) { this.close(); return; }
        if (t.closest('#vap-theme-btn')) { this._toggleTheme(); return; }
        if (t.closest('#vap-signout-btn')) { this._signOut(); return; }
        if (t.closest('#vap-gate-signin')) {
            try { const m = await import('./vaAuth.js'); m.openAuthModal('signin', { onAuthed: () => this._boot() }); } catch (_) {}
            return;
        }
        if (t.closest('#vap-retry')) { this._renderShell(this._loadingHTML()); this._boot(); return; }

        const tabBtn = t.closest('.vap-dock-item');
        if (tabBtn) { this._activeTab = tabBtn.dataset.tab; this._showEventForm = false; this._renderContentOnly(); return; }

        if (t.closest('#vap-new-event-btn')) { this._showEventForm = !this._showEventForm; this._renderContentOnly(); return; }
        if (t.closest('#vap-event-cancel')) { this._showEventForm = false; this._renderContentOnly(); return; }

        const pilotDel = t.closest('[data-pilot-del]');
        if (pilotDel) { this._removePilot(pilotDel.dataset.pilotDel); return; }

        const eventDel = t.closest('[data-event-del]');
        if (eventDel) { this._deleteEvent(eventDel.dataset.eventDel); return; }

        const actionBtn = t.closest('button[data-action]');
        if (actionBtn) { this._handleAction(actionBtn); return; }
    },

    async _onSubmit(e) {
        const form = e.target;
        e.preventDefault();
        if (form.id === 'vap-profile-form') return this._saveProfile(form);
        if (form.id === 'vap-pilot-form') return this._addPilot(form);
        if (form.id === 'vap-event-form') return this._createEvent(form);
        if (form.id === 'vap-staff-form') return this._grantStaff(form);
    },

    _toggleTheme() {
        this._theme = this._theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('vap-theme', this._theme);
        document.getElementById('va-portal-overlay')?.setAttribute('data-theme', this._theme);
        const icon = document.querySelector('#vap-theme-btn i');
        if (icon) icon.className = `fa-solid ${this._theme === 'dark' ? 'fa-moon' : 'fa-sun'}`;
    },

    async _signOut() {
        try { await signOut(); this._toast('ok', 'Signed out.'); } catch (_) { this._toast('err', 'Sign out failed.'); }
        this._va = null; this._isStaff = false; this._activeTab = null;
        this._renderShell(this._gateHTML());
    },

    // ─── Data actions ─────────────────────────────────────────────────────
    async _saveProfile(form) {
        const d = Object.fromEntries(new FormData(form).entries());
        const msg = form.querySelector('#vap-profile-msg');
        this._msg(msg, '', '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving…');
        try {
            const updated = await updateVa(this._va.id, {
                name: d.name,
                callsign: (d.callsign || '').toUpperCase(),
                hub: (d.hub || '').toUpperCase() || null,
                region: d.region || null,
                fleet: d.fleet || null,
                website: d.website || null,
                discord: d.discord || null,
                logo_url: d.logo_url || null,
                description: d.description || null
            });
            this._va = updated;
            this._msg(msg, 'ok', '<i class="fa-solid fa-circle-check"></i> Saved');
            this._toast('ok', 'Profile updated.');
            setTimeout(() => this._msg(msg, '', ''), 2500);
        } catch (err) {
            this._msg(msg, 'err', `<i class="fa-solid fa-circle-exclamation"></i> ${esc(err.message)}`);
            this._toast('err', err.message);
        }
    },

    async _addPilot(form) {
        const d = Object.fromEntries(new FormData(form).entries());
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
            await addPilot(this._va.id, d.ifc_handle, d.rank, this._pilots.length);
            this._pilots = await listPilots(this._va.id);
            this._toast('ok', 'Pilot added.');
            this._renderContentOnly();
        } catch (err) { this._toast('err', err.message); btn.disabled = false; }
    },

    async _removePilot(id) {
        if (!await this._confirm({ title: 'Remove pilot?', message: 'This removes them from your roster.', confirmLabel: 'Remove', danger: true })) return;
        try {
            await removePilot(id);
            this._pilots = this._pilots.filter(p => p.id !== id);
            this._toast('ok', 'Pilot removed.');
            this._renderContentOnly();
        } catch (err) { this._toast('err', err.message); }
    },

    async _createEvent(form) {
        const d = Object.fromEntries(new FormData(form).entries());
        const msg = form.querySelector('#vap-event-msg');
        this._msg(msg, '', '<i class="fa-solid fa-circle-notch fa-spin"></i> Submitting…');
        try {
            await createEvent(this._va.id, {
                name: d.name,
                start_at: d.start_at ? new Date(d.start_at).toISOString() : null,
                end_at: d.end_at ? new Date(d.end_at).toISOString() : null,
                server: d.server,
                origin_icao: d.origin_icao,
                destination_icao: d.destination_icao,
                route: d.route,
                aircraft: d.aircraft,
                livery: d.livery,
                briefing: d.briefing,
                signup_url: d.signup_url
            });
            this._events = await listEventsForVa(this._va.id);
            this._showEventForm = false;
            this._toast('ok', this._va.trusted ? 'Published.' : 'Submitted for review.');
            this._renderContentOnly();
        } catch (err) {
            this._msg(msg, 'err', `<i class="fa-solid fa-circle-exclamation"></i> ${esc(err.message)}`);
            this._toast('err', err.message);
        }
    },

    async _deleteEvent(id) {
        if (!await this._confirm({ title: 'Delete event?', message: 'If approved, it will be removed from the public board.', confirmLabel: 'Delete', danger: true })) return;
        try {
            await deleteEvent(id);
            this._events = this._events.filter(e => e.id !== id);
            this._toast('ok', 'Event deleted.');
            this._renderContentOnly();
        } catch (err) { this._toast('err', err.message); }
    },

    async _handleAction(btn) {
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        btn.disabled = true;
        try {
            if (action === 'approve') {
                const slug = (document.querySelector(`.vap-slug-input[data-id="${id}"]`)?.value || '').trim();
                if (!slug) { this._toast('err', 'Slug is required.'); btn.disabled = false; return; }
                if (!await this._confirm({ title: 'Approve application?', message: `Public page will be /va.html?slug=${esc(slug)}`, confirmLabel: 'Approve' })) { btn.disabled = false; return; }
                await approveApplication(id, slug);
                this._apps = await listPendingApplications();
                this._toast('ok', 'Application approved.');
                this._renderContentOnly();
            } else if (action === 'reject') {
                const reason = await this._prompt({ title: 'Reject application', label: 'Reason (shown to applicant)', presets: REJECT_REASONS_APP, required: true, multiline: true });
                if (reason == null) { btn.disabled = false; return; }
                await rejectApplication(id, reason);
                this._apps = await listPendingApplications();
                this._toast('ok', 'Application rejected.');
                this._renderContentOnly();
            } else if (action === 'approve-event') {
                await approveEvent(id);
                this._pendingEvents = await listPendingEvents();
                this._toast('ok', 'Event approved.');
                this._renderContentOnly();
            } else if (action === 'reject-event') {
                const reason = await this._prompt({ title: 'Reject event', label: 'Reason (shown to VA)', presets: REJECT_REASONS_EVENT, required: true, multiline: true });
                if (reason == null) { btn.disabled = false; return; }
                await rejectEvent(id, reason);
                this._pendingEvents = await listPendingEvents();
                this._toast('ok', 'Event rejected.');
                this._renderContentOnly();
            } else if (action === 'remove-staff') {
                if (!await this._confirm({ title: 'Revoke staff access?', message: 'They will lose console access on next sign-in.', confirmLabel: 'Revoke', danger: true })) { btn.disabled = false; return; }
                const { error } = await supabase.from('va_staff').delete().eq('user_id', id);
                if (error) throw error;
                await this._loadStaff();
                this._toast('ok', 'Staff access revoked.');
                this._renderContentOnly();
            }
        } catch (err) {
            this._toast('err', err.message || 'Action failed.');
            btn.disabled = false;
        }
    },

    async _grantStaff(form) {
        const d = Object.fromEntries(new FormData(form).entries());
        const msg = form.querySelector('#vap-staff-msg');
        const userId = (d.user_id || '').trim();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
            this._msg(msg, 'err', '<i class="fa-solid fa-circle-exclamation"></i> Enter a valid user UUID.');
            return;
        }
        try {
            const { error } = await supabase.from('va_staff').insert({ user_id: userId, granted_by: this._session?.user?.id });
            if (error) throw error;
            await this._loadStaff();
            this._toast('ok', 'Staff access granted.');
            this._renderContentOnly();
        } catch (err) {
            this._msg(msg, 'err', `<i class="fa-solid fa-circle-exclamation"></i> ${esc(err.message)}`);
            this._toast('err', err.message);
        }
    },

    _msg(el, kind, html) {
        if (!el) return;
        el.className = `vap-form-msg ${kind ? 'vap-form-msg-' + kind : ''}`;
        el.innerHTML = html;
    },

    // ─── Self-contained toast / confirm / prompt ──────────────────────────
    _toast(type, message) {
        let host = document.getElementById('vap-toast-host');
        if (!host) {
            host = document.createElement('div');
            host.id = 'vap-toast-host';
            document.body.appendChild(host);
        }
        const icon = type === 'ok' ? 'fa-circle-check' : type === 'err' ? 'fa-circle-exclamation' : 'fa-circle-info';
        const t = document.createElement('div');
        t.className = `vap-toast vap-toast-${type}`;
        t.innerHTML = `<i class="fa-solid ${icon}"></i><span></span>`;
        t.querySelector('span').textContent = message || '';
        host.appendChild(t);
        requestAnimationFrame(() => t.classList.add('show'));
        setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 220); }, 3600);
    },

    _confirm({ title, message, confirmLabel = 'Confirm', danger = false }) {
        return new Promise(resolve => {
            const host = this._dialogHost();
            host.innerHTML = `
                <div class="vap-dialog">
                    <h3>${esc(title)}</h3>
                    ${message ? `<p>${esc(message)}</p>` : ''}
                    <div class="vap-dialog-actions">
                        <button class="vap-btn vap-btn-ghost" data-vap-dlg="cancel">Cancel</button>
                        <button class="vap-btn ${danger ? 'vap-btn-danger' : 'vap-btn-primary'}" data-vap-dlg="ok">${esc(confirmLabel)}</button>
                    </div>
                </div>`;
            const done = (val) => { host.remove(); resolve(val); };
            host.addEventListener('click', (e) => {
                if (e.target === host || e.target.closest('[data-vap-dlg="cancel"]')) done(false);
                if (e.target.closest('[data-vap-dlg="ok"]')) done(true);
            });
        });
    },

    _prompt({ title, label, presets = [], required = false, multiline = false }) {
        return new Promise(resolve => {
            const host = this._dialogHost();
            const input = multiline
                ? `<textarea class="vap-input vap-textarea" id="vap-dlg-input"></textarea>`
                : `<input class="vap-input" id="vap-dlg-input">`;
            host.innerHTML = `
                <div class="vap-dialog">
                    <h3>${esc(title)}</h3>
                    ${label ? `<label class="vap-dlg-label">${esc(label)}</label>` : ''}
                    ${input}
                    ${presets.length ? `<div class="vap-dlg-presets">${presets.map(p => `<button type="button" class="vap-chip" data-vap-preset="${esc(p)}">${esc(p)}</button>`).join('')}</div>` : ''}
                    <div class="vap-dialog-actions">
                        <button class="vap-btn vap-btn-ghost" data-vap-dlg="cancel">Cancel</button>
                        <button class="vap-btn vap-btn-primary" data-vap-dlg="ok">Confirm</button>
                    </div>
                </div>`;
            const field = host.querySelector('#vap-dlg-input');
            setTimeout(() => field.focus(), 30);
            const done = (val) => { host.remove(); resolve(val); };
            host.addEventListener('click', (e) => {
                const preset = e.target.closest('[data-vap-preset]');
                if (preset) { field.value = preset.dataset.vapPreset; field.focus(); return; }
                if (e.target === host || e.target.closest('[data-vap-dlg="cancel"]')) { done(null); return; }
                if (e.target.closest('[data-vap-dlg="ok"]')) {
                    const v = (field.value || '').trim();
                    if (required && !v) { field.classList.add('vap-input-err'); return; }
                    done(v);
                }
            });
        });
    },

    _dialogHost() {
        const host = document.createElement('div');
        host.id = 'vap-dialog-host';
        host.className = 'vap-dialog-host';
        document.body.appendChild(host);
        return host;
    },

    // ─── Styles ───────────────────────────────────────────────────────────
    _injectStyles() {
        if (document.getElementById('vap-styles')) return;
        const style = document.createElement('style');
        style.id = 'vap-styles';
        style.textContent = `
        #va-portal-overlay, #vap-toast-host, #vap-dialog-host {
            --vap-bg-page: rgba(20,17,13,0.46);
            --vap-base: #f5f1ea; --vap-surface: #faf6ef; --vap-card: #ffffff; --vap-card-elev: #fffbf3;
            --vap-text: #1a1612; --vap-text-2: #6b6258; --vap-text-3: #9a9088;
            --vap-border: rgba(26,22,18,0.10); --vap-border-light: rgba(26,22,18,0.05); --vap-hover: rgba(26,22,18,0.04);
            --vap-accent: #b88553; --vap-accent-hover: #a87543; --vap-accent-soft: rgba(184,133,83,0.12);
            --vap-pos: #4a8c5a; --vap-pos-soft: rgba(74,140,90,0.14);
            --vap-neg: #c25a5a; --vap-neg-soft: rgba(194,90,90,0.12);
            --vap-warn: #c8893d; --vap-warn-soft: rgba(200,137,61,0.14);
            --vap-radius: 12px; --vap-radius-lg: 16px; --vap-radius-xl: 20px;
            --vap-font: 'DM Sans','Inter',system-ui,-apple-system,sans-serif;
            --vap-mono: 'JetBrains Mono',ui-monospace,'SF Mono',monospace;
            --vap-ease: cubic-bezier(0.16,1,0.3,1);
        }
        #va-portal-overlay[data-theme="dark"], #vap-dialog-host[data-theme="dark"] {
            --vap-bg-page: rgba(0,0,0,0.6);
            --vap-base: #1a1814; --vap-surface: #211e19; --vap-card: #25221c; --vap-card-elev: #2c2820;
            --vap-text: #f2ede4; --vap-text-2: #b8afa2; --vap-text-3: #8a8276;
            --vap-border: rgba(255,255,255,0.10); --vap-border-light: rgba(255,255,255,0.05); --vap-hover: rgba(255,255,255,0.05);
            --vap-accent: #d4a574; --vap-accent-hover: #e0b489; --vap-accent-soft: rgba(212,165,116,0.16);
        }

        #va-portal-overlay {
            position: fixed; inset: 0; z-index: 12000; background: var(--vap-bg-page);
            display: flex; align-items: center; justify-content: center; padding: 22px;
            opacity: 0; visibility: hidden; pointer-events: none; font-family: var(--vap-font);
            -webkit-font-smoothing: antialiased;
            transition: opacity 240ms var(--vap-ease), visibility 0ms linear 320ms;
        }
        #va-portal-overlay.vap-open { opacity: 1; visibility: visible; pointer-events: auto; transition: opacity 240ms var(--vap-ease), visibility 0ms; }

        .vap-shell {
            position: relative; width: 100%; max-width: 1240px; height: 90vh;
            background: var(--vap-base); border-radius: var(--vap-radius-xl); overflow: hidden;
            box-shadow: 0 32px 64px -16px rgba(20,16,10,0.5), 0 0 0 1px rgba(26,22,18,0.06);
            opacity: 0; transform: translateY(10px) scale(0.99);
            transition: opacity 300ms var(--vap-ease) 60ms, transform 300ms var(--vap-ease) 60ms;
            color: var(--vap-text);
        }
        #va-portal-overlay.vap-open .vap-shell { opacity: 1; transform: none; }

        .vap-topstrip { position: absolute; inset: 0 0 auto 0; height: 58px; display: flex; align-items: center; justify-content: space-between;
            padding: 0 18px; border-bottom: 1px solid var(--vap-border-light); background: var(--vap-surface); z-index: 5; }
        .vap-brand { display: flex; align-items: baseline; gap: 8px; }
        .vap-brand-name { font-weight: 800; font-size: 1.02rem; letter-spacing: -0.01em; }
        .vap-brand-tag { font-size: 0.62rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; color: var(--vap-accent); }
        .vap-topstrip-right { display: flex; align-items: center; gap: 8px; }
        .vap-icon-btn { width: 34px; height: 34px; border-radius: 10px; background: var(--vap-card); border: 1px solid var(--vap-border);
            color: var(--vap-text-2); cursor: pointer; display: grid; place-items: center; font-size: 0.82rem; transition: all 140ms var(--vap-ease); }
        .vap-icon-btn:hover { background: var(--vap-card-elev); color: var(--vap-text); }
        .vap-icon-btn-close:hover { background: var(--vap-neg-soft); color: var(--vap-neg); border-color: transparent; }
        .vap-user-chip { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px 0 4px; background: var(--vap-card); border: 1px solid var(--vap-border); border-radius: 999px; max-width: 220px; }
        .vap-user-initials { width: 26px; height: 26px; border-radius: 50%; background: var(--vap-accent); color: #fff; font-weight: 700; font-size: 0.7rem; display: grid; place-items: center; }
        .vap-user-email { font-size: 0.74rem; color: var(--vap-text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        .vap-content { position: absolute; inset: 58px 0 0 0; overflow-y: auto; padding: 26px 34px 120px; }
        .vap-page { max-width: 860px; margin: 0 auto; display: flex; flex-direction: column; gap: 18px; }

        .vap-dock { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 8; max-width: calc(100% - 32px); }
        .vap-dock-inner { display: flex; align-items: center; gap: 3px; background: var(--vap-card); border: 1px solid var(--vap-border); border-radius: 16px; padding: 6px; overflow-x: auto;
            box-shadow: 0 12px 32px -8px rgba(20,16,10,0.4); }
        .vap-dock-item { position: relative; background: transparent; border: none; color: var(--vap-text-2); font-family: var(--vap-font); font-size: 0.76rem; font-weight: 600;
            padding: 8px 13px; border-radius: 11px; cursor: pointer; display: flex; align-items: center; gap: 8px; white-space: nowrap; transition: all 160ms var(--vap-ease); }
        .vap-dock-item:hover { background: var(--vap-hover); color: var(--vap-text); }
        .vap-dock-item.active { background: var(--vap-accent-soft); color: var(--vap-accent); }
        .vap-dock-badge { min-width: 16px; height: 16px; padding: 0 5px; background: var(--vap-accent); color: #fff; font-size: 0.6rem; font-weight: 800; border-radius: 999px; display: grid; place-items: center; }
        .vap-dock-sep { width: 1px; height: 22px; background: var(--vap-border); margin: 0 4px; }

        .vap-card { background: var(--vap-card); border: 1px solid var(--vap-border); border-radius: var(--vap-radius-lg); overflow: hidden; }
        .vap-card-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; border-bottom: 1px solid var(--vap-border-light); }
        .vap-card-header h2 { margin: 0; font-size: 0.96rem; font-weight: 700; }
        .vap-card-body { padding: 18px; }
        .vap-card-footer { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 18px; border-top: 1px solid var(--vap-border-light); }

        .vap-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .vap-col-full { grid-column: 1 / -1; }
        .vap-form-inline { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; }
        .vap-form-inline .vap-input-group { flex: 1; min-width: 160px; }
        .vap-inline-submit { height: 40px; }
        .vap-input-group { display: flex; flex-direction: column; gap: 6px; }
        .vap-input-group label { font-size: 0.74rem; font-weight: 600; color: var(--vap-text-2); }
        .vap-req { color: var(--vap-neg); }
        .vap-input { width: 100%; padding: 10px 12px; border: 1px solid var(--vap-border); border-radius: 10px; background: var(--vap-card-elev); color: var(--vap-text);
            font-size: 0.86rem; font-family: var(--vap-font); transition: all 140ms var(--vap-ease); }
        .vap-input:focus { outline: none; border-color: var(--vap-accent); box-shadow: 0 0 0 3px var(--vap-accent-soft); }
        .vap-input-err { border-color: var(--vap-neg); box-shadow: 0 0 0 3px var(--vap-neg-soft); }
        .vap-textarea { min-height: 92px; resize: vertical; }
        .vap-mono { font-family: var(--vap-mono); }
        .vap-hint { font-size: 0.68rem; color: var(--vap-text-3); }
        select.vap-input { cursor: pointer; }

        .vap-btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; border: 1px solid transparent; border-radius: 10px;
            padding: 10px 16px; font-family: var(--vap-font); font-size: 0.82rem; font-weight: 600; cursor: pointer; transition: all 140ms var(--vap-ease); white-space: nowrap; }
        .vap-btn:disabled { opacity: 0.55; cursor: default; }
        .vap-btn-sm { padding: 7px 11px; font-size: 0.76rem; }
        .vap-btn-primary { background: var(--vap-accent); color: #fff; }
        .vap-btn-primary:hover { background: var(--vap-accent-hover); }
        .vap-btn-secondary { background: var(--vap-card); color: var(--vap-text); border-color: var(--vap-border); }
        .vap-btn-ghost { background: transparent; color: var(--vap-text-2); border-color: var(--vap-border); }
        .vap-btn-ghost:hover { background: var(--vap-hover); color: var(--vap-text); }
        .vap-btn-success { background: var(--vap-pos); color: #fff; }
        .vap-btn-danger { background: var(--vap-neg); color: #fff; }
        .vap-btn-danger:hover { filter: brightness(1.06); }
        a.vap-btn { text-decoration: none; }

        .vap-badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; font-size: 0.66rem; font-weight: 700; letter-spacing: 0.02em; }
        .vap-badge-mono { font-family: var(--vap-mono); background: var(--vap-hover); color: var(--vap-text-2); }
        .vap-badge-soft { background: var(--vap-hover); color: var(--vap-text-2); text-transform: capitalize; }
        .vap-badge-pos { background: var(--vap-pos-soft); color: var(--vap-pos); text-transform: capitalize; }
        .vap-badge-neg { background: var(--vap-neg-soft); color: var(--vap-neg); text-transform: capitalize; }
        .vap-badge-warn { background: var(--vap-warn-soft); color: var(--vap-warn); text-transform: capitalize; }

        .vap-hero { display: flex; gap: 16px; align-items: center; background: var(--vap-card); border: 1px solid var(--vap-border); border-radius: var(--vap-radius-lg); padding: 18px; }
        .vap-hero-logo { width: 64px; height: 64px; border-radius: 14px; background: var(--vap-accent-soft); color: var(--vap-accent); display: grid; place-items: center; font-size: 1.5rem; overflow: hidden; flex-shrink: 0; }
        .vap-hero-logo img { width: 100%; height: 100%; object-fit: cover; }
        .vap-hero-titlerow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .vap-hero-titlerow h1 { margin: 0; font-size: 1.3rem; font-weight: 800; }
        .vap-hero-meta { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 6px; font-size: 0.8rem; color: var(--vap-text-2); }
        .vap-hero-meta a { color: var(--vap-accent); text-decoration: none; }
        .vap-hero-meta i { margin-right: 4px; }

        .vap-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
        .vap-stat-card { display: flex; align-items: center; gap: 12px; background: var(--vap-card); border: 1px solid var(--vap-border); border-radius: var(--vap-radius-lg); padding: 14px 16px; }
        .vap-stat-icon { width: 40px; height: 40px; border-radius: 11px; background: var(--vap-accent-soft); color: var(--vap-accent); display: grid; place-items: center; font-size: 1rem; flex-shrink: 0; }
        .vap-stat-value { font-size: 1.25rem; font-weight: 800; line-height: 1; }
        .vap-stat-label { font-size: 0.7rem; color: var(--vap-text-3); margin-top: 3px; }
        .vap-stat-trust { flex-direction: column; align-items: stretch; gap: 8px; grid-column: span 1; }
        .vap-stat-trust-head { display: flex; flex-direction: column; font-size: 0.74rem; font-weight: 700; }
        .vap-stat-trust-head .vap-muted { font-weight: 500; }
        .vap-progress { height: 6px; background: var(--vap-hover); border-radius: 999px; overflow: hidden; }
        .vap-progress-bar { height: 100%; background: var(--vap-accent); border-radius: 999px; transition: width 400ms var(--vap-ease); }

        .vap-section-title { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--vap-text-3); display: flex; align-items: center; gap: 8px; }
        .vap-count { background: var(--vap-hover); color: var(--vap-text-2); border-radius: 999px; padding: 1px 8px; font-size: 0.68rem; letter-spacing: 0; }
        .vap-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .vap-list { display: flex; flex-direction: column; gap: 10px; }
        .vap-muted { color: var(--vap-text-3); }

        .vap-row { display: flex; align-items: center; gap: 12px; background: var(--vap-card); border: 1px solid var(--vap-border); border-radius: var(--vap-radius); padding: 12px 14px; }
        .vap-row-block { align-items: flex-start; }
        .vap-row-main { flex: 1; min-width: 0; }
        .vap-row-body { flex: 1; min-width: 0; }
        .vap-avatar { width: 36px; height: 36px; border-radius: 10px; background: var(--vap-accent-soft); color: var(--vap-accent); display: grid; place-items: center; flex-shrink: 0; }
        .vap-row-title { font-weight: 700; font-size: 0.88rem; }
        .vap-row-title-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .vap-row-sub { font-size: 0.78rem; color: var(--vap-text-2); margin-top: 2px; }
        .vap-reject { margin-top: 6px; font-size: 0.76rem; color: var(--vap-neg); }
        .vap-stamp { font-size: 0.7rem; color: var(--vap-text-3); margin-top: 4px; }

        .vap-review { padding: 16px; }
        .vap-review-head { display: flex; gap: 12px; }
        .vap-review-logo { width: 46px; height: 46px; border-radius: 11px; background: var(--vap-accent-soft); color: var(--vap-accent); display: grid; place-items: center; overflow: hidden; flex-shrink: 0; }
        .vap-review-logo img { width: 100%; height: 100%; object-fit: cover; }
        .vap-review-body { flex: 1; min-width: 0; }
        .vap-details { margin-top: 12px; border-top: 1px solid var(--vap-border-light); padding-top: 10px; }
        .vap-details summary { cursor: pointer; font-size: 0.78rem; color: var(--vap-text-2); font-weight: 600; }
        .vap-details-body { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; font-size: 0.8rem; color: var(--vap-text-2); }
        .vap-details-body a { color: var(--vap-accent); }
        .vap-details-pitch { background: var(--vap-hover); border-radius: 10px; padding: 10px 12px; white-space: pre-wrap; }
        .vap-review-actions { display: flex; align-items: flex-end; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
        .vap-slug-wrap { display: flex; flex-direction: column; gap: 5px; flex: 1; min-width: 160px; }
        .vap-slug-wrap label { font-size: 0.68rem; font-weight: 600; color: var(--vap-text-3); }

        .vap-empty { text-align: center; padding: 46px 20px; color: var(--vap-text-3); }
        .vap-empty i { font-size: 1.8rem; margin-bottom: 12px; opacity: 0.7; }
        .vap-empty-title { font-weight: 700; color: var(--vap-text-2); font-size: 0.92rem; }
        .vap-empty-sub { font-size: 0.8rem; margin-top: 4px; }

        .vap-gate { max-width: 420px; margin: 8vh auto 0; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 12px; }
        .vap-gate-icon { width: 64px; height: 64px; border-radius: 18px; background: var(--vap-accent-soft); color: var(--vap-accent); display: grid; place-items: center; font-size: 1.6rem; }
        .vap-gate-icon-err { background: var(--vap-neg-soft); color: var(--vap-neg); }
        .vap-gate-spin { font-size: 1.8rem; color: var(--vap-accent); margin-top: 12vh; }
        .vap-gate-title { margin: 0; font-size: 1.3rem; font-weight: 800; }
        .vap-gate-sub { margin: 0; color: var(--vap-text-2); font-size: 0.88rem; line-height: 1.5; }
        .vap-gate .vap-btn { margin-top: 8px; }

        .vap-form-msg { font-size: 0.76rem; font-weight: 600; }
        .vap-form-msg-ok { color: var(--vap-pos); }
        .vap-form-msg-err { color: var(--vap-neg); }

        /* Toast */
        #vap-toast-host { position: fixed; bottom: 22px; right: 22px; z-index: 13000; display: flex; flex-direction: column; gap: 10px; font-family: var(--vap-font); }
        .vap-toast { display: flex; align-items: center; gap: 10px; background: var(--vap-card, #fff); color: var(--vap-text, #1a1612); border: 1px solid var(--vap-border, rgba(0,0,0,0.1));
            border-radius: 12px; padding: 12px 16px; font-size: 0.84rem; font-weight: 600; box-shadow: 0 12px 30px -8px rgba(20,16,10,0.4);
            transform: translateX(120%); opacity: 0; transition: transform 240ms var(--vap-ease), opacity 240ms var(--vap-ease); max-width: 340px; }
        .vap-toast.show { transform: none; opacity: 1; }
        .vap-toast-ok i { color: var(--vap-pos, #4a8c5a); }
        .vap-toast-err i { color: var(--vap-neg, #c25a5a); }

        /* Dialog */
        .vap-dialog-host { position: fixed; inset: 0; z-index: 13500; background: rgba(10,8,5,0.5); display: grid; place-items: center; padding: 20px; font-family: var(--vap-font); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
        .vap-dialog { width: 100%; max-width: 440px; background: var(--vap-card, #fff); color: var(--vap-text, #1a1612); border: 1px solid var(--vap-border, rgba(0,0,0,0.1)); border-radius: var(--vap-radius-lg, 16px); padding: 22px; box-shadow: 0 30px 60px -16px rgba(0,0,0,0.5); }
        .vap-dialog h3 { margin: 0 0 8px; font-size: 1.05rem; font-weight: 800; }
        .vap-dialog p { margin: 0 0 14px; color: var(--vap-text-2, #6b6258); font-size: 0.86rem; line-height: 1.5; }
        .vap-dlg-label { display: block; font-size: 0.74rem; font-weight: 600; color: var(--vap-text-2, #6b6258); margin-bottom: 6px; }
        .vap-dlg-presets { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
        .vap-chip { background: var(--vap-hover, rgba(0,0,0,0.04)); border: 1px solid var(--vap-border, rgba(0,0,0,0.1)); color: var(--vap-text-2, #6b6258); border-radius: 999px; padding: 5px 11px; font-size: 0.72rem; font-family: var(--vap-font); cursor: pointer; text-align: left; }
        .vap-chip:hover { background: var(--vap-accent-soft, rgba(184,133,83,0.12)); color: var(--vap-accent, #b88553); }
        .vap-dialog-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }

        @media (max-width: 768px) {
            #va-portal-overlay { padding: 0; }
            .vap-shell { max-width: 100%; height: 100%; border-radius: 0; }
            .vap-content { padding: 22px 16px 110px; }
            .vap-form-grid { grid-template-columns: 1fr; }
            .vap-stats { grid-template-columns: 1fr 1fr; }
            .vap-user-email { display: none; }
            .vap-dock { left: 16px; right: 16px; transform: none; max-width: none; }
            .vap-dock-inner { justify-content: flex-start; }
        }
        `;
        document.head.appendChild(style);
    }
};

if (typeof window !== 'undefined') window.VAPortalUI = VAPortalUI;
