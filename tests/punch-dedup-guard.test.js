// ────────────────────────────────────────────────────────────────────────────
// punch-dedup-guard.test.js — بلاغ المالك كريم عبد الحميد 2026-10-06
// «بصمت اليوم من كاميرا الهاتف ولم تظهر» — بصمة وجه موثقة (ثقة 100) قُبلت ثم
// جُحتها بقرار «مكررة خلال 5 دقائق» من كاش راسب لا تعرفه القاعدة.
// يقفل الإصلاح الجذري في attendance-engine.js:
//  1) حرس التكرار يتحقق من القاعدة قبل التجاهل (fail-safe نحو التسجيل)
//  2) مرساة الكاش تُثبت بعد COMMIT الناجح فقط وللقرارات الفعلية
//  3) فشل الكتابة يمسح الكاش فلا يلتهم بصمة تالية
// ────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'backend', 'attendance-engine.js'), 'utf8');

describe('حرس التكرار في محرك الحضور — لا يلتهم بصمة موثقة بسبب ذاكرة راسبة', () => {
    test('التجاهل بسبب «مكررة» يتحقق من القاعدة أولًا (دفتر الجهاز + صفوف الحضور داخل النافذة)', () => {
        expect(ENGINE).toContain('حرس التكرار لا يثق بالذاكرة وحدها');
        expect(ENGINE).toContain("String(verdict.reason || '').includes('مكررة')");
        expect(ENGINE).toContain('FROM attendance_logs WHERE "employeeId"=$1 AND "attendanceTime" BETWEEN $2 AND $3');
        expect(ENGINE).toContain('OR "checkOutAt" BETWEEN $2 AND $3');
        expect(ENGINE).toContain('this.lastPunches.delete(employeeId);');
        expect(ENGINE).toContain('أُعيد التصنيف وتُسجل البصمة');
    });

    test('نافذة التحقق تستثني البصمة نفسها (وإلّا كان العدّاد ≥1 دائمًا)', () => {
        // درس 2026-10-14: البصمة تُدرج في attendance_logs قبل الكتابة، فاستعلام
        // BETWEEN winStart AND instant كان يعدّ البصمة الحالية «دليلًا» على تكرارها
        // ولا يمسح الكاش الراسب أبدًا — فابتُلع دخول المساء لليوم كامل.
        expect(ENGINE).toContain('const winEnd = new Date(instant - 1000);');
        expect(ENGINE).toContain('[employeeId, winStart, winEnd]');
    });

    test('مرساة الكاش تُثبت بعد COMMIT الناجح وللقرارات الفعلية فقط', () => {
        const execMark = ENGINE.indexOf('// ── تنفيذ القرار ──');
        const commitMark = ENGINE.indexOf("await client.query('COMMIT');", execMark);
        const setMark = ENGINE.indexOf('this.lastPunches.set(employeeId, { min: wallMin, out: thisOut, at: instant.getTime() });');
        expect(execMark).toBeGreaterThan(-1);
        expect(commitMark).toBeGreaterThan(execMark);
        expect(setMark).toBeGreaterThan(commitMark); // بعد الـ COMMIT — لا تثبيت قبل الكتابة
        const guard = ENGINE.slice(setMark - 200, setMark);
        expect(guard).toContain("action === 'check_in' || action === 'check_out'");
    });

    test('البصمة المُتجاهلة لا تحرك المرساة، وفشل الكتابة يمسح الكاش', () => {
        // سطر المرساة بصيغته الكاملة يظهر مرة واحدة: بعد COMMIT وللقرارات الفعلية فقط
        const anchorWrites = (ENGINE.match(/this\.lastPunches\.set\(employeeId, \{ min: wallMin, out: thisOut, at: instant\.getTime\(\) \}\)/g) || []).length;
        expect(anchorWrites).toBe(1);
        // مسار الفشل في processPunch: مسح الكاش قبل إعادة رفع الخطأ
        const failMark = ENGINE.indexOf("logger.error('[AttendanceEngine] processPunch failed:'");
        expect(failMark).toBeGreaterThan(-1);
        const beforeFail = ENGINE.slice(Math.max(0, failMark - 500), failMark);
        expect(beforeFail).toContain('ROLLBACK');
        expect(beforeFail).toContain('this.lastPunches.delete(employeeId);');
    });

    test('القرار المُعاد بعد كشف الكاش الراسب يُسجل بالتحذير للمراجعة', () => {
        expect(ENGINE).toContain('[AttendanceEngine] حرس التكرار اعتمد على ذاكرة راسبة');
    });
});
