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

  /* `admin: true` means the shelf is partners-only, and that is enforced in
     the rules, not here. The reason it needs a SEPARATE PAIR OF COLLECTIONS
     rather than a field on the row: Firestore denies a list query in full if
     any document it could return fails the rule. Mixing partner-only rows
     into `library` would not hide them from an agent — it would break the
     whole Library screen for every agent, because the one query that fetches
     the shelf would be refused outright.

     The EOS pack is the reason this exists. It names who did not file, which
     cases are stalled and whose desk they sit on: management's read of the
     week, not the firm's. */
  const SECTIONS = {
    weekly:   { label: 'The Resilient Weekly', order: 1 },
    training: { label: 'Training',             order: 2 },
    eos:      { label: 'EOS Weekly Reports',   order: 3, admin: true }
  };
  const adminSection = (s) => !!(SECTIONS[s] && SECTIONS[s].admin);

  /* Ids carry their shelf, so every read routes without consulting the
     catalogue first — the same derived-id trick that makes re-publishing
     replace rather than duplicate. */
  const EOS_PREFIX = 'eos__';
  const isEosId = (id) => String(id || '').indexOf(EOS_PREFIX) === 0;
  const catalogueOf = (id) => isEosId(id) ? 'library_eos' : 'library';
  const docsOf = (id) => isEosId(id) ? 'library_eos_docs' : 'library_docs';

  // Answers for the account. The rules answer again, and theirs is the one
  // that counts — this only decides whether we bother asking.
  const amAdmin = () => !!(RWG.auth && RWG.auth.isAdmin && RWG.auth.isAdmin());

  const slug = (s) => String(s || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

  /* A weekly edition is identified by its date and a course by its name:
     re-publishing Sunday's brief after fixing a typo should replace
     Sunday's brief. */
  function idFor(section, date, title) {
    if (section === 'weekly') return 'weekly__' + String(date || '').slice(0, 10);
    if (section === 'eos')    return EOS_PREFIX + String(date || '').slice(0, 10) + '__' + slug(title);
    return 'training__' + slug(title);
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
    const read = (name) => db().collection(name).get()
      .then(s => s.docs.map(d => Object.assign({ id: d.id }, d.data())));
    /* The partner shelf is only asked for by a partner, and a refusal is
       swallowed rather than thrown. An agent never queries it; a partner
       whose rules have not been pasted yet gets the ordinary shelf instead
       of an empty screen. Availability degrades, access does not. */
    const eos = amAdmin() ? read('library_eos').catch(() => []) : Promise.resolve([]);
    return Promise.all([read('library'), eos])
      .then(([open, partner]) => open.concat(partner)
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
  // Home's card and the sidebar's New flag both hang off latestWeekly, which
  // is section-scoped — so an EOS publish never raises a flag for the firm.

  /* ── Read, and how long that stays interesting ─────────────
     Kept in localStorage, like the home layout and the morning
     reminder: it is one person's own place in one browser, nobody else
     needs it, and it is not worth a Firestore write per click. The cost
     is that reading Sunday's brief at home still shows the flag at the
     office on Monday, which is the same behaviour the daily reminder
     already has and has never bothered anyone.

     Recorded per EDITION rather than as a single "last seen" date, so
     that next Sunday's publish raises the flag again on its own — there
     is nothing to clear and no way to forget to clear it. */
  const SEEN_GRACE = 24 * 60 * 60 * 1000;
  const seenKey = () => { const u = me(); return 'rwg.lib.seen.' + ((u && u.id) || 'anon'); };

  function seenMap() {
    try { return JSON.parse(localStorage.getItem(seenKey()) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function markSeen(id) {
    if (!id) return;
    try {
      const m = seenMap();
      m[id] = Date.now();
      /* Only the newest edition is ever asked about, so the rest is
         history nobody reads. Trimmed to the last 40 so a weekly brief
         cannot grow this entry without limit for years. */
      const keys = Object.keys(m).sort((a, b) => m[b] - m[a]).slice(0, 40);
      const keep = {};
      keys.forEach(k => { keep[k] = m[k]; });
      localStorage.setItem(seenKey(), JSON.stringify(keep));
    } catch (e) { /* private windows have no localStorage; the flag just stays up */ }
  }

  /* Is the newest brief still worth flagging?
       never opened      -> yes, however long it has been there
       opened < 24h ago  -> yes, still this week's
       opened > 24h ago  -> no
     Only the weekly is asked about. Training does not arrive on a
     schedule, so a permanent flag on it would become furniture. */
  function isUnread() {
    const r = latestWeekly();
    if (!r) return false;
    const at = seenMap()[r.id];
    return !at || (Date.now() - at) < SEEN_GRACE;
  }

  function page(id) {
    if (!db()) return Promise.reject(new Error('no database'));
    return db().collection(docsOf(id)).doc(id).get().then(d => {
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
    return db().collection(docsOf(id)).doc(id).set({ html: String(html), bytes: bytes })
      .then(() => db().collection(catalogueOf(id)).doc(id).set(row))
      .then(() => { forget(); return Object.assign({ id: id }, row); });
  }

  function remove(id) {
    if (!db()) return Promise.reject(new Error('no database'));
    // Catalogue first here, for the same reason: off the shelf before it
    // is off the disk, so nothing is ever listed and unreadable.
    return db().collection(catalogueOf(id)).doc(id).delete()
      .then(() => db().collection(docsOf(id)).doc(id).delete())
      .then(() => forget());
  }


  return { list, page, publish, remove, idFor, bytesOf, MAX_BYTES, SECTIONS, adminSection,
           cached, warm, latestWeekly, forget,
           markSeen, isUnread, seenMap, SEEN_GRACE };
})();
