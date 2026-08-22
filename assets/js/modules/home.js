/* ============================================================
   RWG Platform — Home dashboard (phase 5)

   Where things stand, built from widgets each person arranges.
   Screen 01 of the approved designs: weekly pace, the conversion
   funnel (how far everything opened actually got) beside occupancy
   (where cases sit right now — a pile-up is a bottleneck), the
   needs-help-moving list, important dates, and a team activity
   feed synthesised from the stamps the data already carries — no
   activity log collection, nothing new to write.

   Customize: every widget can be switched off and the order
   dragged. The layout is per-person, per-browser (localStorage) —
   agents cannot write their own users doc by rule, and a home
   layout is not worth a rules change. Role defaults differ: a
   partner lands on the firm view, an agent on their own day.

   Visibility rule honoured: no per-person revenue anywhere here.
   Aggregate money (funnel dollars, forecast) matches what Team
   Cases already shows everyone. The leaderboard, which IS
   per-person revenue, is partner-only.
   ============================================================ */
window.RWG = window.RWG || {};

(function () {
  const SD = () => RWG.scorecardData;
  const SC = () => RWG.scorecard;
  const P  = () => RWG.pipelines;
  const H  = () => RWG.hh;
  const T  = () => RWG.tasks;
  const D  = () => RWG.data;
  const U  = () => RWG.ui;
  const esc = (s) => U().esc(s);
  const dayMs = 86400000;

  // Home opens on the year — the widest honest read of the book — and
  // narrows from there. A quarter default hid business that was still
  // there, which is the wrong way round for a page you check every morning.
  const st = { period: 'ytd', customize: false, on: null };

  const BUCKET_DOT = { Opened: '#5C6B7E', Submitted: '#C2A14D', Closed: '#2E7D5B' };
  const toMs = (v) => typeof v === 'number' ? v : (v ? Date.parse(v) : 0);
  const pad = (n) => String(n).padStart(2, '0');
  const dKey = (y, m, d) => y + '-' + pad(m + 1) + '-' + pad(d);
  const firstName = (s) => (s || '').split(' ')[0];

  // ── the layout, per person, per browser ───────────────────
  // Order matters: the week's numbers, then the three funnels, then the
  // rest. Full-width widgets keep this order among themselves; the flow
  // widgets fill the columns underneath in the order listed here.
  const DEFAULT_ON = {
    admin: ['pace', 'funnel', 'closedmix', 'stale', 'dates', 'activity'],
    agent: ['mytasks', 'pace', 'funnel', 'closedmix', 'stale', 'dates', 'activity']
  };
  // v2: the funnels became one full-width card holding all three tracks and
  // moved under the week's numbers, and "Where cases sit" went away. A saved
  // v1 order cannot express that, so everyone starts from the new default
  // once and customises again from there.
  const lsKey = (uid) => 'rwg.home.v2.' + uid;

  // A saved layout is a person's own arrangement and we never overwrite it.
  // But a widget built after they last saved has no opinion recorded either
  // way — so if the role's defaults want it, it turns itself on once, and
  // from then on obeys whatever they do with it. `seen` is what makes "once"
  // possible: without it, switching a new widget off would just turn it back
  // on at the next load.
  function layout(user, role) {
    if (st.on) return st.on;
    let saved = null, seen = null;
    try {
      const raw = localStorage.getItem(lsKey(user.id));
      if (raw) { const o = JSON.parse(raw) || {}; saved = o.on || null; seen = o.seen || null; }
    } catch (e) {}
    const def = (DEFAULT_ON[role] || DEFAULT_ON.agent).slice();
    if (!saved) { st.on = def; st.seen = allWidgetIds(); return st.on; }

    const known = seen || [];
    const fresh = def.filter(id => known.indexOf(id) < 0 && saved.indexOf(id) < 0);
    st.on = saved.concat(fresh);
    st.seen = allWidgetIds();
    if (fresh.length || !seen) saveLayout(user);
    return st.on;
  }
  function saveLayout(user) {
    try {
      localStorage.setItem(lsKey(user.id), JSON.stringify({ on: st.on, seen: st.seen || allWidgetIds() }));
    } catch (e) {}
  }

  // ── shared derivations ────────────────────────────────────
  /* The cut-off every widget filters on. Cases are stamped by the Friday
     their week ended, so "this week" is that Friday — not Monday's date,
     which would exclude the week you are standing in. */
  function periodStartKey() {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    if (st.period === 'week') return SC().currentWeekEnding();
    if (st.period === 'month') return dKey(y, m, 1);
    if (st.period === 'q') return dKey(y, m - (m % 3), 1);
    if (st.period === 'ytd') return dKey(y, 0, 1);
    return '';
  }
  const PERIOD_LABEL = { week: 'this week', month: 'this month', q: 'this quarter', ytd: 'this year', all: 'all time' };
  function sinceLabel() {
    if (st.period === 'week') return 'this week';
    const k = periodStartKey();
    if (!k) return 'all time';
    return 'since ' + new Date(k + 'T12:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
  }

  const scoped = (rows, ctx) => ctx.isAdmin ? rows : rows.filter(c => c.agentUid === ctx.eff.id);
  const openCases = () => SD().cases().filter(c => (c.state === 'Opened' || c.state === 'Submitted') && !c.closedAt);
  const headlineMoney = (c) => Number(SC().usesAum(c.product) ? c.aum : c.amount) || 0;
  // Investment AUM runs into the millions, where "$4562k" is a number you
  // have to decode. Past a million it reads in millions.
  const fmtMoney = (n) => {
    n = Math.round(Number(n) || 0);
    if (!n) return '';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(Math.abs(n) >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    return U().moneyK(n);
  };
  // How long this case has been sitting where it is. stageAt is stamped on
  // every board move; anything written before that stamp existed falls back
  // to its last touch, which is the closest honest answer we have.
  const stuckDays = (c) => {
    const t = toMs(c.stageAt || c.updatedAt || c.createdAt);
    return t ? Math.max(0, Math.floor((Date.now() - t) / dayMs)) : 0;
  };
  const ageDays = (c) => {
    const t = toMs(c.updatedAt || c.createdAt);
    return t ? Math.max(0, Math.floor((Date.now() - t) / dayMs)) : 0;
  };

  function timeAgo(ms) {
    const m = Math.floor((Date.now() - ms) / 60000);
    if (m < 1) return 'now';
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h';
    const d = Math.floor(h / 24);
    return d === 1 ? 'yesterday' : d + 'd';
  }
  const AV_COLORS = ['#3E5C82', '#2E7D5B', '#6B4E71', '#8a6d2f'];
  function avatar(name) {
    const parts = (name || '?').trim().split(/\s+/);
    const ini = (parts[0] ? parts[0][0] : '?') + (parts[1] ? parts[1][0] : '');
    let hash = 0; for (let i = 0; i < (name || '').length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return `<span style="flex:none;width:22px;height:22px;border-radius:6px;background:${AV_COLORS[hash % AV_COLORS.length]};color:#fff;font-size:9.5px;font-weight:700;display:flex;align-items:center;justify-content:center">${esc(ini.toUpperCase())}</span>`;
  }

  /* ── Drill-down: every number on this page names its cases ──
     A dashboard figure you cannot open is a figure you have to take on
     trust. Clicking one raises the same side panel the household uses and
     lists exactly the opportunities behind it — each one openable, the
     whole set exportable. The panel never recomputes anything: it is
     handed the very rows the chart counted. */
  let lastDrill = null;   // kept so Export writes what you are looking at

  function drillRow(c) {
    const stage = c.closedAt ? 'Closed ✓'
      : c.state === 'Lost' ? ('Lost' + (c.lostReason ? ' · ' + String(c.lostReason).split(' — ')[0] : ''))
      : P().stageLabel(c.product, P().stageForCase(c));
    return `<div class="list-row mid" style="cursor:pointer" data-action="cs-open" data-id="${esc(c.recordId)}">
      <span class="grow" style="min-width:0">
        <span style="font-size:var(--fs-dense);color:var(--navy);font-weight:600">${esc(c.title || c.clientName || '(unnamed)')}</span>
        <span class="cell-sub" style="display:block">${esc(c.clientName || '')}${c.clientName ? ' · ' : ''}${esc(SC().productName(c.product) || '')}</span>
        <span class="cell-sub" style="display:block">${esc(stage)}${c.agentName ? ' · ' + esc(firstName(c.agentName)) : ''}${
          c.closedAt || c.state === 'Lost' ? '' : ` · <span style="${stuckDays(c) >= 30 ? 'color:var(--bad);font-weight:700' : ''}">${stuckDays(c)}d here</span>`}</span>
      </span>
      <span class="end num" style="font-size:var(--fs-dense)">${headlineMoney(c) ? U().moneyK(headlineMoney(c)) : ''}</span>
    </div>`;
  }

  function openDrill(title, sub, list, note) {
    lastDrill = { title: title, list: list.slice() };
    const total = list.reduce((n, c) => n + headlineMoney(c), 0);
    const body = list.length ? list.map(drillRow).join('')
      : '<p class="list-empty">No cases in this slice.</p>';
    if (!RWG.app.openPanel) { U().toast('Panels are not available on this screen'); return; }
    RWG.app.openPanel(`
      <div class="scrim" data-action="close-drawer"></div>
      <aside class="drawer" role="dialog" aria-label="${esc(title)}">
        <div class="drawer-head">
          <div class="dh-top">
            <div style="min-width:0">
              <div class="tag-row mb-8"><span class="chip tier-low">Where this number comes from</span></div>
              <h2>${esc(title)}</h2>
              <div class="dh-sub">${esc(sub)}${total ? ' · ' + U().moneyK(total) : ''}</div>
            </div>
            <div class="flex" style="gap:8px;flex:none">
              ${list.length ? '<button class="drawer-edit" data-action="hm-drill-export" title="Download these rows">⤓ Export</button>' : ''}
              <button class="drawer-close" data-action="close-drawer" aria-label="Close">✕</button>
            </div>
          </div>
        </div>
        <div class="drawer-body">
          ${note ? `<p class="hint" style="margin-top:2px">${note}</p>` : ''}
          <div class="section-title">${list.length} ${list.length === 1 ? 'opportunity' : 'opportunities'}</div>
          ${body}
        </div>
      </aside>`);
  }

  // ── card + row scaffolding (matches My Work's cards) ──────
  function card(title, sub, body, headExtra) {
    return `<div class="card flush">
      <div class="list-head">
        <span class="t">${esc(title)}</span>
        ${sub ? `<span class="s">${sub}</span>` : ''}
        ${headExtra ? `<span class="topbar-spacer"></span>${headExtra}` : ''}
      </div>${body}</div>`;
  }
  const hint = (t) => `<p class="list-hint">${t}</p>`;
  const emptyRow = (t) => `<p class="list-empty">${t}</p>`;

  /* ══ the widgets ══════════════════════════════════════════ */

  /* The three slices behind the pace tiles, defined once.
     Carlos, Aug '26: clicking one of these numbers should open the cases
     that make it up, the same as clicking a funnel number does. Which
     means the tile and the panel explaining the tile are now two readings
     of the same question, and the only safe way to have two is to write
     the question once. `pick` is that question; the tile filters with it
     and so does the drill.

     FYC is life and disability only — fyc() is zero for annuities,
     investments, LTC and plans — so the panel lists exactly the cases
     that put money in the number and nothing that quietly contributes
     zero. Sorted biggest first: opening this asks "what made the week",
     and the answer is at the top. */
  const PACE = {
    fyc: { pick: (c) => SC().deriveCase(c).fyc > 0,
           title: 'FYC closed this week',
           note: 'First-year commission on life and disability closes confirmed this week. Annuities, investments, LTC and plans earn no FYC and are not counted here.' },
    ann: { pick: (c) => c.product === 'annuity',
           title: 'Annuity deposits closed this week',
           note: 'What the client actually deposited on annuities closed this week — not what the firm earns on them.' },
    aum: { pick: (c) => SC().usesAum(c.product),
           title: 'AUM closed this week',
           note: 'Assets brought in on investment closes confirmed this week — not what the firm earns on them.' }
  };
  const paceWeek = (ctx) => scoped(SD().cases(), ctx)
    .filter(c => c.closedAt && SC().weekEndingFor(c.closedAt) === SC().currentWeekEnding());
  const paceList = (kind, ctx) => PACE[kind]
    ? paceWeek(ctx).filter(PACE[kind].pick).sort((a, b) => headlineMoney(b) - headlineMoney(a))
    : [];

  // 1 · Weekly pace — CLOSED this week, against the one target that exists.
  // Closed is what counts: a case written in July that closes today belongs
  // to this week's number. (Written-week production still lives on the
  // scorecard; this row is the money that actually landed.)
  function wPace(ctx) {
    const cur = SC().currentWeekEnding();
    const wk = paceWeek(ctx);
    const fycRows = wk.filter(PACE.fyc.pick);
    const annRows = wk.filter(PACE.ann.pick);
    const aumRows = wk.filter(PACE.aum.pick);
    const fycSum = fycRows.reduce((n, c) => n + SC().deriveCase(c).fyc, 0);
    const annSum = annRows.reduce((n, c) => n + (Number(c.amount) || 0), 0);
    const aumSum = aumRows.reduce((n, c) => n + (Number(c.aum) || 0), 0);
    const goal = ctx.isAdmin ? SC().FYC_PER_WEEK_AT_TARGET : 0;
    const pct = goal ? Math.min(100, Math.round(100 * fycSum / goal)) : 0;
    const daysLeft = Math.max(0, Math.round((Date.parse(cur + 'T12:00:00') - Date.now()) / dayMs));
    /* Clickable, like the funnel bars — a number you cannot open is a
       number you have to take on trust. No tabindex: data-action is
       dispatched on click only, and a focus ring promising a keyboard
       that does nothing is worse than no focus ring. */
    const tile = (kind, label, value, note, barPct, barColor) => `<div class="card pace-tile" style="margin:0"
      data-action="hm-drill" data-kind="${kind}" title="See the cases behind this number">
      <div style="font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:6px">${esc(label)}</div>
      <div><span class="serif" style="font-size:24px;color:var(--navy)">${value}</span></div>
      ${barPct !== null ? `<div style="height:5px;background:var(--field);margin-top:9px;border-radius:3px;overflow:hidden"><div style="height:100%;width:${barPct}%;background:${barColor};border-radius:3px"></div></div>` : ''}
      <div class="cell-sub" style="margin-top:5px;font-size:10.5px">${note}</div>
    </div>`;
    return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:var(--s4)">
      ${tile('fyc', 'FYC closed this week', U().money(Math.round(fycSum)),
        ctx.isAdmin ? pct + '% of the $' + (goal / 1000) + 'k pace · ' + daysLeft + ' day' + (daysLeft === 1 ? '' : 's') + ' left'
          : 'counts toward the team’s ' + U().money(SC().FYC_PER_WEEK_AT_TARGET) + '/week pace',
        ctx.isAdmin ? pct : null, pct >= 100 ? 'var(--good)' : (pct >= 60 ? 'var(--gold)' : 'var(--bad)'))}
      ${tile('ann', 'Annuity deposits closed this week', U().money(Math.round(annSum)),
        annRows.length + ' closed · no weekly target set', null, '')}
      ${tile('aum', 'AUM closed this week', U().money(Math.round(aumSum)),
        aumRows.length + ' closed · no weekly target set', null, '')}
    </div>`;
  }

  // 2 · Conversion funnel — of everything opened in the period, how far it got.
  // The last column an OPEN case may occupy — everything past it is the
  // Closed bucket (Delivery Requirements, then Won), reachable only through
  // the close review.
  const lastWorking = (cols) => {
    let k = 0;
    cols.forEach((s, i) => { if (s.bucket !== 'Closed') k = i; });
    return k;
  };
  function funnelReach(c, cols) {
    const iOf = (sid) => cols.findIndex(s => s.id === sid);
    if (c.closedAt) return cols.length - 1;                       // confirmed — the only real Won
    if (c.state === 'Lost') {
      const i = c.lostFromStage ? iOf(P().aliasStage(c.lostFromStage)) : -1;
      if (i >= 0) return i;
      if (c.submittedAt) return cols.findIndex(s => s.bucket === 'Submitted');
      return 0;
    }
    if (c.pendingClose) return lastWorking(cols);                 // at the door, not through it
    const i = iOf(P().stageForCase(c));
    return i >= 0 ? Math.min(i, lastWorking(cols)) : 0;
  }
  // Where the bar shows it TODAY. Same as reach except for closed business,
  // which rests in its own closed stage — a confirmed close still chasing
  // its delivery receipt sits in Delivery Requirements, visibly, while the
  // close rate above already banked it.
  function funnelSpot(c, cols) {
    if (c.closedAt) {
      const i = cols.findIndex(s => s.id === P().stageForCase(c));
      return (i >= 0 && cols[i].bucket === 'Closed') ? i : cols.length - 1;
    }
    return funnelReach(c, cols);
  }
  /* The pool the funnel is drawn from, factored out so the chart and the
     drill-down can never disagree: both read the same model.

     TWO pools, because this card asks two questions that want different
     denominators — and answering both from one pool is what hid three
     funded cases from Delivery Requirements in August '26:

       LIVE  · where work is sitting right now. Period-independent: a case
               opened in June and stuck since is exactly the pile-up this
               card exists to surface, and hiding it under "this week" made
               the bars lie. The one exception is finished business — the
               final Won stage is not work sitting anywhere, so it counts
               what CLOSED in the period, the same basis as the leaderboard
               and the weekly pace row.
       COHORT· of everything OPENED in the period, how far it got. A close
               rate is only meaningful against a fixed group, so this keeps
               the opened-week filter, and the footer names it out loud. */
  function funnelModel(plId) {
    const pl = (plId && P().pipeline(plId)) || P().pipelines()[0];
    const cols = P().boardStages(pl);
    const start = periodStartKey();
    const onTrack = SD().cases().filter(c => P().pipelineForProduct(c.product).id === pl.id);
    const inPeriod = (stamp) => !start || (!!stamp && SC().weekEndingFor(stamp) >= start);

    // ── the cohort: close rate only ──
    const pool = onTrack.filter(c => !start || (c.openedWeek || '') >= start);
    const cohortReach = pool.map(c => funnelReach(c, cols));
    // reached[i]: got at least this far — that is what a funnel measures, and
    // it is why one case appears on several bars.
    const reached = cols.map((s, i) => cohortReach.filter(x => x >= i).length);

    // ── the live book: where every case is sitting NOW ──
    // finalIdx is the resting place of finished business (Close / Won).
    // Delivery Requirements is a Closed stage too, but the receipt is still
    // outstanding there — that is live work, and it stays on the board.
    const finalIdx = cols.length && cols[cols.length - 1].bucket === 'Closed' ? cols.length - 1 : -1;
    const spot = onTrack.filter(c => c.state !== 'Lost').map(c => ({ c, p: funnelSpot(c, cols) }));
    // here[i]: a case rests in exactly one stage, so these add up to the
    //          live pipeline and never double-count.
    const at = cols.map((s, i) => spot
      .filter(r => r.p === i && (i !== finalIdx || inPeriod(r.c.closedAt)))
      .map(r => r.c));
    const here = at.map(list => list.length);
    const hereMoney = at.map(list => list.reduce((n, c) => n + headlineMoney(c), 0));
    const oldest = at.map(list => list.reduce((n, c) => Math.max(n, stuckDays(c)), 0));
    // Lost is a completion too, not a pile: scoped to what was lost in the
    // period (falling back to its opened week on old rows with no stamp).
    const lost = onTrack.filter(c => c.state === 'Lost'
      && (c.lostAt ? inPeriod(c.lostAt) : (!start || (c.openedWeek || '') >= start)));
    // at[] + lost is the whole live book, with nothing counted twice.
    const reach = spot;   // kept for callers that only read .c

    // The bottleneck: the fullest stage, ties broken by whoever has been
    // waiting longest. Closed business is not a jam, so Won never wins.
    let jam = -1;
    cols.forEach((s, i) => {
      if (s.bucket === 'Closed' || !here[i]) return;
      if (jam < 0 || here[i] > here[jam] || (here[i] === here[jam] && oldest[i] > oldest[jam])) jam = i;
    });
    return { pl, cols, pool, reach, reached, at, here, hereMoney, oldest, lost, jam, finalIdx };
  }

  /* One question, asked the way it gets asked at the Monday meeting:
     WHERE IS WORK PILING UP. Every opportunity appears once, in the stage
     it is actually in, and the fullest stage is called out at the top by
     name — that is the line item the room works on.

     Days matter as much as counts. Four sitting in Waiting on Signature
     for two days is a good week; two sitting there for six weeks is the
     problem. Both are on every row. */
  function funnelCard(plId) {
    const m = funnelModel(plId);
    const cols = m.cols;
    const anyLive = m.here.reduce((n, x) => n + x, 0) + m.lost.length;
    if (!anyLive && !m.pool.length) return `<div class="card flush fn-card">
      <div class="list-head"><span class="t">${esc(m.pl.name)}</span><span class="s">quiet</span></div>
      <p class="list-empty" style="margin:auto 0">Nothing open on this track, and nothing opened ${esc(PERIOD_LABEL[st.period])}.</p>
    </div>`;

    const base = Math.max.apply(null, m.here.concat([1]));

    const rows = cols.map((s, i) => {
      const n = m.here[i];
      const isJam = i === m.jam;
      // An empty stage keeps its rail rather than showing a dash: the row
      // still reads as part of the funnel, quietly, instead of as a gap.
      if (!n) return `<div class="fn-row is-empty">
          <span class="fn-lab">${esc(s.label)}</span>
          <span class="fn-track"></span>
          <span class="fn-side"></span></div>`;
      const w = Math.round(100 * n / base);
      const cls = isJam ? 'is-jam' : (s.bucket === 'Closed' ? 'is-won' : s.bucket === 'Submitted' ? 'is-sub' : 'is-open');
      // Days only when they mean something. "1d oldest" on every row is
      // noise; a stage that has not moved in three weeks is the point.
      const d = m.oldest[i];
      const showDays = d >= 7 && i < cols.length - 1;
      return `<div class="fn-row ${cls}"
          data-action="hm-drill" data-kind="fn-here" data-i="${i}" data-pl="${esc(m.pl.id)}"
          title="See the ${n} sitting in ${esc(s.label)}${d ? ' · oldest ' + d + 'd' : ''}">
          <span class="fn-lab">${esc(s.label)}</span>
          <span class="fn-track"><span class="fn-bar" style="width:${w}%">${n}</span></span>
          <span class="fn-side">
            ${m.hereMoney[i] ? `<span class="fn-money">${fmtMoney(m.hereMoney[i])}</span>` : ''}
            ${showDays ? `<span class="fn-days${d >= 30 ? ' is-late' : d >= 14 ? ' is-warn' : ''}">${d}d</span>` : ''}
          </span></div>`;
    }).join('');

    // Lost cases are on no stage, so they get their own line or the bars
    // quietly fail to add up to what you opened.
    const lostMoney = m.lost.reduce((n, c) => n + headlineMoney(c), 0);
    const lostRow = m.lost.length ? `<div class="fn-row is-lost"
        data-action="hm-drill" data-kind="fn-lost" data-pl="${esc(m.pl.id)}" title="See the ${m.lost.length} lost">
        <span class="fn-lab">Lost</span>
        <span class="fn-track"><span class="fn-bar" style="width:${Math.round(100 * m.lost.length / base)}%">${m.lost.length}</span></span>
        <span class="fn-side">${lostMoney ? `<span class="fn-money">${fmtMoney(lostMoney)}</span>` : ''}</span>
      </div>` : '';

    // The headline: the one stage to talk about, clickable straight to the
    // list of names so the discussion starts from the cases, not the number.
    const jam = m.jam;
    const banner = jam >= 0 ? `<div class="fn-banner" data-action="hm-drill" data-kind="fn-here" data-i="${jam}" data-pl="${esc(m.pl.id)}"
        title="See the ${m.here[jam]} sitting in ${esc(cols[jam].label)}">
        <span class="fn-banner-k">Piling up</span>
        <span class="fn-banner-v">${esc(cols[jam].label)}</span>
        <span class="fn-banner-s">${m.here[jam]}${
          m.oldest[jam] ? ' · ' + m.oldest[jam] + 'd' : ''}${
          m.hereMoney[jam] ? ' · ' + fmtMoney(m.hereMoney[jam]) : ''}</span>
      </div>` : '';

    // The close rate reads the cohort, and says so — '25% of 4 closed' with
    // no denominator named is the line that made the bars look wrong.
    const wonPct = m.reached[0] ? Math.round(100 * m.reached[m.reached.length - 1] / m.reached[0]) : 0;
    // 'In play' is outstanding work: everything on the board plus the
    // delivery receipts still owed. Finished business is not in play.
    const inPlay = m.here.reduce((n, x, i) => i === m.finalIdx ? n : n + x, 0);
    return `<div class="card flush fn-card">
      <div class="list-head"><span class="t">${esc(m.pl.name)}</span>
        <span class="s">${inPlay} in play</span></div>
      ${banner}
      <div class="fn-body">${rows}${lostRow}</div>
      <div class="fn-foot" title="Bars show where every case is sitting right now. This line is a cohort: of what was opened ${esc(PERIOD_LABEL[st.period])}, how much has closed.">${
        m.reached[0]
          ? `<b>${wonPct}%</b> of ${m.reached[0]} opened ${esc(PERIOD_LABEL[st.period])} closed`
          : `nothing opened ${esc(PERIOD_LABEL[st.period])}`}</div>
    </div>`;
  }

  /* All three tracks at once. Insurance, investments and planning run on
     different stages and different clocks, and a selector meant you could
     only ever see one of them — so a jam on a track you were not looking
     at was a jam nobody was looking at. Side by side on a desk, stacked on
     a phone. */
  function wFunnel(ctx) {
    const pls = P().pipelines();
    if (!pls.length) return '';
    return `<div class="hm-funnels" style="--fn-count:${pls.length}">
      ${pls.map(p => funnelCard(p.id)).join('')}
    </div>`;
  }

  // 3 · Needs help moving — the Monday list.
  function wStale(ctx) {
    const rows = [];
    if (ctx.isAdmin) {
      SD().cases().filter(c => c.pendingClose && !c.closedAt).forEach(c => rows.push({
        c, stuck: 'Awaiting your close', days: Math.max(0, Math.floor((Date.now() - toMs(c.pendingCloseAt || c.updatedAt)) / dayMs)),
        owner: 'you', hot: false
      }));
    }
    scoped(openCases(), ctx).filter(c => !c.pendingClose)
      .map(c => ({ c, stuck: P().stageLabel(c.product, P().stageForCase(c)), days: ageDays(c), owner: firstName(c.agentName), hot: true }))
      .filter(x => x.days >= 7)
      .forEach(x => rows.push(x));
    rows.sort((a, b) => b.days - a.days);
    const top = rows.slice(0, 7);
    if (!top.length) return card('Needs help moving', '', emptyRow('Nothing stuck — everything open has been touched inside a week.'));
    const tbl = `<div class="table-wrap"><table class="data" style="font-size:12.5px">
      <thead><tr><th>Case</th><th>Stuck on</th><th class="num">Days</th><th>Owner</th></tr></thead>
      <tbody>${top.map(x => `<tr class="cs-row" data-action="cs-open" data-id="${esc(x.c.recordId)}">
        <td><span class="cell-name">${esc(x.c.clientName || '(no name)')} · ${esc(SC().productName(x.c.product))}</span></td>
        <td><span class="cell-sub">${esc(x.stuck)}</span></td>
        <td class="num" style="${x.days >= 14 ? 'color:var(--bad);font-weight:700' : ''}">${x.days}</td>
        <td><span class="cell-sub">${esc(x.owner)}</span></td>
      </tr>`).join('')}</tbody></table></div>`;
    return card('Needs help moving', String(top.length), tbl + hint('Sorted oldest first. This is the Monday list.'));
  }

  /* "Where cases are sitting" lived here. It was the same count as the
     funnel's own bars, on the same stages, one track at a time — so with
     all three funnels on the page it was the same picture drawn twice. */

  // 5 · Important dates — the whole merged feed (birthdays with milestone
  // flags, policy anniversaries, custom dates), same truth as the Key
  // dates screen. Falls back to plain birthdays if that module is absent.
  function wDates(ctx) {
    if (!H().isStarted()) return card('Important dates', 'next 30 days', emptyRow('Loading the book…'));
    const feed = RWG.dates ? RWG.dates.upcoming(30).slice(0, 8)
      : H().upcomingBirthdays(30).slice(0, 8).map(b => ({
          icon: '🎂', title: H().contactName(b.contact) + ' turns ' + b.turning,
          sub: '', advisor: '', hhId: b.contact.householdId, inDays: b.inDays, milestone: null
        }));
    if (!feed.length) return card('Important dates', 'next 30 days', emptyRow('No key dates inside 30 days. Birthdays, anniversaries and custom dates appear as the book fills in.'));
    const rows = feed.map(e => `<div class="list-row" style="gap:9px">
      <span style="flex:none">${e.icon}</span>
      <span style="min-width:0;flex:1"><span style="font-size:13px;color:var(--ink);font-weight:600;${e.hhId ? 'cursor:pointer' : ''}" ${e.hhId ? `data-action="hh-goto" data-id="${esc(e.hhId)}"` : ''}>${esc(e.title)}</span>
      <span class="cell-sub" style="display:block">${esc(e.sub || '')}${e.advisor ? (e.sub ? ' · ' : '') + esc(firstName(e.advisor)) : ''}</span>
      ${e.milestone ? `<span class="chip tier-gold" style="font-size:10px;margin-top:2px">${U().icon('spark','ic-inline')} ${esc(e.milestone)}</span>` : ''}</span>
      <span class="cell-sub" style="flex:none">${e.inDays === 0 ? 'today' : 'in ' + e.inDays + 'd'}</span>
    </div>`).join('');
    return card('Important dates', 'next 30 days · whole book', rows,
      `<button class="btn btn-quiet btn-sm" data-action="home-open" data-view="dates">All dates →</button>`);
  }

  // 6 · Team activity — synthesised from the stamps already on the data,
  //     plus the one kind of entry somebody actually chose to write.
  /* ── What counts as team activity ────────────────────────
     Carlos, 22 Aug '26: "what do you consider a Team Activity to add
     here?" The test is whether somebody else at the firm would want to
     know, unprompted, on a Monday morning. Money moving, a client
     arriving, a decision being made: yes. Housekeeping: no.

     So it carries the life of a case — opened, moved, written, pushed to
     close, closed, lost, brought back — plus the book growing (a lead
     converted, a household or a person added) and the work finished on
     top of it.

     Two things are deliberately NOT here. Tasks being CREATED: assigning
     work is not news, finishing it is, and a firm of five assigns dozens a
     week — the feed would become a to-do list nobody reads. And edits: a
     phone number corrected at four in the afternoon is not something
     anybody needs told.

     One row per case per event, and a stage move is suppressed when it IS
     one of the other events — writing a case moves it to Application, and
     the feed should say "wrote", once, not "wrote" and "moved to
     Application" a second apart. */
  function wActivity(ctx) {
    const ev = [];
    const cutoff = Date.now() - 30 * dayMs;
    const push = (ts, who, txt, sub, extra) => { if (ts && ts >= cutoff) ev.push(Object.assign({ ts, who, txt, sub }, extra || {})); };
    const userName = (uid) => { const u = uid && D().user(uid); return (u && u.name) || ''; };
    const P = RWG.pipelines;
    SD().cases().forEach(c => {
      const label = (c.clientName || '(no name)') + ' · ' + SC().productName(c.product);
      // Every case row opens the case — the answer to "what is this?" is
      // the record itself, one click away.
      const go = { goAct: 'cs-open', goId: c.recordId };
      if (c.closedAt) push(toMs(c.closedAt), c.agentName, `<b>${esc(label)}</b> closed and confirmed`, 'verified by a partner', go);
      if (c.pendingClose && !c.closedAt) push(toMs(c.pendingCloseAt), c.agentName, `pushed <b>${esc(label)}</b> to Close / Won`, 'waiting on a partner', go);
      if (c.lostAt) push(toMs(c.lostAt), userName(c.lostBy) || c.agentName, `marked <b>${esc(label)}</b> lost`, (c.lostReason || '').split(' — ')[0], go);
      if (c.submittedAt && !c.closedAt && c.state !== 'Lost') push(toMs(c.submittedAt), c.agentName, `wrote <b>${esc(label)}</b>`, 'new business submitted', go);
      // Brought back from lost (22 Aug '26) — rare, and worth saying.
      if (c.reopenedAt) push(toMs(c.reopenedAt), userName(c.reopenedBy) || c.agentName,
        `reopened <b>${esc(label)}</b>`, String(c.reopenedFrom || '').split(' — ')[0], go);
      // Opened. The feed used to say nothing about a case until it was
      // written, so weeks of early work were invisible on this screen.
      if (c.createdAt) push(toMs(c.createdAt), userName(c.createdBy) || c.agentName,
        `opened <b>${esc(label)}</b>`, SC().sourceLabel ? SC().sourceLabel(c.source) : '', go);
      /* Moved. This is the pulse of the board — the thing the team does
         most days — and it was the largest gap in the feed. stageAt holds
         only the LAST move, so this is one row per case however many times
         it has travelled, which is what keeps it from drowning everything
         else. Suppressed when the move IS another event already reported. */
      const mAt = toMs(c.stageAt);
      if (mAt && c.state !== 'Lost' && !c.closedAt && !c.pendingClose) {
        const near = [toMs(c.submittedAt), toMs(c.createdAt), toMs(c.reopenedAt)]
          .some(t => t && Math.abs(t - mAt) < 60000);
        const stage = P && P.stageLabel ? P.stageLabel(c.product, c.stageId) : '';
        if (!near && stage) push(mAt, c.agentName, `moved <b>${esc(label)}</b> to ${esc(stage)}`, '', go);
      }
    });
    if (T().isStarted()) T().all().forEach(t => {
      if (t.status === 'done' && t.doneAt) push(t.doneAt, userName(t.doneBy) || t.assigneeName,
        `completed <b>${esc(t.title)}</b>`, t.relatedLabel || (t.workflowName ? t.workflowName + ' workflow' : ''),
        { goAct: 'tk-edit', goId: t.id });
    });
    if (H().isStarted()) {
      H().households().forEach(h => {
        const go = { goAct: 'hh-goto', goId: h.id };
        push(toMs(h.createdAt), h.advisorName, `added <b>${esc(h.name)}</b> to the book`, h.source || '', go);
        /* A lead becoming a client is the single most consequential thing
           that happens to a name in this system, and it was not on the
           feed at all. */
        if (h.convertedAt) push(toMs(h.convertedAt), userName(h.convertedBy) || h.advisorName,
          `converted <b>${esc(h.name)}</b> from a lead`, 'now a household in the book', go);
      });
      // People, not only families: a spouse or an adult child added to an
      // existing household never showed here.
      (H().contacts() || []).forEach(p => {
        if (!p.createdAt) return;
        const hh = p.householdId && H().household(p.householdId);
        push(toMs(p.createdAt), (hh && hh.advisorName) || '', `added <b>${esc(H().contactName(p))}</b>`,
          hh ? 'to ' + hh.name : 'a new contact', { goAct: 'ct-open', goId: p.id });
      });
    }
    // Posted updates. These are the only entries a person wrote on purpose,
    // so they carry the words themselves rather than a generated sentence.
    const me = RWG.auth.currentUser();
    if (RWG.notes && RWG.notes.isStarted()) RWG.notes.all().forEach(n => push(
      n.createdAt, n.authorName, 'said', n.relatedLabel || '',
      { body: n.bodyHtml || n.body, noteId: n.id, mine: !!(me && n.authorUid === me.id) || ctx.isAdmin }));
    ev.sort((a, b) => b.ts - a.ts);
    /* Fifteen, not nine (Carlos, 22 Aug '26). Nine was set when the feed
       reported four kinds of event; it now reports eleven, so the same
       nine rows covered a good deal less of the day. The dashboard flows
       its widgets into balanced columns rather than a fixed grid, so a
       taller card rebalances the columns instead of leaving a hole beside
       a short one — which is why this can simply be a longer list rather
       than a short list with a scrollbar in it. */
    const top = ev.slice(0, 15);
    if (!top.length) return card('Team activity', 'last 30 days', emptyRow('Quiet so far — moves, closes and completed steps land here as they happen.'));
    /* Clickable, because "what is that?" is the question this list
       provokes and it had no answer. Each row carries the record it is
       about; the ✕ on your own posted update stays a nested target and
       the innermost one wins, so deleting an update never opens a
       record on the way past. */
    const rows = top.map(e => `<div class="list-row${e.goAct ? ' hm-act' : ''}" style="gap:9px"
      ${e.goAct ? `data-action="${esc(e.goAct)}" data-id="${esc(e.goId)}" title="Open this"` : ''}>
      ${avatar(e.who)}
      <span style="min-width:0;flex:1"><span style="font-size:12.5px;color:var(--ink)">${esc(firstName(e.who))} ${e.txt}</span>
      ${e.body ? `<span class="hm-note-body">${U().noteHtml(e.body)}</span>` : ''}
      ${e.sub ? `<span class="cell-sub" style="display:block;font-size:11px">${esc(e.sub)}</span>` : ''}</span>
      ${e.noteId && e.mine ? `<button class="btn btn-quiet btn-sm" style="flex:none;padding:1px 7px" data-action="hm-note-del" data-id="${esc(e.noteId)}" title="Delete this update">✕</button>` : ''}
      <span class="cell-sub" style="flex:none;font-size:11px">${timeAgo(e.ts)}</span>
    </div>`).join('');
    return card('Team activity', 'live', rows);
  }

  /* One rule for "what is on this person's plate right now", asked in two
     places: the card below, and the reminder that opens over the whole
     screen when somebody signs in. It lives here once, because a window
     that lists a task the card underneath it does not is a window nobody
     believes a second time.

     Same rule as the Tasks page and the nav badge: a workflow step
     waiting on an earlier step is not on anybody's morning list yet. */
  function dueNow(uid) {
    if (!T().isStarted()) return [];
    const today = T().todayKey();
    const held = (RWG.wf && RWG.wf.blockedIds) ? RWG.wf.blockedIds() : {};
    return T().openFor(uid).filter(t => t.dueDate && t.dueDate <= today && !held[t.id])
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  }

  // 7 · My tasks today — the short list, checkable right here.
  function wMyTasks(ctx) {
    if (!T().isStarted()) return card('My tasks today', '', emptyRow('Loading…'));
    const today = T().todayKey();
    const due = dueNow(ctx.eff.id);
    const body = due.length ? due.slice(0, 7).map(t => `<div class="flex" style="gap:10px;padding:9px var(--pad-panel);border-bottom:1px solid rgba(14,36,64,.06);align-items:flex-start">
        <input type="checkbox" data-action="tk-done" data-id="${esc(t.id)}" style="margin-top:2px">
        <span style="min-width:0;flex:1;font-size:13px;color:var(--ink)">${esc(t.title)}
          ${t.workflowName ? `<span class="chip tier-gold" style="font-size:10px;margin-left:4px">${U().icon('workflow','ic-inline')} ${esc(t.workflowName)}</span>` : ''}</span>
        <span style="flex:none;font-size:11px;${t.dueDate < today ? 'color:var(--bad);font-weight:700' : 'color:var(--warn);font-weight:700'}">${t.dueDate < today ? 'late' : 'today'}</span>
      </div>`).join('')
      : emptyRow('Clear. Nothing due today.');
    return card('My tasks today', due.length ? String(due.length) : '',
      body, `<button class="btn btn-quiet btn-sm" data-action="home-open" data-view="mywork">All tasks →</button>`);
  }

  /* ── The morning reminder ─────────────────────────────────
     Carlos, Aug '26: "a pop up reminder of the tasks that are due that
     day, so that they don't forget what they have to do that day."
     The card above has been sitting on this screen since the dashboard
     shipped and people still walked past it — a card you can look past
     is not a reminder. So the same list, once, standing in front of the
     screen, with the checkboxes still live: "I already did that" should
     cost one click, not a trip to another page.

     Once per sign-in rather than once per day. The flag lives in
     sessionStorage, which dies with the tab: moving around the app all
     morning never brings the window back, and leaving for lunch and
     coming back to a fresh tab does. The date is in the key as well, so
     a browser left open overnight opens tomorrow on the new day's list
     instead of yesterday's silence.

     Nothing due, nothing shown. A window that says "you have nothing to
     do" is a window that teaches people to close windows unread. */

  const REM_MAX = 8;   // a morning glance, not a backlog review
  /* Keyed to the SIGN-IN, not to the tab. Carlos asked for this "every
     time they log into the system — if they leave and then they come back
     later". sessionStorage alone answered most of that (moving around the
     app never re-opens it; a fresh tab does) but missed the case he
     actually described in words: signing out and back in at the same desk,
     which leaves the tab, and its storage, exactly where they were. The
     sign-in stamp is in the key, so that is a different key and a fresh
     reminder. The date is still in it too, for a screen left open past
     midnight. */
  const remKey = (uid) => 'rwg.home.remind.' + uid + '.' + T().todayKey()
    + '.' + ((RWG.auth && RWG.auth.sessionAt && RWG.auth.sessionAt()) || 0);

  /* sessionStorage can be missing or refused outright (private windows,
     the odd embedded browser). The in-memory flag is what actually
     guarantees "once" inside a page; storage only carries that answer
     across a reload of the same tab. If it throws we lose the reload,
     not the manners. */
  function remDecided(key) {
    if (st.remindFor === key) return true;
    try { return sessionStorage.getItem(key) === '1'; } catch (e) { return false; }
  }
  function remDecide(key) {
    st.remindFor = key;
    try { sessionStorage.setItem(key, '1'); } catch (e) {}
  }

  // Counting out loud, in the words a person would use.
  function remLine(n, late) {
    const head = n + ' task' + (n === 1 ? ' is' : 's are') + ' on your list today';
    if (!late) return head + '.';
    if (late === n) return head + (n === 1 ? ', and it is already late.' : ', and every one is already late.');
    return head + ' — ' + late + ' of them already late.';
  }

  // The rows are the card's rows, deliberately: same checkbox, same
  // late/today marker, so the window and the card read as one thing.
  function remBody(due, today) {
    if (!due.length) return emptyRow('That is everything due today.');
    const rest = due.length - Math.min(due.length, REM_MAX);
    return due.slice(0, REM_MAX).map(t => `<div class="flex" style="gap:10px;padding:9px 2px;border-bottom:1px solid rgba(14,36,64,.06);align-items:flex-start">
        <input type="checkbox" data-action="tk-done" data-id="${esc(t.id)}" style="margin-top:2px" aria-label="Mark done: ${esc(t.title)}">
        <span style="min-width:0;flex:1;font-size:13.5px;color:var(--ink)">${esc(t.title)}
          ${t.workflowName ? `<span class="chip tier-gold" style="font-size:10px;margin-left:4px">${U().icon('workflow','ic-inline')} ${esc(t.workflowName)}</span>` : ''}
          ${t.relatedLabel ? `<span class="cell-sub" style="display:block">${esc(t.relatedLabel)}</span>` : ''}</span>
        <span style="flex:none;font-size:11px;${t.dueDate < today ? 'color:var(--bad);font-weight:700' : 'color:var(--warn);font-weight:700'}">${t.dueDate < today ? 'late' : 'today'}</span>
      </div>`).join('')
      + (rest ? hint(rest + ' more waiting on your tasks page.') : '');
  }

  function remindHtml(due, today) {
    const late = due.filter(t => t.dueDate < today).length;
    return `
      <div class="scrim" data-action="close-modal"></div>
      <div class="modal-card modal-sm" id="hm-remind" role="dialog" aria-modal="true" aria-label="Your list for today">
        <div class="modal-head">
          <h2>Before you start</h2>
          <p id="hm-remind-sub">${esc(remLine(due.length, late))} Tick anything you have already done.</p>
          <button class="drawer-close" data-action="close-modal" aria-label="Close">✕</button>
        </div>
        <div class="modal-body" id="hm-remind-body">${remBody(due, today)}</div>
        <div class="modal-foot">
          <button class="btn btn-quiet" data-action="close-modal">Close</button>
          <button class="btn btn-gold" data-action="home-open" data-view="mywork">Open my tasks</button>
        </div>
      </div>`;
  }

  /* Keep an open window honest. Ticking a row calls for a full render —
     that is how we get back here — and the window lives outside
     #main-content, so it survives the paint untouched and would go on
     listing a task that is now done. Says whether it was on screen. */
  function remRefresh() {
    const body = document.getElementById('hm-remind-body');
    if (!body) return false;
    const me = RWG.auth.currentUser();
    if (!me) return false;
    const today = T().todayKey();
    const due = dueNow(me.id);
    body.innerHTML = remBody(due, today);
    const sub = document.getElementById('hm-remind-sub');
    if (sub) {
      sub.textContent = due.length
        ? remLine(due.length, due.filter(t => t.dueDate < today).length) + ' Tick anything you have already done.'
        : 'Nothing left on your list for today.';
    }
    return true;
  }

  // Leaving Home takes the window with it: nav() paints the next screen
  // underneath and would otherwise leave this one hanging over it.
  function remClose() {
    const m = document.getElementById('modal-mount');
    if (m && m.querySelector && m.querySelector('#hm-remind')) m.innerHTML = '';
  }

  function maybeRemind() {
    const me = RWG.auth.currentUser();
    if (!me) return;

    /* A partner reading somebody else's cockpit through View As is
       borrowing a screen, not starting a day. Their tasks are not the
       partner's to be reminded of, and the partner's own list is not
       what this screen is showing — so no window either way while it
       is on. Checked two ways because they answer slightly different
       questions: the flag says "we are impersonating", the comparison
       catches any other route to a stand-in identity. */
    const app = RWG.app || {};
    if (app.state && app.state.viewAs) return;
    const eff = app.effectiveUser ? app.effectiveUser() : me;
    if (eff && eff.id !== me.id) return;

    /* Tasks arrive from Firestore a moment after this screen first
       paints, and onEnter runs after EVERY paint — including the one
       the task listener itself asks for when the data lands. So there
       is nothing to schedule here: we simply decline to answer until
       the cache has actually delivered. isStarted() is not that
       promise; it turns true the instant init() is called, with the
       cache still empty. An empty cache means either "not here yet" or
       "the firm has no tasks at all", and in the second case nothing is
       due either — so waiting forever and showing nothing are the same
       answer, and neither of them is a wrong one. */
    if (!T().isStarted() || !T().all().length) return;

    const key = remKey(me.id);
    if (remDecided(key)) return;

    /* Never barge in over a window somebody already has open. Left
       undecided on purpose, so it comes up on the next paint once that
       window is shut rather than being skipped for the session. */
    const mount = document.getElementById('modal-mount');
    if (!mount || mount.firstElementChild) return;
    const m2 = document.getElementById('modal-mount-2');
    if (m2 && m2.firstElementChild) return;

    /* Decided BEFORE we know the answer, and that is the point: with
       nothing due there is no window, and a task assigned at eleven in
       the morning must not then spring one open over whatever they were
       doing. The reminder belongs to arriving, not to the day. */
    remDecide(key);
    const today = T().todayKey();
    const due = dueNow(me.id);
    if (!due.length) return;
    mount.innerHTML = remindHtml(due, today);
  }

  // One entry point, called after every paint of Home.
  function remindTick() {
    if (remRefresh()) return;   // already up: keep it in step, never re-open it
    maybeRemind();
  }

  // 8 · Pipeline forecast — what the open book is worth if it lands.
  function wForecast(ctx) {
    const open = scoped(openCases(), ctx);
    const sub = open.filter(c => c.state === 'Submitted');
    const opened = open.filter(c => c.state === 'Opened');
    const rev = (list) => list.reduce((n, c) => n + SC().deriveCase(c).revenue, 0);
    const line = (label, list) => `<div class="flex" style="padding:10px var(--pad-panel);border-bottom:1px solid rgba(14,36,64,.06);align-items:baseline;gap:9px">
      <span style="font-size:12.5px;color:var(--ink)">${label}</span><span class="topbar-spacer"></span>
      <span class="cell-sub">${list.length} case${list.length === 1 ? '' : 's'}</span>
      <span class="serif" style="font-size:17px;color:var(--navy)">${U().money(Math.round(rev(list)))}</span></div>`;
    return card('Pipeline forecast', ctx.isAdmin ? 'whole team' : 'your book',
      line('Written, not yet closed', sub) + line('Opened, not yet written', opened)
      + hint('Revenue at each case’s own rate if everything lands. Reality lands lower — the funnel says how much.'));
  }

  // 9 · Lost reasons — the only honest record of why business dies.
  function wLostReasons(ctx) {
    const cutoff = Date.now() - 90 * dayMs;
    const lost = SD().cases().filter(c => c.state === 'Lost' && toMs(c.lostAt) >= cutoff);
    if (!lost.length) return card('Lost reasons', 'last 90 days', emptyRow('Nothing lost in 90 days.'));
    const by = {};
    lost.forEach(c => { const r = (c.lostReason || 'Other').split(' — ')[0]; by[r] = (by[r] || 0) + 1; });
    const rows = Object.keys(by).map(r => ({ r, n: by[r] })).sort((a, b) => b.n - a.n).slice(0, 6);
    const max = rows[0].n;
    return card('Lost reasons', lost.length + ' lost · last 90 days',
      `<div style="padding:8px 0 6px">${rows.map(x => `<div class="flex" style="gap:9px;align-items:center;padding:5px var(--pad-panel)">
        <span class="oc-lab">${esc(x.r)}</span>
        <span style="flex:1;height:12px;background:var(--field);border-radius:3px;overflow:hidden"><span style="display:block;height:100%;width:${Math.round(100 * x.n / max)}%;background:var(--bad);opacity:.75;border-radius:3px"></span></span>
        <span style="width:20px;flex:none;text-align:right;font-size:10.5px">${x.n}</span></div>`).join('')}</div>`);
  }

  // 10 · Recurring book — captured, never counted.
  function wRenewals(ctx) {
    const rows = SD().cases().filter(c => c.closedAt && Number(c.renewalAnnual) > 0);
    const sum = rows.reduce((n, c) => n + Number(c.renewalAnnual), 0);
    return card('Recurring book', '',
      `<div style="padding:14px var(--pad-panel) 4px"><span class="serif" style="font-size:26px;color:var(--navy)">${U().money(Math.round(sum))}</span>
       <span class="cell-sub" style="margin-left:7px">a year · ${rows.length} polic${rows.length === 1 ? 'y' : 'ies'}</span></div>`
      + hint('Renewals captured at close. Reporting only — never counted in production, by decision.'));
  }

  // 11 · Leads not worked — new, zero attempts.
  function wLeadsIdle(ctx) {
    const mine = (l) => ctx.isAdmin || l.assignedTo === ctx.eff.id;
    const idle = D().leadsRaw().filter(l => mine(l) && l.stage === 'New' && !(l.attempts > 0))
      .sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt));
    if (!idle.length) return card('Leads not worked', '', emptyRow('Every lead has at least one attempt. As it should be.'));
    const rows = idle.slice(0, 6).map(l => {
      const days = Math.floor((Date.now() - toMs(l.createdAt)) / dayMs);
      return `<div class="list-row mid" style="gap:9px">
        <span style="min-width:0;flex:1;font-size:13px;color:var(--ink);font-weight:600;cursor:pointer" data-action="open-lead" data-id="${esc(l.id)}">${esc(D().fullName(l))}</span>
        <span class="cell-sub" style="flex:none">${days}d untouched</span></div>`;
    }).join('');
    return card('Leads not worked', String(idle.length), rows + hint('New leads with zero attempts, oldest first.'));
  }

  // 12 · AdvisorStream queue — every prospect goes on the newsletter.
  function wAsQueue(ctx) {
    if (!H().isStarted()) return card('AdvisorStream queue', '', emptyRow('Loading the book…'));
    const q = H().contacts().filter(c => !c.advisorstream);
    if (!q.length) return card('AdvisorStream queue', '', emptyRow('Everyone in the book is on the newsletter. ✓'));
    const rows = q.slice(0, 6).map(c => `<div class="list-row mid" style="gap:9px">
      <span style="min-width:0;flex:1;font-size:13px;color:var(--ink);font-weight:600;cursor:pointer" data-action="ct-open" data-id="${esc(c.id)}">${esc(H().contactName(c))}</span>
      <span class="cell-sub" style="flex:none">not subscribed</span></div>`).join('');
    return card('AdvisorStream queue', String(q.length) + ' to add', rows
      + hint('Every prospect goes on the weekly newsletter. Toggle it on the household’s people table.'));
  }

  /* 16 · Closed mix — revenue by product type, as a doughnut.
     Revenue, not FYC: fyc() is zero for annuities and investments by
     design, so a per-product chart drawn on it would show two empty
     slices. This is the same number the leaderboard ranks people by,
     so the two cards always agree.

     Drawn by hand in SVG. No chart library to load, nothing to keep
     in sync with the stylesheet, and it inherits the page's colours. */

  // Stable per product, so a slice never changes colour between renders.
  const PRODUCT_COLOR = {
    wl: '#C2A14D', annuity: '#3E5C82', inv: '#2E7D5B', term: '#8a6d2f',
    ltc: '#6B4E71', di: '#B0691F', plan: '#5C6B7E'
  };

  function donutSvg(slices, total) {
    const size = 168, r = 66, cx = size / 2, cy = size / 2, stroke = 26;
    const circ = 2 * Math.PI * r;
    // One slice is a full ring — an arc can't express 360° without closing
    // on itself, and a hairline gap there reads as a rendering fault.
    if (slices.length === 1) {
      return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img"
        aria-label="${esc(slices[0].name)} is all of the ${U().money(Math.round(total))} closed">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${slices[0].color}" stroke-width="${stroke}"/>
      </svg>`;
    }
    let at = 0;
    const arcs = slices.map(s => {
      const len = circ * (s.value / total);
      const gap = 2;   // a hair of paper between slices
      const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${stroke}"
        stroke-dasharray="${Math.max(0, len - gap)} ${circ - Math.max(0, len - gap)}"
        stroke-dashoffset="${-at}" transform="rotate(-90 ${cx} ${cy})" style="cursor:pointer"
        data-action="hm-drill" data-kind="mix" data-id="${esc(s.id)}"><title>${esc(s.name)}: ${U().money(Math.round(s.value))} — click for the cases</title></circle>`;
      at += len;
      return seg;
    }).join('');
    const label = slices.map(s => `${s.name} ${Math.round(100 * s.value / total)}%`).join(', ');
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img"
      aria-label="Closed revenue by product: ${esc(label)}">${arcs}</svg>`;
  }

  function wClosedMix(ctx) {
    const start = periodStartKey();
    const closed = scoped(SD().cases(), ctx)
      .filter(c => c.closedAt && (!start || SC().weekEndingFor(c.closedAt) >= start));

    const by = {};
    closed.forEach(c => {
      const rev = SC().deriveCase(c).revenue;
      if (!(rev > 0)) return;
      const k = c.product || 'other';
      (by[k] = by[k] || { n: 0, rev: 0 });
      by[k].n++; by[k].rev += rev;
    });
    const slices = Object.keys(by)
      .map(k => ({ id: k, name: SC().productName(k) || k, value: by[k].rev, n: by[k].n, color: PRODUCT_COLOR[k] || '#5C6B7E' }))
      .sort((a, b) => b.value - a.value);
    const total = slices.reduce((n, s) => n + s.value, 0);

    if (!total) {
      return card('Closed by product', PERIOD_LABEL[st.period],
        emptyRow('No confirmed closes ' + PERIOD_LABEL[st.period] + ' yet. Slices appear as partners confirm business.'));
    }

    const legend = slices.map(s => `<div class="dn-row" style="cursor:pointer"
        data-action="hm-drill" data-kind="mix" data-id="${esc(s.id)}"
        title="See the ${s.n} ${esc(s.name)} case${s.n === 1 ? '' : 's'} behind this">
        <span class="dn-dot" style="background:${s.color}"></span>
        <span class="dn-name">${esc(s.name)}</span>
        <span class="dn-val num">${U().moneyK(Math.round(s.value))}</span>
        <span class="dn-pct num">${Math.round(100 * s.value / total)}%</span>
      </div>`).join('');

    return card('Closed by product', 'revenue · ' + PERIOD_LABEL[st.period], `
      <div class="dn-wrap">
        <div class="dn-chart">
          ${donutSvg(slices, total)}
          <div class="dn-center">
            <span class="dn-total serif">${U().moneyK(Math.round(total))}</span>
            <span class="dn-sub">${closed.length} case${closed.length === 1 ? '' : 's'}</span>
          </div>
        </div>
        <div class="dn-legend">${legend}</div>
      </div>`
      + hint((ctx.isAdmin
        ? 'Confirmed closes only — a case pushed to Won but not yet stamped by a partner is not in here.'
        : 'Your closes. Confirmed ones only.') + ' Click a slice to see the cases behind it.'));
  }

  // 13 · Team leaderboard — per-person revenue, partners only.
  function wLeaderboard(ctx) {
    if (!ctx.isAdmin) return '';
    const start = periodStartKey();
    const closed = SD().cases().filter(c => c.closedAt && (!start || SC().weekEndingFor(c.closedAt) >= start));
    if (!closed.length) return card('Team leaderboard', PERIOD_LABEL[st.period], emptyRow('No confirmed closes ' + PERIOD_LABEL[st.period] + ' yet.'));
    const by = {};
    closed.forEach(c => {
      const k = c.agentName || '—';
      (by[k] = by[k] || { n: 0, rev: 0 });
      by[k].n++; by[k].rev += SC().deriveCase(c).revenue;
    });
    const rows = Object.keys(by).map(k => ({ k, n: by[k].n, rev: by[k].rev })).sort((a, b) => b.rev - a.rev);
    const max = rows[0].rev || 1;
    return card('Team leaderboard', 'closed revenue · ' + PERIOD_LABEL[st.period],
      `<div style="padding:8px 0 6px">${rows.map((x, i) => `<div class="flex" style="gap:9px;align-items:center;padding:5px var(--pad-panel)">
        <span class="cell-sub" style="width:14px;flex:none">${i + 1}</span>
        <span style="width:110px;flex:none;font-size:12px;color:var(--ink);font-weight:600">${esc(firstName(x.k))}</span>
        <span style="flex:1;height:12px;background:var(--field);border-radius:3px;overflow:hidden"><span style="display:block;height:100%;width:${Math.round(100 * x.rev / max)}%;background:var(--gold);border-radius:3px"></span></span>
        <span style="width:72px;flex:none;text-align:right;font-size:11px">${U().moneyK(Math.round(x.rev))} · ${x.n}</span></div>`).join('')}</div>`
      + hint('Partner-only, like everything per-person.'));
  }

  // 15 · Service desk — the post-close queue at a glance.
  function wService(ctx) {
    const sv = RWG._serviceModule;
    if (!sv || !T().isStarted()) return card('Service desk', '', emptyRow('Loading…'));
    const open = sv.openQ(), waiting = sv.waitingQ();
    if (!open.length && !waiting.length) return card('Service desk', '', emptyRow('The desk is clear — nothing open, nothing waiting.'));
    const today = T().todayKey();
    const rows = open.slice().sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'))).slice(0, 6)
      .map(t => `<div class="list-row mid" style="gap:9px">
        <span style="flex:none">${U().icon('service','ic-sm')}</span>
        <span style="min-width:0;flex:1"><span style="font-size:13px;color:var(--ink);font-weight:600;${t.relatedId && U().relAction(t.relatedType) ? 'cursor:pointer' : ''}"
          ${t.relatedId && U().relAction(t.relatedType) ? `data-action="${U().relAction(t.relatedType)}" data-id="${esc(t.relatedId)}"` : ''}>${esc(t.title)}</span>
        <span class="cell-sub" style="display:block;font-size:11px">${esc(t.serviceType || '')} · ${esc(firstName(t.assigneeName))}</span></span>
        <span style="flex:none;font-size:11.5px;${t.dueDate && t.dueDate < today ? 'color:var(--bad);font-weight:700' : 'color:var(--muted)'}">${t.dueDate && t.dueDate < today ? 'late' : esc(t.dueDate || '')}</span>
      </div>`).join('');
    return card('Service desk', open.length + ' open' + (waiting.length ? ' · ' + waiting.length + ' waiting' : ''), rows,
      `<button class="btn btn-quiet btn-sm" data-action="home-open" data-view="service">Queue →</button>`);
  }

  // 14 · Chairman's Club pace — the $1M sprint.
  function wClub(ctx) {
    const CH = SC().CHAIRMAN;
    const booked = CH.STARTING_FYC_TOTAL + SD().cases()
      .filter(c => c.closedAt && SC().weekEndingFor(c.closedAt) >= CH.SPRINT_START)
      .reduce((n, c) => n + SC().deriveCase(c).fyc, 0);
    const week = Math.min(CH.WEEKS_IN_SPRINT, Math.max(1, Math.floor((Date.now() - Date.parse(CH.SPRINT_START + 'T12:00:00')) / (7 * dayMs)) + 1));
    const paceTarget = CH.STARTING_FYC_TOTAL + (CH.ANNUAL_FYC_GOAL_TOTAL - CH.STARTING_FYC_TOTAL) * week / CH.WEEKS_IN_SPRINT;
    const pct = Math.min(100, Math.round(100 * booked / CH.ANNUAL_FYC_GOAL_TOTAL));
    const ahead = booked - paceTarget;
    return card('Chairman’s Club pace', 'week ' + week + ' of ' + CH.WEEKS_IN_SPRINT,
      `<div style="padding:14px var(--pad-panel) 4px">
        <span class="serif" style="font-size:26px;color:var(--navy)">${U().moneyK(Math.round(booked))}</span>
        <span class="cell-sub" style="margin-left:7px">of ${U().moneyK(CH.ANNUAL_FYC_GOAL_TOTAL)} FYC</span>
        <div style="height:6px;background:var(--field);margin-top:10px;border-radius:3px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${ahead >= 0 ? 'var(--good)' : 'var(--gold)'};border-radius:3px"></div></div>
        <div class="cell-sub" style="margin-top:6px">${ahead >= 0 ? 'ahead of pace by ' + U().moneyK(Math.round(ahead)) : 'behind pace by ' + U().moneyK(Math.round(-ahead))}</div>
      </div>` + hint('Confirmed closes since the sprint began, plus what was already booked.'));
  }

  /* ══ registry, customize drawer, screen ═══════════════════ */

  const WIDGETS = [
    { id: 'pace',        title: 'Weekly pace',          render: wPace, full: true },
    { id: 'funnel',      title: 'Opportunity funnels',  render: wFunnel, full: true },
    { id: 'stale',       title: 'Needs help moving',    render: wStale },
    { id: 'dates',       title: 'Important dates',      render: wDates },
    { id: 'activity',    title: 'Team activity',        render: wActivity },
    { id: 'mytasks',     title: 'My tasks today',       render: wMyTasks },
    { id: 'forecast',    title: 'Pipeline forecast',    render: wForecast },
    { id: 'lostreasons', title: 'Lost reasons',         render: wLostReasons },
    { id: 'renewals',    title: 'Recurring book',       render: wRenewals },
    { id: 'leadsidle',   title: 'Leads not worked',     render: wLeadsIdle },
    { id: 'asqueue',     title: 'AdvisorStream queue',  render: wAsQueue },
    { id: 'leaderboard', title: 'Team leaderboard',     render: wLeaderboard, admin: true },
    { id: 'club',        title: 'Chairman’s Club pace', render: wClub },
    { id: 'service',     title: 'Service desk',         render: wService },
    { id: 'closedmix',   title: 'Closed by product',    render: wClosedMix }
  ];
  const widget = (id) => WIDGETS.find(w => w.id === id) || null;
  // Declared after WIDGETS on purpose: layout() only ever runs from render(),
  // long after the module body has finished evaluating.
  function allWidgetIds() { return WIDGETS.map(w => w.id); }

  function customizeHtml(ctx) {
    const on = st.on;
    const avail = WIDGETS.filter(w => on.indexOf(w.id) < 0 && (!w.admin || ctx.isAdmin));
    const item = (w, isOn) => `<div class="flex cz-item" ${isOn ? 'draggable="true"' : ''} data-czid="${esc(w.id)}"
        style="gap:8px;align-items:center;padding:5px 13px;font-size:12px;color:var(--ink);${isOn ? 'cursor:grab' : ''}">
      <span style="color:var(--muted);font-size:12px;${isOn ? '' : 'opacity:.3'}">⠿</span>
      <input type="checkbox" data-action="hm-w" data-id="${esc(w.id)}" ${isOn ? 'checked' : ''}>
      <span>${esc(w.title)}</span></div>`;
    return `<div class="card flush" style="position:sticky;top:88px">
      <div style="padding:12px 13px;border-bottom:1px solid var(--line)"><span class="t">Customize home</span>
        <div class="cell-sub" style="margin-top:2px">Drag to reorder · per person</div></div>
      <div style="padding:9px 13px 3px;font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:700">On your home</div>
      ${on.map(id => widget(id)).filter(Boolean).map(w => item(w, true)).join('')}
      <div style="padding:9px 13px 3px;font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:700">Available</div>
      ${avail.map(w => item(w, false)).join('') || '<p class="muted" style="font-size:12px;padding:4px 13px 10px;margin:0">Everything is on.</p>'}
      <div class="flex" style="padding:11px 13px;border-top:1px solid var(--line);gap:8px">
        <button class="btn btn-ghost btn-sm" data-action="hm-reset">Reset</button>
        <span class="topbar-spacer"></span>
        <button class="btn btn-navy btn-sm" data-action="hm-customize">Done</button>
      </div></div>`;
  }

  /* ── The composer ─────────────────────────────────────────
     Three things you can start from Home, each opening the form that
     record already owns — a second copy of the person form would be a
     second thing to keep in step with the first.

     "Update" (a posted note to the team) came out on 2026-08-20. Notes
     still exist where they belong — on a person, a household, a case —
     and the ones already posted still show in Team activity and can
     still be deleted there. This was the only place that wrote one into
     the air rather than onto a record. */
  function composerHtml(user) {
    const tab = (id, icon, label) =>
      `<button class="btn btn-sm btn-ghost" data-action="hm-compose" data-tab="${id}">${icon} ${label}</button>`;
    return `<div class="card hm-composer">
      <div class="flex" style="gap:6px;flex-wrap:wrap;align-items:center">
        ${tab('contact', '👤', 'Contact')}
        ${tab('task', '✓', 'Task')}
        ${tab('opp', '＄', 'Opportunity')}
      </div>
    </div>`;
  }

  function screenHtml(user, ctx) {
    const eff = ctx.eff;
    const h = new Date().getHours();
    const daypart = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
    const weekday = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const cur = SC().currentWeekEnding();
    const curLabel = new Date(cur + 'T12:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'long' });
    let need = T().isStarted() ? T().dueCount(eff.id) : 0;
    if (ctx.isAdmin) need += SD().cases().filter(c => c.pendingClose && !c.closedAt).length;

    // No track selector: the funnels show all three at once, and nothing
    // else on this page was ever filtered by track.
    // Shortest to longest, so narrowing down reads as moving up the list.
    const periodOpts = [['week', 'This week'], ['month', 'This month'], ['q', 'This quarter'],
        ['ytd', 'This year'], ['all', 'All time']]
      .map(p => `<option value="${p[0]}" ${p[0] === st.period ? 'selected' : ''}>${p[1]}</option>`).join('');

    // Full-width widgets sit above; the rest flow into balanced columns.
    // (A two-column grid made every row as tall as its tallest widget,
    // so a short card left a hole the height of the funnel beside it.)
    const on = layout(eff, ctx.isAdmin ? 'admin' : 'agent');
    const full = [], flow = [];
    on.forEach(id => {
      const w = widget(id);
      if (!w || (w.admin && !ctx.isAdmin)) return;
      const html = w.render(ctx);
      if (!html) return;
      (w.full ? full : flow).push(html);
    });
    const body = (full.length ? `<div class="hm-full">${full.join('')}</div>` : '')
      + (flow.length ? `<div class="hm-grid">${flow.map(h => `<div>${h}</div>`).join('')}</div>` : '');

    return `
      <div class="flex" style="align-items:flex-end;gap:14px;margin-bottom:16px;flex-wrap:wrap">
        <div>
          <h2 class="serif" style="font-size:24px;color:var(--navy);margin:0">${esc(weekday)} ${daypart}, ${esc(firstName(user.name) || 'there')}</h2>
          <p class="muted" style="margin:3px 0 0;font-size:13px">Week ending ${esc(curLabel)}${need
            ? ` · <b class="hm-need" data-action="home-open" data-view="mywork"
                 title="Open your tasks">${need} item${need === 1 ? '' : 's'} need you</b>`
            : ' · nothing waiting on you'}</p>
        </div>
        <span class="topbar-spacer"></span>
        <select id="hm-period" class="fbar-select" style="width:auto">${periodOpts}</select>
        <button class="btn ${st.customize ? 'btn-navy' : 'btn-gold'} btn-sm" data-action="hm-customize">${st.customize ? 'Done' : 'Customize'}</button>
      </div>
      <div class="hm-shell${st.customize ? ' cz-open' : ''}">
        <div style="min-width:0">
          ${composerHtml(user)}
          ${body || '<div class="empty" style="padding:44px"><div class="ec">🧭</div><h3>Nothing switched on</h3><p>Open Customize and pick your widgets.</p></div>'}
        </div>
        ${st.customize ? customizeHtml(ctx) : ''}
      </div>`;
  }

  // ── drag-to-reorder in the customize drawer ───────────────
  let czDrag = null;
  document.addEventListener('dragstart', e => {
    const el = (e.target && e.target.nodeType === 1) ? e.target.closest('.cz-item[draggable="true"]') : null;
    if (!el) return;
    czDrag = el.dataset.czid;
    try { e.dataTransfer.setData('text/plain', czDrag); e.dataTransfer.effectAllowed = 'move'; } catch (_) {}
  });
  document.addEventListener('dragover', e => {
    if (!czDrag) return;
    const t = (e.target && e.target.nodeType === 1) ? e.target.closest('.cz-item') : null;
    if (t) e.preventDefault();
  });
  document.addEventListener('drop', e => {
    if (!czDrag) return;
    const id = czDrag; czDrag = null;
    const t = (e.target && e.target.nodeType === 1) ? e.target.closest('.cz-item') : null;
    if (!t || !st.on || t.dataset.czid === id) return;
    e.preventDefault();
    const from = st.on.indexOf(id);
    let to = st.on.indexOf(t.dataset.czid);
    if (from < 0 || to < 0) return;
    st.on.splice(from, 1);
    st.on.splice(to, 0, id);
    saveLayout(RWG.app.effectiveUser() || RWG.auth.currentUser());
    RWG.app.renderMain();
  });
  document.addEventListener('dragend', () => { czDrag = null; });

  RWG.modules.register({
    id: 'home',
    title: 'Home',
    enabled: true,
    roles: ['admin', 'agent'],

    nav: [{ view: 'home', label: 'Home', icon: 'home' }],
    meta: { home: { t: 'Home', s: 'Where things stand' } },
    state: st,

    onEnter() {
      const me = RWG.auth.currentUser();
      // The dashboard reads everything, so everything wakes here — which
      // also means every other screen opens warm from now on.
      if (!SD().isStarted()) SD().init(me, RWG.app.renderMain);
      if (!H().isStarted()) H().init(me, RWG.app.renderMain);
      if (!T().isStarted()) T().init(me, RWG.app.renderMain);
      if (RWG.notes && !RWG.notes.isStarted()) RWG.notes.init(me, RWG.app.renderMain);
      P().init();
      if (RWG.wf) RWG.wf.init();

      /* Last, because everything above may still be waking up. onEnter
         runs after every paint of this screen and each layer repaints
         when its data lands, so this is called again the moment the
         tasks are actually here — which is where the reminder decides
         for itself whether there is anything to say. */
      remindTick();
    },

    onChange(e) {
      if (e.target.id === 'hm-period') { st.period = e.target.value; RWG.app.renderMain(); }
    },

    actions: {
      // The reminder's own footer leaves by this door too, so it closes
      // itself on the way out rather than following you to Tasks.
      'home-open': (el) => { remClose(); RWG.app.nav(el.dataset.view); },
      'hm-customize': () => { st.customize = !st.customize; RWG.app.renderMain(); },

      /* Open the cases behind a number. Each branch re-reads the same model
         the chart drew from, so the panel and the bar can never disagree —
         and a case appears here for exactly the reason it was counted. */
      'hm-drill': (el) => {
        const kind = el.dataset.kind;
        const i = Number(el.dataset.i);

        /* The pace tiles. Same slice the tile counted, from the same
           `pick` — so the panel can never list a different set of cases
           than the number it is standing behind. */
        if (PACE[kind]) {
          const ctx = { isAdmin: RWG.app.effectiveRole() === 'admin', eff: RWG.app.effectiveUser() };
          const list = paceList(kind, ctx);
          openDrill(PACE[kind].title,
            list.length + (list.length === 1 ? ' close' : ' closes') + ' · week ending ' + SC().currentWeekEnding(),
            list, PACE[kind].note);
          return;
        }

        if (kind === 'mix') {
          const ctx = { isAdmin: RWG.app.effectiveRole() === 'admin', eff: RWG.app.effectiveUser() };
          const start = periodStartKey();
          const list = scoped(SD().cases(), ctx)
            .filter(c => c.closedAt && (!start || SC().weekEndingFor(c.closedAt) >= start)
              && (c.product || 'other') === el.dataset.id && SC().deriveCase(c).revenue > 0)
            .sort((a, b) => SC().deriveCase(b).revenue - SC().deriveCase(a).revenue);
          openDrill(SC().productName(el.dataset.id) || el.dataset.id,
            'confirmed closes · ' + PERIOD_LABEL[st.period], list,
            'Confirmed closes only — a case pushed to Won and not yet stamped by a partner is not counted.');
          return;
        }

        const m = funnelModel(el.dataset.pl);
        if (kind === 'fn-lost') {
          openDrill(m.pl.name + ' · lost', 'lost ' + sinceLabel(), m.lost,
            'These left the board. Each row carries the reason it was marked lost.');
          return;
        }
        const s = m.cols[i];
        if (!s) return;
        if (kind === 'fn-here') {
          // Longest-waiting first: at a Monday meeting the top of this list
          // is the conversation, not the bottom.
          const list = m.at[i].slice().sort((a, b) => stuckDays(b) - stuckDays(a));
          openDrill(m.pl.name + ' · ' + s.label,
            list.length + (list.length === 1 ? ' opportunity' : ' opportunities')
              + (i === m.finalIdx ? ' · closed ' + PERIOD_LABEL[st.period] : ''), list,
            i === m.finalIdx
              ? 'Confirmed closes ' + PERIOD_LABEL[st.period] + ', longest first.'
              : 'Everything parked in this stage right now, whenever it was opened, longest wait first. A case sits in one stage only, so nothing here is counted twice.');
        }
      },
      'hm-drill-export': () => {
        if (!lastDrill || !lastDrill.list.length) { U().toast('Nothing to export'); return; }
        const head = ['Opportunity', 'Client', 'Product', 'Stage', 'Days in stage', 'Owner', 'Amount', 'Opened week', 'Closed'];
        const rows = lastDrill.list.map(c => [
          c.title || '', c.clientName || '', SC().productName(c.product) || c.product || '',
          c.closedAt ? 'Closed' : (c.state === 'Lost' ? 'Lost' : P().stageLabel(c.product, P().stageForCase(c))),
          c.closedAt || c.state === 'Lost' ? '' : stuckDays(c),
          c.agentName || '', headlineMoney(c), c.openedWeek || '', c.closedAt || ''
        ]);
        U().downloadCSV(`RWG_${lastDrill.title.replace(/[^\w]+/g, '_')}_${U().stampName()}.csv`,
          U().toCSV([head].concat(rows)));
        U().toast(`Exported ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`, true);
      },

      // Every tab hands off to the form that record already owns, so
      // there is one of each in the app and nothing to hold open here.
      'hm-compose': (el) => {
        const handoff = { contact: 'hh-person-add', task: 'tk-new', opp: 'cs-new' }[el.dataset.tab || ''];
        if (!handoff) return;
        const owner = RWG.modules.actionOwner(handoff);
        if (owner) owner.actions[handoff]({ dataset: {} });
        else U().toast('That screen has not loaded yet — try again in a moment');
      },
      'hm-note-del': (el) => {
        if (!RWG.notes) return;
        if (!confirm('Delete this update? A partner can restore it from the Trash.')) return;
        RWG.notes.removeNote(el.dataset.id);
        RWG.app.renderMain();
      },
      'hm-w': (el) => {
        const id = el.dataset.id;
        const i = st.on.indexOf(id);
        if (i >= 0) st.on.splice(i, 1); else st.on.push(id);
        saveLayout(RWG.app.effectiveUser() || RWG.auth.currentUser());
        RWG.app.renderMain();
      },
      'hm-reset': () => {
        st.on = null;
        const eff = RWG.app.effectiveUser() || RWG.auth.currentUser();
        try { localStorage.removeItem(lsKey(eff.id)); } catch (e) {}
        RWG.app.renderMain();
      }
    },

    render(view, user, ctx) {
      if (!SD().isStarted()) return `<div class="empty" style="padding:60px"><div class="ec">⏳</div><h3>Waking the book…</h3></div>`;
      const eff = RWG.app.effectiveUser ? (RWG.app.effectiveUser() || user) : user;
      return screenHtml(user, Object.assign({}, ctx, { eff }));
    }
  });
})();
