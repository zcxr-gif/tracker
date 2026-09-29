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

import { PilotProfiles, BANNER_PRESET_LABELS, presetGradient, WINDOW_THEMES } from './pilotProfiles.js';
import { adjustImage } from './imageAdjuster.js';
import { PilotStanding } from './pilotStanding.js';

const HANDLE_SHAPE = /^[a-z0-9](?:[a-z0-9_]{1,18})[a-z0-9]$/;
const IF_USERNAME_SHAPE = /^[A-Za-z0-9_.-]{1,40}$/;
// Same sizes the app encodes to; re-encoding also drops EXIF (a phone photo
// carries where it was taken, and these are public files).
// aspect is the frame the pilot positions the picture in (width / height).
const KIND = {
    avatar: { longest: 720, minSide: 96, aspect: 1 },
    banner: { longest: 1800, minSide: 320, aspect: 3 },
    // The flight window is tall: the photo fills it top to bottom.
    window: { longest: 1600, minSide: 320, aspect: 0.56 },
};
const KIND_NAME = { avatar: 'picture', banner: 'banner', window: 'window photo' };

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function initials(name) {
    return String(name || '?').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
}

function rgbOf(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    const h = m ? m[1] : '16181c';
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}
function hexA(hex, a) { return `rgba(${rgbOf(hex).join(',')},${a})`; }
function mix(a, b, t) {
    const pa = rgbOf(a), pb = rgbOf(b);
    return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
// Same rule as the Horizon window (horizonTokens in flight.js): which of
// black or white text has the higher contrast.
function isLight(hex) {
    const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const [r, g, b] = rgbOf(hex);
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return (L + 0.05) / 0.05 > 1.05 / (L + 0.05);
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
// Resolves to null when they cancel. `extra` is passed to the adjuster (the
// window photo's sketch and Dim); the chosen Dim comes back on `onDim`.
async function pickAndEncode(file, kind, extra = {}, onDim = null) {
    const spec = KIND[kind];
    const bitmap = await decodeImage(file);
    try {
        if (Math.min(bitmap.width, bitmap.height) < spec.minSide) {
            throw new Error(`That ${KIND_NAME[kind]} is too small — it needs to be at least ${spec.minSide} pixels on its short side.`);
        }
        const crop = await adjustImage(bitmap, {
            shape: kind === 'avatar' ? 'circle' : 'rect',
            aspect: spec.aspect,
            title: kind === 'avatar' ? 'Move and scale' : kind === 'window' ? 'Frame your window photo' : 'Position your banner',
            saveLabel: 'Use this',
            ...extra,
        });
        if (!crop) return null;
        if (onDim && Number.isFinite(crop.dim)) onDim(crop.dim);
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
    // only: 'window' shows just "Your flight window" (accountSetup.js's own
    // step for it), after the handle claim when there is no profile yet.
    mount(host, { supabase, isPro = false, user = null, variant = 'desktop', only = null } = {}) {
        if (!host || !supabase) return;
        this._host = host;
        this._opts = { supabase, isPro, user, variant, only };
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
        if (this._opts.only === 'window') {
            this._paint(`${this._windowSection({ bare: true })}<div class="pce-msg" id="pce-msg" role="status"></div>`);
            this._wire();
            return;
        }

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
            ${this._opts.variant === 'prompt' ? '' : this._windowSection()}
            <div class="pce-msg" id="pce-msg" role="status"></div>
        `);
        this._wire();
    },

    // "Your flight window": the look everyone else sees when they open this
    // pilot's flight (supabase/sql/pilot-window-style.sql). A painted theme
    // for everyone; a colour, a photo, its dim and the Pro flair for Pro.
    _windowSection({ bare = false } = {}) {
        const row = this._profile?.row || {};
        const { isPro } = this._opts;
        const head = bare ? '' : `<div class="pce-label pce-label-lg" id="pce-window-style">Your flight window</div>
            <p class="pce-help pce-help-top">What other pilots see when they open your flight. They can switch pilots' styles off for themselves.</p>`;
        if (!('window_theme' in row)) {
            return head + '<p class="pce-help">Window styles are being switched on — check back soon.</p>';
        }
        const theme = row.window_theme || null;
        const color = isPro ? (row.window_color || null) : null;
        const photo = isPro && row.window_bg_path ? PilotProfiles.publicUrl('pilot-banners', row.window_bg_path) : null;
        const dim = Math.min(90, Math.max(20, Number(row.window_bg_dim) || 60));
        const flair = row.window_flair !== false;
        const keptPro = !isPro && (row.window_color || row.window_bg_path);
        return head + `
            <div class="pce-win-wrap">
                ${this._windowPreview({ theme, color, photo, dim })}
                <div class="pce-win-controls">
                    <div class="pce-sublabel">Theme</div>
                    <div class="pce-swatches pce-win-themes">
                        <button type="button" class="pce-swatch pce-swatch-none${!theme && !color ? ' is-active' : ''}" data-win-theme="">
                            <span>None</span>
                        </button>
                        ${WINDOW_THEMES.map(k => `
                            <button type="button" class="pce-swatch${k === theme && !color ? ' is-active' : ''}" data-win-theme="${k}"
                                    style="background: ${presetGradient(k)}" title="${BANNER_PRESET_LABELS[k]}">
                                <span>${BANNER_PRESET_LABELS[k]}</span>
                            </button>`).join('')}
                    </div>
                    <div class="pce-sublabel">Colour <span class="pce-pro">PRO</span></div>
                    ${isPro ? `
                        <div class="pce-row">
                            <label class="pce-btn pce-color-btn">
                                <span class="pce-color-dot" style="background:${esc(color || '#16181c')}"></span>
                                <input type="color" data-win-color value="${esc(color || '#16181c')}">
                                ${color ? 'Change colour' : 'Pick a colour'}
                            </label>
                            ${color ? '<button type="button" class="pce-btn pce-quiet" data-win-color-clear>Use theme instead</button>' : ''}
                        </div>` : `
                        <div class="pce-row"><button type="button" class="pce-btn pce-locked" disabled aria-disabled="true"><i class="fa-solid fa-lock"></i> Pick a colour</button></div>`}
                    <div class="pce-sublabel">Photo <span class="pce-pro">PRO</span></div>
                    ${isPro ? `
                        <div class="pce-row">
                            <label class="pce-btn">
                                <input type="file" accept="image/jpeg,image/png,image/webp" data-upload="window" hidden>
                                <i class="fa-solid fa-image"></i> ${photo ? 'Change photo' : 'Upload a photo'}
                            </label>
                            ${photo ? '<button type="button" class="pce-btn pce-quiet" data-remove="window">Remove photo</button>' : ''}
                        </div>
                        ${photo ? `<label class="pce-dim"><span>Dim</span><input type="range" min="20" max="90" step="5" value="${dim}" data-win-dim><output>${dim}%</output></label>` : ''}
                        <label class="pce-check"><input type="checkbox" data-win-flair ${flair ? 'checked' : ''}>
                            <span><b>Pro flair</b> — a soft glow around your plane on the map and a shimmer on your pilot card.</span></label>
                    ` : `
                        <div class="pce-row"><button type="button" class="pce-btn pce-locked" disabled aria-disabled="true"><i class="fa-solid fa-lock"></i> Upload a photo</button></div>
                        <p class="pce-help">${keptPro
                            ? 'Your window colour and photo are saved and come back when you are on Inflight Pro again. Until then everyone sees your theme.'
                            : 'A custom colour, a window photo and the map glow are part of Inflight Pro. Everyone can use the themes above.'}</p>
                        ${keptPro && row.window_bg_path ? '<div class="pce-row"><button type="button" class="pce-btn pce-quiet" data-remove="window">Remove saved photo</button></div>' : ''}
                    `}
                </div>
            </div>`;
    },

    // A small stand-in for the flight window, dressed the way others will
    // see it: the photo (dimmed with the colour), or the theme, or the colour.
    _windowPreview({ theme, color, photo, dim }) {
        // The real window, in miniature (flight.js's windowMockHtml), dressed
        // in the look the way the viewer's window applies it: see _dressMock.
        if (typeof window !== 'undefined' && typeof window.windowMockHtml === 'function') {
            this._look = { theme, color, photo, dim };
            const mode = typeof window.getFlightWindowMode === 'function' ? window.getFlightWindowMode() : 'horizon';
            return `<div class="pce-win-preview pce-win-real" data-win-mock="${mode}" aria-hidden="true"><div class="wm-fit">${window.windowMockHtml(mode)}</div></div>`;
        }
        const base = color || (theme ? null : '#16181c');
        let bg;
        if (photo) {
            const c = color || '#16181c';
            bg = `linear-gradient(${hexA(c, dim / 100)}, ${hexA(c, dim / 100)}), url("${photo}") center / cover no-repeat`;
        } else if (theme) {
            bg = `linear-gradient(rgba(14,16,20,.35), rgba(14,16,20,.35)), ${presetGradient(theme)}`;
        } else {
            bg = `linear-gradient(180deg, ${mix(base, '#ffffff', 0.12)}, ${base} 55%, ${mix(base, '#000000', 0.5)})`;
        }
        const light = !photo && !theme && isLight(base);
        return `<div class="pce-win-preview${light ? ' is-light' : ''}" style='background: ${bg.replace(/'/g, '%27')}'>
            <div class="pce-win-hero"></div>
            <div class="pce-win-title">Your flight</div>
            <div class="pce-win-route"><b>KLAX</b><span></span><b>KJFK</b></div>
            <div class="pce-win-card"></div>
            <div class="pce-win-card is-short"></div>
        </div>`;
    },

    async _saveWindow(fields, okText) {
        const { supabase } = this._opts;
        await this._run(async () => {
            await PilotProfiles.saveWindowStyle(supabase, fields);
            this._profile = await PilotProfiles.mine(supabase);
            this._changed();
            this._render();
            if (okText) this._say(okText);
        });
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

    // Moderation standing (pilotStanding.js): while a warning has paused
    // uploads, say so at the top and lock the upload buttons — removing a
    // picture still works, that's the pilot complying. The rules line sits
    // under every editor that uploads something other pilots will see.
    _applyStanding() {
        const host = this._host;
        const body = host?.querySelector('#pce-body');
        if (!body || !host.querySelector('input[data-upload]')) return;
        body.querySelectorAll('.pce-paused, .pce-rules').forEach(n => n.remove());
        const s = PilotStanding.get();
        if (s && s.uploadsRestricted) {
            const note = document.createElement('div');
            note.className = 'pce-paused';
            note.setAttribute('role', 'status');
            note.innerHTML = '<i class="fa-solid fa-circle-pause" aria-hidden="true"></i><span></span>';
            note.querySelector('span').textContent = s.uploadsNotice || 'Adding pictures is paused on your account after a warning.';
            body.prepend(note);
            host.querySelectorAll('input[data-upload]').forEach(input => {
                input.disabled = true;
                const label = input.closest('label');
                if (label) { label.classList.add('pce-locked'); label.setAttribute('aria-disabled', 'true'); }
            });
        }
        const rules = document.createElement('p');
        rules.className = 'pce-help pce-rules';
        rules.innerHTML = 'Pictures here are seen by everyone: nothing adult, violent, hateful or harassing, no pretending to be someone else, no ads. '
            + 'Pictures that break the <a href="terms.html#user-content" target="_blank" rel="noopener">Terms</a> are taken down and can bring a warning on your account.'
            + (s && s.activeCount ? ' <button type="button" class="pce-linkbtn" data-standing>Your account standing</button>' : '');
        rules.querySelector('[data-standing]')?.addEventListener('click', () => PilotStanding.openRecord());
        const msg = body.querySelector('#pce-msg');
        if (msg) msg.before(rules); else body.append(rules);
    },

    // Mirrors resolveOwnerBackground/ownerColor in flight.js: a photo is laid
    // under the colour at the pilot's dim; a theme paints its gradient and
    // lends Horizon its darkest stop taken towards night; a colour alone is
    // Horizon's colour and a gentle wash in the other styles.
    _dressMock() {
        const box = this._host?.querySelector('[data-win-mock]');
        if (!box || typeof window.styleWindowMock !== 'function') return;
        const mode = box.dataset.winMock;
        const { theme, color, photo, dim } = this._look || {};
        const horizon = mode === 'horizon';
        const firstStop = theme ? ((presetGradient(theme).match(/#[0-9a-f]{6}/i) || [])[0] || '#16181c') : null;
        const look = {};
        if (photo) {
            Object.assign(look, { img: photo, dim: (Number(dim) || 60) / 100, color: color || (firstStop ? mix(firstStop, '#0e1014', 0.55) : null) });
        } else if (theme && !color) {
            Object.assign(look, { imgCss: presetGradient(theme), dim: horizon ? 0.55 : 0.4, color: mix(firstStop, '#0e1014', 0.55) });
        } else if (color) {
            Object.assign(look, horizon ? { color } : { imgCss: `linear-gradient(180deg, ${mix(color, '#ffffff', 0.18)}, ${color}, ${mix(color, '#000000', 0.55)})`, dim: 0.35 });
        }
        window.styleWindowMock(box.querySelector('.wm'), mode, look);
        if (typeof window.fitWindowMock === 'function') window.fitWindowMock(box);
    },

    _wire() {
        const host = this._host;
        this._dressMock();
        this._applyStanding();
        if (!this._standingHooked) {
            this._standingHooked = true;
            window.addEventListener('inflight:pilot-standing', () => { if (this._host?.isConnected) this._applyStanding(); });
        }
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
        // Flight window look. A theme and a colour are either/or: picking one
        // clears the other, so what the preview shows is what others see.
        host.querySelectorAll('[data-win-theme]').forEach(btn => {
            btn.addEventListener('click', () => {
                const theme = btn.dataset.winTheme || null;
                const fields = { theme };
                if (this._opts.isPro && this._profile?.row?.window_color) fields.color = null;
                this._saveWindow(fields, theme ? 'Window theme saved.' : 'Window theme removed.');
            });
        });
        const color = host.querySelector('[data-win-color]');
        if (color) {
            const dot = host.querySelector('.pce-color-dot');
            color.addEventListener('input', () => { if (dot) dot.style.background = color.value; });
            color.addEventListener('change', () => this._saveWindow({ color: color.value, theme: null }, 'Window colour saved.'));
        }
        host.querySelector('[data-win-color-clear]')?.addEventListener('click', () => this._saveWindow({ color: null }, 'Window colour removed.'));
        const dim = host.querySelector('[data-win-dim]');
        if (dim) {
            const out = dim.parentElement.querySelector('output');
            dim.addEventListener('input', () => { if (out) out.textContent = dim.value + '%'; });
            dim.addEventListener('change', () => this._saveWindow({ dim: Number(dim.value) }));
        }
        host.querySelector('[data-win-flair]')?.addEventListener('change', (e) => {
            this._saveWindow({ flair: e.target.checked }, e.target.checked ? 'Pro flair on.' : 'Pro flair off.');
        });
    },

    async _upload(kind, file) {
        const { supabase, isPro } = this._opts;
        if (kind === 'banner' && !isPro) { this._say('Photo banners are an Inflight Pro feature.', true); return; }
        if (kind === 'window' && !isPro) { this._say('A window photo is an Inflight Pro feature.', true); return; }
        await this._run(async () => {
            this._say('');
            // The window photo is framed over a sketch of the flight window,
            // with its Dim laid in the window colour others will see.
            let dim = null;
            const row = this._profile?.row || {};
            const extra = kind === 'window' ? {
                guide: 'window',
                dim: { value: Number(row.window_bg_dim) || 60, rgb: rgbOf(row.window_color || '#16181c').join(',') },
            } : {};
            const data = await pickAndEncode(file, kind, extra, (d) => { dim = d; });
            if (!data) return;
            this._say(`Uploading your ${KIND_NAME[kind]}…`);
            await PilotProfiles.upload(supabase, kind, data);
            if (kind === 'window' && dim != null && dim !== (Number(row.window_bg_dim) || 60)) {
                await PilotProfiles.saveWindowStyle(supabase, { dim });
            }
            this._profile = await PilotProfiles.mine(supabase);
            this._changed();
            this._render();
            this._say(kind === 'avatar' ? 'Picture updated.' : kind === 'window' ? 'Window photo updated.' : 'Banner updated.');
        });
    },

    async _remove(kind) {
        const { supabase } = this._opts;
        await this._run(async () => {
            await PilotProfiles.remove(supabase, kind);
            this._profile = await PilotProfiles.mine(supabase);
            this._changed();
            this._render();
            this._say(kind === 'avatar' ? 'Picture removed.' : kind === 'window' ? 'Window photo removed.' : 'Banner photo removed.');
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
            this._say(err.needsPro ? (err.message || 'That is part of Inflight Pro.') : (err.message || 'Something went wrong.'), true);
            if (err.uploadsPaused) PilotStanding.refresh();
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
            .pce-paused {
                display: flex; gap: 10px; align-items: baseline; margin: 0 0 14px; padding: 10px 12px; border-radius: 12px;
                background: rgba(248,113,113,.1); border: 1px solid rgba(248,113,113,.28); color: #fca5a5; font-size: .84rem; line-height: 1.45;
            }
            .pce-rules { margin-top: 16px; font-size: .76rem; }
            .pce-rules a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
            .pce-linkbtn { border: 0; background: none; padding: 0; font: inherit; color: inherit; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
            .pce-msg.is-error { color: #f87171; }
            @media (max-width: 560px) { .pce-swatches { grid-template-columns: repeat(3, minmax(0, 1fr)); } }

            /* Your flight window */
            .pce-label-lg { scroll-margin-top: 84px; margin-top: 26px; padding-top: 18px; border-top: 1px solid var(--pui-border, rgba(255,255,255,.1)); }
            .pce-help-top { margin: -2px 0 12px; }
            .pce-sublabel { font-size: .72rem; font-weight: 600; color: var(--pui-text-muted, #94a3b8); margin: 14px 0 8px; }
            .pce-sublabel:first-child { margin-top: 0; }
            .pce-win-wrap { display: flex; gap: 18px; align-items: flex-start; }
            .pce-win-controls { flex: 1; min-width: 0; }
            .pce-win-themes { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 0; }
            .pce-win-themes .pce-swatch { height: 40px; }
            .pce-swatch-none {
                background: repeating-linear-gradient(135deg, rgba(255,255,255,.06) 0 6px, transparent 6px 12px);
                border: 1px dashed var(--pui-border, rgba(255,255,255,.2));
                color: var(--pui-text-muted, #cbd5e1); text-shadow: none;
            }
            .pce-win-preview {
                position: relative; box-sizing: border-box; flex: 0 0 132px; height: 236px; border-radius: 16px; overflow: hidden;
                padding: 0 10px; color: #fff; box-shadow: 0 10px 28px rgba(0,0,0,.35), inset 0 0 0 1px rgba(255,255,255,.08);
                transition: background .3s ease;
            }
            .pce-win-preview.is-light { color: #15171b; }
            .pce-win-real { padding: 0; background: #18181b; }
            .pce-win-real .wm-fit { position: absolute; left: 0; top: 0; width: 360px; transform-origin: 0 0; transform: scale(var(--wm-k, .37)); pointer-events: none; }
            .pce-win-hero {
                height: 74px; margin: 0 -10px; border-radius: 0;
                background: linear-gradient(180deg, rgba(255,255,255,.18), rgba(255,255,255,0));
                -webkit-mask-image: linear-gradient(#000 40%, transparent); mask-image: linear-gradient(#000 40%, transparent);
            }
            .pce-win-title { font-size: .72rem; font-weight: 700; margin-top: -26px; text-shadow: 0 1px 4px rgba(0,0,0,.35); }
            .pce-win-preview.is-light .pce-win-title { text-shadow: none; }
            .pce-win-route {
                display: flex; align-items: center; gap: 6px; margin: 16px 0 10px; font-size: .62rem;
                padding: 8px; border-radius: 10px; background: rgba(127,127,127,.16); backdrop-filter: blur(6px);
            }
            .pce-win-route span { flex: 1; height: 2px; border-radius: 2px; background: currentColor; opacity: .35; }
            .pce-win-card { height: 38px; border-radius: 10px; background: rgba(127,127,127,.16); margin-bottom: 8px; }
            .pce-win-card.is-short { height: 58px; }
            .pce-color-btn { position: relative; }
            .pce-color-btn input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; border: 0; padding: 0; }
            .pce-color-dot { width: 16px; height: 16px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(255,255,255,.35); }
            .pce-dim { display: flex; align-items: center; gap: 10px; margin-top: 10px; font-size: .8rem; color: var(--pui-text-muted, #a1a1aa); }
            .pce-dim input { flex: 1; accent-color: #38bdf8; }
            .pce-dim output { width: 38px; text-align: right; font-variant-numeric: tabular-nums; }
            .pce-check { display: flex; gap: 10px; align-items: flex-start; margin-top: 14px; font-size: .8rem; line-height: 1.45;
                         color: var(--pui-text-muted, #a1a1aa); cursor: pointer; }
            .pce-check input { margin-top: 3px; accent-color: #f5c451; }
            .pce-check b { color: var(--pui-text, #e5e7eb); font-weight: 600; }
            @media (max-width: 560px) {
                .pce-win-wrap { flex-direction: column; align-items: stretch; }
                .pce-win-preview { flex: none; width: 100%; height: 170px; }
                .pce-win-hero { height: 58px; }
                .pce-win-card.is-short { display: none; }
                .pce-win-preview.pce-win-real { width: 150px; height: 266px; margin: 0 auto; }
            }
        `;
        document.head.appendChild(style);
    },
};
