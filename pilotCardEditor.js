/**
 * pilotCardEditor.js
 *
 * "Picture & banner" card in the account Settings page: the website's side of
 * the profile editor the iOS app has (see PROFILES.md in the iOS repo).
 *
 *   - No profile yet → claim a handle (that is what creates the row).
 *   - Picture: upload / remove. Free.
 *   - Banner: one of six painted presets for everyone; a photograph on Pro.
 *
 * The server is the real gate: pilot_profiles' write guard and the
 * profile-image function refuse a photo banner from a free account whatever
 * this card draws. Self-contained like discordPresenceUI.js: it renders into
 * the host it is given and wires its own listeners.
 */

import { PilotProfiles, BANNER_PRESET_LABELS, presetGradient } from './pilotProfiles.js';

const HANDLE_SHAPE = /^[a-z0-9](?:[a-z0-9_]{1,18})[a-z0-9]$/;
const IF_USERNAME_SHAPE = /^[A-Za-z0-9_.-]{1,40}$/;
// Same sizes the app encodes to; re-encoding also drops EXIF (a phone photo
// carries where it was taken, and these are public files).
const KIND = {
    avatar: { longest: 720, minSide: 96 },
    banner: { longest: 1800, minSide: 320 },
};

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function initials(name) {
    return String(name || '?').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
}

async function encodeJpeg(file, kind) {
    const spec = KIND[kind];
    const bitmap = await createImageBitmap(file);
    if (Math.min(bitmap.width, bitmap.height) < spec.minSide) {
        throw new Error(`That ${kind === 'avatar' ? 'picture' : 'banner'} is too small — it needs to be at least ${spec.minSide} pixels on its short side.`);
    }
    const scale = Math.min(1, spec.longest / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return canvas.toDataURL('image/jpeg', 0.88).split(',')[1];
}

export const PilotCardEditor = {
    _host: null,
    _opts: null,
    _profile: null,
    _busy: false,

    mount(host, { supabase, isPro = false, user = null } = {}) {
        if (!host || !supabase) return;
        this._host = host;
        this._opts = { supabase, isPro, user };
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
        const bannerBg = p.bannerUrl ? `url("${p.bannerUrl}"), ${presetGradient(p.bannerPreset)}` : presetGradient(p.bannerPreset);
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
            ${isPro ? `
                <div class="pce-row">
                    <label class="pce-btn">
                        <input type="file" accept="image/jpeg,image/png,image/webp" data-upload="banner" hidden>
                        <i class="fa-solid fa-image"></i> ${p.bannerUrl ? 'Change banner photo' : 'Use a photo'}
                    </label>
                    ${p.bannerUrl ? '<button type="button" class="pce-btn pce-quiet" data-remove="banner">Remove photo</button>' : ''}
                </div>
                <p class="pui-help-text">A photo sits over the painted banner, which shows while it loads.</p>
            ` : `
                <p class="pui-help-text"><i class="fa-solid fa-lock"></i> A photo banner is part of Inflight Pro. Everyone gets the painted ones.</p>
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
            <p class="pui-help-text" style="margin-top:0">
                Pick a handle to create your pilot profile. It is what your picture and banner hang on,
                and what people see when they open your aircraft on the map.
            </p>
            <div class="pui-input-group">
                <label>Handle</label>
                <div class="pui-input-wrapper">
                    <i class="fa-solid fa-at pui-input-icon"></i>
                    <input type="text" id="pce-handle" class="pui-input has-icon" maxlength="20" value="${esc(suggestion)}" autocomplete="off" spellcheck="false">
                </div>
                <p class="pui-help-text">3–20 characters: lowercase letters, numbers and single underscores.</p>
            </div>
            <div class="pce-row"><button type="button" class="pui-btn-primary" id="pce-claim">Create profile</button></div>
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
        const { supabase } = this._opts;
        await this._run(async () => {
            this._say(kind === 'avatar' ? 'Uploading your picture…' : 'Uploading your banner…');
            const data = await encodeJpeg(file, kind);
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
            .pce-msg { min-height: 1.2em; margin-top: 12px; font-size: .85rem; color: var(--pui-text-muted, #94a3b8); }
            .pce-msg.is-error { color: #f87171; }
            @media (max-width: 560px) { .pce-swatches { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
        `;
        document.head.appendChild(style);
    },
};
