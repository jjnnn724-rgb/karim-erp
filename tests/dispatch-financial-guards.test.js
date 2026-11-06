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
    SERVER.indexOf('if (entity === \'expenses\') { await voidExpenseJournal(id, req.user); }')
);
if (cascadeBlock.length < 200) {throw new Error('حدّ كتلة التتابع غير موجود — تغيّر اسم الدالة في backend/server.js، حدِّث السطر أعلاه');}

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
        const purgeIdx = cascadeBlock.indexOf('purgeDispatchRelated(id');
        expect(adminIdx).toBeGreaterThan(-1);
        expect(purgeIdx).toBeGreaterThan(adminIdx);
    });

    test('كل محو تتابعي يُسجَّل في admin_delete_audit', () => {
        expect(cascadeBlock).toContain('logAdminForceDelete(req, entity, id');
    });

    test('A1/A2 (2026-11-06): متعلقات الإذن تُبطل القيود ولا تمحوها صلبًا', () => {
        // بوابة 136 ترفض DELETE على journal_* المرحّلة؛ أي مسار يجرّبها يفشل
        // في الإنتاج بصمت داخل catch — فالمطلوب هنا ألا تظهر أصلًا.
        expect(cascadeBlock).not.toMatch(/DELETE FROM journal_(lines|entries)/);
        expect(cascadeBlock).toMatch(/sourceType: 'dispatch'[\s\S]{0,200}إبطال القيد/);
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
        expect(RECONCILE).toMatch(/report\.dispatch = \{ missing: missingDispatch\.length, repaired: dispFixed, voided: dispVoided \}/);
    });

    test('كلا المسارين لا يبثّان قيدًا لقيمة صفر', () => {
        expect(DAY_CLOSE).toContain('if (!out.skipped) { dispatchJournalsRepaired += 1; }');
        expect(RECONCILE).toContain('if (!out.skipped) {dispFixed++;}');
    });
});

describe('وعي الإبطال (2026-11-06): الإصلاح الآلي لا يقضي على قرار بشري', () => {
    // الإبطال يعني «هذا القيد خارج الأستاذ بقرار». إعادة الترحيل التلقائية كانت
    // ستمحو أثره صامتةً: postJournal صار يعتبر المُبطل موجودًا إلا إذا مرّر
    // المُستدعي repostVoided صراحةً، والكاشفات تُصنّف المُبطَل وتتركه للمراجعة.
    const ACCT = read('backend', 'accounting-routes.js');
    const GLB = read('backend', 'yarasoft', 'gl-bridge.js');
    const DISPATCH_LEDGER = read('scripts', 'reconcile-dispatch-ledger.js');

    test('postJournal افتراضيًا لا يعيد ترحيل المُبطَل، ومُستدعٍ بشري واحد فقط يمرّره', () => {
        expect(ACCT).toMatch(/repostVoided = false\s*\}/);
        expect(ACCT.match(/repostVoided:/g) || []).toHaveLength(1);
        for (const auto of [GLB, DAY_CLOSE, RECONCILE, DISPATCH_LEDGER]) {
            expect(auto).not.toMatch(/repostVoided:/);
        }
    });

    test('كاشف إقفال اليوم يفصل «مُبطَل بقرار» عن «بلا قيد» ويتخطّاه', () => {
        expect(DAY_CLOSE.match(/if \(row\.was_voided\) \{/g) || []).toHaveLength(2);
        expect(DAY_CLOSE).toContain('voidedSkipped: { sales: journalsVoided, dispatches: dispatchJournalsVoided }');
    });

    test('منسّق المالية يُصنّف المُبطَل في مصادره الخمسة ولا يلمسه', () => {
        expect(RECONCILE.match(/if \(r\.was_voided\) \{ \w+Voided\+\+; continue; \}/g) || []).toHaveLength(5);
        expect(RECONCILE.match(/AS was_voided/g) || []).toHaveLength(5);
        // لا يُعدّ المُبطَل «مُصلَحًا»: الخانة مستقلة في كل تقرير وفي الإجمالي
        expect(RECONCILE).toMatch(/const totalVoided = Object\.values\(report\)\.reduce\(\(s, r\) => s \+ r\.voided, 0\)/);
    });

    test('تقرير أذون الصرف يعرض المُبطَل ولا يُرحّله في --apply', () => {
        expect(DISPATCH_LEDGER).toMatch(/const voided = rows\.filter\(\(r\) => r\.was_voided\)/);
        expect(DISPATCH_LEDGER).toMatch(/const todo = rows\.filter\(\(r\) => !r\.was_voided/);
        expect(DISPATCH_LEDGER).toMatch(/e\.status <> 'void'/);
    });

    // العقود النصية أعلاه لا قيمة لها إن كانت تُطبَّق على نصٍّ لا يتغيّر: هذه
    // الطلقات تُزيل الحماية في نسخة محلية من النص وتُثبت أن العدّادات تسقط.
    test('الطعن: إزالة كل حماية مُبطَل تُسقط العقود واحدًا واحدًا', () => {
        const drop = (s, re) => s.replace(re, '');
        expect(drop(RECONCILE, /if \(r\.was_voided\) \{ salesVoided\+\+; continue; \}/)
            .match(/if \(r\.was_voided\) \{ \w+Voided\+\+; continue; \}/g) || []).toHaveLength(4);
        expect(drop(RECONCILE, /AS was_voided/)
            .match(/AS was_voided/g) || []).toHaveLength(4);
        expect(drop(DAY_CLOSE, /if \(row\.was_voided\) \{/)
            .match(/if \(row\.was_voided\) \{/g) || []).toHaveLength(1);
        const todoUnguarded = DISPATCH_LEDGER.replace(
            /const todo = rows\.filter\(\(r\) => !r\.was_voided && /, 'const todo = rows.filter((r) => ');
        expect(todoUnguarded).not.toMatch(/const todo = rows\.filter\(\(r\) => !r\.was_voided/);
        expect(drop(ACCT, /repostVoided = false/)).not.toMatch(/repostVoided = false\s*\}/);
        // والعكس: لو مرّر مسار آلي العلم التقطته الحلقة فورًا (نفس الوسيط المُستعمل أعلاه)
        const poison = GLB.replace("const out = await postJournal(pool, {",
            "const out = await postJournal(pool, { repostVoided: true,");
        expect(poison).toMatch(/repostVoided:/);
    });
});
