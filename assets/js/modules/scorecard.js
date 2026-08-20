/* ============================================================
   RWG Platform — Scorecard module (the agent weekly form)

   The rebuilt weekly scorecard. Differences from the old form:
     1. Attributed to the LOGGED-IN account, not a name dropdown.
     2. The agent types ONE number per case; the platform derives FYC,
        annualized premium, and revenue (RWG.scorecard). Investments can
        never carry a stray $ Amount.
     3. The headline number is ANNUALIZED PREMIUM written this week, with
        pace to the agent's weekly target.
     4. A DAILY TALLY replaces the five "type it from memory on Friday"
        boxes. Agents log a couple of numbers per day (Mon..Sat); the week
        auto-sums. The old form told agents to "pull them from your daily
        tally" but never gave them one — this is that tally.
     5. A "My Week — X of 9 met" checklist scores each activity and outcome
        against the agent's target. Opportunities opened / new business
        submitted / closed / premium come from the cases automatically.

   Admin "view as" flows through here: an admin can pick any teammate and
   see (and, per Carlos, edit) their scorecard exactly as they see it. Every
   read and write keys on RWG.app.effectiveUser(), never currentUser.

   Reads/writes go through RWG.scorecardData. Money + week rules come from
   RWG.scorecard. This file owns layout and interaction only.
   ============================================================ */
window.RWG = window.RWG || {};

(function () {
  const S = () => RWG.scorecard;
  const D = () => RWG.scorecardData;
  const U = () => RWG.ui;
  const APP = () => RWG.app;

  // Whoever we're acting as: the logged-in agent, or (for an admin using the
  // agent picker / View As) the teammate being viewed.
  /* Whose scorecard this is. Two different questions used to share one
     answer: "who am I working as" (View as, in Team Overview — it changes
     the whole site) and "whose week am I reading". Picking a name here
     used to do the first, so looking up an agent's numbers put you inside
     their entire account. Now the picker only changes the week on screen;
     everything else about the session stays yours.

     Reading someone else's week is READ-ONLY. Their tally is theirs to
     log, and submitting a week on their behalf would be signing their
     name to it. */
  const session = () => (APP() && APP().effectiveUser && APP().effectiveUser()) || RWG.auth.currentUser();
  function viewingUid() {
    const m = RWG.modules.get('scorecard');
    const uid = m && m.state && m.state.agentUid;
    if (!uid) return null;
    const me = session();
    if (!me || uid === me.id) return null;
    // an agent has no roster, and an admin already inside View as is that
    // person — neither may reach anybody else's numbers from here
    if (!RWG.auth.isAdmin || !RWG.auth.isAdmin()) return null;
    if (APP() && APP().state && APP().state.viewAs) return null;
    return uid;
  }
  const actor = () => {
    const uid = viewingUid();
    const u = uid && RWG.data && RWG.data.user ? RWG.data.user(uid) : null;
    return u || session();
  };
  const readOnly = () => !!viewingUid();

  const money = (n) => U().money(n);
  const esc = (s) => U().esc(s);

  // ── who is this, on the scorecard? ──
  // config/agents (built at migration) maps account -> legacy name + goals.
  // Before that exists we fall back to matching the account name.
  function identity(user) {
    const cfg = D().agentConfig(user.id);
    if (cfg) return {
      name: cfg.legacyName || user.name,
      goals: cfg.goals || S().goalsFor(cfg.legacyName || user.name),
      role: cfg.scorecardRole || 'associate',
      firmShare: cfg.firmShare != null ? cfg.firmShare : 1.0
    };
    return {
      name: user.name,
      goals: S().goalsFor(user.name),
      role: S().scorecardRole(user.name),
      firmShare: S().firmShare(user.name)
    };
  }

  // The last N Fridays up to and including the current week (newest first).
  function recentWeeks(count) {
    const cur = S().currentWeekEnding();
    const all = S().fridaysOfYear(Number(cur.slice(0, 4)));
    const idx = all.indexOf(cur);
    const upto = idx >= 0 ? all.slice(0, idx + 1) : all;
    return upto.slice(-count).reverse();
  }

  // ── the manual activities (everything that isn't derived from a case) ──
  const MANUAL = [
    { id: 'fa_sched', label: '1st meetings scheduled' },
    { id: 'fa_held', label: '1st meetings held' },
    { id: 'ca_sched', label: '2nd meetings scheduled' },
    { id: 'ca_held', label: '2nd meetings held' },
    { id: 'referrals', label: 'Referrals gathered' }
  ];

  // ── the weekly rollup, computed live from the case cache ──
  function rollup(user, weekEnding) {
    const sc = S();
    const mine = D().casesForAgent(user.id).filter(c => sc.activeInWeek(c, weekEnding));
    const byBucket = { Opened: [], Submitted: [], Closed: [] };
    mine.forEach(c => { const b = sc.bucketForWeek(c, weekEnding); if (byBucket[b]) byBucket[b].push(c); });

    const sum = (list, fn) => list.reduce((a, c) => a + fn(c), 0);
    const closed = byBucket.Closed, sub = byBucket.Submitted, opened = byBucket.Opened;

    return {
      cases: mine, opened, submitted: sub, closed,
      annualizedClosed: sum(closed, c => sc.deriveCase(c).annualizedPremium),
      annualizedSubmitted: sum(sub, c => sc.deriveCase(c).annualizedPremium),
      fycClosed: sum(closed, c => sc.fyc(c.product, c.amount)),
      revClosed: sum(closed, c => sc.deriveCase(c).revenue),
      revSubmitted: sum(sub, c => sc.deriveCase(c).revenue),
      aumClosed: sum(closed, c => Number(c.aum) || 0)
    };
  }

  // ── daily tally helpers ──
  // st.daily = { 'yyyy-mm-dd': { fa_sched, fa_held, ca_sched, ca_held, referrals } }
  function dailyTotals(st) {
    const t = { fa_sched: 0, fa_held: 0, ca_sched: 0, ca_held: 0, referrals: 0 };
    const daily = st.daily || {};
    Object.keys(daily).forEach(k => { const d = daily[k] || {}; MANUAL.forEach(m => { t[m.id] += Number(d[m.id]) || 0; }); });
    return t;
  }
  // Strip empties and coerce to numbers before persisting.
  function cleanDaily(daily) {
    const out = {};
    Object.keys(daily || {}).forEach(k => {
      const d = daily[k] || {}, row = {};
      MANUAL.forEach(m => { const v = Number(d[m.id]) || 0; if (v) row[m.id] = v; });
      if (Object.keys(row).length) out[k] = row;
    });
    return out;
  }
  // Load the saved daily tally for (agent, week) into state, unless the agent is
  // mid-edit on the same week. Weeks saved before this feature existed have no
  // daily breakdown, so seed their totals onto the Friday column — nothing is lost.
  function syncDaily(user, st, week) {
    if (!D().isStarted()) { st.daily = st.daily || {}; return; }
    const key = user.id + '_' + week;
    if (st.loadedKey === key) return;
    const saved = D().weekFor(user.id, week);
    if (saved && saved.daily) st.daily = JSON.parse(JSON.stringify(saved.daily));
    else if (saved) st.daily = { [week]: {
      fa_sched: saved.firstApptsScheduled || 0, fa_held: saved.firstApptsHeld || 0,
      ca_sched: saved.closingApptsScheduled || 0, ca_held: saved.closingApptsHeld || 0,
      referrals: saved.referralsGathered || 0 } };
    else st.daily = {};
    st.loadedKey = key;
  }

  // Activity points = manual funnel + counts derived from the cases this week.
  function activityPoints(totals, r) {
    const p = S().ACTIVITY_POINTS;
    const n = (v) => Number(v) || 0;
    return n(totals.fa_sched) * p.fa_sched + n(totals.fa_held) * p.fa_held
      + r.opened.length * p.opp_open + n(totals.ca_sched) * p.ca_sched
      + n(totals.ca_held) * p.ca_held + r.submitted.length * p.nb_written
      + r.closed.length * p.nb_closed + n(totals.referrals) * p.referrals;
  }

  // The one week doc, built from the daily tally + the live case rollup. Used by
  // both the daily auto-save (finalize:false) and Submit week (finalize:true).
  function weekDoc(st, user, opts) {
    const sc = S(), me = identity(user);
    const week = st.weekEnding || sc.currentWeekEnding();
    const totals = dailyTotals(st);
    const r = rollup(user, week);
    const doc = {
      agentUid: user.id, agentName: me.name, weekEnding: week,
      daily: cleanDaily(st.daily),
      firstApptsScheduled: totals.fa_sched, firstApptsHeld: totals.fa_held,
      closingApptsScheduled: totals.ca_sched, closingApptsHeld: totals.ca_held,
      referralsGathered: totals.referrals,
      opportunitiesOpened: r.opened.length, newBusinessSubmitted: r.submitted.length, newBusinessClosed: r.closed.length,
      activityPoints: activityPoints(totals, r),
      annualizedPremiumClosed: r.annualizedClosed, annualizedPremiumSubmitted: r.annualizedSubmitted,
      fycClosed: r.fycClosed, revenueClosed: r.revClosed, revenueSubmitted: r.revSubmitted, aumClosed: r.aumClosed,
      scorecardRole: me.role
    };
    if (opts && opts.finalize) doc.submittedAt = new Date().toISOString();
    return doc;
  }

  // ── the "My Week" nine-goal checklist ──
  // Five come from the daily tally; four are counted from the cases (marked "auto").
  const GOAL_LINES = [
    { label: '1st meetings scheduled', actual: vm => vm.totals.fa_sched, goal: vm => vm.goals.firstSched },
    { label: '1st meetings held', actual: vm => vm.totals.fa_held, goal: vm => vm.goals.firstHeld },
    { label: 'Opportunities opened', actual: vm => vm.r.opened.length, goal: vm => vm.goals.opps, auto: true },
    { label: '2nd meetings scheduled', actual: vm => vm.totals.ca_sched, goal: vm => vm.goals.closingSched },
    { label: '2nd meetings held', actual: vm => vm.totals.ca_held, goal: vm => vm.goals.closingRun },
    { label: 'New business submitted', actual: vm => vm.r.submitted.length, goal: vm => vm.goals.nbSub, auto: true },
    { label: 'New business closed', actual: vm => vm.r.closed.length, goal: vm => vm.goals.nbClosed, auto: true },
    { label: 'Premium closed', actual: vm => vm.r.annualizedClosed, goal: vm => vm.goals.closeAnnualizedPremium, money: true, auto: true },
    { label: 'Referrals gathered', actual: vm => vm.totals.referrals, goal: vm => vm.goals.referrals }
  ];
  const lineMet = (g, vm) => { const goal = g.goal(vm) || 0, a = g.actual(vm) || 0; return goal > 0 ? a >= goal : a > 0; };

  function myWeekHtml(vm) {
    const fmt = (g, x) => g.money ? money(x) : x;
    const lines = GOAL_LINES.map(g => {
      const a = g.actual(vm) || 0, goal = g.goal(vm) || 0, met = lineMet(g, vm);
      const pct = goal > 0 ? Math.min(100, Math.round(100 * a / goal)) : (a > 0 ? 100 : 0);
      return `<div class="mw-line ${met ? 'met' : ''}">
        <div class="mw-top">
          <span class="mw-label">${g.label}${g.auto ? '<span class="mw-auto" title="Counted from your cases">auto</span>' : ''}</span>
          <span class="mw-val">${fmt(g, a)}${goal ? ` <span class="mw-goal">/ ${fmt(g, goal)}</span>` : ''}</span>
        </div>
        <div class="mw-bar"><div class="mw-fill ${met ? 'ok' : ''}" style="width:${pct}%"></div></div>
      </div>`;
    }).join('');
    const met = GOAL_LINES.filter(g => lineMet(g, vm)).length;
    return `<div class="card mw-card">
      <div class="card-head"><h3>My Week</h3><span class="sub">${met} of ${GOAL_LINES.length} met</span></div>
      ${lines}
    </div>`;
  }

  // ── case rows: derived, granular, and NOT edited here (phase 6b) ──
  // The scorecard no longer owns a case form. A row opens the real
  // opportunity window; money runs through deriveCase, so a per-case
  // rate reads the same here as everywhere else.
  /* The stage as the row SAYS it, so the ▾ checklist offers the words on
     screen rather than the ids underneath them. */
  function stageText(c) {
    const P = RWG.pipelines;
    if (c.closedAt) return 'Closed ✓';
    if (c.pendingClose) return 'Pending partner';
    return P.stageLabel(c.product, P.stageForCase(c)) || c.state || '';
  }

  /* Cases this week, as a table you can interrogate: sort any column,
     tick which products or stages to keep. The machinery is shared with
     the rest of the app (ui.sheet*) — this only declares what the columns
     ARE, and how each one is read for sorting. */
  /* Ticking a value in a column's checklist repaints the TABLE, never the
     screen: a full render rebuilds the popover you are standing in and
     shuts it, so a multi-select would be one value per open. The body, the
     chips, the count and the ▾ button's own "on" mark are all that
     actually changed. */
  function refreshCases() {
    const m = RWG.modules.get('scorecard'); if (!m) return;
    const st = m.state;
    const body = document.getElementById('sc-cases-body');
    if (!body) { RWG.app.renderMain(); return; }
    const all = weekCases(st), cols = caseCols();
    const shown = U().sheetApply(all, cols, st);
    const narrowed = isNarrowed(st);
    body.innerHTML = casesRowsHtml(shown, narrowed);
    const chips = document.getElementById('sc-chips');
    if (chips) {
      chips.innerHTML = U().sheetChips(cols, st, 'sc');
      chips.style.display = narrowed ? 'flex' : 'none';
    }
    const cnt = document.getElementById('sc-cases-count');
    if (cnt) cnt.textContent = casesCountText(shown.length, all.length, narrowed);
    const clr = document.getElementById('sc-cases-clear');
    if (clr) clr.hidden = !narrowed;
    cols.forEach(c => {
      if (!c.filter) return;
      const btn = document.querySelector('.sc-cases [data-action="popmenu"][data-col="' + c.key + '"]');
      if (btn) btn.classList.toggle('on', !!(st.colf[c.key] || []).length);
    });
  }
  const isNarrowed = (st) => Object.keys(st.colf || {}).some(k => (st.colf[k] || []).length);
  const casesCountText = (shown, total, narrowed) => narrowed
    ? shown + ' of ' + total + ' shown'
    : total + ' case' + (total === 1 ? '' : 's') + ' · counted from the stamps, not typed';
  function casesRowsHtml(shown, narrowed) {
    if (shown.length) return shown.map(caseRow).join('');
    return narrowed
      ? `<tr><td colspan="6"><div class="empty" style="padding:26px"><div class="ec">🔍</div><h3>Nothing matches</h3><p>Open a header's ▾ to widen a filter, or <button class="btn btn-quiet btn-sm" data-action="sc-colf-reset">clear them</button>.</p></div></td></tr>`
      : `<tr><td colspan="6"><div class="empty" style="padding:26px"><div class="ec">🗂</div><h3>Nothing counted this week yet</h3><p>Open an opportunity, or move one on the Pipeline — the scorecard counts the stamps by itself.</p></div></td></tr>`;
  }

  function weekCases(st) {
    const user = actor(); if (!user) return [];
    return rollup(user, st.weekEnding || S().currentWeekEnding()).cases;
  }

  function caseCols() {
    const sc = S();
    return [
      { key: 'name',    label: 'Opportunity',   val: c => c.title || c.clientName || '' },
      { key: 'product', label: 'Product',       val: c => sc.productName(c.product), filter: true },
      { key: 'stage',   label: 'Stage',         val: c => stageText(c), filter: true },
      { key: 'placed',  label: 'Amount / AUM',  val: c => sc.placed(c) || 0, num: true },
      { key: 'ann',     label: 'Ann. premium',  val: c => sc.deriveCase(c).annualizedPremium || 0, num: true },
      { key: 'rev',     label: 'Revenue',       val: c => sc.deriveCase(c).revenue || 0, num: true }
    ];
  }

  function caseRow(c) {
    const sc = S(), P = RWG.pipelines;
    const d = sc.deriveCase(c);
    // Insurance and planning fees are revenue, not money placed — the
    // column to the right already says the number, so this one says so.
    const put = sc.placed(c);
    const money1 = put == null ? '—' : money(put);
    const sid = P.stageForCase(c);
    const bucket = P.bucketOf(c.product, sid) || c.state;
    const cls = bucket === 'Closed' ? 'tier-high' : bucket === 'Submitted' ? 'tier-gold' : bucket === 'Lost' ? 'tier-low' : '';
    const stageLbl = stageText(c);
    return `<tr class="cs-row" data-action="cs-open" data-id="${esc(c.recordId)}" style="cursor:pointer">
      <td><div class="cell-name">${esc(c.title || c.clientName || '(no name)')}</div>
        ${c.title ? `<div class="cell-sub">${esc(c.clientName || '')}</div>` : ''}</td>
      <td>${esc(sc.productName(c.product))}</td>
      <td><span class="chip ${cls}">${esc(stageLbl)}</span></td>
      <td class="num">${money1}</td>
      <td class="num">${d.annualizedPremium ? money(d.annualizedPremium) : '—'}</td>
      <td class="num">${money(Math.round(d.revenue))}</td></tr>`;
  }

  // ── the CRM cross-check under the tally (phase 6b) ────────
  // What the leads CRM can SEE about this week: appointments sitting on
  // the calendar and how many are marked kept. A hint, not a keeper —
  // meetings and referrals stay human-logged in the tally.
  function crmSaw(user, week) {
    try {
      if (!RWG.data || !RWG.data.leadsRaw) return null;
      const days = S().weekDays(week, 7);
      if (days.length < 7) return null;
      const start = Date.parse(days[0].key + 'T00:00:00');
      const end = Date.parse(days[6].key + 'T23:59:59');
      const mine = RWG.data.leadsRaw().filter(l => l.assignedTo === user.id);
      const appts = mine.filter(l => l.apptDate && l.apptDate >= start && l.apptDate <= end);
      const kept = appts.filter(l => l.stage === 'Appointment Kept' || l.stage === 'Opportunity Opened');
      return { appts: appts.length, kept: kept.length };
    } catch (e) { return null; }
  }

  // ── the daily tally grid (Mon..Sat) ──
  function dailyGridHtml(st, week, reading) {
    const days = S().weekDays(week, 6);
    const today = S().todayKey();
    const totals = dailyTotals(st);
    const head = days.map(d =>
      `<th class="sc-dayh ${d.key === today ? 'is-today' : ''}"><span>${d.label}</span><small>${d.month} ${d.dom}</small></th>`).join('');
    const rows = MANUAL.map(m => {
      const cells = days.map(d => {
        const v = (st.daily[d.key] || {})[m.id];
        return `<td class="${d.key === today ? 'is-today' : ''}"><input class="sc-daycell" type="number" min="0" inputmode="numeric"
          data-day="${d.key}" data-metric="${m.id}" value="${v == null || v === '' ? '' : esc(String(v))}" placeholder="0" ${reading ? 'disabled' : ''}></td>`;
      }).join('');
      return `<tr><th class="sc-metric">${m.label}</th>${cells}<td class="num sc-rowtot" data-tot="${m.id}">${totals[m.id] || 0}</td></tr>`;
    }).join('');
    return `<div class="table-wrap"><table class="data sc-daily">
      <thead><tr><th class="sc-metric">Activity</th>${head}<th class="num sc-weektot">Week</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  }

  RWG.modules.register({
    id: 'scorecard',
    title: 'Scorecard',
    enabled: true,
    roles: ['admin', 'agent'],
    nav: [{ view: 'sc_week', label: 'My Scorecard', icon: 'scorecard' }],
    meta: { sc_week: { t: 'My Scorecard', s: 'Log your week' } },

    state: {
      weekEnding: null,
      agentUid: null,       // whose scorecard to read; null = your own
      daily: {},            // { 'yyyy-mm-dd': { fa_sched, ... } }
      loadedKey: null,      // uid_week the daily tally was last loaded for
      // Cases this week: how the table was left. Not persisted anywhere —
      // a sort is how you are reading the screen right now, not a setting.
      sortKey: null, sortDir: 'asc', colf: {}
    },

    home: {
      tile: (ctx) => ({ icon: 'scorecard', title: 'Scorecard', desc: 'Log your week. Cases, activity, and your pace to goal.', view: 'sc_week' }),
      stats: (ctx) => {
        if (!D().isStarted()) return [];
        const user = session(); if (!user) return [];   // your home, your number
        const wk = RWG.modules.get('scorecard').state.weekEnding || S().currentWeekEnding();
        const r = rollup(user, wk);
        return [{ label: 'Annualized premium (wk)', value: money(r.annualizedClosed) }];
      }
    },

    onEnter(view, ctx) {
      const st = this.state;
      if (!D().isStarted()) D().init(RWG.auth.currentUser(), RWG.app.renderMain);
      RWG.pipelines.init();   // rows show the granular stage
      if (!st.weekEnding) st.weekEnding = S().currentWeekEnding();
    },

    onChange(e, st) {
      if (e.target.id === 'sc-week-pick') { st.weekEnding = e.target.value; st.loadedKey = null; RWG.app.renderMain(); return; }
      if (e.target.id === 'sc-agent-pick') {
        st.agentUid = e.target.value || null;
        st.loadedKey = null;          // load THEIR tally, not the one on screen
        RWG.app.renderMain();
        return;
      }
      if (e.target.classList && e.target.classList.contains('sc-daycell')) { persistDaily(st); return; }
      if (e.target.dataset && e.target.dataset.colf) {
        U().sheetTick(st, e.target.dataset.colf, e.target.dataset.val, e.target.checked);
        refreshCases();   // not renderMain: the menu you are ticking in stays open
      }
    },

    onInput(e, st) {
      const t = e.target;
      if (t.classList && t.classList.contains('sc-daycell')) {
        const day = t.dataset.day, metric = t.dataset.metric;
        st.daily[day] = st.daily[day] || {};
        st.daily[day][metric] = t.value;
        refreshDailyTotals();
      }
    },

    actions: {
      'sc-save-week': function (el, e, st) { saveWeek(st); },
      'sc-sort': (el, e, st) => { U().sheetSort(st, caseCols(), el.dataset.key); RWG.app.renderMain(); },
      'sc-popsort': (el, e, st) => { st.sortKey = el.dataset.key; st.sortDir = el.dataset.dir; RWG.app.renderMain(); },
      'sc-colf-all': (el, e, st) => {
        const k = el.dataset.col, col = caseCols().filter(c => c.key === k)[0];
        if (!col) return;
        st.colf[k] = U().sheetValues(weekCases(st), col);
        document.querySelectorAll('input[data-colf="' + k + '"]').forEach(cb => { cb.checked = true; });
        refreshCases();
      },
      'sc-colf-clear': (el, e, st) => {
        const k = el.dataset.col;
        delete st.colf[k];
        document.querySelectorAll('input[data-colf="' + k + '"]').forEach(cb => { cb.checked = false; });
        refreshCases();
      },
      'sc-colf-reset': (el, e, st) => { st.colf = {}; st.sortKey = null; RWG.app.renderMain(); }
    },

    render(view, user, ctx) {
      const st = this.state;
      const sc = S();
      const week = st.weekEnding || sc.currentWeekEnding();
      // `user` is who the session belongs to; actor() is whose week is on
      // screen. They differ only while a partner is reading someone else's.
      const who = actor() || user;
      syncDaily(who, st, week);
      const vm = buildVM(who, st);
      const me = vm.me;

      const weekOpts = recentWeeks(14).map(w =>
        `<option value="${w}" ${w === week ? 'selected' : ''}>Week ending ${w}${w === sc.currentWeekEnding() ? ' (this week)' : ''}</option>`).join('');

      const cols = caseCols();
      const shown = U().sheetApply(vm.r.cases, cols, st);
      const narrowed = isNarrowed(st);
      const rows = casesRowsHtml(shown, narrowed);

      const notConnected = !D().isStarted() || (D().cases().length === 0 && !D().agentConfig(user.id));

      /* The agent picker is a partner's tool and has never been drawn for
         an agent — their scorecard has only ever been their own numbers.
         It is also hidden while an admin is viewing AS someone, because
         the promise of that mode is "exactly what they see", and a roster
         of their colleagues is not something they can see. Exit agent view
         (the banner is on every page) to switch to somebody else. */
      const realUser = RWG.auth.currentUser();
      const viewingId = (RWG.app.state && RWG.app.state.viewAs) || '';
      const canPick = RWG.auth.isAdmin() && !viewingId;
      const picked = viewingUid();
      const others = canPick
        ? RWG.data.users().filter(u => u.status === 'active' && u.id !== realUser.id)
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        : [];
      const agentPicker = canPick
        ? `<select id="sc-agent-pick" class="fbar-select" title="Read another agent's scorecard — their numbers, your session">
             <option value="">Me — ${esc((realUser.name || '').split(' ')[0])}</option>
             ${others.map(u => `<option value="${u.id}" ${u.id === picked ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}
           </select>`
        : '';
      const reading = readOnly();

      return `
      <div class="sc-wrap">
        <div class="sc-main">
          <div class="card">
            <div class="card-head"><h3>${reading ? esc(me.name.split(' ')[0]) + '\u2019s week' : 'Your week'}</h3><span class="sub">${esc(me.name)}</span>
              <span class="topbar-spacer"></span>
              ${agentPicker}
              <select id="sc-week-pick" class="fbar-select">${weekOpts}</select>
            </div>
            ${reading ? `<div class="sc-note">You are reading <b>${esc(me.name)}</b>'s scorecard — their numbers, in your own session. The tally is theirs to log, so it is read-only here. To work as them, use <b>View as</b> in Team Overview.</div>` : ''}
            ${notConnected ? `<div class="sc-note">Live save is off until the Firestore rules are published. You can still see the layout and the live math.</div>` : ''}
          </div>

          <div class="card">
            <div class="card-head"><h3>Daily tally</h3><span class="sub">${reading
              ? 'What they logged this week' : 'Log a couple of numbers at the end of each day — the week adds itself up'}</span></div>
            ${dailyGridHtml(st, week, reading)}
            <div class="sc-derived muted">
              Opportunities opened <b>${vm.r.opened.length}</b> &middot;
              New business submitted <b>${vm.r.submitted.length}</b> &middot;
              New business closed <b>${vm.r.closed.length}</b>
              <span class="sub">(counted from your cases, not typed here)</span>
            </div>
            ${(() => {
              const saw = crmSaw(user, week);
              return saw && saw.appts ? `<div class="sc-derived muted" style="margin-top:4px">
                CRM cross-check: <b>${saw.appts}</b> lead appointment${saw.appts === 1 ? '' : 's'} on this week's calendar,
                <b>${saw.kept}</b> marked kept — the tally above is still yours to log.</div>` : '';
            })()}
          </div>

          <div class="card">
            <div class="card-head"><h3>Cases this week</h3>
              <span class="sub" id="sc-cases-count">${esc(casesCountText(shown.length, vm.r.cases.length, narrowed))}</span>
              <span class="topbar-spacer"></span>
              <button class="btn btn-quiet btn-sm" id="sc-cases-clear" data-action="sc-colf-reset" ${narrowed ? '' : 'hidden'}>Clear filters</button>
              <button class="btn btn-gold btn-sm" data-action="cs-new">＋ Opportunity</button></div>
            <div class="flex" id="sc-chips" style="gap:6px;flex-wrap:wrap;margin:-4px 0 12px;${narrowed ? '' : 'display:none'}">${U().sheetChips(cols, st, 'sc')}</div>
            <div class="table-wrap"><table class="data sc-cases">
              <thead>${U().sheetHead(cols, vm.r.cases, st, 'sc')}</thead>
              <tbody id="sc-cases-body">${rows}</tbody>
            </table></div>
            <p class="muted" style="font-size:12px;margin:10px 2px 2px">
              Click a heading to sort, or its ▾ to pick which products and stages to show.
              A row opens the opportunity window. Opened, written and closed count from the write-once
              stamps — the same numbers the Pipeline, the reports and the partner's confirm all read.
            </p>
          </div>
        </div>

        <aside class="sc-rail" id="sc-rail">${railHtml(vm)}</aside>
      </div>`;
    }
  });

  // ── the view model shared by render + the in-place rail refresh ──
  function buildVM(user, st) {
    const sc = S();
    const week = st.weekEnding || sc.currentWeekEnding();
    const me = identity(user);
    const r = rollup(user, week);
    const totals = dailyTotals(st);
    const pts = activityPoints(totals, r);
    const floor = sc.weeklyFloor(me.name);
    const goals = me.goals || {};
    const target = goals.closeAnnualizedPremium || 0;
    const pacePct = target ? Math.min(100, Math.round(100 * r.annualizedClosed / target)) : 0;
    return { week, me, r, totals, pts, floor, goals, target, pacePct, reading: readOnly() };
  }

  // ── the right rail (also refreshed in place as the daily tally is typed) ──
  function railHtml(vm) {
    const floorPct = vm.floor ? Math.min(100, Math.round(100 * vm.pts / vm.floor)) : 100;
    return `
      <div class="card sc-hero">
        <div class="eyebrow"><span class="dot"></span><span>Annualized premium written</span></div>
        <div class="sc-big num">${money(vm.r.annualizedClosed)}</div>
        ${vm.target ? `<div class="sc-bar"><div class="sc-bar-fill" style="width:${vm.pacePct}%"></div></div>
          <div class="sc-bar-note">${vm.pacePct}% of your ${money(vm.target)} weekly pace</div>` : ''}
      </div>
      ${myWeekHtml(vm)}
      <div class="grid sc-nums">
        <div class="stat"><div class="label">Revenue closed</div><div class="value num">${money(vm.r.revClosed)}</div></div>
        <div class="stat"><div class="label">FYC closed</div><div class="value num">${money(vm.r.fycClosed)}</div></div>
        <div class="stat"><div class="label">Submitted (ann. prem)</div><div class="value num">${money(vm.r.annualizedSubmitted)}</div></div>
        <div class="stat"><div class="label">AUM closed</div><div class="value num">${money(vm.r.aumClosed)}</div></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Activity points</h3></div>
        <div class="sc-bar"><div class="sc-bar-fill ${vm.pts >= vm.floor ? 'ok' : ''}" style="width:${floorPct}%"></div></div>
        <div class="sc-bar-note">${vm.pts} points${vm.floor ? ' &middot; floor ' + vm.floor : ''}</div>
      </div>
      ${vm.reading
        ? `<p class="muted" style="font-size:12px;margin:0 2px">Read-only — ${esc((vm.me.name || '').split(' ')[0])} submits their own week.</p>`
        : '<button class="btn btn-navy btn-block" data-action="sc-save-week">Submit week</button>'}`;
  }

  function refreshRail() {
    const user = actor(); if (!user) return;
    const st = RWG.modules.get('scorecard').state;
    const rail = document.getElementById('sc-rail');
    if (rail) rail.innerHTML = railHtml(buildVM(user, st));
  }

  // Update the daily grid's row totals + the rail without a full re-render, so
  // the cell being typed keeps focus.
  function refreshDailyTotals() {
    const st = RWG.modules.get('scorecard').state;
    const totals = dailyTotals(st);
    MANUAL.forEach(m => { const el = document.querySelector('[data-tot="' + m.id + '"]'); if (el) el.textContent = totals[m.id] || 0; });
    refreshRail();
  }

  function persistDaily(st) {
    if (readOnly()) return;   // never write into somebody else's week
    const user = actor(); if (!user || !D().isStarted()) return;
    D().saveDaily(weekDoc(st, user, { finalize: false }))
      .catch(err => U().toast('Could not save: ' + err.message));
  }

  // (The case add/edit form is gone — phase 6b. The opportunity window
  // is the one way a case is born or changed; the scorecard only reads.)

  function saveWeek(st) {
    if (readOnly()) { U().toast('This is their scorecard to submit, not yours'); return; }
    const user = actor();
    const me = identity(user);
    D().saveWeek(weekDoc(st, user, { finalize: true }))
      .then(() => U().toast('Week submitted. Thanks, ' + me.name.split(' ')[0] + '.', true))
      .catch(err => U().toast('Could not submit: ' + err.message));
  }

  // expose the pure helpers for verification
  RWG._scorecardModule = { rollup, activityPoints, identity, recentWeeks, dailyTotals, cleanDaily, weekDoc, GOAL_LINES, lineMet, buildVM, caseRow, crmSaw };
})();
