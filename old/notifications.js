// notifications.js — Inflight's notification centre.
//
// Replaces Toastify (a CDN dependency whose look never matched the app) with a
// self-contained, native-feeling notification system.
//
// What a notification here does that a toast didn't:
//   • It belongs to the app. Glass, accent-coloured rails, an icon per kind,
//     and a title/body split when there's something worth splitting.
//   • It behaves on a phone. It sits above the iOS tab bar, respects the safe
//     area, and can be swiped away — the previous toasts landed under the map
//     chrome and could only be dismissed with a small × .
//   • It doesn't repeat itself. An identical message that fires again bumps a
//     counter on the existing card and restarts its timer, instead of stacking
//     five copies of "Slow connection".
//   • It can be updated or held open. notify() returns a handle, so a caller
//     can show "Uploading…" with no timeout and later resolve it to
//     "Uploaded" — which a fire-and-forget toast could never do.
//   • It's accessible. Errors assert politely through role="alert", everything
//     else through role="status", and it honours prefers-reduced-motion.
//
// Public API (window.InflightNotify):
//   notify(message, type, opts) -> handle
//   success/error/warning/info/loading(message, opts) -> handle
//   handle.update({ message, type, title, timeout })
//   handle.dismiss()
//   dismissAll()
//
// opts: { title, timeout (ms; 0 = sticky), action: { label, onClick }, id }
//
// The legacy showNotification(message, type) signature is kept as a thin
// adapter (see flight.js) so existing call sites keep working unchanged.

const TYPES = {
    success: { icon: 'fa-circle-check',        accent: '#34d399', role: 'status' },
    error:   { icon: 'fa-circle-exclamation',  accent: '#f87171', role: 'alert'  },
    warning: { icon: 'fa-triangle-exclamation',accent: '#fbbf24', role: 'alert'  },
    info:    { icon: 'fa-circle-info',         accent: '#60a5fa', role: 'status' },
    loading: { icon: 'fa-circle-notch fa-spin',accent: '#a78bfa', role: 'status' },
};

const DEFAULT_TIMEOUT = { success: 3200, info: 3600, warning: 5000, error: 6000, loading: 0 };
const MAX_VISIBLE = 4;          // beyond this the oldest is retired early
const SWIPE_DISMISS_PX = 70;

let host = null;
let stylesInjected = false;
const live = new Map();         // key -> record

const reduceMotion = () => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (_) { return false; }
};

const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function injectStyles() {
    if (stylesInjected || typeof document === 'undefined') return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.id = 'inflight-notify-styles';
    // NOTE: this is a template literal — never use a backtick or a dollar-brace
    // inside these comments.
    style.textContent = `
        .ifn-host {
            position: fixed; z-index: 99999;
            top: calc(env(safe-area-inset-top, 0px) + 14px);
            right: 14px;
            display: flex; flex-direction: column; gap: 10px;
            width: min(380px, calc(100vw - 28px));
            pointer-events: none;
        }
        .ifn {
            pointer-events: auto; position: relative; overflow: hidden;
            display: flex; align-items: flex-start; gap: 11px;
            padding: 12px 13px; border-radius: 14px;
            background: rgba(18,20,27,0.90);
            -webkit-backdrop-filter: blur(20px) saturate(1.6);
            backdrop-filter: blur(20px) saturate(1.6);
            border: 0.5px solid rgba(255,255,255,0.14);
            box-shadow: 0 10px 34px rgba(0,0,0,0.46), 0 1px 0 rgba(255,255,255,0.06) inset;
            color: #eef1f6;
            font: 500 13.5px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
            transform: translateX(120%);
            opacity: 0;
            transition: transform .38s cubic-bezier(0.16,1,0.3,1), opacity .28s ease, margin .28s ease;
            touch-action: pan-y;
        }
        .ifn.is-in { transform: translateX(0); opacity: 1; }
        .ifn.is-out { transform: translateX(120%); opacity: 0; margin-top: -6px; }
        /* The accent rail is the fastest read of what kind of message this is. */
        .ifn::before {
            content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
            background: var(--ifn-accent, #60a5fa);
        }
        .ifn-icon {
            flex: 0 0 auto; width: 21px; height: 21px; margin-top: 1px;
            display: grid; place-items: center;
            color: var(--ifn-accent, #60a5fa); font-size: 15px;
        }
        .ifn-body { flex: 1 1 auto; min-width: 0; }
        .ifn-title {
            font-weight: 750; font-size: 13.5px; letter-spacing: -0.01em;
            margin: 0 0 2px; color: #fff;
        }
        .ifn-msg { margin: 0; color: rgba(238,241,246,0.82); word-wrap: break-word; }
        .ifn-action {
            margin-top: 9px; padding: 5px 11px; border-radius: 8px; cursor: pointer;
            background: rgba(255,255,255,0.11); border: 0.5px solid rgba(255,255,255,0.14);
            color: #fff; font: 700 12px/1 inherit;
        }
        .ifn-action:hover { background: rgba(255,255,255,0.18); }
        .ifn-close {
            flex: 0 0 auto; background: none; border: 0; cursor: pointer; padding: 2px 3px;
            color: rgba(238,241,246,0.45); font-size: 13px; line-height: 1;
        }
        .ifn-close:hover { color: #fff; }
        /* Repeat counter — one card that counts, rather than five identical cards. */
        .ifn-count {
            display: none; margin-left: 7px; padding: 1px 7px; border-radius: 999px;
            background: rgba(255,255,255,0.14); font-size: 10.5px; font-weight: 800;
            vertical-align: middle;
        }
        .ifn.has-count .ifn-count { display: inline-block; }
        /* Time remaining, so a card that is about to vanish says so. */
        .ifn-progress {
            position: absolute; left: 0; bottom: 0; height: 2px; width: 100%;
            background: var(--ifn-accent, #60a5fa); opacity: 0.5;
            transform-origin: left center; transform: scaleX(1);
        }
        .ifn.is-paused .ifn-progress { animation-play-state: paused !important; }
        @keyframes ifn-drain { from { transform: scaleX(1); } to { transform: scaleX(0); } }

        @media (prefers-reduced-motion: reduce) {
            .ifn { transition: opacity .2s ease; transform: none; }
            .ifn.is-in { transform: none; }
            .ifn.is-out { transform: none; }
            .ifn-progress { animation: none !important; }
        }

        /* Phones: full width at the BOTTOM, clear of the iOS tab bar, and
           swipe-down to dismiss rather than swipe-sideways. Top-right cards
           collided with the map chrome and the notch. */
        @media (max-width: 640px) {
            .ifn-host {
                top: auto; left: 8px; right: 8px; width: auto;
                bottom: calc(max(env(safe-area-inset-bottom, 0px), 4px) + 72px);
                flex-direction: column-reverse;
            }
            .ifn { transform: translateY(140%); padding: 13px 14px; }
            .ifn.is-in { transform: translateY(0); }
            .ifn.is-out { transform: translateY(140%); }
        }`;
    document.head.appendChild(style);
}

function ensureHost() {
    injectStyles();
    if (host && document.body.contains(host)) return host;
    host = document.createElement('div');
    host.className = 'ifn-host';
    host.setAttribute('aria-live', 'polite');
    host.setAttribute('aria-atomic', 'false');
    document.body.appendChild(host);
    return host;
}

const isNarrow = () => {
    try { return window.matchMedia('(max-width: 640px)').matches; }
    catch (_) { return false; }
};

function removeRecord(rec) {
    if (!rec || rec.removed) return;
    rec.removed = true;
    clearTimeout(rec.timer);
    live.delete(rec.key);
    rec.el.classList.remove('is-in');
    rec.el.classList.add('is-out');
    const done = () => { try { rec.el.remove(); } catch (_) {} };
    if (reduceMotion()) setTimeout(done, 200); else setTimeout(done, 400);
}

function startTimer(rec) {
    clearTimeout(rec.timer);
    const bar = rec.el.querySelector('.ifn-progress');
    if (!rec.timeout) {                      // sticky (0) — no countdown at all
        if (bar) bar.style.display = 'none';
        return;
    }
    if (bar) {
        bar.style.display = '';
        // Re-trigger the animation from the start on every restart (a repeat
        // bumping the counter should reset the countdown, not continue it).
        bar.style.animation = 'none';
        void bar.offsetWidth;
        bar.style.animation = `ifn-drain ${rec.timeout}ms linear forwards`;
    }
    rec.timer = setTimeout(() => removeRecord(rec), rec.timeout);
}

function buildCard(rec) {
    const meta = TYPES[rec.type] || TYPES.info;
    const el = document.createElement('div');
    el.className = 'ifn';
    el.style.setProperty('--ifn-accent', meta.accent);
    el.setAttribute('role', meta.role);
    el.innerHTML = `
        <span class="ifn-icon"><i class="fa-solid ${meta.icon}"></i></span>
        <div class="ifn-body">
            ${rec.title ? `<p class="ifn-title">${esc(rec.title)}</p>` : ''}
            <p class="ifn-msg">${esc(rec.message)}<span class="ifn-count">×1</span></p>
            ${rec.action ? `<button type="button" class="ifn-action">${esc(rec.action.label)}</button>` : ''}
        </div>
        <button type="button" class="ifn-close" aria-label="Dismiss">✕</button>
        <div class="ifn-progress"></div>`;

    el.querySelector('.ifn-close').addEventListener('click', () => removeRecord(rec));
    const actionBtn = el.querySelector('.ifn-action');
    if (actionBtn && rec.action) {
        actionBtn.addEventListener('click', () => {
            try { rec.action.onClick && rec.action.onClick(); } catch (_) {}
            removeRecord(rec);
        });
    }

    // Hovering pauses the countdown — you can't read a message that's leaving.
    el.addEventListener('mouseenter', () => {
        el.classList.add('is-paused');
        clearTimeout(rec.timer);
    });
    el.addEventListener('mouseleave', () => {
        el.classList.remove('is-paused');
        if (rec.timeout) startTimer(rec);
    });

    // Swipe to dismiss: sideways on desktop, downward on a phone (where the
    // stack sits at the bottom). Follows the finger, then springs back if the
    // gesture didn't go far enough.
    let startX = 0, startY = 0, dx = 0, dy = 0, dragging = false;
    el.addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        startX = t.clientX; startY = t.clientY; dx = 0; dy = 0; dragging = true;
        el.style.transition = 'none';
        clearTimeout(rec.timer);
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
        if (!dragging) return;
        const t = e.touches[0];
        dx = t.clientX - startX;
        dy = t.clientY - startY;
        if (isNarrow()) el.style.transform = `translateY(${Math.max(0, dy)}px)`;
        else el.style.transform = `translateX(${Math.max(0, dx)}px)`;
    }, { passive: true });
    el.addEventListener('touchend', () => {
        if (!dragging) return;
        dragging = false;
        el.style.transition = '';
        el.style.transform = '';
        const travelled = isNarrow() ? dy : dx;
        if (travelled > SWIPE_DISMISS_PX) removeRecord(rec);
        else if (rec.timeout) startTimer(rec);
    });

    return el;
}

/**
 * Show a notification. Returns a handle so the caller can update or dismiss it.
 *
 * Identical (type + title + message) notifications COALESCE: the existing card
 * gains a counter and its timer restarts, rather than a second card appearing.
 * Pass an explicit `id` to address one deliberately (e.g. to update it later).
 */
function notify(message, type = 'info', opts = {}) {
    if (typeof document === 'undefined') return { dismiss() {}, update() {} };
    const kind = TYPES[type] ? type : 'info';
    const o = opts || {};
    const title = o.title || '';
    const timeout = o.timeout !== undefined
        ? Math.max(0, o.timeout)
        : DEFAULT_TIMEOUT[kind];

    const key = o.id || `${kind}:${title}:${message}`;

    // Repeat of something already on screen — bump and restart, don't stack.
    const existing = live.get(key);
    if (existing && !existing.removed) {
        existing.count += 1;
        const badge = existing.el.querySelector('.ifn-count');
        if (badge) badge.textContent = `×${existing.count}`;
        existing.el.classList.add('has-count');
        existing.timeout = timeout;
        startTimer(existing);
        return existing.handle;
    }

    ensureHost();

    const rec = { key, type: kind, message, title, action: o.action || null, timeout, count: 1, removed: false, timer: null };
    rec.el = buildCard(rec);

    // Newest first on desktop (the host is column-reverse on mobile, so
    // appending there also puts the newest nearest the thumb).
    if (isNarrow()) host.appendChild(rec.el);
    else host.prepend(rec.el);

    live.set(key, rec);

    // Retire the oldest when the stack gets deep — a wall of cards is worse
    // than no cards.
    const cards = [...live.values()];
    if (cards.length > MAX_VISIBLE) {
        for (const old of cards.slice(0, cards.length - MAX_VISIBLE)) removeRecord(old);
    }

    requestAnimationFrame(() => rec.el.classList.add('is-in'));
    startTimer(rec);

    rec.handle = {
        dismiss: () => removeRecord(rec),
        update: (next = {}) => {
            if (rec.removed) return rec.handle;
            if (next.type && TYPES[next.type]) {
                rec.type = next.type;
                const meta = TYPES[next.type];
                rec.el.style.setProperty('--ifn-accent', meta.accent);
                rec.el.setAttribute('role', meta.role);
                const icon = rec.el.querySelector('.ifn-icon i');
                if (icon) icon.className = `fa-solid ${meta.icon}`;
                if (next.timeout === undefined) rec.timeout = DEFAULT_TIMEOUT[next.type];
            }
            if (next.message !== undefined) {
                rec.message = next.message;
                const msgEl = rec.el.querySelector('.ifn-msg');
                if (msgEl) msgEl.innerHTML = `${esc(next.message)}<span class="ifn-count">×${rec.count}</span>`;
            }
            if (next.title !== undefined) {
                rec.title = next.title;
                let titleEl = rec.el.querySelector('.ifn-title');
                if (next.title && !titleEl) {
                    titleEl = document.createElement('p');
                    titleEl.className = 'ifn-title';
                    rec.el.querySelector('.ifn-body').prepend(titleEl);
                }
                if (titleEl) titleEl.textContent = next.title;
            }
            if (next.timeout !== undefined) rec.timeout = Math.max(0, next.timeout);
            startTimer(rec);
            return rec.handle;
        },
    };
    return rec.handle;
}

function dismissAll() {
    [...live.values()].forEach(removeRecord);
}

const api = {
    notify,
    dismissAll,
    success: (m, o) => notify(m, 'success', o),
    error:   (m, o) => notify(m, 'error', o),
    warning: (m, o) => notify(m, 'warning', o),
    info:    (m, o) => notify(m, 'info', o),
    // Sticky by default — a loading notice that vanished on its own would be
    // worse than none. Resolve it with handle.update({ type, message }).
    loading: (m, o) => notify(m, 'loading', { timeout: 0, ...(o || {}) }),
};

if (typeof window !== 'undefined') window.InflightNotify = api;

export const InflightNotify = api;
export default api;
