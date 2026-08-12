/* ============================================================================
   crewDocuments.js — the VA's document library.

   WHAT THIS IS FOR

   Every virtual airline has an operations manual, and until now every VA kept it
   somewhere else: a Google Doc, a Discord pin, a PDF in a channel nobody can
   search. That works until a pilot needs it, which is the one moment it has to.

   The crew center already knows who each pilot is and which rung they are on,
   which is exactly what deciding "may this person read this" needs. So the
   library lives here — with the gate, the revision stamp and a place to look.

   ONE PANEL, TWO AUDIENCES

   Staff get an editor: three kinds of document (written here, linked elsewhere,
   or a file uploaded to us), a rank gate, a draft/published switch and a
   revision label. Pilots get a reading list. It is one panel rather than two
   because the difference is `canManage`, which the backend decides — and a panel
   that renders from what the server said it may do cannot be talked into
   showing an edit button by a page that lies about who is looking.

   WHAT THIS FILE DOES NOT DECIDE

   The gate. A locked document arrives here already stripped of its body, its
   link and its file URL — crewDocs.js on the backend does that before the row
   reaches a response, because a gate enforced by the thing drawing the padlock
   is not a gate. This file draws what it was given and never asks for more.

   THE REVISION LINE

   `revision` and `revisedAt` are the pair that makes a library worth trusting. A
   pilot who read the manual in March needs to know whether the change since was
   a typo or a new fuel policy. The backend only moves `revisedAt` when the
   CONTENT moved, so "Revised 3 days ago · Rev C" means something, and this file
   shows it on every card rather than tucking it inside.

   WHAT IT NEEDS FROM ITS HOST

       CrewDocuments.mount({ backend: BACKEND, slug: getSlug(), token: sessionToken });

   Then CrewDocuments.open() from a button, and CrewDocuments.renderTile(el) to
   paint the count wherever the page wants it.

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewDocuments: crewPanels.js must load first'); return; }
    const { esc, safeUrl, icons, relativeText, whenText } = P;

    const S = {
        api: null,
        slug: '',
        docs: [],
        summary: { total: 0, open: 0, locked: 0 },
        canManage: false,
        loaded: false,
        error: null,
        ranks: [],          // the VA's ladder, for the rank-gate picker
        editing: null,      // the document open in the editor, or null
        reading: null,      // the document open for reading, or null
        busy: false,
    };

    let panel = null;

    /* ---------------------------------------------------------------------
     * How each kind reads
     *
     * The order here is the order the backend sorts by (crewDocs.KINDS), so a
     * VA's manual is above their forms without this file re-sorting anything.
     * ------------------------------------------------------------------- */
    const KINDS = {
        manual:    { icon: 'book-open',      label: 'Manual' },
        sop:       { icon: 'list-checks',    label: 'SOP' },
        handbook:  { icon: 'book-marked',    label: 'Handbook' },
        policy:    { icon: 'scale',          label: 'Policy' },
        briefing:  { icon: 'presentation',   label: 'Briefing' },
        form:      { icon: 'clipboard-pen',  label: 'Form' },
        document:  { icon: 'file-text',      label: 'Document' },
    };
    const kindOf = (d) => KINDS[d && d.kind] || KINDS.document;

    const SOURCES = {
        text: { icon: 'pencil-line', label: 'Written here' },
        link: { icon: 'external-link', label: 'Linked' },
        file: { icon: 'paperclip', label: 'File' },
    };

    /** "4.2 MB". Bytes are what the column holds; nobody reads bytes. */
    function sizeText(bytes) {
        const n = Number(bytes) || 0;
        if (n <= 0) return '';
        if (n < 1024) return `${n} B`;
        if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
        return `${Math.round((n / 1048576) * 10) / 10} MB`;
    }

    /* =====================================================================
     * DATA
     * =================================================================== */

    async function load() {
        try {
            const d = await S.api('/documents');
            S.docs = Array.isArray(d.documents) ? d.documents : [];
            S.summary = d.summary || { total: S.docs.length, open: 0, locked: 0 };
            S.canManage = !!d.canManage;
            S.error = null;
        } catch (err) {
            // Kept rather than thrown, for the reason crewNotices keeps its
            // error: both surfaces want to SAY why the library is empty, and an
            // exception reaching the caller would leave a tile blank with the
            // reason in the console.
            S.error = err;
            S.docs = [];
            S.summary = { total: 0, open: 0, locked: 0 };
        }
        S.loaded = true;
        paintAll();
        return S.docs;
    }

    /**
     * The full text of one document.
     *
     * The list deliberately does not carry every body — an inline ops manual is
     * a long thing and sending all of them would make opening the library slow
     * for the sake of the one being read. So a written document is fetched when
     * it is opened.
     */
    async function readOne(id) {
        const d = await S.api(`/documents/${encodeURIComponent(id)}`);
        const full = d.document;
        // Fold it back into the list so a second open is instant and the card
        // behind the reader is up to date.
        S.docs = S.docs.map((x) => (x.id === full.id ? full : x));
        return full;
    }

    /* =====================================================================
     * THE TILE — a count, wherever the page wants one
     * =================================================================== */

    const tileHosts = new Map();

    function paintTile(el) {
        if (!el) return;
        // Nothing at all until the fetch lands. Inventing an empty library is
        // the bug crewNotices was written to remove, and a "0 documents" that
        // turns into 12 is the same mistake.
        if (!S.loaded) { el.innerHTML = ''; return; }

        if (S.error) {
            el.innerHTML = `<span class="cp-faint">${esc(
                P.isSchemaGap(S.error)
                    ? 'Needs a database update'
                    : 'Couldn’t load the library')}</span>`;
            return;
        }
        const n = S.summary.total || 0;
        if (!n) {
            el.innerHTML = `<span class="cp-faint">Nothing filed yet</span>`;
            return;
        }
        const locked = S.summary.locked || 0;
        // One compact line, so it can sit under a tile's own description without
        // competing with it. A big stat number would read as the point of the
        // tile, and the point is the library, not how many things are in it.
        el.innerHTML = `<span class="cd-tile-n">${n} ${n === 1 ? 'document' : 'documents'}</span>${
            locked ? `<span class="cp-faint"> · ${locked} higher up</span>` : ''}`;
    }

    function paintAll() {
        tileHosts.forEach((_, el) => {
            if (!el.isConnected) { tileHosts.delete(el); return; }
            paintTile(el);
        });
        if (panel && panel.isOpen()) renderPanel();
    }

    /* =====================================================================
     * THE READER
     * =================================================================== */

    /**
     * What a pilot sees when they open a document.
     *
     * A locked one gets the same frame with the reason in place of the content —
     * rather than being hidden — because a pilot cannot work towards a document
     * they do not know exists. "There is a Captain's SOP and you are 38 hours
     * off it" is the useful answer, and it is the one the backend sends.
     */
    function readerHtml(d) {
        const k = kindOf(d);
        const head = `<div class="cd-read-head">
            <span class="cp-chip cp-chip-mute"><i data-lucide="${esc(k.icon)}"></i> ${esc(k.label)}</span>
            ${d.revision ? `<span class="cp-chip cp-chip-accent">${esc(d.revision)}</span>` : ''}
            ${d.minRank ? `<span class="cp-fact"><i data-lucide="shield"></i> ${esc(d.minRank)}</span>` : ''}
            ${d.revisedAt ? `<span class="cp-fact"><i data-lucide="history"></i> Revised ${esc(relativeText(d.revisedAt))}</span>` : ''}
        </div>
        <h2 class="cd-read-title">${esc(d.title)}</h2>
        ${d.summary ? `<p class="cp-muted">${esc(d.summary)}</p>` : ''}`;

        if (d.locked) {
            return `${head}
            <div class="cp-empty">
                <i data-lucide="lock"></i>
                This opens at <b>${esc(d.minRank)}</b>.
                ${d.hoursUntilUnlock > 0
                    ? `You’re ${esc(String(Math.round(d.hoursUntilUnlock * 10) / 10))} hours away.`
                    : 'You’re waiting on a check-ride for that rung.'}
            </div>`;
        }

        if (d.source === 'link') {
            const ok = d.linkUrl && safeUrl(d.linkUrl);
            return `${head}
            <div class="cd-read-body">
                ${ok
                    ? `<a class="cp-btn cp-btn-primary" href="${esc(d.linkUrl)}" target="_blank" rel="noopener noreferrer">
                           <i data-lucide="external-link"></i> Open the document
                       </a>
                       <p class="cp-faint cd-read-url">${esc(d.linkUrl)}</p>`
                    : `<p class="cp-note cp-note-warn">This document links somewhere, but the link is
                       missing or isn’t one we can open.</p>`}
            </div>`;
        }

        if (d.source === 'file') {
            const ok = d.fileUrl && safeUrl(d.fileUrl);
            return `${head}
            <div class="cd-read-body">
                ${ok
                    ? `<a class="cp-btn cp-btn-primary" href="${esc(d.fileUrl)}" target="_blank" rel="noopener noreferrer">
                           <i data-lucide="file-down"></i> Open ${esc(d.fileName || 'the file')}
                       </a>
                       ${d.fileSize ? `<p class="cp-faint">${esc(sizeText(d.fileSize))}</p>` : ''}`
                    : `<p class="cp-note cp-note-warn">This document is a file, but nothing has been
                       uploaded yet.</p>`}
            </div>`;
        }

        // Written here. Plain text, escaped, with the author's line breaks kept —
        // NOT parsed as markdown or HTML. A VA's manual is written by whoever has
        // the capability, and rendering their input as markup would make the
        // library an injection surface aimed at the whole roster.
        return `${head}
        <div class="cd-read-body cd-read-text">${esc(d.body || '')}</div>`;
    }

    /* =====================================================================
     * THE EDITOR — staff only
     * =================================================================== */

    function editorHtml(d) {
        const isNew = !d.id;
        const src = d.source || 'text';
        const rungs = (S.ranks || []).map((r) => r && r.name).filter(Boolean);
        return `<form class="cd-edit" data-cd-form>
            <div>
                <label class="cp-label" for="cd-title">Title</label>
                <input class="cp-input" id="cd-title" name="title" maxlength="160"
                       value="${esc(d.title || '')}" placeholder="Operations Manual" required>
            </div>
            <div>
                <label class="cp-label" for="cd-summary">One-line summary</label>
                <input class="cp-input" id="cd-summary" name="summary" maxlength="400"
                       value="${esc(d.summary || '')}" placeholder="How we fly — read this first.">
            </div>
            <div class="cp-grid2">
                <div>
                    <label class="cp-label" for="cd-kind">Kind</label>
                    <select class="cp-select" id="cd-kind" name="kind">
                        ${Object.entries(KINDS).map(([id, k]) =>
                            `<option value="${esc(id)}"${(d.kind || 'document') === id ? ' selected' : ''}>${esc(k.label)}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label class="cp-label" for="cd-minRank">Opens at</label>
                    <select class="cp-select" id="cd-minRank" name="minRank">
                        <option value=""${!d.minRank ? ' selected' : ''}>Everyone</option>
                        ${rungs.map((r) =>
                            `<option value="${esc(r)}"${d.minRank === r ? ' selected' : ''}>${esc(r)}</option>`).join('')}
                    </select>
                    <p class="cp-faint cd-hint">A gated document is hidden from the public
                       entirely, and shown to pilots below the rung as a title only.</p>
                </div>
            </div>

            <div>
                <label class="cp-label">Where the content is</label>
                <div class="cd-srcs">
                    ${Object.entries(SOURCES).map(([id, s]) => `
                        <label class="cd-src${src === id ? ' cd-src-on' : ''}">
                            <input type="radio" name="source" value="${esc(id)}"${src === id ? ' checked' : ''}>
                            <i data-lucide="${esc(s.icon)}"></i> ${esc(s.label)}
                        </label>`).join('')}
                </div>
            </div>

            <div data-cd-src="text"${src === 'text' ? '' : ' class="cp-hidden"'}>
                <label class="cp-label" for="cd-body">The document</label>
                <textarea class="cp-textarea cd-body" id="cd-body" name="body"
                          placeholder="Write it here. Plain text — line breaks are kept.">${esc(d.body || '')}</textarea>
            </div>

            <div data-cd-src="link"${src === 'link' ? '' : ' class="cp-hidden"'}>
                <label class="cp-label" for="cd-linkUrl">Link</label>
                <input class="cp-input" id="cd-linkUrl" name="linkUrl" maxlength="600"
                       value="${esc(d.linkUrl || '')}" placeholder="https://docs.google.com/…">
            </div>

            <div data-cd-src="file"${src === 'file' ? '' : ' class="cp-hidden"'}>
                <label class="cp-label">File</label>
                ${d.fileUrl
                    ? `<p class="cp-fact"><i data-lucide="paperclip"></i>
                       ${esc(d.fileName || 'Uploaded')}${d.fileSize ? ` · ${esc(sizeText(d.fileSize))}` : ''}</p>`
                    : ''}
                ${isNew
                    ? `<p class="cp-note">Save the document first, then upload the file to it.</p>`
                    : `<input class="cp-input" type="file" data-cd-file
                              accept=".pdf,.txt,.md,.doc,.docx,application/pdf,text/plain,text/markdown,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document">
                       <p class="cp-faint cd-hint">PDF, Word or plain text, up to 25 MB.
                          Anything bigger is better linked.</p>`}
            </div>

            <div class="cp-grid2">
                <div>
                    <label class="cp-label" for="cd-revision">Revision label</label>
                    <input class="cp-input" id="cd-revision" name="revision" maxlength="40"
                           value="${esc(d.revision || '')}" placeholder="Rev C">
                    <p class="cp-faint cd-hint">Yours to name. Typing a new one marks the
                       document revised, so pilots know to read it again.</p>
                </div>
                <div>
                    <label class="cp-label" for="cd-status">Status</label>
                    <select class="cp-select" id="cd-status" name="status">
                        <option value="draft"${(d.status || 'draft') === 'draft' ? ' selected' : ''}>Draft — staff only</option>
                        <option value="published"${d.status === 'published' ? ' selected' : ''}>Published — the crew can read it</option>
                        <option value="archived"${d.status === 'archived' ? ' selected' : ''}>Archived — superseded, kept</option>
                    </select>
                </div>
            </div>

            <label class="cd-pin">
                <input type="checkbox" name="pinned"${d.pinned ? ' checked' : ''}>
                Pin to the top of the library
            </label>

            <div class="cd-edit-actions">
                <button class="cp-btn cp-btn-primary" type="submit"${S.busy ? ' disabled' : ''}>
                    <i data-lucide="check"></i> ${isNew ? 'Create' : 'Save'}
                </button>
                <button class="cp-btn" type="button" data-cd-cancel>Cancel</button>
                ${isNew ? '' : `<button class="cp-btn cp-btn-bad" type="button" data-cd-del="${esc(d.id)}">
                    <i data-lucide="trash-2"></i> Delete
                </button>`}
            </div>
        </form>`;
    }

    /* =====================================================================
     * THE LIST
     * =================================================================== */

    function cardHtml(d) {
        const k = kindOf(d);
        const s = SOURCES[d.source] || SOURCES.text;
        return `<article class="cp-card cd-card${d.pinned ? ' cd-card-pinned' : ''}" data-cd-open="${esc(d.id)}">
            <div class="cd-card-head">
                <span class="cp-chip cp-chip-mute"><i data-lucide="${esc(k.icon)}"></i> ${esc(k.label)}</span>
                ${d.pinned ? '<i data-lucide="pin" class="cd-pin-mark"></i>' : ''}
                ${d.locked ? `<span class="cp-chip cp-chip-warn"><i data-lucide="lock"></i> ${esc(d.minRank)}</span>` : ''}
                ${d.status === 'draft' ? '<span class="cp-chip cp-chip-warn">Draft</span>' : ''}
                ${d.status === 'archived' ? '<span class="cp-chip cp-chip-mute">Archived</span>' : ''}
                ${d.revision ? `<span class="cp-chip">${esc(d.revision)}</span>` : ''}
                ${S.canManage ? `<button class="cp-btn cp-btn-sm cd-card-edit" data-cd-edit="${esc(d.id)}">
                    <i data-lucide="pencil"></i> Edit</button>` : ''}
            </div>
            <h3 class="cp-card-title">${esc(d.title)}</h3>
            ${d.summary ? `<p class="cd-card-sum cp-muted">${esc(d.summary)}</p>` : ''}
            <div class="cp-facts cd-card-foot">
                <span class="cp-fact"><i data-lucide="${esc(s.icon)}"></i> ${esc(s.label)}</span>
                ${d.source === 'file' && d.fileSize
                    ? `<span class="cp-fact">${esc(sizeText(d.fileSize))}</span>` : ''}
                ${d.revisedAt
                    ? `<span class="cp-fact"><i data-lucide="history"></i> Revised ${esc(relativeText(d.revisedAt))}</span>`
                    : `<span class="cp-fact"><i data-lucide="clock"></i> ${esc(whenText(d.createdAt))}</span>`}
                ${d.authorName ? `<span class="cp-fact cp-faint">${esc(d.authorName)}</span>` : ''}
            </div>
        </article>`;
    }

    function renderPanel() {
        const body = panel.body;

        if (S.reading) {
            body.innerHTML = `<button class="cp-btn cp-btn-sm cd-back" data-cd-back>
                    <i data-lucide="arrow-left"></i> Back to the library</button>
                ${readerHtml(S.reading)}`;
            icons();
            return;
        }
        if (S.editing) {
            body.innerHTML = editorHtml(S.editing);
            icons();
            return;
        }
        if (!S.loaded) { body.innerHTML = '<div class="cp-empty">Loading the library…</div>'; return; }
        if (S.error && P.isSchemaGap(S.error)) {
            body.innerHTML = P.schemaGapHtml(S.error);
            icons();
            return;
        }
        if (S.error) {
            body.innerHTML = `<div class="cp-empty"><i data-lucide="triangle-alert"></i>
                ${esc(S.error.message || 'Couldn’t load the library.')}</div>`;
            icons();
            return;
        }

        const newBtn = S.canManage
            ? `<button class="cp-btn cp-btn-primary cd-new" data-cd-new>
                   <i data-lucide="plus"></i> New document</button>`
            : '';

        if (!S.docs.length) {
            body.innerHTML = `${newBtn}
                <div class="cp-empty">
                    <i data-lucide="library"></i>
                    ${S.canManage
                        ? 'Nothing filed yet. Put the operations manual here and every pilot can find it.'
                        : 'Your airline hasn’t published any documents yet.'}
                </div>`;
            icons();
            return;
        }

        body.innerHTML = `${newBtn}
            ${S.summary.locked
                ? `<p class="cp-note">${S.summary.locked === 1
                    ? 'One document opens further up the rank ladder.'
                    : `${S.summary.locked} documents open further up the rank ladder.`}</p>`
                : ''}
            <div class="cd-list">${S.docs.map(cardHtml).join('')}</div>`;
        icons();
    }

    /* =====================================================================
     * ACTIONS
     * =================================================================== */

    /**
     * The form, as the request body.
     *
     * The one-source-only rule is applied HERE as well as on the backend, and it
     * has to be: the three content fields are hidden by a class, not disabled, so
     * FormData still carries all three. A reader who typed a manual, thought
     * better of it and pasted a link would otherwise POST both — the backend
     * clears the loser, so nothing would be stored wrong, but the abandoned draft
     * still crosses the wire (a body may be 200k of paste), and a payload that
     * contradicts itself is one a future caller could believe.
     *
     * Disabling the fields instead would work too, and would break the thing that
     * makes the picker usable: flipping between the three to see what they are has
     * to keep what you have already typed.
     */
    function formValues(form) {
        const fd = new FormData(form);
        const source = String(fd.get('source') || 'text');
        return {
            title: String(fd.get('title') || '').trim(),
            summary: String(fd.get('summary') || '').trim(),
            kind: String(fd.get('kind') || 'document'),
            source,
            body: source === 'text' ? String(fd.get('body') || '') : '',
            linkUrl: source === 'link' ? String(fd.get('linkUrl') || '').trim() : '',
            minRank: String(fd.get('minRank') || ''),
            revision: String(fd.get('revision') || '').trim(),
            status: String(fd.get('status') || 'draft'),
            pinned: fd.get('pinned') === 'on',
        };
    }

    async function save(form) {
        if (S.busy) return;
        const values = formValues(form);
        if (!values.title) { P.toast('Give the document a title.', 'bad'); return; }
        S.busy = true;
        const editingId = S.editing && S.editing.id;
        try {
            const saved = editingId
                ? await S.api(`/documents/${encodeURIComponent(editingId)}`, { method: 'PATCH', body: values })
                : await S.api('/documents', { method: 'POST', body: values });

            // A file chosen in the same visit is uploaded after the row exists —
            // it needs an id to attach to, which a brand-new document only has
            // once it has been saved.
            const picker = form.querySelector('[data-cd-file]');
            const file = picker && picker.files && picker.files[0];
            if (file && saved.document && saved.document.id) {
                await upload(saved.document.id, file);
            }
            P.toast(editingId ? 'Saved.' : 'Document created.', 'ok');
            if (saved.warning) P.toast(saved.warning, 'bad');
            S.editing = null;
            await load();
        } catch (err) {
            P.toast(err.message || 'Could not save the document.', 'bad');
        } finally {
            S.busy = false;
            if (panel && panel.isOpen()) renderPanel();
        }
    }

    async function upload(id, file) {
        const fd = new FormData();
        fd.append('file', file);
        // Not through P.api: that sends JSON, and multipart has to set its own
        // Content-Type boundary. Same auth header, same error shape.
        const res = await fetch(`${S.base}/api/crew/${encodeURIComponent(S.slug)}/documents/${encodeURIComponent(id)}/file`, {
            method: 'POST',
            headers: S.token() ? { Authorization: 'Bearer ' + S.token() } : {},
            body: fd,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const err = new Error(data.error || 'The file could not be uploaded.');
            err.code = data.code || '';
            err.status = res.status;
            throw err;
        }
        return data;
    }

    async function remove(id) {
        const doc = S.docs.find((d) => d.id === id);
        if (!window.confirm(`Delete “${(doc && doc.title) || 'this document'}”? This cannot be undone.`)) return;
        try {
            await S.api(`/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
            P.toast('Document deleted.', 'ok');
            S.editing = null;
            await load();
        } catch (err) { P.toast(err.message || 'Could not remove the document.', 'bad'); }
    }

    async function openDoc(id) {
        const known = S.docs.find((d) => d.id === id);
        // A locked one needs no fetch — the backend has already told us
        // everything it is willing to, and asking again would 404 for a draft.
        if (known && known.locked) { S.reading = known; renderPanel(); return; }
        S.reading = known || null;
        renderPanel();
        try {
            S.reading = await readOne(id);
        } catch (err) {
            P.toast(err.message || 'Could not open the document.', 'bad');
        }
        renderPanel();
    }

    /* =====================================================================
     * THE PANEL
     * =================================================================== */

    function ensurePanel() {
        if (panel) return;
        panel = P.sheet({ id: 'cd-panel', title: 'Documents', icon: 'library', wide: true });

        panel.el.addEventListener('click', (ev) => {
            const t = ev.target;
            if (t.closest('[data-cd-back]')) { S.reading = null; renderPanel(); return; }
            if (t.closest('[data-cd-cancel]')) { S.editing = null; renderPanel(); return; }
            if (t.closest('[data-cd-new]')) {
                S.editing = { source: 'text', status: 'draft', kind: 'document' };
                renderPanel();
                return;
            }
            const del = t.closest('[data-cd-del]');
            if (del) { remove(del.getAttribute('data-cd-del')); return; }
            const edit = t.closest('[data-cd-edit]');
            if (edit) {
                ev.stopPropagation();   // do not also open the card for reading
                const id = edit.getAttribute('data-cd-edit');
                const known = S.docs.find((d) => d.id === id);
                // The editor needs the body, which the list does not carry.
                if (known && known.source === 'text' && !known.body) {
                    readOne(id).then((full) => { S.editing = full; renderPanel(); })
                        .catch(() => { S.editing = known; renderPanel(); });
                } else {
                    S.editing = known || null;
                }
                renderPanel();
                return;
            }
            const open = t.closest('[data-cd-open]');
            if (open) { openDoc(open.getAttribute('data-cd-open')); }
        });

        panel.el.addEventListener('submit', (ev) => {
            const form = ev.target.closest('[data-cd-form]');
            if (!form) return;
            ev.preventDefault();
            save(form);
        });

        // The source radios show and hide the three content fields. Done on
        // change rather than by re-rendering so a half-written body survives the
        // reader flipping between options to see what they are.
        panel.el.addEventListener('change', (ev) => {
            const radio = ev.target.closest('input[name="source"]');
            if (!radio) return;
            const form = radio.closest('[data-cd-form]');
            if (!form) return;
            form.querySelectorAll('[data-cd-src]').forEach((box) => {
                box.classList.toggle('cp-hidden', box.getAttribute('data-cd-src') !== radio.value);
            });
            form.querySelectorAll('.cd-src').forEach((l) => {
                l.classList.toggle('cd-src-on', l.contains(radio) || l.querySelector('input').checked);
            });
        });
    }

    function injectStyles() {
        P.baseStyles();
        P.style('cd-styles', `
        .cd-tile-n{ font-weight:700; color:var(--ink,#1C1A16); }
        .cd-list{ display:grid; gap:.7rem; }
        .cd-card{ cursor:pointer; }
        .cd-card:hover{ border-color:var(--ink,#1C1A16); }
        .cd-card-pinned{ border-color:var(--accent,#1C1A16); }
        .cd-card-head{ display:flex; align-items:center; gap:.4rem; flex-wrap:wrap; margin-bottom:.4rem; }
        .cd-card-edit{ margin-left:auto; }
        .cd-pin-mark{ width:.9rem; height:.9rem; color:var(--accent,#1C1A16); }
        .cd-card-sum{ font-size:.85rem; margin:.25rem 0 .5rem; }
        .cd-card-foot{ font-size:.78rem; }
        .cd-new{ justify-self:start; }
        .cd-back{ justify-self:start; }

        .cd-read-head{ display:flex; align-items:center; gap:.5rem; flex-wrap:wrap; }
        .cd-read-title{ font-size:1.25rem; font-weight:800; letter-spacing:-.02em; margin:.5rem 0 0;
            color:var(--ink,#1C1A16); }
        .cd-read-body{ display:grid; gap:.6rem; justify-items:start; }
        .cd-read-url{ font-size:.75rem; word-break:break-all; }
        /* pre-wrap, so the author's paragraphs survive without this file having
           to parse anything. See readerHtml. */
        .cd-read-text{ white-space:pre-wrap; line-height:1.65; font-size:.9rem;
            color:var(--ink,#1C1A16); justify-items:stretch; }

        .cd-edit{ display:grid; gap:.8rem; }
        .cd-edit-actions{ display:flex; gap:.5rem; flex-wrap:wrap; }
        .cd-body{ min-height:14rem; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.82rem; }
        .cd-hint{ font-size:.72rem; margin-top:.25rem; }
        .cd-srcs{ display:flex; gap:.4rem; flex-wrap:wrap; }
        .cd-src{ display:inline-flex; align-items:center; gap:.35rem; cursor:pointer;
            padding:.45rem .7rem; border-radius:.5rem; font-size:.82rem; font-weight:600;
            border:1px solid var(--line,#e5e5e5); color:var(--muted,#736E64);
            /* The containing block for the hidden radio below. Without it the
               radio is absolute against whatever ancestor happens to be
               positioned — the panel — which parks an invisible, clickable
               control over unrelated controls elsewhere in the form. */
            position:relative; }
        .cd-src input{ position:absolute; inset:0; opacity:0; margin:0; cursor:pointer; }
        .cd-src i{ width:1em; height:1em; }
        .cd-src-on{ border-color:var(--accent,#1C1A16); color:var(--ink,#1C1A16); }
        .cd-pin{ display:inline-flex; align-items:center; gap:.45rem; font-size:.85rem;
            color:var(--ink,#1C1A16); cursor:pointer; }
        @media (max-width:40rem){
            .cd-card-edit{ margin-left:0; }
            .cd-src{ min-height:2.75rem; }
        }`);
    }

    /* =====================================================================
     * PUBLIC
     * =================================================================== */

    function open() {
        ensurePanel();
        S.reading = null;
        S.editing = null;
        panel.open();
        renderPanel();
        // Always re-read on open: a library is exactly the thing somebody else
        // revised while this tab sat there.
        load();
    }

    function mount({ backend, slug, token, ranks }) {
        injectStyles();
        S.base = String(backend || '').replace(/\/+$/, '');
        S.token = typeof token === 'function' ? token : () => String(token || '');
        S.api = P.api({ backend, slug, token });
        S.slug = String(slug || '').toLowerCase();
        S.ranks = Array.isArray(ranks) ? ranks : [];
        if (!S.slug) return Promise.resolve([]);
        return load();
    }

    /** Paint the count into a host element, and keep it painted. */
    function renderTile(el) {
        if (!el) return;
        injectStyles();
        tileHosts.set(el, true);
        paintTile(el);
    }

    /** The ladder, once the host knows it — the rank-gate picker needs names. */
    function setRanks(ranks) {
        S.ranks = Array.isArray(ranks) ? ranks : [];
        if (panel && panel.isOpen() && S.editing) renderPanel();
    }

    window.CrewDocuments = {
        mount, open, renderTile, setRanks,
        close: () => panel && panel.close(),
        reload: () => load(),
        get canManage() { return S.canManage; },
        get documents() { return S.docs.slice(); },
        get summary() { return { ...S.summary }; },
    };
})();
