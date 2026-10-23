/**
 * V2 — Wh-moves screen: حركات المخزون (قراءة فقط)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * LEGACY (features/warehouse.js:231-269): registers of /api/inventoryTx
 * with from/to filter + max 300 display + print. V2 bounded to newest
 * 8,000 rows; newest-first; client-side date filter (table/page also).
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.197';
import { invTxToRow, INV_TYPE_TONE, fetchInventoryTx, isoDay, firstOfMonth } from '../data/warehouse-repo.js?v=4.9.197';
import { fetchCurrency, formatMoney, formatInt } from '../data/reports-repo.js?v=4.9.197';

const esc = (v) => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const money = (v, c) => { const m = formatMoney(v, c); return `<span class="erp-num" dir="ltr">${m.amount}</span>` + (m.hasUnit ? ` <span class="erp-text-sm erp-text-muted">${esc(m.unit)}</span>` : ''); };

function badge(tone, label) {
    return `<span class="erp-badge" data-tone="${esc(tone)}">${esc(label)}</span>`;
}

function template(from, to) {
    return `
      <section class="erp-card erp-v2-warehouse">
        <div class="erp-card__head">
          <h3 class="erp-card__title">حركات المخزون
            <span class="erp-eyebrow" dir="ltr" lang="en">Stock Movements</span>
            <span class="erp-text-muted erp-text-sm" data-v2-count></span>
          </h3>
          <span class="erp-grow"></span>
          <label class="erp-text-sm erp-text-muted" for="v2mov-from">من</label>
          <input class="erp-input erp-input--ltr" id="v2mov-from" type="date" value="${esc(from)}">
          <label class="erp-text-sm erp-text-muted" for="v2mov-to">إلى</label>
          <input class="erp-input erp-input--ltr" id="v2mov-to" type="date" value="${esc(to)}" max="${esc(isoDay(0))}">
          <button type="button" class="erp-btn erp-btn--sm" data-v2-clear hidden>عرض الكل</button>
          <button type="button" class="erp-btn erp-btn--sm" data-v2-print aria-label="طباعة"><i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span></button>
          <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload><i class="ji" data-i="refresh" aria-hidden="true"></i><span>عرض</span></button>
        </div>
        <div class="erp-card__body erp-stack">
          <p class="erp-text-sm erp-text-muted" data-v2-summary role="status" aria-live="polite"></p>
          <p class="erp-text-sm erp-text-muted">
            قراءة فقط — سجل حركات المخزون، والصلاحية محكومة بالأدوار. حركات
            8,000 الأحدث فقط (الأحدث أولًا). أنواع الحركة الواردة والصادرة
            والمرتجعة والتسوية تُعرض كما هي، ومنها «افتتاحي» وحركات مرحّلة من
            النظام الأساسي.
          </p>
          <div data-v2-table></div>
        </div>
      </section>`;
}

export function mountWhMovesScreen(host, _ctx = {}) {
    let rows = []; let loading = false; let currency = '';
    host.insertAdjacentHTML('beforeend', template(firstOfMonth(), isoDay(0)));
    const el = host.lastElementChild; const q = (s) => el.querySelector(s);
    const countEl = q('[data-v2-count]'); const summaryEl = q('[data-v2-summary]'); const clearBtn = q('[data-v2-clear]');
    const table = createDataTable({
        caption: 'حركات المخزون — بيانات حية', mode: 'client', pageSize: 50, stickyHeader: true,
        emptyMessage: 'لا توجد حركات في الفترة', emptyHint: 'وسّع الفترة.', rowKey: (r) => r.id,
        columns: [
            { key: 'date', header: 'التاريخ', sortable: true, width: '110px', align: 'center', className: 'erp-tnum' },
            { key: 'itemName', header: 'الصنف', sortable: true, filterable: true },
            {
                key: 'typeLabel', header: 'النوع', sortable: true, filterable: true, width: '110px',
                value: (r) => r.typeLabel, render: (r) => badge(r.typeKnown ? INV_TYPE_TONE[r.type] : 'neutral',
                    r.typeLabel + (r.type && !r.typeKnown ? ` (${esc(r.type)})` : '')),
            },
            { key: 'qty', header: 'الكمية', type: 'number', sortable: true, width: '100px', align: 'end', value: (r) => r.qty, render: (r) => `<span class="erp-num" dir="ltr">${formatInt(r.qty)}</span>` },
            { key: 'cost', header: 'السعر', type: 'number', sortable: true, width: '110px', align: 'end', value: (r) => r.cost, render: (r) => money(r.cost, currency) },
            { key: 'totalValue', header: 'القيمة', type: 'number', sortable: true, width: '120px', align: 'end', value: (r) => r.totalValue, render: (r) => money(r.totalValue, currency) },
            {
                key: 'ref', header: 'المرجع',
                render: (r) => (r.ref ? esc(String(r.ref)) : `<span class="erp-text-muted">—</span>`),
            },
        ],
    });
    q('[data-v2-table]').appendChild(table.el);

    function viewRows() {
        const from = q('#v2mov-from').value, to = q('#v2mov-to').value;
        const out = rows.filter((r) => {
            if (from && r.date < from) {return false;}
            if (to && r.date > to) {return false;}
            return true;
        });
        return { out, filtered: !!(from || to) };
    }
    function paint() {
        const { out, filtered } = viewRows();
        summaryEl.textContent = `${formatInt(out.length)} حركة` + (filtered ? '' : ' · كل الفترات');
        countEl.textContent = out.length ? `(${formatInt(out.length)})` : '';
        clearBtn.hidden = !filtered;
        table.setRows(out);
    }
    async function reload() {
        if (loading) {return;}
        loading = true; table.setLoading(true);
        try {
            const [txs, cur] = await Promise.all([fetchInventoryTx(), fetchCurrency().catch(() => '')]);
            if (!el.isConnected) {return;}
            currency = String(cur ?? '');
            rows = txs.map(invTxToRow);
            paint();
        } catch (e) {
            if (!el.isConnected) {return;}
            rows = []; table.setRows([]);
            summaryEl.textContent = ''; countEl.textContent = '';
            table.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN' ? 'لا صلاحية لعرض الحركات بهذا الحساب — القرار للخادم وحده.'
                    : `تعذّر تحميل الحركات: ${(e && e.message) || 'خطأ'}`));
        } finally { loading = false; }
    }
    el.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-v2-clear]')) { q('#v2mov-from').value = ''; q('#v2mov-to').value = ''; paint(); return; }
        if (ev.target.closest('[data-v2-print]')) { window.print(); return; }
        if (ev.target.closest('[data-v2-reload]')) { reload(); return; }
        if (ev.target.closest('[data-erp-retry]')) { reload(); }
    });
    el.addEventListener('change', (ev) => { if (ev.target.matches('#v2mov-from,#v2mov-to')) { paint(); } });
    reload();
    return { el, reload, getRows: () => viewRows().out, destroy() { table.destroy(); el.remove(); } };
}
