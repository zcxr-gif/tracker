// halloween.js — the seasonal dressing on the live map.
//
// Whether it is on is decided by the small inline script in index.html's
// <head> (window.InflightHalloween), so the splash can be dressed before
// anything else loads. This file adds the rest once the page is up:
//
//   - a faint orange / purple glow at the edges of the map
//   - a little ghost hanging on a thread from the top bar, softly glowing;
//     tap it and a card pops out (the Halloween Pro sale, when it applies)
//   - a little pumpkin on the logo (desktop) or the server button (phone)
//   - a one-a-day greeting with a "Turn off" button
//
// All of it sits under the panels (or, for the greeting, briefly above them),
// never takes a pointer event it does not need, and comes down completely
// when the switch is turned off. Nothing moves for prefers-reduced-motion.
(function () {
    'use strict';

    var HW = window.InflightHalloween;
    if (!HW) return;

    var GREETED_KEY = 'inflight-halloween-greeted';
    var THEME_COLOR = '#f97316';

    var GHOST_SVG =
        '<svg viewBox="0 0 40 48" aria-hidden="true" focusable="false">' +
        '<defs><linearGradient id="hw-ghost-shade" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ddd6fe"/></linearGradient></defs>' +
        '<path fill="url(#hw-ghost-shade)" d="M20 2C9 2 4 10 4 20v22c0 2 2 3 3.5 1.5L10 41l3 3.5c1 1 2 1 3 0' +
        'l4-3.5 4 3.5c1 1 2 1 3 0l3-3.5 2.5 2.5c1.5 1.5 3.5.5 3.5-1.5V20C36 10 31 2 20 2z"/>' +
        '<ellipse cx="14.5" cy="19" rx="2.6" ry="3.6" fill="#2e1065"/>' +
        '<ellipse cx="25.5" cy="19" rx="2.6" ry="3.6" fill="#2e1065"/>' +
        '<ellipse cx="20" cy="28" rx="2.3" ry="3" fill="#2e1065"/>' +
        '<ellipse cx="9.5" cy="25" rx="2.2" ry="1.3" fill="#f9a8d4" opacity=".55"/>' +
        '<ellipse cx="30.5" cy="25" rx="2.2" ry="1.3" fill="#f9a8d4" opacity=".55"/>' +
        '</svg>';

    // A jack-o'-lantern, as a data URI so CSS can place it on existing chrome.
    var PUMPKIN_SVG =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
        '<path d="M16 8.5c.3-2.6 1.4-4.6 3.6-5.6l.9 1.5c-1.7.8-2.6 2.3-2.7 4.3z" fill="#4d7c0f"/>' +
        '<ellipse cx="9.5" cy="18.5" rx="7" ry="10" fill="#ea580c"/>' +
        '<ellipse cx="22.5" cy="18.5" rx="7" ry="10" fill="#ea580c"/>' +
        '<ellipse cx="16" cy="18.5" rx="8" ry="10.5" fill="#f97316"/>' +
        '<path d="M16 8.3v20.4" stroke="#c2410c" stroke-width=".8" opacity=".6"/>' +
        '<path d="M10 15l3 3.2h-6zM22 15l3 3.2h-6z" fill="#fde047"/>' +
        '<path d="M8.5 21.5c2 3 13 3 15 0l-2.2 1-1.3-1.2-1.6 1.6-1.7-1.4-1.7 1.4-1.6-1.6-1.3 1.2z" fill="#fde047"/>' +
        '</svg>';
    var PUMPKIN_URI = 'url("data:image/svg+xml,' + encodeURIComponent(PUMPKIN_SVG) + '")';

    var CSS = [
        '.hw-glow{position:fixed;inset:0;z-index:5;pointer-events:none;',
        'background:radial-gradient(ellipse 55% 45% at 0% 100%,rgba(249,115,22,.16),transparent 70%),',
        'radial-gradient(ellipse 50% 40% at 100% 0%,rgba(124,58,237,.16),transparent 70%),',
        'radial-gradient(ellipse 40% 30% at 100% 100%,rgba(249,115,22,.08),transparent 70%);',
        'opacity:0;transition:opacity 1.2s ease}',
        '.hw-glow.is-in{opacity:1}',
        // The ghost hangs from behind the top bar (it sits under the panels),
        // swinging a little from the top of its thread.
        '.hw-ghost{position:fixed;top:0;right:max(84px,14vw);z-index:5;pointer-events:none;',
        'display:flex;flex-direction:column;align-items:center;transform-origin:50% 0;',
        'animation:hw-sway 4.2s ease-in-out infinite alternate;opacity:0;transition:opacity 1.2s ease}',
        '.hw-ghost.is-in{opacity:1}',
        '.hw-ghost-thread{width:1px;height:calc(env(safe-area-inset-top,0px) + 92px);',
        'background:linear-gradient(rgba(255,255,255,.1),rgba(255,255,255,.45))}',
        '.hw-ghost-body{position:relative;width:34px;margin-top:-2px;pointer-events:auto;cursor:pointer;',
        '-webkit-tap-highlight-color:transparent;outline:none;border-radius:50%}',
        '.hw-ghost-body:focus-visible{box-shadow:0 0 0 2px rgba(221,214,254,.8)}',
        '.hw-ghost-body.is-popping svg{animation:hw-pop .5s ease-out}',
        '@keyframes hw-pop{0%{transform:none}35%{transform:translateY(-6px) scale(1.3)}70%{transform:scale(.94)}100%{transform:none}}',
        // The card that pops out of the ghost.
        '.hw-boo{position:fixed;z-index:1200;width:min(290px,calc(100vw - 32px));box-sizing:border-box;',
        'padding:16px 16px 14px;border-radius:16px;background:rgba(24,18,30,.97);',
        'border:1px solid rgba(221,214,254,.3);box-shadow:0 14px 40px rgba(0,0,0,.5),0 0 30px rgba(167,139,250,.22);',
        'color:#f5ede4;font:400 13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
        'transform-origin:var(--hw-ax,50%) 0;transform:translateY(-10px) scale(.5);opacity:0;',
        'transition:transform .34s cubic-bezier(.34,1.56,.64,1),opacity .18s ease}',
        '.hw-boo.is-in{transform:none;opacity:1}',
        '.hw-boo::before{content:"";position:absolute;top:-7px;left:calc(var(--hw-ax,50%) - 6px);width:12px;height:12px;',
        'background:rgb(24,18,30);border-left:1px solid rgba(221,214,254,.3);border-top:1px solid rgba(221,214,254,.3);transform:rotate(45deg)}',
        '.hw-boo h4{margin:0 26px 4px 0;font-size:15px;font-weight:800;color:#fff}',
        '.hw-boo p{margin:0;color:#cfc6dd}',
        '.hw-boo-price{display:flex;align-items:baseline;gap:8px;margin:10px 0 2px}',
        '.hw-boo-price b{font-size:28px;font-weight:900;color:#fb923c;letter-spacing:-.02em}',
        '.hw-boo-price s{color:#8f86a0;font-size:14px}',
        '.hw-boo-price span{color:#cfc6dd;font-size:12px}',
        '.hw-boo-cta{display:block;width:100%;margin-top:12px;padding:10px 14px;border:0;border-radius:12px;cursor:pointer;',
        'font-family:inherit;font-size:14px;font-weight:800;line-height:1;color:#1c1206;background:linear-gradient(135deg,#fb923c,#fbbf24);',
        'box-shadow:0 6px 18px rgba(249,115,22,.35)}',
        '.hw-boo-cta:hover,.hw-boo-cta:focus-visible{filter:brightness(1.08)}',
        '.hw-boo small{display:block;margin-top:8px;color:#8f86a0;font-size:11px;text-align:center}',
        '.hw-boo-x{position:absolute;top:10px;right:10px;width:26px;height:26px;border:0;border-radius:50%;cursor:pointer;',
        'background:rgba(255,255,255,.06);color:#b9b2c4;font-size:15px;line-height:26px;padding:0}',
        '.hw-ghost-body svg{position:relative;display:block;width:100%;height:auto;',
        'filter:drop-shadow(0 0 4px rgba(221,214,254,.8))}',
        '.hw-ghost-glow{position:absolute;left:50%;top:50%;width:96px;height:96px;margin:-48px 0 0 -48px;',
        'pointer-events:none;border-radius:50%;background:radial-gradient(circle,rgba(221,214,254,.55) 0%,rgba(167,139,250,.22) 38%,transparent 70%);',
        'animation:hw-glow 3.2s ease-in-out infinite alternate}',
        '@keyframes hw-sway{from{transform:rotate(-5deg)}to{transform:rotate(5deg)}}',
        '@keyframes hw-glow{from{opacity:.35;transform:scale(.9)}to{opacity:.9;transform:scale(1.05)}}',
        '@media (max-width:768px){.hw-ghost{right:76px}.hw-ghost-body{width:28px}',
        '.hw-ghost-thread{height:calc(env(safe-area-inset-top,0px) + 70px)}}',
        // The pumpkin: perched on the corner of the desktop logo, and on the
        // server button in the phone's top bar (where the logo is hidden).
        'html.is-halloween #inflight-tactical-ui .lui-brand{position:relative}',
        'html.is-halloween #inflight-tactical-ui .lui-brand::after{content:"";position:absolute;',
        'left:13px;top:11px;width:19px;height:19px;background:' + PUMPKIN_URI + ' center/contain no-repeat;',
        'filter:drop-shadow(0 1px 2px rgba(0,0,0,.6));transform-origin:50% 100%;',
        'animation:hw-wobble 5s ease-in-out infinite;pointer-events:none}',
        'html.is-halloween #ios-server-pill::after{content:"";position:absolute;right:-7px;top:-6px;',
        'width:18px;height:18px;background:' + PUMPKIN_URI + ' center/contain no-repeat;',
        'filter:drop-shadow(0 1px 2px rgba(0,0,0,.6));transform-origin:50% 100%;',
        'animation:hw-wobble 5s ease-in-out infinite;pointer-events:none}',
        '@keyframes hw-wobble{0%,86%,100%{transform:rotate(0)}89%{transform:rotate(-12deg)}',
        '92%{transform:rotate(10deg)}95%{transform:rotate(-5deg)}}',
        '.hw-hello{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 16px);z-index:1200;',
        'display:flex;align-items:center;gap:10px;max-width:calc(100vw - 32px);box-sizing:border-box;',
        'padding:8px 8px 8px 14px;border-radius:999px;',
        'background:rgba(24,18,30,.92);border:1px solid rgba(249,115,22,.45);',
        'box-shadow:0 8px 28px rgba(0,0,0,.45),0 0 18px rgba(249,115,22,.18);',
        'color:#f5ede4;font:600 13px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
        '-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);',
        'transform:translate(-50%,-12px);opacity:0;transition:opacity .35s ease,transform .35s ease}',
        '.hw-hello.is-in{transform:translate(-50%,0);opacity:1}',
        '.hw-hello-icon{font-size:18px;line-height:1}',
        '.hw-hello-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.hw-hello button{flex:none;font:inherit;font-size:12px;cursor:pointer;border-radius:999px;',
        'color:#fdba74;background:rgba(249,115,22,.12);border:1px solid rgba(249,115,22,.35);padding:5px 10px}',
        '.hw-hello button:hover,.hw-hello button:focus-visible{background:rgba(249,115,22,.22)}',
        '.hw-hello .hw-hello-x{color:#b9b2c4;background:none;border-color:transparent;padding:5px 8px}',
        '@media (prefers-reduced-motion:reduce){.hw-glow,.hw-hello,.hw-ghost{transition:none}',
        '.hw-ghost,.hw-ghost-glow,.hw-ghost-body.is-popping svg{animation:none}.hw-boo{transition:none}',
        'html.is-halloween #inflight-tactical-ui .lui-brand::after,html.is-halloween #ios-server-pill::after{animation:none}}'
    ].join('');

    var state = null; // { glow, ghost, hello, boo, timers[], prevThemeColor } while mounted

    function injectStyles() {
        if (document.getElementById('hw-styles')) return;
        var s = document.createElement('style');
        s.id = 'hw-styles';
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    function later(fn, ms) {
        var t = setTimeout(fn, ms);
        if (state) state.timers.push(t);
        return t;
    }

    function splashUp() {
        return !!document.getElementById('inflight-pro-loader-overlay');
    }

    function today() {
        var d = new Date();
        return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    }

    function greet() {
        if (!state) return;
        if (splashUp()) { later(greet, 1000); return; }
        try {
            if (localStorage.getItem(GREETED_KEY) === today()) return;
            localStorage.setItem(GREETED_KEY, today());
        } catch (_) { /* private mode: greet anyway */ }

        var el = document.createElement('div');
        el.className = 'hw-hello';
        el.setAttribute('role', 'status');
        el.innerHTML =
            '<span class="hw-hello-icon" aria-hidden="true">🎃</span>' +
            '<span class="hw-hello-text">' + (saleForThisPilot() ? 'Happy Halloween! Tap the ghost \uD83D\uDC7B' : 'Happy Halloween!') + '</span>' +
            '<button type="button" class="hw-hello-off">Turn off</button>' +
            '<button type="button" class="hw-hello-x" aria-label="Dismiss"><i class="fa-solid fa-xmark"></i></button>';
        document.body.appendChild(el);
        state.hello = el;

        var close = function () {
            el.classList.remove('is-in');
            setTimeout(function () { el.remove(); }, 400);
        };
        el.querySelector('.hw-hello-x').addEventListener('click', close);
        el.querySelector('.hw-hello-off').addEventListener('click', function () { HW.set(false); });
        requestAnimationFrame(function () { el.classList.add('is-in'); });
        later(close, 9000);
    }

    // The sale card is for pilots who could take the offer: sale running, not
    // already Pro (and never on iOS, where InflightSale.active() is false).
    // Whether they have subscribed before is only known at checkout, which is
    // where the first-time-subscriber rule is enforced.
    function saleForThisPilot() {
        var sale = window.InflightSale;
        var pro = typeof window.isInflightPro === 'function' && window.isInflightPro();
        return !!(sale && sale.active()) && !pro;
    }

    function closeBoo() {
        if (!state || !state.boo) return;
        var el = state.boo;
        state.boo = null;
        document.removeEventListener('pointerdown', state.onOutside, true);
        document.removeEventListener('keydown', state.onKey, true);
        window.removeEventListener('resize', closeBoo);
        el.classList.remove('is-in');
        setTimeout(function () { el.remove(); }, 250);
    }

    // Tap the ghost: it jumps, and a card pops out underneath it.
    function boo() {
        if (!state) return;
        var body = state.ghost.querySelector('.hw-ghost-body');
        body.classList.remove('is-popping');
        void body.offsetWidth; // restart the jump on every tap
        body.classList.add('is-popping');
        if (state.boo) { closeBoo(); return; }

        var el = document.createElement('div');
        el.className = 'hw-boo';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-label', 'Halloween');
        var x = '<button type="button" class="hw-boo-x" aria-label="Close">\u00D7</button>';
        if (saleForThisPilot()) {
            el.innerHTML = x +
                '<h4>Boo! Halloween sale \uD83C\uDF83</h4>' +
                '<p>Your first month of InFlight Pro, half price.</p>' +
                '<div class="hw-boo-price"><b>$0.99</b><s>$1.99</s><span>first month</span></div>' +
                '<p>Then $1.99/mo. Or go yearly: <strong style="color:#fdba74">15% off</strong>, $16.92 your first year.</p>' +
                '<button type="button" class="hw-boo-cta">Get Pro</button>' +
                '<small>New subscribers only \u00B7 ends Oct 31</small>';
        } else {
            el.innerHTML = x +
                '<h4>Boo! \uD83D\uDC7B</h4>' +
                '<p>Happy Halloween from everyone at InFlight. Fly safe out there tonight.</p>';
        }
        document.body.appendChild(el);
        state.boo = el;

        // Under the ghost, kept on screen, with the arrow pointing back at it.
        var r = body.getBoundingClientRect();
        var cx = r.left + r.width / 2;
        var w = el.offsetWidth;
        var left = Math.max(16, Math.min(cx - w / 2, window.innerWidth - w - 16));
        el.style.left = left + 'px';
        el.style.top = (r.bottom + 12) + 'px';
        el.style.setProperty('--hw-ax', (cx - left) + 'px');
        requestAnimationFrame(function () { el.classList.add('is-in'); });

        el.querySelector('.hw-boo-x').addEventListener('click', closeBoo);
        var cta = el.querySelector('.hw-boo-cta');
        if (cta) cta.addEventListener('click', function () {
            closeBoo();
            if (typeof window.startProUpgrade === 'function') window.startProUpgrade();
        });
        state.onOutside = function (e) {
            if (!el.contains(e.target) && !body.contains(e.target)) closeBoo();
        };
        state.onKey = function (e) { if (e.key === 'Escape') closeBoo(); };
        document.addEventListener('pointerdown', state.onOutside, true);
        document.addEventListener('keydown', state.onKey, true);
        window.addEventListener('resize', closeBoo);
    }

    function mount() {
        if (state) return;
        injectStyles();
        state = { timers: [] };

        state.glow = document.createElement('div');
        state.glow.className = 'hw-glow';
        document.body.appendChild(state.glow);
        requestAnimationFrame(function () {
            if (state) { state.glow.classList.add('is-in'); state.ghost.classList.add('is-in'); }
        });

        state.ghost = document.createElement('div');
        state.ghost.className = 'hw-ghost';
        state.ghost.innerHTML = '<div class="hw-ghost-thread"></div>' +
            '<div class="hw-ghost-body" role="button" tabindex="0" aria-label="Boo!">' +
            '<div class="hw-ghost-glow"></div>' + GHOST_SVG + '</div>';
        document.body.appendChild(state.ghost);
        var ghostBody = state.ghost.querySelector('.hw-ghost-body');
        ghostBody.addEventListener('click', boo);
        ghostBody.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); boo(); }
        });

        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) { state.prevThemeColor = meta.content; meta.content = THEME_COLOR; }

        later(greet, 2500);
    }

    function unmount() {
        if (!state) return;
        closeBoo();
        state.timers.forEach(clearTimeout);
        [state.glow, state.ghost, state.hello].forEach(function (el) { if (el) el.remove(); });
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta && state.prevThemeColor) meta.content = state.prevThemeColor;
        state = null;
    }

    window.addEventListener('inflight:halloween', function (e) {
        if (e.detail && e.detail.on) mount(); else unmount();
        // Keep whichever settings panel is open in step with the switch.
        document.querySelectorAll('input[data-setting="halloweenTheme"], #set-halloween').forEach(function (c) {
            c.checked = HW.isOn();
        });
    });

    if (HW.isOn()) mount();
})();
