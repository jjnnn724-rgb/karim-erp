/**
 * core/i18n-auto.js — محرك الترجمة اللحظية للواجهة (AR ⇄ EN)
 * ────────────────────────────────────────────────────────────────────
 * يعتمد على كتالوج i18n-auto-catalog.js (نص عربي → نص إنجليزي).
 * الفكرة: طبقة عرض تعمل فوق كل الوحدات — أي نص عربي يظهر في الواجهة
 * يُستبدل بنظيره الإنجليزي مباشرة عند اللغة الإنجليزية، والعكس عند
 * العودة للعربية (بالخريطة المعكوسة) — بدون إعادة تحميل الصفحة.
 *
 * القواعد:
 *  • مطابقة تامة على مستوى عقدة النص (بعد تقليم الفراغات)
 *  • يترجم أيضًا: placeholder / title / aria-label
 *  • يتجاهل: script/style/code/pre/textarea/input و contenteditable
 *  • أداء: خريطة تجزئة + debounce عبر requestAnimationFrame
 *  • إتاحة: يحترم prefers-reduced-motion (لا حركة أصلاً — طبقة نصية)
 */
(function () {
  'use strict';

  const CATALOG = (typeof window !== 'undefined' && window.KARIM_I18N_AUTO) || {};
  const REVERSE = {};
  for (const ar in CATALOG) {
    const en = CATALOG[ar];
    if (!REVERSE[en]) {REVERSE[en] = ar;}
  }

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA', 'NOSCRIPT', 'IFRAME']);
  const ATTRS = ['placeholder', 'title', 'aria-label'];
  let lang = 'ar';
  let pending = false;
  let observing = false;

  function currentLang() {
    try {
      if (window.STATE && window.STATE.lang) {return window.STATE.lang;}
      const saved = localStorage.getItem('karim_lang');
      if (saved) {return saved;}
    } catch (_) {}
    return document.documentElement.getAttribute('lang') === 'en' ? 'en' : 'ar';
  }

  function translateString(text) {
    const trimmed = text.trim();
    if (!trimmed) {return null;}
    if (lang === 'en') {
      const hit = CATALOG[trimmed];
      return hit ? text.replace(trimmed, hit) : null;
    }
    const hit = REVERSE[trimmed];
    return hit ? text.replace(trimmed, hit) : null;
  }

  function translateElement(el) {
    if (el.nodeType !== 1) {return;}
    if (el.hasAttribute && (el.hasAttribute('data-no-i18n') || el.isContentEditable)) {return;}
    for (const attr of ATTRS) {
      const v = el.getAttribute && el.getAttribute(attr);
      if (!v) {continue;}
      const t = translateString(v);
      if (t && t !== v) {el.setAttribute(attr, t);}
    }
  }

  function walk(root) {
    if (lang === (window.STATE && window.STATE.lang ? window.STATE.lang : currentLang())) {
      // نعيد الحساب لأن toggleLang قد يغيّر STATE.lang قبل تغيير DOM
    }
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: function (node) {
          if (node.nodeType === 1) {
            if (SKIP_TAGS.has(node.tagName)) {return NodeFilter.FILTER_REJECT;}
            if (node.hasAttribute && node.hasAttribute('data-no-i18n')) {return NodeFilter.FILTER_REJECT;}
            if (node.isContentEditable) {return NodeFilter.FILTER_REJECT;}
            for (const attr of ATTRS) {
              if (node.hasAttribute && node.hasAttribute(attr)) {return NodeFilter.FILTER_ACCEPT;}
            }
            return node.childNodes && node.childNodes.length ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_REJECT;
          }
          return node.nodeValue && node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
      }
    );
    let node;
    const batch = [];
    while ((node = walker.nextNode())) {
      if (node.nodeType === 1) {
        translateElement(node);
      } else {
        batch.push(node);
      }
    }
    for (const n of batch) {
      const t = translateString(n.nodeValue);
      if (t && t !== n.nodeValue) {n.nodeValue = t;}
    }
  }

  function schedule() {
    if (pending) {return;}
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      lang = currentLang();
      try { walk(document.body); } catch (e) { /* تجاهل — دورة قادمة تعيد المحاولة */ }
    });
  }

  function start() {
    if (observing) {return;}
    observing = true;
    lang = currentLang();

    const mo = new MutationObserver(function (muts) {
      let structural = false;
      for (const m of muts) {
        if (m.type === 'childList') {structural = true; break;}
        if (m.type === 'attributes' && (m.attributeName === 'dir' || m.attributeName === 'lang')) {structural = true; break;}
      }
      if (structural) {schedule();}
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['dir', 'lang'] });
    const content = document.getElementById('content') || document.body;
    mo.observe(content, { childList: true, subtree: true });
    const modals = document.getElementById('modals');
    if (modals) {mo.observe(modals, { childList: true, subtree: true });}

    document.addEventListener('DOMContentLoaded', schedule);
    window.addEventListener('load', schedule);
    schedule();
  }

  // إعادة التطبيق عند تغيّر اللغة من داخل التطبيق
  const origSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    origSetItem.call(this, k, v);
    if (k === 'karim_lang') {setTimeout(schedule, 30);}
  };

  window.KARIM_I18N_AUTO_APPLY = { start: start, schedule: schedule, walk: walk, setLang: function (l) {lang = l; schedule();} };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
