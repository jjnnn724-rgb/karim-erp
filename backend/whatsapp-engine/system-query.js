/**
 * whatsapp-engine/system-query.js — محرك الاستعلامات الذكية للنظام
 * ═══════════════════════════════════════════════════════════════
 * يستقبل سؤالاً بالعربية أو الإنجليزية، يحلله ويعيد بيانات من قاعدة البيانات.
 * يدعم: الحضور، الإيرادات، المخزون، الموظفين، المصاريف، حالة السيرفر
 *
 * هيكل قاعدة البيانات الفعلي:
 *   employees: id, name, status, shift_start
 *   attendance: employeeId, date, checkIn, checkOut, late, workMinutes
 *   revenues: id, deptId, amount, date, source
 *   expenses: id, amount, date, category, desc
 *   pos_products: id, name, price, stock_quantity, is_active, category
 */
'use strict';

const { pool } = require('../shared-pool');
const { logger } = require('../logger');
const { normalizeText } = require('./rules');
const { withTimeout } = require('./erp');

const ERP_TIMEZONE = 'Asia/Riyadh';

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toLocalDateKey(date, timeZone = ERP_TIMEZONE) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const values = {};
    for (const part of parts) {
        if (part.type !== 'literal') {values[part.type] = part.value;}
    }
    return `${values.year}-${values.month}-${values.day}`;
}

function addDays(baseDate, offsetDays) {
    const d = new Date(baseDate.getTime());
    d.setUTCDate(d.getUTCDate() + offsetDays);
    return d;
}

function parseDateValue(raw) {
    if (!raw) {return null;}
    if (typeof raw === 'string') {
        const s = raw.trim();
        if (!s) {return null;}
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {return s;}
        const m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
        if (m) {
            let year = Number(m[3] || new Date().getFullYear());
            if (year < 100) {year += 2000;}
            const month = Number(m[2]);
            const day = Number(m[1]);
            if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            }
        }
    }
    if (raw instanceof Date) {
        return toLocalDateKey(raw, ERP_TIMEZONE);
    }
    return null;
}

function rangeFromDateKeywords(rawText, baseDate = new Date()) {
    const text = normalizeText(rawText || '').replace(/\s+/g, ' ');
    const currentDate = new Date(baseDate.getTime());
    const todayKey = toLocalDateKey(currentDate, ERP_TIMEZONE);
    const yesterday = addDays(currentDate, -1);
    const dayBeforeYesterday = addDays(currentDate, -2);

    if (/اليوم|today/.test(text)) {
        return { date_from: todayKey, date_to: todayKey, scope: 'DAILY' };
    }
    if (/(امس|أمس|yesterday)/.test(text)) {
        return { date_from: toLocalDateKey(yesterday, ERP_TIMEZONE), date_to: toLocalDateKey(yesterday, ERP_TIMEZONE), scope: 'DAILY' };
    }
    if (/(اول امس|أول امس|day before yesterday|before yesterday)/.test(text)) {
        return { date_from: toLocalDateKey(dayBeforeYesterday, ERP_TIMEZONE), date_to: toLocalDateKey(dayBeforeYesterday, ERP_TIMEZONE), scope: 'DAILY' };
    }

    const explicitRange = text.match(/(?:من\s+)?([^\n]+?)\s*(?:إلى|الى)\s*([^\n]+)$/);
    if (explicitRange) {
        const from = parseDateValue(explicitRange[1]);
        const to = parseDateValue(explicitRange[2]);
        if (from && to) {
            return { date_from: from, date_to: to, scope: 'RANGE' };
        }
    }

    const directDate = text.match(/(?:بتاريخ|في|يوم|date)?\s*(\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?)$/);
    if (directDate) {
        const iso = parseDateValue(directDate[1]);
        if (iso) {
            return { date_from: iso, date_to: iso, scope: 'DAILY' };
        }
    }

    const fromDate = text.match(/(?:من\s+)(\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?)/);
    const toDate = text.match(/(?:إلى|الى)\s*(\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?)/);
    if (fromDate && toDate) {
        const from = parseDateValue(fromDate[1]);
        const to = parseDateValue(toDate[1]);
        if (from && to) {
            return { date_from: from, date_to: to, scope: 'RANGE' };
        }
    }

    const isoMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) {
        return { date_from: isoMatch[1], date_to: isoMatch[1], scope: 'DAILY' };
    }

    return { date_from: todayKey, date_to: todayKey, scope: 'DAILY' };
}

function extractEmployeeIdentifier(text) {
    const t = String(text || '');
    const idMatch = t.match(/(?:موظف|الموظف|employee|emp)[\s\W]+(\d{1,10})/i);
    if (idMatch) {
        return { employeeId: idMatch[1], employee: null };
    }

    const noise = new Set([
        'حضور', 'دخول', 'خروج', 'غياب', 'تأخير', 'امس', 'أمس', 'اليوم', 'يوم', 'تاريخ', 'بتاريخ', 'من', 'الى', 'إلى', 'و', 'وال', 'ال', 'employee', 'emp', 'employees', 'موظف', 'الموظف', 'ايراد', 'ايرادات', 'مبيعات', 'sales', 'revenue', 'invoice', 'فواتير', 'تقرير', 'تقارير', 'today', 'yesterday', 'before', 'yesterday', 'date', 'at', 'on', 'in', 'مستحق', 'check', 'in', 'out', 'entry', 'exit', 'query', 'استعلام'
    ]);

    const tokens = t
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => {
            if (!token) {return false;}
            const base = normalizeText(String(token)).replace(/^و+/, '').replace(/^ال+/, '').trim();
            if (noise.has(normalizeText(token)) || noise.has(base)) {return false;}
            if (base.length <= 2 && /^(?:ات|و|ال)$/i.test(base)) {return false;}
            if (/^\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?$/.test(token)) {return false;}
            if (/^\d{4}-\d{2}-\d{2}$/.test(token)) {return false;}
            if (/^(?:num|number|رقم)$/i.test(token)) {return false;}
            return base.length > 1;
        });

    const candidate = tokens.join(' ');
    if (candidate && !/^(?:اليوم|امس|أمس|today|yesterday|date|تاريخ|\d+)/i.test(candidate)) {
        return { employee: candidate, employeeId: null };
    }
    return { employee: null, employeeId: null };
}

function buildControlledIntent(text) {
    const raw = String(text || '');
    const normalized = normalizeText(raw);
    const range = rangeFromDateKeywords(raw);
    const employeeInfo = extractEmployeeIdentifier(raw);
    const isAttendance = /(حضور|دخول|خروج|غياب|تأخير|check in|check out|attendance|presence)/i.test(raw);
    const isRevenue = /(إيراد|إيرادات|مبيعات|مبيعات|revenue|sales|فواتير|invoice)/i.test(raw);
    const intent = isAttendance ? 'ATTENDANCE_QUERY' : isRevenue ? 'REVENUE_QUERY' : 'SYSTEM_QUERY';
    const includesCheckIn = /(دخول|check in|checkin|entry)/i.test(raw);
    const includesCheckOut = /(خروج|check out|checkout|exit)/i.test(raw);

    return {
        intent,
        employee: employeeInfo.employee || null,
        employeeId: employeeInfo.employeeId || null,
        date_from: range.date_from,
        date_to: range.date_to,
        scope: range.scope,
        include_check_in: isAttendance ? Boolean(includesCheckIn || !includesCheckOut) : false,
        include_check_out: isAttendance ? Boolean(includesCheckOut || !includesCheckIn) : false,
        category: isAttendance ? 'attendance' : isRevenue ? 'revenue' : 'system',
        raw,
        normalized,
    };
}

async function canAccessErpReport(userPermissions = []) {
    const perms = Array.isArray(userPermissions) ? userPermissions : [];
    if (!perms.length) {return true;}
    return perms.some((p) => ['attendance.read', 'revenue.read', 'sales.read', 'reports.read'].includes(String(p)));
}

// ─── أنماط الاستعلامات ───
const QUERY_PATTERNS = {
    attendance: {
        keywords: ['حضور', 'تأخير', 'متأخر', 'غائب', 'إجازة', 'غياب', 'موظف شغال'],
        category: 'attendance',
        label: 'الحضور'
    },
    revenue: {
        keywords: ['إيراد', 'مبيع', 'مبيعات', 'إيرادات', 'إجمالي', 'فواتير', 'مردود', 'دخل'],
        category: 'revenue',
        label: 'الإيرادات'
    },
    inventory: {
        keywords: ['مخزون', 'منتج', 'بضاعة', 'مخزوني', 'المخزون', 'المتبقي', 'المخزون الكلي', 'المنتجات'],
        category: 'inventory',
        label: 'المخزون'
    },
    employees: {
        keywords: ['موظف', 'موظفين', 'عامل', 'عمال', 'عدد الموظفين'],
        category: 'employees',
        label: 'الموظفين'
    },
    financial: {
        keywords: ['مصروف', 'مصاريف', 'صرف', 'الربح', 'الخسارة', 'أرباح', 'أربح', 'pnl'],
        category: 'financial',
        label: 'المالية'
    },
    documents: {
        keywords: ['وثيقه', 'وثائق', 'مستند', 'اقامه', 'شهاده صحيه', 'تثقيف', 'منتهيه'],
        category: 'documents',
        label: 'الوثائق'
    },
    gaps: {
        keywords: ['نواقص', 'ناقص', 'نسي', 'معلق', 'معلقات', 'سينفد', 'نافذ'],
        category: 'gaps',
        label: 'النواقص'
    },
    system: {
        keywords: ['سيرفر', 'حالة', 'عملاء', 'زبائن', 'المشتركين', 'عدد العملاء'],
        category: 'system',
        label: 'نظام'
    }
};

// ─── محلل الأسئلة ───
function parseQuestion(text) {
    const raw = String(text || '');
    const t = normalizeText(raw);
    const matched = [];
    for (const [cat, cfg] of Object.entries(QUERY_PATTERNS)) {
        for (const kw of cfg.keywords) {
            if (t.includes(normalizeText(kw))) { matched.push({ category: cat, label: cfg.label, keyword: kw }); break; }
        }
    }

    const dates = [];
    const dateRegex = /(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/g;
    let m;
    while ((m = dateRegex.exec(raw)) !== null) {
        const d = parseInt(m[1], 10);
        const mo = parseInt(m[2], 10);
        const yVal = parseInt(m[3] || new Date().getFullYear(), 10);
        const year = yVal < 100 ? yVal + 2000 : yVal;
        if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
            dates.push(`${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
        }
    }

    const intentMeta = buildControlledIntent(raw);
    const employeeInfo = extractEmployeeIdentifier(raw);
    const allKeywords = ['حضور', 'تأخير', 'إجازة', 'غياب', 'حاضر', 'متأخر', 'غير', 'غائب', 'إجمالي', 'إيراد', 'إيرادات', 'مبيع', 'مبيعات', 'مخزون', 'موظف', 'مصروف', 'ربح', 'خسارة', 'أرباح', 'أربح', 'pnl', 'سيرفر', 'حالة', 'عميل', 'زبون', 'وثائق', 'وثيقه', 'نواقص', 'ناقص', 'معلق', 'اليوم', 'أمس', 'امس', 'دخول', 'خروج'];
    const nameText = raw
        .split(/\s+/)
        .filter((token) => {
            const base = normalizeText(String(token)).replace(/^و+/, '').replace(/^ال+/, '').trim();
            if (!token || !base) {return false;}
            if (allKeywords.some((kw) => normalizeText(kw) === base)) {return false;}
            if (/^(?:اليوم|امس|أمس|today|yesterday|date|تاريخ|من|الى|إلى|يوم|بتاريخ|في|on|at|check|entry|exit|revenue|sales|invoice|report|تقرير|و|ال)$/i.test(base)) {return false;}
            if (/^\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?$/.test(token)) {return false;}
            if (/^\d{4}-\d{2}-\d{2}$/.test(token)) {return false;}
            return base.length > 1;
        })
        .join(' ')
        .trim();
    const empName = employeeInfo.employee || nameText.split(/\s+/).filter(Boolean).slice(0, 3).join(' ');

    return {
        ...intentMeta,
        categories: matched.length ? matched : [{ category: 'system', label: 'نظام' }],
        dates,
        empName: empName || null,
        employee: employeeInfo.employee || empName || null,
        employeeId: employeeInfo.employeeId || null,
        date_from: intentMeta.date_from || (dates[0] || null),
        date_to: intentMeta.date_to || (dates[dates.length - 1] || null),
        raw,
    };
}

// ─── مُشكّلات الاستجابة ───
function fmt(val, unit = '') {
    if (val == null || isNaN(val)) {return '—';}
    return `${Number(val).toLocaleString('ar-EG')}${unit}`;
}

function makeCard(title, rows, footer = '') {
    const tr = rows.map(r => `<tr><td>${r.label || ''}</td><td style="text-align:right">${r.value || ''}</td></tr>`).join('');
    return `<div class="mcard"><b>${title}</b><table style="width:100%;margin-top:8px">${tr}</table>${footer ? `<small class="text-muted" style="margin-top:6px;display:block">${footer}</small>` : ''}</div>`;
}

function formatAttendanceEntrySummary(row = {}) {
    const employeeName = row.employeeName || row.name || 'الموظف';
    const date = row.date || 'اليوم';
    const checkIn = row.checkIn || 'لم يسجل دخول';
    const checkOut = row.checkOut || 'لم يسجل خروج';
    const shiftStart = row.shift_start || '—';
    const lateState = row.late ? 'متأخر' : 'في الوقت';
    let hoursText = '';
    if (row.workMinutes != null && !Number.isNaN(Number(row.workMinutes))) {
        const mins = Number(row.workMinutes);
        const hours = Math.floor(mins / 60);
        const rem = mins % 60;
        hoursText = ` | ساعات: ${hours}:${String(rem).padStart(2, '0')}`;
    }
    return [
        `👤 ${employeeName}`,
        `التاريخ: ${date}`,
        `دخول: ${checkIn}`,
        `خروج: ${checkOut}`,
        `الوردية: ${shiftStart}`,
        `الحالة: ${lateState}${hoursText}`,
    ].join('\n');
}

// ─── مُنفّذي الاستعلامات ───
const QUERY_EXECUTORS = {
    // ─── الحضور ───
    async attendance(parsed) {
        const today = new Date().toISOString().slice(0, 10);
        const q = parsed.dates.length ? parsed.dates[0] : today;
        try {
            const r = await withTimeout(pool.query(`
                SELECT COUNT(*) FILTER (WHERE e.id IS NOT NULL) as total,
                    COUNT(*) FILTER (WHERE a."checkIn" IS NOT NULL) as present_count,
                    COALESCE(SUM(
                        CASE WHEN a."checkIn" IS NOT NULL THEN
                            GREATEST(0, EXTRACT(EPOCH FROM ((a."checkIn")::time - e."shift_start"::time)) / 60)::integer
                        ELSE 0 END
                    ), 0)::bigint as total_delay_minutes,
                    COALESCE(ROUND(AVG(
                        CASE WHEN a."checkIn" IS NOT NULL THEN
                            GREATEST(0, EXTRACT(EPOCH FROM ((a."checkIn")::time - e."shift_start"::time)) / 60)::numeric
                        ELSE NULL END
                    )), 0) as avg_delay_minutes
                FROM employees e
                LEFT JOIN attendance a ON a."employeeId" = e.id AND a.date = $1
                WHERE e.status = 'active'
            `, [q]), 5000, 'ATTENDANCE');
            const row = r.rows[0];
            const delayH = Math.floor(row.total_delay_minutes / 60);
            const delayM = row.total_delay_minutes % 60;
            return makeCard(`📊 تقرير الحضور — ${q}`, [
                { label: 'الموظفين النشطين', value: fmt(row.total) },
                { label: 'حاضرين اليوم', value: fmt(row.present_count) },
                { label: 'إجمالي التأخير', value: `${delayH}h ${delayM}m` },
                { label: 'معدل التأخير', value: `${Math.round(row.avg_delay_minutes)} دقيقة` }
            ], `للاستعلام عن موظف معين: اكتب "حضور <الاسم>"`);
        } catch (e) {
            logger.error('[QUERY] attendance:', e.message);
            return '<div class="mcard" style="border:2px solid var(--red)"><b style="color:var(--red)">❌ تعذر جلب بيانات الحضور</b></div>';
        }
    },

    // حضور موظف معين
    async attendanceEmp(parsed) {
        const today = new Date().toISOString().slice(0, 10);
        const name = parsed.empName;
        if (!name) {return '<div class="mcard">اكتب اسم الموظف: "حضور أحمد"</div>';}
        try {
            const r = await withTimeout(pool.query(`
                SELECT e.name AS employeeName, e."shift_start" AS shift_start, a.date, a."checkIn", a."checkOut", a."workMinutes", a.late
                FROM employees e
                LEFT JOIN attendance a ON a."employeeId" = e.id
                WHERE e.name ILIKE $1 AND e.status = 'active'
                ORDER BY a.date DESC NULLS LAST
                LIMIT 5
            `, [`%${name}%`]), 5000, 'ATTENDANCE_EMP');
            const rows = r.rows.filter((row) => row.date !== null);
            if (!rows.length) {return `<div class="mcard">لا يوجد موظف باسم "${name}"</div>`;}
            const latest = rows[0];
            const lastChecks = rows.slice(0, 3).map((row) => `• ${row.date}: دخول ${row.checkIn || '—'} | خروج ${row.checkOut || '—'}`).join('<br>');
            return makeCard(`📊 حضور ${latest.employeeName}`, [
                { label: 'آخر دخول', value: latest.checkIn || 'لم يسجل دخول' },
                { label: 'آخر خروج', value: latest.checkOut || 'لم يسجل خروج' },
                { label: 'تاريخ', value: latest.date },
                { label: 'الوردية', value: latest.shift_start || '—' },
                { label: 'الحالة', value: latest.late ? 'متأخر' : 'في الوقت' },
            ], `آخر السجلات:<br>${lastChecks}`);
        } catch (e) {
            logger.error('[QUERY] attendanceEmp:', e.message);
            return '<div class="mcard" style="border:2px solid var(--red)"><b style="color:var(--red)">❌ تعذر البحث</b></div>';
        }
    },

    // ─── الإيرادات ───
    async revenue(parsed) {
        const today = new Date().toISOString().slice(0, 10);
        const q = parsed.dates.length ? parsed.dates[0] : today;
        try {
            const r = await withTimeout(pool.query(`
                SELECT COALESCE(SUM(amount::numeric), 0) as revenue, COUNT(*) as orders
                FROM revenues
                WHERE date = $1 AND "deptId" != 'ys_b4_ext'
            `, [q]), 5000, 'REVENUE');
            const row = r.rows[0];
            const r2 = await withTimeout(pool.query(`
                SELECT COALESCE(SUM(amount::numeric), 0) as month_rev, COUNT(*) as month_orders
                FROM revenues
                WHERE date >= DATE_TRUNC('month', CURRENT_DATE)::text AND "deptId" != 'ys_b4_ext'
            `), 5000, 'REVENUE_MONTH');
            const mr = r2.rows[0];
            return makeCard(`💰 تقرير الإيرادات`, [
                { label: 'اليوم', value: `💵 ${fmt(row.revenue)}` },
                { label: 'عدد المعاملات', value: fmt(row.orders) },
                { label: 'هذا الشهر', value: `💵 ${fmt(mr.month_rev)}` },
                { label: 'معاملات الشهر', value: fmt(mr.month_orders) }
            ]);
        } catch (e) {
            logger.error('[QUERY] revenue:', e.message);
            return '<div class="mcard" style="border:2px solid var(--red)"><b style="color:var(--red)">❌ تعذر جلب الإيرادات</b></div>';
        }
    },

    // ─── المخزون ───
    async inventory(parsed) {
        try {
            const r = await withTimeout(pool.query(`
                SELECT COUNT(*) FILTER (WHERE is_active = true) as total_products,
                    COALESCE(SUM(stock_quantity), 0) as total_qty
                FROM pos_products
            `), 5000, 'INVENTORY');
            const row = r.rows[0];
            const r2 = await withTimeout(pool.query(`
                SELECT COALESCE(SUM(price::numeric * stock_quantity), 0) as total_value
                FROM pos_products WHERE is_active = true
            `), 5000, 'INVENTORY_VALUE');
            const rv = r2.rows[0];
            return makeCard(`📦 المخزون`, [
                { label: 'المنتجات النشطة', value: fmt(row.total_products) },
                { label: 'إجمالي الكمية', value: fmt(row.total_qty) },
                { label: 'القيمة الإجمالية', value: `💵 ${fmt(rv.total_value)}` }
            ]);
        } catch (e) {
            logger.error('[QUERY] inventory:', e.message);
            return '<div class="mcard" style="border:2px solid var(--red)"><b style="color:var(--red)">❌ تعذر جلب المخزون</b></div>';
        }
    },

    // ─── الموظفين ───
    async employees(parsed) {
        try {
            const r = await withTimeout(pool.query(`
                SELECT COUNT(*) as total,
                    COUNT(*) FILTER (WHERE status = 'active') as active,
                    COUNT(*) FILTER (WHERE status = 'inactive') as inactive
                FROM employees
            `), 5000, 'EMPLOYEES');
            const row = r.rows[0];
            return makeCard(`👥 الموظفين`, [
                { label: 'إجمالي', value: fmt(row.total) },
                { label: 'نشط', value: fmt(row.active) },
                { label: 'غير نشط', value: fmt(row.inactive) }
            ]);
        } catch (e) {
            logger.error('[QUERY] employees:', e.message);
            return '<div class="mcard" style="border:2px solid var(--red)"><b style="color:var(--red)">❌ تعذر جلب الموظفين</b></div>';
        }
    },

    // ─── المالية ───
    async financial(parsed) {
        const today = new Date().toISOString().slice(0, 10);
        try {
            const r = await withTimeout(pool.query(`
                SELECT COALESCE(SUM(amount::numeric), 0) as total_expenses, COUNT(*) as count
                FROM expenses
                WHERE date = $1
            `, [today]), 5000, 'FINANCIAL');
            const row = r.rows[0];
            const r2 = await withTimeout(pool.query(`
                SELECT COALESCE(SUM(amount::numeric), 0) as total_revenue
                FROM revenues WHERE date = $1 AND "deptId" != 'ys_b4_ext'
            `, [today]), 5000, 'FINANCIAL_REV');
            const rv = r2.rows[0];
            const profit = (rv.total_revenue || 0) - (row.total_expenses || 0);
            return makeCard(`💵 التقارير المالية — ${today}`, [
                { label: 'الإيرادات', value: `💵 ${fmt(rv.total_revenue)}` },
                { label: 'المصاريف', value: `💵 ${fmt(row.total_expenses)}` },
                { label: 'صافي الربح', value: profit >= 0 ? `✅ ${fmt(profit)}` : `❌ ${fmt(Math.abs(profit))}` }
            ]);
        } catch (e) {
            logger.error('[QUERY] financial:', e.message);
            return '<div class="mcard" style="border:2px solid var(--red)"><b style="color:var(--red)">❌ تعذر جلب البيانات المالية</b></div>';
        }
    },

    // ─── الوثائق: منتهية + تنتهي خلال 30 يوم ───
    async documents(parsed) {
        try {
            const r = await withTimeout(pool.query(`
                SELECT name,
                    CASE WHEN "iqamaExpiry" IS NOT NULL AND "iqamaExpiry" <> '' AND ("iqamaExpiry")::date <= CURRENT_DATE + 30 THEN "iqamaExpiry" END AS iq,
                    CASE WHEN "healthCertExpiry" IS NOT NULL AND "healthCertExpiry" <> '' AND ("healthCertExpiry")::date <= CURRENT_DATE + 30 THEN "healthCertExpiry" END AS hc,
                    CASE WHEN "healthEduExpiry" IS NOT NULL AND "healthEduExpiry" <> '' AND ("healthEduExpiry")::date <= CURRENT_DATE + 30 THEN "healthEduExpiry" END AS he
                   FROM employees WHERE status = 'active' AND (
                     ("iqamaExpiry" IS NOT NULL AND "iqamaExpiry" <> '' AND ("iqamaExpiry")::date <= CURRENT_DATE + 30) OR
                     ("healthCertExpiry" IS NOT NULL AND "healthCertExpiry" <> '' AND ("healthCertExpiry")::date <= CURRENT_DATE + 30) OR
                     ("healthEduExpiry" IS NOT NULL AND "healthEduExpiry" <> '' AND ("healthEduExpiry")::date <= CURRENT_DATE + 30))
                  ORDER BY name LIMIT 15`), 5000, 'DOCS');
            if (!r.rows.length) {return makeCard('📄 الوثائق', [{ label: 'الحالة', value: 'لا وثائق تنتهي خلال 30 يوم ✓' }]);}
            const today = new Date().toISOString().slice(0, 10);
            const rows = r.rows.map((x) => {
                const parts = [];
                if (x.iq) {parts.push(`إقامة ${x.iq}${String(x.iq).slice(0, 10) < today ? ' (منتهية!)' : ''}`);}
                if (x.hc) {parts.push(`صحية ${x.hc}${String(x.hc).slice(0, 10) < today ? ' (منتهية!)' : ''}`);}
                if (x.he) {parts.push(`تثقيف ${x.he}${String(x.he).slice(0, 10) < today ? ' (منتهي!)' : ''}`);}
                return { label: x.name, value: parts.join('، ') };
            });
            return makeCard(`📄 وثائق تنتهي خلال 30 يوم (${r.rows.length})`, rows);
        } catch (e) {
            logger.error('[QUERY] documents:', e.message);
            return '<div class="mcard" style="border:2px solid var(--red)"><b style="color:var(--red)">❌ تعذر جلب الوثائق</b></div>';
        }
    },

    // ─── النواقص: نسيان بصمات + أقسام معلقة + مخزون حرج ───
    async gaps(parsed) {
        try {
            const { collectBriefing } = require('../manager-briefing');
            const b = await withTimeout(collectBriefing(pool, undefined), 20000, 'BRIEFING');
            const a = b.attendance || {};
            return makeCard(`⚠ نواقص اليوم ${b.day}`, [
                { label: 'نسي خروج', value: fmt(a.missing_out || 0) },
                { label: 'نسي دخول', value: fmt(a.missing_in || 0) },
                { label: 'أقسام تنتظر اعتماد', value: fmt(b.pending.unmappedSections) },
                { label: 'أصناف تنتظر مراجعة', value: fmt(b.pending.reviewItems) },
                { label: 'نافذ', value: fmt((b.stockOut || []).length) },
                { label: 'سينفد قريبًا', value: fmt((b.forecast || []).length) },
            ]);
        } catch (e) {
            logger.error('[QUERY] gaps:', e.message);
            return '<div class="mcard" style="border:2px solid var(--red)"><b style="color:var(--red)">❌ تعذر جلب النواقص</b></div>';
        }
    },

    // ─── حالة النظام ───
    async system(parsed) {
        try {
            const r = await withTimeout(pool.query(`SELECT COUNT(*) as total FROM users WHERE active = true`), 3000, 'SYSTEM');
            const users = r.rows[0].total;
            const hr = await withTimeout(pool.query(`SELECT COUNT(*) as total FROM employees WHERE status = 'active'`), 3000, 'SYSTEM_HR');
            const employees = hr.rows[0].total;
            return makeCard(`⚙️ حالة النظام`, [
                { label: 'المستخدمين النشطين', value: fmt(users) },
                { label: 'الموظفين النشطين', value: fmt(employees) },
                { label: 'قاعدة البيانات', value: '✅ متصلة' },
                { label: 'السيرفر', value: '✅ يعمل' }
            ]);
        } catch (e) {
            return '<div class="mcard" style="border:2px solid var(--red)"><b style="color:var(--red)">❌ تعذر جلب حالة النظام</b></div>';
        }
    }
};

// ─── الاستعلام الرئيسي ───
async function executeQuery(text) {
        try {
        const parsed = parseQuestion(text);
        const results = [];

        for (const cat of parsed.categories) {
            const executor = QUERY_EXECUTORS[cat.category];
            if (executor) {
                try {
                    const result = await executor(parsed);
                    results.push(result);
                } catch (e) {
                    logger.error(`[QUERY] ${cat.category}:`, e.message);
                }
            }
        }

        // If employee name found in attendance context, add specific employee lookup
        if (parsed.empName && parsed.categories.some(c => c.category === 'attendance') && !parsed.categories.some(c => c.category === 'attendanceEmp')) {
            try {
                const empExecutor = QUERY_EXECUTORS.attendanceEmp;
                const result = await empExecutor({ ...parsed, categories: [{ category: 'attendanceEmp' }] });
                results.push(result);
            } catch (e) {}
        }

        if (results.length === 0) {
            return `<div class="mcard"><b>لا أجد ما تبحث عنه</b><br><small>جرّب: "حضور اليوم"، "إيرادات الشهر"، "المخزون"، "عدد الموظفين"، "وثائق"، "نواقص"</small></div>`;
        }
        return results.join('');
    } catch (e) {
        logger.error('[QUERY] executeQuery:', e.message);
        return '<div class="mcard" style="border:2px solid var(--red)"><b style="color:var(--red)">خطأ في الاستعلام</b></div>';
    }
}

// ─── قائمة الفئات ───
function getCategories() {
    return Object.entries(QUERY_PATTERNS).map(([key, cfg]) => ({ key, ...cfg }));
}

module.exports = {
    executeQuery,
    getCategories,
    parseQuestion,
    QUERY_PATTERNS,
    buildControlledIntent,
    rangeFromDateKeywords,
    extractEmployeeIdentifier,
    canAccessErpReport,
    formatAttendanceEntrySummary,
};
