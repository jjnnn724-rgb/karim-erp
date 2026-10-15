/**
 * v2-employee-portal.test.js — عقد شاشة بوابة الموظف
 * ═══════════════════════════════════════════════════════════════════════
 * المرجع: features/employee-portal.js:19-109 (الربط/المؤشرات/السجلان/
 * الطباعة/البصمات) + portalWorkHours الليلي (:7-15).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const SCREEN = path.join(V2, 'screens', 'employee-portal.js');
const V2_HTML = path.join(APP, 'v2.html');
const HOST = path.join(V2, 'preview.js');
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

describe('بوابة الموظف — حساب الساعات الليلي', () => {
    test('portalWorkHours: الالتفاف بعد منتصف الليل', () => {
        const ctx = loadEsm(SCREEN, {}, ['portalWorkHours']);
        expect(ctx.portalWorkHours({ checkIn: '22:00', checkOut: '06:00' })).toBe(8);
        expect(ctx.portalWorkHours({ checkIn: '09:00', checkOut: '17:00' })).toBe(8);
        expect(ctx.portalWorkHours({ checkIn: '09:00' })).toBe(null);
        expect(ctx.portalWorkHours({})).toBe(null);
    });
});

describe('بوابة الموظف — عقد الشاشة', () => {
    const src = () => read(SCREEN);

    test('العناصر الأربعة للقديم حاضرة', () => {
        const s = src();
        for (const k of ['لم يتم ربط حسابك بملف موظف', 'data-v2-emp',
            'data-v2-print-day', 'data-v2-print-month', 'data-v2-month',
            'سجل الحضور والانصراف', 'سجل الإجازات', 'بصمات اليوم',
            'fetchAttendanceReport', 'fetchLeaveWorkflow', 'fetchMyPunches']) {
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
        const versions = [...read(SCREEN).matchAll(/\?v=([0-9.]+)/g)].map((m) => m[1]);
        expect(versions.length).toBeGreaterThan(0);
        for (const v of versions) {expect(v).toBe(REV);}
    });

    test('المضيف ما زال يربط المفتاح', () => {
        const h = read(HOST);
        expect(h).toMatch(/mount: mountEmployeePortalScreen/);
        expect(h).toMatch(/key: 'employee-portal'/);
    });
});
