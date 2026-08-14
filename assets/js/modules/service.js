/* ============================================================
   RWG Platform — Service (phase 7)

   The other half of a book of business: the work that starts AFTER
   the close. A beneficiary change, a withdrawal, a billing problem,
   a claim — none of it is a sale, all of it is why clients stay.

   A service request is an ORDINARY TASK wearing a service flag
   (kind:'service' + serviceType + waiting) — the same decision as
   workflows, for the same reasons: it lands on My Work by itself,
   the household's Open-tasks card shows it, the badge counts it,
   and no new collection or rules are needed. This screen is the
   queue view Kathy runs the desk from: what's open, what's waiting
   on a carrier or client, what got done.

   Default owner is the case-manager role (Kathy), resolved through
   the same pin the workflows use. Everything stays reassignable.
   ============================================================ */
window.RWG = window.RWG || {};

(function () {
  const T = () => RWG.tasks;
  const H = () => RWG.hh;
  const D = () => RWG.data;
  const U = () => RWG.ui;
  const esc = (s) => U().esc(s);
  const dayMs = 86400000;

  const st = { show: 'open', type: '', who: '' };

  const TYPES = ['Beneficiary change', 'Address / contact change', 'Withdrawal / distribution',
    'Fund reallocation', 'Premium / billing issue', 'Policy loan', 'Claim',
    'Document / statement request', 'Other'];

  const all = () => T().isStarted() ? T().all().filter(t => t.kind === 'service') : [];
  const openQ = () => all().filter(t => t.status !== 'done' && !t.waiting);
  const waitingQ = () => all().filter(t => t.status !== 'done' && t.waiting);
  const doneQ = () => all().filter(t => t.status === 'done' && (t.doneAt || 0) >= Date.now() - 30 * dayMs);

  const mount = () => document.getElementById('modal-mount');
  const g = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };

  // ── the request modal ─────────────────────────────────────
  function svModal(presetHh) {
    const hhs = H().households().slice().sort((a, b) => a.name.localeCompare(b.name));
    const hhOpts = hhs.map(h => `<option value="${esc(h.id)}" ${h.id === presetHh ? 'selected' : ''}>${esc(h.name)}</option>`).join('');
    const typeOpts = TYPES.map(t => `<option>${esc(t)}</option>`).join('');
    const users = D().users().filter(u => u.status === 'active');
    const cm = RWG.wf ? RWG.wf.resolveOwner('casemanager', null) : null;
    const userOpts = users.map(u => `<option value="${esc(u.id)}" ${cm && u.id === cm.uid ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
    const due = T().todayKey(Date.now() + 3 * dayMs);
    mount().innerHTML = `
      <div class="scrim" data-action="close-modal"></div>
      <div class="modal-card">
        <div class="modal-head"><h2>New service request</h2>
          <p>Post-close work — it lands on someone's My Work like everything else.</p></div>
        <div class="modal-body">
          <div class="field-row">
            <div class="field-group"><label class="lbl">Household</label><select id="sv-hh">${hhOpts}</select></div>
            <div class="field-group"><label class="lbl">Type</label><select id="sv-type">${typeOpts}</select></div>
          </div>
          <div class="field-group"><label class="lbl">What needs doing</label>
            <input id="sv-title" placeholder="e.g. Update beneficiary to the new trust"></div>
          <div class="field-row">
            <div class="field-group"><label class="lbl">Assigned to</label><select id="sv-who">${userOpts}</select></div>
            <div class="field-group"><label class="lbl">Due</label><input id="sv-due" type="date" value="${esc(due)}"></div>
          </div>
          <div class="field-group"><label class="lbl">Note <span class="pill-soft" style="font-size:10.5px">optional</span></label>
            <input id="sv-note" placeholder="policy #, carrier, who called…"></div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" data-action="close-modal">Cancel</button>
          <button class="btn btn-gold" data-action="sv-save">Open request</button>
        </div>
      </div>`;
    const inp = document.getElementById('sv-title'); if (inp) inp.focus();
  }

  // ── rows ──────────────────────────────────────────────────
  function row(t) {
    const today = T().todayKey();
    const late = t.status !== 'done' && t.dueDate && t.dueDate < today;
    const age = Math.max(0, Math.floor((Date.now() - (t.createdAt || Date.now())) / dayMs));
    return `<div class="list-row">
      <input type="checkbox" data-action="tk-done" data-id="${esc(t.id)}" ${t.status === 'done' ? 'checked' : ''}
        style="margin-top:3px">
      <div class="grow">
        <div style="font-size:13.5px;color:var(--ink);${t.status === 'done' ? 'text-decoration:line-through;opacity:.55' : ''}">
          <span data-action="tk-edit" data-id="${esc(t.id)}" style="cursor:pointer">${esc(t.title)}</span></div>
        <div class="flex" style="gap:6px;margin-top:4px;flex-wrap:wrap;align-items:center">
          <span class="chip" style="font-size:10.5px;background:rgba(62,92,130,.10);color:#3E5C82;border:1px solid rgba(62,92,130,.35)">${U().icon('service','ic-inline')} ${esc(t.serviceType || 'Service')}</span>
          ${t.relatedId ? `<button class="chip" style="cursor:pointer;background:rgba(14,36,64,.05);color:var(--navy);border:1px solid var(--line);font-weight:600"
            data-action="hh-goto" data-id="${esc(t.relatedId)}">${U().icon('household','ic-inline')} ${esc(t.relatedLabel || '')}</button>` : ''}
          <span class="pill-soft" style="font-size:11px">${esc((t.assigneeName || '').split(' ')[0])}</span>
          ${t.waiting && t.status !== 'done' ? '<span class="chip tier-medium" style="font-size:10.5px">⏸ waiting</span>' : ''}
          ${t.note ? `<span class="cell-sub" style="font-size:11.5px">${esc(t.note)}</span>` : ''}
        </div>
      </div>
      <div class="end" style="padding-top:2px">
        <div style="font-size:12px;${late ? 'color:var(--bad);font-weight:700' : 'color:var(--muted)'}">${late ? 'late' : esc(t.dueDate || '')}</div>
        <div class="cell-sub" style="font-size:10.5px">${age}d old</div>
      </div>
      ${t.status !== 'done' ? `<button class="btn btn-quiet btn-sm" style="flex:none;margin-top:2px" data-action="sv-wait" data-id="${esc(t.id)}"
        title="${t.waiting ? 'Back in the working queue' : 'Parked — waiting on a carrier or the client'}">${t.waiting ? '▶ Resume' : '⏸ Waiting'}</button>` : ''}
    </div>`;
  }

  function screenHtml() {
    let list = st.show === 'waiting' ? waitingQ() : st.show === 'done' ? doneQ() : openQ();
    if (st.type) list = list.filter(t => t.serviceType === st.type);
    if (st.who) list = list.filter(t => t.assigneeUid === st.who);
    list = list.slice().sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')) || (a.createdAt || 0) - (b.createdAt || 0));

    const tab = (id, label, n) => `<button class="btn btn-sm ${st.show === id ? 'btn-navy' : 'btn-ghost'}"
      data-action="sv-show" data-show="${id}">${label}${n ? ' · ' + n : ''}</button>`;
    const typeOpts = ['<option value="">All types</option>'].concat(TYPES.map(t =>
      `<option ${t === st.type ? 'selected' : ''}>${esc(t)}</option>`)).join('');
    const whoSeen = {};
    all().forEach(t => { if (t.assigneeUid && !whoSeen[t.assigneeUid]) whoSeen[t.assigneeUid] = t.assigneeName || t.assigneeUid; });
    const whoOpts = ['<option value="">Everyone</option>'].concat(Object.keys(whoSeen).map(uid =>
      `<option value="${esc(uid)}" ${uid === st.who ? 'selected' : ''}>${esc(whoSeen[uid])}</option>`)).join('');

    const empty = { open: 'Nothing open. The desk is clear.', waiting: 'Nothing parked on a carrier or client.', done: 'Nothing finished in the last 30 days.' }[st.show];
    return `
      <div class="flex" style="gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
        ${tab('open', 'Open', openQ().length)}${tab('waiting', '⏸ Waiting', waitingQ().length)}${tab('done', 'Done', doneQ().length)}
        <span class="topbar-spacer"></span>
        <select id="sv-ftype" class="fbar-select" style="width:auto">${typeOpts}</select>
        <select id="sv-fwho" class="fbar-select" style="width:auto">${whoOpts}</select>
        <button class="btn btn-gold btn-sm" data-action="sv-new">＋ Service request</button>
      </div>
      <div class="card flush">
        ${list.map(row).join('') || `<div class="empty" style="padding:44px 16px"><div class="ec">${U().icon('service','ic-lg')}</div><h3>${empty}</h3>
          <p>Service requests are tasks with a type — they show on My Work and on the household, same as everything.</p></div>`}
      </div>
      <p class="muted" style="font-size:12px;margin:10px 2px 0">
        ⏸ parks a request that is waiting on a carrier or the client — it leaves the working queue but
        never the record. Done requests stay browsable for 30 days here, forever on the household.
      </p>`;
  }

  RWG.modules.register({
    id: 'service',
    title: 'Service',
    enabled: true,
    roles: ['admin', 'agent'],
    nav: [{
      view: 'service', label: 'Service', icon: 'cases',
      badge: () => (T().isStarted() ? openQ().filter(t => t.dueDate && t.dueDate <= T().todayKey()).length : 0)
    }],
    meta: { service: { t: 'Service', s: 'The work that keeps clients — after the close' } },
    state: st,

    home: {
      tile: () => ({ icon: 'cases', title: 'Service', desc: 'Beneficiaries, withdrawals, billing — the post-close desk.', view: 'service' })
    },

    onEnter() {
      const me = RWG.auth.currentUser();
      if (!T().isStarted()) T().init(me, RWG.app.renderMain);
      if (!H().isStarted()) H().init(me, RWG.app.renderMain);
      if (RWG.wf) RWG.wf.init();   // the case-manager pin
    },

    onChange(e) {
      if (e.target.id === 'sv-ftype') { st.type = e.target.value; RWG.app.renderMain(); }
      if (e.target.id === 'sv-fwho') { st.who = e.target.value; RWG.app.renderMain(); }
    },

    actions: {
      'sv-show': (el) => { st.show = el.dataset.show; RWG.app.renderMain(); },
      'sv-new': (el) => svModal(el.dataset.hh || null),
      'sv-save': () => {
        const hhId = g('sv-hh'), type = g('sv-type');
        const title = g('sv-title').trim() || type;
        if (!hhId) { U().toast('Which household is this for?'); return; }
        const h = H().household(hhId); if (!h) return;
        const uid = g('sv-who');
        const u = D().user(uid) || RWG.auth.currentUser();
        T().addTask({
          kind: 'service', serviceType: type, waiting: false,
          title: title, note: g('sv-note').trim(),
          assigneeUid: uid || u.id, assigneeName: u.name || '',
          dueDate: g('sv-due') || T().todayKey(),
          relatedType: 'household', relatedId: h.id, relatedLabel: h.name
        });
        mount().innerHTML = '';
        RWG.app.renderMain();
        U().toast('Open — it is on ' + (u.name || 'the').split(' ')[0] + '’s My Work', true);
      },
      'sv-wait': (el) => {
        const t = T().task(el.dataset.id); if (!t) return;
        T().saveTask({ id: t.id, waiting: !t.waiting });
        RWG.app.renderMain();
      }
    },

    render(view, user, ctx) {
      if (!T().isStarted()) return `<div class="empty" style="padding:60px"><div class="ec">⏳</div><h3>Loading…</h3></div>`;
      return screenHtml();
    }
  });

  RWG._serviceModule = { TYPES, all, openQ, waitingQ, doneQ };
})();
