/* ============================================================================
   crewNotices.js — the VA's noticeboard, and the dashboard's recent activity.

   TWO THINGS, ONE FEED, ON PURPOSE

   The crew center used to show a "Recent activity" list built from three
   invented rows — Jordan Lee joined as First Officer, ACA412 landed at EGLL,
   Sam Park promoted to Captain. Every VA saw the same three strangers on their
   own dashboard, above a roster that did not contain them.

   Meanwhile the backend had been quietly recording the real versions of
   exactly those events for a release: a pilot joining, a promotion, a
   check-ride coming due, an event being published, a schedule going up. They
   land on the VA's own noticeboard (crew_announcements) with a `kind`, and
   `source: 'auto'` distinguishes them from what a human wrote.

   So there is no second feed to build. Recent activity IS the noticeboard,
   read short and drawn tight; the panel is the same rows read long, plus the
   ability to write one. One fetch feeds both.

   WHAT STAFF CAN DO, AND WHAT THEY CANNOT

   Staff write notices. They may pin any row — keeping a promotion at the top
   of the board is reasonable — but they may not EDIT a generated one, and the
   backend enforces that rather than trusting this file. A hand-written row
   claiming to be a promotion would be indistinguishable on the board from one
   that actually happened, and a noticeboard that can be forged is not a
   record of anything.

   WHAT IT NEEDS FROM ITS HOST

   A backend origin, a slug and a way to get the session token:

       CrewNotices.mount({ backend: BACKEND, slug: getSlug(), token: sessionToken });

   Then CrewNotices.open() from a button, and CrewNotices.renderActivity(el)
   to paint the live feed wherever the page wants it.

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewNotices: crewPanels.js must load first'); return; }
    const { esc, icons, relativeText, whenText } = P;

    const S = {
        api: null,
        slug: '',
        notices: [],
        canManage: false,
        loaded: false,
        error: null,       // why the board could not be read, when it could not
        posting: false,
        backend: '',
        token: () => '',
        // "Also post to Discord", as the composer last had it. Lives here rather
        // than in the form because the form is rebuilt by every render.
        share: { on: false, style: 'notice', image: '', ping: 'none' },
    };

    /* ---------------------------------------------------------------------
     * Discord banners
     *
     * A notice can also go to the airline's Discord, opening with a banner:
     * drawn by the backend in the airline's colours in one of four styles, or
     * the staff member's own upload. The preview is the real picture from the
     * same renderer, so what they see here is what lands in the channel.
     * ------------------------------------------------------------------- */
    const BANNERS = [
        { id: 'notice', label: 'Notice', icon: 'megaphone' },
        { id: 'event', label: 'Event', icon: 'calendar-days' },
        { id: 'celebration', label: 'Celebration', icon: 'party-popper' },
        { id: 'urgent', label: 'Urgent', icon: 'triangle-alert' },
        { id: 'own', label: 'My own image', icon: 'image-up' },
        { id: 'none', label: 'No banner', icon: 'ban' },
    ];
    const SHARE_KEY = 'crew:notice:discord';
    try { S.share.on = localStorage.getItem(SHARE_KEY) === '1'; } catch (_) { /* private mode */ }

    let panel = null;

    /* ---------------------------------------------------------------------
     * How each kind of row reads
     *
     * The icon and the wording carry the difference between "the crew center
     * noticed something" and "a person said something", which is the only
     * distinction a pilot glancing at the board actually needs.
     * ------------------------------------------------------------------- */
    const KINDS = {
        notice:    { icon: 'megaphone',   label: 'Notice' },
        promotion: { icon: 'badge-check', label: 'Promotion' },
        join:      { icon: 'user-plus',   label: 'New pilot' },
        event:     { icon: 'calendar-days', label: 'Event' },
        checkride: { icon: 'clipboard-check', label: 'Check-ride' },
        schedule:  { icon: 'calendar-clock', label: 'Schedule' },
        // The other half of 'join'. A board that announces only the arrivals
        // is a board where people quietly stop existing.
        leave:     { icon: 'user-minus',  label: 'Left the airline' },
        // v20. Somebody joining or leaving the team that RUNS the airline. Its
        // own kind rather than folded into 'promotion', because the two answer
        // different questions: a promotion is how far up the ladder somebody
        // has got, and this is who can now act on everybody else's behalf. The
        // board used to record only the first.
        staff:     { icon: 'briefcase',   label: 'Staff team' },
    };
    const kindOf = (n) => KINDS[n && n.kind] || KINDS.notice;

    /* =====================================================================
     * DATA
     * =================================================================== */

    async function load() {
        try {
            const d = await S.api('/announcements');
            S.notices = Array.isArray(d.announcements) ? d.announcements : [];
            S.canManage = !!d.canManage;
            S.error = null;
        } catch (err) {
            // Kept rather than thrown: both surfaces want to SAY why the board
            // is empty, and an exception that reached the caller would leave a
            // dashboard tile blank with the reason in the console.
            S.error = err;
            S.notices = [];
        }
        S.loaded = true;
        paintAll();
        return S.notices;
    }

    /* =====================================================================
     * RECENT ACTIVITY — the dashboard's list
     * =================================================================== */

    const activityHosts = new Map();   // el -> { limit }

    /**
     * Paint the feed into a host element.
     *
     * Draws nothing at all — not a placeholder, not a zero — until the fetch
     * has landed. Until then we do not know what this VA's week looked like,
     * and inventing a quiet one is the bug this module was written to remove.
     */
    function paintActivity(el, limit) {
        if (!el) return;

        if (!S.loaded) { el.innerHTML = ''; return; }

        if (S.error) {
            // A database that predates the noticeboard is not an error worth
            // shouting about on a dashboard — it is a thing to fix in settings,
            // and the panel says so properly when opened.
            el.innerHTML = `<li class="cn-empty">${esc(
                P.isSchemaGap(S.error)
                    ? 'Your database needs updating before the crew center can keep a noticeboard.'
                    : 'Couldn’t load recent activity.')}</li>`;
            return;
        }

        if (!S.notices.length) {
            el.innerHTML = `<li class="cn-empty">Nothing yet — pilots joining, promotions and
                published flying all land here.</li>`;
            return;
        }

        el.innerHTML = S.notices.slice(0, limit).map((n, i) => {
            const k = kindOf(n);
            return `<li class="cn-row${i ? ' cn-row-sep' : ''}">
                <span class="cn-row-icon"><i data-lucide="${esc(k.icon)}"></i></span>
                <span class="cn-row-text">
                    ${n.pinned ? '<i data-lucide="pin" class="cn-pin"></i> ' : ''}${esc(n.title)}
                    ${n.body ? `<span class="cn-row-body">${esc(n.body)}</span>` : ''}
                </span>
                <span class="cn-row-when">${esc(relativeText(n.createdAt))}</span>
            </li>`;
        }).join('');
        icons();
    }

    function paintAll() {
        activityHosts.forEach((opts, el) => {
            // A host that has been removed from the page (a panel re-rendered
            // around it) must not keep us painting into a detached node.
            if (!el.isConnected) { activityHosts.delete(el); return; }
            paintActivity(el, opts.limit);
        });
        if (panel && panel.isOpen()) renderPanel();
    }

    /* =====================================================================
     * THE PANEL
     * =================================================================== */

    function noticeCard(n) {
        const k = kindOf(n);
        const auto = !!n.auto;
        return `<article class="cp-card cn-card${n.pinned ? ' cn-card-pinned' : ''}" data-id="${esc(n.id)}">
            <div class="cn-card-head">
                <span class="cp-chip ${n.pinned ? 'cp-chip-accent' : 'cp-chip-mute'}">
                    <i data-lucide="${esc(k.icon)}"></i> ${esc(k.label)}
                </span>
                <span class="cp-fact">${esc(whenText(n.createdAt))}</span>
                ${S.canManage ? `<span class="cn-card-tools">
                    ${auto ? '' : `<button class="cp-btn cp-btn-sm" data-share="${esc(n.id)}" title="Post this to Discord with a banner">
                        <i data-lucide="send"></i> Discord
                    </button>`}
                    <button class="cp-btn cp-btn-sm" data-pin="${esc(n.id)}" title="${n.pinned ? 'Unpin' : 'Pin to the top'}">
                        <i data-lucide="pin"></i> ${n.pinned ? 'Unpin' : 'Pin'}
                    </button>
                    <button class="cp-btn cp-btn-sm cp-btn-bad" data-del="${esc(n.id)}" title="Remove">
                        <i data-lucide="trash-2"></i>
                    </button>
                </span>` : ''}
            </div>
            <h3 class="cp-card-title">${esc(n.title)}</h3>
            ${n.body ? `<p class="cn-card-body">${esc(n.body)}</p>` : ''}
            <div class="cn-card-foot cp-faint">
                ${auto
                    ? 'Recorded by the crew center'
                    : (n.authorName ? `Posted by ${esc(n.authorName)}` : 'Posted by staff')}
            </div>
        </article>`;
    }

    /**
     * Draw the panel, keeping the reader where they were.
     *
     * This panel is re-drawn by everything that changes anything in it, and a
     * plain innerHTML assignment drops the caret every time and the scroll
     * offset whenever the new content is shorter than where the reader was — so
     * a list that filters down under an action puts them back at the top, which
     * reads as the page having scrolled itself. keepPlace restores all three.
     *
     * No view key: this panel only ever draws the noticeboard.
     */
    function renderPanel() { P.keepPlace(panel.body, drawPanel); }

    function drawPanel() {
        const body = panel.body;

        if (!S.loaded) {
            body.innerHTML = '<div class="cp-empty">Loading the noticeboard…</div>';
            return;
        }
        if (S.error && P.isSchemaGap(S.error)) {
            body.innerHTML = P.schemaGapHtml(S.error);
            icons();
            wireStoreFix(body);
            return;
        }
        if (S.error) {
            body.innerHTML = `<div class="cp-empty"><i data-lucide="alert-triangle"></i>${esc(S.error.message)}</div>`;
            icons();
            return;
        }

        const composer = S.canManage ? `
            <form class="cp-card cn-composer" id="cnCompose">
                <label class="cp-label" for="cnTitle">Post a notice</label>
                <input id="cnTitle" class="cp-input" maxlength="160" required
                    placeholder="What does the crew need to know?">
                <textarea id="cnBody" class="cp-textarea" maxlength="4000"
                    placeholder="Anything more (optional)"></textarea>
                <div class="cn-share">
                    <label class="cp-fact"><input type="checkbox" id="cnDiscord"${S.share.on ? ' checked' : ''}>
                        <i data-lucide="send-to-back"></i> Also post to Discord</label>
                    <div class="cn-share-opts${S.share.on ? '' : ' cp-hidden'}" id="cnShareOpts">
                        <div class="cp-label">Banner</div>
                        <div class="cn-styles" role="radiogroup" aria-label="Banner">
                            ${BANNERS.map((b) => `<button type="button" role="radio" class="cn-style${S.share.style === b.id ? ' cn-style-on' : ''}"
                                data-style="${b.id}" aria-checked="${S.share.style === b.id}"><i data-lucide="${b.icon}"></i> ${esc(b.label)}</button>`).join('')}
                        </div>
                        <div class="cn-own${S.share.style === 'own' ? '' : ' cp-hidden'}" id="cnOwn">
                            <input type="file" id="cnOwnFile" accept="image/png,image/jpeg,image/gif,image/webp" class="cp-input">
                            <p class="cp-note">Wide pictures look best — about 1200 × 500.</p>
                        </div>
                        <div class="cn-preview${S.share.style === 'none' ? ' cp-hidden' : ''}" id="cnPreviewWrap">
                            <img id="cnPreview" class="cp-hidden" alt="Banner preview">
                            <span class="cn-preview-hint" id="cnPreviewHint">Type a title to see the banner.</span>
                        </div>
                        <label class="cp-label" for="cnPing">Notify</label>
                        <select id="cnPing" class="cp-input">
                            <option value="none"${S.share.ping === 'none' ? ' selected' : ''}>Nobody — just post it</option>
                            <option value="here"${S.share.ping === 'here' ? ' selected' : ''}>@here — whoever is online</option>
                            <option value="everyone"${S.share.ping === 'everyone' ? ' selected' : ''}>@everyone</option>
                        </select>
                        <p class="cp-note">Goes to the Announcements channel in Settings → Alerts, or your main Discord webhook if that isn’t set.</p>
                    </div>
                </div>
                <div class="cn-composer-foot">
                    <label class="cp-fact"><input type="checkbox" id="cnPin"> Pin to the top</label>
                    <button type="submit" class="cp-btn cp-btn-primary" id="cnPost">
                        <i data-lucide="send"></i> Post
                    </button>
                </div>
                <p class="cp-note cp-hidden" id="cnNote"></p>
            </form>` : '';

        const list = S.notices.length
            ? S.notices.map(noticeCard).join('')
            : `<div class="cp-empty"><i data-lucide="megaphone"></i>
                Nothing on the board yet.${S.canManage ? ' Post the first notice above.' : ''}</div>`;

        body.innerHTML = composer + list;
        icons();
        wirePanel(body);
    }

    function wirePanel(body) {
        // The composer is rebuilt by every render, so its listener goes on the
        // fresh element each time.
        const form = body.querySelector('#cnCompose');
        if (form) {
            form.addEventListener('submit', onPost);
            wireShare(form);
        }

        // The delegated handler is not: `body` survives renders, so attaching
        // it again stacked it. Two handlers meant one tap on the bin asking
        // "remove this?" twice and sending two DELETEs. See crewSchedule's
        // wireList for the version of this that reached a booking.
        if (body.dataset.cnWired) return;
        body.dataset.cnWired = '1';

        body.addEventListener('click', async (ev) => {
            const share = ev.target.closest('[data-share]');
            if (share) { shareExisting(share); return; }
            const pin = ev.target.closest('[data-pin]');
            const del = ev.target.closest('[data-del]');
            if (!pin && !del) return;

            const id = (pin || del).getAttribute(pin ? 'data-pin' : 'data-del');
            const notice = S.notices.find((n) => String(n.id) === String(id));
            if (!notice) return;

            try {
                if (pin) {
                    await S.api(`/announcements/${encodeURIComponent(id)}`, {
                        method: 'PATCH', body: { pinned: !notice.pinned },
                    });
                    P.toast(notice.pinned ? 'Unpinned.' : 'Pinned to the top.', 'ok');
                } else {
                    // Deliberately confirmed. Everything else on this board is
                    // reversible; this is not, and a generated row is the only
                    // record that a pilot joined on the day they did.
                    if (!window.confirm('Remove this from the noticeboard?')) return;
                    await S.api(`/announcements/${encodeURIComponent(id)}`, { method: 'DELETE' });
                    P.toast('Removed.', 'ok');
                }
                await load();
            } catch (err) {
                P.toast(err.message || 'That didn’t work.', 'bad');
            }
        });
    }

    async function onPost(ev) {
        ev.preventDefault();
        if (S.posting) return;

        const title = document.getElementById('cnTitle');
        const bodyEl = document.getElementById('cnBody');
        const pin = document.getElementById('cnPin');
        const note = document.getElementById('cnNote');
        const btn = document.getElementById('cnPost');

        const t = title.value.trim();
        if (!t) { title.focus(); return; }

        const sh = S.share;
        if (sh.on && sh.style === 'own' && !sh.image) {
            note.textContent = 'Choose your banner image first, or pick one of the drawn styles.';
            note.className = 'cp-note cp-note-bad';
            return;
        }

        S.posting = true;
        btn.disabled = true;
        note.classList.add('cp-hidden');
        try {
            const d = await S.api('/announcements', {
                method: 'POST',
                body: {
                    title: t, body: bodyEl.value.trim(), pinned: !!pin.checked,
                    ...(sh.on ? shareBody() : {}),
                },
            });
            sayShared(d.discord, 'Posted to the noticeboard');
            await load();
        } catch (err) {
            note.textContent = err.message || 'Could not post that.';
            note.className = 'cp-note cp-note-bad';
            btn.disabled = false;
        } finally {
            S.posting = false;
        }
    }

    /** What the backend wants for a share, from the composer's state. */
    function shareBody() {
        const sh = S.share;
        return {
            discord: true,
            banner: sh.style !== 'none',
            bannerStyle: sh.style === 'own' || sh.style === 'none' ? 'notice' : sh.style,
            bannerImage: sh.style === 'own' ? sh.image : '',
            ping: sh.ping,
        };
    }

    /** One toast for every outcome of a post, Discord half included. */
    function sayShared(discord, board) {
        if (!discord) { P.toast(`${board}.`, 'ok'); return; }
        if (discord.sent) P.toast(discord.warning ? `${board} and Discord. ${discord.warning}` : `${board} and Discord.`, discord.warning ? 'info' : 'ok');
        else P.toast(`${board}, but not to Discord: ${discord.error || 'it didn’t go through.'}`, 'bad');
    }

    // A notice already on the board, to Discord — for one written before the box
    // was ticked. Uses whichever banner the composer is set to.
    async function shareExisting(btn) {
        const id = btn.getAttribute('data-share');
        const n = S.notices.find((x) => String(x.id) === String(id));
        if (!n) return;
        if (!window.confirm(`Post “${n.title}” to your Discord?`)) return;
        btn.disabled = true;
        try {
            const sh = S.share;
            const own = sh.style === 'own' && sh.image;
            const d = await S.api(`/announcements/${encodeURIComponent(id)}/discord`, {
                method: 'POST',
                body: { ...shareBody(), ...(sh.style === 'own' && !own ? { bannerStyle: 'notice', bannerImage: '', banner: true } : {}) },
            });
            P.toast(d.discord && d.discord.warning ? `Posted to Discord. ${d.discord.warning}` : 'Posted to Discord.', 'ok');
        } catch (err) {
            P.toast(err.message || 'Could not post that to Discord.', 'bad');
        } finally { btn.disabled = false; }
    }

    let previewTimer = null;
    let previewUrl = '';
    function refreshPreview() {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(drawPreview, 450);
    }
    async function drawPreview() {
        const img = document.getElementById('cnPreview');
        const hint = document.getElementById('cnPreviewHint');
        const titleEl = document.getElementById('cnTitle');
        if (!img || !S.share.on) return;
        const sh = S.share;
        const show = (src, msg) => {
            img.classList.toggle('cp-hidden', !src);
            if (src) img.src = src;
            if (hint) { hint.textContent = msg || ''; hint.classList.toggle('cp-hidden', !msg); }
        };
        if (sh.style === 'none') return;
        if (sh.style === 'own') { show(sh.image, sh.image ? '' : 'Choose an image to see it here.'); return; }
        const title = titleEl ? titleEl.value.trim() : '';
        if (!title) { show('', 'Type a title to see the banner.'); return; }
        const bodyEl = document.getElementById('cnBody');
        const q = new URLSearchParams({ style: sh.style, title, body: bodyEl ? bodyEl.value.trim().slice(0, 300) : '' });
        try {
            const t = S.token();
            const res = await fetch(`${S.backend}/api/crew/${encodeURIComponent(S.slug)}/announcements/banner.png?${q}`, {
                headers: t ? { Authorization: 'Bearer ' + t } : {},
            });
            if (!res.ok) { show('', res.status === 404 ? 'Banner previews aren’t available on this server yet.' : 'Couldn’t draw the preview.'); return; }
            const blob = await res.blob();
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            previewUrl = URL.createObjectURL(blob);
            show(previewUrl, '');
        } catch (_) { show('', 'Couldn’t draw the preview.'); }
    }

    async function uploadOwn(file, note) {
        if (!file) return;
        const say = (msg, bad) => { note.textContent = msg; note.className = 'cp-note' + (bad ? ' cp-note-bad' : ''); };
        say('Uploading…');
        try {
            const fd = new FormData();
            fd.append('image', file);
            const t = S.token();
            const res = await fetch(`${S.backend}/api/crew/${encodeURIComponent(S.slug)}/announcements/banner`, {
                method: 'POST', headers: t ? { Authorization: 'Bearer ' + t } : {}, body: fd,
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok || !d.url) { say(d.error || 'That image could not be uploaded.', true); return; }
            S.share.image = d.url;
            say('Uploaded — this is the banner Discord will show.');
            drawPreview();
        } catch (_) { say('Server unreachable. Try again.', true); }
    }

    function wireShare(form) {
        const box = form.querySelector('#cnDiscord');
        const opts = form.querySelector('#cnShareOpts');
        const own = form.querySelector('#cnOwn');
        const wrap = form.querySelector('#cnPreviewWrap');
        if (!box || !opts) return;
        box.addEventListener('change', () => {
            S.share.on = box.checked;
            try { localStorage.setItem(SHARE_KEY, box.checked ? '1' : '0'); } catch (_) { /* private mode */ }
            opts.classList.toggle('cp-hidden', !box.checked);
            if (box.checked) drawPreview();
        });
        form.querySelectorAll('[data-style]').forEach((b) => b.addEventListener('click', () => {
            S.share.style = b.getAttribute('data-style');
            form.querySelectorAll('[data-style]').forEach((o) => {
                const on = o === b;
                o.classList.toggle('cn-style-on', on);
                o.setAttribute('aria-checked', String(on));
            });
            own.classList.toggle('cp-hidden', S.share.style !== 'own');
            wrap.classList.toggle('cp-hidden', S.share.style === 'none');
            drawPreview();
        }));
        const file = form.querySelector('#cnOwnFile');
        if (file) file.addEventListener('change', () => uploadOwn(file.files && file.files[0], own.querySelector('.cp-note')));
        const ping = form.querySelector('#cnPing');
        if (ping) ping.addEventListener('change', () => { S.share.ping = ping.value; });
        ['#cnTitle', '#cnBody'].forEach((sel) => {
            const el = form.querySelector(sel);
            if (el) el.addEventListener('input', refreshPreview);
        });
        if (S.share.on) drawPreview();
    }

    /**
     * The "update my database" button on a schema gap.
     *
     * The panel does not own that flow — the dashboard's settings screen does —
     * so this opens it rather than reimplementing an upgrade a second time.
     */
    function wireStoreFix(root) {
        const btn = root.querySelector('[data-cp-fix-store]');
        if (!btn) return;
        btn.addEventListener('click', () => {
            panel.close();
            if (typeof window.openSettings === 'function') window.openSettings('data');
            else P.toast('Open Settings → Data store to update your database.', 'info');
        });
    }

    /* =====================================================================
     * STYLES
     * =================================================================== */

    function injectStyles() {
        P.baseStyles();
        P.style('cn-styles', `
        .cn-row{ display:flex; align-items:flex-start; gap:.75rem; padding:.7rem 0; }
        .cn-row-sep{ border-top:1px solid var(--line-soft,#F0ECE4); }
        .cn-row-icon{ color:var(--muted,#736E64); flex-shrink:0; padding-top:.1rem; }
        .cn-row-icon i{ width:1.1rem; height:1.1rem; }
        .cn-row-text{ font-size:.875rem; flex:1; min-width:0; color:var(--ink,#1C1A16); }
        .cn-row-body{ display:block; font-size:.8rem; color:var(--muted,#736E64);
            overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .cn-row-when{ font-size:.75rem; color:var(--faint,#A8A296); flex-shrink:0; white-space:nowrap; }
        .cn-pin{ width:.8rem; height:.8rem; color:var(--accent,#1C1A16); vertical-align:-1px; }
        .cn-empty{ font-size:.85rem; color:var(--muted,#736E64); padding:.7rem 0; list-style:none; }

        .cn-composer{ display:grid; gap:.6rem; }
        .cn-share{ display:grid; gap:.55rem; padding:.7rem .8rem; border:1px solid var(--line-soft,#F0ECE4); border-radius:.75rem; }
        .cn-share input[type=checkbox]{ accent-color:var(--accent,#1C1A16); }
        .cn-share-opts{ display:grid; gap:.55rem; }
        .cn-styles{ display:flex; flex-wrap:wrap; gap:.4rem; }
        .cn-style{ display:inline-flex; align-items:center; gap:.35rem; font-size:.78rem; font-weight:600;
            padding:.35rem .65rem; border-radius:999px; border:1px solid var(--line,#E5E0D6);
            background:transparent; color:var(--ink,#1C1A16); cursor:pointer; }
        .cn-style i{ width:.9rem; height:.9rem; }
        .cn-style-on{ border-color:var(--accent,#1C1A16); background:color-mix(in srgb, var(--accent,#1C1A16) 12%, transparent); }
        .cn-preview{ position:relative; border-radius:.6rem; overflow:hidden; background:var(--line-soft,#F0ECE4);
            aspect-ratio:12/5; display:grid; place-items:center; }
        .cn-preview img{ width:100%; height:100%; object-fit:cover; display:block; }
        .cn-preview-hint{ font-size:.8rem; color:var(--muted,#736E64); padding:0 1rem; text-align:center; }
        .cn-composer-foot{ display:flex; align-items:center; justify-content:space-between; gap:.75rem; }
        .cn-composer-foot input[type=checkbox]{ accent-color:var(--accent,#1C1A16); }

        .cn-card{ display:grid; gap:.45rem; }
        .cn-card-pinned{ border-color:var(--accent,#1C1A16); }
        .cn-card-head{ display:flex; align-items:center; gap:.6rem; flex-wrap:wrap; }
        .cn-card-tools{ margin-left:auto; display:flex; gap:.35rem; }
        .cn-card-body{ margin:0; font-size:.85rem; color:var(--muted,#736E64); white-space:pre-wrap; }
        .cn-card-foot{ font-size:.72rem; }

        /* Mobile. The card's tools drop below the meta rather than squeezing it
           to nothing, and the composer's actions become a full-width row —
           "Post" is the reason the panel was opened, so it gets the width. */
        @media (max-width:40rem){
            .cn-card-head{ gap:.4rem; }
            .cn-card-tools{ margin-left:0; width:100%; }
            .cn-card-tools .cp-btn{ flex:1 1 0; justify-content:center; }
            .cn-composer-foot{ flex-direction:column; align-items:stretch; gap:.6rem; }
            .cn-composer-foot .cp-btn{ justify-content:center; }
            .cn-composer-foot label{ order:2; justify-content:center; }
            .cn-row{ padding:.8rem 0; }
            .cn-row-body{ white-space:normal; }
        }`);
    }

    /* =====================================================================
     * PUBLIC API
     * =================================================================== */

    function ensurePanel() {
        if (panel) return panel;
        injectStyles();
        panel = P.sheet({ id: 'cnPanel', title: 'Noticeboard', icon: 'megaphone' });
        return panel;
    }

    function open() {
        ensurePanel();
        panel.open();
        renderPanel();
        // Always re-read on open. A noticeboard is exactly the thing somebody
        // else changed while this tab sat there.
        load();
    }

    function mount({ backend, slug, token }) {
        injectStyles();
        S.api = P.api({ backend, slug, token });
        S.backend = String(backend || '').replace(/\/+$/, '');
        S.token = typeof token === 'function' ? token : () => String(token || '');
        S.slug = String(slug || '').toLowerCase();
        if (!S.slug) return Promise.resolve([]);
        return load();
    }

    /** Paint the live feed into a host element, and keep it painted. */
    function renderActivity(el, { limit = 6 } = {}) {
        if (!el) return;
        injectStyles();
        activityHosts.set(el, { limit });
        paintActivity(el, limit);
    }

    window.CrewNotices = {
        mount, open, renderActivity,
        close: () => panel && panel.close(),
        reload: () => load(),
        get canManage() { return S.canManage; },
        get notices() { return S.notices.slice(); },
    };
})();
