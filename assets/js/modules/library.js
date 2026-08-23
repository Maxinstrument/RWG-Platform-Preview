/* ============================================================
   RWG Platform — Library

   Carlos, 22 Aug '26: "every Sunday, when we do the Weekly Newsletter,
   for the agent to have it here available to them to read. Also I would
   like to have prior week's newsletters archived so that if any of them
   want to read it again, they can."

   Two shelves. The Weekly, newest first with everything before it kept;
   and Training, which opens with the Referral Conversation and the
   401(k) Agent Manual. Both live in Firestore behind isActive() — see
   library-data.js for why they are not static files.

   ── Why a document opens in its own tab ──────────────────────
   Not an iframe. Each of these pages is a designed whole: the Weekly
   runs its own reading-progress bar and hover glossary, and the 401(k)
   manual drives a hundred scroll-triggered reveals off the window's own
   scroll position. Framed at 60% width inside a CRM, all of that fights
   the shell around it. guide.html has opened in its own tab since the
   day it was written; this is the same decision.

   The tab is opened SYNCHRONOUSLY, before the document is fetched, and
   that ordering is load-bearing. A window opened after an await has lost
   the click that justified it and browsers block it as a pop-up. So the
   tab opens first with a holding page in it, and the page is poured in
   when it lands.
   ============================================================ */
window.RWG = window.RWG || {};

(function () {
  const LIB = () => RWG.library;
  const U = () => RWG.ui;
  const esc = (s) => U().esc(s);
  /* effectiveRole(), not auth.isAdmin(). auth.isAdmin() answers for the
     account that signed in, so a partner using "View as agent" kept
     seeing their own Publish and Remove buttons sitting in an agent's
     cockpit — which is the one thing that view exists NOT to do. Real
     agents were never shown them, and the rule on library/ would have
     refused the write regardless; the damage was to the only tool a
     partner has for checking what their team can actually see. */
  const isAdmin = () => (RWG.app && RWG.app.effectiveRole)
    ? RWG.app.effectiveRole() === 'admin'
    : !!(RWG.auth && RWG.auth.isAdmin && RWG.auth.isAdmin());

  const st = { rows: null, loading: false, err: '', busy: {}, picked: null };

  const DAY = 86400000;
  const isNew = (r) => r.publishedAt && (Date.now() - r.publishedAt) < 7 * DAY;

  /* The sidebar is drawn by the kernel on a full render, and renderMain()
     — what a module normally calls — repaints only the main panel. So the
     flag is also painted directly when it changes, rather than waiting for
     the next Firestore snapshot to redraw the shell around it. */
  function paintBadge() {
    const btn = document.querySelector('.nav-item[data-view="library"]');
    if (!btn) return;
    const has = btn.querySelector('.badge');
    const want = LIB().isUnread();
    if (want && !has) {
      const s = document.createElement('span');
      s.className = 'badge';
      s.textContent = 'New';
      btn.appendChild(s);
    } else if (!want && has) {
      has.remove();
    }
  }

  /* Asked by the sidebar on every full render. It doubles as the thing
     that loads the shelf: somebody who never opens the Library would
     otherwise never have a catalogue to check, and so would never be told
     there is a brief waiting. warm() only ever fires once. */
  function navBadge() {
    const L = RWG.library;
    if (!L) return 0;
    if (!L.cached()) { L.warm(paintBadge); return 0; }
    return L.isUnread() ? 'New' : 0;
  }

  function load() {
    st.loading = true; st.err = '';
    LIB().list()
      .then(rows => { st.rows = rows; st.loading = false; RWG.app.renderMain(); })
      .catch(e => {
        st.rows = []; st.loading = false;
        st.err = (e && e.message) || 'Could not reach the Library.';
        RWG.app.renderMain();
      });
  }

  /* Long dates, because a brief is remembered by its Sunday. "16 Aug"
     is ambiguous three months later in a list of forty of them. */
  function longDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return '';
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.toLocaleDateString('en-US',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  const sizeLabel = (b) => b ? Math.round(b / 1024) + ' KB' : '';

  // ── the holding page, shown in the new tab while the document loads ──
  function holdingPage(title) {
    return `<!doctype html><html><head><meta charset="utf-8">
      <title>${esc(title)}</title><style>
      html,body{height:100%;margin:0;background:#0d1b2a;color:#e8e4da;
        font:16px/1.6 Georgia,'Times New Roman',serif;
        display:flex;align-items:center;justify-content:center;text-align:center}
      div{max-width:30rem;padding:2rem}
      b{display:block;font-size:1.25rem;margin-bottom:.5rem;color:#c2a14d}
      p{margin:.25rem 0;opacity:.75;font-size:.9rem}
      </style></head><body><div>
      <b>${esc(title)}</b><p>Opening from the Library…</p>
      </div></body></html>`;
  }

  function openDoc(id, title) {
    /* Recorded on the click, not on a successful load: the question the
       flag answers is "have you been to this yet", and a reader whose tab
       was eaten by a pop-up blocker has still been told it is there.
       Marking an older edition is harmless — only the newest one is ever
       asked about. */
    LIB().markSeen(id);
    setTimeout(paintBadge, 0);

    // Synchronously, inside the click — see the note at the top.
    const w = window.open('', '_blank');
    if (!w) {
      U().toast('Your browser blocked the new tab. Allow pop-ups for this site and try again.');
      return;
    }
    w.document.write(holdingPage(title));
    w.document.close();

    LIB().page(id).then(html => {
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
      /* Never revoked. A blob URL dies with the tab that made it, which
         is exactly the property we want — it cannot be forwarded,
         bookmarked or shared, and it stops working the moment the CRM is
         closed. Revoking it on a timer would only break the reader's
         refresh button an hour into a manual. */
      w.location.replace(url);
    }).catch(e => {
      const msg = (e && e.message) || 'Could not open that document.';
      try {
        w.document.body.innerHTML =
          '<div><b>Couldn’t open it</b><p>' + esc(msg) + '</p></div>';
      } catch (_) { U().toast(msg); }
    });
  }

  // ── rows ───────────────────────────────────────────────────
  function docRow(r, big) {
    const badge = isNew(r) ? '<span class="lib-new">New</span>' : '';
    const by = r.publishedByName ? 'Posted by ' + esc(r.publishedByName) : '';
    const meta = [longDate(r.date), sizeLabel(r.bytes), by].filter(Boolean).join(' · ');
    const del = isAdmin()
      ? `<button class="btn btn-sm btn-quiet lib-del" data-action="lib-remove" data-id="${esc(r.id)}"
           title="Remove from the Library">Remove</button>` : '';
    return `<div class="list-row lib-row${big ? ' lib-row-big' : ''}"
        data-action="lib-open" data-id="${esc(r.id)}" data-title="${esc(r.title)}"
        title="Open in a new tab">
      <div class="lib-mark">${U().icon('book', 'ic-inline')}</div>
      <div class="lib-main">
        <div class="cell-name">${esc(r.title)}${badge}</div>
        <div class="cell-sub">${esc(meta)}</div>
        ${r.note ? `<div class="cell-sub lib-note">${esc(r.note)}</div>` : ''}
      </div>
      ${del}
    </div>`;
  }

  function shelf(title, hint, rows, empty) {
    return `<div class="card lib-shelf">
      <div class="card-head"><h3>${esc(title)}</h3>${hint ? `<p class="sub">${esc(hint)}</p>` : ''}</div>
      ${rows.length ? rows : `<p class="list-hint lib-empty">${esc(empty)}</p>`}
    </div>`;
  }

  function screenHtml() {
    if (st.loading && st.rows === null)
      return `<div class="card"><p class="list-hint">Opening the Library…</p></div>`;

    const rows = st.rows || [];
    const weekly = rows.filter(r => r.section === 'weekly');
    const training = rows.filter(r => r.section === 'training');
    const latest = weekly[0];
    const earlier = weekly.slice(1);

    const publish = isAdmin()
      ? `<button class="btn btn-gold btn-sm" data-action="lib-publish">Publish a document</button>` : '';

    const err = st.err
      ? `<div class="card"><p class="list-hint">${esc(st.err)}
           <button class="btn btn-sm btn-ghost" data-action="lib-reload">Try again</button></p></div>` : '';

    return `
      <div class="lib-bar">
        <p class="lib-blurb">Everything the firm publishes, in one place and behind your login.</p>
        ${publish}
      </div>
      ${err}

      ${shelf('This week', latest ? '' : null,
        latest ? docRow(latest, true) : '',
        'No brief has been published yet. Sunday’s will appear here.')}

      ${earlier.length ? shelf('Earlier editions',
        earlier.length + (earlier.length === 1 ? ' edition' : ' editions') + ' kept, newest first',
        earlier.map(r => docRow(r)).join(''), '') : ''}

      ${shelf('Training', 'Agent courses and manuals',
        training.map(r => docRow(r)).join(''),
        'No training has been published yet.')}

      <p class="list-hint lib-foot">Documents open in a new tab and are readable only while you are
        signed in — they are not files on a web address anyone could reach.</p>`;
  }

  // ── publishing ─────────────────────────────────────────────
  function publishModal() {
    const today = new Date();
    const iso = [today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0')].join('-');
    return `
    <div class="scrim" data-action="close-modal"></div>
    <div class="modal-card" role="dialog" aria-label="Publish a document">
      <div class="modal-head"><h2>Publish to the Library</h2>
        <p>Choose the finished HTML file. It is stored in the CRM, not on a web address,
           so only signed-in members of the firm can open it.</p></div>
      <div class="modal-body">
        <div class="field-group"><label class="lbl">The file</label>
          <input id="lib-file" type="file" accept=".html,.htm,text/html">
          <div class="cell-sub mt-8" id="lib-filenote">Nothing chosen yet.</div></div>
        <div class="field-group"><label class="lbl">Shelf</label>
          <select id="lib-section">
            <option value="weekly">The Resilient Weekly</option>
            <option value="training">Training</option>
          </select></div>
        <div class="field-group"><label class="lbl">Title</label>
          <input id="lib-title" type="text" placeholder="The Resilient Weekly"></div>
        <div class="field-group"><label class="lbl">Date</label>
          <input id="lib-date" type="date" value="${iso}">
          <div class="cell-sub mt-8">For a brief, use the Sunday it covers — that is how
            everyone will look for it later.</div></div>
        <div class="field-group"><label class="lbl">One line about it <span class="muted">(optional)</span></label>
          <input id="lib-note" type="text" maxlength="200" placeholder="What is worth knowing before opening it"></div>
        <p class="cell-sub" id="lib-err"></p>
      </div>
      <div class="modal-foot">
        <button class="btn btn-quiet" data-action="close-modal">Cancel</button>
        <button class="btn btn-gold" data-action="lib-save">Publish</button>
      </div>
    </div>`;
  }

  /* The file is read when it is chosen rather than when Publish is
     pressed, so that its size can be checked against the limit while
     there is still something to be done about it. */
  function wirePicker() {
    const f = document.getElementById('lib-file');
    const note = document.getElementById('lib-filenote');
    const title = document.getElementById('lib-title');
    if (!f) return;
    f.addEventListener('change', () => {
      const file = f.files && f.files[0];
      st.picked = null;
      if (!file) { if (note) note.textContent = 'Nothing chosen yet.'; return; }
      if (note) note.textContent = 'Reading ' + file.name + '…';
      const fr = new FileReader();
      fr.onload = () => {
        const html = String(fr.result || '');
        const bytes = LIB().bytesOf(html);
        const over = bytes > LIB().MAX_BYTES;
        st.picked = over ? null : { html: html, name: file.name, bytes: bytes };
        if (note) {
          note.textContent = over
            ? file.name + ' is ' + Math.round(bytes / 1024) + ' KB — too large. The limit is '
              + Math.round(LIB().MAX_BYTES / 1024) + ' KB, and it is nearly always one image '
              + 'saved far larger than it is ever shown.'
            : file.name + ' · ' + Math.round(bytes / 1024) + ' KB';
          note.className = over ? 'cell-sub mt-8 lib-over' : 'cell-sub mt-8';
        }
        // A sensible title, offered not imposed.
        if (title && !title.value) {
          const doc = /<title[^>]*>([\s\S]{0,140}?)<\/title>/i.exec(html);
          if (doc) title.value = doc[1].replace(/\s+/g, ' ').split(/\s+[—–|]\s+/)[0].trim();
        }
      };
      fr.onerror = () => { if (note) note.textContent = 'That file could not be read.'; };
      fr.readAsText(file);
    });
  }

  function save() {
    const err = document.getElementById('lib-err');
    const show = (m) => { if (err) { err.textContent = m; err.className = 'cell-sub lib-over'; } };
    const val = (id) => { const e = document.getElementById(id); return e ? e.value : ''; };

    if (!st.picked) return show('Choose a file first — and if you already did, it was too large to publish.');

    const btn = document.querySelector('[data-action="lib-save"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Publishing…'; }
    show('');

    LIB().publish({
      section: val('lib-section'), title: val('lib-title'),
      date: val('lib-date'), note: val('lib-note'), html: st.picked.html
    }).then(row => {
      st.picked = null;
      const m = document.getElementById('modal-mount'); if (m) m.innerHTML = '';
      st.rows = null; load();
      U().toast('Published — ' + row.title, true);
    }).catch(e => {
      if (btn) { btn.disabled = false; btn.textContent = 'Publish'; }
      show((e && e.message) || 'That did not publish. Try again.');
    });
  }

  RWG.modules.register({
    id: 'library',
    title: 'Library',
    enabled: true,
    roles: ['admin', 'agent'],
    nav: [{ view: 'library', label: 'Library', icon: 'book', badge: navBadge }],
    meta: { library: { t: 'Library', s: 'The weekly brief, past editions, and agent training' } },
    state: st,

    onEnter() { if (st.rows === null && !st.loading) load(); },

    actions: {
      'lib-reload': () => { st.rows = null; st.err = ''; LIB().forget(); load(); },

      'lib-open': (el) => openDoc(el.dataset.id, el.dataset.title || 'Document'),

      'lib-publish': () => {
        if (!isAdmin()) return;
        const m = document.getElementById('modal-mount');
        if (m) { m.innerHTML = publishModal(); wirePicker(); }
      },

      'lib-save': () => { if (isAdmin()) save(); },

      'lib-remove': (el, e) => {
        if (e && e.stopPropagation) e.stopPropagation();   // never open the row we are removing
        if (!isAdmin()) return;
        const id = el.dataset.id;
        const row = (st.rows || []).find(r => r.id === id);
        const name = row ? row.title : 'this document';
        if (!confirm('Remove ' + name + ' from the Library?\n\nThe team will no longer be able to open it. ' +
                     'The original file on your computer is untouched, so you can publish it again.')) return;
        st.busy[id] = true; RWG.app.renderMain();
        LIB().remove(id)
          .then(() => { st.rows = (st.rows || []).filter(r => r.id !== id); delete st.busy[id];
                        RWG.app.renderMain(); U().toast('Removed'); })
          .catch(e2 => { delete st.busy[id]; RWG.app.renderMain();
                         U().toast('Could not remove it: ' + ((e2 && e2.message) || 'unknown')); });
      }
    },

    render() { return screenHtml(); }
  });
})();
