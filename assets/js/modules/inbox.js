/* ============================================================
   RWG Platform — Partner inbox + the close review (phase 2)

   The one place everything that needs a partner lands:
     · cases pushed to Won, waiting for verification (with the cost
       of delay in dollars, and an age so nothing sits quietly)
     · advisor-marked losses with their reasons — visibility only,
       losses stay an advisor decision
     · the lost-reason rollup for the last 90 days

   The close review confirms six things at the only moment they are
   all finally known: the final money, the rate actually paid, the
   credit split, the renewal figure, the week it closes into, and
   that it is recorded in A360. Confirming writes the closed stamp.
   A partner closing their own case lands here in the same motion.

   Splits live in their OWN collection (splits/{caseId}) because
   Firestore rules are per-document and only partners may see the
   percentages. This module is the only reader and writer.

   Partner = admin role for now; the finer role split is a later
   phase and changes nothing structural here.
   ============================================================ */
window.RWG = window.RWG || {};

(function () {
  const SD = () => RWG.scorecardData;
  const SC = () => RWG.scorecard;
  const P  = () => RWG.pipelines;
  const H  = () => RWG.hh;
  const D  = () => RWG.data;
  const U  = () => RWG.ui;
  const esc = (s) => U().esc(s);
  const db = () => RWG.fb.db;
  const dayMs = 86400000;

  const st = { reviewId: null, form: null, formId: null, splits: null, splitsId: null };

  const pending = () => SD().isStarted() ? SD().cases().filter(c => c.pendingClose && !c.closedAt) : [];
  const daysSince = (iso) => iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / dayMs)) : 0;
  const isAdminUid = (uid) => { const u = D().user(uid); return !!u && u.role === 'admin'; };

  // ── splits (partner-only collection; defaults from the case) ──
  function defaultSplits(c) {
    const entries = [{ uid: c.agentUid, name: c.agentName || '', role: 'Owner', share: 100 }];
    (c.coCreditNames || []).forEach((nm, i) => {
      entries.push({ uid: (c.coCreditUids || [])[i] || null, name: nm, role: 'Co-credit', share: 0 });
    });
    return entries;
  }
  function loadSplits(caseId) {
    if (st.splitsId === caseId) return;
    st.splitsId = caseId; st.splits = null;
    db().collection('splits').doc(caseId).get()
      .then(d => {
        const c = SD().caseById(caseId);
        st.splits = (d.exists && d.data().entries && d.data().entries.length)
          ? d.data().entries : (c ? defaultSplits(c) : []);
        RWG.app.renderMain();
      })
      .catch(e => {
        console.error('load splits:', e && e.message);
        const c = SD().caseById(caseId);
        st.splits = c ? defaultSplits(c) : [];
        RWG.app.renderMain();
      });
  }
  function saveSplits(caseId, entries, locked) {
    const me = RWG.auth.currentUser();
    return db().collection('splits').doc(caseId).set({
      caseId: caseId, entries: entries, locked: !!locked,
      updatedAt: new Date().toISOString(), updatedBy: me && me.id
    });
  }
  const splitsTotal = () => (st.splits || []).reduce((n, e) => n + (Number(e.share) || 0), 0);

  // ── the review form (kept in state so repaints never eat typing) ──
  function initForm(c) {
    if (st.formId === c.recordId && st.form) return;
    st.formId = c.recordId;
    const rate = SC().caseRate(c);
    st.form = {
      amount: Number(c.amount) || 0,
      aum: Number(c.aum) || 0,
      ratePct: rate != null ? +(rate * 100).toFixed(4) : null,
      premium: SC().caseAnnualizedPremium(c) || 0,
      benefit: c.benefit != null ? Number(c.benefit) : '',
      renewal: c.renewalAnnual != null ? Number(c.renewalAnnual) : '',
      week: SC().weekEndingFor(c.pendingCloseAt || new Date()),
      a360: !!c.a360Recorded, note: ''
    };
  }
  const fam = (c) => {
    if (SC().FYC_PRODUCTS.indexOf(c.product) >= 0) return 'insurance';
    if (c.product === 'annuity') return 'annuity';
    if (c.product === 'inv') return 'inv';
    return 'flat';   // ltc, plan: the amount is the money
  };
  // The number on the confirm button — what this close is worth to the firm.
  function headline(c) {
    const f = st.form;
    const probe = Object.assign({}, c, {
      amount: f.amount, aum: f.aum,
      rate: f.ratePct != null && f.ratePct !== '' ? Number(f.ratePct) / 100 : null,
      premiumAnnual: f.premium || null
    });
    const d = SC().deriveCase(probe);
    return fam(c) === 'insurance' ? d.fyc : d.revenue;
  }

  // ── inbox screen ──────────────────────────────────────────
  function inboxHtml() {
    const rows = pending().sort((a, b) => daysSince(b.pendingCloseAt) - daysSince(a.pendingCloseAt));
    const heldBack = rows.reduce((n, c) => n + SC().deriveCase(c).revenue, 0);

    const pendTable = rows.length ? `
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Client</th><th>Product</th><th>Pushed by</th><th class="num">Worth</th><th>Waiting</th><th></th></tr></thead>
        <tbody>${rows.map(c => {
          const d = daysSince(c.pendingCloseAt);
          return `<tr>
            <td><div class="cell-name">${esc(c.clientName || '(no name)')}</div></td>
            <td>${esc(SC().productName(c.product))}</td>
            <td><span class="cell-sub" style="color:var(--ink)">${esc(c.agentName || '')}</span></td>
            <td class="num">${U().money(Math.round(SC().deriveCase(c).revenue))}</td>
            <td><span style="${d >= 3 ? 'color:var(--bad);font-weight:700' : ''}">${d === 0 ? 'today' : d + ' day' + (d === 1 ? '' : 's')}</span></td>
            <td class="num"><button class="btn btn-gold btn-sm" data-action="ib-review" data-id="${esc(c.recordId)}">Review</button></td>
          </tr>`;
        }).join('')}</tbody></table></div>
      <p class="muted" style="font-size:12.5px;padding:10px 2px 0">None of this counts on the scorecard until confirmed — ${U().money(Math.round(heldBack))} is sitting outside the numbers.</p>`
      : `<p class="muted" style="font-size:13.5px;padding:6px 2px">Nothing waiting. Cases pushed to Won land here.</p>`;

    // advisor-marked losses, last 30 days, newest first
    const losses = SD().cases()
      .filter(c => c.state === 'Lost' && c.lostAt && daysSince(c.lostAt) <= 30 && c.lostBy && !isAdminUid(c.lostBy))
      .sort((a, b) => Date.parse(b.lostAt) - Date.parse(a.lostAt));
    const lossTable = losses.length ? `
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Client</th><th>Product</th><th>By</th><th>Reason</th><th class="num">Was worth</th><th>When</th></tr></thead>
        <tbody>${losses.map(c => `<tr>
          <td><div class="cell-name">${esc(c.clientName || '')}</div></td>
          <td>${esc(SC().productName(c.product))}</td>
          <td><span class="cell-sub" style="color:var(--ink)">${esc((c.agentName || '').split(' ')[0])}</span></td>
          <td><span class="chip tier-low">${esc((c.lostReason || '').split(' — ')[0])}</span></td>
          <td class="num">${U().money(Math.round(SC().deriveCase(c).revenue))}</td>
          <td><span class="cell-sub">${U().fmtRelative(Date.parse(c.lostAt))}</span></td>
        </tr>`).join('')}</tbody></table></div>
      <p class="muted" style="font-size:12.5px;padding:10px 2px 0">Nothing to do here. Losses stay an advisor decision — they just stop being invisible.</p>`
      : `<p class="muted" style="font-size:13.5px;padding:6px 2px">No advisor-marked losses in the last 30 days.</p>`;

    // lost reasons, 90 days
    const recent = SD().cases().filter(c => c.state === 'Lost' && c.lostAt && daysSince(c.lostAt) <= 90);
    const byReason = {};
    recent.forEach(c => {
      const r = (c.lostReason || 'Other').split(' — ')[0];
      byReason[r] = byReason[r] || { n: 0, worth: 0 };
      byReason[r].n++; byReason[r].worth += SC().deriveCase(c).revenue;
    });
    const reasonRows = Object.keys(byReason).sort((a, b) => byReason[b].n - byReason[a].n)
      .map(r => `<tr><td>${esc(r)}</td><td class="num">${byReason[r].n}</td><td class="num"><span class="cell-sub">${U().money(Math.round(byReason[r].worth))}</span></td></tr>`).join('');

    return `
      <div class="card" style="margin-bottom:18px">
        <div class="card-head"><h3>Won, pending your verification</h3><span class="sub">${rows.length}</span></div>
        ${pendTable}
      </div>
      <div class="card" style="margin-bottom:18px">
        <div class="card-head"><h3>Marked lost by an advisor</h3><span class="sub">last 30 days</span></div>
        ${lossTable}
      </div>
      ${recent.length ? `<div class="card" style="max-width:520px">
        <div class="card-head"><h3>Lost reasons</h3><span class="sub">last 90 days · ${recent.length} case${recent.length === 1 ? '' : 's'}</span></div>
        <div class="table-wrap"><table class="data"><tbody>${reasonRows}</tbody></table></div>
      </div>` : ''}`;
  }

  // ── close review screen ───────────────────────────────────
  function moneyGrid(c) {
    const f = st.form;
    const family = fam(c);
    const applied = c.applied || {
      amount: c.amount || 0, aum: c.aum || 0,
      rate: c.rate != null ? c.rate : null, premiumAnnual: c.premiumAnnual || null
    };
    const apRate = applied.rate != null && applied.rate > 0 ? applied.rate : SC().defaultRate(c.product);
    const row = (label, appliedVal, inputHtml) => `
      <div class="field-row" style="grid-template-columns:1fr 1fr 1fr;align-items:center;margin-bottom:10px">
        <span style="font-size:13.5px;color:var(--ink)">${label}</span>
        <input value="${esc(appliedVal)}" disabled style="opacity:.65">
        ${inputHtml}
      </div>`;
    const head = `
      <div class="field-row" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:6px">
        <span></span><label class="lbl">Applied for</label><label class="lbl">Final</label>
      </div>`;

    if (family === 'insurance') {
      const apPrem = applied.premiumAnnual > 0 ? applied.premiumAnnual : (apRate ? (applied.amount || 0) / apRate : 0);
      return head
        + row('Annual premium', '$' + Math.round(apPrem).toLocaleString('en-US'),
          `<input id="cr-premium" type="number" step="any" value="${esc(f.premium)}">`)
        + row('Commission rate %', apRate != null ? +(apRate * 100).toFixed(2) + '%' : '—',
          `<input id="cr-rate" type="number" step="any" value="${esc(f.ratePct)}">`)
        + row('FYC', '$' + Math.round(applied.amount || 0).toLocaleString('en-US'),
          `<input id="cr-fyc" type="number" step="any" value="${esc(f.amount)}">`)
        + row('Benefit', c.benefit ? '$' + Number(c.benefit).toLocaleString('en-US') : '—',
          `<input id="cr-benefit" type="number" step="any" value="${esc(f.benefit)}" placeholder="death / DI / LTC benefit">`)
        + `<p class="hint" style="margin-top:2px">Edit any two of premium, rate and FYC — the third follows. Product default is ${+(SC().defaultRate(c.product) * 100).toFixed(0)}%.</p>`;
    }
    if (family === 'annuity') {
      return head
        + row('Deposit', '$' + Math.round(applied.amount || 0).toLocaleString('en-US'),
          `<input id="cr-amount" type="number" step="any" value="${esc(f.amount)}">`)
        + row('Commission rate %', apRate != null ? +(apRate * 100).toFixed(2) + '%' : '—',
          `<input id="cr-rate" type="number" step="any" value="${esc(f.ratePct)}">`);
    }
    if (family === 'inv') {
      return head
        + row('Assets placed', '$' + Math.round(applied.aum || 0).toLocaleString('en-US'),
          `<input id="cr-aum" type="number" step="any" value="${esc(f.aum)}">`)
        + row('Annual fee rate %', apRate != null ? +(apRate * 100).toFixed(2) + '%' : '—',
          `<input id="cr-rate" type="number" step="any" value="${esc(f.ratePct)}">`)
        + `<p class="hint">A 401(k) is typically 0.17%, a regular account 0.70% — type what this one actually pays.</p>`;
    }
    return head
      + row(c.product === 'plan' ? 'Planning fee' : 'Commission earned',
          '$' + Math.round(applied.amount || 0).toLocaleString('en-US'),
          `<input id="cr-amount" type="number" step="any" value="${esc(f.amount)}">`);
  }

  function reviewHtml(ctx) {
    const c = st.reviewId && SD().caseById(st.reviewId);
    if (!c) return `<div class="empty" style="padding:60px"><div class="ec">🧭</div><h3>Nothing to review</h3>
      <button class="btn btn-navy btn-sm" data-action="nav" data-view="inbox" style="margin-top:10px">Back to the inbox</button></div>`;
    initForm(c);
    loadSplits(c.recordId);
    const f = st.form;
    const hh = c.householdId && H().isStarted() ? H().household(c.householdId) : null;
    const already = !!c.closedAt;
    const worth = headline(c);
    const family = fam(c);

    // splits card
    const total = splitsTotal();
    const users = D().users().filter(u => u.status === 'active');
    const inSplits = {}; (st.splits || []).forEach(e => { if (e.uid) inSplits[e.uid] = 1; });
    const addOpts = users.filter(u => !inSplits[u.id])
      .map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');
    const splitRows = st.splits === null
      ? `<p class="muted" style="font-size:13px;padding:8px 2px">Loading splits…</p>`
      : `<div class="table-wrap"><table class="data">
          <thead><tr><th>Person</th><th>Role</th><th class="num">Share %</th><th></th></tr></thead>
          <tbody>
            ${st.splits.map((e2, i) => `<tr>
              <td><span class="cell-name">${esc(e2.name)}</span></td>
              <td><span class="cell-sub">${esc(e2.role || '')}</span></td>
              <td class="num"><input id="cr-sp-${i}" type="number" step="any" value="${esc(e2.share)}" style="width:80px;text-align:right;padding:6px 8px"></td>
              <td class="num">${st.splits.length > 1 ? `<button class="btn btn-quiet btn-sm" data-action="ib-sp-del" data-idx="${i}">✕</button>` : ''}</td>
            </tr>`).join('')}
            <tr style="background:var(--field)">
              <td colspan="2" style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:700">Total</td>
              <td class="num" style="font-weight:700;color:${Math.abs(total - 100) < 0.01 ? 'var(--good)' : 'var(--bad)'}">${+total.toFixed(2)}%</td><td></td>
            </tr>
          </tbody></table></div>
        ${addOpts ? `<div class="flex" style="gap:8px;padding:10px 2px 0;align-items:center">
          <select id="cr-sp-add" style="width:auto;min-width:170px">${addOpts}</select>
          <button class="btn btn-ghost btn-sm" data-action="ib-sp-add">＋ Add to split</button>
          <span class="cell-sub">0% is fine — it records involvement without money.</span>
        </div>` : ''}`;

    const weeks = SC().fridaysOfYear(Number(f.week.slice(0, 4)));
    const weekOpts = weeks.map(w => `<option value="${w}" ${w === f.week ? 'selected' : ''}>Week ending ${w}${w === SC().currentWeekEnding() ? ' (this week)' : ''}</option>`).join('');

    return `
      <button class="btn btn-quiet btn-sm" data-action="nav" data-view="inbox" style="margin-bottom:14px">← Inbox</button>

      <div class="card" style="margin-bottom:16px">
        <div class="card-head" style="align-items:flex-start">
          <div>
            <h3 style="font-size:22px">${esc(c.clientName || '(no name)')}</h3>
            <div class="tag-row" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px">
              <span class="pill-soft">${esc(SC().productName(c.product))}</span>
              ${hh ? `<button class="pill-soft" style="cursor:pointer" data-action="hh-goto" data-id="${esc(hh.id)}">${U().icon('household','ic-inline')} ${esc(hh.name)}</button>` : ''}
              <span class="pill-soft">Pushed by ${esc(c.agentName || '—')}${c.pendingCloseAt ? ' · ' + U().fmtRelative(Date.parse(c.pendingCloseAt)) : ''}</span>
              ${already ? '<span class="chip tier-high">Already closed — editing the record</span>' : '<span class="chip tier-medium">Pending verification</span>'}
            </div>
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start" class="cr-grid">
        <div class="card">
          <div class="card-head"><h3>1 · The money</h3><span class="sub">applied vs final</span></div>
          ${moneyGrid(c)}
        </div>
        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="card">
            <div class="card-head"><h3>2 · Credit split</h3><span class="sub">partners only · locks on confirm</span></div>
            ${splitRows}
          </div>
          <div class="card">
            <div class="card-head"><h3>3 · Renewal</h3><span class="sub">reporting only, never counted</span></div>
            <div class="field-group" style="max-width:240px">
              <label class="lbl">Annual renewal</label>
              <input id="cr-renewal" type="number" step="any" value="${esc(f.renewal)}" placeholder="$ / year, for the recurring book">
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-head"><h3>4 · The week, and the record</h3></div>
        <div class="field-row" style="grid-template-columns:1fr 1fr 1fr;gap:16px">
          <div class="field-group">
            <label class="lbl">Closes into</label>
            <select id="cr-week" ${already ? 'disabled' : ''}>${weekOpts}</select>
            <div class="hint">${already ? 'Already stamped — the week cannot move.' : 'Defaults to when it was pushed. Permanent once confirmed.'}</div>
          </div>
          <div class="field-group">
            <label class="lbl">Recorded in A360</label>
            <label style="display:flex;align-items:center;gap:9px;font-size:13.5px;padding-top:9px">
              <input type="checkbox" id="cr-a360" style="width:auto" ${f.a360 ? 'checked' : ''}> Application and policy on file
            </label>
            <div class="hint">Nothing connects the two systems — this is the checkpoint.</div>
          </div>
          <div class="field-group">
            <label class="lbl">Note for the record</label>
            <input id="cr-note" value="${esc(f.note)}" placeholder="e.g. Table B, face reduced">
          </div>
        </div>
      </div>

      <div class="flex" style="gap:10px;margin-top:16px;align-items:center;flex-wrap:wrap">
        ${!already ? `<button class="btn btn-ghost" data-action="ib-sendback" data-id="${esc(c.recordId)}">Send back to ${esc((c.agentName || 'the advisor').split(' ')[0])}</button>
        <button class="btn btn-ghost" data-action="pl-lost" data-id="${esc(c.recordId)}">Mark lost instead</button>` : ''}
        <span class="topbar-spacer"></span>
        <span class="cell-sub">Confirming writes the closed stamp and locks the split.</span>
        <button class="btn btn-gold" data-action="ib-confirm" data-id="${esc(c.recordId)}"
          ${st.splits === null || Math.abs(total - 100) >= 0.01 ? 'disabled title="The split must total 100%"' : ''}>
          ${already ? 'Save changes' : 'Confirm and close'} · ${U().money(Math.round(worth))}</button>
      </div>`;
  }

  // ── the money triangle + typed-edit capture ───────────────
  function captureInput(e) {
    const f = st.form; if (!f) return;
    const id = e.target.id, v = e.target.value;
    const num = (x) => Number(x) || 0;
    const setVal = (elId, val) => { const el = document.getElementById(elId); if (el && el !== e.target) el.value = val; };
    if (id === 'cr-premium') { f.premium = num(v); if (f.ratePct) { f.amount = +(f.premium * f.ratePct / 100).toFixed(2); setVal('cr-fyc', f.amount); } }
    else if (id === 'cr-rate') {
      f.ratePct = v === '' ? null : Number(v);
      if (document.getElementById('cr-premium') && f.ratePct) { f.amount = +(f.premium * f.ratePct / 100).toFixed(2); setVal('cr-fyc', f.amount); }
    }
    else if (id === 'cr-fyc') { f.amount = num(v); if (f.ratePct) { f.premium = +(f.amount / (f.ratePct / 100)).toFixed(2); setVal('cr-premium', f.premium); } }
    else if (id === 'cr-amount') f.amount = num(v);
    else if (id === 'cr-aum') f.aum = num(v);
    else if (id === 'cr-benefit') f.benefit = v;
    else if (id === 'cr-renewal') f.renewal = v;
    else if (id === 'cr-note') f.note = v;
    else if (/^cr-sp-\d+$/.test(id)) { const i = Number(id.slice(6)); if (st.splits && st.splits[i]) st.splits[i].share = v === '' ? 0 : Number(v); updateConfirmButton(); return; }
    else return;
    updateConfirmButton();
  }
  function updateConfirmButton() {
    // keep the headline number and the split gate live without a repaint
    const c = st.reviewId && SD().caseById(st.reviewId); if (!c) return;
    const btn = document.querySelector('[data-action="ib-confirm"]'); if (!btn) return;
    const total = splitsTotal();
    const bad = st.splits === null || Math.abs(total - 100) >= 0.01;
    btn.disabled = bad;
    btn.title = bad ? 'The split must total 100%' : '';
    btn.innerHTML = (c.closedAt ? 'Save changes' : 'Confirm and close') + ' · ' + U().money(Math.round(headline(c)));
    // (the split-total row repaints on the next full render; the button is the live gate)
  }

  RWG.modules.register({
    id: 'inbox',
    title: 'Inbox',
    enabled: true,
    roles: ['admin'],
    nav: [{ view: 'inbox', label: 'Inbox', icon: 'today', badge: () => pending().length }],
    views: ['close-review'],
    meta: {
      inbox: { t: 'Partner inbox', s: 'What needs you, and what you should know' },
      'close-review': { t: 'Confirm and close', s: 'Six things, verified at the only moment they are all known' }
    },
    state: st,

    onEnter(view) {
      const me = RWG.auth.currentUser();
      if (!SD().isStarted()) SD().init(me, RWG.app.renderMain);
      if (!H().isStarted()) H().init(me, RWG.app.renderMain);
      P().init();
      // Onboarding auto-launches from the confirm — needs the tasks cache for its dedupe.
      if (RWG.tasks && !RWG.tasks.isStarted()) RWG.tasks.init(me, RWG.app.renderMain);
      if (RWG.wf) RWG.wf.init();
      if (view === 'close-review' && st.reviewId) loadSplits(st.reviewId);
    },

    onInput(e) { captureInput(e); },
    onChange(e) {
      if (e.target.id === 'cr-week' && st.form) st.form.week = e.target.value;
      if (e.target.id === 'cr-a360' && st.form) st.form.a360 = e.target.checked;
    },

    actions: {
      'ib-review': (el) => { st.reviewId = el.dataset.id; st.form = null; st.formId = null; RWG.app.nav('close-review'); },
      'ib-sendback': (el) => {
        SD().sendBack(el.dataset.id).then(() => {
          st.reviewId = null;
          RWG.app.nav('inbox');
          U().toast('Sent back — it returned to its last working stage', true);
        }).catch(err => U().toast(err.message));
      },
      'ib-sp-add': () => {
        const sel = document.getElementById('cr-sp-add'); if (!sel || !sel.value) return;
        const u = D().user(sel.value); if (!u) return;
        st.splits.push({ uid: u.id, name: u.name, role: 'Involved', share: 0 });
        RWG.app.renderMain();
      },
      'ib-sp-del': (el) => { st.splits.splice(Number(el.dataset.idx), 1); RWG.app.renderMain(); },
      'ib-confirm': (el) => {
        const c = SD().caseById(el.dataset.id); if (!c || !st.form) return;
        const f = st.form;
        if (st.splits === null || Math.abs(splitsTotal() - 100) >= 0.01) { U().toast('The split must total 100%'); return; }
        const fin = {
          amount: SC().usesAum(c.product) ? 0 : (Number(f.amount) || 0),
          aum: SC().usesAum(c.product) ? (Number(f.aum) || 0) : 0,
          rate: f.ratePct != null && f.ratePct !== '' && Number(f.ratePct) > 0 ? Number(f.ratePct) / 100 : null,
          premiumAnnual: fam(c) === 'insurance' && Number(f.premium) > 0 ? Number(f.premium) : null,
          benefit: f.benefit !== '' && f.benefit != null ? Number(f.benefit) : null,
          renewalAnnual: f.renewal !== '' && f.renewal != null ? Number(f.renewal) : null,
          closedWeek: f.week, a360: !!f.a360, note: (f.note || '').trim() || null
        };
        SD().confirmClose(c.recordId, fin)
          .then(() => saveSplits(c.recordId, st.splits, true))
          .then(() => {
            const worth = U().money(Math.round(headline(c)));
            st.reviewId = null; st.form = null; st.formId = null; st.splits = null; st.splitsId = null;
            RWG.app.nav('inbox');
            U().toast('Closed and confirmed · ' + worth, true);
            // Nothing launches without asking: the close offers Policy
            // Delivery and Onboarding through the same prompt as the board.
            if (RWG.wfPrompt) RWG.wfPrompt(c.recordId);
          })
          .catch(err => U().toast('Could not confirm: ' + err.message));
      }
    },

    render(view, user, ctx) {
      if (!ctx.isAdmin) return `<div class="empty" style="padding:60px"><div class="ec">🔒</div><h3>Partners only</h3></div>`;
      if (!SD().isStarted()) return `<div class="empty" style="padding:60px"><div class="ec">⏳</div><h3>Loading…</h3></div>`;
      return view === 'close-review' ? reviewHtml(ctx) : inboxHtml();
    }
  });
})();
