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
    // At the last working stage, the arrow's place is taken by the push to Won.
    const lastStop = canMove && !next && stage.bucket === 'Submitted';
    return `<div class="card tight pl-card${canMove ? '' : ' pl-done'}" ${canMove ? 'draggable="true"' : ''} data-case="${esc(c.recordId)}"
        style="cursor:pointer;border-left:3px solid ${closed ? 'var(--good)' : (stage.bucket === 'Submitted' ? 'var(--gold)' : 'var(--line-strong)')}">
      <div class="flex" style="justify-content:space-between;gap:8px;align-items:flex-start" data-action="cs-open" data-id="${esc(c.recordId)}">
        <div>
          <div style="font-weight:700;font-size:13.5px;color:var(--navy)">${esc(c.clientName || '(no name)')}</div>
          <div class="cell-sub">${esc(sc.productName(c.product))}${c.source ? ' · ' + esc(sc.sourceLabel(c.source)) : ''}</div>
        </div>
        ${c.householdId ? `<button class="btn btn-quiet btn-sm" data-action="hh-goto" data-id="${esc(c.householdId)}" title="Open the household" style="padding:2px 7px">🏠</button>` : ''}
      </div>
      <div class="serif" style="font-size:16px;color:var(--navy);margin-top:6px" data-action="cs-open" data-id="${esc(c.recordId)}">${U().money(money)}</div>
      <div class="flex" style="align-items:center;gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid var(--line)">
        <span class="pill-soft" style="font-size:11px">${esc(first || '—')}</span>
        ${closed ? '<span class="chip tier-high" style="font-size:10.5px">Confirmed ✓</span>'
          : (stage.bucket === 'Closed'
              ? (isAdmin
                  ? `<button class="chip tier-medium" style="font-size:10.5px;cursor:pointer" data-action="pl-review" data-id="${esc(c.recordId)}" title="Verify the money and confirm the close">Pending — Review ✓</button>`
                  : '<span class="chip tier-medium" style="font-size:10.5px" title="A partner verifies before it counts">Pending partner</span>')
              : '')}
        <span class="topbar-spacer"></span>
        ${canMove ? `
          ${prev ? `<button class="btn btn-quiet btn-sm" style="padding:2px 8px" title="Back to ${esc(prev.label)}" data-action="pl-move" data-id="${esc(c.recordId)}" data-stage="${esc(prev.id)}">‹</button>` : ''}
          ${next ? `<button class="btn btn-quiet btn-sm" style="padding:2px 8px" title="Advance to ${esc(next.label)}" data-action="pl-move" data-id="${esc(c.recordId)}" data-stage="${esc(next.id)}">›</button>` : ''}
          ${lastStop ? `<button class="btn btn-gold btn-sm" style="padding:2px 8px;font-size:11px" title="Push to Won — a partner verifies before it counts" data-action="pl-won" data-id="${esc(c.recordId)}">Won ✓</button>` : ''}
          <button class="btn btn-quiet btn-sm" style="padding:2px 8px" title="Mark lost…" data-action="pl-lost" data-id="${esc(c.recordId)}">✕</button>` : ''}
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
        <span class="topbar-spacer"></span>
        ${lost ? `<span class="chip tier-low" title="Lost cases on this track — browse them in All Cases">Lost · ${lost}</span>` : ''}
        <select id="pl-owner" class="fbar-select" style="width:auto"><option value="">All owners</option>${ownerOpts}</select>
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
  document.addEventListener('dragover', e => {
    if (!dragId) return;
    const t = (e.target && e.target.nodeType === 1) ? e.target : e.target && e.target.parentElement;
    const col = t && t.closest('.board-col[data-plstage]');
    if (!col) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
    clearHighlights();
    col.classList.add('drop-target');
  });
  document.addEventListener('drop', e => {
    if (!dragId) return;
    const t = (e.target && e.target.nodeType === 1) ? e.target : e.target && e.target.parentElement;
    const col = t && t.closest('.board-col[data-plstage]');
    const id = dragId; dragId = null; clearHighlights();
    if (!col) return;
    e.preventDefault();
    if (col.hasAttribute('data-plwon')) { toWon(id); return; }
    SD().setPipelineStage(id, col.dataset.plstage)
      .then(() => RWG.app.renderMain())
      .catch(err => U().toast('Could not move: ' + err.message));
  });

  // Push to Won. A partner lands straight in the close review — confirming
  // their own case is one motion. An advisor's case waits in the inbox.
  function toWon(id) {
    SD().pushWon(id).then(() => {
      if (RWG.app.effectiveRole() === 'admin') {
        const inbox = RWG.modules.get('inbox');
        if (inbox) { inbox.state.reviewId = id; RWG.app.nav('close-review'); return; }
      }
      RWG.app.renderMain();
      U().toast('Sent for a partner to verify — it counts once confirmed', true);
    }).catch(err => U().toast('Could not push: ' + err.message));
  }

  RWG.modules.register({
    id: 'pipeline',
    title: 'Pipeline',
    enabled: true,
    roles: ['admin', 'agent'],
    nav: [{ view: 'pipeline', label: 'Pipeline', icon: 'board' }],
    meta: { pipeline: { t: 'Pipeline', s: 'Every open opportunity, stage by stage' } },
    state: st,

    home: {
      tile: () => ({
        icon: 'board', title: 'Pipeline',
        desc: 'The book as a board: drag opportunities through their real stages.',
        view: 'pipeline'
      })
    },

    onEnter() {
      const me = RWG.auth.currentUser();
      if (!SD().isStarted()) SD().init(me, RWG.app.renderMain);
      if (!H().isStarted()) H().init(me, RWG.app.renderMain);
      P().init();
    },

    onChange(e) {
      if (e.target.id === 'pl-owner') { st.owner = e.target.value; RWG.app.renderMain(); }
    },

    actions: {
      'pl-track': (el) => { st.pl = el.dataset.pl; RWG.app.renderMain(); },
      'pl-move': (el) => {
        SD().setPipelineStage(el.dataset.id, el.dataset.stage)
          .then(() => RWG.app.renderMain())
          .catch(err => U().toast('Could not move: ' + err.message));
      },
      'pl-won': (el) => toWon(el.dataset.id),
      'pl-review': (el) => {
        const inbox = RWG.modules.get('inbox');
        if (inbox) { inbox.state.reviewId = el.dataset.id; RWG.app.nav('close-review'); }
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
