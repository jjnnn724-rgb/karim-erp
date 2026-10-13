'use strict';
/**
 * strict-audit-lib.js — فحوصات سلامة بيانات الحضور (مشتركة بين CLI والواجهة)
 * runStrictAudit(month) -> { ok, month, checks: [{name, status, count, warn}], failures }
 */
const { pool } = require('./shared-pool');

// FIX 2026-10-11 (M9): grace minutes — was counting 1+ min late as FAIL,
// but engine uses 15-min grace via graceMinutes() in shift-day.js.
// Import the same logic to keep audit consistent with engine.
function graceMinutes() {
  const v = parseInt(process.env.ATTENDANCE_GRACE_MINUTES || '15', 10);
  return Number.isFinite(v) && v >= 0 && v <= 120 ? v : 15;
}

function toMin(t) {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

async function runStrictAudit(month) {
  const m = String(month || '').match(/^\d{4}-\d{2}$/) ? month : null;
  const checks = [];
  const failures = [];
  const check = async (name, q, params = []) => {
    const c = (await pool.query(q, params)).rows[0].c;
    const pass = c === 0;
    checks.push({ name, status: pass ? 'PASS' : 'FAIL', count: c });
    if (!pass) {failures.push({ name, count: c });}
  };

  await check('صفوف زمنية مستحيلة (انصراف قبل دخول أو مساوٍ له)',
    `SELECT COUNT(*)::int c FROM attendance WHERE "checkInAt" IS NOT NULL AND "checkOutAt" IS NOT NULL AND "checkOutAt" <= "checkInAt"`);
  await check('دقائق عمل سالبة',
    `SELECT COUNT(*)::int c FROM attendance WHERE "workMinutes" IS NOT NULL AND "workMinutes" < 0`);
  await check('أرقام وظيفية مكررة',
    `SELECT COUNT(*)::int c FROM (SELECT "employeeId" FROM employees GROUP BY "employeeId" HAVING COUNT(*) > 1) d`);
  await check('سجلات حضور بلا موظف',
    `SELECT COUNT(*)::int c FROM attendance a LEFT JOIN employees e ON e.id = a."employeeId" WHERE e.id IS NULL`);
  await check('مدد ورديات خارج 1..24 ساعة',
    `SELECT COUNT(*)::int c FROM employees WHERE shift_karim IS NOT NULL AND (shift_karim < 1 OR shift_karim > 24)`);

  const unmapped = (await pool.query(
    `SELECT COUNT(*)::int c FROM attendance_logs WHERE "employeeId" IS NULL`)).rows[0].c;
  checks.push({ name: 'بصمات بلا ربط بموظف (تراكم يدوي)', status: 'WARN', count: unmapped });

  // أيام التأخير لا تتجاوز أيام الحضور لأي موظف (نفس قاعدة التطبيق)
  const emps = (await pool.query(
    `SELECT id, "employeeId", shift_start, shift_karim FROM employees WHERE status = 'active'`)).rows;
  const bad = [];
  const grace = graceMinutes();
  for (const e of emps) {
    const rows = (await pool.query(
      `SELECT "checkIn", "checkOut", "workMinutes" FROM attendance
       WHERE "employeeId" = $1 ${m ? `AND date LIKE '${m}-%'` : ''}`, [e.id])).rows;
    if (!rows.length) {continue;}
    const sMin = toMin(e.shift_start) ?? 540;
    const karim = Number(e.shift_karim) > 0 ? Number(e.shift_karim) : 10;
    let lateDays = 0;
    for (const r of rows) {
      if (!r.checkIn) {continue;}
      const inMin = toMin(r.checkIn);
      // FIX 2026-10-11 (M9): apply grace — arrival beyond grace counts as late
      const rawArrival = inMin == null ? 0 : Math.max(0, inMin - sMin);
      const arrival = rawArrival > grace ? rawArrival - grace : 0;
      let early = 0;
      const outMin = toMin(r.checkOut);
      if (outMin != null && inMin != null) {
        const endRaw = sMin + Math.round(karim * 60);
        let out = outMin;
        if (out < inMin) {out += 24 * 60;}
        if (endRaw > 24 * 60 && out < 12 * 60) {out += 24 * 60;}
        if (out >= inMin) {early = Math.max(0, endRaw - out);}
      }
      const wm = Number(r.workMinutes);
      const review = Boolean(r.checkIn && r.checkOut && Number.isFinite(wm) && wm === 0);
      if (!review && arrival + early > 0) {lateDays++;}
    }
    if (lateDays > rows.length) {bad.push({ emp: e.employeeId, lateDays, days: rows.length });}
  }
  checks.push({
    name: `أيام تأخير تتجاوز الحضور${m ? ` (${m})` : ''}`,
    status: bad.length === 0 ? 'PASS' : 'FAIL',
    count: bad.length,
    detail: bad.slice(0, 10),
  });
  if (bad.length) {failures.push({ name: 'late-days exceed days-present', count: bad.length });}

  return { ok: failures.length === 0, month: m, checks, failures };
}

module.exports = { runStrictAudit };
