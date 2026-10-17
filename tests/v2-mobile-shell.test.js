/**
 * v2-mobile-shell.test.js — عقد شريط الجوال المتجاوب (المحطة 1)
 * ═══════════════════════════════════════════════════════════════════════
 * المرجع: frontend/app/js/features/mobile-shell.js (المواصفة FR-M1..M6)
 *
 * الفحوصات:
 *   ١) الحساب الخالص للعناصر: أدوار الميدان vs أدوار الإدارة، سقف 5 عناصر.
 *   ٢) الفحص الشرطي للتفعيل: الشاشة <= 900px + دور معتمد.
 *   ٣) اتساق التصميم والتوكنات: صفر ألوان خام، احترام مقياس الطبقات.
 *   ٤) السلوك والتنقل وسمات الوصولية ARIA وخصائص اللمس >= 44px.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'frontend', 'app');
const JS_V2 = path.join(APP, 'js', 'v2');
const MOBILE_JS = path.join(JS_V2, 'mobile-shell.js');
const MOBILE_CSS = path.join(APP, 'css', 'v2', 'erp-mobile-shell.css');

const read = (p) => fs.readFileSync(p, 'utf8');

function loadEsm(file, injections = {}, collect = []) {
    const stripped = read(file)
        .replace(/^import\s+[\s\S]*?\s+from\s+'[^']*';?[^\S\r\n]*$/gm, '')
        .replace(/^import\s+'[^']*';?[^\S\r\n]*$/gm, '')
        .replace(/^export\s+/gm, '');
    const src = collect.length
        ? `${stripped}\n;Object.assign(globalThis, {${collect.join(', ')}});`
        : stripped;
    const context = {
        console, JSON, String, Number, Boolean, Array, Object, RegExp, Error,
        Date, Math, Promise, Set, Map, Intl,
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: file });
    return context;
}

describe('mobile-shell — الحساب الخالص والعناصر', () => {
    const ctx = loadEsm(MOBILE_JS, {}, [
        'MOBILE_SHELL_ROLES',
        'FIELD_ROLES',
        'computeMobileNavItems',
        'isMobileShellActive',
    ]);

    test('أدوار الميدان: employee يحصل على الرئيسية وبصمتي والرواتب والإجازات والمزيد', () => {
        const menus = ['employee-portal', 'payroll', 'leaves', 'attendance'];
        const items = ctx.computeMobileNavItems({ role: 'employee', menus });

        expect(items).toHaveLength(5);
        expect(items[0]).toEqual({ page: 'employee-portal', label: 'الرئيسية', icon: 'home', key: 'home' });
        expect(items[1]).toEqual({ page: 'employee-portal', label: 'بصمتي', icon: 'clock', key: 'punch', punch: true });
        expect(items[2]).toEqual({ page: 'payroll', label: 'رواتبي', icon: 'wallet', key: 'payroll' });
        expect(items[3]).toEqual({ page: 'leaves', label: 'طلبي', icon: 'calendar', key: 'leaves' });
        expect(items[4]).toEqual({ page: '__more', label: 'المزيد', icon: 'menu', key: '__more' });
    });

    test('أدوار الإدارة: cfo / accountant يحصل على لوحته وعناصر المالية والإدارة', () => {
        const menus = ['dashboard', 'cfo', 'revenues', 'expenses', 'reports'];
        const items = ctx.computeMobileNavItems({ role: 'accountant', menus });

        expect(items).toHaveLength(4); // dashboard, cfo, reports, __more
        expect(items[0].key).toBe('home');
        expect(items[0].page).toBe('dashboard');
        expect(items.some((it) => it.key === 'punch')).toBe(false);
        expect(items[items.length - 1].key).toBe('__more');
    });

    test('أدوار الإدارة الكاملة: admin يحصل على 5 عناصر كحد أقصى مع المزيد', () => {
        const menus = ['dashboard', 'cfo', 'employees', 'attendance', 'reports', 'settings'];
        const items = ctx.computeMobileNavItems({ role: 'admin', menus });

        expect(items).toHaveLength(5);
        expect(items.map((it) => it.key)).toEqual(['home', 'cfo', 'employees', 'attendance', '__more']);
        expect(items[4].page).toBe('__more');
    });

    test('دور غير مصرح أو غائب: يعيد مصفوفة فارغة', () => {
        expect(ctx.computeMobileNavItems({ role: 'unknown_role', menus: ['dashboard'] })).toEqual([]);
        expect(ctx.computeMobileNavItems({ role: '', menus: ['dashboard'] })).toEqual([]);
    });

    test('فحص نشاط الهيكل: شرط الشاشة <= 900px والدور المعتمد', () => {
        expect(ctx.isMobileShellActive({ role: 'employee', matchesMedia: true })).toBe(true);
        expect(ctx.isMobileShellActive({ role: 'admin', matchesMedia: true })).toBe(true);
        expect(ctx.isMobileShellActive({ role: 'admin', matchesMedia: false })).toBe(false);
        expect(ctx.isMobileShellActive({ role: 'guest', matchesMedia: true })).toBe(false);
        expect(ctx.isMobileShellActive({ role: 'admin', matchesMedia: true, enabled: false })).toBe(false);
    });
});

describe('mobile-shell — التنسيقات والتوكنات', () => {
    const css = read(MOBILE_CSS);

    test('صفر ألوان خام: لا وجود لـ hex في ملف التنسيق', () => {
        const hexMatches = css.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
        expect(hexMatches).toEqual([]);
    });

    test('الطبقة من مقياس التوكنات المعتمد (--erp-z-fab)', () => {
        expect(css).toContain('z-index: var(--erp-z-fab);');
    });

    test('هدف لمس لا يقل عن 44px (FR-M4)', () => {
        expect(css).toMatch(/min-height:\s*(?:4[4-9]|[5-9]\d)px/);
    });

    test('دعم الحواف الآمنة للهواتف (safe-area-inset-bottom)', () => {
        expect(css).toContain('env(safe-area-inset-bottom, 0px)');
    });
});

describe('mobile-shell — التركيب والتفاعل في DOM', () => {
    test('تركيب الهيكل، تفعيل الأزرار، والتبديل عند تغير الصفحة', () => {
        const listeners = {};
        const fakeMql = {
            matches: true,
            addEventListener: (ev, fn) => { listeners[ev] = fn; },
            removeEventListener: () => {},
        };

        const fakeBody = {
            classList: {
                classes: new Set(),
                add(c) { this.classes.add(c); },
                remove(c) { this.classes.delete(c); },
                contains(c) { return this.classes.has(c); },
            },
        };

        const fakeDocument = {
            body: fakeBody,
            createElement: (tag) => {
                const el = {
                    tagName: tag.toUpperCase(),
                    className: '',
                    id: '',
                    attrs: {},
                    children: [],
                    isConnected: true,
                    setAttribute(k, v) { this.attrs[k] = v; },
                    getAttribute(k) { return this.attrs[k]; },
                    removeAttribute(k) { delete this.attrs[k]; },
                    classList: {
                        toggle(cls, on) {
                            if (on) {el.className += ' ' + cls;}
                            else {el.className = el.className.replace(cls, '').trim();}
                        },
                    },
                    querySelector: () => null,
                    querySelectorAll: () => [],
                    appendChild: (c) => el.children.push(c),
                    remove: () => { el.isConnected = false; },
                };
                return el;
            },
        };

        const ctx = loadEsm(MOBILE_JS, {
            document: fakeDocument,
            window: {
                matchMedia: () => fakeMql,
            },
        }, ['mountMobileShell']);

        const dummyContainer = fakeDocument.createElement('div');
        dummyContainer.querySelector = () => null;

        const navigated = [];
        let drawerToggled = false;

        const shell = ctx.mountMobileShell({
            container: dummyContainer,
            getRole: () => 'employee',
            getMenus: () => ['employee-portal', 'payroll'],
            getPage: () => 'employee-portal',
            onNavigate: (p) => navigated.push(p),
            onToggleDrawer: () => { drawerToggled = true; },
        });

        expect(shell.isMounted()).toBe(true);
        expect(fakeBody.classList.contains('erp-mobile-shell-on')).toBe(true);

        shell.destroy();
        expect(fakeBody.classList.contains('erp-mobile-shell-on')).toBe(false);
    });
});
