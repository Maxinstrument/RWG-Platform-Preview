/* ============================================================
   RWG Platform — Households module (the spine, phase 1)

   Two views:
     households   the book — every client family, searchable
     household    one family: people, key dates, connections, notes

   Plus the conversion flow: a lead becomes a contact on a household
   without anything being retyped. Reached from the lead drawer
   ("Convert to household ✦") or from this module's own picker.

   Data from RWG.hh (households-data.js). Leads stay owned by
   RWG.data — this module only reads them, except through
   RWG.hh.convertLead which stamps the pointer.
   ============================================================ */
window.RWG = window.RWG || {};

(function () {
  const H = () => RWG.hh;
  const U = () => RWG.ui;
  const D = () => RWG.data;
  const esc = (s) => U().esc(s);

  const st = { q: '', currentId: null, convertQ: '' };

  // Advisor choices: admins see the whole team, agents only themselves
  // (that is all their user cache holds, and all they may assign).
  function advisorOptions(selUid) {
    const users = D().users().filter(u => u.status === 'active');
    const me = RWG.auth.currentUser();
    const list = users.length ? users : [me];
    return list.map(u => `<option value="${esc(u.id)}" ${u.id === selUid ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
  }
  const userName = (uid) => { const u = D().user(uid); return u ? u.name : ''; };

  // There is one list of households and it lives inside Contacts. Landing on
  // the old standalone view — a bookmark, an old button, "← All households" —
  // hands you straight there instead of showing a second, slightly different
  // copy of the same book. Returns false only if Contacts is switched off,
  // in which case listHtml() below is still the fallback.
  function toHouseholdList() {
    const ctm = RWG.modules.get('contacts');
    if (!ctm || ctm.enabled === false) return false;
    ctm.state.scope = 'households';
    st.currentId = null;
    RWG.app.nav('contacts');
    return true;
  }
  const hasContactsList = () => { const m = RWG.modules.get('contacts'); return !!m && m.enabled !== false; };

  // ── modals ─────────────────────────────────────────────────
  const mount = () => document.getElementById('modal-mount');
  function modal(title, sub, bodyHtml, footHtml) {
    mount().innerHTML = `
      <div class="scrim" data-action="close-modal"></div>
      <div class="modal-card">
        <div class="modal-head"><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div>
        <div class="modal-body">${bodyHtml}</div>
        <div class="modal-foot">${footHtml}</div>
      </div>`;
  }
  const g = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };

  function newHouseholdModal() {
    const me = RWG.auth.currentUser();
    modal('New household', 'The account a client family lives under.', `
      <div class="field-group"><label class="lbl">Household name</label>
        <input id="hh-name" placeholder="e.g. Delgado Household"></div>
      <div class="field-row">
        <div class="field-group"><label class="lbl">Advisor</label>
          <select id="hh-advisor">${advisorOptions(me.id)}</select></div>
        <div class="field-group"><label class="lbl">Source</label>
          <input id="hh-source" placeholder="e.g. FRS Seminar, Referral"></div>
      </div>`,
      `<button class="btn btn-ghost" data-action="close-modal">Cancel</button>
       <button class="btn btn-gold" data-action="hh-save-new">Create household</button>`);
    const inp = document.getElementById('hh-name'); if (inp) inp.focus();
  }

  function editHouseholdModal(h) {
    modal('Edit household', '', `
      <div class="field-group"><label class="lbl">Household name</label>
        <input id="hh-name" value="${esc(h.name)}"></div>
      <div class="field-row">
        <div class="field-group"><label class="lbl">Advisor</label>
          <select id="hh-advisor">${advisorOptions(h.advisorUid)}</select></div>
        <div class="field-group"><label class="lbl">Source</label>
          <input id="hh-source" value="${esc(h.source || '')}"></div>
      </div>`,
      `<button class="btn btn-ghost" data-action="close-modal">Cancel</button>
       <button class="btn btn-gold" data-action="hh-save-edit" data-id="${esc(h.id)}">Save</button>`);
  }

  // One form for add + edit person. FRS block collapsed into two rows —
  // same fields the lead drawer knows, so a converted person looks familiar.
  // hhId null means the caller (the Contacts page) has no household in hand,
  // so the form grows a picker that can also create one on the spot.
  function personModal(hhId, c) {
    const v = (k) => c && c[k] != null ? c[k] : '';
    const relOpts = H().RELATIONSHIPS.map(r =>
      `<option ${c && c.relationship === r ? 'selected' : ''}>${r}</option>`).join('');
    const planOpts = ['', ...D().PLAN_TYPES].map(p =>
      `<option value="${esc(p)}" ${c && c.planType === p ? 'selected' : ''}>${esc(p || '—')}</option>`).join('');

    const needsHh = !hhId;
    const hhOpts = H().households().slice().sort((a, b) => a.name.localeCompare(b.name))
      .map(h => `<option value="${esc(h.id)}">${esc(h.name)}</option>`).join('');
    const hhBlock = needsHh ? `
      <div class="field-row">
        <div class="field-group"><label class="lbl">Household</label>
          <select id="p-hh"><option value="">＋ Start a new household…</option>${hhOpts}</select></div>
        <div class="field-group" id="p-hhnew-wrap"><label class="lbl">New household name</label>
          <input id="p-hhnew" placeholder="e.g. Delgado Household"></div>
      </div>` : '';

    // Tags in use, so nobody invents "FRS" next to "frs".
    const inUse = H().allTags().slice(0, 14);
    const tagChips = inUse.length
      ? `<div class="checkrow" style="margin-top:7px">${inUse.map(t =>
          `<button type="button" class="chip" data-tagadd="${esc(t.tag)}"
             style="cursor:pointer;background:rgba(14,36,64,.05);color:var(--navy);border:1px solid var(--line);font-weight:600">${esc(t.tag)}</button>`).join('')}</div>`
      : '';

    modal(c ? 'Edit person' : 'Add a person',
      c ? '' : (needsHh ? 'Everyone belongs to a household — pick one or start a new one.' : 'Spouses, children, anyone who belongs to this family.'), `
      <div class="field-row">
        <div class="field-group"><label class="lbl">First name</label><input id="p-first" value="${esc(v('firstName'))}"></div>
        <div class="field-group"><label class="lbl">Last name</label><input id="p-last" value="${esc(v('lastName'))}"></div>
      </div>
      ${hhBlock}
      <div class="field-row">
        <div class="field-group"><label class="lbl">Relationship</label><select id="p-rel">${relOpts}</select></div>
        <div class="field-group"><label class="lbl">Date of birth</label><input id="p-dob" type="date" value="${esc(v('dob'))}"></div>
      </div>
      <div class="field-row">
        <div class="field-group"><label class="lbl">Phone</label><input id="p-phone" type="tel" value="${esc(v('phone'))}"></div>
        <div class="field-group"><label class="lbl">Email</label><input id="p-email" type="email" value="${esc(v('email'))}"></div>
      </div>
      <div class="field-group"><label class="lbl">Tags</label>
        <input id="p-tags" value="${esc((v('tags') || []).join(', '))}" placeholder="Client, FRS, March review">
        <div class="hint">Separate with commas. Click one below to add it.</div>
        ${tagChips}</div>
      <div class="section-title">FRS profile <span class="pill-soft" style="font-size:11px">optional</span></div>
      <div class="field-row">
        <div class="field-group"><label class="lbl">Employer</label><input id="p-employer" value="${esc(v('employer'))}"></div>
        <div class="field-group"><label class="lbl">Plan type</label><select id="p-plan">${planOpts}</select></div>
      </div>
      <div class="field-row">
        <div class="field-group"><label class="lbl">Years of service</label><input id="p-yos" type="number" value="${esc(v('yos'))}"></div>
        <div class="field-group"><label class="lbl">AFC / Salary</label><input id="p-afc" type="number" value="${esc(v('afc'))}"></div>
      </div>
      <div id="p-dup" class="hint" style="color:var(--warn)"></div>`,
      `<button class="btn btn-ghost" data-action="close-modal">Cancel</button>
       <button class="btn btn-gold" data-action="hh-person-save" ${hhId ? `data-hh="${esc(hhId)}"` : ''} ${c ? `data-id="${esc(c.id)}"` : ''}>${c ? 'Save' : 'Add person'}</button>`);

    // Direct wiring: this modal opens over the Contacts view too, and the
    // kernel only routes onInput/onChange to the module that owns the
    // current view. Listeners on the elements always fire.
    const card = mount().querySelector('.modal-card');
    if (card) {
      card.addEventListener('click', (e) => {
        const b = e.target.closest ? e.target.closest('[data-tagadd]') : null;
        if (!b) return;
        e.preventDefault();
        const box = document.getElementById('p-tags');
        if (!box) return;
        const next = H().parseTags(box.value + ',' + b.dataset.tagadd);
        box.value = next.join(', ');
        box.focus();
      });
    }
    const hhSel = document.getElementById('p-hh');
    if (hhSel) {
      const sync = () => {
        const wrap = document.getElementById('p-hhnew-wrap');
        if (wrap) wrap.style.display = hhSel.value ? 'none' : '';
      };
      hhSel.addEventListener('change', sync);
      sync();
    }
    const first = document.getElementById('p-first'); if (first && !c) first.focus();
  }

  function linkModal(hhId) {
    const others = H().households().filter(x => x.id !== hhId)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!others.length) { U().toast('No other households to link yet'); return; }
    const opts = others.map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('');
    const kinds = H().LINK_KINDS.map(k => `<option value="${k.id}">${k.label}</option>`).join('');
    modal('Connect households', 'Family ties and referrals, made durable.', `
      <div class="field-group"><label class="lbl">This household…</label><select id="lk-kind">${kinds}</select></div>
      <div class="field-group"><label class="lbl">…the household</label><select id="lk-other">${opts}</select></div>
      <div class="field-group"><label class="lbl">Note (optional)</label><input id="lk-note" placeholder="e.g. Ana referred them, Jun 2026"></div>`,
      `<button class="btn btn-ghost" data-action="close-modal">Cancel</button>
       <button class="btn btn-gold" data-action="hh-link-save" data-id="${esc(hhId)}">Connect</button>`);
  }

  // ── the conversion flow ───────────────────────────────────
  // Step 1 (optional): pick an eligible lead. Step 2: confirm the household.
  function eligibleLeads() {
    return D().leads().filter(l =>
      !l.householdId && ['Appointment Kept', 'Opportunity Opened'].indexOf(l.stage) >= 0);
  }

  function convertPickerModal() {
    const rows = eligibleLeads()
      .filter(l => !st.convertQ || D().fullName(l).toLowerCase().indexOf(st.convertQ.toLowerCase()) >= 0)
      .sort((a, b) => D().fullName(a).localeCompare(D().fullName(b)));
    const list = rows.length ? rows.map(l => `
      <button class="btn btn-ghost" style="display:flex;width:100%;justify-content:flex-start;gap:10px;margin-bottom:8px;text-align:left"
        data-action="hh-convert" data-id="${esc(l.id)}">
        <span style="font-weight:700">${esc(D().fullName(l))}</span>
        <span class="cell-sub">${esc(l.employer || '')}</span>
        <span class="topbar-spacer"></span>${U().stageChip(l.stage)}
      </button>`).join('')
      : `<p class="muted" style="font-size:13.5px">No leads at Appointment Kept or Opportunity Opened are waiting to convert.</p>`;
    modal('Convert a lead', 'A kept appointment becomes a client family.', `
      <div class="field-group"><input id="hh-convert-q" placeholder="Search by name…" value="${esc(st.convertQ)}"></div>
      <div style="max-height:320px;overflow:auto">${list}</div>`,
      `<button class="btn btn-ghost" data-action="close-modal">Cancel</button>`);
  }

  function convertFormModal(leadId) {
    const l = D().lead(leadId);
    if (!l) { U().toast('Lead not found'); return; }
    if (l.householdId) { U().toast('Already converted'); return; }
    const suggested = (`${l.lastName || l.firstName || 'New'} Household`).trim();
    const existing = H().households().slice().sort((a, b) => a.name.localeCompare(b.name))
      .map(h => `<option value="${esc(h.id)}">${esc(h.name)}</option>`).join('');
    modal('Convert to household', `${esc(D().fullName(l))} keeps every call, note and score — nothing is retyped.`, `
      <div class="field-group"><label class="lbl">Create new household</label>
        <input id="cv-name" value="${esc(suggested)}"></div>
      <div class="field-row">
        <div class="field-group"><label class="lbl">Advisor</label>
          <select id="cv-advisor">${advisorOptions(l.assignedTo || RWG.auth.currentUser().id)}</select></div>
        <div class="field-group"><label class="lbl">Source</label>
          <input id="cv-source" value="${esc(l.listName || l.source || '')}"></div>
      </div>
      ${existing ? `
      <div class="section-title">or join an existing household</div>
      <div class="field-group">
        <select id="cv-existing"><option value="">— No, create the new one above —</option>${existing}</select>
        <div class="hint">Use this when the spouse is already a client.</div>
      </div>
      <div class="field-group" id="cv-rel-wrap" hidden><label class="lbl">Relationship to that household</label>
        <select id="cv-rel">${H().RELATIONSHIPS.map(r => `<option ${r === 'Spouse' ? 'selected' : ''}>${r}</option>`).join('')}</select></div>` : ''}
      <p class="hint" style="margin-top:8px">Converting also marks the lead <b>Opportunity Opened</b> — the same hand-off as today, plus the client record.</p>`,
      `<button class="btn btn-ghost" data-action="close-modal">Cancel</button>
       <button class="btn btn-gold" data-action="hh-convert-save" data-id="${esc(l.id)}">Convert ${U().icon('spark','ic-inline')}</button>`);
    // Wired directly: the kernel only routes change events to the module that
    // owns the CURRENT VIEW, and this modal can open from a Leads view (the drawer).
    const sel = document.getElementById('cv-existing');
    if (sel) sel.addEventListener('change', () => {
      const wrap = document.getElementById('cv-rel-wrap');
      if (wrap) wrap.hidden = !sel.value;
    });
  }

  function doConvert(leadId) {
    const l = D().lead(leadId); if (!l) return;
    const existingId = g('cv-existing');
    const advisorUid = g('cv-advisor');
    const opts = existingId
      ? { householdId: existingId, relationship: g('cv-rel') || 'Spouse' }
      : { name: g('cv-name').trim() || undefined, advisorUid: advisorUid || undefined,
          advisorName: userName(advisorUid), source: g('cv-source') };
    H().convertLead(leadId, opts).then(res => {
      mount().innerHTML = '';
      // close the lead drawer if it was underneath
      RWG.app.state.leadId = null;
      const dm = document.getElementById('drawer-mount'); if (dm) dm.innerHTML = '';
      st.currentId = res.householdId;
      RWG.app.nav('household');
      U().toast('Converted — welcome to the book', true);
    }).catch(err => U().toast('Could not convert: ' + err.message));
  }

  // ── pieces of the two views ───────────────────────────────
  const fmtDob = (dob) => {
    if (!dob) return '—';
    const [y, m, d] = dob.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  function listRows() {
    const q = st.q.trim().toLowerCase();
    let rows = H().households();
    if (q) {
      rows = rows.filter(h =>
        h.name.toLowerCase().indexOf(q) >= 0 ||
        H().contactsFor(h.id).some(c => H().contactName(c).toLowerCase().indexOf(q) >= 0));
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  function listHtml(user, ctx) {
    const rows = listRows();
    const total = H().households().length;
    // The one-time grouping pass: offered while any case still lacks a
    // household, gone the day the last one is attached.
    const sd = RWG.scorecardData;
    const unattached = (ctx.isAdmin && sd && sd.isStarted())
      ? sd.cases().filter(c => !c.householdId).length : 0;
    const body = rows.length ? rows.map(h => {
      const people = H().contactsFor(h.id);
      const prim = H().primaryContact(h.id);
      return `<tr class="cs-row" data-action="hh-open" data-id="${esc(h.id)}">
        <td><div class="cell-name">${esc(h.name)}</div><div class="cell-sub">${esc(h.source || '')}</div></td>
        <td>${prim
          ? `<button class="btn-link" data-action="ct-open" data-id="${esc(prim.id)}"
               title="Open ${esc(H().contactName(prim))}">${esc(H().contactName(prim))}</button>`
          : '<span class="muted">—</span>'}</td>
        <td class="num">${people.length}</td>
        <td>${h.advisorName ? esc(h.advisorName) : (h.advisorUid ? esc(userName(h.advisorUid)) : '<span class="muted">—</span>')}</td>
        <td>${h.a360Complete ? '<span class="chip tier-high">A360 ✓</span>' : '<span class="pill-soft">A360 pending</span>'}</td>
        <td><span class="cell-sub">${U().fmtRelative(h.createdAt)}</span></td>
      </tr>`;
    }).join('') : '';

    const empty = `<div class="empty" style="padding:48px 16px"><div class="ec">${U().icon('household','ic-lg')}</div>
      <h3>${total ? 'No households match' : 'The book starts here'}</h3>
      <p>${total ? 'Adjust the search.' : 'Convert a lead whose appointment was kept, or create a household by hand.'}</p></div>`;

    return `<div class="card">
      <div class="card-head"><h3>Households</h3><span class="sub">${rows.length}${total !== rows.length ? ' of ' + total : ''}</span>
        <span class="topbar-spacer"></span>
        ${unattached ? `<button class="btn btn-navy btn-sm" data-action="nav" data-view="grouping" title="One-time pass: attach every existing case to a household">⚡ Group existing cases · ${unattached}</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-action="hh-convert-pick">Convert a lead ${U().icon('spark','ic-inline')}</button>
        <button class="btn btn-gold btn-sm" data-action="hh-new">＋ New household</button>
      </div>
      <div class="filterbar" style="flex-direction:row;align-items:center">
        <input id="hh-q" class="input" type="search" placeholder="Search household or person…" value="${esc(st.q)}" style="max-width:340px">
      </div>
      ${rows.length
        ? `<div class="table-wrap"><table class="data cs-table">
             <thead><tr><th>Household</th><th>Primary contact</th><th class="num">People</th><th>Advisor</th><th>A360</th><th>Created</th></tr></thead>
             <tbody id="hh-body">${body}</tbody></table></div>`
        : empty}
    </div>`;
  }

  /* ── The household, as a side panel ────────────────────────
     Read-only, on purpose. From a contact record the family is context,
     not the thing you came to work on — you want to see who else is in
     it and what is running, then carry on reading the person. Every row
     is a way further in; nothing here edits, so nothing here can go
     stale under you while it sits open. */
  function panelHtml(h, ctx) {
    const people = H().contactsFor(h.id).slice().sort((a, b) =>
      (a.relationship === 'Primary client' ? 0 : 1) - (b.relationship === 'Primary client' ? 0 : 1)
      || H().contactName(a).localeCompare(H().contactName(b)));
    const sd = RWG.scorecardData, sc = RWG.scorecard;
    const cases = (sd && sd.isStarted())
      ? sd.cases().filter(x => x.householdId === h.id)
          .sort((a, b) => String(b.openedWeek || '').localeCompare(String(a.openedWeek || '')))
      : [];
    const adv = h.advisorName || (h.advisorUid ? userName(h.advisorUid) : '');
    const ids = {}; people.forEach(p => { ids[p.id] = 1; });
    const bdays = H().upcomingBirthdays(60).filter(b => ids[b.contact.id]);

    const line = (label, value) => `<div class="list-row mid"><span class="grow">
        <span class="cell-sub" style="display:block">${esc(label)}</span>
        <span style="font-size:var(--fs-dense);color:var(--ink)">${value}</span></span></div>`;
    const block = (title, count, body) => `<div class="section-title">${esc(title)}${
      count != null ? ` <span class="muted" style="font-weight:400">${count}</span>` : ''}</div>${body}`;

    const peopleRows = people.length ? people.map(c => `<div class="list-row mid">
        ${U().avatar({ name: H().contactName(c) }, 30)}
        <span class="grow" style="min-width:0">
          <span style="font-size:var(--fs-dense);color:var(--navy);font-weight:600;cursor:pointer"
            data-action="ct-open" data-id="${esc(c.id)}">${esc(H().contactName(c) || '(no name)')}</span>
          <span class="cell-sub" style="display:block">${esc([c.relationship, c.employer].filter(Boolean).join(' · ') || '—')}</span>
        </span></div>`).join('')
      : '<p class="list-empty">Nobody on this household yet.</p>';

    const caseRows = cases.length ? cases.map(x => `<div class="list-row mid"
        style="cursor:pointer" data-action="cs-open" data-id="${esc(x.recordId)}">
        <span class="grow" style="min-width:0">
          <span style="font-size:var(--fs-dense);color:var(--navy);font-weight:600">${esc(x.title || (sc ? sc.productName(x.product) : ''))}</span>
          <span class="cell-sub" style="display:block">${esc(sc ? sc.productName(x.product) : '')}${x.closedAt ? ' · closed' : (x.state ? ' · ' + esc(x.state) : '')}</span>
        </span></div>`).join('')
      : '<p class="list-empty">Nothing open for this family.</p>';

    const dateRows = bdays.length ? bdays.map(b => `<div class="list-row mid">
        <span class="grow"><span style="font-size:var(--fs-dense);color:var(--ink)">${esc(H().contactName(b.contact))} turns ${b.turning}</span>
        <span class="cell-sub" style="display:block">${esc(b.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }))}</span></span>
        <span class="end cell-sub">${b.inDays === 0 ? 'today' : 'in ' + b.inDays + 'd'}</span></div>`).join('') : '';

    return `
      <div class="scrim" data-action="close-drawer"></div>
      <aside class="drawer" role="dialog" aria-label="${esc(h.name)}">
        <div class="drawer-head">
          <div class="dh-top">
            <div style="min-width:0">
              <div class="tag-row mb-8"><span class="chip tier-low">${U().icon('household', 'ic-inline')} Household</span></div>
              <h2>${esc(h.name)}</h2>
              <div class="dh-sub">${esc([adv ? 'Advised by ' + adv : '', h.source || ''].filter(Boolean).join(' · ') || 'No advisor set')}</div>
            </div>
            <div class="flex" style="gap:8px;flex:none">
              <button class="drawer-edit" data-action="hh-goto" data-id="${esc(h.id)}"
                title="Open the full household page">Open →</button>
              <button class="drawer-close" data-action="close-drawer" aria-label="Close">✕</button>
            </div>
          </div>
        </div>
        <div class="drawer-body">
          ${block('People', people.length, peopleRows)}
          ${block('Opportunities', cases.length, caseRows)}
          ${dateRows ? block('Key dates', null, dateRows) : ''}
          ${block('Details', null,
            line('Advisor', esc(adv || '—'))
            + line('Source', esc(h.source || '—'))
            + line('A360', h.a360Complete
              ? '<span class="chip tier-high">Complete ✓</span>'
              : '<span class="pill-soft">Pending</span>')
            + line('In the book since', h.createdAt ? U().fmtDate(h.createdAt) : '—'))}
          ${h.notes ? block('Notes', null, `<div class="hm-note-body" style="padding:var(--pad-cell)">${U().noteHtml(h.notes)}</div>`) : ''}
        </div>
      </aside>`;
  }

  function detailHtml(h, user, ctx) {
    const people = H().contactsFor(h.id).slice().sort((a, b) =>
      (a.relationship === 'Primary client' ? 0 : 1) - (b.relationship === 'Primary client' ? 0 : 1)
      || H().contactName(a).localeCompare(H().contactName(b)));
    const isAdmin = ctx.isAdmin;

    // The whole row opens the person's record — the same destination a click
    // reaches from anywhere else in the app. Editing is a button, not the
    // default: you look someone up far more often than you correct them.
    // Everything inside the row that does its own thing carries its own
    // action, and the kernel dispatches to the innermost match.
    const peopleRows = people.map(c => `
      <tr class="cs-row" data-action="ct-open" data-id="${esc(c.id)}">
        <td><div class="cell-name">${esc(H().contactName(c) || '(no name)')}</div>
            <div class="cell-sub">${esc(c.employer || '')}</div></td>
        <td>${esc(c.relationship || '—')}</td>
        <td>${fmtDob(c.dob)}${!c.dob && c.age != null ? ` <span class="cell-sub">(age ${c.age})</span>` : ''}</td>
        <td><div class="cell-sub" style="color:var(--ink)">${esc(c.phone || '—')}</div><div class="cell-sub">${esc(c.email || '')}</div></td>
        <td>${c.email
          ? `<button class="chip ${c.advisorstream ? 'tier-high' : 'tier-low'}" style="cursor:pointer;border-width:1px" title="Toggle: is this person on the AdvisorStream newsletter list?"
               data-action="hh-as-toggle" data-id="${esc(c.id)}">${c.advisorstream ? 'On list ✓' : 'Not on list'}</button>`
          : '<span class="pill-soft">no email</span>'}</td>
        <td style="white-space:nowrap">
          ${c.leadId && D().lead(c.leadId) ? `<button class="btn btn-quiet btn-sm" data-action="open-lead" data-id="${esc(c.leadId)}" title="The lead record this person came from — full call history">History</button>` : ''}
          <button class="btn btn-quiet btn-sm" data-action="kd-add" data-contact="${esc(c.id)}" title="Add a key date for this person">⭐ Date</button>
          <button class="btn btn-quiet btn-sm" data-action="hh-person-edit" data-id="${esc(c.id)}">Edit</button>
          ${isAdmin ? `<button class="btn btn-quiet btn-sm" data-action="hh-person-remove" data-id="${esc(c.id)}" title="Remove this person (admin)">✕</button>` : ''}
        </td>
      </tr>`).join('');

    // key dates: birthdays in the next 60 days for THIS household
    const ids = {}; people.forEach(p => ids[p.id] = 1);
    const bdays = H().upcomingBirthdays(60).filter(b => ids[b.contact.id]);
    const bdayRows = bdays.length ? bdays.map(b => `
      <div class="tl-item"><div class="tl-ic">🎂</div><div class="tl-body">
        <div class="tl-h">${esc(H().contactName(b.contact))} turns <b>${b.turning}</b></div>
        <div class="tl-meta">${b.inDays === 0 ? 'today' : 'in ' + b.inDays + ' day' + (b.inDays === 1 ? '' : 's')} · ${b.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</div>
      </div></div>`).join('')
      : `<p class="muted" style="font-size:13px">No birthdays in the next 60 days${people.some(p => !p.dob) ? ' — add dates of birth to power the reminders' : ''}.</p>`;

    // Key dates belong to a person; anything still filed against the
    // household is shown as such, with a nudge to say whose it is.
    const kdRows = people.map(c => (c.keyDates || []).map(k => `
      <div class="tl-item"><div class="tl-ic">⭐</div><div class="tl-body">
        <div class="tl-h">${esc(k.label || 'Key date')} <span class="cell-sub">· ${esc(H().contactName(c))}</span></div>
        <div class="tl-meta">${esc(fmtDob(k.date))}${k.repeat === 'yearly' ? ' · every year' : ''}${k.note ? ' · ' + esc(k.note) : ''}
          <button class="btn btn-quiet btn-sm" data-action="kd-del" data-contact="${esc(c.id)}" data-kd="${esc(k.id)}" style="margin-left:6px">remove</button></div>
      </div></div>`).join('')).join('')
      + (h.keyDates || []).map(k => `
      <div class="tl-item"><div class="tl-ic">⭐</div><div class="tl-body">
        <div class="tl-h">${esc(k.label || 'Key date')}</div>
        <div class="tl-meta">${esc(fmtDob(k.date))}${k.note ? ' · ' + esc(k.note) : ''}
          <button class="chip tier-medium" style="font-size:10.5px;cursor:pointer;margin-left:6px"
            data-action="kd-move" data-hh="${esc(h.id)}" data-kd="${esc(k.id)}"
            title="Key dates belong to a person now — click to say whose">on the household · assign →</button></div>
      </div></div>`).join('');

    const links = (h.links || []).map(l => {
      const other = H().household(l.householdId);
      if (!other) return '';
      return `<div class="tl-item"><div class="tl-ic">🔗</div><div class="tl-body">
        <div class="tl-h"><a href="#" data-action="hh-open" data-id="${esc(other.id)}" style="color:var(--navy)">${esc(other.name)}</a></div>
        <div class="tl-meta">${esc(H().linkLabel(l.kind))}${l.note ? ' · ' + esc(l.note) : ''}
          <button class="btn btn-quiet btn-sm" data-action="hh-unlink" data-id="${esc(other.id)}" style="margin-left:6px">unlink</button></div>
      </div></div>`;
    }).join('');

    const a360 = h.a360Complete
      ? `<button class="chip tier-high" style="cursor:pointer" data-action="hh-a360-toggle" data-id="${esc(h.id)}"
           title="Checked by ${esc(h.a360Complete.byName || '')} · ${U().fmtDate(h.a360Complete.at)}">A360 profile complete ✓</button>`
      : `<button class="chip tier-medium" style="cursor:pointer" data-action="hh-a360-toggle" data-id="${esc(h.id)}"
           title="Click once the full profile is entered in A360">A360 profile pending</button>`;

    return `
      <button class="btn btn-quiet btn-sm" data-action="hh-back" style="margin-bottom:14px">← All households</button>

      <div class="card" style="margin-bottom:18px">
        <div class="card-head" style="align-items:flex-start">
          <div>
            <h3 style="font-size:24px">${esc(h.name)}</h3>
            <div class="tag-row" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:8px">
              <span class="pill-soft">Advisor: ${esc(h.advisorName || userName(h.advisorUid) || '—')}</span>
              ${h.source ? `<span class="pill-soft">Source: ${esc(h.source)}</span>` : ''}
              <span class="pill-soft">Client since ${U().fmtDate(h.createdAt)}</span>
              ${a360}
            </div>
          </div>
          <span class="topbar-spacer"></span>
          <div class="flex" style="gap:8px;flex-wrap:wrap">
            <button class="btn btn-ghost btn-sm" data-action="hh-link" data-id="${esc(h.id)}">🔗 Connect</button>
            <button class="btn btn-ghost btn-sm" data-action="hh-edit" data-id="${esc(h.id)}">✎ Edit</button>
            <button class="btn btn-ghost btn-sm" data-action="hh-person-add" data-id="${esc(h.id)}">＋ Person</button>
            <button class="btn btn-ghost btn-sm" data-action="tk-new" data-hh="${esc(h.id)}">＋ Task</button>
            <button class="btn btn-ghost btn-sm" data-action="wf-launch" data-hh="${esc(h.id)}">▶ Workflow</button>
            <button class="btn btn-ghost btn-sm" data-action="sv-new" data-hh="${esc(h.id)}">${U().icon('service','ic-inline')} Service</button>
            <button class="btn btn-gold btn-sm" data-action="cs-new" data-hh="${esc(h.id)}">＋ Opportunity</button>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:18px">
        <div class="card-head"><h3>People</h3><span class="sub">${people.length}</span></div>
        ${people.length
          ? `<div class="table-wrap"><table class="data">
              <thead><tr><th>Name</th><th>Relationship</th><th>Born</th><th>Contact</th><th>AdvisorStream</th><th></th></tr></thead>
              <tbody>${peopleRows}</tbody></table></div>`
          : `<p class="muted" style="font-size:13.5px;padding:6px 2px">Nobody here yet — add the family.</p>`}
      </div>

      <div class="grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start">
        <div class="card">
          <div class="card-head"><h3>Key dates</h3><span class="sub">next 60 days</span>
            <span class="topbar-spacer"></span>
            <button class="btn btn-ghost btn-sm" data-action="kd-add" data-hh="${esc(h.id)}">＋ Key date</button></div>
          ${bdayRows}
          ${kdRows}
        </div>
        <div class="card">
          <div class="card-head"><h3>Connected to</h3><span class="sub">${(h.links || []).length}</span></div>
          ${links || '<p class="muted" style="font-size:13px">No connections recorded. Referrals and family ties go here so they outlive anyone’s memory.</p>'}
        </div>
      </div>

      ${openTasksCard(h)}

      ${workflowsCard(h)}

      <div class="card" style="margin-top:18px">
        <div class="card-head"><h3>Notes</h3></div>
        ${U().noteEditor({ id: 'hh-notes', value: h.notes || '',
          placeholder: 'Anything the whole team should know about this family…' })}
        <div class="flex" style="justify-content:flex-end;margin-top:10px">
          <button class="btn btn-navy btn-sm" data-action="hh-notes-save" data-id="${esc(h.id)}">Save notes</button>
        </div>
      </div>

      ${opportunitiesCard(h)}

      ${isAdmin && !people.length ? `
      <div style="margin-top:18px">
        <button class="btn btn-danger btn-sm" data-action="hh-delete" data-id="${esc(h.id)}">🗑 Delete this empty household</button>
      </div>` : ''}`;
  }

  // ── open tasks on the household (phase 3) ─────────────────
  // The checkbox and the row edit route to the My Work module's global
  // actions (tk-done / tk-edit) — one task engine, many doors.
  function openTasksCard(h) {
    const T = RWG.tasks;
    if (!T || !T.isStarted()) return '';
    // Everything owed on this family, whether the task points at the household
    // itself or at one of their cases. A workflow step for the Vargas policy
    // belongs on the Vargas screen — it used to appear only in whichever
    // person's list it was assigned to, which is not where you go looking.
    const open = T.open().filter(t =>
      (t.relatedType === 'household' && t.relatedId === h.id) || t.householdId === h.id)
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
    if (!open.length) return '';
    const today = T.todayKey();
    return `<div class="card" style="margin-top:18px">
      <div class="card-head"><h3>Open tasks</h3><span class="sub">${open.length}</span>
        <span class="topbar-spacer"></span>
        <button class="btn btn-ghost btn-sm" data-action="tk-new" data-hh="${esc(h.id)}">＋ Task</button></div>
      ${open.map(t => `<div class="flex" style="align-items:flex-start;gap:11px;padding:9px 2px;border-bottom:1px solid rgba(14,36,64,.06)">
        <input type="checkbox" data-action="tk-done" data-id="${esc(t.id)}" style="margin-top:2px">
        <span style="min-width:0;flex:1;font-size:13.5px;color:var(--ink)"><span data-action="tk-edit" data-id="${esc(t.id)}" style="cursor:pointer">${esc(t.title)}</span>
          <span class="pill-soft" style="font-size:11px;margin-left:6px">${esc((t.assigneeName || '').split(' ')[0])}</span></span>
        <span style="flex:none;font-size:12px;${t.dueDate && t.dueDate < today ? 'color:var(--bad);font-weight:700' : 'color:var(--muted)'}">${t.dueDate && t.dueDate < today ? 'late' : (t.dueDate === today ? 'today' : esc(t.dueDate || ''))}</span>
      </div>`).join('')}
    </div>`;
  }

  // ── workflows on the household (phase 4) ──────────────────
  // Each launch is a checklist: progress, and the next open step.
  // The steps themselves are ordinary tasks — check them off on My
  // Work or in the Open tasks card; this card is the overview.
  function workflowsCard(h) {
    const W = RWG.wf, T = RWG.tasks, SD = RWG.scorecardData;
    if (!W || !T || !T.isStarted()) return '';
    const caseIds = SD.isStarted() ? SD.cases().filter(c => c.householdId === h.id).map(c => c.recordId) : [];
    const list = W.instancesFor(h.id, caseIds);
    if (!list.length) return '';
    const today = T.todayKey();
    const rows = list.map(w => {
      const doneAll = w.done >= w.total;
      const pct = Math.round(100 * w.done / w.total);
      const late = w.next && w.next.dueDate && w.next.dueDate < today;
      return `<div style="padding:11px 2px;border-bottom:1px solid rgba(14,36,64,.06)">
        <div class="flex" style="gap:8px;align-items:center">
          <b style="font-size:13.5px;color:var(--navy)">${esc(w.name)}</b>
          <span class="cell-sub" style="font-size:11.5px">${esc(w.label)}</span>
          <span class="topbar-spacer"></span>
          <span class="cell-sub" style="font-weight:700;${doneAll ? 'color:var(--good)' : ''}">${doneAll ? '✓ done' : w.done + ' / ' + w.total}</span>
        </div>
        <div style="height:5px;background:var(--field);border-radius:3px;margin-top:7px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${doneAll ? 'var(--good)' : 'var(--gold)'};border-radius:3px"></div>
        </div>
        ${w.next ? `<div class="flex" style="gap:8px;margin-top:7px;align-items:center">
          <span class="cell-sub" style="font-size:12px">Next: <span style="color:var(--ink)">${esc(w.next.title)}</span></span>
          <span class="pill-soft" style="font-size:11px">${esc((w.next.assigneeName || '').split(' ')[0])}</span>
          <span style="font-size:11.5px;${late ? 'color:var(--bad);font-weight:700' : 'color:var(--muted)'}">${late ? 'late' : esc(w.next.dueDate || '')}</span>
        </div>` : ''}
      </div>`;
    }).join('');
    return `<div class="card" style="margin-top:18px">
      <div class="card-head"><h3>Workflows</h3><span class="sub">${list.length}</span>
        <span class="topbar-spacer"></span>
        <button class="btn btn-ghost btn-sm" data-action="wf-launch" data-hh="${esc(h.id)}">▶ Workflow</button></div>
      ${rows}
    </div>`;
  }

  // ── opportunities on the household (phase 2) ──────────────
  function stageChip2(c) {
    const P = RWG.pipelines, SC = RWG.scorecard;
    const sid = P.stageForCase(c);
    const bucket = P.bucketOf(c.product, sid) || c.state;
    const cls = bucket === 'Closed' ? 'tier-high' : bucket === 'Submitted' ? 'tier-gold' : bucket === 'Lost' ? 'tier-low' : 'pill-soft';
    const label = sid === 'lost' && c.lostReason ? 'Lost · ' + c.lostReason.split(' — ')[0] : P.stageLabel(c.product, sid);
    return `<span class="chip ${cls === 'pill-soft' ? '' : cls}${cls === 'pill-soft' ? ' pill-soft' : ''}" style="font-size:11.5px">${esc(label)}</span>`;
  }

  function opportunitiesCard(h) {
    const SD = RWG.scorecardData, SC = RWG.scorecard;
    if (!SD || !SC || !SD.isStarted()) return '';
    const opps = SD.cases().filter(c => c.householdId === h.id)
      .sort((a, b) => String(b.openedWeek).localeCompare(String(a.openedWeek)));
    const open = opps.filter(c => c.state === 'Opened' || c.state === 'Submitted').length;
    const rows = opps.map(c => {
      const money = SC.usesAum(c.product) ? c.aum : c.amount;
      return `<tr class="cs-row" data-action="cs-open" data-id="${esc(c.recordId)}">
        <td><div class="cell-name">${esc(c.title || SC.productName(c.product) || c.product)}</div>
            <div class="cell-sub">${c.title ? esc(SC.productName(c.product)) + ' · ' : ''}${esc(SC.sourceLabel(c.source) || '')}</div></td>
        <td>${stageChip2(c)}</td>
        <td class="num">${U().money(money)}</td>
        <td class="num">${U().money(Math.round(SC.deriveCase(c).revenue))}</td>
        <td><span class="cell-sub">${esc((c.agentName || '').split(' ')[0])}${(c.coCreditNames || []).length ? ' +' + c.coCreditNames.length : ''}</span></td>
        <td><span class="cell-sub">${esc(c.openedWeek || '')}</span></td>
      </tr>`;
    }).join('');
    return `<div class="card" style="margin-top:18px">
      <div class="card-head"><h3>Opportunities</h3><span class="sub">${opps.length}${open ? ' · ' + open + ' open' : ''}</span>
        <span class="topbar-spacer"></span>
        <button class="btn btn-gold btn-sm" data-action="cs-new" data-hh="${esc(h.id)}">＋ Opportunity</button></div>
      ${opps.length
        ? `<div class="table-wrap"><table class="data">
            <thead><tr><th>Product</th><th>Stage</th><th class="num">Amount / AUM</th><th class="num">Revenue</th><th>Agent</th><th>Opened</th></tr></thead>
            <tbody>${rows}</tbody></table></div>`
        : `<p class="muted" style="font-size:13.5px;padding:6px 2px">Nothing yet — open the first opportunity for this family.</p>`}
    </div>`;
  }

  // live repaint of just the list body while typing
  function refreshList() {
    const c = document.getElementById('main-content');
    if (c && RWG.app.state.view === 'households') {
      const user = RWG.app.effectiveUser ? RWG.app.effectiveUser() : RWG.auth.currentUser();
      c.innerHTML = listHtml(user, { isAdmin: RWG.app.effectiveRole() === 'admin' });
      const q = document.getElementById('hh-q');
      if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
    }
  }

  // ── the module ────────────────────────────────────────────
  RWG.modules.register({
    id: 'households',
    title: 'Households',
    enabled: true,
    roles: ['admin', 'agent'],
    // No sidebar entry: households are a scope inside Contacts now. Both
    // views stay owned here, so the list still renders if you land on it
    // and the detail screen is unchanged.
    nav: [],
    views: ['households', 'household'],
    meta: {
      households: { t: 'Households', s: 'The book — every client family in one place' },
      household:  { t: 'Household',  s: 'People, dates, connections and history' }
    },
    state: st,

    home: {
      tile: () => ({
        icon: 'team', title: 'Households',
        desc: 'The client book: families, their people, and how they connect.',
        view: 'households'
      })
    },

    onEnter(view, ctx) {
      if (!H().isStarted()) H().init(RWG.auth.currentUser(), RWG.app.renderMain);
      // everyone: the household record shows its opportunities (and admins
      // get the grouping-button count from the same cache)
      if (RWG.scorecardData && !RWG.scorecardData.isStarted()) {
        RWG.scorecardData.init(RWG.auth.currentUser(), RWG.app.renderMain);
      }
      if (RWG.pipelines) RWG.pipelines.init();
      if (RWG.tasks && !RWG.tasks.isStarted()) RWG.tasks.init(RWG.auth.currentUser(), RWG.app.renderMain);
      if (RWG.wf) RWG.wf.init();   // the ▶ Workflow button launches from here

      // The list moved into Contacts; a household that no longer exists
      // (deleted elsewhere, stale link) goes to the same place rather than
      // silently showing the list under the wrong title.
      if (view === 'households') { toHouseholdList(); return; }
      if (view === 'household' && H().isStarted()
        && !(st.currentId && H().household(st.currentId))) toHouseholdList();
    },

    onInput(e) {
      if (e.target.id === 'hh-q') { st.q = e.target.value; refreshList(); }
      if (e.target.id === 'hh-convert-q') { st.convertQ = e.target.value; convertPickerModal(); const i = document.getElementById('hh-convert-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
      if (e.target.id === 'p-phone' || e.target.id === 'p-email') {
        const dup = H().findDupContact(g('p-phone'), g('p-email'), null);
        const el = document.getElementById('p-dup');
        if (el) el.textContent = dup ? `Heads up: ${H().contactName(dup)} already has this ${phoneMatches(dup) ? 'phone' : 'email'} — same person?` : '';
        function phoneMatches(d) { return String(d.phone || '').replace(/\D/g, '').slice(-10) === String(g('p-phone')).replace(/\D/g, '').slice(-10) && g('p-phone'); }
      }
    },


    actions: {
      // list
      'hh-new': () => newHouseholdModal(),
      'hh-save-new': () => {
        const name = g('hh-name').trim();
        if (!name) { U().toast('Give the household a name'); return; }
        const uid = g('hh-advisor');
        const h = H().addHousehold({ name, advisorUid: uid || null, advisorName: userName(uid), source: g('hh-source').trim() });
        mount().innerHTML = '';
        st.currentId = h.id;
        RWG.app.nav('household');
        U().toast('Household created', true);
      },
      'hh-open': (el, e) => {
        if (e && e.preventDefault) e.preventDefault();
        st.currentId = el.dataset.id;
        mount().innerHTML = '';
        RWG.app.nav('household');
      },
      'hh-back': () => { if (!toHouseholdList()) { st.currentId = null; RWG.app.nav('households'); } },

      // household head
      'hh-edit': (el) => { const h = H().household(el.dataset.id); if (h) editHouseholdModal(h); },
      'hh-save-edit': (el) => {
        const uid = g('hh-advisor');
        H().saveHousehold({ id: el.dataset.id, name: g('hh-name').trim() || '(unnamed)', advisorUid: uid || null, advisorName: userName(uid), source: g('hh-source').trim() });
        mount().innerHTML = '';
        RWG.app.renderMain();
        U().toast('Saved', true);
      },
      'hh-a360-toggle': (el) => {
        const h = H().household(el.dataset.id); if (!h) return;
        H().setA360(h.id, !h.a360Complete);
        RWG.app.renderMain();
      },
      'hh-notes-save': (el) => {
        H().saveHousehold({ id: el.dataset.id, notes: U().noteRead('hh-notes') });
        U().toast('Notes saved', true);
      },
      'hh-delete': (el) => {
        const h = H().household(el.dataset.id); if (!h) return;
        if (H().contactsFor(h.id).length) { U().toast('Move its people out first'); return; }
        if (!confirm(`Delete "${h.name}"? Admins only, and it cannot be undone.`)) return;
        H().deleteHousehold(h.id).then(() => {
          if (!toHouseholdList()) { st.currentId = null; RWG.app.nav('households'); }
          U().toast('Household deleted');
        });
      },

      // The family as context rather than a destination: raise it beside
      // what you are reading instead of navigating away from it.
      'hh-panel': (el) => {
        const h = H().household(el.dataset.id); if (!h) return;
        if (!RWG.app.openPanel) { RWG.app.nav('household'); return; }
        RWG.app.openPanel(panelHtml(h, { isAdmin: RWG.auth.isAdmin && RWG.auth.isAdmin() }));
      },

      // people
      'hh-person-add': (el) => personModal(el.dataset.id, null),
      'hh-person-edit': (el) => { const c = H().contact(el.dataset.id); if (c) personModal(c.householdId, c); },
      'hh-person-save': (el) => {
        const fields = {
          firstName: g('p-first').trim(), lastName: g('p-last').trim(),
          relationship: g('p-rel'), dob: g('p-dob'), phone: g('p-phone').trim(),
          email: g('p-email').trim(), employer: g('p-employer').trim(),
          planType: g('p-plan'), yos: g('p-yos'), afc: g('p-afc'),
          tags: H().parseTags(g('p-tags'))
        };
        if (!fields.firstName && !fields.lastName) { U().toast('A person needs a name'); return; }

        if (el.dataset.id) {
          H().saveContact(Object.assign({ id: el.dataset.id }, fields));
        } else {
          // Adding. The household comes from the caller, from the picker, or
          // gets created here — a person is never left without one.
          let hhId = el.dataset.hh || '';
          if (!hhId && document.getElementById('p-hh')) {
            hhId = g('p-hh');
            if (!hhId) {
              const name = (g('p-hhnew') || '').trim()
                || (fields.lastName ? fields.lastName + ' Household' : '');
              if (!name) { U().toast('Name the new household, or pick an existing one'); return; }
              const me = RWG.auth.currentUser();
              const h = H().addHousehold({ name: name, advisorUid: me.id, advisorName: me.name || '' });
              hhId = h.id;
              // First person into a brand-new household is the primary client.
              if (fields.relationship === 'Other') fields.relationship = 'Primary client';
            }
          }
          if (!hhId) { U().toast('Pick a household for this person'); return; }
          H().addContact(Object.assign({ householdId: hhId }, fields));
        }
        mount().innerHTML = '';
        RWG.app.renderMain();
        U().toast('Saved', true);
      },
      'hh-person-remove': (el) => {
        const c = H().contact(el.dataset.id); if (!c) return;
        if (!confirm(`Remove ${H().contactName(c)} from this household?`)) return;
        H().removeContact(c.id).then(() => RWG.app.renderMain());
      },
      'hh-as-toggle': (el) => {
        const c = H().contact(el.dataset.id); if (!c) return;
        H().setAdvisorstream(c.id, !c.advisorstream);
        RWG.app.renderMain();
      },

      // connections
      'hh-link': (el) => linkModal(el.dataset.id),
      'hh-link-save': (el) => {
        H().linkHouseholds(el.dataset.id, g('lk-other'), g('lk-kind'), g('lk-note').trim())
          .then(() => { mount().innerHTML = ''; RWG.app.renderMain(); U().toast('Connected', true); })
          .catch(err => U().toast(err.message));
      },
      'hh-unlink': (el) => {
        H().unlinkHouseholds(st.currentId, el.dataset.id).then(() => RWG.app.renderMain());
      },

      // conversion
      'hh-convert-pick': () => { st.convertQ = ''; convertPickerModal(); },
      'hh-convert': (el) => convertFormModal(el.dataset.id),
      'hh-convert-save': (el) => doConvert(el.dataset.id),
      'hh-goto': (el) => {
        st.currentId = el.dataset.id;
        RWG.app.state.leadId = null;
        const dm = document.getElementById('drawer-mount'); if (dm) dm.innerHTML = '';
        RWG.app.nav('household');
      }
    },

    render(view, user, ctx) {
      if (!H().isStarted()) return `<div class="empty" style="padding:60px"><div class="ec">⏳</div><h3>Loading the book…</h3></div>`;
      if (view === 'household') {
        const h = st.currentId && H().household(st.currentId);
        if (h) return detailHtml(h, user, ctx);
      }
      // onEnter (which runs next) redirects to Contacts, so this paints only
      // when Contacts is switched off and this really is the households list.
      return hasContactsList() ? '' : listHtml(user, ctx);
    }
  });
})();
