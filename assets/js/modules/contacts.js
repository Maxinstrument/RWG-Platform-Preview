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
  const st = { q: '', sort: 'az', tag: '', advisor: '', rel: '', scope: 'people' };

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
          <span class="hh-badge">🏠</span>
          <span style="min-width:0">
            <span class="cell-name" style="display:block">${esc(h.name)}</span>
            <span class="cell-sub">${esc(h.source || '')}</span>
          </span>
        </div>
      </td>
      <td>${prim ? esc(H().contactName(prim)) : dash}</td>
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
      ? `<div class="empty" style="padding:48px 16px"><div class="ec">🏠</div>
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
          <span class="t" style="font-size:17px">Contacts</span>
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
          ${isHH ? `<button class="btn btn-ghost btn-sm" data-action="hh-convert-pick">Convert a lead ✦</button>` : ''}
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
    nav: [{ view: 'contacts', label: 'Contacts', icon: 'person', also: ['households', 'household'] }],
    meta: { contacts: { t: 'Contacts', s: 'Every person in the book' } },
    state: st,

    home: {
      tile: () => ({
        icon: 'person', title: 'Contacts',
        desc: 'Every person in the book — search, tag and slice the whole list.',
        view: 'contacts'
      })
    },

    onEnter() {
      const me = RWG.auth.currentUser();
      if (!H().isStarted()) H().init(me, RWG.app.renderMain);
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
      // Open a person: the person. The person form is owned by Households —
      // one place a human is edited from — so this hands off to it. A phone
      // or email link inside the row is a real link and must win over the row.
      'ct-open': (el, e) => {
        if (e && e.target && e.target.closest && e.target.closest('a[href]')) return;
        const c = H().contact(el.dataset.id);
        if (!c) return;
        const hhm = RWG.modules.get('households');
        if (hhm) hhm.actions['hh-person-edit']({ dataset: { id: c.id } }, e);
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
      return screenHtml(user, ctx);
    }
  });
})();
