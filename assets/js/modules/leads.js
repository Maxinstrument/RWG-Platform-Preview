/* ============================================================
   RWG Platform — Leads module (the existing CRM)

   DISABLED in v1. The live CRM keeps running at its own URL until
   Carlos approves the cutover; flipping `enabled` to true here (or
   calling RWG.modules.setEnabled('leads', true) in the console)
   restores the full CRM inside this platform.

   This is a thin adapter on purpose. It owns the nav and meta that
   used to be hardcoded in app.js, and delegates rendering to
   RWG.views.admin / RWG.views.agent, which are untouched.

   Its interactions still run through the legacy switch in
   app.js handleAction(). That switch is leads-only now, and it will
   move into this file's `actions` map when Leads is extracted for
   real (after cutover). Until then this module declares no actions,
   so the kernel falls through to the switch.
   ============================================================ */
window.RWG = window.RWG || {};

// The two pages of the Leads area, drawn by both of them so the strip sits
// in the same place whichever one you are on. Same shape as the Pipeline's
// tracks + "☰ All cases", and published like RWG.reportTabs so there is one
// copy of it rather than one per screen.
RWG.leadTabs = function (active) {
  const tab = (view, label, title) =>
    `<button class="btn btn-sm ${view === active ? 'btn-navy' : 'btn-ghost'}"
       data-action="nav" data-view="${view}" title="${title}">${label}</button>`;
  return `<div class="filterbar" style="flex-direction:row;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">
    ${tab('dashboard', 'Command Center', 'Where the team stands this week')}
    <span class="pl-divider"></span>
    ${tab('leads', '☰ All leads', 'Every lead across the team, filterable and exportable')}
  </div>`;
};

RWG.modules.register({
  id: 'leads',
  title: 'Leads',
  enabled: true,                        // Consolidated in. Old CRM URL runs alongside during the trial.
  roles: ['admin', 'agent'],

  nav: {
    admin: [
      // One area, two pages. Leads opens on the Command Center — where the
      // team stands this week — with the whole table one click away, the
      // same shape as Pipeline ↔ All cases.
      { view: 'dashboard', label: 'Leads', icon: 'leads', also: ['leads'] },
      // 'reports' (Lead Reports) is now the Leads tab inside the Reports
      // hub, and 'archive' (Deleted Leads) folded into the Trash — both
      // views stay registered so old deep-links still render.
      // Team and Upload live under your name with the other admin tools.
      { view: 'agents', label: 'Team Overview', icon: 'team', where: 'user', menuOrder: 1,
        badge: () => RWG.data.pendingUsers().length },
      { view: 'upload', label: 'Upload & Assign', icon: 'upload', where: 'user', menuOrder: 4 },
      // Lead scoring moved into CRM Settings (phase 7); the old view
      // stays registered so a stale deep-link still renders.
    ],
    agent: [
      { view: 'board',  label: 'My Board',       icon: 'board' },
      { view: 'mylist', label: 'My Leads',       icon: 'leads' },
      { view: 'today',  label: "Today's Queue",  icon: 'today' },
      { view: 'stats',  label: 'My Stats',       icon: 'stats' }
    ]
  },

  // Views the module owns that no longer have a sidebar entry: 'leads' is the
  // second page of the Leads area, 'reports' is the Leads tab inside the
  // Reports hub, 'archive' folded into the Trash, 'settings' moved to CRM
  // Settings. All still render if you land on them.
  views: ['leads', 'reports', 'archive', 'settings'],

  meta: {
    dashboard: { t: 'Command Center', s: 'Team performance, live' },
    leads:     { t: 'All Leads',      s: 'Every lead across the team' },
    agents:    { t: 'Team Overview',  s: 'Agents & approvals' },
    reports:   { t: 'Reports', s: 'Leads — call activity and appointments, week by week' },
    upload:    { t: 'Upload & Assign',s: 'Import and distribute lead lists' },
    archive:   { t: 'Deleted Leads',  s: 'Archived records — restore or erase' },
    settings:  { t: 'Scoring & Settings', s: 'Tune the lead-quality engine' },
    board:     { t: 'My Board',       s: 'Work your pipeline' },
    mylist:    { t: 'My Leads',       s: 'Your assigned leads, best first' },
    today:     { t: "Today's Queue",  s: 'What to do right now' },
    stats:     { t: 'My Stats',       s: 'Your week so far' }
  },

  // The topbar search is global now, and "New Lead" lives on the leads
  // screens themselves rather than following you around the whole app.
  chrome: {},

  home: {
    tile: (ctx) => ({
      icon: 'leads',
      title: 'Leads',
      desc: ctx.role === 'admin'
        ? 'Every lead across the team, scoring, uploads and weekly reports.'
        : 'Your pipeline, your queue for today, and your stats.',
      view: ctx.role === 'admin' ? 'dashboard' : 'board'
    })
  },

  render(view, user, ctx) {
    const body = (ctx.role === 'admin')
      ? RWG.views.admin.render(view, user, ctx)
      : RWG.views.agent.render(view, user, ctx);
    // The lead report is a tab of the Reports hub, so it wears the strip.
    if (view === 'reports' && RWG.reportTabs) return RWG.reportTabs('reports', ctx) + body;
    if (ctx.role === 'admin' && (view === 'dashboard' || view === 'leads')) return RWG.leadTabs(view) + body;
    return body;
  }
});
