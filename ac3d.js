/**
 * ac3d.js
 * -------------------------------------------------------------------
 * Reads an AC3D (.ac) model — the format FlightGear's aircraft are drawn
 * from — into flat triangle arrays, ready to hand to the GPU.
 *
 * What comes out is a list of parts, one per texture and per "gear or not":
 * positions, normals, texture coordinates and a colour per vertex, every
 * triangle on its own (no index), in metres. Gear is kept apart so it can
 * be drawn only while an aeroplane is low and slow, the way FlightGear's own
 * `select` animation on the AI models hides it.
 *
 * The axes are left as the file has them (FlightGear's: nose towards −X,
 * roof +Y, right wing −Z); turning them into the engine's frame is
 * aircraftModels.js's job. No three.js here, so it runs in a worker or
 * under Node as well as on the page.
 *
 * The format: https://www.inivis.com/ac3d/man/ac3dfileformat.html
 * ===================================================================
 */

const SURF_POLYGON = 0x0;
const SURF_SMOOTH = 0x10;

// Objects FlightGear hides unless something switches them on — the lit half
// of a light, glow cones, the ground shadow — and that an AI aircraft is
// never asked to show.
const HIDDEN_OBJECT = /shadow|(?:light|beacon|strobe|lamp)s?[-_ ]?on$|halo|flare|glow|landing[-_ ]?light[-_ ]?cone|light[-_ ]?cone|^cone/i;
const GEAR_OBJECT = /gear|wheel|tyre|tire|strut|bogie|oleo/i;

/**
 * @param {string} text  The whole .ac file.
 * @returns {{ parts: Array<{ texture: string, gear: boolean,
 *             position: Float32Array, normal: Float32Array,
 *             uv: Float32Array, color: Float32Array }>,
 *             min: number[], max: number[] }}
 */
export function parseAC3D(text) {
    if (!/^AC3D/.test(text)) throw new Error('Not an AC3D file');

    const lines = text.split(/\r?\n/);
    let at = 1;
    const materials = [];
    const groups = new Map(); // `${texture}|${gear}` -> builder
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];

    const next = () => {
        while (at < lines.length) {
            const line = lines[at++].trim();
            if (line) return line;
        }
        return null;
    };

    // `data n` is followed by n characters that may run over several lines.
    const skipData = (count) => {
        let left = count;
        while (left > 0 && at < lines.length) {
            left -= lines[at++].length + 1;
        }
    };

    const words = (line) => {
        const out = [];
        const re = /"([^"]*)"|(\S+)/g;
        let m;
        while ((m = re.exec(line))) out.push(m[1] !== undefined ? m[1] : m[2]);
        return out;
    };

    const builder = (texture, gear) => {
        const key = texture + '|' + (gear ? 1 : 0);
        let b = groups.get(key);
        if (!b) {
            b = { texture, gear, position: [], normal: [], uv: [], color: [] };
            groups.set(key, b);
        }
        return b;
    };

    // world = parent · (rot · v + loc), with rot read row by row.
    const compose = (parent, rot, loc) => {
        const r = rot || [1, 0, 0, 0, 1, 0, 0, 0, 1];
        const l = loc || [0, 0, 0];
        const p = parent;
        const out = new Array(12);
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                out[i * 3 + j] = p[i * 3] * r[j] + p[i * 3 + 1] * r[3 + j] + p[i * 3 + 2] * r[6 + j];
            }
            out[9 + i] = p[i * 3] * l[0] + p[i * 3 + 1] * l[1] + p[i * 3 + 2] * l[2] + p[9 + i];
        }
        return out;
    };

    const readObject = (parent, hiddenAbove, gearAbove) => {
        let name = '';
        let texture = '';
        let texrep = [1, 1];
        let texoff = [0, 0];
        let rot = null;
        let loc = null;
        let crease = 61;
        let verts = null;
        const surfaces = [];
        let kids = 0;
        let line;

        while ((line = next()) !== null) {
            const w = words(line);
            const key = w[0];
            if (key === 'name') name = w[1] || '';
            else if (key === 'data') skipData(parseInt(w[1], 10) || 0);
            else if (key === 'texture') texture = w[1] || '';
            else if (key === 'texrep') texrep = [parseFloat(w[1]), parseFloat(w[2])];
            else if (key === 'texoff') texoff = [parseFloat(w[1]), parseFloat(w[2])];
            else if (key === 'rot') rot = w.slice(1, 10).map(parseFloat);
            else if (key === 'loc') loc = w.slice(1, 4).map(parseFloat);
            else if (key === 'crease') crease = parseFloat(w[1]);
            else if (key === 'numvert') {
                const n = parseInt(w[1], 10);
                verts = new Float64Array(n * 3);
                for (let i = 0; i < n; i++) {
                    const v = next().split(/\s+/);
                    verts[i * 3] = +v[0];
                    verts[i * 3 + 1] = +v[1];
                    verts[i * 3 + 2] = +v[2];
                }
            } else if (key === 'numsurf') {
                const n = parseInt(w[1], 10);
                for (let s = 0; s < n; s++) {
                    let flags = 0, mat = 0, refs = null;
                    let l2;
                    while ((l2 = next()) !== null) {
                        const w2 = l2.split(/\s+/);
                        if (w2[0] === 'SURF') flags = parseInt(w2[1], 16) || 0;
                        else if (w2[0] === 'mat') mat = parseInt(w2[1], 10) || 0;
                        else if (w2[0] === 'refs') {
                            const count = parseInt(w2[1], 10);
                            refs = new Array(count);
                            for (let r = 0; r < count; r++) {
                                const rv = next().split(/\s+/);
                                refs[r] = [parseInt(rv[0], 10), +rv[1] || 0, +rv[2] || 0];
                            }
                            break;
                        }
                    }
                    surfaces.push({ flags, mat, refs });
                }
            } else if (key === 'kids') {
                kids = parseInt(w[1], 10) || 0;
                break;
            }
        }

        const world = compose(parent, rot, loc);
        const hidden = hiddenAbove || HIDDEN_OBJECT.test(name);
        const gear = gearAbove || GEAR_OBJECT.test(name);
        if (!hidden && verts && surfaces.length) {
            emit(world, verts, surfaces, texture, texrep, texoff, crease, gear);
        }
        for (let k = 0; k < kids; k++) readObject(world, hidden, gear);
    };

    const emit = (m, verts, surfaces, texture, texrep, texoff, crease, gear) => {
        // Vertices into the parent frame once.
        const n = verts.length / 3;
        const v = new Float64Array(verts.length);
        for (let i = 0; i < n; i++) {
            const x = verts[i * 3], y = verts[i * 3 + 1], z = verts[i * 3 + 2];
            v[i * 3] = m[0] * x + m[1] * y + m[2] * z + m[9];
            v[i * 3 + 1] = m[3] * x + m[4] * y + m[5] * z + m[10];
            v[i * 3 + 2] = m[6] * x + m[7] * y + m[8] * z + m[11];
        }

        // Triangles (a fan per polygon) and their face normals.
        const tris = [];
        for (const s of surfaces) {
            if ((s.flags & 0xf) !== SURF_POLYGON || !s.refs || s.refs.length < 3) continue;
            const r = s.refs;
            for (let k = 1; k < r.length - 1; k++) {
                const a = r[0], b = r[k], c = r[k + 1];
                if (a[0] >= n || b[0] >= n || c[0] >= n) continue;
                const ax = v[a[0] * 3], ay = v[a[0] * 3 + 1], az = v[a[0] * 3 + 2];
                const ux = v[b[0] * 3] - ax, uy = v[b[0] * 3 + 1] - ay, uz = v[b[0] * 3 + 2] - az;
                const wx = v[c[0] * 3] - ax, wy = v[c[0] * 3 + 1] - ay, wz = v[c[0] * 3 + 2] - az;
                let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
                const len = Math.hypot(nx, ny, nz);
                if (!(len > 0)) continue;
                nx /= len; ny /= len; nz /= len;
                tris.push({ refs: [a, b, c], n: [nx, ny, nz], area: len, smooth: !!(s.flags & SURF_SMOOTH), mat: s.mat });
            }
        }
        if (!tris.length) return;

        // Smooth normals: each corner takes the faces round its vertex that
        // are within the crease angle of its own.
        const around = new Array(n);
        for (const t of tris) {
            if (!t.smooth) continue;
            for (const r of t.refs) (around[r[0]] || (around[r[0]] = [])).push(t);
        }
        const cosCrease = Math.cos((Math.min(Math.max(crease, 0), 180)) * Math.PI / 180);

        const out = builder(texture, gear);
        for (const t of tris) {
            const mat = materials[t.mat] || materials[0] || { rgb: [1, 1, 1] };
            for (const r of t.refs) {
                const i = r[0];
                const x = v[i * 3], y = v[i * 3 + 1], z = v[i * 3 + 2];
                out.position.push(x, y, z);
                if (x < min[0]) min[0] = x; if (x > max[0]) max[0] = x;
                if (y < min[1]) min[1] = y; if (y > max[1]) max[1] = y;
                if (z < min[2]) min[2] = z; if (z > max[2]) max[2] = z;

                let nx = t.n[0], ny = t.n[1], nz = t.n[2];
                if (t.smooth && around[i]) {
                    nx = 0; ny = 0; nz = 0;
                    for (const o of around[i]) {
                        if (o.n[0] * t.n[0] + o.n[1] * t.n[1] + o.n[2] * t.n[2] < cosCrease) continue;
                        nx += o.n[0] * o.area; ny += o.n[1] * o.area; nz += o.n[2] * o.area;
                    }
                    const len = Math.hypot(nx, ny, nz) || 1;
                    nx /= len; ny /= len; nz /= len;
                }
                out.normal.push(nx, ny, nz);
                out.uv.push(r[1] * texrep[0] + texoff[0], r[2] * texrep[1] + texoff[1]);
                out.color.push(mat.rgb[0], mat.rgb[1], mat.rgb[2]);
            }
        }
    };

    let line;
    while ((line = next()) !== null) {
        const w = words(line);
        if (w[0] === 'MATERIAL') {
            const at2 = (key, count) => {
                const i = w.indexOf(key);
                return i < 0 ? null : w.slice(i + 1, i + 1 + count).map(parseFloat);
            };
            materials.push({ rgb: at2('rgb', 3) || [1, 1, 1], trans: (at2('trans', 1) || [0])[0] });
        } else if (w[0] === 'OBJECT') {
            readObject([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], false, false);
        }
    }

    const parts = [];
    for (const b of groups.values()) {
        parts.push({
            texture: b.texture,
            gear: b.gear,
            position: new Float32Array(b.position),
            normal: new Float32Array(b.normal),
            uv: new Float32Array(b.uv),
            color: new Float32Array(b.color)
        });
    }
    return { parts, min, max };
}
