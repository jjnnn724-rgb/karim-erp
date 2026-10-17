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

import { createDataTable } from '../data-display/data-table.js?v=4.9.152';
import { fetchDepartments } from '../data/finance-repo.js?v=4.9.152';
import { formatInt, formatMoney, fetchCurrency } from '../data/reports-repo.js?v=4.9.152';
import { canWrite } from '../session.js?v=4.9.152';
import { departmentWriteEnabled } from '../write-flags.js?v=4.9.152';
import {
    DEPARTMENT_WRITE_ROLES, DEPARTMENT_ICON_OPTIONS,
    validateDepartmentForm, createDepartment, updateDepartment, deleteDepartment,
} from '../data/departments-write-repo.js?v=4.9.152';
import {
    cashierRevenueIn,
    computeDeptDetail, fetchDeptDetailBundle, createRevenue, createExpense,
} from '../data/dept-detail.js?v=4.9.152';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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
        + '<div class="erp-card__head"><h3 class="erp-card__title">الأقسام <span class="erp-eyebrow" dir="ltr" lang="en">Departments</span> <span class="erp-text-muted erp-text-sm" data-v2-count></span></h3>'
        + '<span class="erp-grow"></span>'
        + (canManage ? '<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-dept-add><i class="ji" data-i="plus" aria-hidden="true"></i><span>إضافة قسم</span></button>' : '')
        + '<button type="button" class="erp-btn erp-btn--sm" data-v2-print><i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span></button>'
        + '<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload><i class="ji" data-i="refresh" aria-hidden="true"></i><span>عرض</span></button>'
        + '</div>'
        + '<div class="erp-card__body erp-stack">'
        + '<p class="erp-text-sm erp-text-muted" data-v2-summary role="status" aria-live="polite"></p>'
        + '<div data-v2-dept-form></div>'
        + '<div data-v2-table></div></div></section>'
        + '<div data-v2-detail></div></div>';
}

export function mountDepartmentsScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 departments]', m);
    const confirmFn = typeof ctx.confirmFn === 'function' ? ctx.confirmFn
        : (m) => (typeof window !== 'undefined' && window.confirm ? window.confirm(m) : false);
    const canPost = canWrite(ctx.role, FIN_WRITE_ROLES);
    const canManage = canWrite(ctx.role, DEPARTMENT_WRITE_ROLES) && departmentWriteEnabled();

    let rows = [];
    let loading = false;
    let saving = false;
    let editingDept = null;
    let bundle = null;
    let detailCode = null;
    let detailFrom = '';
    let detailTo = '';
    let currency = '';

    host.insertAdjacentHTML('beforeend', template(canManage));
    const el = host.lastElementChild;
    const q = (s) => el.querySelector(s);
    const countEl = q('[data-v2-count]');
    const summaryEl = q('[data-v2-summary]');

    const table = createDataTable({
        caption: 'الأقسام - بيانات حية', mode: 'client', pageSize: 50, stickyHeader: true,
        emptyMessage: 'لا توجد أقسام مسجلة', rowKey: (r) => r.id,
        columns: [
            { key: 'code', header: 'الرمز', sortable: true, filterable: true, width: '110px', className: 'erp-mono' },
            { key: 'name', header: 'اسم القسم', sortable: true, filterable: true },
            {
                key: 'parent_code', header: 'الأب', width: '140px', render: (r) => (r.parent_code ? esc(String(r.parent_code)) : '<span class="erp-text-muted">— (أصلي)</span>'),
            },
            {
                key: 'icon', header: 'أيقونة', width: '110px',
                render: (r) => (r.icon ? esc(String(r.icon)) : '<span class="erp-text-muted">—</span>'),
            },
            {
                key: 'color', header: 'لون', width: '90px',
                render: (r) => (r.color ? '<span class="erp-dot" style="background:' + esc(String(r.color)) + '"></span> ' + esc(String(r.color)) : '<span class="erp-text-muted">—</span>'),
            },
            {
                key: 'detail', header: 'تفاصيل', width: '120px',
                render: (r) => `<button type="button" class="erp-btn erp-btn--sm" data-v2-detail="${esc(String(r.code))}">تفاصيل</button>`,
            },
            ...(canManage ? [{
                key: 'actions', header: 'إجراءات', width: '190px', align: 'center', className: 'erp-no-print',
                render: (r) => '<span class="erp-row-wrap">'
                    + `<button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-dept-edit="${esc(String(r.id))}"><i class="ji" data-i="pencil" aria-hidden="true"></i><span>تعديل</span></button>`
                    + `<button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-dept-del="${esc(String(r.id))}"><i class="ji" data-i="trash" aria-hidden="true"></i><span>حذف</span></button>`
                    + '</span>',
            }] : []),
        ],
    });
    q('[data-v2-table]').appendChild(table.el);

    function paint() {
        summaryEl.textContent = formatInt(rows.length) + ' قسمًا';
        countEl.textContent = rows.length ? '(' + formatInt(rows.length) + ')' : '';
        table.setRows(rows);
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
        const currentIcon = row && row.icon ? String(row.icon) : 'building';
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
        const { dept, stats: s, breakdown: bd } = d;
        const cashChips = d.cashNos.map((no) => {
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
