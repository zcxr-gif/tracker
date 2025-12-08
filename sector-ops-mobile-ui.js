const MobileUIHandler = {
    // --- CONFIGURATION ---
    CONFIG: {
        breakpoint: 992, // The max-width in pixels to trigger mobile view
        defaultMode: 'legacy', // Default is 'legacy' sheet
        legacyPeekHeight: 280, // Height of the "peek" state for legacy sheet
    },

    // --- STATE ---
    isMobile: () => window.innerWidth <= MobileUIHandler.CONFIG.breakpoint,
    activeWindow: null, // The *original* hidden info window
    activeMode: 'legacy', // Defaults to legacy
    topWindowEl: null, // HUD Mode: Top window
    overlayEl: null, // Shared: Overlay
    closeTimer: null,
    
    // [HUD] Island elements
    miniIslandEl: null,
    peekIslandEl: null,
    expandedIslandEl: null,
    
    contentObserver: null,
    drawerState: 0, // HUD Mode: 0 = Mini, 1 = Peek, 2 = Expanded
    
    // [LEGACY] Sheet state
    legacySheetState: {
        isDragging: false,
        touchStartY: 0,
        currentSheetY: 0,
        startSheetY: 0,
        currentState: 'peek', // 'peek' or 'expanded'
    },
    
    swipeState: { // HUD Mode
        touchStartY: 0,
        isDragging: false,
    },

    // Bound event handlers for document listeners
    boundHudTouchEnd: null,
    boundLegacyTouchMove: null,
    boundLegacyTouchEnd: null,

    /**
     * Restores the main map UI controls and clears any inline styles.
     */
    restoreMapControls() {
        const burgerMenu = document.getElementById('mobile-sidebar-toggle');
        const mapToolbar = document.getElementById('toolbar-toggle-panel-btn')?.parentElement;
        const searchBar = document.getElementById('sector-ops-search-container');
        
        if (burgerMenu) burgerMenu.style.display = ''; 
        if (mapToolbar) mapToolbar.style.display = '';
        if (searchBar) searchBar.style.display = '';
        
        const mapContainer = document.getElementById('sector-ops-map-fullscreen');
        if (mapContainer) mapContainer.classList.remove('mobile-ui-active');
    },

    /**
     * Initializes the handler by injecting the new HUD styles.
     */
    init() {
        this.injectMobileStyles();

        this.boundHudTouchEnd = this.handleHudTouchEnd.bind(this);
        this.boundLegacyTouchMove = this.handleLegacyTouchMove.bind(this);
        this.boundLegacyTouchEnd = this.handleLegacyTouchEnd.bind(this);
        
        console.log("Mobile UI Handler (Airport Fixed) Initialized.");
    },

    /**
     * Injects all the CSS for mobile views.
     */
    injectMobileStyles() {
        const styleId = 'mobile-sector-ops-styles';
        if (document.getElementById(styleId)) document.getElementById(styleId).remove();

        const css = `
            :root {
                --hud-bg: rgba(10, 15, 28, 0.85);
                --hud-blur: 15px;
                --hud-top-window-height: 50px;
                --hud-border: rgba(0, 168, 255, 0.3);
                --hud-accent: #00a8ff;
                --hud-glow: 0 0 15px rgba(0, 168, 255, 0.5);
                
                --drawer-peek-content-height: 200px;
                --island-bottom-margin: env(safe-area-inset-bottom, 15px);
                --island-side-margin: 10px;

                --legacy-peek-height: ${this.CONFIG.legacyPeekHeight}px;
                --legacy-top-offset: env(safe-area-inset-top, 15px);
            }
            
            #sector-ops-map-fullscreen.mobile-ui-active {
                position: relative;
                overflow: hidden;
            }

            @media (max-width: ${this.CONFIG.breakpoint}px) {
                #sector-ops-search-container {
                    position: absolute !important;
                    top: calc(env(safe-area-inset-top, 20px) + 10px) !important; 
                    left: 50% !important;
                    transform: translateX(-50%) !important;
                    width: calc(100% - 32px) !important; 
                    max-width: 450px !important;
                    z-index: 1030 !important;
                    pointer-events: auto !important;
                }

                #sector-ops-search-container .search-bar-container {
                    display: flex !important;
                    align-items: center !important;
                    background: rgba(15, 20, 35, 0.90) !important;
                    backdrop-filter: blur(20px) !important;
                    -webkit-backdrop-filter: blur(20px) !important;
                    border: 1px solid rgba(255, 255, 255, 0.1) !important;
                    border-radius: 50px !important; 
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5) !important;
                    padding: 0 6px !important;
                    height: 50px !important;
                    transition: all 0.3s ease !important;
                }
                
                #sector-ops-search-container:focus-within .search-bar-container {
                    border-color: var(--hud-accent) !important;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), 0 0 15px rgba(0, 168, 255, 0.2) !important;
                }

                #sector-ops-search-container .search-icon-label {
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    width: 40px !important;
                    height: 40px !important;
                    margin: 0 !important;
                    color: var(--hud-accent) !important;
                    opacity: 0.8;
                }

                #sector-ops-search-input {
                    flex-grow: 1 !important;
                    height: 100% !important;
                    background: transparent !important;
                    border: none !important;
                    color: #fff !important;
                    font-family: 'Segoe UI', sans-serif !important;
                    font-weight: 500 !important;
                    font-size: 16px !important;
                    padding: 0 8px !important;
                    outline: none !important;
                    border-radius: 0 !important;
                    -webkit-appearance: none !important;
                }
                
                #sector-ops-search-input::placeholder {
                    color: rgba(255, 255, 255, 0.4) !important;
                }

                #sector-ops-search-clear {
                    background: rgba(255, 255, 255, 0.1) !important;
                    color: #fff !important;
                    border: none !important;
                    border-radius: 50% !important;
                    width: 28px !important;
                    height: 28px !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    margin-right: 6px !important;
                    cursor: pointer !important;
                    font-size: 0.9rem !important;
                }
                
                #search-results-dropdown {
                    margin-top: 12px !important;
                    width: 100% !important;
                    background: rgba(15, 20, 35, 0.95) !important;
                    backdrop-filter: blur(25px) !important;
                    -webkit-backdrop-filter: blur(25px) !important;
                    border: 1px solid rgba(255, 255, 255, 0.08) !important;
                    border-radius: 16px !important;
                    overflow: hidden !important;
                    box-shadow: 0 15px 50px rgba(0, 0, 0, 0.6) !important;
                    max-height: 60vh !important;
                    overflow-y: auto !important;
                }
                
                .search-result-item {
                    padding: 14px 20px !important;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.05) !important;
                    display: flex !important;
                    align-items: center !important;
                    gap: 15px !important;
                }
                
                .search-result-item i {
                    color: var(--hud-accent) !important;
                    font-size: 1.1rem !important;
                    opacity: 0.8;
                }
                
                .search-result-info strong {
                    font-size: 1rem !important;
                    color: #fff !important;
                }
                
                .search-result-info small {
                    font-size: 0.85rem !important;
                    color: #9fa8da !important;
                }
                
                .search-result-item:active {
                    background: rgba(0, 168, 255, 0.15) !important;
                }
            }

            #mobile-window-overlay {
                position: absolute;
                inset: 0;
                background: rgba(0, 0, 0, 0.7);
                backdrop-filter: blur(5px);
                z-index: 1040;
                opacity: 0;
                transition: opacity 0.4s ease;
                pointer-events: none;
            }
            #mobile-window-overlay.visible { opacity: 1; pointer-events: auto; }

            /* --- Base Island Class --- */
            .mobile-aircraft-view {
                position: absolute;
                background: var(--hud-bg);
                backdrop-filter: blur(var(--hud-blur));
                -webkit-backdrop-filter: blur(var(--hud-blur));
                border: 1px solid var(--hud-border);
                z-index: 1045;
                transition: transform 0.45s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease;
                will-change: transform, opacity;
                box-shadow: 0 10px 40px rgba(0,0,0,0.5), var(--hud-glow);
                color: #e8eaf6;
                border-radius: 16px;
                overflow: hidden;
            }

            #mobile-aircraft-top-window {
                top: env(safe-area-inset-top, 15px);
                left: var(--island-side-margin);
                right: var(--island-side-margin);
                max-height: 250px;
                transform: translateY(-250%);
                opacity: 0;
            }
            #mobile-aircraft-top-window.visible {
                transform: translateY(0);
                opacity: 1;
            }

            .mobile-island-bottom {
                position: absolute;
                left: var(--island-side-margin);
                right: var(--island-side-margin);
                background: var(--hud-bg);
                backdrop-filter: blur(var(--hud-blur));
                -webkit-backdrop-filter: blur(var(--hud-blur));
                border: 1px solid var(--hud-border);
                box-shadow: 0 10px 40px rgba(0,0,0,0.5), var(--hud-glow);
                color: #e8eaf6;
                border-radius: 16px;
                display: flex;
                flex-direction: column;
                transition: transform 0.45s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease;
                will-change: transform, opacity;
                transform: translateY(120%);
                opacity: 0;
                z-index: 1045;
                overflow: hidden;
            }
            
            .mobile-island-bottom.island-active {
                transform: translateY(0);
                opacity: 1;
            }

            #mobile-island-mini {
                bottom: var(--island-bottom-margin);
                height: auto; 
                display: flex;
                flex-direction: column; 
            }
            
            #mobile-island-peek {
                bottom: var(--island-bottom-margin);
                height: auto; 
            }
            
            #mobile-island-expanded {
                top: 280px; 
                bottom: var(--island-bottom-margin);
                height: auto; 
            }

            .route-summary-wrapper-mobile {
                flex-shrink: 0;
                overflow: hidden;
                border-top-left-radius: 16px;
                border-top-right-radius: 16px;
                cursor: grab;
                touch-action: none;
                user-select: none;
                position: relative;
                background: var(--hud-bg);
            }
            
            .route-summary-wrapper-mobile::before {
                content: '';
                position: absolute;
                left: 50%;
                transform: translateX(-50%);
                top: 8px; 
                width: 40px; 
                height: 4px; 
                background: var(--hud-border);
                border-radius: 2px; 
                opacity: 0.5;
            }
            
            #mobile-island-mini .route-summary-wrapper-mobile::before {
                opacity: 0.3;
            }

            .route-summary-wrapper-mobile .route-summary-overlay {
                position: relative; 
                margin-bottom: 0;
                background: var(--hud-bg);
                border-radius: 0;
                padding: 12px 15px 12px 15px; 
                grid-template-columns: auto 1fr auto;
                gap: 12px;
            }
            .route-summary-wrapper-mobile .route-summary-airport .icao {
                font-size: 1.0rem;
            }
            .route-summary-wrapper-mobile .route-summary-airport .time {
                font-size: 0.75rem;
                margin-top: 2px;
            }
            .route-summary-wrapper-mobile .route-summary-airport .country-flag {
                width: 16px;
            }
            .route-summary-wrapper-mobile .flight-phase-indicator {
                padding: 3px 10px;
                font-size: 0.7rem;
            }
            #mobile-island-mini .route-summary-wrapper-mobile .progress-bar-fill,
            #mobile-island-peek .route-summary-wrapper-mobile .progress-bar-fill {
                display: none;
            }
            #mobile-island-mini .route-summary-wrapper-mobile .route-progress-bar-container,
            #mobile-island-peek .route-summary-wrapper-mobile .route-progress-bar-container {
                 background: rgba(10, 12, 26, 0.4);
            }

            .drawer-content {
                overflow-y: auto;
                flex-grow: 1;
                padding-bottom: env(safe-area-inset-bottom, 0);
                height: var(--drawer-peek-content-height);
            }
            #mobile-island-peek .drawer-content {
                overflow: hidden;
            }
            #mobile-island-expanded .drawer-content {
                height: auto;
            }
            
            .drawer-content::-webkit-scrollbar { width: 6px; }
            .drawer-content::-webkit-scrollbar-track { background: transparent; }
            .drawer-content::-webkit-scrollbar-thumb { background-color: var(--hud-accent); border-radius: 10px; }

            #mobile-island-peek .drawer-content {
                padding: 10px;
                box-sizing: border-box;
                height: var(--drawer-peek-content-height); 
                display: flex;
                flex-direction: column;
            }
            
            #mobile-island-peek .unified-display-main-content {
                padding: 0 !important;
                gap: 10px;
                height: 100%;
                overflow: hidden;
            }

            #mobile-island-peek .pfd-main-panel { display: none !important; }
            #mobile-island-peek .ac-profile-card-new { display: none !important; }
            #mobile-island-peek .vsd-disclaimer { display: none !important; }
            #mobile-island-peek #vsd-panel { display: none !important; }

            #mobile-island-peek #location-data-panel {
                padding: 10px;
                flex-shrink: 0;
                border-top-width: 0;
                background: rgba(10, 12, 26, 0.5) !important;
            }
            #mobile-island-peek #location-data-panel .data-value {
                font-size: 1.0rem;
                margin-top: 4px;
            }
            #mobile-island-peek .flight-data-bar {
                padding: 10px;
                gap: 8px;
                grid-template-columns: repeat(auto-fit, minmax(70px, 1fr));
                flex-grow: 1;
                overflow: hidden;
                border-top-width: 0;
            }
            #mobile-island-peek .flight-data-bar .data-label { font-size: 0.6rem; }
            #mobile-island-peek .flight-data-bar .data-value { font-size: 1.1rem; }
            #mobile-island-peek .flight-data-bar .data-value .unit { font-size: 0.7rem; }

            #mobile-island-expanded .unified-display-main-content {
                display: flex !important;
                flex-direction: column;
                gap: 16px;
                height: auto;
                overflow: hidden;
                padding: 16px;
            }
            #mobile-island-expanded .pfd-main-panel {
                display: flex !important;
                margin: 0 auto !important;
                max-width: 400px !important;
            }
             #mobile-island-expanded .ac-profile-card-new {
                display: flex !important;
            }
            #mobile-island-expanded .vsd-disclaimer {
                display: block !important;
            }
            #mobile-island-expanded .live-data-panel {
                justify-content: space-around !important;
                background: rgba(10, 12, 26, 0.5) !important;
                border-radius: 12px !important;
                padding: 16px !important;
            }
            #mobile-island-expanded .live-data-item .data-label { font-size: 0.7rem; }
            #mobile-island-expanded .live-data-item .data-value { font-size: 1.5rem; }
            #mobile-island-expanded .live-data-item .data-value .unit { font-size: 0.8rem; }
            #mobile-island-expanded .live-data-item .data-value-ete { font-size: 1.7rem; }
            
            #mobile-island-expanded .pilot-stats-toggle-btn {
                display: flex;
                background: rgba(10, 12, 26, 0.5);
                border-radius: 12px;
                padding: 16px;
                box-sizing: border-box;
                justify-content: center;
                align-items: center;
                text-decoration: none;
                color: var(--hud-accent);
                font-weight: 600;
                font-size: 1rem;
                margin-top: 16px;
            }

            /* --- LEGACY SHEET MODE --- */
            .mobile-legacy-sheet {
                display: flex !important; 
                position: absolute !important;
                top: auto !important; 
                bottom: 0 !important;
                left: 0 !important;
                right: 0 !important;
                width: 100% !important;
                max-width: 100% !important;
                max-height: calc(100vh - var(--legacy-top-offset)) !important;
                z-index: 1045 !important;
                border-radius: 16px 16px 0 0 !important;
                box-shadow: 0 -5px 30px rgba(0,0,0,0.4) !important;
                will-change: transform;
                transform: translateY(100%); 
                transition: transform 0.45s cubic-bezier(0.16, 1, 0.3, 1);
            }

            .mobile-legacy-sheet.visible.peek {
                transform: translateY(calc(100% - var(--legacy-peek-height)));
            }

            .mobile-legacy-sheet.visible:not(.peek) {
                transform: translateY(var(--hud-top-window-height));
            }
            
            .legacy-sheet-handle {
                position: relative;
                flex-shrink: 0;
                cursor: grab;
                touch-action: none;
                user-select: none;
            }
            
            .legacy-sheet-handle::before {
                content: '';
                position: absolute;
                left: 50%;
                transform: translateX(-50%);
                top: 8px; 
                width: 40px; 
                height: 4px; 
                background: var(--hud-border);
                border-radius: 2px; 
                opacity: 0.5;
                z-index: 10; 
            }

            .legacy-sheet-handle.simple-mode {
                position: absolute !important; 
                top: 0 !important;
                left: 0 !important;
                width: 100% !important;
                height: 40px !important; 
                padding-bottom: 40px !important; 
                background: linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%) !important;
                border: none !important;
                border-radius: 16px 16px 0 0 !important;
                display: flex !important;
                justify-content: center !important;
                flex-shrink: 0 !important;
                z-index: 2000 !important; 
                box-sizing: content-box !important;
                pointer-events: auto !important; 
            }
            
            .legacy-sheet-handle.simple-mode::before {
                top: 8px !important; 
                width: 60px !important; 
                height: 5px !important; 
                background: rgba(255, 255, 255, 0.4) !important;
                box-shadow: 0 1px 4px rgba(0,0,0,0.5) !important;
            }

            .mobile-legacy-sheet .info-window-content {
                overflow-y: auto !important;
                padding-bottom: env(safe-area-inset-bottom, 20px);
            }

            @media (max-width: ${this.CONFIG.breakpoint}px) {
                #aircraft-info-window:not(.mobile-legacy-sheet), 
                #airport-info-window:not(.mobile-legacy-sheet) { /* Update: Hide airport window too unless in mobile mode */
                    display: none !important;
                }
            }
        `;
        const style = document.createElement('style');
        style.id = styleId;
        style.type = 'text/css';
        style.appendChild(document.createTextNode(css));
        document.head.appendChild(style);
    },

    /**
     * Intercepts the window open command.
     * Acts as a ROUTER.
     */
    openWindow(windowElement) {
        if (!this.isMobile()) return;

        if (this.activeWindow) {
            this.closeActiveWindow(true); // 'true' = force close
        }

        // Add 'mobile-ui-active' class to the map container
        const mapContainer = document.getElementById('sector-ops-map-fullscreen');
        if (mapContainer) mapContainer.classList.add('mobile-ui-active');

        // Hide desktop controls
        const burgerMenu = document.getElementById('mobile-sidebar-toggle');
        const mapToolbar = document.getElementById('toolbar-toggle-panel-btn')?.parentElement;
        const searchBar = document.getElementById('sector-ops-search-container');
        
        if (burgerMenu) burgerMenu.style.display = 'none';
        if (mapToolbar) mapToolbar.style.display = 'none';
        if (searchBar) searchBar.style.display = 'none';

        // --- ROUTER LOGIC ---
        
        // 1. AIRPORT WINDOW (Force Legacy Mode)
        if (windowElement.id === 'airport-info-window') {
            this.activeMode = 'legacy'; 
            this.activeWindow = windowElement;
            this.createLegacySheetUI();
            this.observeOriginalWindow(windowElement); // Observe for .airport-hero
            return;
        }

        // 2. AIRCRAFT WINDOW
        if (windowElement.id === 'aircraft-info-window') {
            // Check for Simple Mode
            const isSimpleMode = !!windowElement.querySelector('#simple-flight-window-frame');
            
            // Get user preference
            let userMode = localStorage.getItem('mobileDisplayMode') || this.CONFIG.defaultMode;

            // Force Legacy if Simple Mode
            if (isSimpleMode) {
                userMode = 'legacy';
            }

            this.activeMode = userMode;
            this.activeWindow = windowElement;

            if (userMode === 'legacy') {
                this.createLegacySheetUI();
                this.observeOriginalWindow(windowElement);
            } else {
                this.createSplitViewUI();
                this.observeOriginalWindow(windowElement);
            }
        }
    },

    /**
     * Creates the DOM for the "Legacy Sheet" mode.
     */
    createLegacySheetUI() {
        const viewContainer = document.getElementById('sector-ops-map-fullscreen');
        if (!viewContainer) return;

        // 1. Overlay
        this.overlayEl = document.createElement('div');
        this.overlayEl.id = 'mobile-window-overlay';
        viewContainer.appendChild(this.overlayEl);
        
        // 2. Add class to the *original* window
        this.activeWindow.classList.add('mobile-legacy-sheet');
        this.activeWindow.style.display = 'flex';
    },

    /**
     * Creates the new DOM structure for the HUD.
     */
    createSplitViewUI() {
        const viewContainer = document.getElementById('sector-ops-map-fullscreen');
        if (!viewContainer) return;

        this.overlayEl = document.createElement('div');
        this.overlayEl.id = 'mobile-window-overlay';
        viewContainer.appendChild(this.overlayEl);
        
        this.topWindowEl = document.createElement('div');
        this.topWindowEl.id = 'mobile-aircraft-top-window';
        this.topWindowEl.className = 'mobile-aircraft-view';
        viewContainer.appendChild(this.topWindowEl);

        this.miniIslandEl = document.createElement('div');
        this.miniIslandEl.id = 'mobile-island-mini';
        this.miniIslandEl.className = 'mobile-island-bottom';
        this.miniIslandEl.innerHTML = `<div class="route-summary-wrapper-mobile"></div>`;
        viewContainer.appendChild(this.miniIslandEl);

        this.peekIslandEl = document.createElement('div');
        this.peekIslandEl.id = 'mobile-island-peek';
        this.peekIslandEl.className = 'mobile-island-bottom';
        this.peekIslandEl.innerHTML = `
            <div class="route-summary-wrapper-mobile"></div>
            <div class="drawer-content"></div>
        `;
        viewContainer.appendChild(this.peekIslandEl);
        
        this.expandedIslandEl = document.createElement('div');
        this.expandedIslandEl.id = 'mobile-island-expanded';
        this.expandedIslandEl.className = 'mobile-island-bottom';
        this.expandedIslandEl.innerHTML = `
            <div class="route-summary-wrapper-mobile"></div>
            <div id="expanded-tabs-slot"></div>
            <div class="drawer-content"></div>
        `;
        viewContainer.appendChild(this.expandedIslandEl);
    },

    /**
     * Observes the original window for content.
     */
    observeOriginalWindow(windowElement) {
        if (this.contentObserver) this.contentObserver.disconnect();
        
        this.contentObserver = new MutationObserver((mutationsList, obs) => {
            const mainContent = windowElement.querySelector('.unified-display-main-content');
            const attitudeGroup = mainContent?.querySelector('#attitude_group');
            const simpleIframe = windowElement.querySelector('#simple-flight-window-frame');
            
            // --- [NEW] Check for Airport Content ---
            const airportHero = windowElement.querySelector('.airport-hero');

            // Conditions
            const isStandardAircraft = mainContent && attitudeGroup && attitudeGroup.dataset.initialized === 'true';
            const isSimpleAircraft = !!simpleIframe;
            const isAirport = !!airportHero; // Content is ready if hero exists
            
            if (isStandardAircraft || isSimpleAircraft || isAirport) {
                
                if (this.activeMode === 'legacy') {
                    // 1. Populate
                    this.populateLegacySheet(windowElement);
                    
                    // 2. Animate
                    if (this.activeWindow) {
                        setTimeout(() => {
                            this.activeWindow.classList.add('visible', 'peek');
                            this.legacySheetState.currentState = 'peek';
                        }, 10);
                    }

                } else { // 'hud' mode (only for aircraft)
                    this.populateSplitView(windowElement);
                    setTimeout(() => {
                        if (this.topWindowEl) this.topWindowEl.classList.add('visible');
                        if (this.miniIslandEl) this.miniIslandEl.classList.add('island-active');
                        this.drawerState = 0; 
                    }, 10);
                }
                
                obs.disconnect();
                this.contentObserver = null;
            }
        });
        
        this.contentObserver.observe(windowElement, { 
            childList: true, 
            subtree: true,
            attributes: true
        });
    },

    /**
     * Wires up interactions for the "Legacy Sheet" mode.
     */
    populateLegacySheet(sourceWindow) {
        const handleWrapper = document.createElement('div');
        handleWrapper.className = 'legacy-sheet-handle';

        // --- 1. Simple Aircraft Mode ---
        const simpleIframe = sourceWindow.querySelector('#simple-flight-window-frame');
        if (simpleIframe) {
            handleWrapper.classList.add('simple-mode'); 
            sourceWindow.prepend(handleWrapper);
            sourceWindow.style.position = 'relative'; 
        } 
        else {
            // --- 2. Standard Aircraft Mode ---
            const overviewPanel = sourceWindow.querySelector('.aircraft-overview-panel');
            const routeSummaryBar = sourceWindow.querySelector('.route-summary-overlay');

            if (overviewPanel && routeSummaryBar) {
                sourceWindow.prepend(handleWrapper);
                handleWrapper.appendChild(overviewPanel);
                handleWrapper.appendChild(routeSummaryBar);
            } 
            // --- 3. [NEW] Airport Mode ---
            else {
                const aptHero = sourceWindow.querySelector('.airport-hero');
                const aptStrip = sourceWindow.querySelector('.apt-quick-info-strip');
                
                if (aptHero) {
                    sourceWindow.prepend(handleWrapper);
                    handleWrapper.appendChild(aptHero);
                    if (aptStrip) {
                        handleWrapper.appendChild(aptStrip); // Add strip to handle so it's draggable too
                    }
                }
            }
        }
        
        // Wire up interactions
        this.wireUpLegacySheetInteractions(sourceWindow, handleWrapper);
    },

    /**
     * Moves content from the original window into the new island components.
     */
    populateSplitView(sourceWindow) {
        if (!this.topWindowEl || !this.miniIslandEl || !this.peekIslandEl || !this.expandedIslandEl) return;

        const miniRouteContainer = this.miniIslandEl.querySelector('.route-summary-wrapper-mobile');
        const peekRouteContainer = this.peekIslandEl.querySelector('.route-summary-wrapper-mobile');
        const expandedRouteContainer = this.expandedIslandEl.querySelector('.route-summary-wrapper-mobile');
        
        const peekContentContainer = this.peekIslandEl.querySelector('.drawer-content');
        const expandedContentContainer = this.expandedIslandEl.querySelector('.drawer-content');
        const expandedTabsSlot = this.expandedIslandEl.querySelector('#expanded-tabs-slot');

        if (!peekContentContainer || !expandedContentContainer || !miniRouteContainer || !peekRouteContainer || !expandedRouteContainer || !expandedTabsSlot) return; 

        const topOverviewPanel = sourceWindow.querySelector('.aircraft-overview-panel');
        const routeSummaryBar = sourceWindow.querySelector('.route-summary-overlay');
        const tabContainer = sourceWindow.querySelector('.ac-info-window-tabs');
        const mainFlightContent = sourceWindow.querySelector('.unified-display-main-content');
        
        if (topOverviewPanel) {
            this.topWindowEl.appendChild(topOverviewPanel);
        }
        
        if (routeSummaryBar) {
            const clonedRouteBar1 = routeSummaryBar.cloneNode(true);
            const clonedRouteBar2 = routeSummaryBar.cloneNode(true);
            const clonedRouteBar3 = routeSummaryBar.cloneNode(true);
            
            miniRouteContainer.appendChild(clonedRouteBar1);
            peekRouteContainer.appendChild(clonedRouteBar2);
            expandedRouteContainer.appendChild(clonedRouteBar3);
        }
        
        if (mainFlightContent && tabContainer) {
            expandedContentContainer.appendChild(mainFlightContent);
            expandedTabsSlot.appendChild(tabContainer);
            
            const peekContentClone = document.createElement('div');
            peekContentClone.className = 'unified-display-main-content';

            const pfdLocationGrid = mainFlightContent.querySelector('.pfd-and-location-grid')?.cloneNode(true);
            if (pfdLocationGrid) {
                 peekContentClone.appendChild(pfdLocationGrid);
            }

            const dataBar = mainFlightContent.querySelector('.flight-data-bar')?.cloneNode(true);
            if (dataBar) {
                 peekContentClone.appendChild(dataBar);
            }
            
            peekContentContainer.appendChild(peekContentClone);
        }
        
        this.wireUpHudInteractions();
    },

    /**
     * Wires up all interactions for the "Legacy Sheet" mode.
     */
    wireUpLegacySheetInteractions(sheetElement, handleElement) {
        handleElement.addEventListener('touchstart', this.handleLegacyTouchStart.bind(this), { passive: false });
        
        document.addEventListener('touchmove', this.boundLegacyTouchMove, { passive: false });
        document.addEventListener('touchend', this.boundLegacyTouchEnd);
        document.addEventListener('touchcancel', this.boundLegacyTouchEnd);
        
        if (this.overlayEl) {
            this.overlayEl.addEventListener('click', () => {
                if (this.legacySheetState.currentState === 'expanded') {
                    this.setLegacySheetState('peek');
                } else {
                    this.closeActiveWindow();
                }
            });
        }
        
        const buttonContainer = sheetElement.querySelector('.overview-actions') || sheetElement.querySelector('.hero-actions'); // Added check for airport actions
        if (buttonContainer) {
            buttonContainer.addEventListener('touchstart', (e) => {
                e.stopPropagation();
            }, { passive: true });
        }
        
        const closeBtn = sheetElement.querySelector('.aircraft-window-close-btn') || sheetElement.querySelector('#airport-window-close-btn'); // Airport check
        const hideBtn = sheetElement.querySelector('.aircraft-window-hide-btn') || sheetElement.querySelector('#airport-window-hide-btn'); // Airport check
        
        if(closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.closeActiveWindow();
            });
        }
        if(hideBtn) {
            hideBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.closeActiveWindow(); 
                
                const recallBtnId = sheetElement.id === 'airport-info-window' ? 'airport-recall-btn' : 'aircraft-recall-btn';
                const recallBtn = document.getElementById(recallBtnId);
                if (recallBtn) {
                    recallBtn.classList.add('visible', 'palpitate');
                    setTimeout(() => recallBtn.classList.remove('palpitate'), 1000);
                }
            });
        }
    },

    /**
     * Wires up interactions for HUD mode.
     */
    wireUpHudInteractions() {
        if (!this.miniIslandEl || !this.peekIslandEl || !this.expandedIslandEl) return;

        const miniHandle = this.miniIslandEl.querySelector('.route-summary-wrapper-mobile');
        const peekHandle = this.peekIslandEl.querySelector('.route-summary-wrapper-mobile');
        const expandedHandle = this.expandedIslandEl.querySelector('.route-summary-wrapper-mobile');
        const tabsInSlot = this.expandedIslandEl.querySelector('.ac-info-window-tabs'); 

        if (!miniHandle || !peekHandle || !expandedHandle || !tabsInSlot) return;

        miniHandle.addEventListener('click', (e) => {
            if (this.swipeState.isDragging) return;
            this.setDrawerState(1);
        });
        peekHandle.addEventListener('click', (e) => {
            if (this.swipeState.isDragging) return;
            this.setDrawerState(2);
        });
        expandedHandle.addEventListener('click', (e) => {
            if (this.swipeState.isDragging) return;
            this.setDrawerState(1);
        });
        
        if (this.overlayEl) {
            this.overlayEl.addEventListener('click', () => this.setDrawerState(0));
        }

        miniHandle.addEventListener('touchstart', this.handleHudTouchStart.bind(this), { passive: false });
        peekHandle.addEventListener('touchstart', this.handleHudTouchStart.bind(this), { passive: false });
        expandedHandle.addEventListener('touchstart', this.handleHudTouchStart.bind(this), { passive: false });
        
        document.addEventListener('touchend', this.boundHudTouchEnd);

        this.topWindowEl.addEventListener('click', (e) => {
            const closeBtn = e.target.closest('.aircraft-window-close-btn');
            const hideBtn = e.target.closest('.aircraft-window-hide-btn');

            if (closeBtn) this.closeActiveWindow();
            if (hideBtn) {
                this.topWindowEl.classList.remove('visible');
                this.setDrawerState(0);
                this.miniIslandEl?.classList.remove('island-active');
                this.peekIslandEl?.classList.remove('island-active');
                this.expandedIslandEl?.classList.remove('island-active');
                this.overlayEl.classList.remove('visible');
                
                const recallBtn = document.getElementById('aircraft-recall-btn');
                if (recallBtn) {
                    recallBtn.classList.add('visible', 'palpitate');
                    setTimeout(() => recallBtn.classList.remove('palpitate'), 1000);
                }
            }
        });
        
        tabsInSlot.addEventListener('click', async (e) => {
            const tabBtn = e.target.closest('.ac-info-tab-btn');

            if (tabBtn) {
                e.preventDefault();
                e.stopPropagation();
                
                const tabId = tabBtn.dataset.tab;
                if (!tabId || tabBtn.classList.contains('active')) {
                    return;
                }
                
                const islandContent = this.expandedIslandEl;
                if (!islandContent) return;

                islandContent.querySelector('.ac-info-tab-btn.active')?.classList.remove('active');
                islandContent.querySelector('.ac-tab-pane.active')?.classList.remove('active');

                tabBtn.classList.add('active');
                const newPane = islandContent.querySelector(`#${tabId}`);
                if (newPane) {
                    newPane.classList.add('active');
                }
                
                if (tabId === 'ac-tab-pilot-report') {
                    const statsDisplay = newPane?.querySelector('#pilot-stats-display');
                    if (statsDisplay) { 
                        const userId = tabBtn.dataset.userId;
                        const username = tabBtn.dataset.username;
                        
                        if (userId && window.displayPilotStats) { 
                            await window.displayPilotStats(userId, username); 
                            
                            const accordionHeaders = statsDisplay.querySelectorAll('.accordion-header');
                            accordionHeaders.forEach(header => {
                                const item = header.closest('.accordion-item');
                                if (item.classList.contains('active')) {
                                    const content = header.nextElementSibling;
                                    content.style.maxHeight = content.scrollHeight + 'px';
                                }
                            });
                        } else {
                            statsDisplay.innerHTML = `<p class="error-text" style="padding: 1rem;">Could not load pilot data. Missing userId or helper function.</p>`;
                        }
                    }
                }
            }
        });
    },
    
    setDrawerState(targetState) {
        if (targetState === this.drawerState || !this.miniIslandEl) return;
        
        this.drawerState = targetState;

        this.miniIslandEl.classList.toggle('island-active', this.drawerState === 0);
        this.peekIslandEl.classList.toggle('island-active', this.drawerState === 1);
        this.expandedIslandEl.classList.toggle('island-active', this.drawerState === 2);
        
        const isFullyExpanded = (this.drawerState === 2);
        if (this.overlayEl) this.overlayEl.classList.toggle('visible', isFullyExpanded);
    },

    setLegacySheetState(targetState) {
        if (!this.activeWindow) return;
        
        this.legacySheetState.currentState = targetState;
        this.activeWindow.style.transition = 'transform 0.45s cubic-bezier(0.16, 1, 0.3, 1)';
        this.activeWindow.style.transform = ''; 

        if (targetState === 'expanded') {
            this.activeWindow.classList.add('visible');
            this.activeWindow.classList.remove('peek');
            if (this.overlayEl) this.overlayEl.classList.add('visible');
            
            const topOffset = parseInt(getComputedStyle(document.documentElement)
            .getPropertyValue('--hud-top-window-height')) || 280;
            const expandedY = topOffset;

            this.legacySheetState.currentSheetY = expandedY;

        } else if (targetState === 'peek') {
            this.activeWindow.classList.add('visible', 'peek');
            if (this.overlayEl) this.overlayEl.classList.remove('visible');
            
            const peekY = window.innerHeight - this.CONFIG.legacyPeekHeight;
            this.legacySheetState.currentSheetY = peekY;

        } else if (targetState === 'closed') {
            this.activeWindow.classList.remove('visible', 'peek');
            if (this.overlayEl) this.overlayEl.classList.remove('visible');
            this.legacySheetState.currentSheetY = window.innerHeight + 100;
        }
    },

    handleHudTouchStart(e) {
        if (this.activeMode !== 'hud') return;
        const handle = e.target.closest('.route-summary-wrapper-mobile');
        if (!handle) {
             this.swipeState.isDragging = false;
             return;
        }
        e.preventDefault();
        this.swipeState.isDragging = true;
        this.swipeState.touchStartY = e.touches[0].clientY;
    },
    handleHudTouchEnd(e) {
        if (this.activeMode !== 'hud' || !this.swipeState.isDragging) return;
        
        setTimeout(() => {
            this.swipeState.isDragging = false;
            this.swipeState.touchStartY = 0;
        }, 50);

        const touchEndY = e.changedTouches[0].clientY;
        const deltaY = touchEndY - this.swipeState.touchStartY;
        const currentState = this.drawerState;

        if (deltaY > 150 && currentState === 0) {
             this.closeActiveWindow();
             return;
        }
        
        let newState = currentState;
        if (deltaY < -50) { 
             newState = Math.min(2, currentState + 1);
        } else if (deltaY > 50) { 
             newState = Math.max(0, currentState - 1);
        }
        this.setDrawerState(newState);
    },

    handleLegacyTouchStart(e) {
        if (this.activeMode !== 'legacy' || !this.activeWindow) return;
        
        const handle = e.target.closest('.legacy-sheet-handle');
        if (!handle) {
             this.legacySheetState.isDragging = false;
             return;
        }
        
        e.preventDefault();
        
        this.legacySheetState.isDragging = true;
        this.legacySheetState.touchStartY = e.touches[0].clientY;
        
        const rect = this.activeWindow.getBoundingClientRect();
        this.legacySheetState.currentSheetY = rect.top;
        this.legacySheetState.startSheetY = rect.top;
        
        this.activeWindow.style.transition = 'none'; 
    },

    handleLegacyTouchMove(e) {
        if (this.activeMode !== 'legacy' || !this.legacySheetState.isDragging) return;
        
        e.preventDefault();
        const touchCurrentY = e.touches[0].clientY;
        let deltaY = touchCurrentY - this.legacySheetState.touchStartY;

        const topStop = parseInt(getComputedStyle(document.documentElement)
        .getPropertyValue('--hud-top-window-height')) || 50;

        let newY = this.legacySheetState.startSheetY + deltaY;
        
        if (newY < topStop) {
            const overdrag = topStop - newY;
            newY = topStop - (overdrag * 0.3); 
        }
        
        this.activeWindow.style.transform = `translateY(${newY}px)`;
        this.legacySheetState.currentSheetY = newY; 
    },

    handleLegacyTouchEnd(e) {
        if (this.activeMode !== 'legacy' || !this.legacySheetState.isDragging) return;
        
        this.legacySheetState.isDragging = false;
        
        const deltaY = this.legacySheetState.currentSheetY - this.legacySheetState.startSheetY;

        if (this.legacySheetState.currentState === 'peek') {
            if (deltaY < -100) { 
                this.setLegacySheetState('expanded');
            } else if (deltaY > 100) { 
                this.closeActiveWindow();
            } else { 
                this.setLegacySheetState('peek');
            }
        } else { 
            if (deltaY > 100) { 
                this.setLegacySheetState('peek');
            } else { 
                this.setLegacySheetState('expanded');
            }
        }
        
        this.activeWindow.style.transition = '';
        this.activeWindow.style.transform = '';
    },

    closeActiveWindow(force = false) {
        if (this.contentObserver) this.contentObserver.disconnect();
        
        if (this.closeTimer) {
            clearTimeout(this.closeTimer);
            this.closeTimer = null;
        }
        
        if (window.activePfdUpdateInterval) {
             clearInterval(window.activePfdUpdateInterval);
             window.activePfdUpdateInterval = null;
        }

        const animationDuration = force ? 0 : 500;
        
        if (this.activeMode === 'hud') {
            this.teardownHudView(force, animationDuration);
        } else {
            this.teardownLegacySheetView(force, animationDuration);
        }
    },

    teardownLegacySheetView(force, duration) {
        const overlayToRemove = this.overlayEl;
        const sheetToClose = this.activeWindow;
        
        document.removeEventListener('touchmove', this.boundLegacyTouchMove);
        document.removeEventListener('touchend', this.boundLegacyTouchEnd);
        document.removeEventListener('touchcancel', this.boundLegacyTouchEnd);
        
        const resetState = () => {
            this.activeWindow = null;
            this.overlayEl = null;
            this.activeMode = 'legacy'; 
            this.legacySheetState.isDragging = false;
        };

        if (force) {
            overlayToRemove?.remove();
            if (sheetToClose) {
                sheetToClose.style.display = 'none';
                sheetToClose.classList.remove('mobile-legacy-sheet', 'visible', 'peek');
                
                const handle = sheetToClose.querySelector('.legacy-sheet-handle');
                if (handle) {
                    if (handle.classList.contains('simple-mode')) {
                        handle.remove();
                    } else {
                        // Standard Mode or Airport Mode: Un-wrap content
                        // Check specifically for airport hero
                        const hero = sheetToClose.querySelector('.airport-hero');
                        if (hero) {
                             sheetToClose.prepend(hero);
                             const strip = handle.querySelector('.apt-quick-info-strip');
                             if (strip) sheetToClose.insertBefore(strip, hero.nextSibling);
                        } else {
                            // Standard Aircraft Mode
                            const overview = sheetToClose.querySelector('.aircraft-overview-panel');
                            const routeBar = sheetToClose.querySelector('.route-summary-overlay');
                            if (overview) sheetToClose.prepend(overview);
                            if (routeBar) sheetToClose.insertBefore(routeBar, overview.nextSibling);
                        }
                        handle.remove();
                    }
                }
            }
            this.restoreMapControls();
            resetState();
        } else {
            this.setLegacySheetState('closed');
            
            this.closeTimer = setTimeout(() => {
                overlayToRemove?.remove();
                if (sheetToClose) {
                    sheetToClose.style.display = 'none';
                    sheetToClose.classList.remove('mobile-legacy-sheet', 'peek');
                    
                    const handle = sheetToClose.querySelector('.legacy-sheet-handle');
                    if (handle) {
                        if (handle.classList.contains('simple-mode')) {
                            handle.remove();
                        } else {
                            const hero = sheetToClose.querySelector('.airport-hero');
                            if (hero) {
                                 sheetToClose.prepend(hero);
                                 const strip = handle.querySelector('.apt-quick-info-strip');
                                 if (strip) sheetToClose.insertBefore(strip, hero.nextSibling);
                            } else {
                                const overview = sheetToClose.querySelector('.aircraft-overview-panel');
                                const routeBar = sheetToClose.querySelector('.route-summary-overlay');
                                if (overview) sheetToClose.prepend(overview);
                                if (routeBar) sheetToClose.insertBefore(routeBar, overview.nextSibling);
                            }
                            handle.remove();
                        }
                    }
                }
                
                this.restoreMapControls();
                
                if (this.activeWindow === sheetToClose) {
                    resetState();
                }
                this.closeTimer = null;
            }, duration);
        }
    },

    teardownHudView(force, duration) {
        if (this.activeWindow && this.topWindowEl && this.miniIslandEl && this.peekIslandEl && this.expandedIslandEl) {
            const topOverviewPanel = this.topWindowEl.querySelector('.aircraft-overview-panel');
            const mainFlightContent = this.expandedIslandEl.querySelector('.unified-display-main-content');
            const tabContainer = this.expandedIslandEl.querySelector('.ac-info-window-tabs');
            const clonedFlightContent = this.peekIslandEl.querySelector('.unified-display-main-content');
            
            if (topOverviewPanel) this.activeWindow.appendChild(topOverviewPanel);
            if (mainFlightContent) this.activeWindow.appendChild(mainFlightContent);
            if (tabContainer) this.activeWindow.querySelector('.info-window-content').prepend(tabContainer);
            clonedFlightContent?.remove();
        }

        document.removeEventListener('touchend', this.boundHudTouchEnd);

        const overlayToRemove = this.overlayEl;
        const topWindowToRemove = this.topWindowEl;
        const miniIslandToRemove = this.miniIslandEl;
        const peekIslandToRemove = this.peekIslandEl;
        const expandedIslandToRemove = this.expandedIslandEl;

        const resetState = () => {
            this.activeWindow = null;
            this.contentObserver = null;
            this.topWindowEl = null;
            this.overlayEl = null;
            this.miniIslandEl = null;
            this.peekIslandEl = null;
            this.expandedIslandEl = null;
            this.drawerState = 0;
            this.swipeState.isDragging = false;
        };

        if (force) {
            overlayToRemove?.remove();
            topWindowToRemove?.remove();
            miniIslandToRemove?.remove();
            peekIslandToRemove?.remove();
            expandedIslandToRemove?.remove();
            
            this.restoreMapControls();
            resetState();
        } else {
            if (overlayToRemove) overlayToRemove.classList.remove('visible');
            if (topWindowToRemove) topWindowToRemove.classList.remove('visible');
            if (miniIslandToRemove) miniIslandToRemove.classList.remove('island-active');
            if (peekIslandToRemove) peekIslandToRemove.classList.remove('island-active');
            if (expandedIslandToRemove) expandedIslandToRemove.classList.remove('island-active');

            this.closeTimer = setTimeout(() => {
                overlayToRemove?.remove();
                topWindowToRemove?.remove();
                miniIslandToRemove?.remove();
                peekIslandToRemove?.remove();
                expandedIslandToRemove?.remove();
                
                this.restoreMapControls();

                if (this.topWindowEl === topWindowToRemove) {
                    resetState();
                }
                this.closeTimer = null;
            }, duration);
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    MobileUIHandler.init();
    window.MobileUIHandler = MobileUIHandler;
});