/**
 * ProfileUI — Premium Dashboard Interface
 * Handles massive data displays with a sidebar tab system.
 * Includes functional Account Settings, Theme Customization, Billing Management, Flight Planning,
 * a modular Career Deep Dive integrated with live Infinite Flight API data,
 * a live Multi-Node Airspace Intelligence Hub, and a Premium Onboarding Experience.
 */

import { CareerModule } from './careerModule.js';
import { PredictiveAirspaceNetwork } from './PredictiveQueueManager.js';
import { socketDataHub } from './SocketDataHub.js';

export const ProfileUI = {
    _supabase: null,
    _isOpen: false,
    _injected: false,
    _activeTab: 'dashboard', 
    _currentUser: null,
    _theme: 'white',
    _flightPlansData: [],
    
    // Premium Telemetry Integration
    _airspaceNetwork: null,
    _airspaceRefreshTimer: null,
    _liveFlights: [],
    _socketUnsubscribe: null,

    _subscription: {
        status: 'Active',
        plan: 'Pro Access',
        nextPayment: 'Upcoming',
        price: '$1.00 / month'
    },
    // Store live IF data
    _ifData: {
        loading: false,
        userId: null, 
        stats: null,
        logbook: [],
        logbookTotal: 0,
        activeHistory: null,
        error: null
    },
    _backendUrl: window.APP_CONFIG?.backendUrl || 'https://site--acars-backend--6dmjph8ltlhv.code.run',

    init(supabaseClient) {
        this._supabase = supabaseClient;
        
        this._supabase.auth.onAuthStateChange((event, session) => {
            if (session?.user) {
                this._currentUser = session.user;
            } else {
                this._currentUser = null;
            }

            if (event === 'USER_UPDATED' && session?.user) {
                if (session.user.user_metadata?.theme) {
                    this.setTheme(session.user.user_metadata.theme, false);
                }
                
                if (this._isOpen) {
                    const ifUsername = session.user.user_metadata?.if_username;
                    if (ifUsername) this._fetchInfiniteFlightData(ifUsername);
                    this._render();
                }
            }
        });

        if (!this._socketUnsubscribe) {
            this._socketUnsubscribe = socketDataHub.subscribe('all_flights_update', (payload) => {
                const ifUsername = this._currentUser?.user_metadata?.if_username;
                if (!ifUsername || !payload || !payload.flights) return;

                const myFlights = payload.flights.filter(f => f.username?.toLowerCase() === ifUsername.toLowerCase());
                
                // Only update DOM if there's a live flight or the state changed
                const previouslyHadFlights = this._liveFlights.length > 0;
                this._liveFlights = myFlights;
                
                if (this._isOpen && this._activeTab === 'dashboard') {
                    if (this._liveFlights.length > 0 || previouslyHadFlights) {
                        this._updateLiveFlightDOM();
                    }
                }
            });
        }
    },

    open(user) {
        this._currentUser = user;
        
        // Intercept new users for the Quick Setup Process
        const needsOnboarding = !user?.user_metadata?.onboarding_complete;
        this._activeTab = needsOnboarding ? 'onboarding' : 'dashboard';
        
        const savedTheme = user?.user_metadata?.theme || localStorage.getItem('pui-theme') || 'white';
        this.setTheme(savedTheme, false);
        
        if (!this._injected) {
            this._inject();
            this._injected = true;
        }

        if (!this._airspaceNetwork) {
            this._airspaceNetwork = new PredictiveAirspaceNetwork();
            this._airspaceNetwork.bindTelemetryStream();
            this._airspaceNetwork.setActiveNodes(['KJFK', 'EGLL', 'KLAX', 'OMDB']);
        }

        const overlay = document.getElementById('profile-overlay');
        if (overlay) {
            overlay.setAttribute('data-theme', this._theme);
        }
        
        this._render();
        this._fetchSubscriptionData();
        this._fetchFlightPlans();

        const ifUsername = user?.user_metadata?.if_username;
        if (ifUsername) {
            this._fetchInfiniteFlightData(ifUsername);
        }
        
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                document.getElementById('profile-overlay')?.classList.add('pui-open');
                this._isOpen = true;
                document.body.style.overflow = 'hidden'; 
            });
        });
    },

    close() {
        document.getElementById('profile-overlay')?.classList.remove('pui-open');
        this._isOpen = false;
        document.body.style.overflow = ''; 
        
        if (this._airspaceRefreshTimer) {
            clearInterval(this._airspaceRefreshTimer);
            this._airspaceRefreshTimer = null;
        }

        setTimeout(() => {
            // Only reset to dashboard if they completed onboarding
            if (this._currentUser?.user_metadata?.onboarding_complete) {
                this._activeTab = 'dashboard';
            }
        }, 300);
    },

    switchTab(tabId) {
        if (this._activeTab === tabId) return;

        this._activeTab = tabId;
        this._render();

        if (this._airspaceRefreshTimer) {
            clearInterval(this._airspaceRefreshTimer);
            this._airspaceRefreshTimer = null;
        }
        
        if (this._activeTab === 'airspace-intel') {
            this._airspaceRefreshTimer = setInterval(() => {
                if (this._isOpen && this._activeTab === 'airspace-intel') {
                    this._updateAirspaceDOM();
                }
            }, 8000); 
        }
    },

    setTheme(themeName, saveToLocal = true) {
        this._theme = themeName;
        if (saveToLocal) {
            localStorage.setItem('pui-theme', themeName);
        }
        const overlay = document.getElementById('profile-overlay');
        if (overlay) {
            overlay.setAttribute('data-theme', themeName);
        }
    },

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
                    status: data.status === 'active' ? 'Active' : 'Inactive',
                    plan: data.plan_name || 'Pro Access',
                    nextPayment: isNaN(nextDate) ? 'Pending' : nextDate.toLocaleDateString(),
                    price: `$${(data.amount / 100).toFixed(2)} / month`
                };
                
                if (this._activeTab === 'settings' && this._isOpen) {
                    this._render();
                }
            }
        } catch (err) {
            console.warn("Using default subscription data.");
        }
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
            
            if (this._activeTab === 'flight-plan' && this._isOpen) {
                this._render();
            }
        } catch (err) {
            console.error("Error fetching flight plans:", err.message);
        }
    },

    async _fetchInfiniteFlightData(ifUsername) {
        if (!ifUsername) return;
        
        this._ifData.loading = true;
        this._ifData.error = null;
        if (this._isOpen && (this._activeTab === 'dashboard' || this._activeTab === 'career-deep-dive')) this._render();
        
        try {
            let ifUserId = null;
            let activeFlightId = null;

            if (typeof window.getLiveFlightData === 'function') {
                const liveFlights = window.getLiveFlightData();
                const activeFlight = liveFlights.find(f => 
                    f.properties && 
                    f.properties.username && 
                    f.properties.username.toLowerCase() === ifUsername.toLowerCase()
                );
                
                if (activeFlight) {
                    activeFlightId = activeFlight.properties.flightId;
                    ifUserId = activeFlight.properties.userId; 
                }
            }
            
            if (!ifUserId) {
                const userRes = await fetch(`${this._backendUrl}/users`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        discourseNames: [ifUsername],
                        userHashes: [ifUsername]
                    })
                });
                
                const userData = await userRes.json();
                ifUserId = userData?.users?.[0]?.userId;
            }
            
            if (!ifUserId) throw new Error('Could not find an Infinite Flight account with that username.');

            this._ifData.userId = ifUserId; 

            const requests = [
                fetch(`${this._backendUrl}/api/users/${ifUserId}/stats`).then(res => res.json()),
                fetch(`${this._backendUrl}/api/users/${ifUserId}/flights?page=1`).then(res => res.json())
            ];

            if (activeFlightId) {
                requests.push(
                    fetch(`${this._backendUrl}/api/flights/${activeFlightId}/history`)
                        .then(res => res.json())
                        .catch(() => null)
                );
            }
            
            const results = await Promise.all(requests);
            const statsData = results[0];
            const flightsData = results[1];
            const historyData = results[2];
            
            this._ifData.stats = statsData.ok ? statsData.stats : null;
            this._ifData.logbook = flightsData.ok ? flightsData.flights : [];
            this._ifData.logbookTotal = flightsData.ok ? flightsData.totalCount : 0;
            
            if (historyData && historyData.ok) {
                this._ifData.activeHistory = historyData.path;
            }

            this._ifData.loading = false;

        } catch (err) {
            console.error("Failed to fetch IF data:", err);
            this._ifData.error = err.message;
            this._ifData.loading = false;
        }
        
        if (this._isOpen && (this._activeTab === 'dashboard' || this._activeTab === 'career-deep-dive')) {
            this._render();
        }
    },

    _inject() {
        const el = document.createElement('div');
        el.id = 'profile-overlay';
        el.className = 'pui-wrapper-layer';
        el.setAttribute('data-theme', this._theme);
        el.innerHTML = `<div class="pui-dashboard-container" id="pui-dashboard-container"></div>`;
        document.body.appendChild(el);

        el.addEventListener('click', (e) => {
            if (e.target === el) this.close();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this._isOpen) this.close();
        });

        this._injectStyles();
    },

    _render() {
        const container = document.getElementById('pui-dashboard-container');
        if (!container) return;

        container.setAttribute('data-active-tab', this._activeTab);
        container.innerHTML = `
            <button class="pui-close-btn" id="pui-close-global" aria-label="Close Dashboard"><i class="fa-solid fa-xmark"></i></button>
            ${this._activeTab !== 'onboarding' ? this._getSidebarHTML() : ''}
            <div class="pui-main-content">
                ${this._getTabContentHTML()}
            </div>
        `;

        if (this._activeTab === 'dashboard') {
            this._updateLiveFlightDOM();
        }

        this._attachListeners();
    },

    _getSidebarHTML() {
        const user = this._currentUser;
        const name = user?.user_metadata?.full_name || user?.user_metadata?.name || 'Captain';
        const initials = name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);

        const navItems = [
            { id: 'dashboard',       icon: 'fa-solid fa-table-cells-large',   label: 'Command Center' },
            { id: 'career-deep-dive',icon: 'fa-solid fa-id-card-clip',        label: 'Pilot Dossier'  },
            { id: 'airspace-intel',  icon: 'fa-solid fa-satellite-dish',      label: 'Airspace Radar' },
            { id: 'flight-plan',     icon: 'fa-solid fa-route',               label: 'Flight Dispatch'},
            { id: 'settings',        icon: 'fa-solid fa-sliders',             label: 'Settings'       },
        ];

        return `
            <div class="pui-sidebar">
                <div class="pui-sidebar-avatar">
                    <div class="pui-avatar">${initials}</div>
                    <div class="pui-avatar-tooltip">
                        <span class="pui-avatar-name">${name}</span>
                        <span class="pui-avatar-plan"><i class="fa-solid fa-crown"></i> ${this._subscription.plan}</span>
                    </div>
                </div>

                <nav class="pui-nav-menu">
                    ${navItems.map(item => `
                        <button class="pui-nav-item ${this._activeTab === item.id ? 'active' : ''}" data-tab="${item.id}" title="${item.label}">
                            <i class="${item.icon}"></i>
                            <span class="pui-nav-label">${item.label}</span>
                        </button>
                    `).join('')}
                </nav>

                <div class="pui-sidebar-footer">
                    <button class="pui-signout-btn" id="pui-sidebar-signout" title="Sign Out">
                        <i class="fa-solid fa-arrow-right-from-bracket"></i>
                        <span class="pui-nav-label">Sign Out</span>
                    </button>
                </div>
            </div>
        `;
    },
    
_updateLiveFlightDOM() {
        const wrapper = document.getElementById('pui-live-flights-wrapper');
        if (!wrapper) return;

        if (!this._liveFlights || this._liveFlights.length === 0) {
            wrapper.innerHTML = '';
            wrapper.style.display = 'none';
            return;
        }

        wrapper.style.display = 'block';

        const cardsHtml = this._liveFlights.map(flight => {
            const alt = Math.round(flight.position.alt_ft).toLocaleString();
            const gs  = Math.round(flight.position.gs_kt);
            const hdg = String(Math.round(flight.position.heading_deg)).padStart(3, '0');
            const vs  = Math.round(flight.position.vs_fpm);
            const dep = flight.departureIcao || '----';
            const arr = flight.arrivalIcao   || '----';
            const cs  = flight.callsign      || 'UNK';
            const acft = flight.aircraft?.aircraftName || 'Unknown Aircraft';

            const vsColor = vs > 100 ? '#4ade80' : (vs < -100 ? '#f87171' : 'rgba(255,255,255,0.5)');
            const vsSign  = vs > 0 ? '+' : '';

            let imageUrl = null;
            let imageCredit = '';
            if (typeof window.getLiveFlightData === 'function') {
                const mapFlights = window.getLiveFlightData();
                const mapFlight  = mapFlights.find(f => f.properties?.flightId === flight.flightId);
                if (mapFlight?.properties?.communityImageUrl) {
                    imageUrl    = mapFlight.properties.communityImageUrl;
                    imageCredit = mapFlight.properties.contributorName || '';
                }
            }

            return `
                <div class="pui-premium-flight-card">
                    ${imageUrl ? `<div class="pui-pfc-bg" style="background-image:url('${imageUrl}')"></div>` : `<div class="pui-pfc-bg" style="background: linear-gradient(135deg, var(--pui-bg-card), var(--pui-bg-base));"></div>`}
                    <div class="pui-pfc-overlay"></div>
                    <div class="pui-pfc-content">
                        
                        <div class="pui-pfc-top">
                            <div class="pui-pfc-top-route">
                                <span class="pui-pfc-icao">${dep}</span>
                                <i class="fa-solid fa-plane pui-pfc-route-icon"></i>
                                <span class="pui-pfc-icao">${arr}</span>
                            </div>
                            <div class="pui-pfc-ident">
                                <span class="pui-pfc-acft">${acft}</span>
                                <span class="pui-pfc-cs">${cs}</span>
                            </div>
                        </div>

                        <div class="pui-pfc-spacer"></div>

                        <div class="pui-pfc-stats-glass">
                            <div class="pui-pfc-stat">
                                <span class="label">Altitude</span>
                                <span class="value">${alt} <em>ft</em></span>
                            </div>
                            <div class="pui-pfc-stat">
                                <span class="label">Ground Spd</span>
                                <span class="value">${gs} <em>kt</em></span>
                            </div>
                            <div class="pui-pfc-stat">
                                <span class="label">Heading</span>
                                <span class="value">${hdg}<em>°</em></span>
                            </div>
                            <div class="pui-pfc-stat">
                                <span class="label">Vert Spd</span>
                                <span class="value" style="color:${vsColor};">${vsSign}${vs} <em>fpm</em></span>
                            </div>
                        </div>

                        ${imageCredit ? `<div class="pui-pfc-credit">© ${imageCredit}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        wrapper.innerHTML = `<div class="pui-live-carousel">${cardsHtml}</div>`;
    },

    _generateAirspaceHTML() {
        if (!this._airspaceNetwork) return '';
        const report = this._airspaceNetwork.generateNetworkAnalytics();
        
        if (Object.keys(report.nodes).length === 0) {
             return `<div class="pui-alert pui-alert-error" style="max-width: 600px; margin: 40px auto; text-align: center;">
                        <i class="fa-solid fa-satellite" style="font-size: 2rem; margin-bottom: 12px; display: block; opacity: 0.5;"></i>
                        No active network nodes are being monitored. Register an ICAO hub above to begin tracking spatial telemetry.
                    </div>`;
        }

        let html = '<div class="pui-settings-grid" style="grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 20px;">';
        
        for (const [icao, data] of Object.entries(report.nodes)) {
            let maxSat = 'NORMAL';
            const statuses = data.arrivalQueue.map(b => b.status);
            if (statuses.includes('CRITICAL')) maxSat = 'CRITICAL';
            else if (statuses.includes('SATURATED')) maxSat = 'SATURATED';
            else if (statuses.includes('HEAVY')) maxSat = 'HEAVY';

            let statusColor = '#4ade80'; 
            let statusBg = 'rgba(34,197,94,0.12)';
            let statusIcon = 'fa-circle-check';
            let plainEnglishSummary = 'Traffic flow is optimal and unrestricted. No delays anticipated.';

            if (maxSat === 'CRITICAL') { 
                statusColor = '#f87171'; 
                statusBg = 'rgba(239,68,68,0.12)'; 
                statusIcon = 'fa-triangle-exclamation';
                plainEnglishSummary = 'Severe congestion detected. Expect extended holding patterns and active metering.';
            } else if (maxSat === 'SATURATED') { 
                statusColor = '#f59e0b'; 
                statusBg = 'rgba(245,158,11,0.12)'; 
                statusIcon = 'fa-wave-square';
                plainEnglishSummary = 'Airspace is nearing maximum capacity. Minor delays and speed restrictions likely.';
            } else if (maxSat === 'HEAVY') { 
                statusColor = '#fbbf24'; 
                statusBg = 'rgba(251,191,36,0.12)'; 
                statusIcon = 'fa-chart-line';
                plainEnglishSummary = 'Traffic volume is high but flowing steadily. Standard terminal routing in effect.';
            }

            let firstHourInbound = 0;
            for(let i = 0; i < Math.min(4, data.arrivalQueue.length); i++) {
                firstHourInbound += data.arrivalQueue[i].count;
            }
            const firstHourCapacity = data.metrics.effectiveCapacity * 4;
            const loadPercentage = Math.min(100, Math.round((firstHourInbound / firstHourCapacity) * 100)) || 0;

            let heatmapHTML = '<div class="pui-intel-heatmap">';
            data.arrivalQueue.forEach((bucket, idx) => {
                let blockColor = 'rgba(255,255,255,0.05)';
                if (bucket.status === 'CRITICAL') blockColor = '#f87171';
                else if (bucket.status === 'SATURATED') blockColor = '#f59e0b';
                else if (bucket.status === 'HEAVY') blockColor = '#fbbf24';
                else if (bucket.count > 0) blockColor = '#4ade80';

                const timeLabel = `+${idx * 15}m`;
                
                let tooltipDetails = `${bucket.count} Inbound`;
                if (bucket.flights && bucket.flights.length > 0) {
                    const degraded = bucket.flights.filter(f => f.degradedTelemetry).length;
                    if(degraded > 0) tooltipDetails += `<br><span style="color:#f87171; font-weight: bold;">${degraded} Signal(s) Degraded</span>`;
                }

                heatmapHTML += `
                    <div class="pui-intel-heatblock" style="background: ${blockColor};" title="${timeLabel}: ${bucket.count} arrivals">
                        <span class="pui-heatblock-tooltip">${timeLabel}<br>${tooltipDetails}</span>
                    </div>`;
            });
            heatmapHTML += '</div>';

            let alertsHTML = '';
            if (data.metrics.highEnergyArrivals > 0) {
                alertsHTML += `<span style="background: rgba(245,158,11,0.15); color: #f59e0b; border: 1px solid rgba(245,158,11,0.3); padding: 4px 8px; border-radius: 6px; font-size: 0.65rem; margin-right: 6px; font-weight: bold; letter-spacing: 0.05em;"><i class="fa-solid fa-bolt" style="margin-right: 4px;"></i>${data.metrics.highEnergyArrivals} HIGH ENERGY</span>`;
            }
            if (data.metrics.heavyAircraftInbound > 0) {
                alertsHTML += `<span style="background: rgba(59,130,246,0.15); color: #60a5fa; border: 1px solid rgba(59,130,246,0.3); padding: 4px 8px; border-radius: 6px; font-size: 0.65rem; margin-right: 6px; font-weight: bold; letter-spacing: 0.05em;"><i class="fa-solid fa-weight-hanging" style="margin-right: 4px;"></i>${data.metrics.heavyAircraftInbound} HEAVY</span>`;
            }
            if (!data.hubControlState.isFullyControlled) {
                alertsHTML += `<span style="background: rgba(168,85,247,0.15); color: #c084fc; border: 1px solid rgba(168,85,247,0.3); padding: 4px 8px; border-radius: 6px; font-size: 0.65rem; font-weight: bold; letter-spacing: 0.05em;"><i class="fa-solid fa-tower-slash" style="margin-right: 4px;"></i>UNCONTROLLED</span>`;
            }

            let topOpsHTML = '';
            if (data.topOperators.arrivals && data.topOperators.arrivals.length > 0) {
                topOpsHTML = data.topOperators.arrivals.slice(0, 3).map(op => 
                    `<span style="font-size: 0.7rem; color: var(--pui-text-secondary); background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--pui-border-light); white-space: nowrap;">${op.name} (${op.count})</span>`
                ).join(' ');
            }

            const netFlowColor = data.metrics.netFlowDelta > 0 ? '#4ade80' : (data.metrics.netFlowDelta < 0 ? '#f87171' : 'var(--pui-text-primary)');
            const netFlowText = data.metrics.netFlowDelta > 0 ? `+${data.metrics.netFlowDelta}` : data.metrics.netFlowDelta;

            html += `
                <div class="pui-content-card">
                    <div class="pui-card-header" style="justify-content: space-between; border-bottom: 1px solid var(--pui-border-light);">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <i class="fa-solid fa-tower-observation" style="color: var(--pui-text-secondary);"></i>
                            <h3 style="font-family: 'JetBrains Mono', monospace; font-size: 1.3rem; letter-spacing: 0.05em; margin: 0;">${icao}</h3>
                        </div>
                        <span class="pui-status-badge" style="background: ${statusBg}; color: ${statusColor}; border: 1px solid ${statusColor}40;">${maxSat}</span>
                    </div>
                    <div class="pui-card-body">
                        
                        <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--pui-border-light); border-radius: 10px; padding: 14px; margin-bottom: 16px; display: flex; align-items: flex-start; gap: 14px;">
                            <div style="color: ${statusColor}; font-size: 1.2rem; margin-top: 2px;">
                                <i class="fa-solid ${statusIcon}"></i>
                            </div>
                            <div>
                                <strong style="color: var(--pui-text-primary); font-size: 0.85rem; display: block; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.05em;">Network Assessment</strong>
                                <span style="color: var(--pui-text-secondary); font-size: 0.85rem; line-height: 1.4;">${plainEnglishSummary}</span>
                            </div>
                        </div>

                        <div style="margin-bottom: 20px;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                                <span style="font-size: 0.72rem; color: var(--pui-text-secondary); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">1-Hour Load</span>
                                <span style="font-size: 0.72rem; font-family: 'JetBrains Mono', monospace; color: var(--pui-text-primary);">${loadPercentage}%</span>
                            </div>
                            <div style="height: 6px; background: rgba(0,0,0,0.3); border-radius: 3px; overflow: hidden;">
                                <div style="height: 100%; width: ${loadPercentage}%; background: ${statusColor}; transition: width 0.4s ease;"></div>
                            </div>
                        </div>

                        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 12px; background: rgba(0,0,0,0.15); padding: 12px; border-radius: 12px; border: 1px solid var(--pui-border-light);">
                            <div class="pui-intel-stat">
                                <span class="label">INBOUND</span>
                                <span class="value">${data.metrics.totalInbound}</span>
                            </div>
                            <div class="pui-intel-stat">
                                <span class="label">OUTBOUND</span>
                                <span class="value">${data.metrics.totalOutbound}</span>
                            </div>
                            <div class="pui-intel-stat">
                                <span class="label">NET FLOW</span>
                                <span class="value" style="color: ${netFlowColor};">${netFlowText}</span>
                            </div>
                            <div class="pui-intel-stat" style="text-align: right;">
                                <span class="label">METERED</span>
                                <span class="value" style="${data.metrics.meteredAircraftCount > 0 ? 'color: #60a5fa;' : ''}">${data.metrics.meteredAircraftCount}</span>
                            </div>
                        </div>

                        <div style="display: flex; justify-content: space-between; margin-bottom: 16px; padding: 0 4px;">
                            <div class="pui-intel-stat">
                                <span class="label">IN TMA</span>
                                <span class="value" style="font-size: 1.1rem;">${data.metrics.inTerminalArea}</span>
                            </div>
                            <div class="pui-intel-stat" style="text-align: center;">
                                <span class="label">HOLDING</span>
                                <span class="value" style="font-size: 1.1rem; ${data.metrics.holdingAircraftCount > 0 ? 'color: #f87171;' : ''}">${data.metrics.holdingAircraftCount}</span>
                            </div>
                            <div class="pui-intel-stat" style="text-align: right;">
                                <span class="label">ON FINAL</span>
                                <span class="value" style="font-size: 1.1rem; ${data.metrics.onFinalApproach > 0 ? 'color: #4ade80;' : ''}">${data.metrics.onFinalApproach}</span>
                            </div>
                        </div>

                        ${alertsHTML ? `<div style="margin-bottom: 16px; display: flex; flex-wrap: wrap; gap: 4px;">${alertsHTML}</div>` : '<div style="margin-bottom: 16px; height: 18px;"></div>'}
                        
                        <div style="margin-bottom: 10px; display: flex; justify-content: space-between; align-items: flex-end;">
                            <span style="font-size: 0.72rem; color: var(--pui-text-secondary); font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;">4-Hour Saturation Map</span>
                            <div style="text-align: right;">
                                <span style="font-size: 0.68rem; color: var(--pui-text-secondary); font-family: 'JetBrains Mono', monospace;">CAP: ${data.metrics.effectiveCapacity}/15m</span>
                            </div>
                        </div>
                        ${heatmapHTML}
                        
                        ${topOpsHTML ? `<div style="margin-top: 14px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center;"><span style="font-size: 0.65rem; font-weight: 700; color: var(--pui-text-secondary); text-transform: uppercase;">Top Arrivals:</span> ${topOpsHTML}</div>` : ''}

                        <div style="margin-top: 20px; display: flex; justify-content: flex-end;">
                            <button class="pui-btn-secondary pui-intel-remove-btn" data-icao="${icao}" style="padding: 6px 14px; font-size: 0.75rem; border-color: rgba(255,255,255,0.1);">
                                <i class="fa-solid fa-link-slash"></i> Unlink Node
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }
        html += '</div>';
        return html;
    },
    
    _updateAirspaceDOM() {
        const container = document.getElementById('pui-intel-dynamic-container');
        if (container && this._airspaceNetwork) {
            container.innerHTML = this._generateAirspaceHTML();
            
            container.querySelectorAll('.pui-intel-remove-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const icao = e.currentTarget.dataset.icao;
                    const currentNodes = Array.from(this._airspaceNetwork._activeNodes).filter(n => n !== icao);
                    this._airspaceNetwork.setActiveNodes(currentNodes);
                    this._updateAirspaceDOM(); 
                });
            });
        }
    },

    _getTabContentHTML() {
        if (this._activeTab === 'onboarding') {
            return `
                <div class="pui-onboarding-container pui-fade-in-up">
                    <div class="pui-onboarding-card">
                        <div class="pui-onboarding-header">
                            <i class="fa-solid fa-plane-departure" style="font-size: 2.5rem; color: var(--pui-accent); margin-bottom: 16px;"></i>
                            <h2>Welcome Aboard!</h2>
                            <p>Thank you for subscribing to Pro Access. Let's get your flight deck set up.</p>
                        </div>
                        <div class="pui-onboarding-body">
                            
                            <div class="pui-input-group">
                                <label>Choose Your Theme</label>
                                <div class="pui-theme-options" style="flex-direction: row; gap: 10px;">
                                    <label class="pui-theme-option" style="flex: 1; justify-content: center;">
                                        <input type="radio" name="onboarding-theme" value="white" ${this._theme === 'white' ? 'checked' : ''}>
                                        <span>Light (White)</span>
                                    </label>
                                    <label class="pui-theme-option" style="flex: 1; justify-content: center;">
                                        <input type="radio" name="onboarding-theme" value="dark-gray" ${this._theme === 'dark-gray' ? 'checked' : ''}>
                                        <span>Dark Gray</span>
                                    </label>
                                </div>
                            </div>

                            <div class="pui-input-group" style="margin-top: 24px;">
                                <label>Infinite Flight Username</label>
                                <div class="pui-input-wrapper">
                                    <i class="fa-solid fa-plane pui-input-icon"></i>
                                    <input type="text" id="onboarding-if-username" class="pui-input has-icon" placeholder="Community Forum Name">
                                </div>
                                <p class="pui-help-text">We use this to fetch your live flights and career stats.</p>
                            </div>

                            <p class="pui-help-text" style="text-align: center; margin-top: 24px; font-size: 0.8rem;">
                                Note: You can always change these preferences later in the Settings area.
                            </p>

                            <button class="pui-btn-primary" id="onboarding-complete-btn" style="width: 100%; margin-top: 16px; padding: 14px; font-size: 1rem;">
                                Complete Setup
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }

        if (this._activeTab === 'airspace-intel') {
            return `
                <div class="pui-tab-header pui-fade-in-up" style="display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 16px;">
                    <div>
                        <h2>Traffic</h2>
                        <p>Real-time predictive multi-node telemetry. Forecasting congestion across active hubs.</p>
                    </div>
                    <div style="display: flex; gap: 12px; align-items: stretch;">
                        <div class="pui-input-wrapper" style="width: 160px;">
                            <i class="fa-solid fa-location-crosshairs pui-input-icon"></i>
                            <input type="text" id="pui-intel-new-node" class="pui-input has-icon" placeholder="ICAO" style="text-transform: uppercase; font-family: 'JetBrains Mono', monospace;" maxlength="4">
                        </div>
                        <button class="pui-btn-primary" id="pui-intel-add-node" style="white-space: nowrap;">
                            <i class="fa-solid fa-satellite-dish" style="margin-right: 6px;"></i> Monitor Hub
                        </button>
                    </div>
                </div>
                <div id="pui-intel-dynamic-container" class="pui-fade-in-up" style="animation-delay: 0.1s;">
                    ${this._generateAirspaceHTML()}
                </div>
            `;
        }

        if (this._activeTab === 'career-deep-dive') {
            const user = this._currentUser;
            const ifUsername = user?.user_metadata?.if_username || '';
            let statCardsHTML = '';
            
            if (!ifUsername) {
                statCardsHTML = `<div class="pui-alert pui-alert-error" style="grid-column: 1 / -1;"><i class="fa-solid fa-triangle-exclamation" style="margin-right: 8px;"></i> Link your Infinite Flight account in Settings to view your live career statistics.</div>`;
            } else if (this._ifData.loading) {
                statCardsHTML = `
                    <div class="pui-stat-card"><div class="pui-skeleton" style="width: 56px; height: 56px; border-radius: 16px;"></div><div class="pui-stat-data"><div class="pui-skeleton" style="width: 60px; height: 24px; margin-bottom: 8px;"></div><div class="pui-skeleton" style="width: 100px; height: 12px;"></div></div></div>
                    <div class="pui-stat-card"><div class="pui-skeleton" style="width: 56px; height: 56px; border-radius: 16px;"></div><div class="pui-stat-data"><div class="pui-skeleton" style="width: 80px; height: 24px; margin-bottom: 8px;"></div><div class="pui-skeleton" style="width: 90px; height: 12px;"></div></div></div>
                    <div class="pui-stat-card"><div class="pui-skeleton" style="width: 56px; height: 56px; border-radius: 16px;"></div><div class="pui-stat-data"><div class="pui-skeleton" style="width: 50px; height: 24px; margin-bottom: 8px;"></div><div class="pui-skeleton" style="width: 110px; height: 12px;"></div></div></div>
                `;
            } else if (this._ifData.error) {
                statCardsHTML = `<div class="pui-alert pui-alert-error" style="grid-column: 1 / -1;"><i class="fa-solid fa-circle-xmark" style="margin-right: 8px;"></i> ${this._ifData.error}</div>`;
            } else if (this._ifData.stats) {
                const grade = this._ifData.stats.gradeDetails?.gradeIndex || 'N/A';
                const xp = this._ifData.stats.totalXP?.toLocaleString() || '0';
                const totalFlights = this._ifData.logbookTotal?.toLocaleString() || '0';
                
                statCardsHTML = `
                    <div class="pui-stat-card">
                        <div class="pui-stat-icon" style="background: #eff6ff; color: #3b82f6;">
                            <i class="fa-solid fa-award"></i>
                        </div>
                        <div class="pui-stat-data">
                            <h3>Grade ${grade}</h3>
                            <p>Pilot Level</p>
                        </div>
                    </div>
                    <div class="pui-stat-card">
                        <div class="pui-stat-icon" style="background: #fdf4ff; color: #d946ef;">
                            <i class="fa-solid fa-star"></i>
                        </div>
                        <div class="pui-stat-data">
                            <h3>${xp}</h3>
                            <p>Total XP</p>
                        </div>
                    </div>
                    <div class="pui-stat-card">
                        <div class="pui-stat-icon" style="background: #f0fdf4; color: #22c55e;">
                            <i class="fa-solid fa-plane-arrival"></i>
                        </div>
                        <div class="pui-stat-data">
                            <h3>${totalFlights}</h3>
                            <p>Flights Flown</p>
                        </div>
                    </div>
                `;
            }

            return `
                <div class="pui-tab-header pui-fade-in-up">
                    <h2>Pilot Dossier</h2>
                    <p>Comprehensive career analytics and high-level flight statistics.</p>
                </div>
                <div class="pui-stats-grid pui-fade-in-up" style="margin-bottom: 24px;">
                    ${statCardsHTML}
                </div>
                <div class="pui-fade-in-up" style="animation-delay: 0.1s;">
                    ${CareerModule.getHTML(this._ifData)}
                </div>
            `;
        }

        if (this._activeTab === 'dashboard') {
            const user = this._currentUser;
            const name = user?.user_metadata?.full_name || user?.user_metadata?.name || 'Captain';
            const firstName = name.trim().split(/\s+/)[0];
            const ifUsername = user?.user_metadata?.if_username || '';

            // Greeting
            const hour = new Date().getHours();
            const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
            const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

            // Stat strip
            let statsStrip = '';
            if (this._ifData.stats) {
                const grade   = this._ifData.stats.gradeDetails?.gradeIndex;
                const xp      = this._ifData.stats.totalXP?.toLocaleString();
                const flights = this._ifData.logbookTotal?.toLocaleString();
                statsStrip = `<div class="pui-cc-stat-strip">
                    ${grade   ? `<span>Grade ${grade}</span><span class="pui-cc-sep">·</span>` : ''}
                    ${xp      ? `<span>${xp} XP</span><span class="pui-cc-sep">·</span>` : ''}
                    ${flights ? `<span>${flights} flights</span>` : ''}
                </div>`;
            } else if (this._ifData.loading) {
                statsStrip = `<div class="pui-cc-stat-strip" style="opacity:0.35;">Loading pilot data…</div>`;
            }

            // Recent flights
            let recentFlightsHTML = '';
            if (!ifUsername) {
                recentFlightsHTML = `<div class="pui-cc-empty">Link your Infinite Flight account in Settings to see recent activity.</div>`;
            } else if (this._ifData.loading) {
                recentFlightsHTML = `
                    <div class="pui-cc-flight-row"><div class="pui-skeleton" style="width:120px;height:14px;border-radius:4px;flex:1;"></div><div class="pui-skeleton" style="width:60px;height:10px;border-radius:4px;"></div></div>
                    <div class="pui-cc-flight-row"><div class="pui-skeleton" style="width:100px;height:14px;border-radius:4px;flex:1;"></div><div class="pui-skeleton" style="width:50px;height:10px;border-radius:4px;"></div></div>
                    <div class="pui-cc-flight-row"><div class="pui-skeleton" style="width:130px;height:14px;border-radius:4px;flex:1;"></div><div class="pui-skeleton" style="width:55px;height:10px;border-radius:4px;"></div></div>
                `;
            } else if (this._ifData.logbook?.length > 0) {
                recentFlightsHTML = this._ifData.logbook.slice(0, 6).map((flight, i) => {
                    const dep    = flight.originAirport      || 'N/A';
                    const arr    = flight.destinationAirport || 'N/A';
                    const hrs    = (flight.totalTime / 60).toFixed(1);
                    const server = flight.server || 'Unknown';
                    const dateObj = new Date(flight.created);
                    const isRecent = (Date.now() - dateObj.getTime()) < (86400000 * 2);
                    const timeStr  = isRecent ? 'Recently' : dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    return `
                        <div class="pui-cc-flight-row pui-fade-in-up" style="animation-delay:${i * 0.04}s;">
                            <div class="pui-cc-flight-row-route">
                                <span class="pui-cc-flight-icao">${dep}</span>
                                <span class="pui-cc-flight-arrow">→</span>
                                <span class="pui-cc-flight-icao">${arr}</span>
                            </div>
                            <div class="pui-cc-flight-row-meta">
                                <span>${flight.callsign || 'N/A'}</span>
                                <span>·</span>
                                <span>${server}</span>
                                <span>·</span>
                                <span>${hrs}h</span>
                            </div>
                            <div class="pui-cc-flight-row-time">${timeStr}</div>
                        </div>`;
                }).join('');
            } else {
                recentFlightsHTML = `<div class="pui-cc-empty">No recent flights found.</div>`;
            }

            // Next departure from flight plans
            let nextDispatch = '';
            if (this._flightPlansData?.length > 0) {
                const next   = this._flightPlansData[0];
                const depTime = new Date(next.dep_time);
                const diffMs  = depTime - Date.now();
                const diffH   = Math.floor(diffMs / 3600000);
                const diffM   = Math.floor((diffMs % 3600000) / 60000);
                const countdown = diffMs > 0 ? (diffH > 0 ? `In ${diffH}h ${diffM}m` : `In ${diffM}m`) : 'Departed';
                const hours = Math.floor(next.duration_minutes / 60);
                const mins  = next.duration_minutes % 60;
                nextDispatch = `
                    <div class="pui-cc-dispatch-route">
                        <div class="pui-cc-dispatch-icao">
                            <span class="code">${next.dep_icao || '----'}</span>
                            ${next.dep_gate ? `<span class="gate">Gate ${next.dep_gate}</span>` : ''}
                        </div>
                        <div class="pui-cc-dispatch-path">
                            <i class="fa-solid fa-plane"></i>
                            <span>${hours}h ${mins}m</span>
                        </div>
                        <div class="pui-cc-dispatch-icao" style="text-align:right;">
                            <span class="code">${next.arr_icao || '----'}</span>
                            ${next.arr_gate ? `<span class="gate">Gate ${next.arr_gate}</span>` : ''}
                        </div>
                    </div>
                    <div class="pui-cc-dispatch-info">
                        <div class="pui-cc-dispatch-row">
                            <span>Aircraft</span>
                            <strong>${next.aircraft_type || 'N/A'}</strong>
                        </div>
                        <div class="pui-cc-dispatch-row">
                            <span>Callsign</span>
                            <strong style="font-family:'JetBrains Mono',monospace;">${next.callsign || 'N/A'}</strong>
                        </div>
                        <div class="pui-cc-dispatch-row">
                            <span>Departure</span>
                            <strong style="color:var(--pui-accent);">${countdown}</strong>
                        </div>
                        ${next.passengers ? `<div class="pui-cc-dispatch-row"><span>POB</span><strong>${next.passengers} pax</strong></div>` : ''}
                    </div>`;
            } else {
                nextDispatch = `
                    <div class="pui-cc-empty" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:32px 0;">
                        <i class="fa-regular fa-calendar" style="font-size:1.8rem;opacity:0.18;"></i>
                        <span>No upcoming flights filed.</span>
                    </div>`;
            }

            return `
                <div class="pui-cc-header pui-fade-in-up">
                    <div>
                        <h1 class="pui-cc-greeting">${greeting}, ${firstName}.</h1>
                        ${statsStrip}
                    </div>
                    <div class="pui-cc-date">${dateStr}</div>
                </div>

                <div id="pui-live-flights-wrapper" style="display:none;"></div>

                <div class="pui-cc-grid pui-fade-in-up" style="animation-delay:0.08s;">
                    <div class="pui-cc-recent">
                        <div class="pui-cc-section-label">Recent Flights</div>
                        <div class="pui-cc-flights-list">${recentFlightsHTML}</div>
                    </div>
                    <div class="pui-cc-dispatch">
                        <div class="pui-cc-section-label">Next Departure</div>
                        ${nextDispatch}
                        <button class="pui-cc-dispatch-btn" onclick="document.querySelector('[data-tab=\\'flight-plan\\']')?.click()">
                            View Full Schedule <i class="fa-solid fa-arrow-right"></i>
                        </button>
                    </div>
                </div>
            `;
        } 
        
        if (this._activeTab === 'flight-plan') {
            let flightCardsHTML = '';

            if (this._flightPlansData && this._flightPlansData.length > 0) {
                flightCardsHTML = this._flightPlansData.map(flight => {
                    const flightDate = new Date(flight.dep_time).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
                    const flightTime = new Date(flight.dep_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    const hours = Math.floor(flight.duration_minutes / 60);
                    const mins = flight.duration_minutes % 60;
                    const durationStr = `${hours}h ${mins}m`;
                    
                    return `
                        <div class="pui-flight-ticket pui-fade-in-up">
                            <div class="pui-ticket-left">
                                <div class="pui-ticket-date">${flightDate}<span>${flightTime}</span></div>
                                <div class="pui-ticket-csign">${flight.callsign || 'N/A'}</div>
                            </div>
                            <div class="pui-ticket-middle">
                                <div class="pui-route-display">
                                    <div class="pui-route-point">
                                        <span class="icao">${flight.dep_icao || '----'}</span>
                                        <span class="gate">${flight.dep_gate ? 'Gate ' + flight.dep_gate : 'TBD'}</span>
                                    </div>
                                    <div class="pui-route-path">
                                        <span class="duration">${durationStr}</span>
                                        <div class="line"><i class="fa-solid fa-plane"></i></div>
                                        <span class="acft">${flight.aircraft_type || 'UNK'}</span>
                                    </div>
                                    <div class="pui-route-point">
                                        <span class="icao">${flight.arr_icao || '----'}</span>
                                        <span class="gate">${flight.arr_gate ? 'Gate ' + flight.arr_gate : 'TBD'}</span>
                                    </div>
                                </div>
                            </div>
                            <div class="pui-ticket-right">
                                <div class="pui-ticket-stat" title="Passengers"><i class="fa-solid fa-users"></i> ${flight.passengers || '--'}</div>
                                <div class="pui-ticket-stat" title="Fuel"><i class="fa-solid fa-gas-pump"></i> ${flight.fuel_used ? flight.fuel_used.toLocaleString() + ' lbs' : '--'}</div>
                            </div>
                        </div>
                    `;
                }).join('');
            } else {
                flightCardsHTML = `
                    <div class="pui-empty-state">
                        <i class="fa-solid fa-clipboard-list"></i>
                        <h4>No Active Dispatch Briefings</h4>
                        <p>Your upcoming scheduled flights will appear here.</p>
                    </div>
                `;
            }

            const addFlightFormHTML = `
                <div class="pui-dispatch-form">
                    <div class="pui-dispatch-header">
                        <h3><i class="fa-solid fa-file-pen"></i> Generate Dispatch</h3>
                    </div>
                    <div class="pui-dispatch-body-form">
                        <div class="pui-form-section">
                            <h4 class="pui-form-section-title">Flight Ident</h4>
                            <div class="pui-form-row">
                                <div class="pui-input-group">
                                    <label>Callsign</label>
                                    <div class="pui-input-wrapper">
                                        <i class="fa-solid fa-tower-broadcast pui-input-icon"></i>
                                        <input type="text" id="pui-new-callsign" class="pui-input has-icon" placeholder="e.g. DAL404">
                                    </div>
                                </div>
                                <div class="pui-input-group">
                                    <label>Aircraft</label>
                                    <div class="pui-input-wrapper">
                                        <i class="fa-solid fa-plane pui-input-icon"></i>
                                        <input type="text" id="pui-new-aircraft" class="pui-input has-icon" placeholder="e.g. B763">
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="pui-form-section">
                            <h4 class="pui-form-section-title">Routing</h4>
                            <div class="pui-form-row">
                                <div class="pui-input-group">
                                    <label>Origin</label>
                                    <div class="pui-input-wrapper">
                                        <i class="fa-solid fa-plane-departure pui-input-icon"></i>
                                        <input type="text" id="pui-new-dep" class="pui-input has-icon pui-icao-input" placeholder="KJFK" maxlength="4">
                                    </div>
                                </div>
                                <div class="pui-input-group">
                                    <label>Destination</label>
                                    <div class="pui-input-wrapper">
                                        <i class="fa-solid fa-plane-arrival pui-input-icon"></i>
                                        <input type="text" id="pui-new-arr" class="pui-input has-icon pui-icao-input" placeholder="EGLL" maxlength="4">
                                    </div>
                                </div>
                            </div>
                            <div class="pui-form-row">
                                <div class="pui-input-group">
                                    <label>Dep Gate</label>
                                    <input type="text" id="pui-new-dep-gate" class="pui-input" placeholder="B24">
                                </div>
                                <div class="pui-input-group">
                                    <label>Arr Gate</label>
                                    <input type="text" id="pui-new-arr-gate" class="pui-input" placeholder="501">
                                </div>
                            </div>
                        </div>

                        <div class="pui-form-section">
                            <h4 class="pui-form-section-title">Schedule & Load</h4>
                            <div class="pui-form-row">
                                <div class="pui-input-group">
                                    <label>Departure Time</label>
                                    <input type="datetime-local" id="pui-new-time" class="pui-input">
                                </div>
                                <div class="pui-input-group">
                                    <label>EET (Minutes)</label>
                                    <input type="number" id="pui-new-duration" class="pui-input" placeholder="420">
                                </div>
                            </div>
                            <div class="pui-form-row">
                                <div class="pui-input-group">
                                    <label>POB (Pax)</label>
                                    <div class="pui-input-wrapper">
                                        <i class="fa-solid fa-users pui-input-icon"></i>
                                        <input type="number" id="pui-new-pax" class="pui-input has-icon" placeholder="212">
                                    </div>
                                </div>
                                <div class="pui-input-group">
                                    <label>Block Fuel (lbs)</label>
                                    <div class="pui-input-wrapper">
                                        <i class="fa-solid fa-gas-pump pui-input-icon"></i>
                                        <input type="number" id="pui-new-fuel" class="pui-input has-icon" placeholder="85000">
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <div id="pui-add-flight-msg" class="pui-alert" style="display: none; margin-top: 10px;"></div>
                        
                        <button class="pui-btn-primary pui-dispatch-submit" id="pui-submit-flight-btn">
                            <i class="fa-solid fa-paper-plane"></i> File Flight Plan
                        </button>
                    </div>
                </div>
            `;

            return `
                <div class="pui-tab-header pui-fade-in-up">
                    <h2>Flight Dispatch Hub</h2>
                    <p>File upcoming flight plans and review your active schedule.</p>
                </div>

                <div class="pui-flight-planner-layout pui-fade-in-up" style="animation-delay: 0.1s;">
                    <div class="pui-flight-list-col">
                        ${flightCardsHTML}
                    </div>
                    <div class="pui-flight-form-col">
                        ${addFlightFormHTML}
                    </div>
                </div>
            `;
        } 
        
        if (this._activeTab === 'settings') {
            const user = this._currentUser;
            const name = user?.user_metadata?.full_name || user?.user_metadata?.name || '';
            const email = user?.email || '';
            const ifUsername = user?.user_metadata?.if_username || '';

            return `
                <div class="pui-tab-header pui-fade-in-up">
                    <h2>Account Settings</h2>
                    <p>Manage your profile, preferences, and security.</p>
                </div>

                <div class="pui-settings-grid pui-fade-in-up" style="animation-delay: 0.1s;">
                    <div class="pui-content-card pui-form-card">
                        <div class="pui-card-header">
                            <h3>Profile Details</h3>
                        </div>
                        <div class="pui-card-body">
                            <div class="pui-input-group">
                                <label>Full Name</label>
                                <div class="pui-input-wrapper">
                                    <i class="fa-solid fa-user pui-input-icon"></i>
                                    <input type="text" id="pui-edit-name" class="pui-input has-icon" value="${name}">
                                </div>
                            </div>
                            
                            <div class="pui-input-group">
                                <label>Email Address</label>
                                <div class="pui-input-wrapper">
                                    <i class="fa-solid fa-envelope pui-input-icon"></i>
                                    <input type="email" class="pui-input has-icon" value="${email}" disabled style="opacity: 0.6; cursor: not-allowed;">
                                </div>
                                <p class="pui-help-text">Email address cannot be changed directly.</p>
                            </div>

                            <div class="pui-input-group">
                                <label>Infinite Flight Username</label>
                                <div class="pui-input-wrapper">
                                    <i class="fa-solid fa-plane pui-input-icon"></i>
                                    <input type="text" id="pui-edit-if-username" class="pui-input has-icon" value="${ifUsername}" placeholder="Infinite Flight Community Forum Name">
                                </div>
                                <p class="pui-help-text">Link your account to automatically log your flights and display your stats.</p>
                            </div>

                            <div class="pui-input-group">
                                <label>New Password (Optional)</label>
                                <div class="pui-input-wrapper">
                                    <i class="fa-solid fa-lock pui-input-icon"></i>
                                    <input type="password" id="pui-edit-password" class="pui-input has-icon" placeholder="Leave blank to keep current">
                                </div>
                            </div>

                            <div id="pui-settings-msg" class="pui-alert" style="display: none;"></div>

                            <div class="pui-form-actions">
                                <button class="pui-btn-primary" id="pui-save-btn">Save Changes</button>
                            </div>
                        </div>
                    </div>

                    <div>
                        <div class="pui-content-card pui-theme-card">
                            <div class="pui-card-header">
                                <h3>Theme Preference</h3>
                            </div>
                            <div class="pui-card-body">
                                <div class="pui-theme-options">
                                    <label class="pui-theme-option">
                                        <input type="radio" name="pui-theme" value="white" ${this._theme === 'white' ? 'checked' : ''}>
                                        <span>Light (White)</span>
                                    </label>
                                    <label class="pui-theme-option">
                                        <input type="radio" name="pui-theme" value="light-gray" ${this._theme === 'light-gray' ? 'checked' : ''}>
                                        <span>Light (Gray)</span>
                                    </label>
                                    <label class="pui-theme-option">
                                        <input type="radio" name="pui-theme" value="dark-gray" ${this._theme === 'dark-gray' ? 'checked' : ''}>
                                        <span>Dark Gray</span>
                                    </label>
                                </div>
                                <p class="pui-help-text" style="margin-top: 10px;">Theme changes will be applied instantly, click "Save Changes" to sync across devices.</p>
                            </div>
                        </div>

                        <div class="pui-content-card pui-billing-card" style="margin-top: 24px;">
                            <div class="pui-card-header">
                                <h3>Billing Plan</h3>
                            </div>
                            <div class="pui-card-body">
                                <div class="pui-plan-box">
                                    <div class="pui-plan-header">
                                        <h4>${this._subscription.plan}</h4>
                                        <span class="pui-status-badge ${this._subscription.status === 'Active' ? 'active' : 'inactive'}">${this._subscription.status}</span>
                                    </div>
                                    <p class="pui-plan-price">${this._subscription.price}</p>
                                    <p class="pui-plan-renewal">Next payment: ${this._subscription.nextPayment}</p>
                                </div>
                                <div id="pui-billing-msg" class="pui-alert" style="display: none; margin-top: 16px;"></div>
                                <div class="pui-billing-actions" style="margin-top: 20px;">
                                    <button class="pui-btn-secondary" id="pui-billing-update-btn">
                                        <i class="fa-solid fa-credit-card"></i> Update Payment Method
                                    </button>
                                    <button class="pui-btn-danger-outline" id="pui-billing-cancel-btn">
                                        <i class="fa-solid fa-ban"></i> Cancel Subscription
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }
    },

    _showMessage(msgDivId, msg, type) {
        const msgDiv = document.getElementById(msgDivId);
        if (msgDiv) {
            msgDiv.textContent = msg;
            msgDiv.style.display = 'block';
            msgDiv.className = `pui-alert pui-alert-${type}`;
        }
    },

    _setLoading(btnId, isLoading, originalText) {
        const btn = document.getElementById(btnId);
        if (!btn) return;

        if (isLoading) {
            btn.disabled = true;
            btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Processing...`;
            btn.style.opacity = '0.7';
        } else {
            btn.disabled = false;
            btn.innerHTML = originalText;
            btn.style.opacity = '1';
        }
    },

    _attachListeners() {
        document.getElementById('pui-close-global')?.addEventListener('click', () => this.close());
        document.getElementById('pui-sidebar-signout')?.addEventListener('click', async () => {
            if (this._supabase) {
                await this._supabase.auth.signOut();
                this.close();
            }
        });

        document.querySelectorAll('.pui-nav-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchTab(e.currentTarget.dataset.tab);
            });
        });

        if (this._activeTab === 'onboarding') {
            const themeRadios = document.querySelectorAll('input[name="onboarding-theme"]');
            themeRadios.forEach(radio => {
                radio.addEventListener('change', (e) => {
                    this.setTheme(e.target.value, true);
                });
            });

            document.getElementById('onboarding-complete-btn')?.addEventListener('click', async () => {
                const ifUsername = document.getElementById('onboarding-if-username')?.value.trim();
                const selectedTheme = document.querySelector('input[name="onboarding-theme"]:checked')?.value || 'dark-gray';

                this._setLoading('onboarding-complete-btn', true, 'Completing Setup');

                try {
                    const { data, error } = await this._supabase.auth.updateUser({
                        data: {
                            if_username: ifUsername,
                            theme: selectedTheme,
                            onboarding_complete: true // Flag that onboarding is finished
                        }
                    });

                    if (error) throw error;

                    this._currentUser = data.user;
                    
                    if (ifUsername) {
                        this._fetchInfiniteFlightData(ifUsername);
                    }

                    // Setup complete, switch to live dashboard
                    this._activeTab = 'dashboard';
                    this._render();

                } catch (error) {
                    console.error("Onboarding Error:", error);
                    alert("Failed to save setup preferences: " + error.message);
                    this._setLoading('onboarding-complete-btn', false, 'Complete Setup');
                }
            });
        }

        if (this._activeTab === 'airspace-intel') {
            document.getElementById('pui-intel-add-node')?.addEventListener('click', () => {
                const input = document.getElementById('pui-intel-new-node');
                const icao = input.value.trim().toUpperCase();
                if (icao.length >= 3 && this._airspaceNetwork) {
                    if (!this._airspaceNetwork._hubRegistry.has(icao)) {
                        this._airspaceNetwork.registerNode(icao, 0, 0); 
                    }
                    const currentNodes = Array.from(this._airspaceNetwork._activeNodes);
                    if (!currentNodes.includes(icao)) {
                        currentNodes.push(icao);
                        this._airspaceNetwork.setActiveNodes(currentNodes);
                        input.value = '';
                        this._updateAirspaceDOM();
                    }
                }
            });

            document.querySelectorAll('.pui-intel-remove-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const icao = e.currentTarget.dataset.icao;
                    if (this._airspaceNetwork) {
                        const currentNodes = Array.from(this._airspaceNetwork._activeNodes).filter(n => n !== icao);
                        this._airspaceNetwork.setActiveNodes(currentNodes);
                        this._updateAirspaceDOM();
                    }
                });
            });
        }

        if (this._activeTab === 'flight-plan') {
            const toggleBtn = document.getElementById('pui-toggle-flight-form');
            const formSection = document.getElementById('pui-add-flight-section');
            const cancelBtn = document.getElementById('pui-cancel-flight-btn');
            
            toggleBtn?.addEventListener('click', () => {
                if (formSection.style.display === 'none') {
                    formSection.style.display = 'block';
                    formSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                } else {
                    formSection.style.display = 'none';
                }
            });

            cancelBtn?.addEventListener('click', () => {
                formSection.style.display = 'none';
            });

            document.getElementById('pui-submit-flight-btn')?.addEventListener('click', async () => {
                const callsign = document.getElementById('pui-new-callsign').value.trim();
                const aircraft = document.getElementById('pui-new-aircraft').value.trim();
                const depIcao = document.getElementById('pui-new-dep').value.trim().toUpperCase();
                const arrIcao = document.getElementById('pui-new-arr').value.trim().toUpperCase();
                const duration = parseInt(document.getElementById('pui-new-duration').value);
                const depTime = document.getElementById('pui-new-time').value;
                const depGate = document.getElementById('pui-new-dep-gate').value.trim();
                const arrGate = document.getElementById('pui-new-arr-gate').value.trim();
                const pax = parseInt(document.getElementById('pui-new-pax').value);
                const fuel = parseInt(document.getElementById('pui-new-fuel').value);

                if (!callsign || !aircraft || !depIcao || !arrIcao || isNaN(duration) || !depTime) {
                    this._showMessage('pui-add-flight-msg', 'Please fill in all required fields.', 'error');
                    return;
                }

                this._setLoading('pui-submit-flight-btn', true, 'Save Flight Plan');

                try {
                    const newFlightPlan = {
                        user_id: this._currentUser.id,
                        if_username: this._currentUser.user_metadata?.if_username || null,
                        dep_time: new Date(depTime).toISOString(),
                        duration_minutes: duration,
                        aircraft_type: aircraft,
                        callsign: callsign,
                        dep_icao: depIcao,
                        arr_icao: arrIcao,
                        dep_gate: depGate || null,
                        arr_gate: arrGate || null,
                        passengers: isNaN(pax) ? null : pax,
                        fuel_used: isNaN(fuel) ? null : fuel
                    };

                    const { error } = await this._supabase
                        .from('user_flights')
                        .insert([newFlightPlan]);

                    if (error) throw error;
                    
                    this._showMessage('pui-add-flight-msg', 'Flight plan saved successfully!', 'success');
                    setTimeout(() => {
                        this._fetchFlightPlans();
                    }, 1500);

                } catch (err) {
                    console.error("Error adding flight plan:", err);
                    this._showMessage('pui-add-flight-msg', err.message || 'Error saving flight plan.', 'error');
                    this._setLoading('pui-submit-flight-btn', false, 'Save Flight Plan');
                }
            });
        }

        if (this._activeTab === 'settings') {
            const themeRadios = document.querySelectorAll('input[name="pui-theme"]');
            themeRadios.forEach(radio => {
                radio.addEventListener('change', (e) => {
                    this.setTheme(e.target.value, true);
                });
            });

            document.getElementById('pui-save-btn')?.addEventListener('click', async () => {
                const newName = document.getElementById('pui-edit-name')?.value.trim();
                const newIfUsername = document.getElementById('pui-edit-if-username')?.value.trim();
                const newPassword = document.getElementById('pui-edit-password')?.value;
                const currentTheme = this._theme;

                let updates = { data: {} };
                
                if (newName) {
                    updates.data.full_name = newName;
                    updates.data.name = newName; 
                }
                
                if (newIfUsername !== undefined) {
                    updates.data.if_username = newIfUsername;
                }

                updates.data.theme = currentTheme;

                if (newPassword) {
                    updates.password = newPassword;
                }

                this._setLoading('pui-save-btn', true, 'Save Changes');

                try {
                    const { data, error } = await this._supabase.auth.updateUser(updates);
                    
                    if (error) throw error;
                    
                    this._showMessage('pui-settings-msg', 'Settings updated successfully.', 'success');
                    this._currentUser = data.user;
                    
                    if (newIfUsername) {
                        this._fetchInfiniteFlightData(newIfUsername);
                    }

                    setTimeout(() => {
                        const msgDiv = document.getElementById('pui-settings-msg');
                        if(msgDiv) msgDiv.style.display = 'none';
                        this._setLoading('pui-save-btn', false, 'Save Changes');
                    }, 3000);

                } catch (error) {
                    console.error("Update error:", error);
                    this._showMessage('pui-settings-msg', error.message || 'Failed to update settings.', 'error');
                    this._setLoading('pui-save-btn', false, 'Save Changes');
                }
            });

            document.getElementById('pui-billing-cancel-btn')?.addEventListener('click', async () => {
                if (!confirm("Are you sure you want to cancel your Pro Access subscription? This action cannot be undone.")) return;
                
                this._setLoading('pui-billing-cancel-btn', true, 'Processing...');
                
                try {
                    const { error } = await this._supabase
                        .from('subscriptions')
                        .update({ status: 'canceled' })
                        .eq('user_id', this._currentUser.id);
                        
                    if (error) throw error;
                    
                    this._subscription.status = 'Canceled';
                    this._render();
                    setTimeout(() => {
                        this._showMessage('pui-billing-msg', 'Your subscription has been canceled successfully.', 'success');
                    }, 50);

                } catch (error) {
                    console.error("Cancellation error:", error);
                    this._showMessage('pui-billing-msg', 'Unable to cancel subscription. Please contact support.', 'error');
                    this._setLoading('pui-billing-cancel-btn', false, '<i class="fa-solid fa-ban"></i> Cancel Subscription');
                }
            });
        }
    },

    _injectStyles() {
        if (document.getElementById('pui-dashboard-styles')) return;

        const css = `
            @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&family=Bebas+Neue&display=swap');

            /* ─── THEME VARIABLES ─────────────────────────── */
            .pui-wrapper-layer {
                --pui-bg-base:      #070c16;
                --pui-bg-surface:   #0c1524;
                --pui-bg-card:      #111d34;
                --pui-text-primary: #dce6f7;
                --pui-text-secondary:#5d7498;
                --pui-border:       rgba(255,255,255,0.07);
                --pui-border-light: rgba(255,255,255,0.04);
                --pui-hover:        rgba(255,255,255,0.05);
                --pui-input-bg:     #0c1524;
                --pui-accent:       #00c8ff;
                --pui-accent-glow:  rgba(0,200,255,0.15);
                --pui-sidebar-w:    72px;
            }

            /* Light theme */
            .pui-wrapper-layer[data-theme="white"] {
                --pui-bg-base:      #f0f4fa;
                --pui-bg-surface:   #ffffff;
                --pui-bg-card:      #f7f9fc;
                --pui-text-primary: #0f1d32;
                --pui-text-secondary:#6b7fa3;
                --pui-border:       rgba(0,0,0,0.09);
                --pui-border-light: rgba(0,0,0,0.05);
                --pui-hover:        rgba(0,0,0,0.04);
                --pui-input-bg:     #ffffff;
                --pui-accent:       #0099d4;
            }

            .pui-wrapper-layer[data-theme="light-gray"] {
                --pui-bg-base:      #e4eaf3;
                --pui-bg-surface:   #eef2f9;
                --pui-bg-card:      #f5f7fb;
                --pui-text-primary: #1a2a42;
                --pui-text-secondary:#5d7498;
                --pui-border:       rgba(0,0,0,0.1);
                --pui-border-light: rgba(0,0,0,0.06);
                --pui-hover:        rgba(0,0,0,0.05);
                --pui-input-bg:     #ffffff;
                --pui-accent:       #0099d4;
            }

            .pui-wrapper-layer[data-theme="dark-gray"] {
                --pui-bg-base:      #070c16;
                --pui-bg-surface:   #0c1524;
                --pui-bg-card:      #111d34;
                --pui-text-primary: #dce6f7;
                --pui-text-secondary:#5d7498;
                --pui-border:       rgba(255,255,255,0.07);
                --pui-border-light: rgba(255,255,255,0.04);
                --pui-hover:        rgba(255,255,255,0.05);
                --pui-input-bg:     #0c1524;
                --pui-accent:       #00c8ff;
                --pui-accent-glow:  rgba(0,200,255,0.15);
            }

            /* ─── KEYFRAMES ───────────────────────────────── */
            @keyframes puiPulse {
                0%   { transform:scale(0.9); box-shadow:0 0 0 0 rgba(0,200,255,0.6); }
                70%  { transform:scale(1);   box-shadow:0 0 0 8px rgba(0,200,255,0); }
                100% { transform:scale(0.9); box-shadow:0 0 0 0 rgba(0,200,255,0); }
            }
            @keyframes puiFadeInUp {
                from { opacity:0; transform:translateY(14px); }
                to   { opacity:1; transform:translateY(0); }
            }
            @keyframes shimmer {
                0%   { background-position:-500px 0; }
                100% { background-position:500px 0; }
            }

            /* ─── OVERLAY WRAPPER ─────────────────────────── */
            .pui-wrapper-layer {
                position: fixed;
                inset: 0;
                z-index: 9999;
                background: rgba(0,0,0,0.75);
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 24px;
                font-family: 'DM Sans', system-ui, sans-serif;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.35s ease;
            }
            .pui-wrapper-layer.pui-open {
                opacity: 1;
                pointer-events: auto;
            }

            /* ─── DASHBOARD CONTAINER ─────────────────────── */
            .pui-dashboard-container {
                width: 100%;
                max-width: 1380px;
                height: 92vh;
                background: var(--pui-bg-base);
                border-radius: 20px;
                box-shadow: 0 40px 80px -20px rgba(0,0,0,0.7), 0 0 0 1px var(--pui-border);
                display: flex;
                overflow: hidden;
                position: relative;
                transform: scale(0.97) translateY(6px);
                transition: transform 0.4s cubic-bezier(0.16,1,0.3,1);
            }
            .pui-wrapper-layer.pui-open .pui-dashboard-container {
                transform: scale(1) translateY(0);
            }

            /* ─── CLOSE BUTTON ────────────────────────────── */
            .pui-close-btn {
                position: absolute;
                top: 18px;
                right: 20px;
                background: rgba(255,255,255,0.06);
                border: 1px solid var(--pui-border);
                color: var(--pui-text-secondary);
                width: 34px;
                height: 34px;
                border-radius: 50%;
                font-size: 0.9rem;
                display: grid;
                place-items: center;
                cursor: pointer;
                z-index: 200;
                transition: all 0.2s;
                backdrop-filter: blur(8px);
            }
            .pui-close-btn:hover {
                background: rgba(239,68,68,0.2);
                color: #f87171;
                border-color: rgba(239,68,68,0.4);
            }

            /* ─── SIDEBAR ─────────────────────────────────── */
            .pui-sidebar {
                width: var(--pui-sidebar-w);
                background: var(--pui-bg-surface);
                border-right: 1px solid var(--pui-border);
                display: flex;
                flex-direction: column;
                align-items: center;
                flex-shrink: 0;
                padding: 20px 0;
                gap: 0;
                z-index: 10;
                transition: width 0.25s cubic-bezier(0.4,0,0.2,1);
                overflow: hidden;
            }
            .pui-sidebar:hover {
                width: 200px;
            }

            .pui-sidebar-avatar {
                width: 100%;
                display: flex;
                align-items: center;
                padding: 0 14px 20px;
                border-bottom: 1px solid var(--pui-border);
                margin-bottom: 16px;
                gap: 12px;
                overflow: hidden;
                min-height: 60px;
            }
            .pui-avatar {
                width: 40px;
                height: 40px;
                min-width: 40px;
                border-radius: 10px;
                background: linear-gradient(135deg, #0070c0, #00c8ff);
                color: #fff;
                display: grid;
                place-items: center;
                font-weight: 700;
                font-size: 0.9rem;
                letter-spacing: 0.02em;
                box-shadow: 0 4px 14px rgba(0,200,255,0.25);
            }
            .pui-avatar-tooltip {
                display: flex;
                flex-direction: column;
                opacity: 0;
                transform: translateX(-6px);
                transition: all 0.2s 0.05s;
                white-space: nowrap;
                overflow: hidden;
            }
            .pui-sidebar:hover .pui-avatar-tooltip {
                opacity: 1;
                transform: translateX(0);
            }
            .pui-avatar-name {
                font-weight: 700;
                color: var(--pui-text-primary);
                font-size: 0.9rem;
            }
            .pui-avatar-plan {
                font-size: 0.72rem;
                color: var(--pui-accent);
                font-weight: 600;
                margin-top: 1px;
            }

            .pui-nav-menu {
                display: flex;
                flex-direction: column;
                gap: 4px;
                width: 100%;
                padding: 0 10px;
                flex-grow: 1;
            }
            .pui-nav-item {
                background: transparent;
                border: none;
                padding: 11px 10px;
                border-radius: 10px;
                color: var(--pui-text-secondary);
                font-weight: 600;
                font-size: 0.88rem;
                text-align: left;
                cursor: pointer;
                transition: all 0.2s;
                display: flex;
                align-items: center;
                gap: 12px;
                white-space: nowrap;
                overflow: hidden;
            }
            .pui-nav-item i {
                font-size: 1rem;
                width: 20px;
                min-width: 20px;
                text-align: center;
            }
            .pui-nav-label {
                opacity: 0;
                transform: translateX(-4px);
                transition: all 0.2s 0.04s;
            }
            .pui-sidebar:hover .pui-nav-label {
                opacity: 1;
                transform: translateX(0);
            }
            .pui-nav-item:hover {
                background: var(--pui-hover);
                color: var(--pui-text-primary);
            }
            .pui-nav-item.active {
                background: var(--pui-accent-glow, rgba(0,200,255,0.12));
                color: var(--pui-accent);
            }
            .pui-nav-item.active i {
                filter: drop-shadow(0 0 4px var(--pui-accent));
            }

            .pui-sidebar-footer {
                width: 100%;
                padding: 10px;
                border-top: 1px solid var(--pui-border);
                padding-top: 14px;
            }
            .pui-signout-btn {
                width: 100%;
                background: transparent;
                border: none;
                padding: 10px;
                border-radius: 10px;
                color: var(--pui-text-secondary);
                font-weight: 600;
                font-size: 0.88rem;
                cursor: pointer;
                transition: all 0.2s;
                display: flex;
                align-items: center;
                gap: 12px;
                white-space: nowrap;
                overflow: hidden;
            }
            .pui-signout-btn i { width: 20px; min-width: 20px; text-align: center; font-size: 1rem; }
            .pui-signout-btn:hover {
                color: #f87171;
                background: rgba(239,68,68,0.1);
            }

            /* ─── MAIN CONTENT ────────────────────────────── */
            .pui-main-content {
                flex-grow: 1;
                overflow-y: auto;
                overflow-x: hidden;
                padding: 32px 36px;
                scrollbar-width: thin;
                scrollbar-color: var(--pui-border) transparent;
                display: flex;
                flex-direction: column;
            }

            /* ─── ONBOARDING EXPERIENCE ───────────────────── */
            [data-active-tab="onboarding"] .pui-main-content {
                padding: 0;
                display: flex;
                justify-content: center;
                align-items: center;
                background: radial-gradient(circle at top, var(--pui-bg-card), var(--pui-bg-base));
            }
            .pui-onboarding-container {
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100%;
                padding: 40px 20px;
                width: 100%;
            }
            .pui-onboarding-card {
                background: var(--pui-bg-card);
                border: 1px solid var(--pui-border);
                border-radius: 20px;
                width: 100%;
                max-width: 520px;
                padding: 48px;
                box-shadow: 0 30px 60px rgba(0,0,0,0.3);
                position: relative;
                overflow: hidden;
            }
            .pui-onboarding-header {
                text-align: center;
                margin-bottom: 36px;
            }
            .pui-onboarding-header h2 {
                color: var(--pui-text-primary);
                font-size: 2.2rem;
                margin: 0 0 10px 0;
                font-weight: 700;
                letter-spacing: -0.02em;
            }
            .pui-onboarding-header p {
                color: var(--pui-text-secondary);
                margin: 0;
                font-size: 1rem;
                line-height: 1.5;
            }

            /* ─── STATS GRID ──────────────────────────────── */
            .pui-stats-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 14px;
            }
            .pui-stat-card {
                background: var(--pui-bg-card, var(--pui-bg-surface));
                border: 1px solid var(--pui-border);
                border-radius: 14px;
                padding: 18px 20px;
                display: flex;
                align-items: center;
                gap: 14px;
                transition: border-color 0.2s;
            }
            .pui-stat-card:hover { border-color: rgba(0,200,255,0.25); }
            .pui-stat-icon {
                width: 48px;
                height: 48px;
                border-radius: 12px;
                display: grid;
                place-items: center;
                font-size: 1.3rem;
                flex-shrink: 0;
            }
            .pui-stat-data h3 {
                margin: 0 0 3px 0;
                font-size: 1.3rem;
                color: var(--pui-text-primary);
                font-weight: 700;
            }
            .pui-stat-data p {
                margin: 0;
                color: var(--pui-text-secondary);
                font-size: 0.8rem;
                font-weight: 500;
            }
            .pui-weather-widget {
                background: linear-gradient(135deg, #0c1e3a, #07111f);
                border-color: rgba(0,200,255,0.15);
            }

            /* ─── CONTENT CARDS ────────────────────────────── */
            .pui-dashboard-split {
                display: grid;
                grid-template-columns: 2fr 1fr;
                gap: 18px;
            }
            .pui-content-card {
                background: var(--pui-bg-card, var(--pui-bg-surface));
                border: 1px solid var(--pui-border);
                border-radius: 14px;
                overflow: hidden;
            }
            .pui-card-header {
                padding: 18px 22px;
                border-bottom: 1px solid var(--pui-border-light);
                display: flex;
                align-items: center;
            }
            .pui-card-header h3 {
                margin: 0;
                font-size: 0.9rem;
                color: var(--pui-text-primary);
                font-weight: 600;
                letter-spacing: 0.01em;
            }
            .pui-list-group { display: flex; flex-direction: column; }
            .pui-list-item {
                display: flex;
                align-items: center;
                padding: 14px 22px;
                border-bottom: 1px solid var(--pui-border-light);
                gap: 14px;
                transition: background 0.15s;
            }
            .pui-list-item:hover { background: var(--pui-hover); }
            .pui-list-item:last-child { border-bottom: none; }
            .pui-list-icon {
                width: 38px;
                height: 38px;
                border-radius: 9px;
                background: var(--pui-accent-glow, rgba(0,200,255,0.1));
                color: var(--pui-accent);
                display: grid;
                place-items: center;
                font-size: 0.95rem;
            }
            .pui-list-details { flex-grow: 1; }
            .pui-list-details h4 {
                margin: 0 0 3px 0;
                color: var(--pui-text-primary);
                font-size: 0.88rem;
                font-weight: 600;
            }
            .pui-list-details p {
                margin: 0;
                color: var(--pui-text-secondary);
                font-size: 0.76rem;
            }
            .pui-list-meta {
                font-size: 0.75rem;
                color: var(--pui-text-secondary);
                font-weight: 500;
            }

            /* ─── AIRSPACE INTELLIGENCE MODULE ─────────────── */
            .pui-intel-stat {
                display: flex;
                flex-direction: column;
            }
            .pui-intel-stat .label {
                font-size: 0.65rem;
                color: var(--pui-text-secondary);
                font-weight: 700;
                letter-spacing: 0.08em;
                text-transform: uppercase;
                margin-bottom: 4px;
            }
            .pui-intel-stat .value {
                font-family: 'JetBrains Mono', monospace;
                font-size: 1.4rem;
                color: var(--pui-text-primary);
                font-weight: 700;
                line-height: 1;
            }
            .pui-intel-heatmap {
                display: flex;
                gap: 4px;
                height: 36px;
                border-radius: 6px;
                overflow: hidden;
                background: rgba(0,0,0,0.25);
                padding: 4px;
            }
            .pui-intel-heatblock {
                flex: 1;
                border-radius: 4px;
                position: relative;
                transition: all 0.2s;
                cursor: crosshair;
            }
            .pui-intel-heatblock:hover {
                transform: scaleY(1.15);
                box-shadow: 0 0 10px rgba(255,255,255,0.2);
            }
            .pui-heatblock-tooltip {
                position: absolute;
                bottom: 120%;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0,0,0,0.85);
                backdrop-filter: blur(4px);
                color: #fff;
                padding: 6px 10px;
                border-radius: 6px;
                font-size: 0.7rem;
                text-align: center;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.2s;
                white-space: nowrap;
                border: 1px solid rgba(255,255,255,0.1);
                z-index: 10;
            }
            .pui-intel-heatblock:hover .pui-heatblock-tooltip {
                opacity: 1;
            }

            /* ─── DISPATCH CARD ────────────────────────────── */
            .pui-dispatch-body { padding: 20px; }
            .pui-route-graphic {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 20px;
            }
            .pui-route-node { text-align: center; }
            .pui-node-code {
                display: block;
                font-family: 'JetBrains Mono', monospace;
                font-size: 1.3rem;
                font-weight: 700;
                color: var(--pui-text-primary);
            }
            .pui-node-city {
                font-size: 0.75rem;
                color: var(--pui-text-secondary);
            }
            .pui-route-line {
                flex-grow: 1;
                margin: 0 16px;
                height: 1px;
                background: var(--pui-border);
                position: relative;
                display: flex;
                justify-content: center;
                align-items: center;
            }
            .pui-route-line i {
                color: var(--pui-accent);
                background: var(--pui-bg-card, var(--pui-bg-surface));
                padding: 0 8px;
            }
            .pui-route-distance {
                position: absolute;
                top: -18px;
                font-size: 0.7rem;
                color: var(--pui-text-secondary);
                font-weight: 600;
            }
            .pui-dispatch-row {
                display: flex;
                justify-content: space-between;
                padding: 10px 0;
                border-bottom: 1px solid var(--pui-border-light);
                font-size: 0.85rem;
            }
            .pui-dispatch-row:last-child { border-bottom: none; }
            .pui-dispatch-row span { color: var(--pui-text-secondary); }
            .pui-dispatch-row strong { color: var(--pui-text-primary); font-weight: 600; }

            /* ─── TAB HEADER ────────────────────────────────── */
            .pui-tab-header { margin-bottom: 28px; }
            .pui-tab-header h2 {
                margin: 0 0 6px 0;
                font-size: 1.6rem;
                color: var(--pui-text-primary);
                font-weight: 700;
            }
            .pui-tab-header p {
                margin: 0;
                color: var(--pui-text-secondary);
                font-size: 0.9rem;
            }

            /* ─── ANIMATIONS ─────────────────────────────── */
            .pui-fade-in-up {
                animation: puiFadeInUp 0.45s ease both;
                opacity: 0;
            }
            .pui-skeleton {
                background: linear-gradient(90deg,
                    var(--pui-border) 25%,
                    var(--pui-border-light) 50%,
                    var(--pui-border) 75%);
                background-size: 500px 100%;
                animation: shimmer 1.6s infinite;
                border-radius: 6px;
            }

            /* ─── NEW PREMIUM FLIGHT DISPATCHER ──────────── */
            .pui-flight-planner-layout {
                display: grid;
                grid-template-columns: 1fr 400px;
                gap: 24px;
                align-items: start;
            }
            .pui-flight-list-col {
                display: flex;
                flex-direction: column;
                gap: 16px;
            }
            .pui-flight-ticket {
                background: var(--pui-bg-card);
                border: 1px solid var(--pui-border);
                border-radius: 16px;
                display: flex;
                overflow: hidden;
                position: relative;
                transition: transform 0.2s, box-shadow 0.2s;
            }
            .pui-flight-ticket:hover {
                transform: translateY(-2px);
                box-shadow: 0 10px 30px rgba(0,0,0,0.2);
                border-color: rgba(0, 200, 255, 0.3);
            }
            .pui-ticket-left {
                background: rgba(0,0,0,0.15);
                padding: 20px;
                display: flex;
                flex-direction: column;
                justify-content: center;
                border-right: 2px dashed var(--pui-border);
                min-width: 140px;
            }
            .pui-ticket-date {
                font-size: 0.75rem;
                color: var(--pui-text-secondary);
                text-transform: uppercase;
                letter-spacing: 0.05em;
                font-weight: 700;
            }
            .pui-ticket-date span {
                display: block;
                font-size: 1.1rem;
                color: var(--pui-text-primary);
                margin-top: 4px;
                font-family: 'JetBrains Mono', monospace;
            }
            .pui-ticket-csign {
                margin-top: 12px;
                display: inline-block;
                background: var(--pui-accent-glow);
                color: var(--pui-accent);
                padding: 4px 8px;
                border-radius: 6px;
                font-size: 0.8rem;
                font-weight: 700;
                font-family: 'JetBrains Mono', monospace;
                text-align: center;
            }
            .pui-ticket-middle {
                flex-grow: 1;
                padding: 20px;
                display: flex;
                align-items: center;
            }
            .pui-route-display {
                width: 100%;
                display: flex;
                align-items: center;
                justify-content: space-between;
            }
            .pui-route-point {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 4px;
            }
            .pui-route-point .icao {
                font-size: 1.8rem;
                font-family: 'Bebas Neue', sans-serif;
                color: var(--pui-text-primary);
                line-height: 1;
                letter-spacing: 0.05em;
            }
            .pui-route-point .gate {
                font-size: 0.7rem;
                color: var(--pui-text-secondary);
                background: rgba(255,255,255,0.05);
                padding: 2px 6px;
                border-radius: 4px;
                font-weight: 600;
            }
            .pui-route-path {
                flex-grow: 1;
                display: flex;
                flex-direction: column;
                align-items: center;
                padding: 0 20px;
                position: relative;
            }
            .pui-route-path .duration {
                font-size: 0.7rem;
                color: var(--pui-text-secondary);
                font-weight: 600;
                margin-bottom: 4px;
            }
            .pui-route-path .line {
                width: 100%;
                height: 2px;
                background: linear-gradient(90deg, transparent, var(--pui-accent), transparent);
                position: relative;
                display: flex;
                justify-content: center;
                align-items: center;
            }
            .pui-route-path .line i {
                position: absolute;
                color: var(--pui-accent);
                font-size: 1rem;
                background: var(--pui-bg-card);
                padding: 0 6px;
            }
            .pui-route-path .acft {
                font-size: 0.75rem;
                color: var(--pui-text-primary);
                font-weight: 700;
                margin-top: 8px;
                letter-spacing: 0.05em;
            }
            .pui-ticket-right {
                padding: 20px;
                display: flex;
                flex-direction: column;
                justify-content: center;
                gap: 12px;
                border-left: 1px solid var(--pui-border-light);
                min-width: 120px;
            }
            .pui-ticket-stat {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 0.8rem;
                color: var(--pui-text-secondary);
                font-weight: 600;
            }
            .pui-ticket-stat i {
                color: var(--pui-text-primary);
                width: 16px;
                text-align: center;
            }
            .pui-empty-state {
                text-align: center;
                padding: 60px 20px;
                background: rgba(0,0,0,0.1);
                border: 1px dashed var(--pui-border);
                border-radius: 16px;
            }
            .pui-empty-state i {
                font-size: 2.5rem;
                color: var(--pui-text-secondary);
                opacity: 0.5;
                margin-bottom: 16px;
            }
            .pui-empty-state h4 {
                margin: 0 0 8px 0;
                color: var(--pui-text-primary);
                font-size: 1.1rem;
            }
            .pui-empty-state p {
                margin: 0;
                color: var(--pui-text-secondary);
                font-size: 0.85rem;
            }

            /* Premium Dispatch Form Overlay */
            .pui-dispatch-form {
                background: linear-gradient(180deg, var(--pui-bg-surface) 0%, var(--pui-bg-card) 100%);
                border: 1px solid var(--pui-border);
                border-radius: 16px;
                overflow: hidden;
                position: sticky;
                top: 0px;
                box-shadow: 0 20px 40px rgba(0,0,0,0.3);
            }
            .pui-dispatch-header {
                background: rgba(0,0,0,0.2);
                padding: 20px;
                border-bottom: 1px solid var(--pui-border);
            }
            .pui-dispatch-header h3 {
                margin: 0;
                font-size: 1.1rem;
                color: var(--pui-text-primary);
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .pui-dispatch-header h3 i {
                color: var(--pui-accent);
            }
            .pui-dispatch-body-form {
                padding: 24px 20px;
            }
            .pui-form-section {
                margin-bottom: 24px;
            }
            .pui-form-section-title {
                margin: 0 0 12px 0;
                font-size: 0.75rem;
                color: var(--pui-text-secondary);
                text-transform: uppercase;
                letter-spacing: 0.1em;
                font-weight: 700;
                border-bottom: 1px solid var(--pui-border-light);
                padding-bottom: 6px;
            }
            .pui-form-row {
                display: flex;
                gap: 12px;
                margin-bottom: 12px;
            }
            .pui-form-row .pui-input-group {
                flex: 1;
                margin-bottom: 0;
            }
            .pui-icao-input {
                font-family: 'JetBrains Mono', monospace;
                text-transform: uppercase;
                font-weight: 700;
                letter-spacing: 0.05em;
            }
            .pui-dispatch-submit {
                width: 100%;
                margin-top: 12px;
                display: flex;
                justify-content: center;
                align-items: center;
                gap: 10px;
                padding: 14px;
                font-size: 1rem;
            }

            /* ─── SETTINGS ───────────────────────────────── */
            .pui-settings-grid {
                display: grid;
                grid-template-columns: 1fr 320px;
                gap: 20px;
            }
            .pui-card-body { padding: 22px; }
            .pui-input-group { margin-bottom: 18px; }
            .pui-input-group label {
                display: block;
                font-size: 0.8rem;
                font-weight: 600;
                color: var(--pui-text-secondary);
                margin-bottom: 7px;
                text-transform: uppercase;
                letter-spacing: 0.06em;
            }
            .pui-input-wrapper {
                position: relative;
                display: flex;
                align-items: center;
            }
            .pui-input-icon {
                position: absolute;
                left: 14px;
                color: var(--pui-text-secondary);
                font-size: 0.85rem;
                pointer-events: none;
            }
            .pui-input {
                width: 100%;
                padding: 11px 14px;
                border: 1px solid var(--pui-border);
                border-radius: 10px;
                background: var(--pui-input-bg);
                color: var(--pui-text-primary);
                font-size: 0.9rem;
                transition: all 0.2s;
                font-family: 'DM Sans', sans-serif;
            }
            .pui-input.has-icon { padding-left: 40px; }
            .pui-input:focus {
                outline: none;
                border-color: var(--pui-accent);
                box-shadow: 0 0 0 3px var(--pui-accent-glow, rgba(0,200,255,0.15));
            }
            .pui-help-text {
                margin: 5px 0 0 0;
                font-size: 0.76rem;
                color: var(--pui-text-secondary);
            }

            /* Theme options */
            .pui-theme-options { display: flex; flex-direction: column; gap: 10px; }
            .pui-theme-option {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 11px 14px;
                border: 1px solid var(--pui-border);
                border-radius: 9px;
                cursor: pointer;
                transition: all 0.2s;
            }
            .pui-theme-option:hover { background: var(--pui-hover); border-color: var(--pui-accent); }
            .pui-theme-option span { color: var(--pui-text-primary); font-weight: 500; font-size: 0.88rem; }

            /* Billing */
            .pui-plan-box {
                background: var(--pui-bg-base);
                border: 1px solid var(--pui-border);
                border-radius: 12px;
                padding: 18px;
            }
            .pui-plan-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 10px;
            }
            .pui-plan-header h4 {
                margin: 0;
                font-size: 1rem;
                color: var(--pui-text-primary);
                font-weight: 700;
            }
            .pui-status-badge {
                padding: 3px 9px;
                border-radius: 6px;
                font-size: 0.7rem;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.08em;
            }
            .pui-status-badge.active   { background: rgba(34,197,94,0.12); color: #4ade80; border: 1px solid rgba(34,197,94,0.2); }
            .pui-status-badge.inactive { background: rgba(239,68,68,0.12); color: #f87171; border: 1px solid rgba(239,68,68,0.2); }
            .pui-plan-price { font-size: 1.5rem; font-weight: 700; color: var(--pui-text-primary); margin: 0 0 3px 0; }
            .pui-plan-renewal { font-size: 0.82rem; color: var(--pui-text-secondary); margin: 0; }

            /* Alerts */
            .pui-alert { padding: 11px 15px; border-radius: 9px; font-size: 0.875rem; font-weight: 500; margin-top: 14px; }
            .pui-alert-success { background: rgba(34,197,94,0.1); color: #4ade80; border: 1px solid rgba(34,197,94,0.2); }
            .pui-alert-error   { background: rgba(239,68,68,0.1); color: #f87171; border: 1px solid rgba(239,68,68,0.2); }

            /* ─── BUTTONS ────────────────────────────────── */
            .pui-form-actions {
                margin-top: 28px;
                padding-top: 20px;
                border-top: 1px solid var(--pui-border-light);
                display: flex;
                justify-content: flex-end;
            }
            .pui-btn-primary {
                background: var(--pui-accent);
                color: #060b14;
                border: none;
                border-radius: 9px;
                padding: 11px 22px;
                font-size: 0.88rem;
                font-weight: 700;
                cursor: pointer;
                transition: all 0.2s;
                font-family: 'DM Sans', sans-serif;
                letter-spacing: 0.01em;
            }
            .pui-btn-primary:hover { filter: brightness(1.1); transform: translateY(-1px); }
            .pui-btn-secondary {
                background: var(--pui-hover);
                color: var(--pui-text-primary);
                border: 1px solid var(--pui-border);
                border-radius: 9px;
                padding: 11px 22px;
                font-size: 0.88rem;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
                font-family: 'DM Sans', sans-serif;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
            }
            .pui-btn-secondary:hover { background: var(--pui-border); }
            .pui-btn-danger-outline {
                width: 100%;
                background: transparent;
                color: #f87171;
                border: 1px solid rgba(239,68,68,0.25);
                border-radius: 9px;
                padding: 11px;
                font-size: 0.875rem;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
                font-family: 'DM Sans', sans-serif;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
            }
            .pui-btn-danger-outline:hover { background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.5); }

            /* ─── RESPONSIVE ─────────────────────────────── */
            @media (max-width: 1100px) {
                .pui-flight-planner-layout {
                    grid-template-columns: 1fr;
                }
                .pui-dispatch-form {
                    position: static;
                }
            }
            @media (max-width: 992px) {
                .pui-dashboard-container { flex-direction: column; height: 95vh; }
                .pui-sidebar {
                    width: 100% !important;
                    height: auto;
                    flex-direction: row;
                    align-items: center;
                    padding: 12px 16px;
                    border-right: none;
                    border-bottom: 1px solid var(--pui-border);
                    gap: 0;
                }
                .pui-sidebar-avatar { 
                    padding: 0 16px 0 0; 
                    border-bottom: none;
                    border-right: 1px solid var(--pui-border);
                    margin-bottom: 0;
                    margin-right: 12px;
                    min-height: unset;
                }
                .pui-sidebar:hover .pui-avatar-tooltip { opacity: 1; transform: none; }
                .pui-nav-menu { flex-direction: row; padding: 0; flex-grow: 0; }
                .pui-nav-label { opacity: 0; width: 0; overflow: hidden; margin: 0; }
                .pui-sidebar:hover .pui-nav-label { opacity: 0; width: 0; }
                .pui-sidebar-footer { padding: 0; border-top: none; border-left: 1px solid var(--pui-border); padding-left: 12px; margin-left: auto; }
                .pui-settings-grid { grid-template-columns: 1fr; }
                .pui-dashboard-split { grid-template-columns: 1fr; }
                
                .pui-flight-ticket { flex-direction: column; }
                .pui-ticket-left { border-right: none; border-bottom: 2px dashed var(--pui-border); flex-direction: row; justify-content: space-between; align-items: center; padding: 14px 20px; }
                .pui-ticket-csign { margin-top: 0; }
                .pui-ticket-right { border-left: none; border-top: 1px solid var(--pui-border-light); flex-direction: row; justify-content: space-around; padding: 14px 20px; }
                .pui-onboarding-card { padding: 30px 20px; }
            }
            /* ─── COMMAND CENTER REDESIGN ──────────────────── */
            .pui-cc-header {
                display: flex;
                justify-content: space-between;
                align-items: flex-end;
                margin-bottom: 24px;
                padding-bottom: 22px;
                border-bottom: 1px solid var(--pui-border);
                flex-wrap: wrap;
                gap: 8px;
            }
            .pui-cc-greeting {
                margin: 0 0 6px 0;
                font-size: 2rem;
                font-weight: 700;
                color: var(--pui-text-primary);
                letter-spacing: -0.035em;
                line-height: 1.1;
            }
            .pui-cc-stat-strip {
                display: flex;
                align-items: center;
                gap: 8px;
                color: var(--pui-text-secondary);
                font-size: 0.8rem;
                font-weight: 500;
            }
            .pui-cc-sep { opacity: 0.35; }
            .pui-cc-date {
                font-size: 0.78rem;
                color: var(--pui-text-secondary);
                font-weight: 500;
                white-space: nowrap;
                padding-bottom: 2px;
                opacity: 0.7;
            }

            /* ─── PREMIUM LIVE FLIGHT CAROUSEL ──────────────────── */
            .pui-live-carousel {
                display: flex;
                gap: 24px;
                overflow-x: auto;
                scroll-snap-type: x mandatory;
                padding-bottom: 32px; 
                margin-bottom: 8px;
                scrollbar-width: none; 
                -ms-overflow-style: none;
                scroll-behavior: smooth;
            }
            .pui-live-carousel::-webkit-scrollbar { 
                display: none; 
            }

            .pui-premium-flight-card {
                position: relative;
                flex: 0 0 calc(100% - 10px);
                max-width: 860px;
                height: 360px; 
                border-radius: 24px;
                overflow: hidden;
                scroll-snap-align: center;
                box-shadow: 0 30px 60px -15px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05);
                transform: translateZ(0); 
                display: flex;
                flex-direction: column;
            }

            /* Cinematic Background */
            .pui-pfc-bg {
                position: absolute;
                inset: -5%; 
                background-size: cover;
                background-position: center;
                transition: transform 12s cubic-bezier(0.25, 1, 0.5, 1);
                z-index: 1;
            }
            .pui-premium-flight-card:hover .pui-pfc-bg {
                transform: scale(1.04);
            }

            /* Premium Composite Overlay */
            .pui-pfc-overlay {
                position: absolute;
                inset: 0;
                background: linear-gradient(to top, rgba(7, 12, 22, 0.95) 0%, rgba(7, 12, 22, 0.2) 35%, transparent 100%);
                z-index: 2;
                pointer-events: none;
            }
            .pui-pfc-overlay::before {
                content: '';
                position: absolute;
                inset: 0;
                background: radial-gradient(circle at 50% 40%, transparent 40%, rgba(0, 0, 0, 0.5) 150%);
            }
            .pui-pfc-overlay::after {
                content: '';
                position: absolute;
                inset: 0;
                background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.04'/%3E%3C/svg%3E");
                opacity: 0.9;
                mix-blend-mode: overlay;
            }

            .pui-pfc-content {
                position: relative;
                z-index: 3;
                height: 100%;
                display: flex;
                flex-direction: column;
                padding: 24px 28px;
            }

            /* Top Bar */
            .pui-pfc-top {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
            }

            /* Top Left Sleek Routing Pill */
            .pui-pfc-top-route {
                display: flex;
                align-items: center;
                gap: 10px;
                background: rgba(10, 15, 25, 0.45);
                backdrop-filter: blur(12px) saturate(140%);
                -webkit-backdrop-filter: blur(12px) saturate(140%);
                padding: 8px 14px;
                border-radius: 20px;
                border: 1px solid rgba(255,255,255,0.08);
                border-top: 1px solid rgba(255,255,255,0.18);
                box-shadow: 0 8px 16px rgba(0,0,0,0.2);
            }
            .pui-pfc-icao {
                font-family: 'JetBrains Mono', monospace;
                font-size: 1rem;
                font-weight: 700;
                color: #fff;
                letter-spacing: 0.05em;
            }
            .pui-pfc-route-icon {
                color: #00c8ff;
                font-size: 0.75rem;
                opacity: 0.8;
                filter: drop-shadow(0 0 4px rgba(0,200,255,0.4));
            }

            /* Top Right Identification */
            .pui-pfc-ident {
                display: flex;
                flex-direction: column;
                align-items: flex-end;
            }
            .pui-pfc-acft {
                font-size: 1rem;
                font-weight: 800;
                color: #fff;
                text-shadow: 0 2px 8px rgba(0,0,0,0.8);
                letter-spacing: 0.02em;
            }
            .pui-pfc-cs {
                font-family: 'JetBrains Mono', monospace;
                font-size: 0.8rem;
                color: #00c8ff;
                font-weight: 700;
                text-shadow: 0 2px 6px rgba(0,0,0,0.8);
            }

            /* Pushes the stats bar to the very bottom */
            .pui-pfc-spacer {
                flex-grow: 1;
            }

            /* Ultra-Slim Glassmorphism Stats Grid */
            .pui-pfc-stats-glass {
                background: linear-gradient(135deg, rgba(255, 255, 255, 0.04) 0%, rgba(255, 255, 255, 0.01) 100%);
                backdrop-filter: blur(24px) saturate(120%);
                -webkit-backdrop-filter: blur(24px) saturate(120%);
                border: 1px solid rgba(255, 255, 255, 0.06);
                border-top: 1px solid rgba(255, 255, 255, 0.15); 
                border-radius: 14px;
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                overflow: hidden;
                box-shadow: 0 12px 32px 0 rgba(0, 0, 0, 0.4);
            }
            .pui-pfc-stat {
                display: flex;
                flex-direction: column;
                padding: 10px 16px; /* Greatly reduced padding */
                border-right: 1px solid rgba(255,255,255,0.06);
                gap: 2px; /* Tighter gap between label and value */
                position: relative;
                justify-content: center;
            }
            .pui-pfc-stat:last-child {
                border-right: none;
            }
            .pui-pfc-stat:hover::before {
                content: '';
                position: absolute;
                inset: 0;
                background: radial-gradient(circle at center, rgba(255,255,255,0.04) 0%, transparent 70%);
                pointer-events: none;
            }
            .pui-pfc-stat .label {
                font-size: 0.55rem; /* Smaller label */
                font-weight: 800;
                text-transform: uppercase;
                letter-spacing: 0.1em;
                color: rgba(255,255,255,0.5);
            }
            .pui-pfc-stat .value {
                font-size: 1.15rem; /* Smaller value */
                font-family: 'JetBrains Mono', monospace;
                font-weight: 700;
                color: #fff;
                line-height: 1;
                display: flex;
                align-items: baseline;
                gap: 4px;
            }
            .pui-pfc-stat .value em {
                font-style: normal;
                font-size: 0.65rem;
                color: rgba(255,255,255,0.45);
                font-weight: 600;
            }

            .pui-pfc-credit {
                position: absolute;
                bottom: 10px;
                right: 16px;
                font-size: 0.55rem;
                color: rgba(255,255,255,0.4);
                font-weight: 600;
                letter-spacing: 0.05em;
                text-shadow: 0 1px 4px rgba(0,0,0,0.8);
                pointer-events: none;
            }

            /* Responsive Adjustments for Carousel */
            @media (max-width: 900px) {
                .pui-premium-flight-card {
                    height: 320px;
                    flex: 0 0 100%;
                }
                .pui-pfc-stats-glass {
                    grid-template-columns: repeat(2, 1fr);
                }
                .pui-pfc-stat {
                    border-bottom: 1px solid rgba(255,255,255,0.06);
                }
                .pui-pfc-stat:nth-child(even) { border-right: none; }
                .pui-pfc-stat:nth-child(3), .pui-pfc-stat:nth-child(4) { border-bottom: none; }
            }
            .pui-cc-grid {
                display: grid;
                grid-template-columns: 1fr 320px;
                gap: 14px;
                flex: 1;
                min-height: 0;
            }
            .pui-cc-section-label {
                font-size: 0.65rem;
                font-weight: 800;
                letter-spacing: 0.13em;
                text-transform: uppercase;
                color: var(--pui-text-secondary);
                opacity: 0.6;
                margin-bottom: 12px;
            }

            /* Recent flights panel */
            .pui-cc-recent {
                background: var(--pui-bg-card);
                border: 1px solid var(--pui-border);
                border-radius: 14px;
                padding: 20px 22px;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                min-height: 0;
            }
            .pui-cc-flights-list {
                display: flex;
                flex-direction: column;
                flex: 1;
                overflow-y: auto;
                scrollbar-width: none;
            }
            .pui-cc-flight-row {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 11px 0;
                border-bottom: 1px solid var(--pui-border-light);
                transition: all 0.15s;
                border-radius: 0;
            }
            .pui-cc-flight-row:last-child { border-bottom: none; }
            .pui-cc-flight-row:hover {
                margin: 0 -22px;
                padding-left: 22px;
                padding-right: 22px;
                background: var(--pui-hover);
            }
            .pui-cc-flight-row-route {
                display: flex;
                align-items: center;
                gap: 8px;
                flex: 1;
                min-width: 0;
            }
            .pui-cc-flight-icao {
                font-family: 'JetBrains Mono', monospace;
                font-size: 0.9rem;
                font-weight: 700;
                color: var(--pui-text-primary);
                white-space: nowrap;
            }
            .pui-cc-flight-arrow {
                color: var(--pui-text-secondary);
                font-size: 0.7rem;
                opacity: 0.4;
                flex-shrink: 0;
            }
            .pui-cc-flight-row-meta {
                display: flex;
                align-items: center;
                gap: 5px;
                font-size: 0.72rem;
                color: var(--pui-text-secondary);
                font-weight: 500;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .pui-cc-flight-row-time {
                font-size: 0.68rem;
                color: var(--pui-text-secondary);
                font-weight: 600;
                white-space: nowrap;
                opacity: 0.5;
                flex-shrink: 0;
            }

            /* Dispatch panel */
            .pui-cc-dispatch {
                background: var(--pui-bg-card);
                border: 1px solid var(--pui-border);
                border-radius: 14px;
                padding: 20px 22px;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }
            .pui-cc-dispatch-route {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 16px 0 18px;
                border-bottom: 1px solid var(--pui-border-light);
                margin-bottom: 16px;
            }
            .pui-cc-dispatch-icao .code {
                font-family: 'JetBrains Mono', monospace;
                font-size: 1.9rem;
                font-weight: 700;
                color: var(--pui-text-primary);
                letter-spacing: -0.025em;
                display: block;
                line-height: 1;
            }
            .pui-cc-dispatch-icao .gate {
                font-size: 0.65rem;
                color: var(--pui-text-secondary);
                font-weight: 600;
                display: block;
                margin-top: 4px;
                opacity: 0.7;
            }
            .pui-cc-dispatch-path {
                flex: 1;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 5px;
                color: var(--pui-text-secondary);
                font-size: 0.68rem;
                font-weight: 600;
                opacity: 0.7;
            }
            .pui-cc-dispatch-path i {
                color: var(--pui-accent);
                font-size: 0.85rem;
                opacity: 1;
            }
            .pui-cc-dispatch-info {
                display: flex;
                flex-direction: column;
                gap: 11px;
                flex: 1;
            }
            .pui-cc-dispatch-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 0.8rem;
            }
            .pui-cc-dispatch-row span {
                color: var(--pui-text-secondary);
                font-weight: 500;
                opacity: 0.8;
            }
            .pui-cc-dispatch-row strong {
                color: var(--pui-text-primary);
                font-weight: 700;
            }
            .pui-cc-dispatch-btn {
                margin-top: auto;
                padding: 14px 0 0 0;
                background: none;
                border: none;
                border-top: 1px solid var(--pui-border-light);
                color: var(--pui-accent);
                font-size: 0.78rem;
                font-weight: 700;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: space-between;
                font-family: 'DM Sans', sans-serif;
                transition: opacity 0.2s;
                letter-spacing: 0.01em;
                width: 100%;
                text-align: left;
            }
            .pui-cc-dispatch-btn:hover { opacity: 0.6; }
            .pui-cc-dispatch-btn i { font-size: 0.7rem; }
            .pui-cc-empty {
                color: var(--pui-text-secondary);
                font-size: 0.82rem;
                text-align: center;
                padding: 20px;
                opacity: 0.6;
            }

            /* CC responsive */
            @media (max-width: 900px) {
                .pui-cc-grid { grid-template-columns: 1fr; }
                .pui-cc-live-img { display: none; }
                .pui-cc-live-icao { font-size: 1.9rem; }
                .pui-cc-greeting { font-size: 1.5rem; }
                .pui-cc-live-stat-value { font-size: 1.05rem; }
            }

        `;

        const style = document.createElement('style');
        style.id = 'pui-dashboard-styles';
        style.innerHTML = css;
        document.head.appendChild(style);
    }
};