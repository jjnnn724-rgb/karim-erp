'use strict';
/* قراءة فقط: يولّد تقريري تغطية البصمات ومستخدمي الجهاز بلا موظف من صفوف الإنتاج الحيّة. */
const { pool } = require('./backend/shared-pool');
const fs = require('fs');

const OUT_DIR = 'C:/Users/DELL/Desktop/k';
const TODAY = '2026-11-02';
const q = (s, p) => pool.query(s, p);

function csvCell(v) {
    const s = v == null ? '' : String(v);
    return '"' + s.replace(/"/g, '""') + '"';
}
const csv = (rows) => '\ufeff' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

(async () => {
    const emps = (await q(`SELECT e.id, e.name, e."employeeId" AS no, e.department, e.status,
                                  e."deviceUserId" AS v, e."deviceUserIdAlt" AS alt,
                                  (SELECT count(*)::int FROM attendance_logs l WHERE l."employeeId" = e.id) AS raw_punches,
                                  (SELECT max(l."attendanceTime") FROM attendance_logs l WHERE l."employeeId" = e.id) AS last_punch,
                                  (SELECT count(*)::int FROM attendance a WHERE a."employeeId" = e.id) AS att_days,
                                  (SELECT count(*)::int FROM punch_face_templates t WHERE t.user_id = e."userId") AS face_v1,
                                  (SELECT count(*)::int FROM punch_face_templates_v2 t2 WHERE t2.user_id = e."userId" AND t2.active = TRUE) AS face_v2
                             FROM employees e ORDER BY e.name`)).rows;

    const onDevice = new Set((await q(`SELECT DISTINCT btrim("userId") AS u FROM zk_device_users`)).rows.map((r) => r.u));
    const altOwned = (await q(`SELECT btrim("deviceUserId") AS v, min(id) AS owner FROM employees
                                WHERE "deviceUserId" IS NOT NULL AND btrim("deviceUserId") <> '' GROUP BY 1`)).rows;
    const primaryOf = new Map(altOwned.map((r) => [r.v, r.owner]));

    const rows = [['الاسم', 'الرقم الوظيفي', 'القسم', 'رقم الجهاز', 'موجود على الجهاز', 'بصمة وجه (تطبيق)',
        'إجمالي البصمات الخام', 'آخر بصمة', 'أيام حضور مسجلة', 'الحالة', 'الإجراء المطلوب']];
    for (const e of emps) {
        const linked = String(e.v || '').trim() !== '';
        const onDev = linked && onDevice.has(String(e.v).trim());
        const face = (Number(e.face_v1) || 0) + (Number(e.face_v2) || 0);
        const last = e.last_punch ? new Date(e.last_punch) : null;
        const daysAgo = last ? Math.floor((Date.parse(`${TODAY}T23:59:59+03:00`) - last.getTime()) / 86400000) : null;
        let state, action;
        if (!linked) {state = 'غير مربوط برقم جهاز'; action = 'اربطه برقم حسابه على الجهاز أو سجّل بصمته';}
        else if (!onDev) {state = `رقم ${e.v} لا حساب له على الجهاز`; action = 'أعد تسجيل البصمة على الجهاز ثم حدّث الربط';}
        else if (!last) {state = 'مربوط بلا أي بصمة خام'; action = 'سجّل بصمته على الجهاز ثم تحقق من وصولها';}
        else if (daysAgo > 30) {state = `آخر بصمة قبل ${daysAgo} يومًا`; action = 'تأكد من حضوره — أعد تسجيل بصمته إن توقفت';}
        else if (daysAgo > 7) {state = `آخر بصمة قبل ${daysAgo} يومًا`; action = 'راقب — قد يكون في إجازة أو توقفت بصمته';}
        else {state = `نشط (آخر بصمة قبل ${daysAgo == null ? 0 : daysAgo} يومًا)`; action = '—';}
        if (String(e.status || '') && e.status !== 'active') {state += ` · ${e.status}`;}
        rows.push([e.name, e.no, e.department, e.v || '', onDev ? 'نعم' : (linked ? 'لا' : '—'),
            face ? `نعم (${face} قالب)` : 'لا', e.raw_punches,
            last ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', dateStyle: 'short', timeStyle: 'short' }).format(last) : '—',
            e.att_days, state, action]);
    }
    fs.writeFileSync(`${OUT_DIR}/تقرير-تغطية-البصمات-${TODAY}.csv`, csv(rows), 'utf-8');

    /* حسابات الجهاز التي لا يملكها أي موظف (بأساسي أو بديل) — مع بصماتها */
    const roster = (await q(`SELECT d.uid, btrim(d."userId") AS userid, d.name,
                                    (SELECT count(*)::int FROM attendance_logs l WHERE l."deviceUserId" = btrim(d."userId")::text) AS punches_by_userid,
                                    (SELECT count(*)::int FROM attendance_logs l WHERE l."deviceUserId" = d.uid::text) AS punches_by_uid,
                                    (SELECT max(l."attendanceTime") FROM attendance_logs l WHERE l."deviceUserId" IN (btrim(d."userId")::text, d.uid::text)) AS last_punch
                               FROM zk_device_users d WHERE d."deviceId" = (SELECT id FROM attendance_devices WHERE enabled = TRUE LIMIT 1)`)).rows;
    const claimed = new Set(emps.flatMap((e) => [String(e.v || '').trim(), String(e.alt || '').trim()].filter(Boolean)));
    const orphanRows = [['رقم المستخدم على الجهاز', 'uid على الجهاز', 'الاسم على الجهاز', 'بصمات خام', 'آخر بصمة', 'ملاحظة']];
    for (const r of roster) {
        if (claimed.has(r.userid) || claimed.has(String(r.uid))) {continue;}
        const n = Number(r.punches_by_userid) + Number(r.punches_by_uid);
        orphanRows.push([r.userid, r.uid, r.name, n,
            r.last_punch ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(r.last_punch)) : '—',
            n ? 'حساب على الجهاز بلا موظف — بصماته لا تُنسب لأحد' : 'حساب بلا بصمات']);
    }
    fs.writeFileSync(`${OUT_DIR}/مستخدمو-جهاز-بلا-موظف-${TODAY}.csv`, csv(orphanRows), 'utf-8');

    const active = emps.filter((e) => e.last_punch && (Date.parse(`${TODAY}T23:59:59+03:00`) - new Date(e.last_punch).getTime()) / 86400000 <= 7).length;
    console.log(`موظفون=${emps.length} · نشيطو البصمة (7 أيام)=${active} · بلا حساب على الجهاز=${rows.length - 1 - active} · حسابات جهاز بلا موظف=${orphanRows.length - 1}`);
    console.log('ملفان مكتوبان في ' + OUT_DIR);
    await pool.end();
})().catch((e) => { console.log('ERR ' + e.message); process.exit(1); });
