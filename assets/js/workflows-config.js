/* ============================================================
   RWG Platform — Workflows (phase 4)

   A workflow is a recipe: when a case reaches a certain point, a
   known list of steps must happen, each owned by someone, each
   with a due date. The recipe lives here as data — the settings
   editor will change it without a build, exactly like pipelines —
   and every launched step is an ORDINARY TASK in the tasks
   collection, with a few extra fields naming the workflow it
   belongs to. No new schema, no new rules: My Work, the household
   cards and the badge all already know how to show a task.

   The extra fields a workflow stamps on its tasks:
     workflowId        one launch = one id; groups steps into a checklist
     workflowTemplate  which recipe (template id)
     workflowName      denormalised for display
     workflowKey       what it ran FOR ('case:x' / 'hh:y') — the
                       dedupe that stops a trigger firing twice
     workflowStep      position in the recipe, for ordering
     required + gate   a required step with gate 'Closed' blocks the
                       push to Won until it is done (a partner's
                       confirm in the close review is never blocked
                       — their judgment outranks the checklist)

   Step owners are ROLES resolved at launch, not names baked in:
     advisor      → the agent on the case
     casemanager  → Kathy (matched by name until config pins a uid)
   Every task stays reassignable afterwards — the role is only the
   sensible default, Carlos re-points steps whenever he wants.

   Triggers: a template may declare the bucket that starts it
   (Submitted = written, fired from the pipeline board; Closed =
   confirmed by a partner, fired from the close review). Templates
   without a trigger — FRS Rollover, Annual Review — launch only by
   hand from the household's ▶ Workflow button.
   ============================================================ */
window.RWG = window.RWG || {};

RWG.wf = (function () {
  const T = () => RWG.tasks;
  const P = () => RWG.pipelines;
  const dayMs = 86400000;

  const DEFAULTS = {
    version: 1,
    // Kathy Martinez runs case management. Matched against the active user
    // list by name until the settings editor pins caseManagerUid.
    caseManagerName: 'Kathy',
    caseManagerUid: null,
    templates: [
      {
        id: 'life-new', name: 'New Life Policy',
        desc: 'Underwriting to delivery — also covers DI and LTC.',
        trigger: { bucket: 'Submitted', products: ['wl', 'term', 'di', 'ltc'] },
        related: 'case',
        steps: [
          // `after` chains a step to another: it cannot be checked off
          // until the step it waits for is done — and its dueDays count
          // from the moment that step IS done, not from launch. Signed
          // application ticked today, medical due tomorrow — whether the
          // signature took two days or two weeks.
          { id: 'carrier',   title: 'Enter the application in the carrier portal — confirm in good order', owner: 'casemanager', dueDays: 1,  stage: 'application' },
          { id: 'medical',   title: 'Order and schedule the medical exam',                                  owner: 'casemanager', dueDays: 1,  after: 'carrier', stage: 'sched-medical' },
          { id: 'chase-uw',  title: 'Chase underwriting requirements (APS, labs) — check weekly',           owner: 'casemanager', dueDays: 10, stage: 'medical-uw' },
          { id: 'offer',     title: 'Review the offer / rating with the client',                            owner: 'advisor',     dueDays: 21, stage: 'approval' },
          { id: 'closing',   title: 'Book the closing presentation',                                        owner: 'advisor',     dueDays: 3,  after: 'chase-uw', stage: 'closing-pres' },
          // Premium and signature are two different clocks. The premium is
          // what pays us and is the door to Delivery Requirements; it gates
          // the close and follows the closing meeting. The signature chase
          // lives in Policy Delivery, which fires when a partner confirms.
          { id: 'premium',   title: 'Collect the initial premium — we are not paid until it is in',          owner: 'casemanager', dueDays: 3,  after: 'closing', required: true, gate: 'Closed', stage: 'funding' },
          { id: 'a360',      title: 'Upload the signed policy file to A360',                                owner: 'casemanager', dueDays: 31 }
        ]
      },
      {
        id: 'annuity-new', name: 'New Annuity',
        desc: 'Suitability through contract issue.',
        trigger: { bucket: 'Submitted', products: ['annuity'] },
        related: 'case',
        steps: [
          { id: 'suitability', title: 'Suitability and disclosure paperwork complete',                    owner: 'advisor',     dueDays: 1,  stage: 'application' },
          { id: 'submit',      title: 'Submit the application to the carrier',                            owner: 'casemanager', dueDays: 2,  stage: 'application' },
          { id: 'transfer',    title: 'Initiate the transfer / 1035 exchange paperwork',                  owner: 'casemanager', dueDays: 3,  stage: 'financial-uw' },
          { id: 'funds',       title: 'Track incoming funds until received',                              owner: 'casemanager', dueDays: 14, stage: 'funding' },
          { id: 'issued',      title: 'Contract issued — confirm allocations match the illustration',     owner: 'casemanager', dueDays: 18, required: true, gate: 'Closed' },
          { id: 'a360',        title: 'Upload the contract and suitability file to A360',                 owner: 'casemanager', dueDays: 19 }
        ]
      },
      {
        id: 'frs-sdba', name: 'FRS Rollover / SDBA',
        desc: 'Manual launch — an investments case can’t tell the board it is FRS.',
        trigger: null,
        related: 'case',
        steps: [
          { id: 'collect',  title: 'Collect the FRS statement and DROP / pension details',                owner: 'advisor',     dueDays: 2 },
          { id: 'account',  title: 'Open the receiving account — paperwork signed',                       owner: 'casemanager', dueDays: 5 },
          { id: 'rollover', title: 'Submit the rollover request to FRS / the plan administrator',         owner: 'casemanager', dueDays: 7 },
          { id: 'funds',    title: 'Track the check or wire until the funds land',                        owner: 'casemanager', dueDays: 21 },
          { id: 'invest',   title: 'Invest per the agreed allocation and confirm with the client',        owner: 'advisor',     dueDays: 23, required: true, gate: 'Closed' },
          { id: 'a360',     title: 'Upload the rollover file to A360',                                    owner: 'casemanager', dueDays: 24 }
        ]
      },
      {
        id: 'plan-new', name: 'Financial Plan',
        desc: 'Engagement letter to plan delivery.',
        trigger: { bucket: 'Submitted', products: ['plan'] },
        related: 'case',
        steps: [
          { id: 'engagement', title: 'Confirm the engagement letter is signed and the fee collected',     owner: 'casemanager', dueDays: 1 },
          { id: 'docs',       title: 'Chase outstanding statements and documents',                        owner: 'casemanager', dueDays: 5 },
          { id: 'build',      title: 'Build the plan in eMoney',                                          owner: 'advisor',     dueDays: 12 },
          { id: 'review',     title: 'Internal plan review before delivery',                              owner: 'advisor',     dueDays: 15 },
          { id: 'deliver',    title: 'Deliver the plan and log the opportunities it surfaced',            owner: 'advisor',     dueDays: 21, required: true, gate: 'Closed' }
        ]
      },
      {
        id: 'policy-delivery', name: 'Policy Delivery',
        desc: 'Starts when a partner confirms an insurance close. The signed receipt is due inside policy month 3 — after that the commission charges back.',
        trigger: { bucket: 'Closed', products: ['wl', 'term', 'di', 'ltc'] },
        related: 'case',
        steps: [
          { id: 'send',    title: 'Send the delivery requirements to the client',                          owner: 'casemanager', dueDays: 2 },
          { id: 'chase',   title: 'Chase the signed delivery receipt — call, do not wait',                  owner: 'casemanager', dueDays: 14, after: 'send' },
          { id: 'receipt', title: 'Signed receipt on file, case moved to Close/Won — chargeback lands at day 90', owner: 'casemanager', dueDays: 45, after: 'send' },
          { id: 'upload',  title: 'Upload the signed delivery receipt to A360',                             owner: 'casemanager', dueDays: 2,  after: 'receipt' }
        ]
      },
      {
        id: 'onboarding', name: 'New Client Onboarding',
        desc: 'Starts by itself when a partner confirms a close.',
        trigger: { bucket: 'Closed' },
        related: 'household',
        steps: [
          { id: 'welcome-call',  title: 'Welcome call from the advisor',                                  owner: 'advisor',     dueDays: 2 },
          { id: 'welcome-email', title: 'Send the welcome email and what-happens-next letter',            owner: 'casemanager', dueDays: 2 },
          { id: 'family',        title: 'Add spouse, kids and key dates to the household',                owner: 'casemanager', dueDays: 5 },
          { id: 'advisorstream', title: 'Confirm the AdvisorStream subscription',                         owner: 'casemanager', dueDays: 5 },
          { id: 'coverage',      title: 'Beneficiary and coverage cross-check — what is still uncovered?', owner: 'advisor',    dueDays: 14 },
          { id: 'first-review',  title: 'Book the first review meeting',                                  owner: 'casemanager', dueDays: 30 }
        ]
      },
      {
        id: 'annual-review', name: 'Annual Review',
        desc: 'Manual launch, once a year per household.',
        trigger: null,
        related: 'household',
        steps: [
          { id: 'packet',  title: 'Pull statements and build the review packet',                          owner: 'casemanager', dueDays: 5 },
          { id: 'confirm', title: 'Confirm the review appointment',                                       owner: 'casemanager', dueDays: 7 },
          { id: 'run',     title: 'Run the review — log every new opportunity as a case',                 owner: 'advisor',     dueDays: 14 },
          { id: 'update',  title: 'Update key dates, beneficiaries and household notes',                  owner: 'casemanager', dueDays: 16 }
        ]
      }
    ]
  };

  /* Schema repair for configs saved before the premium/signature split:
     the old combined step becomes the premium step, and the Policy Delivery
     chase is added when missing. Deliberate edits to other steps survive. */
  function repair(c) {
    const life = (c.templates || []).find(t => t.id === 'life-new');
    if (life) (life.steps || []).forEach(st => {
      if (st.id === 'delivery') {
        st.id = 'premium';
        st.title = 'Collect the initial premium — we are not paid until it is in';
      }
    });
    (c.templates || []).forEach(t => {
      const dt = DEFAULTS.templates.find(x => x.id === t.id);
      if (!dt) return;
      (t.steps || []).forEach(st => {
        if (st.after !== undefined) return;
        const ds = dt.steps.find(x => x.id === st.id);
        if (ds && ds.after) { st.after = ds.after; st.dueDays = ds.dueDays; }
      });
    });
    if (!(c.templates || []).some(t => t.id === 'policy-delivery')) {
      const tpl = DEFAULTS.templates.find(t => t.id === 'policy-delivery');
      const at = (c.templates || []).findIndex(t => t.id === 'onboarding');
      if (tpl) c.templates.splice(at >= 0 ? at : c.templates.length, 0, JSON.parse(JSON.stringify(tpl)));
    }
    return c;
  }

  let cfg = repair(DEFAULTS);
  let unsub = null;

  // Reads config/workflows when the future editor writes it; defaults until then.
  function init() {
    if (unsub || !RWG.fb) return;
    unsub = RWG.fb.db.collection('config').doc('workflows').onSnapshot(
      d => {
        cfg = repair((d.exists && d.data() && d.data().value) ? d.data().value : DEFAULTS);
        if (RWG.app && RWG.app.renderMain) RWG.app.renderMain();
      },
      e => console.error('workflows config listener:', e && e.message));
  }

  const templates = () => cfg.templates;
  const template = (id) => cfg.templates.find(t => t.id === id) || null;

  // ── role resolution at launch time ────────────────────────
  function activeUsers() {
    return (RWG.data && RWG.data.users) ? RWG.data.users().filter(u => u.status === 'active') : [];
  }
  function resolveOwner(role, c) {
    if (role === 'casemanager') {
      /* An agent's session holds a roster of ONE — themselves (data.js
         loads the full team for admins only). Workflows fire from agent
         sessions constantly — moving your own case to Submitted is the
         trigger — so the pinned case manager must be trusted AS CONFIG,
         not looked up in a roster the agent does not have. This is the
         bug where every step of a workflow landed on the agent and
         Kathy got nothing: the lookup failed quietly and fell through.
         The roster, when present, only improves the display name. */
      const us = activeUsers();
      if (cfg.caseManagerUid) {
        const u = us.find(x => x.id === cfg.caseManagerUid);
        return { uid: cfg.caseManagerUid, name: (u && u.name) || cfg.caseManagerName || '' };
      }
      const key = (cfg.caseManagerName || '').toLowerCase();
      const byName = key ? us.find(x => (x.name || '').toLowerCase().indexOf(key) >= 0) : null;
      if (byName) return { uid: byName.id, name: byName.name || '' };
      // Unpinned AND not on the visible roster — the advisor keeps the
      // step rather than it landing on nobody, and the result SAYS SO
      // (fellBack), so a launcher can warn instead of silently
      // preselecting the wrong person on every case-manager row.
      const fb = (c && c.agentUid) ? { uid: c.agentUid, name: c.agentName || '' }
        : (RWG.auth && RWG.auth.currentUser && RWG.auth.currentUser())
          ? { uid: RWG.auth.currentUser().id, name: RWG.auth.currentUser().name || '' }
          : { uid: null, name: '' };
      return { uid: fb.uid, name: fb.name, fellBack: true };
    }
    if (c && c.agentUid) return { uid: c.agentUid, name: c.agentName || '' };
    const me = RWG.auth && RWG.auth.currentUser && RWG.auth.currentUser();
    return me ? { uid: me.id, name: me.name || '' } : { uid: null, name: '' };
  }

  // ── what a launch points at, and its dedupe key ───────────
  function keyFor(tpl, c, hhId) {
    if (tpl.related === 'household' && hhId) return 'hh:' + hhId;
    if (c) return 'case:' + c.recordId;
    return hhId ? 'hh:' + hhId : null;
  }
  function relatedFor(tpl, c, hhId) {
    if (tpl.related === 'household' && hhId) {
      const h = RWG.hh && RWG.hh.isStarted() ? RWG.hh.household(hhId) : null;
      return { type: 'household', id: hhId, label: (h && h.name) || 'Household' };
    }
    if (c) {
      const prod = RWG.scorecard ? RWG.scorecard.productName(c.product) : c.product;
      return { type: 'case', id: c.recordId, label: (c.clientName || '(no name)') + ' · ' + (prod || '') };
    }
    if (hhId) {
      const h = RWG.hh && RWG.hh.isStarted() ? RWG.hh.household(hhId) : null;
      return { type: 'household', id: hhId, label: (h && h.name) || 'Household' };
    }
    return { type: null, id: null, label: '' };
  }

  // A trigger fires once per key. Done tasks count — finishing the
  // checklist must not re-arm the trigger.
  function hasRun(tplId, key) {
    if (!key) return false;
    return T().all().some(t => t.workflowTemplate === tplId && t.workflowKey === key);
  }

  function dueKey(startKey, days) {
    return T().todayKey(Date.parse(startKey + 'T12:00:00') + (days || 0) * dayMs);
  }

  /* Launch: one ordinary task per step. `opts.assignees` overrides the
     role defaults per step id ({uid, name}); `opts.start` re-bases the
     relative due dates (default today). */
  function launch(tplId, opts) {
    opts = opts || {};
    const tpl = template(tplId); if (!tpl) return null;
    const c = opts.caseRecord || null;
    const hhId = opts.householdId || (c && c.householdId) || null;
    const start = opts.start || T().todayKey();
    const wfId = tplId + '.' + ((c && c.recordId) || hhId || 'x') + '.' + Date.now();
    const key = keyFor(tpl, c, hhId);
    const rel = relatedFor(tpl, c, hhId);
    /* A chained step's dueDays count from its prerequisite's completion,
       unknowable at launch — so the launch date is an honest estimate
       walked through the chain (carrier day 1, medical day 2), replaced
       with the real clock the moment the prerequisite is ticked off. */
    const stepById = {}; tpl.steps.forEach(x => { stepById[x.id] = x; });
    const est = (x, seen) => {
      seen = seen || {};
      if (!x.after || !stepById[x.after] || seen[x.id]) return x.dueDays || 0;
      seen[x.id] = 1;
      return est(stepById[x.after], seen) + (x.dueDays || 0);
    };
    /* Where the case ENTERED its pipeline. A step tied to an earlier
       stage is work that already happened out in the world — starting an
       opportunity at Medical Underwriting means the application is in and
       the exam is scheduled — so those steps launch already checked off,
       and the checklist reads as history instead of nagging about it. */
    let entryIdx = -1, stageIdx = {};
    if (c) {
      const pl = P().pipelineForProduct(c.product);
      pl.stages.forEach((x, n) => { stageIdx[x.id] = n; });
      const cur = stageIdx[P().stageForCase(c)];
      entryIdx = cur == null ? -1 : cur;
    }
    let preDone = 0;
    tpl.steps.forEach((s, i) => {
      const already = entryIdx >= 0 && s.stage != null
        && stageIdx[s.stage] != null && stageIdx[s.stage] < entryIdx;
      if (already) preDone++;
      const who = (opts.assignees && opts.assignees[s.id]) || resolveOwner(s.owner, c);
      T().addTask({
        title: s.title, note: s.note || '',
        status: already ? 'done' : 'open',
        doneAt: already ? Date.now() : null,
        assigneeUid: who.uid, assigneeName: who.name,
        dueDate: dueKey(start, est(s)),
        relatedType: rel.type, relatedId: rel.id, relatedLabel: rel.label,
        // A step is ABOUT the case and FOR the person. Carrying the contact
        // is what puts an underwriting step on that client's record — open
        // or done — instead of leaving it in whoever-was-assigned's list.
        // The household rides along for the family screens.
        contactId: opts.contactId || (c && c.contactId) || null,
        householdId: hhId || null,
        clientName: (c && c.clientName) || '',
        required: !!s.required, gate: s.gate || null,
        workflowId: wfId, workflowTemplate: tplId, workflowName: tpl.name,
        workflowKey: key, workflowStep: i,
        workflowStepId: s.id, awaitsStep: s.after || null,
        chainDays: s.after ? (s.dueDays || 0) : null
      });
    });
    return { id: wfId, name: tpl.name, count: tpl.steps.length, preDone: preDone };
  }

  /* Auto-launch: called after a board move and after a confirmed close.
     Checks every triggered template against where the case NOW sits.
     Refuses to run before the tasks cache is live — firing blind would
     defeat the dedupe and double-launch. Returns the names started. */
  // The templates whose trigger matches where this case sits NOW and that
  // have not already run for it — what an auto-launch would start, or what
  // the Submitted-entry prompt offers as a choice.
  function candidates(c) {
    if (!c || !T() || !T().isStarted()) return [];
    const bucket = P().bucketOf(c.product, P().stageForCase(c));
    return cfg.templates.filter(tpl => {
      const trg = tpl.trigger; if (!trg) return false;
      if (trg.bucket !== bucket) return false;
      if (trg.products && trg.products.indexOf(c.product) < 0) return false;
      return !hasRun(tpl.id, keyFor(tpl, c, c.householdId));
    });
  }
  function autoLaunch(c) {
    const started = [];
    candidates(c).forEach(tpl => {
      if (launch(tpl.id, { caseRecord: c })) started.push(tpl.name);
    });
    return started;
  }

  /* The chain, asked from the task side: the sibling step this one waits
     for, or null when it is free to be done. A prerequisite that was
     deleted or never launched does not hold anything hostage. */
  function waitingOn(t) {
    if (!t || !t.awaitsStep || !t.workflowId || !T() || !T().isStarted()) return null;
    const prereq = T().all().find(x =>
      x.workflowId === t.workflowId && x.workflowStepId === t.awaitsStep);
    return (prereq && prereq.status !== 'done') ? prereq : null;
  }

  /* When a step completes, every step chained to it gets its REAL due
     date: today plus its own offset. The launch estimate dies here —
     sign the application in four days or four weeks, the medical is due
     one day after the tick either way. */
  function rebaseChains(doneTask) {
    if (!doneTask || !doneTask.workflowId || !doneTask.workflowStepId) return;
    if (!T() || !T().isStarted()) return;
    T().all().filter(x => x.workflowId === doneTask.workflowId
        && x.awaitsStep === doneTask.workflowStepId && x.status !== 'done')
      .forEach(x => {
        T().saveTask({ id: x.id, dueDate: T().todayKey(Date.now() + (x.chainDays || 0) * dayMs) });
      });
  }

  // Open required steps that hold the door to Won shut for this case.
  function blockers(caseId) {
    if (!T() || !T().isStarted()) return [];
    return T().open()
      .filter(t => t.relatedType === 'case' && t.relatedId === caseId && t.required && t.gate === 'Closed')
      .sort((a, b) => (a.workflowStep || 0) - (b.workflowStep || 0));
  }

  // Every launch touching this household (directly or via its cases),
  // as checklist summaries for the household card. Newest first.
  function instancesFor(hhId, caseIds) {
    if (!T() || !T().isStarted()) return [];
    const ids = {}; (caseIds || []).forEach(id => { ids[id] = 1; });
    const by = {};
    T().all().forEach(t => {
      if (!t.workflowId) return;
      const hit = (t.relatedType === 'household' && t.relatedId === hhId)
        || (t.relatedType === 'case' && ids[t.relatedId]);
      if (!hit) return;
      (by[t.workflowId] = by[t.workflowId] || []).push(t);
    });
    return Object.keys(by).map(id => {
      const list = by[id].sort((a, b) => (a.workflowStep || 0) - (b.workflowStep || 0));
      const done = list.filter(t => t.status === 'done').length;
      return {
        id: id, name: list[0].workflowName || 'Workflow',
        total: list.length, done: done,
        next: list.find(t => t.status !== 'done') || null,
        label: list[0].relatedLabel || '',
        startedAt: list[0].createdAt || 0
      };
    }).sort((a, b) => b.startedAt - a.startedAt);
  }

  return {
    DEFAULTS, init,
    templates, template, resolveOwner,
    launch, autoLaunch, candidates, hasRun, blockers, waitingOn, rebaseChains, instancesFor,
    current: () => cfg   // the whole live config, for the settings editor's draft
  };
})();
