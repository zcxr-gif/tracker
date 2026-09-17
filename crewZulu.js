/* ============================================================================
   crewZulu.js — the time everybody in aviation actually uses.

   WHY

   Every time in this product is already Zulu underneath and shown in the
   reader's own zone: a departure at 14:30Z reads as "3:30 PM" to somebody in
   Berlin and "9:30 AM" to somebody in Toronto. That is right for "when is my
   flight", and it is useless for the thing a pilot is doing the moment before
   they push back, which is reading a brief, a METAR or an event card that says
   1430Z and working out whether that is now.

   So: the airline's clock, in the top bar, next to everything else that is
   always true. Not a conversion tool and not a setting — one line of the one
   time the whole of aviation agrees on, where a pilot can glance at it.

   WHAT IT IS CAREFUL ABOUT

   · IT TICKS ON THE SECOND, NOT EVERY SECOND. A naive setInterval(1000) drifts
     — it fires a millisecond later each time — so a clock set going at .999
     shows each second for a millisecond and each following one for very nearly
     two. Every tick is scheduled to the next real second boundary instead.
   · IT STOPS WHEN NOBODY IS LOOKING. A background tab does not need a timer,
     and a phone with the crew centre open behind something else should not be
     paying for one. It catches up on the way back.
   · IT NEVER MOVES ANYTHING. The figures are tabular and the field is sized
     for its widest reading, so a bar next to it does not shuffle sideways
     twice a minute.
   · IT IS THE DEVICE'S CLOCK, and says so. We cannot know better — there is no
     time source here but the machine the page is on — so a device set wrong
     shows a wrong Zulu, and the title says where the reading came from rather
     than implying an authority this has not got.

   HOW A PAGE USES IT

       <span data-crew-zulu></span>        anywhere in the markup
       CrewZulu.mount();                   once, after the DOM is up

   Every element carrying the attribute is painted and kept painted. Standalone:
   no dependencies, no styles from the host beyond the tokens it inherits.
   ========================================================================== */

(function (global) {
    'use strict';

    var CSS = ''
        + '.cz{display:inline-flex;align-items:baseline;gap:.25rem;'
        /* Tabular figures, or the colon walks left and right as the digits
           change width. This is the whole reason a clock in a toolbar can look
           broken while being perfectly correct. */
        + 'font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1;'
        + 'letter-spacing:-.01em;line-height:1;white-space:nowrap;}'
        + '.cz-t{font-size:.82rem;font-weight:650;color:var(--ink,#1C1A16);}'
        /* The Z is the unit, not part of the number, so it is set like one. */
        + '.cz-z{font-size:.6rem;font-weight:800;letter-spacing:.08em;'
        + 'color:var(--muted,#736E64);}'
        + '@media (max-width:420px){.cz-t{font-size:.76rem;}}';

    var hosts = [];
    var timer = null;
    var wired = false;

    function styles() {
        if (document.getElementById('cz-style')) return;
        var el = document.createElement('style');
        el.id = 'cz-style';
        el.textContent = CSS;
        (document.head || document.documentElement).appendChild(el);
    }

    var pad = function (n) { return n < 10 ? '0' + n : String(n); };

    /** The reading, and the sentence that explains where it came from. */
    function reading(now) {
        var d = now || new Date();
        var hhmm = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
        // The date matters more often than it looks: a crew centre open at
        // 23:40 local in Toronto is already tomorrow in Zulu, and an event card
        // that says "Saturday 0200Z" is the source of more confusion than any
        // other single thing in a virtual airline.
        var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        var full = DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]
            + ' ' + d.getUTCFullYear() + ', ' + hhmm + 'Z';
        return { hhmm: hhmm, full: full, iso: d.toISOString() };
    }

    function paintOne(host, r) {
        if (!host.dataset.czReady) {
            host.dataset.czReady = '1';
            host.className = (host.className ? host.className + ' ' : '') + 'cz';
            host.innerHTML = '<span class="cz-t"></span><span class="cz-z">Z</span>';
            // A <span> that changes every second is read out every second by a
            // screen reader following live regions. This is decoration for
            // anybody not looking at it, so it is announced only on demand —
            // the accessible name carries the full reading.
            host.setAttribute('role', 'timer');
            host.setAttribute('aria-live', 'off');
        }
        var t = host.querySelector('.cz-t');
        if (t && t.textContent !== r.hhmm) t.textContent = r.hhmm;
        host.setAttribute('title', r.full + ' — from this device’s clock');
        host.setAttribute('aria-label', 'Zulu time ' + r.hhmm);
        if (host.tagName === 'TIME') host.setAttribute('datetime', r.iso);
    }

    function paint() {
        hosts = hosts.filter(function (h) { return h && h.isConnected; });
        if (!hosts.length) { stop(); return; }
        var r = reading();
        for (var i = 0; i < hosts.length; i++) paintOne(hosts[i], r);
    }

    /* Scheduled to the next real second rather than every 1000ms. See the note
       at the top: an interval drifts, and a drifting clock shows one second for
       an instant and the next for nearly two. */
    function tick() {
        paint();
        var wait = 1000 - (Date.now() % 1000);
        timer = setTimeout(tick, wait < 40 ? wait + 1000 : wait);
    }

    function start() {
        if (timer || !hosts.length) return;
        tick();
    }

    function stop() {
        if (!timer) return;
        clearTimeout(timer);
        timer = null;
    }

    function wire() {
        if (wired) return;
        wired = true;
        // A tab nobody is looking at does not need a timer. Painted once on the
        // way back so it is never briefly wrong.
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') stop();
            else { paint(); start(); }
        });
    }

    /**
     * Paint every [data-crew-zulu] on the page and keep them painted.
     *
     * Safe to call more than once — a page that adds a second host after its
     * first paint calls it again and the new one joins. Hosts that leave the
     * document drop out on the next tick, and the timer stops when the last
     * one goes.
     */
    function mount(root) {
        styles();
        wire();
        var scope = root || document;
        var found = scope.querySelectorAll ? scope.querySelectorAll('[data-crew-zulu]') : [];
        for (var i = 0; i < found.length; i++) {
            if (hosts.indexOf(found[i]) === -1) hosts.push(found[i]);
        }
        if (!hosts.length) return;
        paint();
        start();
    }

    global.CrewZulu = { mount: mount, reading: reading, stop: stop, version: 1 };
})(window);
