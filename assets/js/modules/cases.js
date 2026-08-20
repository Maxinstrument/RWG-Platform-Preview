/* ============================================================
   RWG Platform — All Cases (the old "Team Cases", carried over)

   The whole team's book in one filterable, sortable, exportable table.
   Everyone can browse, search and edit — a case belongs to the firm, and
   the owner field says whose week it counts on, not who may touch it.
   Admins can delete, correct the weeks and confirm a close. This is what
   "see all the cases we have" was asking for.

   Money + week rules come from RWG.scorecard. Data from RWG.scorecardData.
   ============================================================ */
window.RWG = window.RWG || {};

(function () {
  const S = () => RWG.scorecard;
  const D = () => RWG.scorecardData;
  const U = () => RWG.ui;
  const esc = (s) => U().esc(s);
  const money = (n) => U().money(n);

  /* ── the details preview, in plain text ──
     Carlos, Aug '26: finding out whether anybody had touched a case meant
     opening it, and opening it was the entire cost of the question. Fifty
     characters of the note answers it from the table; the hover carries
     the rest, and the export carries all of it.

     Details are stored as SANITIZED HTML by the opportunity window's note
     editor. Notes typed before that editor existed are plain text and stay
     that way (the same both-ways rule ui.noteHtml lives by), so this has to
     read either and hand back text for both.

     The order is the safety. Strip the markup FIRST, decode the entities
     SECOND, and let the caller escape LAST. Decoding first would turn a
     &lt;script&gt; that somebody actually TYPED — correctly stored, inert,
     just words about a script tag — into a live-looking tag for the
     stripper to find and eat, and any tag the stripper missed would then
     reach the page as markup. Going the other way round, what comes out of
     here is only ever plain text: whatever the decode produces is data by
     then, and esc() at the point of use turns it back into the characters
     the person typed. Nothing in this file puts the return value into the
     page unescaped, and nothing should. */
  const ENTITIES = [
    [/&nbsp;/gi, ' '], [/&lt;/gi, '<'], [/&gt;/gi, '>'],
    [/&quot;/gi, '"'], [/&#0*39;/g, "'"], [/&apos;/gi, "'"],
    // &amp; goes LAST, always: decode it first and the stored text "&lt;"
    // — five characters someone deliberately wrote as &amp;lt; — becomes a
    // real "<". Ampersand last is what keeps one decode from feeding another.
    [/&amp;/gi, '&']
  ];
  function detailsText(v) {
    let s = String(v == null ? '' : v)
      /* A paragraph break is a word break. <p>Called</p><p>Emailed</p> is
         two sentences, and "CalledEmailed" would be a worse answer than no
         answer. Inline tags close up instead — <b>plan</b> mid-sentence
         should not grow spaces around it. */
      .replace(/<\s*\/?\s*(?:p|div|br|li|ul|ol|h[1-6]|blockquote|pre|table|tr|td|th)\b[^>]*>/gi, ' ')
      /* Requires a letter after the bracket, so a plain-text note reading
         "premium < 5k" keeps its arithmetic instead of losing everything
         up to the next ">". */
      .replace(/<\/?[a-zA-Z][^>]*>/g, '');
    ENTITIES.forEach(e => { s = s.replace(e[0], e[1]); });
    // One line, always: the cell has one line to give, and the CSV field
    // this same text feeds must not carry a newline into the file. \s is
    // the wide one — it counts a non-breaking space as space, so the ones
    // the editor leaves behind collapse with everything else.
    return s.replace(/\s+/g, ' ').trim();
  }
  // Ellipsis only when something was actually cut: 50 characters is 50
  // characters, not 50 and a promise of more that isn't there.
  const clip = (s, n) => s.length > n ? s.slice(0, n) + '…' : s;

  /* Column schema: label, how to read the value, how to sort, whether it
     filters — and whether it is on screen at all. `hidden` columns still
     sort, still filter and still go into the export; they just do not take
     up a column. The table shows what the week's scorecard shows plus the
     agent, because the same six numbers answering the same question in two
     places should not be two different tables. Source and the three week
     stamps stay in the CSV, where reconciling actually happens — and the
     note comes last, where a long ragged string costs the numbers nothing. */
  function columns() {
    const sc = S();
    return [
      { key: 'client', label: 'Opportunity', val: c => c.title || c.clientName || '(no name)', str: true,
        cell: c => `<div class="cell-name">${esc(c.title || c.clientName || '(no name)')}</div>${c.title ? `<div class="cell-sub">${esc(c.clientName || '')}</div>` : ''}` },
      { key: 'product', label: 'Product', val: c => sc.productName(c.product), str: true, filter: true },
      { key: 'state', label: 'Stage', val: c => stageText(c), str: true, filter: true,
        cell: c => `<span class="chip ${stageChipClass(c.state)}">${esc(stageText(c))}</span>` },
      { key: 'money', label: 'Amount / AUM', num: true, val: c => sc.placed(c) || 0,
        cell: c => `<span class="num">${sc.placed(c) == null ? '—' : money(sc.placed(c))}</span>` },
      { key: 'ann', label: 'Ann. premium', num: true, val: c => sc.deriveCase(c).annualizedPremium, cell: c => `<span class="num">${sc.deriveCase(c).annualizedPremium ? money(sc.deriveCase(c).annualizedPremium) : '—'}</span>` },
      { key: 'rev', label: 'Revenue', num: true, val: c => sc.deriveCase(c).revenue, cell: c => `<span class="num">${money(sc.deriveCase(c).revenue)}</span>` },
      { key: 'agent', label: 'Agent', val: c => c.agentName || '', str: true, filter: true,
        cell: c => `${esc(c.agentName || '')}${(c.coCreditNames || []).length ? ` <span class="cell-sub">+${c.coCreditNames.length}</span>` : ''}` },
      { key: 'source', label: 'Source', val: c => sc.sourceLabel(c.source), str: true, hidden: true },
      { key: 'openedWeek', label: 'Opened', str: true, val: c => c.openedWeek || '', hidden: true },
      { key: 'submittedWeek', label: 'Submitted', str: true, val: c => sc.deriveWeeks(c).submittedWeek || '', hidden: true },
      { key: 'closedWeek', label: 'Closed', str: true, val: c => sc.deriveWeeks(c).closedWeek || '', hidden: true },
      /* val() is the WHOLE note, deliberately. The export reads col.val()
         straight through, and an export is something you sit down with
         later — a fifty-character stub would be a worse file than no
         column. The sort reads val() too, and sorting on the full string
         orders by its opening characters anyway, so the rows land in the
         order the previews on screen say they should. What is trimmed to
         fifty is the CELL, which is the only place the width is scarce.

         No `filter: true`: a per-value checklist here would list every
         distinct note in the firm, one row each, and answer nothing. */
      { key: 'details', label: 'Details', str: true, val: c => detailsText(c.details),
        cell: c => {
          const t = detailsText(c.details);
          if (!t) return '<span class="cell-sub">—</span>';
          // Both halves escaped at the point of use — see detailsText.
          // The tooltip is capped too: a note three screens long is a
          // tooltip three screens long, which is nobody's idea of a hover.
          return `<div class="cell-sub cell-note" title="${esc(clip(t, 300))}">${esc(clip(t, 50))}</div>`;
        } }
    ];
  }
  const shown = () => columns().filter(c => !c.hidden);
  const COL = (key) => columns().filter(c => c.key === key)[0];
  const stageChipClass = (s) => ({ Opened: 'tier-medium', Submitted: 'tier-high', Closed: 'tier-gold', Lost: 'tier-low' }[s] || 'pill-soft');
  /* The stage as the board says it. A lost case says Lost — this is the
     screen you come to for those, and "Medical Underwriting" on a case
     that died there would read as still alive. */
  function stageText(c) {
    if (c.state === 'Lost') return 'Lost';
    if (c.closedAt) return 'Closed ✓';
    if (c.pendingClose) return 'Pending partner';
    const P = RWG.pipelines;
    return (P && P.stageLabel(c.product, P.stageForCase(c))) || c.state || '';
  }

  function filtered(st) {
    const sc = S();
    let rows = D().cases();
    if (!st.viewAll) rows = rows.filter(c => sc.activeInWeek(c, st.week));
    if (st.search) {
      const q = st.search.toLowerCase();
      rows = rows.filter(c => String(c.clientName || '').toLowerCase().indexOf(q) >= 0 || String(c.agentName || '').toLowerCase().indexOf(q) >= 0);
    }
    // The header checklists and the sort are the shared table helpers, the
    // same ones the scorecard's week table uses — hidden columns included,
    // so the default "newest opened first" survives losing its column.
    return U().sheetApply(rows, columns(), st);
  }

  function recentWeeks(count) {
    const cur = S().currentWeekEnding();
    const all = S().fridaysOfYear(Number(cur.slice(0, 4)));
    const idx = all.indexOf(cur);
    return (idx >= 0 ? all.slice(0, idx + 1) : all).slice(-count).reverse();
  }

  function toCSV(rows) {
    const cols = columns();
    const cell = (v) => { v = (v == null) ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const header = cols.map(c => cell(c.label)).join(',');
    const body = rows.map(c => cols.map(col => cell(col.num ? Math.round(col.val(c)) : col.val(c))).join(',')).join('\r\n');
    return header + '\r\n' + body;
  }

  /* ── the opportunity window (phase 5.6 — Carlos's layout) ──
     One window for add AND edit: name, household, ALL agents involved,
     product + granular stage, the four money fields (benefit, premium/
     contribution, FYC/compensation, renewals), source + description,
     and rich-text details. The money keeps the locked rule — typing
     FYC back-solves the RATE; a revenue number is never stored raw. */
  /* Anyone on the team may work anyone's opportunity (Carlos, Aug '26,
     after an agent could not move a case he was working on with someone
     else). Ownership decides whose scorecard a case lands on, not who is
     allowed to touch it — this is a four-person firm where two people are
     often on the same file.

     What stays guarded is the NUMBERS, not the people: the opened week
     never moves, the submitted stamp is written once, and only a partner
     may write closedAt — a close is still a partner's confirmation. Those
     three live in firestore.rules as well as here, because a rule is the
     only one of the two an agent cannot get around. */
  function canEdit(c, user) { return true; }
  const FAM = (p) => (p === 'wl' || p === 'term' || p === 'di') ? 'ins' : (p === 'annuity' ? 'ann' : (p === 'inv' ? 'inv' : 'flat'));

  // The note editor and its scrubber are shared (ui.js) — the opportunity
  // window was where they started, not where they belong.
  const cleanHtml = (html) => U().cleanHtml(html);

  /* The work this opportunity has generated, read-only. The task list can
     now say which case a step belongs to; this is the same fact from the
     other side — open the case and see what is outstanding and on whom.
     Deliberately not tickable: this window is mid-edit, and a checkbox that
     changes data behind an unsaved form is a good way to lose both. */
  function stepsBlock(recordId, contactId) {
    const T = RWG.tasks;
    if (!recordId || !T || !T.isStarted()) return '';
    const steps = T.all().filter(t => t.relatedType === 'case' && t.relatedId === recordId)
      .sort((a, b) => (a.workflowStep || 0) - (b.workflowStep || 0)
        || String(a.dueDate).localeCompare(String(b.dueDate)));
    const today = T.todayKey();
    const open = steps.filter(t => t.status !== 'done').length;
    const wfName = (steps.find(t => t.workflowName) || {}).workflowName;
    // A task started here is already about this opportunity, and carries the
    // client through so it also lands on their record. It opens over this
    // window, so it is only offered once the opportunity itself is saved.
    const addBtn = `<button class="btn btn-quiet btn-sm" data-action="tk-new"
        data-case="${esc(recordId)}" ${contactId ? `data-contact="${esc(contactId)}"` : ''}
        title="Opens the task window — save any edits here first">＋ Task</button>`;
    /* Starting a workflow by hand used to live only on the household page,
       which is nowhere near where the work is. An opportunity is the thing
       a workflow usually runs on, so the button belongs here too. */
    const wfBtn = `<button class="btn btn-quiet btn-sm" data-action="cs-wf-launch"
        data-id="${esc(recordId)}" title="Start a workflow on this opportunity">▶ Workflow</button>`;
    return `<div class="cs-correct" style="margin-top:var(--s3)" id="op2-stepswrap"
        data-rec="${esc(recordId)}" ${contactId ? `data-ctc="${esc(contactId)}"` : ''}>
      <div class="cs-correct-h" style="display:flex;align-items:center;gap:8px">Work on this opportunity
        <span class="muted">${steps.length
          ? (open ? open + ' open of ' + steps.length : 'all ' + steps.length + ' done') + (wfName ? ' · ' + esc(wfName) : '')
          : 'nothing yet'}</span>
        <span class="topbar-spacer"></span>${wfBtn}${addBtn}</div>
      ${steps.map(t => {
        const late = t.status !== 'done' && t.dueDate && t.dueDate < today;
        const waitFor = t.status !== 'done' && RWG.wf && RWG.wf.waitingOn ? RWG.wf.waitingOn(t) : null;
        return `<div class="flex" style="gap:10px;align-items:flex-start;padding:7px 2px;border-bottom:1px solid var(--line)">
          <input type="checkbox" data-action="cs-step-done" data-id="${esc(t.id)}" ${t.status === 'done' ? 'checked' : ''}
            style="flex:none;margin-top:2px;accent-color:var(--good)" title="${waitFor ? 'Waits for: ' + esc(waitFor.title) : (t.status === 'done' ? 'Un-tick to reopen' : 'Mark done')}">
          <span style="min-width:0;flex:1;font-size:13.5px;${t.status === 'done' ? 'opacity:.55;text-decoration:line-through' : ''}">
            <span data-action="tk-edit" data-id="${esc(t.id)}" style="cursor:pointer"
              title="Open this task — it opens over this window, so save any edits here first">${esc(t.title)}</span>
            ${t.required && t.status !== 'done' ? '<span class="chip tier-medium" style="font-size:10.5px;margin-left:6px">required to close</span>' : ''}
            ${waitFor ? `<span class="chip" style="font-size:10.5px;margin-left:6px;background:rgba(92,107,126,.10);color:var(--muted);border:1px solid rgba(92,107,126,.3)" title="Chained: opens when “${esc(waitFor.title)}” is checked off">⛓ after: ${esc(waitFor.title.length > 26 ? waitFor.title.slice(0, 25) + '…' : waitFor.title)}</span>` : ''}</span>
          <span class="pill-soft" style="flex:none;font-size:11px">${esc((t.assigneeName || '').split(' ')[0] || '—')}</span>
          <span class="cell-sub" style="flex:none;font-size:11.5px;${late ? 'color:var(--bad);font-weight:700' : ''}">${esc(t.dueDate || '')}</span>
        </div>`;
      }).join('')}
    </div>`;
  }

  let form = null;   // live money model while the window is open

  function moneyInit(c, product) {
    const sc = S();
    const fam = FAM(product);
    const dflt = sc.defaultRate(product);
    const f = { fam: fam, ratePct: dflt ? +(dflt * 100).toFixed(4) : null, premium: 0, fyc: 0 };
    if (!c) return f;
    const d = sc.deriveCase(c);
    if (d.rate) f.ratePct = +(d.rate * 100).toFixed(4);
    if (fam === 'ins') { f.fyc = Number(c.amount) || 0; f.premium = Math.round(d.annualizedPremium) || 0; }
    else if (fam === 'ann') { f.premium = Number(c.amount) || 0; f.fyc = +(f.premium * (d.rate || 0)).toFixed(2); }
    else if (fam === 'inv') { f.premium = Number(c.aum) || 0; f.fyc = +(f.premium * (d.rate || 0)).toFixed(2); }
    else { f.fyc = Number(c.amount) || 0; f.premium = Number(c.premiumAnnual) || 0; }
    return f;
  }

  // The triangle: premium × rate = FYC. Editing FYC gives way to the
  // RATE, never to a stored revenue — Carlos's rule, kept.
  function applyMoney(f, field, v) {
    v = Number(v) || 0;
    const coupled = f.fam === 'ins' || f.fam === 'ann' || f.fam === 'inv';
    if (field === 'premium') {
      f.premium = v;
      if (coupled && f.ratePct) f.fyc = +(v * f.ratePct / 100).toFixed(2);
    } else if (field === 'fyc') {
      f.fyc = v;
      if (coupled && f.premium > 0 && v > 0) f.ratePct = +(v / f.premium * 100).toFixed(4);
    }
    return f;
  }

  const MONEY_LABELS = {
    ins:  { premium: 'Premium (annual)',       fyc: 'FYC / Compensation' },
    ann:  { premium: 'Deposit / Contribution', fyc: 'Compensation' },
    inv:  { premium: 'Assets in (AUM)',        fyc: 'Compensation (yearly)' },
    flat: { premium: 'Premium (annual)',       fyc: 'Fee / Compensation' }
  };
  function rateHintText(f, product) {
    const dflt = S().defaultRate(product);
    if (!dflt || !f.ratePct) return '';
    const custom = Math.abs(f.ratePct / 100 - dflt) > 1e-6;
    return 'at ' + (+f.ratePct.toFixed(2)) + '% — ' + (custom ? 'custom rate, stored on this case' : 'the product default');
  }

  /* Money reads as money. The inputs are text (a number input cannot hold
     $ or commas): they show $328,787, strip to 328787 the moment you focus
     to type, and dress back up on blur. Everything that READS them goes
     through num$ so a formatted value never poisons the math. */
  const fmt$ = (v) => {
    if (v === '' || v == null) return '';
    const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? '' : '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  };
  const num$ = (v) => {
    if (v === '' || v == null) return '';
    const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? '' : n;
  };

  function oppWindow(opts) {
    const sc = S();
    const user = RWG.auth.currentUser();
    const isAdmin = user.role === 'admin';
    const c = opts.id ? D().caseById(opts.id) : null;
    if (opts.id && !c) return;
    /* A duplicate is a NEW opportunity that starts out looking like an old
       one. `copy` is only ever read from — `c` stays null — so every stamp,
       every stage, every button that acts on a record already in the book
       behaves exactly as it does on a blank window.

       What comes across is what you typed: the people, the product, the
       money, the source, the details. What does not is everything the case
       EARNED — its opened week, its stage, the partner's confirm, the
       credit split, its workflow steps. Copying those would mint a case
       that claims a history it never had, and the scorecard counts from
       exactly those stamps. */
    const copy = (!opts.id && opts.copyOf) ? D().caseById(opts.copyOf) : null;
    const src = c || copy;
    const editable = !c || canEdit(c, user);
    const closed = !!(c && c.closedAt);
    const pending = !!(c && c.pendingClose && !closed);
    const lost = !!(c && c.state === 'Lost');
    const stageLocked = closed || pending || lost;
    const HH = RWG.hh;
    const bookLive = HH && HH.isStarted();
    // The contact is the anchor. The household is whatever that person's
    // family happens to be — derived, never asked for twice.
    const ctcId = (src && src.contactId) || opts.contactId || null;
    const ctc = ctcId && bookLive ? HH.contact(ctcId) : null;
    const hhId = (ctc && ctc.householdId) || (src && src.householdId) || opts.householdId || null;
    const hh = hhId && bookLive ? HH.household(hhId) : null;
    // Regarding: the person, or — when an opportunity is genuinely the
    // family's rather than one member's — the household. One search box over
    // both, and the name that is not in the book yet can be made from it.
    /* The button below opens a PERSON. Most of the migrated book is
       pointed at a household rather than a contact (the Sheet had no
       people on it), so falling back to "View household" there meant
       Carlos almost never saw the contact he asked for. Resolve the
       household's primary client instead; only a household with nobody
       in it keeps the household button. */
    const viewCtc = ctc || (hhId && bookLive ? HH.primaryContact(hhId) : null);
    const relType = ctcId ? 'contact' : (hhId ? 'household' : null);
    const relId = ctcId || hhId || null;
    const product = src ? src.product : 'wl';
    form = moneyInit(src, product);

    const users = RWG.data.users().filter(u => u.status === 'active');
    const ownerUid = src ? src.agentUid : ((hh && hh.advisorUid) || user.id);
    const coUids = (src && src.coCreditUids) || [];
    const dis = editable ? '' : 'disabled';

    const prodOpts = sc.PRODUCTS.map(p => `<option value="${p.id}" ${p.id === product ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    const srcOpts = sc.SOURCES.map(s => `<option value="${s.id}" ${src && s.id === src.source ? 'selected' : ''}>${esc(s.label)}</option>`).join('');
    const ownerOpts = users.map(u => `<option value="${esc(u.id)}" ${u.id === ownerUid ? 'selected' : ''}>${esc(u.name)}</option>`).join('')
      || `<option value="${esc(user.id)}" selected>${esc(user.name)}</option>`;

    function stageOptions(prodId) {
      const P = RWG.pipelines;
      const pl = P.pipelineForProduct(prodId);
      const cur = c ? P.stageForCase(c) : 'uncovered';
      const working = P.boardStages(pl).filter(s => s.bucket !== 'Closed').map(s =>
        `<option value="${esc(s.id)}" ${s.id === cur ? 'selected' : ''}>${esc(s.label)}${s.bucket === 'Submitted' ? ' ●' : ''}</option>`).join('');
      // Delivery Requirements is pickable here too — choosing it means the
      // premium is in, so the save routes through the push-to-Won door
      // (premium question, then a partner verifies) instead of a bare move.
      const door = pl.stages.find(s => s.bucket === 'Closed' && s.id !== 'won');
      return working + (door && c
        ? `<option value="${esc(door.id)}">${esc(door.label)} — premium in, counts once a partner confirms</option>` : '');
    }
    // A closed case can still owe its delivery receipt: closed for the
    // scorecard, unfinished as a file. The chip says which, and the signed
    // receipt is one click from right here — the wall Carlos hit was this
    // window refusing to acknowledge post-close work existed.
    const doneCols = c ? RWG.pipelines.pipelineForProduct(c.product).stages.filter(x => x.bucket === 'Closed') : [];
    const doneAt = c && closed ? doneCols.findIndex(x => x.id === RWG.pipelines.stageForCase(c)) : -1;
    const nextDone = doneAt >= 0 ? doneCols[doneAt + 1] : null;
    const kclock = c && closed ? (RWG.pipelines.receiptClock ? RWG.pipelines.receiptClock(c) : null) : null;
    const clockTxt = kclock ? (kclock.left < 0
        ? ` <span class="chip tier-low" style="background:rgba(178,58,72,.14);color:var(--bad);border-color:rgba(178,58,72,.4)">CHARGEBACK — ${kclock.left * -1}d past the month-3 line</span>`
        : ` <span class="chip tier-low" ${kclock.left <= 21 ? 'style="color:var(--bad)"' : ''}>receipt due in ${kclock.left}d</span>`) : '';
    // The close review is the only screen holding the credit split and the
    // verified money — a partner can reach it from here even after the
    // close, because a close that skipped it (or got the split wrong) is
    // otherwise a locked door.
    const reviewBtn = isAdmin && c ? `<button class="btn btn-quiet btn-sm" style="margin-left:8px"
           data-action="cs-review" data-id="${esc(c.recordId)}"
           title="Open the close review — final money, closed week, and each person's share of the credit">Credit split ✎</button>` : '';
    const stageChip = closed ? (nextDone
        ? `<span class="chip tier-high">Closed ✓ — counted; delivery receipt outstanding</span>${clockTxt}
           <button class="btn btn-gold btn-sm" style="margin-left:8px" data-action="cs-signed"
             data-id="${esc(c.recordId)}" data-stage="${esc(nextDone.id)}"
             title="The client signed the delivery receipt — nothing else owed">Receipt signed ✓</button>${reviewBtn}`
        : '<span class="chip tier-high">Closed ✓ — confirmed by a partner</span>' + reviewBtn)
      : pending ? '<span class="chip tier-medium">Awaiting partner confirm</span>' + reviewBtn
      : lost ? `<span class="chip tier-low">Lost${c.lostReason ? ' · ' + esc(c.lostReason.split(' — ')[0]) : ''}</span>` : '';

    const L = MONEY_LABELS[form.fam];
    const w = c ? sc.deriveWeeks(c) : null;
    const weekOpts = (sel) => ['<option value="">—</option>'].concat(recentWeeks(20).map(fri =>
      `<option value="${fri}" ${fri === sel ? 'selected' : ''}>${fri}</option>`)).join('');
    const correct = c && isAdmin ? `
      <div class="cs-correct">
        <div class="cs-correct-h">Correct the weeks <span class="muted">(admin)</span></div>
        <div class="cs-modal-grid">
          <div><label>Opened week</label><select id="cm-ow">${weekOpts(w.openedWeek)}</select></div>
          <div><label>Submitted week</label><select id="cm-sw">${weekOpts(w.submittedWeek)}</select></div>
          <div><label>Closed week</label><select id="cm-cw">${weekOpts(w.closedWeek)}</select></div>
        </div>
      </div>` : '';

    const mount = document.getElementById('modal-mount');
    mount.innerHTML = `<div class="scrim" data-action="close-modal"></div>
      <div class="modal-card modal-lg">
        <div class="modal-head">
          <div><h2>${c ? (editable ? 'Opportunity' : 'Opportunity (read-only)') : (copy ? 'Duplicate opportunity' : 'Add opportunity')}</h2>
            <p>${c ? esc(c.clientName || '') + (hh ? ' · ' + esc(hh.name) : '')
              : copy ? 'Copied from “' + esc(copy.title || copy.clientName || 'the other one')
                  + '”. The people, product and money came across — the week, the stage and the splits start fresh.'
              : 'What you are working on, who is on it, and what it is worth.'}</p></div>
          <button class="drawer-close" data-action="close-modal" title="Close">✕</button></div>
        <div class="modal-body">

          <div class="field-group"><label class="lbl">Opportunity name <span style="color:var(--bad)">*</span></label>
            <input id="op2-title" value="${esc((src && src.title) || '')}" placeholder="e.g. Vargas — whole life + DI package" ${dis}></div>

          <div class="field-row">
            <div class="field-group"><label class="lbl">Regarding ${bookLive ? '<span style="color:var(--bad)">*</span>' : ''}</label>
              ${bookLive ? U().pickerHtml({ id: 'op2-rel', type: relType, recordId: relId, disabled: !editable,
                placeholder: 'Search a contact or household…' })
                : `<input id="op2-client" value="${esc((src && src.clientName) || opts.clientName || '')}" placeholder="Client name" ${dis}>`}
              ${viewCtc
                ? `<div style="margin-top:8px"><button class="btn btn-quiet btn-sm" data-action="cs-view-ctc" data-id="${esc(viewCtc.id)}"
                     title="Look up ${esc(HH.contactName(viewCtc))}${ctc ? '' : ' — primary client of ' + esc((hh && hh.name) || 'this household')} beside this window">View contact</button></div>`
                : hh
                  ? `<div style="margin-top:8px"><button class="btn btn-quiet btn-sm" data-action="cs-view-hh" data-id="${esc(hhId)}"
                     title="Nobody is on this household yet — open the family record">View household</button></div>` : ''}
              <div class="hint">${bookLive
                ? 'Who this is for. Naming the contact is what puts the opportunity — and its tasks — on their record; name the household when it is the family’s rather than one member’s. Not in the book yet? Type the name and make it here.'
                : 'The book is still loading — type the client name for now.'}</div></div>
            <div class="field-group"><label class="lbl">Agents involved</label>
              <select id="op2-agent" ${dis}>${ownerOpts}</select>
              <div class="checkrow">
                ${users.map(u => u.id === ownerUid ? '' : `<label class="checkitem">
                  <input type="checkbox" id="op2-co-${esc(u.id)}" data-op2co="${esc(u.id)}" ${coUids.indexOf(u.id) >= 0 ? 'checked' : ''} ${dis}>
                  ${esc((u.name || '').split(' ')[0])}</label>`).join('')}
              </div>
              <div class="hint">The select names the owner; ticks ride along. Splits are set at close.</div></div>
          </div>

          <div class="field-row">
            <div class="field-group"><label class="lbl">Product</label>
              <select id="op2-prod" ${stageLocked || !editable ? 'disabled title="Closed, pending or lost business keeps its product — history is written in it"' : ''}>${prodOpts}</select>
              <div class="hint" id="op2-track">${c && !stageLocked ? 'Changing the product moves the case to the matching pipeline; its stage carries over where the track has it.' : ''}</div></div>
            <div class="field-group"><label class="lbl">Stage</label>
              ${stageLocked ? stageChip : `<select id="op2-stage" ${dis}>${stageOptions(product)}</select>
              <div class="hint" id="op2-stage-hint"></div>`}</div>
          </div>

          <div class="op2-money">
            <div class="field-group"><label class="lbl">Benefit amount</label>
              <input id="op2-benefit" type="text" inputmode="decimal" value="${esc(fmt$(src && src.benefit != null && src.benefit !== '' ? src.benefit : ''))}" ${dis}></div>
            <div class="field-group"><label class="lbl" id="op2-prem-label">${esc(L.premium)}</label>
              <input id="op2-premium" type="text" inputmode="decimal" value="${esc(fmt$(form.premium || ''))}" ${dis}></div>
            <div class="field-group"><label class="lbl" id="op2-fyc-label">${esc(L.fyc)}</label>
              <input id="op2-fyc" type="text" inputmode="decimal" value="${esc(fmt$(form.fyc || ''))}" ${dis}>
              <div class="hint" id="op2-rate-hint">${esc(rateHintText(form, product))}</div></div>
            <div class="field-group"><label class="lbl">Renewals / yr</label>
              <input id="op2-renewal" type="text" inputmode="decimal" value="${esc(fmt$(src && src.renewalAnnual != null && src.renewalAnnual !== '' ? src.renewalAnnual : ''))}" ${dis}>
              <div class="hint">reporting only</div></div>
          </div>

          <div class="field-row">
            <div class="field-group"><label class="lbl">Source</label>
              <select id="op2-src" ${dis}>${srcOpts}</select></div>
            <div class="field-group"><label class="lbl">Source description</label>
              <input id="op2-srcnote" value="${esc((src && src.sourceNote) || '')}" placeholder="e.g. referred by the Delgados" ${dis}></div>
          </div>

          <div class="field-group"><label class="lbl">Details</label>
            ${U().noteEditor({ id: 'op2-details', value: (src && src.details) || '', editable: editable,
              placeholder: 'Anything worth remembering about this opportunity…' })}</div>

          ${stepsBlock(c ? c.recordId : null, ctcId)}
          ${correct}
          ${editable ? '' : '<p class="muted" style="font-size:12.5px;margin-top:8px">Read-only.</p>'}
        </div>
        <div class="modal-foot">
          ${c && isAdmin ? `<button class="btn btn-danger" data-action="cs-delete" data-id="${esc(c.recordId)}">Delete</button>` : ''}
          ${c ? `<button class="btn btn-quiet" data-action="cs-dup" data-id="${esc(c.recordId)}"
            title="Start another opportunity pre-filled from this one. Anything unsaved here is not carried over.">⧉ Duplicate</button>` : ''}
          <span class="topbar-spacer"></span>
          <button class="btn btn-ghost" data-action="close-modal">Cancel</button>
          ${editable ? `<button class="btn btn-gold" data-action="cs-save" ${c ? `data-id="${esc(c.recordId)}"` : ''} ${hhId ? `data-hh="${esc(hhId)}"` : ''}>${c ? 'Save' : 'Open opportunity ' + U().icon('spark','ic-inline')}</button>` : ''}
        </div>
      </div>`;

    // ── direct wiring: this window opens over any view ──
    const byId = (i) => document.getElementById(i);
    function paintStatic() {
      const p = byId('op2-prod') ? byId('op2-prod').value : product;
      const P = RWG.pipelines;
      const tr = byId('op2-track');
      if (tr) tr.textContent = P.pipelineForProduct(p).name + ' track';
      const L2 = MONEY_LABELS[FAM(p)];
      const pl = byId('op2-prem-label'); if (pl) pl.textContent = L2.premium;
      const fl = byId('op2-fyc-label'); if (fl) fl.textContent = L2.fyc;
      const rh = byId('op2-rate-hint'); if (rh) rh.textContent = rateHintText(form, p);
      const stSel = byId('op2-stage');
      const sh = byId('op2-stage-hint');
      if (stSel && sh) {
        const bucket = P.bucketOf(p, stSel.value);
        sh.innerHTML = bucket === 'Submitted'
          ? '<b style="color:var(--gold)">Starting here counts it as written — permanently, on this week.</b>'
          : '● marks the stages that count as written.';
      }
    }
    const prodSel = byId('op2-prod');
    if (prodSel && !prodSel.disabled) prodSel.addEventListener('change', () => {
      const p = prodSel.value;
      form.fam = FAM(p);
      const dflt = sc.defaultRate(p);
      form.ratePct = dflt ? +(dflt * 100).toFixed(4) : null;
      applyMoney(form, 'premium', form.premium);
      const st2 = byId('op2-stage'); if (st2) st2.innerHTML = stageOptions(p);
      const pi = byId('op2-premium'); if (pi) pi.value = fmt$(form.premium || '');
      const fi = byId('op2-fyc'); if (fi) fi.value = fmt$(form.fyc || '');
      paintStatic();
    });
    // Regarding IS the client now — there is no second box asking for the
    // same name in words. The board still shows a plain string; it is
    // derived from whoever this points at when the window saves.
    if (bookLive) {
      U().pickerInit({
        id: 'op2-rel', types: ['contact', 'household'], create: ['contact', 'household'],
        type: relType, recordId: relId
      });
    }
    const stSel2 = byId('op2-stage');
    if (stSel2) stSel2.addEventListener('change', paintStatic);
    const premIn = byId('op2-premium');
    if (premIn) premIn.addEventListener('input', () => {
      applyMoney(form, 'premium', num$(premIn.value));
      const fi = byId('op2-fyc'); if (fi && document.activeElement !== fi) fi.value = fmt$(form.fyc || '');
      paintStatic();
    });
    const fycIn = byId('op2-fyc');
    if (fycIn) fycIn.addEventListener('input', () => {
      applyMoney(form, 'fyc', num$(fycIn.value));
      paintStatic();
    });
    // undress to type, dress back up on the way out
    ['op2-benefit', 'op2-premium', 'op2-fyc', 'op2-renewal'].forEach(mid => {
      const el = byId(mid); if (!el || el.disabled || !el.addEventListener) return;
      el.addEventListener('focus', () => { el.value = num$(el.value); });
      el.addEventListener('blur', () => { el.value = fmt$(el.value); });
    });
    paintStatic();
    const t = byId('op2-title'); if (t && !c) t.focus();
  }

  function saveWindow(el) {
    const sc = S();
    const user = RWG.auth.currentUser();
    const id = el.dataset.id || null;
    const c = id ? D().caseById(id) : null;
    const g = (i) => { const x = document.getElementById(i); return x ? x.value : ''; };
    const title = g('op2-title').trim();
    if (!title) { U().toast('Give the opportunity a name'); return; }
    if (!U().pickerSettle('op2-rel')) return;   // a typed-but-unchosen name is not an answer
    // A window opened before the book finished loading renders no picker at
    // all, so its absence must not be read as "nobody" and quietly unlink a
    // saved opportunity.
    const hasRel = U().pickerMounted('op2-rel');
    const rel = hasRel ? U().pickerRec('op2-rel') : null;
    const pickedContact = (rel && rel.type === 'contact') ? RWG.hh.contact(rel.id) : null;
    /* The client name is not asked for any more — Regarding answers it. It is
       still stored, because the board, the reports and the exports all read a
       plain string. Recomputed only when the pointer actually MOVED: a record
       imported with a good name and only a household attached should not have
       that name rewritten just because someone opened the window. */
    const relWas = c ? (c.contactId ? 'contact:' + c.contactId
      : (c.householdId ? 'household:' + c.householdId : '')) : '';
    const relNow = (rel && rel.type) ? rel.type + ':' + rel.id : '';
    let derived = '';
    if (pickedContact) derived = RWG.hh.contactName(pickedContact);
    else if (rel && rel.type === 'household') {
      const pc = RWG.hh.primaryContact(rel.id);
      derived = pc ? RWG.hh.contactName(pc) : rel.label;
    }
    const typedName = document.getElementById('op2-client') ? g('op2-client').trim() : '';
    const clientName = (relNow && relNow !== relWas) ? derived
      : (typedName || (c && c.clientName) || derived || '');
    if (!clientName) { U().toast('Who is this opportunity for? Pick a contact or a household'); return; }
    const product = g('op2-prod') || (c ? c.product : 'wl');
    const fam = FAM(product);
    const ownerUid = g('op2-agent') || (c ? c.agentUid : user.id);
    const owner = RWG.data.user(ownerUid) || user;
    const coUids = [], coNames = [];
    RWG.data.users().filter(u => u.status === 'active' && u.id !== ownerUid).forEach(u => {
      const box = document.getElementById('op2-co-' + u.id);
      if (box && box.checked) { coUids.push(u.id); coNames.push(u.name || ''); }
    });
    // basis + rate, never a raw revenue number
    const basis = fam === 'ins' || fam === 'flat' ? (Number(form.fyc) || 0)
      : (Number(form.premium) || 0);
    const dflt = sc.defaultRate(product);
    const custom = form.ratePct && dflt != null && Math.abs(form.ratePct / 100 - dflt) > 1e-6;
    const num = (i) => { const v = num$(g(i)); return v === '' ? null : (Number(v) || 0); };
    const hasDetails = !!document.getElementById('op2-details');

    const patch = {
      recordId: id || undefined,
      agentUid: ownerUid, agentName: owner.name || '',
      clientName: clientName, product: product, source: g('op2-src'),
      state: c ? c.state : 'Opened',
      amount: fam === 'inv' ? 0 : basis,
      aum: fam === 'inv' ? basis : 0,
      rate: custom ? form.ratePct / 100 : null,   // default rates are never stored
      premiumAnnual: (fam === 'ins' || fam === 'flat') && Number(form.premium) > 0 ? Number(form.premium) : null,
      benefit: num('op2-benefit'), renewalAnnual: num('op2-renewal'),
      coCreditUids: coUids, coCreditNames: coNames,
      title: title, sourceNote: g('op2-srcnote').trim() || null,
      details: hasDetails ? U().noteRead('op2-details') : (c ? c.details : null),
      contactId: pickedContact ? pickedContact.id : (hasRel ? null : (c ? c.contactId || null : el.dataset.contact || null)),
      // The family follows the person. Pointing the box at a household
      // instead names the family directly — an opportunity that is genuinely
      // theirs rather than one member's. Only when the box is absent does it
      // fall back to whatever the window was opened from.
      householdId: (rel && rel.householdId)
        || (hasRel ? null : ((c && c.householdId) || el.dataset.hh || null)),
      stageId: (() => {
        if (!c) return 'uncovered';
        // A product picks its pipeline. When it changes, the stage carries
        // over where the new track knows it (application, funding…) and
        // falls back to the first stage of its bucket where it does not
        // (medical-uw has no investments twin).
        if (product === c.product) return c.stageId;
        const P2 = RWG.pipelines;
        const newPl = P2.pipelineForProduct(product);
        const cur = P2.stageForCase(c);
        if (P2.stageOf(newPl, cur)) return cur;
        const bucket = P2.bucketOf(c.product, cur) || 'Opened';
        const landing = newPl.stages.find(x => x.bucket === bucket) || newPl.stages[0];
        return landing.id;
      })()
    };
    let routedToReview = false;
    D().saveCase(patch).then(row => {
      // stage move (add: from Uncovered to the chosen start; edit: if changed)
      const sel = g('op2-stage');
      const P = RWG.pipelines;
      if (sel && sel !== P.stageForCase(row)) {
        // Picking Delivery Requirements is a claim that the premium is in —
        // that is the close's door, so it walks the same path as the board's
        // push: blockers, the premium question, then the partner.
        if (P.bucketOf(row.product, sel) === 'Closed' && !row.closedAt && !row.pendingClose) {
          routedToReview = true;
          const owner = RWG.modules.actionOwner('pl-won');
          if (owner) setTimeout(() => owner.actions['pl-won']({ dataset: { id: row.recordId } }), 0);
          return row;
        }
        return D().setPipelineStage(row.recordId, sel).then(() => row);
      }
      return row;
    }).then(row => {
      // admin week correction, if the block was shown and changed
      if (c && user.role === 'admin' && document.getElementById('cm-ow')) {
        const w = sc.deriveWeeks(c);
        const ow = g('cm-ow'), sw = g('cm-sw'), cw = g('cm-cw');
        if (ow !== w.openedWeek || sw !== w.submittedWeek || cw !== w.closedWeek) {
          /* The weeks block CORRECTS stamps on business that already holds
             them - it is not a door. Writing a closed week onto a case that
             never closed would stamp it Closed with no premium question, no
             partner verify and no credit split (which is exactly how three
             cases slipped through in August '26). That one write routes
             through the close review like every other close. */
          const stamps = { openedWeek: ow || w.openedWeek, submittedWeek: sw, closedWeek: cw };
          if (cw && !row.closedAt && !row.pendingClose) {
            delete stamps.closedWeek;
            if (!routedToReview) {
              routedToReview = true;
              const owner = RWG.modules.actionOwner('pl-won');
              if (owner) setTimeout(() => owner.actions['pl-won']({ dataset: { id: row.recordId } }), 0);
            }
          }
          return D().adminSetStamps(row.recordId, stamps).then(() => row);
        }
      }
      return row;
    }).then(row => {
      document.getElementById('modal-mount').innerHTML = '';
      form = null;
      RWG.app.renderMain();
      U().toast(c ? 'Saved' : 'Opportunity opened — it is on the board', true);
      // Entering Submitted asks about the workflow (and verifies the main
      // agent) instead of starting one by itself — same prompt as the board.
      if (RWG.wfPrompt) RWG.wfPrompt(row.recordId);
    }).catch(err => U().toast('Could not save: ' + err.message));
  }

  /* Repaint just the steps block of an open opportunity window — called
     after a stacked task closes, so a retitle, reassign or delete shows
     through without the window (and its half-typed fields) re-rendering. */
  RWG.refreshOppSteps = function () {
    const wrap = document.getElementById('op2-stepswrap');
    if (wrap) wrap.outerHTML = stepsBlock(wrap.dataset.rec, wrap.dataset.ctc || null);
  };

  RWG.modules.register({
    id: 'cases',
    title: 'All Cases',
    enabled: true,
    roles: ['admin', 'agent'],
    // No sidebar entry: "All cases" is a button in the Pipeline header,
    // beside the pipeline tabs, where you are already thinking about cases.
    nav: [],
    views: ['cases'],
    meta: { cases: { t: 'Opportunity', s: 'Every case on every track, as a table' } },

    state: { search: '', colf: {}, viewAll: true, week: null, sortKey: 'openedWeek', sortDir: 'desc' },

    home: { tile: () => ({ icon: 'cases', title: 'All Cases', desc: 'Browse, search, and filter the whole team\'s book.', view: 'cases' }) },

    onEnter(view, ctx) {
      if (!D().isStarted()) D().init(ctx.userObj || RWG.auth.currentUser(), RWG.app.renderMain);
      // the opportunity window lists the workflow steps opened against a case
      if (RWG.tasks && !RWG.tasks.isStarted()) RWG.tasks.init(RWG.auth.currentUser(), RWG.app.renderMain);
      RWG.pipelines.init();   // the Stage column reads the granular stage
      if (!this.state.week) this.state.week = S().currentWeekEnding();
      fitTable();   // onEnter runs after the paint, so the table can be measured
    },

    onInput(e, st) { if (e.target.id === 'cs-search') { st.search = e.target.value; refreshBody(); } },

    onChange(e, st) {
      const id = e.target.id;
      if (id === 'cs-week') { st.week = e.target.value; RWG.app.renderMain(); return; }
      // A tick in a header checklist narrows the rows immediately, popover
      // still open — picking three agents is three ticks, not three trips.
      if (e.target.dataset && e.target.dataset.colf) {
        const k = e.target.dataset.colf, v = e.target.dataset.val;
        const arr = st.colf[k] = st.colf[k] || [];
        const i = arr.indexOf(v);
        if (e.target.checked) { if (i < 0) arr.push(v); } else if (i >= 0) arr.splice(i, 1);
        if (!arr.length) delete st.colf[k];
        const th = document.querySelector('.th-filter[data-col="' + k + '"]');
        if (th && th.classList) th.classList.toggle('on', !!(st.colf[k] || []).length);
        refreshBody();
        return;
      }
      // (the opportunity window wires its own listeners — it opens over any view)
    },

    actions: {
      'cs-sort': (el, e, st) => { const k = el.dataset.key; if (st.sortKey === k) st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc'; else { st.sortKey = k; st.sortDir = COL(k).num ? 'desc' : 'asc'; } RWG.app.renderMain(); },
      'cs-toggle-all': (el, e, st) => { st.viewAll = !st.viewAll; RWG.app.renderMain(); },
      'cs-clear': (el, e, st) => { st.search = ''; st.colf = {}; RWG.app.renderMain(); },
      'cs-popsort': (el, e, st) => { st.sortKey = el.dataset.key; st.sortDir = el.dataset.dir; RWG.app.renderMain(); },
      'cs-colf-all': (el, e, st) => {
        const k = el.dataset.col;
        st.colf[k] = U().sheetValues(D().cases(), COL(k));
        document.querySelectorAll('input[data-colf="' + k + '"]').forEach(cb => { cb.checked = true; });
        const th = document.querySelector('.th-filter[data-col="' + k + '"]');
        if (th && th.classList) th.classList.add('on');
        refreshBody();
      },
      'cs-colf-clear': (el, e, st) => {
        const k = el.dataset.col;
        delete st.colf[k];
        document.querySelectorAll('input[data-colf="' + k + '"]').forEach(cb => { cb.checked = false; });
        const th = document.querySelector('.th-filter[data-col="' + k + '"]');
        if (th && th.classList) th.classList.remove('on');
        refreshBody();
      },
      'cs-export': (el, e, st) => {
        const csv = toCSV(filtered(st)); const blob = new Blob([csv], { type: 'text/csv' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = 'RWG_cases_' + S().currentWeekEnding() + '.csv'; document.body.appendChild(a); a.click(); a.remove();
      },
      'cs-open': (el) => oppWindow({ id: el.dataset.id }),
      // Post-close bookkeeping, not a close: stamps are untouched by design.
      /* Into the close review from an open case window. The review is a
         page, not a layer — both modal layers close first, and the inbox's
         cached form is dropped so the review reads THIS case fresh. */
      'cs-review': (el) => {
        const inbox = RWG.modules.get('inbox'); if (!inbox) return;
        inbox.state.reviewId = el.dataset.id;
        inbox.state.form = null; inbox.state.formId = null;
        inbox.state.splits = null; inbox.state.splitsId = null;
        const m1 = document.getElementById('modal-mount'); if (m1) m1.innerHTML = '';
        const m2 = document.getElementById('modal-mount-2'); if (m2) m2.innerHTML = '';
        RWG.app.nav('close-review');
      },
      'cs-signed': (el) => {
        D().setPipelineStage(el.dataset.id, el.dataset.stage).then(() => {
          U().toast('Fully done — receipt on file', true);
          oppWindow({ id: el.dataset.id });
          RWG.app.renderMain();
        }).catch(e => U().toast(e.message || 'Could not move it'));
      },
      // From a contact record the client name rides along, so the person you
      // clicked is the client — not whoever happens to be primary on the family.
      'cs-new': (el) => oppWindow({ householdId: el.dataset.hh || null,
        contactId: el.dataset.contact || null, clientName: el.dataset.client || '' }),
      'cs-save': (el) => saveWindow(el),
      /* The second policy on the same family, the spouse's version of the
         same plan, the DI that follows the whole life — same client, same
         source, near enough the same money, and nobody should type it
         twice. It replaces this window with a fresh one, so what was
         typed and not saved here does not come along; the tooltip says so
         before the click. */
      'cs-dup': (el) => oppWindow({ copyOf: el.dataset.id }),
      /* Ticking a step inside the opportunity window. The window holds
         half-typed money fields, so a full re-render would eat them —
         only the steps block repaints. The chain guard and the chained
         re-dating both live in the shared task engine, so a tick here
         behaves exactly like a tick on the Tasks screen. */
      /* Into the manual launcher from the opportunity. It runs on the
         household (workflows attach there), with this case preselected so
         the steps point at the right opportunity. */
      'cs-wf-launch': (el) => {
        const c = D().caseById(el.dataset.id); if (!c) return;
        const wm = RWG.modules.get('workflows');
        if (!wm || !wm.actions['wf-launch']) { U().toast('Workflows are still loading'); return; }
        if (!c.householdId) { U().toast('Point this opportunity at a household first — workflows hang off the family'); return; }
        wm.actions['wf-launch']({ dataset: { hh: c.householdId, case: c.recordId } });
      },
      'cs-step-done': (el) => {
        const T = RWG.tasks; if (!T || !T.isStarted()) return;
        const t = T.task(el.dataset.id); if (!t) return;
        if (t.status !== 'done' && RWG.wf && RWG.wf.waitingOn) {
          const b = RWG.wf.waitingOn(t);
          if (b) { U().toast('First: ' + (b.title || 'the step before it')); el.checked = false; }
          else T.toggleDone(t.id);
        } else T.toggleDone(t.id);
        const wrap = document.getElementById('op2-stepswrap');
        if (wrap) wrap.outerHTML = stepsBlock(wrap.dataset.rec, wrap.dataset.ctc || null);
        RWG.app.renderMain();   // boards and lists behind the window follow
      },
      // Back to the board, on the track you clicked.
      'cs-to-board': (el) => {
        const pm = RWG.modules.get('pipeline');
        if (pm && el.dataset.pl) pm.state.pl = el.dataset.pl;
        RWG.app.nav('pipeline');
      },
      /* Through to the person this opportunity is for. The contact is the
         anchor, so that is the record worth one click; an opportunity
         written against a household with no contact keeps the household
         button below rather than losing its way through to the book. */
      'cs-view-ctc': (el) => {
        // Beside the window, not instead of it — half-typed money fields
        // and a chosen stage survive a look at someone's phone number.
        if (RWG.contactPanel) { RWG.contactPanel('contact', el.dataset.id); return; }
        const m1 = document.getElementById('modal-mount'); if (m1) m1.innerHTML = '';
        const cm = RWG.modules.get('contacts');
        if (cm) cm.actions['ct-open'](el, null);
      },
      'cs-view-hh': (el) => {
        document.getElementById('modal-mount').innerHTML = '';
        const hhm = RWG.modules.get('households');
        if (hhm) hhm.actions['hh-goto'](el);
      },
      'cs-delete': (el) => { if (confirm('Delete this case? Admins only.')) D().deleteCase(el.dataset.id).then(() => { document.getElementById('modal-mount').innerHTML = ''; U().toast('Case deleted'); }); }
    },

    render(view, user, ctx) {
      const st = this.state;
      const all = D().cases();
      const rows = filtered(st);
      const weekOpts = recentWeeks(20).map(w => `<option value="${w}" ${w === st.week ? 'selected' : ''}>Week ending ${w}${w === S().currentWeekEnding() ? ' (this week)' : ''}</option>`).join('');

      // The same header the board wears, so the two read as one area with
      // two ways of looking at it rather than two unrelated screens.
      const tracks = (RWG.pipelines.pipelines() || []).map(p =>
        `<button class="btn btn-sm btn-ghost" data-action="cs-to-board" data-pl="${esc(p.id)}">${esc(p.name)}</button>`).join('');
      /* The board's own bar, verbatim and in the same place on the page,
         because this is the same area seen as a table — not a screen you
         land on. Everything else fits on one line beside the search. */
      const bar = `<div class="filterbar pl-bar" style="flex-direction:row;align-items:center;flex-wrap:wrap;gap:8px">
          ${tracks}
          <span class="pl-divider"></span>
          <button class="btn btn-sm btn-navy" data-action="nav" data-view="cases">☰ All cases</button>
          <span class="topbar-spacer"></span>
          <button class="btn btn-gold btn-sm" data-action="cs-new">＋ New opportunity</button>
        </div>
        <div class="filterbar cs-bar">
          <input id="cs-search" class="input cs-search" type="search" placeholder="Search client or agent…" value="${esc(st.search)}">
          <button class="btn btn-quiet btn-sm" data-action="cs-toggle-all">${st.viewAll ? 'All weeks' : 'This week only'}</button>
          ${st.viewAll ? '' : `<select id="cs-week" class="fbar-select" style="width:auto">${weekOpts}</select>`}
          <span class="cell-sub" id="cs-count" style="flex:none">${rows.length} of ${all.length}</span>
          <span id="cs-chips" class="flex" style="gap:6px;flex-wrap:wrap;min-width:0">${csChips(st)}</span>
          <span class="topbar-spacer"></span>
          <button class="btn btn-quiet btn-sm" data-action="cs-clear">Clear</button>
          <button class="btn btn-ghost btn-sm" data-action="cs-export">⬇ Export</button>
        </div>`;

      return `${bar}<div id="cs-body">${tableHtml(rows, st, user)}</div>`;
    }
  });

  function csBodyRows(rows, cols) {
    if (!rows.length) return `<tr class="no-rows"><td colspan="${cols.length}"><div class="empty" style="padding:34px 10px"><div class="ec">🔍</div><h3>No cases match</h3><p>Open a header's ▾ to widen a filter, or Clear.</p></div></td></tr>`;
    return rows.map(c => `<tr data-action="cs-open" data-id="${esc(c.recordId)}" class="cs-row">${cols.map(col => `<td class="${col.num ? 'num' : ''}">${col.cell ? col.cell(c) : esc(col.val(c))}</td>`).join('')}</tr>`).join('');
  }
  const csChips = (st) => U().sheetChips(columns(), st, 'cs');

  /* One scrollbar, not two. The table stopped at 70vh and let the page
     scroll on past it, so a long book meant scrolling the page to reach a
     table that then scrolled again inside itself — and the header row you
     were scrolling towards sat in the wrong one. The wrap is sized to what
     is actually left of the window, so the page has nothing left to
     scroll and the sticky headers stay put above the rows.

     Measured from the document, not the viewport: rect.top + scrollY is
     the same number wherever the page happens to be sitting when we ask.
     A short book keeps its short table — this is a ceiling, not a height. */
  function fitTable() {
    if (typeof document === 'undefined' || !document.querySelector) return;
    const w = document.querySelector('.cs-fit');
    if (!w || !w.getBoundingClientRect) return;
    const docTop = w.getBoundingClientRect().top + (window.scrollY || 0);
    const main = document.querySelector('.main');
    const pad = (main && window.getComputedStyle)
      ? (parseFloat(window.getComputedStyle(main).paddingBottom) || 0) : 0;
    w.style.maxHeight = Math.max(260, Math.round(window.innerHeight - docTop - pad - 12)) + 'px';
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('resize', fitTable);
  }
  function tableHtml(rows, st, user) {
    const cols = shown();
    return `<div class="table-wrap cs-fit"><table class="data cs-table"><thead>${U().sheetHead(cols, D().cases(), st, 'cs')}</thead><tbody id="cs-tbody">${csBodyRows(rows, cols)}</tbody></table></div>`;
  }

  function refreshBody() {
    const st = RWG.modules.get('cases').state;
    const rows = filtered(st);
    const tbody = document.getElementById('cs-tbody');
    if (tbody) tbody.innerHTML = csBodyRows(rows, shown());
    else { const body = document.getElementById('cs-body'); if (body) body.innerHTML = tableHtml(rows, st, RWG.auth.currentUser()); }
    const cnt = document.getElementById('cs-count'); if (cnt) cnt.textContent = rows.length + ' of ' + D().cases().length;
    const chips = document.getElementById('cs-chips'); if (chips) chips.innerHTML = csChips(st);
    fitTable();   // a chip appearing can push the table down a line
  }

  RWG._casesModule = { filtered, toCSV, columns, applyMoney, moneyInit, cleanHtml, detailsText, clip, _form: () => form };
})();
