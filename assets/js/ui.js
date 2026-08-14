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
      ? `<span class="chip chip-callback" title="This person asked us to call them to schedule an appointment">📞 Callback</span>`
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

  let toastTimer;
  function toast(msg, good) {
    let wrap = document.getElementById('toast-wrap');
    if (!wrap) { wrap = document.createElement('div'); wrap.id = 'toast-wrap'; document.body.appendChild(wrap); }
    const t = document.createElement('div');
    t.className = 'toast' + (good ? ' good' : '');
    t.innerHTML = (good ? '✓ ' : '') + esc(msg);
    wrap.appendChild(t);
    clearTimeout(toastTimer);
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(8px)'; t.style.transition = '.3s'; setTimeout(() => t.remove(), 300); }, 2600);
  }

  return { esc, money, moneyK, initials, fmtDate, fmtDateTime, fmtRelative, avatar, tierChip, scoreBar, stageChip, isCallback, callbackChip, isClickedNoSignup, clickedChip, ring, toast, tierFill, csvCell, toCSV, downloadCSV, stampName,
    cleanHtml, noteHtml, noteEditor, noteRead, noteText, dateStamp };
})();
