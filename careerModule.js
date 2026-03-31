/**
 * CareerModule — Advanced Aviation Telemetry & Analytics Dashboard
 * Handles rendering highly granular Grade info, Violations, Workload Indexes, Flight Logs, and ATC Sessions.
 */

export const CareerModule = {
    _atcData: null,
    _flightData: null,
    _loadingData: false,
    _error: null,
    _injectedStyles: false,
    _activeSubTab: 'overview',
    _navListenerAttached: false,
    _reRenderCallback: null,

    // API Enum Mappings
    _frequencyMap: {
        0: "Ground", 1: "Tower", 2: "Unicom", 3: "Clearance", 
        4: "Approach", 5: "Departure", 6: "Center", 7: "ATIS", 
        8: "Aircraft", 9: "Recorded", 10: "Unknown", 11: "Unused"
    },

    _worldTypeMap: {
        0: "Solo", 1: "Casual", 2: "Training", 3: "Expert", 4: "Private"
    },

    formatMinutes(minutes) {
        if (!minutes || minutes <= 0) return "0h 0m";
        const h = Math.floor(minutes / 60);
        const m = Math.floor(minutes % 60);
        return `${h}h ${m}m`;
    },

    calculateRatePerHour(value, minutes) {
        if (!minutes || minutes <= 0 || !value) return "0.0";
        return ((value / minutes) * 60).toFixed(1);
    },

    async loadExtraData(userId, backendUrl, reRenderCallback) {
        if (!userId) {
            this._error = "User ID missing. Auth token required.";
            if (reRenderCallback) reRenderCallback();
            return;
        }
        
        if ((this._atcData && this._flightData) || this._loadingData) return;
        
        this._loadingData = true;
        if (reRenderCallback) reRenderCallback();

        try {
            const [atcRes, flightsRes] = await Promise.all([
                fetch(`${backendUrl}/api/users/${userId}/atc?page=1`),
                fetch(`${backendUrl}/api/users/${userId}/flights?page=1`)
            ]);

            if (!atcRes.ok || !flightsRes.ok) {
                this._error = `HTTP Request Failed - ATC: ${atcRes.status} | Flights: ${flightsRes.status}`;
                this._atcData = [];
                this._flightData = [];
                return;
            }

            const atcJson = await atcRes.json();
            const flightsJson = await flightsRes.json();

            if (atcJson.ok && flightsJson.ok) {
                this._atcData = Array.isArray(atcJson.data) ? atcJson.data : [];
                this._flightData = Array.isArray(flightsJson.flights) ? flightsJson.flights : [];
                this._error = null;
            } else {
                const atcErr = atcJson.error?.message || "Unknown ATC Error";
                const flightErr = flightsJson.error?.message || "Unknown Flight Error";
                this._error = `API Error - ATC: ${atcErr} | Flights: ${flightErr}`;
                this._atcData = [];
                this._flightData = [];
            }
        } catch (err) {
            this._error = "Critical network or parsing failure retrieving telemetry.";
            console.error("Deep Dive Fetch Error:", err);
        } finally {
            this._loadingData = false;
            if (this._reRenderCallback) this._reRenderCallback();
        }
    },

    getHTML(ifData) {
        if (!this._injectedStyles) {
            this._injectStyles();
            this._injectedStyles = true;
        }

        if (ifData.loading) {
            return `<div class="pui-tab-header"><h2>Career Profile</h2><p>Initializing telemetry databanks...</p></div>`;
        }

        if (!ifData.stats) {
            return `
                <div class="pui-tab-header">
                    <h2>Career Profile</h2>
                    <p>Detailed career statistics and logbook.</p>
                </div>
                <div class="pui-alert pui-alert-error">
                    <i class="fa-solid fa-triangle-exclamation" style="margin-right: 8px;"></i> 
                    No Infinite Flight data available. Please link your account in Settings.
                </div>
            `;
        }

        // Using explicit type="button" to prevent accidental form submissions
        const navHTML = `
            <div class="cm-subnav">
                <button type="button" class="cm-subnav-btn ${this._activeSubTab === 'overview' ? 'active' : ''}" data-tab="overview">
                    <i class="fa-solid fa-fingerprint"></i> Overview
                </button>
                <button type="button" class="cm-subnav-btn ${this._activeSubTab === 'enforcement' ? 'active' : ''}" data-tab="enforcement">
                    <i class="fa-solid fa-scale-balanced"></i> Enforcement
                </button>
                <button type="button" class="cm-subnav-btn ${this._activeSubTab === 'flights' ? 'active' : ''}" data-tab="flights">
                    <i class="fa-solid fa-plane-departure"></i> Flight Logs
                </button>
                <button type="button" class="cm-subnav-btn ${this._activeSubTab === 'atc' ? 'active' : ''}" data-tab="atc">
                    <i class="fa-solid fa-tower-observation"></i> ATC Ops
                </button>
            </div>
        `;

        let activeTabHTML = '';
        switch (this._activeSubTab) {
            case 'overview':
                activeTabHTML = this._renderOverview(ifData.stats);
                break;
            case 'enforcement':
                activeTabHTML = this._renderEnforcement(ifData.stats);
                break;
            case 'flights':
                activeTabHTML = this._renderFlights();
                break;
            case 'atc':
                activeTabHTML = this._renderATC();
                break;
            default:
                activeTabHTML = this._renderOverview(ifData.stats);
        }

        return `
            <div class="pui-tab-header">
                <h2>Aviation Dossier</h2>
                <p>Granular telemetry, efficiency indexing, and enforcement tracking.</p>
            </div>
            ${navHTML}
            <div class="cm-tab-content">
                ${activeTabHTML}
            </div>
        `;
    },

_renderOverview(stats) {
        const gradeDetails = stats.gradeDetails || {};
        const vaName = stats.virtualOrganization || 'Independent Operator';
        const discourse = stats.discourseUsername ? `@${stats.discourseUsername}` : 'UNLINKED';
        const groups = Array.isArray(stats.groups) && stats.groups.length > 0 ? stats.groups : ['None'];
        const roles = Array.isArray(stats.roles) && stats.roles.length > 0 ? stats.roles : ['None'];

        // Format flight time using your existing module helper
        const totalFlightTimeStr = stats.flightTime ? this.formatMinutes(stats.flightTime) : '0h 0m';

        return `
            <div class="cm-dashboard-top">
                <div class="cm-global-stat-card">
                    <div class="cm-global-stat-title">Total XP</div>
                    <div class="cm-global-stat-value">${(stats.totalXP || 0).toLocaleString()}</div>
                </div>
                <div class="cm-global-stat-card">
                    <div class="cm-global-stat-title">Flight Time</div>
                    <div class="cm-global-stat-value">${totalFlightTimeStr}</div>
                </div>
                <div class="cm-global-stat-card">
                    <div class="cm-global-stat-title">Landings</div>
                    <div class="cm-global-stat-value">${(stats.landingCount || 0).toLocaleString()}</div>
                </div>
                <div class="cm-global-stat-card">
                    <div class="cm-global-stat-title">Online Flights</div>
                    <div class="cm-global-stat-value">${(stats.onlineFlights || 0).toLocaleString()}</div>
                </div>
                <div class="cm-global-stat-card">
                    <div class="cm-global-stat-title">ATC Operations</div>
                    <div class="cm-global-stat-value">${(stats.atcOperations || 0).toLocaleString()}</div>
                </div>
                <div class="cm-global-stat-card">
                    <div class="cm-global-stat-title">ATC Rank</div>
                    <div class="cm-global-stat-value">${stats.atcRank !== null ? 'Rank ' + stats.atcRank : 'N/A'}</div>
                </div>
                <div class="cm-global-stat-card">
                    <div class="cm-global-stat-title">Current Grade</div>
                    <div class="cm-global-stat-value cm-text-gold">Grade ${gradeDetails.gradeIndex || 'N/A'}</div>
                </div>
            </div>

            <div class="pui-content-card cm-card">
                <div class="pui-card-header cm-header-flex">
                    <h3><i class="fa-solid fa-fingerprint cm-icon-va"></i> Pilot Identification</h3>
                    <span class="pui-pill-route">${vaName}</span>
                </div>
                <div class="pui-card-body cm-grid-2">
                    <div class="cm-data-chunk">
                        <label>IFC Handle</label>
                        <div class="cm-value">${discourse}</div>
                    </div>
                    <div class="cm-data-chunk">
                        <label>Role Identifiers</label>
                        <div class="cm-tags">
                            ${roles.map(r => `<span class="cm-tag cm-tag-role">ROLE_${r}</span>`).join('')}
                        </div>
                    </div>
                    <div class="cm-data-chunk" style="grid-column: 1 / -1;">
                        <label>Community Group UUIDs</label>
                        <div class="cm-tags">
                            ${groups.map(g => `<span class="cm-tag cm-tag-group" title="${g}">${g.split('-')[0]}...</span>`).join('')}
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    _renderEnforcement(stats) {
        const vios = stats.violationCountByLevel || {};
        return `
            <div class="pui-content-card cm-card">
                <div class="pui-card-header cm-header-flex">
                    <h3><i class="fa-solid fa-scale-balanced cm-icon-grade"></i> Enforcement Record</h3>
                    <span class="pui-badge-duration" style="background: #fee2e2; color: #991b1b;">12-Mo Total: ${stats.total12MonthsViolations || 0}</span>
                </div>
                <div class="pui-card-body">
                    <div class="cm-grid-3">
                        <div class="cm-stat-box">
                            <label>L1 (System)</label>
                            <div class="cm-stat-val ${vios.level1 > 0 ? 'cm-warn' : 'cm-good'}">${vios.level1 || 0}</div>
                        </div>
                        <div class="cm-stat-box">
                            <label>L2 (Report)</label>
                            <div class="cm-stat-val ${vios.level2 > 0 ? 'cm-danger' : 'cm-good'}">${vios.level2 || 0}</div>
                        </div>
                        <div class="cm-stat-box">
                            <label>L3 (Ghost)</label>
                            <div class="cm-stat-val ${vios.level3 > 0 ? 'cm-danger' : 'cm-good'}">${vios.level3 || 0}</div>
                        </div>
                    </div>
                    
                    <div class="cm-report-dates" style="margin-top: 24px;">
                        <div class="cm-date-row"><span>Last Lvl 1:</span> <strong>${stats.lastLevel1ViolationDate && stats.lastLevel1ViolationDate !== "0001-01-01T00:00:00" ? new Date(stats.lastLevel1ViolationDate).toLocaleString() : 'CLEAN'}</strong></div>
                        <div class="cm-date-row"><span>Last Lvl 2:</span> <strong>${stats.lastLevel2ViolationDate && stats.lastLevel2ViolationDate !== "0001-01-01T00:00:00" ? new Date(stats.lastLevel2ViolationDate).toLocaleString() : 'CLEAN'}</strong></div>
                        <div class="cm-date-row"><span>Last Lvl 3:</span> <strong>${stats.lastLevel3ViolationDate && stats.lastLevel3ViolationDate !== "0001-01-01T00:00:00" ? new Date(stats.lastLevel3ViolationDate).toLocaleString() : 'CLEAN'}</strong></div>
                        <div class="cm-date-row"><span>Last Report:</span> <strong>${stats.lastReportViolationDate && stats.lastReportViolationDate !== "0001-01-01T00:00:00" ? new Date(stats.lastReportViolationDate).toLocaleString() : 'CLEAN'}</strong></div>
                    </div>
                </div>
            </div>
        `;
    },

    _renderFlights() {
        if (this._loadingData) {
            return `<div class="pui-content-card cm-card"><div class="pui-card-body"><div class="pui-skeleton" style="height: 200px; width: 100%;"></div></div></div>`;
        } 
        
        if (this._error) {
            return `<div class="pui-content-card cm-card"><div class="pui-card-body"><div class="pui-alert pui-alert-error">${this._error}</div></div></div>`;
        }

        if (!this._flightData || this._flightData.length === 0) {
            return `
                <div class="pui-content-card cm-card">
                    <div class="pui-card-body"><p class="cm-empty-state">No flight telemetry logged in active memory.</p></div>
                </div>
            `;
        }

        const flightRows = this._flightData.slice(0, 25).map(flight => {
            const date = flight.created ? new Date(flight.created).toLocaleString() : 'UNKNOWN DATE';
            const route = (flight.originAirport && flight.destinationAirport) 
                ? `${flight.originAirport} <i class="fa-solid fa-arrow-right-long" style="opacity: 0.5;"></i> ${flight.destinationAirport}`
                : `LOCAL/VFR OPs`;
            const serverName = flight.server || this._worldTypeMap[flight.worldType] || "UNKNOWN";
            
            const totalTimeStr = this.formatMinutes(flight.totalTime);
            const dayTimeStr = this.formatMinutes(flight.dayTime);
            const nightTimeStr = this.formatMinutes(flight.nightTime);
            const xpPerHour = this.calculateRatePerHour(flight.xp, flight.totalTime);
            
            const hasVios = flight.violations && flight.violations.length > 0;
            const flightId = flight.id ? flight.id.split('-')[0] : 'N/A';
            const aircraftId = flight.aircraftId ? flight.aircraftId.split('-')[0] : 'N/A';
            const liveryId = flight.liveryId ? flight.liveryId.split('-')[0] : 'N/A';
            
            let vioHTML = '';
            if (hasVios) {
                const vioDetails = flight.violations.map(v => 
                    `<div class="cm-mini-alert"><strong>INFRACTION:</strong> Lvl ${v.level} [${v.type}] - Authorized by ${v.issuedBy ? v.issuedBy.username : 'SYSTEM'}</div>`
                ).join('');
                vioHTML = `<div class="cm-violation-container">${vioDetails}</div>`;
            }

            return `
                <div class="cm-log-item">
                    <div class="cm-log-header">
                        <div class="cm-log-route">${route}</div>
                        <div class="cm-log-date">${date}</div>
                    </div>
                    <div class="cm-log-subdata">
                        FLT_ID: ${flightId} | ACFT_ID: ${aircraftId} | LVR_ID: ${liveryId}
                    </div>
                    <div class="cm-log-metrics">
                        <span title="Callsign"><i class="fa-solid fa-satellite-dish"></i> ${flight.callsign || 'N/A'}</span>
                        <span title="Server"><i class="fa-solid fa-server"></i> ${serverName}</span>
                        <span title="Efficiency"><i class="fa-solid fa-bolt"></i> ${xpPerHour} XP/hr</span>
                        <span title="Landings"><i class="fa-solid fa-plane-arrival"></i> ${flight.landingCount || 0} Lndg</span>
                    </div>
                    <div class="cm-log-time-breakdown">
                        <div class="cm-time-block" style="color: var(--pui-text-primary);">Total: ${totalTimeStr}</div>
                        <div class="cm-time-block"><i class="fa-regular fa-sun"></i> ${dayTimeStr}</div>
                        <div class="cm-time-block"><i class="fa-solid fa-moon"></i> ${nightTimeStr}</div>
                    </div>
                    ${vioHTML}
                </div>
            `;
        }).join('');

        return `
            <div class="pui-content-card cm-card">
                <div class="pui-card-header">
                    <h3><i class="fa-solid fa-plane-departure cm-icon-flight"></i> Flight Telemetry & Efficiency</h3>
                </div>
                <div class="cm-log-group cm-scrollable-large">${flightRows}</div>
            </div>
        `;
    },

    _renderATC() {
        if (this._loadingData) {
            return `<div class="pui-content-card cm-card"><div class="pui-card-body"><div class="pui-skeleton" style="height: 200px; width: 100%;"></div></div></div>`;
        } 
        
        if (this._error) {
            return `<div class="pui-content-card cm-card"><div class="pui-card-body"><div class="pui-alert pui-alert-error">${this._error}</div></div></div>`;
        }

        if (!this._atcData || this._atcData.length === 0) {
            return `
                <div class="pui-content-card cm-card">
                    <div class="pui-card-body"><p class="cm-empty-state">No ATC operations logged in active memory.</p></div>
                </div>
            `;
        }

        const atcRows = this._atcData.slice(0, 25).map(session => {
            const date = session.created ? new Date(session.created).toLocaleString() : 'UNKNOWN DATE';
            const facilityName = session.facility ? session.facility.airportIcao : "UNKNOWN";
            const freqTypeInt = session.facility ? session.facility.frequencyType : 10;
            const freqType = this._frequencyMap[freqTypeInt] || "UNKNOWN";
            
            const lat = session.facility && session.facility.latitude ? session.facility.latitude.toFixed(4) : "N/A";
            const lon = session.facility && session.facility.longitude ? session.facility.longitude.toFixed(4) : "N/A";
            const sessionGroup = session.atcSessionGroupId ? session.atcSessionGroupId.split('-')[0] : "N/A";

            const totalTimeStr = this.formatMinutes(session.totalTime);
            const serverName = session.server || this._worldTypeMap[session.worldType] || "UNKNOWN";
            
            const viosIssued = session.violationsIssued || 0;
            const workloadIndex = this.calculateRatePerHour(session.operations, session.totalTime);
            const enforcementRatio = session.operations > 0 ? ((viosIssued / session.operations) * 100).toFixed(1) : "0.0";

            return `
                <div class="cm-log-item">
                    <div class="cm-log-header">
                        <div class="cm-log-route">${facilityName} ${freqType}</div>
                        <div class="cm-log-date">${date}</div>
                    </div>
                    <div class="cm-log-subdata">
                        SES_GRP: ${sessionGroup} | COORD: [${lat}, ${lon}]
                    </div>
                    <div class="cm-log-metrics">
                        <span title="Server"><i class="fa-solid fa-server"></i> ${serverName}</span>
                        <span title="Total Operations"><i class="fa-solid fa-right-left"></i> ${session.operations || 0} Ops</span>
                        <span title="Total Time"><i class="fa-regular fa-clock"></i> ${totalTimeStr}</span>
                    </div>
                    
                    <div class="cm-log-time-breakdown cm-atc-analytics">
                        <div class="cm-time-block" title="Operations Per Hour (Workload)">
                            <i class="fa-solid fa-chart-line"></i> Workload: ${workloadIndex} OPH
                        </div>
                        <div class="cm-time-block ${viosIssued > 0 ? 'cm-text-danger' : ''}" title="Enforcement Ratio (Violations per Op)">
                            <i class="fa-solid fa-gavel"></i> Enforcement: ${enforcementRatio}% (${viosIssued} Issued)
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="pui-content-card cm-card">
                <div class="pui-card-header cm-header-flex">
                    <h3><i class="fa-solid fa-tower-observation cm-icon-atc"></i> ATC Workload & Enforcement</h3>
                </div>
                <div class="cm-log-group cm-scrollable-large">${atcRows}</div>
            </div>
        `;
    },

    attachListeners(ifData, backendUrl, reRenderCallback) {
        // 1. Store the freshest callback reference so Event Delegation always triggers the right refresh.
        this._reRenderCallback = reRenderCallback;

        // 2. Fetch data if we don't have it
        if (ifData && ifData.userId && !this._atcData && !this._flightData && !this._loadingData) {
            this.loadExtraData(ifData.userId, backendUrl, reRenderCallback);
        }

        // 3. Robust Event Delegation: Attach to the document to survive DOM wipeouts.
        if (!this._navListenerAttached) {
            document.body.addEventListener('click', (e) => {
                const targetBtn = e.target.closest('.cm-subnav-btn');
                if (!targetBtn) return;
                
                e.preventDefault(); // Halt page refreshes/form submissions
                
                const tab = targetBtn.getAttribute('data-tab');
                if (this._activeSubTab !== tab) {
                    this._activeSubTab = tab;
                    if (this._reRenderCallback) this._reRenderCallback();
                }
            });
            this._navListenerAttached = true;
        }
    },

    _injectStyles() {
        if (document.getElementById('cm-deepdive-styles')) return;
        const css = `
            /* Custom Keyframes separate from UI framework */
            @keyframes cmFadeIn {
                0% { opacity: 0; transform: translateY(5px); }
                100% { opacity: 1; transform: translateY(0); }
            }

            .cm-tab-content {
                animation: cmFadeIn 0.3s ease-in-out forwards;
            }

            /* Sub-Navigation System */
            .cm-subnav {
                display: flex;
                gap: 8px;
                margin-bottom: 24px;
                border-bottom: 2px solid var(--pui-border, #e5e7eb);
                padding-bottom: 8px;
                overflow-x: auto;
            }
            .pui-wrapper-layer[data-theme="dark-gray"] .cm-subnav {
                border-bottom-color: rgba(255,255,255,0.1);
            }
            .cm-subnav-btn {
                background: transparent;
                border: none;
                padding: 10px 16px;
                font-family: 'JetBrains Mono', monospace;
                font-size: 0.85rem;
                font-weight: 700;
                color: var(--pui-text-secondary);
                cursor: pointer;
                border-radius: 6px;
                transition: all 0.2s ease;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .cm-subnav-btn:hover {
                background: var(--pui-hover);
                color: var(--pui-text-primary);
            }
            .cm-subnav-btn.active {
                background: var(--pui-bg-card, #ffffff);
                color: #3b82f6;
                box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                border: 1px solid var(--pui-border, #e5e7eb);
            }
            .pui-wrapper-layer[data-theme="dark-gray"] .cm-subnav-btn.active {
                background: rgba(255,255,255,0.05);
                border-color: rgba(255,255,255,0.1);
                color: #60a5fa;
            }
            
            /* Main View Components */
            .cm-dashboard-top {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                gap: 16px;
                margin-bottom: 24px;
            }
            .cm-global-stat-card {
                background: var(--pui-bg-card, #ffffff);
                border: 1px solid var(--pui-border, #e5e7eb);
                border-radius: 8px;
                padding: 16px;
                text-align: center;
                box-shadow: 0 2px 4px rgba(0,0,0,0.02);
            }
            .pui-wrapper-layer[data-theme="dark-gray"] .cm-global-stat-card {
                background: var(--pui-bg-card);
                border-color: rgba(255,255,255,0.05);
            }
            .cm-global-stat-title {
                font-size: 0.7rem;
                text-transform: uppercase;
                letter-spacing: 0.1em;
                color: var(--pui-text-secondary);
                margin-bottom: 8px;
                font-weight: 700;
                font-family: 'JetBrains Mono', monospace;
            }
            .cm-global-stat-value {
                font-size: 1.5rem;
                font-weight: 800;
                font-family: 'JetBrains Mono', monospace;
                color: var(--pui-text-primary);
            }

            .cm-card {
                display: flex;
                flex-direction: column;
                height: 100%;
                border-radius: 8px;
                margin-bottom: 24px;
            }
            .cm-header-flex {
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            
            .cm-icon-va { color: #8b5cf6; margin-right: 8px; }
            .cm-icon-grade { color: #ef4444; margin-right: 8px; }
            .cm-icon-atc { color: #14b8a6; margin-right: 8px; }
            .cm-icon-flight { color: #3b82f6; margin-right: 8px; }
            
            .cm-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
            .cm-grid-3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; }
            
            .cm-data-chunk { display: flex; flex-direction: column; gap: 6px; }
            .cm-data-chunk label { font-size: 0.7rem; text-transform: uppercase; color: var(--pui-text-secondary); font-weight: 700; letter-spacing: 0.1em; font-family: 'JetBrains Mono', monospace; }
            .cm-value { font-size: 0.95rem; color: var(--pui-text-primary); font-weight: 600; font-family: 'JetBrains Mono', monospace; }
            
            .cm-tags { display: flex; flex-wrap: wrap; gap: 6px; }
            .cm-tag { padding: 4px 10px; border-radius: 4px; font-size: 0.7rem; font-weight: 600; font-family: 'JetBrains Mono', monospace; }
            .cm-tag-role { background: rgba(139, 92, 246, 0.1); color: #7c3aed; border: 1px solid rgba(139, 92, 246, 0.2); }
            .pui-wrapper-layer[data-theme="dark-gray"] .cm-tag-role { color: #a78bfa; }
            .cm-tag-group { background: var(--pui-hover); color: var(--pui-text-secondary); border: 1px solid var(--pui-border); cursor: help;}
            
            .cm-stat-box { background: var(--pui-hover); padding: 12px; border-radius: 6px; text-align: center; display: flex; flex-direction: column; gap: 4px; border: 1px solid var(--pui-border-light); }
            .cm-stat-box label { font-size: 0.65rem; color: var(--pui-text-secondary); font-weight: 700; text-transform: uppercase; font-family: 'JetBrains Mono', monospace; }
            .cm-stat-val { font-size: 1.4rem; font-weight: 800; font-family: 'JetBrains Mono', monospace; }
            .cm-good { color: #10b981; }
            .cm-warn { color: #f59e0b; }
            .cm-danger { color: #ef4444; }
            .cm-text-gold { color: #eab308; }
            .cm-text-danger { color: #ef4444 !important; font-weight: bold; }
            
            .cm-report-dates { display: flex; flex-direction: column; gap: 8px; background: var(--pui-hover); padding: 16px; border-radius: 6px; border: 1px solid var(--pui-border-light); }
            .cm-date-row { display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--pui-text-secondary); border-bottom: 1px dashed var(--pui-border); padding-bottom: 6px; font-family: 'JetBrains Mono', monospace; }
            .cm-date-row:last-child { border-bottom: none; padding-bottom: 0; }
            .cm-date-row strong { color: var(--pui-text-primary); }

            .cm-scrollable-large {
                max-height: 700px;
                overflow-y: auto;
            }
            .cm-scrollable-large::-webkit-scrollbar { width: 6px; }
            .cm-scrollable-large::-webkit-scrollbar-track { background: transparent; }
            .cm-scrollable-large::-webkit-scrollbar-thumb { background: var(--pui-border); border-radius: 4px; }

            .cm-log-group { display: flex; flex-direction: column; }
            .cm-log-item { 
                padding: 16px; 
                border-bottom: 1px solid var(--pui-border-light); 
                display: flex; 
                flex-direction: column; 
                gap: 8px;
                transition: background 0.2s;
            }
            .cm-log-item:hover { background: var(--pui-hover); }
            .cm-log-item:last-child { border-bottom: none; }
            
            .cm-log-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .cm-log-route {
                font-weight: 700;
                font-size: 1rem;
                color: var(--pui-text-primary);
                font-family: 'JetBrains Mono', monospace;
            }
            .cm-log-date {
                font-size: 0.75rem;
                color: var(--pui-text-secondary);
                font-weight: 600;
                font-family: 'JetBrains Mono', monospace;
            }
            
            .cm-log-subdata {
                font-family: 'JetBrains Mono', monospace;
                font-size: 0.65rem;
                color: var(--pui-text-secondary);
                opacity: 0.7;
                letter-spacing: 0.05em;
            }

            .cm-log-metrics {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                font-size: 0.75rem;
                color: var(--pui-text-secondary);
                margin-top: 4px;
                font-family: 'JetBrains Mono', monospace;
            }
            .cm-log-metrics span {
                display: flex;
                align-items: center;
                gap: 6px;
                background: var(--pui-hover);
                padding: 4px 8px;
                border-radius: 4px;
                border: 1px solid var(--pui-border-light);
            }
            .cm-log-metrics i { opacity: 0.7; }

            .cm-log-time-breakdown {
                display: flex;
                gap: 12px;
                font-size: 0.7rem;
                color: var(--pui-text-secondary);
                background: rgba(0,0,0,0.02);
                padding: 6px 10px;
                border-radius: 4px;
                border: 1px solid var(--pui-border-light);
                margin-top: 4px;
                font-family: 'JetBrains Mono', monospace;
            }
            .pui-wrapper-layer[data-theme="dark-gray"] .cm-log-time-breakdown { background: rgba(255,255,255,0.02); }
            .cm-atc-analytics {
                background: rgba(20, 184, 166, 0.05);
                border-color: rgba(20, 184, 166, 0.2);
            }
            .cm-time-block { display: flex; align-items: center; gap: 6px; }

            .cm-violation-container {
                display: flex;
                flex-direction: column;
                gap: 4px;
                margin-top: 6px;
            }
            .cm-mini-alert {
                background: rgba(239, 68, 68, 0.05);
                color: #ef4444;
                border-left: 2px solid #ef4444;
                padding: 6px 10px;
                font-size: 0.7rem;
                font-family: 'JetBrains Mono', monospace;
            }

            .cm-empty-state {
                text-align: center;
                color: var(--pui-text-secondary);
                padding: 32px 16px;
                font-family: 'JetBrains Mono', monospace;
                font-size: 0.8rem;
                text-transform: uppercase;
                letter-spacing: 0.1em;
            }
        `;
        const style = document.createElement('style');
        style.id = 'cm-deepdive-styles';
        style.innerHTML = css;
        document.head.appendChild(style);
    }
};