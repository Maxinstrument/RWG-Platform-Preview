/* ============================================================
   RWG Platform — Pipeline board (phase 2, first slice)

   The whole book as cards in stage columns, one track at a time —
   insurance and investments do not share stages, so a combined
   board would need columns half the cards can never enter.

   What a drag can and cannot do:
     · between Opened/Submitted stages: moves the card, and entering
       the first Submitted stage stamps submittedAt (write-once) —
       that IS "new business written" on the scorecard
     · backward: allowed, but no stamp is ever cleared
     · into Won: blocked — closing goes through the close review
     · Lost: not a column; the ✕ on a card asks for a reason

   Reuses the leads board's CSS (.board / .board-col) but its own
   drag wiring, scoped to .pl-card + data-plstage so the kernel's
   lead-card handlers never collide with it.
   ============================================================ */
window.RWG = window.RWG || {};

(function () {
  const P  = () => RWG.pipelines;
  const SD = () => RWG.scorecardData;
  const SC = () => RWG.scorecard;
  const H  = () => RWG.hh;
  const U  = () => RWG.ui;
  const esc = (s) => U().esc(s);

  const st = { pl: 'insurance', owner: '' };

  const BUCKET_DOT = { Opened: '#5C6B7E', Submitted: '#C2A14D', Closed: '#2E7D5B' };
  const dayMs = 86400000;
  const ageDays = (c) => {
    const t = c.updatedAt ? Date.parse(c.updatedAt) : (c.createdAt ? Date.parse(c.createdAt) : 0);
    return t ? Math.max(0, Math.floor((Date.now() - t) / dayMs)) : 0;
  };

  function casesFor(plId) {
    let rows = SD().cases().filter(c => P().pipelineForProduct(c.product).id === plId && c.state !== 'Lost');
    if (st.owner) rows = rows.filter(c => c.agentName === st.owner);
    return rows;
  }
  function lostCount(plId) {
    let rows = SD().cases().filter(c => P().pipelineForProduct(c.product).id === plId && c.state === 'Lost');
    if (st.owner) rows = rows.filter(c => c.agentName === st.owner);
    return rows.length;
  }

  const firstClosedIsDelivery = (c) => {
    const first = P().pipelineForProduct(c.product).stages.find(x => x.bucket === 'Closed');
    return !!first && first.id === 'delivery-signed';
  };
  // The month-3 line, counted down out loud. Amber once half the runway is
  // gone, red inside three weeks, and past zero it says the word nobody
  // wants on a Monday: chargeback.
  function clockChip(c) {
    const k = P().receiptClock ? P().receiptClock(c) : null;
    if (!k) return '';
    if (k.left < 0) return `<span class="chip tier-low" style="font-size:10.5px;background:rgba(178,58,72,.14);color:var(--bad);border-color:rgba(178,58,72,.4)" title="Unsigned past policy month 3 — the commission charges back">CHARGEBACK · ${k.left * -1}d over</span>`;
    const cls = k.left <= 21 ? 'style="font-size:10.5px;background:rgba(178,58,72,.10);color:var(--bad);border-color:rgba(178,58,72,.32)"'
      : k.left <= 45 ? 'style="font-size:10.5px;background:rgba(176,105,31,.10);color:var(--warn);border-color:rgba(176,105,31,.3)"'
      : 'style="font-size:10.5px"';
    return `<span class="chip tier-low" ${cls} title="Signed delivery receipt due inside policy month 3 (day 90) or the commission charges back">receipt · ${k.left}d left</span>`;
  }

  function card(c, stage, isAdmin) {
    const sc = SC();
    const money = sc.usesAum(c.product) ? c.aum : c.amount;
    const closed = !!c.closedAt;
    const days = ageDays(c);
    const stale = !closed && days >= 14;
    const first = (c.agentName || '').split(' ')[0];
    const canMove = stage.bucket !== 'Closed';
    const prev = canMove ? P().neighborStage(c, -1) : null;
    const next = canMove ? P().neighborStage(c, +1) : null;
    // A confirmed close still walks the closed stages: Delivery Requirements
    // until the receipt is signed, Close/Won once nothing else is owed.
    const doneCols = stage.bucket === 'Closed'
      ? P().pipelineForProduct(c.product).stages.filter(x => x.bucket === 'Closed') : [];
    const di = doneCols.findIndex(x => x.id === stage.id);
    const nextDone = di >= 0 ? doneCols[di + 1] : null;
    const prevDone = di > 0 ? doneCols[di - 1] : null;
    // At the last working stage, the arrow's place is taken by the push to Won.
    const lastStop = canMove && !next && stage.bucket === 'Submitted';
    return `<div class="card tight pl-card${canMove ? '' : ' pl-done'}" ${canMove ? 'draggable="true"' : ''} data-case="${esc(c.recordId)}"
        style="cursor:pointer;border-left:3px solid ${closed ? 'var(--good)' : (stage.bucket === 'Submitted' ? 'var(--gold)' : 'var(--line-strong)')}">
      <div class="flex" style="justify-content:space-between;gap:8px;align-items:flex-start" data-action="cs-open" data-id="${esc(c.recordId)}">
        <div>
          <div style="font-weight:700;font-size:13.5px;color:var(--navy)">${esc(c.title || c.clientName || '(no name)')}</div>
          <div class="cell-sub">${c.title ? esc(c.clientName || '') + ' · ' : ''}${esc(sc.productName(c.product))}${c.source ? ' · ' + esc(sc.sourceLabel(c.source)) : ''}</div>
        </div>
        ${c.householdId ? `<button class="btn btn-quiet btn-sm" data-action="hh-goto" data-id="${esc(c.householdId)}" title="Open the household" style="padding:2px 7px">${U().icon('household','ic-sm')}</button>` : ''}
      </div>
      <div class="serif" style="font-size:16px;color:var(--navy);margin-top:6px" data-action="cs-open" data-id="${esc(c.recordId)}">${U().money(money)}</div>
      <div class="flex" style="align-items:center;gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid var(--line)">
        <span class="pill-soft" style="font-size:11px" ${(c.coCreditNames || []).length ? `title="With ${esc((c.coCreditNames || []).join(', '))}"` : ''}>${esc(first || '—')}${(c.coCreditNames || []).length ? ' +' + c.coCreditNames.length : ''}</span>
        ${closed ? (stage.bucket === 'Closed' && stage.id !== 'won'
              ? (isAdmin
                  ? `<button class="chip tier-high" style="font-size:10.5px;cursor:pointer" data-action="pl-review" data-id="${esc(c.recordId)}" title="Closed and counted — click to review the final money and credit split">Closed ✓</button>`
                  : '<span class="chip tier-high" style="font-size:10.5px" title="Closed and counted — the delivery receipt is still out">Closed ✓</span>') + clockChip(c)
              : (isAdmin
                  ? `<button class="chip tier-high" style="font-size:10.5px;cursor:pointer" data-action="pl-review" data-id="${esc(c.recordId)}" title="Confirmed — click to review the final money and credit split">Confirmed ✓</button>`
                  : '<span class="chip tier-high" style="font-size:10.5px">Confirmed ✓</span>'))
          : (stage.bucket === 'Closed'
              ? (isAdmin
                  ? `<button class="chip tier-medium" style="font-size:10.5px;cursor:pointer" data-action="pl-review" data-id="${esc(c.recordId)}" title="Verify the money and confirm the close">Pending — Review ✓</button>`
                  : '<span class="chip tier-medium" style="font-size:10.5px" title="A partner verifies before it counts">Pending partner</span>')
              : '')}
        <span class="topbar-spacer"></span>
        ${canMove ? `
          ${prev ? `<button class="btn btn-quiet btn-sm" style="padding:2px 8px" title="Back to ${esc(prev.label)}" data-action="pl-move" data-id="${esc(c.recordId)}" data-stage="${esc(prev.id)}">‹</button>` : ''}
          ${next ? `<button class="btn btn-quiet btn-sm" style="padding:2px 8px" title="Advance to ${esc(next.label)}" data-action="pl-move" data-id="${esc(c.recordId)}" data-stage="${esc(next.id)}">›</button>` : ''}
          ${lastStop ? (firstClosedIsDelivery(c)
            ? `<button class="btn btn-gold btn-sm" style="padding:2px 8px;font-size:11px" title="Initial premium collected — move to Delivery Requirements. A partner verifies before it counts." data-action="pl-won" data-id="${esc(c.recordId)}">Delivery ›</button>`
            : `<button class="btn btn-gold btn-sm" style="padding:2px 8px;font-size:11px" title="Push to Won — a partner verifies before it counts" data-action="pl-won" data-id="${esc(c.recordId)}">Won ✓</button>`) : ''}
          <button class="btn btn-quiet btn-sm" style="padding:2px 8px" title="Mark lost…" data-action="pl-lost" data-id="${esc(c.recordId)}">✕</button>`
        : closed && nextDone ? `
          <button class="btn btn-gold btn-sm" style="padding:2px 8px;font-size:11px" title="Delivery receipt signed — nothing else owed on this one" data-action="pl-move" data-id="${esc(c.recordId)}" data-stage="${esc(nextDone.id)}">Signed ✓</button>`
        : closed && prevDone ? `
          <button class="btn btn-quiet btn-sm" style="padding:2px 8px" title="Back to ${esc(prevDone.label)} — the receipt is still outstanding" data-action="pl-move" data-id="${esc(c.recordId)}" data-stage="${esc(prevDone.id)}">‹</button>` : ''}
        <span class="cell-sub" style="font-size:11px;${stale ? 'color:var(--bad);font-weight:700' : ''}">${days}d</span>
      </div>
    </div>`;
  }

  function boardHtml(isAdmin) {
    const pl = P().pipeline(st.pl) || P().pipelines()[0];
    const rows = casesFor(pl.id);
    const byStage = {};
    rows.forEach(c => { const s = P().stageForCase(c); (byStage[s] = byStage[s] || []).push(c); });

    const cols = P().boardStages(pl).map(stage => {
      const items = (byStage[stage.id] || []).sort((a, b) => ageDays(b) - ageDays(a));
      const sum = items.reduce((n, c) => n + (Number(SC().usesAum(c.product) ? c.aum : c.amount) || 0), 0);
      const isWon = stage.bucket === 'Closed';
      return `<div class="board-col" data-plstage="${esc(stage.id)}" ${isWon ? 'data-plwon="1"' : ''}>
        <div class="board-col-head">
          <span class="bar" style="background:${BUCKET_DOT[stage.bucket]}"></span>
          <span class="ttl">${esc(stage.label)}</span>
          <span class="cnt">${items.length}${sum ? ' · ' + U().moneyK(sum) : ''}</span>
        </div>
        <div class="board-col-body">
          ${items.map(c => card(c, stage, isAdmin)).join('') || `<p class="muted center drop-hint" style="font-size:12.5px;padding:14px 0">${isWon ? 'Closes land here' : 'Drop here'}</p>`}
        </div>
      </div>`;
    }).join('');

    const tabs = P().pipelines().map(p =>
      `<button class="btn btn-sm ${p.id === st.pl ? 'btn-navy' : 'btn-ghost'}" data-action="pl-track" data-pl="${esc(p.id)}">${esc(p.name)}</button>`).join('');
    const owners = {};
    SD().cases().forEach(c => { if (c.agentName) owners[c.agentName] = 1; });
    const ownerOpts = Object.keys(owners).sort().map(o =>
      `<option value="${esc(o)}" ${o === st.owner ? 'selected' : ''}>${esc(o)}</option>`).join('');
    const lost = lostCount(pl.id);

    return `
      <div class="filterbar" style="flex-direction:row;align-items:center;flex-wrap:wrap;gap:8px">
        ${tabs}
        <span class="pl-divider"></span>
        <button class="btn btn-sm btn-ghost" data-action="nav" data-view="cases"
          title="Every case on every track, as a table — including lost ones">☰ All cases</button>
        <span class="topbar-spacer"></span>
        ${lost ? `<span class="chip tier-low" title="Lost cases on this track — browse them in All cases">Lost · ${lost}</span>` : ''}
        <select id="pl-owner" class="fbar-select" style="width:auto"><option value="">All owners</option>${ownerOpts}</select>
        <button class="btn btn-gold btn-sm" data-action="cs-new">＋ New opportunity</button>
      </div>
      <p class="muted" style="font-size:12.5px;margin:0 0 12px">
        Drag a card, or use ‹ › on the card. Entering <b style="color:var(--gold)">Application</b> (or any gold-dot stage)
        counts the case as written — permanently, on the week it happens. Dropping on
        <b style="color:var(--good)">Close / Won</b> sends it for a partner's confirmation; it counts once confirmed.
      </p>
      <div class="board">${cols}</div>`;
  }

  // ── lost modal ────────────────────────────────────────────
  function lostModal(recordId) {
    const c = SD().caseById(recordId); if (!c) return;
    const opts = P().lostReasons().map(r => `<option>${esc(r)}</option>`).join('');
    document.getElementById('modal-mount').innerHTML = `
      <div class="scrim" data-action="close-modal"></div>
      <div class="modal-card">
        <div class="modal-head"><h2>Mark lost</h2>
          <p>${esc(c.clientName || '')} · ${esc(SC().productName(c.product))}. Lost reasons are the only honest record of why business does not close.</p></div>
        <div class="modal-body">
          <div class="field-group"><label class="lbl">Reason</label><select id="pl-lost-reason">${opts}</select></div>
          <div class="field-group"><label class="lbl">Note (optional)</label><input id="pl-lost-note" placeholder="e.g. going with employer coverage"></div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" data-action="close-modal">Cancel</button>
          <button class="btn btn-danger" data-action="pl-lost-save" data-id="${esc(recordId)}">Mark lost</button>
        </div>
      </div>`;
  }

  // ── edge auto-scroll while dragging ───────────────────────
  // Browsers do not scroll an inner overflow container during a native
  // drag, so a column past the edge of the screen was unreachable
  // without dropping the card first. Holding a card near the board's
  // left or right edge now scrolls it, faster the closer to the edge.
  // Generic on .board, so the leads board is cured by the same code.
  let asBoard = null, asVel = 0, asRaf = null;
  function asStop() {
    asBoard = null; asVel = 0;
    if (asRaf) { cancelAnimationFrame(asRaf); asRaf = null; }
  }
  function asTick() {
    if (asBoard && asVel) { asBoard.scrollLeft += asVel; asRaf = requestAnimationFrame(asTick); }
    else asStop();
  }
  document.addEventListener('dragover', e => {
    const t = (e.target && e.target.nodeType === 1) ? e.target : e.target && e.target.parentElement;
    const board = t && t.closest('.board');
    if (!board) { asStop(); return; }
    const r = board.getBoundingClientRect();
    const ZONE = 90;                                   // px from the edge where scrolling kicks in
    let v = 0;
    if (e.clientX < r.left + ZONE) v = -Math.ceil((ZONE - (e.clientX - r.left)) / 5);
    else if (e.clientX > r.right - ZONE) v = Math.ceil((ZONE - (r.right - e.clientX)) / 5);
    asBoard = board; asVel = v;                        // up to ~18px/frame at the very edge
    if (v && !asRaf) asRaf = requestAnimationFrame(asTick);
  });
  document.addEventListener('dragend', asStop);
  document.addEventListener('drop', asStop);

  // ── drag wiring (own namespace; the kernel's lead handlers ignore it) ──
  let dragId = null;
  const clearHighlights = () => document.querySelectorAll('.board-col.drop-target').forEach(c => {
    if (c.hasAttribute('data-plstage')) c.classList.remove('drop-target');
  });
  document.addEventListener('dragstart', e => {
    const el = (e.target && e.target.nodeType === 1) ? e.target : null;
    const c = el && el.closest('.pl-card[draggable="true"]');
    if (!c) return;
    dragId = c.dataset.case;
    try { e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; } catch (_) {}
  });
  document.addEventListener('dragend', () => { dragId = null; clearHighlights(); });
  /* Where a drop lands. closest() answers when the pointer is over a
     column; the fallback answers for the dead space between and below
     short columns — still inside the board, still clearly "this column"
     to the person holding the card, so it resolves by the pointer's X.
     Above or below the board entirely stays a non-drop. */
  function colUnder(e, t) {
    const direct = t && t.closest('.board-col[data-plstage]');
    if (direct) return direct;
    const cols = document.querySelectorAll('.board-col[data-plstage]');
    for (let i = 0; i < cols.length; i++) {
      const r = cols[i].getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right) continue;
      const b = cols[i].closest('.board');
      const br = b ? b.getBoundingClientRect() : r;
      return (e.clientY >= br.top && e.clientY <= br.bottom + 30) ? cols[i] : null;
    }
    return null;
  }
  document.addEventListener('dragover', e => {
    if (!dragId) return;
    const t = (e.target && e.target.nodeType === 1) ? e.target : e.target && e.target.parentElement;
    const col = colUnder(e, t);
    if (!col) { clearHighlights(); return; }
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
    clearHighlights();
    col.classList.add('drop-target');
  });
  document.addEventListener('drop', e => {
    if (!dragId) return;
    const t = (e.target && e.target.nodeType === 1) ? e.target : e.target && e.target.parentElement;
    const col = colUnder(e, t);
    const id = dragId; dragId = null; clearHighlights();
    if (!col) return;
    e.preventDefault();
    if (col.hasAttribute('data-plwon')) {
      const cd = SD().caseById(id);
      // a closed stray dropped on a specific closed column parks THERE
      if (cd && cd.closedAt) parkClosed(id, col.dataset.plstage);
      else toWon(id);
      return;
    }
    SD().setPipelineStage(id, col.dataset.plstage)
      .then(() => { RWG.app.renderMain(); fireWorkflows(id); })
      .catch(err => U().toast('Could not move: ' + err.message));
  });

  // Say who has the work. Most workflow steps land on the case manager,
  // and a toast that says 'on My Work' sends you to look in the wrong list.
  function announce(id, started) {
    if (!started.length) return;
    const T = RWG.tasks, who = {};
    if (T && T.isStarted()) {
      T.all().filter(t => t.relatedType === 'case' && t.relatedId === id && t.status !== 'done')
        .forEach(t => { const n = (t.assigneeName || '').split(' ')[0]; if (n) who[n] = 1; });
    }
    const names = Object.keys(who);
    U().toast(started.join(' + ') + ' started — ' +
      (names.length ? names.join(' and ') + ' now ' + (names.length > 1 ? 'have' : 'has') + ' the steps' : 'the steps are on Tasks'), true);
  }

  /* A move into Submitted used to start the checklist by itself. It ASKS
     now: which workflow (when the product matches more than one), and —
     because every advisor step resolves to the case owner — who the main
     agent on this case actually is. Skipping is a real answer; the move
     itself stands either way. Everything else (the close-confirm
     launches) stays automatic. */
  const wfAsked = {};   // per session: "Not now" means not now, not "ask on every move"
  function fireWorkflows(id) {
    const c = SD().caseById(id); if (!c || !RWG.wf) return;
    const cands = RWG.wf.candidates ? RWG.wf.candidates(c) : [];
    if (!cands.length) return;
    // Nothing launches without asking — Carlos's rule, and it covers the
    // close-confirm launches (Policy Delivery, Onboarding) the same as the
    // Submitted entry. More than one match renders as checkboxes, all on.
    if (wfAsked[id]) return;
    wfAsked[id] = 1;

    const bucket = P().bucketOf(c.product, P().stageForCase(c));
    const stageLbl = P().stageLabel(c.product, P().stageForCase(c));
    const users = RWG.data.users().filter(u => u.status === 'active');
    const picks = cands.map(t => `<label class="checkitem" style="display:flex;align-items:flex-start;gap:8px;font-size:13.5px;padding:4px 0">
        <input type="checkbox" id="plwf-t-${esc(t.id)}" checked style="accent-color:var(--gold);margin-top:2px">
        <span><b>${esc(t.name)}</b>${t.desc ? `<span class="cell-sub" style="display:block">${esc(t.desc)}</span>` : ''}</span>
      </label>`).join('');
    // An agent's roster is themselves; the verify collapses to a statement.
    const agentSel = users.length > 1
      ? `<select id="plwf-agent">${users.map(u =>
          `<option value="${esc(u.id)}" ${u.id === c.agentUid ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>`
      : `<input value="${esc(c.agentName || (users[0] && users[0].name) || '')}" disabled>`;
    document.getElementById('modal-mount').innerHTML = `
      <div class="scrim" data-action="close-modal"></div>
      <div class="modal-card modal-sm">
        <div class="modal-head"><h2>Start ${cands.length === 1 ? 'a workflow' : 'workflows'}?</h2>
          <p>${esc(c.title || c.clientName || 'This case')} · ${esc(SC().productName(c.product))} — now in ${esc(stageLbl || bucket)}.</p></div>
        <div class="modal-body">
          <div class="field-group"><label class="lbl">${cands.length === 1 ? 'Workflow' : 'Workflows'}</label>
            ${picks}
            <div class="hint">Steps land on the right lists with their dates chained. Work the case
              already got past launches checked off, not nagging.</div></div>
          <div class="field-group"><label class="lbl">Main agent on this case</label>
            ${agentSel}
            <div class="hint">The advisor steps go to whoever is named here. Changing it makes them the case owner.</div></div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" data-action="close-modal">Not now</button>
          <button class="btn btn-gold" data-action="pl-wf-start" data-id="${esc(c.recordId)}">Start</button>
        </div>
      </div>`;
  }

  // Required workflow steps hold the door to Won shut (phase 4). The
  // partner's confirm in the close review is deliberately NOT gated.
  function blockedModal(blocks) {
    document.getElementById('modal-mount').innerHTML = `
      <div class="scrim" data-action="close-modal"></div>
      <div class="modal-card">
        <div class="modal-head"><h2>Not ready to close</h2>
          <p>Required workflow steps are still open on this case. Finish them — they are on Tasks — then push to Won.</p></div>
        <div class="modal-body">
          ${blocks.map(t => `<div class="flex" style="gap:10px;padding:9px 2px;border-bottom:1px solid rgba(14,36,64,.06);align-items:flex-start">
            <span style="flex:none">⛔</span>
            <span style="min-width:0;flex:1;font-size:13.5px;color:var(--ink)">${esc(t.title)}
              <span class="pill-soft" style="font-size:11px;margin-left:6px">${esc((t.assigneeName || '').split(' ')[0])}</span></span>
            <span class="cell-sub" style="flex:none">${esc(t.dueDate || '')}</span>
          </div>`).join('')}
        </div>
        <div class="modal-foot"><button class="btn btn-navy" data-action="close-modal">Got it</button></div>
      </div>`;
  }

  // Push to Won. A partner lands straight in the close review — confirming
  // their own case is one motion. An advisor's case waits in the inbox.
  const INS_FAM = { wl: 1, term: 1, di: 1, ltc: 1 };
  /* A closed case that sits in a WORKING column is a stray — mostly from
     the stage-triage window before the closed stages existed. Pushing it
     is not a close (it already closed, counted, partner-stamped); it is
     parking. So the same gesture just moves it: no review, no premium
     question, no stamp touched. */
  function parkClosed(id, stageId) {
    const c = SD().caseById(id); if (!c) return;
    const pl = P().pipelineForProduct(c.product);
    const target = (stageId && pl.stages.find(x => x.id === stageId && x.bucket === 'Closed'))
      || pl.stages.find(x => x.bucket === 'Closed');
    if (!target) return;
    SD().setPipelineStage(id, target.id)
      .then(() => { RWG.app.renderMain();
        U().toast('Moved to ' + target.label + ' — already closed and counted; nothing re-opens', true); })
      .catch(err => U().toast('Could not move: ' + err.message));
  }
  function toWon(id) {
    const c1 = SD().caseById(id);
    if (c1 && c1.closedAt) { parkClosed(id); return; }
    const blocks = RWG.wf ? RWG.wf.blockers(id) : [];
    if (blocks.length) { blockedModal(blocks); return; }
    // The door to Delivery Requirements is the premium, not the paperwork:
    // no premium, no pay, and nothing to send the client. Asked on every
    // path in — drag, button, or the window's stage picker.
    const c0 = SD().caseById(id);
    if (c0 && INS_FAM[c0.product] &&
        !confirm('Has the initial premium been collected?' + String.fromCharCode(10, 10) + 'The premium is what pays us, and the delivery requirements cannot go to the client until it is in. If it is not collected yet, keep the case in Funding.')) return;
    SD().pushWon(id).then(() => {
      if (RWG.app.effectiveRole() === 'admin') {
        const inbox = RWG.modules.get('inbox');
        if (inbox) { inbox.state.reviewId = id; RWG.app.nav('close-review'); return; }
      }
      RWG.app.renderMain();
      U().toast('Sent for a partner to verify — it counts once confirmed', true);
    }).catch(err => U().toast('Could not push: ' + err.message));
  }

  // The opportunity window saves a case that may start at a Submitted
  // stage; it asks the same question through the same door.
  RWG.wfPrompt = fireWorkflows;

  RWG.modules.register({
    id: 'pipeline',
    title: 'Opportunity',
    enabled: true,
    roles: ['admin', 'agent'],
    nav: [{ view: 'pipeline', label: 'Opportunity', icon: 'board', also: ['cases'] }],
    meta: { pipeline: { t: 'Opportunity', s: 'Every open opportunity, stage by stage' } },
    state: st,

    home: {
      tile: () => ({
        icon: 'board', title: 'Opportunity',
        desc: 'The book as a board: drag opportunities through their real stages.',
        view: 'pipeline'
      })
    },

    onEnter() {
      const me = RWG.auth.currentUser();
      if (!SD().isStarted()) SD().init(me, RWG.app.renderMain);
      if (!H().isStarted()) H().init(me, RWG.app.renderMain);
      P().init();
      // Workflows read and write tasks: gates + auto-launch dedupe need the cache live.
      if (RWG.tasks && !RWG.tasks.isStarted()) RWG.tasks.init(me, RWG.app.renderMain);
      if (RWG.wf) RWG.wf.init();
    },

    onChange(e) {
      if (e.target.id === 'pl-owner') { st.owner = e.target.value; RWG.app.renderMain(); }
    },

    actions: {
      'pl-track': (el) => { st.pl = el.dataset.pl; RWG.app.renderMain(); },
      'pl-move': (el) => {
        SD().setPipelineStage(el.dataset.id, el.dataset.stage)
          .then(() => { RWG.app.renderMain(); fireWorkflows(el.dataset.id); })
          .catch(err => U().toast('Could not move: ' + err.message));
      },
      'pl-won': (el) => toWon(el.dataset.id),
      'pl-wf-start': (el) => {
        const c = SD().caseById(el.dataset.id); if (!c || !RWG.wf) return;
        const g = (i) => { const x = document.getElementById(i); return x ? x.value : ''; };
        const chosen = (RWG.wf.candidates(c) || []).filter(t => {
          const box = document.getElementById('plwf-t-' + t.id);
          return box ? box.checked : true;
        });
        const uid = g('plwf-agent') || c.agentUid;
        const u = RWG.data.user(uid);
        const proceed = (row) => {
          const names = [];
          let pre = 0;
          chosen.forEach(t => {
            const r = RWG.wf.launch(t.id, { caseRecord: row });
            if (r) { names.push(r.name); pre += r.preDone || 0; }
          });
          document.getElementById('modal-mount').innerHTML = '';
          RWG.app.renderMain();
          announce(row.recordId, names);
          if (pre) U().toast(pre + (pre === 1 ? ' step the case was already past is' : ' steps the case was already past are') + ' checked off', true);
        };
        // Verifying the agent IS assigning the case: the owner drives every
        // advisor step, the boards and the scorecard alike.
        if (uid && uid !== c.agentUid && u) {
          SD().saveCase(Object.assign({}, c, { agentUid: uid, agentName: u.name || '' }))
            .then(proceed).catch(err => U().toast('Could not set the agent: ' + err.message));
        } else proceed(c);
      },
      'pl-review': (el) => {
        const inbox = RWG.modules.get('inbox');
        if (!inbox) return;
        inbox.state.reviewId = el.dataset.id;
        inbox.state.form = null; inbox.state.formId = null;
        inbox.state.splits = null; inbox.state.splitsId = null;
        RWG.app.nav('close-review');
      },
      'pl-lost': (el) => lostModal(el.dataset.id),
      'pl-lost-save': (el) => {
        const reason = (document.getElementById('pl-lost-reason') || {}).value || 'Other';
        const note = (document.getElementById('pl-lost-note') || {}).value || '';
        SD().markLost(el.dataset.id, reason, note.trim())
          .then(() => { document.getElementById('modal-mount').innerHTML = ''; RWG.app.renderMain(); U().toast('Marked lost — it stays browsable in All Cases', true); })
          .catch(err => U().toast('Could not save: ' + err.message));
      }
    },

    render(view, user, ctx) {
      if (!SD().isStarted()) return `<div class="empty" style="padding:60px"><div class="ec">⏳</div><h3>Loading the book…</h3></div>`;
      return boardHtml(ctx.isAdmin);
    }
  });
})();
