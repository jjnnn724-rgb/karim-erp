/**
 * cost-analysis-parity.test.js — رقم واحد لتحليل التكاليف بين القديم وV2
 * ═══════════════════════════════════════════════════════════════════════
 * الحادثة (2026-10-21): نفس الفترة أعطت 1,105,032.85 في القديم و1,788,908.69
 * في V2. السبب مركّب:
 *   1) كتابات ما بعد 102_branches لا تختم branch_id، والقوائم القديمة مفلترة
 *      بالفرع — فكانت 6,528 إيرادًا مخفيًا عن القديم.
 *   2) القديم كان يجمع صفوف الأقسام، وصف المطبخ يشمل أبناءه → مضاعفة الشجرة.
 *   3) فروق جرد بلا deptId (2,095.39) كانت تسقط من إجمالي V2 وتظهر في دونه.
 * هذا الملف يقفل الثلاثة: الإجمالي من الحركات الخام في الواجهتين، وختم الفرع
 * من الجذر في القاعدة.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LEGACY = fs.readFileSync(path.join(ROOT, 'frontend', 'app', 'js', 'features', 'finance.js'), 'utf8');
const NAV = fs.readFileSync(path.join(ROOT, 'frontend', 'app', 'js', 'features', 'auth-navigation.js'), 'utf8');
const BACKEND = fs.readFileSync(path.join(ROOT, 'backend', 'finance-routes.js'), 'utf8');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'database', 'migrations', '106_branch_autostamp.sql'), 'utf8');

const STOCK_TYPES = ['dispatch', 'dispatch_return', 'receipt', 'stock_transfer', 'inventory_transfer', 'kitchen_return'];

describe('تحليل التكاليف — مصدر واحد للإجماليات', () => {
    test('القديم يجمع الإجماليات من الحركات نفسها لا من صفوف الأقسام', () => {
        expect(LEGACY).toContain('const periodRev=STATE.revenues.filter(inPeriod);');
        expect(LEGACY).toContain('const periodExp=STATE.expenses.filter(inPeriod);');
        expect(LEGACY).toContain('const sumAmount=rows=>rows.reduce((s,e)=>s+Number(e.amount||0),0);');
        expect(LEGACY).toContain('const totalRev=sumAmount(periodRev);');
        expect(LEGACY).toContain('const totalExp=totMat+totCnt+totOps;');
        expect(LEGACY).not.toMatch(/const totalRev=details\.reduce/);
        expect(LEGACY).not.toMatch(/const totalExp=details\.reduce/);
    });

    test('تصنيف القديم يطابق أنواع الحركة الستة في استعلام V2', () => {
        const legacyStock = NAV.match(/function isStockMovementExpense\(e\)\{ return \[([^\]]+)\]/);
        expect(legacyStock).not.toBeNull();
        STOCK_TYPES.forEach((type) => {
            expect(legacyStock[1]).toContain(`'${type}'`);
            expect(BACKEND).toContain(`'${type}'`);
        });
        expect(NAV).toContain("toLowerCase()==='count_correction'");
        expect(BACKEND).toContain("= 'count_correction'");
    });

    test('إجمالي V2 يقرأ كل حركات الفترة بلا فلتر أقسام حتى تشمل صفوف deptId الفارغ', () => {
        const overall = BACKEND.slice(BACKEND.indexOf('overall_totals AS'), BACKEND.indexOf('category_totals AS'));
        expect(overall).toContain('FROM revenues r');
        expect(overall).toContain('FROM expenses e');
        expect(overall).not.toContain('dept_tree');
        expect(overall).not.toContain('"deptId"');
    });

    test('الترحيل 106 يعبّئ الفرع النشط الوحيد ويختم كل كتابة قادمة', () => {
        expect(MIGRATION).toContain('IF active_count <> 1 THEN');
        expect(MIGRATION).toContain('UPDATE revenues            SET branch_id = active_id WHERE branch_id IS NULL;');
        expect(MIGRATION).toContain('UPDATE expenses            SET branch_id = active_id WHERE branch_id IS NULL;');
        const triggers = MIGRATION.match(/CREATE TRIGGER trg_stamp_branch_/g) || [];
        expect(triggers).toHaveLength(10);
        expect(MIGRATION).toContain('BEFORE INSERT ON revenues');
        expect(MIGRATION).toContain('BEFORE INSERT ON expenses');
    });
});
