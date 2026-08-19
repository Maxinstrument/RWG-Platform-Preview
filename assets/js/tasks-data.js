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
    'Paperwork', 'Underwriting', 'Service', 'Closing Meeting'];
  /* Compliance came out and Closing Meeting went in (Carlos, Aug '26).
     Editing the defaults alone would change nothing for a firm that has
     already saved its own list in Settings, so a stored list carrying the
     retired word is brought forward too — but only while it has not been
     told otherwise. Once Closing Meeting is on the saved list, whatever
     else is on it is a deliberate choice and is left alone. */
  const RETIRED_CATEGORIES = { 'Compliance': 'Closing Meeting' };
  function repairCategories(list) {
    if (!Array.isArray(list) || list.indexOf('Closing Meeting') >= 0) return list;
    const out = [];
    list.forEach(name => {
      const to = RETIRED_CATEGORIES[name] || name;
      if (out.indexOf(to) < 0) out.push(to);
    });
    return out;
  }
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
        CATEGORY_OVERRIDE = Array.isArray(v) ? repairCategories(v.map(String).filter(Boolean)) : null;
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

  /* The Tasks grouping, in the order a morning asks the question: what is
     late, what is today, what is tomorrow, what is left of this week, what
     is next week, what is beyond that, and what has no date at all.

     The week boundary is the CALENDAR week, not seven rolling days — on a
     Thursday "next week" has to mean the Monday coming, or the phrase is a
     lie. Monday-based, matching the firm's Mon-Fri scorecard week. A
     Sunday collapses "this week" to nothing and hands Monday to Tomorrow,
     which is exactly how a Sunday feels.

     `today` is injectable so the grouping is testable. */
  function groupByDue(list, today) {
    const t = today || todayKey();
    const noon = Date.parse(t + 'T12:00:00');
    const at = (n) => todayKey(noon + n * 86400000);
    const tomorrow = at(1);
    const toSunday = (7 - new Date(noon).getDay()) % 7;   // 0 Sun .. 6 Sat -> days left
    const weekEnd = at(toSunday);
    const nextEnd = at(toSunday + 7);
    const g = { overdue: [], today: [], tomorrow: [], week: [], next: [], later: [], nodate: [] };
    list.forEach(x => {
      if (!x.dueDate) g.nodate.push(x);
      else if (x.dueDate < t) g.overdue.push(x);
      else if (x.dueDate === t) g.today.push(x);
      else if (x.dueDate === tomorrow) g.tomorrow.push(x);
      else if (x.dueDate <= weekEnd) g.week.push(x);
      else if (x.dueDate <= nextEnd) g.next.push(x);
      else g.later.push(x);
    });
    const byDue = (a, b) => String(a.dueDate).localeCompare(String(b.dueDate)) || (a.createdAt || 0) - (b.createdAt || 0);
    Object.keys(g).forEach(k => g[k].sort(byDue));
    return g;
  }
  /* The nav badge: what this person owes right now. A workflow step that
     is waiting on an earlier step is not owed by anybody yet — counting it
     puts a number on the nav for work that cannot be started, which is the
     fastest way to teach someone to ignore the number. */
  function dueCount(uid) {
    const t = todayKey();
    const held = (RWG.wf && RWG.wf.blockedIds) ? RWG.wf.blockedIds() : {};
    return openFor(uid).filter(x => x.dueDate && x.dueDate <= t && !held[x.id]).length;
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
      // relatedType/Id is what the task is ABOUT — a contact, an opportunity,
      // a household or a lead. contactId is who it is FOR: the person. It is
      // carried alongside so a task about a policy still surfaces on that
      // person's record, and stays there once the task is closed — which is
      // what makes the contact's history complete. householdId rides along
      // the same way for the family screens. A task pointed at a contact has
      // both pointers and they agree.
      relatedType: null, relatedId: null, relatedLabel: '',
      contactId: null, householdId: null,
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
          'relatedLabel', 'contactId', 'householdId',
          'category', 'priority', 'repeat', 'kind', 'serviceType'].forEach(k => {
            if (t[k] !== undefined) carry[k] = t[k];
          });
        carry.dueDate = due;
        carry.repeatOf = t.repeatOf || t.id;   // the whole chain points at its origin
        spawned = addTask(carry);              // addTask persists and repaints
        t.spawnedNext = spawned.id;
      }
    }

    // Completing a workflow step starts the clocks of the steps chained
    // to it — "medical due 1 day after the signed application", counted
    // from the tick, not from launch. The workflow module owns the math.
    if (done && t.workflowId && RWG.wf && RWG.wf.rebaseChains) RWG.wf.rebaseChains(t);

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
    repairCategories,   // the retired-word migration, exposed so it can be pinned
    _cache: cache
  };
})();
