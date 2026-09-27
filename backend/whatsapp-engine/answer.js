/**
 * whatsapp-engine/answer.js — الموجّه الحر: إجابة حية على أي سؤال من السيستم
 * ────────────────────────────────────────────────────────────────────────────
 * - يعمل عند عدم مطابقة أي قاعدة ثابتة (fallback) — يفهم الصياغات الحرة.
 * - كل الإجابات من قاعدة البيانات لحظة السؤال (بلا كاش) + مهلة لكل استعلام.
 * - قراءة فقط (SELECT) — لا أوامر حرة من الشات، والبيانات الحساسة للإدارة فقط.
 * - أي عطل = رد لطيف، لا إسقاط للمحرك.
 */
'use strict';

const { logger } = require('../logger');
const { pool } = require('../shared-pool');
const store = require('./store');
const erp = require('./erp');
const { normalizeText } = require('./rules');
const gemini = require('./ai/gemini');

function norm(s) {
    return normalizeText(s).replace(/\s+/g, ' ').trim();
}
function riyadhDay(offsetDays = 0) {
    const d = new Date(Date.now() + offsetDays * 86400000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function fnum(n) { return Number(n || 0).toLocaleString('en-US'); }
function stripKw(t, ...kws) {
    let s = ` ${t} `;
    for (const k of kws) {s = s.split(k).join(' ');}
    return s.replace(/\s+/g, ' ').trim().slice(0, 60);
}
const DENY = 'عذرًا — هذه البيانات متاحة لرقم الإدارة فقط.';

function helpText() {
    return [
        'أوامر الواتساب — اسأل بصياغتك (الرد لحظي من قاعدة البيانات):',
        '• تقرير — موجز يومي شامل (مبيعات/مصاريف/صافي/مخزن/حضور/معلقات/أسبوع)',
        '• إيرادات اليوم / إيرادات أمس / إيرادات هذا الأسبوع / إيرادات هذا الشهر',
        '• إيرادات 20/09/2026 / إيرادات من 01/09 إلى 20/09 / إيرادات كاشير 4 اليوم',
        '• حضور أحمد اليوم / حضور كريم أمس / حضور الموظف 125 بتاريخ 20/09/2026',
        '• دخول وخروج أحمد اليوم / دخول كريم أمس / مين حضر اليوم؟ / مين ما حضرش اليوم؟',
        '• ملخص الحضور اليوم / كل الحضور / انصراف اليوم / مواعيد الموظفين اليوم',
        '• مصاريف اليوم / مصاريف أمس / مصاريف هذا الشهر / أكبر بنود المصروفات',
        '• مبيعات اليوم / إيراد أمس / تقفيل [كاشير N] [أمس] / كاشير 4 أمس',
        '• الكاشيرية — لوحة حية مرتبة لكل كاشير / كاشير 4 / كاشير 9 أمس',
        '• البصمة — حالة الجهاز ومزامنة اليوم / المزامنة — سحب يارا سوفت',
        '• مخزون <صنف> — رصيده وتكلفته وقيمته وحالته / المنتجات / نواقص',
        '• المخزن — الصورة الكاملة: كل النافذ والمنخفض والقيم',
        '• المخازن — ملخص كل مستودع: كم صنف ونافذ/منخفض/قيمة',
        '• موظف <الاسم/الرقم/البصمة> — كل تفاصيل الموظف + بصمته + أيام مداومته وساعاته',
        '• موظفين / رواتب / إجازات / وثائق / غياب اليوم / متأخرون اليوم',
        '• ابحث <اسم> — بحث سريع بالاسم',
        '• الموظفون مفصل — كل موظف: بصمته ورقمه وحضوره وانصرافه وقسمه',
        '• مشتريات / مديونية <مورد> / الموردين — أكبر المديونيات',
        '• أقسام — أداء كل قسم اليوم / أقسام معلقة — البانتظار',
        '• اعتماد قسم <رقم> — تنفيذ الاعتماد من الشات (بخطوتي تأكيد)',
        '• المطبخ — دفعات إنتاج اليوم وتوزيعها',
        '• حالة النظام / حالة السيرفر / حالة الواتساب',
        '• ورديات — المفتوحة الآن بكل التفاصيل',
        '• سعر <صنف> / حالة طلب <رقم>',
    ].join('\n');
}

async function systemHealthAnswer(engine, rec) {
    const started = Date.now();
    try {
        await erp.withTimeout(pool.query('SELECT 1'), 3000, 'DB');
        const queue = await store.metrics();
        const wa = engine?.connection?.status ? engine.connection.status() : { state: 'UNKNOWN' };
        try { await store.logEvent('system_health', rec.remoteJid, `db:${Date.now() - started}ms wa:${wa.state}`); } catch (_) {}
        return [
            'حالة النظام الآن',
            `قاعدة البيانات: ✅ متصلة (${Date.now() - started}ms)`,
            `السيرفر: ✅ يعمل`,
            `واتساب: ${wa.state === 'CONNECTED' ? '✅ متصل' : '⚠ ' + wa.state}`,
            `الوارد المعلق: ${queue.inbox_pending || 0}`,
            `الصادر المستحق: ${queue.outbox_due || 0}`,
            `الصادر الميت بعد المحاولات: ${queue.outbox_dead || 0}`,
            `آخر اتصال واتساب: ${wa.lastOkAt || '—'}`,
        ].join('\n');
    } catch (e) {
        return 'حالة النظام: ⚠ تعذر قراءة كل المكونات الآن — قاعدة البيانات أو أحد المحركات لا يستجيب.';
    }
}

/** مشتريات: آخر الفواتير + إجمالي الشهر + مديونية مورد */
async function purchasesAnswer(cfg, args, rec) {
    const nameQ = norm(args);
    if (nameQ) {
        const sups = (await erp.withTimeout(pool.query(`SELECT id, name FROM suppliers WHERE is_active = true`), cfg.erpTimeoutMs, 'ERP')).rows;
        const hits = sups.filter((s) => { const n = norm(s.name); return n && (n.includes(nameQ) || nameQ.includes(n)); }).slice(0, 5);
        if (!hits.length) {return `لا يوجد مورد باسم «${args.trim()}».`;}
        if (hits.length > 1) {return 'موردين يطابقون — حدد:\n' + hits.map((s) => `- ${s.name}`).join('\n');}
        const s = hits[0];
        const inv = (await erp.withTimeout(pool.query(
            `SELECT COALESCE(SUM("totalAmount"),0)::float AS tot, COUNT(*)::int AS n FROM "purchaseInvoices" WHERE "supplierId" = $1`, [s.id]),
            cfg.erpTimeoutMs, 'ERP')).rows[0];
        const pay = (await erp.withTimeout(pool.query(
            `SELECT COALESCE(SUM(amount),0)::float AS paid FROM supplier_payments WHERE "supplierId" = $1`, [s.id]),
            cfg.erpTimeoutMs, 'ERP')).rows[0];
        const debt = Number(inv.tot || 0) - Number(pay.paid || 0);
        try { await store.logEvent('erp_command', rec.remoteJid, `supplier_debt:${s.name}`); } catch (_) {}
        return [`مورد: ${s.name}`, `فواتير: ${fnum(inv.n)} بإجمالي ${fnum(inv.tot)}`, `مدفوع: ${fnum(pay.paid)}`, `المتبقي عليه: ${fnum(debt)}`].join('\n');
    }
    const last = (await erp.withTimeout(pool.query(
        `SELECT "invoiceNumber", date, "supplierName", "totalAmount", "paymentStatus" FROM "purchaseInvoices" ORDER BY id DESC LIMIT 5`),
        cfg.erpTimeoutMs, 'ERP')).rows;
    const month = riyadhDay().slice(0, 7);
    const agg = (await erp.withTimeout(pool.query(
        `SELECT COUNT(*)::int AS n, COALESCE(SUM("totalAmount"),0)::float AS tot,
                COALESCE(SUM(CASE WHEN "paymentStatus" <> 'paid' THEN "totalAmount" - COALESCE("paidAmount",0) ELSE 0 END),0)::float AS unpaid
           FROM "purchaseInvoices" WHERE LEFT(date,7) = $1`, [month]), cfg.erpTimeoutMs, 'ERP')).rows[0];
    try { await store.logEvent('erp_command', rec.remoteJid, 'purchases'); } catch (_) {}
    const lines = [`مشتريات شهر ${month}: ${fnum(agg.n)} فاتورة = ${fnum(agg.tot)} (غير مدفوع: ${fnum(agg.unpaid)})`, 'آخر الفواتير:'];
    for (const r of last) {lines.push(`- ${r.invoiceNumber || '#'}: ${r.supplierName || '—'} = ${fnum(r.totalAmount)} [${r.paymentStatus || '?'}]`);}
    if (!last.length) {lines.push('لا فواتير مسجلة.');}
    return lines.join('\n').slice(0, 3500);
}

/** مصاريف يوم (اليوم/أمس) + أكبر البنود */
async function expensesAnswer(cfg, t, rec) {
    const day = /امس|أمس/.test(t) ? riyadhDay(-1) : riyadhDay();
    const tot = (await erp.withTimeout(pool.query(
        `SELECT COALESCE(SUM(amount),0)::float AS tot, COUNT(*)::int AS n FROM expenses WHERE date = $1`, [day]),
        cfg.erpTimeoutMs, 'ERP')).rows[0];
    const top = (await erp.withTimeout(pool.query(
        `SELECT COALESCE(category,'—') AS cat, COALESCE("desc",'') AS d, amount FROM expenses WHERE date = $1 ORDER BY amount DESC LIMIT 5`, [day]),
        cfg.erpTimeoutMs, 'ERP')).rows;
    try { await store.logEvent('erp_command', rec.remoteJid, `expenses:${day}`); } catch (_) {}
    const lines = [`مصاريف ${day}: ${fnum(tot.tot)} (${fnum(tot.n)} بند)`];
    for (const r of top) {lines.push(`- ${r.cat}: ${fnum(r.amount)}${r.d ? ' — ' + String(r.d).slice(0, 50) : ''}`);}
    if (!top.length) {lines.push('لا مصاريف مسجلة.');}
    return lines.join('\n').slice(0, 3500);
}

/** الكاشيرية لايف نصًا: «الكاشيرية» / «كاشير 4» / «كاشير 9 أمس» — من إيرادات اليوم الحي */
async function cashiersLiveAnswer(cfg, t, rec) {
    const day = /امس|أمس/.test(t) ? riyadhDay(-1) : riyadhDay();
    const prev = riyadhDay(day === riyadhDay() ? -1 : -2);
    const num = (t.match(/كاشير\s*(\d{1,2})/) || [])[1] || '';
    const maps = (await erp.withTimeout(pool.query(
        `SELECT src_name AS no, dept_code, display_ar FROM yarasoft_revenue_map
          WHERE src_table='CC' AND active=true ORDER BY src_name`), cfg.erpTimeoutMs, 'ERP')).rows;
    if (num && !maps.some((m) => String(m.no) === num)) {
        return `لا يوجد كاشير ${num} مسجل. الكاشيرات: ${maps.map((m) => m.no).join('، ')}.`;
    }
    const rows = (await erp.withTimeout(pool.query(
        `SELECT payload->>'sectionName' AS no, payload->>'date' AS day, COUNT(*)::int AS n,
                COALESCE(SUM((payload->>'total')::numeric),0)::float AS tot
           FROM (SELECT DISTINCT ON (external_invoice_number) *
                   FROM invoice_import_log
                  WHERE status IN ('COMPLETED', 'DUPLICATE')
                    AND payload->>'srcTable' = 'CC'
                    AND payload->>'date' IN ($1,$2)
                  ORDER BY external_invoice_number,
                           CASE status WHEN 'COMPLETED' THEN 0 ELSE 1 END) d
          GROUP BY 1,2`, [day, prev]),
        cfg.erpTimeoutMs, 'ERP')).rows;
    const byNo = new Map(rows.map((r) => [`${r.no}|${r.day}`, r]));
    const wanted = num ? maps.filter((m) => String(m.no) === num) : maps;
    try { await store.logEvent('erp_command', rec.remoteJid, `cashiers_live:${day}:${num || 'all'}`); } catch (_) {}
    const lines = [`🧾 الكاشيرية — ${day}`];
    let tot = 0, tn = 0;
    const cards = [];
    for (const m of wanted) {
        const a = byNo.get(`${m.no}|${day}`) || { n: 0, tot: 0 };
        const b = byNo.get(`${m.no}|${prev}`) || { n: 0, tot: 0 };
        const draw = Number(b.tot) > 0 ? (((Number(a.tot) - Number(b.tot)) / Number(b.tot)) * 100) : 0;
        const d = Number(b.tot) > 0 ? Math.round(draw * 10) / 10 : null;
        tot += Number(a.tot); tn += Number(a.n);
        cards.push({ name: m.display_ar, a, b, d });
    }
    cards.sort((x, y) => Number(y.a.tot) - Number(x.a.tot));
    cards.forEach((c, i) => {
        const tag = c.d === null ? '• جديد' : ` ${Number(c.d) >= 0 ? '▲' : '▼'}${fnum(Math.abs(c.d))}% عن ${prev}`;
        lines.push(`${i < 3 ? ['🥇', '🥈', '🥉'][i] + ' ' : ''}${c.name}: ${fnum(Math.round(Number(c.a.tot)))} (${fnum(c.a.n)} فاتورة)${tag}`);
    });
    lines.push(`الإجمالي: ${fnum(Math.round(tot))} (${fnum(tn)} فاتورة)`);
    return lines.join('\n').slice(0, 3800);
}

/** حالة جهاز البصمة والمزامنة اليوم */
async function zkStatusAnswer(cfg, rec) {
    const devs = (await erp.withTimeout(pool.query(
        `SELECT name, "ipAddress", status, enabled, "totalSynced", "lastSyncAt", "lastError" FROM attendance_devices ORDER BY id`),
        cfg.erpTimeoutMs, 'ERP')).rows;
    const day = riyadhDay();
    const agg = (await erp.withTimeout(pool.query(
        `SELECT COUNT(*)::int AS logs, COUNT(*) FILTER (WHERE "employeeId" IS NULL)::int AS unmapped
           FROM attendance_logs WHERE "attendanceTime" >= $1::date`, [day]), cfg.erpTimeoutMs, 'ERP')).rows[0];
    const att = (await erp.withTimeout(pool.query(
        `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE "checkIn" IS NOT NULL)::int AS pin
           FROM attendance WHERE date = $1`, [day]), cfg.erpTimeoutMs, 'ERP')).rows[0];
    try { await store.logEvent('erp_command', rec.remoteJid, 'zk_status'); } catch (_) {}
    const lines = [`🖐 البصمة — ${day}`];
    if (!devs.length) {lines.push('لا أجهزة مسجلة.');}
    for (const d of devs.slice(0, 5)) {
        const st = !d.enabled ? '⏸ متوقف' : d.status === 'online' ? '🟢 متصل' : d.status === 'syncing' ? '🔄 يزامن' : '🔴 غير متصل';
        lines.push(`- ${d.name} (${d.ipAddress}): ${st} — مخزن ${fnum(d.totalSynced || 0)}${d.lastError ? ` — ⚠ ${String(d.lastError).slice(0, 60)}` : ''}`);
    }
    lines.push(`بصمات اليوم: ${fnum(agg.logs)} (غير مرتبطة: ${fnum(agg.unmapped)}) — حضور: ${fnum(att.pin)}/${fnum(att.n)}`);
    return lines.join('\n').slice(0, 3800);
}

/** حالة سحب يارا سوفت من Oracle والترحيل */
async function ysStatusAnswer(cfg, rec) {
    let eng = { running: null, lastOk: null, lastError: '' };
    try { eng = require('../yarasoft/oracle-link').oracleEngine.status(); } catch (_) {}
    const log = (await erp.withTimeout(pool.query(
        `SELECT status, COUNT(*)::int AS n FROM invoice_import_log
          WHERE updated_at >= CURRENT_DATE - INTERVAL '1 day' GROUP BY 1`), cfg.erpTimeoutMs, 'ERP')).rows;
    const by = Object.fromEntries(log.map((r) => [r.status, r.n]));
    const stuck = (await erp.withTimeout(pool.query(
        `SELECT COUNT(*)::int AS c FROM yarasoft_unmapped_sections WHERE resolved = false`), cfg.erpTimeoutMs, 'ERP')).rows[0].c;
    try { await store.logEvent('erp_command', rec.remoteJid, 'ys_status'); } catch (_) {}
    const lines = ['🔄 يارا سوفت — المزامنة'];
    lines.push(`المحرك: ${eng.running ? '🟢 يعمل' : '⚪ متوقف'} — آخر سحب ناجح: ${eng.lastOk ? String(eng.lastOk).slice(11, 16) : '—'}${eng.lastError ? ` — ⚠ ${String(eng.lastError).slice(0, 80)}` : ''}`);
    lines.push(`آخر 24 ساعة: مرحّل ${fnum(by.COMPLETED || 0)} | مكرر ${fnum(by.DUPLICATE || 0)} | عالق ${fnum((by.NEEDS_MAPPING || 0) + (by.FAILED || 0) + (by.PROCESSING || 0))}`);
    lines.push(`أقسام تنتظر اعتماد: ${fnum(stuck)}${Number(stuck) ? ' — اعتمدها من صفحة يارا سوفت' : ' ✓'}`);
    return lines.join('\n').slice(0, 3800);
}

/** الورديات المفتوحة الآن */
async function shiftsAnswer(cfg, rec) {
    const rows = (await erp.withTimeout(pool.query(
        `SELECT s.id, s.opened_at, COALESCE(u.username, u.name, s.cashier_id::text) AS cashier,
                COALESCE(pd.name_ar, pd.code, s.department_id::text) AS dept, s.opening_balance
           FROM pos_shift_sessions s
           LEFT JOIN users u ON u.id = s.cashier_id
           LEFT JOIN pos_departments pd ON pd.id = s.department_id
          WHERE s.status = 'open' ORDER BY s.opened_at DESC LIMIT 10`), cfg.erpTimeoutMs, 'ERP')).rows;
    try { await store.logEvent('erp_command', rec.remoteJid, 'shifts'); } catch (_) {}
    if (!rows.length) {return 'لا توجد ورديات مفتوحة الآن ✓';}
    const lines = [`ورديات مفتوحة (${rows.length}):`];
    for (const r of rows) {lines.push(`- ${r.dept} | ${r.cashier} | من ${String(r.opened_at || '').slice(0, 16).replace('T', ' ')} | افتتاحية ${fnum(r.opening_balance)}`);}
    return lines.join('\n').slice(0, 3500);
}

/** سعر صنف منيو بالاسم أو الباركود */
async function priceAnswer(cfg, args, rec) {
    const q = norm(args);
    if (!q) {return 'اكتب: سعر <اسم الصنف> — مثال: سعر شاورما';}
    const rows = (await erp.withTimeout(pool.query(
        `SELECT name_ar, name_en, barcode, price, unit FROM pos_products WHERE is_active = true ORDER BY id LIMIT 3000`),
        cfg.erpTimeoutMs, 'ERP')).rows;
    const digits = q.replace(/\D/g, '');
    const hits = rows.filter((r) => {
        const n = norm(`${r.name_ar || ''} ${r.name_en || ''}`);
        if (digits && String(r.barcode || '').includes(digits)) {return true;}
        return n && (n.includes(q) || q.includes(n));
    }).slice(0, 6);
    if (!hits.length) {return `لا يوجد صنف منيو باسم «${args.trim()}».`;}
    if (hits.length > 1) {return 'أصناف تطابق — حدد:\n' + hits.map((r) => `- ${r.name_ar || r.name_en}: ${fnum(r.price)}`).join('\n').slice(0, 1500);}
    const r = hits[0];
    try { await store.logEvent('erp_command', rec.remoteJid, `price:${r.name_ar || r.name_en}`); } catch (_) {}
    return `${r.name_ar || r.name_en}\nالسعر: ${fnum(r.price)}${r.unit ? ' / ' + r.unit : ''}`;
}

/** تفاصيل موظف واحد بالاسم/الرقم/البصمة — حضوره وانصرافه وأيامه */
async function employeeDetailAnswer(cfg, nameQ, rec) {
    const q = norm(nameQ);
    if (!q) {return 'اكتب: موظف <الاسم أو رقم البصمة> — مثال: موظف أحمد أو بصمة 45';}
    const emps = (await erp.withTimeout(pool.query(
        `SELECT id, name, "employeeId" AS empNo, "deviceUserId" AS fp, department, position, phone, status FROM employees WHERE status='active' ORDER BY id LIMIT 600`),
        cfg.erpTimeoutMs, 'ERP')).rows;
    const digits = q.replace(/\D/g, '');
    let hits = [];
    if (digits && digits.length >= 2) {
        hits = emps.filter(e => String(e.fp || '') === digits || String(e.empNo || '') === digits);
    }
    if (!hits.length) {
        hits = emps.filter(e => { const n = norm(e.name); return n && (n.includes(q) || q.includes(n)); });
    }
    hits = hits.slice(0, 6);
    if (!hits.length) {return `لا يوجد موظف باسم أو بصمة «${nameQ.trim()}».`;}
    if (hits.length > 1) {return 'أكثر من موظف يطابق — حدد:\n' + hits.map(e => `- ${e.name} [بصمة:${e.fp || '—'}]`).join('\n');}
    const emp = hits[0];
    const today = riyadhDay();
    const monthStart = today.slice(0, 7) + '-01';
    const r = (await erp.withTimeout(pool.query(
        `SELECT COUNT(*)::int AS days, COUNT(*) FILTER (WHERE "checkIn" IS NOT NULL)::int AS present,
                COUNT(*) FILTER (WHERE "checkIn" IS NOT NULL AND "checkOut" IS NULL)::int AS miss_out,
                COUNT(*) FILTER (WHERE "checkIn" IS NULL AND "checkOut" IS NOT NULL)::int AS miss_in,
                COUNT(*) FILTER (WHERE late)::int AS late, COALESCE(SUM("workMinutes"),0)::int AS mins,
                COALESCE(SUM(
                    CASE 
                        WHEN late AND "checkIn" IS NOT NULL AND e.shift_start IS NOT NULL
                        THEN GREATEST(0, (split_part(a."checkIn", ':', 1)::int * 60 + split_part(a."checkIn", ':', 2)::int) - (split_part(e.shift_start, ':', 1)::int * 60 + split_part(e.shift_start, ':', 2)::int))
                        ELSE 0
                    END
                ), 0)::int AS total_late_minutes
           FROM attendance a JOIN employees e ON e.id = a."employeeId"
           WHERE a."employeeId"=$1 AND a.date >= $2 AND a.date <= $3`, [emp.id, monthStart, today]), cfg.erpTimeoutMs, 'ERP')).rows[0];
    const last = (await erp.withTimeout(pool.query(
        `SELECT a.date, a."checkIn", a."checkOut", a."workMinutes", a.late,
                CASE 
                    WHEN a.late AND a."checkIn" IS NOT NULL AND e.shift_start IS NOT NULL
                    THEN GREATEST(0, (split_part(a."checkIn", ':', 1)::int * 60 + split_part(a."checkIn", ':', 2)::int) - (split_part(e.shift_start, ':', 1)::int * 60 + split_part(e.shift_start, ':', 2)::int))
                    ELSE 0
                END AS late_minutes
           FROM attendance a JOIN employees e ON e.id = a."employeeId"
           WHERE a."employeeId"=$1 ORDER BY a.date DESC LIMIT 5`, [emp.id]),
        cfg.erpTimeoutMs, 'ERP')).rows;
    try { await store.logEvent('erp_command', rec.remoteJid, `emp_detail:${emp.name}`); } catch (_) {}
    const h = Math.floor(Number(r.mins || 0) / 60), mm = Number(r.mins || 0) % 60;
    const fmtLate = (m) => {
        if (!m || m <= 0) {return '0 دقيقة';}
        const d = Math.floor(m / (10 * 60)), h = Math.floor((m % (10 * 60)) / 60), m2 = m % 60;
        const parts = [];
        if (d) {parts.push(`${d} يوم`);}
        if (h) {parts.push(`${h} ساعة`);}
        if (m2 || (!d && !h)) {parts.push(`${m2} دقيقة`);}
        return parts.join(' ');
    };
    const lines = [
        `👤 ${emp.name}`,
        `بصمة: ${emp.fp || '—'} | رقم وظيفي: ${emp.empNo || '—'}`,
        `قسم: ${emp.department || '—'} | مسمى: ${emp.position || '—'} | جوال: ${emp.phone || '—'}`,
        `حضور ${monthStart} → ${today}: أيام ${r.days} | حاضر ${r.present} | نسي خروج ${r.miss_out} | نسي دخول ${r.miss_in} | تأخير ${fmtLate(r.total_late_minutes)} | ساعات ${h}:${String(mm).padStart(2, '0')}`,
        last.length ? 'آخر سجلات:' : 'لا سجلات هذا الشهر.',
    ];
    for (const a of last) {
        const lateStr = a.late_minutes > 0 ? ` • متأخر ${fmtLate(a.late_minutes)}` : '';
        lines.push(`- ${a.date}: ${a.checkIn || '—'} → ${a.checkOut || '—'}${lateStr}`);
    }
    return lines.join('\n').slice(0, 3800);
}

/** مين حاضر + كل الحضور مفصل */
async function todayPresentAnswer(cfg, rec) {
    const day = riyadhDay();
    const rows = (await erp.withTimeout(pool.query(
        `SELECT e.name, a."checkIn", a."checkOut", a."workMinutes", a.late FROM attendance a JOIN employees e ON e.id = a."employeeId"
          WHERE a.date = $1 AND a."checkIn" IS NOT NULL ORDER BY e.name LIMIT 60`, [day]),
        cfg.erpTimeoutMs, 'ERP')).rows;
    const total = (await erp.withTimeout(pool.query(
        `SELECT COUNT(*)::int AS c FROM employees WHERE status='active'`), cfg.erpTimeoutMs, 'ERP')).rows[0].c;
    try { await store.logEvent('erp_command', rec.remoteJid, 'today_present'); } catch (_) {}
    const fmtLate = (m) => {
        if (!m || m <= 0) {return '0 دقيقة';}
        const d = Math.floor(m / (10 * 60)), h = Math.floor((m % (10 * 60)) / 60), m2 = m % 60;
        const parts = [];
        if (d) {parts.push(`${d} يوم`);}
        if (h) {parts.push(`${h} ساعة`);}
        if (m2 || (!d && !h)) {parts.push(`${m2} دقيقة`);}
        return parts.join(' ');
    };
    const lines = [`حاضر اليوم ${day}: ${rows.length} من ${total}${rows.length ? ' — التفاصيل:' : ''}`];
    for (const r of rows.slice(0, 25)) {
        const hm = r.workMinutes != null ? `${Math.floor(Number(r.workMinutes) / 60)}:${String(Number(r.workMinutes) % 60).padStart(2, '0')}` : '—';
        // حساب التأخير الحقيقي بالدقائق (JS parsing)
        const lateMin = r.late && r.checkIn ? Math.max(0, (() => { const [h, m] = String(r.checkIn).split(':').map(Number); return (h || 0) * 60 + (m || 0); })() - 540) : 0; // 9:00 = 540
        lines.push(`- ${r.name}: دخول ${r.checkIn || '—'} → خروج ${r.checkOut || 'لم يخرج بعد'} (${hm}${r.late ? ` • متأخر ${fmtLate(lateMin)}` : ''})`);
    }
    if (rows.length > 25) {lines.push(`... و${rows.length - 25} آخرون`);}
    if (!rows.length) {lines.push('لا حضور مسجل اليوم.');}
    return lines.join('\n').slice(0, 3800);
}

async function allAttendanceAnswer(cfg, dayOff, rec) {
    const day = dayOff === -1 ? riyadhDay(-1) : riyadhDay();
    const rows = (await erp.withTimeout(pool.query(
        `SELECT e.name, e."deviceUserId", e."employeeId" AS empNo, e.department, e.shift_start,
                a."checkIn", a."checkOut", a."workMinutes", a.late, a.date
           FROM employees e LEFT JOIN attendance a ON a."employeeId" = e.id AND a.date = $1
          WHERE e.status = 'active' ORDER BY e.name LIMIT 180`, [day]), cfg.erpTimeoutMs, 'ERP')).rows;
    const present = rows.filter(r => r.checkIn).length;
    try { await store.logEvent('erp_command', rec.remoteJid, `all_att:${day}`); } catch (_) {}
    const fmtLate = (m) => {
        if (!m || m <= 0) {return '0 دقيقة';}
        const d = Math.floor(m / (10 * 60)), h = Math.floor((m % (10 * 60)) / 60), m2 = m % 60;
        const parts = [];
        if (d) {parts.push(`${d} يوم`);}
        if (h) {parts.push(`${h} ساعة`);}
        if (m2 || (!d && !h)) {parts.push(`${m2} دقيقة`);}
        return parts.join(' ');
    };
    const lines = [`سجل الحضور ${day}: حاضر ${present} من ${rows.length}`];
    for (const r of rows.slice(0, 60)) {
        const parseTime = (t) => { const [h, m] = String(t || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
        const lateMin = r.late && r.checkIn && r.shift_start
            ? Math.max(0, parseTime(r.checkIn) - parseTime(r.shift_start))
            : 0;
        const st = r.checkIn ? `${r.checkIn}→${r.checkOut || '—'}${lateMin > 0 ? ` • متأخر ${fmtLate(lateMin)}` : ''}` : 'غائب';
        lines.push(`- ${r.name} [بصمة:${r.deviceUserId || '—'} / ${r.empNo || '—'} • ${r.department || '—'}]: ${st}`);
    }
    if (rows.length > 60) {lines.push(`... و${rows.length - 60} آخرون — اطلب «حضور <اسم>» للتفاصيل`);}
    return lines.join('\n').slice(0, 3800);
}

const empPageMap = new Map(); // jid -> last page index for الموظفون مفصل
async function employeesDetailedAnswer(cfg, rec, page = 0) {
    const rows = (await erp.withTimeout(pool.query(
        `SELECT e.id, e.name, e."employeeId" AS empNo, e."deviceUserId" AS fp, e.department, e.position,
                e.phone, e.status,
                a."checkIn", a."checkOut", a.date AS attDate
           FROM employees e LEFT JOIN attendance a ON a."employeeId" = e.id AND a.date = $1
          WHERE e.status = 'active' ORDER BY e.name LIMIT 180`, [riyadhDay()]), cfg.erpTimeoutMs, 'ERP')).rows;
    try { await store.logEvent('erp_command', rec.remoteJid, 'employees_detailed:' + page); } catch (_) {}
    const jid = String(rec.remoteJid || '');
    if (page === 0) {empPageMap.set(jid, 0);}
    else {empPageMap.set(jid, page);}
    const per = 40, start = page * per;
    const slice = rows.slice(start, start + per);
    const lines = [`الموظفون النشطون (${rows.length}) — صفحة ${page + 1}/${Math.ceil(rows.length / per)} — كل موظف بصمته وحضوره اليوم:`];
    for (const r of slice) {
        const att = r.checkIn ? `حضور ${r.checkIn} / انصراف ${r.checkOut || '—'}` : 'غائب اليوم';
        lines.push(`- ${r.name} | بصمة:${r.fp || '—'} رقم:${r.empNo || '—'} | ${r.department || '—'}/${r.position || '—'} | ${att}`);
    }
    if (start + per < rows.length) {lines.push(`— اكتب «باقي الموظفين» للصفحة التالية (${rows.length - start - per} باقي)`);}
    else if (page > 0) {lines.push('— انتهت القائمة ✓');}
    else if (rows.length > per) {lines.push(`... و${rows.length - per} آخرون — اكتب «باقي الموظفين»`);}
    return lines.join('\n').slice(0, 3800);
}

async function warehousesAnswer(cfg, rec) {
    const locs = (await erp.withTimeout(pool.query(
        `SELECT l.code, l.name_ar, l.location_type, COUNT(b.inventory_id)::int AS sku,
                COUNT(*) FILTER (WHERE COALESCE(b.on_hand,0) <= 0)::int AS out,
                COUNT(*) FILTER (WHERE COALESCE(b.on_hand,0) > 0 AND COALESCE(b.on_hand,0) <= COALESCE(i."minQty",0))::int AS low,
                COALESCE(SUM(COALESCE(b.on_hand,0) * COALESCE(i."avgCost",0)),0)::float AS val
           FROM inventory_locations l
           LEFT JOIN inventory_location_balances b ON b.location_id = l.id
           LEFT JOIN inventory i ON i.id = b.inventory_id
          WHERE l.active = true
          GROUP BY l.code, l.name_ar, l.location_type ORDER BY l.code LIMIT 40`), cfg.erpTimeoutMs, 'ERP')).rows;
    try { await store.logEvent('erp_command', rec.remoteJid, 'warehouses'); } catch (_) {}
    if (!locs.length) {return 'لا مستودعات نشطة.';}
    const lines = ['المخازن:'];
    for (const r of locs) {lines.push(`- ${r.name_ar || r.code} [${r.code} • ${r.location_type || '—'}]: ${r.sku} صنف، نافذ ${r.out}، منخفض ${r.low}، قيمة ${fnum(Math.round(r.val))}`);}
    return lines.join('\n').slice(0, 3800);
}

async function productsStockAnswer(cfg, rec) {
    const rows = (await erp.withTimeout(pool.query(
        `SELECT i.id, i.name, i.unit, i."minQty", COALESCE(SUM(b.on_hand),0)::float AS total,
                COUNT(b.location_id)::int AS locs, COALESCE(i."avgCost",0)::float AS cost
           FROM inventory i LEFT JOIN inventory_location_balances b ON b.inventory_id = i.id
          GROUP BY i.id ORDER BY total ASC LIMIT 60`), cfg.erpTimeoutMs, 'ERP')).rows;
    try { await store.logEvent('erp_command', rec.remoteJid, 'products_stock'); } catch (_) {}
    const lines = [`المنتجات — كم من كل منتج (60 صنفًا):`];
    for (const r of rows.slice(0, 35)) {
        const st = Number(r.total) <= 0 ? '⛔ نافذ' : (Number(r.minQty) > 0 && Number(r.total) <= Number(r.minQty) ? '⚠ منخفض' : '✅');
        lines.push(`${st} ${r.name}: ${fnum(r.total)} ${r.unit || ''} في ${r.locs} مخزن — قيمة ${fnum(Math.round(Number(r.total) * Number(r.cost)))}`);
    }
    if (rows.length > 35) {lines.push(`... و${rows.length - 35} صنفًا آخر — اطلب «مخزون <اسم>» لتفاصيل صنف`);}
    return lines.join('\n').slice(0, 3800);
}

/** أداء الأقسام اليوم: إيراد كل قسم + حصته */
async function departmentsAnswer(cfg, rec) {
    const day = riyadhDay();
    const rows = (await erp.withTimeout(pool.query(
    `SELECT COALESCE(m.display_ar, r."deptId") AS name, COUNT(*)::int AS n,
        COALESCE(SUM(r.amount),0)::float AS tot
    FROM revenues r
    LEFT JOIN (SELECT DISTINCT ON (dept_code) dept_code, display_ar
                FROM yarasoft_revenue_map WHERE active = true ORDER BY dept_code, id) m
     ON m.dept_code = r."deptId"
    WHERE r.date = $1 AND r."deptId" != 'ys_b4_ext' GROUP BY 1 ORDER BY 3 DESC`, [day]),
        cfg.erpTimeoutMs, 'ERP')).rows;
    try { await store.logEvent('erp_command', rec.remoteJid, `departments:${day}`); } catch (_) {}
    if (!rows.length) {return `لا إيرادات مسجلة ليوم ${day} — الأقسام كلها صفر.`;}
    const tot = rows.reduce((s, x) => s + Number(x.tot || 0), 0);
    const lines = [`أداء الأقسام — ${day} (الإجمالي ${fnum(Math.round(tot))}):`];
    rows.slice(0, 12).forEach((r, i) => {
        const share = tot > 0 ? Math.round((Number(r.tot) / tot) * 100) : 0;
        lines.push(`${i < 3 ? ['🥇', '🥈', '🥉'][i] + ' ' : ''}${r.name}: ${fnum(Math.round(Number(r.tot)))} (${share}%) — ${fnum(r.n)} فاتورة`);
    });
    if (rows.length > 12) {lines.push(`... و${rows.length - 12} قسمًا آخر`);}
    return lines.join('\n').slice(0, 3800);
}

/** المطبخ: دفعات إنتاج اليوم + التوزيع */
async function kitchenAnswer(cfg, rec) {
    const day = riyadhDay();
    const rows = (await erp.withTimeout(pool.query(
        `SELECT COALESCE(NULLIF(product_name,''),'—') AS name, planned_qty, produced_qty,
                remaining_qty, status, created_at
           FROM kitchen_production_batches
          WHERE created_at::date = $1::date ORDER BY created_at DESC LIMIT 10`, [day]),
        cfg.erpTimeoutMs, 'ERP')).rows;
    const dist = (await erp.withTimeout(pool.query(
        `SELECT COUNT(*)::int AS c FROM kitchen_production_distributions WHERE created_at::date = $1::date`, [day]),
        cfg.erpTimeoutMs, 'ERP')).rows[0].c;
    try { await store.logEvent('erp_command', rec.remoteJid, `kitchen:${day}`); } catch (_) {}
    const stAr = { draft: 'مسودة', open: 'مفتوحة', closed: 'مغلقة', cancelled: 'ملغاة', submitted: 'مقدمة', approved: 'معتمدة', rejected: 'مرفوضة' };
    const lines = [`المطبخ — إنتاج ${day} (${rows.length} دفعة • ${dist} توزيع):`];
    if (!rows.length) {lines.push('لا دفعات إنتاج اليوم.');}
    for (const r of rows) {
        lines.push(`- ${r.name}: مخطط ${fnum(r.planned_qty)} → منتج ${fnum(r.produced_qty)} → متبق ${fnum(r.remaining_qty)} [${stAr[r.status] || r.status}]`);
    }
    return lines.join('\n').slice(0, 3800);
}

/** الموردون: أكبر المديونيات المفتوحة + مشتريات الشهر */
async function suppliersAnswer(cfg, rec) {
    const rows = (await erp.withTimeout(pool.query(
        `SELECT s.id, s.name,
                COALESCE((SELECT SUM("totalAmount") FROM "purchaseInvoices" WHERE "supplierId" = s.id),0)::float AS tot,
                COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE "supplierId" = s.id),0)::float AS paid
           FROM suppliers s WHERE s.is_active = true ORDER BY 3 - 4 DESC LIMIT 10`),
        cfg.erpTimeoutMs, 'ERP')).rows;
    const month = riyadhDay().slice(0, 7);
    const agg = (await erp.withTimeout(pool.query(
        `SELECT COUNT(*)::int AS n, COALESCE(SUM("totalAmount"),0)::float AS tot
           FROM "purchaseInvoices" WHERE LEFT(date,7) = $1`, [month]), cfg.erpTimeoutMs, 'ERP')).rows[0];
    try { await store.logEvent('erp_command', rec.remoteJid, 'suppliers'); } catch (_) {}
    const lines = [`الموردون — أكبر المديونيات (مشتريات ${month}: ${fnum(agg.n)} = ${fnum(agg.tot)}):`];
    let any = false;
    for (const r of rows) {
        const debt = Number(r.tot || 0) - Number(r.paid || 0);
        if (debt <= 0) {continue;}
        any = true;
        lines.push(`- ${r.name}: فواتير ${fnum(r.tot)} — مدفوع ${fnum(r.paid)} — المستحق ${fnum(debt)}`);
    }
    if (!any) {lines.push('لا مديونيات مفتوحة ✓');}
    lines.push('للتفصيل: مديونية <اسم المورد>');
    return lines.join('\n').slice(0, 3800);
}

/** الأقسام المعلقة: قائمة قابلة للاعتماد من الشات */
async function unmappedSectionsAnswer(cfg, rec) {
    const rows = (await erp.withTimeout(pool.query(
        `SELECT id, src_table, src_name, invoices_count, total_amount
           FROM yarasoft_unmapped_sections WHERE resolved = false ORDER BY last_seen DESC LIMIT 10`),
        cfg.erpTimeoutMs, 'ERP')).rows;
    try { await store.logEvent('erp_command', rec.remoteJid, 'unmapped_list'); } catch (_) {}
    if (!rows.length) {return 'لا أقسام معلقة — كل الأقسام معتمدة ✓';}
    const lines = [`أقسام تنتظر الاعتماد (${rows.length}):`];
    for (const r of rows) {lines.push(`- [${r.id}] ${r.src_name} (${r.src_table}): ${fnum(r.invoices_count)} فاتورة = ${fnum(r.total_amount)}`);}
    lines.push('للتنفيذ: اعتماد قسم <الرقم> — مثال: اعتماد قسم 12');
    return lines.join('\n').slice(0, 3500);
}

// تأكيدات الاعتماد المعلقة: jid -> { id, src, expires } — إجراء تنفيذي بخطوتين
const pendingApprovals = new Map();
const APPROVE_TTL_MS = 5 * 60 * 1000;

/** الخطوة 1: معاينة الاعتماد وطلب التأكيد */
async function approveSectionPreview(cfg, id, rec) {
    const r = (await erp.withTimeout(pool.query(
        `SELECT id, src_table, src_name FROM yarasoft_unmapped_sections WHERE id = $1 AND resolved = false`, [id]),
        cfg.erpTimeoutMs, 'ERP')).rows[0];
    if (!r) {return `القسم [${id}] غير موجود أو اعتُمد مسبقًا.`;}
    if (String(r.src_table).toUpperCase() === 'BILLS4') {
        return 'فواتير BILLS4 تتبع قسم «بيع خارجي» الواحد بقرار المالك — لا اعتماد منفصل لها.';
    }
    const stuck = (await erp.withTimeout(pool.query(
        `SELECT COUNT(*)::int AS c FROM invoice_import_log
          WHERE status = 'NEEDS_MAPPING' AND payload->>'sectionName' = $1`, [r.src_name]),
        cfg.erpTimeoutMs, 'ERP')).rows[0].c;
    pendingApprovals.set(String(rec.remoteJid || ''), { id: r.id, src: r.src_name, expires: Date.now() + APPROVE_TTL_MS });
    try { await store.logEvent('erp_command', rec.remoteJid, `approve_preview:${r.id}`); } catch (_) {}
    return [
        `اعتماد قسم [${r.id}] «${r.src_name}» (${r.src_table}):`,
        `سينشئ القسم في النظام ويرحّل ${fnum(stuck)} فاتورة معلقة فورًا.`,
        `للتأكيد خلال 5 دقائق أرسل: تأكيد اعتماد ${r.id}`,
    ].join('\n');
}

/** الخطوة 2: تنفيذ الاعتماد — نفس معاملة زر الواجهة (إنشاء قسم + ترحيل + resolved) */
async function approveSectionExecute(cfg, id, rec) {
    const jid = String(rec.remoteJid || '');
    const pend = pendingApprovals.get(jid);
    if (!pend || pend.id !== id || pend.expires < Date.now()) {
        pendingApprovals.delete(jid);
        return 'لا يوجد طلب اعتماد معلق لهذا الرقم — ابدأ بـ: اعتماد قسم <الرقم> ثم أكّد خلال 5 دقائق.';
    }
    pendingApprovals.delete(jid);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const sec = (await client.query(
            `SELECT * FROM yarasoft_unmapped_sections WHERE id = $1 AND resolved = false FOR UPDATE`, [id])).rows[0];
        if (!sec) { await client.query('ROLLBACK'); return `القسم [${id}] اعتُمد مسبقًا بواسطة شخص آخر.`; }
        const table = String(sec.src_table).toUpperCase();
        if (table === 'BILLS4') { await client.query('ROLLBACK'); return 'فواتير BILLS4 تتبع «بيع خارجي» — مرفوض بقرار المالك.'; }
        const name = sec.src_name;
        const deptCode = `ys_${table.toLowerCase()}_u${sec.id}`.slice(0, 50);
        await client.query(
            `INSERT INTO yarasoft_revenue_map (src_table, src_name, dept_code, display_ar, display_en, active)
             VALUES ($1, $2, $3, $4, NULL, true) ON CONFLICT DO NOTHING`,
            [table, sec.src_name, deptCode, String(name).slice(0, 255)]);
        await client.query(
            `INSERT INTO departments (id, code, name, icon, color) VALUES ($1, $2, $3, '🧾', '#8b6fc1')
             ON CONFLICT (code) DO NOTHING`,
            [Date.now() * 1000 + Math.floor(Math.random() * 1000), deptCode, String(name).slice(0, 255)]);
        await client.query(`UPDATE yarasoft_unmapped_sections SET resolved = true, updated_at = NOW() WHERE id = $1`, [id]);
        const reopened = (await client.query(
            `UPDATE invoice_import_log SET retry_count = 0, error_message = NULL, updated_at = NOW()
              WHERE status = 'NEEDS_MAPPING' AND external_invoice_number LIKE $1 || ':%'
                AND payload->>'sectionName' = $2`,
            [table, sec.src_name])).rowCount;
        await client.query('COMMIT');
        try { await store.logEvent('section_approved_wa', `${rec.senderPn || rec.remoteJid}`, `[${id}] ${sec.src_name} reopened:${reopened}`); } catch (_) {}
        return `تم اعتماد قسم «${sec.src_name}» ✅\nأُنشئ بقسم النظام (${deptCode}) وأُعيد فتح ${fnum(reopened)} فاتورة للترحيل.`;
    } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        logger.warn('[WHATSAPP] wa-approve failed: ' + String(e.message).slice(0, 150));
        return 'تعذر تنفيذ الاعتماد — حاول من صفحة يارا سوفت.';
    } finally { try { client.release(); } catch (_) {} }
}

/** المخزن الشامل: كل النافذ والمنخفض والقيم في رسالة واحدة */
async function warehouseFullAnswer(cfg, rec) {
    const rows = (await erp.withTimeout(pool.query(
        `SELECT id, name, unit, COALESCE(qty,0)::float AS qty, COALESCE("minQty",0)::float AS minq,
                COALESCE("avgCost",0)::float AS cost
           FROM inventory ORDER BY name`), cfg.erpTimeoutMs, 'ERP')).rows;
    try { await store.logEvent('erp_command', rec.remoteJid, 'warehouse_full'); } catch (_) {}
    const out = rows.filter((r) => Number(r.qty) <= 0);
    const low = rows.filter((r) => Number(r.qty) > 0 && Number(r.qty) <= Number(r.minq));
    const totalVal = rows.reduce((s, r) => s + Number(r.qty) * Number(r.cost), 0);
    const refill = [...out, ...low].reduce((s, r) => s + Math.max(0, Number(r.minq) - Number(r.qty)) * Number(r.cost), 0);
    const lines = [`المخزن الشامل: ${rows.length} صنفًا — القيمة ${fnum(Math.round(totalVal))}`,
        `نافذ: ${out.length} • منخفض: ${low.length} • تعبئة حتى الحد: ${fnum(Math.round(refill))}`];
    if (out.length) {
        lines.push(`⛔ النافذ${out.length > 25 ? ` (أول 25 من ${out.length})` : ''}:`);
        for (const r of out.slice(0, 25)) {lines.push(`- ${r.name} (حد ${fnum(r.minq)} ${r.unit || ''})`);}
    }
    if (low.length) {
        lines.push(`⚠ المنخفض${low.length > 25 ? ` (أول 25 من ${low.length})` : ''}:`);
        for (const r of low.slice(0, 25)) {lines.push(`- ${r.name}: ${fnum(r.qty)} من ${fnum(r.minq)} ${r.unit || ''}`);}
    }
    if (!out.length && !low.length) {lines.push('المخزون كله فوق الحد ✓');}
    return lines.join('\n').slice(0, 3800);
}

/** الموجّه الحر — يُرجع نص الرد أو null (لا فهم) */
async function answerFreeText(engine, text, rec) {
    const cfg = engine.getConfig();
    const t = norm(text);
    if (!t || t.length > 300) {return null;}
    const mgr = () => erp.isManagerChat(rec.remoteJid, rec.senderPn);
    try {
        if (/^(مساعده|مساعدة|help|اوامر|الاوامر|commands?|ايه الاوامر|شو بتقدر|ماذا يمكنك|ايش تقدر)$/.test(t)) {return helpText();}
        if (t.includes('تقرير')) {
            if (!(await mgr())) {return DENY;}
            const { collectBriefing, formatWhatsapp } = require('../manager-briefing');
            const b = await erp.withTimeout(collectBriefing(pool, undefined), Math.min(60000, cfg.erpTimeoutMs * 4), 'ERP');
            try { await store.logEvent('erp_command', rec.remoteJid, 'briefing'); } catch (_) {}
            return formatWhatsapp(b);
        }
        if (/(حاله النظام|حالة النظام|حاله السيرفر|حالة السيرفر|حاله الواتساب|حالة الواتساب|النظام شغال|السيرفر شغال)/.test(t)) {
            if (!(await mgr())) {return DENY;}
            return systemHealthAnswer(engine, rec);
        }
        if (!t.includes('تقفيل') && (/(الكاشيريه|الكاشيرية|لوحه الكاشير|لوحة الكاشير)/.test(t) || (/كاشير/.test(t) && /\d/.test(t)))) {
            if (!(await mgr())) {return DENY;}
            return cashiersLiveAnswer(cfg, t, rec);
        }
        if (/(البصمه|البصمة|جهاز البصمه|جهاز البصمة|حاله البصمه|حالة البصمة)/.test(t) && !/\d/.test(t.replace(/بصمه|بصمة/g, ''))) {
            if (!(await mgr())) {return DENY;}
            return zkStatusAnswer(cfg, rec);
        }
        if (/(المزامنه|المزامنة|يارا|سحب الفواتير|حاله السحب|حالة السحب)/.test(t)) {
            if (!(await mgr())) {return DENY;}
            return ysStatusAnswer(cfg, rec);
        }
        if (t.includes('تقفيل')) {return erp.runCommand(engine, { rule: { name: 'تقفيل' }, args: stripKw(t, 'تقفيل', 'كاشير') }, rec);}
        if (/(مبيعات|ايراد|إيراد|دخل|حصيله|حصيلة)/.test(t)) {
            if (!(await mgr())) {return DENY;}
            return erp.runCommand(engine, { rule: { name: 'إيراد' }, args: stripKw(t, 'مبيعات', 'ايراد', 'إيراد', 'اليوم', 'امس', 'أمس', 'كاشير') }, rec);
        }
        // المخزن الشامل (مطابقة تامة) — قبل «مخزون» العام الذي يلتقط الكلمة
        if (/^(المخزن|المخزون|مخزن شامل|المخزون الشامل|تقرير المخزن|تقرير المخزون)$/.test(t)) {
            if (!(await mgr())) {return DENY;}
            return warehouseFullAnswer(cfg, rec);
        }
        if (/(مخزون|مخزن|رصيد صنف|كمية صنف)/.test(t)) {
            if (!(await mgr())) {return DENY;}
            return erp.runCommand(engine, { rule: { name: 'مخزن' }, args: stripKw(t, 'مخزون', 'مخزن', 'رصيد', 'صنف', 'كميه', 'كمية') }, rec);
        }
        if (/(نواقص|نافذ|نافذه|منخفض|خلص|خالص|سينفد|قرب يخلص)/.test(t)) {
            if (!(await mgr())) {return DENY;}
            return erp.runCommand(engine, { rule: { name: 'نواقص' }, args: '' }, rec);
        }
        if (/(مين حاضر|حاضرين|حضور اليوم|حاضر اليوم|داوم اليوم)/.test(t)) {
            if (!(await mgr())) {return DENY;}
            return todayPresentAnswer(cfg, rec);
        }
        if (/(كل الحضور|كل الحاضرين|سجل الحضور كامل|انصراف اليوم|كل انصراف)/.test(t)) {
            if (!(await mgr())) {return DENY;}
            return allAttendanceAnswer(cfg, /امس|أمس/.test(t) ? -1 : 0, rec);
        }
        if (/(باقي الموظفين|باقي|المزيد|التالى|التالي|الصفحه التاليه|الصفحة التالية)/.test(t) && !/(مخزون|منتج)/.test(t)) {
            if (!(await mgr())) {return DENY;}
            const cur = empPageMap.get(String(rec.remoteJid || '')) ?? 0;
            return employeesDetailedAnswer(cfg, rec, cur + 1);
        }
        if (/(الموظفون مفصل|كل الموظفين|موظفون مفصل|قايمه الموظفين|قائمة الموظفين)/.test(t)) {
            if (!(await mgr())) {return DENY;}
            return employeesDetailedAnswer(cfg, rec, 0);
        }
        if (/(المخازن|المستودعات|مخازن|ملخص المخازن)/.test(t) && !/(مخزون |صنف)/.test(t)) {
            if (!(await mgr())) {return DENY;}
            return warehousesAnswer(cfg, rec);
        }
        if (/(المنتجات|كل المنتجات|كم من كل منتج|ارصده المنتجات|أرصدة المنتجات)/.test(t)) {
            if (!(await mgr())) {return DENY;}
            return productsStockAnswer(cfg, rec);
        }
        if (/(حضور|حاضر|غايب|غائب|دوام)/.test(t)) {
            if (!(await mgr())) {return DENY;}
            // منع التقاط «المخازن» كـ حضور
            if (/(المخازن|المستودعات)/.test(t)) {return null;}
            return erp.runCommand(engine, { rule: { name: 'حضور' }, args: stripKw(t, 'حضور', 'حاضر', 'غايب', 'غائب', 'دوام', 'استعلام') }, rec);
        }
        // بحث موظف بالاسم/الرقم/البصمة — تفاصيل كاملة (أيام مداومته)
        if (/^(موظف|ابحث|بحث|تفاصيل موظف|معلومات موظف)\s+.+/.test(t) || (/^(موظف)\b/.test(t) && t.replace(/^موظف\s+/, '').trim().length >= 2)) {
            if (!(await mgr())) {return DENY;}
            const nameQ = t.replace(/^(موظف|ابحث|بحث|تفاصيل موظف|معلومات موظف)\s+/, '').trim()
                || stripKw(t, 'موظف', 'ابحث', 'بحث', 'تفاصيل', 'معلومات', 'عن');
            if (nameQ.length >= 2) {return employeeDetailAnswer(cfg, nameQ, rec);}
        }
        // بصمة رقمية وحدها 2-4 خانات (مثل: 45 أو بصمة 45)
        if (/^\d{1,4}$/.test(t)) {
            const maybe = await employeeDetailAnswer(cfg, t, rec).catch(() => null);
            if (maybe && !maybe.startsWith('لا يوجد موظف')) {return maybe;}
        }
        if (/^بصمه\s*\d{1,4}$/.test(t)) {
            const d = t.replace(/\D/g, '');
            const maybe = await employeeDetailAnswer(cfg, d, rec).catch(() => null);
            if (maybe && !maybe.startsWith('لا يوجد موظف')) {return maybe;}
        }
        // بحث حر: اسم كامل بدون كلمة مفتاحية (يحتوي مسافة)
        if (t.length >= 6 && t.includes(' ') && !/[0-9]/.test(t) && !/(سلام|اهلا|تقرير|مساعده|حضور|مخزون|مبيعات|مصاريف|ورديه|سعر|طلب|موظف|بصمه)/.test(t)) {
            const maybe = await employeeDetailAnswer(cfg, t, rec).catch(() => null);
            if (maybe && !maybe.startsWith('لا يوجد موظف')) {return maybe;}
        }
        if (/(موظفين|موظف|عمال|فريق العمل)/.test(t) && !/حضور/.test(t)) {
            if (!(await mgr())) {return DENY;}
            // إذا فيه اسم بعد الكلمة، اعتبره تفصيلي
            const after = stripKw(t, 'موظفين', 'موظف', 'عمال', 'فريق', 'العمل');
            if (after.length >= 2) {
                const d = await employeeDetailAnswer(cfg, after, rec);
                if (!d.startsWith('لا يوجد موظف')) {return d;}
            }
            return erp.runCommand(engine, { rule: { name: 'موظفين' }, args: '' }, rec);
        }
        if (/(رواتب|راتب|مسير|رواتبهم)/.test(t)) {
            if (!(await mgr())) {return DENY;}
            return erp.runCommand(engine, { rule: { name: 'رواتب' }, args: '' }, rec);
        }
        if (/(اجاز|إجاز)/.test(t)) {
            if (!(await mgr())) {return DENY;}
            return erp.runCommand(engine, { rule: { name: 'إجازات' }, args: '' }, rec);
        }
        if (/(وثائق|وثايق|مستندات|اوراق|اقامه|إقامة|شهادات)/.test(t)) {
            if (!(await mgr())) {return DENY;}
            return erp.runCommand(engine, { rule: { name: 'وثائق' }, args: '' }, rec);
        }
        // تنفيذي: تأكيد اعتماد قسم (الخطوة 2) — قبل «اعتماد قسم» حتى لا يُلتقط رقم التأكيد كمعاينة
        if (/^(تاكيد اعتماد|تأكيد اعتماد|اكد اعتماد|أكد اعتماد)\s+(\d{1,10})$/.test(t)) {
            if (!(await mgr())) {return DENY;}
            return approveSectionExecute(cfg, Number((t.match(/(\d{1,10})$/) || [])[1]), rec);
        }
        // تنفيذي: معاينة اعتماد قسم (الخطوة 1)
        if (/^(اعتماد قسم|اعتمد قسم|اقبل قسم|أقبل قسم)\s+(\d{1,10})$/.test(t)) {
            if (!(await mgr())) {return DENY;}
            return approveSectionPreview(cfg, Number((t.match(/(\d{1,10})$/) || [])[1]), rec);
        }
        // الأقسام المعلقة — قبل «أقسام» العام
        if (/(اقسام معلقه|أقسام معلقة|الاقسام المعلقه|اقسام تنتظر|أقسام تنتظر|unmapped)/.test(t)) {
            if (!(await mgr())) {return DENY;}
            return unmappedSectionsAnswer(cfg, rec);
        }
        // أداء الأقسام — يستثني HR والمعلقة (عُولجا أعلاه)
        if (/(الأقسام|الاقسام|اداء الأقسام|أداء الأقسام|تقرير الأقسام|^اقسام$)/.test(t) && !/(hr|اتش|موارد|معلق|معلقه)/.test(t)) {
            if (!(await mgr())) {return DENY;}
            return departmentsAnswer(cfg, rec);
        }
        // المطبخ والإنتاج
        if (/(المطبخ|الانتاج|الإنتاج|دفعات الانتاج|دفعات الإنتاج|انتاج اليوم|إنتاج اليوم)/.test(t)) {
            if (!(await mgr())) {return DENY;}
            return kitchenAnswer(cfg, rec);
        }
        // الموردون (الجمع) — قبل «مشتريات» لأنها تلتقط «مورد»
        if (/(الموردين|الموردون|قايمه الموردين|قائمة الموردين|حسابات الموردين|كشف الموردين)/.test(t)) {
            if (!(await mgr())) {return DENY;}
            return suppliersAnswer(cfg, rec);
        }
        if (/(مشتريات|مشتري|مورد|موردين|مديونيه|مديونية|فاتورة شراء|فواتير الشراء)/.test(t)) {
            if (!(await mgr())) {return DENY;}
            return purchasesAnswer(cfg, stripKw(t, 'مشتريات', 'مشتري', 'مورد', 'موردين', 'مديونيه', 'مديونية', 'فاتوره', 'فاتورة', 'شراء', 'استعلام', 'عن'), rec);
        }
        if (/(مصاريف|مصروف|مصروفات|مصاريفهم|صرفنا)/.test(t)) {
            if (!(await mgr())) {return DENY;}
            return expensesAnswer(cfg, t, rec);
        }
        if (/(ورديه|وردية|ورديات|شفت|شيفت)/.test(t)) {
            if (!(await mgr())) {return DENY;}
            return shiftsAnswer(cfg, rec);
        }
        if (/(سعر|اسعار|بكام|بكم|المنيو|قايمة الاسعار)/.test(t)) {
            return priceAnswer(cfg, stripKw(t, 'سعر', 'اسعار', 'بكام', 'بكم', 'المنيو', 'صنف', 'اكله', 'وجبه', 'وجبة', 'استعلام', 'عن'), rec);
        }
        if (/(حاله طلب|حالة طلب|طلب رقم|فين طلب|وين طلب)/.test(t) || (/طلب/.test(t) && /\d{2,}/.test(t))) {
            return erp.runCommand(engine, { rule: { name: 'حالة طلب' }, args: t }, rec);
        }
        if (/^(سلام|اهلا|أهلا|هلا|صباح|مساء|hai+|hi+|hey)$/.test(t)) {return 'أهلًا بيك — اكتب «مساعدة» لعرض ما أقدر أجاوب عليه من بيانات المطعم لحظيًا.';}
        // ─── العقل الحر (Gemini مجاني): أي سؤال آخر من الإدارة — مُرَكَّض ببيانات النظام الحية ───
        if (gemini.enabled()) {
            if (!(await mgr())) {return DENY;}
            try {
                const { collectBriefing, formatWhatsapp } = require('../manager-briefing');
                const b = await erp.withTimeout(collectBriefing(pool, undefined), Math.min(60000, cfg.erpTimeoutMs * 4), 'ERP');
                const dataText = formatWhatsapp(b).slice(0, 3800);
                const g = await gemini.generateWithRetry({
                    system: gemini.systemGuard(),
                    prompt: `سؤال الإدارة: «${text}»\nأجب باحترافية من البيانات المرفقة فقط، وبنفس أسلوب واتساب المنسق.`,
                    dataText,
                    maxWords: 180,
                });
                if (g && g.text) {return g.text;}
            } catch (e) {
                logger.warn('[WHATSAPP] gemini fallback failed: ' + String(e.message).slice(0, 120));
            }
        }
        return null;
    } catch (e) {
        logger.warn('[WHATSAPP] router failed: ' + String(e.message).slice(0, 150));
        return 'تعذر الوصول لبيانات النظام حاليًا — حاول بعد قليل.';
    }
}

module.exports = { answerFreeText, helpText };
