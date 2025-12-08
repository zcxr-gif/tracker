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
    activeMode: 'legacy', 
    topWindowEl: null, 
    overlayEl: null, 
    closeTimer: null,
    
    // [HUD] Island elements
    miniIslandEl: null,
    peekIslandEl: null,
    expandedIslandEl: null,
    
    contentObserver: null,
    drawerState: 0, 
    
    // [LEGACY] Sheet state
    legacySheetState: {
        isDragging: false,
        touchStartY: 0,
        currentSheetY: 0,
        startSheetY: 0,
        currentState: 'peek', 
    },
    
    swipeState: { 
        touchStartY: 0,
        isDragging: false,
    },

    // Bound event handlers
    boundHudTouchEnd: null,
    boundLegacyTouchMove: null,
    boundLegacyTouchEnd: null,

    /**
     * [MODIFIED] Restores the main map UI controls.
     * Clears inline display styles so the CSS classes can take over again.
     */
    restoreMapControls() {
        const burgerMenu = document.getElementById('mobile-sidebar-toggle');
        // Find the map toolbar parent
        const mapToolbar = document.getElementById('toolbar-toggle-panel-btn')?.parentElement;
        const searchBar = document.getElementById('sector-ops-search-container');
        
        // Remove inline 'display: none' to let CSS show them again
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
        
        console.log("Mobile UI Handler (Apple Maps Style v1.0) Initialized.");
    },

    /**
     * [CRITICAL UPDATE] Injects the CSS for the "Apple Maps" layout.
     * Repositions Search, Toolbar, and Sidebar Toggle into floating islands.
     */
    injectMobileStyles() {
        const styleId = 'mobile-sector-ops-styles';
        if (document.getElementById(styleId)) document.getElementById(styleId).remove();

        const css = `
            :root {
                --hud-bg: rgba(15, 20, 35, 0.85); /* Deep Blue Glass */
                --hud-blur: 20px;
                --hud-top-window-height: 50px;
                --hud-border: rgba(255, 255, 255, 0.1);
                --hud-accent: #00a8ff;
                --hud-glow: 0 0 15px rgba(0, 168, 255, 0.2);
                
                --drawer-peek-content-height: 200px;
                --island-bottom-margin: env(safe-area-inset-bottom, 20px);
                --island-side-margin: 16px;

                --legacy-peek-height: ${this.CONFIG.legacyPeekHeight}px;
                --legacy-top-offset: env(safe-area-inset-top, 15px);
            }
            
            #sector-ops-map-fullscreen.mobile-ui-active {
                position: relative;
                overflow: hidden;
            }

            /* ====================================================================
            --- [START] APPLE MAPS LAYOUT TRANSFORMATION ---
            ==================================================================== */
            
            @media (max-width: ${this.CONFIG.breakpoint}px) {
                
                /* --- 1. SEARCH BAR: Floating Bottom "Pill" (Bottom Center) --- */
                #sector-ops-search-container {
                    position: absolute !important;
                    top: auto !important;
                    bottom: calc(env(safe-area-inset-bottom, 20px) + 20px) !important; /* Float above bottom edge */
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
                    background: var(--hud-bg) !important;
                    backdrop-filter: blur(var(--hud-blur)) !important;
                    -webkit-backdrop-filter: blur(var(--hud-blur)) !important;
                    border: 1px solid var(--hud-border) !important;
                    border-radius: 50px !important; /* Full pill */
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4) !important;
                    padding: 4px 6px !important; 
                    height: 50px !important;
                    transition: all 0.3s ease !important;
                }

                /* Active Glow for Search */
                #sector-ops-search-container:focus-within .search-bar-container {
                    border-color: var(--hud-accent) !important;
                    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6), var(--hud-glow) !important;
                }

                /* Search Input Styling */
                #sector-ops-search-input {
                    background: transparent !important;
                    color: #fff !important;
                    font-size: 16px !important; /* Prevents zoom on iOS */
                    font-weight: 500 !important;
                    padding-left: 10px !important;
                }
                #sector-ops-search-input::placeholder { color: rgba(255, 255, 255, 0.5) !important; }

                /* Search Results: POP UPWARDS because bar is at bottom */
                #search-results-dropdown {
                    top: auto !important;
                    bottom: 110% !important; /* Sit above the bar */
                    left: 0 !important;
                    width: 100% !important;
                    background: rgba(15, 20, 35, 0.95) !important;
                    backdrop-filter: blur(30px) !important;
                    border: 1px solid var(--hud-border) !important;
                    border-radius: 20px !important;
                    box-shadow: 0 -10px 40px rgba(0,0,0,0.5) !important;
                    max-height: 50vh !important;
                }

                /* --- 2. SIDEBAR TOGGLE: Bottom Left "Action Button" --- */
                #mobile-sidebar-toggle {
                    position: absolute !important;
                    top: auto !important;
                    bottom: calc(env(safe-area-inset-bottom, 20px) + 22px) !important;
                    left: var(--island-side-margin) !important;
                    right: auto !important;
                    
                    /* Apple Maps "Squircle" Look */
                    width: 46px !important;
                    height: 46px !important;
                    border-radius: 14px !important;
                    
                    background: var(--hud-bg) !important;
                    backdrop-filter: blur(var(--hud-blur)) !important;
                    -webkit-backdrop-filter: blur(var(--hud-blur)) !important;
                    border: 1px solid var(--hud-border) !important;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.3) !important;
                    
                    /* Flex center the icon */
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    z-index: 1035 !important;
                    color: var(--hud-accent) !important;
                    font-size: 1.2rem !important;
                }

                /* --- 3. MAP TOOLBAR: Top Right "Stack" --- */
                /* Note: We target the parent of the toggle button to get the whole toolbar */
                #toolbar-toggle-panel-btn {
                    display: none !important; /* Hide the collapse arrow if present */
                }
                
                /* The container holding the buttons */
                #toolbar-toggle-panel-btn, 
                #toolbar-toggle-panel-btn + div, /* Assuming siblings are the toolbar */
                .map-toolbar-container,          /* Generic fallback class */
                div:has(> #toolbar-toggle-panel-btn) { /* Modern CSS selector for parent */
                    position: absolute !important;
                    top: calc(env(safe-area-inset-top, 20px) + 50px) !important; /* Below compass */
                    right: var(--island-side-margin) !important;
                    left: auto !important;
                    bottom: auto !important;
                    
                    /* Force Vertical Stack */
                    display: flex !important;
                    flex-direction: column !important;
                    gap: 12px !important;
                    
                    background: transparent !important; /* Remove bar background */
                    box-shadow: none !important;
                    border: none !important;
                    padding: 0 !important;
                    width: 46px !important;
                    z-index: 1030 !important;
                }

                /* Style the individual buttons inside the toolbar */
                div:has(> #toolbar-toggle-panel-btn) button,
                div:has(> #toolbar-toggle-panel-btn) .btn,
                .map-toolbar-btn {
                    width: 46px !important;
                    height: 46px !important;
                    border-radius: 14px !important; /* Squircle */
                    
                    background: var(--hud-bg) !important;
                    backdrop-filter: blur(var(--hud-blur)) !important;
                    -webkit-backdrop-filter: blur(var(--hud-blur)) !important;
                    border: 1px solid var(--hud-border) !important;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.3) !important;
                    
                    color: #fff !important;
                    margin: 0 !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                }
                
                /* Active/Toggle State for Map Buttons */
                div:has(> #toolbar-toggle-panel-btn) button.active,
                div:has(> #toolbar-toggle-panel-btn) .btn.active {
                    background: rgba(0, 168, 255, 0.2) !important;
                    border-color: var(--hud-accent) !important;
                    color: var(--hud-accent) !important;
                }

            }
            /* ====================================================================
            --- [END] APPLE MAPS LAYOUT TRANSFORMATION ---
            ==================================================================== */

            /* --- [MODIFIED] Overlay (now shared) --- */
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

            
            /* ====================================================================
            --- [START] CSS for "HUD" (Island) Mode ---
            ==================================================================== */

            /* --- Base Island Class (Used by Top Window) --- */
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

            /* --- Top Floating Window --- */
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

            /* --- [NEW] Base Class for Bottom Islands --- */
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

            /* --- State 0: Mini Island --- */
            #mobile-island-mini {
                bottom: var(--island-bottom-margin);
                height: auto; 
                display: flex;
                flex-direction: column; 
            }
            
            /* --- State 1: Peek Island --- */
            #mobile-island-peek {
                bottom: var(--island-bottom-margin);
                height: auto; 
            }
            
            /* --- State 2: Expanded Island --- */
            #mobile-island-expanded {
                top: 280px; 
                bottom: var(--island-bottom-margin);
                height: auto; 
            }

            /* --- Route Summary Bar Styling (Mobile HUD) --- */
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

            /* --- Drawer Content --- */
            .drawer-content {
                overflow-y: auto;
                flex-grow: 1;
                padding-bottom: env(safe-area-inset-bottom, 0);
                height: var(--drawer-peek-content-height);
            }
            #mobile-island-peek .drawer-content { overflow: hidden; }
            #mobile-island-expanded .drawer-content { height: auto; }
            
            .drawer-content::-webkit-scrollbar { width: 6px; }
            .drawer-content::-webkit-scrollbar-track { background: transparent; }
            .drawer-content::-webkit-scrollbar-thumb { background-color: var(--hud-accent); border-radius: 10px; }

            /* --- State 1: "Peek" Stacked Data Layout --- */
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
            #mobile-island-peek .flight-data-bar {
                padding: 10px;
                gap: 8px;
                grid-template-columns: repeat(auto-fit, minmax(70px, 1fr));
                flex-grow: 1;
                overflow: hidden;
                border-top-width: 0;
            }


            /* --- State 2: "Expanded" Stacked Layout --- */
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
             #mobile-island-expanded .ac-profile-card-new { display: flex !important; }
            #mobile-island-expanded .vsd-disclaimer { display: block !important; }
            #mobile-island-expanded .live-data-panel {
                justify-content: space-around !important;
                background: rgba(10, 12, 26, 0.5) !important;
                border-radius: 12px !important;
                padding: 16px !important;
            }
            
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

            /* ====================================================================
            --- [START] NEW CSS for "Legacy Sheet" Mode ---
            ==================================================================== */

            .mobile-legacy-sheet {
                display: flex !important; 
                position: absolute !important;
                top: auto !important; /* Unset top */
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
            
            /* Drag Handle for Legacy Sheet */
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

            /* Simple Mode Handle (Seamless Overlay) */
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
                #airport-info-window {
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
     * [MODIFIED] Intercepts the window open command.
     * This now acts as a ROUTER, checking the user's preferred mode.
     */
    openWindow(windowElement) {
        if (!this.isMobile()) return;

        if (this.activeWindow) {
            this.closeActiveWindow(true); // 'true' = force close
        }

        const mapContainer = document.getElementById('sector-ops-map-fullscreen');
        if (mapContainer) mapContainer.classList.add('mobile-ui-active');

        if (windowElement.id === 'aircraft-info-window') {
            // --- Hide main map controls to clear view for the sheet ---
            const burgerMenu = document.getElementById('mobile-sidebar-toggle');
            const mapToolbar = document.getElementById('toolbar-toggle-panel-btn')?.parentElement;
            const searchBar = document.getElementById('sector-ops-search-container');
            
            if (burgerMenu) burgerMenu.style.display = 'none';
            if (mapToolbar) mapToolbar.style.display = 'none';
            if (searchBar) searchBar.style.display = 'none';

            // --- [NEW] The Router Logic ---
            // 1. Check for Simple Mode (iframe existence)
            const isSimpleMode = !!windowElement.querySelector('#simple-flight-window-frame');

            // 2. Get user preference (defaulting to legacy)
            let userMode = localStorage.getItem('mobileDisplayMode') || this.CONFIG.defaultMode;

            // 3. FORCE Legacy mode if Simple Flight Window is active
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
     * [MODIFIED] Creates the DOM for the "Legacy Sheet" mode.
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
     * [MODIFIED] Creates the new DOM structure for the HUD.
     */
    createSplitViewUI() {
        const viewContainer = document.getElementById('sector-ops-map-fullscreen');
        if (!viewContainer) return;

        // 1. Overlay
        this.overlayEl = document.createElement('div');
        this.overlayEl.id = 'mobile-window-overlay';
        viewContainer.appendChild(this.overlayEl);
        
        // 2. Top Window
        this.topWindowEl = document.createElement('div');
        this.topWindowEl.id = 'mobile-aircraft-top-window';
        this.topWindowEl.className = 'mobile-aircraft-view';
        viewContainer.appendChild(this.topWindowEl);

        // 3. Bottom Island - State 0 (Mini)
        this.miniIslandEl = document.createElement('div');
        this.miniIslandEl.id = 'mobile-island-mini';
        this.miniIslandEl.className = 'mobile-island-bottom';
        this.miniIslandEl.innerHTML = `<div class="route-summary-wrapper-mobile"></div>`;
        viewContainer.appendChild(this.miniIslandEl);

        // 4. Bottom Island - State 1 (Peek)
        this.peekIslandEl = document.createElement('div');
        this.peekIslandEl.id = 'mobile-island-peek';
        this.peekIslandEl.className = 'mobile-island-bottom';
        this.peekIslandEl.innerHTML = `
            <div class="route-summary-wrapper-mobile"></div>
            <div class="drawer-content"></div>
        `;
        viewContainer.appendChild(this.peekIslandEl);
        
        // 5. Bottom Island - State 2 (Expanded)
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
     * [MODIFIED] Observes the original window for content.
     */
    observeOriginalWindow(windowElement) {
        if (this.contentObserver) this.contentObserver.disconnect();
        
        this.contentObserver = new MutationObserver((mutationsList, obs) => {
            const mainContent = windowElement.querySelector('.unified-display-main-content');
            const attitudeGroup = mainContent?.querySelector('#attitude_group');
            
            const simpleIframe = windowElement.querySelector('#simple-flight-window-frame');

            const isStandardReady = mainContent && attitudeGroup && attitudeGroup.dataset.initialized === 'true';
            const isSimpleReady = !!simpleIframe;
            
            if (isStandardReady || isSimpleReady) {
                
                if (this.activeMode === 'legacy') {
                    this.populateLegacySheet(windowElement);
                    if (this.activeWindow) {
                        setTimeout(() => {
                            this.activeWindow.classList.add('visible', 'peek');
                            this.legacySheetState.currentState = 'peek';
                        }, 10);
                    }

                } else { // 'hud' mode
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
     * [MODIFIED] Wires up interactions for the "Legacy Sheet" mode.
     */
    populateLegacySheet(sourceWindow) {
        const simpleIframe = sourceWindow.querySelector('#simple-flight-window-frame');
        
        const handleWrapper = document.createElement('div');
        handleWrapper.className = 'legacy-sheet-handle';

        if (simpleIframe) {
            handleWrapper.classList.add('simple-mode'); 
            sourceWindow.prepend(handleWrapper);
            sourceWindow.style.position = 'relative';
        } else {
            const overviewPanel = sourceWindow.querySelector('.aircraft-overview-panel');
            const routeSummaryBar = sourceWindow.querySelector('.route-summary-overlay');

            if (overviewPanel && routeSummaryBar) {
                sourceWindow.prepend(handleWrapper);
                handleWrapper.appendChild(overviewPanel);
                handleWrapper.appendChild(routeSummaryBar);
            }
        }
        
        this.wireUpLegacySheetInteractions(sourceWindow, handleWrapper);
    },

    /**
     * [MODIFIED] Moves content from the original window into the new island components.
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
     * [NEW] Wires up all interactions for the "Legacy Sheet" mode.
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
        
        const buttonContainer = sheetElement.querySelector('.overview-actions');
        if (buttonContainer) {
            buttonContainer.addEventListener('touchstart', (e) => {
                e.stopPropagation();
            }, { passive: true });
        }
        
        const closeBtn = sheetElement.querySelector('.aircraft-window-close-btn');
        const hideBtn = sheetElement.querySelector('.aircraft-window-hide-btn');
        
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
                
                const recallBtn = document.getElementById('aircraft-recall-btn');
                if (recallBtn) {
                    recallBtn.classList.add('visible', 'palpitate');
                    setTimeout(() => recallBtn.classList.remove('palpitate'), 1000);
                }
            });
        }
    },

    /**
     * [MODIFIED] Wires up interactions for HUD mode.
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
    
    /**
     * [HUD] Sets the drawer to a specific state (0, 1, or 2).
     */
    setDrawerState(targetState) {
        if (targetState === this.drawerState || !this.miniIslandEl) return;
        
        this.drawerState = targetState;

        this.miniIslandEl.classList.toggle('island-active', this.drawerState === 0);
        this.peekIslandEl.classList.toggle('island-active', this.drawerState === 1);
        this.expandedIslandEl.classList.toggle('island-active', this.drawerState === 2);
        
        const isFullyExpanded = (this.drawerState === 2);
        if (this.overlayEl) this.overlayEl.classList.toggle('visible', isFullyExpanded);
    },

    /**
     * [NEW] Sets the "Legacy Sheet" to a specific state.
     */
    setLegacySheetState(targetState) { // 'peek', 'expanded', or 'closed'
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

    // --- [HUD] Swipe Gesture Handlers ---
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
        if (deltaY < -50) { // Swiped up
             newState = Math.min(2, currentState + 1);
        } else if (deltaY > 50) { // Swiped down
             newState = Math.max(0, currentState - 1);
        }
        this.setDrawerState(newState);
    },

    // --- [NEW] Legacy Sheet Swipe Handlers ---
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
            newY = topStop - (overdrag * 0.3); // Resistance
        }
        
        this.activeWindow.style.transform = `translateY(${newY}px)`;
        this.legacySheetState.currentSheetY = newY; 
    },

    handleLegacyTouchEnd(e) {
        if (this.activeMode !== 'legacy' || !this.legacySheetState.isDragging) return;
        
        this.legacySheetState.isDragging = false;
        
        const deltaY = this.legacySheetState.currentSheetY - this.legacySheetState.startSheetY;

        // Snap logic
        if (this.legacySheetState.currentState === 'peek') {
            if (deltaY < -100) { // Swiped up
                this.setLegacySheetState('expanded');
            } else if (deltaY > 100) { // Swiped down to close
                this.closeActiveWindow();
            } else { // Snap back
                this.setLegacySheetState('peek');
            }
        } else { // Was 'expanded'
            if (deltaY > 100) { // Swiped down
                this.setLegacySheetState('peek');
            } else { // Snap back
                this.setLegacySheetState('expanded');
            }
        }
        
        this.activeWindow.style.transition = '';
        this.activeWindow.style.transform = '';
    },


    /**
     * [MODIFIED] Closes whichever UI is active.
     */
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

    /**
     * [NEW] Teardown logic for Legacy Sheet mode.
     */
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
                        const overview = sheetToClose.querySelector('.aircraft-overview-panel');
                        const routeBar = sheetToClose.querySelector('.route-summary-overlay');
                        if (overview) sheetToClose.prepend(overview);
                        if (routeBar) sheetToClose.insertBefore(routeBar, overview.nextSibling);
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
                            const overview = sheetToClose.querySelector('.aircraft-overview-panel');
                            const routeBar = sheetToClose.querySelector('.route-summary-overlay');
                            if (overview) sheetToClose.prepend(overview);
                            if (routeBar) sheetToClose.insertBefore(routeBar, overview.nextSibling);
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

    /**
     * [NEW] Teardown logic for HUD mode.
     */
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

/**
 * Initialize the Mobile UI Handler when the DOM is ready.
 */
document.addEventListener('DOMContentLoaded', () => {
    MobileUIHandler.init();
    window.MobileUIHandler = MobileUIHandler; // Make it globally accessible
});