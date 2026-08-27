/* ============================================================
   RWG Platform — Report module (management view, admin only)

   Reads the SAME cases and weeks the scorecard writes, so the numbers
   management sees can never disagree with what the agent sees. The old
   system kept two copies and they drifted; here there is one source.

   Headline is ANNUALIZED PREMIUM written, per agent per week, with pace
   to the weekly target, plus the Chairman's Club (combined partner FYC
   toward $1M).
   ============================================================ */
window.RWG = window.RWG || {};

(function () {
  const S = () => RWG.scorecard;
  const D = () => RWG.scorecardData;
  const R = () => RWG.data;                     // the roster — where a person's name lives
  const U = () => RWG.ui;
  const money = (n) => U().money(n);
  const esc = (s) => U().esc(s);

  /* ── One producer, one key, one name ────────────────────────
     Every grouping on this screen keys on the ACCOUNT, never on the name
     string a row happened to store. Nelson's cases say "Nelson Mompierre"
     and his weekly rows say "Nelson Mompierre Jr." — one uid, two
     spellings — and a screen that groups by the string showed him twice,
     split his week between the two halves, and found his goals under
     neither: the Who list offered both, one gave cases with no goals and
     no daily tally, the other goals and a tally with no cases.

     So the key is the uid, and the NAME is read from the roster. Rename
     somebody in Team overview and this screen agrees with itself again,
     including the goals table, which is still keyed by name upstream. */
  const caseKey = (c) => c.agentUid || c.agentName || '(unknown)';
  function nameFor(key, fallback) {
    const u = R() && R().user ? R().user(key) : null;
    return (u && u.name) || fallback || key;
  }

  /* The money metrics, declared once. The glance matrix totals them and the
     drill-down itemises them, so a single definition is what stops a column
     and the list behind it from ever telling different stories. */
  const METRICS = [
    { id: 'ann', label: 'Annualized premium', fn: c => S().deriveCase(c).annualizedPremium },
    { id: 'fyc', label: 'FYC', fn: c => S().fyc(c.product, c.amount) },
    { id: 'rev', label: 'Revenue', fn: c => S().deriveCase(c).revenue },
    { id: 'aum', label: 'AUM', fn: c => Number(c.aum) || 0 },
    { id: 'dep', label: 'Annuity deposits', fn: c => c.product === 'annuity' ? (Number(c.amount) || 0) : 0 }
  ];
  const metricBy = (id) => METRICS.filter(m => m.id === id)[0] || null;

  const BUCKETS = ['Opened', 'Submitted', 'Closed'];

  /* The cases behind a number. Same filter the totals use, so what opens is
     exactly what was counted — a drill-down that quietly disagrees with the
     figure above it is worse than no drill-down. */
  /* `co` decides whether co-credited cases count, and it is a real fork
     rather than a nicety: 105 of the 149 cases carry a co-credit name.

     The by-agent table is OWNERSHIP — whose scorecard a case counts on —
     so its counts and their drill-downs both exclude co-credit. A person's
     own view has always counted what they were credited on as well, and
     its cards and their drill-downs both include it. What must never
     happen is a figure adding up one way and the list behind it the
     other, so the flag travels with the click. */
  function drillCases(key, bucket, week, product, co) {
    const sc = S();
    const name = co && key && key !== '__team__' ? nameFor(key, key) : null;
    return D().cases().filter(c => {
      if (key && key !== '__team__' && caseKey(c) !== key
        && !(name && sc.coCredit(c).indexOf(name) >= 0)) return false;
      if (product && c.product !== product) return false;
      const b = sc.bucketForWeek(c, week);
      if (!b) return false;
      return bucket === 'all' ? true : b === bucket;
    });
  }

  function recentWeeks(count) {
    const cur = S().currentWeekEnding();
    const all = S().fridaysOfYear(Number(cur.slice(0, 4)));
    const idx = all.indexOf(cur);
    return (idx >= 0 ? all.slice(0, idx + 1) : all).slice(-count).reverse();
  }

  // Aggregate every case that hit a milestone in the given week, grouped by agent.
  function teamForWeek(weekEnding) {
    const sc = S(), agents = {};
    D().cases().forEach(c => {
      const b = sc.bucketForWeek(c, weekEnding);
      if (!b) return;
      const key = caseKey(c);
      const a = agents[key] || (agents[key] = {
        key, name: nameFor(key, c.agentName),
        opened: 0, submitted: 0, closed: 0,
        annClosed: 0, revClosed: 0, fycClosed: 0, annSub: 0, revSub: 0
      });
      if (b === 'Opened') a.opened++;
      else if (b === 'Submitted') { a.submitted++; a.annSub += sc.deriveCase(c).annualizedPremium; a.revSub += sc.deriveCase(c).revenue; }
      else if (b === 'Closed') { a.closed++; a.annClosed += sc.deriveCase(c).annualizedPremium; a.revClosed += sc.deriveCase(c).revenue; a.fycClosed += sc.fyc(c.product, c.amount); }
    });
    return agents;
  }

  function teamTotals(agents) {
    const t = { opened: 0, submitted: 0, closed: 0, annClosed: 0, revClosed: 0, fycClosed: 0, annSub: 0, revSub: 0 };
    Object.values(agents).forEach(a => { Object.keys(t).forEach(k => t[k] += a[k]); });
    return t;
  }

  // Chairman's Club: combined FYC on every closed case, ever, plus the booked start.
  function clubYtd() {
    const sc = S();
    let fyc = 0;
    D().cases().forEach(c => { if (c.closedAt) fyc += sc.fyc(c.product, c.amount); });
    return sc.CHAIRMAN.STARTING_FYC_TOTAL + fyc;
  }

  /* The management "glance": each money metric split Opened / Submitted /
     Closed / Total. Every cell opens the cases behind it — the number and
     the list come from the same METRICS entry and the same bucket filter,
     so they cannot drift. `who` scopes it: the team view passes __team__,
     a person's view passes their key. */
  function glanceMatrix(week, who, co) {
    const sc = S();
    const b = { Opened: [], Submitted: [], Closed: [] };
    drillCases(who, 'all', week, null, co).forEach(c => { const k = sc.bucketForWeek(c, week); if (b[k]) b[k].push(c); });
    const sum = (list, fn) => list.reduce((a, c) => a + fn(c), 0);
    const coAttr = co ? ' data-co="1"' : '';
    const cell = (val, bucket, m) =>
      `<td class="num rp-click" data-action="rp-drill" data-who="${esc(who)}" data-bucket="${bucket}" data-metric="${m.id}"${coAttr}
         title="Open the ${bucket === 'all' ? '' : bucket.toLowerCase() + ' '}cases behind this"><span class="rp-n">${money(val)}</span></td>`;
    const tr = METRICS.map(m => {
      const o = sum(b.Opened, m.fn), s = sum(b.Submitted, m.fn), cl = sum(b.Closed, m.fn);
      return `<tr><td>${m.label}</td>${cell(o, 'Opened', m)}${cell(s, 'Submitted', m)}${cell(cl, 'Closed', m)}
        <td class="num rp-click" data-action="rp-drill" data-who="${esc(who)}" data-bucket="all" data-metric="${m.id}"${coAttr}
          title="Open every case behind this"><b class="rp-n">${money(o + s + cl)}</b></td></tr>`;
    }).join('');
    return `<div class="card"><div class="card-head"><h3>This week at a glance</h3>
        <span class="sub">Click any figure to see the cases behind it</span></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Metric</th><th class="num">Opened</th><th class="num">Submitted</th><th class="num">Closed</th><th class="num">Total</th></tr></thead><tbody>${tr}</tbody></table></div></div>`;
  }

  // Product mix: counts by stage and total revenue per product for the week.
  // Clickable on the same terms as everything else here — "which three
  // annuities closed" is the question this table provokes.
  function mixTable(week, who, co) {
    const sc = S(), byP = {};
    const coAttr = co ? ' data-co="1"' : '';
    drillCases(who, 'all', week, null, co).forEach(c => {
      const k = sc.bucketForWeek(c, week);
      const p = byP[c.product] || (byP[c.product] = { o: 0, s: 0, cl: 0, rev: 0 });
      if (k === 'Opened') p.o++; else if (k === 'Submitted') p.s++; else if (k === 'Closed') p.cl++;
      p.rev += sc.deriveCase(c).revenue;
    });
    const order = sc.PRODUCTS.map(p => p.id).filter(id => byP[id]);
    if (!order.length) return '';
    const cell = (n, id, bucket) => n
      ? `<td class="num rp-click" data-action="rp-drill" data-who="${esc(who)}" data-bucket="${bucket}" data-product="${esc(id)}"${coAttr}><span class="rp-n">${n}</span></td>`
      : `<td class="num muted">·</td>`;
    const tr = order.map(id => {
      const p = byP[id];
      return `<tr><td>${esc(sc.productName(id))}</td>${cell(p.o, id, 'Opened')}${cell(p.s, id, 'Submitted')}${cell(p.cl, id, 'Closed')}
        <td class="num rp-click" data-action="rp-drill" data-who="${esc(who)}" data-bucket="all" data-product="${esc(id)}" data-metric="rev"${coAttr}><span class="rp-n">${money(p.rev)}</span></td></tr>`;
    }).join('');
    return `<div class="card"><div class="card-head"><h3>Product mix</h3><span class="sub">Click a figure for the cases</span></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Product</th><th class="num">Opened</th><th class="num">Submitted</th><th class="num">Closed</th><th class="num">Revenue</th></tr></thead><tbody>${tr}</tbody></table></div></div>`;
  }

  // A person's weekly goals vs actuals (the old "My Week" card, management side).
  function goalsCard(name, cases, week) {
    const sc = S(), g = sc.goalsFor(name);
    if (!g) return '';
    const b = { Opened: [], Submitted: [], Closed: [] };
    cases.forEach(c => { if (!sc.activeInWeek(c, week)) return; const k = sc.bucketForWeek(c, week); if (b[k]) b[k].push(c); });
    const annClosed = b.Closed.reduce((a, c) => a + sc.deriveCase(c).annualizedPremium, 0);
    const rows = [
      { label: 'Opportunities opened', val: b.Opened.length, target: g.opps },
      { label: 'New business submitted', val: b.Submitted.length, target: g.nbSub },
      { label: 'New business closed', val: b.Closed.length, target: g.nbClosed },
      { label: 'Annualized premium closed', val: annClosed, target: g.closeAnnualizedPremium || 0, money: true }
    ];
    let met = 0;
    const body = rows.map(r => {
      const pct = r.target > 0 ? Math.min(100, Math.round(100 * r.val / r.target)) : 100;
      const hit = r.val >= r.target; if (hit) met++;
      const disp = r.money ? (money(r.val) + ' / ' + money(r.target)) : (r.val + ' / ' + r.target);
      return `<div class="rp-goal"><div class="rp-goal-top"><span>${r.label}</span><span>${disp}${hit ? ' ✓' : ''}</span></div>
        <div class="sc-bar"><div class="sc-bar-fill ${hit ? 'ok' : ''}" style="width:${pct}%"></div></div></div>`;
    }).join('');
    return `<div class="card"><div class="card-head"><h3>Weekly goals</h3><span class="sub">${met} of ${rows.length} met</span></div>${body}</div>`;
  }

  // Read-only day-by-day activity for one agent's week, from their saved daily
  // tally (weeks/{uid}_{week}.daily). Lets a manager see the pattern — front-loaded
  // week vs. a Friday scramble — without having to View As the agent.
  const DAILY_ROWS = [
    { id: 'fa_sched', label: '1st mtgs scheduled' },
    { id: 'fa_held', label: '1st mtgs held' },
    { id: 'ca_sched', label: '2nd mtgs scheduled' },
    { id: 'ca_held', label: '2nd mtgs held' },
    { id: 'referrals', label: 'Referrals' }
  ];
  function dailyActivityCard(key, name, week) {
    const sc = S();
    // Matched on the account, not the stored name — Nelson's weekly rows are
    // filed under "Nelson Mompierre Jr." while his cases say "Nelson
    // Mompierre", and a name match found his tally under only one of them.
    const wk = D().weeksForWeek(week).filter(w => (w.agentUid || w.agentName) === key)[0]
      || D().weeksForWeek(week).filter(w => w.agentName === name)[0];
    const daily = (wk && wk.daily) || {};
    const days = sc.weekDays(week, 6);
    const head = days.map(d => `<th class="num">${d.label}<br><small class="muted">${d.month} ${d.dom}</small></th>`).join('');
    const rows = DAILY_ROWS.map(m => {
      let tot = 0;
      const cells = days.map(d => {
        const v = Number((daily[d.key] || {})[m.id]) || 0; tot += v;
        return v ? `<td class="num">${v}</td>` : `<td class="num muted">·</td>`;
      }).join('');
      return `<tr><td style="font-weight:600">${m.label}</td>${cells}<td class="num"><b>${tot}</b></td></tr>`;
    }).join('');
    const note = Object.keys(daily).length ? '' : `<p class="muted" style="font-size:12.5px;margin:8px 0 0">No daily tally logged for this week yet.</p>`;
    return `<div class="card">
      <div class="card-head"><h3>Daily activity</h3><span class="sub">${esc(name.split(' ')[0])}'s week, day by day</span></div>
      <div class="table-wrap"><table class="data rp-daily">
        <thead><tr><th>Activity</th>${head}<th class="num">Week</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>${note}
    </div>`;
  }

  /* The Who list, one entry per ACCOUNT. It used to be built from the name
     strings on cases plus the keys of AGENT_GOALS, which is how the same
     person appeared twice under two spellings. */
  function whoOptions(selected) {
    const seen = {};
    D().cases().forEach(c => { const k = caseKey(c); if (!seen[k]) seen[k] = nameFor(k, c.agentName); });
    // Somebody still here who has not opened a case this week belongs in the
    // list too — you look them up precisely to find out that it is empty.
    const roster = (R() && R().users) ? R().users() : [];
    roster.forEach(u => { if (u.status === 'active' && !seen[u.id]) seen[u.id] = u.name; });
    const list = Object.keys(seen).map(k => [k, seen[k]]).sort((a, b) => a[1].localeCompare(b[1]));
    return ['<option value="__team__"' + (selected === '__team__' ? ' selected' : '') + '>Whole team</option>']
      .concat(list.map(pair => `<option value="${esc(pair[0])}" ${selected === pair[0] ? 'selected' : ''}>${esc(pair[1])}</option>`))
      .join('');
  }

  function statCard(label, value) {
    return `<div class="stat"><div class="label">${esc(label)}</div><div class="value num">${esc(value)}</div></div>`;
  }

  function teamView(week) {
    const sc = S();
    const agents = teamForWeek(week);
    const t = teamTotals(agents);
    const pace = sc.ANNUALIZED_PREMIUM_PER_WEEK_AT_TARGET;
    const pacePct = pace ? Math.min(100, Math.round(100 * t.annClosed / pace)) : 0;

    const glance = `<div class="grid rp-glance">
      ${statCard('Annualized premium (closed)', money(t.annClosed))}
      ${statCard('Revenue closed', money(t.revClosed))}
      ${statCard('FYC closed', money(t.fycClosed))}
      ${statCard('Cases closed', String(t.closed))}
    </div>`;

    const rows = Object.keys(agents).map(k => agents[k]).sort((a, b) => b.annClosed - a.annClosed);
    /* The row opens everything that person touched this week; each count
       opens just that bucket. Both live on the same row, and the inner
       handler wins because the dispatcher takes the NEAREST data-action. */
    const countCell = (n, key, bucket) => n
      ? `<td class="num rp-click" data-action="rp-drill" data-who="${esc(key)}" data-bucket="${bucket}"><span class="rp-n">${n}</span></td>`
      : `<td class="num muted">·</td>`;
    const lead = rows.length ? rows.map(a => {
      const g = sc.goalsFor(a.name);
      const target = (g && g.closeAnnualizedPremium) || 0;
      const pct = target ? Math.min(100, Math.round(100 * a.annClosed / target)) : 0;
      return `<tr class="rp-click" data-action="rp-drill" data-who="${esc(a.key)}" data-bucket="all" title="Open everything ${esc(a.name.split(' ')[0])} touched this week">
        <td style="font-weight:600">${esc(a.name)}</td>
        ${countCell(a.opened, a.key, 'Opened')}${countCell(a.submitted, a.key, 'Submitted')}${countCell(a.closed, a.key, 'Closed')}
        <td class="num"><b>${money(a.annClosed)}</b></td>
        <td class="num">${money(a.revClosed)}</td>
        <td class="num">${target ? pct + '%' : '—'}</td></tr>`;
    }).join('') : `<tr><td colspan="7"><div class="empty" style="padding:22px"><div class="ec">📊</div><h3>No production this week</h3><p>Cases show up here as agents log them.</p></div></td></tr>`;

    const teamRow = rows.length ? `<tr class="rp-total rp-click" data-action="rp-drill" data-who="__team__" data-bucket="all" title="Open every case the firm touched this week">
      <td>Team</td>${countCell(t.opened, '__team__', 'Opened')}${countCell(t.submitted, '__team__', 'Submitted')}${countCell(t.closed, '__team__', 'Closed')}
      <td class="num"><b>${money(t.annClosed)}</b></td><td class="num">${money(t.revClosed)}</td>
      <td class="num">${pace ? pacePct + '%' : '—'}</td></tr>` : '';

    const ytd = clubYtd();
    const goal = sc.CHAIRMAN.ANNUAL_FYC_GOAL_TOTAL;
    const clubPct = Math.min(100, Math.round(100 * ytd / goal));
    const club = `<div class="card rp-club">
      <div class="card-head"><h3>Chairman's Club</h3><span class="sub">Combined partner FYC toward ${money(goal)}</span></div>
      <div class="rp-club-num num">${money(ytd)}</div>
      <div class="sc-bar"><div class="sc-bar-fill" style="width:${clubPct}%"></div></div>
      <div class="sc-bar-note">${clubPct}% of the ${money(goal)} goal &middot; pace ${money(sc.FYC_PER_WEEK_AT_TARGET)}/week of FYC</div>
    </div>`;

    return glance + glanceMatrix(week, '__team__') + `
      <div class="card">
        <div class="card-head"><h3>By agent, this week</h3><span class="sub">Sorted by annualized premium &middot; click a name or a count</span></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Agent</th><th class="num">Opened</th><th class="num">Subm.</th><th class="num">Closed</th><th class="num">Ann. premium</th><th class="num">Revenue</th><th class="num">Pace</th></tr></thead>
          <tbody>${lead}${teamRow}</tbody>
        </table></div>
      </div>` + mixTable(week, '__team__') + club;
  }

  function personView(key, week) {
    const sc = S();
    const name = nameFor(key, key);
    // Their own cases by account, plus anything they are co-credited on —
    // co-credit is still recorded as a name, so that half stays a name match.
    const cases = drillCases(key, 'all', week, null, true);   // one definition of "their week"
    const b = { Opened: [], Submitted: [], Closed: [] };
    cases.forEach(c => { const k = sc.bucketForWeek(c, week); if (b[k]) b[k].push(c); });
    const sum = (list, fn) => list.reduce((a, c) => a + fn(c), 0);
    const annClosed = sum(b.Closed, c => sc.deriveCase(c).annualizedPremium);
    const revClosed = sum(b.Closed, c => sc.deriveCase(c).revenue);
    const fycClosed = sum(b.Closed, c => sc.fyc(c.product, c.amount));
    const g = sc.goalsFor(name); const target = (g && g.closeAnnualizedPremium) || 0;
    const pct = target ? Math.min(100, Math.round(100 * annClosed / target)) : 0;

    const glance = `<div class="grid rp-glance">
      ${statCard('Annualized premium (closed)', money(annClosed))}
      ${statCard('Revenue closed', money(revClosed))}
      ${statCard('FYC closed', money(fycClosed))}
      ${statCard('Pace to goal', target ? pct + '%' : '—')}
    </div>`;

    const body = (b.Closed.length + b.Submitted.length + b.Opened.length)
      ? BUCKETS.slice().reverse().map(k => caseTable(b[k], k, null)).join('')
      : `<div class="empty" style="padding:30px"><div class="ec">🗂</div><h3>Nothing this week for ${esc(name)}</h3></div>`;

    return glance + goalsCard(name, cases, week) + dailyActivityCard(key, name, week)
      + glanceMatrix(week, key, true) + mixTable(week, key, true)
      + `<div class="card"><div class="card-head"><h3>${esc(name.split(' ')[0])}'s cases this week</h3>
          <span class="sub">Click a row to open the case</span></div>${body}</div>`;
  }

  /* One case table, used by the person view and by every drill-down, so a
     list of cases looks and behaves the same wherever it is reached from.
     Rows carry the cases module's own cs-open — actions are resolved by name
     across every module, not per screen, so this opens the real case window
     rather than a second, thinner copy of it living here. */
  function caseTable(list, label, m) {
    if (!list.length) return '';
    const sc = S();
    const extra = m ? `<th class="num">${esc(m.label)}</th>` : '';
    const rows = list.slice().sort((a, x) => (m ? m.fn(x) - m.fn(a) : 0)).map(c => `
      <tr class="rp-click" data-action="cs-open" data-id="${esc(c.recordId || c._id || c.id || '')}" title="Open this case">
        <td>${esc(c.clientName || '(no name)')}</td>
        <td>${esc(sc.productName(c.product))}</td>
        <td class="num">${sc.placed(c) == null ? '—' : money(sc.placed(c))}</td>
        <td class="num">${sc.deriveCase(c).annualizedPremium ? money(sc.deriveCase(c).annualizedPremium) : '—'}</td>
        <td class="num">${money(sc.deriveCase(c).revenue)}</td>
        ${m ? `<td class="num"><b>${money(m.fn(c))}</b></td>` : ''}
      </tr>`).join('');
    const head = label
      ? `<div class="card-head" style="margin:18px 0 10px"><h3 style="font-size:15px">${esc(label)}</h3><span class="sub">${list.length}</span></div>`
      : '';
    return head + `<div class="table-wrap"><table class="data">
      <thead><tr><th>Client</th><th>Product</th><th class="num">Amount / AUM</th><th class="num">Ann. premium</th><th class="num">Revenue</th>${extra}</tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }

  /* The cases behind a figure, in a window over the report rather than a
     navigation away from it — the question "which ones?" is asked while
     reading the number, and answering it should not cost the reader their
     place on the page. */
  function drillModal(who, bucket, week, metricId, product, co) {
    const sc = S();
    const m = metricId ? metricBy(metricId) : null;
    const list = drillCases(who, bucket, week, product, co);
    const whoLabel = who === '__team__' ? 'the whole team' : nameFor(who, who);
    const what = bucket === 'all' ? 'touched' : bucket.toLowerCase();
    const prodLabel = product ? sc.productName(product) + ' · ' : '';
    const total = m ? list.reduce((a, c) => a + m.fn(c), 0) : null;
    const title = m ? m.label : (bucket === 'all' ? 'Cases' : bucket + ' cases');
    return `
    <div class="scrim" data-action="close-modal"></div>
    <div class="modal-card" role="dialog" aria-label="Cases behind this figure" style="max-width:900px">
      <div class="modal-head"><h2>${esc(prodLabel + title)}</h2>
        <p>${esc(String(list.length))} case${list.length === 1 ? '' : 's'} ${esc(what)} by ${esc(whoLabel)} in the week ending ${esc(week)}${total != null ? ' · ' + money(total) : ''}</p></div>
      <div class="modal-body">
        ${list.length
          ? caseTable(list, null, m) + `<p class="rp-drill-sub" style="margin:12px 0 0">Click any row to open the case.</p>`
          : `<div class="empty" style="padding:26px"><div class="ec">🗂</div><h3>Nothing here</h3>
               <p>No case matched that figure for this week.</p></div>`}
      </div>
      <div class="modal-foot"><span class="topbar-spacer"></span>
        <button class="btn btn-gold" data-action="close-modal">Close</button></div>
    </div>`;
  }

  RWG.modules.register({
    id: 'report',
    title: 'Reports',
    enabled: true,
    roles: ['admin'],
    // Reports opens here for a partner: production first, because that is the
    // question you open reports to answer. The entry lives in this module
    // because this module owns the view — a nav entry pointing at somebody
    // else's view is how two modules end up claiming one id.
    // (Agents cannot see production; the builder module carries their entry.)
    nav: [{ view: 'report_week', label: 'Reports', icon: 'reports', also: ['reports', 'report_build'] }],
    views: ['report_week'],
    meta: { report_week: { t: 'Reports', s: 'Production — cases, premium and pace, week by week' } },

    state: { week: null, who: '__team__' },

    home: {
      tile: () => ({ icon: 'reports', title: 'Reports', desc: 'Team production, annualized premium, and pace to goal.', view: 'report_week' })
    },

    onEnter(view, ctx) {
      if (!D().isStarted()) D().init(ctx.userObj || RWG.auth.currentUser(), RWG.app.renderMain);
      if (!this.state.week) this.state.week = S().currentWeekEnding();
    },

    onChange(e, st) {
      if (e.target.id === 'rp-week') { st.week = e.target.value; RWG.app.renderMain(); }
      if (e.target.id === 'rp-who') { st.who = e.target.value; RWG.app.renderMain(); }
    },

    actions: {
      'rp-drill': (el, e, st) => {
        const week = st.week || S().currentWeekEnding();
        const mount = document.getElementById('modal-mount');
        if (mount) mount.innerHTML = drillModal(el.dataset.who || '__team__',
          el.dataset.bucket || 'all', week, el.dataset.metric || null,
          el.dataset.product || null, el.dataset.co === '1');
      }
    },

    render(view, user, ctx) {
      const st = this.state;
      const week = st.week || S().currentWeekEnding();
      const weekOpts = recentWeeks(14).map(w => `<option value="${w}" ${w === week ? 'selected' : ''}>Week ending ${w}${w === S().currentWeekEnding() ? ' (this week)' : ''}</option>`).join('');
      const controls = `<div class="card"><div class="card-head"><h3>Weekly report</h3><span class="topbar-spacer"></span>
        <select id="rp-who" class="fbar-select">${whoOptions(st.who)}</select>
        <select id="rp-week" class="fbar-select">${weekOpts}</select></div></div>`;
      const body = st.who === '__team__' ? teamView(week) : personView(st.who, week);
      /* One flow container, one gap. .card carries no margin of its own, so
         before this the cards this view concatenates sat flush against each
         other while the two that happened to have an ad-hoc margin stood
         apart — which is exactly the unevenness it read as. */
      return (RWG.reportTabs ? RWG.reportTabs('report_week', ctx) : '')
        + `<div class="rp-flow">${controls}${body}</div>`;
    }
  });

  RWG._reportModule = { teamForWeek, teamTotals, clubYtd, personView };
})();
