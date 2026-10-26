/**
 * docs/esm-migration/audits/fix-real-shifts.js
 * تصحيح ورديات الموظفين من واقع البصمة الفعلي:
 *   shift_start  = شريحة الربع الأول (P25) لدقائق الدخول — مقربة لأقرب 5 دقائق
 *   shift_karim  = طول الوردية الواقعي = وسيط دقائق العمل / 60 (حدود 4..16)
 * الشروط: ≥5 أيام حضور في الشهر + تغيير مادي (≥30 دقيقة / ≥1 ساعة)
 * الاستخدام: node fix-real-shifts.js dry [YYYY-MM]   |   node fix-real-shifts.js apply [YYYY-MM]
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const MODE = process.argv[2] || 'dry';
const MONTH = process.argv[3] || '2026-09';
const GRACE_MIN = 10;

(async () => {
  const c = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'Kimo20177', database: 'karim_erp' });
  await c.connect();
  const rows = (await c.query(
    `SELECT e.id, e.name, e."shift_start" AS cur_shift, COALESCE(e."shift_karim",10) AS cur_karim,
            a.date, a."checkIn", a."checkOut", a."workMinutes"::int AS mins, a.late
       FROM employees e JOIN attendance a ON a."employeeId" = e.id
      WHERE a.date LIKE $1 AND e.status = 'active'
      ORDER BY e.name, a.date`, [MONTH + '%']
  )).rows;

  const byEmp = new Map();
  for (const r of rows) {
    if (!byEmp.has(r.id)) {byEmp.set(r.id, { name: r.name, cur: r.cur_shift, karim: Number(r.cur_karim), days: [] });}
    const b = byEmp.get(r.id);
    if (r.checkIn) {
      const [H, M] = r.checkIn.split(':').map(Number);
      b.days.push({ inMin: H * 60 + M, mins: Number(r.mins || 0) });
    }
  }

  const round5 = (m) => Math.round(m / 5) * 5;
  const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];

  const plan = [];
  for (const [id, b] of byEmp) {
    if (b.days.length < 5) {continue;}
    const inSorted = b.days.map(d => d.inMin).sort((a, c) => a - c);
    const minsSorted = b.days.map(d => d.mins).filter(m => m > 0).sort((a, c) => a - c);
    const p25 = pct(inSorted, 0.25);
    const newStart = round5(p25);
    const newKarim = Math.max(4, Math.min(16, Math.round((minsSorted.length ? minsSorted[Math.floor(minsSorted.length / 2)] : 0) / 60)));
    const cur = /^(\d{1,2}):(\d{2})/.test(b.cur || '') ? Number(RegExp.$1) * 60 + Number(RegExp.$2) : 540;
    const drift = newStart - cur;
    const karimDrift = newKarim - b.karim;
    if (Math.abs(drift) < 30 && Math.abs(karimDrift) < 1) {continue;}
    plan.push({ id, name: b.name, days: b.days.length, cur: fmt(cur), newStart: fmt(newStart), newStartMin: newStart, curKarim: b.karim, newKarim, drift, karimDrift });
  }
  plan.sort((a, c) => Math.abs(c.drift) - Math.abs(a.drift));
  console.log(`موظفون يحتاجون تصحيح الوردية من واقع البصمة: ${plan.length}`);
  for (const p of plan.slice(0, 12)) {
    console.log(`  ${p.name.slice(0, 26).padEnd(26)} ${p.cur}/${p.curKarim}س → ${p.newStart}/${p.newKarim}س (${p.days} يوم)`);
  }
  if (plan.length > 12) {console.log(`  … و${plan.length - 12} آخرين`);}

  if (MODE !== 'apply') { console.log('DRY — لم يُعدَّل شيء. للتطبيق: node fix-real-shifts.js apply'); await c.end(); return; }

  // نسخة أمان لقيم الورديات الحالية
  const backup = { at: new Date().toISOString(), month: MONTH, values: [] };
  for (const p of plan) {
    const cur = (await c.query('SELECT "shift_start", "shift_karim" FROM employees WHERE id = $1', [p.id])).rows[0];
    backup.values.push({ id: p.id, name: p.name, shift_start: cur.shift_start, shift_karim: cur.shift_karim });
  }
  const bdir = path.join(__dirname);
  fs.writeFileSync(path.join(bdir, `shift-backup-${MONTH}.json`), JSON.stringify(backup, null, 1));

  // التطبيق
  for (const p of plan) {
    await c.query('UPDATE employees SET "shift_start" = $1, "shift_karim" = $2 WHERE id = $3', [p.newStart, p.newKarim, p.id]);
  }
  console.log('applied shifts for', plan.length, 'employees');

  // إعادة حساب علم التأخير لشهر العملية: تأخير دخول > 10 دقائق سماحية
  const upd = await c.query(
    `UPDATE attendance a SET late = CASE
        WHEN a."checkIn" IS NULL THEN false
        ELSE (split_part(a."checkIn",':',1)::int*60 + split_part(a."checkIn",':',2)::int)
           > (split_part(e."shift_start",':',1)::int*60 + split_part(e."shift_start",':',2)::int) + $1
     END
     FROM employees e
     WHERE e.id = a."employeeId" AND a.date LIKE $2`, [GRACE_MIN, MONTH + '%']
  );
  console.log('late flags recomputed for', upd.rowCount, 'rows (grace', GRACE_MIN, 'min)');
  await c.end();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
