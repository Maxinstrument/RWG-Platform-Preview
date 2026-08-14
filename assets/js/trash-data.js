/* ============================================================
   RWG Platform — Trash

   Nothing this team deletes should be gone until a partner says so.
   Leads have worked this way since the beginning (deleted_leads);
   this generalises the same idea to everything else.

     trash/{coll}__{originalId}
        coll, originalId, kind, label, snapshot, deletedAt/By/ByName

   The id is derived, not random, so deleting the same record twice
   cannot leave two copies, and restoring puts it back under the id
   it always had — every pointer at it (a task's relatedId, a case's
   householdId) still resolves.

   Deliberately NOT a live listener. The bin is a place partners
   visit, not a thing the app carries around; it is read on demand.

   Restore is the reason this exists, so it is one click. Purge is
   the dangerous one, so it asks.
   ============================================================ */
window.RWG = window.RWG || {};

RWG.trash = (function () {
  const db = () => RWG.fb && RWG.fb.db;
  const now = () => Date.now();
  const me = () => (RWG.auth && RWG.auth.currentUser && RWG.auth.currentUser()) || null;

  // What each collection is called in front of a human, and where its
  // rows live in the caches so a restore can repaint immediately.
  const KINDS = {
    households: { kind: 'Household', icon: '🏠' },
    contacts:   { kind: 'Person',    icon: '👤' },
    cases:      { kind: 'Opportunity', icon: '📁' },
    tasks:      { kind: 'Task',      icon: '✓'  },
    notes:      { kind: 'Note',      icon: '💬' },
    // Leads keep their original deleted_leads archive; the Trash screen
    // adapts those rows into this shape so there is one bin, not two.
    leads:      { kind: 'Lead',      icon: '✦'  }
  };
  const kindOf = (coll) => (KINDS[coll] || { kind: coll, icon: '•' });

  const docId = (coll, id) => coll + '__' + id;
  const stripId = (o) => { const p = Object.assign({}, o || {}); delete p.id; return p; };

  /* Archive a record, then delete the original — one batch, so a record
     can never be gone from the live collection without a copy in the bin.
     Callers have usually already removed it from their local cache for a
     responsive UI; that is fine, the listener is the source of truth. */
  function send(coll, id, snapshot, label) {
    if (!db()) return Promise.reject(new Error('no database'));
    const u = me();
    const meta = kindOf(coll);
    const archive = {
      coll: coll, originalId: id,
      kind: meta.kind,
      label: String(label == null ? '' : label).slice(0, 120) || '(unnamed)',
      snapshot: stripId(snapshot),
      deletedAt: now(),
      deletedBy: (u && u.id) || null,
      deletedByName: (u && u.name) || ''
    };
    const batch = db().batch();
    batch.set(db().collection('trash').doc(docId(coll, id)), archive);
    batch.delete(db().collection(coll).doc(id));
    return batch.commit().catch(e => { console.error('trash ' + coll + ':', e && e.message); throw e; });
  }

  // One-time read, newest first. Partners only (enforced by rules).
  function fetchAll() {
    if (!db()) return Promise.resolve([]);
    return db().collection('trash').get().then(s => {
      const rows = s.docs.map(d => Object.assign({ id: d.id }, d.data()));
      rows.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
      return rows;
    });
  }

  /* Put it back under its original id. Read the archive inside the
     promise rather than trusting a row the screen was holding, so two
     partners clicking Restore on the same thing cannot both write. */
  function restore(trashId) {
    const ref = db().collection('trash').doc(trashId);
    return ref.get().then(d => {
      if (!d.exists) throw new Error('Already restored, or purged.');
      const row = d.data() || {};
      if (!row.coll || !row.originalId) throw new Error('This archive row is missing its origin.');
      const batch = db().batch();
      batch.set(db().collection(row.coll).doc(row.originalId), row.snapshot || {});
      batch.delete(ref);
      return batch.commit().then(() => row);
    });
  }

  function purge(trashId) {
    return db().collection('trash').doc(trashId).delete();
  }

  return { send, fetchAll, restore, purge, KINDS, kindOf, docId };
})();
