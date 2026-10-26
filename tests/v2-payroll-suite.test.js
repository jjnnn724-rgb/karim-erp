/**
 * v2-payroll-suite.test.js — عقد منظومة الرواتب الكاملة في V2
 * ═══════════════════════════════════════════════════════════════════════
 * المرجع: features/hr.js:733-987 (الكشف/التوليد/الخصومات/السلف/البنود/
 * العقود/التقييمات/الحذف/التصدير).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'payroll-suite.js');
const SCREEN = path.join(V2, 'screens', 'payroll.js');
const V2_HTML = path.join(APP, 'v2.html');
const REV = (fs.readFileSync(V2_HTML, 'utf8').match(/js\/v2\/preview\.js\?v=([0-9.]+)/) || [])[1];

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

function loadTemplate(file) {
    const source = read(file)
        .replace(/^import[\s\S]*?\s+from\s+['"][^'"]+['"];?\s*$/gm, '')
        .replace(/^export\s+/gm, '');
    const context = { Date, String };
    vm.createContext(context);
    vm.runInContext(`${source}\n;globalThis.template = template;`, context, { filename: file });
    return context.template;
}

function repoStub(impl) {
    const calls = [];
    const apiFetch = jest.fn(async (p, opts) => {
        calls.push({ path: p, method: (opts && opts.method) || 'GET', body: opts && opts.body });
        return impl ? impl(p, opts) : {};
    });
    return { apiFetch, calls };
}

describe('الرواتب — الأبواب', () => {
    test('التوليد والخصومات بنفس المسارات والحمولات', async () => {
        const { apiFetch, calls } = repoStub(() => ({}));
        const ctx = loadEsm(REPO, { apiFetch }, [
            'generatePayrollRun', 'fetchDeductionsPreview', 'applyDeductions',
        ]);
        await ctx.generatePayrollRun({ month: '2026-10', includeOvertime: true });
        await ctx.fetchDeductionsPreview({ month: '2026-10', skipFridays: false });
        await ctx.applyDeductions({ month: '2026-10', skipFridays: false });
        expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
            'POST /hr/payroll-runs/generate',
            'GET /hr/deductions/preview?month=2026-10&skip_fridays=0',
            'POST /hr/deductions/apply',
        ]);
        expect(JSON.parse(calls[0].body)).toEqual({ month: '2026-10', includeOvertime: true });
        expect(JSON.parse(calls[2].body)).toEqual({ month: '2026-10', skipFridays: false });
        await expect(ctx.generatePayrollRun({ month: 'bad', includeOvertime: false }))
            .rejects.toThrow('اختر الشهر');
        expect(calls).toHaveLength(3);
    });

    test('فحوص النماذج بنفس جمل القديم', () => {
        const ctx = loadEsm(REPO, {}, [
            'validateAdvance', 'validateAdjustment', 'validateContract', 'validateEvaluation',
            'PAYROLL_WRITE_ROLES',
        ]);
        expect(ctx.PAYROLL_WRITE_ROLES).toEqual(['admin', 'manager', 'hr']);
        expect(ctx.validateAdvance({ employeeId: 0, amount: 0, date: '' })).toBe('أكمل البيانات');
        expect(ctx.validateAdvance({ employeeId: 1, amount: 100, date: '2026-10-15' })).toBe('');
        expect(ctx.validateAdjustment({ employeeId: 1, month: '2026-10', amount: 50 })).toBe('');
        expect(ctx.validateAdjustment({ employeeId: 1, month: 'bad', amount: 50 })).toBe('أكمل البيانات');
        expect(ctx.validateContract({ employeeId: 1, start_date: '2026-01-01', end_date: '2025-01-01' })).toBe('تواريخ غير صالحة');
        expect(ctx.validateEvaluation({ employeeId: 1, period: '2026-10', score: 6 })).toBe('أكمل البيانات');
        expect(ctx.validateEvaluation({ employeeId: 1, period: '2026-10', score: 4 })).toBe('');
    });
});

describe('الرواتب — عقد الشاشة', () => {
    const src = () => read(SCREEN);

    test('بطاقات الشاشة داخل جذر واحد يشمل الجدول وكل أقسام الإدارة', () => {
        const template = loadTemplate(SCREEN);
        const html = template(true);
        expect(html).toMatch(/^<div class="erp-v2-payroll-root">/);
        expect(html).toContain('data-v2-table');
        expect(html).toContain('data-v2-ev-list');
        expect(html.trimEnd()).toMatch(/<\/section>\s*<\/div>$/);
    });

    test('المنظومة كاملة حاضرة', () => {
        const s = src();
        for (const k of ['data-v2-sheet', 'data-v2-sheet-export', 'data-v2-gen-go',
            'data-v2-ded-preview', 'data-v2-ded-apply', 'data-v2-adv-save',
            'data-v2-adj-save', 'data-v2-con-save', 'data-v2-ev-save', 'data-v2-del',
            'توليد مسير رواتب', 'تطبيق خصومات الالتزام لشهر']) {
            expect(s).toContain(k);
        }
    });

    test('بلا شبكة مباشرة ولا معالج سطري', () => {
        const s = src().replace(/\/\*[\s\S]*?\*\//g, '');
        expect(s).not.toMatch(/\bapiFetch\b/);
        expect(s).not.toMatch(/[^a-zA-Z]fetch\(/);
        expect(s.match(/\son[a-z]+\s*=\s*["']/g) || []).toHaveLength(0);
    });

    test('الوحدة الموحدة', () => {
        expect(REV).toBeTruthy();
        for (const f of [REPO, SCREEN]) {
            const versions = [...read(f).matchAll(/\?v=([0-9.]+)/g)].map((m) => m[1]);
            expect(versions.length).toBeGreaterThan(0);
            for (const v of versions) {expect(v).toBe(REV);}
        }
    });
});
