/* ============================================================
   RWG Platform — Tasks

   The screen everyone opens first. One list, everything you owe,
   grouped by WHEN — not by which record produced it. A task, a
   workflow step and a service request all land here, because at
   8am the question is what to do next, not which system it came
   from.

   The filter bar reads as a sentence — "Filtering by Upcoming
   work assigned to Maryurie in category Underwriting" — so the
   state of the screen is legible without decoding four dropdowns.

   Right rail: today's lead follow-ups (callbacks + appointments),
   key dates ahead (birthdays), and cases going quiet.

   Tasks can be created from here or from any household ("＋ Task"
   there routes to this module's action — actions are global).
   ============================================================ */
window.RWG = window.RWG || {};

(function () {
  const T = () => RWG.tasks;
  const H = () => RWG.hh;
  const SD = () => RWG.scorecardData;
  const SC = () => RWG.scorecard;
  const D = () => RWG.data;
  const U = () => RWG.ui;
  const esc = (s) => U().esc(s);
  const dayMs = 86400000;

  // who: 'me' | 'all' | a uid.  Everything stays visible either way.
  // sel: null = the ordinary list; {} = select mode, ids → 1 while picking.
  // chain: show the workflow steps that are waiting on an earlier step.
  const st = { who: 'me', when: 'upcoming', kind: 'all', cat: '', sel: null, chain: false };

  /* Which day groups are folded shut. Kept on the device, not the record:
     it is how one person likes to read the screen, not something about the
     firm. Future and no-date start shut — they are the two groups that
     answer "not now", and a morning list should open on what is now. */
  const FOLD_KEY = 'rwg.tasks.folded';
  let folded = { later: 1, nodate: 1 };
  try {
    const saved = localStorage.getItem(FOLD_KEY);
    if (saved) folded = JSON.parse(saved) || {};
  } catch (e) {}
  function saveFold() { try { localStorage.setItem(FOLD_KEY, JSON.stringify(folded)); } catch (e) {} }
  // Deleting is a partner power, like everywhere else in the app — and it
  // is a move to the Trash, never an erasure.
  const canDelete = () => RWG.auth.isAdmin && RWG.auth.isAdmin()
    && (!RWG.app.effectiveRole || RWG.app.effectiveRole() === 'admin');

  const WHEN = [
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'overdue', label: 'Overdue' },
    { id: 'today', label: 'Due today' },
    { id: 'week', label: 'This week' },
    { id: 'completed', label: 'Completed' },
    { id: 'all', label: 'Everything' }
  ];
  const KINDS = [
    { id: 'all', label: 'All work' },
    { id: 'task', label: 'Tasks' },
    { id: 'workflow', label: 'Workflow steps' },
    { id: 'service', label: 'Service requests' }
  ];

  // ── the task modal (add + edit) ───────────────────────────
  // A task opened while another window is up (the opportunity window,
  // mostly) stacks on layer 2 instead of replacing it: close or save the
  // task and the window underneath is still there, edits and all.
  const mount = () => {
    const m1 = document.getElementById('modal-mount');
    const m2 = document.getElementById('modal-mount-2');
    if (m2 && m1 && m1.firstElementChild) return m2;
    return m1;
  };
  /* mount() answers "where should this OPEN". Asking it again on the way
     out returns the wrong layer: by then layer 1 holds the task modal
     itself, so the answer flips to layer 2 and the clear lands on an
     empty div while the window stays on screen. Closing is its own
     question — peel whichever layer is actually on top. */
  const closeTop = () => {
    const m2 = document.getElementById('modal-mount-2');
    if (m2 && (m2.firstElementChild || m2.innerHTML)) { m2.innerHTML = ''; return; }
    const m1 = document.getElementById('modal-mount');
    if (m1) m1.innerHTML = '';
  };
  const g = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };

  /* ── "Related to": one box, three kinds of record ─────────
     A task is about a person, an opportunity, or (rarely) a whole family.
     Three dependent dropdowns would be three chances to leave it half-set,
     and one dropdown holding the entire book is a list you scroll rather
     than a question you answer — so it is the shared record picker: type
     a few letters, or make the record you meant right there.

     The pointer survives the task being closed, which is what lets a
     contact's history show work that finished months ago. */
  const REL_TYPES = ['contact', 'case', 'household'];

  function taskModal(t, preset) {
    preset = preset || {};
    const v = (k, dflt) => t && t[k] != null ? t[k] : (preset[k] != null ? preset[k] : dflt);
    const me = RWG.auth.currentUser();
    const users = D().users().filter(u => u.status === 'active');
    const list = users.length ? users : [me];
    const selUid = v('assigneeUid', me.id);
    const assigneeOpts = list.map(u => `<option value="${esc(u.id)}" ${u.id === selUid ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
    const relType = v('relatedType', null), relId = v('relatedId', null);
    const selCat = v('category', '');
    // A task filed under a category that has since left the list keeps its
    // word: the option is carried so opening and saving the task cannot
    // quietly erase what it was filed under.
    const cats = T().categories();
    const catOpts = ['<option value="">— none —</option>']
      .concat(selCat && cats.indexOf(selCat) < 0
        ? [`<option value="${esc(selCat)}" selected>${esc(selCat)} (retired)</option>`] : [])
      .concat(cats.map(c => `<option value="${esc(c)}" ${c === selCat ? 'selected' : ''}>${esc(c)}</option>`)).join('');
    const selPri = v('priority', 'none');
    const priOpts = T().PRIORITIES.map(p =>
      `<option value="${p.id}" ${p.id === selPri ? 'selected' : ''}>${esc(p.label)}</option>`).join('');
    const selRep = v('repeat', 'none');
    const repOpts = T().REPEATS.map(r =>
      `<option value="${r.id}" ${r.id === selRep ? 'selected' : ''}>${esc(r.label)}</option>`).join('');

    mount().innerHTML = `
      <div class="scrim" data-action="close-modal"></div>
      <div class="modal-card">
        <div class="modal-head"><h2>${t ? 'Edit task' : 'New task'}</h2>
          ${t ? '' : '<p>Assign it to anyone — it lands on their list.</p>'}</div>
        <div class="modal-body">
          <div class="field-group"><label class="lbl">What needs doing</label>
            <input id="tk-title" value="${esc(v('title', ''))}" placeholder="e.g. Chase the APS from Dr. Reyes' office"></div>
          <div class="field-row">
            <div class="field-group"><label class="lbl">Assigned to</label>
              <select id="tk-assignee">${assigneeOpts}</select></div>
            <div class="field-group"><label class="lbl">Due</label>
              <input id="tk-due" type="date" value="${esc(v('dueDate', T().todayKey()))}"></div>
          </div>
          <div class="field-row">
            <div class="field-group"><label class="lbl">Category</label>
              <select id="tk-cat">${catOpts}</select></div>
            <div class="field-group"><label class="lbl">Priority</label>
              <select id="tk-pri">${priOpts}</select></div>
          </div>
          <div class="field-group"><label class="lbl">Repeats</label>
            <select id="tk-rep">${repOpts}</select>
            <div class="hint">A repeating task opens its next copy when you tick this one off.</div></div>
          <div class="field-group"><label class="lbl">Related to</label>
            ${U().pickerHtml({ id: 'tk-rel', type: relType, recordId: relId,
              placeholder: 'Search a contact, opportunity or household…' })}
            <input type="hidden" id="tk-relcontact" value="${esc(v('contactId', '') || '')}">
            <div style="margin-top:8px"><button class="btn btn-quiet btn-sm" data-action="tk-view-ctc"
              title="Look up their phone and email beside this window — you keep everything you have typed">View contact</button></div>
            <div class="hint">Who or what this is for. Not in the book yet? Type the name and
              make it from the same box. It stays attached after the task is done, so it shows
              in that record's history.</div></div>
          <div class="field-group"><label class="lbl">Note <span class="pill-soft" style="font-size:10.5px">optional</span></label>
            ${U().noteEditor({ id: 'tk-note', value: v('note', ''), minHeight: '84px',
              placeholder: 'Anything worth remembering about this task…' })}</div>
        </div>
        <div class="modal-foot">
          ${t && canDelete() ? `<button class="btn btn-quiet" style="color:var(--bad)" data-action="tk-del" data-id="${esc(t.id)}"
            title="Moves to the Trash — a partner can restore it">Delete</button>` : ''}
          <span class="topbar-spacer"></span>
          <button class="btn btn-ghost" data-action="close-modal">Cancel</button>
          <button class="btn btn-gold" data-action="tk-save" ${t ? `data-id="${esc(t.id)}"` : ''}>${t ? 'Save' : 'Add task'}</button>
        </div>
      </div>`;
    // Creating an opportunity from this box makes it for whoever the task is
    // already about — that is what the hidden contact is holding.
    U().pickerInit({
      id: 'tk-rel', types: REL_TYPES, create: REL_TYPES, type: relType, recordId: relId,
      context: () => ({ contactId: g('tk-relcontact') || null, householdId: v('householdId', '') || null }),
      onPick: (rec) => {
        const h = document.getElementById('tk-relcontact');
        if (h) h.value = (rec && rec.contactId) || '';
      }
    });
    const inp = document.getElementById('tk-title'); if (inp && !t) inp.focus();
  }

  // ── what a task is, for the type filter ───────────────────
  function kindOf(t) {
    if (t.kind === 'service') return 'service';
    if (t.workflowId) return 'workflow';
    return 'task';
  }

  // ── task rows ─────────────────────────────────────────────
  // Two questions, two chips: WHO is this for, and WHAT is it about.
  // An underwriting step used to answer neither from the task list — you had
  // the step title and nothing else, which is no use at 8am with eleven of them.
  const chipBtn = (act, id, label, icon) =>
    `<button class="chip" style="cursor:pointer;background:rgba(14,36,64,.05);color:var(--navy);border:1px solid var(--line);font-weight:600"
      data-action="${act}" data-id="${esc(id)}" title="${esc(label)}">${icon ? icon + ' ' : ''}${esc(label)}</button>`;

  // The person first — that is the name you recognise at 8am — then the
  // thing itself. A workflow step on the Vargas whole life reads
  // "Maria Vargas · Vargas — whole life", and both chips are live.
  function relatedChip(t) {
    const out = [];
    const started = RWG.hh && RWG.hh.isStarted();
    const c = t.contactId && started ? RWG.hh.contact(t.contactId) : null;
    if (c && !(t.relatedType === 'contact' && t.relatedId === c.id)) {
      out.push(chipBtn('ct-open', c.id, RWG.hh.contactName(c), U().icon('person', 'ic-inline')));
    }
    if (t.relatedId) {
      const act = U().relAction(t.relatedType);
      if (act) out.push(chipBtn(act, t.relatedId, t.relatedLabel || t.relatedType,
        U().relIcon(t.relatedType, 'ic-inline')));
    }
    // The family only when nothing more specific is on the task — a task
    // filed against the household itself, or old data from before contacts
    // carried their own pointer.
    if (!out.length && t.householdId && started) {
      const hh = RWG.hh.household(t.householdId);
      if (hh) out.push(chipBtn('hh-goto', hh.id, hh.name, U().icon('household', 'ic-inline')));
    }
    return out.join('');
  }
  function dueLabel(t, today) {
    if (t.status === 'done') return `<span class="cell-sub">${t.doneAt ? U().fmtRelative(t.doneAt) : 'done'}</span>`;
    if (!t.dueDate) return '<span class="cell-sub">no date</span>';
    if (t.dueDate < today) {
      const days = Math.round((Date.parse(today) - Date.parse(t.dueDate)) / dayMs);
      return `<span style="color:var(--bad);font-weight:700;font-size:12px">${days} day${days === 1 ? '' : 's'} late</span>`;
    }
    if (t.dueDate === today) return '<span style="color:var(--warn);font-weight:700;font-size:12px">Today</span>';
    return `<span class="cell-sub">${U().fmtDate(Date.parse(t.dueDate + 'T12:00:00'))}</span>`;
  }
  // High priority earns a mark; the rest stay quiet so the mark keeps meaning.
  function priorityFlag(t) {
    if (t.priority === 'high') return '<span class="chip tier-low" style="font-size:10.5px;background:rgba(178,58,72,.10);color:var(--bad);border-color:rgba(178,58,72,.32)">high</span>';
    if (t.priority === 'low') return '<span class="cell-sub" style="font-size:11px">low</span>';
    return '';
  }
  function taskRow(t, today, showAssignee) {
    const picking = !!st.sel;
    // The step this one is chained behind, when that step is still open.
    // Normally these rows are not on the list at all; they appear when the
    // chain toggle is on, and then they read as pending, not as work.
    const wait = t.status !== 'done' && RWG.wf && RWG.wf.waitingOn ? RWG.wf.waitingOn(t) : null;
    /* The whole row is the door: it carries the action, and the dispatcher's
       innermost-wins rule keeps every control inside it (the done box, a
       contact chip, a category) doing its own job. In select mode the row
       picks instead of opens, so a batch is click-click-click anywhere. */
    return `<div class="list-row list-row-click${wait ? ' held' : ''}" data-action="${picking ? 'tk-sel' : 'tk-edit'}" data-id="${esc(t.id)}"
        ${picking && st.sel[t.id] ? 'style="background:rgba(194,161,77,.07)"' : ''}>
      ${picking
        ? `<input type="checkbox" data-action="tk-sel" data-id="${esc(t.id)}" ${st.sel[t.id] ? 'checked' : ''}
            style="margin-top:3px;accent-color:var(--gold)" title="Select for deletion">`
        : `<input type="checkbox" data-action="tk-done" data-id="${esc(t.id)}" ${t.status === 'done' ? 'checked' : ''}
            style="margin-top:3px">`}
      <div class="grow">
        <div style="font-size:13.5px;color:var(--ink);${t.status === 'done' ? 'text-decoration:line-through;opacity:.55' : ''}">
          <span data-action="tk-edit" data-id="${esc(t.id)}" style="cursor:pointer">${esc(t.title)}</span></div>
        <div class="flex" style="gap:6px;margin-top:4px;flex-wrap:wrap;align-items:center">
          ${relatedChip(t)}
          ${t.category ? `<button class="tag-chip" data-action="tk-cat-pick" data-cat="${esc(t.category)}">${esc(t.category)}</button>` : ''}
          ${t.workflowName ? `<span class="chip tier-gold" style="font-size:10.5px" title="Step ${(t.workflowStep || 0) + 1} of the ${esc(t.workflowName)} workflow">${U().icon('workflow','ic-inline')} ${esc(t.workflowName)}</span>` : ''}
          ${t.kind === 'service' ? `<span class="chip" style="font-size:10.5px;background:rgba(62,92,130,.10);color:#3E5C82;border:1px solid rgba(62,92,130,.35)">${U().icon('service','ic-inline')} ${esc(t.serviceType || 'Service')}</span>` : ''}
          ${t.kind === 'service' && t.waiting && t.status !== 'done' ? '<span class="chip tier-medium" style="font-size:10.5px">⏸ waiting</span>' : ''}
          ${t.required ? '<span class="chip tier-medium" style="font-size:10.5px" title="A required step — the case cannot be pushed to Won until this is done">required</span>' : ''}
          ${wait ? `<span class="chip" style="font-size:10.5px;background:rgba(92,107,126,.10);color:var(--muted);border:1px solid rgba(92,107,126,.3)"
            title="Chained: this step opens when “${esc(wait.title)}” is checked off">⛓ after: ${esc(wait.title.length > 34 ? wait.title.slice(0, 33) + '…' : wait.title)}</span>` : ''}
          ${t.repeat && t.repeat !== 'none' ? '<span class="cell-sub" style="font-size:11px" title="Repeats">↻</span>' : ''}
          ${priorityFlag(t)}
          ${showAssignee ? `<span class="pill-soft" style="font-size:11px">${esc((t.assigneeName || '').split(' ')[0])}</span>` : ''}
          ${t.note ? `<span class="cell-sub" style="font-size:11.5px">${U().noteHtml(t.note)}</span>` : ''}
        </div>
      </div>
      <div class="end" style="padding-top:3px">${dueLabel(t, today)}</div>
    </div>`;
  }
  /* Each day group is a lid you can shut. Fifteen rows under one heading
     is a list; fifteen rows under six headings is a day you can read. The
     header is a real button, so it folds from the keyboard too, and the
     count stays visible while it is shut — folding must never become a way
     to lose track of eight overdue tasks. */
  function group(key, label, list, today, showAssignee, tone) {
    if (!list.length) return '';
    const shut = !!folded[key];
    return `<button type="button" class="list-group fold${tone ? ' ' + tone : ''}${shut ? ' shut' : ''}"
        data-action="tk-fold" data-key="${key}" aria-expanded="${shut ? 'false' : 'true'}">
        <span class="fold-caret">▾</span><span>${label}</span><span class="fold-n">${list.length}</span></button>
      ${shut ? '' : list.map(t => taskRow(t, today, showAssignee)).join('')}`;
  }

  // ── the filtered set ──────────────────────────────────────
  // Everything except the WHEN slice, which the body applies as grouping.
  function base(uid) {
    let list = st.when === 'completed' || st.when === 'all' ? T().all() : T().open();
    if (st.when === 'completed') list = list.filter(t => t.status === 'done');
    if (st.who === 'me') list = list.filter(t => t.assigneeUid === uid);
    else if (st.who !== 'all') list = list.filter(t => t.assigneeUid === st.who);
    if (st.kind !== 'all') list = list.filter(t => kindOf(t) === st.kind);
    if (st.cat) list = list.filter(t => (t.category || '') === st.cat);
    return list;
  }

  // ── the right rail ────────────────────────────────────────
  function railHtml(user, isAdmin) {
    const cards = [];

    // 1 · lead follow-ups: callbacks due + appointments today
    if (RWG.data) {
      const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
      const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
      /* YOUR leads — the card says so, and it has to mean it. A partner
         sees the whole leads table, so `isAdmin ||` here quietly turned a
         personal to-do list into the firm's backlog: five overdue
         callbacks belonging to agents, on the screen of somebody who works
         no leads at all. The morning list only carries work that is
         actually yours; the firm's view of the same thing is the Leads
         screen, where it can be reassigned. */
      const mine = (l) => !!l.assignedTo && l.assignedTo === user.id;
      const calls = D().leadsRaw().filter(l => mine(l) && l.callbackAt && l.callbackAt <= endOfToday.getTime());
      const appts = D().leadsRaw().filter(l => mine(l) && l.apptDate && l.apptDate >= startOfToday.getTime() && l.apptDate <= endOfToday.getTime());
      if (calls.length || appts.length) {
        const rows = appts.map(l => `<div class="list-row" style="gap:9px">
            <span style="flex:none">📅</span>
            <span style="min-width:0"><span style="font-size:13px;color:var(--ink);cursor:pointer;font-weight:600" data-action="open-lead" data-id="${esc(l.id)}">${esc(D().fullName(l))}</span>
            <span class="cell-sub" style="display:block">Appointment ${new Date(l.apptDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span></span></div>`)
          .concat(calls.map(l => `<div class="list-row" style="gap:9px">
            <span style="flex:none">${U().icon('phone','ic-sm')}</span>
            <span style="min-width:0"><span style="font-size:13px;color:var(--ink);cursor:pointer;font-weight:600" data-action="open-lead" data-id="${esc(l.id)}">${esc(D().fullName(l))}</span>
            <span class="cell-sub" style="display:block">Callback ${l.callbackAt < startOfToday.getTime() ? 'overdue' : 'today'}</span></span></div>`))
          .join('');
        cards.push(`<div class="card flush">
          <div class="list-head"><span class="t">Today from your leads</span></div>${rows}</div>`);
      }
    }

    // 2 · key dates ahead (birthdays, 14 days, whole book)
    if (H().isStarted()) {
      const bdays = H().upcomingBirthdays(14).slice(0, 6);
      if (bdays.length) {
        cards.push(`<div class="card flush">
          <div class="list-head"><span class="t">Key dates ahead</span> <span class="cell-sub">14 days</span></div>
          ${bdays.map(b => {
            return `<div class="list-row" style="gap:9px">
              <span style="flex:none">🎂</span>
              <span style="min-width:0;flex:1"><span style="font-size:13px;color:var(--ink);font-weight:600;cursor:pointer" data-action="ct-open" data-id="${esc(b.contact.id)}">${esc(H().contactName(b.contact))}</span>
              <span class="cell-sub" style="display:block">turns ${b.turning}</span></span>
              <span class="cell-sub" style="flex:none">${b.inDays === 0 ? 'today' : 'in ' + b.inDays + 'd'}</span></div>`;
          }).join('')}</div>`);
      }
    }

    // 3 · going quiet: open cases nobody has touched in 14 days
    if (SD().isStarted()) {
      const stale = SD().cases()
        .filter(c => (c.state === 'Opened' || c.state === 'Submitted') && !c.pendingClose
          && (isAdmin || c.agentUid === user.id))
        .map(c => ({ c, days: Math.floor((Date.now() - Date.parse(c.updatedAt || c.createdAt || 0)) / dayMs) }))
        .filter(x => x.days >= 14)
        .sort((a, b) => b.days - a.days).slice(0, 6);
      if (stale.length) {
        cards.push(`<div class="card flush">
          <div class="list-head"><span class="t">Going quiet</span> <span class="cell-sub">no touch in 14+ days</span></div>
          ${stale.map(x => `<div class="list-row" style="gap:9px">
            <span style="flex:none;width:7px;height:7px;background:var(--bad);border-radius:50%;margin-top:6px"></span>
            <span style="min-width:0;flex:1"><span style="font-size:13px;color:var(--ink);font-weight:600;cursor:pointer" data-action="cs-open" data-id="${esc(x.c.recordId)}">${esc(x.c.clientName || '(no name)')}</span>
            <span class="cell-sub" style="display:block">${esc(SC().productName(x.c.product))} · ${esc(RWG.pipelines.stageLabel(x.c.product, RWG.pipelines.stageForCase(x.c)))}</span></span>
            <span style="flex:none;font-size:11.5px;color:var(--bad);font-weight:700">${x.days}d</span></div>`).join('')}</div>`);
      }
    }

    return cards.join('');
  }

  // ── the screen ────────────────────────────────────────────
  function screenHtml(user, ctx) {
    const today = T().todayKey();
    const uid = user.id;
    const shown = base(uid);
    /* A workflow step chained behind another one is not work anybody can
       start — it is work that has not begun. Launching a life case put all
       seven steps on the list at once, four of them impossible, and a list
       where most rows cannot be actioned is a list people stop reading.
       They wait their turn off-screen and arrive when the step before them
       is ticked, with a real due date instead of the launch estimate.
       Asked of the WHOLE book, never of the filtered list: the step you
       are waiting on is usually somebody else's. */
    const held = (RWG.wf && RWG.wf.blockedIds) ? RWG.wf.blockedIds() : {};
    const heldN = shown.filter(t => held[t.id]).length;
    const list = st.chain ? shown : shown.filter(t => !held[t.id]);
    const gps = T().groupByDue(list.filter(t => t.status !== 'done'), today);
    const showAssignee = st.who !== 'me';
    const rail = railHtml(user, ctx.isAdmin);

    // Overdue, today, tomorrow, the rest of this week, next week, then
    // everything after that. The tone carries the deadline: red is late,
    // amber is today, and it cools off as the date moves away.
    const days = (far) => group('overdue', 'Overdue', gps.overdue, today, showAssignee, 'bad')
      + group('today', 'Today', gps.today, today, showAssignee, 'warn')
      + group('tomorrow', 'Tomorrow', gps.tomorrow, today, showAssignee, 'gold')
      + group('week', 'This week', gps.week, today, showAssignee, 'cool')
      + (far ? group('next', 'Next week', gps.next, today, showAssignee, 'cool')
        + group('later', 'Future', gps.later, today, showAssignee)
        + group('nodate', 'No date', gps.nodate, today, showAssignee) : '');

    let body = '';
    if (st.when === 'completed') {
      const done = list.slice().sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
      body = group('done', 'Completed', done, today, showAssignee);
    } else if (st.when === 'overdue') {
      body = group('overdue', 'Overdue', gps.overdue, today, showAssignee, 'bad');
    } else if (st.when === 'today') {
      body = group('today', 'Today', gps.today, today, showAssignee, 'warn');
    } else if (st.when === 'week') {
      body = days(false);
    } else {
      // upcoming (default) and everything
      body = days(true);
      if (st.when === 'all') {
        const done = list.filter(t => t.status === 'done').sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
        body += group('done', 'Completed', done, today, showAssignee);
      }
    }

    const narrowed = st.kind !== 'all' || st.cat || st.who !== 'me' || st.when !== 'upcoming';
    const empty = narrowed
      ? `<div class="empty" style="padding:44px 16px"><div class="ec">🔍</div>
           <h3>Nothing matches those filters</h3>
           <p>Widen the range, or <button class="btn btn-quiet btn-sm" data-action="tk-reset">reset the filters</button></p></div>`
      : `<div class="empty" style="padding:44px 16px"><div class="ec">☀️</div>
           <h3>Clear</h3><p>Nothing open. Add a task, or enjoy it while it lasts.</p></div>`;

    const doneWk = T().doneThisWeek().filter(t => st.who === 'all' || t.assigneeUid === (st.who === 'me' ? uid : st.who));

    // The filter bar reads as a sentence.
    const sel = (id, opts) => `<select id="${id}">${opts}</select>`;
    const whenOpts = WHEN.map(w => `<option value="${w.id}" ${st.when === w.id ? 'selected' : ''}>${esc(w.label)}</option>`).join('');
    const kindOpts = KINDS.map(k => `<option value="${k.id}" ${st.kind === k.id ? 'selected' : ''}>${esc(k.label)}</option>`).join('');
    const users = D().users().filter(u => u.status === 'active');
    const whoOpts = [`<option value="me" ${st.who === 'me' ? 'selected' : ''}>me</option>`,
      `<option value="all" ${st.who === 'all' ? 'selected' : ''}>anyone</option>`]
      .concat(users.filter(u => u.id !== uid).map(u =>
        `<option value="${esc(u.id)}" ${st.who === u.id ? 'selected' : ''}>${esc(u.name)}</option>`)).join('');
    const catOpts = [`<option value="" ${!st.cat ? 'selected' : ''}>all categories</option>`]
      .concat(T().categories().map(c =>
        `<option value="${esc(c)}" ${st.cat === c ? 'selected' : ''}>${esc(c)}</option>`)).join('');

    const count = st.when === 'completed' ? list.length
      : Object.keys(gps).reduce((n, k) => n + gps[k].length, 0);

    return `<div class="mw-grid">
      <div class="card flush">
        <div class="list-head">
          <span class="t">Tasks</span>
          <span class="s">${gps.overdue.length ? gps.overdue.length + ' overdue · ' : ''}${count} shown</span>
          <span class="topbar-spacer"></span>
          ${st.sel ? `
            <span class="cell-sub" style="font-weight:700">${Object.keys(st.sel).length} selected</span>
            <button class="btn btn-quiet btn-sm" data-action="tk-sel-all">All shown</button>
            <button class="btn btn-sm" style="background:rgba(178,58,72,.09);color:var(--bad);border:1px solid rgba(178,58,72,.35)"
              data-action="tk-del-sel" ${Object.keys(st.sel).length ? '' : 'disabled'}>Move to Trash</button>
            <button class="btn btn-quiet btn-sm" data-action="tk-sel-off">Cancel</button>`
          : `${canDelete() ? '<button class="btn btn-quiet btn-sm" data-action="tk-sel-on" title="Pick several tasks to move to the Trash at once">Select</button>' : ''}
            <button class="btn btn-gold btn-sm" data-action="tk-new">＋ Add task</button>`}
        </div>
        <div class="list-toolbar tb-inline">
          <span class="tb-word">Filtering by</span>
          ${sel('tk-f-when', whenOpts)}
          ${sel('tk-f-kind', kindOpts)}
          <span class="tb-word">assigned to</span>
          ${sel('tk-f-who', whoOpts)}
          <span class="tb-word">in category</span>
          ${sel('tk-f-cat', catOpts)}
          ${narrowed ? '<button class="btn btn-quiet btn-sm" data-action="tk-reset">Reset</button>' : ''}
          ${heldN ? `<button class="btn btn-quiet btn-sm" data-action="tk-chain"
            title="Workflow steps that cannot be started until the step before them is checked off">⛓ ${st.chain ? 'Hide' : 'Show'} ${heldN} waiting on ${heldN === 1 ? 'an earlier step' : 'earlier steps'}</button>` : ''}
        </div>
        ${body || empty}
        ${doneWk.length && st.when !== 'completed' ? `<div class="list-foot"><span class="cell-sub">✓ ${doneWk.length} done in the last 7 days</span></div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">${rail || '<div class="card"><p class="muted" style="font-size:13px;margin:0">Follow-ups, birthdays and stale cases will appear here as the book fills in.</p></div>'}</div>
    </div>`;
  }

  RWG.modules.register({
    id: 'mywork',
    title: 'Tasks',
    enabled: true,
    roles: ['admin', 'agent'],
    nav: [{
      view: 'mywork', label: 'Tasks', icon: 'today',
      badge: () => {
        // Lazy-starts the listener so the badge is live from first paint —
        // idempotent, and the callback is the usual repaint.
        const u = RWG.auth.currentUser();
        if (u && u.status === 'active' && RWG.tasks && !RWG.tasks.isStarted()) {
          RWG.tasks.init(u, RWG.app.renderMain);
          return 0;
        }
        const eff = RWG.app.effectiveUser ? RWG.app.effectiveUser() : u;
        return RWG.tasks && RWG.tasks.isStarted() && eff ? RWG.tasks.dueCount(eff.id) : 0;
      }
    }],
    meta: { mywork: { t: 'Tasks', s: 'Everything you owe, in one list' } },
    state: st,

    home: {
      tile: () => ({
        icon: 'today', title: 'Tasks',
        desc: 'Your tasks, callbacks, key dates and stale cases — the morning screen.',
        view: 'mywork'
      })
    },

    onEnter() {
      const me = RWG.auth.currentUser();
      if (!T().isStarted()) T().init(me, RWG.app.renderMain);
      if (!H().isStarted()) H().init(me, RWG.app.renderMain);
      if (!SD().isStarted()) SD().init(me, RWG.app.renderMain);
      RWG.pipelines.init();
    },

    onChange(e) {
      const map = { 'tk-f-when': 'when', 'tk-f-kind': 'kind', 'tk-f-who': 'who', 'tk-f-cat': 'cat' };
      const key = map[e.target.id];
      if (!key) return;
      st[key] = e.target.value;
      RWG.app.renderMain();
    },

    actions: {
      'tk-who': (el) => { st.who = el.dataset.who; RWG.app.renderMain(); },
      'tk-cat-pick': (el) => { st.cat = el.dataset.cat || ''; RWG.app.renderMain(); },
      'tk-reset': () => { st.who = 'me'; st.when = 'upcoming'; st.kind = 'all'; st.cat = ''; st.chain = false; RWG.app.renderMain(); },
      'tk-chain': () => { st.chain = !st.chain; RWG.app.renderMain(); },
      'tk-fold': (el) => {
        const k = el.dataset.key;
        if (folded[k]) delete folded[k]; else folded[k] = 1;
        saveFold();
        RWG.app.renderMain();
      },
      // A task started from a record is already about that record. The most
      // specific pointer wins: the opportunity you were looking at, then the
      // person, then the family — never the family when a person was named.
      'tk-new': (el) => {
        const d = (el && el.dataset) || {};
        const r = d.case ? U().pickResolve('case', d.case)
          : d.contact ? U().pickResolve('contact', d.contact)
          : d.hh ? U().pickResolve('household', d.hh) : null;
        const preset = {};
        if (r && r.type) {
          preset.relatedType = r.type; preset.relatedId = r.id; preset.relatedLabel = r.label;
          // An opportunity started from a person keeps that person, even when
          // the case itself has not been linked to one yet.
          preset.contactId = r.contactId || d.contact || null;
          preset.householdId = r.householdId || null;
        }
        taskModal(null, preset);
      },
      'tk-edit': (el) => { const t = T().task(el.dataset.id); if (t) taskModal(t); },
      // ── selection & deletion (partners; everything goes via the Trash) ──
      'tk-sel-on': () => { st.sel = {}; RWG.app.renderMain(); },
      'tk-sel-off': () => { st.sel = null; RWG.app.renderMain(); },
      'tk-sel': (el) => {
        if (!st.sel) return;
        if (st.sel[el.dataset.id]) delete st.sel[el.dataset.id];
        else st.sel[el.dataset.id] = 1;
        RWG.app.renderMain();
      },
      'tk-sel-all': () => {
        if (!st.sel) return;
        const eff = RWG.app.effectiveUser ? RWG.app.effectiveUser() : RWG.auth.currentUser();
        base(eff.id).forEach(t => { st.sel[t.id] = 1; });
        RWG.app.renderMain();
      },
      'tk-del-sel': () => {
        if (!st.sel) return;
        const ids = Object.keys(st.sel).filter(id => T().task(id));
        if (!ids.length) return;
        if (!confirm('Move ' + ids.length + (ids.length === 1 ? ' task' : ' tasks')
          + ' to the Trash? A partner can restore them from there.')) return;
        Promise.all(ids.map(id => T().removeTask(id)))
          .then(() => U().toast(ids.length + ' moved to the Trash', true))
          .catch(() => U().toast('Some did not delete — check the Trash for what made it'))
          .then(() => { st.sel = null; RWG.app.renderMain(); });
        st.sel = null;
        RWG.app.renderMain();   // the cache already moved; paint now, settle later
      },
      'tk-del': (el) => {
        const t = T().task(el.dataset.id); if (!t) return;
        if (!confirm('Move “' + (t.title || 'this task') + '” to the Trash?')) return;
        T().removeTask(el.dataset.id);
        closeTop();
        if (RWG.refreshOppSteps) RWG.refreshOppSteps();   // the window underneath follows
        RWG.app.renderMain();
        U().toast('Moved to the Trash — restorable from there', true);
      },
      'tk-save': (el) => {
        const title = g('tk-title').trim();
        if (!title) { U().toast('What needs doing?'); return; }
        if (!U().pickerSettle('tk-rel')) return;   // a typed-but-unchosen name is not an answer
        const uid = g('tk-assignee');
        const u = D().user(uid) || RWG.auth.currentUser();
        // The select says what this is about; everything else is derived.
        // A lead pointer has no entry in the list (leads are worked in their
        // own screen), so an untouched select must not silently detach one.
        const t0 = el.dataset.id ? T().task(el.dataset.id) : null;
        const picked = U().pickerValue('tk-rel');
        const keepLead = t0 && t0.relatedType === 'lead' && !picked.type;
        const r = keepLead
          ? { type: 'lead', id: t0.relatedId, label: t0.relatedLabel || '',
              contactId: t0.contactId || null, householdId: t0.householdId || null }
          : U().pickResolve(picked.type, picked.id);
        const fields = {
          title: title, note: U().noteRead('tk-note'),
          assigneeUid: uid || u.id, assigneeName: u.name || '',
          dueDate: g('tk-due') || T().todayKey(),
          category: g('tk-cat'), priority: g('tk-pri') || 'none', repeat: g('tk-rep') || 'none',
          relatedType: r.type, relatedId: r.id, relatedLabel: r.label,
          // Who it is for. An opportunity not yet linked to a person keeps
          // whoever the task already knew — the person you opened it from —
          // rather than losing them. Re-pointing at a household clears it,
          // because a household task is nobody's in particular.
          contactId: r.contactId
            || (r.type === 'case' ? (g('tk-relcontact') || (t0 && t0.contactId) || null) : null),
          householdId: r.householdId || null
        };
        if (el.dataset.id) T().saveTask(Object.assign({ id: el.dataset.id }, fields));
        else T().addTask(fields);
        closeTop();
        if (RWG.refreshOppSteps) RWG.refreshOppSteps();   // the window underneath follows
        RWG.app.renderMain();
        U().toast(el.dataset.id ? 'Saved' : 'Task added — it is on ' + (fields.assigneeName || 'their') + "'s list", true);
      },
      /* The person this task is about, beside the window instead of
         instead of it. Read from the picker at CLICK time, not at render
         time, so it follows whatever is in the box right now — including
         a record chosen a second ago on a task that has never been saved. */
      'tk-view-ctc': () => {
        const v = U().pickerValue ? U().pickerValue('tk-rel') : null;
        if (!v || !v.id) { U().toast('Pick who this is for first'); return; }
        if (RWG.contactPanel) RWG.contactPanel(v.type, v.id);
      },
      'tk-done': (el) => {
        const t = T().task(el.dataset.id);
        // A chained step stays shut until the one it waits for is done —
        // no CMI without a signed application. Un-ticking is always free.
        if (t && t.status !== 'done' && RWG.wf && RWG.wf.waitingOn) {
          const b = RWG.wf.waitingOn(t);
          if (b) { U().toast('First: ' + (b.title || 'the step before it')); RWG.app.renderMain(); return; }
        }
        const willRepeat = !!(t && t.repeat && t.repeat !== 'none' && t.status !== 'done' && !t.spawnedNext);
        const p = T().toggleDone(el.dataset.id);
        RWG.app.renderMain();   // the cache already moved; paint now, confirm later
        if (willRepeat && p && p.then) p.then(next => {
          if (next) U().toast('Done — the next one is set for ' + U().fmtDate(Date.parse(next.dueDate + 'T12:00:00')), true);
        });
      }
    },

    render(view, user, ctx) {
      if (!T().isStarted()) return `<div class="empty" style="padding:60px"><div class="ec">⏳</div><h3>Loading…</h3></div>`;
      return screenHtml(user, ctx);
    }
  });
})();
