/* ============================================================
   RWG Platform — My Work (phase 3)

   The screen everyone opens first. One list, everything you owe,
   grouped by WHEN — not by which record produced it. A task, a
   lead callback and a stale case all land here, because at 8am the
   question is what to do next, not which system it came from.

   Left: tasks (overdue / today / this week / later), checkbox to
   done, chips linking back to the household, case or lead.
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

  const st = { who: 'me' };   // me | all — everything is visible either way

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
    mount().innerHTML = `
      <div class="scrim" data-action="close-modal"></div>
      <div class="modal-card">
        <div class="modal-head"><h2>${t ? 'Edit task' : 'New task'}</h2>
          ${t ? '' : '<p>Assign it to anyone — it lands on their My Work.</p>'}</div>
        <div class="modal-body">
          <div class="field-group"><label class="lbl">What needs doing</label>
            <input id="tk-title" value="${esc(v('title', ''))}" placeholder="e.g. Chase the APS from Dr. Reyes' office"></div>
          <div class="field-row">
            <div class="field-group"><label class="lbl">Assigned to</label>
              <select id="tk-assignee">${assigneeOpts}</select></div>
            <div class="field-group"><label class="lbl">Due</label>
              <input id="tk-due" type="date" value="${esc(v('dueDate', T().todayKey()))}"></div>
          </div>
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

  // ── task rows ─────────────────────────────────────────────
  function relatedChip(t) {
    if (!t.relatedId) return '';
    const act = { household: 'hh-goto', case: 'cs-open', lead: 'open-lead' }[t.relatedType];
    if (!act) return '';
    return `<button class="chip" style="cursor:pointer;background:rgba(14,36,64,.05);color:var(--navy);border:1px solid var(--line);font-weight:600"
      data-action="${act}" data-id="${esc(t.relatedId)}">${t.relatedType === 'household' ? '🏠 ' : ''}${esc(t.relatedLabel || t.relatedType)}</button>`;
  }
  function dueLabel(t, today) {
    if (!t.dueDate) return '<span class="cell-sub">no date</span>';
    if (t.dueDate < today) {
      const days = Math.round((Date.parse(today) - Date.parse(t.dueDate)) / dayMs);
      return `<span style="color:var(--bad);font-weight:700;font-size:12px">${days} day${days === 1 ? '' : 's'} late</span>`;
    }
    if (t.dueDate === today) return '<span style="color:var(--warn);font-weight:700;font-size:12px">Today</span>';
    return `<span class="cell-sub">${U().fmtDate(Date.parse(t.dueDate + 'T12:00:00'))}</span>`;
  }
  function taskRow(t, today, showAssignee) {
    return `<div class="flex" style="align-items:flex-start;gap:11px;padding:10px 16px;border-bottom:1px solid rgba(14,36,64,.06)">
      <input type="checkbox" data-action="tk-done" data-id="${esc(t.id)}" ${t.status === 'done' ? 'checked' : ''}
        style="width:16px;height:16px;margin-top:3px;flex:none;cursor:pointer;accent-color:var(--gold)">
      <div style="min-width:0;flex:1">
        <div style="font-size:13.5px;color:var(--ink);${t.status === 'done' ? 'text-decoration:line-through;opacity:.55' : ''}">
          <span data-action="tk-edit" data-id="${esc(t.id)}" style="cursor:pointer">${esc(t.title)}</span></div>
        <div class="flex" style="gap:6px;margin-top:4px;flex-wrap:wrap;align-items:center">
          ${relatedChip(t)}
          ${t.workflowName ? `<span class="chip tier-gold" style="font-size:10.5px" title="Step ${(t.workflowStep || 0) + 1} of the ${esc(t.workflowName)} workflow">⚙ ${esc(t.workflowName)}</span>` : ''}
          ${t.required ? '<span class="chip tier-medium" style="font-size:10.5px" title="A required step — the case cannot be pushed to Won until this is done">required</span>' : ''}
          ${showAssignee ? `<span class="pill-soft" style="font-size:11px">${esc((t.assigneeName || '').split(' ')[0])}</span>` : ''}
          ${t.note ? `<span class="cell-sub" style="font-size:11.5px">${esc(t.note)}</span>` : ''}
        </div>
      </div>
      <div style="flex:none;padding-top:3px">${dueLabel(t, today)}</div>
    </div>`;
  }
  function group(label, list, today, showAssignee, tone) {
    if (!list.length) return '';
    return `<div style="padding:9px 16px;background:${tone === 'bad' ? 'rgba(178,58,72,.07)' : 'var(--field)'};border-bottom:1px solid var(--line);font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;font-weight:700;color:${tone === 'bad' ? 'var(--bad)' : 'var(--muted)'}">
        ${label} <span style="opacity:.7">· ${list.length}</span></div>
      ${list.map(t => taskRow(t, today, showAssignee)).join('')}`;
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
        const rows = appts.map(l => `<div class="flex" style="gap:9px;padding:9px 14px;border-bottom:1px solid rgba(14,36,64,.06);align-items:flex-start">
            <span style="flex:none">📅</span>
            <span style="min-width:0"><span style="font-size:13px;color:var(--ink);cursor:pointer;font-weight:600" data-action="open-lead" data-id="${esc(l.id)}">${esc(D().fullName(l))}</span>
            <span class="cell-sub" style="display:block">Appointment ${new Date(l.apptDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span></span></div>`)
          .concat(calls.map(l => `<div class="flex" style="gap:9px;padding:9px 14px;border-bottom:1px solid rgba(14,36,64,.06);align-items:flex-start">
            <span style="flex:none">📞</span>
            <span style="min-width:0"><span style="font-size:13px;color:var(--ink);cursor:pointer;font-weight:600" data-action="open-lead" data-id="${esc(l.id)}">${esc(D().fullName(l))}</span>
            <span class="cell-sub" style="display:block">Callback ${l.callbackAt < startOfToday.getTime() ? 'overdue' : 'today'}</span></span></div>`))
          .join('');
        cards.push(`<div class="card" style="padding:0;overflow:hidden">
          <div style="padding:13px 16px;border-bottom:1px solid var(--line)"><b style="font-size:13px;color:var(--navy)">Today from your leads</b></div>${rows}</div>`);
      }
    }

    // 2 · key dates ahead (birthdays, 14 days, whole book)
    if (H().isStarted()) {
      const bdays = H().upcomingBirthdays(14).slice(0, 6);
      if (bdays.length) {
        cards.push(`<div class="card" style="padding:0;overflow:hidden">
          <div style="padding:13px 16px;border-bottom:1px solid var(--line)"><b style="font-size:13px;color:var(--navy)">Key dates ahead</b> <span class="cell-sub">14 days</span></div>
          ${bdays.map(b => {
            const hh = H().household(b.contact.householdId);
            return `<div class="flex" style="gap:9px;padding:9px 14px;border-bottom:1px solid rgba(14,36,64,.06);align-items:flex-start">
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
        cards.push(`<div class="card" style="padding:0;overflow:hidden">
          <div style="padding:13px 16px;border-bottom:1px solid var(--line)"><b style="font-size:13px;color:var(--navy)">Going quiet</b> <span class="cell-sub">no touch in 14+ days</span></div>
          ${stale.map(x => `<div class="flex" style="gap:9px;padding:9px 14px;border-bottom:1px solid rgba(14,36,64,.06);align-items:flex-start">
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
    const source = st.who === 'me' ? T().openFor(uid) : T().open();
    const gps = T().groupByDue(source, today);
    const doneWk = T().doneThisWeek().filter(t => st.who === 'all' || t.assigneeUid === uid);
    const showAssignee = st.who === 'all';
    const rail = railHtml(user, ctx.isAdmin);

    const body =
      group('Overdue', gps.overdue, today, showAssignee, 'bad')
      + group('Due today', gps.today, today, showAssignee)
      + group('This week', gps.week, today, showAssignee)
      + group('Later', gps.later.concat(gps.nodate), today, showAssignee);

    const empty = `<div class="empty" style="padding:44px 16px"><div class="ec">☀️</div>
      <h3>Clear${st.who === 'me' ? '' : ' across the team'}</h3><p>Nothing open. Add a task, or enjoy it while it lasts.</p></div>`;

    return `<div style="display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:18px;align-items:start" class="mw-grid">
      <div class="card" style="padding:0;overflow:hidden">
        <div class="card-head" style="padding:16px 16px 12px;margin:0;border-bottom:1px solid var(--line)">
          <h3>My Work</h3>
          <span class="sub">${gps.overdue.length ? gps.overdue.length + ' overdue · ' : ''}${gps.today.length} due today</span>
          <span class="topbar-spacer"></span>
          <div class="flex" style="gap:6px">
            <button class="btn btn-sm ${st.who === 'me' ? 'btn-navy' : 'btn-ghost'}" data-action="tk-who" data-who="me">Mine</button>
            <button class="btn btn-sm ${st.who === 'all' ? 'btn-navy' : 'btn-ghost'}" data-action="tk-who" data-who="all">Everyone</button>
            <button class="btn btn-gold btn-sm" data-action="tk-new">＋ Task</button>
          </div>
        </div>
        ${body || empty}
        ${doneWk.length ? `<div style="padding:11px 16px;border-top:1px solid var(--line)"><span class="cell-sub">✓ ${doneWk.length} done in the last 7 days</span></div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">${rail || '<div class="card"><p class="muted" style="font-size:13px;margin:0">Follow-ups, birthdays and stale cases will appear here as the book fills in.</p></div>'}</div>
    </div>`;
  }

  RWG.modules.register({
    id: 'mywork',
    title: 'My Work',
    enabled: true,
    roles: ['admin', 'agent'],
    nav: [{
      view: 'mywork', label: 'My Work', icon: 'today',
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
    meta: { mywork: { t: 'My Work', s: 'Everything you owe, in one list' } },
    state: st,

    home: {
      tile: () => ({
        icon: 'today', title: 'My Work',
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

    actions: {
      'tk-who': (el) => { st.who = el.dataset.who; RWG.app.renderMain(); },
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
      'tk-done': (el) => { T().toggleDone(el.dataset.id); RWG.app.renderMain(); }
    },

    render(view, user, ctx) {
      if (!T().isStarted()) return `<div class="empty" style="padding:60px"><div class="ec">⏳</div><h3>Loading…</h3></div>`;
      return screenHtml(user, ctx);
    }
  });
})();
