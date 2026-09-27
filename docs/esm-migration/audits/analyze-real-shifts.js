/**
 * docs/esm-migration/audits/analyze-real-shifts.js
 * تحليل واقع البصمة لكل موظف: الوردية الفعلية (وسيط الدخول) مقابل المسجلة
 * قراءة فقط — لا تعدل شيئًا. الاستخدام: node analyze-real-shifts.js [YYYY-MM]
 */
const { Client } = require('pg');
const MONTH = process.argv[2] || '2026-09';

(async () => {
  const c = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'Kimo20177', database: 'karim_erp' });
  await c.connect();
  const rows = (await c.query(
    `SELECT e.id, e.name, e."shift_start" AS cur_shift, e."deviceUserId" AS fp,
            a.date, a."checkIn", a."checkOut", a."workMinutes"::int AS mins, a.late
       FROM employees e JOIN attendance a ON a."employeeId" = e.id
      WHERE a.date LIKE $1 AND e.status = 'active'
      ORDER BY e.name, a.date`, [MONTH + '%']
  )).rows;

  const byEmp = new Map();
  for (const r of rows) {
    if (!byEmp.has(r.id)) byEmp.set(r.id, { name: r.name, cur: r.cur_shift, fp: r.fp, days: [] });
    const b = byEmp.get(r.id);
    if (r.checkIn) {
      const [H, M] = r.checkIn.split(':').map(Number);
      b.days.push({ date: r.date, inMin: H * 60 + M, checkIn: r.checkIn });
    }
  }

  const findings = [];
  for (const [id, b] of byEmp) {
    if (b.days.length < 5) continue; // أدلة غير كافية
    const mins = b.days.map(d => d.inMin).sort((a, c) => a - c);
    const med = mins[Math.floor(mins.length / 2)];
    const cur = /^(\d{1,2}):(\d{2})/.test(b.cur || '') ? Number(RegExp.$1) * 60 + Number(RegExp.$2) : 540;
    const drift = med - cur;
    findings.push({ id, name: b.name, cur, med, drift, days: b.days.length });
  }
  findings.sort((a, c) => Math.abs(c.drift) - Math.abs(a.drift));

  const wrong = findings.filter(f => Math.abs(f.drift) >= 30);
  const ok = findings.filter(f => Math.abs(f.drift) < 30);
  const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  console.log(`شهر ${MONTH} — موظفون لديهم ≥5 أيام بصمة: ${findings.length}`);
  console.log(`\n=== وردية المسجلة لا تطابق الواقع (${wrong.length} موظفًا) — المقترح: shift_start = وسط الدخول ===`);
  for (const f of wrong.slice(0, 40)) {
    console.log(`  ${f.name.slice(0, 28).padEnd(28)} مسجل ${fmt(f.cur)} → الواقع ${fmt(f.med)} (${f.days} يوم، انحراف ${f.drift >= 0 ? '+' : ''}${fmt(Math.abs(f.drift))})`);
  }
  console.log(`\n=== مطابقين (${ok.length}) — لا تغيير ===`);
  // الموظفون بلا أي بصمة
  const noPunch = (await c.query(
    `SELECT name FROM employees WHERE status='active' AND id NOT IN (SELECT DISTINCT "employeeId" FROM attendance WHERE date LIKE $1)`, [MONTH + '%']
  )).rows;
  console.log(`\n=== موظفون بلا أي بصمة في الشهر (${noPunch.length}) — مراجعة يدوية: غير مربوطين بجهاز أو منتهية خدمة ===`);
  console.log(noPunch.map(r => '  ' + r.name).join('\n'));
  await c.end();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
