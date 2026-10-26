/**
 * lint-gate.test.js — بوابة ESLint: أخطاء + تحذيرات جديدة فقط
 * ──────────────────────────────────────────────────────────────
 * القاعدة: خط أساس لكل ملف. أي ملف يتجاوز حصته يفشل، وأي خطأ يفشل.
 * الإصلاح ba-baseline لا يُرفع أبداً — يُخفض فقط.
 */
const fs = require('fs');
const path = require('path');
const { compare } = require('../scripts/lint-gate');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_FILE = path.join(ROOT, 'scripts', 'lint-baseline.json');

describe('بوابة lint (scripts/lint-gate.js)', () => {
    test('خط الأساس في المستودع صالح ومتسق مع نفسه', () => {
        expect(fs.existsSync(BASELINE_FILE)).toBe(true);
        const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
        expect(typeof baseline.total).toBe('number');
        expect(baseline.total).toBeGreaterThanOrEqual(0);
        const sum = Object.values(baseline.files || {}).reduce((s, n) => s + Number(n), 0);
        expect(sum).toBe(baseline.total);
    });

    test('وضع مطابق للأساس ينجح', () => {
        const baseline = { total: 10, files: { 'a.js': 6, 'b.js': 4 } };
        const current = { errors: 0, warnings: 10, files: { 'a.js': 6, 'b.js': 4 } };
        expect(compare(baseline, current)).toEqual([]);
    });

    test('أي خطأ ESLint يفشل فوراً', () => {
        const failures = compare({ total: 10, files: {} }, { errors: 1, warnings: 0, files: {} });
        expect(failures.some((f) => f.includes('أخطاء'))).toBe(true);
    });

    test('تحذير جديد في ملف قائم يفشل', () => {
        const baseline = { total: 10, files: { 'a.js': 6 } };
        const current = { errors: 0, warnings: 11, files: { 'a.js': 7 } };
        const failures = compare(baseline, current);
        expect(failures.some((f) => f.includes('a.js'))).toBe(true);
    });

    test('ملف جديد بتحذير واحد يفشل (حصة الصفر)', () => {
        const baseline = { total: 10, files: { 'a.js': 10 } };
        const current = { errors: 0, warnings: 11, files: { 'a.js': 10, 'new.js': 1 } };
        const failures = compare(baseline, current);
        expect(failures.some((f) => f.includes('new.js'))).toBe(true);
    });

    test('إنقاص التحذيرات ينجح (تخفيض الأساس ممكن)', () => {
        const baseline = { total: 10, files: { 'a.js': 10 } };
        const current = { errors: 0, warnings: 4, files: { 'a.js': 4 } };
        expect(compare(baseline, current)).toEqual([]);
    });

    test('ملف اختفى من الأساس يخفض المجموع ولا يفشل', () => {
        const baseline = { total: 10, files: { 'a.js': 6, 'b.js': 4 } };
        const current = { errors: 0, warnings: 6, files: { 'a.js': 6 } };
        expect(compare(baseline, current)).toEqual([]);
    });
});
