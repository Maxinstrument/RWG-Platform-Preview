/* ============================================================
   RWG Platform — Notes data layer

   The one thing the CRM could not do until now: say something.
   Every other record answers a question about work; a note is a
   person telling the team what happened.

     notes/{id}  body, author, when, and an optional pointer at the
                 household / case / lead it is about.

   Notes are append-mostly by intent: anyone can post, the author
   (or a partner) can delete, nobody edits someone else's words.
   Deleting routes through the Trash like everything else, so a
   note removed in anger is recoverable by a partner.

   Same pattern as every other layer: live cache, optimistic local
   writes, dormant until a module calls init().
   ============================================================ */
window.RWG = window.RWG || {};

RWG.notes = (function () {
  const db = () => RWG.fb && RWG.fb.db;
  const now = () => Date.now();

  const cache = { notes: [] };
  let onChange = () => {};
  let me = null;
  let unsubs = [];
  let started = false;

  // How far back the feed reaches. Notes are small, but the whole
  // firm's chatter for three years is not what anyone opens Home for.
  const WINDOW_DAYS = 120;

  function init(profile, cb) {
    me = profile;
    onChange = cb || (() => {});
    if (!db()) { console.warn('notes.init: Firebase not ready'); return; }
    teardown();
    started = true;
    unsubs.push(db().collection('notes').onSnapshot(
      s => {
        cache.notes = s.docs.map(d => Object.assign({ id: d.id }, d.data()))
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        onChange();
      },
      e => console.error('notes listener:', e && e.message)));
  }
  function teardown() {
    unsubs.forEach(u => { try { u(); } catch (e) {} });
    unsubs = []; started = false; cache.notes = [];
  }
  const isStarted = () => started;

  // ── reads ──
  const all = () => cache.notes.slice();
  const note = (id) => cache.notes.find(n => n.id === id) || null;
  const recent = (limit) => {
    const edge = now() - WINDOW_DAYS * 86400000;
    return cache.notes.filter(n => (n.createdAt || 0) >= edge).slice(0, limit || 25);
  };
  const forRecord = (type, id) =>
    cache.notes.filter(n => n.relatedType === type && n.relatedId === id);

  // ── writes ──
  const MAX = 4000;
  function stripId(o) { const p = Object.assign({}, o); delete p.id; return p; }

  // Notes are plain text. The rich-text note lives on the opportunity
  // window, where it is scrubbed on the way in and out; a feed post has
  // no reason to carry markup, and not accepting any is the cheapest way
  // to be sure none is ever rendered.
  const plain = (s) => String(s == null ? '' : s).replace(/\s+$/, '').slice(0, MAX);

  // "@Maria" in the body, resolved against the book so a mention is a
  // pointer rather than a string. Unmatched @words stay as typed.
  function findMentions(body) {
    const H = RWG.hh;
    if (!H || !H.isStarted()) return [];
    const out = [], seen = {};
    String(body || '').replace(/@([\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*)?)/gu, (m, name) => {
      const key = name.trim().toLowerCase();
      const hit = H.contacts().find(c => H.contactName(c).toLowerCase() === key)
        || H.contacts().find(c => (c.firstName || '').toLowerCase() === key);
      if (hit && !seen[hit.id]) {
        seen[hit.id] = 1;
        out.push({ contactId: hit.id, name: H.contactName(hit), householdId: hit.householdId || null });
      }
      return m;
    });
    return out;
  }

  function addNote(fields) {
    const body = plain((fields || {}).body);
    if (!body.trim()) return null;
    const ref = db().collection('notes').doc();
    const mentions = findMentions(body);
    // An unpointed note that mentions exactly one person files itself
    // against their household — otherwise it would float free of the book.
    let rel = {
      relatedType: (fields || {}).relatedType || null,
      relatedId: (fields || {}).relatedId || null,
      relatedLabel: (fields || {}).relatedLabel || ''
    };
    if (!rel.relatedType && mentions.length === 1 && mentions[0].householdId) {
      const H = RWG.hh, h = H.household(mentions[0].householdId);
      if (h) rel = { relatedType: 'household', relatedId: h.id, relatedLabel: h.name };
    }
    const n = Object.assign({
      id: ref.id, body: body,
      authorUid: (me && me.id) || null, authorName: (me && me.name) || '',
      mentions: mentions,
      createdAt: now(), updatedAt: now()
    }, rel);
    cache.notes.unshift(n); onChange();
    db().collection('notes').doc(n.id).set(stripId(n))
      .catch(e => console.error('save note:', e && e.message));
    return n;
  }

  // Author or partner only (the UI hides the button; rules enforce it).
  function removeNote(id) {
    const n = note(id);
    cache.notes = cache.notes.filter(x => x.id !== id);
    onChange();
    const trash = RWG.trash;
    if (n && trash && trash.send) return trash.send('notes', id, n, n.body.slice(0, 80));
    return db().collection('notes').doc(id).delete()
      .catch(e => { console.error('delete note:', e && e.message); throw e; });
  }

  return {
    init, teardown, isStarted,
    all, note, recent, forRecord, findMentions,
    addNote, removeNote, WINDOW_DAYS,
    _cache: cache
  };
})();
