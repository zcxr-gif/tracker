/**
 * threeLoader.js
 * On-demand loader for three.js.
 *
 * three.min.js is ~600 KB of script that only the optional 3D views use
 * (3D flown path, 3D live traffic, ATC-replay free-look). Loading it from a
 * <script defer> tag made every visitor download, parse and execute it before
 * flight.js could boot, even though most sessions never open a 3D view. It is
 * now fetched the first time one of those views asks for it.
 *
 * The 3D modules still read `window.THREE`, so the classic (non-module) build
 * is kept and attaches itself to window as before.
 */

const THREE_URL = 'https://unpkg.com/three@0.126.0/build/three.min.js';

let pending = null;

/**
 * Resolves with `window.THREE`, injecting the script on first call. Concurrent
 * and repeat callers share one request; a failed load clears the memo so the
 * next caller can retry.
 * @returns {Promise<object>}
 */
export function loadThree() {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (pending) return pending;

    pending = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = THREE_URL;
        script.async = true;
        script.onload = () => {
            if (window.THREE) resolve(window.THREE);
            else { pending = null; reject(new Error('three.js loaded without defining THREE')); }
        };
        script.onerror = () => {
            pending = null;
            script.remove();
            reject(new Error('three.js failed to load'));
        };
        document.head.appendChild(script);
    });
    return pending;
}
