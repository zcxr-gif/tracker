/**
 * imageAdjuster.js
 *
 * The "move and scale" step between picking a picture and uploading it, the
 * way a phone's contact photo editor works: the picture sits behind a fixed
 * frame (a circle for a profile picture, a wide strip for a banner) and the
 * pilot drags it into place and zooms with the slider, the mouse wheel or a
 * pinch. What is inside the frame is what gets uploaded, so the saved file is
 * already the right shape everywhere it is shown.
 *
 *   const crop = await adjustImage(decoded, { shape: 'circle', aspect: 1 });
 *   // null when cancelled, else { sx, sy, sw, sh } in source pixels
 *
 * Tall frames (aspect < 1, the flight window's photo) are sized to the screen
 * height rather than the dialog width. Options for that case:
 *
 *   guide: 'window'   a faint sketch of the flight window over the frame,
 *                     so the pilot can see where the text and cards sit
 *   dim: { value, rgb } a Dim slider (20–90) laying the window colour over
 *                     the picture, as the window will; the result carries
 *                     the chosen value as crop.dim
 *   start: { sx, sy, sw, sh }  open on an earlier crop, to re-adjust it
 *
 * `decoded` is { width, height, source } where source is anything drawImage
 * takes (an ImageBitmap or a decoded <img>).
 */

const MAX_ZOOM = 5;
const PREVIEW_LONGEST = 2048; // the on-screen copy; the upload uses the original

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

export function adjustImage(decoded, { shape = 'rect', aspect = 1, title = 'Adjust', saveLabel = 'Save', guide = null, dim = null, start = null } = {}) {
    injectStyles();
    return new Promise(resolve => {
        const { width: iw, height: ih } = decoded;

        const overlay = document.createElement('div');
        overlay.className = 'iadj-overlay';
        overlay.innerHTML = `
            <div class="iadj" role="dialog" aria-modal="true" aria-label="${title}">
                <div class="iadj-head">
                    <button type="button" class="iadj-link" data-act="cancel">Cancel</button>
                    <strong>${title}</strong>
                    <button type="button" class="iadj-link iadj-save" data-act="save">${saveLabel}</button>
                </div>
                <div class="iadj-stage iadj-${shape}${aspect < 1 ? ' iadj-tall' : ''}" style="aspect-ratio: ${aspect}" tabindex="0"
                     aria-label="Drag to reposition. Arrow keys move, plus and minus zoom.">
                    <canvas class="iadj-img"></canvas>
                    ${dim ? `<span class="iadj-tint" aria-hidden="true" style="--iadj-rgb: ${dim.rgb || '22,24,28'}"></span>` : ''}
                    ${guide === 'window' ? `<span class="iadj-guide" aria-hidden="true">
                        <i class="g-hero"></i><i class="g-title"></i><i class="g-sub"></i><i class="g-route"></i>
                        <i class="g-card"></i><i class="g-card"></i><i class="g-card"></i><i class="g-card"></i>
                    </span>` : ''}
                    <span class="iadj-frame" aria-hidden="true"></span>
                    <span class="iadj-grid" aria-hidden="true"></span>
                </div>
                <div class="iadj-controls">
                    <i class="fa-solid fa-image iadj-small" aria-hidden="true"></i>
                    <input type="range" class="iadj-zoom" min="1" max="${MAX_ZOOM}" step="0.01" value="1" aria-label="Zoom">
                    <i class="fa-solid fa-image" aria-hidden="true"></i>
                    <button type="button" class="iadj-reset" data-act="reset" title="Reset">
                        <i class="fa-solid fa-rotate-left"></i><span>Reset</span>
                    </button>
                </div>
                ${dim ? `<label class="iadj-controls iadj-dim"><span>Dim</span>
                    <input type="range" class="iadj-dim-range" min="20" max="90" step="5" value="${clamp(Number(dim.value) || 60, 20, 90)}" aria-label="Dim">
                    <output>${clamp(Number(dim.value) || 60, 20, 90)}%</output></label>` : ''}
                ${guide === 'window' ? `<label class="iadj-guide-toggle"><input type="checkbox" checked> Show where the window's text sits</label>` : ''}
                <p class="iadj-hint">Drag to move · scroll, pinch or use the slider to zoom</p>
            </div>`;
        document.body.appendChild(overlay);

        const stage = overlay.querySelector('.iadj-stage');
        const canvas = overlay.querySelector('.iadj-img');
        const slider = overlay.querySelector('.iadj-zoom');

        // A downscaled copy to move around; the crop is still in source pixels.
        const pv = Math.min(1, PREVIEW_LONGEST / Math.max(iw, ih));
        canvas.width = Math.max(1, Math.round(iw * pv));
        canvas.height = Math.max(1, Math.round(ih * pv));
        canvas.getContext('2d').drawImage(decoded.source, 0, 0, canvas.width, canvas.height);

        // State: zoom (1 = the picture just covers the frame) and the source
        // point at the frame's centre. Kept in source pixels so a resize or
        // rotation of the phone doesn't move anything.
        let zoom = 1, cx = iw / 2, cy = ih / 2;
        let opened = !start;      // an earlier crop is applied on the first draw, once the frame has a size

        const tint = overlay.querySelector('.iadj-tint');
        const dimRange = overlay.querySelector('.iadj-dim-range');
        const paintDim = () => {
            if (!tint || !dimRange) return;
            tint.style.opacity = String(Number(dimRange.value) / 100);
            dimRange.parentElement.querySelector('output').textContent = dimRange.value + '%';
        };
        dimRange?.addEventListener('input', paintDim);
        paintDim();
        overlay.querySelector('.iadj-guide-toggle input')?.addEventListener('change', (e) => {
            overlay.querySelector('.iadj-guide')?.classList.toggle('is-off', !e.target.checked);
        });

        const frame = () => ({ W: stage.clientWidth, H: stage.clientHeight });
        const scale = () => { const { W, H } = frame(); return Math.max(W / iw, H / ih) * zoom; };
        const settle = () => {
            const { W, H } = frame(), s = scale();
            const hw = W / s / 2, hh = H / s / 2;
            cx = clamp(cx, hw, iw - hw);
            cy = clamp(cy, hh, ih - hh);
        };
        const draw = () => {
            if (!opened) {
                const { W, H } = frame();
                if (W && H && start.sw > 0 && start.sh > 0) {
                    const base = Math.max(W / iw, H / ih);
                    zoom = clamp((W / start.sw) / base, 1, MAX_ZOOM);
                    cx = start.sx + start.sw / 2;
                    cy = start.sy + start.sh / 2;
                    opened = true;
                }
            }
            settle();
            const { W, H } = frame(), s = scale();
            const x = W / 2 - cx * s, y = H / 2 - cy * s;
            canvas.style.width = `${iw * s}px`;
            canvas.style.height = `${ih * s}px`;
            canvas.style.transform = `translate(${x}px, ${y}px)`;
            slider.value = String(zoom);
        };
        // Zoom keeping the source point under (px, py) — stage pixels — still.
        const zoomTo = (z, px, py) => {
            const { W, H } = frame();
            if (px == null) { px = W / 2; py = H / 2; }
            const s0 = scale();
            const ax = cx + (px - W / 2) / s0, ay = cy + (py - H / 2) / s0;
            zoom = clamp(z, 1, MAX_ZOOM);
            const s1 = scale();
            cx = ax - (px - W / 2) / s1;
            cy = ay - (py - H / 2) / s1;
            draw();
        };
        const pan = (dx, dy) => { const s = scale(); cx -= dx / s; cy -= dy / s; draw(); };

        // Pointers: one drags, two pinch. Works for mouse, pen and touch.
        const pts = new Map();
        let pinch = null;
        const local = e => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
        stage.addEventListener('pointerdown', e => {
            try { stage.setPointerCapture(e.pointerId); } catch (_) { /* pointer already gone */ }
            pts.set(e.pointerId, local(e));
            stage.classList.add('is-dragging');
            if (pts.size === 2) {
                const [a, b] = [...pts.values()];
                pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, z: zoom };
            }
        });
        stage.addEventListener('pointermove', e => {
            const prev = pts.get(e.pointerId);
            if (!prev) return;
            const cur = local(e);
            pts.set(e.pointerId, cur);
            if (pts.size >= 2 && pinch) {
                const [a, b] = [...pts.values()];
                const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
                zoomTo(pinch.z * d / pinch.d, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
            } else if (pts.size === 1) {
                pan(cur[0] - prev[0], cur[1] - prev[1]);
            }
        });
        const lift = e => {
            pts.delete(e.pointerId);
            if (pts.size < 2) pinch = null;
            if (!pts.size) stage.classList.remove('is-dragging');
        };
        stage.addEventListener('pointerup', lift);
        stage.addEventListener('pointercancel', lift);
        stage.addEventListener('wheel', e => {
            e.preventDefault();
            const [px, py] = local(e);
            zoomTo(zoom * Math.exp(-e.deltaY * 0.0015), px, py);
        }, { passive: false });
        stage.addEventListener('keydown', e => {
            const step = e.shiftKey ? 40 : 10;
            const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
            if (moves[e.key]) { e.preventDefault(); pan(...moves[e.key]); }
            else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomTo(zoom * 1.1); }
            else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomTo(zoom / 1.1); }
        });
        slider.addEventListener('input', () => zoomTo(Number(slider.value)));

        const onResize = () => draw();
        const onKey = e => {
            if (e.key === 'Escape') { e.preventDefault(); finish(false); }
            else if (e.key === 'Enter' && e.target?.tagName !== 'BUTTON') { e.preventDefault(); finish(true); }
        };
        window.addEventListener('resize', onResize);
        document.addEventListener('keydown', onKey);

        const finish = save => {
            window.removeEventListener('resize', onResize);
            document.removeEventListener('keydown', onKey);
            let crop = null;
            if (save) {
                settle();
                const { W, H } = frame(), s = scale();
                const sw = Math.min(iw, W / s), sh = Math.min(ih, H / s);
                crop = {
                    sx: clamp(cx - sw / 2, 0, iw - sw), sy: clamp(cy - sh / 2, 0, ih - sh), sw, sh,
                };
                if (dimRange) crop.dim = Number(dimRange.value);
            }
            overlay.remove();
            resolve(crop);
        };
        overlay.addEventListener('click', e => {
            const act = e.target.closest('[data-act]')?.dataset.act;
            if (act === 'cancel') finish(false);
            else if (act === 'save') finish(true);
            else if (act === 'reset') { zoom = 1; cx = iw / 2; cy = ih / 2; draw(); }
            else if (e.target === overlay) finish(false);
        });

        draw();
        stage.focus({ preventScroll: true });
    });
}

function injectStyles() {
    if (document.getElementById('iadj-styles')) return;
    const style = document.createElement('style');
    style.id = 'iadj-styles';
    style.textContent = `
        .iadj-overlay {
            /* Above every sheet that can open it, the first-run gate included. */
            position: fixed; inset: 0; z-index: 2147483600; display: grid; place-items: center; padding: 16px;
            background: rgba(0,0,0,.72); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
        }
        .iadj {
            width: min(560px, 100%); background: #1c1c1e; color: #f2f2f7; border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,.5); overflow: hidden;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        }
        .iadj-head {
            display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
            padding: 12px 14px; border-bottom: 1px solid rgba(255,255,255,.08); font-size: .95rem;
        }
        .iadj-head .iadj-link:first-child { justify-self: start; }
        .iadj-head .iadj-save { justify-self: end; font-weight: 700; }
        .iadj-head strong { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .iadj-link {
            background: none; border: 0; color: #0a84ff; font: inherit; cursor: pointer;
            padding: 6px 4px; min-height: 36px;
        }
        .iadj-stage {
            position: relative; width: 100%; overflow: hidden; background: #000;
            cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; outline: none;
        }
        .iadj-stage.iadj-circle { width: min(360px, 100% - 32px); margin: 16px auto 0; border-radius: 12px; }
        /* Tall frames fit the screen's height, not the dialog's width. */
        .iadj-stage.iadj-tall { width: auto; height: min(56vh, 520px); max-width: calc(100% - 32px); margin: 16px auto 0; border-radius: 14px; }
        .iadj-tint { position: absolute; inset: 0; pointer-events: none; background: rgb(var(--iadj-rgb)); }
        .iadj-guide { position: absolute; inset: 0; pointer-events: none; display: flex; flex-direction: column; gap: 3.2%; padding: 0 6% 6%; transition: opacity .2s ease; }
        .iadj-guide.is-off { opacity: 0; }
        .iadj-guide i { display: block; border-radius: 6px; background: rgba(255,255,255,.16); box-shadow: inset 0 0 0 1px rgba(255,255,255,.28); }
        .iadj-guide .g-hero { height: 30%; margin: 0 -6.4%; border-radius: 0; background: none; box-shadow: inset 0 -1px 0 rgba(255,255,255,.35); }
        .iadj-guide .g-title { height: 4.5%; width: 46%; }
        .iadj-guide .g-sub { height: 2.4%; width: 30%; margin-top: -1.6%; }
        .iadj-guide .g-route { height: 6%; border-radius: 999px; }
        .iadj-guide .g-card { flex: 1; }
        .iadj-dim { padding-top: 10px; font-size: .82rem; color: #c7c7cc; }
        .iadj-dim output { width: 38px; text-align: right; font-variant-numeric: tabular-nums; }
        .iadj-dim-range { flex: 1; min-width: 0; accent-color: #0a84ff; height: 28px; }
        .iadj-guide-toggle { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 8px 16px 0; font-size: .78rem; color: #aeaeb2; cursor: pointer; }
        .iadj-stage:focus-visible { box-shadow: 0 0 0 2px #0a84ff inset; }
        .iadj-stage.is-dragging { cursor: grabbing; }
        .iadj-img { position: absolute; left: 0; top: 0; transform-origin: 0 0; pointer-events: none; }
        .iadj-frame { position: absolute; inset: 0; pointer-events: none; box-shadow: 0 0 0 2px rgba(255,255,255,.85) inset; }
        /* The circle: everything outside it is dimmed, like the phone editors. */
        .iadj-circle .iadj-frame { border-radius: 50%; box-shadow: 0 0 0 2px rgba(255,255,255,.85) inset, 0 0 0 999px rgba(0,0,0,.55); }
        .iadj-grid {
            position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity .15s ease;
            background:
                linear-gradient(90deg, transparent calc(33.333% - .5px), rgba(255,255,255,.35) 0, rgba(255,255,255,.35) calc(33.333% + .5px), transparent 0,
                                       transparent calc(66.666% - .5px), rgba(255,255,255,.35) 0, rgba(255,255,255,.35) calc(66.666% + .5px), transparent 0),
                linear-gradient(180deg, transparent calc(33.333% - .5px), rgba(255,255,255,.35) 0, rgba(255,255,255,.35) calc(33.333% + .5px), transparent 0,
                                        transparent calc(66.666% - .5px), rgba(255,255,255,.35) 0, rgba(255,255,255,.35) calc(66.666% + .5px), transparent 0);
        }
        .iadj-stage.is-dragging .iadj-grid { opacity: 1; }
        .iadj-controls { display: flex; align-items: center; gap: 10px; padding: 16px 16px 4px; }
        .iadj-controls .fa-image { opacity: .7; }
        .iadj-controls .iadj-small { font-size: .7rem; }
        .iadj-zoom { flex: 1; min-width: 0; accent-color: #0a84ff; height: 28px; }
        .iadj-reset {
            display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 10px; border-radius: 8px;
            background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12); color: inherit;
            font: inherit; font-size: .8rem; cursor: pointer;
        }
        .iadj-hint { margin: 4px 16px 14px; font-size: .75rem; color: #8e8e93; text-align: center; }
        @media (max-width: 480px) { .iadj-reset span { display: none; } .iadj-stage.iadj-tall { height: min(50vh, 460px); } }
    `;
    document.head.appendChild(style);
}
