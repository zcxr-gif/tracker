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
                shape: shapeFor(resolved.key, m),
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
            shape: shapeFor(resolved.key, m),
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

    /**
     * Airframe proportions, in the same row-units the seat grid uses.
     *
     * Every number here is a shape decision, not a performance one: how far the
     * nose reaches ahead of row 1, how long the tail cone runs behind the last
     * row, where along the cabin the wing box sits, how far the wings sweep
     * back, and where the engines hang. A 747's nose is long and its wings are
     * swept hard; a Q400's nose is stubby and its straight wings sit well
     * forward, over an early cabin row. Drawing both as the same rounded tube
     * was the thing that made these look generic.
     */
    const SHAPES = {
        //             nose  tail   wing box along the cabin
        widebody:   { nose: 3.2, tail: 4.6, wing: [0.40, 0.57], wide: true },
        jumbo:      { nose: 3.8, tail: 5.0, wing: [0.40, 0.56], wide: true },
        superjumbo: { nose: 3.2, tail: 4.8, wing: [0.37, 0.58], wide: true },
        narrow:     { nose: 2.6, tail: 3.8, wing: [0.42, 0.56], wide: false },
        regional:   { nose: 2.2, tail: 3.8, wing: [0.44, 0.58], wide: false },
        turboprop:  { nose: 2.0, tail: 3.4, wing: [0.28, 0.40], wide: false },
        trijet:     { nose: 3.0, tail: 4.8, wing: [0.40, 0.56], wide: true },
        bizjet:     { nose: 2.4, tail: 3.8, wing: [0.44, 0.60], wide: false },
        // A light aircraft's cabin is only two rows long, so without a longer
        // nose and tail the body comes out wider than it is long and reads as
        // an egg rather than an aeroplane.
        light:      { nose: 2.6, tail: 4.6, wing: [0.05, 0.45], wide: false }
    };

    function shapeFor(key, m) {
        const S = SHAPES;
        if (/^A388/.test(key)) return S.superjumbo;
        if (/^B74/.test(key)) return S.jumbo;
        if (/^(B77|B78|A33|A35|A34|B76)/.test(key)) return S.widebody;
        if (/^(DC10|MD11)/.test(key)) return S.trijet;
        if (/^(CRJ|B712|E1[79])/.test(key)) return S.regional;
        if (/^C750/.test(key)) return S.bizjet;
        if (/^(DH8D|C208)/.test(key)) return S.turboprop;
        if (/^(C172|SR22|XCUB|SPIT|HELI)/.test(key)) return S.light;
        if (m && m.kind && m.kind !== 'jet') return S.turboprop;
        return S.narrow;
    }

    /**
     * The fuselage outline: ogive nose, parallel cabin, boat-tailed cone.
     *
     * The nose cubic leaves the tip perpendicular to the centreline and arrives
     * tangent to the cabin side, which is what gives an airliner its rounded
     * plan-view nose rather than a dart. The tail is a single quadratic whose
     * control point sits on the cabin line, so it leaves the parallel section
     * smoothly and tapers all the way to a blunt tip — an earlier version put
     * the control near the tip instead and flared the cone back out into a
     * bulb.
     */
    function fuselagePath(x0, noseLen, cabinLen, tailLen, yc, half) {
        const a = x0 + noseLen;                 // where the parallel section starts
        const b = a + cabinLen;                 // where the tail cone begins
        const tip = b + tailLen;
        const top = yc - half, bot = yc + half;
        const tipHalf = half * 0.10;            // the cone ends blunt, not sharp
        const f = (v) => v.toFixed(1);
        return `M ${f(x0)} ${f(yc)}`
            + ` C ${f(x0)} ${f(yc - half * 0.62)} ${f(a - noseLen * 0.50)} ${f(top)} ${f(a)} ${f(top)}`
            + ` L ${f(b)} ${f(top)}`
            + ` Q ${f(b + tailLen * 0.52)} ${f(top)} ${f(tip)} ${f(yc - tipHalf)}`
            + ` L ${f(tip)} ${f(yc + tipHalf)}`
            + ` Q ${f(b + tailLen * 0.52)} ${f(bot)} ${f(b)} ${f(bot)}`
            + ` L ${f(a)} ${f(bot)}`
            + ` C ${f(a - noseLen * 0.50)} ${f(bot)} ${f(x0)} ${f(yc + half * 0.62)} ${f(x0)} ${f(yc)}`
            + ' Z';
    }

    /**
     * The aircraft the cabin sits inside.
     *
     * Deliberately no wings. A wing drawn to scale would span about as far as
     * the cabin is long — an A320's span and length are both ~35 m — so putting
     * one in would either shrink every seat to a speck or be a lie about the
     * proportions. This is why published seat maps don't draw them either.
     * What they draw, and what is drawn here, is the fuselage in plan with the
     * type's own nose and tail profile, the wing root where it actually joins,
     * and the doors and over-wing exits along the side. All of that is real,
     * and all of it is information: the shaded band is the rows over the wing.
     */
    function airframe(shape, x0, noseLen, cabinLen, tailLen, yc, half, stroke, faint, wide) {
        const parts = [];
        const top = yc - half, bot = yc + half;
        const cabinStart = x0 + noseLen;
        const wx0 = cabinStart + cabinLen * shape.wing[0];
        const wx1 = cabinStart + cabinLen * shape.wing[1];
        const chord = Math.max(6, wx1 - wx0);

        // Rows sitting over the wing box — no window, and usually the exit row.
        parts.push(`<rect x="${wx0.toFixed(1)}" y="${top.toFixed(1)}" width="${chord.toFixed(1)}"`
            + ` height="${(half * 2).toFixed(1)}" fill="${stroke}" opacity="0.10"/>`);

        // Wing-root fairing: the belly bulge where the wing meets the body. A
        // shallow lens either side, which is all of the wing that is honestly
        // in frame at this scale.
        const bulge = half * 0.13;
        for (const dir of [-1, 1]) {
            const edge = dir < 0 ? top : bot;
            parts.push(`<path d="M ${(wx0 - chord * 0.18).toFixed(1)} ${edge.toFixed(1)}`
                + ` C ${(wx0 + chord * 0.15).toFixed(1)} ${(edge + bulge * dir).toFixed(1)}`
                + ` ${(wx1 - chord * 0.15).toFixed(1)} ${(edge + bulge * dir).toFixed(1)}`
                + ` ${(wx1 + chord * 0.22).toFixed(1)} ${edge.toFixed(1)} Z"`
                + ` fill="${stroke}" opacity="0.22"/>`);
        }

        // Doors and over-wing exits, on both sides. Two pairs plus the exits on
        // a narrowbody; four on a widebody, which is what the certification
        // actually requires for the seat counts involved.
        const doorAt = (x, dir) => {
            const edge = dir < 0 ? top : bot;
            return `<rect x="${(x - 1.4).toFixed(1)}" y="${(edge - 1.6).toFixed(1)}" width="2.8" height="3.2"`
                + ` rx="1.1" fill="${stroke}" opacity="0.75"/>`;
        };
        const doors = wide
            ? [0.015, 0.30, 0.60, 0.985]
            : [0.02, 0.985];
        const exits = [shape.wing[0] - 0.03, shape.wing[1] + 0.03];
        for (const f of doors.concat(exits)) {
            const x = cabinStart + cabinLen * Math.max(0, Math.min(1, f));
            parts.push(doorAt(x, -1), doorAt(x, 1));
        }

        // Flight deck: a short cross-line where the cockpit ends and the cabin
        // begins, so the nose reads as a nose.
        parts.push(`<line x1="${cabinStart.toFixed(1)}" y1="${(top + half * 0.22).toFixed(1)}"`
            + ` x2="${cabinStart.toFixed(1)}" y2="${(bot - half * 0.22).toFixed(1)}"`
            + ` stroke="${faint}" stroke-width="0.9" opacity="0.55"/>`);

        parts.push(`<path d="${fuselagePath(x0, noseLen, cabinLen, tailLen, yc, half)}"`
            + ` fill="none" stroke="${stroke}" stroke-width="1.3" opacity="0.6"/>`);
        return parts.join('');
    }

    function cabinSVG(lay, dimColor, faint) {
        const shape = lay.shape || SHAPES.narrow;
        const cabinLen = lay.totalRows * U;
        const H = lay.slots * U;
        const half = H / 2 + 5;
        const noseLen = shape.nose * U, tailLen = shape.tail * U;
        const padY = 6;
        const x0 = 3;
        const vbW = x0 + noseLen + cabinLen + tailLen + 4;
        const vbH = padY * 2 + half * 2;
        const yc = vbH / 2;
        const seatY0 = yc - H / 2;
        const seatX0 = x0 + noseLen;

        let seats = '';
        let x = 0;
        for (const z of lay.zones) {
            const slots = seatSlots(z.abreast, lay.slots);
            let seatNo = 0;
            for (let r = 0; r < z.rows; r++) {
                for (const s of slots) {
                    if (seatNo >= z.seats) break;
                    const taken = seatNo < z.occupied;
                    const px = seatX0 + (x + r) * U + (U - SEAT) / 2;
                    const py = seatY0 + s * U + (U - SEAT) / 2;
                    seats += `<rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${SEAT}" height="${SEAT}" rx="1.6"`
                        + (taken ? ` fill="${z.color}" opacity="0.95"/>`
                                 : ` fill="none" stroke="${z.color}" stroke-width="0.9" opacity="0.34"/>`);
                    seatNo++;
                }
            }
            // A hairline where the cabin changes class.
            if (x > 0) {
                const bx = seatX0 + x * U - 1;
                seats += `<line x1="${bx.toFixed(1)}" y1="${(yc - half + 1).toFixed(1)}" x2="${bx.toFixed(1)}" y2="${(yc + half - 1).toFixed(1)}"`
                    + ` stroke="${faint}" stroke-width="0.8" stroke-dasharray="2 2" opacity="0.75"/>`;
            }
            x += z.rows;
        }

        const body = airframe(shape, x0, noseLen, cabinLen, tailLen, yc, half, dimColor, faint, shape.wide);

        return `<svg viewBox="0 0 ${vbW.toFixed(0)} ${vbH.toFixed(0)}" preserveAspectRatio="xMidYMid meet"`
            + ` role="img" aria-label="Typical cabin layout, ${lay.occupied} of ${lay.totalSeats} seats occupied"`
            + ` style="display:block;width:100%;max-width:${Math.round(vbW * 2.6)}px;margin:0 auto;height:auto;overflow:visible;">`
            + `${body}${seats}</svg>`;
    }

    function cargoSVG(lay, dimColor, color, faint) {
        const shape = lay.shape || SHAPES.widebody;
        const n = lay.positions;
        const cols = Math.min(n, 11), rows = Math.ceil(n / cols);
        const cw = 17, ch = 13, gap = 3;
        const cabinLen = cols * (cw + gap) - gap;
        const H = rows * (ch + gap) - gap;
        const half = H / 2 + 6;
        const noseLen = shape.nose * U, tailLen = shape.tail * U;
        const padY = 6;
        const x0 = 3;
        const vbW = x0 + noseLen + cabinLen + tailLen + 4;
        const vbH = padY * 2 + half * 2;
        const yc = vbH / 2;

        let cells = '';
        for (let i = 0; i < n; i++) {
            const c = i % cols, r = Math.floor(i / cols);
            cells += `<rect x="${(x0 + noseLen + c * (cw + gap)).toFixed(1)}"`
                + ` y="${(yc - H / 2 + r * (ch + gap)).toFixed(1)}"`
                + ` width="${cw}" height="${ch}" rx="1.8" fill="${color}" opacity="0.85"/>`;
        }

        const body = airframe(shape, x0, noseLen, cabinLen, tailLen, yc, half, dimColor, faint, shape.wide);
        return `<svg viewBox="0 0 ${vbW.toFixed(0)} ${vbH.toFixed(0)}" preserveAspectRatio="xMidYMid meet"`
            + ` role="img" aria-label="Main deck cargo positions"`
            + ` style="display:block;width:100%;max-width:${Math.round(vbW * 2.6)}px;margin:0 auto;height:auto;overflow:visible;">`
            + `${body}${cells}</svg>`;
    }

    /**
     * The honesty note.
     *
     * These drawings are built from detailed per-type models — the right
     * abreast configuration, the right nose and tail proportions, the wing box
     * and doors where they really sit — and they are still not your airline's
     * aeroplane. Both halves of that deserve saying, in the card, where someone
     * is looking at it.
     */
    function accuracyNote(accent, dim, faint) {
        return '<div style="margin-top:11px;padding:9px 11px;border-radius:8px;'
            + 'background:rgba(128,128,128,0.10);border-left:2px solid ' + accent + ';">'
            + `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">`
            +   `<i class="fa-solid fa-circle-info" style="font-size:9px;color:${accent};"></i>`
            +   `<span style="font-size:8.5px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:${accent};">How close is this?</span>`
            + '</div>'
            + `<div style="font-size:9.5px;line-height:1.55;color:${dim};">`
            +   'Every one of these is modelled per aircraft type, and we put real work into imitating what is '
            +   'genuinely on that airframe — the seating abreast, the cabin proportions, where the wing and doors fall. '
            +   'Even so, <strong style="font-weight:700;">this is not your operator&rsquo;s exact cabin and it is not accurate</strong>; '
            +   'no two airlines fit one out the same way, and the sim doesn&rsquo;t tell us which one this is. '
            +   'Treat it as our best impression — and one we&rsquo;ll keep sharpening to get closer to the real thing.'
            + '</div></div>';
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
                + `<div style="margin:12px 0 8px;">${cargoSVG(lay, DIM, ACCENT, FAINT)}</div>`
                + `<div style="font-size:10px;color:${DIM};line-height:1.5;">`
                +   `${lay.positions} main-deck positions carrying the ${Math.round(lay.payloadKg / 1000)} tonnes `
                +   'the fuel model is flying.'
                + '</div>'
                + accuracyNote(ACCENT, DIM, FAINT));
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
            + accuracyNote(ACCENT, DIM, FAINT));
    }

    global.CabinMap = { layout, renderHTML, CABINS, CLASSES };

})(typeof window !== 'undefined' ? window : this);
