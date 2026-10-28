'use strict';

/**
 * dispatch-financial-guards.test.js — حرس المستند المالي لأذون الصرف.
 * ────────────────────────────────────────────────────────────────────────────
 * 1) حذف إذن معتمد/مستلم يمحو مصاريفه وحركات دفتره وقيوده. كان
 *    manager/warehouse يتجاوزان canDeleteDispatch ويمحوان ذلك تتابعيًا؛
 *    الآن التتابع للأدمن وحده، وغير الأدمن يُحكمه الحرس (المعلّق فقط).
 * 2) ترحيل قيد الإذن best-effort بعد AP COMMIT — إذن بلا قيد = مخزون خرج
 *    بلا تكلفة في الأستاذ (حادثة 2026-10-26). تُضاف حلقة إصلاح في إقفال
 *    اليوم ومنسّق المالية، وكلتاهما idempotent.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const SERVER = read('backend', 'server.js');
const DAY_CLOSE = read('backend', 'cashier-module', 'day-close-routes.js');
const RECONCILE = read('scripts', 'finance-reconcile.js');

const cascadeBlock = SERVER.slice(
    SERVER.indexOf("if (entity === 'dispatches') {"),
    SERVER.indexOf('if (entity === \'expenses\') { await purgeExpenseJournal(id); }')
);

describe('حذف إذن صرف: التتابع المالي للأدمن وحده', () => {
    test('الحرس canDeleteDispatch يُطبَّق على كل دور غير الأدمن', () => {
        expect(cascadeBlock).toContain('canDeleteDispatch(dispatchRow)');
        expect(cascadeBlock).toMatch(/if \(!isAdmin\) \{/);
    });

    test('لا يوجد تجاوز لمدير/أمين المخزن يمحو المستند المعتمد', () => {
        expect(cascadeBlock).not.toMatch(/if \(!isAdmin\s*&&\s*!isWarehouseSide\)/);
        expect(cascadeBlock).toMatch(/deleteGuard\.ok && \(isCreator \|\| isWarehouseSide\)/);
    });

    test('المحو التتابعي (دفتر/مصاريف/قيود/أحداث) داخل فرع الأدمن فقط', () => {
        const adminIdx = cascadeBlock.indexOf('} else {');
        const purgeIdx = cascadeBlock.indexOf('purgeDispatchRelated(id)');
        expect(adminIdx).toBeGreaterThan(-1);
        expect(purgeIdx).toBeGreaterThan(adminIdx);
    });

    test('كل محو تتابعي يُسجَّل في admin_delete_audit', () => {
        expect(cascadeBlock).toContain('logAdminForceDelete(req, entity, id');
    });
});

describe('إصلاح قيود أذون الصرف المفقودة', () => {
    test('إقفال اليوم يعيد ترحيل الأذون المعتمدة/المستلمة بلا قيد', () => {
        expect(DAY_CLOSE).toContain('postDispatchToLedger');
        expect(DAY_CLOSE).toMatch(/je\.source_type = 'dispatch' AND je\.source_id = d\.id::text/);
        expect(DAY_CLOSE).toContain("['approved', 'received', 'partially_received', 'closed']");
        expect(DAY_CLOSE).toContain('dispatchJournalsRepaired');
    });

    test('منسّق المالية يغطي المصدر نفسه ويُبلّغ بالنتيجة', () => {
        expect(RECONCILE).toContain('acct.postDispatchToLedger');
        expect(RECONCILE).toMatch(/report\.dispatch = \{ missing: missingDispatch\.length, repaired: dispFixed \}/);
    });

    test('كلا المسارين لا يبثّان قيدًا لقيمة صفر', () => {
        expect(DAY_CLOSE).toContain('if (!out.skipped) { dispatchJournalsRepaired += 1; }');
        expect(RECONCILE).toContain('if (!out.skipped) {dispFixed++;}');
    });
});
