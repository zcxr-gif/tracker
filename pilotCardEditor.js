/**
 * pilotCardEditor.js
 *
 * "Picture & banner" card in the account Settings — the desktop dashboard
 * (ProfileUI) and the mobile one (MobileDashboardUI): the website's side of
 * the profile editor the iOS app has (see PROFILES.md in the iOS repo).
 *
 *   - No profile yet → claim a handle (that is what creates the row).
 *   - Picture: upload / remove. Free.
 *   - Either upload first opens the move-and-scale frame (imageAdjuster.js),
 *     so what is saved is exactly what the pilot framed.
 *   - Banner: one of six painted presets for everyone; a photograph on Pro
 *     only. Free accounts see the photo option locked with a PRO tag, and a
 *     lapsed account's saved photo is neither previewed nor re-uploadable.
 *
 * The server is the real gate: pilot_profiles' write guard and the
 * profile-image function refuse a photo banner from a free account whatever
 * this card draws. Self-contained like discordPresenceUI.js: it renders into
 * the host it is given and wires its own listeners.
 */

import { PilotProfiles, BANNER_PRESET_LABELS, presetGradient } from './pilotProfiles.js';
import { adjustImage } from './imageAdjuster.js';

const HANDLE_SHAPE = /^[a-z0-9](?:[a-z0-9_]{1,18})[a-z0-9]$/;
const IF_USERNAME_SHAPE = /^[A-Za-z0-9_.-]{1,40}$/;
// Same sizes the app encodes to; re-encoding also drops EXIF (a phone photo
// carries where it was taken, and these are public files).
// aspect is the frame the pilot positions the picture in (width / height).
const KIND = {
    avatar: { longest: 720, minSide: 96, aspect: 1 },
    banner: { longest: 1800, minSide: 320, aspect: 3 },
};

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function initials(name) {
    return String(name || '?').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
}

// createImageBitmap is missing on older iOS Safari and refuses some phone
// photos; an <img> decodes anything the browser can show.
async function decodeImage(file) {
    if (typeof createImageBitmap === 'function') {
        try {
            const bitmap = await createImageBitmap(file);
            return { width: bitmap.width, height: bitmap.height, source: bitmap, close: () => bitmap.close?.() };
        } catch (_) { /* fall through */ }
    }
    const url = URL.createObjectURL(file);
    try {
        const img = new Image();
        img.src = url;
        await img.decode();
        return { width: img.naturalWidth, height: img.naturalHeight, source: img };
    } catch (_) {
        throw new Error('That file couldn\'t be read as a picture. Try a JPEG or PNG.');
    } finally {
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }
}

// Decode, let the pilot frame it, then encode what is inside the frame.
// Resolves to null when they cancel.
async function pickAndEncode(file, kind) {
    const spec = KIND[kind];
    const bitmap = await decodeImage(file);
    try {
        if (Math.min(bitmap.width, bitmap.height) < spec.minSide) {
            throw new Error(`That ${kind === 'avatar' ? 'picture' : 'banner'} is too small — it needs to be at least ${spec.minSide} pixels on its short side.`);
        }
        const crop = await adjustImage(bitmap, {
            shape: kind === 'avatar' ? 'circle' : 'rect',
            aspect: spec.aspect,
            title: kind === 'avatar' ? 'Move and scale' : 'Position your banner',
            saveLabel: 'Use this',
        });
        if (!crop) return null;
        // Scale the framed part down to the app's size, but never below the
        // short side the server accepts (a deep zoom on a small photo).
        let scale = Math.min(1, spec.longest / Math.max(crop.sw, crop.sh));
        scale = Math.max(scale, spec.minSide / Math.min(crop.sw, crop.sh));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(crop.sw * scale);
        canvas.height = Math.round(crop.sh * scale);
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap.source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.88).split(',')[1];
    } finally {
        bitmap.close?.();
    }
}

export const PilotCardEditor = {
    _host: null,
    _opts: null,
    _profile: null,
    _busy: false,

    // variant: 'desktop' (a pui-card in the dashboard's Settings), 'mobile'
    // (an iOS-style section in MobileDashboardUI's Settings tab) or 'prompt'
    // (just the body, inside pilotCardPrompt.js's popup, which has its own
    // title).
    mount(host, { supabase, isPro = false, user = null, variant = 'desktop' } = {}) {
        if (!host || !supabase) return;
        this._host = host;
        this._opts = { supabase, isPro, user, variant };
        this._injectStyles();
        host.innerHTML = this._frame('<div class="pce-muted">Loading your profile…</div>');
        this._load();
    },

    async _load() {
        const { supabase } = this._opts;
        const { data: { session } = {} } = await supabase.auth.getSession();
        if (!session) { this._paint('<div class="pce-muted">Sign in to set a picture and banner.</div>'); return; }
        this._profile = await PilotProfiles.mine(supabase);
        this._render();
    },

    _frame(body) {
        if (this._opts.variant === 'prompt') {
            return `<div class="pce pce-prompt"><div id="pce-body">${body}</div></div>`;
        }
        if (this._opts.variant === 'mobile') {
            return `
                <div class="mdui-section pce pce-mobile">
                    <div class="mdui-section-title">Picture &amp; banner</div>
                    <div class="pce-mobile-card" id="pce-body">${body}</div>
                </div>`;
        }
        return `
            <div class="pui-card pce">
                <div class="pui-card-header"><h3>Picture &amp; banner</h3></div>
                <div class="pui-card-body" id="pce-body">${body}</div>
            </div>`;
    },

    _paint(body) {
        const el = this._host?.querySelector('#pce-body');
        if (el) el.innerHTML = body;
    },

    _render() {
        if (!this._host?.isConnected) return;
        if (!this._profile) { this._renderClaim(); return; }

        const p = this._profile;
        const { isPro } = this._opts;
        // Your own row is read straight from the table, which (unlike the
        // public card) still carries a banner photo after Pro lapses. Nobody
        // else sees it then, so neither does the preview.
        const bannerUrl = isPro ? p.bannerUrl : null;
        const keptPhoto = !isPro && !!p.row?.banner_path;
        const bannerBg = bannerUrl ? `url("${bannerUrl}"), ${presetGradient(p.bannerPreset)}` : presetGradient(p.bannerPreset);
        const avatar = p.avatarUrl
            ? `<img src="${esc(p.avatarUrl)}" alt="">`
            : esc(initials(p.displayName));

        this._paint(`
            <div class="pce-preview" style='background-image: ${bannerBg.replace(/'/g, '%27')}'>
                <span class="pce-avatar">${avatar}</span>
            </div>
            <div class="pce-ident">
                <strong>${esc(p.displayName)}</strong>
                <span class="pce-muted">@${esc(p.handle)}</span>
            </div>

            <div class="pce-label">Picture</div>
            <div class="pce-row">
                <label class="pce-btn">
                    <input type="file" accept="image/jpeg,image/png,image/webp" data-upload="avatar" hidden>
                    <i class="fa-solid fa-camera"></i> ${p.avatarUrl ? 'Change picture' : 'Add a picture'}
                </label>
                ${p.avatarUrl ? '<button type="button" class="pce-btn pce-quiet" data-remove="avatar">Remove</button>' : ''}
            </div>

            <div class="pce-label">Banner</div>
            <div class="pce-swatches">
                ${PilotProfiles.presets.map(k => `
                    <button type="button" class="pce-swatch${k === p.bannerPreset ? ' is-active' : ''}" data-preset="${k}"
                            style="background: ${presetGradient(k)}" title="${BANNER_PRESET_LABELS[k]}">
                        <span>${BANNER_PRESET_LABELS[k]}</span>
                    </button>`).join('')}
            </div>
            <div class="pce-label">Photo banner <span class="pce-pro">PRO</span></div>
            ${isPro ? `
                <div class="pce-row">
                    <label class="pce-btn">
                        <input type="file" accept="image/jpeg,image/png,image/webp" data-upload="banner" hidden>
                        <i class="fa-solid fa-image"></i> ${bannerUrl ? 'Change banner photo' : 'Upload a photo'}
                    </label>
                    ${bannerUrl ? '<button type="button" class="pce-btn pce-quiet" data-remove="banner">Remove photo</button>' : ''}
                </div>
                <p class="pce-help">You can drag and zoom your photo into place before it is saved. It replaces the painted banner, which still shows while it loads.</p>
            ` : `
                <div class="pce-row">
                    <button type="button" class="pce-btn pce-locked" disabled aria-disabled="true">
                        <i class="fa-solid fa-lock"></i> Upload a photo
                    </button>
                    ${keptPhoto ? '<button type="button" class="pce-btn pce-quiet" data-remove="banner">Remove saved photo</button>' : ''}
                </div>
                <p class="pce-help">${keptPhoto
                    ? 'Your banner photo is saved and comes back when you are on Inflight Pro again. Until then everyone sees your painted banner.'
                    : 'Photo banners are an Inflight Pro feature. Everyone can use the painted banners above.'}</p>
            `}
            <div class="pce-msg" id="pce-msg" role="status"></div>
        `);
        this._wire();
    },

    _renderClaim() {
        const user = this._opts.user;
        const ifName = user?.user_metadata?.if_username || '';
        const suggestion = String(ifName || user?.email?.split('@')[0] || '')
            .toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20);
        this._paint(`
            <p class="pce-help" style="margin-top:0">
                Pick a handle to create your pilot profile. It is what your picture and banner hang on,
                and what people see when they open your aircraft on the map.
            </p>
            <label class="pce-label" for="pce-handle">Handle</label>
            <div class="pce-handle-wrap">
                <span>@</span>
                <input type="text" id="pce-handle" class="pce-input" maxlength="20" value="${esc(suggestion)}" autocomplete="off" autocapitalize="off" spellcheck="false">
            </div>
            <p class="pce-help">3–20 characters: lowercase letters, numbers and single underscores.</p>
            <div class="pce-row"><button type="button" class="pce-btn pce-primary" id="pce-claim">Create profile</button></div>
            <div class="pce-msg" id="pce-msg" role="status"></div>
        `);
        this._host.querySelector('#pce-claim')?.addEventListener('click', () => this._claim());
    },

    async _claim() {
        const { supabase, user } = this._opts;
        const handle = (this._host.querySelector('#pce-handle')?.value || '').trim().toLowerCase();
        if (!HANDLE_SHAPE.test(handle) || handle.includes('__')) {
            this._say('That handle doesn\'t fit: 3–20 lowercase letters, numbers or single underscores, not starting or ending with one.', true);
            return;
        }
        await this._run(async () => {
            const { data: free } = await supabase.rpc('pilot_handle_available', { p_handle: handle });
            if (free === false) throw new Error('That handle is taken.');
            const ifName = user?.user_metadata?.if_username;
            const fullName = String(user?.user_metadata?.full_name || '').trim().slice(0, 32);
            const { error } = await supabase.from('pilot_profiles').upsert({
                user_id: user.id,
                handle,
                display_name: fullName || null,
                if_username: ifName && IF_USERNAME_SHAPE.test(ifName) ? ifName : null,
                banner_preset: 'dusk',
            }, { onConflict: 'user_id' });
            if (error) throw new Error(error.message);
            this._profile = await PilotProfiles.mine(supabase);
            this._changed();
            this._render();
            this._say('Profile created. Add a picture and pick a banner.');
        });
    },

    _wire() {
        const host = this._host;
        host.querySelectorAll('input[data-upload]').forEach(input => {
            input.addEventListener('change', () => {
                const file = input.files?.[0];
                input.value = '';
                if (file) this._upload(input.dataset.upload, file);
            });
        });
        host.querySelectorAll('[data-remove]').forEach(btn => {
            btn.addEventListener('click', () => this._remove(btn.dataset.remove));
        });
        host.querySelectorAll('[data-preset]').forEach(btn => {
            btn.addEventListener('click', () => this._setPreset(btn.dataset.preset));
        });
    },

    async _upload(kind, file) {
        const { supabase, isPro } = this._opts;
        if (kind === 'banner' && !isPro) { this._say('Photo banners are an Inflight Pro feature.', true); return; }
        await this._run(async () => {
            this._say('');
            const data = await pickAndEncode(file, kind);
            if (!data) return;
            this._say(kind === 'avatar' ? 'Uploading your picture…' : 'Uploading your banner…');
            await PilotProfiles.upload(supabase, kind, data);
            this._profile = await PilotProfiles.mine(supabase);
            this._changed();
            this._render();
            this._say(kind === 'avatar' ? 'Picture updated.' : 'Banner updated.');
        });
    },

    async _remove(kind) {
        const { supabase } = this._opts;
        await this._run(async () => {
            await PilotProfiles.remove(supabase, kind);
            this._profile = await PilotProfiles.mine(supabase);
            this._changed();
            this._render();
            this._say(kind === 'avatar' ? 'Picture removed.' : 'Banner photo removed.');
        });
    },

    async _setPreset(preset) {
        const { supabase, user } = this._opts;
        if (!this._profile || preset === this._profile.bannerPreset) return;
        await this._run(async () => {
            const { error } = await supabase.from('pilot_profiles').update({ banner_preset: preset }).eq('user_id', user.id);
            if (error) throw new Error(error.message);
            this._profile = await PilotProfiles.mine(supabase);
            this._changed();
            this._render();
        });
    },

    async _run(task) {
        if (this._busy) return;
        this._busy = true;
        this._host.querySelector('.pce')?.classList.add('is-busy');
        try {
            await task();
        } catch (err) {
            this._say(err.needsPro ? 'A photo banner is part of Inflight Pro.' : (err.message || 'Something went wrong.'), true);
        } finally {
            this._busy = false;
            this._host.querySelector('.pce')?.classList.remove('is-busy');
        }
    },

    // Everything that shows a pilot's card (the nav, flight windows, profiles)
    // reads through PilotProfiles' cache; drop this pilot's entry and say so.
    _changed() {
        PilotProfiles.forget(this._profile?.row?.if_username);
        window.dispatchEvent(new CustomEvent('inflight:pilot-profile-changed'));
    },

    _say(text, isError = false) {
        const el = this._host?.querySelector('#pce-msg');
        if (!el) return;
        el.textContent = text || '';
        el.classList.toggle('is-error', !!isError);
    },

    _injectStyles() {
        if (document.getElementById('pce-styles')) return;
        const style = document.createElement('style');
        style.id = 'pce-styles';
        style.textContent = `
            .pce.is-busy { opacity: .7; pointer-events: none; transition: opacity .2s ease; }
            .pce-muted { color: var(--pui-text-muted, #94a3b8); font-size: .85rem; }
            .pce-preview {
                position: relative; height: 120px; border-radius: 12px;
                background-size: cover, cover; background-position: center, center;
                margin-bottom: 44px;
            }
            .pce-avatar {
                position: absolute; left: 16px; bottom: -36px;
                width: 76px; height: 76px; border-radius: 50%; overflow: hidden;
                display: grid; place-items: center;
                background: #4a505c; color: #fff; font-weight: 800; font-size: 1.2rem;
                border: 3px solid var(--pui-bg-card, #1c1c1e);
                box-shadow: 0 4px 14px rgba(0,0,0,.3);
            }
            .pce-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
            .pce-ident { display: flex; flex-direction: column; gap: 2px; margin: -34px 0 18px 104px; min-height: 34px; }
            .pce-label { font-size: .72rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
                         color: var(--pui-text-muted, #94a3b8); margin: 16px 0 8px; }
            .pce-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
            .pce-btn {
                display: inline-flex; align-items: center; gap: 8px; cursor: pointer;
                height: 36px; padding: 0 14px; border-radius: 10px; font: inherit; font-size: .85rem; font-weight: 600;
                background: var(--pui-bg-input, rgba(255,255,255,.08)); color: inherit;
                border: 1px solid var(--pui-border, rgba(255,255,255,.12));
            }
            .pce-btn:hover { filter: brightness(1.15); }
            .pce-quiet { background: transparent; }
            .pce-swatches { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; margin-bottom: 12px; }
            .pce-swatch {
                height: 48px; border-radius: 10px; border: 2px solid transparent; cursor: pointer;
                display: flex; align-items: flex-end; justify-content: center; padding: 0 0 5px;
                color: #fff; font: inherit; font-size: .62rem; font-weight: 700; text-shadow: 0 1px 3px rgba(0,0,0,.6);
            }
            .pce-swatch.is-active { border-color: var(--pui-accent, #fff); box-shadow: 0 0 0 2px rgba(0,0,0,.35) inset; }
            .pce-help { font-size: .78rem; line-height: 1.45; color: var(--pui-text-muted, #8e8e93); margin: 8px 0 0; }
            .pce-pro {
                display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 5px;
                font-size: .6rem; letter-spacing: .06em; color: #1c1c1e;
                background: linear-gradient(135deg, #f5d27a, #e0a93b); vertical-align: 1px;
            }
            .pce-locked { opacity: .55; cursor: not-allowed; }
            .pce-locked:hover { filter: none; }
            .pce-primary { background: #0a84ff; border-color: #0a84ff; color: #fff; }
            .pce-handle-wrap {
                display: flex; align-items: center; gap: 6px; height: 40px; padding: 0 12px; border-radius: 10px;
                background: var(--pui-bg-input, rgba(255,255,255,.08)); border: 1px solid var(--pui-border, rgba(255,255,255,.12));
            }
            .pce-handle-wrap span { opacity: .6; }
            .pce-input { flex: 1; min-width: 0; background: none; border: 0; outline: none; color: inherit; font: inherit; font-size: 16px; }
            /* Mobile: an inset card in the Settings tab's iOS style. */
            .pce-mobile-card {
                background: var(--mdui-bg-card, rgba(44, 44, 46, 0.9)); border-radius: 14px; padding: 14px;
            }
            .pce-mobile .pce-preview { height: 104px; margin-bottom: 40px; }
            .pce-mobile .pce-avatar { width: 68px; height: 68px; bottom: -32px; left: 12px; border-color: var(--mdui-bg-card, #2c2c2e); }
            .pce-mobile .pce-ident { margin: -30px 0 14px 92px; }
            .pce-mobile .pce-btn { height: 40px; }
            .pce-msg { min-height: 1.2em; margin-top: 12px; font-size: .85rem; color: var(--pui-text-muted, #94a3b8); }
            .pce-msg.is-error { color: #f87171; }
            @media (max-width: 560px) { .pce-swatches { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        `;
        document.head.appendChild(style);
    },
};
