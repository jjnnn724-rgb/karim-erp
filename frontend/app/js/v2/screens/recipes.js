/**
 * V2 - Recipes screen (reading only)
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.130';
import { fetchRecipes, fetchRecipesCatalog, indexCatalog, recipeToRow } from '../data/recipes-repo.js?v=4.9.130';
import { formatMoney, formatInt, fetchCurrency } from '../data/reports-repo.js?v=4.9.130';
import { fetchDepartments } from '../data/finance-repo.js?v=4.9.130';

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const money = (v, c) => { const m = formatMoney(v, c); return '<span class="erp-num" dir="ltr">' + m.amount + '</span>' + (m.hasUnit ? ' <span class="erp-text-sm erp-text-muted">' + esc(m.unit) + '</span>' : ''); };

function template() {
    return '<section class="erp-card erp-v2-recipes">'
        + '<div class="erp-card__head">'
        + '<h3 class="erp-card__title">الوصفات <span class="erp-eyebrow" dir="ltr" lang="en">Recipes</span> <span class="erp-text-muted erp-text-sm" data-v2-count></span></h3>'
        + '<span class="erp-grow"></span>'
        + '<button type="button" class="erp-btn erp-btn--sm" data-v2-print><i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span></button>'
        + '<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload><i class="ji" data-i="refresh" aria-hidden="true"></i><span>عرض</span></button>'
        + '</div>'
        + '<div class="erp-card__body erp-stack">'
        + '<p class="erp-text-sm erp-text-muted" data-v2-summary role="status" aria-live="polite"></p>'
        + '<p class="erp-text-sm erp-text-muted">قراءة فقط — سجل الوصفات (/api/recipes + catologue /api/pos/recipes/catalog)، والصلاحية قررها الخادم. ربط المكوّنات في POS موجة ثانية.</p>'
        + '<div data-v2-table></div>'
        + '</div></section>';
}

export function mountRecipesScreen(host, _ctx = {}) {
    let rows = [], loading = false, currency = '', depts = [];
    host.insertAdjacentHTML('beforeend', template());
    const el = host.lastElementChild; const q = (s) => el.querySelector(s);
    const countEl = q('[data-v2-count]'); const summaryEl = q('[data-v2-summary]');
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
            { key: 'costRatio', header: 'نسبة التكلفة', type: 'number', sortable: true, align: 'end', width: '120px', value: (r) => r.costRatio, render: (r) => '<span class="erp-num" dir="ltr">' + Math.round((r.costRatio || 0) * 100) + '%</span>' },
            { key: 'ingredients', header: 'مكوّنات', type: 'number', sortable: true, width: '110px', align: 'end', value: (r) => r.ingredients, render: (r) => (r.ingredients ? formatInt(r.ingredients) : '<span class="erp-text-muted">\u2014</span>') },
            { key: 'productLinked', header: 'ربط POS', width: '100px', align: 'center',
              render: (r) => (r.productLinked ? '<span class="erp-badge" data-tone="success">مرتبط</span>' : '<span class="erp-badge" data-tone="neutral">بدون</span>') },
        ],
    });
    q('[data-v2-table]').appendChild(table.el);

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
    el.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-v2-print]')) { window.print(); return; }
        if (ev.target.closest('[data-v2-reload]') || ev.target.closest('[data-erp-retry]')) { reload(); }
    });
    reload();
    return { el, reload, getRows: () => rows, destroy() { table.destroy(); el.remove(); } };
}
