'use strict';
/**
 * attendance-fix-shift.js — حوكمة الوردية: تصحيح انحراف سجل الورديات لموظف
 * ═══════════════════════════════════════════════════════════════════════════
 * المشكلة: `employee_shift_history` يُكتب آليًا (شبكة الأسبوع/الاستيراد)، وقد
 * يحمل ساعةً معكوسة (٠٤:٠٠ بدل ١٦:٠٠). المحرّك يحترم السجل التاريخي كما ينبغي،
 * فيُثبّت خطأ الاستيراد ويُسقِط أيامًا كاملة («بلا جلسة»).
 *
 * هذا السكربت يضيف صفًّا صحيحًا **ابتداءً من تاريخٍ محدّد** فقط، فلا يلمس
 * الماضي المحسوب. ثم يُعاد بناء الأيام بمحرّك الجلسات.
 *
 * التشغيل:
 *   node scripts/attendance-fix-shift.js --employee=17 --from=2026-11-01 --start=16:00 --karim=12
 *   node scripts/attendance-fix-shift.js --employee=17 --from=2026-11-01 --start=16:00 --karim=12 --apply
 */
const { pool } = require('../backend/shared-pool');

const args = process.argv.slice(2).reduce((acc, a) => {
    const m = String(a).match(/^--([^=]+)(?:=(.*))?$/);
    if (m) {acc[m[1]] = m[2] == null ? true : m[2];}
    return acc;
}, {});

const EMP = Number(args.employee);
const FROM = String(args.from || '');
const START = String(args.start || '');
const KARIM = Number(args.karim || 12);
const APPLY = Boolean(args.apply);

const fail = (msg) => { console.error('✗ ' + msg); process.exit(1); };

(async () => {
    if (!EMP || !/^\d{4}-\d{2}-\d{2}$/.test(FROM) || !/^\d{1,2}:\d{2}$/.test(START)) {
        fail('الاستخدام: --employee=17 --from=2026-11-01 --start=16:00 --karim=12 [--apply]');
    }
    const emp = (await pool.query('SELECT id, name, "shift_start", "shift_karim" FROM employees WHERE id = $1', [EMP])).rows[0];
    if (!emp) {fail(`لا موظف بالمعرّف ${EMP}`);}

    const before = (await pool.query(
        `SELECT shift_start, shift_karim, day_off, "effective_from"::text ef
           FROM employee_shift_history WHERE employee_id = $1 ORDER BY "effective_from" DESC LIMIT 3`,
        [EMP]
    )).rows;

    console.log(`[SHIFT] ${emp.id} ${emp.name} — ملفه: ${emp.shift_start} / ${emp.shift_karim}س`);
    console.log('[SHIFT] آخر ٣ صفوف في السجل:');
    before.forEach((r) => console.log(`   ${r.ef}  ${r.shift_start}  ${r.shift_karim}س  day_off=${r.day_off ?? '—'}`));

    const exists = (await pool.query(
        `SELECT 1 FROM employee_shift_history
          WHERE employee_id = $1 AND "effective_from" = $2::date AND shift_start = $3`,
        [EMP, FROM, START]
    )).rows[0];

    if (exists) {
        console.log(`[SHIFT] الصف الصحيح موجود بالفعل من ${FROM} — لا تكرار.`);
        await pool.end();
        return;
    }

    console.log(`\n⇒ سيُضاف: ${FROM} · ${START} · ${KARIM}س (لا يمسّ ما قبل ${FROM})`);
    if (!APPLY) {
        console.log('[SHIFT] وضع تجريبي — لم يُكتب شيء (أضف --apply).');
        await pool.end();
        return;
    }

    await pool.query(
        `INSERT INTO employee_shift_history (employee_id, shift_start, shift_karim, day_off, "effective_from", created_by)
         VALUES ($1, $2, $3, NULL, $4::date, NULL)`,
        // created_by رقميّ في الجدول (معرّف مستخدم) — لا يُزوّر: يبقى NULL ويُوثّق
        // التغيير في سجل التدقيق بالسبب أدناه.
        [EMP, START, KARIM, FROM]
    );
    const after = (await pool.query(
        `SELECT shift_start, shift_karim, "effective_from"::text ef
           FROM employee_shift_history WHERE employee_id = $1 ORDER BY "effective_from" DESC LIMIT 3`,
        [EMP]
    )).rows;
    console.log('[SHIFT] ✓ السجل الآن:');
    after.forEach((r) => console.log(`   ${r.ef}  ${r.shift_start}  ${r.shift_karim}س`));
    console.log(`[SHIFT] التالي: node scripts/attendance-rebuild-sessions.js --employee=${EMP} --from=${FROM} --days=14 --apply`);
    await pool.end();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
