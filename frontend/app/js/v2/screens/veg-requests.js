/**
 * V2 — Vegetable requests screen · شاشة 14 في سجل الترحيل (الدورة كاملة، W1-4)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * W1-4 (2026-10-15): كانت قراءةً فقط؛ صارت تنفّذ دورة الخضار كاملة بنفس
 * عقد الشاشات 13 (dispatch) و21 (wh-prs):
 *   إنشاء (كتالوج الخادم + صفوف حرة + أولوية + ملاحظات) · استلام الأصناف
 *   (سليم/مرفوض + كميات سليمة + أسعار مندوب للاعتماد المباشر) · تسعير
 *   المخزن (يحمل مصروف قسم المطبخ) · تعديل الكميات · إلغاء · تفاصيل
 *   بالسلسلة · طباعة A4 بورقة القديم نفسها.
 *
 * قواعد لم تُخترع:
 *   • الباب الواحد للشبكة: js/v2/data/veg-repo.js — لا fetch/ apiFetch هنا.
 *   • نصوص اللوحات والحمولات منسوخة من features/veg-requests.js:224-680
 *     حرفًا بحرف (التحقق، التأكيدات، رسائل النجاح، بنود الاستلام/التسعير).
 *   • الاعتماد المباشر عند الاستلام: أسعار كل الأصناف المقبولة معًا وإلا
 *     فالاستلام وحده — نفس شرط القديم :423-426.
 *   • انحرافات معلنة (توثيقها في veg-repo.js): زر التعديل لما سيقبله الخادم
 *     فعلًا (admin/owner أو منشئ الطلب)، وترميز معرّف كل مسار كتابة.
 *   • window.prompt ممنوعة (CSP + عقد V2) — سبب الإلغاء الاختياري صار حقلًا
 *     في لوحة الإلغاء، والحمولة {reason} كما يرسلها القديم :549.
 *   • الأخطاء تُطبع من ردّ الخادم (e.message) لا من نصوص مخترعة.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.193';
import { openInAppReport } from '../report-viewer.js?v=4.9.193';
import { statusBadge } from '../status.js?v=4.9.193';
import {
    fetchVegRequests, fetchVegCatalog, fetchVegRequestById, vegRequestToRow, vegItemsOf,
    VEG_STATUS_FILTERS,
    vegCreateVisible, vegReceiveVisible, vegPriceVisible, vegEditVisible, vegCancelVisible,
    collectVegItems, vegCreatePayload, vegReceivePayload, vegEditPayload,
    createVegRequest, receiveVegRequest, priceVegRequest, editVegItems, cancelVegRequest, markVegPrinted,
} from '../data/veg-repo.js?v=4.9.193';
import { fetchCurrency, formatMoney, formatInt } from '../data/reports-repo.js?v=4.9.193';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* نفس fD/fDT في core/utils.js لكن بالعربية دائمًا (V2 عربي بالكامل). */
function fDT(v) {
    return v ? new Date(v).toLocaleString('ar-EG') : '';
}

const STATUS_AR = { all: 'الكل', pending: 'معلق', received: 'مستلم', cancelled: 'ملغي' };

function moneyCell(v, currency, opts = {}) {
    const m = formatMoney(v, currency);
    const n = `<span class="erp-num" dir="ltr">${m.amount}</span>`;
    const u = m.hasUnit ? ` <span class="erp-text-sm erp-text-muted">${esc(m.unit)}</span>` : '';
    const body = `${n}${u}`;
    return opts.title ? `<span title="${esc(opts.title)}">${body}</span>` : body;
}

/* ── ورقة الطباعة — هيكل vegBuildPrintHtml :582-680 بحرفه ────────────── */

function buildVegPrintHtml(req, byName) {
    const items = vegItemsOf(req);
    const hasPrices = items.some((it) => it.price !== null && it.price !== undefined);
    const fmt = (n) => Number(n).toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const rows = items.map((it, i) => `
      <tr${it.rejected ? ' style="background:#fdecec"' : ''}>
        <td class="c">${i + 1}</td>
        <td class="name">${esc(it.name)}${it.rejected ? ' <span class="rej">✗ مرفوض — لا يُسعَّر</span>' : ''}${it.spoiledQty ? ` <span class="rej">تالف: ${esc(String(it.spoiledQty))}</span>` : ''}</td>
        <td class="c qty">${esc(String(it.qty))}</td>
        <td class="c">${esc(it.unit)}</td>
        ${hasPrices ? `<td class="c">${it.rejected ? '—' : (it.price !== null && it.price !== undefined ? fmt(it.price) : '—')}</td><td class="c">${it.lineTotal !== null && it.lineTotal !== undefined ? fmt(it.lineTotal) : '—'}</td>` : ''}
        <td class="note">${esc(it.note || '')}</td>
      </tr>`).join('');
    const created = req.created_at ? new Date(req.created_at) : new Date();
    const dtStr = created.toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'long', timeStyle: 'short' });
    const rdt = req.received_at ? new Date(req.received_at).toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'long', timeStyle: 'short' }) : '';
    const nowStr = new Date().toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' });
    const pdt = req.priced_at ? new Date(req.priced_at).toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'long', timeStyle: 'short' }) : '';
    const statusStamp = req.status === 'priced'
        ? `<div class="stamp ok">✔ معتمد${req.total ? ' — ' + fmt(req.total) : ''}</div><div class="recv-line">سعّرها: <b>${esc(req.priced_by_name || '')}</b>${pdt ? ' — ' + esc(pdt) : ''}</div>`
        : (req.status === 'received'
        ? `<div class="stamp ok">✔ تم الاستلام</div><div class="recv-line">استلمها: <b>${esc(req.received_by_name || '')}</b>${rdt ? ' — ' + esc(rdt) : ''}</div>`
        : (req.status === 'cancelled' ? '<div class="stamp no">✖ ملغي</div>' : ''));
    return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>طلب شراء خضار ${esc(req.request_no || '')}</title>
<style>
@page { size: A4; margin: 13mm; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', Tahoma, sans-serif; color: #16213e; background: #fff; font-size: 13.5px; }
.sheet { max-width: 780px; margin: 0 auto; }
.head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #c9a227; padding-bottom: 12px; }
.brand h1 { font-size: 22px; color: #16213e; letter-spacing: .5px; }
.brand .sub { color: #7a7a8c; font-size: 11.5px; margin-top: 3px; }
.docno { text-align: left; }
.docno .no { font-size: 17px; font-weight: 800; color: #16213e; border: 2px solid #c9a227; border-radius: 10px; padding: 6px 14px; display: inline-block; direction: ltr; }
.docno .dt { color: #555; font-size: 12px; margin-top: 6px; }
.title { background: #16213e; color: #c9a227; text-align: center; font-size: 18px; font-weight: 800; padding: 9px; border-radius: 10px; margin: 14px 0; letter-spacing: 1px; }
.meta { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.meta .m { background: #f6f4ec; border: 1px solid #e2ddc9; border-radius: 9px; padding: 6px 12px; font-size: 12.5px; }
.meta .m b { color: #16213e; }
.meta .m.urgent { background: #fdecec; border-color: #e74c3c; color: #c0392b; font-weight: 800; }
table { width: 100%; border-collapse: collapse; margin-top: 4px; }
th { background: #16213e; color: #fff; padding: 8px 6px; font-size: 12.5px; }
td { border: 1px solid #d8d4c4; padding: 7px 8px; font-size: 13px; }
tr:nth-child(even) td { background: #faf9f4; }
td.c { text-align: center; width: 46px; } td.qty { text-align: center; font-weight: 800; width: 80px; font-size: 14px; }
td.name { font-weight: 700; } td.note { color: #666; font-size: 12px; }
.rej { color: #c0392b; font-weight: 800; font-size: 10.5px; }
.total { margin-top: 8px; text-align: left; font-weight: 800; color: #16213e; }
.notes-box { margin-top: 12px; background: #f6f4ec; border: 1px dashed #c9a227; border-radius: 10px; padding: 10px 14px; font-size: 13px; }
.signs { display: flex; gap: 24px; margin-top: 30px; }
.sign { flex: 1; text-align: center; }
.sign .line { border-top: 2px dotted #999; margin-top: 46px; padding-top: 6px; font-weight: 700; font-size: 12.5px; }
.sign .who { color: #7a7a8c; font-size: 11.5px; }
.stamp { display: inline-block; border: 2.5px solid #27ae60; color: #27ae60; font-weight: 900; font-size: 16px; border-radius: 10px; padding: 4px 18px; transform: rotate(-4deg); margin-top: 14px; }
.stamp.no { border-color: #c0392b; color: #c0392b; }
.recv-line { margin-top: 6px; font-size: 12.5px; color: #27ae60; }
.foot { border-top: 2px solid #c9a227; margin-top: 26px; padding-top: 8px; display: flex; justify-content: space-between; color: #7a7a8c; font-size: 10.5px; }
.controls { text-align: center; margin-bottom: 14px; }
.controls button { border: 0; border-radius: 7px; padding: 10px 26px; margin: 0 5px; font: inherit; cursor: pointer; background: #c9a227; color: #16213e; font-weight: 800; }
.controls button.secondary { background: #555; color: #fff; }
@media print { .sheet { max-width: none; } .controls { display: none !important; } }
</style></head><body>
<div class="controls"><button type="button" data-v2-print>🖨 طباعة</button><button type="button" class="secondary" data-v2-close>إغلاق</button></div>
<div class="sheet">
  <div class="head">
    <div class="brand">
      <h1>مطاعم الشرفاء العالمي</h1>
      <div class="sub">نظام Karim ERP لإدارة المطاعم</div>
    </div>
    <div class="docno">
      <div class="no">${esc(req.request_no || '')}</div>
      <div class="dt">${esc(dtStr)}</div>
    </div>
  </div>
  <div class="title">طلب شراء خضار</div>
  <div class="meta">
    <div class="m"><b>الجهة الطالبة:</b> مطبخ المطعم</div>
    <div class="m"><b>بواسطة:</b> ${esc(req.created_by_name || '')}${req.created_by_role ? ' (' + esc(req.created_by_role) + ')' : ''}</div>
    <div class="m"><b>إلى:</b> المخازن</div>
    ${req.priority === 'urgent' ? '<div class="m urgent">🚨 عاجل — التوريد بأسرع وقت</div>' : ''}
    ${statusStamp}
  </div>
  <table>
    <thead><tr><th class="c">م</th><th>الصنف</th><th class="qty">الكمية</th><th>الوحدة</th>${hasPrices ? '<th>سعر الوحدة</th><th>الإجمالي</th>' : ''}<th>ملاحظات</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="total">إجمالي الأصناف: ${items.length}${req.total ? ' — إجمالي القيمة: ' + fmt(req.total) : ''}</div>
  ${req.notes ? `<div class="notes-box"><b>ملاحظات:</b> ${esc(req.notes)}</div>` : ''}
  <div class="signs">
    <div class="sign"><div class="line"></div><div class="who">توقيع الشيف — ${esc(req.created_by_name || '')}</div></div>
    <div class="sign"><div class="line"></div><div class="who">توقيع أمين المخزن — الاستلام</div></div>
  </div>
  <div class="foot">
    <div>طُبعت من نظام Karim ERP بواسطة ${esc(byName || '')} — ${esc(nowStr)}</div>
    <div>نسخة رقم ${Number(req.print_count || 0) + 1}</div>
  </div>
</div>
</body></html>`;
}

function template(canCreate) {
    return `
      <section class="erp-card erp-v2-veg">
        <div class="erp-card__head">
          <h3 class="erp-card__title">طلبات شراء الخضار
            <span class="erp-eyebrow" dir="ltr" lang="en">Vegetable Requests</span>
            <span class="erp-text-muted erp-text-sm" data-v2-count></span>
          </h3>
          <span class="erp-grow"></span>
          <span class="erp-v2-veg__tools">
            ${canCreate ? `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-new>
              <i class="ji" data-i="shopping-cart" aria-hidden="true"></i><span>طلب جديد</span>
            </button>` : ''}
            <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload>
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
            </button>
          </span>
        </div>
        <div class="erp-card__body erp-stack">
          <p class="erp-text-sm erp-text-muted" data-v2-summary role="status" aria-live="polite"></p>
          <div data-v2-statusseg></div>
          <p class="erp-text-sm erp-text-muted">
            الدورة كاملة من هنا: إنشاء من قايمة الخضار المعتمدة · استلام الأصناف
            (سليم/مرفوض + أسعار المندوب للاعتماد المباشر) · تسعير المخزن
            (يُحمَّل مصروف قسم المطبخ) · تعديل الكميات قبل الاعتماد · إلغاء · طباعة.
            القرار للخادم وحده: الشيف العمومي ومدير النظام والمالك يعتمدون، والمخزن يقرأ فقط — ولا توقيع في هذه الدورة.
            <span data-v2-currency-note hidden>تعذّرت قراءة وحدة المال من الإعدادات — المبالغ تُعرض بلا وحدة.</span>
          </p>
          <div data-v2-table></div>
          <div data-v2-panel hidden></div>
        </div>
      </section>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, userId?: number|null, userName?: string|null,
 *          notify?: (message:string)=>void, confirmFn?: (message:string)=>Promise<boolean>|boolean}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, getRows: ()=>any[], destroy: ()=>void}}
 */
export function mountVegScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 veg]', m);
    const confirmFn = typeof ctx.confirmFn === 'function'
        ? ctx.confirmFn
        : (message) => Promise.resolve(window.confirm(message));
    const role = ctx.role ? String(ctx.role) : '';
    const userId = ctx.userId != null ? Number(ctx.userId) : null;
    const userName = String(ctx.userName || '');

    let rawRows = [];                       // آخر قراءة خام من الخادم
    let rawById = new Map();
    let currency = '';
    let loading = false;
    let readSeq = 0;                        // أحدث قراءة تفوق
    let busy = false;                       // قرار واحد في المرة
    let panelSeq = 0;                       // إغلاق اللوحة يُلغي أي تجهيز جارٍ
    let panelKind = null;
    let panelRaw = null;
    let retryState = null;                  // {kind, raw} لإعادة محاولة لوحة فشل تجهيزها
    let priority = 'normal';                // normal | urgent — حالة لوحة الإنشاء
    let status = 'all';

    host.insertAdjacentHTML('beforeend', template(vegCreateVisible(role)));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const panelEl = q('[data-v2-panel]');
    const countEl = q('[data-v2-count]');
    const summaryEl = q('[data-v2-summary]');
    const currencyNote = q('[data-v2-currency-note]');
    const segHost = q('[data-v2-statusseg]');

    const moneyPlain = (v) => {
        const m = formatMoney(v, currency);
        return m.hasUnit ? `${m.amount} ${m.unit}` : m.amount;
    };

    /* ── الجدول ─────────────────────────────────────────────────────────── */

    const table = createDataTable({
        caption: 'سجل طلبات الخضار — بيانات حية',
        mode: 'client',
        pageSize: 20,
        stickyHeader: true,
        emptyMessage: 'لا توجد طلبات بهذه الحالة',
        emptyHint: 'غيّر الفلتر.',
        rowKey: (row) => row.id,
        columns: [
            {
                key: 'number', header: 'رقم الطلب', sortable: true, filterable: true,
                width: '150px', className: 'erp-mono',
            },
            {
                key: 'itemsCount', header: 'الأصناف', sortable: true, type: 'number',
                width: '100px', align: 'end', value: (row) => row.itemsCount,
                render: (row) => `<span class="erp-num" dir="ltr">${esc(row.itemsCount)}</span>`,
            },
            {
                key: 'priority', header: 'الأولوية', sortable: true, width: '120px',
                render: (row) => (row.urgent
                    ? `<span class="erp-row-wrap"><span class="erp-dot erp-dot--danger" aria-hidden="true"></span><span>عاجل</span></span>`
                    : `<span class="erp-text-muted">عادي</span>`),
            },
            {
                key: 'total', header: 'الإجمالي', sortable: true, type: 'number',
                width: '140px', align: 'end', value: (row) => row.total,
                render: (row) => moneyCell(row.total, currency),
            },
            {
                key: 'by', header: 'أنشأها', sortable: true, filterable: true, width: '150px',
            },
            {
                key: 'created', header: 'التاريخ', sortable: true, width: '120px', align: 'center',
                render: (row) => (row.created
                    ? `<span class="erp-num" dir="ltr">${esc(row.created)}</span>`
                    : `<span class="erp-text-muted">—</span>`),
            },
            {
                key: 'status', header: 'الحالة', sortable: true, filterable: true, width: '160px',
                value: (row) => row.status,
                render: (row) => (row.status
                    ? statusBadge('veg_request', row.status)
                    : `<span class="erp-text-muted">—</span>`),
            },
            {
                key: 'actions', header: 'إجراءات', width: '320px', className: 'erp-v2-veg-actions',
                render: (row) => rowActionsHtml(row._raw || {}),
            },
        ],
    });

    q('[data-v2-table]').appendChild(table.el);

    function btn(act, id, icon, label, extraClass = '') {
        return `<button type="button" class="erp-btn erp-btn--sm ${extraClass}" data-v2-act="${act}" data-id="${esc(String(id))}">
          <i class="ji" data-i="${icon}" aria-hidden="true"></i><span>${esc(label)}</span></button>`;
    }

    /** أزرار الصف — ترتيب القديم :357-364: طباعة ← استلام ← سعرها ← تعديل ← إلغاء. */
    function rowActionsHtml(raw) {
        if (!raw || raw.id === undefined) {return '—';}
        const id = raw.id;
        const st = raw.status ? String(raw.status) : '';
        const out = [btn('print', id, 'printer', 'طباعة')];
        if (vegReceiveVisible(role, st)) {out.push(btn('receive', id, 'check', 'استلام / إرجاع', 'erp-btn--primary'));}
        if (vegPriceVisible(role, st)) {out.push(btn('price', id, 'coins', 'سعرها', 'erp-btn--primary'));}
        if (vegEditVisible(role, st, raw, userId)) {out.push(btn('edit', id, 'pencil', 'تعديل الكميات'));}
        if (vegCancelVisible(role, st, raw, userId)) {out.push(btn('cancel', id, 'circle-x', 'إلغاء', 'erp-btn--danger'));}
        return out.join('');
    }

    /* ── اللوحة: غلاف ومكوّنات مشتركة ───────────────────────────────────── */

    function panelShell(title, icon, bodyHtml) {
        return `<div class="erp-veg-panel">
          <div class="erp-veg-panel__head">
            <h3><i class="ji" data-i="${esc(icon)}" aria-hidden="true"></i> ${title}</h3>
            <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-panel-close>
              <i class="ji" data-i="x" aria-hidden="true"></i><span>إغلاق</span>
            </button>
          </div>
          <div class="erp-veg-panel__body erp-stack">${bodyHtml}</div>
        </div>`;
    }

    const panelLoading = (title, icon) => panelShell(title, icon,
        `<div class="erp-state" role="status" aria-live="polite">
           <span class="erp-state__title">جارٍ تجهيز اللوحة…</span>
           <span>قراءات حية — لا بيانات نموذجية.</span>
         </div>`);

    function panelRetry(title, icon, message) {
        return panelShell(title, icon,
            `<div class="erp-state" role="alert">
               <span class="erp-state__title">${esc(message)}</span>
               <span>لم يُغيَّر شيء — أعد المحاولة أو أغلق اللوحة.</span>
               <button type="button" class="erp-btn erp-btn--sm erp-btn--primary" data-v2-retry-panel>
                 <i class="ji" data-i="refresh" aria-hidden="true"></i><span>إعادة المحاولة</span>
               </button>
             </div>`);
    }

    function panelActions(submitLabel, submitIcon, extra = '', submitDisabled = false) {
        return `
          <div data-v2-panel-msg role="alert" class="erp-text-sm"></div>
          <div class="erp-veg-panel__actions">
            ${extra}
            <span class="erp-grow"></span>
            <button type="button" class="erp-btn" data-v2-panel-close>إلغاء</button>
            <button type="button" class="erp-btn erp-btn--primary" data-v2-submit${submitDisabled ? ' disabled' : ''}>
              <i class="ji" data-i="${esc(submitIcon)}" aria-hidden="true"></i><span>${esc(submitLabel)}</span>
            </button>
          </div>`;
    }

    function setPanel(html) {
        panelEl.innerHTML = html;
        panelEl.hidden = false;
        panelEl.scrollIntoView({ block: 'nearest' });
    }

    function closePanel() {
        panelSeq += 1;
        panelKind = null;
        panelRaw = null;
        retryState = null;
        panelEl.innerHTML = '';
        panelEl.hidden = true;
    }

    const panelAlive = (seq) => el.isConnected && seq === panelSeq;

    function panelMsg(text) {
        const box = panelEl.querySelector('[data-v2-panel-msg]');
        if (box) {box.textContent = text || '';}
        if (text) {notify(text);}
    }

    /* ── لوحة الإنشاء: كتالوج الخادم + صفوف حرة + أولوية ────────────────── */

    const vegItemHtml = (it, units) => `
      <div class="erp-veg-item" data-v2-veg-item="${esc(it.name)}" data-v2-veg-cat="${esc(it.catKey || '')}">
        <div class="erp-veg-item__name"><span>${esc(it.name)}</span><span class="erp-veg-item__unit">${esc(it.unit)}</span></div>
        <div class="erp-veg-item__row">
          <input class="erp-input" type="number" min="0" step="any" placeholder="الكمية"
            data-v2-qty="${esc(it.name)}" data-v2-qty-unit="${esc(it.unit)}" aria-label="كمية ${esc(it.name)}">
          <select class="erp-input" data-v2-unit="${esc(it.name)}" aria-label="وحدة ${esc(it.name)}">
            ${units.map((u) => `<option value="${esc(u)}"${u === it.unit ? ' selected' : ''}>${esc(u)}</option>`).join('')}
          </select>
        </div>
      </div>`;

    const customRowHtml = () => `
      <div class="erp-veg-custom" data-v2-custom>
        <label class="erp-field erp-veg-custom__name"><span class="erp-label">الصنف</span>
          <input class="erp-input" type="text" data-v2-c-name placeholder="اسم الصنف"></label>
        <label class="erp-field"><span class="erp-label">الكمية</span>
          <input class="erp-input" type="number" min="0" step="any" data-v2-c-qty placeholder="الكمية"></label>
        <label class="erp-field"><span class="erp-label">الوحدة</span>
          <select class="erp-input" data-v2-c-unit></select></label>
        <label class="erp-field erp-veg-custom__note"><span class="erp-label">ملاحظة (اختياري)</span>
          <input class="erp-input" type="text" data-v2-c-note placeholder="ملاحظة"></label>
        <button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-remove-custom aria-label="حذف الصف">
          <i class="ji" data-i="trash" aria-hidden="true"></i></button>
      </div>`;

    function createHtml(catalog) {
        const units = catalog.units || ['كجم'];
        const catsHtml = (catalog.categories || []).map((cat) => `
          <div class="erp-veg-cat" data-v2-veg-cat-title>
            <div class="erp-veg-cat__title"><i class="ji" data-i="leaf" aria-hidden="true"></i> ${esc(cat.label)}</div>
            <div class="erp-veg-grid">
              ${(cat.items || []).map((it) => vegItemHtml({ name: it.name, unit: it.unit, catKey: cat.key }, units)).join('')}
            </div>
          </div>`).join('');
        return panelShell('طلب شراء خضار جديد', 'shopping-cart',
            `<div class="erp-flow-note" data-tone="info">
               من: مطبخ المطعم${userName ? ` — ${esc(userName)}` : ''} • إلى: المخازن • علّم الكمية على أصناف القايمة أو أضف صنفًا حرًّا.
             </div>
             <div class="erp-veg-search">
               <input class="erp-input" type="text" data-v2-veg-search placeholder="🔍 ابحث عن صنف…" aria-label="بحث في قايمة الخضار">
             </div>
             <div data-v2-veg-catalog>${catsHtml}</div>
             <div class="erp-veg-panel__subhead">
               <span>صنف غير موجود في القايمة</span>
               <button type="button" class="erp-btn erp-btn--sm" data-v2-add-custom>
                 <i class="ji" data-i="plus" aria-hidden="true"></i><span>إضافة صنف حر</span></button>
             </div>
             <div class="erp-stack" data-v2-custom-box></div>
             <div class="erp-veg-summary">
               <span class="erp-veg-summary__count">الأصناف: <b data-v2-veg-count>0</b></span>
               <span class="erp-veg-priority" role="group" aria-label="أولوية الطلب">
                 <button type="button" class="erp-btn erp-btn--sm" data-v2-priority="normal"
                   ${priority === 'normal' ? 'aria-pressed="true"' : 'aria-pressed="false"'}>عادي</button>
                 <button type="button" class="erp-btn erp-btn--sm" data-v2-priority="urgent"
                   ${priority === 'urgent' ? 'aria-pressed="true"' : 'aria-pressed="false"'}>🚨 عاجل</button>
               </span>
               <label class="erp-field erp-veg-summary__notes"><span class="erp-label">ملاحظات للمخازن (اختياري)</span>
                 <input class="erp-input" type="text" data-v2-veg-notes placeholder="ملاحظات للمخازن (اختياري) — مثل: التوريد قبل ٩ صباحًا"></label>
             </div>
             ${panelActions('إرسال الطلب للمخازن', 'send')}`);
    }

    async function openCreatePanel(seq) {
        const title = 'طلب شراء خضار جديد';
        setPanel(panelLoading(title, 'shopping-cart'));
        try {
            const catalog = await fetchVegCatalog();
            if (!panelAlive(seq)) {return;}
            setPanel(createHtml(catalog));
            syncPriorityButtons();
        } catch (e) {
            if (!panelAlive(seq)) {return;}
            retryState = { kind: 'create', raw: null };
            setPanel(panelRetry(title, 'shopping-cart', `تعذر تجهيز اللوحة: ${(e && e.message) || 'خطأ في القراءة'}`));
        }
    }

    function syncPriorityButtons() {
        panelEl.querySelectorAll('[data-v2-priority]').forEach((b) => {
            b.setAttribute('aria-pressed', String(b.getAttribute('data-v2-priority') === priority));
            b.classList.toggle('is-active', b.getAttribute('data-v2-priority') === priority);
        });
    }

    function fillCustomUnits() {
        const box = panelEl.querySelector('[data-v2-custom-box]');
        if (!box) {return;}
        const units = ['كجم', 'جرام', 'طن', 'كرتونة', 'ربطة', 'حبة', 'صندوق', 'كيس', 'شيكارة', 'لتر', 'جالون'];
        box.querySelectorAll('[data-v2-c-unit]').forEach((selSel) => {
            if (selSel.options.length) {return;}
            selSel.innerHTML = units.map((u) => `<option value="${esc(u)}">${esc(u)}</option>`).join('');
        });
    }

    /** قراءة DOM لوحة الإنشاء ثم التجميع النقي من البوابة. */
    function collectFromPanel() {
        const picks = [];
        panelEl.querySelectorAll('[data-v2-qty]').forEach((inp) => {
            const name = inp.getAttribute('data-v2-qty');
            const unitSel = panelEl.querySelector(`[data-v2-unit="${CSS.escape(name)}"]`);
            picks.push({
                name,
                qty: inp.value,
                unit: unitSel ? unitSel.value : (inp.getAttribute('data-v2-qty-unit') || 'وحدة'),
            });
        });
        const customs = [];
        panelEl.querySelectorAll('[data-v2-custom]').forEach((row) => {
            customs.push({
                name: row.querySelector('[data-v2-c-name]')?.value || '',
                qty: row.querySelector('[data-v2-c-qty]')?.value || '',
                unit: row.querySelector('[data-v2-c-unit]')?.value || '',
                note: row.querySelector('[data-v2-c-note]')?.value || '',
            });
        });
        return collectVegItems(picks, customs);
    }

    function updateCreateCount() {
        const el2 = panelEl.querySelector('[data-v2-veg-count]');
        if (el2) {el2.textContent = String(collectFromPanel().length);}
    }

    /* ── لوحة التفاصيل: شرائح القديم :341-356 نفسها ─────────────────────── */

    function detailsHtml(raw) {
        const items = vegItemsOf(raw);
        const chips = items.map((it) => `<span class="erp-veg-chip"${it.rejected ? ' data-rejected="1"' : ''}>
            ${it.rejected ? '✗ ' : ''}${esc(it.name)} <b>${esc(String(it.qty))}</b> ${esc(it.unit)}
            ${it.rejected ? ' (مرفوض)' : (it.price != null ? ` × ${esc(String(it.price))} = <b>${esc(String(it.lineTotal))}</b>` : '')}</span>`).join('');
        return panelShell(`تفاصيل الطلب ${esc(raw.request_no || ('#' + raw.id))}`, 'clipboard-list',
            `<div class="erp-veg-chips">${chips || '<span class="erp-text-muted">لا أصناف</span>'}</div>
             ${raw.priority === 'urgent' ? '<div class="erp-flow-note" data-tone="danger">🚨 عاجل — التوريد بأسرع وقت</div>' : ''}
             <div class="details-list">
               <div class="details-item"><strong>بواسطة:</strong> ${esc(raw.created_by_name || '—')}</div>
               <div class="details-item"><strong>التاريخ:</strong> ${esc(fDT(raw.created_at))}</div>
               ${raw.received_at ? `<div class="details-item"><strong>استلمها:</strong> ${esc(raw.received_by_name || '')}${raw.received_by_dept ? ` — ${esc(raw.received_by_dept)}` : ''} — ${esc(fDT(raw.received_at))}</div>` : ''}
               ${raw.status === 'priced' ? `<div class="details-item"><strong>الإجمالي:</strong> ${esc(moneyPlain(raw.total))} — مصروف #${esc(String(raw.expense_id || ''))}${raw.priced_by_name ? ` — سعّرها ${esc(raw.priced_by_name)}` : ''}</div>` : ''}
               ${raw.status === 'cancelled' && raw.cancelled_by_name ? `<div class="details-item"><strong>ألغاها:</strong> ${esc(raw.cancelled_by_name)}</div>` : ''}
               <div class="details-item"><strong>الطباعة:</strong> طُبع ${esc(String(raw.print_count || 0))} مرة</div>
             </div>
             ${raw.notes ? `<div class="erp-flow-note" data-tone="neutral">📝 ${esc(raw.notes)}</div>` : ''}`);
    }

    /* ── لوحة الاستلام: سليم/مرفوض + كميات + أسعار اختيارية ─────────────── */

    function receiveHtml(raw) {
        const items = vegItemsOf(raw);
        const rows = items.map((it) => `
          <div class="erp-veg-line">
            <div class="erp-veg-line__row">
              <span class="erp-veg-line__name">${esc(it.name)} <small class="erp-text-muted">(${esc(String(it.qty))} ${esc(it.unit)})</small></span>
              <label class="erp-field">المستلم:
                <input class="erp-input" type="number" min="0" step="0.001" value="${esc(String(it.qty))}"
                  data-v2-vq-name="${esc(it.name)}" title="الكمية السليمة المستلمة — الباقي يُسجل تالفًا" aria-label="الكمية السليمة من ${esc(it.name)}"></label>
              <label class="erp-field">السعر:
                <input class="erp-input" type="number" min="0" step="0.01" placeholder="سعر الوحدة"
                  data-v2-vp-recv="${esc(String(raw.id))}" data-v2-vp-name="${esc(it.name)}"
                  title="سعر المندوب النهائي — لو سعّرت كل الأصناف يُعتمد الطلب مباشرة" aria-label="سعر ${esc(it.name)}"></label>
              <label class="erp-veg-line__radio">
                <input type="radio" name="v2vr_${esc(String(raw.id))}" data-v2-vr-item="${esc(it.name)}" value="ok" checked> استلام</label>
              <label class="erp-veg-line__radio erp-text-danger">
                <input type="radio" name="v2vr_${esc(String(raw.id))}" data-v2-vr-item="${esc(it.name)}" value="reject"> ارجاع / رفض</label>
            </div>
          </div>`).join('');
        return panelShell(`استلام الطلب ${esc(raw.request_no || ('#' + raw.id))}`, 'check',
            `<div class="erp-flow-note" data-tone="info">
               حدد مستلَمًا أو مُرجَعًا لكل صنف. لو جزء تالف: اكتب الكمية <b>السليمة</b> في خانة المستلم —
               الحساب على السليم فقط والباقي يُسجل تالفًا.<br>
               💰 لو كتبت <b>سعر كل الأصناف المقبولة</b> يُعتمد الطلب مباشرة بسعر المندوب — لو تركتها فارغة يبقى التسعير لخطوة لاحقة.
             </div>
             <div class="erp-stack">${rows || '<span class="erp-text-muted">لا أصناف</span>'}</div>
             <div class="erp-flow-note" data-tone="neutral">المرفوض لا يرجع للمخزن للتسعير ولا يُحمَّل مصروفًا.</div>
             ${panelActions('تأكيد الاستلام', 'check')}`);
    }

    /* ── لوحة التسعير: سعر الوحدة لكل صنف مقبول + إجمالي حي ─────────────── */

    function priceHtml(raw) {
        const items = vegItemsOf(raw);
        const rejectedRows = items.filter((it) => it.rejected)
            .map((it) => `<div class="erp-text-danger erp-text-sm">✗ ${esc(it.name)} — مرفوض، لا يُسعَّر ولا يُحمَّل</div>`).join('');
        const priced = items.filter((it) => !it.rejected);
        const rows = priced.map((it) => `
          <div class="erp-veg-line">
            <div class="erp-veg-line__row">
              <span class="erp-veg-line__name">${esc(it.name)} <small class="erp-text-muted">(${esc(String(it.qty))} ${esc(it.unit)})</small>${it.spoiledQty ? ` <span class="erp-badge" data-tone="danger" title="كمية تالفة لا تُحتسب">تالف: ${esc(String(it.spoiledQty))}</span>` : ''}</span>
              <input class="erp-input" type="number" min="0" step="0.01" placeholder="سعر الوحدة"
                data-v2-vp-price="${esc(String(raw.id))}" data-v2-vp-name="${esc(it.name)}" data-v2-vp-qty="${esc(String(it.qty))}"
                aria-label="سعر وحدة ${esc(it.name)}">
              <span class="erp-veg-line__total" data-v2-line="${esc(it.name)}">—</span>
            </div>
          </div>`).join('');
        return panelShell(`تسعير الطلب ${esc(raw.request_no || ('#' + raw.id))}`, 'coins',
            `<div class="erp-flow-note" data-tone="info">💰 تسعير المخزن — سعر الوحدة لكل صنف مقبول. يُحمّل مصروف على قسم المطبخ تلقائيًا عند التأكيد.</div>
             ${rejectedRows}
             <div class="erp-stack">${rows || '<span class="erp-text-muted">لا صنف مقبول — التسعير غير متاح</span>'}</div>
             <div class="erp-veg-line__row">
               <b>الإجمالي (المقبول فقط): <span data-v2-total>0.00</span></b>
               <small class="erp-text-muted">يُحمّل مصروف على قسم المطبخ تلقائياً عند التأكيد</small>
             </div>
             ${panelActions('تأكيد التسعير', 'coins', '', !priced.length)}`);
    }

    /* ── لوحة تعديل الكميات ─────────────────────────────────────────────── */

    function editHtml(raw) {
        const items = vegItemsOf(raw);
        const rows = items.map((it, i) => `
          <div class="erp-veg-line">
            <div class="erp-veg-line__row">
              <span class="erp-veg-line__name">${esc(it.name)} <small class="erp-text-muted">(${esc(it.unit || '')})</small></span>
              <input class="erp-input" type="number" min="0.001" step="0.001" value="${esc(String(Number(it.qty || 0)))}"
                data-v2-edit-qty="${i}" data-v2-edit-name="${esc(it.name)}" data-v2-edit-unit="${esc(it.unit || '')}"
                aria-label="كمية ${esc(it.name)}">
            </div>
          </div>`).join('');
        return panelShell(`تعديل كميات الطلب ${esc(raw.request_no || ('#' + raw.id))}`, 'pencil',
            `<div class="erp-flow-note" data-tone="warning">التعديل قبل الاعتماد النهائي فقط — أي تغيير يُوثَّق باسمك. إضافة أصناف جديدة مرفوضة — طلب جديد لها.</div>
             <div class="erp-stack">${rows || '<span class="erp-text-muted">لا أصناف</span>'}</div>
             ${panelActions('حفظ الكميات', 'check')}`);
    }

    /* ── لوحة الإلغاء: سبب اختياري (بديل window.prompt الممنوع) ─────────── */

    function cancelHtml(raw) {
        return panelShell(`إلغاء الطلب ${esc(raw.request_no || ('#' + raw.id))}`, 'circle-x',
            `<div class="erp-flow-note" data-tone="warning">الإلغاء قبل الاستلام فقط. إلغاء الطلب موثّق باسمك في السجل.</div>
             <label class="erp-field"><span class="erp-label">سبب الإلغاء (اختياري):</span>
               <input class="erp-input" type="text" data-v2-cancel-reason maxlength="200" placeholder="سبب الإلغاء"></label>
             ${panelActions('تأكيد الإلغاء', 'circle-x', '', false)}`);
    }

    /* ── فتح اللوحات — بوابة واحدة تخدم الكل ────────────────────────────── */

    function openPanel(kind, raw) {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        const st = raw ? String(raw.status || '') : '';
        if (kind === 'create') {
            if (!vegCreateVisible(role)) {notify('إنشاء طلبات الخضار للسو شيف والإدارة فقط'); return;}
        } else if (!raw) {
            return;
        } else if (kind === 'receive') {
            if (!vegReceiveVisible(role, st)) {notify('الاستلام والتوقيع للسو شيف فقط'); return;}
        } else if (kind === 'price') {
            if (!vegPriceVisible(role, st)) {notify('التسعير للمخزن والإدارة فقط'); return;}
        } else if (kind === 'edit') {
            if (!vegEditVisible(role, st, raw, userId)) {notify('التعديل لصاحب الطلب أو الإدارة فقط'); return;}
        } else if (kind === 'cancel') {
            if (!vegCancelVisible(role, st, raw, userId)) {notify('الإلغاء لصاحب الطلب أو الإدارة فقط'); return;}
        }
        const seq = ++panelSeq;
        panelKind = kind;
        panelRaw = raw;
        retryState = null;
        if (kind === 'create') {
            priority = 'normal';
            openCreatePanel(seq);
            return;
        }
        if (kind === 'details') {setPanel(detailsHtml(raw)); return;}
        if (kind === 'receive') {setPanel(receiveHtml(raw)); return;}
        if (kind === 'price') {setPanel(priceHtml(raw)); return;}
        if (kind === 'edit') {setPanel(editHtml(raw)); return;}
        if (kind === 'cancel') {setPanel(cancelHtml(raw));}
    }

    /* ── التنفيذ: كل إرسال من بوابته، والأخطاء تصعد كما ترد ─────────────── */

    async function submitPanel() {
        if (panelKind === 'create') {await submitCreate(); return;}
        if (panelKind === 'receive') {await submitReceive(); return;}
        if (panelKind === 'price') {await submitPrice(); return;}
        if (panelKind === 'edit') {await submitEdit(); return;}
        if (panelKind === 'cancel') {await submitCancel();}
    }

    async function submitCreate() {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        busy = true;
        try {
            const items = collectFromPanel();
            if (!items.length) {notify('اكتب كمية صنف واحد على الأقل قبل الإرسال'); return;}
            const notes = panelEl.querySelector('[data-v2-veg-notes]')?.value || '';
            const res = await createVegRequest(vegCreatePayload({ items, notes, priority }));
            closePanel();
            notify(`تم إرسال الطلب ${(res && res.request && res.request.request_no) || ''} للمخازن ✔`);
            await reload();
        } catch (e) {
            panelMsg((e && e.message) || 'فشل إرسال الطلب');
        } finally {
            busy = false;
        }
    }

    async function submitReceive() {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        busy = true;
        try {
            const id = panelRaw ? panelRaw.id : null;
            const rejections = [...panelEl.querySelectorAll('input[type=radio][value=reject]:checked')]
                .map((r) => r.getAttribute('data-v2-vr-item')).filter(Boolean);
            const rejectCount = panelEl.querySelectorAll('input[type=radio][value=reject]').length;
            if (rejections.length && rejections.length === rejectCount) {
                const ok = await confirmFn('رفض كل الأصناف؟ الطلب سيُستلم بلا أي صنف ولا يُسعَّر.');
                if (!ok) {return;}
            }
            const quantities = [...panelEl.querySelectorAll('[data-v2-vq-name]')].map((inp) => ({
                name: inp.getAttribute('data-v2-vq-name'), receivedQty: Number(inp.value),
            })).filter((r) => r.name && Number.isFinite(r.receivedQty));
            // أسعار المندوب النهائية — تُرسل فقط لو سُعّرت كل الأصناف المقبولة (اعتماد مباشر)
            const rejSet = new Set(rejections);
            const prices = [];
            let need = 0;
            for (const inp of panelEl.querySelectorAll('[data-v2-vp-recv]')) {
                const nm = inp.getAttribute('data-v2-vp-name');
                if (!nm || rejSet.has(nm)) {continue;}
                need++;
                const v = String(inp.value || '').trim();
                if (v === '') {continue;}
                const p = Number(v);
                if (!Number.isFinite(p) || p < 0) {notify(`سعر غير سليم للصنف ${nm}`); return;}
                prices.push({ name: nm, unitPrice: p });
            }
            if (prices.length && prices.length < need) {notify('سعّر كل الأصناف المقبولة أو اترك الأسعار فارغة للاستلام فقط'); return;}
            const direct = need > 0 && prices.length === need;
            const res = await receiveVegRequest(id, vegReceivePayload({ rejections, quantities, prices, direct }));
            closePanel();
            notify(direct
                ? `تم الاستلام والاعتماد المباشر ✔ — الإجمالي ${moneyPlain(res && res.total || 0)}`
                : (rejections.length
                    ? `تم الاستلام — ${rejections.length} صنف مرفوض لن يُسعَّر`
                    : 'تم استلام كل الأصناف ✔ (الحساب على الكميات السليمة)'));
            await reload();
        } catch (e) {
            panelMsg((e && e.message) || 'فشل تسجيل الاستلام');
        } finally {
            busy = false;
        }
    }

    async function submitPrice() {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        busy = true;
        try {
            const prices = [...panelEl.querySelectorAll('[data-v2-vp-price]')].map((inp) => ({
                name: inp.getAttribute('data-v2-vp-name') || '',
                unitPrice: Number(inp.value),
            }));
            if (!prices.length || prices.some((p) => !p.name || !Number.isFinite(p.unitPrice) || p.unitPrice < 0)) {
                notify('سعّر كل الأصناف المقبولة (صفر أو أكثر) قبل التأكيد'); return;
            }
            const res = await priceVegRequest(panelRaw.id, prices);
            closePanel();
            notify(`تم التسعير: ${moneyPlain(res && res.total || 0)} — حُمّلت مصروف على قسم المطبخ (مصروف #${(res && res.expenseId) || ''})`);
            await reload();
        } catch (e) {
            panelMsg((e && e.message) || 'فشل التسعير');
        } finally {
            busy = false;
        }
    }

    async function submitEdit() {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        busy = true;
        try {
            const rows = [...panelEl.querySelectorAll('[data-v2-edit-qty]')].map((inp) => ({
                name: inp.getAttribute('data-v2-edit-name') || '',
                qty: Number(inp.value),
                unit: inp.getAttribute('data-v2-edit-unit') || '',
            }));
            await editVegItems(panelRaw.id, vegEditPayload(rows));
            closePanel();
            notify('تم تعديل الكميات');
            await reload();
        } catch (e) {
            panelMsg((e && e.message) || 'تعذر التعديل');
        } finally {
            busy = false;
        }
    }

    async function submitCancel() {
        if (busy) {notify('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        busy = true;
        try {
            const reason = panelEl.querySelector('[data-v2-cancel-reason]')?.value || '';
            await cancelVegRequest(panelRaw.id, reason);
            closePanel();
            notify('تم إلغاء الطلب');
            await reload();
        } catch (e) {
            panelMsg((e && e.message) || 'فشل الإلغاء');
        } finally {
            busy = false;
        }
    }

    /* ── الطباعة: النافذة تُفتح في إيماءة النقر قبل الجلب ───────────────── */

    function printVeg(raw) {
        const w = openInAppReport(`طلب شراء خضار #${raw.id}`);
        w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>طلب شراء خضار #${esc(raw.id)}</title></head><body style="font-family:'Segoe UI',Tahoma,sans-serif;padding:24px">جارٍ تجهيز طلب الخضار…</body></html>`);
        (async () => {
            let full = raw;
            try {
                const found = await fetchVegRequestById(raw.id);
                if (found) {full = found; markVegPrinted(raw.id).catch(() => {});}
            } catch (_) { /* الصف المحلي — لا شيء يوقف الورقة */ }
            const doc = buildVegPrintHtml(full, userName);
            w.document.open();
            w.document.write(doc);
            w.document.close();
            w.document.querySelector('[data-v2-print]')?.addEventListener('click', () => w.print());
            w.document.querySelector('[data-v2-close]')?.addEventListener('click', () => w.close());
            w.focus();
            w.print();
        })();
    }

    /* ── القراءة والرسم ────────────────────────────────────────────────── */

    function paintSeg() {
        segHost.innerHTML = `<div class="erp-seg" role="group" aria-label="حالة الطلب">`
            + `<span class="erp-seg__label">الحالة</span>`
            + VEG_STATUS_FILTERS.map((s) => `<button type="button" data-v2-status="${s}"`
                + `${s === status ? ' class="is-active" aria-pressed="true"' : ' aria-pressed="false"'}>${STATUS_AR[s] || s}</button>`).join('')
            + `</div>`;
    }

    /** ملخّص السجل — الحالات من السجل المشترك، وغير المسجلة تُعرض خامًا. */
    function paintSummary(summary) {
        const parts = [
            `معلقة ${summary.pending ?? 0}`,
            `معلقة اليوم ${summary.pending_today ?? 0}`,
            `طلبات اليوم ${summary.today ?? 0}`,
        ];
        summaryEl.textContent = parts.join(' · ');
        countEl.textContent = rawRows.length ? `(${formatInt(rawRows.length)})` : '';
    }

    async function reload() {
        if (loading) {return;}
        loading = true;
        const seq = ++readSeq;
        if (!rawRows.length) {table.setLoading(true);}
        try {
            const [res, cur] = await Promise.all([
                fetchVegRequests({ status }),
                fetchCurrency().catch(() => ''),
            ]);
            if (!el.isConnected || seq !== readSeq) {return;}   // destroyed / newer read wins
            currency = String(cur ?? '');
            currencyNote.hidden = !!currency;
            rawRows = res.rows;
            rawById = new Map(rawRows.map((r) => [String(r.id), r]));
            table.setRows(rawRows.map((r) => ({ ...vegRequestToRow(r), _raw: r })));
            paintSummary(res.summary);
            paintSeg();
        } catch (e) {
            if (!el.isConnected || seq !== readSeq) {return;}
            rawRows = [];
            rawById = new Map();
            table.setRows([]);
            summaryEl.textContent = '';
            countEl.textContent = '';
            table.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN'
                    ? 'لا صلاحية لعرض طلبات الخضار بهذا الحساب — القرار للخادم وحده.'
                    : `تعذّر تحميل الطلبات: ${(e && e.message) || 'خطأ'}`));
        } finally {
            loading = false;
        }
    }

    /* ── التفويض: نقرة واحدة تخدم كل اللوحات (CSP: لا معالج سطري) ──────── */

    el.addEventListener('click', (event) => {
        const actBtn = event.target.closest('[data-v2-act]');
        if (actBtn) {
            const raw = rawById.get(String(actBtn.dataset.id));
            if (!raw) {notify('تعذر العثور على الطلب — حدّث القائمة'); return;}
            const act = actBtn.dataset.v2Act;
            if (act === 'print') {printVeg(raw); return;}
            openPanel(act, raw);
            return;
        }
        const seg = event.target.closest('[data-v2-status]');
        if (seg) {
            status = seg.getAttribute('data-v2-status');
            paintSeg();
            reload();
            return;
        }
        if (event.target.closest('[data-v2-panel-close]')) {closePanel(); return;}
        if (event.target.closest('[data-v2-submit]')) {submitPanel(); return;}
        if (event.target.closest('[data-v2-retry-panel]')) {
            if (retryState) {openPanel(retryState.kind, retryState.raw);}
            return;
        }
        if (event.target.closest('[data-v2-add-custom]')) {
            const box = panelEl.querySelector('[data-v2-custom-box]');
            if (box) {box.insertAdjacentHTML('beforeend', customRowHtml()); fillCustomUnits();}
            return;
        }
        const removeCustom = event.target.closest('[data-v2-remove-custom]');
        if (removeCustom) {
            removeCustom.closest('[data-v2-custom]')?.remove();
            updateCreateCount();
            return;
        }
        const pr = event.target.closest('[data-v2-priority]');
        if (pr) {
            priority = pr.getAttribute('data-v2-priority') === 'urgent' ? 'urgent' : 'normal';
            syncPriorityButtons();
            return;
        }
        if (event.target.closest('[data-v2-new]')) {openPanel('create', null); return;}
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-erp-retry]')) {reload();}
    });

    el.addEventListener('input', (event) => {
        if (event.target.closest('[data-v2-custom]')) {updateCreateCount(); return;}
        if (event.target.matches('[data-v2-qty]')) {
            const card = event.target.closest('[data-v2-veg-item]');
            if (card) {card.classList.toggle('is-filled', Number(event.target.value) > 0);}
            updateCreateCount();
            return;
        }
        if (event.target.matches('[data-v2-veg-search]')) {
            const term = String(event.target.value || '').trim().toLowerCase();
            panelEl.querySelectorAll('[data-v2-veg-cat-title]').forEach((cat) => {
                let any = false;
                cat.querySelectorAll('[data-v2-veg-item]').forEach((card) => {
                    const name = String(card.getAttribute('data-v2-veg-item') || '').toLowerCase();
                    const show = !term || name.includes(term);
                    card.style.display = show ? '' : 'none';
                    if (show) {any = true;}
                });
                cat.style.display = any ? '' : 'none';
            });
            return;
        }
        if (event.target.matches('[data-v2-vp-price]')) {
            let total = 0;
            panelEl.querySelectorAll('[data-v2-vp-price]').forEach((inp) => {
                const price = Number(inp.value);
                const qty = Number(inp.getAttribute('data-v2-vp-qty'));
                const line = Number.isFinite(price) && price >= 0 && Number.isFinite(qty)
                    ? Math.round(qty * price * 100) / 100 : 0;
                const lineEl = panelEl.querySelector(`[data-v2-line="${CSS.escape(inp.getAttribute('data-v2-vp-name') || '')}"]`);
                if (lineEl) {lineEl.textContent = inp.value === '' ? '—' : line.toFixed(2);}
                total += line;
            });
            const totalEl = panelEl.querySelector('[data-v2-total]');
            if (totalEl) {totalEl.textContent = total.toFixed(2);}
        }
    });

    paintSeg();
    reload();

    return {
        el,
        reload,
        getRows: () => rawRows,
        destroy() {
            panelSeq += 1;
            table.destroy();
            el.remove();
        },
    };
}
