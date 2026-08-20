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
  const st = { q: '', sort: 'seen', tag: '', advisor: '', rel: '', employer: '', scope: 'people', currentId: null, tab: 'note', from: null };

  /* Who you were just working with, at the top. A book of clients is not
     really browsed alphabetically — you come back to the same handful all
     week — so the list opens on the people you have actually opened,
     most recent first, with everyone else behind them in A-Z.

     It is kept per person in this browser rather than on the record: it
     is a memory of what YOU looked at, and writing to Firestore on every
     click would put a write behind reading a name. Private browsing and
     a wiped cache simply fall back to A-Z, which is why the store never
     throws. */
  const seenKey = () => {
    const me = RWG.auth && RWG.auth.currentUser && RWG.auth.currentUser();
    return 'rwg.seen.contacts.' + ((me && me.id) || 'anon');
  };
  function seenList() {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(seenKey());
      const v = raw ? JSON.parse(raw) : [];
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function markSeen(id) {
    if (!id) return;
    try {
      if (typeof localStorage === 'undefined') return;
      const next = [id].concat(seenList().filter(x => x !== id)).slice(0, 200);
      localStorage.setItem(seenKey(), JSON.stringify(next));
    } catch (e) { /* a full or blocked store just means no memory */ }
  }

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
          || String(c.preferredName || '').toLowerCase().indexOf(q) >= 0
          || H().emailsOf(c).some(w => w.v.toLowerCase().indexOf(q) >= 0)
          || (/\d/.test(q) && H().phonesOf(c).some(w =>
               w.v.replace(/\D/g, '').indexOf(q.replace(/\D/g, '')) >= 0))
          || String(c.employer || '').toLowerCase().indexOf(q) >= 0
          // city, state or ZIP: "who do we have in Hialeah" is a question
          // people ask out loud, so the one box has to answer it
          || H().addrLine(H().addressFor(c).addr).toLowerCase().indexOf(q) >= 0
          || (h && h.name.toLowerCase().indexOf(q) >= 0)
          || (c.tags || []).some(t => String(t).toLowerCase().indexOf(q) >= 0);
      });
    }
    if (st.tag) list = list.filter(c => H().hasTag(c, st.tag));
    if (st.employer) list = list.filter(c =>
      String(c.employer || '').trim().toLowerCase() === st.employer.toLowerCase());
    if (st.rel) list = list.filter(c => (c.relationship || '') === st.rel);
    if (st.advisor) list = list.filter(c => { const h = hhOf(c); return h && h.advisorUid === st.advisor; });

    // A–Z means by surname — the way you actually look someone up in a book
    // of clients — falling back to the first name for a family.
    const name = (c) => `${c.lastName || ''} ${c.firstName || ''}`.trim().toLowerCase()
      || H().contactName(c).toLowerCase();
    // rank: 0 is the last person opened. Anyone never opened sorts behind
    // the whole memory, and ties there fall back to A-Z.
    const seen = seenList();
    const rank = {};
    seen.forEach((id, i) => { rank[id] = i; });
    const sorters = {
      az: (a, b) => name(a).localeCompare(name(b)),
      za: (a, b) => name(b).localeCompare(name(a)),
      seen: (a, b) => {
        const ra = rank[a.id] == null ? Infinity : rank[a.id];
        const rb = rank[b.id] == null ? Infinity : rank[b.id];
        return ra === rb ? name(a).localeCompare(name(b)) : ra - rb;
      },
      recent: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
      created: (a, b) => (b.createdAt || 0) - (a.createdAt || 0)
    };
    return list.sort(sorters[st.sort] || sorters.seen);
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

  /* What belongs to this person. contactId is the real link — the household
     is only a fallback, so records written before people carried their own
     pointer still surface instead of vanishing. An opportunity that names a
     different member of the family does NOT show here: that is the point of
     anchoring on the person. */
  function casesFor(c) {
    const sd = RWG.scorecardData;
    if (!sd || !sd.isStarted()) return [];
    return sd.cases().filter(x => x.contactId
      ? x.contactId === c.id
      : (!!c.householdId && x.householdId === c.householdId));
  }
  // Every task about this person: filed on them, on one of their
  // opportunities, or (legacy) on their family with nobody named.
  function tasksFor(c) {
    const T = RWG.tasks;
    if (!T || !T.isStarted()) return [];
    const mine = {};
    casesFor(c).forEach(x => { mine[x.recordId] = x; });
    return T.all().filter(t =>
      t.contactId === c.id
      || (t.relatedType === 'contact' && t.relatedId === c.id)
      || (t.relatedType === 'case' && mine[t.relatedId])
      || (!t.contactId && !!c.householdId && t.householdId === c.householdId
          && t.relatedType !== 'case' && t.relatedType !== 'contact'));
  }
  const caseOf = (t) => {
    const sd = RWG.scorecardData;
    if (t.relatedType !== 'case' || !sd || !sd.isStarted()) return null;
    return sd.caseById(t.relatedId);
  };
  function ageOn(dob) {
    const p = String(dob).split('-').map(Number);
    if (p.length !== 3) return null;
    const now = new Date();
    let a = now.getFullYear() - p[0];
    const had = (now.getMonth() + 1 > p[1]) || (now.getMonth() + 1 === p[1] && now.getDate() >= p[2]);
    if (!had) a -= 1;
    return a >= 0 && a < 130 ? a : null;
  }

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
    if (sd && sd.isStarted()) {
      const mine = casesFor(c);
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
        <button class="btn btn-quiet btn-sm" data-action="hh-panel" data-id="${esc(h.id)}">${esc(h.name)} →</button></div>
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
    if (!sd || !sd.isStarted()) return '';
    const rows = casesFor(c)
      .sort((a, b) => String(b.openedWeek).localeCompare(String(a.openedWeek)));
    return `<div class="card flush">
      <div class="list-head"><span class="t">Opportunities</span><span class="s">${rows.length}</span>
        <span class="topbar-spacer"></span>
        <button class="btn btn-gold btn-sm" data-action="cs-new" data-contact="${esc(c.id)}"
          ${c.householdId ? `data-hh="${esc(c.householdId)}"` : ''}
          data-client="${esc(fullName(c))}">＋ New</button></div>
      ${rows.length ? rows.map(x => `<div class="list-row mid" data-action="cs-open" data-id="${esc(x.recordId)}" style="cursor:pointer">
          <span class="grow"><span style="font-size:var(--fs-dense);color:var(--navy);font-weight:600">${esc(x.title || sc.productName(x.product))}</span>
            <span class="cell-sub" style="display:block">${esc(sc.productName(x.product))} · ${esc(x.state || '')}</span></span>
          <span class="end num" style="font-size:var(--fs-dense)">${U().money(sc.usesAum(x.product) ? x.aum : x.amount)}</span>
        </div>`).join('')
        : '<p class="list-empty">Nothing open. Start one from the ＋ above.</p>'}</div>`;
  }

  /* Upcoming Activity — what is still owed on this person and what is
     coming up on the calendar, in one place. Open work first, because that
     is the question you open a record to answer; dates underneath, because
     they are the reason you call. A closed task leaves here and stays in
     the activity feed, which is where history belongs. */
  function upcomingCard(c) {
    const T = RWG.tasks;
    const today = T && T.isStarted() ? T.todayKey() : '';
    const open = tasksFor(c).filter(t => t.status !== 'done')
      .sort((a, b) => String(a.dueDate || '9999-99-99').localeCompare(String(b.dueDate || '9999-99-99')));

    const when = (d) => {
      if (!d) return '<span class="cell-sub">no date</span>';
      const late = today && d < today;
      const label = today && d === today ? 'Today' : U().fmtDate(Date.parse(d + 'T12:00:00'));
      return `<span class="cell-sub" style="${late ? 'color:var(--bad);font-weight:700' : (d === today ? 'color:var(--navy);font-weight:700' : '')}">${esc(label)}</span>`;
    };
    const taskRows = open.length ? open.map(t => {
      const x = caseOf(t);
      return `<div class="list-row mid list-row-click" data-action="tk-edit" data-id="${esc(t.id)}">
        <input type="checkbox" data-action="tk-done" data-id="${esc(t.id)}"
          style="margin-top:3px" title="Mark done" aria-label="Mark ${esc(t.title)} done">
        <span class="grow" style="min-width:0">
          <span style="font-size:var(--fs-dense);color:var(--navy);font-weight:600">${esc(t.title)}</span>
          <span class="cell-sub" style="display:block">${when(t.dueDate)}
            ${t.assigneeName ? ' · ' + esc(t.assigneeName.split(' ')[0]) : ''}
            ${x ? ' · <button class="btn-link" data-action="cs-open" data-id="' + esc(x.recordId) + '">'
                  + esc(x.title || (RWG.scorecard ? RWG.scorecard.productName(x.product) : 'opportunity')) + '</button>' : ''}</span>
        </span></div>`;
    }).join('') : '<p class="list-empty">Nothing outstanding.</p>';

    const dates = [];
    if (c.dob) {
      const a = ageOn(c.dob);
      dates.push({ t: 'Birthdate: ' + fmtDobLocal(c.dob), end: a != null ? 'Age ' + a : '' });
    }
    (c.keyDates || []).forEach(k => dates.push({
      t: (k.label || 'Key date') + ': ' + esc(String(k.date || '').slice(0, 10)),
      end: k.note || '' }));

    return `<div class="card flush">
      <div class="list-head"><span class="t">Upcoming Activity</span>
        <span class="topbar-spacer"></span>
        <button class="btn btn-quiet btn-sm" data-action="tk-new" data-contact="${esc(c.id)}"
          ${c.householdId ? `data-hh="${esc(c.householdId)}"` : ''} title="New task for ${esc(fullName(c))}">＋ Task</button></div>
      <div class="rec-sub">Tasks${open.length ? ' · ' + open.length : ''}</div>
      ${taskRows}
      <div class="rec-sub">Special dates
        <button class="btn-link" data-action="kd-add" data-contact="${esc(c.id)}" style="float:right">＋ Add</button></div>
      ${dates.length ? dates.map(d => `<div class="list-row mid">
          <span class="grow" style="font-size:var(--fs-dense);color:var(--ink)">${d.t}</span>
          <span class="end cell-sub">${esc(d.end)}</span></div>`).join('')
        : '<p class="list-empty">No birthday on file.</p>'}</div>`;
  }

  function detailsCard(c) {
    const h = hhOf(c);
    const adv = advisorOf(c);
    const tags = (c.tags || []).map(t =>
      `<button class="tag-chip" data-action="ct-tag" data-tag="${esc(t)}">${esc(t)}</button>`).join('');
    // No Edit here — it lives once, on the record header. Two buttons for one
    // action is two places to look and one of them is always the wrong one.
    return `<div class="card flush">
      <div class="list-head"><span class="t">Details</span></div>
      ${rowLine('Contact type', esc(c.contactType || '—'))}
      ${rowLine('Preferred name', esc(c.preferredName || '—'))}
      ${rowLine('Relationship', esc(c.relationship || '—'))}
      ${rowLine('Advisor', esc(adv || '—'))}
      ${rowLine('Household', h ? `<button class="btn-link" data-action="hh-panel" data-id="${esc(h.id)}">${esc(h.name)}</button>` : '—')}
      ${rowLine('Source', esc((h && h.source) || '—'))}
      ${(() => {
        /* An address inherited from the family is labelled as inherited.
           Without that, somebody edits this person to fix a typo and is
           surprised when the spouse's record still says the old street. */
        const a = H().addressFor(c);
        if (!a.addr) return rowLine('Address', '—', 'Add it from Edit, or on the household');
        const sub = [a.from === 'household' ? 'from the household' : '',
          a.at ? 'confirmed ' + U().fmtRelative(Date.parse(a.at)) : ''].filter(Boolean).join(' · ');
        return rowLine('Address', esc(H().addrLine(a.addr)), sub);
      })()}
      ${rowLine('Employer', c.employer
        ? `<button class="btn-link" data-action="ct-employer" data-employer="${esc(c.employer)}"
             title="Show everyone from ${esc(c.employer)}">${esc(c.employer)}</button>`
        : '—', c.title || '')}
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
    const W = RWG.wf, T = RWG.tasks;
    if (!W || !T || !T.isStarted()) return '';
    const caseIds = casesFor(c).map(x => x.recordId);
    if (!caseIds.length && !c.householdId) return '';
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

  /* The activity feed: what has actually been said and done about this
     person — including everything that happened on their opportunities.
     A task created on the Vargas whole life is work done for Maria, so it
     reads as Maria's history, both when it is raised and when it is closed. */
  function feedRows(c) {
    const ev = [];
    const N = RWG.notes, T = RWG.tasks;
    const mine = {};
    casesFor(c).forEach(x => { mine[x.recordId] = x; });
    if (N && N.isStarted()) {
      N.all().filter(n => (n.relatedType === 'contact' && n.relatedId === c.id)
        || (n.relatedType === 'case' && mine[n.relatedId])
        || (c.householdId && n.relatedType === 'household' && n.relatedId === c.householdId))
        .forEach(n => ev.push({ at: n.createdAt, who: n.authorName, kind: 'note', body: n.bodyHtml || n.body, id: n.id }));
    }
    if (T && T.isStarted()) {
      tasksFor(c).forEach(t => {
        const x = caseOf(t);
        const on = x ? ' <span class="cell-sub">on ' + esc(x.title || (RWG.scorecard ? RWG.scorecard.productName(x.product) : 'an opportunity')) + '</span>' : '';
        if (t.createdAt) ev.push({ at: t.createdAt, who: t.createdByName || t.assigneeName,
          kind: 'task', txt: 'created the task <b>' + esc(t.title) + '</b>' + on });
        if (t.status === 'done' && t.doneAt) ev.push({ at: t.doneAt, who: t.assigneeName,
          kind: 'done', txt: 'completed <b>' + esc(t.title) + '</b>' + on });
      });
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
    // Both carry the person, so the new record is theirs from the start —
    // not the family's, and not whoever is primary on it.
    if (tab === 'task') owner.actions['tk-new']({ dataset: { contact: c.id, hh: c.householdId || '' } });
    else owner.actions['cs-new']({ dataset: { contact: c.id, hh: c.householdId || '', client: H().contactName(c) } });
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

  /* ── the contact as a side panel ──────────────────────────
     Raised beside whatever you were doing rather than instead of it: the
     number you need to dial is three lines of data, and going to fetch it
     used to cost you the task or opportunity you were in the middle of
     writing. Read-only on purpose — this is a lookup, not an edit.

     `over` lifts it above an open modal. It is not the default because a
     panel raised from a page must still sit UNDER a modal opened on top
     of it (converting a lead, for one), and z-index is not reversible
     after the fact. */
  function contactPanelHtml(c, over) {
    const h = hhOf(c);
    const adv = advisorOf(c);
    const sd = RWG.scorecardData, sc = RWG.scorecard;
    const cases = (sd && sd.isStarted())
      ? sd.cases().filter(x => x.contactId === c.id || (h && x.householdId === h.id && !x.contactId))
          .sort((a, b) => String(b.openedWeek || '').localeCompare(String(a.openedWeek || '')))
      : [];
    const line = (label, value) => `<div class="list-row mid"><span class="grow">
        <span class="cell-sub" style="display:block">${esc(label)}</span>
        <span style="font-size:var(--fs-dense);color:var(--ink)">${value}</span></span></div>`;
    const block = (title, count, body) => `<div class="section-title">${esc(title)}${
      count != null ? ` <span class="muted" style="font-weight:400">${count}</span>` : ''}</div>${body}`;

    // The reason this panel exists: how to reach them, first and biggest.
    const phones = H().phonesOf(c), emails = H().emailsOf(c);
    const reachRow = (label, body) => `<div class="list-row mid"><span class="grow" style="min-width:0">
        <span class="cell-sub" style="display:block">${esc(label || 'Phone')}</span>${body}</span></div>`;
    const reach = (phones.length || emails.length)
      ? phones.map(w => reachRow(w.label || 'Phone',
          `<a href="tel:${esc(w.v.replace(/[^\d+]/g, ''))}" style="font-size:16px;font-weight:600">${esc(fmtPhone(w.v))}</a>`)).join('')
        + emails.map(w => reachRow(w.label || 'Email',
          `<a href="mailto:${esc(w.v)}" style="font-size:var(--fs-dense);word-break:break-all">${esc(w.v)}</a>`)).join('')
      : '<p class="list-empty">No phone or email on file.</p>';

    const caseRows = cases.length ? cases.map(x => `<div class="list-row mid"
        style="cursor:pointer" data-action="cs-open" data-id="${esc(x.recordId)}">
        <span class="grow" style="min-width:0">
          <span style="font-size:var(--fs-dense);color:var(--navy);font-weight:600">${esc(x.title || (sc ? sc.productName(x.product) : ''))}</span>
          <span class="cell-sub" style="display:block">${esc(sc ? sc.productName(x.product) : '')}${x.closedAt ? ' · closed' : (x.state ? ' · ' + esc(x.state) : '')}</span>
        </span></div>`).join('')
      : '<p class="list-empty">Nothing open for this person.</p>';

    const tags = (c.tags || []).length
      ? `<div class="tag-row" style="padding:var(--pad-cell);display:flex;flex-wrap:wrap;gap:7px">${
          (c.tags || []).map(t => `<span class="pill-soft">${esc(t)}</span>`).join('')}</div>` : '';

    return `
      <div class="scrim${over ? ' scrim-top' : ''}" data-action="close-drawer"></div>
      <aside class="drawer${over ? ' drawer-top' : ''}" role="dialog" aria-label="${esc(fullName(c))}">
        <div class="drawer-head">
          <div class="dh-top">
            <div style="min-width:0">
              <div class="tag-row mb-8">${c.contactType
                ? `<span class="chip tier-high">${esc(c.contactType)}</span>`
                : `<span class="chip tier-low">${U().icon('person', 'ic-inline')} Contact</span>`}</div>
              <h2>${esc(fullName(c))}</h2>
              <div class="dh-sub">${esc([
                c.preferredName && c.preferredName.trim() !== (c.firstName || '').trim() ? 'Goes by ' + c.preferredName : '',
                [c.title, c.employer].filter(Boolean).join(' at '),
                c.relationship || ''
              ].filter(Boolean).join(' · ') || 'No details on file')}</div>
            </div>
            <div class="flex" style="gap:8px;flex:none">
              <button class="drawer-edit" data-action="ct-panel-open" data-id="${esc(c.id)}"
                title="Leave this window and open the full record">Open →</button>
              <button class="drawer-close" data-action="close-drawer" aria-label="Close">✕</button>
            </div>
          </div>
        </div>
        <div class="drawer-body">
          ${block('Reach them', null, reach + (() => {
            const a = H().addressFor(c);
            if (!a.addr) return '';
            return `<div class="list-row"><span class="grow" style="min-width:0">
              <span class="cell-sub" style="display:block">Mailing address${
                a.from === 'household' ? ' · from the household' : ''}</span>
              <span style="font-size:var(--fs-dense);color:var(--ink)">${esc(H().addrLine(a.addr))}</span></span></div>`;
          })())}
          ${block('Opportunities', cases.length, caseRows)}
          ${block('Details', null,
            line('Household', h ? `<button class="btn-link" data-action="hh-panel" data-id="${esc(h.id)}">${esc(h.name)}</button>` : '—')
            + line('Advisor', esc(adv || '—'))
            + line('Contact type', esc(c.contactType || '—'))
            + line('Relationship', esc(c.relationship || '—'))
            + line('Date of birth', esc(c.dob ? U().fmtDate(c.dob) : '—')))}
          ${tags ? block('Tags', null, tags) : ''}
          ${c.notes ? block('Notes', null, `<div class="hm-note-body" style="padding:var(--pad-cell)">${U().noteHtml(c.notes)}</div>`) : ''}
        </div>
      </aside>`;
  }

  /* Everything that offers "View contact" resolves the person the same
     way: the contact on the record, else the household's primary client.
     Most of the migrated book is pointed at a household, so without the
     fallback the button would be missing exactly where it is needed. */
  function contactFor(kind, id) {
    if (!H().isStarted()) return null;
    if (kind === 'contact') return H().contact(id);
    if (kind === 'household') return H().primaryContact(id);
    if (kind === 'case') {
      const sd = RWG.scorecardData;
      const x = sd && sd.isStarted() ? sd.caseById(id) : null;
      if (!x) return null;
      return (x.contactId && H().contact(x.contactId))
        || (x.householdId && H().primaryContact(x.householdId)) || null;
    }
    return null;
  }
  // One door, so a panel raised from a task and one raised from an
  // opportunity are the same panel with the same behaviour.
  RWG.contactPanel = function (kind, id) {
    const c = contactFor(kind, id);
    if (!c) { U().toast('No contact on this record yet'); return false; }
    if (!RWG.app.openPanel) { RWG.app.nav('contact'); return false; }
    const m1 = document.getElementById('modal-mount');
    const m2 = document.getElementById('modal-mount-2');
    const over = !!((m1 && m1.firstElementChild) || (m2 && m2.firstElementChild));
    RWG.app.openPanel(contactPanelHtml(c, over));
    return true;
  };

  function contactHtml(c, user, ctx) {
    const h = hhOf(c);
    // Every way to reach them, each wearing the label it was filed under.
    const tag = (l) => l ? `<span class="cell-sub" style="margin-left:6px;font-size:11px">${esc(l)}</span>` : '';
    const phone = H().phonesOf(c).map(w =>
      `<div><a href="tel:${esc(w.v.replace(/[^\d+]/g, ''))}">${esc(fmtPhone(w.v))}</a>${tag(w.label)}</div>`).join('');
    const email = H().emailsOf(c).map(w =>
      `<div><a href="mailto:${esc(w.v)}">${esc(w.v)}</a>${tag(w.label)}</div>`).join('');
    return `
      <button class="btn btn-quiet btn-sm" data-action="ct-back" style="margin-bottom:var(--s3)">← ${esc(backLabel())}</button>
      <div class="card" style="margin-bottom:var(--panel-gap)">
        <div class="flex" style="gap:var(--s3);align-items:flex-start;flex-wrap:wrap">
          ${U().avatar({ name: fullName(c) }, 54)}
          <div style="min-width:0">
            <h3 style="font-size:var(--fs-title)">${esc(fullName(c))}</h3>
            ${c.preferredName && c.preferredName.trim() !== (c.firstName || '').trim()
              ? `<div class="cell-sub" style="color:var(--gold);font-weight:600">Goes by ${esc(c.preferredName)}</div>` : ''}
            <div class="cell-sub">${esc([c.title, c.employer].filter(Boolean).join(' at ') || c.relationship || '')}</div>
            <div class="tag-row" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px">
              ${h ? `<button class="pill-soft" style="cursor:pointer" data-action="hh-panel" data-id="${esc(h.id)}"
                title="See the household beside this record">${U().icon('household', 'ic-inline')} ${esc(h.name)}</button>` : ''}
              ${c.contactType ? `<span class="chip tier-high" style="font-weight:700">${esc(c.contactType)}</span>` : ''}
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
          <!-- What is open, then what is owed on it: Upcoming Activity reads
               as the follow-through on the opportunities right above it. -->
          ${oppsCard(c)}${upcomingCard(c)}${detailsCard(c)}${wfCard(c)}${peopleCard(c)}${historyCard(c)}
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
    /* Employers, most-represented first, each carrying its count — the
       answer to "how many people do we have at Miami-Dade County" is the
       dropdown itself, and picking one narrows the book to them. */
    const emps = H().allEmployers();
    if (st.employer && !emps.some(e => e.employer.toLowerCase() === st.employer.toLowerCase())) {
      emps.push({ employer: st.employer, count: 0 });
    }
    const empOpts = emps.map(e =>
      `<option value="${esc(e.employer)}" ${st.employer.toLowerCase() === e.employer.toLowerCase() ? 'selected' : ''}>${esc(e.employer)} · ${e.count}</option>`).join('');

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

    const filtered = st.q || st.tag || st.advisor || st.employer || (!isHH && st.rel);

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
            ${sortBtn('seen', 'Last opened')}${sortBtn('az', 'A–Z')}${sortBtn('za', 'Z–A')}${sortBtn('recent', 'Edited')}${sortBtn('created', 'Newest')}
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
          ${isHH ? '' : `<select id="ct-employer" title="Employers in the book, with how many people each"><option value="">Any employer</option>${empOpts}</select>`}
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
      if (e.target.id === 'ct-employer') { st.employer = e.target.value; RWG.app.renderMain(); }
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
        markSeen(c.id);
        st.currentId = c.id;
        st.tab = 'note';
        const m = document.getElementById('modal-mount'); if (m) m.innerHTML = '';
        RWG.app.nav('contact');
      },
      // Raise the panel from anywhere: a task, an opportunity, a list row.
      'ct-panel': (el) => { RWG.contactPanel(el.dataset.kind || 'contact', el.dataset.id); },
      // ...and leave for the full record when the lookup is not enough.
      'ct-panel-open': (el) => {
        const m2 = document.getElementById('modal-mount-2'); if (m2) m2.innerHTML = '';
        const own = RWG.modules.get('contacts');
        if (own) own.actions['ct-open'](el, null);
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
      'ct-employer': (el) => {
        st.employer = el.dataset.employer || '';
        st.scope = 'people';
        st.currentId = null;
        RWG.app.nav('contacts');
      },
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
        const head = ['First name', 'Last name', 'Preferred name', 'Contact type', 'Relationship', 'Phones', 'Emails', 'Date of birth',
          'Street', 'Apt / Unit', 'City', 'State', 'ZIP', 'Address from',
          'Employer', 'Plan type', 'Years of service', 'AFC', 'Tags', 'Household', 'Advisor', 'AdvisorStream'];
        const data = list.map(c => {
          const h = hhOf(c);
          const wayList = (ws) => ws.map(w => w.v + (w.label ? ' (' + w.label + ')' : '')).join('; ');
          // Split into columns, not one string: a mail merge wants fields.
          const a = H().addressFor(c), ad = a.addr || {};
          return [c.firstName || '', c.lastName || '', c.preferredName || '', c.contactType || '', c.relationship || '',
            wayList(H().phonesOf(c)), wayList(H().emailsOf(c)),
            c.dob || '', ad.line1 || '', ad.line2 || '', ad.city || '', ad.state || '', ad.zip || '',
            a.from === 'household' ? 'household' : (a.from || ''),
            c.employer || '', c.planType || '', c.yos == null ? '' : c.yos,
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
