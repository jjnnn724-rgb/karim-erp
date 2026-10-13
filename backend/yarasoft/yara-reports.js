/**
 * yarasoft/yara-reports.js — تقارير إيرادات الأقسام (يومي / شهري / سنوي)
 * ────────────────────────────────────────────────────────────────────────────
 * GET /api/yara-reports/departments?from=YYYY-MM-DD&to=YYYY-MM-DD&group=day|month|year[&dept=CODE]
 *   → صفوف {period, dept_code, dept_name, gross, refund, net, invoices, refunds}
 *     + الإجماليات. المصدر: pos_department_daily_revenues (إغلاقات معتمدة).
 */
'use strict';

const express = require('express');
const { pool } = require('../shared-pool');
const { jwtAuth, requireRole } = require('../cashier-module/jwt-middleware');
const { logger } = require('../logger');
const { ensureYarasoftSchema } = require('./schema');

const router = express.Router();
const READ_ROLES = ['admin', 'manager', 'accountant', 'auditor'];
router.use(jwtAuth);

const periodExpr = (group) => {
    if (group === 'month') {return `TO_CHAR(revenue_date, 'YYYY-MM')`;}
    if (group === 'year') {return `TO_CHAR(revenue_date, 'YYYY')`;}
    return `revenue_date::text`;
};

/** يوم الرياض المحلي بصيغة YYYY-MM-DD (إيرادات الكاشيرية تُسجَّل بتوقيت الرياض) */
function riyadhDay(offsetDays = 0) {
    const ms = Date.now() + offsetDays * 86400000;
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

/**
 * لوحة الكاشيرية الحية — GET /api/yara-reports/cashiers-live
 * لكل كاشير مفعّل (CC): فواتير/إجمالي اليوم + الأمس + نسبة التغير + آخر فاتورة.
 * + إجمالي اليوم الكلي (كل المصادر) للمقارنة.
 */
router.get('/cashiers-live', requireRole(...READ_ROLES), async (req, res) => {
    try {
    await ensureYarasoftSchema();
        // ?date=YYYY-MM-DD لعرض أي يوم (افتراضي: اليوم) — يقارن دائمًا باليوم السابق له
        const qd = String(req.query.date || '').trim();
        const today = /^\d{4}-\d{2}-\d{2}$/.test(qd) ? qd : riyadhDay(0);
        const yday = new Date(new Date(today + 'T12:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
        const cashiers = (await pool.query(
            `SELECT src_name AS cashier_no, dept_code, display_ar
               FROM yarasoft_revenue_map
              WHERE src_table = 'CC' AND active = true
              ORDER BY src_name`
        )).rows;
        // التجميع برقم الكاشير الثابت من سجل الاستيراد (sectionName) — أسماء
        // العرض تتغير مع الوقت لكن الرقم ثابت، فلا انشطار ولا «▲100%» وهمية.
        const stats = (await pool.query(
            `SELECT payload->>'sectionName' AS cashier_no, payload->>'date' AS day,
                    COUNT(*)::int AS invoices,
                    COALESCE(SUM(CASE WHEN (payload->>'total') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (payload->>'total')::numeric ELSE 0 END),0)::float AS total,
                    MAX(processed_at) AS last_at
               FROM (SELECT DISTINCT ON (external_invoice_number) *
                       FROM invoice_import_log
                      WHERE status IN ('COMPLETED', 'DUPLICATE')
                        AND payload->>'srcTable' = 'CC'
                        AND payload->>'date' IN ($1, $2)
                      ORDER BY external_invoice_number,
                               CASE status WHEN 'COMPLETED' THEN 0 ELSE 1 END) d
              GROUP BY 1, 2`,
            [today, yday]
        )).rows;
        const byNo = new Map();
        for (const s of stats) {byNo.set(s.cashier_no + '|' + s.day, s);}
        const cards = cashiers.map((c) => {
            const t = byNo.get(c.cashier_no + '|' + today) || { invoices: 0, total: 0, last_at: null };
            const y = byNo.get(c.cashier_no + '|' + yday) || { invoices: 0, total: 0 };
            const delta = Number(y.total) > 0 ? Number((((Number(t.total) - Number(y.total)) / Number(y.total)) * 100).toFixed(1)) : null;
            return {
                cashier_no: c.cashier_no, name: c.display_ar, dept_code: c.dept_code,
                today_invoices: t.invoices, today_total: t.total,
                yday_invoices: y.invoices, yday_total: y.total,
                delta_pct: delta, last_at: t.last_at || null,
            };
        });
        const ccSum = cards.reduce((s, c) => ({ invoices: s.invoices + c.today_invoices, total: s.total + Number(c.today_total) }), { invoices: 0, total: 0 });
        const dayTotal = (await pool.query(
            `SELECT COUNT(*)::int AS invoices, COALESCE(SUM(amount),0)::float AS total
               FROM revenues WHERE date::text = $1 AND COALESCE("deptId"::text, '') != 'ys_b4_ext'`,
            [today],
        )).rows[0];
        res.set('Cache-Control', 'no-store');
        res.json({
            ok: true, today, yesterday: yday,
            day_total: dayTotal,
            cashiers_total: { invoices: ccSum.invoices, total: Math.round(ccSum.total * 100) / 100 },
            others_total: {
                invoices: dayTotal.invoices - ccSum.invoices,
                total: Math.round((Number(dayTotal.total) - ccSum.total) * 100) / 100,
            },
            cashiers: cards,
        });
    } catch (e) {
        logger.error('[YARASOFT] cashiers-live failed:', e.message);
        res.status(500).json({ ok: false, error: 'CASHIERS_LIVE_FAILED' });
    }
});

router.get('/departments', requireRole(...READ_ROLES), async (req, res) => {
    try {
        const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? req.query.from : '2026-09-01';
        const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? req.query.to : new Date().toISOString().slice(0, 10);
        const group = ['day', 'month', 'year'].includes(String(req.query.group)) ? req.query.group : 'day';
        const dept = String(req.query.dept || '').trim().slice(0, 40);
        const params = [from, to];
        let deptFilter = '';
        if (dept) { params.push(dept); deptFilter = `AND pd.code = $3`; }
        const r = await pool.query(
            `SELECT ${periodExpr(group)} AS period, pd.code AS dept_code,
                    COALESCE(pd.name_ar, m.display_ar, pd.code) AS dept_name,
                    COALESCE(SUM(d.gross_amount),0)::float AS gross,
                    COALESCE(SUM(d.refund_amount),0)::float AS refund,
                    COALESCE(SUM(d.gross_amount - d.refund_amount),0)::float AS net,
                    COALESCE(SUM(d.invoice_count),0)::int AS invoices,
                    COALESCE(SUM(d.refund_count),0)::int AS refunds
               FROM pos_department_daily_revenues d
               JOIN pos_departments pd ON pd.id = d.department_id
               LEFT JOIN (SELECT DISTINCT ON (dept_code) dept_code, display_ar
                            FROM yarasoft_revenue_map WHERE active = true ORDER BY dept_code, id) m
                 ON m.dept_code = pd.code
              WHERE d.revenue_date >= $1 AND d.revenue_date <= $2 ${deptFilter}
              GROUP BY 1, 2, 3 ORDER BY 1 DESC, 7 DESC`, params);
        const t = r.rows.reduce((s, x) => ({
            gross: s.gross + x.gross, refund: s.refund + x.refund, net: s.net + x.net,
            invoices: s.invoices + x.invoices, refunds: s.refunds + x.refunds,
        }), { gross: 0, refund: 0, net: 0, invoices: 0, refunds: 0 });
        res.json({ ok: true, from, to, group, rows: r.rows, totals: t });
    } catch (e) {
        res.status(500).json({ ok: false, error: 'YARA_REPORT_FAILED' });
    }
});

/**
 * تفاصيل مبيعات الكاشيرية (CC) — أصنافًا وفواتيرًا، حيًا من Oracle
 * ────────────────────────────────────────────────────────────────────────────
 * GET /api/yara-reports/cashier-items?from=YYYY-MM-DD&to=YYYY-MM-DD
 *     &cashier=4&view=items|invoices&page=&limit=
 * يوم العمل = DATE اليوم نفسه (DOC_DATE منتصف الليل دائمًا) — فلتر مدى صريح
 * على العمود الخام ليستخدم الفهرس بدل المسح الكامل. + تجمع Oracle مشترك
 * + استعلامات متوازية + كاش 90 ثانية.
 * يستثني الكاشير 2 (داخلي/اختباري — نفس قاعدة خط الإيرادات).
 */

// تجمع Oracle مشترك لهذا التقرير (اتصال واحد يُعاد استخدامه بدل مصافحة كل مرة)
let _ciPool = null;
let _ciThickTried = false;
async function _ciPoolGet(oracledb, cfg) {
    if (_ciPool) {return _ciPool;}
    if (!_ciThickTried) {
        _ciThickTried = true;
        try {
            const fs = require('fs');
            if (cfg.icPath && fs.existsSync(cfg.icPath)) {
                if (!process.env.NLS_LANG) {process.env.NLS_LANG = 'AMERICAN_AMERICA.AR8MSWIN1256';}
                oracledb.initOracleClient({ libDir: cfg.icPath });
            }
        } catch (_) { /* thin fallback — الفحص الحي يحدد الصلاحية */ }
    }
    _ciPool = await oracledb.createPool({
        user: (process.env.YARASOFT_ORACLE_USER || '').trim(),
        password: process.env.YARASOFT_ORACLE_PASSWORD || '',
        connectString: `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${cfg.host})(PORT=${cfg.port}))(CONNECT_DATA=(SERVICE_NAME=${cfg.service})))`,
        // queueTimeout قصير + poolMax أوسع: القياس كان NJS-040 (طابور 15 ثانية) لأن
        // ثلاث اتصالات فقط كانت تصطف خلفها لوحة الكاشيرية كل 30 ثانية.
        poolMin: 0, poolMax: 8, queueTimeout: 5000, connectTimeout: 5,
    });
    return _ciPool;
}

// كاش قصير: نفس البرامترات = نفس الرد 90 ثانية (أيام مغلقة لا تتغير)
const _ciCache = new Map(); // key -> { at, body }
const CI_CACHE_MS = 90 * 1000;
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of _ciCache.entries()) { if (now - v.at > CI_CACHE_MS) {_ciCache.delete(k);} }
}, 60 * 1000).unref?.();
router.get('/cashier-items', requireRole(...READ_ROLES), async (req, res) => {
    const dayRe = /^\d{4}-\d{2}-\d{2}$/;
    const to = dayRe.test(String(req.query.to || '')) ? req.query.to : riyadhDay(0);
    const from = dayRe.test(String(req.query.from || '')) ? req.query.from : riyadhDay(-6);
    if (from > to) {return res.status(422).json({ ok: false, error: 'INVALID_RANGE' });}
    const spanDays = Math.round((new Date(to + 'T12:00:00Z') - new Date(from + 'T12:00:00Z')) / 86400000);
    if (spanDays > 62) {return res.status(422).json({ ok: false, error: 'RANGE_TOO_WIDE', message: 'الحد الأقصى 62 يومًا لكل استعلام' });}
    const cashier = String(req.query.cashier || '').trim().replace(/\D/g, '').slice(0, 8);
    const view = String(req.query.view || 'items') === 'invoices' ? 'invoices' : 'items';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(10, parseInt(req.query.limit) || 50));

    const cacheKey = `${from}|${to}|${cashier}|${view}|${view === 'invoices' ? Math.min(page, Math.max(1, 1)) : 0}|${limit}`;
    const cached = _ciCache.get(cacheKey + '|pg' + page);
    if (cached && Date.now() - cached.at < CI_CACHE_MS) {
        res.set('Cache-Control', 'no-store');
        return res.json(cached.body);
    }

    let conn = null;
    try {
        const { loadOracleConfig, oraExecute, sanitizeError, oracleConnect } = require('./oracle-link');
        const oracledb = require('oracledb');
        const cfg = loadOracleConfig();
        if (!cfg.enabled) {return res.status(409).json({ ok: false, error: 'ORACLE_DISABLED' });}
        const t0 = Date.now();
        conn = await oracleConnect(() => _ciPoolGet(oracledb, cfg).then(p => p.getConnection()));
        // DOC_DATE منتصف الليل دائمًا → مدى صريح على العمود الخام (يستخدم الفهرس)
        const dayRangeE = `e.DOC_DATE >= TO_DATE(:dfrom, 'YYYY-MM-DD') AND e.DOC_DATE < TO_DATE(:dto, 'YYYY-MM-DD') + 1`;
        const dayRangeB = `b.DOC_DATE >= TO_DATE(:dfrom, 'YYYY-MM-DD') AND b.DOC_DATE < TO_DATE(:dto, 'YYYY-MM-DD') + 1`;
        const cashierFilterE = cashier ? `AND TRIM(e.CSHR_NO) = :cashier` : '';
        const cashierFilterB = cashier ? `AND TRIM(b.CSHR_NO) = :cashier` : '';
        const binds = { dfrom: from, dto: to, ...(cashier ? { cashier } : {}) };

        // بطاقات الكاشيرية (أسماء العرض من خريطة الإيرادات)
        const names = new Map((await pool.query(
            `SELECT TRIM(src_name) AS no, display_ar FROM yarasoft_revenue_map
              WHERE src_table = 'CC' AND active = true`
        )).rows.map(r => [r.no, r.display_ar]));

        // ملخص كل كاشير في الفترة (من الترويسات المعتمدة)
        const sumP = oraExecute(conn,
            `SELECT TRIM(b.CSHR_NO) AS cashier_no,
                    COUNT(*) AS invoices,
                    SUM(NVL(b.NET_VAL, 0)) AS net,
                    SUM(NVL(b.DSCNT_VL, 0)) AS discount
               FROM CC_BILLS3 b
              WHERE ${dayRangeB}
                AND b.PSTD = 'Y' AND NVL(b.NET_VAL, 0) > 0 AND TRIM(b.CSHR_NO) <> '2'
                ${cashierFilterB}
              GROUP BY TRIM(b.CSHR_NO) ORDER BY 1`,
            binds, { outFormat: oracledb.OBJECT }).then(r => r.rows || []);

        let rowsP;
        if (view === 'items') {
            rowsP = oraExecute(conn,
                `SELECT TRIM(e.CSHR_NO) AS cashier_no,
                        TRIM(e.ITM_NO) AS item_code,
                        MAX(e.ITM_NAME) AS item_name,
                        MAX(e.UNIT_NM) AS unit,
                        COUNT(DISTINCT e.DOC_NO) AS invoices,
                        SUM(NVL(e.REAL_QNT, e.QNT)) AS qty,
                        AVG(NVL(e.REAL_SALE_PRICE, e.SALE_PRICE)) AS avg_price,
                        SUM(NVL(e.SALE_VAL, 0)) AS net,
                        SUM(NVL(e.DISC_VAL, 0)) AS discount,
                        SUM(NVL(e.VAT_AMNT, 0)) AS vat
                   FROM CC_BILL_ENTER3 e
                  WHERE ${dayRangeE} ${cashierFilterE}
                    AND EXISTS (SELECT 1 FROM CC_BILLS3 b WHERE b.DOC_NO = e.DOC_NO
                                AND b.PSTD = 'Y' AND NVL(b.NET_VAL, 0) > 0 AND TRIM(b.CSHR_NO) <> '2')
                  GROUP BY TRIM(e.CSHR_NO), TRIM(e.ITM_NO)
                  ORDER BY 1, 8 DESC`,
                binds, { outFormat: oracledb.OBJECT }).then(r => ({ kind: 'items', rows: r.rows || [] }));
        } else {
            rowsP = (async () => {
                const countRows = (await oraExecute(conn,
                    `SELECT COUNT(*) AS C FROM CC_BILLS3 b
                      WHERE ${dayRangeB}
                        AND b.PSTD = 'Y' AND NVL(b.NET_VAL, 0) > 0 AND TRIM(b.CSHR_NO) <> '2'
                        ${cashierFilterB}`,
                    binds, { outFormat: oracledb.OBJECT })).rows || [];
                const total = Number(countRows[0]?.C || 0);
                const pages = Math.max(1, Math.ceil(total / limit));
                const off = (Math.min(page, pages) - 1) * limit;
                const invRows = (await oraExecute(conn,
                    `SELECT * FROM (
                       SELECT b.*, ROWNUM rn FROM (
                         SELECT b.DOC_NO, TRIM(b.CSHR_NO) AS CASHIER_NO, b.DOC_DATE, b.SHFT_NO,
                                b.TOTAL_VAL, b.DSCNT_VL, b.NET_VAL, b.PAYED, b.CASH_PYD, b.INVCD_TO
                           FROM CC_BILLS3 b
                          WHERE ${dayRangeB}
                            AND b.PSTD = 'Y' AND NVL(b.NET_VAL, 0) > 0 AND TRIM(b.CSHR_NO) <> '2'
                            ${cashierFilterB}
                          ORDER BY b.DOC_DATE DESC, b.DOC_NO DESC
                       ) b WHERE ROWNUM <= :hi
                     ) WHERE rn > :lo`,
                    { ...binds, hi: off + limit, lo: off }, { outFormat: oracledb.OBJECT })).rows || [];
                // عدد الأصناف لصفحات الفواتير فقط — استعلام واحد مجمع بدل subquery مرتبط
                const linesMap = new Map();
                if (invRows.length) {
                    const docs = [...new Set(invRows.map(r => String(r.DOC_NO)))];
                    const chunks = [];
                    for (let i = 0; i < docs.length; i += 500) {chunks.push(docs.slice(i, i + 500));}
                    for (const ch of chunks) {
                        const lr = (await oraExecute(conn,
                            `SELECT DOC_NO, COUNT(*) AS C FROM CC_BILL_ENTER3
                              WHERE DOC_NO IN (${ch.map((_, i) => `:d${i}`).join(',')})
                              GROUP BY DOC_NO`,
                            Object.fromEntries(ch.map((d, i) => [`d${i}`, d])),
                            { outFormat: oracledb.OBJECT })).rows || [];
                        for (const x of lr) {linesMap.set(String(x.DOC_NO), Number(x.C || 0));}
                    }
                }
                return { kind: 'invoices', total, pages, off, invRows, linesMap };
            })();
        }

        // الملخص والتفاصيل معًا — لا انتظار متسلسل
        const [sumRows, detail] = await Promise.all([sumP, rowsP]);
        const cashiers = sumRows.map(s => ({
            no: String(s.CASHIER_NO).trim(),
            name: names.get(String(s.CASHIER_NO).trim()) || ('كاشير ' + String(s.CASHIER_NO).trim()),
            invoices: Number(s.INVOICES || 0),
            net: Number(s.NET || 0),
            discount: Number(s.DISCOUNT || 0),
        }));
        const totals = cashiers.reduce((a, c) => ({
            invoices: a.invoices + c.invoices, net: a.net + c.net, discount: a.discount + c.discount,
        }), { invoices: 0, net: 0, discount: 0 });

        let rows = [], pages = 1, total = 0, outPage = 1;
        if (detail.kind === 'items') {
            rows = detail.rows.map(r => ({
                cashier_no: String(r.CASHIER_NO).trim(),
                cashier_name: names.get(String(r.CASHIER_NO).trim()) || ('كاشير ' + String(r.CASHIER_NO).trim()),
                item_code: r.ITEM_CODE != null ? String(r.ITEM_CODE).trim() : '',
                item_name: r.ITEM_NAME != null ? String(r.ITEM_NAME).trim() : '',
                unit: r.UNIT != null ? String(r.UNIT).trim() : '',
                invoices: Number(r.INVOICES || 0),
                qty: Number(r.QTY || 0),
                avg_price: Number(r.AVG_PRICE || 0),
                net: Number(r.NET || 0),
                discount: Number(r.DISCOUNT || 0),
                vat: Number(r.VAT || 0),
            }));
            total = rows.length;
        } else {
            total = detail.total; pages = detail.pages; outPage = Math.min(page, pages);
            rows = detail.invRows.map(r => ({
                doc_no: String(r.DOC_NO),
                cashier_no: String(r.CASHIER_NO).trim(),
                cashier_name: names.get(String(r.CASHIER_NO).trim()) || ('كاشير ' + String(r.CASHIER_NO).trim()),
                day: riyadhDayStr(r.DOC_DATE),
                shift: r.SHFT_NO,
                total: Number(r.TOTAL_VAL || 0), discount: Number(r.DSCNT_VL || 0),
                net: Number(r.NET_VAL || 0), paid: Number(r.PAYED || 0),
                customer: r.INVCD_TO != null ? String(r.INVCD_TO).trim() : '',
                lines: (detail.linesMap && detail.linesMap.get(String(r.DOC_NO))) || 0,
            }));
        }
        const body = {
            ok: true, from, to, view, cashier: cashier || null,
            cashiers, totals, rows, total,
            page: outPage, pages, limit,
            ms: Date.now() - t0,
        };
        _ciCache.set(cacheKey + '|pg' + page, { at: Date.now(), body });
        res.set('Cache-Control', 'no-store');
        res.json(body);
    } catch (e) {
        const { sanitizeError } = require('./oracle-link');
        res.status(500).json({ ok: false, error: sanitizeError(e.message) });
    } finally {
        try { if (conn) {await conn.close();} } catch (_) {}
    }
});

/**
 * نبض الكاشيرية اليوم — GET /api/yara-reports/cashiers-today?date=YYYY-MM-DD
 * ────────────────────────────────────────────────────────────────────────────
 * يوم واحد مفهرس من Oracle مباشرة: لكل كاشير (فواتير/صافي/خصم/متوسط الفاتورة/
 * الوردية الحالية/طرق الدفع) + منحنى صافي المبيعات لكل ساعة (00-23) إجماليًا
 * وper كاشير. الساعة تُشتق من DOC_TIME (نص 12h) بتجميع JS متسامح. كاش 30 ثانية.
 */
const _ctCache = new Map();
// 60 ثانية: لوحة الكاشيرية تستدعي كل 30 ثانية — TTL等于 الفترة كان يجعل كل
// نداء يخترق الكاش ويضغط على Oracle (سبب ازدحام المجمع NJS-040).
const CT_CACHE_MS = 60 * 1000;
function _parseDocHour(s) {
    const m = String(s || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]\.?/);
    if (!m) {return -1;}
    let h = Number(m[1]) % 12;
    if (/^[Pp]/.test(m[4])) {h += 12;}
    return h;
}
router.get('/cashiers-today', requireRole(...READ_ROLES), async (req, res) => {
    const dayRe = /^\d{4}-\d{2}-\d{2}$/;
    const date = dayRe.test(String(req.query.date || '')) ? req.query.date : riyadhDay(0);
    const hit = _ctCache.get(date);
    if (hit && Date.now() - hit.at < CT_CACHE_MS) {
        res.set('Cache-Control', 'no-store');
        return res.json(hit.body);
    }
    let conn = null;
    try {
        const { loadOracleConfig, oraExecute, oracleConnect } = require('./oracle-link');
        const oracledb = require('oracledb');
        const cfg = loadOracleConfig();
        if (!cfg.enabled) {return res.status(409).json({ ok: false, error: 'ORACLE_DISABLED' });}
        const t0 = Date.now();
        conn = await oracleConnect(() => _ciPoolGet(oracledb, cfg).then(p => p.getConnection()));
        const range = `b.DOC_DATE >= TO_DATE(:d, 'YYYY-MM-DD') AND b.DOC_DATE < TO_DATE(:d, 'YYYY-MM-DD') + 1`;
        const base = `${range} AND b.PSTD = 'Y' AND NVL(b.NET_VAL, 0) > 0 AND TRIM(b.CSHR_NO) <> '2'`;
        const [sumRows, hourRows] = await Promise.all([
            oraExecute(conn,
                `SELECT TRIM(b.CSHR_NO) AS no, COUNT(*) AS inv,
                        SUM(NVL(b.NET_VAL,0)) AS net, SUM(NVL(b.DSCNT_VL,0)) AS disc,
                        SUM(NVL(b.CASH_PYD,0)) AS cash, SUM(NVL(b.SPAN_PYD,0)) AS span,
                        SUM(NVL(b.CRDT_PYD,0)) AS credit, SUM(NVL(b.MBL_PYD,0)) AS mobile,
                        MAX(b.SHFT_NO) AS shift
                   FROM CC_BILLS3 b WHERE ${base} GROUP BY TRIM(b.CSHR_NO) ORDER BY 1`,
                { d: date }, { outFormat: oracledb.OBJECT }).then(r => r.rows || []),
            oraExecute(conn,
                `SELECT TRIM(b.CSHR_NO) AS no, b.DOC_TIME AS t, NVL(b.NET_VAL,0) AS net
                   FROM CC_BILLS3 b WHERE ${base}`,
                { d: date }, { outFormat: oracledb.OBJECT }).then(r => r.rows || []),
        ]);
        const names = new Map((await pool.query(
            `SELECT TRIM(src_name) AS no, display_ar FROM yarasoft_revenue_map
              WHERE src_table = 'CC' AND active = true`
        )).rows.map(r => [r.no, r.display_ar]));
        const cashiers = sumRows.map(s => {
            const no = String(s.NO).trim();
            const inv = Number(s.INV || 0), net = Number(s.NET || 0);
            return {
                no, name: names.get(no) || ('كاشير ' + no),
                invoices: inv, net, discount: Number(s.DISC || 0),
                avg: inv ? net / inv : 0, shift: s.SHIFT,
                pay: { cash: Number(s.CASH || 0), span: Number(s.SPAN || 0), credit: Number(s.CREDIT || 0), mobile: Number(s.MOBILE || 0) },
                hourly: new Array(24).fill(0),
            };
        });
        const byNo = new Map(cashiers.map(c => [c.no, c]));
        const hourly = new Array(24).fill(0);
        let untimed = 0;
        for (const h of hourRows) {
            const hr = _parseDocHour(h.T);
            const v = Number(h.NET || 0);
            if (hr < 0) {untimed += v; continue;}
            hourly[hr] += v;
            const c = byNo.get(String(h.NO).trim());
            if (c) {c.hourly[hr] += v;}
        }
        const round2 = (a) => a.map(v => Math.round(v * 100) / 100);
        hourly.forEach((_, i) => { hourly[i] = Math.round(hourly[i] * 100) / 100; });
        cashiers.forEach((c) => { c.hourly = round2(c.hourly); c.net = Math.round(c.net * 100) / 100; c.avg = Math.round(c.avg * 100) / 100; });
        const body = {
            ok: true, date, ms: Date.now() - t0,
            cashiers,
            total: {
                invoices: cashiers.reduce((s, c) => s + c.invoices, 0),
                net: Math.round(cashiers.reduce((s, c) => s + c.net, 0) * 100) / 100,
            },
            hourly, untimed: Math.round(untimed * 100) / 100,
        };
        _ctCache.set(date, { at: Date.now(), body });
        if (_ctCache.size > 10) {_ctCache.delete(_ctCache.keys().next().value);}
        res.set('Cache-Control', 'no-store');
        res.json(body);
    } catch (e) {
        const { sanitizeError } = require('./oracle-link');
        // انقطاع يارا لا يترك الشاشة فارغة: آخر لقطة ناجحة (≤ 15 دقيقة) تُعرض بعلم stale
        const last = _ctCache.get(date);
        if (last && Date.now() - last.at < 15 * 60 * 1000) {
            res.set('Cache-Control', 'no-store');
            return res.json({ ...last.body, ok: true, stale: true, staleAgeMs: Date.now() - last.at, degraded: sanitizeError(e.message) });
        }
        res.status(503).json({ ok: false, error: sanitizeError(e.message), circuit: require('./oracle-link').oracleBreakerStatus() });
    } finally {
        try { if (conn) {await conn.close();} } catch (_) {}
    }
});

function riyadhDayStr(d) {
    try {
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
    } catch (_) { return ''; }
}


/**
 * لوحة التقفيل اليومية — GET /api/yara-reports/daily-locks
 * ────────────────────────────────────────────────────────────────────────────
 * يعرض جدول التقفيل لكل قسم ليوم معين (افتراضي: اليوم).
 * القسم اللي عنده إيرادات = مقفّل، اللي مفيش = مفتوح.
 */
router.get('/daily-locks', requireRole(...READ_ROLES), async (req, res) => {
    try {
        const qd = String(req.query.date || '').trim();
        const today = /^\d{4}-\d{2}-\d{2}$/.test(qd) ? qd : riyadhDay(0);
        const rows = (await pool.query(
            `SELECT pd.code AS dept_code,
                    COALESCE(pd.name_ar, m.display_ar, pd.code) AS dept_name,
                    COALESCE(SUM(d.gross_amount),0)::float AS gross,
                    COALESCE(SUM(d.refund_amount),0)::float AS refund,
                    COALESCE(SUM(d.gross_amount - d.refund_amount),0)::float AS net,
                    COALESCE(SUM(d.invoice_count),0)::int AS invoices,
                    COALESCE(SUM(d.refund_count),0)::int AS refunds,
                    COUNT(d.id)::int AS lock_count,
                    MAX(d.revenue_date) AS last_lock
               FROM pos_departments pd
               LEFT JOIN pos_department_daily_revenues d ON d.department_id = pd.id AND d.revenue_date = $1
               LEFT JOIN (SELECT DISTINCT ON (dept_code) dept_code, display_ar
                            FROM yarasoft_revenue_map WHERE active = true ORDER BY dept_code, id) m
                 ON m.dept_code = pd.code
              GROUP BY pd.id, pd.code, pd.name_ar, m.display_ar
              ORDER BY pd.code`
        , [today])).rows;
        const locked = rows.filter(r => r.lock_count > 0).length;
        const totals = rows.reduce((s, r) => ({
            gross: s.gross + r.gross, refund: s.refund + r.refund,
            net: s.net + r.net, invoices: s.invoices + r.invoices,
            refunds: s.refunds + r.refunds,
        }), { gross: 0, refund: 0, net: 0, invoices: 0, refunds: 0 });
        res.json({ ok: true, date: today, total: rows.length, locked, unlocked: rows.length - locked, rows, totals });
    } catch (e) {
        logger.error('[daily-locks]', e);
        res.status(500).json({ ok: false, error: 'DAILY_LOCKS_FAILED' });
    }
});

/**
 * تحليل مبيعات الأصناف من الكاشيرية — GET /api/yara-reports/item-sales
 * ?from=&to=[&cashier=4&item=شورما&group=item|cashier|day]
 * المصدر: ys_mirror_orders (مرآة محلية حيّة — لا يحتاج Oracle).
 * يدعم البحث الجزئي في اسم الصنف/الكود + تجميع بالصنف أو الكاشير أو اليوم.
 */
router.get('/item-sales', requireRole('sous_chef', 'admin', 'owner'), async (req, res) => {
    try {
        const dayRe = /^\d{4}-\d{2}-\d{2}$/;
        const from = dayRe.test(String(req.query.from || '')) ? req.query.from : riyadhDay(-29);
        const to = dayRe.test(String(req.query.to || '')) ? req.query.to : riyadhDay(0);
        if (from > to) {return res.status(422).json({ ok: false, error: 'INVALID_RANGE' });}
        const spanDays = Math.round((new Date(to + 'T12:00:00Z') - new Date(from + 'T12:00:00Z')) / 86400000) + 1;
        if (spanDays > 93) {return res.status(422).json({ ok: false, error: 'RANGE_TOO_WIDE', message: 'الحد الأقصى 93 يومًا' });}
        const cashier = String(req.query.cashier || '').trim().replace(/\D/g, '').slice(0, 8);
        const item = String(req.query.item || '').trim().slice(0, 60);
        const group = ['item', 'cashier', 'day'].includes(String(req.query.group)) ? req.query.group : 'item';

        const params = [from, to];
        let extra = '';
        if (cashier) {params.push(cashier); extra += ` AND o.cashier_no::text = $${params.length}`;}
        if (item) {
            // تطبيع البحث العربي: تجاهل «ال» التعريف + كل كلمة على حدة
            // مثال: «البيبسي» ↔ «بيبسي»، «مشروب بيبسي» يلاقي أي صنف فيه بيبسي
            const words = item.split(/\s+/).filter(Boolean).map(w => w.replace(/^ال/, '').replace(/^وال/, '').replace(/^بال/, '')).filter(w => w.length >= 2);
            const terms = words.length ? words : [item];
            const ors = terms.map((w) => {params.push('%' + w + '%'); return `((e->>'name') ILIKE $${params.length} OR (e->>'code') ILIKE $${params.length})`;}).join(' OR ');
            extra += ` AND (${ors})`;
        }

        // اسم العرض لكل كاشير من خريطة الإيرادات (إن وجد)
        const names = new Map((await pool.query(
            `SELECT TRIM(src_name) AS no, display_ar FROM yarasoft_revenue_map WHERE src_table='CC' AND active=true`
        )).rows.map(r => [r.no, r.display_ar]));

        // تفكيك سطور الفواتير jsonb مرة واحدة ثم التجميع حسب الطلب
        let selectGrp, groupGrp;
        if (group === 'cashier') {
            selectGrp = `o.cashier_no::text`;
            groupGrp = `1`;
        } else if (group === 'day') {
            selectGrp = `o.doc_date`;
            groupGrp = `1`;
        } else {
            selectGrp = `e->>'code', e->>'name'`;
            groupGrp = `1, 2`;
        }
        const rows = (await pool.query(
            `SELECT ${selectGrp}${group === 'item' ? ', MAX(e->>\'name\') AS item_name' : ''},
                    COUNT(DISTINCT o.doc_no)::int AS invoices,
                    COALESCE(SUM((e->>'qty')::numeric), 0)::float AS qty,
                    COALESCE(SUM((e->>'total')::numeric), 0)::float AS net,
                    COALESCE(SUM((e->>'vat')::numeric), 0)::float AS vat
               FROM ys_mirror_orders o, jsonb_array_elements(o.lines) e
              WHERE o.doc_date >= $1 AND o.doc_date <= $2 ${extra}
              GROUP BY ${groupGrp}
              ORDER BY ${group === 'day' ? '1' : '4 DESC, 3 DESC'}
              LIMIT 1000`,
            params
        )).rows;
        for (const r of rows) {
            if (r.cashier_no != null) {r.cashier_name = names.get(String(r.cashier_no).trim()) || ('كاشير ' + r.cashier_no);}
        }
        const totals = rows.reduce((s, r) => ({
            invoices: s.invoices + r.invoices, qty: s.qty + Number(r.qty),
            net: s.net + Number(r.net), vat: s.vat + Number(r.vat),
        }), { invoices: 0, qty: 0, net: 0, vat: 0 });
        totals.net = Math.round(totals.net * 100) / 100;
        totals.vat = Math.round(totals.vat * 100) / 100;
        res.set('Cache-Control', 'no-store');
        res.json({ ok: true, from, to, group, rows, totals, count: rows.length });
    } catch (e) {
        logger.error('[item-sales]', e);
        res.status(500).json({ ok: false, error: 'ITEM_SALES_FAILED' });
    }
});

/**
 * GET /api/yara-reports/orders — أوردرات مفصّلة (للمالك/السو شيف)
 * ?from=&to=[&cashier=4&limit=&offset=]
 * ترجع كل فاتورة مع أصنافها كاملة — للاستعلام والطباعة.
 */
router.get('/orders', requireRole('sous_chef', 'admin', 'owner'), async (req, res) => {
    try {
        const dayRe = /^\d{4}-\d{2}-\d{2}$/;
        const from = dayRe.test(String(req.query.from || '')) ? req.query.from : riyadhDay(-29);
        const to = dayRe.test(String(req.query.to || '')) ? req.query.to : riyadhDay(0);
        if (from > to) {return res.status(422).json({ ok: false, error: 'INVALID_RANGE' });}
        const spanDays = Math.round((new Date(to + 'T12:00:00Z') - new Date(from + 'T12:00:00Z')) / 86400000) + 1;
        if (spanDays > 93) {return res.status(422).json({ ok: false, error: 'RANGE_TOO_WIDE', message: 'الحد الأقصى 93 يومًا' });}
        const cashier = String(req.query.cashier || '').trim().replace(/\D/g, '').slice(0, 8);
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
        const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

        const params = [from, to];
        let extra = '';
        if (cashier) {params.push(cashier); extra += ` AND o.cashier_no::text = $${params.length}`;}

        const names = new Map((await pool.query(
            `SELECT TRIM(src_name) AS no, display_ar FROM yarasoft_revenue_map WHERE src_table='CC' AND active=true`
        )).rows.map(r => [r.no, r.display_ar]));

        const cnt = (await pool.query(
            `SELECT COUNT(*)::int AS n FROM ys_mirror_orders o WHERE o.doc_date >= $1 AND o.doc_date <= $2 ${extra}`,
            params
        )).rows[0].n;

        params.push(limit, offset);
        const rows = (await pool.query(
            `SELECT o.doc_no, o.cashier_no::text, o.doc_date, o.doc_time, o.shift_no,
                    o.net, o.total, o.discount, o.vat, o.payed,
                    o.pay_cash, o.pay_network, o.pay_credit, o.pay_mobile,
                    o.table_name, o.zone_name, o.printed, o.synced_at,
                    o.lines
               FROM ys_mirror_orders o
              WHERE o.doc_date >= $1 AND o.doc_date <= $2 ${extra}
              ORDER BY o.doc_date DESC, o.doc_no DESC
              LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        )).rows;

        const out = rows.map(r => ({
            doc_no: r.doc_no, cashier_no: String(r.cashier_no), cashier_name: names.get(String(r.cashier_no).trim()) || ('كاشير ' + r.cashier_no),
            doc_date: r.doc_date, doc_time: r.doc_time, shift_no: r.shift_no,
            net: Number(r.net || 0), total: Number(r.total || 0), discount: Number(r.discount || 0),
            vat: Number(r.vat || 0), payed: Number(r.payed || 0),
            pay_cash: Number(r.pay_cash || 0), pay_network: Number(r.pay_network || 0),
            pay_credit: Number(r.pay_credit || 0), pay_mobile: Number(r.pay_mobile || 0),
            table_name: r.table_name, zone_name: r.zone_name, printed: !!r.printed,
            lines: Array.isArray(r.lines) ? r.lines : [],
            lines_count: Array.isArray(r.lines) ? r.lines.length : 0,
        }));
        res.set('Cache-Control', 'no-store');
        res.json({ ok: true, from, to, orders: out, total: cnt, limit, offset });
    } catch (e) {
        logger.error('[orders]', e);
        res.status(500).json({ ok: false, error: 'ORDERS_FAILED' });
    }
});

/**
 * GET /api/yara-reports/order-detail/:docNo — تفاصيل أوردر واحد
 */
router.get('/order-detail/:docNo', requireRole('sous_chef', 'admin', 'owner'), async (req, res) => {
    try {
        const docNo = String(req.params.docNo || '').trim().slice(0, 30);
        if (!docNo) {return res.status(422).json({ ok: false, error: 'NO_DOC' });}
        const r = (await pool.query(
            `SELECT doc_no, cashier_no::text, doc_date, doc_time, shift_no,
                    net, total, discount, vat, payed, pay_cash, pay_network, pay_credit, pay_mobile,
                    table_name, zone_name, printed, lines
               FROM ys_mirror_orders WHERE doc_no = $1 LIMIT 1`, [docNo]
        )).rows[0];
        if (!r) {return res.status(404).json({ ok: false, error: 'NOT_FOUND' });}
        res.set('Cache-Control', 'no-store');
        res.json({ ok: true, order: {
            doc_no: r.doc_no, cashier_no: String(r.cashier_no),
            doc_date: r.doc_date, doc_time: r.doc_time, shift_no: r.shift_no,
            net: Number(r.net || 0), total: Number(r.total || 0), discount: Number(r.discount || 0),
            vat: Number(r.vat || 0), payed: Number(r.payed || 0),
            pay_cash: Number(r.pay_cash || 0), pay_network: Number(r.pay_network || 0),
            pay_credit: Number(r.pay_credit || 0), pay_mobile: Number(r.pay_mobile || 0),
            table_name: r.table_name, zone_name: r.zone_name, printed: !!r.printed,
            lines: Array.isArray(r.lines) ? r.lines : [],
        }});
    } catch (e) {
        logger.error('[order-detail]', e);
        res.status(500).json({ ok: false, error: 'ORDER_DETAIL_FAILED' });
    }
});

/**
 * GET /api/yara-reports/received-items — الأصناف المستلمة من أذونات الصرف
 * ?from=&to=[&dept=&item=&group=item|dept|day&limit=&offset=]
 * المصدر: dispatches.receivedItems (JSONB) — كل ما استلمه القسم من المخزن.
 */
router.get('/received-items', requireRole('sous_chef', 'admin', 'owner'), async (req, res) => {
    try {
        const dayRe = /^\d{4}-\d{2}-\d{2}$/;
        const from = dayRe.test(String(req.query.from || '')) ? req.query.from : riyadhDay(-29);
        const to = dayRe.test(String(req.query.to || '')) ? req.query.to : riyadhDay(0);
        if (from > to) {return res.status(422).json({ ok: false, error: 'INVALID_RANGE' });}
        const spanDays = Math.round((new Date(to + 'T12:00:00Z') - new Date(from + 'T12:00:00Z')) / 86400000) + 1;
        if (spanDays > 93) {return res.status(422).json({ ok: false, error: 'RANGE_TOO_WIDE', message: 'الحد الأقصى 93 يومًا' });}
        const dept = String(req.query.dept || '').trim().slice(0, 60);
        const item = String(req.query.item || '').trim().slice(0, 60);
        const group = ['item', 'dept', 'day'].includes(String(req.query.group)) ? req.query.group : 'item';

        const params = [from, to];
        let extra = ` AND d.status IN ('received','partially_received') AND d."receivedItems" IS NOT NULL`;
        if (dept) {params.push('%' + dept + '%'); extra += ` AND d."deptName" ILIKE $${params.length}`;}
        if (item) {
            const words = item.split(/\s+/).filter(Boolean).map(w => w.replace(/^ال/, '').replace(/^وال/, '').replace(/^بال/, '')).filter(w => w.length >= 2);
            const terms = words.length ? words : [item];
            const ors = terms.map((w) => {params.push('%' + w + '%'); return `(e->>'itemName') ILIKE $${params.length}`;}).join(' OR ');
            extra += ` AND (${ors})`;
        }

        let selectExpr, groupExpr;
        if (group === 'dept') {
            selectExpr = `d."deptName"`;
            groupExpr = `1`;
        } else if (group === 'day') {
            selectExpr = `d.date`;
            groupExpr = `1`;
        } else {
            selectExpr = `e->>'itemName'`;
            groupExpr = `1`;
        }

        const rows = (await pool.query(
            `SELECT ${selectExpr}${group === 'item' ? ', MAX(e->>\'itemName\') AS item_name' : ''},
                    COUNT(DISTINCT d.id)::int AS dispatches,
                    COALESCE(SUM((e->>'receivedQty')::numeric), 0)::float AS qty,
                    COALESCE(SUM((e->>'approvedQty')::numeric), 0)::float AS approved_qty,
                    COALESCE(SUM((e->>'varianceQty')::numeric), 0)::float AS variance_qty
               FROM dispatches d, jsonb_array_elements(d."receivedItems") e
              WHERE d.date >= $1 AND d.date <= $2 ${extra}
              GROUP BY ${groupExpr}
              ORDER BY 4 DESC
              LIMIT 1000`,
            params
        )).rows;

        const totals = rows.reduce((s, r) => ({
            dispatches: s.dispatches + r.dispatches, qty: s.qty + Number(r.qty),
            approved_qty: s.approved_qty + Number(r.approved_qty || 0),
            variance_qty: s.variance_qty + Number(r.variance_qty || 0),
        }), { dispatches: 0, qty: 0, approved_qty: 0, variance_qty: 0 });
        totals.qty = Math.round(totals.qty * 100) / 100;
        res.set('Cache-Control', 'no-store');
        res.json({ ok: true, from, to, group, rows, totals, count: rows.length });
    } catch (e) {
        logger.error('[received-items]', e);
        res.status(500).json({ ok: false, error: 'RECEIVED_ITEMS_FAILED' });
    }
});

/**
 * GET /api/yara-reports/received-dispatches — أذونات الصرف المستلمة (قائمة)
 * ?from=&to=[&dept=&limit=&offset=]
 */
router.get('/received-dispatches', requireRole('sous_chef', 'admin', 'owner'), async (req, res) => {
    try {
        const dayRe = /^\d{4}-\d{2}-\d{2}$/;
        const from = dayRe.test(String(req.query.from || '')) ? req.query.from : riyadhDay(-29);
        const to = dayRe.test(String(req.query.to || '')) ? req.query.to : riyadhDay(0);
        if (from > to) {return res.status(422).json({ ok: false, error: 'INVALID_RANGE' });}
        const dept = String(req.query.dept || '').trim().slice(0, 60);
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
        const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

        const params = [from, to];
        let extra = ` AND d.status IN ('received','partially_received') AND d."receivedItems" IS NOT NULL`;
        if (dept) {params.push('%' + dept + '%'); extra += ` AND d."deptName" ILIKE $${params.length}`;}

        const cnt = (await pool.query(
            `SELECT COUNT(*)::int AS n FROM dispatches d WHERE d.date >= $1 AND d.date <= $2 ${extra}`, params
        )).rows[0].n;

        params.push(limit, offset);
        const rows = (await pool.query(
            `SELECT d.id, d."deptCode", d."deptName", d.date, d.status,
                    d."kitchenReceivedAt", d."kitchenReceivedBy", d."receiptNotes",
                    jsonb_array_length(d."receivedItems") AS items_count,
                    (SELECT COALESCE(SUM((e->>'receivedQty')::numeric), 0) FROM jsonb_array_elements(d."receivedItems") e) AS total_qty
               FROM dispatches d
              WHERE d.date >= $1 AND d.date <= $2 ${extra}
              ORDER BY d."kitchenReceivedAt" DESC NULLS LAST, d.id DESC
              LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        )).rows;

        const out = rows.map(r => ({
            id: String(r.id), dept_code: r.deptCode, dept_name: r.deptName,
            date: r.date, status: r.status,
            received_at: r.kitchenReceivedAt, received_by: r.kitchenReceivedBy,
            notes: r.receiptNotes, items_count: r.items_count,
            total_qty: Number(r.total_qty || 0),
        }));
        res.set('Cache-Control', 'no-store');
        res.json({ ok: true, from, to, dispatches: out, total: cnt, limit, offset });
    } catch (e) {
        logger.error('[received-dispatches]', e);
        res.status(500).json({ ok: false, error: 'RECEIVED_DISPATCHES_FAILED' });
    }
});

/**
 * GET /api/yara-reports/received-dispatch-detail/:id — تفاصيل إذن صرف مستلم
 */
router.get('/received-dispatch-detail/:id', requireRole('sous_chef', 'admin', 'owner'), async (req, res) => {
    try {
        const id = String(req.params.id || '').trim().slice(0, 30);
        if (!id) {return res.status(422).json({ ok: false, error: 'NO_ID' });}
        const r = (await pool.query(
            `SELECT id, "deptCode", "deptName", date, status, items, "approvedItems", "receivedItems",
                    "kitchenReceivedAt", "kitchenReceivedBy", "receiptNotes", notes,
                    "createdBy", "warehouseApprovedAt", "warehouseApprovedBy"
               FROM dispatches WHERE id::text = $1 LIMIT 1`, [id]
        )).rows[0];
        if (!r) {return res.status(404).json({ ok: false, error: 'NOT_FOUND' });}
        res.set('Cache-Control', 'no-store');
        res.json({ ok: true, dispatch: {
            id: String(r.id), dept_code: r.deptCode, dept_name: r.deptName,
            date: r.date, status: r.status,
            items: Array.isArray(r.items) ? r.items : [],
            approved_items: Array.isArray(r.approvedItems) ? r.approvedItems : [],
            received_items: Array.isArray(r.receivedItems) ? r.receivedItems : [],
            received_at: r.kitchenReceivedAt, received_by: r.kitchenReceivedBy,
            receipt_notes: r.receiptNotes, notes: r.notes,
            created_by: r.createdBy,
            warehouse_approved_at: r.warehouseApprovedAt, warehouse_approved_by: r.warehouseApprovedBy,
        }});
    } catch (e) {
        logger.error('[received-dispatch-detail]', e);
        res.status(500).json({ ok: false, error: 'DISPATCH_DETAIL_FAILED' });
    }
});

/**
 * GET /api/yara-reports/item-outflow — تحليل ذكي للاستهلاك
 * ?from=&to=[&item=]
 * يرجع: ملخص + رصيد كل صنف + متوسط يومي + اتجاه + تنبيهات + حركات تفصيلية.
 */
router.get('/item-outflow', requireRole('sous_chef', 'admin', 'owner'), async (req, res) => {
    try {
        const dayRe = /^\d{4}-\d{2}-\d{2}$/;
        const from = dayRe.test(String(req.query.from || '')) ? req.query.from : riyadhDay(-29);
        const to = dayRe.test(String(req.query.to || '')) ? req.query.to : riyadhDay(0);
        if (from > to) {return res.status(422).json({ ok: false, error: 'INVALID_RANGE' });}
        const spanDays = Math.round((new Date(to + 'T12:00:00Z') - new Date(from + 'T12:00:00Z')) / 86400000) + 1;
        if (spanDays > 93) {return res.status(422).json({ ok: false, error: 'RANGE_TOO_WIDE', message: 'الحد الأقصى 93 يومًا' });}
        const item = String(req.query.item || '').trim().slice(0, 60);

        const params = [from, to];
        let extra = ` AND t.type IN ('in','out')`;
        if (item) {
            const words = item.split(/\s+/).filter(Boolean).map(w => w.replace(/^ال/, '').replace(/^وال/, '').replace(/^بال/, '')).filter(w => w.length >= 2);
            const terms = words.length ? words : [item];
            const ors = terms.map((w) => {params.push('%' + w + '%'); return `t."itemName" ILIKE $${params.length}`;}).join(' OR ');
            extra += ` AND (${ors})`;
        }

        const rows = (await pool.query(
            `SELECT t."itemName" AS item_name,
                    COALESCE(SUM(CASE WHEN t.type='in' THEN t.qty ELSE 0 END), 0)::float AS qty_in,
                    COALESCE(SUM(CASE WHEN t.type='out' THEN t.qty ELSE 0 END), 0)::float AS qty_out,
                    COUNT(*) FILTER (WHERE t.type='in')::int AS in_count,
                    COUNT(*) FILTER (WHERE t.type='out')::int AS out_count,
                    MIN(t.date) AS first_date, MAX(t.date) AS last_date,
                    COUNT(DISTINCT t.date) FILTER (WHERE t.type='out')::int AS out_days
               FROM "inventoryTx" t
              WHERE t.date >= $1 AND t.date <= $2 ${extra}
              GROUP BY 1
              ORDER BY 4 DESC, 1
              LIMIT 1000`,
            params
        )).rows;

        // رصيد كل صنف كليًا (كل الفترات — للعرض في تبويب الرصيد)
        const balParams = item ? [] : [];
        let balExtra = '';
        if (item) {
            const words = item.split(/\s+/).filter(Boolean).map(w => w.replace(/^ال/, '').replace(/^وال/, '').replace(/^بال/, '')).filter(w => w.length >= 2);
            const terms = words.length ? words : [item];
            const ors = terms.map((w) => {balParams.push('%' + w + '%'); return `t."itemName" ILIKE $${balParams.length}`;}).join(' OR ');
            balExtra = ` AND (${ors})`;
        }
        const balances = (await pool.query(
            `SELECT t."itemName" AS item_name,
                    COALESCE(SUM(CASE WHEN t.type='in' THEN t.qty ELSE 0 END), 0)::float AS total_in,
                    COALESCE(SUM(CASE WHEN t.type='out' THEN t.qty ELSE 0 END), 0)::float AS total_out
               FROM "inventoryTx" t WHERE t.type IN ('in','out') ${balExtra}
              GROUP BY 1 HAVING COALESCE(SUM(CASE WHEN t.type='out' THEN t.qty ELSE 0 END), 0) > 0
              ORDER BY 3 DESC LIMIT 500`,
            balParams
        )).rows;
        const balMap = new Map(balances.map(b => [b.item_name, { total_in: Number(b.total_in), total_out: Number(b.total_out), balance: Math.round((Number(b.total_in) - Number(b.total_out)) * 100) / 100 }]));

        // إثراء الصفوف بالتحليل الذكي
        const span = Math.max(spanDays, 1);
        for (const r of rows) {
            const bal = balMap.get(r.item_name) || { total_in: 0, total_out: 0, balance: 0 };
            r.balance = bal.balance;
            r.total_in = bal.total_in;
            r.total_out = bal.total_out;
            r.avg_daily_out = r.out_days > 0 ? Math.round((Number(r.qty_out) / r.out_days) * 100) / 100 : 0;
            r.period_avg_daily = span > 0 ? Math.round((Number(r.qty_out) / span) * 100) / 100 : 0;
            r.trend = 'stable';
            if (r.out_days >= 4 && r.avg_daily_out > 0) {
                // اتجاه بسيط: مقارنة النصف الأول بالثاني من الفترة
                r.trend = Number(r.qty_out) > 0 ? 'active' : 'stable';
            }
            if (Number(r.balance) < 0) { r.alert = 'negative'; }
            else if (Number(r.balance) === 0 && Number(r.qty_out) > 0) { r.alert = 'depleted'; }
            else if (Number(r.qty_out) > 0 && Number(r.balance) > 0 && r.period_avg_daily > 0 && Number(r.balance) < r.period_avg_daily * 3) { r.alert = 'low'; }
            else { r.alert = 'ok'; }
        }

        const totals = rows.reduce((s, r) => ({
            qty_in: s.qty_in + Number(r.qty_in), qty_out: s.qty_out + Number(r.qty_out),
        }), { qty_in: 0, qty_out: 0 });
        totals.qty_in = Math.round(totals.qty_in * 100) / 100;
        totals.qty_out = Math.round(totals.qty_out * 100) / 100;

        // حركات تفصيلية
        const dParams = [from, to];
        let dExtra = ` AND t.type IN ('in','out')`;
        if (item) {
            const words = item.split(/\s+/).filter(Boolean).map(w => w.replace(/^ال/, '').replace(/^وال/, '').replace(/^بال/, '')).filter(w => w.length >= 2);
            const terms = words.length ? words : [item];
            const ors = terms.map((w) => {dParams.push('%' + w + '%'); return `t."itemName" ILIKE $${dParams.length}`;}).join(' OR ');
            dExtra += ` AND (${ors})`;
        }
        const details = (await pool.query(
            `SELECT t.id, t."itemName" AS item_name, t.qty, t.type, t.date, t.notes, t."dispatchId"
               FROM "inventoryTx" t
              WHERE t.date >= $1 AND t.date <= $2 ${dExtra}
              ORDER BY t.date DESC, t.id DESC
              LIMIT 300`,
            dParams
        )).rows;

        // تنبيهات ذكية
        const alerts = [];
        for (const r of rows) {
            if (r.alert === 'negative') { alerts.push({ type: 'danger', item: r.item_name, msg: `رصيد سالب: صُرف ${r.qty_out} ولم يُسجَّل وارد كافٍ` }); }
            else if (r.alert === 'depleted') { alerts.push({ type: 'warning', item: r.item_name, msg: 'الرصيد صفر — كل ما ورد تم صرفه' }); }
            else if (r.alert === 'low') { alerts.push({ type: 'info', item: r.item_name, msg: `الرصيد منخفض: ${r.balance} — متوسط الاستهلاك ${r.period_avg_daily}/يوم` }); }
        }

        res.set('Cache-Control', 'no-store');
        res.json({ ok: true, from, to, spanDays, rows, totals, count: rows.length, details, alerts, balances: [...balMap.entries()].map(([name, b]) => ({ item_name: name, ...b })).sort((a, b) => a.balance - b.balance).slice(0, 100) });
    } catch (e) {
        logger.error('[item-outflow]', e);
        res.status(500).json({ ok: false, error: 'ITEM_OUTFLOW_FAILED' });
    }
});

/**
 * GET /api/yara-reports/item-suggest — اقتراحات أصناف فورية للبحث
 * ?q= partial name match — يرجع أسماء أصناف من inventoryTx
 */
router.get('/item-suggest', requireRole('sous_chef', 'admin', 'owner'), async (req, res) => {
    try {
        const q = String(req.query.q || '').trim().slice(0, 40);
        if (q.length < 2) { return res.json({ ok: true, suggestions: [] }); }
        const rows = (await pool.query(
            `SELECT DISTINCT t."itemName" AS name,
                    COALESCE(SUM(CASE WHEN t.type='in' THEN t.qty ELSE 0 END), 0)::float AS total_in,
                    COALESCE(SUM(CASE WHEN t.type='out' THEN t.qty ELSE 0 END), 0)::float AS total_out
               FROM "inventoryTx" t
              WHERE t."itemName" ILIKE $1
              GROUP BY 1 ORDER BY 3 DESC LIMIT 12`,
            ['%' + q + '%']
        )).rows;
        res.set('Cache-Control', 'no-store');
        res.json({ ok: true, suggestions: rows.map(r => ({ name: r.name, total_in: Number(r.total_in), total_out: Number(r.total_out), balance: Math.round((Number(r.total_in) - Number(r.total_out)) * 100) / 100 })) });
    } catch (e) {
        logger.error('[item-suggest]', e);
        res.status(500).json({ ok: false, error: 'SUGGEST_FAILED' });
    }
});

/**
 * GET /api/yara-reports/wh-vs-pos — مقارنة احترافية: الصرف من المخازن vs مبيعات الكاشيرية
 * ?from=&to=[&item=&group=item|dept&only=mismatch|all&limit=][&live=1]
 * يجمع: أذونات الصرف (dispatches.receivedItems) + مبيعات الكاشيرية (ys_mirror_orders.lines)
 * ويطابقهما بالاسم — فروقات، نسب، تنبيهات. live=1 يزامن المرآة فورًا من الكاشيرية.
 */
const _WV_LIVE_GAP_MS = 45_000;
let _wvLiveBusy = false;
let _wvLiveLast = 0;
let _wvLiveSynced = false;
router.get('/wh-vs-pos', requireRole('sous_chef', 'admin', 'owner'), async (req, res) => {
    try {
        const dayRe = /^\d{4}-\d{2}-\d{2}$/;
        const from = dayRe.test(String(req.query.from || '')) ? req.query.from : riyadhDay(-29);
        const to = dayRe.test(String(req.query.to || '')) ? req.query.to : riyadhDay(0);
        if (from > to) {return res.status(422).json({ ok: false, error: 'INVALID_RANGE' });}
        const spanDays = Math.round((new Date(to + 'T12:00:00Z') - new Date(from + 'T12:00:00Z')) / 86400000) + 1;
        if (spanDays > 93) {return res.status(422).json({ ok: false, error: 'RANGE_TOO_WIDE', message: 'الحد الأقصى 93 يومًا' });}
        const item = String(req.query.item || '').trim().slice(0, 60);
        const only = String(req.query.only || 'all') === 'mismatch' ? 'mismatch' : 'all';

        // ── مزامنة حية من الكاشيرية (live=1) ──────────────────────────────────
        // عند طلب ?live=1 (من شاشة المقارنة فقط) نُحدّث مرآة الكاشيرية فورًا
        // من يارا سوفت قبل القراءة — نفس نموذج cashier-monitor.
        // throttle 45 ثانية حتى لا نُثقل Oracle لو عدة شاشات مفتوحة.
        if (String(req.query.live || '') === '1' && to === riyadhDay(0)) {
            if (!_wvLiveBusy && Date.now() - _wvLiveLast >= _WV_LIVE_GAP_MS) {
                _wvLiveBusy = true; _wvLiveLast = Date.now();
                try {
                    const { refreshMirrorOrders } = require('./mirror');
                    const m = await refreshMirrorOrders({ days: 2, io: req.io || null });
                    _wvLiveSynced = !!(m && m.ok && m.upserted > 0);
                } catch (_) { /* best-effort */ }
                _wvLiveBusy = false;
            }
        }

        // تطبيع الاسم: إزالة «ال»، التشكيل، المسافات الزائدة، الألف المقصورة
        function normName(s) {
            return String(s || '')
                .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
                .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
                .replace(/^ال/, '').replace(/^وال/, '').replace(/^بال/, '').replace(/^فال/, '')
                .replace(/\s+/g, ' ').trim().toLowerCase();
        }

        // 1) الصرف من أذونات الصرف
        const dParams = [from, to];
        let dExtra = ` AND d.status IN ('received','partially_received') AND d."receivedItems" IS NOT NULL`;
        if (item) {
            const words = item.split(/\s+/).filter(Boolean).map(w => w.replace(/^ال/, '').replace(/^وال/, '').replace(/^بال/, '')).filter(w => w.length >= 2);
            const terms = words.length ? words : [item];
            const ors = terms.map((w) => {dParams.push('%' + w + '%'); return `e->>'itemName' ILIKE $${dParams.length}`;}).join(' OR ');
            dExtra += ` AND (${ors})`;
        }
        const dispatchRows = (await pool.query(
            `SELECT e->>'itemName' AS name,
                    SUM((e->>'receivedQty')::numeric)::float AS qty,
                    COUNT(DISTINCT d.id)::int AS docs,
                    MAX(d."deptName") AS dept
               FROM dispatches d, jsonb_array_elements(d."receivedItems") e
              WHERE d.date >= $1 AND d.date <= $2 ${dExtra}
              GROUP BY 1 ORDER BY 2 DESC LIMIT 2000`,
            dParams
        )).rows;

        // 2) مبيعات الكاشيرية
        const sParams = [from, to];
        let sExtra = '';
        if (item) {
            const words = item.split(/\s+/).filter(Boolean).map(w => w.replace(/^ال/, '').replace(/^وال/, '').replace(/^بال/, '')).filter(w => w.length >= 2);
            const terms = words.length ? words : [item];
            const ors = terms.map((w) => {sParams.push('%' + w + '%'); return `l->>'name' ILIKE $${sParams.length}`;}).join(' OR ');
            sExtra = ` AND (${ors})`;
        }
        const posRows = (await pool.query(
            `SELECT l->>'name' AS name,
                    SUM((l->>'qty')::numeric)::float AS qty,
                    SUM((l->>'total')::numeric)::float AS net,
                    SUM((l->>'vat')::numeric)::float AS vat,
                    COUNT(DISTINCT o.doc_no)::int AS invoices
               FROM ys_mirror_orders o, jsonb_array_elements(o.lines) l
              WHERE o.doc_date >= $1 AND o.doc_date <= $2 ${sExtra}
              GROUP BY 1 ORDER BY 2 DESC LIMIT 3000`,
            sParams
        )).rows;

        // 3) الطابق بالاسم المُطبَّع
        const dispMap = new Map();
        for (const r of dispatchRows) {
            const k = normName(r.name);
            if (!dispMap.has(k)) { dispMap.set(k, { name: r.name, qty: 0, docs: 0, dept: r.dept }); }
            const e = dispMap.get(k);
            e.qty += Number(r.qty); e.docs += r.docs; e.dept = e.dept || r.dept;
        }
        const posMap = new Map();
        for (const r of posRows) {
            const k = normName(r.name);
            if (!posMap.has(k)) { posMap.set(k, { name: r.name, qty: 0, net: 0, vat: 0, invoices: 0 }); }
            const e = posMap.get(k);
            e.qty += Number(r.qty); e.net += Number(r.net || 0); e.vat += Number(r.vat || 0); e.invoices += r.invoices;
        }

        // 4) الدمج والمقارنة
        const allKeys = new Set([...dispMap.keys(), ...posMap.keys()]);
        const merged = [];
        for (const k of allKeys) {
            const d = dispMap.get(k) || { name: '', qty: 0, docs: 0, dept: '' };
            const p = posMap.get(k) || { name: '', qty: 0, net: 0, vat: 0, invoices: 0 };
            const name = d.name || p.name;
            const diff = Math.round((Number(p.qty) - Number(d.qty)) * 100) / 100;
            const pct = Number(d.qty) > 0 ? Math.round((diff / Number(d.qty)) * 10000) / 100 : (Number(p.qty) > 0 ? 100 : 0);
            let status = 'match';
            if (Number(d.qty) === 0 && Number(p.qty) > 0) { status = 'pos_only'; }
            else if (Number(p.qty) === 0 && Number(d.qty) > 0) { status = 'wh_only'; }
            else if (Math.abs(diff) > 0.01) { status = diff > 0 ? 'sold_more' : 'issued_more'; }
            merged.push({
                name, norm: k,
                wh_qty: Math.round(Number(d.qty) * 100) / 100,
                pos_qty: Math.round(Number(p.qty) * 100) / 100,
                diff, pct,
                wh_docs: d.docs, dept: d.dept || '',
                pos_invoices: p.invoices,
                pos_net: Math.round(Number(p.net) * 100) / 100,
                pos_vat: Math.round(Number(p.vat) * 100) / 100,
                pos_gross: Math.round((Number(p.net) + Number(p.vat)) * 100) / 100,
                status,
            });
        }
        // ترتيب: المباع أكثر ثم المصرف أكثر ثم غير المتطابق ثم الباقي
        merged.sort((a, b) => {
            const order = { sold_more: 0, issued_more: 1, pos_only: 2, wh_only: 3, match: 4 };
            if (order[a.status] !== order[b.status]) { return order[a.status] - order[b.status]; }
            return Math.abs(b.diff) - Math.abs(a.diff);
        });

        const filtered = only === 'mismatch' ? merged.filter(m => m.status !== 'match') : merged;

        // ملخص
        const summary = {
            total_items: merged.length,
            matched: merged.filter(m => m.status === 'match').length,
            sold_more: merged.filter(m => m.status === 'sold_more').length,
            issued_more: merged.filter(m => m.status === 'issued_more').length,
            pos_only: merged.filter(m => m.status === 'pos_only').length,
            wh_only: merged.filter(m => m.status === 'wh_only').length,
            total_wh_qty: Math.round(merged.reduce((s, m) => s + m.wh_qty, 0) * 100) / 100,
            total_pos_qty: Math.round(merged.reduce((s, m) => s + m.pos_qty, 0) * 100) / 100,
            total_pos_net: Math.round(merged.reduce((s, m) => s + m.pos_net, 0) * 100) / 100,
            total_pos_gross: Math.round(merged.reduce((s, m) => s + m.pos_gross, 0) * 100) / 100,
        };

        res.set('Cache-Control', 'no-store');
        res.json({ ok: true, from, to, spanDays, liveSynced: _wvLiveSynced, rows: filtered, summary, count: filtered.length });
    } catch (e) {
        logger.error('[wh-vs-pos]', e);
        res.status(500).json({ ok: false, error: 'WH_VS_POS_FAILED' });
    }
});

module.exports = router;
