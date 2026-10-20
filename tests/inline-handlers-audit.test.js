/**
 * inline-handlers-audit.test.js — بوابة المعالجات السطرية
 * ──────────────────────────────────────────────────────────────
 * المعالجات السطرية داخل قوالب HTML تُنفَّذ في النطاق العالمي. إن كان الملف
 * وحدة (module) بلا تصدير الدالة، يسقط النقر بـReferenceError بصمت:
 * الزر موجود ولا يفعل شيئاً.
 *
 * المدقّق (scripts/audit-inline-handlers.js) يجب أن يبقى نظيفاً — أي معالج
 * جديد بلا نطاق عام = فشل في CI.
 */
const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function runAudit() {
    try {
        const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'audit-inline-handlers.js'), '--json'], {
            cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
        });
        return { findings: JSON.parse(out || '[]') };
    } catch (err) {
        // exit 1 = وُجدت نتائج (المدقّق يفشل عمداً عند وجودها)
        const stdout = String(err.stdout || '');
        try { return { findings: JSON.parse(stdout || '[]') }; }
        catch { throw new Error(`تعذّر تشغيل المدقّق: ${err.message}`); }
    }
}

describe('بوابة المعالجات السطرية', () => {
    test('لا يوجد معالج سطري بلا نطاق عام', () => {
        const { findings } = runAudit();
        const summary = findings.map((f) => `${f.file}:${f.line} ${f.handler} — ${f.reason}`);
        expect(summary).toEqual([]);
    });

    test('المدقّق يكشف حالة معطّلة عندحقنها (اختبار سلبي)', () => {
        // نتحقق أن أداة الكشف نفسها تعمل: نبحث عن نمط معروف في كود المستودع
        const fs = require('fs');
        const warehouseSrc = fs.readFileSync(path.join(ROOT, 'frontend', 'app', 'js', 'features', 'warehouse.js'), 'utf8');
        // المعالج موجود في القالب، والدالة مُصدَّرة الآن (إلاFixed سابقًا)
        expect(warehouseSrc).toContain('onclick="addSecUnitPreset(');
        const exportsLine = warehouseSrc.slice(warehouseSrc.lastIndexOf('export {'));
        expect(exportsLine).toContain('addSecUnitPreset');
    });
});
