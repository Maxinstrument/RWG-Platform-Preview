/* ============================================================
   RWG CRM — small UI helpers (formatting + reusable HTML bits)
   ============================================================ */
window.RWG = window.RWG || {};
RWG.ui = (function () {

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const money = (n) => n == null || n === '' ? '—' : '$' + Number(n).toLocaleString('en-US');
  const moneyK = (n) => n == null || n === '' ? '—' : '$' + Math.round(Number(n) / 1000) + 'k';

  const initials = (name) => (name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

  function fmtDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function fmtDateTime(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function fmtRelative(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts, day = 86400000;
    const d = Math.floor(diff / day);
    if (d <= 0) {
      const h = Math.floor(diff / 3600000);
      if (h <= 0) return 'just now';
      return h + 'h ago';
    }
    if (d === 1) return 'yesterday';
    if (d < 7) return d + 'd ago';
    return fmtDate(ts);
  }

  function avatar(user, size) {
    if (!user) return '';
    const s = size || 32;
    return `<span class="avatar" style="width:${s}px;height:${s}px;font-size:${Math.round(s * 0.4)}px;background:${user.color || '#0E2440'}">${esc(initials(user.name))}</span>`;
  }

  const tierFill = { GOLD: '#C2A14D', HIGH: '#2E7D5B', MEDIUM: '#B0691F', LOW: '#5C6B7E' };

  function tierChip(scoreObj, withNum) {
    const m = RWG.scoring.tierMeta[scoreObj.tier];
    return `<span class="chip ${m.cls}"><span class="tier-dot ${m.dot}"></span>${m.label}${withNum ? ' · ' + scoreObj.score : ''}</span>`;
  }
  function scoreBar(scoreObj) {
    const c = tierFill[scoreObj.tier];
    return `<span class="score-bar"><span class="track"><span class="fill" style="width:${scoreObj.score}%;background:${c}"></span></span><span class="num" style="font-size:12px;color:var(--muted);font-weight:700">${scoreObj.score}</span></span>`;
  }
  function stageChip(stage) {
    return `<span class="stage-chip ${RWG.data.stageClass[stage] || ''}">${esc(stage)}</span>`;
  }

  // Callback flag: detected from the "CALLBACK REQUESTED" marker in notes (or an explicit field),
  // so it works on import without an extra column. Kept separate from the quality tier.
  function isCallback(l) {
    return !!(l && (l.callbackRequested || /callback requested/i.test(l.notes || '')));
  }
  function callbackChip(l) {
    return isCallback(l)
      ? `<span class="chip chip-callback" title="This person asked us to call them to schedule an appointment">${icon('phone','ic-inline')} Callback</span>`
      : '';
  }

  // Clicked-but-never-registered cohort: detected from the "did not sign up" marker in notes
  // (or an explicit field). Lets agents tell these apart from people who actually signed up.
  function isClickedNoSignup(l) {
    return !!(l && (l.clickedNoSignup || /did not sign up/i.test(l.notes || '')));
  }
  function clickedChip(l) {
    return isClickedNoSignup(l)
      ? `<span class="chip chip-clicked" title="Clicked the seminar invite but did not register">👀 Clicked, no signup</span>`
      : '';
  }

  function ring(percent, big, small) {
    const r = 54, c = 2 * Math.PI * r, off = c * (1 - Math.min(1, percent / 100));
    return `<div class="ring"><svg width="128" height="128" viewBox="0 0 128 128">
      <circle cx="64" cy="64" r="${r}" fill="none" stroke="rgba(14,36,64,.10)" stroke-width="12"/>
      <circle cx="64" cy="64" r="${r}" fill="none" stroke="url(#goldgrad)" stroke-width="12" stroke-linecap="round"
        stroke-dasharray="${c}" stroke-dashoffset="${off}" style="transition:stroke-dashoffset .8s cubic-bezier(.2,.8,.2,1)"/>
      <defs><linearGradient id="goldgrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#C2A14D"/><stop offset="1" stop-color="#D8BC78"/></linearGradient></defs>
    </svg><div class="ring-center"><span class="big">${big}</span><span class="small">${small}</span></div></div>`;
  }

  /* ── Icons ─────────────────────────────────────────────────
     One set, stored as path data only. The <svg> wrapper is built
     here, so every icon in the app is guaranteed the same viewBox,
     the same fill and the same stroke weight — a drifted
     stroke-width is not expressible.

     These are drawn in the product's own line weight and inherit
     currentColor, which is the whole reason they beat the colour
     emoji they replace: an emoji is somebody else's artwork at
     somebody else's weight, and on Windows it renders larger and
     brighter than the navy text beside it. ─────────────────── */
  const ICON_PATHS = {
    book:      '<path d="M12 6.6C10.6 5.1 8.6 4.5 6 4.5H3.2v13H6c2.6 0 4.6.6 6 2"/><path d="M12 6.6c1.4-1.5 3.4-2.1 6-2.1h2.8v13H18c-2.6 0-4.6.6-6 2"/><line x1="12" y1="6.6" x2="12" y2="19.5"/>',
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    leads:     '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1.2"/><circle cx="3.5" cy="12" r="1.2"/><circle cx="3.5" cy="18" r="1.2"/>',
    team:      '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 4.5a3.2 3.2 0 0 1 0 7"/><path d="M18 20c0-2.5-1-4.5-2.5-5.6"/>',
    upload:    '<path d="M12 16V5"/><path d="M8 9l4-4 4 4"/><path d="M5 19h14"/>',
    settings:  '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
    archive:   '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>',
    reports:   '<rect x="3.5" y="3" width="17" height="18" rx="2"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
    board:     '<rect x="3" y="4" width="5" height="16" rx="1.3"/><rect x="9.5" y="4" width="5" height="11" rx="1.3"/><rect x="16" y="4" width="5" height="14" rx="1.3"/>',
    today:     '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/>',
    stats:     '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
    logout:    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
    home:      '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V9.5"/>',
    scorecard: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    cases:     '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    club:      '<circle cx="12" cy="9" r="5.5"/><path d="M8.5 13.5 7 22l5-2.6L17 22l-1.5-8.5"/>',
    person:    '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.5c0-3.9 3.4-6.8 7.5-6.8s7.5 2.9 7.5 6.8"/>',
    search:    '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>',

    /* The five that replace colour emoji. A household is a house with
       people in it — deliberately not the same drawing as `home`,
       which is the dashboard. */
    household: '<path d="M3.5 10.8 12 4l8.5 6.8"/><path d="M5.8 9.8V19a1 1 0 0 0 1 1h10.4a1 1 0 0 0 1-1V9.8"/><circle cx="9.8" cy="14.6" r="1.4"/><circle cx="14.2" cy="14.6" r="1.4"/>',
    /* A workflow is a branch, not a cog. The gear it replaces already
       means Settings, and one glyph cannot mean two things. */
    workflow:  '<circle cx="5.5" cy="6" r="2.4"/><circle cx="5.5" cy="18" r="2.4"/><circle cx="18.5" cy="12" r="2.4"/><path d="M7.9 6h4.6a3.5 3.5 0 0 1 3.5 3.5v.4M7.9 18h4.6a3.5 3.5 0 0 0 3.5-3.5v-.4"/>',
    service:   '<path d="M15.6 3.4a4.6 4.6 0 0 0-4.1 6.7l-7 7a2.1 2.1 0 0 0 3 3l7-7a4.6 4.6 0 0 0 5.7-6l-2.7 2.7-2.5-.7-.7-2.5z"/>',
    phone:     '<path d="M6.4 3.6h3.1l1.5 3.9-2 1.5a12.2 12.2 0 0 0 6 6l1.5-2 3.9 1.5v3.1a2 2 0 0 1-2.2 2A16.6 16.6 0 0 1 4.4 5.8a2 2 0 0 1 2-2.2z"/>',
    /* The conversion mark: a lead becoming a client family. */
    spark:     '<path d="M12 2.8 14 10l7.2 2-7.2 2-2 7.2-2-7.2-7.2-2 7.2-2z"/>'
  };

  // cls: 'ic-sm' inside running text, 'ic-lg' for an empty state.
  function icon(name, cls) {
    const p = ICON_PATHS[name];
    if (!p) return '';
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none"'
      + ' stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"'
      + ' aria-hidden="true" focusable="false">' + p + '</svg>';
  }

  /* Where a record pointer goes when you click it. A task, note or request
     can point at a contact, an opportunity, a household or a lead, and any
     of them can be re-pointed after the fact — so every screen that renders
     a pointer reads the destination from here rather than assuming. */
  const REL_ACTION = { contact: 'ct-open', case: 'cs-open', household: 'hh-goto', lead: 'open-lead' };
  const REL_ICON = { contact: 'person', case: 'cases', household: 'household' };
  const relAction = (type) => REL_ACTION[type] || '';
  const relIcon = (type, cls) => (REL_ICON[type] ? icon(REL_ICON[type], cls) : '');

  /* ── The record picker: type to find it, or make it ────────
     "Related to" used to be a select holding every contact, every
     opportunity and every household in the book. That is a list you
     scroll, not a question you answer, and it only gets worse as the
     book grows. This is one box: type a few letters, see what matches
     across the kinds this particular field accepts, and — when the
     person or the opportunity is not in the book yet — make it from
     the same box instead of abandoning the form to go create it
     first and come back.

     The hidden input is the answer. Typed text is only a query and
     never becomes a selection on its own, which is what stops a
     half-typed name being saved as a pointer to nothing. Leave the
     box with words still in it and it snaps back to whatever you
     actually chose; empty it and the pointer clears. */

  const PICK = {};                        // id → live config, one per mounted picker
  const PICK_GROUP = { contact: 'Contacts', case: 'Opportunities', household: 'Households' };
  const PICK_ONE   = { contact: 'contact',  case: 'opportunity',   household: 'household' };
  const PICK_CAP = 6;                     // per kind, before "keep typing"

  const pkHH = () => (RWG.hh && RWG.hh.isStarted()) ? RWG.hh : null;
  const pkSD = () => (RWG.scorecardData && RWG.scorecardData.isStarted()) ? RWG.scorecardData : null;
  const pkCaseLabel = (x) => x.title
    || [x.clientName, RWG.scorecard ? RWG.scorecard.productName(x.product) : ''].filter(Boolean).join(' · ')
    || 'Opportunity';

  /* What a pointer means for the two carry-along ids, and what it reads as
     on screen. The contact is the one that matters; the household is
     derived from the person, never asked for twice. */
  function pickResolve(type, id) {
    const none = { type: null, id: null, label: '', sub: '', contactId: null, householdId: null };
    if (!type || !id) return none;
    const H = pkHH();
    if (type === 'contact') {
      const c = H && H.contact(id); if (!c) return none;
      const hh = c.householdId ? H.household(c.householdId) : null;
      return { type: 'contact', id: c.id, label: H.contactName(c) || '(no name)',
        sub: hh ? hh.name : (c.email || c.phone || ''),
        contactId: c.id, householdId: c.householdId || null };
    }
    if (type === 'case') {
      const SD = pkSD(); const x = SD && SD.caseById(id); if (!x) return none;
      return { type: 'case', id: x.recordId, label: pkCaseLabel(x),
        sub: [x.clientName, x.closedAt ? 'closed' : ''].filter(Boolean).join(' · '),
        contactId: x.contactId || null, householdId: x.householdId || null };
    }
    if (type === 'household') {
      const h = H && H.household(id); if (!h) return none;
      const n = H.contactsFor(h.id).length;
      return { type: 'household', id: h.id, label: h.name,
        sub: n ? n + (n === 1 ? ' person' : ' people') : 'no people yet',
        contactId: null, householdId: h.id };
    }
    return none;
  }

  /* A word starting with what you typed beats the same letters buried in
     the middle — typing "ma" should find Maria before Guzman. */
  function pkRank(hay, q) {
    const s = String(hay || '').toLowerCase();
    if (!q) return 2;
    if (s.indexOf(q) === 0) return 0;
    if (new RegExp('\\b' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(s)) return 1;
    return s.indexOf(q) >= 0 ? 2 : -1;
  }
  function pickSearch(type, q, cap) {
    q = String(q || '').trim().toLowerCase();
    const H = pkHH(), SD = pkSD(), out = [];
    const push = (rec, hay) => {
      const r = pkRank(hay, q); if (r < 0) return;
      out.push({ rec: rec, r: r });
    };
    if (type === 'contact' && H) {
      H.contacts().forEach(c => {
        const rec = pickResolve('contact', c.id); if (!rec.type) return;
        push(rec, [rec.label, c.email, c.phone, rec.sub].filter(Boolean).join(' '));
      });
    } else if (type === 'household' && H) {
      H.households().forEach(h => push(pickResolve('household', h.id), h.name));
    } else if (type === 'case' && SD) {
      SD.cases().filter(x => !x.deletedAt).forEach(x => {
        const rec = pickResolve('case', x.recordId); if (!rec.type) return;
        push(rec, [rec.label, x.clientName].filter(Boolean).join(' '));
      });
    }
    out.sort((a, b) => a.r - b.r || a.rec.label.localeCompare(b.rec.label));
    const rows = out.map(o => o.rec);
    return { rows: rows.slice(0, cap == null ? PICK_CAP : cap), total: rows.length };
  }

  /* Creating from the box. A contact is never left without a family — the
     same rule the person window follows — so a brand-new name with nowhere
     to go gets a household of its own and stands as its primary client. An
     opportunity has to guess a product, and the toast says which. */
  function pickMake(type, name, ctx) {
    const H = pkHH(), me = RWG.auth.currentUser();
    ctx = ctx || {};
    if (!name) return Promise.resolve(null);
    if (type === 'contact') {
      if (!H) return Promise.resolve(null);
      const parts = name.split(/\s+/);
      const firstName = parts.shift() || name;
      const lastName = parts.join(' ');
      let hhId = ctx.householdId || null, rel = 'Other';
      if (!hhId) {
        const h = H.addHousehold({ name: (lastName || firstName) + ' Household',
          advisorUid: me.id, advisorName: me.name || '' });
        hhId = h.id; rel = 'Primary client';
      }
      const c = H.addContact({ householdId: hhId, firstName: firstName, lastName: lastName, relationship: rel });
      return Promise.resolve(pickResolve('contact', c.id));
    }
    if (type === 'household') {
      if (!H) return Promise.resolve(null);
      const h = H.addHousehold({ name: name, advisorUid: me.id, advisorName: me.name || '' });
      return Promise.resolve(pickResolve('household', h.id));
    }
    if (type === 'case') {
      const SD = pkSD(); if (!SD) return Promise.resolve(null);
      const ctc = ctx.contactId && H ? H.contact(ctx.contactId) : null;
      return SD.saveCase({
        agentUid: me.id, agentName: me.name || '',
        clientName: ctc ? H.contactName(ctc) : name,
        product: 'wl', state: 'Opened', title: name, stageId: 'uncovered',
        contactId: (ctc && ctc.id) || null,
        householdId: (ctc && ctc.householdId) || ctx.householdId || null
      }).then(row => pickResolve('case', row.recordId));
    }
    return Promise.resolve(null);
  }

  // ── the menu ──
  function pickMenu(cfg) {
    const box = document.getElementById(cfg.id + '-in');
    const typed = String((box && box.value) || '').trim();
    cfg.rows = [];
    let html = '';
    cfg.types.forEach(t => {
      const found = pickSearch(t, typed, PICK_CAP);
      if (!found.rows.length) return;
      html += '<div class="pick-head">' + esc(PICK_GROUP[t] || t) + '</div>';
      found.rows.forEach(rec => {
        const i = cfg.rows.push(rec) - 1;
        html += '<button type="button" class="pick-row" data-i="' + i + '" role="option">'
          + '<span class="t">' + relIcon(rec.type, 'ic-inline') + ' ' + esc(rec.label) + '</span>'
          + (rec.sub ? '<span class="s">' + esc(rec.sub) + '</span>' : '') + '</button>';
      });
      if (found.total > found.rows.length)
        html += '<div class="pick-more">' + (found.total - found.rows.length) + ' more — keep typing</div>';
    });
    (typed ? cfg.create : []).forEach(t => {
      const i = cfg.rows.push({ make: t, label: typed }) - 1;
      html += '<button type="button" class="pick-row pick-new" data-i="' + i + '" role="option">'
        + '<span class="t">＋ New ' + esc(PICK_ONE[t] || t) + ' <b>' + esc(typed) + '</b></span></button>';
    });
    if (!html) html = '<div class="pick-empty">'
      + (typed ? 'Nothing matches “' + esc(typed) + '”' : 'Start typing a name') + '</div>';
    const menu = document.getElementById(cfg.id + '-menu');
    if (!menu) return;
    menu.innerHTML = html;
    cfg.at = cfg.rows.length ? 0 : -1;
    pickMark(cfg);
  }
  function pickMark(cfg) {
    const menu = document.getElementById(cfg.id + '-menu'); if (!menu) return;
    const rows = menu.querySelectorAll('.pick-row');
    for (let i = 0; i < rows.length; i++) rows[i].classList.toggle('is-on', i === cfg.at);
    const on = rows[cfg.at];
    if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  }
  /* The modal body scrolls, so a menu flowed inside it would be clipped at
     the fold. So: fixed, placed against the box each time it opens, flipped
     above when there is more room up there than down.

     "Fixed" is a promise CSS does not always keep. Any ancestor carrying a
     transform, a filter or will-change becomes the containing block for its
     fixed descendants, and then viewport coordinates land somewhere else
     entirely — which is how this menu first appeared halfway across the
     screen, inside a modal that centred itself with translateX(-50%). That
     modal now centres with auto margins, but the drawer still declares
     will-change:transform and the next component might too. Rather than
     depend on every ancestor forever, place it, measure where it actually
     went, and correct by the difference. */
  function pickPlace(cfg) {
    const wrap = document.getElementById(cfg.id + '-wrap');
    const menu = document.getElementById(cfg.id + '-menu');
    if (!wrap || !menu || menu.hidden || !wrap.getBoundingClientRect) return;
    const r = wrap.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12, above = r.top - 12;
    const up = below < 200 && above > below;
    menu.style.bottom = 'auto';
    menu.style.width = r.width + 'px';
    menu.style.maxHeight = Math.max(140, Math.min(340, up ? above : below)) + 'px';
    if (!menu.getBoundingClientRect) return;
    menu.style.left = r.left + 'px';
    menu.style.top = '0px';
    const m = menu.getBoundingClientRect();          // where that actually put it
    const want = up ? (r.top - 6 - m.height) : (r.bottom + 6);
    menu.style.left = (r.left - (m.left - r.left)) + 'px';
    menu.style.top = (want - m.top) + 'px';
  }
  function pickOpen(cfg) {
    const menu = document.getElementById(cfg.id + '-menu');
    const inp = document.getElementById(cfg.id + '-in');
    if (!menu) return;
    menu.hidden = false;
    if (inp) inp.setAttribute('aria-expanded', 'true');
    pickMenu(cfg); pickPlace(cfg);
  }
  function pickClose(cfg) {
    const menu = document.getElementById(cfg.id + '-menu');
    const inp = document.getElementById(cfg.id + '-in');
    if (menu) menu.hidden = true;
    if (inp) inp.setAttribute('aria-expanded', 'false');
    cfg.at = -1;
  }
  function pickCommit(cfg, rec) {
    const hid = document.getElementById(cfg.id);
    const inp = document.getElementById(cfg.id + '-in');
    cfg.rec = (rec && rec.type) ? rec : null;
    if (hid) hid.value = cfg.rec ? cfg.rec.type + ':' + cfg.rec.id : '';
    if (inp) inp.value = cfg.rec ? cfg.rec.label : '';
    pickClose(cfg);
    if (cfg.onPick) cfg.onPick(cfg.rec);
  }
  function pickChoose(cfg, i) {
    const row = cfg.rows[i]; if (!row) return;
    if (!row.make) { pickCommit(cfg, row); return; }
    const ctx = (typeof cfg.context === 'function' ? cfg.context() : cfg.context) || {};
    const inp = document.getElementById(cfg.id + '-in');
    if (inp) inp.disabled = true;
    Promise.resolve(pickMake(row.make, row.label, ctx)).then(rec => {
      if (inp) { inp.disabled = false; inp.focus(); }
      if (!rec || !rec.type) { toast('Could not create that — the book is still loading'); return; }
      pickCommit(cfg, rec);
      toast(row.make === 'case'
        ? 'Opportunity opened on Whole Life — set the product and the numbers when you have them'
        : 'New ' + (PICK_ONE[row.make] || row.make) + ' created', true);
    }).catch(e => {
      if (inp) inp.disabled = false;
      console.error('picker create:', e && e.message);
      toast('Could not create that');
    });
  }

  /* Markup half. The hidden input keeps the same id the old select had, so
     every caller still reads its answer with document.getElementById. */
  function pickerHtml(o) {
    const rec = pickResolve(o.type || null, o.recordId || null);
    const dis = o.disabled ? ' disabled' : '';
    return '<div class="pick" id="' + esc(o.id) + '-wrap">'
      + '<input class="pick-in" id="' + esc(o.id) + '-in" type="text" autocomplete="off" spellcheck="false"'
      + ' role="combobox" aria-autocomplete="list" aria-expanded="false"'
      + ' aria-controls="' + esc(o.id) + '-menu" value="' + esc(rec.label) + '"'
      + ' placeholder="' + esc(o.placeholder || 'Type a name to search…') + '"' + dis + '>'
      + (o.disabled ? '' : '<button type="button" class="pick-clear" data-pick-clear="' + esc(o.id)
          + '" title="Clear" aria-label="Clear">✕</button>')
      + '<input type="hidden" id="' + esc(o.id) + '" value="'
      + (rec.type ? esc(rec.type + ':' + rec.id) : '') + '">'
      + '<div class="pick-menu" id="' + esc(o.id) + '-menu" role="listbox" hidden></div>'
      + '</div>';
  }

  /* Wiring half, called once the markup is on screen. Listeners hang off
     the picker's own nodes, so they die with the modal — and Escape is
     caught here, before it can bubble to the handler that would close the
     whole window out from under a half-finished search. */
  function pickerInit(o) {
    const cfg = PICK[o.id] = {
      id: o.id,
      types: o.types || ['contact'],
      create: o.create === false ? [] : (o.create || o.types || ['contact']),
      context: o.context || {},
      onPick: o.onPick || null,
      rec: null, rows: [], at: -1
    };
    const start = pickResolve(o.type || null, o.recordId || null);
    if (start.type) cfg.rec = start;
    const inp = document.getElementById(cfg.id + '-in');
    const menu = document.getElementById(cfg.id + '-menu');
    if (!inp || !menu) return cfg;
    if (inp.disabled) return cfg;
    pickWatch();
    const isOpen = () => !menu.hidden;

    inp.addEventListener('focus', () => pickOpen(cfg));
    inp.addEventListener('input', () => { if (!isOpen()) pickOpen(cfg); else { pickMenu(cfg); pickPlace(cfg); } });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (isOpen()) { e.preventDefault(); e.stopPropagation(); pickClose(cfg); }
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!isOpen()) { pickOpen(cfg); return; }
        if (!cfg.rows.length) return;
        cfg.at = (cfg.at + (e.key === 'ArrowDown' ? 1 : -1) + cfg.rows.length) % cfg.rows.length;
        pickMark(cfg); return;
      }
      if (e.key === 'Enter') {
        if (isOpen() && cfg.at >= 0) { e.preventDefault(); e.stopPropagation(); pickChoose(cfg, cfg.at); }
        return;
      }
      if (e.key === 'Tab' && isOpen()) pickClose(cfg);
    });
    // Typed words are a query, not an answer: leaving with words still in
    // the box snaps back to what was actually chosen, and leaving it empty
    // clears the pointer.
    inp.addEventListener('blur', () => setTimeout(() => {
      const now = document.getElementById(cfg.id + '-in');
      if (!now || document.activeElement === now) return;
      pickClose(cfg);
      if (!now.value.trim()) { if (cfg.rec) pickCommit(cfg, null); }
      else now.value = cfg.rec ? cfg.rec.label : '';
    }, 140));
    // mousedown, not click: the blur above must not beat the choice to it
    menu.addEventListener('mousedown', (e) => {
      const row = e.target.closest ? e.target.closest('.pick-row') : null;
      if (!row) return;
      e.preventDefault(); pickChoose(cfg, Number(row.dataset.i));
    });
    return cfg;
  }
  function pickerValue(id) {
    const el = document.getElementById(id);
    const v = el ? String(el.value || '') : '';
    const i = v.indexOf(':');
    return i < 0 ? { type: null, id: null } : { type: v.slice(0, i), id: v.slice(i + 1) };
  }
  // What the field points at right now, fully resolved.
  const pickerRec = (id) => { const p = pickerValue(id); return pickResolve(p.type, p.id); };
  const pickerMounted = (id) => !!document.getElementById(id + '-wrap');

  /* Call this before saving a form that holds a picker. The classic combobox
     trap is typing a name, never choosing it, and pressing Save — the words
     look like an answer but the pointer is still whatever it was before, so
     the work quietly attaches to the wrong record. Blur snaps the box back,
     but a Save closes the window before anyone sees it happen. So: an empty
     box means "clear it", a box that reads as the chosen record is settled,
     and anything else stops the save and says why. */
  function pickerSettle(id) {
    const inp = document.getElementById(id + '-in');
    if (!inp || inp.disabled) return true;
    const typed = String(inp.value || '').trim();
    const rec = pickerRec(id);
    if (typed === (rec.label || '')) return true;
    if (!typed) {
      const cfg = PICK[id];
      if (cfg) pickCommit(cfg, null);
      else { const h = document.getElementById(id); if (h) h.value = ''; }
      return true;
    }
    toast('Pick “' + typed + '” from the list, or make it — or clear the box');
    inp.focus();
    return false;
  }

  document.addEventListener('mousedown', (e) => {
    if (!e.target || !e.target.closest) return;
    const clr = e.target.closest('[data-pick-clear]');
    if (clr) {
      e.preventDefault();
      const cfg = PICK[clr.dataset.pickClear];
      if (cfg) { pickCommit(cfg, null); const i = document.getElementById(cfg.id + '-in'); if (i) i.focus(); }
      return;
    }
    if (e.target.closest('.pick')) return;
    Object.keys(PICK).forEach(k => {
      const m = document.getElementById(k + '-menu');
      if (m && !m.hidden) pickClose(PICK[k]);
    });
  });
  // A fixed menu cannot follow a scroll on its own. Wired the first time a
  // picker is actually mounted rather than at load, so a page with no
  // picker on it carries no scroll listener.
  let pickWatching = false;
  function pickWatch() {
    if (pickWatching) return;
    pickWatching = true;
    const place = () => Object.keys(PICK).forEach(k => pickPlace(PICK[k]));
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
  }

  /* ── Notes: one editor, everywhere ─────────────────────────
     Every place in the CRM where you write something about a
     person, a family or a case is the same control: a small
     formatting bar over a writing surface. It started life on the
     opportunity window; it lives here now so no screen grows its
     own version of it.

     Insert date stamps the day, the hour AND who stamped it — in a
     book the whole team reads, "8/13/2026" is worth much less than
     "8/13/2026 2:15 PM · Carlos Temperan". Carlos, Aug '26: the date
     alone tells you the day but not the hour, and on a case that moves
     three times in an afternoon the hour is the whole story — it is
     what puts the carrier's call and your callback in the right order.

     Storage is sanitized HTML. Notes typed before today are plain
     text and stay that way: noteHtml() renders either, so nothing
     needs converting and nothing shows its tags. */

  /* Non-breaking spaces, on the way in.
     Carlos, 21 Aug '26: "when I press Insert Date I see &nbsp; in the
     notes." He was right, and Insert date really was the trigger — the
     stamp ends in a space, and a contenteditable preserves a trailing
     space by turning it into a non-breaking one. Prose has no use for a
     space that refuses to wrap, so it becomes an ordinary space here, and
     the codes stop being written at all. Both spellings: the browser holds
     the character and serializes the entity. */
  const unNbsp = (s) => String(s == null ? '' : s).replace(/&nbsp;/gi, ' ').replace(/\u00a0/g, ' ');

  // Team-internal notes, but still no scripts or handlers in stored HTML.
  function cleanHtml(html) {
    return unNbsp(html)
      .replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
      .replace(/<\s*(script|style|iframe|object|embed)[^>]*\/?\s*>/gi, '')
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'>\s]*\2/gi, '$1="#"');
  }

  const HAS_TAG = /<(?:p|div|br|b|i|u|em|strong|ul|ol|li|a|span|h[1-6])\b[^>]*>/i;

  /* Render a stored note: HTML if it is HTML, escaped text if it is not.

     The "is not" branch is where the &nbsp; was surfacing, and it is worth
     saying why, because the rule looks right and is not quite. A note
     typed on one line with no bold, no bullets and no second paragraph
     comes out of the editor as HTML with no TAGS in it — which is most
     task notes. That branch escaped it as though it were something
     somebody had typed by hand, so the "&" of "&nbsp;" became "&amp;" and
     the reader saw the code instead of the space.

     Tag-free HTML is still HTML, so it is decoded first and escaped after.
     The cost is a genuinely old plain-text note that happens to contain
     the letters "&amp;" — it will now render as "&". Nobody writes that
     on purpose in a note about a client; everybody was seeing &nbsp;. */
  const ENT = [[/&nbsp;/gi, ' '], [/&lt;/gi, '<'], [/&gt;/gi, '>'],
               [/&quot;/gi, '"'], [/&#0*39;/g, "'"], [/&apos;/gi, "'"],
               [/&amp;/gi, '&']];   // ampersand last, so one decode cannot feed the next
  function noteHtml(v) {
    const s = String(v == null ? '' : v);
    if (!s.trim()) return '';
    if (HAS_TAG.test(s)) return cleanHtml(s);
    let t = s;
    ENT.forEach(e => { t = t.replace(e[0], e[1]); });
    return esc(t);
  }

  function whoAmI() {
    const u = RWG.auth && RWG.auth.currentUser ? RWG.auth.currentUser() : null;
    return (u && u.name) || '';
  }
  // Built by hand, digit by digit, the same way the date is. toLocaleTimeString
  // would be shorter and would also hand the formatting to whatever locale the
  // browser happens to carry — one machine set to en-GB and half the notes in
  // the book read 15:07. Carlos asked for AM and PM, so AM and PM it is,
  // everywhere, on every machine.
  function dateStamp() {
    const d = new Date();
    const day = (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
    const h24 = d.getHours();
    // The 12-hour clock has no zero: midnight and noon are both 12, and only
    // the meridiem tells them apart. That off-by-twelve is the classic bug here.
    const hour = (h24 % 12) || 12;
    const time = hour + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + (h24 < 12 ? 'AM' : 'PM');
    const who = whoAmI();
    return day + ' ' + time + (who ? ' · ' + who : '') + ' — ';
  }

  /* Today and Tomorrow, beside a date field.
     Carlos, 21 Aug '26: "wherever there is a calendar for dates, I would
     like a Tomorrow in addition to Today." Most due dates are one of those
     two, and both were costing a trip through a date picker to say.

     Deliberately not offered on a date of birth: "tomorrow" is not a thing
     anybody was ever born on, and a shortcut that makes no sense where it
     sits teaches people to stop reading the ones that do.

     Marked when the field already holds that day, so the row doubles as a
     reading of the current value rather than only a way to change it. */
  const dayKey = (ms) => {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  };
  function dateQuick(id, value) {
    const now = Date.now();
    const opts = [[dayKey(now), 'Today'], [dayKey(now + 86400000), 'Tomorrow']];
    return `<div class="dq-row">` + opts.map(o =>
      `<button type="button" class="dq-btn${value === o[0] ? ' is-on' : ''}"
         data-dq="${esc(id)}" data-day="${o[0]}">${o[1]}</button>`).join('') + `</div>`;
  }

  /* Delegated once, like the note toolbar: a date field grows its
     shortcuts wherever it is drawn, with nothing to wire per screen.
     The input event is dispatched by hand because setting .value in code
     does not fire one, and screens that recalculate on a date change
     (a workflow's step dates, say) listen for exactly that. */
  document.addEventListener('click', (e) => {
    const b = (e.target && e.target.closest) ? e.target.closest('.dq-btn') : null;
    if (!b) return;
    e.preventDefault();
    const box = document.getElementById(b.dataset.dq);
    if (!box) return;
    box.value = b.dataset.day;
    const row = b.parentElement;
    if (row) row.querySelectorAll('.dq-btn').forEach(x => x.classList.toggle('is-on', x === b));
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // opts: { id, value, placeholder, editable, minHeight }
  function noteEditor(opts) {
    const o = opts || {};
    const editable = o.editable !== false;
    const tool = (cmd, label, title) =>
      `<button type="button" class="btn btn-quiet btn-sm rt-tool" data-rt="${esc(o.id)}" data-cmd="${cmd}" title="${esc(title)}">${label}</button>`;
    const bar = editable ? `<div class="rt-toolbar">
        ${tool('bold', '<b>B</b>', 'Bold')}${tool('italic', '<i>I</i>', 'Italic')}${tool('underline', '<u>U</u>', 'Underline')}
        ${tool('insertUnorderedList', '•≡', 'Bullet list')}${tool('insertOrderedList', '1≡', 'Numbered list')}
        ${tool('link', '🔗', 'Insert link')}
        <span class="topbar-spacer"></span>
        ${tool('date', 'Insert date', 'Stamp the date, the time and your name')}
      </div>` : '';
    return bar + `<div id="${esc(o.id)}" class="rt-body${editable ? '' : ' rt-ro'}"
        data-ph="${esc(o.placeholder || '')}" ${editable ? 'contenteditable="true"' : ''}
        ${o.minHeight ? `style="min-height:${esc(o.minHeight)}"` : ''}>${noteHtml(o.value)}</div>`;
  }

  // What the person typed. An "empty" contenteditable is rarely empty —
  // browsers leave <br> or <div><br></div> behind — so an editor with no
  // words in it reads back as nothing at all.
  function noteText(id) {
    const el = document.getElementById(id);
    if (!el) return '';
    return String(el.innerText || el.textContent || '').replace(/\u00a0/g, ' ').trim();
  }
  function noteRead(id) {
    const el = document.getElementById(id);
    if (!el) return '';
    return noteText(id) ? cleanHtml(el.innerHTML) : '';
  }

  // Delegated once, here: a toolbar works the moment it is on screen, in
  // a modal or a card, with no per-screen wiring to remember.
  const toolOf = (e) => (e.target && e.target.closest) ? e.target.closest('.rt-tool') : null;
  document.addEventListener('mousedown', (e) => { if (toolOf(e)) e.preventDefault(); });  // keep the selection
  document.addEventListener('click', (e) => {
    const b = toolOf(e); if (!b) return;
    e.preventDefault();
    const ed = document.getElementById(b.dataset.rt); if (!ed) return;
    ed.focus();
    const cmd = b.dataset.cmd;
    if (cmd === 'link') { const url = prompt('Link to:'); if (url) document.execCommand('createLink', false, url); }
    else if (cmd === 'date') document.execCommand('insertText', false, dateStamp());
    else document.execCommand(cmd, false, null);
  });

  // ── CSV out ───────────────────────────────────────────────
  // One implementation, so every screen that exports produces a file
  // Excel opens the same way. Quote only when the cell needs it.
  function csvCell(v) {
    v = (v == null) ? '' : String(v);
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  // rows: array of arrays, first row is the header
  const toCSV = (rows) => rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  function downloadCSV(filename, csv) {
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });   // BOM = Excel reads UTF-8 cleanly
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  // Safe for filenames on every platform we care about.
  const stampName = () => new Date().toISOString().slice(0, 10);

  // Each toast owns its own dismissal. The old code cleared a shared timer
  // it never assigned, so the guard did nothing — and had it worked, a
  // second toast would have cancelled the first one's exit and left it on
  // screen forever. Three at a time is the ceiling; older ones make way.
  const TOAST_MAX = 3;
  function dismissToast(t) {
    if (!t || t.dataset.going) return;
    t.dataset.going = '1';
    clearTimeout(Number(t.dataset.timer));
    t.classList.add('out');
    setTimeout(() => t.remove(), 300);
  }
  function toast(msg, good) {
    let wrap = document.getElementById('toast-wrap');
    if (!wrap) { wrap = document.createElement('div'); wrap.id = 'toast-wrap'; document.body.appendChild(wrap); }
    while (wrap.children.length >= TOAST_MAX) dismissToast(wrap.firstElementChild);
    const t = document.createElement('div');
    t.className = 'toast' + (good ? ' good' : '');
    t.innerHTML = (good ? '✓ ' : '') + esc(msg);
    wrap.appendChild(t);
    t.dataset.timer = String(setTimeout(() => dismissToast(t), 2600));
  }

  /* ── A sortable, column-filtered table ────────────────────
     Three things every table in this app wants: click a header to sort,
     open its ▾ to tick which values to keep, and see at a glance what is
     being narrowed. The popover shell — positioning, outside-click, the
     value search — is already global (.pop-wrap/.pop-panel/.pop-search),
     so what is left is the header, the checklist and the maths, which the
     All Cases table had otherwise written for itself.

     A column is { key, label, val(row), num?, filter?, cell?(row) }. The
     state bag ({ sortKey, sortDir, colf }) stays with the module, so each
     screen keeps its own memory of how it was left; `ns` is the action
     prefix so two tables on one screen never fight. Checkboxes carry
     data-colf, which the module reads in onChange. */
  function sheetValues(list, col) {
    const seen = {}, out = [];
    (list || []).forEach(r => {
      const v = String(col.val(r) == null ? '' : col.val(r));
      if (v === '' || seen[v]) return;
      seen[v] = 1; out.push(v);
    });
    return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }
  function sheetApply(list, cols, st) {
    const by = {}; cols.forEach(c => { by[c.key] = c; });
    const keys = Object.keys(st.colf || {}).filter(k => (st.colf[k] || []).length);
    let out = (list || []).filter(r => keys.every(k => {
      const c = by[k];
      return !c || st.colf[k].indexOf(String(c.val(r))) >= 0;
    }));
    const c = by[st.sortKey];
    if (c) {
      const dir = st.sortDir === 'desc' ? -1 : 1;
      // slice first: sorting the caller's array would reorder the book itself
      out = out.slice().sort((a, b) => (c.num
        ? (Number(c.val(a)) || 0) - (Number(c.val(b)) || 0)
        : String(c.val(a)).localeCompare(String(c.val(b)))) * dir);
    }
    return out;
  }
  function sheetMenu(col, list, st, ns) {
    const sel = (st.colf && st.colf[col.key]) || [];
    const rows = sheetValues(list, col).map(v =>
      `<label class="pop-row"><input type="checkbox" data-colf="${esc(col.key)}" data-val="${esc(v)}" ${sel.indexOf(v) >= 0 ? 'checked' : ''}> ${esc(v)}</label>`).join('');
    return `<button class="th-filter ${sel.length ? 'on' : ''}" data-action="popmenu" data-col="${esc(col.key)}" type="button" aria-label="Filter ${esc(col.label)}">▾</button>
      <div class="pop-panel" hidden>
        <button class="pop-sort" data-action="${ns}-popsort" data-key="${esc(col.key)}" data-dir="asc">↑ Sort ${col.num ? 'low → high' : 'A → Z'}</button>
        <button class="pop-sort" data-action="${ns}-popsort" data-key="${esc(col.key)}" data-dir="desc">↓ Sort ${col.num ? 'high → low' : 'Z → A'}</button>
        <div class="pop-sep"></div>
        <input class="pop-search" type="search" placeholder="Search ${esc(col.label)}…">
        <div class="pop-actions"><button data-action="${ns}-colf-all" data-col="${esc(col.key)}">Select all</button><button data-action="${ns}-colf-clear" data-col="${esc(col.key)}">Clear</button></div>
        <div class="pop-list">${rows || '<div class="muted" style="padding:8px;font-size:12.5px">No values</div>'}</div>
      </div>`;
  }
  function sheetHead(cols, list, st, ns) {
    return '<tr>' + cols.map(c => {
      const arrow = st.sortKey === c.key ? (st.sortDir === 'asc' ? ' ▲' : ' ▼') : '';
      return `<th class="${c.num ? 'num' : ''}${c.filter ? ' pop-wrap' : ''}"><span class="cs-th" data-action="${ns}-sort" data-key="${esc(c.key)}">${esc(c.label)}${arrow}</span>${c.filter ? sheetMenu(c, list, st, ns) : ''}</th>`;
    }).join('') + '</tr>';
  }
  function sheetChips(cols, st, ns) {
    const by = {}; cols.forEach(c => { by[c.key] = c; });
    return Object.keys(st.colf || {}).filter(k => (st.colf[k] || []).length).map(k => {
      const vals = st.colf[k];
      const txt = vals.length === 1 ? vals[0] : vals.length + ' selected';
      return `<span class="filter-chip">${esc(by[k] ? by[k].label : k)}: <b>${esc(String(txt))}</b><button class="chip-x" data-action="${ns}-colf-clear" data-col="${esc(k)}" title="Clear">✕</button></span>`;
    }).join('');
  }
  // Header click: same column flips direction, a new one starts the way
  // that column is usually read — biggest first for money, A-Z for words.
  function sheetSort(st, cols, key) {
    const col = cols.filter(c => c.key === key)[0]; if (!col) return;
    if (st.sortKey === key) st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc';
    else { st.sortKey = key; st.sortDir = col.num ? 'desc' : 'asc'; }
  }
  // A ticked box in a column's checklist. Returns nothing — it edits state.
  function sheetTick(st, key, val, on) {
    st.colf = st.colf || {};
    const arr = st.colf[key] = st.colf[key] || [];
    const at = arr.indexOf(val);
    if (on && at < 0) arr.push(val);
    if (!on && at >= 0) arr.splice(at, 1);
    if (!arr.length) delete st.colf[key];
  }

  return { esc, money, moneyK, initials, fmtDate, fmtDateTime, fmtRelative, avatar, tierChip, scoreBar, stageChip, isCallback, callbackChip, isClickedNoSignup, clickedChip, ring, toast, tierFill, csvCell, toCSV, downloadCSV, stampName, icon, ICON_PATHS,
    cleanHtml, noteHtml, noteEditor, noteRead, noteText, dateStamp, dateQuick, relAction, relIcon,
    pickerHtml, pickerInit, pickerValue, pickerRec, pickerMounted, pickerSettle, pickResolve, pickSearch,
    sheetApply, sheetHead, sheetChips, sheetSort, sheetTick, sheetValues };
})();
