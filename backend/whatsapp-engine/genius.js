/**
 * whatsapp-engine/genius.js — العقل العبقري: إجابات حقيقية من بيانات النظام
 * ────────────────────────────────────────────────────────────────────────────
 * - حضور موظف بالتفصيل (آخر 5 أيام بصمات فعلية: يجي امته ويمشي امته)
 * - مخزون: صنف بالاسم + النواقص الحرجة بالكميات والقيم
 * - تقرير يومي شامل بمستوى عالمي + إرسال مجدول في الموعد
 * - صارم: لا تخمين — لا بيانات تعني قول ذلك صراحة، وكل رقم من قاعدة البيانات
 */
'use strict';

const { pool } = require('../shared-pool');
const { logger } = require('../logger');
const store = require('./store');
const { isManagerChat, managerJids, withTimeout } = require('./erp');
const { calculateDelayParts } = require('../shift-day');

const DB_TIMEOUT = 15000;
const MAX_MSG = 3400;

/* ─── تطبيع عربي للبحث الضبابي ─── */
function norm(s) {
  return String(s == null ? '' : s)
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/[ؤئ]/g, 'ء') // همزة على واو/ياء -> همزة مفردة
    .replace(/ء/g, 'ا')     // الهمزة المفردة -> الف
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function esc(s) {
  return String(s == null ? '' : s).slice(0, 120);
}

function riyadhToday(offsetDays = 0) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(Date.now() + offsetDays * 86400000));
}

function arabicDayName(dateStr) {
  const names = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const d = new Date(dateStr + 'T12:00:00');
  return Number.isNaN(d.getTime()) ? '' : names[d.getDay()];
}

function fmtHours(mins) {
  const m = Math.max(0, Math.round(Number(mins) || 0));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString('en-US');
}

/* ─── البحث عن موظف (اسم أو كود) ─── */
async function findEmployees(query) {
  const q = norm(query);
  if (!q) return [];
  const emps = (await withTimeout(
    pool.query(`SELECT id, name, "employeeId", shift_start, shift_karim, department, position, status FROM employees WHERE status = 'active'`),
    DB_TIMEOUT, 'GENIUS'
  )).rows;
  // تطابق مباشر بالكود أولًا
  const codeHit = emps.filter(e => norm(e.employeeId) === q.replace(/\s+/g, ''));
  if (codeHit.length) return codeHit;
  const hits = emps.filter(e => {
    const n = norm(e.name);
    return n && (n.includes(q) || q.includes(n));
  });
  return hits.slice(0, 6);
}

/* ─── خريطة أسماء الأقسام العربية → كود ─── */
const DEPT_MAP = {
  'مطبخ': 'KITCHEN', 'مطبخات': 'KITCHEN', 'كيتشن': 'KITCHEN',
  'خدمة': 'SERVICE', 'سيرفس': 'SERVICE', 'ويترز': 'SERVICE', 'ويتر': 'SERVICE',
  'إدارة': 'ADMIN', 'ادمن': 'ADMIN', 'مكتب': 'ADMIN',
  'مبيعات': 'SALES', 'كاشير': 'SALES',
  'تنظيف': 'CLEANING', 'نظافة': 'CLEANING',
  'مخزن': 'STORE', 'مستودع': 'STORE',
  'أمن': 'SECURITY', 'امن': 'SECURITY', 'حارس': 'SECURITY',
  'محاسبة': 'ACCOUNTING', 'حسابات': 'ACCOUNTING',
  'مشاوي': 'GRILL', 'مشويات': 'GRILL',
  'معجنات': 'PASTRY', 'حلويات': 'PASTRY',
};

function mapDeptName(name) {
  if (!name) return undefined;
  const n = norm(name);
  for (const [ar, en] of Object.entries(DEPT_MAP)) {
    if (n.includes(norm(ar))) return en;
  }
  // إذا كان الاسم بالإنجليزي بالفعل - استخدمه كما هو
  const upper = name.toUpperCase();
  if (['KITCHEN', 'SERVICE', 'ADMIN', 'SALES', 'CLEANING', 'STORE', 'SECURITY', 'ACCOUNTING', 'GRILL', 'PASTRY'].includes(upper)) return upper;
  return undefined;
}

/* ─── استعلام موظفين متقدم: فلترة متعددة ─── */
async function queryEmployees(filters = {}) {
  const { department, position, shiftStart, status = 'active', lateOnly, absentToday, limit = 20 } = filters;
  let sql = `SELECT id, name, "employeeId", shift_start, shift_karim, department, position, status FROM employees WHERE 1=1`;
  const params = [];
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  if (department) { params.push(department); sql += ` AND department = $${params.length}`; }
  if (position) { params.push(position); sql += ` AND position = $${params.length}`; }
  if (shiftStart) { params.push(shiftStart); sql += ` AND shift_start = $${params.length}`; }
  sql += ` ORDER BY name LIMIT $${params.length + 1}`;
  params.push(limit);
  const rows = (await withTimeout(pool.query(sql, params), DB_TIMEOUT, 'GENIUS')).rows;
  return rows;
}

/* ─── موظفين متأخرين اليوم / هذا الشهر ─── */
async function lateEmployees({ date, month, limit = 15 }) {
  const where = date ? `a.date = $1` : month ? `a.date LIKE $1 || '-%'` : `a.date = (SELECT MAX(date) FROM attendance)`;
  const params = date || month ? [date || month] : [];
  const sql = `
    SELECT e.id, e.name, e."employeeId", e.shift_start, a."checkIn", a."checkOut", a.late, a."workMinutes"
    FROM attendance a JOIN employees e ON e.id = a."employeeId"
    WHERE e.status = 'active' AND ${where} AND a."checkIn" IS NOT NULL AND a.late
    ORDER BY a."checkIn"
  `;
  const rows = (await withTimeout(pool.query(sql + ` LIMIT ${limit}`, params), DB_TIMEOUT, 'GENIUS')).rows;
  return rows;
}

/* ─── موظفين غائبين اليوم (لا بصمة دخول) ─── */
async function absentToday({ date, limit = 20 }) {
  const d = date || riyadhToday();
  const sql = `
    SELECT e.id, e.name, e."employeeId", e.shift_start, e.department, e.position
    FROM employees e
    WHERE e.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM attendance a WHERE a."employeeId" = e.id AND a.date = $1 AND a."checkIn" IS NOT NULL
      )
    ORDER BY e.name LIMIT $2
  `;
  const rows = (await withTimeout(pool.query(sql, [d, limit]), DB_TIMEOUT, 'GENIUS')).rows;
  return rows;
}

/* ─── ملخص قسم / وردية ─── */
async function departmentSummary({ department, date }) {
  const d = date || riyadhToday();
  const params = [d];
  let deptFilter = '';
  if (department) { params.push(department); deptFilter = `AND e.department = $${params.length}`; }
  const sql = `
    SELECT e.department,
           COUNT(*) FILTER (WHERE a."checkIn" IS NOT NULL)::int AS present,
           COUNT(*) FILTER (WHERE a."checkIn" IS NOT NULL AND a."checkOut" IS NULL)::int AS miss_out,
           COUNT(*) FILTER (WHERE a."checkIn" IS NULL)::int AS absent,
           COUNT(*) FILTER (WHERE a.late)::int AS late
    FROM employees e
    LEFT JOIN attendance a ON a."employeeId" = e.id AND a.date = $1
    WHERE e.status = 'active' ${deptFilter}
    GROUP BY e.department
    ORDER BY e.department
  `;
  const rows = (await withTimeout(pool.query(sql, params), DB_TIMEOUT, 'GENIUS')).rows;
  return rows;
}

/* ─── قائمة ورديات فريدة ─── */
async function listShifts() {
  const rows = (await withTimeout(
    pool.query(`SELECT DISTINCT shift_start FROM employees WHERE status = 'active' AND shift_start IS NOT NULL ORDER BY shift_start`),
    DB_TIMEOUT, 'GENIUS'
  )).rows;
  return rows.map(r => r.shift_start);
}

/* ─── قائمة أقسام فريدة ─── */
async function listDepartments() {
  const rows = (await withTimeout(
    pool.query(`SELECT DISTINCT department FROM employees WHERE status = 'active' AND department IS NOT NULL ORDER BY department`),
    DB_TIMEOUT, 'GENIUS'
  )).rows;
  return rows.map(r => r.department);
}

/* ─── تفصيل حضور موظف: آخر N أيام فيها بصمات ─── */
async function attendanceDetail(empId, days = 5) {
  const emp = (await withTimeout(
    pool.query(`SELECT id, name, "employeeId", shift_start, shift_karim, department, position FROM employees WHERE id = $1`, [empId]),
    DB_TIMEOUT, 'GENIUS'
  )).rows[0];
  if (!emp) return 'الموظف غير موجود.';
  const n = Math.min(14, Math.max(1, Number(days) || 5));
  const rows = (await withTimeout(
    pool.query(
      `SELECT date, "checkIn", "checkOut", "workMinutes", late, early_leave, on_leave
       FROM attendance WHERE "employeeId" = $1 AND ("checkIn" IS NOT NULL OR "checkOut" IS NOT NULL)
       ORDER BY date DESC LIMIT $2`, [empId, n * 2]),
    DB_TIMEOUT, 'GENIUS'
  )).rows.slice(0, n);
  if (!rows.length) return `لا توجد بصمات مسجلة لـ ${emp.name} (${emp.employeeId}).`;
  const lines = [];
  lines.push(`👤 ${emp.name} (${emp.employeeId})`);
  lines.push(`الوردية: ${emp.shift_start || '—'}${emp.shift_karim ? ` (${emp.shift_karim} س)` : ''}`);
  lines.push(`آخر ${rows.length} أيام فيها بصمات:`);
  let lateDays = 0;
  let totMin = 0;
  for (const r of [...rows].reverse()) {
    const d = calculateDelayParts(r, emp);
    totMin += d.lateMinutes || 0;
    if ((d.lateMinutes || 0) > 0) lateDays++;
    const ci = r.checkIn || '—';
    const co = r.checkOut || '—';
    const h = fmtHours(r.workMinutes);
    let st = 'في الوقت';
    if (!r.checkIn && r.checkOut) st = 'بلا حضور';
    else if (r.checkIn && !r.checkOut) st = 'بلا انصراف';
    else if (d.arrivalLateMinutes > 0 && d.earlyLeaveMinutes > 0) st = `تأخير ${d.arrivalLateMinutes} د + تبكير ${d.earlyLeaveMinutes} د`;
    else if (d.arrivalLateMinutes > 0) st = `تأخير ${d.arrivalLateMinutes} د`;
    else if (d.earlyLeaveMinutes > 0) st = `تبكير ${d.earlyLeaveMinutes} د`;
    if (r.on_leave) st += ' (إجازة)';
    lines.push(`${r.date} ${arabicDayName(r.date)}: ${ci} ← ${co} (${h}) — ${st}`);
  }
  lines.push(`الخلاصة: ${lateDays} يوم فيها تأخير من ${rows.length} • إجمالي ${fmtNum(totMin)} دقيقة`);
  return lines.join('\n').slice(0, MAX_MSG);
}

/* ─── مخزون: صنف بالاسم أو النواقص الحرجة ─── */
async function inventoryAnswer(query) {
  const q = norm(query);
  const rows = (await withTimeout(
    pool.query(`SELECT id, name, category, unit, COALESCE(qty,0)::float AS qty,
                       COALESCE("avgCost",0)::float AS cost, COALESCE("minQty",0)::float AS minq
                FROM inventory ORDER BY id LIMIT 3000`), DB_TIMEOUT, 'GENIUS')).rows;
  if (q) {
    const hits = rows.filter(r => { const n = norm(r.name); return n && (n.includes(q) || q.includes(n)); }).slice(0, 6);
    if (!hits.length) return `لا يوجد صنف باسم «${esc(query).trim()}».`;
    if (hits.length > 1) {
      const lines = [`أصناف تطابق (${hits.length}) — حدد:`];
      for (const r of hits.slice(0, 6)) lines.push(`- ${r.name}: ${fmtNum(r.qty)} ${r.unit || ''}`);
      return lines.join('\n').slice(0, MAX_MSG);
    }
    const r = hits[0];
    const gap = Math.max(0, r.minq - r.qty);
    const state = r.qty <= 0 ? '⛔ نافذ' : (r.minq > 0 && r.qty <= r.minq ? '⚠ منخفض' : '✅ متوفر');
    const lines = [
      `📦 ${r.name}`, `الرصيد: ${fmtNum(r.qty)} ${r.unit || ''} (${state})`,
      `الحد الأدنى: ${fmtNum(r.minq)} • الفئة: ${r.category || '—'}`,
      r.cost > 0 ? `العجز: ${fmtNum(gap)} ${r.unit || ''} • قيمة التعبئة: ${fmtNum(Math.round(gap * r.cost))} SAR` : 'التكلفة غير مدخلة — قيمة التعبئة غير محسوبة',
    ];
    return lines.join('\n');
  }
  // النواقص الحرجة: النافذ أولًا ثم الأشد عجزًا
  const out = rows.filter(r => r.qty <= 0);
  const low = rows.filter(r => r.qty > 0 && r.minq > 0 && r.qty <= r.minq)
    .sort((a, b) => (a.qty / a.minq) - (b.qty / b.minq));
  if (!out.length && !low.length) return 'لا توجد نواقص — المخزون كله فوق الحد ✓';
  const lines = [`🚨 النواقص الحرجة: نافذ ${out.length} • منخفض ${low.length}`];
  for (const r of out.slice(0, 8)) {
    const refill = r.minq > 0 ? ` (العجز ${fmtNum(r.minq)}${r.cost > 0 ? ` ≈ ${fmtNum(Math.round(r.minq * r.cost))} SAR` : ''})` : '';
    lines.push(`⛔ ${r.name}${refill}`);
  }
  for (const r of low.slice(0, 5)) lines.push(`⚠ ${r.name}: ${fmtNum(r.qty)}/${fmtNum(r.minq)} ${r.unit || ''}`);
  return lines.join('\n').slice(0, MAX_MSG);
}

/* ─── التقرير اليومي الشامل (عالمي المستوى) ─── */
async function buildDailyBriefing(dayStr) {
  const day = dayStr || riyadhToday();
  const L = [];
  L.push(`📊 التقرير اليومي الشامل — ${day} ${arabicDayName(day)}`);
  L.push('━━━━━━━━━━━━━━━');

  // 1) الحضور
  try {
    const a = (await withTimeout(pool.query(
      `SELECT COUNT(*) FILTER (WHERE "checkIn" IS NOT NULL)::int AS present,
              COUNT(*) FILTER (WHERE "checkIn" IS NOT NULL AND "checkOut" IS NULL)::int AS miss_out,
              COUNT(*) FILTER (WHERE "checkIn" IS NULL AND "checkOut" IS NOT NULL)::int AS miss_in,
              COUNT(*) FILTER (WHERE late)::int AS late_n
       FROM attendance WHERE date = $1`, [day]), DB_TIMEOUT, 'GENIUS')).rows[0];
    L.push(`👥 الحضور: حاضر ${a.present || 0} • نسي خروج ${a.miss_out || 0} • نسي دخول ${a.miss_in || 0} • متأخر ${a.late_n || 0}`);
  } catch (_) { L.push('👥 الحضور: تعذر الجلب'); }

  // 2) أكثر المتأخرين هذا الشهر
  try {
    const m = day.slice(0, 7);
    const t = (await withTimeout(pool.query(
      `SELECT e.name, COALESCE(SUM(CASE WHEN a."checkIn" IS NOT NULL THEN
         GREATEST(0, (SPLIT_PART(a."checkIn", ':', 1)::int * 60 + SPLIT_PART(a."checkIn", ':', 2)::int)
         - (SPLIT_PART(COALESCE(e.shift_start,'09:00'), ':', 1)::int * 60 + SPLIT_PART(COALESCE(e.shift_start,'09:00'), ':', 2)::int)) ELSE 0 END),0)::int AS mins
       FROM attendance a JOIN employees e ON e.id = a."employeeId"
       WHERE e.status = 'active' AND a.date LIKE $1 || '-%' AND NOT COALESCE(a.on_leave, false)
       GROUP BY e.name HAVING COALESCE(SUM(CASE WHEN a."checkIn" IS NOT NULL THEN
         GREATEST(0, (SPLIT_PART(a."checkIn", ':', 1)::int * 60 + SPLIT_PART(a."checkIn", ':', 2)::int)
         - (SPLIT_PART(COALESCE(e.shift_start,'09:00'), ':', 1)::int * 60 + SPLIT_PART(COALESCE(e.shift_start,'09:00'), ':', 2)::int)) ELSE 0 END),0) > 0
       ORDER BY 2 DESC LIMIT 5`, [m]), DB_TIMEOUT, 'GENIUS')).rows;
    if (t.length) {
      L.push('⏰ الأعلى تأخيرًا هذا الشهر:');
      t.forEach((r, i) => L.push(`${i + 1}. ${r.name}: ${fmtNum(r.mins)} د`));
    }
  } catch (_) {}

  // 3) المخزون الحرج
  try {
    const s = (await withTimeout(pool.query(
      `SELECT COUNT(*) FILTER (WHERE COALESCE(qty,0) <= 0)::int AS out,
              COUNT(*) FILTER (WHERE COALESCE(qty,0) > 0 AND COALESCE("minQty",0) > 0 AND COALESCE(qty,0) <= COALESCE("minQty",0))::int AS low,
              COALESCE(SUM(GREATEST(COALESCE("minQty",0) - COALESCE(qty,0), 0) * COALESCE("avgCost",0)),0)::float AS refill
       FROM inventory`), DB_TIMEOUT, 'GENIUS')).rows[0];
    L.push(`📦 المخزون: نافذ ${s.out} • منخفض ${s.low} • قيمة التعبئة ≈ ${fmtNum(Math.round(s.refill))} SAR`);
    const crit = (await withTimeout(pool.query(
      `SELECT name, unit FROM inventory WHERE COALESCE(qty,0) <= 0 ORDER BY id LIMIT 5`), DB_TIMEOUT, 'GENIUS')).rows;
    crit.forEach(r => L.push(`⛔ نافذ: ${r.name}`));
  } catch (_) { L.push('📦 المخزون: تعذر الجلب'); }

  // 4) الإيرادات
  try {
    const v = (await withTimeout(pool.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::float AS t FROM revenues WHERE date = $1 AND "deptId" != 'ys_b4_ext'`, [day]),
      DB_TIMEOUT, 'GENIUS')).rows[0];
    L.push(`💰 إيراد اليوم: ${fmtNum(Math.round(v.t))} SAR (${v.n} بند)`);
  } catch (_) {}

  // 5) الإجازات المعلقة
  try {
    const lv = (await withTimeout(pool.query(
      `SELECT COUNT(*)::int AS c FROM "leaveRequests" WHERE status = 'pending'`), DB_TIMEOUT, 'GENIUS')).rows[0];
    L.push(`🏖️ إجازات معلقة: ${lv.c}`);
  } catch (_) {}

  L.push(`🕐 وُلّد: ${new Intl.DateTimeFormat('ar-EG', { timeZone: 'Asia/Riyadh', dateStyle: 'short', timeStyle: 'short' }).format(new Date())}`);
  return L.join('\n').slice(0, MAX_MSG);
}

/* ─── الموجّه العبقري: نص → رد أو null ─── */
async function handleText(text, rec) {
  let t = norm(text);
  if (!t || t.length < 2) return null;
  // إسقاط بادئات الاستفهام/الطلب الشائعة (وش، كم، هات...) حتى 3 مرات
  for (let i = 0; i < 4; i++) {
    const nt = t.replace(/^(وش|وشو|ايش|ايش|وشهي|ما|ماذا|ماهي|كم|وين|فين|عطني|اعطني|هات|ابغي|ابي|ابغى|اريد|ممكن|لو سمحت|من فضلك|يا|اهلا|عليكم|السلام عليكم|سلام)\s+/, '').trim();
    if (nt === t) break;
    t = nt;
  }
  if (!t || t.length < 2) return null;
  const jid = rec && (rec.remoteJid || rec.jid);
  const senderPn = rec && (rec.senderPn || rec.sender || '');
  let manager = true;
  try { manager = await isManagerChat(jid, senderPn); } catch (_) { manager = false; }
  if (!manager) return null; // البيانات الحساسة للإدارة فقط — يرد المسار العادي بالاعتذار

  const has = (...words) => words.some(w => t.includes(w));

  // موظفين: قائمة، فلترة، متأخرين، غائبين، ملخص قسم/وردية — يجب أن يسبق استعلام فردي
  const empWord = has('موظف', 'مظفين', 'عامل', 'عمال', 'فريق', 'قسم', 'اقسام', 'الأقسام', 'الاقسام', 'الورديه', 'الوردية', 'الشيفت', 'الشفت', 'ورديه', 'مجموعه', 'متاخرين', 'متاخرين', 'غاابين', 'غائبين', 'غيبين');
  if (empWord) {
    // قائمة ورديات
    if (has('الورديه', 'الوردية', 'الشيفت', 'الشفت', 'ورديه', 'ورديه') && (has('كل', 'كل ال', 'قائمة', 'ليست', 'شنو', 'شو'))) {
      const shifts = await listShifts();
      return { text: `🕐 الورديات المتاحة:\n${shifts.map(s => `- ${s}`).join('\n') || '—'}`, source: 'genius' };
    }
    // قائمة أقسام
    if (has('القسم', 'الاقسام', 'الأقسام', 'اقسام', 'قسم', 'فروع', 'الاقسام', 'الاقسام') && (has('كل', 'كل ال', 'قائمة', 'ليست', 'شنو', 'شو'))) {
      const deps = await listDepartments();
      return { text: `🏢 الأقسام المتاحة:\n${deps.map(d => `- ${d}`).join('\n') || '—'}`, source: 'genius' };
    }
    // متأخرين اليوم / هذا الشهر (ملاحظة: بعد التطبيع "متأخرين" -> "متاخرين")
    if (has('متاخرين', 'متاخرين', 'متاخر', 'متاخر', 'تاخير', 'تاخر', 'متاخرين', 'متاخرين')) {
      const dm = t.match(/(\d{4}-\d{1,2}-\d{1,2})/);
      const month = t.match(/(\d{4}-\d{1,2})(?!-\d)/);
      const day = dm ? dm[1] : undefined;
      const mn = month ? month[1] : (has('الشهر', 'هذا الشهر') ? riyadhToday().slice(0, 7) : undefined);
      const rows = await lateEmployees({ date: day, month: mn, limit: 20 });
      if (!rows.length) return { text: day ? `لا متأخرين في ${day}` : mn ? `لا متأخرين في ${mn}` : 'لا متأخرين اليوم', source: 'genius' };
      const lines = [`⏰ متأخرين ${day ? day : mn ? `الشهر ${mn}` : 'اليوم'} (${rows.length}):`];
      for (const r of rows) {
        const lateM = r.checkIn ? calculateDelayParts({ checkIn: r.checkIn, checkOut: r.checkOut, late: r.late, workMinutes: r.workMinutes }, { shift_start: r.shift_start }) : { arrivalLateMinutes: 0 };
        lines.push(`- ${r.name} (${r.employeeId}) — دخل ${r.checkIn} (${lateM.arrivalLateMinutes || 0} د)`);
      }
      return { text: lines.join('\n').slice(0, MAX_MSG), source: 'genius' };
    }
    // غائبين اليوم (ملاحظة: بعد التطبيع "غائبين" -> "غاابين")
    if (has('غاابين', 'غائبين', 'غيبين', 'غياب', 'غايبه', 'منقط', 'منقطين') && (has('اليوم', 'الان', 'الأن', 'دلوقتي') || t.includes('غاي') || t.includes('غياب'))) {
      const dm = t.match(/(\d{4}-\d{1,2}-\d{1,2})/);
      const day = dm ? dm[1] : riyadhToday();
      const rows = await absentToday({ date: day, limit: 30 });
      if (!rows.length) return { text: `✅ كل الموظفين حاضرين ${day}`, source: 'genius' };
      const lines = [`🚫 غائبين ${day} (${rows.length}):`];
      for (const r of rows) lines.push(`- ${r.name} (${r.employeeId}) — ${r.department || ''} ${r.position || ''}`.trim());
      return { text: lines.join('\n').slice(0, MAX_MSG), source: 'genius' };
    }
    // فلترة موظفين: "موظفين قسم المطبخ" / "عمال وردية 04:00" / "شيفات قسم المشاوي"
    const depMatch = t.match(/(?:قسم|فريق|مجموعه)\s+([^\s]+(?:\s+[^\s]+)?)/);
    const posMatch = t.match(/(?:شيف|كاشير|كابتن|مساعد|عامل|طباخ|وايتس)\s*/);
    const shiftMatch = t.match(/(?:ورديه|شيفت|شفت)\s*(\d{1,2}:\d{2})/);
    const depRaw = depMatch ? depMatch[1].trim() : undefined;
    const pos = posMatch ? posMatch[0].trim() : undefined;
    const shift = shiftMatch ? shiftMatch[1] : undefined;
    const dep = mapDeptName(depRaw) || depRaw;
    if (dep || pos || shift) {
      const rows = await queryEmployees({ department: dep, position: pos, shiftStart: shift, limit: 30 });
      if (!rows.length) return { text: 'لا يوجد موظفون يطابقون الفلترة.', source: 'genius' };
      const title = [dep ? `قسم ${dep}` : '', pos ? `وظيفة ${pos}` : '', shift ? `وردي ${shift}` : ''].filter(Boolean).join(' • ') || 'الكل';
      const lines = [`👥 موظفون — ${title} (${rows.length}):`];
      for (const r of rows) lines.push(`- ${r.name} (${r.employeeId}) — ${r.shift_start || ''}${r.shift_karim ? ` (${r.shift_karim} س)` : ''} — ${r.department || ''} ${r.position || ''}`.trim());
      return { text: lines.join('\n').slice(0, MAX_MSG), source: 'genius' };
    }
    // ملخص قسم / وردية اليوم
    if (has('ملخص', 'تقرير', 'حالة') && (has('قسم', 'قسم', 'فريق') || has('ورديه', 'شيفت', 'شفت'))) {
      const dm = t.match(/(\d{4}-\d{1,2}-\d{1,2})/);
      const day = dm ? dm[1] : riyadhToday();
      const depRaw = depMatch ? depMatch[1].trim() : undefined;
      const dep = mapDeptName(depRaw) || depRaw;
      const shift = shiftMatch ? shiftMatch[1] : undefined;
      const rows = await departmentSummary({ department: dep, date: day });
      if (!rows.length) return { text: `لا بيانات لليوم ${day}`, source: 'genius' };
      const lines = [`📊 ملخص الحضور ${day} ${dep ? `— قسم ${dep}` : ''}:`];
      for (const r of rows) {
        lines.push(`${r.department}: حاضر ${r.present} • غايب ${r.absent} • نسي خروج ${r.miss_out} • متأخر ${r.late}`);
      }
      return { text: lines.join('\n'), source: 'genius' };
    }
  }

  // تقرير شامل
  if (has('تقرير', 'تقرير شامل', 'تقرير يومي', 'تقرير اليوم', 'الملخص اليومي', 'ملخص')) {
    const m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    const report = await buildDailyBriefing(m ? `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}` : undefined);
    try { await store.logEvent('genius_report', jid || '', t.slice(0, 60)); } catch (_) {}
    return { text: report, source: 'genius' };
  }

  // مخزون: نواقص أو صنف (ملاحظة: النص مطبّع — التاء مربوطة تصبح هاء)
  if (has('نواقص', 'ناقص', 'حرجه', 'حرجه', 'نافذ', 'out of stock') || /^(مخزون|مخزن)(\s|$)/.test(t)) {
    let q = t.replace(/^(المخزون|المخزن|مخزون|مخزن|النواقص|نواقص|الحرجه|حرجه)\s+/, '').trim();
    // إسقاط كلمات الحشو (lookahead حتى لا يأكل الفاصل المشترك بين كلمتين متتاليتين)
    q = q.replace(/(^|\s)(المخزون|المخزن|مخزون|مخزن|النواقص|نواقص|الحرجه|حرجه|كل|عرض|هات|ايه|ايش|ما|شو|وش|عندنا|عندكم|لدينا|عندي|في|من|اللي|التي|موجوده|موجود|موجودين|لي|لنا|الاصناف|الموجوده)(?=\s|$)/g, '').trim().replace(/\s+/g, ' ');
    if (!q) q = '';
    const ans = await inventoryAnswer(q);
    try { await store.logEvent('genius_stock', jid || '', q || 'critical'); } catch (_) {}
    return { text: ans, source: 'genius' };
  }

  // حضور موظف: "حضور X" / "دوام X" / "X بيجي امته" / "بصمة X" — صيغ المفرد فقط
  const attWord = has('حضور', 'دوام', 'بصمه', 'بصمات', 'يجي', 'يمشي', 'وصل', 'انصراف', 'غايب', 'غيب', 'حاضر', 'متاخر') && !has('متاخرين', 'متاخرين', 'غيبين', 'غيبين');
  if (attWord) {
    let q = t
      .replace(/^(حضور|دوام|بصمه|بصمات)\s+/, '')
      .replace(/\s+(حضور|دوام|بصمه|بصمات)$/, '')
      .replace(/(\d{4}-\d{1,2}-\d{1,2})|(\d{1,2}\/\d{1,2}(\/\d{2,4})?)/g, ' ')
      .replace(/(بيجي|بيمشي|يمشي|امته|امتى|متي|مته|وصل|الساعه|الساعة|كام|كم)\s*/g, ' ')
      .trim().replace(/\s+/g, ' ');
    const dm = t.match(/اخر\s*(\d{1,2})\s*(يوم|ايام)/);
    const days = dm ? Math.min(14, Math.max(1, Number(dm[1]))) : 5;
    if (dm) q = q.replace(dm[0], ' ').trim().replace(/\s+/g, ' ');
    if (!q) return { text: 'اكتب: حضور <اسم الموظف> — مثال: حضور أحمد', source: 'genius' };
    const hits = await findEmployees(q);
    if (!hits.length) return { text: `لا يوجد موظف نشط باسم «${esc(q)}».`, source: 'genius' };
    if (hits.length > 1) {
      return { text: 'أكثر من موظف يطابق — حدد بالكود:\n' + hits.map(e => `- ${e.name} (${e.employeeId})`).join('\n'), source: 'genius' };
    }
    const ans = await attendanceDetail(hits[0].id, days);
    try { await store.logEvent('genius_attendance', jid || '', hits[0].name); } catch (_) {}
    return { text: ans, source: 'genius' };
  }

  return null;
}

/* ─── الإرسال المجدول: اليومي + الشهري ─── */
let _briefTimer = null;
let _monthlyTimer = null;
let _briefRunning = false;

function briefTime() {
  const s = String(process.env.WHATSAPP_BRIEF_TIME || '08:00').trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { h: 8, min: 0 };
  return { h: Math.min(23, Math.max(0, Number(m[1]))), min: Math.min(59, Math.max(0, Number(m[2]))) };
}

function monthlyTime() {
  const s = String(process.env.WHATSAPP_MONTHLY_BRIEF_TIME || '06:00').trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { h: 6, min: 0 };
  return { h: Math.min(23, Math.max(0, Number(m[1]))), min: Math.min(59, Math.max(0, Number(m[2]))) };
}

function riyadhHM() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date());
  const o = {};
  for (const x of p) o[x.type] = x.value;
  return { h: Number(o.hour), min: Number(o.minute) };
}

function riyadhDay() {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit' }).format(new Date()));
}

async function sendDailyBriefing(engine) {
  const today = riyadhToday();
  const targets = [];
  try {
    const envJids = managerJids().map(n => `${n}@s.whatsapp.net`);
    targets.push(...envJids);
  } catch (_) {}
  try {
    const dbJids = await store.managerJids();
    for (const n of dbJids || []) {
      const j = String(n).includes('@') ? String(n) : `${String(n).replace(/\D/g, '')}@s.whatsapp.net`;
      if (!targets.includes(j)) targets.push(j);
    }
  } catch (_) {}
  if (!targets.length) {
    logger.warn('[GENIUS] no manager JIDs — daily briefing skipped (set WHATSAPP_MANAGER_JIDS)');
    return { sent: 0, reason: 'no-managers' };
  }
  // منع التكرار اليومي
  try {
    const seen = await pool.query(
      `SELECT 1 FROM wa_events WHERE kind = 'genius_briefing_sent' AND ref = $1 LIMIT 1`, [today]);
    if (seen.rows.length) return { sent: 0, reason: 'already-sent' };
  } catch (_) {}
  const text = await buildDailyBriefing(today);
  let sent = 0;
  for (const jid of targets) {
    try {
      await engine.sender.enqueue(jid, text, { clientKey: `genius-brief:${today}:${jid}` });
      sent++;
    } catch (e) { logger.warn('[GENIUS] briefing send failed: ' + String(e.message).slice(0, 120)); }
  }
  try { await store.logEvent('genius_briefing_sent', today, `sent=${sent}`); } catch (_) {}
  try { engine.sender?.kick?.(); } catch (_) {}
  return { sent };
}

async function sendMonthlyBriefing(engine) {
  const today = riyadhToday();
  const targets = [];
  try {
    const envJids = managerJids().map(n => `${n}@s.whatsapp.net`);
    targets.push(...envJids);
  } catch (_) {}
  try {
    const dbJids = await store.managerJids();
    for (const n of dbJids || []) {
      const j = String(n).includes('@') ? String(n) : `${String(n).replace(/\D/g, '')}@s.whatsapp.net`;
      if (!targets.includes(j)) targets.push(j);
    }
  } catch (_) {}
  if (!targets.length) return { sent: 0, reason: 'no-managers' };
  // منع التكرار الشهري (مرة واحدة يوم 1)
  try {
    const seen = await pool.query(
      `SELECT 1 FROM wa_events WHERE kind = 'genius_monthly_sent' AND ref = $1 LIMIT 1`, [today.slice(0, 7)]);
    if (seen.rows.length) return { sent: 0, reason: 'already-sent' };
  } catch (_) {}
  const text = await buildMonthlyBriefing(today);
  let sent = 0;
  for (const jid of targets) {
    try {
      await engine.sender.enqueue(jid, text, { clientKey: `genius-monthly:${today.slice(0, 7)}:${jid}` });
      sent++;
    } catch (e) { logger.warn('[GENIUS] monthly send failed: ' + String(e.message).slice(0, 120)); }
  }
  try { await store.logEvent('genius_monthly_sent', today.slice(0, 7), `sent=${sent}`); } catch (_) {}
  try { engine.sender?.kick?.(); } catch (_) {}
  return { sent };
}

async function buildMonthlyBriefing(dayStr) {
  const m = dayStr.slice(0, 7);
  const L = [];
  L.push(`📈 التقرير الشهري الشامل — ${m}`);
  L.push('━━━━━━━━━━━━━━━');
  try {
    const a = (await withTimeout(pool.query(
      `SELECT COUNT(DISTINCT "employeeId")::int AS emp,
              COUNT(*) FILTER (WHERE "checkIn" IS NOT NULL)::int AS present,
              COUNT(*) FILTER (WHERE "checkIn" IS NOT NULL AND "checkOut" IS NULL)::int AS miss_out,
              COUNT(*) FILTER (WHERE "checkIn" IS NULL AND "checkOut" IS NOT NULL)::int AS miss_in,
              COUNT(*) FILTER (WHERE late)::int AS late_n
       FROM attendance WHERE date LIKE $1 || '-%'`, [m]), DB_TIMEOUT, 'GENIUS')).rows[0];
    L.push(`👥 الحضور: موظفين ${a.emp || 0} • أيام حضور ${a.present || 0} • نسي خروج ${a.miss_out || 0} • نسي دخول ${a.miss_in || 0} • متأخر ${a.late_n || 0}`);
  } catch (_) { L.push('👥 الحضور: تعذر الجلب'); }
  try {
    const t = (await withTimeout(pool.query(
      `SELECT e.name, COALESCE(SUM(CASE WHEN a."checkIn" IS NOT NULL THEN
         GREATEST(0, (SPLIT_PART(a."checkIn", ':', 1)::int * 60 + SPLIT_PART(a."checkIn", ':', 2)::int)
         - (SPLIT_PART(COALESCE(e.shift_start,'09:00'), ':', 1)::int * 60 + SPLIT_PART(COALESCE(e.shift_start,'09:00'), ':', 2)::int)) ELSE 0 END),0)::int AS mins
       FROM attendance a JOIN employees e ON e.id = a."employeeId"
       WHERE e.status = 'active' AND a.date LIKE $1 || '-%' AND NOT COALESCE(a.on_leave, false)
       GROUP BY e.name HAVING COALESCE(SUM(CASE WHEN a."checkIn" IS NOT NULL THEN
         GREATEST(0, (SPLIT_PART(a."checkIn", ':', 1)::int * 60 + SPLIT_PART(a."checkIn", ':', 2)::int)
         - (SPLIT_PART(COALESCE(e.shift_start,'09:00'), ':', 1)::int * 60 + SPLIT_PART(COALESCE(e.shift_start,'09:00'), ':', 2)::int)) ELSE 0 END),0) > 0
       ORDER BY 2 DESC LIMIT 10`, [m]), DB_TIMEOUT, 'GENIUS')).rows;
    if (t.length) {
      L.push('⏰ الأعلى تأخيرًا هذا الشهر:');
      t.forEach((r, i) => L.push(`${i + 1}. ${r.name}: ${fmtNum(r.mins)} د`));
    }
  } catch (_) {}
  try {
    const s = (await withTimeout(pool.query(
      `SELECT COUNT(*) FILTER (WHERE COALESCE(qty,0) <= 0)::int AS out,
              COUNT(*) FILTER (WHERE COALESCE(qty,0) > 0 AND COALESCE("minQty",0) > 0 AND COALESCE(qty,0) <= COALESCE("minQty",0))::int AS low,
              COALESCE(SUM(GREATEST(COALESCE("minQty",0) - COALESCE(qty,0), 0) * COALESCE("avgCost",0)),0)::float AS refill
       FROM inventory`), DB_TIMEOUT, 'GENIUS')).rows[0];
    L.push(`📦 المخزون: نافذ ${s.out} • منخفض ${s.low} • قيمة التعبئة ≈ ${fmtNum(Math.round(s.refill))} SAR`);
  } catch (_) { L.push('📦 المخزون: تعذر الجلب'); }
  try {
    const v = (await withTimeout(pool.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::float AS t FROM revenues WHERE date LIKE $1 || '-%' AND "deptId" != 'ys_b4_ext'`, [m]),
      DB_TIMEOUT, 'GENIUS')).rows[0];
    L.push(`💰 إيراد الشهر: ${fmtNum(Math.round(v.t))} SAR (${v.n} بند)`);
  } catch (_) {}
  try {
    const lv = (await withTimeout(pool.query(
      `SELECT COUNT(*)::int AS c FROM "leaveRequests" WHERE status = 'pending'`), DB_TIMEOUT, 'GENIUS')).rows[0];
    L.push(`🏖️ إجازات معلقة: ${lv.c}`);
  } catch (_) {}
  L.push(`🕐 وُلّد: ${new Intl.DateTimeFormat('ar-EG', { timeZone: 'Asia/Riyadh', dateStyle: 'short', timeStyle: 'short' }).format(new Date())}`);
  return L.join('\n').slice(0, MAX_MSG);
}

function startDailyBriefing(engine) {
  if (_briefTimer) return;
  if (String(process.env.WHATSAPP_DAILY_BRIEFING || 'on').trim().toLowerCase() === 'off') {
    logger.info('[GENIUS] daily briefing OFF (WHATSAPP_DAILY_BRIEFING=off)');
    return;
  }
  const { h, min } = briefTime();
  logger.info(`[GENIUS] daily briefing scheduled at ${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')} Riyadh`);
  _briefTimer = setInterval(async () => {
    if (_briefRunning) return;
    try {
      if (!engine?.connection?.isConnected?.()) return;
      const now = riyadhHM();
      if (now.h === h && now.min >= min && now.min < min + 2) {
        _briefRunning = true;
        try { await sendDailyBriefing(engine); }
        finally { _briefRunning = false; }
      }
    } catch (e) { logger.warn('[GENIUS] briefing tick: ' + String(e.message).slice(0, 120)); }
  }, 60000);
  if (_briefTimer.unref) _briefTimer.unref();
}

function startMonthlyBriefing(engine) {
  if (_monthlyTimer) return;
  if (String(process.env.WHATSAPP_MONTHLY_BRIEFING || 'on').trim().toLowerCase() === 'off') {
    logger.info('[GENIUS] monthly briefing OFF (WHATSAPP_MONTHLY_BRIEFING=off)');
    return;
  }
  const { h, min } = monthlyTime();
  logger.info(`[GENIUS] monthly briefing scheduled on day 1 at ${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')} Riyadh`);
  _monthlyTimer = setInterval(async () => {
    if (_briefRunning) return;
    try {
      if (!engine?.connection?.isConnected?.()) return;
      const day = riyadhDay();
      if (day !== 1) return;
      const now = riyadhHM();
      if (now.h === h && now.min >= min && now.min < min + 2) {
        _briefRunning = true;
        try { await sendMonthlyBriefing(engine); }
        finally { _briefRunning = false; }
      }
    } catch (e) { logger.warn('[GENIUS] monthly tick: ' + String(e.message).slice(0, 120)); }
  }, 60000);
  if (_monthlyTimer.unref) _monthlyTimer.unref();
}

function stopDailyBriefing() {
  if (_briefTimer) { clearInterval(_briefTimer); _briefTimer = null; }
}

function stopMonthlyBriefing() {
  if (_monthlyTimer) { clearInterval(_monthlyTimer); _monthlyTimer = null; }
}

module.exports = {
  handleText, attendanceDetail, inventoryAnswer, buildDailyBriefing, buildMonthlyBriefing,
  sendDailyBriefing, sendMonthlyBriefing, startDailyBriefing, startMonthlyBriefing,
  stopDailyBriefing, stopMonthlyBriefing, findEmployees, norm,
  queryEmployees, lateEmployees, absentToday, departmentSummary, listShifts, listDepartments,
};
