/**
 * V2 — Warehouse vs POS screen · مطابقة المخزن مع الكاشيرية (قراءة فقط)
 * ═══════════════════════════════════════════════════════════════════════
 * يطابق ما صرفه المخزن مع ما بيعت به الكاشيرية بالاسم — فروقات ونسب
 * وتنبيهات كما يحسبها الخادم (/yara-reports/wh-vs-pos) + تصدير Excel
 * بأعمدة القديم. البحث الجزئي لاقتراحات الأصناف عبر /item-suggest.
 * الصلاحية قرار الخادم.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.153';
import { formatInt } from '../data/reports-repo.js?v=4.9.153';
import { fetchWhVsPos, rangeError } from '../data/yara-reports-repo.js?v=4.9.153';
import { ensureXlsx } from '../vendor.js?v=4.9.153';

/** أسماء الحالات كما في تصدير القديم (features/wh-vs-pos.js:301). */
const STATUS_AR = {
    match: 'متطابق', sold_more: 'المبيع أكثر', issued_more: 'المصروف أكثر',
    pos_only: 'مباع فقط', wh_only: 'مصروف فقط',
};

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function todayIso(offset = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function template(from, to) {
    return `
      <div class="erp-v2-wv">
        <div class="erp-dash-head">
          <div>
            <h2 class="erp-dash-title">مطابقة المخزن مع الكاشيرية
              <span class="erp-eyebrow" dir="ltr" lang="en">Warehouse vs POS</span>
            </h2>
            <div class="erp-dash-sub" data-v2-scope-line role="status" aria-live="polite"></div>
          </div>
          <div class="erp-dash-controls">
            <button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-excel>
              <i class="ji" data-i="inbox" aria-hidden="true"></i><span>Excel</span>
            </button>
            <button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-print>
              <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span>
            </button>
            <button type="button" class="erp-btn erp-btn--primary erp-btn--sm erp-no-print" data-v2-reload>
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>مطابقة</span>
            </button>
          </div>
        </div>

        <div class="erp-filterbar erp-no-print">
          <label class="erp-text-sm erp-text-muted" for="v2wv-from">من</label>
          <input class="erp-input erp-input--ltr" id="v2wv-from" type="date" value="${esc(from)}">
          <label class="erp-text-sm erp-text-muted" for="v2wv-to">إلى</label>
          <input class="erp-input erp-input--ltr" id="v2wv-to" type="date" value="${esc(to)}" max="${esc(todayIso(0))}">
        </div>

        <div data-v2-kpis></div>

        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title">جدول المطابقة
              <span class="erp-eyebrow" dir="ltr" lang="en">Comparison</span>
              <span class="erp-text-muted erp-text-sm" data-v2-count></span>
            </h3>
          </div>
          <div class="erp-card__body erp-stack">
            <p class="erp-text-sm erp-text-muted">
              قراءة فقط — يُطابق صرف المخزن مع مبيعات الكاشيرية بالاسم
              (<span class="erp-addr" dir="ltr">/api/yara-reports/wh-vs-pos</span>)،
              والتحديث يجري خلفيًا كل دقيقة عند الخادم — الرقم هنا بوصمة الخادم.
            </p>
            <p class="erp-text-sm" data-v2-fresh hidden></p>
            <div data-v2-table></div>
          </div>
        </section>
      </div>`;
}

export function mountWhVsPosScreen(host, ctx = {}) {
    let rows = [];
    let loading = false;
    let exporting = false;
    const suggestTimer = null;
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 wh-vs-pos]', m);

    host.insertAdjacentHTML('beforeend', template(todayIso(-7), todayIso(0)));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const scopeLine = q('[data-v2-scope-line]');
    const kpisHost = q('[data-v2-kpis]');
    const freshEl = q('[data-v2-fresh]');

    const table = createDataTable({
        caption: 'مطابقة المخزن مع الكاشيرية — بيانات حية', mode: 'client', pageSize: 20, stickyHeader: true,
        emptyMessage: 'لا مطابقة في هذا المدى', emptyHint: 'وسّع المدى أو تحقق من مزامنة المرآة.',
        rowKey: (r, i) => `${i}`,
        columns: [
            { key: 'label', header: 'الصنف', sortable: true, filterable: true,
                render: (r) => esc(r.label) + (r.code ? `<span class="erp-mini__sub erp-mono" dir="ltr">${esc(r.code)}</span>` : '') },
            { key: 'wh_qty', header: 'صرف المخزن', type: 'number', width: '140px', align: 'end', value: (r) => r.wh_qty,
                render: (r) => `<span class="erp-num" dir="ltr">${formatInt(r.wh_qty)}</span>` },
            { key: 'pos_qty', header: 'مبيعات الكاشيرية', type: 'number', width: '160px', align: 'end', value: (r) => r.pos_qty,
                render: (r) => `<span class="erp-num" dir="ltr">${formatInt(r.pos_qty)}</span>` },
            { key: 'diff', header: 'الفرق', type: 'number', width: '120px', align: 'end', value: (r) => r.diff,
                render: (r) => `<span class="erp-num ${r.diff > 0 ? 'erp-text-danger' : (r.diff < 0 ? 'erp-text-success' : '')}" dir="ltr">${formatInt(r.diff)}</span>` },
            { key: 'pct', header: 'النسبة', width: '110px', align: 'end',
                render: (r) => (r.pct == null ? `<span class="erp-text-muted">—</span>`
                    : `<span class="erp-num" dir="ltr">${esc(String(r.pct))}%</span>`) },
            { key: 'alert', header: 'تنبيه',
                render: (r) => (r.alert ? `<span class="erp-badge" data-tone="danger">${esc(r.alert)}</span>` : `<span class="erp-text-muted">—</span>`) },
        ],
    });
    q('[data-v2-table]').appendChild(table.el);

    function paint() {
        const f = filters();
        scopeLine.textContent = `${f.from} ← ${f.to}`;
        const flagged = rows.filter((r) => r.diff !== 0).length;
        kpisHost.innerHTML = `<ul class="erp-kpis" aria-label="مؤشرات المطابقة">`
            + [
                { icon: 'git-compare', label: 'أصناف مطابَقة', en: 'Compared', value: formatInt(rows.length) },
                { icon: 'alert-triangle', label: 'بفروق', en: 'With Diff', value: formatInt(flagged) },
            ].map((k) => `<li class="erp-kpi">
                <div class="erp-kpi__top"><span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="${k.icon}"></i></span>
                <span class="erp-kpi__label">${esc(k.label)}<span class="erp-eyebrow" dir="ltr" lang="en">${esc(k.en)}</span></span></div>
                <div class="erp-kpi__value"><span class="erp-num" dir="ltr">${k.value}</span></div>
              </li>`).join('') + `</ul>`;
        table.setRows(rows);
        q('[data-v2-count]').textContent = rows.length ? `(${formatInt(rows.length)})` : '';
    }

    function filters() {
        return { from: q('#v2wv-from').value, to: q('#v2wv-to').value };
    }

    /** نفس أعمدة وأسماء ملف القديم — تُحمَّل المكتبة عند أول تصدير فقط. */
    async function exportExcel() {
        if (exporting) {return;}
        exporting = true;
        try {
            const ready = await ensureXlsx();
            if (!ready || typeof window.XLSX === 'undefined') {
                notify('مكتبة Excel غير محمّلة — حدّث الصفحة');
                return;
            }
            const f = filters();
            const data = [['الصنف', 'مصروف من المخزن', 'مبيع بالكاشيرية', 'الفرق', 'النسبة %',
                'قيمة المبيع الصافي', 'قيمة المبيع الإجمالي', 'عدد الأذونات', 'عدد الفواتير', 'القسم', 'الحالة']];
            rows.forEach((r) => data.push([
                r.label, r.wh_qty, r.pos_qty, r.diff, r.pct == null ? '' : r.pct,
                r.pos_net, r.pos_gross, r.wh_docs, r.pos_invoices, r.dept, STATUS_AR[r.status] || r.status,
            ]));
            const ws = window.XLSX.utils.aoa_to_sheet(data);
            const wb = window.XLSX.utils.book_new();
            window.XLSX.utils.book_append_sheet(wb, ws, 'المقارنة');
            window.XLSX.writeFile(wb, `wh-vs-pos_${f.from}_${f.to}.xlsx`);
            notify('تم تصدير Excel');
        } finally {
            exporting = false;
        }
    }

    async function reload() {
        if (loading) {return;}
        const f = filters();
        const gate = rangeError(f.from, f.to);
        if (!gate.ok) {
            rows = []; table.setRows([]); kpisHost.innerHTML = '';
            scopeLine.textContent = gate.message;
            table.setError(gate.message);
            return;
        }
        loading = true;
        table.setLoading(true);
        try {
            const [data] = await Promise.allSettled([fetchWhVsPos(f), import('../data/reports-repo.js?v=4.9.153').then((m) => m.fetchCurrency()).catch(() => '')]);
            if (!el.isConnected) {return;}
            const raw = data.status === 'fulfilled' ? (data.value.rows || data.value.comparison || []) : [];
            rows = raw.map((r) => ({
                label: String(r.item_name || r.name || r.name_ar || '—'),
                code: r.item_code ? String(r.item_code) : '',
                wh_qty: Number(r.wh_qty ?? r.warehouse_qty) || 0,
                pos_qty: Number(r.pos_qty ?? r.sales_qty) || 0,
                diff: Number(r.diff ?? r.difference) || 0,
                pct: r.pct == null ? null : Number(r.pct),
                alert: r.alert || r.severity_label || '',
                // حقول تصدير القديم (features/wh-vs-pos.js:299) — تُحفظ ولا تُعرض
                status: r.status ? String(r.status) : '',
                pos_net: Number(r.pos_net) || 0,
                pos_gross: Number(r.pos_gross) || 0,
                wh_docs: Number(r.wh_docs) || 0,
                pos_invoices: Number(r.pos_invoices) || 0,
                dept: r.dept ? String(r.dept) : '',
            }));
            if (data.status === 'rejected') {throw data.reason;}
            // بوصمة الطزاجة كما يعلنها الخادم (3 دقائق)
            const fresh = data.value && (data.value.freshness || data.value.last_sync);
            freshEl.hidden = !fresh;
            if (fresh) {freshEl.textContent = `آخر مزامنة المرآة: ${esc(typeof fresh === 'string' ? fresh : JSON.stringify(fresh))}`;}
            paint();
        } catch (e) {
            if (!el.isConnected) {return;}
            rows = [];
            table.setRows([]);
            kpisHost.innerHTML = '';
            q('[data-v2-count]').textContent = '';
            table.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : `تعذّر التحميل: ${(e && e.message) || 'خطأ'}`);
        } finally {
            loading = false;
        }
    }

    el.addEventListener('click', (event) => {
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-v2-excel]')) {exportExcel(); return;}
        if (event.target.closest('[data-v2-print]')) {window.print(); return;}
        if (event.target.closest('[data-erp-retry]')) {reload();}
    });
    el.addEventListener('change', (event) => {
        if (event.target.matches('#v2wv-from, #v2wv-to')) {reload();}
    });

    reload();

    return {
        el,
        reload,
        getRows: () => rows,
        destroy() {
            if (suggestTimer) {clearTimeout(suggestTimer);}
            table.destroy();
            el.remove();
        },
    };
}
