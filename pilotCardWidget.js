/**
 * pilotCardWidget.js
 *
 * The pilot card for the flight windows that live in iframes — Simple
 * (flightinfo.html) and Card (embed-flight.html) — so every flight window
 * shows the pilot the way the primary one (flight.js) does: their InFlight
 * banner behind, their picture, their name, and "View profile".
 *
 * The iframes are same-origin, so this imports the same pilotProfiles.js
 * cache the parent uses. Opening the profile is the parent's job: the card
 * posts OPEN_PILOT_PROFILE and flight.js opens UserProfileUI, exactly as the
 * primary window's card does.
 *
 * Both paint functions are idempotent per username: the windows re-render on
 * every telemetry tick and must not rebuild (or flash) the card each time.
 */

import { PilotProfiles } from './pilotProfiles.js';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function initials(name) {
    return String(name || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase();
}

function usable(username) {
    const u = String(username || '').trim();
    return u && !/^(n\/a|unknown|pilot|---)$/i.test(u) ? u : '';
}

function lookup(username, apply) {
    const cached = PilotProfiles.peek(username);
    if (cached !== undefined) apply(cached);
    else PilotProfiles.byIfUsername(username).then(apply);
}

function openProfile(username) {
    try { window.parent.postMessage({ type: 'OPEN_PILOT_PROFILE', username }, '*'); } catch (_) { /* standalone */ }
}

function injectStyles() {
    if (document.getElementById('ipc-styles')) return;
    const style = document.createElement('style');
    style.id = 'ipc-styles';
    style.textContent = `
        .ipc {
            position: relative; isolation: isolate; overflow: hidden;
            display: flex; align-items: center; gap: 12px;
            width: 100%; height: 64px; padding: 0 16px 0 12px; margin: 0;
            border: 0; border-radius: 12px; cursor: pointer; text-align: left;
            font: inherit; color: #fff;
            background: linear-gradient(135deg, #262930 0%, #30343c 100%);
            box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
            transition: filter 0.2s ease;
        }
        .ipc:hover { filter: brightness(1.12); }
        .ipc-banner {
            position: absolute; inset: 0; z-index: -1; border-radius: inherit;
            background-size: cover, cover; background-position: center, center;
            opacity: 0; transition: opacity 0.45s ease;
        }
        .ipc.has-profile .ipc-banner { opacity: 1; }
        .ipc-banner::after {
            content: ''; position: absolute; inset: 0; border-radius: inherit;
            background: linear-gradient(90deg, rgba(0, 0, 0, 0.62) 0%, rgba(0, 0, 0, 0.28) 100%);
        }
        .ipc-avatar, .ipc-mini {
            display: grid; place-items: center; flex: 0 0 auto; overflow: hidden;
            border-radius: 50%; background: #4a505c; color: #fff; font-weight: 800;
        }
        .ipc-avatar {
            width: 40px; height: 40px; font-size: 12px; letter-spacing: 0.02em;
            border: 1.5px solid rgba(255, 255, 255, 0.85); box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
        }
        .ipc-avatar img, .ipc-mini img { width: 100%; height: 100%; object-fit: cover; display: block; animation: ipc-fade 0.35s ease; }
        .ipc-name {
            min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            font-size: 12px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase;
            text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
        }
        .ipc-go {
            margin-left: auto; flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px;
            font-size: 9px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; opacity: 0.75;
        }
        .ipc:hover .ipc-go { opacity: 1; }
        .ipc-mini { width: 18px; height: 18px; font-size: 7px; }
        @keyframes ipc-fade { from { opacity: 0; } to { opacity: 1; } }
    `;
    document.head.appendChild(style);
}

/**
 * The full card into `host`. Hides the host when there is no pilot name.
 */
export function paintPilotCard(host, username) {
    if (!host) return;
    const name = usable(username);
    if (host.dataset.ipcUser === name) return;
    host.dataset.ipcUser = name;
    if (!name) { host.innerHTML = ''; host.style.display = 'none'; return; }
    injectStyles();
    host.style.display = '';
    host.innerHTML = `
        <button type="button" class="ipc" title="View ${esc(name)}'s profile">
            <span class="ipc-banner" aria-hidden="true"></span>
            <span class="ipc-avatar" aria-hidden="true">${esc(initials(name))}</span>
            <span class="ipc-name">${esc(name)}</span>
            <span class="ipc-go" aria-hidden="true">View profile <i class="fa-solid fa-chevron-right"></i></span>
        </button>`;
    const card = host.querySelector('.ipc');
    card.addEventListener('click', (e) => { e.stopPropagation(); openProfile(name); });
    lookup(name, (profile) => {
        if (!profile || host.dataset.ipcUser !== name || !card.isConnected) return;
        const banner = card.querySelector('.ipc-banner');
        banner.style.backgroundImage = profile.bannerUrl
            ? `url("${profile.bannerUrl}"), ${profile.bannerGradient}`
            : profile.bannerGradient;
        card.classList.add('has-profile');
        if (profile.avatarUrl) {
            const img = new Image();
            img.alt = '';
            img.onload = () => {
                const av = card.querySelector('.ipc-avatar');
                if (av && host.dataset.ipcUser === name) { av.textContent = ''; av.appendChild(img); }
            };
            img.src = profile.avatarUrl;
        }
    });
}

/**
 * A small round picture in place of an icon (the windows' compact pilot
 * rows). `el` is the element to turn into the avatar.
 */
export function paintMiniAvatar(el, username) {
    if (!el) return;
    const name = usable(username);
    if (el.dataset.ipcUser === name) return;
    el.dataset.ipcUser = name;
    injectStyles();
    el.classList.add('ipc-mini');
    el.className = el.className.replace(/\bfa-[\w-]+\b/g, '').trim();
    el.textContent = initials(name) || '';
    if (!name) return;
    lookup(name, (profile) => {
        if (!profile?.avatarUrl || el.dataset.ipcUser !== name) return;
        const img = new Image();
        img.alt = '';
        img.onload = () => { if (el.dataset.ipcUser === name) { el.textContent = ''; el.appendChild(img); } };
        img.src = profile.avatarUrl;
    });
}

export { openProfile as openPilotProfileFromFrame };
