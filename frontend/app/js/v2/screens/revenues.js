/**
 * V2 — Revenues screen · شاشة 15 في سجل الترحيل (قراءة فقط)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Same per-screen contract as 01-14: read-only by construction, one
 * network door (v2/data/finance-repo.js), delegated listeners on a
 * per-mount root, loading guards, isConnected checks, destroy() on nav.
 *
 * LEGACY PARITY (features/finance.js:9-32)
 *   Default lens = current month (owner request 2026-10-08, finance.js:35);
 *   filters: dept (code), from, to, free search; net-shown total card;
 *   print. Newest first. The walk cap (newest 8,000 rows) is stated in
 *   the UI. Add/edit/delete are finance.edit doors — wave 2, not here.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.131';
import { fetchRevenues, fetchDepartments, isoDay, firstOfMonth } from '../data/finance-repo.js?v=4.9.131';
import { fetchCurrency, formatMoney, formatInt } from '../data/reports-repo.js?v=4.9.131';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

function moneyCell(v, currency) {
    const m = formatMoney(v, currency);
    return `<span class="erp-num" dir="ltr">${m.amount}</span>`
        + (m.hasUnit ? ` <span class="erp-text-sm erp-text-muted">${esc(m.unit)}</span>` : '');
}

function template(from, to) {
    return `
      <section class="erp-card erp-v2-revenues">
        <div class="erp-card__head">
          <h3 class="erp-card__title">الإيرادات
            <span class="erp-eyebrow" dir="ltr" lang="en">Revenues</span>
            <span class="erp-text-muted erp-text-sm" data-v2-count></span>
          </h3>
          <span class="erp-grow"></span>
          <label class="erp-text-sm erp-text-muted" for="v2rev-dept">القسم</label>
          <select class="erp-input" id="v2rev-dept"><option value="all">كل الأقسام</option></select>
          <label class="erp-text-sm erp-text-muted" for="v2rev-from">من</label>
          <input class="erp-input erp-input--ltr" id="v2rev-from" type="date" value="${esc(from)}">
          <label class="erp-text-sm erp-text-muted" for="v2rev-to">إلى</label>
          <input class="erp-input erp-input--ltr" id="v2rev-to" type="date" value="${esc(to)}" max="${esc(isoDay(0))}">
          <label class="erp-text-sm erp-text-muted" for="v2rev-search">بحث</label>
          <input class="erp-input" id="v2rev-search" type="search" placeholder="المصدر أو ملاحظات…">
          <button type="button" class="erp-btn erp-btn--sm" data-v2-clear hidden>عرض الكل</button>
          <button type="button" class="erp-btn erp-btn--sm" data-v2-print aria-label="طباعة الكشف">
            <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span>
          </button>
          <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload>
            <i class="ji" data-i="refresh" aria-hidden="true"></i><span>عرض</span>
          </button>
        </div>
        <div class="erp-card__body erp-stack">
          <p class="erp-text-sm erp-text-muted" data-v2-summary role="status" aria-live="polite"></p>
          <p class="erp-text-sm erp-text-muted">
            قراءة فقط — سجل الإيرادات (<span class="erp-addr" dir="ltr">/api/revenues</span>)،
            والصلاحية قررها الخادم وحده. الافتراضي الشهر الحالي؛ إفراغ
            التاريخين يعرض الكل. يُقرأ الأحدث حتى 8,000 حركة ثم تُطبَّق
            الفرزات محليًا. الإضافة والتعديل حماية
            <span class="erp-addr" dir="ltr">finance.edit</span> — موجة ثانية.
          </p>
          <div data-v2-table></div>
        </div>
      </section>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, notify?: (message:string, kind?:string)=>void}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, getRows: ()=>any[], destroy: ()=>void}}
 */
export function mountRevenuesScreen(host, _ctx = {}) {
    let allRows = [];
    let depts = [];
    let currency = '';
    let loading = false;
    let deptCode = 'all';

    host.insertAdjacentHTML('beforeend', template(firstOfMonth(), isoDay(0)));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const countEl = q('[data-v2-count]');
    const summaryEl = q('[data-v2-summary]');
    const clearBtn = q('[data-v2-clear]');
    const searchEl = q('#v2rev-search');

    const table = createDataTable({
        caption: 'سجل الإيرادات — بيانات حية',
        mode: 'client',
        pageSize: 50,
        stickyHeader: true,
        emptyMessage: 'لا توجد إيرادات في الفترة المحددة',
        emptyHint: 'وسّع الفترة أو اعرض الكل.',
        rowKey: (row) => row.id,
        columns: [
            {
                key: 'source', header: 'المصدر', sortable: true, filterable: true,
                render: (row) => (row.source ? esc(row.source) : `<span class="erp-text-muted">—</span>`),
            },
            { key: 'deptName', header: 'القسم', sortable: true, filterable: true, width: '150px' },
            {
                key: 'amount', header: 'المبلغ', type: 'number', sortable: true,
                width: '150px', align: 'end', value: (row) => row.amount,
                render: (row) => moneyCell(row.amount, currency),
            },
            {
                key: 'date', header: 'التاريخ', sortable: true, filterable: true,
                width: '120px', align: 'center', className: 'erp-tnum',
            },
            {
                key: 'notes', header: 'ملاحظات',
                render: (row) => (row.notes ? esc(row.notes) : `<span class="erp-text-muted">—</span>`),
            },
        ],
    });

    q('[data-v2-table]').appendChild(table.el);

    /** deptId stores the CODE — matched against departments.code (legacy parity). */
    function deptNameOf(code) {
        const d = depts.find((x) => String(x.code) === String(code));
        return d ? String(d.name) : (code ? String(code) : '—');
    }

    function viewRows() {
        const from = q('#v2rev-from').value;
        const to = q('#v2rev-to').value;
        const query = searchEl.value.trim().toLowerCase();
        const rows = allRows.filter((r) => {
            if (deptCode !== 'all' && String(r.deptId) !== deptCode) {return false;}
            if (from && r.date < from) {return false;}
            if (to && r.date > to) {return false;}
            if (query && !`${r.source || ''} ${r.notes || ''} ${r.deptId || ''}`.toLowerCase().includes(query)) {return false;}
            return true;
        }).map((r) => ({ ...r, deptName: deptNameOf(r.deptId) }));
        return { rows, filtered: !!(from || to || deptCode !== 'all' || query) };
    }

    function paint() {
        const { rows, filtered } = viewRows();
        const total = rows.reduce((s, r) => s + num(r.amount), 0);
        summaryEl.textContent = `إجمالي المعروض ${formatMoney(total, currency).amount}`
            + (currency ? ` ${currency}` : '')
            + ` · ${formatInt(rows.length)} إيرادًا`;
        countEl.textContent = rows.length ? `(${formatInt(rows.length)})` : '';
        clearBtn.hidden = !filtered;
        table.setRows(rows);
    }

    async function reload() {
        if (loading) {return;}
        loading = true;
        table.setLoading(true);
        try {
            const [revs, deptList, cur] = await Promise.all([
                fetchRevenues(),
                fetchDepartments().catch(() => []),
                fetchCurrency().catch(() => ''),
            ]);
            if (!el.isConnected) {return;}          // destroyed while in flight
            currency = String(cur ?? '');
            depts = deptList;
            allRows = revs;
            const sel = q('#v2rev-dept');
            if (sel) {
                sel.innerHTML = `<option value="all">كل الأقسام</option>`
                    + depts.map((d) => `<option value="${esc(d.code)}">${esc(d.name)}</option>`).join('');
                sel.value = deptCode;
            }
            paint();
        } catch (e) {
            if (!el.isConnected) {return;}
            allRows = [];
            table.setRows([]);
            summaryEl.textContent = '';
            countEl.textContent = '';
            table.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN'
                    ? 'لا صلاحية لعرض الإيرادات بهذا الحساب — القرار للخادم وحده.'
                    : `تعذّر تحميل الإيرادات: ${(e && e.message) || 'خطأ'}`));
        } finally {
            loading = false;
        }
    }

    el.addEventListener('click', (event) => {
        if (event.target.closest('[data-v2-clear]')) {
            q('#v2rev-from').value = '';
            q('#v2rev-to').value = '';
            searchEl.value = '';
            deptCode = 'all';
            const sel = q('#v2rev-dept');
            if (sel) {sel.value = 'all';}
            paint();
            return;
        }
        if (event.target.closest('[data-v2-print]')) {window.print(); return;}
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-erp-retry]')) {reload();}
    });
    el.addEventListener('change', (event) => {
        if (event.target.id === 'v2rev-dept') {deptCode = event.target.value; paint(); return;}
        if (event.target.matches('#v2rev-from, #v2rev-to')) {paint();}
    });
    el.addEventListener('input', (event) => {
        if (event.target.id === 'v2rev-search') {paint();}
    });

    reload();

    return {
        el,
        reload,
        getRows: () => viewRows().rows,
        destroy() {
            table.destroy();
            el.remove();
        },
    };
}
