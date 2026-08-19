/* ============================================================
   RWG Platform — CRM Settings (phase 5.5)

   The screen where Carlos owns the machine: pipeline stages,
   workflow templates, default rates, lost reasons — everything the
   blueprint promised would be editable without a build. Each tab
   edits a DRAFT in memory and publishes it with its own Save; the
   config listeners (pipelines-config / workflows-config / the rates
   listener in scorecard-config) pick the published doc up live, so
   the whole team sees the change on their next paint.

   Guardrails, because config is where a wrong click gets expensive:
     · Close/Won and Lost are pinned — renameable, never deletable,
       never reordered, buckets locked. The money contract stands.
     · Deleting a stage that holds live cases forces a remap to a
       stage in the SAME bucket first, so no write-once stamp is
       ever implied or lost by a config edit.
     · A rate override steers only cases with no rate of their own;
       closed-and-confirmed cases sit frozen in their applied
       snapshot. The editor says this out loud.
     · Template edits touch future launches only — checklists
       already running are ordinary tasks and keep their course.

   ("Scoring & Settings" in the nav is the LEADS module's screen —
   lead scoring rules. This one is the CRM's. They merge at cutover.)
   ============================================================ */
window.RWG = window.RWG || {};

(function () {
  const P  = () => RWG.pipelines;
  const W  = () => RWG.wf;
  const SD = () => RWG.scorecardData;
  const SC = () => RWG.scorecard;
  const D  = () => RWG.data;
  const U  = () => RWG.ui;
  const esc = (s) => U().esc(s);

  const st = { tab: 'pipelines', pl: 'insurance', tplId: null, dP: null, dW: null, dR: null, dC: null, dirty: {} };

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const mount = () => document.getElementById('modal-mount');

  // ── drafts, hydrated lazily from the live config ──────────
  function draftP() {
    if (!st.dP) st.dP = clone(P().current());
    return st.dP;
  }
  function draftW() {
    if (!st.dW) st.dW = clone(W().current());
    return st.dW;
  }
  function draftR() {
    if (!st.dR) st.dR = clone(SC().rateOverrides() || {});
    return st.dR;
  }
  function draftC() {
    if (!st.dC) st.dC = clone(RWG.tasks.categories());
    return st.dC;
  }
  function markDirty(which) {
    st.dirty[which] = true;
    const el = document.getElementById('set-dirty-' + which);
    if (el) el.style.display = '';
  }

  function slug(label, taken) {
    let base = String(label || 'stage').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'stage';
    let id = base, n = 2;
    while (taken.indexOf(id) >= 0) id = base + '-' + (n++);
    return id;
  }

  function saveDoc(doc, value) {
    const me = RWG.auth.currentUser();
    return RWG.fb.db.collection('config').doc(doc).set({
      value: value, updatedAt: new Date().toISOString(), updatedBy: (me && me.id) || null
    });
  }

  const working = (pl) => pl.stages.filter(s => s.bucket !== 'Closed' && s.bucket !== 'Lost');
  const tail = (pl) => pl.stages.filter(s => s.bucket === 'Closed' || s.bucket === 'Lost');

  // Live cases sitting on a stage — counted against the PUBLISHED config,
  // because that is where those cases actually are today.
  function liveCount(plId, stageId) {
    if (!SD().isStarted()) return 0;
    return SD().cases().filter(c =>
      (c.state === 'Opened' || c.state === 'Submitted') && !c.closedAt
      && P().pipelineForProduct(c.product).id === plId
      && P().stageForCase(c) === stageId).length;
  }

  /* ══ Pipelines tab ═════════════════════════════════════════ */

  function stageRow(pl, s, locked) {
    const n = locked ? 0 : liveCount(pl.id, s.id);
    return `<div class="flex set-row" data-dl="st:${esc(pl.id)}" data-dk="${esc(s.id)}"
        style="gap:10px;align-items:center;padding:8px 14px;border-bottom:1px solid rgba(14,36,64,.06)">
      <span class="set-h" ${locked ? '' : 'draggable="true"'} data-dl="st:${esc(pl.id)}" data-dk="${esc(s.id)}"
        style="color:var(--muted);font-size:13px;flex:none;${locked ? 'opacity:.25' : 'cursor:grab'}">⠿</span>
      <input value="${esc(s.label)}" data-set="pl" data-pl="${esc(pl.id)}" data-sid="${esc(s.id)}" data-sf="label"
        style="flex:1;min-width:0;font-size:13px;padding:5px 9px">
      ${locked
        ? `<span class="chip ${s.bucket === 'Closed' ? 'tier-high' : 'tier-low'}" style="font-size:10.5px;flex:none">${esc(s.bucket)} · pinned</span>`
        : `<select data-set="pl" data-pl="${esc(pl.id)}" data-sid="${esc(s.id)}" data-sf="bucket"
            style="flex:none;width:112px;font-size:12px;padding:4px 7px" title="Which report bucket this stage rolls into">
            <option ${s.bucket === 'Opened' ? 'selected' : ''}>Opened</option>
            <option ${s.bucket === 'Submitted' ? 'selected' : ''}>Submitted</option>
          </select>`}
      ${!locked && n ? `<span class="pill-soft" style="font-size:10.5px;flex:none" title="Open cases sitting on this stage right now">${n} live</span>` : ''}
      ${locked ? '<span style="width:26px;flex:none"></span>'
        : `<button class="btn btn-quiet btn-sm" style="padding:2px 8px;flex:none" title="Remove this stage" data-action="set-st-del" data-pl="${esc(pl.id)}" data-id="${esc(s.id)}">✕</button>`}
    </div>`;
  }

  function pipelinesTab() {
    const d = draftP();
    const pl = d.pipelines.find(p => p.id === st.pl) || d.pipelines[0];
    const tabs = d.pipelines.map(p =>
      `<button class="btn btn-sm ${p.id === pl.id ? 'btn-navy' : 'btn-ghost'}" data-action="set-pl" data-pl="${esc(p.id)}">${esc(p.name)}</button>`).join('');
    const prods = (pl.products || []).map(p => `<span class="pill-soft" style="font-size:11px">${esc(SC().productName(p) || p)}</span>`).join(' ');
    return `
      <div class="flex" style="gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
        ${tabs}<span class="topbar-spacer"></span>
        <span class="cell-sub">Products on this track: ${prods}</span>
      </div>
      <div class="card flush">
        <div class="list-head">
          <span class="t">Stages</span>
          <span class="cell-sub">drag to reorder · the bucket decides where a stage reports</span>
          <span class="topbar-spacer"></span>
          <button class="btn btn-ghost btn-sm" data-action="set-st-add" data-pl="${esc(pl.id)}">＋ Add stage</button>
        </div>
        ${working(pl).map(s => stageRow(pl, s, false)).join('')}
        ${tail(pl).map(s => stageRow(pl, s, true)).join('')}
      </div>
      <p class="muted" style="font-size:12px;margin:10px 2px 0">
        Renames and reorders are free — the money never moves, because the scorecard counts the
        write-once stamps, not the stage names. Moving a stage between <b>Opened</b> and
        <b style="color:var(--gold)">Submitted</b> changes when future cases stamp "written", so do it knowingly.
      </p>
      ${saveBar('p', 'set-save-pl', 'Save pipelines')}`;
  }

  function remapModal(plId, stageId, n) {
    const d = draftP();
    const pl = d.pipelines.find(p => p.id === plId);
    const s = pl.stages.find(x => x.id === stageId);
    const targets = working(pl).filter(x => x.id !== stageId && x.bucket === s.bucket);
    if (!targets.length) { U().toast('Add a replacement ' + s.bucket + ' stage first — those ' + n + ' cases need somewhere in the same bucket to live'); return; }
    mount().innerHTML = `
      <div class="scrim" data-action="close-modal"></div>
      <div class="modal-card">
        <div class="modal-head"><h2>${n} live case${n === 1 ? '' : 's'} sit${n === 1 ? 's' : ''} on “${esc(s.label)}”</h2>
          <p>Move them to another ${esc(s.bucket)} stage first — same bucket, so nothing about the money or the stamps changes.</p></div>
        <div class="modal-body">
          <div class="field-group"><label class="lbl">Move them to</label>
            <select id="set-remap-to">${targets.map(t => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('')}</select></div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" data-action="close-modal">Cancel</button>
          <button class="btn btn-gold" data-action="set-st-remap" data-pl="${esc(plId)}" data-id="${esc(stageId)}">Move ${n} and remove the stage</button>
        </div>
      </div>`;
  }

  /* ══ Workflows tab ═════════════════════════════════════════ */

  function stepRow(tpl, s, i) {
    return `<div class="flex set-row" data-dl="wf:${esc(tpl.id)}" data-dk="${esc(s.id)}"
        style="gap:9px;align-items:center;padding:8px 14px;border-bottom:1px solid rgba(14,36,64,.06)">
      <span class="set-h" draggable="true" data-dl="wf:${esc(tpl.id)}" data-dk="${esc(s.id)}"
        style="color:var(--muted);font-size:13px;flex:none;cursor:grab">⠿</span>
      <input value="${esc(s.title)}" data-set="wfstep" data-sid="${esc(s.id)}" data-sf="title"
        style="flex:1;min-width:0;font-size:13px;padding:5px 9px">
      <select data-set="wfstep" data-sid="${esc(s.id)}" data-sf="owner" style="flex:none;width:118px;font-size:12px;padding:4px 7px">
        <option value="advisor" ${s.owner === 'advisor' ? 'selected' : ''}>Advisor</option>
        <option value="casemanager" ${s.owner !== 'advisor' ? 'selected' : ''}>Case manager</option>
      </select>
      <select data-set="wfstep" data-sid="${esc(s.id)}" data-sf="after" style="flex:none;width:118px;font-size:12px;padding:4px 7px"
        title="Chained: this step cannot be checked off until the one it waits for is done">
        <option value="" ${!s.after ? 'selected' : ''}>no chain</option>
        ${tpl.steps.filter(x => x.id !== s.id).map(x =>
          `<option value="${esc(x.id)}" ${s.after === x.id ? 'selected' : ''}>after: ${esc(x.title.length > 22 ? x.title.slice(0, 21) + '…' : x.title)}</option>`).join('')}
      </select>
      <span class="cell-sub" style="flex:none;font-size:11px">day +</span>
      <input type="number" min="0" value="${esc(s.dueDays == null ? 0 : s.dueDays)}" data-set="wfstep" data-sid="${esc(s.id)}" data-sf="dueDays"
        style="flex:none;width:52px;font-size:12.5px;padding:4px 6px;text-align:right">
      <label class="flex" style="gap:4px;align-items:center;flex:none;font-size:11px;color:var(--muted);cursor:pointer"
        title="A required step blocks the push to Won until it is done">
        <input type="checkbox" ${s.required ? 'checked' : ''} data-set="wfstep" data-sid="${esc(s.id)}" data-sf="required"
          style="accent-color:var(--gold)">required</label>
      <button class="btn btn-quiet btn-sm" style="padding:2px 8px;flex:none" data-action="set-wf-step-del" data-id="${esc(s.id)}">✕</button>
    </div>`;
  }

  function workflowsTab() {
    const d = draftW();
    if (!st.tplId || !d.templates.some(t => t.id === st.tplId)) st.tplId = d.templates.length ? d.templates[0].id : null;
    const tpl = d.templates.find(t => t.id === st.tplId) || null;
    const users = D().users().filter(u => u.status === 'active');
    const cmOpts = users.map(u =>
      `<option value="${esc(u.id)}" ${u.id === d.caseManagerUid || (!d.caseManagerUid && (u.name || '').toLowerCase().indexOf((d.caseManagerName || '').toLowerCase()) >= 0 && d.caseManagerName) ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
    const list = d.templates.map(t =>
      `<button class="btn btn-sm ${t.id === st.tplId ? 'btn-navy' : 'btn-ghost'}" style="justify-content:flex-start;text-align:left"
        data-action="set-wf-pick" data-id="${esc(t.id)}">${esc(t.name)}<span style="opacity:.6;margin-left:6px;font-size:10.5px">${t.trigger ? (t.trigger.bucket === 'Closed' ? 'on close' : 'on written') : 'manual'}</span></button>`).join('');

    const editor = !tpl ? '<div class="card"><p class="muted" style="margin:0">No templates. Add one.</p></div>' : `
      <div class="card flush">
        <div style="padding:14px 16px;border-bottom:1px solid var(--line)">
          <div class="field-row">
            <div class="field-group" style="margin:0"><label class="lbl">Name</label>
              <input value="${esc(tpl.name)}" data-set="wf" data-sf="name"></div>
            <div class="field-group" style="margin:0"><label class="lbl">Starts</label>
              <select data-set="wf" data-sf="trigger">
                <option value="" ${!tpl.trigger ? 'selected' : ''}>Manually (▶ Workflow button)</option>
                <option value="Submitted" ${tpl.trigger && tpl.trigger.bucket === 'Submitted' ? 'selected' : ''}>When a case is first written</option>
                <option value="Closed" ${tpl.trigger && tpl.trigger.bucket === 'Closed' ? 'selected' : ''}>When a close is confirmed</option>
              </select></div>
          </div>
          ${tpl.trigger && tpl.trigger.bucket === 'Submitted' ? `
          <div class="field-group" style="margin:10px 0 0"><label class="lbl">Only for these products <span class="pill-soft" style="font-size:10px">none checked = the whole track</span></label>
            <div class="flex" style="gap:10px;flex-wrap:wrap;margin-top:4px">
              ${SC().PRODUCTS.map(p => `<label class="flex" style="gap:5px;align-items:center;font-size:12.5px;cursor:pointer">
                <input type="checkbox" ${(tpl.trigger.products || []).indexOf(p.id) >= 0 ? 'checked' : ''}
                  data-set="wf" data-sf="product" data-prod="${esc(p.id)}" style="accent-color:var(--gold)">${esc(p.name)}</label>`).join('')}
            </div></div>` : ''}
        </div>
        ${tpl.steps.map((s, i) => stepRow(tpl, s, i)).join('')}
        <div class="flex" style="padding:10px 14px;gap:8px">
          <button class="btn btn-ghost btn-sm" data-action="set-wf-step-add">＋ Add step</button>
          <span class="topbar-spacer"></span>
          <button class="btn btn-quiet btn-sm" style="color:var(--bad)" data-action="set-wf-del" data-id="${esc(tpl.id)}">Delete template</button>
        </div>
      </div>
      <p class="muted" style="font-size:12px;margin:10px 2px 0">
        Owners are roles, resolved when the workflow launches — reassignable after. Due dates count
        from the launch day. <b>Required</b> steps hold the push to Won until they are checked off.
        A <b>chained</b> step cannot be checked off until the step it waits for is done — and its
        days count from the moment that step is ticked, not from launch.
        Edits here touch future launches only; checklists already running keep their course.
      </p>`;

    return `
      <div class="card" style="margin-bottom:14px">
        <div class="flex" style="gap:12px;align-items:flex-end;flex-wrap:wrap">
          <div class="field-group" style="margin:0;min-width:230px"><label class="lbl">Case manager — the "casemanager" role resolves to</label>
            <select data-set="wf" data-sf="casemanager">${cmOpts || '<option value="">— no active users —</option>'}</select></div>
          <p class="muted" style="font-size:12px;margin:0;flex:1;min-width:200px">Kathy runs case management. If her account changes, point the role here once — every template follows.</p>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:190px minmax(0,1fr);gap:14px;align-items:start">
        <div style="display:flex;flex-direction:column;gap:6px">
          ${list}
          <button class="btn btn-ghost btn-sm" data-action="set-wf-add" style="margin-top:6px">＋ New template</button>
        </div>
        <div>${editor}</div>
      </div>
      ${saveBar('w', 'set-save-wf', 'Save workflows')}`;
  }

  /* ══ Rates tab ═════════════════════════════════════════════ */

  function ratesTab() {
    const d = draftR();
    const rows = SC().PRODUCTS.filter(p => SC().builtinRate(p.id) != null).map(p => {
      const builtin = SC().builtinRate(p.id);
      const ov = d[p.id];
      return `<div class="flex" style="gap:12px;align-items:center;padding:10px 16px;border-bottom:1px solid rgba(14,36,64,.06)">
        <span style="width:130px;flex:none;font-size:13px;color:var(--ink);font-weight:600">${esc(p.name)}</span>
        <span class="cell-sub" style="width:110px;flex:none">built-in ${+(builtin * 100).toFixed(2)}%</span>
        <input type="number" step="any" min="0" value="${ov > 0 ? +(ov * 100).toFixed(4) : ''}" placeholder="${+(builtin * 100).toFixed(2)}"
          data-set="rate" data-prod="${esc(p.id)}" style="width:110px;flex:none;font-size:13px;padding:5px 9px;text-align:right">
        <span class="cell-sub" style="flex:none">%</span>
        <span class="cell-sub" style="flex:1;font-size:11.5px">${ov > 0 ? 'override active — blank the field to go back to the built-in' : 'using the built-in'}</span>
      </div>`;
    }).join('');
    return `
      <div class="card flush">
        <div class="list-head">
          <span class="t">Default rates</span>
          <span class="cell-sub" style="margin-left:8px">what a case earns when no rate is typed on it</span>
        </div>
        ${rows}
      </div>
      <div class="card" style="margin-top:12px;border-left:3px solid var(--gold)">
        <p style="font-size:12.5px;margin:0;color:var(--ink)"><b>What an override touches.</b>
          Every case that carries no rate of its own — including open ones from before the change.
          A case with a typed rate keeps it. A case closed through the close review is frozen in its
          confirmed snapshot and never moves. For one-off schedules (a 55% carrier, a 0.17% 401(k)),
          keep typing the rate on the case — that is still the rule: override the rate, never the revenue.</p>
      </div>
      ${saveBar('r', 'set-save-rates', 'Save rates')}`;
  }

  /* ══ Lost reasons tab ══════════════════════════════════════ */

  function reasonsTab() {
    const d = draftP();
    const rows = (d.lostReasons || []).map((r, i) => `
      <div class="flex set-row" data-dl="lr" data-dk="${i}" style="gap:10px;align-items:center;padding:8px 14px;border-bottom:1px solid rgba(14,36,64,.06)">
        <span class="set-h" draggable="true" data-dl="lr" data-dk="${i}" style="color:var(--muted);font-size:13px;flex:none;cursor:grab">⠿</span>
        <input value="${esc(r)}" data-set="reason" data-i="${i}" style="flex:1;min-width:0;font-size:13px;padding:5px 9px">
        <button class="btn btn-quiet btn-sm" style="padding:2px 8px;flex:none" data-action="set-lr-del" data-i="${i}">✕</button>
      </div>`).join('');
    return `
      <div class="card flush" style="max-width:520px">
        <div class="list-head">
          <span class="t">Lost reasons</span>
          <span class="cell-sub" style="margin-left:8px">the choices in the “Mark lost” dialog</span>
          <span class="topbar-spacer"></span>
          <button class="btn btn-ghost btn-sm" data-action="set-lr-add">＋ Add</button>
        </div>
        ${rows}
      </div>
      <p class="muted" style="font-size:12px;margin:10px 2px 0;max-width:520px">
        These feed the dashboard's 90-day rollup, so keep them few and honest. Renaming a reason
        does not rewrite history — old losses keep the words they were marked with.
      </p>
      ${saveBar('p', 'set-save-pl', 'Save lost reasons')}`;
  }

  /* ══ Task categories tab ═══════════════════════════════════
     The same config-as-data shape as everything else here: code
     defaults ship in tasks-data.js, this doc overrides them. A
     category is a plain string, so renaming one leaves old tasks
     wearing the old word — the filter simply stops offering it. */

  function categoriesTab() {
    const d = draftC();
    const used = {};
    if (RWG.tasks.isStarted()) RWG.tasks.all().forEach(t => { if (t.category) used[t.category] = (used[t.category] || 0) + 1; });
    const rows = d.map((c, i) => `
      <div class="flex set-row" style="gap:10px;align-items:center;padding:8px 14px;border-bottom:1px solid rgba(14,36,64,.06)">
        <input value="${esc(c)}" data-set="cat" data-i="${i}" style="flex:1;min-width:0;font-size:13px;padding:5px 9px">
        <span class="cell-sub" style="flex:none;min-width:64px;text-align:right">${used[c] ? used[c] + ' in use' : ''}</span>
        <button class="btn btn-quiet btn-sm" style="padding:2px 8px;flex:none" data-action="set-cat-del" data-i="${i}">✕</button>
      </div>`).join('');
    const orphans = Object.keys(used).filter(k => d.indexOf(k) < 0);
    return `
      <div class="card flush" style="max-width:520px">
        <div class="list-head">
          <span class="t">Task categories</span>
          <span class="cell-sub" style="margin-left:8px">the choices on a task, and the filter on the Tasks page</span>
          <span class="topbar-spacer"></span>
          <button class="btn btn-ghost btn-sm" data-action="set-cat-add">＋ Add</button>
        </div>
        ${rows || '<p class="list-hint">No categories — tasks will simply have none.</p>'}
      </div>
      ${orphans.length ? `<p class="muted" style="font-size:12px;margin:10px 2px 0;max-width:520px;color:var(--warn)">
        Still worn by existing tasks but no longer on the list: ${orphans.map(esc).join(', ')}.
        Those tasks keep the word; add it back above to make it selectable again.</p>` : ''}
      <p class="muted" style="font-size:12px;margin:10px 2px 0;max-width:520px">
        Keep these few enough that people actually pick one. Removing a category never
        edits a task — history keeps the word it was filed under.
      </p>
      ${saveBar('c', 'set-save-cat', 'Save categories')}`;
  }

  /* ══ Lead scoring tab (phase 7) ════════════════════════════
     The same rules that lived under "Scoring & Settings" in the
     Leads nav, moved home. The fields keep their cfg-* ids and the
     buttons keep their kernel actions (save-scoring / reset-scoring),
     so the save path is byte-for-byte the one that always worked. */
  function scoringTab() {
    const c = D().scoringConfig();
    const f = (label, id, val, hint) => `<div class="field-group"><label class="lbl">${label}</label>
      <input type="number" step="any" id="${id}" value="${val}">${hint ? `<div class="cell-sub mt-8">${hint}</div>` : ''}</div>`;
    return `
      <div class="card" style="max-width:640px">
        <div class="card-head"><h3>Lead scoring rules</h3><span class="sub">tune what makes a lead "Gold" — leads re-score on save</span></div>
        <div class="field-row">${f('DROP — Regular: Years of Service', 'cfg-reg-yos', c.drop.regular.yos)}${f('DROP — Regular: Age', 'cfg-reg-age', c.drop.regular.age)}</div>
        <div class="field-row">${f('DROP — Special Risk: YOS', 'cfg-sr-yos', c.drop.specialRisk.yos)}${f('DROP — Special Risk: Age', 'cfg-sr-age', c.drop.specialRisk.age)}</div>
        ${f('In-service rollover age', 'cfg-inservice', c.inServiceAge, 'Age that unlocks in-service rollover → annuity.')}
        ${f('High-tenure Investment Plan (YOS)', 'cfg-invhi', c.investmentHighYos, 'YOS that implies a large Investment Plan account.')}
        <div class="field-row">${f('AFC: High ($)', 'cfg-afc-hi', c.afc.high)}${f('AFC: Mid ($)', 'cfg-afc-mid', c.afc.mid)}</div>
        <div class="section-title">Tier cutoffs (0–100 score)</div>
        <div class="field-row">${f('Gold ≥', 'cfg-cut-gold', c.tierCutoffs.gold)}${f('High ≥', 'cfg-cut-high', c.tierCutoffs.high)}</div>
        ${f('Medium ≥', 'cfg-cut-med', c.tierCutoffs.medium, 'Below this = Low.')}
        <div class="mt-8" style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn btn-ghost btn-sm" data-action="reset-scoring">Reset to defaults</button>
          <button class="btn btn-gold btn-sm" data-action="save-scoring">Save scoring rules</button>
        </div>
      </div>
      <p class="muted" style="font-size:12px;margin:10px 2px 0;max-width:640px">
        Moved here from the old "Scoring & Settings" — same rules, same save, one settings screen.
      </p>`;
  }

  /* ══ shared chrome ═════════════════════════════════════════ */

  function saveBar(which, action, label) {
    return `<div class="flex" style="margin-top:14px;gap:10px;align-items:center">
      <span id="set-dirty-${which}" class="cell-sub" style="color:var(--warn);font-weight:700;display:${st.dirty[which] ? '' : 'none'}">Unsaved changes</span>
      <span class="topbar-spacer"></span>
      <button class="btn btn-ghost btn-sm" data-action="set-discard" data-which="${which}">Discard</button>
      <button class="btn btn-gold" data-action="${action}">${label}</button>
    </div>`;
  }

  function screenHtml() {
    const tabs = [['pipelines', 'Pipelines'], ['workflows', 'Workflows'], ['rates', 'Rates'],
      ['reasons', 'Lost reasons'], ['categories', 'Task categories'], ['scoring', 'Lead scoring']]
      .map(t => `<button class="btn btn-sm ${st.tab === t[0] ? 'btn-navy' : 'btn-ghost'}" data-action="set-tab" data-tab="${t[0]}">${t[1]}</button>`).join('');
    const body = st.tab === 'workflows' ? workflowsTab()
      : st.tab === 'rates' ? ratesTab()
      : st.tab === 'reasons' ? reasonsTab()
      : st.tab === 'categories' ? categoriesTab()
      : st.tab === 'scoring' ? scoringTab()
      : pipelinesTab();
    return `<div class="flex" style="gap:8px;margin-bottom:16px;flex-wrap:wrap">${tabs}</div>${body}`;
  }

  /* ══ draft mutation from inputs ════════════════════════════ */

  function applyEdit(el) {
    const kind = el.dataset.set;
    if (!kind) return;
    if (kind === 'pl') {
      const d = draftP();
      const pl = d.pipelines.find(p => p.id === el.dataset.pl); if (!pl) return;
      const s = pl.stages.find(x => x.id === el.dataset.sid); if (!s) return;
      if (el.dataset.sf === 'label') s.label = el.value;
      if (el.dataset.sf === 'bucket') s.bucket = el.value;
      markDirty('p');
    } else if (kind === 'reason') {
      draftP().lostReasons[Number(el.dataset.i)] = el.value;
      markDirty('p');
    } else if (kind === 'cat') {
      draftC()[Number(el.dataset.i)] = el.value;
      markDirty('c');
    } else if (kind === 'rate') {
      const v = Number(el.value);
      if (v > 0) draftR()[el.dataset.prod] = v / 100;
      else delete draftR()[el.dataset.prod];
      markDirty('r');
    } else if (kind === 'wf') {
      const d = draftW();
      const tpl = d.templates.find(t => t.id === st.tplId);
      if (el.dataset.sf === 'casemanager') {
        const u = D().user(el.value);
        d.caseManagerUid = el.value || null;
        d.caseManagerName = (u && u.name) || d.caseManagerName;
        markDirty('w'); return;
      }
      if (!tpl) return;
      if (el.dataset.sf === 'name') tpl.name = el.value;
      if (el.dataset.sf === 'trigger') {
        tpl.trigger = el.value ? { bucket: el.value, products: (tpl.trigger && tpl.trigger.products) || undefined } : null;
        if (tpl.trigger && tpl.trigger.bucket === 'Closed') { delete tpl.trigger.products; tpl.related = 'household'; }
        markDirty('w'); RWG.app.renderMain(); return;
      }
      if (el.dataset.sf === 'product') {
        tpl.trigger = tpl.trigger || { bucket: 'Submitted' };
        let ps = tpl.trigger.products || [];
        if (el.checked) { if (ps.indexOf(el.dataset.prod) < 0) ps.push(el.dataset.prod); }
        else ps = ps.filter(p => p !== el.dataset.prod);
        if (ps.length) tpl.trigger.products = ps; else delete tpl.trigger.products;
      }
      markDirty('w');
    } else if (kind === 'wfstep') {
      const tpl = draftW().templates.find(t => t.id === st.tplId); if (!tpl) return;
      const s = tpl.steps.find(x => x.id === el.dataset.sid); if (!s) return;
      if (el.dataset.sf === 'title') s.title = el.value;
      if (el.dataset.sf === 'owner') s.owner = el.value;
      if (el.dataset.sf === 'dueDays') s.dueDays = Math.max(0, Number(el.value) || 0);
      if (el.dataset.sf === 'required') {
        s.required = !!el.checked;
        if (s.required) s.gate = 'Closed'; else delete s.gate;
      }
      if (el.dataset.sf === 'after') {
        // A chain may not loop back on itself — walk it before accepting.
        let p = el.value, loops = false, hops = 0;
        while (p && hops++ < 50) {
          if (p === s.id) { loops = true; break; }
          p = (tpl.steps.find(x => x.id === p) || {}).after;
        }
        if (loops) { RWG.ui.toast('That would chain the step to itself — pick another'); el.value = s.after || ''; return; }
        s.after = el.value || null;
      }
      markDirty('w');
    }
  }

  /* ══ drag-to-reorder (settings lists) ══════════════════════ */

  let drag = null;   // {dl, dk}
  function reorder(dl, fromKey, toKey) {
    if (dl === 'lr') {
      const a = draftP().lostReasons;
      const from = Number(fromKey), to = Number(toKey);
      a.splice(to, 0, a.splice(from, 1)[0]);
      markDirty('p'); return;
    }
    if (dl.slice(0, 3) === 'st:') {
      const pl = draftP().pipelines.find(p => p.id === dl.slice(3)); if (!pl) return;
      const work = working(pl);
      const from = work.findIndex(s => s.id === fromKey), to = work.findIndex(s => s.id === toKey);
      if (from < 0 || to < 0) return;
      work.splice(to, 0, work.splice(from, 1)[0]);
      pl.stages = work.concat(tail(pl));
      markDirty('p'); return;
    }
    if (dl.slice(0, 3) === 'wf:') {
      const tpl = draftW().templates.find(t => t.id === dl.slice(3)); if (!tpl) return;
      const from = tpl.steps.findIndex(s => s.id === fromKey), to = tpl.steps.findIndex(s => s.id === toKey);
      if (from < 0 || to < 0) return;
      tpl.steps.splice(to, 0, tpl.steps.splice(from, 1)[0]);
      markDirty('w');
    }
  }
  document.addEventListener('dragstart', e => {
    const el = (e.target && e.target.nodeType === 1) ? e.target.closest('.set-h[draggable="true"]') : null;
    if (!el) return;
    drag = { dl: el.dataset.dl, dk: el.dataset.dk };
    try { e.dataTransfer.setData('text/plain', el.dataset.dk); e.dataTransfer.effectAllowed = 'move'; } catch (_) {}
  });
  document.addEventListener('dragover', e => {
    if (!drag) return;
    const row = (e.target && e.target.nodeType === 1) ? e.target.closest('.set-row') : null;
    if (row && row.dataset.dl === drag.dl) e.preventDefault();
  });
  document.addEventListener('drop', e => {
    if (!drag) return;
    const d = drag; drag = null;
    const row = (e.target && e.target.nodeType === 1) ? e.target.closest('.set-row') : null;
    if (!row || row.dataset.dl !== d.dl || row.dataset.dk === d.dk) return;
    e.preventDefault();
    reorder(d.dl, d.dk, row.dataset.dk);
    RWG.app.renderMain();
  });
  document.addEventListener('dragend', () => { drag = null; });

  /* ══ the module ════════════════════════════════════════════ */

  RWG.modules.register({
    id: 'crmsettings',
    title: 'CRM Settings',
    enabled: true,
    roles: ['admin'],
    nav: [{ view: 'crm-settings', label: 'CRM Settings', icon: 'settings', where: 'user', menuOrder: 2 }],
    meta: { 'crm-settings': { t: 'CRM Settings', s: 'Stages, workflows, rates and reasons — yours to change' } },
    state: st,

    onEnter() {
      const me = RWG.auth.currentUser();
      if (!SD().isStarted()) SD().init(me, RWG.app.renderMain);
      // The categories tab counts how many tasks wear each one, and the
      // published list arrives on the tasks listener.
      if (RWG.tasks && !RWG.tasks.isStarted()) RWG.tasks.init(me, RWG.app.renderMain);
      P().init();
      if (W()) W().init();
    },

    onInput(e) { applyEdit(e.target); },
    onChange(e) { if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox') applyEdit(e.target); },

    actions: {
      'set-tab': (el) => { st.tab = el.dataset.tab; RWG.app.renderMain(); },
      'set-pl': (el) => { st.pl = el.dataset.pl; RWG.app.renderMain(); },
      'set-discard': (el) => {
        const w = el.dataset.which;
        if (w === 'p') st.dP = null;
        if (w === 'w') st.dW = null;
        if (w === 'r') st.dR = null;
        if (w === 'c') st.dC = null;
        st.dirty[w] = false;
        RWG.app.renderMain();
      },

      // task categories
      'set-cat-add': () => { draftC().push('New category'); markDirty('c'); RWG.app.renderMain(); },
      'set-cat-del': (el) => {
        draftC().splice(Number(el.dataset.i), 1);
        markDirty('c'); RWG.app.renderMain();
      },
      'set-save-cat': () => {
        // Trim, drop blanks, de-duplicate case-insensitively — the same rules
        // tags follow, so neither list can grow near-identical twins.
        const seen = {}, out = [];
        draftC().forEach(c => {
          const v = String(c || '').trim().replace(/\s+/g, ' ');
          const k = v.toLowerCase();
          if (v && !seen[k]) { seen[k] = 1; out.push(v); }
        });
        saveDoc('taskcategories', out)
          .then(() => { st.dirty.c = false; st.dC = null; RWG.app.renderMain(); U().toast('Published — the whole team sees these categories now', true); })
          .catch(e => U().toast('Save failed: ' + (e && e.message)));
      },

      // pipelines
      'set-st-add': (el) => {
        const pl = draftP().pipelines.find(p => p.id === el.dataset.pl); if (!pl) return;
        const id = slug('new-stage', pl.stages.map(s => s.id));
        const t = tail(pl);
        pl.stages = working(pl).concat([{ id, label: 'New stage', bucket: 'Opened' }], t);
        markDirty('p'); RWG.app.renderMain();
      },
      'set-st-del': (el) => {
        const n = liveCount(el.dataset.pl, el.dataset.id);
        if (n > 0) { remapModal(el.dataset.pl, el.dataset.id, n); return; }
        const pl = draftP().pipelines.find(p => p.id === el.dataset.pl); if (!pl) return;
        pl.stages = pl.stages.filter(s => s.id !== el.dataset.id);
        markDirty('p'); RWG.app.renderMain();
      },
      'set-st-remap': (el) => {
        const to = (document.getElementById('set-remap-to') || {}).value; if (!to) return;
        const moves = SD().cases().filter(c =>
          (c.state === 'Opened' || c.state === 'Submitted') && !c.closedAt
          && P().pipelineForProduct(c.product).id === el.dataset.pl
          && P().stageForCase(c) === el.dataset.id);
        Promise.all(moves.map(c => SD().saveCase({ recordId: c.recordId, stageId: to })))
          .then(() => {
            const pl = draftP().pipelines.find(p => p.id === el.dataset.pl);
            if (pl) pl.stages = pl.stages.filter(s => s.id !== el.dataset.id);
            markDirty('p');
            mount().innerHTML = '';
            RWG.app.renderMain();
            U().toast(moves.length + ' case' + (moves.length === 1 ? '' : 's') + ' moved — save to publish the removal', true);
          })
          .catch(err => U().toast('Could not move: ' + err.message));
      },
      'set-save-pl': () => {
        const d = draftP();
        for (const pl of d.pipelines) if (pl.stages.some(s => !String(s.label || '').trim())) { U().toast('Every stage needs a name'); return; }
        if ((d.lostReasons || []).some(r => !String(r || '').trim())) { U().toast('Blank lost reason — name it or remove it'); return; }
        saveDoc('pipelines', d)
          .then(() => { st.dirty.p = false; st.dP = null; RWG.app.renderMain(); U().toast('Published — the whole team sees it now', true); })
          .catch(err => U().toast('Could not save: ' + err.message));
      },

      // lost reasons (same doc as pipelines)
      'set-lr-add': () => { draftP().lostReasons.push(''); markDirty('p'); RWG.app.renderMain(); },
      'set-lr-del': (el) => { draftP().lostReasons.splice(Number(el.dataset.i), 1); markDirty('p'); RWG.app.renderMain(); },

      // workflows
      'set-wf-pick': (el) => { st.tplId = el.dataset.id; RWG.app.renderMain(); },
      'set-wf-add': () => {
        const d = draftW();
        const id = slug('template', d.templates.map(t => t.id));
        d.templates.push({ id, name: 'New workflow', trigger: null, related: 'case', steps: [] });
        st.tplId = id; markDirty('w'); RWG.app.renderMain();
      },
      'set-wf-del': (el) => {
        const d = draftW();
        d.templates = d.templates.filter(t => t.id !== el.dataset.id);
        st.tplId = d.templates.length ? d.templates[0].id : null;
        markDirty('w'); RWG.app.renderMain();
      },
      'set-wf-step-add': () => {
        const tpl = draftW().templates.find(t => t.id === st.tplId); if (!tpl) return;
        const id = slug('step', tpl.steps.map(s => s.id));
        const last = tpl.steps[tpl.steps.length - 1];
        tpl.steps.push({ id, title: '', owner: 'casemanager', dueDays: last ? (Number(last.dueDays) || 0) + 1 : 1 });
        markDirty('w'); RWG.app.renderMain();
      },
      'set-wf-step-del': (el) => {
        const tpl = draftW().templates.find(t => t.id === st.tplId); if (!tpl) return;
        tpl.steps = tpl.steps.filter(s => s.id !== el.dataset.id);
        markDirty('w'); RWG.app.renderMain();
      },
      'set-save-wf': () => {
        const d = draftW();
        // The picker preselects the case manager by NAME-match even when no
        // uid is pinned — so the screen can look done while nothing was
        // written, and every agent session still fails to resolve her.
        // Saving pins whoever the picker shows. What you see is what holds.
        const cmSel = document.querySelector
          ? document.querySelector('select[data-set="wf"][data-sf="casemanager"]') : null;
        if (cmSel && cmSel.value && !d.caseManagerUid) {
          const u = D().user(cmSel.value);
          d.caseManagerUid = cmSel.value;
          d.caseManagerName = (u && u.name) || d.caseManagerName;
        }
        for (const t of d.templates) {
          if (!String(t.name || '').trim()) { U().toast('Every template needs a name'); return; }
          if (!t.steps.length) { U().toast('“' + t.name + '” has no steps — add some or delete it'); return; }
          if (t.steps.some(s => !String(s.title || '').trim())) { U().toast('“' + t.name + '” has an unnamed step'); return; }
        }
        saveDoc('workflows', d)
          .then(() => { st.dirty.w = false; st.dW = null; RWG.app.renderMain(); U().toast('Published — future launches use the new steps', true); })
          .catch(err => U().toast('Could not save: ' + err.message));
      },

      // rates
      'set-save-rates': () => {
        saveDoc('rates', draftR())
          .then(() => { st.dirty.r = false; st.dR = null; RWG.app.renderMain(); U().toast('Published — cases without their own rate follow the new defaults', true); })
          .catch(err => U().toast('Could not save: ' + err.message));
      }
    },

    render(view, user, ctx) {
      if (!ctx.isAdmin) return `<div class="empty" style="padding:60px"><div class="ec">🔒</div><h3>Partners only</h3></div>`;
      return screenHtml();
    }
  });
})();
