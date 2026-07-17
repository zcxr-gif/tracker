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
            --acc-a: #fbbf24;                       /* warm gold */
            --acc-b: #f59e0b;                       /* amber */
            --acc-ink: #241a02;                     /* readable text on gold */
            --acc-soft: rgba(251, 191, 36, 0.10);
            --acc-ring: rgba(251, 191, 36, 0.22);
            --acc-glow: rgba(245, 158, 11, 0.30);
            --acs-surface: rgba(19, 21, 40, 0.98);
            --acs-line: rgba(255, 255, 255, 0.08);
            --acs-t1: #eef0ff;
            --acs-t2: #9aa2c9;
            --acs-t3: #6b7299;
        }
        .acsub-overlay {
            position: fixed; inset: 0; z-index: 20000;
            display: flex; align-items: center; justify-content: center;
            padding: max(env(safe-area-inset-top, 0px), 16px) 16px
                     max(env(safe-area-inset-bottom, 0px), 16px);
            background: radial-gradient(120% 120% at 50% 0%, rgba(24,18,4,0.34), rgba(4,5,14,0.74));
            backdrop-filter: blur(8px) saturate(1.1);
            -webkit-backdrop-filter: blur(8px) saturate(1.1);
            opacity: 0; visibility: hidden;
            transition: opacity .25s ease, visibility .25s ease;
        }
        .acsub-overlay.visible { opacity: 1; visibility: visible; }

        .acsub-card {
            position: relative; width: 100%; max-width: 472px;
            max-height: calc(100dvh - 32px);
            display: flex; flex-direction: column;
            background: var(--acs-surface);
            border: 1px solid var(--acs-line);
            border-radius: 22px;
            box-shadow: 0 30px 80px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4);
            color: var(--acs-t1);
            font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
            transform: translateY(16px) scale(.985); opacity: .5;
            transition: transform .28s cubic-bezier(.16,.84,.44,1), opacity .28s ease;
            overflow: hidden;
        }
        .acsub-overlay.visible .acsub-card { transform: none; opacity: 1; }
        .acsub-card::before {
            content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
            background: linear-gradient(90deg, transparent, var(--acc-a), var(--acc-b), transparent);
        }

        .acsub-head {
            position: relative; display: flex; align-items: center; gap: 14px;
            padding: 24px 56px 20px 24px;
            border-bottom: 1px solid var(--acs-line);
            background: radial-gradient(130% 190% at 92% -50%, rgba(251,191,36,0.13), transparent 62%);
        }
        .acsub-head-icon {
            flex: 0 0 auto; width: 46px; height: 46px; border-radius: 14px;
            display: grid; place-items: center; font-size: 1.15rem; color: var(--acc-a);
            background: var(--acc-soft); border: 1px solid rgba(251,191,36,0.28);
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
        }
        .acsub-head-text { flex: 1 1 auto; min-width: 0; }
        .acsub-head-text h3 { margin: 0; font-size: 1.2rem; font-weight: 750; letter-spacing: -.02em; color: #fff; }
        .acsub-head-text p { margin: 4px 0 0; font-size: .82rem; color: var(--acs-t2); line-height: 1.4; }
        .acsub-close {
            position: absolute; top: 16px; right: 16px;
            width: 32px; height: 32px; border-radius: 50%;
            border: 1px solid var(--acs-line); background: rgba(255,255,255,0.04);
            color: var(--acs-t2); font-size: 1.05rem; cursor: pointer; line-height: 1;
            display: grid; place-items: center; transition: all .18s ease;
        }
        .acsub-close:hover { background: rgba(255,255,255,0.12); color: #fff; transform: rotate(90deg); }

        .acsub-body { padding: 20px 24px 8px; overflow-y: auto; }

        .acsub-field { display: block; margin-bottom: 15px; }
        .acsub-field-label {
            display: flex; align-items: center; gap: 6px;
            font-size: .8rem; font-weight: 600; color: var(--acs-t2); margin-bottom: 7px;
        }
        .acsub-field-label .req { color: var(--acc-a); font-weight: 700; }
        .acsub-field-label .opt { color: var(--acs-t3); font-weight: 400; font-size: .74rem; }
        .acsub-input {
            width: 100%; box-sizing: border-box;
            background: rgba(255,255,255,0.035);
            border: 1px solid rgba(255,255,255,0.10);
            border-radius: 12px; color: #fff;
            padding: 12px 14px; font-size: .92rem; line-height: 1.2;
            transition: border-color .15s ease, background .15s ease, box-shadow .15s ease;
        }
        .acsub-input::placeholder { color: var(--acs-t3); }
        .acsub-input:hover { border-color: rgba(255,255,255,0.18); }
        .acsub-input:focus {
            outline: none; border-color: var(--acc-b);
            background: rgba(251,191,36,0.05); box-shadow: 0 0 0 3px var(--acc-ring);
        }

        /* Drop zone */
        .acsub-drop {
            position: relative; display: flex; flex-direction: column; align-items: center;
            cursor: pointer; text-align: center;
            border: 1.5px dashed rgba(255,255,255,0.18);
            border-radius: 16px; padding: 26px 16px;
            background: rgba(255,255,255,0.02);
            transition: border-color .18s ease, background .18s ease;
        }
        .acsub-drop:hover, .acsub-drop.dragover {
            border-color: var(--acc-b); background: rgba(251,191,36,0.06);
        }
        .acsub-drop input[type="file"] {
            position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%;
        }
        .acsub-drop-icon {
            width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center;
            font-size: 1.25rem; color: var(--acc-a); background: var(--acc-soft);
            border: 1px solid rgba(251,191,36,0.25); margin-bottom: 10px;
            transition: transform .18s ease;
        }
        .acsub-drop:hover .acsub-drop-icon, .acsub-drop.dragover .acsub-drop-icon { transform: translateY(-2px); }
        .acsub-drop-title { font-size: .92rem; font-weight: 650; color: var(--acs-t1); }
        .acsub-drop-title b { color: var(--acc-a); font-weight: 700; }
        .acsub-drop-sub { margin-top: 3px; font-size: .76rem; color: var(--acs-t2); }

        .acsub-previews {
            display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px;
        }
        .acsub-previews:empty { display: none; }
        .acsub-thumb {
            position: relative; width: 76px; height: 76px; border-radius: 12px;
            overflow: hidden; border: 1px solid rgba(255,255,255,0.12);
            background: #0c0e1f; box-shadow: 0 4px 12px rgba(0,0,0,0.35);
        }
        .acsub-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .acsub-thumb button {
            position: absolute; top: 4px; right: 4px;
            width: 20px; height: 20px; border-radius: 50%;
            border: none; background: rgba(0,0,0,0.7); color: #fff;
            font-size: .78rem; line-height: 1; cursor: pointer; display: grid; place-items: center;
            transition: background .15s ease;
        }
        .acsub-thumb button:hover { background: #fb7185; }

        .acsub-foot { padding: 8px 24px 22px; }
        .acsub-submit {
            width: 100%; border: none; cursor: pointer;
            padding: 14px 16px; border-radius: 13px;
            font-size: .98rem; font-weight: 700; color: var(--acc-ink); letter-spacing: .01em;
            background: linear-gradient(135deg, var(--acc-a), var(--acc-b));
            box-shadow: 0 10px 24px var(--acc-glow);
            display: flex; align-items: center; justify-content: center; gap: 8px;
            transition: transform .15s ease, box-shadow .15s ease, filter .15s ease;
        }
        .acsub-submit:hover { transform: translateY(-1px); box-shadow: 0 14px 30px var(--acc-glow); filter: brightness(1.04); }
        .acsub-submit:active { transform: translateY(0); }
        .acsub-submit:disabled { opacity: .6; cursor: not-allowed; transform: none; box-shadow: none; }
        .acsub-status {
            margin: 12px 0 0; font-size: .84rem; text-align: center; min-height: 1.1em;
            color: var(--acs-t2); line-height: 1.4;
        }
        .acsub-status.ok { color: #34d399; }
        .acsub-status.err { color: #fb7185; }
        .acsub-link {
            display: flex; align-items: center; justify-content: center; gap: 6px;
            width: 100%; margin-top: 14px; padding: 0;
            background: none; border: none; cursor: pointer;
            color: var(--acs-t2); font-size: .82rem; font-weight: 600; transition: color .15s ease;
        }
        .acsub-link:hover { color: var(--acc-a); }

        /* One-time "want to submit?" invite toast */
        .acsub-toast {
            position: fixed; z-index: 19000;
            left: max(env(safe-area-inset-left, 0px), 18px);
            bottom: max(env(safe-area-inset-bottom, 0px), 18px);
            width: 340px; max-width: calc(100vw - 36px);
            overflow: hidden;
            background: var(--acs-surface);
            border: 1px solid var(--acs-line);
            border-radius: 18px;
            box-shadow: 0 20px 50px rgba(0,0,0,0.55);
            color: var(--acs-t1); font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
            backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
            transform: translateY(24px) scale(.96); opacity: 0;
            transition: transform .4s cubic-bezier(.16,.84,.44,1), opacity .4s ease;
        }
        .acsub-toast.visible { transform: none; opacity: 1; }
        .acsub-toast::before {
            content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
            background: linear-gradient(90deg, var(--acc-a), var(--acc-b));
        }
        .acsub-toast-inner { display: flex; gap: 13px; padding: 17px 16px 16px; }
        .acsub-toast-icon {
            flex: 0 0 auto; width: 42px; height: 42px; border-radius: 13px;
            display: grid; place-items: center; font-size: 1.1rem; color: var(--acc-ink);
            background: linear-gradient(135deg, var(--acc-a), var(--acc-b));
            box-shadow: 0 6px 16px var(--acc-glow);
        }
        .acsub-toast-body { flex: 1 1 auto; min-width: 0; padding-right: 12px; }
        .acsub-toast-body strong { display: block; font-size: .95rem; font-weight: 700; color: #fff; letter-spacing: -.01em; }
        .acsub-toast-body p { margin: 4px 0 0; font-size: .8rem; color: var(--acs-t2); line-height: 1.4; }
        .acsub-toast-actions { display: flex; gap: 8px; margin-top: 12px; }
        .acsub-toast-cta {
            border: none; cursor: pointer; color: var(--acc-ink);
            padding: 8px 15px; border-radius: 10px; font-size: .82rem; font-weight: 700;
            background: linear-gradient(135deg, var(--acc-a), var(--acc-b));
            box-shadow: 0 6px 14px var(--acc-glow);
            transition: transform .15s ease, filter .15s ease;
        }
        .acsub-toast-cta:hover { transform: translateY(-1px); filter: brightness(1.05); }
        .acsub-toast-later {
            border: 1px solid var(--acs-line); background: rgba(255,255,255,0.03);
            color: var(--acs-t2); cursor: pointer;
            padding: 8px 13px; border-radius: 10px; font-size: .82rem; font-weight: 600;
            transition: background .15s ease, color .15s ease;
        }
        .acsub-toast-later:hover { background: rgba(255,255,255,0.09); color: #fff; }
        .acsub-toast-x {
            position: absolute; top: 10px; right: 11px;
            width: 22px; height: 22px; border-radius: 50%;
            border: none; background: transparent; color: var(--acs-t3);
            font-size: 1.05rem; line-height: 1; cursor: pointer;
            display: grid; place-items: center; transition: color .15s ease, background .15s ease;
        }
        .acsub-toast-x:hover { color: #fff; background: rgba(255,255,255,0.08); }

        @media (max-width: 420px) {
            .acsub-head { padding-left: 18px; padding-right: 50px; }
            .acsub-body, .acsub-foot { padding-left: 18px; padding-right: 18px; }
            .acsub-toast { width: auto; right: max(env(safe-area-inset-right, 0px), 18px); }
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
                        <div class="acsub-drop-title">Drop photos here or <b>browse</b></div>
                        <div class="acsub-drop-sub">Up to ${MAX_IMAGES} images &middot; JPG, PNG or WEBP</div>
                    </label>
                    <div class="acsub-previews" id="acSubPreviews"></div>

                    <label class="acsub-field" style="margin-top:16px;">
                        <span class="acsub-field-label">Aircraft type <span class="req">*</span></span>
                        <input class="acsub-input" type="text" name="aircraftType" placeholder="e.g. A320neo" required>
                    </label>

                    <label class="acsub-field">
                        <span class="acsub-field-label">Livery <span class="req">*</span></span>
                        <input class="acsub-input" type="text" name="liveryName" placeholder="e.g. IndiGo" required>
                    </label>

                    <label class="acsub-field">
                        <span class="acsub-field-label">Tail number <span class="opt">optional</span></span>
                        <input class="acsub-input" type="text" name="tailNumber" placeholder="e.g. VT-IZA">
                    </label>

                    <label class="acsub-field">
                        <span class="acsub-field-label">Your name / credit <span class="opt">optional</span></span>
                        <input class="acsub-input" type="text" name="collaboratorName" placeholder="Shown as the contributor">
                    </label>

                    <!-- Populated from the signed-in user's linked Discord ID when known
                         (never typed by the user). When present, credit + contributor role
                         + leaderboard all work natively. Left empty otherwise. -->
                    <input type="hidden" name="collaboratorId" value="">
                </div>

                <div class="acsub-foot">
                    <button type="submit" class="acsub-submit"><i class="fa-solid fa-paper-plane"></i> Submit for review</button>
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
    // One-time "want to submit your own plane images?" invite
    //
    // Shows a single amber toast, once ever, after a randomised delay so it
    // feels organic rather than firing the instant the map loads. It's marked
    // seen the moment it appears, so ignoring it counts — it never returns.
    // Anyone who's already a contributor (has a saved credit name) is skipped.
    // ---------------------------------------------------------------------
    const INVITE_KEY = 'inflight_submit_invite_seen';
    const inviteSeen = () => { try { return localStorage.getItem(INVITE_KEY) === '1'; } catch (_) { return true; } };
    const markInviteSeen = () => { try { localStorage.setItem(INVITE_KEY, '1'); } catch (_) {} };

    // A few flavours so the nudge feels a little different each rollout.
    const INVITES = [
        { h: 'Got great plane shots?', p: 'Add your Infinite Flight liveries to the community gallery — takes a few seconds.' },
        { h: 'Fly with a camera?', p: 'Share your best aircraft photos and get credited across the tracker.' },
        { h: 'Missing your favourite livery?', p: 'Submit your own plane images — staff review every one on Discord.' }
    ];

    let toastEl = null, toastTimer = null;

    function dismissInvite() {
        if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
        if (!toastEl) return;
        toastEl.classList.remove('visible');
        const el = toastEl; toastEl = null;
        setTimeout(() => el.remove(), 400);
    }

    // showInvite({ force }) — force:true previews it on demand without
    // consuming the one-time flag (used by the public invite() trigger).
    function showInvite(opts) {
        if (typeof document === 'undefined') return;
        const force = !!(opts && opts.force);
        if (toastEl) { if (!force) return; dismissInvite(); }
        if (!force) markInviteSeen(); // one-time: appearing is enough to retire it
        injectStyles();

        const pick = INVITES[Math.floor(Math.random() * INVITES.length)];
        toastEl = document.createElement('div');
        toastEl.className = 'acsub-toast';
        toastEl.setAttribute('role', 'dialog');
        toastEl.setAttribute('aria-label', 'Submit your plane photos');
        toastEl.innerHTML = `
            <button type="button" class="acsub-toast-x" aria-label="Dismiss">&times;</button>
            <div class="acsub-toast-inner">
                <div class="acsub-toast-icon"><i class="fa-solid fa-camera-retro"></i></div>
                <div class="acsub-toast-body">
                    <strong>${pick.h}</strong>
                    <p>${pick.p}</p>
                    <div class="acsub-toast-actions">
                        <button type="button" class="acsub-toast-cta">Submit a photo</button>
                        <button type="button" class="acsub-toast-later">Not now</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(toastEl);

        toastEl.querySelector('.acsub-toast-x').addEventListener('click', dismissInvite);
        toastEl.querySelector('.acsub-toast-later').addEventListener('click', dismissInvite);
        toastEl.querySelector('.acsub-toast-cta').addEventListener('click', () => { dismissInvite(); open(); });

        requestAnimationFrame(() => toastEl.classList.add('visible'));
        // Auto-retire if left untouched for a while.
        toastTimer = setTimeout(dismissInvite, 18000);
    }

    function maybeScheduleInvite() {
        if (window !== window.parent) return;                               // not inside embeds/iframes
        if (inviteSeen()) return;                                           // already shown once
        if (savedName()) { markInviteSeen(); return; }                      // already a contributor
        if (!document.getElementById('toolbar-submit-photo-btn')) return;   // tracker chrome only
        // 18–50s by default; a site can override via window.INFLIGHT_INVITE_DELAY_MS.
        const override = Number(window.INFLIGHT_INVITE_DELAY_MS);
        const delay = Number.isFinite(override) ? override : 18000 + Math.random() * 32000;
        setTimeout(() => {
            if (inviteSeen()) return;                                        // set/submitted meanwhile
            if (overlayEl && overlayEl.classList.contains('visible')) return; // don't stack on the modal
            showInvite();
        }, delay);
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
        const init = () => { wireToolbarButton(); maybeScheduleInvite(); };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlayEl && overlayEl.classList.contains('visible')) close();
        });
    }

    window.InflightAircraftSubmit = {
        open,
        close,
        // Manually show the invite toast (e.g. from a menu item or for preview).
        // Bypasses the "already seen" one-time guard.
        invite: () => showInvite({ force: true }),
        dismissInvite
    };
})();
