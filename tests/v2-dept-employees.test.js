/**
 * v2-dept-employees.test.js — عقد شاشة موظفي القسم ومرآة خادمها
 * ═══════════════════════════════════════════════════════════════════════
 * المرجع: backend/hr-routes.js:1733-1798 — dept_head حصراً، النطاق
 * dept_code بقائمة فواصل، حقول آمنة فقط (الاسم/الرقم الوظيفي/الوظيفة/
 * الهاتف)، والحذف تعطيل آمن يحفظ التاريخ. رسائل التحقق منطوقة من رفض
 * الخادم نفسه (:1754-1757) — نفس الكلام من هنا أو من هناك.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'dept-employees-repo.js');
const SCREEN = path.join(V2, 'screens', 'dept-employees.js');
const SERVER = path.join(__dirname, '..', 'backend', 'hr-routes.js');

const read = (p) => fs.readFileSync(p, 'utf8');

function loadEsm(file, injections = {}, collect = []) {
    const stripped = read(file)
        .split('\n')
        .filter((line) => !/^\s*import\b|^\s*from\s*'[^']*';?\s*$/.test(line))
        .join('\n')
        .replace(/^export\s+/gm, '');
    const src = collect.length
        ? `${stripped}\n;Object.assign(globalThis, {${collect.join(', ')}});`
        : stripped;
    const context = {
        console, JSON, String, Number, Boolean, Array, Object, RegExp, Error,
        Date, Math, Promise, Set, Map, Intl, encodeURIComponent,
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: file });
    return context;
}

function repoStub(impl) {
    const calls = [];
    const apiFetch = jest.fn(async (p, opts) => {
        calls.push({ path: p, method: (opts && opts.method) || 'GET', body: opts && opts.body });
        return impl ? impl(p, opts) : {};
    });
    return { apiFetch, calls };
}

/** سطور الخادم الأربعة لهذه الميزة — يُقطع منها النص المثبت. */
function serverSlice() {
    const src = read(SERVER);
    const a = src.indexOf("router.get('/dept-employees'");
    const b = src.indexOf('router.put', src.indexOf("router.delete('/dept-employees/:id'"));
    return src.slice(a, b > 0 ? b : undefined);
}

describe('موظفو القسم — مرآة الخادم', () => {
    const srv = serverSlice();

    test('البوابة dept_head حصراً — مرآة حرفية', () => {
        expect(srv).toMatch(/requireRole\('dept_head'\)/);
        expect(srv.match(/requireRole\('dept_head'\)/g).length).toBe(4); // الأبواب الأربعة
        const ctx = loadEsm(REPO, {}, ['DEPT_EMP_WRITE_ROLES']);
        expect(ctx.DEPT_EMP_WRITE_ROLES).toEqual(['dept_head']);
    });

    test('الأبواب الأربعة تطابق الراوتر مساراً وطريقة', async () => {
        const { apiFetch, calls } = repoStub(() => ({}));
        const ctx = loadEsm(REPO, { apiFetch }, [
            'fetchDeptEmployees', 'createDeptEmployee', 'updateDeptEmployee', 'deactivateDeptEmployee',
        ]);
        await ctx.fetchDeptEmployees();
        await ctx.createDeptEmployee({ name: 'سالم', employeeId: 'EMP-90' });
        await ctx.updateDeptEmployee(12, { name: 'سالم ع' });
        await ctx.deactivateDeptEmployee(12);
        expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
            'GET /hr/dept-employees',
            'POST /hr/dept-employees',
            'PUT /hr/dept-employees/12',
            'DELETE /hr/dept-employees/12',
        ]);
        expect(JSON.parse(calls[1].body)).toEqual({ name: 'سالم', employeeId: 'EMP-90', position: null, phone: null });
    });

    test('رسائل التحقق منطوقة من رفض الخادم حرفياً', () => {
        const ctx = loadEsm(REPO, {}, ['validateDeptEmpForm']);
        // :1754
        expect(srv).toContain("'الاسم والرقم الوظيفي إجباريان'");
        // :1755
        expect(srv).toContain("'الرقم الوظيفي: حروف لاتينية/أرقام فقط (2-50)'");
        // :1757
        expect(srv).toContain("'الرقم الوظيفي مستخدم بالفعل'");
        // المرآة تصرخ بالاثنين الأولين قبل أي شبكة
        expect(ctx.validateDeptEmpForm({}).errors).toContain('الاسم والرقم الوظيفي إجباريان');
        expect(ctx.validateDeptEmpForm({ name: 'س', employeeId: 'م-١٢٣' }).errors)
            .toContain('الرقم الوظيفي: حروف لاتينية/أرقام فقط (2-50)');
        expect(ctx.validateDeptEmpForm({ name: 'سالم', employeeId: 'EMP-90' }).ok).toBe(true);
    });

    test('normalize يقصّ بالحدود نفسها (:1750-1753)', () => {
        const ctx = loadEsm(REPO, {}, ['normalizeDeptEmpForm']);
        const long = 'x'.repeat(300);
        const out = ctx.normalizeDeptEmpForm({ name: ` ${long} `, employeeId: 'EMP-90', position: long, phone: long });
        expect(out.name).toHaveLength(255);
        expect(out.employeeId).toBe('EMP-90');
        expect(out.position).toHaveLength(255);
        expect(out.phone).toHaveLength(50);
    });

    test('deptEmpToRow: المجهول يُعرض خاماً — لا اختراع', () => {
        const ctx = loadEsm(REPO, {}, ['deptEmpToRow']);
        const row = ctx.deptEmpToRow({ id: 5, name: 'سالم', employeeId: 'EMP-90' });
        expect(row.position).toBe('—');
        expect(row.phone).toBe('—');
        expect(row.status).toBe('');
    });

    test('تسمية النطاق بعبارات القديم: «المطبخ + الصالة»', () => {
        const ctx = loadEsm(REPO, {}, ['deptScopeLabel']);
        expect(ctx.deptScopeLabel(['CAF', 'SERVICE'])).toBe('CAF + SERVICE');
    });
});

describe('موظفو القسم — عقد الشاشة', () => {
    const src = read(SCREEN);

    test('لا inline handler ولا fetch (CSP + باب واحد)', () => {
        expect(src).not.toMatch(/\son(click|change|submit|input|keydown)=/i);
        expect(src).not.toMatch(/\bfetch\s*\(/);
    });

    test('التعطيل وحده بتأكيد يسمّي الموظف وعاقبة الحفظ', () => {
        expect(src).toContain('تعطيل الموظف «');
        expect(src).toContain('سجلاته التاريخية تبقى محفوظة');
        expect(src).toMatch(/if \(saving\)\s*\{\s*return;\s*\}/);
    });

    test('الرقم الوظيفي مقفل عند التعديل — الخادم لا يقبله (:1769 لا يقرأه)', () => {
        expect(src).toContain('idInput.readOnly = !!row');
        expect(src).toContain('الخادم يقفل الرقم الوظيفي');
    });

    test('حارس isConnected وdestroy — والفشل بأمانة', () => {
        expect(src).toMatch(/if \(!el\.isConnected\)\s*\{\s*return;\s*\}/);
        expect(src).toContain('table.destroy()');
        expect(src).toContain('انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.');
        expect(src).toContain('القرار للخادم وحده');
    });

    test('أزرار الكتابة لا تُعرض إلا لبوابة dept_head', () => {
        expect(src).toContain('DEPT_EMP_WRITE_ROLES');
        expect(src).toMatch(/\.\.\.\(writable \? \[\{/);
        expect(src).toContain('writable ? `<button type="button" class="erp-btn erp-btn--primary');
    });

    test('بنية المعيار: الشاشة تفوّض للسجل المشترك ul.erp-kpis > li.erp-kpi', () => {
        // الشريط من role-dash-parts (2026-10-26) — البنية معقودة على البيت المشترك.
        expect(src).toMatch(/import \{ kpiStrip \} from '\.\.\/role-dash-parts\.js\?v=/);
        expect(src).not.toMatch(/function kpiStrip/);
        const shared = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'js', 'v2', 'role-dash-parts.js'), 'utf8');
        expect(shared).toMatch(/<ul class="erp-kpis"/);
        expect(shared).toMatch(/<li class="erp-kpi"/);
        expect(shared).not.toMatch(/<div class="erp-kpi">/);
        expect(shared).not.toContain('erp-kpi-grid');
    });
});
