/* ============================================================
   RWG Platform — Contacts

   Households answer "which family is this?". This screen answers
   "where is that person?" — every human in the book, in one
   searchable list, sliced by tag, advisor or plain text.

   It owns no data. Contacts live on the household spine
   (households-data.js) and the person form lives with Households,
   so there is exactly one place a person is edited from. This
   module is a view over that, plus tags.

   Clicking a person opens that person. The household is one click
   further on, from the name in the Household column — a contacts
   list that answers "who is this?" with a page about their family
   is answering a question nobody asked.
   ============================================================ */
window.RWG = window.RWG || {};

(function () {
  const H = () => RWG.hh;
  const D = () => RWG.data;
  const U = () => RWG.ui;
  const esc = (s) => U().esc(s);

  // scope: people | households. Households used to be their own screen;
  // they are the same book seen at a different grain, so they are a scope
  // here rather than a separate place to remember to look.
  // `from` is the screen the record was opened from, so the back link goes
  // where you came from instead of always dumping you in the full list.
  const st = { q: '', sort: 'az', tag: '', advisor: '', rel: '', scope: 'people', currentId: null, tab: 'note', from: null };

  const hhOf = (c) => (c.householdId ? H().household(c.householdId) : null);
  function advisorOf(c) {
    const h = hhOf(c);
    if (!h) return null;
    if (h.advisorName) return h.advisorName;
    const u = h.advisorUid ? D().user(h.advisorUid) : null;
    return u ? u.name : null;
  }

  // ── the filtered, sorted set ──────────────────────────────
  function rows() {
    const q = st.q.trim().toLowerCase();
    let list = H().contacts();

    if (q) {
      list = list.filter(c => {
        const h = hhOf(c);
        return H().contactName(c).toLowerCase().indexOf(q) >= 0
          || String(c.email || '').toLowerCase().indexOf(q) >= 0
          || String(c.phone || '').replace(/\D/g, '').indexOf(q.replace(/\D/g, '')) >= 0 && /\d/.test(q)
          || String(c.employer || '').toLowerCase().indexOf(q) >= 0
          || (h && h.name.toLowerCase().indexOf(q) >= 0)
          || (c.tags || []).some(t => String(t).toLowerCase().indexOf(q) >= 0);
      });
    }
    if (st.tag) list = list.filter(c => H().hasTag(c, st.tag));
    if (st.rel) list = list.filter(c => (c.relationship || '') === st.rel);
    if (st.advisor) list = list.filter(c => { const h = hhOf(c); return h && h.advisorUid === st.advisor; });

    // A–Z means by surname — the way you actually look someone up in a book
    // of clients — falling back to the first name for a family.
    const name = (c) => `${c.lastName || ''} ${c.firstName || ''}`.trim().toLowerCase()
      || H().contactName(c).toLowerCase();
    const sorters = {
      az: (a, b) => name(a).localeCompare(name(b)),
      za: (a, b) => name(b).localeCompare(name(a)),
      recent: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
      created: (a, b) => (b.createdAt || 0) - (a.createdAt || 0)
    };
    return list.sort(sorters[st.sort] || sorters.az);
  }

  // ── cells ─────────────────────────────────────────────────
  const fmtPhone = (p) => {
    const d = String(p == null ? '' : p).replace(/\D/g, '');
    if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
    return p || '';
  };
  const dash = '<span class="muted">—</span>';

  function tagCells(c) {
    const tags = (c.tags || []).slice(0, 5);
    if (!tags.length) return dash;
    const more = (c.tags || []).length - tags.length;
    return `<div class="tagwrap">${tags.map(t =>
      `<button class="tag-chip" data-action="ct-tag" data-tag="${esc(t)}" title="Show everyone tagged ${esc(t)}">${esc(t)}</button>`).join('')}${
      more > 0 ? `<span class="cell-sub">+${more}</span>` : ''}</div>`;
  }

  // The whole row is the target. Anything inside it that does its own
  // thing — the Edit button, a tag chip, the household name, a phone or
  // email link — carries its own action (or is a link), and the kernel
  // dispatches to the innermost match, so those keep working.
  function row(c) {
    const h = hhOf(c);
    const nm = H().contactName(c) || '(no name)';
    const adv = advisorOf(c);
    return `<tr class="cs-row" data-action="ct-open" data-id="${esc(c.id)}">
      <td>
        <div class="ct-name">
          ${U().avatar({ name: nm })}
          <span style="min-width:0">
            <span class="cell-name" style="display:block">${esc(nm)}</span>
            <span class="cell-sub">${esc(c.title || c.employer || (h ? h.name : '') || '')}</span>
          </span>
        </div>
      </td>
      <td>${c.phone ? `<a href="tel:${esc(String(c.phone).replace(/[^\d+]/g, ''))}">${esc(fmtPhone(c.phone))}</a>
            <div class="cell-sub">${esc(c.relationship || '')}</div>` : dash}</td>
      <td>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : dash}</td>
      <td>${tagCells(c)}</td>
      <td>${h ? `<button class="btn-link" data-action="hh-open" data-id="${esc(h.id)}"
                   title="Open the ${esc(h.name)}">${esc(h.name)}</button>` : dash}
          ${adv ? `<div class="cell-sub" style="opacity:.75">${esc(adv)}</div>` : ''}</td>
      <td class="end"><button class="btn btn-quiet btn-sm" data-action="hh-person-edit" data-id="${esc(c.id)}">Edit</button></td>
    </tr>`;
  }

  // ── households, the same book at family grain ─────────────
  function householdRows() {
    const q = st.q.trim().toLowerCase();
    let list = H().households();
    if (q) {
      list = list.filter(h =>
        h.name.toLowerCase().indexOf(q) >= 0
        || String(h.source || '').toLowerCase().indexOf(q) >= 0
        || H().contactsFor(h.id).some(c => H().contactName(c).toLowerCase().indexOf(q) >= 0));
    }
    if (st.advisor) list = list.filter(h => h.advisorUid === st.advisor);
    if (st.tag) list = list.filter(h => H().contactsFor(h.id).some(c => H().hasTag(c, st.tag)));
    const sorters = {
      az: (a, b) => a.name.localeCompare(b.name),
      za: (a, b) => b.name.localeCompare(a.name),
      recent: (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0),
      created: (a, b) => (b.createdAt || 0) - (a.createdAt || 0)
    };
    return list.sort(sorters[st.sort] || sorters.az);
  }

  function householdRow(h) {
    const people = H().contactsFor(h.id);
    const prim = H().primaryContact(h.id);
    const sd = RWG.scorecardData;
    const opps = (sd && sd.isStarted()) ? sd.cases().filter(c => c.householdId === h.id).length : 0;
    const adv = h.advisorName || (h.advisorUid ? (D().user(h.advisorUid) || {}).name : '') || '';
    return `<tr class="cs-row" data-action="hh-open" data-id="${esc(h.id)}">
      <td>
        <div class="ct-name">
          <span class="hh-badge">${U().icon('household','ic-sm')}</span>
          <span style="min-width:0">
            <span class="cell-name" style="display:block">${esc(h.name)}</span>
            <span class="cell-sub">${esc(h.source || '')}</span>
          </span>
        </div>
      </td>
      <td>${prim
        ? `<button class="btn-link" data-action="ct-open" data-id="${esc(prim.id)}"
             title="Open ${esc(H().contactName(prim))}">${esc(H().contactName(prim))}</button>`
        : dash}</td>
      <td class="num">${people.length}</td>
      <td class="num">${opps || dash}</td>
      <td>${adv ? esc(adv) : dash}</td>
      <td>${h.a360Complete ? '<span class="chip tier-high">A360 ✓</span>' : '<span class="pill-soft">A360 pending</span>'}</td>
      <td class="end"><button class="btn btn-quiet btn-sm" data-action="hh-open" data-id="${esc(h.id)}">Open</button></td>
    </tr>`;
  }

  function exportHouseholds() {
    const list = householdRows();
    if (!list.length) { U().toast('Nothing to export'); return; }
    const sd = RWG.scorecardData;
    const head = ['Household', 'Primary contact', 'People', 'Opportunities', 'Advisor', 'Source', 'A360', 'Created'];
    const data = list.map(h => {
      const prim = H().primaryContact(h.id);
      const opps = (sd && sd.isStarted()) ? sd.cases().filter(c => c.householdId === h.id).length : '';
      const adv = h.advisorName || (h.advisorUid ? (D().user(h.advisorUid) || {}).name : '') || '';
      return [h.name, prim ? H().contactName(prim) : '', H().contactsFor(h.id).length, opps, adv,
        h.source || '', h.a360Complete ? 'complete' : 'pending',
        h.createdAt ? new Date(h.createdAt).toISOString().slice(0, 10) : ''];
    });
    U().downloadCSV(`RWG_households_${list.length}_${U().stampName()}.csv`, U().toCSV([head].concat(data)));
    U().toast(`Exported ${list.length} household${list.length === 1 ? '' : 's'}`, true);
  }

  /* ══ the contact record ═══════════════════════════════════
     One person, everything about them, and the three things you
     start from a person: a note, a task, an opportunity. No
     calendar tab — appointments live on the lead record and in
     the advisors' own calendars, and a second half-wired one
     here would be worse than none.

     Nothing on this screen is new data. It is the household
     spine, the lead they came from, their cases and their tasks,
     assembled around one human instead of around a family. ── */

  const fullName = (c) => H().contactName(c) || '(no name)';

  function rowLine(label, value, sub) {
    if (value == null || value === '') return '';
    return `<div class="list-row mid"><span class="grow">
        <span class="cell-sub" style="display:block">${esc(label)}</span>
        <span style="font-size:var(--fs-dense);color:var(--ink)">${value}</span>
        ${sub ? `<span class="cell-sub" style="display:block">${esc(sub)}</span>` : ''}
      </span></div>`;
  }

  // "How did this person become a client?" — assembled from stamps that
  // already exist. Every line is a fact somebody's action wrote, not a
  // guess: who did it, when, and what it was.
  function historyRows(c) {
    const out = [];
    const h = hhOf(c);
    const uname = (uid) => { const u = uid && D().user(uid); return (u && u.name) || ''; };
    const lead = c.leadId && D().lead ? D().lead(c.leadId) : null;

    if (lead) {
      const src = lead.listName || lead.source || '';
      out.push({ at: lead.createdAt || 0, t: 'Arrived as a lead',
        s: src ? 'from ' + src : '', who: '' });
      const kept = (lead.activities || []).filter(a => a.disposition === 'Appointment Set');
      if (kept.length) out.push({ at: kept[0].at, t: 'Appointment set', s: '', who: uname(kept[0].by) });
      if (lead.apptDate) out.push({ at: lead.apptDate, t: 'Appointment', s: 'kept — the meeting that started it', who: '' });
    }
    if (h) {
      out.push({ at: h.convertedAt || h.createdAt || 0,
        t: lead ? 'Became a client' : 'Added to the book',
        s: h.name + (h.source ? ' · ' + h.source : ''),
        who: uname(h.convertedBy || h.createdBy) });
    }
    out.push({ at: c.createdAt || 0, t: 'Contact record created', s: '', who: uname(c.createdBy) });

    const sd = RWG.scorecardData;
    if (sd && sd.isStarted() && h) {
      const mine = sd.cases().filter(x => x.householdId === h.id);
      const first = mine.slice().sort((a, b) => String(a.openedWeek).localeCompare(String(b.openedWeek)))[0];
      if (first) out.push({ at: Date.parse((first.openedWeek || '') + 'T12:00:00') || 0,
        t: 'First opportunity opened', s: first.title || RWG.scorecard.productName(first.product), who: first.agentName || '' });
      mine.filter(x => x.closedAt).forEach(x => out.push({ at: Date.parse(x.closedAt) || 0,
        t: 'Closed and confirmed', s: x.title || RWG.scorecard.productName(x.product), who: x.agentName || '' }));
    }
    return out.filter(e => e.at).sort((a, b) => a.at - b.at);
  }

  function historyCard(c) {
    const rows = historyRows(c);
    const body = rows.length ? rows.map(e => `<div class="list-row">
        <span class="grow">
          <span style="font-size:var(--fs-dense);color:var(--ink)">${esc(e.t)}</span>
          ${e.s ? `<span class="cell-sub" style="display:block">${esc(e.s)}</span>` : ''}
          <span class="cell-sub" style="display:block">${U().fmtDate(e.at)}${e.who ? ' · ' + esc(e.who) : ''}</span>
        </span></div>`).join('')
      : '<p class="list-empty">Nothing stamped yet. This fills itself in as the record is worked.</p>';
    return `<div class="card flush"><div class="list-head"><span class="t">History</span>
      <span class="s">how they got here</span></div>${body}</div>`;
  }

  function peopleCard(c) {
    const h = hhOf(c);
    if (!h) return `<div class="card flush"><div class="list-head"><span class="t">Household</span></div>
      <p class="list-empty">Not attached to a household yet.</p></div>`;
    const others = H().contactsFor(h.id).filter(x => x.id !== c.id);
    return `<div class="card flush">
      <div class="list-head"><span class="t">Household</span>
        <span class="topbar-spacer"></span>
        <button class="btn btn-quiet btn-sm" data-action="hh-open" data-id="${esc(h.id)}">Open ${esc(h.name)} →</button></div>
      ${others.length ? others.map(o => `<div class="list-row mid">
          <span class="grow"><span style="font-size:var(--fs-dense);color:var(--navy);font-weight:600;cursor:pointer"
              data-action="ct-open" data-id="${esc(o.id)}">${esc(fullName(o))}</span>
            <span class="cell-sub" style="display:block">${esc(o.relationship || '')}</span></span>
          <span class="end"><button class="btn btn-quiet btn-sm" data-action="ct-open" data-id="${esc(o.id)}">Open</button></span>
        </div>`).join('')
        : '<p class="list-empty">The only person on this household.</p>'}</div>`;
  }

  function oppsCard(c) {
    const sd = RWG.scorecardData, sc = RWG.scorecard;
    if (!sd || !sd.isStarted() || !c.householdId) return '';
    const rows = sd.cases().filter(x => x.householdId === c.householdId)
      .sort((a, b) => String(b.openedWeek).localeCompare(String(a.openedWeek)));
    return `<div class="card flush">
      <div class="list-head"><span class="t">Opportunities</span><span class="s">${rows.length}</span>
        <span class="topbar-spacer"></span>
        <button class="btn btn-gold btn-sm" data-action="cs-new" data-hh="${esc(c.householdId)}"
          data-client="${esc(fullName(c))}">＋ New</button></div>
      ${rows.length ? rows.map(x => `<div class="list-row mid" data-action="cs-open" data-id="${esc(x.recordId)}" style="cursor:pointer">
          <span class="grow"><span style="font-size:var(--fs-dense);color:var(--navy);font-weight:600">${esc(x.title || sc.productName(x.product))}</span>
            <span class="cell-sub" style="display:block">${esc(sc.productName(x.product))} · ${esc(x.state || '')}</span></span>
          <span class="end num" style="font-size:var(--fs-dense)">${U().money(sc.usesAum(x.product) ? x.aum : x.amount)}</span>
        </div>`).join('')
        : '<p class="list-empty">Nothing open. Start one from the ＋ above.</p>'}</div>`;
  }

  function datesCard(c) {
    const rows = [];
    if (c.dob) {
      const b = H().upcomingBirthdays(400).find(x => x.contact.id === c.id);
      if (b) rows.push({ t: 'Birthday', s: b.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
        + ' · turns ' + b.turning, d: b.inDays });
    }
    (c.keyDates || []).forEach(k => rows.push({ t: k.label || 'Key date', s: k.note || '', d: null, raw: k.date }));
    if (!rows.length) return '';
    return `<div class="card flush"><div class="list-head"><span class="t">Dates</span>
        <span class="topbar-spacer"></span>
        <button class="btn btn-quiet btn-sm" data-action="kd-add" data-contact="${esc(c.id)}">＋</button></div>
      ${rows.map(r => `<div class="list-row mid"><span class="grow">
          <span style="font-size:var(--fs-dense);color:var(--ink)">${esc(r.t)}</span>
          ${r.s ? `<span class="cell-sub" style="display:block">${esc(r.s)}</span>` : ''}</span>
        <span class="end cell-sub">${r.d != null ? (r.d === 0 ? 'today' : 'in ' + r.d + 'd') : esc(String(r.raw || '').slice(0, 10))}</span>
      </div>`).join('')}</div>`;
  }

  function detailsCard(c) {
    const h = hhOf(c);
    const adv = advisorOf(c);
    const tags = (c.tags || []).map(t =>
      `<button class="tag-chip" data-action="ct-tag" data-tag="${esc(t)}">${esc(t)}</button>`).join('');
    return `<div class="card flush">
      <div class="list-head"><span class="t">Details</span>
        <span class="topbar-spacer"></span>
        <button class="btn btn-quiet btn-sm" data-action="hh-person-edit" data-id="${esc(c.id)}">✎ Edit</button></div>
      ${rowLine('Relationship', esc(c.relationship || '—'))}
      ${rowLine('Advisor', esc(adv || '—'))}
      ${rowLine('Household', h ? `<button class="btn-link" data-action="hh-open" data-id="${esc(h.id)}">${esc(h.name)}</button>` : '—')}
      ${rowLine('Source', esc((h && h.source) || '—'))}
      ${rowLine('Employer', esc(c.employer || '—'), c.title || '')}
      ${rowLine('Plan type', esc(c.planType || '—'),
        [c.yos != null && c.yos !== '' ? c.yos + ' yrs service' : '', c.afc ? U().money(c.afc) + ' AFC' : ''].filter(Boolean).join(' · '))}
      ${rowLine('Date of birth', c.dob ? esc(fmtDobLocal(c.dob)) : '—')}
      ${tags ? `<div class="list-row"><span class="grow"><span class="cell-sub" style="display:block">Tags</span>
        <span class="tagwrap" style="margin-top:4px">${tags}</span></span></div>` : ''}
      ${rowLine('Newsletter', c.advisorstream
        ? '<span class="chip tier-high">On the AdvisorStream list</span>'
        : '<span class="pill-soft">Not on the list</span>')}
    </div>`;
  }
  const fmtDobLocal = (dob) => {
    const p = String(dob).split('-').map(Number);
    if (p.length !== 3) return dob;
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  function wfCard(c) {
    const W = RWG.wf, T = RWG.tasks, SD = RWG.scorecardData;
    if (!W || !T || !T.isStarted() || !c.householdId) return '';
    const caseIds = (SD && SD.isStarted()) ? SD.cases().filter(x => x.householdId === c.householdId).map(x => x.recordId) : [];
    const list = W.instancesFor(c.householdId, caseIds);
    if (!list.length) return '';
    return `<div class="card flush"><div class="list-head"><span class="t">Workflows</span><span class="s">${list.length}</span></div>
      ${list.map(w => {
        const done = w.done >= w.total;
        return `<div class="list-row"><span class="grow">
          <span style="font-size:var(--fs-dense);color:var(--navy);font-weight:600">${esc(w.name)}</span>
          <span class="cell-sub" style="display:block">${esc(w.label || '')}</span>
          ${w.next ? `<span class="cell-sub" style="display:block">Next: ${esc(w.next.title)} · ${esc((w.next.assigneeName || '').split(' ')[0])}</span>` : ''}
        </span><span class="end cell-sub" style="${done ? 'color:var(--good);font-weight:700' : ''}">${done ? '✓ done' : w.done + '/' + w.total}</span></div>`;
      }).join('')}</div>`;
  }

  // The activity feed: what has actually been said and done about this person.
  function feedRows(c) {
    const ev = [];
    const N = RWG.notes, T = RWG.tasks;
    if (N && N.isStarted()) {
      N.all().filter(n => (n.relatedType === 'contact' && n.relatedId === c.id)
        || (c.householdId && n.relatedType === 'household' && n.relatedId === c.householdId))
        .forEach(n => ev.push({ at: n.createdAt, who: n.authorName, kind: 'note', body: n.bodyHtml || n.body, id: n.id }));
    }
    if (T && T.isStarted() && c.householdId) {
      T.all().filter(t => t.householdId === c.householdId && t.status === 'done' && t.doneAt)
        .forEach(t => ev.push({ at: t.doneAt, who: t.assigneeName, kind: 'done', body: '', txt: 'completed <b>' + esc(t.title) + '</b>' }));
    }
    historyRows(c).forEach(e => ev.push({ at: e.at, who: e.who, kind: 'stamp', txt: esc(e.t) + (e.s ? ' <span class="cell-sub">· ' + esc(e.s) + '</span>' : '') }));
    return ev.sort((a, b) => b.at - a.at).slice(0, 40);
  }

  function feedCard(c, user) {
    const rows = feedRows(c);
    return `<div class="card flush">
      <div class="list-head"><span class="t">Activity</span><span class="s">newest first</span></div>
      ${rows.length ? rows.map(e => `<div class="list-row">
          ${U().avatar({ name: e.who || '·' }, 26)}
          <span class="grow" style="min-width:0">
            <span style="font-size:var(--fs-dense);color:var(--ink)">${e.kind === 'note'
              ? '<b>' + esc(e.who || 'Someone') + '</b> wrote'
              : '<b>' + esc(e.who || 'Someone') + '</b> ' + (e.txt || '')}</span>
            ${e.body ? `<span class="hm-note-body">${U().noteHtml(e.body)}</span>` : ''}
          </span>
          <span class="end cell-sub">${U().fmtRelative(e.at)}</span>
        </div>`).join('')
        : '<p class="list-empty">Nothing yet. Post the first note above.</p>'}</div>`;
  }

  // Three tabs, and Note is the only one with a form here — Task and
  // Opportunity open the real windows those records already have.
  function composer(c, user) {
    const tab = (id, label, ic) =>
      `<button class="btn btn-sm ${st.tab === id ? 'btn-navy' : 'btn-ghost'}" data-action="ct-tab" data-tab="${id}">${U().icon(ic, 'ic-inline')} ${label}</button>`;
    const N = RWG.notes;
    const off = !N || !N.isStarted();
    return `<div class="card hm-composer">
      <div class="flex" style="gap:6px;flex-wrap:wrap;align-items:center">
        ${tab('note', 'Note', 'scorecard')}${tab('task', 'Task', 'today')}${tab('opp', 'Opportunity', 'cases')}
      </div>
      ${st.tab === 'note' ? `<div class="hm-compose-row">
        ${U().avatar(user, 34)}
        <div style="flex:1;min-width:0">
          ${U().noteEditor({ id: 'ct-note', editable: !off, minHeight: '78px',
            placeholder: 'Add a note about ' + fullName(c) + '…' })}
          <div class="flex" style="gap:8px;align-items:center;margin-top:8px">
            <span class="hint" style="margin:0">${off ? 'Connecting…' : 'Everyone sees this. It files against ' + esc(fullName(c)) + '.'}</span>
            <span class="topbar-spacer"></span>
            <button class="btn btn-gold btn-sm" data-action="ct-note-post" data-id="${esc(c.id)}" ${off ? 'disabled' : ''}>Post</button>
          </div>
        </div></div>` : ''}
    </div>`;
  }

  // Task and Opportunity open the real windows those records already have,
  // rather than a second copy of each form living on this screen.
  function handoff(tab) {
    if (tab === 'note') { RWG.app.renderMain(); return; }
    const c = st.currentId && H().contact(st.currentId);
    st.tab = 'note';
    if (!c) { RWG.app.renderMain(); return; }
    const owner = RWG.modules.actionOwner(tab === 'task' ? 'tk-new' : 'cs-new');
    if (!owner) { U().toast('That screen has not loaded yet — try again in a moment'); return; }
    RWG.app.renderMain();
    if (tab === 'task') owner.actions['tk-new']({ dataset: { hh: c.householdId || '', contact: c.id } });
    else owner.actions['cs-new']({ dataset: { hh: c.householdId || '', client: H().contactName(c) } });
  }

  // A view id we can actually navigate back to, or nothing.
  const backView = () => {
    const f = st.from;
    if (!f || f === 'contact') return null;
    const M = RWG.modules;
    if (M && M.moduleForView && !M.moduleForView(f)) return null;
    return f;
  };
  // The link reads as the place you came from. A household says its own name;
  // "Household" is true and tells you nothing at a glance.
  function backLabel() {
    const f = backView();
    if (!f || f === 'contacts') return 'All contacts';
    if (f === 'household') {
      const c = H().contact(st.currentId);
      const h = c ? hhOf(c) : null;
      return h ? h.name : 'Household';
    }
    const m = RWG.modules && RWG.modules.metaFor ? RWG.modules.metaFor(f) : null;
    return (m && m.t) || 'Back';
  }

  function contactHtml(c, user, ctx) {
    const h = hhOf(c);
    const phone = c.phone ? `<a href="tel:${esc(String(c.phone).replace(/[^\d+]/g, ''))}">${esc(fmtPhone(c.phone))}</a>` : '';
    const email = c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '';
    return `
      <button class="btn btn-quiet btn-sm" data-action="ct-back" style="margin-bottom:var(--s3)">← ${esc(backLabel())}</button>
      <div class="card" style="margin-bottom:var(--panel-gap)">
        <div class="flex" style="gap:var(--s3);align-items:flex-start;flex-wrap:wrap">
          ${U().avatar({ name: fullName(c) }, 54)}
          <div style="min-width:0">
            <h3 style="font-size:var(--fs-title)">${esc(fullName(c))}</h3>
            <div class="cell-sub">${esc([c.title, c.employer].filter(Boolean).join(' at ') || c.relationship || '')}</div>
            <div class="tag-row" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px">
              ${h ? `<button class="pill-soft" style="cursor:pointer" data-action="hh-open" data-id="${esc(h.id)}">${U().icon('household', 'ic-inline')} ${esc(h.name)}</button>` : ''}
              ${c.relationship ? `<span class="pill-soft">${esc(c.relationship)}</span>` : ''}
              ${c.leadId ? `<button class="pill-soft" style="cursor:pointer" data-action="open-lead" data-id="${esc(c.leadId)}" title="The lead record they came from — full call history">Came from a lead</button>` : ''}
            </div>
          </div>
          <span class="topbar-spacer"></span>
          <div style="text-align:right">
            <div style="font-size:var(--fs-dense)">${phone || '<span class="muted">no phone</span>'}</div>
            <div style="font-size:var(--fs-dense);margin-top:2px">${email || '<span class="muted">no email</span>'}</div>
            <div class="flex" style="gap:6px;margin-top:10px;justify-content:flex-end">
              <button class="btn btn-ghost btn-sm" data-action="hh-person-edit" data-id="${esc(c.id)}">✎ Edit</button>
              ${ctx.isAdmin ? `<button class="btn btn-quiet btn-sm" data-action="hh-person-remove" data-id="${esc(c.id)}" title="Remove this person (admin)">Delete</button>` : ''}
            </div>
          </div>
        </div>
      </div>
      <div class="rec-shell">
        <div style="min-width:0">${composer(c, user)}${feedCard(c, user)}</div>
        <div class="rec-rail">
          ${datesCard(c)}${wfCard(c)}${detailsCard(c)}${peopleCard(c)}${oppsCard(c)}${historyCard(c)}
        </div>
      </div>`;
  }

  // ── the screen ────────────────────────────────────────────
  function screenHtml(user, ctx) {
    const isHH = st.scope === 'households';
    const list = isHH ? householdRows() : rows();
    const total = isHH ? H().households().length : H().contacts().length;
    const users = D().users().filter(u => u.status === 'active');
    const advOpts = users.map(u =>
      `<option value="${esc(u.id)}" ${st.advisor === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
    const relOpts = H().RELATIONSHIPS.map(r =>
      `<option value="${esc(r)}" ${st.rel === r ? 'selected' : ''}>${esc(r)}</option>`).join('');
    const scopeOpts = [['people', 'People'], ['households', 'Households']].map(s =>
      `<option value="${s[0]}" ${st.scope === s[0] ? 'selected' : ''}>${s[1]}</option>`).join('');
    // Tags have no registry — one exists because somebody wears it — so the
    // list is the tags in use, most-used first, with how many wear each.
    const tags = H().allTags();
    // A tag you are filtered on stays listed even after the last person
    // loses it — otherwise the filter is still on with nothing to switch off.
    if (st.tag && !tags.some(t => t.tag.toLowerCase() === st.tag.toLowerCase())) tags.push({ tag: st.tag, count: 0 });
    const tagOpts = tags.map(t =>
      `<option value="${esc(t.tag)}" ${st.tag.toLowerCase() === t.tag.toLowerCase() ? 'selected' : ''}>${esc(t.tag)} · ${t.count}</option>`).join('');

    const sortBtn = (id, label) =>
      `<button class="btn btn-sm ${st.sort === id ? 'btn-navy' : 'btn-ghost'}" data-action="ct-sort" data-sort="${id}">${label}</button>`;

    const table = isHH
      ? `<div class="table-wrap"><table class="data">
           <thead><tr><th>Household</th><th>Primary contact</th><th class="num">People</th><th class="num">Opps</th><th>Advisor</th><th>A360</th><th></th></tr></thead>
           <tbody>${list.map(householdRow).join('')}</tbody></table></div>`
      : `<div class="table-wrap"><table class="data">
           <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Tags</th><th>Household</th><th></th></tr></thead>
           <tbody>${list.map(row).join('')}</tbody></table></div>`;

    const empty = isHH
      ? `<div class="empty" style="padding:48px 16px"><div class="ec">${U().icon('household','ic-lg')}</div>
           <h3>${total ? 'No households match' : 'The book starts here'}</h3>
           <p>${total ? 'Loosen the search.' : 'Convert a lead whose appointment was kept, or add a contact and start a household with them.'}</p></div>`
      : `<div class="empty" style="padding:48px 16px"><div class="ec">👥</div>
           <h3>${total ? 'Nobody matches' : 'No people yet'}</h3>
           <p>${total ? 'Loosen the search or clear the tag filter.' : 'People arrive when a lead converts, or add one by hand.'}</p></div>`;

    const filtered = st.q || st.tag || st.advisor || (!isHH && st.rel);

    // The one-time grouping pass, offered while any case still lacks a
    // household and gone the day the last one is attached.
    const sd = RWG.scorecardData;
    const unattached = (ctx.isAdmin && sd && sd.isStarted())
      ? sd.cases().filter(c => !c.householdId).length : 0;

    return `<div class="ct-shell">
      <div class="card flush">
        <div class="list-head">
          <span class="t">Contacts</span>
          <span class="s">${list.length}${filtered && total !== list.length ? ' of ' + total : ''} ${isHH ? 'households' : 'people'}</span>
          <span class="topbar-spacer"></span>
          <div class="flex" style="gap:6px;align-items:center">
            <span class="cell-sub" style="margin-right:2px">Order</span>
            ${sortBtn('az', 'A–Z')}${sortBtn('za', 'Z–A')}${sortBtn('recent', 'Recent')}${sortBtn('created', 'Newest')}
            <button class="btn btn-ghost btn-sm" data-action="ct-export"
              title="Exports exactly what the filters are showing, in the order shown">⤓ Export</button>
            ${isHH
              ? `<button class="btn btn-gold btn-sm" data-action="hh-new">＋ New household</button>`
              : `<button class="btn btn-gold btn-sm" data-action="hh-person-add">＋ Add contact</button>`}
          </div>
        </div>
        <div class="list-toolbar">
          <select id="ct-scope" class="ct-scope">${scopeOpts}</select>
          <input id="ct-q" class="input ct-q" type="search"
                 placeholder="${isHH ? 'Household, person or source…' : 'Name, email, phone, employer, tag…'}"
                 value="${esc(st.q)}">
          <select id="ct-advisor"><option value="">Any advisor</option>${advOpts}</select>
          ${isHH ? '' : `<select id="ct-rel"><option value="">Any relationship</option>${relOpts}</select>`}
          <select id="ct-tagsel" title="Tags in use"><option value="">Any tag</option>${tagOpts}</select>
          <span class="topbar-spacer"></span>
          ${isHH ? `<button class="btn btn-ghost btn-sm" data-action="hh-convert-pick">Convert a lead ${U().icon('spark','ic-inline')}</button>` : ''}
          ${isHH && unattached ? `<button class="btn btn-navy btn-sm" data-action="nav" data-view="grouping"
              title="One-time pass: attach every existing case to a household">⚡ Group existing cases · ${unattached}</button>` : ''}
        </div>
        ${list.length ? table : empty}
      </div>
    </div>`;
  }

  RWG.modules.register({
    id: 'contacts',
    title: 'Contacts',
    enabled: true,
    roles: ['admin', 'agent'],
    // A household is a contact record seen at family grain, so Contacts stays
    // lit while you are on one — you did not leave the area.
    nav: [{ view: 'contacts', label: 'Contacts', icon: 'person', also: ['households', 'household', 'contact'] }],
    views: ['contact'],
    meta: {
      contacts: { t: 'Contacts', s: 'Every person in the book' },
      contact:  { t: 'Contact',  s: 'One person — their family, their work, their history' }
    },
    state: st,

    home: {
      tile: () => ({
        icon: 'person', title: 'Contacts',
        desc: 'Every person in the book — search, tag and slice the whole list.',
        view: 'contacts'
      })
    },

    onEnter(view) {
      const me = RWG.auth.currentUser();
      if (!H().isStarted()) H().init(me, RWG.app.renderMain);
      if (view === 'contact') {
        // The record assembles notes, tasks, cases and workflows around one person.
        if (RWG.notes && !RWG.notes.isStarted()) RWG.notes.init(me, RWG.app.renderMain);
        if (RWG.tasks && !RWG.tasks.isStarted()) RWG.tasks.init(me, RWG.app.renderMain);
        if (RWG.pipelines) RWG.pipelines.init();
        if (RWG.wf) RWG.wf.init();
      }
      // The households scope counts each family's opportunities.
      const sd = RWG.scorecardData;
      if (sd && !sd.isStarted()) sd.init(me, RWG.app.renderMain);
    },

    onInput(e) {
      if (e.target.id === 'ct-q') {
        st.q = e.target.value;
        RWG.app.renderMain();
        const box = document.getElementById('ct-q');
        if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
      }
    },

    onChange(e) {
      if (e.target.id === 'ct-scope') { st.scope = e.target.value; RWG.app.renderMain(); }
      if (e.target.id === 'ct-advisor') { st.advisor = e.target.value; RWG.app.renderMain(); }
      if (e.target.id === 'ct-rel') { st.rel = e.target.value; RWG.app.renderMain(); }
      if (e.target.id === 'ct-tagsel') { st.tag = e.target.value; RWG.app.renderMain(); }
    },

    actions: {
      // Open a person: the person. Every click on a name anywhere in the app
      // lands here, so it must work from any screen — a phone or email link
      // inside the row is a real link and must win over the row.
      'ct-open': (el, e) => {
        if (e && e.target && e.target.closest && e.target.closest('a[href]')) return;
        const c = H().contact(el.dataset.id);
        if (!c) return;
        const at = RWG.app.state && RWG.app.state.view;
        if (at && at !== 'contact') st.from = at;
        st.currentId = c.id;
        st.tab = 'note';
        const m = document.getElementById('modal-mount'); if (m) m.innerHTML = '';
        RWG.app.nav('contact');
      },
      'ct-back': () => {
        const to = backView() || 'contacts';
        st.currentId = null; st.from = null;
        RWG.app.nav(to);
      },
      'ct-tab': (el) => { st.tab = el.dataset.tab || 'note'; handoff(el.dataset.tab); },
      'ct-note-post': (el) => {
        const c = H().contact(el.dataset.id); if (!c) return;
        const body = U().noteText('ct-note');
        if (!body) { U().toast('Say something first'); return; }
        const n = RWG.notes && RWG.notes.addNote({
          body: body, bodyHtml: U().noteRead('ct-note'),
          relatedType: 'contact', relatedId: c.id, relatedLabel: H().contactName(c)
        });
        if (!n) { U().toast('Could not post that'); return; }
        RWG.app.renderMain();
        U().toast('Posted to ' + H().contactName(c), true);
      },
      'ct-sort': (el) => { st.sort = el.dataset.sort; RWG.app.renderMain(); },
      'ct-tag': (el) => {
        const t = el.dataset.tag || '';
        // Clicking the tag you are already filtered on takes it off again.
        st.tag = (t && t.toLowerCase() === st.tag.toLowerCase()) ? '' : t;
        RWG.app.renderMain();
      },
      // Exports what the screen is showing — people or households, filtered
      // and in the order on screen. Anything else is a different report.
      'ct-export': () => {
        if (st.scope === 'households') { exportHouseholds(); return; }
        const list = rows();
        if (!list.length) { U().toast('Nothing to export'); return; }
        const head = ['First name', 'Last name', 'Relationship', 'Phone', 'Email', 'Date of birth',
          'Employer', 'Plan type', 'Years of service', 'AFC', 'Tags', 'Household', 'Advisor', 'AdvisorStream'];
        const data = list.map(c => {
          const h = hhOf(c);
          return [c.firstName || '', c.lastName || '', c.relationship || '', c.phone || '', c.email || '',
            c.dob || '', c.employer || '', c.planType || '', c.yos == null ? '' : c.yos,
            c.afc == null ? '' : c.afc, (c.tags || []).join('; '), h ? h.name : '',
            advisorOf(c) || '', c.advisorstream ? 'yes' : 'no'];
        });
        U().downloadCSV(`RWG_contacts_${list.length}_${U().stampName()}.csv`, U().toCSV([head].concat(data)));
        U().toast(`Exported ${list.length} ${list.length === 1 ? 'person' : 'people'}`, true);
      }
    },

    render(view, user, ctx) {
      if (!H().isStarted()) return `<div class="empty" style="padding:60px"><div class="ec">⏳</div><h3>Loading the book…</h3></div>`;
      if (view === 'contact') {
        const c = st.currentId && H().contact(st.currentId);
        if (c) return contactHtml(c, user, ctx);
        st.currentId = null;   // deleted, or a stale link — the list is the honest fallback
      }
      return screenHtml(user, ctx);
    }
  });
})();
