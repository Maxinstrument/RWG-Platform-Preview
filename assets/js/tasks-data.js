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

  // ── categories, priority, recurrence ──────────────────────
  // Categories are config-as-data, same as pipelines and rates: the
  // defaults live here so the app works before anyone opens Settings,
  // and config/taskcategories overrides them the moment it exists.
  const DEFAULT_CATEGORIES = ['Phone call', 'Email', 'Follow-up', 'Meeting prep',
    'Paperwork', 'Underwriting', 'Service', 'Compliance'];
  let CATEGORY_OVERRIDE = null;
  const categories = () =>
    (CATEGORY_OVERRIDE && CATEGORY_OVERRIDE.length) ? CATEGORY_OVERRIDE.slice() : DEFAULT_CATEGORIES.slice();

  const PRIORITIES = [
    { id: 'none', label: 'None' },
    { id: 'low', label: 'Low' },
    { id: 'normal', label: 'Normal' },
    { id: 'high', label: 'High' }
  ];
  const REPEATS = [
    { id: 'none', label: 'Does not repeat' },
    { id: 'daily', label: 'Every day' },
    { id: 'weekly', label: 'Every week' },
    { id: 'biweekly', label: 'Every 2 weeks' },
    { id: 'monthly', label: 'Every month' },
    { id: 'quarterly', label: 'Every 3 months' },
    { id: 'yearly', label: 'Every year' }
  ];

  // The next date after `from` for a given cadence, rolled forward until it
  // is genuinely ahead of `after` — completing a task you let slip by three
  // weeks should put the next one in the future, not in the past.
  function nextDue(from, repeat, after) {
    if (!from || !repeat || repeat === 'none') return null;
    const step = { daily: 1, weekly: 7, biweekly: 14 }[repeat];
    const months = { monthly: 1, quarterly: 3, yearly: 12 }[repeat];
    if (!step && !months) return null;
    const p = String(from).slice(0, 10).split('-').map(Number);
    let d = new Date(p[0], p[1] - 1, p[2]);
    const floor = after ? Date.parse(String(after).slice(0, 10) + 'T12:00:00') : 0;
    const guard = 400;   // a year of daily steps; a runaway cadence can't spin
    for (let i = 0; i < guard; i++) {
      if (step) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + step);
      else {
        const day = p[2];
        d = new Date(d.getFullYear(), d.getMonth() + months, 1);
        // Clamp for short months: the 31st becomes the 30th, not the 1st.
        d = new Date(d.getFullYear(), d.getMonth(), Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
      }
      if (Date.parse(todayKey(d.getTime()) + 'T12:00:00') > floor) break;
    }
    return todayKey(d.getTime());
  }

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

    // Categories the firm edits in Settings. Absent doc = code defaults.
    unsubs.push(db().collection('config').doc('taskcategories').onSnapshot(
      d => {
        // Settings writes {value, updatedAt, updatedBy} — the same envelope
        // pipelines, workflows and rates use.
        const v = d.exists ? (d.data() || {}).value : null;
        CATEGORY_OVERRIDE = Array.isArray(v) ? v.map(String).filter(Boolean) : null;
        onChange();
      },
      e => console.error('task categories listener:', e && e.message)));
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
      category: '', priority: 'none', repeat: 'none',
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

  // Completing a repeating task closes this one and opens the next. The
  // completed instance keeps its own record — history stays honest — and
  // `spawnedNext` makes the hand-off idempotent, so ticking, un-ticking and
  // re-ticking never leaves two copies of the same chore on someone's list.
  function toggleDone(id) {
    const t = task(id); if (!t) return;
    const done = t.status !== 'done';
    t.status = done ? 'done' : 'open';
    t.doneAt = done ? now() : null;
    t.doneBy = done ? ((me && me.id) || null) : null;
    t.updatedAt = now();

    let spawned = null;
    if (done && t.repeat && t.repeat !== 'none' && !t.spawnedNext) {
      const due = nextDue(t.dueDate || todayKey(), t.repeat, todayKey());
      if (due) {
        const carry = {};
        ['title', 'note', 'assigneeUid', 'assigneeName', 'relatedType', 'relatedId',
          'relatedLabel', 'category', 'priority', 'repeat', 'kind', 'serviceType'].forEach(k => {
            if (t[k] !== undefined) carry[k] = t[k];
          });
        carry.dueDate = due;
        carry.repeatOf = t.repeatOf || t.id;   // the whole chain points at its origin
        spawned = addTask(carry);              // addTask persists and repaints
        t.spawnedNext = spawned.id;
      }
    }

    onChange();
    return persist(t).then(() => spawned);
  }

  function removeTask(id) {   // admin only (rules)
    const t = task(id);
    cache.tasks = cache.tasks.filter(x => x.id !== id);
    onChange();
    if (t && RWG.trash) return RWG.trash.send('tasks', id, t, t.title || '(untitled task)');
    return db().collection('tasks').doc(id).delete()
      .catch(e => { console.error('delete task:', e && e.message); throw e; });
  }

  return {
    init, teardown, isStarted,
    all, task, open, openFor, groupByDue, dueCount, doneThisWeek, todayKey,
    addTask, saveTask, toggleDone, removeTask,
    categories, nextDue, DEFAULT_CATEGORIES, PRIORITIES, REPEATS,
    _cache: cache
  };
})();
