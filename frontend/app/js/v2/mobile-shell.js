/**
 * V2 — Mobile Navigation Shell (شريط التنقل السريع للجوال)
 * ═══════════════════════════════════════════════════════════════════════
 * المرجع: frontend/app/js/features/mobile-shell.js (المواصفة FR-M1..M6)
 *
 * القواعد الصارمة:
 *   • كود إضافي بالكامل (Additive) لا يمس أي ملف قديم.
 *   • الشاشات العريضة (> 900px) لا تتأثر مطلقاً.
 *   • التوكنات حصراً: استهلاك متغيّرات --erp-* فقط دون أي hex أو خط جديد.
 *   • إمكانية الوصول: أهداف لمس >= 44px، سمات ARIA، ومؤشر الصفحة النشطة.
 */

export const MOBILE_SHELL_ROLES = Object.freeze([
    'employee', 'cashier', 'kitchen', 'sous_chef',
    'warehouse', 'dept_head', 'admin', 'manager',
    'hr', 'accountant', 'owner',
]);

export const FIELD_ROLES = Object.freeze([
    'employee', 'cashier', 'kitchen', 'sous_chef',
    'warehouse', 'dept_head',
]);

export const BACKOFFICE_NAV_CANDIDATES = Object.freeze([
    ['cfo', 'المالية', 'banknote'],
    ['employees', 'الموظفون', 'users'],
    ['attendance', 'الحضور', 'clock'],
    ['reports', 'التقارير', 'chart'],
]);

export const FIELD_NAV_CANDIDATES = Object.freeze([
    ['payroll', 'رواتبي', 'wallet'],
    ['leaves', 'الإجازات', 'calendar'],
    ['dashboard', 'لوحتي', 'chart'],
]);

export const MOBILE_SHELL_BP = '(max-width: 900px)';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * حساب عناصر شريط الجوال بدقة وتطابق مع القديم
 * @param {{ role?: string, menus?: string[] }} params
 * @returns {Array<{ page: string, label: string, icon: string, key: string, punch?: boolean }>}
 */
export function computeMobileNavItems({ role = '', menus = [] } = {}) {
    if (!role || !MOBILE_SHELL_ROLES.includes(role)) {
        return [];
    }

    const isField = FIELD_ROLES.includes(role);
    const menuList = Array.isArray(menus) ? menus : [];
    const items = [];

    // 1) الصفحة الرئيسية للدور
    const home = isField
        ? (menuList.includes('employee-portal') ? 'employee-portal' : menuList[0])
        : (menuList.includes('dashboard') ? 'dashboard' : menuList[0]);

    if (home) {
        items.push({ page: home, label: 'الرئيسية', icon: 'home', key: 'home' });
    }

    // 2) زر البصمة المباشرة لأدوار الميدان
    if (isField && menuList.includes('employee-portal')) {
        items.push({ page: 'employee-portal', label: 'بصمتي', icon: 'clock', key: 'punch', punch: true });
    }

    // 3) المرشحات الإضافية حسب طبيعة العمل
    const candidates = isField ? FIELD_NAV_CANDIDATES : BACKOFFICE_NAV_CANDIDATES;
    for (const cand of candidates) {
        const [pageKey, label, icon] = cand;
        if (menuList.includes(pageKey) && pageKey !== home && !items.some((it) => it.page === pageKey)) {
            items.push({ page: pageKey, label, icon, key: pageKey });
        }
        if (items.length >= 4) {
            break;
        }
    }

    // 4) زر المزيد لفتح القائمة الجانبية (Drawer)
    items.push({ page: '__more', label: 'المزيد', icon: 'menu', key: '__more' });

    return items;
}

/**
 * فحص تفعيل الهيكل بناءً على الشاشة والدور والمفتاح
 */
export function isMobileShellActive({ role, matchesMedia = false, enabled = true } = {}) {
    if (!enabled) {return false;}
    if (!role || !MOBILE_SHELL_ROLES.includes(role)) {return false;}
    return Boolean(matchesMedia);
}

/**
 * تركيب وتوصيل شريط الجوال بالواجهة
 */
export function mountMobileShell({
    container = (typeof document !== 'undefined' ? document.body : null),
    onNavigate,
    onToggleDrawer,
    getRole = () => null,
    getMenus = () => [],
    getPage = () => null,
    mediaQuery = MOBILE_SHELL_BP,
} = {}) {
    if (!container || typeof window === 'undefined') {
        return {
            update() {},
            setPage() {},
            destroy() {},
            getElement: () => null,
            isMounted: () => false,
        };
    }

    let mql = null;
    try {
        mql = window.matchMedia ? window.matchMedia(mediaQuery) : null;
    } catch (_) {}

    let navEl = container.querySelector('#erpMobileNav');
    let activePage = getPage();

    function render() {
        const role = getRole();
        const menus = getMenus();
        const matches = mql ? mql.matches : false;
        const active = isMobileShellActive({ role, matchesMedia: matches });

        if (!active) {
            document.body.classList.remove('erp-mobile-shell-on');
            if (navEl) {
                navEl.remove();
                navEl = null;
            }
            return;
        }

        document.body.classList.add('erp-mobile-shell-on');
        if (!navEl) {
            navEl = document.createElement('nav');
            navEl.id = 'erpMobileNav';
            navEl.className = 'erp-v2 erp-mobile-nav';
            navEl.setAttribute('aria-label', 'شريط التنقل السريع');
            container.appendChild(navEl);
        }

        const items = computeMobileNavItems({ role, menus });
        activePage = getPage() || activePage;
        let activeMarked = false;

        navEl.innerHTML = items.map((it) => {
            const isActive = it.page === activePage && !activeMarked;
            if (isActive) {activeMarked = true;}
            return `
              <button type="button" class="erp-mnav-item${isActive ? ' is-active' : ''}"
                      data-mpage="${esc(it.page)}" data-mkey="${esc(it.key)}"
                      aria-label="${esc(it.label)}" ${isActive ? 'aria-current="page"' : ''}>
                <i class="ji" data-i="${esc(it.icon)}" aria-hidden="true"></i>
                <span class="erp-mnav-label">${esc(it.label)}</span>
              </button>`;
        }).join('');

        navEl.querySelectorAll('.erp-mnav-item').forEach((btn) => {
            btn.addEventListener('click', () => {
                const page = btn.dataset.mpage;
                const key = btn.dataset.mkey;
                if (page === '__more') {
                    if (typeof onToggleDrawer === 'function') {
                        onToggleDrawer();
                    }
                    return;
                }
                if (typeof onNavigate === 'function') {
                    onNavigate(page);
                }
                if (key === 'punch') {
                    setTimeout(() => {
                        const punchEl = document.getElementById('punchCard')
                            || document.getElementById('punchBtn')
                            || document.querySelector('[data-punch-target]');
                        punchEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 200);
                }
            });
        });
    }

    function setPage(page) {
        activePage = page;
        if (!navEl) {return;}
        let marked = false;
        navEl.querySelectorAll('.erp-mnav-item').forEach((btn) => {
            const on = btn.dataset.mpage === activePage && !marked;
            if (on) {marked = true;}
            btn.classList.toggle('is-active', on);
            if (on) {
                btn.setAttribute('aria-current', 'page');
            } else {
                btn.removeAttribute('aria-current');
            }
        });
    }

    const handleMediaChange = () => render();
    if (mql) {
        if (typeof mql.addEventListener === 'function') {
            mql.addEventListener('change', handleMediaChange);
        } else if (typeof mql.addListener === 'function') {
            mql.addListener(handleMediaChange);
        }
    }

    render();

    return {
        update: render,
        setPage,
        getElement: () => navEl,
        isMounted: () => Boolean(navEl && navEl.isConnected),
        destroy() {
            if (mql) {
                if (typeof mql.removeEventListener === 'function') {
                    mql.removeEventListener('change', handleMediaChange);
                } else if (typeof mql.removeListener === 'function') {
                    mql.removeListener(handleMediaChange);
                }
            }
            document.body.classList.remove('erp-mobile-shell-on');
            if (navEl) {
                navEl.remove();
                navEl = null;
            }
        },
    };
}
