'use strict';

/**
 * dispatch-financial-guards.test.js — حرس المستند المالي لأذون الصرف.
 * ────────────────────────────────────────────────────────────────────────────
 * 1) لا حذف صلب من CRUD العام: الإلغاء قبل الصرف، والإبطال بعده يعكس
 *    المخزون والقيود ويصفر المصروف داخل المعاملة نفسها مع حفظ السجل.
 * 2) مرتجعات المطبخ والكتابة في دورة الأذن تمر بمسارات مخصصة ذات مفاتيح idempotency.
 * 3) ترحيل قيد الإذن best-effort بعد AP COMMIT — إذن بلا قيد = مخزون خرج
 *    بلا تكلفة في الأستاذ (حادثة 2026-10-26). تُضاف حلقة إصلاح في إقفال
 *    اليوم ومنسّق المالية، وكلتاهما idempotent، وتلتزمان مراجعة reopened.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const between = (src, startMark, endMark) => {
    const start = src.indexOf(startMark);
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf(endMark, start + 1);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
};

const SERVER = read('backend', 'server.js');
const DISPATCH = read('backend', 'warehouse', 'dispatch-routes.js');
const RETURNS = read('backend', 'warehouse', 'returns-routes.js');
const JOURNAL_VOID = read('backend', 'journal-void.js');
const ACCT = read('backend', 'accounting-routes.js');
const DAY_CLOSE = read('backend', 'cashier-module', 'day-close-routes.js');
const RECONCILE = read('scripts', 'finance-reconcile.js');

describe('لا حذف صلب: CRUD العام يرفض، ودورة الحياة المخصصة تحفظ الأثر', () => {
    test('DELETE العام للأذون 405 غير مشروط، قبل أي purge أو تجاوز force', () => {
        const block = between(SERVER,
            "if (entity === 'dispatches') {\n                return res.status(405).json({",
            "if (entity === 'expenses') { await voidExpenseJournal(id, req.user); }");
        expect(block).toContain("error: 'DISPATCH_DELETE_DISABLED'");
        expect(block).toContain('return res.status(405)');
        expect(block).not.toContain('canDeleteDispatch');
        expect(block).not.toContain('purgeDispatchRelated');
        expect(block).not.toContain('logAdminForceDelete');
        expect(block).not.toMatch(/DELETE FROM/i);
        expect(block).not.toMatch(/isAdmin|force/);
    });

    test('POST/PUT/DELETE العام لمرتجعات المطبخ 405 حتى مع force=1 وقبل القراءة أو الكتابة', () => {
        const workflowGuards = SERVER.match(/if \(entity === 'kitchenReturns'\) \{return res\.status\(405\)\.json\(\{ error: 'RETURN_WORKFLOW_REQUIRED'/g) || [];
        expect(workflowGuards).toHaveLength(4); // POST مرتان + PUT مرتان
        const deleteGuardAt = SERVER.indexOf("if (entity === 'kitchenReturns') {\n            return res.status(405).json({ error: 'RETURN_DELETE_DISABLED'");
        expect(deleteGuardAt).toBeGreaterThan(-1);
        const deleteRouteAt = SERVER.indexOf('app.delete(`/api/${entity}/:id`');
        const protectedDeleteAt = SERVER.indexOf('if (isProtectedDeleteEntity(entity))', deleteGuardAt);
        expect(deleteGuardAt).toBeGreaterThan(deleteRouteAt);
        expect(protectedDeleteAt).toBeGreaterThan(deleteGuardAt);
        const guard = between(SERVER,
            "if (entity === 'kitchenReturns') {\n            return res.status(405).json({ error: 'RETURN_DELETE_DISABLED'",
            '// بقية الكيانات المالية/الدفترية محمية');
        expect(guard).not.toMatch(/force|await pool\.query|DELETE FROM/i);
    });

    test('حذف المرتجع المخصص معطّل أيضًا — الإبطال وحده يعكس الأثر', () => {
        const block = between(RETURNS, "router.delete('/returns/:id'", "router.post('/inventory");
        expect(block).toContain('RETURN_DELETE_DISABLED');
        expect(block).toContain('res.status(405)');
        expect(block).not.toMatch(/DELETE FROM/i);
    });

    test('كتابة الأذان تمر بمسارات idempotent مستقلة، وليست PUT/CRUD العام', () => {
        for (const action of ['cancel', 'reopen', 'void', 'approve', 'receive', 'reject', 'chef-approve', 'chef-reject']) {
            expect(DISPATCH).toContain(`router.post('/dispatches/:id/${action}'`);
        }
        expect(DISPATCH).toContain("router.put('/dispatches/:id/edit'");
        expect((DISPATCH.match(/idempotency\(\{ requireKey: true \}\)/g) || []).length).toBeGreaterThanOrEqual(9);
        expect(RETURNS).toContain("router.post('/returns',");
        expect(RETURNS).toContain("router.post('/returns/:id/void'");
        expect((RETURNS.match(/idempotency\(\{ requireKey: true \}\)/g) || []).length).toBeGreaterThanOrEqual(2);
    });

    test('الإبطال يبطل القيود ويصفر المصروفات ولا يحذف الدفتر أو المستند', () => {
        const block = between(DISPATCH, 'async function voidDispatchExpenses', "router.post('/dispatches/:id/cancel'");
        expect(block).toContain("sourceType: 'dispatch', sourceIds: String(dispatch.id), matchPrefix: true");
        expect(block).toContain("sourceType: 'expense'");
        expect(block).toContain('UPDATE expenses SET amount=0');
        expect(block).toContain('FOR UPDATE');
        expect(block).not.toMatch(/DELETE FROM/i);
        expect(JOURNAL_VOID).toContain("status='void'");
        expect(JOURNAL_VOID).not.toMatch(/DELETE FROM journal_/i);
    });
});

describe('إصلاح قيود أذون الصرف المفقودة', () => {
    test('إقفال اليوم يعيد ترحيل الأذون المعتمدة/المستلمة بلا قيد للمراجعة الصحيحة', () => {
        expect(DAY_CLOSE).toContain('postDispatchToLedger');
        expect(DAY_CLOSE).toContain("SELECT COUNT(*)::int AS revision");
        expect(DAY_CLOSE).toContain("d.id::text || '#r' || COUNT(*)::text");
        expect(DAY_CLOSE).toContain("we.event_type = 'reopened'");
        expect(DAY_CLOSE).toMatch(/je\.source_type = 'dispatch' AND je\.source_id = rev\.source_id/);
        expect(DAY_CLOSE).toContain('revision: Number(row.revision)');
        expect(DAY_CLOSE).toContain("['approved', 'received', 'partially_received', 'closed']");
        expect(DAY_CLOSE).toContain('dispatchJournalsRepaired');
    });

    test('منسّق المالية يغطي المصدر نفسه ويُبلّغ بالنتيجة', () => {
        expect(RECONCILE).toContain('acct.postDispatchToLedger');
        expect(RECONCILE).toContain("d.id::text || '#r' || COUNT(*)::text");
        expect(RECONCILE).toContain('revision: Number(r.revision)');
        expect(RECONCILE).toMatch(/report\.dispatch = \{ missing: missingDispatch\.length, repaired: dispFixed, voided: dispVoided \}/);
    });

    test('كلا المسارين لا يبثّان قيدًا لقيمة صفر', () => {
        expect(DAY_CLOSE).toContain('if (!out.skipped) { dispatchJournalsRepaired += 1; }');
        expect(RECONCILE).toContain('if (!out.skipped) {dispFixed++;}');
    });
});

describe('مراجعات قيد الأذن: المرجع يتبع reopened، والإبطال يشمل كل المراجعات', () => {
    test('revision 0 يستعمل معرف الأذن، وكل reopen يضيف #rN', () => {
        expect(DISPATCH).toContain('SELECT COUNT(*)::int AS revision FROM dispatch_workflow_events');
        expect(DISPATCH).toContain("event_type='reopened'");
        expect(ACCT).toContain('const sourceId = revision > 0 ? `${dispatchId}#r${revision}` : String(dispatchId);');
        expect(ACCT).toContain("source_type: 'dispatch'");
        expect(ACCT).toContain('source_id: sourceId');
        expect(DISPATCH).toContain('totalValue, date: dateOnly(dispatch.date), deptCode: dispatch.deptCode, db: client, revision,');
    });

    test('voidSourceJournals(matchPrefix=true) يبطل الأساس و:revision و#rN ولا يلمس المسودات أو المصادر الأخرى', async () => {
        const { voidSourceJournals } = require('../backend/journal-void');
        const entries = [
            { id: 1, entry_no: 'JE-1', source_type: 'dispatch', source_id: '77', status: 'posted' },
            { id: 2, entry_no: 'JE-2', source_type: 'dispatch', source_id: '77:revision:1', status: 'posted' },
            { id: 3, entry_no: 'JE-3', source_type: 'dispatch', source_id: '77#r1', status: 'posted' },
            { id: 4, entry_no: 'JE-4', source_type: 'dispatch', source_id: '77#r2', status: 'posted' },
            { id: 5, entry_no: 'JE-5', source_type: 'dispatch', source_id: '77#r3', status: 'draft' },
            { id: 6, entry_no: 'JE-6', source_type: 'dispatch', source_id: '77#r4', status: 'void' },
            { id: 7, entry_no: 'JE-7', source_type: 'dispatch', source_id: '770', status: 'posted' },
            { id: 8, entry_no: 'JE-8', source_type: 'expense', source_id: '77#r2', status: 'posted' },
        ];
        const likeMatches = (value, pattern) => {
            let regex = '^';
            for (let i = 0; i < pattern.length; i += 1) {
                const ch = pattern[i];
                if (ch === '\\' && i + 1 < pattern.length) {
                    regex += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                } else if (ch === '%') { regex += '.*'; }
                else if (ch === '_') { regex += '.'; }
                else { regex += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
            }
            return new RegExp(`${regex}$`).test(value);
        };
        const db = {
            async query(sql, params = []) {
                if (sql.includes('information_schema.columns')) { return { rows: [{ ready: true }] }; }
                if (!sql.includes('UPDATE journal_entries')) { throw new Error('Unexpected journal SQL'); }
                const [sourceType, sourceIds, , , , patterns = []] = params;
                const matched = entries.filter(entry => entry.source_type === sourceType && entry.status === 'posted'
                    && (sourceIds.includes(entry.source_id) || patterns.some(pattern => likeMatches(entry.source_id, pattern))));
                for (const entry of matched) { entry.status = 'void'; }
                return { rows: matched };
            },
        };
        const result = await voidSourceJournals(db, {
            sourceType: 'dispatch', sourceIds: ['77'], matchPrefix: true, reason: 'إبطال الأذن', actorUserId: 2, actor: 'المدير',
        });
        expect(result.voided).toBe(4);
        expect(result.entries.map(entry => entry.source_id)).toEqual(['77', '77:revision:1', '77#r1', '77#r2']);
        expect(entries.filter(entry => entry.status === 'void').map(entry => entry.id)).toEqual([1, 2, 3, 4, 6]);
        expect(entries.find(entry => entry.id === 7).status).toBe('posted');
        expect(entries.find(entry => entry.id === 8).status).toBe('posted');
    });
});

describe('وعي الإبطال (2026-11-06): الإصلاح الآلي لا يقضي على قرار بشري', () => {
    // الإبطال يعني «هذا القيد خارج الأستاذ بقرار». إعادة الترحيل التلقائية كانت
    // ستمحو أثره صامتةً: postJournal صار يعتبر المُبطل موجودًا إلا إذا مرّر
    // المُستدعي repostVoided صراحةً، والكاشفات تُصنّف المُبطَل وتتركه للمراجعة.
    const GLB = read('backend', 'yarasoft', 'gl-bridge.js');
    const DISPATCH_LEDGER = read('scripts', 'reconcile-dispatch-ledger.js');

    test('postJournal افتراضيًا لا يعيد ترحيل المُبطَل، ومُستدعٍ بشري واحد فقط يمرّره', () => {
        // التوقيع متعدد الأسطر بفاصلة لاحقة — العقد يتحمّلها، والافتراضي false باقٍ
        expect(ACCT).toMatch(/repostVoided = false,?\s*\}/);
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
        expect(drop(ACCT, /repostVoided = false/)).not.toMatch(/repostVoided = false,?\s*\}/);
        // والعكس: لو مرّر مسار آلي العلم التقطته الحلقة فورًا (نفس الوسيط المُستعمل أعلاه)
        const poison = GLB.replace("const out = await postJournal(pool, {",
            "const out = await postJournal(pool, { repostVoided: true,");
        expect(poison).toMatch(/repostVoided:/);
    });
});
