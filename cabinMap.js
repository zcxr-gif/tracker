/**
 * cabinMap.js — cabin seating plan for the aircraft in the flight window.
 *
 * A plan view of the cabin, nose to the left, drawn from the type's typical
 * configuration and filled to the number of passengers the fuel model is
 * carrying. That last part is the point: the payload assumption behind every
 * fuel figure stops being an invisible constant and becomes something you can
 * look at and disagree with. Filed a dispatch plan with 340 passengers? The
 * cabin shows 340 seats taken.
 *
 * ── What this is not ──────────────────────────────────────────────────────
 * It is not the operator's seat map. Cabin layouts are chosen airline by
 * airline — an Emirates 777-300ER and an Air New Zealand one share a fuselage
 * and almost nothing else — and there is no free, licensable source for them.
 * What is drawn here is a representative two- or three-class layout for the
 * type, with the correct abreast configuration (3-3 on an A320, 3-4-3 on a
 * 777, 2-2 on a Q400), and the card says so plainly. Treat it as "what an
 * aeroplane of this shape usually looks like inside", never as a seat you
 * could book.
 *
 * Freighters get a main-deck cargo plan instead, since there is no cabin.
 *
 * Depends on FuelEstimator only for type resolution and the typical passenger
 * count, and degrades to nothing if it isn't loaded.
 *
 * Exposes window.CabinMap = { layout, renderHTML }.
 */
(function (global) {
    'use strict';

    // Seat classes, in the order they appear from the nose back.
    const CLASSES = {
        F: { label: 'First',    color: '#fbbf24' },
        J: { label: 'Business', color: '#c084fc' },
        W: { label: 'Premium',  color: '#2dd4bf' },
        Y: { label: 'Economy',  color: 'var(--color-brand, #38bdf8)' }
    };

    // Typical configurations: how the cabin splits between classes, and how
    // many seats sit abreast in each (the arrays are seat groups either side
    // of the aisles, so [3,4,3] is a twin-aisle widebody).
    const NARROW      = [{ c: 'J', share: 0.08, abreast: [2, 2] },      { c: 'Y', share: 0.92, abreast: [3, 3] }];
    const NARROW_BOE  = [{ c: 'J', share: 0.09, abreast: [2, 2] },      { c: 'Y', share: 0.91, abreast: [3, 3] }];
    const REGIONAL    = [{ c: 'Y', share: 1.00, abreast: [2, 2] }];
    const REGIONAL_J  = [{ c: 'J', share: 0.12, abreast: [1, 2] },      { c: 'Y', share: 0.88, abreast: [2, 2] }];
    const WIDE_343    = [{ c: 'J', share: 0.10, abreast: [1, 2, 1] },   { c: 'W', share: 0.07, abreast: [2, 4, 2] }, { c: 'Y', share: 0.83, abreast: [3, 4, 3] }];
    const WIDE_333    = [{ c: 'J', share: 0.10, abreast: [1, 2, 1] },   { c: 'W', share: 0.07, abreast: [2, 3, 2] }, { c: 'Y', share: 0.83, abreast: [3, 3, 3] }];
    const WIDE_242    = [{ c: 'J', share: 0.10, abreast: [1, 2, 1] },   { c: 'W', share: 0.06, abreast: [2, 3, 2] }, { c: 'Y', share: 0.84, abreast: [2, 4, 2] }];
    const WIDE_232    = [{ c: 'J', share: 0.09, abreast: [1, 2, 1] },   { c: 'Y', share: 0.91, abreast: [2, 3, 2] }];
    const JUMBO       = [{ c: 'F', share: 0.03, abreast: [1, 2, 1] },   { c: 'J', share: 0.12, abreast: [2, 2, 2] }, { c: 'Y', share: 0.85, abreast: [3, 4, 3] }];
    const SUPERJUMBO  = [{ c: 'F', share: 0.02, abreast: [1, 2, 1] },   { c: 'J', share: 0.13, abreast: [1, 2, 1] }, { c: 'Y', share: 0.85, abreast: [3, 4, 3] }];
    const TRIJET      = [{ c: 'J', share: 0.10, abreast: [2, 2, 2] },   { c: 'Y', share: 0.90, abreast: [2, 5, 2] }];
    const LIGHT       = [{ c: 'Y', share: 1.00, abreast: [1, 1] }];
    const BIZJET      = [{ c: 'J', share: 1.00, abreast: [1, 1] }];
    const TANDEM      = [{ c: 'Y', share: 1.00, abreast: [1] }];

    const CABINS = {
        A318: NARROW, A319: NARROW, A320: NARROW, A20N: NARROW, A321: NARROW, A21N: NARROW,
        B737: NARROW_BOE, B738: NARROW_BOE, B739: NARROW_BOE, B38M: NARROW_BOE, B752: NARROW_BOE,
        B712: [{ c: 'J', share: 0.11, abreast: [2, 2] }, { c: 'Y', share: 0.89, abreast: [2, 3] }],
        CRJ2: REGIONAL, CRJ7: REGIONAL, CRJ9: REGIONAL, CRJX: REGIONAL, DH8D: REGIONAL,
        E175: REGIONAL_J, E190: REGIONAL_J,
        B763: WIDE_232, A333: WIDE_242, A339: WIDE_242, A346: WIDE_242,
        B772: WIDE_343, B77L: WIDE_343, B77W: WIDE_343,
        B788: WIDE_333, B789: WIDE_333, B78X: WIDE_333, A359: WIDE_333,
        B742: JUMBO, B744: JUMBO, B748: JUMBO, A388: SUPERJUMBO,
        DC10: TRIJET, MD11: TRIJET,
        C172: LIGHT, SR22: LIGHT, C208: LIGHT, HELI: LIGHT,
        C750: BIZJET, XCUB: TANDEM, SPIT: TANDEM
    };

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /**
     * Work out the cabin for an aircraft.
     *
     * @param {string} aircraftName  as reported by the live API
     * @param {Object} [opts] { paxOnboard, freighter, payloadKg }
     * @returns {Object|null} zones, seat grid dimensions and totals
     */
    function layout(aircraftName, opts) {
        opts = opts || {};
        const FE = global.FuelEstimator;
        if (!FE || !FE.resolveModel) return null;

        const resolved = FE.resolveModel(aircraftName);
        const m = resolved.model;
        if (!m) return null;

        // No cabin to draw on a freighter — the main deck carries pallets.
        if (opts.freighter) {
            return {
                kind: 'cargo',
                label: m.label,
                matched: resolved.source,
                payloadKg: Math.max(0, Number(opts.payloadKg) || 0),
                // Main-deck pallet positions, roughly one per 4 tonnes on a
                // widebody freighter and proportionally fewer on smaller types.
                positions: Math.max(4, Math.min(40, Math.round((Number(opts.payloadKg) || 0) / 4000)))
            };
        }

        // Crewed types with no passenger cabin at all.
        if (!m.pax || m.pax < 1) {
            return { kind: 'none', label: m.label, matched: resolved.source };
        }

        const spec = CABINS[resolved.key] || (m.pax > 200 ? WIDE_333 : (m.pax > 100 ? NARROW : REGIONAL));
        const totalSeats = Math.max(1, Math.round(m.pax));
        const occupied = Math.max(0, Math.min(totalSeats,
            Number.isFinite(opts.paxOnboard) ? Math.round(opts.paxOnboard) : totalSeats));

        // Seats per class, with any rounding remainder pushed into economy (the
        // biggest cabin), then rows derived from the abreast configuration.
        const zones = [];
        let assigned = 0;
        spec.forEach((z, i) => {
            const perRow = z.abreast.reduce((s, n) => s + n, 0);
            let seats = (i === spec.length - 1)
                ? totalSeats - assigned
                : Math.max(perRow, Math.round(totalSeats * z.share / perRow) * perRow);
            seats = Math.max(0, seats);
            assigned += seats;
            if (seats <= 0) return;
            zones.push({
                code: z.c,
                label: CLASSES[z.c] ? CLASSES[z.c].label : z.c,
                color: CLASSES[z.c] ? CLASSES[z.c].color : CLASSES.Y.color,
                abreast: z.abreast.slice(),
                perRow,
                seats,
                rows: Math.ceil(seats / perRow)
            });
        });
        if (!zones.length) return { kind: 'none', label: m.label, matched: resolved.source };

        // Everyone boards at the same load factor, so a half-full aeroplane is
        // half-full everywhere rather than economy-empty and business-packed.
        const loadFactor = totalSeats > 0 ? occupied / totalSeats : 0;
        let placed = 0;
        zones.forEach((z, i) => {
            z.occupied = (i === zones.length - 1)
                ? Math.max(0, occupied - placed)
                : Math.min(z.seats, Math.round(z.seats * loadFactor));
            z.occupied = Math.min(z.occupied, z.seats);
            placed += z.occupied;
        });

        return {
            kind: 'cabin',
            label: m.label,
            matched: resolved.source,
            zones,
            totalSeats,
            occupied,
            loadFactorPct: loadFactor * 100,
            totalRows: zones.reduce((s, z) => s + z.rows, 0),
            // Widest abreast anywhere in the cabin, including the aisle gaps —
            // this sets how tall the drawing has to be.
            slots: Math.max.apply(null, zones.map(z => z.perRow + z.abreast.length - 1))
        };
    }

    // ── Drawing ───────────────────────────────────────────────────────────
    const U = 10;      // grid unit per seat slot, in viewBox units
    const SEAT = 7.4;  // seat square inside that slot

    /** Y slot indices for a row, centred within the widest cabin section. */
    function seatSlots(abreast, slots) {
        const used = abreast.reduce((s, n) => s + n, 0) + abreast.length - 1;
        const offset = (slots - used) / 2;
        const out = [];
        let y = offset;
        abreast.forEach((group, gi) => {
            for (let i = 0; i < group; i++) out.push(y++);
            if (gi < abreast.length - 1) y++;   // aisle
        });
        return out;
    }

    function cabinSVG(lay, dimColor, faint) {
        const W = lay.totalRows * U;
        const H = lay.slots * U;
        const padX = 26, padY = 7;          // room for the nose cone and skin
        const vbW = W + padX * 2, vbH = H + padY * 2;

        let seats = '';
        let x = 0;
        for (const z of lay.zones) {
            const slots = seatSlots(z.abreast, lay.slots);
            let seatNo = 0;
            for (let r = 0; r < z.rows; r++) {
                for (const s of slots) {
                    if (seatNo >= z.seats) break;
                    const taken = seatNo < z.occupied;
                    const px = padX + (x + r) * U + (U - SEAT) / 2;
                    const py = padY + s * U + (U - SEAT) / 2;
                    seats += `<rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${SEAT}" height="${SEAT}" rx="1.6"`
                        + (taken ? ` fill="${z.color}" opacity="0.92"/>`
                                 : ` fill="none" stroke="${z.color}" stroke-width="0.9" opacity="0.32"/>`);
                    seatNo++;
                }
            }
            // A hairline where the cabin changes class.
            if (x > 0) {
                const bx = padX + x * U - 1;
                seats += `<line x1="${bx.toFixed(1)}" y1="${padY - 3}" x2="${bx.toFixed(1)}" y2="${(padY + H + 3).toFixed(1)}" stroke="${faint}" stroke-width="0.8" stroke-dasharray="2 2" opacity="0.7"/>`;
            }
            x += z.rows;
        }

        // Fuselage: a rounded tube with a pointed nose at the left and a tail
        // that tapers away to the right, so it reads as an aeroplane.
        const top = padY - 4, bot = padY + H + 4, midY = (top + bot) / 2;
        const noseX = 2, bodyX = padX - 4, tailX = padX + W + 4, tipX = vbW - 2;
        const skin = ''
            + `<path d="M ${bodyX} ${top}`
            +   ` L ${tailX} ${top} Q ${tipX} ${top + 3} ${tipX} ${midY}`
            +   ` Q ${tipX} ${bot - 3} ${tailX} ${bot}`
            +   ` L ${bodyX} ${bot}`
            +   ` Q ${noseX} ${bot - 2} ${noseX} ${midY}`
            +   ` Q ${noseX} ${top + 2} ${bodyX} ${top} Z"`
            + ` fill="none" stroke="${dimColor}" stroke-width="1.1" opacity="0.45"/>`;

        return `<svg viewBox="0 0 ${vbW.toFixed(0)} ${vbH.toFixed(0)}" preserveAspectRatio="xMidYMid meet"`
            + ` role="img" aria-label="Typical cabin layout, ${lay.occupied} of ${lay.totalSeats} seats occupied"`
            + ` style="display:block;width:100%;max-width:${Math.round(vbW * 2.6)}px;margin:0 auto;height:auto;overflow:visible;">`
            + `${skin}${seats}</svg>`;
    }

    function cargoSVG(lay, dimColor, color) {
        const n = lay.positions;
        const cols = Math.min(n, 12), rows = Math.ceil(n / cols);
        const cw = 16, ch = 13, gap = 2.5, padX = 24, padY = 7;
        const W = cols * (cw + gap) - gap, H = rows * (ch + gap) - gap;
        const vbW = W + padX * 2, vbH = H + padY * 2;
        let cells = '';
        for (let i = 0; i < n; i++) {
            const c = i % cols, r = Math.floor(i / cols);
            cells += `<rect x="${(padX + c * (cw + gap)).toFixed(1)}" y="${(padY + r * (ch + gap)).toFixed(1)}"`
                + ` width="${cw}" height="${ch}" rx="1.8" fill="${color}" opacity="0.82"/>`;
        }
        const top = padY - 4, bot = padY + H + 4, midY = (top + bot) / 2;
        const skin = `<path d="M ${padX - 4} ${top} L ${padX + W + 4} ${top} Q ${vbW - 2} ${top + 3} ${vbW - 2} ${midY}`
            + ` Q ${vbW - 2} ${bot - 3} ${padX + W + 4} ${bot} L ${padX - 4} ${bot}`
            + ` Q 2 ${bot - 2} 2 ${midY} Q 2 ${top + 2} ${padX - 4} ${top} Z"`
            + ` fill="none" stroke="${dimColor}" stroke-width="1.1" opacity="0.45"/>`;
        return `<svg viewBox="0 0 ${vbW.toFixed(0)} ${vbH.toFixed(0)}" preserveAspectRatio="xMidYMid meet"`
            + ` role="img" aria-label="Main deck cargo positions"`
            + ` style="display:block;width:100%;max-width:${Math.round(vbW * 2.6)}px;margin:0 auto;height:auto;overflow:visible;">`
            + `${skin}${cells}</svg>`;
    }

    /**
     * Render the cabin card.
     * @param {Object} lay    from layout()
     * @param {Object} [opts] { compact }
     */
    function renderHTML(lay, opts) {
        opts = opts || {};
        if (!lay || lay.kind === 'none') return '';

        const SURFACE = 'var(--card-bg, rgba(15,23,42,0.40))';
        const BORDER  = 'var(--border-glass, rgba(255,255,255,0.08))';
        const HAIR    = 'rgba(128,128,128,0.22)';
        const TXT     = 'var(--text-primary, #ffffff)';
        const DIM     = 'var(--text-secondary, #9a9aa2)';
        const FAINT   = 'var(--text-dim, #64748b)';
        const ACCENT  = 'var(--color-brand, #38bdf8)';
        const MONO    = "'JetBrains Mono', ui-monospace, monospace";

        const head = (right) => ''
            + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
            +   `<i class="fa-solid ${lay.kind === 'cargo' ? 'fa-pallet' : 'fa-chair'}" style="color:${ACCENT};font-size:12px;"></i>`
            +   `<span style="font-size:11px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:${TXT};">${lay.kind === 'cargo' ? 'Main deck' : 'Cabin'}</span>`
            +   `<span style="font-size:9px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:${FAINT};border:1px solid ${BORDER};border-radius:999px;padding:1px 6px;">Typical</span>`
            +   (right ? `<span style="margin-left:auto;font-family:${MONO};font-size:12px;font-weight:600;color:${TXT};">${right}</span>` : '')
            + '</div>';

        const shell = (inner) =>
            `<div class="cabin-card" data-cabin-card style="background:${SURFACE};border:1px solid ${BORDER};`
            + `border-radius:var(--radius-lg, 14px);padding:14px;overflow:hidden;">${inner}</div>`;

        if (lay.kind === 'cargo') {
            return shell(''
                + head(Math.round(lay.payloadKg / 1000) + ' t')
                + `<div style="margin:12px 0 8px;">${cargoSVG(lay, DIM, ACCENT)}</div>`
                + `<div style="font-size:10px;color:${DIM};line-height:1.5;">`
                +   `${lay.positions} main-deck positions carrying the ${Math.round(lay.payloadKg / 1000)} tonnes `
                +   'the fuel model is flying. Freighter layouts vary by operator; this is indicative.'
                + '</div>');
        }

        const legend = lay.zones.map(z => ''
            + '<span style="display:inline-flex;align-items:center;gap:5px;white-space:nowrap;">'
            +   `<span style="width:8px;height:8px;border-radius:2px;background:${z.color};"></span>`
            +   `<span style="font-size:10px;color:${DIM};font-weight:600;">${esc(z.label)}</span>`
            +   `<span style="font-family:${MONO};font-size:10px;color:${TXT};font-weight:600;">${z.seats}</span>`
            +   `<span style="font-size:9px;color:${FAINT};">${z.abreast.join('-')}</span>`
            + '</span>').join('');

        return shell(''
            + head(`${lay.occupied}<span style="color:${DIM};font-weight:500;"> / ${lay.totalSeats}</span>`)
            + `<div style="display:flex;align-items:baseline;gap:8px;margin-top:9px;">`
            +   `<span style="font-size:9px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:${FAINT};">Seats occupied</span>`
            +   `<span style="font-family:${MONO};font-size:11px;color:${DIM};font-weight:600;">${Math.round(lay.loadFactorPct)}% load</span>`
            + '</div>'
            + `<div style="margin:11px 0 10px;">${cabinSVG(lay, DIM, FAINT)}</div>`
            + `<div style="display:flex;flex-wrap:wrap;gap:6px 14px;padding-top:9px;border-top:1px solid ${HAIR};">${legend}</div>`
            + `<div style="font-size:9.5px;color:${FAINT};margin-top:9px;line-height:1.5;font-style:italic;">`
            +   'A representative layout for the type, not the operator&rsquo;s own — airlines configure cabins very differently. '
            +   'Filled seats are the passengers the fuel estimate is carrying.'
            + '</div>');
    }

    global.CabinMap = { layout, renderHTML, CABINS, CLASSES };

})(typeof window !== 'undefined' ? window : this);
