/* ============================================================
   RWG Platform — Workflow launch modal (phase 4)

   A module with no screen of its own: it registers only actions,
   which the kernel dispatches globally, so the ▶ Workflow button
   works from any view that renders it (households today, cases
   later). Triggered templates usually start themselves from the
   board; this modal is for the manual ones (FRS Rollover, Annual
   Review) and for starting anything by hand with the step owners
   chosen in the moment — Carlos assigns steps, so every row shows
   an assignee select pre-filled with the role default.

   The selects repaint the step list through direct listeners, the
   same pattern as the opportunity modal: kernel onChange only
   reaches the module owning the current view, and this modal opens
   over someone else's.
   ============================================================ */
window.RWG = window.RWG || {};

(function () {
  const W = () => RWG.wf;
  const T = () => RWG.tasks;
  const H = () => RWG.hh;
  const SD = () => RWG.scorecardData;
  const SC = () => RWG.scorecard;
  const D = () => RWG.data;
  const U = () => RWG.ui;
  const esc = (s) => U().esc(s);

  const mount = () => document.getElementById('modal-mount');
  const val = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };

  function openCasesOf(hhId) {
    if (!SD().isStarted()) return [];
    return SD().cases().filter(c => c.householdId === hhId
      && (c.state === 'Opened' || c.state === 'Submitted') && !c.closedAt);
  }

  // The step preview: one row per step, assignee select pre-filled by role.
  function stepsHtml(tpl, c, startKey) {
    const users = D().users().filter(u => u.status === 'active');
    const dayMs = 86400000;
    const dueOf = (s) => T().todayKey(Date.parse(startKey + 'T12:00:00') + (s.dueDays || 0) * dayMs);
    // A case-manager role that cannot resolve used to default the select to
    // the advisor with no sign anything went wrong — which is how a whole
    // checklist lands on one person. Say it out loud instead.
    let warned = false;
    const warn = tpl.steps.some(s => W().resolveOwner(s.owner, c).fellBack)
      ? `<p class="hint" style="color:var(--bad);font-weight:600">The case-manager role could not be resolved,
          so those steps defaulted to the advisor. Pin the case manager in Settings → Workflows,
          or re-point the steps below by hand.</p>` : '';
    return warn + tpl.steps.map((s, i) => {
      const dflt = W().resolveOwner(s.owner, c);
      // If the resolved person is not on this session's roster, name them
      // anyway — never let the browser quietly select the first option.
      const onRoster = users.some(u => u.id === dflt.uid);
      const opts = (!onRoster && dflt.uid
          ? `<option value="${esc(dflt.uid)}" selected>${esc(dflt.name || 'Case manager')}</option>` : '')
        + users.map(u =>
        `<option value="${esc(u.id)}" ${u.id === dflt.uid ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
      return `<div class="flex" style="gap:10px;padding:9px 2px;border-bottom:1px solid rgba(14,36,64,.06);align-items:center">
        <span class="cell-sub" style="flex:none;width:18px;text-align:right">${i + 1}</span>
        <span style="min-width:0;flex:1;font-size:13px;color:var(--ink)">${esc(s.title)}
          ${s.required ? '<span class="chip tier-medium" style="font-size:10px;margin-left:5px" title="Blocks the push to Won until done">required</span>' : ''}</span>
        <select id="wf-as-${i}" style="flex:none;width:130px;font-size:12.5px;padding:4px 6px">${opts || `<option value="">—</option>`}</select>
        <span class="cell-sub" style="flex:none;width:78px;text-align:right">${esc(dueOf(s))}</span>
      </div>`;
    }).join('');
  }

  function paint(hhId) {
    const tpl = W().template(val('wf-tpl')); if (!tpl) return;
    const c = val('wf-case') ? SD().caseById(val('wf-case')) : null;
    const start = val('wf-start') || T().todayKey();
    const box = document.getElementById('wf-steps');
    if (box) box.innerHTML = stepsHtml(tpl, c, start);
    const hint = document.getElementById('wf-hint');
    if (hint) {
      const ran = W().hasRun(tpl.id, tpl.related === 'household' ? 'hh:' + hhId : (c ? 'case:' + c.recordId : null));
      hint.textContent = (tpl.desc || '') + (ran ? ' · Already ran for this — launching again makes a second checklist.' : '');
    }
    // A case-based template needs a case to hang its steps on.
    const caseWrap = document.getElementById('wf-case-wrap');
    if (caseWrap) caseWrap.style.display = tpl.related === 'household' ? 'none' : '';
  }

  function launchModal(hhId) {
    const h = H().household(hhId); if (!h) return;
    const me = RWG.auth.currentUser();
    if (T() && !T().isStarted()) T().init(me, RWG.app.renderMain);
    const tpls = W().templates();
    const tplOpts = tpls.map((t, i) =>
      `<option value="${esc(t.id)}" ${i === 0 ? 'selected' : ''}>${esc(t.name)}${t.trigger ? '' : ' (manual)'}</option>`).join('');
    const cases = openCasesOf(hhId);
    const caseOpts = cases.map(c =>
      `<option value="${esc(c.recordId)}">${esc(c.clientName || '(no name)')} · ${esc(SC().productName(c.product))}</option>`).join('');
    mount().innerHTML = `
      <div class="scrim" data-action="close-modal"></div>
      <div class="modal-card" style="max-width:640px">
        <div class="modal-head"><h2>Start a workflow</h2>
          <p>On ${esc(h.name)}. Every step becomes a task on someone's Tasks list — reassign any of them below before launching.</p></div>
        <div class="modal-body">
          <div class="field-row">
            <div class="field-group"><label class="lbl">Workflow</label>
              <select id="wf-tpl">${tplOpts}</select></div>
            <div class="field-group"><label class="lbl">Start</label>
              <input id="wf-start" type="date" value="${esc(T().todayKey())}"></div>
          </div>
          <div class="field-group" id="wf-case-wrap"><label class="lbl">For which opportunity</label>
            <select id="wf-case">${caseOpts || '<option value="">— no open opportunities —</option>'}</select></div>
          <p class="hint" id="wf-hint"></p>
          <div id="wf-steps" style="max-height:290px;overflow-y:auto"></div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" data-action="close-modal">Cancel</button>
          <button class="btn btn-gold" data-action="wf-launch-save" data-hh="${esc(hhId)}">Launch ▶</button>
        </div>
      </div>`;
    // Direct wiring — this modal opens over other modules' views.
    ['wf-tpl', 'wf-case', 'wf-start'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => paint(hhId));
    });
    paint(hhId);
  }

  RWG.modules.register({
    id: 'workflows',
    title: 'Workflows',
    enabled: true,
    roles: ['admin', 'agent'],
    nav: [],

    actions: {
      'wf-launch': (el) => launchModal(el.dataset.hh),
      'wf-launch-save': (el) => {
        const tpl = W().template(val('wf-tpl')); if (!tpl) return;
        const c = val('wf-case') ? SD().caseById(val('wf-case')) : null;
        if (tpl.related !== 'household' && !c) { U().toast('This workflow runs on an opportunity — open one first'); return; }
        const assignees = {};
        tpl.steps.forEach((s, i) => {
          const sel = document.getElementById('wf-as-' + i);
          if (sel && sel.value) {
            const u = D().user(sel.value);
            assignees[s.id] = { uid: sel.value, name: (u && u.name) || '' };
          }
        });
        const r = W().launch(tpl.id, {
          caseRecord: c, householdId: el.dataset.hh,
          assignees: assignees, start: val('wf-start') || undefined
        });
        mount().innerHTML = '';
        RWG.app.renderMain();
        if (r) U().toast(r.name + ' started — ' + r.count + ' steps are on Tasks', true);
      }
    },

    render() { return ''; }
  });
})();
