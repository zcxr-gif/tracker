/**
 * appPromo.js — letting people know InFlight is on the App Store.
 *
 * Three quiet surfaces, one link:
 *   1. iPhone Safari gets Apple's own Smart App Banner (the apple-itunes-app
 *      meta in index.html / home.html). Nothing here duplicates it.
 *   2. A one-time corner card — on desktop with a QR code to scan with the
 *      phone, on iPhone/iPad browsers other than Safari with a Get button.
 *      Never on a visit that already has the What's New popup or card, never
 *      over a sheet or a flight link, and it leaves by itself.
 *   3. A permanent card in Settings › What's New (desktop) and a row in the
 *      phone Settings (MobileSettingsUI.js), via cardHtml() / rowHtml().
 *
 * None of it appears inside the iOS app itself, nor on Android, where there
 * is nothing to download. Pages hide the permanent entries with the
 * `.ios-promo` class, which `html.no-ios-promo` switches off.
 *
 * Exposed as window.InflightAppPromo. Plain (non-module) script, loaded after
 * changelog.js.
 */
(function () {
    'use strict';

    const APP_URL = 'https://apps.apple.com/us/app/inflight-tracker/id6756477098';
    const SEEN_KEY = 'inflight_ios_promo_seen';
    const QR_SRC = 'Images/app-store-qr.svg';

    const ua = navigator.userAgent || '';
    const isNative = typeof window.isIOSNative === 'function' && window.isIOSNative();
    const isAndroid = /Android/i.test(ua);
    const isIOSWeb = !isNative && (/iPhone|iPad|iPod/i.test(ua) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
    // Safari on iOS shows the Smart App Banner; Chrome, Firefox and Edge on
    // iOS do not, so those are the iOS browsers the card is for.
    const isIOSSafari = isIOSWeb && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//i.test(ua);
    const canPromote = !isNative && !isAndroid;
    const isDesktop = canPromote && !isIOSWeb;

    if (!canPromote) document.documentElement.classList.add('no-ios-promo');

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // ---------------------------------------------------------------------
    // Styles
    // ---------------------------------------------------------------------

    function injectStyles() {
        if (document.getElementById('inflight-app-promo-styles')) return;
        const style = document.createElement('style');
        style.id = 'inflight-app-promo-styles';
        style.textContent = `
            html.no-ios-promo .ios-promo { display: none !important; }

            .iap-store {
                display: inline-flex; align-items: center; gap: 9px; height: 40px; padding: 0 14px 0 12px;
                border-radius: 10px; background: #000; color: #fff !important; text-decoration: none !important;
                border: 1px solid rgba(255,255,255,0.28); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
                transition: transform .15s ease, border-color .15s ease; white-space: nowrap;
            }
            .iap-store:hover { border-color: rgba(255,255,255,0.55); transform: translateY(-1px); }
            .iap-store i { font-size: 22px; line-height: 1; }
            .iap-store span { display: flex; flex-direction: column; line-height: 1.05; text-align: left; }
            .iap-store small { font-size: 9.5px; font-weight: 500; letter-spacing: .02em; opacity: .85; }
            .iap-store b { font-size: 15.5px; font-weight: 600; letter-spacing: -.01em; }

            /* The permanent card (Settings) */
            .iap-panel {
                display: flex; gap: 16px; align-items: center; padding: 16px; margin: 0 0 18px;
                border-radius: 16px; border: 1px solid rgba(255,255,255,0.08);
                background: radial-gradient(120% 140% at 0% 0%, rgba(56,189,248,0.10), transparent 60%), rgba(255,255,255,0.03);
            }
            .iap-icon { flex: 0 0 auto; width: 52px; height: 52px; border-radius: 12px; object-fit: contain; padding: 6px; box-sizing: border-box; border: 1px solid rgba(255,255,255,0.12); background: #0b0f17; }
            .iap-body { flex: 1; min-width: 0; }
            .iap-body h4 { margin: 0 0 3px; font-size: 14.5px; font-weight: 700; color: #f4f4f5; }
            .iap-body p { margin: 0 0 12px; font-size: 12.5px; line-height: 1.5; color: #a1a1aa; }
            .iap-qr { flex: 0 0 auto; display: flex; flex-direction: column; align-items: center; gap: 6px; }
            .iap-qr img { width: 92px; height: 92px; border-radius: 10px; background: #fff; padding: 5px; box-sizing: border-box; image-rendering: pixelated; }
            .iap-qr span { font-size: 10.5px; color: #71717a; }
            @media (max-width: 640px) { .iap-qr { display: none; } }

            /* The one-time corner card */
            .iap-card {
                position: fixed; left: 20px; bottom: 20px; z-index: 9000; width: min(380px, calc(100vw - 24px));
                display: flex; gap: 14px; align-items: flex-start; padding: 14px 14px 14px 16px; border-radius: 16px; box-sizing: border-box;
                background: rgba(24,24,27,0.95); color: #f4f4f5; border: 1px solid rgba(255,255,255,0.1);
                box-shadow: 0 16px 40px rgba(0,0,0,0.45); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
                opacity: 0; transform: translateY(10px); transition: opacity .35s ease, transform .45s cubic-bezier(.2,.8,.2,1);
            }
            .iap-card.visible { opacity: 1; transform: none; }
            .iap-card .iap-icon { width: 44px; height: 44px; border-radius: 10px; }
            .iap-card-main { flex: 1; min-width: 0; }
            .iap-card-main b { display: block; font-size: 13.5px; margin: 1px 0 3px; }
            .iap-card-main > span { display: block; font-size: 12.5px; line-height: 1.45; color: #a1a1aa; }
            .iap-card-actions { display: flex; gap: 8px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
            .iap-card-qr { display: flex; gap: 10px; align-items: center; margin-top: 10px; }
            .iap-card-qr img { width: 76px; height: 76px; border-radius: 8px; background: #fff; padding: 4px; box-sizing: border-box; image-rendering: pixelated; }
            .iap-card-qr small { font-size: 11.5px; line-height: 1.45; color: #a1a1aa; }
            .iap-card-qr a { color: #7dd3fc; text-decoration: none; font-weight: 600; }
            .iap-card-qr a:hover { text-decoration: underline; }
            .iap-card-x { flex: 0 0 auto; width: 26px; height: 26px; margin: -4px -4px 0 0; border: 0; border-radius: 50%; background: none; color: #71717a; cursor: pointer; font-size: 14px; }
            .iap-card-x:hover { background: rgba(255,255,255,0.08); color: #fff; }
            @media (max-width: 768px) {
                .iap-card { left: 12px; right: 12px; width: auto; bottom: calc(86px + env(safe-area-inset-bottom)); }
            }
            @media (prefers-reduced-motion: reduce) { .iap-card { transition: none; } }
        `;
        document.head.appendChild(style);
    }
    injectStyles();

    // ---------------------------------------------------------------------
    // Markup
    // ---------------------------------------------------------------------

    function storeButton() {
        return `<a class="iap-store" href="${APP_URL}" target="_blank" rel="noopener" data-iap-get>
            <i class="fa-brands fa-apple"></i><span><small>Download on the</small><b>App Store</b></span></a>`;
    }

    // Settings › What's New (desktop). Empty where there is nothing to offer.
    function cardHtml() {
        if (!canPromote) return '';
        return `
            <div class="iap-panel ios-promo">
                <img class="iap-icon" src="Images/inflight-mark.png" alt="">
                <div class="iap-body">
                    <h4>InFlight for iPhone &amp; iPad</h4>
                    <p>The live map, your pilot profile and your flights, in your pocket. Sign in with the same account and everything is already there.</p>
                    ${storeButton()}
                </div>
                ${isDesktop ? `<div class="iap-qr"><img src="${QR_SRC}" alt="QR code for InFlight on the App Store" width="92" height="92"><span>Scan with your iPhone</span></div>` : ''}
            </div>`;
    }

    // The phone Settings sheet uses its own row styles; this is its row.
    function rowHtml() {
        if (!canPromote) return '';
        return `
            <a class="m-setting-row ios-promo" href="${APP_URL}" target="_blank" rel="noopener" data-iap-get style="text-decoration:none;color:inherit;">
                <div class="m-row-left">
                    <i class="fa-brands fa-apple" style="color:#f4f4f5;"></i>
                    <span>Get the iOS app</span>
                </div>
                <div class="m-row-right"><i class="fa-solid fa-arrow-up-right-from-square" style="opacity:.5;font-size:.8em;"></i></div>
            </a>`;
    }

    // Once someone has gone to the App Store from anywhere, the corner card
    // has done its job before it ever showed.
    document.addEventListener('click', (e) => {
        if (e.target.closest && e.target.closest('[data-iap-get]')) markSeen();
    });

    // ---------------------------------------------------------------------
    // The one-time corner card
    // ---------------------------------------------------------------------

    function seen() {
        try { return localStorage.getItem(SEEN_KEY) === '1'; } catch (_) { return true; }
    }
    function markSeen() {
        try { localStorage.setItem(SEEN_KEY, '1'); } catch (_) { /* private mode */ }
    }

    // Anything that means "someone is in the middle of something".
    const BLOCKERS = [
        '#inflight-pro-loader-overlay', '#fre-overlay', '#fre-window-demo', '.cl-overlay', '.cl-nudge',
        '#auth-modal-overlay.open', '.iadj-overlay', '.acs-overlay', '.pst-overlay', '.pcp-overlay',
        '#global-settings-modal-overlay.open', '.mobile-sheet-overlay.visible', '.modal-overlay.open'
    ].join(', ');

    let cardEl = null;
    function closeCard() {
        if (!cardEl) return;
        const el = cardEl;
        cardEl = null;
        clearTimeout(el._timer);
        el.classList.remove('visible');
        setTimeout(() => { try { el.remove(); } catch (_) {} }, 400);
    }

    function showCard() {
        if (cardEl) return;
        markSeen();
        cardEl = document.createElement('div');
        cardEl.className = 'iap-card';
        cardEl.setAttribute('role', 'status');
        cardEl.innerHTML = `
            <img class="iap-icon" src="Images/inflight-mark.png" alt="">
            <div class="iap-card-main">
                <b>InFlight is on the App Store</b>
                <span>Take the live map with you — same account, same profile.</span>
                ${isDesktop
                    ? `<div class="iap-card-qr"><img src="${QR_SRC}" alt="QR code for InFlight on the App Store" width="76" height="76">
                        <small>Scan with your iPhone’s camera, or <a href="${APP_URL}" target="_blank" rel="noopener" data-iap-get>open the App Store</a>.</small></div>`
                    : `<div class="iap-card-actions">${storeButton()}</div>`}
            </div>
            <button type="button" class="iap-card-x" aria-label="Dismiss"><i class="fa-solid fa-xmark"></i></button>`;
        cardEl.addEventListener('click', (e) => {
            if (e.target.closest('.iap-card-x')) closeCard();
            else if (e.target.closest('[data-iap-get]')) setTimeout(closeCard, 200);
        });
        const arm = (ms) => { clearTimeout(cardEl._timer); cardEl._timer = setTimeout(closeCard, ms); };
        cardEl.addEventListener('mouseenter', () => clearTimeout(cardEl && cardEl._timer));
        cardEl.addEventListener('mouseleave', () => cardEl && arm(8000));
        document.body.appendChild(cardEl);
        requestAnimationFrame(() => requestAnimationFrame(() => cardEl && cardEl.classList.add('visible')));
        arm(25000);
    }

    function maybeShowCard() {
        if (!canPromote || isIOSSafari || seen()) return;

        // One announcement per visit: if What's New is due this time, the app
        // waits for the next one.
        try {
            const cl = window.InflightChangelog;
            if (cl && localStorage.getItem('inflight_changelog_seen') !== cl.latestVersion) return;
        } catch (_) { return; }

        // Flight and replay links land on a window; leave those visits alone.
        try {
            const p = new URLSearchParams(window.location.search || '');
            if (p.get('flight') || p.get('replay') ||
                sessionStorage.getItem('inflight_share_payload') ||
                sessionStorage.getItem('inflight_replay_payload')) return;
        } catch (_) { /* non-fatal */ }

        const started = Date.now();
        const attempt = () => {
            if (seen()) return;
            const free = document.readyState === 'complete' && !document.hidden && !document.querySelector(BLOCKERS);
            if (free) showCard();
            else if (Date.now() - started < 6 * 60 * 1000) setTimeout(attempt, 15000);
        };
        // A little while into the visit, once the map has had its moment.
        setTimeout(attempt, 40000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', maybeShowCard, { once: true });
    } else {
        maybeShowCard();
    }

    window.InflightAppPromo = {
        url: APP_URL,
        available: canPromote,
        cardHtml,
        rowHtml,
        showCard,
        open() { markSeen(); window.open(APP_URL, '_blank', 'noopener'); }
    };
})();
