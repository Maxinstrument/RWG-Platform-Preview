/* ============================================================
   RWG Platform — preview banner

   Shows a standing warning strip when the app is being served from
   the preview site, so nobody mistakes it for the live platform.

   Deliberately self-detecting rather than a flag someone has to
   remember to flip: it keys off the URL, so this file is harmless
   if it ever lands in the live repo (the check simply fails and
   no banner is drawn).

   The same data sits behind both, so anything you change here is
   real. The point of the strip is that you know that.
   ============================================================ */
(function () {
  var isPreview = /-preview/i.test(location.pathname) || /-preview/i.test(location.hostname);
  if (!isPreview) return;

  var css = document.createElement('style');
  css.textContent = [
    '.preview-strip{position:fixed;top:0;left:0;right:0;z-index:9999;',
    'background:linear-gradient(90deg,#B0691F,#C2A14D);color:#1A1206;',
    "font-family:'Hanken Grotesk',system-ui,sans-serif;font-size:12.5px;font-weight:700;",
    'letter-spacing:.04em;text-align:center;padding:5px 14px;line-height:1.4;',
    'box-shadow:0 2px 10px -4px rgba(14,36,64,.5)}',
    '.preview-strip span{font-weight:500;opacity:.85}',
    'body{padding-top:26px}',
    '@media print{.preview-strip{display:none}body{padding-top:0}}'
  ].join('');
  document.head.appendChild(css);

  var bar = document.createElement('div');
  bar.className = 'preview-strip';
  bar.setAttribute('role', 'status');
  bar.innerHTML = 'PREVIEW BUILD <span>· not the live platform · same live data, so changes here are real</span>';
  document.body.insertBefore(bar, document.body.firstChild);
})();
