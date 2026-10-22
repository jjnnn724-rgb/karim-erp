/**
 * expense-register-routes.js — سجل الصرف + إذن الصرف (قراءة فقط)
 * ═══════════════════════════════════════════════════════════════════════
 * النموذج القائم (بلا جداول جديدة):
 *   · dispatches = إذن الصرف (طلب الصرف واعتماداته وتوقيعاته وأصنافه المعتمدة)
 *   · expenses  = سجل الصرف (الحركات المنفَّذة، وفي بيانها رقم الإذن)
 * فالواجهة قراءةٌ تقديمية فوقهما: لا كتابة ولا تعديل ولا حذف.
 *
 *   GET /api/expense-register                    سجل الصرف (صفوف + مجاميع + سلسلة + توزيع)
 *   GET /api/expense-register/html               كشف السجل مطبوع (نفس المرشّحات)
 *   GET /api/expense-register/voucher/:id        إذن الصرف بتفاصيله وسلسلة اعتماداته
 *   GET /api/expense-register/voucher/:id/html   إذن الصرف مطبوع (ورقة A4)
 *
 * الأرقام كلها تُحسب هنا: الواجهة تعرض ولا تحسب (لا مجموع ولا نسبة ولا فرقٍ
 * في المتصفح). والترقيم صادق: `totals.count` هو عدد الصفوف المطابقة فعلًا
 * لا عدد المعروض، فلا توهم الواجهة بأن الفترة كلها مرسومة.
 */
'use strict';

const express = require('express');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { generalLimiter } = require('./rate-limiter');
const { pool } = require('./shared-pool');
const { logger } = require('./logger');

const router = express.Router();
const READ_ROLES = ['admin', 'manager', 'accountant'];

/* ── المبلغ كتابةً (بالعربية) ──────────────────────────────────────────── */
const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة',
    'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

function underThousand(n) {
    const parts = [];
    if (n >= 100) { parts.push(HUNDREDS[Math.floor(n / 100)]); n %= 100; }
    if (n >= 20) {
        const t = Math.floor(n / 10); const u = n % 10;
        parts.push(u ? `${ONES[u]} و${TENS[t]}` : TENS[t]);
    } else if (n > 0) { parts.push(ONES[n]); }
    return parts.join(' و');
}

/**
 * صيغة المعدود (ريال/هللة/ألف/مليون): ١ و٢ لهما صيغة بلا عدد مكتوب، ٣–١٠ جمع
 * سلامة، و١١ فأكثر المفرد. يُطبَّق هذا على آحاد العدد لا على مجموعه، لأن
 * العدد يُضاف لما قبله («خمسة وعشرون ريالًا»).
 */
function unitPhrase(n, forms) {
    if (n === 1) {return forms.one;}
    if (n === 2) {return forms.two;}
    if (n <= 10) {return `${underThousand(n)} ${forms.plural}`;}
    return `${underThousand(n)} ${forms.many}`;
}

const ALF = { one: 'ألف', two: 'ألفان', plural: 'آلاف', many: 'ألفًا' };
const MALYON = { one: 'مليون', two: 'مليونان', plural: 'ملايين', many: 'مليونًا' };
const HALALA = { one: 'هللة واحدة', two: 'هللتان', plural: 'هللات', many: 'هللة' };
/* الريال يُصاغ على مستوى المجموع لا على مجموعة واحدة، فلذلك يُذكر وحده هنا. */
const RIYAL = { plural: 'ريالات', many: 'ريالًا' };

/** المبلغ بالعربي — يُكتب على الإذن المطبوع. */
function amountInWords(value) {
    const abs = Math.abs(Number(value) || 0);
    let total = Math.floor(abs);
    let halalas = Math.round((abs - total) * 100);
    if (halalas === 100) { total += 1; halalas = 0; }   // 1.999 لا يصبح «ريال ومائة هللة»
    const groups = [];
    const millions = Math.floor(total / 1000000);
    const thousands = Math.floor((total % 1000000) / 1000);
    const rest = total % 1000;
    if (millions) { groups.push(unitPhrase(millions, MALYON)); }
    if (thousands) { groups.push(unitPhrase(thousands, ALF)); }
    if (rest) { groups.push(underThousand(rest)); }
    /* الآحاد الأخيرة وحدها تحدد صيغة العملة؛ والصفر يُقال مفردًا («ألف ريال»). */
    const lastTwo = total % 100;
    const body = groups.join(' و');
    let money;
    if (total === 0) {money = 'صفر ريال';}
    else if (total === 1) {money = 'ريال واحد';}
    else if (total === 2) {money = 'ريالان';}
    else if (lastTwo === 0) {money = `${body} ريال`;}          // ألف ريال، لا «ألف ريالًا»
    else if (lastTwo > 10) {money = `${body} ${RIYAL.many}`;}
    else if (lastTwo <= 2) {money = `${body} ريال`;}   // 101 و102: المفرد يكتفي بما قبله
    else {money = `${body} ${RIYAL.plural}`;}
    const ha = halalas ? ` و${unitPhrase(halalas, HALALA)}` : '';
    return `${money}${ha} فقط لا غير`.replace(/\s+/g, ' ').trim();
}

const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v || '').slice(0, 10));
/* الطابع بالتوقيت المحلي — هو ما تراه الشاشة وما يوقِّع عليه العامل؛ ISO UTC
   يجعل الإذن المطبوع يقول «17:41» والدرج يقول «20:41» لنفس الواقعة. */
const stamp = (v) => {
    const d = v instanceof Date ? v : new Date(String(v || ''));
    if (Number.isNaN(d.getTime())) {return String(v || '').slice(0, 16).replace('T', ' ');}
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
/* esc يستعمل &quot; (وليس &#34;): الشعار يصل إلى خاصية src كما هو، والفصل في
   سلسلة base64 هو ; و , — لو استُبدلت مراجعها لانكسر الصورة. */
const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

/* ── الهوية والعملة: من صف الإعدادات، لا من نصٍّ مكتوب في الكود ────────── */
const CURRENCY_AR = { SAR: 'ر.س', EGP: 'ج.م', AED: 'د.إ', USD: '$', EUR: '€', GBP: '£' };
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
        logger.warn({ err: err.message }, '[expense-register] brand unavailable — fallback');
        return { ...BRAND_FALLBACK };
    }
}

/* ── مُجمِّع موحَّد لكل قراءات السجل ──────────────────────────────────────
   من + إلى + نوع + قسم + بحث ⇒ WHERE ومعاملاتها، تُبنى في مكانٍ واحد فلا
   يختلف «المجموع» عن «الصفوف» عن «السلسلة» عن «الكشف المطبوع». */
function buildFilter(query, { from, to } = {}) {
    const params = [];
    const where = [];
    /* `?` قد تتكرر في المرشّح الواحد (قسمٌ في عمودين)، فالترقيم لكل
       معاملٍ على حده لا لمعاملٍ واحد. */
    const add = (sql, ...values) => {
        let i = 0;
        where.push(sql.replace(/\?/g, () => { params.push(values[i]); i += 1; return `$${params.length}`; }));
    };
    const f = from !== undefined ? from : String(query.from || '').slice(0, 10);
    const t = to !== undefined ? to : String(query.to || '').slice(0, 10);
    const type = String(query.type || '').slice(0, 40);
    const dept = String(query.dept || '').slice(0, 40);
    const q = String(query.q || '').trim().slice(0, 60);
    if (f) { add('e.date::date >= ?::date', f); }
    if (t) { add('e.date::date <= ?::date', t); }
    if (type) { add('COALESCE(e."adjustmentType",\'\') = ?', type); }
    if (dept) { add('(d."deptCode" = ? OR e."deptId" = ?)', dept, dept); }
    if (q) { add('(e.desc ILIKE ? OR e.notes ILIKE ? OR e."category" ILIKE ?)', `%${q}%`, `%${q}%`, `%${q}%`); }
    return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params, from: f, to: t, type, dept, q };
}

/* ── أوصاف الأنواع (تُعرض كما هي في الجدول والكشف) ──────────────────────── */
const TYPE_AR = {
    dispatch: 'صرف مخزون', count_correction: 'تصحيح جرد', transfer: 'تحويل',
    receipt: 'وارد مخزون', stock_transfer: 'تحويل مخزون', inventory_transfer: 'تحويل مخزون',
    kitchen_return: 'مرتجع مطبخ', count_correction_receipt: 'إذن جرد',
};
const typeAr = (v) => TYPE_AR[v] || (v ? String(v) : 'يدوي');

/* العمود المسموح بالفرز عليه — قائمة بيضاء، لا إدخالٌ يصل إلى SQL. */
const SORTS = {
    date: 'e.date', amount: 'e.amount', dept: 'COALESCE(d."deptName", e."deptId", \'\')',
    description: 'e.desc', voucher: 'd.id', status: 'd.status',
};
const orderOf = (query) => {
    const key = SORTS[String(query.sort || '').slice(0, 12)] ? String(query.sort).slice(0, 12) : 'date';
    const dir = String(query.dir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    return `${SORTS[key]} ${dir}, e.id ${dir}`;
};

const ROWS_SQL = `
            SELECT e.id, e.date, e."deptId", e.desc, e.amount, e.notes, e."category",
                   e."adjustmentType", e."autoGenerated", e.branch_id,
                   d.id AS request_id, d."deptName" AS request_dept, d.status AS request_status,
                   d."createdBy" AS request_by, d."approvedBy" AS request_approved_by
              FROM expenses e
              LEFT JOIN dispatches d
                ON d.id::text = substring(e.notes from 'طلب صرف #([0-9]+)')
        `;

/* ── سجل الصرف ─────────────────────────────────────────────────────────── */
router.get('/', jwtAuth, requireRole(...READ_ROLES), generalLimiter, async (req, res) => {
    try {
        const f = buildFilter(req.query);
        const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
        const offset = Math.max(Number(req.query.offset) || 0, 0);

        const rows = await pool.query(`${ROWS_SQL} ${f.clause}
             ORDER BY ${orderOf(req.query)}
             LIMIT ${limit} OFFSET ${offset}`, f.params);

        const totals = await pool.query(`
            SELECT COUNT(*)::int AS count, COALESCE(SUM(e.amount),0)::float AS total,
                   COALESCE(SUM(e.amount) FILTER (WHERE e."autoGenerated" IS NOT TRUE),0)::float AS manual_total,
                   COUNT(DISTINCT COALESCE(NULLIF(d."deptCode",''), NULLIF(e."deptId",'')))::int AS depts,
                   COUNT(DISTINCT e.date::date)::int AS days,
                   COUNT(DISTINCT d.id)::int AS vouchers,
                   COUNT(*) FILTER (WHERE d.id IS NULL)::int AS unlinked
              FROM expenses e
              LEFT JOIN dispatches d ON d.id::text = substring(e.notes from 'طلب صرف #([0-9]+)')
              ${f.clause}
        `, f.params);

        const series = await pool.query(`
            SELECT e.date::text AS day, COUNT(*)::int AS n, COALESCE(SUM(e.amount),0)::float AS total
              FROM expenses e
              LEFT JOIN dispatches d ON d.id::text = substring(e.notes from 'طلب صرف #([0-9]+)')
              ${f.clause}
             GROUP BY 1 ORDER BY 1 ASC LIMIT 400
        `, f.params);

        const depts = await pool.query(`
            SELECT COALESCE(NULLIF(d."deptCode",''), NULLIF(e."deptId",''), '') AS code,
                   COALESCE(NULLIF(d."deptName",''), NULLIF(e."deptId",''), 'غير مُسند') AS dept,
                   COUNT(*)::int AS n, COALESCE(SUM(e.amount),0)::float AS total
              FROM expenses e
              LEFT JOIN dispatches d ON d.id::text = substring(e.notes from 'طلب صرف #([0-9]+)')
              ${f.clause}
             GROUP BY 1, 2 ORDER BY total DESC LIMIT 12
        `, f.params);

        const top = await pool.query(`
            SELECT COALESCE(NULLIF(e."category",''),'غير مصنَّف') AS category,
                   COUNT(*)::int AS n, COALESCE(SUM(e.amount),0)::float AS total
              FROM expenses e ${f.clause}
             GROUP BY 1 ORDER BY total DESC LIMIT 8
        `, f.params);

        const types = await pool.query(`
            SELECT COALESCE(NULLIF(e."adjustmentType",''),'يدوي') AS type, COUNT(*)::int AS n
              FROM expenses e ${f.clause} GROUP BY 1 ORDER BY n DESC LIMIT 10
        `, f.params);

        /* الفترة المماثلة السابقة: نفس الطول قبل `from` — لا تُقارن إلا إذا
           حُدد الطرفان، وإلا كان «الفرق» رقمًا من فراغ. */
        let prevTotal = null;
        if (f.from && f.to) {
            const dayMs = 86400000;
            const a = Date.parse(`${f.from}T00:00:00Z`);
            const b = Date.parse(`${f.to}T00:00:00Z`);
            if (Number.isFinite(a) && Number.isFinite(b) && b >= a) {
                const spanDays = Math.round((b - a) / dayMs) + 1;
                const shift = (d) => new Date(d - spanDays * dayMs).toISOString().slice(0, 10);
                const p = buildFilter(req.query, { from: shift(a), to: shift(b) });
                const prev = await pool.query(`
                    SELECT COALESCE(SUM(e.amount),0)::float AS total
                      FROM expenses e
                      LEFT JOIN dispatches d ON d.id::text = substring(e.notes from 'طلب صرف #([0-9]+)')
                      ${p.clause}`, p.params);
                prevTotal = round2(prev.rows[0] && prev.rows[0].total);
            }
        }

        const t = totals.rows[0] || {};
        const total = round2(t.total);
        const days = Number(t.days) || 0;
        /* العملة من الإعدادات لا من نصٍّ في الواجهة: الشاشة تعرض ما يصلها. */
        const brand = await loadBrand();
        res.json({
            currency: brand.currency,
            rows: rows.rows.map((r) => ({
                ...r,
                share: total > 0 ? round2((Number(r.amount) || 0) / total * 100) : 0,
            })),
            totals: {
                count: Number(t.count) || 0,
                total,
                manual_total: round2(t.manual_total),
                depts: Number(t.depts) || 0,
                vouchers: Number(t.vouchers) || 0,
                unlinked: Number(t.unlinked) || 0,
                days,
                avg_day: days ? round2(total / days) : 0,
                avg_row: (Number(t.count) || 0) ? round2(total / Number(t.count)) : 0,
                prev_total: prevTotal,
                delta: prevTotal != null && prevTotal > 0
                    ? round2((total - prevTotal) / prevTotal * 100) : null,
            },
            series: series.rows,
            depts: depts.rows,
            top: top.rows,
            types: types.rows.map((x) => ({ ...x, label: typeAr(x.type) })),
            page: { limit, offset },
            from: f.from, to: f.to,
        });
    } catch (err) {
        logger.error({ err: err.message }, '[expense-register] failed');
        res.status(500).json({ error: 'INTERNAL', message: err.message });
    }
});

/* ── إذن الصرف: الطلب باعتماداته وأصنافه وسلسلة وقائعه ─────────────────── */
async function loadVoucher(id) {
    const r = await pool.query('SELECT * FROM dispatches WHERE id::text = $1 LIMIT 1', [String(id)]);
    if (!r.rows.length) {return null;}
    const d = r.rows[0];
    const events = await pool.query(
        'SELECT event_type, from_status, to_status, actor_name, actor_role, created_at FROM dispatch_workflow_events WHERE dispatch_id = $1 ORDER BY id ASC',
        [d.id]);
    const issued = await pool.query(
        `SELECT e.id, e.date, e.desc, e.amount, e."category" FROM expenses e
          WHERE substring(e.notes from 'طلب صرف #([0-9]+)') = $1::text ORDER BY e.id ASC`,
        [String(d.id)]);
    const approved = Array.isArray(d.approvedItems) ? d.approvedItems : [];
    const requested = Array.isArray(d.items) ? d.items : [];
    const received = Array.isArray(d.receivedItems) ? d.receivedItems : [];
    const items = approved.length ? approved : requested;
    const approvedValue = round2(approved.reduce((s, x) => s + Number(x.approvedValue || 0), 0));
    const issuedTotal = round2(issued.rows.reduce((s, x) => s + Number(x.amount || 0), 0));
    return {
        dispatch: d, items, events: events.rows, issued: issued.rows, received,
        /* «القيمة» مرجعٌ للاستهلاك فقط؛ الرقم المحاسبي هو المسجَّل في
           دفتر الحركات (issued) حين يوجد. */
        approvedValue,
        total: issuedTotal || approvedValue,
        ledgerTotal: issuedTotal,
    };
}

router.get('/voucher/:id', jwtAuth, requireRole(...READ_ROLES), generalLimiter, async (req, res) => {
    try {
        const v = await loadVoucher(req.params.id);
        if (!v) {return res.status(404).json({ error: 'NOT_FOUND', message: 'إذن الصرف غير موجود' });}
        const brand = await loadBrand();
        /* الكتابة والعملة من الخادم: اللوحة تعرض ولا تحسب ولا تُسمّي. */
        res.json({ ...v, amountWords: amountInWords(v.total), currency: brand.currency });
    } catch (err) {
        logger.error({ err: err.message }, '[expense-register] voucher failed');
        res.status(500).json({ error: 'INTERNAL', message: err.message });
    }
});

/* ── الطوابع المشتركة للورقتين ──────────────────────────────────────────── */
const STATUS_AR = {
    pending: 'بانتظار اعتماد المخزن', chef_approved: 'معتمد من الشيف — بانتظار المخازن',
    approved: 'معتمد — بانتظار استلام المطبخ', partially_received: 'مستلم جزئيًا',
    received: 'مستلم ومغلق', rejected: 'مرفوض',
};
const statusAr = (v) => STATUS_AR[v] || (v ? String(v) : 'غير محدد');

/** درجة اللون حسب الحالة — تُستخدم في الأوسمة وختم الورقة. */
const TONE = {
    approved: 'success', received: 'success', partially_received: 'warning',
    chef_approved: 'info', pending: 'warning', rejected: 'danger',
};
const toneOf = (v) => TONE[v] || 'neutral';

/**
 * المبلغ كما يُطبع — رقمٌ بخانتين عشريتين ثم الوحدة، والوحدة أصغر كي لا
 * تزاحم الرقم في عمودٍ ضيّق.
 */
const money = (v, currency) => `${(round2(v)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${esc(currency)}`;

/* ورقة واحدة: رأسٌ داكنٌ بشريطٍ ذهبي، وأرقام بجدولٍ مُحوَّل إلى طوابع. */
function sheetStyles() {
    return `
  @page { size: A4; margin: 12mm 11mm; }
  * { margin:0; padding:0; box-sizing:border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    font-family: "IBM Plex Sans Arabic", "Cairo", "Tajawal", Tahoma, Arial, sans-serif;
    font-size: 12.5px; color:#17231f; background:#eef1f6; direction:rtl;
    padding:28px 20px; line-height:1.55;
  }
  .sheet { max-width:200mm; margin:0 auto; background:#fff; border:1px solid #dfe3ea;
           border-radius:14px; box-shadow:0 14px 40px rgba(15,23,42,.10); overflow:hidden; }
  .brand { display:flex; align-items:center; gap:16px; padding:18px 22px;
           background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%); border-bottom:3px solid #c9a227; }
  .brand img { width:64px; height:64px; object-fit:contain; background:#fff;
               border:2px solid #c9a227; border-radius:12px; padding:4px; }
  .brand__t { flex:1; min-width:0; }
  .brand__t h1 { font-size:17px; color:#f5d76e; font-weight:700; letter-spacing:.2px; }
  .brand__t p { font-size:11px; color:#cbd5e1; margin-top:2px; }
  .brand__id { text-align:center; }
  .brand__id .no { display:inline-block; background:rgba(245,215,110,.14); border:1px solid #c9a227;
                   border-radius:999px; padding:3px 14px; font-size:13px; font-weight:700; color:#f5d76e;
                   font-variant-numeric:tabular-nums; direction:ltr; }
  .doc { text-align:center; padding:16px 22px 6px; }
  .doc h2 { font-size:20px; color:#0f172a; letter-spacing:.4px; }
  .doc .sub { font-size:11.5px; color:#64748b; margin-top:3px; }
  .stamp { display:inline-block; margin-top:9px; padding:4px 20px; border-radius:999px;
           font-size:11.5px; font-weight:800; letter-spacing:.3px; border:1.5px solid; }
  .stamp--success { color:#055f3a; border-color:#0b9e6c; background:rgba(11,158,108,.10); }
  .stamp--warning { color:#b54708; border-color:#d97706; background:rgba(217,119,6,.10); }
  .stamp--danger  { color:#b42318; border-color:#e5484d; background:rgba(229,72,77,.10); }
  .stamp--info    { color:#175cd3; border-color:#2563eb; background:rgba(37,99,235,.10); }
  .stamp--neutral { color:#475467; border-color:#98a2b3; background:#f2f4f7; }
  .body { padding:6px 22px 22px; }
  .grid { display:grid; grid-template-columns:repeat(4,1fr); gap:0; border:1px solid #e5e7eb;
          border-radius:10px; overflow:hidden; margin-top:12px; }
  .cell { padding:9px 12px; border-inline-start:1px solid #eef1f5; border-top:1px solid #eef1f5; }
  .cell:nth-child(4n+1) { border-inline-start:0; }
  .cell:nth-child(-n+4) { border-top:0; }
  .cell b { display:block; font-size:10.5px; color:#8a6d1b; font-weight:700; letter-spacing:.2px; }
  .cell span { display:block; margin-top:2px; font-size:12.5px; color:#0f172a; font-weight:600;
               overflow-wrap:anywhere; }
  h3.sec { font-size:12.5px; color:#0f172a; margin:18px 0 6px; padding-inline-start:9px;
           border-inline-start:4px solid #c9a227; }
  table.t { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
  table.t th, table.t td { padding:6px 8px; font-size:11.5px; border-bottom:1px solid #edf0f4; text-align:right; }
  table.t th { background:#0f172a; color:#f5d76e; font-weight:700; font-size:11px; letter-spacing:.2px;
               text-align:center; white-space:nowrap; }
  table.t td.c, table.t th.c { text-align:center; }
  table.t td.n { text-align:left; direction:ltr; unicode-bidi:embed; }
  table.t tbody tr:nth-child(even) td { background:#f8fafc; }
  table.t tbody tr { break-inside:avoid; page-break-inside:avoid; }
  table.t tfoot td { background:#eef2f7; font-weight:800; color:#0f172a; border-top:2px solid #c9a227;
                     border-bottom:0; font-size:12px; }
  .idx { color:#94a3b8; font-size:10.5px; }
  .pill { display:inline-block; padding:1px 8px; border-radius:999px; font-size:10.5px; font-weight:700;
          border:1px solid #dbe1ea; background:#f2f4f7; color:#475467; white-space:nowrap; }
  .pill--success { border-color:#0b9e6c; background:rgba(11,158,108,.10); color:#055f3a; }
  .pill--warning { border-color:#d97706; background:rgba(217,119,6,.10); color:#b54708; }
  .pill--danger  { border-color:#e5484d; background:rgba(229,72,77,.10); color:#b42318; }
  .pill--info    { border-color:#2563eb; background:rgba(37,99,235,.10); color:#175cd3; }
  .amount { padding:12px 16px; margin-top:14px; border-radius:12px; background:#0f172a; color:#fff;
            display:flex; align-items:center; justify-content:space-between; gap:14px; break-inside:avoid; }
  .amount__l { font-size:11.5px; color:#cbd5e1; }
  .amount__v { font-size:19px; font-weight:800; color:#f5d76e; font-variant-numeric:tabular-nums;
               direction:ltr; unicode-bidi:embed; }
  .words { margin-top:8px; padding:10px 16px; border:1px dashed #c9b98a; border-radius:12px;
           background:#fdf9ee; font-size:12.5px; color:#3f3a26; break-inside:avoid; }
  .words b { color:#8a6d1b; }
  .flow { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
  .flow__i { flex:1 1 22%; min-width:130px; border:1px solid #e5e7eb; border-top:3px solid #c9a227;
             border-radius:10px; padding:8px 10px; background:#fff; break-inside:avoid; }
  .flow__i .st { width:18px; height:18px; border-radius:50%; background:#0f172a; color:#f5d76e;
                 font-size:10px; font-weight:800; display:inline-flex; align-items:center;
                 justify-content:center; margin-inline-end:6px; }
  .flow__i b { display:block; font-size:11px; color:#8a6d1b; margin-bottom:3px; }
  .flow__i .who { font-size:11.5px; color:#0f172a; font-weight:700; }
  .flow__i .at { font-size:10px; color:#64748b; margin-top:2px; font-variant-numeric:tabular-nums; }
  .signs { display:flex; gap:12px; margin-top:24px; break-inside:avoid; }
  .sign { flex:1; border:1px solid #e5e7eb; border-radius:10px; overflow:hidden; background:#fff; }
  .sign__ink { height:58px; display:flex; align-items:center; justify-content:center; background:#f8fafc; }
  .sign__ink img { max-height:54px; max-width:92%; object-fit:contain; }
  .sign__ink em { color:#cbd5e1; font-size:10.5px; font-style:normal; }
  .sign__cap { border-top:2px solid #0f172a; padding:6px 8px; font-size:10.5px; color:#475467; }
  .sign__cap b { display:block; color:#0f172a; font-size:11px; margin-top:1px; }
  .note { margin-top:12px; border:1px solid #e5e7eb; border-inline-start:4px solid #c9a227;
          border-radius:10px; padding:9px 13px; background:#fffdf5; font-size:11.5px; color:#3f3a26; }
  .foot { margin-top:18px; border-top:1px solid #e5e7eb; padding-top:8px; display:flex;
          justify-content:space-between; gap:10px; font-size:10px; color:#94a3b8; }
  .mark { position:relative; }
  .mark::after { content:attr(data-mark); position:absolute; inset:0; display:flex; align-items:center;
                 justify-content:center; pointer-events:none; font-size:64px; font-weight:800;
                 color:rgba(229,72,77,.08); transform:rotate(-18deg); letter-spacing:4px; }
  @media print {
    body { background:#fff; padding:0; }
    .sheet { border:0; border-radius:0; box-shadow:none; max-width:none; }
    table.t thead { display:table-header-group; }
  }`;
}

/** رأس الورقة: الشعار والاسم من الإعدادات + رقم المستند + ختم الحالة. */
function sheetHead(brand, { title, subtitle, docNo, status }) {
    const logo = brand.logo
        || '/app/assets/al-shurfa-logo.png';
    /* بلا حالة ⇒ بلا ختم: كشف السجل ليس مستندًا بانتظار قرار. */
    const stamp = status
        ? `<span class="stamp stamp--${toneOf(status)}">${esc(statusAr(status))}</span>` : '';
    return `<header class="brand" data-v2-print-brand>
      <img src="${esc(logo)}" alt="الشعار">
      <div class="brand__t"><h1>${esc(brand.name)}</h1><p>${esc(subtitle)}</p></div>
      <div class="brand__id"><span class="no">${esc(docNo)}</span></div>
    </header>
    <div class="doc"><h2>${esc(title)}</h2>${stamp}</div>`;
}

const footLine = (brand, extra) => `<div class="foot">
    <span>${esc(brand.name)} — ${esc(extra)}</span>
    <span>طُبع ${esc(stamp(new Date()))} · Karim ERP</span>
  </div>`;

/* ── إذن الصرف مطبوع ───────────────────────────────────────────────────── */
router.get('/voucher/:id/html', jwtAuth, requireRole(...READ_ROLES), generalLimiter, async (req, res) => {
    try {
        const v = await loadVoucher(req.params.id);
        if (!v) {return res.status(404).send('إذن الصرف غير موجود');}
        const brand = await loadBrand();
        const d = v.dispatch;
        const items = v.items;
        const rows = items.map((it, i) => {
            const reqQty = it.requestedQty ?? it.qty ?? '';
            const apprQty = it.approvedQty ?? '';
            const cw = it.catchWeightEnabled || it.actualWeight;
            return `<tr>
              <td class="c idx">${i + 1}</td>
              <td>${esc(it.itemName || it.name || '—')}${cw ? ' <span class="pill">وزن متغيّر</span>' : ''}</td>
              <td class="c n">${esc(reqQty === '' ? '—' : reqQty)}</td>
              <td class="c n">${esc(apprQty === '' ? (reqQty === '' ? '—' : reqQty) : apprQty)}</td>
              <td class="c">${esc(it.unit || '—')}</td>
              <td class="c n">${it.avgCost != null ? esc(Number(it.avgCost).toFixed(2)) : '—'}</td>
              <td class="c n"><b>${esc(Number(it.approvedValue || 0).toFixed(2))}</b></td>
            </tr>`;
        }).join('');

        /* سلسلة الاعتماد: كل مرحلة باسم فاعلها ووقتها، والمرحلة الحالية بارزة. */
        const stages = [
            d.createdBy ? { k: 'إعداد الطلب', who: d.createdBy, at: d.requestedAt || d.date } : null,
            d.chefApprovedBy ? { k: 'اعتماد الشيف', who: d.chefApprovedBy, at: d.chefApprovedAt } : null,
            d.warehouseApprovedBy || d.approvedBy
                ? { k: 'اعتماد المخزن', who: d.warehouseApprovedBy || d.approvedBy, at: d.warehouseApprovedAt || d.approvedDate } : null,
            d.warehouseRejectedBy || d.rejectedBy
                ? { k: 'رفض المخزن', who: d.warehouseRejectedBy || d.rejectedBy, at: d.warehouseRejectedAt || d.rejectedDate, bad: true } : null,
            d.chefRejectedBy
                ? { k: 'رفض الشيف', who: d.chefRejectedBy, at: d.chefRejectedAt, bad: true } : null,
            d.kitchenReceivedBy ? { k: 'استلام المطبخ', who: d.kitchenReceivedBy, at: d.kitchenReceivedAt } : null,
        ].filter(Boolean);
        const flow = stages.map((s, i) => `<div class="flow__i"${s.bad ? ' style="border-top-color:#e5484d"' : ''}>
            <b><span class="st">${i + 1}</span>${esc(s.k)}</b>
            <div class="who">${esc(s.who)}</div>
            <div class="at">${esc(s.at ? stamp(s.at) : '—')}</div>
          </div>`).join('');

        const sig = (label, dataUrl, who, at) => `<div class="sign">
            <div class="sign__ink">${dataUrl ? `<img src="${esc(dataUrl)}" alt="${esc(label)}">` : '<em>بلا توقيع إلكتروني</em>'}</div>
            <div class="sign__cap">${esc(label)}${who ? `<b>${esc(who)}</b>` : ''}${at ? `<span>${esc(iso(at))}</span>` : ''}</div>
          </div>`;

        const issuedTable = v.issued.length ? `<h3 class="sec">المنفَّذ في دفتر الحركات (${v.issued.length} حركة)</h3>
          <table class="t"><thead><tr><th>التاريخ</th><th>البيان</th><th>التصنيف</th><th style="width:16%">المبلغ</th></tr></thead>
          <tbody>${v.issued.map((x) => `<tr><td class="c n">${esc(iso(x.date))}</td><td>${esc(x.desc || '')}</td>
            <td class="c">${esc(x.category || '—')}</td><td class="c n">${esc(Number(x.amount || 0).toFixed(2))}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="3">إجمالي المسجَّل في الدفتر</td><td class="n">${esc(v.ledgerTotal.toFixed(2))}</td></tr></tfoot></table>` : '';

        const recon = v.ledgerTotal && Math.abs(v.ledgerTotal - v.approvedValue) > 0.005
            ? `<div class="note"><b>مطابقة:</b> قيمة الاعتماد ${money(v.approvedValue, brand.currency)}
               والمسجَّل في الدفتر ${money(v.ledgerTotal, brand.currency)}
               — الفرق ${money(v.ledgerTotal - v.approvedValue, brand.currency)}.</div>` : '';

        const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>إذن صرف ${esc(d.id)}</title><style>${sheetStyles()}</style></head><body>
<main class="sheet${d.status === 'pending' || d.status === 'rejected' ? ' mark' : ''}"
      ${d.status === 'rejected' ? 'data-mark="مرفوض"' : d.status === 'pending' ? 'data-mark="غير معتمد"' : ''}>
  ${sheetHead(brand, {
        title: 'إذن صرف مخزون',
        subtitle: 'نظام إدارة المخازن والمطاعم',
        docNo: `#${esc(String(d.id))}`,
        status: d.status,
    })}
  <div class="body">
    <section class="grid">
      <div class="cell"><b>القسم الطالب</b><span>${esc(d.deptName || d.deptCode || '—')}</span></div>
      <div class="cell"><b>تاريخ الطلب</b><span>${esc(iso(d.requestedAt || d.date) || '—')}</span></div>
      <div class="cell"><b>عدد الأصناف</b><span>${items.length}</span></div>
      <div class="cell"><b>قيمة الاعتماد</b><span>${money(v.approvedValue, brand.currency)}</span></div>
    </section>

    <h3 class="sec">الأصناف المعتمدة</h3>
    <table class="t">
      <thead><tr><th style="width:5%">#</th><th>الصنف</th><th style="width:11%">الكمية المطلوبة</th>
        <th style="width:11%">الكمية المعتمدة</th><th style="width:9%">الوحدة</th>
        <th style="width:12%">سعر التكلفة</th><th style="width:13%">القيمة</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="c">لا أصناف على هذا الإذن</td></tr>'}</tbody>
      <tfoot><tr><td colspan="6">إجمالي قيمة الاعتماد (${items.length} صنف)</td>
        <td class="n">${esc(v.approvedValue.toFixed(2))}</td></tr></tfoot>
    </table>

    ${issuedTable}${recon}

    <div class="amount">
      <span class="amount__l">إجمالي الصرف المُسجَّل${v.issued.length ? ' في الدفتر' : ''}</span>
      <span class="amount__v">${money(v.total, brand.currency)}</span>
    </div>
    <div class="words"><b>المبلغ كتابةً:</b> ${esc(amountInWords(v.total))}</div>

    ${flow ? `<h3 class="sec">سلسلة الاعتماد</h3><div class="flow">${flow}</div>` : ''}

    ${d.notes || d.approveNotes || d.receiptNotes || d.rejectionReason
        ? `<div class="note">${d.notes ? `<b>ملاحظات الطلب:</b> ${esc(d.notes)}<br>` : ''}
            ${d.approveNotes ? `<b>ملاحظات الاعتماد:</b> ${esc(d.approveNotes)}<br>` : ''}
            ${d.receiptNotes ? `<b>ملاحظات الاستلام:</b> ${esc(d.receiptNotes)}<br>` : ''}
            ${d.rejectionReason ? `<b>سبب الرفض:</b> ${esc(d.rejectionReason)}` : ''}</div>` : ''}

    <h3 class="sec">التواقيع</h3>
    <div class="signs">
      ${sig('مُعِدّ الطلب', d.requestSignatureData, d.createdBy, d.requestedAt || d.date)}
      ${sig('اعتماد الشيف', d.chefApprovalSignatureData, d.chefApprovedBy, d.chefApprovedAt)}
      ${sig('أمين المخزن', d.warehouseApprovalSignatureData || d.warehouseRejectionSignatureData,
        d.warehouseApprovedBy || d.warehouseRejectedBy, d.warehouseApprovedAt || d.warehouseRejectedAt)}
      ${sig('مستلم المطبخ', d.kitchenReceiptSignatureData, d.kitchenReceivedBy, d.kitchenReceivedAt)}
    </div>

    ${v.events.length ? `<p style="margin-top:12px;font-size:10.5px;color:#64748b">
        عدد الوقائع المسجَّلة: ${v.events.length}${d.lastEventHash ? ` · بصمة السلسلة ${esc(String(d.lastEventHash).slice(0, 12))}` : ''}</p>` : ''}

    ${footLine(brand, `إذن صرف رقم ${esc(String(d.id))}`)}
  </div>
</main>
</body></html>`;
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err) {
        logger.error({ err: err.message }, '[expense-register] voucher html failed');
        res.status(500).json({ error: 'INTERNAL', message: err.message });
    }
});

/* ── كشف سجل الصرف مطبوع — بنفس مرشّحات الشاشة ──────────────────────────── */
router.get('/html', jwtAuth, requireRole(...READ_ROLES), generalLimiter, async (req, res) => {
    try {
        const f = buildFilter(req.query);
        const brand = await loadBrand();
        const limit = Math.min(Math.max(Number(req.query.limit) || 400, 1), 1000);
        const data = await pool.query(`${ROWS_SQL} ${f.clause} ORDER BY e.date DESC, e.id DESC LIMIT ${limit}`, f.params);
        const sums = await pool.query(`
            SELECT COUNT(*)::int AS count, COALESCE(SUM(e.amount),0)::float AS total
              FROM expenses e
              LEFT JOIN dispatches d ON d.id::text = substring(e.notes from 'طلب صرف #([0-9]+)')
              ${f.clause}`, f.params);
        const t = sums.rows[0] || {};
        const total = round2(t.total);
        const period = (f.from || f.to)
            ? `من ${esc(f.from || 'البداية')} إلى ${esc(f.to || 'اليوم')}`
            : 'كل الفترات';
        const body = data.rows.map((r, i) => `<tr>
            <td class="c idx">${i + 1}</td>
            <td class="c n">${esc(iso(r.date))}</td>
            <td class="c n">${r.request_id ? esc(String(r.request_id)) : '—'}</td>
            <td>${esc(r.desc || '—')}</td>
            <td>${esc(r.request_dept || r.deptId || '—')}</td>
            <td class="c">${esc(typeAr(r.adjustmentType))}</td>
            <td class="c"><span class="pill pill--${toneOf(r.request_status)}">${esc(r.request_status ? statusAr(r.request_status) : 'بلا إذن')}</span></td>
            <td class="c n">${esc(Number(r.amount || 0).toFixed(2))}</td>
          </tr>`).join('');

        const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>كشف سجل الصرف</title><style>${sheetStyles()}</style></head><body>
<main class="sheet">
  ${sheetHead(brand, { title: 'سجلّ الصرف', subtitle: period, docNo: `${t.count || 0} حركة` })}
  <div class="body">
    <section class="grid">
      <div class="cell"><b>الفترة</b><span>${period}</span></div>
      <div class="cell"><b>عدد الحركات</b><span>${t.count || 0}</span></div>
      <div class="cell"><b>متوسط الحركة</b><span>${money((Number(t.count) || 0) ? total / Number(t.count) : 0, brand.currency)}</span></div>
      <div class="cell"><b>إجمالي الصرف</b><span>${money(total, brand.currency)}</span></div>
    </section>
    <h3 class="sec">الحركات${data.rows.length >= (Number(t.count) || 0) ? '' : ` (أول ${limit} من ${t.count})`}</h3>
    <table class="t">
      <thead><tr><th style="width:4%">#</th><th style="width:10%">التاريخ</th><th style="width:14%">إذن الصرف</th>
        <th>البيان</th><th style="width:13%">القسم</th><th style="width:10%">النوع</th>
        <th style="width:13%">الحالة</th><th style="width:11%">المبلغ</th></tr></thead>
      <tbody>${body || '<tr><td colspan="8" class="c">لا حركات في هذه الفترة</td></tr>'}</tbody>
      <tfoot><tr><td colspan="7">إجمالي المعروض</td><td class="n">${esc(total.toFixed(2))}</td></tr></tfoot>
    </table>
    ${footLine(brand, 'كشف سجل الصرف')}
  </div>
</main>
</body></html>`;
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err) {
        logger.error({ err: err.message }, '[expense-register] register html failed');
        res.status(500).json({ error: 'INTERNAL', message: err.message });
    }
});

module.exports = { router, amountInWords };
