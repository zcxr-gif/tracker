/* ============================================================================
   crewPartnership.js — where the VA stands with Inflight, shown in their own
   crew center.

   THE PROBLEM THIS SOLVES

   A partnered VA has a relationship with us that lives in three places they
   have to go looking for: their directory listing, the Terms they accepted, and
   any warning we have issued. All three are administered in the VA Partnership
   Portal, behind its own separate login.

   That is the right home for administering them. What was wrong is that the
   person running the airline — sitting in their crew center, where they spend
   their time — had no way to see ANY of it. Terms move. A warning gets issued.
   The flight-events feed gets approved. They find out when they next happen to
   sign into a different product, which for most VAs is never.

   SO THIS IS A WINDOW, DELIBERATELY

   It reads. It does not write. Every action links out to the portal, where the
   VA's side of the partnership is actually managed.

   That is a design decision, not a shortcut. Making these buttons work from
   here would mean bridging a crew-center session into portal-authorised
   actions — one login quietly acquiring another login's powers — and
   acknowledging Terms is precisely the kind of thing that must be done by
   somebody who signed in to do it. The panel is honest about this: it says
   where each thing is changed and takes them there.

   WHO CAN SEE IT

   The owner, and Inflight oversight. Not staff. A VA's staff run the airline;
   its standing with us — warnings especially — is the owner's business, and the
   backend enforces that rather than trusting this file. A staff member who
   opens the tile is told plainly that it is owner-only, which is better than a
   tile that silently does nothing.

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewPartnership: crewPanels.js must load first'); return; }
    const { esc, icons, whenText, relativeText } = P;

    const S = { api: null, data: null, loading: false, error: null };
    let panel = null;

    /* =====================================================================
     * DATA
     * =================================================================== */

    async function load() {
        S.loading = true;
        render();
        try {
            S.data = await S.api('/partnership');
            S.error = null;
        } catch (err) {
            S.error = err;
            S.data = null;
        }
        S.loading = false;
        render();
    }

    /* =====================================================================
     * RENDER
     * =================================================================== */

    function render() {
        if (!panel) return;
        const body = panel.body;

        if (S.loading && !S.data) {
            body.innerHTML = '<div class="cp-empty">Reading your partnership…</div>';
            return;
        }
        if (S.error) {
            // 403 is not a fault — it is the answer. Saying "only the owner can
            // see this" is useful; "something went wrong" would send a staff
            // member to ask the owner to raise a bug.
            const owned = S.error.status === 403;
            body.innerHTML = `<div class="cp-empty">
                <i data-lucide="${owned ? 'lock' : 'alert-triangle'}"></i>
                ${esc(owned
                    ? 'Only the VA owner can see the partnership. Ask whoever holds the owner account.'
                    : (S.error.message || 'Could not read your partnership.'))}
            </div>`;
            icons();
            return;
        }
        if (!S.data) { body.innerHTML = ''; return; }

        const d = S.data;
        const portal = d.portal || {};

        body.innerHTML = [
            standingCard(d),
            warningsCard(d, portal),
            listingCard(d),
            termsCard(d, portal),
            feedCard(d, portal),
            portalCard(portal),
        ].join('');
        icons();
        wire(body);
    }

    /** The headline: are we in good standing, and since when. */
    function standingCard(d) {
        const p = d.partnership || {};
        const st = d.standing || {};
        const bad = st.terminated;
        const warned = !bad && st.activeWarnings > 0;

        return `<section class="cp-card cpt-hero${bad ? ' cpt-hero-bad' : warned ? ' cpt-hero-warn' : ''}">
            <div class="cpt-hero-top">
                ${p.logoUrl && P.safeUrl(p.logoUrl)
                    ? `<img class="cpt-logo" src="${esc(p.logoUrl)}" alt="">`
                    : '<span class="cpt-logo cpt-logo-blank"><i data-lucide="handshake"></i></span>'}
                <div class="cpt-hero-text">
                    <h3 class="cp-card-title">${esc(p.name || 'Your airline')}</h3>
                    <p class="cp-note">${esc([p.code, p.region].filter(Boolean).join(' · '))}</p>
                </div>
                <span class="cp-chip ${bad ? 'cp-chip-bad' : warned ? 'cp-chip-warn' : 'cp-chip-ok'}">
                    ${esc(st.label || 'In good standing')}
                </span>
            </div>
            ${st.meaning ? `<p class="cp-note">${esc(st.meaning)}</p>` : ''}
            <div class="cp-facts cpt-hero-facts">
                ${p.partnered
                    ? '<span class="cp-fact"><i data-lucide="check-circle"></i> Partnered</span>'
                    : `<span class="cp-fact"><i data-lucide="clock"></i> Listing ${esc(p.status || 'under review')}</span>`}
                ${p.featured ? '<span class="cp-fact"><i data-lucide="star"></i> Featured</span>' : ''}
                ${p.announcedAt
                    ? `<span class="cp-fact"><i data-lucide="megaphone"></i> Announced ${esc(relativeText(p.announcedAt))}</span>`
                    : '<span class="cp-fact"><i data-lucide="megaphone"></i> Not announced yet</span>'}
                ${p.since ? `<span class="cp-fact"><i data-lucide="calendar"></i> With us since ${esc(whenText(p.since, { withYear: true }).split(',')[0])}</span>` : ''}
            </div>
        </section>`;
    }

    /**
     * Warnings.
     *
     * Rendered in full rather than summarised to a count. A warning a VA has
     * not read is the failure this whole panel exists to prevent, and "1 active
     * warning" with the reason hidden behind a link to another product is the
     * same as not showing it.
     */
    function warningsCard(d, portal) {
        const list = Array.isArray(d.warnings) ? d.warnings : [];
        if (!list.length) return '';
        return `<section class="cp-card cpt-warnings">
            <h3 class="cp-card-title"><i data-lucide="alert-triangle"></i> Active warnings</h3>
            ${list.map((w) => `
                <article class="cpt-warning">
                    <div class="cpt-warning-head">
                        <span class="cp-chip cp-chip-warn">${esc(w.label || w.level)}</span>
                        <span class="cp-fact">${esc(whenText(w.issuedAt))}</span>
                        ${w.acknowledged
                            ? '<span class="cp-chip cp-chip-mute">Acknowledged</span>'
                            : '<span class="cp-chip cp-chip-bad">Not acknowledged</span>'}
                    </div>
                    <p class="cpt-warning-reason">${esc(w.reason)}</p>
                </article>`).join('')}
            <a class="cp-btn" href="${esc(portal.warningsUrl || '/va-portal.html')}" target="_blank" rel="noopener">
                <i data-lucide="external-link"></i> Acknowledge in the portal
            </a>
        </section>`;
    }

    function listingCard(d) {
        const p = d.partnership || {};
        const links = [
            p.websiteUrl ? ['globe', 'Website', p.websiteUrl] : null,
            p.discordUrl ? ['message-circle', 'Discord', p.discordUrl] : null,
        ].filter(Boolean);

        return `<section class="cp-card">
            <h3 class="cp-card-title">Your listing</h3>
            <p class="cp-note">What pilots see when they find you in the Inflight VA directory.</p>
            <div class="cp-facts cpt-listing">
                <span class="cp-fact"><i data-lucide="users"></i>
                    ${p.recruiting ? 'Recruiting' : 'Not recruiting'}</span>
                ${(p.hubs || []).length
                    ? `<span class="cp-fact"><i data-lucide="building-2"></i> ${esc(p.hubs.slice(0, 6).join(', '))}</span>`
                    : ''}
            </div>
            ${links.length ? `<div class="cpt-links">${links.map(([icon, label, href]) => `
                <a class="cp-btn cp-btn-sm" href="${esc(href)}" target="_blank" rel="noopener noreferrer">
                    <i data-lucide="${icon}"></i> ${esc(label)}
                </a>`).join('')}</div>` : ''}
        </section>`;
    }

    function termsCard(d, portal) {
        const t = d.terms || {};
        const ok = !!t.acknowledged;
        return `<section class="cp-card">
            <h3 class="cp-card-title">Partnership terms</h3>
            <div class="cpt-terms">
                <span class="cp-chip ${ok ? 'cp-chip-ok' : 'cp-chip-warn'}">
                    ${ok ? 'Accepted' : 'Not accepted yet'}
                </span>
                <span class="cp-fact">Version ${esc(t.version || '—')}</span>
            </div>
            <p class="cp-note">${ok
                ? esc(`Accepted${t.acknowledgedBy ? ` by ${t.acknowledgedBy}` : ''}${t.acknowledgedAt ? ` · ${whenText(t.acknowledgedAt)}` : ''}.`)
                : 'Nobody on your VA has accepted the current version yet. It is accepted from the partnership portal.'}</p>
            <div class="cpt-links">
                ${t.pageUrl ? `<a class="cp-btn cp-btn-sm" href="${esc(t.pageUrl)}" target="_blank" rel="noopener">
                    <i data-lucide="file-text"></i> Read the terms</a>` : ''}
                ${!ok ? `<a class="cp-btn cp-btn-sm cp-btn-primary" href="${esc(portal.termsUrl || '/va-portal.html')}" target="_blank" rel="noopener">
                    <i data-lucide="external-link"></i> Accept in the portal</a>` : ''}
            </div>
        </section>`;
    }

    /**
     * The takeoff/landing feed.
     *
     * Three states, not two, and the difference matters to a VA waiting on us:
     * never asked for, asked for and waiting on our approval, or running. A
     * panel that showed only on/off would leave a VA who requested it three
     * weeks ago with no idea whether anyone had seen the request.
     */
    function feedCard(d, portal) {
        const f = d.flightEvents || {};
        let chip;
        let note;
        if (f.approved && f.enabled) {
            chip = '<span class="cp-chip cp-chip-ok">Running</span>';
            note = 'Every takeoff and landing we attribute to your callsign is posted to your own Discord.';
        } else if (f.approved && !f.enabled) {
            chip = '<span class="cp-chip cp-chip-mute">Paused</span>';
            note = 'Approved, but delivery is switched off in the portal.';
        } else if (f.requested) {
            chip = '<span class="cp-chip cp-chip-warn">Waiting on us</span>';
            note = `Requested ${esc(relativeText(f.requestedAt))} — a staff member has to approve it before anything is sent.`;
        } else {
            chip = '<span class="cp-chip">Not set up</span>';
            note = 'Your VA can have takeoff and landing cards posted to its own Discord channel. Request it in the portal.';
        }
        return `<section class="cp-card">
            <h3 class="cp-card-title">Flight feed to your Discord</h3>
            <div class="cpt-terms">${chip}</div>
            <p class="cp-note">${note}</p>
            <div class="cpt-links">
                <a class="cp-btn cp-btn-sm" href="${esc(portal.url || '/va-portal.html')}" target="_blank" rel="noopener">
                    <i data-lucide="external-link"></i> ${f.requested || f.approved ? 'Manage it' : 'Request it'}
                </a>
            </div>
        </section>`;
    }

    function portalCard(portal) {
        return `<section class="cp-card cpt-portal">
            <h3 class="cp-card-title">The partnership portal</h3>
            <p class="cp-note">Submissions, your listing, your team's portal accounts and everything
                above are managed there. It is a separate sign-in from your crew center — on purpose,
                because it is a different set of powers.</p>
            <div class="cpt-links">
                <a class="cp-btn cp-btn-primary" href="${esc(portal.url || '/va-portal.html')}" target="_blank" rel="noopener">
                    <i data-lucide="external-link"></i> Open the portal
                </a>
                <a class="cp-btn cp-btn-sm" href="${esc(portal.submissionsUrl || '/va-portal.html')}" target="_blank" rel="noopener">
                    <i data-lucide="inbox"></i> Send us something
                </a>
            </div>
        </section>`;
    }

    function wire(body) {
        // Nothing here writes, so there is nothing to wire but the refresh —
        // which exists because a VA reading this panel after being told about a
        // warning wants to see it clear without reloading the whole dashboard.
        const btn = document.getElementById('cptRefresh');
        if (btn && !btn.dataset.wired) {
            btn.dataset.wired = '1';
            btn.addEventListener('click', () => load());
        }
    }

    /* =====================================================================
     * STYLES
     * =================================================================== */

    function injectStyles() {
        P.baseStyles();
        P.style('cpt-styles', `
        .cpt-hero{ display:grid; gap:.6rem; }
        .cpt-hero-bad{ border-color:#DC2626; }
        .cpt-hero-warn{ border-color:#D97706; }
        .cpt-hero-top{ display:flex; align-items:center; gap:.8rem; }
        .cpt-hero-text{ flex:1; min-width:0; }
        .cpt-hero-text .cp-note{ margin:.1rem 0 0; }
        .cpt-logo{ width:2.75rem; height:2.75rem; border-radius:.6rem; object-fit:contain;
            background:color-mix(in srgb, var(--ink,#1C1A16) 5%, transparent); flex-shrink:0; }
        .cpt-logo-blank{ display:grid; place-items:center; color:var(--muted,#736E64); }
        .cpt-hero-facts{ padding-top:.2rem; }

        .cpt-warnings{ display:grid; gap:.6rem; border-color:#D97706; }
        .cpt-warning{ display:grid; gap:.35rem; padding:.6rem .7rem; border-radius:.5rem;
            background:color-mix(in srgb, #D97706 8%, transparent); }
        .cpt-warning-head{ display:flex; align-items:center; gap:.5rem; flex-wrap:wrap; }
        .cpt-warning-reason{ margin:0; font-size:.85rem; white-space:pre-wrap;
            color:var(--ink,#1C1A16); }

        .cpt-terms{ display:flex; align-items:center; gap:.6rem; flex-wrap:wrap; margin:.3rem 0; }
        .cpt-listing{ margin:.3rem 0; }
        .cpt-links{ display:flex; gap:.5rem; flex-wrap:wrap; margin-top:.6rem; }
        .cpt-portal{ background:color-mix(in srgb, var(--accent,#1C1A16) 5%, var(--surface,#fff)); }
        .cp-card-title i{ width:1em; height:1em; vertical-align:-.1em; margin-right:.3rem; }

        /* Mobile. The hero stacks so the standing chip is not competing with
           the airline's name for the same line, and every link becomes a full
           target — these all leave for another product, which is not something
           to mis-tap. */
        @media (max-width:40rem){
            .cpt-hero-top{ flex-wrap:wrap; }
            .cpt-hero-top .cp-chip{ order:3; width:100%; justify-content:center; padding:.35rem; }
            .cpt-links{ flex-direction:column; align-items:stretch; }
            .cpt-links .cp-btn{ justify-content:center; }
            .cpt-warning-head{ gap:.4rem; }
        }`);
    }

    /* =====================================================================
     * PUBLIC API
     * =================================================================== */

    function open({ backend, slug, token } = {}) {
        injectStyles();
        if (!panel) {
            panel = P.sheet({
                id: 'cptPanel', title: 'Inflight partnership', icon: 'handshake',
                actions: '<button class="cp-icon-btn" id="cptRefresh" title="Refresh"><i data-lucide="refresh-cw"></i></button>',
            });
        }
        S.api = P.api({ backend, slug, token });
        panel.open();
        load();
    }

    window.CrewPartnership = {
        open,
        close: () => panel && panel.close(),
        get standing() { return S.data && S.data.standing; },
    };
})();
