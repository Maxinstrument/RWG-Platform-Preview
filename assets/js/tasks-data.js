/* ============================================================
   RWG Platform — Tasks data layer (phase 3)

   One collection, one shape, everything hangs off it:
     tasks/{id}  title, assignee, due date, done, and a pointer at
                 the thing it is about (household / case / lead).

   A task always points at something real when it can — that is
   what makes "who is in charge of what" answerable. The pointer is
   denormalised (type + id + label) so lists render without joins.

   `required` is carried but unused until workflows (phase 4) start
   creating tasks that block a stage.

   Same pattern as every other layer: live cache, optimistic local
   writes, dormant until a module calls init().
   ============================================================ */
window.RWG = window.RWG || {};

RWG.tasks = (function () {
  const db = () => RWG.fb && RWG.fb.db;
  const now = () => Date.now();

  const cache = { tasks: [] };
  let onChange = () => {};
  let me = null;
  let unsubs = [];
  let started = false;

  function init(profile, cb) {
    me = profile;
    onChange = cb || (() => {});
    if (!db()) { console.warn('tasks.init: Firebase not ready'); return; }
    teardown();
    started = true;
    // Whole team, one listener — visibility is open, same as the book.
    unsubs.push(db().collection('tasks').onSnapshot(
      s => { cache.tasks = s.docs.map(d => Object.assign({ id: d.id }, d.data())); onChange(); },
      e => console.error('tasks listener:', e && e.message)));
  }
  function teardown() {
    unsubs.forEach(u => { try { u(); } catch (e) {} });
    unsubs = []; started = false; cache.tasks = [];
  }
  const isStarted = () => started;

  // ── reads ──
  const all = () => cache.tasks.slice();
  const task = (id) => cache.tasks.find(t => t.id === id) || null;
  const open = () => cache.tasks.filter(t => t.status !== 'done');
  const openFor = (uid) => open().filter(t => t.assigneeUid === uid);

  // Local calendar date — the whole team lives on Eastern time.
  function todayKey(ms) {
    const d = ms ? new Date(ms) : new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // The My Work grouping: overdue / today / this week / later / no date.
  // `today` is injectable so the grouping is testable.
  function groupByDue(list, today) {
    const t = today || todayKey();
    const weekEdge = todayKey(Date.parse(t + 'T12:00:00') + 7 * 86400000);
    const g = { overdue: [], today: [], week: [], later: [], nodate: [] };
    list.forEach(x => {
      if (!x.dueDate) g.nodate.push(x);
      else if (x.dueDate < t) g.overdue.push(x);
      else if (x.dueDate === t) g.today.push(x);
      else if (x.dueDate <= weekEdge) g.week.push(x);
      else g.later.push(x);
    });
    const byDue = (a, b) => String(a.dueDate).localeCompare(String(b.dueDate)) || (a.createdAt || 0) - (b.createdAt || 0);
    Object.keys(g).forEach(k => g[k].sort(byDue));
    return g;
  }
  // The nav badge: what this person owes right now.
  function dueCount(uid) {
    const t = todayKey();
    return openFor(uid).filter(x => x.dueDate && x.dueDate <= t).length;
  }
  const doneThisWeek = () => {
    const edge = now() - 7 * 86400000;
    return cache.tasks.filter(t => t.status === 'done' && (t.doneAt || 0) >= edge);
  };

  // ── writes ──
  function stripId(o) { const p = Object.assign({}, o); delete p.id; return p; }
  function persist(t) {
    return db().collection('tasks').doc(t.id).set(stripId(t))
      .catch(e => { console.error('save task:', e && e.message); throw e; });
  }

  function addTask(fields) {
    const ref = db().collection('tasks').doc();
    const t = Object.assign({
      id: ref.id, title: '', note: '',
      assigneeUid: (me && me.id) || null, assigneeName: (me && me.name) || '',
      dueDate: todayKey(), status: 'open', doneAt: null, doneBy: null,
      relatedType: null, relatedId: null, relatedLabel: '',
      required: false, workflowId: null,
      createdAt: now(), createdBy: (me && me.id) || null,
      createdByName: (me && me.name) || '', updatedAt: now()
    }, fields);
    cache.tasks.push(t); onChange();
    persist(t);
    return t;
  }

  function saveTask(patch) {
    const t = task(patch.id); if (!t) return;
    Object.assign(t, patch, { updatedAt: now() });
    onChange();
    return persist(t);
  }

  function toggleDone(id) {
    const t = task(id); if (!t) return;
    const done = t.status !== 'done';
    t.status = done ? 'done' : 'open';
    t.doneAt = done ? now() : null;
    t.doneBy = done ? ((me && me.id) || null) : null;
    t.updatedAt = now();
    onChange();
    return persist(t);
  }

  function removeTask(id) {   // admin only (rules)
    cache.tasks = cache.tasks.filter(t => t.id !== id);
    onChange();
    return db().collection('tasks').doc(id).delete()
      .catch(e => { console.error('delete task:', e && e.message); throw e; });
  }

  return {
    init, teardown, isStarted,
    all, task, open, openFor, groupByDue, dueCount, doneThisWeek, todayKey,
    addTask, saveTask, toggleDone, removeTask,
    _cache: cache
  };
})();
