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
  const st = { who: 'me', when: 'upcoming', kind: 'all', cat: '' };

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
  const mount = () => document.getElementById('modal-mount');
  const g = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };

  function taskModal(t, preset) {
    preset = preset || {};
    const v = (k, dflt) => t && t[k] != null ? t[k] : (preset[k] != null ? preset[k] : dflt);
    const me = RWG.auth.currentUser();
    const users = D().users().filter(u => u.status === 'active');
    const list = users.length ? users : [me];
    const selUid = v('assigneeUid', me.id);
    const assigneeOpts = list.map(u => `<option value="${esc(u.id)}" ${u.id === selUid ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
    const hhSel = v('relatedType', null) === 'household' ? v('relatedId', '') : '';
    const hhOpts = H().isStarted()
      ? H().households().slice().sort((a, b) => a.name.localeCompare(b.name))
          .map(h => `<option value="${esc(h.id)}" ${h.id === hhSel ? 'selected' : ''}>${esc(h.name)}</option>`).join('')
      : '';
    const selCat = v('category', '');
    const catOpts = ['<option value="">— none —</option>'].concat(
      T().categories().map(c => `<option value="${esc(c)}" ${c === selCat ? 'selected' : ''}>${esc(c)}</option>`)).join('');
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
          ${hhOpts ? `<div class="field-group"><label class="lbl">Household <span class="pill-soft" style="font-size:10.5px">optional</span></label>
            <select id="tk-hh"><option value="">— none —</option>${hhOpts}</select></div>` : ''}
          <div class="field-group"><label class="lbl">Note <span class="pill-soft" style="font-size:10.5px">optional</span></label>
            <input id="tk-note" value="${esc(v('note', ''))}"></div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" data-action="close-modal">Cancel</button>
          <button class="btn btn-gold" data-action="tk-save" ${t ? `data-id="${esc(t.id)}"` : ''}>${t ? 'Save' : 'Add task'}</button>
        </div>
      </div>`;
    const inp = document.getElementById('tk-title'); if (inp && !t) inp.focus();
  }

  // ── what a task is, for the type filter ───────────────────
  function kindOf(t) {
    if (t.kind === 'service') return 'service';
    if (t.workflowId) return 'workflow';
    return 'task';
  }

  // ── task rows ─────────────────────────────────────────────
  function relatedChip(t) {
    if (!t.relatedId) return '';
    const act = { household: 'hh-goto', case: 'cs-open', lead: 'open-lead' }[t.relatedType];
    if (!act) return '';
    return `<button class="chip" style="cursor:pointer;background:rgba(14,36,64,.05);color:var(--navy);border:1px solid var(--line);font-weight:600"
      data-action="${act}" data-id="${esc(t.relatedId)}">${t.relatedType === 'household' ? '🏠 ' : ''}${esc(t.relatedLabel || t.relatedType)}</button>`;
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
    return `<div class="list-row">
      <input type="checkbox" data-action="tk-done" data-id="${esc(t.id)}" ${t.status === 'done' ? 'checked' : ''}
        style="margin-top:3px">
      <div class="grow">
        <div style="font-size:13.5px;color:var(--ink);${t.status === 'done' ? 'text-decoration:line-through;opacity:.55' : ''}">
          <span data-action="tk-edit" data-id="${esc(t.id)}" style="cursor:pointer">${esc(t.title)}</span></div>
        <div class="flex" style="gap:6px;margin-top:4px;flex-wrap:wrap;align-items:center">
          ${relatedChip(t)}
          ${t.category ? `<button class="tag-chip" data-action="tk-cat-pick" data-cat="${esc(t.category)}">${esc(t.category)}</button>` : ''}
          ${t.workflowName ? `<span class="chip tier-gold" style="font-size:10.5px" title="Step ${(t.workflowStep || 0) + 1} of the ${esc(t.workflowName)} workflow">⚙ ${esc(t.workflowName)}</span>` : ''}
          ${t.kind === 'service' ? `<span class="chip" style="font-size:10.5px;background:rgba(62,92,130,.10);color:#3E5C82;border:1px solid rgba(62,92,130,.35)">🛠 ${esc(t.serviceType || 'Service')}</span>` : ''}
          ${t.kind === 'service' && t.waiting && t.status !== 'done' ? '<span class="chip tier-medium" style="font-size:10.5px">⏸ waiting</span>' : ''}
          ${t.required ? '<span class="chip tier-medium" style="font-size:10.5px" title="A required step — the case cannot be pushed to Won until this is done">required</span>' : ''}
          ${t.repeat && t.repeat !== 'none' ? '<span class="cell-sub" style="font-size:11px" title="Repeats">↻</span>' : ''}
          ${priorityFlag(t)}
          ${showAssignee ? `<span class="pill-soft" style="font-size:11px">${esc((t.assigneeName || '').split(' ')[0])}</span>` : ''}
          ${t.note ? `<span class="cell-sub" style="font-size:11.5px">${esc(t.note)}</span>` : ''}
        </div>
      </div>
      <div class="end" style="padding-top:3px">${dueLabel(t, today)}</div>
    </div>`;
  }
  function group(label, list, today, showAssignee, tone) {
    if (!list.length) return '';
    return `<div class="list-group${tone === 'bad' ? ' bad' : ''}">
        ${label} <span style="opacity:.7">· ${list.length}</span></div>
      ${list.map(t => taskRow(t, today, showAssignee)).join('')}`;
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
      const mine = (l) => isAdmin || l.assignedTo === user.id;
      const calls = D().leadsRaw().filter(l => mine(l) && l.callbackAt && l.callbackAt <= endOfToday.getTime());
      const appts = D().leadsRaw().filter(l => mine(l) && l.apptDate && l.apptDate >= startOfToday.getTime() && l.apptDate <= endOfToday.getTime());
      if (calls.length || appts.length) {
        const rows = appts.map(l => `<div class="list-row" style="gap:9px">
            <span style="flex:none">📅</span>
            <span style="min-width:0"><span style="font-size:13px;color:var(--ink);cursor:pointer;font-weight:600" data-action="open-lead" data-id="${esc(l.id)}">${esc(D().fullName(l))}</span>
            <span class="cell-sub" style="display:block">Appointment ${new Date(l.apptDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span></span></div>`)
          .concat(calls.map(l => `<div class="list-row" style="gap:9px">
            <span style="flex:none">📞</span>
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
            const hh = H().household(b.contact.householdId);
            return `<div class="list-row" style="gap:9px">
              <span style="flex:none">🎂</span>
              <span style="min-width:0;flex:1"><span style="font-size:13px;color:var(--ink);font-weight:600;${hh ? 'cursor:pointer' : ''}" ${hh ? `data-action="hh-goto" data-id="${esc(hh.id)}"` : ''}>${esc(H().contactName(b.contact))}</span>
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
    const list = base(uid);
    const gps = T().groupByDue(list.filter(t => t.status !== 'done'), today);
    const showAssignee = st.who !== 'me';
    const rail = railHtml(user, ctx.isAdmin);

    let body = '';
    if (st.when === 'completed') {
      const done = list.slice().sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
      body = group('Completed', done, today, showAssignee);
    } else if (st.when === 'overdue') {
      body = group('Overdue', gps.overdue, today, showAssignee, 'bad');
    } else if (st.when === 'today') {
      body = group('Due today', gps.today, today, showAssignee);
    } else if (st.when === 'week') {
      body = group('Overdue', gps.overdue, today, showAssignee, 'bad')
        + group('Due today', gps.today, today, showAssignee)
        + group('This week', gps.week, today, showAssignee);
    } else {
      // upcoming (default) and everything
      body = group('Overdue', gps.overdue, today, showAssignee, 'bad')
        + group('Due today', gps.today, today, showAssignee)
        + group('This week', gps.week, today, showAssignee)
        + group('Later', gps.later.concat(gps.nodate), today, showAssignee);
      if (st.when === 'all') {
        const done = list.filter(t => t.status === 'done').sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
        body += group('Completed', done, today, showAssignee);
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

    const count = st.when === 'completed' ? list.length : (gps.overdue.length + gps.today.length + gps.week.length + gps.later.length + gps.nodate.length);

    return `<div class="mw-grid">
      <div class="card flush">
        <div class="list-head">
          <span class="t" style="font-size:17px">Tasks</span>
          <span class="s">${gps.overdue.length ? gps.overdue.length + ' overdue · ' : ''}${count} shown</span>
          <span class="topbar-spacer"></span>
          <button class="btn btn-gold btn-sm" data-action="tk-new">＋ Add task</button>
        </div>
        <div class="list-toolbar">
          <span class="tb-word">Filtering by</span>
          ${sel('tk-f-when', whenOpts)}
          ${sel('tk-f-kind', kindOpts)}
          <span class="tb-word">assigned to</span>
          ${sel('tk-f-who', whoOpts)}
          <span class="tb-word">in category</span>
          ${sel('tk-f-cat', catOpts)}
          ${narrowed ? '<button class="btn btn-quiet btn-sm" data-action="tk-reset">Reset</button>' : ''}
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
      'tk-reset': () => { st.who = 'me'; st.when = 'upcoming'; st.kind = 'all'; st.cat = ''; RWG.app.renderMain(); },
      'tk-new': (el) => {
        // From a household header the button carries the relation along.
        const preset = {};
        if (el.dataset.hh) {
          const h = H().household(el.dataset.hh);
          if (h) { preset.relatedType = 'household'; preset.relatedId = h.id; preset.relatedLabel = h.name; }
        }
        taskModal(null, preset);
      },
      'tk-edit': (el) => { const t = T().task(el.dataset.id); if (t) taskModal(t); },
      'tk-save': (el) => {
        const title = g('tk-title').trim();
        if (!title) { U().toast('What needs doing?'); return; }
        const uid = g('tk-assignee');
        const u = D().user(uid) || RWG.auth.currentUser();
        const hhId = g('tk-hh');
        const hh = hhId ? H().household(hhId) : null;
        // A task pointing at a case or lead (workflow steps do) keeps its
        // pointer through an edit — the household select can't express it,
        // so blank there must not mean "detach". Picking a household re-points.
        const t0 = el.dataset.id ? T().task(el.dataset.id) : null;
        const keepRel = t0 && t0.relatedType && t0.relatedType !== 'household' && !hh;
        const fields = {
          title: title, note: g('tk-note').trim(),
          assigneeUid: uid || u.id, assigneeName: u.name || '',
          dueDate: g('tk-due') || T().todayKey(),
          category: g('tk-cat'), priority: g('tk-pri') || 'none', repeat: g('tk-rep') || 'none',
          relatedType: keepRel ? t0.relatedType : (hh ? 'household' : null),
          relatedId: keepRel ? t0.relatedId : (hh ? hh.id : null),
          relatedLabel: keepRel ? t0.relatedLabel : (hh ? hh.name : '')
        };
        if (el.dataset.id) T().saveTask(Object.assign({ id: el.dataset.id }, fields));
        else T().addTask(fields);
        mount().innerHTML = '';
        RWG.app.renderMain();
        U().toast(el.dataset.id ? 'Saved' : 'Task added — it is on ' + (fields.assigneeName || 'their') + "'s list", true);
      },
      'tk-done': (el) => {
        const t = T().task(el.dataset.id);
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
