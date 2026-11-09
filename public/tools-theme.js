/* tools-theme.js — background switch for the Goat Kids staff tools
 * (Restock, Live Desk, Marketing Desk). Three looks, chosen with one button:
 *   White → Grey → Black → White ...
 * Grey is a soft dark grey (like the Claude chat background); Black is the old dark look.
 * The choice is saved on this device and shared by all the tools.
 * Load it in <head> so the page never flashes white. The dark looks turn the page's
 * colours around; photos, videos and the camera keep their real colours.
 */
(function () {
  'use strict';
  var KEY = 'gk_tools_theme';
  var THEMES = ['light', 'grey', 'dark'];
  var root = document.documentElement;
  function saved() {
    try {
      var v = localStorage.getItem(KEY);
      // One-time: people who were on the old Black look move to the new Grey look.
      if (v === 'dark' && !localStorage.getItem(KEY + '_v2')) {
        v = 'grey';
        localStorage.setItem(KEY, v);
      }
      localStorage.setItem(KEY + '_v2', '1');
      return THEMES.indexOf(v) >= 0 ? v : 'light';
    } catch (e) { return 'light'; }
  }
  root.setAttribute('data-theme', saved());

  // Grey and Black both use the colour flip. Grey then adds a full-screen layer
  // (blend "darken" before the flip = "lighten" after it), so pure black becomes
  // #262624 grey while text, buttons and photos stay the same.
  var DARK = 'html[data-theme="dark"],html[data-theme="grey"]';
  var MEDIA = ['img', 'video', 'canvas', 'iframe', 'picture', '[data-keep-colour]'];
  var css =
    'html[data-theme="dark"],html[data-theme="grey"]{background:#fff;filter:invert(1) hue-rotate(180deg)}' +
    MEDIA.map(function (m) { return 'html[data-theme="dark"] ' + m + ',html[data-theme="grey"] ' + m; }).join(',') +
    '{filter:invert(1) hue-rotate(180deg)}' +
    'html[data-theme="dark"] picture img,html[data-theme="grey"] picture img{filter:none}' +
    '#gk-grey-layer{display:none}' +
    'html[data-theme="grey"] #gk-grey-layer{display:block;position:fixed;inset:0;background:#d9d9db;' +
    'mix-blend-mode:darken;pointer-events:none;z-index:2147483647}' +
    '.gk-theme-btn{display:inline-flex;align-items:center;gap:5px;border:1px solid rgba(100,116,139,.45);background:transparent;color:inherit;' +
    'border-radius:8px;padding:5px 10px;font:inherit;font-size:.82rem;font-weight:600;cursor:pointer;white-space:nowrap;flex:0 0 auto}' +
    '.gk-theme-btn:hover{border-color:currentColor}';
  var st = document.createElement('style');
  st.textContent = css;
  (document.head || root).appendChild(st);

  // Button shows the look you get when you press it next.
  var LABELS = {
    en: { light: 'White', grey: 'Grey', dark: 'Black' },
    kh: { light: 'ស', grey: 'ប្រផេះ', dark: 'ខ្មៅ' },
    km: { light: 'ស', grey: 'ប្រផេះ', dark: 'ខ្មៅ' },
    zh: { light: '白色', grey: '灰色', dark: '黑色' }
  };
  var ICONS = { light: '☀ ', grey: '◐ ', dark: '☾ ' };
  var btn = null;
  function current() { var t = root.getAttribute('data-theme'); return THEMES.indexOf(t) >= 0 ? t : 'light'; }
  function next() { return THEMES[(THEMES.indexOf(current()) + 1) % THEMES.length]; }
  function lang() {
    try { if (window.ToolI18n && ToolI18n.lang) return ToolI18n.lang(); } catch (e) {}
    var sel = document.querySelector('#uiLang, #langSelect');
    return sel ? sel.value : 'en';
  }
  function label() {
    if (!btn) return;
    var n = next(), l = LABELS[lang()] || LABELS.en;
    btn.textContent = ICONS[n] + l[n];
    btn.title = LABELS.en[n] + ' background';
  }
  function set(theme) {
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem(KEY, theme); } catch (e) {}
    label();
  }
  function mount() {
    if (!document.getElementById('gk-grey-layer')) {
      var layer = document.createElement('div');
      layer.id = 'gk-grey-layer';
      layer.setAttribute('aria-hidden', 'true');
      document.body.appendChild(layer);
    }
    var sel = document.querySelector('#uiLang, #langSelect');
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gk-theme-btn';
    btn.setAttribute('translate', 'no');
    btn.addEventListener('click', function () { set(next()); });
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
    if (e.key === KEY) { root.setAttribute('data-theme', THEMES.indexOf(e.newValue) >= 0 ? e.newValue : 'light'); label(); }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
