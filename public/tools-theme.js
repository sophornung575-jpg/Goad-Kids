/* tools-theme.js — black / white background switch for the Goat Kids staff tools
 * (Restock, Live Desk). The choice is saved on this device and shared by all the
 * tools, including the Marketing Desk.
 * Load it in <head> so the page never flashes white. The dark look turns the page's
 * colours around; photos, videos and the camera keep their real colours.
 */
(function () {
  'use strict';
  var KEY = 'gk_tools_theme';
  var root = document.documentElement;
  function saved() { try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'; } catch (e) { return 'light'; } }
  root.setAttribute('data-theme', saved());

  var css =
    'html[data-theme="dark"]{background:#fff;filter:invert(1) hue-rotate(180deg)}' +
    'html[data-theme="dark"] img,html[data-theme="dark"] video,html[data-theme="dark"] canvas,html[data-theme="dark"] iframe,' +
    'html[data-theme="dark"] picture,html[data-theme="dark"] [data-keep-colour]{filter:invert(1) hue-rotate(180deg)}' +
    'html[data-theme="dark"] picture img{filter:none}' +
    '.gk-theme-btn{display:inline-flex;align-items:center;gap:5px;border:1px solid rgba(100,116,139,.45);background:transparent;color:inherit;' +
    'border-radius:8px;padding:5px 10px;font:inherit;font-size:.82rem;font-weight:600;cursor:pointer;white-space:nowrap;flex:0 0 auto}' +
    '.gk-theme-btn:hover{border-color:currentColor}';
  var st = document.createElement('style');
  st.textContent = css;
  (document.head || root).appendChild(st);

  var LABELS = { en: ['Black', 'White'], kh: ['ខ្មៅ', 'ស'], km: ['ខ្មៅ', 'ស'], zh: ['黑色', '白色'] };
  var btn = null;
  function lang() {
    try { if (window.ToolI18n && ToolI18n.lang) return ToolI18n.lang(); } catch (e) {}
    var sel = document.querySelector('#uiLang, #langSelect');
    return sel ? sel.value : 'en';
  }
  function label() {
    if (!btn) return;
    var dark = root.getAttribute('data-theme') === 'dark';
    var l = LABELS[lang()] || LABELS.en;
    btn.textContent = (dark ? '☀ ' : '☾ ') + (dark ? l[1] : l[0]);
    btn.title = dark ? 'White background' : 'Black background';
  }
  function set(theme) {
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem(KEY, theme); } catch (e) {}
    label();
  }
  function mount() {
    var sel = document.querySelector('#uiLang, #langSelect');
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gk-theme-btn';
    btn.setAttribute('translate', 'no');
    btn.addEventListener('click', function () { set(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); });
    if (sel && sel.parentNode) {
      sel.parentNode.insertBefore(btn, sel);
      sel.addEventListener('change', function () { setTimeout(label, 0); });
    } else {
      btn.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:9998;background:#fff';
      document.body.appendChild(btn);
    }
    label();
  }
  window.addEventListener('storage', function (e) {
    if (e.key === KEY) { root.setAttribute('data-theme', e.newValue === 'dark' ? 'dark' : 'light'); label(); }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
