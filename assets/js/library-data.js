/* ============================================================
   RWG Platform — Library

   Carlos, 22 Aug '26: the Sunday brief where the team already is, the
   back editions kept so anyone can reread one, and the agent courses
   alongside them — "behind login pages because I don't want just anyone
   having access to it."

   That last clause is the whole reason these documents are in Firestore
   and not sitting in the repository next to guide.html. GitHub Pages
   serves a file to whoever asks for it and has no idea what a login is.
   A security rule does, and it asks isActive() — an approved member of
   the firm, still here — so access ends when somebody leaves, which an
   emailed attachment never could.

     library/{id}        the catalogue row: title, section, date, bytes
     library_docs/{id}   the page itself, one HTML string

   Split in two because they are read at different moments. The whole
   shelf is about a kilobyte and is listed every time the screen opens;
   the pages are a few hundred kilobytes each and are fetched one at a
   time, only when somebody opens one. Kept together in one document,
   opening the Library would mean downloading every manual in it.

   Ids are derived rather than random — weekly__2026-08-16,
   training__referral-conversation — so publishing the same edition twice
   replaces it instead of quietly shelving it beside itself. Same
   reasoning as the Trash's derived ids.

   Deliberately NOT a live listener. Reading is what this collection is
   for and the shelf changes once a week; the app should not carry it
   around all day to find that out.
   ============================================================ */
window.RWG = window.RWG || {};

RWG.library = (function () {
  const db = () => RWG.fb && RWG.fb.db;
  const me = () => (RWG.auth && RWG.auth.currentUser && RWG.auth.currentUser()) || null;

  /* Firestore's ceiling is 1 MiB for a whole document, and that counts
     field names and overhead, not just the page. Refusing at a round
     million leaves room and, more usefully, gives a number that can be
     quoted at somebody in an error message. Anything larger than this is
     nearly always one oversized image: the 401(k) manual arrived at
     1.27 MB, of which 94% was the RWG logo at three times the resolution
     it is ever drawn at, pasted in three times over. */
  const MAX_BYTES = 1000000;
  const bytesOf = (s) => new Blob([String(s == null ? '' : s)]).size;

  const SECTIONS = {
    weekly:   { label: 'The Resilient Weekly', order: 1 },
    training: { label: 'Training',             order: 2 }
  };

  const slug = (s) => String(s || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

  /* A weekly edition is identified by its date and a course by its name:
     re-publishing Sunday's brief after fixing a typo should replace
     Sunday's brief. */
  function idFor(section, date, title) {
    return section === 'weekly'
      ? 'weekly__' + String(date || '').slice(0, 10)
      : 'training__' + slug(title);
  }

  // ── reading ────────────────────────────────────────────────
  /* One copy of the catalogue per session. Two screens want it -- the
     Library itself and the brief on Home -- and it is a shelf that
     changes once a week, so fetching it twice on every visit to Home
     would be a read a minute to learn nothing. `warmed` is separate from
     `rows` so that a fetch which FAILED is not retried on every repaint:
     without it, an offline moment turns Home into a loop. */
  let rows = null, warmed = false;
  const cached = () => rows;

  /* Publishing and removing change the shelf, so they drop the copy of it
     rather than trying to patch it — the next screen that needs the
     catalogue fetches it fresh. */
  const forget = () => { rows = null; warmed = false; };

  function warm(onReady) {
    if (warmed || rows) return;
    warmed = true;
    list().then(() => { if (onReady) onReady(); }).catch(() => {});
  }

  function list(force) {
    if (!db()) return Promise.reject(new Error('no database'));
    if (rows && !force) return Promise.resolve(rows);
    return db().collection('library').get().then(s =>
      s.docs.map(d => Object.assign({ id: d.id }, d.data()))
        .sort((a, b) => {
          const sa = (SECTIONS[a.section] || {}).order || 9;
          const sb = (SECTIONS[b.section] || {}).order || 9;
          if (sa !== sb) return sa - sb;
          return String(b.date || '').localeCompare(String(a.date || ''));   // newest first
        }))
      .then(out => { rows = out; warmed = true; return out; });
  }

  // The newest edition of the brief, or null before the first one lands.
  const latestWeekly = () => (rows || []).filter(r => r.section === 'weekly')[0] || null;

  function page(id) {
    if (!db()) return Promise.reject(new Error('no database'));
    return db().collection('library_docs').doc(id).get().then(d => {
      if (!d.exists) throw new Error('That document is no longer in the Library.');
      return d.data().html || '';
    });
  }

  // ── publishing (a partner's, enforced in the rules) ─────────
  function publish({ section, title, date, html, note }) {
    if (!db()) return Promise.reject(new Error('no database'));
    if (!SECTIONS[section]) return Promise.reject(new Error('Pick a section.'));
    if (!String(title || '').trim()) return Promise.reject(new Error('Give it a title.'));
    if (!String(html || '').trim()) return Promise.reject(new Error('Choose a file to publish.'));

    const bytes = bytesOf(html);
    if (bytes > MAX_BYTES) {
      const over = Math.round((bytes - MAX_BYTES) / 1024);
      return Promise.reject(new Error(
        'That page is ' + Math.round(bytes / 1024) + ' KB, which is ' + over +
        ' KB over the limit for one document. It is almost always an image ' +
        'saved much larger than it is ever shown — shrinking those usually ' +
        'takes a file to a quarter of its size without any visible change.'));
    }

    const u = me();
    const id = idFor(section, date, title);
    const row = {
      section: section,
      title: String(title).trim().slice(0, 120),
      date: String(date || '').slice(0, 10),
      note: String(note || '').trim().slice(0, 200),
      bytes: bytes,
      publishedAt: Date.now(),
      publishedBy: (u && u.id) || null,
      publishedByName: (u && u.name) || ''
    };

    /* Page first, catalogue second, and not in a batch. A batch would be
       one atomic write of ~500 KB, and if it failed the whole publish
       would have to be redone; this way the row that makes a document
       appear on the shelf is only written once the document itself is
       safely there. The reverse order could put a title on the shelf
       with nothing behind it. */
    return db().collection('library_docs').doc(id).set({ html: String(html), bytes: bytes })
      .then(() => db().collection('library').doc(id).set(row))
      .then(() => { forget(); return Object.assign({ id: id }, row); });
  }

  function remove(id) {
    if (!db()) return Promise.reject(new Error('no database'));
    // Catalogue first here, for the same reason: off the shelf before it
    // is off the disk, so nothing is ever listed and unreadable.
    return db().collection('library').doc(id).delete()
      .then(() => db().collection('library_docs').doc(id).delete())
      .then(() => forget());
  }


  return { list, page, publish, remove, idFor, bytesOf, MAX_BYTES, SECTIONS,
           cached, warm, latestWeekly, forget };
})();
