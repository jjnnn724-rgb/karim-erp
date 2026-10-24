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

import { createDataTable } from '../data-display/data-table.js?v=4.9.154';
import { fetchDepartments, fetchRevenues, fetchExpenses, calcDeptStats } from '../data/finance-repo.js?v=4.9.154';
import { formatInt, formatMoney, fetchCurrency } from '../data/reports-repo.js?v=4.9.154';
import { canWrite } from '../session.js?v=4.9.154';
import { departmentWriteEnabled, deptCashierWriteEnabled } from '../write-flags.js?v=4.9.154';
import {
    DEPARTMENT_WRITE_ROLES, DEPARTMENT_ICON_OPTIONS,
    validateDepartmentForm, createDepartment, updateDepartment, deleteDepartment,
    normalizeDepartmentIcon,
} from '../data/departments-write-repo.js?v=4.9.154';
import {
    DEPT_CASHIER_WRITE_ROLES, fetchDeptCashierLinks, deptLinkRows, deptCashierNos,
    deptNameOf, validateLinkForm, createDeptCashierLink, deleteDeptCashierLink,
    updateDeptCashierLink, fetchYaraCashiers, cashierNameOf, cashierLabel,
} from '../data/dept-cashier-repo.js?v=4.9.154';
import {
    CASHIER_DEPT_MAP, cashierRevenueIn, deptIdentityColor,
    computeDeptDetail, fetchDeptDetailBundle, createRevenue, createExpense,
} from '../data/dept-detail.js?v=4.9.154';
/* معلومات الأعمال داخل البطاقة (طلب المالك 2026-10-19: «معلومات مفيدة في كل بطاقة»):
 * عدد الأصناف من recipes.deptId، وعدد الموظفين من employees.department، وآخر/معلّق
 * أذون الصرف من dispatches.deptCode — كلّها أكواد القسم نفسها (finance-repo:20).
 * أبواب قراءة قائمة، تُفشّل بصمت فلا تُسقط السجل إن غاب جدول أو صلاحية. */
import { fetchEmployees } from '../data/employees-repo.js?v=4.9.154';
import { fetchRecipes } from '../data/recipes-repo.js?v=4.9.154';
import { fetchDispatches } from '../data/dispatch-repo.js?v=4.9.154';
import { deptSignalsOf, deptSignalTotals } from '../data/dept-signals.js?v=4.9.154';
import { fetchYaraCashierItems } from '../data/reports-extra.js?v=4.9.154';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* ترتيب عائلي: الأب أولاً ثم أبناؤه باسمهم، بمقارن عربي — الأبناء اللي أبهم
   مفقود من السجل يظهر سطرهم بشارة تحذير بدل كود خام. */
const AR_COLLATOR = new Intl.Collator('ar', { numeric: true });
const byDeptName = (a, b) => AR_COLLATOR.compare(String(a.name || ''), String(b.name || ''));
function familyOrder(list) {
    const byCode = new Map(list.map((d) => [String(d.code), d]));
    const kidsOf = (code) => list.filter((d) => String(d.parent_code || '') === code);
    const out = [];
    const roots = list.filter((d) => !d.parent_code || !byCode.has(String(d.parent_code)));
    for (const root of roots.slice().sort(byDeptName)) {
        out.push(root);
        for (const kid of kidsOf(String(root.code)).sort(byDeptName)) { out.push(kid); }
    }
    for (const d of list) { if (!out.includes(d)) { out.push(d); } }
    return out;
}

/* أقسام المبيعات المرآتية: يولّدها تكامل يارا سوفت (ys_cc_* «مبيعات كاشير N»،
   ys_b4_ext «مبيعات بيع خارجي») لتحمل إيراد الكاشير. هي ليست أقسامًا تشغيلية،
   فتُطوى من بطاقات الأقسام افتراضيًا (طلب المالك 2026-10-19: «مش عايز زحمة»).
   طيّ عرضٍ فقط: لا حذف ولا تعديل — صفوف الإيراد تبقى في القاعدة كما هي،
   والمفتاح في شريط العرض يعيدها فورًا. البادئة ys_ هي مساحة الأسماء التي
   يولّدها التكامل وحده، ولا قسم يدوي يبدأ بها. */
const MIRROR_DEPT_RE = /^ys_/i;
const LIVE_CASHIER_NOS = new Set(['1', '3', '4', '5', '6', '9']);
/* قرار المالك 2026-10-21: فواتير BILLS4 (ys_b4_ext) تسويات مديونية قديمة
   وليست إيرادًا لنا — تُستبعد من كل الأرقام التشغيلية. تبقى صفوفها في
   القاعدة للمطابقة مع يارا فقط. */
const NON_OPERATIONAL_REVENUE_DEPTS = new Set(['ys_b4_ext']);
const CASHIER_REFRESH_MS = 10_000;
export function isMirrorDept(code) { return MIRROR_DEPT_RE.test(String(code ?? '')); }

function monthToDateRange() {
    const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    return { from: `${today.slice(0, 7)}-01`, to: today };
}

/* مفاتيح الأيقونات الحقيقية وقت التشغيل — تُحقن مرة واحدة عند التركيب. */
let KNOWN_ICON_KEYS = null;

function kpiHtml(label, value) {
    return `<li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">${esc(label)}</span></div><div class="erp-kpi__value">${esc(value)}</div></li>`;
}

/** مؤشر مالي: القيمة HTML جاهزة من money() فلا تُهرَّب ثانية. */
function kpiMoneyHtml(label, value, cur) {
    return `<li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">${esc(label)}</span></div><div class="erp-kpi__value">${money(value, cur)}</div></li>`;
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
        + '<div class="erp-dept-viewbar">'
        + '<div class="erp-dept-switch" role="group" aria-label="طريقة عرض الأقسام">'
        + '<button type="button" data-v2-view="cards" aria-pressed="true"><i class="ji" data-i="store" aria-hidden="true"></i><span>بطاقات</span></button>'
        + '<button type="button" data-v2-view="table" aria-pressed="false"><i class="ji" data-i="clipboard-list" aria-hidden="true"></i><span>جدول</span></button>'
        + '</div>'
        + '<label class="erp-dept-check erp-dept-mirrors"><input type="checkbox" data-v2-mirrors><span data-v2-mirrors-label>إظهار أقسام المبيعات المرآتية</span></label>'
        + '</div>'
        + '<p class="erp-text-sm erp-text-muted" data-v2-summary role="status" aria-live="polite"></p>'
        + '<p class="erp-text-sm erp-text-muted" data-v2-yara-status role="status" aria-live="polite"></p>'
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
    /* دليل كاشيرات يارا سوفت الحي (بند #8): الأرقام والأسماء التي تُعرف أنها
       كاشيرات فعلية، فلا يُكتب رقم من الذاكرة. */
    let cashDir = [];
    let cashDirFailed = false;
    let actualCashierRevenue = new Map();
    let actualCashierReady = false;
    let actualCashierError = '';
    let actualCashierUpdatedAt = null;
    let actualCashierLoading = false;
    let cashierRefreshTimer = null;
    /* معلومات الأعمال (2026-10-19): أصناف القسم وموظفوه وأذونه — تُحمّل بعد
       السجل وتبقى صفرًا بأمان إن غابت الصلاحية أو الجدول. */
    let staff = [];
    let recipes = [];
    let dispatches = [];
    let signalsReady = false;
    let financeReady = false;
    /* تسوية الإجمالي: المصروفات غير المسندة (deptId فارغ/غير معروف) مشمولة
       في إجمالي المؤشرات ولا تظهر على أي بطاقة — تُذكر صراحةً بلا اختراع قسم. */
    let unassignedExpense = 0;
    let unassignedExpenseCount = 0;
    let view = 'cards';
    let linkingCode = '';
    /* طيّ أقسام المبيعات المرآتية (ys_*) افتراضيًا: عرضٌ فقط بلا حذف بيانات،
       والمفتاح في شريط العرض يعيدها. */
    let showMirrors = false;
    /* أكواد الأقسام الآباء المفتوحة قائمة أبنائها (طلب المالك: «مش عايز زحمة»).
       الطيّ عرضٌ فقط — العدد على الزر دائمًا، والفتح بضغطة. */
    const kidsOpen = new Set();

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

    /** الصفوف المعروضة: المرآتية (ys_*) مطويّة افتراضيًا — طيُّ عرضٍ فقط. */
    const visibleRows = () => (showMirrors ? rows : rows.filter((d) => !isMirrorDept(d.code)));
    const mirrorCount = () => rows.reduce((n, d) => n + (isMirrorDept(d.code) ? 1 : 0), 0);

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
    function deptCardCashierNos(code) {
        const linked = deptCashierNos(code, {links, departments: rows});
        const nos = linked.nos.filter((no) => LIVE_CASHIER_NOS.has(String(no)));
        const mirrorMatch = String(code).match(/^ys_cc_(\d+)$/i);
        if (mirrorMatch && LIVE_CASHIER_NOS.has(mirrorMatch[1]) && !nos.includes(mirrorMatch[1])) {
            nos.push(mirrorMatch[1]);
        }
        const savedLinks = new Set((links || []).map((l) => String(l.cashier_no || '')));
        for (const cashier of cashDir) {
            if (!LIVE_CASHIER_NOS.has(String(cashier.no)) || !cashier.deptCode
                || !deptIsWithin(String(cashier.deptCode), String(code))
                || savedLinks.has(String(cashier.no))) {continue;}
            if (!nos.includes(String(cashier.no))) {nos.push(String(cashier.no));}
        }
        return nos;
    }

    function deptIsWithin(candidateCode, ancestorCode) {
        let current = rows.find((d) => String(d.code) === candidateCode);
        const seen = new Set();
        while (current && current.parent_code && !seen.has(String(current.code))) {
            const parentCode = String(current.parent_code);
            if (parentCode === ancestorCode) {return true;}
            seen.add(String(current.code));
            current = rows.find((d) => String(d.code) === parentCode);
        }
        return candidateCode === ancestorCode;
    }

    /** إحصاءات البطاقة: إيراد القسم من السجل المرحّل + مرايا الكاشيريات
     *  المربوطة (ys_cc_N)، ومصروفه، والصافي. إيرادات BILLS4 مستبعدة سلفًا.
     *  الأرقام كلها من نفس سجل تحليل التكاليف، فتتطابق البطاقات مع الإجمالي
     *  ومع القديم بلا خلطٍ بين قراءة يارا الحيّة والقاعدة. */
    function deptCardStats(r, nos) {
        const {from, to} = monthToDateRange();
        const code = String(r.code);
        const s = calcDeptStats(revenues, expenses, rows, code, from, to);
        // المرايا خارج شجرة القسم في القاعدة (parent_code فارغ)، فتُجمع هنا.
        // حارس الشجرة يمنع ازدواج مرآةٍ صارت داخل الشجرة أو بطاقةِ المرآة نفسها.
        let mirrorRev = 0;
        for (const no of nos) {
            if (!deptIsWithin(`ys_cc_${no}`, code)) {
                mirrorRev += cashierRevenueIn(revenues, [no], from, to);
            }
        }
        const rev = s.rev + mirrorRev;
        return {
            rev, exp: s.exp, profit: rev - s.exp,
            costRatio: rev > 0 ? (s.exp / rev) * 100 : 0,
        };
    }

    /** معلومات الأعمال لكل قسم — نداء الدالة الخالصة deptSignalsOf. */
    function deptSignals(code) {
        return deptSignalsOf(code, recipes, staff, dispatches);
    }

    /** شرائح معلومات البطاقة: أصناف · موظفون · معلّق · آخر صرف. */
    function deptSignalsHtml(code) {
        if (!signalsReady) {
            return '<div class="erp-dept-card__signals"><span class="erp-dept-signal is-muted" title="جارٍ تحميل معلومات القسم">جارٍ التحميل…</span></div>';
        }
        const s = deptSignals(code);
        return '<div class="erp-dept-card__signals">'
            + `<span class="erp-dept-signal" title="عدد الأصناف (الوصفات) المسندة لهذا القسم"><i class="ji" data-i="utensils" aria-hidden="true"></i>${formatInt(s.itemCount)} صنف</span>`
            + `<span class="erp-dept-signal" title="عدد الموظفين المسندين لهذا القسم"><i class="ji" data-i="users" aria-hidden="true"></i>${formatInt(s.staffCount)} موظف</span>`
            + (s.pending
                ? `<span class="erp-dept-signal is-alert" title="أذون صرف بانتظار الاعتماد"><i class="ji" data-i="clock" aria-hidden="true"></i>${formatInt(s.pending)} معلّق</span>`
                : '')
            + (s.last
                ? `<span class="erp-dept-signal is-muted" title="تاريخ آخر إذن صرف"><i class="ji" data-i="calendar" aria-hidden="true"></i>آخر صرف ${esc(fD(s.last))}</span>`
                : '<span class="erp-dept-signal is-muted">بلا صرف مسجَّل</span>')
            + '</div>';
    }

    function deptStatCell(label, iconKey, value, extraClass) {
        return `<span class="erp-dept-stat ${extraClass}">`
            + `<span class="erp-dept-stat__label"><i class="ji" data-i="${esc(iconKey)}" aria-hidden="true"></i>${esc(label)}</span>`
            + `<span class="erp-dept-stat__value">${money(value, currency)}</span></span>`;
    }

    /** شارة كاشير على البطاقة — أساسي بنجمة، ثانوي بحد منقّط، الوارث باسم قسمه.
     *  اسم الكاشير من دليل يارا سوفت الحي؛ لا اسم لرقم لا يعرفه الدليل. */
    function deptCashierChip(l) {
        const no = String(l.cashierNo);
        const {from, to} = monthToDateRange();
        // شارة الكاشير تعرض المرحّل (نفس أساس البطاقة). إن كان حيًّا بلا مرآة
        // بعد (كاشير جديد) يُعرض الحي موسومًا بأنه غير مرحّل وغير مشمول.
        const posted = cashierRevenueIn(revenues, [no], from, to);
        const live = actualCashierReady ? (actualCashierRevenue.get(no) || 0) : null;
        const unposted = live !== null && live > 0 && posted <= 0;
        const amount = posted > 0 ? formatInt(posted) : (unposted ? formatInt(live) : '—');
        const source = unposted
            ? `حيّ من قاعدة الكاشير: ${formatInt(live)} — غير مرحّل إلى قاعدة المرايا وغير مشمول في إجمالي البطاقة`
            : (live !== null && Math.abs(live - posted) > 0.01
                ? `المرحّل: ${formatInt(posted)} · الحي: ${formatInt(live)}`
                : (actualCashierReady ? '' : 'من سجل الإيرادات المرحّل — قاعدة الكاشير غير متاحة'));
        const owner = l.inherited ? ` · ${esc(deptNameOf(l.deptCode, rows))}` : '';
        const nm = cashierNameOf(l.cashierNo, cashDir);
        return `<span class="erp-dept-cashier${l.isPrimary ? '' : ' is-secondary'}${unposted ? ' is-unposted' : ''}" title="${esc(cashierLabel(l.cashierNo, cashDir))}${owner}">`
            + `<i class="ji" data-i="receipt" aria-hidden="true"></i>كاشير <span class="erp-mono" dir="ltr">${esc(l.cashierNo)}</span>`
            + (nm ? `<span class="erp-dept-cashier__name">${esc(nm)}</span>` : '')
            + `${l.isPrimary ? '<span class="erp-dept-cashier__star" title="الكاشير الأساسي للقسم">★</span>' : ''}`
            + `<span class="erp-dept-cashier__amount erp-num" dir="ltr"${source ? ` title="${esc(source)}"` : ''}>${amount}</span>`
            + `${unposted ? '<span class="erp-dept-cashier__flag">غير مرحّل</span>' : ''}`
            + `${owner}</span>`;
    }

    /** مُنتقي لوحة الربط: كاشيرات يارا سوفت الحيّة أولًا، واليدوي مخرجًا دائمًا.
     *  الرقم المربوط هنا يُعطَّل في القائمة؛ المربوط بقسمٍ آخر يُذكر صاحبه
     *  ليختار المالك بعلم — فالخادم هو الحكم، والعميل لا يمنع ما لم يُمنع. */
    function linkPickerHtml(code) {
        const manual = (hidden) => `<label class="erp-text-sm erp-text-muted"${hidden ? ' hidden' : ''} data-v2-link-manual>`
            + 'رقم الكاشير<input class="erp-input erp-input--ltr" data-v2-link-no inputmode="numeric" maxlength="6" placeholder="مثال: 12"></label>';
        if (!cashDir.length) {
            const note = cashDirFailed
                ? 'تعذّرت قراءة دليل الكاشيرات — أدخل الرقم يدويًا.'
                : 'لا كاشير معتمد في الخريطة بعد — أدخل الرقم يدويًا.';
            return `<p class="erp-dept-link-picker erp-dept-link-picker--note">${esc(note)}</p>` + manual(false);
        }
        const here = new Set(deptCashierNos(code, {links, departments: rows}).nos);
        const opts = cashDir.map((c) => {
            const linkedHere = here.has(c.no);
            const other = linkedHere ? null : links.find((l) => String(l.cashier_no ?? '').trim() === c.no);
            const owner = other ? deptNameOf(String(other.dept_code ?? '').trim(), rows) : '';
            const mark = linkedHere ? ' — مربوط هنا' : (owner ? ` — مربوط بـ ${owner}` : '');
            const nm = c.name ? ` — ${c.name}` : '';
            return `<option value="${esc(c.no)}"${linkedHere ? ' disabled' : ''}>${esc(`كاشير ${c.no}${nm}${mark}`)}</option>`;
        }).join('');
        return `<label class="erp-text-sm erp-text-muted">كاشير من قاعدة الكاشير`
            + `<select class="erp-select" data-v2-link-pick>`
            + `<option value="">— اختر من ${formatInt(cashDir.length)} كاشير —</option>${opts}`
            + '<option value="__manual__">رقم آخر — إدخال يدوي</option></select></label>'
            + manual(true);
    }

    /** لوحة ربط الكاشير داخل البطاقة (تحت علم v2deptcashier وحده). */
    function deptLinkPanelHtml(code) {
        const rowsOfDept = deptLinkRows(code, links, rows);
        const known = deptCashierNos(code, {links, departments: rows});
        const list = rowsOfDept.length
            ? rowsOfDept.map((l) => `<div class="erp-dept-link-row">`
                + `<span class="erp-dept-link-row__name">كاشير <span class="erp-mono" dir="ltr">${esc(l.cashierNo)}</span>`
                + (cashierNameOf(l.cashierNo, cashDir) ? ` <span class="erp-text-muted">${esc(cashierNameOf(l.cashierNo, cashDir))}</span>` : '')
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
            + linkPickerHtml(code)
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
        const cashierNos = deptCardCashierNos(code);
        const s = deptCardStats(r, cashierNos);
        const linkRows = deptLinkRows(code, links, rows);
        const chipRows = linkRows.filter((l) => LIVE_CASHIER_NOS.has(String(l.cashierNo)));
        const chipNos = new Set(chipRows.map((l) => String(l.cashierNo)));
        const chips = [
            ...chipRows.map((l) => deptCashierChip(l)),
            ...cashierNos.filter((no) => !chipNos.has(String(no))).map((no) => deptCashierChip({
                cashierNo: no, isPrimary: true, deptCode: code, inherited: false,
            })),
        ].join('') || (cashierNos.length
            ? cashierNos.map((no) => deptCashierChip({cashierNo: no, isPrimary: true, deptCode: code, inherited: false})).join('')
                : '<span class="erp-dept-card__unassigned">بلا كاشير مسند — اربطه من «ربط كاشير»</span>');
        const parent = rows.find((d) => String(d.code) === String(r.parent_code));
        const kids = visibleRows().filter((d) => String(d.parent_code || '') === code).length;
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
            + '</span></div></div>'
            + deptSignalsHtml(code)
            + `<div class="erp-dept-card__stats">`
            + deptStatCell('إيراد الشهر', 'banknote', s.rev, 'erp-dept-stat--rev')
            + deptStatCell('مصروف الشهر', 'package', s.exp, 'erp-dept-stat--exp')
            + `<span class="erp-dept-stat erp-dept-stat--net"><span class="erp-dept-stat__label"><i class="ji" data-i="gem" aria-hidden="true"></i>صافي الشهر</span>`
            + `<span class="erp-dept-stat__value ${netClass}">${money(s.profit, currency)}</span></span>`
            + '</div>'
            + `<div class="erp-dept-card__ratio${s.costRatio > 100 ? ' is-high' : ''}"${s.rev > 0 ? ' title="نسبة المصروف إلى إيراد القسم من سجل الإيراد المرحّل — نفس أساس تحليل التكاليف"' : ''}>`
            + `<span class="erp-dept-card__ratio-track"><span class="erp-dept-card__ratio-fill" style="width:${ratioPct.toFixed(1)}%"></span></span>`
            + `<span class="erp-dept-card__ratio-label">نسبة التكلفة <span class="erp-num" dir="ltr">${s.rev > 0 ? `${formatInt(Math.round(s.costRatio))}%` : '—'}</span></span>`
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
            + (kids ? deptKidsBarHtml(code, kids, kidsOpen.has(code)) : '')
            + '</li>';
    }

    /** شريط أقسام القسم الفرعية: يطوي القائمة ويفردها (طلب المالك: «مش عايز
     *  زحمة»). الطيّ عرضٌ فقط — العدد ظاهرٌ على الزر دائمًا فلا تختفي معلومة. */
    function deptKidsBarHtml(code, count, open) {
        return `<button type="button" class="erp-dept-kids-bar${open ? ' is-open' : ''}" data-v2-kids="${esc(code)}" aria-expanded="${open ? 'true' : 'false'}">`
            + `<i class="ji" data-i="${open ? 'chevron-up' : 'chevron-down'}" aria-hidden="true"></i>`
            + `<i class="ji" data-i="layers" aria-hidden="true"></i>`
            + `<span>${open ? 'طيّ' : 'عرض'} الأقسام الفرعية (${formatInt(count)})</span>`
            + '</button>';
    }

    /* بطاقات المستوى الأول فقط، وكل قسم فرعي يُرسم داخل بطاقة أبيه (طلب المالك:
       «مش عايز زحمة») فلا يظهر الفرع مرتين. الأب يبقى يعرض كاشيراته الموروثة
       كما كانت — الطيّ في البطاقة لا في الأرقام. */
    /** رقم نقدي مكتوم الوحدة داخل صفّ فرعي (الوحدة ظاهرة في الصافي). */
    const amountOnly = (v) => {
        const m = formatMoney(v, currency);
        return `<span class="erp-num" dir="ltr">${esc(m.amount)}</span>`;
    };

    /** صفّ قسم فرعي مضغوط داخل بطاقة أبيه — سطر واحد على الشاشات الواسعة
     *  يلتفّ على الهاتف، فلا تُضخَّم بطاقة الأب ببطاقات كاملة متكررة
     *  (طلب المالك: «مش عايز زحمة»). نفس الأرقام والإجراءات، حجم أقل. */
    function deptChildRowHtml(r) {
        const code = String(r.code);
        const accent = deptIdentityColor(r);
        const cashierNos = deptCardCashierNos(code);
        const s = deptCardStats(r, cashierNos);
        const linkRows = deptLinkRows(code, links, rows);
        const chipRows = linkRows.filter((l) => LIVE_CASHIER_NOS.has(String(l.cashierNo)));
        const chipNos = new Set(chipRows.map((l) => String(l.cashierNo)));
        const chips = [
            ...chipRows.map((l) => deptCashierChip(l)),
            ...cashierNos.filter((no) => !chipNos.has(String(no))).map((no) => deptCashierChip({
                cashierNo: no, isPrimary: true, deptCode: code, inherited: false,
            })),
        ].join('') || (cashierNos.length
            ? cashierNos.map((no) => deptCashierChip({cashierNo: no, isPrimary: true, deptCode: code, inherited: false})).join('')
                : '<span class="erp-dept-child__unassigned">بلا كاشير</span>');
        const sig = deptSignals(code);
        const expanded = linkingCode === code;
        const netClass = s.profit >= 0 ? 'is-positive' : 'is-negative';
        const grandKids = visibleRows().filter((d) => String(d.parent_code || '') === code).sort(byDeptName);
        return `<li class="erp-dept-child${expanded ? ' is-expanded' : ''}" style="--dept-accent:${esc(accent)}" data-v2-dept-code="${esc(code)}">`
            + '<div class="erp-dept-child__row">'
            + `<span class="erp-dept-child__medal" aria-hidden="true">${deptMedalHtml(r)}</span>`
            + `<span class="erp-dept-child__id"><span class="erp-dept-child__name">${esc(String(r.name))}</span>`
            + `<span class="erp-dept-child__code erp-mono" dir="ltr">${esc(code)}</span></span>`
            + `<span class="erp-dept-child__signals">${signalsReady
                ? `${formatInt(sig.itemCount)} صنف · ${formatInt(sig.staffCount)} موظف${sig.pending ? ` · ${formatInt(sig.pending)} معلّق` : ''}`
                : 'جارٍ التحميل…'}</span>`
            + `<span class="erp-dept-child__cashiers">${chips}</span>`
            + '<span class="erp-dept-child__amounts">'
            + `<span class="erp-dept-child__net ${netClass}">${money(s.profit, currency)}</span>`
            + `<span class="erp-dept-child__split">`
            + `<span title="إيراد الشهر من سجل الإيراد المرحّل">إيراد ${amountOnly(s.rev)}</span>`
            + `<span title="مصروف الشهر من أذون الصرف والحركات">مصروف ${amountOnly(s.exp)}</span>`
            + '</span>'
            + `<span class="erp-dept-child__ratio"${s.rev > 0 ? '' : ' title="لا يوجد إيراد مرحّل لهذا القسم — النسبة غير قابلة للحساب"'}>تكلفة <span class="erp-num" dir="ltr">${s.rev > 0 ? `${formatInt(Math.round(s.costRatio))}%` : '—'}</span></span>`
            + '</span>'
            + '<span class="erp-dept-child__actions">'
            + `<button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-detail="${esc(code)}"><i class="ji" data-i="eye" aria-hidden="true"></i><span>تفاصيل</span></button>`
            + (canLink ? `<button type="button" class="erp-btn erp-btn--sm" data-v2-link="${esc(code)}"><i class="ji" data-i="users" aria-hidden="true"></i><span>${expanded ? 'إغلاق' : 'كاشير'}</span></button>` : '')
            + (canManage
                ? `<button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-dept-edit="${esc(String(r.id))}" aria-label="تعديل القسم"><i class="ji" data-i="pencil" aria-hidden="true"></i></button>`
                    + `<button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-dept-del="${esc(String(r.id))}" aria-label="حذف القسم"><i class="ji" data-i="trash" aria-hidden="true"></i></button>`
                : '')
            + '</span></div>'
            + (expanded ? deptLinkPanelHtml(code) : '')
            + (grandKids.length ? `<ul class="erp-dept-kids erp-dept-kids--nested${kidsOpen.has(code) ? '' : ' is-collapsed'}">${grandKids.map(deptChildRowHtml).join('')}</ul>` : '')
            + '</li>';
    }

    /* بطاقات المستوى الأول فقط، وكل قسم فرعي يُرسم صفًّا مضغوطًا داخل بطاقة
       أبيه (طلب المالك: «مش عايز زحمة») فلا يظهر الفرع مرتين. الأب يبقى يعرض
       كاشيراته الموروثة كما كانت — الطيّ في البطاقة لا في الأرقام. */
    function paintCards() {
        const holder = q('[data-v2-cards]');
        if (!holder) {return;}
        const list = visibleRows();
        const byCode = new Map(list.map((d) => [String(d.code), d]));
        const kidsOf = (code) => list.filter((d) => String(d.parent_code || '') === code);
        const roots = list.filter((d) => !d.parent_code || !byCode.has(String(d.parent_code)));
        const render = (r) => {
            const code = String(r.code);
            const kids = kidsOf(code);
            const html = deptCardHtml(r);
            if (!kids.length) {return html;}
            /* القائمة تُرسم دائمًا وتُطوى بـ CSS: الطبع يراها كاملة، والعرض
               يستطيع فردها بضغطة، ولا تُفقد معلومة من الـDOM. */
            const cls = kidsOpen.has(code) ? '' : ' is-collapsed';
            return html.replace(/<\/li>$/, `<ul class="erp-dept-kids${cls}">${kids.slice().sort(byDeptName).map(deptChildRowHtml).join('')}</ul></li>`);
        };
        const covered = new Set();
        const cards = roots.slice().sort(byDeptName).map((r) => {
            covered.add(String(r.code));
            kidsOf(String(r.code)).forEach((k) => covered.add(String(k.code)));
            return render(r);
        });
        /* لا يسقط صفّ: ما لم يُرسم (أب مفقود أو دورة بيانات) يظهر بطاقةً كما كان. */
        const orphans = list.filter((d) => !covered.has(String(d.code)));
        holder.innerHTML = (cards.length || orphans.length)
            ? cards.join('') + orphans.map(deptCardHtml).join('')
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

    /** مصاريع البطاقات — تُحمّل بعد السجل وتفشل بصمت: أصناف القسم وموظفوه
     *  وأذونه (معلومات البطاقة)، وإيراده/مصروفه (لوحة التفاصيل)، وروابط الكاشير.
     *  كل مصدرٍ يُبتلع خطؤه وحده فلا يُسقط الباقي، والرسم يُعاد بعد الوصول. */
    async function loadCardData() {
        const [rev, exp, emp, rec, dis] = await Promise.all([
            fetchRevenues().catch(() => []),
            fetchExpenses().catch(() => []),
            fetchEmployees().catch(() => []),
            fetchRecipes().catch(() => []),
            fetchDispatches().catch(() => []),
        ]);
        if (!el.isConnected) {return;}
        revenues = (Array.isArray(rev) ? rev : []).filter(
            (r) => !NON_OPERATIONAL_REVENUE_DEPTS.has(String(r && r.deptId)),
        );
        expenses = Array.isArray(exp) ? exp : [];
        staff = Array.isArray(emp) ? emp : [];
        recipes = Array.isArray(rec) ? rec : [];
        dispatches = Array.isArray(dis) ? dis : [];
        financeReady = true;
        signalsReady = true;
        try {
            links = await fetchDeptCashierLinks();
            linksLoaded = true;
        } catch {
            /* جدول 103 غير مطبَّق بعد في هذه البيئة: الروابط صفر، والخريطة
               المدمجة تكفل أرقامًا مطابقة للقديم بدل صف فارغ. */
            links = [];
            linksLoaded = false;
        }
        try {
            cashDir = await fetchYaraCashiers();
            cashDirFailed = false;
        } catch {
            /* نفس احتياط روابط 103: الدليل وسيلة لا غرض. إن تعذرت قراءته
               تعود اللوحة للإدخال اليدوي وحده — لا تختفي البطاقة ولا تُخترع أسماء. */
            cashDir = [];
            cashDirFailed = true;
        }
        await refreshActualCashierRevenue();
        if (!el.isConnected) {return;}
        paintKpis();
        if (view === 'cards') {paintCards();}
        if (!cashierRefreshTimer) {
            cashierRefreshTimer = setInterval(() => {
                if (el.isConnected && document.visibilityState !== 'hidden') {
                    void refreshActualCashierRevenue();
                }
            }, CASHIER_REFRESH_MS);
        }
    }

    async function refreshActualCashierRevenue() {
        if (actualCashierLoading || !el.isConnected) {return;}
        actualCashierLoading = true;
        const {from, to} = monthToDateRange();
        try {
            const result = await fetchYaraCashierItems({from, to, view: 'invoices', summaryOnly: true, live: true});
            if (!el.isConnected) {return;}
            actualCashierRevenue = new Map((result.cashiers || [])
                .filter((c) => LIVE_CASHIER_NOS.has(String(c.no)))
                .map((c) => [String(c.no), Number(c.net) || 0]));
            actualCashierReady = true;
            actualCashierError = '';
            actualCashierUpdatedAt = new Date();
        } catch (error) {
            actualCashierError = (error && error.message) || 'تعذّر الاتصال بقاعدة الكاشير';
        } finally {
            actualCashierLoading = false;
        }
        const status = q('[data-v2-yara-status]');
        if (status) {
            const range = monthToDateRange();
            const linkedNos = new Set((links || []).map((l) => String(l.cashier_no || '')));
            const unmapped = cashDir.filter((c) => LIVE_CASHIER_NOS.has(String(c.no))
                && !linkedNos.has(String(c.no))
                && (!c.deptCode || !rows.some((d) => String(d.code) === String(c.deptCode))))
                .map((c) => String(c.no));
            const directoryNos = new Set(cashDir.map((c) => String(c.no)));
            for (const no of LIVE_CASHIER_NOS) {
                if (!cashDirFailed && !linkedNos.has(no) && !directoryNos.has(no) && !CASHIER_DEPT_MAP[no]) {
                    unmapped.push(no);
                }
            }
            const mappingNote = cashDirFailed
                ? 'تعذّر تحميل دليل أقسام الكاشير؛ لم يتم تخمين إسناد لأي قسم.'
                : (unmapped.length ? `كاشيرات بلا إسناد موثّق: ${unmapped.join('، ')}.` : '');
            if (!actualCashierReady) {
                status.textContent = `إيراد الكاشير الفعلي من قاعدة الكاشير غير متاح — البطاقات تُقرأ من سجل الإيراد المرحّل، لا أصفار بديلة. ${actualCashierError} ${mappingNote}`;
            } else if (actualCashierError) {
                status.textContent = `تعذّر تحديث إيراد الكاشير؛ آخر قراءة ناجحة ${actualCashierUpdatedAt.toLocaleTimeString('ar-EG')}. ${actualCashierError} ${mappingNote}`;
            } else {
                status.textContent = `إيراد الكاشير الفعلي من ${range.from} إلى ${range.to} · تحديث كل 10 ثوانٍ · أرقام البطاقات من السجل المرحّل، والحي للمطابقة وكشف غير المرحّل · الكاشير 2 مستبعد حسب إعداد قاعدة الكاشير. ${mappingNote}`;
            }
        }
        paintSummary();
        if (view === 'cards') {paintCards();}
    }

    /* ── ربط الكاشير (جدول 103) — خلف علم v2deptcashier والدور معًا ── */
    function linkFail(message) {
        const box = q('[data-v2-link-err]');
        if (box) {box.textContent = message;}
        notify(message);
    }

    function pickedCashierNo() {
        const sel = q('[data-v2-link-pick]');
        if (!sel) {return q('[data-v2-link-no]')?.value ?? '';}
        const v = sel.value;
        if (!v) {return '';}
        if (v === '__manual__') {return q('[data-v2-link-no]')?.value ?? '';}
        return v;
    }

    function addLink(code) {
        if (saving) {return;}
        const v = validateLinkForm({
            dept_code: code,
            cashier_no: pickedCashierNo(),
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

    /** مبلغ نصّي بلا HTML — للملخّص النصّي. */
    function moneyText(v) {
        const m = formatMoney(v, currency);
        return `${m.amount}${m.hasUnit ? ' ' + m.unit : ''}`;
    }

    function unassignedExpenseTotals() {
        const codes = new Set(rows.map((d) => String(d.code)));
        const list = (expenses || []).filter((e) => !codes.has(String((e && e.deptId) || '')));
        return {count: list.length, sum: list.reduce((s, e) => s + Number(e && e.amount || 0), 0)};
    }

    /** كاشيرات لهم إيراد حي يتجاوز المرحّل — كاشير جديد لم تُنشأ مرآته بعد. */
    function unpostedLiveCashiers() {
        if (!actualCashierReady) {return [];}
        const {from, to} = monthToDateRange();
        return [...LIVE_CASHIER_NOS].map((no) => {
            const posted = cashierRevenueIn(revenues, [no], from, to);
            const live = actualCashierRevenue.get(String(no)) || 0;
            return {no, posted, live, delta: live - posted};
        }).filter((x) => x.delta > 0.01);
    }

    /** سطر التسوية: ما لا تحمله بطاقة (مصروف بلا قسم، أو حي غير مرحّل) يُقال صراحةً. */
    function paintSummary() {
        const shown = visibleRows().length;
        const hidden = rows.length - shown;
        let text = formatInt(shown) + ' قسمًا'
            + (hidden ? ` — ${formatInt(hidden)} قسم مبيعات مرآتي مطوي (طيّ عرضٍ فقط، بلا حذف)` : '');
        if (financeReady) {
            text += ' · أرقام البطاقات من سجل الإيراد والمصروف المرحّل — نفس أساس تحليل التكاليف';
            if (unassignedExpenseCount) {
                text += ` · مصروفات غير مسندة إلى قسم: ${moneyText(unassignedExpense)}`
                    + ` (${formatInt(unassignedExpenseCount)} حركة) مشمولة في إجمالي المصروف`;
            }
            const unposted = unpostedLiveCashiers();
            if (unposted.length) {
                text += ' · إيراد حي غير مرحّل (غير مشمول في البطاقات): '
                    + unposted.map((x) => `كاشير ${x.no}: ${moneyText(x.delta)}`).join('، ');
            }
        }
        summaryEl.textContent = text;
    }

    function paint() {
        const shown = visibleRows().length;
        countEl.textContent = shown ? '(' + formatInt(shown) + ')' : '';
        const mirrorLabel = q('[data-v2-mirrors-label]');
        if (mirrorLabel) {
            mirrorLabel.textContent = showMirrors
                ? 'إخفاء أقسام المبيعات المرآتية'
                : `إظهار أقسام المبيعات المرآتية (${formatInt(mirrorCount())})`;
        }
        const mirrorBox = q('[data-v2-mirrors]');
        if (mirrorBox) {mirrorBox.checked = showMirrors;}
        paintKpis();
        table.setRows(familyOrder(visibleRows()));
        applyView();
    }

    /** المؤشرات العلوية: هيكل الأقسام + معلومات أعمال حقيقية (إيراد/مصروف/صافي/
     *  موظفون/أصناف/أذون معلّقة). تُعاد النداء بعد وصول البيانات الثقيلة فيُستبدل
     *  الصفر بمجموع فعلي — والحساب كله من صفوفٍ محمَّلة أصلًا، بلا طلبٍ جديد. */
    function paintKpis() {
        const shown = visibleRows();
        const total = shown.length;
        const kpiEl = q('[data-v2-kpis]');
        if (!kpiEl) {return;}
        const roots = shown.filter((d) => !d.parent_code).length;
        const totalRev = revenues.reduce((a, r) => a + (Number(r && r.amount) || 0), 0);
        const totalExp = expenses.reduce((a, e) => a + (Number(e && e.amount) || 0), 0);
        const unassigned = unassignedExpenseTotals();
        unassignedExpense = unassigned.sum;
        unassignedExpenseCount = unassigned.count;
        const pending = dispatches.filter((d) => String((d && d.status) || '') === 'pending').length;
        const totals = deptSignalTotals(rows, recipes, staff);
        const fin = (label, value) => (financeReady ? kpiMoneyHtml(label, value, currency) : kpiHtml(label, '—'));
        kpiEl.innerHTML = !total ? '' : kpiHtml('إجمالي الأقسام', formatInt(total))
            + kpiHtml('رئيسية / فرعية', `${formatInt(roots)} / ${formatInt(total - roots)}`)
            + fin('إجمالي إيراد الشهر', totalRev)
            + fin('إجمالي مصروف الشهر', totalExp)
            + fin('صافي ربح الشهر', totalRev - totalExp)
            + kpiHtml('الموظفون', signalsReady ? formatInt(totals.people) : '—')
            + kpiHtml('الأصناف', signalsReady ? formatInt(totals.items) : '—')
            + kpiHtml('أذون معلّقة', signalsReady ? formatInt(pending) : '—');
        kpiEl.hidden = !total;
        const issued = new Date().toLocaleDateString('ar-EG', { day: '2-digit', month: 'long', year: 'numeric' });
        const headEl = q('[data-v2-print-head]');
        if (headEl) {
            headEl.innerHTML = !total ? '' : '<div class="erp-print-head__title">سجل الأقسام</div>'
                + `<div class="erp-print-head__meta">إجمالي ${formatInt(total)} قسمًا — رئيسي ${formatInt(roots)} · فرعي ${formatInt(total - roots)} · صادر في ${esc(issued)}</div>`;
        }
        paintSummary();
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
        const ok = confirmFn(`حذف القسم «${row.name}»؟ ستُحذف إيرادات هذا القسم ومصاريفه معه تتابعيًا — لا رجعة.`);
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
            + `<span class="erp-badge" data-tone="brand"${s.rev > 0 ? '' : ' title="لا يوجد إيراد مرحّل لهذا القسم — النسبة غير قابلة للحساب"'}>نسبة التكلفة: <span class="erp-num" dir="ltr">${s.rev > 0 ? `${esc(Number(s.costRatio).toFixed(1))}%` : '—'}</span></span>`
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
            + `<div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid"><thead><tr><th>البيان</th><th>المبلغ</th><th>التاريخ</th></tr></thead><tbody>`
            + (d.revenues.map((r) => `<tr><td class="erp-td"><b>${esc(r.source)}</b></td><td class="erp-td">${money(r.amount, currency)}</td><td class="erp-td erp-text-muted">${esc(fD(r.date))}</td></tr>`).join('')
                || '<tr><td class="erp-td" colspan="3">لا إيرادات</td></tr>')
            + `</tbody></table></div>`
            + `<div class="erp-dash-controls"><h4>آخر المصاريف</h4><span class="erp-grow"></span>`
            + (canPost ? '<button type="button" class="erp-btn erp-btn--sm" data-v2-exp-add>مصروف +</button>' : '') + `</div>`
            + `<div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid"><thead><tr><th>البيان</th><th>النوع</th><th>المبلغ</th><th>التاريخ</th></tr></thead><tbody>`
            + (d.expenses.map((e) => {
                const [tone, label] = expKind(e);
                const neg = Number(e.amount || 0) < 0;
                return `<tr><td class="erp-td"><b>${esc(e.desc)}</b></td><td class="erp-td"><span class="erp-badge" data-tone="${tone}">${label}</span></td><td class="erp-td" style="color:${neg ? 'var(--erp-success-text)' : 'var(--erp-danger-text)'}"><b>${money(e.amount, currency)}</b></td><td class="erp-td erp-text-muted">${esc(fD(e.date))}</td></tr>`;
            }).join('') || '<tr><td class="erp-td" colspan="4">لا مصاريف</td></tr>')
            + `</tbody></table></div>`
            + `<h4>أذون الصرف للقسم <span class="erp-badge" data-tone="info">${formatInt(d.dispatches.length)} إذن</span></h4>`
            + `<div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid"><thead><tr><th>#</th><th>الأصناف</th><th>التاريخ</th><th>الحالة</th></tr></thead><tbody>`
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
        const kidsBtn = ev.target.closest('[data-v2-kids]');
        if (kidsBtn) {
            const code = String(kidsBtn.dataset.v2Kids);
            if (kidsOpen.has(code)) {kidsOpen.delete(code);} else {kidsOpen.add(code);}
            paint();
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
        if (ev.target.matches('[data-v2-mirrors]')) {showMirrors = !!ev.target.checked; paint(); return;}
        if (ev.target.matches('[data-v2-dfrom]')) {detailFrom = ev.target.value; openDetail(detailCode, false); return;}
        if (ev.target.matches('[data-v2-dto]')) {detailTo = ev.target.value; openDetail(detailCode, false); return;}
        if (ev.target.matches('[data-v2-link-pick]')) {
            const manual = q('[data-v2-link-manual]');
            const noInput = q('[data-v2-link-no]');
            const manualOn = ev.target.value === '__manual__';
            if (manual) {manual.hidden = !manualOn;}
            /* حقل اليدوي لا يُرسل إن كان مُخفىً: يفرغ كي لا يعلق رقمٌ قديم خلف اختيار الدليل */
            if (noInput && !manualOn) {noInput.value = '';}
        }
    });

    reload();
    return {
        el, reload, getRows: () => rows,
        destroy() {
            if (cashierRefreshTimer) {clearInterval(cashierRefreshTimer); cashierRefreshTimer = null;}
            table.destroy();
            el.remove();
        },
    };
}
