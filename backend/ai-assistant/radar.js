/**
 * ai-assistant/radar.js — رادار النظام «صاحي دايمًا»
 * ═══════════════════════════════════════════════════════════════════════
 * طلب المالك: «عايزه صاحي دايمًا يلتقط أي شي في النظام وينبهني».
 * الرادار يفحص النظام دوريًا (٤ هرتز × ٣ دقائق كاش) ويُرجع كل ما
 * يستحق الانتباه — بترتيب الخطورة — مع «لماذا؟» و«ما العمل؟».
 *
 * كل فحص مستقل: فشل فحص لا يكسر الرادار.
 * كل رقم من القاعدة — لا نموذج ولا تقدير.
 */
'use strict';

const { pool } = require('../shared-pool');
const { riyadhToday, riyadhDateOf } = require('../riyadh-date');
const { logger } = require('../logger');

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const money = (v) => num(v).toFixed(2);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const isoDaysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

const weight = { critical: 4, high: 3, medium: 2, low: 1 };

/* ───────────────────────── فحوصات الرادار ───────────────────────── */

async function salesTodayVsAverage(database) {
    const p = database || pool;
    const today = riyadhToday();
    const rows = await p.query(`
        SELECT d::date AS day, COALESCE(SUM(o.total), 0)::numeric AS revenue, COUNT(o.*)::int AS invoices
          FROM generate_series((NOW() AT TIME ZONE 'Asia/Riyadh')::date - 27, (NOW() AT TIME ZONE 'Asia/Riyadh')::date, '1 day') AS d
          LEFT JOIN ys_mirror_orders o ON (o.doc_date AT TIME ZONE 'Asia/Riyadh')::date = d::date
         GROUP BY 1 ORDER BY 1`);
    const byDay = new Map(rows.rows.map((r) => [String(r.day).slice(0, 10), r]));
    const todayRow = byDay.get(today);
    const complete = [...byDay.values()].filter((r) => String(r.day).slice(0, 10) < today);
    const avg = complete.length ? complete.reduce((s, r) => s + num(r.revenue), 0) / complete.length : 0;
    const current = todayRow ? num(todayRow.revenue) : 0;
    const deltaPct = avg > 0 ? ((current - avg) / avg) * 100 : 0;
    // لا نقارن قبل اكتمال اليوم (قبل 15:00 الرياض اليوم غير مكتمل)
    const hourNow = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', hour: '2-digit', hour12: false }).format(new Date()));
    const dayComplete = hourNow >= 15;
    if (!dayComplete || avg <= 0) {return null;}
    if (deltaPct <= -35) {
        return {
            id: 'sales-collapse', severity: 'critical', area: 'المبيعات',
            title: `مبيعات اليوم ${money(current)} ر.س — هبوط ${Math.abs(deltaPct).toFixed(1)}% عن المتوسط`,
            detail: `اليوم ${money(current)} مقابل متوسط آخر 28 يوم (${money(avg)} ر.س). تحقق: هل حدث إغلاق فرع؟ عطل في النظام؟ حمل عمل فقط؟`,
            action: 'اتصل بمشرفي كل قسم الآن واسأل عما يحدث — لا تؤجل.',
        };
    }
    if (deltaPct <= -20) {
        return {
            id: 'sales-drop', severity: 'high', area: 'المبيعات',
            title: `مبيعات اليوم منخفضة ${Math.abs(deltaPct).toFixed(1)}% عن المتوسط`,
            detail: `اليوم ${money(current)} مقابل متوسط ${money(avg)} ر.س.`,
            action: 'راجع مشرفي الأقسام — عطل أم لا؟',
        };
    }
    return null;
}

async function recentAnomalyAlerts(database) {
    const p = database || pool;
    const week = new Date();
    week.setDate(week.getDate() - 7);
    const from = week.toISOString().slice(0, 10);
    const today = riyadhToday();
    // أذونات لم تُستلم منذ أكثر من ٣ أيام
    const stale = await p.query(`
        SELECT count(*)::int AS n FROM dispatches
         WHERE status IN ('pending', 'approved')
           AND date ~ '^\\d{4}-\\d{2}-\\d{2}$'
           AND date < (CURRENT_DATE - 2)::text`);
    if (num(stale.rows[0] && stale.rows[0].n) > 0) {
        return {
            id: 'dispatches-stale', severity: 'high', area: 'أذونات الصرف',
            title: `${stale.rows[0].n} إذن صرف معلّق منذ أكثر من يومين`,
            detail: 'أذونات صرف لم تُعتمد أو تُستلم — المخزن متوقف على قرارك.',
            action: 'افتح شاشة «أذونات الصرف» واعتمد ما يستحق — لا تدع الطلب يتراكم.',
        };
    }
    // أصناف رصيدها سالب
    const neg = await p.query('SELECT count(*)::int AS n FROM inventory WHERE COALESCE(qty, 0) < 0');
    if (num(neg.rows[0] && neg.rows[0].n) > 0) {
        const value = await p.query(`SELECT round(sum(abs(COALESCE(qty, 0)) * COALESCE("avgCost", 0))::numeric, 2) AS v FROM inventory WHERE COALESCE(qty, 0) < 0`);
        return {
            id: 'negative-stock', severity: 'high', area: 'المخزن',
            title: `${neg.rows[0].n} صنف رصيده سالب — بقيمة ${money(value.rows[0] && value.rows[0].v)} ر.س`,
            detail: 'استهلاك بدون صرف — التكلفة المباعة غير موثوقة والجرد خاطئ.',
            action: 'افحص حركة الأصناف السالبة — غالباً تسريب أو خطأ إدخال.',
        };
    }
    // تحت الحد الأدنى
    const low = await p.query(`SELECT count(*)::int AS n FROM inventory WHERE COALESCE(qty, 0) < COALESCE("minQty", 0) AND COALESCE("minQty", 0) > 0`);
    if (num(low.rows[0] && low.rows[0].n) > 0) {
        return {
            id: 'below-min', severity: 'medium', area: 'المخزن',
            title: `${low.rows[0].n} صنف تحت الحد الأدنى`,
            detail: 'ستتوقف المبيعات على هذه الأصناف قريباً.',
            action: 'راجع قائمة «تحت الحد الأدنى» وحدد أولويات إعادة التوريد.',
        };
    }
    return null;
}

async function dayCloseStale(database) {
    const p = database || pool;
    const r = await p.query('SELECT MAX(close_date) AS last_close FROM pos_day_closes');
    const value = r.rows[0] && r.rows[0].last_close;
    if (!value) {
        return {
            id: 'no-day-close', severity: 'medium', area: 'الإقفال',
            title: 'لا يوجد إقفال يومي مسجّل مطلقًا',
            detail: 'لم تُسجَّل أي إقفالات يومية — النقد غير محسوب.',
            action: 'ابدأ إقفال أول يوم اليوم — راجع شاشة «إقفال اليوم».',
        };
    }
    const iso = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
    const days = daysBetween(iso, riyadhToday());
    if (days > 2) {
        return {
            id: 'day-close-stale', severity: 'high', area: 'الإقفال',
            title: `آخر إقفال يومي منذ ${days} يوم (${iso})`,
            detail: 'الإقفال متوقف منذ أيام — الفروقات تتراكم بلا جرد.',
            action: 'افتح إقفال كل يوم مفتوح ثم طابق الكاش.',
        };
    }
    return null;
}

async function weekAnomalySummary(database) {
    const p = database || pool;
    // مقارنات أسبوعية سريعة: مبيعات/مصاريف/مشتريات
    const weekEnd = isoDaysAgo(1);
    const curFrom = isoDaysAgo(6), curTo = weekEnd;
    const prevFrom = isoDaysAgo(13), prevTo = isoDaysAgo(7);
    const sum = async (from, to, sql) => {
        const r = await p.query(sql, [from, to]);
        return num(r.rows[0] && (r.rows[0].total ?? r.rows[0].revenue));
    };
    const [curSales, prevSales, curExp, prevExp, curPurch, prevPurch] = await Promise.all([
        sum(curFrom, curTo, `SELECT round(sum(total)::numeric, 2) AS revenue FROM ys_mirror_orders WHERE (doc_date AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1::date AND $2::date`),
        sum(prevFrom, prevTo, `SELECT round(sum(total)::numeric, 2) AS revenue FROM ys_mirror_orders WHERE (doc_date AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1::date AND $2::date`),
        sum(curFrom, curTo, `SELECT round(sum(amount)::numeric, 2) AS total FROM expenses WHERE date BETWEEN $1 AND $2`),
        sum(prevFrom, prevTo, `SELECT round(sum(amount)::numeric, 2) AS total FROM expenses WHERE date BETWEEN $1 AND $2`),
        sum(curFrom, curTo, `SELECT round(sum("totalAmount")::numeric, 2) AS total FROM "purchaseInvoices" WHERE date BETWEEN $1 AND $2`),
        sum(prevFrom, prevTo, `SELECT round(sum("totalAmount")::numeric, 2) AS total FROM "purchaseInvoices" WHERE date BETWEEN $1 AND $2`),
    ]);
    const alerts = [];
    const salesPct = prevSales > 0 ? ((curSales - prevSales) / prevSales) * 100 : 0;
    const expPct = prevExp > 0 ? ((curExp - prevExp) / prevExp) * 100 : 0;
    const purPct = prevPurch > 0 ? ((curPurch - prevPurch) / prevPurch) * 100 : 0;
    if (salesPct <= -15) {
        alerts.push({ id: 'sales-week-drop', severity: 'high', area: 'المبيعات', title: `مبيعات الأسبوع انخفضت ${Math.abs(salesPct).toFixed(1)}%`, detail: `${money(curSales)} مقابل ${money(prevSales)} ر.س.`, action: 'قارن بأسباب التراجع: الحملات؟ المنافس؟ الصيانة؟' });
    }
    if (expPct >= 15) {
        alerts.push({ id: 'expenses-week-up', severity: 'medium', area: 'المصروفات', title: `مصاريف الأسبوع ارتفعت ${expPct.toFixed(1)}%`, detail: `${money(curExp)} مقابل ${money(prevExp)} ر.س.`, action: 'راجع الفئات الأعلى زيادة في «المساعد الذكي».' });
    }
    if (purPct >= 20) {
        alerts.push({ id: 'purchases-week-up', severity: 'medium', area: 'المشتريات', title: `المشتريات ارتفعت ${purPct.toFixed(1)}%`, detail: `${money(curPurch)} مقابل ${money(prevPurch)} ر.س.`, action: 'راجع أكبر الموردين — هل ارتفع السعر أم الكمية؟' });
    }
    return alerts.length ? alerts : null;
}

/** تشغيل كل الفحوصات — يُرجع قائمة مرتبة بالخطورة. */
async function radarScan() {
    const started = Date.now();
    const results = await Promise.allSettled([
        salesTodayVsAverage(),
        recentAnomalyAlerts(),
        dayCloseStale(),
        weekAnomalySummary(),
    ]);
    const items = [];
    for (const r of results) {
        if (r.status !== 'fulfilled') {
            logger.warn({ err: String(r.reason).slice(0, 120) }, '[radar] scan failed');
            continue;
        }
        if (!r.value) {continue;}
        if (Array.isArray(r.value)) { items.push(...r.value); } else { items.push(r.value); }
    }
    items.sort((a, b) => (weight[b.severity] || 0) - (weight[a.severity] || 0));
    return {
        generatedAt: new Date().toISOString(),
        scanMs: Date.now() - started,
        items,
        critical: items.filter((i) => i.severity === 'critical').length,
        high: items.filter((i) => i.severity === 'high').length,
        total: items.length,
    };
}

let cache = { at: 0, value: null };
const CACHE_MS = Number(process.env.RADAR_CACHE_MS || 120_000);

async function cachedRadar() {
    if (cache.value && Date.now() - cache.at < CACHE_MS) {return cache.value;}
    cache = { at: Date.now(), value: await radarScan() };
    return cache.value;
}

module.exports = { cachedRadar, radarScan };
