/**
 * cashier-sales-routes.js — مبيعات الكاشير: كل الفواتير وتفاصيل كل صنف (قراءة فقط)
 * ═══════════════════════════════════════════════════════════════════════════
 * المصدر الوحيد: ys_mirror_orders — مرآة YaraSoft الحيّة (CC_BILLS3 +
 * CC_BILL_ENTER3) التي يكتبها backend/yarasoft/mirror.js. هذه هي الفواتير
 * الفعلية الصادرة من الكاشيريات؛ أمّا pos_orders فهو جدول نقاط البيع المحلية
 * وعندنا فارغ، فلا يُقرأ هنا إطلاقًا.
 *
 *   GET /api/cashier-sales/summary                 مجاميع الفترة + السلسلة + الكاشيريات + الدفع + الطزاجة
 *   GET /api/cashier-sales/orders                  الفواتير بترقيمٍ صادق
 *   GET /api/cashier-sales/items                   الأصناف المباعة مجمَّعة بترقيمٍ صادق
 *   GET /api/cashier-sales/item/:code              ملف الصنف: كميّته وكل فواتيره (مرقَّم)
 *   GET /api/cashier-sales/invoice/:docNo          الفاتورة على الشاشة: سطورها ودفعها واعتمادها
 *   GET /api/cashier-sales/invoice/:docNo/html     الفاتورة مطبوعة (إيصال 80مم)
 *   GET /api/cashier-sales/html?view=…             الكشف مطبوعًا (أوراق | أصناف | صنف واحد)
 *
 * دلالة الأرقام — مقيسة على المرآة لا مُستنتَقة من الأسماء:
 *   · net    = ما دُفع فعلًا شاملًا الضريبة            → يُبلَّغ باسم `collected`
 *   · total  = صافي الأصناف قبل الضريبة (= Σ سطور الفاتورة) → `ex_vat`
 *   · vat    = الضريبة المحسوبة على كل سطر
 *   و `collected ≠ ex_vat + vat` في أغلب السندات. جزءٌ من ذلك تقريبُ تسعيرةٍ
 *   لكل سطرٍ قبل الجمع، لكن القياسَ (أكتوبر 2026) أظهر أن الغالبية العظمى
 *   تجاوزُ قدرَ ذلك التقريب: 15,563 سندًا من 17,043 فارقُها أكبرُ من هللتين
 *   لكل سطر، بمجموع −7,597.79 من −7,601.10 — أي أن المحصَّلَ لا يطابق
 *   المُسعَّرَ في المرآة. المرآةُ لا تسجّل سببَ الفرق، فلا يُنسَبُ إلى سببٍ
 *   مجهولة: يُبلَّغ العددُ والمجموعُ وقدرُ ما جاوزَ التقريب
 *   (`drift_docs`, `drift_amount`, `drift_large_docs`, `drift_large_amount`)
 *   ولا يُدارى الانحراف بجمعٍ «نظيف» في الواجهة.
 *
 * كلُّ مشتقٍّ يُحسب هنا: النسب والمجاميع والمتوسطات والاسم العربي للكاشير
 * والعملة. الواجهة تعرض ولا تحسب. والترقيم صادق: `totals.count` هو عدد
 * المطابق كلّه لا عدد المعروض.
 */
'use strict';

const express = require('express');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { generalLimiter } = require('./rate-limiter');
const { pool } = require('./shared-pool');
const { logger } = require('./logger');
const QRCode = require('qrcode');

const router = express.Router();
/* الشاشة قراءةٌ فقط، والأدوار هي مَن يستطيع طباعة الإيصال أصلا (cashier) أو
   محاسبةً عليه (accountant) — فلا بابٌ يفتح على مستندٍ لا يُطبع من داخله. */
const READ_ROLES = ['admin', 'manager', 'accountant', 'cashier'];

/* ── أدوات ──────────────────────────────────────────────────────────────── */
const dayRe = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const num = (v, d = 2) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
/* esc يستعمل &quot;: الشعار يصل إلى خاصية src كما هو، والفواصل في سلسلة
   base64 هي ; و , — لو استُبدلت مراجعها لانكسر الصورة. */
const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const hhmm = (v) => String(v || '').slice(0, 5) || '—';
/** التاريخ يُقرأ من SQL بـ to_char: عمود DATE يعود كـ Date عند منتصف الليل
    المحلي، وtoISOString().slice(0,10) يُرجّعه يومًا للوراء. */
const DAY = (col) => `to_char(${col},'YYYY-MM-DD')`;
/* الطابع بالتوقيت المحلي — هو ما تقرأه الشاشة وما طُبِع على الإذن. */
const stamp = (v) => {
    const d = v instanceof Date ? v : new Date(String(v || ''));
    if (Number.isNaN(d.getTime())) {return String(v || '').slice(0, 16).replace('T', ' ');}
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const CURRENCY_AR = { SAR: 'ر.س', EGP: 'ج.م', AED: 'د.إ', USD: '$', EUR: '€', GBP: '£' };

/* رقمٌ أو تاريخٌ داخل جملةٍ عربية يُعزل ثنائيًّا: بلا عزلةٍ يضعُ ترتيبُ
   Unicode التاريخَ الأخير قبل الأول، فيُطبع الكشف «من 22-10 إلى 01-10»
   ويقرأه المحاسبُ فترةً معكوسة. العزلةُ تُرجِعه إلى نصابه. */
const ltr = (v) => `<span class="ltr">${esc(v)}</span>`;

/* خليةُ مؤشرٍ في الكشف: القيمةُ HTMLٌ مبنيٌّ بمكانه — فإمّا ltr() وإمّا esc(),
   ولا قيمةً خامًا تصل إلى الورقة. */
const cell = (k, v) => `<div class="cell"><b>${esc(k)}</b><span>${v}</span></div>`;
/* مبلغٌ بعملةٍ في سطرٍ واحد: بلا هذا العزل تنفصل «ر.س» عن رقمها في عمودٍ
   ضيّق، فتُطبع الخليةُ رقمًا في سطرٍ وعملَةً في سطرٍ تحته. */
const moneyLtr = (v, cur) => `<span class="ltr">${esc(num(v))} ${esc(cur)}</span>`;

const BRAND_FALLBACK = { name: 'مطاعم الشرفة العالمي', currency: 'ر.س', logo: '' };

async function loadBrand() {
    try {
        const r = await pool.query(
            `SELECT name, currency, "logoB64" FROM settings WHERE id = 'main_settings' LIMIT 1`);
        const row = r.rows[0] || {};
        const code = String(row.currency || '').trim();
        return {
            name: String(row.name || '').trim() || BRAND_FALLBACK.name,
            currency: CURRENCY_AR[code.toUpperCase()] || code || BRAND_FALLBACK.currency,
            logo: /^data:image\//i.test(String(row.logoB64 || '')) ? String(row.logoB64) : '',
        };
    } catch (err) {
        logger.warn({ err: err.message }, '[cashier-sales] brand unavailable — fallback');
        return { ...BRAND_FALLBACK };
    }
}

/* ── أسماء الكاشيريات ──────────────────────────────────────────────────────
   من خريطة الإيرادات المعتمَدة، بلا نصٍّ مُختلَق: الرقم وحده يظهر إن لم
   يكن اسمٌ مُصادقٌ عليه، والتجميع على src_name مكرَّرًا لا يُضاعف الصفوف. */
const CC_CTE = `cc AS (
    SELECT TRIM(src_name) AS no, MIN(display_ar) AS name
      FROM yarasoft_revenue_map
     WHERE src_table = 'CC' AND active = true
     GROUP BY 1
)`;
const CASHIER_NAME = `COALESCE(cc.name,
    CASE WHEN NULLIF(TRIM(o.cashier_no),'') IS NULL THEN 'غير مُسند'
         ELSE 'كاشير ' || TRIM(o.cashier_no) END)`;
const CC_JOIN = `LEFT JOIN cc ON cc.no = TRIM(o.cashier_no)`;

/* السطور: المرآة تخزنها في jsonb واحد داخل السند، والتفكيك هنا هو المصدر
   الوحيد لكميّات الأصناف. الحارس على jsonb_typeof يُبقي الاستعلام حيًّا لو
   خرج سطرٌ عن الشكل (صفيفٌ فارغ بدل أن ينفجر التوسيع). */
const LINE_UNNEST_BODY = `CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(o.lines) = 'array' THEN o.lines ELSE '[]'::jsonb END) AS l`;
const LINE_FROM = `FROM ys_mirror_orders o ${LINE_UNNEST_BODY}`;
const L_NAME = `COALESCE(NULLIF(TRIM(l->>'name'),''),'بلا اسم')`;
const L_CODE = `COALESCE(NULLIF(TRIM(l->>'code'),''),'بلا كود')`;
const L_QTY = `COALESCE((l->>'qty')::numeric,0)`;
const L_TOT = `COALESCE((l->>'total')::numeric,0)`;
const L_VAT = `COALESCE((l->>'vat')::numeric,0)`;
const L_PRICE = `COALESCE((l->>'price')::numeric,0)`;

/* ── المرشّحات ─────────────────────────────────────────────────────────────
   من + إلى + كاشير + بحث ⇒ شرطٌ واحد يُبنى في مكانٍ واحد، فلا يختلف
   «المجموع» عن «الصفوف» عن «السلسلة» عن «الكشف المطبوع». البحث في الفواتير
   يمس رقم السند أو أيَّ صنفٍ فيه؛ وفي كشف الأصناف يمس الصنف نفسه. */
function readQuery(query) {
    return {
        from: dayRe.test(String(query.from || '')) ? String(query.from) : '',
        to: dayRe.test(String(query.to || '')) ? String(query.to) : '',
        cashier: String(query.cashier || '').trim().replace(/[^\w-]/g, '').slice(0, 8),
        q: String(query.q || '').trim().slice(0, 60),
    };
}

const LINES_LEN = `CASE WHEN jsonb_typeof(o.lines) = 'array'
                        THEN jsonb_array_length(o.lines) ELSE 0 END`;

function buildWhere(f) {
    const params = [];
    const where = [];
    /* `?` قد تتكرر في المرشّح الواحد، فالترقيم لكل معاملٍ على حده. */
    const add = (sql, ...values) => {
        let i = 0;
        where.push(sql.replace(/\?/g, () => { params.push(values[i]); i += 1; return `$${params.length}`; }));
    };
    if (f.from) {add('o.doc_date >= ?::date', f.from);}
    if (f.to) {add('o.doc_date <= ?::date', f.to);}
    if (f.cashier) {add('TRIM(o.cashier_no) = ?', f.cashier);}
    if (f.q) {
        /* البحث في الشاشة «فاتورة فيها هذا الصنف» — لا «سطر بهذا الاسم»
           وحده، فرقم السند جزءٌ من نفس المربع. */
        add(`(o.doc_no ILIKE ? OR EXISTS (
               SELECT 1 FROM jsonb_array_elements(
                   CASE WHEN jsonb_typeof(o.lines) = 'array' THEN o.lines ELSE '[]'::jsonb END) s
                WHERE COALESCE(NULLIF(TRIM(s->>'name'),''),'') ILIKE ?
                   OR COALESCE(NULLIF(TRIM(s->>'code'),''),'') ILIKE ?))`,
        `%${f.q}%`, `%${f.q}%`, `%${f.q}%`);
    }
    return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params, ...f };
}

/** شرط كشف الأصناف: البحث عن الصنف يُصبح ANDًا لا ORًا مع البقية، لأن
    «بحثٌ في السطر» ضيّقٌ و«بحثٌ في السند» واسِع. */
function lineFilter(f) {
    const params = [];
    const where = [];
    const add = (sql, ...values) => {
        let i = 0;
        where.push(sql.replace(/\?/g, () => { params.push(values[i]); i += 1; return `$${params.length}`; }));
    };
    if (f.from) {add('o.doc_date >= ?::date', f.from);}
    if (f.to) {add('o.doc_date <= ?::date', f.to);}
    if (f.cashier) {add('TRIM(o.cashier_no) = ?', f.cashier);}
    if (f.q) {add(`(${L_NAME} ILIKE ? OR ${L_CODE} ILIKE ?)`, `%${f.q}%`, `%${f.q}%`);}
    return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params, ...f };
}

/* الفرز على قائمة بيضاء — لا إدخالٌ يصل إلى SQL. */
const ORDER_SORTS = {
    date: 'o.doc_date, o.doc_time::time', no: 'o.doc_no::bigint',
    collected: 'o.net', ex_vat: 'o.total', vat: 'o.vat', items: LINES_LEN,
};
const ITEM_SORTS = {
    qty: 'c.qty', total: 'c.ex_vat', vat: 'c.vat', docs: 'c.docs',
    name: 't.name', code: 'c.code', lines: 'c.lines', prices: 'c.prices',
};
function pickSort(map, query, fallback) {
    const raw = String(query.sort || '').slice(0, 12);
    return map[raw] ? raw : fallback;
}

const pageOf = (query, dflt) => ({
    limit: Math.min(Math.max(Number(query.limit) || dflt, 1), 1000),
    offset: Math.max(Number(query.offset) || 0, 0),
});
const shareOf = (v, total) => (total > 0 ? round2((Number(v) || 0) / total * 100) : 0);

/* الفارق عن الفترة المماثلة السابقة: نفس الطول قبل `from` — لا تُقارن إلا
   إذا حُدد الطرفان، وإلا كان «الفرق» رقمًا من فراغ. والمرآة تبدأ من يومٍ
   معلوم، فما سبقها ليس مبيعات صفرًا بل بياناتٍ غير موجودة؛ فإن مسّت
   النافذةُ السابقةُ ذلك الحدَّ تُبلَّغ `partial` ولا يُحسب «فرق». */
async function prevCollected(f, firstDay) {
    if (!f.from || !f.to) {return null;}
    const dayMs = 86400000;
    const a = Date.parse(`${f.from}T00:00:00Z`);
    const b = Date.parse(`${f.to}T00:00:00Z`);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) {return null;}
    const span = Math.round((b - a) / dayMs) + 1;
    const shift = (d) => new Date(d - span * dayMs).toISOString().slice(0, 10);
    const from = shift(a);
    const to = shift(b);
    const p = buildWhere({ ...f, from, to });
    const r = await pool.query(
        `SELECT COALESCE(SUM(o.net),0)::float AS collected FROM ys_mirror_orders o ${p.clause}`, p.params);
    const row = r.rows[0] || {};
    /* «غير مكتملة» إن بدأت النافذة قبل أول يومٍ في المرآة — فذلك ليس صفرَ
       مبيعات، ذلك عدمُ بيانات، والفرق بينهما يُقال لا يُخمَّن. */
    return {
        collected: round2(row.collected),
        from, to,
        partial: Boolean(firstDay) && from < firstDay,
    };
}

/* ── ١) ملخص الفترة ─────────────────────────────────────────────────────── */
router.get('/summary', jwtAuth, requireRole(...READ_ROLES), generalLimiter, async (req, res) => {
    try {
        const f = buildWhere(readQuery(req.query));
        const timeF = { ...f, clause: [`NULLIF(TRIM(o.doc_time),'') IS NOT NULL`,
            ...(f.clause ? [f.clause.replace(/^WHERE /, '')] : [])].map((x) => `(${x})`).join(' AND ') };
        const timeWhere = `WHERE ${timeF.clause}`;
        const brand = await loadBrand();
        const orders = `FROM ys_mirror_orders o ${f.clause}`;

        const totalsQ = await pool.query(`
            SELECT COUNT(*)::int AS docs,
                   COALESCE(SUM(o.net),0)::float      AS collected,
                   COALESCE(SUM(o.total),0)::float    AS ex_vat,
                   COALESCE(SUM(o.vat),0)::float      AS vat,
                   COALESCE(SUM(o.discount),0)::float AS discount,
                   COALESCE(SUM(o.payed),0)::float    AS payed,
                   COALESCE(SUM(o.pay_cash),0)::float    AS cash,
                   COALESCE(SUM(o.pay_network),0)::float AS network,
                   COALESCE(SUM(o.pay_credit),0)::float  AS credit,
                   COALESCE(SUM(o.pay_mobile),0)::float  AS mobile,
                   COUNT(DISTINCT NULLIF(TRIM(o.cashier_no),''))::int AS cashiers,
                   COUNT(DISTINCT o.doc_date)::int AS days,
                   COALESCE(SUM(${LINES_LEN}),0)::int AS lines,
                   COUNT(*) FILTER (WHERE ${LINES_LEN} = 0)::int AS no_lines,
                   COUNT(*) FILTER (WHERE NULLIF(TRIM(o.doc_time),'') IS NULL)::int AS no_time,
                   COUNT(*) FILTER (WHERE ABS(o.net - (o.total + o.vat)) > 0.005)::int AS drift_docs,
                   ROUND(COALESCE(SUM(o.net - (o.total + o.vat)),0)::numeric,2)::float AS drift_amount,
                   /* الفارقُ الذي يفسّره التقريبُ مقدَّرٌ بعدد السطور (نصفُ هللةٍ
                      في الصافي ومثلُها في الضريبة لكل سطر)؛ ما جاوزَه فارقٌ لا
                      تسجّل المرآةُ سببَه، فلا يُنسَب إلى التقريب. */
                   COUNT(*) FILTER (WHERE ABS(o.net - (o.total + o.vat)) > 0.01 * ${LINES_LEN} + 0.005)::int AS drift_large_docs,
                   ROUND(COALESCE(SUM(o.net - (o.total + o.vat)) FILTER (WHERE ABS(o.net - (o.total + o.vat)) > 0.01 * ${LINES_LEN} + 0.005),0)::numeric,2)::float AS drift_large_amount,
                   COUNT(*) FILTER (WHERE ABS(o.pay_cash + o.pay_network + o.pay_credit + o.pay_mobile - o.net) > 0.005)::int AS pay_unreconciled
              ${orders}
        `, f.params);

        const seriesQ = await pool.query(`
            SELECT ${DAY('o.doc_date')} AS day, COUNT(*)::int AS docs,
                   COALESCE(SUM(o.net),0)::float   AS collected,
                   COALESCE(SUM(o.total),0)::float AS ex_vat,
                   COALESCE(SUM(o.vat),0)::float   AS vat
              ${orders}
             GROUP BY 1 ORDER BY 1 ASC LIMIT 400
        `, f.params);

        const cashiersQ = await pool.query(`
            WITH ${CC_CTE}
            SELECT NULLIF(TRIM(o.cashier_no),'') AS no, ${CASHIER_NAME} AS name,
                   COUNT(*)::int AS docs,
                   COALESCE(SUM(o.net),0)::float   AS collected,
                   COALESCE(SUM(o.total),0)::float AS ex_vat,
                   ${DAY('MAX(o.doc_date)')} AS last_day
              FROM ys_mirror_orders o ${CC_JOIN} ${f.clause}
             GROUP BY 1, 2 ORDER BY collected DESC LIMIT 24
        `, f.params);

        const hoursQ = await pool.query(`
            SELECT EXTRACT(HOUR FROM o.doc_time::time)::int AS hour,
                   COUNT(*)::int AS docs, COALESCE(SUM(o.net),0)::float AS collected
              FROM ys_mirror_orders o ${timeWhere}
             GROUP BY 1 ORDER BY 1 ASC LIMIT 24
        `, f.params);

        const lf = lineFilter(readQuery(req.query));
        /* الصنفُ بالرمز، والمجموعُ من نفس بناء كشف الأصناف — لا وجهان
           لـ«عدد الأصناف» في الشاشة نفسها. */
        const cte = itemsCte(lf);
        const topItemsQ = await pool.query(`${cte}${ITEM_SELECT}
             ORDER BY c.ex_vat DESC, c.qty DESC LIMIT 10
        `, lf.params);

        const codesQ = await pool.query(`${cte}SELECT COUNT(*)::int AS codes FROM per_code`, lf.params);

        const mirrorRows = (await pool.query(`
            SELECT ${DAY('MIN(doc_date)')} AS first_day, ${DAY('MAX(doc_date)')} AS last_day,
                   MAX(synced_at) AS synced_at, COUNT(*)::int AS docs
              FROM ys_mirror_orders
        `)).rows[0] || {};

        const t = totalsQ.rows[0] || {};
        /* تغطيةُ الاعتماد تُقاس هنا مرّة، فلا تُبرَّر شارةٌ غائبةٌ في اللوحة. */
        const zatcaCov = await loadZatcaCoverage(f);
        const collected = round2(t.collected);
        const exVat = round2(t.ex_vat);
        const vat = round2(t.vat);
        const days = Number(t.days) || 0;
        const docs = Number(t.docs) || 0;
        const prev = await prevCollected(readQuery(req.query), mirrorRows.first_day);
        const series = seriesQ.rows.map((r) => ({
            ...r, collected: round2(r.collected), ex_vat: round2(r.ex_vat), vat: round2(r.vat),
        }));
        /* ذروة اليوم وهدوؤه تُقاس هنا وتُنقل جاهزة: الواجهة لا تُقلّب سلسلة
           لتستخرج أكبر رقم — هذا حسابٌ لا عرض. */
        const peak = series.reduce((b, r) => (b && b.collected >= r.collected ? b : r), null);
        const quiet = series.reduce((b, r) => (b && b.collected <= r.collected ? b : r), null);
        const methods = [
            { key: 'cash', label: 'نقد', amount: round2(t.cash) },
            { key: 'network', label: 'شبكة', amount: round2(t.network) },
            { key: 'mobile', label: 'جوال', amount: round2(t.mobile) },
            { key: 'credit', label: 'آجل', amount: round2(t.credit) },
        ].map((m) => ({ ...m, share: shareOf(m.amount, collected) }));

        res.json({
            ok: true,
            currency: brand.currency,
            brand: brand.name,
            from: f.from, to: f.to, cashier: f.cashier, q: f.q,
            totals: {
                docs,
                collected, ex_vat: exVat, vat,
                discount: round2(t.discount),
                payed: round2(t.payed),
                /* ما لم تغطّه أعمدة الدفع الأربعة — يُقال ولا يُدارى. */
                unaccounted: round2(collected - methods.reduce((s, m) => s + m.amount, 0)),
                cashiers: Number(t.cashiers) || 0,
                days,
                lines: Number(t.lines) || 0,
                codes: Number(codesQ.rows[0] && codesQ.rows[0].codes) || 0,
                avg_invoice: docs ? round2(collected / docs) : 0,
                avg_day: days ? round2(collected / days) : 0,
                avg_items: docs ? round2((Number(t.lines) || 0) / docs) : 0,
                no_lines: Number(t.no_lines) || 0,
                no_time: Number(t.no_time) || 0,
                drift_docs: Number(t.drift_docs) || 0,
                drift_amount: round2(t.drift_amount),
                drift_large_docs: Number(t.drift_large_docs) || 0,
                drift_large_amount: round2(t.drift_large_amount),
                pay_unreconciled: Number(t.pay_unreconciled) || 0,
                prev: prev && {
                    collected: prev.collected, from: prev.from, to: prev.to, partial: prev.partial,
                },
                delta: prev && !prev.partial && prev.collected > 0
                    ? round2((collected - prev.collected) / prev.collected * 100) : null,
            },
            series,
            peak, quiet,
            cashiers: cashiersQ.rows.map((r) => ({
                ...r, docs: Number(r.docs) || 0,
                collected: round2(r.collected), ex_vat: round2(r.ex_vat),
                share: shareOf(r.collected, collected),
                avg: (Number(r.docs) || 0) ? round2(Number(r.collected) / Number(r.docs)) : 0,
            })),
            payments: methods,
            hours: hoursQ.rows.map((r) => ({ hour: Number(r.hour), docs: Number(r.docs) || 0, collected: round2(r.collected) })),
            top_items: topItemsQ.rows.map((r) => ({
                ...r, docs: Number(r.docs) || 0, qty: round2(r.qty),
                ex_vat: round2(r.ex_vat), vat: round2(r.vat),
                share: shareOf(r.ex_vat, exVat),
            })),
            mirror: { ...mirrorRows, synced_at: stamp(mirrorRows.synced_at) },
            zatca: zatcaCov,
        });
    } catch (err) {
        logger.error({ err: err.message }, '[cashier-sales] summary failed');
        res.status(500).json({ error: 'INTERNAL', message: err.message });
    }
});

/* ── ٢) الفواتير ────────────────────────────────────────────────────────── */
router.get('/orders', jwtAuth, requireRole(...READ_ROLES), generalLimiter, async (req, res) => {
    try {
        const f = buildWhere(readQuery(req.query));
        const { limit, offset } = pageOf(req.query, 50);
        const key = pickSort(ORDER_SORTS, req.query, 'date');
        const dir = String(req.query.dir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
        const brand = await loadBrand();

        const rowsQ = await pool.query(`
            WITH ${CC_CTE}
            SELECT o.doc_no, ${DAY('o.doc_date')} AS day, o.doc_time,
                   NULLIF(TRIM(o.cashier_no),'') AS cashier_no, ${CASHIER_NAME} AS cashier_name,
                   ${LINES_LEN}::int AS items,
                   o.total::float AS ex_vat, o.vat::float AS vat, o.net::float AS collected,
                   o.payed::float AS payed, o.discount::float AS discount,
                   o.pay_cash::float AS cash, o.pay_network::float AS network,
                   o.pay_mobile::float AS mobile, o.pay_credit::float AS credit,
                   (o.net - (o.total + o.vat))::float AS drift,
                   /* قدرُ التقريب يُقدَّر من عدد السطور عند الخادم، فالصفحةُ
                      لا تنسب فارقًا إلى التقريبِ على حدسٍ من العرض. */
                   (ABS(o.net - (o.total + o.vat)) <= 0.01 * ${LINES_LEN} + 0.005) AS drift_within_rounding
              FROM ys_mirror_orders o ${CC_JOIN} ${f.clause}
             ORDER BY ${ORDER_SORTS[key]} ${dir}${key === 'date' ? `, o.doc_no ${dir}` : ', o.doc_no DESC'}
             LIMIT ${limit} OFFSET ${offset}
        `, f.params);

        const totalsQ = await pool.query(`
            SELECT COUNT(*)::int AS docs, COALESCE(SUM(o.net),0)::float AS collected,
                   COALESCE(SUM(o.total),0)::float AS ex_vat, COALESCE(SUM(o.vat),0)::float AS vat,
                   COALESCE(SUM(${LINES_LEN}),0)::int AS items
              FROM ys_mirror_orders o ${f.clause}
        `, f.params);

        const t = totalsQ.rows[0] || {};
        const collected = round2(t.collected);
        res.json({
            ok: true, currency: brand.currency,
            from: f.from, to: f.to, cashier: f.cashier, q: f.q,
            rows: rowsQ.rows.map((r) => ({
                ...r,
                items: Number(r.items) || 0,
                day: r.day, time: hhmm(r.doc_time),
                collected: round2(r.collected), ex_vat: round2(r.ex_vat), vat: round2(r.vat),
                payed: round2(r.payed), discount: round2(r.discount), drift: round2(r.drift),
                share: shareOf(r.collected, collected),
            })),
            totals: {
                count: Number(t.docs) || 0, docs: Number(t.docs) || 0,
                collected, ex_vat: round2(t.ex_vat), vat: round2(t.vat),
                items: Number(t.items) || 0,
            },
            page: { limit, offset },
        });
    } catch (err) {
        logger.error({ err: err.message }, '[cashier-sales] orders failed');
        res.status(500).json({ error: 'INTERNAL', message: err.message });
    }
});

/* ── ٣) الأصناف المباعة ───────────────────────────────────────────────────
   الصنفُ يُجمَع برمزِه لا باسمه: الكود الواحد قد يحمل اسمين في الكاشيريات
   (مرصودٌ فعلًا)، فالتجميع بالاسم يجعله صنفين ويُضاعف «عدد الأصناف».
   الاسم المعروض أكثرُ أسمائه بيعًا، وعددُ الأسماء والأسعار يُبلَّغ كي لا
   يُدار الغموض. هذا البناء واحدٌ يستعمله JSON والكشف المطبوع. */
function itemsCte(lf) {
    return `WITH pair AS (
        SELECT ${L_CODE} AS code, ${L_NAME} AS name, COALESCE(SUM(${L_QTY}),0) AS qty
          ${LINE_FROM} ${lf.clause}
         GROUP BY 1, 2
    ), top AS (
        SELECT DISTINCT ON (code) code, name FROM pair ORDER BY code, qty DESC, name
    ), per_code AS (
        SELECT ${L_CODE} AS code, COUNT(*)::int AS lines, COUNT(DISTINCT o.doc_no)::int AS docs,
               COUNT(DISTINCT ${L_NAME})::int AS names, COUNT(DISTINCT ${L_PRICE})::int AS prices,
               COALESCE(SUM(${L_QTY}),0)::float AS qty,
               COALESCE(SUM(${L_TOT}),0)::float AS ex_vat,
               COALESCE(SUM(${L_VAT}),0)::float AS vat
          ${LINE_FROM} ${lf.clause}
         GROUP BY 1
    )`;
}
const ITEM_SELECT = `
    SELECT c.code, t.name, c.names, c.prices, c.lines, c.docs, c.qty, c.ex_vat, c.vat
      FROM per_code c JOIN top t ON t.code = c.code`;

router.get('/items', jwtAuth, requireRole(...READ_ROLES), generalLimiter, async (req, res) => {
    try {
        const query = readQuery(req.query);
        const lf = lineFilter(query);
        const { limit, offset } = pageOf(req.query, 50);
        const key = pickSort(ITEM_SORTS, req.query, 'total');
        const dir = String(req.query.dir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
        const brand = await loadBrand();
        const cte = itemsCte(lf);

        const rowsQ = await pool.query(`${cte}${ITEM_SELECT}
             ORDER BY ${ITEM_SORTS[key]} ${dir}, c.code ASC
             LIMIT ${limit} OFFSET ${offset}
        `, lf.params);

        const totalsQ = await pool.query(`${cte}
            SELECT (SELECT COUNT(*)::int FROM per_code) AS codes,
                   COALESCE(SUM(lines),0)::int AS lines,
                   COALESCE(SUM(qty),0)::float AS qty,
                   COALESCE(SUM(ex_vat),0)::float AS ex_vat,
                   COALESCE(SUM(vat),0)::float AS vat,
                   (SELECT COUNT(DISTINCT o.doc_no)::int ${LINE_FROM} ${lf.clause}) AS docs
              FROM per_code
        `, lf.params);

        /* المطابقة مع سجل الفواتير: مجموعُ ما قبل الضريبة من الأسطر لا يساوي
           بالضرورة مجموعَ السندات — فسنداتٌ بلا سطورٍ مسجَّلة تحمل مبلغًا،
           وسنداتٌ أخرى مجموعُ أسطرها يخالف رأسَها. العددان يُحسبان هنا ولا
           يُخمَّن السبب. */
        let reconcile = null;
        if (!query.q) {
            const w = buildWhere(query);
            const oQ = await pool.query(`
                WITH x AS (
                    SELECT o.doc_no, o.total::float AS total, ${LINES_LEN} AS lines,
                           COALESCE(SUM(${L_TOT}),0)::float AS sum_tot
                      FROM ys_mirror_orders o
                      LEFT JOIN jsonb_array_elements(
                        CASE WHEN jsonb_typeof(o.lines) = 'array' THEN o.lines ELSE '[]'::jsonb END) AS l ON true
                     ${w.clause}
                     GROUP BY o.doc_no, o.total, ${LINES_LEN}
                )
                SELECT COUNT(*)::int AS docs,
                       COALESCE(SUM(total),0)::float AS order_ex_vat,
                       COALESCE(SUM(sum_tot),0)::float AS line_ex_vat,
                       COUNT(*) FILTER (WHERE lines = 0)::int AS no_lines,
                       COUNT(*) FILTER (WHERE lines > 0 AND ABS(sum_tot - total) > 0.005)::int AS line_mismatch
                  FROM x
            `, w.params);
            const o = oQ.rows[0] || {};
            const t = totalsQ.rows[0] || {};
            reconcile = {
                order_ex_vat: round2(o.order_ex_vat),
                items_ex_vat: round2(t.ex_vat),
                gap: round2((Number(t.ex_vat) || 0) - (Number(o.order_ex_vat) || 0)),
                order_docs: Number(o.docs) || 0,
                no_lines: Number(o.no_lines) || 0,
                line_mismatch: Number(o.line_mismatch) || 0,
            };
        }

        const t = totalsQ.rows[0] || {};
        const exVat = round2(t.ex_vat);
        res.json({
            ok: true, currency: brand.currency,
            from: lf.from, to: lf.to, cashier: lf.cashier, q: lf.q,
            rows: rowsQ.rows.map((r) => ({
                code: r.code, name: r.name,
                names: Number(r.names) || 0, prices: Number(r.prices) || 0,
                lines: Number(r.lines) || 0, docs: Number(r.docs) || 0,
                qty: round2(r.qty), ex_vat: round2(r.ex_vat), vat: round2(r.vat),
                avg_price: Number(r.qty) ? round2(Number(r.ex_vat) / Number(r.qty)) : 0,
                share: shareOf(r.ex_vat, exVat),
            })),
            totals: {
                count: Number(t.codes) || 0, codes: Number(t.codes) || 0,
                lines: Number(t.lines) || 0, docs: Number(t.docs) || 0,
                qty: round2(t.qty), ex_vat: exVat, vat: round2(t.vat),
            },
            reconcile,
            page: { limit, offset },
        });
    } catch (err) {
        logger.error({ err: err.message }, '[cashier-sales] items failed');
        res.status(500).json({ error: 'INTERNAL', message: err.message });
    }
});

/* ── ٤) ملف الصنف: كميّته وكل فواتيره ───────────────────────────────────── */
const CODE_RE = /^[\w -]{1,24}$/;

/** قارئٌ واحد يستعمله JSON والورقة المطبوعة معًا، فلا يختلف «ملف الصنف»
    على الشاشة عن الكشف الطبعي لنفس الصنف. */
async function loadItem(code, f, { limit, offset }) {
        /* القاعدة: كل سطرٍ بهذا الكود في النطاق — تُحدَّد الأسماء والأسعار
           المرصودة منه، فلا يُختار اسمٌ واحد ويُعرض كأنه الحقيقة.
           المعاملات أربعة ثابتة: الكود ثم من/إلى ثم الكاشير. */
        const p = [code, f.from || null, f.to || null, f.cashier || null];
        const itemWhere = `WHERE TRIM(COALESCE(l->>'code','')) = $1
              AND ($2::date IS NULL OR o.doc_date >= $2::date)
              AND ($3::date IS NULL OR o.doc_date <= $3::date)
              AND ($4::text IS NULL OR TRIM(o.cashier_no) = $4)`;
        const scope = (withCc = false) => `FROM ys_mirror_orders o
             ${LINE_UNNEST_BODY}
             ${withCc ? CC_JOIN : ''}
             ${itemWhere}`;

        const aggQ = await pool.query(`
            SELECT COUNT(*)::int AS lines, COUNT(DISTINCT o.doc_no)::int AS docs,
                   COALESCE(SUM(${L_QTY}),0)::float AS qty,
                   COALESCE(SUM(${L_TOT}),0)::float AS ex_vat,
                   COALESCE(SUM(${L_VAT}),0)::float AS vat,
                   COALESCE(${DAY('MIN(o.doc_date)')},'') AS first_day,
                   COALESCE(${DAY('MAX(o.doc_date)')},'') AS last_day
              ${scope()}
        `, p);

        const namesQ = await pool.query(`
            SELECT ${L_NAME} AS name, COUNT(*)::int AS lines,
                   COALESCE(SUM(${L_QTY}),0)::float AS qty
              ${scope()}
             GROUP BY 1 ORDER BY lines DESC LIMIT 8
        `, p);

        const pricesQ = await pool.query(`
            SELECT ${L_PRICE} AS price, COUNT(*)::int AS lines,
                   COALESCE(SUM(${L_QTY}),0)::float AS qty,
                   COALESCE(SUM(${L_TOT}),0)::float AS ex_vat
              ${scope()}
             GROUP BY 1 ORDER BY lines DESC LIMIT 12
        `, p);

        const seriesQ = await pool.query(`
            SELECT ${DAY('o.doc_date')} AS day, COUNT(DISTINCT o.doc_no)::int AS docs,
                   COALESCE(SUM(${L_QTY}),0)::float AS qty,
                   COALESCE(SUM(${L_TOT}),0)::float AS ex_vat
              ${scope()}
             GROUP BY 1 ORDER BY 1 ASC LIMIT 400
        `, p);

        const cashiersQ = await pool.query(`
            WITH ${CC_CTE}
            SELECT NULLIF(TRIM(o.cashier_no),'') AS no, ${CASHIER_NAME} AS name,
                   COUNT(DISTINCT o.doc_no)::int AS docs,
                   COALESCE(SUM(${L_QTY}),0)::float AS qty,
                   COALESCE(SUM(${L_TOT}),0)::float AS ex_vat
              ${scope(true)}
             GROUP BY 1, 2 ORDER BY qty DESC LIMIT 24
        `, p);

        const invoicesQ = await pool.query(`
            WITH ${CC_CTE}
            SELECT o.doc_no, ${DAY('o.doc_date')} AS day, o.doc_time,
                   NULLIF(TRIM(o.cashier_no),'') AS cashier_no, ${CASHIER_NAME} AS cashier_name,
                   ${L_NAME} AS line_name,
                   ${L_QTY}::float AS qty, ${L_PRICE}::float AS price,
                   ${L_TOT}::float AS line_ex_vat, ${L_VAT}::float AS line_vat,
                   o.net::float AS invoice_collected, o.total::float AS invoice_ex_vat,
                   ${LINES_LEN}::int AS invoice_items,
                   (SELECT COUNT(*)::int FROM jsonb_array_elements(
                       CASE WHEN jsonb_typeof(o.lines) = 'array' THEN o.lines ELSE '[]'::jsonb END) s
                     WHERE TRIM(COALESCE(s->>'code','')) = $1) AS times_in_invoice
              ${scope(true)}
             ORDER BY o.doc_date DESC, o.doc_time::time DESC, o.doc_no DESC
             LIMIT ${limit} OFFSET ${offset}
        `, p);

        const a = aggQ.rows[0] || {};
        const exVat = round2(a.ex_vat);
        return {
            from: f.from, to: f.to, cashier: f.cashier,
            agg: {
                lines: Number(a.lines) || 0, docs: Number(a.docs) || 0,
                qty: round2(a.qty), ex_vat: exVat, vat: round2(a.vat),
                avg_price: Number(a.qty) ? round2(exVat / Number(a.qty)) : 0,
                per_invoice: Number(a.docs) ? round2(Number(a.qty) / Number(a.docs)) : 0,
                first_day: String(a.first_day || '').slice(0, 10),
                last_day: String(a.last_day || '').slice(0, 10),
            },
            names: namesQ.rows.map((r) => ({ name: r.name, lines: Number(r.lines) || 0, qty: round2(r.qty) })),
            prices: pricesQ.rows.map((r) => ({
                price: round2(r.price), lines: Number(r.lines) || 0,
                qty: round2(r.qty), ex_vat: round2(r.ex_vat),
                share: shareOf(r.ex_vat, exVat),
            })),
            series: seriesQ.rows.map((r) => ({ ...r, qty: round2(r.qty), ex_vat: round2(r.ex_vat) })),
            cashiers: cashiersQ.rows.map((r) => ({
                no: r.no, name: r.name, docs: Number(r.docs) || 0,
                qty: round2(r.qty), ex_vat: round2(r.ex_vat), share: shareOf(r.qty, Number(a.qty)),
            })),
            invoices: invoicesQ.rows.map((r) => ({
                doc_no: r.doc_no, day: r.day, time: hhmm(r.doc_time),
                cashier_no: r.cashier_no, cashier_name: r.cashier_name, line_name: r.line_name,
                qty: round2(r.qty), price: round2(r.price),
                line_ex_vat: round2(r.line_ex_vat), line_vat: round2(r.line_vat),
                invoice_collected: round2(r.invoice_collected), invoice_ex_vat: round2(r.invoice_ex_vat),
                invoice_items: Number(r.invoice_items) || 0, times_in_invoice: Number(r.times_in_invoice) || 0,
            })),
            totals: { count: Number(a.docs) || 0 },
            page: { limit, offset },
        };
}

router.get('/item/:code', jwtAuth, requireRole(...READ_ROLES), generalLimiter, async (req, res) => {
    try {
        const code = String(req.params.code || '').trim().slice(0, 24);
        if (!CODE_RE.test(code)) {
            return res.status(422).json({ error: 'INVALID_CODE', message: 'كود الصنف غير صالح' });
        }
        const brand = await loadBrand();
        const d = await loadItem(code, readQuery(req.query), pageOf(req.query, 50));
        res.json({ ok: true, currency: brand.currency, code, ...d });
    } catch (err) {
        logger.error({ err: err.message }, '[cashier-sales] item failed');
        res.status(500).json({ error: 'INTERNAL', message: err.message });
    }
});

/* ── الطوابع المشتركة للورقتين ──────────────────────────────────────────── */
/* خطُّ الطباعة نفسه خطُّ الواجهة: الملفاتُ في المستودع تُحمَّل من /app،
   والورقةُ المفردة لا ترث شيئًا من التطبيق — بلا هذه القاعدة ترجع كلُّ
   كشوفٍ إلى Tahoma فتختلف عن الشاشة وتبدو غير مقروءة في خانات الجدول. */
const PRINT_FACES = ['400', '500', '600', '700']
    .flatMap((w) => ['arabic', 'latin'].map((sub) => {
        const range = sub === 'arabic'
            ? 'U+0600-06FF,U+0750-077F,U+FB50-FDFF,U+FE70-FEFF'
            : 'U+0000-00FF,U+0131,U+0152-0153,U+2018-201F,U+2022,U+2039-203A';
        return `@font-face{font-family:'IBM Plex Sans Arabic';font-style:normal;font-weight:${w};`
            + `font-display:swap;src:url(/app/fonts/v2/ibmplexsansarabic-normal-${w}-${sub}.woff2) format('woff2');`
            + `unicode-range:${range};}`;
    }))
    .join('\n  ');

function sheetStyles() {
    return `
  @page { size: A4; margin: 12mm 11mm 14mm; }
  * { margin:0; padding:0; box-sizing:border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  ${PRINT_FACES}
  body {
    font-family: "IBM Plex Sans Arabic", Tahoma, Arial, sans-serif;
    font-size: 12.5px; color:#17231f; background:#eef1f6; direction:rtl;
    padding:28px 20px; line-height:1.5;
  }
  .ltr { direction:ltr; unicode-bidi:isolate; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .sheet { max-width:200mm; margin:0 auto; background:#fff; border:1px solid #dfe3ea;
           border-radius:14px; box-shadow:0 14px 40px rgba(15,23,42,.10); overflow:hidden; }
  /* ترويسةٌ فاتحة: الحبرُ الكثيف يبتلع طابعةَ المكتب ويُسوّدّ الأسطر،
     فالعلامة تُحمل بلونٍ داكنٍ على ورقٍ أبيض وحدٍّ ذهبيّ رفيع. */
  .brand { display:flex; align-items:center; gap:14px; padding:14px 22px 12px;
           background:#fff; border-bottom:2px solid #c9a227; }
  .brand img { width:56px; height:56px; object-fit:contain; }
  .brand__t { flex:1; min-width:0; }
  .brand__t h1 { font-size:18px; color:#12352a; font-weight:700; letter-spacing:.2px; }
  .brand__t p { font-size:11px; color:#6b7280; margin-top:3px; overflow-wrap:anywhere; }
  .brand__id { text-align:center; }
  .brand__id .no { display:inline-block; background:#fffaf0; border:1px solid #d9c48a;
                   border-radius:999px; padding:4px 14px; font-size:12.5px; font-weight:700; color:#7a5c14; }
  .doc { text-align:center; padding:16px 22px 4px; }
  .doc h2 { font-size:19px; color:#12352a; letter-spacing:.4px; }
  .doc .sub { font-size:11.5px; color:#64748b; margin-top:3px; }
  .body { padding:6px 22px 22px; }
  .grid { display:grid; grid-template-columns:repeat(4,1fr); gap:0; border:1px solid #e5e7eb;
          border-radius:10px; overflow:hidden; margin-top:12px; }
  .cell { padding:9px 12px; border-inline-start:1px solid #eef1f5; border-top:1px solid #eef1f5; }
  .cell:nth-child(4n+1) { border-inline-start:0; }
  .cell:nth-child(-n+4) { border-top:0; }
  .cell b { display:block; font-size:10.5px; color:#8a6d1b; font-weight:700; }
  .cell span { display:block; margin-top:2px; font-size:12.5px; color:#12352a; font-weight:600;
               overflow-wrap:anywhere; font-variant-numeric:tabular-nums; }
  h3.sec { font-size:12.5px; color:#12352a; margin:18px 0 6px; padding-inline-start:9px;
           border-inline-start:4px solid #c9a227; }
  table.t { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
  table.t th, table.t td { padding:5.5px 7px; font-size:11px; border-bottom:1px solid #edf0f4; text-align:right; }
  table.t th { background:#f3f5f3; color:#12352a; font-weight:700; font-size:10.5px;
               border-bottom:1.5px solid #c9a227; text-align:center; white-space:nowrap; }
  table.t td.c, table.t th.c { text-align:center; }
  table.t td.n { text-align:left; direction:ltr; unicode-bidi:isolate; white-space:nowrap; }
  table.t tbody tr:nth-child(even) td { background:#f8fafc; }
  table.t tbody tr { break-inside:avoid; page-break-inside:avoid; }
  table.t tfoot td { background:#eef2f7; font-weight:800; color:#12352a; border-top:2px solid #c9a227;
                     border-bottom:0; font-size:11.5px; }
  .idx { color:#94a3b8; font-size:10.5px; }
  .pill { display:inline-block; padding:1px 7px; border-radius:999px; font-size:10px; font-weight:700;
          border:1px solid #dbe1ea; background:#f2f4f7; color:#475467; white-space:nowrap; }
  .pill--pay { border-color:#0b9e6c; background:rgba(11,158,108,.10); color:#055f3a; }
  .pill--due { border-color:#d97706; background:rgba(217,119,6,.10); color:#b54708; }
  .bars { width:100%; height:7px; border-radius:999px; background:#eef2f7; overflow:hidden; }
  .bars i { display:block; height:100%; background:linear-gradient(90deg,#c9a227,#12352a); }
  .note { margin-top:12px; border:1px solid #e5e7eb; border-inline-start:4px solid #c9a227;
          border-radius:10px; padding:9px 13px; background:#fffdf5; font-size:11px; color:#3f3a26; }
  .foot { margin-top:18px; border-top:1px solid #e5e7eb; padding-top:8px; display:flex;
          justify-content:space-between; gap:10px; font-size:10px; color:#94a3b8; }
  @media print {
    body { background:#fff; padding:0; }
    .sheet { border:0; border-radius:0; box-shadow:none; max-width:none; overflow:visible; }
    .body { padding:6px 0 0; }
    table.t thead { display:table-header-group; }
    /* الترويسة والمؤشرات لا تُبتر: صفحةٌ تبدأ بمنتصف شعارٍ أو بصفِّ مؤشراتٍ
       مبتور تُفقد الورقتَ قيمتَها أمام المحاسب. */
    .brand, .doc, .grid, .note, h3.sec { break-inside:avoid; page-break-inside:avoid; }
    .grid { break-after:avoid; page-break-after:avoid; }
    h3.sec { break-after:avoid; page-break-after:avoid; }
    table.t th { background:#f3f5f3 !important; }
    table.t tbody tr:nth-child(even) td { background:#f8fafc !important; }
  }`;
}

/* إيصالُ الكاشير: 80مم حراريّ. الطابعةُ الحرارية لا تُخرِج تدرّجًا ولا
   رماديًّا فاتحًا، فالطبقةُ أسودُ على أبيض بخطٍّ نظاميٍّ واضح (Tahoma)
   وأرقامٌ معزولةٌ ثنائيًّا لا تلتصق بكلمة العملة. */
const receiptStyles = () => `
  @page { size: 80mm auto; margin: 3mm 4mm 4mm; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Tahoma, "Segoe UI", Arial, sans-serif; font-size:11.5px;
         color:#000; background:#f2f4f7; direction:rtl; padding:12px 6px; line-height:1.45; }
  .ltr { direction:ltr; unicode-bidi:isolate; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .rcpt { width:100%; max-width:72mm; margin:0 auto; background:#fff; padding:4mm 3.5mm 3mm;
          box-shadow:0 6px 22px rgba(15,23,42,.12); }
  .hd { text-align:center; }
  .hd img { width:17mm; height:17mm; object-fit:contain; }
  .hd h1 { font-size:15px; font-weight:800; margin-top:1.5mm; letter-spacing:.2px; }
  .hd .sub { font-size:9.5px; margin-top:.8mm; }
  .meta { margin-top:2mm; font-size:10.5px; }
  .meta div { display:flex; justify-content:space-between; gap:3mm; padding:.3mm 0; }
  .meta .k { color:#333; }
  .rule { border-top:1px dashed #000; margin:2.2mm 0; }
  table.it { width:100%; border-collapse:collapse; font-size:11px; }
  table.it th { font-size:9px; text-align:right; border-bottom:1px solid #000; padding:0 0 .8mm; }
  table.it th.q, table.it th.v { text-align:left; white-space:nowrap; }
  table.it td { padding:.9mm 0; vertical-align:top; }
  table.it td.nm { text-align:right; padding-inline-end:1.5mm; }
  table.it td.nm small { display:block; font-size:8.5px; }
  table.it td.q, table.it td.v { text-align:left; direction:ltr; unicode-bidi:isolate;
                                 white-space:nowrap; font-variant-numeric:tabular-nums; }
  table.it td.v { font-weight:700; }
  table.tot { width:100%; border-collapse:collapse; margin-top:1mm; }
  table.tot td { padding:.7mm 0; font-size:11.5px; }
  table.tot td.l { color:#222; }
  table.tot td.v { text-align:left; direction:ltr; unicode-bidi:isolate; white-space:nowrap;
                   font-variant-numeric:tabular-nums; }
  table.tot tr.big td { border-top:1.2px solid #000; border-bottom:1.2px solid #000;
                        border-collapse:0; padding:1.4mm 0; font-size:14px; font-weight:800; }
  .pay { margin-top:1.5mm; font-size:10.5px; text-align:center; }
  .fine { margin-top:1.8mm; font-size:8.5px; line-height:1.45; }
  .qr { text-align:center; margin-top:2.5mm; }
  .qr img { width:27mm; height:27mm; }
  .qr p { font-size:8.5px; margin-top:.6mm; }
  .foot { margin-top:2.5mm; border-top:1px dashed #000; padding-top:1.6mm; text-align:center; font-size:9.5px; }
  .foot .thanks { font-size:11.5px; font-weight:800; }
  .foot .who { font-size:8.5px; margin-top:.8mm; }
  @media print { body { background:#fff; padding:0; } .rcpt { box-shadow:none; padding:0; max-width:none; } }`;

function head(brand, { title, subtitle, docNo }) {
    const logo = brand.logo || '/app/assets/al-shurfa-logo.png';
    return `<header class="brand" data-v2-print-brand>
      <img src="${esc(logo)}" alt="شعار ${esc(brand.name)}">
      <div class="brand__t"><h1>${esc(brand.name)}</h1><p>${subtitle}</p></div>
      <div class="brand__id"><span class="no">${esc(docNo)}</span></div>
    </header>
    <div class="doc"><h2>${esc(title)}</h2></div>`;
}

const footLine = (brand, extra, mirrorAt) => `<div class="foot">
    <span>${esc(brand.name)} — ${esc(extra)}</span>
    <span>طُبع ${ltr(stamp(new Date()))}${mirrorAt ? ` · المرآة حتى ${ltr(mirrorAt)}` : ''} · Karim ERP</span>
  </div>`;

/** نصُّ الانضباط الذي يُطبع أسفل كل كشف: كم سندًا بلا سطور، وكم سندًا
    يخرج فيه الإجمالي عن (صافٍ + ضريبة) ولماذا — الحقيقة لا تُخفى بتقريبٍ في الواجهة. */
async function honestyNote(f) {
    const w = buildWhere(f);
    const r = await pool.query(`
        SELECT COUNT(*)::int AS docs,
               COUNT(*) FILTER (WHERE ${LINES_LEN} = 0)::int AS no_lines,
               COUNT(*) FILTER (WHERE ABS(o.net - (o.total + o.vat)) > 0.005)::int AS drift_docs,
               ROUND(COALESCE(SUM(o.net - (o.total + o.vat)),0)::numeric,2)::float AS drift_amount,
               COUNT(*) FILTER (WHERE ABS(o.net - (o.total + o.vat)) > 0.01 * ${LINES_LEN} + 0.005)::int AS drift_large_docs,
               ROUND(COALESCE(SUM(o.net - (o.total + o.vat)) FILTER (WHERE ABS(o.net - (o.total + o.vat)) > 0.01 * ${LINES_LEN} + 0.005),0)::numeric,2)::float AS drift_large_amount,
               ${DAY('MIN(o.doc_date)')} AS first_day, ${DAY('MAX(o.doc_date)')} AS last_day,
               MAX(synced_at) AS synced_at
          FROM ys_mirror_orders o ${w.clause}`, w.params);
    const t = r.rows[0] || {};
    const parts = [];
    if (Number(t.no_lines) > 0) {
        parts.push(`${ltr(t.no_lines)} سندًا بلا سطور أصناف في هذه الفترة (مبلغه محسوبٌ في المجاميع وأصنافه غير مسجَّلة في المرآة)`);
    }
    if (Number(t.drift_docs) > 0) {
        /* قدرُ التقريب من عدد السطور؛ ما جاوزَه فارقُ سعرٍ في الكاشيرية،
           فلا يُنسَب إلى التقريبِ ما كبر عليه. */
        const large = Number(t.drift_large_docs) || 0;
        parts.push(`${ltr(t.drift_docs)} سندًا يختلف فيه «الإجمالي» عن «صافٍ + ضريبة» بمجموع ${ltr(num(t.drift_amount))} — `
            + (large
                ? `منها ${ltr(large)} بمقدار ${ltr(num(t.drift_large_amount))} جاوزَ قدرَ تقريبِ السطور — المحصَّلُ لا يطابق المُسعَّر، والمرآةُ لا تسجّل سببَ الفرق`
                : 'تسعيرة قاعدة الكاشير تُقرَّب لكل سطرٍ قبل الجمع، والفارق كلُّه في قدر ذلك التقريب'));
    }
    const mirror = `المرآة تبدأ من ${ltr(t.first_day || '—')}؛ آخر مزامنة ${ltr(stamp(t.synced_at))}`;
    return {
        text: parts.length ? `<b>الانضباط:</b> ${parts.join('؛ ')} — ${mirror}.` : mirror + '.',
        first_day: t.first_day, last_day: t.last_day,
        no_lines: Number(t.no_lines) || 0, drift_docs: Number(t.drift_docs) || 0,
        drift_large_docs: Number(t.drift_large_docs) || 0,
        synced_at: stamp(t.synced_at),
    };
}

/* قارئ السند الواحد: الشاشة المطبوعة والشاشة المعروضة يقرآن نفس الصفّ من
   نفس الاستعلام، فلا يختلف «ما على الورق» عن «ما في اللوحة». */
async function loadSlip(docNo) {
    const r = await pool.query(`
        WITH ${CC_CTE}
        SELECT o.doc_no, ${DAY('o.doc_date')} AS day, o.doc_time,
               NULLIF(TRIM(o.cashier_no),'') AS cashier_no, ${CASHIER_NAME} AS cashier_name,
               o.net::float AS collected, o.total::float AS ex_vat, o.vat::float AS vat,
               o.discount::float AS discount, o.payed::float AS payed,
               o.pay_cash::float AS cash, o.pay_network::float AS network,
               o.pay_credit::float AS credit, o.pay_mobile::float AS mobile,
               ${LINES_LEN}::int AS items, o.lines
          FROM ys_mirror_orders o ${CC_JOIN}
         WHERE o.doc_no = $1
         ORDER BY o.doc_date DESC LIMIT 1
    `, [docNo]);
    return r.rows[0] || null;
}

async function loadZatca(docNo) {
    const r = await pool.query(`
        SELECT inv_no, pih, isvalid, issuedate, issuetime, payableamount, taxcategory_percent
          FROM ora_e_invoices WHERE doc_no = $1 LIMIT 1
    `, [docNo]);
    const row = r.rows[0] || null;
    /* العمودُ نصٌّ («True»/«False») لا منطقِيّ: «False» صحيحٌ في JS، فلو مرَّ
       كما هو لُطبع على الإيصال «مُعتمدة» لكلِّ سندٍ مرفوض. */
    if (row) {row.isvalid = /^(true|1|y|t)$/i.test(String(row.isvalid || '').trim());}
    return row;
}

/* تغطيةُ الاعتماد الزكوي: جدولُ ora_e_invoices يملؤه مسارُ اعتمادٍ منفصل،
   فإما توقفَ أو قُطفَ بقيت سندٌ بلا شارة. اللوحةُ تقول ذلك بدل صمتِ الشارة:
   كم سندًا في الفترة له اعتماد، وإلى أيِّ يومٍ وصل الجدول. */
async function loadZatcaCoverage(f) {
    try {
        const r = await pool.query(`
            SELECT COUNT(*)::int AS matched,
                   (SELECT COUNT(*)::int FROM ora_e_invoices) AS rows_total,
                   (SELECT MAX(issuedate) FROM ora_e_invoices) AS last_issued,
                   (SELECT MIN(doc_no) FROM ora_e_invoices) AS feed_first,
                   (SELECT MAX(doc_no) FROM ora_e_invoices) AS feed_last,
                   (SELECT MIN(o.doc_no) FROM ys_mirror_orders o ${f.clause}) AS win_first,
                   (SELECT MAX(o.doc_no) FROM ys_mirror_orders o ${f.clause}) AS win_last
              FROM ys_mirror_orders o ${f.clause}
             ${f.clause ? 'AND' : 'WHERE'} EXISTS (SELECT 1 FROM ora_e_invoices e
                                                    WHERE e.doc_no = o.doc_no::text)
        `, f.params);
        const t = r.rows[0] || {};
        return {
            matched: Number(t.matched) || 0,
            rows_total: Number(t.rows_total) || 0,
            last_issued: String(t.last_issued || ''),
            feed_first: String(t.feed_first || ''),
            feed_last: String(t.feed_last || ''),
            win_first: String(t.win_first || ''),
            win_last: String(t.win_last || ''),
        };
    } catch (err) {
        // الجدولُ قد لا يكون مُهيَّأً: التغطيةُ تُذكر غائبةً، والفشلُ لا يُدارى
        logger.warn({ err: err.message }, '[cashier-sales] ZATCA coverage unavailable');
        return null;
    }
}

const docNoRe = /^[\w-]{1,24}$/;

/* ── ٥أ) الفاتورة على الشاشة: سطورها ودفعها واعتمادها ───────────────────── */
router.get('/invoice/:docNo', jwtAuth, requireRole(...READ_ROLES), generalLimiter, async (req, res) => {
    try {
        const docNo = String(req.params.docNo || '').trim().slice(0, 24);
        if (!docNoRe.test(docNo)) {
            return res.status(422).json({ error: 'INVALID_DOC_NO', message: 'رقم السند غير صالح' });
        }
        const brand = await loadBrand();
        const slip = await loadSlip(docNo);
        if (!slip) {return res.status(404).json({ error: 'NOT_FOUND', message: 'السند غير موجود في مرآة الكاشير' });}
        const zatca = await loadZatca(docNo);
        const raw = Array.isArray(slip.lines) ? slip.lines : [];
        const lines = raw.map((it, i) => ({
            no: i + 1,
            name: String((it && it.name) || '').trim() || 'بلا اسم',
            code: String((it && it.code) || '').trim(),
            qty: round2(it && it.qty), price: round2(it && it.price),
            total: round2(it && it.total), vat: round2(it && it.vat),
            vat_rate: it && it.vat_rate != null ? Number(it.vat_rate) : null,
            discount: round2(it && it.discount),
            unit: String((it && it.unit) || '').trim(),
            saler: String((it && it.saler) || '').trim(),
        }));
        const payed = round2(slip.payed);
        res.json({
            ok: true, currency: brand.currency, brand: brand.name,
            slip: {
                doc_no: slip.doc_no, day: slip.day, time: hhmm(slip.doc_time),
                cashier_no: slip.cashier_no, cashier_name: slip.cashier_name,
                items: Number(slip.items) || 0,
                collected: round2(slip.collected), ex_vat: round2(slip.ex_vat),
                vat: round2(slip.vat), discount: round2(slip.discount), payed,
                /* ما بقي على العميل بعد الدفع المسجَّل — صفرٌ في الغالب،
                   وغيرُ الصفر يُعرض ولا يُدارى. */
                due: round2(round2(slip.collected) - payed),
                payments: [
                    { key: 'cash', label: 'نقد', amount: round2(slip.cash) },
                    { key: 'network', label: 'شبكة', amount: round2(slip.network) },
                    { key: 'mobile', label: 'جوال', amount: round2(slip.mobile) },
                    { key: 'credit', label: 'آجل', amount: round2(slip.credit) },
                ],
                /* الفارق بين «الإجمالي» و«صافٍ + ضريبة»: تقريبُ تسعيرةٍ لكل
                   سطرٍ فقط ما دام في قدره، وما جاوزَه فارقُ سعرٍ يُقال كذلك —
                   لا يُنسَب إلى التقريب ما كبر عليه. */
                drift: round2(round2(slip.collected) - (round2(slip.ex_vat) + round2(slip.vat))),
                drift_within_rounding: Math.abs(round2(slip.collected) - (round2(slip.ex_vat) + round2(slip.vat)))
                    <= 0.01 * lines.length + 0.005,
                line_sum: round2(lines.reduce((s, l) => s + l.total, 0)),
            },
            lines,
            zatca: zatca && {
                inv_no: zatca.inv_no, pih: String(zatca.pih || '').slice(0, 64),
                isvalid: zatca.isvalid, issuedate: zatca.issuedate, issuetime: zatca.issuetime,
                payableamount: round2(zatca.payableamount),
                taxcategory_percent: zatca.taxcategory_percent,
            },
        });
    } catch (err) {
        logger.error({ err: err.message }, '[cashier-sales] invoice failed');
        res.status(500).json({ error: 'INTERNAL', message: err.message });
    }
});

/* ── ٥ب) الفاتورة مطبوعة (إيصال 80مم) ───────────────────────────────────── */
router.get('/invoice/:docNo/html', jwtAuth, requireRole(...READ_ROLES), generalLimiter, async (req, res) => {
    try {
        const docNo = String(req.params.docNo || '').trim().slice(0, 24);
        if (!docNoRe.test(docNo)) {return res.status(422).send('رقم السند غير صالح');}
        const brand = await loadBrand();
        const slip = await loadSlip(docNo);
        if (!slip) {return res.status(404).send('السند غير موجود في مرآة الكاشير');}
        let zatca = null;
        try {
            const z = await pool.query(`
                SELECT qrcode, pih, isvalid FROM ora_e_invoices WHERE doc_no = $1 LIMIT 1
            `, [docNo]);
            zatca = z.rows[0] || null;
        } catch (err) {
            /* جدول الاعتماد قد لا يكون مُهيَّأ — الإيصال يُطبع بدونه، ولا
               يُدارى الفشل: يُسجَّل ولا يُترك صامتًا. */
            logger.warn({ err: err.message }, '[cashier-sales] ZATCA row unavailable');
        }
        let qrImage = null;
        if (zatca && zatca.qrcode) {
            try {
                qrImage = await QRCode.toDataURL(String(zatca.qrcode), { errorCorrectionLevel: 'M', margin: 1, width: 220 });
            } catch (e) {
                logger.warn({ err: e.message }, '[cashier-sales] QR render failed');
            }
        }

        /* سطرُ الصنف جدولٌ لا أعمدةٌ عائمة: العمودُ الأوسط «كمية × سعر»
           والأخير الإجمالي، فتصطفُّ الأرقامُ عبر الإيصال كلّه بدل أن
           يتقافز كلُّ سطرٍ حيث انتهى اسمُه. */
        const items = (Array.isArray(slip.lines) ? slip.lines : []).map((it) => {
            const nm = String((it && it.name) || '').trim() || 'بلا اسم';
            const cd = String((it && it.code) || '').trim();
            const qty = Number(it && it.qty) || 0;
            const price = Number(it && it.price) || 0;
            const tot = Number(it && it.total) || 0;
            return `<tr>
              <td class="nm">${esc(nm)}${cd ? `<small>#${esc(cd)}</small>` : ''}</td>
              <td class="q">${esc(num(qty))} × ${esc(num(price))}</td>
              <td class="v">${esc(num(tot))}</td>
            </tr>`;
        }).join('');
        const methods = [['نقد', slip.cash], ['شبكة', slip.network], ['جوال', slip.mobile], ['آجل', slip.credit]]
            .filter(([, v]) => Number(v || 0) > 0);
        const drift = round2((slip.collected || 0) - ((slip.ex_vat || 0) + (slip.vat || 0)));
        const lineCount = Array.isArray(slip.lines) ? slip.lines.length : 0;
        const rate = (Array.isArray(slip.lines) && slip.lines[0] && slip.lines[0].vat_rate != null) ? slip.lines[0].vat_rate : 15;

        /* الإيصالُ نسخةُ عميل: لا يُثقل بأسطرِ انضباطٍ تُقرأ على كل فاتورة.
           فارقُ التقريب (هللةٌ أو هللتان لكل سطرٍ) طبعٌ لا قيمة له للشاري
           وأما ما جاوزَ قدرَ التقريب فخطرٌ محاسبيٌّ يُطبع سطرًا واحدًا. */
        const driftLarge = Math.abs(drift) > 0.01 * lineCount + 0.005;
        const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>فاتورة ${esc(slip.doc_no)}</title><style>${receiptStyles()}</style></head><body>
<main class="rcpt">
  <header class="hd" data-v2-print-brand>
    <img src="${esc(brand.logo || '/app/assets/al-shurfa-logo.png')}" alt="شعار ${esc(brand.name)}">
    <h1>${esc(brand.name)}</h1>
    <p class="sub">فاتورة ضريبية مبسّطة · مبيعات الكاشير</p>
  </header>
  <div class="meta">
    <div><span class="k">رقم السند</span><span class="ltr">${esc(slip.doc_no)}</span></div>
    <div><span class="k">التاريخ</span><span class="ltr">${esc(slip.day || '—')} · ${esc(hhmm(slip.doc_time))}</span></div>
    <div><span class="k">الكاشير</span><span>${esc(slip.cashier_name || 'غير مُسند')}</span></div>
    <div><span class="k">عدد الأصناف</span><span class="ltr">${esc(String(slip.items))}</span></div>
  </div>
  <div class="rule"></div>
  ${items ? `<table class="it"><thead><tr><th>الصنف</th><th class="q">كمية × سعر</th><th class="v">الإجمالي</th></tr></thead><tbody>${items}</tbody></table>`
    : '<p class="fine">لا سطور أصناف مسجَّلة لهذا السند في المرآة — المبلغ أدناه كما دُفع فعلًا.</p>'}
  <div class="rule"></div>
  <table class="tot">
    <tr><td class="l">الإجمالي قبل الضريبة</td><td class="v">${esc(num(slip.ex_vat))}</td></tr>
    <tr><td class="l">ضريبة القيمة المضافة (${esc(String(rate))}%)</td><td class="v">${esc(num(slip.vat))}</td></tr>
    ${Number(slip.discount || 0) > 0 ? `<tr><td class="l">الخصم</td><td class="v">${esc(num(slip.discount))}</td></tr>` : ''}
    ${Math.abs(drift) > 0.005 ? `<tr><td class="l">تسوية (فرق المحصَّل عن صافٍ + ضريبة)</td><td class="v">${esc(num(drift))}</td></tr>` : ''}
    <tr class="big"><td class="l">الإجمالي شامل الضريبة</td><td class="v">${esc(num(slip.collected))} ${esc(brand.currency)}</td></tr>
  </table>
  ${methods.length ? `<p class="pay">الدفع: ${methods.map(([m, v]) => `${esc(m)} <span class="ltr">${esc(num(v))}</span>`).join(' · ')}</p>` : ''}
  ${Math.abs(drift) > 0.005 && driftLarge ? `<p class="fine">ملاحظة محاسبية: الإجمالي المحصَّل لا يطابق «صافي + ضريبة» بمقدار <span class="ltr">${esc(num(drift))}</span>، وهو جاوزَ قدرَ تقريبِ التسعيرة — يُراجع مع سجلّ الكاشير.</p>` : ''}
  ${qrImage ? `<div class="qr"><img src="${esc(qrImage)}" alt="رمز الفاتورة"><p>${zatca && zatca.isvalid === true ? 'فاتورة مُعتمدة لدى الهيئة' : 'غير مُعتمدة لدى الهيئة'}${zatca && zatca.pih ? ` · بصمة <span class="ltr">${esc(String(zatca.pih).slice(0, 16))}</span>` : ''}</p></div>` : ''}
  <footer class="foot">
    <p class="thanks">شكرًا لزيارتكم</p>
    <p class="who">${esc(brand.name)} · نسخة العميل</p>
    <p class="who">طُبع <span class="ltr">${esc(stamp(new Date()))}</span> — Karim ERP</p>
  </footer>
</main>
</body></html>`;
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err) {
        logger.error({ err: err.message }, '[cashier-sales] invoice html failed');
        res.status(500).json({ error: 'INTERNAL', message: err.message });
    }
});

/* ── ٦) الكشف مطبوعًا: أوراق / أصناف / صنفٌ واحد ────────────────────────── */
router.get('/html', jwtAuth, requireRole(...READ_ROLES), generalLimiter, async (req, res) => {
    try {
    const raw = String(req.query.view || '');
    const view = raw === 'items' || raw === 'item' || raw === 'items-detail' ? raw : 'orders';
        const brand = await loadBrand();
        const f = readQuery(req.query);
        const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 1000);
        /* period وscope وsearch تُصبُّ HTMLًا جاهزًا للطباعة: التاريحان
           ينعزلان ثنائيًّا فيُقرآن «من الأول إلى الأخير» لا معكوسين. */
        const period = (f.from || f.to)
            ? `من ${f.from ? ltr(f.from) : 'البداية'} إلى ${f.to ? ltr(f.to) : 'اليوم'}`
            : 'كل الفترة المتوفرة في المرآة';
        const note = await honestyNote(f);
        const title = view === 'items' ? 'كشف الأصناف المباعة'
            : view === 'item' ? 'ملف صنفٍ واحد'
            : view === 'items-detail' ? 'تقرير مفصل بأصناف مختارة' : 'كشف فواتير الكاشير';
        const scope = f.cashier ? ` · ${esc(f.cashier)}` : '';
        const search = f.q ? ` · بحث: ${esc(f.q)}` : '';

        let cells = '';
        let table = '';
        let docNo = '';

        if (view === 'item') {
            const code = String(req.query.code || '').trim().slice(0, 24);
            if (!CODE_RE.test(code)) {return res.status(422).send('كود الصنف غير صالح');}
            const d = await loadItem(code, f, { limit, offset: 0 });
            docNo = `الكود ${code}`;
            cells = [
                ['الصنف', esc(d.names[0] ? d.names[0].name : '—')],
                ['الكمية المباعة', ltr(num(d.agg.qty, 2))],
                ['عدد الفواتير', ltr(d.agg.docs)],
                ['صافي قبل الضريبة', moneyLtr(d.agg.ex_vat, brand.currency)],
                ['متوسط سعر الوحدة', ltr(num(d.agg.avg_price))],
                ['سطور البيع', ltr(d.agg.lines)],
                ['أول يوم', ltr(d.agg.first_day || '—')],
                ['آخر يوم', ltr(d.agg.last_day || '—')],
            ].map(([k, v]) => cell(k, v)).join('');
            const altNames = d.names.length > 1
                ? `<div class="note"><b>أسماء مرصودة لهذا الكود:</b> ${d.names.map((n) => `${esc(n.name)} (${ltr(n.lines)} سطرًا)`).join('، ')} — الكودُ واحدٌ والاسمُ في مصدر الكاشير ليس واحدًا دائمًا.</div>` : '';
            const prices = d.prices.length > 1
                ? `<div class="note"><b>أسعار مرصودة:</b> ${d.prices.map((p) => `${ltr(num(p.price))} (${ltr(p.lines)} سطرًا)`).join('، ')} ${esc(brand.currency)} قبل الضريبة.</div>` : '';
            const rows = d.invoices.map((r, i) => `<tr>
                <td class="c idx">${i + 1}</td>
                <td class="c n">${esc(r.day)}</td>
                <td class="c n">${esc(r.time)}</td>
                <td class="c n">${esc(r.doc_no)}</td>
                <td>${esc(r.cashier_name)}</td>
                <td class="c n">${esc(num(r.qty, 2))}</td>
                <td class="c n">${esc(num(r.price))}</td>
                <td class="c n"><b>${esc(num(r.line_ex_vat))}</b></td>
                <td class="c n">${esc(num(r.invoice_collected))}</td>
                <td class="c">${r.times_in_invoice > 1 ? `<span class="pill">${r.times_in_invoice} مرات</span>` : '—'}</td>
              </tr>`).join('');
            table = `<h3 class="sec">الفواتير التي ورد فيها الصنف${d.invoices.length < d.agg.docs ? ` (أول ${limit} من ${d.agg.docs})` : ''}</h3>
              <table class="t"><thead><tr><th style="width:4%">#</th><th style="width:9%">التاريخ</th>
                <th style="width:7%">الوقت</th><th style="width:11%">السند</th><th>الكاشير</th>
                <th style="width:8%">الكمية</th><th style="width:9%">سعر الوحدة</th>
                <th style="width:11%">صافي السطر</th><th style="width:11%">إجمالي الفاتورة</th>
                <th style="width:8%">تكرار</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="10" class="c">لا فواتير في هذه الفترة</td></tr>'}</tbody>
              <tfoot><tr><td colspan="5">إجمالي المعروض</td><td class="n">${esc(num(d.invoices.reduce((s, r) => s + r.qty, 0), 2))}</td>
                <td></td><td class="n">${esc(num(d.invoices.reduce((s, r) => s + r.line_ex_vat, 0)))}</td><td colspan="2"></td></tr></tfoot>
              </table>${altNames}${prices}`;
        } else if (view === 'items') {
            const lf = lineFilter(f);
            const rowsQ = await pool.query(`${itemsCte(lf)}${ITEM_SELECT}
                 ORDER BY c.ex_vat DESC, c.qty DESC LIMIT ${limit}`, lf.params);
            const t = (await pool.query(`${itemsCte(lf)}
                SELECT (SELECT COUNT(*)::int FROM per_code) AS codes,
                       COALESCE(SUM(lines),0)::int AS lines, COALESCE(SUM(qty),0)::float AS qty,
                       COALESCE(SUM(ex_vat),0)::float AS ex_vat, COALESCE(SUM(vat),0)::float AS vat
                  FROM per_code`, lf.params)).rows[0] || {};
            const max = Math.max(...rowsQ.rows.map((r) => Number(r.ex_vat) || 0), 1);
            docNo = `${t.codes || 0} صنفًا`;
            cells = [
                ['عدد الأصناف (بالرمز)', ltr(t.codes || 0)],
                ['سطور البيع', ltr(t.lines || 0)],
                ['الكمية المباعة', ltr(num(t.qty))],
                ['صافي قبل الضريبة', moneyLtr(t.ex_vat, brand.currency)],
            ].map(([k, v]) => cell(k, v)).join('');
            const body = rowsQ.rows.map((r, i) => `<tr>
                <td class="c idx">${i + 1}</td>
                <td class="c n">${esc(r.code)}</td>
                <td>${esc(r.name)}${Number(r.names) > 1 ? ` <span class="pill">${r.names} أسماء</span>` : ''}</td>
                <td class="c n">${esc(num(r.qty, 2))}</td>
                <td class="c n">${r.docs}</td>
                <td class="c n">${esc(num(r.ex_vat))}</td>
                <td class="c n">${esc(num(r.vat))}</td>
                <td class="c n">${esc(num(shareOf(r.ex_vat, Number(t.ex_vat) || 0), 1))}%</td>
                <td><span class="bars"><i style="width:${Math.max(2, round2((Number(r.ex_vat) || 0) / max * 100))}%"></i></span></td>
              </tr>`).join('');
            table = `<h3 class="sec">الأصناف${rowsQ.rows.length < Number(t.codes || 0) ? ` (أول ${limit} من ${t.codes})` : ''}</h3>
              <table class="t"><thead><tr><th style="width:4%">#</th><th style="width:10%">الكود</th><th>الصنف</th>
                <th style="width:9%">الكمية</th><th style="width:8%">الفواتير</th><th style="width:11%">قبل الضريبة</th>
                <th style="width:10%">الضريبة</th><th style="width:7%">النسبة</th><th style="width:10%">الحجم</th></tr></thead>
              <tbody>${body || '<tr><td colspan="9" class="c">لا أصناف مطابقة</td></tr>'}</tbody>
              <tfoot><tr><td colspan="3">مجموع المعروض</td><td class="n">${esc(num(rowsQ.rows.reduce((s, r) => s + (Number(r.qty) || 0), 0)))}</td>
                <td></td><td class="n">${esc(num(rowsQ.rows.reduce((s, r) => s + (Number(r.ex_vat) || 0), 0)))}</td>
                <td class="n">${esc(num(rowsQ.rows.reduce((s, r) => s + (Number(r.vat) || 0), 0)))}</td><td colspan="2"></td></tr></tfoot>
              </table>`;
            table += `<div class="note"><b>المطابقة:</b> مجاميع هذا الكشف من سطور الأصناف، ${ltr(note.no_lines)} سندًا في الفترة بلا سطورٍ مسجَّلة — لذلك لا يساوي «قبل الضريبة» هنا بالضرورة مجموعَ فواتير نفس الفترة؛ الفارق من السندات الناقصة لا من خطأٍ في الجمع.</div>`;
        } else {
            const w = buildWhere(f);
            const rowsQ = await pool.query(`
                WITH ${CC_CTE}
                SELECT o.doc_no, ${DAY('o.doc_date')} AS day, o.doc_time,
                       ${CASHIER_NAME} AS cashier_name, ${LINES_LEN}::int AS items,
                       o.total::float AS ex_vat, o.vat::float AS vat, o.net::float AS collected,
                       o.payed::float AS payed, o.pay_cash::float AS cash, o.pay_network::float AS network,
                       o.pay_mobile::float AS mobile, o.pay_credit::float AS credit
                  FROM ys_mirror_orders o ${CC_JOIN} ${w.clause}
                 ORDER BY o.doc_date DESC, o.doc_time::time DESC, o.doc_no DESC
                 LIMIT ${limit}
            `, w.params);
            const tQ = await pool.query(`
                SELECT COUNT(*)::int AS docs, COALESCE(SUM(o.net),0)::float AS collected,
                       COALESCE(SUM(o.total),0)::float AS ex_vat, COALESCE(SUM(o.vat),0)::float AS vat,
                       COALESCE(SUM(${LINES_LEN}),0)::int AS items
                  FROM ys_mirror_orders o ${w.clause}`, w.params);
            const t = tQ.rows[0] || {};
            docNo = `${t.docs || 0} سندًا`;
            /* الفترةُ تُطبع في ترويسة العلامة مرةً واحدة: تكرارها في خليةٍ
               بعرض 47مم يُحوّل «من … إلى …» إلى ثلاثة أسطرٍ مكسورة. */
            cells = [
                ['عدد الفواتير', ltr(t.docs || 0)],
                ['سطور الأصناف', ltr(t.items || 0)],
                ['متوسط الفاتورة', moneyLtr(Number(t.docs) ? round2(Number(t.collected) / Number(t.docs)) : 0, brand.currency)],
                ['إجمالي المحصَّل', moneyLtr(t.collected, brand.currency)],
            ].map(([k, v]) => cell(k, v)).join('');
            const body = rowsQ.rows.map((r, i) => {
                const pay = [['نقد', r.cash], ['شبكة', r.network], ['جوال', r.mobile], ['آجل', r.credit]]
                    .filter(([, v]) => Number(v || 0) > 0).map(([m]) => m).join('+') || 'غير مُبيَّن';
                return `<tr>
                  <td class="c idx">${i + 1}</td>
                  <td class="c n">${esc(r.day)}</td>
                  <td class="c n">${esc(hhmm(r.doc_time))}</td>
                  <td class="c n">${esc(r.doc_no)}</td>
                  <td>${esc(r.cashier_name)}</td>
                  <td class="c n">${r.items}</td>
                  <td class="c n">${esc(num(r.ex_vat))}</td>
                  <td class="c n">${esc(num(r.vat))}</td>
                  <td class="c n"><b>${esc(num(r.collected))}</b></td>
                  <td class="c"><span class="pill ${Number(r.credit) > 0 ? 'pill--due' : 'pill--pay'}">${esc(pay)}</span></td>
                </tr>`;
            }).join('');
            table = `<h3 class="sec">الفواتير${rowsQ.rows.length < Number(t.docs || 0) ? ` (أول ${limit} من ${t.docs})` : ''}</h3>
              <table class="t"><thead><tr><th style="width:4%">#</th><th style="width:9%">التاريخ</th>
                <th style="width:6%">الوقت</th><th style="width:10%">السند</th><th>الكاشير</th>
                <th style="width:6%">أصناف</th><th style="width:10%">قبل الضريبة</th><th style="width:9%">الضريبة</th>
                <th style="width:10%">الإجمالي</th><th style="width:12%">الدفع</th></tr></thead>
              <tbody>${body || '<tr><td colspan="10" class="c">لا فواتير في هذه الفترة</td></tr>'}</tbody>
              <tfoot><tr><td colspan="5">مجموع المعروض (${rowsQ.rows.length} سندًا)</td>
                <td class="n">${rowsQ.rows.reduce((s, r) => s + (Number(r.items) || 0), 0)}</td>
                <td class="n">${esc(num(rowsQ.rows.reduce((s, r) => s + (Number(r.ex_vat) || 0), 0)))}</td>
                <td class="n">${esc(num(rowsQ.rows.reduce((s, r) => s + (Number(r.vat) || 0), 0)))}</td>
                <td class="n">${esc(num(rowsQ.rows.reduce((s, r) => s + (Number(r.collected) || 0), 0)))}</td>
                <td></td></tr></tfoot></table>`;
        }

        const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title><style>${sheetStyles()}</style></head><body>
<main class="sheet">
  ${head(brand, { title, subtitle: period + scope + search, docNo })}
  <div class="body">
    <section class="grid">${cells}</section>
    ${table}
    <div class="note">${note.text}</div>
    ${footLine(brand, title, note.synced_at)}
  </div>
</main>
</body></html>`;
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err) {
        logger.error({ err: err.message }, '[cashier-sales] sheet failed');
        res.status(500).json({ error: 'INTERNAL', message: err.message });
    }
});

module.exports = { router };
