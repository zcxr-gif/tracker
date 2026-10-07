// halloween.js — the seasonal dressing on the live map.
//
// Whether it is on is decided by the small inline script in index.html's
// <head> (window.InflightHalloween), so the splash can be dressed before
// anything else loads. This file adds the rest once the page is up:
//
//   - a faint orange / purple glow at the edges of the map
//   - a few bats crossing the sky now and then
//   - a one-a-day greeting with a "Turn off" button
//
// All of it sits under the panels (or, for the greeting, briefly above them),
// never takes a pointer event it does not need, and comes down completely
// when the switch is turned off. Bats are skipped for prefers-reduced-motion.
(function () {
    'use strict';

    var HW = window.InflightHalloween;
    if (!HW) return;

    var GREETED_KEY = 'inflight-halloween-greeted';
    var THEME_COLOR = '#f97316';

    var BAT_SVG =
        '<svg viewBox="0 0 100 42" aria-hidden="true" focusable="false"><path d="' +
        'M50 14 L53 8 L54 15 C60 12 68 10 74 12 C82 8 92 10 98 18 C92 18 88 22 87 27 ' +
        'C83 24 78 25 76 29 C72 26 64 27 60 32 C57 30 54 32 52 38 L50 40 L48 38 ' +
        'C46 32 43 30 40 32 C36 27 28 26 24 29 C22 25 17 24 13 27 C12 22 8 18 2 18 ' +
        'C8 10 18 8 26 12 C32 10 40 12 46 15 L47 8 Z"/></svg>';

    var CSS = [
        '.hw-glow{position:fixed;inset:0;z-index:5;pointer-events:none;',
        'background:radial-gradient(ellipse 55% 45% at 0% 100%,rgba(249,115,22,.16),transparent 70%),',
        'radial-gradient(ellipse 50% 40% at 100% 0%,rgba(124,58,237,.16),transparent 70%),',
        'radial-gradient(ellipse 40% 30% at 100% 100%,rgba(249,115,22,.08),transparent 70%);',
        'opacity:0;transition:opacity 1.2s ease}',
        '.hw-glow.is-in{opacity:1}',
        '.hw-sky{position:fixed;inset:0;z-index:6;pointer-events:none;overflow:hidden}',
        '.hw-bat{position:absolute;top:0;left:0;will-change:transform}',
        '.hw-bat-bob{animation:hw-bob 1.6s ease-in-out infinite alternate}',
        '.hw-bat svg{display:block;width:100%;height:auto;fill:#0b0910;',
        'filter:drop-shadow(0 0 6px rgba(249,115,22,.35));',
        'transform-origin:50% 35%;animation:hw-flap .19s ease-in-out infinite alternate}',
        '@keyframes hw-flap{from{transform:scaleY(1)}to{transform:scaleY(.45)}}',
        '@keyframes hw-bob{from{transform:translateY(-10px)}to{transform:translateY(10px)}}',
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
        '@media (prefers-reduced-motion:reduce){.hw-glow,.hw-hello{transition:none}}'
    ].join('');

    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var state = null; // { glow, sky, timers[], prevThemeColor } while mounted

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

    // One bat across the screen, on a slightly sloped line, then removed.
    function flyBat(delay) {
        if (!state) return;
        var w = window.innerWidth, h = window.innerHeight;
        var size = 26 + Math.random() * 22;
        var ltr = Math.random() < 0.5;
        var y0 = h * (0.08 + Math.random() * 0.45);
        var y1 = y0 + (Math.random() - 0.5) * h * 0.3;
        var x0 = ltr ? -size - 20 : w + 20;
        var x1 = ltr ? w + 20 : -size - 20;

        var bat = document.createElement('div');
        bat.className = 'hw-bat';
        bat.style.width = size + 'px';
        bat.innerHTML = '<div class="hw-bat-bob">' + BAT_SVG + '</div>';
        // Desync the flap and bob so a group doesn't move as one.
        bat.firstChild.style.animationDelay = (-Math.random() * 1.6) + 's';
        bat.querySelector('svg').style.animationDelay = (-Math.random() * 0.2) + 's';
        bat.style.transform = 'translate(' + x0 + 'px,' + y0 + 'px)';
        state.sky.appendChild(bat);

        var anim = bat.animate([
            { transform: 'translate(' + x0 + 'px,' + y0 + 'px)' },
            { transform: 'translate(' + x1 + 'px,' + y1 + 'px)' }
        ], { duration: 7000 + Math.random() * 5000, delay: delay || 0, easing: 'linear', fill: 'forwards' });
        anim.onfinish = function () { bat.remove(); };
    }

    // A small flight of one to three bats, then wait and do it again. Skipped
    // while the tab is hidden or the splash is still up.
    function scheduleFlight(ms) {
        later(function () {
            if (!state) return;
            if (!document.hidden && !splashUp()) {
                var n = 1 + Math.floor(Math.random() * 3);
                for (var i = 0; i < n; i++) flyBat(i * (250 + Math.random() * 500));
            }
            scheduleFlight(18000 + Math.random() * 17000);
        }, ms);
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
            '<span class="hw-hello-text">Happy Halloween — watch out for bats</span>' +
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

    function mount() {
        if (state) return;
        injectStyles();
        state = { timers: [] };

        state.glow = document.createElement('div');
        state.glow.className = 'hw-glow';
        document.body.appendChild(state.glow);
        requestAnimationFrame(function () { if (state) state.glow.classList.add('is-in'); });

        state.sky = document.createElement('div');
        state.sky.className = 'hw-sky';
        document.body.appendChild(state.sky);

        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) { state.prevThemeColor = meta.content; meta.content = THEME_COLOR; }

        if (!reduceMotion) scheduleFlight(3500);
        later(greet, 2500);
    }

    function unmount() {
        if (!state) return;
        state.timers.forEach(clearTimeout);
        [state.glow, state.sky, state.hello].forEach(function (el) { if (el) el.remove(); });
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
