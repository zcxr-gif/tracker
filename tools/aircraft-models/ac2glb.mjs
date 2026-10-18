// ac2glb.mjs — AC3D (FlightGear) → compact glTF binary, exterior only.
//
//   node ac2glb.mjs out.glb part1.ac[@x,y,z] part2.ac[@x,y,z] ...
//
// Parts are placed at the given offset (metres, FlightGear model axes) and
// merged. Lights, glass cones, cockpit/cabin objects, landing gear and line
// surfaces are dropped; window glass is kept as a material named "glass";
// textures are not carried (the result is an unpainted model kit,
// coloured by its materials). AC3D files are y-up like glTF (FlightGear
// rotates them on load), so vertices pass straight through: x aft, y up.
import fs from 'node:fs';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRMeshQuantization } from '@gltf-transform/extensions';
import { weld, simplify, quantize, dedup, prune, join, flatten } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

// Leaves skipped by name: lights and their glass, effects, pick boxes.
const SKIP = /light(?!map)|lenz|lens|cone|beacon|strobe|wiper|cargo_inside|shadow|reflect|glare|logo_?lt|landlt|turnoff|null|proxy|pick|hotspot|chock|choke/i;
// Groups whose whole subtree is the inside of the aeroplane.
const SKIP_TREE = /cockpit|flightdeck|interior|cabin|seat|pilot|crew|panel|instrument|gauge|screen|display|service|ground/i;
// The landing gear, whole: the crew centre shows the aeroplane in flight.
const GEAR = /gear(?!.*door)|wheel|tire|tyre|strut|bogie|axle|brake|oleo|torque|truck|bearing|damper|brace|stay|^[mn]lg(?!.*door)|^mg|^ng(?!ww)/i;
// Clear materials that are window glass, by material or object name.
const GLASS = /window|glass|windshield|windscreen|canopy|cockpit|pane/i;
// Anything else to leave out of one model, from the command line.
const EXTRA = process.env.SKIP_EXTRA ? new RegExp(process.env.SKIP_EXTRA, 'i') : null;

function mat3(r) { return r || [1, 0, 0, 0, 1, 0, 0, 0, 1]; }
function mul(a, b) { // 3x3 row-major
    const o = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    return o;
}
function apply(m, v) { return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]; }

function parseAC(text) {
    const lines = text.split(/\r?\n/);
    let i = 0;
    const materials = [];
    const objects = []; // flattened: {name, verts(world), surfs:[{mat, refs:[vi]}], crease}
    const next = () => lines[i++];
    while (i < lines.length && !lines[i].startsWith('OBJECT')) {
        const l = lines[i++];
        if (l.startsWith('MATERIAL')) {
            const g = (k) => { const m = l.match(new RegExp(k + '\\s+([-\\d.e]+)\\s+([-\\d.e]+)\\s+([-\\d.e]+)')); return m ? [+m[1], +m[2], +m[3]] : [1, 1, 1]; };
            const t = l.match(/trans\s+([-\d.e]+)/);
            const name = (l.match(/MATERIAL\s+"([^"]*)"/) || [])[1] || '';
            materials.push({ name, rgb: g('rgb'), emis: g('emis'), trans: t ? +t[1] : 0 });
        }
    }
    function readObject(parentRot, parentLoc, skipParent) {
        const head = next();
        if (!head || !head.startsWith('OBJECT')) throw new Error('expected OBJECT at line ' + i + ': ' + head);
        const kind = head.split(/\s+/)[1];
        let name = '', rot = null, loc = [0, 0, 0], verts = [], surfs = [], crease = 61, kids = 0;
        for (;;) {
            const l = next();
            if (l == null) break;
            const w = l.trim().split(/\s+/);
            const k = w[0];
            if (k === 'name') name = l.replace(/^name\s+/, '').replace(/"/g, '');
            else if (k === 'data') { const n = +w[1]; let got = 0; while (got < n) { const d = next(); got += d.length + 1; } }
            else if (k === 'rot') rot = w.slice(1, 10).map(Number);
            else if (k === 'loc') loc = w.slice(1, 4).map(Number);
            else if (k === 'crease') crease = +w[1];
            else if (k === 'numvert') { const n = +w[1]; for (let v = 0; v < n; v++) verts.push(next().trim().split(/\s+/).slice(0, 3).map(Number)); }
            else if (k === 'numsurf') {
                const n = +w[1];
                for (let s = 0; s < n; s++) {
                    const flags = parseInt(next().trim().split(/\s+/)[1], 16);
                    let mat = 0, refs = [];
                    for (;;) {
                        const sl = next().trim().split(/\s+/);
                        if (sl[0] === 'mat') mat = +sl[1];
                        else if (sl[0] === 'refs') { const rn = +sl[1]; for (let r = 0; r < rn; r++) refs.push(+next().trim().split(/\s+/)[0]); break; }
                    }
                    surfs.push({ type: flags & 0xF, twoSided: !!(flags & 0x20), mat, refs });
                }
            } else if (k === 'kids') { kids = +w[1]; break; }
        }
        // AC3D: a child's vertices are in its own frame — rot then loc,
        // composed with the parent's.
        const R = mul(mat3(parentRot), mat3(rot));
        const L = [0, 0, 0].map((_, a) => parentLoc[a] + apply(mat3(parentRot), loc)[a]);
        const skipTree = skipParent || SKIP_TREE.test(name) || GEAR.test(name);
        const skip = skipTree || SKIP.test(name) || !!(EXTRA && EXTRA.test(name));
        if (kind === 'poly' && !skip && verts.length && surfs.length) {
            objects.push({ name, crease, verts: verts.map((v) => { const p = apply(R, v); return [p[0] + L[0], p[1] + L[1], p[2] + L[2]]; }), surfs });
        }
        for (let c = 0; c < kids; c++) readObject(R, L, skipTree);
    }
    readObject(null, [0, 0, 0], false);
    return { materials, objects };
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

// A polygon's normal by Newell's method: right for a concave polygon too,
// where the first three corners can turn the wrong way.
function newell(p) {
    const n = [0, 0, 0];
    for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        n[0] += (a[1] - b[1]) * (a[2] + b[2]);
        n[1] += (a[2] - b[2]) * (a[0] + b[0]);
        n[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    return n;
}

// Triangles of a polygon (indices into p), by ear clipping in its own plane:
// a fan from the first corner would spill outside a concave one. Wound
// anticlockwise about n, like the polygon.
function triangulate(p, n) {
    if (p.length === 3) return [[0, 1, 2]];
    const ax = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = norm(cross(n, ax)), v = cross(n, u);
    const q = p.map((pt) => [dot(pt, u), dot(pt, v)]);
    const turn = (a, b, c) => (q[b][0] - q[a][0]) * (q[c][1] - q[a][1]) - (q[b][1] - q[a][1]) * (q[c][0] - q[a][0]);
    const inside = (x, a, b, c) => turn(a, b, x) >= 0 && turn(b, c, x) >= 0 && turn(c, a, x) >= 0;
    const idx = p.map((_, i) => i), tris = [];
    let guard = 0;
    while (idx.length > 3 && guard++ < 4 * p.length) {
        let cut = false;
        for (let i = 0; i < idx.length; i++) {
            const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
            if (turn(a, b, c) <= 0) continue;
            if (idx.some((x) => x !== a && x !== b && x !== c && inside(x, a, b, c))) continue;
            tris.push([a, b, c]); idx.splice(i, 1); cut = true; break;
        }
        if (!cut) break;
    }
    // Whatever would not clip (a polygon that crosses itself): fanned.
    for (let t = 1; t + 1 < idx.length; t++) tris.push([idx[0], idx[t], idx[t + 1]]);
    return tris;
}

// One mesh's worth of triangles per material, with crease-angle normals.
function build(parts) {
    const byMat = new Map(); // key -> {color, pos:[], nrm:[]}
    for (const { ac, R, T } of parts) {
        for (const o of ac.objects) {
            const faces = [];
            for (const s of o.surfs) {
                if (s.type !== 0 || s.refs.length < 3) continue;
                const m = ac.materials[s.mat] || { rgb: [1, 1, 1], trans: 0, emis: [0, 0, 0], name: '' };
                // Clear surfaces: window glass is kept, as glass (the
                // fuselage has holes where it goes); the rest are light
                // cones, glare and halos.
                const glass = m.trans > 0.45 && GLASS.test(m.name + ' ' + o.name);
                if (m.trans > 0.45 && !glass) continue;
                if (m.emis[0] + m.emis[1] + m.emis[2] > 2.4 && /light/i.test(m.name)) continue;
                const p = s.refs.map((r) => o.verts[r]);
                if (p.length < 3 || p.some((x) => !x)) continue;
                const nw = newell(p);
                if (Math.hypot(nw[0], nw[1], nw[2]) < 1e-12) continue;  // no area
                const fn = norm(nw);
                faces.push({ refs: s.refs, n: fn, tris: triangulate(p, fn), m, two: s.twoSided, glass });
            }
            const cosC = Math.cos((Math.min(o.crease || 61, 89) * Math.PI) / 180);
            const touch = new Map();
            faces.forEach((f, fi) => f.refs.forEach((r) => { if (!touch.has(r)) touch.set(r, []); touch.get(r).push(fi); }));
            for (const f of faces) {
                const key = f.glass ? 'glass' : f.m.rgb.map((c) => Math.round(c * 20)).join(',');
                if (!byMat.has(key)) byMat.set(key, { color: f.m.rgb, glass: f.glass, pos: [], nrm: [] });
                const bucket = byMat.get(key);
                const vn = f.refs.map((r) => {
                    let acc = [0, 0, 0];
                    for (const gi of touch.get(r)) { const g = faces[gi]; if (dot(g.n, f.n) >= cosC) acc = [acc[0] + g.n[0], acc[1] + g.n[1], acc[2] + g.n[2]]; }
                    return norm(acc);
                });
                // A surface the model marks two-sided is a plate seen from
                // both sides: it goes in twice, back to back, so that every
                // face seen from behind is the inside of the aeroplane (the
                // crew centre darkens those: a window cut in the skin).
                for (const side of f.two ? [1, -1] : [1]) {
                    for (const tri of f.tris) {
                        for (const k of side > 0 ? tri : [tri[0], tri[2], tri[1]]) {
                            // AC3D is y-up and right-handed, like glTF: no
                            // swap; just the part's place in the aeroplane.
                            const v = apply(R, o.verts[f.refs[k]]);
                            const n = apply(R, vn[k]);
                            bucket.pos.push(v[0] + T[0], v[1] + T[1], v[2] + T[2]);
                            bucket.nrm.push(side * n[0], side * n[1], side * n[2]);
                        }
                    }
                }
            }
        }
    }
    return byMat;
}

/* FlightGear model XML: the model's own .ac (a top-level <path>) and each
 * <model> it pulls in, at its <offsets>. Offsets are in FlightGear's body
 * frame (x aft, y right, z up); in glTF terms that is (x, z, −y). Only the
 * outside of the aeroplane is followed: instruments, the flight deck, the
 * cabin, lights and ground equipment are not. Animations are ignored, so
 * everything sits where it was modelled — gear down, doors shut. */
const SKIP_PATH = /instrument|flightdeck|cockpit|interior|cabin|panel|light|effect|fx\/|ground|service|autopush|pilot|crew|seat|gauge|display|screen|efb|operations|stair|shadow|reflect|livery|liveries|sound|nasal|gear|null\.ac|rat\.ac/i;

function resolve(p, fromFile, root) {
    const m = p.match(/^Aircraft\/[^/]+\/(.*)$/);
    return m ? path.join(root, m[1]) : path.join(path.dirname(fromFile), p);
}

function rotY(d) { const a = d * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
function rotX(d) { const a = d * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }
function rotZ(d) { const a = d * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; }

function expandXML(file, root, R, T, out, depth) {
    if (depth > 6 || !fs.existsSync(file)) return;
    const xml = fs.readFileSync(file, 'latin1').replace(/<!--[\s\S]*?-->/g, '');
    // The model's own geometry: a <path> that is not inside any <model>.
    const outside = xml.replace(/<model>[\s\S]*?<\/model>/g, '').replace(/<animation>[\s\S]*?<\/animation>/g, '');
    const own = (outside.match(/<path>\s*([^<]+?\.ac)\s*<\/path>/) || [])[1];
    if (own && !SKIP_PATH.test(own)) {
        const f = resolve(own, file, root);
        if (fs.existsSync(f)) out.push({ ac: parseAC(fs.readFileSync(f, 'latin1')), R, T, file: f });
    }
    // Top-level <model> blocks (balanced, so nested ones stay with their parent).
    const re = /<\/?model>/g; let depthM = 0, start = -1, m;
    while ((m = re.exec(xml))) {
        if (m[0] === '<model>') { if (depthM++ === 0) start = m.index; }
        else if (--depthM === 0 && start >= 0) {
            const block = xml.slice(start, m.index);
            const inner = block.replace(/<model>[\s\S]*$/, '').length ? block : block;
            const p = (inner.match(/<path>\s*([^<]+?)\s*<\/path>/) || [])[1];
            if (!p || SKIP_PATH.test(p) || /<condition>/.test(block.split('<path>')[0])) continue;
            const num = (k) => { const v = block.match(new RegExp('<' + k + '>\\s*([-\\d.eE]+)\\s*</' + k + '>')); return v ? +v[1] : 0; };
            const off = [num('x-m'), num('z-m'), -num('y-m')];
            const r = mul(rotY(num('heading-deg')), mul(rotZ(-num('pitch-deg')), rotX(num('roll-deg'))));
            const R2 = mul(R, r);
            const T2 = apply(R, off).map((v, a) => v + T[a]);
            const f = resolve(p, file, root);
            if (/\.xml$/i.test(f)) expandXML(f, root, R2, T2, out, depth + 1);
            else if (/\.ac$/i.test(f) && fs.existsSync(f)) out.push({ ac: parseAC(fs.readFileSync(f, 'latin1')), R: R2, T: T2, file: f });
        }
    }
}

async function main() {
    const [out, ...specs] = process.argv.slice(2);
    const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const parts = [];
    for (const s of specs) {
        const [file, root] = s.split('::');
        if (/\.xml$/i.test(file)) expandXML(file, root || path.dirname(file), I, [0, 0, 0], parts, 0);
        else parts.push({ ac: parseAC(fs.readFileSync(file, 'latin1')), R: I, T: [0, 0, 0], file });
    }
    console.log(parts.map((p) => path.basename(p.file)).join(', '));
    const byMat = build(parts);
    const doc = new Document();
    const buf = doc.createBuffer();
    const mesh = doc.createMesh('aircraft');
    let tris = 0;
    for (const [, b] of byMat) {
        if (!b.pos.length) continue;
        tris += b.pos.length / 9;
        const [r, g, bl] = b.color;
        const mat = b.glass
            ? doc.createMaterial('glass').setBaseColorFactor([0.05, 0.07, 0.1, 1]).setRoughnessFactor(0.08).setMetallicFactor(0).setDoubleSided(true)
            : doc.createMaterial().setBaseColorFactor([r, g, bl, 1]).setRoughnessFactor(0.45).setMetallicFactor(0.1).setDoubleSided(true);
        const prim = doc.createPrimitive()
            .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(b.pos)).setBuffer(buf))
            .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(b.nrm)).setBuffer(buf))
            .setMaterial(mat);
        mesh.addPrimitive(prim);
    }
    const node = doc.createNode('aircraft').setMesh(mesh);
    doc.createScene('scene').addChild(node);
    doc.getRoot().getAsset().generator = 'ac2glb (FlightGear AC3D → glTF)';
    await MeshoptSimplifier.ready;
    // Full detail: only a model past 160k triangles is thinned at all.
    const ratio = Math.min(1, 160000 / Math.max(tris, 1));
    await doc.transform(
        weld(),
        dedup(),
        ...(ratio < 1 ? [simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.0015 })] : []),
        prune(),
    );
    await new NodeIO().registerExtensions([KHRMeshQuantization]).write(out, doc);
    console.log(out, Math.round(tris), 'tris in,', Math.round(fs.statSync(out).size / 1024), 'KB out');
}
main().catch((e) => { console.error(e); process.exit(1); });
