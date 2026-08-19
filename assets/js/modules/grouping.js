/* ============================================================
   RWG Platform — Group the book (one-time grouping assistant)

   Every existing scorecard case carries the client's name as loose
   text. This screen proposes a household for each distinct client,
   matches the name against leads and contacts, and hands the owner
   a confirm-or-fix list instead of a blank page.

   Admin-only, reached from the Households view. It retires itself:
   once every case has a householdId, the entry button disappears.

   Reads cases (RWG.scorecardData), leads (RWG.data) and the spine
   (RWG.hh). All writes go through RWG.hh.createFromGrouping — one
   atomic batch per confirmed group.
   ============================================================ */
window.RWG = window.RWG || {};

(function () {
  const H = () => RWG.hh;
  const U = () => RWG.ui;
  const D = () => RWG.data;
  const SD = () => RWG.scorecardData;
  const SC = () => RWG.scorecard;
  const esc = (s) => U().esc(s);

  const st = { props: null, busy: false };

  // ── name normalisation ─────────────────────────────────────
  // Accent-folded, lowercased, "LAST, FIRST" flipped, punctuation out.
  const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  function nameKey(s) {
    let t = fold(s).toLowerCase().replace(/[^a-z\s,]/g, ' ').replace(/\s+/g, ' ').trim();
    if (t.indexOf(',') >= 0) { const p = t.split(','); t = (p[1] + ' ' + p[0]).trim(); }
    return t.replace(/,/g, '').replace(/\s+/g, ' ').trim();
  }
  const titleCase = (s) => String(s || '').toLowerCase().replace(/(^|[\s'-])[a-z]/g, m => m.toUpperCase());
  function parseName(clientName) {
    let raw = String(clientName || '').trim();
    if (raw.indexOf(',') >= 0) { const p = raw.split(','); raw = (p[1] + ' ' + p[0]).replace(/\s+/g, ' ').trim(); }
    const toks = raw.split(/\s+/).filter(Boolean);
    return {
      firstName: titleCase(toks[0] || ''),
      lastName: titleCase(toks.slice(1).join(' ') || ''),
      display: titleCase(raw)
    };
  }
  const lastKey = (k) => k.split(' ').slice(1).join(' ');
  const initialKey = (k) => { const t = k.split(' '); return t.length > 1 ? lastKey(k) + '|' + t[0][0] : ''; };

  // ── building the proposals ────────────────────────────────
  const TIER_ORDER = { 'in-book': 0, 'high': 1, 'ambiguous': 2, 'medium': 3, 'name-only': 4 };
  const TIER_META = {
    'in-book':   { chip: 'tier-high',   label: 'Already a contact' },
    'high':      { chip: 'tier-gold',   label: 'Lead match · exact' },
    'ambiguous': { chip: 'tier-medium', label: 'Two leads match — pick one' },
    'medium':    { chip: 'tier-medium', label: 'Lead match · probable' },
    'name-only': { chip: 'tier-low',    label: 'Name only — no contact info found' }
  };

  function unattachedCases() {
    return SD().isStarted() ? SD().cases().filter(c => !c.householdId) : [];
  }

  function buildProposals() {
    const leads = D().leads().filter(l => !l.householdId);
    const byName = {}, byInitial = {}, byLast = {};
    leads.forEach(l => {
      const k = nameKey(D().fullName(l)); if (!k) return;
      (byName[k] = byName[k] || []).push(l);
      const ik = initialKey(k); if (ik) (byInitial[ik] = byInitial[ik] || []).push(l);
      const lk = lastKey(k); if (lk) (byLast[lk] = byLast[lk] || []).push(l);
    });
    const contactByName = {};
    H().contacts().forEach(c => {
      const k = nameKey(H().contactName(c)); if (k) contactByName[k] = contactByName[k] || c;
    });

    // one group per distinct client name across the unattached cases
    const groups = {};
    unattachedCases().forEach(c => {
      const k = nameKey(c.clientName) || '(no name)';
      (groups[k] = groups[k] || []).push(c);
    });

    const props = Object.keys(groups).map(k => {
      const cases = groups[k].sort((a, b) => String(b.openedWeek).localeCompare(String(a.openedWeek)));
      const parsed = parseName(cases[0].clientName);
      const p = {
        key: k, cases: cases,
        name: parsed.lastName ? parsed.lastName + ' Household' : (parsed.firstName ? parsed.firstName + ' Household' : ''),
        person: parsed,
        tier: 'name-only', lead: null, candidates: null, contact: null, hint: '',
        advisorUid: cases[0].agentUid || null,
        source: SC().sourceLabel(cases[0].source) || '',
        mergedInto: '', relationship: 'Primary client',
        done: false, doneName: '', skipped: false, error: ''
      };
      if (k === '(no name)') { p.name = ''; p.person = { firstName: '', lastName: '', display: '(no name on the case)' }; return p; }

      const inBook = contactByName[k];
      if (inBook && inBook.householdId && H().household(inBook.householdId)) {
        p.tier = 'in-book'; p.contact = inBook; p.mergedInto = inBook.householdId;
        return p;
      }
      const exact = byName[k] || [];
      if (exact.length === 1) { p.tier = 'high'; p.lead = exact[0]; p.advisorUid = exact[0].assignedTo || p.advisorUid; p.source = exact[0].listName || p.source; return p; }
      if (exact.length > 1) { p.tier = 'ambiguous'; p.candidates = exact; p.lead = exact[0]; return p; }
      const ik = initialKey(k);
      const init = ik ? (byInitial[ik] || []).filter(l => nameKey(D().fullName(l)) !== k) : [];
      if (init.length === 1) { p.tier = 'medium'; p.lead = init[0]; p.advisorUid = init[0].assignedTo || p.advisorUid; return p; }
      const lk = lastKey(k);
      const surname = lk ? (byLast[lk] || []) : [];
      if (surname.length === 1) p.hint = 'Same surname in the leads: ' + D().fullName(surname[0]) + ' — family?';
      return p;
    });

    props.sort((a, b) => (TIER_ORDER[a.tier] - TIER_ORDER[b.tier]) || a.key.localeCompare(b.key));
    return props;
  }

  // ── confirming one proposal ───────────────────────────────
  function confirmProposal(p) {
    if (p.done || st.busy) return Promise.resolve();
    const caseIds = p.cases.map(c => c.recordId);
    let opts;
    if (p.mergedInto) {
      // joining an existing household. Skip the person if they ARE the matched contact.
      opts = { householdId: p.mergedInto, caseIds };
      if (!p.contact) {
        if (p.lead) opts.fromLeadId = p.lead.id;
        else opts.person = { firstName: p.person.firstName, lastName: p.person.lastName };
        opts.relationship = p.relationship || 'Spouse';
      }
    } else {
      if (!p.name.trim()) { p.error = 'Give the household a name first.'; return Promise.resolve(); }
      opts = {
        household: {
          name: p.name.trim(),
          advisorUid: p.advisorUid || null,
          advisorName: (D().user(p.advisorUid) || {}).name || '',
          source: p.source || ''
        },
        caseIds, relationship: 'Primary client'
      };
      if (p.lead) opts.fromLeadId = p.lead.id;
      else opts.person = { firstName: p.person.firstName, lastName: p.person.lastName };
    }
    p.error = '';
    return H().createFromGrouping(opts)
      .then(res => { p.done = true; p.doneHouseholdId = res.householdId; p.doneName = p.mergedInto ? (H().household(p.mergedInto) || {}).name : p.name; })
      .catch(e => { p.error = e.message; });
  }

  // ── rendering ─────────────────────────────────────────────
  function advisorOptions(selUid) {
    return D().users().filter(u => u.status === 'active')
      .map(u => `<option value="${esc(u.id)}" ${u.id === selUid ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
  }

  function caseRow(c) {
    const sc = SC();
    const put = sc.placed(c);
    return `<tr>
      <td><span class="cell-sub" style="color:var(--ink)">${esc(c.clientName || '(no name)')}</span></td>
      <td>${esc(sc.productName(c.product) || c.product || '')}</td>
      <td><span class="pill-soft">${esc(c.state || '')}</span></td>
      <td class="num">${put == null ? '—' : U().money(put)}</td>
      <td><span class="cell-sub">${esc(c.agentName || '')}</span></td>
      <td><span class="cell-sub">${esc(c.openedWeek || '')}</span></td>
    </tr>`;
  }

  function matchPanel(p, i) {
    if (p.tier === 'in-book') {
      const hh = H().household(p.contact.householdId);
      return `<div class="card tight" style="background:rgba(46,125,91,.06);border-color:rgba(46,125,91,.3)">
        <b>${esc(H().contactName(p.contact))}</b> is already in the book — these cases attach to
        <b>${esc(hh ? hh.name : '?')}</b>. Nothing new is created.</div>`;
    }
    if (p.tier === 'ambiguous') {
      const opts = p.candidates.map((l, ci) => `<option value="${ci}" ${p.lead === l ? 'selected' : ''}>${esc(D().fullName(l))} · ${esc(l.employer || l.listName || '')} · ${esc(l.stage)}</option>`).join('');
      return `<div class="card tight" style="background:rgba(176,105,31,.07);border-color:rgba(176,105,31,.3)">
        <label class="lbl">Two leads carry this exact name — which is this client?</label>
        <select id="gr-cand-${i}">${opts}</select></div>`;
    }
    if (p.lead) {
      const l = p.lead;
      return `<div class="card tight" style="background:rgba(194,161,77,.07);border-color:rgba(194,161,77,.35)">
        Matched lead: <b>${esc(D().fullName(l))}</b>
        <span class="cell-sub" style="margin-left:6px">${esc(l.phone || 'no phone')} · ${esc(l.email || 'no email')} · ${esc(l.employer || '')}</span>
        <div class="cell-sub" style="margin-top:4px">Their phone, email and FRS profile carry onto the new contact, and their call history stays reachable.
        ${p.tier === 'medium' ? '<b style="color:var(--warn)"> Probable match (first-initial) — check it is the same person.</b>' : ''}</div></div>`;
    }
    return `<div class="card tight" style="background:rgba(92,107,126,.06)">
      No lead or contact matches this name — the household starts with just the name, and contact details can be added later.
      ${p.hint ? `<div class="cell-sub" style="margin-top:4px;color:var(--warn)">${esc(p.hint)}</div>` : ''}</div>`;
  }

  function proposalCard(p, i) {
    if (p.done) {
      return `<div class="card" style="margin-bottom:12px;padding:14px 22px;background:rgba(46,125,91,.05);border-color:rgba(46,125,91,.3)">
        <div class="flex" style="align-items:center;gap:10px">
          <span class="chip tier-high">✓ Grouped</span>
          <b>${esc(p.doneName || p.name)}</b>
          <span class="cell-sub">${p.cases.length} case${p.cases.length === 1 ? '' : 's'} attached</span>
          <span class="topbar-spacer"></span>
          <button class="btn btn-quiet btn-sm" data-action="gr-view" data-id="${esc(p.doneHouseholdId || '')}">View →</button>
        </div></div>`;
    }
    if (p.skipped) {
      return `<div class="card" style="margin-bottom:12px;padding:12px 22px;opacity:.6">
        <div class="flex" style="align-items:center;gap:10px">
          <span class="pill-soft">Skipped</span><b>${esc(p.person.display)}</b>
          <span class="cell-sub">${p.cases.length} case${p.cases.length === 1 ? '' : 's'}</span>
          <span class="topbar-spacer"></span>
          <button class="btn btn-quiet btn-sm" data-action="gr-unskip" data-idx="${i}">Bring back</button>
        </div></div>`;
    }
    const t = TIER_META[p.tier];
    const mergeTargets = H().households().slice().sort((a, b) => a.name.localeCompare(b.name))
      .map(h => `<option value="${esc(h.id)}" ${p.mergedInto === h.id ? 'selected' : ''}>${esc(h.name)}</option>`).join('');
    const joining = !!p.mergedInto;
    return `<div class="card" style="margin-bottom:14px">
      <div class="card-head" style="align-items:center">
        <span class="chip ${t.chip}">${t.label}</span>
        <h3 style="font-size:17px">${esc(p.person.display)}</h3>
        <span class="sub">${p.cases.length} case${p.cases.length === 1 ? '' : 's'}</span>
        <span class="topbar-spacer"></span>
        <button class="btn btn-quiet btn-sm" data-action="gr-skip" data-idx="${i}">Skip for now</button>
      </div>

      <div class="table-wrap" style="margin-bottom:12px"><table class="data">
        <thead><tr><th>Case</th><th>Product</th><th>Stage</th><th class="num">Amount/AUM</th><th>Agent</th><th>Opened</th></tr></thead>
        <tbody>${p.cases.map(caseRow).join('')}</tbody></table></div>

      ${matchPanel(p, i)}

      <div class="field-row" style="margin-top:14px;${joining ? 'opacity:.45;pointer-events:none' : ''}">
        <div class="field-group"><label class="lbl">Household name</label>
          <input id="gr-name-${i}" value="${esc(p.name)}"></div>
        <div class="field-group"><label class="lbl">Advisor</label>
          <select id="gr-adv-${i}">${advisorOptions(p.advisorUid)}</select></div>
      </div>
      ${p.tier !== 'in-book' && mergeTargets ? `
      <div class="field-group">
        <label class="lbl">…or attach to an existing household instead</label>
        <select id="gr-merge-${i}"><option value="">— No, create "${esc(p.name || '…')}" —</option>${mergeTargets}</select>
        ${joining ? '<div class="hint">They join that household (as Spouse by default — editable on the person afterwards).</div>' : ''}
      </div>` : ''}
      ${p.error ? `<div class="hint" style="color:var(--bad);font-weight:600;margin-bottom:8px">${esc(p.error)}</div>` : ''}
      <div class="flex" style="justify-content:flex-end;gap:10px">
        <button class="btn btn-gold btn-sm" data-action="gr-confirm" data-idx="${i}">
          ${joining ? 'Attach to household ✓' : 'Create & attach ✓'}</button>
      </div>
    </div>`;
  }

  function screenHtml() {
    const props = st.props || [];
    const open = props.filter(p => !p.done && !p.skipped);
    const casesTotal = SD().isStarted() ? SD().cases().length : 0;
    const attached = SD().isStarted() ? SD().cases().filter(c => !!c.householdId).length : 0;
    const easy = open.filter(p => p.tier === 'in-book' || p.tier === 'high').length;

    if (!props.length) {
      return `<div class="empty" style="padding:60px"><div class="ec">🎉</div>
        <h3>The whole book is grouped</h3>
        <p>Every case is attached to a household. Phase 2 builds on exactly this.</p>
        <button class="btn btn-navy" data-action="nav" data-view="households" style="margin-top:10px">Go to Households</button></div>`;
    }

    return `
      <button class="btn btn-quiet btn-sm" data-action="nav" data-view="households" style="margin-bottom:14px">← Households</button>
      <div class="stat-row" style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:18px">
        <div class="card" style="padding:16px 20px"><div class="eyebrow"><span>Cases attached</span></div>
          <div class="serif" style="font-size:30px;color:var(--navy)">${attached} <span style="font-size:15px;color:var(--muted)">of ${casesTotal}</span></div></div>
        <div class="card" style="padding:16px 20px"><div class="eyebrow"><span>Groups to review</span></div>
          <div class="serif" style="font-size:30px;color:var(--navy)">${open.length}</div></div>
        <div class="card" style="padding:16px 20px"><div class="eyebrow"><span>Confident matches</span></div>
          <div class="serif" style="font-size:30px;color:var(--navy)">${easy}</div>
          ${easy ? `<button class="btn btn-gold btn-sm" data-action="gr-bulk" style="margin-top:8px" ${st.busy ? 'disabled' : ''}>${st.busy ? 'Working…' : 'Confirm all ' + easy + ' ✓'}</button>` : ''}</div>
      </div>
      <p class="muted" style="font-size:13px;margin:0 0 16px;max-width:70ch">
        Easiest first. Fix a name, switch the advisor, or attach to an existing household —
        then confirm. Nothing happens to a group until you confirm it, and a wrong grouping
        is repairable afterwards (the household record is editable).
        <button class="btn btn-quiet btn-sm" data-action="gr-rebuild" style="margin-left:6px">↻ Refresh proposals</button></p>
      ${props.map((p, i) => proposalCard(p, i)).join('')}`;
  }

  // keep typed edits across the repaints that snapshots trigger
  function captureEdits(e) {
    const m = /^gr-(name|adv|merge|cand)-(\d+)$/.exec(e.target.id || '');
    if (!m || !st.props) return;
    const p = st.props[Number(m[2])]; if (!p) return;
    if (m[1] === 'name') p.name = e.target.value;
    if (m[1] === 'adv') p.advisorUid = e.target.value;
    if (m[1] === 'merge') { p.mergedInto = e.target.value; RWG.app.renderMain(); }
    if (m[1] === 'cand') { p.lead = p.candidates[Number(e.target.value)] || p.lead; p.advisorUid = p.lead.assignedTo || p.advisorUid; }
  }

  RWG.modules.register({
    id: 'grouping',
    title: 'Group the book',
    enabled: true,
    roles: ['admin'],
    views: ['grouping'],
    meta: { grouping: { t: 'Group the book', s: 'Attach every existing case to a household — confirm or fix each match' } },
    state: st,

    onEnter() {
      const me = RWG.auth.currentUser();
      if (!H().isStarted()) H().init(me, RWG.app.renderMain);
      if (!SD().isStarted()) SD().init(me, RWG.app.renderMain);
      if (!st.props) st.props = buildProposals();
    },

    onInput(e) { captureEdits(e); },
    onChange(e) { captureEdits(e); },

    actions: {
      'gr-rebuild': () => { st.props = buildProposals(); RWG.app.renderMain(); },
      'gr-skip':    (el) => { st.props[Number(el.dataset.idx)].skipped = true; RWG.app.renderMain(); },
      'gr-unskip':  (el) => { st.props[Number(el.dataset.idx)].skipped = false; RWG.app.renderMain(); },
      'gr-view':    (el) => {
        const hm = RWG.modules.get('households');
        if (hm) hm.state.currentId = el.dataset.id;
        RWG.app.nav('household');
      },
      'gr-confirm': (el) => {
        const p = st.props[Number(el.dataset.idx)]; if (!p) return;
        confirmProposal(p).then(() => {
          RWG.app.renderMain();
          if (p.done) U().toast(p.cases.length + ' case' + (p.cases.length === 1 ? '' : 's') + ' attached', true);
        });
      },
      // Confident matches only: already-a-contact attachments and exact
      // unique lead matches, confirmed one batch at a time, in order.
      'gr-bulk': () => {
        if (st.busy) return;
        st.busy = true; RWG.app.renderMain();
        const targets = st.props.filter(p => !p.done && !p.skipped && (p.tier === 'in-book' || p.tier === 'high'));
        targets.reduce((chain, p) => chain.then(() => confirmProposal(p)), Promise.resolve())
          .then(() => {
            st.busy = false;
            const ok = targets.filter(p => p.done).length;
            RWG.app.renderMain();
            U().toast(ok + ' of ' + targets.length + ' groups confirmed', true);
          });
      }
    },

    render(view, user, ctx) {
      if (!ctx.isAdmin) return `<div class="empty" style="padding:60px"><div class="ec">🔒</div><h3>Owner only</h3></div>`;
      if (!SD().isStarted() || !H().isStarted()) return `<div class="empty" style="padding:60px"><div class="ec">⏳</div><h3>Loading the book…</h3></div>`;
      return screenHtml();
    }
  });
})();
