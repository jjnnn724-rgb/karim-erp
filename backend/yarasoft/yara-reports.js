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
        poolMin: 0, poolMax: 3, queueTimeout: 15000,
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
        const { loadOracleConfig, oraExecute, sanitizeError } = require('./oracle-link');
        const oracledb = require('oracledb');
        const cfg = loadOracleConfig();
        if (!cfg.enabled) {return res.status(409).json({ ok: false, error: 'ORACLE_DISABLED' });}
        const t0 = Date.now();
        const oPool = await _ciPoolGet(oracledb, cfg);
        conn = await oPool.getConnection();
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
const CT_CACHE_MS = 30 * 1000;
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
        const { loadOracleConfig, oraExecute } = require('./oracle-link');
        const oracledb = require('oracledb');
        const cfg = loadOracleConfig();
        if (!cfg.enabled) {return res.status(409).json({ ok: false, error: 'ORACLE_DISABLED' });}
        const t0 = Date.now();
        conn = await (await _ciPoolGet(oracledb, cfg)).getConnection();
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
        res.status(500).json({ ok: false, error: sanitizeError(e.message) });
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

module.exports = router;
