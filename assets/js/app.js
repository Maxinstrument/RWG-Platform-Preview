/* ============================================================
   RWG CRM — App controller (boot, routing, interactions)
   ============================================================ */
window.RWG = window.RWG || {};
RWG.app = (function () {
  const U = RWG.ui, D = RWG.data;

  // Icons live in ui.js so every screen draws from one set; U.icon()
  // builds the <svg> wrapper, which is why a stroke-width can no longer drift.
  const ICONS = new Proxy({}, { get: (_, k) => U.icon(String(k)) });

  // Sidebar entries and page titles now live with their modules (assets/js/modules/*.js).
  // The kernel asks RWG.modules for both, so adding a module never touches this file.

  const newFilter = () => RWG.leadtable.defaultFilter();
  const loadCols = (k, def) => { try { const r = localStorage.getItem(k); if (r) return JSON.parse(r); } catch (e) {} return def.slice(); };
  const saveCols = (k, arr) => { try { localStorage.setItem(k, JSON.stringify(arr)); } catch (e) {} };

  const state = {
    view: null, search: '', leadId: null, editing: false, importRows: null, importName: '', dragId: null,
    viewAs: null,   // admin impersonation: the agent id being viewed (or null)
    archiveRows: null,   // deletion archive (fetched on demand; not in the live cache)
    assignTarget: null,  // agent we're prepping to hand pooled leads to (pre-selects the bulk reassign)
    reportWeekStart: null, reportCache: {}, lastReport: null,   // weekly reports (live current week + frozen past)
    agentFilter: newFilter(), adminFilter: newFilter(), selected: new Set(),
    adminCols: loadCols('rwg_cols_admin_v3', RWG.leadtable.defaultVisible(true)),
    agentCols: loadCols('rwg_cols_agent_v3', RWG.leadtable.defaultVisible(false))
  };

  // "Effective" identity — usually the logged-in user, but an admin can view-as an agent.
  function effectiveUser() {
    const real = RWG.auth.currentUser();
    if (state.viewAs && real && real.role === 'admin') { const a = D.user(state.viewAs); if (a) return a; }
    return real;
  }
  function effectiveRole() {
    const real = RWG.auth.currentUser();
    if (state.viewAs && real && real.role === 'admin') return 'agent';
    return real ? real.role : 'agent';
  }
  // Set (or clear, with a falsy id) who an admin is viewing, staying on the
  // current page. Used by the scorecard's agent picker so you can flip between
  // agents without going back to Team. Only admins may impersonate.
  function setViewAs(id) {
    if (!RWG.auth.isAdmin()) return;
    state.viewAs = id || null;
    state.search = '';
    clearSelection();
    render();
  }

  // Which filter / column set is active depends on context: admin "All Leads" vs the agent's views.
  const isAdminLeads = () => effectiveRole() === 'admin' && state.view === 'leads';
  const currentFilter = () => isAdminLeads() ? state.adminFilter : state.agentFilter;
  const currentCols = () => isAdminLeads() ? state.adminCols : state.agentCols;
  const currentColsKey = () => isAdminLeads() ? 'rwg_cols_admin_v3' : 'rwg_cols_agent_v3';

  // Leads + filter for whatever lead table is currently on screen.
  // effectiveUser (not currentUser): in View As mode the table must show the
  // impersonated agent's leads, or filter repaints come up empty for admins.
  function currentTableLeads() {
    const u = effectiveUser();
    const adminLeads = isAdminLeads();
    const base = adminLeads ? D.leads() : D.leadsFor(u.id);
    const f = Object.assign(newFilter(), currentFilter(), { search: state.search });
    return { adminLeads, f, base, total: base.length, filtered: RWG.leadtable.applyFilter(base, f) };
  }
  const tableOpts = (c) => ({ showOwner: c.adminLeads, columns: currentCols(), selectable: c.adminLeads, selected: state.selected, allLeads: c.base, empty: 'Try a different filter, or Clear all.' });

  // Position a fixed popover panel just under its trigger button, clamped to the viewport
  function positionPanel(btn, panel) {
    panel.hidden = false;
    const r = btn.getBoundingClientRect();
    const pw = panel.offsetWidth || 210;
    let left = Math.min(r.right - pw, window.innerWidth - pw - 8);
    if (left < 8) left = 8;
    panel.style.top = (r.bottom + 8) + 'px';
    panel.style.left = left + 'px';
  }

  // Update count, summary chips, header funnels, board tier-chips + Clear visibility without re-rendering
  function updateFilterChrome() {
    const c = currentTableLeads(), f = currentFilter(), cf = f.colFilters || {};
    const cnt = document.querySelector('.fbar-count');
    if (cnt) cnt.textContent = `${c.filtered.length} of ${c.total} lead${c.total === 1 ? '' : 's'}`;
    const chipRow = document.querySelector('.chip-row');
    if (chipRow) chipRow.innerHTML = RWG.leadtable.summaryChips(f) || '<span class="muted" style="font-size:13px">None — click a column ▾ to sort &amp; filter</span>';
    document.querySelectorAll('.th-filter[data-col]').forEach(b => b.classList.toggle('on', (cf[b.dataset.col] || []).length > 0));
    document.querySelectorAll('.fbar-tier[data-tier]').forEach(b => b.classList.toggle('on', (cf.tier || []).includes(b.dataset.tier)));
    const active = Object.keys(cf).some(k => cf[k] && cf[k].length) || f.search || f.sortKey !== 'score' || f.sortDir !== 'desc';
    document.querySelectorAll('.fbar-clear').forEach(clr => clr.style.display = active ? '' : 'none');
  }

  // Rebuild the whole table (headers + body) — used for column-chooser changes (its popover lives in the bar)
  function refreshLeadsBody() {
    const body = $('#leads-body'); if (!body) return;
    const c = currentTableLeads();
    body.innerHTML = RWG.leadtable.leadsView(c.filtered, c.f, tableOpts(c));
    updateFilterChrome();
  }
  // Rebuild ONLY the rows — used for column-filter changes so the header's open popover survives
  function refreshLeadsRows() {
    const tbody = document.querySelector('#leads-body tbody');
    if (!tbody) { refreshLeadsBody(); return; }
    const c = currentTableLeads();
    tbody.innerHTML = RWG.leadtable.bodyFor(c.filtered, tableOpts(c));
    updateFilterChrome();
  }

  // Lightweight update of bulk-selection UI (avoids a full re-render so the agent dropdown keeps its value)
  function updateBulkUI() {
    const n = state.selected.size, bar = $('#bulkbar');
    if ((n > 0 && !bar) || (n === 0 && bar)) { renderMain(); return; }   // insert/remove the bulk bar
    if (bar) { const c = bar.querySelector('.bulk-count'); if (c) c.textContent = n + ' selected'; }
    const sa = document.querySelector('input[data-selall]');
    if (sa) {
      const ids = currentTableLeads().filtered.map(l => l.id);
      const onCount = ids.filter(id => state.selected.has(id)).length;
      sa.checked = ids.length > 0 && onCount === ids.length;
      sa.indeterminate = onCount > 0 && onCount < ids.length;
    }
  }
  const clearSelection = () => { if (state.selected.size) state.selected.clear(); };
  const $ = (s, r) => (r || document).querySelector(s);
  const root = () => document.getElementById('root');

  // ────────────────────────── boot / routing
  let _dataReady = false;
  function boot() {
    root().innerHTML = bootScreen();
    if (!RWG.fb) { root().innerHTML = bootScreen('Couldn’t reach Firebase — check your connection and refresh.'); return; }
    RWG.auth.init(onAuthChange);
  }
  function onAuthChange() {
    const u = RWG.auth.currentUser();
    if (!u || u.status !== 'active') { _dataReady = false; D.teardown(); render(); return; }
    if (!_dataReady) { _dataReady = true; D.init(u, render); }   // render() re-fires on each Firestore snapshot
    render();
  }
  function bootScreen(msg) {
    return `<div id="gate"><div class="gate-card" style="text-align:center">
      <img class="gate-logo" src="assets/img/logo.png" alt="Resilient Wealth Group">
      <p class="gate-brand">Resilient Wealth Group</p>
      <p class="gate-motto">Wealth, Conducted with Purpose</p>
      <p class="muted" style="margin-top:18px">${U.esc(msg || 'Loading…')}</p></div></div>`;
  }
  function pendingScreen(u) {
    const first = U.esc((u.name || '').split(' ')[0] || 'there');
    let title = 'Account pending approval';
    let sub = `Thanks, ${first}! Your account is awaiting the owner's approval — you'll have access the moment it's approved.`;
    if (u.status === 'removed') {
      title = 'Access removed';
      sub = `Hi ${first} — your access to this CRM has been removed. If this is a mistake, ask your administrator to restore your access.`;
    } else if (u.status === 'denied') {
      title = 'Request not approved';
      sub = `Hi ${first} — your access request wasn't approved. Please contact your administrator if you believe this is an error.`;
    }
    return `<div id="gate"><div class="gate-card" style="text-align:center">
      <img class="gate-logo" src="assets/img/logo.png" alt="Resilient Wealth Group">
      <p class="gate-brand">Resilient Wealth Group</p>
      <p class="gate-motto">Wealth, Conducted with Purpose</p>
      <p class="gate-title" style="margin-top:18px">${title}</p>
      <p class="gate-sub">${sub}</p>
      <button class="btn btn-ghost btn-block" data-action="logout">Sign out</button></div></div>`;
  }
  function render() {
    const real = RWG.auth.currentUser();
    closeDrawer();
    if (!real) { root().innerHTML = RWG.views.login(); document.body.classList.remove('in-app'); return; }
    if (real.status !== 'active') { root().innerHTML = pendingScreen(real); document.body.classList.remove('in-app'); return; }
    if (real.role !== 'admin') state.viewAs = null;   // only admins may impersonate
    // Land on the first nav item of the first enabled module for this role.
    if (!state.view || !RWG.modules.moduleForView(state.view)) state.view = RWG.modules.defaultView(effectiveRole());
    renderShell();
  }

  function renderShell() {
    const user = effectiveUser();
    const role = effectiveRole();
    const impersonating = !!state.viewAs;
    // Topbar extras are opt-in: a module declares chrome:{search:'leads', newLead:true}
    const chrome = RWG.modules.forRole(role).reduce((a, m) => Object.assign(a, m.chrome || {}), {});
    // A nav entry may declare:
    //   where:'user'  → lives in the menu under your name, not the sidebar
    //   also:[views]  → sibling views that keep this entry highlighted, so a
    //                   hub with tabs stays lit while you are on one of them
    const allNav = RWG.modules.navFor(role);
    const isOn = (n) => state.view === n.view || (n.also || []).indexOf(state.view) >= 0;
    const navHtml = allNav.filter(n => n.where !== 'user').map(n => {
      const badge = n.badge ? n.badge() : 0;
      return `<button class="nav-item ${isOn(n) ? 'active' : ''}" data-action="nav" data-view="${n.view}">
        ${ICONS[n.icon] || ''}<span>${n.label}</span>${badge ? `<span class="badge">${badge}</span>` : ''}</button>`;
    }).join('');
    // Menu order is declared, not inherited from script-tag order, so
    // Upload sits under Data migration however the modules happen to load.
    const userNav = allNav.filter(n => n.where === 'user')
      .sort((a, b) => (a.menuOrder || 50) - (b.menuOrder || 50));
    const userMenuHtml = `
      <div class="user-menu" id="user-menu" hidden>
        <div class="um-head">${U.esc(user.name)}<span>${U.esc(user.email || (role === 'admin' ? 'Owner' : 'Agent'))}</span></div>
        ${userNav.map(n => `<button class="um-item ${isOn(n) ? 'on' : ''}" data-action="nav" data-view="${n.view}">
            ${ICONS[n.icon] || ''}<span>${n.label}</span></button>`).join('')}
        ${userNav.length ? '<div class="um-sep"></div>' : ''}
        <a class="um-item" href="guide.html" target="_blank" rel="noopener"><span>Guide</span></a>
        <button class="um-item" data-action="logout"><span>Sign out</span></button>
      </div>`;
    const banner = impersonating
      ? `<div class="viewas-banner">👁 Viewing as <b>${U.esc(user.name)}</b> — their exact cockpit. Changes you make here save on their behalf.<button class="btn btn-sm" data-action="exit-view-as">Exit agent view</button></div>`
      : '';

    root().innerHTML = `
      <div id="app" class="show">
        <aside class="sidebar" id="sidebar">
          <div class="side-brand"><img src="assets/img/logo.png" alt="RWG"><div class="t">Resilient Wealth<small>Wealth, Conducted with Purpose</small></div></div>
          <div class="nav-label">${role === 'admin' ? 'Owner' : (impersonating ? 'Viewing as agent' : 'Agent')}</div>
          ${navHtml}
          <div class="spacer"></div>
          <button class="nav-item" data-action="logout">${ICONS.logout}<span>Sign out</span></button>
          <div class="side-foot">RWG Platform</div>
        </aside>
        <div class="sidebar-scrim"></div>
        <header class="topbar">
          <button class="icon-btn menu-toggle" data-action="toggle-menu">☰</button>
          <div><div class="page-title" id="page-title"></div><div class="page-sub" id="page-sub"></div></div>
          <div class="topbar-spacer"></div>
          <div class="omni-wrap">
            <div class="topbar-search">${ICONS.search}
              <input id="global-search" type="search" autocomplete="off"
                     placeholder="Search people, households, opportunities, tasks, leads…"></div>
            <div class="omni-panel" id="omni-panel" hidden></div>
          </div>
          <div class="user-wrap">
            <button class="user-chip" data-action="toggle-user-menu" aria-haspopup="true" aria-expanded="false">
              ${U.avatar(user, 32)}
              <div class="meta"><div class="nm">${U.esc(user.name)}</div><div class="rl">${impersonating ? 'Agent (view)' : (role === 'admin' ? 'Owner' : 'Agent')}</div></div>
              <span class="um-caret">▾</span>
            </button>
            ${userMenuHtml}
          </div>
        </header>
        <main class="main">${banner}<div id="main-content"></div></main>
      </div>
      <div id="drawer-mount"></div>
      <div id="modal-mount"></div>
      <div id="modal-mount-2"></div>`;
    document.body.classList.add('in-app');
    renderMain();
  }

  // ── search everything ─────────────────────────────────────
  function closeOmni() {
    const p = $('#omni-panel');
    if (p && !p.hidden) { p.hidden = true; p.innerHTML = ''; }
  }
  function paintOmni(q) {
    const p = $('#omni-panel');
    if (!p) return;
    if (!String(q || '').trim()) { closeOmni(); return; }
    RWG.omni.warm();
    const rows = RWG.omni.query(q);
    if (!rows.length) {
      p.hidden = false;
      p.innerHTML = `<div class="omni-empty">Nothing matches “${U.esc(q)}”.</div>`;
      return;
    }
    p.hidden = false;
    p.innerHTML = rows.map(r => {
      if (r.header) return `<div class="omni-head">${r.icon} ${U.esc(r.header)}<span>${r.total}</span></div>`;
      if (r.more) return `<div class="omni-more">+${r.more} more</div>`;
      return `<button class="omni-row"${r.action ? ` data-action="${r.action}" data-id="${U.esc(r.id)}"` : ''}>
        <span class="t">${U.esc(r.title)}</span>
        ${r.sub ? `<span class="s">${U.esc(r.sub)}</span>` : ''}</button>`;
    }).join('');
  }

  function closeUserMenu() {
    const m = $('#user-menu');
    if (m && !m.hidden) m.hidden = true;
    const b = document.querySelector('.user-chip');
    if (b) b.setAttribute('aria-expanded', 'false');
  }
  // Clicking anywhere that is not the menu closes it — the usual contract
  // for a dropdown, and cheaper than a scrim.
  document.addEventListener('click', (e) => {
    const t = (e.target && e.target.nodeType === 1) ? e.target : null;
    if (!t) return;
    if (!t.closest('.user-wrap')) closeUserMenu();
    // A result closes the panel and clears the box; clicking anywhere else
    // outside it just closes. Either way the query does not linger.
    if (t.closest('.omni-row')) {
      const box = $('#global-search'); if (box) box.value = '';
      closeOmni();
    } else if (!t.closest('.omni-wrap')) {
      closeOmni();
    }
  });

  function setMeta() {
    const m = RWG.modules.metaFor(state.view) || { t: '', s: '' };
    if ($('#page-title')) { $('#page-title').textContent = m.t; $('#page-sub').textContent = m.s; }
  }

  function renderMain() {
    const real = RWG.auth.currentUser();
    if (!real) return render();
    const user = effectiveUser(), role = effectiveRole();
    setMeta();
    const ctx = { role, search: state.search, isAdmin: role === 'admin', filter: currentFilter(), columns: currentCols(), selected: state.selected, assignTarget: state.assignTarget };
    const mod = RWG.modules.moduleForView(state.view);
    const html = mod
      ? mod.render(state.view, user, ctx)
      : `<div class="empty" style="padding:60px 16px"><div class="ec">🧭</div><h3>Nothing here yet</h3><p>Choose an area from the menu.</p></div>`;
    const c = $('#main-content');
    if (c) {
      /* A repaint is not a navigation. Only landing on a DIFFERENT view
         resets the scroll; a same-view repaint (a card moved, a task
         ticked, a Firestore ack) puts the reader back exactly where they
         were — page, board strip, and each column's own scroll. */
      const same = state._painted === state.view;
      const keep = { top: same ? c.scrollTop : 0, boards: [], cols: {} };
      if (same) {
        c.querySelectorAll('.board').forEach((b, i) => { keep.boards[i] = b.scrollLeft || 0; });
        c.querySelectorAll('.board-col-body').forEach(b => {
          const col = b.closest('.board-col');
          const k = col && (col.dataset.plstage || col.dataset.stage);
          if (k && b.scrollTop) keep.cols[k] = b.scrollTop;
        });
      }
      c.innerHTML = html;
      c.scrollTop = keep.top;
      c.querySelectorAll('.board').forEach((b, i) => { if (keep.boards[i]) b.scrollLeft = keep.boards[i]; });
      c.querySelectorAll('.board-col-body').forEach(b => {
        const col = b.closest('.board-col');
        const k = col && (col.dataset.plstage || col.dataset.stage);
        if (k && keep.cols[k]) b.scrollTop = keep.cols[k];
      });
      state._painted = state.view;
    }
    if (mod && mod.onEnter) mod.onEnter(state.view, ctx);

    // ── Legacy Leads wiring. Only reachable while the Leads module is enabled. ──
    // re-wire dynamic bits for the upload view
    if (state.view === 'upload') wireUpload();
    // the deletion archive lives outside the live cache — fetch on entry, repaint from memory after
    if (role === 'admin' && state.view === 'archive') { if (state.archiveRows === null) loadArchive(); else paintArchive(); }
    // weekly reports: current week computes live; past weeks load/freeze a snapshot
    if (role === 'admin' && state.view === 'reports') loadOrPaintReport();
  }

  // ── weekly reports ──
  const curWeekStart = () => RWG.analytics.weekStartOf(Date.now());
  function loadOrPaintReport() {
    if (state.reportWeekStart == null) state.reportWeekStart = curWeekStart();
    const A = RWG.analytics, ws = state.reportWeekStart;
    const range = A.weekRangeFor(ws), wid = A.weekId(ws), label = A.weekLabel(ws);
    if (ws >= curWeekStart()) {                      // current (in-progress) week → always live
      paintReport(A.weeklyReport(range), label, 'live');
      return;
    }
    if (state.reportCache[wid]) { paintReport(state.reportCache[wid], label, 'final'); return; }
    const host = $('#report-body'); if (host) host.innerHTML = '<div class="muted" style="padding:28px;text-align:center">Loading…</div>';
    D.getReport(wid).then(snap => {
      if (snap) { state.reportCache[wid] = snap; paintReport(snap, label, 'final'); return; }
      const rep = A.weeklyReport(range);             // not stored yet → compute and freeze it
      rep.weekStart = range.start; rep.weekEnd = range.end;
      D.saveReport(wid, rep).catch(e => console.error('save report:', e));
      state.reportCache[wid] = rep; paintReport(rep, label, 'final');
    }).catch(() => { const h = $('#report-body'); if (h) h.innerHTML = '<div class="muted" style="padding:28px;text-align:center">Couldn’t load this report. If you just enabled reports, re-publish your Firestore rules.</div>'; });
  }
  function paintReport(rep, label, status) {
    const host = $('#report-body'); if (!host) return;
    state.lastReport = { rep, label };
    host.innerHTML = RWG.views.admin.reportTable(rep, label, status);
    const nextBtn = document.querySelector('[data-action="report-next"]');
    if (nextBtn) nextBtn.disabled = state.reportWeekStart >= curWeekStart();
  }
  function csvCell(v) { v = (v == null) ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function exportReport() {
    const lr = state.lastReport; if (!lr) return;
    const cols = ['Agent', 'Dials', 'Reaches', 'Reach %', 'Appts set', 'Appts GOLD', 'Appts HIGH', 'Appts MEDIUM', 'Appts LOW', 'Appts kept', 'Opportunities', 'Leads touched'];
    const tiers = (o) => { const at = o.apptTiers || {}; return [at.GOLD || 0, at.HIGH || 0, at.MEDIUM || 0, at.LOW || 0]; };
    const rows = lr.rep.agents.map(a => [a.name, a.dials, a.reaches, a.reachRate + '%', a.apptSet].concat(tiers(a), [a.apptKept, a.oppOpened, a.leadsTouched]));
    const t = lr.rep.team;
    rows.push(['Team total', t.dials, t.reaches, t.reachRate + '%', t.apptSet].concat(tiers(t), [t.apptKept, t.oppOpened, '']));
    const csv = [cols].concat(rows).map(r => r.map(csvCell).join(',')).join('\r\n');
    downloadCSV('RWG_weekly_report_' + RWG.analytics.weekId(state.reportWeekStart) + '.csv', csv);
  }

  // ── deletion archive ──
  function loadArchive() {
    const host = $('#archive-body'); if (!host) return;
    host.innerHTML = '<div class="muted" style="padding:28px;text-align:center">Loading the archive…</div>';
    D.fetchDeletedLeads().then(rows => { state.archiveRows = rows; paintArchive(); })
      .catch(err => {
        state.archiveRows = [];
        const h = $('#archive-body');
        if (h) h.innerHTML = '<div class="muted" style="padding:28px;text-align:center">Couldn’t load the archive — ' + U.esc(err.message || 'tap Refresh to retry.') + '</div>';
      });
  }
  function paintArchive() {
    const host = $('#archive-body'); if (!host) return;
    host.innerHTML = RWG.views.admin.archiveTable(state.archiveRows || []);
  }

  function setActiveNav() {
    document.querySelectorAll('.nav-item[data-view]').forEach(b =>
      b.classList.toggle('active', b.dataset.view === state.view));
  }

  function nav(view) {
    // A panel belongs to the screen that raised it. Leaving without this
    // left it floating over the next page with no way back to its context.
    closeDrawer();
    state.view = view;
    if (view === 'archive') state.archiveRows = null;   // pull a fresh copy of the archive on entry
    if (view === 'reports') state.reportWeekStart = RWG.analytics.weekStartOf(Date.now());   // open on the current week
    if (view !== 'leads') state.assignTarget = null;     // the pre-selected assignee only applies to All Leads
    clearSelection();
    setActiveNav();
    renderMain();
    const sb = $('#sidebar'); if (sb) sb.classList.remove('open');
  }

  // clickable table-header sorting: same col toggles direction, new col uses its default
  function sortByHeader(key, defDir) {
    const f = currentFilter();
    if (f.sortKey === key) f.sortDir = (f.sortDir === 'asc') ? 'desc' : 'asc';
    else { f.sortKey = key; f.sortDir = defDir || 'desc'; }
    renderMain();
  }

  // ────────────────────────── drawer
  // Dismissal: the state clears on the same tick, only the pixels wait.
  // `instant` keeps test harnesses (and anyone on reduced motion) synchronous,
  // and the timeout cap means a stuck animation can never strand a panel.
  const motionOff = () => {
    try { return !!(navigator.webdriver || window.__RWG_TEST__)
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return true; }
  };
  function dismiss(sel, ms) {
    const m = $(sel);
    if (!m || !m.firstElementChild) return;
    if (motionOff()) { m.innerHTML = ''; return; }
    if (m.dataset.closing) return;                       // Escape held down must not double-fire
    m.dataset.closing = '1';
    m.querySelectorAll('.drawer,.modal-card,.scrim').forEach(el => el.classList.add('leaving'));
    setTimeout(() => { m.innerHTML = ''; delete m.dataset.closing; }, ms);
  }

  function openLead(id, editing) {
    // Re-rendering the drawer after logging a call is a repaint, not an
    // arrival — without this it slid in from the right again every time.
    const refreshing = !!$('#drawer-mount .drawer');
    const body = refreshing ? $('#drawer-mount .drawer-body') : null;
    const scroll = body ? body.scrollTop : 0;
    state.leadId = id;
    state.editing = !!editing;
    const user = RWG.auth.currentUser();
    $('#drawer-mount').innerHTML = RWG.views.drawer(id, { isAdmin: user.role === 'admin', editing: state.editing });
    if (refreshing) {
      const d = $('#drawer-mount .drawer'); if (d) d.classList.add('no-enter');
      const s = $('#drawer-mount .scrim');  if (s) s.classList.add('no-enter');
      const b = $('#drawer-mount .drawer-body'); if (b) b.scrollTop = scroll;
    }
  }
  function closeDrawer() {
    state.leadId = null; state.editing = false;          // state first, always
    dismiss('#drawer-mount', 200);
  }
  /* A module can raise its own read-only side panel in the slot the lead
     drawer uses: same entrance, same scrim, same Escape, same ✕. Looking
     something up should not cost you the page you were reading. */
  function openPanel(html) {
    state.leadId = null; state.editing = false;
    const m = $('#drawer-mount'); if (m) m.innerHTML = html;
  }
  function refreshDrawer() { if (state.leadId) openLead(state.leadId, state.editing); }

  /* ────────────────────────── unsaved-changes guard
     Carlos, 21 Aug '26: "when we are inputting information, if we click
     out of that window it closes, and the information we inputted gets
     erased … give us the opportunity to go back, save and THEN close."
     A scrim that swallows ten minutes of typing is not a dismissal, it is
     a trapdoor.

     Two rules keep this from turning into the boy who cried wolf.

     ONLY A HAND CLOSES A WINDOW HERE. A save handler shuts its own window
     the moment the write is away; asking there would accuse somebody of
     losing the work they just saved. So the question is asked at the two
     places a person closes a window by hand — the click carrying
     data-action="close-modal"/"close-drawer" (the ✕, the scrim and Cancel
     all wear one of those), and peelTop(), which is Escape and the phone's
     Back button — and never inside closeModal()/closeDrawer(), which is
     the door the modules go through on their way out of a save.

     IT READS THE DOM, NOT A SNAPSHOT. Every field in this app is rendered
     with its answer already in the markup, so the browser is holding the
     original for us: defaultValue, defaultChecked, defaultSelected. There
     is nothing to register when a window opens and nothing to tear down
     when it closes, which is the only reason one function can cover the
     opportunity window, the task window and every other window in the app
     without a single module opting in. */

  /* Rich-text notes are contenteditable divs, and contenteditable has no
     defaultValue — the one thing the DOM does not remember for us, and
     exactly where the most typing is lost. Snapshot on the way in (focus
     always comes before typing) and compare on the way out, so a note
     typed and then undone reads as untouched, the same answer a plain
     input would give. The fallback set catches the odd path that reaches
     an editor without focusing it first (a dropped selection). Weak
     collections, so a window's editors are forgotten the instant its
     markup is thrown away — no cleanup, no leak. */
  const rtWas = new WeakMap();
  const rtTouched = new WeakSet();
  const rtSeen = (e) => (e.target && e.target.closest) ? e.target.closest('[contenteditable="true"]') : null;

  // Has this one field moved since the markup was drawn?
  function fieldDirty(el) {
    if (el.disabled || el.readOnly) return false;
    /* A tick that carries a data-action is a control, not a field: it
       writes the moment it is clicked and repaints itself. Reading it as
       unsaved would make every opportunity window with a checked-off step
       argue on the way out. */
    if (el.dataset && el.dataset.action) return false;
    if (el.tagName === 'SELECT') {
      const opts = el.options;
      if (el.multiple || el.size > 1) {
        for (let i = 0; i < opts.length; i++) if (opts[i].selected !== opts[i].defaultSelected) return true;
        return false;
      }
      /* A single select whose markup names no `selected` option still
         shows its first one — the browser chose it, the HTML never said
         so. Read that as the default (the last `selected` wins, per the
         spec, otherwise the first option) or every untouched dropdown in
         the app reports a change the instant its window opens, and this
         whole feature ships as a nuisance. */
      let def = -1;
      for (let i = 0; i < opts.length; i++) if (opts[i].defaultSelected) def = i;
      if (def < 0) def = opts.length ? 0 : -1;
      return el.selectedIndex !== def;
    }
    const type = String(el.type || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') return el.checked !== el.defaultChecked;
    /* A button holds no answer, and a hidden input cannot tell us one. For
       every type in HTML's "default" value mode — hidden, button, submit,
       reset, image — .value IS the value content attribute, so writing to
       it drags defaultValue along and the pair can never disagree. Worth
       saying out loud because the record picker keeps its committed
       pointer in exactly such a hidden input: asking that input whether it
       changed always gets "no", which is how this guard first shipped
       blind to somebody re-pointing a task at a different person. */
    if (type === 'hidden' || type === 'button' || type === 'submit'
        || type === 'reset' || type === 'image') return false;
    /* So the picker is read from its visible box instead. That box does two
       jobs: it SEARCHES while you type, and it holds the chosen record's
       own name once you pick one — and only the second is an answer.
       ui.pickerRec() is the widget's own account of what it points at right
       now, so "the box reads as the record it points at, and that is not
       the record it opened with" is a change; anything else is a query the
       app itself throws away on blur, and nobody should be stopped for it. */
    if (el.classList && el.classList.contains('pick-in')) {
      if (!U || typeof U.pickerRec !== 'function') return false;
      const rec = U.pickerRec(String(el.id || '').replace(/-in$/, ''));
      const label = (rec && rec.label) || '';
      return el.value === label && el.value !== el.defaultValue;
    }
    return el.value !== el.defaultValue;
  }

  // Is there unsaved typing anywhere inside this layer?
  function dirtyIn(root) {
    if (!root) return false;
    const f = root.querySelectorAll('input,select,textarea');
    for (let i = 0; i < f.length; i++) if (fieldDirty(f[i])) return true;
    const eds = root.querySelectorAll('[contenteditable="true"]');
    for (let i = 0; i < eds.length; i++) {
      const ed = eds[i];
      if (rtWas.has(ed)) { if (ed.innerHTML !== rtWas.get(ed)) return true; }
      else if (rtTouched.has(ed)) return true;
    }
    return false;
  }

  /* The question, in the app's own furniture rather than the browser's:
     confirm() puts the buttons in the operating system's order with the
     operating system's words, and "OK" is a terrible name for throwing
     away an afternoon. It needs a layer of its own — the app already
     stacks two deep, and the thing being guarded may be either of them —
     so it hangs off <body> in its own mount, the way toasts do, above
     both modal layers and the raised side panel but under the toast. */
  let guardDone = null;                      // the close waiting on an answer
  function guardEl() {
    let g = document.getElementById('guard-mount');
    if (g) return g;
    g = document.createElement('div');
    g.id = 'guard-mount';
    document.body.appendChild(g);
    g.addEventListener('click', (ev) => {
      const b = (ev.target && ev.target.closest) ? ev.target.closest('[data-guard]') : null;
      if (!b) return;
      ev.stopPropagation();                  // the app's own click handler has no business here
      answerGuard(b.dataset.guard === 'discard');
    });
    return g;
  }
  function answerGuard(discard) {
    const g = document.getElementById('guard-mount');
    if (g) g.innerHTML = '';
    const go = guardDone;
    guardDone = null;
    if (go && discard) go();
  }
  function askGuard() {
    const g = guardEl();
    g.innerHTML = `
      <div class="scrim scrim-guard" data-guard="back"></div>
      <div class="modal-card modal-sm modal-guard" role="dialog" aria-modal="true" aria-labelledby="guard-title">
        <div class="modal-head">
          <h2 id="guard-title">Unsaved changes</h2>
          <p>Something in this window has been typed or changed and not saved. Close it now and
             those edits are gone — the record keeps what it had before. Go back, save, and then close.</p>
        </div>
        <div class="modal-foot">
          <button class="btn btn-danger" data-guard="discard">Discard changes</button>
          <span class="topbar-spacer"></span>
          <button class="btn btn-gold" data-guard="back">Go back</button>
        </div>
      </div>`;
    /* Focus the way back, not the way out: Enter on a dialog nobody read
       should return you to your work. Escape means the same — see peelTop. */
    const back = g.querySelector('[data-guard="back"].btn');
    if (back && back.focus) back.focus();
  }

  /* Close `root`, asking first if there is anything in it worth keeping.
     Returns true if the close already happened; false means the question
     is on screen and the answer arrives by callback. */
  function closeGuarded(root, proceed) {
    if (guardDone) return false;             // already asking — a second Escape is not a second answer
    if (!dirtyIn(root)) { proceed(); return true; }
    guardDone = proceed;
    askGuard();
    return false;
  }
  // Which modal layer a close-modal click is actually aiming at — the same
  // answer closeModal() gives itself, so the guard reads the layer it peels.
  function topModal() {
    const m2 = $('#modal-mount-2');
    if (m2 && m2.firstElementChild) return m2;
    return $('#modal-mount');
  }

  /* Close the topmost thing on screen, one layer at a time, and say
     whether there was anything to close. Escape and the phone's Back
     button both mean "put this away", so they ask the same question. */
  function peelTop() {
    /* While it is up, the unsaved-changes question IS the top layer, and
       Escape on it means "go back to the window", never "discard". */
    if (guardDone) { answerGuard(false); return true; }
    const dm = $('#drawer-mount');
    if (dm && dm.firstElementChild) { closeGuarded(dm, closeDrawer); return true; }
    const m2 = $('#modal-mount-2');
    if (m2 && m2.firstElementChild) { closeGuarded(m2, closeModal); return true; }
    const m1 = $('#modal-mount');
    if (m1 && m1.firstElementChild) { closeGuarded(m1, closeModal); return true; }
    const open = document.querySelectorAll('.pop-panel:not([hidden])');
    if (open.length) { open.forEach(p => p.hidden = true); return true; }
    let had = false;
    const om = $('#omni-panel');
    if (om && !om.hidden) { closeOmni(); had = true; }
    const um = $('#user-menu');
    if (um && !um.hidden) { closeUserMenu(); had = true; }
    return had;
  }

  /* The phone's Back button. On a single-page app it means "leave the
     site", which is a brutal answer to someone who only wanted to shut a
     task window — Carlos lost his place to whatever tab he had been on
     before. So: one spare history entry is kept parked ahead of the app,
     Back spends it closing the top layer, and the entry is put straight
     back. With nothing left to close, leaving is a real intention and
     gets asked about once rather than happening by accident. */
  function guardHistory() {
    if (typeof history === 'undefined' || !history.pushState) return;
    try {
      history.replaceState({ rwg: 'root' }, '');
      history.pushState({ rwg: 'guard' }, '');
    } catch (e) { return; }               // some embedded browsers refuse
    const repark = () => { try { history.pushState({ rwg: 'guard' }, ''); } catch (e) {} };
    window.addEventListener('popstate', () => {
      if (peelTop()) { repark(); return; }
      if (confirm('Leave the Resilient CRM?' + String.fromCharCode(10, 10)
          + 'Nothing is lost — anything saved stays saved.')) {
        history.back();                   // spend the entry underneath us
        return;
      }
      repark();
    });
  }

  // ────────────────────────── modal (Add lead)
  function openModal(html) { const m = $('#modal-mount'); if (m) m.innerHTML = html; }
  /* Modals stack two deep: a task opened from inside the opportunity
     window lives on layer 2, over it. Closing — the ✕, the scrim, or
     Escape — peels the TOP layer only, so the window underneath (and
     whatever is half-typed in it) survives until its own close. */
  function closeModal() {
    const m2 = $('#modal-mount-2');
    if (m2 && m2.firstElementChild) { dismiss('#modal-mount-2', 150); return; }
    dismiss('#modal-mount', 150);
  }

  function buildAddLeadModal() {
    const u = RWG.auth.currentUser();
    const sel = (id, opts, val) => `<select id="${id}">${opts.map(o => `<option ${o === val ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    const fg = (label, inner) => `<div class="field-group"><label class="lbl">${label}</label>${inner}</div>`;
    const assignRow = u.role === 'admin'
      ? fg('Assign to', `<select id="nl-assign"><option value="">— Unassigned (pool) —</option>${D.agents().map(a => `<option value="${a.id}">${U.esc(a.name)}</option>`).join('')}</select>`)
      : `<p class="muted" style="font-size:13px;margin:2px 0 10px">This lead will be added to <b>your</b> leads.</p>`;
    return `
    <div class="scrim" data-action="close-modal"></div>
    <div class="modal-card" role="dialog" aria-label="Add lead">
      <div class="modal-head"><h2>Add a lead</h2><p>For a prospect from a call, email or referral — not a seminar list.</p></div>
      <div class="modal-body">
        <div class="field-row">${fg('First name', `<input id="nl-firstName" type="text">`)}${fg('Last name', `<input id="nl-lastName" type="text">`)}</div>
        <div class="field-row">${fg('Phone', `<input id="nl-phone" type="tel">`)}${fg('Email', `<input id="nl-email" type="email">`)}</div>
        <div class="field-row">${fg('Source', sel('nl-source', ['Inbound Call', 'Email', 'Referral', 'Walk-in', 'Other']))}${fg('Attended seminar', sel('nl-attended', D.ATTENDED_OPTS, 'No'))}</div>
        <div class="field-row">${fg('Age', `<input id="nl-age" type="number">`)}${fg('Years of Service', `<input id="nl-yos" type="number">`)}</div>
        <div class="field-row">${fg('Plan Type', sel('nl-planType', D.PLAN_TYPES, "Don't Know"))}${fg('Member Class', sel('nl-memberClass', D.MEMBER_CLASSES, 'Regular'))}</div>
        <div class="field-row">${fg('AFC / Salary', `<input id="nl-afc" type="number">`)}${fg('Employer', `<input id="nl-employer" type="text">`)}</div>
        ${assignRow}
        ${fg('Notes', U.noteEditor({ id: 'nl-notes', minHeight: '84px', placeholder: 'Context — where this lead came from, etc.' }))}
        <p class="gate-error" id="nl-err"></p>
      </div>
      <div class="modal-foot">
        <button class="btn btn-quiet" data-action="close-modal">Cancel</button>
        <button class="btn btn-gold" data-action="save-new-lead">Add lead</button>
      </div>
    </div>`;
  }

  function saveNewLead() {
    const v = (id) => { const el = $('#' + id); return el ? el.value.trim() : ''; };
    const first = v('nl-firstName'), last = v('nl-lastName'), phone = v('nl-phone'), email = v('nl-email');
    if (!first && !last) { $('#nl-err').textContent = 'Please enter at least a first or last name.'; return; }
    if (!phone && !email) { $('#nl-err').textContent = 'Add a phone or email so the lead is contactable.'; return; }
    const u = RWG.auth.currentUser();
    const fields = {
      firstName: first, lastName: last, phone, email,
      source: v('nl-source'), attended: v('nl-attended'),
      age: v('nl-age'), yos: v('nl-yos'), afc: v('nl-afc'),
      planType: v('nl-planType'), memberClass: v('nl-memberClass'),
      employer: v('nl-employer'), notes: U.noteRead('nl-notes'),
      assignedTo: (u.role === 'admin') ? (v('nl-assign') || null) : u.id
    };
    const lead = D.addLead(fields, u.id);
    closeModal();
    renderMain();
    openLead(lead.id);
    U.toast('Lead added', true);
  }

  /* ── Moving somebody's login to a different address ─────────
     Two steps, and the CRM can only do the second one.

     The address a person actually signs in with lives in Firebase
     Authentication. The browser SDK can change it for the account that is
     currently signed in and for nobody else, so no web app — this one
     included — can move a colleague's login without a server holding admin
     credentials. What this modal stores is the CRM's COPY: what the roster
     displays, and where the reset link below is sent.

     What it used to say was worse than saying nothing: remove the account
     and have them re-register with the new address. Re-registering mints a
     NEW uid, and every case (agentUid) and lead (assignedTo) still points
     at the old one. Following that advice would have quietly orphaned a
     producer's entire book. */

  function buildEditUserModal(userId) {
    const u = D.user(userId); if (!u) return '';
    const isOwner = (u.email || '').toLowerCase() === (RWG.OWNER_EMAIL || '').toLowerCase();
    return `
    <div class="scrim" data-action="close-modal"></div>
    <div class="modal-card" role="dialog" aria-label="Edit team member">
      <div class="modal-head"><h2>Edit team member</h2><p>Update their name, or move their login to a different email address.</p></div>
      <div class="modal-body">
        <div class="field-group"><label class="lbl">Name</label><input id="eu-name" type="text" value="${U.esc(u.name || '')}"></div>

        <div class="field-group"><label class="lbl">Login email</label>
          <div class="cell-sub">Signs in today with <b>${U.esc(u.email || '—')}</b></div>
          <div class="cell-sub mt-8">The sign-in address lives in Firebase Authentication, not in the CRM. No web page
            can change it for somebody else — that needs an admin credential, and a credential inside a browser is a
            credential everyone has. The Firebase console cannot edit it either; its ⋮ menu only resets, disables
            and deletes.</div>
          ${isOwner ? `<div class="cell-sub mt-8" style="color:var(--red)"><b>This is the owner account.</b>
            Its address is also written into the security rules (<code>isOwnerEmail</code>) and into
            <code>firebase-init.js</code> as <code>RWG.OWNER_EMAIL</code>. Changing it in Firebase and here is
            not enough — both of those have to change as well, or the owner bootstrap and the
            "the owner can't be removed" guard stop recognising you.</div>` : ''}
          <div class="cell-sub mt-8"><b>Step 1.</b> Run the tool in <code>EOS Second Brain\_Tools</code>:</div>
          <div class="cell-sub"><code>node rwg-set-email.js ${U.esc(u.email || 'old@address')} new@address.com --yes</code>
            <button class="btn btn-ghost btn-sm" data-action="copy-text" data-text="node rwg-set-email.js ${U.esc(u.email || 'old@address')} new@address.com --yes">📋 Copy</button></div>
          <div class="cell-sub mt-8">Without <code>--yes</code> it shows what it would do and changes nothing. Their
            password, their account id, and every case and lead they own are untouched — only the address moves.</div>
          <div class="cell-sub mt-8"><b>Step 2.</b> Only if the tool reported it could not update the CRM copy,
            record the new address here:</div>
          <input id="eu-email" type="email" value="${U.esc(u.email || '')}" placeholder="name@example.com">
          <div class="cell-sub mt-8">Typing here does not change the login. It changes what the CRM shows and where
            the reset link below is sent — Firebase is the only place the sign-in address really lives.</div></div>

        <div class="field-group"><label class="lbl">Password</label>
          <button class="btn btn-ghost btn-sm" data-action="admin-reset-pass" data-email="${U.esc(u.email || '')}">✉ Send password-reset link</button>
          <div class="cell-sub mt-8">Emails a secure link to the address recorded above. If it comes back
            "No account found", that is step 2 having been missed: the CRM and Firebase disagree about
            where this person signs in.</div></div>
        <p class="gate-error" id="eu-err"></p>
      </div>
      <div class="modal-foot">
        <button class="btn btn-quiet" data-action="close-modal">Cancel</button>
        <button class="btn btn-gold" data-action="save-user" data-id="${u.id}">Save</button>
      </div>
    </div>`;
  }

  function saveUser(id) {
    const u = D.user(id);
    const err = $('#eu-err');
    const fail = (m) => { if (err) err.textContent = m; };
    const name = $('#eu-name') ? $('#eu-name').value.trim() : '';
    const email = $('#eu-email') ? $('#eu-email').value.trim().toLowerCase() : '';
    if (!name) return fail('Name cannot be empty.');
    if (!email) return fail('Email cannot be empty — it is how they sign in.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('That does not look like an email address.');

    const was = (u && (u.email || '')).toLowerCase();
    const moved = email !== was;
    /* Asked once, plainly, because the failure it prevents is silent from
       here: the CRM would look right and the person would still be signing
       in somewhere else. */
    if (moved && !confirm('Record ' + email + ' as ' + ((u && u.name) || 'this person') + "'s email?\n\n" +
        'This updates the CRM only. If you have not already changed it in Firebase Authentication, they will ' +
        'still sign in with ' + (was || 'their old address') + ' and the reset link will fail.')) return;

    if (name !== (u && u.name)) D.setUserName(id, name);
    if (!moved) { closeModal(); renderMain(); U.toast('Saved', true); return; }
    D.setUserEmail(id, email)
      .then(() => { closeModal(); renderMain(); U.toast('Recorded — check Firebase says the same', true); })
      .catch(e => fail((e && e.message) || 'That did not save.'));
  }

  const appBaseUrl = () => location.origin + location.pathname;   // e.g. https://crm.yourresilientwealth.com/
  function buildInviteModal() {
    const url = appBaseUrl();
    const msg = `You're invited to join the Resilient Wealth Group CRM.\n\n1. Open this link: ${url}\n2. Click "Request access" and sign up with your email.\n3. I'll approve your account and you'll be in.\n\n— Resilient Wealth Group`;
    return `
    <div class="scrim" data-action="close-modal"></div>
    <div class="modal-card" role="dialog" aria-label="Invite a teammate">
      <div class="modal-head"><h2>Invite a teammate</h2><p>Email them a link to join — they sign up, then you approve them in one click.</p></div>
      <div class="modal-body">
        <div class="field-group"><label class="lbl">Their email</label><input id="inv-email" type="email" placeholder="name@example.com"></div>
        <div class="field-group"><label class="lbl">Invite message</label><textarea id="inv-msg" rows="7">${U.esc(msg)}</textarea>
          <div class="cell-sub mt-8">Edit if you like, then send by email or copy it to a text/Slack.</div></div>
        <p class="cell-sub">After they sign up, they appear under <b>Pending approvals</b> on this page — approve with one click.</p>
      </div>
      <div class="modal-foot">
        <button class="btn btn-quiet" data-action="close-modal">Cancel</button>
        <button class="btn btn-ghost" data-action="invite-copy">Copy message</button>
        <button class="btn btn-gold" data-action="invite-email">✉ Open email</button>
      </div>
    </div>`;
  }

  function saveLeadEdits(id) {
    const updates = {};
    D.EDITABLE_FIELDS.forEach(f => { const el = $('#edit-' + f.key); if (el) updates[f.key] = el.value; });
    const res = D.updateLeadFields(id, updates, RWG.auth.currentUser().id);
    openLead(id, false);
    renderMain();
    if (res.changes.length) U.toast(`Saved — ${res.changes.length} field${res.changes.length > 1 ? 's' : ''} updated`, true);
    else U.toast('No changes to save');
  }

  // ────────────────────────── actions: lead workflow
  function saveActivity(id) {
    const typeBtn = $('#act-type .active');
    const type = typeBtn ? typeBtn.dataset.type : 'Call';
    const dispo = $('#act-dispo') ? $('#act-dispo').value : '';
    let reached = $('#act-reached') ? $('#act-reached').checked : false;
    if (dispo === 'Reached (pitched)') reached = true;
    const note = U.noteRead('act-note');
    D.addActivity(id, { type, disposition: dispo, note, reached, by: RWG.auth.currentUser().id });
    U.toast('Activity logged', true);
    refreshDrawer(); renderMain();
  }
  function confirmAppt(id) {
    const v = $('#appt-dt') ? $('#appt-dt').value : '';
    if (!v) { U.toast('Pick a date & time first'); return; }
    const ts = new Date(v).getTime();
    const me = RWG.auth.currentUser().id;
    D.setStage(id, 'Appointment Set', { apptDate: ts }, me);
    D.addActivity(id, { type: 'Other', disposition: 'Appointment Set', note: 'Appointment scheduled for ' + U.fmtDateTime(ts), reached: false, by: me });
    U.toast('Appointment set 🎉', true);
    refreshDrawer(); renderMain();
  }
  function confirmCallback(id) {
    const v = $('#callback-dt') ? $('#callback-dt').value : '';
    if (!v) { U.toast('Pick a date & time first'); return; }
    const ts = new Date(v).getTime();
    const note = U.noteRead('act-note');
    D.scheduleCallback(id, ts, note, RWG.auth.currentUser().id);
    U.toast('Callback scheduled 📞', true);
    refreshDrawer(); renderMain();
  }
  function graduate(id, stage) {
    const extra = (stage === 'No Opportunity' || stage === 'Opportunity Opened') ? { outcome: stage } : {};
    D.setStage(id, stage, extra, RWG.auth.currentUser().id);
    U.toast(stage === 'Opportunity Opened' ? 'Opportunity opened ✦ handed off' : stage, true);
    refreshDrawer(); renderMain();
  }
  // Drag a card to another pipeline column
  function moveStage(id, stage) {
    const lead = D.lead(id);
    if (!lead || !stage || lead.stage === stage) { renderMain(); return; }
    D.setStage(id, stage, {}, RWG.auth.currentUser().id);
    renderMain();
    if (stage === 'Appointment Set' && !D.lead(id).apptDate) {
      openLead(id);
      const r = $('#appt-row'); if (r) r.hidden = false;
      U.toast('Moved to Appointment Set — add the date & time', true);
    } else {
      if (state.leadId === id) refreshDrawer();
      U.toast('Moved to ' + stage, true);
    }
  }

  // ────────────────────────── auth forms
  async function doLogin(form) {
    const err = $('#login-error'); if (err) err.textContent = 'Signing in…';
    const remember = $('#login-remember') ? $('#login-remember').checked : true;
    const r = await RWG.auth.login($('#login-email').value, $('#login-pass').value, remember);
    if (!r.ok && err) err.textContent = r.error;   // success → onAuthChange renders the app
  }
  async function doSignup(form) {
    const su = $('#su-error'); if (su) su.textContent = 'Creating your account…';
    const r = await RWG.auth.signup({ name: $('#su-name').value, email: $('#su-email').value, password: $('#su-pass').value });
    if (!r.ok) { if (su) su.textContent = r.error; return; }
    if (su) su.textContent = '';
    const ok = $('#su-success'); if (ok) ok.hidden = false;   // auto-signed-in → pending screen appears
  }
  function gateTab(tab) {
    document.querySelectorAll('.gate-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('[data-panel]').forEach(p => p.hidden = (p.dataset.panel !== tab));
  }

  // ────────────────────────── upload pipeline
  function wireUpload() {
    const input = $('#file-input'), dz = $('#dropzone');
    if (input) input.addEventListener('change', e => { if (e.target.files[0]) readFile(e.target.files[0]); });
    if (dz) {
      ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
      ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
      dz.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) readFile(f); });
    }
  }
  function readFile(file) {
    state.importName = file.name.replace(/\.csv$/i, '');
    const r = new FileReader();
    r.onload = () => { const rows = mapRows(parseCSV(r.result)); state.importRows = rows; renderPreview(rows); };
    r.readAsText(file);
  }
  function parseCSV(text) {
    const rows = []; let row = [], cur = '', q = false;
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else {
        if (ch === '"') q = true;
        else if (ch === ',') { row.push(cur); cur = ''; }
        else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
        else cur += ch;
      }
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    if (!rows.length) return [];
    const headers = rows.shift().map(h => h.trim());
    return rows.filter(r => r.some(c => c.trim() !== '')).map(r => {
      const o = {}; headers.forEach((h, i) => o[h] = (r[i] || '').trim()); return o;
    });
  }
  function mapRows(records) {
    // priority order matters (afc before age to avoid "average" collision)
    const FIELDS = [
      ['email', /e-?mail/i], ['phone', /phone|mobile|cell/i],
      ['afc', /afc|salary|compensation/i], ['age', /\bage\b|dob|birth/i],
      ['yos', /yos|years/i], ['planType', /plan/i], ['memberClass', /member|class|risk/i],
      ['employer', /employer|agency|department/i], ['attended', /attend/i],
      ['disposition', /disposition|status/i], ['attempts', /attempt/i],
      ['firstName', /first/i], ['lastName', /last|surname/i], ['notes', /note|comment/i]
    ];
    return records.map(rec => {
      const out = {}; const used = {};
      Object.keys(rec).forEach(h => {
        for (const [field, rx] of FIELDS) {
          if (used[field]) continue;
          if (rx.test(h)) { out[field] = rec[h]; used[field] = 1; break; }
        }
      });
      if (!out.firstName && !out.lastName) {
        const nameKey = Object.keys(rec).find(h => /name/i.test(h));
        if (nameKey) { const p = rec[nameKey].split(' '); out.firstName = p.shift() || ''; out.lastName = p.join(' '); }
      }
      ['age', 'yos', 'attempts'].forEach(k => { if (out[k] != null) out[k] = parseFloat(String(out[k]).replace(/[^\d.]/g, '')) || null; });
      if (out.afc != null) out.afc = parseFloat(String(out.afc).replace(/[^\d.]/g, '')) || null;
      return out;
    });
  }
  function renderPreview(rows) {
    const el = $('#upload-preview'); if (!el) return;
    if (!rows.length) { el.innerHTML = `<div class="card"><p class="muted mb-0">Couldn't read any rows from that file. Make sure it's a CSV with a header row.</p></div>`; return; }
    const cls = D.classifyImport(rows);
    let nNew = 0, nRet = 0, nDup = 0;
    cls.forEach(c => { if (c.status === 'returning') nRet++; else if (c.status === 'duplicate') nDup++; else nNew++; });
    const tierCount = { GOLD: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    const scored = rows.map((r, i) => { const s = RWG.scoring.scoreLead(r); tierCount[s.tier]++; return { r, s, c: cls[i] }; });
    const body = scored.slice(0, 40).map(({ r, s, c }) => {
      const prior = c.match;
      const flag = c.status === 'returning'
        ? `<span class="chip tier-gold" title="Already in your database">🔁 Returning</span>`
        : c.status === 'duplicate'
          ? `<span class="pill-soft" title="Listed more than once in this file — will be merged">Duplicate row</span>`
          : `<span class="pill-soft">🆕 New</span>`;
      const sub = (c.status === 'returning' && prior)
        ? `In database${prior.assignedTo ? ' · ' + ((D.user(prior.assignedTo) || {}).name || '').split(' ')[0] : ''}${prior.disposition ? ' · ' + prior.disposition : (prior.stage ? ' · ' + prior.stage : '')}`
        : U.esc(r.employer || '');
      return `<tr>
        <td><div class="cell-name">${U.esc((r.firstName || '') + ' ' + (r.lastName || ''))}</div><div class="cell-sub">${U.esc(sub)}</div></td>
        <td>${flag}</td><td>${U.tierChip(s)}</td><td>${U.scoreBar(s)}</td>
        <td>${U.esc(RWG.scoring.normPlan(r.planType))}</td><td class="num">${r.yos ?? '—'}/${r.age ?? '—'}</td><td>${U.moneyK(r.afc)}</td></tr>`;
    }).join('');
    el.innerHTML = `
      <div class="card">
        <div class="card-head"><h3>Preview · ${rows.length} rows</h3>
          <div class="tag-row" style="margin-left:auto">
            <span class="pill-soft">🆕 ${nNew} new</span>${nRet ? `<span class="chip tier-gold">🔁 ${nRet} returning</span>` : ''}${nDup ? `<span class="pill-soft">${nDup} dup row${nDup === 1 ? '' : 's'}</span>` : ''}
            <span class="fbar-sep"></span>
            <span class="chip tier-gold">★ ${tierCount.GOLD}</span><span class="chip tier-high">${tierCount.HIGH}</span>
            <span class="chip tier-medium">${tierCount.MEDIUM}</span><span class="chip tier-low">${tierCount.LOW}</span></div></div>
        ${nRet ? `<p class="muted" style="font-size:12.5px;margin:-4px 0 10px">🔁 <b>${nRet}</b> ${nRet === 1 ? 'person is' : 'people are'} already in your database — they won't be duplicated. We'll merge this seminar into their existing record, flag them as <b>Returning</b>, hand them to the agent you choose below, and re-open any that had gone cold.${nDup ? ` (${nDup} duplicate row${nDup === 1 ? '' : 's'} within the file will be merged too.)` : ''}</p>` : (nDup ? `<p class="muted" style="font-size:12.5px;margin:-4px 0 10px">${nDup} duplicate row${nDup === 1 ? '' : 's'} within this file will be merged so no one is added twice.</p>` : '')}
        <div class="table-wrap"><table class="data"><thead><tr><th>Lead</th><th>Status</th><th>Tier</th><th>Score</th><th>Plan</th><th>YOS/Age</th><th>AFC</th></tr></thead><tbody>${body}</tbody></table></div>
        ${rows.length > 40 ? `<p class="muted center mt-8" style="font-size:12.5px">…and ${rows.length - 40} more</p>` : ''}
        <div class="mt-16" style="display:flex;justify-content:flex-end;gap:10px">
          <button class="btn btn-quiet btn-sm" data-action="cancel-import">Cancel</button>
          <button class="btn btn-gold" data-action="confirm-import">Import ${rows.length} leads</button>
        </div>
      </div>`;
  }
  function confirmImport() {
    const target = $('#assign-target') ? $('#assign-target').value : '';
    const by = RWG.auth.currentUser().id;
    const total = (state.importRows || []).length;
    D.addLeadsSmart(state.importRows, state.importName || 'Imported list', target || null, by).then(sum => {
      const bits = [];
      if (sum.created) bits.push(sum.created + ' new');
      if (sum.returning) bits.push(sum.returning + ' returning');
      let msg = 'Imported ' + (bits.join(' · ') || (total + ' leads'));
      if (sum.reopened) msg += ' · ' + sum.reopened + ' re-opened';
      if (sum.duplicates) msg += ' · ' + sum.duplicates + ' dup merged';
      U.toast(msg, true);
    });
    state.importRows = null; state.tierFilter = 'ALL';
    nav('leads');
  }
  function loadSampleList() {
    const samples = [
      { firstName: 'Nina', lastName: 'Alvarez', email: 'nalvarez@email.com', phone: '(305) 555-0301', age: 60, yos: 29, planType: 'Investment Plan', afc: 108000, employer: 'Miami-Dade County', attended: 'Yes' },
      { firstName: 'Oscar', lastName: 'Diaz', email: 'odiaz@email.com', phone: '(407) 555-0302', age: 57, yos: 27, planType: 'Pension Plan', memberClass: 'Special Risk', afc: 99000, employer: 'Orlando Fire Dept', attended: 'Yes' },
      { firstName: 'Rita', lastName: 'Sims', email: 'rsims@email.com', phone: '(813) 555-0303', age: 41, yos: 11, planType: "Don't Know", afc: 63000, employer: 'Tampa Schools', attended: 'No' },
      { firstName: 'Leo', lastName: 'Park', email: 'lpark@email.com', phone: '(561) 555-0304', age: 34, yos: 7, planType: 'Pension Plan', afc: 51000, employer: 'Boca Raton', attended: 'Unknown' },
      { firstName: 'Gina', lastName: 'Ross', email: 'gross@email.com', phone: '(904) 555-0305', age: 62, yos: 31, planType: 'DROP', afc: 117000, employer: 'Jacksonville Port', attended: 'Yes' }
    ];
    D.addLeads(samples, 'Sample FRS list', null);
    U.toast('Added 5 sample leads', true);
    renderMain();
  }
  function downloadCSV(filename, csv) {
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });   // BOM = Excel reads UTF-8 cleanly
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }
  function downloadTemplate() {
    const headers = ['Attended', 'First Name', 'Last Name', 'Email', 'Phone Number', 'Age', 'YOS', 'Plan Type', 'Member Class', 'AFC/Salary', 'Employer Name', 'Disposition', 'Number of Attempts', 'Notes'];
    downloadCSV('RWG_lead_list_template.csv', headers.join(','));
  }
  // Export the current view (filters + sort, in display order) to CSV
  function exportLeads() {
    if (!RWG.auth.isAdmin()) return;   // owner-only
    const { filtered } = currentTableLeads();
    if (!filtered.length) { U.toast('No leads to export in this view'); return; }
    const stamp = new Date().toISOString().slice(0, 10);
    const scope = isAdminLeads() ? 'all' : 'my';
    downloadCSV(`RWG_leads_${scope}_${filtered.length}_${stamp}.csv`, RWG.leadtable.toCSV(filtered));
    U.toast(`Exported ${filtered.length} lead${filtered.length > 1 ? 's' : ''} to CSV`, true);
  }

  // ────────────────────────── settings
  function saveScoring() {
    const n = id => parseFloat($('#' + id).value);
    const cfg = {
      drop: { regular: { yos: n('cfg-reg-yos'), age: n('cfg-reg-age') }, specialRisk: { yos: n('cfg-sr-yos'), age: n('cfg-sr-age') } },
      inServiceAge: n('cfg-inservice'), investmentHighYos: n('cfg-invhi'),
      afc: { high: n('cfg-afc-hi'), mid: n('cfg-afc-mid'), low: RWG.scoring.defaultConfig.afc.low },
      tierCutoffs: { gold: n('cfg-cut-gold'), high: n('cfg-cut-high'), medium: n('cfg-cut-med') }
    };
    D.setScoringConfig(cfg);
    U.toast('Scoring rules saved — leads re-scored', true);
    renderMain();
  }

  // ────────────────────────── event wiring
  function handleAction(a, el, e) {
    /* A hand on the way out. The ✕, the scrim and every Cancel button in
       the app carry one of these two actions, so this single pair of lines
       is the whole clicked-it-closed path — which is why no module needs a
       flag, a snapshot or a line of its own. Everything below (and every
       closeModal() a save calls once its write is away) is unguarded on
       purpose: see the unsaved-changes guard above peelTop(). */
    if (a === 'close-modal') { closeGuarded(topModal(), closeModal); return; }
    if (a === 'close-drawer') { closeGuarded($('#drawer-mount'), closeDrawer); return; }
    // A module that claims this action owns it. Everything below is the
    // kernel's core set plus the legacy Leads actions (to be extracted later).
    const owner = RWG.modules.actionOwner(a);
    if (owner) { owner.actions[a](el, e, owner.state); return; }

    switch (a) {
      case 'gate-tab': gateTab(el.dataset.tab); break;
      case 'forgot-pass': {
        const email = ($('#login-email') ? $('#login-email').value : '').trim();
        const err = $('#login-error');
        if (!email) { if (err) err.textContent = 'Enter your email above, then click “Forgot password?”'; break; }
        if (err) err.textContent = 'Sending reset link…';
        RWG.auth.resetPassword(email).then(r => {
          if (r.ok) { if (err) err.textContent = ''; U.toast('Password reset link sent — check your email', true); }
          else if (err) err.textContent = r.error;
        });
        break;
      }
      case 'logout': state.view = null; RWG.auth.logout(); break;   // onAuthChange re-renders
      case 'nav': closeUserMenu(); nav(el.dataset.view); break;
      case 'toggle-menu': { const sb = $('#sidebar'); if (sb) sb.classList.toggle('open'); break; }
      case 'toggle-user-menu': {
        const m = $('#user-menu');
        if (m) {
          m.hidden = !m.hidden;
          if (el.setAttribute) el.setAttribute('aria-expanded', String(!m.hidden));
        }
        break;
      }
      case 'open-lead': openLead(el.dataset.id); break;
      case 'close-drawer': closeDrawer(); break;
      case 'edit-lead': openLead(el.dataset.id, true); break;
      case 'cancel-edit': openLead(state.leadId, false); break;
      case 'save-lead': saveLeadEdits(el.dataset.id); break;
      case 'add-lead': openModal(buildAddLeadModal()); break;
      case 'close-modal': closeModal(); break;
      case 'save-new-lead': saveNewLead(); break;
      case 'save-activity': saveActivity(el.dataset.id); break;
      case 'toggle-appt': { const r = $('#appt-row'); if (r) r.hidden = !r.hidden; break; }
      case 'confirm-appt': confirmAppt(el.dataset.id); break;
      case 'toggle-callback': { const r = $('#callback-row'); if (r) r.hidden = !r.hidden; break; }
      case 'confirm-callback': confirmCallback(el.dataset.id); break;
      case 'graduate': graduate(el.dataset.id, el.dataset.stage); break;
      case 'pick-stage': {   // stacked-card stage menu (mobile) → same path as a board drag
        document.querySelectorAll('.pop-panel:not([hidden])').forEach(p => p.hidden = true);
        moveStage(el.dataset.id, el.dataset.stage);
        break;
      }
      case 'flt-tier': {   // board quick-chips → colFilters.tier
        const t = el.dataset.tier, f = currentFilter();
        f.colFilters = f.colFilters || {}; const arr = f.colFilters.tier = f.colFilters.tier || [];
        const i = arr.indexOf(t); if (i >= 0) arr.splice(i, 1); else arr.push(t);
        if (!arr.length) delete f.colFilters.tier;
        clearSelection(); renderMain(); break;
      }
      case 'flt-clear': {
        if (isAdminLeads()) state.adminFilter = newFilter(); else state.agentFilter = newFilter();
        state.search = ''; const s = $('#global-search'); if (s) s.value = ''; clearSelection(); renderMain(); break;
      }
      case 'popmenu': {
        const p = el.parentElement.querySelector('.pop-panel'); if (!p) break;
        const willOpen = p.hidden;
        document.querySelectorAll('.pop-panel:not([hidden])').forEach(x => x.hidden = true);
        if (willOpen) { positionPanel(el, p); const s = p.querySelector('.pop-search'); if (s) s.focus(); }
        break;
      }
      case 'popsort': { const f = currentFilter(); f.sortKey = el.dataset.col; f.sortDir = el.dataset.dir; renderMain(); break; }
      case 'cols-reset': {
        const def = RWG.leadtable.defaultVisible(isAdminLeads());
        if (isAdminLeads()) state.adminCols = def; else state.agentCols = def;
        saveCols(currentColsKey(), def);
        document.querySelectorAll('input[data-col]').forEach(cb => { cb.checked = cb.dataset.col === 'name' || def.includes(cb.dataset.col); });
        refreshLeadsBody();   // keep the chooser open
        break;
      }
      case 'colfilter-all': {   // select every value present for this column
        const key = el.dataset.col, f = currentFilter(), c = currentTableLeads();
        f.colFilters = f.colFilters || {};
        f.colFilters[key] = RWG.leadtable.distinctValues(c.base, key);
        document.querySelectorAll(`input[data-colfilter="${key}"]`).forEach(cb => cb.checked = true);
        clearSelection(); refreshLeadsBody(); updateBulkUI(); break;
      }
      case 'colfilter-clear': {
        const key = el.dataset.col, f = currentFilter();
        if (f.colFilters) delete f.colFilters[key];
        document.querySelectorAll(`input[data-colfilter="${key}"]`).forEach(cb => cb.checked = false);
        clearSelection();
        refreshLeadsBody(); updateBulkUI();
        break;
      }
      case 'bulk-assign': {
        const sel = $('#bulk-agent'), v = sel ? sel.value : '';
        if (!v) { U.toast('Pick an agent to reassign to'); break; }
        const ids = Array.from(state.selected), me = RWG.auth.currentUser().id;
        ids.forEach(id => D.assignLead(id, v === 'unassigned' ? null : v, me));
        const who = v === 'unassigned' ? 'the unassigned pool' : D.user(v).name.split(' ')[0];
        U.toast(`Reassigned ${ids.length} lead${ids.length > 1 ? 's' : ''} → ${who}`, true);
        state.selected.clear(); state.assignTarget = null; renderMain(); break;
      }
      case 'bulk-clear': state.selected.clear(); renderMain(); break;
      case 'bulk-delete': {
        if (!RWG.auth.isAdmin()) break;
        const ids = Array.from(state.selected);
        if (!ids.length) break;
        if (confirm(`Delete ${ids.length} lead${ids.length > 1 ? 's' : ''}? They're moved to Deleted Leads (admin archive), where you can restore them.`)) {
          const me = RWG.auth.currentUser().id;
          ids.forEach(id => D.deleteLead(id, me));
          state.selected.clear(); renderMain();
          U.toast(`Deleted ${ids.length} lead${ids.length > 1 ? 's' : ''} — kept in the archive`);
        }
        break;
      }
      case 'delete-lead': {
        if (!RWG.auth.isAdmin()) break;
        const id = el.dataset.id, l = D.lead(id);
        if (confirm(`Delete ${l ? D.fullName(l) : 'this lead'}? It's moved to Deleted Leads (admin archive), where you can restore it.`)) {
          D.deleteLead(id, RWG.auth.currentUser().id); closeDrawer(); renderMain(); U.toast('Lead deleted — kept in the archive');
        }
        break;
      }
      case 'archive-refresh': { if (RWG.auth.isAdmin()) { state.archiveRows = null; loadArchive(); } break; }
      case 'restore-lead': {
        if (!RWG.auth.isAdmin()) break;
        const id = el.dataset.id;
        const row = (state.archiveRows || []).find(r => r.id === id);
        const nm = row ? row.name : 'this lead';
        if (confirm(`Restore ${nm} back into the CRM? It reappears in All Leads with its original owner and full history.`)) {
          D.restoreLead(id, RWG.auth.currentUser().id).then(() => {
            state.archiveRows = (state.archiveRows || []).filter(r => r.id !== id);
            paintArchive(); U.toast('Lead restored', true);
          }).catch(e => U.toast(e.message || 'Restore failed'));
        }
        break;
      }
      case 'purge-lead': {
        if (!RWG.auth.isAdmin()) break;
        const id = el.dataset.id;
        const row = (state.archiveRows || []).find(r => r.id === id);
        const nm = row ? row.name : 'this record';
        if (confirm(`Permanently erase ${nm} from the archive? This cannot be undone — no record of this lead will remain anywhere.`)) {
          D.purgeDeletedLead(id).then(() => {
            state.archiveRows = (state.archiveRows || []).filter(r => r.id !== id);
            paintArchive(); U.toast('Erased from the archive');
          }).catch(e => U.toast(e.message || 'Erase failed'));
        }
        break;
      }
      case 'set-role': {
        if (!RWG.auth.isAdmin()) break;
        const me = RWG.auth.currentUser();
        if (el.dataset.id === me.id) break;   // can't change your own role
        D.setUserRole(el.dataset.id, el.dataset.role);
        U.toast(el.dataset.role === 'admin' ? 'Promoted to admin' : 'Changed to agent', true);
        renderMain();
        break;
      }
      case 'invite': if (RWG.auth.isAdmin()) openModal(buildInviteModal()); break;
      case 'invite-email': {
        const email = $('#inv-email') ? $('#inv-email').value.trim() : '';
        const msg = $('#inv-msg') ? $('#inv-msg').value : '';
        const subject = 'Your invite to the Resilient Wealth Group CRM';
        window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(msg)}`;
        break;
      }
      case 'invite-copy': {
        const t = $('#inv-msg'), msg = t ? t.value : '';
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(msg).then(() => U.toast('Invite copied', true), () => { if (t) t.select(); });
        else if (t) { t.select(); try { document.execCommand('copy'); U.toast('Invite copied', true); } catch (e) {} }
        break;
      }
      case 'edit-user': if (RWG.auth.isAdmin()) openModal(buildEditUserModal(el.dataset.id)); break;
      case 'save-user': if (RWG.auth.isAdmin()) saveUser(el.dataset.id); break;
      case 'copy-text': {
        const txt = el.dataset.text || '';
        if (txt && navigator.clipboard && navigator.clipboard.writeText)
          navigator.clipboard.writeText(txt).then(() => U.toast('Copied', true), () => U.toast(txt));
        else if (txt) U.toast(txt);
        break;
      }
      case 'admin-reset-pass': {
        if (!RWG.auth.isAdmin()) break;
        const email = el.dataset.email;
        RWG.auth.resetPassword(email).then(r => U.toast(r.ok ? ('Reset link sent to ' + email) : r.error, r.ok));
        break;
      }
      case 'remove-user': {
        if (!RWG.auth.isAdmin()) break;
        const me = RWG.auth.currentUser(), u = D.user(el.dataset.id);
        if (el.dataset.id === me.id) break;
        if (u && (u.email || '').toLowerCase() === (RWG.OWNER_EMAIL || '').toLowerCase()) { U.toast('The owner account can’t be removed'); break; }
        if (confirm(`Remove ${u ? u.name : 'this person'}? They lose access immediately, and their leads return to the Unassigned pool so you can hand them to someone else. If you restore this person later, those leads do NOT come back to them automatically.`)) {
          const freed = D.removeUser(el.dataset.id);
          U.toast(`Removed ${u ? u.name.split(' ')[0] : 'agent'}${freed ? ' · ' + freed + ' lead' + (freed === 1 ? '' : 's') + ' moved to Unassigned' : ''}`);
          renderMain();
        }
        break;
      }
      case 'restore-user': {
        if (!RWG.auth.isAdmin()) break;
        D.approveUser(el.dataset.id);   // status → active (role preserved); they sign in again to regain access
        U.toast('Access restored — they can sign back in', true);
        renderMain();
        break;
      }
      case 'assign-to-agent': {   // Team shortcut → jump to All Leads, pool-filtered, with this agent pre-selected
        if (!RWG.auth.isAdmin()) break;
        const a = D.user(el.dataset.id);
        state.assignTarget = el.dataset.id;
        state.adminFilter.colFilters = Object.assign({}, state.adminFilter.colFilters || {}, { owner: ['Unassigned'] });
        state.search = ''; const gs = $('#global-search'); if (gs) gs.value = '';
        nav('leads');
        U.toast(`Pick the unassigned leads for ${a ? a.name.split(' ')[0] : 'this agent'}, then hit Apply`, true);
        break;
      }
      case 'view-as': {
        if (!RWG.auth.isAdmin()) break;
        state.viewAs = el.dataset.id; state.view = 'board'; state.search = ''; clearSelection();
        render();
        break;
      }
      case 'exit-view-as': {
        state.viewAs = null; state.view = 'dashboard'; state.search = ''; clearSelection();
        render();
        break;
      }
      case 'export-leads': exportLeads(); break;
      case 'report-prev': { const A = RWG.analytics; if (state.reportWeekStart == null) state.reportWeekStart = curWeekStart(); state.reportWeekStart = A.weekStartOf(state.reportWeekStart - 4 * 86400000); loadOrPaintReport(); break; }
      case 'report-next': { const A = RWG.analytics; if (state.reportWeekStart == null) state.reportWeekStart = curWeekStart(); const n = A.weekStartOf(state.reportWeekStart + 10 * 86400000); if (n <= curWeekStart()) { state.reportWeekStart = n; loadOrPaintReport(); } break; }
      case 'report-this': state.reportWeekStart = curWeekStart(); loadOrPaintReport(); break;
      case 'report-export': if (RWG.auth.isAdmin()) exportReport(); break;
      case 'report-backfill-tiers': {   // add the tier split to a snapshot frozen before the feature existed
        if (!RWG.auth.isAdmin()) break;
        const A = RWG.analytics, ws = state.reportWeekStart;
        if (ws == null || ws >= curWeekStart()) break;             // current week is always live
        const wid = A.weekId(ws), snap = state.reportCache[wid];
        if (!snap) break;
        const live = A.weeklyReport(A.weekRangeFor(ws));            // recompute from surviving lead history
        const zero = () => ({ GOLD: 0, HIGH: 0, MEDIUM: 0, LOW: 0 });
        const byUid = {}; (live.agents || []).forEach(a => { byUid[a.uid] = a.apptTiers; });
        (snap.agents || []).forEach(a => { a.apptTiers = byUid[a.uid] || zero(); });
        snap.team = snap.team || {};
        snap.team.apptTiers = (snap.agents || []).reduce((s, a) => { ['GOLD', 'HIGH', 'MEDIUM', 'LOW'].forEach(k => s[k] += (a.apptTiers[k] || 0)); return s; }, zero());
        D.saveReport(wid, snap).catch(e => console.error('backfill save:', e));
        state.reportCache[wid] = snap;
        paintReport(snap, A.weekLabel(ws), 'final');
        U.toast('Tier breakdown rebuilt from lead history', true);
        break;
      }
      case 'approve-user': D.approveUser(el.dataset.id); U.toast('Agent approved', true); renderShell(RWG.auth.currentUser()); break;
      case 'deny-user': D.denyUser(el.dataset.id); U.toast('Request removed'); renderShell(RWG.auth.currentUser()); break;
      case 'load-sample-list': loadSampleList(); break;
      case 'download-template': downloadTemplate(); break;
      case 'confirm-import': confirmImport(); break;
      case 'cancel-import': state.importRows = null; $('#upload-preview').innerHTML = ''; break;
      case 'recount-attempts': {
        if (!RWG.auth.isAdmin()) break;
        D.recountAttempts().then(dry => {                       // dry run first, always
          if (!dry.changed.length) { U.toast('Every lead already matches its logged outreach'); return; }
          const sample = dry.changed.slice(0, 6).map(c => `  ${c.name}: ${c.from} → ${c.to}`).join('\n');
          const more = dry.changed.length > 6 ? `\n  …and ${dry.changed.length - 6} more` : '';
          const n = dry.changed.length;
          if (!confirm(`Update Attempts on ${n} lead${n === 1 ? '' : 's'}?\n\n${sample}${more}\n\nThis writes to the shared lead records, so the live CRM will show the corrected numbers too.`)) return;
          D.recountAttempts({ apply: true }).then(res => {
            U.toast(`Recounted ${res.changed.length} lead${res.changed.length === 1 ? '' : 's'}`, true);
            renderMain();
          }).catch(e => U.toast(e.message || 'Recount failed'));
        });
        break;
      }
      case 'save-scoring': saveScoring(); break;
      case 'reset-scoring': D.setScoringConfig({}); U.toast('Scoring reset to defaults'); renderMain(); break;
    }
  }

  function bind() {
    let lastTouchDragEnd = 0;
    document.addEventListener('click', e => {
      if (Date.now() - lastTouchDragEnd < 350) return;   // swallow the click synthesized right after a touch-drag
      // tapping outside the mobile slide-in menu dismisses it
      const sbEl = document.getElementById('sidebar');
      if (sbEl && sbEl.classList.contains('open') && !e.target.closest('#sidebar') && !e.target.closest('.menu-toggle')) {
        sbEl.classList.remove('open'); return;
      }
      // close any open popover (column chooser / multi-select filter) when clicking outside it
      if (!e.target.closest('.pop-wrap')) {
        document.querySelectorAll('.pop-panel:not([hidden])').forEach(p => p.hidden = true);
      }
      // selection checkboxes must not open the lead drawer
      if (e.target.closest('.sel-cell') || e.target.closest('.sel-th')) return;
      const typeBtn = e.target.closest('#act-type button');
      if (typeBtn) { typeBtn.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('active')); typeBtn.classList.add('active'); return; }
      const thl = e.target.closest('.th-label[data-sort]');
      if (thl) { sortByHeader(thl.dataset.sort, thl.dataset.dir); return; }
      const el = e.target.closest('[data-action]');
      if (el) { handleAction(el.dataset.action, el, e); }
    });
    document.addEventListener('submit', e => {
      const f = e.target.closest('form[data-action]');
      if (!f) return;
      e.preventDefault();
      if (f.dataset.action === 'do-login') doLogin(f);
      else if (f.dataset.action === 'do-signup') doSignup(f);
    });
    /* The unsaved-changes guard's one piece of bookkeeping, and it is two
       lines: a rich-text note remembers what it held when the caret first
       arrived, because contenteditable has no defaultValue to fall back on. */
    document.addEventListener('focusin', e => {
      const ed = rtSeen(e);
      if (ed && !rtWas.has(ed)) rtWas.set(ed, ed.innerHTML);
    });
    document.addEventListener('input', e => {
      const ed = rtSeen(e);                              // typed into without ever being focused
      if (ed && !rtWas.has(ed)) rtTouched.add(ed);
      if (e.target.classList.contains('pop-search')) {   // narrow a column's value checklist
        const q = e.target.value.toLowerCase(), panel = e.target.closest('.pop-panel');
        if (panel) panel.querySelectorAll('.pop-list .pop-row').forEach(r => { r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none'; });
        return;
      }
      if (e.target.classList.contains('fbar-search')) {   // mobile in-list search
        state.search = e.target.value;
        refreshLeadsBody();   // refresh only the list so the search box keeps focus
        return;
      }
      if (e.target.id === 'global-search') {
        // Paints only the panel, never the page, so the box keeps focus and
        // the caret while results change underneath it.
        paintOmni(e.target.value);
        return;
      }
      // Let the active module react to typing in its own inputs.
      const im = RWG.modules.moduleForView(state.view);
      if (im && im.onInput) im.onInput(e, im.state);
    });
    document.addEventListener('change', e => {
      if (e.target.classList.contains('fbar-sort')) {   // mobile sort dropdown
        const parts = (e.target.value || 'score:desc').split(':');
        const f = currentFilter(); f.sortKey = parts[0]; f.sortDir = parts[1];
        refreshLeadsBody();
        return;
      }
      if (e.target.classList.contains('assign-select')) {
        D.assignLead(e.target.dataset.id, e.target.value || null, RWG.auth.currentUser().id);
        U.toast('Lead reassigned', true); refreshDrawer(); renderMain();
        return;
      }
      if (e.target.matches('input[data-col]')) {   // column chooser (popover lives in the bar)
        const key = e.target.dataset.col, arr = currentCols(), i = arr.indexOf(key);
        if (e.target.checked) { if (i < 0) arr.push(key); } else if (i >= 0) arr.splice(i, 1);
        saveCols(currentColsKey(), arr);
        refreshLeadsBody();   // rebuilds headers+body; bar popover survives
        return;
      }
      if (e.target.matches('input[data-colfilter]')) {   // AutoFilter value checklist (popover lives in the header)
        const key = e.target.dataset.colfilter, val = e.target.dataset.val, f = currentFilter();
        f.colFilters = f.colFilters || {}; const arr = f.colFilters[key] = f.colFilters[key] || [];
        const i = arr.indexOf(val); if (e.target.checked) { if (i < 0) arr.push(val); } else if (i >= 0) arr.splice(i, 1);
        if (!arr.length) delete f.colFilters[key];
        clearSelection();
        refreshLeadsBody(); updateBulkUI();   // rebuild the table so the filtered leads always repaint
        return;
      }
      if (e.target.matches('input[data-sel]')) {
        const id = e.target.dataset.sel;
        if (e.target.checked) state.selected.add(id); else state.selected.delete(id);
        const tr = e.target.closest('tr'); if (tr) tr.classList.toggle('row-sel', e.target.checked);
        const card = e.target.closest('.lead-row-card'); if (card) card.classList.toggle('sel', e.target.checked);
        updateBulkUI();
        return;
      }
      if (e.target.matches('input[data-selall]')) {
        const ids = currentTableLeads().filtered.map(l => l.id);
        if (e.target.checked) ids.forEach(id => state.selected.add(id)); else ids.forEach(id => state.selected.delete(id));
        document.querySelectorAll('#leads-body input[data-sel]').forEach(cb => {
          const on = state.selected.has(cb.dataset.sel); cb.checked = on;
          const tr = cb.closest('tr'); if (tr) tr.classList.toggle('row-sel', on);
        });
        updateBulkUI();
        return;
      }
      // Let the active module react to changes in its own selects/inputs.
      const cm = RWG.modules.moduleForView(state.view);
      if (cm && cm.onChange) cm.onChange(e, cm.state);
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') peelTop();
      // ⌘K / Ctrl-K puts the cursor in the search box from anywhere.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        const box = $('#global-search');
        if (box) { e.preventDefault(); box.focus(); box.select(); }
      }
    });
    /* The kanban board takes no wheel handler of its own, and that is a
       decision, not an omission. Carlos, Aug '26: a wheel that slid the
       board left and right startled everyone who only meant to read down
       the page. The handler that did it was a splint for a different bug —
       a grid blowout left .board with no horizontal scrollbar to grab, so
       hijacking the wheel was the only way across. That is fixed at the
       source (.main carries min-width:0), so the board now moves sideways
       the way every other overflowing element on the web does: its own
       scrollbar, shift-wheel, a sideways trackpad swipe. A plain vertical
       wheel belongs to the column under the pointer and then to the page,
       exactly as it does on every other screen in the app. */

    /* A fixed popover during a scroll. Two very different scrolls arrive
       here: the wheel turning INSIDE the panel's own value list (that is
       just the list scrolling - leave the menu alone), and the page or
       table scrolling UNDER the panel (which would leave it floating
       detached, so it follows its trigger button instead, and only closes
       once the button itself leaves the viewport). */
    window.addEventListener('scroll', (e) => {
      const t = e.target;
      if (t && t.nodeType === 1 && t.closest('.pop-panel')) return;
      document.querySelectorAll('.pop-panel:not([hidden])').forEach(p => {
        const btn = p.parentElement && p.parentElement.querySelector('[data-action="popmenu"]');
        if (!btn) { p.hidden = true; return; }
        const r = btn.getBoundingClientRect();
        const gone = r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth;
        if (gone) { p.hidden = true; return; }
        positionPanel(btn, p);
      });
    }, true);

    // ── drag & drop: move lead cards between pipeline columns (My Board) ──
    document.addEventListener('dragstart', e => {
      const card = e.target.closest('.lead-card.draggable');
      if (!card) return;
      state.dragId = card.dataset.id;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', state.dragId); } catch (_) {}
    });
    document.addEventListener('dragend', () => {
      document.querySelectorAll('.lead-card.dragging').forEach(c => c.classList.remove('dragging'));
      document.querySelectorAll('.board-col.drop-target').forEach(c => c.classList.remove('drop-target'));
      state.dragId = null;
    });
    const elFrom = (e) => { const t = e.target; return (t && t.nodeType === 1) ? t : (t && t.parentElement); };
    document.addEventListener('dragover', e => {
      if (!state.dragId) return;
      e.preventDefault();                          // accept the drop anywhere while dragging a card
      try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
      const t = elFrom(e);
      const col = t && t.closest('.board-col');
      document.querySelectorAll('.board-col.drop-target').forEach(c => { if (c !== col) c.classList.remove('drop-target'); });
      if (col) col.classList.add('drop-target');
    });
    document.addEventListener('drop', e => {
      if (!state.dragId) return;
      e.preventDefault();
      const t = elFrom(e);
      const col = t && t.closest('.board-col');
      const id = state.dragId; state.dragId = null;
      document.querySelectorAll('.board-col.drop-target').forEach(c => c.classList.remove('drop-target'));
      if (col) moveStage(id, col.dataset.stage); else renderMain();
    });

    // ── touch drag & drop: HTML5 DnD doesn't fire on touch, so hand-roll it ──
    // Press-and-hold a card to pick it up, drag over a column, lift to drop.
    let tDrag = null;
    const LONGPRESS = 220, MOVE_CANCEL = 12;
    const colAtPoint = (x, y) => { const el = document.elementFromPoint(x, y); return el ? el.closest('.board-col') : null; };
    const endTouchDrag = (drop) => {
      if (!tDrag) return;
      clearTimeout(tDrag.timer);
      if (tDrag.active) {
        if (tDrag.ghost) tDrag.ghost.remove();
        if (tDrag.card) tDrag.card.classList.remove('dragging');
        document.querySelectorAll('.board-col.drop-target').forEach(c => c.classList.remove('drop-target'));
        lastTouchDragEnd = Date.now();
        if (drop && drop.dataset.stage) moveStage(tDrag.id, drop.dataset.stage);
      }
      tDrag = null;
    };
    document.addEventListener('touchstart', e => {
      const card = e.target.closest('.lead-card.draggable');
      if (!card || e.touches.length !== 1) return;
      const t = e.touches[0];
      tDrag = { id: card.dataset.id, card, sx: t.clientX, sy: t.clientY, active: false, ghost: null, timer: null, offX: 0, offY: 0 };
      tDrag.timer = setTimeout(() => {
        if (!tDrag) return;
        tDrag.active = true;
        const r = card.getBoundingClientRect();
        card.classList.add('dragging');
        const g = card.cloneNode(true);
        g.classList.add('drag-ghost');
        g.style.width = r.width + 'px'; g.style.left = r.left + 'px'; g.style.top = r.top + 'px';
        document.body.appendChild(g);
        tDrag.ghost = g; tDrag.offX = tDrag.sx - r.left; tDrag.offY = tDrag.sy - r.top; tDrag.edge = 0;
        if (navigator.vibrate) { try { navigator.vibrate(15); } catch (_) {} }
        // auto-scroll the board when the finger nears a screen edge (reach off-screen columns)
        const step = () => { if (!tDrag || !tDrag.active) return; const board = document.querySelector('.board'); if (board && tDrag.edge) board.scrollLeft += tDrag.edge * 14; requestAnimationFrame(step); };
        requestAnimationFrame(step);
      }, LONGPRESS);
    }, { passive: true });
    document.addEventListener('touchmove', e => {
      if (!tDrag) return;
      const t = e.touches[0];
      if (!tDrag.active) {   // moved before the hold completed → it's a scroll, let it go
        if (Math.abs(t.clientX - tDrag.sx) > MOVE_CANCEL || Math.abs(t.clientY - tDrag.sy) > MOVE_CANCEL) { clearTimeout(tDrag.timer); tDrag = null; }
        return;
      }
      e.preventDefault();   // we own the gesture now → stop the page from scrolling
      const EDGE = 46;
      tDrag.edge = t.clientX < EDGE ? -1 : (t.clientX > window.innerWidth - EDGE ? 1 : 0);
      if (tDrag.ghost) { tDrag.ghost.style.left = (t.clientX - tDrag.offX) + 'px'; tDrag.ghost.style.top = (t.clientY - tDrag.offY) + 'px'; }
      const col = colAtPoint(t.clientX, t.clientY);
      document.querySelectorAll('.board-col.drop-target').forEach(c => { if (c !== col) c.classList.remove('drop-target'); });
      if (col) col.classList.add('drop-target');
    }, { passive: false });
    document.addEventListener('touchend', e => {
      if (!tDrag) return;
      const t = e.changedTouches && e.changedTouches[0];
      endTouchDrag(t ? colAtPoint(t.clientX, t.clientY) : null);
    });
    document.addEventListener('touchcancel', () => endTouchDrag(null));

    // swap table ⇄ stacked cards when crossing the mobile breakpoint (rotate/resize)
    const mqMobile = window.matchMedia('(max-width:760px)');
    const onBreak = () => { if (document.body.classList.contains('in-app')) renderMain(); };
    if (mqMobile.addEventListener) mqMobile.addEventListener('change', onBreak);
    else if (mqMobile.addListener) mqMobile.addListener(onBreak);
  }

  // The kernel's public surface. Modules use nav() to move around and icons for their tiles.
  // effectiveUser/effectiveRole + viewAs let a module honour admin "view as" for its own reads/writes.
  return { boot, bind, state, nav, renderMain, openPanel, closeDrawer,
    peelTop, guardHistory,
    icons: ICONS, effectiveUser, effectiveRole, viewAs: setViewAs };
})();

document.addEventListener('DOMContentLoaded', () => { RWG.app.bind(); RWG.app.guardHistory(); RWG.app.boot(); });
