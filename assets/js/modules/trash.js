/* ============================================================
   RWG Platform — Trash (partners only)

   A deleted record waits here until a partner decides. Restore is
   one click, because undoing a mistake should be easier than making
   one. Purge asks first, because it is the only irreversible button
   in the whole application.

   Read on demand, not on a listener: the bin is somewhere you go,
   not something the app carries around all day.
   ============================================================ */
window.RWG = window.RWG || {};

(function () {
  const TR = () => RWG.trash;
  const U = () => RWG.ui;
  const esc = (s) => U().esc(s);

  const st = { rows: null, loading: false, err: '', kind: '', busy: {} };

  function load() {
    st.loading = true; st.err = '';
    TR().fetchAll()
      .then(rows => { st.rows = rows; st.loading = false; RWG.app.renderMain(); })
      .catch(e => {
        st.loading = false;
        st.err = (e && e.message) || 'could not read the bin';
        st.rows = [];
        RWG.app.renderMain();
      });
  }

  function summarise(r) {
    const s = r.snapshot || {};
    if (r.coll === 'contacts') return [s.email, s.phone].filter(Boolean).join(' · ');
    if (r.coll === 'households') return s.advisorName ? 'advisor ' + s.advisorName : '';
    if (r.coll === 'cases') {
      const bits = [];
      if (s.clientName) bits.push(s.clientName);
      if (s.closedAt) bits.push('was closed');
      else if (s.state) bits.push(s.state.toLowerCase());
      return bits.join(' · ');
    }
    if (r.coll === 'tasks') return [s.assigneeName, s.dueDate ? 'due ' + s.dueDate : ''].filter(Boolean).join(' · ');
    if (r.coll === 'notes') return s.authorName ? 'posted by ' + s.authorName : '';
    return '';
  }

  // Restoring a case or a person only makes sense if what it hung off
  // is still there. Say so rather than letting them make an orphan.
  function orphanWarning(r) {
    const H = RWG.hh, s = r.snapshot || {};
    if (!H || !H.isStarted()) return '';
    if ((r.coll === 'contacts' || r.coll === 'cases') && s.householdId && !H.household(s.householdId)) {
      return 'its household was deleted too — restore that first';
    }
    return '';
  }

  function rowHtml(r) {
    const meta = TR().kindOf(r.coll);
    const warn = orphanWarning(r);
    const busy = st.busy[r.id];
    return `<div class="list-row">
      <span style="flex:none;font-size:15px" title="${esc(meta.kind)}">${meta.icon}</span>
      <div class="grow">
        <div style="font-size:13.5px;color:var(--ink);font-weight:600">${esc(r.label || '(unnamed)')}</div>
        <div class="flex" style="gap:6px;margin-top:3px;flex-wrap:wrap;align-items:center">
          <span class="chip" style="font-size:10.5px;background:rgba(14,36,64,.05);color:var(--navy);border:1px solid var(--line)">${esc(meta.kind)}</span>
          ${summarise(r) ? `<span class="cell-sub" style="font-size:11.5px">${esc(summarise(r))}</span>` : ''}
          ${warn ? `<span class="chip tier-medium" style="font-size:10.5px">${esc(warn)}</span>` : ''}
        </div>
      </div>
      <div class="end" style="display:flex;gap:6px;align-items:center">
        <span class="cell-sub" style="text-align:right;line-height:1.35">
          ${esc(r.deletedByName || 'someone')}<br>
          <span style="opacity:.75">${esc(U().fmtRelative(r.deletedAt))}</span></span>
        <button class="btn btn-ghost btn-sm" data-action="tr-restore" data-id="${esc(r.id)}" ${busy ? 'disabled' : ''}>Restore</button>
        <button class="btn btn-quiet btn-sm" data-action="tr-purge" data-id="${esc(r.id)}" ${busy ? 'disabled' : ''}
          title="Delete permanently — this cannot be undone">✕</button>
      </div>
    </div>`;
  }

  function screenHtml(user, ctx) {
    if (!ctx.isAdmin) {
      return `<div class="empty" style="padding:60px 16px"><div class="ec">🔒</div>
        <h3>Partners only</h3><p>Deleted records wait for a partner to review them.</p></div>`;
    }
    if (st.rows === null) {
      if (!st.loading) load();
      return `<div class="empty" style="padding:60px"><div class="ec">⏳</div><h3>Reading the bin…</h3></div>`;
    }

    const kinds = {};
    st.rows.forEach(r => { kinds[r.coll] = (kinds[r.coll] || 0) + 1; });
    const rows = st.kind ? st.rows.filter(r => r.coll === st.kind) : st.rows;

    const chips = [['', 'Everything', st.rows.length]]
      .concat(Object.keys(kinds).map(k => [k, TR().kindOf(k).kind, kinds[k]]))
      .map(k => `<button class="btn btn-sm ${st.kind === k[0] ? 'btn-navy' : 'btn-ghost'}"
          data-action="tr-kind" data-kind="${esc(k[0])}">${esc(k[1])} · ${k[2]}</button>`).join('');

    const body = rows.length
      ? rows.map(rowHtml).join('')
      : `<div class="empty" style="padding:48px 16px"><div class="ec">🗑</div>
          <h3>${st.rows.length ? 'Nothing of that kind' : 'The bin is empty'}</h3>
          <p>${st.rows.length ? 'Try another filter.' : 'Anything the team deletes waits here until a partner clears it.'}</p></div>`;

    return `
      ${st.err ? `<div class="card" style="border-color:rgba(178,58,72,.35);margin-bottom:14px">
        <p style="margin:0;font-size:13px;color:var(--bad)">Couldn't read the bin: ${esc(st.err)}.
        If this says "permission denied", the Firestore rules for <code>trash</code> haven't been published yet.</p></div>` : ''}
      <div class="card flush">
        <div class="list-head">
          <span class="t" style="font-size:17px">Trash</span>
          <span class="s">${st.rows.length} record${st.rows.length === 1 ? '' : 's'} waiting</span>
          <span class="topbar-spacer"></span>
          <button class="btn btn-ghost btn-sm" data-action="tr-reload">↻ Refresh</button>
        </div>
        ${st.rows.length ? `<div class="list-toolbar">${chips}</div>` : ''}
        ${body}
        <p class="list-hint">Restoring puts a record back exactly where it was, under the same id, so
          everything that pointed at it still does. Purging is the only button here that cannot be undone.</p>
      </div>`;
  }

  RWG.modules.register({
    id: 'trash',
    title: 'Trash',
    enabled: true,
    roles: ['admin'],
    nav: [{ view: 'trash', label: 'Trash', icon: 'archive' }],
    meta: { trash: { t: 'Trash', s: 'Deleted records, waiting on a partner' } },
    state: st,

    onEnter() {
      const me = RWG.auth.currentUser();
      if (RWG.hh && !RWG.hh.isStarted()) RWG.hh.init(me, RWG.app.renderMain);
      if (st.rows === null && !st.loading) load();
    },

    actions: {
      'tr-reload': () => { st.rows = null; st.busy = {}; RWG.app.renderMain(); },
      'tr-kind': (el) => { st.kind = el.dataset.kind || ''; RWG.app.renderMain(); },
      'tr-restore': (el) => {
        const id = el.dataset.id;
        st.busy[id] = true; RWG.app.renderMain();
        TR().restore(id)
          .then(r => {
            st.rows = (st.rows || []).filter(x => x.id !== id);
            delete st.busy[id];
            RWG.app.renderMain();
            U().toast((r.label || 'The record') + ' is back', true);
          })
          .catch(e => {
            delete st.busy[id]; RWG.app.renderMain();
            U().toast('Restore failed: ' + ((e && e.message) || 'unknown'));
          });
      },
      'tr-purge': (el) => {
        const id = el.dataset.id;
        const row = (st.rows || []).find(r => r.id === id);
        const name = row ? (row.label || 'this record') : 'this record';
        if (!confirm('Permanently delete ' + name + '?\n\nThis is the one action in the CRM that cannot be undone.')) return;
        st.busy[id] = true; RWG.app.renderMain();
        TR().purge(id)
          .then(() => {
            st.rows = (st.rows || []).filter(x => x.id !== id);
            delete st.busy[id];
            RWG.app.renderMain();
            U().toast('Purged');
          })
          .catch(e => {
            delete st.busy[id]; RWG.app.renderMain();
            U().toast('Purge failed: ' + ((e && e.message) || 'unknown'));
          });
      }
    },

    render(view, user, ctx) { return screenHtml(user, ctx); }
  });
})();
