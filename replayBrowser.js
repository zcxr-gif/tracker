/*
 * replayBrowser.js — "Browse Replays" slide-over.
 *
 * Lists every stored flight replay across all users (GET /api/trails), grouped
 * by userId in collapsible sections (newest first), with search + incremental
 * paging so the all-users list stays fast. Clicking a replay fetches that
 * item's stored trail file (its "url"), and plays the points back through the
 * app's EXISTING replay engine via window.openFlightReplayById(id, meta,
 * { points }) — no new player, no new point format.
 *
 * Read-only. The S3 bucket/region is never hardcoded: playback always uses the
 * "url" the API returned. Trail files are fetched lazily, only when a replay is
 * opened. Styling mirrors the VA Partners slide-over so it matches the app.
 *
 * Exposed as window.InflightReplays = { open, close }.
 */
(function () {
  'use strict';

  var BACKEND = (window.APP_CONFIG && window.APP_CONFIG.backendUrl) || 'https://site--acars-backend--6dmjph8ltlhv.code.run';
  var TRAILS_URL = BACKEND + '/api/trails';
  var GROUP_PAGE = 25;   // group headers rendered per "Load more" step

  var overlayEl = null;
  var S = {
    items: [],        // raw /api/trails array
    groups: [],       // [{ userId, flights:[...], newest:Date }]
    query: '',
    visibleGroups: GROUP_PAGE,
    expanded: {},     // userId -> bool
    loaded: false,
    loading: false,
    error: false
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function toast(msg, type) {
    if (window.Toastify) {
      window.Toastify({
        text: msg, duration: 3800, gravity: 'bottom', position: 'center', close: true,
        style: { background: type === 'error' ? 'linear-gradient(135deg,#b91c1c,#7f1d1d)' : 'linear-gradient(135deg,#0e7490,#155e75)', borderRadius: '10px' }
      }).showToast();
    } else {
      (type === 'error' ? console.error : console.log)('[Replays] ' + msg);
    }
  }

  function relTime(d) {
    var s = Math.round((Date.now() - d.getTime()) / 1000);
    if (s < 45) return 'just now';
    var m = Math.round(s / 60); if (m < 60) return m + ' min' + (m > 1 ? 's' : '') + ' ago';
    var h = Math.round(m / 60); if (h < 24) return h + ' hour' + (h > 1 ? 's' : '') + ' ago';
    var dd = Math.round(h / 24); if (dd < 30) return dd + ' day' + (dd > 1 ? 's' : '') + ' ago';
    var mo = Math.round(dd / 30); if (mo < 12) return mo + ' month' + (mo > 1 ? 's' : '') + ' ago';
    var y = Math.round(mo / 12); return y + ' year' + (y > 1 ? 's' : '') + ' ago';
  }
  function absTime(d) {
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function fmtSize(bytes) {
    if (!bytes || bytes < 1024) return (bytes || 0) + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  // ---- data ----------------------------------------------------------------
  function regroup() {
    var q = S.query.trim().toLowerCase();
    var byUser = new Map();   // preserves newest-first insertion order
    for (var i = 0; i < S.items.length; i++) {
      var it = S.items[i];
      if (!it || !it.flightId) continue;
      var uid = it.userId || 'unknown';
      if (q && uid.toLowerCase().indexOf(q) === -1 && String(it.flightId).toLowerCase().indexOf(q) === -1) continue;
      if (!byUser.has(uid)) byUser.set(uid, []);
      byUser.get(uid).push(it);
    }
    var groups = [];
    byUser.forEach(function (flights, userId) {
      var newest = flights.reduce(function (mx, f) {
        var t = Date.parse(f.date); return (!isNaN(t) && t > mx) ? t : mx;
      }, 0);
      groups.push({ userId: userId, flights: flights, newest: newest ? new Date(newest) : null });
    });
    groups.sort(function (a, b) { return (b.newest ? b.newest.getTime() : 0) - (a.newest ? a.newest.getTime() : 0); });
    S.groups = groups;
  }

  function load() {
    if (S.loading) return;
    S.loading = true; S.error = false;
    render();
    fetch(TRAILS_URL, { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('trails ' + r.status); return r.json(); })
      .then(function (arr) {
        S.items = Array.isArray(arr) ? arr : (arr && Array.isArray(arr.trails) ? arr.trails : []);
        S.loaded = true; S.loading = false; S.error = false;
        regroup(); render();
      })
      .catch(function () {
        S.loading = false; S.error = true;
        toast('Couldn’t load replays. Check your connection and try again.', 'error');
        render();
      });
  }

  // ---- open a single replay ------------------------------------------------
  function playReplay(item, rowEl) {
    if (!item || !item.url) { toast('This replay has no file to play.', 'error'); return; }
    if (rowEl) rowEl.classList.add('is-loading');
    fetch(item.url, { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('trail ' + r.status); return r.json(); })
      .then(function (points) {
        if (rowEl) rowEl.classList.remove('is-loading');
        if (!Array.isArray(points) || points.length < 2) { toast('This replay has no track data.', 'error'); return; }
        if (typeof window.openFlightReplayById !== 'function') { toast('Replay player is not ready yet.', 'error'); return; }
        close();
        // Feed the trail points straight into the existing engine. It runs them
        // through the same normaliser the live tracker uses (t / lat / lon /
        // alt / heading), so no format conversion happens here.
        window.openFlightReplayById(String(item.flightId), { callsign: String(item.flightId) }, { points: points });
      })
      .catch(function () {
        if (rowEl) rowEl.classList.remove('is-loading');
        toast('Couldn’t load this replay’s track.', 'error');
      });
  }

  // ---- rendering -----------------------------------------------------------
  function bodyHTML() {
    if (S.loading && !S.loaded) {
      return '<div class="rb-state"><i class="fa-solid fa-circle-notch fa-spin"></i><span>Loading replays…</span></div>';
    }
    if (S.error && !S.loaded) {
      return '<div class="rb-state"><i class="fa-solid fa-triangle-exclamation"></i><span>Couldn’t load replays.</span>' +
        '<button class="rb-retry" data-rb="retry">Try again</button></div>';
    }
    if (!S.groups.length) {
      var msg = S.query ? 'No replays match “' + esc(S.query) + '”.' : 'No replays available yet.';
      return '<div class="rb-state"><i class="fa-solid fa-plane-slash"></i><span>' + msg + '</span></div>';
    }

    var totalFlights = S.groups.reduce(function (n, g) { return n + g.flights.length; }, 0);
    var head = '<div class="rb-count">' + totalFlights.toLocaleString() + ' replay' + (totalFlights === 1 ? '' : 's') +
      ' · ' + S.groups.length.toLocaleString() + ' pilot' + (S.groups.length === 1 ? '' : 's') + '</div>';

    var shown = S.groups.slice(0, S.visibleGroups);
    var groupsHTML = shown.map(function (g) {
      var open = !!S.expanded[g.userId];
      var rows = open ? g.flights.map(function (f, i) {
        var d = new Date(f.date);
        var valid = !isNaN(d.getTime());
        return '<button type="button" class="rb-row" data-rb="play" data-user="' + esc(g.userId) + '" data-idx="' + i + '">' +
          '<span class="rb-row-play"><i class="fa-solid fa-play"></i></span>' +
          '<span class="rb-row-main">' +
            '<span class="rb-row-fid">' + esc(f.flightId) + '</span>' +
            '<span class="rb-row-sub">' + (valid ? esc(relTime(d)) + ' · ' + esc(absTime(d)) : 'Unknown date') + (f.size ? ' · ' + fmtSize(f.size) : '') + '</span>' +
          '</span>' +
          '<span class="rb-row-spin"><i class="fa-solid fa-circle-notch fa-spin"></i></span>' +
        '</button>';
      }).join('') : '';

      return '<div class="rb-group' + (open ? ' is-open' : '') + '">' +
        '<button type="button" class="rb-group-head" data-rb="toggle" data-user="' + esc(g.userId) + '">' +
          '<i class="fa-solid fa-chevron-right rb-chev"></i>' +
          '<span class="rb-group-avatar"><i class="fa-solid fa-user-astronaut"></i></span>' +
          '<span class="rb-group-meta">' +
            '<span class="rb-group-name">' + esc(g.userId) + '</span>' +
            '<span class="rb-group-sub">' + g.flights.length + ' replay' + (g.flights.length === 1 ? '' : 's') +
              (g.newest ? ' · ' + esc(relTime(g.newest)) : '') + '</span>' +
          '</span>' +
        '</button>' +
        '<div class="rb-group-body">' + rows + '</div>' +
      '</div>';
    }).join('');

    var more = S.groups.length > S.visibleGroups
      ? '<button type="button" class="rb-more" data-rb="more">Load more pilots (' + (S.groups.length - S.visibleGroups) + ')</button>'
      : '';

    return head + '<div class="rb-groups">' + groupsHTML + '</div>' + more;
  }

  function render() {
    if (!overlayEl) return;
    var body = overlayEl.querySelector('.rb-body');
    if (body) body.innerHTML = bodyHTML();
  }

  // ---- overlay shell -------------------------------------------------------
  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    injectStyles();
    overlayEl = document.createElement('div');
    overlayEl.className = 'rb-overlay';
    overlayEl.innerHTML =
      '<div class="rb-panel" role="dialog" aria-label="Browse Replays">' +
        '<div class="rb-head">' +
          '<div class="rb-titles"><span class="rb-eyebrow">Playback</span><h2>Browse Replays</h2></div>' +
          '<button class="rb-close" title="Close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>' +
        '</div>' +
        '<div class="rb-search"><i class="fa-solid fa-magnifying-glass"></i>' +
          '<input type="text" placeholder="Search by pilot or flight id…" autocomplete="off">' +
        '</div>' +
        '<div class="rb-body"></div>' +
      '</div>';
    document.body.appendChild(overlayEl);

    overlayEl.addEventListener('click', function (e) { if (e.target === overlayEl) close(); });
    overlayEl.querySelector('.rb-close').addEventListener('click', close);

    var input = overlayEl.querySelector('.rb-search input');
    var t = 0;
    input.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () {
        S.query = input.value; S.visibleGroups = GROUP_PAGE; regroup(); render();
      }, 220);
    });

    // Delegated list interactions.
    overlayEl.querySelector('.rb-body').addEventListener('click', function (e) {
      var el = e.target.closest('[data-rb]');
      if (!el) return;
      var kind = el.getAttribute('data-rb');
      if (kind === 'toggle') {
        var uid = el.getAttribute('data-user');
        S.expanded[uid] = !S.expanded[uid];
        render();
      } else if (kind === 'play') {
        var g = S.groups.find(function (x) { return x.userId === el.getAttribute('data-user'); });
        var item = g && g.flights[parseInt(el.getAttribute('data-idx'), 10)];
        if (item) playReplay(item, el);
      } else if (kind === 'more') {
        S.visibleGroups += GROUP_PAGE; render();
      } else if (kind === 'retry') {
        load();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlayEl && overlayEl.classList.contains('visible')) close();
    });
    return overlayEl;
  }

  function open() {
    ensureOverlay();
    overlayEl.classList.add('visible');
    document.body.style.overflow = 'hidden';
    if (!S.loaded && !S.loading) load();
    else render();
  }
  function close() {
    if (!overlayEl) return;
    overlayEl.classList.remove('visible');
    document.body.style.overflow = '';
  }

  // ---- styles (mirror the VA Partners slide-over) --------------------------
  function injectStyles() {
    if (document.getElementById('rb-styles')) return;
    var st = document.createElement('style');
    st.id = 'rb-styles';
    st.textContent = [
      '.rb-overlay{position:fixed;inset:0;z-index:5060;display:flex;justify-content:flex-end;background:rgba(0,0,0,0.55);backdrop-filter:blur(4px);opacity:0;pointer-events:none;transition:opacity .2s ease;}',
      '.rb-overlay.visible{opacity:1;pointer-events:auto;}',
      '.rb-panel{width:min(560px,94vw);height:100%;display:flex;flex-direction:column;background:#121212;border-left:1px solid rgba(255,255,255,0.08);transform:translateX(20px);transition:transform .25s cubic-bezier(0.16,1,0.3,1);font-family:Inter,-apple-system,system-ui,sans-serif;}',
      '.rb-overlay.visible .rb-panel{transform:translateX(0);}',
      '.rb-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;padding:18px 18px 14px;flex:0 0 auto;border-bottom:1px solid rgba(255,255,255,0.06);}',
      '.rb-titles{display:flex;flex-direction:column;gap:3px;min-width:0;}',
      '.rb-eyebrow{font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:rgba(255,255,255,0.45);}',
      '.rb-head h2{font-size:1.6rem;font-weight:800;letter-spacing:-0.5px;color:#fff;margin:0;line-height:1;}',
      '.rb-close{background:rgba(255,255,255,0.06);border:none;color:#fff;cursor:pointer;width:34px;height:34px;border-radius:50%;font-size:.95rem;display:grid;place-items:center;flex:0 0 auto;}',
      '.rb-close:hover{background:rgba(255,255,255,0.12);}',
      '.rb-search{position:relative;padding:12px 18px;border-bottom:1px solid rgba(255,255,255,0.06);flex:0 0 auto;}',
      '.rb-search i{position:absolute;left:30px;top:50%;transform:translateY(-50%);color:rgba(255,255,255,0.35);font-size:.8rem;}',
      '.rb-search input{width:100%;box-sizing:border-box;padding:9px 12px 9px 32px;border-radius:10px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.12);color:#fff;font-size:.85rem;}',
      '.rb-search input:focus{outline:none;border-color:rgba(125,211,252,0.6);}',
      '.rb-body{flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:14px 18px;padding-bottom:max(env(safe-area-inset-bottom,0px),18px);}',
      '.rb-count{font-size:.72rem;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:rgba(255,255,255,0.4);margin:0 2px 10px;}',
      '.rb-state{display:flex;flex-direction:column;align-items:center;gap:12px;color:rgba(255,255,255,0.55);text-align:center;padding:56px 16px;font-size:.9rem;}',
      '.rb-state i{font-size:1.7rem;color:rgba(125,211,252,0.8);}',
      '.rb-retry,.rb-more{margin-top:6px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#fff;cursor:pointer;padding:9px 16px;border-radius:10px;font:inherit;font-size:.82rem;font-weight:600;}',
      '.rb-retry:hover,.rb-more:hover{background:rgba(255,255,255,0.12);}',
      '.rb-more{display:block;width:100%;margin-top:12px;}',
      '.rb-group{border:1px solid rgba(255,255,255,0.08);border-radius:12px;margin-bottom:10px;overflow:hidden;background:rgba(255,255,255,0.02);}',
      '.rb-group-head{display:flex;align-items:center;gap:11px;width:100%;text-align:left;cursor:pointer;background:none;border:none;color:#fff;font:inherit;padding:11px 13px;}',
      '.rb-group-head:hover{background:rgba(255,255,255,0.04);}',
      '.rb-chev{font-size:.72rem;color:rgba(255,255,255,0.4);transition:transform .18s ease;flex:0 0 auto;}',
      '.rb-group.is-open .rb-chev{transform:rotate(90deg);}',
      '.rb-group-avatar{width:32px;height:32px;border-radius:50%;background:rgba(125,211,252,0.14);color:#7dd3fc;display:grid;place-items:center;font-size:.85rem;flex:0 0 auto;}',
      '.rb-group-meta{min-width:0;flex:1;display:flex;flex-direction:column;}',
      '.rb-group-name{font-size:.9rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.rb-group-sub{font-size:.72rem;color:rgba(255,255,255,0.5);}',
      '.rb-group-body{display:flex;flex-direction:column;}',
      '.rb-group.is-open .rb-group-body{border-top:1px solid rgba(255,255,255,0.06);}',
      '.rb-row{display:flex;align-items:center;gap:11px;width:100%;text-align:left;cursor:pointer;background:none;border:none;border-top:1px solid rgba(255,255,255,0.04);color:#fff;font:inherit;padding:10px 13px 10px 16px;transition:background .12s ease;}',
      '.rb-row:first-child{border-top:none;}',
      '.rb-row:hover{background:rgba(125,211,252,0.08);}',
      '.rb-row-play{width:26px;height:26px;border-radius:50%;background:rgba(125,211,252,0.16);color:#7dd3fc;display:grid;place-items:center;font-size:.65rem;flex:0 0 auto;}',
      '.rb-row-main{min-width:0;flex:1;display:flex;flex-direction:column;}',
      '.rb-row-fid{font-size:.84rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:"JetBrains Mono",monospace;}',
      '.rb-row-sub{font-size:.7rem;color:rgba(255,255,255,0.5);}',
      '.rb-row-spin{display:none;color:#7dd3fc;flex:0 0 auto;}',
      '.rb-row.is-loading .rb-row-spin{display:block;}',
      '.rb-row.is-loading .rb-row-play{opacity:0.3;}',
      '@media (max-width:768px){',
        '.rb-overlay{justify-content:center;align-items:flex-end;}',
        '.rb-panel{width:100%;height:88vh;border-left:none;border-top-left-radius:18px;border-top-right-radius:18px;transform:translateY(24px);}',
        '.rb-overlay.visible .rb-panel{transform:translateY(0);}',
      '}'
    ].join('\n');
    document.head.appendChild(st);
  }

  // ---- wire the toolbar button --------------------------------------------
  function wireButton() {
    var btn = document.getElementById('toolbar-replays-btn');
    if (btn && !btn._rbWired) { btn._rbWired = true; btn.addEventListener('click', open); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireButton);
  else wireButton();
  // The toolbar can be (re)injected by flight.js after load; poll briefly.
  var tries = 0;
  var iv = setInterval(function () { wireButton(); if (++tries > 40 || (document.getElementById('toolbar-replays-btn') || {})._rbWired) clearInterval(iv); }, 500);

  window.InflightReplays = { open: open, close: close };
})();
