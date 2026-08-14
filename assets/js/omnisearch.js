/* ============================================================
   RWG Platform — Search everything

   One box in the header that reaches the whole book: people,
   households, opportunities, tasks and leads. It answers the
   question you actually have at 9am — "where is that Vargas
   thing?" — without you first deciding which screen it lives on.

   It searches the live caches, so results are as fresh as the
   listeners. Any layer that hasn't woken yet is started on first
   use rather than searched empty.

   Each hit carries the action that opens it, so clicking a result
   goes through exactly the same door as clicking the record on its
   own screen — no second navigation path to keep in step.
   ============================================================ */
window.RWG = window.RWG || {};

RWG.omni = (function () {
  const H  = () => RWG.hh;
  const SD = () => RWG.scorecardData;
  const SC = () => RWG.scorecard;
  const T  = () => RWG.tasks;
  const D  = () => RWG.data;

  const norm = (s) => String(s == null ? '' : s).toLowerCase();
  const digits = (s) => String(s == null ? '' : s).replace(/\D/g, '');

  // Wake every layer the search reads. Idempotent, and each one's
  // callback is the usual repaint.
  function warm() {
    const me = RWG.auth && RWG.auth.currentUser && RWG.auth.currentUser();
    if (!me) return;
    const repaint = RWG.app.renderMain;
    if (H() && !H().isStarted()) H().init(me, repaint);
    if (SD() && !SD().isStarted()) SD().init(me, repaint);
    if (T() && !T().isStarted()) T().init(me, repaint);
    if (RWG.pipelines) RWG.pipelines.init();
  }

  /* A hit scores so the obvious answer comes first: a name that
     starts with what you typed beats one that merely contains it,
     and an exact match beats both. Without this, "ana" surfaces
     "Deana Ruiz" above "Ana Delgado". */
  function score(hay, q) {
    const h = norm(hay);
    if (!h) return 0;
    if (h === q) return 100;
    if (h.indexOf(q) === 0) return 70;
    // A match at the start of any word is still a deliberate match.
    if (h.indexOf(' ' + q) >= 0) return 55;
    if (h.indexOf(q) >= 0) return 30;
    return 0;
  }

  const GROUPS = [
    { id: 'contacts', label: 'People', icon: '👤' },
    { id: 'households', label: 'Households', icon: RWG.ui.icon('household','ic-inline') },
    { id: 'cases', label: 'Opportunities', icon: '📁' },
    { id: 'tasks', label: 'Tasks', icon: '✓' },
    { id: 'leads', label: 'Leads', icon: RWG.ui.icon('spark','ic-inline') }
  ];

  function query(raw, perGroup) {
    const q = norm(raw).trim();
    const out = [];
    if (q.length < 2) return out;
    const qd = digits(q);
    const byPhone = qd.length >= 3;
    const cap = perGroup || 5;

    const push = (group, s, hit) => { if (s > 0) out.push(Object.assign({ group, _s: s }, hit)); };

    // ── people ──
    if (H() && H().isStarted()) {
      H().contacts().forEach(c => {
        const name = H().contactName(c);
        let s = Math.max(score(name, q), score(c.email, q), score(c.employer, q) * 0.6);
        if (!s && byPhone && digits(c.phone).indexOf(qd) >= 0) s = 40;
        if (!s) (c.tags || []).forEach(t => { s = Math.max(s, score(t, q) * 0.5); });
        const hh = c.householdId ? H().household(c.householdId) : null;
        push('contacts', s, {
          title: name || '(no name)',
          sub: [c.relationship, hh ? hh.name : '', c.email].filter(Boolean).join(' · '),
          action: hh ? 'hh-goto' : '', id: hh ? hh.id : ''
        });
      });

      // ── households ──
      H().households().forEach(h => {
        const s = Math.max(score(h.name, q), score(h.source, q) * 0.5);
        push('households', s, {
          title: h.name,
          sub: [H().contactsFor(h.id).length + ' ' + (H().contactsFor(h.id).length === 1 ? 'person' : 'people'),
                h.advisorName || ''].filter(Boolean).join(' · '),
          action: 'hh-goto', id: h.id
        });
      });
    }

    // ── opportunities ──
    if (SD() && SD().isStarted()) {
      SD().cases().forEach(c => {
        const s = Math.max(score(c.title, q), score(c.clientName, q));
        const stage = c.closedAt ? 'Closed ✓' : (c.state || '');
        push('cases', s, {
          title: c.title || c.clientName || '(unnamed)',
          sub: [SC().productName(c.product), stage, c.agentName].filter(Boolean).join(' · '),
          action: 'cs-open', id: c.recordId
        });
      });
    }

    // ── tasks ──
    if (T() && T().isStarted()) {
      T().all().forEach(t => {
        const s = Math.max(score(t.title, q), score(t.note, q) * 0.6, score(t.relatedLabel, q) * 0.5);
        push('tasks', s, {
          title: t.title,
          sub: [t.status === 'done' ? 'done' : (t.dueDate ? 'due ' + t.dueDate : 'no date'),
                t.assigneeName, t.relatedLabel].filter(Boolean).join(' · '),
          action: 'tk-edit', id: t.id
        });
      });
    }

    // ── leads ──
    if (D() && D().leads) {
      let leads = [];
      try { leads = D().leads() || []; } catch (e) { leads = []; }
      leads.forEach(l => {
        const name = D().fullName(l);
        let s = Math.max(score(name, q), score(l.email, q), score(l.employer, q) * 0.6);
        if (!s && byPhone && digits(l.phone).indexOf(qd) >= 0) s = 40;
        push('leads', s, {
          title: name || '(no name)',
          sub: [l.stage, l.employer].filter(Boolean).join(' · '),
          action: 'open-lead', id: l.id
        });
      });
    }

    // Best first within each group, then capped, then grouped in a
    // stable order so the panel doesn't reshuffle as you type.
    const byGroup = {};
    out.forEach(r => { (byGroup[r.group] = byGroup[r.group] || []).push(r); });
    const final = [];
    GROUPS.forEach(g => {
      const rows = (byGroup[g.id] || []).sort((a, b) => b._s - a._s || a.title.localeCompare(b.title));
      if (!rows.length) return;
      final.push({ header: g.label, icon: g.icon, total: rows.length });
      rows.slice(0, cap).forEach(r => final.push(r));
      if (rows.length > cap) final.push({ more: rows.length - cap, group: g.id });
    });
    return final;
  }

  return { query, warm, GROUPS };
})();
