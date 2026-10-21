/**
 * natTracksLayer.js (Mapbox GL JS Version)
 * Updated: Added support for toggling labels, full track visibility, 
 * and persistent rendering across map style changes.
 *
 * Drawn as the iOS app draws the tracks (NatTrackStyle): a line per track,
 * flown as a great circle, in a colour of its own; at each end a small badge
 * carrying the letter and pointing the way the track is flown, in the same
 * colour; and the track's levels under the badge it is entered at. The
 * badges stay at the two ends and are always drawn, however close together
 * the tracks run — only the levels give way when crowded.
 */

const ACARS_SOCKET_URL = 'https://site--acars-backend--6dmjph8ltlhv.code.run';

// The colours the tracks are drawn in, handed out by letter (iOS
// NatTrackStyle.palette). The first six are the ones A to F always had;
// eight in all, so the tracks either side of any one are never its colour.
const NAT_PALETTE = [
    '#ff4d4d', '#ffcc00', '#2ecc71', '#a29bfe',
    '#e67e22', '#00cec9', '#f573cc', '#9edb33'
];

function natColourIndex(name) {
    const c = String(name || '').toUpperCase().charCodeAt(0);
    return c >= 65 && c <= 90 ? (c - 65) % NAT_PALETTE.length : 0;
}

const natBadgeImage = (index, pointsRight) => `nat-badge-${index}-${pointsRight ? 'right' : 'left'}`;

/**
 * A tag with one pointed end (iOS NatTrackStyle.badge): a rounded block the
 * letter sits in and an arrowhead the way the track is flown, with as much
 * empty room behind it as the point takes in front, so the letter, centred
 * on the image, sits in the middle of the block. A dark edge keeps a pale
 * badge's shape over pale imagery.
 */
function drawNatBadge(colour, pointsRight) {
    const R = 2;
    const block = 13, height = 12, point = 4.5, radius = 2.5, inset = 0.5;
    const width = block + point * 2;
    const canvas = document.createElement('canvas');
    canvas.width = width * R;
    canvas.height = height * R;
    const g = canvas.getContext('2d');
    g.scale(R, R);
    if (!pointsRight) { g.translate(width, 0); g.scale(-1, 1); }
    const left = point, right = point + block, top = inset, bottom = height - inset;
    g.beginPath();
    g.moveTo(left + radius, top);
    g.lineTo(right, top);
    g.lineTo(right + point - inset, height / 2);
    g.lineTo(right, bottom);
    g.lineTo(left + radius, bottom);
    g.arcTo(left, bottom, left, bottom - radius, radius);
    g.lineTo(left, top + radius);
    g.arcTo(left, top, left + radius, top, radius);
    g.closePath();
    g.fillStyle = colour;
    g.fill();
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.stroke();
    return { data: g.getImageData(0, 0, canvas.width, canvas.height), pixelRatio: R };
}

const toRad = (d) => d * Math.PI / 180;
const toDeg = (r) => r * 180 / Math.PI;

// The initial great-circle bearing from one [lon, lat] to another, degrees.
function bearing(a, b) {
    const f1 = toRad(a[1]), f2 = toRad(b[1]), dl = toRad(b[0] - a[0]);
    const y = Math.sin(dl) * Math.cos(f2);
    const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Which badge to use for a track flown on `heading`, and how far to turn it,
// so the point leads and the letter is never upside down: the right-pointing
// one unturned points east, the left-pointing one west, and whichever is
// nearer is turned the rest of the way — never more than a quarter.
function badgePlacement(heading) {
    const h = ((heading % 360) + 360) % 360;
    const pointsRight = h < 180;
    return { pointsRight, rotate: h - (pointsRight ? 90 : 270) };
}

// The fixes joined by great circles: a track is flown as one, and the straight
// line between two North Atlantic fixes runs visibly south of the traffic.
function greatCirclePath(coords) {
    const out = [coords[0]];
    for (let i = 1; i < coords.length; i++) {
        const [lo1, la1] = coords[i - 1].map(toRad), [lo2, la2] = coords[i].map(toRad);
        const d = 2 * Math.asin(Math.sqrt(Math.sin((la2 - la1) / 2) ** 2
            + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2));
        const steps = Math.max(1, Math.ceil(toDeg(d) / 0.5));
        for (let k = 1; k <= steps; k++) {
            if (k === steps || d === 0) { out.push(coords[i]); break; }
            const f = k / steps;
            const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
            const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
            const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
            const z = A * Math.sin(la1) + B * Math.sin(la2);
            out.push([toDeg(Math.atan2(y, x)), toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)))]);
        }
    }
    return out;
}

export class NatTracksLayer {
    constructor(map) {
        this.map = map;
        this.sourceId = 'nat-tracks-source';
        this.lineLayerId = 'nat-tracks-layer';
        this.badgeLayerId = 'nat-tracks-badges';
        this.levelsLayerId = 'nat-tracks-levels';
        this.airplaneLayerId = 'sector-ops-live-flights-layer'; 
        this.tracks = [];
        this.refreshInterval = null;
        this.hoveredTrackId = null;

        // Internal State for settings
        this.showTracks = true;
        this.showLabels = true;
        
        // Listen for style changes to re-inject layers and sources
        this.map.on('style.load', () => {
            this.initSource();
        });

        // Initial setup
        this.initSource();
        this.setupInteractions();
        this.fetchTracks();
    }

    /**
     * Re-initializes the GeoJSON source and all associated layers.
     * This is called on construction and every time the map style changes.
     */
    initSource() {
        // A style change drops the badges' images with everything else.
        this.ensureBadgeImages();
        // Prevent duplicate source errors if called multiple times within one style life-cycle
        if (this.map.getSource(this.sourceId)) return;

        this.map.addSource(this.sourceId, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
            generateId: true,
            tolerance: 0 // NAT track lines stay smooth when zoomed out
        });

        const beforeId = this.map.getLayer(this.airplaneLayerId) ? this.airplaneLayerId : undefined;
        const labelsShown = (this.showTracks && this.showLabels) ? 'visible' : 'none';
        // Free-engine glyph servers don't host the Mapbox stacks;
        // flight.js swaps in Noto Sans via window.mapTextFont there.
        const font = (typeof window !== 'undefined' && window.mapTextFont)
            ? window.mapTextFont(['Open Sans Bold', 'Arial Unicode MS Bold'])
            : ['Open Sans Bold', 'Arial Unicode MS Bold'];

        // 1. Line Layer (The track paths): each in its own colour, a little
        // see-through so the traffic flying it reads on top.
        this.map.addLayer({
            id: this.lineLayerId,
            type: 'line',
            source: this.sourceId,
            filter: ['==', ['geometry-type'], 'LineString'],
            layout: { 
                'line-join': 'round', 
                'line-cap': 'round',
                'visibility': this.showTracks ? 'visible' : 'none' 
            },
            paint: {
                'line-color': ['get', 'color'],
                'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 4.5, 3],
                'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0.85]
            }
        }, beforeId);

        // 2. The levels, under the badge the track is entered at. Text, so
        // it gives way where the tracks crowd — the badges never do.
        this.map.addLayer({
            id: this.levelsLayerId,
            type: 'symbol',
            source: this.sourceId,
            filter: ['all', ['==', ['geometry-type'], 'Point'], ['has', 'levels']],
            layout: {
                'text-field': ['get', 'levels'],
                'text-font': font,
                'text-size': 8.5,
                'text-offset': [0, 1.7],
                'text-padding': 1,
                'text-ignore-placement': true,
                'visibility': labelsShown
            },
            paint: {
                'text-color': ['get', 'color'],
                'text-halo-color': 'rgba(0,0,0,0.9)',
                'text-halo-width': 1.2,
                'text-halo-blur': 0.4
            }
        }, beforeId);

        // 3. The badges at each end: the letter on a tag pointing the way
        // the track is flown. Always drawn, however close they crowd.
        this.map.addLayer({
            id: this.badgeLayerId,
            type: 'symbol',
            source: this.sourceId,
            filter: ['==', ['geometry-type'], 'Point'],
            layout: {
                'icon-image': ['get', 'badge'],
                'icon-rotate': ['get', 'rotate'],
                'icon-rotation-alignment': 'map',
                'icon-pitch-alignment': 'viewport',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'text-field': ['get', 'name'],
                'text-font': font,
                'text-size': 9,
                'text-rotate': ['get', 'rotate'],
                'text-rotation-alignment': 'map',
                'text-pitch-alignment': 'viewport',
                'text-allow-overlap': true,
                'text-ignore-placement': true,
                'visibility': labelsShown
            },
            paint: {
                'text-color': '#ffffff',
                'text-halo-color': 'rgba(0,0,0,0.45)',
                'text-halo-width': 0.8
            }
        }, beforeId);

        // If we already have tracks in memory (e.g., after a style change), render them immediately
        if (this.tracks.length > 0) {
            this.render();
        }
    }

    /**
     * The badges' images, one per colour each way round, drawn once per
     * style (a style change drops added images).
     */
    ensureBadgeImages() {
        if (typeof document === 'undefined' || !this.map.addImage) return;
        NAT_PALETTE.forEach((colour, index) => {
            for (const right of [true, false]) {
                const id = natBadgeImage(index, right);
                if (this.map.hasImage && this.map.hasImage(id)) continue;
                try {
                    const img = drawNatBadge(colour, right);
                    this.map.addImage(id, img.data, { pixelRatio: img.pixelRatio });
                } catch (_) { /* the letter still shows without its badge */ }
            }
        });
    }

    /**
     * Updates visibility and settings from external UI components.
     * @param {Object} options - { showTracks: boolean, showLabels: boolean }
     */
    setOptions(options) {
        if (options.showTracks !== undefined) this.showTracks = options.showTracks;
        if (options.showLabels !== undefined) this.showLabels = options.showLabels;
        this.updateVisibility();
    }

    /**
     * Applies visibility state to the Mapbox layers based on internal class state.
     */
    updateVisibility() {
        const trackVisibility = this.showTracks ? 'visible' : 'none';
        const labelVisibility = (this.showTracks && this.showLabels) ? 'visible' : 'none';

        if (this.map.getLayer(this.lineLayerId)) {
            this.map.setLayoutProperty(this.lineLayerId, 'visibility', trackVisibility);
        }
        for (const id of [this.badgeLayerId, this.levelsLayerId]) {
            if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', labelVisibility);
        }
    }

    /**
     * Fetches current NAT tracks from the ACARS API.
     */
    async fetchTracks() {
        try {
            const response = await fetch(`${ACARS_SOCKET_URL}/api/live/tracks`);
            const data = await response.json();
            if (data.ok) {
                this.tracks = data.tracks;
                this.render();
            }
        } catch (error) {
            console.error('Error fetching NAT tracks:', error);
        }
    }

    /**
     * Converts track data into GeoJSON Features and updates the map source.
     */
    render() {
        this.ensureBadgeImages();
        const features = [];
        this.tracks.forEach(track => {
            let coordinates = this.parsePath(track.path);
            if (coordinates.length < 2) return;

            // In the order the track is flown (iOS coordinatesInFlightOrder):
            // a track with eastbound levels runs east, one with only
            // westbound levels runs west; one with neither is left as
            // published. The badges point along it.
            const east = (track.eastLevels || []).length > 0;
            const west = !east && (track.westLevels || []).length > 0;
            const first = coordinates[0], last = coordinates[coordinates.length - 1];
            if ((east && first[0] > last[0]) || (west && first[0] < last[0])) coordinates = coordinates.slice().reverse();

            const index = natColourIndex(track.name);
            const color = NAT_PALETTE[index];
            const commonProps = {
                name: track.name,
                type: track.type,
                color,
                eastLevels: track.eastLevels?.join(', ') || 'None',
                westLevels: track.westLevels?.join(', ') || 'None',
                pathString: track.path.join(' → ')
            };

            // Add the track line
            features.push({
                type: 'Feature',
                properties: commonProps,
                geometry: { type: 'LineString', coordinates: greatCirclePath(coordinates) }
            });

            // A badge at each end, pointing along the track there; the
            // levels once, at the entry, where they are read.
            const n = coordinates.length;
            const levels = (east ? track.eastLevels : (track.westLevels || [])) || [];
            const ends = [
                { at: coordinates[0], heading: bearing(coordinates[0], coordinates[1]), entry: true },
                { at: coordinates[n - 1], heading: bearing(coordinates[n - 2], coordinates[n - 1]), entry: false }
            ];
            for (const end of ends) {
                const place = badgePlacement(end.heading);
                const props = { ...commonProps, badge: natBadgeImage(index, place.pointsRight), rotate: place.rotate };
                if (end.entry && levels.length) props.levels = `FL ${levels.join(' ')}`;
                features.push({
                    type: 'Feature',
                    properties: props,
                    geometry: { type: 'Point', coordinates: end.at }
                });
            }
        });

        const source = this.map.getSource(this.sourceId);
        if (source) {
            source.setData({ type: 'FeatureCollection', features });
        }
    }

    /**
     * Parses various coordinate formats into [lon, lat] arrays.
     */
    parsePath(path) {
        return path.map(point => {
            if (point.includes('/')) {
                const [lat, lon] = point.split('/').map(parseFloat);
                return [-lon, lat];
            }
            const match = point.match(/(\d+)([NS])(\d+)([EW])/);
            if (match) {
                let lat = parseFloat(match[1]), lon = parseFloat(match[3]);
                if (match[2] === 'S') lat = -lat;
                if (match[4] === 'W') lon = -lon;
                return [lon, lat];
            }
            return null; 
        }).filter(c => c !== null);
    }

    /**
     * Configures mouse events for highlighting tracks and showing popups.
     */
    setupInteractions() {
        const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 15 });

        this.map.on('mousemove', this.lineLayerId, (e) => {
            if (e.features.length > 0) {
                if (this.hoveredTrackId !== null) {
                    this.map.setFeatureState({ source: this.sourceId, id: this.hoveredTrackId }, { hover: false });
                }
                this.hoveredTrackId = e.features[0].id;
                this.map.setFeatureState({ source: this.sourceId, id: this.hoveredTrackId }, { hover: true });
                this.map.getCanvas().style.cursor = 'pointer';
            }
        });

        this.map.on('mouseleave', this.lineLayerId, () => {
            if (this.hoveredTrackId !== null) {
                this.map.setFeatureState({ source: this.sourceId, id: this.hoveredTrackId }, { hover: false });
            }
            this.hoveredTrackId = null;
            this.map.getCanvas().style.cursor = '';
            popup.remove();
        });

        this.map.on('click', this.lineLayerId, (e) => {
            const props = e.features[0].properties;
            const html = `
                <div style="font-family: 'Inter', sans-serif; padding: 4px;">
                    <b style="font-size: 14px;">Track ${props.name}</b><br/>
                    <small>Levels: ${props.eastLevels} / ${props.westLevels}</small>
                </div>
            `;
            popup.setLngLat(e.lngLat).setHTML(html).addTo(this.map);
        });
    }

    /**
     * Starts the automated data polling loop.
     */
    startAutoRefresh(ms = 300000) {
        this.fetchTracks();
        this.refreshInterval = setInterval(() => this.fetchTracks(), ms);
    }

    /**
     * Stops the automated data polling loop.
     */
    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    /**
     * Public helper to toggle track visibility.
     */
    toggle(show) {
        this.showTracks = show;
        this.updateVisibility();
    }
}

export default NatTracksLayer;