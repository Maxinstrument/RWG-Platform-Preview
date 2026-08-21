/* ============================================================
   RWG Platform — Key dates & AdvisorStream queue (phase 6a)

   One screen, two tabs.

   KEY DATES: every date the book knows how to pay attention to,
   merged into one feed — birthdays (with the milestone ages that
   matter in this business flagged), policy anniversaries derived
   from confirmed closes (year one = the first annual review), and
   custom dates typed onto a household (a DROP window, a retirement
   date, an RMD deadline). Nothing here nags by itself: the ⏰
   button turns a date into an ordinary task on the advisor's My
   Work, due three days ahead — reminders live where work lives.

   ADVISORSTREAM QUEUE: every prospect goes on the weekly
   newsletter — that was decided on day one. AdvisorStream is a
   separate tool and the bridge is a person, by design (same rule
   as A360): this tab is the worklist. Copy the emails, subscribe
   them over there, mark them done here.

   RWG.dates exposes the merged feed so the Home dashboard's
   Important dates widget shows the same truth.
   ============================================================ */
window.RWG = window.RWG || {};

(function () {
  const H  = () => RWG.hh;
  const SD = () => RWG.scorecardData;
  const SC = () => RWG.scorecard;
  const T  = () => RWG.tasks;
  const D  = () => RWG.data;          // the roster, for "who does it"
  const U  = () => RWG.ui;
  const esc = (s) => U().esc(s);
  const dayMs = 86400000;

  const st = { tab: 'dates', range: 60, kind: '', entries: {} };

  // ── the date math ─────────────────────────────────────────
  // Lifecycle stamps (closedAt) are stored as UTC instants, but an
  // anniversary is a calendar day. Slicing the ISO string takes the UTC
  // day, which for anything confirmed after ~8pm in Florida is tomorrow —
  // so a policy closed the evening of the 16th would keep its anniversary
  // on the 17th forever. Read the local day off the instant instead.
  // A plain 'YYYY-MM-DD' is already a calendar day and passes through.
  function localDayKey(v) {
    const s = String(v == null ? '' : v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    if (isNaN(d.getTime())) return s.slice(0, 10);
    const p = (n) => (n < 10 ? '0' : '') + n;
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function nextOccur(dateStr, today) {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}/.test(String(dateStr))) return null;
    const t = today || new Date();
    const t0 = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    const p = String(dateStr).slice(0, 10).split('-').map(Number);
    let next = new Date(t0.getFullYear(), p[1] - 1, p[2]);
    if (next < t0) next = new Date(t0.getFullYear() + 1, p[1] - 1, p[2]);
    return { when: next, inDays: Math.round((next - t0) / dayMs), years: next.getFullYear() - p[0] };
  }

  // The ages a planning practice actually watches. Soft phrasing on
  // purpose — a flag to start a conversation, not advice.
  const MILESTONES = {
    50: 'catch-up contributions unlock',
    59: 'turns 59½ this year — in-service rollover territory',
    62: 'FRS normal retirement age',
    65: 'Medicare enrollment window',
    73: 'RMDs begin'
  };
  const milestone = (turning) => MILESTONES[turning] || null;
  const fmtShort = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // ── the merged feed ───────────────────────────────────────
  function upcoming(days, today) {
    days = days || 30;
    const out = [];
    const t = today || new Date();
    const t0 = new Date(t.getFullYear(), t.getMonth(), t.getDate());

    if (H() && H().isStarted()) {
      H().upcomingBirthdays(days).forEach(b => {
        const hh = b.contact.householdId ? H().household(b.contact.householdId) : null;
        out.push({
          kind: 'birthday', icon: '🎂', when: b.date, inDays: b.inDays,
          title: H().contactName(b.contact) + ' turns ' + b.turning,
          sub: hh ? hh.name : '', advisor: (hh && hh.advisorName) || '',
          hhId: b.contact.householdId || null, milestone: milestone(b.turning),
          key: 'bd:' + b.contact.id + ':' + b.date.getFullYear(),
          remindTitle: 'Call ' + H().contactName(b.contact) + ' — birthday ' + fmtShort(b.date)
        });
      });
      /* Custom key dates belong to a person: a DROP window is Maria's, not
         the Vargases'. Dates recorded against the household before that was
         true still surface here, flagged, with a button to move them onto
         whoever they were always about. */
      const pushCustom = (k, owner) => {
        let when, inDays;
        if (k.repeat === 'yearly') {
          const n = nextOccur(k.date, t); if (!n) return;
          when = n.when; inDays = n.inDays;
        } else {
          const n = nextOccur(k.date, t); if (!n) return;
          // one-time: only the literal date, never a repeat of it
          const lit = new Date(Number(k.date.slice(0, 4)), Number(k.date.slice(5, 7)) - 1, Number(k.date.slice(8, 10)));
          inDays = Math.round((lit - t0) / dayMs);
          if (inDays < 0) return;
          when = lit;
        }
        if (inDays > days) return;
        const who = owner.contact ? H().contactName(owner.contact) : '';
        const hh = owner.hh;
        out.push({
          kind: 'custom', icon: '⭐', when, inDays,
          title: k.label || 'Key date',
          sub: [who, hh ? hh.name : '', k.note].filter(Boolean).join(' · '),
          advisor: (hh && hh.advisorName) || '',
          hhId: hh ? hh.id : null,
          contactId: owner.contact ? owner.contact.id : null,
          legacy: !owner.contact,          // still filed against the household
          kdId: k.id,
          key: 'kd:' + (owner.contact ? owner.contact.id : (hh ? hh.id : '?')) + ':' + k.id + ':' + when.getFullYear(),
          remindTitle: (k.label || 'Key date') + ' — ' + (who || (hh ? hh.name : ''))
        });
      };

      H().contacts().forEach(c => (c.keyDates || []).forEach(k =>
        pushCustom(k, { contact: c, hh: c.householdId ? H().household(c.householdId) : null })));
      H().households().forEach(h => (h.keyDates || []).forEach(k =>
        pushCustom(k, { contact: null, hh: h })));
    }

    if (SD() && SD().isStarted()) {
      SD().cases().filter(c => c.closedAt).forEach(c => {
        const n = nextOccur(localDayKey(c.closedAt), t);
        if (!n || n.years < 1 || n.inDays > days) return;
        out.push({
          kind: 'anniversary', icon: '📜', when: n.when, inDays: n.inDays,
          title: (c.title || c.clientName || '(no name)') + ' — policy anniversary, year ' + n.years,
          sub: SC().productName(c.product) + ' · a review is due', advisor: c.agentName || '',
          hhId: c.householdId || null,
          key: 'an:' + c.recordId + ':' + n.when.getFullYear(),
          remindTitle: 'Annual review — ' + (c.clientName || c.title || '') + ' (policy year ' + n.years + ')'
        });
      });
    }

    return out.sort((a, b) => a.inDays - b.inDays || String(a.title).localeCompare(String(b.title)));
  }

  // ── reminders: a date becomes a task, once ────────────────
  /* ⏰ opens a small window rather than firing a task off on its own.
     The household's advisor is the sensible default, not the only answer:
     a birthday might be a call from the advisor, a postcard from the
     office, or a gift somebody else is arranging. What it is, who does
     it and when are all a click away before anything is written. */
  function remind(e) {
    const t = T();
    if (!t.isStarted()) t.init(RWG.auth.currentUser(), RWG.app.renderMain);
    /* Dedupe on the date this came FROM, not on the title: the window
       lets you rename it ("Send a card" rather than "Call"), and matching
       titles would then happily make a second reminder for the same
       birthday. The title match stays as a fallback for reminders written
       before the stamp existed. */
    const dupe = t.open().find(x => x.keyDateKey === e.key)
      || t.open().find(x => x.title === e.remindTitle);
    if (dupe) {
      const who = dupe.assigneeName ? dupe.assigneeName.split(' ')[0] + '’s' : 'someone’s';
      U().toast('Already made — it is on ' + who + ' Tasks'
        + (dupe.dueDate ? ', due ' + dupe.dueDate : '') + '.');
      return;
    }
    const me = RWG.auth.currentUser();
    const hh = e.hhId && H().isStarted() ? H().household(e.hhId) : null;
    const due = t.todayKey(Math.max(e.when.getTime() - 3 * dayMs, Date.now()));
    const ownerUid = (hh && hh.advisorUid) || me.id;
    const users = D().users().filter(u => u.status === 'active');
    const whoOpts = users.map(u =>
      `<option value="${esc(u.id)}" ${u.id === ownerUid ? 'selected' : ''}>${esc(u.name)}${
        u.id === ((hh && hh.advisorUid) || '') ? ' — advisor on this household' : ''}</option>`).join('');
    const catOpts = ['<option value="">— none —</option>'].concat(
      t.categories().map(c => `<option value="${esc(c)}">${esc(c)}</option>`)).join('');

    mount().innerHTML = `
      <div class="scrim" data-action="close-modal"></div>
      <div class="modal-card modal-sm">
        <div class="modal-head"><h2>Set a reminder</h2>
          <p>${esc(fmtShort(e.when))}${hh ? ' · ' + esc(hh.name) : ''}</p></div>
        <div class="modal-body">
          <div class="field-group"><label class="lbl">What needs doing</label>
            <input id="rm-title" value="${esc(e.remindTitle)}">
            <div class="hint">Change it if this is a card or a gift rather than a call.</div></div>
          <div class="field-row">
            <div class="field-group"><label class="lbl">Who does it</label>
              <select id="rm-who">${whoOpts}</select></div>
            <div class="field-group"><label class="lbl">Due</label>
              <input id="rm-due" type="date" value="${esc(due)}">
              ${U().dateQuick('rm-due', due)}</div>
          </div>
          <div class="field-group"><label class="lbl">Category <span class="pill-soft" style="font-size:10.5px">optional</span></label>
            <select id="rm-cat">${catOpts}</select></div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" data-action="close-modal">Cancel</button>
          <button class="btn btn-gold" data-action="kd-remind-save"
            data-hh="${esc((hh && hh.id) || '')}" data-when="${esc(fmtShort(e.when))}"
            data-key="${esc(e.key || '')}">Add the task</button>
        </div>
      </div>`;
    const inp = document.getElementById('rm-title');
    if (inp && inp.focus) inp.focus();
  }

  // Write the reminder the window describes.
  function remindSave(el) {
    const t = T();
    const title = (g('rm-title') || '').trim();
    if (!title) { U().toast('Give the reminder a name'); return; }
    if (t.open().some(x => x.title === title)) {
      U().toast('A task with that name is already open — rename it or leave it be');
      return;
    }
    if (el.dataset.key && t.open().some(x => x.keyDateKey === el.dataset.key)) {
      U().toast('This date already has a reminder');
      return;
    }
    const uid = g('rm-who');
    const u = D().user(uid);
    const hh = el.dataset.hh && H().isStarted() ? H().household(el.dataset.hh) : null;
    /* A birthday reminder is usually a card, and a card needs an address.
       Carrying it into the note means whoever picks the task up can act on
       it without going back to the record to look the family up. */
    const addr = hh ? H().addrLine(hh.address) : '';
    t.addTask({
      title: title,
      note: 'from Key dates · ' + (el.dataset.when || '') + (addr ? ' · ' + addr : ''),
      keyDateKey: el.dataset.key || null,   // what makes "already reminded" answerable
      assigneeUid: uid,
      assigneeName: (u && u.name) || '',
      dueDate: g('rm-due') || t.todayKey(),
      category: g('rm-cat') || '',
      relatedType: hh ? 'household' : null,
      relatedId: hh ? hh.id : null,
      relatedLabel: hh ? hh.name : ''
    });
    mount().innerHTML = '';
    RWG.app.renderMain();
    const me = RWG.auth.currentUser();
    const whose = (uid === (me && me.id)) ? 'your' : (((u && u.name) || 'their').split(' ')[0] + '’s');
    U().toast('“' + title + '” is on ' + whose + ' Tasks, due ' + (g('rm-due') || 'today'), true);
  }

  // ── custom-date modal (from here or a household's card) ───
  const mount = () => document.getElementById('modal-mount');
  const g = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };

  // People, grouped under their household, so a long book stays navigable
  // and it is obvious which family a name belongs to.
  function personOptions(selectedId) {
    const hhs = H().households().slice().sort((a, b) => a.name.localeCompare(b.name));
    const loose = H().contacts().filter(c => !c.householdId || !H().household(c.householdId));
    const group = (label, people) => {
      if (!people.length) return '';
      return `<optgroup label="${esc(label)}">${people
        .slice().sort((a, b) => H().contactName(a).localeCompare(H().contactName(b)))
        .map(c => `<option value="${esc(c.id)}" ${c.id === selectedId ? 'selected' : ''}>${esc(H().contactName(c) || '(no name)')}</option>`)
        .join('')}</optgroup>`;
    };
    return hhs.map(h => group(h.name, H().contactsFor(h.id))).join('')
      + group('No household', loose);
  }

  /* Moving a legacy household date onto a person: add to the person and
     remove from the household in the same turn, so the date is never in
     both places (it would surface twice) nor in neither. */
  function moveKeyDate(h, k, c) {
    H().saveContact({ id: c.id, keyDates: (c.keyDates || []).concat([k]) });
    H().saveHousehold({ id: h.id, keyDates: (h.keyDates || []).filter(x => x.id !== k.id) });
    mount().innerHTML = '';
    RWG.app.renderMain();
    U().toast('“' + (k.label || 'Key date') + '” is now ' + (H().contactName(c) || 'theirs') + "'s", true);
  }

  function movePickerModal(h, k, people) {
    const opts = people.slice().sort((a, b) => H().contactName(a).localeCompare(H().contactName(b)))
      .map(c => `<option value="${esc(c.id)}">${esc(H().contactName(c) || '(no name)')}</option>`).join('');
    mount().innerHTML = `
      <div class="scrim" data-action="close-modal"></div>
      <div class="modal-card modal-sm">
        <div class="modal-head"><h2>Whose date is this?</h2>
          <p>“${esc(k.label || 'Key date')}” is filed against ${esc(h.name)}. Key dates belong to a person now.</p></div>
        <div class="modal-body">
          <div class="field-group"><label class="lbl">Person</label>
            <select id="kd-move-who">${opts}</select></div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" data-action="close-modal">Cancel</button>
          <button class="btn btn-gold" data-action="kd-move-save" data-hh="${esc(h.id)}" data-kd="${esc(k.id)}">Move it</button>
        </div>
      </div>`;
  }

  function kdModal(presetContact) {
    const opts = personOptions(presetContact || null);
    if (!opts) { U().toast('Add a person to the book first — a key date belongs to someone'); return; }
    mount().innerHTML = `
      <div class="scrim" data-action="close-modal"></div>
      <div class="modal-card">
        <div class="modal-head"><h2>New key date</h2>
          <p>A DROP window, a retirement date, an RMD deadline — anything the book should never forget.</p></div>
        <div class="modal-body">
          <div class="field-group"><label class="lbl">Whose date is it</label><select id="kd-who">${opts}</select>
            <div class="hint">Dates belong to a person — a DROP window is theirs, not the family's.</div></div>
          <div class="field-row">
            <div class="field-group"><label class="lbl">What is it</label>
              <input id="kd-label" placeholder="e.g. DROP window ends"></div>
            <div class="field-group"><label class="lbl">Date</label>
              <input id="kd-date" type="date">
              ${U().dateQuick('kd-date', '')}</div>
          </div>
          <div class="field-row">
            <div class="field-group"><label class="lbl">Repeats</label>
              <select id="kd-repeat"><option value="yearly">Every year</option><option value="once">One time</option></select></div>
            <div class="field-group"><label class="lbl">Note <span class="pill-soft" style="font-size:10.5px">optional</span></label>
              <input id="kd-note"></div>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" data-action="close-modal">Cancel</button>
          <button class="btn btn-gold" data-action="kd-add-save">Add date</button>
        </div>
      </div>`;
    const inp = document.getElementById('kd-label'); if (inp) inp.focus();
  }

  // ── the screen ────────────────────────────────────────────
  function group(label, list, tone) {
    if (!list.length) return '';
    return `<div class="list-group"${tone === 'hot' ? ' style="background:rgba(194,161,77,.10)"' : ''}>
      ${label} <span style="opacity:.7">· ${list.length}</span></div>` + list.map(row).join('');
  }
  function row(e) {
    st.entries[e.key] = e;
    return `<div class="list-row">
      <span class="ic">${e.icon}</span>
      <div class="grow">
        <div style="font-size:13.5px;color:var(--ink);font-weight:600;${e.hhId ? 'cursor:pointer' : ''}"
          ${e.hhId ? `data-action="hh-goto" data-id="${esc(e.hhId)}"` : ''}>${esc(e.title)}</div>
        <div class="flex" style="gap:6px;margin-top:3px;flex-wrap:wrap;align-items:center">
          ${e.sub ? `<span class="cell-sub" style="font-size:11.5px">${esc(e.sub)}</span>` : ''}
          ${e.advisor ? `<span class="pill-soft" style="font-size:11px">${esc(e.advisor.split(' ')[0])}</span>` : ''}
          ${e.milestone ? `<span class="chip tier-gold" style="font-size:10.5px">${U().icon('spark','ic-inline')} ${esc(e.milestone)}</span>` : ''}
          ${e.kind === 'custom' && e.legacy ? `<button class="chip tier-medium" style="font-size:10.5px;cursor:pointer"
              title="This date is filed against the household. Key dates belong to a person now — click to say whose."
              data-action="kd-move" data-hh="${esc(e.hhId)}" data-kd="${esc(e.kdId)}">on the household · assign →</button>` : ''}
          ${e.kind === 'custom' ? `<button class="btn btn-quiet btn-sm" style="padding:1px 7px;font-size:10.5px" title="Remove this date" data-action="kd-del"
              ${e.contactId ? `data-contact="${esc(e.contactId)}"` : `data-hh="${esc(e.hhId)}"`} data-kd="${esc(e.kdId)}">✕</button>` : ''}
        </div>
      </div>
      <div class="end">
        <div style="font-size:12px;color:var(--ink)">${esc(fmtShort(e.when))}</div>
        <div class="cell-sub" style="font-size:11px">${e.inDays === 0 ? 'today' : 'in ' + e.inDays + 'd'}</div>
      </div>
      <button class="btn btn-ghost btn-sm" style="flex:none;margin-top:2px" title="Create a reminder task, due 3 days ahead"
        data-action="kd-remind" data-key="${esc(e.key)}">⏰ Remind</button>
    </div>`;
  }

  function datesTab() {
    st.entries = {};
    const all = upcoming(st.range);
    const list = st.kind ? all.filter(e => e.kind === st.kind) : all;
    const week = list.filter(e => e.inDays <= 7);
    const month = list.filter(e => e.inDays > 7 && e.inDays <= 31);
    const later = list.filter(e => e.inDays > 31);
    const chips = [['', 'All'], ['birthday', '🎂 Birthdays'], ['anniversary', '📜 Anniversaries'], ['custom', '⭐ Custom']]
      .map(k => `<button class="btn btn-sm ${st.kind === k[0] ? 'btn-navy' : 'btn-ghost'}" data-action="kd-kind" data-kind="${k[0]}">${k[1]}</button>`).join('');
    const ranges = [30, 60, 90, 180].map(r => `<option value="${r}" ${r === st.range ? 'selected' : ''}>Next ${r} days</option>`).join('');
    return `
      <div class="flex" style="gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
        ${chips}<span class="topbar-spacer"></span>
        <select id="kd-range" class="fbar-select" style="width:auto">${ranges}</select>
        <button class="btn btn-gold btn-sm" data-action="kd-add">＋ Key date</button>
      </div>
      <div class="card flush">
        ${group('This week', week, 'hot') + group('This month', month) + group('Further out', later)
          || `<div class="empty" style="padding:44px 16px"><div class="ec">🗓</div><h3>Nothing inside ${st.range} days</h3>
              <p>Dates appear as births, closes and custom dates land in the book.</p></div>`}
      </div>
      <p class="muted" style="font-size:12px;margin:10px 2px 0">
        ⏰ turns a date into a task — say what it is, who does it and when. It defaults to the household's advisor, three days ahead.
        Anniversaries come from confirmed closes; year one is the first annual review.
      </p>`;
  }

  function streamTab() {
    const contacts = H().contacts();
    const queue = contacts.filter(c => !c.advisorstream)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const onList = contacts.length - queue.length;
    const emails = queue.map(c => (c.email || '').trim()).filter(Boolean);
    const rows = queue.map(c => {
      const hh = c.householdId ? H().household(c.householdId) : null;
      return `<div class="flex" style="gap:11px;padding:10px 16px;border-bottom:1px solid rgba(14,36,64,.06);align-items:center">
        <div style="min-width:0;flex:1">
          <div style="font-size:13.5px;color:var(--ink);font-weight:600;cursor:pointer"
            data-action="ct-open" data-id="${esc(c.id)}">${esc(H().contactName(c))}</div>
          <div class="cell-sub" style="font-size:11.5px">${hh ? esc(hh.name) : '—'}${c.phone ? ' · ' + esc(c.phone) : ''}</div>
        </div>
        <div style="flex:none;min-width:0;max-width:220px">
          ${c.email ? `<span class="cell-sub" style="font-size:12px">${esc(c.email)}</span>`
            : '<span class="chip tier-low" style="font-size:10.5px" title="AdvisorStream needs an email — add one on the household">no email</span>'}
        </div>
        <button class="btn btn-ghost btn-sm" style="flex:none" data-action="as-done" data-id="${esc(c.id)}">Subscribed ✓</button>
      </div>`;
    }).join('');
    return `
      <div class="card flush">
        <div class="list-head">
          <span class="t">Waiting for the newsletter</span>
          <span class="cell-sub">${queue.length} to add · ${onList} already on</span>
          <span class="topbar-spacer"></span>
          ${emails.length ? `<button class="btn btn-ghost btn-sm" data-action="as-copy">⧉ Copy ${emails.length} email${emails.length === 1 ? '' : 's'}</button>` : ''}
        </div>
        ${rows || `<div class="empty" style="padding:44px 16px"><div class="ec">✓</div><h3>Everyone is on the newsletter</h3>
          <p>New people land here until they are subscribed.</p></div>`}
      </div>
      <p class="muted" style="font-size:12px;margin:10px 2px 0">
        The bridge is you, by design: copy the emails, subscribe them in AdvisorStream, then mark each
        one Subscribed ✓ here. The toggle on a household's people table is the same switch.
      </p>`;
  }

  RWG.dates = { nextOccur, localDayKey, milestone, upcoming, MILESTONES };

  RWG.modules.register({
    id: 'dates',
    title: 'Key dates',
    enabled: true,
    roles: ['admin', 'agent'],
    nav: [{ view: 'dates', label: 'Key dates', icon: 'today' }],
    meta: { dates: { t: 'Key dates', s: 'What the book must never forget' } },
    state: st,

    home: {
      tile: () => ({ icon: 'today', title: 'Key dates', desc: 'Birthdays, anniversaries and the AdvisorStream queue.', view: 'dates' })
    },

    onEnter() {
      const me = RWG.auth.currentUser();
      if (!H().isStarted()) H().init(me, RWG.app.renderMain);
      if (!SD().isStarted()) SD().init(me, RWG.app.renderMain);
      if (!T().isStarted()) T().init(me, RWG.app.renderMain);
      RWG.pipelines.init();
    },

    onChange(e) {
      if (e.target.id === 'kd-range') { st.range = Number(e.target.value) || 60; RWG.app.renderMain(); }
    },

    actions: {
      'kd-tab': (el) => { st.tab = el.dataset.tab; RWG.app.renderMain(); },
      'kd-kind': (el) => { st.kind = el.dataset.kind; RWG.app.renderMain(); },
      'kd-remind': (el) => { const e = st.entries[el.dataset.key]; if (e) remind(e); },
      'kd-remind-save': (el) => remindSave(el),
      // data-contact preselects a person; data-hh (from a household screen)
      // preselects that household's primary client.
      'kd-add': (el) => {
        let cid = el.dataset.contact || null;
        if (!cid && el.dataset.hh) {
          const p = H().primaryContact(el.dataset.hh);
          if (p) cid = p.id;
        }
        kdModal(cid);
      },
      'kd-add-save': () => {
        const cid = g('kd-who'), label = g('kd-label').trim(), date = g('kd-date');
        if (!cid || !label || !date) { U().toast('Person, name and date — all three'); return; }
        const c = H().contact(cid); if (!c) return;
        const kds = (c.keyDates || []).concat([{
          id: 'kd' + Date.now(), label: label, date: date,
          repeat: g('kd-repeat') || 'yearly', note: g('kd-note').trim()
        }]);
        H().saveContact({ id: cid, keyDates: kds });
        mount().innerHTML = '';
        RWG.app.renderMain();
        U().toast('On ' + (H().contactName(c) || 'their') + "'s record — it will surface as it approaches", true);
      },
      'kd-del': (el) => {
        if (el.dataset.contact) {
          const c = H().contact(el.dataset.contact); if (!c) return;
          H().saveContact({ id: c.id, keyDates: (c.keyDates || []).filter(k => k.id !== el.dataset.kd) });
        } else {
          const h = H().household(el.dataset.hh); if (!h) return;
          H().saveHousehold({ id: h.id, keyDates: (h.keyDates || []).filter(k => k.id !== el.dataset.kd) });
        }
        RWG.app.renderMain();
      },

      /* Move a date that predates this change onto the person it was
         always about. One household with one person needs no question. */
      'kd-move': (el) => {
        const h = H().household(el.dataset.hh); if (!h) return;
        const k = (h.keyDates || []).find(x => x.id === el.dataset.kd); if (!k) return;
        const people = H().contactsFor(h.id);
        if (!people.length) { U().toast('Add a person to ' + h.name + ' first'); return; }
        if (people.length === 1) { moveKeyDate(h, k, people[0]); return; }
        movePickerModal(h, k, people);
      },
      'kd-move-save': (el) => {
        const h = H().household(el.dataset.hh);
        const k = h && (h.keyDates || []).find(x => x.id === el.dataset.kd);
        const c = H().contact(g('kd-move-who'));
        if (!h || !k || !c) return;
        moveKeyDate(h, k, c);
      },
      'as-done': (el) => {
        H().setAdvisorstream(el.dataset.id, true);
        RWG.app.renderMain();
        U().toast('On the newsletter ✓', true);
      },
      'as-copy': () => {
        const emails = H().contacts().filter(c => !c.advisorstream && (c.email || '').trim())
          .map(c => c.email.trim()).join(', ');
        const done = () => U().toast('Copied — paste into AdvisorStream', true);
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(emails).then(done, () => U().toast('Could not copy'));
        else {
          const ta = document.createElement('textarea');
          ta.value = emails; document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); done(); } catch (e) { U().toast('Could not copy'); }
          ta.remove();
        }
      }
    },

    render(view, user, ctx) {
      if (!H().isStarted()) return `<div class="empty" style="padding:60px"><div class="ec">⏳</div><h3>Loading the book…</h3></div>`;
      const queueN = H().contacts().filter(c => !c.advisorstream).length;
      const tabs = `<div class="flex" style="gap:8px;margin-bottom:16px">
        <button class="btn btn-sm ${st.tab === 'dates' ? 'btn-navy' : 'btn-ghost'}" data-action="kd-tab" data-tab="dates">Key dates</button>
        <button class="btn btn-sm ${st.tab === 'stream' ? 'btn-navy' : 'btn-ghost'}" data-action="kd-tab" data-tab="stream">AdvisorStream queue${queueN ? ` · ${queueN}` : ''}</button>
      </div>`;
      return tabs + (st.tab === 'stream' ? streamTab() : datesTab());
    }
  });
})();
