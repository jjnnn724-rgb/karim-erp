/**
 * V2 — Recipes screen · سجل الوصفات + دورة الكتابة الكاملة
 * ═══════════════════════════════════════════════════════════════════════
 * READ  (سجل) mirrors /api/recipes + /api/pos/recipes/catalog — نفس صف
 *       recipes-repo.recipeToRow كما كان، بلا تغيير في العقد.
 * WRITE (الدورة) mirrors features/kitchen.js RECIPES القسم كاملًا
 *       (:1394-1477، مقروءًا سطرًا سطرًا):
 *         • showAddRecipeModal/addRecipe :1434/:1438 → إنشاء ثم مزامنة الكاشير
 *         • editRecipe/updateRecipe    :1451/:1457 → تعديل ثم مزامنة
 *         • deleteRecipe               :1471       → تأكيد ثم حذف
 *         • openRecipeManager          :1432       → صنف الكاشير + المكوّنات +
 *           المخزون + وحدات الخادم + الصورة + التكلفة
 *         • saveRecipeManager          :1433       → حفظ المكوّنات (الخادم
 *           يحدّث recipes.totalCost/costRatio بنفسه shift-routes.js:479-489)
 *         • uploadRecipeManagerImage   :1431       → POST صورة الصنف
 *       بوابة الكتابة كلها في data/recipes-edit-repo.js — ولا شبكة من هنا.
 *
 * ثلاثة انحرافات معلنة عن القديم
 *   1) costRatio يُعرض نسبةً مئوية كما يخزّنه الخادم (NUMERIC(10,2) +
 *      shift-routes.js:482). السجل القديم في V2 كان يضربه في 100 مرة ثانية
 *      فيظهر 3000% لوصفة 30% — صُحّح لأن التقارير والقديم يقرآن النسبة.
 *   2) «المكوّنات والصورة» تظهر لأدوار وحدة الكاشير (admin|manager) وحدها —
 *      مساراتها requireRole('manager','admin') (shift-routes.js:295/:362/:411)
 *      فرسم الزر لغيرهم وعدٌ لا يُوفى. ودفعة المزامنة بعد الحفظ مرهونة بنفس
 *      الشرط: القديم كان يزامن لكل دور فيفشل 403 عند المطبخ (kitchen.js:1397).
 *   3) لا PUT ثانٍ على /recipes بعد حفظ المكوّنات — الخادم يحدّث الوصفة بنفسه.
 *
 * كل الأرقام والتحقق قرار الخادم: لا حساب وحدات هنا، ولا حساب تكلفة سطر —
 * extended_cost يرد من GET /pos/products/:id/ingredients (shift-routes.js:402).
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.169';
import { fetchRecipes, fetchRecipesCatalog, indexCatalog, recipeToRow } from '../data/recipes-repo.js?v=4.9.169';
import { formatMoney, formatInt, fetchCurrency } from '../data/reports-repo.js?v=4.9.169';
import { fetchDepartments } from '../data/finance-repo.js?v=4.9.169';
import { canWrite } from '../session.js?v=4.9.169';
import { recipeWriteEnabled } from '../write-flags.js?v=4.9.169';
import {
    RECIPE_WRITE_ROLES, RECIPE_BOM_ROLES, costRatioPercent,
    ingredientLine, newIngredientLine, createRecipe, updateRecipe, removeRecipe,
    syncRecipeToCashier, fetchProductIngredients, fetchRecipeInventory,
    fetchRecipeUnits, saveProductIngredients, uploadProductImage, removeProductImage,
} from '../data/recipes-edit-repo.js?v=4.9.169';

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const money = (v, c) => { const m = formatMoney(v, c); return '<span class="erp-num" dir="ltr">' + m.amount + '</span>' + (m.hasUnit ? ' <span class="erp-text-sm erp-text-muted">' + esc(m.unit) + '</span>' : ''); };

/** نسبة التكلفة للعرض: الخانة عددُ نسبةٍ مئوية — لا ضرب في 100. */
const ratioText = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(1) : '0.0') + '%';

function template(canEdit) {
    return '<section class="erp-card erp-v2-recipes">'
        + '<div class="erp-card__head">'
        + '<h3 class="erp-card__title">الوصفات <span class="erp-eyebrow" dir="ltr" lang="en">Recipes</span> <span class="erp-text-muted erp-text-sm" data-v2-count></span></h3>'
        + '<span class="erp-grow"></span>'
        + (canEdit
            ? '<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-rec-add><i class="ji" data-i="plus" aria-hidden="true"></i><span>وصفة جديدة</span></button>'
            : '')
        + '<button type="button" class="erp-btn erp-btn--sm" data-v2-print><i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span></button>'
        + '<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload><i class="ji" data-i="refresh" aria-hidden="true"></i><span>عرض</span></button>'
        + '</div>'
        + '<div class="erp-card__body erp-stack">'
        + '<p class="erp-text-sm erp-text-muted" data-v2-summary role="status" aria-live="polite"></p>'
        + '<p class="erp-text-sm erp-text-muted">دورة كاملة: إنشاء وتعديل وحذف الوصفة من هنا، وصورة الصنف ومكوّناته عبر مسارات الكاشير لأدوار المدير. الكميات والوحدات يحوّلها الخادم ويحسب تكلفتها ويرفض غير المتوافق — لا حساب في المتصفح.</p>'
        + '<div data-v2-table></div>'
        + '<div class="erp-no-print" data-v2-editor hidden></div>'
        + '</div></section>';
}

export function mountRecipesScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 recipes]', m);
    const confirmFn = typeof ctx.confirmFn === 'function' ? ctx.confirmFn : (m) => window.confirm(m);
    /* دورة الوصفات كلها (بما فيها المكوّنات) خلف علم كتابة مستقل OFF افتراضيًا. */
    const writesOpen = recipeWriteEnabled();
    const canEdit = canWrite(ctx.role, RECIPE_WRITE_ROLES) && writesOpen;
    const canBom = canWrite(ctx.role, RECIPE_BOM_ROLES) && writesOpen;

    let rows = [], loading = false, saving = false, currency = '', depts = [];
    let panelSeq = 0;
    let panel = null;   // { kind:'basic'|'bom', recipe, productId, imageUrl, lines, inventory, units, msg }

    host.insertAdjacentHTML('beforeend', template(canEdit));
    const el = host.lastElementChild; const q = (s) => el.querySelector(s);
    const countEl = q('[data-v2-count]'); const summaryEl = q('[data-v2-summary]');
    const editorEl = q('[data-v2-editor]');

    const table = createDataTable({
        caption: 'الوصفات - بيانات حية', mode: 'client', pageSize: 50, stickyHeader: true,
        emptyMessage: 'لا توجد وصفات مسجلة', rowKey: (r) => r.id,
        columns: [
            { key: 'name', header: 'اسم الوصفة', sortable: true, filterable: true,
              render: (r) => '<span class="erp-row-wrap">'
                  + (r.imageUrl ? '<img src="' + esc(r.imageUrl) + '" alt="" width="28" height="28" loading="lazy">' : '')
                  + '<span>' + esc(r.name) + '</span></span>' },
            { key: 'deptCode', header: 'القسم', sortable: true, filterable: true, width: '140px',
              render: (r) => { const d = (depts || []).find((x) => String(x.code) === String(r.deptCode)); return esc(d ? d.name : (r.deptCode || '\u2014')); } },
            { key: 'sellingPrice', header: 'سعر البيع', type: 'number', sortable: true, align: 'end', width: '120px', value: (r) => r.sellingPrice, render: (r) => money(r.sellingPrice, currency) },
            { key: 'totalCost', header: 'التكلفة', type: 'number', sortable: true, align: 'end', width: '120px', value: (r) => r.totalCost, render: (r) => money(r.totalCost, currency) },
            { key: 'costRatio', header: 'نسبة التكلفة', type: 'number', sortable: true, align: 'end', width: '120px', value: (r) => r.costRatio, render: (r) => '<span class="erp-num" dir="ltr">' + ratioText(r.costRatio) + '</span>' },
            { key: 'ingredients', header: 'مكوّنات', type: 'number', sortable: true, width: '110px', align: 'end', value: (r) => r.ingredients, render: (r) => (r.ingredients ? formatInt(r.ingredients) : '<span class="erp-text-muted">\u2014</span>') },
            { key: 'productLinked', header: 'ربط POS', width: '100px', align: 'center',
              render: (r) => (r.productLinked ? '<span class="erp-badge" data-tone="success">مرتبط</span>' : '<span class="erp-badge" data-tone="neutral">بدون</span>') },
            { key: 'actions', header: 'إجراءات', width: '260px', align: 'center', className: 'erp-no-print',
              render: (r) => '<span class="erp-row-wrap">'
                  + (canEdit ? '<button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-rec-edit="' + esc(String(r.id)) + '"><i class="ji" data-i="pencil" aria-hidden="true"></i><span>تعديل</span></button>' : '')
                  + (canBom ? '<button type="button" class="erp-btn erp-btn--sm" data-v2-rec-bom="' + esc(String(r.id)) + '"><i class="ji" data-i="utensils" aria-hidden="true"></i><span>المكوّنات</span></button>' : '')
                  + (canEdit ? '<button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-rec-del="' + esc(String(r.id)) + '"><i class="ji" data-i="trash" aria-hidden="true"></i><span>حذف</span></button>' : '')
                  + '</span>' },
        ],
    });
    q('[data-v2-table]').appendChild(table.el);

    const moneyPlain = (v) => { const m = formatMoney(v, currency); return m.hasUnit ? m.amount + ' ' + m.unit : m.amount; };
    const rowById = (id) => (rows || []).find((r) => String(r.id) === String(id));

    function paint() {
        summaryEl.textContent = formatInt(rows.length) + ' وصفة' + (currency ? ' · العرض: ' + currency : '');
        countEl.textContent = rows.length ? '(' + formatInt(rows.length) + ')' : '';
        table.setRows(rows);
    }

    async function reload() {
        if (loading) { return; }
        loading = true; table.setLoading(true);
        try {
            const [recipes, catalog, deps, cur] = await Promise.all([
                fetchRecipes(),
                fetchRecipesCatalog().catch(() => []),
                fetchDepartments().catch(() => []),
                fetchCurrency().catch(() => ''),
            ]);
            if (!el.isConnected) { return; }
            currency = String(cur ?? ''); depts = deps;
            const map = indexCatalog(catalog);
            rows = recipes.map((r) => recipeToRow(r, map));
            paint();
        } catch (e) {
            if (!el.isConnected) { return; }
            rows = []; table.setRows([]);
            summaryEl.textContent = ''; countEl.textContent = '';
            table.setError(e && e.message === 'UNAUTHORIZED' ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN' ? 'لا صلاحية لعرض الوصفات بهذا الحساب — القرار للخادم وحده.'
                    : 'تعذّر تحميل الوصفات: ' + ((e && e.message) || 'خطأ')));
        } finally { loading = false; }
    }

    /* ── اللوحة: حارس الإغلاق ─────────────────────────────────────────────── */

    function closePanel() {
        panelSeq += 1;
        panel = null;
        editorEl.hidden = true;
        editorEl.innerHTML = '';
    }

    function editorMsg(text) {
        const box = editorEl.querySelector('[data-v2-editor-msg]');
        if (box) { box.textContent = text; }
        notify(text);
    }

    const readField = (name) => {
        const f = editorEl.querySelector('[data-v2-f="' + name + '"]');
        return f ? f.value : '';
    };

    /* ── محرّر الوصفة (إنشاء/تعديل) ────────────────────────────────────────── */

    function updateRatio() {
        const box = editorEl.querySelector('[data-v2-f-ratio]');
        if (!box) { return; }
        box.textContent = ratioText(costRatioPercent(readField('sellingPrice'), readField('totalCost')));
    }

    function paintBasic(recipe) {
        closePanel();
        const editing = !!recipe;
        const deptOpts = '<option value="">\u2014 بلا قسم \u2014</option>'
            + (depts || []).map((d) => '<option value="' + esc(String(d.code)) + '"'
                + (recipe && String(recipe.deptCode) === String(d.code) ? ' selected' : '') + '>' + esc(d.name) + '</option>').join('');
        editorEl.innerHTML = '<section class="erp-card">'
            + '<div class="erp-card__head">'
            + '<h3 class="erp-card__title">' + (editing ? 'تعديل وصفة' : 'إضافة وصفة') + ' <span class="erp-eyebrow" dir="ltr" lang="en">Recipe</span></h3>'
            + '<span class="erp-grow"></span>'
            + '<button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-close>إغلاق</button>'
            + '</div>'
            + '<div class="erp-card__body erp-stack">'
            + '<div class="erp-dash-controls">'
            + '<label class="erp-text-sm erp-text-muted">الاسم</label>'
            + '<input class="erp-input" data-v2-f="name" type="text" value="' + esc(recipe ? recipe.name : '') + '">'
            + '<label class="erp-text-sm erp-text-muted">القسم</label>'
            + '<select class="erp-select" data-v2-f="deptId">' + deptOpts + '</select>'
            + '<label class="erp-text-sm erp-text-muted">سعر البيع</label>'
            + '<input class="erp-input erp-input--ltr" data-v2-f="sellingPrice" type="number" min="0" step="0.01" value="' + esc(String(recipe ? recipe.sellingPrice : '')) + '">'
            + '<label class="erp-text-sm erp-text-muted">التكلفة</label>'
            + '<input class="erp-input erp-input--ltr" data-v2-f="totalCost" type="number" min="0" step="0.01" value="' + esc(String(recipe ? recipe.totalCost : '')) + '">'
            + '<span class="erp-badge" data-tone="brand">نسبة التكلفة: <span class="erp-num" dir="ltr" data-v2-f-ratio></span></span>'
            + '<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-save><i class="ji" data-i="save" aria-hidden="true"></i><span>حفظ</span></button>'
            + '</div>'
            + '<p class="erp-text-sm erp-text-muted">التكلفة هنا تقديرية للوصفة قبل ربط المكوّنات؛ وحفظ المكوّنات يكتب التكلفة الفعلية في نفس الحقل.</p>'
            + '<p class="erp-text-sm" style="color:var(--erp-danger-text)" data-v2-editor-msg role="alert"></p>'
            + '</div></section>';
        panel = { kind: 'basic', recipe: recipe || null };
        editorEl.hidden = false;
        updateRatio();
        editorEl.scrollIntoView({ block: 'nearest' });
    }

    async function saveBasic() {
        if (saving || !panel || panel.kind !== 'basic') { return; }
        const editing = panel.recipe;
        const form = { name: readField('name'), deptId: readField('deptId'), sellingPrice: readField('sellingPrice'), totalCost: readField('totalCost') };
        if (!String(form.name).trim()) { editorMsg('أدخل اسم الوصفة'); return; }
        saving = true;
        try {
            const saved = editing ? await updateRecipe(editing.id, form) : await createRecipe(form);
            if (!el.isConnected) { return; }
            const id = editing ? editing.id : (saved && saved.id);
            closePanel();
            notify(editing ? 'تم التحديث' : 'تم إضافة الوصفة');
            syncQuiet(id);
            await reload();
        } catch (e) {
            if (el.isConnected) { editorMsg((e && e.message) || 'تعذر حفظ الوصفة'); }
        } finally { saving = false; }
    }

    /** دفعة المزامنة مع الكاشير: لأدوار وحدة الكاشير وحدها (shift-routes.js:362). */
    function syncQuiet(id) {
        if (!canBom || id == null) { return; }
        syncRecipeToCashier(id).catch(() => notify('تم حفظ الوصفة لكن تعذر مزامنتها مع الكاشير'));
    }

    async function doDelete(id) {
        if (saving) { return; }
        const ok = await confirmFn('حذف الوصفة؟');
        if (!ok) { return; }
        saving = true;
        try {
            await removeRecipe(id);
            if (!el.isConnected) { return; }
            closePanel();
            notify('تم الحذف');
            await reload();
        } catch (e) {
            if (el.isConnected) { notify((e && e.message) || 'تعذر الحذف'); }
        } finally { saving = false; }
    }

    /* ── محرّر المكوّنات والصورة ───────────────────────────────────────────── */

    function invOptionsHtml(p, selectedId) {
        return (p.inventory || []).map((i) => '<option value="' + esc(String(i.id)) + '"'
            + (String(i.id) === String(selectedId) ? ' selected' : '') + '>'
            + esc(i.name) + ' \u2014 ' + esc(i.unit || 'وحدة') + '</option>').join('');
    }

    function unitOptionsHtml(p, unit) {
        const list = p.units || [];
        const known = list.some((u) => String(u.value) === String(unit));
        const extra = known ? '' : '<option value="' + esc(String(unit)) + '" selected>' + esc(String(unit)) + '</option>';
        return extra + list.map((u) => '<option value="' + esc(String(u.value)) + '"'
            + (String(u.value) === String(unit) ? ' selected' : '') + '>' + esc(u.label) + '</option>').join('');
    }

    function costCellHtml(line) {
        if (line.unit_error) { return '<span class="erp-badge" data-tone="danger">' + esc(line.unit_error) + '</span>'; }
        if (line.extended_cost == null) { return '<span class="erp-text-muted">\u2014</span>'; }
        return money(line.extended_cost, currency);
    }

    function bomRowsHtml(p) {
        if (!p.lines.length) { return '<tr><td class="erp-td" colspan="6">لم تُضف مكوّنات بعد</td></tr>'; }
        return p.lines.map((line, i) => '<tr>'
            + '<td class="erp-td"><select class="erp-select" data-v2-bom-inv="' + i + '">' + invOptionsHtml(p, line.inventory_id) + '</select></td>'
            + '<td class="erp-td"><input class="erp-input erp-input--ltr" type="number" min="0.0001" step="0.0001" value="' + esc(String(line.quantity_per_unit)) + '" data-v2-bom-qty="' + i + '"></td>'
            + '<td class="erp-td"><select class="erp-select" data-v2-bom-unit="' + i + '">' + unitOptionsHtml(p, line.unit) + '</select></td>'
            + '<td class="erp-td"><input class="erp-input erp-input--ltr" type="number" min="0" max="100" step="0.01" value="' + esc(String(line.waste_percent)) + '" data-v2-bom-waste="' + i + '"></td>'
            + '<td class="erp-td" data-v2-bom-cost="' + i + '">' + costCellHtml(line) + '</td>'
            + '<td class="erp-td"><button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-bom-rm="' + i + '"><i class="ji" data-i="trash" aria-hidden="true"></i><span>حذف</span></button></td>'
            + '</tr>').join('');
    }

    function paintBom() {
        const p = panel;
        if (!p || p.kind !== 'bom') { return; }
        if (p.loading) {
            editorEl.innerHTML = '<section class="erp-card"><div class="erp-card__body erp-stack">'
                + '<p class="erp-text-sm erp-text-muted" role="status">جارٍ تجهيز محرّر المكوّنات…</p>'
                + '<div class="erp-dash-controls"><button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-close>إغلاق</button></div>'
                + '</div></section>';
            return;
        }
        editorEl.innerHTML = '<section class="erp-card">'
            + '<div class="erp-card__head">'
            + '<h3 class="erp-card__title"><i class="ji" data-i="utensils" aria-hidden="true"></i> ' + esc(p.recipe.name)
            + ' <span class="erp-eyebrow" dir="ltr" lang="en">Components</span></h3>'
            + '<span class="erp-grow"></span>'
            + '<button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-close>إغلاق</button>'
            + '</div>'
            + '<div class="erp-card__body erp-stack">'
            + '<div class="erp-dash-controls">'
            + '<span class="erp-badge" data-tone="' + (p.productId == null ? 'danger' : 'success') + '">صنف الكاشير: <span class="erp-num" dir="ltr">' + esc(p.productId == null ? '\u2014' : String(p.productId)) + '</span></span>'
            + '<span class="erp-badge" data-tone="brand">مكوّنات: <span class="erp-num" dir="ltr">' + formatInt(p.lines.length) + '</span></span>'
            + '</div>'
            + '<div class="erp-dash-controls">'
            + '<span>' + (p.imageUrl ? '<img src="' + esc(p.imageUrl) + '" alt="" width="72" height="72" loading="lazy">' : '<span class="erp-text-muted">لا توجد صورة</span>') + '</span>'
            + '<label class="erp-text-sm erp-text-muted">صورة الصنف</label>'
            + '<input class="erp-input" type="file" accept="image/jpeg,image/png,image/webp" data-v2-bom-file>'
            + '<button type="button" class="erp-btn erp-btn--sm" data-v2-bom-upload><i class="ji" data-i="camera" aria-hidden="true"></i><span>رفع الصورة</span></button>'
            + (p.imageUrl ? '<button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-bom-imgdel>حذف الصورة</button>' : '')
            + '</div>'
            + '<div class="erp-table__scroll"><table class="erp-table__grid">'
            + '<thead><tr><th>المكوّن</th><th>الكمية</th><th>الوحدة</th><th>الهدر %</th><th>تكلفة السطر</th><th>حذف</th></tr></thead>'
            + '<tbody data-v2-bom-rows>' + bomRowsHtml(p) + '</tbody></table></div>'
            + '<div class="erp-dash-controls">'
            + '<button type="button" class="erp-btn erp-btn--sm" data-v2-bom-add><i class="ji" data-i="plus" aria-hidden="true"></i><span>إضافة مكوّن</span></button>'
            + '<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-bom-save><i class="ji" data-i="save" aria-hidden="true"></i><span>حفظ المكوّنات</span></button>'
            + '</div>'
            + '<p class="erp-text-sm erp-text-muted">تكلفة السطر تقرأ من الخادم بعد كل حفظ — أي تعديل على كمية أو وحدة أو هدر يمسحها حتى الحفظ.</p>'
            + '<p class="erp-text-sm" style="color:var(--erp-danger-text)" data-v2-editor-msg role="alert">' + esc(p.msg || '') + '</p>'
            + '</div></section>';
    }

    async function openBom(recipe) {
        const seq = ++panelSeq;
        panel = { kind: 'bom', recipe, productId: null, imageUrl: recipe.imageUrl || '', loading: true, lines: [], inventory: [], units: [], msg: '' };
        paintBom();
        editorEl.hidden = false;
        editorEl.scrollIntoView({ block: 'nearest' });
        try {
            const product = await syncRecipeToCashier(recipe.id);
            if (!product || product.id == null) { throw new Error('تعذر إنشاء صنف الكاشير للوصفة'); }
            const [ingredientRows, inventory, units] = await Promise.all([
                fetchProductIngredients(product.id),
                fetchRecipeInventory().catch(() => []),
                fetchRecipeUnits().catch(() => []),
            ]);
            if (!el.isConnected || panelSeq !== seq) { return; }
            panel.productId = product.id;
            panel.imageUrl = product.image_url || panel.imageUrl;
            panel.lines = ingredientRows.map(ingredientLine);
            panel.inventory = inventory;
            panel.units = units;
            panel.loading = false;
            paintBom();
        } catch (e) {
            if (!el.isConnected || panelSeq !== seq) { return; }
            panel.loading = false;
            panel.msg = (e && e.message) || 'تعذر تجهيز محرّر المكوّنات';
            paintBom();
        }
    }

    /** تعديل سطر يمسح رقمه المخزّن — المعروض يبقى رقم الخادم أو لا شيء. */
    function markLineDirty(i) {
        const line = panel && panel.lines ? panel.lines[i] : null;
        if (!line) { return; }
        line.extended_cost = null;
        line.unit_error = null;
        const cell = editorEl.querySelector('[data-v2-bom-cost="' + i + '"]');
        if (cell) { cell.innerHTML = costCellHtml(line); }
    }

    function addBomLine() {
        if (!panel || panel.kind !== 'bom') { return; }
        if (!panel.inventory.length) { editorMsg('لا أصناف مخزون متاحة لإضافتها كمكوّن'); return; }
        const first = panel.inventory[0];
        if (panel.lines.some((l) => String(l.inventory_id) === String(first.id))) { editorMsg('هذا المكون موجود بالفعل'); return; }
        panel.lines.push(newIngredientLine(first, panel.units));
        paintBom();
    }

    function removeBomLine(i) {
        if (!panel || panel.kind !== 'bom') { return; }
        panel.lines.splice(i, 1);
        paintBom();
    }

    async function saveBom() {
        if (saving || !panel || panel.kind !== 'bom') { return; }
        if (panel.productId == null) { editorMsg('تعذر تجهيز صنف الكاشير — أعد فتح المحرّر'); return; }
        const bad = panel.lines.some((l) => !Number.isFinite(Number(l.quantity_per_unit)) || Number(l.quantity_per_unit) <= 0);
        if (bad) { editorMsg('كل كميات المكونات يجب أن تكون أكبر من صفر'); return; }
        saving = true;
        try {
            const res = await saveProductIngredients(panel.productId, panel.lines);
            if (!el.isConnected) { return; }
            const totalCost = res && res.total_cost != null ? res.total_cost : null;
            notify(totalCost == null ? 'تم حفظ مكوّنات الوصفة' : 'تم حفظ التكلفة ' + moneyPlain(totalCost) + ' للوصفة');
            const fresh = await fetchProductIngredients(panel.productId);
            if (!el.isConnected) { return; }
            panel.lines = fresh.map(ingredientLine);
            panel.msg = '';
            paintBom();
            await reload();
        } catch (e) {
            if (el.isConnected) { editorMsg((e && e.message) || 'تعذر حفظ مكونات الوصفة'); }
        } finally { saving = false; }
    }

    async function uploadBomImage() {
        if (saving || !panel || panel.kind !== 'bom' || panel.productId == null) { return; }
        const input = editorEl.querySelector('[data-v2-bom-file]');
        const file = input && input.files && input.files[0];
        if (!file) { editorMsg('اختر صورة أولاً'); return; }
        saving = true;
        try {
            const res = await uploadProductImage(panel.productId, file);
            if (!el.isConnected) { return; }
            panel.imageUrl = (res && res.image_url) || panel.imageUrl;
            panel.msg = '';
            paintBom();
            notify('تم حفظ صورة الوصفة في قاعدة البيانات');
            await reload();
        } catch (e) {
            if (el.isConnected) { editorMsg((e && e.message) || 'تعذر رفع الصورة'); }
        } finally { saving = false; }
    }

    async function deleteBomImage() {
        if (saving || !panel || panel.kind !== 'bom' || panel.productId == null) { return; }
        const ok = await confirmFn('حذف صورة الصنف؟');
        if (!ok) { return; }
        saving = true;
        try {
            await removeProductImage(panel.productId);
            if (!el.isConnected) { return; }
            panel.imageUrl = '';
            panel.msg = '';
            paintBom();
            notify('تم حذف صورة الصنف');
            await reload();
        } catch (e) {
            if (el.isConnected) { editorMsg((e && e.message) || 'تعذر حذف الصورة'); }
        } finally { saving = false; }
    }

    /* ── الأحداث: مفوَّضة على الجذر، بلا معالج سطري ─────────────────────────── */

    el.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-v2-print]')) { window.print(); return; }
        if (ev.target.closest('[data-v2-reload]') || ev.target.closest('[data-erp-retry]')) { reload(); return; }
        if (ev.target.closest('[data-v2-close]')) { closePanel(); return; }
        if (ev.target.closest('[data-v2-rec-add]')) { paintBasic(null); return; }
        if (ev.target.closest('[data-v2-save]')) { saveBasic(); return; }
        if (ev.target.closest('[data-v2-bom-add]')) { addBomLine(); return; }
        if (ev.target.closest('[data-v2-bom-save]')) { saveBom(); return; }
        if (ev.target.closest('[data-v2-bom-upload]')) { uploadBomImage(); return; }
        if (ev.target.closest('[data-v2-bom-imgdel]')) { deleteBomImage(); return; }
        const rm = ev.target.closest('[data-v2-bom-rm]');
        if (rm) { removeBomLine(Number(rm.dataset.v2BomRm)); return; }
        const edit = ev.target.closest('[data-v2-rec-edit]');
        if (edit) { const r = rowById(edit.dataset.v2RecEdit); if (r) { paintBasic(r); } return; }
        const bom = ev.target.closest('[data-v2-rec-bom]');
        if (bom) { const r = rowById(bom.dataset.v2RecBom); if (r) { openBom(r); } return; }
        const del = ev.target.closest('[data-v2-rec-del]');
        if (del) { doDelete(del.dataset.v2RecDel); }
    });

    el.addEventListener('change', (ev) => {
        const inv = ev.target.closest('[data-v2-bom-inv]');
        if (inv) {
            const i = Number(inv.dataset.v2BomInv);
            if (panel && panel.lines[i]) { panel.lines[i].inventory_id = Number(inv.value); markLineDirty(i); }
            return;
        }
        const unit = ev.target.closest('[data-v2-bom-unit]');
        if (unit) {
            const i = Number(unit.dataset.v2BomUnit);
            if (panel && panel.lines[i]) { panel.lines[i].unit = String(unit.value); markLineDirty(i); }
        }
    });

    el.addEventListener('input', (ev) => {
        const qty = ev.target.closest('[data-v2-bom-qty]');
        if (qty) {
            const i = Number(qty.dataset.v2BomQty);
            if (panel && panel.lines[i]) { panel.lines[i].quantity_per_unit = Number(qty.value); markLineDirty(i); }
            return;
        }
        const waste = ev.target.closest('[data-v2-bom-waste]');
        if (waste) {
            const i = Number(waste.dataset.v2BomWaste);
            if (panel && panel.lines[i]) { panel.lines[i].waste_percent = Number(waste.value); markLineDirty(i); }
            return;
        }
        if (ev.target.closest('[data-v2-f]')) { updateRatio(); }
    });

    reload();
    return { el, reload, getRows: () => rows, destroy() { closePanel(); table.destroy(); el.remove(); } };
}
