/**
 * approachNavGen.js — procedures for airports with no published data.
 *
 * The FAA's procedures are public, so US fields fly the real ones
 * (nav/<ICAO>.json, tools/build-nav.mjs). Everywhere else the game builds a
 * believable set here, in exactly the same format, so nothing downstream
 * can tell the difference:
 *   - STARs from four directions, starting at a real VOR (else NDB) when one
 *     sits in that sector 24–37 NM out, else at an invented fix;
 *   - SIDs out to four exits between them, likewise, with a runway
 *     transition for every runway end;
 *   - an ILS (runways of 5,000 ft or more) and an RNAV (GPS) approach on
 *     every runway end: IF at 10 NM, FAF at 5 NM, with T-bar IAFs.
 * The real navaids within 45 NM go in as waypoints. Everything is seeded by
 * the ICAO, so a field's procedures are the same every shift.
 *
 * Hand-built procedures (nav/custom/<ICAO>.json) replace these section by
 * section; see docs/NAV-AUTHORING.md.
 */

const D2R = Math.PI / 180;
const norm = h => ((h % 360) + 360) % 360;
const diff = (a, b) => { const d = norm(b - a); return d > 180 ? d - 360 : d; };
const brg = (dx, dy) => norm(Math.atan2(dx, dy) / D2R);
const r4 = n => Math.round(n * 1e4) / 1e4;
const r100 = a => Math.round(a / 100) * 100;
const up1000 = a => Math.ceil(a / 1000) * 1000;

function seeded(str) {
    let h = 2166136261;
    for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    return () => {
        h += 0x6D2B79F5;
        let t = h;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * A nav file for this airport. `world` is the game's world built without nav
 * data (icao, lat, lon, elev, ends with id/thr/far/course/len, proj);
 * `navaids` is nav/navaids.json's list of [ident, lat, lon, kind].
 */
export function generateNav(world, navaids) {
    const rng = seeded('nav:' + world.icao), cosLat = Math.cos(world.lat * D2R), elev = world.elev;
    const ll = p => [r4(world.lat + p.y / 60), r4(world.lon + p.x / (60 * cosLat))];
    const at = (b, d) => ({ x: Math.sin(b * D2R) * d, y: Math.cos(b * D2R) * d });
    const fix = {}, used = new Set();

    // The real navaids around the field: waypoints within 45 NM, anchors for the procedures within 60.
    const near = [];
    for (const [id, lat, lon, kind] of navaids || []) {
        if (Math.abs(lat - world.lat) > 1.2 || used.has(id)) continue;
        const p = world.proj(lat, lon), d = Math.hypot(p.x, p.y);
        if (d > 60) continue;
        used.add(id);
        near.push({ id, x: p.x, y: p.y, d, b: brg(p.x, p.y), kind });
        if (d <= 45) fix[id] = [r4(lat), r4(lon), kind];
    }
    /** An invented five-letter fix (consonant-vowel), never one of the real names. */
    const fixName = () => {
        const C = 'BCDFGHJKLMNPRSTVWZ', V = 'AEIOU';
        for (;;) {
            let s = '';
            for (let i = 0; i < 5; i++) s += i % 2 ? V[Math.floor(rng() * V.length)] : C[Math.floor(rng() * C.length)];
            if (!used.has(s)) { used.add(s); return s; }
        }
    };
    const put = p => { const n = fixName(); fix[n] = [...ll(p), 'F']; return n; };
    /** The navaid nearest a bearing in a range band: VORs before NDBs, not one already used. */
    const anchor = (b, lo, hi) => near
        .filter(n => !n.taken && n.d >= lo && n.d <= hi && Math.abs(diff(n.b, b)) <= 25)
        .sort((p, q) => (p.kind === 'V' ? 0 : 20) + Math.abs(diff(p.b, b)) - ((q.kind === 'V' ? 0 : 20) + Math.abs(diff(q.b, b))))[0];
    const named = (b, lo, hi, d) => {
        const a = anchor(b, lo, hi);
        if (!a) return { name: put(at(b, d)), b, d };
        a.taken = true;
        fix[a.id] = fix[a.id] || [...ll(a), a.kind];
        return { name: a.id, b: a.b, d: a.d };
    };
    const num = () => 1 + Math.floor(rng() * 9);
    const base = rng() * 90;

    // STARs: entry (descending from about 300 ft a mile out), a dogleg at 22 NM, ending 14 NM out.
    const star = [];
    for (let k = 0; k < 4; k++) {
        const e = named(norm(base + 45 + 90 * k), 24, 37, 34);
        const mid = put(at(norm(e.b + (rng() < 0.5 ? -8 : 8)), 22)), end = put(at(e.b, 14));
        star.push({ id: `${e.name}${num()}A`, routes: [{ t: '', legs: [
            [e.name, up1000(elev + Math.max(9000, e.d * 300)), '+', null, 'IF', ''],
            [mid, up1000(elev + 6000), '+', 250, 'TF', ''],
            [end, up1000(elev + 4000), '+', 220, 'TF', ''],
        ] }] });
    }

    // Runway thresholds, and a climb fix 3 NM past each departure end.
    const climb = {};
    for (const e of world.ends) {
        fix['RW' + e.id] = [...ll(e.thr), 'F'];
        const c = e.course * D2R;
        climb[e.id] = put({ x: e.far.x + Math.sin(c) * 3, y: e.far.y + Math.cos(c) * 3 });
    }
    // SIDs: runway heading to 400 ft, direct the climb fix, then out by a fix at 15 NM to the exit.
    const sid = [];
    for (let k = 0; k < 4; k++) {
        const x = named(norm(base + 90 * k), 24, 37, 34);
        const mid = put(at(norm(x.b + (rng() < 0.5 ? -6 : 6)), 15));
        sid.push({ id: `${x.name}${num()}D`, routes: [
            ...world.ends.map(e => ({ t: 'RW' + e.id, legs: [[null, r100(elev + 400), '+', null, 'VA', ''], [climb[e.id], r100(elev + 2000), '+', null, 'DF', '']] })),
            { t: '', legs: [[mid, up1000(elev + 5000), '+', null, 'TF', ''], [x.name, up1000(elev + 9000), '+', null, 'TF', '']] },
        ] });
    }

    // Approaches on every runway end: IF at 10 NM, FAF at 5 (on a 3° glidepath), T-bar IAFs 5 NM either side of the IF.
    const iap = [];
    for (const e of world.ends) {
        const c = e.course * D2R;
        const P = (along, off = 0) => ({ x: e.thr.x - Math.sin(c) * along + Math.cos(c) * off, y: e.thr.y - Math.cos(c) * along - Math.sin(c) * off });
        const ifx = put(P(10)), faf = put(P(5)), ifAlt = r100(elev + 3000), fafAlt = r100(elev + 5 * 318);
        const common = [[ifx, ifAlt, '+', null, 'IF', 'I'], [faf, fafAlt, '', null, 'TF', 'F'], ['RW' + e.id, null, '', null, 'TF', 'M']];
        const iafs = [put(P(10, -5)), put(P(10, 5))].map(f => ({ t: f, legs: [[f, ifAlt, '+', null, 'IF', 'A'], [ifx, ifAlt, '+', null, 'TF', 'I']] }));
        if (e.len * 6076 >= 5000) iap.push({ id: 'I' + e.id, name: `ILS RWY ${e.id}`, rwy: e.id, type: 'ILS', routes: [{ t: '', legs: common }, ...iafs] });
        iap.push({ id: 'R' + e.id, name: `RNAV (GPS) RWY ${e.id}`, rwy: e.id, type: 'RNAV', routes: [{ t: '', legs: common }, ...iafs] });
    }
    return { icao: world.icao, cycle: 'generated', generated: true, fix, star, sid, iap };
}
