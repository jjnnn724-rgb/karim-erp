/**
 * whatsapp-engine/erp.js — محوّل Karim ERP (قراءة آمنة فقط + تدقيق)
 * ────────────────────────────────────────────────────────────────────────────
 * - لا تجاوز للتخويل: أوامر قراءة محدودة القائمة، بلا استعلامات حرة من الشات.
 * - مهلة محدودة لكل استعلام + أي عطل في ERP لا يُسقط المحرك (رد لطيف).
 * - كل فعل تجاري عبر الشات يُسجل في wa_events.
 */
'use strict';

const { logger } = require('../logger');
const { pool } = require('../shared-pool');
const store = require('./store');

const ORDER_STATUS_AR = {
    open: 'مفتوح', issued: 'مُصدر', reported: 'مُبلغ', paid: 'مدفوع',
    cancelled: 'ملغي', closed: 'مغلق', pending: 'معلق',
};

async function withTimeout(promise, ms, label) {
    let t;
    const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(label + '_TIMEOUT')), ms); });
    try { return await Promise.race([promise, timeout]); }
    finally { clearTimeout(t); }
}

/** حضور موظف بالاسم والمدة: «حضور أحمد» / «حضور أحمد 1/9 15/9» */
async function hrAttendanceLookup(pool, cfg, store, args, rec) {
    const norm = (s) => String(s || '').replace(/[ً-ٰٟ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase();
    const toISO = (d, m, y) => {
        let Y = Number(y), M = Number(m), D = Number(d);
        if (Y < 100) {Y += 2000;}
        if (!(Y >= 2020 && Y <= 2100 && M >= 1 && M <= 12 && D >= 1 && D <= 31)) {return null;}
        return `${Y}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`;
    };
    const dates = [];
    let text = ` ${args} `;
    text = text.replace(/(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/g, (_, y, m, d) => {
        const iso = toISO(d, m, y); if (iso) {dates.push(iso);} return ' ';
    });
    text = text.replace(/(?<!\d)(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?(?!\d)/g, (_, d, m, y) => {
        const iso = toISO(d, m, y || new Date().getFullYear()); if (iso) {dates.push(iso);} return ' ';
    });
    // «آخر 5 أيام» / «آخر أسبوع» / «آخر شهر» — مدة نسبية تُحسب من اليوم وتُنظَّف من الاسم
    const rel = text.match(/(?:اخر|آخر|أخر)\s*(\d{1,3})\s*(?:يوم|أيام|ايام)/)
        || text.match(/(?:اخر|آخر|أخر)\s*(?:اسبوع|أسبوع)/)
        || text.match(/(?:اخر|آخر|أخر)\s*(?:شهر)/);
    if (rel) {text = text.replace(rel[0], ' ');}
    // تنظيف كلمات الوصل المتبقية بعد شيل التواريخ («من X الى Y» → الاسم فقط)
    for (let i = 0; i < 3; i++) {text = text.replace(/(^|\s)(من|الى|إلى|الي)(?=\s|$)/g, ' ');}
    const nameQ = norm(text).trim().replace(/\s+/g, ' ');
    if (!nameQ) {return 'اكتب الاسم: حضور <اسم الموظف> [من تاريخ] [إلى تاريخ] — مثال: حضور أحمد 1/9 15/9';}
    const emps = (await withTimeout(pool.query(`SELECT id, name FROM employees WHERE status='active'`), cfg.erpTimeoutMs, 'ERP')).rows;
    const hits = emps.filter((e) => { const n = norm(e.name); return n && (n.includes(nameQ) || nameQ.includes(n)); }).slice(0, 6);
    if (!hits.length) {return `لا يوجد موظف نشط باسم «${args.trim()}».`;}
    if (hits.length > 1) {
        return `أكثر من موظف يطابق — حدد:\n` + hits.map((e) => `- ${e.name}`).join('\n');
    }
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const monthStart = today.slice(0, 7) + '-01';
    let from = monthStart, to = today;
    const ds = [...new Set(dates)].sort();
    if (ds.length === 1) { from = ds[0]; to = ds[0]; }
    else if (ds.length >= 2) { from = ds[0]; to = ds[1]; }
    if (from > to) {[from, to] = [to, from];}
    if (rel) {
        const n = /^\d+$/.test(String(rel[1] || '')) ? Math.min(62, Number(rel[1])) : (/اسبوع|أسبوع/.test(rel[0]) ? 7 : 30);
        const start = new Date(today + 'T00:00:00');
        start.setDate(start.getDate() - (n - 1));
        const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        from = iso(start); to = today;
    }
    if ((new Date(to) - new Date(from)) / 86400000 > 62) {
        return 'المدة طويلة — حد أقصى 62 يوم. مثال: حضور أحمد 1/9 15/9';
    }
    const emp = hits[0];
    const r = await withTimeout(pool.query(
        `SELECT COUNT(*)::int AS days,
                COUNT(*) FILTER (WHERE "checkIn" IS NOT NULL)::int AS present,
                COUNT(*) FILTER (WHERE "checkIn" IS NOT NULL AND "checkOut" IS NULL)::int AS miss_out,
                COUNT(*) FILTER (WHERE "checkIn" IS NULL AND "checkOut" IS NOT NULL)::int AS miss_in,
                COALESCE(SUM("workMinutes"),0)::int AS mins,
                MAX(CASE WHEN "checkIn" IS NOT NULL THEN date END) AS last_date,
                MAX(CASE WHEN "checkIn" IS NOT NULL THEN "checkIn" END) AS last_check_in,
                MAX(CASE WHEN "checkOut" IS NOT NULL THEN "checkOut" END) AS last_check_out
           FROM attendance WHERE "employeeId" = $1 AND date >= $2 AND date <= $3`,
        [emp.id, from, to]
    ), cfg.erpTimeoutMs, 'ERP');
    const latest = await withTimeout(pool.query(
        `SELECT date, "checkIn", "checkOut", "workMinutes", late
           FROM attendance WHERE "employeeId" = $1 AND "checkIn" IS NOT NULL
           ORDER BY date DESC, "checkIn" DESC LIMIT 1`,
        [emp.id]
    ), cfg.erpTimeoutMs, 'ERP');
    const s = r.rows[0];
    const lastEntry = latest.rows[0] || {};
    try { await store.logEvent('erp_command', rec.remoteJid, `att_lookup:${emp.name}`); } catch (_) {}
    const h = Math.floor((s.mins || 0) / 60), mm = (s.mins || 0) % 60;
    // سجل الأيام: حضور وانصراف كل يوم في الفترة (حتى 14 سطرًا ليبقى الرسالة مضغوطة)
    const dayRows = (await withTimeout(pool.query(
        `SELECT date, "checkIn", "checkOut", "workMinutes", late
           FROM attendance WHERE "employeeId" = $1 AND date >= $2 AND date <= $3
           ORDER BY date DESC LIMIT 14`, [emp.id, from, to]
    ), cfg.erpTimeoutMs, 'ERP')).rows;
    const dayName = (iso) => { try { return new Intl.DateTimeFormat('ar', { weekday: 'long', timeZone: 'Asia/Riyadh' }).format(new Date(iso + 'T12:00:00')); } catch (_) { return ''; } };
    const shortDay = (iso) => iso.slice(5).replace('-', '/');
    const dayLines = dayRows.map((d) => {
        const mins = Number(d.workMinutes || 0);
        const dur = mins > 0 ? ` (${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')})` : '';
        const lateTxt = d.late ? ' ⏰تأخير' : '';
        const inTxt = d.checkIn || '—';
        const outTxt = d.checkOut || '—';
        return `▪ ${dayName(d.date)} ${shortDay(d.date)}: دخول ${inTxt} — خروج ${outTxt}${dur}${lateTxt}`;
    });
    const rangeNote = (s.days > dayRows.length) ? `\n(آخر ${dayRows.length} يوم من الفترة — المجموع ${s.days} يوم)` : '';
    return [
        `حضور ${emp.name}`,
        `${from}${from === to ? '' : ' ← ' + to}`,
        `آخر دخول: ${lastEntry.checkIn || '—'} | آخر خروج: ${lastEntry.checkOut || '—'}`,
        `تاريخ آخر دخول: ${lastEntry.date || s.last_date || '—'}`,
        `أيام مسجلة: ${s.days} | حاضر: ${s.present}`,
        `نسي خروج: ${s.miss_out} | نسي دخول: ${s.miss_in}`,
        `إجمالي الساعات: ${h}:${String(mm).padStart(2, '0')}`,
        '━━━━━━━━━━',
        ...(dayLines.length ? dayLines : ['لا سجلات في هذه الفترة']),
        ...(rangeNote ? [rangeNote] : []),
    ].join('\n');
}

/** رصيد صنف بالاسم: «مخزون دجاج» — بحث + تفاصيل */
async function hrStockLookup(pool, cfg, store, args, rec) {
    const norm = (s) => String(s || '').replace(/[ً-ٰٟ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase().trim().replace(/\s+/g, ' ');
    const q = norm(args);
    if (!q) {return 'اكتب اسم الصنف: مخزون <اسم الصنف> — مثال: مخزون دجاج';}
    const rows = (await withTimeout(pool.query(
        `SELECT id, name, category, unit, COALESCE(qty,0)::float AS qty,
                COALESCE("avgCost",0)::float AS cost, COALESCE("minQty",0)::float AS minq, barcode
           FROM inventory ORDER BY id LIMIT 2000`), cfg.erpTimeoutMs, 'ERP')).rows;
    const hits = rows.filter((r) => { const n = norm(r.name); return n && (n.includes(q) || q.includes(n)); }).slice(0, 6);
    if (!hits.length) {return `لا يوجد صنف باسم «${args.trim()}».`;}
    if (hits.length > 1) {
        const lines = [`أصناف تطابق (${hits.length}) — حدد:`];
        for (const r of hits) {lines.push(`- ${r.name}: ${Number(r.qty).toLocaleString('en-US')} ${r.unit || ''}`);}
        return lines.join('\n').slice(0, 1500);
    }
    const r = hits[0];
    const f = (n) => Number(n || 0).toLocaleString('en-US');
    const state = Number(r.qty) <= 0 ? 'نافذ!' : (Number(r.minq) > 0 && Number(r.qty) <= Number(r.minq) ? 'منخفض' : 'متوفر');
    try { await store.logEvent('erp_command', rec.remoteJid, `stock_lookup:${r.name}`); } catch (_) {}
    return [
        `${r.name}`,
        `الرصيد: ${f(r.qty)} ${r.unit || ''} (${state})`,
        `الفئة: ${r.category || '—'} | الحد الأدنى: ${f(r.minq)}`,
        `متوسط التكلفة: ${f(r.cost)} | القيمة: ${f(Number(r.qty) * Number(r.cost))}`,
    ].join('\n');
}

/** أرقام المديرين المصرح لهم بتقرير واتساب — من قايمة الإدارة (بداية من البيئة + wa_settings) - كلها حقيقية من DB */
async function isManagerChat(remoteJid, senderPn) {
    const cands = [
        String(senderPn || '').replace(/\D/g, ''),
        String(remoteJid || '').split('@')[0].split(':')[0].replace(/\D/g, ''),
    ].filter((d) => d.length >= 7);
    if (!cands.length) {return false;}
    const list = await store.managerJids();
    return list.some((m) => cands.some((num) => num === m || num.endsWith(m) || m.endsWith(num)));
}
function managerJids() {
    return String(process.env.WHATSAPP_MANAGER_JIDS || '')
        .split(',').map((s) => s.replace(/\D/g, '')).filter((s) => s.length >= 7);
}

/** تنفيذ أمر ERP من الشات — يُرجع نص الرد أو null */
async function runCommand(engine, hit, rec) {
    const cfg = engine.getConfig();
    const name = String(hit.rule.name || '');
    const args = String(hit.args || '').trim().slice(0, 60);
    try {
        if (/تقرير|تقرير المدير|report/i.test(name)) {
            if (!(await isManagerChat(rec.remoteJid, rec.senderPn))) {
                try { await store.logEvent('report_denied', rec.remoteJid, ''); } catch (_) {}
                return 'عذرًا — تقرير المدير متاح لرقم الإدارة فقط.';
            }
            const { collectBriefing, formatWhatsapp } = require('../manager-briefing');
            const b = await withTimeout(
                collectBriefing(pool, undefined).catch((e) => { throw e; }),
                Math.min(60000, cfg.erpTimeoutMs * 4), 'ERP'
            );
            try { await store.logEvent('erp_command', rec.remoteJid, 'briefing'); } catch (_) {}
            return formatWhatsapp(b);
        }
        if (/مخزن|مستودع|stock|inventory/i.test(name)) {
            if (!(await isManagerChat(rec.remoteJid, rec.senderPn))) {
                return 'عذرًا — بيانات المخزن متاحة لرقم الإدارة فقط.';
            }
            if (args) {return hrStockLookup(pool, cfg, store, args, rec);}
            const { collectBriefing } = require('../manager-briefing');
            const b = await withTimeout(collectBriefing(pool, undefined), Math.min(60000, cfg.erpTimeoutMs * 4), 'ERP');
            try { await store.logEvent('erp_command', rec.remoteJid, 'stock'); } catch (_) {}
            const f = (n) => Number(n || 0).toLocaleString('en-US');
            const lines = [`مخزن اليوم ${b.day}`, `نافذ: ${b.stockOut.length} | منخفض: ${b.stockLow.length} | سينفد قريبًا: ${b.forecast.length}`];
            for (const s of b.stockOut.slice(0, 5)) {lines.push(`- نافذ: ${s.name}`);}
            for (const s of b.forecast.slice(0, 5)) {lines.push(`- سينفد (${s.days_cover} يوم): ${s.name} — رصيد ${f(s.qty)} ${s.unit || ''}`);}
            return lines.join('\n').slice(0, 3500);
        }
        if (/حضور|حاضر|غايب|غائب|attendance/i.test(name)) {
            if (!(await isManagerChat(rec.remoteJid, rec.senderPn))) {
                return 'عذرًا — بيانات الحضور متاحة لرقم الإدارة فقط.';
            }
            if (args) {return hrAttendanceLookup(pool, cfg, store, args, rec);}
            const { collectBriefing } = require('../manager-briefing');
            const b = await withTimeout(collectBriefing(pool, undefined), Math.min(60000, cfg.erpTimeoutMs * 4), 'ERP');
            try { await store.logEvent('erp_command', rec.remoteJid, 'attendance'); } catch (_) {}
            const a = b.attendance || {};
            return [
                `حضور اليوم ${b.day}`,
                `حاضر: ${a.checked_in || 0}`,
                `نسي بصمة الخروج: ${a.missing_out || 0}`,
                `نسي بصمة الدخول: ${a.missing_in || 0}`,
                `معلق: إجازات ${b.pending.leavesPending} | ورديات مفتوحة ${b.pending.openShifts}`,
            ].join('\n');
        }
        if (/موظفين|موظف|employees|staff/i.test(name)) {
            if (!(await isManagerChat(rec.remoteJid, rec.senderPn))) {
                return 'عذرًا — بيانات الموظفين متاحة لرقم الإدارة فقط.';
            }
            const t = await withTimeout(pool.query(
                `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='active')::int AS active,
                        COALESCE(SUM(CASE WHEN status='active' THEN salary ELSE 0 END),0)::float AS salaries
                   FROM employees`), cfg.erpTimeoutMs, 'ERP');
            const d = await withTimeout(pool.query(
                `SELECT COALESCE(h.name, e.department, '—') AS dept, COUNT(*)::int AS c
                   FROM employees e LEFT JOIN "hrDepartments" h ON h.code = e.department
                  WHERE e.status='active' GROUP BY h.name, e.department ORDER BY c DESC LIMIT 8`),
                cfg.erpTimeoutMs, 'ERP');
            try { await store.logEvent('erp_command', rec.remoteJid, 'employees'); } catch (_) {}
            const f = (n) => Number(n || 0).toLocaleString('en-US');
            const lines = [`موظفين: إجمالي ${t.rows[0].total} | نشط ${t.rows[0].active} | رواتب ${f(t.rows[0].salaries)}`];
            for (const r of d.rows) {lines.push(`- ${r.dept}: ${r.c}`);}
            return lines.join('\n').slice(0, 3500);
        }
        if (/رواتب|راتب|salary|payroll/i.test(name)) {
            if (!(await isManagerChat(rec.remoteJid, rec.senderPn))) {
                return 'عذرًا — بيانات الرواتب متاحة لرقم الإدارة فقط.';
            }
            const t = await withTimeout(pool.query(
                `SELECT COUNT(*) FILTER (WHERE status='active')::int AS active,
                        COALESCE(SUM(CASE WHEN status='active' THEN salary ELSE 0 END),0)::float AS total,
                        COALESCE(AVG(CASE WHEN status='active' THEN salary ELSE NULL END),0)::float AS avg
                   FROM employees`), cfg.erpTimeoutMs, 'ERP');
            try { await store.logEvent('erp_command', rec.remoteJid, 'payroll'); } catch (_) {}
            const f = (n) => Number(n || 0).toLocaleString('en-US');
            const r = t.rows[0];
            return `رواتب (${r.active} نشط)\nالإجمالي: ${f(r.total)}\nالمتوسط: ${f(Math.round(r.avg))}`;
        }
        if (/إجازات|اجازات|اجازه|إجازة|leave/i.test(name)) {
            if (!(await isManagerChat(rec.remoteJid, rec.senderPn))) {
                return 'عذرًا — بيانات الإجازات متاحة لرقم الإدارة فقط.';
            }
            const t = await withTimeout(pool.query(
                `SELECT l."startDate" AS s, l."endDate" AS e, COALESCE(e2.name, l."employeeId"::text) AS who,
                        COALESCE(l.reason,'') AS reason
                   FROM "leaveRequests" l LEFT JOIN employees e2 ON e2.id::text = l."employeeId"::text
                  WHERE l.status = 'pending' ORDER BY l."startDate" LIMIT 10`), cfg.erpTimeoutMs, 'ERP');
            try { await store.logEvent('erp_command', rec.remoteJid, 'leaves'); } catch (_) {}
            if (!t.rows.length) {return 'لا توجد طلبات إجازة معلقة ✓';}
            const lines = [`إجازات معلقة (${t.rows.length}):`];
            for (const r of t.rows) {lines.push(`- ${r.who}: ${r.s} ← ${r.e}${r.reason ? ' — ' + String(r.reason).slice(0, 60) : ''}`);}
            return lines.join('\n').slice(0, 3500);
        }
        if (/ايراد|إيراد|مبيعات الكاشير|تقفيل/i.test(name)) {
            if (!(await isManagerChat(rec.remoteJid, rec.senderPn))) {
                return 'عذرًا — بيانات الإيرادات متاحة لرقم الإدارة فقط.';
            }
            const fmtDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
            const day0 = fmtDay(new Date());
            const wantY = /امس|أمس|yesterday/i.test(args + ' ' + name);
            const day = wantY ? fmtDay(new Date(Date.now() - 86400000)) : day0;
            const f = (n) => Number(n || 0).toLocaleString('en-US');
            const cshrNum = (String(args).match(/(\d)/) || [])[1] || (String(name).match(/(\d)/) || [])[1] || '';
            try { await store.logEvent('erp_command', rec.remoteJid, `revenue:${day}:${cshrNum || 'all'}`); } catch (_) {}
            if (/تقفيل/i.test(name)) {
                const params = [day];
                let codeFilter = '';
                if (cshrNum) {
                    const mc = (await withTimeout(pool.query(
                        `SELECT dept_code FROM yarasoft_revenue_map WHERE src_table='CC' AND src_name=$1 AND active=true LIMIT 1`, [cshrNum]),
                        cfg.erpTimeoutMs, 'ERP')).rows[0];
                    if (!mc) {return `لا يوجد كاشير ${cshrNum} مسجل. الكاشيرات: 1، 4، 5، 6، 9.`;}
                    params.push(mc.dept_code); codeFilter = 'AND pd.code = $2';
                }
                const r = await withTimeout(pool.query(
                    `SELECT COALESCE(pd.name_ar, m.display_ar, pd.code) AS name, d.method,
                            COALESCE(SUM(d.gross_amount),0)::float AS gross, COALESCE(SUM(d.refund_amount),0)::float AS refund,
                            COALESCE(SUM(d.invoice_count),0)::int AS n
                       FROM pos_department_daily_revenues d JOIN pos_departments pd ON pd.id = d.department_id
                       LEFT JOIN (SELECT DISTINCT ON (dept_code) dept_code, display_ar FROM yarasoft_revenue_map WHERE active=true ORDER BY dept_code, id) m ON m.dept_code = pd.code
                      WHERE d.revenue_date = $1 ${codeFilter} GROUP BY 1, 2 ORDER BY 3 DESC`, params),
                    cfg.erpTimeoutMs, 'ERP');
                if (!r.rows.length) {return `لا يوجد تقفيل مسجل ليوم ${day} — شغّل تعبئة الإغلاق من صفحة استيراد Yarasoft.`;}
                const lines = [`تقفيل ${day}`];
                for (const x of r.rows.slice(0, 20)) {lines.push(`- ${x.name} [${x.method}]: ${f(x.gross)} (${f(x.n)} فاتورة)`);}
                return lines.join('\n').slice(0, 3500);
            }
            const params = [day];
            let codeFilter = '';
            if (cshrNum) {
                const mc = (await withTimeout(pool.query(
                    `SELECT dept_code, display_ar FROM yarasoft_revenue_map WHERE src_table='CC' AND src_name=$1 AND active=true LIMIT 1`, [cshrNum]),
                    cfg.erpTimeoutMs, 'ERP')).rows[0];
                if (!mc) {return `لا يوجد كاشير ${cshrNum} مسجل. الكاشيرات: 1، 4، 5، 6، 9.`;}
                params.push(mc.dept_code); codeFilter = 'AND r."deptId" = $2';
            }
            const r = await withTimeout(pool.query(
                `SELECT COALESCE(m.display_ar, r."deptId") AS name, COUNT(*)::int AS n, COALESCE(SUM(r.amount),0)::float AS total
                   FROM revenues r LEFT JOIN (SELECT DISTINCT ON (dept_code) dept_code, display_ar FROM yarasoft_revenue_map WHERE active=true ORDER BY dept_code, id) m ON m.dept_code = r."deptId"
                  WHERE r.date = $1 AND r."deptId" != 'ys_b4_ext' ${codeFilter} GROUP BY 1 ORDER BY 3 DESC`, params),
                cfg.erpTimeoutMs, 'ERP');
            if (!r.rows.length) {return `لا إيرادات مسجلة ليوم ${day}.`;}
            const tot = r.rows.reduce((s, x) => s + Number(x.total || 0), 0);
            const lines = [`إيراد ${day}: ${f(Math.round(tot))}`];
            for (const x of r.rows.slice(0, 12)) {lines.push(`- ${x.name}: ${f(Math.round(x.total))} (${f(x.n)})`);}
            return lines.join('\n').slice(0, 3500);
        }
        if (/وثائق|وثايق|مستندات|اوراق|documents/i.test(name)) {
            if (!(await isManagerChat(rec.remoteJid, rec.senderPn))) {
                return 'عذرًا — بيانات الوثائق متاحة لرقم الإدارة فقط.';
            }
            const t = await withTimeout(pool.query(
                `SELECT name,
                        CASE WHEN "iqamaExpiry" IS NOT NULL AND "iqamaExpiry" <> '' AND ("iqamaExpiry")::date <= CURRENT_DATE + 30 THEN "iqamaExpiry" END AS iq,
                        CASE WHEN "healthCertExpiry" IS NOT NULL AND "healthCertExpiry" <> '' AND ("healthCertExpiry")::date <= CURRENT_DATE + 30 THEN "healthCertExpiry" END AS hc,
                        CASE WHEN "healthEduExpiry" IS NOT NULL AND "healthEduExpiry" <> '' AND ("healthEduExpiry")::date <= CURRENT_DATE + 30 THEN "healthEduExpiry" END AS he
                   FROM employees WHERE status='active' AND (
                     ("iqamaExpiry" IS NOT NULL AND "iqamaExpiry" <> '' AND ("iqamaExpiry")::date <= CURRENT_DATE + 30) OR
                     ("healthCertExpiry" IS NOT NULL AND "healthCertExpiry" <> '' AND ("healthCertExpiry")::date <= CURRENT_DATE + 30) OR
                     ("healthEduExpiry" IS NOT NULL AND "healthEduExpiry" <> '' AND ("healthEduExpiry")::date <= CURRENT_DATE + 30))
                  ORDER BY name LIMIT 15`), cfg.erpTimeoutMs, 'ERP');
            try { await store.logEvent('erp_command', rec.remoteJid, 'documents'); } catch (_) {}
            if (!t.rows.length) {return 'لا وثائق تنتهي خلال 30 يوم ✓';}
            const flag = (d) => { if (!d) {return '';} const past = String(d).slice(0, 10) < new Date().toISOString().slice(0, 10); return `${d}${past ? ' (منتهية!)' : ''}`; };
            const lines = [`وثائق تنتهي خلال 30 يوم (${t.rows.length}):`];
            for (const r of t.rows) {
                const parts = [];
                if (r.iq) {parts.push(`إقامة ${flag(r.iq)}`);}
                if (r.hc) {parts.push(`صحية ${flag(r.hc)}`);}
                if (r.he) {parts.push(`تثقيف ${flag(r.he)}`);}
                lines.push(`- ${r.name}: ${parts.join('، ')}`);
            }
            return lines.join('\n').slice(0, 3500);
        }
        if (/نواقص|ناقص|غياب|gaps/i.test(name)) {
            if (!(await isManagerChat(rec.remoteJid, rec.senderPn))) {
                return 'عذرًا — بيانات النواقص متاحة لرقم الإدارة فقط.';
            }
            const { collectBriefing } = require('../manager-briefing');
            const b = await withTimeout(collectBriefing(pool, undefined), Math.min(60000, cfg.erpTimeoutMs * 4), 'ERP');
            try { await store.logEvent('erp_command', rec.remoteJid, 'gaps'); } catch (_) {}
            const a = b.attendance || {};
            return [
                `نواقص اليوم ${b.day}`,
                `نسي خروج: ${a.missing_out || 0} | نسي دخول: ${a.missing_in || 0}`,
                `أقسام تنتظر اعتماد: ${b.pending.unmappedSections}`,
                `أصناف تنتظر مراجعة: ${b.pending.reviewItems}`,
            ].join('\n');
        }
        if (/حالة طلب|order/i.test(name)) {
            const raw = String(args || '').trim();
            const num = raw.replace(/[^\d]/g, '').slice(0, 20);
            const uuid = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
            if (!num && !uuid) {return 'أرسلوا: حالة طلب <رقم الفاتورة> — مثال: حالة طلب 1234';}
            let o = null;
            if (num) {
                const r = await withTimeout(
                    pool.query(`SELECT id, status, total_amount, currency_code, invoice_counter FROM pos_orders WHERE invoice_counter = $1 LIMIT 1`, [Number(num)]),
                    cfg.erpTimeoutMs, 'ERP'
                );
                o = r.rows[0] || null;
            }
            if (!o && uuid) {
                const r = await withTimeout(
                    pool.query(`SELECT id, status, total_amount, currency_code, invoice_counter FROM pos_orders WHERE id = $1 LIMIT 1`, [uuid[0].toLowerCase()]),
                    cfg.erpTimeoutMs, 'ERP'
                );
                o = r.rows[0] || null;
            }
            if (!o) {return `لا يوجد طلب برقم ${num || raw} لدينا.`;}
            try { await store.logEvent('erp_command', rec.remoteJid, `order_status:${num || uuid[0]}`); } catch (_) {}
            const st = ORDER_STATUS_AR[String(o.status)] || String(o.status);
            const label = o.invoice_counter != null ? `طلب رقم ${o.invoice_counter}` : `طلب ${o.id}`;
            return `${label}: ${st} — الإجمالي ${Number(o.total_amount || 0)} ${o.currency_code || 'SAR'}.`;
        }
        return null;
    } catch (e) {
        logger.warn('[WHATSAPP] ERP command failed: ' + String(e.message).slice(0, 150));
        return 'تعذر الوصول لبيانات النظام حاليًا — حاولوا بعد قليل.';
    }
}

/** بناء الرد: استجابة ثابتة أو أمر ERP */
async function buildReply(engine, hit, rec) {
    if (hit.rule.match_type === 'command') {return runCommand(engine, hit, rec);}
    return hit.rule.response || null;
}

/** إشعار صادر من حدث ERP (opt-in لكل شات) — يُستخدم من وحدات النظام */
async function notify(engine, remoteJid, text, meta = {}) {
    const { isValidChatJid } = require('./rules');
    const { clientKeyFor } = require('./pipeline');
    if (!isValidChatJid(remoteJid)) {throw Object.assign(new Error('JID غير صالح'), { code: 'INVALID_JID' });}
    const clean = String(text || '').trim().slice(0, 4000);
    if (!clean) {throw Object.assign(new Error('نص فارغ'), { code: 'EMPTY_BODY' });}
    const out = await engine.sender.enqueue(remoteJid, clean, {
        clientKey: clientKeyFor(remoteJid, `${meta.key || clean}`),
        createdBy: meta.by || null,
    });
    try { await store.logEvent('notify_queued', remoteJid, meta.key || ''); } catch (_) {}
    return out;
}

module.exports = { buildReply, runCommand, notify, isManagerChat, managerJids, hrAttendanceLookup, hrStockLookup, withTimeout };
