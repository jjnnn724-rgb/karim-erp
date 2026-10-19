/**
 * V2 — Departments screen · السجل + تفاصيل القسم + CRUD (P1-3)
 * ═══════════════════════════════════════════════════════════════════════
 * Register mirrors /api/departments. Detail mirrors renderDepartmentDetail
 * (features/departments.js:361-382, read fully): الترويسة بالهوية + KPIs
 * (إيراد/تكلفة/صافي + تفكيك صرف/فروق/تشغيلي) + إيراد الكاشير المسند مع
 * الفروع + آخر 10 إيرادات/مصاريف + كل أذون الفترة + زر إيراد/مصروف بنفس
 * الحمولات (finance.js:129/:210). زر التفاصيل في كل صف؛ رجوع للسجل.
 *
 * P1-3: إنشاء/تعديل/حذف الأقسام عبر الباب العام القائم (server.js) —
 * خلف علم v2deptwrite OFF افتراضيًا، وبحمولات legacy حرفًا
 * (features/departments.js:317/:334 + الحذف المتتابع :340). الحذف هنا
 * يمرّ بتأكيدين كما في القديم (confirm ثم كتابة «حذف») لأن PostgreSQL
 * يحذف إيرادات/مصاريف القسم تتابعيًا — لا رجعة.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.169';
import { fetchDepartments, fetchRevenues, fetchExpenses, calcDeptStats } from '../data/finance-repo.js?v=4.9.169';
import { formatInt, formatMoney, fetchCurrency } from '../data/reports-repo.js?v=4.9.169';
import { canWrite } from '../session.js?v=4.9.169';
import { departmentWriteEnabled, deptCashierWriteEnabled } from '../write-flags.js?v=4.9.169';
import {
    DEPARTMENT_WRITE_ROLES, DEPARTMENT_ICON_OPTIONS,
    validateDepartmentForm, createDepartment, updateDepartment, deleteDepartment,
    normalizeDepartmentIcon,
} from '../data/departments-write-repo.js?v=4.9.169';
import {
    DEPT_CASHIER_WRITE_ROLES, fetchDeptCashierLinks, deptLinkRows, deptCashierNos,
    deptNameOf, validateLinkForm, createDeptCashierLink, deleteDeptCashierLink,
    updateDeptCashierLink,
} from '../data/dept-cashier-repo.js?v=4.9.169';
import {
    cashierRevenueIn, deptIdentityColor,
    computeDeptDetail, fetchDeptDetailBundle, createRevenue, createExpense,
} from '../data/dept-detail.js?v=4.9.169';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* ترتيب عائلي: الأب أولاً ثم أبناؤه باسمهم، بمقارن عربي — الأبناء اللي أبهم
   مفقود من السجل يظهر سطرهم بشارة تحذير بدل كود خام. */
const AR_COLLATOR = new Intl.Collator('ar', { numeric: true });
function familyOrder(list) {
    const byCode = new Map(list.map((d) => [String(d.code), d]));
    const kidsOf = (code) => list.filter((d) => String(d.parent_code || '') === code);
    const byName = (a, b) => AR_COLLATOR.compare(String(a.name || ''), String(b.name || ''));
    const out = [];
    const roots = list.filter((d) => !d.parent_code || !byCode.has(String(d.parent_code)));
    for (const root of roots.slice().sort(byName)) {
        out.push(root);
        for (const kid of kidsOf(String(root.code)).sort(byName)) { out.push(kid); }
    }
    for (const d of list) { if (!out.includes(d)) { out.push(d); } }
    return out;
}

/* مفاتيح الأيقونات الحقيقية وقت التشغيل — تُحقن مرة واحدة عند التركيب. */
let KNOWN_ICON_KEYS = null;

function kpiHtml(label, value) {
    return `<li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">${esc(label)}</span></div><div class="erp-kpi__value">${esc(value)}</div></li>`;
}

/** شريحة أيقونة القسم: دائرة ملوّنة بلون الهوية + الأيقونة (SVG أو تعبية). */
function deptIconHtml(r) {
    const key = normalizeDepartmentIcon(r.icon, KNOWN_ICON_KEYS);
    const color = String(r.color || '#64748b');
    const isEmoji = !/^[a-z0-9-]+$/.test(key);
    const inner = isEmoji
        ? `<span class="erp-dept-ico__emoji">${esc(key)}</span>`
        : `<i class="ji" data-i="${esc(key)}" aria-hidden="true"></i>`;
    return `<span class="erp-dept-ico" style="background:${esc(color)}" title="${esc(key)}">${inner}</span>`;
}

/** أيقونات CARDS: مفتاح lucide/تعبية → ثيم البطاقة (النمط، لا اللون). */
const DEPT_THEME_BY_ICON = {
    'chef-hat': 'rings', 'flame': 'chevron', 'hot_kitchen': 'chevron', 'cooking-pot': 'chevron',
    'beef': 'stripes', 'drumstick': 'stripes', 'fish': 'stripes', 'butcher': 'stripes',
    'coffee': 'dots', 'cup-soda': 'dots', 'salad': 'dots', 'leaf': 'dots',
    'bread': 'grid', 'cake': 'grid', 'rice': 'grid', 'utensils': 'grid',
    'package': 'grid', 'archive': 'grid', 'warehouse': 'grid', 'store': 'dots',
    'external': 'chevron', 'receipt': 'stripes', 'banknote': 'rings', 'chart': 'rings',
    'users': 'dots', 'building': 'rings', 'scale': 'grid', 'barcode': 'stripes',
    'shopping-cart': 'chevron', 'clipboard-list': 'grid', 'tree': 'dots',
};
const DEPT_THEME_CYCLE = ['rings', 'dots', 'stripes', 'grid', 'chevron'];

/**
 * ثيم القسم: من أيقونته، وإلا دوران ثابت على الأنماط بكود القسم — فالبطاقات
 * تتمايز شكلًا بلا أي بيانات جديدة في القاعدة.
 */
export function deptThemeOf(row) {
    const key = normalizeDepartmentIcon(row && row.icon, KNOWN_ICON_KEYS);
    if (DEPT_THEME_BY_ICON[key]) {return DEPT_THEME_BY_ICON[key];}
    const code = String((row && row.code) || '');
    let hash = 0;
    for (let i = 0; i < code.length; i += 1) {hash = (hash * 31 + code.charCodeAt(i)) % 997;}
    return DEPT_THEME_CYCLE[hash % DEPT_THEME_CYCLE.length];
}

// مرآة الخادم: openWriteRoles على revenues/expenses = admin|manager|accountant
// (backend/schema-registry.js:772-773 — getEntityWriteRoles في server.js:1769/2021/2264).
// accountant كان ناقصًا هنا فتُحجب زرّا «إيراد +/مصروف +» وهو يملكهما عند
// الخادم فعلًا — P1-2 «تصحيح أدوار» = مواءمة الزرّ لا تغيير قاعدة.
const FIN_WRITE_ROLES = ['admin', 'manager', 'accountant'];

function fD(v) {
    if (!v) {return '—';}
    const d = new Date(`${String(v).slice(0, 10)}T12:00:00`);
    return Number.isNaN(d.getTime()) ? String(v).slice(0, 10)
        : d.toLocaleDateString('ar-EG', { day: '2-digit', month: 'short', year: 'numeric' });
}

function money(v, cur) {
    const m = formatMoney(v, cur);
    return `<span class="erp-num" dir="ltr">${esc(m.amount)}</span>${m.hasUnit ? ` <span class="erp-text-sm erp-text-muted">${esc(m.unit)}</span>` : ''}`;
}

function template(canManage) {
    return '<div class="erp-v2-departments-wrap">'
        + '<section class="erp-card erp-v2-departments">'
        + '<div class="erp-print-head" data-v2-print-head></div>'
        + '<div class="erp-card__head"><h3 class="erp-card__title">الأقسام <span class="erp-eyebrow" dir="ltr" lang="en">Departments</span> <span class="erp-text-muted erp-text-sm" data-v2-count></span></h3>'
        + '<span class="erp-grow"></span>'
        + (canManage ? '<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-dept-add><i class="ji" data-i="plus" aria-hidden="true"></i><span>إضافة قسم</span></button>' : '')
        + '<button type="button" class="erp-btn erp-btn--sm" data-v2-print><i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span></button>'
        + '<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload><i class="ji" data-i="refresh" aria-hidden="true"></i><span>عرض</span></button>'
        + '</div>'
        + '<div class="erp-card__body erp-stack">'
        + '<ul class="erp-kpis erp-dept-kpis" data-v2-kpis hidden></ul>'
        + '<div class="erp-dept-switch" role="group" aria-label="طريقة عرض الأقسام">'
        + '<button type="button" data-v2-view="cards" aria-pressed="true"><i class="ji" data-i="store" aria-hidden="true"></i><span>بطاقات</span></button>'
        + '<button type="button" data-v2-view="table" aria-pressed="false"><i class="ji" data-i="clipboard-list" aria-hidden="true"></i><span>جدول</span></button>'
        + '</div>'
        + '<p class="erp-text-sm erp-text-muted" data-v2-summary role="status" aria-live="polite"></p>'
        + '<div data-v2-dept-form></div>'
        + '<ul class="erp-dept-grid" data-v2-cards></ul>'
        + '<div data-v2-table></div></div></section>'
        + '<div data-v2-detail></div></div>';
}

export function mountDepartmentsScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 departments]', m);
    const confirmFn = typeof ctx.confirmFn === 'function' ? ctx.confirmFn
        : (m) => (typeof window !== 'undefined' && window.confirm ? window.confirm(m) : false);
    const canPost = canWrite(ctx.role, FIN_WRITE_ROLES);
    const canManage = canWrite(ctx.role, DEPARTMENT_WRITE_ROLES) && departmentWriteEnabled();
    const canLink = canWrite(ctx.role, DEPT_CASHIER_WRITE_ROLES) && deptCashierWriteEnabled();

    let rows = [];
    let loading = false;
    let saving = false;
    let editingDept = null;
    let bundle = null;
    let detailCode = null;
    let detailFrom = '';
    let detailTo = '';
    let currency = '';
    /* بطاقة الأقسام (2026-10-19): مصفوفة الإيراد/المصروف للبطاقات + روابط الكاشير */
    let revenues = [];
    let expenses = [];
    let links = [];
    let linksLoaded = false;
    let view = 'cards';
    let linkingCode = '';

    host.insertAdjacentHTML('beforeend', template(canManage));
    const el = host.lastElementChild;
    const q = (s) => el.querySelector(s);
    const countEl = q('[data-v2-count]');
    const summaryEl = q('[data-v2-summary]');

    /* مفاتيح الأيقونات الحقيقية — تُحقن مرة واحدة عند التركيب (icons.js محمّل في v2.html). */
    if (typeof window !== 'undefined' && window.KARIM_ICONS) {
        KNOWN_ICON_KEYS = new Set(Object.keys(window.KARIM_ICONS));
    }

    /** كود القسم → اسمه (لعرض اسم الأب بدل الكود الخام). */
    const parentNameOf = (code) => {
        if (!code) {return '';}
        const p = rows.find((d) => String(d.code) === String(code));
        return p ? String(p.name) : String(code);
    };

    const table = createDataTable({
        caption: 'سجل الأقسام — بيانات حية', mode: 'client', pageSize: 50, stickyHeader: true,
        emptyMessage: 'لا توجد أقسام مسجلة', rowKey: (r) => r.id,
        columns: [
            {
                key: 'name', header: 'القسم', sortable: true, filterable: true,
                value: (r) => `${r.code || ''} ${r.name || ''}`,
                render: (r) => `<span class="erp-dept-identity">${deptIconHtml(r)}`
                    + `<span class="erp-dept-identity__body">`
                    + `<span class="erp-dept-identity__name">${esc(String(r.name))}</span>`
                    + `<span class="erp-dept-identity__code erp-mono" dir="ltr">${esc(String(r.code))}</span>`
                    + `</span></span>`,
            },
            {
                key: 'parent_code', header: 'القسم الأب', width: '170px',
                value: (r) => parentNameOf(r.parent_code),
                render: (r) => (!r.parent_code
                    ? '<span class="erp-badge" data-tone="neutral">رئيسي</span>'
                    : (rows.some((d) => String(d.code) === String(r.parent_code))
                        ? `<span class="erp-dept-parent" title="${esc(String(r.parent_code))}">${esc(parentNameOf(r.parent_code))}</span>`
                        : `<span class="erp-badge" data-tone="warning" title="كود الأب ${esc(String(r.parent_code))} غير موجود في السجل — قرار التصحيح للخادم">مرجع مفقود · <span class="erp-mono" dir="ltr">${esc(String(r.parent_code))}</span></span>`)),
            },
            {
                key: 'color', header: 'اللون', width: '70px', align: 'center',
                render: (r) => (r.color
                    ? `<span class="erp-dept-swatch" style="background:${esc(String(r.color))}" title="${esc(String(r.color))}"></span>`
                    : '<span class="erp-text-muted">—</span>'),
            },
            {
                key: 'detail', header: 'تفاصيل', width: '110px', align: 'center',
                render: (r) => `<button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-detail="${esc(String(r.code))}"><i class="ji" data-i="eye" aria-hidden="true"></i><span>فتح</span></button>`,
            },
            ...(canManage ? [{
                key: 'actions', header: 'إجراءات', width: '170px', align: 'center', className: 'erp-no-print',
                render: (r) => '<span class="erp-row-wrap">'
                    + `<button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-dept-edit="${esc(String(r.id))}"><i class="ji" data-i="pencil" aria-hidden="true"></i><span>تعديل</span></button>`
                    + `<button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-dept-del="${esc(String(r.id))}"><i class="ji" data-i="trash" aria-hidden="true"></i><span>حذف</span></button>`
                    + '</span>',
            }] : []),
        ],
    });
    q('[data-v2-table]').appendChild(table.el);

    /** ميدالية أيقونة البطاقة (أكبر من شريحة الجدول، وبلون الهوية المتدرج). */
    function deptMedalHtml(r) {
        const key = normalizeDepartmentIcon(r.icon, KNOWN_ICON_KEYS);
        const isEmoji = !/^[a-z0-9-]+$/.test(key);
        const inner = isEmoji
            ? `<span class="erp-dept-medal__emoji">${esc(key)}</span>`
            : `<i class="ji" data-i="${esc(key)}" aria-hidden="true"></i>`;
        return `<span class="erp-dept-medal" aria-hidden="true">${inner}</span>`;
    }

    /** إحصاءات البطاقة بنفس حساب القديم (features/departments.js:92-96): إيراد
     *  القسم + إيراد كاشيراته المسندة، ومصروف أذون الصرف والحركات، والصافي. */
    function deptCardStats(r, nos) {
        const s = calcDeptStats(revenues, expenses, rows, String(r.code), null, null);
        const cashRev = nos.length ? cashierRevenueIn(revenues, nos, null, null) : 0;
        const rev = s.rev + cashRev;
        return {
            rev, exp: s.exp, profit: rev - s.exp,
            costRatio: rev > 0 ? (s.exp / rev) * 100 : 0,
        };
    }

    function deptStatCell(label, iconKey, value, extraClass) {
        return `<span class="erp-dept-stat ${extraClass}">`
            + `<span class="erp-dept-stat__label"><i class="ji" data-i="${esc(iconKey)}" aria-hidden="true"></i>${esc(label)}</span>`
            + `<span class="erp-dept-stat__value">${money(value, currency)}</span></span>`;
    }

    /** شارة كاشير على البطاقة — أساسي بنجمة، ثانوي بحد منقّط، الوارث باسم قسمه. */
    function deptCashierChip(l) {
        const rev = cashierRevenueIn(revenues, [l.cashierNo], null, null);
        const owner = l.inherited ? ` · ${esc(deptNameOf(l.deptCode, rows))}` : '';
        return `<span class="erp-dept-cashier${l.isPrimary ? '' : ' is-secondary'}" title="كاشير ${esc(l.cashierNo)}${owner}">`
            + `<i class="ji" data-i="receipt" aria-hidden="true"></i>كاشير <span class="erp-mono" dir="ltr">${esc(l.cashierNo)}</span>`
            + `${l.isPrimary ? '<span class="erp-dept-cashier__star" title="الكاشير الأساسي للقسم">★</span>' : ''}`
            + (rev ? `<span class="erp-dept-cashier__amount erp-num" dir="ltr">${formatInt(rev)}</span>` : '')
            + `${owner}</span>`;
    }

    /** لوحة ربط الكاشير داخل البطاقة (تحت علم v2deptcashier وحده). */
    function deptLinkPanelHtml(code) {
        const rowsOfDept = deptLinkRows(code, links, rows);
        const known = deptCashierNos(code, {links, departments: rows});
        const list = rowsOfDept.length
            ? rowsOfDept.map((l) => `<div class="erp-dept-link-row">`
                + `<span class="erp-dept-link-row__name">كاشير <span class="erp-mono" dir="ltr">${esc(l.cashierNo)}</span>`
                + (l.inherited ? ` <span class="erp-badge" data-tone="neutral">من ${esc(deptNameOf(l.deptCode, rows))}</span>` : '')
                + `</span>`
                + (l.isPrimary ? '<span class="erp-badge" data-tone="brand">أساسي</span>'
                    : `<button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-link-primary="${esc(String(l.id))}"><span>تعيين أساسي</span></button>`)
                + `<button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-link-del="${esc(String(l.id))}" data-v2-link-dept="${esc(code)}"><i class="ji" data-i="trash" aria-hidden="true"></i><span>إزالة</span></button>`
                + `</div>`).join('')
            : '<p class="erp-text-sm erp-text-muted">لا روابط محفوظة لهذا القسم بعد.</p>';
        return `<div class="erp-dept-link-panel" data-v2-link-panel>`
            + `<div class="erp-dept-link-panel__title"><i class="ji" data-i="users" aria-hidden="true"></i>كاشيرات القسم`
            + `<span class="erp-text-sm erp-text-muted">${known.source === 'db' ? 'من قاعدة البيانات' : 'من الخريطة المدمجة (لم تُحفظ روابط بعد)'}</span></div>`
            + list
            + `<div class="erp-dept-link-form">`
            + `<label class="erp-text-sm erp-text-muted">رقم الكاشير<input class="erp-input erp-input--ltr" data-v2-link-no inputmode="numeric" maxlength="6" placeholder="مثال: 12"></label>`
            + `<label class="erp-dept-check"><input type="checkbox" data-v2-link-primary-flag><span>كاشير أساسي</span></label>`
            + `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-link-add="${esc(code)}"><i class="ji" data-i="plus" aria-hidden="true"></i><span>ربط</span></button>`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-link-x><span>إغلاق</span></button>`
            + `</div>`
            + `<div class="erp-text-sm" style="color:var(--erp-danger-text)" data-v2-link-err role="alert"></div>`
            + `</div>`;
    }

    function deptCardHtml(r) {
        const code = String(r.code);
        const accent = deptIdentityColor(r);
        const link = deptCashierNos(code, {links, departments: rows});
        const s = deptCardStats(r, link.nos);
        const linkRows = deptLinkRows(code, links, rows);
        const chips = linkRows.length
            ? linkRows.map((l) => deptCashierChip(l)).join('')
            : (link.nos.length
                ? link.nos.map((no) => deptCashierChip({cashierNo: no, isPrimary: true, deptCode: code, inherited: false})).join('')
                : '<span class="erp-dept-card__unassigned">بلا كاشير مسند — اربطه من «ربط كاشير»</span>');
        const parent = rows.find((d) => String(d.code) === String(r.parent_code));
        const kids = rows.filter((d) => String(d.parent_code || '') === code).length;
        const netClass = s.profit >= 0 ? 'is-positive' : 'is-negative';
        const ratioPct = Math.max(0, Math.min(100, s.costRatio));
        const expanded = linkingCode === code;
        return `<li class="erp-dept-card${expanded ? ' is-expanded' : ''}" data-dept-theme="${esc(deptThemeOf(r))}"`
            + ` style="--dept-accent:${esc(accent)}" data-v2-dept-code="${esc(code)}">`
            + '<span class="erp-dept-card__rail" aria-hidden="true"></span>'
            + `<div class="erp-dept-card__head">${deptMedalHtml(r)}`
            + `<div class="erp-dept-card__titles">`
            + `<span class="erp-dept-card__name">${esc(String(r.name))}</span>`
            + `<span class="erp-dept-card__meta">`
            + `<span class="erp-dept-card__code erp-mono" dir="ltr">${esc(code)}</span>`
            + (parent ? `<span class="erp-dept-parent" title="${esc(String(parent.code))}">${esc(String(parent.name))}</span>`
                : '<span class="erp-badge" data-tone="neutral">قسم رئيسي</span>')
            + (kids ? `<span class="erp-badge" data-tone="info">${formatInt(kids)} قسم فرعي</span>` : '')
            + '</span></span></div>'
            + `<div class="erp-dept-card__stats">`
            + deptStatCell('الإيراد', 'banknote', s.rev, 'erp-dept-stat--rev')
            + deptStatCell('المصروف', 'package', s.exp, 'erp-dept-stat--exp')
            + `<span class="erp-dept-stat erp-dept-stat--net"><span class="erp-dept-stat__label"><i class="ji" data-i="gem" aria-hidden="true"></i>الصافي</span>`
            + `<span class="erp-dept-stat__value ${netClass}">${money(s.profit, currency)}</span></span>`
            + '</div>'
            + `<div class="erp-dept-card__ratio${s.costRatio > 100 ? ' is-high' : ''}">`
            + `<span class="erp-dept-card__ratio-track"><span class="erp-dept-card__ratio-fill" style="width:${ratioPct.toFixed(1)}%"></span></span>`
            + `<span class="erp-dept-card__ratio-label">نسبة التكلفة <span class="erp-num" dir="ltr">${formatInt(Math.round(s.costRatio))}%</span></span>`
            + '</div>'
            + `<div class="erp-dept-card__cashiers">${chips}</div>`
            + `<div class="erp-dept-card__foot">`
            + `<button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-detail="${esc(code)}"><i class="ji" data-i="eye" aria-hidden="true"></i><span>تفاصيل</span></button>`
            + (canLink ? `<button type="button" class="erp-btn erp-btn--sm" data-v2-link="${esc(code)}"><i class="ji" data-i="users" aria-hidden="true"></i><span>${expanded ? 'إغلاق الربط' : 'ربط كاشير'}</span></button>` : '')
            + '<span class="erp-grow"></span>'
            + (canManage
                ? `<button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-dept-edit="${esc(String(r.id))}"><i class="ji" data-i="pencil" aria-hidden="true"></i><span>تعديل</span></button>`
                    + `<button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-dept-del="${esc(String(r.id))}"><i class="ji" data-i="trash" aria-hidden="true"></i><span>حذف</span></button>`
                : '')
            + '</div>'
            + (expanded ? deptLinkPanelHtml(code) : '')
            + '</li>';
    }

    function paintCards() {
        const holder = q('[data-v2-cards]');
        if (!holder) {return;}
        holder.innerHTML = rows.length
            ? familyOrder(rows).map(deptCardHtml).join('')
            : '<li class="erp-dept-empty">لا توجد أقسام مسجلة بعد — أضف قسمًا من زر «إضافة قسم».</li>';
    }

    function applyView() {
        const cards = q('[data-v2-cards]');
        const tableHolder = q('[data-v2-table]');
        if (cards) {cards.hidden = view !== 'cards';}
        if (tableHolder) {tableHolder.hidden = view !== 'table';}
        el.querySelectorAll('[data-v2-view]').forEach((b) => {
            b.setAttribute('aria-pressed', String(b.dataset.v2View === view));
        });
        if (view === 'cards') {paintCards();}
    }

    /** مصاريع البطاقات — تُحمّل بعد السجل وتفشل بصمت. */
    async function loadCardData() {
        try {
            const [rev, exp] = await Promise.all([fetchRevenues(), fetchExpenses()]);
            if (!el.isConnected) {return;}
            revenues = rev;
            expenses = exp;
        } catch { /* المؤشرات تبقى في لوحة التفاصيل */ }
        try {
            links = await fetchDeptCashierLinks();
            linksLoaded = true;
        } catch {
            /* جدول 103 غير مطبَّق بعد في هذه البيئة: الروابط صفر، والخريطة
               المدمجة تكفل أرقامًا مطابقة للقديم بدل صف فارغ. */
            links = [];
            linksLoaded = false;
        }
        if (el.isConnected && view === 'cards') {paintCards();}
    }

    /* ── ربط الكاشير (جدول 103) — خلف علم v2deptcashier والدور معًا ── */
    function linkFail(message) {
        const box = q('[data-v2-link-err]');
        if (box) {box.textContent = message;}
        notify(message);
    }

    function addLink(code) {
        if (saving) {return;}
        const v = validateLinkForm({
            dept_code: code,
            cashier_no: q('[data-v2-link-no]')?.value ?? '',
            is_primary: !!q('[data-v2-link-primary-flag]')?.checked,
        });
        if (!v.ok) {linkFail(v.message); return;}
        if (deptLinkRows(code, links, rows).some((l) => l.cashierNo === v.payload.cashier_no)) {
            linkFail('الكاشير مربوط بهذا القسم بالفعل');
            return;
        }
        saving = true;
        createDeptCashierLink(v.payload).then(() => {
            if (!el.isConnected) {return;}
            notify(`تم ربط كاشير ${v.payload.cashier_no} بالقسم`);
            bundle = null;
            reload();
        }).catch((e) => {
            if (el.isConnected) {linkFail((e && e.message) || 'فشل حفظ الربط في قاعدة البيانات');}
        }).finally(() => {saving = false;});
    }

    function removeLink(id) {
        if (saving) {return;}
        const ok = confirmFn('إزالة هذا الكاشير من القسم؟ الإيراد التاريخي لا يتغير — يتغير إسنادُه في البطاقة فقط.');
        if (!ok) {return;}
        saving = true;
        deleteDeptCashierLink(id).then(() => {
            if (!el.isConnected) {return;}
            notify('تمت إزالة الربط');
            bundle = null;
            reload();
        }).catch((e) => {
            if (el.isConnected) {linkFail((e && e.message) || 'فشل حذف الربط من قاعدة البيانات');}
        }).finally(() => {saving = false;});
    }

    function setLinkPrimary(id) {
        if (saving) {return;}
        saving = true;
        updateDeptCashierLink(id, {is_primary: true}).then(() => {
            if (!el.isConnected) {return;}
            notify('تم تعيين الكاشير الأساسي — أُخفّض الباقِ تلقائيًا');
            bundle = null;
            reload();
        }).catch((e) => {
            if (el.isConnected) {linkFail((e && e.message) || 'فشل التعيين في قاعدة البيانات');}
        }).finally(() => {saving = false;});
    }

    function paint() {
        const total = rows.length;
        summaryEl.textContent = formatInt(total) + ' قسمًا';
        countEl.textContent = total ? '(' + formatInt(total) + ')' : '';
        const roots = rows.filter((d) => !d.parent_code).length;
        const groups = new Set(rows.filter((d) => d.parent_code).map((d) => String(d.parent_code))).size;
        const kpiEl = q('[data-v2-kpis]');
        kpiEl.innerHTML = !total ? '' : kpiHtml('إجمالي الأقسام', formatInt(total))
            + kpiHtml('أقسام رئيسية', formatInt(roots))
            + kpiHtml('أقسام فرعية', formatInt(total - roots))
            + kpiHtml('مجموعات أبوية', formatInt(groups));
        kpiEl.hidden = !total;
        const issued = new Date().toLocaleDateString('ar-EG', { day: '2-digit', month: 'long', year: 'numeric' });
        q('[data-v2-print-head]').innerHTML = !total ? '' : '<div class="erp-print-head__title">سجل الأقسام</div>'
            + `<div class="erp-print-head__meta">إجمالي ${formatInt(total)} قسمًا — رئيسي ${formatInt(roots)} · فرعي ${formatInt(total - roots)} · صادر في ${esc(issued)}</div>`;
        table.setRows(familyOrder(rows));
        applyView();
    }

    async function reload() {
        if (loading) {return;}
        loading = true;
        table.setLoading(true);
        try {
            const [depts, cur] = await Promise.all([
                fetchDepartments(), fetchCurrency().catch(() => ''),
            ]);
            if (!el.isConnected) {return;}
            rows = depts;
            currency = String(cur ?? '');
            paint();
            /* أرقام البطاقات والروابط تُحمّل بعد الرسم: السجل والأقسام تظهر فورًا،
               والمؤشرات تُكمل البطاقات حين تصل. الروابط تُترك صفرًا بأمان إن لم
               يكن جدول 103 مطبَّقًا بعد (fallback الخريطة يضمن نفس أرقام القديم). */
            loadCardData();
            if (detailCode) {await openDetail(detailCode, false);}
        } catch (e) {
            if (!el.isConnected) {return;}
            rows = [];
            table.setRows([]);
            summaryEl.textContent = '';
            countEl.textContent = '';
            table.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN' ? 'لا صلاحية لعرض الأقسام — القرار للخادم وحده.'
                    : 'تعذّر تحميل الأقسام: ' + ((e && e.message) || 'خطأ')));
        } finally {loading = false;}
    }

    /* ── P1-3: نموذج القسم (حمولات legacy) ─────────────────────────── */
    function openDeptForm(row) {
        editingDept = row || null;
        const holder = q('[data-v2-dept-form]');
        if (!holder) {return;}
        const currentIcon = normalizeDepartmentIcon(row && row.icon, KNOWN_ICON_KEYS);
        const iconOpts = DEPARTMENT_ICON_OPTIONS.slice();
        if (!iconOpts.some(([v]) => v === currentIcon)) {iconOpts.push([currentIcon, currentIcon]);}
        const parents = rows
            .filter((d) => !row || String(d.code) !== String(row.code))
            .map((d) => `<option value="${esc(d.code)}" ${row && String(row.parent_code) === String(d.code) ? 'selected' : ''}>${esc(d.name)} (${esc(d.code)})</option>`)
            .join('');
        holder.innerHTML = `<section class="erp-card"><div class="erp-card__head">`
            + `<h4 class="erp-card__title">${row ? 'تعديل قسم — ' + esc(row.name) : 'إضافة قسم'}</h4></div>`
            + `<div class="erp-card__body erp-stack"><div class="erp-dash-controls">`
            + `<label class="erp-text-sm erp-text-muted">اسم القسم<input class="erp-input" data-v2-d-name maxlength="255" value="${row ? esc(row.name) : ''}"></label>`
            + (row
                ? `<span class="erp-badge" data-tone="neutral">الكود: <span class="erp-mono" dir="ltr">${esc(row.code)}</span></span>`
                : '<label class="erp-text-sm erp-text-muted">الكود (3 أحرف)<input class="erp-input erp-input--ltr" data-v2-d-code maxlength="3" value=""></label>')
            + `<label class="erp-text-sm erp-text-muted">الأيقونة<select class="erp-select" data-v2-d-icon>`
            + iconOpts.map(([v, label]) => `<option value="${esc(v)}" ${v === currentIcon ? 'selected' : ''}>${esc(label)}</option>`).join('')
            + `</select></label>`
            + (row ? '' : `<label class="erp-text-sm erp-text-muted">اللون<input class="erp-input erp-input--ltr" type="color" data-v2-d-color value="#009688"></label>`)
            + `<label class="erp-text-sm erp-text-muted">القسم الأب<select class="erp-select" data-v2-d-parent><option value="">— قسم رئيسي (بلا أب) —</option>${parents}</select></label>`
            + `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-d-go>حفظ</button>`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-d-x>إلغاء</button>`
            + `</div><div class="erp-text-sm" style="color:var(--erp-danger-text)" data-v2-d-err role="alert"></div></div></section>`;
        holder.scrollIntoView({ block: 'nearest' });
    }

    function closeDeptForm() {
        editingDept = null;
        const holder = q('[data-v2-dept-form]');
        if (holder) {holder.innerHTML = '';}
    }

    function saveDept() {
        if (saving) {return;}
        const val = (n) => (q(`[data-v2-d-${n}]`)?.value ?? '');
        const v = validateDepartmentForm({
            name: val('name'), code: val('code'), icon: val('icon'),
            color: val('color'), parent_code: val('parent'),
        }, editingDept);
        const errBox = q('[data-v2-d-err]');
        const fail = (t) => { if (errBox) {errBox.textContent = t;} notify(t); };
        if (!v.ok) {fail(v.message); return;}
        if (!editingDept && rows.some((d) => String(d.code) === String(v.payload.code))) {
            fail('الكود موجود بالفعل');
            return;
        }
        saving = true;
        const call = editingDept ? updateDepartment(editingDept.id, v.payload) : createDepartment(v.payload);
        call.then(() => {
            if (!el.isConnected) {return;}
            notify(editingDept ? 'تم تحديث القسم' : 'تم إضافة القسم');
            closeDeptForm();
            bundle = null;
            reload();
        }).catch((e) => {
            if (el.isConnected) {fail((e && e.message) || 'فشل حفظ القسم في قاعدة البيانات');}
        }).finally(() => {saving = false;});
    }

    function removeDept(id) {
        const row = rows.find((r) => String(r.id) === String(id));
        if (!row || saving) {return;}
        const ok = confirmFn(`حذف القسم «${row.name}»؟ PostgreSQL سيحذف إيرادات ومصاريف هذا القسم معه تتابعيًا — لا رجعة.`);
        if (!ok) {return;}
        let typed = '';
        try {typed = typeof window !== 'undefined' && window.prompt ? (window.prompt('للتأكيد النهائي، اكتب: حذف') || '') : '';} catch { /* deny on blocked prompt */ }
        if (typed !== 'حذف') {notify('أُلغي الحذف'); return;}
        saving = true;
        deleteDepartment(row.id).then(() => {
            if (!el.isConnected) {return;}
            notify('تم حذف القسم');
            if (String(detailCode) === String(row.code)) {
                detailCode = '';
                q('[data-v2-detail]').innerHTML = '';
            }
            bundle = null;
            reload();
        }).catch((e) => {
            if (el.isConnected) {notify((e && e.message) || 'فشل حذف القسم من قاعدة البيانات');}
        }).finally(() => {saving = false;});
    }

    async function openDetail(code, scroll = true) {
        detailCode = code;
        const box = q('[data-v2-detail]');
        box.innerHTML = '<p class="erp-text-sm erp-text-muted">جارٍ تحميل التفاصيل…</p>';
        try {
            if (!bundle) {bundle = await fetchDeptDetailBundle();}
            if (!el.isConnected || detailCode !== code) {return;}
            const d = computeDeptDetail(bundle, code, detailFrom || null, detailTo || null);
            if (!d.found) {
                box.innerHTML = '<p class="erp-text-sm erp-text-muted">القسم غير موجود</p>';
                return;
            }
            paintDetail(d);
            if (scroll) {box.scrollIntoView({ block: 'nearest' });}
        } catch (e) {
            if (!el.isConnected || detailCode !== code) {return;}
            box.innerHTML = `<p class="erp-text-sm erp-text-muted">تعذّر التحميل: ${esc((e && e.message) || 'خطأ')}</p>`;
        }
    }

    function paintDetail(d) {
        const box = q('[data-v2-detail]');
        const { dept, breakdown: bd } = d;
        /* كاشيرات القسم: روابط 103 المحفوظة إن وُجدت، وإلا الخريطة المدمجة.
           المصادر لا تختلط: عند الروابط تُعاد حساب المؤشرات من نفس مصدر
           البطاقات، وعند الخريطة تبقى أرقام computeDeptDetail كما هي حرفيًا. */
        const linked = linksLoaded
            ? deptCashierNos(String(dept.code), {links, departments: rows})
            : {nos: d.cashNos, source: 'map'};
        let s = d.stats;
        if (linked.source === 'db') {
            const cashRev = linked.nos.length
                ? cashierRevenueIn(bundle.revenues, linked.nos, detailFrom || null, detailTo || null) : 0;
            const base = calcDeptStats(bundle.revenues, bundle.expenses, bundle.departments,
                String(dept.code), detailFrom || null, detailTo || null);
            s = {
                rev: base.rev + cashRev, exp: base.exp, profit: base.rev + cashRev - base.exp,
                costRatio: (base.rev + cashRev) > 0 ? (base.exp / (base.rev + cashRev)) * 100 : 0,
            };
        }
        const cashChips = linked.nos.map((no) => {
            const rev = cashierRevenueIn(bundle.revenues, [no], detailFrom || null, detailTo || null);
            return `<span class="erp-badge" data-tone="brand" title="إيراد كاشير ${esc(no)} المسند لهذا القسم">كاشير ${esc(no)}: <span class="erp-num" dir="ltr">${formatInt(rev)}</span></span>`;
        }).join(' ');
        const expKind = (e) => {
            const t = String(e.adjustmentType || e.adjustment_type || '').toLowerCase();
            if (t === 'count_correction') {return ['info', 'فرق جرد'];}
            if (['dispatch', 'dispatch_return', 'receipt', 'stock_transfer', 'inventory_transfer', 'kitchen_return'].includes(t)) {return ['warning', 'صرف مخزون'];}
            return ['neutral', 'تشغيلي'];
        };
        box.innerHTML = `<section class="erp-card"><div class="erp-card__head">`
            + `<h3 class="erp-card__title"><span style="display:inline-block;width:14px;height:14px;border-radius:4px;background:${esc(d.color)}"></span> ${esc(dept.name)} <span class="erp-text-muted erp-mono" dir="ltr">${esc(dept.code)}</span></h3>`
            + `<span class="erp-grow"></span>`
            + `<span class="erp-badge" data-tone="brand">نسبة التكلفة: <span class="erp-num" dir="ltr">${esc(Number(s.costRatio).toFixed(1))}%</span></span>`
            + `<button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-detail-x>رجوع للسجل</button></div>`
            + `<div class="erp-card__body erp-stack">`
            + `<div class="erp-dash-controls">`
            + `<label class="erp-text-sm erp-text-muted">من تاريخ</label><input class="erp-input erp-input--ltr" type="date" data-v2-dfrom value="${esc(detailFrom)}">`
            + `<label class="erp-text-sm erp-text-muted">إلى تاريخ</label><input class="erp-input erp-input--ltr" type="date" data-v2-dto value="${esc(detailTo)}">`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-dall>كل الفترة</button>`
            + `${(detailFrom || detailTo) ? `<span class="erp-badge" data-tone="info">${detailFrom ? `من ${esc(detailFrom)}` : 'كل الفترة'} ${detailTo ? `إلى ${esc(detailTo)}` : ''}</span>` : ''}`
            + `${cashChips ? `<span>${cashChips}</span>` : ''}`
            + `</div>`
            + `<ul class="erp-kpis">`
            + `<li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">الإيرادات</span></div><div class="erp-kpi__value">${money(s.rev, currency)}</div></li>`
            + `<li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">التكلفة الإجمالية</span></div><div class="erp-kpi__value">${money(s.exp, currency)}</div></li>`
            + `<li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">صافي الربح</span></div><div class="erp-kpi__value">${money(s.profit, currency)}</div></li>`
            + `</ul>`
            + `<ul class="erp-kpis">`
            + `<li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">صرف مخزون (صافي المرتجعات)</span></div><div class="erp-kpi__value">${money(bd.materials, currency)}</div><div class="erp-kpi__foot"><span class="erp-kpi__hint">كل ما صُرف للقسم من المخزن بقيمة المواد</span></div></li>`
            + `<li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">عجز / زيادة الجرد</span></div><div class="erp-kpi__value">${money(bd.countAdj, currency)}</div></li>`
            + `<li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">مصاريف تشغيلية</span></div><div class="erp-kpi__value">${money(bd.operating, currency)}</div></li>`
            + `</ul>`
            + `<div class="erp-dash-controls"><h4>آخر الإيرادات</h4><span class="erp-grow"></span>`
            + (canPost ? '<button type="button" class="erp-btn erp-btn--sm" data-v2-rev-add>إيراد +</button>' : '') + `</div>`
            + `<div class="erp-table__scroll"><table class="erp-table__grid"><thead><tr><th>البيان</th><th>المبلغ</th><th>التاريخ</th></tr></thead><tbody>`
            + (d.revenues.map((r) => `<tr><td class="erp-td"><b>${esc(r.source)}</b></td><td class="erp-td">${money(r.amount, currency)}</td><td class="erp-td erp-text-muted">${esc(fD(r.date))}</td></tr>`).join('')
                || '<tr><td class="erp-td" colspan="3">لا إيرادات</td></tr>')
            + `</tbody></table></div>`
            + `<div class="erp-dash-controls"><h4>آخر المصاريف</h4><span class="erp-grow"></span>`
            + (canPost ? '<button type="button" class="erp-btn erp-btn--sm" data-v2-exp-add>مصروف +</button>' : '') + `</div>`
            + `<div class="erp-table__scroll"><table class="erp-table__grid"><thead><tr><th>البيان</th><th>النوع</th><th>المبلغ</th><th>التاريخ</th></tr></thead><tbody>`
            + (d.expenses.map((e) => {
                const [tone, label] = expKind(e);
                const neg = Number(e.amount || 0) < 0;
                return `<tr><td class="erp-td"><b>${esc(e.desc)}</b></td><td class="erp-td"><span class="erp-badge" data-tone="${tone}">${label}</span></td><td class="erp-td" style="color:${neg ? 'var(--erp-success-text)' : 'var(--erp-danger-text)'}"><b>${money(e.amount, currency)}</b></td><td class="erp-td erp-text-muted">${esc(fD(e.date))}</td></tr>`;
            }).join('') || '<tr><td class="erp-td" colspan="4">لا مصاريف</td></tr>')
            + `</tbody></table></div>`
            + `<h4>أذون الصرف للقسم <span class="erp-badge" data-tone="info">${formatInt(d.dispatches.length)} إذن</span></h4>`
            + `<div class="erp-table__scroll"><table class="erp-table__grid"><thead><tr><th>#</th><th>الأصناف</th><th>التاريخ</th><th>الحالة</th></tr></thead><tbody>`
            + (d.dispatches.map((x, i) => `<tr><td class="erp-td erp-num" dir="ltr">${i + 1}</td><td class="erp-td">${esc((x.items || []).map((it) => `${it.itemName || it.name || '—'} (${it.approvedQty ?? it.qty ?? 0})`).join('، ') || '—')}</td><td class="erp-td erp-text-muted">${esc(fD(x.date))}</td><td class="erp-td">${esc(x.status || '—')}</td></tr>`).join('')
                || '<tr><td class="erp-td" colspan="4">لا أذون صرف لهذا القسم</td></tr>')
            + `</tbody></table></div>`
            + `<div data-v2-detail-form></div>`
            + `</div></section>`;
    }

    function openMoneyForm(kind) {
        const holder = q('[data-v2-detail-form]');
        if (!holder || !detailCode) {return;}
        const isRev = kind === 'rev';
        holder.innerHTML = `<div class="erp-dash-controls">`
            + `<label class="erp-text-sm erp-text-muted">${isRev ? 'المصدر' : 'البيان'}</label>`
            + `<input class="erp-input" data-v2-m="label">`
            + `<label class="erp-text-sm erp-text-muted">المبلغ</label>`
            + `<input class="erp-input erp-input--ltr" data-v2-m="amount" type="number" step="0.01">`
            + `<label class="erp-text-sm erp-text-muted">التاريخ</label>`
            + `<input class="erp-input erp-input--ltr" data-v2-m="date" type="date" value="${new Date().toISOString().slice(0, 10)}">`
            + (!isRev ? `<label class="erp-text-sm erp-text-muted">الفئة</label><select class="erp-select" data-v2-m="category"><option>مواد خام</option><option>رواتب</option><option>تشغيل</option><option>أخرى</option></select>` : '')
            + `<label class="erp-text-sm erp-text-muted">ملاحظات</label>`
            + `<input class="erp-input" data-v2-m="notes">`
            + `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-m-go="${kind}">حفظ</button>`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-m-x>إلغاء</button></div>`
            + `<div class="erp-text-sm" style="color:var(--erp-danger-text)" data-v2-m-err role="alert"></div>`;
        holder.scrollIntoView({ block: 'nearest' });
    }

    el.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-v2-print]')) {window.print(); return;}
        if (ev.target.closest('[data-v2-reload]') || ev.target.closest('[data-erp-retry]')) {
            bundle = null;
            reload();
            return;
        }
        if (ev.target.closest('[data-v2-dept-add]')) {openDeptForm(null); return;}
        const viewBtn = ev.target.closest('[data-v2-view]');
        if (viewBtn) {
            view = viewBtn.dataset.v2View === 'table' ? 'table' : 'cards';
            applyView();
            return;
        }
        const linkBtn = ev.target.closest('[data-v2-link]');
        if (linkBtn) {
            const code = String(linkBtn.dataset.v2Link);
            linkingCode = linkingCode === code ? '' : code;
            paintCards();
            const panel = q('[data-v2-link-panel]');
            if (panel) {panel.scrollIntoView({block: 'nearest'});}
            return;
        }
        if (ev.target.closest('[data-v2-link-x]')) {linkingCode = ''; paintCards(); return;}
        const addBtn = ev.target.closest('[data-v2-link-add]');
        if (addBtn) {addLink(addBtn.dataset.v2LinkAdd); return;}
        const linkDel = ev.target.closest('[data-v2-link-del]');
        if (linkDel) {removeLink(linkDel.dataset.v2LinkDel); return;}
        const linkPrimary = ev.target.closest('[data-v2-link-primary]');
        if (linkPrimary) {setLinkPrimary(linkPrimary.dataset.v2LinkPrimary); return;}
        const editBtn = ev.target.closest('[data-v2-dept-edit]');
        if (editBtn) {
            const row = rows.find((r) => String(r.id) === String(editBtn.dataset.v2DeptEdit));
            if (row) {openDeptForm(row);}
            return;
        }
        const delBtn = ev.target.closest('[data-v2-dept-del]');
        if (delBtn) {removeDept(delBtn.dataset.v2DeptDel); return;}
        if (ev.target.closest('[data-v2-d-x]')) {closeDeptForm(); return;}
        if (ev.target.closest('[data-v2-d-go]')) {saveDept(); return;}
        const det = ev.target.closest('[data-v2-detail]');
        if (det && det.dataset.v2Detail) {openDetail(det.dataset.v2Detail); return;}
        if (ev.target.closest('[data-v2-detail-x]')) {
            detailCode = '';
            detailFrom = '';
            detailTo = '';
            q('[data-v2-detail]').innerHTML = '';
            return;
        }
        if (ev.target.closest('[data-v2-dall]')) {
            detailFrom = '';
            detailTo = '';
            openDetail(detailCode, false);
            return;
        }
        if (ev.target.closest('[data-v2-rev-add]')) {openMoneyForm('rev'); return;}
        if (ev.target.closest('[data-v2-exp-add]')) {openMoneyForm('exp'); return;}
        if (ev.target.closest('[data-v2-m-x]')) {
            q('[data-v2-detail-form]').innerHTML = '';
            return;
        }
        const go = ev.target.closest('[data-v2-m-go]');
        if (go) {
            if (saving) {return;}
            const kind = go.dataset.v2MGo;
            const v = (n) => el.querySelector(`[data-v2-m="${n}"]`)?.value ?? '';
            const errBox = el.querySelector('[data-v2-m-err]');
            const fail = (t) => { if (errBox) {errBox.textContent = t;} notify(t); };
            if (kind === 'rev') {
                const label = v('label').trim();
                const amount = parseFloat(v('amount'));
                if (!label || !(amount > 0)) {fail('بيانات غير صحيحة'); return;}
                saving = true;
                createRevenue({ deptId: detailCode, amount, date: v('date'), source: label, notes: v('notes').trim() })
                    .then(() => {
                        if (!el.isConnected) {return;}
                        bundle = null;
                        notify('تم إضافة الإيراد');
                        reload();
                    })
                    .catch((e) => { if (el.isConnected) {fail((e && e.message) || 'فشل حفظ الإيراد في قاعدة البيانات');} })
                    .finally(() => {saving = false;});
            } else {
                const label = v('label').trim();
                const amount = parseFloat(v('amount'));
                if (!label || !(amount > 0)) {fail('بيانات غير صحيحة'); return;}
                saving = true;
                createExpense({ deptId: detailCode, amount, date: v('date'), desc: label, category: v('category'), notes: v('notes').trim() })
                    .then(() => {
                        if (!el.isConnected) {return;}
                        bundle = null;
                        notify('تم إضافة المصروف');
                        reload();
                    })
                    .catch((e) => { if (el.isConnected) {fail((e && e.message) || 'فشل حفظ المصروف في قاعدة البيانات');} })
                    .finally(() => {saving = false;});
            }
        }
    });

    el.addEventListener('change', (ev) => {
        if (ev.target.matches('[data-v2-dfrom]')) {detailFrom = ev.target.value; openDetail(detailCode, false); return;}
        if (ev.target.matches('[data-v2-dto]')) {detailTo = ev.target.value; openDetail(detailCode, false);}
    });

    reload();
    return { el, reload, getRows: () => rows, destroy() { table.destroy(); el.remove(); } };
}
