// windLayer.js
//
// Animated wind-particle overlay for a Mapbox GL map — the "Windy" look, built
// entirely on FREE, key-less data:
//
//   • Wind field  -> Open-Meteo Forecast API (https://open-meteo.com)
//                    no API key, generous free use, GFS/ICON under the hood.
//
// The field is sampled on a coarse grid across the *current viewport only*
// (one bulk request), bilinearly interpolated, and used to advect a capped
// number of particles that are drawn as fading comet trails on a 2D canvas
// glued on top of the WebGL map. Because we only ever sample/animate the
// visible area and cap the particle count, it stays smooth even on the globe
// projection and on mobile.
//
// Exposes: window.WindParticleLayer
(function () {
    'use strict';

    if (window.WindParticleLayer) return; // idempotent

    const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

    // Speed (m/s) -> colour ramp. Calm = soft cyan, gale = warm white/red.
    const COLOR_STOPS = [
        [0,   'rgba(160,230,255,0.85)'],
        [6,   'rgba(120,255,200,0.85)'],
        [12,  'rgba(180,255,120,0.90)'],
        [18,  'rgba(255,230,110,0.92)'],
        [26,  'rgba(255,150,80,0.95)'],
        [36,  'rgba(255,90,90,0.98)']
    ];

    function colorForSpeed(spd) {
        let stop = COLOR_STOPS[0];
        for (let i = 0; i < COLOR_STOPS.length; i++) {
            if (spd >= COLOR_STOPS[i][0]) stop = COLOR_STOPS[i];
        }
        return stop[1];
    }

    // Meteorological wind (speed + direction-FROM) -> velocity vector blowing TO.
    // u = eastward component, v = northward component (both m/s).
    function toUV(speed, dirFromDeg) {
        const r = (dirFromDeg * Math.PI) / 180;
        return { u: -speed * Math.sin(r), v: -speed * Math.cos(r) };
    }

    class WindParticleLayer {
        constructor(map, options = {}) {
            this.map = map;
            this.o = Object.assign({
                gridCols: 14,
                gridRows: 9,
                maxParticles: 2600,
                pxPerMs: 0.65,        // screen px travelled per (m/s) per frame
                fadeOpacity: 0.93,    // trail persistence (closer to 1 = longer tails)
                particleLife: 90,     // frames before a particle is recycled
                lineWidth: 1.35,
                refetchDebounceMs: 600,
                maxDpr: 1.5
            }, options);

            this.running = false;
            this.field = null;        // { lons, lats, u[][], v[][], spd[][] }
            this.particles = [];
            this._raf = null;
            this._fetchTimer = null;
            this._fetchAbort = null;
            this._destroyed = false;
            this._moving = false;     // true while the camera is panning/zooming/rotating

            // While the camera moves we freeze advection and clear each frame so
            // the screen-space trail buffer can't smear against the ground.
            this._onMoveStart = () => { this._moving = true; };
            this._onMoveEnd = () => { this._moving = false; this._scheduleFetch(); };
            this._onResize = this._resize.bind(this);
        }

        // ---- lifecycle ----------------------------------------------------
        start() {
            if (this.running || this._destroyed) return;
            this.running = true;
            this._buildCanvas();
            this._resize();
            this._spawnParticles();
            this.map.on('movestart', this._onMoveStart);
            this.map.on('moveend', this._onMoveEnd);
            this.map.on('resize', this._onResize);
            window.addEventListener('resize', this._onResize);
            this._fetchField();                 // immediate first fetch
            this.canvas.style.display = 'block';
            this._loop();
        }

        stop() {
            this.running = false;
            if (this._raf) cancelAnimationFrame(this._raf);
            this._raf = null;
            if (this._fetchTimer) clearTimeout(this._fetchTimer);
            if (this._fetchAbort) this._fetchAbort.abort();
            this.map.off('movestart', this._onMoveStart);
            this.map.off('moveend', this._onMoveEnd);
            this.map.off('resize', this._onResize);
            window.removeEventListener('resize', this._onResize);
            if (this.canvas) {
                this.ctx && this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                this.canvas.style.display = 'none';
            }
        }

        destroy() {
            this.stop();
            this._destroyed = true;
            if (this.canvas && this.canvas.parentNode) {
                this.canvas.parentNode.removeChild(this.canvas);
            }
            this.canvas = null;
        }

        // ---- canvas -------------------------------------------------------
        _buildCanvas() {
            if (this.canvas) return;
            const c = document.createElement('canvas');
            c.className = 'wind-particle-canvas';
            c.style.position = 'absolute';
            c.style.top = '0';
            c.style.left = '0';
            c.style.width = '100%';
            c.style.height = '100%';
            c.style.pointerEvents = 'none';
            c.style.zIndex = '2';
            // Sits inside the map's canvas container -> above GL tiles/radar,
            // below the HTML aircraft markers (which live in a sibling container).
            this.map.getCanvasContainer().appendChild(c);
            this.canvas = c;
            this.ctx = c.getContext('2d');
        }

        _resize() {
            if (!this.canvas) return;
            const dpr = Math.min(window.devicePixelRatio || 1, this.o.maxDpr);
            const mapCanvas = this.map.getCanvas();
            const w = mapCanvas.clientWidth;
            const h = mapCanvas.clientHeight;
            this.canvas.width = Math.round(w * dpr);
            this.canvas.height = Math.round(h * dpr);
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            this._cssW = w;
            this._cssH = h;
        }

        // ---- wind field (Open-Meteo) -------------------------------------
        _scheduleFetch() {
            if (this._fetchTimer) clearTimeout(this._fetchTimer);
            this._fetchTimer = setTimeout(() => this._fetchField(), this.o.refetchDebounceMs);
        }

        _viewportGrid() {
            let b;
            try { b = this.map.getBounds(); } catch (e) { b = null; }
            let west, east, south, north;
            if (b && isFinite(b.getWest())) {
                west = b.getWest(); east = b.getEast();
                south = b.getSouth(); north = b.getNorth();
            } else {
                west = -180; east = 180; south = -85; north = 85;
            }
            // Guard against the globe returning a degenerate/huge span.
            if (east <= west) east = west + 1;
            south = Math.max(south, -85);
            north = Math.min(north, 85);
            if (north <= south) north = south + 1;
            // Pad slightly so particles entering from edges have data.
            const padX = (east - west) * 0.08;
            const padY = (north - south) * 0.08;
            west -= padX; east += padX;
            south = Math.max(south - padY, -85);
            north = Math.min(north + padY, 85);

            const cols = this.o.gridCols, rows = this.o.gridRows;
            const lons = [], lats = [];
            for (let i = 0; i < cols; i++) lons.push(west + ((east - west) * i) / (cols - 1));
            for (let j = 0; j < rows; j++) lats.push(south + ((north - south) * j) / (rows - 1));
            return { lons, lats };
        }

        async _fetchField() {
            if (!this.running || this._destroyed) return;
            const { lons, lats } = this._viewportGrid();

            // Bulk request: every (lat,lon) pair, one call. Open-Meteo wraps lon
            // for us, but normalise into [-180,180] to be safe.
            const latArr = [], lonArr = [];
            for (let j = 0; j < lats.length; j++) {
                for (let i = 0; i < lons.length; i++) {
                    latArr.push(lats[j].toFixed(3));
                    let lon = ((lons[i] + 180) % 360 + 360) % 360 - 180;
                    lonArr.push(lon.toFixed(3));
                }
            }
            const url = `${OPEN_METEO_URL}?latitude=${latArr.join(',')}` +
                        `&longitude=${lonArr.join(',')}` +
                        `&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`;

            if (this._fetchAbort) this._fetchAbort.abort();
            this._fetchAbort = new AbortController();
            try {
                const res = await fetch(url, { signal: this._fetchAbort.signal });
                if (!res.ok) throw new Error('Open-Meteo ' + res.status);
                const data = await res.json();
                const list = Array.isArray(data) ? data : [data];

                const cols = lons.length, rows = lats.length;
                const u = [], v = [], spd = [];
                for (let j = 0; j < rows; j++) { u.push([]); v.push([]); spd.push([]); }

                for (let k = 0; k < list.length; k++) {
                    const cur = list[k] && list[k].current;
                    const j = Math.floor(k / cols);
                    const i = k % cols;
                    if (!cur || j >= rows) continue;
                    const s = cur.wind_speed_10m || 0;
                    const d = cur.wind_direction_10m || 0;
                    const vec = toUV(s, d);
                    u[j][i] = vec.u; v[j][i] = vec.v; spd[j][i] = s;
                }
                this.field = { lons, lats, u, v, spd };
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.warn('[windLayer] field fetch failed:', err.message);
                }
            } finally {
                this._fetchAbort = null;
            }
        }

        // Bilinear interpolation of the wind field at a geographic point.
        _sample(lon, lat) {
            const f = this.field;
            if (!f) return null;
            const { lons, lats } = f;
            if (lon < lons[0] || lon > lons[lons.length - 1] ||
                lat < lats[0] || lat > lats[lats.length - 1]) return null;

            let i = 0; while (i < lons.length - 2 && lons[i + 1] < lon) i++;
            let j = 0; while (j < lats.length - 2 && lats[j + 1] < lat) j++;
            const tx = (lon - lons[i]) / (lons[i + 1] - lons[i] || 1);
            const ty = (lat - lats[j]) / (lats[j + 1] - lats[j] || 1);

            const at = (arr, jj, ii) => (arr[jj] && arr[jj][ii] != null) ? arr[jj][ii] : 0;
            const lerp = (a, b, t) => a + (b - a) * t;
            const bil = (arr) => lerp(
                lerp(at(arr, j, i), at(arr, j, i + 1), tx),
                lerp(at(arr, j + 1, i), at(arr, j + 1, i + 1), tx), ty);

            return { u: bil(f.u), v: bil(f.v), spd: bil(f.spd) };
        }

        // ---- particles ----------------------------------------------------
        _spawnParticles() {
            const count = this._targetCount();
            this.particles = new Array(count);
            for (let k = 0; k < count; k++) this.particles[k] = this._newParticle(true);
        }

        _targetCount() {
            const area = (this._cssW || 800) * (this._cssH || 600);
            // ~1 particle per 320 px², capped — keeps mobile smooth.
            return Math.min(this.o.maxParticles, Math.round(area / 320));
        }

        _newParticle(randomAge) {
            const { lons, lats } = this._viewportGrid();
            return {
                lon: lons[0] + Math.random() * (lons[lons.length - 1] - lons[0]),
                lat: lats[0] + Math.random() * (lats[lats.length - 1] - lats[0]),
                age: randomAge ? Math.floor(Math.random() * this.o.particleLife) : 0
            };
        }

        // ---- render loop --------------------------------------------------
        _loop() {
            if (!this.running) return;
            this._raf = requestAnimationFrame(() => this._loop());
            const ctx = this.ctx;
            if (!ctx) return;

            const w = this._cssW, h = this._cssH;
            const moving = this._moving;

            if (moving) {
                // Camera is moving. Trails are painted in screen space and would
                // smear against the ground, so wipe the canvas each frame — the
                // wind keeps flowing, it just loses its comet tails until idle.
                ctx.clearRect(0, 0, w, h);
            } else {
                // Idle: fade previous trails toward transparent for the comet look
                // while keeping the canvas see-through over the map.
                ctx.save();
                ctx.globalCompositeOperation = 'destination-in';
                ctx.fillStyle = `rgba(0,0,0,${this.o.fadeOpacity})`;
                ctx.fillRect(0, 0, w, h);
                ctx.restore();
            }

            if (!this.field) return; // nothing to draw yet

            ctx.lineWidth = this.o.lineWidth;
            ctx.lineCap = 'round';

            const k = this.o.pxPerMs;
            const margin = 40;

            // Adjust the count if the viewport was resized.
            const target = this._targetCount();
            while (this.particles.length < target) this.particles.push(this._newParticle(true));
            if (this.particles.length > target) this.particles.length = target;

            for (let idx = 0; idx < this.particles.length; idx++) {
                const p = this.particles[idx];
                const wind = this._sample(p.lon, p.lat);
                if (!wind || p.age++ > this.o.particleLife) {
                    this.particles[idx] = this._newParticle(false);
                    continue;
                }

                const p0 = this.map.project([p.lon, p.lat]);
                if (p0.x < -margin || p0.x > w + margin ||
                    p0.y < -margin || p0.y > h + margin) {
                    this.particles[idx] = this._newParticle(false);
                    continue;
                }

                // Pixel-space velocity -> consistent on-screen speed at any zoom.
                const x1 = p0.x + wind.u * k;
                const y1 = p0.y - wind.v * k; // screen y is down; +v is north (up)

                // Advance the ground position by reprojecting the new screen point
                // so particles stay glued to the map while panning/zooming.
                const next = this.map.unproject([x1, y1]);
                p.lon = next.lng;
                p.lat = next.lat;

                ctx.strokeStyle = colorForSpeed(wind.spd);
                ctx.beginPath();
                ctx.moveTo(p0.x, p0.y);
                ctx.lineTo(x1, y1);
                ctx.stroke();
            }
        }
    }

    window.WindParticleLayer = WindParticleLayer;
})();
