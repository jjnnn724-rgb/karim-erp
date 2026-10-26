// الجرد النهائي لتغطية البصمات — CSV جاهز للإكسل (UTF-8 BOM) + طباعة النتائج
'use strict';
const fs = require('fs');
const { Pool } = require('pg');
const pool = new Pool({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'Kimo20177', database: 'karim_erp', max: 3 });
const q = async (sql, p) => (await pool.query(sql, p)).rows;
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

(async () => {
    const employees = await q(`SELECT id, name, "employeeId", "deviceUserId", department FROM employees WHERE status NOT IN ('منتهي','inactive','منتهي الخدمة') ORDER BY name`);
    const raw = new Map((await q(`SELECT "employeeId", MAX("attendanceTime") last_at, COUNT(*)::int raw FROM attendance_logs WHERE "employeeId" IS NOT NULL GROUP BY 1`)).map(r => [String(r.employeeId), r]));
    const recent = new Set((await q(`SELECT DISTINCT "employeeId" FROM attendance_logs WHERE "employeeId" IS NOT NULL AND "attendanceTime" >= NOW() - interval '7 days'`)).map(r => String(r.employeeId)));
    const days = new Map((await q(`SELECT "employeeId", COUNT(DISTINCT date)::int d FROM attendance GROUP BY 1`)).map(r => [String(r.employeeId), r.d]));
    const faces = new Set((await q(`SELECT DISTINCT t.user_id FROM punch_face_templates_v2 t JOIN employees e ON e."userId" = t.user_id WHERE t.active = true`)).map(r => String(r.user_id)));
    const deviceUsers = new Map((await q(`SELECT "userId", name FROM zk_device_users`)).map(r => [String(r.userId).trim(), r.name]));
    const norm = v => { const s = String(v ?? '').trim(); return /^\d+$/.test(s) ? String(Number(s)) : s; };

    const rows = employees.map(e => {
        const devId = norm(e.deviceUserId);
        const onDevice = devId ? deviceUsers.has(devId) : false;
        const r = raw.get(String(e.id));
        const last = r?.last_at || null;
        const hasRecent = recent.has(String(e.id));
        let status, action;
        if (!devId) { status = 'بلا ربط بالجهاز'; action = 'عيّن رقم بصمة له (ربط الموظفين)'; }
        else if (!onDevice) { status = 'رقمه غير موجود على الجهاز'; action = 'أعد مزامنة مستخدمي الجهاز / سجّله عليه'; }
        else if (!last) { status = 'على الجهاز لكن بلا أي بصمة'; action = 'سجّل بصمة إصبعه على الجهاز أو فعّل بصمة الوجه من التطبيق'; }
        else if (!hasRecent) {
            const d = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
            status = `آخر بصمة قبل ${d} يوم`; action = 'تأكد من حضوره — أعد تسجيل بصمته إن توقفت';
        } else { status = 'سليم ✓'; action = ''; }
        return { name: e.name, emp: e.employeeId, dept: e.department, dev: e.deviceUserId, onDevice, face: faces.has(String(e.id)), last, rawN: r?.raw || 0, days: days.get(String(e.id)) || 0, status, action };
    });

    const problems = rows.filter(r => r.status !== 'سليم ✓');
    const unmapped = await q(`SELECT l."deviceUserId", COUNT(*)::int raw, MAX(l."attendanceTime") last_at FROM attendance_logs l WHERE l."employeeId" IS NULL GROUP BY 1 ORDER BY 2 DESC`);

    // CSV الموظفين (المشاكل أولًا ثم السليمون)
    const header = ['الاسم', 'الرقم الوظيفي', 'القسم', 'رقم الجهاز', 'موجود على الجهاز', 'بصمة وجه (تطبيق)', 'إجمالي البصمات الخام', 'آخر بصمة', 'أيام حضور مسجلة', 'الحالة', 'الإجراء المطلوب'].map(csvCell).join(',');
    const line = (r) => [r.name, r.emp, r.dept, r.dev, r.onDevice ? 'نعم' : 'لا', r.face ? 'نعم' : 'لا', r.rawN, r.last ? String(r.last).slice(0, 16) : 'أبدًا', r.days, r.status, r.action].map(csvCell).join(',');
    const csv = '\ufeff' + [header, ...problems.map(line), ...rows.filter(r => r.status === 'سليم ✓').map(line)].join('\r\n');
    fs.writeFileSync('C:/Users/RemoteHome/Desktop/k/تقرير-تغطية-البصمات.csv', csv, 'utf8');

    // CSV مستخدمو الجهاز غير المربوطين
    const csv2 = '\ufeff' + ['رقم المستخدم على الجهاز', 'الاسم على الجهاز', 'بصمات خام', 'آخر بصمة'].map(csvCell).join(',') + '\r\n'
        + unmapped.map(u => [u.deviceUserId, deviceUsers.get(norm(u.deviceUserId)) || '?', u.raw, String(u.last_at).slice(0, 16)].map(csvCell).join(',')).join('\r\n');
    fs.writeFileSync('C:/Users/RemoteHome/Desktop/k/مستخدمو-جهاز-بلا-موظف.csv', csv2, 'utf8');

    console.log('TOTAL=' + rows.length + ' PROBLEMS=' + problems.length + ' OK=' + (rows.length - problems.length));
    for (const p of problems) { console.log('PROBLEM|' + p.name + '|' + (p.dept || '-') + '|dev=' + (p.dev || '-') + '|last=' + (p.last ? String(p.last).slice(0, 10) : 'أبدًا') + '|' + p.status); }
    for (const u of unmapped) { console.log('UNMAPPED|' + u.deviceUserId + '|' + (deviceUsers.get(norm(u.deviceUserId)) || '?') + '|' + u.raw); }
    await pool.end();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
