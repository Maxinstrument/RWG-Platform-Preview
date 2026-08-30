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
  /* The list exactly as the server holds it, before repairCategories()
     rewrites a retired word for display. Adding has to build on THIS, not
     on the repaired copy: the rule on config/taskcategories refuses any
     write that drops a word the stored list still carries, and the repair
     drops one by design. Reading shows the new word, writing preserves the
     old one, and the migration stays what it has always been — something
     that happens on the way to the screen, not a silent rewrite of the
     firm's document by whoever happened to add a category that morning. */
  let CATEGORY_RAW = null;
  const categories = () =>
    (CATEGORY_OVERRIDE && CATEGORY_OVERRIDE.length) ? CATEGORY_OVERRIDE.slice() : DEFAULT_CATEGORIES.slice();

  /* Adding a category is open to the whole team; the LIST is still the
     firm's. Carlos, Aug '26: "let anyone create a Category in case there is
     one I missed but the team finds valuable." The person who notices a word
     is missing is the person filing the task at 4pm, and Settings is a door
     only a partner can open — so they picked the wrong word, or picked none
     at all, and the category on a task stopped meaning anything. Appending
     is safe; renaming, reordering and removing another person's word out
     from under them is not, so those stay in Settings. The Firestore rule
     on config/taskcategories enforces exactly that split rather than
     trusting this function to be the only caller.

     The write is always the WHOLE list, never just the new word. Until a
     partner opens Settings the doc does not exist and the effective list is
     the code defaults above — so creating it with one name would quietly
     delete the eight defaults for everybody. */
  const CATEGORY_MAX = 40;   // room for "Beneficiary review"; not room for a paragraph
  function addCategory(name) {
    const clean = String(name == null ? '' : name).trim().replace(/\s+/g, ' ').slice(0, CATEGORY_MAX);
    if (!clean) return Promise.reject(new Error('A category needs a name'));
    const list = categories();
    /* What the server actually holds. Absent doc: the code defaults, which
       is what everyone is seeing, so that is what gets written. A stored
       EMPTY list is a real answer too — a partner who cleared the list
       meant it — so [] stays [] and the new word joins nothing else. */
    const base = Array.isArray(CATEGORY_RAW) ? CATEGORY_RAW.slice() : DEFAULT_CATEGORIES.slice();
    /* Already there under a different shift key. Two words that differ by a
       capital are two halves of a filter that will never agree, so this is
       not an error — it is the word they were reaching for. Hand back the
       one that exists, spelled the way the firm spells it, and let the
       caller select it. */
    const hit = list.filter(c => c.toLowerCase() === clean.toLowerCase())[0];
    if (hit) return Promise.resolve({ name: hit, added: false });
    /* Typing the retired word itself. It is not on the list they can see,
       but it IS in the document, so appending it would write a duplicate.
       Hand back what the repair turned it into — the word actually on the
       screen — so the select can land on something that exists. */
    const buried = base.filter(c => c.toLowerCase() === clean.toLowerCase())[0];
    if (buried) return Promise.resolve({ name: RETIRED_CATEGORIES[buried] || buried, added: false });
    if (!db()) return Promise.reject(new Error('Not connected'));
    const next = base.concat([clean]);
    return db().collection('config').doc('taskcategories').set({
      value: next, updatedAt: new Date().toISOString(), updatedBy: (me && me.id) || null
    }).then(() => {
      /* Paint it here rather than waiting for the listener to come back:
         the select that asked for it is on screen right now. On success
         only — a refused write has to leave the list exactly as the firm
         has it. Two people adding in the same second is caught by the rule
         (hasAll compares against the server's list, so the second one is
         REFUSED, not silently overwriting the first), and the honest answer
         to that is a toast and one more click. */
      CATEGORY_RAW = next.slice();
      CATEGORY_OVERRIDE = repairCategories(next.slice());
      onChange();
      return { name: clean, added: true };
    });
  }

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
        CATEGORY_RAW = Array.isArray(v) ? v.map(String).filter(Boolean) : null;
        CATEGORY_OVERRIDE = CATEGORY_RAW ? repairCategories(CATEGORY_RAW.slice()) : null;
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
    // Undated sorts last on the explicit sentinel rather than on the fact
    // that "null" happens to fall after a digit. Only the nodate bucket
    // holds them, where they all tie and fall through to createdAt anyway —
    // but the rule should be written down, not inferred from string order.
    const key = (t) => t.dueDate || '9999-12-31';
    const byDue = (a, b) => key(a).localeCompare(key(b)) || (a.createdAt || 0) - (b.createdAt || 0);
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
      /* No date unless somebody chooses one. Carlos, 30 Aug '26.
         Defaulting to today made the due date a timestamp of when the task
         was typed rather than a decision about when it is wanted, and once
         everything is due today "overdue" stops meaning late and starts
         meaning "written a few days ago" — which is how 22 of 68 open tasks
         could be past their date with nobody alarmed. A blank date is
         honest: it says nobody has scheduled this yet, which is a question
         somebody can answer. The callers that compute a REAL date — a
         workflow step's schedule, a birthday three days out, a service
         request — pass one in and are untouched by this. */
      dueDate: null, status: 'open', doneAt: null, doneBy: null,
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

  /* ── Move every task off a profile that no longer signs in ──
     Somebody who re-registers under a new email gets a NEW uid, and their
     tasks keep pointing at the old one. Nothing looks wrong from across the
     room: the row still reads the right name, because assigneeName is
     stored beside the uid. But "Assigned to me" matches on the uid, so the
     person sees none of their own work — and the task window cannot repair
     it either, since its assignee list offers active profiles only and the
     dead one it is bound to is not in the dropdown.

     Both fields move together. Moving the uid and leaving the name would
     trade an invisible break for a visible lie.

     createdBy and doneBy stay where they are, deliberately. Those record
     who did a thing, which is history; assigneeUid records who still has
     to do it, which is the only part that is wrong. */
  function reassign(fromUid, toUid, toName) {
    if (!fromUid || !toUid || fromUid === toUid) return Promise.resolve({ moved: 0, open: 0 });
    const mine = cache.tasks.filter(t => t.assigneeUid === fromUid);
    if (!mine.length) return Promise.resolve({ moved: 0, open: 0 });
    const stamp = now();
    const chunks = [];                      // a Firestore batch caps at 500
    for (let i = 0; i < mine.length; i += 400) chunks.push(mine.slice(i, i + 400));
    return chunks.reduce((p, ch) => p.then(() => {
      const b = db().batch();
      ch.forEach(t => b.update(db().collection('tasks').doc(t.id),
        { assigneeUid: toUid, assigneeName: toName || '', updatedAt: stamp }));
      return b.commit();
    }), Promise.resolve()).then(() => {
      mine.forEach(t => { t.assigneeUid = toUid; t.assigneeName = toName || ''; t.updatedAt = stamp; });
      onChange();
      return { moved: mine.length, open: mine.filter(t => t.status === 'open').length };
    });
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
    addTask, saveTask, toggleDone, removeTask, reassign,
    categories, addCategory, CATEGORY_MAX,
    nextDue, DEFAULT_CATEGORIES, PRIORITIES, REPEATS,
    repairCategories,   // the retired-word migration, exposed so it can be pinned
    _cache: cache
  };
})();
