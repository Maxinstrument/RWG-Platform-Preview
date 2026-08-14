/* ============================================================
   RWG Platform — Reports

   A report is three questions: what am I looking at, which of them
   do I want, and what do I want to see about each one. This screen
   is those three questions and nothing else.

   Every record type declares its own fields once, in FIELDS below.
   A field says how to read itself off a row, what type it is, and
   (for enums) what the choices are. Everything else — which
   operators appear, how a value is compared, what the column shows,
   what lands in the CSV — falls out of that declaration. Adding a
   field is one line, not a tour of the file.

   Saved reports live in config/savedreports, which means they need
   no new security rules and every advisor can run them. Saving is a
   partner action, because the config collection is admin-write.

   The money here is the same deriveCase() the scorecard and the
   dashboard use, so a report can never disagree with the numbers
   people are held to.
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

  const st = {
    src: 'cases',
    filters: [],
    cols: null,
    ran: false,
    saved: null,        // live from config/savedreports
    loadedName: '',
    sortCol: null, sortDir: 1
  };

  // ── helpers ───────────────────────────────────────────────
  const pad = (n) => (n < 10 ? '0' : '') + n;
  // Any stamp we store — ms, ISO instant, or a plain date — as a local
  // calendar day, so a date filter means the day the thing happened here.
  function dayKey(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') { const d = new Date(v); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  const activeUsers = () => D().users().filter(u => u.status === 'active');
  const userNames = () => activeUsers().map(u => u.name).filter(Boolean);

  const money = (v) => (v == null || v === '') ? '' : U().money(Math.round(Number(v) || 0));
  const num = (v) => (v == null || v === '') ? '' : String(v);

  /* ── Field declarations ───────────────────────────────────
     type drives the operators and the comparison:
       text | number | date | enum | bool
     get(row) returns the comparable value; fmt(v) the display. */
  const FIELDS = {
    cases: () => {
      const stages = [];
      (P().pipelines() || []).forEach(pl => (pl.stages || []).forEach(s => {
        if (stages.indexOf(s.label) < 0) stages.push(s.label);
      }));
      return [
        { k: 'title',      label: 'Opportunity',   type: 'text',   get: c => c.title || c.clientName || '' },
        { k: 'clientName', label: 'Client',        type: 'text',   get: c => c.clientName || '' },
        { k: 'household',  label: 'Household',     type: 'text',   get: c => { const h = c.householdId && H().isStarted() && H().household(c.householdId); return h ? h.name : ''; } },
        { k: 'product',    label: 'Product',       type: 'enum',   get: c => SC().productName(c.product) || c.product || '',
          options: () => (SC().PRODUCTS || []).map(p => p.name) },
        { k: 'stage',      label: 'Stage',         type: 'enum',   get: c => P().stageLabel(c.product, P().stageForCase(c)) || '',
          options: () => stages },
        { k: 'state',      label: 'State',         type: 'enum',   get: c => c.state || '',
          options: () => ['Opened', 'Submitted', 'Closed', 'Lost'] },
        { k: 'agentName',  label: 'Advisor',       type: 'enum',   get: c => c.agentName || '', options: userNames },
        { k: 'source',     label: 'Source',        type: 'enum',   get: c => { const s = (SC().SOURCES || []).find(x => x.id === c.source); return s ? s.label : (c.source || ''); },
          options: () => (SC().SOURCES || []).map(s => s.label) },
        { k: 'premium',    label: 'Premium / deposit', type: 'number', get: c => SC().deriveCase(c).annualizedPremium || Number(c.amount) || 0, fmt: money },
        { k: 'revenue',    label: 'Revenue',       type: 'number', get: c => SC().deriveCase(c).revenue || 0, fmt: money },
        { k: 'benefit',    label: 'Face amount',   type: 'number', get: c => Number(c.benefit) || 0, fmt: money },
        { k: 'renewal',    label: 'Renewal / yr',  type: 'number', get: c => Number(c.renewalAnnual) || 0, fmt: money },
        { k: 'openedWeek', label: 'Opened',        type: 'date',   get: c => dayKey(c.openedWeek) },
        { k: 'submittedAt', label: 'Submitted',    type: 'date',   get: c => dayKey(c.submittedAt) },
        { k: 'closedAt',   label: 'Closed',        type: 'date',   get: c => dayKey(c.closedAt) },
        { k: 'daysOpen',   label: 'Days open',     type: 'number',
          get: c => { const a = Date.parse((c.openedWeek || '') + 'T12:00:00'); const b = c.closedAt ? Date.parse(c.closedAt) : Date.now();
            return (a && b) ? Math.max(0, Math.round((b - a) / 86400000)) : 0; } },
        { k: 'lostReason', label: 'Lost reason',   type: 'text',   get: c => c.lostReason || '' },
        { k: 'pending',    label: 'Awaiting partner', type: 'bool', get: c => !!(c.pendingClose && !c.closedAt) }
      ];
    },
    contacts: () => [
      { k: 'lastName',  label: 'Last name',   type: 'text', get: c => c.lastName || '' },
      { k: 'firstName', label: 'First name',  type: 'text', get: c => c.firstName || '' },
      { k: 'email',     label: 'Email',       type: 'text', get: c => c.email || '' },
      { k: 'phone',     label: 'Phone',       type: 'text', get: c => c.phone || '' },
      { k: 'relationship', label: 'Relationship', type: 'enum', get: c => c.relationship || '',
        options: () => H().RELATIONSHIPS },
      { k: 'tags',      label: 'Tags',        type: 'text', get: c => (c.tags || []).join(', ') },
      { k: 'employer',  label: 'Employer',    type: 'text', get: c => c.employer || '' },
      { k: 'planType',  label: 'Plan type',   type: 'enum', get: c => c.planType || '',
        options: () => (D().PLAN_TYPES || []).slice() },
      { k: 'yos',       label: 'Years of service', type: 'number', get: c => c.yos == null ? '' : Number(c.yos), fmt: num },
      { k: 'afc',       label: 'AFC / salary', type: 'number', get: c => c.afc == null ? '' : Number(c.afc), fmt: money },
      { k: 'dob',       label: 'Date of birth', type: 'date', get: c => dayKey(c.dob) },
      { k: 'household', label: 'Household',   type: 'text', get: c => { const h = c.householdId && H().household(c.householdId); return h ? h.name : ''; } },
      { k: 'advisor',   label: 'Advisor',     type: 'enum', get: c => { const h = c.householdId && H().household(c.householdId); return (h && h.advisorName) || ''; }, options: userNames },
      { k: 'newsletter', label: 'On AdvisorStream', type: 'bool', get: c => !!c.advisorstream },
      { k: 'created',   label: 'Added',       type: 'date', get: c => dayKey(c.createdAt) }
    ],
    households: () => [
      { k: 'name',     label: 'Household',  type: 'text', get: h => h.name || '' },
      { k: 'advisor',  label: 'Advisor',    type: 'enum', get: h => h.advisorName || '', options: userNames },
      { k: 'source',   label: 'Source',     type: 'text', get: h => h.source || '' },
      { k: 'people',   label: 'People',     type: 'number', get: h => H().contactsFor(h.id).length, fmt: num },
      { k: 'opps',     label: 'Opportunities', type: 'number',
        get: h => SD().isStarted() ? SD().cases().filter(c => c.householdId === h.id).length : 0, fmt: num },
      { k: 'revenue',  label: 'Revenue to date', type: 'number',
        get: h => SD().isStarted() ? SD().cases().filter(c => c.householdId === h.id && c.closedAt)
          .reduce((n, c) => n + SC().deriveCase(c).revenue, 0) : 0, fmt: money },
      { k: 'a360',     label: 'A360 done',  type: 'bool', get: h => !!h.a360Complete },
      { k: 'created',  label: 'Created',    type: 'date', get: h => dayKey(h.createdAt) }
    ],
    tasks: () => [
      { k: 'title',    label: 'Task',       type: 'text', get: t => t.title || '' },
      { k: 'assignee', label: 'Owner',      type: 'enum', get: t => t.assigneeName || '', options: userNames },
      { k: 'category', label: 'Category',   type: 'enum', get: t => t.category || '',
        options: () => T().categories() },
      { k: 'priority', label: 'Priority',   type: 'enum', get: t => t.priority || 'none',
        options: () => (T().PRIORITIES || []).map(p => p.id) },
      { k: 'status',   label: 'Status',     type: 'enum', get: t => t.status || 'open',
        options: () => ['open', 'done'] },
      { k: 'due',      label: 'Due',        type: 'date', get: t => dayKey(t.dueDate) },
      { k: 'doneAt',   label: 'Completed',  type: 'date', get: t => dayKey(t.doneAt) },
      { k: 'related',  label: 'Regarding',  type: 'text', get: t => t.relatedLabel || '' },
      { k: 'workflow', label: 'Workflow',   type: 'text', get: t => t.workflowName || '' },
      { k: 'kind',     label: 'Kind',       type: 'enum',
        get: t => t.kind === 'service' ? 'service' : (t.workflowId ? 'workflow' : 'task'),
        options: () => ['task', 'workflow', 'service'] },
      { k: 'overdue',  label: 'Overdue',    type: 'bool',
        get: t => !!(t.status !== 'done' && t.dueDate && t.dueDate < T().todayKey()) }
    ]
  };

  const SOURCES = [
    { id: 'cases',      label: 'Opportunities', rows: () => SD().isStarted() ? SD().cases() : [] },
    { id: 'contacts',   label: 'Contacts',      rows: () => H().isStarted() ? H().contacts() : [] },
    { id: 'households', label: 'Households',    rows: () => H().isStarted() ? H().households() : [] },
    { id: 'tasks',      label: 'Tasks',         rows: () => T().isStarted() ? T().all() : [] }
  ];
  const srcMeta = (id) => SOURCES.find(s => s.id === id) || SOURCES[0];
  const fields = (src) => (FIELDS[src || st.src] || FIELDS.cases)();
  const field = (src, k) => fields(src).find(f => f.k === k) || null;

  // Default columns per source: the first five that aren't a bool.
  function defaultCols(src) {
    return fields(src).filter(f => f.type !== 'bool').slice(0, 5).map(f => f.k);
  }
  function cols() {
    if (!st.cols) st.cols = defaultCols(st.src);
    return st.cols;
  }

  /* ── Operators ────────────────────────────────────────────
     Declared per type so the UI can only ever offer one that the
     comparison below actually implements. */
  const OPS = {
    text:   [['has', 'contains'], ['nhas', 'does not contain'], ['is', 'is'], ['isnt', 'is not'],
             ['empty', 'is empty'], ['nempty', 'is not empty']],
    enum:   [['is', 'is'], ['isnt', 'is not'], ['empty', 'is empty'], ['nempty', 'is not empty']],
    number: [['gt', 'is more than'], ['lt', 'is less than'], ['eq', 'equals'], ['gte', 'is at least'], ['lte', 'is at most']],
    date:   [['period', 'is in'], ['after', 'is on or after'], ['before', 'is on or before'],
             ['empty', 'is empty'], ['nempty', 'is not empty']],
    bool:   [['yes', 'is yes'], ['no', 'is no']]
  };
  const opsFor = (type) => OPS[type] || OPS.text;

  // Named windows, resolved at run time so "this year" is always now.
  const PERIODS = [
    ['ytd', 'this year'], ['q', 'this quarter'], ['month', 'this month'],
    ['last30', 'the last 30 days'], ['last90', 'the last 90 days'],
    ['last12m', 'the last 12 months'], ['lastyear', 'last year']
  ];
  function periodRange(id) {
    const now = new Date(), y = now.getFullYear(), m = now.getMonth();
    const k = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    const daysAgo = (n) => k(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));
    if (id === 'ytd') return [y + '-01-01', k(now)];
    if (id === 'q') return [k(new Date(y, m - (m % 3), 1)), k(now)];
    if (id === 'month') return [k(new Date(y, m, 1)), k(now)];
    if (id === 'last30') return [daysAgo(30), k(now)];
    if (id === 'last90') return [daysAgo(90), k(now)];
    if (id === 'last12m') return [k(new Date(y - 1, m, now.getDate())), k(now)];
    if (id === 'lastyear') return [(y - 1) + '-01-01', (y - 1) + '-12-31'];
    return ['', ''];
  }

  function matches(row, f, flt) {
    const v = f.get(row);
    const t = f.type;
    const needle = String(flt.value == null ? '' : flt.value).trim();

    if (flt.op === 'empty')  return v === '' || v == null;
    if (flt.op === 'nempty') return !(v === '' || v == null);

    if (t === 'bool') return flt.op === 'yes' ? !!v : !v;

    if (t === 'number') {
      if (needle === '') return true;
      const a = Number(v), b = Number(needle);
      if (isNaN(a) || isNaN(b)) return false;
      if (flt.op === 'gt') return a > b;
      if (flt.op === 'lt') return a < b;
      if (flt.op === 'gte') return a >= b;
      if (flt.op === 'lte') return a <= b;
      return a === b;
    }

    if (t === 'date') {
      const day = String(v || '');
      if (flt.op === 'period') {
        const r = periodRange(needle || 'ytd');
        return !!day && day >= r[0] && day <= r[1];
      }
      if (!needle) return true;
      if (flt.op === 'after') return !!day && day >= needle;
      if (flt.op === 'before') return !!day && day <= needle;
      return true;
    }

    const s = String(v == null ? '' : v).toLowerCase();
    const n = needle.toLowerCase();
    if (flt.op === 'has')  return n === '' || s.indexOf(n) >= 0;
    if (flt.op === 'nhas') return n === '' || s.indexOf(n) < 0;
    if (flt.op === 'is')   return s === n;
    if (flt.op === 'isnt') return s !== n;
    return true;
  }

  function run() {
    const rows = srcMeta(st.src).rows().slice();
    const fs = fields(st.src);
    const out = rows.filter(r => st.filters.every(flt => {
      const f = fs.find(x => x.k === flt.field);
      return f ? matches(r, f, flt) : true;
    }));
    if (st.sortCol) {
      const f = fs.find(x => x.k === st.sortCol);
      if (f) {
        out.sort((a, b) => {
          const va = f.get(a), vb = f.get(b);
          if (f.type === 'number') return ((Number(va) || 0) - (Number(vb) || 0)) * st.sortDir;
          return String(va == null ? '' : va).localeCompare(String(vb == null ? '' : vb)) * st.sortDir;
        });
      }
    }
    return out;
  }

  // ── the builder UI ────────────────────────────────────────
  function filterRow(flt, i) {
    const fs = fields(st.src);
    const f = fs.find(x => x.k === flt.field) || fs[0];
    const fieldOpts = fs.map(x => `<option value="${esc(x.k)}" ${x.k === flt.field ? 'selected' : ''}>${esc(x.label)}</option>`).join('');
    const opOpts = opsFor(f.type).map(o => `<option value="${o[0]}" ${o[0] === flt.op ? 'selected' : ''}>${esc(o[1])}</option>`).join('');

    let valueCtl = '';
    const needsValue = ['empty', 'nempty', 'yes', 'no'].indexOf(flt.op) < 0;
    if (needsValue) {
      if (f.type === 'enum') {
        const opts = (f.options ? f.options() : []).map(o =>
          `<option value="${esc(o)}" ${String(o) === String(flt.value) ? 'selected' : ''}>${esc(o)}</option>`).join('');
        valueCtl = `<select data-rp="val" data-i="${i}"><option value="">— pick —</option>${opts}</select>`;
      } else if (f.type === 'date' && flt.op === 'period') {
        const opts = PERIODS.map(p => `<option value="${p[0]}" ${p[0] === flt.value ? 'selected' : ''}>${esc(p[1])}</option>`).join('');
        valueCtl = `<select data-rp="val" data-i="${i}">${opts}</select>`;
      } else if (f.type === 'date') {
        valueCtl = `<input type="date" data-rp="val" data-i="${i}" value="${esc(flt.value || '')}">`;
      } else if (f.type === 'number') {
        valueCtl = `<input type="number" data-rp="val" data-i="${i}" value="${esc(flt.value || '')}" placeholder="0">`;
      } else {
        valueCtl = `<input data-rp="val" data-i="${i}" value="${esc(flt.value || '')}" placeholder="type a value">`;
      }
    }

    return `<div class="rp-filter">
      <span class="tb-word">${i === 0 ? 'where' : 'and'}</span>
      <select data-rp="field" data-i="${i}">${fieldOpts}</select>
      <select data-rp="op" data-i="${i}">${opOpts}</select>
      ${valueCtl}
      <button class="btn btn-quiet btn-sm" data-action="rp-del" data-i="${i}" title="Remove">✕</button>
    </div>`;
  }

  function builderHtml(ctx) {
    const srcBtns = SOURCES.map(s =>
      `<button class="btn btn-sm ${st.src === s.id ? 'btn-navy' : 'btn-ghost'}" data-action="rp-src" data-src="${s.id}">${esc(s.label)}</button>`).join('');
    const on = cols();
    const colBoxes = fields(st.src).map(f =>
      `<label class="checkitem"><input type="checkbox" data-rp="col" data-k="${esc(f.k)}" ${on.indexOf(f.k) >= 0 ? 'checked' : ''}> ${esc(f.label)}</label>`).join('');

    const savedList = (st.saved || []);
    const savedOpts = savedList.map((r, i) =>
      `<option value="${i}" ${st.loadedName === r.name ? 'selected' : ''}>${esc(r.name)}</option>`).join('');

    return `<div class="card">
      <div class="card-head"><h3>Build a report</h3>
        <span class="sub">pick what you are looking at, narrow it, choose the columns</span>
        <span class="topbar-spacer"></span>
        ${savedList.length ? `<select id="rp-saved" style="width:auto;max-width:230px">
            <option value="">Saved reports…</option>${savedOpts}</select>` : ''}
      </div>

      <div class="rp-block">
        <span class="rp-lab">Looking at</span>
        <div class="flex" style="gap:6px;flex-wrap:wrap">${srcBtns}</div>
      </div>

      <div class="rp-block">
        <span class="rp-lab">Narrowed to</span>
        <div style="flex:1;min-width:0">
          ${st.filters.length ? st.filters.map(filterRow).join('')
            : '<p class="hint" style="margin:0 0 8px">No filters — every record of this type.</p>'}
          <button class="btn btn-ghost btn-sm" data-action="rp-add">＋ Add a filter</button>
        </div>
      </div>

      <div class="rp-block">
        <span class="rp-lab">Showing</span>
        <div style="flex:1;min-width:0">
          <div class="checkrow">${colBoxes}</div>
          ${!on.length ? '<div class="hint" style="color:var(--warn)">Pick at least one column.</div>' : ''}
        </div>
      </div>

      <div class="flex" style="gap:9px;margin-top:var(--s3);align-items:center;flex-wrap:wrap">
        ${st.loadedName ? `<span class="chip tier-gold">${esc(st.loadedName)}</span>` : ''}
        <span class="topbar-spacer"></span>
        <button class="btn btn-ghost btn-sm" data-action="rp-reset">Start over</button>
        ${ctx.isAdmin ? `<button class="btn btn-ghost btn-sm" data-action="rp-save">Save as…</button>` : ''}
        ${ctx.isAdmin && st.loadedName ? `<button class="btn btn-quiet btn-sm" data-action="rp-forget">Delete saved</button>` : ''}
        <button class="btn btn-gold" data-action="rp-run">Run report</button>
      </div>
    </div>`;
  }

  function resultsHtml() {
    if (!st.ran) return '';
    const on = cols();
    if (!on.length) return '';
    const fs = fields(st.src);
    const chosen = on.map(k => fs.find(f => f.k === k)).filter(Boolean);
    const rows = run();

    // A number column is worth a total; anything else isn't.
    const totals = chosen.map(f => f.type === 'number'
      ? rows.reduce((n, r) => n + (Number(f.get(r)) || 0), 0) : null);
    const anyTotal = totals.some(t => t !== null);

    const head = chosen.map(f => `<th class="${f.type === 'number' ? 'num' : ''}" style="cursor:pointer"
        data-action="rp-sort" data-k="${esc(f.k)}">${esc(f.label)}${st.sortCol === f.k ? (st.sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');

    const body = rows.slice(0, 400).map(r => `<tr>${chosen.map(f => {
      const v = f.get(r);
      const text = f.fmt ? f.fmt(v) : (f.type === 'bool' ? (v ? 'yes' : 'no') : String(v == null ? '' : v));
      return `<td class="${f.type === 'number' ? 'num' : ''}">${esc(text) || '<span class="muted">—</span>'}</td>`;
    }).join('')}</tr>`).join('');

    const foot = anyTotal ? `<tfoot><tr>${chosen.map((f, i) => `<td class="${f.type === 'number' ? 'num' : ''}">${
      totals[i] === null ? (i === 0 ? '<b>Total</b>' : '') : `<b>${esc(f.fmt ? f.fmt(totals[i]) : String(Math.round(totals[i])))}</b>`
    }</td>`).join('')}</tr></tfoot>` : '';

    return `<div class="card flush" style="margin-top:var(--s4)">
      <div class="list-head">
        <span class="t">${esc(srcMeta(st.src).label)}</span>
        <span class="s">${rows.length} row${rows.length === 1 ? '' : 's'}${rows.length > 400 ? ' · showing the first 400' : ''}</span>
        <span class="topbar-spacer"></span>
        <button class="btn btn-ghost btn-sm" data-action="rp-csv">⤓ Export CSV</button>
      </div>
      ${rows.length
        ? `<div class="table-wrap"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table></div>`
        : `<div class="empty" style="padding:44px 16px"><div class="ec">🔍</div>
            <h3>No records match</h3><p>Loosen a filter and run it again.</p></div>`}
      ${rows.length > 400 ? '<p class="list-hint">The table shows the first 400 so the page stays quick. The CSV has all ' + rows.length + '.</p>' : ''}
    </div>`;
  }

  // ── saved reports (config/savedreports) ───────────────────
  function saveList(list) {
    const me = RWG.auth.currentUser();
    return RWG.fb.db.collection('config').doc('savedreports').set({
      value: list, updatedAt: new Date().toISOString(), updatedBy: (me && me.id) || null
    });
  }
  function currentSpec(name) {
    return { name: name, src: st.src, filters: JSON.parse(JSON.stringify(st.filters)), cols: cols().slice() };
  }
  function applySpec(spec) {
    st.src = spec.src || 'cases';
    st.filters = JSON.parse(JSON.stringify(spec.filters || []));
    st.cols = (spec.cols || []).slice();
    st.loadedName = spec.name || '';
    st.ran = true;
    st.sortCol = null;
  }

  RWG.modules.register({
    id: 'reports',
    title: 'Reports',
    enabled: true,
    roles: ['admin', 'agent'],
    // One Reports entry in the sidebar, and it is the agents' — a partner's
    // opens on Production and is declared by the module that owns that view.
    // An agent has no production or lead report to see, so the builder is
    // the whole of Reports for them and there are no tabs to keep lit.
    // NB the view id is `report_build`, not `reports` — the Leads module has
    // owned a view called `reports` since long before this screen existed.
    nav: { agent: [{ view: 'report_build', label: 'Reports', icon: 'reports' }] },
    views: ['report_build'],
    meta: { report_build: { t: 'Reports', s: 'Ask the book a question' } },
    state: st,

    home: {
      tile: (ctx) => ({ icon: 'reports', title: 'Reports',
        desc: 'Ask the book a question and export the answer.',
        view: (ctx && ctx.isAdmin) ? 'report_week' : 'report_build' })
    },

    onEnter() {
      const me = RWG.auth.currentUser();
      if (!SD().isStarted()) SD().init(me, RWG.app.renderMain);
      if (!H().isStarted()) H().init(me, RWG.app.renderMain);
      if (!T().isStarted()) T().init(me, RWG.app.renderMain);
      P().init();
      if (st.saved === null) {
        st.saved = [];
        RWG.fb.db.collection('config').doc('savedreports').onSnapshot(
          d => {
            const v = d.exists ? (d.data() || {}).value : null;
            st.saved = Array.isArray(v) ? v : [];
            RWG.app.renderMain();
          },
          e => console.error('saved reports:', e && e.message));
      }
    },

    onInput(e) {
      const t = e.target;
      if (t.dataset && t.dataset.rp === 'val') {
        const f = st.filters[Number(t.dataset.i)];
        if (f) { f.value = t.value; if (st.ran) RWG.app.renderMain(); }
      }
    },

    onChange(e) {
      const t = e.target;
      const d = t.dataset || {};
      if (d.rp === 'field') {
        const f = st.filters[Number(d.i)];
        if (!f) return;
        f.field = t.value;
        // The old operator may not exist on the new field's type.
        const nf = field(st.src, t.value);
        const ops = opsFor(nf ? nf.type : 'text').map(o => o[0]);
        if (ops.indexOf(f.op) < 0) f.op = ops[0];
        f.value = (nf && nf.type === 'date' && f.op === 'period') ? 'ytd' : '';
        RWG.app.renderMain();
      } else if (d.rp === 'op') {
        const f = st.filters[Number(d.i)];
        if (!f) return;
        f.op = t.value;
        const nf = field(st.src, f.field);
        if (nf && nf.type === 'date' && f.op === 'period' && !f.value) f.value = 'ytd';
        RWG.app.renderMain();
      } else if (d.rp === 'val') {
        const f = st.filters[Number(d.i)];
        if (f) { f.value = t.value; RWG.app.renderMain(); }
      } else if (d.rp === 'col') {
        const k = d.k;
        const i = cols().indexOf(k);
        if (t.checked) { if (i < 0) st.cols.push(k); }
        else if (i >= 0) st.cols.splice(i, 1);
        RWG.app.renderMain();
      } else if (t.id === 'rp-saved') {
        const spec = (st.saved || [])[Number(t.value)];
        if (spec) { applySpec(spec); RWG.app.renderMain(); }
      }
    },

    actions: {
      'rp-src': (el) => {
        if (st.src === el.dataset.src) return;
        st.src = el.dataset.src;
        // Filters and columns belong to a record type; carrying them across
        // would silently keep a filter on a field the new type hasn't got.
        st.filters = []; st.cols = null; st.sortCol = null; st.loadedName = '';
        RWG.app.renderMain();
      },
      'rp-add': () => {
        const f = fields(st.src)[0];
        st.filters.push({ field: f.k, op: opsFor(f.type)[0][0], value: f.type === 'date' ? 'ytd' : '' });
        RWG.app.renderMain();
      },
      'rp-del': (el) => { st.filters.splice(Number(el.dataset.i), 1); RWG.app.renderMain(); },
      'rp-reset': () => {
        st.filters = []; st.cols = null; st.ran = false; st.loadedName = ''; st.sortCol = null;
        RWG.app.renderMain();
      },
      'rp-run': () => {
        if (!cols().length) { U().toast('Pick at least one column'); return; }
        st.ran = true; RWG.app.renderMain();
      },
      'rp-sort': (el) => {
        const k = el.dataset.k;
        if (st.sortCol === k) st.sortDir = -st.sortDir; else { st.sortCol = k; st.sortDir = 1; }
        RWG.app.renderMain();
      },
      'rp-csv': () => {
        const fs = fields(st.src);
        const chosen = cols().map(k => fs.find(f => f.k === k)).filter(Boolean);
        const rows = run();
        if (!rows.length) { U().toast('Nothing to export'); return; }
        const head = chosen.map(f => f.label);
        // The CSV carries raw numbers, not "$26,000" — a spreadsheet should
        // be able to add up a column it receives.
        const data = rows.map(r => chosen.map(f => {
          const v = f.get(r);
          if (f.type === 'number') return Number(v) || 0;
          if (f.type === 'bool') return v ? 'yes' : 'no';
          return v == null ? '' : String(v);
        }));
        const name = (st.loadedName || srcMeta(st.src).label).replace(/[^A-Za-z0-9]+/g, '_');
        U().downloadCSV(`RWG_${name}_${rows.length}_${U().stampName()}.csv`, U().toCSV([head].concat(data)));
        U().toast(`Exported ${rows.length} row${rows.length === 1 ? '' : 's'}`, true);
      },
      'rp-save': () => {
        if (!cols().length) { U().toast('Pick at least one column first'); return; }
        const name = (prompt('Name this report', st.loadedName || '') || '').trim();
        if (!name) return;
        const list = (st.saved || []).slice();
        const i = list.findIndex(r => r.name.toLowerCase() === name.toLowerCase());
        const spec = currentSpec(name);
        if (i >= 0) list[i] = spec; else list.push(spec);
        saveList(list)
          .then(() => { st.loadedName = name; RWG.app.renderMain(); U().toast(i >= 0 ? 'Report updated' : 'Report saved — the team can run it', true); })
          .catch(e => U().toast('Save failed: ' + ((e && e.message) || 'partners only')));
      },
      'rp-forget': () => {
        const name = st.loadedName;
        if (!name || !confirm('Delete the saved report "' + name + '"?')) return;
        saveList((st.saved || []).filter(r => r.name !== name))
          .then(() => { st.loadedName = ''; RWG.app.renderMain(); U().toast('Deleted'); })
          .catch(e => U().toast('Delete failed: ' + ((e && e.message) || 'partners only')));
      }
    },

    render(view, user, ctx) {
      if (!SD().isStarted() || !H().isStarted()) {
        return RWG.reportTabs('report_build', ctx)
          + `<div class="empty" style="padding:60px"><div class="ec">⏳</div><h3>Warming the book…</h3></div>`;
      }
      return RWG.reportTabs('report_build', ctx) + builderHtml(ctx) + resultsHtml();
    }
  });

  /* One tab strip, rendered by all three report screens, so they read as
     one area with three views rather than three separate pages that
     happen to be about reporting. Declared on RWG so the Leads module and
     the production report can use it without importing anything. */
  RWG.reportTabs = function (active, ctx) {
    // Production first — it is the question you open Reports to answer;
    // Leads next; the builder last, for the question the other two do not
    // already answer.
    const tabs = [
      { view: 'report_week', label: 'Production', admin: true },
      { view: 'reports', label: 'Leads', admin: true },
      { view: 'report_build', label: 'Build a report' }
    ].filter(t => !t.admin || (ctx && ctx.isAdmin));
    if (tabs.length < 2) return '';
    return `<div class="flex" style="gap:8px;margin-bottom:16px;flex-wrap:wrap">${
      tabs.map(t => `<button class="btn btn-sm ${t.view === active ? 'btn-navy' : 'btn-ghost'}"
        data-action="nav" data-view="${t.view}">${esc(t.label)}</button>`).join('')}</div>`;
  };
})();
