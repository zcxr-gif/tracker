/**
 * submitAircraft.js
 *
 * Community aircraft-photo submission, presented as a self-contained modal so
 * it can be launched from anywhere in the tracker without navigating away.
 *
 * The modal (styles + markup) is injected lazily the first time it's opened,
 * so this module costs nothing until the user actually clicks "Submit a photo".
 * It wires the dedicated toolbar button (#toolbar-submit-photo-btn) when the
 * tracker chrome is present, and also powers the standalone submit-aircraft.html
 * page — that page just calls window.InflightAircraftSubmit.open() on load.
 *
 * Public API:
 *   window.InflightAircraftSubmit.open()   -> show the modal
 *   window.InflightAircraftSubmit.close()  -> hide the modal
 *
 * Uploads go to the same backend gates.html / embeds already use.
 */
(function () {
    'use strict';

    // Backend origin (same one gates.html / gallery / embeds already use).
    const BACKEND = 'https://site--indgo-backend--6dmjph8ltlhv.code.run';
    const ENDPOINT = BACKEND + '/api/community/aircraft/submit';
    const MAX_IMAGES = 3;

    let overlayEl = null;   // the full-screen backdrop
    let formEl = null;
    let statusEl = null;
    let fileInputEl = null;
    let previewsEl = null;
    let submitBtnEl = null;

    // ---------------------------------------------------------------------
    // Styles
    // ---------------------------------------------------------------------
    let stylesInjected = false;
    function injectStyles() {
        if (stylesInjected || typeof document === 'undefined') return;
        stylesInjected = true;
        const style = document.createElement('style');
        style.id = 'inflight-acsub-styles';
        style.textContent = `
        :root {
            --acc-a: #f59e0b;   /* amber */
            --acc-b: #f97316;   /* orange */
            --acc-soft: rgba(245, 158, 11, 0.08);
        }
        .acsub-overlay {
            position: fixed; inset: 0; z-index: 20000;
            display: flex; align-items: center; justify-content: center;
            padding: max(env(safe-area-inset-top, 0px), 16px) 16px
                     max(env(safe-area-inset-bottom, 0px), 16px);
            background: rgba(6, 8, 20, 0.62);
            backdrop-filter: blur(6px);
            -webkit-backdrop-filter: blur(6px);
            opacity: 0; visibility: hidden;
            transition: opacity .22s ease, visibility .22s ease;
        }
        .acsub-overlay.visible { opacity: 1; visibility: visible; }

        .acsub-card {
            width: 100%; max-width: 460px;
            max-height: calc(100vh - 32px);
            display: flex; flex-direction: column;
            background: rgba(18, 20, 38, 0.94);
            border: 1px solid rgba(255,255,255,0.10);
            border-radius: 18px;
            box-shadow: 0 24px 60px rgba(0,0,0,0.55);
            color: #e6e9ff;
            font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
            transform: translateY(14px) scale(.98);
            transition: transform .22s ease;
            overflow: hidden;
        }
        .acsub-overlay.visible .acsub-card { transform: translateY(0) scale(1); }

        .acsub-head {
            display: flex; align-items: flex-start; gap: 12px;
            padding: 20px 22px 14px;
            border-bottom: 1px solid rgba(255,255,255,0.07);
        }
        .acsub-head-icon {
            flex: 0 0 auto; width: 40px; height: 40px; border-radius: 12px;
            display: grid; place-items: center; font-size: 1.05rem;
            color: #fff; background: linear-gradient(135deg, var(--acc-a), var(--acc-b));
        }
        .acsub-head-text { flex: 1 1 auto; min-width: 0; }
        .acsub-head-text h3 { margin: 0; font-size: 1.12rem; font-weight: 700; letter-spacing: -.01em; }
        .acsub-head-text p { margin: 3px 0 0; font-size: .82rem; color: #9aa2c9; line-height: 1.35; }
        .acsub-close {
            flex: 0 0 auto; width: 32px; height: 32px; border-radius: 50%;
            border: 1px solid rgba(255,255,255,0.10); background: rgba(255,255,255,0.05);
            color: #c5cae9; font-size: 1rem; cursor: pointer; line-height: 1;
            display: grid; place-items: center; transition: background .15s ease, color .15s ease;
        }
        .acsub-close:hover { background: rgba(255,255,255,0.14); color: #fff; }

        .acsub-body { padding: 16px 22px 4px; overflow-y: auto; }

        .acsub-field { display: block; margin-bottom: 14px; }
        .acsub-field > span {
            display: block; font-size: .74rem; font-weight: 600;
            text-transform: uppercase; letter-spacing: .04em;
            color: #9aa2c9; margin-bottom: 6px;
        }
        .acsub-field > span .req { color: #ff6b81; margin-left: 2px; }
        .acsub-input {
            width: 100%; box-sizing: border-box;
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 10px; color: #fff;
            padding: 10px 12px; font-size: .92rem;
            transition: border-color .15s ease, background .15s ease;
        }
        .acsub-input::placeholder { color: #6b73a0; }
        .acsub-input:focus {
            outline: none; border-color: var(--acc-a);
            background: var(--acc-soft);
        }

        /* Drop zone */
        .acsub-drop {
            position: relative; display: block; cursor: pointer;
            border: 1.5px dashed rgba(255,255,255,0.20);
            border-radius: 12px; padding: 20px 16px; text-align: center;
            transition: border-color .15s ease, background .15s ease;
        }
        .acsub-drop:hover, .acsub-drop.dragover {
            border-color: var(--acc-a); background: var(--acc-soft);
        }
        .acsub-drop input[type="file"] {
            position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%;
        }
        .acsub-drop-icon { font-size: 1.5rem; color: var(--acc-a); }
        .acsub-drop-title { margin-top: 6px; font-size: .9rem; font-weight: 600; color: #e6e9ff; }
        .acsub-drop-sub { margin-top: 2px; font-size: .76rem; color: #9aa2c9; }

        .acsub-previews {
            display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px;
        }
        .acsub-previews:empty { display: none; }
        .acsub-thumb {
            position: relative; width: 72px; height: 72px; border-radius: 10px;
            overflow: hidden; border: 1px solid rgba(255,255,255,0.12);
            background: #0c0e1f;
        }
        .acsub-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .acsub-thumb button {
            position: absolute; top: 3px; right: 3px;
            width: 20px; height: 20px; border-radius: 50%;
            border: none; background: rgba(0,0,0,0.65); color: #fff;
            font-size: .75rem; line-height: 1; cursor: pointer; display: grid; place-items: center;
        }
        .acsub-thumb button:hover { background: #ff4757; }

        .acsub-foot {
            padding: 12px 22px 20px;
            border-top: 1px solid rgba(255,255,255,0.07);
        }
        .acsub-submit {
            width: 100%; border: none; cursor: pointer;
            padding: 12px 16px; border-radius: 11px;
            font-size: .96rem; font-weight: 700; color: #fff;
            background: linear-gradient(135deg, var(--acc-a), var(--acc-b));
            transition: filter .15s ease, opacity .15s ease;
        }
        .acsub-submit:hover { filter: brightness(1.08); }
        .acsub-submit:disabled { opacity: .55; cursor: not-allowed; }
        .acsub-status {
            margin: 10px 0 0; font-size: .84rem; text-align: center; min-height: 1.1em;
            color: #9aa2c9; line-height: 1.4;
        }
        .acsub-status.ok { color: #3ddc84; }
        .acsub-status.err { color: #ff6b81; }
        .acsub-link {
            display: block; width: 100%; margin-top: 12px;
            background: none; border: none; cursor: pointer;
            color: #9aa2c9; font-size: .82rem; font-weight: 600;
            transition: color .15s ease;
        }
        .acsub-link:hover { color: var(--acc-a); }
        .acsub-link i { margin-right: 5px; }

        @media (max-width: 420px) {
            .acsub-head, .acsub-body, .acsub-foot { padding-left: 16px; padding-right: 16px; }
        }`;
        document.head.appendChild(style);
    }

    // ---------------------------------------------------------------------
    // Markup
    // ---------------------------------------------------------------------
    function buildModal() {
        if (overlayEl) return;
        injectStyles();

        overlayEl = document.createElement('div');
        overlayEl.className = 'acsub-overlay';
        overlayEl.setAttribute('role', 'dialog');
        overlayEl.setAttribute('aria-modal', 'true');
        overlayEl.setAttribute('aria-label', 'Submit an aircraft photo');
        overlayEl.innerHTML = `
        <div class="acsub-card">
            <div class="acsub-head">
                <div class="acsub-head-icon"><i class="fa-solid fa-camera"></i></div>
                <div class="acsub-head-text">
                    <h3>Submit an aircraft photo</h3>
                    <p>Share a livery with the community. Staff review every submission on Discord before it goes live.</p>
                </div>
                <button type="button" class="acsub-close" aria-label="Close">&times;</button>
            </div>

            <form id="acSubmitForm" enctype="multipart/form-data" novalidate>
                <div class="acsub-body">
                    <label class="acsub-drop" id="acSubDrop">
                        <input type="file" name="images" accept="image/*" multiple required>
                        <div class="acsub-drop-icon"><i class="fa-solid fa-cloud-arrow-up"></i></div>
                        <div class="acsub-drop-title">Tap or drop photos here</div>
                        <div class="acsub-drop-sub">Up to ${MAX_IMAGES} images &middot; JPG, PNG, WEBP</div>
                    </label>
                    <div class="acsub-previews" id="acSubPreviews"></div>

                    <label class="acsub-field" style="margin-top:14px;">
                        <span>Aircraft type<span class="req">*</span></span>
                        <input class="acsub-input" type="text" name="aircraftType" placeholder="e.g. A320neo" required>
                    </label>

                    <label class="acsub-field">
                        <span>Livery<span class="req">*</span></span>
                        <input class="acsub-input" type="text" name="liveryName" placeholder="e.g. IndiGo" required>
                    </label>

                    <label class="acsub-field">
                        <span>Tail number <span style="text-transform:none;font-weight:400;color:#6b73a0;">(optional)</span></span>
                        <input class="acsub-input" type="text" name="tailNumber" placeholder="e.g. VT-IZA">
                    </label>

                    <label class="acsub-field">
                        <span>Your name / credit <span style="text-transform:none;font-weight:400;color:#6b73a0;">(optional)</span></span>
                        <input class="acsub-input" type="text" name="collaboratorName" placeholder="Shown as the contributor">
                    </label>

                    <!-- Populated from the signed-in user's linked Discord ID when known
                         (never typed by the user). When present, credit + contributor role
                         + leaderboard all work natively. Left empty otherwise. -->
                    <input type="hidden" name="collaboratorId" value="">
                </div>

                <div class="acsub-foot">
                    <button type="submit" class="acsub-submit">Submit for review</button>
                    <p id="acSubmitStatus" class="acsub-status" role="status" aria-live="polite"></p>
                    <button type="button" class="acsub-link" id="acSubGalleryLink">
                        <i class="fa-solid fa-images"></i> Browse the community gallery
                    </button>
                </div>
            </form>
        </div>`;

        document.body.appendChild(overlayEl);

        formEl = overlayEl.querySelector('#acSubmitForm');
        statusEl = overlayEl.querySelector('#acSubmitStatus');
        fileInputEl = overlayEl.querySelector('input[name="images"]');
        previewsEl = overlayEl.querySelector('#acSubPreviews');
        submitBtnEl = overlayEl.querySelector('.acsub-submit');
        const dropEl = overlayEl.querySelector('#acSubDrop');

        // Backdrop click + close button + Escape all dismiss.
        overlayEl.addEventListener('click', (e) => {
            if (e.target === overlayEl) close();
        });
        overlayEl.querySelector('.acsub-close').addEventListener('click', close);

        // Drag & drop visual feedback.
        ['dragenter', 'dragover'].forEach(ev =>
            dropEl.addEventListener(ev, (e) => { e.preventDefault(); dropEl.classList.add('dragover'); }));
        ['dragleave', 'drop'].forEach(ev =>
            dropEl.addEventListener(ev, (e) => { e.preventDefault(); dropEl.classList.remove('dragover'); }));

        fileInputEl.addEventListener('change', renderPreviews);
        formEl.addEventListener('submit', onSubmit);

        // Cross-link to the community gallery (opens if that module is present,
        // otherwise falls back to the standalone gallery page).
        const galleryLink = overlayEl.querySelector('#acSubGalleryLink');
        if (galleryLink) galleryLink.addEventListener('click', () => {
            if (window.InflightAircraftGallery && window.InflightAircraftGallery.open) {
                window.InflightAircraftGallery.open();
            } else {
                window.location.href = 'gallery.html';
            }
        });
    }

    // Contributor name is shared with the gallery via localStorage so setting it
    // in one place ("show my work") also credits future submissions.
    const NAME_KEY = 'inflight_contributor_name';
    const savedName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch (_) { return ''; } };
    const saveName = (n) => { try { if (n) localStorage.setItem(NAME_KEY, n); } catch (_) {} };

    const say = (msg, kind) => {
        if (!statusEl) return;
        statusEl.textContent = msg || '';
        statusEl.className = 'acsub-status' + (kind ? ' ' + kind : '');
    };

    // ---------------------------------------------------------------------
    // File previews (with per-thumb remove)
    // ---------------------------------------------------------------------
    function renderPreviews() {
        if (!previewsEl) return;
        previewsEl.innerHTML = '';
        const files = Array.from(fileInputEl.files || []);
        if (files.length > MAX_IMAGES) {
            say('Max ' + MAX_IMAGES + ' photos per submission — extra files will be ignored.', 'err');
        } else {
            say('');
        }
        files.slice(0, MAX_IMAGES).forEach((file, idx) => {
            if (!file.type || !file.type.startsWith('image/')) return;
            const thumb = document.createElement('div');
            thumb.className = 'acsub-thumb';
            const img = document.createElement('img');
            img.alt = file.name;
            const url = URL.createObjectURL(file);
            img.src = url;
            img.onload = () => URL.revokeObjectURL(url);
            const rm = document.createElement('button');
            rm.type = 'button';
            rm.innerHTML = '&times;';
            rm.title = 'Remove';
            rm.addEventListener('click', () => removeFileAt(idx));
            thumb.appendChild(img);
            thumb.appendChild(rm);
            previewsEl.appendChild(thumb);
        });
    }

    // Rebuild the FileList without the removed item (FileList is read-only, so
    // we go through a DataTransfer).
    function removeFileAt(idx) {
        const dt = new DataTransfer();
        Array.from(fileInputEl.files || []).forEach((f, i) => { if (i !== idx) dt.items.add(f); });
        fileInputEl.files = dt.files;
        renderPreviews();
    }

    // ---------------------------------------------------------------------
    // Submit
    // ---------------------------------------------------------------------
    async function onSubmit(e) {
        e.preventDefault();

        const files = fileInputEl.files;
        if (!files || !files.length) return say('Please choose at least one photo.', 'err');
        if (files.length > MAX_IMAGES) return say('Max ' + MAX_IMAGES + ' photos per submission.', 'err');

        // Opportunistically attach the signed-in user's linked Discord ID.
        const linkedId = (window.InflightUser && window.InflightUser.discordId) || '';
        const hiddenId = formEl.querySelector('input[name="collaboratorId"]');
        if (hiddenId && !hiddenId.value && linkedId) hiddenId.value = linkedId;

        // Remember the credit name so the gallery can match "my work" later.
        const creditInput = formEl.querySelector('input[name="collaboratorName"]');
        if (creditInput && creditInput.value.trim()) saveName(creditInput.value.trim());

        // FormData sends every field + all files under "images", exactly what
        // the endpoint expects. Do NOT set Content-Type — the browser adds the
        // multipart boundary.
        const fd = new FormData(formEl);
        fd.set('sourceSite', location.hostname); // optional label shown on the review card

        submitBtnEl.disabled = true;
        say('Uploading…');

        try {
            const res = await fetch(ENDPOINT, { method: 'POST', body: fd });
            const data = await res.json().catch(() => ({}));

            if (res.ok) {
                say('✅ Submitted! Staff will review it on Discord shortly.', 'ok');
                formEl.reset();
                if (previewsEl) previewsEl.innerHTML = '';
                setTimeout(() => { if (overlayEl && overlayEl.classList.contains('visible')) close(); }, 2200);
            } else if (res.status === 403) {
                say('This site isn’t allowed to submit (origin check).', 'err');
            } else if (res.status === 503) {
                say('Review service is waking up — please try again in a moment.', 'err');
            } else {
                say('❌ ' + (data.message || ('Error ' + res.status)), 'err');
            }
        } catch (err) {
            say('Network error — please try again.', 'err');
        } finally {
            submitBtnEl.disabled = false;
        }
    }

    // ---------------------------------------------------------------------
    // Open / close
    // ---------------------------------------------------------------------
    function open() {
        buildModal();
        say('');
        // Prefill credit with the name we already know: the one the user set in
        // the gallery ("my work"), else their signed-in display name.
        const nameInput = formEl && formEl.querySelector('input[name="collaboratorName"]');
        const known = savedName() ||
            (window.InflightUser && (window.InflightUser.displayName || window.InflightUser.username)) || '';
        if (nameInput && !nameInput.value && known) nameInput.value = known;
        requestAnimationFrame(() => overlayEl.classList.add('visible'));
    }

    function close() {
        if (overlayEl) overlayEl.classList.remove('visible');
    }

    // ---------------------------------------------------------------------
    // Toolbar launcher + wiring
    // ---------------------------------------------------------------------
    function wireToolbarButton() {
        const btn = document.getElementById('toolbar-submit-photo-btn');
        if (btn && !btn.dataset.acsubWired) {
            btn.dataset.acsubWired = 'true';
            btn.addEventListener('click', open);
        }
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', wireToolbarButton);
        } else {
            wireToolbarButton();
        }
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlayEl && overlayEl.classList.contains('visible')) close();
        });
    }

    window.InflightAircraftSubmit = { open, close };
})();
