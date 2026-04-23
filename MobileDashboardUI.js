/**
 * MobileDashboardUI.js — Premium Mobile-Optimized Full-Screen Dashboard
 *
 * A full mobile counterpart to ProfileUI. Mirrors all five tabs
 * in a native-feeling bottom-sheet + tab-bar architecture,
 * now featuring premium glassmorphism, cinematic live flights,
 * and advanced airspace telemetry heatmaps.
 */

import { CareerModule } from './careerModule.js';
import { PredictiveAirspaceNetwork } from './PredictiveQueueManager.js';
import { socketDataHub } from './SocketDataHub.js';

export const MobileDashboardUI = {

    // ─── State ──────────────────────────────────────────────────────────────
    _supabase:          null,
    _isOpen:            false,
    _injected:          false,
    _activeTab:         'dashboard',
    _currentUser:       null,
    _theme:             'dark',
    _flightPlansData:   [],
    _liveFlights:       [],
    _socketUnsubscribe: null,
    _airspaceNetwork:   null,
    _airspaceTimer:     null,
    _subscription: {
        status:      'Active',
        plan:        'Pro Access',
        nextPayment: 'Upcoming',
        price:       '$1.00 / month',
    },
    _ifData: {
        loading:       false,
        userId:        null,
        stats:         null,
        logbook:       [],
        logbookTotal:  0,
        activeHistory: null,
        error:         null,
    },
    _backendUrl: window.APP_CONFIG?.backendUrl || 'https://site--acars-backend--6dmjph8ltlhv.code.run',

    // ─── Public API ──────────────────────────────────────────────────────────

    init(supabaseClient) {
        this._supabase = supabaseClient;

        this._supabase.auth.onAuthStateChange((event, session) => {
            if (session?.user) {
                this._currentUser = session.user;
            } else {
                this._currentUser = null;
            }

            if (event === 'USER_UPDATED' && session?.user && this._isOpen) {
                const ifUsername = session.user.user_metadata?.if_username;
                if (ifUsername) this._fetchInfiniteFlightData(ifUsername);
                this._render();
            }
        });

        if (!this._socketUnsubscribe) {
            this._socketUnsubscribe = socketDataHub.subscribe('all_flights_update', (payload) => {
                const ifUsername = this._currentUser?.user_metadata?.if_username;
                if (!ifUsername || !payload?.flights) return;
                const prev = this._liveFlights.length > 0;
                this._liveFlights = payload.flights.filter(
                    f => f.username?.toLowerCase() === ifUsername.toLowerCase()
                );
                if (this._isOpen && this._activeTab === 'dashboard') {
                    if (this._liveFlights.length > 0 || prev) this._updateLiveBanner();
                }
            });
        }
    },

    open(user) {
        this._currentUser = user;

        const needsOnboarding = !user?.user_metadata?.onboarding_complete;
        this._activeTab = needsOnboarding ? 'onboarding' : 'dashboard';

        if (!this._injected) {
            this._injectStyles();
            this._injectShell();
            this._injected = true;
        }

        if (!this._airspaceNetwork) {
            this._airspaceNetwork = new PredictiveAirspaceNetwork();
            this._airspaceNetwork.bindTelemetryStream();
            this._airspaceNetwork.setActiveNodes(['KJFK', 'EGLL', 'KLAX', 'OMDB']);
        }

        this._render();
        this._fetchSubscriptionData();
        this._fetchFlightPlans();

        const ifUsername = user?.user_metadata?.if_username;
        if (ifUsername) this._fetchInfiniteFlightData(ifUsername);

        requestAnimationFrame(() => requestAnimationFrame(() => {
            document.getElementById('mdui-shell')?.classList.add('mdui-open');
            this._isOpen = true;
            document.body.style.overflow = 'hidden';
        }));
    },

    close() {
        document.getElementById('mdui-shell')?.classList.remove('mdui-open');
        this._isOpen = false;
        document.body.style.overflow = '';
        if (this._airspaceTimer) {
            clearInterval(this._airspaceTimer);
            this._airspaceTimer = null;
        }
        setTimeout(() => {
            if (this._currentUser?.user_metadata?.onboarding_complete) {
                this._activeTab = 'dashboard';
            }
        }, 350);
    },

    switchTab(tabId) {
        if (this._activeTab === tabId) return;
        this._activeTab = tabId;
        if (this._airspaceTimer) { clearInterval(this._airspaceTimer); this._airspaceTimer = null; }
        this._render();
        if (tabId === 'airspace-intel') {
            this._airspaceTimer = setInterval(() => {
                if (this._isOpen && this._activeTab === 'airspace-intel') this._updateAirspaceDOM();
            }, 8000);
        }
    },

    // ─── Data Fetching ────────────────────────────────────────────────────────

    async _fetchSubscriptionData() {
        if (!this._currentUser || !this._supabase) return;
        try {
            const { data, error } = await this._supabase
                .from('subscriptions')
                .select('status, plan_name, current_period_end, amount')
                .eq('user_id', this._currentUser.id)
                .single();
            if (data && !error) {
                const nextDate = new Date(data.current_period_end);
                this._subscription = {
                    status:      data.status === 'active' ? 'Active' : 'Inactive',
                    plan:        data.plan_name || 'Pro Access',
                    nextPayment: isNaN(nextDate) ? 'Pending' : nextDate.toLocaleDateString(),
                    price:       `$${(data.amount / 100).toFixed(2)} / month`,
                };
                if (this._activeTab === 'settings' && this._isOpen) this._render();
            }
        } catch (_) { }
    },

    async _fetchFlightPlans() {
        if (!this._currentUser || !this._supabase) return;
        try {
            const { data, error } = await this._supabase
                .from('user_flights')
                .select('*')
                .eq('user_id', this._currentUser.id)
                .order('dep_time', { ascending: false })
                .limit(50);
            if (error) throw error;
            this._flightPlansData = data || [];
            if (this._activeTab === 'flight-plan' && this._isOpen) this._render();
        } catch (err) {
            console.error('Error fetching flight plans:', err.message);
        }
    },

    async _fetchInfiniteFlightData(ifUsername) {
        if (!ifUsername) return;
        this._ifData.loading = true;
        this._ifData.error   = null;
        if (this._isOpen) this._render();

        try {
            let ifUserId = null;
            let activeFlightId = null;

            if (typeof window.getLiveFlightData === 'function') {
                const liveFlights  = window.getLiveFlightData();
                const activeFlight = liveFlights.find(
                    f => f.properties?.username?.toLowerCase() === ifUsername.toLowerCase()
                );
                if (activeFlight) {
                    activeFlightId = activeFlight.properties.flightId;
                    ifUserId       = activeFlight.properties.userId;
                }
            }

            if (!ifUserId) {
                const res      = await fetch(`${this._backendUrl}/users`, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ discourseNames: [ifUsername], userHashes: [ifUsername] }),
                });
                const userData = await res.json();
                ifUserId       = userData?.users?.[0]?.userId;
            }

            if (!ifUserId) throw new Error('Could not find an Infinite Flight account with that username.');
            this._ifData.userId = ifUserId;

            const requests = [
                fetch(`${this._backendUrl}/api/users/${ifUserId}/stats`).then(r => r.json()),
                fetch(`${this._backendUrl}/api/users/${ifUserId}/flights?page=1`).then(r => r.json()),
            ];
            if (activeFlightId) {
                requests.push(
                    fetch(`${this._backendUrl}/api/flights/${activeFlightId}/history`)
                        .then(r => r.json()).catch(() => null)
                );
            }

            const [statsData, flightsData, historyData] = await Promise.all(requests);
            this._ifData.stats        = statsData.ok  ? statsData.stats   : null;
            this._ifData.logbook      = flightsData.ok ? flightsData.flights : [];
            this._ifData.logbookTotal = flightsData.ok ? flightsData.totalCount : 0;
            if (historyData?.ok) this._ifData.activeHistory = historyData.path;
            this._ifData.loading = false;
        } catch (err) {
            this._ifData.error   = err.message;
            this._ifData.loading = false;
        }

        if (this._isOpen) this._render();
    },

    // ─── DOM Shell ────────────────────────────────────────────────────────────

    _injectShell() {
        const el = document.createElement('div');
        el.id    = 'mdui-shell';
        el.innerHTML = `
            <div id="mdui-screen"></div>
            <nav id="mdui-tabbar">
                ${this._tabDef().map(t => `
                    <button class="mdui-tab-btn" data-tab="${t.id}" aria-label="${t.label}">
                        <i class="${t.icon}"></i>
                        <span>${t.label}</span>
                    </button>`).join('')}
            </nav>
        `;
        document.body.appendChild(el);

        el.addEventListener('click', e => {
            const btn = e.target.closest('.mdui-tab-btn');
            if (btn) this.switchTab(btn.dataset.tab);
        });
    },

    _tabDef() {
        return [
            { id: 'dashboard',        icon: 'fa-solid fa-table-cells-large', label: 'Home'     },
            { id: 'career-deep-dive', icon: 'fa-solid fa-id-card-clip',      label: 'Dossier'  },
            { id: 'airspace-intel',   icon: 'fa-solid fa-satellite-dish',    label: 'Radar'    },
            { id: 'flight-plan',      icon: 'fa-solid fa-route',             label: 'Dispatch' },
            { id: 'settings',         icon: 'fa-solid fa-sliders',           label: 'Settings' },
        ];
    },

    // ─── Render ───────────────────────────────────────────────────────────────

    _render() {
        const screen = document.getElementById('mdui-screen');
        if (!screen) return;

        document.querySelectorAll('.mdui-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === this._activeTab);
        });

        const tabbar = document.getElementById('mdui-tabbar');
        if (tabbar) tabbar.style.display = this._activeTab === 'onboarding' ? 'none' : '';

        screen.innerHTML = `
            <div class="mdui-top-bar">
                ${this._renderTopBar()}
            </div>
            <div class="mdui-content mdui-scroll">
                ${this._renderTabContent()}
            </div>
        `;

        this._attachListeners();

        if (this._activeTab === 'dashboard') this._updateLiveBanner();
    },

    _renderTopBar() {
        if (this._activeTab === 'onboarding') {
            return `<span class="mdui-top-title">Welcome Aboard</span>`;
        }
        const titles = {
            dashboard:        'Command Center',
            'career-deep-dive': 'Pilot Dossier',
            'airspace-intel': 'Airspace Radar',
            'flight-plan':    'Flight Dispatch',
            settings:         'Settings',
        };
        const user    = this._currentUser;
        const name    = user?.user_metadata?.full_name || user?.user_metadata?.name || 'Captain';
        const initials = name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);

        return `
            <div class="mdui-avatar">${initials}</div>
            <span class="mdui-top-title">${titles[this._activeTab] || ''}</span>
            <button class="mdui-close-btn" id="mdui-close" aria-label="Close">
                <i class="fa-solid fa-xmark"></i>
            </button>
        `;
    },

    // ─── Tab Content ─────────────────────────────────────────────────────────

    _renderTabContent() {
        switch (this._activeTab) {
            case 'onboarding':        return this._tabOnboarding();
            case 'dashboard':         return this._tabDashboard();
            case 'career-deep-dive':  return this._tabCareer();
            case 'airspace-intel':    return this._tabAirspace();
            case 'flight-plan':       return this._tabDispatch();
            case 'settings':          return this._tabSettings();
            default:                  return '';
        }
    },

    // ── Onboarding ────────────────────────────────────────────────────────────
    _tabOnboarding() {
        return `
            <div class="mdui-onboarding mdui-fade-up">
                <div class="mdui-onb-icon"><i class="fa-solid fa-plane-departure"></i></div>
                <h2 class="mdui-onb-title">Welcome Aboard!</h2>
                <p class="mdui-onb-sub">Let's get your flight deck configured.</p>

                <div class="mdui-card" style="margin-top: 28px;">
                    <div class="mdui-label">Choose Your Theme</div>
                    <div class="mdui-pill-row">
                        <label class="mdui-radio-pill">
                            <input type="radio" name="onb-theme" value="white" ${this._theme === 'white' ? 'checked' : ''}>
                            <span>Light</span>
                        </label>
                        <label class="mdui-radio-pill">
                            <input type="radio" name="onb-theme" value="dark-gray" ${this._theme !== 'white' ? 'checked' : ''}>
                            <span>Dark</span>
                        </label>
                    </div>
                </div>

                <div class="mdui-card" style="margin-top: 14px;">
                    <div class="mdui-label">Infinite Flight Username</div>
                    <div class="mdui-input-wrap">
                        <i class="fa-solid fa-plane mdui-input-icon"></i>
                        <input type="text" id="mdui-onb-username" class="mdui-input" placeholder="Community Forum Name">
                    </div>
                    <p class="mdui-help">Used to fetch your live flights and career stats.</p>
                </div>

                <button class="mdui-btn-primary" id="mdui-onb-complete" style="margin-top: 28px; width: 100%;">
                    Complete Setup
                </button>
                <p class="mdui-help" style="text-align: center; margin-top: 14px;">
                    These preferences can be changed later in Settings.
                </p>
            </div>
        `;
    },

    // ── Dashboard / Command Center ─────────────────────────────────────────────
    _tabDashboard() {
        const user      = this._currentUser;
        const name      = user?.user_metadata?.full_name || user?.user_metadata?.name || 'Captain';
        const firstName = name.trim().split(/\s+/)[0];
        const hour      = new Date().getHours();
        const greeting  = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
        const dateStr   = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
        const ifUsername = user?.user_metadata?.if_username || '';

        let statPills = '';
        if (this._ifData.stats) {
            const g = this._ifData.stats.gradeDetails?.gradeIndex;
            const x = this._ifData.stats.totalXP?.toLocaleString();
            const f = this._ifData.logbookTotal?.toLocaleString();
            statPills = `
                <div class="mdui-stat-strip">
                    ${g ? `<span class="mdui-stat-pill"><i class="fa-solid fa-award"></i> Grade ${g}</span>` : ''}
                    ${x ? `<span class="mdui-stat-pill"><i class="fa-solid fa-star"></i> ${x} XP</span>` : ''}
                    ${f ? `<span class="mdui-stat-pill"><i class="fa-solid fa-plane"></i> ${f}</span>` : ''}
                </div>`;
        } else if (this._ifData.loading) {
            statPills = `<div class="mdui-stat-strip"><span class="mdui-stat-pill" style="opacity:0.4;">Loading pilot data…</span></div>`;
        }

        let recentHTML = '';
        if (!ifUsername) {
            recentHTML = `<div class="mdui-empty"><i class="fa-solid fa-link-slash"></i><span>Link your IF account in Settings.</span></div>`;
        } else if (this._ifData.loading) {
            recentHTML = [1,2,3].map(() => `
                <div class="mdui-flight-row">
                    <div class="mdui-skel" style="width:110px;height:14px;border-radius:4px;"></div>
                    <div class="mdui-skel" style="width:55px;height:10px;border-radius:4px;"></div>
                </div>`).join('');
        } else if (this._ifData.logbook?.length > 0) {
            recentHTML = this._ifData.logbook.slice(0, 5).map((f, i) => {
                const dep     = f.originAirport      || 'N/A';
                const arr     = f.destinationAirport || 'N/A';
                const hrs     = (f.totalTime / 60).toFixed(1);
                const dateObj = new Date(f.created);
                const fresh   = (Date.now() - dateObj.getTime()) < 172800000;
                const timeStr = fresh ? 'Recently' : dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                return `
                    <div class="mdui-flight-row mdui-fade-up" style="animation-delay:${i * 0.04}s;">
                        <div class="mdui-flight-route">
                            <span class="mdui-icao">${dep}</span>
                            <i class="fa-solid fa-arrow-right mdui-arrow"></i>
                            <span class="mdui-icao">${arr}</span>
                        </div>
                        <div class="mdui-flight-meta">
                            <span>${f.callsign || '—'}</span>
                            <span class="mdui-dot">·</span>
                            <span>${hrs}h</span>
                        </div>
                        <div class="mdui-flight-time">${timeStr}</div>
                    </div>`;
            }).join('');
        } else {
            recentHTML = `<div class="mdui-empty"><i class="fa-solid fa-inbox"></i><span>No recent flights.</span></div>`;
        }

        let nextDepHTML = '';
        if (this._flightPlansData?.length > 0) {
            const next    = this._flightPlansData[0];
            const depTime = new Date(next.dep_time);
            const diffMs  = depTime - Date.now();
            const diffH   = Math.floor(diffMs / 3600000);
            const diffM   = Math.floor((diffMs % 3600000) / 60000);
            const countdown = diffMs > 0
                ? (diffH > 0 ? `In ${diffH}h ${diffM}m` : `In ${diffM}m`)
                : 'Departed';
            const hours = Math.floor(next.duration_minutes / 60);
            const mins  = next.duration_minutes % 60;

            nextDepHTML = `
                <div class="mdui-dispatch-mini">
                    <div class="mdui-dispatch-route">
                        <div class="mdui-dispatch-airport">
                            <span class="mdui-dispatch-icao">${next.dep_icao || '----'}</span>
                            ${next.dep_gate ? `<span class="mdui-dispatch-gate">Gate ${next.dep_gate}</span>` : ''}
                        </div>
                        <div class="mdui-dispatch-center">
                            <i class="fa-solid fa-plane mdui-dispatch-plane"></i>
                            <span class="mdui-dispatch-dur">${hours}h ${mins}m</span>
                        </div>
                        <div class="mdui-dispatch-airport" style="text-align:right;">
                            <span class="mdui-dispatch-icao">${next.arr_icao || '----'}</span>
                            ${next.arr_gate ? `<span class="mdui-dispatch-gate">Gate ${next.arr_gate}</span>` : ''}
                        </div>
                    </div>
                    <div class="mdui-dispatch-meta-row">
                        <span>${next.aircraft_type || 'N/A'}</span>
                        <span class="mdui-dot">·</span>
                        <span style="font-family:'JetBrains Mono',monospace;">${next.callsign || 'N/A'}</span>
                        <span class="mdui-dot">·</span>
                        <span style="color:var(--mdui-accent); font-weight:700;">${countdown}</span>
                    </div>
                </div>`;
        } else {
            nextDepHTML = `<div class="mdui-empty" style="padding: 20px 0;"><i class="fa-regular fa-calendar"></i><span>No upcoming flights filed.</span></div>`;
        }

        return `
            <div class="mdui-cc-greeting mdui-fade-up">
                <div>
                    <h1 class="mdui-greeting-text">${greeting},</h1>
                    <h1 class="mdui-greeting-name">${firstName}.</h1>
                    ${statPills}
                </div>
                <span class="mdui-greeting-date">${dateStr}</span>
            </div>

            <div id="mdui-live-banner"></div>

            <div class="mdui-section-label">Next Departure</div>
            <div class="mdui-card mdui-fade-up" style="animation-delay:0.06s;">
                ${nextDepHTML}
                <button class="mdui-link-btn" id="mdui-goto-dispatch">
                    View Schedule <i class="fa-solid fa-arrow-right"></i>
                </button>
            </div>

            <div class="mdui-section-label" style="margin-top:20px;">Recent Flights</div>
            <div class="mdui-card mdui-fade-up" style="animation-delay:0.1s; padding: 6px 0;">
                ${recentHTML}
            </div>
        `;
    },

    // ── Career / Pilot Dossier ────────────────────────────────────────────────
    _tabCareer() {
        const ifUsername = this._currentUser?.user_metadata?.if_username || '';
        let statCardsHTML = '';

        if (!ifUsername) {
            statCardsHTML = `
                <div class="mdui-alert mdui-alert-warn mdui-fade-up">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    Link your Infinite Flight account in Settings to view live career statistics.
                </div>`;
        } else if (this._ifData.loading) {
            statCardsHTML = [
                { label: 'Pilot Level',   w: 60  },
                { label: 'Total XP',      w: 80  },
                { label: 'Flights Flown', w: 50  },
            ].map(s => `
                <div class="mdui-mini-stat-card">
                    <div class="mdui-skel" style="width:42px;height:42px;border-radius:12px;margin-bottom:10px;"></div>
                    <div class="mdui-skel" style="width:${s.w}px;height:20px;border-radius:4px;margin-bottom:6px;"></div>
                    <div class="mdui-skel" style="width:80px;height:11px;border-radius:4px;"></div>
                </div>`).join('');
        } else if (this._ifData.error) {
            statCardsHTML = `
                <div class="mdui-alert mdui-alert-error mdui-fade-up">
                    <i class="fa-solid fa-circle-xmark"></i> ${this._ifData.error}
                </div>`;
        } else if (this._ifData.stats) {
            const grade   = this._ifData.stats.gradeDetails?.gradeIndex || 'N/A';
            const xp      = this._ifData.stats.totalXP?.toLocaleString() || '0';
            const flights = this._ifData.logbookTotal?.toLocaleString() || '0';
            const hours   = this._ifData.stats.flightTime ? (this._ifData.stats.flightTime / 60).toFixed(0) : '—';
            const ldgs    = this._ifData.stats.landingCount?.toLocaleString() || '—';
            const vios    = this._ifData.stats.violations?.toLocaleString() || '0';

            statCardsHTML = `
                <div class="mdui-mini-stat-card">
                    <div class="mdui-mini-icon" style="background:#eff6ff;color:#3b82f6;">
                        <i class="fa-solid fa-award"></i>
                    </div>
                    <div class="mdui-mini-value">Grade ${grade}</div>
                    <div class="mdui-mini-label">Pilot Level</div>
                </div>
                <div class="mdui-mini-stat-card">
                    <div class="mdui-mini-icon" style="background:#fdf4ff;color:#d946ef;">
                        <i class="fa-solid fa-star"></i>
                    </div>
                    <div class="mdui-mini-value">${xp}</div>
                    <div class="mdui-mini-label">Total XP</div>
                </div>
                <div class="mdui-mini-stat-card">
                    <div class="mdui-mini-icon" style="background:#f0fdf4;color:#22c55e;">
                        <i class="fa-solid fa-plane-arrival"></i>
                    </div>
                    <div class="mdui-mini-value">${flights}</div>
                    <div class="mdui-mini-label">Flights</div>
                </div>
                <div class="mdui-mini-stat-card">
                    <div class="mdui-mini-icon" style="background:#fff7ed;color:#f97316;">
                        <i class="fa-solid fa-clock"></i>
                    </div>
                    <div class="mdui-mini-value">${hours}h</div>
                    <div class="mdui-mini-label">Flight Time</div>
                </div>
                <div class="mdui-mini-stat-card">
                    <div class="mdui-mini-icon" style="background:#f0fdf4;color:#16a34a;">
                        <i class="fa-solid fa-circle-check"></i>
                    </div>
                    <div class="mdui-mini-value">${ldgs}</div>
                    <div class="mdui-mini-label">Landings</div>
                </div>
                <div class="mdui-mini-stat-card">
                    <div class="mdui-mini-icon" style="background:#fff1f2;color:#f43f5e;">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                    </div>
                    <div class="mdui-mini-value">${vios}</div>
                    <div class="mdui-mini-label">Violations</div>
                </div>`;
        }

        return `
            <div class="mdui-mini-stat-grid mdui-fade-up">
                ${statCardsHTML}
            </div>
            <div class="mdui-fade-up" style="animation-delay:0.1s;">
                ${CareerModule.getHTML(this._ifData)}
            </div>
        `;
    },

    // ── Airspace Intel ────────────────────────────────────────────────────────
    _tabAirspace() {
        return `
            <div class="mdui-airspace-add mdui-fade-up">
                <div class="mdui-input-wrap" style="flex:1;">
                    <i class="fa-solid fa-location-crosshairs mdui-input-icon"></i>
                    <input type="text" id="mdui-intel-input" class="mdui-input"
                        placeholder="ICAO e.g. EGLL" maxlength="4"
                        style="text-transform:uppercase;font-family:'JetBrains Mono',monospace;">
                </div>
                <button class="mdui-btn-primary" id="mdui-intel-add" style="white-space:nowrap;">
                    <i class="fa-solid fa-plus"></i> Monitor
                </button>
            </div>
            <div id="mdui-intel-nodes" class="mdui-fade-up" style="animation-delay:0.08s;">
                ${this._renderAirspaceNodes()}
            </div>
        `;
    },

    _renderAirspaceNodes() {
        if (!this._airspaceNetwork) return '';
        const report = this._airspaceNetwork.generateNetworkAnalytics();
        
        if (Object.keys(report.nodes).length === 0) {
            return `<div class="mdui-empty"><i class="fa-solid fa-satellite-dish"></i><span>No nodes monitored. Add an ICAO above.</span></div>`;
        }

        return Object.entries(report.nodes).map(([icao, data]) => {
            let maxSat = 'NORMAL';
            const statuses = data.arrivalQueue.map(b => b.status);
            if (statuses.includes('CRITICAL')) maxSat = 'CRITICAL';
            else if (statuses.includes('SATURATED')) maxSat = 'SATURATED';
            else if (statuses.includes('HEAVY')) maxSat = 'HEAVY';

            let statusColor = '#4ade80'; 
            let statusBg = 'rgba(34,197,94,0.12)';

            if (maxSat === 'CRITICAL') { 
                statusColor = '#f87171'; 
                statusBg = 'rgba(239,68,68,0.12)'; 
            } else if (maxSat === 'SATURATED') { 
                statusColor = '#f59e0b'; 
                statusBg = 'rgba(245,158,11,0.12)'; 
            } else if (maxSat === 'HEAVY') { 
                statusColor = '#fbbf24'; 
                statusBg = 'rgba(251,191,36,0.12)'; 
            }

            let firstHourInbound = 0;
            for(let i = 0; i < Math.min(4, data.arrivalQueue.length); i++) {
                firstHourInbound += data.arrivalQueue[i].count;
            }
            const firstHourCapacity = data.metrics.effectiveCapacity * 4;
            const loadPercentage = Math.min(100, Math.round((firstHourInbound / firstHourCapacity) * 100)) || 0;

            let heatmapHTML = '<div class="mdui-intel-heatmap">';
            data.arrivalQueue.forEach((bucket, idx) => {
                let blockColor = 'rgba(255,255,255,0.05)';
                if (bucket.status === 'CRITICAL') blockColor = '#f87171';
                else if (bucket.status === 'SATURATED') blockColor = '#f59e0b';
                else if (bucket.status === 'HEAVY') blockColor = '#fbbf24';
                else if (bucket.count > 0) blockColor = '#4ade80';
                
                heatmapHTML += `<div class="mdui-intel-heatblock" style="background: ${blockColor};"></div>`;
            });
            heatmapHTML += '</div>';

            let alertsHTML = '';
            if (data.metrics.highEnergyArrivals > 0) alertsHTML += `<span class="mdui-intel-alert warn"><i class="fa-solid fa-bolt"></i> ${data.metrics.highEnergyArrivals} HIGH ENG</span>`;
            if (data.metrics.heavyAircraftInbound > 0) alertsHTML += `<span class="mdui-intel-alert info"><i class="fa-solid fa-weight-hanging"></i> ${data.metrics.heavyAircraftInbound} HVY</span>`;
            if (data.metrics.holdingAircraftCount > 0) alertsHTML += `<span class="mdui-intel-alert danger"><i class="fa-solid fa-circle-notch fa-spin"></i> ${data.metrics.holdingAircraftCount} HOLD</span>`;

            return `
                <div class="mdui-node-card mdui-fade-up">
                    <div class="mdui-node-header">
                        <div>
                            <span class="mdui-node-icao">${icao}</span>
                            <span class="mdui-node-traffic">${data.metrics.totalInbound} Inbound · ${data.metrics.totalOutbound} Outbound</span>
                        </div>
                        <span class="mdui-node-badge" style="background:${statusBg};color:${statusColor};border:1px solid ${statusColor}40;">${maxSat}</span>
                    </div>
                    
                    <div class="mdui-node-load-row">
                        <span class="mdui-node-load-label">1-Hour Network Load</span>
                        <span class="mdui-node-load-pct" style="color:${statusColor};">${loadPercentage}%</span>
                    </div>
                    <div class="mdui-node-bar-track">
                        <div class="mdui-node-bar-fill" style="width:${loadPercentage}%;background:${statusColor};"></div>
                    </div>

                    ${alertsHTML ? `<div class="mdui-intel-alerts-row">${alertsHTML}</div>` : ''}

                    <div class="mdui-node-heatmap-label">4-Hour Saturation Map (CAP: ${data.metrics.effectiveCapacity}/15m)</div>
                    ${heatmapHTML}

                    <button class="mdui-node-remove" data-icao="${icao}" aria-label="Unlink ${icao}">
                        <i class="fa-solid fa-link-slash"></i> Unlink Node
                    </button>
                </div>`;
        }).join('');
    },

    _updateAirspaceDOM() {
        const el = document.getElementById('mdui-intel-nodes');
        if (el) el.innerHTML = this._renderAirspaceNodes();
        this._bindNodeRemoveButtons();
    },

    _bindNodeRemoveButtons() {
        document.querySelectorAll('.mdui-node-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                const icao  = btn.dataset.icao;
                const nodes = Array.from(this._airspaceNetwork._activeNodes).filter(n => n !== icao);
                this._airspaceNetwork.setActiveNodes(nodes);
                this._updateAirspaceDOM();
            });
        });
    },

    // ── Flight Dispatch ───────────────────────────────────────────────────────
    _tabDispatch() {
        let ticketsHTML = '';
        if (this._flightPlansData?.length > 0) {
            ticketsHTML = this._flightPlansData.map((f, i) => {
                const dateStr = new Date(f.dep_time).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
                const timeStr = new Date(f.dep_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const hours   = Math.floor(f.duration_minutes / 60);
                const mins    = f.duration_minutes % 60;
                return `
                    <div class="mdui-premium-ticket mdui-fade-up" style="animation-delay:${i * 0.04}s;">
                        <div class="mdui-pt-header">
                            <div class="mdui-pt-date">${dateStr} <span>${timeStr}</span></div>
                            <div class="mdui-pt-csign">${f.callsign || 'N/A'}</div>
                        </div>
                        <div class="mdui-pt-body">
                            <div class="mdui-pt-point">
                                <span class="icao">${f.dep_icao || '----'}</span>
                                <span class="gate">${f.dep_gate ? 'Gate ' + f.dep_gate : 'TBD'}</span>
                            </div>
                            <div class="mdui-pt-path">
                                <span class="duration">${hours}h ${mins}m</span>
                                <div class="line"><i class="fa-solid fa-plane"></i></div>
                                <span class="acft">${f.aircraft_type || 'UNK'}</span>
                            </div>
                            <div class="mdui-pt-point">
                                <span class="icao">${f.arr_icao || '----'}</span>
                                <span class="gate">${f.arr_gate ? 'Gate ' + f.arr_gate : 'TBD'}</span>
                            </div>
                        </div>
                        <div class="mdui-pt-footer">
                            <div title="Passengers"><i class="fa-solid fa-users"></i> ${f.passengers || '--'}</div>
                            <div title="Fuel"><i class="fa-solid fa-gas-pump"></i> ${f.fuel_used ? f.fuel_used.toLocaleString() + ' lbs' : '--'}</div>
                        </div>
                    </div>`;
            }).join('');
        } else {
            ticketsHTML = `
                <div class="mdui-empty mdui-fade-up">
                    <i class="fa-solid fa-clipboard-list"></i>
                    <span>No flights in your schedule yet.</span>
                </div>`;
        }

        return `
            <button class="mdui-btn-primary mdui-fade-up" id="mdui-toggle-form" style="width:100%; margin-bottom:16px;">
                <i class="fa-solid fa-file-pen"></i> File New Flight Plan
            </button>

            <div id="mdui-flight-form" class="mdui-form-sheet" style="display:none;">
                <div class="mdui-form-title"><i class="fa-solid fa-paper-plane"></i> Dispatch Briefing</div>

                <div class="mdui-form-section-title">Flight Ident</div>
                <div class="mdui-form-row">
                    <div class="mdui-input-group">
                        <div class="mdui-label">Callsign</div>
                        <div class="mdui-input-wrap">
                            <i class="fa-solid fa-tower-broadcast mdui-input-icon"></i>
                            <input type="text" id="mdui-new-callsign" class="mdui-input" placeholder="DAL404">
                        </div>
                    </div>
                    <div class="mdui-input-group">
                        <div class="mdui-label">Aircraft</div>
                        <div class="mdui-input-wrap">
                            <i class="fa-solid fa-plane mdui-input-icon"></i>
                            <input type="text" id="mdui-new-aircraft" class="mdui-input" placeholder="B763">
                        </div>
                    </div>
                </div>

                <div class="mdui-form-section-title">Routing</div>
                <div class="mdui-form-row">
                    <div class="mdui-input-group">
                        <div class="mdui-label">Origin</div>
                        <div class="mdui-input-wrap">
                            <i class="fa-solid fa-plane-departure mdui-input-icon"></i>
                            <input type="text" id="mdui-new-dep" class="mdui-input" placeholder="KJFK" maxlength="4"
                                style="text-transform:uppercase;font-family:'JetBrains Mono',monospace;">
                        </div>
                    </div>
                    <div class="mdui-input-group">
                        <div class="mdui-label">Destination</div>
                        <div class="mdui-input-wrap">
                            <i class="fa-solid fa-plane-arrival mdui-input-icon"></i>
                            <input type="text" id="mdui-new-arr" class="mdui-input" placeholder="EGLL" maxlength="4"
                                style="text-transform:uppercase;font-family:'JetBrains Mono',monospace;">
                        </div>
                    </div>
                </div>
                <div class="mdui-form-row">
                    <div class="mdui-input-group">
                        <div class="mdui-label">Dep Gate</div>
                        <input type="text" id="mdui-new-dep-gate" class="mdui-input" placeholder="B24">
                    </div>
                    <div class="mdui-input-group">
                        <div class="mdui-label">Arr Gate</div>
                        <input type="text" id="mdui-new-arr-gate" class="mdui-input" placeholder="501">
                    </div>
                </div>

                <div class="mdui-form-section-title">Schedule & Load</div>
                <div class="mdui-input-group" style="margin-bottom: 12px;">
                    <div class="mdui-label">Departure Time</div>
                    <input type="datetime-local" id="mdui-new-time" class="mdui-input">
                </div>
                <div class="mdui-form-row">
                    <div class="mdui-input-group">
                        <div class="mdui-label">EET (mins)</div>
                        <input type="number" id="mdui-new-duration" class="mdui-input" placeholder="420">
                    </div>
                    <div class="mdui-input-group">
                        <div class="mdui-label">POB (pax)</div>
                        <input type="number" id="mdui-new-pax" class="mdui-input" placeholder="212">
                    </div>
                </div>
                <div class="mdui-input-group" style="margin-bottom: 12px;">
                    <div class="mdui-label">Block Fuel (lbs)</div>
                    <div class="mdui-input-wrap">
                        <i class="fa-solid fa-gas-pump mdui-input-icon"></i>
                        <input type="number" id="mdui-new-fuel" class="mdui-input" placeholder="85000">
                    </div>
                </div>

                <div id="mdui-flight-msg" class="mdui-alert" style="display:none; margin-bottom:12px;"></div>

                <div class="mdui-form-row">
                    <button class="mdui-btn-secondary" id="mdui-cancel-form" style="flex:1;">Cancel</button>
                    <button class="mdui-btn-primary"   id="mdui-submit-flight" style="flex:2;">
                        <i class="fa-solid fa-paper-plane"></i> File Plan
                    </button>
                </div>
            </div>

            <div class="mdui-section-label">Scheduled Flights (${this._flightPlansData.length})</div>
            ${ticketsHTML}
        `;
    },

    // ── Settings ──────────────────────────────────────────────────────────────
    _tabSettings() {
        const user       = this._currentUser;
        const name       = user?.user_metadata?.full_name || user?.user_metadata?.name || '';
        const email      = user?.email || '';
        const ifUsername = user?.user_metadata?.if_username || '';

        return `
            <div class="mdui-settings-group mdui-fade-up">
                <div class="mdui-settings-group-title">Profile</div>
                <div class="mdui-card">
                    <div class="mdui-input-group">
                        <div class="mdui-label">Full Name</div>
                        <div class="mdui-input-wrap">
                            <i class="fa-solid fa-user mdui-input-icon"></i>
                            <input type="text" id="mdui-edit-name" class="mdui-input" value="${name}">
                        </div>
                    </div>
                    <div class="mdui-input-group">
                        <div class="mdui-label">Email</div>
                        <div class="mdui-input-wrap">
                            <i class="fa-solid fa-envelope mdui-input-icon"></i>
                            <input type="email" class="mdui-input" value="${email}" disabled style="opacity:0.5;cursor:not-allowed;">
                        </div>
                        <p class="mdui-help">Email cannot be changed directly.</p>
                    </div>
                    <div class="mdui-input-group">
                        <div class="mdui-label">Infinite Flight Username</div>
                        <div class="mdui-input-wrap">
                            <i class="fa-solid fa-plane mdui-input-icon"></i>
                            <input type="text" id="mdui-edit-if" class="mdui-input" value="${ifUsername}" placeholder="Community Forum Name">
                        </div>
                        <p class="mdui-help">Links your account for live stats and logbook.</p>
                    </div>
                    <div class="mdui-input-group">
                        <div class="mdui-label">New Password</div>
                        <div class="mdui-input-wrap">
                            <i class="fa-solid fa-lock mdui-input-icon"></i>
                            <input type="password" id="mdui-edit-pw" class="mdui-input" placeholder="Leave blank to keep current">
                        </div>
                    </div>
                    <div id="mdui-settings-msg" class="mdui-alert" style="display:none; margin-bottom:12px;"></div>
                    <button class="mdui-btn-primary" id="mdui-save-btn" style="width:100%;">Save Changes</button>
                </div>
            </div>

            <div class="mdui-settings-group mdui-fade-up" style="animation-delay:0.07s;">
                <div class="mdui-settings-group-title">Theme</div>
                <div class="mdui-card">
                    <div class="mdui-theme-grid">
                        ${[['white','Light (White)'],['light-gray','Light (Gray)'],['dark-gray','Dark Gray']].map(([val, lbl]) => `
                        <label class="mdui-theme-opt ${this._theme === val ? 'selected' : ''}">
                            <input type="radio" name="mdui-theme" value="${val}" ${this._theme === val ? 'checked' : ''} style="display:none;">
                            <div class="mdui-theme-swatch mdui-swatch-${val}"></div>
                            <span>${lbl}</span>
                        </label>`).join('')}
                    </div>
                    <p class="mdui-help" style="margin-top:10px;">Theme applies instantly. Save to sync across devices.</p>
                </div>
            </div>

            <div class="mdui-settings-group mdui-fade-up" style="animation-delay:0.12s;">
                <div class="mdui-settings-group-title">Billing</div>
                <div class="mdui-card">
                    <div class="mdui-plan-header-row">
                        <div>
                            <div class="mdui-plan-name">${this._subscription.plan}</div>
                            <div class="mdui-plan-price">${this._subscription.price}</div>
                        </div>
                        <span class="mdui-badge ${this._subscription.status === 'Active' ? 'mdui-badge-green' : 'mdui-badge-red'}">
                            ${this._subscription.status}
                        </span>
                    </div>
                    <div class="mdui-plan-renewal">Next payment: ${this._subscription.nextPayment}</div>
                    <div id="mdui-billing-msg" class="mdui-alert" style="display:none; margin:12px 0 0;"></div>
                    <div style="display:flex;flex-direction:column;gap:10px;margin-top:16px;">
                        <button class="mdui-btn-secondary" id="mdui-billing-update">
                            <i class="fa-solid fa-credit-card"></i> Update Payment Method
                        </button>
                        <button class="mdui-btn-danger" id="mdui-billing-cancel">
                            <i class="fa-solid fa-ban"></i> Cancel Subscription
                        </button>
                    </div>
                </div>
            </div>

            <div class="mdui-settings-group mdui-fade-up" style="animation-delay:0.16s; padding-bottom: 8px;">
                <button class="mdui-btn-danger" id="mdui-signout" style="width:100%;">
                    <i class="fa-solid fa-right-from-bracket"></i> Sign Out
                </button>
            </div>
        `;
    },

    // ─── Live Flight Banner ───────────────────────────────────────────────────

    _updateLiveBanner() {
        const banner = document.getElementById('mdui-live-banner');
        if (!banner) return;

        if (!this._liveFlights.length) {
            banner.innerHTML = '';
            return;
        }

        const f = this._liveFlights[0];
        const props = f.properties || f;
        const alt   = props.altitude   ? Math.round(props.altitude).toLocaleString() : '—';
        const spd   = props.speed      ? Math.round(props.speed) : '—';
        const hdg   = props.heading    ? Math.round(props.heading) : '—';
        const dep   = props.departureIcao || '----';
        const arr   = props.arrivalIcao   || '----';
        const acft  = props.aircraft?.aircraftName || 'Unknown Aircraft';

        let imageUrl = null;
        if (typeof window.getLiveFlightData === 'function') {
            const mapFlights = window.getLiveFlightData();
            const mapFlight  = mapFlights.find(mf => mf.properties?.flightId === (f.flightId || props.flightId));
            if (mapFlight?.properties?.communityImageUrl) {
                imageUrl = mapFlight.properties.communityImageUrl;
            }
        }

        banner.innerHTML = `
            <div class="mdui-premium-flight-card mdui-fade-up">
                ${imageUrl ? `<div class="mdui-pfc-bg" style="background-image:url('${imageUrl}')"></div>` : `<div class="mdui-pfc-bg fallback"></div>`}
                <div class="mdui-pfc-overlay"></div>
                <div class="mdui-pfc-content">
                    <div class="mdui-pfc-top">
                        <div class="mdui-pfc-route">
                            <span class="mdui-pfc-icao">${dep}</span>
                            <i class="fa-solid fa-plane mdui-pfc-route-icon"></i>
                            <span class="mdui-pfc-icao">${arr}</span>
                        </div>
                        <div class="mdui-pfc-ident">
                            <span class="mdui-pfc-acft">${acft}</span>
                            <span class="mdui-pfc-cs">${props.callsign || props.username || '—'}</span>
                        </div>
                    </div>
                    <div class="mdui-pfc-spacer"></div>
                    <div class="mdui-pfc-stats-glass">
                        <div class="mdui-pfc-stat">
                            <span class="label">Altitude</span>
                            <span class="value">${alt} <em>ft</em></span>
                        </div>
                        <div class="mdui-pfc-stat">
                            <span class="label">Ground Spd</span>
                            <span class="value">${spd} <em>kt</em></span>
                        </div>
                        <div class="mdui-pfc-stat">
                            <span class="label">Heading</span>
                            <span class="value">${hdg}<em>°</em></span>
                        </div>
                    </div>
                </div>
            </div>`;
    },

    // ─── Listeners ────────────────────────────────────────────────────────────

    _attachListeners() {
        document.getElementById('mdui-close')?.addEventListener('click', () => this.close());
        document.getElementById('mdui-goto-dispatch')?.addEventListener('click', () => this.switchTab('flight-plan'));

        if (this._activeTab === 'onboarding') {
            document.querySelectorAll('input[name="onb-theme"]').forEach(r => {
                r.addEventListener('change', e => {
                    const overlay = document.getElementById('mdui-shell');
                    if (overlay) overlay.setAttribute('data-theme', e.target.value);
                    this._theme = e.target.value;
                });
            });
            document.getElementById('mdui-onb-complete')?.addEventListener('click', async () => {
                const ifUsername    = document.getElementById('mdui-onb-username')?.value.trim();
                const selectedTheme = document.querySelector('input[name="onb-theme"]:checked')?.value || 'dark-gray';
                const btn           = document.getElementById('mdui-onb-complete');
                if (btn) { btn.disabled = true; btn.textContent = 'Setting up…'; }
                try {
                    const { data, error } = await this._supabase.auth.updateUser({
                        data: { if_username: ifUsername, theme: selectedTheme, onboarding_complete: true },
                    });
                    if (error) throw error;
                    this._currentUser = data.user;
                    this._theme       = selectedTheme;
                    if (ifUsername) this._fetchInfiniteFlightData(ifUsername);
                    this._activeTab = 'dashboard';
                    this._render();
                } catch (err) {
                    alert('Setup failed: ' + err.message);
                    if (btn) { btn.disabled = false; btn.textContent = 'Complete Setup'; }
                }
            });
        }

        if (this._activeTab === 'airspace-intel') {
            document.getElementById('mdui-intel-add')?.addEventListener('click', () => {
                const input = document.getElementById('mdui-intel-input');
                const icao  = input?.value.trim().toUpperCase();
                if (icao?.length >= 3 && this._airspaceNetwork) {
                    if (!this._airspaceNetwork._hubRegistry?.has(icao)) {
                        this._airspaceNetwork.registerNode(icao, 0, 0);
                    }
                    const nodes = Array.from(this._airspaceNetwork._activeNodes);
                    if (!nodes.includes(icao)) {
                        this._airspaceNetwork.setActiveNodes([...nodes, icao]);
                        if (input) input.value = '';
                        this._updateAirspaceDOM();
                    }
                }
            });
            document.getElementById('mdui-intel-input')?.addEventListener('keydown', e => {
                if (e.key === 'Enter') document.getElementById('mdui-intel-add')?.click();
            });
            this._bindNodeRemoveButtons();
        }

        if (this._activeTab === 'flight-plan') {
            const form = document.getElementById('mdui-flight-form');

            document.getElementById('mdui-toggle-form')?.addEventListener('click', () => {
                if (!form) return;
                const isHidden = form.style.display === 'none';
                form.style.display = isHidden ? 'block' : 'none';
                if (isHidden) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
            document.getElementById('mdui-cancel-form')?.addEventListener('click', () => {
                if (form) form.style.display = 'none';
            });
            document.getElementById('mdui-submit-flight')?.addEventListener('click', async () => {
                const callsign = document.getElementById('mdui-new-callsign')?.value.trim();
                const aircraft = document.getElementById('mdui-new-aircraft')?.value.trim();
                const depIcao  = document.getElementById('mdui-new-dep')?.value.trim().toUpperCase();
                const arrIcao  = document.getElementById('mdui-new-arr')?.value.trim().toUpperCase();
                const duration = parseInt(document.getElementById('mdui-new-duration')?.value);
                const depTime  = document.getElementById('mdui-new-time')?.value;
                const depGate  = document.getElementById('mdui-new-dep-gate')?.value.trim();
                const arrGate  = document.getElementById('mdui-new-arr-gate')?.value.trim();
                const pax      = parseInt(document.getElementById('mdui-new-pax')?.value) || null;
                const fuel     = parseInt(document.getElementById('mdui-new-fuel')?.value) || null;
                const msgDiv   = document.getElementById('mdui-flight-msg');
                const btn      = document.getElementById('mdui-submit-flight');

                if (!callsign || !depIcao || !arrIcao || !depTime || isNaN(duration)) {
                    if (msgDiv) { msgDiv.textContent = 'Please fill in all required fields.'; msgDiv.className = 'mdui-alert mdui-alert-error'; msgDiv.style.display = 'block'; }
                    return;
                }

                if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Filing…'; }

                try {
                    const { error } = await this._supabase.from('user_flights').insert([{
                        user_id: this._currentUser.id,
                        callsign, aircraft_type: aircraft,
                        dep_icao: depIcao, arr_icao: arrIcao,
                        dep_gate: depGate || null, arr_gate: arrGate || null,
                        dep_time: new Date(depTime).toISOString(),
                        duration_minutes: duration,
                        passengers: pax, fuel_used: fuel,
                    }]);
                    if (error) throw error;
                    if (msgDiv) { msgDiv.textContent = 'Flight plan filed!'; msgDiv.className = 'mdui-alert mdui-alert-success'; msgDiv.style.display = 'block'; }
                    await this._fetchFlightPlans();
                    setTimeout(() => { if (form) form.style.display = 'none'; this._render(); }, 1200);
                } catch (err) {
                    if (msgDiv) { msgDiv.textContent = err.message || 'Failed to file plan.'; msgDiv.className = 'mdui-alert mdui-alert-error'; msgDiv.style.display = 'block'; }
                    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> File Plan'; }
                }
            });
        }

        if (this._activeTab === 'settings') {
            document.querySelectorAll('input[name="mdui-theme"]').forEach(r => {
                r.addEventListener('change', e => {
                    this._theme = e.target.value;
                    const shell = document.getElementById('mdui-shell');
                    if (shell) shell.setAttribute('data-theme', this._theme);
                    document.querySelectorAll('.mdui-theme-opt').forEach(o => o.classList.remove('selected'));
                    r.closest('.mdui-theme-opt')?.classList.add('selected');
                });
            });

            document.getElementById('mdui-save-btn')?.addEventListener('click', async () => {
                const newName       = document.getElementById('mdui-edit-name')?.value.trim();
                const newIfUsername = document.getElementById('mdui-edit-if')?.value.trim();
                const newPassword   = document.getElementById('mdui-edit-pw')?.value;
                const btn           = document.getElementById('mdui-save-btn');
                const msgDiv        = document.getElementById('mdui-settings-msg');

                const updates = { data: { full_name: newName, name: newName, if_username: newIfUsername, theme: this._theme } };
                if (newPassword) updates.password = newPassword;

                if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving…'; }

                try {
                    const { data, error } = await this._supabase.auth.updateUser(updates);
                    if (error) throw error;
                    this._currentUser = data.user;
                    if (newIfUsername) this._fetchInfiniteFlightData(newIfUsername);
                    if (msgDiv) { msgDiv.textContent = 'Settings saved!'; msgDiv.className = 'mdui-alert mdui-alert-success'; msgDiv.style.display = 'block'; }
                    setTimeout(() => { if (msgDiv) msgDiv.style.display = 'none'; if (btn) { btn.disabled = false; btn.textContent = 'Save Changes'; } }, 3000);
                } catch (err) {
                    if (msgDiv) { msgDiv.textContent = err.message || 'Failed to save.'; msgDiv.className = 'mdui-alert mdui-alert-error'; msgDiv.style.display = 'block'; }
                    if (btn) { btn.disabled = false; btn.textContent = 'Save Changes'; }
                }
            });

            document.getElementById('mdui-billing-cancel')?.addEventListener('click', async () => {
                if (!confirm('Cancel your Pro Access subscription? This cannot be undone.')) return;
                const btn    = document.getElementById('mdui-billing-cancel');
                const msgDiv = document.getElementById('mdui-billing-msg');
                if (btn) { btn.disabled = true; btn.textContent = 'Processing…'; }
                try {
                    const { error } = await this._supabase.from('subscriptions')
                        .update({ status: 'canceled' }).eq('user_id', this._currentUser.id);
                    if (error) throw error;
                    this._subscription.status = 'Canceled';
                    this._render();
                    setTimeout(() => {
                        const m = document.getElementById('mdui-billing-msg');
                        if (m) { m.textContent = 'Subscription canceled.'; m.className = 'mdui-alert mdui-alert-success'; m.style.display = 'block'; }
                    }, 50);
                } catch (err) {
                    if (msgDiv) { msgDiv.textContent = 'Unable to cancel. Contact support.'; msgDiv.className = 'mdui-alert mdui-alert-error'; msgDiv.style.display = 'block'; }
                    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-ban"></i> Cancel Subscription'; }
                }
            });

            document.getElementById('mdui-signout')?.addEventListener('click', async () => {
                if (this._supabase) { await this._supabase.auth.signOut(); this.close(); }
            });
        }
    },

    // ─── Styles ───────────────────────────────────────────────────────────────

    _injectStyles() {
        if (document.getElementById('mdui-styles')) return;

        const css = `
            @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap');

            /* ── Shell & Theme Variables ──────────────────────────────────────── */
            #mdui-shell {
                --mdui-bg:        #08090d;
                --mdui-surface:   #0f1117;
                --mdui-card:      #16191f;
                --mdui-border:    rgba(255,255,255,0.07);
                --mdui-text:      #e2e8f0;
                --mdui-muted:     #4a5568;
                --mdui-accent:    #38bdf8;
                --mdui-accent-dim:rgba(56,189,248,0.12);
                --mdui-danger:    #f43f5e;
                --mdui-success:   #22c55e;
                --mdui-warn:      #f59e0b;
                --mdui-tab-h:     64px;
                --mdui-top-h:     56px;
                --mdui-radius:    16px;

                position: fixed;
                inset: 0;
                z-index: 9998;
                background: var(--mdui-bg);
                display: flex;
                flex-direction: column;
                font-family: 'DM Sans', system-ui, sans-serif;
                color: var(--mdui-text);

                transform: translateY(100%);
                transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            }
            #mdui-shell.mdui-open { transform: translateY(0); }

            /* Essential Structural Fix for Scrolling */
            #mdui-screen {
                display: flex;
                flex-direction: column;
                flex: 1;
                min-height: 0;
                overflow: hidden;
                position: relative;
            }

            /* Light themes */
            #mdui-shell[data-theme="white"] {
                --mdui-bg:      #f0f4fa;
                --mdui-surface: #ffffff;
                --mdui-card:    #f7f9fc;
                --mdui-border:  rgba(0,0,0,0.08);
                --mdui-text:    #0f1d32;
                --mdui-muted:   #6b7fa3;
                --mdui-accent:  #0099d4;
                --mdui-accent-dim: rgba(0,153,212,0.1);
            }
            #mdui-shell[data-theme="light-gray"] {
                --mdui-bg:      #e4eaf3;
                --mdui-surface: #eef2f9;
                --mdui-card:    #f5f7fb;
                --mdui-border:  rgba(0,0,0,0.09);
                --mdui-text:    #1a2a42;
                --mdui-muted:   #5d7498;
                --mdui-accent:  #0099d4;
                --mdui-accent-dim: rgba(0,153,212,0.1);
            }

            /* ── Top Bar ──────────────────────────────────────────────────────── */
            .mdui-top-bar {
                height: var(--mdui-top-h);
                min-height: var(--mdui-top-h);
                background: var(--mdui-surface);
                border-bottom: 1px solid var(--mdui-border);
                display: flex;
                align-items: center;
                padding: 0 16px;
                gap: 12px;
                flex-shrink: 0;
                z-index: 10;
            }
            .mdui-avatar {
                width: 34px; height: 34px;
                background: var(--mdui-accent-dim);
                border: 1px solid var(--mdui-accent);
                border-radius: 50%;
                display: flex; align-items: center; justify-content: center;
                font-size: 0.7rem; font-weight: 800;
                color: var(--mdui-accent);
                flex-shrink: 0;
            }
            .mdui-top-title {
                font-weight: 800;
                font-size: 1rem;
                flex: 1;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .mdui-close-btn {
                width: 34px; height: 34px;
                border: none; border-radius: 50%;
                background: var(--mdui-border);
                color: var(--mdui-muted);
                display: flex; align-items: center; justify-content: center;
                font-size: 1rem; cursor: pointer; flex-shrink: 0;
                transition: background 0.2s, color 0.2s;
            }
            .mdui-close-btn:hover { background: var(--mdui-accent-dim); color: var(--mdui-accent); }

            /* ── Scrollable Content ───────────────────────────────────────────── */
            .mdui-content {
                flex: 1;
                overflow-y: auto;
                min-height: 0;
                padding: 16px 16px calc(var(--mdui-tab-h) + env(safe-area-inset-bottom) + 16px);
                -webkit-overflow-scrolling: touch;
                scrollbar-width: none;
            }
            .mdui-content::-webkit-scrollbar { display: none; }

            /* ── Bottom Tab Bar ───────────────────────────────────────────────── */
            #mdui-tabbar {
                position: absolute;
                bottom: 0; left: 0; right: 0;
                height: calc(var(--mdui-tab-h) + env(safe-area-inset-bottom));
                padding-bottom: env(safe-area-inset-bottom);
                background: var(--mdui-surface);
                border-top: 1px solid var(--mdui-border);
                display: flex;
                z-index: 9999;
            }
            .mdui-tab-btn {
                flex: 1;
                display: flex; flex-direction: column;
                align-items: center; justify-content: center;
                gap: 4px;
                border: none; background: none;
                color: var(--mdui-muted);
                font-size: 0.6rem; font-weight: 700;
                letter-spacing: 0.04em;
                text-transform: uppercase;
                cursor: pointer;
                transition: color 0.2s;
                -webkit-tap-highlight-color: transparent;
            }
            .mdui-tab-btn i { font-size: 1.05rem; transition: color 0.2s, transform 0.2s; }
            .mdui-tab-btn.active { color: var(--mdui-accent); }
            .mdui-tab-btn.active i { transform: translateY(-1px); }

            /* ── Cards & Sections ─────────────────────────────────────────────── */
            .mdui-card {
                background: var(--mdui-card);
                border: 1px solid var(--mdui-border);
                border-radius: var(--mdui-radius);
                padding: 16px;
                margin-bottom: 12px;
            }
            .mdui-section-label {
                font-size: 0.65rem;
                font-weight: 900;
                color: var(--mdui-muted);
                text-transform: uppercase;
                letter-spacing: 0.1em;
                margin-bottom: 8px;
                padding: 0 2px;
            }

            /* ── Alerts ───────────────────────────────────────────────────────── */
            .mdui-alert {
                padding: 12px 14px;
                border-radius: 10px;
                font-size: 0.82rem;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .mdui-alert-error   { background: rgba(244,63,94,0.12);  color: #f87171; border: 1px solid rgba(244,63,94,0.2); }
            .mdui-alert-success { background: rgba(34,197,94,0.12);  color: #4ade80; border: 1px solid rgba(34,197,94,0.2); }
            .mdui-alert-warn    { background: rgba(245,158,11,0.12); color: #fbbf24; border: 1px solid rgba(245,158,11,0.2); }

            /* ── Inputs ───────────────────────────────────────────────────────── */
            .mdui-input-wrap {
                position: relative;
                display: flex;
                align-items: center;
            }
            .mdui-input-icon {
                position: absolute; left: 12px;
                color: var(--mdui-muted);
                font-size: 0.8rem;
                pointer-events: none;
            }
            .mdui-input {
                width: 100%;
                background: var(--mdui-bg);
                border: 1px solid var(--mdui-border);
                border-radius: 10px;
                color: var(--mdui-text);
                font-family: 'DM Sans', sans-serif;
                font-size: 0.9rem;
                padding: 11px 12px;
                outline: none;
                transition: border-color 0.2s;
                box-sizing: border-box;
            }
            .mdui-input-wrap .mdui-input { padding-left: 36px; }
            .mdui-input:focus { border-color: var(--mdui-accent); }
            .mdui-input-group { margin-bottom: 14px; }
            .mdui-label {
                font-size: 0.72rem;
                font-weight: 700;
                color: var(--mdui-muted);
                text-transform: uppercase;
                letter-spacing: 0.06em;
                margin-bottom: 6px;
            }
            .mdui-help {
                font-size: 0.72rem;
                color: var(--mdui-muted);
                margin-top: 5px;
                opacity: 0.75;
            }

            /* ── Buttons ──────────────────────────────────────────────────────── */
            .mdui-btn-primary, .mdui-btn-secondary, .mdui-btn-danger {
                display: flex; align-items: center; justify-content: center;
                gap: 8px;
                padding: 13px 20px;
                border-radius: 12px;
                font-family: 'DM Sans', sans-serif;
                font-size: 0.88rem; font-weight: 700;
                border: none; cursor: pointer;
                transition: opacity 0.2s, transform 0.1s;
                -webkit-tap-highlight-color: transparent;
            }
            .mdui-btn-primary:active, .mdui-btn-secondary:active, .mdui-btn-danger:active { transform: scale(0.97); }
            .mdui-btn-primary   { background: var(--mdui-accent); color: #000; }
            .mdui-btn-secondary { background: var(--mdui-card); color: var(--mdui-text); border: 1px solid var(--mdui-border); }
            .mdui-btn-danger    { background: rgba(244,63,94,0.12); color: var(--mdui-danger); border: 1px solid rgba(244,63,94,0.2); }
            .mdui-link-btn {
                display: flex; align-items: center; justify-content: space-between;
                width: 100%; border: none; background: none;
                color: var(--mdui-accent); font-family: 'DM Sans', sans-serif;
                font-size: 0.8rem; font-weight: 700; cursor: pointer;
                border-top: 1px solid var(--mdui-border);
                padding: 14px 0 0; margin-top: 12px;
                transition: opacity 0.2s;
            }
            .mdui-link-btn:hover { opacity: 0.7; }

            /* ── Animations ───────────────────────────────────────────────────── */
            @keyframes mdui-fade-up {
                from { opacity: 0; transform: translateY(12px); }
                to   { opacity: 1; transform: translateY(0); }
            }
            .mdui-fade-up { animation: mdui-fade-up 0.35s ease both; }

            /* ── Skeleton ─────────────────────────────────────────────────────── */
            @keyframes mdui-shimmer {
                0%   { background-position: -400px 0; }
                100% { background-position:  400px 0; }
            }
            .mdui-skel {
                background: linear-gradient(90deg, var(--mdui-card) 25%, rgba(255,255,255,0.06) 50%, var(--mdui-card) 75%);
                background-size: 400px 100%;
                animation: mdui-shimmer 1.4s infinite linear;
                border-radius: 6px;
            }

            /* ── Empty States ─────────────────────────────────────────────────── */
            .mdui-empty {
                display: flex; flex-direction: column;
                align-items: center; justify-content: center;
                gap: 8px; padding: 28px 0;
                color: var(--mdui-muted);
                font-size: 0.85rem; font-weight: 500;
                text-align: center;
            }
            .mdui-empty i { font-size: 1.6rem; opacity: 0.3; }
            .mdui-dot { opacity: 0.3; }

            /* ═══════════════════════════════════════════════════════════════════
               DASHBOARD TAB
            ═══════════════════════════════════════════════════════════════════ */
            .mdui-cc-greeting {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                margin-bottom: 16px;
            }
            .mdui-greeting-text {
                font-size: 1.05rem;
                font-weight: 700;
                color: var(--mdui-muted);
                margin: 0;
            }
            .mdui-greeting-name {
                font-size: 1.6rem;
                font-weight: 800;
                margin: 0 0 8px;
                color: var(--mdui-text);
                line-height: 1.1;
            }
            .mdui-greeting-date {
                font-size: 0.7rem;
                font-weight: 600;
                color: var(--mdui-muted);
                text-align: right;
                line-height: 1.4;
                max-width: 90px;
            }
            .mdui-stat-strip { display: flex; flex-wrap: wrap; gap: 6px; }
            .mdui-stat-pill {
                display: flex; align-items: center; gap: 5px;
                background: var(--mdui-accent-dim);
                color: var(--mdui-accent);
                font-size: 0.72rem; font-weight: 700;
                padding: 4px 10px; border-radius: 20px;
            }

            /* Premium Live Flight Card (Mobile Port) */
            .mdui-premium-flight-card {
                position: relative;
                height: 220px;
                border-radius: 20px;
                overflow: hidden;
                box-shadow: 0 10px 30px -10px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05);
                display: flex;
                flex-direction: column;
                margin-bottom: 16px;
                transform: translateZ(0);
            }
            .mdui-pfc-bg {
                position: absolute;
                inset: -5%;
                background-size: cover;
                background-position: center;
                transition: transform 12s ease;
                z-index: 1;
            }
            .mdui-pfc-bg.fallback {
                background: linear-gradient(135deg, var(--mdui-card), var(--mdui-bg));
            }
            .mdui-premium-flight-card:hover .mdui-pfc-bg { transform: scale(1.05); }
            .mdui-pfc-overlay {
                position: absolute;
                inset: 0;
                background: linear-gradient(to top, rgba(7,12,22,0.9) 0%, rgba(7,12,22,0.3) 50%, transparent 100%);
                z-index: 2;
                pointer-events: none;
            }
            .mdui-pfc-content {
                position: relative;
                z-index: 3;
                height: 100%;
                display: flex;
                flex-direction: column;
                padding: 16px;
            }
            .mdui-pfc-top {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
            }
            .mdui-pfc-route {
                display: flex;
                align-items: center;
                gap: 8px;
                background: rgba(10,15,25,0.45);
                backdrop-filter: blur(12px) saturate(140%);
                -webkit-backdrop-filter: blur(12px);
                padding: 6px 12px;
                border-radius: 16px;
                border: 1px solid rgba(255,255,255,0.1);
            }
            .mdui-pfc-icao {
                font-family: 'JetBrains Mono', monospace;
                font-size: 0.9rem;
                font-weight: 700;
                color: #fff;
            }
            .mdui-pfc-route-icon {
                color: #00c8ff;
                font-size: 0.65rem;
                filter: drop-shadow(0 0 4px rgba(0,200,255,0.4));
            }
            .mdui-pfc-ident {
                display: flex;
                flex-direction: column;
                align-items: flex-end;
            }
            .mdui-pfc-acft {
                font-size: 0.85rem;
                font-weight: 800;
                color: #fff;
                text-shadow: 0 2px 6px rgba(0,0,0,0.8);
            }
            .mdui-pfc-cs {
                font-family: 'JetBrains Mono', monospace;
                font-size: 0.75rem;
                color: #00c8ff;
                font-weight: 700;
                text-shadow: 0 2px 4px rgba(0,0,0,0.8);
            }
            .mdui-pfc-spacer { flex-grow: 1; }
            .mdui-pfc-stats-glass {
                background: linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01));
                backdrop-filter: blur(20px) saturate(120%);
                -webkit-backdrop-filter: blur(20px);
                border: 1px solid rgba(255,255,255,0.1);
                border-radius: 14px;
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                overflow: hidden;
            }
            .mdui-pfc-stat {
                display: flex;
                flex-direction: column;
                padding: 10px;
                border-right: 1px solid rgba(255,255,255,0.06);
                align-items: center;
            }
            .mdui-pfc-stat:last-child { border-right: none; }
            .mdui-pfc-stat .label {
                font-size: 0.55rem;
                font-weight: 800;
                text-transform: uppercase;
                letter-spacing: 0.1em;
                color: rgba(255,255,255,0.6);
            }
            .mdui-pfc-stat .value {
                font-size: 1.05rem;
                font-family: 'JetBrains Mono', monospace;
                font-weight: 700;
                color: #fff;
                display: flex;
                align-items: baseline;
                gap: 4px;
            }
            .mdui-pfc-stat .value em {
                font-style: normal;
                font-size: 0.6rem;
                color: rgba(255,255,255,0.5);
                font-weight: 600;
            }

            /* Next departure */
            .mdui-dispatch-mini { }
            .mdui-dispatch-route {
                display: flex; align-items: center;
                justify-content: space-between;
                padding-bottom: 12px;
                border-bottom: 1px solid var(--mdui-border);
                margin-bottom: 10px;
            }
            .mdui-dispatch-airport { display: flex; flex-direction: column; }
            .mdui-dispatch-icao {
                font-family: 'JetBrains Mono', monospace;
                font-size: 1.6rem; font-weight: 700;
                line-height: 1; color: var(--mdui-text);
            }
            .mdui-dispatch-gate {
                font-size: 0.65rem; color: var(--mdui-muted);
                font-weight: 600; margin-top: 3px;
            }
            .mdui-dispatch-center {
                display: flex; flex-direction: column;
                align-items: center; gap: 3px;
                color: var(--mdui-muted);
            }
            .mdui-dispatch-plane { color: var(--mdui-accent); font-size: 1rem; }
            .mdui-dispatch-dur   { font-size: 0.7rem; font-weight: 700; }
            .mdui-dispatch-meta-row {
                display: flex; align-items: center; gap: 6px;
                font-size: 0.78rem; font-weight: 600;
                color: var(--mdui-muted);
                flex-wrap: wrap;
            }

            /* Recent flights */
            .mdui-flight-row {
                display: flex; align-items: center;
                gap: 8px; padding: 11px 16px;
                border-bottom: 1px solid var(--mdui-border);
            }
            .mdui-flight-row:last-child { border-bottom: none; }
            .mdui-flight-route { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; }
            .mdui-icao {
                font-family: 'JetBrains Mono', monospace;
                font-size: 0.92rem; font-weight: 700;
                color: var(--mdui-text);
            }
            .mdui-arrow { color: var(--mdui-muted); font-size: 0.65rem; opacity: 0.5; }
            .mdui-flight-meta {
                display: flex; align-items: center; gap: 4px;
                font-size: 0.7rem; color: var(--mdui-muted);
                font-weight: 500; white-space: nowrap;
            }
            .mdui-flight-time {
                font-size: 0.66rem; font-weight: 600;
                color: var(--mdui-muted); opacity: 0.55;
                white-space: nowrap; flex-shrink: 0;
            }

            /* ═══════════════════════════════════════════════════════════════════
               CAREER TAB
            ═══════════════════════════════════════════════════════════════════ */
            .mdui-mini-stat-grid {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 10px;
                margin-bottom: 16px;
            }
            .mdui-mini-stat-card {
                background: var(--mdui-card);
                border: 1px solid var(--mdui-border);
                border-radius: 14px;
                padding: 14px 12px;
                display: flex; flex-direction: column;
                align-items: center; text-align: center; gap: 4px;
            }
            .mdui-mini-icon {
                width: 38px; height: 38px; border-radius: 10px;
                display: flex; align-items: center; justify-content: center;
                font-size: 0.9rem; margin-bottom: 4px;
            }
            .mdui-mini-value {
                font-size: 1rem; font-weight: 800;
                color: var(--mdui-text); line-height: 1;
            }
            .mdui-mini-label {
                font-size: 0.6rem; font-weight: 700;
                color: var(--mdui-muted); text-transform: uppercase;
                letter-spacing: 0.05em;
            }

            /* ═══════════════════════════════════════════════════════════════════
               AIRSPACE TAB
            ═══════════════════════════════════════════════════════════════════ */
            .mdui-airspace-add {
                display: flex; gap: 10px;
                margin-bottom: 16px;
            }
            .mdui-node-card {
                background: var(--mdui-card);
                border: 1px solid var(--mdui-border);
                border-radius: var(--mdui-radius);
                padding: 16px;
                margin-bottom: 12px;
            }
            .mdui-node-header {
                display: flex; justify-content: space-between;
                align-items: center; margin-bottom: 12px;
            }
            .mdui-node-icao {
                font-family: 'JetBrains Mono', monospace;
                font-size: 1.3rem; font-weight: 700;
                color: var(--mdui-text); display: block;
            }
            .mdui-node-traffic {
                font-size: 0.72rem; font-weight: 600;
                color: var(--mdui-muted); display: block;
            }
            .mdui-node-badge {
                padding: 4px 8px; border-radius: 6px;
                font-size: 0.65rem; font-weight: 800;
                text-transform: uppercase; letter-spacing: 0.05em;
            }
            .mdui-node-load-row {
                display: flex; justify-content: space-between;
                font-size: 0.75rem; font-weight: 600;
                color: var(--mdui-muted);
                margin-bottom: 6px;
            }
            .mdui-node-load-pct { font-weight: 800; font-family: 'JetBrains Mono', monospace; }
            .mdui-node-bar-track {
                background: rgba(255,255,255,0.06);
                border-radius: 10px; height: 6px; overflow: hidden;
                margin-bottom: 16px;
            }
            .mdui-node-bar-fill {
                height: 100%; border-radius: 10px;
                transition: width 0.6s ease;
            }
            .mdui-intel-alerts-row {
                display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px;
            }
            .mdui-intel-alert {
                padding: 4px 8px; border-radius: 6px; font-size: 0.65rem; font-weight: 800;
                letter-spacing: 0.05em; display: flex; align-items: center; gap: 4px;
            }
            .mdui-intel-alert.warn   { background: rgba(245,158,11,0.15); color: #f59e0b; border: 1px solid rgba(245,158,11,0.3); }
            .mdui-intel-alert.info   { background: rgba(59,130,246,0.15); color: #60a5fa; border: 1px solid rgba(59,130,246,0.3); }
            .mdui-intel-alert.danger { background: rgba(244,63,94,0.15);  color: #f43f5e; border: 1px solid rgba(244,63,94,0.3); }

            .mdui-node-heatmap-label {
                font-size: 0.65rem; font-weight: 800; color: var(--mdui-muted);
                text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px;
                display: flex; justify-content: space-between;
            }
            .mdui-intel-heatmap {
                display: flex; gap: 3px; height: 28px; border-radius: 6px;
                overflow: hidden; background: rgba(0,0,0,0.2); padding: 3px;
                margin-bottom: 16px;
            }
            .mdui-intel-heatblock { flex: 1; border-radius: 3px; }

            .mdui-node-remove {
                width: 100%; padding: 10px; border-radius: 10px;
                border: 1px solid var(--mdui-border); background: transparent;
                color: var(--mdui-muted); font-size: 0.8rem; font-weight: 700;
                cursor: pointer; transition: all 0.2s; display: flex;
                align-items: center; justify-content: center; gap: 8px;
            }
            .mdui-node-remove:hover { background: rgba(244,63,94,0.1); color: #f43f5e; border-color: rgba(244,63,94,0.3); }

            /* ═══════════════════════════════════════════════════════════════════
               FLIGHT DISPATCH TAB (Premium Ticket Port)
            ═══════════════════════════════════════════════════════════════════ */
            .mdui-form-sheet {
                background: var(--mdui-card);
                border: 1px solid var(--mdui-border);
                border-radius: var(--mdui-radius);
                padding: 16px;
                margin-bottom: 20px;
            }
            .mdui-form-title {
                font-size: 1rem; font-weight: 800;
                color: var(--mdui-text);
                margin-bottom: 16px;
                display: flex; align-items: center; gap: 8px;
            }
            .mdui-form-title i { color: var(--mdui-accent); }
            .mdui-form-section-title {
                font-size: 0.65rem; font-weight: 900;
                color: var(--mdui-muted); text-transform: uppercase;
                letter-spacing: 0.1em;
                margin: 14px 0 10px;
            }
            .mdui-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

            .mdui-premium-ticket {
                background: var(--mdui-card);
                border: 1px solid var(--mdui-border);
                border-radius: 16px;
                margin-bottom: 12px;
                overflow: hidden;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            }
            .mdui-pt-header {
                background: rgba(0,0,0,0.15);
                padding: 14px 16px;
                display: flex; justify-content: space-between; align-items: center;
                border-bottom: 2px dashed var(--mdui-border);
            }
            .mdui-pt-date {
                font-size: 0.65rem; font-weight: 700; color: var(--mdui-muted);
                text-transform: uppercase; letter-spacing: 0.05em;
            }
            .mdui-pt-date span {
                display: block; font-size: 1.05rem; font-family: 'JetBrains Mono', monospace;
                color: var(--mdui-text); margin-top: 2px;
            }
            .mdui-pt-csign {
                background: var(--mdui-accent-dim); color: var(--mdui-accent);
                padding: 4px 10px; border-radius: 8px; font-size: 0.8rem;
                font-weight: 700; font-family: 'JetBrains Mono', monospace;
            }
            .mdui-pt-body {
                padding: 16px; display: flex; align-items: center; justify-content: space-between;
            }
            .mdui-pt-point { display: flex; flex-direction: column; align-items: center; gap: 4px; }
            .mdui-pt-point .icao {
                font-family: 'JetBrains Mono', monospace; font-size: 1.6rem;
                font-weight: 700; color: var(--mdui-text); line-height: 1;
            }
            .mdui-pt-point .gate {
                font-size: 0.65rem; color: var(--mdui-muted); background: rgba(255,255,255,0.05);
                padding: 2px 6px; border-radius: 4px; font-weight: 600;
            }
            .mdui-pt-path {
                flex-grow: 1; display: flex; flex-direction: column; align-items: center;
                padding: 0 16px; position: relative;
            }
            .mdui-pt-path .duration { font-size: 0.7rem; color: var(--mdui-muted); font-weight: 600; margin-bottom: 4px; }
            .mdui-pt-path .line {
                width: 100%; height: 2px; background: linear-gradient(90deg, transparent, var(--mdui-accent), transparent);
                display: flex; justify-content: center; align-items: center; position: relative;
            }
            .mdui-pt-path .line i {
                position: absolute; color: var(--mdui-accent); font-size: 0.9rem;
                background: var(--mdui-card); padding: 0 6px;
            }
            .mdui-pt-path .acft {
                font-size: 0.7rem; color: var(--mdui-text); font-weight: 700;
                margin-top: 8px; letter-spacing: 0.05em;
            }
            .mdui-pt-footer {
                padding: 12px 16px; border-top: 1px solid var(--mdui-border);
                display: flex; justify-content: space-around; font-size: 0.75rem;
                color: var(--mdui-muted); font-weight: 600; background: rgba(0,0,0,0.05);
            }
            .mdui-pt-footer div { display: flex; align-items: center; gap: 6px; }
            .mdui-pt-footer i { color: var(--mdui-accent); font-size: 0.85rem; }

            /* ═══════════════════════════════════════════════════════════════════
               SETTINGS TAB
            ═══════════════════════════════════════════════════════════════════ */
            .mdui-settings-group { margin-bottom: 8px; }
            .mdui-settings-group-title {
                font-size: 0.65rem; font-weight: 900;
                color: var(--mdui-muted); text-transform: uppercase;
                letter-spacing: 0.1em;
                margin-bottom: 8px; padding: 0 2px;
            }
            .mdui-theme-grid {
                display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
            }
            .mdui-theme-opt {
                display: flex; flex-direction: column;
                align-items: center; gap: 7px;
                padding: 12px 8px;
                border-radius: 12px; cursor: pointer;
                border: 1px solid var(--mdui-border);
                background: var(--mdui-bg);
                transition: border-color 0.2s;
                font-size: 0.68rem; font-weight: 700;
                color: var(--mdui-muted); text-align: center;
            }
            .mdui-theme-opt.selected { border-color: var(--mdui-accent); color: var(--mdui-accent); }
            .mdui-theme-swatch {
                width: 36px; height: 36px; border-radius: 10px;
                border: 2px solid var(--mdui-border);
            }
            .mdui-swatch-white     { background: #f0f4fa; border-color: #d1d5db; }
            .mdui-swatch-light-gray{ background: #e4eaf3; border-color: #c0c8d8; }
            .mdui-swatch-dark-gray { background: linear-gradient(135deg, #070c16, #111d34); }
            .mdui-plan-header-row  {
                display: flex; justify-content: space-between;
                align-items: flex-start; margin-bottom: 4px;
            }
            .mdui-plan-name  { font-size: 1rem; font-weight: 800; color: var(--mdui-text); }
            .mdui-plan-price { font-size: 0.78rem; font-weight: 600; color: var(--mdui-muted); }
            .mdui-plan-renewal {
                font-size: 0.72rem; color: var(--mdui-muted);
                margin-top: 4px; margin-bottom: 0;
            }
            .mdui-badge {
                font-size: 0.65rem; font-weight: 800;
                padding: 3px 10px; border-radius: 20px;
                text-transform: uppercase; letter-spacing: 0.06em;
            }
            .mdui-badge-green { background: rgba(34,197,94,0.15); color: #4ade80; }
            .mdui-badge-red   { background: rgba(244,63,94,0.15); color: #f87171; }
            .mdui-pill-row {
                display: flex; gap: 10px;
            }
            .mdui-radio-pill {
                flex: 1; padding: 12px;
                border-radius: 12px; cursor: pointer;
                border: 1px solid var(--mdui-border);
                background: var(--mdui-bg);
                display: flex; align-items: center; justify-content: center;
                font-size: 0.88rem; font-weight: 700;
                color: var(--mdui-muted); text-align: center;
                transition: border-color 0.2s, color 0.2s;
            }
            .mdui-radio-pill:has(input:checked) {
                border-color: var(--mdui-accent); color: var(--mdui-accent);
                background: var(--mdui-accent-dim);
            }

            /* ═══════════════════════════════════════════════════════════════════
               ONBOARDING
            ═══════════════════════════════════════════════════════════════════ */
            .mdui-onboarding { padding: 20px 0; }
            .mdui-onb-icon {
                font-size: 2.8rem; color: var(--mdui-accent);
                text-align: center; margin-bottom: 12px;
            }
            .mdui-onb-title {
                font-size: 1.6rem; font-weight: 800;
                text-align: center; margin: 0 0 6px;
                color: var(--mdui-text);
            }
            .mdui-onb-sub {
                text-align: center; color: var(--mdui-muted);
                font-size: 0.88rem; margin: 0;
            }
        `;

        const style       = document.createElement('style');
        style.id          = 'mdui-styles';
        style.textContent = css;
        document.head.appendChild(style);
    },
};