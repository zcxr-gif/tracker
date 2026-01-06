/**
 * LandingUI.js
 * REDESIGN: Minimalist Edge-Anchor UI
 * Features: Deconstructed layout, centered command search, floating utility dock.
 */

export const LandingUI = {
    _isVisible: false,

    init() {
        this.injectStyles();
        this.render();
        this.attachListeners();
    },

    render() {
        // Cleanup existing instances
        const existing = document.getElementById('inflight-tactical-ui');
        if (existing) existing.remove();

        const html = `
            <div id="inflight-tactical-ui" class="tactical-ui-root">
                <div class="search-anchor">
                    <div class="search-container-modern">
                        <i class="fa-solid fa-magnifying-glass search-icon-soft"></i>
                        <input type="text" id="tile-search-input" placeholder="Search flights, airports, or callsigns..." autocomplete="off">
                        <div class="search-shortcut">/</div>
                    </div>
                </div>

                <div class="status-anchor">
                    <div class="server-status-card">
                        <div class="status-pulse-container">
                            <div class="pulse-core"></div>
                            <div class="pulse-ring-outer"></div>
                        </div>
                        <div class="server-info">
                            <span class="label-tiny">NETWORK</span>
                            <span id="landing-server-name" class="server-val">EXPERT SERVER</span>
                        </div>
                    </div>
                </div>

                <div class="utility-anchor">
                    <div class="utility-dock">
                        <button class="dock-btn" id="tile-weather" data-tooltip="Weather">
                            <i class="fa-solid fa-cloud-sun"></i>
                        </button>
                        <button class="dock-btn" id="tile-settings" data-tooltip="Map Config">
                            <i class="fa-solid fa-sliders"></i>
                        </button>
                        <button class="dock-btn" id="tile-history" data-tooltip="History">
                            <i class="fa-solid fa-clock-rotate-left"></i>
                        </button>
                        <button class="dock-btn active-btn" id="tile-server" data-tooltip="Server">
                            <i class="fa-solid fa-server"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;

        const container = document.getElementById('sector-ops-map-fullscreen');
        if (container) {
            container.insertAdjacentHTML('beforeend', html);
        }
    },

    update(isActive, stats = {}) {
        const el = document.getElementById('inflight-tactical-ui');
        if (!el) return;

        if (isActive) {
            el.classList.add('active');
            if (stats.server) {
                const serverEl = document.getElementById('landing-server-name');
                if (serverEl) serverEl.textContent = stats.server.toUpperCase();
            }
        } else {
            el.classList.remove('active');
        }
    },

    attachListeners() {
        const searchInput = document.getElementById('tile-search-input');
        const internalSearch = document.querySelector('.search-bar-container input');

        // Global shortcut listener for '/' to focus search
        document.addEventListener('keydown', (e) => {
            if (e.key === '/' && document.activeElement !== searchInput) {
                e.preventDefault();
                searchInput?.focus();
            }
        });

        searchInput?.addEventListener('input', (e) => {
            if (internalSearch) {
                internalSearch.value = e.target.value;
                internalSearch.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });

        const actions = {
            'tile-weather': () => document.getElementById('open-weather-settings-btn')?.click(),
            'tile-settings': () => document.getElementById('open-filter-settings-btn')?.click(),
            'tile-server': () => {
                const btn = document.getElementById('tile-server');
                btn.style.transform = 'scale(0.9)';
                setTimeout(() => btn.style.transform = 'scale(1)', 150);
            }
        };

        Object.entries(actions).forEach(([id, fn]) => {
            document.getElementById(id)?.addEventListener('click', fn);
        });
    },

    injectStyles() {
        const existing = document.getElementById('inflight-ui-styles');
        if (existing) existing.remove();

        const css = `
            .tactical-ui-root {
                position: absolute;
                inset: 0;
                z-index: 2000;
                pointer-events: none;
                opacity: 0;
                visibility: hidden;
                transition: opacity 0.5s ease;
                font-family: 'Inter', -apple-system, sans-serif;
            }

            .tactical-ui-root.active {
                opacity: 1;
                visibility: visible;
            }

            /* Search Anchor - Top Center */
            .search-anchor {
                position: absolute;
                top: 24px;
                left: 50%;
                transform: translateX(-50%);
                width: 100%;
                max-width: 500px;
                pointer-events: auto;
            }

            .search-container-modern {
                background: rgba(15, 17, 23, 0.85);
                backdrop-filter: blur(12px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 12px;
                padding: 10px 16px;
                display: flex;
                align-items: center;
                box-shadow: 0 10px 40px rgba(0,0,0,0.4);
                transition: all 0.3s ease;
            }

            .search-container-modern:focus-within {
                border-color: #6366f1;
                background: rgba(15, 17, 23, 0.95);
                width: 540px;
            }

            .search-icon-soft {
                color: #64748b;
                margin-right: 12px;
                font-size: 0.9rem;
            }

            #tile-search-input {
                background: transparent;
                border: none;
                color: #fff;
                font-size: 0.9rem;
                outline: none;
                width: 100%;
            }

            .search-shortcut {
                background: rgba(255,255,255,0.05);
                border: 1px solid rgba(255,255,255,0.1);
                border-radius: 4px;
                padding: 2px 6px;
                font-size: 0.7rem;
                color: #94a3b8;
                margin-left: 8px;
            }

            /* Status Anchor - Top Right */
            .status-anchor {
                position: absolute;
                top: 24px;
                right: 24px;
                pointer-events: auto;
            }

            .server-status-card {
                background: rgba(15, 17, 23, 0.85);
                backdrop-filter: blur(12px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 12px;
                padding: 8px 16px;
                display: flex;
                align-items: center;
                gap: 12px;
            }

            .status-pulse-container {
                position: relative;
                width: 8px;
                height: 8px;
            }

            .pulse-core {
                width: 8px;
                height: 8px;
                background: #6366f1;
                border-radius: 50%;
            }

            .pulse-ring-outer {
                position: absolute;
                inset: -4px;
                border: 2px solid #6366f1;
                border-radius: 50%;
                animation: pulse-out 2s infinite;
            }

            .server-info {
                display: flex;
                flex-direction: column;
            }

            .label-tiny {
                font-size: 0.55rem;
                font-weight: 800;
                color: #64748b;
                letter-spacing: 0.1em;
            }

            .server-val {
                font-size: 0.75rem;
                font-weight: 600;
                color: #fff;
            }

            /* Utility Anchor - Bottom Right */
            .utility-anchor {
                position: absolute;
                bottom: 30px;
                right: 30px;
                pointer-events: auto;
            }

            .utility-dock {
                background: rgba(15, 17, 23, 0.85);
                backdrop-filter: blur(12px);
                padding: 6px;
                border-radius: 16px;
                display: flex;
                flex-direction: column;
                gap: 6px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            }

            .dock-btn {
                width: 44px;
                height: 44px;
                border-radius: 12px;
                border: none;
                background: transparent;
                color: #94a3b8;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 1.1rem;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            }

            .dock-btn:hover {
                background: rgba(255, 255, 255, 0.05);
                color: #fff;
                transform: translateX(-4px);
            }

            .active-btn {
                color: #6366f1;
                background: rgba(99, 102, 241, 0.1);
            }

            @keyframes pulse-out {
                0% { transform: scale(0.5); opacity: 1; }
                100% { transform: scale(2.5); opacity: 0; }
            }

            @media (max-width: 768px) {
                .tactical-ui-root { display: none !important; }
            }
        `;

        const style = document.createElement('style');
        style.id = 'inflight-ui-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }
};