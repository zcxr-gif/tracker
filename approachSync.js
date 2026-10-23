/**
 * approachSync.js — Approach multiplayer: the host's game state, as messages.
 *
 * The host runs the simulation; guests draw what it sends them. Aircraft and
 * game state are plain objects that point at shared map data (a runway end, a
 * fix, a STAR's legs, a gate) and at each other (follow, give way). Those
 * pointers can't go over the wire, so both sides number the map data the same
 * way (buildRegistry walks the same world in the same order) and a pointer is
 * sent as its number: { $r: 812 }. An aircraft is sent as { $a: id }.
 *
 * Publisher sends only what changed since the last message, key by key; a
 * guest that joins late, or misses a message, asks for the full state.
 */

/**
 * Numbers every object and array reachable from the roots, in a fixed order,
 * from `base` up. `into` extends an existing registry (the taxi map is
 * renumbered when a fuller one arrives; the world never is). `skip` names keys
 * not to follow: caches filled in during play would number differently on
 * each side.
 */
export function buildRegistry(roots, { base = 0, skip = [], into = null } = {}) {
    const ids = new Map(into?.ids), byId = new Map(into?.byId), no = new Set(skip);
    let n = base;
    const walk = (v, depth) => {
        if (!v || typeof v !== 'object' || ids.has(v) || depth > 14 || ArrayBuffer.isView(v)) return;
        ids.set(v, n);
        byId.set(n++, v);
        if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
        if (v instanceof Map) { for (const [k, x] of v) { walk(k, depth + 1); walk(x, depth + 1); } return; }
        if (v instanceof Set) { for (const x of v) walk(x, depth + 1); return; }
        for (const k in v) if (Object.hasOwn(v, k) && !no.has(k)) walk(v[k], depth + 1);
    };
    for (const k of Object.keys(roots)) walk(roots[k], 0);
    return { ids, byId, count: n - base };
}

const round = n => Math.round(n * 1e4) / 1e4;

/**
 * A value as JSON-safe data. ctx: { reg, isAc(o) } — isAc says an object is an
 * aircraft, sent by id. Functions and undefined are dropped; a cycle that isn't
 * through the registry or an aircraft becomes null.
 */
export function encode(v, ctx, depth = 0, seen = new Set()) {
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'number') return Number.isFinite(v) ? round(v) : { $n: Number.isNaN(v) ? 0 : v > 0 ? 1 : -1 };
    if (typeof v !== 'object') return undefined;
    const r = ctx.reg?.ids.get(v);
    if (r != null) return { $r: r };
    if (depth > 0 && ctx.isAc?.(v)) return { $a: v.id };
    if (depth > 12 || seen.has(v) || ArrayBuffer.isView(v)) return null;
    seen.add(v);
    let out;
    const one = x => { const e = encode(x, ctx, depth + 1, seen); return e === undefined ? null : e; };
    if (Array.isArray(v)) out = v.map(one);
    else if (v instanceof Map) out = { $m: [...v].map(([k, x]) => [one(k), one(x)]) };
    else if (v instanceof Set) out = { $s: [...v].map(one) };
    else {
        out = {};
        for (const k in v) {
            if (!Object.hasOwn(v, k)) continue;
            const e = encode(v[k], ctx, depth + 1, seen);
            if (e !== undefined) out[k] = e;
        }
    }
    seen.delete(v);
    return out;
}

/** The other way. ctx: { reg, ac(id) }. */
export function decode(v, ctx) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(x => decode(x, ctx));
    if ('$r' in v) return ctx.reg?.byId.get(v.$r) ?? null;
    if ('$a' in v) return ctx.ac?.(v.$a) ?? null;
    if ('$n' in v) return v.$n > 0 ? Infinity : v.$n < 0 ? -Infinity : NaN;
    if ('$m' in v) return new Map(v.$m.map(([k, x]) => [decode(k, ctx), decode(x, ctx)]));
    if ('$s' in v) return new Set(v.$s.map(x => decode(x, ctx)));
    const o = {};
    for (const k in v) o[k] = decode(v[k], ctx);
    return o;
}

/**
 * The host's side: remembers what each guest already has (as JSON text, key by
 * key) and sends the difference.
 *   diff(aircraft, g, ctx) -> { seq, ac: { id: { set, del } }, order?, g?: { set, del } } or null
 *   full()                 -> the same shape, everything, as of the last diff
 */
export class Publisher {
    constructor({ skipAc = [], skipG = [] } = {}) {
        this.seq = 0;
        this.ac = new Map();      // id -> Map(key -> json)
        this.g = new Map();       // key -> json
        this.order = [];
        this.skipAc = new Set(skipAc);
        this.skipG = new Set(skipG);
    }

    static changes(obj, prev, skip, ctx) {
        let set = null, del = null;
        const seen = new Set();
        for (const k in obj) {
            if (!Object.hasOwn(obj, k) || skip.has(k)) continue;
            const e = encode(obj[k], ctx, 1);
            if (e === undefined) continue;
            seen.add(k);
            const s = JSON.stringify(e);
            if (prev.get(k) !== s) { prev.set(k, s); (set ||= {})[k] = e; }
        }
        for (const k of prev.keys()) if (!seen.has(k)) { prev.delete(k); (del ||= []).push(k); }
        return set || del ? { ...(set ? { set } : {}), ...(del ? { del } : {}) } : null;
    }

    diff(aircraft, g, ctx) {
        const msg = { ac: {} };
        let any = false;
        const ids = aircraft.map(a => a.id);
        for (const a of aircraft) {
            let prev = this.ac.get(a.id);
            if (!prev) this.ac.set(a.id, prev = new Map());
            const c = Publisher.changes(a, prev, this.skipAc, ctx);
            if (c) { msg.ac[a.id] = c; any = true; }
        }
        const live = new Set(ids);
        for (const id of this.ac.keys()) if (!live.has(id)) this.ac.delete(id);
        if (ids.length !== this.order.length || ids.some((id, i) => id !== this.order[i])) { msg.order = ids; this.order = ids; any = true; }
        const gc = Publisher.changes(g, this.g, this.skipG, ctx);
        if (gc) { msg.g = gc; any = true; }
        if (!any) return null;
        msg.seq = ++this.seq;
        return msg;
    }

    full() {
        const back = m => Object.fromEntries([...m].map(([k, s]) => [k, JSON.parse(s)]));
        const ac = {};
        for (const [id, m] of this.ac) ac[id] = { set: back(m) };
        return { seq: this.seq, full: true, order: this.order, ac, g: { set: back(this.g) } };
    }
}

/**
 * The guest's side: applies messages to its own aircraft objects, keeping each
 * one's identity (so a selected aircraft stays selected).
 *   apply(msg, G, reg) -> { aircraft, g }, or { stale } / { missed } (then ask for the full state)
 */
export class Subscriber {
    constructor({ keepAc = [] } = {}) {
        this.seq = null;
        this.byId = new Map();
        this.order = [];
        this.keepAc = new Set(keepAc);
    }

    apply(msg, G, reg) {
        if (msg.full) this.seq = msg.seq;
        else if (this.seq == null || msg.seq <= this.seq) return { stale: true };
        else if (msg.seq !== this.seq + 1) { this.seq = null; return { missed: true }; }
        else this.seq = msg.seq;
        const ctx = { reg, ac: id => this.byId.get(Number(id)) };
        if (msg.full) {
            const live = new Set(msg.order);
            for (const id of this.byId.keys()) if (!live.has(id)) this.byId.delete(id);
        }
        // Every aircraft exists before any value points at one.
        for (const id of msg.order || Object.keys(msg.ac).map(Number)) if (!this.byId.has(id)) this.byId.set(id, { id });
        for (const [id, c] of Object.entries(msg.ac)) {
            const a = this.byId.get(Number(id));
            if (!a) continue;
            if (msg.full) for (const k of Object.keys(a)) if (!this.keepAc.has(k) && !(k in c.set)) delete a[k];
            for (const k in c.set || {}) if (!this.keepAc.has(k)) a[k] = decode(c.set[k], ctx);
            for (const k of c.del || []) if (!this.keepAc.has(k)) delete a[k];
        }
        if (msg.g) {
            for (const k in msg.g.set || {}) G[k] = decode(msg.g.set[k], ctx);
            for (const k of msg.g.del || []) delete G[k];
        }
        if (msg.order) {
            this.order = msg.order;
            const live = new Set(msg.order);
            for (const id of this.byId.keys()) if (!live.has(id)) this.byId.delete(id);
        }
        return { aircraft: this.order.map(id => this.byId.get(id)).filter(Boolean), g: msg.g };
    }
}
