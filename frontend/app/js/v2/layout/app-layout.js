/**
 * V2 — AppLayout (app shell)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * SCOPE: presentation + wiring only.
 * This module contains NO accounting, inventory, HR, invoice or permission
 * business logic. It renders the shell, forwards navigation intent to its
 * host through a callback, and exposes named integration boundaries.
 *
 * WHAT IS REAL HERE
 *   • Sidebar contents come from buildNavTree() (permission-aware; see
 *     nav-model.js) — and a hidden menu is ONLY hidden, never authorised:
 *     every action it exposes still goes through the backend.
 *   • Theme control is the live controller from theme.js.
 *   • Responsive drawer, focus management and skip link are real.
 *
 * WHAT IS A BOUNDARY (not implemented — deliberately not faked)
 *   Search, notifications, profile and company/branch selection are exposed
 *   as inert, labelled slots (`data-erp-boundary`). Nothing is rendered that
 *   implies a feature exists. Mounting a real integration means handing the
 *   slot to the host; see `mountBoundary()`.
 */

import { mountThemeControl } from '../theme.js?v=4.9.186';
import { mountDensityControl } from '../density.js?v=4.9.186';
import { buildNavTree, currentRole, readRoles } from './nav-model.js?v=4.9.186';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Boundaries this shell knows how to host. Inert until a host mounts one. */
export const BOUNDARIES = Object.freeze({
    search:          { label: 'البحث الشامل', hint: 'Ctrl + K', icon: 'search' },
    notifications:   { label: 'الإشعارات',     hint: 'لم تُربط',  icon: 'bell' },
    profile:         { label: 'الملف الشخصي',  hint: 'لم يُربط',  icon: 'user' },
    'company-branch':{ label: 'الشركة / الفرع', hint: 'لم يُربط', icon: 'building' },
});

/**
 * @typedef {Object} AppLayoutOptions
 * @property {string}  [appName]        Brand text.
 * @property {string}  [appSubtitle]    Small text under the brand.
 * @property {string}  [page]           Currently active nav key (drives aria-current).
 * @property {(key:string)=>void} [onNavigate] Presentation-only navigation intent.
 * @property {{title?:string, trail?:Array<{label:string, key?:string}>}} [breadcrumbs]
 * @property {Array}   [toolbar]        Extra toolbar actions: {label, icon, onClick, primary?}.
 */

/**
 * Mount the shell into `container`.
 * @param {HTMLElement} container
 * @param {AppLayoutOptions} [options]
 */
export function mountAppLayout(container, options = {}) {
    if (!container) {throw new Error('mountAppLayout: container is required');}

    const state = {
        page: options.page || null,
        breadcrumbs: options.breadcrumbs || { title: '', trail: [] },
        toolbar: options.toolbar || [],
        drawerOpen: false,
        compact: false,
        themeControl: null,
        disposers: [],
    };

    /* ── Root ───────────────────────────────────────────────────────── */
    const root = document.createElement('div');
    root.className = 'erp-v2 erp-shell';
    root.setAttribute('data-erp-shell', '1');

    root.innerHTML = `
      <a class="erp-skip-link" href="#erp-main">تخطَّ إلى المحتوى الرئيسي</a>

      <aside class="erp-shell__sidebar" id="erp-sidebar" aria-label="التنقل الرئيسي">
        <div class="erp-shell__brand">
          <span class="erp-shell__brand-mark" aria-hidden="true">
            <img data-v2-shell-logo src="assets/al-shurfa-logo.png" alt="">
            <i class="ji" data-v2-shell-logo-fallback data-i="layout-dashboard" hidden></i>
          </span>
          <span class="erp-shell__brand-text">
            <strong class="erp-truncate"></strong>
            <small class="erp-truncate"></small>
          </span>
          <button type="button" class="erp-icon-btn erp-shell__drawer-close erp-no-print"
                  aria-label="إغلاق القائمة" data-erp-close-drawer>
            <i class="ji" data-i="x" aria-hidden="true"></i>
          </button>
        </div>

        <nav class="erp-shell__nav" id="erp-nav" aria-label="أقسام النظام"></nav>

        <div class="erp-shell__nav-foot">
          <div class="erp-shell__role" data-erp-role></div>
        </div>
      </aside>

      <div class="erp-shell__scrim" data-erp-close-drawer hidden></div>

      <div class="erp-shell__main">
        <header class="erp-shell__header">
          <button type="button" class="erp-icon-btn erp-shell__drawer-open erp-no-print"
                  aria-label="فتح القائمة" aria-controls="erp-sidebar" aria-expanded="false"
                  data-erp-open-drawer>
            <i class="ji" data-i="menu" aria-hidden="true"></i>
          </button>

          <nav class="erp-crumbs" aria-label="مسار التنقل"></nav>

          <div class="erp-shell__actions erp-no-print">
            <span class="erp-shell__integrations" data-erp-integrations hidden>
              ${Object.keys(BOUNDARIES).map((name) => boundaryMarkup(name)).join('')}
            </span>
            <button type="button" class="erp-icon-btn erp-shell__more-toggle"
                    data-erp-more-toggle aria-controls="erp-more-panel" aria-expanded="false"
                    aria-label="مركز التحكم" title="مركز التحكم">
              <i class="ji" data-i="sliders" aria-hidden="true"></i>
            </button>
          </div>
        </header>

        <div class="erp-shell__more erp-no-print" id="erp-more-panel" data-erp-more hidden
             role="dialog" aria-label="مركز التحكم">
          <div class="erp-shell__more-head">
            <span class="erp-shell__more-title">مركز التحكم</span>
            <button type="button" class="erp-icon-btn" data-erp-more-close aria-label="إغلاق مركز التحكم">
              <i class="ji" data-i="x" aria-hidden="true"></i>
            </button>
          </div>
          <section class="erp-shell__more-section">
            <h3 class="erp-shell__more-label">حالة النظام</h3>
            <div class="erp-shell__more-status" data-erp-more-status></div>
          </section>
          <section class="erp-shell__more-section">
            <h3 class="erp-shell__more-label">التفضيلات</h3>
            <div class="erp-shell__more-row">
              <span class="erp-shell__more-key">المظهر</span>
              <span data-erp-theme-slot></span>
            </div>
            <div class="erp-shell__more-row">
              <span class="erp-shell__more-key">كثافة العرض</span>
              <span data-erp-density-slot></span>
            </div>
            <div class="erp-shell__more-row">
              <span class="erp-shell__more-key">لغة الواجهة</span>
              <span data-erp-more-lang></span>
            </div>
          </section>
          <section class="erp-shell__more-section" data-erp-more-quick-section hidden>
            <h3 class="erp-shell__more-label">روابط سريعة</h3>
            <div class="erp-shell__more-quick" data-erp-more-quick></div>
          </section>
          <section class="erp-shell__more-section">
            <h3 class="erp-shell__more-label">الحساب</h3>
            <div class="erp-shell__more-account" data-erp-more-account></div>
          </section>
        </div>

        <div class="erp-toolbar" data-erp-toolbar hidden></div>

        <main class="erp-shell__content" id="erp-main" tabindex="-1"></main>
      </div>`;

    container.appendChild(root);

    /* ── Elements ───────────────────────────────────────────────────── */
    const el = {
        sidebar:   root.querySelector('#erp-sidebar'),
        nav:       root.querySelector('#erp-nav'),
        scrim:     root.querySelector('.erp-shell__scrim'),
        crumbs:    root.querySelector('.erp-crumbs'),
        toolbar:   root.querySelector('[data-erp-toolbar]'),
        main:      root.querySelector('#erp-main'),
        role:      root.querySelector('[data-erp-role]'),
        themeSlot: root.querySelector('[data-erp-theme-slot]'),
        densitySlot: root.querySelector('[data-erp-density-slot]'),
        brandText: root.querySelector('.erp-shell__brand-text strong'),
        brandSub:  root.querySelector('.erp-shell__brand-text small'),
        drawerOpenBtn: root.querySelector('[data-erp-open-drawer]'),
        morePanel: root.querySelector('[data-erp-more]'),
        moreToggle: root.querySelector('[data-erp-more-toggle]'),
        moreClose: root.querySelector('[data-erp-more-close]'),
    };

    /* ── Brand ──────────────────────────────────────────────────────── */
    el.brandText.textContent = options.appName || 'مطاعم الشرفه العالمي';
    el.brandSub.textContent = options.appSubtitle || '';

    /* ── Sidebar (permission-aware) ─────────────────────────────────── */
    function renderNav() {
        const tree = buildNavTree();
        el.nav.innerHTML = tree.map((group) => `
          <div class="erp-nav-group" data-group="${esc(group.id)}">
            <div class="erp-nav-group__title" id="erp-nav-g-${esc(group.id)}">${esc(group.title)}</div>
            <ul class="erp-nav-list" aria-labelledby="erp-nav-g-${esc(group.id)}">
              ${group.items.map((item) => navItemMarkup(item)).join('')}
            </ul>
          </div>`).join('')
          || `<div class="erp-state"><span class="erp-state__icon" aria-hidden="true">🔒</span>
               <span class="erp-state__title">لا توجد صفحات متاحة</span>
               <span>لا توجد قوائم مسنودة لهذا الدور.</span></div>`;

        // Groups are expandable/collapsible.
        el.nav.querySelectorAll('.erp-nav-group__title').forEach((title) => {
            title.tabIndex = 0;
            title.setAttribute('role', 'button');
            title.setAttribute('aria-expanded', 'true');
            const toggle = () => {
                const group = title.closest('.erp-nav-group');
                const open = group.classList.toggle('is-collapsed');
                title.setAttribute('aria-expanded', String(!open));
            };
            title.addEventListener('click', toggle);
            title.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {e.preventDefault(); toggle();}
            });
        });

        // Navigation intent → host. NEVER a permission decision.
        el.nav.querySelectorAll('[data-erp-nav]').forEach((node) => {
            node.addEventListener('click', () => navigate(node.dataset.erpNav));
            node.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {e.preventDefault(); navigate(node.dataset.erpNav);}
            });
        });

        highlightActive();
    }

    function navItemMarkup(item) {
        const active = item.key === state.page;
        return `<li>
          <button type="button" class="erp-nav-item${active ? ' is-active' : ''}"
                  data-erp-nav="${esc(item.key)}"
                  ${active ? 'aria-current="page"' : ''}
                  title="${esc(item.label)}">
            <i class="ji" data-i="${esc(item.icon || 'circle')}" aria-hidden="true"></i>
            <span class="erp-nav-item__label erp-truncate">${esc(item.label)}</span>
          </button></li>`;
    }

    function highlightActive() {
        el.nav.querySelectorAll('[data-erp-nav]').forEach((node) => {
            const on = node.dataset.erpNav === state.page;
            node.classList.toggle('is-active', on);
            if (on) {node.setAttribute('aria-current', 'page');}
            else {node.removeAttribute('aria-current');}
        });
    }

    /* ── Role footer (informational only — server authorises) ───────── */
    function renderRole() {
        const role = currentRole();
        const def = readRoles()[role];
        el.role.innerHTML = role
            ? `<span class="erp-role__dot" aria-hidden="true"></span>
               <span class="erp-truncate"><strong>${esc(def?.name || role)}</strong></span>`
            : `<span class="erp-text-muted">غير مسجّل الدخول</span>`;
    }

    /* ── Breadcrumbs ────────────────────────────────────────────────── */
    function renderCrumbs() {
        const { title = '', trail = [] } = state.breadcrumbs;
        const parts = trail.map((step, i) => {
            const last = i === trail.length - 1;
            const inner = last
                ? `<span aria-current="page">${esc(step.label)}</span>`
                : `<button type="button" class="erp-crumb-btn" data-erp-crumb="${esc(step.key || '')}">${esc(step.label)}</button>`;
            return `<li class="erp-crumb">${inner}</li>`;
        });
        if (title && !trail.length) {parts.push(`<li class="erp-crumb"><span aria-current="page">${esc(title)}</span></li>`);}
        el.crumbs.innerHTML = parts.length
            ? `<ol class="erp-crumbs__list">${parts.join('<li class="erp-crumb-sep" aria-hidden="true">/</li>')}</ol>`
            : '';

        el.crumbs.querySelectorAll('[data-erp-crumb]').forEach((b) => {
            const key = b.dataset.erpCrumb;
            if (key) {b.addEventListener('click', () => navigate(key));}
        });
    }

    /* ── Toolbar ────────────────────────────────────────────────────── */
    function renderToolbar() {
        const items = state.toolbar.filter((t) => t && typeof t.onClick === 'function');
        if (!items.length) {el.toolbar.hidden = true; el.toolbar.innerHTML = ''; return;}
        el.toolbar.hidden = false;
        el.toolbar.innerHTML = items.map((t, i) => `
          <button type="button" class="erp-btn ${t.primary ? 'erp-btn--primary' : ''} erp-btn--sm"
                  data-erp-tool="${i}">
            ${t.icon ? `<i class="ji" data-i="${esc(t.icon)}" aria-hidden="true"></i>` : ''}
            <span>${esc(t.label)}</span>
          </button>`).join('');
        el.toolbar.querySelectorAll('[data-erp-tool]').forEach((b) => {
            b.addEventListener('click', () => items[Number(b.dataset.erpTool)].onClick());
        });
    }

    /* ── Integration boundaries (inert until a host mounts one) ─────── */
    function boundaryMarkup(name) {
        const meta = BOUNDARIES[name];
        return `<button type="button" class="erp-boundary" data-erp-boundary="${esc(name)}"
                        title="${esc(meta.label)} — حدّ تكامل غير موصول" hidden>
            <i class="ji" data-i="${esc(meta.icon)}" aria-hidden="true"></i>
            <span class="erp-sr-only">${esc(meta.label)}</span>
        </button>`;
    }

    /**
     * Replace a placeholder with a real implementation.
     * @param {string} name one of BOUNDARIES
     * @param {HTMLElement|(()=>HTMLElement)} content
     * @returns {boolean} false if the slot does not exist
     */
    function mountBoundary(name, content) {
        const slot = root.querySelector(`[data-erp-boundary="${name}"]`);
        if (!slot) {return false;}
        const node = typeof content === 'function' ? content() : content;
        if (!node) {return false;}
        slot.replaceWith(node);
        node.setAttribute('data-erp-boundary', name);
        const integrations = root.querySelector('[data-erp-integrations]');
        if (integrations) {integrations.hidden = false;}
        return true;
    }

    /* ── Drawer (mobile) ────────────────────────────────────────────── */
    let lastFocus = null;

    function setDrawer(open) {
        state.drawerOpen = open;
        root.classList.toggle('is-drawer-open', open);
        el.scrim.hidden = !open;
        el.drawerOpenBtn.setAttribute('aria-expanded', String(open));
        if (open) {
            lastFocus = document.activeElement;
            // Focus the first nav item so keyboard/SR users land inside.
            (el.nav.querySelector('.erp-nav-item') || el.sidebar).focus?.();
        } else if (lastFocus && typeof lastFocus.focus === 'function') {
            lastFocus.focus();
        }
    }

    root.querySelectorAll('[data-erp-open-drawer]').forEach((b) =>
        b.addEventListener('click', () => setDrawer(true)));
    root.querySelectorAll('[data-erp-close-drawer]').forEach((b) =>
        b.addEventListener('click', () => setDrawer(false)));

    /* ── Control centre (الحالة والتفضيلات والإجراءات الثانوية) ──────────
       Every control that used to sit in a horizontal strip is now stacked
       here. The old strip had to surrender width on narrow headers until it
       reached zero, which silently removed the password and server status
       (measured at 390 / 1024). A popover has a fixed, readable width at
       every viewport and no control can be squeezed out of it. */
    let moreOpen = false;
    let moreReturnFocus = null;

    function setMore(open, { returnFocus = true } = {}) {
        if (!el.morePanel || !el.moreToggle) {return;}
        moreOpen = !!open;
        el.morePanel.hidden = !moreOpen;
        el.moreToggle.setAttribute('aria-expanded', String(moreOpen));
        if (moreOpen) {
            /* The header may sit below the preview banner at scroll 0, so a
               hard-coded `top` would paint the panel over it. Anchor to the
               header's current bottom edge instead. */
            const header = root.querySelector('.erp-shell__header');
            const top = Math.max(8, Math.round((header ? header.getBoundingClientRect().bottom : 56) + 8));
            el.morePanel.style.top = `${top}px`;
            el.morePanel.style.maxHeight = `${Math.max(220, window.innerHeight - top - 16)}px`;
            moreReturnFocus = document.activeElement;
            const first = el.morePanel.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
            (first || el.morePanel).focus?.({ preventScroll: true });
        } else {
            if (returnFocus && moreReturnFocus && typeof moreReturnFocus.focus === 'function') {
                moreReturnFocus.focus({ preventScroll: true });
            }
            moreReturnFocus = null;
        }
    }

    el.moreToggle?.addEventListener('click', (event) => {
        event.stopPropagation();
        setMore(!moreOpen);
    });
    el.moreClose?.addEventListener('click', () => setMore(false));

    const onDocClick = (event) => {
        if (!moreOpen) {return;}
        if (el.morePanel?.contains(event.target) || el.moreToggle?.contains(event.target)) {return;}
        setMore(false, { returnFocus: false });
    };
    document.addEventListener('click', onDocClick);
    state.disposers.push(() => document.removeEventListener('click', onDocClick));
    const closeOnViewportChange = () => {
        if (moreOpen) {setMore(false, { returnFocus: false });}
    };
    window.addEventListener('scroll', closeOnViewportChange, { passive: true });
    window.addEventListener('resize', closeOnViewportChange);
    state.disposers.push(() => window.removeEventListener('scroll', closeOnViewportChange));
    state.disposers.push(() => window.removeEventListener('resize', closeOnViewportChange));

    /* ── Keyboard ───────────────────────────────────────────────────── */
    const onKeydown = (e) => {
        // Escape closes the control centre (WCAG 2.1.2) before the drawer.
        if (e.key === 'Escape' && moreOpen) {e.preventDefault(); setMore(false); return;}
        // Escape closes the drawer and returns focus (WCAG 2.1.2).
        if (e.key === 'Escape' && state.drawerOpen) {e.preventDefault(); setDrawer(false);}
    };
    document.addEventListener('keydown', onKeydown);
    state.disposers.push(() => document.removeEventListener('keydown', onKeydown));

    /* ── Theme control ──────────────────────────────────────────────── */
    state.themeControl = mountThemeControl(el.themeSlot);

    /* ── Density control (cozy/dense — css/v2/erp-density.css) ──────── */
    state.densityControl = mountDensityControl(el.densitySlot, root);

    /* ── Public surface ─────────────────────────────────────────────── */
    function navigate(key) {
        if (!key) {return;}
        setDrawer(false);
        if (typeof options.onNavigate === 'function') {options.onNavigate(key);}
        else {state.page = key; highlightActive();} // no host → at least reflect it
    }

    const api = {
        root,
        main: el.main,
        navigate,
        setPage(key) { state.page = key; highlightActive(); },
        setBreadcrumbs(crumb) { state.breadcrumbs = crumb || { title: '', trail: [] }; renderCrumbs(); },
        setToolbar(items) { state.toolbar = items || []; renderToolbar(); },
        mountBoundary,
        closeMore(options) { setMore(false, options); },
        refreshNav() { renderNav(); renderRole(); },
        setCompact(compact) {
            state.compact = !!compact;
            root.classList.toggle('is-compact', state.compact);
        },
        destroy() {
            state.disposers.forEach((fn) => { try { fn(); } catch { /* listener may already be detached */ } });
            state.themeControl?.destroy?.();
            state.densityControl?.destroy?.();
            root.remove();
        },
    };

    renderNav();
    renderRole();
    renderCrumbs();
    renderToolbar();
    if (options.breadcrumbs) {state.breadcrumbs = options.breadcrumbs; renderCrumbs();}

    return api;
}
