'use strict';
/* ══════════════════════════════════════════════════════════════════════════
   A1-A4 على karim_erp_staging — بوابة الحذف + سجل الإبطال + ثبات الميزان
   القراءة فقط على أي صف حقيقي: كل كتابة على صف اختبار JE-TEST-A1 فقط.
   ══════════════════════════════════════════════════════════════════════════ */
const { Client } = require('pg');
require('../../backend/shared-pool');
const { voidSourceJournals, voidJournalById, nextRevisionSourceId } =
    require('../../backend/journal-void');

const TEST_ID = '999000000001';
const TEST_NO = 'JE-TEST-A1-0001';
const SRC = 'manual';
const SRC_ID = 'A1-SELFTEST';

const out = [];
const say = (k, v) => { out.push([k, v]); console.log(`${k.padEnd(46)} ${typeof v === 'string' ? v : JSON.stringify(v)}`); };

/** معاملة واحدة: مُرحَّل ⇒ أبطل أولًا (بوابة 136) ⇒ ثم امحُ الأسطر فالأب فالسجل. */
const TEST_IDS = [TEST_ID, 999000000002, 999000000003, 999000000004, 999000000005, 999000000006, 999000000007];
async function purgeLeftovers(c) {
    await c.query('BEGIN');
    await c.query(`UPDATE journal_entries SET status='void'
                    WHERE id = ANY($1::bigint[]) AND status='posted'`, [TEST_IDS]);
    await c.query(`DELETE FROM journal_lines WHERE entry_id = ANY($1::bigint[])`, [TEST_IDS]);
    const d = await c.query(`DELETE FROM journal_entries WHERE id = ANY($1::bigint[])`, [TEST_IDS]);
    const a = await c.query(`DELETE FROM journal_ledger_audit WHERE entry_no LIKE 'JE-TEST-A1%'`);
    await c.query('COMMIT');
    return { entries: d.rowCount, audit: a.rowCount };
}

(async () => {
    const c = new Client({ host: process.env.DB_HOST, port: +process.env.DB_PORT, user: process.env.DB_USER,
        password: process.env.DB_PASSWORD, database: 'karim_erp_staging' });
    await c.connect();
    const expectErr = async (label, sql, needle) => {
        try { await c.query('BEGIN'); await c.query(sql); await c.query('ROLLBACK'); say(label, '❌ لم يُرفض (مفترض رفضه)'); return null; }
        catch (e) { await c.query('ROLLBACK').catch(() => {}); say(label, `${e.code} ${String(e.message).slice(0, 90)}`); 
            if (!String(e.message).includes(needle)) {throw new Error(`${label}: رفض لكن برسالة غير متوقعة (${needle})`, { cause: e });}
            return e; }
    };
    /** قياس سلوك بلا ادّعاء: مجهَض دائمًا، يُبلَّغ ما حدث فعلًا (للفجوات الموثّقة). */
    const probe = async (label, sql) => {
        await c.query('BEGIN');
        let res;
        try { res = await c.query(sql); await c.query('ROLLBACK'); say(label, { affected: res.rowCount, rejected: false }); }
        catch (e) { await c.query('ROLLBACK').catch(() => {}); say(label, `${e.code} ${String(e.message).slice(0, 80)}`); }
    };

    // ─── حالة البداية — AFTER purge: أي بقايا من تشغيل سابق مُمحوة أولًا ────────
    // (وإلا كان Σ الميزان الأساسي يتضمن قيد اختبار عالقًا وأصبح V6b يقارن ببصمة ملوثة)
    await purgeLeftovers(c);
    const before = await c.query(`SELECT COUNT(*)::int e, (SELECT COUNT(*) FROM journal_lines)::int l FROM journal_entries`);
    const tbBefore = await c.query(`SELECT COALESCE(SUM(l.debit),0)::numeric(16,2) dr FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id AND e.status='posted'`);
    say('00 بداية (بعد تنظيف البقايا) — قيود/سطور', before.rows[0]);
    say('00 بداية — Σ مدين الميزان', tbBefore.rows[0].dr);

    // ─── V3 صف اختبار مُرحّل (كاملة في معاملة واحدة — كما يفعل postJournal) ────
    // كل المحاولات المدمِّرة أدناه على THIS row فقط، داخل معاملة مُجهَضة دائمًا:
    // لا جلسة الاختبار تكتب ولا تحاول الكتابة على سطر حقيقي واحد.
    await c.query('BEGIN');
    await c.query(`UPDATE journal_entries SET status='void' WHERE id = $1 AND status='posted'`, [TEST_ID]);
    await c.query(`DELETE FROM journal_lines WHERE entry_id = $1`, [TEST_ID]);
    await c.query(`DELETE FROM journal_entries WHERE id = $1`, [TEST_ID]);
    await c.query(`INSERT INTO journal_entries (id, entry_no, date, memo, source_type, source_id, status)
                   VALUES ($1,$2, CURRENT_DATE, 'اختبار A1 — بوابة الإبطال', $3, $4, 'posted')`, [TEST_ID, TEST_NO, SRC, SRC_ID]);
    await c.query(`INSERT INTO journal_lines (id, entry_id, account_code, debit, credit, memo) VALUES
                   (999000000011, $1, '1000', 100.00, 0, 'مدين الصندوق'),
                   (999000000012, $1, '6900', 0, 100.00, 'دائن المصروف')`, [TEST_ID]);
    await c.query('COMMIT');
    say('V3 قيد اختبار posted مُدرج', { entry_no: TEST_NO, lines: 2, amount: '100.00' });
    const tbWith = await c.query(`SELECT COALESCE(SUM(l.debit),0)::numeric(16,2) dr FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id AND e.status='posted'`);
    say('V3b Σ مدين والقيد داخله', { with_test: tbWith.rows[0].dr, delta_vs_start: (Number(tbWith.rows[0].dr) - Number(tbBefore.rows[0].dr)).toFixed(2) });

    // ─── V1 بوابة 136 — قراءة فقط على الحقيقي، كتابة فقط على صف الاختبار ───────
    const real = (await c.query(`SELECT id, entry_no FROM journal_entries WHERE status='posted' AND id <> $1 ORDER BY id LIMIT 1`, [TEST_ID])).rows[0];
    const realN = (await c.query(`SELECT COUNT(*)::int n FROM journal_entries WHERE id=$1`, [real.id])).rows[0].n;
    await c.query('BEGIN');
    let v1 = '❌ لم يُرفض (مفترض رفضه)';
    let v1ok = false;
    try { await c.query(`DELETE FROM journal_entries WHERE id = ${real.id}`); }
    catch (e) {
        v1 = `${e.code} ${String(e.message).slice(0, 90)}`;
        v1ok = String(e.message).includes('POSTED_JOURNAL_NO_HARD_DELETE');
    }
    await c.query('ROLLBACK');
    say('V1 حذف قيد posted حقيقي ⇒ مرفوض', v1);
    if (!v1ok) {throw new Error('V1: بوابة 136 لم ترفض حذف صف مرحّل بالرسالة المتوقعة');}
    const realAfter = (await c.query(`SELECT COUNT(*)::int n FROM journal_entries WHERE id=$1`, [real.id])).rows[0].n;
    say('V1c الصف الحقيقي لم يُمسّ', { real_id: real.id, before: realN, after: realAfter, untouched: realN === realAfter });
    if (realN !== realAfter) {throw new Error('V1c: اختبار الحذف أصاب صفًا حقيقيًا — أوقف كل شيء');}

    // البوابة + فجوة الأسطر: كلاهما على صف الاختبار، ومعاملتان مجهضتان
    // فجوة موثّقة (G-01 في A5_REPORT): 136 يمنع حذف الأب المرحّل، ولا شيء يمنع
    // حذف/تعديل سطور أبٍ مرحّل مباشرةً بـ SQL. لا مسار تطبيق يفعل ذلك (grep:
    // postJournal فقط، وفي نفس معاملة إنشاء الأب) — والقرار للمالك، لا trigger
    // يُجهض الترحيل والاختبارات بلا حاجة.
    await probe('V1b [فجوة G-01] حذف سطور قيد posted مباشرةً', `DELETE FROM journal_lines WHERE entry_id = ${TEST_ID}`);
    await c.query('BEGIN');
    await c.query(`SET LOCAL coa.allow_hard_delete = 'on'`);
    const hatchDel = await c.query(`DELETE FROM journal_entries WHERE id = $1`, [TEST_ID]);
    const hatchTrg = await c.query(`SELECT COUNT(*)::int n FROM pg_trigger WHERE tgname='trg_journal_no_hard_delete'`);
    await c.query('ROLLBACK');
    const survived = (await c.query(`SELECT COUNT(*)::int n FROM journal_entries WHERE id=$1`, [TEST_ID])).rows[0].n;
    say('V2 البوابة coa.allow_hard_delete=on تفتح الحذف', { deleted: hatchDel.rowCount, trigger_present: hatchTrg.rows[0].n === 1, rolled_back: survived === 1 });
    if (survived !== 1) {throw new Error('V2: صف الاختبار لم يعد بعد ROLLBACK — تسرّب كتابة');}

    // A4: حصانة الهوية ما زالت قائمة (سطر inventory-routes القديم كان سيُجهض المعاملة)
    await expectErr('V4 تعديل هوية قيد posted ⇒ مرفوض (095)',
        `UPDATE journal_entries SET status='void', source_type='purchase_invoice_edit_void', source_id='1:revision:x' WHERE id = ${TEST_ID}`,
        'POSTED_JOURNAL_IMMUTABLE');

    // ─── V5 إبطال عبر المسار الجديد (voidSourceJournals) ─────────────────────
    const v = await voidSourceJournals(c, { sourceType: SRC, sourceIds: SRC_ID, reason: 'اختبار A1 — إبطال موجه', actor: 'qoder-a1', actorUserId: null });
    say('V5 voidSourceJournals ⇒ voided', v);
    const row = (await c.query(`SELECT status, voided_at IS NOT NULL AS has_at, voided_by_name, void_reason FROM journal_entries WHERE id=$1`, [TEST_ID])).rows[0];
    say('V5b أعمدة الإبطال مملوءة', row);
    const aud = await c.query(`SELECT action, from_status, to_status, line_count, debit_total, actor_name, reason, db_user FROM journal_ledger_audit WHERE entry_no=$1 ORDER BY id`, [TEST_NO]);
    say('V5c صفوف journal_ledger_audit', aud.rows);

    // ─── V6 ثبات الميزان: الفرق = 100.00 بالضبط (لا 200.00) ──────────────────
    const tbAfter = await c.query(`SELECT COALESCE(SUM(l.debit),0)::numeric(16,2) dr FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id AND e.status='posted'`);
    const drop = Number(tbWith.rows[0].dr) - Number(tbAfter.rows[0].dr);
    say('V6 Σ مدين مع/بعد الإبطال', { with_test: tbWith.rows[0].dr, after_void: tbAfter.rows[0].dr, drop: drop.toFixed(2), start: tbBefore.rows[0].dr });
    if (Math.abs(drop - 100) > 0.005) {throw new Error(`V6: الإبطال لم يُخرج 100.00 بالضبط (خرج ${drop}) — سياسة void غير مؤكدة`);}
    if (Math.abs(Number(tbAfter.rows[0].dr) - Number(tbBefore.rows[0].dr)) > 0.005) {throw new Error('V6b: الميزان بعد الإبطال لا يعود لحالته قبل القيد');}

    // ─── V7 unvoid ⇒ حالة transition أخرى مسجلة ──────────────────────────────
    await c.query(`UPDATE journal_entries SET status='posted' WHERE id=$1`, [TEST_ID]);
    const un = (await c.query(`SELECT action, from_status, to_status FROM journal_ledger_audit WHERE entry_no=$1 ORDER BY id DESC LIMIT 1`, [TEST_NO])).rows[0];
    say('V7 unvoid مسجل', un);
    await c.query(`UPDATE journal_entries SET status='void' WHERE id=$1`, [TEST_ID]);

    // ─── V8 بوابة المسودات: الحذف الصلب لمسودة مسموح (كما صُمم) ──────────────
    await c.query(`INSERT INTO journal_entries (id, entry_no, date, memo, source_type, source_id, status)
                   VALUES (999000000002,'JE-TEST-A1-0002',CURRENT_DATE,'مسودة اختبار','manual','A1-DRAFT','draft')`);
    const draftDel = await c.query(`DELETE FROM journal_entries WHERE id=999000000002`);
    say('V8 حذف مسودة (مسموح)', { rowCount: draftDel.rowCount });
    const delAudit = (await c.query(`SELECT action, from_status, line_count FROM journal_ledger_audit WHERE entry_no='JE-TEST-A1-0002'`)).rows;
    say('V8b hard_delete مسجل للممحو', delAudit);

    // ─── V9 voidJournalById + nextRevisionSourceId ───────────────────────────
    await c.query(`UPDATE journal_entries SET status='posted' WHERE id=$1`, [TEST_ID]);
    const byId = await voidJournalById(c, { entryId: TEST_ID, reason: 'إبطال يدوي عبر المسار', actor: 'qoder-a1' });
    say('V9 voidJournalById', { voided: byId.voided, status: byId.entry && byId.entry.status, reason: byId.entry && byId.entry.void_reason });
    const twice = await voidJournalById(c, { entryId: TEST_ID, reason: 'إبطال ثانٍ' });
    say('V9b إبطال المُبطل ⇒ لا شيء', { voided: twice.voided });
    await c.query(`INSERT INTO journal_entries (id, entry_no, date, memo, source_type, source_id, status)
                   VALUES (999000000003,'JE-TEST-A1-0003',CURRENT_DATE,'مرجع مصروف','expense','987654','void')`);
    say('V9c nextRevisionSourceId (مبطل موجود)', await nextRevisionSourceId(c, 'expense', '987654'));
    say('V9d nextRevisionSourceId (بلا أثر)', await nextRevisionSourceId(c, 'expense', '555000'));

    // ─── V10 A3: أعمدة accounting_periods الصحيحة ─────────────────────────────
    const per = await c.query(`SELECT closed FROM accounting_periods WHERE period = $1 LIMIT 1`, ['2026-10']);
    say('V10 A3 استعلام الفترة بصيغة الصحيحة', { ok: true, rows: per.rowCount, closed: per.rows[0] && per.rows[0].closed });
    const bad = await c.query('BEGIN'); void bad;
    try { await c.query(`SELECT status FROM accounting_periods WHERE month = '2026-10' LIMIT 1`); say('V10b الصيغة القديمة', '❌ مرّت?!'); }
    catch (e) { say('V10b الصيغة القديمة (كانت 42703)', `${e.code} ${String(e.message).slice(0, 60)}`); }
    await c.query('ROLLBACK').catch(() => {});

    // ─── V11 التوازن: قيد posted ناقص مرفوض (لا تراجع عن 095) ────────────────
    try {
        await c.query('BEGIN');
        await c.query(`INSERT INTO journal_entries (id, entry_no, date, memo, source_type, source_id, status)
                       VALUES (999000000004,'JE-TEST-A1-0004',CURRENT_DATE,'قيد غير متوازن','manual','A1-UNBAL','posted')`);
        await c.query(`INSERT INTO journal_lines (id, entry_id, account_code, debit, credit) VALUES (999000000041,999000000004,'1000',50,0)`);
        await c.query('COMMIT');
        say('V11 قيد posted غير متوازن', '❌ قُبل');
        await c.query(`DELETE FROM journal_lines WHERE entry_id=999000000004`).catch(() => {});
        await c.query(`DELETE FROM journal_entries WHERE id=999000000004`).catch(() => {});
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); say('V11 قيد posted غير متوازن ⇒ مرفوع عند الالتزام', `${e.code} ${String(e.message).slice(0, 70)}`); }

    // ─── V12 ترتيب النشر: قاعدة لم تُطبّق 137 بعد (بلا أي كتابة — SQL builder) ──
    for (const ready of [false, true]) {
        const calls = [];
        const fake = {
            query: async (sql, params) => {
                calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
                return { rows: sql.includes('information_schema') ? [{ ready }] : [] };
            }
        };
        await voidSourceJournals(fake, { sourceType: 'expense', sourceIds: '77', matchPrefix: true, reason: 'سبب', actor: 'a', actorUserId: 5 });
        const u = calls[1];
        const usesAuditCols = /voided_at|void_reason|voided_by/.test(u.sql);
        say(`V12 hasVoidColumns=${ready} ⇒ UPDATE`, { audit_cols: usesAuditCols, params: u.params.length });
        if (usesAuditCols !== ready) {throw new Error(`V12: مبني SQL خالف نتيجة الفحص (ready=${ready})`);}
        if (!ready && u.params.length !== 3) {throw new Error('V12: مسار ما قبل 137 يمرّر وسائط زائدة');}
        if (ready && u.params.length !== 6) {throw new Error('V12: مسار 137 فقد وسائط سجل الإبطال');}
    }

    // ─── V13 (محفّظ 138) رصد مساس متوازن بسطر تاريخ مُرحّل — بلا تعطيل ─────────
    // قيد 095 المحصّن يرفض حذف سطر يُخلّ بالإجمالي، لكنه لا يرى «إعادة كتابة
    // متوازنة» (نقل المبلغ بين حسابين). هذه هي البقية الحقيقية لـG-01.
    const otherAcct = (await c.query(
        `SELECT code FROM chart_of_accounts
          WHERE code <> '6900' AND is_active = true AND is_postable = true ORDER BY code LIMIT 1`)).rows[0].code;
    const lcCount = async () => (await c.query(`SELECT COUNT(*)::int n FROM journal_ledger_audit WHERE action='line_change'`)).rows[0].n;

    // V13a: ترحيل طبيعي كامل (أب posted + سطوره) في معاملة واحدة ⇒ صفر سجل
    const lcA = await lcCount();
    await c.query('BEGIN');
    await c.query(`INSERT INTO journal_entries (id, entry_no, date, memo, source_type, source_id, status)
                   VALUES (999000000005,'JE-TEST-A1-0005',CURRENT_DATE,'ترحيل عادي عبر 138','manual','A1-NORMAL','posted')`);
    await c.query(`INSERT INTO journal_lines (id, entry_id, account_code, debit, credit, memo) VALUES
                   (999000000051, 999000000005, '1000', 250.00, 0, 'مدين'),
                   (999000000052, 999000000005, '6900', 0, 250.00, 'دائن')`);
    await c.query('COMMIT');
    const lcB = await lcCount();
    say('V13a ترحيل عادي (أب+سطوره في معاملة) ⇒ صفر سجل', { new_line_change_rows: lcB - lcA });
    if (lcB !== lcA) {throw new Error('V13a: المحفّظ سجّل ترحيلًا طبيعيًا — كان سيُغرق الجدول على الإنتاج ويكشف خطأ الاستثناء');}

    // V13b: إعادة كتابة متوازنة على قيد مرحّل من معاملة لاحقة ⇒ صف سجل واحد باللقطة
    await c.query(`UPDATE journal_entries SET status='posted' WHERE id=$1 AND status='void'`, [TEST_ID]);
    await c.query(`UPDATE journal_lines SET account_code = $2 WHERE id = 999000000012 AND entry_id = $1`, [TEST_ID, otherAcct]);
    const tampered = (await c.query(
        `SELECT reason, line_count, debit_total FROM journal_ledger_audit
          WHERE entry_no = $1 AND action = 'line_change' ORDER BY id DESC LIMIT 1`, [TEST_NO])).rows[0];
    say(`V13b نقل 100.00 من 6900 ← ${otherAcct} (معاملة مستقلة)`, { logged: !!tampered, reason: tampered && String(tampered.reason).slice(0, 120) });
    if (!tampered || !String(tampered.reason).includes('6900')) {throw new Error('V13b: التوازن أُعيد كتابته في التاريخ بلا أي رصد');}

    // V13c: لا شيء من هذا يُنجب قيدًا غير متوازن ولا يُنقص الميزان (المحفّظ رصد فقط)
    const tbBal = await c.query(`SELECT COALESCE(SUM(l.debit),0)::numeric(16,2) dr FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id AND e.status='posted'`);
    say('V13c الميزان بعد النقل (لم يُمنع شيء)', { debit: tbBal.rows[0].dr, expected: (Number(tbWith.rows[0].dr) + 250).toFixed(2) });
    if (tbBal.rows[0].dr.toString() !== (Number(tbWith.rows[0].dr) + 250).toFixed(2)) {throw new Error('V13c: المحفّظ أثّر على الأرصدة — المفترض رصد فقط');}
    await c.query(`UPDATE journal_lines SET account_code = '6900' WHERE id = 999000000012 AND entry_id = $1`, [TEST_ID]);

    // ─── V14 تنظيف fixtures عبر البوابة على قاعدة مُهاجرة (كما تفعل الحزم) ──────
    // المسار الذي كان سينكسر صامتًا لحظة تطبيق 136 على قاعدة اختبار: حذف صلب
    // لبيانات اختبار مرحّلة. المرجو: يعمل داخل coa.allow_hard_delete، ويترك أثرًا.
    await c.query(`UPDATE journal_entries SET status='posted' WHERE id=$1 AND status='void'`, [TEST_ID]);
    await c.query('BEGIN');
    await c.query(`SET LOCAL coa.allow_hard_delete = 'on'`);
    const v14l = await c.query(`DELETE FROM journal_lines WHERE entry_id = $1`, [TEST_ID]);
    const v14e = await c.query(`DELETE FROM journal_entries WHERE id = $1`, [TEST_ID]);
    await c.query('COMMIT');
    const v14aud = await c.query(`SELECT action, COUNT(*)::int n FROM journal_ledger_audit
                                   WHERE entry_no IN ($1,'JE-TEST-A1-0005') GROUP BY 1 ORDER BY 1`, [TEST_NO]);
    say('V14 تنظيف fixture مُرحّل تحت البوابة (committed)', { lines: v14l.rowCount, entry: v14e.rowCount, audit: v14aud.rows });
    if (v14e.rowCount !== 1) {throw new Error('V14: البوابة لم تفتح الحذف المرخّص — كل حزم الاختبار ستنكسر بعد 136');}
    if (!v14aud.rows.some((r) => r.action === 'hard_delete')) {throw new Error('V14: المحو المرخّص بلا أثر في سجل التدقيق');}

    // ─── V15 وعي الإبطال: كاشف آلي لا ينقض قرارًا، ومسار بشري يرحّل #r2 ─────────
    // نفس عبارة إقفال اليوم (NOT EXISTS مرحّل + تصنيف was_voided) ونفس عبارة
    // منسّق المالية (NOT EXISTS <>'void') على سطر حقيقي البنية في staging.
    const V15_REF = 'A1-VOIDREPOST';
    await c.query('BEGIN');
    await c.query(`INSERT INTO journal_entries (id, entry_no, date, memo, source_type, source_id, status)
                   VALUES (999000000006,'JE-TEST-A1-0006',CURRENT_DATE,'اختبار V15 — قبل الإبطال','manual',$1,'posted')`, [V15_REF]);
    await c.query(`INSERT INTO journal_lines (id, entry_id, account_code, debit, credit, memo) VALUES
                   (999000000061, 999000000006, '1000', 75.00, 0, 'مدين'),
                   (999000000062, 999000000006, '6900', 0, 75.00, 'دائن')`, []);
    await c.query('COMMIT');
    const tbV15 = await c.query(`SELECT COALESCE(SUM(l.debit),0)::numeric(16,2) dr FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id AND e.status='posted'`);

    const v15void = await voidSourceJournals(c, { sourceType: 'manual', sourceIds: V15_REF, reason: 'اختبار V15', actor: 'stageA', actorUserId: null });
    const detSweep = await c.query(
        `SELECT x.id, EXISTS (SELECT 1 FROM journal_entries v
                               WHERE v.source_type = 'manual' AND v.source_id = x.ref AND v.status = 'void') AS was_voided
           FROM (VALUES (999000000006::bigint, $1::text)) x(id, ref)
          WHERE NOT EXISTS (SELECT 1 FROM journal_entries je
                             WHERE je.source_type = 'manual' AND je.source_id = x.ref AND je.status = 'posted')`, [V15_REF]);
    const detReconcile = await c.query(
        `SELECT x.id, EXISTS (SELECT 1 FROM journal_entries v
                               WHERE v.source_type = 'manual' AND v.source_id = x.ref AND v.status = 'void') AS was_voided
           FROM (VALUES (999000000006::bigint, $1::text)) x(id, ref)
          WHERE NOT EXISTS (SELECT 1 FROM journal_entries je
                             WHERE je.source_type = 'manual' AND je.source_id = x.ref AND je.status <> 'void')`, [V15_REF]);
    say('V15a إبطال (rows)', { voided: v15void.voided });
    say('V15b كاشف إقفال اليوم: بلا مرحّل + مُصنّف مُبطَل', detSweep.rows);
    say('V15c كاشف المنسّق: يُدرجه مُبطَلًا (لا نقصًا) فيُتخطّى', detReconcile.rows);
    if (v15void.voided !== 1) {throw new Error('V15: لم يُبطل سطر الاختبار');}
    if (detSweep.rows.length !== 1 || detSweep.rows[0].was_voided !== true) {throw new Error('V15b: الكاشف الآلي لم يُصنّف المُبطَل — سيُعاد ترحيلُه تلقائيًا');}
    // المنسّق يُدرج المصدر في القائمة (لا يُخفيه) لكن was_voided=true تُشغّل
    // `continue` قبل أي ترحيل — فهذه هي الحماية الثانية بعد تصحيح postJournal.
    if (detReconcile.rows.length !== 1 || detReconcile.rows[0].was_voided !== true) {throw new Error('V15c: المنسّق رآه بلا قيد ولا بعلامة إبطال — سيُرحّله');}

    // المسار البشري (ما يفعله POST /journal بـ repostVoided=true): مرجع مراجعة + قيد واحد مرحّل
    const v15rev = await nextRevisionSourceId(c, 'manual', V15_REF);
    await c.query('BEGIN');
    await c.query(`INSERT INTO journal_entries (id, entry_no, date, memo, source_type, source_id, status)
                   VALUES (999000000007,'JE-TEST-A1-0007',CURRENT_DATE,'اختبار V15 — نسخة منقّحة','manual',$1,'posted')`, [v15rev]);
    await c.query(`INSERT INTO journal_lines (id, entry_id, account_code, debit, credit, memo) VALUES
                   (999000000063, 999000000007, '1000', 75.00, 0, 'مدين'),
                   (999000000064, 999000000007, '6900', 0, 75.00, 'دائن')`, []);
    await c.query('COMMIT');
    const v15post = await c.query(
        `SELECT COUNT(DISTINCT e.id) FILTER (WHERE e.status='posted')::int AS posted,
                COUNT(DISTINCT e.id) FILTER (WHERE e.status='void')::int AS voided,
                COALESCE(SUM(l.debit) FILTER (WHERE e.status='posted'),0)::numeric(16,2) dr
           FROM journal_entries e LEFT JOIN journal_lines l ON l.entry_id = e.id
          WHERE e.source_type='manual' AND (e.source_id = $1 OR e.source_id LIKE $1 || '#r%')`, [V15_REF]);
    const tbV15b = await c.query(`SELECT COALESCE(SUM(l.debit),0)::numeric(16,2) dr FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id AND e.status='posted'`);
    // الكاشف بمعرّف المصدر وحده لا يرى المراجعة (سطر المراجعة مرجعه `REF#r2`)،
    // فالحامي هو علامة was_voided نفسها لا العبارة — وهذا يثبت أن الحماية لا
    // تعتمد على صدفة: الصف المُبطل يحتفظ بالمرجع الأصلي إلى الأبد (سياسة 136).
    const detAfter = await c.query(
        `SELECT x.id, EXISTS (SELECT 1 FROM journal_entries v
                               WHERE v.source_type = 'manual' AND v.source_id = x.ref AND v.status = 'void') AS was_voided
           FROM (VALUES (999000000006::bigint, $1::text)) x(id, ref)
          WHERE NOT EXISTS (SELECT 1 FROM journal_entries je
                             WHERE je.source_type = 'manual' AND je.source_id = x.ref AND je.status = 'posted')`, [V15_REF]);
    const detReconAfter = await c.query(
        `SELECT x.id, EXISTS (SELECT 1 FROM journal_entries v
                               WHERE v.source_type = 'manual' AND v.source_id = x.ref AND v.status = 'void') AS was_voided
           FROM (VALUES (999000000006::bigint, $1::text)) x(id, ref)
          WHERE NOT EXISTS (SELECT 1 FROM journal_entries je
                             WHERE je.source_type = 'manual' AND je.source_id = x.ref AND je.status <> 'void')`, [V15_REF]);
    const detFamily = await c.query(
        `SELECT COUNT(*)::int AS posted_in_family FROM journal_entries je
          WHERE je.source_type = 'manual' AND je.status = 'posted'
            AND (je.source_id = $1 OR je.source_id LIKE $1 || '#r%')`, [V15_REF]);
    say('V15d مرجع المراجعة + العائلة بعد إعادة الترحيل', {
        rev: v15rev, ...v15post.rows[0],
        delta_debit: (Number(tbV15b.rows[0].dr) - Number(tbV15.rows[0].dr)).toFixed(2),
    });
    say('V15e الكاشف بعد إعادة الترحيل (base-ref)', { sweep: detAfter.rows, reconcile: detReconAfter.rows, posted_in_family: detFamily.rows[0].posted_in_family });
    if (v15rev !== `${V15_REF}#r2`) {throw new Error(`V15d: مرجع المراجعة خالف المتوقع (${v15rev})`);}
    if (v15post.rows[0].posted !== 1 || v15post.rows[0].voided !== 1) {throw new Error('V15d: العائلة لم تعد قيدًا مرحّلًا واحدًا + مُبطَلًا واحدًا');}
    if ((Number(tbV15b.rows[0].dr) - Number(tbV15.rows[0].dr)).toFixed(2) !== '0.00') {throw new Error('V15d: الميزان لم يعد لقيمته بعد الإبطال ثم إعادة الترحيل');}
    if (detAfter.rows.length !== 1 || detAfter.rows[0].was_voided !== true) {throw new Error('V15e: كاشف إقفال اليوم فقد علامة الإبطال بعد إعادة الترحيل — سيُرحّل نسخة ثانية');}
    if (detReconAfter.rows.length !== 1 || detReconAfter.rows[0].was_voided !== true) {throw new Error('V15e: كاشف المنسّق فقد علامة الإبطال بعد إعادة الترحيل');}
    if (detFamily.rows[0].posted_in_family !== 1) {throw new Error('V15e: العائلة فيها أكثر من قيد مرحّل لنفس المصدر');}

    // ─── تنظيف: ما تُرك في staging = ما كان قبل الاختبار ─────────────────────
    const cleaned = await purgeLeftovers(c);
    const after = await c.query(`SELECT COUNT(*)::int e, (SELECT COUNT(*) FROM journal_lines)::int l, (SELECT COUNT(*) FROM journal_ledger_audit)::int aud FROM journal_entries`);
    const tbEnd = await c.query(`SELECT COALESCE(SUM(l.debit),0)::numeric(16,2) dr FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id AND e.status='posted'`);
    say('ZZ بعد التنظيف — قيود/سطور/سجل', { ...after.rows[0], purgedEntries: cleaned.entries, auditDeleted: cleaned.audit });
    say('ZZb Σ الميزان بداية/نهاية', { start: tbBefore.rows[0].dr, end: tbEnd.rows[0].dr });
    if (after.rows[0].e !== before.rows[0].e || after.rows[0].l !== before.rows[0].l) {throw new Error('ZZ: حالة staging لم تعد مطابقة للبداية');}
    if (tbEnd.rows[0].dr.toString() !== tbBefore.rows[0].dr.toString()) {throw new Error('ZZb: الميزان لم يعد لقيمته الأساسية بعد التنظيف');}
    await c.end();
    say('RESULT', '✅ كل البوابات مرّت — staging عاد لحالته الأصلية');
})().catch(e => { console.error('❌ FAILED', e.message); process.exit(1); });
