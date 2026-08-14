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

  /* ── Notes: one editor, everywhere ─────────────────────────
     Every place in the CRM where you write something about a
     person, a family or a case is the same control: a small
     formatting bar over a writing surface. It started life on the
     opportunity window; it lives here now so no screen grows its
     own version of it.

     Insert date stamps the day AND who stamped it — in a book the
     whole team reads, "8/13/2026" is worth much less than
     "8/13/2026 · Carlos Temperan".

     Storage is sanitized HTML. Notes typed before today are plain
     text and stay that way: noteHtml() renders either, so nothing
     needs converting and nothing shows its tags. */

  // Team-internal notes, but still no scripts or handlers in stored HTML.
  function cleanHtml(html) {
    return String(html || '')
      .replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
      .replace(/<\s*(script|style|iframe|object|embed)[^>]*\/?\s*>/gi, '')
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'>\s]*\2/gi, '$1="#"');
  }

  const HAS_TAG = /<(?:p|div|br|b|i|u|em|strong|ul|ol|li|a|span|h[1-6])\b[^>]*>/i;

  // Render a stored note: HTML if it is HTML, escaped text if it is not.
  function noteHtml(v) {
    const s = String(v == null ? '' : v);
    if (!s.trim()) return '';
    return HAS_TAG.test(s) ? cleanHtml(s) : esc(s);
  }

  function whoAmI() {
    const u = RWG.auth && RWG.auth.currentUser ? RWG.auth.currentUser() : null;
    return (u && u.name) || '';
  }
  function dateStamp() {
    const d = new Date();
    const day = (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
    const who = whoAmI();
    return day + (who ? ' · ' + who : '') + ' — ';
  }

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
        ${tool('date', 'Insert date', 'Stamp today’s date and your name')}
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

  return { esc, money, moneyK, initials, fmtDate, fmtDateTime, fmtRelative, avatar, tierChip, scoreBar, stageChip, isCallback, callbackChip, isClickedNoSignup, clickedChip, ring, toast, tierFill, csvCell, toCSV, downloadCSV, stampName, icon, ICON_PATHS,
    cleanHtml, noteHtml, noteEditor, noteRead, noteText, dateStamp };
})();
