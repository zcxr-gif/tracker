/*
 * historyReplay.js — standalone "Plane Finder–style" flight-history replay.
 *
 * Powers history.html: a dedicated, shareable page for ONE past flight. Scrubs
 * the recorded track on a (free, token-less) MapLibre map with a synced
 * altitude/speed graph and live Time/Altitude/Speed readouts.
 *
 * This is deliberately INDEPENDENT of the in-app FlightReplay (flightReplay.js):
 * that one is a cinematic takeover docked inside the live map. This one is its
 * own page and is maintained separately. It only shares read-only helpers that
 * are already global — window.FlightGraph (the chart) and
 * window.InflightAircraftPhoto (photos) — and the same /history data feed.
 *
 * URL params:  ?flight=<id>  (or ?flightId / ?id)
 *              &callsign= &reg= &type= &operator= &dep= &arr= &date=
 *              &style=dark|liberty|bright|positron   (map style, default dark)
 */
(function () {
  'use strict';

  // Same read-only feed the rest of the app uses for flown trails.
  var ACARS_BACKEND = 'https://site--acars-backend--6dmjph8ltlhv.code.run';
  var HISTORY_BASE = ACARS_BACKEND + '/api/flights';
  var INDGO_BACKEND = 'https://site--indgo-backend--6dmjph8ltlhv.code.run';   // community aircraft images

  var FREE_STYLES = {
    dark: 'https://tiles.openfreemap.org/styles/dark',
    liberty: 'https://tiles.openfreemap.org/styles/liberty',
    bright: 'https://tiles.openfreemap.org/styles/bright',
    positron: 'https://tiles.openfreemap.org/styles/positron'
  };

  // Airline square logo, keyed by the callsign's ICAO prefix (best-effort).
  function airlineLogoUrl(icao) {
    if (!icao) return '';
    return 'https://raw.githubusercontent.com/sexym0nk3y/airline-logos/main/logos/' + icao.toUpperCase() + '.png';
  }

  // ---- tolerant point parsing (mirrors flight-graph.js's two shapes) --------
  function num(v) { return (typeof v === 'number' && !isNaN(v)) ? v : null; }
  function pLat(p) {
    var v = num(p.latitude); if (v != null) return v;
    v = num(p.lat); if (v != null) return v;
    if (p.position) { v = num(p.position.lat); if (v != null) return v; v = num(p.position.latitude); if (v != null) return v; }
    return null;
  }
  function pLon(p) {
    var v = num(p.longitude); if (v != null) return v;
    v = num(p.lon); if (v != null) return v;
    v = num(p.lng); if (v != null) return v;
    if (p.position) {
      v = num(p.position.lon); if (v != null) return v;
      v = num(p.position.lng); if (v != null) return v;
      v = num(p.position.longitude); if (v != null) return v;
    }
    return null;
  }
  function pAlt(p) {
    var v = num(p.altitude); if (v != null) return v;
    v = num(p.alt_ft); if (v != null) return v;
    v = num(p.alt); if (v != null) return v;
    if (p.position) { v = num(p.position.alt_ft); if (v != null) return v; v = num(p.position.altitude); if (v != null) return v; v = num(p.position.alt); if (v != null) return v; }
    return null;
  }
  function pGs(p) {
    var v = num(p.groundSpeed); if (v != null) return v;
    v = num(p.gs_kt); if (v != null) return v;
    v = num(p.gs); if (v != null) return v;
    v = num(p.speed); if (v != null) return v;
    if (p.position) { v = num(p.position.gs_kt); if (v != null) return v; v = num(p.position.groundSpeed); if (v != null) return v; v = num(p.position.gs); if (v != null) return v; }
    return null;
  }
  function pTime(p) {
    // Stored trail files key time on a numeric "t"; the /history feed uses
    // date / lastReportMs / timestamp.
    if (num(p.t) != null) return p.t;
    if (p.date) { var t = Date.parse(p.date); if (!isNaN(t)) return t; }
    if (num(p.lastReportMs) != null) return p.lastReportMs;
    if (num(p.timeMs) != null) return p.timeMs;
    if (num(p.time) != null) return p.time;
    if (num(p.timestamp) != null) return p.timestamp;
    if (p.position) {
      if (num(p.position.t) != null) return p.position.t;
      if (num(p.position.lastReportMs) != null) return p.position.lastReportMs;
      if (p.position.lastReport) { var t2 = Date.parse(p.position.lastReport); if (!isNaN(t2)) return t2; }
    }
    return null;
  }

  // Normalise the raw /history payload into clean, time-sorted samples.
  // The ACARS backend returns { ok:true, path:[...] } (or route:[...]); accept
  // those first, then the other shapes seen across the app, then a bare array.
  function normalize(raw) {
    var arr = Array.isArray(raw) ? raw
      : (raw && Array.isArray(raw.path)) ? raw.path
      : (raw && Array.isArray(raw.route)) ? raw.route
      : (raw && Array.isArray(raw.history)) ? raw.history
      : (raw && Array.isArray(raw.points)) ? raw.points
      : (raw && Array.isArray(raw.data)) ? raw.data : [];
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var p = arr[i]; if (!p || typeof p !== 'object') continue;
      var lat = pLat(p), lon = pLon(p), t = pTime(p);
      if (lat == null || lon == null || t == null) continue;
      out.push({ lat: lat, lon: lon, t: t, alt: pAlt(p), gs: pGs(p) });
    }
    out.sort(function (a, b) { return a.t - b.t; });
    // drop exact-duplicate timestamps
    var dedup = [];
    for (var j = 0; j < out.length; j++) {
      if (j > 0 && out[j].t === out[j - 1].t) continue;
      dedup.push(out[j]);
    }
    // Unwrap longitude so an antimeridian-crossing flight (e.g. trans-Pacific)
    // draws one continuous line instead of one that streaks across the whole
    // map. MapLibre renders lon values beyond ±180 correctly.
    for (var m = 1; m < dedup.length; m++) {
      while (dedup[m].lon - dedup[m - 1].lon > 180) dedup[m].lon -= 360;
      while (dedup[m].lon - dedup[m - 1].lon < -180) dedup[m].lon += 360;
    }
    return dedup;
  }

  // ---- small helpers --------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtClock(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    var m = Math.floor(s / 60); s = s % 60;
    if (m >= 60) { var h = Math.floor(m / 60); m = m % 60; return h + ':' + pad2(m) + ':' + pad2(s); }
    return pad2(m) + ':' + pad2(s);
  }
  function fmtUtcTime(t) {
    var d = new Date(t);
    return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
  }
  function fmtDate(t) {
    var d = new Date(t);
    return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  }
  function fmtAlt(v) { return v == null ? '—' : Math.round(v).toLocaleString() + 'ft'; }
  function fmtGs(v) { return v == null ? '—' : Math.round(v) + 'kt'; }
  function bearing(a, b) {
    var toR = Math.PI / 180, toD = 180 / Math.PI;
    var y = Math.sin((b.lon - a.lon) * toR) * Math.cos(b.lat * toR);
    var x = Math.cos(a.lat * toR) * Math.sin(b.lat * toR) - Math.sin(a.lat * toR) * Math.cos(b.lat * toR) * Math.cos((b.lon - a.lon) * toR);
    return (Math.atan2(y, x) * toD + 360) % 360;
  }
  function lerp(a, b, f) { return a + (b - a) * f; }

  // Value of a sample field interpolated at absolute time t.
  function sampleAt(pts, t) {
    if (!pts.length) return null;
    if (t <= pts[0].t) return { lat: pts[0].lat, lon: pts[0].lon, alt: pts[0].alt, gs: pts[0].gs, i: 0, f: 0 };
    var last = pts[pts.length - 1];
    if (t >= last.t) return { lat: last.lat, lon: last.lon, alt: last.alt, gs: last.gs, i: pts.length - 1, f: 0 };
    // binary search for segment
    var lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (pts[mid].t <= t) lo = mid; else hi = mid; }
    var a = pts[lo], b = pts[hi];
    var f = (b.t === a.t) ? 0 : (t - a.t) / (b.t - a.t);
    return {
      lat: lerp(a.lat, b.lat, f), lon: lerp(a.lon, b.lon, f),
      alt: (a.alt != null && b.alt != null) ? lerp(a.alt, b.alt, f) : (a.alt != null ? a.alt : b.alt),
      gs: (a.gs != null && b.gs != null) ? lerp(a.gs, b.gs, f) : (a.gs != null ? a.gs : b.gs),
      i: lo, f: f
    };
  }

  // ---- main -----------------------------------------------------------------
  var SPEED_OPTIONS = [1, 2, 5, 10, 30, 60];
  var COMPRESS = 90;                 // 1× plays the flight ~90× faster than real
  var MIN_REPLAY_MS = 45 * 1000;
  var MAX_REPLAY_MS = 15 * 60 * 1000;

  var S = {
    pts: [], fullPts: [], t0: 0, tEnd: 0, realMs: 0, baseReplayMs: 0,
    progress: 0, speed: 1, playing: false, scrubbing: false,
    map: null, marker: null, follow: true, pathVisible: true, userInteracting: false,
    raf: 0, lastWall: 0, W: 680, H: 200, tMin: 0, tMax: 0,
    gl: null, acType: '', legs: [], activeLeg: null
  };

  function qp() {
    var p = new URLSearchParams(location.search);
    return {
      flight: (p.get('flight') || p.get('flightId') || p.get('id') || '').trim(),
      trail: (p.get('trail') || '').trim(),   // direct stored-trail file url (points array)
      callsign: (p.get('callsign') || '').trim(),
      reg: (p.get('reg') || p.get('registration') || '').trim(),
      type: (p.get('type') || p.get('aircraft') || '').trim(),
      operator: (p.get('operator') || p.get('op') || '').trim(),
      dep: (p.get('dep') || p.get('departure') || '').trim().toUpperCase(),
      arr: (p.get('arr') || p.get('arrival') || '').trim().toUpperCase(),
      date: (p.get('date') || '').trim(),
      style: (p.get('style') || 'dark').trim().toLowerCase()
    };
  }

  function showError(msg, diag) {
    $('hr-loading').classList.add('hidden');
    $('hr-content').classList.add('hidden');
    var e = $('hr-error'); e.classList.remove('hidden');
    if (msg) $('hr-error-msg').textContent = msg;
    var dEl = $('hr-error-diag');
    if (dEl) dEl.textContent = diag || '';
  }

  // Pull a flight-shaped object out of a variety of envelope shapes.
  function pickFlight(o) {
    if (!o || typeof o !== 'object') return {};
    if (o.flight && typeof o.flight === 'object') return o.flight;
    if (o.data && typeof o.data === 'object' && !Array.isArray(o.data)) return o.data;
    return o;
  }

  // Merge whatever flight metadata rode along on the /history payload with the
  // flight record fetched by id, normalising the many possible field names.
  function extractMeta(raw, det) {
    var f = {}, a = pickFlight(raw), b = pickFlight(det), k;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) f[k] = a[k];
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) f[k] = b[k];   // details win
    var acName = f.aircraftName || f.aircraftType ||
      (f.aircraft && typeof f.aircraft === 'object' ? f.aircraft.aircraftName : (typeof f.aircraft === 'string' ? f.aircraft : ''));
    return {
      callsign: f.callsign || f.flightNumber || '',
      registration: f.registration || f.reg || f.tailNumber || f.aircraftRegistration || '',
      aircraftName: acName || '',
      operator: f.operator || f.airline || f.airlineName || '',
      departureIcao: f.departureIcao || f.originAirport || f.origin || f.dep || '',
      arrivalIcao: f.arrivalIcao || f.destinationAirport || f.destination || f.arr || '',
      date: f.created || f.date || f.startTime || ''
    };
  }

  function boot() {
    var cfg = qp();
    if (!cfg.flight) { showError('No flight was specified. Open this page with ?flight=<id>.'); return; }
    var fid = encodeURIComponent(cfg.flight);

    var diag = { flight: cfg.flight, histStatus: '?', rawKeys: '', points: 0 };

    // Prefer a stored trail file when one was handed to us (?trail=<url>) — that
    // is the saved replay's point array. Otherwise fall back to the flight's
    // /history feed (used for live / in-progress flights).
    var histP;
    if (cfg.trail) {
      histP = fetch(cfg.trail, { headers: { Accept: 'application/json' } })
        .then(function (r) { diag.histStatus = 'trail ' + r.status; return r.ok ? r.json() : null; })
        .catch(function (err) { diag.histStatus = 'trail network-error (' + (err && err.message ? err.message : 'blocked') + ')'; return null; });
    } else {
      histP = fetch(HISTORY_BASE + '/' + fid + '/history', { headers: { Accept: 'application/json' } })
        .then(function (r) { diag.histStatus = r.status; return r.ok ? r.json() : null; })
        .catch(function (err) { diag.histStatus = 'network-error (' + (err && err.message ? err.message : 'blocked') + ')'; return null; });
    }

    // Reach out for the flight record itself by the same id, so registration,
    // aircraft, operator and route fill in even when the profile didn't pass
    // them (registration also unlocks the aircraft photo). Best-effort: the
    // page still works from the track + whatever URL params were supplied.
    var detP = fetch(HISTORY_BASE + '/' + fid, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });

    Promise.all([histP, detP]).then(function (res) {
      var raw = res[0];
      diag.rawKeys = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? Object.keys(raw).join(',') : (Array.isArray(raw) ? 'array[' + raw.length + ']' : String(raw));
      var pts = normalize(raw);
      diag.points = pts.length;
      if (pts.length < 2) {
        showError('This flight has no recorded track to replay.',
          'flight=' + diag.flight + ' · /history=' + diag.histStatus + ' · payload={' + diag.rawKeys + '} · points=' + diag.points);
        return;
      }
      start(pts, cfg, extractMeta(raw, res[1]));
    }).catch(function (err) {
      showError('Couldn’t load this flight’s history right now.',
        'flight=' + diag.flight + ' · /history=' + diag.histStatus + ' · ' + (err && err.message ? err.message : ''));
    });
  }

  function start(pts, cfg, meta) {
    S.pts = pts;
    S.t0 = pts[0].t; S.tEnd = pts[pts.length - 1].t; S.realMs = Math.max(1, S.tEnd - S.t0);
    S.tMin = S.t0; S.tMax = S.tEnd;
    S.baseReplayMs = Math.min(MAX_REPLAY_MS, Math.max(MIN_REPLAY_MS, S.realMs / COMPRESS));

    $('hr-loading').classList.add('hidden');
    $('hr-content').classList.remove('hidden');
    $('hr-total').textContent = fmtClock(S.baseReplayMs);

    var callsign = cfg.callsign || meta.callsign || meta.flightNumber || cfg.flight;
    var icao = (callsign.match(/^[A-Za-z]{3}/) || [''])[0];

    // header
    $('hr-title-main').textContent = callsign ? ('Flight ' + callsign) : 'Flight history';
    if (callsign) { var b = $('hr-title-badge'); b.textContent = callsign; b.classList.remove('hidden'); }
    setLogo($('hr-head-logo'), icao);
    setLogo($('hr-flight-logo'), icao);

    // stats header static bits
    $('hr-stat-callsign').textContent = callsign || '—';
    $('hr-stat-date').textContent = cfg.date || fmtDate(S.t0);

    S.fullPts = pts.slice();
    S.acType = cfg.type || meta.aircraftName || '';

    buildSpeedMenu();
    buildGraph();
    buildDetails(cfg, meta);
    loadPhoto(cfg, meta);
    loadCommunityImage(S.acType);
    detectLegs();
    wireControls();
    wireGraphScrub();

    initMap(cfg.style, function () {
      renderFrame(false);   // show the whole route first; follow kicks in on play
    });

    // keep graph crisp on resize
    window.addEventListener('resize', function () { buildGraph(); renderFrame(false); });
  }

  function setLogo(host, icao) {
    if (!host) return;
    var url = airlineLogoUrl(icao);
    if (!url) return;
    var img = new Image();
    img.alt = ''; img.referrerPolicy = 'no-referrer';
    img.onload = function () { host.innerHTML = ''; host.appendChild(img); };
    img.onerror = function () { /* keep the FA fallback icon */ };
    img.src = url;
  }

  // ---- map ------------------------------------------------------------------
  function initMap(style, onReady) {
    var gl = window.maplibregl;
    if (!gl) { onReady && onReady(); return; }   // page still works sans map
    S.gl = gl;
    var styleUrl = FREE_STYLES[style] || FREE_STYLES.dark;

    var lons = S.pts.map(function (p) { return p.lon; });
    var lats = S.pts.map(function (p) { return p.lat; });
    var bounds = [[Math.min.apply(null, lons), Math.min.apply(null, lats)], [Math.max.apply(null, lons), Math.max.apply(null, lats)]];

    var map = new gl.Map({
      container: 'hr-map', style: styleUrl, attributionControl: true,
      bounds: bounds, fitBoundsOptions: { padding: 44 }, dragRotate: false
    });
    S.map = map;
    map.addControl(new gl.NavigationControl({ showCompass: false }), 'top-right');

    // A genuine zoom/drag/rotate by the user drops follow so the map doesn't
    // fight them. Our own recentring uses setCenter (center only), which fires
    // neither zoomstart nor dragstart, so it never trips this.
    ['dragstart', 'zoomstart', 'rotatestart'].forEach(function (ev) {
      map.on(ev, function (e) { if (e && e.originalEvent) setFollow(false); });
    });

    map.on('load', function () {
      // Only the flown path — it grows behind the aircraft as the replay plays
      // (no pre-drawn route ahead).
      map.addSource('hr-traveled', { type: 'geojson', data: lineFeature([S.pts[0]]) });
      map.addLayer({
        id: 'hr-traveled', type: 'line', source: 'hr-traveled',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#7c3aed', 'line-width': 4 }
      });

      // Aircraft marker — the map's own silhouette for this type, so it matches
      // the live map. Outer element is positioned by maplibre; inner span rotates.
      var el = document.createElement('div');
      el.style.cssText = 'width:32px;height:32px;';
      el.innerHTML = '<span id="hr-plane" style="display:block;width:32px;height:32px;transform-origin:50% 50%;' +
        'filter:drop-shadow(0 1px 2px rgba(0,0,0,.55));">' + planeSvg(S.acType) + '</span>';
      S.marker = new gl.Marker({ element: el, anchor: 'center' }).setLngLat([S.pts[0].lon, S.pts[0].lat]).addTo(map);

      onReady && onReady();
    });
    map.on('error', function () { onReady && onReady(); });
  }

  // The map draws each aircraft from assets.js's per-type SVG path (64×64,
  // nose-up). Reuse it so the replay plane looks identical; fall back to a
  // generic glyph when the type is unknown or assets didn't load.
  function resolveAircraftPath(type) {
    var paths = window.__aircraftPaths;
    if (!paths) return null;
    if (type && paths[type]) return paths[type];
    var keys = Object.keys(paths);
    var t = String(type || '').toLowerCase();
    if (t) {
      for (var i = 0; i < keys.length; i++) { var k = keys[i].toLowerCase(); if (t.indexOf(k) >= 0 || k.indexOf(t) >= 0) return paths[keys[i]]; }
      var fam = t.replace(/[^a-z0-9]/g, '').slice(0, 6);
      for (var j = 0; j < keys.length; j++) { if (fam && keys[j].toLowerCase().replace(/[^a-z0-9]/g, '').indexOf(fam) >= 0) return paths[keys[j]]; }
    }
    return paths['Airbus A320'] || paths[keys[0]] || null;
  }
  function planeSvg(type) {
    var d = resolveAircraftPath(type);
    if (d) return '<svg viewBox="0 0 64 64" width="32" height="32"><path d="' + d + '" fill="#ffffff" stroke="#0b1220" stroke-width="1" stroke-linejoin="round"/></svg>';
    return '<svg viewBox="0 0 24 24" width="30" height="30" fill="#0b1220" stroke="#fff" stroke-width="0.6"><path d="M12 2l1.2 6.6 7.3 4.1v1.8l-7.3-2.1-.4 4.6 2.3 1.6v1.5L12 20l-3.1 .7v-1.5l2.3-1.6-.4-4.6-7.3 2.1v-1.8l7.3-4.1L12 2z"/></svg>';
  }

  function setFollow(on) {
    S.follow = !!on;
    var btn = $('hr-follow-btn');
    if (btn) btn.classList.toggle('active', S.follow);
  }

  function lineFeature(pts) {
    return { type: 'Feature', geometry: { type: 'LineString', coordinates: pts.map(function (p) { return [p.lon, p.lat]; }) } };
  }

  // ---- graph (reuse FlightGraph, overlay a playhead) ------------------------
  function buildGraph() {
    var host = $('hr-graph'); if (!host) return;
    if (!window.FlightGraph) { host.innerHTML = '<div class="hr-graph-empty">Graph unavailable.</div>'; return; }
    var series = window.FlightGraph.extractSeries(S.pts.map(function (p) {
      return { lastReportMs: p.t, altitude: p.alt, groundSpeed: p.gs, latitude: p.lat, longitude: p.lon };
    }));
    var W = 680, H = 200;
    S.W = W; S.H = H;
    // Cache the y-axis maxima FlightGraph derives, so the per-frame playhead
    // dots don't have to re-extract the whole series 60×/sec.
    var maxAlt = 0, maxGs = 0;
    for (var k = 0; k < series.samples.length; k++) {
      if (series.samples[k].alt != null && series.samples[k].alt > maxAlt) maxAlt = series.samples[k].alt;
      if (series.samples[k].gs != null && series.samples[k].gs > maxGs) maxGs = series.samples[k].gs;
    }
    S.altMax = Math.max(1000, maxAlt * 1.03);
    S.gsMax = Math.max(60, maxGs * 1.03);
    // Recolour FlightGraph's blue/orange to this page's purple/green (matching
    // the readout dots and the reference look) without touching the shared lib.
    var svgStr = window.FlightGraph.buildSVG(series, W, H)
      .replace(/#38bdf8/gi, '#7c3aed').replace(/#f59e0b/gi, '#10b981');
    host.innerHTML = svgStr;
    var svg = host.querySelector('svg');
    if (svg) {
      var ns = 'http://www.w3.org/2000/svg';
      var line = document.createElementNS(ns, 'line');
      line.setAttribute('id', 'hr-playhead');
      line.setAttribute('y1', '14'); line.setAttribute('y2', String(H - 26));
      line.setAttribute('stroke', 'currentColor'); line.setAttribute('stroke-width', '1.5'); line.setAttribute('opacity', '0.9');
      svg.style.color = getComputedStyle(document.documentElement).getPropertyValue('--hr-text') || '#0b1220';
      var dotA = document.createElementNS(ns, 'circle');
      dotA.setAttribute('id', 'hr-ph-alt'); dotA.setAttribute('r', '3.5'); dotA.setAttribute('fill', '#7c3aed');
      var dotG = document.createElementNS(ns, 'circle');
      dotG.setAttribute('id', 'hr-ph-gs'); dotG.setAttribute('r', '3.5'); dotG.setAttribute('fill', '#10b981');
      svg.appendChild(line); svg.appendChild(dotA); svg.appendChild(dotG);
    }
  }

  function graphX(t) {
    var x0 = 52, x1 = S.W - 46;
    if (S.tMax <= S.tMin) return x0;
    return x0 + ((t - S.tMin) / (S.tMax - S.tMin)) * (x1 - x0);
  }

  function updatePlayhead(tNow, cur) {
    var line = $('hr-playhead'); if (!line) return;
    var x = graphX(tNow);
    line.setAttribute('x1', x.toFixed(1)); line.setAttribute('x2', x.toFixed(1));
    var y0 = 14, y1 = S.H - 26;
    var altMax = S.altMax || 1000, gsMax = S.gsMax || 60;
    var da = $('hr-ph-alt'), dg = $('hr-ph-gs');
    if (da && cur.alt != null) { da.setAttribute('cx', x.toFixed(1)); da.setAttribute('cy', (y1 - (cur.alt / altMax) * (y1 - y0)).toFixed(1)); da.style.display = ''; }
    else if (da) da.style.display = 'none';
    if (dg && cur.gs != null) { dg.setAttribute('cx', x.toFixed(1)); dg.setAttribute('cy', (y1 - (cur.gs / gsMax) * (y1 - y0)).toFixed(1)); dg.style.display = ''; }
    else if (dg) dg.style.display = 'none';
  }

  // ---- playback -------------------------------------------------------------
  function setProgress(p, fromUser) {
    S.progress = Math.max(0, Math.min(1, p));
    if (fromUser) { /* scrubbing pauses implicitly handled by caller */ }
    renderFrame(false);
  }

  function renderFrame(recenter) {
    if (!S.pts.length) return;
    var tNow = S.t0 + S.progress * S.realMs;
    var cur = sampleAt(S.pts, tNow);

    // marker + rotation
    if (S.marker) {
      S.marker.setLngLat([cur.lon, cur.lat]);
      var next = S.pts[Math.min(cur.i + 1, S.pts.length - 1)];
      var prev = S.pts[cur.i];
      var brg = bearing(prev, next);
      var plane = $('hr-plane'); if (plane) plane.style.transform = 'rotate(' + brg + 'deg)';
    }
    // Flown path grows behind the plane (only the travelled portion is drawn).
    if (S.map && S.map.getSource) {
      var travSrc = S.map.getSource('hr-traveled');
      if (travSrc) {
        var head = S.pts.slice(0, cur.i + 1);
        head.push({ lon: cur.lon, lat: cur.lat });
        travSrc.setData(lineFeature(head));
      }
      // Recentre with setCenter (center only) so it never fights the user's
      // zoom. Forced when the follow button is pressed; otherwise only while
      // playing and following, and never mid user-interaction.
      if ((recenter || (S.follow && S.playing && !S.userInteracting)) && S.map.setCenter) {
        S.map.setCenter([cur.lon, cur.lat]);
      }
    }
    // readouts
    $('hr-stat-time').textContent = fmtUtcTime(tNow);
    $('hr-stat-alt').textContent = fmtAlt(cur.alt);
    $('hr-stat-gs').textContent = fmtGs(cur.gs);
    $('hr-tip-alt').textContent = fmtAlt(cur.alt);
    $('hr-tip-gs').textContent = fmtGs(cur.gs);
    $('hr-tip').classList.toggle('show', S.playing || S.scrubbing);
    // scrubber
    $('hr-elapsed').textContent = fmtClock(S.progress * S.baseReplayMs);
    var sl = $('hr-slider');
    if (sl && document.activeElement !== sl) sl.value = String(Math.round(S.progress * 1000));
    if (sl) sl.style.setProperty('--fill', (S.progress * 100).toFixed(1) + '%');
    // graph playhead
    updatePlayhead(tNow, cur);
  }

  function tick(now) {
    if (!S.playing) return;
    var dt = now - S.lastWall; S.lastWall = now;
    S.progress += (dt * S.speed) / S.baseReplayMs;
    if (S.progress >= 1) { S.progress = 1; renderFrame(false); pause(); return; }
    renderFrame(false);
    S.raf = requestAnimationFrame(tick);
  }

  function play() {
    if (S.progress >= 1) S.progress = 0;
    S.playing = true; S.lastWall = performance.now();
    var i = $('hr-play').querySelector('i'); i.className = 'fa-solid fa-pause';
    $('hr-play').setAttribute('aria-label', 'Pause');
    S.raf = requestAnimationFrame(tick);
  }
  function pause() {
    S.playing = false;
    if (S.raf) cancelAnimationFrame(S.raf);
    var i = $('hr-play').querySelector('i'); i.className = 'fa-solid fa-play';
    $('hr-play').setAttribute('aria-label', 'Play');
    renderFrame(false);
  }

  // ---- controls -------------------------------------------------------------
  function buildSpeedMenu() {
    var menu = $('hr-speed-menu');
    menu.innerHTML = SPEED_OPTIONS.map(function (s) {
      return '<button data-speed="' + s + '"' + (s === S.speed ? ' class="active"' : '') + '>' + s + '×</button>';
    }).join('');
    menu.querySelectorAll('button').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        S.speed = parseInt(btn.getAttribute('data-speed'), 10) || 1;
        $('hr-speed-tag').textContent = S.speed + '×';
        menu.querySelectorAll('button').forEach(function (b) { b.classList.toggle('active', b === btn); });
        menu.classList.remove('open');
      });
    });
  }

  function wireControls() {
    $('hr-play').addEventListener('click', function () { S.playing ? pause() : play(); });

    var sl = $('hr-slider');
    sl.addEventListener('input', function () {
      S.scrubbing = true;
      setProgress(parseInt(sl.value, 10) / 1000, true);
    });
    sl.addEventListener('change', function () { S.scrubbing = false; renderFrame(false); });
    sl.addEventListener('pointerdown', function () { if (S.playing) pause(); });

    var speedBtn = $('hr-speed-btn');
    speedBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      $('hr-speed-menu').classList.toggle('open');
    });
    document.addEventListener('click', function () { $('hr-speed-menu').classList.remove('open'); });

    var followBtn = $('hr-follow-btn');
    followBtn.addEventListener('click', function () {
      setFollow(!S.follow);
      if (S.follow) renderFrame(true);   // snap back to the aircraft
    });

    var pathBtn = $('hr-path-btn');
    pathBtn.addEventListener('click', function () {
      S.pathVisible = !S.pathVisible;
      pathBtn.classList.toggle('active', S.pathVisible);
      if (S.map && S.map.setLayoutProperty) {
        var v = S.pathVisible ? 'visible' : 'none';
        try { S.map.setLayoutProperty('hr-traveled', 'visibility', v); } catch (e) {}
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.code === 'Space') { e.preventDefault(); S.playing ? pause() : play(); }
      else if (e.code === 'ArrowRight') { setProgress(S.progress + 0.02, true); }
      else if (e.code === 'ArrowLeft') { setProgress(S.progress - 0.02, true); }
    });
  }

  // Drag/click on the graph scrubs the replay (Plane Finder behaviour).
  function wireGraphScrub() {
    var host = $('hr-graph');
    function toProgress(clientX) {
      var svg = host.querySelector('svg'); if (!svg) return null;
      var r = svg.getBoundingClientRect();
      var vx = (clientX - r.left) / r.width * S.W;         // into viewBox units
      var x0 = 52, x1 = S.W - 46;
      var f = (vx - x0) / (x1 - x0);
      return Math.max(0, Math.min(1, f));
    }
    var dragging = false;
    host.addEventListener('pointerdown', function (e) {
      var p = toProgress(e.clientX); if (p == null) return;
      dragging = true; if (S.playing) pause();
      setProgress(p, true);
      host.setPointerCapture && host.setPointerCapture(e.pointerId);
    });
    host.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var p = toProgress(e.clientX); if (p != null) setProgress(p, true);
    });
    host.addEventListener('pointerup', function () { dragging = false; });
    host.addEventListener('pointercancel', function () { dragging = false; });
  }

  // ---- details + photo ------------------------------------------------------
  function buildDetails(cfg, meta) {
    var rows = [];
    var type = cfg.type || meta.aircraftName || meta.aircraftType || meta.aircraft || '';
    var op = cfg.operator || meta.operator || meta.airline || '';
    var reg = cfg.reg || meta.registration || meta.reg || '';
    var dep = cfg.dep || meta.departureIcao || meta.dep || '';
    var arr = cfg.arr || meta.arrivalIcao || meta.arr || '';
    if (type) rows.push({ ico: 'fa-plane', primary: type, secondary: 'Aircraft Type' });
    if (op) rows.push({ ico: 'fa-building', primary: op, secondary: 'Operator' });
    if (reg) rows.push({ ico: 'fa-hashtag', primary: reg, secondary: 'Registration' });
    if (dep || arr) rows.push({ ico: 'fa-route', primary: (dep || '—') + ' to ' + (arr || '—'), secondary: 'Route' });
    var host = $('hr-details');
    if (!rows.length) { host.style.display = 'none'; return; }
    host.innerHTML = rows.map(function (r) {
      return '<div class="hr-detail"><div class="ico"><i class="fa-solid ' + r.ico + '"></i></div>' +
        '<div class="body"><div class="primary">' + esc(r.primary) + '</div><div class="secondary">' + esc(r.secondary) + '</div></div></div>';
    }).join('');
  }

  function loadPhoto(cfg, meta) {
    var reg = cfg.reg || meta.registration || meta.reg || '';
    if (!reg || !window.InflightAircraftPhoto) return;
    var slot = $('hr-photo');
    window.InflightAircraftPhoto.get(reg).then(function (res) {
      if (!res) return;
      if (window.InflightAircraftPhoto.render) { window.InflightAircraftPhoto.render(slot, res); slot.style.display = 'block'; return; }
      var url = res.url || (res.photos && res.photos[0] && res.photos[0].url);
      if (!url) return;
      var img = new Image(); img.referrerPolicy = 'no-referrer';
      img.onload = function () {
        slot.innerHTML = ''; slot.appendChild(img);
        if (res.credit || res.photographer) { var c = document.createElement('div'); c.className = 'credit'; c.textContent = '© ' + (res.credit || res.photographer); slot.appendChild(c); }
        slot.style.display = 'block';
      };
      img.src = url;
    }).catch(function () {});
  }

  // Community aircraft image (our own submitted photos), looked up by type.
  // Best-effort: if it resolves it becomes the hero image; otherwise the
  // registration-based photo above (or nothing) stands.
  function loadCommunityImage(type) {
    if (!type) return;
    var slot = $('hr-photo');
    var lookup = INDGO_BACKEND + '/api/aircraft/lookup?type=' + encodeURIComponent(type);
    fetch(lookup, { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) return;
        var d = j.data || j;
        var url = d.imageUrl || d.image || d.url || d.communityImageUrl || (d.images && d.images[0] && (d.images[0].url || d.images[0]));
        if (!url || typeof url !== 'string') return;
        var img = new Image(); img.referrerPolicy = 'no-referrer';
        img.onload = function () {
          slot.innerHTML = ''; slot.appendChild(img);
          var who = d.contributorName || d.credit || d.photographer;
          if (who) { var c = document.createElement('div'); c.className = 'credit'; c.textContent = '© ' + who; slot.appendChild(c); }
          slot.style.display = 'block';
        };
        img.src = url;
      }).catch(function () {});
  }

  // ---- legs (landed / parked → separate flights in one trail) --------------
  function detectLegs() {
    S.legs = []; S.activeLeg = null;
    var host = $('hr-legs');
    if (!window.FlightLegs || typeof window.FlightLegs.detect !== 'function') { if (host) host.classList.add('hidden'); return; }
    var legs;
    try {
      legs = window.FlightLegs.detect(S.fullPts.map(function (p) {
        return { lat: p.lat, lon: p.lon, time: p.t, alt: p.alt, gs: p.gs };
      }), {});
    } catch (e) { legs = []; }
    if (!legs || legs.length < 2) { if (host) { host.classList.add('hidden'); host.innerHTML = ''; } return; }
    S.legs = legs;
    renderLegs();
  }

  function renderLegs() {
    var host = $('hr-legs'); if (!host) return;
    host.classList.remove('hidden');
    var chips = [];
    chips.push('<button type="button" class="hr-leg' + (S.activeLeg == null ? ' active' : '') + '" data-leg="all">' +
      '<span class="hr-leg-title">Full journey</span><span class="hr-leg-sub">' + S.legs.length + ' legs · parked between</span></button>');
    S.legs.forEach(function (lg, i) {
      var badge = lg.inProgress ? '<span class="hr-leg-badge airborne">In air</span>' : '<span class="hr-leg-badge parked">Landed</span>';
      chips.push('<button type="button" class="hr-leg' + (S.activeLeg === i ? ' active' : '') + '" data-leg="' + i + '">' +
        '<span class="hr-leg-title">Leg ' + (i + 1) + badge + '</span>' +
        '<span class="hr-leg-sub">' + fmtUtcTime(lg.depTime) + ' → ' + fmtUtcTime(lg.arrTime) + ' · ' + lg.durationMin + 'm' +
        (lg.distanceNm ? ' · ' + lg.distanceNm + ' nm' : '') + '</span></button>');
    });
    host.innerHTML = chips.join('');
    host.querySelectorAll('[data-leg]').forEach(function (el) {
      el.addEventListener('click', function () { selectLeg(el.getAttribute('data-leg')); });
    });
  }

  function selectLeg(which) {
    if (which === 'all') { S.activeLeg = null; S.pts = S.fullPts.slice(); }
    else {
      var i = parseInt(which, 10); var lg = S.legs[i]; if (!lg) return;
      S.activeLeg = i;
      S.pts = S.fullPts.filter(function (p) { return p.t >= lg.depTime && p.t <= lg.arrTime; });
      if (S.pts.length < 2) { S.pts = S.fullPts.slice(); S.activeLeg = null; }
    }
    // Rebuild the timeline for the selected span.
    S.t0 = S.pts[0].t; S.tEnd = S.pts[S.pts.length - 1].t; S.realMs = Math.max(1, S.tEnd - S.t0);
    S.tMin = S.t0; S.tMax = S.tEnd;
    S.baseReplayMs = Math.min(MAX_REPLAY_MS, Math.max(MIN_REPLAY_MS, S.realMs / COMPRESS));
    S.progress = 0; pause();
    $('hr-total').textContent = fmtClock(S.baseReplayMs);
    $('hr-stat-date').textContent = fmtDate(S.t0);
    buildGraph();
    if (S.map && S.map.getSource) {
      var lons = S.pts.map(function (p) { return p.lon; }), lats = S.pts.map(function (p) { return p.lat; });
      try { S.map.fitBounds([[Math.min.apply(null, lons), Math.min.apply(null, lats)], [Math.max.apply(null, lons), Math.max.apply(null, lats)]], { padding: 44, duration: 400 }); } catch (e) {}
      var t = S.map.getSource('hr-traveled'); if (t) t.setData(lineFeature([S.pts[0]]));
    }
    setFollow(true);
    renderLegs();
    renderFrame(false);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
